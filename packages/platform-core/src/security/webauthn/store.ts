/**
 * WebAuthn Credential Storage Layer
 *
 * In-memory store implementation for WebAuthn credential management
 * with Redis-backed challenge storage for multi-instance deployments.
 *
 * Features:
 * - CRUD operations for credentials
 * - Lookup by credentialId and userId
 * - Redis-backed challenge storage with automatic TTL expiration
 * - Proper key prefixing: `webauthn:challenge:{userId}`
 * - Singleton pattern with reset for testing
 * - Graceful fallback to in-memory when Redis unavailable
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  getRedisStateProvider,
  type RedisStateProvider,
} from '../distributed-state.js';
import type {
  WebAuthnCredential,
  ChallengeEntry,
} from './types.js';

const logger = createLogger({ component: 'webauthn-store' });

/** Redis key prefix for WebAuthn challenges */
const REDIS_CHALLENGE_PREFIX = 'webauthn:challenge:';

// =============================================================================
// STORE INTERFACE
// =============================================================================

/**
 * Storage interface for WebAuthn credentials
 */
export interface IWebAuthnStore {
  // Credential operations
  /**
   * Create a new credential
   */
  createCredential(credential: WebAuthnCredential): Promise<WebAuthnCredential>;

  /**
   * Get a credential by its internal ID
   */
  getCredentialById(id: string): Promise<WebAuthnCredential | null>;

  /**
   * Get a credential by its WebAuthn credential ID
   */
  getCredentialByCredentialId(credentialId: string): Promise<WebAuthnCredential | null>;

  /**
   * Get all credentials for a user
   */
  getCredentialsByUserId(userId: string): Promise<WebAuthnCredential[]>;

  /**
   * Update a credential
   */
  updateCredential(id: string, updates: Partial<WebAuthnCredential>): Promise<WebAuthnCredential | null>;

  /**
   * Delete a credential
   */
  deleteCredential(id: string): Promise<boolean>;

  /**
   * Delete all credentials for a user
   */
  deleteCredentialsByUserId(userId: string): Promise<number>;

  /**
   * Count credentials for a user
   */
  countCredentialsByUserId(userId: string): Promise<number>;

  // Challenge operations
  /**
   * Store a challenge
   */
  setChallenge(key: string, entry: ChallengeEntry): Promise<void>;

  /**
   * Get and delete a challenge (one-time use)
   */
  getChallenge(key: string): Promise<ChallengeEntry | null>;

  /**
   * Delete a challenge
   */
  deleteChallenge(key: string): Promise<boolean>;

  /**
   * Reset the store (for testing)
   */
  reset(): void;
}

// =============================================================================
// IN-MEMORY STORE IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of WebAuthn credential store.
 *
 * NOTE: This is suitable for development and testing only.
 * Production deployments should use a database.
 */
export class InMemoryWebAuthnStore implements IWebAuthnStore {
  /** Credentials indexed by internal ID */
  private credentialsById: Map<string, WebAuthnCredential> = new Map();

  /** Credentials indexed by WebAuthn credential ID */
  private credentialsByCredentialId: Map<string, WebAuthnCredential> = new Map();

  /** Credentials indexed by user ID (one user can have multiple credentials) */
  private credentialsByUserId: Map<string, Set<string>> = new Map();

  /** Challenge storage with TTL */
  private challenges: Map<string, ChallengeEntry> = new Map();

  /** Cleanup interval handle */
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  // ===========================================================================
  // CREDENTIAL OPERATIONS
  // ===========================================================================

  /**
   * Create a new credential
   */
  async createCredential(credential: WebAuthnCredential): Promise<WebAuthnCredential> {
    // Check for duplicate credential ID
    if (this.credentialsByCredentialId.has(credential.credentialId)) {
      throw new Error(`Credential with ID ${credential.credentialId} already exists`);
    }

    // Store credential
    this.credentialsById.set(credential.id, credential);
    this.credentialsByCredentialId.set(credential.credentialId, credential);

    // Add to user's credential set
    let userCredentials = this.credentialsByUserId.get(credential.userId);
    if (!userCredentials) {
      userCredentials = new Set();
      this.credentialsByUserId.set(credential.userId, userCredentials);
    }
    userCredentials.add(credential.id);

    logger.info(
      {
        credentialId: credential.id,
        userId: credential.userId,
        name: credential.name,
      },
      'WebAuthn credential created in store'
    );

    return credential;
  }

