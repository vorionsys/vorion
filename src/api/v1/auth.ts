/**
 * API v1 Authentication Routes
 *
 * Provides authentication endpoints including:
 * - Logout (single session)
 * - Logout all (all sessions)
 * - Revoke all tokens (with password confirmation)
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '../../common/logger.js';
import { getDatabase } from '../../common/db.js';
import { createTokenRevocationService, recordTokenRevocationAudit } from '../../common/token-revocation.js';
import { createEndpointRateLimit } from '../middleware/rate-limits.js';
import { getTokenLifecycleService } from '../../security/token-lifecycle.js';
import { getRevocationCheckService } from '../../security/revocation-check.js';
import { getSessionStore } from '../../security/session-store.js';
import { verifyPassword, needsRehash, hashPassword } from '../../security/password-hashing.js';
import { getSecurityAuditLogger } from '../../audit/security-logger.js';
import type { SecurityActor } from '../../audit/security-events.js';
import { userCredentials, loginAuditLog } from '../../../packages/security/src/db/schema/users.js';

const authLogger = createLogger({ component: 'api-v1-auth' });
const tokenRevocationService = createTokenRevocationService();

// Rate limit configurations for auth endpoints
const authRateLimits = {
  logout: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
  revokeAll: createEndpointRateLimit({ max: 3, windowSeconds: 3600 }),
  refresh: createEndpointRateLimit({ max: 10, windowSeconds: 60 }),
};

// =============================================================================
// Request/Response Schemas
// =============================================================================

/**
 * Logout request body schema
 */
const logoutBodySchema = z.object({
  /** Whether to logout from all sessions */
  logoutAll: z.boolean().optional().default(false),
  /** Specific session ID to exclude from logout all (keep current session) */
  excludeCurrentSession: z.boolean().optional().default(false),
}).optional();

/**
 * Revoke all tokens request body schema
 */
const revokeAllBodySchema = z.object({
  /** Current password for confirmation */
  currentPassword: z.string().min(1, 'Current password is required'),
  /** Whether to also revoke API keys */
  includeApiKeys: z.boolean().optional().default(false),
});

/**
 * Logout response type
 */
interface LogoutResponse {
  message: string;
  loggedOutSessions?: number;
  revokedTokenFamilies?: number;
}

/**
 * Revoke all response type
 */
interface RevokeAllResponse {
  message: string;
  result: {
    totalRevoked: number;
    jwtTokensRevoked: number;
    refreshTokenFamiliesRevoked: number;
    sessionsRevoked: number;
    apiKeysRevoked: number;
  };
}

// =============================================================================
// JWT Payload Types
// =============================================================================

