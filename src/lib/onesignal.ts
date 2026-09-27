// OneSignal — le canal vers le joueur ABSENT.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI UN DEUXIÈME SYSTÈME DE NOTIFICATIONS
//
// `notifications.ts` planifie tout À L'OUVERTURE de l'app (`tomorrowAt(9)`).
// Un joueur qui décroche cinq jours ne reçoit donc plus rien : personne ne
// replanifie pour lui. Le système local ne sait rappeler que les joueurs qui
// reviennent déjà.
//
// La doctrine qui répartit les rôles :
//
//   PUSH SERVEUR (ici)  →  ce qui doit atteindre un joueur absent
//                          (fenêtre saisonnière, objectif du mois, relance).
//   LOCAL (`notifications.ts`)  →  ce qui célèbre un joueur présent
//                          (palier d'atlas, +2 s après le geste).
//
// LA DÉCISION RESTE LOCALE. Aucun moteur n'est dupliqué côté serveur : les
// hooks existants calculent (courbes GBIF × captures × région) et ne poussent
// que le RÉSULTAT, en tags. Le serveur connaît huit faits, pas la position,
// pas le comportement. Les Journeys du dashboard se déclenchent sur ces tags.
//
// MÊME MODULE ABSENT, MÊME COMPORTEMENT : require gardé, comme
// `notifications.ts` — le dev client sans rebuild natif ne doit pas crasher.
// Sans `EXPO_PUBLIC_ONESIGNAL_APP_ID`, tout est neutralisé et le système
// local garde l'intégralité de son ancien rôle (voir `remoteNudgesActive`).
import { marque } from '@/lib/boot-trace';
import { createMMKV } from 'react-native-mmkv';
import { noterCaptureApresRappel, noterClicRappel, setNudgeAccount } from '@/lib/animals/nudge-feedback';
import { liveActivitiesEnabled } from '@/lib/notifications';
import { endLocalLiveActivities } from '../../modules/live-activity-control';
import type { OneSignal as OneSignalType } from 'react-native-onesignal';

type OneSignalModule = typeof OneSignalType;

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;

let OneSignal: OneSignalModule | null = null;
try {
  if (APP_ID) {
    marque('avant require(react-native-onesignal)');
    OneSignal = (require('react-native-onesignal') as { OneSignal: OneSignalModule }).OneSignal;
    marque('après require(react-native-onesignal)');
  }
} catch {
  OneSignal = null;
}

/** `LogLevel.Verbose` — la valeur de l'énum du SDK, sans importer l'énum. */
const LOG_VERBOSE = 6;

/**
 * Vrai quand OneSignal porte les rappels « joueur absent » (saison, objectif).
 * `notifications.ts` s'en sert pour NE PAS planifier les siens : un seul
 * émetteur par message, jamais deux — le doublon est la pire chose qu'une
 * démo puisse montrer.
 */
export const remoteNudgesActive = OneSignal !== null;

let initialized = false;
let currentUserId: string | null | undefined;

