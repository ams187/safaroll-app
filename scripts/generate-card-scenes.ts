// LA PRODUCTION DES PLANCHES MANQUANTES.
//
// LE MANQUE QU'ELLE COMBLE
//
// Le catalogue compte 5 576 espèces et 1 736 planches. Pour les autres, le
// serveur emprunte la planche d'une espèce voisine du même groupe : la carte
// est correcte, mais elle n'est pas la sienne. Rien, jusqu'ici, ne produisait
// les manquantes — `build-card-scenes.ts` ne fait qu'INDEXER ce qui existe.
//
// POURQUOI CODEX ET PAS UNE API D'IMAGES
//
// La génération passe par `codex exec`, donc par l'abonnement. Une API
// facturée à l'image coûterait, sur 3 840 planches restantes, un multiple de
// ce que le projet peut porter.
//
// POURQUOI ON RAMASSE DANS LE DOSSIER DE CODEX
//
// Le bac à sable de `codex exec` refuse d'écrire hors de son espace. Inutile
// de se battre : il dépose de toute façon chaque rendu dans
// `~/.codex/generated_images/<thread>/`, en 1024 × 1536 — exactement le 2:3
// des planches. On prend le fichier là où il tombe.
//
// L'ORDRE N'EST PAS ALPHABÉTIQUE
//
// `artwork_queue` classe les espèces sans planche par nombre de captures
// réelles. On peint d'abord ce que les joueurs photographient vraiment ; le
// reste peut attendre son tour indéfiniment sans que personne ne le voie.
// Sans clé Supabase, on retombe sur l'ordre du catalogue — c'est moins bien,
// mais ça n'empêche pas de travailler.
//
//   bun scripts/generate-card-scenes.ts                 # liste ce qui manque
//   bun scripts/generate-card-scenes.ts --lot 8         # en produit 8
//   bun scripts/generate-card-scenes.ts --espece "Panthera leo"
import catalog from '../convex/data/catalog.json';
import { consigne, REFERENCE_POKEMON, REFERENCE_SAFAROLL } from './card-scene-prompt';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * POURQUOI `stdin: 'ignore'` ET PAS UN TUYAU VIDE.
 *
 * `codex exec` accepte son prompt en argument OU sur l'entrée standard, et
 * quand celle-ci est un tuyau il l'attend — même si le prompt est déjà là. Un
 * enfant lancé sans le dire hérite d'un tuyau que personne ne ferme : Codex
 * affiche « Reading additional input from stdin… » et ne rend jamais la main.
 * Ça ne ressemble pas à un blocage, ça ressemble à une génération lente.
 */
export function lancer(args: string[], limiteMs: number) {
  return new Promise<string>((resolve, reject) => {
    const enfant = spawn('codex', args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    let erreur = '';
    enfant.stdout.on('data', (bloc: Buffer) => { sortie += bloc.toString(); });
    enfant.stderr.on('data', (bloc: Buffer) => { erreur += bloc.toString(); });
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), limiteMs);
    enfant.on('error', reject);
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve(sortie);
      else reject(new Error((erreur || sortie).trim().split('\n').pop() ?? `codex a rendu ${code}`));
    });
  });
}

/** Au-delà, on considère la génération perdue et on passe à la suivante. */
export const LIMITE_MS = 12 * 60 * 1000;

const DOSSIER = join(process.cwd(), 'assets/cards/species');
const GENERES = join(homedir(), '.codex/generated_images');
const LARGEUR = 768;
const HAUTEUR = 1152;

/** Combien de `codex exec` en même temps. Au-delà, le quota se plaint. */
const PARALLELE = 4;

// Les deux mêmes règles que `build-card-scenes.ts` : une planche est nommée par
// le BINÔME seul. Les sous-espèces et les auteurs (`Vulpes vulpes crucigera`,
// `Canis lupus Linnaeus`) partagent donc un fichier, ce qui est voulu — ils
// partagent aussi l'habitat.
export const cle = (nom: string) => nom.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
export const slugDe = (nom: string) => cle(nom).replace(/[^a-z0-9]+/g, '-');

export type Espece = { binomial: string; groupe: string; slug: string; vernaculaire: string };

/** Ce qui n'a pas encore de fichier, dédoublonné par binôme. */
function sansPlanche(brut: { groupe?: string; nom: string; vernaculaire?: string }[]): Espece[] {
  const vues = new Set<string>();
  return brut.flatMap(({ groupe, nom, vernaculaire }) => {
    const k = cle(nom);
    if (!k || vues.has(k)) return [];
    vues.add(k);
    const slug = slugDe(nom);
    if (existsSync(join(DOSSIER, `${slug}.webp`))) return [];
    return [{ binomial: k.replace(/^./, (c) => c.toUpperCase()), groupe: groupe ?? '', slug, vernaculaire: vernaculaire ?? '' }];
  });
}

