/**
 * Brute Force Protection System
 *
 * Provides comprehensive protection against brute force login attacks.
 * Features include:
 * - Redis-backed distributed attempt tracking
 * - Progressive lockout with configurable escalation
 * - IP-based rate limiting
 * - CAPTCHA triggering after threshold attempts
 * - Automatic cleanup of stale records
 * - Admin unlock capabilities with audit logging
 *
 * @packageDocumentation
 * @module security/brute-force
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import type { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';

const logger = createLogger({ component: 'brute-force-protection' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for login attempts */
const ATTEMPTS_PREFIX = 'vorion:brute_force:attempts:';

/** Redis key prefix for lockout status */
const LOCKOUT_PREFIX = 'vorion:brute_force:lockout:';

/** Redis key prefix for IP rate limiting */
const IP_RATE_PREFIX = 'vorion:brute_force:ip_rate:';

/** Redis key prefix for lockout count tracking */
const LOCKOUT_COUNT_PREFIX = 'vorion:brute_force:lockout_count:';

/** Redis key prefix for admin unlock audit */
const UNLOCK_AUDIT_PREFIX = 'vorion:brute_force:unlock_audit:';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for brute force protection
 */
export interface BruteForceConfig {
  /**
   * Maximum number of failed login attempts before lockout
   * @default 5
   */
  maxAttempts: number;

  /**
   * Time window in minutes to track failed attempts
   * @default 15
   */
  windowMinutes: number;

  /**
   * Base lockout duration in minutes
   * @default 30
   */
  lockoutMinutes: number;

  /**
   * Whether to double lockout duration for each subsequent lockout
   * @default true
   */
  progressiveLockout: boolean;

  /**
   * Maximum lockout duration in minutes (24 hours)
   * @default 1440
   */
  maxLockoutMinutes: number;

  /**
   * Whether to emit notification events on lockout
   * @default true
   */
  notifyOnLockout: boolean;

  /**
   * Number of failed attempts after which CAPTCHA is required
   * @default 3
   */
  captchaAfterAttempts: number;

  /**
   * Whether to enable IP-based rate limiting
   * @default true
   */
  ipRateLimiting: boolean;

  /**
   * Maximum attempts per IP address per hour
   * @default 100
   */
  ipMaxAttempts: number;

  /**
   * Whether to track attempts by username
   * @default true
   */
  trackByUsername: boolean;

  /**
   * Whether to track attempts by IP address
   * @default true
   */
  trackByIP: boolean;
}

/**
 * Represents a single login attempt
 */
export interface LoginAttempt {
  /** User ID if known (for authenticated attempts) */
  userId?: string;

  /** Username used in the login attempt */
  username?: string;

  /** IP address of the client */
  ipAddress: string;

  /** User agent string from the request */
  userAgent: string;

  /** Timestamp of the attempt */
  timestamp: Date;

  /** Whether the login was successful */
  success: boolean;

  /** Reason for failure if unsuccessful */
  failureReason?: string;
}

/**
 * Current lockout status for an identifier
 */
export interface LockoutStatus {
  /** Whether the account/IP is currently locked out */
  locked: boolean;

  /** Number of remaining attempts before lockout */
  remainingAttempts: number;

  /** When the lockout will end (if locked) */
  lockoutEndsAt?: Date;

  /** Total number of times this identifier has been locked out */
  lockoutCount: number;

  /** Whether CAPTCHA verification is required */
  requiresCaptcha: boolean;
}

/**
 * Serialized login attempt for Redis storage
 */
interface SerializedAttempt {
  userId?: string;
  username?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  success: boolean;
  failureReason?: string;
}

/**
 * Lockout notification event
 */
export interface LockoutEvent {
  /** Type of event */
  type: 'lockout' | 'unlock' | 'ip_blocked';

  /** Identifier that was locked/unlocked */
  identifier: string;

  /** IP address if applicable */
  ipAddress?: string;

  /** Username if applicable */
  username?: string;

  /** When the lockout started */
  lockedAt: Date;