/** Initialise une seule fois. À appeler avant tout le reste, au montage. */
export function configureOneSignal(): void {
  if (!OneSignal || !APP_ID || initialized) {
    // L'EXTINCTION SILENCIEUSE EST VOULUE EN PRODUCTION, PAS EN DÉVELOPPEMENT.
    //
    // Sans clé ou sans module natif, tout se neutralise sans bruit — c'est ce
    // qui permet au dev client de tourner sans rebuild. Mais la même silence
    // rend indistinguables « OneSignal est éteint » et « OneSignal est cassé » :
    // on lit des logs vides dans les deux cas. On dit donc pourquoi.
    if (__DEV__ && !initialized) {
      console.log(
        `[onesignal] inactif — ${!APP_ID ? 'EXPO_PUBLIC_ONESIGNAL_APP_ID absente du bundle' : 'module natif non lié (rebuild requis)'}`,
      );
    }
    return;
  }
  initialized = true;
  // `initialize` D'ABORD, écouteurs ensuite. Un écouteur posé avant que le
  // module natif soit démarré n'est rattaché à rien et ne se déclenche jamais
  // — silencieusement, ce qui se lit exactement comme « l'appareil ne
  // s'abonne pas ».
  if (__DEV__) OneSignal.Debug.setLogLevel(LOG_VERBOSE);
  marque('avant OneSignal.initialize');
  OneSignal.initialize(APP_ID);
  // La carte est déjà révélée dans l'app : ne pas doubler ce moment par un push.
  // Ce listener ne s'exécute qu'en avant-plan ; l'arrière-plan reste inchangé.
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event: {
    getNotification: () => { additionalData?: unknown };
    preventDefault: () => void;
  }) => {
    const data = event.getNotification().additionalData as { kind?: unknown; url?: unknown } | undefined;
    if (data?.kind === 'transactional' && data.url === '/(app)/(tabs)/(home)') {
      event.preventDefault();
    }
  });
  marque('après OneSignal.initialize');
  // Confie le cycle de vie des Live Activities au SDK, et enregistre le jeton
  // « push to start » — c'est lui qui autorise le SERVEUR à démarrer une
  // activité. Sans cet appel, `startDefault` ne peut lancer qu'en avant-plan
  // et les mises à jour distantes n'arrivent jamais. Sans effet hors iOS.
  syncLiveActivityPreference();
  marque('après LiveActivities.setupDefault');
  if (__DEV__) reportSubscriptionState();
}

/**
 * Journal de diagnostic, développement seulement.
 *
 * Trois états à distinguer, que des logs vides confondent : l'appareil n'a pas
 * la permission système, il l'a mais n'est pas encore enregistré (l'id porte
 * un préfixe `local-`), ou il porte un id serveur — le seul cas où il apparaît
 * sur le dashboard.
 *
 * On lit l'état COURANT en plus d'écouter les changements : l'écouteur ne dit
 * rien quand rien ne bouge, et « rien ne bouge » est justement le symptôme
 * qu'on cherche à expliquer.
 */
function reportSubscriptionState(): void {
  if (!OneSignal) return;
  const enregistre = (id: string | null | undefined) => !!id && !id.startsWith('local-');
  // UNE LIGNE COURTE PAR FAIT. Le terminal de Metro tronque à la largeur de
  // la fenêtre, et son spinner mange déjà le début : une ligne longue et
  // complète se lit moins bien que quatre lignes courtes.
  void Promise.all([
    OneSignal.User.pushSubscription.getIdAsync(),
    OneSignal.User.pushSubscription.getOptedInAsync(),
    OneSignal.Notifications.getPermissionAsync(),
  ]).then(([id, optedIn, permission]) => {
    console.log(`[os] permission=${permission}`);
    console.log(`[os] optedIn=${optedIn}`);
    console.log(`[os] id=${id ?? 'aucun'}`);
    console.log(`[os] ${enregistre(id) ? 'ENREGISTRE' : 'PAS ENREGISTRE'}`);
    if (!permission) console.log('[os] > active les rappels dans Profil');
  });
  OneSignal.User.pushSubscription.addEventListener('change', ({ current }) => {
    console.log(`[os] change id=${current.id ?? 'aucun'}`);
    console.log(`[os] change ${enregistre(current.id) ? 'ENREGISTRE' : 'pas encore'}`);
  });
}

/**
 * Identité : l'external id OneSignal est l'id Clerk, comme pour RevenueCat.
 * Un même joueur sur deux appareils = un seul destinataire.
 */
export function oneSignalLogin(userId: string | null | undefined): void {
  setNudgeAccount(userId);
  if (!OneSignal || !initialized) return;
  const next = userId || null;
  if (next === currentUserId) return;
  if (currentUserId) stopLiveActivities();
  OneSignal.InAppMessages.clearTriggers();
  if (next) OneSignal.login(next);
  else {
    OneSignal.logout();
    OneSignal.User.pushSubscription.optOut();
  }
  currentUserId = next;
  syncLiveActivityPreference();
}

/**
 * UN SEUL INTERRUPTEUR. Le toggle du profil (`setNotificationsEnabled`)
 * appelle ceci : couper les notifications locales sans couper le push
 * serveur enverrait des rappels à quelqu'un qui vient de dire non.
 */
