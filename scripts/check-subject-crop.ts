// La géométrie du recadrage d'identification, vérifiée sans Skia ni fichier.
//
// `cropRect` décide de ce que BioCLIP voit. Trois façons de se tromper, et
// chacune coûte des identifications :
//
//   - recadrer sur une poussière, et fabriquer une espèce très confiante à
//     partir d'un grain de capteur ;
//   - recadrer alors que l'animal remplit déjà le cadre, et jeter le contexte
//     qui aidait le modèle ;
//   - déborder de l'image, et demander à Skia des pixels qui n'existent pas.
//
// Les trois sont ici.

import { cropRect, type SubjectCrop } from '../src/lib/animals/subject-crop';

let echecs = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`✓ ${message}`);
  else {
    console.error(`✗ ${message}`);
    echecs += 1;
  }
}

const W = 1600;
const H = 1200;
/** Un oiseau au centre, 20 % × 25 % du cadre. */
const oiseau: SubjectCrop = { x: 0.4, y: 0.375, width: 0.2, height: 0.25 };

const boite = cropRect(oiseau, W, H);
assert(boite !== null, 'un sujet de taille normale est recadré');
if (boite) {
  // Marge de 15 % de la BOÎTE : 0.2 × 0.15 = 0.03 de large de chaque côté.
  assert(boite.x === Math.round((0.4 - 0.03) * W), 'la marge horizontale vaut 15 % de la largeur du sujet');
  assert(boite.y === Math.round((0.375 - 0.0375) * H), 'la marge verticale vaut 15 % de la hauteur du sujet');
  assert(boite.width === Math.round(0.26 * W), 'la largeur retenue est le sujet plus deux marges');
  assert(
    boite.x >= 0 && boite.y >= 0 && boite.x + boite.width <= W && boite.y + boite.height <= H,
    'le rectangle reste dans l’image',
  );
}

// Un sujet collé au bord : la marge est rognée, jamais négative — Skia
// dessinerait n’importe quoi avec une origine hors cadre.
const auBord = cropRect({ x: 0, y: 0, width: 0.3, height: 0.3 }, W, H);
assert(auBord !== null && auBord.x === 0 && auBord.y === 0, 'un sujet au bord ne produit pas d’origine négative');

const aDroite = cropRect({ x: 0.7, y: 0.7, width: 0.3, height: 0.3 }, W, H);
assert(
  aDroite !== null && aDroite.x + aDroite.width === W && aDroite.y + aDroite.height === H,
  'un sujet au coin opposé ne dépasse pas non plus',
);

// Déjà plein cadre : recadrer ne gagnerait rien et coûterait du contexte.
assert(cropRect({ x: 0.02, y: 0.02, width: 0.96, height: 0.96 }, W, H) === null, 'un sujet plein cadre n’est pas recadré');

// Une poussière : ne JAMAIS zoomer dessus.
assert(cropRect({ x: 0.5, y: 0.5, width: 0.02, height: 0.02 }, W, H) === null, 'une tache minuscule n’est pas recadrée');

// Le masque peut rendre n'importe quoi si Vision échoue à mi-chemin.
assert(cropRect({ x: 0.5, y: 0.5, width: 0, height: 0.2 }, W, H) === null, 'une boîte de largeur nulle est refusée');
assert(cropRect({ x: 0, y: 0, width: Number.NaN, height: 0.2 }, W, H) === null, 'une boîte NaN est refusée');

console.log(`\nRecadrage sujet : marge proportionnelle, bornes respectées, extrêmes refusés.`);
if (echecs > 0) process.exit(1);