  /** When the lockout ends */
  lockoutEndsAt?: Date;

  /** Number of failed attempts that triggered lockout */
  failedAttempts: number;

  /** Total lockout count for this identifier */
  lockoutCount: number;

  /** Reason for unlock if manually unlocked */
  unlockReason?: string;

  /** Admin ID who performed unlock if applicable */
  adminId?: string;
}

/**
 * Callback for lockout events
 */
export type LockoutEventCallback = (event: LockoutEvent) => void | Promise<void>;

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default brute force protection configuration
 */
export const DEFAULT_BRUTE_FORCE_CONFIG: BruteForceConfig = {
  maxAttempts: 5,
  windowMinutes: 15,
  lockoutMinutes: 30,
  progressiveLockout: true,
  maxLockoutMinutes: 1440, // 24 hours
  notifyOnLockout: true,
  captchaAfterAttempts: 3,
  ipRateLimiting: true,
  ipMaxAttempts: 100,
  trackByUsername: true,
  trackByIP: true,
};

// =============================================================================
// BruteForceProtection Class
// =============================================================================

/**
 * Brute Force Protection Service
 *
 * Provides comprehensive protection against brute force attacks
 * with Redis-backed distributed tracking.
 *
 * @example
 * ```typescript
 * const protection = new BruteForceProtection({
 *   maxAttempts: 5,
 *   windowMinutes: 15,
 *   lockoutMinutes: 30,
 * });
 *
 * // Record a failed attempt
 * await protection.recordAttempt({
 *   username: 'user@example.com',
 *   ipAddress: '192.168.1.1',
 *   userAgent: 'Mozilla/5.0...',
 *   timestamp: new Date(),
 *   success: false,
 *   failureReason: 'invalid_password',
 * });
 *
 * // Check lockout status before login
 * const status = await protection.isLockedOut('user@example.com');
 * if (status.locked) {
 *   console.log('Account locked until:', status.lockoutEndsAt);
 * }
 * ```
 */
export class BruteForceProtection {
  private readonly config: BruteForceConfig;
  private readonly redis: Redis;
  private readonly eventCallbacks: LockoutEventCallback[] = [];

  /**
   * Creates a new BruteForceProtection instance
   *
   * @param config - Configuration options
   * @param redis - Optional Redis instance (uses shared instance if not provided)
   */
  constructor(config: Partial<BruteForceConfig> = {}, redis?: Redis) {
    this.config = { ...DEFAULT_BRUTE_FORCE_CONFIG, ...config };
    this.redis = redis ?? getRedis();

    logger.info(
      {
        maxAttempts: this.config.maxAttempts,
        windowMinutes: this.config.windowMinutes,
        lockoutMinutes: this.config.lockoutMinutes,
        progressiveLockout: this.config.progressiveLockout,
        ipRateLimiting: this.config.ipRateLimiting,
      },
      'BruteForceProtection initialized'
    );
  }

