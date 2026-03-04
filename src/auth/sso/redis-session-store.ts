/**
 * Redis-backed SSO Session Store
 *
 * Provides cluster-safe session storage for SSO authentication.
 * Supports session validation across cluster nodes, configurable TTL,
 * and user session lookups.
 *
 * Features:
 * - Cluster-aware session storage
 * - Configurable session TTL
 * - User session index for multi-session support
 * - Session activity tracking
 * - Fallback to in-memory storage for development/testing
 *
 * @module auth/sso/redis-session-store
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import type { SSOSession, OIDCTokenSet, IDTokenClaims } from './types.js';

const logger = createLogger({ component: 'sso-session-store' });

/**
 * Configuration for the Redis session store
 */
export interface RedisSessionStoreConfig {
  /** Redis client instance */
  redis: Redis | null;
  /** Key prefix for session entries (default: 'sso:session:') */
  keyPrefix?: string;
  /** Key prefix for user session index (default: 'sso:user-sessions:') */
  userSessionsPrefix?: string;
  /** Session TTL in seconds (default: 86400 = 24 hours) */
  sessionTtlSeconds?: number;
  /** Enable fallback to in-memory when Redis unavailable */
  enableMemoryFallback?: boolean;
  /** Whether to extend TTL on session access (default: true) */
  extendTtlOnAccess?: boolean;
}

/**
 * Serialized session for Redis storage
 */
interface SerializedSession {
  id: string;
  userId: string;
  providerId: string;
  externalSubjectId: string;
  tenantId: string;
  tokens: {
    accessToken: string;
    tokenType: string;
    expiresAt?: string;
    idToken?: string;
    refreshToken?: string;
    scope?: string;
  };
  claims: IDTokenClaims;
  createdAt: string;
  lastRefreshedAt: string;
  lastAccessedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  /** Whether the session is valid */
  valid: boolean;
  /** The session if valid */
  session?: SSOSession;
  /** Reason for invalidity */
  reason?: 'not_found' | 'expired' | 'tokens_expired' | 'redis_error';
}

/**
 * Redis-backed SSO Session Store
 *
 * Provides cluster-safe session management for SSO authentication.
 *
 * @example
 * ```typescript
 * const sessionStore = new RedisSessionStore({
 *   redis: getRedis(),
 *   sessionTtlSeconds: 86400, // 24 hours
 * });
 *
 * // Create a session
 * await sessionStore.create(session);
 *
 * // Validate a session (cluster-aware)
 * const result = await sessionStore.validate(sessionId);
 * if (!result.valid) {
 *   throw new Error(`Session invalid: ${result.reason}`);
 * }
 *
 * // Get all sessions for a user
 * const userSessions = await sessionStore.getSessionsForUser(userId);
 * ```
 */
export class RedisSessionStore {
  private readonly redis: Redis | null;
  private readonly keyPrefix: string;
  private readonly userSessionsPrefix: string;
  private readonly sessionTtlSeconds: number;
  private readonly enableMemoryFallback: boolean;
  private readonly extendTtlOnAccess: boolean;