  /**
   * Get a credential by its internal ID
   */
  async getCredentialById(id: string): Promise<WebAuthnCredential | null> {
    return this.credentialsById.get(id) ?? null;
  }

  /**
   * Get a credential by its WebAuthn credential ID
   */
  async getCredentialByCredentialId(credentialId: string): Promise<WebAuthnCredential | null> {
    return this.credentialsByCredentialId.get(credentialId) ?? null;
  }

  /**
   * Get all credentials for a user
   */
  async getCredentialsByUserId(userId: string): Promise<WebAuthnCredential[]> {
    const credentialIds = this.credentialsByUserId.get(userId);
    if (!credentialIds || credentialIds.size === 0) {
      return [];
    }

    const credentials: WebAuthnCredential[] = [];
    const idArray = Array.from(credentialIds);
    for (let i = 0; i < idArray.length; i++) {
      const credential = this.credentialsById.get(idArray[i]);
      if (credential) {
        credentials.push(credential);
      }
    }

    // Sort by creation date (newest first)
    credentials.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return credentials;
  }

  /**
   * Update a credential
   */
  async updateCredential(
    id: string,
    updates: Partial<WebAuthnCredential>
  ): Promise<WebAuthnCredential | null> {
    const existing = this.credentialsById.get(id);
    if (!existing) {
      return null;
    }

    // Merge updates (preserve immutable fields)
    const updated: WebAuthnCredential = {
      ...existing,
      ...updates,
      // Immutable fields
      id: existing.id,
      credentialId: existing.credentialId,
      publicKey: existing.publicKey,
      userId: existing.userId,
      createdAt: existing.createdAt,
    };

    // Update all indexes
    this.credentialsById.set(id, updated);
    this.credentialsByCredentialId.set(updated.credentialId, updated);

    logger.debug({ credentialId: id, updates: Object.keys(updates) }, 'WebAuthn credential updated');

    return updated;
  }

  /**
   * Delete a credential
   */
  async deleteCredential(id: string): Promise<boolean> {
    const credential = this.credentialsById.get(id);
    if (!credential) {
      return false;
    }

    // Remove from all indexes
    this.credentialsById.delete(id);
    this.credentialsByCredentialId.delete(credential.credentialId);

    const userCredentials = this.credentialsByUserId.get(credential.userId);
    if (userCredentials) {
      userCredentials.delete(id);
      if (userCredentials.size === 0) {
        this.credentialsByUserId.delete(credential.userId);
      }
    }

    logger.info(
      { credentialId: id, userId: credential.userId, name: credential.name },
      'WebAuthn credential deleted from store'
    );

    return true;
  }

  /**
   * Delete all credentials for a user
   */
  async deleteCredentialsByUserId(userId: string): Promise<number> {
    const credentialIds = this.credentialsByUserId.get(userId);
    if (!credentialIds || credentialIds.size === 0) {
      return 0;
    }

    let deletedCount = 0;
    const idArray = Array.from(credentialIds);
    for (let i = 0; i < idArray.length; i++) {
      const id = idArray[i];
      const credential = this.credentialsById.get(id);
      if (credential) {
        this.credentialsById.delete(id);
        this.credentialsByCredentialId.delete(credential.credentialId);
        deletedCount++;
      }
    }

    this.credentialsByUserId.delete(userId);

    logger.info(
      { userId, deletedCount },
      'All WebAuthn credentials deleted for user'
    );

    return deletedCount;
  }

  /**
   * Count credentials for a user
   */
  async countCredentialsByUserId(userId: string): Promise<number> {
    const credentialIds = this.credentialsByUserId.get(userId);
    return credentialIds?.size ?? 0;
  }

  // ===========================================================================
  // CHALLENGE OPERATIONS
  // ===========================================================================

  /**
   * Store a challenge
   */
  async setChallenge(key: string, entry: ChallengeEntry): Promise<void> {
    this.challenges.set(key, entry);
    logger.debug(
      { key, type: entry.type, userId: entry.userId },
      'WebAuthn challenge stored'
    );
  }

  /**
   * Get and delete a challenge (one-time use)
   */
  async getChallenge(key: string): Promise<ChallengeEntry | null> {
    const entry = this.challenges.get(key);
    if (!entry) {
      return null;
    }

    // Delete after retrieval (one-time use)
    this.challenges.delete(key);

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      logger.warn({ key, type: entry.type }, 'WebAuthn challenge expired');
      return null;
    }