export function setOneSignalPushEnabled(enabled: boolean): void {
  if (!OneSignal || !initialized) return;
  if (enabled && currentUserId) OneSignal.User.pushSubscription.optIn();
  else OneSignal.User.pushSubscription.optOut();
}

/**
 * Les huit faits que le serveur a le droit de connaître. Tout est calculé
 * sur l'appareil ; chaque valeur est un résultat, pas une donnée brute.
 * `null` efface le tag (l'urgence d'hier ne doit pas déclencher demain).
 */
export type EngagementTags = Partial<{
  region: string;
  urgent_species: string | null;
  urgency_kind: 'leaving' | 'arriving' | 'peak' | null;
  /**
   * LE MESSAGE LUI-MÊME, DÉJÀ ÉCRIT ET DÉJÀ TRADUIT.
   *
   * POURQUOI LE TEXTE VOYAGE DANS UN TAG
   *
   * La justesse de ces notifications est tout leur argument : « le martinet
   * noir repart après septembre » n'a de valeur que si l'espèce est vraiment
   * en fin de fenêtre DANS LA RÉGION du joueur, et qu'il ne l'a pas encore.
   * Ce calcul croise les courbes saisonnières GBIF, le catalogue et la
   * collection — trois jeux de données que seul le client a déjà en cache.
   *
   * Le refaire côté serveur pour chaque destinataire serait coûteux et
   * redondant. On envoie donc la CONCLUSION, et une seule campagne OneSignal
   * la substitue par `{{ nudge_body }}` : un envoi, autant de messages
   * distincts que de joueurs, chacun vrai pour lui.
   *
   * `null` efface — un message d'hier ne doit jamais partir demain.
   */
  nudge_title: string | null;
  nudge_body: string | null;
  /**
   * L'ILLUSTRATION DE L'ESPÈCE, EN URL PUBLIQUE.
   *
   * Une notification qui MONTRE l'animal dont elle parle ne se compare pas à
   * une qui l'écrit. C'est ce que SafaRoll peut faire et qu'une app de rappels
   * générique ne peut pas : les planches existent déjà, une par espèce.
   *
   * EN JPEG, ET C'EST LA CONTRAINTE. iOS n'accepte qu'un jeu restreint de
   * formats en pièce jointe — le WebP n'en fait pas partie, et toutes les
   * planches sont en WebP. `scripts/publish-notification-images.ts` en dépose
   * une copie JPEG dans un bucket public.
   *
   * Si l'espèce n'a pas encore de planche, l'URL ne répond pas et iOS affiche
   * simplement le texte : une image manquante dégrade, elle ne casse pas.
   */
  nudge_image: string | null;
  /**
   * Les types de rappel que ce joueur n'écoute plus, séparés par des virgules.
   *
   * Le ciblage s'en sert en NÉGATIF — « n'envoie pas `leaving` à qui l'a dans
   * `nudge_muted` ». La décision se prend sur l'appareil, où l'on sait ce qui
   * a suivi le clic ; le serveur n'a qu'à respecter le résultat.
   */
  nudge_muted: string | null;
  objective_remaining: number;
  species_count: number;
  atlas_tier: number;
  last_capture_at: number;
  premium: boolean;
  locale: 'fr' | 'en';
}>;

/**
 * Écrit les tags, et y joint TOUJOURS `tags_synced_at`.
 *
 * LA FRAÎCHEUR EST UNE DONNÉE, PAS UNE CONVENTION. Un tag ne bouge que quand
 * l'app tourne : un joueur absent trois semaines porte l'« espèce urgente »
 * d'il y a trois semaines, qui ne l'est probablement plus. Sans cette date,
 * une Journey de relance longue citerait une espèce périmée — exactement le
 * contraire de ce qui fait la valeur de ces notifications, puisque leur
 * justesse est tout l'argument.
 *
 * Règle qui en découle, à tenir sur le dashboard : **une Journey ne cite une
 * espèce que si `tags_synced_at` est récent.** Au-delà, elle parle en
 * `species_count` et en généralités.
 *
 * C'est aussi le meilleur signal d'absence disponible : `last_capture_at`
 * ignore le joueur qui ouvre l'app sans capturer.
 *
 * Elle est posée ici et nulle part ailleurs — toute écriture de tag est par
 * définition la preuve que l'app tourne — et n'est donc pas dans
 * `EngagementTags` : aucun appelant ne doit pouvoir la falsifier.
 */
