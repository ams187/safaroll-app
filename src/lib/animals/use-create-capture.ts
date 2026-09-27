import { dominantColorFor } from '@/lib/animals/dominant-color';
import { shrinkSticker, shrinkStickerThumb, stickerThumbPath, type Payload } from '@/lib/animals/photo-payload';
import { queryClient } from '@/lib/query-client';
import { invalidateFamilies } from '@/lib/supabase/backend';
import { supabase } from '@/lib/supabase/client';
import { uploadImage, uploadImageAt } from '@/lib/supabase/storage';
import { useAuth } from '@clerk/expo';
import { useCallback } from 'react';

export function useCreateAnimalCapture() {
  const { userId } = useAuth();

  return useCallback(
    async ({
      onStage,
      photo,
      sticker,
      captureSource,
      width,
      height,
      capturedAt,
      location,
      visionLabels,
    }: {
      /** Called after each stage, for the capture-latency breakdown. */
      onStage?: (stage: string) => void;
      /** Already downscaled — the same copy Vision was handed. */
      photo: Payload;
      /** The die-cut, still being lifted. Deliberately not awaited up front. */
      sticker?: Promise<string | null>;
      captureSource: 'camera' | 'library';
      width: number;
      height: number;
      capturedAt?: number;
      location?: { latitude: number; longitude: number };
      /**
       * Ce qu'Apple a vu sur le sujet DÉTOURÉ. Le serveur s'en sert d'arbitre
       * quand BioCLIP répond une espèce sauvage sur un animal domestique —
       * mesuré : un shiba rendu « loup gris » à 1,000. Rien n'est décidé ici,
       * on transmet un constat brut.
       */
      visionLabels?: { confidence: number; identifier: string }[];
    }) => {
      // Everything on this path is time the user spends staring at a trembling
      // animal, so it holds exactly one upload — the downscaled photo, the only
      // thing the identification actually reads.
      if (!userId) throw new Error('Not authenticated');
      const originalPath = await uploadImage('capture-originals', userId, photo.uri, photo.contentType);
      onStage?.('upload');
      const { data: captureId, error } = await supabase.rpc('create_capture', {
        p_original_path: originalPath,
        p_sticker_path: null,
        p_capture_source: captureSource,
        p_aspect_ratio: width / height,
        p_captured_at: capturedAt === undefined ? null : new Date(capturedAt).toISOString(),
        p_dominant_color: null,
        p_latitude: location?.latitude ?? null,
        p_longitude: location?.longitude ?? null,
        p_vision_labels: visionLabels?.length ? visionLabels : null,
      });
      if (error || !captureId) {
        // UN REFUS N'EST PAS UNE PANNE, ET LES CONFONDRE COÛTE CHER.
        //
        // L'appelant met les captures en file d'attente quand le réseau lâche —
        // c'est juste, une rencontre hors couverture ne doit pas se perdre. Mais
        // il le faisait pour TOUTE erreur, y compris « énergie épuisée » : la
        // photo repartait alors indéfiniment contre un plafond qui ne bouge
        // qu'à minuit, et l'écran montrait une analyse qui n'aurait jamais lieu.
        //
        // `P0001` est le code que Postgres donne à un `raise exception`. Il ne
        // peut pas arriver sans réponse du serveur : c'est donc le seul
        // discriminant sûr entre « il a dit non » et « il n'a pas répondu ».
        throw Object.assign(new Error(error?.message ?? 'Capture creation failed'), {
          refusServeur: error?.code === 'P0001',
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.listCaptures'] });
      void supabase.functions
        .invoke('identify-animal', { body: { captureId } })
        .then(async ({ error: identificationError }) => {
          if (identificationError) throw identificationError;
          onStage?.('BioCLIP terminé');
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.getCapture'] }),
            queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.listCaptures'] }),
          ]);
        })
        .catch((identificationError) => {
          // The capture row already exists. The camera's targeted polling and
          // the foreground retry queue recover it without creating a duplicate.
          console.warn('BioCLIP request failed; capture will retry:', identificationError);
        });
      onStage?.('createCapture → BioCLIP démarre');

      // BioCLIP is now running. The card artwork is heavier than the photo and
      // nothing is blocked on it, so it catches up in the background and the
      // reveal simply re-renders when it lands.
      void (async () => {
        const stickerUri = sticker ? await sticker : null;
        const [stickerPath, dominantColor] = await Promise.all([
          stickerUri
            ? shrinkSticker(stickerUri)
                .then((payload) =>
                  uploadImage('capture-stickers', userId, payload.uri, payload.contentType),
                )
                .then(async (chemin) => {
                  // LA VIGNETTE PART APRÈS, ET SON ÉCHEC NE COÛTE RIEN.
                  //
                  // Elle sert la grille (voir `shrinkStickerThumb`) : 0,6 Mo en
                  // mémoire au lieu de 7,8. Mais elle n'est pas nécessaire à
                  // l'affichage — sans elle, la grille retombe sur le détourage
                  // pleine taille, exactement comme avant. On ne fait donc
                  // jamais échouer la capture pour elle.
                  //
                  // Et surtout : on est ici APRÈS `createCapture`, dans le bloc
                  // d'arrière-plan. La règle du projet — un seul envoi avant
                  // `createCapture`, jamais deux — reste tenue.
                  try {
                    const vignette = await shrinkStickerThumb(stickerUri);
                    await uploadImageAt(
                      'capture-stickers',
                      stickerThumbPath(chemin),
                      vignette.uri,
                      vignette.contentType,
                    );
                  } catch {
                    // Tant pis : la grille lira le détourage entier.
                  }
                  return chemin;
                })
            : undefined,
          // Sampled from the original cut-out, not the re-encoded copy: it is
          // already on disk, and the swatch should read the animal's real
          // colour rather than whatever the encoder settled on. On the full
          // photo it would lock onto the sky or the grass instead.
          dominantColorFor(stickerUri ?? photo.uri),
        ]);
        if (!stickerPath && !dominantColor) return;
        const { error: artworkError } = await supabase.rpc('attach_capture_artwork', {
          target_capture_id: captureId,
          p_sticker_path: stickerPath ?? null,
          p_dominant_color: dominantColor ?? null,
        });
        if (artworkError) throw new Error(artworkError.message);
        // CIBLÉ, ET C'EST LE PIRE ENDROIT OÙ ÇA NE L'ÉTAIT PAS.
        //
        // C'était `invalidateQueries()` sans filtre : le détourage se pose au
        // moment PRÉCIS où la carte se révèle, et cette ligne relançait alors
        // toutes les requêtes actives — dont le catalogue, 5 576 espèces sur
        // six pages HTTP, ~3 Mo de JSON à reconstruire sur le fil JS. Soit un
        // gel de plusieurs secondes posé exactement sur l'animation qu'on
        // voulait fluide, et un pic mémoire pendant que le téléphone tient déjà
        // la photo, le détourage et la carte.
        //
        // Seule la capture a changé.
        await invalidateFamilies(['animals.']);
      })().catch(() => undefined);

      return captureId;
    },
    [userId],
  );
}

/** @deprecated Compatibility alias while imports migrate. */
export const useCreateBirdCapture = useCreateAnimalCapture;
