/**
 * Session Manager - High-level session management
 *
 * Provides secure session lifecycle management including:
 * - Session creation with device tracking
 * - Session validation with security checks
 * - Revocation on security events
 * - Re-authentication for sensitive operations
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';
import {
  SessionStore,
  getSessionStore,
  type Session,
  type CreateSessionInput,
  type SessionStoreConfig,
} from './session-store.js';
import {
  FingerprintService,
  getFingerprintService,
  extractFingerprintHeaders,
  type RequestHeaders,
  type FingerprintValidationResult,
} from './fingerprint-service.js';

const logger = createLogger({ component: 'session-manager' });

/**
 * Session manager configuration
 */
export interface SessionManagerConfig extends Partial<SessionStoreConfig> {
  /** Require re-authentication for sensitive operations */
  requireReauthForSensitive: boolean;
  /** Time window for sensitive operations after auth (seconds) */
  sensitiveOperationWindow: number;
  /** Inactivity timeout before requiring re-auth (seconds) */
  inactivityTimeout: number;
  /** Whether to revoke sessions on password change */
  revokeOnPasswordChange: boolean;
  /** Whether to revoke sessions on email change */
  revokeOnEmailChange: boolean;
  /** Whether to detect concurrent sessions from different locations */
  detectConcurrentSessions: boolean;
  /** Whether to validate fingerprints on session validation */
  fingerprintEnabled: boolean;
  /** Fingerprint strictness: 'warn' logs mismatches, 'block' rejects */
  fingerprintStrictness: 'warn' | 'block';
}

/**
 * Options for session regeneration
 */
export interface RegenerateSessionOptions {
  /** New IP address for the session (defaults to old session's IP) */
  ipAddress?: string;
  /** New user agent for the session (defaults to old session's userAgent) */
  userAgent?: string;
  /** New device fingerprint */
  deviceFingerprint?: string;
  /** Additional metadata to merge */
  metadata?: Record<string, unknown>;
  /** Reason for regeneration (for audit/logging) */
  reason?: string;
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  requireReauthForSensitive: true,
  sensitiveOperationWindow: 300, // 5 minutes
  inactivityTimeout: 3600, // 1 hour
  revokeOnPasswordChange: true,
  revokeOnEmailChange: true,
  detectConcurrentSessions: true,
  fingerprintEnabled: true,
  fingerprintStrictness: 'warn',
};

/**
 * Session validation result
 */
export interface SessionValidationResult {
  valid: boolean;
  session?: Session;
  reason?: string;
  requiresReauth?: boolean;
  securityWarnings?: string[];
  /** Fingerprint validation result if fingerprinting is enabled */
  fingerprintValidation?: FingerprintValidationResult;
}

/**
 * Sensitive operation types that may require re-authentication
 */
export type SensitiveOperation =
  | 'password_change'
  | 'email_change'
  | 'mfa_change'
  | 'api_key_create'
  | 'delete_account'
  | 'export_data'
  | 'admin_action'
  | 'high_value_transaction';

/**
 * Session manager for secure session lifecycle
 */
export class SessionManager {
  private store: SessionStore;
  private config: SessionManagerConfig;
  private fingerprintService: FingerprintService;

  constructor(config: Partial<SessionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = getSessionStore(config);
    this.fingerprintService = getFingerprintService();
  }

  /**
   * Create a new session for a user
   */
  async createSession(input: CreateSessionInput): Promise<Session> {
    // Check for suspicious concurrent sessions if enabled
    if (this.config.detectConcurrentSessions) {
      await this.checkConcurrentSessions(input);
    }

    return this.store.create(input);
  }