  /**
   * Registers a callback for lockout events
   *
   * @param callback - Function to call when lockout events occur
   */
  onLockoutEvent(callback: LockoutEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Emits a lockout event to all registered callbacks
   *
   * @param event - The lockout event to emit
   */
  private async emitEvent(event: LockoutEvent): Promise<void> {
    if (!this.config.notifyOnLockout) {
      return;
    }

    logger.info({ event }, 'Lockout event emitted');

    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        logger.error({ error, event }, 'Error in lockout event callback');
      }
    }
  }

  /**
   * Records a login attempt and updates protection state
   *
   * @param attempt - The login attempt to record
   */
  async recordAttempt(attempt: LoginAttempt): Promise<void> {
    const serialized: SerializedAttempt = {
      ...attempt,
      timestamp: attempt.timestamp.toISOString(),
    };

    const windowMs = this.config.windowMinutes * 60 * 1000;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Track by username if enabled and username is provided
    if (this.config.trackByUsername && attempt.username) {
      await this.recordAttemptForIdentifier(
        attempt.username,
        serialized,
        windowStart,
        now
      );
    }

    // Track by IP if enabled
    if (this.config.trackByIP && attempt.ipAddress) {
      await this.recordAttemptForIdentifier(
        `ip:${attempt.ipAddress}`,
        serialized,
        windowStart,
        now
      );
    }

    // Track IP rate limiting
    if (this.config.ipRateLimiting && attempt.ipAddress) {
      await this.recordIPAttempt(attempt.ipAddress);
    }

    // If attempt failed, check if we need to trigger lockout
    if (!attempt.success) {
      if (attempt.username) {
        await this.checkAndTriggerLockout(attempt.username, attempt);
      }
      if (attempt.ipAddress) {
        await this.checkAndTriggerLockout(`ip:${attempt.ipAddress}`, attempt);
      }
    } else {
      // Successful login - clear failed attempts for this identifier
      if (attempt.username) {
        await this.clearAttempts(attempt.username);
      }
    }

    logger.debug(
      {
        username: attempt.username,
        ipAddress: attempt.ipAddress,
        success: attempt.success,
        failureReason: attempt.failureReason,
      },
      'Login attempt recorded'
    );
  }

  /**
   * Records an attempt for a specific identifier
   */
  private async recordAttemptForIdentifier(
    identifier: string,
    attempt: SerializedAttempt,
    windowStart: number,
    now: number
  ): Promise<void> {
    const key = `${ATTEMPTS_PREFIX}${identifier}`;

    // Add attempt to sorted set with timestamp as score
    await this.redis.zadd(key, now, JSON.stringify(attempt));

    // Remove old attempts outside the window
    await this.redis.zremrangebyscore(key, '-inf', windowStart);

    // Set expiry on the key
    await this.redis.expire(key, this.config.windowMinutes * 60 + 60);
  }

  /**
   * Records an IP rate limit attempt
   */
  private async recordIPAttempt(ipAddress: string): Promise<void> {
    const key = `${IP_RATE_PREFIX}${ipAddress}`;
    const hourInSeconds = 3600;

    // Increment counter
    const count = await this.redis.incr(key);

    // Set expiry on first increment
    if (count === 1) {
      await this.redis.expire(key, hourInSeconds);
    }
  }

  /**
   * Checks if lockout should be triggered and triggers it if necessary
   */
  private async checkAndTriggerLockout(
    identifier: string,
    attempt: LoginAttempt
  ): Promise<void> {
    const failedAttempts = await this.getFailedAttemptCount(identifier);

    if (failedAttempts >= this.config.maxAttempts) {
      await this.triggerLockout(identifier, failedAttempts, attempt);
    }
  }

  /**
   * Triggers a lockout for an identifier
   */
  private async triggerLockout(
    identifier: string,
    failedAttempts: number,
    attempt: LoginAttempt
  ): Promise<void> {
    // Get current lockout count
    const lockoutCountKey = `${LOCKOUT_COUNT_PREFIX}${identifier}`;
    const currentLockoutCount = parseInt(
      (await this.redis.get(lockoutCountKey)) ?? '0',
      10
    );
    const newLockoutCount = currentLockoutCount + 1;

    // Calculate lockout duration with progressive scaling
    let lockoutMinutes = this.config.lockoutMinutes;
    if (this.config.progressiveLockout) {
      lockoutMinutes = Math.min(
        this.config.lockoutMinutes * Math.pow(2, currentLockoutCount),
        this.config.maxLockoutMinutes
      );
    }

    const lockoutEndsAt = new Date(Date.now() + lockoutMinutes * 60 * 1000);
    const lockoutKey = `${LOCKOUT_PREFIX}${identifier}`;

    // Store lockout data
    const lockoutData = {
      lockedAt: new Date().toISOString(),
      lockoutEndsAt: lockoutEndsAt.toISOString(),
      failedAttempts,
      lockoutCount: newLockoutCount,
      triggeringIp: attempt.ipAddress,
      triggeringUsername: attempt.username,
    };

    await this.redis.setex(
      lockoutKey,
      lockoutMinutes * 60,
      JSON.stringify(lockoutData)
    );

    // Update lockout count (keep for 30 days)
    await this.redis.setex(
      lockoutCountKey,
      30 * 24 * 60 * 60,
      newLockoutCount.toString()
    );

    logger.warn(
      {
        identifier,
        failedAttempts,
        lockoutCount: newLockoutCount,
        lockoutMinutes,
        lockoutEndsAt,
      },
      'Account locked out due to failed login attempts'
    );

    // Emit lockout event
    await this.emitEvent({
      type: 'lockout',
      identifier,
      ipAddress: attempt.ipAddress,
      username: attempt.username,
      lockedAt: new Date(),
      lockoutEndsAt,
      failedAttempts,
      lockoutCount: newLockoutCount,
    });
  }

  /**
   * Gets the count of failed attempts for an identifier
   */
  private async getFailedAttemptCount(identifier: string): Promise<number> {
    const key = `${ATTEMPTS_PREFIX}${identifier}`;
    const windowMs = this.config.windowMinutes * 60 * 1000;
    const windowStart = Date.now() - windowMs;

    // Get all attempts in the window
    const attempts = await this.redis.zrangebyscore(key, windowStart, '+inf');

    // Count only failed attempts
    let failedCount = 0;
    for (const attemptStr of attempts) {
      try {
        const attempt = JSON.parse(attemptStr) as SerializedAttempt;
        if (!attempt.success) {
          failedCount++;
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return failedCount;
  }

  /**
   * Clears attempts for an identifier (e.g., after successful login)
   */
  private async clearAttempts(identifier: string): Promise<void> {
    const key = `${ATTEMPTS_PREFIX}${identifier}`;
    await this.redis.del(key);
  }

  /**
   * Checks the lockout status for an identifier
   *
   * @param identifier - Username or IP-prefixed string to check
   * @returns Current lockout status
   */
  async isLockedOut(identifier: string): Promise<LockoutStatus> {
    const lockoutKey = `${LOCKOUT_PREFIX}${identifier}`;
    const lockoutCountKey = `${LOCKOUT_COUNT_PREFIX}${identifier}`;

    // Check for active lockout
    const lockoutDataStr = await this.redis.get(lockoutKey);
    const lockoutCount = parseInt(
      (await this.redis.get(lockoutCountKey)) ?? '0',
      10
    );

    if (lockoutDataStr) {
      try {
        const lockoutData = JSON.parse(lockoutDataStr) as {
          lockoutEndsAt: string;
        };
        const lockoutEndsAt = new Date(lockoutData.lockoutEndsAt);

        if (lockoutEndsAt > new Date()) {
          return {
            locked: true,
            remainingAttempts: 0,
            lockoutEndsAt,
            lockoutCount,
            requiresCaptcha: true,
          };
        }
      } catch {
        // Invalid lockout data, continue
      }
    }

    // Not locked - check remaining attempts
    const failedAttempts = await this.getFailedAttemptCount(identifier);
    const remainingAttempts = Math.max(
      0,
      this.config.maxAttempts - failedAttempts
    );
    const requiresCaptcha = failedAttempts >= this.config.captchaAfterAttempts;

    return {
      locked: false,
      remainingAttempts,
      lockoutCount,
      requiresCaptcha,
    };
  }

  /**
   * Checks if an IP address is blocked due to rate limiting
   *
   * @param ip - IP address to check
   * @returns Whether the IP is blocked
   */
  async isIPBlocked(ip: string): Promise<boolean> {
    if (!this.config.ipRateLimiting) {
      return false;
    }

    const key = `${IP_RATE_PREFIX}${ip}`;
    const countStr = await this.redis.get(key);

    if (!countStr) {
      return false;
    }

    const count = parseInt(countStr, 10);
    const blocked = count > this.config.ipMaxAttempts;

    if (blocked) {
      logger.warn(
        { ip, attempts: count, maxAttempts: this.config.ipMaxAttempts },
        'IP address blocked due to rate limiting'
      );

      await this.emitEvent({
        type: 'ip_blocked',
        identifier: ip,
        ipAddress: ip,
        lockedAt: new Date(),
        failedAttempts: count,
        lockoutCount: 0,
      });
    }

    return blocked;
  }

  /**
   * Gets the remaining attempts before lockout for an identifier
   *
   * @param identifier - Username or IP to check
   * @returns Number of remaining attempts
   */
  async getRemainingAttempts(identifier: string): Promise<number> {
    const status = await this.isLockedOut(identifier);
    return status.remainingAttempts;
  }

  /**
   * Manually unlocks an account (admin action)
   *
   * @param identifier - Username or IP to unlock
   * @param reason - Reason for the unlock
   * @param adminId - ID of the admin performing the unlock
   */
  async unlockAccount(
    identifier: string,
    reason: string,
    adminId: string
  ): Promise<void> {
    const lockoutKey = `${LOCKOUT_PREFIX}${identifier}`;
    const attemptsKey = `${ATTEMPTS_PREFIX}${identifier}`;
    const auditKey = `${UNLOCK_AUDIT_PREFIX}${identifier}:${Date.now()}`;

    // Get current lockout info for audit
    const lockoutDataStr = await this.redis.get(lockoutKey);
    let lockoutCount = 0;

    if (lockoutDataStr) {
      try {
        const lockoutData = JSON.parse(lockoutDataStr) as {
          lockoutCount?: number;
        };
        lockoutCount = lockoutData.lockoutCount ?? 0;
      } catch {
        // Invalid data
      }
    }

    // Store audit record
    const auditRecord = {
      identifier,
      reason,
      adminId,
      unlockedAt: new Date().toISOString(),
      previousLockoutCount: lockoutCount,
    };

    await this.redis.setex(
      auditKey,
      90 * 24 * 60 * 60, // Keep audit records for 90 days
      JSON.stringify(auditRecord)
    );

    // Clear lockout and attempts
    await this.redis.del(lockoutKey);
    await this.redis.del(attemptsKey);

    logger.info(
      { identifier, reason, adminId },
      'Account manually unlocked by admin'
    );

    await this.emitEvent({
      type: 'unlock',
      identifier,
      lockedAt: new Date(),
      failedAttempts: 0,
      lockoutCount,
      unlockReason: reason,
      adminId,
    });
  }

  /**
   * Checks if CAPTCHA is required for an identifier
   *
   * @param identifier - Username or IP to check
   * @returns Whether CAPTCHA is required
   */
  async requiresCaptcha(identifier: string): Promise<boolean> {
    const status = await this.isLockedOut(identifier);
    return status.requiresCaptcha;
  }

  /**
   * Gets recent login attempts for an identifier
   *
   * @param identifier - Username or IP to get attempts for
   * @param minutes - Time window in minutes
   * @returns Array of recent login attempts
   */
  async getRecentAttempts(
    identifier: string,
    minutes: number
  ): Promise<LoginAttempt[]> {
    const key = `${ATTEMPTS_PREFIX}${identifier}`;
    const windowMs = minutes * 60 * 1000;
    const windowStart = Date.now() - windowMs;

    const attemptStrings = await this.redis.zrangebyscore(
      key,
      windowStart,
      '+inf'
    );

    const attempts: LoginAttempt[] = [];
    for (const attemptStr of attemptStrings) {
      try {
        const serialized = JSON.parse(attemptStr) as SerializedAttempt;
        attempts.push({
          ...serialized,
          timestamp: new Date(serialized.timestamp),
        });
      } catch {
        // Invalid JSON, skip
      }
    }

    return attempts;
  }

  /**
   * Cleans up old records to prevent unbounded storage growth
   *
   * This should be called periodically (e.g., via cron job)
   */
  async cleanup(): Promise<void> {
    const windowMs = this.config.windowMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs - 3600000; // Add 1 hour buffer

    let cleanedAttempts = 0;
    let cleanedLockouts = 0;
    let cursor = '0';

    // Clean up old attempts
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${ATTEMPTS_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        const removed = await this.redis.zremrangebyscore(key, '-inf', cutoff);
        cleanedAttempts += removed;

        // Delete empty keys
        const remaining = await this.redis.zcard(key);
        if (remaining === 0) {
          await this.redis.del(key);
        }
      }
    } while (cursor !== '0');

    // Clean up expired IP rate limits (Redis TTL handles this, but we can clean orphaned keys)
    cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${IP_RATE_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) {
          // No expiry set, delete
          await this.redis.del(key);
          cleanedLockouts++;
        }
      }
    } while (cursor !== '0');

    logger.info(
      { cleanedAttempts, cleanedLockouts },
      'Brute force protection cleanup completed'
    );
  }

  /**
   * Gets the current configuration
   *
   * @returns Current brute force configuration
   */
  getConfig(): BruteForceConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Fastify Middleware
