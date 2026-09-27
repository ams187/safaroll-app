// Le sticker se pose-t-il exactement sur l'animal de la photo ?
//
// C'est la promesse du détourage en place : à l'instant où le liseré apparaît,
// le sujet du sticker doit recouvrir le sujet de la photo au pixel près —
// décalé d'un rien, l'animal « saute » et le tour de magie s'effondre.

import { containIn, stickerFrameIn, type Rect } from '../src/lib/animals/lift-reveal-geometry';

function fail(message: string): never {
  throw new Error(`check-lift-reveal: ${message}`);
}
function close(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) > 0.001) {
    fail(`${label} — got ${actual}, expected ${expected}`);
  }
}

const photo: Rect = { height: 400, width: 300, x: 15, y: 60 };

// Aller-retour : quel que soit le placement du sujet dans l'image ET dans le
// canvas du sticker, le sujet du sticker posé doit retomber sur le sujet de
// la photo.
const cases = [
  { x: 0.25, y: 0.25, width: 0.5, height: 0.5, stickerX: 0.25, stickerY: 0.25, stickerWidth: 0.5, stickerHeight: 0.5 },
  { x: 0.1, y: 0.6, width: 0.3, height: 0.25, stickerX: 0.05, stickerY: 0.12, stickerWidth: 0.9, stickerHeight: 0.76 },
  { x: 0.55, y: 0.05, width: 0.4, height: 0.7, stickerX: 0.3, stickerY: 0.02, stickerWidth: 0.4, stickerHeight: 0.96 },
] as const;

for (const c of cases) {
  const bounds = { ...c, imageWidth: 3000, imageHeight: 4000 };
  const frame = stickerFrameIn(photo, bounds);
  // Le sujet, reprojeté depuis le frame du sticker…
  close(frame.x + frame.width * c.stickerX, photo.x + c.x * photo.width, 'subject x');
  close(frame.y + frame.height * c.stickerY, photo.y + c.y * photo.height, 'subject y');
  close(frame.width * c.stickerWidth, c.width * photo.width, 'subject width');
  close(frame.height * c.stickerHeight, c.height * photo.height, 'subject height');
}

// containIn : le ratio est respecté, le rect est centré, rien ne déborde.
const box: Rect = { height: 100, width: 200, x: 10, y: 20 };
const wide = containIn(box, 4);
close(wide.width, 200, 'wide width');
close(wide.height, 50, 'wide height');
close(wide.y, 45, 'wide centred vertically');
const tall = containIn(box, 0.5);
close(tall.height, 100, 'tall height');
close(tall.width, 50, 'tall width');
close(tall.x, 85, 'tall centred horizontally');

console.log(
  'check-lift-reveal: 3 placements de sujet reprojetés au pixel, contain large et haut centrés — le sticker se pose sur son animal',
);
