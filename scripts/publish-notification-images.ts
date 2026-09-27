// LES PLANCHES EN JPEG, POUR LES NOTIFICATIONS RICHES.
//
// POURQUOI CE SCRIPT EXISTE
//
// iOS n'accepte qu'un jeu restreint de formats en pièce jointe de
// notification — JPEG, PNG, GIF. Le WebP n'en fait pas partie, et toutes les
// planches d'espèces sont en WebP. Une notification qui pointe un `.webp`
// arrive donc SANS image, sans erreur : le texte s'affiche, l'illustration
// disparaît en silence.
//
// La transformation d'image de Supabase convertirait à la volée, mais elle
// répond 403 sur ce projet (réservée au plan Pro). On convertit donc une fois,
// en amont, et on dépose un `.jpg` à côté du `.webp`.
//
// PORTÉE : les espèces qui ont une COURBE SAISONNIÈRE pour la région ciblée,
// pas le catalogue entier. Ce sont les seules qu'un rappel puisse citer, et
// convertir les 5 576 coûterait des heures pour des fichiers que rien
// n'irait chercher.
//
//   bun --env-file=.env.local scripts/publish-notification-images.ts FR
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const REGION = process.argv[2] ?? 'FR';
const BUCKET = 'notification-images';
const SOURCE_BUCKET = 'card-scenes';
/** Assez grand pour la bannière étendue d'iOS, assez petit pour arriver vite. */
const LARGEUR = 600;

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('EXPO_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY sont requis.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const slug = (nom: string) =>
  nom.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const { data: saisons, error } = await db
  .from('species_seasons')
  .select('scientific_name')
  .eq('region', REGION);
if (error) {
  console.error(error.message);
  process.exit(1);
}

const especes = [...new Set((saisons ?? []).map((s) => slug(s.scientific_name)))];
console.log(`${especes.length} espèces saisonnières en ${REGION}`);

let convertis = 0;
let deja = 0;
let absents = 0;
for (const nom of especes) {
  const jpeg = `${nom}.jpg`;
  // Idempotent : le script se relance sans refaire le travail fait.
  const { data: tete } = await db.storage.from(BUCKET).list('', { search: jpeg, limit: 1 });
  if (tete?.some((f) => f.name === jpeg)) { deja += 1; continue; }

  const source = `${url}/storage/v1/object/public/${SOURCE_BUCKET}/${nom}.webp`;
  const reponse = await fetch(source);
  if (!reponse.ok) { absents += 1; continue; }

  const rendu = await sharp(Buffer.from(await reponse.arrayBuffer()))
    // Fond crème plutôt que noir : les planches ont un canal alpha, et un
    // aplatissement par défaut les poserait sur du noir dans la notification.
    .flatten({ background: '#faf6ee' })
    .resize({ width: LARGEUR, withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();

  const { error: envoi } = await db.storage
    .from(BUCKET)
    .upload(jpeg, rendu, { contentType: 'image/jpeg', upsert: true });
  if (envoi) { console.error(`  ${jpeg} : ${envoi.message}`); continue; }
  convertis += 1;
  if (convertis % 25 === 0) console.log(`  ${convertis} converties…`);
}

console.log(`\nconverties ${convertis} · déjà présentes ${deja} · sans planche ${absents}`);