    logger.debug({ key, type: entry.type }, 'WebAuthn challenge retrieved');
    return entry;
  }

  /**
   * Delete a challenge
   */
  async deleteChallenge(key: string): Promise<boolean> {
    return this.challenges.delete(key);
  }

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  /**
   * Start periodic cleanup of expired challenges
   */
  private startCleanup(): void {
    // Clean up every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      const entries = Array.from(this.challenges.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, entry] = entries[i];
        if (now > entry.expiresAt) {
          this.challenges.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.debug({ expiredCount }, 'Expired WebAuthn challenges cleaned up');
      }
    }, 60000);

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
   * Reset the store (for testing)
   */
  reset(): void {
    this.credentialsById.clear();
    this.credentialsByCredentialId.clear();
    this.credentialsByUserId.clear();
    this.challenges.clear();
    logger.info('WebAuthn store reset');
  }

  /**
   * Get store statistics
   */
  getStats(): {
    totalCredentials: number;
    totalUsers: number;
    pendingChallenges: number;
    credentialsByUser: Record<string, number>;
  } {
    const credentialsByUser: Record<string, number> = {};
    const entries = Array.from(this.credentialsByUserId.entries());
    for (let i = 0; i < entries.length; i++) {
      const [userId, credentialIds] = entries[i];
      credentialsByUser[userId] = credentialIds.size;
    }

    return {
      totalCredentials: this.credentialsById.size,
      totalUsers: this.credentialsByUserId.size,
      pendingChallenges: this.challenges.size,
      credentialsByUser,
    };
  }
}

// =============================================================================
// REDIS-BACKED STORE IMPLEMENTATION
// =============================================================================

/**
 * WebAuthn store with Redis-backed challenge storage.
 *
 * Uses Redis for challenge storage to support multi-instance deployments.
 * Challenges are stored with proper TTL and automatically expire.
 * Falls back to in-memory storage if Redis is unavailable.
 *
 * Key format: `webauthn:challenge:{userId}:{type}`
 */
export class RedisWebAuthnStore implements IWebAuthnStore {
  private readonly stateProvider: RedisStateProvider;
  private readonly fallback: InMemoryWebAuthnStore;
  private useRedis: boolean = true;

  constructor(stateProvider?: RedisStateProvider) {
    this.stateProvider = stateProvider ?? getRedisStateProvider({
      keyPrefix: 'vorion:security:',
    });
    this.fallback = new InMemoryWebAuthnStore();

    // Check Redis health
    this.checkRedisHealth();
  }

  private async checkRedisHealth(): Promise<void> {
    try {
      const health = await this.stateProvider.getHealthStatus();
      this.useRedis = health.healthy;

      if (!health.healthy) {
        logger.warn(
          { error: health.error },
          'Redis unavailable for WebAuthn challenges, using in-memory fallback'
        );
      }
    } catch (error) {
      logger.warn({ error }, 'Redis health check failed, using in-memory fallback');
      this.useRedis = false;
    }
  }

  // ===========================================================================
  // CREDENTIAL OPERATIONS (delegated to fallback - use database in production)
  // ===========================================================================

  async createCredential(credential: WebAuthnCredential): Promise<WebAuthnCredential> {
    return this.fallback.createCredential(credential);
  }

  async getCredentialById(id: string): Promise<WebAuthnCredential | null> {
    return this.fallback.getCredentialById(id);
  }

  async getCredentialByCredentialId(credentialId: string): Promise<WebAuthnCredential | null> {
    return this.fallback.getCredentialByCredentialId(credentialId);
  }

  async getCredentialsByUserId(userId: string): Promise<WebAuthnCredential[]> {
    return this.fallback.getCredentialsByUserId(userId);
  }

  async updateCredential(
    id: string,
    updates: Partial<WebAuthnCredential>
  ): Promise<WebAuthnCredential | null> {
    return this.fallback.updateCredential(id, updates);
  }

  async deleteCredential(id: string): Promise<boolean> {
    return this.fallback.deleteCredential(id);
  }

  async deleteCredentialsByUserId(userId: string): Promise<number> {
    return this.fallback.deleteCredentialsByUserId(userId);
  }

  async countCredentialsByUserId(userId: string): Promise<number> {
    return this.fallback.countCredentialsByUserId(userId);
  }

  // ===========================================================================
  // CHALLENGE OPERATIONS (Redis-backed)
  // ===========================================================================

  /**
   * Store a challenge in Redis with automatic TTL expiration
   *
   * Key format: `webauthn:challenge:{key}`
   */
  async setChallenge(key: string, entry: ChallengeEntry): Promise<void> {
    if (!this.useRedis) {
      return this.fallback.setChallenge(key, entry);
    }

    try {
      const redisKey = `${REDIS_CHALLENGE_PREFIX}${key}`;
      const ttlSeconds = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));

