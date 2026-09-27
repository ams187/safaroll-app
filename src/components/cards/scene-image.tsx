import { Image as ExpoImage } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

/**
 * L'image légère d'une miniature de carte.
 *
 * Expo Image garde les vignettes déjà vues en mémoire et réduit les rares
 * images plein format avant de les conserver. Nitro n'est pas utilisé ici :
 * sa vue efface son bitmap au recyclage, ce qui produisait le flash blanc lors
 * d'un demi-tour dans la collection.
 */
export function SceneImage({
  cacheKey,
  cachePolicy = 'memory-disk',
  fit = 'cover',
  onError,
  style,
  uri,
}: {
  cacheKey?: string;
  cachePolicy?: 'disk' | 'memory-disk';
  fit?: 'contain' | 'cover';
  onError?: () => void;
  style?: StyleProp<ImageStyle>;
  uri: string;
}) {
  return (
    <ExpoImage
      // `recyclingKey` efface volontairement la vue avant le prochain decode.
      // La grille réutilise cette même vue lors d'un demi-tour rapide : garder
      // son dernier bitmap jusqu'au remplacement évite la frame blanche.
      allowDownscaling
      cachePolicy={cachePolicy}
      contentFit={fit}
      enforceEarlyResizing
      onError={onError}
      source={{ cacheKey, uri }}
      style={style}
    />
  );
}
