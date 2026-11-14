type Entry<T> = { items: T[]; updatedAt: number; retryAt: number; failed: boolean };
export type FeedCacheResult<T> = { items: T[]; failed: boolean; stale: boolean };

// Per-feed last-good values prevent one failed publisher from removing its
// stories. One pending fetch is shared even by explicit concurrent refreshes.
export function createFeedCache<T>(now: () => number = Date.now) {
  const entries = new Map<string, Entry<T>>();
  const pending = new Map<string, Promise<FeedCacheResult<T>>>();
  return {
    async read(key: string, load: () => Promise<T[]>, fresh = false): Promise<FeedCacheResult<T>> {
      const current = entries.get(key);
      const alive = current && now() - current.updatedAt <= 1800000;
      if (current && now() < current.retryAt && (current.failed || !fresh)) {
        return { items: alive ? current.items : [], failed: current.failed, stale: Boolean(alive && current.failed && current.items.length) };
      }
      const running = pending.get(key);
      if (running) return running;
      const request = (async () => {
        try {
          const items = await load();
          if (!items.length) throw new Error("empty-feed");
          entries.set(key, { items, updatedAt: now(), retryAt: now() + 90000, failed: false });
          return { items, failed: false, stale: false };
        } catch {
          const usable = current && now() - current.updatedAt <= 1800000;
          const entry = { items: usable ? current.items : [], updatedAt: current?.updatedAt ?? 0, retryAt: now() + 15000, failed: true };
          entries.set(key, entry);
          return { items: entry.items, failed: true, stale: Boolean(usable && entry.items.length) };
        } finally { pending.delete(key); }
      })();
      pending.set(key, request);
      return request;
    },
  };
}