export function syncEngagementTags(tags: EngagementTags): void {
  if (!OneSignal || !initialized) return;
  if (tags.locale) OneSignal.User.setLanguage(tags.locale);
  const additions: Record<string, string> = { tags_synced_at: String(Date.now()) };
  const removals: string[] = [];
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) additions.notification_timezone = zone;
    else removals.push('notification_timezone');
  } catch { removals.push('notification_timezone'); }
  for (const [key, value] of Object.entries(tags)) {
    if (value === null || value === undefined) removals.push(key);
    else additions[key] = String(value);
  }
  OneSignal.User.addTags(additions);
  for (const key of removals) OneSignal.User.removeTag(key);
}

/**
 * Même contrat de navigation que les notifications locales : le push porte
 * `url` dans ses données, on ne suit que les chemins internes. Une Journey
 * mal configurée ne doit pas pouvoir ouvrir n'importe quoi.
 */
export function observeOneSignalNavigation(open: (url: string) => void): () => void {
  if (!OneSignal || !initialized) return () => undefined;
  // Le retour se compte AU CLIC, avant même de savoir où il mène : c'est le
  // dénominateur de tout le reste. Sans lui, `capture_after_message` est un
  // nombre sans échelle — on saurait combien sont sortis, jamais sur combien.
  const listener = (event: {
    notification: { additionalData?: unknown; launchURL?: string };
  }) => {
    trackReturnOutcome();
    // Le TYPE du rappel, pour la boucle de silence. Il voyage dans `data`,
    // posé par la campagne — sans lui on saurait qu'un message a été ouvert,
    // jamais lequel, et on ne pourrait faire taire que tout ou rien.
    const donnees = event.notification.additionalData as { kind?: unknown } | undefined;
    // OneSignal does not interpolate Liquid in additionalData. Seasonal
    // Journeys carry the kind in their supported, personalized Launch URL.
    const kind = donnees?.kind ?? event.notification.launchURL?.match(/[?&]nudge_kind=(leaving|arriving|peak)(?:&|$)/)?.[1];
    if (kind === 'leaving' || kind === 'arriving' || kind === 'peak') noterClicRappel(kind);
    // DEUX SOURCES, PARCE QUE LE DASHBOARD EN PROPOSE DEUX.
    //
    // `additionalData.url` est ce qu'un envoi par API pose dans `data` ;
    // `launchURL` est le champ « Launch URL » que le formulaire du dashboard
    // affiche, et donc celui qu'un humain remplira en éditant un template.
    // N'en lire qu'un condamne l'autre à un tap qui ouvre l'app sur l'accueil
    // sans rien dire — la panne la plus discrète possible.
    //
    // Le filtre reste le même dans les deux cas : chemins internes seulement.
    // Une Journey mal configurée ne doit pas pouvoir ouvrir n'importe quoi.
    const data = event.notification.additionalData as { url?: unknown } | undefined;
    const brut = typeof data?.url === 'string' ? data.url : event.notification.launchURL;
    if (typeof brut !== 'string') return;
    // Le champ `url` du dashboard est validé comme une VRAIE url : un chemin nu
    // (`/(app)/profile`) n'y est pas enregistré, il faut le schéma de l'app.
    // On l'accepte donc, et on le retire — mais uniquement celui-ci, et le
    // reste doit rester un chemin interne. `safaroll://evil.com` ne passe pas :
    // ce qui suit le schéma ne commence pas par `/`.
    const SCHEMA = 'safaroll://';
    const cible = brut.startsWith(SCHEMA) ? brut.slice(SCHEMA.length) : brut;
    if (cible.startsWith('/')) open(cible);
  };
  OneSignal.Notifications.addEventListener('click', listener);
  return () => OneSignal?.Notifications.removeEventListener('click', listener);
}

