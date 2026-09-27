// La géométrie du détourage en place — pure, sans React ni react-native, pour
// qu'un script la vérifie. C'est elle qui décide si le sticker se pose
// exactement sur l'animal de la photo : fausse d'un demi-pour-cent, l'animal
// « saute » à l'instant du détourage et tout le tour de magie s'effondre.

import type { StickerSubjectBounds } from 'subject-lift';

export type Rect = { height: number; width: number; x: number; y: number };

/**
 * Où le PNG du sticker se pose pour que son sujet coïncide avec le sujet de la
 * photo affichée. `bounds` est normalisé deux fois — position du sujet dans
 * l'image, position du sujet dans le canvas du sticker — et le rect rendu de
 * la photo fait le pont entre les deux.
 */
export function stickerFrameIn(photoRect: Rect, bounds: StickerSubjectBounds): Rect {
  const subject = {
    height: bounds.height * photoRect.height,
    width: bounds.width * photoRect.width,
    x: photoRect.x + bounds.x * photoRect.width,
    y: photoRect.y + bounds.y * photoRect.height,
  };
  const width = subject.width / Math.max(bounds.stickerWidth, 0.01);
  const height = subject.height / Math.max(bounds.stickerHeight, 0.01);
  return {
    height,
    width,
    x: subject.x - width * bounds.stickerX,
    y: subject.y - height * bounds.stickerY,
  };
}

/** `contain` d'un ratio dans un rect — où le PNG atterrit vraiment. */
export function containIn(rect: Rect, ratio: number): Rect {
  const width = Math.min(rect.width, rect.height * ratio);
  const height = width / ratio;
  return {
    height,
    width,
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
  };
}
