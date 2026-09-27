// CONFIGURATION DISTANTE ET PREUVES D'ENVOI — PAS UN TEST SUR APPAREIL.
//
// POURQUOI CE SCRIPT EXISTE À CÔTÉ DES GARDE-FOUS
//
// `check-onesignal` lit le code : il attrape une régression à l'écriture. Il ne
// dit rien de l'état RÉEL du compte OneSignal — une Journey repassée en
// brouillon, un segment supprimé, un secret rotationné à moitié, une fonction
// non déployée. Trois de ces quatre pannes sont arrivées pendant la
// construction, et aucune n'était visible dans le dépôt.
//
// Celui-ci interroge le service. Il ne modifie rien et n'envoie aucun message :
// on peut le lancer devant quelqu'un.
//
//   bun --env-file=.env.local scripts/verify-onesignal-live.ts
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
if (!APP) {
  console.error('EXPO_PUBLIC_ONESIGNAL_APP_ID absente — lance avec --env-file=.env.local');
  process.exit(1);
}
// La clé reste hors du dépôt : elle autorise l'envoi à TOUS les joueurs.
let cle: string;
try {
  cle = readFileSync(join(homedir(), '.onesignal-key'), 'utf8').trim();
} catch {
  console.error('~/.onesignal-key introuvable — la clé d’API OneSignal doit y vivre, jamais dans le dépôt.');
  process.exit(1);
}

const entete = { Authorization: `Key ${cle}` };
const lire = async (chemin: string) => {
  const r = await fetch(`https://api.onesignal.com${chemin}`, { headers: entete });
  return r.ok ? await r.json() : null;
};