// =============================================================================

/**
 * Options for the brute force middleware
 */
export interface BruteForceMiddlewareOptions {
  /** Brute force protection instance */
  protection?: BruteForceProtection;

  /** Brute force configuration (if not providing protection instance) */
  config?: Partial<BruteForceConfig>;

  /** Paths to skip protection for */
  skipPaths?: string[];

  /** Function to extract username from request */
  extractUsername?: (request: FastifyRequest) => string | undefined;

  /** Function to extract user ID from request */
  extractUserId?: (request: FastifyRequest) => string | undefined;

  /** Whether to check IP blocking */
  checkIPBlocking?: boolean;

  /** Whether to check account lockout */
  checkAccountLockout?: boolean;

  /** Custom response for locked accounts */
  lockedResponse?: (status: LockoutStatus) => {
    statusCode: number;
    body: Record<string, unknown>;
  };

  /** Custom response for blocked IPs */
  ipBlockedResponse?: () => {
    statusCode: number;
    body: Record<string, unknown>;
  };
}

/**
 * Creates Fastify middleware for brute force protection
 *
 * @param options - Middleware options
 * @returns Fastify preHandler hook
 *
 * @example
 * ```typescript
 * const bruteForceMiddleware = createBruteForceMiddleware({
 *   config: {
 *     maxAttempts: 5,
 *     lockoutMinutes: 30,
 *   },
 *   skipPaths: ['/health', '/metrics'],
 *   extractUsername: (req) => req.body?.email,
 * });
 *
 * fastify.addHook('preHandler', bruteForceMiddleware);
 * ```
 */
