// LA CONSOLE D'ATELIER — http://127.0.0.1:4180
//
// CE QU'ELLE RÉSOUT, ET QUI N'EST PAS L'AUTOMATISATION
//
// Produire une planche est déjà automatique (`generate-card-scenes.ts`). Ce
// qui ne l'est pas, et ne peut pas l'être, c'est DÉCIDER si elle est bonne.
// Les contact-sheets de `tmp/imagegen/` étaient ce jugement fait à la main :
// générer huit images, les coller côte à côte, regarder, recommencer.
//
// Cette page met cette décision au centre. Une planche générée reste LOCALE
// jusqu'à ce qu'on la publie ; tant qu'elle n'est pas publiée, l'app continue
// d'emprunter la planche d'une espèce voisine. Rien n'atteint les joueurs par
// accident.
//
// POURQUOI 127.0.0.1 ET PAS 0.0.0.0
//
// Ce serveur détient `SUPABASE_SECRET_KEY` — la clé service_role, qui passe
// outre toutes les politiques RLS. Exposée sur le réseau local, n'importe quel
// appareil du Wi-Fi écrirait dans la base de production. L'écoute est donc
// bouclée sur la boucle locale, et ce n'est pas un réglage à assouplir.
//
//   SUPABASE_SECRET_KEY=… bun scripts/admin.ts
import { cle, lancer, LIMITE_MS, peindre, slugDe, type Espece } from './generate-card-scenes';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 4180;
const DOSSIER = join(process.cwd(), 'assets/cards/species');

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error('SUPABASE_SECRET_KEY manquante (Dashboard → Project Settings → API Keys → service_role).');
}
const db = createClient(url, secret, { auth: { persistSession: false } });

type Etat = 'en cours' | 'prête' | 'échec';
/** L'état vit en mémoire : un redémarrage repart de ce qu'il y a sur le disque. */
const travaux = new Map<string, { etat: Etat; message: string }>();

// ─── la file ────────────────────────────────────────────────────────────────

type Ligne = {
  animal_group: string;
  artwork_status: string;
  captures: number;
  joueurs: number;
  origine: string;
  planche: boolean;
  scientific_name: string;
  slug: string;
  vernacular_name: string | null;
  vernacular_name_en: string | null;
};

/**
 * LA FILE VIENT DE LA VUE, LES TRADUCTIONS DE LA TABLE.
 *
 * `artwork_queue` agrège catalogue et espèces sauvages, mais ne porte pas les
 * noms vernaculaires — elle ne sait rien du travail de traduction. On la
 * complète donc par une lecture de `species_catalog`, en une requête et non en
 * une par ligne.
 */
async function file(limite: number): Promise<Ligne[]> {
  const { data, error } = await db
    .from('artwork_queue')
    .select('scientific_name, animal_group, artwork_status, captures, joueurs, origine')
    .limit(limite);
  if (error) throw new Error(error.message);

  const noms = (data ?? []).map((r) => r.scientific_name);
  const { data: fiches } = await db
    .from('species_catalog')
    .select('scientific_name, vernacular_name, vernacular_name_en')
    .in('scientific_name', noms);
  const parNom = new Map((fiches ?? []).map((f) => [f.scientific_name, f]));

  return (data ?? []).map((r) => {
    const slug = slugDe(r.scientific_name);
    const fiche = parNom.get(r.scientific_name);
    return {
      ...r,
      planche: existsSync(join(DOSSIER, `${slug}.webp`)),
      slug,
      vernacular_name: fiche?.vernacular_name ?? null,
      vernacular_name_en: fiche?.vernacular_name_en ?? null,
    };
  });
}

// ─── les traductions ────────────────────────────────────────────────────────

/**
 * POURQUOI UN SECOND APPEL, ET PAS LE MÊME QUE L'IMAGE.
 *
 * La génération d'image et la recherche de noms n'échouent pas ensemble : une
 * planche peut être magnifique et le nom français absent, ou l'inverse. Les
 * mêler ferait tout recommencer pour la moitié qui manque.
 *
 * On demande du JSON seul, mais on ne le CROIT pas : Codex écrit volontiers une
 * phrase autour. D'où l'extraction du dernier objet accolé plutôt qu'un
 * `JSON.parse` sur la sortie brute.
 */
async function traduire(binomial: string, groupe: string) {
  const sortie = await lancer(['exec', '--skip-git-repo-check', '--', [
    `Trouve les noms vernaculaires de ${binomial} (${groupe}) et une note de terrain.`,
    'Réponds UNIQUEMENT par un objet JSON, sans texte autour, sans bloc de code :',
    '{"fr":"nom français","en":"english name","note":"une phrase de terrain en français, 20 mots max"}',
    "Si un nom vernaculaire n'existe pas dans une langue, mets le nom scientifique.",
    "Ne modifie aucun fichier.",
  ].join('\n')], LIMITE_MS);

  const objets = sortie.match(/\{[^{}]*"fr"[^{}]*\}/g);
  if (!objets?.length) throw new Error('aucun JSON dans la réponse');
  return JSON.parse(objets[objets.length - 1]) as { en: string; fr: string; note: string };
}

