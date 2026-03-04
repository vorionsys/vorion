/**
 * In-memory TTL cache for API data.
 * Prevents hammering external APIs on every request.
 * Resets on Vercel cold starts (acceptable for v1).
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get cached data or fetch fresh data if expired/missing.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = store.get(key) as CacheEntry<T> | undefined;
  if (existing && Date.now() < existing.expiresAt) {
    return existing.data;
  }

  const data = await fetcher();
  store.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  return data;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidate(key: string): void {
  store.delete(key);
}

/**
 * Clear the entire cache.
 */
export function clearAll(): void {
  store.clear();
}