  /**
   * Validate a session and check security conditions
   */
  async validateSession(
    sessionId: string,
    options?: {
      operation?: SensitiveOperation;
      ipAddress?: string;
      checkInactivity?: boolean;
      /** Request headers for fingerprint validation */
      requestHeaders?: RequestHeaders;
    }
  ): Promise<SessionValidationResult> {
    const result = await this.store.validate(sessionId);
    const warnings: string[] = [];

    if (!result.valid) {
      return {
        valid: false,
        session: result.session,
        reason: result.reason,
      };
    }

    const session = result.session!;

    // Check inactivity timeout
    if (options?.checkInactivity !== false) {
      const inactiveSeconds = (Date.now() - session.lastActivityAt.getTime()) / 1000;
      if (inactiveSeconds > this.config.inactivityTimeout) {
        return {
          valid: false,
          session,
          reason: 'Session inactive for too long',
          requiresReauth: true,
        };
      }
    }

    // Check IP address change (warning only, not blocking)
    if (options?.ipAddress && options.ipAddress !== session.ipAddress) {
      warnings.push(`IP address changed from ${session.ipAddress} to ${options.ipAddress}`);
      logger.warn(
        {
          sessionId,
          userId: session.userId,
          originalIp: session.ipAddress,
          currentIp: options.ipAddress,
        },
        'Session IP address changed'
      );
    }

    // Validate fingerprint if enabled and session has stored fingerprint
    let fingerprintValidation: FingerprintValidationResult | undefined;
    if (
      this.config.fingerprintEnabled &&
      session.deviceFingerprint &&
      options?.requestHeaders
    ) {
      fingerprintValidation = this.fingerprintService.validateFingerprint(
        options.requestHeaders,
        session.deviceFingerprint,
        sessionId
      );

      if (!fingerprintValidation.valid) {
        if (fingerprintValidation.shouldBlock) {
          return {
            valid: false,
            session,
            reason: 'Fingerprint mismatch detected - session may be compromised',
            fingerprintValidation,
          };
        } else {
          warnings.push('Fingerprint mismatch detected - client characteristics changed');
        }
      }
    }

    // Check if sensitive operation requires recent authentication
    if (options?.operation && this.config.requireReauthForSensitive) {
      const requiresReauth = this.operationRequiresReauth(session, options.operation);
      if (requiresReauth) {
        return {
          valid: true,
          session,
          requiresReauth: true,
          reason: `Operation "${options.operation}" requires recent authentication`,
          securityWarnings: warnings.length > 0 ? warnings : undefined,
          fingerprintValidation,
        };
      }
    }

    return {
      valid: true,
      session,
      securityWarnings: warnings.length > 0 ? warnings : undefined,
      fingerprintValidation,
    };
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(
    sessionId: string,
    reason: string,
    revokedBy?: string
  ): Promise<boolean> {
    return this.store.revoke(sessionId, reason, revokedBy);
  }

  /**
   * Revoke all sessions for a user (e.g., on password change)
   */
  async revokeAllUserSessions(
    userId: string,
    reason: string,
    revokedBy?: string,
    exceptCurrentSession?: string
  ): Promise<number> {
    return this.store.revokeAllForUser(userId, reason, revokedBy, exceptCurrentSession);
  }

  /**
   * Revoke other sessions (keep current)
   */
  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    reason: string = 'User requested logout of other sessions'
  ): Promise<number> {
    return this.store.revokeAllForUser(userId, reason, userId, currentSessionId);
  }

  /**
   * Regenerate a session with a new ID while preserving session data
   *
   * This is a security best practice after privilege changes (e.g., login,
   * role change, password reset) to prevent session fixation attacks.
   *
   * Steps performed:
   * 1. Gets the old session data
   * 2. Creates a new session with the same data (optionally with updates)
   * 3. Revokes the old session
   * 4. Returns the new session
   *
   * @param oldSessionId - The current session ID to regenerate
   * @param options - Options for the new session
   * @returns The new session, or null if old session doesn't exist
   */
  async regenerateSession(
    oldSessionId: string,
    options: RegenerateSessionOptions = {}
  ): Promise<Session | null> {
    // Get the old session
    const oldSession = await this.store.get(oldSessionId);
    if (!oldSession || oldSession.revoked) {
      logger.warn(
        { oldSessionId, reason: options.reason },
        'Cannot regenerate session - old session not found or already revoked'
      );
      return null;
    }

    // Create new session with data from old session
    const newSessionInput: CreateSessionInput = {
      userId: oldSession.userId,
      tenantId: oldSession.tenantId,
      ipAddress: options.ipAddress ?? oldSession.ipAddress,
      userAgent: options.userAgent ?? oldSession.userAgent,
      deviceFingerprint: options.deviceFingerprint ?? oldSession.deviceFingerprint,
      metadata: {
        ...oldSession.metadata,
        ...options.metadata,
        regeneratedFrom: oldSessionId,
        regeneratedAt: new Date().toISOString(),
        regenerationReason: options.reason,
      },
    };

    // Create the new session
    const newSession = await this.store.create(newSessionInput);

    // Revoke the old session
    await this.store.revoke(
      oldSessionId,
      options.reason ?? 'Session regenerated',
      'system'
    );

    logger.info(
      {
        oldSessionId,
        newSessionId: newSession.id,
        userId: oldSession.userId,
        reason: options.reason,
      },
      'Session regenerated successfully'
    );

    return newSession;
  }

  /**
   * Compute and store fingerprint for a session
   *
   * Use this when creating sessions to enable fingerprint validation.
   *
   * @param sessionId - Session to update
   * @param headers - Request headers for fingerprint computation
   * @returns The computed fingerprint, or null if session not found
   */
  async setSessionFingerprint(
    sessionId: string,
    headers: RequestHeaders
  ): Promise<string | null> {
    const session = await this.store.get(sessionId);
    if (!session || session.revoked) {
      return null;
    }

    const fingerprintResult = this.fingerprintService.computeFingerprint(headers);

    // Update session with fingerprint
    // Note: This requires getting and re-saving the session
    // In production, consider adding a dedicated update method to SessionStore
    session.deviceFingerprint = fingerprintResult.fingerprint;
    session.metadata = {
      ...session.metadata,
      fingerprintComponents: fingerprintResult.componentsUsed,
      fingerprintMissingComponents: fingerprintResult.missingComponents,
    };

    // Touch to persist changes
    await this.store.touch(sessionId);

    logger.debug(
      {
        sessionId,
        fingerprintPrefix: fingerprintResult.fingerprint.substring(0, 8),
        componentsUsed: fingerprintResult.componentsUsed,
      },
      'Session fingerprint set'
    );

    return fingerprintResult.fingerprint;
  }

