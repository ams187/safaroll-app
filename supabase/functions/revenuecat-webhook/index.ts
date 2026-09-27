// L'abonnement, branché.
//
// `profiles.is_premium` n'était écrit par personne : sa migration donnait,
// en commentaire, la requête à lancer À LA MAIN. Un joueur qui payait recevait
// donc 403 sur `guide-chat`, `guide-search` et `guide-title`. Il payait, et
// n'avait rien. C'est ce que ce fichier répare.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI DÉCIDE, ET CE QUI NE DÉCIDE PAS
//
// Le type d'événement ne suffit pas à trancher, et s'y fier seul est le piège
// classique :
//
//   CANCELLATION  n'est PAS une fin de droit. C'est « je coupe le
//                 renouvellement automatique » — le joueur reste abonné
//                 jusqu'à la date déjà payée. Le révoquer là, c'est lui
//                 retirer ce qu'il a acheté.
//   BILLING_ISSUE n'en est pas une non plus : Apple retente pendant plusieurs
//                 jours et le droit court pendant ce délai de grâce.
//
// Seuls `EXPIRATION` et `SUBSCRIPTION_PAUSED` retirent vraiment. Tout le reste
// accorde ou ne change rien.
//
// ─────────────────────────────────────────────────────────────────────────
// ET LA DATE FAIT LE RESTE
//
// `expiration_at_ms` est écrit dans `premium_until` à chaque passage. Le
// droit s'éteint donc TOUT SEUL à la date annoncée, même si le message
// `EXPIRATION` se perd. Le webhook avance l'échéance ; il n'est pas un maillon
// dont la perte se paie en abonnement gratuit à vie.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

/** Accordent (ou prolongent) le droit. */
const ACCORDE = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'RENEWAL',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'UNCANCELLATION',
]);

/** Retirent vraiment. Ni `CANCELLATION` ni `BILLING_ISSUE` n'en font partie. */
const RETIRE = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED']);

/** Comparaison à temps constant : un `===` sur un secret fuit sa longueur. */
function memeSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // RevenueCat n'a pas de jeton Supabase : il envoie l'en-tête `Authorization`
  // qu'on lui a configuré dans son tableau de bord. C'est la seule preuve que
  // l'appel vient bien de lui — sans elle, n'importe qui s'offre l'abonnement
  // en postant un JSON.
  const attendu = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!attendu) return json({ error: 'Webhook is not configured' }, 503);
  if (!memeSecret(request.headers.get('authorization') ?? '', attendu)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const payload = await request.json().catch(() => null) as {
    event?: {
      app_user_id?: string;
      expiration_at_ms?: number | null;
      transferred_from?: string[];
      transferred_to?: string[];
      type?: string;
    };
  } | null;
  const event = payload?.event;
  if (!event?.type) return json({ error: 'Invalid payload' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const ecrire = async (userId: string, actif: boolean, jusqua: number | null) => {
    const { error } = await admin
      .from('profiles')
      .update({
        is_premium: actif,
        // `null` en retirant : on efface l'échéance plutôt que de laisser une
        // date passée traîner, qui se lirait comme un octroi manuel.
        premium_until: actif && jusqua ? new Date(jusqua).toISOString() : null,
      })
      .eq('user_id', userId);
    if (error) throw error;
  };

  try {
    // UN TRANSFERT DÉPLACE LE DROIT. Il arrive quand un même achat Apple est
    // restauré sur un autre compte : le perdre de vue laisserait deux abonnés
    // pour un seul paiement.
    if (event.type === 'TRANSFER') {
      for (const perdant of event.transferred_from ?? []) await ecrire(perdant, false, null);
      for (const gagnant of event.transferred_to ?? []) await ecrire(gagnant, true, event.expiration_at_ms ?? null);
      return json({ ok: true, type: event.type });
    }

    const userId = event.app_user_id;
    // `Purchases.logIn(userId)` côté app pose le `sub` Clerk comme identifiant
    // RevenueCat — c'est la même clé que `profiles.user_id`.
    if (!userId) return json({ error: 'Missing app_user_id' }, 400);

    if (ACCORDE.has(event.type)) await ecrire(userId, true, event.expiration_at_ms ?? null);
    else if (RETIRE.has(event.type)) await ecrire(userId, false, null);
    // Tout le reste — CANCELLATION, BILLING_ISSUE, TEST, inconnus à venir — est
    // reçu et ignoré. Rendre 200 est important : un code d'erreur ferait
    // réessayer RevenueCat en boucle pour un message qui n'a rien à changer.

    return json({ ok: true, type: event.type });
  } catch (error) {
    // 500 pour que RevenueCat REJOUE : une écriture perdue, c'est un abonné
    // sans son abonnement.
    return json({ error: String(error) }, 500);
  }
});