/**
 * LA FILE FAIT AUTORITÉ, PAS LE CATALOGUE LOCAL.
 *
 * `convex/data/catalog.json` ne connaît que 884 espèces — c'est l'index que
 * l'app embarque, pas le catalogue. `artwork_queue` couvre les 5 576 du
 * catalogue Supabase PLUS les espèces sauvages découvertes en jeu, et les
 * classe déjà par captures réelles. Sans clé, on retombe sur le JSON : moins
 * complet, mais suffisant pour travailler hors ligne.
 *
 * On refiltre malgré tout sur le disque : la vue lit `artwork_status`, qui ne
 * passe à `ready` qu'après téléversement. Entre la peinture et l'envoi, une
 * planche existe sans que la vue le sache.
 */
export async function manquantes(): Promise<Espece[]> {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db
      .from('artwork_queue')
      .select('scientific_name, animal_group')
      .limit(1000);
    if (!error && data?.length) {
      return sansPlanche(data.map((r: { animal_group: string | null; scientific_name: string }) =>
        ({ groupe: r.animal_group ?? '', nom: r.scientific_name })));
    }
    console.warn(`artwork_queue indisponible (${error?.message ?? 'vide'}) — repli sur le catalogue local.`);
  }
  return sansPlanche(catalog.species.map((s: { canonicalName: string; vernacularNames?: { fr?: string } }) =>
    ({ nom: s.canonicalName, vernaculaire: s.vernacularNames?.fr })));
}

/** Le PNG le plus récent déposé par Codex depuis `depuis`. */
function derniereImage(depuis: number): string | undefined {
  if (!existsSync(GENERES)) return undefined;
  const fichiers = readdirSync(GENERES).flatMap((fil) => {
    const dossier = join(GENERES, fil);
    if (!statSync(dossier).isDirectory()) return [];
    return readdirSync(dossier)
      .filter((n) => n.endsWith('.png'))
      .map((n) => join(dossier, n))
      .filter((p) => statSync(p).mtimeMs > depuis);
  });
  return fichiers.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export async function peindre(e: Espece) {
  const depuis = Date.now();
  // Une génération ratée ne doit pas emporter le lot : les sept autres espèces
  // du tour n'y sont pour rien, et le rendu manquant sera simplement redemandé.
  try {
    // `--` N'EST PAS DÉCORATIF. `-i` prend une LISTE de fichiers : sans le
    // séparateur, le prompt qui suit est avalé comme troisième image et Codex
    // répond « No prompt provided via stdin ».
    await lancer(['exec', '--skip-git-repo-check',
      '-i', REFERENCE_POKEMON, '-i', REFERENCE_SAFAROLL,
      '--', consigne(e.binomial, e.vernaculaire, e.groupe)], LIMITE_MS);
  } catch (erreur) {
    return `${e.slug}: codex a échoué — ${(erreur as Error).message.split('\n')[0]}`;
  }

  const source = derniereImage(depuis);
  if (!source) return `${e.slug}: aucune image produite`;

  // 1024 × 1536 → 768 × 1152. Même ratio, donc `cover` ne rogne rien ; il est
  // là pour le jour où le générateur rendra un format légèrement différent.
  await sharp(source)
    .resize(LARGEUR, HAUTEUR, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(join(DOSSIER, `${e.slug}.webp`));
  return `${e.slug}: ok`;
}

// LE BLOC CLI NE S'EXÉCUTE QU'EN LIGNE DE COMMANDE.
//
// `scripts/admin.ts` importe `peindre` et `manquantes` : sans cette garde, le
// simple fait d'importer ce fichier lirait `process.argv`, interrogerait
// Supabase et écrirait sur le disque — des effets de bord qu'un import n'a
// aucune raison de déclencher.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const valeur = (nom: string) => {
    const i = args.indexOf(nom);
    return i === -1 ? undefined : args[i + 1];
  };
  const lot = Number(valeur('--lot') ?? 0);
  const espece = valeur('--espece');

  const toutes = await manquantes();
  const liste = espece ? toutes.filter((e) => cle(e.binomial) === cle(espece)) : toutes;

  if (!lot) {
    console.log(`planches manquantes : ${liste.length}`);
    console.log(liste.slice(0, 20).map((e) => `  ${e.binomial}${e.vernaculaire ? ` — ${e.vernaculaire}` : ''}`).join('\n'));
    console.log(`\nbun scripts/generate-card-scenes.ts --lot 8`);
  } else {
    if (!existsSync(REFERENCE_POKEMON)) throw new Error(`Référence absente : ${REFERENCE_POKEMON}`);
    const cible = liste.slice(0, lot);
    for (let i = 0; i < cible.length; i += PARALLELE) {
      const tranche = cible.slice(i, i + PARALLELE);
      console.log(`→ ${tranche.map((e) => e.binomial).join(', ')}`);
      for (const ligne of await Promise.all(tranche.map(peindre))) console.log(`  ${ligne}`);
    }
    console.log('\nEnsuite : bun run build:card-scenes && bun scripts/build-card-thumbs.ts --ecrire');
  }
}
