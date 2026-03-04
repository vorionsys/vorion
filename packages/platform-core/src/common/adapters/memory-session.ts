/**
 * In-Memory Session Store Adapter
 *
 * Provides a session store implementation that runs entirely in memory,
 * suitable for development, testing, or single-instance deployments.
 *
 * Features:
 * - Session storage with Map
 * - TTL tracking with automatic expiration
 * - User index for getUserSessions
 * - Session revocation support
 * - Maximum sessions per user enforcement
 *
 * Note: In-memory sessions are NOT shared across instances.
 * Use Redis-backed sessions for multi-instance deployments.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger.js';
import type { ISessionStoreAdapter, Session, CreateSessionInput } from './types.js';

const logger = createLogger({ component: 'memory-session' });

/**
 * Configuration options for the memory session store
 */
export interface MemorySessionStoreOptions {
  /** Default session TTL in seconds (default: 24 hours) */
  defaultTTL?: number;
  /** Maximum sessions per user (default: 10) */
  maxSessionsPerUser?: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
}

/**
 * Default configuration
 */
const DEFAULT_OPTIONS: Required<MemorySessionStoreOptions> = {
  defaultTTL: 86400, // 24 hours
  maxSessionsPerUser: 10,
  cleanupIntervalMs: 300000, // 5 minutes
};

/**
 * In-memory session store adapter implementation
 */
export class MemorySessionStoreAdapter implements ISessionStoreAdapter {
  private sessions = new Map<string, Session>();
  private userSessions = new Map<string, Set<string>>(); // userId -> sessionIds
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<MemorySessionStoreOptions>;

  constructor(options?: MemorySessionStoreOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Start background cleanup
    this.startCleanup();

    logger.debug(
      { defaultTTL: this.options.defaultTTL, maxSessionsPerUser: this.options.maxSessionsPerUser },
      'Memory session store created'
    );
  }

  /**
   * Create a new session
   */
  async create(input: CreateSessionInput): Promise<Session> {
    const sessionId = randomUUID();
    const now = new Date();
    const ttl = input.ttlSeconds ?? this.options.defaultTTL;
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
    this.sessions.set(sessionId, session);

    // Add to user index
    let userSessionSet = this.userSessions.get(input.userId);
    if (!userSessionSet) {
      userSessionSet = new Set();
      this.userSessions.set(input.userId, userSessionSet);
    }
    userSessionSet.add(sessionId);

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
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt < new Date()) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Delete a session permanently
   */
  async delete(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    // Remove from sessions map
    this.sessions.delete(sessionId);

    // Remove from user index
    const userSessionSet = this.userSessions.get(session.userId);
    if (userSessionSet) {
      userSessionSet.delete(sessionId);
      if (userSessionSet.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    return true;
  }

  /**
   * Revoke a session
   */
  async revoke(sessionId: string, reason: string, revokedBy: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.revoked = true;
    session.revokedAt = new Date();
    session.revokedReason = reason;
    session.revokedBy = revokedBy;

    // Keep the session briefly for revocation detection, then schedule deletion
    setTimeout(() => {
      this.sessions.delete(sessionId);
      const userSessionSet = this.userSessions.get(session.userId);
      if (userSessionSet) {
        userSessionSet.delete(sessionId);
      }
    }, 300000); // 5 minutes

    logger.info(
      { sessionId, userId: session.userId, reason, revokedBy },
      'Session revoked'
    );

    return true;
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    const sessionIds = this.userSessions.get(userId);

    if (!sessionIds) {
      return [];
    }

    const sessions: Session[] = [];
    const expiredIds: string[] = [];
    const now = new Date();

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);

      if (!session) {
        expiredIds.push(sessionId);
        continue;
      }

      // Check expiration
      if (session.expiresAt < now) {
        expiredIds.push(sessionId);
        continue;
      }

      // Skip revoked sessions
      if (session.revoked) {
        continue;
      }

      sessions.push(session);
    }

    // Clean up expired sessions from index
    for (const sessionId of expiredIds) {
      sessionIds.delete(sessionId);
      this.sessions.delete(sessionId);
    }

    return sessions;
  }

  /**
   * Update session activity timestamp
   */
  async touch(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    if (!session || session.revoked) {
      return false;
    }

    session.lastActivityAt = new Date();
    return true;
  }

  /**
   * Validate a session
   */
  async validate(sessionId: string): Promise<{
    valid: boolean;
    session?: Session;
    reason?: string;
  }> {
    const session = await this.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'Session not found or expired' };
    }

    if (session.revoked) {
      return {
        valid: false,
        session,
        reason: session.revokedReason ?? 'Session has been revoked',
      };
    }

    if (session.expiresAt < new Date()) {
      return { valid: false, session, reason: 'Session has expired' };
    }

    // Update activity
    await this.touch(sessionId);

    return { valid: true, session };
  }

  /**
   * Get the total number of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Stop the background cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Enforce maximum sessions per user
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);

    if (sessions.length >= this.options.maxSessionsPerUser) {
      // Sort by last activity, oldest first
      sessions.sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime());

      // Revoke oldest sessions to make room
      const toRevoke = sessions.slice(0, sessions.length - this.options.maxSessionsPerUser + 1);
      for (const session of toRevoke) {
        await this.revoke(session.id, 'Maximum session limit exceeded', 'system');
      }

      logger.info(
        { userId, revokedCount: toRevoke.length, maxSessions: this.options.maxSessionsPerUser },
        'Old sessions revoked due to session limit'
      );
    }
  }

  /**
   * Start background cleanup of expired sessions
   */
  private startCleanup(): void {
    if (this.options.cleanupIntervalMs <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.options.cleanupIntervalMs);

    // Don't block process exit
    this.cleanupTimer.unref();
  }

  /**
   * Remove expired sessions
   */
  private cleanupExpired(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);

        // Remove from user index
        const userSessionSet = this.userSessions.get(session.userId);
        if (userSessionSet) {
          userSessionSet.delete(sessionId);
          if (userSessionSet.size === 0) {
            this.userSessions.delete(session.userId);
          }
        }

        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug({ expiredCount }, 'Cleaned up expired sessions');
    }
  }
}

/**
 * Singleton instance for default usage
 */
let defaultInstance: MemorySessionStoreAdapter | null = null;

/**
 * Get the default memory session store instance
 */
export function getMemorySessionStoreAdapter(
  options?: MemorySessionStoreOptions
): ISessionStoreAdapter {
  if (!defaultInstance) {
    defaultInstance = new MemorySessionStoreAdapter(options);
  }
  return defaultInstance;
}

/**
 * Create a new memory session store instance (for testing)
 */
export function createMemorySessionStoreAdapter(
  options?: MemorySessionStoreOptions
): MemorySessionStoreAdapter {
  return new MemorySessionStoreAdapter(options);
}

/**
 * Reset the default instance (for testing)
 */
export function resetMemorySessionStoreAdapter(): void {
  if (defaultInstance) {
    defaultInstance.stop();
    defaultInstance = null;
  }
}
