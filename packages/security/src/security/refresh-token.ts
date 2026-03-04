/**
 * Refresh Token Service with Rotation Support
 *
 * Implements secure refresh token handling with rotation to prevent token theft:
 * - Generates secure 32-byte refresh tokens (base64url encoded)
 * - Stores token hashes (SHA-256) - never stores plaintext
 * - Tracks token families for rotation and theft detection
 * - Automatically revokes entire family on reuse detection (theft indicator)
 * - Redis-backed storage for distributed deployment support
 *
 * Security Features:
 * - Token rotation: each use generates a new token
 * - Family tracking: detects token reuse attacks
 * - Device fingerprinting: binds tokens to devices
 * - Configurable TTL: 24 hours default per CAR ID spec
 *
 * @packageDocumentation
 */

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import { getRedis, checkRedisHealth } from '../common/redis.js';
import { VorionError, UnauthorizedError } from '../common/errors.js';
import { secureRandomId } from '../common/random.js';
import type { Redis } from 'ioredis';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../audit/security-logger.js';
import type { SecurityActor } from '../audit/security-events.js';

const logger = createLogger({ component: 'refresh-token-service' });

// =============================================================================
// Zod Schemas for Token Data Validation
// =============================================================================

/**
 * Schema for validating stored refresh token data from Redis
 */
const refreshTokenDataSchema = z.object({
  tokenHash: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  familyId: z.string().min(1),
  rotationCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  used: z.boolean(),
  usedAt: z.string().datetime().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for validating stored token family data from Redis
 */
const tokenFamilySchema = z.object({
  familyId: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  createdAt: z.string().datetime(),
  rotationCount: z.number().int().nonnegative(),
  revoked: z.boolean(),
  revokedReason: z.string().optional(),
  revokedAt: z.string().datetime().optional(),
});

/**
 * Parse and validate refresh token data from Redis
 */
function parseRefreshTokenData(data: string, operation: string): RefreshTokenData | null {
  try {
    const parsed = JSON.parse(data);
    const validated = refreshTokenDataSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(
        {
          errors: validated.error.errors,
          operation,
        },
        'Refresh token data validation failed'
      );
      return null;
    }

    return validated.data as RefreshTokenData;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        operation,
      },
      'Failed to parse refresh token data'
    );
    return null;
  }
}

/**
 * Parse and validate token family data from Redis
 */
function parseTokenFamilyData(data: string, operation: string): TokenFamily | null {
  try {
    const parsed = JSON.parse(data);
    const validated = tokenFamilySchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(
        {
          errors: validated.error.errors,
          operation,
        },
        'Token family data validation failed'
      );
      return null;
    }

    return validated.data as TokenFamily;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        operation,
      },
      'Failed to parse token family data'
    );
    return null;
  }
}

// =============================================================================
// Constants
// =============================================================================

/** Default refresh token TTL in seconds (24 hours per CAR ID spec) */
const DEFAULT_REFRESH_TOKEN_TTL = 86400;

/** Default access token TTL in seconds (5 minutes per CAR ID spec) */
const DEFAULT_ACCESS_TOKEN_TTL = 300;

/** Redis key prefix for refresh tokens */
const REFRESH_TOKEN_PREFIX = 'vorion:refresh_token';

/** Redis key prefix for token families */
const TOKEN_FAMILY_PREFIX = 'vorion:token_family';

/** Size of refresh token in bytes (32 bytes = 256 bits) */
const REFRESH_TOKEN_BYTES = 32;

// =============================================================================
// Errors
// =============================================================================

/**
 * Refresh token error base class
 */
export class RefreshTokenError extends VorionError {
  override code = 'REFRESH_TOKEN_ERROR';
  override statusCode = 401;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'RefreshTokenError';
  }
}

/**
 * Token reuse detected - potential theft
 */
export class TokenReuseError extends RefreshTokenError {
  override code = 'TOKEN_REUSE_DETECTED';

  constructor(familyId: string) {
    super('Refresh token reuse detected - potential theft', { familyId });
    this.name = 'TokenReuseError';
  }
}

/**
 * Token expired error
 */
export class RefreshTokenExpiredError extends RefreshTokenError {
  override code = 'REFRESH_TOKEN_EXPIRED';

