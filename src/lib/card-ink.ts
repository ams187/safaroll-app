// Snapshot a live card into ink for the burning sheet.
//
// `makeImageFromView` is the same call the GIF share already uses: it captures
// a real React Native view — the HoloCard's own Skia canvas, its frame, its
// printed chrome, whatever the player is actually looking at — into an SkImage.
// Rasterised down and read back as straight RGBA, that is exactly what
// `BurningCard` hands the engine as the sheet's ink.
//
// This is the whole reason the burn reads as destroying THE card rather than
// destroying a picture of one: the paper is printed with the card that was on
// screen a frame ago, down to whatever tilt it happened to be sitting at.

import { AlphaType, ColorType, makeImageFromView, Skia } from '@shopify/react-native-skia';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export interface CardInk {
  height: number;
  /** Straight (un-premultiplied) sRGB bytes, row-major, `width * height * 4`. */
  rgba: Uint8Array;
  width: number;
}

/**
 * Ink resolution. The sheet is drawn at most ~900 device px wide, so 1024 has
 * texels to spare — and every one of them is read back across JSI, so more
 * would only cost.
 */
const INK_WIDTH = 1024;

/**
 * The paper's aspect (1 : 1.38). A card is 1 : 1.397, so the snapshot is
 * stretched by ~1.2% in height — under a pixel and a half at this size, and
 * far cheaper than letterboxing the card onto a sheet that would then have
 * bare paper margins the card never had.
 */
const INK_ASPECT = 1.38;

/**
 * Captures the view behind `ref` as ink, or null if the snapshot failed.
 *
 * Null is a real outcome, not an error: `makeImageFromView` returns nothing if
 * the view has no layout yet or has already been unmounted, and a burn that
 * cannot photograph its subject should fall back rather than throw in the
 * middle of a delete.
 */
export async function cardInk(ref: RefObject<View | null>): Promise<CardInk | null> {
  const snapshot = await makeImageFromView(ref);
  if (!snapshot) return null;

  const width = INK_WIDTH;
  const height = Math.round(width * INK_ASPECT);
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;

  // Opaque white underneath: the ink is a MULTIPLIER over the paper's albedo,
  // so anything the snapshot leaves transparent has to come back as bare paper.
  // Left at zero it would multiply to black and print a hole.
  const canvas = surface.getCanvas();
  const paper = Skia.Paint();
  paper.setColor(Skia.Color('#ffffff'));
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paper);
  canvas.drawImageRect(
    snapshot,
    Skia.XYWHRect(0, 0, snapshot.width(), snapshot.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint(),
  );
  surface.flush();

  const image = surface.makeImageSnapshot();
  // The layout is pinned: the platform-native N32 order is BGRA on some Apple
  // builds, and the texture it feeds is read as RGBA.
  const rgba = image.readPixels(0, 0, {
    alphaType: AlphaType.Unpremul,
    colorType: ColorType.RGBA_8888,
    height,
    width,
  }) as Uint8Array | null;
  image.dispose();
  surface.dispose();
  if (!rgba) return null;

  return { height, rgba, width };
}
