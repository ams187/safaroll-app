import { supabase } from '@/lib/supabase/client';
import type { Message } from './chat-store';

export type SavedConversation = {
  id: string;
  messages: Message[];
  pinned: boolean;
  previousResponseId?: string;
  title: string;
  updatedAt: string;
};

type ConversationRow = {
  id: string;
  messages: Message[];
  pinned: boolean;
  previous_response_id: string | null;
  title: string;
  updated_at: string;
};

const fromRow = (row: ConversationRow): SavedConversation => ({
  id: row.id,
  messages: row.messages,
  pinned: row.pinned,
  previousResponseId: row.previous_response_id ?? undefined,
  title: row.title,
  updatedAt: row.updated_at,
});

/** Le tri de l'historique, en un seul endroit : le serveur ET le tiroir s'en servent. */
export const byPinnedThenRecent = (a: SavedConversation, b: SavedConversation) =>
  Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

export async function listGuideConversations(): Promise<SavedConversation[]> {
  const { data, error } = await supabase
    .from('guide_conversations')
    .select('id,title,messages,pinned,previous_response_id,updated_at')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as ConversationRow[]).map(fromRow);
}

/**
 * `pinned` est volontairement HORS de cette signature. C'est un `upsert`, et
 * réécrire la colonne à chaque réponse du Guide désépinglerait la discussion
 * en cours dès qu'elle répond. L'épinglage a sa propre écriture.
 */
export async function saveGuideConversation(conversation: Omit<SavedConversation, 'pinned' | 'updatedAt'>) {
  const { error } = await supabase.from('guide_conversations').upsert({
    id: conversation.id,
    messages: conversation.messages,
    previous_response_id: conversation.previousResponseId ?? null,
    title: conversation.title,
  });
  if (error) throw error;
}

export async function deleteGuideConversation(id: string) {
  const { error } = await supabase.from('guide_conversations').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Renommer et épingler ne passent PAS par `saveGuideConversation`.
 *
 * Celui-ci écrit `messages` et `previous_response_id`, ce qui ferait remonter
 * la discussion en tête de l'historique (voir le déclencheur
 * `guide_conversations_touch`). Deux écritures ciblées, deux colonnes.
 */
export async function renameGuideConversation(id: string, title: string) {
  const { error } = await supabase.from('guide_conversations').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function pinGuideConversation(id: string, pinned: boolean) {
  const { error } = await supabase.from('guide_conversations').update({ pinned }).eq('id', id);
  if (error) throw error;
}
