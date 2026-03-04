/**
 * Tests for MFA Types
 *
 * Validates:
 * - MfaMethod enum values
 * - MfaStatus enum values
 * - MFA_DEFAULTS constant values
 * - Zod schema validation (acceptance and rejection)
 * - mfaServiceConfigSchema defaults
 * - mfaMethodSchema and mfaStatusSchema enum values
 * - Request/response schema validation
 * - mfaMiddlewareOptionsSchema defaults
 */

import { describe, it, expect } from 'vitest';

import {
  MfaMethod,
  MfaStatus,
  MFA_DEFAULTS,
  mfaMethodSchema,
  mfaStatusSchema,
  createUserMfaInputSchema,
  createChallengeInputSchema,
  mfaEnrollmentResponseSchema,
  mfaEnrollmentCompleteResponseSchema,
  mfaStatusResponseSchema,
  mfaChallengeResponseSchema,
  mfaVerifyResponseSchema,
  mfaBackupCodesResponseSchema,
  mfaEnrollVerifyRequestSchema,
  mfaChallengeVerifyRequestSchema,
  mfaServiceConfigSchema,
  mfaMiddlewareOptionsSchema,
} from '../types.js';

// =============================================================================
// ENUM AND CONSTANT VALUES
// =============================================================================

describe('MfaMethod', () => {
  it('should have TOTP value of "totp"', () => {
    expect(MfaMethod.TOTP).toBe('totp');
  });

  it('should have BACKUP_CODES value of "backup_codes"', () => {
    expect(MfaMethod.BACKUP_CODES).toBe('backup_codes');
  });

  it('should have exactly two methods', () => {
    expect(Object.keys(MfaMethod)).toHaveLength(2);
  });
});

describe('MfaStatus', () => {
  it('should have PENDING value of "pending"', () => {
    expect(MfaStatus.PENDING).toBe('pending');
  });

  it('should have ACTIVE value of "active"', () => {
    expect(MfaStatus.ACTIVE).toBe('active');
  });

  it('should have DISABLED value of "disabled"', () => {
    expect(MfaStatus.DISABLED).toBe('disabled');
  });

  it('should have exactly three statuses', () => {
    expect(Object.keys(MfaStatus)).toHaveLength(3);
  });
});

