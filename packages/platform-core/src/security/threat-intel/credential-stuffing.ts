/**
 * Credential Stuffing Attack Detector
 *
 * Advanced detection system for identifying credential stuffing attacks
 * against authentication endpoints. Features include:
 * - Real-time pattern analysis across multiple signals
 * - Redis-backed distributed tracking with sliding windows
 * - Integration with brute-force protection and alerting systems
 * - Automatic response actions (CAPTCHA, blocking, incidents)
 *
 * Attack Types Detected:
 * - Credential stuffing: Many usernames from single IP with high failure rate
 * - Brute force: Single username, many password attempts
 * - Password spraying: Single password across many usernames
 * - Bot attacks: Consistent timing patterns, automated behavior
 *
 * @packageDocumentation
 * @module security/threat-intel/credential-stuffing
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import { getRedis } from '../../common/redis.js';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  type BruteForceProtection,
  getBruteForceProtection,
} from '../brute-force.js';
import {
  type SecurityAlertService,
  getSecurityAlertService,
} from '../alerting/service.js';
import {
  AlertSeverity,
  SecurityEventType,
} from '../alerting/types.js';
import {
  type Incident,
  type CreateIncidentInput,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '../incident/types.js';

const logger = createLogger({ component: 'credential-stuffing-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for auth attempts */
const ATTEMPTS_PREFIX = 'vorion:cred_stuffing:attempts:';

/** Redis key prefix for per-IP tracking */
const IP_ATTEMPTS_PREFIX = 'vorion:cred_stuffing:ip:';

/** Redis key prefix for per-username tracking */
const USERNAME_ATTEMPTS_PREFIX = 'vorion:cred_stuffing:user:';

/** Redis key prefix for global metrics */
const METRICS_PREFIX = 'vorion:cred_stuffing:metrics:';

/** Redis key prefix for blocked credentials */
const BLOCKED_PREFIX = 'vorion:cred_stuffing:blocked:';

/** Redis key prefix for timing analysis */
const TIMING_PREFIX = 'vorion:cred_stuffing:timing:';

/** Redis key prefix for attack state */
const ATTACK_STATE_PREFIX = 'vorion:cred_stuffing:attack_state:';

/** Default sliding window in seconds (1 hour) */
const DEFAULT_WINDOW_SECONDS = 3600;

/** Minimum attempts to consider for analysis */
const MIN_ATTEMPTS_FOR_ANALYSIS = 10;

// =============================================================================
// Types
// =============================================================================

/**
 * Authentication attempt record
 */
