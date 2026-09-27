// « Ce que j'ai le droit de lire » n'est pas « ce qui est à moi ».
//
// LE BUG QUE CE GARDE-FOU FERME
//
// Trois tables portent une politique RLS de lecture « la mienne OU une
// publique » — `decks`, `deck_cards`, `animal_captures`. Il le faut : la
// galerie communautaire lit par là. Mais une requête « mes decks » qui ne
// filtre pas et compte sur RLS pour la borner reçoit AUSSI les decks publics
// des autres.
//
// Mesuré en base le 2026-09-01, sur un compte réel :
//
//   collection      110 cartes rendues, dont 80 appartenant à d'autres comptes
//   « mes decks »   5 decks présentés, dont 5 appartenant à d'autres
//
// Le symptôme visible était « Placement impossible » : déposer une carte sur
// un de ces decks appelait `place_deck_card`, qui vérifie la propriété côté
// Postgres et refusait. Le message accusait le placement ; la faute était dans
// la liste, deux écrans plus haut. Les compteurs d'espèces, les badges et le
// « nouvelle espèce » des sorties étaient faux par la même voie, en silence.
//
// CE QU'ON VÉRIFIE
//
// Que chaque requête « à moi » porte son filtre explicite. RLS reste la
// sécurité — le client n'est pas cru sur parole — mais la PORTÉE se déclare.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backend = readFileSync(new URL('../src/lib/supabase/backend.ts', import.meta.url), 'utf8');

function bloc(depuis: string, lignes: number) {
  const debut = backend.indexOf(depuis);
  assert.notEqual(debut, -1, `introuvable dans backend.ts : ${depuis}`);
  return backend.slice(debut).split('\n').slice(0, lignes).join('\n');
}

// La collection. Sans filtre, elle affichait les captures des autres présentes
// dans un deck public.
const collection = bloc("if (key === 'animals.listCaptures')", 8);
assert.match(
  collection,
  /\.eq\('user_id', uid\)/,
  'animals.listCaptures doit filtrer sur user_id : RLS laisse passer les captures des decks publics.',
);
assert.match(
  collection,
  /if \(!uid\) return \[\]/,
  'sans identité, la collection rend vide — jamais la vitrine publique.',
);

// « Mes decks ». Le même `deckResults` sert la communauté ; seule la branche
// non-communautaire doit être bornée au porteur du jeton.
const decks = bloc('async function deckResults(', 40);
assert.match(
  decks,
  /else if \(!community\) \{\s*\n\s*if \(!userId\) return \[\];\s*\n\s*decksQuery = decksQuery\.eq\('user_id', userId\);/,
  'deckResults hors communauté doit filtrer sur user_id, sinon « mes decks » contient ceux des autres.',
);

// Le « nouvelle espèce » d'une sortie se calcule sur l'historique des captures.
// Une capture d'autrui dans le lot fait passer une espèce pour déjà vue.
const sorties = bloc('async function expeditionSummaries(', 12);
assert.match(
  sorties,
  /from\('animal_captures'\)[^\n]*\.eq\('user_id', uid\)/,
  'expeditionSummaries doit filtrer les captures sur user_id : sinon la découverte n\'est plus comptée.',
);

// L'identité vient d'un seul endroit, mémorisé par jeton — sinon chaque écran
// rajoute un aller-retour sur le chemin le plus chaud de l'app.
assert.match(backend, /async function monId\(\): Promise<string \| null>/, 'monId() doit exister');
assert.match(backend, /identite\?\.jeton !== jeton/, 'monId() doit mémoriser par jeton');

// ─── AUCUN PLAFOND ÉCRIT À LA MAIN SUR CE QUI GROSSIT ───────────────────────
//
// PostgREST plafonne chaque réponse à `max_rows` (1000) sans erreur ni indice.
// Vérifié sur l'instance le 2026-09-01 : `limit=4000` sur `species_catalog`
// (5 576 lignes) rend exactement 1 000 lignes, code 200.
//
// Deux plafonds vivaient encore dans le code :
//
//   animals.listCaptures   .limit(200)    — 167 captures mesurées, 33 d'écart
//   seasons.inSeason       .limit(4000)   — écrêté à 1 000, le 4000 est un leurre
//
// Le premier fait disparaître des cartes de la collection sans un mot ; le
// second aurait fait rétrécir les défis le jour où une région dépasse mille
// espèces (le maximum mesuré est 854, soit 85 % du plafond).
//
// Un plafond en dur se périme en silence. Ces requêtes paginent.
for (const [bloc_, nom] of [
  [bloc("if (key === 'animals.listCaptures')", 8), 'animals.listCaptures'],
  [bloc("if (key === 'seasons.inSeason')", 22), 'seasons.inSeason'],
  [bloc("if (key === 'worldSpecies.list')", 10), 'worldSpecies.list'],
] as const) {
  assert.match(bloc_, /toutesLesPages/, `${nom} doit paginer, pas porter un plafond en dur`);
  assert.doesNotMatch(bloc_, /\.limit\(\d+\)/, `${nom} ne doit plus porter de .limit(N) écrit à la main`);
}

// Le pagineur s'arrête sur une page courte — sans ça, la boucle tourne jusqu'à
// son filet et refait 200 fois la même requête.
assert.match(
  backend,
  /if \(\(data\?\.length \?\? 0\) < PAGE\) break;/,
  'toutesLesPages doit sortir dès qu\'une page est incomplète',
);

console.log('check-owner-scope: ok (portée bornée au porteur du jeton, aucun plafond en dur sur ce qui grossit)');
