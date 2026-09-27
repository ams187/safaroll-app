// APRÈS LA PLUIE.
//
// L'IDÉE
//
// Une pluie nocturne fait sortir ce qui reste caché le reste du temps :
// salamandres, tritons, crapauds, escargots. C'est un fait de terrain que tout
// naturaliste connaît — l'humidité lève la contrainte qui les tient au sol le
// jour — et c'est aussi un fait qu'AUCUNE app de rappels ne peut exploiter,
// parce qu'il faut croiser trois choses : la météo d'un lieu précis, la
// saisonnalité d'un groupe d'espèces, et la collection du joueur.
//
// C'est le pendant du chœur de l'aube sur un autre axe. L'aube est
// astronomique et prévisible ; la pluie est météorologique et imprévisible.
// Ensemble, ils couvrent les deux façons dont la nature « ouvre une fenêtre ».
//
// POURQUOI LE LENDEMAIN MATIN ET PAS PENDANT L'AVERSE
//
// Personne ne sort sous la pluie. Les amphibiens, eux, restent actifs tant que
// le sol est humide — quelques heures après. Le bon moment est donc le matin
// qui suit, pas la nuit même : c'est là que la fenêtre est ouverte ET que le
// joueur est disponible.
//
// LA MÉTÉO EST GRATUITE ET SANS CLÉ. Open-Meteo rend les précipitations
// horaires passées pour un point donné. Aucun secret à gérer, aucun quota à
// surveiller pour un usage de cette taille.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { recentRainfall } from './rainfall.ts';
import { hasRecentNotificationLocation } from '../_shared/notification-location.ts';
import { notificationPages } from '../_shared/notification-pages.ts';
import { userLocalMinute } from '../_shared/notification-time.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

/**
 * Le seuil de pluie qui compte.
 *
 * Deux millimètres sur la nuit : assez pour mouiller le sol en profondeur,
 * pas assez pour qu'une bruine de dix minutes déclenche une notification. En
 * dessous, le sol sèche avant le matin et la fenêtre n'existe pas.
 */
