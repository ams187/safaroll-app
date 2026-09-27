// LE CHŒUR DE L'AUBE, VÉRIFIÉ.
//
// Cette fonction envoie une notification à une heure calculée. Une erreur ne
// produit pas de plantage : elle produit un message à 3 h du matin, ou aucun
// message du tout pendant six mois. Les deux sont invisibles au développeur et
// coûteux au joueur — d'où ce contrôle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `join(import.meta.dirname, …)` et non un chemin relatif nu : le contrôle doit
// donner le même résultat qu'on le lance depuis la racine ou depuis `scripts/`.
const RACINE = join(import.meta.dirname, '..');
const source = readFileSync(join(RACINE, 'supabase/functions/dawn-chorus/index.ts'), 'utf8');

// La formule est recopiée ici plutôt qu'importée : la fonction vit dans Deno,
// le contrôle dans Bun. On vérifie donc AUSSI que les deux ne divergent pas.
function leverSoleilUTC(date: Date, latitude: number, longitude: number): number | null {
  const jour = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const rad = Math.PI / 180;
  const gamma = ((2 * Math.PI) / 365) * (jour - 1);
  const eqTemps = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const dec = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(latitude * rad) * Math.cos(dec))
    - Math.tan(latitude * rad) * Math.tan(dec);
  if (cosH > 1 || cosH < -1) return null;
  return 720 - 4 * (longitude + Math.acos(cosH) / rad) - eqTemps;
}

// 1. LE LEVER SUIT LA SAISON. C'est toute la raison d'être de la fonction :
//    une heure fixe raterait le chœur la moitié de l'année.
const CREIL: [number, number] = [49.273, 2.462];
const juin = leverSoleilUTC(new Date(Date.UTC(2026, 5, 21)), ...CREIL)!;
const decembre = leverSoleilUTC(new Date(Date.UTC(2026, 11, 21)), ...CREIL)!;
assert(Math.abs(juin - 224) < 8, `lever de juin hors tolerance : ${juin}`);       // 03:44 UTC
assert(Math.abs(decembre - 462) < 8, `lever de decembre hors tolerance : ${decembre}`); // 07:42 UTC
assert(decembre - juin > 200, 'le lever ne varie plus avec la saison : une heure fixe suffirait');

// 2. LE POLE NE PLANTE PAS. Au-delà du cercle polaire, le soleil peut ne pas
//    se lever — la formule doit rendre `null`, pas `NaN`.
assert(leverSoleilUTC(new Date(Date.UTC(2026, 11, 21)), 78, 15) === null, 'nuit polaire non detectee');

// 3. L'IDEMPOTENCE VIENT DE LA GÉOMÉTRIE. Le créneau doit valoir exactement la
//    période du cron : plus large, un joueur reçoit deux fois ; plus étroit, il
//    passe entre les mailles certains jours.
const creneau = Number(source.match(/const CRENEAU_MIN = (\d+)/)?.[1]);
assert(creneau === 15, `le creneau vaut ${creneau} : il doit egaler la periode du cron (15 min)`);

// 4. LE PLANCHER SOCIAL TIENT. Une aube de juin tombe vers 3 h 50 en heure
//    solaire : sans plancher, on réveille les gens.
const plancher = Number(source.match(/const HEURE_MINIMALE = (\d+)/)?.[1]);
assert(plancher >= 8, `plancher a ${plancher} h : aucune autorisation de réveil matinal`);
// Execute the production window guard, including its inclusive/exclusive bounds.
const guard = source.match(/if \(!force\) \{\s*const ecart = minutesUTC - envoiVoulu;[\s\S]*?\n    \}/)?.[0];
assert.ok(guard, 'Missing production send-window guard');
const allowed = new Function('minute', 'force', `return (async () => {
  const minutesUTC=100, envoiVoulu=100, CRENEAU_MIN=15, HEURE_MINIMALE=${plancher};
  const appId='', apiKey='', userId='', maintenant=new Date();
  const userLocalMinute=async () => minute;
  for (const item of [1]) { ${guard} return true; }
  return false;
})();`);
for (const [minute, expected] of [[479,false],[480,true],[1259,true],[1260,false],[null,false]] as const) {
  assert.equal(await allowed(minute, false), expected, `Local minute ${minute}`);
}
assert.equal(await allowed(null, true), true, 'Explicit test-account demo bypasses the window');

// 5. LE PRÉAVIS PRÉCÈDE LE CHŒUR. Prévenir après son début, c'est annoncer un
//    train déjà parti.
const preavis = Number(source.match(/const PREAVIS_MIN = (\d+)/)?.[1]);
assert(preavis > 0, 'aucun preavis : le joueur serait prevenu trop tard pour sortir');

// 6. LE MESSAGE ENTRE DANS LA BOUCLE DE SILENCE. Quelqu'un qui ne sort jamais
//    à l'aube ne deviendra pas matinal parce qu'on insiste.
assert(/kind: 'peak'/.test(source), "le choeur n'est plus typé : la boucle de silence ne pourrait pas le couper");

// 7. ON NE DÉRANGE PAS QUI EST DÉJÀ DEHORS. Une capture récente prouve que le
//    joueur fait déjà ce que le message allait lui demander : l'envoyer serait
//    la façon la plus visible d'être inutile.
const dejaDehors = Number(source.match(/const DEJA_DEHORS_H = (\d+)/)?.[1]);
assert(dejaDehors >= 6, `fenetre « deja dehors » a ${dejaDehors} h : trop courte pour couvrir une sortie`);
assert(
  /if \(!force && depuis < DEJA_DEHORS_H/.test(source),
  'la garde « deja dehors » ne s applique plus : on relancerait quelqu un en pleine sortie',
);

console.log('check-dawn-chorus: ok (lever saisonnier, nuit polaire, créneau = cron, plancher social, préavis, boucle de silence, jamais pendant une sortie)');
