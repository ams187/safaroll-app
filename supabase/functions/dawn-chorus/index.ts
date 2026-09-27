// LE CHŒUR DE L'AUBE.
//
// L'IDÉE
//
// Les oiseaux chantent à l'aube. Ce n'est pas une image : le « dawn chorus »
// est un phénomène mesuré, qui culmine entre trente minutes AVANT le lever du
// soleil et une heure après. C'est le seul moment de la journée où un
// rougegorge se laisse voir sans qu'on le cherche.
//
// Une notification envoyée à 9 h le rate. En France, le soleil se lève à 5 h 45
// en juin et à 8 h 45 en décembre : aucune heure fixe ne peut suivre. La
// planification par fuseau horaire de OneSignal ne le peut pas non plus — elle
// cale sur l'horloge, pas sur le ciel.
//
// Cette fonction envoie donc à L'AUBE DE CHAQUE JOUEUR, calculée depuis SES
// coordonnées et la date du jour. Le message n'a pas seulement un contenu
// juste : il a un INSTANT juste. C'est le moment qui est l'information.
//
// L'IDEMPOTENCE VIENT DE LA GÉOMÉTRIE, PAS D'UNE TABLE
//
// Le cron tourne toutes les quinze minutes ; la fenêtre d'envoi fait quinze
// minutes. Un joueur donné ne peut donc y tomber qu'une fois par jour, sans
// qu'on ait à retenir quoi que ce soit. Pas d'état à purger, pas de course
// entre deux exécutions, rien à réparer si la fonction est rejouée.
//
// ON NE RÉVEILLE PERSONNE
//
// Envoyé vingt minutes avant le début du chœur, et jamais avant 8 h locales :
// à cette latitude, une aube de juin tombe à 3 h 50 en heure solaire. Un
// rappel « sors écouter les oiseaux » à 4 h du matin n'est pas une attention,
// c'est une nuisance.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { hasRecentNotificationLocation } from '../_shared/notification-location.ts';
import { notificationPages } from '../_shared/notification-pages.ts';
import { userLocale, userLocalMinute } from '../_shared/notification-time.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

/** Largeur du créneau, égale à la période du cron : c'est ce qui rend l'envoi unique. */
const CRENEAU_MIN = 15;
/** On prévient avant que le chœur commence, pour laisser le temps de sortir. */
const PREAVIS_MIN = 20;
/** Le chœur démarre avant le lever du soleil. */
const AVANCE_CHOEUR_MIN = 30;
/** Plancher social : aucune notification avant cette heure locale. */
const HEURE_MINIMALE = 8;
/**
 * ON NE DÉRANGE PAS QUELQU'UN QUI EST DÉJÀ DEHORS.
 *
 * Une capture récente prouve que le joueur fait EXACTEMENT ce que la
 * notification allait lui demander. Lui envoyer « sors photographier » à ce
 * moment-là, c'est se rendre inutile de la façon la plus visible qui soit — et
 * c'est ainsi qu'on apprend à ignorer une app.
 *
 * Douze heures : assez pour couvrir une sortie de la veille au soir, assez
 * court pour ne pas faire taire quelqu'un qui a photographié avant-hier.
 */
const DEJA_DEHORS_H = 12;

/**
 * Lever du soleil en minutes UTC depuis minuit, pour une date et un lieu.
 *
 * Formule solaire NOAA, réduite à ce qui sert ici. Elle n'a pas besoin d'être
 * exacte à la seconde — le chœur dure plus d'une heure, une erreur de deux
 * minutes ne change rien. Elle doit en revanche suivre la SAISON, et c'est
 * exactement ce qu'une heure fixe ne fait pas.
 */
