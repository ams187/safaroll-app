import { File } from 'expo-file-system';
import { supabase } from './client';

function extension(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

export async function uploadImage(
  bucket: 'capture-originals' | 'capture-stickers' | 'items',
  userId: string,
  uri: string,
  contentType: string,
) {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension(contentType)}`;
  return uploadImageAt(bucket, path, uri, contentType);
}

/**
 * Même chose, mais à un chemin IMPOSÉ.
 *
 * Sert à la vignette du détourage, dont le chemin se déduit de celui de
 * l'original (`stickerThumbPath`) : les deux doivent se retrouver l'un l'autre
 * sans qu'aucune colonne ne les relie.
 *
 * `upsert: true` ici, contrairement au tirage aléatoire ci-dessus : un chemin
 * déduit est stable, donc un renvoi doit écraser plutôt qu'échouer — c'est ce
 * qui rend le script de rattrapage rejouable.
 */
export async function uploadImageAt(
  bucket: 'capture-originals' | 'capture-stickers' | 'items',
  path: string,
  uri: string,
  contentType: string,
) {
  const body = await new File(uri).arrayBuffer();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