interface JWTPayload {
  jti?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  tenantId?: string;
  sessionId?: string;
  deviceId?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build security actor from request
 */
function buildActor(
  userId: string,
  tenantId: string | undefined,
  request: FastifyRequest
): SecurityActor {
  return {
    type: 'user',
    id: userId,
    tenantId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    sessionId: request.headers['x-session-id'] as string | undefined,
  };
}

/** Maximum failed login attempts before DB-level lockout */
const MAX_FAILED_ATTEMPTS = 10;

/** Lockout duration in minutes after exceeding max failed attempts */
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * Result of password verification with additional context for MFA flow
 */
interface PasswordVerificationResult {
  /** Whether the password was correct */
  valid: boolean;
  /** Whether the account requires MFA challenge before granting access */
  mfaRequired: boolean;
  /** Reason for rejection (generic to prevent information leakage) */
  failureCode?: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'ACCOUNT_DISABLED';
}

/**
 * Verify a user's password against the stored hash in the database.
 *
 * Security properties:
 * - Uses Argon2id via password-hashing.ts for timing-safe comparison
 * - Checks account status (locked, suspended, disabled) before verification
 * - Tracks failed login attempts at the DB level for persistent lockout
 * - Automatically rehashes passwords if hash parameters are outdated
 * - Records login audit events for compliance and forensics
 * - Fails closed on any unexpected error (returns false, never throws)
 *
 * @param userId  - User ID from JWT sub claim
 * @param tenantId - Tenant ID for scoped credential lookup
 * @param password - Plaintext password to verify
 * @param request  - Optional Fastify request for audit context (IP, user agent)
 * @returns Verification result with MFA flag for downstream flow
 */
async function verifyUserPassword(
  userId: string,
  tenantId: string,
  password: string,
  request?: FastifyRequest
): Promise<PasswordVerificationResult> {
  // Reject empty passwords immediately (no DB round-trip)
  if (!password || password.length < 1) {
    return { valid: false, mfaRequired: false, failureCode: 'INVALID_CREDENTIALS' };
  }

  const db = getDatabase();

  try {
    // -------------------------------------------------------------------------
    // 1. Look up user credentials by userId and tenantId
    // -------------------------------------------------------------------------
    const [credential] = await db
      .select({
        userId: userCredentials.userId,
        passwordHash: userCredentials.passwordHash,
        status: userCredentials.status,
        mfaEnabled: userCredentials.mfaEnabled,
        failedLoginAttempts: userCredentials.failedLoginAttempts,
        lockedUntil: userCredentials.lockedUntil,
        email: userCredentials.email,
      })
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, userId),
          eq(userCredentials.tenantId, tenantId)
        )
      )
      .limit(1);

    // No credential record found -- fail closed with generic error
    if (!credential) {
      authLogger.warn(
        { userId, tenantId },
        'Password verification failed: no credential record found for user'
      );

      // Record audit event for unknown user attempt
      await recordLoginAudit(db, {
        userId,
        tenantId,
        loginIdentifier: userId,
        event: 'login_failed',
        failureReason: 'user_not_found',
        ipAddress: request?.ip,
        userAgent: request?.headers['user-agent'],
      });

      return { valid: false, mfaRequired: false, failureCode: 'INVALID_CREDENTIALS' };
    }

    // -------------------------------------------------------------------------
    // 2. Check account status
    // -------------------------------------------------------------------------
    if (credential.status === 'disabled' || credential.status === 'suspended') {
      authLogger.warn(
        { userId, tenantId, status: credential.status },
        'Password verification rejected: account is not active'
      );

      await recordLoginAudit(db, {
        userId,
        tenantId,
        loginIdentifier: credential.email,
        event: 'login_failed',
        failureReason: `account_${credential.status}`,
        ipAddress: request?.ip,
        userAgent: request?.headers['user-agent'],
      });

      return { valid: false, mfaRequired: false, failureCode: 'ACCOUNT_DISABLED' };
    }

    // -------------------------------------------------------------------------
    // 3. Check DB-level lockout
    // -------------------------------------------------------------------------
    if (credential.lockedUntil && credential.lockedUntil > new Date()) {
      authLogger.warn(
        { userId, tenantId, lockedUntil: credential.lockedUntil.toISOString() },
        'Password verification rejected: account is locked'
      );

      await recordLoginAudit(db, {
        userId,
        tenantId,
        loginIdentifier: credential.email,
        event: 'login_failed',
        failureReason: 'account_locked',
        ipAddress: request?.ip,
        userAgent: request?.headers['user-agent'],
      });

      return { valid: false, mfaRequired: false, failureCode: 'ACCOUNT_LOCKED' };
    }

    // -------------------------------------------------------------------------
    // 4. Verify password using Argon2id (timing-safe)
    // -------------------------------------------------------------------------
    const isValid = await verifyPassword(password, credential.passwordHash);

    if (!isValid) {
      // Increment failed attempt counter and potentially lock the account
      const newFailedAttempts = credential.failedLoginAttempts + 1;
      const shouldLock = newFailedAttempts >= MAX_FAILED_ATTEMPTS;

      const updateData: Record<string, unknown> = {
        failedLoginAttempts: newFailedAttempts,
        lastFailedLoginAt: new Date(),
        updatedAt: new Date(),
      };

      if (shouldLock) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
        updateData.lockedUntil = lockUntil;
        updateData.status = 'locked';

        authLogger.warn(
          { userId, tenantId, failedAttempts: newFailedAttempts, lockedUntil: lockUntil.toISOString() },
          'Account locked due to excessive failed login attempts'
        );

        await recordLoginAudit(db, {
          userId,
          tenantId,
          loginIdentifier: credential.email,
          event: 'account_locked',
          failureReason: `locked_after_${newFailedAttempts}_failed_attempts`,
          ipAddress: request?.ip,
          userAgent: request?.headers['user-agent'],
        });
      }

      await db
        .update(userCredentials)
        .set(updateData)
        .where(eq(userCredentials.userId, userId));

      await recordLoginAudit(db, {
        userId,
        tenantId,
        loginIdentifier: credential.email,
        event: 'login_failed',
        failureReason: 'invalid_password',
        ipAddress: request?.ip,
        userAgent: request?.headers['user-agent'],
      });

      authLogger.debug(
        { userId, tenantId, failedAttempts: newFailedAttempts },
        'Password verification failed'
      );

      return { valid: false, mfaRequired: false, failureCode: 'INVALID_CREDENTIALS' };
    }

    // -------------------------------------------------------------------------
    // 5. Password correct -- reset failed attempts and update last login
    // -------------------------------------------------------------------------
    const updateData: Record<string, unknown> = {
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    };

    // If the account was locked but the lock expired, re-activate it
    if (credential.status === 'locked') {
      updateData.status = 'active';
    }

    // -------------------------------------------------------------------------
    // 6. Rehash password if hash parameters are outdated (transparent upgrade)
    // -------------------------------------------------------------------------
    if (needsRehash(credential.passwordHash)) {
      try {
        const newHash = await hashPassword(password);
        updateData.passwordHash = newHash;
        updateData.passwordChangedAt = new Date();
        authLogger.info(
          { userId, tenantId },
          'Password hash upgraded to current Argon2id parameters'
        );
      } catch (rehashError) {
        // Non-fatal: log and continue with the old hash
        authLogger.error(
          { userId, tenantId, error: rehashError },
          'Failed to rehash password during transparent upgrade'
        );
      }
    }

    await db
      .update(userCredentials)
      .set(updateData)
      .where(eq(userCredentials.userId, userId));

    await recordLoginAudit(db, {
      userId,
      tenantId,
      loginIdentifier: credential.email,
      event: 'login_success',
      ipAddress: request?.ip,
      userAgent: request?.headers['user-agent'],
    });

    authLogger.debug({ userId, tenantId }, 'Password verification succeeded');

    return {
      valid: true,
      mfaRequired: credential.mfaEnabled,
    };
  } catch (error) {
    // FAIL CLOSED: Any unexpected error results in rejection
    authLogger.error(
      { userId, tenantId, error },
      'Password verification failed due to unexpected error -- failing closed'
    );
    return { valid: false, mfaRequired: false, failureCode: 'INVALID_CREDENTIALS' };
  }
}

