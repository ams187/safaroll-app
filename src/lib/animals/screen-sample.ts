// Les pixels que le garde anti-écran inspecte.
//
// `screen-capture-guard` est une fonction pure : on lui donne une luminance,
// elle rend un verdict. Ce fichier est la moitié impure — celle qui va lire la
// photo. Les deux restent séparés parce que le verdict est testé (`check:screen`)
// et qu'un test ne peut pas décoder un JPEG.
//
// POURQUOI 64 PX DE LARGE
//
// Le moiré cherché est une ondulation de 3 à 16 pixels de période DANS CE
// BUFFER. Trop grand, la grille de l'écran photographié tombe sous la période
// de 3 et devient invisible ; trop petit, il ne reste pas assez d'échantillons
// pour qu'une période se distingue du bruit. 64 est la largeur sur laquelle les
// seuils du garde ont été calibrés.
//
// POURQUOI PAS DE MIPMAP ICI
//
// `photo-payload` en met, et a raison : un mipmap moyenne les pixels perdus et
// empêche le crénelage. C'est exactement ce qu'il ne faut pas ici — il lisserait
// le moiré, c'est-à-dire le signal qu'on vient chercher. On échantillonne dur.

import { FilterMode, MipmapMode, Skia } from '@shopify/react-native-skia';

import { lumaFromRgba } from './screen-capture-guard';

/** La largeur sur laquelle les seuils de `screen-capture-guard` sont calibrés. */
const SAMPLE_WIDTH = 64;

export type LumaSample = { height: number; luma: number[]; width: number };

/**
 * La luminance de `uri`, réduite à une vignette. `null` si Skia ne sait pas
 * lire le fichier — auquel cas le garde ne dira rien, ce qui est la bonne
 * réponse : pas de preuve, pas d'accusation.
 */
export async function lumaSampleFor(uri: string): Promise<LumaSample | null> {
  try {
    const source = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!source) return null;
    const sourceWidth = source.width();
    const sourceHeight = source.height();
    if (sourceWidth < 1 || sourceHeight < 1) return null;

    const width = SAMPLE_WIDTH;
    const height = Math.max(8, Math.round((sourceHeight / sourceWidth) * SAMPLE_WIDTH));
    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return null;
    surface.getCanvas().drawImageRectOptions(
      source,
      Skia.XYWHRect(0, 0, sourceWidth, sourceHeight),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Nearest,
      MipmapMode.None,
    );
    surface.flush();

    const pixels = surface.makeImageSnapshot().readPixels();
    if (!pixels || pixels.length < width * height * 4) return null;

    return { height, luma: lumaFromRgba(pixels, width * height), width };
  } catch {
    return null;
  }
}
