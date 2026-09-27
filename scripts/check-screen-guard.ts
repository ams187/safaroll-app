// The screen-capture guard decides whether to accuse a player of cheating.
// Being wrong about a real photo is far worse than letting a screenshot in,
// so these thresholds get a test.
// Run: bun run check:screen
import {
  assessScreenCapture,
  lumaFromRgba,
  moireEnergy,
  SCREEN_WARN_THRESHOLD,
} from '../src/lib/animals/screen-capture-guard';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-screen-guard: ${message}`);
}

// --- Moiré ----------------------------------------------------------------

const WIDTH = 64;
const HEIGHT = 32;

/** A smooth natural gradient: no periodic component. */
const natural: number[] = [];
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    natural.push(60 + (x / WIDTH) * 90 + Math.sin(y / 9) * 6);
  }
}

/** A hard 6px stripe pattern — what a phone sees on an LCD. */
const striped: number[] = [];
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    striped.push(x % 6 < 3 ? 40 : 210);
  }
}

const naturalEnergy = moireEnergy(natural, WIDTH, HEIGHT);
const stripedEnergy = moireEnergy(striped, WIDTH, HEIGHT);
assert(naturalEnergy < 0.3, `a smooth photo must read calm, got ${naturalEnergy.toFixed(2)}`);
assert(stripedEnergy > 0.55, `a pixel grid must ring, got ${stripedEnergy.toFixed(2)}`);
assert(stripedEnergy > naturalEnergy * 2, 'the two cases must be clearly separable');
assert(moireEnergy([], 0, 0) === 0, 'an empty buffer must not throw or claim anything');

// --- Luminance -------------------------------------------------------------
//
// L'ordre des canaux est le point d'échec silencieux de toute la chaîne : lu à
// l'envers, la luminance reste plausible, le moiré s'évanouit, et le garde
// laisse passer tout le monde sans jamais lever d'erreur.

// Rouge pur, vert pur, bleu pur — les trois poids Rec. 601, séparément.
const channels = lumaFromRgba([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 3);
assert(Math.abs(channels[0] - 76.2) < 0.5, `red must weigh 0.299, got ${channels[0].toFixed(1)}`);
assert(Math.abs(channels[1] - 149.7) < 0.5, `green must weigh 0.587, got ${channels[1].toFixed(1)}`);
assert(Math.abs(channels[2] - 29.1) < 0.5, `blue must weigh 0.114, got ${channels[2].toFixed(1)}`);
assert(channels[1] > channels[0] && channels[0] > channels[2], 'green > red > blue, or the channels are swapped');
// L'alpha ne participe pas : un pixel opaque et le même transparent ont la
// même luminance, sinon un bord de sticker inventerait du signal.
assert(lumaFromRgba([10, 20, 30, 0], 1)[0] === lumaFromRgba([10, 20, 30, 255], 1)[0], 'alpha must not leak into luma');
assert(lumaFromRgba([], 0).length === 0, 'an empty buffer must produce an empty sample');

// --- The combined verdict --------------------------------------------------

const realCapture = assessScreenCapture({ height: HEIGHT, luma: natural, width: WIDTH });
assert(
  realCapture.score < SCREEN_WARN_THRESHOLD,
  `a real capture must pass, scored ${realCapture.score.toFixed(2)}`,
);
assert(realCapture.reasons.length === 0, 'a real capture must not be given reasons to doubt it');

// LE MOIRÉ DOIT SUFFIRE, PUISQU'IL EST SEUL.
//
// C'est la seule assertion qui compte depuis que l'EXIF est parti : le score
// n'a plus qu'une source, et il doit franchir le seuil sans aide. Si un jour
// quelqu'un baisse le facteur 0,7 ou remonte le seuil, c'est ici que ça casse.
const photoOfScreen = assessScreenCapture({ height: HEIGHT, luma: striped, width: WIDTH });
assert(
  photoOfScreen.score >= SCREEN_WARN_THRESHOLD,
  `moiré alone must be enough to catch a display, scored ${photoOfScreen.score.toFixed(2)}`,
);
assert(photoOfScreen.reasons.length >= 1, 'a warning must always say why');

// Aucun pixel à examiner : sans preuve, le garde se tait.
const unknown = assessScreenCapture({});
assert(unknown.score === 0, 'with no evidence the guard must stay silent');
assert(unknown.reasons.length === 0, 'silence means no reasons either');

console.log(
  `check-screen-guard: natural ${naturalEnergy.toFixed(2)} vs screen ${stripedEnergy.toFixed(2)} — ` +
    'real captures pass, displays are caught',
);
