/**
 * API Key Storage Layer
 *
 * Provides both in-memory and database-backed storage implementations
 * for API key management. Use the factory function to get the appropriate
 * store based on environment configuration.
 *
 * Features:
 * - CRUD operations for API keys
 * - Lookup by prefix (first 8 chars)
 * - Rate limit state tracking
 * - Singleton pattern with reset for testing
 * - Environment-based store selection (memory for testing, database for production)
 * - Redis integration for high-performance rate limiting
 *
 * Store Selection:
 * - VORION_API_KEY_STORE=database: Use PostgreSQL database (production)
 * - VORION_API_KEY_STORE=memory: Use in-memory store (testing)
 * - Default: memory in development, database in production/staging
 *
 * @packageDocumentation
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import type { Database } from '../../common/db.js';
import type {
  ApiKey,
  ApiKeyStatus,
  ApiKeyScope,
  ApiKeyRateLimitState,
  ApiKeyListFilters,
} from './types.js';

// Lazy import to avoid circular dependencies
let DbApiKeyStore: typeof import('./db-store.js').DbApiKeyStore | null = null;

async function getDbStoreClass() {
  if (!DbApiKeyStore) {
    const module = await import('./db-store.js');
    DbApiKeyStore = module.DbApiKeyStore;
  }
  return DbApiKeyStore;
}

const logger = createLogger({ component: 'api-key-store' });

// =============================================================================
// STORE INTERFACE
// =============================================================================

/**
 * Storage interface for API keys
 */
export interface IApiKeyStore {
  /**
   * Create a new API key
   */
  create(apiKey: ApiKey): Promise<ApiKey>;

  /**
   * Get an API key by ID
   */
  getById(id: string): Promise<ApiKey | null>;

  /**
   * Get an API key by prefix (first 8 chars)
   */
  getByPrefix(prefix: string): Promise<ApiKey | null>;

  /**
   * Update an API key
   */
  update(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null>;

  /**
   * Delete an API key
   */
  delete(id: string): Promise<boolean>;

  /**
   * List API keys with filters
   */
  list(filters: ApiKeyListFilters): Promise<{ keys: ApiKey[]; total: number }>;

  /**
   * Get rate limit state for a key
   */
  getRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null>;

  /**
   * Set rate limit state for a key
   */
  setRateLimitState(state: ApiKeyRateLimitState): Promise<void>;

  /**
   * Atomically increment rate limit counters using Redis INCR
   * This is the preferred method for distributed rate limiting
   */
  incrementRateLimitCounters?(keyId: string): Promise<{
    second: number;
    minute: number;
    hour: number;
  }>;

  /**
   * Update last used timestamp
   */
  updateLastUsed(id: string): Promise<void>;

  /**
   * Reset the store (for testing)
   */
  reset(): void;

  /**
   * Stop the store (cleanup intervals, connections, etc.)
   */
  stop(): void;
}

// =============================================================================
// IN-MEMORY STORE IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of API key store.
 *
 * NOTE: This is suitable for development and testing only.
 * Production deployments should use Redis or a database.
 */
export class InMemoryApiKeyStore implements IApiKeyStore {
  /** API keys indexed by ID */
  private keysById: Map<string, ApiKey> = new Map();

  /** API keys indexed by prefix for fast lookup */
  private keysByPrefix: Map<string, ApiKey> = new Map();

  /** Rate limit states indexed by key ID */
  private rateLimitStates: Map<string, ApiKeyRateLimitState> = new Map();

  /** Cleanup interval handle */
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Create a new API key
   */
  async create(apiKey: ApiKey): Promise<ApiKey> {
    // Check for duplicate prefix
    if (this.keysByPrefix.has(apiKey.prefix)) {
      throw new Error(`API key with prefix ${apiKey.prefix} already exists`);
    }

    this.keysById.set(apiKey.id, apiKey);
    this.keysByPrefix.set(apiKey.prefix, apiKey);

    logger.info(
      { keyId: apiKey.id, prefix: apiKey.prefix, tenantId: apiKey.tenantId },
      'API key created in store'
    );

    return apiKey;
  }

  /**
   * Get an API key by ID
   */
  async getById(id: string): Promise<ApiKey | null> {
    return this.keysById.get(id) ?? null;
  }

