import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syncEmailSubscription } from '@/lib/onesignal';
import { supabase } from '@/lib/supabase/client';

export function useEmailConsent(userId?: string | null, email?: string | null) {
  const client = useQueryClient();
  const queryKey = ['notification-consent', userId];
  const query = useQuery({
    queryKey,
    enabled: Boolean(userId),
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('notification_consents')
        .select('monthly_email').eq('user_id', userId!).abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data?.monthly_email === true;
    },
  });
  const mutation = useMutation({
    networkMode: 'always', // No deferred opt-in after the user has left this account.
    retry: false,
    mutationFn: async (enabled: boolean) => {
      if (!userId || (enabled && !email)) throw new Error('Verified email required');
      await client.cancelQueries({ queryKey });
      const { error } = await supabase.from('notification_consents')
        .upsert({ user_id: userId, monthly_email: enabled }, { onConflict: 'user_id' });
      if (error) throw error;
      // Only this explicit gesture can subscribe. Reading consent never reverses
      // an unsubscribe performed through an email's OneSignal unsubscribe link.
      syncEmailSubscription(userId, email, enabled);
      client.setQueryData(queryKey, enabled);
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  return { enabled: query.data === true, loaded: query.isSuccess && query.isFetchedAfterMount, ...mutation };
}