export function createBruteForceMiddleware(
  options: BruteForceMiddlewareOptions = {}
): preHandlerHookHandler {
  const protection =
    options.protection ?? new BruteForceProtection(options.config);
  const skipPaths = new Set(options.skipPaths ?? []);
  const checkIPBlocking = options.checkIPBlocking ?? true;
  const checkAccountLockout = options.checkAccountLockout ?? true;

  const defaultExtractUsername = (
    request: FastifyRequest
  ): string | undefined => {
    const body = request.body as
      | { username?: string; email?: string }
      | undefined;
    return body?.username ?? body?.email;
  };

  const defaultExtractUserId = (request: FastifyRequest): string | undefined => {
    const user = (request as { user?: { id?: string; sub?: string } }).user;
    return user?.id ?? user?.sub;
  };

  const extractUsername = options.extractUsername ?? defaultExtractUsername;
  const extractUserId = options.extractUserId ?? defaultExtractUserId;

  const defaultLockedResponse = (status: LockoutStatus) => ({
    statusCode: 429,
    body: {
      error: {
        code: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked due to too many failed login attempts',
        lockoutEndsAt: status.lockoutEndsAt?.toISOString(),
        requiresCaptcha: status.requiresCaptcha,
      },
    },
  });

  const defaultIPBlockedResponse = () => ({
    statusCode: 429,
    body: {
      error: {
        code: 'IP_RATE_LIMITED',
        message: 'Too many requests from this IP address',
      },
    },
  });

  const lockedResponse = options.lockedResponse ?? defaultLockedResponse;
  const ipBlockedResponse = options.ipBlockedResponse ?? defaultIPBlockedResponse;

  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    // Skip configured paths
    const routeUrl = request.routeOptions?.url ?? '';
    if (skipPaths.has(request.url) || skipPaths.has(routeUrl)) {
      return;
    }

    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip;

    // Check IP blocking first
    if (checkIPBlocking && ipAddress) {
      const ipBlocked = await protection.isIPBlocked(ipAddress);
      if (ipBlocked) {
        const response = ipBlockedResponse();
        return reply.status(response.statusCode).send(response.body);
      }
    }

    // Check account lockout
    if (checkAccountLockout) {
      const username = extractUsername(request);
      if (username) {
        const status = await protection.isLockedOut(username);
        if (status.locked) {
          logger.warn(
            { username, ipAddress, lockoutEndsAt: status.lockoutEndsAt },
            'Login attempt blocked - account locked'
          );
          const response = lockedResponse(status);
          return reply.status(response.statusCode).send(response.body);
        }

        // Decorate request with lockout status for downstream handlers
        (request as FastifyRequest & { bruteForceStatus?: LockoutStatus }).bruteForceStatus = status;
      }
    }
  };
}

