/** Unknown or stale device timezone means no discretionary alert. */
export function notificationLocalMinute(tags: Record<string, unknown> | undefined, now: Date): number | null {
  const synced = Number(tags?.tags_synced_at);
  const zone = tags?.notification_timezone;
  const age = now.getTime() - synced;
  if (typeof zone !== 'string' || !zone || !Number.isFinite(age) || age < 0 || age > 86_400_000) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
  } catch { return null; }
}

export async function userLocalMinute(appId: string, apiKey: string, userId: string, now: Date, kind: string): Promise<number | null> {
  try {
    const response = await fetch(`https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (user?.errors) return null;
    const tags = user?.properties?.tags;
    const muted = tags?.nudge_muted;
    if (muted != null && typeof muted !== 'string') return null;
    if (muted?.split(',').map((value: string) => value.trim()).includes(kind)) return null;
    return notificationLocalMinute(tags, now);
  } catch { return null; }
}

/**
 * La langue d'affichage d'un joueur, pour ce que OneSignal ne sait pas
 * localiser seul : le contenu d'une Live Activity est un payload unique, pas
 * une table fr/en. Tag `locale` posé par l'app, sinon langue OneSignal ; tout
 * ce qui n'est pas du français retombe sur l'anglais, comme les pushs.
 */
export async function userLocale(appId: string, apiKey: string, userId: string): Promise<'fr' | 'en'> {
  try {
    const response = await fetch(`https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(8000),
    });
    const user = response.ok ? await response.json() : null;
    const langue = String(user?.properties?.tags?.locale ?? user?.properties?.language ?? '');
    return langue.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch { return 'en'; }
}
