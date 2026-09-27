import { listPending, release } from '@/lib/animals/capture-queue';
import { useCreateAnimalCapture } from '@/lib/animals/use-create-capture';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Drains the offline capture queue.
 *
 * There is no connectivity library in this app, and adding one would buy less
 * than it costs: "the device has an interface up" is not the same question as
 * "Supabase is reachable", which is what actually matters here. The drain runs
 * on mount and whenever the app comes back to the foreground. A capture that
 * fails stays queued and the drain stops, because
 * one failure means the rest will fail too.
 */
export function useCaptureQueue() {
  const createCapture = useCreateAnimalCapture();
  const draining = useRef(false);
  const [pending, setPending] = useState(() => listPending().length);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      for (const capture of listPending()) {
        try {
          await createCapture({
            capturedAt: capture.capturedAt,
            captureSource: capture.captureSource,
            height: capture.height,
            photo: {
              contentType: capture.contentType ?? 'image/jpeg',
              uri: capture.originalUri,
            },
            sticker: Promise.resolve(capture.stickerUri ?? null),
            width: capture.width,
            ...(capture.latitude !== undefined && capture.longitude !== undefined
              ? { location: { latitude: capture.latitude, longitude: capture.longitude } }
              : {}),
          });
          release(capture.id);
          setPending(listPending().length);
        } catch {
          // Still unreachable. Leave the rest queued for the next signal.
          break;
        }
      }

      // A capture can reach Postgres just before the identification request
      // loses connectivity. Re-submit those idempotently on the same signals
      // so no card can stay stuck on "processing" forever.
      const { data } = await supabase
        .from('animal_captures')
        .select('id')
        .eq('status', 'processing')
        .order('created_at')
        .limit(10);
      let retriedIdentification = false;
      for (const capture of data ?? []) {
        const { error } = await supabase.functions.invoke('identify-animal', { body: { captureId: capture.id } });
        if (error) break;
        retriedIdentification = true;
      }
      if (retriedIdentification) {
        await queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.listCaptures'] });
      }
    } finally {
      draining.current = false;
      setPending(listPending().length);
    }
  }, [createCapture]);

  useEffect(() => {
    void drain();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void drain();
    });
    return () => {
      appState.remove();
    };
  }, [drain]);

  return { drain, pending };
}
