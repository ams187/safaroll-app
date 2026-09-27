// LE MOIS EN CARTES, PAR E-MAIL.
//
// POURQUOI L'E-MAIL ET PAS UNE NOTIFICATION
//
// Un récapitulatif se lit, il ne s'annonce pas. Il est long, on y revient, on
// le montre. Sur un écran verrouillé il n'aurait que trois lignes et
// disparaîtrait au premier balayage.
//
// Un refus du push n'autorise PAS l'e-mail. Le consentement distinct est
// enregistré dans notification_consents et vérifié juste avant chaque envoi.
//
// CE QU'IL RACONTE, ET CE QU'IL NE RACONTE PAS
//
// Ce que le joueur a FAIT ce mois-ci, et ce qui l'attend le mois prochain.
// Jamais un total d'espèces restantes : le modèle en reconnaît des centaines
// de milliers, le catalogue n'est qu'une table, et annoncer une borne
// transformerait une collection sans fin en barre de progression. Voir
// `scripts/check-no-species-total.ts`.
//
// DÉCLENCHEMENT : un cron mensuel appelle cette fonction avec la clé de
// service. Elle n'est pas exposée aux clients — elle lit les captures de TOUS
// les joueurs, ce qu'aucun jeton utilisateur ne doit pouvoir faire.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// UUID v5, fixed namespace + app/account/month. Replays use the same send key.
async function recapKey(value: string): Promise<string> {
  const namespace = Uint8Array.from('6ba7b8109dad11d180b400c04fd430c8'.match(/../g)!, hex => parseInt(hex, 16));
  const name = new TextEncoder().encode(value);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace); input.set(name, namespace.length);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  // UN SECRET DÉDIÉ, PAS LA CLÉ DE SERVICE.
  //
  // La clé de service ouvre TOUT le projet. La donner à un déclencheur externe
  // — un cron, un webhook — c'est confier les pleins pouvoirs à ce qui n'a
  // besoin que d'appeler une fonction. Ce secret-ci n'autorise que cet appel,
  // et se change sans toucher au reste.
  const attendu = Deno.env.get('RECAP_SECRET');
  if (!attendu || request.headers.get('x-recap-secret') !== attendu) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const apiKey = Deno.env.get('ONESIGNAL_API_KEY');
  if (!appId || !apiKey) return json({ ok: false, reason: 'no-key' });

  // La clé de service reste nécessaire pour LIRE — la fonction parcourt les
  // captures de tous les joueurs — mais elle vient de l'environnement de la
  // fonction, jamais de l'appelant. Le secret ci-dessus n'autorise que le
  // déclenchement ; il ne donne aucun accès aux données.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const now = new Date();
  // OneSignal retains deduplication keys for 30 days. Restrict monthly retries
  // to week one so a late rerun cannot send the same month again after expiry.
  if (now.getUTCDate() > 7) return json({ ok: true, reason: 'outside-monthly-window' });
  const fin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const debut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  // Aggregate one page at a time; an unpaginated select silently truncates at
  // the API row limit. No email is sent until every page has been read.
  const ORDRE = ['common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'];
  const parJoueur = new Map<string, { especes: Set<string>; meilleure: string | null; meilleureEn: string | null; rang: number }>();
  let cursor: string | undefined;
  for (;;) {
    let query = admin
      .from('animal_captures')
      .select('id, user_id, scientific_name, common_name, common_name_locale, vernaculars, rarity, captured_at')
      .gte('captured_at', debut.toISOString())
      .lt('captured_at', fin.toISOString())
      .in('status', ['ready', 'needs_review'])
      .order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data: captures, error } = await query;
    if (error) return json({ ok: false, reason: 'captures-read-failed' }, 503);
    if (!captures?.length) break;

    // One player, one recap, with the game's rarity order.
    for (const c of captures) {
      const scientific = c.scientific_name?.trim();
      if (!scientific) continue;
      const localized = c.common_name_locale?.trim();
      const nom = localized && localized.length > 3 ? localized : c.common_name || scientific;
      const bilan = parJoueur.get(c.user_id) ?? { especes: new Set<string>(), meilleure: null, meilleureEn: null, rang: -1 };
      bilan.especes.add(scientific);
      const rang = ORDRE.indexOf(String(c.rarity));
      if (rang > bilan.rang) {
        bilan.rang = rang; bilan.meilleure = nom;
        bilan.meilleureEn = typeof c.vernaculars?.en === 'string' && c.vernaculars.en.trim() ? c.vernaculars.en.trim() : scientific;
      }
      parJoueur.set(c.user_id, bilan);
    }
    cursor = captures[captures.length - 1].id;
  }

  let envoyes = 0;
  let echecs = 0;
  for (const [userId, bilan] of parJoueur) {
    // Un bilan d'UNE espèce n'est pas un bilan : on se tait plutôt que
    // d'envoyer un e-mail pour dire « tu as fait une photo ».
    if (bilan.especes.size < 2) continue;
    const { data: consent, error: consentError } = await admin.from('notification_consents')
      .select('monthly_email').eq('user_id', userId).maybeSingle();
    if (consentError) { echecs++; continue; }
    if (consent?.monthly_email !== true) continue;
    // Reuse the locale already synced by the app to OneSignal; no new
    // preference table or inferred language from location/email address.
    const userResponse = await fetch(`https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const user = await userResponse?.json().catch(() => null);
    if (!userResponse?.ok || !user?.properties || user.errors) { echecs++; continue; }
    const french = /^fr(?:[-_]|$)/i.test(String(user.properties.tags?.locale ?? user.properties.language ?? 'en'));
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const corps = french ?
      `<p>Le mois dernier, tu as photographié <strong>${bilan.especes.size} espèces</strong>.</p>` +
      (bilan.meilleure ? `<p>La plus rare : <strong>${escape(bilan.meilleure)}</strong>.</p>` : '') +
      `<p>${[...bilan.especes].slice(0, 12).map(escape).join(' · ')}</p>` +
      '<p><a href="[unsubscribe_url]">Ne plus recevoir ce bilan</a></p>' :
      `<p>Last month, you photographed <strong>${bilan.especes.size} species</strong>.</p>` +
      (bilan.meilleureEn ? `<p>Your rarest find: <strong>${escape(bilan.meilleureEn)}</strong>.</p>` : '') +
      `<p>${[...bilan.especes].slice(0, 12).map(escape).join(' · ')}</p>` +
      '<p><a href="[unsubscribe_url]">Unsubscribe from this recap</a></p>';

    const reponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        idempotency_key: await recapKey(`${appId}:monthly-recap:${userId}:${debut.toISOString()}`),
        name: 'Recapitulatif mensuel',
        target_channel: 'email',
        include_aliases: { external_id: [userId] },
        email_subject: french ? `Ton mois en cartes — ${bilan.especes.size} espèces` : `Your month in cards — ${bilan.especes.size} species`,
        email_body: corps,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const result = await reponse?.json().catch(() => null);
    if (reponse?.ok && result?.id && !result?.errors) envoyes += 1;
    else echecs++;
  }

  return json({ ok: echecs === 0, joueurs: parJoueur.size, envoyes, echecs }, echecs ? 503 : 200);
});