/**
 * Creates a post-authentication hook to record login attempts
 *
 * @param protection - BruteForceProtection instance
 * @param options - Hook options
 * @returns Function to record attempt
 *
 * @example
 * ```typescript
 * const recordAttempt = createRecordAttemptHook(protection);
 *
 * // In your login handler:
 * try {
 *   const user = await authenticate(username, password);
 *   await recordAttempt(request, true);
 *   return { success: true, user };
 * } catch (error) {
 *   await recordAttempt(request, false, error.message);
 *   throw error;
 * }
 * ```
 */
export function createRecordAttemptHook(
  protection: BruteForceProtection,
  options: {
    extractUsername?: (request: FastifyRequest) => string | undefined;
    extractUserId?: (request: FastifyRequest) => string | undefined;
  } = {}
): (
  request: FastifyRequest,
  success: boolean,
  failureReason?: string
) => Promise<void> {
  const defaultExtractUsername = (
    request: FastifyRequest
  ): string | undefined => {
    const body = request.body as
      | { username?: string; email?: string }
      | undefined;
    return body?.username ?? body?.email;
  };

  const defaultExtractUserId = (request: FastifyRequest): string | undefined => {
    const user = (request as { user?: { id?: string; sub?: string } }).user;
    return user?.id ?? user?.sub;
  };

  const extractUsername = options.extractUsername ?? defaultExtractUsername;
  const extractUserId = options.extractUserId ?? defaultExtractUserId;

  return async (
    request: FastifyRequest,
    success: boolean,
    failureReason?: string
  ): Promise<void> => {
    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip;

    const attempt: LoginAttempt = {
      userId: extractUserId(request),
      username: extractUsername(request),
      ipAddress,
      userAgent: request.headers['user-agent'] ?? 'unknown',
      timestamp: new Date(),
      success,
      failureReason,
    };

    await protection.recordAttempt(attempt);
  };
}

// =============================================================================
// Fastify Request Declaration
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    bruteForceStatus?: LockoutStatus;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let bruteForceInstance: BruteForceProtection | null = null;

/**
 * Gets or creates the singleton BruteForceProtection instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton BruteForceProtection instance
 *
 * @example
 * ```typescript
 * // Initialize with custom config
 * const protection = getBruteForceProtection({
 *   maxAttempts: 3,
 *   lockoutMinutes: 60,
 * });
 *
 * // Later, get the same instance
 * const sameProtection = getBruteForceProtection();
 * ```
 */
export function getBruteForceProtection(
  config?: Partial<BruteForceConfig>
): BruteForceProtection {
  if (!bruteForceInstance) {
    bruteForceInstance = new BruteForceProtection(config);
  }
  return bruteForceInstance;
}

/**
 * Resets the singleton instance (primarily for testing)
 */
export function resetBruteForceProtection(): void {
  bruteForceInstance = null;
}