  /**
   * Get an API key by prefix (first 8 chars)
   * This is the primary lookup method during validation
   */
  async getByPrefix(prefix: string): Promise<ApiKey | null> {
    return this.keysByPrefix.get(prefix) ?? null;
  }

  /**
   * Update an API key
   */
  async update(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
    const existing = this.keysById.get(id);
    if (!existing) {
      return null;
    }

    // Merge updates
    const updated: ApiKey = {
      ...existing,
      ...updates,
      // Prevent modifying immutable fields
      id: existing.id,
      prefix: existing.prefix,
      hashedKey: existing.hashedKey,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
    };

    this.keysById.set(id, updated);
    this.keysByPrefix.set(updated.prefix, updated);

    logger.info({ keyId: id }, 'API key updated in store');

    return updated;
  }

  /**
   * Delete an API key
   */
  async delete(id: string): Promise<boolean> {
    const existing = this.keysById.get(id);
    if (!existing) {
      return false;
    }

    this.keysById.delete(id);
    this.keysByPrefix.delete(existing.prefix);
    this.rateLimitStates.delete(id);

    logger.info({ keyId: id, prefix: existing.prefix }, 'API key deleted from store');

    return true;
  }

  /**
   * List API keys with filters
   */
  async list(filters: ApiKeyListFilters): Promise<{ keys: ApiKey[]; total: number }> {
    let keys = Array.from(this.keysById.values());

    // Apply filters
    keys = keys.filter((key) => {
      // Tenant filter (required)
      if (key.tenantId !== filters.tenantId) {
        return false;
      }

      // Status filter
      if (filters.status && key.status !== filters.status) {
        return false;
      }

      // Scope filter
      if (filters.scope && !key.scopes.includes(filters.scope)) {
        return false;
      }

      // Created by filter
      if (filters.createdBy && key.createdBy !== filters.createdBy) {
        return false;
      }

      return true;
    });

    // Sort by creation date descending (newest first)
    keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = keys.length;

    // Apply pagination
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    keys = keys.slice(offset, offset + limit);

    return { keys, total };
  }

  /**
   * Get rate limit state for a key
   */
  async getRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null> {
    return this.rateLimitStates.get(keyId) ?? null;
  }

  /**
   * Set rate limit state for a key
   */
  async setRateLimitState(state: ApiKeyRateLimitState): Promise<void> {
    this.rateLimitStates.set(state.keyId, state);
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    const existing = this.keysById.get(id);
    if (existing) {
      const updated = { ...existing, lastUsedAt: new Date() };
      this.keysById.set(id, updated);
      this.keysByPrefix.set(updated.prefix, updated);
    }
  }

  /**
   * Reset the store (for testing)
   */
  reset(): void {
    this.keysById.clear();
    this.keysByPrefix.clear();
    this.rateLimitStates.clear();
    logger.info('API key store reset');
  }