const PLUIE_MM = 2;
/** Les groupes qui sortent après la pluie. Le reste du vivant s'en moque. */
const GROUPES = ['amphibiens', 'mollusques'];
/** Même largeur que le cron : c'est ce qui rend l'envoi unique par jour. */
const CRENEAU_MIN = 60;
/** Heure légale du dernier fuseau transmis par l'app, datant de moins de 24 h. */
const HEURE_ENVOI = 8;

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

  // LA VUE FAIT LE TRAVAIL, PAS LE JAVASCRIPT.
  //
  // On rapatriait les 2 000 dernières captures pour en déduire, ici, la
  // position de chacun et ses espèces. Trois défauts invisibles à dix
  // joueurs : la limite TRONQUE — au-delà, les moins actifs disparaissent
  // sans que rien ne le signale ; le volume transféré croît avec l'app
  // entière et non avec le nombre de destinataires ; et deux fonctions
  // refaisaient le même calcul, donc pouvaient diverger.
  const { data: cibles, error } = await notificationPages((from, to) => admin
    .from('notification_targets')
    .select('user_id, latitude, longitude, last_capture_at, last_location_at, owned_species, region')
    .order('user_id').range(from, to));
  if (error) return json({ ok: false, reason: 'targets-read-failed' }, 503);

  const lieu = new Map<string, { lat: number; lon: number }>();
  const vues = new Map<string, Set<string>>();
  const regionDe = new Map<string, string>();
  for (const c of cibles ?? []) {
    if (force && c.user_id !== testUser) continue;
    if (!force && !hasRecentNotificationLocation(c, maintenant.getTime())) continue;
    lieu.set(c.user_id, { lat: c.latitude as number, lon: c.longitude as number });
    vues.set(c.user_id, new Set((c.owned_species as string[]) ?? []));
    regionDe.set(c.user_id, (c.region as string | null) ?? 'FR');
  }

  const regions = [...new Set([...regionDe.values()])];

  const { data: saisons, error: seasonError } = await notificationPages((from, to) => admin
    .from('species_seasons')
    .select('scientific_name, monthly_counts, region')
    .in('region', regions.length ? regions : ['FR'])
    .order('region').order('scientific_name').range(from, to));
  if (seasonError) return json({ ok: false, reason: 'seasons-read-failed' }, 503);
  const { data: catalogue, error: catalogError } = await notificationPages((from, to) => admin
    .from('species_catalog')
    .select('scientific_name, vernacular_name, vernacular_name_en, animal_group')
    .in('animal_group', GROUPES).order('scientific_name').range(from, to));
  if (catalogError) return json({ ok: false, reason: 'catalog-read-failed' }, 503);
  const nomFr = new Map((catalogue ?? []).map((c) => [c.scientific_name, c.vernacular_name]));
  const nomEn = new Map((catalogue ?? []).map((c) => [c.scientific_name, c.vernacular_name_en || c.scientific_name]));

  const apresPluiePar = new Map<string, { nom: string; presence: number }[]>();
  for (const s of saisons ?? []) {
    if (!nomFr.has(s.scientific_name)) continue;
    const presence = Number((s.monthly_counts as number[])?.[mois] ?? 0);
    if (presence <= 0) continue;
    const liste = apresPluiePar.get(s.region as string) ?? [];
    liste.push({ nom: s.scientific_name as string, presence });
    apresPluiePar.set(s.region as string, liste);
  }
  for (const liste of apresPluiePar.values()) liste.sort((a, b) => b.presence - a.presence);

  /**
   * LA MÉTÉO SE PARTAGE ENTRE VOISINS.
   *
   * Un appel par joueur, c'est un appel par joueur : à mille inscrits, mille
   * requêtes par heure pour une information qu'ils partagent. La pluie ne
   * s'arrête pas à la rue d'à côté.
   *
   * On arrondit à 0,25° — environ 25 km, l'échelle d'une averse — et on garde
   * le résultat le temps de l'exécution. Deux joueurs de la même ville ne
   * déclenchent qu'un appel, et la précision perdue est sans effet : à cette
   * distance, il a plu sur les deux ou sur aucun.
   */
  const meteoConnue = new Map<string, number | null>();
  const cumulPluie = async (lat: number, lon: number): Promise<number | null> => {
    const cle = `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
    const connu = meteoConnue.get(cle);
    if (connu !== undefined) return connu;
    const [gLat, gLon] = cle.split(',');
    const meteo = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}` +
        '&hourly=precipitation&past_days=1&forecast_days=1&timezone=UTC',
      { signal: AbortSignal.timeout(8_000) },
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const cumul = recentRainfall(meteo?.hourly, maintenant.getTime());
    meteoConnue.set(cle, cumul);
    return cumul;
  };

  let envoyes = 0;
  let echecs = 0;
  let arroses = 0;
  let eligibles = 0;
  for (const [userId, ou] of lieu) {
    if (!force) {
      const minuteLocale = await userLocalMinute(appId, apiKey, userId, maintenant, 'peak');
      if (minuteLocale === null || minuteLocale < HEURE_ENVOI * 60 || minuteLocale >= HEURE_ENVOI * 60 + CRENEAU_MIN) continue;
    }

    const cumul = await cumulPluie(ou.lat, ou.lon);
    if (cumul !== null && cumul >= PLUIE_MM) arroses += 1;
    if (!force && (cumul === null || cumul < PLUIE_MM)) continue;

    const deja = vues.get(userId) ?? new Set<string>();
    const apresPluie = apresPluiePar.get(regionDe.get(userId) ?? 'FR') ?? [];
    const cible = apresPluie.find((c) => !deja.has(c.nom));
    if (!cible) continue;
    eligibles += 1;
    // Read-only validation: no budget reservation or push.
    if (dryRun) continue;

    const nom = nomFr.get(cible.nom) ?? cible.nom;
    const slug = cible.nom.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const image = `${supabaseUrl}/storage/v1/object/public/notification-images/${slug}.jpg`;

    // UN SEUL MESSAGE DISCRÉTIONNAIRE PAR JOUR, TOUS MOTEURS CONFONDUS.
    // Le mode démonstration l'ignore, sinon on ne pourrait montrer qu'un
    // moteur par jour.
    if (!force && !(await reserverEnvoi(admin, userId, 'after-rain'))) continue;

    const reponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        name: 'Apres la pluie',
        target_channel: 'push',
        enable_frequency_cap: true,
        include_aliases: { external_id: [userId] },
        // Le nom de l'espèce en titre : pas d'article à deviner, et il frappe
        // en gras sur l'écran verrouillé.
        headings: { fr: nom, en: nomEn.get(cible.nom) ?? cible.nom },
        contents: {
          fr: 'De la pluie est estimée dans ce secteur ces dernières heures. Une occasion de chercher les animaux qui apprécient l’humidité.',
          en: 'Rain is estimated in this area over the past few hours. A chance to look for animals that thrive in damp conditions.',
        },
        ios_attachments: { espece: image },
        big_picture: image,
        data: { kind: 'peak', url: '/(app)/(tabs)/(home)' },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const resultat = await reponse?.json().catch(() => null);
    // A non-empty id means OneSignal created the message. `errors` can still
    // list aliases with dead subscriptions (e.g. a stale email) while the push
    // is delivered, so it must not count as a failure. No recipient => id "".
    if (reponse?.ok && typeof resultat?.id === 'string' && resultat.id.trim()) envoyes += 1;
    else echecs += 1;
  }

  return json({
    ok: echecs === 0,
    force,
    dryRun,
    eligibles,
    examines: lieu.size,
    arroses,
    envoyes,
    echecs,
    appelsMeteo: meteoConnue.size,
    regions: [...apresPluiePar].map(([r, l]) => `${r}:${l.length}`),
  }, echecs ? 503 : 200);
});

/**
 * RÉSERVE LE MESSAGE DISCRÉTIONNAIRE DU JOUR.
 *
 * Rend `true` si ce joueur n'en a pas encore reçu aujourd'hui, `false` sinon.
 *
 * L'ARBITRAGE EST FAIT PAR LA CONTRAINTE, PAS PAR LE CODE. La clé primaire
 * `(user_id, sent_on)` refuse la seconde insertion du jour : deux crons qui se
 * croisent à la même minute ne peuvent pas tous deux réussir. Aucun verrou à
 * poser, aucune course à raisonner.
 *
 * En cas d'erreur, on rend `false` — donc on se tait. Un message manqué est un
 * regret ; trois messages le même matin sont une désinstallation.
 */
async function reserverEnvoi(
  admin: ReturnType<typeof createClient>,
  userId: string,
  source: string,
): Promise<boolean> {
  const { error } = await admin
    .from('notification_budget')
    .insert({ user_id: userId, source });
  return !error;
}
