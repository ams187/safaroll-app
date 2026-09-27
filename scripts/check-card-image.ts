// The card image cache: keys, size buckets, and the byte budget.
//
// Pins the two failures that look identical to a working cache from the
// outside — a key that never repeats (nothing is ever reused, every scroll
// re-decodes) and a budget that never evicts (memory climbs until iOS kills
// the app). Both are pure arithmetic, so both run here.

import { readFileSync } from 'node:fs';

import { createBudgetCache, imageKey, sizeBucket } from '../src/components/cards/image-cache';
import { cardSceneFor, fullSceneFrom } from '../src/components/cards/card-scenes';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
}

// ── Size buckets ────────────────────────────────────────────────────────────
assert(sizeBucket(250) === 256, 'a 250px card rounds up to the 256 bucket');
assert(sizeBucket(246) === sizeBucket(252), 'near sizes share one bucket');
assert(sizeBucket(256) === 256, 'an exact power of two is its own bucket');
assert(sizeBucket(1020) === 1024, 'a full-size card rounds up to 1024');
assert(sizeBucket(1) === 1 && sizeBucket(0) === 1, 'degenerate sizes stay positive');
// Rounding DOWN would hand back an image smaller than it is drawn at.
for (let edge = 1; edge <= 4096; edge += 7) {
  assert(sizeBucket(edge) >= edge, `bucket ${sizeBucket(edge)} covers ${edge}`);
}

// ── Keys ────────────────────────────────────────────────────────────────────
const url = 'https://example.convex.cloud/sticker.webp';
assert(imageKey(url, 250) === imageKey(url, 252), 'one artwork at near sizes is one key');
assert(imageKey(url, 250) !== imageKey(url, 1020), 'grid and full size are separate decodes');
assert(imageKey(url, 250) !== imageKey(`${url}?v=2`, 250), 'different artwork, different key');
assert(imageKey(7, 250) !== imageKey('7', 250), 'a bundled asset is not its own id as a string');
assert(imageKey(null) === null && imageKey(undefined) === null, 'no source, no key');
assert(imageKey(new Uint8Array([1, 2]), 250) === null, 'raw bytes have no stable name');
assert(imageKey(url) !== imageKey(url, 250), 'an unsized request is its own entry');

// ── Budget ──────────────────────────────────────────────────────────────────
const MB = 1024 * 1024;
const cache = createBudgetCache<string>(10 * MB);
for (const name of ['a', 'b', 'c', 'd']) cache.put(name, name, 3 * MB);
assert(cache.held() <= 10 * MB, 'the budget is respected');
assert(cache.get('a') === undefined, 'the oldest entry went first');
assert(cache.get('d') === 'd' && cache.get('b') === 'b', 'the rest survived');

// A hit is a use: it must move to the back of the queue, or the cache evicts
// exactly the cards being looked at.
const lru = createBudgetCache<string>(3 * MB);
lru.put('x', 'x', 1 * MB);
lru.put('y', 'y', 1 * MB);
lru.put('z', 'z', 1 * MB);
lru.get('x');
lru.put('w', 'w', 1 * MB);
assert(lru.get('x') === 'x', 'a recent hit is not the next eviction');
assert(lru.get('y') === undefined, 'the genuinely coldest entry went');

// Re-storing a key replaces its cost rather than counting it twice.
const rewritten = createBudgetCache<string>(10 * MB);
rewritten.put('k', 'k', 4 * MB);
rewritten.put('k', 'k2', 2 * MB);
assert(rewritten.held() === 2 * MB, 'a rewritten entry is not double-counted');
assert(rewritten.get('k') === 'k2', 'and it is the new value');

// One image bigger than the whole budget is still handed back once.
const huge = createBudgetCache<string>(1 * MB);
huge.put('big', 'big', 8 * MB);
assert(huge.get('big') === 'big', 'an oversized entry is not evicted before use');

