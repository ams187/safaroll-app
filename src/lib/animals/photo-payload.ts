// What actually leaves the phone.
//
// A 12 MP capture is ~4 MB of HEIC, and its die-cut is a full-resolution PNG
// with an alpha channel — those averaged 7.6 MB each, one reached 22.6 MB.
// Nothing downstream wants those pixels: BioCLIP resizes its input to 224px
// before it looks at it, and the card never draws the sticker above ~340pt.
//
// Everything that can be re-encoded becomes **lossy WebP**. Two reasons it is
// the right format here rather than a smaller JPEG or a heavier PNG:
//
//   - libwebp codes the alpha channel losslessly by default, so a lossy WebP
//     keeps the die-cut edge pixel-exact and only approximates the colour.
//     That is precisely the tradeoff a cut-out animal wants — the silhouette
//     is the thing the eye checks, and it is the thing that stays perfect.
//   - AVIF compresses ~30-50% better still, but encodes 5-10x slower (seconds
//     for a single image). This runs while the user waits, so it is out.
//
// Skia is the encoder because it is the only thing already linked that can
// write WebP; nitro-image only offers jpg/png/heic. Skia's codecs do not cover
// HEIC though, so a camera photo falls through to the nitro-image path and
// stays a JPEG — small either way once it has been downscaled.
import { FilterMode, ImageFormat, MipmapMode, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { Image } from 'react-native-nitro-image';
import { cropRect, type SubjectCrop } from './subject-crop';

type ImageFactory = { loadFromFileAsync: (path: string) => Promise<Image> };

let images: ImageFactory | null = null;
try {
  // Nitro creates the factory at import time, so an unlinked build throws here.
  images = (require('react-native-nitro-image') as { Images: ImageFactory }).Images;
} catch {
  images = null;
}

/** What to upload, and what to honestly label it as. */
export type Payload = { contentType: string; uri: string };

/** Comfortably above what BioCLIP or any phone screen can use. */
const ID_MAX_EDGE = 1600;
/** The card draws the die-cut at ~340pt — 1400px covers a 3x screen twice over. */
const STICKER_MAX_EDGE = 1400;

/** Photographs sit in the 75-85 band where JPEG is indistinguishable by eye. */
const ID_QUALITY = 82;
/** The die-cut is the hero of the card and shown big, so it buys the 90-95 band. */
const STICKER_QUALITY = 92;

/**
 * The working copy of the capture: what BioCLIP identifies from, what the
 * detail screen shows, and — crucially — what `subject-lift` runs Vision on.
 *
 * Deliberately JPEG rather than WebP. It is read back by a native Swift module
 * and by Pillow on the server, and the ~70 KB WebP would save here is not worth
 * either of them failing to decode it. The die-cut, where the savings actually
 * were, is still WebP.
 */
export function shrinkForIdentification(uri: string, crop?: SubjectCrop): Promise<Payload> {
  return shrink(uri, ID_MAX_EDGE, ID_QUALITY, 'jpg', 'image/jpeg', 'jpg', crop);
}

/** The card artwork. Keeps its alpha whichever branch encodes it. */
export function shrinkSticker(uri: string): Promise<Payload> {
  return shrink(uri, STICKER_MAX_EDGE, STICKER_QUALITY, 'png', 'image/png', 'webp');
}

/**
 * LA VIGNETTE DU DÉTOURAGE — CE QUE LA GRILLE AFFICHE.
 *
 * UN PETIT FICHIER N'EST PAS UNE PETITE IMAGE
 *
 * Le détourage pèse ~90 Ko sur le réseau, parce que le WebP compresse
 * admirablement une découpe pleine de transparence. Mais pour l'AFFICHER, le
 * téléphone doit le déplier en pixels bruts :
 *
 *   1400 × 1400 × 4 octets = 7,8 Mo en mémoire
 *    384 ×  384 × 4 octets = 0,6 Mo
 *
 * Multiplié par toutes les cartes montées dans la grille, c'est la différence
 * entre un scroll fluide et un téléphone qui purge son cache en pleine course.
 *
 * POURQUOI 384 ET PAS PLUS PETIT
 *
 * Le détourage s'affiche à ~287 px dans une carte de grille (84 % de 342 px sur
 * un écran 3×). 384 laisse de la marge pour les plus grands iPhone sans repartir
 * vers le suréchantillonnage qu'on cherche à tuer.
 *
 * ELLE NE REMPLACE PAS L'ORIGINAL
 *
 * La carte ouverte, la révélation et l'export vidéo continuent de lire le
 * détourage pleine taille : c'est là qu'on voit les plumes. La vignette ne sert
 * qu'aux vues où l'animal fait moins de 300 px.
 */
const STICKER_THUMB_EDGE = 384;

export function shrinkStickerThumb(uri: string): Promise<Payload> {
  return shrink(uri, STICKER_THUMB_EDGE, STICKER_QUALITY, 'png', 'image/png', 'webp');
}

/**
 * Le chemin de la vignette qui accompagne un détourage.
 *
 * Déduit du chemin de l'original plutôt que stocké en base : pas de colonne à
 * ajouter, pas de migration, et le lien entre les deux ne peut pas se rompre.
 * Le client comme les scripts de rattrapage appliquent la même règle.
 */
export function stickerThumbPath(stickerPath: string): string {
  return stickerPath.replace(/(\.[a-z0-9]+)$/i, '-thumb$1');
}

async function shrink(
  uri: string,
  maxEdge: number,
  quality: number,
  fallbackFormat: 'jpg' | 'png',
  fallbackType: string,
  prefer: 'webp' | 'jpg',
  crop?: SubjectCrop,
): Promise<Payload> {
  return (
    (await viaSkia(uri, maxEdge, quality, prefer, crop)) ??
    // Le repli natif ne sait pas recadrer. Une photo entière vaut mieux que pas
    // de capture : on perd le gain de précision, jamais la prise.
    (await toNative(uri, maxEdge, fallbackFormat, fallbackType)) ?? {
      contentType: fallbackType,
      uri,
    }
  );
}

/** Decode → downscale → encode, entirely in Skia. Null if Skia can't read it. */
async function viaSkia(
  uri: string,
  maxEdge: number,
  quality: number,
  prefer: 'webp' | 'jpg',
  crop?: SubjectCrop,
): Promise<Payload | null> {
  try {
    const source = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
    if (!source) return null;
    // LE RECADRAGE NE COÛTE RIEN : `drawImageRectOptions` prend déjà un
    // rectangle SOURCE. On lui en donne un plus petit, et la passe de
    // redimensionnement qui existait de toute façon fait le reste.
    const box = crop ? cropRect(crop, source.width(), source.height()) : null;
    const sourceX = box?.x ?? 0;
    const sourceY = box?.y ?? 0;
    const sourceWidth = box?.width ?? source.width();
    const sourceHeight = box?.height ?? source.height();
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return null;
    surface.getCanvas().drawImageRectOptions(
      source,
      Skia.XYWHRect(sourceX, sourceY, sourceWidth, sourceHeight),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      // Mipmaps matter here: a 3x downscale sampled bilinearly drops most of
      // its source pixels on the floor and aliases the animal's feathers.
      MipmapMode.Linear,
    );
    surface.flush();
    const webp = prefer === 'webp';
    const bytes = surface
      .makeImageSnapshot()
      .encodeToBytes(webp ? ImageFormat.WEBP : ImageFormat.JPEG, quality);
    if (!bytes || bytes.length === 0) return null;
    return {
      contentType: webp ? 'image/webp' : 'image/jpeg',
      uri: writeTemporary(bytes, webp ? 'webp' : 'jpg'),
    };
  } catch {
    return null;
  }
}

/** UIImage-backed fallback — it reads HEIC, which Skia's codecs do not. */
async function toNative(
  uri: string,
  maxEdge: number,
  format: 'jpg' | 'png',
  contentType: string,
): Promise<Payload | null> {
  if (!images) return null;
  try {
    const image = await images.loadFromFileAsync(uri.replace(/^file:\/\//, ''));
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    if (scale === 1) return { contentType, uri };
    const resized = await image.resizeAsync(
      Math.round(image.width * scale),
      Math.round(image.height * scale),
    );
    return {
      contentType,
      uri: `file://${await resized.saveToTemporaryFileAsync(format, 80)}`,
    };
  } catch {
    return null;
  }
}

let payloadCounter = 0;

function writeTemporary(bytes: Uint8Array, extension: string): string {
  payloadCounter += 1;
  const file = new File(Paths.cache, `payload-${Date.now()}-${payloadCounter}.${extension}`);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}
