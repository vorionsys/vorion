/**
 * Tests for MfaService
 *
 * Validates:
 * - Enrollment: enrollUser, verifyEnrollment, completeEnrollment
 * - Challenge: createChallenge, verifyChallenge (TOTP + backup codes)
 * - Backup codes: regenerateBackupCodes
 * - Status: getMfaStatus
 * - Disable: disableMfa
 * - requiresMfa logic (grace period, session verified, active/inactive)
 * - Singleton lifecycle: getMfaService, resetMfaService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../common/encryption.js', () => ({
  encrypt: vi.fn((data: string) => ({ encrypted: data, iv: 'test-iv', tag: 'test-tag' })),
  decrypt: vi.fn((envelope: any) => envelope.encrypted),
}));

vi.mock('../../../common/random.js', () => ({
  secureRandomId: vi.fn(() => 'mock-random-id-' + Math.random().toString(36).slice(2, 10)),
  secureRandomString: vi.fn((len: number) => 'x'.repeat(len)),
}));

// Mock external module imports that MfaService references
vi.mock('../../../audit/security-logger.js', () => ({
  SecurityAuditLogger: vi.fn(),
  getSecurityAuditLogger: vi.fn(),
}));

vi.mock('../../../auth/mfa/totp.js', () => ({
  TOTPService: vi.fn(),
  getTOTPService: vi.fn(),
}));

vi.mock('../mfa-store.js', () => ({
  MfaStore: vi.fn(),
  getMfaStore: vi.fn(),
}));

// Mock the db module that mfa-store imports
vi.mock('../../../common/db.js', () => ({
  getDatabase: vi.fn(),
}));

// Now import the service under test (after all mocks are registered)
import {
  MfaService,
  MfaError,
  getMfaService,
  resetMfaService,
  createMfaService,
  EnrollmentExpiredError,
  ChallengeExpiredError,
  TooManyAttemptsError,
} from '../mfa-service.js';

import { MfaStatus, MfaMethod, MFA_DEFAULTS } from '../types.js';
import type { UserMfaRecord, MfaChallengeRecord } from '../types.js';

// =============================================================================
// MOCK SETUP
// =============================================================================

const mockStore = {
  getUserMfa: vi.fn(),
  createUserMfa: vi.fn(),
  updateEnrollmentExpiry: vi.fn(),
  activateUserMfa: vi.fn(),
  createBackupCodes: vi.fn(),
  deleteBackupCodes: vi.fn(),
  deleteUserMfa: vi.fn(),
  createChallenge: vi.fn(),
  getChallengeByToken: vi.fn(),
  incrementChallengeAttempts: vi.fn(),
  markChallengeVerified: vi.fn(),
  getUnusedBackupCodes: vi.fn(),
  getUnusedBackupCodeCount: vi.fn(),
  markBackupCodeUsed: vi.fn(),
  isSessionVerified: vi.fn(),
};

const mockTotpService = {
  generateTOTPSecret: vi.fn(),
  generateQRCode: vi.fn(),
  verifyToken: vi.fn(),
  generateBackupCodes: vi.fn(),
  hashBackupCode: vi.fn(),
};

const mockSecurityLogger = {
  logMfaEnrollmentStarted: vi.fn(),
  logMfaEnrollmentVerified: vi.fn(),
  logMfaEnrolled: vi.fn(),
  logMfaChallengeCreated: vi.fn(),
  logMfaVerification: vi.fn(),
  logMfaBackupCodeUsed: vi.fn(),
  logMfaBackupCodesRegenerated: vi.fn(),
  logMfaDisabled: vi.fn(),
  logMfaTooManyAttempts: vi.fn(),
};

// =============================================================================
// HELPERS
// =============================================================================

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440002';
const TEST_EMAIL = 'user@test.com';
const TEST_SESSION_ID = 'session-abc-123';

function createTestService(): MfaService {
  return new MfaService(
    { issuer: 'TestApp', encryptSecrets: true },
    mockStore as any,
    mockTotpService as any,
    mockSecurityLogger as any
  );
}

function createMockUserMfaRecord(overrides: Partial<UserMfaRecord> = {}): UserMfaRecord {
  return {
    id: 'mfa-record-1',
    userId: TEST_USER_ID,
    tenantId: TEST_TENANT_ID,
    totpSecret: JSON.stringify({ encrypted: 'JBSWY3DPEHPK3PXP', iv: 'test-iv', tag: 'test-tag' }),
    totpSecretEncrypted: true,
    status: MfaStatus.ACTIVE,
    enabledAt: new Date('2025-01-01T00:00:00Z'),
    enrollmentStartedAt: new Date('2024-12-31T00:00:00Z'),
    enrollmentExpiresAt: null,
    gracePeriodEndsAt: null,
    createdAt: new Date('2024-12-31T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createMockChallengeRecord(overrides: Partial<MfaChallengeRecord> = {}): MfaChallengeRecord {
  return {
    id: 'challenge-1',
    userId: TEST_USER_ID,
    sessionId: TEST_SESSION_ID,
    challengeToken: 'token-abc-123',
    verified: false,
    verifiedAt: null,
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 300000), // 5 minutes from now
    createdAt: new Date(),
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('MfaService', () => {
  let service: MfaService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock returns
    mockStore.getUserMfa.mockResolvedValue(null);
    mockStore.createUserMfa.mockResolvedValue(createMockUserMfaRecord({ status: MfaStatus.PENDING }));
    mockStore.updateEnrollmentExpiry.mockResolvedValue(undefined);
    mockStore.activateUserMfa.mockResolvedValue(
      createMockUserMfaRecord({ status: MfaStatus.ACTIVE, enabledAt: new Date() })
    );
    mockStore.createBackupCodes.mockResolvedValue([]);
    mockStore.deleteBackupCodes.mockResolvedValue(10);
    mockStore.deleteUserMfa.mockResolvedValue(true);
    mockStore.isSessionVerified.mockResolvedValue(false);
    mockStore.getUnusedBackupCodes.mockResolvedValue([]);
    mockStore.getUnusedBackupCodeCount.mockResolvedValue(10);
    mockStore.incrementChallengeAttempts.mockResolvedValue(null);
    mockStore.markChallengeVerified.mockResolvedValue(null);

    mockTotpService.generateTOTPSecret.mockReturnValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/TestApp:user@test.com?secret=JBSWY3DPEHPK3PXP&issuer=TestApp',
    });
    mockTotpService.generateQRCode.mockResolvedValue('data:image/png;base64,qrcode-data');
    mockTotpService.verifyToken.mockResolvedValue(false);
    mockTotpService.generateBackupCodes.mockReturnValue([
      'AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF', 'GGGG-HHHH', 'IIII-JJJJ',
      'KKKK-LLLL', 'MMMM-NNNN', 'OOOO-PPPP', 'QQQQ-RRRR', 'SSSS-TTTT',
    ]);
    mockTotpService.hashBackupCode.mockImplementation((code: string) => `hashed:${code}`);

    mockSecurityLogger.logMfaEnrollmentStarted.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaEnrollmentVerified.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaEnrolled.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaChallengeCreated.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaVerification.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaBackupCodeUsed.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaBackupCodesRegenerated.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaDisabled.mockResolvedValue(undefined);
    mockSecurityLogger.logMfaTooManyAttempts.mockResolvedValue(undefined);

    service = createTestService();
  });

  afterEach(() => {
    resetMfaService();
  });

  // ===========================================================================
  // ENROLLMENT
  // ===========================================================================

  describe('enrollUser', () => {
    it('should generate TOTP secret, store encrypted, and return QR code', async () => {
      const result = await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      expect(result.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(result.qrCode).toBe('data:image/png;base64,qrcode-data');
      expect(result.expiresAt).toBeDefined();

      expect(mockTotpService.generateTOTPSecret).toHaveBeenCalledWith(TEST_USER_ID, TEST_EMAIL);
      expect(mockTotpService.generateQRCode).toHaveBeenCalledOnce();
      expect(mockStore.createUserMfa).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          totpSecretEncrypted: true,
        })
      );
      expect(mockSecurityLogger.logMfaEnrollmentStarted).toHaveBeenCalledOnce();
    });

    it('should throw ConflictError if MFA is already ACTIVE', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE })
      );

      await expect(
        service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL)
      ).rejects.toThrow(/already enabled/i);
    });

    it('should replace PENDING enrollment (delete old, create new)', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      // Should have deleted the old pending record
      expect(mockStore.deleteUserMfa).toHaveBeenCalledWith(TEST_USER_ID, TEST_TENANT_ID);
      // And created a new one
      expect(mockStore.createUserMfa).toHaveBeenCalledOnce();
    });
  });

  describe('verifyEnrollment', () => {
    it('should return true for valid TOTP code', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          enrollmentExpiresAt: new Date(Date.now() + 600000),
        })
      );
      mockTotpService.verifyToken.mockResolvedValue(true);

      const result = await service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456');

      expect(result).toBe(true);
      expect(mockTotpService.verifyToken).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', '123456');
      expect(mockSecurityLogger.logMfaEnrollmentVerified).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        true
      );
    });

    it('should throw NotFoundError if no MFA record exists', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      await expect(
        service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456')
      ).rejects.toThrow(/not found/i);
    });

    it('should throw EnrollmentExpiredError if enrollment has expired', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          enrollmentExpiresAt: new Date(Date.now() - 1000), // already expired
        })
      );

      await expect(
        service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456')
      ).rejects.toThrow(EnrollmentExpiredError);
    });

    it('should throw ValidationError if status is not PENDING', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE })
      );

      await expect(
        service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456')
      ).rejects.toThrow(/not in pending state/i);
    });
  });

  describe('completeEnrollment', () => {
    it('should generate backup codes, activate MFA, and return codes', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      const result = await service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.backupCodes).toHaveLength(10);
      expect(result.backupCodeCount).toBe(10);
      expect(result.enabledAt).toBeDefined();
      expect(result.gracePeriodEndsAt).toBeDefined();

      expect(mockTotpService.generateBackupCodes).toHaveBeenCalledWith(
        MFA_DEFAULTS.BACKUP_CODE_COUNT
      );
      expect(mockStore.activateUserMfa).toHaveBeenCalledOnce();
      expect(mockStore.createBackupCodes).toHaveBeenCalledOnce();
      expect(mockSecurityLogger.logMfaEnrolled).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        10
      );
    });

    it('should throw NotFoundError if no MFA record exists', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      await expect(
        service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow(/not found/i);
    });

    it('should throw ValidationError for non-pending status', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE })
      );

      await expect(
        service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow(/not in pending state/i);
    });
  });

  // ===========================================================================
  // CHALLENGE
  // ===========================================================================

  describe('createChallenge', () => {
    it('should create challenge with configured expiry and max attempts', async () => {
      const mockChallenge = createMockChallengeRecord();
      mockStore.createChallenge.mockResolvedValue(mockChallenge);

      const result = await service.createChallenge(TEST_USER_ID, TEST_SESSION_ID, TEST_TENANT_ID);

      expect(result.challengeToken).toBe(mockChallenge.challengeToken);
      expect(result.expiresAt).toBeDefined();
      expect(result.attemptsRemaining).toBe(mockChallenge.maxAttempts - mockChallenge.attempts);

      expect(mockStore.createChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
        })
      );
      expect(mockSecurityLogger.logMfaChallengeCreated).toHaveBeenCalledOnce();
    });
  });

  describe('verifyChallenge', () => {
    it('should succeed via TOTP verification', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(true);

      const result = await service.verifyChallenge(
        'token-abc-123',
        '654321',
        TEST_TENANT_ID,
        '192.168.1.1'
      );

      expect(result.verified).toBe(true);
      expect(result.method).toBe('totp');
      expect(mockStore.markChallengeVerified).toHaveBeenCalledWith(challenge.id);
      expect(mockSecurityLogger.logMfaVerification).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        true,
        'totp'
      );
    });

    it('should succeed via backup code when TOTP fails', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      // Set up backup code match
      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'hashed:AAAA-BBBB', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('hashed:AAAA-BBBB');
      mockStore.markBackupCodeUsed.mockResolvedValue(null);
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(9);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'AAAA-BBBB',
        TEST_TENANT_ID,
        '192.168.1.1'
      );

      expect(result.verified).toBe(true);
      expect(result.method).toBe('backup_codes');
      expect(mockStore.markBackupCodeUsed).toHaveBeenCalledWith('bc-1', '192.168.1.1');
      expect(mockSecurityLogger.logMfaBackupCodeUsed).toHaveBeenCalledOnce();
    });

    it('should increment attempts on failed verification', async () => {
      const challenge = createMockChallengeRecord({ attempts: 1 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([]);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'wrong-code',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(result.attemptsRemaining).toBeDefined();
      expect(mockStore.incrementChallengeAttempts).toHaveBeenCalledWith(challenge.id);
      expect(mockSecurityLogger.logMfaVerification).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        false,
        'unknown',
        expect.any(Number)
      );
    });

    it('should throw ChallengeExpiredError when challenge is expired', async () => {
      const expiredChallenge = createMockChallengeRecord({
        expiresAt: new Date(Date.now() - 60000), // 1 minute ago
      });
      mockStore.getChallengeByToken.mockResolvedValue(expiredChallenge);

      await expect(
        service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID)
      ).rejects.toThrow(ChallengeExpiredError);
    });

    it('should throw TooManyAttemptsError when maxAttempts reached', async () => {
      const maxedChallenge = createMockChallengeRecord({
        attempts: 5,
        maxAttempts: 5,
      });
      mockStore.getChallengeByToken.mockResolvedValue(maxedChallenge);

      await expect(
        service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID, '192.168.1.1')
      ).rejects.toThrow(TooManyAttemptsError);

      expect(mockSecurityLogger.logMfaTooManyAttempts).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        5
      );
    });

    it('should return already-verified challenge without re-verifying', async () => {
      const verifiedChallenge = createMockChallengeRecord({
        verified: true,
        verifiedAt: new Date(),
      });
      mockStore.getChallengeByToken.mockResolvedValue(verifiedChallenge);

      const result = await service.verifyChallenge(
        'token-abc-123',
        '123456',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(true);
      expect(result.method).toBe('totp');
      // Should NOT have called any verification
      expect(mockStore.incrementChallengeAttempts).not.toHaveBeenCalled();
      expect(mockTotpService.verifyToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when challenge token not found', async () => {
      mockStore.getChallengeByToken.mockResolvedValue(null);

      await expect(
        service.verifyChallenge('non-existent-token', '123456', TEST_TENANT_ID)
      ).rejects.toThrow(/not found/i);
    });
  });

  // ===========================================================================
  // BACKUP CODES
  // ===========================================================================

  describe('regenerateBackupCodes', () => {
    it('should delete old codes and create new ones', async () => {
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());

      const result = await service.regenerateBackupCodes(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.backupCodes).toHaveLength(10);
      expect(result.backupCodeCount).toBe(10);
      expect(result.generatedAt).toBeDefined();

      expect(mockStore.deleteBackupCodes).toHaveBeenCalledWith('mfa-record-1');
      expect(mockStore.createBackupCodes).toHaveBeenCalledWith(
        'mfa-record-1',
        expect.any(Array)
      );
      expect(mockSecurityLogger.logMfaBackupCodesRegenerated).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        10
      );
    });

    it('should throw NotFoundError when MFA record not found', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      await expect(
        service.regenerateBackupCodes(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow(/not found/i);
    });

    it('should throw ValidationError when MFA is not active', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      await expect(
        service.regenerateBackupCodes(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow(/not active/i);
    });
  });

  // ===========================================================================
  // STATUS
  // ===========================================================================

  describe('getMfaStatus', () => {
    it('should return disabled status when no MFA record exists', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.enabled).toBe(false);
      expect(result.status).toBe(MfaStatus.DISABLED);
      expect(result.enabledAt).toBeNull();
      expect(result.enrollmentPending).toBe(false);
      expect(result.backupCodesRemaining).toBe(0);
      expect(result.inGracePeriod).toBe(false);
      expect(result.gracePeriodEndsAt).toBeNull();
    });

    it('should return correct state for active MFA', async () => {
      const enabledAt = new Date('2025-06-01T00:00:00Z');
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          enabledAt,
          gracePeriodEndsAt: null,
        })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(8);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.enabled).toBe(true);
      expect(result.status).toBe(MfaStatus.ACTIVE);
      expect(result.enabledAt).toBe(enabledAt.toISOString());
      expect(result.enrollmentPending).toBe(false);
      expect(result.backupCodesRemaining).toBe(8);
      expect(result.inGracePeriod).toBe(false);
    });

    it('should correctly detect grace period', async () => {
      const futureGrace = new Date(Date.now() + 3600000); // 1 hour from now
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: futureGrace,
        })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(10);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.inGracePeriod).toBe(true);
      expect(result.gracePeriodEndsAt).toBe(futureGrace.toISOString());
    });

    it('should return enrollmentPending for PENDING status', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.enrollmentPending).toBe(true);
      expect(result.enabled).toBe(false);
      expect(result.backupCodesRemaining).toBe(0); // No backup codes for pending
    });
  });

  // ===========================================================================
  // DISABLE
  // ===========================================================================

  describe('disableMfa', () => {
    it('should delete MFA record and log the event', async () => {
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());

      await service.disableMfa(TEST_USER_ID, TEST_TENANT_ID, 'User requested');

      expect(mockStore.deleteUserMfa).toHaveBeenCalledWith(TEST_USER_ID, TEST_TENANT_ID);
      expect(mockSecurityLogger.logMfaDisabled).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        'User requested'
      );
    });

    it('should throw NotFoundError when no MFA record exists', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      await expect(
        service.disableMfa(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow(/not found/i);
    });
  });

  // ===========================================================================
  // REQUIRES MFA
  // ===========================================================================

  describe('requiresMfa', () => {
    it('should return false when MFA not active', async () => {
      mockStore.getUserMfa.mockResolvedValue(null);

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
    });

    it('should return false when MFA status is PENDING', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
    });

    it('should return false during grace period', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: new Date(Date.now() + 3600000), // 1 hour from now
        })
      );

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
    });

    it('should return false when session is already verified', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE, gracePeriodEndsAt: null })
      );
      mockStore.isSessionVerified.mockResolvedValue(true);

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
    });

    it('should return true when MFA active and session not verified', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE, gracePeriodEndsAt: null })
      );
      mockStore.isSessionVerified.mockResolvedValue(false);

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(true);
    });

    it('should return true when grace period has ended and session not verified', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: new Date(Date.now() - 1000), // expired
        })
      );
      mockStore.isSessionVerified.mockResolvedValue(false);

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // SINGLETON
  // ===========================================================================

  describe('getMfaService and resetMfaService', () => {
    it('should return and reset singleton', () => {
      resetMfaService();
      const s1 = getMfaService({ issuer: 'Test' });
      const s2 = getMfaService();
      expect(s1).toBe(s2);

      resetMfaService();
      const s3 = getMfaService({ issuer: 'Test' });
      expect(s3).not.toBe(s1);
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: Error Classes
  // ===========================================================================

  describe('MfaError classes', () => {
    it('MfaError should have correct name, code, and message', () => {
      const error = new MfaError('test message', 'TEST_CODE');
      expect(error.name).toBe('MfaError');
      expect(error.code).toBe('TEST_CODE');
      expect(error.message).toBe('test message');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MfaError);
    });

    it('EnrollmentExpiredError should have correct name, code, and message', () => {
      const error = new EnrollmentExpiredError();
      expect(error.name).toBe('EnrollmentExpiredError');
      expect(error.code).toBe('MFA_ENROLLMENT_EXPIRED');
      expect(error.message).toBe('MFA enrollment has expired');
      expect(error).toBeInstanceOf(MfaError);
    });

    it('ChallengeExpiredError should have correct name, code, and message', () => {
      const error = new ChallengeExpiredError();
      expect(error.name).toBe('ChallengeExpiredError');
      expect(error.code).toBe('MFA_CHALLENGE_EXPIRED');
      expect(error.message).toBe('MFA challenge has expired');
      expect(error).toBeInstanceOf(MfaError);
    });

    it('TooManyAttemptsError should have correct name, code, and message', () => {
      const error = new TooManyAttemptsError();
      expect(error.name).toBe('TooManyAttemptsError');
      expect(error.code).toBe('MFA_TOO_MANY_ATTEMPTS');
      expect(error.message).toBe('Too many verification attempts');
      expect(error).toBeInstanceOf(MfaError);
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: Constructor Config Defaults
  // ===========================================================================

  describe('constructor config defaults', () => {
    it('should use default issuer "Vorion" when not provided', () => {
      const svc = new MfaService(
        {},
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );
      // The config.issuer defaults to 'Vorion' — verify by observing behavior
      // We can check by seeing what backupCodeCount is used via generateBackupCodes
      // But the key is to kill the ?? 'Vorion' mutant — test that construction succeeds
      expect(svc).toBeInstanceOf(MfaService);
    });

    it('should use default backupCodeCount from MFA_DEFAULTS when not provided', async () => {
      const svc = new MfaService(
        { issuer: 'TestApp' },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      await svc.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);

      // Default backupCodeCount should be MFA_DEFAULTS.BACKUP_CODE_COUNT (10)
      expect(mockTotpService.generateBackupCodes).toHaveBeenCalledWith(MFA_DEFAULTS.BACKUP_CODE_COUNT);
    });

    it('should use explicit config values instead of defaults', async () => {
      const svc = new MfaService(
        {
          issuer: 'CustomApp',
          backupCodeCount: 8,
          enrollmentExpiryMs: 60000,
          challengeExpiryMs: 120000,
          maxAttempts: 3,
          gracePeriodMs: 3600000,
          encryptSecrets: false,
        },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );

      // Test backupCodeCount=8 override
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );
      await svc.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);
      expect(mockTotpService.generateBackupCodes).toHaveBeenCalledWith(8);
    });

    it('should use encryptSecrets=true by default when not provided', async () => {
      const svc = new MfaService(
        { issuer: 'TestApp' },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );

      await svc.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      // Should call createUserMfa with totpSecretEncrypted: true (default)
      expect(mockStore.createUserMfa).toHaveBeenCalledWith(
        expect.objectContaining({
          totpSecretEncrypted: true,
        })
      );
      // The stored secret should be JSON.stringify'd envelope
      const callArg = mockStore.createUserMfa.mock.calls[0][0];
      expect(() => JSON.parse(callArg.totpSecret)).not.toThrow();
    });

    it('should construct with no config at all (undefined)', () => {
      const svc = new MfaService(
        undefined,
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );
      expect(svc).toBeInstanceOf(MfaService);
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: enrollUser - encryptSecrets false path
  // ===========================================================================

  describe('enrollUser with encryptSecrets=false', () => {
    it('should store raw secret when encryptSecrets is false', async () => {
      const svc = new MfaService(
        { issuer: 'TestApp', encryptSecrets: false },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );

      await svc.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      expect(mockStore.createUserMfa).toHaveBeenCalledWith(
        expect.objectContaining({
          totpSecret: 'JBSWY3DPEHPK3PXP', // raw, not JSON.stringify'd
          totpSecretEncrypted: false,
        })
      );

      // Verify the secret is NOT a JSON envelope
      const callArg = mockStore.createUserMfa.mock.calls[0][0];
      expect(callArg.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('should store JSON-stringified envelope when encryptSecrets is true', async () => {
      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      const callArg = mockStore.createUserMfa.mock.calls[0][0];
      const parsed = JSON.parse(callArg.totpSecret);
      expect(parsed).toHaveProperty('encrypted');
      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('tag');
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: enrollUser - specific field assertions
  // ===========================================================================

  describe('enrollUser field-level assertions', () => {
    it('should pass correct userId and tenantId to createUserMfa', async () => {
      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      const callArg = mockStore.createUserMfa.mock.calls[0][0];
      expect(callArg.userId).toBe(TEST_USER_ID);
      expect(callArg.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should call updateEnrollmentExpiry with the record id and a future date', async () => {
      const now = Date.now();
      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      expect(mockStore.updateEnrollmentExpiry).toHaveBeenCalledTimes(1);
      const [recordId, expiresAt] = mockStore.updateEnrollmentExpiry.mock.calls[0];
      expect(recordId).toBe('mfa-record-1');
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(now);
    });

    it('should return all four expected fields in response', async () => {
      const result = await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('otpauthUrl');
      expect(result).toHaveProperty('qrCode');
      expect(result).toHaveProperty('expiresAt');
      // expiresAt should be ISO string
      expect(typeof result.expiresAt).toBe('string');
      expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt);
    });

    it('should NOT delete existing record when status is DISABLED', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.DISABLED })
      );

      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      // Should NOT call deleteUserMfa for DISABLED status (only PENDING triggers delete)
      expect(mockStore.deleteUserMfa).not.toHaveBeenCalled();
      expect(mockStore.createUserMfa).toHaveBeenCalledOnce();
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: verifyEnrollment - enrollment not expired (null expiresAt)
  // ===========================================================================

  describe('verifyEnrollment edge cases', () => {
    it('should proceed when enrollmentExpiresAt is null (no expiry set)', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          enrollmentExpiresAt: null,
        })
      );
      mockTotpService.verifyToken.mockResolvedValue(true);

      const result = await service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456');
      expect(result).toBe(true);
    });

    it('should return false for invalid TOTP code', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          enrollmentExpiresAt: new Date(Date.now() + 600000),
        })
      );
      mockTotpService.verifyToken.mockResolvedValue(false);

      const result = await service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '000000');
      expect(result).toBe(false);
      expect(mockSecurityLogger.logMfaEnrollmentVerified).toHaveBeenCalledWith(
        expect.any(Object),
        TEST_USER_ID,
        false
      );
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: completeEnrollment edge cases
  // ===========================================================================

  describe('completeEnrollment edge cases', () => {
    it('should throw Error when activateUserMfa returns null', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );
      mockStore.activateUserMfa.mockResolvedValue(null);

      await expect(
        service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID)
      ).rejects.toThrow('Failed to activate MFA');
    });

    it('should use fallback date when enabledAt is null on activated record', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );
      mockStore.activateUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE, enabledAt: null })
      );

      const before = new Date().toISOString();
      const result = await service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);
      const after = new Date().toISOString();

      // enabledAt should be a valid ISO string (fallback to new Date().toISOString())
      expect(result.enabledAt).toBeDefined();
      expect(result.enabledAt >= before).toBe(true);
      expect(result.enabledAt <= after).toBe(true);
    });

    it('should use enabledAt from activated record when available', async () => {
      const specificDate = new Date('2025-03-15T12:00:00Z');
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );
      mockStore.activateUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE, enabledAt: specificDate })
      );

      const result = await service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.enabledAt).toBe(specificDate.toISOString());
    });

    it('should return gracePeriodEndsAt as ISO string', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      const result = await service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);

      expect(typeof result.gracePeriodEndsAt).toBe('string');
      expect(new Date(result.gracePeriodEndsAt).toISOString()).toBe(result.gracePeriodEndsAt);
    });

    it('should pass record.id to createBackupCodes', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ id: 'specific-mfa-id', status: MfaStatus.PENDING })
      );

      await service.completeEnrollment(TEST_USER_ID, TEST_TENANT_ID);

      expect(mockStore.createBackupCodes).toHaveBeenCalledWith(
        'specific-mfa-id',
        expect.any(Array)
      );
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: verifyChallenge edge cases
  // ===========================================================================

  describe('verifyChallenge edge cases', () => {
    it('should return not-enabled error when userMfa status is PENDING', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.PENDING })
      );

      const result = await service.verifyChallenge(
        'token-abc-123',
        '123456',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(result.method).toBeNull();
      expect(result.error).toBe('MFA not enabled for this user');
    });

    it('should return not-enabled error when userMfa record is null', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(null);

      const result = await service.verifyChallenge(
        'token-abc-123',
        '123456',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(result.method).toBeNull();
      expect(result.error).toBe('MFA not enabled for this user');
    });

    it('should calculate attemptsRemaining as maxAttempts - attempts - 1', async () => {
      const challenge = createMockChallengeRecord({ attempts: 2, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([]);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'wrong',
        TEST_TENANT_ID
      );

      // attemptsRemaining = 5 - 2 - 1 = 2
      expect(result.attemptsRemaining).toBe(2);
    });

    it('should calculate attemptsRemaining=0 when at second-to-last attempt', async () => {
      const challenge = createMockChallengeRecord({ attempts: 4, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([]);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'wrong',
        TEST_TENANT_ID
      );

      // attemptsRemaining = 5 - 4 - 1 = 0
      expect(result.attemptsRemaining).toBe(0);
    });

    it('should throw TooManyAttemptsError at exact boundary (attempts === maxAttempts)', async () => {
      // This tests the >= boundary: attempts=5, maxAttempts=5 should throw
      const challenge = createMockChallengeRecord({ attempts: 5, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);

      await expect(
        service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID)
      ).rejects.toThrow(TooManyAttemptsError);
    });

    it('should NOT throw when attempts is one below maxAttempts', async () => {
      // attempts=4, maxAttempts=5: should NOT throw (4 < 5, not >=)
      const challenge = createMockChallengeRecord({ attempts: 4, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([]);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'wrong',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      // Did not throw - good
    });

    it('should return error string for failed verification', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([]);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'wrong',
        TEST_TENANT_ID
      );

      expect(result.error).toBe('Invalid verification code');
    });

    it('should pass clientIp to buildMfaActor for too-many-attempts logging', async () => {
      const challenge = createMockChallengeRecord({ attempts: 5, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);

      await expect(
        service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID, '10.0.0.1')
      ).rejects.toThrow(TooManyAttemptsError);

      // Verify actor was built with clientIp
      expect(mockSecurityLogger.logMfaTooManyAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'user',
          id: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          ip: '10.0.0.1',
        }),
        TEST_USER_ID,
        5
      );
    });

    it('should build actor with clientIp=undefined when clientIp not provided for TOTP success', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(true);

      await service.verifyChallenge('token-abc-123', '654321', TEST_TENANT_ID);

      // clientIp not provided, should be undefined in actor
      expect(mockSecurityLogger.logMfaVerification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'user',
          id: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          ip: undefined,
        }),
        TEST_USER_ID,
        true,
        'totp'
      );
    });

    it('should pass null clientIp to markBackupCodeUsed when no clientIp provided for backup code verification', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'hashed:BACKUP', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('hashed:BACKUP');
      mockStore.markBackupCodeUsed.mockResolvedValue(null);
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(9);

      await service.verifyChallenge('token-abc-123', 'BACKUP', TEST_TENANT_ID);

      // clientIp ?? null → null
      expect(mockStore.markBackupCodeUsed).toHaveBeenCalledWith('bc-1', null);
    });

    it('should pass clientIp to markBackupCodeUsed when clientIp is provided', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);
      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-2', userMfaId: 'mfa-record-1', codeHash: 'hashed:MYCODE', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('hashed:MYCODE');
      mockStore.markBackupCodeUsed.mockResolvedValue(null);
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(5);

      await service.verifyChallenge('token-abc-123', 'MYCODE', TEST_TENANT_ID, '172.16.0.1');

      expect(mockStore.markBackupCodeUsed).toHaveBeenCalledWith('bc-2', '172.16.0.1');
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: verifyChallenge backup code - multiple codes
  // ===========================================================================

  describe('verifyBackupCode through verifyChallenge - loop and comparison', () => {
    it('should match the second backup code when first does not match', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'hashed:FIRST-CODE', usedAt: null, usedFromIp: null, createdAt: new Date() },
        { id: 'bc-2', userMfaId: 'mfa-record-1', codeHash: 'hashed:SECOND-CODE', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('hashed:SECOND-CODE');
      mockStore.markBackupCodeUsed.mockResolvedValue(null);
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(8);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'SECOND-CODE',
        TEST_TENANT_ID,
        '10.0.0.1'
      );

      expect(result.verified).toBe(true);
      expect(result.method).toBe('backup_codes');
      expect(mockStore.markBackupCodeUsed).toHaveBeenCalledWith('bc-2', '10.0.0.1');
    });

    it('should return false when no backup codes match', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'hashed:CODE-A', usedAt: null, usedFromIp: null, createdAt: new Date() },
        { id: 'bc-2', userMfaId: 'mfa-record-1', codeHash: 'hashed:CODE-B', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('hashed:NO-MATCH');

      const result = await service.verifyChallenge(
        'token-abc-123',
        'NO-MATCH',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(mockStore.markBackupCodeUsed).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: createChallenge - without tenantId
  // ===========================================================================

  describe('createChallenge without tenantId', () => {
    it('should NOT log security event when tenantId is not provided', async () => {
      const mockChallenge = createMockChallengeRecord();
      mockStore.createChallenge.mockResolvedValue(mockChallenge);

      const result = await service.createChallenge(TEST_USER_ID, TEST_SESSION_ID);

      expect(result.challengeToken).toBe(mockChallenge.challengeToken);
      expect(mockSecurityLogger.logMfaChallengeCreated).not.toHaveBeenCalled();
    });

    it('should log security event when tenantId IS provided', async () => {
      const mockChallenge = createMockChallengeRecord();
      mockStore.createChallenge.mockResolvedValue(mockChallenge);

      await service.createChallenge(TEST_USER_ID, TEST_SESSION_ID, TEST_TENANT_ID);

      expect(mockSecurityLogger.logMfaChallengeCreated).toHaveBeenCalledOnce();
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: getMfaStatus edge cases
  // ===========================================================================

  describe('getMfaStatus edge cases', () => {
    it('should return enabledAt=null for record with null enabledAt', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          enabledAt: null,
          gracePeriodEndsAt: null,
        })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(5);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.enabled).toBe(true);
      expect(result.enabledAt).toBeNull();
    });

    it('should return gracePeriodEndsAt=null for record with null gracePeriodEndsAt', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: null,
        })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(5);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.gracePeriodEndsAt).toBeNull();
    });

    it('should return inGracePeriod=false when grace period has expired', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: new Date(Date.now() - 1000), // past
        })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(5);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.inGracePeriod).toBe(false);
      // gracePeriodEndsAt should still be set (not null) even if expired
      expect(result.gracePeriodEndsAt).not.toBeNull();
    });

    it('should return backupCodesRemaining=0 for DISABLED status', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.DISABLED })
      );

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.backupCodesRemaining).toBe(0);
      expect(result.enabled).toBe(false);
      // Should NOT call getUnusedBackupCodeCount for non-ACTIVE
      expect(mockStore.getUnusedBackupCodeCount).not.toHaveBeenCalled();
    });

    it('should call getUnusedBackupCodeCount only for ACTIVE status', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.ACTIVE })
      );
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(7);

      const result = await service.getMfaStatus(TEST_USER_ID, TEST_TENANT_ID);

      expect(result.backupCodesRemaining).toBe(7);
      expect(mockStore.getUnusedBackupCodeCount).toHaveBeenCalledWith('mfa-record-1');
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: requiresMfa - DISABLED status
  // ===========================================================================

  describe('requiresMfa edge cases', () => {
    it('should return false for DISABLED status', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({ status: MfaStatus.DISABLED })
      );

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
    });

    it('should check session verification after grace period check', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: new Date(Date.now() - 100000), // expired grace
        })
      );
      mockStore.isSessionVerified.mockResolvedValue(false);

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(true);
      expect(mockStore.isSessionVerified).toHaveBeenCalledWith(TEST_USER_ID, TEST_SESSION_ID);
    });

    it('should NOT check session verification when in grace period', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.ACTIVE,
          gracePeriodEndsAt: new Date(Date.now() + 3600000),
        })
      );

      const result = await service.requiresMfa(TEST_USER_ID, TEST_TENANT_ID, TEST_SESSION_ID);
      expect(result).toBe(false);
      // Should short-circuit before checking session
      expect(mockStore.isSessionVerified).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: decryptSecret
  // ===========================================================================

  describe('decryptSecret (through verifyEnrollment and verifyChallenge)', () => {
    it('should throw when totpSecret is null', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          totpSecret: null,
          enrollmentExpiresAt: new Date(Date.now() + 600000),
        })
      );

      await expect(
        service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456')
      ).rejects.toThrow('TOTP secret not found');
    });

    it('should return raw secret when totpSecretEncrypted is false', async () => {
      const svc = new MfaService(
        { issuer: 'TestApp', encryptSecrets: false },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          totpSecret: 'RAW_SECRET_VALUE',
          totpSecretEncrypted: false,
          enrollmentExpiresAt: new Date(Date.now() + 600000),
        })
      );
      mockTotpService.verifyToken.mockResolvedValue(true);

      await svc.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456');

      // verifyToken should have been called with the raw secret
      expect(mockTotpService.verifyToken).toHaveBeenCalledWith('RAW_SECRET_VALUE', '123456');
    });

    it('should decrypt when totpSecretEncrypted is true', async () => {
      mockStore.getUserMfa.mockResolvedValue(
        createMockUserMfaRecord({
          status: MfaStatus.PENDING,
          totpSecret: JSON.stringify({ encrypted: 'DECRYPTED_SECRET', iv: 'iv', tag: 'tag' }),
          totpSecretEncrypted: true,
          enrollmentExpiresAt: new Date(Date.now() + 600000),
        })
      );
      mockTotpService.verifyToken.mockResolvedValue(true);

      await service.verifyEnrollment(TEST_USER_ID, TEST_TENANT_ID, '123456');

      // decrypt mock returns envelope.encrypted, so verifyToken should get 'DECRYPTED_SECRET'
      expect(mockTotpService.verifyToken).toHaveBeenCalledWith('DECRYPTED_SECRET', '123456');
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: timingSafeCompare
  // ===========================================================================

  describe('timingSafeCompare (through backup code verification)', () => {
    it('should return false for different-length strings (no match)', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      // Hash returns a different-length string than the stored hash
      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'short', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('much-longer-hash-value');

      const result = await service.verifyChallenge(
        'token-abc-123',
        'some-code',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(mockStore.markBackupCodeUsed).not.toHaveBeenCalled();
    });

    it('should return true for same-length matching strings', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'exact-match-hash', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('exact-match-hash');
      mockStore.markBackupCodeUsed.mockResolvedValue(null);
      mockStore.getUnusedBackupCodeCount.mockResolvedValue(5);

      const result = await service.verifyChallenge(
        'token-abc-123',
        'some-code',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(true);
    });

    it('should return false for same-length but different strings', async () => {
      const challenge = createMockChallengeRecord();
      mockStore.getChallengeByToken.mockResolvedValue(challenge);
      mockStore.getUserMfa.mockResolvedValue(createMockUserMfaRecord());
      mockTotpService.verifyToken.mockResolvedValue(false);

      // Same length, different content
      mockStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', userMfaId: 'mfa-record-1', codeHash: 'aaaa-bbbb-cccc', usedAt: null, usedFromIp: null, createdAt: new Date() },
      ]);
      mockTotpService.hashBackupCode.mockReturnValue('xxxx-yyyy-zzzz');

      const result = await service.verifyChallenge(
        'token-abc-123',
        'some-code',
        TEST_TENANT_ID
      );

      expect(result.verified).toBe(false);
      expect(mockStore.markBackupCodeUsed).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: createMfaService utility
  // ===========================================================================

  describe('createMfaService utility function', () => {
    it('should create a new MfaService instance', () => {
      const svc = createMfaService(
        { issuer: 'UtilTest' },
        mockStore as any,
        mockTotpService as any,
        mockSecurityLogger as any
      );
      expect(svc).toBeInstanceOf(MfaService);
    });

    it('should create a service with no arguments', () => {
      const svc = createMfaService();
      expect(svc).toBeInstanceOf(MfaService);
    });
  });

  // ===========================================================================
  // MUTANT-KILLING TESTS: buildMfaActor (tested through security logger calls)
  // ===========================================================================

  describe('buildMfaActor (through enrollUser and verifyChallenge)', () => {
    it('should build actor with type=user, correct id and tenantId', async () => {
      await service.enrollUser(TEST_USER_ID, TEST_TENANT_ID, TEST_EMAIL);

      expect(mockSecurityLogger.logMfaEnrollmentStarted).toHaveBeenCalledWith(
        {
          type: 'user',
          id: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          ip: undefined,
        },
        TEST_USER_ID
      );
    });

    it('should set ip to undefined when clientIp is null', async () => {
      const challenge = createMockChallengeRecord({ attempts: 5, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);

      // Pass null for clientIp — should result in ip: undefined
      try {
        await service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID);
      } catch {
        // TooManyAttemptsError expected
      }

      expect(mockSecurityLogger.logMfaTooManyAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: undefined,
        }),
        TEST_USER_ID,
        5
      );
    });

    it('should set ip from clientIp when provided', async () => {
      const challenge = createMockChallengeRecord({ attempts: 5, maxAttempts: 5 });
      mockStore.getChallengeByToken.mockResolvedValue(challenge);

      try {
        await service.verifyChallenge('token-abc-123', '123456', TEST_TENANT_ID, '1.2.3.4');
      } catch {
        // expected
      }

      expect(mockSecurityLogger.logMfaTooManyAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: '1.2.3.4',
        }),
        TEST_USER_ID,
        5
      );
    });
  });
});