// ─────────────────────────────────────────────────────────────────────────
// L'ÉVÉNEMENT DE FENÊTRE SAISONNIÈRE
//
// POURQUOI UN ÉVÉNEMENT ET PAS UN SEGMENT SUR LES TAGS
//
// Une Journey OneSignal démarre soit sur une entrée de segment, soit sur un
// événement custom — jamais les deux, et il n'existe pas de déclencheur
// « ce tag a changé ». Sur un segment, un joueur déjà membre ne re-rentre
// pas : il recevrait UN push saisonnier, puis plus jamais, alors que
// l'espèce urgente change chaque mois. C'est précisément la promesse du
// produit qui tomberait. Les Journeys d'événement, elles, admettent toujours
// la ré-entrée.
//
// L'événement porte aussi sa propre copie : OneSignal conserve l'événement
// déclencheur et ses propriétés sont lisibles en Liquid dans le message
// (`{{ journey.first_event.title }}`). La phrase reste donc dérivée des
// courbes GBIF et traduite dans ce dépôt, jamais réécrite à la main.
//
// UN ÉVÉNEMENT PAR FENÊTRE, PAS PAR OUVERTURE D'APP
//
// Le hook qui calcule le nudge tourne à chaque montage. Émettre à chaque
// fois enverrait un push par ouverture d'app : le contraire de ce qu'on
// construit. On ne réémet que quand la fenêtre CHANGE réellement — espèce ou
// mois — et l'empreinte survit au redémarrage.
const journal = createMMKV({ id: 'onesignal-events' });
const DERNIERE_FENETRE = 'season-window';

export type SeasonWindowEvent = {
  body: string;
  kind: 'leaving' | 'arriving' | 'peak';
  locale: 'fr' | 'en';
  scientificName: string;
  title: string;
};

/**
 * Émet `season_window` quand la fenêtre saisonnière change. Sans effet si la
 * même fenêtre a déjà été signalée, ou si OneSignal est éteint.
 */
export function trackSeasonWindow(nudge: SeasonWindowEvent | null): void {
  if (!OneSignal || !initialized || !currentUserId || !nudge) return;
  // Le mois fait partie de l'empreinte : la même espèce peut rouvrir une
  // fenêtre le mois suivant (elle arrive, puis elle culmine), et ce sont deux
  // messages différents.
  const date = new Date();
  const empreinte = `${nudge.scientificName}:${nudge.kind}`;
  const cle = `${DERNIERE_FENETRE}:${currentUserId}:${date.getFullYear()}:${date.getMonth()}:${empreinte}`;
  if (journal.getBoolean(cle)) return;
  OneSignal.User.trackEvent('season_window', {
    body: nudge.body,
    kind: nudge.kind,
    locale: nudge.locale,
    species: nudge.scientificName,
    title: nudge.title,
  });
  journal.set(cle, true);
  if (__DEV__) console.log(`[os] event season_window ${nudge.kind}`);
}

// La Live Activity d'expédition a été écrite puis mise de côté :
// `targets/_live-activity-en-attente/` en garde le Swift et le journal des
// impasses. `setupDefault()` reste appelé plus haut — sans widget il ne fait
// rien, et il sera nécessaire le jour où celui-ci compilera.

/**
 * DÉMARRE LA LIVE ACTIVITY DEPUIS L'APP.
 *
 * POURQUOI ELLE EXISTE À CÔTÉ DU PUSH-TO-START
 *
 * `setupDefault` enregistre un jeton qui laisse le SERVEUR créer l'activité,
 * app fermée. C'est la voie noble, et elle demande iOS 17.2. Mais elle dépend
 * d'un jeton qu'iOS n'émet que si l'utilisateur n'a pas coupé les Activités en
 * direct dans les réglages — et rien, côté serveur, ne distingue « coupé » de
 * « cassé » : les deux rendent zéro destinataire.
 *
 * `startDefault` ne dépend d'aucun jeton : l'app crée l'activité elle-même, au
 * premier plan, dès iOS 16.1. C'est le chemin normal d'une expédition — on
 * appuie sur « démarrer » et l'app est ouverte à cet instant.
 *
 * LES CLÉS SONT UN CONTRAT AVEC LE WIDGET. `startedAt`, `title`,
 * `speciesCount`, `newSpeciesCount`, `lastSpecies` sont lues telles quelles
 * dans `targets/widget/ExpeditionActivity.swift`. Renommer d'un côté sans
 * l'autre n'échoue pas à la compilation : ça affiche des zéros.
 */
