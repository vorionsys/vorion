/**
 * Session Store - Redis-backed session persistence
 *
 * Provides secure session storage with support for:
 * - Session creation and retrieval
 * - Session revocation with immediate propagation across instances
 * - Automatic expiration
 * - Device tracking
 * - Pub/sub for instant revocation notification
 * - Graceful handling of Redis unavailability
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import { getRedis, checkRedisHealth } from '../common/redis.js';
import type { Redis } from 'ioredis';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../audit/security-logger.js';
import type { SecurityActor } from '../audit/security-events.js';

const logger = createLogger({ component: 'session-store' });

// =============================================================================
// Zod Schemas for Session Data Validation
// =============================================================================

/**
 * Schema for validating stored session data from Redis
 */
const storedSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  deviceFingerprint: z.string().optional(),
  ipAddress: z.string(),
  userAgent: z.string(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revoked: z.boolean(),
  revokedAt: z.string().datetime().optional(),
  revokedReason: z.string().optional(),
  revokedBy: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for validating session revocation events from pub/sub
 */
const sessionRevocationEventSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string(),
  revokedBy: z.string(),
  timestamp: z.number().positive(),
  sourceInstance: z.string().min(1),
});

/**
 * Build security actor for session operations
 */
function buildSessionActor(
  userId: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string,
  sessionId?: string
): SecurityActor {
  return {
    type: 'user',
    id: userId,
    tenantId,
    ip: ipAddress,
    userAgent,
    sessionId,
  };
}

/** Redis pub/sub channel for session revocation events */
const SESSION_REVOCATION_CHANNEL = 'vorion:session:revocation';

/** Local cache of revoked session IDs for fast validation */
const revokedSessionsCache = new Map<string, number>();

/** Maximum size of revoked sessions cache */
const MAX_REVOKED_CACHE_SIZE = 10000;

/** TTL for cached revoked sessions in milliseconds */
const REVOKED_CACHE_TTL = 300000; // 5 minutes

/**
 * Session data structure
 */
export interface Session {
  /** Unique session identifier */
  id: string;
  /** User ID this session belongs to */
  userId: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** Device fingerprint for identification */
  deviceFingerprint?: string;
  /** IP address at session creation */
  ipAddress: string;
  /** User agent string */
  userAgent: string;
  /** When the session was created */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** When the session expires */
  expiresAt: Date;
  /** Whether the session has been revoked */
  revoked: boolean;
  /** When the session was revoked */
  revokedAt?: Date;
  /** Reason for revocation */
  revokedReason?: string;
  /** Who revoked the session (user ID or 'system') */
  revokedBy?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session creation input
 */
export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint?: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Session store configuration
 */
export interface SessionStoreConfig {
  /** Redis key prefix */
  keyPrefix: string;
  /** Default session TTL in seconds */
  defaultTTL: number;
  /** Maximum sessions per user */
  maxSessionsPerUser: number;
  /** Whether to track session activity */
  trackActivity: boolean;
}

const DEFAULT_CONFIG: SessionStoreConfig = {
  keyPrefix: 'vorion:session',
  defaultTTL: 86400, // 24 hours
  maxSessionsPerUser: 10,
  trackActivity: true,
};

/**
 * Session revocation event published via Redis pub/sub
 */
interface SessionRevocationEvent {
  /** Session ID that was revoked */
  sessionId: string;
  /** User ID owning the session */
  userId: string;
  /** Reason for revocation */
  reason: string;
  /** Who revoked the session */
  revokedBy: string;
  /** Timestamp of revocation */
  timestamp: number;
  /** Source instance ID */
  sourceInstance: string;
}

/**
 * Redis-backed session store with pub/sub revocation propagation
 */
export class SessionStore {
  private config: SessionStoreConfig;
  private redis: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly instanceId: string;
  private isSubscribed: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private securityLogger: SecurityAuditLogger;

  constructor(config: Partial<SessionStoreConfig> = {}, securityLogger?: SecurityAuditLogger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = crypto.randomUUID();
    this.securityLogger = securityLogger ?? getSecurityAuditLogger();

    // Start cleanup interval for revoked sessions cache
    this.startCacheCleanup();
  }

