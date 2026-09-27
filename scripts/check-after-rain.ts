// APRÈS LA PLUIE, VÉRIFIÉ.
//
// Cette fonction décide d'envoyer d'après une météo. Une erreur ne plante pas :
// elle notifie tous les matins parce que le seuil est trop bas, ou jamais parce
// qu'il est trop haut. Les deux sont invisibles au développeur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recentRainfall } from '../supabase/functions/after-rain/rainfall';

const RACINE = join(import.meta.dirname, '..');
const source = readFileSync(join(RACINE, 'supabase/functions/after-rain/index.ts'), 'utf8');

// 1. LE SEUIL A UN SENS PHYSIQUE. Sous deux millimètres, le sol sèche avant le
//    matin : la fenêtre n'existe pas et la notification serait fausse.
const seuil = Number(source.match(/const PLUIE_MM = ([\d.]+)/)?.[1]);
assert(seuil >= 1, `seuil a ${seuil} mm : une bruine declencherait une notification`);
assert(seuil <= 10, `seuil a ${seuil} mm : seul un orage passerait, la fonction ne servirait jamais`);

// 2. ON NE REGARDE QUE LA NUIT ÉCOULÉE. Prendre les 24 h ferait compter la
//    pluie de la veille au matin, déjà évaporée.
const now = Date.parse('2026-09-08T08:15:00Z');
const time = Array.from({ length: 48 }, (_, i) => new Date(Date.parse('2026-09-07T00:00:00Z') + i * 3_600_000).toISOString().slice(0, 16));
const precipitation = time.map(t => t === '2026-09-08T06:00' ? 3 : 0);
assert.equal(recentRainfall({ time, precipitation }, now), 3);
assert.equal(recentRainfall({ time, precipitation: time.map(t => t === '2026-09-07T14:00' || t === '2026-09-08T09:00' ? 100 : 0) }, now), 0, 'Exclude old rain and future forecasts');
assert.equal(recentRainfall({ time, precipitation: precipitation.map((r, i) => time[i] === '2026-09-08T06:00' ? null : r) }, now), null);
assert.equal(recentRainfall({ time: [], precipitation: [] }, now), null);
assert.equal(recentRainfall({ time, precipitation: [] }, now), null);

// 3. LES GROUPES SONT CEUX QUE LA PLUIE FAIT SORTIR. Envoyer pour des oiseaux
//    après la pluie serait faux — c'est l'aube qui les concerne, pas l'humidité.
assert(
  /GROUPES = \['amphibiens', 'mollusques'\]/.test(source),
  'les groupes ne correspondent plus a ce que la pluie fait sortir',
);

// 4. L'IDEMPOTENCE VIENT DE LA GÉOMÉTRIE, comme pour l'aube : créneau = période
//    du cron, donc un joueur ne peut y tomber qu'une fois par jour.
const creneau = Number(source.match(/const CRENEAU_MIN = (\d+)/)?.[1]);
assert(creneau === 60, `creneau a ${creneau} min : il doit egaler la periode du cron (1 h)`);

// 5. LE MATIN, PAS LA NUIT. Personne ne sort sous l'averse ; le sol reste
//    humide quelques heures.
// L'heure est SOLAIRE, pas légale : en France elle tombe deux heures plus tard
// en été. La borne haute en tient compte — au-delà de 9 h solaires, on
// notifierait à midi passé, quand le sol a séché.
const heure = Number(source.match(/const HEURE_ENVOI = (\d+)/)?.[1]);
assert(heure >= 7 && heure <= 9, `envoi a ${heure} h solaires : trop tard une fois converti en heure legale`);

// 6. LE MESSAGE ENTRE DANS LA BOUCLE DE SILENCE.
assert(/kind: 'peak'/.test(source), "le message n'est plus typé : la boucle de silence ne pourrait pas le couper");

// 7. LA MÉTÉO SE PARTAGE ENTRE VOISINS.
//
// Un appel par joueur, c'est un appel par joueur : à mille inscrits, mille
// requêtes horaires pour une information qu'ils partagent. La pluie ne s'arrête
// pas à la rue d'à côté, et Open-Meteo finirait par refuser.
assert(
  /meteoConnue\.get\(cle\)/.test(source),
  'la meteo n est plus mutualisee : un appel par joueur, chaque heure',
);
// L'arrondi doit rester à l'échelle d'une averse. Trop fin, la mutualisation
// ne sert à rien ; trop grossier, on annonce la pluie d'une autre région.
assert(
  /Math\.round\(lat \* 4\) \/ 4/.test(source),
  'la grille meteo a change de maille : verifier qu elle reste a l echelle d une averse',
);

console.log('check-after-rain: ok (seuil physique, nuit écoulée, groupes justes, créneau = cron, envoi le matin, boucle de silence, météo mutualisée)');
