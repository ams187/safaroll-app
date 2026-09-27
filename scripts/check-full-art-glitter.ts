// Un traitement full art doit SCINTILLER, pas seulement s'appeler full art.
//
// POURQUOI CE FICHIER EXISTE
//
// `special-illustration` a passé la liste des effets légendaires pendant des
// semaines en ne dessinant presque rien. Ses trois couches de paillettes
// n'avaient pas été portées — la CSS les masque par `var(--mask)`, une carte
// SafaRoll n'a pas de masque, et le port avait conclu qu'il n'y avait rien à
// faire. Ce qui restait, deux faisceaux `#000 → #797979 → #000` composés en
// `colorDodge`, est invisible sur une carte claire : colorDodge d'une source
// noire ne change rien.
//
// Résultat vu par un joueur : un panda géant LÉGENDAIRE rendait plus terne
// qu'un moineau commun. Aucune assertion ne s'en apercevait, parce que le nom
// de l'effet était bien dans la bonne liste. Une liste de noms ne dit pas ce
// qu'un fichier dessine.
//
// CE QUE CE CHECK VÉRIFIE
//
// Que chaque effet légendaire touche la planche de paillettes. C'est grossier
// — ça lit la source au lieu de rendre l'image — mais ça retient exactement la
// panne qui s'est produite, et ça ne coûte rien.
//
// Run: bun run check:full-art

import { readdirSync, readFileSync } from 'node:fs';

import { EFFECT_POOLS } from '../src/components/cards/card-identity';

/** Les traitements dont l'éclat vient de la planche de paillettes.
 *
 *  La liste ne se déduit plus du palier légendaire : celui-ci porte maintenant
 *  `cosmos-holo`, qui tire son effet d'une autre texture. Ce qui reste vrai,
 *  c'est que ces quatre-là DOIVENT toucher la planche — c'est d'elle que vient
 *  tout leur scintillement, et `special-illustration` a prouvé qu'un effet peut
 *  passer une liste de noms en ne dessinant rien. */
const FULL_ART_EFFECTS = ['rainbow-holo', 'rainbow-alt', 'amazing-rare', 'gallery-secret'];
const GLITTER = 'textureImages.glitter';
const DIR = 'src/components/cards/fx/effects';

// Tout effet nommé dans un pool doit exister sur le disque. La liste de noms
// que ce check remplace était tenue à la main dans `check-card-rarity.ts` et
// avait fini par ignorer cinq effets pourtant portés depuis le début.
const ported = new Set(
  readdirSync(DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => name.replace('.tsx', '')),
);
const missing = [...new Set(Object.values(EFFECT_POOLS).flat())].filter((key) => !ported.has(key));
if (missing.length > 0) {
  console.error(`check-full-art-glitter: effets nommés mais absents du port — ${missing.join(', ')}`);
  process.exit(1);
}

const flat: string[] = [];
for (const key of FULL_ART_EFFECTS) {
  const path = `${DIR}/${key}.tsx`;
  const source = readFileSync(path, 'utf8');
  if (!source.includes(GLITTER)) flat.push(key);
}

if (flat.length > 0) {
  console.error(
    `check-full-art-glitter: ${flat.join(', ')} — annoncé full art mais ne dessine aucune`
    + ' paillette. La carte rendra plate.',
  );
  process.exit(1);
}

console.log(
  `check-full-art-glitter: ${ported.size} effets portés, ${FULL_ART_EFFECTS.length} légendaires scintillent.`,
);
