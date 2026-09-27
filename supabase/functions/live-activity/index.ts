// LE CYCLE DE VIE DISTANT D'UNE LIVE ACTIVITY.
//
// POURQUOI UNE FONCTION SERVEUR POUR UN GESTE QUI PART DE L'APP
//
// Mettre à jour ou terminer une Live Activity passe par l'API REST de
// OneSignal, qui exige la clé d'API de l'application. Cette clé ouvre l'envoi
// de notifications à TOUS les joueurs : elle n'a rien à faire dans un bundle
// JavaScript, qui se lit avec un éditeur de texte. Elle vit donc ici, dans les
// secrets Supabase, et l'app ne connaît que l'identifiant de son expédition.
//
// CE QUE LE SDK NE SAIT PAS FAIRE, ET QUI JUSTIFIE CE DÉTOUR
//
// `react-native-onesignal` sait DÉMARRER une activité (`startDefault`) mais pas
// la terminer : il n'expose pas d'`endDefault`, et son `exit` porte
// « @deprecated Currently unsupported ». Sans cette fonction, une expédition
// terminée laisserait sa carte sur l'écran verrouillé pendant quatre heures.
//
// L'AUTORISATION EST VÉRIFIÉE, ET SUR LA LIGNE, PAS SUR L'ARGUMENT
//
// Le client envoie un identifiant d'expédition. On ne le croit pas : on relit
// la ligne avec le jeton de l'appelant, donc sous RLS. Quelqu'un qui réclame
// l'expédition d'un autre ne lit rien et repart en 404 — sans quoi n'importe
// qui pourrait éteindre la Live Activity de n'importe qui.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

type Corps = {
  expeditionId?: unknown;
  event?: unknown;
  speciesCount?: unknown;
  newSpeciesCount?: unknown;
  lastSpecies?: unknown;
};

const entier = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Unauthorized' }, 401);

  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  });
  const { data: userId, error: authError } = await userDb.rpc('current_user_id');
  if (authError || !userId) return json({ error: 'Unauthorized' }, 401);

  const body = (await request.json().catch(() => ({}))) as Corps;
  const expeditionId = typeof body.expeditionId === 'string' ? body.expeditionId : null;
  const event = body.event === 'end' ? 'end' : 'update';
  if (!expeditionId) return json({ error: 'expeditionId manquant' }, 400);

  // RLS : la ligne ne revient que si elle appartient à l'appelant.
  const { data: expedition } = await userDb
    .from('expeditions')
    .select('id')
    .eq('id', expeditionId)
    .maybeSingle();
  if (!expedition) return json({ error: 'Expédition introuvable' }, 404);

  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const apiKey = Deno.env.get('ONESIGNAL_API_KEY');
  // Un repli silencieux, comme `guide-title` : une Live Activity est un confort,
  // elle ne doit jamais faire échouer la fin d'une expédition. Mais on dit
  // pourquoi — un repli muet se comporte comme une panne.
  if (!appId || !apiKey) return json({ ok: false, reason: 'no-key' });

  const reponse = await fetch(
    // `/live_activities/{activity_id}/notifications` et non
    // `/activities/activity/{type}` : le premier chemin vise une INSTANCE en
    // cours, le second sert à en DÉMARRER une. Les confondre rend un 404 en
    // page HTML — aucune erreur JSON pour désigner la cause.
    `https://api.onesignal.com/apps/${appId}/live_activities/${expeditionId}/notifications`,
    {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        event,
        name: event === 'end' ? 'Expédition terminée' : 'Expédition en cours',
        event_updates: { data: {
          speciesCount: entier(body.speciesCount),
          newSpeciesCount: entier(body.newSpeciesCount),
          lastSpecies: typeof body.lastSpecies === 'string' ? body.lastSpecies.slice(0, 60) : '',
        } },
        contents: { en: event === 'end' ? 'Expedition finished' : 'Expedition in progress' },
        // Timestamp passé = retrait immédiat. Sans lui, iOS garde la carte
        // quatre heures de plus après la fin — ce qui, pour une sortie qu'on
        // vient de clore dans l'app, se lit comme un bug.
        ...(event === 'end' ? { dismissal_date: Math.floor(Date.now() / 1000) - 1 } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch((error) => ({ ok: false, status: 0, text: () => String(error) } as unknown as Response));

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    return json({ ok: false, reason: `http-${reponse.status}: ${detail.slice(0, 200)}` });
  }
  return json({ ok: true });
});
