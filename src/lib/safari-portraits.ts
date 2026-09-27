import type { Capture } from './supabase/api';

/** Exact species only; a preview never changes the server's goal validation. */
export function safariPortraits(captures: readonly Capture[] = []) {
  const portraits = new Map<string, string>();
  for (const capture of captures) {
    const name = capture.scientificName?.trim().toLowerCase();
    const uri = capture.stickerThumbUrl || capture.stickerUrl;
    if (capture.status === 'ready' && name && uri && !portraits.has(name)) portraits.set(name, uri);
  }
  return portraits;
}