export interface AuthAttempt {
  /** Hashed username for privacy */
  username: string;
  /** Source IP address */
  ipAddress: string;
  /** Whether authentication succeeded */
  success: boolean;
  /** When the attempt occurred */
  timestamp: Date;
  /** User agent string */
  userAgent: string;
  /** Device/browser fingerprint */
  fingerprint: string;
  /** Optional geographic info */
  geoLocation?: {
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  /** Optional request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Attack type classification
 */
export type AttackType =
  | 'credential_stuffing'
  | 'brute_force'
  | 'password_spraying'
  | 'unknown';

/**
 * Recommended action based on attack analysis
 */
export type RecommendedAction =
  | 'monitor'
  | 'captcha'
  | 'block_ip'
  | 'block_account';

/**
 * Attack indicators returned by analysis
 */
export interface AttackIndicators {
  /** Whether an attack is detected */
  isAttack: boolean;
  /** Confidence score 0-100 */
  confidence: number;
  /** Classified attack type */
  attackType: AttackType;
  /** List of triggered indicators */
  indicators: string[];
  /** Recommended response action */
  recommendedAction: RecommendedAction;
  /** Number of affected accounts */
  affectedAccounts: number;
  /** Source IPs involved */
  sourceIPs: string[];
  /** Attack start time if detected */
  attackStartTime?: Date;
  /** Analysis timestamp */
  analyzedAt: Date;
  /** Raw metrics for debugging */
  metrics?: AttackMetrics;
}

/**
 * Internal metrics for attack analysis
 */
interface AttackMetrics {
  totalAttempts: number;
  failedAttempts: number;
  failureRate: number;
  uniqueUsernames: number;
  uniqueIPs: number;
  usernamesPerIP: Map<string, number>;
  IPsPerUsername: Map<string, number>;
  timingVariance: number;
  avgTimeBetweenAttempts: number;
  sequentialUsernameScore: number;
  geoDistributionScore: number;
}

/**
 * Configuration for the credential stuffing detector
 */
export interface CredentialStuffingConfig {
  /** Sliding window duration in seconds */
  windowSeconds: number;
  /** Failure rate threshold to trigger detection (0-1) */
  failureRateThreshold: number;
  /** Minimum usernames from single IP to flag */
  minUsernamesPerIP: number;
  /** Minimum IPs trying same username to flag */
  minIPsPerUsername: number;
  /** Maximum timing variance for bot detection (ms) */
  maxTimingVarianceMs: number;
  /** Confidence threshold to classify as attack */
  attackConfidenceThreshold: number;
  /** Whether to auto-trigger CAPTCHA */
  autoCaptcha: boolean;
  /** CAPTCHA trigger threshold */
  captchaThreshold: number;
  /** Whether to auto-block IPs */
  autoBlockIP: boolean;
  /** IP block threshold */
  ipBlockThreshold: number;
  /** Whether to create security incidents */
  createIncidents: boolean;
  /** Whether to send alerts */
  sendAlerts: boolean;
  /** Integration with brute force protection */
  integrateBruteForce: boolean;
  /** Known breached credential check endpoint (optional) */
  breachedCredentialCheckUrl?: string;
}

/**
 * Serialized attempt for Redis storage
 */
interface SerializedAttempt {
  username: string;
  ipAddress: string;
  success: boolean;
  timestamp: string;
  userAgent: string;
  fingerprint: string;
  geoLocation?: {
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Attack state stored in Redis
 */
interface AttackState {
  isUnderAttack: boolean;
  attackType: AttackType;
  confidence: number;
  detectedAt: string;
  lastAnalyzedAt: string;
  sourceIPs: string[];
  affectedAccounts: number;
  incidentId?: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CREDENTIAL_STUFFING_CONFIG: CredentialStuffingConfig = {
  windowSeconds: DEFAULT_WINDOW_SECONDS,
  failureRateThreshold: 0.9, // 90% failure rate
  minUsernamesPerIP: 10,
  minIPsPerUsername: 5,
  maxTimingVarianceMs: 100, // Very consistent timing indicates bot
  attackConfidenceThreshold: 70,
  autoCaptcha: true,
  captchaThreshold: 50,
  autoBlockIP: true,
  ipBlockThreshold: 80,
  createIncidents: true,
  sendAlerts: true,
  integrateBruteForce: true,
};

// =============================================================================
// CredentialStuffingDetector Class
// =============================================================================

/**
 * Credential Stuffing Attack Detector
 *
 * Detects and responds to credential stuffing attacks in real-time
 * using multiple behavioral signals and pattern analysis.
 *
 * @example
 * ```typescript
 * const detector = new CredentialStuffingDetector({
 *   failureRateThreshold: 0.9,
 *   autoCaptcha: true,
 * });
 *
 * // Record an authentication attempt
 * await detector.recordAttempt({
 *   username: hashUsername('user@example.com'),
 *   ipAddress: '192.168.1.1',
 *   success: false,
 *   timestamp: new Date(),
 *   userAgent: 'Mozilla/5.0...',
 *   fingerprint: 'abc123',
 * });
 *
 * // Check if under attack
 * if (await detector.isUnderAttack()) {
 *   const indicators = await detector.analyze();
 *   console.log('Attack detected:', indicators.attackType);
 * }
 * ```
 */
export class CredentialStuffingDetector {
  private readonly config: CredentialStuffingConfig;
  private readonly redis: Redis;
  private bruteForceProtection?: BruteForceProtection;
  private alertService?: SecurityAlertService;
  private incidentManager?: {
    createIncident: (input: CreateIncidentInput) => Promise<Incident>;
  };

  /**
   * Creates a new CredentialStuffingDetector instance
   *
   * @param config - Configuration options
   * @param redis - Optional Redis instance (uses shared instance if not provided)
   */
  constructor(
    config: Partial<CredentialStuffingConfig> = {},
    redis?: Redis
  ) {
    this.config = { ...DEFAULT_CREDENTIAL_STUFFING_CONFIG, ...config };
    this.redis = redis ?? getRedis();

    // Initialize integrations if enabled
    if (this.config.integrateBruteForce) {
      try {
        this.bruteForceProtection = getBruteForceProtection();
      } catch {
        logger.warn('Brute force protection not available for integration');
      }
    }

    if (this.config.sendAlerts) {
      try {
        this.alertService = getSecurityAlertService();
      } catch {
        logger.warn('Alert service not available for integration');
      }
    }

    logger.info(
      {
        windowSeconds: this.config.windowSeconds,
        failureRateThreshold: this.config.failureRateThreshold,
        autoCaptcha: this.config.autoCaptcha,
        autoBlockIP: this.config.autoBlockIP,
      },
      'CredentialStuffingDetector initialized'
    );
  }

  /**
   * Sets the incident manager for creating security incidents
   */
  setIncidentManager(manager: {
    createIncident: (input: CreateIncidentInput) => Promise<Incident>;
  }): void {
    this.incidentManager = manager;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Records an authentication attempt for analysis
   *
   * @param attempt - The authentication attempt to record
   */
  async recordAttempt(attempt: AuthAttempt): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.config.windowSeconds * 1000;

    const serialized: SerializedAttempt = {
      ...attempt,
      timestamp: attempt.timestamp.toISOString(),
    };

    // Store in main attempts sorted set
    const attemptsKey = `${ATTEMPTS_PREFIX}global`;
    await this.redis.zadd(attemptsKey, now, JSON.stringify(serialized));
    await this.redis.zremrangebyscore(attemptsKey, '-inf', windowStart);
    await this.redis.expire(attemptsKey, this.config.windowSeconds + 60);

    // Track per-IP attempts
    const ipKey = `${IP_ATTEMPTS_PREFIX}${attempt.ipAddress}`;
    await this.redis.zadd(ipKey, now, JSON.stringify(serialized));
    await this.redis.zremrangebyscore(ipKey, '-inf', windowStart);
    await this.redis.expire(ipKey, this.config.windowSeconds + 60);

    // Track per-username attempts
    const usernameKey = `${USERNAME_ATTEMPTS_PREFIX}${attempt.username}`;
    await this.redis.zadd(usernameKey, now, JSON.stringify(serialized));
    await this.redis.zremrangebyscore(usernameKey, '-inf', windowStart);
    await this.redis.expire(usernameKey, this.config.windowSeconds + 60);

    // Track timing for bot detection
    const timingKey = `${TIMING_PREFIX}${attempt.ipAddress}`;
    await this.redis.rpush(timingKey, now.toString());
    await this.redis.ltrim(timingKey, -100, -1); // Keep last 100 timestamps
    await this.redis.expire(timingKey, this.config.windowSeconds);

    // Update global metrics
    await this.updateMetrics(attempt);

    // Forward to brute force protection if integrated
    if (this.bruteForceProtection && this.config.integrateBruteForce) {
      await this.bruteForceProtection.recordAttempt({
        username: attempt.username,
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent,
        timestamp: attempt.timestamp,
        success: attempt.success,
        failureReason: attempt.success ? undefined : 'invalid_credentials',
      });
    }

    // Check if we should trigger analysis
    const totalAttempts = await this.redis.zcard(attemptsKey);
    if (totalAttempts >= MIN_ATTEMPTS_FOR_ANALYSIS) {
      // Run analysis in background for every 10th attempt
      if (totalAttempts % 10 === 0) {
        this.analyzeAndRespond().catch(err =>
          logger.error({ err }, 'Background analysis failed')
        );
      }
    }

    logger.debug(
      {
        username: attempt.username.slice(0, 8) + '...',
        ipAddress: attempt.ipAddress,
        success: attempt.success,
      },
      'Auth attempt recorded'
    );
  }

  /**
   * Analyzes recent authentication patterns for attack indicators
   *
   * @returns Attack indicators and recommended actions
   */
  async analyze(): Promise<AttackIndicators> {
    const metrics = await this.collectMetrics();
    const indicators: string[] = [];
    let confidence = 0;
    let attackType: AttackType = 'unknown';

    // Signal 1: High failure rate across many usernames
    if (
      metrics.failureRate >= this.config.failureRateThreshold &&
      metrics.uniqueUsernames >= this.config.minUsernamesPerIP
    ) {
      indicators.push(
        `High failure rate (${(metrics.failureRate * 100).toFixed(1)}%) across ${metrics.uniqueUsernames} usernames`
      );
      confidence += 25;
    }

    // Signal 2: Many usernames from single IP
    let maxUsernamesFromIP = 0;
    let topIP = '';
    for (const [ip, count] of metrics.usernamesPerIP) {
      if (count > maxUsernamesFromIP) {
        maxUsernamesFromIP = count;
        topIP = ip;
      }
    }
    if (maxUsernamesFromIP >= this.config.minUsernamesPerIP) {
      indicators.push(
        `Single IP (${topIP}) tried ${maxUsernamesFromIP} different usernames`
      );
      confidence += 20;
      attackType = 'credential_stuffing';
    }

    // Signal 3: Many IPs trying same username
    let maxIPsForUsername = 0;
    let topUsername = '';
    for (const [username, count] of metrics.IPsPerUsername) {
      if (count > maxIPsForUsername) {
        maxIPsForUsername = count;
        topUsername = username;
      }
    }
    if (maxIPsForUsername >= this.config.minIPsPerUsername) {
      indicators.push(
        `${maxIPsForUsername} different IPs tried username ${topUsername.slice(0, 8)}...`
      );
      confidence += 15;
      if (attackType === 'unknown') {
        attackType = 'brute_force';
      }
    }

    // Signal 4: Sequential username patterns
    if (metrics.sequentialUsernameScore > 0.5) {
      indicators.push(
        `Sequential username pattern detected (score: ${(metrics.sequentialUsernameScore * 100).toFixed(0)}%)`
      );
      confidence += 15;
      attackType = 'credential_stuffing';
    }

    // Signal 5: Bot-like timing patterns (very consistent intervals)
    if (
      metrics.timingVariance > 0 &&
      metrics.timingVariance < this.config.maxTimingVarianceMs
    ) {
      indicators.push(
        `Automated timing detected (variance: ${metrics.timingVariance.toFixed(0)}ms)`
      );
      confidence += 15;
    }

    // Signal 6: Unusual geographic distribution
    if (metrics.geoDistributionScore > 0.7) {
      indicators.push(
        `Suspicious geographic distribution (score: ${(metrics.geoDistributionScore * 100).toFixed(0)}%)`
      );
      confidence += 10;
    }

    // Determine recommended action
    let recommendedAction: RecommendedAction = 'monitor';
    if (confidence >= this.config.ipBlockThreshold) {
      recommendedAction = 'block_ip';
    } else if (confidence >= this.config.captchaThreshold) {
      recommendedAction = 'captcha';
    } else if (confidence >= this.config.attackConfidenceThreshold * 0.5) {
      recommendedAction = 'block_account';
    }

    // Classify attack type if still unknown
    if (attackType === 'unknown' && confidence >= this.config.attackConfidenceThreshold) {
      // Default to credential stuffing if high failure rate with many usernames
      if (metrics.failureRate > 0.8 && metrics.uniqueUsernames > 5) {
        attackType = 'credential_stuffing';
      } else if (metrics.uniqueUsernames <= 3 && metrics.uniqueIPs > 5) {
        attackType = 'password_spraying';
      }
    }

    const isAttack = confidence >= this.config.attackConfidenceThreshold;
    const sourceIPs = Array.from(metrics.usernamesPerIP.keys()).slice(0, 100);

    const result: AttackIndicators = {
      isAttack,
      confidence: Math.min(100, confidence),
      attackType,
      indicators,
      recommendedAction,
      affectedAccounts: metrics.uniqueUsernames,
      sourceIPs,
      analyzedAt: new Date(),
      metrics,
    };

    // Update attack state
    await this.updateAttackState(result);

    logger.info(
      {
        isAttack,
        confidence: result.confidence,
        attackType,
        indicators: indicators.length,
        affectedAccounts: metrics.uniqueUsernames,
        sourceIPs: sourceIPs.length,
      },
      'Attack analysis completed'
    );

    return result;
  }

  /**
   * Quick check if system is currently under attack
   *
   * @returns Whether an attack is currently detected
   */
  async isUnderAttack(): Promise<boolean> {
    const stateKey = `${ATTACK_STATE_PREFIX}current`;
    const stateStr = await this.redis.get(stateKey);

    if (!stateStr) {
      return false;
    }

    try {
      const state = JSON.parse(stateStr) as AttackState;
      return state.isUnderAttack;
    } catch {
      return false;
    }
  }

  /**
   * Gets list of blocked/compromised credential hashes
   *
   * @returns Array of blocked username hashes
   */
  async getBlockedCredentials(): Promise<string[]> {
    const pattern = `${BLOCKED_PREFIX}*`;
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    // Extract usernames from keys
    const prefix = BLOCKED_PREFIX;
    return keys.map(key => key.slice(prefix.length));
  }

  /**
   * Blocks a credential (username hash)
   *
   * @param usernameHash - The hashed username to block
   * @param reason - Reason for blocking
   * @param durationSeconds - How long to block (default: 24 hours)
   */
  async blockCredential(
    usernameHash: string,
    reason: string,
    durationSeconds: number = 86400
  ): Promise<void> {
    const key = `${BLOCKED_PREFIX}${usernameHash}`;
    await this.redis.setex(
      key,
      durationSeconds,
      JSON.stringify({
        blockedAt: new Date().toISOString(),
        reason,
        expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
      })
    );

    logger.info(
      { usernameHash: usernameHash.slice(0, 8) + '...', reason, durationSeconds },
      'Credential blocked'
    );
  }

  /**
   * Checks if a credential is blocked
   *
   * @param usernameHash - The hashed username to check
   * @returns Whether the credential is blocked
   */
  async isCredentialBlocked(usernameHash: string): Promise<boolean> {
    const key = `${BLOCKED_PREFIX}${usernameHash}`;
    return (await this.redis.exists(key)) === 1;
  }

  /**
   * Unblocks a credential
   *
   * @param usernameHash - The hashed username to unblock
   */
  async unblockCredential(usernameHash: string): Promise<void> {
    const key = `${BLOCKED_PREFIX}${usernameHash}`;
    await this.redis.del(key);

    logger.info(
      { usernameHash: usernameHash.slice(0, 8) + '...' },
      'Credential unblocked'
    );
  }

  /**
   * Gets current attack state details
   */
  async getAttackState(): Promise<AttackState | null> {
    const stateKey = `${ATTACK_STATE_PREFIX}current`;
    const stateStr = await this.redis.get(stateKey);

    if (!stateStr) {
      return null;
    }

    try {
      return JSON.parse(stateStr) as AttackState;
    } catch {
      return null;
    }
  }

  /**
   * Gets the current configuration
   */
  getConfig(): CredentialStuffingConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Integration Hooks
  // ===========================================================================

  /**
   * Hook to call from authentication endpoints
   *
   * @param attempt - The authentication attempt
   * @returns Response actions to take
   */
  async onAuthAttempt(attempt: AuthAttempt): Promise<{
    requireCaptcha: boolean;
    blockRequest: boolean;
    isBlocked: boolean;
    attackDetected: boolean;
  }> {
    // Record the attempt
    await this.recordAttempt(attempt);

    // Check if credential is blocked
    const isBlocked = await this.isCredentialBlocked(attempt.username);

    // Check current attack state
    const attackState = await this.getAttackState();
    const attackDetected = attackState?.isUnderAttack ?? false;

    // Determine if CAPTCHA is required
    let requireCaptcha = false;
    let blockRequest = false;

    if (attackDetected && attackState) {
      if (this.config.autoCaptcha && attackState.confidence >= this.config.captchaThreshold) {
        requireCaptcha = true;
      }
      if (this.config.autoBlockIP && attackState.confidence >= this.config.ipBlockThreshold) {
        if (attackState.sourceIPs.includes(attempt.ipAddress)) {
          blockRequest = true;
        }
      }
    }

    return {
      requireCaptcha,
      blockRequest,
      isBlocked,
      attackDetected,
    };
  }

  /**
   * Creates a Fastify preHandler middleware for protected routes
   *
   * @returns Fastify preHandler hook
   */
  getAuthMiddleware(): preHandlerHookHandler {
    return async (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      const body = request.body as {
        username?: string;
        email?: string;
      } | undefined;

      const username = body?.username ?? body?.email;
      if (!username) {
        // No username in request, skip protection
        return;
      }

      // Hash the username for privacy
      const usernameHash = this.hashUsername(username);

      // Check if credential is blocked
      if (await this.isCredentialBlocked(usernameHash)) {
        return reply.status(403).send({
          error: {
            code: 'CREDENTIAL_BLOCKED',
            message: 'This account has been temporarily blocked due to suspicious activity',
          },
        });
      }

      // Get IP address
      const ipAddress =
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        request.ip;

      // Check attack state
      const attackState = await this.getAttackState();

      if (attackState?.isUnderAttack) {
        // If IP is in source IPs and confidence is high, block
        if (
          this.config.autoBlockIP &&
          attackState.confidence >= this.config.ipBlockThreshold &&
          attackState.sourceIPs.includes(ipAddress)
        ) {
          return reply.status(429).send({
            error: {
              code: 'IP_BLOCKED_ATTACK',
              message: 'Access temporarily blocked due to suspicious activity from this IP',
            },
          });
        }

        // Decorate request with attack info
        (request as FastifyRequest & {
          credentialStuffingStatus?: {
            attackDetected: boolean;
            requireCaptcha: boolean;
            confidence: number;
          };
        }).credentialStuffingStatus = {
          attackDetected: true,
          requireCaptcha:
            this.config.autoCaptcha &&
            attackState.confidence >= this.config.captchaThreshold,
          confidence: attackState.confidence,
        };
      }
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Collects metrics from Redis for analysis
   */
  private async collectMetrics(): Promise<AttackMetrics> {
    const now = Date.now();
    const windowStart = now - this.config.windowSeconds * 1000;
    const attemptsKey = `${ATTEMPTS_PREFIX}global`;

    // Get all attempts in window
    const attemptStrings = await this.redis.zrangebyscore(
      attemptsKey,
      windowStart,
      '+inf'
    );

    const attempts: SerializedAttempt[] = [];
    for (const str of attemptStrings) {
      try {
        attempts.push(JSON.parse(str) as SerializedAttempt);
      } catch {
        // Invalid JSON, skip
      }
    }

    // Calculate basic metrics
    const totalAttempts = attempts.length;
    const failedAttempts = attempts.filter(a => !a.success).length;
    const failureRate = totalAttempts > 0 ? failedAttempts / totalAttempts : 0;

    // Track unique values
    const uniqueUsernames = new Set<string>();
    const uniqueIPs = new Set<string>();
    const usernamesPerIP = new Map<string, number>();
    const IPsPerUsername = new Map<string, number>();
    const usernameList: string[] = [];

    for (const attempt of attempts) {
      uniqueUsernames.add(attempt.username);
      uniqueIPs.add(attempt.ipAddress);
      usernameList.push(attempt.username);

      // Track usernames per IP
      const ipCount = usernamesPerIP.get(attempt.ipAddress) ?? 0;
      const ipUsernames = new Set<string>();
      for (const a of attempts) {
        if (a.ipAddress === attempt.ipAddress) {
          ipUsernames.add(a.username);
        }
      }
      usernamesPerIP.set(attempt.ipAddress, ipUsernames.size);

      // Track IPs per username
      const usernameIPs = new Set<string>();
      for (const a of attempts) {
        if (a.username === attempt.username) {
          usernameIPs.add(a.ipAddress);
        }
      }
      IPsPerUsername.set(attempt.username, usernameIPs.size);
    }

    // Calculate timing variance
    const timingVariance = await this.calculateTimingVariance(attempts);

    // Calculate average time between attempts
    let avgTimeBetweenAttempts = 0;
    if (attempts.length > 1) {
      const timestamps = attempts.map(a => new Date(a.timestamp).getTime()).sort((a, b) => a - b);
      let totalDiff = 0;
      for (let i = 1; i < timestamps.length; i++) {
        totalDiff += timestamps[i] - timestamps[i - 1];
      }
      avgTimeBetweenAttempts = totalDiff / (timestamps.length - 1);
    }

    // Calculate sequential username score
    const sequentialUsernameScore = this.calculateSequentialScore(usernameList);

    // Calculate geographic distribution score
    const geoDistributionScore = this.calculateGeoDistribution(attempts);

    return {
      totalAttempts,
      failedAttempts,
      failureRate,
      uniqueUsernames: uniqueUsernames.size,
      uniqueIPs: uniqueIPs.size,
      usernamesPerIP,
      IPsPerUsername,
      timingVariance,
      avgTimeBetweenAttempts,
      sequentialUsernameScore,
      geoDistributionScore,
    };
  }

  /**
   * Calculates timing variance for bot detection
   */
  private async calculateTimingVariance(
    attempts: SerializedAttempt[]
  ): Promise<number> {
    if (attempts.length < 3) {
      return Infinity;
    }

    // Group by IP and calculate variance per IP
    const attemptsByIP = new Map<string, number[]>();

    for (const attempt of attempts) {
      const timestamps = attemptsByIP.get(attempt.ipAddress) ?? [];
      timestamps.push(new Date(attempt.timestamp).getTime());
      attemptsByIP.set(attempt.ipAddress, timestamps);
    }

    let minVariance = Infinity;

    for (const [, timestamps] of attemptsByIP) {
      if (timestamps.length < 3) continue;

      timestamps.sort((a, b) => a - b);

      // Calculate differences between consecutive timestamps
      const diffs: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        diffs.push(timestamps[i] - timestamps[i - 1]);
      }

      // Calculate variance of differences
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const variance =
        diffs.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / diffs.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < minVariance) {
        minVariance = stdDev;
      }
    }

    return minVariance;
  }

  /**
   * Calculates sequential username pattern score
   */
  private calculateSequentialScore(usernames: string[]): number {
    if (usernames.length < 3) {
      return 0;
    }

    // Look for numeric sequences (user1, user2, user3)
    let sequentialCount = 0;
    const numericPattern = /^(.+?)(\d+)$/;

    for (let i = 1; i < usernames.length; i++) {
      const prev = usernames[i - 1].match(numericPattern);
      const curr = usernames[i].match(numericPattern);

      if (prev && curr) {
        const prevBase = prev[1];
        const currBase = curr[1];
        const prevNum = parseInt(prev[2], 10);
        const currNum = parseInt(curr[2], 10);

        if (prevBase === currBase && Math.abs(currNum - prevNum) === 1) {
          sequentialCount++;
        }
      }
    }

    return usernames.length > 1
      ? sequentialCount / (usernames.length - 1)
      : 0;
  }

  /**
   * Calculates geographic distribution anomaly score
   */
  private calculateGeoDistribution(attempts: SerializedAttempt[]): number {
    // Extract countries from attempts
    const countriesPerUsername = new Map<string, Set<string>>();

    for (const attempt of attempts) {
      if (!attempt.geoLocation?.country) continue;

      const countries = countriesPerUsername.get(attempt.username) ?? new Set();
      countries.add(attempt.geoLocation.country);
      countriesPerUsername.set(attempt.username, countries);
    }

    // Score based on single username from many countries
    let anomalyScore = 0;
    let count = 0;

    for (const [, countries] of countriesPerUsername) {
      if (countries.size > 1) {
        // Multiple countries for same username in short window is suspicious
        anomalyScore += countries.size / 5; // Normalize (5 countries = 100%)
        count++;
      }
    }

    return count > 0 ? Math.min(1, anomalyScore / count) : 0;
  }

  /**
   * Updates global metrics
   */
  private async updateMetrics(attempt: AuthAttempt): Promise<void> {
    const metricsKey = `${METRICS_PREFIX}hourly`;
    const hourBucket = Math.floor(Date.now() / 3600000);

    await this.redis.hincrby(metricsKey, `${hourBucket}:total`, 1);
    if (!attempt.success) {
      await this.redis.hincrby(metricsKey, `${hourBucket}:failed`, 1);
    }
    await this.redis.expire(metricsKey, 86400); // Keep for 24 hours
  }

  /**
   * Updates attack state in Redis
   */
  private async updateAttackState(indicators: AttackIndicators): Promise<void> {
    const stateKey = `${ATTACK_STATE_PREFIX}current`;

    const state: AttackState = {
      isUnderAttack: indicators.isAttack,
      attackType: indicators.attackType,
      confidence: indicators.confidence,
      detectedAt: indicators.isAttack
        ? new Date().toISOString()
        : '',
      lastAnalyzedAt: new Date().toISOString(),
      sourceIPs: indicators.sourceIPs,
      affectedAccounts: indicators.affectedAccounts,
    };

    await this.redis.setex(
      stateKey,
      this.config.windowSeconds,
      JSON.stringify(state)
    );
  }

  /**
   * Runs analysis and triggers responses
   */
  private async analyzeAndRespond(): Promise<void> {
    const indicators = await this.analyze();

    if (!indicators.isAttack) {
      return;
    }

    // Send alert
    if (this.config.sendAlerts && this.alertService) {
      try {
        await this.alertService.createAlert({
          severity: indicators.confidence >= 80 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
          type: SecurityEventType.CREDENTIAL_STUFFING,
          title: `Credential Stuffing Attack Detected`,
          message: `A ${indicators.attackType} attack has been detected with ${indicators.confidence}% confidence. ${indicators.affectedAccounts} accounts affected from ${indicators.sourceIPs.length} source IPs.`,
          context: {
            metadata: {
              attackType: indicators.attackType,
              confidence: indicators.confidence,
              affectedAccounts: indicators.affectedAccounts,
              indicators: indicators.indicators,
              recommendedAction: indicators.recommendedAction,
            },
          },
          source: 'credential-stuffing-detector',
          suggestedActions: [
            indicators.recommendedAction === 'block_ip'
              ? 'Block source IPs'
              : undefined,
            indicators.recommendedAction === 'captcha'
              ? 'Enable CAPTCHA for authentication'
              : undefined,
            'Review affected accounts',
            'Check for compromised credentials',
          ].filter(Boolean) as string[],
          tags: ['credential-stuffing', indicators.attackType],
        });
      } catch (error) {
        logger.error({ error }, 'Failed to send alert');
      }
    }

    // Create incident
    if (this.config.createIncidents && this.incidentManager && indicators.confidence >= 80) {
      try {
        const incident = await this.incidentManager.createIncident({
          title: `Credential Stuffing Attack - ${indicators.attackType}`,
          description: `Automated detection of ${indicators.attackType} attack.\n\nIndicators:\n${indicators.indicators.map(i => `- ${i}`).join('\n')}\n\nAffected Accounts: ${indicators.affectedAccounts}\nSource IPs: ${indicators.sourceIPs.slice(0, 10).join(', ')}${indicators.sourceIPs.length > 10 ? '...' : ''}`,
          severity: indicators.confidence >= 90 ? IncidentSeverity.P1 : IncidentSeverity.P2,
          status: IncidentStatus.DETECTED,
          type: IncidentType.ACCOUNT_COMPROMISE,
          detectedAt: new Date(),
          affectedResources: indicators.sourceIPs.slice(0, 50),
          tags: ['credential-stuffing', 'automated-detection', indicators.attackType],
        });

        // Store incident ID in attack state
        const stateKey = `${ATTACK_STATE_PREFIX}current`;
        const stateStr = await this.redis.get(stateKey);
        if (stateStr) {
          const state = JSON.parse(stateStr) as AttackState;
          state.incidentId = incident.id;
          await this.redis.setex(
            stateKey,
            this.config.windowSeconds,
            JSON.stringify(state)
          );
        }

        logger.info({ incidentId: incident.id }, 'Incident created for attack');
      } catch (error) {
        logger.error({ error }, 'Failed to create incident');
      }
    }

    // Auto-block high-confidence source IPs
    if (this.config.autoBlockIP && indicators.confidence >= this.config.ipBlockThreshold) {
      for (const ip of indicators.sourceIPs.slice(0, 10)) {
        logger.warn({ ip, confidence: indicators.confidence }, 'Auto-blocking IP due to attack');
        // Note: Actual IP blocking would integrate with firewall/WAF
      }
    }
  }

  /**
   * Hashes a username for privacy
   */
  private hashUsername(username: string): string {
    return createHash('sha256')
      .update(username.toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Cleans up old data
   */
  async cleanup(): Promise<void> {
    const windowMs = this.config.windowSeconds * 1000;
    const cutoff = Date.now() - windowMs - 3600000; // 1 hour buffer

    // Clean main attempts
    const attemptsKey = `${ATTEMPTS_PREFIX}global`;
    await this.redis.zremrangebyscore(attemptsKey, '-inf', cutoff);

    // Clean per-IP attempts
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${IP_ATTEMPTS_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        await this.redis.zremrangebyscore(key, '-inf', cutoff);
        const count = await this.redis.zcard(key);
        if (count === 0) {
          await this.redis.del(key);
        }
      }
    } while (cursor !== '0');

    // Clean per-username attempts
    cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${USERNAME_ATTEMPTS_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        await this.redis.zremrangebyscore(key, '-inf', cutoff);
        const count = await this.redis.zcard(key);
        if (count === 0) {
          await this.redis.del(key);
        }
      }
    } while (cursor !== '0');

    logger.info('Credential stuffing detector cleanup completed');
  }
}

// =============================================================================
// Fastify Plugin
// =============================================================================

/**
 * Options for the Fastify plugin
 */
export interface CredentialStuffingPluginOptions {
  /** Detector instance */
  detector?: CredentialStuffingDetector;
  /** Detector configuration */
  config?: Partial<CredentialStuffingConfig>;
  /** Paths to apply protection to */
  protectedPaths?: string[];
  /** Function to extract username from request */
  extractUsername?: (request: FastifyRequest) => string | undefined;
}

/**
 * Registers the credential stuffing protection plugin with Fastify
 */
export async function registerCredentialStuffingPlugin(
  fastify: FastifyInstance,
  options: CredentialStuffingPluginOptions = {}
): Promise<void> {
  const detector =
    options.detector ?? new CredentialStuffingDetector(options.config);

  const protectedPaths = new Set(
    options.protectedPaths ?? ['/auth/login', '/auth/token', '/api/login']
  );

  const extractUsername =
    options.extractUsername ??
    ((request: FastifyRequest): string | undefined => {
      const body = request.body as {
        username?: string;
        email?: string;
      } | undefined;
      return body?.username ?? body?.email;
    });

  // Add preHandler for protected paths
  fastify.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions?.url ?? request.url;

    // Check if path is protected
    if (!protectedPaths.has(routeUrl)) {
      return;
    }

    // Get username
    const username = extractUsername(request);
    if (!username) {
      return;
    }

    // Hash username
    const usernameHash = createHash('sha256')
      .update(username.toLowerCase().trim())
      .digest('hex');

    // Check if blocked
    if (await detector.isCredentialBlocked(usernameHash)) {
      return reply.status(403).send({
        error: {
          code: 'CREDENTIAL_BLOCKED',
          message: 'This account has been temporarily blocked',
        },
      });
    }

    // Check attack state
    const attackState = await detector.getAttackState();
    if (attackState?.isUnderAttack) {
      const ipAddress =
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        request.ip;

      // Block if IP is in attack sources
      const config = detector.getConfig();
      if (
        config.autoBlockIP &&
        attackState.confidence >= config.ipBlockThreshold &&
        attackState.sourceIPs.includes(ipAddress)
      ) {
        return reply.status(429).send({
          error: {
            code: 'IP_BLOCKED',
            message: 'Access blocked due to suspicious activity',
          },
        });
      }

      // Add CAPTCHA requirement to request
      (request as FastifyRequest & {
        requireCaptcha?: boolean;
        attackConfidence?: number;
      }).requireCaptcha =
        config.autoCaptcha &&
        attackState.confidence >= config.captchaThreshold;
    }
  });

  // Decorate fastify with detector
  fastify.decorate('credentialStuffingDetector', detector);

  logger.info('Credential stuffing plugin registered');
}

// =============================================================================
// Singleton Instance
// =============================================================================

let detectorInstance: CredentialStuffingDetector | null = null;

/**
 * Gets or creates the singleton CredentialStuffingDetector instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton CredentialStuffingDetector instance
 */
export function getCredentialStuffingDetector(
  config?: Partial<CredentialStuffingConfig>
): CredentialStuffingDetector {
  if (!detectorInstance) {
    detectorInstance = new CredentialStuffingDetector(config);
  }
  return detectorInstance;
}

/**
 * Resets the singleton instance (primarily for testing)
 */
export function resetCredentialStuffingDetector(): void {
  detectorInstance = null;
}

/**
 * Creates a new CredentialStuffingDetector instance
 */
export function createCredentialStuffingDetector(
  config?: Partial<CredentialStuffingConfig>,
  redis?: Redis
): CredentialStuffingDetector {
  return new CredentialStuffingDetector(config, redis);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Hashes a username for use with the detector
 *
 * @param username - The username to hash
 * @returns SHA-256 hash of the normalized username
 */
export function hashUsername(username: string): string {
  return createHash('sha256')
    .update(username.toLowerCase().trim())
    .digest('hex');
}

/**
 * Creates an AuthAttempt from a Fastify request
 *
 * @param request - The Fastify request
 * @param success - Whether the authentication was successful
 * @param username - The username (will be hashed)
 * @returns AuthAttempt object ready for recording
 */
export function createAuthAttemptFromRequest(
  request: FastifyRequest,
  success: boolean,
  username: string
): AuthAttempt {
  const ipAddress =
    (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    request.ip;

  return {
    username: hashUsername(username),
    ipAddress,
    success,
    timestamp: new Date(),
    userAgent: request.headers['user-agent'] ?? 'unknown',
    fingerprint: createHash('sha256')
      .update(
        [
          ipAddress,
          request.headers['user-agent'] ?? '',
          request.headers['accept-language'] ?? '',
        ].join('|')
      )
      .digest('hex')
      .slice(0, 32),
  };
}

// =============================================================================
// Fastify Request Declaration
// =============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    credentialStuffingDetector?: CredentialStuffingDetector;
  }

  interface FastifyRequest {
    credentialStuffingStatus?: {
      attackDetected: boolean;
      requireCaptcha: boolean;
      confidence: number;
    };
    requireCaptcha?: boolean;
    attackConfidence?: number;
  }
}
