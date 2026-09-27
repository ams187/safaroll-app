// UN SEUL ÉMETTEUR PAR MESSAGE, UN SEUL INTERRUPTEUR.
//
// Trois régressions muettes possibles, aucune ne se voit à la relecture :
//
//   1. un rappel planifié DEUX fois — la Journey OneSignal ET la
//      planification locale. Le joueur reçoit le même message en double,
//      et c'est la pire chose qu'une démo puisse montrer ;
//   2. le toggle du profil coupe le local mais pas le push serveur — le
//      joueur qui vient de dire non continue de recevoir des rappels ;
//   3. `onesignal-expo-plugin` glisse hors de la première position du
//      tableau `plugins` — le prebuild casse avec des erreurs de headers
//      qui ne désignent jamais la cause (exigence documentée du plugin).
//
// Run: bun run check:onesignal
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-onesignal: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf8');

// 1. Chaque rappel « joueur absent » s'efface quand OneSignal est actif.
const notifications = lire('src/lib/notifications.ts');
for (const porteur of ['scheduleSeasonNudge', 'scheduleObjectiveReminder']) {
  const corps = notifications.slice(notifications.indexOf(`function ${porteur}`));
  const garde = corps.indexOf('remoteNudgesActive');
  const planif = corps.indexOf('scheduleNotificationAsync');
  assert(
    garde !== -1 && planif !== -1 && garde < planif,
    `${porteur} planifie en local sans s'effacer derrière OneSignal — le joueur recevrait le message en double`,
  );
}
// … mais le palier d'atlas reste local : il célèbre un joueur présent.
const atlas = notifications.slice(notifications.indexOf('function notifyAtlasMilestone'));
assert(
  !atlas.slice(0, atlas.indexOf('scheduleNotificationAsync')).includes('remoteNudgesActive'),
  'notifyAtlasMilestone est passé derrière OneSignal — la célébration immédiate doit rester locale',
);

// 2. Les deux chemins d'activation et la coupure pilotent le push serveur.
assert(
  /store\.set\(ENABLED, granted\);\s*\n\s*emit\(\);[\s\S]{0,200}setOneSignalPushEnabled\(granted\)/.test(notifications),
  "ensureNotificationPermission n'aligne plus l'abonnement OneSignal sur le droit système",
);
assert(
  /store\.set\(ENABLED, false\);[\s\S]{0,300}setOneSignalPushEnabled\(false\)/.test(notifications),
  'couper les notifications ne coupe plus le push serveur — le joueur qui a dit non serait encore rappelé',
);

// 3. Le plugin reste premier. On compare sa position à celle de tous les
// autres plugins connus plutôt que de chercher « la première chaîne » : les
// apostrophes françaises des commentaires ressemblent à des quotes.
const config = lire('app.config.ts');
const plugins = config.slice(config.indexOf('plugins: ['));
const positionOneSignal = plugins.indexOf("'onesignal-expo-plugin'");
assert(positionOneSignal !== -1, 'onesignal-expo-plugin a disparu du tableau plugins');
for (const autre of ['./plugins/with-pods-uuid-collision-fix', 'expo-font', 'expo-notifications']) {
  const position = plugins.indexOf(`'${autre}'`);
  assert(
    position === -1 || positionOneSignal < position,
    `onesignal-expo-plugin doit précéder '${autre}' (exigence documentée : premier du tableau)`,
  );
}

// 4. L'abonnement de l'appareil s'arme À LA RACINE, jamais dans `(app)`.
// `(app)/_layout` ne monte que connecté : y initialiser OneSignal laisserait
// sans abonnement quiconque installe sans se connecter — la personne même
// qu'un rappel doit aller chercher.
const racineLayout = lire('src/app/_layout.tsx');
assert(
  racineLayout.includes('configureOneSignal()'),
  "configureOneSignal n'est plus appelé dans src/app/_layout.tsx : un joueur non connecté ne serait jamais abonné",
);
const appLayout = lire('src/app/(app)/_layout.tsx');
assert(
  !appLayout.includes('configureOneSignal'),
  "configureOneSignal est revenu dans (app)/_layout.tsx — il ne monte que connecté, l'abonnement doit rester à la racine",
);