const startedSafaris = new Set<string>();

export function startSafariActivity(run: import('../../supabase/functions/_shared/safari').SafariRun, userId: string): void {
  if (process.env.EXPO_OS !== 'ios' || !OneSignal || !initialized || !liveActivitiesEnabled() || run.status !== 'active') return;
  const id = `safari-${run.id}-${userId}`;
  if (startedSafaris.has(id)) return;
  const found = run.targets.filter(target => target.foundAt);
  try {
    OneSignal.LiveActivities.startDefault(id,
    { startedAt: Math.floor(new Date(run.startedAt).getTime() / 1000), title: run.title,
      endsAt: Math.floor(new Date(run.expiresAt).getTime() / 1000), safari: true },
    { speciesCount: found.length, newSpeciesCount: 0, targetCount: run.targets.length,
      nextTarget: run.targets.find(target => !target.foundAt)?.label ?? '', lastSpecies: '', teamSize: run.members.length });
    startedSafaris.add(id);
    OneSignal.User.trackEvent('safari_started', { mode: run.mode, target_count: run.targets.length, team_size: run.members.length });
  } catch (error) {
    // Native delivery is optional: never make a successful server-side join look like a failure.
    console.warn('[onesignal] Safari Live Activity unavailable', error);
  }
}

export function startExpeditionActivity(id: string, titre: string): void {
  if (!OneSignal || !initialized) return;
  // LE REFUS SE VÉRIFIE ICI, PAS À L'APPEL.
  //
  // C'est le seul endroit qui crée une activité : le garde y est donc
  // impossible à contourner, et un futur appelant ne peut pas oublier de le
  // poser. Le réglage système d'iOS ne suffit pas — le joueur doit pouvoir
  // couper DANS l'app ce que l'app a proposé.
  if (!liveActivitiesEnabled()) return;
  OneSignal.LiveActivities.startDefault(
    id,
    // `startedAt` en secondes Unix : le widget en fait une `Date` et laisse iOS
    // rendre le chronomètre. Aucun push n'est nécessaire pour qu'il avance.
    { startedAt: Math.floor(Date.now() / 1000), title: titre },
    { speciesCount: 0, newSpeciesCount: 0, lastSpecies: '' },
  );
}

/** Close this device's activities offline, without ending the team's outing. */
export function dismissLiveActivities(): void {
  try {
    endLocalLiveActivities();
    startedSafaris.clear();
  } catch (error) {
    console.warn('[onesignal] Local Live Activity dismissal unavailable:', String(error));
  }
}

export function stopLiveActivities(): void {
  dismissLiveActivities();
  if (!OneSignal || !initialized) return;
  OneSignal.LiveActivities.removePushToStartToken('DefaultLiveActivityAttributes');
}

/** Le refus doit survivre au redémarrage ; une réactivation réarme le SDK. */
export function syncLiveActivityPreference(): void {
  if (!OneSignal || !initialized || currentUserId === undefined) return;
  const enabled = liveActivitiesEnabled() && Boolean(currentUserId);
  OneSignal.LiveActivities.setupDefault({ enablePushToStart: enabled, enablePushToUpdate: true });
  if (!enabled) stopLiveActivities();
}

/**
 * TERMINE LA LIVE ACTIVITY D'UNE EXPÉDITION, PAR LE SERVEUR.
 *
 * Le SDK JavaScript ne sait pas le faire — pas d'`endDefault`, et `exit` est
 * marqué « Currently unsupported ». La fonction `live-activity` s'en charge
 * avec la clé d'API, qui n'a rien à faire dans le bundle.
 *
 * SILENCIEUX PAR CONSTRUCTION. Une carte qui traîne sur l'écran verrouillé est
 * un désagrément ; empêcher la fin d'une sortie serait une perte de données.
 * L'appel ne rend donc jamais d'erreur au flux appelant.
 */
export async function fermerLiveActivity(expeditionId: string): Promise<void> {
  const { supabase } = await import('@/lib/supabase/client');
  await supabase.functions
    .invoke('live-activity', { body: { event: 'end', expeditionId } })
    .catch((error: unknown) => {
      if (__DEV__) console.log('[onesignal] fin de Live Activity impossible :', String(error));
    });
}