  /**
   * Get Redis client, initializing if needed
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();

      // Subscribe to revocation events
      await this.subscribeToRevocations();
    }
    return this.redis;
  }

  /**
   * Subscribe to session revocation events for cross-instance propagation
   */
  private async subscribeToRevocations(): Promise<void> {
    if (this.isSubscribed || this.subscriber) {
      return;
    }

    try {
      // Create a separate connection for subscribing
      this.subscriber = getRedis().duplicate();

      await this.subscriber.subscribe(SESSION_REVOCATION_CHANNEL);

      this.subscriber.on('message', (channel, message) => {
        if (channel === SESSION_REVOCATION_CHANNEL) {
          try {
            const parsed = JSON.parse(message);
            const validated = sessionRevocationEventSchema.safeParse(parsed);

            if (!validated.success) {
              logger.warn(
                {
                  errors: validated.error.errors,
                  operation: 'subscribeToRevocations',
                },
                'Session revocation event validation failed'
              );
              return;
            }

            const event = validated.data;

            // Don't process our own events
            if (event.sourceInstance === this.instanceId) {
              return;
            }

            // Add to local revoked cache for fast validation
            this.addToRevokedCache(event.sessionId);

            logger.debug(
              { sessionId: event.sessionId, reason: event.reason },
              'Received session revocation event from another instance'
            );
          } catch (error) {
            logger.error(
              {
                error: error instanceof Error ? error.message : String(error),
                rawMessage: message.substring(0, 200),
                operation: 'subscribeToRevocations',
              },
              'Failed to parse session revocation event'
            );
          }
        }
      });

      this.isSubscribed = true;
      logger.info('Subscribed to session revocation events');
    } catch (error) {
      logger.warn({ error }, 'Failed to subscribe to session revocation events');
    }
  }

  /**
   * Publish a session revocation event to other instances
   */
  private async publishRevocation(
    sessionId: string,
    userId: string,
    reason: string,
    revokedBy: string
  ): Promise<void> {
    try {
      const redis = await this.getRedis();
      const event: SessionRevocationEvent = {
        sessionId,
        userId,
        reason,
        revokedBy,
        timestamp: Date.now(),
        sourceInstance: this.instanceId,
      };

      await redis.publish(SESSION_REVOCATION_CHANNEL, JSON.stringify(event));
      logger.debug({ sessionId }, 'Published session revocation event');
    } catch (error) {
      logger.warn({ error, sessionId }, 'Failed to publish session revocation event');
    }
  }

  /**
   * Add a session ID to the local revoked cache
   */
  private addToRevokedCache(sessionId: string): void {
    // Evict oldest entries if at capacity
    if (revokedSessionsCache.size >= MAX_REVOKED_CACHE_SIZE) {
      const oldestKey = revokedSessionsCache.keys().next().value;
      if (oldestKey) {
        revokedSessionsCache.delete(oldestKey);
      }
    }

    revokedSessionsCache.set(sessionId, Date.now() + REVOKED_CACHE_TTL);
  }

  /**
   * Check if a session is in the local revoked cache
   */
  private isInRevokedCache(sessionId: string): boolean {
    const expiresAt = revokedSessionsCache.get(sessionId);
    if (!expiresAt) {
      return false;
    }

    if (Date.now() > expiresAt) {
      revokedSessionsCache.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Start cleanup interval for revoked sessions cache
   */
  private startCacheCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(revokedSessionsCache.entries());
      for (let i = 0; i < entries.length; i++) {
        const [sessionId, expiresAt] = entries[i];
        if (now > expiresAt) {
          revokedSessionsCache.delete(sessionId);
        }
      }
    }, 60000); // Clean up every minute

    this.cleanupInterval.unref();
  }

  /**
   * Generate session key for Redis
   */
  private sessionKey(sessionId: string): string {
    return `${this.config.keyPrefix}:${sessionId}`;
  }

  /**
   * Generate user sessions index key
   */
  private userSessionsKey(userId: string): string {
    return `${this.config.keyPrefix}:user:${userId}`;
  }

  /**
   * Create a new session
   */
  async create(input: CreateSessionInput): Promise<Session> {
    const redis = await this.getRedis();
    const sessionId = crypto.randomUUID();
    const now = new Date();
    const ttl = input.ttlSeconds ?? this.config.defaultTTL;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const session: Session = {
      id: sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceFingerprint: input.deviceFingerprint,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
      revoked: false,
      metadata: input.metadata,
    };

    // Enforce max sessions per user
    await this.enforceSessionLimit(input.userId);

    // Store session
    const key = this.sessionKey(sessionId);
    await redis.setex(key, ttl, JSON.stringify(this.serializeSession(session)));

    // Add to user's session index
    const userKey = this.userSessionsKey(input.userId);
    await redis.sadd(userKey, sessionId);
    await redis.expire(userKey, ttl + 3600); // Keep index slightly longer

    // Security audit log session creation
    const actor = buildSessionActor(
      input.userId,
      input.tenantId,
      input.ipAddress,
      input.userAgent,
      sessionId
    );
    await this.securityLogger.logSessionCreated(actor, sessionId, {
      deviceFingerprint: input.deviceFingerprint,
      ttlSeconds: ttl,
    });

    logger.info(
      { sessionId, userId: input.userId, tenantId: input.tenantId },
      'Session created'
    );

    return session;
  }

