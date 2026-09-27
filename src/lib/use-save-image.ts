import type { Id } from '@/lib/supabase/api';
import { supabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/supabase/storage';
import { useAuth } from '@clerk/expo';
import { useCallback } from 'react';

export type LocalImage = {
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string;
  /** Marks a subject-lifted die-cut PNG so the feed renders it as a sticker. */
  isSticker?: boolean;
  /** Original camera-roll capture time (epoch ms), read from EXIF on import. */
  capturedAt?: number;
  /** Where the photo was taken (signed decimal degrees), read from EXIF or
   * the media library on import. Set both or neither. */
  latitude?: number;
  longitude?: number;
};

/**
 * Uploads local image files to Supabase Storage and creates items for them.
 * Returns a function that resolves with the created item ids once every
 * image has been handed off — AI tagging continues server-side afterwards.
 */
export function useSaveImages() {
  const { userId } = useAuth();

  return useCallback(
    async (
      images: LocalImage[],
      options?: { spaceId?: Id<'spaces'> },
    ): Promise<Id<'items'>[]> => {
      return await Promise.all(
        images.map(async (image) => {
          if (!userId) throw new Error('Not authenticated');
          const storagePath = await uploadImage('items', userId, image.uri, image.mimeType ?? 'image/jpeg');
          const aspectRatio =
            image.width && image.height ? image.width / image.height : undefined;
          const { data, error } = await supabase.from('items').insert({
            type: 'image', status: 'processing', storage_path: storagePath, aspect_ratio: aspectRatio,
            is_sticker: image.isSticker, captured_at: image.capturedAt ? new Date(image.capturedAt).toISOString() : null,
            latitude: image.latitude, longitude: image.longitude,
          }).select('id').single();
          if (error) throw new Error(error.message);
          if (options?.spaceId) await supabase.from('space_items').insert({ space_id: options.spaceId, item_id: data.id, status: 'saved' });
          void supabase.functions.invoke('process-item', { body: { itemId: data.id } });
          return data.id;
        }),
      );
    },
    [userId],
  );
}
