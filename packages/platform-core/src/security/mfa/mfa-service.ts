/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * MFA Service
 *
 * Core MFA service providing TOTP enrollment, verification, challenge management,
 * and backup code operations. Implements RFC 6238 TOTP standard.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { encrypt, decrypt, type EncryptedEnvelope } from '../../common/encryption.js';
import { ValidationError, NotFoundError, ConflictError, UnauthorizedError } from '../../common/errors.js';
import { getTOTPService, TOTPService } from '../../auth/mfa/totp.js';
import { MfaStore, getMfaStore } from './mfa-store.js';
import {
  type MfaServiceConfig,
  type MfaEnrollmentResponse,
  type MfaEnrollmentCompleteResponse,
  type MfaStatusResponse,
  type MfaChallengeResponse,
  type MfaVerifyResponse,
  type MfaBackupCodesResponse,
  type UserMfaRecord,
  type MfaBackupCodeRecord,
  type MfaChallengeRecord,
  MfaMethod,
  MfaStatus,
  MFA_DEFAULTS,
  mfaServiceConfigSchema,
} from './types.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../../audit/security-logger.js';
import type { SecurityActor } from '../../audit/security-events.js';

const logger = createLogger({ component: 'mfa-service' });

/**
 * Build security actor for MFA operations
 */
function buildMfaActor(
  userId: string,
  tenantId: string,
  clientIp?: string | null
): SecurityActor {
  return {
    type: 'user',
    id: userId,
    tenantId,
    ip: clientIp ?? undefined,
  };
}

// =============================================================================
// MFA Service Error Classes
// =============================================================================

/**
 * Base MFA error
 */
export class MfaError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'MfaError';
    this.code = code;
  }
}

/**
 * Error when enrollment has expired
 */
export class EnrollmentExpiredError extends MfaError {
  constructor() {
    super('MFA enrollment has expired', 'MFA_ENROLLMENT_EXPIRED');
    this.name = 'EnrollmentExpiredError';
  }
}

/**
 * Error when challenge has expired
 */
export class ChallengeExpiredError extends MfaError {
  constructor() {
    super('MFA challenge has expired', 'MFA_CHALLENGE_EXPIRED');
    this.name = 'ChallengeExpiredError';
  }
}

/**
 * Error when too many attempts have been made
 */
export class TooManyAttemptsError extends MfaError {
  constructor() {
    super('Too many verification attempts', 'MFA_TOO_MANY_ATTEMPTS');
    this.name = 'TooManyAttemptsError';
  }
}

// =============================================================================
// MFA Service Class
// =============================================================================

/**
 * MFA Service for managing multi-factor authentication
 */
export class MfaService {
  private readonly config: MfaServiceConfig;
  private readonly store: MfaStore;
  private readonly totpService: TOTPService;
  private readonly securityLogger: SecurityAuditLogger;

  constructor(
    config?: Partial<MfaServiceConfig>,
    store?: MfaStore,
    totpService?: TOTPService,
    securityLogger?: SecurityAuditLogger
  ) {
    // Parse config with defaults and cast to required type
    const parsed = mfaServiceConfigSchema.parse(config ?? {});
    this.config = {
      issuer: parsed.issuer ?? 'Vorion',
      backupCodeCount: parsed.backupCodeCount ?? MFA_DEFAULTS.BACKUP_CODE_COUNT,
      enrollmentExpiryMs: parsed.enrollmentExpiryMs ?? MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS,
      challengeExpiryMs: parsed.challengeExpiryMs ?? MFA_DEFAULTS.CHALLENGE_EXPIRY_MS,
      maxAttempts: parsed.maxAttempts ?? MFA_DEFAULTS.MAX_ATTEMPTS,
      gracePeriodMs: parsed.gracePeriodMs ?? MFA_DEFAULTS.GRACE_PERIOD_MS,
      encryptSecrets: parsed.encryptSecrets ?? true,
    };
    this.store = store ?? getMfaStore();
    this.totpService = totpService ?? getTOTPService({ issuer: this.config.issuer });
    this.securityLogger = securityLogger ?? getSecurityAuditLogger();

    logger.info({ issuer: this.config.issuer }, 'MFA service initialized');
  }

