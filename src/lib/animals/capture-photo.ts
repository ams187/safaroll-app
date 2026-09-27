// Turning a VisionCamera capture into a file the rest of the app can trust.
//
// The obvious call, `photo.saveToTemporaryFileAsync()`, writes the sensor's own
// pixels — which are landscape whatever way you were holding the phone — and
// records the rotation as an EXIF flag. VisionCamera documents this exactly:
// "orientation will be applied lazily via EXIF flags, or when converting the
// Photo to an Image".
//
// "Lazily" means every consumer has to know. `UIImage` and `<Image>` do; the
// lift stage does not — it decodes raw bytes through `createImageBitmap`, which
// has never heard of EXIF, so the animal came out lying on its side.
//
// `toImageAsync()` is the other half of that sentence: it bakes orientation and
// mirroring into the pixels. Everything downstream then reads an ordinary
// upright image, and nothing has to know where the photo came from.
//
// The downscale rides along because the alternative is decoding 12 MP twice —
// once for the WebGPU texture (seconds of black screen after the shutter) and
// again in `shrinkForIdentification`, which would have cut it to this same
// ceiling a moment later anyway.

import type { Photo } from 'react-native-vision-camera';

/** Twice what the 330pt lift canvas can show on a 3x screen. */
const MAX_EDGE = 1600;
/** Photographs sit in the band where JPEG is indistinguishable by eye. */
const QUALITY = 92;

export interface CapturedPhoto {
  height: number;
  /** `file://` URL, upright, JPEG, longest edge <= MAX_EDGE. */
  uri: string;
  width: number;
}

/**
 * Writes `photo` to a temporary file with its orientation applied and its
 * longest edge capped. The caller still owns `photo` and must dispose it.
 */
export async function writeUprightCapture(photo: Photo): Promise<CapturedPhoto> {
  const full = await photo.toImageAsync();
  const scale = Math.min(1, MAX_EDGE / Math.max(full.width, full.height));
  const image =
    scale < 1
      ? await full.resizeAsync(Math.round(full.width * scale), Math.round(full.height * scale))
      : full;
  const path = await image.saveToTemporaryFileAsync('jpg', QUALITY);
  return { height: image.height, uri: `file://${path}`, width: image.width };
}
