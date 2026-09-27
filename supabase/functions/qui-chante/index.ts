// « QUI EST-CE ? »
//
// Un push qui contient le CHANT d'un oiseau de la région, pas son nom. Appui
// long sur la notification : iOS joue l'enregistrement sans ouvrir l'app. En
// ouvrant SafaRoll, un in-app message révèle l'espèce — il est ciblé par le
// segment « Qui chante — réponse à révéler » (tag `chant` posé ici), et son
// bouton repasse le tag à `vu`. Push audio → tag → in-app → tag : toute la
// boucle vit dans OneSignal, sans version de l'app.
//
// Mêmes garde-fous que l'aube et la pluie : fuseau récent et silence respecté
// (`userLocalMinute`), budget d'un message discrétionnaire par jour, et en plus
// un seul « Qui est-ce ? » tous les trois jours.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { notificationPages } from '../_shared/notification-pages.ts';
import { userLocalMinute } from '../_shared/notification-time.ts';
import { choisirChant, INTERVALLE_JOURS } from '../_shared/bird-songs.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

/** 18 h locales : les oiseaux chantent au crépuscule, et le joueur est libre. */
const HEURE_ENVOI = 18;
/** Même largeur que le cron horaire : un seul passage tombe dans le créneau. */
const CRENEAU_MIN = 60;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const attendu = Deno.env.get('RECAP_SECRET');
  if (!attendu || request.headers.get('x-recap-secret') !== attendu) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const apiKey = Deno.env.get('ONESIGNAL_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!appId || !apiKey || !supabaseUrl) return json({ ok: false, reason: 'no-key' });

  const corps = (await request.json().catch(() => ({}))) as { force?: unknown; dryRun?: unknown };
  const force = corps.force === true;
  const dryRun = corps.dryRun === true;
  // Demo calls may only target the server-configured test account.
  const testUser = Deno.env.get('ONESIGNAL_TEST_USER_ID');
  if (force && !testUser) return json({ error: 'Test account not configured' }, 400);

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const maintenant = new Date();
  const mois = maintenant.getUTCMonth();
  const jour = Math.floor(maintenant.getTime() / 86_400_000);

  // Pas besoin de position : le chant dépend de la région et de la saison.
  const { data: cibles, error } = await notificationPages((from, to) => admin
    .from('notification_targets')
    .select('user_id, owned_species, region')
    .order('user_id').range(from, to));
  if (error) return json({ ok: false, reason: 'targets-read-failed' }, 503);
  const joueurs = (cibles ?? []).filter((c) => !force || c.user_id === testUser);

  const regions = [...new Set(joueurs.map((c) => (c.region as string | null) ?? 'FR'))];
  const { data: saisons, error: seasonError } = await notificationPages((from, to) => admin
    .from('species_seasons')
    .select('scientific_name, monthly_counts, region')
    .in('region', regions.length ? regions : ['FR'])
    .order('region').order('scientific_name').range(from, to));
  if (seasonError) return json({ ok: false, reason: 'seasons-read-failed' }, 503);
  const presencePar = new Map<string, Map<string, number>>();
  for (const s of saisons ?? []) {
    const carte = presencePar.get(s.region as string) ?? new Map<string, number>();
    carte.set(s.scientific_name as string, Number((s.monthly_counts as number[])?.[mois] ?? 0));
    presencePar.set(s.region as string, carte);
  }

  const depuis = new Date(maintenant.getTime() - (INTERVALLE_JOURS - 1) * 86_400_000).toISOString().slice(0, 10);
  let envoyes = 0;
  let echecs = 0;
  let eligibles = 0;
  for (const c of joueurs) {
    const userId = c.user_id as string;
    if (!force) {
      const minuteLocale = await userLocalMinute(appId, apiKey, userId, maintenant, 'peak');
      if (minuteLocale === null || minuteLocale < HEURE_ENVOI * 60 || minuteLocale >= HEURE_ENVOI * 60 + CRENEAU_MIN) continue;
      const { data: recent, error: recentError } = await admin.from('notification_budget')
        .select('sent_on').eq('user_id', userId).eq('source', 'qui-chante').gte('sent_on', depuis).limit(1);
      if (recentError || recent?.length) continue;
    }

    const chant = choisirChant(
      presencePar.get((c.region as string | null) ?? 'FR') ?? new Map(),
      new Set((c.owned_species as string[]) ?? []),
      jour,
    );
    if (!chant) continue;
    eligibles += 1;
    // Read-only validation: no budget reservation, tag or push.
    if (dryRun) continue;
    if (!force) {
      const { error: budgetError } = await admin.from('notification_budget').insert({ user_id: userId, source: 'qui-chante' });
      if (budgetError) continue;
    }

    // LE TAG AVANT LE PUSH : si le joueur ouvre l'app aussitôt, la réponse doit
    // déjà l'attendre. Un tag refusé (plafond de tags du forfait) annule
    // l'envoi — un chant sans révélation serait une devinette sans réponse.
    const tag = await fetch(
      `https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ properties: { tags: { chant: chant.slug } } }),
        signal: AbortSignal.timeout(8_000),
      },
    ).catch(() => null);
    if (!tag?.ok) { echecs += 1; continue; }

    const son = `${supabaseUrl}/storage/v1/object/public/notification-sounds/${chant.slug}.mp3`;
    const reponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        name: 'Qui est-ce',
        target_channel: 'push',
        enable_frequency_cap: true,
        include_aliases: { external_id: [userId] },
        headings: { fr: '🎧 Qui est-ce ?', en: "🎧 Who's that?" },
        contents: {
          fr: "Un oiseau de ta région en cette saison. Appuie longuement pour l'écouter, puis ouvre SafaRoll pour la réponse.",
          en: 'A bird from your region this season. Press and hold to listen, then open SafaRoll for the answer.',
        },
        ios_attachments: { chant: son },
        mutable_content: true,
        data: { kind: 'peak', url: '/(app)/(tabs)/(home)' },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const resultat = await reponse?.json().catch(() => null);
    // A non-empty id means OneSignal created the message (see dawn-chorus).
    if (reponse?.ok && typeof resultat?.id === 'string' && resultat.id.trim()) envoyes += 1;
    else echecs += 1;
  }

  return json({ ok: echecs === 0, force, dryRun, examines: joueurs.length, eligibles, envoyes, echecs }, echecs ? 503 : 200);
});