  // ---------------------------------------------------------------------------
  // Enrollment Operations
  // ---------------------------------------------------------------------------

  /**
   * Start MFA enrollment for a user
   *
   * Generates a new TOTP secret and QR code for authenticator app setup.
   * The enrollment must be verified and completed within the enrollment period.
   */
  async enrollUser(userId: string, tenantId: string, email: string): Promise<MfaEnrollmentResponse> {
    logger.info({ userId, tenantId }, 'Starting MFA enrollment');

    // Security audit log enrollment start
    const actor = buildMfaActor(userId, tenantId);
    await this.securityLogger.logMfaEnrollmentStarted(actor, userId);

    // Check if user already has MFA enabled
    const existing = await this.store.getUserMfa(userId, tenantId);
    if (existing && existing.status === MfaStatus.ACTIVE) {
      throw new ConflictError('MFA is already enabled for this user', {
        userId,
        status: existing.status,
      });
    }

    // If there's a pending enrollment, delete it and start fresh
    if (existing && existing.status === MfaStatus.PENDING) {
      await this.store.deleteUserMfa(userId, tenantId);
    }

    // Generate new TOTP secret
    const totpSecret = this.totpService.generateTOTPSecret(userId, email);

    // Generate QR code
    const qrCode = await this.totpService.generateQRCode(totpSecret.otpauthUrl);

    // Encrypt the secret if configured
    let storedSecret: string;
    if (this.config.encryptSecrets) {
      const envelope = encrypt(totpSecret.secret);
      storedSecret = JSON.stringify(envelope);
    } else {
      storedSecret = totpSecret.secret;
    }

    // Create user MFA record
    const record = await this.store.createUserMfa({
      userId,
      tenantId,
      totpSecret: storedSecret,
      totpSecretEncrypted: this.config.encryptSecrets,
    });

    // Update expiry time based on config
    const expiresAt = new Date(Date.now() + this.config.enrollmentExpiryMs);
    await this.store.updateEnrollmentExpiry(record.id, expiresAt);

    return {
      secret: totpSecret.secret,
      otpauthUrl: totpSecret.otpauthUrl,
      qrCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verify TOTP code during enrollment
   *
   * Validates that the user has correctly configured their authenticator app.
   */
  async verifyEnrollment(userId: string, tenantId: string, code: string): Promise<boolean> {
    logger.info({ userId, tenantId }, 'Verifying MFA enrollment');

    const record = await this.store.getUserMfa(userId, tenantId);
    if (!record) {
      throw new NotFoundError('MFA enrollment not found', { userId, tenantId });
    }

    if (record.status !== MfaStatus.PENDING) {
      throw new ValidationError('MFA enrollment is not in pending state', {
        userId,
        status: record.status,
      });
    }

    // Check enrollment expiry
    if (record.enrollmentExpiresAt && new Date() > record.enrollmentExpiresAt) {
      throw new EnrollmentExpiredError();
    }

    // Get the TOTP secret
    const secret = this.decryptSecret(record);

    // Verify the code
    const isValid = await this.totpService.verifyToken(secret, code);

    // Security audit log enrollment verification
    const actor = buildMfaActor(userId, tenantId);
    await this.securityLogger.logMfaEnrollmentVerified(actor, userId, isValid);

    logger.info({ userId, tenantId, verified: isValid }, 'Enrollment verification result');
    return isValid;
  }

  /**
   * Complete MFA enrollment
   *
   * Activates MFA and generates backup codes for account recovery.
   */
  async completeEnrollment(
    userId: string,
    tenantId: string
  ): Promise<MfaEnrollmentCompleteResponse> {
    logger.info({ userId, tenantId }, 'Completing MFA enrollment');

    const record = await this.store.getUserMfa(userId, tenantId);
    if (!record) {
      throw new NotFoundError('MFA enrollment not found', { userId, tenantId });
    }

    if (record.status !== MfaStatus.PENDING) {
      throw new ValidationError('MFA enrollment is not in pending state', {
        userId,
        status: record.status,
      });
    }

    // Generate backup codes
    const backupCodes = this.totpService.generateBackupCodes(this.config.backupCodeCount);
    const codeHashes = backupCodes.map((code) => this.totpService.hashBackupCode(code));

    // Calculate grace period end
    const gracePeriodEndsAt = new Date(Date.now() + this.config.gracePeriodMs);

    // Activate MFA
    const activatedRecord = await this.store.activateUserMfa(record.id, gracePeriodEndsAt);
    if (!activatedRecord) {
      throw new Error('Failed to activate MFA');
    }

    // Store backup codes
    await this.store.createBackupCodes(record.id, codeHashes);

    // Security audit log enrollment completion
    const actor = buildMfaActor(userId, tenantId);
    await this.securityLogger.logMfaEnrolled(actor, userId, backupCodes.length);

    logger.info(
      { userId, tenantId, backupCodeCount: backupCodes.length },
      'MFA enrollment completed'
    );

    return {
      backupCodes,
      backupCodeCount: backupCodes.length,
      enabledAt: activatedRecord.enabledAt?.toISOString() ?? new Date().toISOString(),
      gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Challenge Operations
  // ---------------------------------------------------------------------------

  /**
   * Create an MFA challenge for login verification
   */
  async createChallenge(userId: string, sessionId: string, tenantId?: string): Promise<MfaChallengeResponse> {
    logger.info({ userId, sessionId }, 'Creating MFA challenge');

    const expiresAt = new Date(Date.now() + this.config.challengeExpiryMs);

    const challenge = await this.store.createChallenge({
      userId,
      sessionId,
      expiresAt,
      maxAttempts: this.config.maxAttempts,
    });

    // Security audit log challenge creation
    if (tenantId) {
      const actor = buildMfaActor(userId, tenantId);
      await this.securityLogger.logMfaChallengeCreated(actor, userId, challenge.id);
    }

    return {
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt.toISOString(),
      attemptsRemaining: challenge.maxAttempts - challenge.attempts,
    };
  }

  /**
   * Verify an MFA challenge with TOTP code or backup code
   */
  async verifyChallenge(
    challengeToken: string,
    code: string,
    tenantId: string,
    clientIp?: string
  ): Promise<MfaVerifyResponse> {
    logger.info({ challengeToken: challengeToken.slice(0, 8) }, 'Verifying MFA challenge');

    // Get challenge
    const challenge = await this.store.getChallengeByToken(challengeToken);
    if (!challenge) {
      throw new NotFoundError('MFA challenge not found');
    }

    // Check expiry
    if (new Date() > challenge.expiresAt) {
      throw new ChallengeExpiredError();
    }

    // Check if already verified
    if (challenge.verified) {
      return {
        verified: true,
        method: MfaMethod.TOTP,
      };
    }

    // Check attempts
    if (challenge.attempts >= challenge.maxAttempts) {
      // Security audit log too many attempts
      const actor = buildMfaActor(challenge.userId, tenantId, clientIp);
      await this.securityLogger.logMfaTooManyAttempts(actor, challenge.userId, challenge.attempts);
      throw new TooManyAttemptsError();
    }

    // Increment attempts
    await this.store.incrementChallengeAttempts(challenge.id);
    const attemptsRemaining = challenge.maxAttempts - challenge.attempts - 1;

    // Get user MFA record
    const userMfa = await this.store.getUserMfa(challenge.userId, tenantId);
    if (!userMfa || userMfa.status !== MfaStatus.ACTIVE) {
      return {
        verified: false,
        method: null,
        attemptsRemaining,
        error: 'MFA not enabled for this user',
      };
    }

    // Try TOTP verification first
    const secret = this.decryptSecret(userMfa);
    const actor = buildMfaActor(challenge.userId, tenantId, clientIp);

    if (await this.totpService.verifyToken(secret, code)) {
      await this.store.markChallengeVerified(challenge.id);

      // Security audit log successful TOTP verification
      await this.securityLogger.logMfaVerification(actor, challenge.userId, true, 'totp');

      logger.info({ userId: challenge.userId }, 'MFA challenge verified via TOTP');
      return {
        verified: true,
        method: MfaMethod.TOTP,
      };
    }

    // Try backup code verification
    const backupResult = await this.verifyBackupCode(userMfa.id, code, clientIp ?? null);
    if (backupResult) {
      await this.store.markChallengeVerified(challenge.id);

      // Get remaining backup codes count
      const remainingCodes = await this.store.getUnusedBackupCodeCount(userMfa.id);

      // Security audit log backup code used
      await this.securityLogger.logMfaBackupCodeUsed(actor, challenge.userId, remainingCodes);
      await this.securityLogger.logMfaVerification(actor, challenge.userId, true, 'backup_code');

      logger.info({ userId: challenge.userId }, 'MFA challenge verified via backup code');
      return {
        verified: true,
        method: MfaMethod.BACKUP_CODES,
      };
    }

    // Security audit log failed verification
    await this.securityLogger.logMfaVerification(actor, challenge.userId, false, 'unknown', attemptsRemaining);

    logger.info(
      { userId: challenge.userId, attemptsRemaining },
      'MFA challenge verification failed'
    );

    return {
      verified: false,
      method: null,
      attemptsRemaining,
      error: 'Invalid verification code',
    };
  }

  // ---------------------------------------------------------------------------
  // Backup Code Operations
  // ---------------------------------------------------------------------------

  /**
   * Verify a backup code
   */
  private async verifyBackupCode(
    userMfaId: string,
    code: string,
    clientIp: string | null
  ): Promise<boolean> {
    const unusedCodes = await this.store.getUnusedBackupCodes(userMfaId);
    const inputHash = this.totpService.hashBackupCode(code);

    for (const backupCode of unusedCodes) {
      if (this.timingSafeCompare(inputHash, backupCode.codeHash)) {
        await this.store.markBackupCodeUsed(backupCode.id, clientIp);
        return true;
      }
    }

    return false;
  }

  /**
   * Regenerate backup codes
   */
  async regenerateBackupCodes(
    userId: string,
    tenantId: string
  ): Promise<MfaBackupCodesResponse> {
    logger.info({ userId, tenantId }, 'Regenerating backup codes');

    const record = await this.store.getUserMfa(userId, tenantId);
    if (!record) {
      throw new NotFoundError('MFA not found for user', { userId, tenantId });
    }

    if (record.status !== MfaStatus.ACTIVE) {
      throw new ValidationError('MFA is not active', { userId, status: record.status });
    }

    // Delete existing backup codes
    await this.store.deleteBackupCodes(record.id);

    // Generate new backup codes
    const backupCodes = this.totpService.generateBackupCodes(this.config.backupCodeCount);
    const codeHashes = backupCodes.map((code) => this.totpService.hashBackupCode(code));

    // Store new backup codes
    await this.store.createBackupCodes(record.id, codeHashes);

    // Security audit log backup codes regeneration
    const actor = buildMfaActor(userId, tenantId);
    await this.securityLogger.logMfaBackupCodesRegenerated(actor, userId, backupCodes.length);

    logger.info({ userId, tenantId, count: backupCodes.length }, 'Backup codes regenerated');

    return {
      backupCodes,
      backupCodeCount: backupCodes.length,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Status and Disable Operations
  // ---------------------------------------------------------------------------

  /**
   * Get MFA status for a user
   */
  async getMfaStatus(userId: string, tenantId: string): Promise<MfaStatusResponse> {
    const record = await this.store.getUserMfa(userId, tenantId);

    if (!record) {
      return {
        enabled: false,
        status: MfaStatus.DISABLED,
        enabledAt: null,
        enrollmentPending: false,
        backupCodesRemaining: 0,
        inGracePeriod: false,
        gracePeriodEndsAt: null,
      };
    }

    const backupCodesRemaining =
      record.status === MfaStatus.ACTIVE
        ? await this.store.getUnusedBackupCodeCount(record.id)
        : 0;

    const now = new Date();
    const inGracePeriod =
      record.status === MfaStatus.ACTIVE &&
      record.gracePeriodEndsAt !== null &&
      now < record.gracePeriodEndsAt;

    return {
      enabled: record.status === MfaStatus.ACTIVE,
      status: record.status,
      enabledAt: record.enabledAt?.toISOString() ?? null,
      enrollmentPending: record.status === MfaStatus.PENDING,
      backupCodesRemaining,
      inGracePeriod,
      gracePeriodEndsAt: record.gracePeriodEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Disable MFA for a user
   */
  async disableMfa(userId: string, tenantId: string, reason?: string): Promise<void> {
    logger.info({ userId, tenantId }, 'Disabling MFA');

    const record = await this.store.getUserMfa(userId, tenantId);
    if (!record) {
      throw new NotFoundError('MFA not found for user', { userId, tenantId });
    }

    // Delete the MFA record (cascade deletes backup codes)
    await this.store.deleteUserMfa(userId, tenantId);

    // Security audit log MFA disabled
    const actor = buildMfaActor(userId, tenantId);
    await this.securityLogger.logMfaDisabled(actor, userId, reason);

    logger.info({ userId, tenantId }, 'MFA disabled');
  }

  /**
   * Check if user needs to complete MFA
   */
  async requiresMfa(userId: string, tenantId: string, sessionId: string): Promise<boolean> {
    const record = await this.store.getUserMfa(userId, tenantId);

    // No MFA configured
    if (!record || record.status !== MfaStatus.ACTIVE) {
      return false;
    }

    // Check grace period
    const now = new Date();
    if (record.gracePeriodEndsAt && now < record.gracePeriodEndsAt) {
      return false;
    }

    // Check if session is already verified
    const isVerified = await this.store.isSessionVerified(userId, sessionId);
    return !isVerified;
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Decrypt TOTP secret from storage
   */
  private decryptSecret(record: UserMfaRecord): string {
    if (!record.totpSecret) {
      throw new Error('TOTP secret not found');
    }

    if (record.totpSecretEncrypted) {
      const envelope = JSON.parse(record.totpSecret) as EncryptedEnvelope;
      return decrypt(envelope);
    }

    return record.totpSecret;
  }

  /**
   * Timing-safe string comparison
   */
  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');

    try {
      const crypto = require('node:crypto');
      return crypto.timingSafeEqual(bufferA, bufferB);
    } catch {
      let result = 0;
      for (let i = 0; i < bufferA.length; i++) {
        result |= bufferA[i] ^ bufferB[i];
      }
      return result === 0;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let mfaServiceInstance: MfaService | null = null;

/**
 * Get the singleton MFA service instance
 */
export function getMfaService(config?: Partial<MfaServiceConfig>): MfaService {
  if (!mfaServiceInstance) {
    mfaServiceInstance = new MfaService(config);
  }
  return mfaServiceInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetMfaService(): void {
  mfaServiceInstance = null;
}

/**
 * Create a new MFA service with custom dependencies (for testing)
 */
export function createMfaService(
  config?: Partial<MfaServiceConfig>,
  store?: MfaStore,
  totpService?: TOTPService,
  securityLogger?: SecurityAuditLogger
): MfaService {
  return new MfaService(config, store, totpService, securityLogger);
}