function leverSoleilUTC(date: Date, latitude: number, longitude: number): number | null {
  const jour = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const rad = Math.PI / 180;
  // Angle fractionnel de l'année.
  const gamma = ((2 * Math.PI) / 365) * (jour - 1 + (12 - 12) / 24);
  const eqTemps =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declinaison =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  // 90,833° : le disque solaire a un rayon, et l'atmosphère le réfracte.
  const cosH =
    Math.cos(90.833 * rad) / (Math.cos(latitude * rad) * Math.cos(declinaison)) -
    Math.tan(latitude * rad) * Math.tan(declinaison);
  // Au-delà des cercles polaires, le soleil peut ne pas se lever du tout.
  if (cosH > 1 || cosH < -1) return null;
  const angleHoraire = Math.acos(cosH) / rad;
  return 720 - 4 * (longitude + angleHoraire) - eqTemps;
}

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

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // MODE DÉMONSTRATION.
  //
  // La fonction n'envoie qu'à l'aube — c'est tout son intérêt, et c'est aussi
  // ce qui la rend impossible à montrer. `{"force": true}` saute la fenêtre
  // horaire et envoie tout de suite, sans rien changer d'autre : même choix
  // d'espèce, même image, même message.
  //
  // Il reste derrière le secret : ce n'est pas une porte publique, c'est un
  // interrupteur d'atelier.
  const corps = (await request.json().catch(() => ({}))) as { force?: unknown; dryRun?: unknown };
  const force = corps.force === true;
  const dryRun = corps.dryRun === true;
  // Demo calls may only target the server-configured test account.
  const testUser = Deno.env.get('ONESIGNAL_TEST_USER_ID');
  if (force && !testUser) return json({ error: 'Test account not configured' }, 400);

  const maintenant = new Date();
  const mois = maintenant.getUTCMonth();
  const minutesUTC = maintenant.getUTCHours() * 60 + maintenant.getUTCMinutes();

  // La dernière position connue de chaque joueur. On ne demande pas sa
  // position : on se sert de là où il a DÉJÀ photographié, ce qui est aussi
  // l'endroit où il recommencera.
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

  const dernierLieu = new Map<string, { lat: number; lon: number }>();
  const derniereCapture = new Map<string, number>();
  const dejaVues = new Map<string, Set<string>>();
  const regionDe = new Map<string, string>();
  for (const c of cibles ?? []) {
    if (force && c.user_id !== testUser) continue;
    if (!force && !hasRecentNotificationLocation(c, maintenant.getTime())) continue;
    dernierLieu.set(c.user_id, { lat: c.latitude as number, lon: c.longitude as number });
    derniereCapture.set(c.user_id, new Date(c.last_capture_at as string).getTime());
    dejaVues.set(c.user_id, new Set((c.owned_species as string[]) ?? []));
    // `region` peut être nulle : un joueur qui n'a jamais ouvert les réglages
    // n'en a pas choisi. La France est le repli — c'est là que l'app sort.
    regionDe.set(c.user_id, (c.region as string | null) ?? 'FR');
  }

  // Les oiseaux présents ce mois-ci, du plus observé au moins observé : le
  // chœur de l'aube est fait d'espèces communes, et proposer une rareté
  // improbable transformerait une invitation en frustration.
  const regions = [...new Set([...regionDe.values()])];

  const { data: saisons, error: seasonError } = await notificationPages((from, to) => admin
    .from('species_seasons')
    .select('scientific_name, monthly_counts, region')
    .in('region', regions.length ? regions : ['FR'])
    .order('region').order('scientific_name').range(from, to));
  if (seasonError) return json({ ok: false, reason: 'seasons-read-failed' }, 503);
  const { data: oiseaux, error: catalogError } = await notificationPages((from, to) => admin
    .from('species_catalog')
    .select('scientific_name, vernacular_name, vernacular_name_en')
    .eq('animal_group', 'oiseaux').order('scientific_name').range(from, to));
  if (catalogError) return json({ ok: false, reason: 'catalog-read-failed' }, 503);
  const nomFr = new Map((oiseaux ?? []).map((o) => [o.scientific_name, o.vernacular_name]));
  const nomEn = new Map((oiseaux ?? []).map((o) => [o.scientific_name, o.vernacular_name_en || o.scientific_name]));

  // Un classement PAR RÉGION : la même espèce n'a pas la même présence en
  // Belgique et au Cameroun, et c'est précisément ce que les courbes disent.
  const chanteursPar = new Map<string, { nom: string; presence: number }[]>();
  for (const s of saisons ?? []) {
    if (!nomFr.has(s.scientific_name)) continue;
    const presence = Number((s.monthly_counts as number[])?.[mois] ?? 0);
    if (presence <= 0) continue;
    const liste = chanteursPar.get(s.region as string) ?? [];
    liste.push({ nom: s.scientific_name as string, presence });
    chanteursPar.set(s.region as string, liste);
  }
  for (const liste of chanteursPar.values()) liste.sort((a, b) => b.presence - a.presence);

  // LE CHŒUR D'HIER SE FERME AVANT D'EN OUVRIR UN AUTRE.
  //
  // `stale_date` fait GRISER la carte, il ne la retire pas : iOS la garde
  // jusqu'à huit heures, et sans fin explicite l'écran verrouillé accumule un
  // matin après l'autre. Une Live Activity qui traîne après son événement est
  // pire que pas d'activité du tout — elle affiche une information périmée à
  // l'endroit le plus visible du téléphone.
  //
  // On ferme d'abord, on ouvre ensuite : deux activités du même type ne se
  // chevauchent jamais.
  const hier = new Date(maintenant.getTime() - 86_400_000).toISOString().slice(0, 10);
  let fermees = 0;

  let envoyes = 0;
  let echecs = 0;
  let examines = 0;
  let eligibles = 0;
  for (const [userId, lieu] of dernierLieu) {
    examines += 1;

    // Déjà dehors : on se tait. Le mode démonstration l'ignore, sans quoi il
    // serait impossible de montrer la fonctionnalité juste après une capture.
    const depuis = maintenant.getTime() - (derniereCapture.get(userId) ?? 0);
    if (!force && depuis < DEJA_DEHORS_H * 3_600_000) continue;

    const lever = leverSoleilUTC(maintenant, lieu.lat, lieu.lon);
    if (lever === null) continue;

    const debutChoeur = lever - AVANCE_CHOEUR_MIN;
    const envoiVoulu = debutChoeur - PREAVIS_MIN;
    if (!force) {
      const ecart = minutesUTC - envoiVoulu;
      if (ecart < 0 || ecart >= CRENEAU_MIN) continue;
      const minuteLocale = await userLocalMinute(appId, apiKey, userId, maintenant, 'peak');
      if (minuteLocale === null || minuteLocale < HEURE_MINIMALE * 60 || minuteLocale >= 21 * 60) continue;
    }

    const vues = dejaVues.get(userId) ?? new Set<string>();
    const chanteurs = chanteursPar.get(regionDe.get(userId) ?? 'FR') ?? [];
    const cible = chanteurs.find((c) => !vues.has(c.nom));
    if (!cible) continue;
    eligibles += 1;
    // Read-only validation: no budget reservation, push or Live Activity.
    if (dryRun) continue;

    const nom = nomFr.get(cible.nom) ?? cible.nom;
    const slug = cible.nom.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const image = `${supabaseUrl}/storage/v1/object/public/notification-images/${slug}.jpg`;

    // UN SEUL MESSAGE DISCRÉTIONNAIRE PAR JOUR, TOUS MOTEURS CONFONDUS.
    // Le mode démonstration l'ignore, sinon on ne pourrait montrer qu'un
    // moteur par jour.
    if (!force && !(await reserverEnvoi(admin, userId, 'dawn-chorus'))) continue;

    const reponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        name: 'Choeur de l aube',
        target_channel: 'push',
        enable_frequency_cap: true,
        include_aliases: { external_id: [userId] },
        // LE NOM DE L'ESPÈCE EST LE TITRE. Écrit dans la phrase, il exigerait
        // un article que le catalogue ne porte pas — « LE rougegorge » mais
        // « LA mésange ». En titre, il n'en a pas besoin, et il frappe en gras
        // sur l'écran verrouillé.
        //
        // Le corps évite pronoms ET accords : « pour l'entendre » s'élide dans
        // les deux genres, là où « pour le croiser » se serait trompé une fois
        // sur deux.
        headings: { fr: nom, en: nomEn.get(cible.nom) ?? cible.nom },
        contents: {
          fr: "L’aube approche dans ce secteur. Une occasion d’écouter et de chercher les oiseaux.",
          en: 'Dawn is approaching in this area. A chance to listen and look for birds.',
        },
        ios_attachments: { espece: image },
        big_picture: image,
        // `kind: peak` — la boucle de silence s'y applique : si personne ne
        // sort à l'aube après trois essais, ce joueur n'est pas du matin, et
        // insister ne le rendra pas matinal.
        data: { kind: 'peak', url: '/(app)/(tabs)/(home)' },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const resultat = await reponse?.json().catch(() => null);
    // A non-empty id means OneSignal created the message. `errors` can still
    // list aliases with dead subscriptions (e.g. a stale email) while the push
    // is delivered, so it must not count as a failure. No recipient => id "".
    if (reponse?.ok && typeof resultat?.id === 'string' && resultat.id.trim()) envoyes += 1;
    else { echecs += 1; continue; }

    // LA CHASSE SUR L'ÉCRAN VERROUILLÉ, DÉMARRÉE À DISTANCE.
    //
    // C'est le push-to-start : le serveur crée une Live Activity sur un
    // téléphone dont l'app n'est même pas ouverte. Pendant l'heure du chœur,
    // l'écran verrouillé porte le nom de l'espèce à trouver et un chronomètre
    // rendu par iOS — donc qui avance sans qu'on pousse quoi que ce soit.
    //
    // Elle ne double pas la notification : celle-ci prévient une fois et
    // disparaît, l'activité RESTE pendant que le joueur marche. C'est la
    // différence entre annoncer et accompagner.
    //
    // `activity_id` porte le jour et l'utilisateur : deux aubes successives ne
    // peuvent pas se marcher dessus, et `identify-animal` sait laquelle mettre
    // à jour quand une carte naît.
    const jour = maintenant.toISOString().slice(0, 10);
    const expiresAt = new Date(+maintenant + 90 * 60_000);
    const registered = await admin.from('chorus_activities').insert({
      id: `chorus-${jour}-${userId}`, user_id: userId,
      started_at: maintenant.toISOString(), expires_at: expiresAt.toISOString(),
    });
    // Never start an activity whose eventual closure has not been persisted.
    if (registered.error) { echecs++; continue; }

    // ON FERME LA VEILLE ICI, PAS EN TÊTE DE BOUCLE.
    //
    // Placée avant les filtres, cette fermeture partait pour CHAQUE joueur à
    // CHAQUE passage du cron — quatre-vingt-seize fois par jour et par
    // personne, soit quatre-vingt-seize mille appels quotidiens à mille
    // inscrits, pour une activité qui n'existe qu'une fois sur quatre-vingt-
    // seize. Ici, elle ne part qu'au moment où l'on en ouvre une nouvelle :
    // une fois par joueur et par jour.
    //
    // `dismissal_date` dans le passé retire immédiatement. Si rien ne tourne,
    // OneSignal ne trouve personne et ne fait rien — on n'a donc pas à savoir
    // si le joueur avait une activité en cours.
    const ferme = await fetch(
      `https://api.onesignal.com/apps/${appId}/live_activities/chorus-${hier}-${userId}/notifications`,
      {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'end',
          name: 'Fin du choeur',
          // `event_updates` reste OBLIGATOIRE sur une fin : un objet vide est
          // refusé par « Missing required parameter », et l'échec est muet.
          event_updates: { data: { speciesCount: 0, newSpeciesCount: 0, lastSpecies: '' } },
          dismissal_date: Math.floor(maintenant.getTime() / 1000) - 1,
          priority: 5,
        }),
        signal: AbortSignal.timeout(8_000),
      },
    ).catch(() => null);
    if (ferme?.ok) fermees += 1;

    // One payload for every language: pick the player's own.
    const titre = (await userLocale(appId, apiKey, userId)) === 'fr' ? nom : nomEn.get(cible.nom) ?? cible.nom;
    const demarrage = await fetch(
      `https://api.onesignal.com/apps/${appId}/activities/activity/DefaultLiveActivityAttributes`,
      {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'start',
          activity_id: `chorus-${jour}-${userId}`,
          name: 'Choeur de l aube',
          include_aliases: { external_id: [userId] },
          headings: { en: 'SafaRoll' },
          contents: { en: titre },
          // DefaultLiveActivityAttributes only decodes keys under `data`;
          // flat keys are accepted by APNs and silently dropped on device.
          event_attributes: { data: {
            // Le chronomètre part du DÉBUT du chœur, pas de maintenant : il
            // affiche donc le temps écoulé depuis que les oiseaux chantent,
            // ce qui est l'information utile.
            startedAt: Math.floor((maintenant.getTime() + PREAVIS_MIN * 60_000) / 1000),
            title: titre,
            endsAt: Math.floor(+expiresAt / 1000),
          } },
          event_updates: { data: { speciesCount: 0, newSpeciesCount: 0, lastSpecies: '' } },
          // Le chœur dure environ une heure et demie. Passé ce délai, iOS
          // affiche la carte comme périmée plutôt que de mentir.
          stale_date: Math.floor(maintenant.getTime() / 1000) + 90 * 60,
          // Priorité basse : l'activité peut arriver quelques minutes plus
          // tard sans rien perdre, et Apple étrangle les envois prioritaires.
          priority: 5,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null);
    const resultatDemarrage = await demarrage?.json().catch(() => null);
    // Push-to-start returns notification_id; updates return id.
    if (!demarrage?.ok || typeof resultatDemarrage?.notification_id !== 'string' ||
      !resultatDemarrage.notification_id.trim() || resultatDemarrage?.errors?.length) echecs += 1;
  }

  return json({
    ok: echecs === 0,
    force,
    dryRun,
    eligibles,
    examines,
    envoyes,
    echecs,
    fermees,
    regions: [...chanteursPar].map(([r, l]) => `${r}:${l.length}`),
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