  /** In-memory fallback store for development/testing */
  private readonly memoryStore = new Map<string, SSOSession>();
  private readonly userSessionIndex = new Map<string, Set<string>>();
  private memoryCleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RedisSessionStoreConfig) {
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix ?? 'sso:session:';
    this.userSessionsPrefix = config.userSessionsPrefix ?? 'sso:user-sessions:';
    this.sessionTtlSeconds = config.sessionTtlSeconds ?? 86400; // 24 hours
    this.enableMemoryFallback = config.enableMemoryFallback ?? true;
    this.extendTtlOnAccess = config.extendTtlOnAccess ?? true;

    // Start memory cleanup if fallback is enabled
    if (this.enableMemoryFallback) {
      this.startMemoryCleanup();
    }

    logger.info({
      hasRedis: !!this.redis,
      keyPrefix: this.keyPrefix,
      sessionTtlSeconds: this.sessionTtlSeconds,
      enableMemoryFallback: this.enableMemoryFallback,
      extendTtlOnAccess: this.extendTtlOnAccess,
    }, 'RedisSessionStore initialized');
  }

  /**
   * Start periodic cleanup of expired in-memory sessions
   */
  private startMemoryCleanup(): void {
    // Clean up every 5 minutes
    this.memoryCleanupInterval = setInterval(() => {
      this.cleanupExpiredMemorySessions();
    }, 300000);

    // Don't prevent process exit
    this.memoryCleanupInterval.unref();
  }

  /**
   * Clean up expired sessions from memory store
   */
  private cleanupExpiredMemorySessions(): number {
    const now = Date.now();
    const ttlMs = this.sessionTtlSeconds * 1000;
    let cleaned = 0;

    // Use Array.from to avoid downlevelIteration requirements
    const entries = Array.from(this.memoryStore.entries());
    for (const [sessionId, session] of entries) {
      const sessionAge = now - session.createdAt.getTime();
      if (sessionAge > ttlMs) {
        this.memoryStore.delete(sessionId);

        // Remove from user index
        const userSessions = this.userSessionIndex.get(session.userId);
        if (userSessions) {
          userSessions.delete(sessionId);
          if (userSessions.size === 0) {
            this.userSessionIndex.delete(session.userId);
          }
        }

        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ count: cleaned }, 'Cleaned up expired memory sessions');
    }

    return cleaned;
  }

  /**
   * Generate Redis key for a session
   */
  private getSessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Generate Redis key for user sessions index
   */
  private getUserSessionsKey(userId: string): string {
    return `${this.userSessionsPrefix}${userId}`;
  }

  /**
   * Serialize session for Redis storage
   */
  private serialize(session: SSOSession): string {
    const serialized: SerializedSession = {
      id: session.id,
      userId: session.userId,
      providerId: session.providerId,
      externalSubjectId: session.externalSubjectId,
      tenantId: session.tenantId,
      tokens: {
        accessToken: session.tokens.accessToken,
        tokenType: session.tokens.tokenType,
        expiresAt: session.tokens.expiresAt?.toISOString(),
        idToken: session.tokens.idToken,
        refreshToken: session.tokens.refreshToken,
        scope: session.tokens.scope,
      },
      claims: session.claims,
      createdAt: session.createdAt.toISOString(),
      lastRefreshedAt: session.lastRefreshedAt.toISOString(),
      metadata: session.metadata,
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize session from Redis storage
   */
  private deserialize(data: string): SSOSession {
    const serialized: SerializedSession = JSON.parse(data);
    return {
      id: serialized.id,
      userId: serialized.userId,
      providerId: serialized.providerId,
      externalSubjectId: serialized.externalSubjectId,
      tenantId: serialized.tenantId,
      tokens: {
        accessToken: serialized.tokens.accessToken,
        tokenType: serialized.tokens.tokenType,
        expiresAt: serialized.tokens.expiresAt
          ? new Date(serialized.tokens.expiresAt)
          : undefined,
        idToken: serialized.tokens.idToken,
        refreshToken: serialized.tokens.refreshToken,
        scope: serialized.tokens.scope,
      },
      claims: serialized.claims,
      createdAt: new Date(serialized.createdAt),
      lastRefreshedAt: new Date(serialized.lastRefreshedAt),
      metadata: serialized.metadata,
    };
  }

  /**
   * Check if Redis is available
   */
  private isRedisAvailable(): boolean {
    if (!this.redis) return false;

    try {
      return this.redis.status === 'ready';
    } catch {
      return false;
    }
  }

  /**
   * Create a new SSO session
   *
   * @param session - The session to create
   */
  async create(session: SSOSession): Promise<void> {
    const sessionKey = this.getSessionKey(session.id);
    const userSessionsKey = this.getUserSessionsKey(session.userId);
    const serialized = this.serialize(session);

    if (this.isRedisAvailable()) {
      try {
        // Use pipeline for atomic multi-key operation
        const pipeline = this.redis!.pipeline();

        // Store session with TTL
        pipeline.setex(sessionKey, this.sessionTtlSeconds, serialized);

        // Add to user sessions index
        pipeline.sadd(userSessionsKey, session.id);
        pipeline.expire(userSessionsKey, this.sessionTtlSeconds);

        await pipeline.exec();

        logger.debug({
          sessionId: session.id,
          userId: session.userId,
          providerId: session.providerId,
        }, 'Session created in Redis');

        return;
      } catch (error) {
        logger.error({ error, sessionId: session.id }, 'Failed to create session in Redis');

        if (this.enableMemoryFallback) {
          logger.warn('Falling back to in-memory session storage');
          this.createInMemory(session);
          return;
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      this.createInMemory(session);
      return;
    }

    throw new Error('Redis not available and memory fallback is disabled');
  }

  /**
   * Create session in memory (fallback)
   */
  private createInMemory(session: SSOSession): void {
    this.memoryStore.set(session.id, session);

    // Add to user index
    let userSessions = this.userSessionIndex.get(session.userId);
    if (!userSessions) {
      userSessions = new Set();
      this.userSessionIndex.set(session.userId, userSessions);
    }
    userSessions.add(session.id);

    logger.debug({
      sessionId: session.id,
      userId: session.userId,
      providerId: session.providerId,
    }, 'Session created in memory');
  }

  /**
   * Get a session by ID
   *
   * @param sessionId - The session ID to retrieve
   * @returns The session if found, undefined otherwise
   */
  async get(sessionId: string): Promise<SSOSession | undefined> {
    const sessionKey = this.getSessionKey(sessionId);

    if (this.isRedisAvailable()) {
      try {
        const data = await this.redis!.get(sessionKey);

        if (!data) {
          // Check memory fallback
          if (this.enableMemoryFallback && this.memoryStore.has(sessionId)) {
            return this.memoryStore.get(sessionId);
          }
          return undefined;
        }

        const session = this.deserialize(data);

        // Extend TTL on access if enabled
        if (this.extendTtlOnAccess) {
          await this.redis!.expire(sessionKey, this.sessionTtlSeconds);
        }

        return session;
      } catch (error) {
        logger.error({ error, sessionId }, 'Failed to get session from Redis');

        if (this.enableMemoryFallback) {
          return this.memoryStore.get(sessionId);
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      return this.memoryStore.get(sessionId);
    }

    throw new Error('Redis not available and memory fallback is disabled');
  }

  /**
   * Validate a session (cluster-aware)
   *
   * Checks if the session exists, is not expired, and has valid tokens.
   * This is the recommended method for session validation in a cluster.
   *
   * @param sessionId - The session ID to validate
   * @returns Validation result with session if valid
   */
  async validate(sessionId: string): Promise<SessionValidationResult> {
    try {
      const session = await this.get(sessionId);

      if (!session) {
        return { valid: false, reason: 'not_found' };
      }

      // Check if access token is expired
      if (session.tokens.expiresAt) {
        const now = new Date();
        if (now > session.tokens.expiresAt) {
          // Token expired, but session might still be valid if we have a refresh token
          if (!session.tokens.refreshToken) {
            return { valid: false, reason: 'tokens_expired', session };
          }
          // Session is valid but needs token refresh
        }
      }

      return { valid: true, session };
    } catch (error) {
      logger.error({ error, sessionId }, 'Session validation error');
      return { valid: false, reason: 'redis_error' };
    }
  }

  /**
   * Update session tokens (after refresh)
   *
   * @param sessionId - The session ID to update
   * @param tokens - New token set
   * @param claims - New claims (optional)
   * @returns true if updated, false if session not found
   */
  async updateTokens(
    sessionId: string,
    tokens: OIDCTokenSet,
    claims?: IDTokenClaims
  ): Promise<boolean> {
    const session = await this.get(sessionId);

    if (!session) {
      return false;
    }

    // Update tokens and claims
    session.tokens = tokens;
    if (claims) {
      session.claims = claims;
    }
    session.lastRefreshedAt = new Date();

    const sessionKey = this.getSessionKey(sessionId);
    const serialized = this.serialize(session);

    if (this.isRedisAvailable()) {
      try {
        await this.redis!.setex(sessionKey, this.sessionTtlSeconds, serialized);

        logger.debug({ sessionId }, 'Session tokens updated in Redis');
        return true;
      } catch (error) {
        logger.error({ error, sessionId }, 'Failed to update session tokens in Redis');

        if (this.enableMemoryFallback) {
          this.memoryStore.set(sessionId, session);
          return true;
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      this.memoryStore.set(sessionId, session);
      return true;
    }

    return false;
  }

  /**
   * Delete a session
   *
   * @param sessionId - The session ID to delete
   * @returns true if deleted, false if not found
   */
  async delete(sessionId: string): Promise<boolean> {
    // Get session first to find userId for index cleanup
    const session = await this.get(sessionId);

    if (!session) {
      return false;
    }

    const sessionKey = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(session.userId);

    if (this.isRedisAvailable()) {
      try {
        const pipeline = this.redis!.pipeline();

        // Delete session
        pipeline.del(sessionKey);

        // Remove from user sessions index
        pipeline.srem(userSessionsKey, sessionId);

        const results = await pipeline.exec();
        const deleted = results?.[0]?.[1] as number > 0;

        // Also delete from memory if present
        if (this.enableMemoryFallback) {
          this.deleteFromMemory(sessionId, session.userId);
        }

        logger.debug({ sessionId, userId: session.userId }, 'Session deleted from Redis');
        return deleted;
      } catch (error) {
        logger.error({ error, sessionId }, 'Failed to delete session from Redis');

        if (this.enableMemoryFallback) {
          return this.deleteFromMemory(sessionId, session.userId);
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      return this.deleteFromMemory(sessionId, session.userId);
    }

    return false;
  }

  /**
   * Delete session from memory (fallback)
   */
  private deleteFromMemory(sessionId: string, userId: string): boolean {
    const deleted = this.memoryStore.delete(sessionId);

    // Remove from user index
    const userSessions = this.userSessionIndex.get(userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessionIndex.delete(userId);
      }
    }

    return deleted;
  }

  /**
   * Get all sessions for a user
   *
   * @param userId - The user ID to get sessions for
   * @returns Array of sessions
   */
  async getSessionsForUser(userId: string): Promise<SSOSession[]> {
    const userSessionsKey = this.getUserSessionsKey(userId);

    if (this.isRedisAvailable()) {
      try {
        // Get session IDs from user index
        const sessionIds = await this.redis!.smembers(userSessionsKey);

        if (sessionIds.length === 0) {
          // Check memory fallback
          if (this.enableMemoryFallback) {
            return this.getSessionsForUserFromMemory(userId);
          }
          return [];
        }

        // Get all sessions
        const sessions: SSOSession[] = [];
        const expiredSessions: string[] = [];

        for (const sessionId of sessionIds) {
          const sessionKey = this.getSessionKey(sessionId);
          const data = await this.redis!.get(sessionKey);

          if (data) {
            sessions.push(this.deserialize(data));
          } else {
            // Session expired or deleted, clean up index
            expiredSessions.push(sessionId);
          }
        }

        // Clean up expired session IDs from index
        if (expiredSessions.length > 0) {
          await this.redis!.srem(userSessionsKey, ...expiredSessions);
        }

        return sessions;
      } catch (error) {
        logger.error({ error, userId }, 'Failed to get user sessions from Redis');

        if (this.enableMemoryFallback) {
          return this.getSessionsForUserFromMemory(userId);
        }

        throw error;
      }
    }

    if (this.enableMemoryFallback) {
      return this.getSessionsForUserFromMemory(userId);
    }

    throw new Error('Redis not available and memory fallback is disabled');
  }

  /**
   * Get sessions for user from memory (fallback)
   */
  private getSessionsForUserFromMemory(userId: string): SSOSession[] {
    const sessionIds = this.userSessionIndex.get(userId);
    if (!sessionIds) {
      return [];
    }

    const sessions: SSOSession[] = [];
    // Use Array.from to avoid downlevelIteration requirements
    const sessionIdArray = Array.from(sessionIds);
    for (const sessionId of sessionIdArray) {
      const session = this.memoryStore.get(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Delete all sessions for a user
   *
   * @param userId - The user ID to delete sessions for
   * @returns Number of sessions deleted
   */
  async deleteSessionsForUser(userId: string): Promise<number> {
    const sessions = await this.getSessionsForUser(userId);
    let deleted = 0;

    for (const session of sessions) {
      if (await this.delete(session.id)) {
        deleted++;
      }
    }

    // Also clean up the user sessions key
    if (this.isRedisAvailable()) {
      try {
        await this.redis!.del(this.getUserSessionsKey(userId));
      } catch (error) {
        logger.warn({ error, userId }, 'Failed to delete user sessions key');
      }
    }

    // Clean up memory index
    if (this.enableMemoryFallback) {
      this.userSessionIndex.delete(userId);
    }

    logger.debug({ userId, count: deleted }, 'User sessions deleted');
    return deleted;
  }

  /**
   * Get statistics about the session store
   */
  async getStats(): Promise<{
    redisAvailable: boolean;
    memoryStoreSize: number;
    usingFallback: boolean;
  }> {
    const redisAvailable = this.isRedisAvailable();

    return {
      redisAvailable,
      memoryStoreSize: this.memoryStore.size,
      usingFallback: !redisAvailable && this.enableMemoryFallback,
    };
  }

  /**
   * Clear all sessions (mainly for testing)
   */
  async clear(): Promise<void> {
    // Clear memory stores
    this.memoryStore.clear();
    this.userSessionIndex.clear();

    // Clear Redis keys
    if (this.isRedisAvailable()) {
      try {
        // Clear session keys
        let cursor = '0';
        do {
          const [newCursor, keys] = await this.redis!.scan(
            cursor,
            'MATCH',
            `${this.keyPrefix}*`,
            'COUNT',
            100
          );
          cursor = newCursor;

          if (keys.length > 0) {
            await this.redis!.del(...keys);
          }
        } while (cursor !== '0');

        // Clear user session index keys
        cursor = '0';
        do {
          const [newCursor, keys] = await this.redis!.scan(
            cursor,
            'MATCH',
            `${this.userSessionsPrefix}*`,
            'COUNT',
            100
          );
          cursor = newCursor;

          if (keys.length > 0) {
            await this.redis!.del(...keys);
          }
        } while (cursor !== '0');

        logger.info('Cleared all sessions from Redis');
      } catch (error) {
        logger.error({ error }, 'Failed to clear sessions from Redis');
      }
    }
  }

  /**
   * Shutdown the session store
   */
  shutdown(): void {
    if (this.memoryCleanupInterval) {
      clearInterval(this.memoryCleanupInterval);
      this.memoryCleanupInterval = null;
    }

    this.memoryStore.clear();
    this.userSessionIndex.clear();
    logger.info('RedisSessionStore shutdown');
  }
}

/**
 * Create a new RedisSessionStore instance
 */
export function createRedisSessionStore(
  config: RedisSessionStoreConfig
): RedisSessionStore {
  return new RedisSessionStore(config);
}
