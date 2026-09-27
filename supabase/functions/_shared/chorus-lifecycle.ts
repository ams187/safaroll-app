import type { SupabaseClient } from '@supabase/supabase-js';

/** Called by the existing minute cron, independently of morning eligibility. */
export async function closeExpiredChoruses(db: SupabaseClient, appId: string, key: string, now = new Date()) {
  const retryBefore = new Date(+now - 60_000).toISOString();
  const { data, error } = await db.from('chorus_activities').select('id,content_state')
    .is('ended_at', null).lte('expires_at', now.toISOString())
    .or(`attempted_at.is.null,attempted_at.lt.${retryBefore}`).order('expires_at').limit(10);
  if (error) throw new Error('Cannot read expired chorus activities');
  let closed = 0, failed = 0;
  await Promise.all((data ?? []).map(async row => {
    try {
      const claim = await db.from('chorus_activities').update({ attempted_at: now.toISOString() })
        .eq('id', row.id).is('ended_at', null)
        .or(`attempted_at.is.null,attempted_at.lt.${retryBefore}`).select('id');
      if (claim.error) throw new Error('Cannot claim chorus closure');
      if (!claim.data?.length) return;
      const state = await db.rpc('chorus_activity_state', { p_activity: row.id });
      if (state.error || !state.data) throw new Error('Cannot read final chorus state');
      const response = await fetch(`https://api.onesignal.com/apps/${appId}/live_activities/${encodeURIComponent(row.id)}/notifications`, {
        method: 'POST', headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'end', name: 'Fin du choeur', event_updates: { data: state.data },
          dismissal_date: Math.floor(+now / 1000) - 1, priority: 10 }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json().catch(() => null);
      const absent = response.status === 404 && Array.isArray(result?.errors) &&
        result.errors.length === 1 && result.errors[0] === 'activity_id not found in this app';
      if (!absent && (!response.ok || typeof result?.id !== 'string' || !result.id.trim() || result.errors?.length)) {
        throw new Error(`Chorus closure rejected: HTTP ${response.status}`);
      }
      const ack = await db.from('chorus_activities').update({ ended_at: now.toISOString(), error: null }).eq('id', row.id);
      if (ack.error) throw new Error('Cannot acknowledge chorus closure');
      closed++;
    } catch (error) {
      failed++;
      await db.from('chorus_activities').update({ error: String(error).slice(0, 300) }).eq('id', row.id);
    }
  }));
  return { closed, failed };
}

/** No activity registered for this player means no OneSignal request. */
export async function updateChorusActivity(db: SupabaseClient, appId: string, key: string, userId: string, now = new Date()) {
  const { data, error } = await db.from('chorus_activities').select('id')
    .eq('user_id', userId).is('ended_at', null).lte('started_at', now.toISOString()).gt('expires_at', now.toISOString());
  if (error) throw new Error('Cannot read active chorus');
  for (const row of data ?? []) {
    const state = await db.rpc('chorus_activity_state', { p_activity: row.id });
    if (state.error || !state.data) throw new Error('Cannot read chorus count');
    const response = await fetch(`https://api.onesignal.com/apps/${appId}/live_activities/${encodeURIComponent(row.id)}/notifications`, {
      method: 'POST', headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'update', name: 'Chasse de l aube', event_updates: { data: state.data }, priority: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Chorus update HTTP ${response.status}`);
    const result = await response.json();
    if (typeof result?.id !== 'string' || !result.id.trim() || result.errors?.length) throw new Error('Chorus update rejected');
  }
}
