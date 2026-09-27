// Callers must order by a unique key. These reads are not a transaction-wide
// snapshot; eligibility/consent must still be checked before sending.
export async function notificationPages<T>(page: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: unknown;
}>): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  try {
    for (;;) {
      const result = await page(rows.length, rows.length + 499);
      if (result.error || !result.data) return { data: [], error: result.error || 'Missing page' };
      if (!result.data.length) return { data: rows, error: null };
      rows.push(...result.data);
    }
  } catch (error) {
    return { data: [], error };
  }
}