let manques = 0;
const exige = (condition: unknown, quoi: string, detail = '') => {
  console.log(`  ${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
  if (!condition) manques += 1;
};

console.log('\nJOURNEYS');
const journeys = (await lire(`/apps/${APP}/journeys`))?.journeys ?? [];
const actives = journeys.filter((j: { state: string }) => j.state === 'active');
// Exclusions de pertinence, pas un compteur global d'envois.
const exclusions: Record<string, string[]> = {
  'd436cb62-2203-4dc4-98fd-3b03284588dd': ['0a408411-dcbb-478a-95fa-0351d12ed296'],
  '0f8f10a1-e550-440e-9f34-e1c771190ca8': ['62f64b47-6e35-40b9-b6d7-82ee0df21755', 'b5c65500-14ce-4f52-a82d-12e8aec32363'],
  '88578f88-1a41-4407-b676-a8ab486af239': ['62f64b47-6e35-40b9-b6d7-82ee0df21755'],
  '44637d23-7e21-4521-876f-595d2ac84c52': ['62f64b47-6e35-40b9-b6d7-82ee0df21755', 'b792bde6-6829-4768-adba-ba9aee53f388', 'b5c65500-14ce-4f52-a82d-12e8aec32363'],
};
exige(actives.length >= 4, 'au moins quatre Journeys actives', `${actives.length} active(s) sur ${journeys.length}`);
for (const id of Object.keys(exclusions)) exige(actives.some((j: { id: string }) => j.id === id), `Journey de production ${id} active`);
for (const journey of actives) {
  const detail = await lire(`/apps/${APP}/journeys/${journey.id}`);
  const nodes = detail?.nodes ?? [];
  const pushes = nodes.filter((node: { kind: string }) => node.kind === 'send_push');
  exige(pushes.length === 1 && nodes.every((node: { kind: string }, index: number) => {
    if (node.kind !== 'send_push') return true;
    const gate = nodes[index - 1];
    return gate?.kind === 'time_window' && gate.use_user_time_zone === true &&
      gate.relative_to === 'schedule_in_timezone' && gate.windows?.length === 1 &&
      gate.windows[0].start.hour === 8 && gate.windows[0].end.hour === 21;
  }), `${journey.name} : fenêtre locale 8–21 h avant l'envoi`);
  exige(detail?.early_exit?.rules?.on_session === true, `${journey.name} : sortie au retour dans l'app`);
  exige(detail?.reentry_rules === null, `${journey.name} : aucune réinscription automatique`);
  if (detail?.audience?.kind === 'segment') {
    exige(detail?.early_exit?.rules?.when_not_in_audience === true, `${journey.name} : sortie si le ciblage devient invalide`);
  }
  if (exclusions[journey.id]) {
    exige(exclusions[journey.id].every(id => detail?.early_exit?.rules?.on_segment?.included_segment_ids?.includes(id)),
      `${journey.name} : exclusions de chevauchement et de péremption`);
  }
  // /notifications exclut les messages de Journey : consulter leurs propres
  // statistiques. Un passage « completed » n'est pas une preuve d'envoi.
  const stats = await lire(`/apps/${APP}/journeys/${journey.id}/stats`);
  for (const push of pushes) {
    const modele = await lire(`/templates/${push.template_id}?app_id=${APP}`);
    exige(modele?.content?.isIos === true && modele?.content?.isAndroid === true,
      `${journey.name} : plateformes mobiles explicitement activées dans le modèle`);
    const totals = stats?.nodes?.[push.id]?.message_stats?.totals;
    exige(Number.isInteger(totals?.sent) && totals.sent > 0,
      `${journey.name} : preuve historique d'envoi`,
      totals ? `${totals.sent} envoyé(s), ${totals.delivered} accepté(s) par APNs/FCM, ${totals.confirmed_delivered} réception(s) confirmée(s), ${totals.clicked} clic(s)` : 'statistiques indisponibles');
  }
}
// Une Journey en brouillon n'envoie RIEN. C'est la panne la plus coûteuse :
// tout paraît configuré, et rien ne part.
for (const j of journeys) {
  if (j.state !== 'active') console.log(`      ⚠ « ${j.name} » est en ${j.state} — elle n'enverra rien`);
}
exige(
  journeys.some((j: { audience?: { kind?: string } }) => j.audience?.kind === 'event_trigger'),
  'une Journey déclenchée par événement',
);

console.log('\nSEGMENTS');
const segments = (await lire(`/apps/${APP}/segments`))?.segments ?? [];
const miens = segments.filter((s: { name: string }) =>
  !/^(Total|Active|Inactive|Engaged|All )/.test(s.name));
exige(miens.length >= 4, 'les segments de ciblage existent', miens.map((s: { name: string }) => s.name).join(' · '));
for (const [id, hours] of [['0a408411-dcbb-478a-95fa-0351d12ed296', 48], ['b5c65500-14ce-4f52-a82d-12e8aec32363', 72]] as const) {
  const segment = await lire(`/apps/${APP}/segments/${id}?include-segment-detail=true`);
  const filters = segment?.payload?.filters;
  exige(filters?.length === 1 && filters[0].field === 'last_session' && filters[0].relation === '>' && Number(filters[0].hours_ago) === hours,
    `exclusion après ${hours} h d'inactivité`);
}

console.log('\nMODÈLES');
const modeles = (await lire(`/templates?app_id=${APP}&limit=30`))?.templates ?? [];
exige(modeles.length >= 4, 'les modèles de message existent', `${modeles.length} modèle(s)`);

console.log('\nIMAGES');
const supabase = process.env.EXPO_PUBLIC_SUPABASE_URL;
const planche = `${supabase}/storage/v1/object/public/notification-images/vulpes-vulpes.jpg`;
const image = await fetch(planche, { method: 'HEAD' }).catch(() => null);
// iOS n'accepte pas le WebP en pièce jointe : une planche servie dans le mauvais
// format arrive SANS image, sans la moindre erreur.
exige(image?.ok, 'les planches sont servies publiquement', image?.headers.get('content-type') ?? 'inaccessible');
exige(image?.headers.get('content-type') === 'image/jpeg', 'au format que iOS sait afficher');

console.log('\nFONCTIONS SERVEUR');
for (const nom of ['dawn-chorus', 'after-rain', 'monthly-recap', 'live-activity', 'safari', 'safari-live']) {
  // Sans secret : on attend 401. Un 404 signalerait une fonction non déployée,
  // un 200 une fonction ouverte à tous.
  const r = await fetch(`${supabase}/functions/v1/${nom}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  exige(r?.status === 401, `${nom} déployée et protégée`, `HTTP ${r?.status ?? 'injoignable'}`);
  if (['dawn-chorus', 'after-rain', 'monthly-recap'].includes(nom)) {
    const body = await r?.json().catch(() => null);
    // A gateway 401 (Missing authorization header) falsely passed the old
    // check even though secret-only cron calls could never reach the handler.
    exige(body?.error === 'Unauthorized', `${nom} : authentification du handler accessible au cron`);
  }
}

console.log(
  manques === 0
    ? '\nverify-onesignal-live: configuration distante accessible ; livraison sur appareil et parcours utilisateur à vérifier séparément.\n'
    : `\nverify-onesignal-live: ${manques} point(s) à reprendre.\n`,
);
process.exit(manques === 0 ? 0 : 1);