// ─── la publication ─────────────────────────────────────────────────────────

/**
 * L'ORDRE DES TROIS ÉCRITURES EST PORTEUR.
 *
 * Le fichier part D'ABORD dans le bucket, et `artwork_status` ne passe à
 * `ready` qu'ensuite. L'inverse laisserait une fenêtre pendant laquelle l'app
 * croit la planche disponible et sert un 404 : une carte cassée, alors que le
 * repli sur une espèce voisine marchait très bien une seconde plus tôt.
 */
async function publier(nom: string) {
  const slug = slugDe(nom);
  const fichier = join(DOSSIER, `${slug}.webp`);
  if (!existsSync(fichier)) throw new Error('aucune planche locale à publier');

  const { error: envoi } = await db.storage.from('card-scenes').upload(`${slug}.webp`, readFileSync(fichier), {
    cacheControl: '31536000', contentType: 'image/webp', upsert: true,
  });
  if (envoi) throw new Error(`bucket : ${envoi.message}`);

  // `world_species` porte les mêmes colonnes pour les espèces découvertes en
  // jeu. On écrit dans les deux : la file mélange les deux origines, et une
  // seule des deux mises à jour touchera une ligne.
  for (const table of ['species_catalog', 'world_species']) {
    await db.from(table).update({ artwork_status: 'ready', scene_slug: slug }).eq('scientific_name', nom);
  }
  return slug;
}

// ─── le serveur ─────────────────────────────────────────────────────────────

const PAGE = readFileSync(join(process.cwd(), 'scripts/admin.html'), 'utf8');

function corps(req: import('node:http').IncomingMessage) {
  return new Promise<Record<string, string>>((resolve) => {
    let brut = '';
    req.on('data', (bloc) => { brut += bloc; });
    req.on('end', () => resolve(brut ? JSON.parse(brut) : {}));
  });
}

createServer(async (req, res) => {
  const chemin = (req.url ?? '/').split('?')[0];
  const json = (valeur: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(valeur));
  };

  try {
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }

    if (chemin === '/api/file') {
      const limite = Number(new URL(req.url ?? '', 'http://x').searchParams.get('limite') ?? 60);
      return json({ lignes: await file(limite), travaux: Object.fromEntries(travaux) });
    }

    if (chemin.startsWith('/api/planche/')) {
      const fichier = join(DOSSIER, `${slugDe(decodeURIComponent(chemin.slice(13)))}.webp`);
      if (!existsSync(fichier)) { res.writeHead(404); return res.end(); }
      // `no-store` : la planche est REMPLACÉE au même chemin à chaque essai.
      // Mise en cache, le navigateur montrerait la version rejetée.
      res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'image/webp' });
      return res.end(readFileSync(fichier));
    }

    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    const donnees = await corps(req);
    const nom = donnees.nom ?? '';

    if (chemin === '/api/generer') {
      const espece: Espece = {
        binomial: cle(nom).replace(/^./, (c) => c.toUpperCase()),
        groupe: donnees.groupe ?? '',
        slug: slugDe(nom),
        vernaculaire: donnees.vernaculaire ?? '',
      };
      travaux.set(nom, { etat: 'en cours', message: 'génération…' });
      // On ne l'attend PAS : une génération dure ~2 min et la page doit rester
      // vivante pour en lancer d'autres pendant ce temps.
      void peindre(espece)
        .then((ligne) => travaux.set(nom, ligne.endsWith(': ok')
          ? { etat: 'prête', message: 'à valider' }
          : { etat: 'échec', message: ligne }))
        .catch((e: Error) => travaux.set(nom, { etat: 'échec', message: e.message }));
      return json({ lance: true });
    }

    if (chemin === '/api/traduire') {
      travaux.set(nom, { etat: 'en cours', message: 'recherche des noms…' });
      void traduire(nom, donnees.groupe ?? '')
        .then(async (t) => {
          for (const table of ['species_catalog', 'world_species']) {
            await db.from(table)
              .update({ field_note: t.note, vernacular_name: t.fr, vernacular_name_en: t.en })
              .eq('scientific_name', nom);
          }
          travaux.set(nom, { etat: 'prête', message: `${t.fr} · ${t.en}` });
        })
        .catch((e: Error) => travaux.set(nom, { etat: 'échec', message: e.message }));
      return json({ lance: true });
    }

    if (chemin === '/api/publier') {
      await publier(nom);
      travaux.delete(nom);
      return json({ publie: true });
    }

    if (chemin === '/api/rejeter') {
      rmSync(join(DOSSIER, `${slugDe(nom)}.webp`), { force: true });
      travaux.delete(nom);
      return json({ rejete: true });
    }

    res.writeHead(404);
    res.end();
  } catch (erreur) {
    json({ erreur: (erreur as Error).message }, 500);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`atelier SafaRoll → http://127.0.0.1:${PORT}`);
});