  /**
   * Start periodic cleanup of stale rate limit states
   */
  private startCleanup(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = now - 3600000; // 1 hour

      for (const [keyId, state] of this.rateLimitStates.entries()) {
        // Remove if all windows have been expired for over an hour
        if (
          state.second.resetAt < staleThreshold &&
          state.minute.resetAt < staleThreshold &&
          state.hour.resetAt < staleThreshold
        ) {
          this.rateLimitStates.delete(keyId);
        }
      }
    }, 300000);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get store statistics
   */
  getStats(): {
    totalKeys: number;
    byStatus: Record<ApiKeyStatus, number>;
    byTenant: Record<string, number>;
    rateLimitStates: number;
  } {
    const byStatus: Record<ApiKeyStatus, number> = {
      active: 0,
      revoked: 0,
      expired: 0,
    };

    const byTenant: Record<string, number> = {};

    for (const key of this.keysById.values()) {
      byStatus[key.status] = (byStatus[key.status] ?? 0) + 1;
      byTenant[key.tenantId] = (byTenant[key.tenantId] ?? 0) + 1;
    }

    return {
      totalKeys: this.keysById.size,
      byStatus,
      byTenant,
      rateLimitStates: this.rateLimitStates.size,
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let store: InMemoryApiKeyStore | null = null;

/**
 * Get the API key store singleton
 */
export function getApiKeyStore(): InMemoryApiKeyStore {
  if (!store) {
    store = new InMemoryApiKeyStore();
    logger.info('API key store initialized');
  }
  return store;
}

/**
 * Create a new API key store instance (for testing)
 */
export function createApiKeyStore(): InMemoryApiKeyStore {
  return new InMemoryApiKeyStore();
}

/**
 * Reset the API key store singleton (for testing)
 */
export function resetApiKeyStore(): void {
  if (store) {
    store.stop();
    store.reset();
    store = null;
  }
  if (apiKeyStoreInstance) {
    apiKeyStoreInstance.reset();
    apiKeyStoreInstance = null;
  }
  logger.info('API key store singleton reset');
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Store type configuration
 */
export type ApiKeyStoreType = 'memory' | 'database';

/**
 * Configuration options for API key store factory
 */
export interface ApiKeyStoreFactoryOptions {
  /** Override store type (default: from environment) */
  storeType?: ApiKeyStoreType;
  /** Redis client for rate limiting (optional) */
  redis?: Redis | null;
  /** Database instance (optional, for testing) */
  database?: Database;
}

/** Singleton instance for factory-created store */
let apiKeyStoreInstance: IApiKeyStore | null = null;

/**
 * Determine the store type based on environment configuration
 */
export function getStoreType(): ApiKeyStoreType {
  // Check explicit environment variable
  const envStoreType = process.env['VORION_API_KEY_STORE'];
  if (envStoreType === 'database' || envStoreType === 'memory') {
    return envStoreType;
  }

  // Default based on environment
  const env = process.env['VORION_ENV'] ?? process.env['NODE_ENV'] ?? 'development';
  if (env === 'production' || env === 'staging') {
    return 'database';
  }

  return 'memory';
}

/**
 * Factory function to create the appropriate API key store.
 *
 * In production/staging environments, this returns a database-backed store.
 * In development/test environments, this returns an in-memory store.
 *
 * The store type can be explicitly set via VORION_API_KEY_STORE environment variable:
 * - 'database': Use PostgreSQL database
 * - 'memory': Use in-memory store
 *
 * @param options - Configuration options
 * @returns Promise resolving to an API key store instance
 *
 * @example
 * ```typescript
 * // Get default store based on environment
 * const store = await createApiKeyStoreFactory();
 *
 * // Force database store with Redis for rate limiting
 * const store = await createApiKeyStoreFactory({
 *   storeType: 'database',
 *   redis: redisClient,
 * });
 *
 * // Force in-memory store for testing
 * const store = await createApiKeyStoreFactory({
 *   storeType: 'memory',
 * });
 * ```
 */
export async function createApiKeyStoreFactory(
  options?: ApiKeyStoreFactoryOptions
): Promise<IApiKeyStore> {
  const storeType = options?.storeType ?? getStoreType();

  if (storeType === 'database') {
    const DbStore = await getDbStoreClass();
    const dbStore = new DbStore({
      database: options?.database,
      redis: options?.redis,
    });
    logger.info('Created database-backed API key store');
    return dbStore;
  }

  const memoryStore = new InMemoryApiKeyStore();
  logger.info('Created in-memory API key store');
  return memoryStore;
}

/**
 * Get the API key store singleton using the factory pattern.
 *
 * This is the recommended way to get the API key store in production code.
 * It automatically selects the appropriate store type based on environment.
 *
 * @param options - Configuration options (only used on first call)
 * @returns Promise resolving to the API key store singleton
 */
export async function getApiKeyStoreFactory(
  options?: ApiKeyStoreFactoryOptions
): Promise<IApiKeyStore> {
  if (!apiKeyStoreInstance) {
    apiKeyStoreInstance = await createApiKeyStoreFactory(options);
  }
  return apiKeyStoreInstance;
}

/**
 * Reset the factory-created API key store singleton (for testing)
 */
export function resetApiKeyStoreFactory(): void {
  if (apiKeyStoreInstance) {
    apiKeyStoreInstance.reset();
    apiKeyStoreInstance = null;
  }
  logger.info('API key store factory singleton reset');
}