/**
 * Record a login audit event in the database.
 *
 * This is a fire-and-forget helper: errors are logged but never propagated
 * to avoid disrupting the authentication flow.
 */
async function recordLoginAudit(
  db: ReturnType<typeof getDatabase>,
  params: {
    userId?: string;
    tenantId?: string;
    loginIdentifier: string;
    event: 'login_success' | 'login_failed' | 'account_locked' | 'account_unlocked' |
           'password_changed' | 'password_reset_requested' | 'password_reset_completed' |
           'mfa_challenge_issued' | 'mfa_challenge_passed' | 'mfa_challenge_failed';
    failureReason?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  try {
    await db.insert(loginAuditLog).values({
      userId: params.userId,
      tenantId: params.tenantId,
      loginIdentifier: params.loginIdentifier,
      event: params.event,
      failureReason: params.failureReason,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  } catch (auditError) {
    // Never let audit failures break authentication
    authLogger.error(
      { error: auditError, event: params.event, userId: params.userId },
      'Failed to record login audit event'
    );
  }
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * Register v1 authentication routes
 */
export async function registerAuthRoutesV1(fastify: FastifyInstance): Promise<void> {
  const securityLogger = getSecurityAuditLogger();
  const tokenLifecycleService = getTokenLifecycleService();
  const revocationCheckService = getRevocationCheckService();
  const sessionStore = getSessionStore();

  // ===========================================================================
  // POST /auth/logout - Logout from current or all sessions
  // ===========================================================================
  fastify.post<{
    Body: z.infer<typeof logoutBodySchema>;
  }>('/auth/logout', {
    preHandler: authRateLimits.logout,
    schema: {
      body: {
        type: 'object',
        properties: {
          logoutAll: { type: 'boolean', default: false },
          excludeCurrentSession: { type: 'boolean', default: false },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            loggedOutSessions: { type: 'number' },
            revokedTokenFamilies: { type: 'number' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof logoutBodySchema> }>, reply: FastifyReply) => {
    const response: LogoutResponse = {
      message: 'Logged out successfully',
    };

    try {
      // Verify JWT and get payload
      const payload = await request.jwtVerify<JWTPayload>();

      const { jti, sub: userId, exp, tenantId, sessionId } = payload;

      if (!userId) {
        authLogger.warn('Logout attempted with token missing sub claim');
        return reply.send(response);
      }

      // Parse body
      const body = logoutBodySchema.safeParse(request.body);
      const logoutAll = body.success ? body.data?.logoutAll ?? false : false;
      const excludeCurrentSession = body.success ? body.data?.excludeCurrentSession ?? false : false;

      // Build actor for audit logging
      const actor = buildActor(userId, tenantId, request);

      if (logoutAll) {
        // ==== Logout All Sessions ====
        authLogger.info({ userId, tenantId }, 'User initiated logout from all sessions');

        const result = await tokenLifecycleService.revokeAllUserTokens(
          userId,
          tenantId ?? 'default',
          {
            reason: 'logout_all',
            revokedBy: userId,
            tokenTypes: ['jwt', 'refresh', 'session'],
            excludeSessionId: excludeCurrentSession ? sessionId : undefined,
          }
        );

        response.loggedOutSessions = result.sessionsRevoked;
        response.revokedTokenFamilies = result.refreshTokenFamiliesRevoked;
        response.message = `Logged out from ${result.sessionsRevoked} session(s)`;

        // Audit log
        await securityLogger.logSessionsBulkRevoked(
          actor,
          userId,
          result.totalRevoked,
          'User initiated logout all'
        );

        authLogger.info(
          {
            userId,
            tenantId,
            sessionsRevoked: result.sessionsRevoked,
            refreshFamiliesRevoked: result.refreshTokenFamiliesRevoked,
          },
          'User logged out from all sessions'
        );
      } else {
        // ==== Single Session Logout ====

        // Revoke the current JWT token
        if (jti) {
          const expiresAt = exp ? new Date(exp * 1000) : new Date(Date.now() + 60 * 60 * 1000);
          await tokenRevocationService.revokeToken(jti, expiresAt);

          // Add to bloom filter for fast revocation checking
          revocationCheckService.addRevokedToken(jti);

          // Publish revocation to other instances
          await revocationCheckService.publishRevocation(jti);
        }

        // Revoke the session if sessionId is present
        if (sessionId) {
          await sessionStore.revoke(sessionId, 'User logout', userId);
          response.loggedOutSessions = 1;
        }

        // Audit log single logout
        if (tenantId) {
          await recordTokenRevocationAudit(
            tenantId,
            userId,
            'token.revoked',
            {
              type: 'user',
              id: userId,
              ip: request.ip,
            },
            { jti, sessionId, reason: 'logout' }
          );
        }

        // Log session revocation
        if (sessionId) {
          await securityLogger.logSessionRevoked(
            actor,
            sessionId,
            'User logout',
            { jti }
          );
        }

        authLogger.info({ jti, userId, sessionId }, 'User logged out');
      }

      return reply.send(response);
    } catch (error) {
      // Even if token verification fails, we still return success
      // This prevents information leakage about token validity
      authLogger.warn({ error }, 'Logout with invalid or expired token');
      return reply.send(response);
    }
  });

  // ===========================================================================
  // POST /auth/revoke-all - Revoke all tokens (requires password)
  // ===========================================================================
  fastify.post<{
    Body: z.infer<typeof revokeAllBodySchema>;
  }>('/auth/revoke-all', {
    preHandler: authRateLimits.revokeAll,
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          includeApiKeys: { type: 'boolean', default: false },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            result: {
              type: 'object',
              properties: {
                totalRevoked: { type: 'number' },
                jwtTokensRevoked: { type: 'number' },
                refreshTokenFamiliesRevoked: { type: 'number' },
                sessionsRevoked: { type: 'number' },
                apiKeysRevoked: { type: 'number' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        429: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof revokeAllBodySchema> }>, reply: FastifyReply) => {
    // Verify JWT
    let payload: JWTPayload;
    try {
      payload = await request.jwtVerify<JWTPayload>();
    } catch {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid authentication token required',
        },
      });
    }

    const { sub: userId, tenantId } = payload;

    if (!userId) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token missing user identifier',
        },
      });
    }

    // Validate request body
    const bodyResult = revokeAllBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.errors[0]?.message ?? 'Invalid request body',
        },
      });
    }

    const { currentPassword, includeApiKeys } = bodyResult.data;

    // Verify current password against stored hash
    const passwordResult = await verifyUserPassword(
      userId,
      tenantId ?? 'default',
      currentPassword,
      request
    );

    if (!passwordResult.valid) {
      authLogger.warn(
        { userId, failureCode: passwordResult.failureCode },
        'Revoke-all failed: password verification rejected'
      );

      // Audit log failed attempt
      const actor = buildActor(userId, tenantId, request);
      await securityLogger.logAuthAttempt(
        actor,
        false,
        { type: 'user', id: userId },
        { action: 'revoke_all' },
        passwordResult.failureCode ?? 'Invalid password'
      );

      // Return 429 for locked accounts, 401 for invalid credentials
      const statusCode = passwordResult.failureCode === 'ACCOUNT_LOCKED' ? 429 : 401;
      const errorCode = passwordResult.failureCode === 'ACCOUNT_LOCKED'
        ? 'ACCOUNT_LOCKED'
        : 'INVALID_PASSWORD';
      const errorMessage = passwordResult.failureCode === 'ACCOUNT_LOCKED'
        ? 'Account is temporarily locked due to too many failed attempts'
        : 'Current password is incorrect';

      return reply.status(statusCode).send({
        error: {
          code: errorCode,
          message: errorMessage,
        },
      });
    }

    // Perform bulk revocation
    const tokenTypes: Array<'jwt' | 'refresh' | 'api_key' | 'session'> = [
      'jwt',
      'refresh',
      'session',
    ];
    if (includeApiKeys) {
      tokenTypes.push('api_key');
    }

    authLogger.info(
      { userId, tenantId, includeApiKeys },
      'User initiated revoke-all with password confirmation'
    );

    const result = await tokenLifecycleService.revokeAllUserTokens(
      userId,
      tenantId ?? 'default',
      {
        reason: 'manual_revocation',
        revokedBy: userId,
        tokenTypes,
        metadata: { passwordConfirmed: true },
      }
    );

    // Build response
    const response: RevokeAllResponse = {
      message: 'All tokens have been revoked',
      result: {
        totalRevoked: result.totalRevoked,
        jwtTokensRevoked: result.jwtTokensRevoked,
        refreshTokenFamiliesRevoked: result.refreshTokenFamiliesRevoked,
        sessionsRevoked: result.sessionsRevoked,
        apiKeysRevoked: result.apiKeysRevoked,
      },
    };

    // Audit log success
    const actor = buildActor(userId, tenantId, request);
    await securityLogger.logSessionsBulkRevoked(
      actor,
      userId,
      result.totalRevoked,
      'User initiated revoke-all with password confirmation'
    );

    authLogger.info(
      {
        userId,
        tenantId,
        result: response.result,
      },
      'User revoked all tokens successfully'
    );

    return reply.send(response);
  });

  // ===========================================================================
  // POST /auth/logout-device - Logout from a specific device
  // ===========================================================================
  fastify.post<{
    Body: { deviceId: string };
  }>('/auth/logout-device', {
    preHandler: authRateLimits.logout,
    schema: {
      body: {
        type: 'object',
        required: ['deviceId'],
        properties: {
          deviceId: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            sessionsRevoked: { type: 'number' },
            refreshTokensRevoked: { type: 'number' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: { deviceId: string } }>, reply: FastifyReply) => {
    // Verify JWT
    let payload: JWTPayload;
    try {
      payload = await request.jwtVerify<JWTPayload>();
    } catch {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid authentication token required',
        },
      });
    }

    const { sub: userId, tenantId } = payload;
    const { deviceId } = request.body;

    if (!userId) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token missing user identifier',
        },
      });
    }

    if (!deviceId) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Device ID is required',
        },
      });
    }

    authLogger.info({ userId, deviceId }, 'User initiated device logout');

    const result = await tokenLifecycleService.revokeByDevice(userId, deviceId);

    // Audit log
    const actor = buildActor(userId, tenantId, request);
    await securityLogger.logSessionsBulkRevoked(
      actor,
      userId,
      result.totalRevoked,
      `Device logout: ${deviceId}`
    );

    authLogger.info(
      {
        userId,
        deviceId,
        sessionsRevoked: result.sessionsRevoked,
        refreshTokensRevoked: result.refreshTokenFamiliesRevoked,
      },
      'Device logout completed'
    );

    return reply.send({
      message: 'Device logged out successfully',
      sessionsRevoked: result.sessionsRevoked,
      refreshTokensRevoked: result.refreshTokenFamiliesRevoked,
    });
  });
}