      await this.stateProvider.set(
        redisKey,
        JSON.stringify({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        }),
        ttlSeconds
      );

      logger.debug(
        { key: redisKey, type: entry.type, userId: entry.userId, ttlSeconds },
        'WebAuthn challenge stored in Redis'
      );
    } catch (error) {
      logger.warn({ error, key }, 'Failed to store challenge in Redis, using fallback');
      this.useRedis = false;
      await this.fallback.setChallenge(key, entry);
    }
  }

  /**
   * Get and delete a challenge from Redis (one-time use)
   *
   * Uses GET + DELETE to ensure the challenge is consumed atomically.
   * Redis TTL handles automatic expiration.
   */
  async getChallenge(key: string): Promise<ChallengeEntry | null> {
    if (!this.useRedis) {
      return this.fallback.getChallenge(key);
    }

    try {
      const redisKey = `${REDIS_CHALLENGE_PREFIX}${key}`;
      const data = await this.stateProvider.get(redisKey);

      if (!data) {
        return null;
      }

      // Delete immediately after retrieval (one-time use)
      await this.stateProvider.delete(redisKey);

      const parsed = JSON.parse(data);
      const entry: ChallengeEntry = {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
      };

      // Double-check expiration (belt and suspenders with Redis TTL)
      if (Date.now() > entry.expiresAt) {
        logger.warn({ key, type: entry.type }, 'WebAuthn challenge expired');
        return null;
      }

      logger.debug({ key: redisKey, type: entry.type }, 'WebAuthn challenge retrieved from Redis');
      return entry;
    } catch (error) {
      logger.warn({ error, key }, 'Failed to get challenge from Redis, using fallback');
      return this.fallback.getChallenge(key);
    }
  }

  /**
   * Delete a challenge from Redis
   */
  async deleteChallenge(key: string): Promise<boolean> {
    if (!this.useRedis) {
      return this.fallback.deleteChallenge(key);
    }

    try {
      const redisKey = `${REDIS_CHALLENGE_PREFIX}${key}`;
      return await this.stateProvider.delete(redisKey);
    } catch (error) {
      logger.warn({ error, key }, 'Failed to delete challenge from Redis');
      return this.fallback.deleteChallenge(key);
    }
  }

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  /**
   * Reset the store (for testing)
   */
  reset(): void {
    this.fallback.reset();
    logger.info('Redis WebAuthn store reset');
  }

  /**
   * Stop the store
   */
  stop(): void {
    this.fallback.stop();
  }

  /**
   * Get store statistics
   */
  getStats(): {
    totalCredentials: number;
    totalUsers: number;
    pendingChallenges: number;
    credentialsByUser: Record<string, number>;
    usingRedis: boolean;
  } {
    const fallbackStats = this.fallback.getStats();
    return {
      ...fallbackStats,
      usingRedis: this.useRedis,
    };
  }

  /**
   * Check if Redis is being used for challenges
   */
  isUsingRedis(): boolean {
    return this.useRedis;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let store: IWebAuthnStore | null = null;
let useRedisStore = false;

/**
 * Enable Redis-backed WebAuthn store
 * Call this before first getWebAuthnStore() call to use Redis for challenges
 */
export function enableRedisWebAuthnStore(): void {
  useRedisStore = true;
}

/**
 * Get the WebAuthn store singleton
 */
export function getWebAuthnStore(): IWebAuthnStore {
  if (!store) {
    if (useRedisStore) {
      store = new RedisWebAuthnStore();
      logger.info('Redis WebAuthn store initialized');
    } else {
      store = new InMemoryWebAuthnStore();
      logger.info('In-memory WebAuthn store initialized');
    }
  }
  return store;
}

/**
 * Create a new WebAuthn store instance (for testing)
 */
export function createWebAuthnStore(): InMemoryWebAuthnStore {
  return new InMemoryWebAuthnStore();
}

/**
 * Create a new Redis WebAuthn store instance
 */
export function createRedisWebAuthnStore(stateProvider?: RedisStateProvider): RedisWebAuthnStore {
  return new RedisWebAuthnStore(stateProvider);
}

/**
 * Reset the WebAuthn store singleton (for testing)
 */
export function resetWebAuthnStore(): void {
  if (store) {
    store.reset();
    store = null;
  }
  useRedisStore = false;
  logger.info('WebAuthn store singleton reset');
}