// The real numbers: a 4-column grid card at 3x, and a full-size one.
const gridBytes = sizeBucket(250) * Math.round(sizeBucket(250) / 0.715) * 4;
assert(gridBytes < 500_000, `a grid card decode is small (${gridBytes} bytes)`);
assert((64 * MB) / gridBytes > 100, 'the 64MB budget holds a hundred-card collection');

// LA GRILLE TIRE LA VIGNETTE, LA CARTE OUVERTE LA PLEINE PLANCHE.
//
// Une planche fait 768 × 1152 pour une carte de grille affichée à 342 px : 5,4×
// trop lourde en pixels, multiplié par toutes les cellules montées. C'est ce
// qui faisait ramer le scroll. Le repli inverse doit rester exact, sinon une
// espèce sans vignette encore générée afficherait une carte vide.
{
  const grille = cardSceneFor('Turdus merula', undefined, { size: 'grid' });
  const pleine = cardSceneFor('Turdus merula', undefined);
  assert(grille!.includes('/thumb/'), 'la grille doit demander la vignette');
  assert(!pleine!.includes('/thumb/'), 'la carte ouverte garde la pleine planche');
  assert(fullSceneFrom(grille!) === pleine, 'le repli vignette → planche doit rendre exactement l’URL pleine');
  assert(fullSceneFrom(pleine!) === pleine, 'le repli sur une URL déjà pleine ne doit rien changer');

  // Le slug résolu par le serveur prime sur la devinette par le nom, dans les
  // deux tailles — sinon les espèces à planche empruntée perdraient la leur.
  const empruntee = cardSceneFor('Espece inconnue', undefined, {
    sceneSlug: 'vulpes-vulpes',
    size: 'grid',
  });
  assert(
    empruntee === `${fullSceneFrom(empruntee!).replace('/card-scenes/', '/card-scenes/thumb/')}`,
    'une planche empruntée doit aussi exister en vignette',
  );
  assert(empruntee!.includes('vulpes-vulpes'), 'le slug serveur doit primer sur le nom');
}

// ─── UN SEUL CHEMIN VERS LA FORME D'UNE CAPTURE ─────────────────────────────
//
// `cardSceneFor` sait honorer une planche empruntée, encore faut-il qu'on lui
// passe le `sceneSlug` — et seul `enrichCaptures` le résout (RPC `scene_slugs`).
//
// `deckResults` appelait `captureShape` directement. Ses cartes partaient donc
// sans slug, `cardSceneFor` retombait sur un slug déduit du nom latin, et la
// planche empruntée tombait en 404 : la MÊME carte montrait son fond dans la
// collection et un simple dégradé dans le deck. Vu sur le vice-roi
// (`Limenitis archippus`, planche `pieris-bryoniae`) ; ça touchait toutes les
// espèces à `artwork_status` autre que `ready`.
//
// `captureShape` ne doit donc être appelé que par `enrichCaptures`. Un second
// appelant, c'est un écran de plus sans fond, et rien ne le signale.
{
  const backend = readFileSync(new URL('../src/lib/supabase/backend.ts', import.meta.url), 'utf8');
  // Deux occurrences attendues, et deux seulement : la déclaration, et l'unique
  // appel dans `enrichCaptures`. Compter les mentions plutôt que deviner la
  // forme d'un appel — une regex sur « ce qui précède » rate une flèche, un
  // `await`, un point-virgule, et laisse passer exactement ce qu'elle garde.
  const mentions = backend.match(/captureShape\(/g) ?? [];
  assert(
    mentions.length === 2,
    `captureShape doit n'être mentionné que 2 fois (déclaration + appel dans enrichCaptures) ; trouvé ${mentions.length}`,
  );
  assert(
    /function captureShape\(/.test(backend),
    'la déclaration de captureShape a changé de forme : ce compte ne veut plus rien dire',
  );
  assert(
    /\.\.\.captureShape\(row, originals, stickers\),\n\s*sceneSlug:/.test(backend),
    'enrichCaptures doit poser sceneSlug juste après captureShape',
  );
}

console.log('✓ card image cache: buckets, keys, budget, LRU order + vignette/pleine planche + planche empruntée sur un seul chemin');
