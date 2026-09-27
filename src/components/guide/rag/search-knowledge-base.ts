import { supabase } from '@/lib/supabase/client';

export async function searchSafaRollKb(query: string, topK = 5): Promise<string> {
  const { data, error } = await supabase.functions.invoke('guide-search', {
    body: { query, topK },
  });
  if (error) throw error;
  return typeof data?.context === 'string' ? data.context : '';
}
