// Rattrape les détourages produits AVANT le vignettage.
//
// POURQUOI
//
// Depuis `use-create-capture.ts`, chaque capture téléverse deux tailles :
// le détourage entier (1400 px) et sa vignette (384 px). Les captures
// antérieures n'ont que la première.
//
// Sans vignette, la grille retombe sur le détourage entier — l'affichage est
// correct, mais le téléphone déplie 7,8 Mo de pixels au lieu de 0,6, pour une
// image montrée à 287 px.
//
// CE QU'IL FAIT
//
// Pour chaque détourage sans vignette : télécharge, réduit à 384 px, renvoie au
// chemin déduit (`<nom>-thumb.webp`, la même règle que le client). Rien d'autre
// n'est touché — ni la base, ni les originaux.
//
// REPRENABLE
//
// Il liste d'abord ce qui existe déjà et ne traite que le manquant. Un fichier
// illisible est mis de côté et n'arrête pas les autres. On peut le relancer
// autant de fois qu'on veut.
//
//   bun scripts/backfill-sticker-thumbs.ts            # ce qui serait fait
//   SUPABASE_SECRET_KEY=… bun scripts/backfill-sticker-thumbs.ts --ecrire
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

/** La même largeur que `STICKER_THUMB_EDGE` côté client. */
const LARGEUR = 384;
const QUALITE = 92;
const BUCKET = 'capture-stickers';
const LOT = 8;

/** La règle de nommage du client (`stickerThumbPath`), rejouée ici. */
function cheminVignette(chemin: string) {
  return chemin.replace(/(\.[a-z0-9]+)$/i, '-thumb$1');
}

const ecrire = process.argv.includes('--ecrire');
const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  throw new Error(
    'Il manque SUPABASE_SECRET_KEY (Dashboard → Project Settings → API Keys → service_role).',
  );
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Tous les objets du bucket, paginés — `list` plafonne à 100 par défaut. */
async function listerTout(prefixe: string) {
  const noms: string[] = [];
  for (let page = 0; page < 500; page += 1) {
    const { data, error } = await db.storage
      .from(BUCKET)
      .list(prefixe, { limit: 1000, offset: page * 1000 });
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const item of data) noms.push(prefixe ? `${prefixe}/${item.name}` : item.name);
    if (data.length < 1000) break;
  }
  return noms;
}

// Les détourages vivent sous `<userId>/…`, donc on parcourt les dossiers.
const { data: dossiers, error } = await db.storage.from(BUCKET).list('', { limit: 1000 });
if (error) throw new Error(error.message);

const tous: string[] = [];
for (const dossier of dossiers ?? []) {
  // Un dossier n'a pas de métadonnées ; un fichier posé à la racine en a.
  if (dossier.id) tous.push(dossier.name);
  else tous.push(...(await listerTout(dossier.name)));
}

const vignettes = new Set(tous.filter((nom) => nom.includes('-thumb.')));
const originaux = tous.filter((nom) => !nom.includes('-thumb.'));
const manquants = originaux.filter((nom) => !vignettes.has(cheminVignette(nom)));

console.log(`${originaux.length} détourages, ${vignettes.size} vignettes déjà là`);
console.log(`${manquants.length} à produire`);

if (!manquants.length) {
  console.log('Rien à faire.');
  process.exit(0);
}
if (!ecrire) {
  console.log('\nSimulation. Relance avec --ecrire pour produire et téléverser.');
  process.exit(0);
}

let faites = 0;
let octets = 0;
const echecs: string[] = [];

for (let index = 0; index < manquants.length; index += LOT) {
  await Promise.all(
    manquants.slice(index, index + LOT).map(async (nom) => {
      try {
        const { data, error: erreurTelechargement } = await db.storage.from(BUCKET).download(nom);
        if (erreurTelechargement) throw new Error(erreurTelechargement.message);
        const source = Buffer.from(await data.arrayBuffer());
        const vignette = await sharp(source)
          .resize(LARGEUR, LARGEUR, { fit: 'inside', withoutEnlargement: true })
          // L'alpha est ce qui fait le détourage : sans lui, l'animal arrive sur
          // un carré opaque au milieu de la carte.
          .webp({ alphaQuality: 100, quality: QUALITE })
          .toBuffer();
        const { error: erreurEnvoi } = await db.storage
          .from(BUCKET)
          .upload(cheminVignette(nom), vignette, {
            cacheControl: '31536000',
            contentType: 'image/webp',
            upsert: true,
          });
        if (erreurEnvoi) throw new Error(erreurEnvoi.message);
        octets += vignette.byteLength;
        faites += 1;
      } catch (raison) {
        echecs.push(`${nom}: ${raison instanceof Error ? raison.message : raison}`);
      }
    }),
  );
  console.log(`${Math.min(index + LOT, manquants.length)}/${manquants.length}`);
}

console.log(`\n${faites} vignettes téléversées, ${(octets / 1e6).toFixed(1)} Mo`);
if (echecs.length) {
  console.log(`${echecs.length} échecs :`);
  for (const echec of echecs.slice(0, 10)) console.log(`  ${echec}`);
  console.log('Relance le script : il reprend là où il en est.');
}