  /**
   * Handle password change - revoke all sessions if configured
   */
  async onPasswordChange(
    userId: string,
    currentSessionId?: string
  ): Promise<{ revokedCount: number }> {
    if (!this.config.revokeOnPasswordChange) {
      return { revokedCount: 0 };
    }

    const revokedCount = await this.revokeAllUserSessions(
      userId,
      'Password changed',
      'system',
      currentSessionId
    );

    logger.info(
      { userId, revokedCount, keptSession: currentSessionId },
      'Sessions revoked after password change'
    );

    return { revokedCount };
  }

  /**
   * Handle email change - revoke all sessions if configured
   */
  async onEmailChange(
    userId: string,
    currentSessionId?: string
  ): Promise<{ revokedCount: number }> {
    if (!this.config.revokeOnEmailChange) {
      return { revokedCount: 0 };
    }

    const revokedCount = await this.revokeAllUserSessions(
      userId,
      'Email changed',
      'system',
      currentSessionId
    );

    logger.info(
      { userId, revokedCount, keptSession: currentSessionId },
      'Sessions revoked after email change'
    );

    return { revokedCount };
  }

  /**
   * Handle security incident - revoke all sessions immediately
   */
  async onSecurityIncident(
    userId: string,
    incidentType: string,
    details?: string
  ): Promise<{ revokedCount: number }> {
    const reason = `Security incident: ${incidentType}${details ? ` - ${details}` : ''}`;
    const revokedCount = await this.revokeAllUserSessions(userId, reason, 'security-system');

    logger.warn(
      { userId, incidentType, revokedCount, details },
      'All sessions revoked due to security incident'
    );

    return { revokedCount };
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    return this.store.getSessionsForUser(userId);
  }

  /**
   * Get session count for a user
   */
  async getUserSessionCount(userId: string): Promise<number> {
    const sessions = await this.store.getSessionsForUser(userId);
    return sessions.length;
  }

  /**
   * Record that user re-authenticated (for sensitive operations)
   */
  async recordReauthentication(sessionId: string): Promise<boolean> {
    const session = await this.store.get(sessionId);
    if (!session || session.revoked) {
      return false;
    }

    // Update metadata to record re-auth time
    session.metadata = {
      ...session.metadata,
      lastReauthAt: new Date().toISOString(),
    };

    // Touch the session to update it
    await this.store.touch(sessionId);

    logger.info(
      { sessionId, userId: session.userId },
      'Re-authentication recorded'
    );

    return true;
  }

  /**
   * Check if an operation requires re-authentication
   */
  private operationRequiresReauth(
    session: Session,
    operation: SensitiveOperation
  ): boolean {
    // Check when user last authenticated
    const lastReauthAt = session.metadata?.['lastReauthAt'] as string | undefined;
    const lastAuthTime = lastReauthAt
      ? new Date(lastReauthAt).getTime()
      : session.createdAt.getTime();

    const secondsSinceAuth = (Date.now() - lastAuthTime) / 1000;

    // If within the sensitive operation window, no re-auth needed
    if (secondsSinceAuth < this.config.sensitiveOperationWindow) {
      return false;
    }

    // These operations always require recent auth
    const alwaysRequireReauth: SensitiveOperation[] = [
      'password_change',
      'delete_account',
      'mfa_change',
    ];

    return alwaysRequireReauth.includes(operation);
  }

  /**
   * Check for suspicious concurrent sessions
   */
  private async checkConcurrentSessions(input: CreateSessionInput): Promise<void> {
    const existingSessions = await this.store.getSessionsForUser(input.userId);

    for (const session of existingSessions) {
      // Check if there's a session from a very different location
      // (This is a simple check - could be enhanced with IP geolocation)
      if (session.ipAddress !== input.ipAddress) {
        const timeSinceLastActivity = Date.now() - session.lastActivityAt.getTime();

        // If there was recent activity from a different IP, log a warning
        if (timeSinceLastActivity < 300000) { // 5 minutes
          logger.warn(
            {
              userId: input.userId,
              existingSessionIp: session.ipAddress,
              newSessionIp: input.ipAddress,
              existingSessionId: session.id,
            },
            'Concurrent session from different IP detected'
          );
        }
      }
    }
  }
}

/**
 * Singleton session manager instance
 */
let sessionManager: SessionManager | null = null;

/**
 * Get the session manager singleton
 */
export function getSessionManager(config?: Partial<SessionManagerConfig>): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager(config);
  }
  return sessionManager;
}

/**
 * Create a new session manager instance (for testing)
 */
export function createSessionManager(config?: Partial<SessionManagerConfig>): SessionManager {
  return new SessionManager(config);
}

// Re-export types from session store
export type { Session, CreateSessionInput, SessionStoreConfig };

// Re-export fingerprint types for convenience
export type { RequestHeaders, FingerprintValidationResult };
export { extractFingerprintHeaders } from './fingerprint-service.js';
