// Les die-cuts, en épingles de carte.
//
// Un sticker fait ~850x1050 et pèse ~90 Ko. Mapbox charge une image de style
// dans un atlas de texture décodée : 47 captures, ce sont ~170 Mo de bitmap
// pour dessiner des vignettes de 40pt. La carte n'y survit pas.
//
// Supabase sait retailler à la volée côté serveur, mais pas sur ce projet —
// `/storage/v1/render/image/...` répond `FeatureNotEnabled`. Donc on retaille
// sur l'appareil, une seule fois par capture, et on garde le résultat dans le
// cache disque : le deuxième affichage de la carte ne touche plus le réseau.
//
// Le sticker d'une capture ne change jamais, donc l'identifiant de la capture
// suffit comme clé — et surtout PAS l'URL signée, qui est réémise
// périodiquement et ferait retélécharger tout l'atlas à chaque rotation.

import { FilterMode, ImageFormat, MipmapMode, Skia } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';

/** Le côté du bitmap gardé en atlas. 40pt à l'écran, 3x de marge pour le zoom. */
const PIN_MAX_EDGE = 128;
/** Assez haut pour un die-cut minuscule ; le poids disque ne compte plus ici. */
const PIN_QUALITY = 90;
/** Deux téléchargements de front : le reste attend, la carte reste fluide. */
const CONCURRENCY = 2;
/** Fenêtre de regroupement des vignettes prêtes. Voir `usePinIcons`. */
const FLUSH_MS = 600;

const DIRECTORY = 'map-pins';

export type PinSource = { _id: string; stickerUrl: string | null };

/** L'identifiant sous lequel la couche Mapbox référence l'épingle. */
export function pinIconKey(captureId: string) {
  return `pin-${captureId}`;
}

/**
 * `{ 'pin-<id>': { uri: 'file://…' } }` pour les vignettes prêtes.
 *
 * L'objet `{ uri }` n'est pas cosmétique — une chaîne toute seule ne marche
 * PAS, en silence. Le JS de `<Images>` laisse passer une chaîne telle quelle
 * (`_isUrlOrPath`), mais le natif iOS ne sait lire qu'un dictionnaire :
 *
 *   if let image = image as? [String:Any] {   // RNMBXUtils.fetchImages
 *
 * Une `String` échoue ce cast, la boucle de chargement ne se déclenche jamais,
 * et rien n'est journalisé. Passer par `{ uri }` fait tomber la valeur dans la
 * branche `resolveAssetSource`, qui produit le dictionnaire attendu.
 *
 * Les résultats sont publiés par paquets, jamais un par un : côté natif,
 * `sameImage` ne sait comparer que des chaînes et renvoie donc toujours `false`
 * pour un dictionnaire — chaque changement de la table refait charger TOUTES
 * les entrées. Publier quarante fois coûterait quarante rechargements
 * complets. Une salve toutes les `FLUSH_MS` garde la carte vivante pour un
 * coût borné.
 */
export function usePinIcons(sources: PinSource[]): Record<string, { uri: string }> {
  const [icons, setIcons] = useState<Record<string, { uri: string }>>({});
  // Les URL signées changent d'identité à chaque réémission alors que les
  // images, elles, sont les mêmes. On ne redéclenche que sur la LISTE des
  // captures, pas sur leurs URL.
  const ids = sources
    .filter((source) => source.stickerUrl)
    .map((source) => source._id)
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const pending = sources.filter((source) => source.stickerUrl);
    const ready = new Map<string, { uri: string }>();
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (cancelled || ready.size === 0) return;
      setIcons((current) => ({ ...current, ...Object.fromEntries(ready) }));
    };

    async function worker() {
      while (!cancelled) {
        const source = pending[cursor++];
        if (!source) return;
        const uri = await ensurePin(source._id, source.stickerUrl!);
        if (!uri || cancelled) continue;
        ready.set(pinIconKey(source._id), { uri });
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
      }
    }

    void Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(flush);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `sources` est reconstruit à chaque rendu du parent ; `ids` est ce qui
    // décrit vraiment le travail à faire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return icons;
}

/** Le chemin de la vignette, en la fabriquant si elle n'existe pas encore. */
async function ensurePin(captureId: string, stickerUrl: string): Promise<string | null> {
  try {
    const directory = new Directory(Paths.cache, DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true });
    const file = new File(directory, `${captureId}.webp`);
    if (file.exists) return file.uri;

    const source = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(stickerUrl));
    if (!source) return null;
    const sourceWidth = source.width();
    const sourceHeight = source.height();
    const scale = Math.min(1, PIN_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return null;
    surface.getCanvas().drawImageRectOptions(
      source,
      Skia.XYWHRect(0, 0, sourceWidth, sourceHeight),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      // Une réduction par 7 échantillonnée en bilinéaire jette l'essentiel de
      // ses pixels : sans mipmaps le plumage crénèle.
      MipmapMode.Linear,
    );
    surface.flush();
    // WebP, pas JPEG : le découpage a un canal alpha, et c'est tout l'intérêt
    // d'une épingle en forme d'animal plutôt qu'en vignette rectangulaire.
    const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.WEBP, PIN_QUALITY);
    if (!bytes || bytes.length === 0) return null;
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  } catch {
    return null;
  }
}
