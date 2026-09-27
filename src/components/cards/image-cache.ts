// The bookkeeping behind `card-image.ts`, with nothing native in it so
// `scripts/check-card-image.ts` can run it under bun.
//
// Two things here can be quietly wrong in a way no screenshot shows: a key
// that never repeats (the cache appears to work and never hits), and an
// eviction rule that never fires (the app grows until it is killed). Both are
// arithmetic, so both are pinned.

/**
 * Sizes are rounded UP to a power of two so the same artwork asked for at 246
 * and 252 pixels is one decode, not two. Rounding down would hand back an
 * image smaller than it is drawn at, which is a visible softening.
 */
export function sizeBucket(maxEdge: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, maxEdge)));
}

/**
 * The cache key for one source at one drawn size. `null` for sources that
 * cannot be identified by value — raw bytes have no stable name, so caching
 * them would key every distinct buffer to the same entry.
 */
export function imageKey(source: unknown, maxEdge?: number): string | null {
  if (source === null || source === undefined) return null;
  const id =
    typeof source === 'number'
      ? `asset:${source}`
      : typeof source === 'string'
        ? source
        : null;
  if (id === null) return null;
  return `${id}@${maxEdge ? sizeBucket(maxEdge) : 0}`;
}

export type BudgetCache<T> = {
  get: (key: string) => T | undefined;
  /** Bytes currently held — the number the budget is enforced against. */
  held: () => number;
  keys: () => string[];
  put: (key: string, value: T, bytes: number) => void;
};

/**
 * Least-recently-used, bounded by bytes rather than by count: the entries are
 * images, and one full-size card is worth thirty grid ones.
 *
 * Eviction drops the reference and nothing else. Whatever is still mounted
 * keeps drawing its own copy until it lets go — freeing here would hand a
 * disposed image to a card that is still on screen.
 */
export function createBudgetCache<T>(budget: number): BudgetCache<T> {
  // A Map iterates in insertion order, so re-inserting on a hit IS the LRU.
  const entries = new Map<string, { bytes: number; value: T }>();
  let held = 0;

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    held: () => held,
    keys: () => [...entries.keys()],
    put(key, value, bytes) {
      const previous = entries.get(key);
      if (previous) held -= previous.bytes;
      entries.delete(key);
      entries.set(key, { bytes, value });
      held += bytes;
      for (const [oldest, entry] of entries) {
        if (held <= budget) break;
        // Never the entry just stored: a single image larger than the whole
        // budget would otherwise be evicted before it was ever handed out.
        if (oldest === key) break;
        entries.delete(oldest);
        held -= entry.bytes;
      }
    },
  };
}
