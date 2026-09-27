// Le nom d'une discussion, demandé au modèle.
//
// Jamais bloquant, jamais fatal : `null` à la moindre contrariété, et le
// magasin garde le titre de repli (le premier message tronqué). Un joueur qui
// n'est pas abonné, une clé absente côté serveur, le réseau qui tombe — dans
// tous ces cas la discussion démarre exactement comme avant.

import { supabase } from '@/lib/supabase/client';

export async function suggestConversationTitle(message: string): Promise<string | null> {
  const { data, error } = await supabase.functions
    .invoke('guide-title', { body: { message } })
    .catch(() => ({ data: null, error: true }));
  if (error) {
    if (__DEV__) console.warn('[guide] titre : appel refusé', error);
    return null;
  }
  const payload = data as { reason?: unknown; title?: unknown } | null;
  if (typeof payload?.title === 'string' && payload.title.trim()) return payload.title.trim();
  if (__DEV__) console.warn('[guide] titre non obtenu :', payload?.reason ?? 'sans raison');
  return null;
}