/**
 * CE QUE LA NOTIFICATION A RÉELLEMENT PRODUIT.
 *
 * POURQUOI CE N'EST PAS DE L'ANALYTIQUE DE PLUS
 *
 * Un taux d'ouverture ne dit pas si un message a servi à quelqu'un. Ici, la
 * seule question qui compte est : le joueur est-il SORTI photographier ? Une
 * capture qui suit un rappel saisonnier prouve que le message était juste ;
 * cent ouvertures sans capture prouvent l'inverse, et il faut alors se taire.
 *
 * OneSignal attribue automatiquement l'outcome à la notification reçue dans
 * la fenêtre d'attribution en cours. On n'a donc rien à corréler nous-mêmes —
 * il suffit de nommer l'événement au bon moment.
 *
 * `addUniqueOutcome` PLUTÔT QUE `addOutcome` POUR LA CAPTURE : un joueur qui
 * en fait douze après un rappel ne prouve pas douze fois que le rappel
 * marchait. Compter une fois par notification garde la mesure honnête et la
 * rend comparable d'une campagne à l'autre.
 *
 * LA VALEUR, ELLE, SE CUMULE. `addOutcomeWithValue` porte la rareté de la
 * carte obtenue : deux rappels qui ramènent autant de joueurs ne se valent pas
 * si l'un fait naître des cartes communes et l'autre des légendaires.
 */
export function trackCaptureOutcome(rarityScore: number): void {
  // AVANT le garde : la boucle de silence est locale et doit tourner même
  // quand OneSignal est éteint. Sinon un joueur qui le réactive repartirait
  // avec des compteurs figés au jour où il l'avait coupé.
  noterCaptureApresRappel();
  if (!OneSignal || !initialized) return;
  OneSignal.Session.addUniqueOutcome('capture_after_message');
  if (rarityScore > 0) OneSignal.Session.addOutcomeWithValue('capture_rarity', rarityScore);
}

/** Le joueur a rouvert l'app depuis un message. Cumulatif : chaque retour compte. */
export function trackReturnOutcome(): void {
  if (!OneSignal || !initialized) return;
  OneSignal.Session.addOutcome('returned_from_message');
}

/**
 * LES DÉCLENCHEURS DES MESSAGES DANS L'APP.
 *
 * POURQUOI DES DÉCLENCHEURS PLUTÔT QUE DES ÉCRANS
 *
 * Un message qui arrive PENDANT qu'on joue n'a pas les mêmes règles qu'une
 * notification : il ne dérange pas, il n'a pas à ramener quelqu'un, et il peut
 * donc se permettre d'être rare et précis. Le bon usage n'est pas la promo,
 * c'est de dire ce que l'écran ne montre pas — « il te manque UNE espèce pour
 * ce groupe » n'est visible nulle part dans l'app.
 *
 * LES DÉCLENCHEURS SONT DES FAITS, PAS DES INTENTIONS. On pose « voici où en
 * est ce joueur » ; c'est le tableau de bord qui décide s'il y a quelque chose
 * à en dire. Coder la décision ici obligerait à livrer une version de l'app
 * pour changer d'avis sur un message.
 *
 * ILS SONT ÉPHÉMÈRES. Contrairement aux tags, ils ne quittent jamais
 * l'appareil et disparaissent à la fermeture — c'est ce qui les rend adaptés à
 * un état de session (« vient de rater une identification ») qu'on ne veut pas
 * voir figé dans un profil serveur.
 */
export function setInAppTriggers(triggers: Record<string, string>): void {
  if (!OneSignal || !initialized) return;
  OneSignal.InAppMessages.addTriggers(triggers);
}

export function clearInAppTrigger(key: string): void {
  if (!OneSignal || !initialized) return;
  OneSignal.InAppMessages.removeTrigger(key);
}

/** Consent is distinct from push; late requests cannot subscribe another account. */
export function syncEmailSubscription(userId: string, email: string | null | undefined, consent: boolean): void {
  if (!OneSignal || !initialized || !email || currentUserId !== userId) return;
  if (consent) OneSignal.User.addEmail(email);
  else OneSignal.User.removeEmail(email);
}