// 5. Le module s'éteint proprement sans clé : rien ne doit toucher OneSignal
// avant le garde `initialized`, sinon le dev client sans rebuild crashe.
// On vérifie que CHAQUE fonction publique porte sa garde, pas la forme d'une
// ligne : la première version de ce contrôle épinglait le texte exact du
// `return`, et a cassé au premier ajout de diagnostic — un garde-fou qui
// tombe sur du cosmétique apprend à être contourné.
const onesignal = lire('src/lib/onesignal.ts');
// Exécute le callback réel : seule la carte prête doit être masquée en avant-plan.
const foregroundHandler = onesignal.match(/addEventListener\('foregroundWillDisplay', \(event:[\s\S]*?\}\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert(foregroundHandler, 'Filtre des notifications de capture absent');
const handler = new Function('event', foregroundHandler!.replace(/ as \{ kind\?: unknown; url\?: unknown \} \| undefined/, ''));
for (const [data, expected] of [
  [{ kind: 'transactional', url: '/(app)/(tabs)/(home)' }, true],
  [{ kind: 'leaving', url: '/(app)/(tabs)/(home)' }, false],
  [{ kind: 'transactional', url: '/(app)/safari' }, false],
  [undefined, false],
] as const) {
  let prevented = false;
  handler({ getNotification: () => ({ additionalData: data }), preventDefault: () => { prevented = true; } });
  assert(prevented === expected, 'Le filtre masque la mauvaise notification');
}
for (const fonction of [
  'configureOneSignal',
  'oneSignalLogin',
  'setOneSignalPushEnabled',
  'syncEngagementTags',
  'observeOneSignalNavigation',
]) {
  const corps = onesignal.slice(onesignal.indexOf(`export function ${fonction}`));
  const premiereLigne = corps.slice(0, corps.indexOf('\n', corps.indexOf('{')) + 200);
  assert(
    /!OneSignal/.test(premiereLigne),
    `${fonction} ne vérifie plus que le module natif existe — le dev client sans rebuild planterait`,
  );
}

// 5 bis. `initialize` PRÉCÈDE tout écouteur. Posé avant, un écouteur n'est
// rattaché à aucun module natif et ne se déclenche jamais — en silence, ce
// qui se lit exactement comme « l'appareil ne s'abonne pas ». Bug réel,
// diagnostiqué sur appareil, pas hypothétique.
// On compare les positions DANS LE CORPS de `configureOneSignal`, pas dans le
// fichier : les écouteurs vivent dans `reportSubscriptionState`, définie plus
// bas, donc une comparaison à l'échelle du fichier passerait toujours — la
// première version de ce contrôle avait ce défaut et ne prouvait rien.
const corpsConfigure = onesignal.slice(
  onesignal.indexOf('export function configureOneSignal'),
  onesignal.indexOf('function reportSubscriptionState'),
);
const posInit = corpsConfigure.indexOf('OneSignal.initialize(APP_ID)');
assert(posInit !== -1, 'OneSignal.initialize a disparu de configureOneSignal');
for (const apres of ['reportSubscriptionState()', 'addEventListener']) {
  const position = corpsConfigure.indexOf(apres);
  assert(
    position === -1 || posInit < position,
    `\`${apres}\` s'exécute avant OneSignal.initialize — un écouteur posé avant le démarrage du module natif ne se déclenche jamais`,
  );
}

// 6. Toute écriture de tag date d'elle-même. Sans `tags_synced_at`, les
// Journeys ne peuvent plus distinguer une espèce urgente d'une espèce
// urgente il y a trois semaines — et citeraient une donnée périmée.
assert(
  /const additions: Record<string, string> = \{ tags_synced_at: String\(Date\.now\(\)\) \}/.test(onesignal),
  "syncEngagementTags n'horodate plus ses écritures : une Journey jugerait la fraîcheur sur une date fausse",
);

// 7. La fenêtre saisonnière passe par un ÉVÉNEMENT, jamais par un segment.
// Une Journey de segment n'admet pas la ré-entrée : le joueur déjà membre ne
// serait notifié que de sa PREMIÈRE espèce urgente, alors que la fenêtre
// change chaque mois — la promesse même du produit tomberait.
const nudgeHook = lire('src/lib/animals/use-season-nudge.ts');
assert(
  nudgeHook.includes('trackSeasonWindow('),
  "use-season-nudge n'émet plus season_window : la Journey saisonnière n'aurait aucun déclencheur",
);
// Et il n'est émis qu'au CHANGEMENT de fenêtre, pas à chaque ouverture d'app.
assert(
  /if \(journal\.getBoolean\(cle\)\) return;/.test(onesignal),
  'trackSeasonWindow ne déduplique plus : un push partirait à chaque ouverture de l app',
);

// 7. LA MESURE SE POSE À LA CARTE, PAS À L'OUVERTURE.
//
// `capture_after_message` est la seule preuve qu'un rappel a SERVI. Déplacé à
// l'ouverture de l'app, il compterait des curieux et conclurait que tout
// marche — le pire des mensonges, celui qui se lit comme un succès.
const strike = lire('src/components/cards/card-strike.tsx');
assert(
  strike.includes('trackCaptureOutcome('),
  "card-strike n'émet plus l'outcome de capture : la boucle de silence n'aurait plus de preuve",
);

// 8. LE TRANSACTIONNEL NE PEUT PAS ÊTRE RÉDUIT AU SILENCE.
//
// « Ta carte est prête » ne demande rien : il annonce ce que le joueur vient
// de déclencher. Le faire taire parce qu'aucune capture ne suit reviendrait à
// punir quelqu'un d'avoir regardé sa carte.
assert(
  /kind === 'leaving' \|\| kind === 'arriving' \|\| kind === 'peak'/.test(onesignal),
  'la boucle de silence ne filtre plus par type : elle pourrait couper le transactionnel',
);

// 9. L'E-MAIL SE RATTACHE APRÈS L'IDENTITÉ, JAMAIS AVANT.
//
// Posé sur un utilisateur anonyme, il crée un SECOND profil OneSignal — et le
// même joueur reçoit ensuite chaque message en double. Le défaut ne se voit
// qu'en production, sur un compte qui a survécu à une déconnexion.
const layout = lire('src/app/(app)/_layout.tsx');
const ordreLogin = layout.indexOf('oneSignalLogin(userId)');
const ordreEmail = layout.indexOf('syncEmailSubscription(userId, courriel, false)');
assert(
  ordreLogin !== -1 && ordreEmail !== -1 && ordreLogin < ordreEmail,
  "linkEmail passe avant oneSignalLogin : l'e-mail créerait un second profil",
);

// 10. AUCUN TOTAL D'ESPÈCES DANS LES MESSAGES SERVEUR.
//
// Même règle que `check-no-species-total`, appliquée aux fonctions : un bilan
// mensuel qui annonce « il t'en reste N » fige une borne qui n'existe pas.
const recap = lire('supabase/functions/monthly-recap/index.ts');
assert(
  !/\brest(e|ent|ant)\b[^.]{0,40}\d/.test(recap),
  'monthly-recap annonce un reste d espèces : le catalogue n est pas la taille du jeu',
);

// 11. LA PREMIÈRE MONDIALE S'EXCLUT ELLE-MÊME DU COMPTE.
//
// Sans `neq('id', captureId)`, la capture qui vient d'être écrite se compte
// comme sa propre prédécesseure : plus aucune première mondiale ne serait
// jamais annoncée, et personne ne s'en apercevrait — l'absence d'un message
// rare est invisible.
const identify = lire('supabase/functions/identify-animal/index.ts');
assert(
  /\.neq\('id', captureId\)/.test(identify),
  'estPremiereMondiale ne s exclut plus : aucune première ne serait jamais détectée',
);
// …et elle se tait en cas d'erreur plutôt que d'annoncer une fausse première.
assert(
  /if \(error\) return false;/.test(identify),
  'estPremiereMondiale annonce une première quand la requête échoue : une fausse dévalue toutes les vraies',
);

// 12. DÉMARRER ET METTRE À JOUR N'ONT PAS LE MÊME CHEMIN.
//
// Démarrage : `/activities/activity/{type}` — le TYPE de structure.
// Mise à jour : `/live_activities/{id}/notifications` — l'INSTANCE.
//
// Les confondre rend un 404 en page HTML, sans la moindre erreur JSON : rien
// dans la réponse ne dit que c'est une histoire de chemin, et l'activité reste
// simplement figée sur l'écran du joueur.
const liveActivity = lire('supabase/functions/live-activity/index.ts');
for (const [fichier, source] of [
  ['live-activity', liveActivity],
  ['identify-animal', identify],
] as const) {
  if (!/event: 'update'|event,/.test(source)) continue;
  assert(
    /live_activities\/[^`\n]*\/notifications/.test(source),
    `${fichier} met à jour une Live Activity par le chemin de DÉMARRAGE : 404 muet`,
  );
}

// 13. LE SILENCE COUPE L'ÉVÉNEMENT, PAS SEULEMENT LE CIBLAGE.
//
// La Journey saisonnière se déclenche sur l'ÉVÉNEMENT `season_window`. Un
// filtre de segment sur `nudge_muted` ne s'y applique pas : un joueur réduit
// au silence recevrait quand même le message, et la boucle entière serait
// décorative. On n'émet donc pas l'événement du tout.
assert(
  /typesMuets\(\)\.includes\(nudge\.kind\)/.test(nudgeHook),
  'use-season-nudge émet season_window sans consulter les types muets : la boucle de silence serait contournée',
);

// 14. UN SEUL MESSAGE DISCRÉTIONNAIRE PAR JOUR, TOUS MOTEURS CONFONDUS.
//
// Chaque moteur est sobre pour lui-même, mais rien ne les coordonnait. Un matin
// pluvieux de septembre où une espèce quitte la région, le même joueur recevait
// le chœur de l'aube, « après la pluie » ET la fenêtre saisonnière avant huit
// heures. Trois messages justes valent moins qu'un seul : on ne les lit pas
// comme trois informations, on les lit comme une app qui insiste.
for (const moteur of ['dawn-chorus', 'after-rain'] as const) {
  const source = lire(`supabase/functions/${moteur}/index.ts`);
  assert(
    /await reserverEnvoi\(admin, userId,/.test(source),
    `${moteur} envoie sans réserver le budget du jour : plusieurs moteurs pourraient parler le même matin`,
  );
  // La réservation vient APRÈS les filtres : on ne brûle pas la place du jour
  // pour quelqu'un à qui on n'aurait rien envoyé.
  const posReserve = source.indexOf('await reserverEnvoi');
  const posEnvoi = source.indexOf("fetch('https://api.onesignal.com/notifications'");
  assert(
    posReserve !== -1 && posReserve < posEnvoi,
    `${moteur} réserve après l'envoi : le budget ne servirait à rien`,
  );
}
// Le transactionnel n'y entre JAMAIS : « ta carte est prête » répond à une
// action du joueur. S'en taire serait une perte d'information, pas une
// politesse.
assert(
  !/reserverEnvoi/.test(identify),
  'identify-animal consomme le budget : une carte prête ne doit jamais être retenue',
);

// 15. LE CIBLAGE PASSE PAR LA VUE, PAS PAR UN BALAYAGE TRONQUÉ.
//
// Les moteurs lisaient les 2 000 dernières captures et en déduisaient tout en
// JavaScript. La limite TRONQUE : au-delà, les joueurs les moins actifs
// disparaissent de la liste et cessent d'être notifiés — sans erreur, sans
// trace, et d'autant plus sûrement que l'app grandit.
for (const moteur of ['dawn-chorus', 'after-rain'] as const) {
  const source = lire(`supabase/functions/${moteur}/index.ts`);
  assert(
    /from\('notification_targets'\)/.test(source),
    `${moteur} ne lit plus la vue de ciblage : le balayage tronqué priverait les joueurs peu actifs`,
  );
  assert(
    !/\.limit\(2000\)/.test(source),
    `${moteur} borne encore sa lecture à 2 000 lignes : le ciblage serait silencieusement incomplet`,
  );
  // La région suit le joueur. Une espèce annoncée là où elle n'existe pas est
  // pire qu'un silence.
  assert(
    /regionDe\.get\(userId\) \?\? 'FR'/.test(source),
    `${moteur} ignore la région du joueur : il annoncerait des espèces d'un autre pays`,
  );
}

// 16. UNE LIVE ACTIVITY SE FERME, ELLE N'EXPIRE PAS.
//
// `stale_date` GRISE la carte, il ne la retire pas : iOS la garde jusqu'à huit
// heures. Sans fin explicite, l'écran verrouillé accumule un matin après
// l'autre — et une activité qui traîne après son événement affiche une
// information périmée à l'endroit le plus visible du téléphone.
const aube = lire('supabase/functions/dawn-chorus/index.ts');
assert(
  /event: 'end'/.test(aube) && /dismissal_date/.test(aube),
  "dawn-chorus ne ferme plus la Live Activity de la veille : elles s'empileraient",
);

// 17. `event_updates` EST OBLIGATOIRE MÊME SUR UNE FIN.
//
// Contre-intuitif — on termine, il n'y a plus rien à afficher — et un objet
// vide se fait refuser par un « Missing required parameter » que le cron avale
// en silence. La fin échouerait à chaque exécution sans que rien ne le dise.
for (const [nom, source] of [['dawn-chorus', aube], ['live-activity', liveActivity]] as const) {
  if (!/event: 'end'|event,/.test(source)) continue;
  assert(
    !/event_updates: \{\}/.test(source),
    `${nom} envoie une fin avec event_updates vide : refusée en silence par OneSignal`,
  );
}

console.log(
  'check-onesignal: ok (émetteur unique, interrupteur unique, plugin premier, abonnement à la racine,\n' +
  '  tags horodatés, fenêtre par événement, outcome à la carte, transactionnel protégé,\n' +
  '  e-mail après identité, aucun total annoncé, première mondiale exacte, chemins Live Activity distincts, silence coupé à la source, budget météo/aube, ciblage par vue et par région ; livraison native à vérifier sur appareil)',
);
