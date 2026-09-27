// Les vignettes de planches — ce que la GRILLE affiche.
//
// LE DÉFAUT QU'ELLES CORRIGENT
//
// Une planche est servie en 768 × 1152. Dans la collection, une carte fait
// 114 pt, soit 342 px sur un écran 3× : la planche est 2,2× trop large, donc
// 5,4× trop lourde en pixels. Multiplié par les 45 cartes que la grille garde
// montées en permanence (`alwaysRender`, qui existe parce que LegendList
// relâche tout au scroll rapide), ça fait ~14 Mo de téléchargement et un
// décodage 5× plus cher que nécessaire, en boucle, pendant qu'on scrolle.
//
// `allowDownscaling` d'expo-image réduit bien le bitmap final, mais APRÈS avoir
// téléchargé et lu l'image entière. Le réseau, le disque et le décodage sont
// déjà payés.
//
// POURQUOI PRÉ-GÉNÉRER PLUTÔT QUE REDIMENSIONNER À LA VOLÉE
//
// Supabase sait le faire (`/render/image/public`) — mais c'est réservé au plan
// Pro, et l'endpoint répond 403 sur ce projet. Pré-générer coûte un script et
// ~190 Mo de bucket, contre 25 $/mois.
//
// C'est aussi la technique que Software Mansion a mesurée comme la plus
// efficace de toutes sur exactement ce problème (leur banc : 2 100 photos,
// pics mémoire de 1,53 Go sans elle).
//
// LA TAILLE N'EST PAS RONDE PAR HASARD
//
// Le plus grand iPhone (440 pt de large) donne une carte de 131 pt, soit 392 px
// en 3×. 448 couvre ce cas avec un peu de marge sans repartir vers le
// suréchantillonnage qu'on cherche justement à tuer.
//
//   bun scripts/build-card-thumbs.ts            # liste ce qui manque
//   SUPABASE_SECRET_KEY=… bun scripts/build-card-thumbs.ts --ecrire
import { createClient } from '@supabase/supabase-js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** Largeur de la vignette. La hauteur suit le ratio de la planche. */
const LARGEUR = 448;
const QUALITE = 80;
/** Le dossier du bucket. Même bucket que les planches, donc même politique
 *  publique — un second bucket demanderait de rejouer les permissions. */
const PREFIXE = 'thumb';
const BUCKET = 'card-scenes';
const LOT = 10;

const ecrire = process.argv.includes('--ecrire');
const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

const directory = join(process.cwd(), 'assets/cards/species');
const locales = readdirSync(directory).filter((name) => name.endsWith('.webp'));
console.log(`${locales.length} planches locales`);

if (!ecrire) {
  // Simulation : on mesure sur un échantillon plutôt que de tout encoder.
  let avant = 0;
  let apres = 0;
  const echantillon = locales.slice(0, 20);
  for (const name of echantillon) {
    const source = join(directory, name);
    avant += (await Bun.file(source).arrayBuffer()).byteLength;
    apres += (await sharp(source).resize(LARGEUR).webp({ quality: QUALITE }).toBuffer()).byteLength;
  }
  const ratio = avant / apres;
  console.log(`échantillon de ${echantillon.length} : ${(avant / 1024 / echantillon.length).toFixed(0)} Ko → ${(apres / 1024 / echantillon.length).toFixed(0)} Ko par planche (/${ratio.toFixed(1)})`);
  console.log(`projection sur ${locales.length} : ${(locales.length * (apres / echantillon.length) / 1e6).toFixed(0)} Mo de vignettes`);
  console.log('\nSimulation. Relance avec --ecrire (et SUPABASE_SECRET_KEY) pour générer et téléverser.');
  process.exit(0);
}

if (!url || !key) throw new Error('Il manque SUPABASE_URL ou SUPABASE_SECRET_KEY');
const db = createClient(url, key, { auth: { persistSession: false } });

/** Ce qui est DÉJÀ en ligne — le script se relance sans tout refaire.
 *  `list` plafonne à 100 par défaut, donc on pagine ; sans ça on croirait le
 *  bucket presque vide et on téléverserait 2 600 fichiers pour rien. */
const dejaEnLigne = new Set<string>();
for (let page = 0; page < 200; page += 1) {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list(PREFIXE, { limit: 1000, offset: page * 1000 });
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  for (const item of data) dejaEnLigne.add(item.name);
  if (data.length < 1000) break;
}
console.log(`${dejaEnLigne.size} vignettes déjà en ligne`);

const manquantes = locales.filter((name) => !dejaEnLigne.has(name));
console.log(`${manquantes.length} à produire`);
if (!manquantes.length) {
  console.log('Rien à faire.');
  process.exit(0);
}

let faites = 0;
let octets = 0;
const echecs: string[] = [];

for (let index = 0; index < manquantes.length; index += LOT) {
  await Promise.all(
    manquantes.slice(index, index + LOT).map(async (name) => {
      try {
        const vignette = await sharp(join(directory, name))
          .resize(LARGEUR)
          .webp({ quality: QUALITE })
          .toBuffer();
        const { error } = await db.storage.from(BUCKET).upload(`${PREFIXE}/${name}`, vignette, {
          cacheControl: '31536000',
          contentType: 'image/webp',
          upsert: true,
        });
        if (error) throw new Error(error.message);
        octets += vignette.byteLength;
        faites += 1;
      } catch (raison) {
        // Une planche illisible ne doit pas arrêter les 2 600 autres.
        echecs.push(`${name}: ${raison instanceof Error ? raison.message : raison}`);
      }
    }),
  );
  if (index % 200 === 0 || index + LOT >= manquantes.length) {
    console.log(`${Math.min(index + LOT, manquantes.length)}/${manquantes.length}`);
  }
}

console.log(`\n${faites} vignettes téléversées, ${(octets / 1e6).toFixed(0)} Mo`);
if (echecs.length) {
  console.log(`${echecs.length} échecs :`);
  for (const echec of echecs.slice(0, 10)) console.log(`  ${echec}`);
  console.log('Relance le script : il reprend là où il en est.');
}
