// Why a card's artwork is not loaded with Skia's own `useImage`.
//
// `useImage` keeps nothing: every mount calls `Skia.Data.fromURI` again and
// starts from `null`. In the collection that is fatal — the grid is a
// virtualised list with `recycleItems`, so scrolling to the bottom unmounts
// every card above, and coming back up remounts them. Each remount re-fetched
// the die-cut over the network and re-decoded it, so the cards came back as
// bare gradients and the animal popped in a moment later. That is the "cards
// unload, go blurry, then appear" the grid was doing on the way back up.
//
// So: decode once, keep the result, and hand it back synchronously on the next
// mount. Two details make that safe rather than a memory leak, both in
// `image-cache.ts` — the decode is sized to what the card actually draws, and
// the cache is bounded by bytes.

import { FilterMode, loadData, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useState } from 'react';
import { createBudgetCache, imageKey, sizeBucket } from './image-cache';

/** Decoded bytes held at once. ~170 grid cards, or ~11 full-size ones. */
const BUDGET = 64 * 1024 * 1024;

type Source = number | string | null | undefined;

const cache = createBudgetCache<SkImage>(BUDGET);
/** In-flight decodes, so eight cards of one species do not fetch it eight times. */
const pending = new Map<string, Promise<SkImage | null>>();

/**
 * The image behind a card, cached across mounts.
 *
 * `maxEdge` is the longest edge this will ever be drawn at, in PIXELS. Pass it
 * for artwork — a die-cut ships at up to 1400px (see `photo-payload.ts`) and a
 * card in a four-column grid is ~250px on a 3x screen, so holding the full
 * decode costs ~30x the memory for pixels no screen can show. Leave it off for
 * the foil textures, which are tiled at their own resolution.
 */
export function useCardImage(source: Source, maxEdge?: number): SkImage | null {
  const key = imageKey(source, maxEdge);
  // Read the cache during render, not in an effect. A recycled cell is handed
  // a new item while it stays mounted; resolving in an effect would leave the
  // previous animal on screen for a frame, which is the same flash by another
  // route.
  const cached = key ? cache.get(key) : undefined;
  const [loaded, setLoaded] = useState<{ image: SkImage; key: string } | null>(null);

  useEffect(() => {
    if (!key || source === null || source === undefined) return;
    if (cache.get(key)) return;
    let alive = true;
    void resolve(key, source, maxEdge).then((image) => {
      if (alive && image) setLoaded({ image, key });
    });
    return () => {
      alive = false;
    };
  }, [key, maxEdge, source]);

  if (cached) return cached;
  return loaded?.key === key ? loaded.image : null;
}

/**
 * Décode d'avance, pour que la carte ouverte n'ait rien à attendre.
 *
 * Deux caches sans rapport se partagent le même sticker : la grille le tire par
 * expo-image en petit, la carte ouverte par Skia en grand. Ce ne sont ni la même
 * taille, ni le même magasin — donc ouvrir une carte RETÉLÉCHARGE le die-cut et
 * le redécode, au moment précis où il faut l'afficher.
 *
 * Appelé au toucher, ou après un bref arrêt de scroll pour la seule rangée au
 * centre. Jamais au simple montage : un fling ne doit pas télécharger les
 * pleines images de cartes que personne n'a regardées. Le cache borné en octets
 * s'occupe du reste.
 */
export function prewarmCardImage(source: Source, maxEdge?: number): void {
  const key = imageKey(source, maxEdge);
  if (!key || source === null || source === undefined) return;
  if (cache.get(key)) return;
  void resolve(key, source, maxEdge).catch(() => undefined);
}

async function resolve(key: string, source: Source, maxEdge?: number): Promise<SkImage | null> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = decode(source, maxEdge ? sizeBucket(maxEdge) : undefined)
    .then((image) => {
      pending.delete(key);
      if (image) cache.put(key, image, image.width() * image.height() * 4);
      return image;
    })
    .catch(() => {
      pending.delete(key);
      return null;
    });
  pending.set(key, job);
  return job;
}

/**
 * Le fichier local si expo-image l'a déjà, l'URL sinon.
 *
 * La grille tire chaque die-cut par expo-image, qui le range dans SON cache
 * disque. Skia a le sien, et les deux ne se connaissent pas — ouvrir une carte
 * RETÉLÉCHARGEAIT donc une image déjà sur l'appareil, sur le réseau du joueur,
 * au moment précis où il fallait l'afficher.
 *
 * `getCachePathAsync` rend le chemin de ce fichier. Skia lit alors le disque.
 * Si l'image n'y est pas — carte jamais vue en grille — on retombe sur l'URL et
 * rien n'est perdu.
 */
async function localCopy(source: Source): Promise<Source> {
  if (typeof source !== 'string' || !source.startsWith('http')) return source;
  const path = await ExpoImage.getCachePathAsync(source).catch(() => null);
  return path ? (path.startsWith('file://') ? path : `file://${path}`) : source;
}

async function decode(source: Source, maxEdge?: number): Promise<SkImage | null> {
  const full = await loadData(await localCopy(source), (data) =>
    Skia.Image.MakeImageFromEncoded(data),
  );
  if (!full || !maxEdge) return full;
  const scale = maxEdge / Math.max(full.width(), full.height());
  if (scale >= 1) return full;

  const width = Math.max(1, Math.round(full.width() * scale));
  const height = Math.max(1, Math.round(full.height() * scale));
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) return full;
  surface.getCanvas().drawImageRectOptions(
    full,
    Skia.XYWHRect(0, 0, full.width(), full.height()),
    Skia.XYWHRect(0, 0, width, height),
    FilterMode.Linear,
    // Same reason as `photo-payload.ts`: a 5x downscale sampled bilinearly
    // throws away most of its source pixels and aliases the animal's feathers.
    MipmapMode.Linear,
  );
  surface.flush();
  return surface.makeImageSnapshot();
}
