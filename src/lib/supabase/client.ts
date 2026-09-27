import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

let accessToken: () => Promise<string | null> = async () => null;

export const supabase = createClient(url, publishableKey, {
  accessToken: () => accessToken(),
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export function setSupabaseAccessTokenProvider(provider: () => Promise<string | null>) {
  accessToken = provider;
}

/** The same Clerk token used by supabase-js, for authenticated WebSocket upgrades. */
export function getSupabaseAccessToken() {
  return accessToken();
}