  /**
   * Get a session by ID
   */
  async get(sessionId: string): Promise<Session | null> {
    const redis = await this.getRedis();
    const key = this.sessionKey(sessionId);
    const data = await redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      const validated = storedSessionSchema.safeParse(parsed);

      if (!validated.success) {
        logger.warn(
          {
            sessionId,
            errors: validated.error.errors,
            operation: 'get',
          },
          'Session data validation failed'
        );
        return null;
      }

      const session = this.deserializeSession(validated.data as Record<string, unknown>);

      // Check if expired (belt and suspenders with Redis TTL)
      if (session.expiresAt < new Date()) {
        await this.delete(sessionId);
        return null;
      }

      return session;
    } catch (error) {
      logger.error(
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
          operation: 'get',
        },
        'Failed to parse session data'
      );
      return null;
    }
  }

  /**
   * Update session activity timestamp
   */
  async touch(sessionId: string): Promise<boolean> {
    if (!this.config.trackActivity) {
      return true;
    }

    const session = await this.get(sessionId);
    if (!session || session.revoked) {
      return false;
    }

    session.lastActivityAt = new Date();

    const redis = await this.getRedis();
    const key = this.sessionKey(sessionId);
    const ttl = await redis.ttl(key);

    if (ttl > 0) {
      await redis.setex(key, ttl, JSON.stringify(this.serializeSession(session)));
    }

    return true;
  }

  /**
   * Revoke a session and notify other instances immediately
   */
  async revoke(
    sessionId: string,
    reason: string,
    revokedBy: string = 'system'
  ): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    session.revoked = true;
    session.revokedAt = new Date();
    session.revokedReason = reason;
    session.revokedBy = revokedBy;

    const redis = await this.getRedis();
    const key = this.sessionKey(sessionId);
    const ttl = await redis.ttl(key);

    if (ttl > 0) {
      // Keep the session record briefly so revocation can be detected
      await redis.setex(key, Math.min(ttl, 300), JSON.stringify(this.serializeSession(session)));
    }

    // Add to local cache for immediate validation
    this.addToRevokedCache(sessionId);

    // Publish revocation event to other instances
    await this.publishRevocation(sessionId, session.userId, reason, revokedBy);

    // Security audit log session revocation
    const actor = buildSessionActor(
      revokedBy === 'system' ? session.userId : revokedBy,
      session.tenantId,
      session.ipAddress,
      session.userAgent,
      sessionId
    );
    actor.type = revokedBy === 'system' ? 'system' : 'user';
    await this.securityLogger.logSessionRevoked(actor, sessionId, reason, {
      revokedBy,
      userId: session.userId,
    });

    logger.info(
      { sessionId, userId: session.userId, reason, revokedBy },
      'Session revoked'
    );

    return true;
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllForUser(
    userId: string,
    reason: string,
    revokedBy: string = 'system',
    exceptSessionId?: string
  ): Promise<number> {
    const sessionIds = await this.getSessionIdsForUser(userId);
    let revokedCount = 0;

    for (const sessionId of sessionIds) {
      if (sessionId === exceptSessionId) {
        continue;
      }

      const revoked = await this.revoke(sessionId, reason, revokedBy);
      if (revoked) {
        revokedCount++;
      }
    }

    // Security audit log bulk revocation
    if (revokedCount > 0) {
      const actor: SecurityActor = {
        type: revokedBy === 'system' ? 'system' : 'user',
        id: revokedBy,
      };
      await this.securityLogger.logSessionsBulkRevoked(actor, userId, revokedCount, reason);
    }

    logger.info(
      { userId, revokedCount, reason, revokedBy },
      'All user sessions revoked'
    );

    return revokedCount;
  }

  /**
   * Get all session IDs for a user
   */
  async getSessionIdsForUser(userId: string): Promise<string[]> {
    const redis = await this.getRedis();
    const userKey = this.userSessionsKey(userId);
    const sessionIds = await redis.smembers(userKey);

    // Clean up expired sessions from the index
    const validSessionIds: string[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (session && !session.revoked) {
        validSessionIds.push(sessionId);
      } else {
        // Remove from index
        await redis.srem(userKey, sessionId);
      }
    }

    return validSessionIds;
  }

  /**
   * Get all active sessions for a user
   */
  async getSessionsForUser(userId: string): Promise<Session[]> {
    const sessionIds = await this.getSessionIdsForUser(userId);
    const sessions: Session[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (session && !session.revoked) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Delete a session permanently
   */
  async delete(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    const redis = await this.getRedis();
    const key = this.sessionKey(sessionId);

    const deleted = await redis.del(key);

    if (session) {
      const userKey = this.userSessionsKey(session.userId);
      await redis.srem(userKey, sessionId);
    }

    return deleted > 0;
  }

  /**
   * Validate a session is active and not revoked
   *
   * First checks the local revoked cache for immediate revocation detection,
   * then validates against Redis for the full session state.
   */
  async validate(sessionId: string): Promise<{
    valid: boolean;
    session?: Session;
    reason?: string;
  }> {
    // Fast path: check local revoked cache first
    // This catches revocations from other instances immediately
    if (this.isInRevokedCache(sessionId)) {
      return { valid: false, reason: 'Session has been revoked' };
    }

    const session = await this.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'Session not found or expired' };
    }

    // Build actor for audit logging
    const actor = buildSessionActor(
      session.userId,
      session.tenantId,
      session.ipAddress,
      session.userAgent,
      sessionId
    );

    if (session.revoked) {
      // Add to local cache for future fast lookups
      this.addToRevokedCache(sessionId);

      // Security audit log invalid session validation
      await this.securityLogger.logSessionValidation(
        actor,
        sessionId,
        false,
        session.revokedReason ?? 'Session has been revoked'
      );

      return {
        valid: false,
        session,
        reason: session.revokedReason ?? 'Session has been revoked',
      };
    }

    if (session.expiresAt < new Date()) {
      // Security audit log expired session validation
      await this.securityLogger.logSessionValidation(
        actor,
        sessionId,
        false,
        'Session has expired'
      );

      return { valid: false, session, reason: 'Session has expired' };
    }

    // Update activity timestamp
    if (this.config.trackActivity) {
      await this.touch(sessionId);
    }

    return { valid: true, session };
  }

  /**
   * Enforce maximum sessions per user
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const sessions = await this.getSessionsForUser(userId);

    if (sessions.length >= this.config.maxSessionsPerUser) {
      // Sort by last activity, oldest first
      sessions.sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime());

      // Revoke oldest sessions to make room
      const toRevoke = sessions.slice(0, sessions.length - this.config.maxSessionsPerUser + 1);
      for (const session of toRevoke) {
        await this.revoke(
          session.id,
          'Maximum session limit exceeded',
          'system'
        );
      }

      logger.info(
        { userId, revokedCount: toRevoke.length, maxSessions: this.config.maxSessionsPerUser },
        'Old sessions revoked due to session limit'
      );
    }
  }

  /**
   * Serialize session for storage
   */
  private serializeSession(session: Session): Record<string, unknown> {
    return {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString(),
    };
  }

  /**
   * Deserialize session from storage
   */
  private deserializeSession(data: Record<string, unknown>): Session {
    return {
      ...data,
      createdAt: new Date(data['createdAt'] as string),
      lastActivityAt: new Date(data['lastActivityAt'] as string),
      expiresAt: new Date(data['expiresAt'] as string),
      revokedAt: data['revokedAt'] ? new Date(data['revokedAt'] as string) : undefined,
    } as Session;
  }

  /**
   * Stop the session store and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe(SESSION_REVOCATION_CHANNEL);
      await this.subscriber.quit();
      this.subscriber = null;
      this.isSubscribed = false;
    }

    logger.info('Session store stopped');
  }

  /**
   * Check if Redis is healthy
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    return checkRedisHealth();
  }

  /**
   * Get store statistics
   */
  getStats(): {
    revokedCacheSize: number;
    instanceId: string;
    isSubscribed: boolean;
  } {
    return {
      revokedCacheSize: revokedSessionsCache.size,
      instanceId: this.instanceId,
      isSubscribed: this.isSubscribed,
    };
  }
}

/**
 * Singleton session store instance
 */
let sessionStore: SessionStore | null = null;

/**
 * Get the session store singleton
 */
export function getSessionStore(config?: Partial<SessionStoreConfig>): SessionStore {
  if (!sessionStore) {
    sessionStore = new SessionStore(config);
  }
  return sessionStore;
}

/**
 * Create a new session store instance (for testing)
 */
export function createSessionStore(
  config?: Partial<SessionStoreConfig>,
  securityLogger?: SecurityAuditLogger
): SessionStore {
  return new SessionStore(config, securityLogger);
}

/**
 * Reset the session store singleton (for testing)
 */
export async function resetSessionStore(): Promise<void> {
  if (sessionStore) {
    await sessionStore.stop();
    sessionStore = null;
  }
  revokedSessionsCache.clear();
  logger.info('Session store singleton reset');
}
