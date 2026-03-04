/**
 * Cloudflare KV Cache Utilities
 *
 * Wrapper for Cloudflare KV operations with type safety.
 */

export interface DashboardStats {
  timestamp: string;
  agents: {
    total: number;
    trusted: number;
    sandbox: number;
    avg_score: number;
    last_update?: string;
  };
  trustDistribution: Array<{
    band: string;
    count: number;
  }>;
  status: 'healthy' | 'degraded' | 'error';
  syncDurationMs?: number;
}

export class EdgeCache {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}

export async function getDashboardStats(
  kv: KVNamespace
): Promise<DashboardStats | null> {
  const cache = new EdgeCache(kv);
  return cache.get<DashboardStats>('dashboard:public-stats');
}

export async function getSyncError(
  kv: KVNamespace
): Promise<{ timestamp: string; error: string } | null> {
  const cache = new EdgeCache(kv);
  return cache.get('dashboard:sync-error');
}