describe('MFA_DEFAULTS', () => {
  it('should have BACKUP_CODE_COUNT of 10', () => {
    expect(MFA_DEFAULTS.BACKUP_CODE_COUNT).toBe(10);
  });

  it('should have ENROLLMENT_EXPIRY_MS of 15 minutes (900000ms)', () => {
    expect(MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS).toBe(15 * 60 * 1000);
    expect(MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS).toBe(900000);
  });

  it('should have CHALLENGE_EXPIRY_MS of 5 minutes (300000ms)', () => {
    expect(MFA_DEFAULTS.CHALLENGE_EXPIRY_MS).toBe(5 * 60 * 1000);
    expect(MFA_DEFAULTS.CHALLENGE_EXPIRY_MS).toBe(300000);
  });

  it('should have MAX_ATTEMPTS of 5', () => {
    expect(MFA_DEFAULTS.MAX_ATTEMPTS).toBe(5);
  });

  it('should have GRACE_PERIOD_MS of 24 hours (86400000ms)', () => {
    expect(MFA_DEFAULTS.GRACE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
    expect(MFA_DEFAULTS.GRACE_PERIOD_MS).toBe(86400000);
  });

  it('should have exactly 5 default keys', () => {
    expect(Object.keys(MFA_DEFAULTS)).toHaveLength(5);
  });
});

// =============================================================================
// ZOD ENUM SCHEMAS
// =============================================================================

describe('mfaMethodSchema', () => {
  it('should accept "totp"', () => {
    expect(mfaMethodSchema.parse('totp')).toBe('totp');
  });

  it('should accept "backup_codes"', () => {
    expect(mfaMethodSchema.parse('backup_codes')).toBe('backup_codes');
  });

  it('should reject invalid method', () => {
    expect(() => mfaMethodSchema.parse('sms')).toThrow();
    expect(() => mfaMethodSchema.parse('')).toThrow();
    expect(() => mfaMethodSchema.parse('TOTP')).toThrow();
  });
});

describe('mfaStatusSchema', () => {
  it('should accept "pending"', () => {
    expect(mfaStatusSchema.parse('pending')).toBe('pending');
  });

  it('should accept "active"', () => {
    expect(mfaStatusSchema.parse('active')).toBe('active');
  });

  it('should accept "disabled"', () => {
    expect(mfaStatusSchema.parse('disabled')).toBe('disabled');
  });

  it('should reject invalid status', () => {
    expect(() => mfaStatusSchema.parse('enabled')).toThrow();
    expect(() => mfaStatusSchema.parse('')).toThrow();
    expect(() => mfaStatusSchema.parse('ACTIVE')).toThrow();
  });
});

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

describe('createUserMfaInputSchema', () => {
  const validInput = {
    userId: '550e8400-e29b-41d4-a716-446655440001',
    tenantId: '550e8400-e29b-41d4-a716-446655440002',
    totpSecret: 'JBSWY3DPEHPK3PXP',
  };

  it('should accept valid input with default totpSecretEncrypted', () => {
    const result = createUserMfaInputSchema.parse(validInput);
    expect(result.userId).toBe(validInput.userId);
    expect(result.tenantId).toBe(validInput.tenantId);
    expect(result.totpSecret).toBe(validInput.totpSecret);
    expect(result.totpSecretEncrypted).toBe(true); // default
  });

  it('should accept explicit totpSecretEncrypted=false', () => {
    const result = createUserMfaInputSchema.parse({ ...validInput, totpSecretEncrypted: false });
    expect(result.totpSecretEncrypted).toBe(false);
  });

  it('should accept explicit totpSecretEncrypted=true', () => {
    const result = createUserMfaInputSchema.parse({ ...validInput, totpSecretEncrypted: true });
    expect(result.totpSecretEncrypted).toBe(true);
  });

  it('should reject non-UUID userId', () => {
    expect(() => createUserMfaInputSchema.parse({ ...validInput, userId: 'not-a-uuid' })).toThrow();
  });

  it('should reject non-UUID tenantId', () => {
    expect(() => createUserMfaInputSchema.parse({ ...validInput, tenantId: 'bad' })).toThrow();
  });

  it('should reject empty totpSecret', () => {
    expect(() => createUserMfaInputSchema.parse({ ...validInput, totpSecret: '' })).toThrow();
  });

  it('should reject missing userId', () => {
    const { userId, ...rest } = validInput;
    expect(() => createUserMfaInputSchema.parse(rest)).toThrow();
  });

  it('should reject missing tenantId', () => {
    const { tenantId, ...rest } = validInput;
    expect(() => createUserMfaInputSchema.parse(rest)).toThrow();
  });

  it('should reject missing totpSecret', () => {
    const { totpSecret, ...rest } = validInput;
    expect(() => createUserMfaInputSchema.parse(rest)).toThrow();
  });
});

describe('createChallengeInputSchema', () => {
  const validInput = {
    userId: '550e8400-e29b-41d4-a716-446655440001',
    sessionId: 'session-abc-123',
    expiresAt: new Date('2025-12-31T00:00:00Z'),
  };

  it('should accept valid input without maxAttempts', () => {
    const result = createChallengeInputSchema.parse(validInput);
    expect(result.userId).toBe(validInput.userId);
    expect(result.sessionId).toBe(validInput.sessionId);
    expect(result.expiresAt).toEqual(validInput.expiresAt);
    expect(result.maxAttempts).toBeUndefined();
  });

  it('should accept valid input with maxAttempts', () => {
    const result = createChallengeInputSchema.parse({ ...validInput, maxAttempts: 3 });
    expect(result.maxAttempts).toBe(3);
  });

  it('should reject non-UUID userId', () => {
    expect(() => createChallengeInputSchema.parse({ ...validInput, userId: 'bad' })).toThrow();
  });

  it('should reject empty sessionId', () => {
    expect(() => createChallengeInputSchema.parse({ ...validInput, sessionId: '' })).toThrow();
  });

  it('should reject non-positive maxAttempts', () => {
    expect(() => createChallengeInputSchema.parse({ ...validInput, maxAttempts: 0 })).toThrow();
    expect(() => createChallengeInputSchema.parse({ ...validInput, maxAttempts: -1 })).toThrow();
  });

  it('should reject non-integer maxAttempts', () => {
    expect(() => createChallengeInputSchema.parse({ ...validInput, maxAttempts: 3.5 })).toThrow();
  });
});

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

describe('mfaEnrollmentResponseSchema', () => {
  const validResponse = {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUrl: 'otpauth://totp/App:user@test.com?secret=JBSWY3DPEHPK3PXP',
    qrCode: 'data:image/png;base64,abc',
    expiresAt: '2025-12-31T00:00:00.000Z',
  };

  it('should accept a valid response', () => {
    const result = mfaEnrollmentResponseSchema.parse(validResponse);
    expect(result.secret).toBe(validResponse.secret);
    expect(result.otpauthUrl).toBe(validResponse.otpauthUrl);
    expect(result.qrCode).toBe(validResponse.qrCode);
    expect(result.expiresAt).toBe(validResponse.expiresAt);
  });

  it('should reject missing secret', () => {
    const { secret, ...rest } = validResponse;
    expect(() => mfaEnrollmentResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing otpauthUrl', () => {
    const { otpauthUrl, ...rest } = validResponse;
    expect(() => mfaEnrollmentResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing qrCode', () => {
    const { qrCode, ...rest } = validResponse;
    expect(() => mfaEnrollmentResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing expiresAt', () => {
    const { expiresAt, ...rest } = validResponse;
    expect(() => mfaEnrollmentResponseSchema.parse(rest)).toThrow();
  });

  it('should reject non-datetime expiresAt', () => {
    expect(() => mfaEnrollmentResponseSchema.parse({ ...validResponse, expiresAt: 'not-a-date' })).toThrow();
  });
});

describe('mfaEnrollmentCompleteResponseSchema', () => {
  const validResponse = {
    backupCodes: ['CODE1', 'CODE2'],
    backupCodeCount: 2,
    enabledAt: '2025-06-01T00:00:00.000Z',
    gracePeriodEndsAt: '2025-06-02T00:00:00.000Z',
  };

  it('should accept a valid response', () => {
    const result = mfaEnrollmentCompleteResponseSchema.parse(validResponse);
    expect(result.backupCodes).toEqual(['CODE1', 'CODE2']);
    expect(result.backupCodeCount).toBe(2);
    expect(result.enabledAt).toBe(validResponse.enabledAt);
    expect(result.gracePeriodEndsAt).toBe(validResponse.gracePeriodEndsAt);
  });

  it('should reject missing backupCodes', () => {
    const { backupCodes, ...rest } = validResponse;
    expect(() => mfaEnrollmentCompleteResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing backupCodeCount', () => {
    const { backupCodeCount, ...rest } = validResponse;
    expect(() => mfaEnrollmentCompleteResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing enabledAt', () => {
    const { enabledAt, ...rest } = validResponse;
    expect(() => mfaEnrollmentCompleteResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing gracePeriodEndsAt', () => {
    const { gracePeriodEndsAt, ...rest } = validResponse;
    expect(() => mfaEnrollmentCompleteResponseSchema.parse(rest)).toThrow();
  });

  it('should reject non-positive backupCodeCount', () => {
    expect(() => mfaEnrollmentCompleteResponseSchema.parse({ ...validResponse, backupCodeCount: 0 })).toThrow();
    expect(() => mfaEnrollmentCompleteResponseSchema.parse({ ...validResponse, backupCodeCount: -1 })).toThrow();
  });
});

describe('mfaStatusResponseSchema', () => {
  const validResponse = {
    enabled: true,
    status: 'active',
    enabledAt: '2025-06-01T00:00:00.000Z',
    enrollmentPending: false,
    backupCodesRemaining: 10,
    inGracePeriod: false,
    gracePeriodEndsAt: null,
  };

  it('should accept a valid response', () => {
    const result = mfaStatusResponseSchema.parse(validResponse);
    expect(result.enabled).toBe(true);
    expect(result.status).toBe('active');
    expect(result.enabledAt).toBe(validResponse.enabledAt);
    expect(result.enrollmentPending).toBe(false);
    expect(result.backupCodesRemaining).toBe(10);
    expect(result.inGracePeriod).toBe(false);
    expect(result.gracePeriodEndsAt).toBeNull();
  });

  it('should accept null enabledAt', () => {
    const result = mfaStatusResponseSchema.parse({ ...validResponse, enabledAt: null });
    expect(result.enabledAt).toBeNull();
  });

  it('should accept gracePeriodEndsAt as datetime string', () => {
    const result = mfaStatusResponseSchema.parse({
      ...validResponse,
      gracePeriodEndsAt: '2025-06-02T00:00:00.000Z',
    });
    expect(result.gracePeriodEndsAt).toBe('2025-06-02T00:00:00.000Z');
  });

  it('should reject missing enabled', () => {
    const { enabled, ...rest } = validResponse;
    expect(() => mfaStatusResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing status', () => {
    const { status, ...rest } = validResponse;
    expect(() => mfaStatusResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing enrollmentPending', () => {
    const { enrollmentPending, ...rest } = validResponse;
    expect(() => mfaStatusResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing backupCodesRemaining', () => {
    const { backupCodesRemaining, ...rest } = validResponse;
    expect(() => mfaStatusResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing inGracePeriod', () => {
    const { inGracePeriod, ...rest } = validResponse;
    expect(() => mfaStatusResponseSchema.parse(rest)).toThrow();
  });

  it('should reject negative backupCodesRemaining', () => {
    expect(() => mfaStatusResponseSchema.parse({ ...validResponse, backupCodesRemaining: -1 })).toThrow();
  });

  it('should accept backupCodesRemaining of 0', () => {
    const result = mfaStatusResponseSchema.parse({ ...validResponse, backupCodesRemaining: 0 });
    expect(result.backupCodesRemaining).toBe(0);
  });

  it('should reject invalid status value', () => {
    expect(() => mfaStatusResponseSchema.parse({ ...validResponse, status: 'invalid' })).toThrow();
  });
});

describe('mfaChallengeResponseSchema', () => {
  const validResponse = {
    challengeToken: 'token-abc-123',
    expiresAt: '2025-12-31T00:00:00.000Z',
    attemptsRemaining: 5,
  };

  it('should accept a valid response', () => {
    const result = mfaChallengeResponseSchema.parse(validResponse);
    expect(result.challengeToken).toBe('token-abc-123');
    expect(result.expiresAt).toBe(validResponse.expiresAt);
    expect(result.attemptsRemaining).toBe(5);
  });

  it('should reject missing challengeToken', () => {
    const { challengeToken, ...rest } = validResponse;
    expect(() => mfaChallengeResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing expiresAt', () => {
    const { expiresAt, ...rest } = validResponse;
    expect(() => mfaChallengeResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing attemptsRemaining', () => {
    const { attemptsRemaining, ...rest } = validResponse;
    expect(() => mfaChallengeResponseSchema.parse(rest)).toThrow();
  });

  it('should reject negative attemptsRemaining', () => {
    expect(() => mfaChallengeResponseSchema.parse({ ...validResponse, attemptsRemaining: -1 })).toThrow();
  });

  it('should accept attemptsRemaining of 0', () => {
    const result = mfaChallengeResponseSchema.parse({ ...validResponse, attemptsRemaining: 0 });
    expect(result.attemptsRemaining).toBe(0);
  });
});

describe('mfaVerifyResponseSchema', () => {
  it('should accept verified response with method', () => {
    const result = mfaVerifyResponseSchema.parse({
      verified: true,
      method: 'totp',
    });
    expect(result.verified).toBe(true);
    expect(result.method).toBe('totp');
    expect(result.attemptsRemaining).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('should accept failed response with attemptsRemaining and error', () => {
    const result = mfaVerifyResponseSchema.parse({
      verified: false,
      method: null,
      attemptsRemaining: 3,
      error: 'Invalid code',
    });
    expect(result.verified).toBe(false);
    expect(result.method).toBeNull();
    expect(result.attemptsRemaining).toBe(3);
    expect(result.error).toBe('Invalid code');
  });

  it('should accept backup_codes as method', () => {
    const result = mfaVerifyResponseSchema.parse({
      verified: true,
      method: 'backup_codes',
    });
    expect(result.method).toBe('backup_codes');
  });

  it('should reject missing verified', () => {
    expect(() => mfaVerifyResponseSchema.parse({ method: 'totp' })).toThrow();
  });

  it('should reject missing method', () => {
    expect(() => mfaVerifyResponseSchema.parse({ verified: true })).toThrow();
  });

  it('should reject negative attemptsRemaining', () => {
    expect(() => mfaVerifyResponseSchema.parse({
      verified: false,
      method: null,
      attemptsRemaining: -1,
    })).toThrow();
  });
});

describe('mfaBackupCodesResponseSchema', () => {
  const validResponse = {
    backupCodes: ['CODE1', 'CODE2', 'CODE3'],
    backupCodeCount: 3,
    generatedAt: '2025-12-31T00:00:00.000Z',
  };

  it('should accept a valid response', () => {
    const result = mfaBackupCodesResponseSchema.parse(validResponse);
    expect(result.backupCodes).toEqual(['CODE1', 'CODE2', 'CODE3']);
    expect(result.backupCodeCount).toBe(3);
    expect(result.generatedAt).toBe(validResponse.generatedAt);
  });

  it('should reject missing backupCodes', () => {
    const { backupCodes, ...rest } = validResponse;
    expect(() => mfaBackupCodesResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing backupCodeCount', () => {
    const { backupCodeCount, ...rest } = validResponse;
    expect(() => mfaBackupCodesResponseSchema.parse(rest)).toThrow();
  });

  it('should reject missing generatedAt', () => {
    const { generatedAt, ...rest } = validResponse;
    expect(() => mfaBackupCodesResponseSchema.parse(rest)).toThrow();
  });

  it('should reject non-positive backupCodeCount', () => {
    expect(() => mfaBackupCodesResponseSchema.parse({ ...validResponse, backupCodeCount: 0 })).toThrow();
  });
});

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

describe('mfaEnrollVerifyRequestSchema', () => {
  it('should accept a valid 6-digit code', () => {
    const result = mfaEnrollVerifyRequestSchema.parse({ code: '123456' });
    expect(result.code).toBe('123456');
  });

  it('should reject code shorter than 6 digits', () => {
    expect(() => mfaEnrollVerifyRequestSchema.parse({ code: '12345' })).toThrow();
  });

  it('should reject code longer than 6 digits', () => {
    expect(() => mfaEnrollVerifyRequestSchema.parse({ code: '1234567' })).toThrow();
  });

  it('should reject non-digit code', () => {
    expect(() => mfaEnrollVerifyRequestSchema.parse({ code: 'abcdef' })).toThrow();
  });

  it('should reject code with mixed digits and letters', () => {
    expect(() => mfaEnrollVerifyRequestSchema.parse({ code: '123abc' })).toThrow();
  });

  it('should reject missing code', () => {
    expect(() => mfaEnrollVerifyRequestSchema.parse({})).toThrow();
  });
});

describe('mfaChallengeVerifyRequestSchema', () => {
  it('should accept valid input', () => {
    const result = mfaChallengeVerifyRequestSchema.parse({
      challengeToken: 'token-123',
      code: '654321',
    });
    expect(result.challengeToken).toBe('token-123');
    expect(result.code).toBe('654321');
  });

  it('should reject empty challengeToken', () => {
    expect(() => mfaChallengeVerifyRequestSchema.parse({
      challengeToken: '',
      code: '123456',
    })).toThrow();
  });

  it('should reject empty code', () => {
    expect(() => mfaChallengeVerifyRequestSchema.parse({
      challengeToken: 'token-123',
      code: '',
    })).toThrow();
  });

  it('should reject missing challengeToken', () => {
    expect(() => mfaChallengeVerifyRequestSchema.parse({ code: '123456' })).toThrow();
  });

  it('should reject missing code', () => {
    expect(() => mfaChallengeVerifyRequestSchema.parse({ challengeToken: 'token' })).toThrow();
  });
});

// =============================================================================
// SERVICE CONFIG SCHEMA
// =============================================================================

describe('mfaServiceConfigSchema', () => {
  it('should provide all defaults when parsing empty object', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.issuer).toBe('Vorion');
    expect(result.backupCodeCount).toBe(MFA_DEFAULTS.BACKUP_CODE_COUNT);
    expect(result.enrollmentExpiryMs).toBe(MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS);
    expect(result.challengeExpiryMs).toBe(MFA_DEFAULTS.CHALLENGE_EXPIRY_MS);
    expect(result.maxAttempts).toBe(MFA_DEFAULTS.MAX_ATTEMPTS);
    expect(result.gracePeriodMs).toBe(MFA_DEFAULTS.GRACE_PERIOD_MS);
    expect(result.encryptSecrets).toBe(true);
  });

  it('should accept explicit values overriding defaults', () => {
    const result = mfaServiceConfigSchema.parse({
      issuer: 'CustomApp',
      backupCodeCount: 8,
      enrollmentExpiryMs: 60000,
      challengeExpiryMs: 120000,
      maxAttempts: 3,
      gracePeriodMs: 3600000,
      encryptSecrets: false,
    });
    expect(result.issuer).toBe('CustomApp');
    expect(result.backupCodeCount).toBe(8);
    expect(result.enrollmentExpiryMs).toBe(60000);
    expect(result.challengeExpiryMs).toBe(120000);
    expect(result.maxAttempts).toBe(3);
    expect(result.gracePeriodMs).toBe(3600000);
    expect(result.encryptSecrets).toBe(false);
  });

  it('should default issuer to "Vorion"', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.issuer).toBe('Vorion');
  });

  it('should default backupCodeCount to 10', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.backupCodeCount).toBe(10);
  });

  it('should default enrollmentExpiryMs to 900000', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.enrollmentExpiryMs).toBe(900000);
  });

  it('should default challengeExpiryMs to 300000', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.challengeExpiryMs).toBe(300000);
  });

  it('should default maxAttempts to 5', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.maxAttempts).toBe(5);
  });

  it('should default gracePeriodMs to 86400000', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.gracePeriodMs).toBe(86400000);
  });

  it('should default encryptSecrets to true', () => {
    const result = mfaServiceConfigSchema.parse({});
    expect(result.encryptSecrets).toBe(true);
  });

  it('should reject non-positive backupCodeCount', () => {
    expect(() => mfaServiceConfigSchema.parse({ backupCodeCount: 0 })).toThrow();
    expect(() => mfaServiceConfigSchema.parse({ backupCodeCount: -1 })).toThrow();
  });

  it('should reject non-positive maxAttempts', () => {
    expect(() => mfaServiceConfigSchema.parse({ maxAttempts: 0 })).toThrow();
  });

  it('should reject non-positive enrollmentExpiryMs', () => {
    expect(() => mfaServiceConfigSchema.parse({ enrollmentExpiryMs: 0 })).toThrow();
  });

  it('should reject non-positive challengeExpiryMs', () => {
    expect(() => mfaServiceConfigSchema.parse({ challengeExpiryMs: 0 })).toThrow();
  });

  it('should reject non-positive gracePeriodMs', () => {
    expect(() => mfaServiceConfigSchema.parse({ gracePeriodMs: 0 })).toThrow();
  });

  it('should reject non-integer backupCodeCount', () => {
    expect(() => mfaServiceConfigSchema.parse({ backupCodeCount: 5.5 })).toThrow();
  });
});

// =============================================================================
// MIDDLEWARE OPTIONS SCHEMA
// =============================================================================

describe('mfaMiddlewareOptionsSchema', () => {
  it('should default allowGracePeriod to true when parsing empty object', () => {
    const result = mfaMiddlewareOptionsSchema.parse({});
    expect(result.allowGracePeriod).toBe(true);
  });

  it('should accept explicit allowGracePeriod=false', () => {
    const result = mfaMiddlewareOptionsSchema.parse({ allowGracePeriod: false });
    expect(result.allowGracePeriod).toBe(false);
  });

  it('should accept skipPaths array', () => {
    const result = mfaMiddlewareOptionsSchema.parse({ skipPaths: ['/health', '/ping'] });
    expect(result.skipPaths).toEqual(['/health', '/ping']);
  });

  it('should accept empty skipPaths array', () => {
    const result = mfaMiddlewareOptionsSchema.parse({ skipPaths: [] });
    expect(result.skipPaths).toEqual([]);
  });

  it('should leave skipPaths undefined when not provided', () => {
    const result = mfaMiddlewareOptionsSchema.parse({});
    expect(result.skipPaths).toBeUndefined();
  });
});