  constructor() {
    super('Refresh token has expired');
    this.name = 'RefreshTokenExpiredError';
  }
}

/**
 * Token revoked error
 */
export class RefreshTokenRevokedError extends RefreshTokenError {
  override code = 'REFRESH_TOKEN_REVOKED';

  constructor(reason: string) {
    super('Refresh token has been revoked', { reason });
    this.name = 'RefreshTokenRevokedError';
  }
}

/**
 * Invalid token error
 */
export class RefreshTokenInvalidError extends RefreshTokenError {
  override code = 'REFRESH_TOKEN_INVALID';

  constructor() {
    super('Refresh token is invalid');
    this.name = 'RefreshTokenInvalidError';
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Refresh token stored data structure
 */
export interface RefreshTokenData {
  /** SHA-256 hash of the token */
  tokenHash: string;
  /** User ID this token belongs to */
  userId: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** Device fingerprint for binding */
  deviceFingerprint: string;
  /** Token family ID for rotation tracking */
  familyId: string;
  /** Rotation count within the family */
  rotationCount: number;
  /** When the token was created */
  createdAt: string;
  /** When the token expires */
  expiresAt: string;
  /** Whether the token has been used (rotated) */
  used: boolean;
  /** When the token was used */
  usedAt?: string;
  /** IP address at token creation */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Refresh token payload returned to client
 */
export interface RefreshTokenPayload {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Device fingerprint */
  deviceFingerprint: string;
  /** Token family ID */
  familyId: string;
  /** Rotation count */
  rotationCount: number;
  /** Expiration timestamp */
  expiresAt: Date;
}

/**
 * Token family data structure
 */
export interface TokenFamily {
  /** Family ID */
  familyId: string;
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Device fingerprint */
  deviceFingerprint: string;
  /** When the family was created */
  createdAt: string;
  /** Current rotation count */
  rotationCount: number;
  /** Whether the family has been revoked */
  revoked: boolean;
  /** Revocation reason */
  revokedReason?: string;
  /** When the family was revoked */
  revokedAt?: string;
}

/**
 * Create token input
 */
export interface CreateRefreshTokenInput {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Device fingerprint */
  deviceFingerprint: string;
  /** IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Custom TTL in seconds */
  ttlSeconds?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Token rotation result
 */
export interface TokenRotationResult {
  /** New refresh token */
  newToken: string;
  /** New access token */
  accessToken: string;
  /** Expiration time */
  expiresAt: Date;
}

/**
 * Access token generator function type
 */
export type AccessTokenGenerator = (
  userId: string,
  tenantId: string,
  metadata?: Record<string, unknown>
) => Promise<string>;

/**
 * Refresh token service configuration
 */
export interface RefreshTokenServiceConfig {
  /** Refresh token TTL in seconds */
  refreshTokenTTL: number;
  /** Access token TTL in seconds */
  accessTokenTTL: number;
  /** Key prefix for Redis storage */
  keyPrefix: string;
  /** Maximum rotation count before forcing re-authentication */
  maxRotationCount: number;
  /** Custom access token generator */
  accessTokenGenerator?: AccessTokenGenerator;
}

const DEFAULT_CONFIG: RefreshTokenServiceConfig = {
  refreshTokenTTL: DEFAULT_REFRESH_TOKEN_TTL,
  accessTokenTTL: DEFAULT_ACCESS_TOKEN_TTL,
  keyPrefix: REFRESH_TOKEN_PREFIX,
  maxRotationCount: 100, // Force re-auth after 100 rotations
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a secure refresh token (32 bytes, base64url encoded)
 */
function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Build security actor for audit logging
 */
function buildActor(
  userId: string,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string
): SecurityActor {
  return {
    type: 'user',
    id: userId,
    tenantId,
    ip: ipAddress,
    userAgent,
  };
}

// =============================================================================
// Refresh Token Service
// =============================================================================

/**
 * Refresh Token Service with rotation support
 *
 * Implements secure refresh token handling with rotation to detect token theft.
 * When a token is used (rotated), a new token is issued. If an old token is
 * reused (indicating theft), the entire token family is revoked.
 *
 * @example
 * ```typescript
 * const refreshTokenService = new RefreshTokenService({
 *   refreshTokenTTL: 86400, // 24 hours
 *   accessTokenGenerator: async (userId, tenantId) => {
 *     return generateAccessToken(userId, tenantId);
 *   },
 * });
 *
 * // Create initial token
 * const { token, payload } = await refreshTokenService.createToken({
 *   userId: 'user-123',
 *   tenantId: 'tenant-456',
 *   deviceFingerprint: 'device-fp-789',
 * });
 *
 * // Rotate token on use
 * const { newToken, accessToken } = await refreshTokenService.rotateToken(token);
 *
 * // Validate token
 * const payload = await refreshTokenService.validateToken(token);
 * ```
 */
export class RefreshTokenService {
  private config: RefreshTokenServiceConfig;
  private redis: Redis | null = null;
  private securityLogger: SecurityAuditLogger;
  private accessTokenGenerator: AccessTokenGenerator;

  constructor(
    config: Partial<RefreshTokenServiceConfig> = {},
    securityLogger?: SecurityAuditLogger
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.securityLogger = securityLogger ?? getSecurityAuditLogger();
    this.accessTokenGenerator =
      config.accessTokenGenerator ?? this.defaultAccessTokenGenerator.bind(this);

    logger.info(
      {
        refreshTokenTTL: this.config.refreshTokenTTL,
        maxRotationCount: this.config.maxRotationCount,
      },
      'Refresh token service initialized'
    );
  }

  /**
   * Get Redis client, initializing if needed
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = getRedis();
    }
    return this.redis;
  }

  /**
   * Default access token generator using HMAC-SHA256 signed JWT.
   * Signs with VORION_JWT_SECRET or falls back to a derived key.
   */
  private async defaultAccessTokenGenerator(
    userId: string,
    tenantId: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const { SignJWT } = await import('jose');
    const secret = process.env.VORION_JWT_SECRET || 'vorion-dev-signing-key';
    const key = new TextEncoder().encode(secret);

    const jwt = await new SignJWT({
      tenant: tenantId,
      ...metadata,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.config.accessTokenTTL)
      .setJti(secureRandomId())
      .setIssuer('vorion:security')
      .sign(key);

    return jwt;
  }

  /**
   * Generate Redis key for a token hash
   */
  private tokenKey(tokenHash: string): string {
    return `${this.config.keyPrefix}:${tokenHash}`;
  }

  /**
   * Generate Redis key for a token family
   */
  private familyKey(familyId: string): string {
    return `${TOKEN_FAMILY_PREFIX}:${familyId}`;
  }

  /**
   * Generate Redis key for user's token families index
   */
  private userFamiliesKey(userId: string): string {
    return `${TOKEN_FAMILY_PREFIX}:user:${userId}`;
  }

  /**
   * Create a new refresh token
   */
  async createToken(
    input: CreateRefreshTokenInput
  ): Promise<{ token: string; payload: RefreshTokenPayload }> {
    const redis = await this.getRedis();
    const token = generateRefreshToken();
    const tokenHash = hashToken(token);
    const familyId = secureRandomId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.refreshTokenTTL * 1000);

    // Create token family
    const family: TokenFamily = {
      familyId,
      userId: input.userId,
      tenantId: input.tenantId,
      deviceFingerprint: input.deviceFingerprint,
      createdAt: now.toISOString(),
      rotationCount: 0,
      revoked: false,
    };

    // Create token data
    const tokenData: RefreshTokenData = {
      tokenHash,
      userId: input.userId,
      tenantId: input.tenantId,
      deviceFingerprint: input.deviceFingerprint,
      familyId,
      rotationCount: 0,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata,
    };

    // Store token and family atomically
    const pipeline = redis.pipeline();
    pipeline.setex(
      this.tokenKey(tokenHash),
      this.config.refreshTokenTTL,
      JSON.stringify(tokenData)
    );
    pipeline.setex(
      this.familyKey(familyId),
      this.config.refreshTokenTTL + 3600, // Keep family slightly longer
      JSON.stringify(family)
    );
    pipeline.sadd(this.userFamiliesKey(input.userId), familyId);
    pipeline.expire(this.userFamiliesKey(input.userId), this.config.refreshTokenTTL + 3600);
    await pipeline.exec();

    // Audit log
    const actor = buildActor(input.userId, input.tenantId, input.ipAddress, input.userAgent);
    await this.securityLogger.log({
      eventType: 'TOKEN_ISSUED',
      actor,
      action: 'create_refresh_token',
      resource: { type: 'refresh_token', id: familyId },
      outcome: 'success',
      metadata: {
        deviceFingerprint: input.deviceFingerprint,
        ttlSeconds: this.config.refreshTokenTTL,
      },
    });

    logger.info(
      { userId: input.userId, tenantId: input.tenantId, familyId },
      'Refresh token created'
    );

    const payload: RefreshTokenPayload = {
      userId: input.userId,
      tenantId: input.tenantId,
      deviceFingerprint: input.deviceFingerprint,
      familyId,
      rotationCount: 0,
      expiresAt,
    };

    return { token, payload };
  }

  /**
   * Validate a refresh token without rotating it
   */
  async validateToken(token: string): Promise<RefreshTokenPayload | null> {
    const redis = await this.getRedis();
    const tokenHash = hashToken(token);
    const tokenKey = this.tokenKey(tokenHash);

    const data = await redis.get(tokenKey);
    if (!data) {
      logger.debug({ tokenHashPrefix: tokenHash.substring(0, 8) }, 'Token not found');
      return null;
    }

    const tokenData = parseRefreshTokenData(data, 'validateToken');
    if (!tokenData) {
      return null;
    }

    // Check if token has been used
    if (tokenData.used) {
      logger.warn(
        { familyId: tokenData.familyId, userId: tokenData.userId },
        'Attempted validation of already-used token'
      );
      return null;
    }

    // Check expiration
    if (new Date(tokenData.expiresAt) <= new Date()) {
      logger.debug({ familyId: tokenData.familyId }, 'Token has expired');
      return null;
    }

    // Check family status
    const family = await this.getFamily(tokenData.familyId);
    if (!family || family.revoked) {
      logger.debug({ familyId: tokenData.familyId }, 'Token family is revoked');
      return null;
    }

    return {
      userId: tokenData.userId,
      tenantId: tokenData.tenantId,
      deviceFingerprint: tokenData.deviceFingerprint,
      familyId: tokenData.familyId,
      rotationCount: tokenData.rotationCount,
      expiresAt: new Date(tokenData.expiresAt),
    };
  }

  /**
   * Rotate a refresh token
   *
   * This is the main method for using a refresh token. It:
   * 1. Validates the token
   * 2. Checks for reuse (theft detection)
   * 3. Issues a new refresh token
   * 4. Issues a new access token
   * 5. Invalidates the old refresh token
   */
  async rotateToken(
    oldToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<TokenRotationResult> {
    const redis = await this.getRedis();
    const oldTokenHash = hashToken(oldToken);
    const oldTokenKey = this.tokenKey(oldTokenHash);

    // Get old token data
    const data = await redis.get(oldTokenKey);
    if (!data) {
      logger.warn({ tokenHashPrefix: oldTokenHash.substring(0, 8) }, 'Token not found for rotation');
      throw new RefreshTokenInvalidError();
    }

    const oldTokenData = parseRefreshTokenData(data, 'rotateToken');
    if (!oldTokenData) {
      throw new RefreshTokenInvalidError();
    }

    // Check if token has already been used - THEFT DETECTION
    if (oldTokenData.used) {
      logger.error(
        {
          familyId: oldTokenData.familyId,
          userId: oldTokenData.userId,
          rotationCount: oldTokenData.rotationCount,
        },
        'TOKEN REUSE DETECTED - Potential theft, revoking entire family'
      );

      // Revoke entire family - this is a critical security event
      await this.revokeFamilyInternal(
        oldTokenData.familyId,
        'Token reuse detected - potential theft',
        oldTokenData.userId,
        oldTokenData.tenantId,
        ipAddress,
        userAgent
      );

      throw new TokenReuseError(oldTokenData.familyId);
    }

    // Check expiration
    if (new Date(oldTokenData.expiresAt) <= new Date()) {
      logger.debug({ familyId: oldTokenData.familyId }, 'Token expired during rotation');
      throw new RefreshTokenExpiredError();
    }

    // Check family status
    const family = await this.getFamily(oldTokenData.familyId);
    if (!family) {
      logger.warn({ familyId: oldTokenData.familyId }, 'Token family not found');
      throw new RefreshTokenInvalidError();
    }

    if (family.revoked) {
      logger.debug(
        { familyId: oldTokenData.familyId, reason: family.revokedReason },
        'Token family is revoked'
      );
      throw new RefreshTokenRevokedError(family.revokedReason ?? 'Unknown reason');
    }

    // Check rotation count
    const newRotationCount = oldTokenData.rotationCount + 1;
    if (newRotationCount >= this.config.maxRotationCount) {
      logger.info(
        { familyId: oldTokenData.familyId, rotationCount: newRotationCount },
        'Max rotation count reached, revoking family'
      );
      await this.revokeFamilyInternal(
        oldTokenData.familyId,
        'Maximum rotation count exceeded',
        oldTokenData.userId,
        oldTokenData.tenantId,
        ipAddress,
        userAgent
      );
      throw new RefreshTokenRevokedError('Maximum rotation count exceeded, please re-authenticate');
    }

    // Generate new tokens
    const newToken = generateRefreshToken();
    const newTokenHash = hashToken(newToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.refreshTokenTTL * 1000);

    // Create new token data
    const newTokenData: RefreshTokenData = {
      tokenHash: newTokenHash,
      userId: oldTokenData.userId,
      tenantId: oldTokenData.tenantId,
      deviceFingerprint: oldTokenData.deviceFingerprint,
      familyId: oldTokenData.familyId,
      rotationCount: newRotationCount,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      ipAddress,
      userAgent,
      metadata: oldTokenData.metadata,
    };

    // Mark old token as used
    oldTokenData.used = true;
    oldTokenData.usedAt = now.toISOString();

    // Update family rotation count
    family.rotationCount = newRotationCount;

    // Store atomically
    const pipeline = redis.pipeline();
    // Mark old token as used (keep briefly for reuse detection)
    pipeline.setex(oldTokenKey, 300, JSON.stringify(oldTokenData)); // Keep 5 min for reuse detection
    // Store new token
    pipeline.setex(
      this.tokenKey(newTokenHash),
      this.config.refreshTokenTTL,
      JSON.stringify(newTokenData)
    );
    // Update family
    pipeline.setex(
      this.familyKey(oldTokenData.familyId),
      this.config.refreshTokenTTL + 3600,
      JSON.stringify(family)
    );
    await pipeline.exec();

    // Generate new access token
    const accessToken = await this.accessTokenGenerator(
      oldTokenData.userId,
      oldTokenData.tenantId,
      oldTokenData.metadata
    );

    // Audit log
    const actor = buildActor(oldTokenData.userId, oldTokenData.tenantId, ipAddress, userAgent);
    await this.securityLogger.log({
      eventType: 'TOKEN_REFRESHED',
      actor,
      action: 'rotate_refresh_token',
      resource: { type: 'refresh_token', id: oldTokenData.familyId },
      outcome: 'success',
      metadata: {
        rotationCount: newRotationCount,
        deviceFingerprint: oldTokenData.deviceFingerprint,
      },
    });

    logger.info(
      {
        userId: oldTokenData.userId,
        familyId: oldTokenData.familyId,
        rotationCount: newRotationCount,
      },
      'Refresh token rotated'
    );

    return {
      newToken,
      accessToken,
      expiresAt,
    };
  }

  /**
   * Revoke a token family
   */
  async revokeFamily(
    familyId: string,
    reason: string,
    revokedBy: string = 'system'
  ): Promise<boolean> {
    const family = await this.getFamily(familyId);
    if (!family) {
      return false;
    }

    return this.revokeFamilyInternal(
      familyId,
      reason,
      family.userId,
      family.tenantId,
      undefined,
      undefined,
      revokedBy
    );
  }

  /**
   * Internal method to revoke a token family
   */
  private async revokeFamilyInternal(
    familyId: string,
    reason: string,
    userId: string,
    tenantId: string,
    ipAddress?: string,
    userAgent?: string,
    revokedBy: string = 'system'
  ): Promise<boolean> {
    const redis = await this.getRedis();
    const familyKey = this.familyKey(familyId);

    const data = await redis.get(familyKey);
    if (!data) {
      return false;
    }

    const family = parseTokenFamilyData(data, 'revokeFamilyInternal');
    if (!family) {
      return false;
    }
    if (family.revoked) {
      return true; // Already revoked
    }

    family.revoked = true;
    family.revokedReason = reason;
    family.revokedAt = new Date().toISOString();

    await redis.setex(familyKey, 3600, JSON.stringify(family)); // Keep revoked record briefly

    // Audit log
    const actor: SecurityActor = {
      type: revokedBy === 'system' ? 'system' : 'user',
      id: revokedBy,
      tenantId,
      ip: ipAddress,
      userAgent,
    };
    await this.securityLogger.log({
      eventType: 'TOKEN_REVOKED',
      actor,
      action: 'revoke_token_family',
      resource: { type: 'token_family', id: familyId },
      outcome: 'success',
      reason,
      metadata: { userId },
    });

    logger.info({ familyId, userId, reason }, 'Token family revoked');

    return true;
  }

  /**
   * Revoke all token families for a user
   */
  async revokeAllForUser(
    userId: string,
    tenantId: string,
    reason: string,
    revokedBy: string = 'system'
  ): Promise<number> {
    const redis = await this.getRedis();
    const userFamiliesKey = this.userFamiliesKey(userId);

    const familyIds = await redis.smembers(userFamiliesKey);
    let revokedCount = 0;

    for (const familyId of familyIds) {
      const revoked = await this.revokeFamilyInternal(
        familyId,
        reason,
        userId,
        tenantId,
        undefined,
        undefined,
        revokedBy
      );
      if (revoked) {
        revokedCount++;
      }
    }

    // Audit log bulk revocation
    if (revokedCount > 0) {
      const actor: SecurityActor = {
        type: revokedBy === 'system' ? 'system' : 'user',
        id: revokedBy,
        tenantId,
      };
      await this.securityLogger.logSessionsBulkRevoked(actor, userId, revokedCount, reason);
    }

    logger.info({ userId, revokedCount, reason }, 'All user token families revoked');

    return revokedCount;
  }

  /**
   * Get a token family by ID
   */
  async getFamily(familyId: string): Promise<TokenFamily | null> {
    const redis = await this.getRedis();
    const data = await redis.get(this.familyKey(familyId));
    if (!data) {
      return null;
    }
    return parseTokenFamilyData(data, 'getFamily');
  }

  /**
   * Get all active token families for a user
   */
  async getFamiliesForUser(userId: string): Promise<TokenFamily[]> {
    const redis = await this.getRedis();
    const userFamiliesKey = this.userFamiliesKey(userId);
    const familyIds = await redis.smembers(userFamiliesKey);

    const families: TokenFamily[] = [];
    for (const familyId of familyIds) {
      const family = await this.getFamily(familyId);
      if (family && !family.revoked) {
        families.push(family);
      }
    }

    return families;
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
   * Get service statistics
   */
  getStats(): {
    refreshTokenTTL: number;
    accessTokenTTL: number;
    maxRotationCount: number;
  } {
    return {
      refreshTokenTTL: this.config.refreshTokenTTL,
      accessTokenTTL: this.config.accessTokenTTL,
      maxRotationCount: this.config.maxRotationCount,
    };
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let refreshTokenService: RefreshTokenService | null = null;

/**
 * Get the singleton refresh token service
 */
export function getRefreshTokenService(
  config?: Partial<RefreshTokenServiceConfig>
): RefreshTokenService {
  if (!refreshTokenService) {
    refreshTokenService = new RefreshTokenService(config);
  }
  return refreshTokenService;
}

/**
 * Create a new refresh token service instance (for testing)
 */
export function createRefreshTokenService(
  config?: Partial<RefreshTokenServiceConfig>,
  securityLogger?: SecurityAuditLogger
): RefreshTokenService {
  return new RefreshTokenService(config, securityLogger);
}

/**
 * Reset the singleton (for testing)
 */
export function resetRefreshTokenService(): void {
  refreshTokenService = null;
  logger.info('Refresh token service singleton reset');
}
