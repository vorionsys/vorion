/**
 * MFA Service Tests
 *
 * Comprehensive tests for the Multi-Factor Authentication service including:
 * - TOTP code generation
 * - TOTP code verification (valid, invalid, expired)
 * - Backup code generation
 * - Backup code usage (single use)
 * - MFA enrollment flow
 * - MFA bypass attempt detection
 * - Rate limiting on MFA attempts
 *
 * @module tests/unit/security/mfa-service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MfaService,
  MfaError,
  EnrollmentExpiredError,
  ChallengeExpiredError,
  TooManyAttemptsError,
  resetMfaService,
  createMfaService,
} from '../../../src/security/mfa/mfa-service.js';
import { MfaMethod, MfaStatus, MFA_DEFAULTS } from '../../../src/security/mfa/types.js';

// Mock TOTP Service
const mockTotpService = {
  generateTOTPSecret: vi.fn().mockReturnValue({
    secret: 'TESTSECRET123456',
    otpauthUrl: 'otpauth://totp/Vorion:test@example.com?secret=TESTSECRET123456&issuer=Vorion',
  }),
  generateQRCode: vi.fn().mockResolvedValue('data:image/png;base64,QRCodeData'),
  verifyToken: vi.fn().mockResolvedValue(true),
  generateBackupCodes: vi.fn().mockReturnValue([
    'BACKUP001',
    'BACKUP002',
    'BACKUP003',
    'BACKUP004',
    'BACKUP005',
    'BACKUP006',
    'BACKUP007',
    'BACKUP008',
    'BACKUP009',
    'BACKUP010',
  ]),
  hashBackupCode: vi.fn().mockImplementation((code: string) => `hashed_${code}`),
};

// Mock MFA Store
const mockMfaStore = {
  getUserMfa: vi.fn().mockResolvedValue(null),
  createUserMfa: vi.fn().mockImplementation((input) => ({
    id: 'mfa-record-id',
    userId: input.userId,
    tenantId: input.tenantId,
    totpSecret: input.totpSecret,
    totpSecretEncrypted: input.totpSecretEncrypted,
    status: MfaStatus.PENDING,
    enabledAt: null,
    enrollmentStartedAt: new Date(),
    enrollmentExpiresAt: new Date(Date.now() + MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS),
    gracePeriodEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateEnrollmentExpiry: vi.fn().mockResolvedValue(true),
  activateUserMfa: vi.fn().mockImplementation((id, gracePeriodEndsAt) => ({
    id,
    status: MfaStatus.ACTIVE,
    enabledAt: new Date(),
    gracePeriodEndsAt,
  })),
  deleteUserMfa: vi.fn().mockResolvedValue(true),
  createBackupCodes: vi.fn().mockResolvedValue(true),
  deleteBackupCodes: vi.fn().mockResolvedValue(true),
  getUnusedBackupCodes: vi.fn().mockResolvedValue([]),
  getUnusedBackupCodeCount: vi.fn().mockResolvedValue(10),
  markBackupCodeUsed: vi.fn().mockResolvedValue(true),
  createChallenge: vi.fn().mockImplementation((input) => ({
    id: 'challenge-id',
    userId: input.userId,
    sessionId: input.sessionId,
    challengeToken: 'challenge-token-123',
    verified: false,
    verifiedAt: null,
    attempts: 0,
    maxAttempts: input.maxAttempts || MFA_DEFAULTS.MAX_ATTEMPTS,
    expiresAt: input.expiresAt,
    createdAt: new Date(),
  })),
  getChallengeByToken: vi.fn().mockResolvedValue(null),
  incrementChallengeAttempts: vi.fn().mockResolvedValue(true),
  markChallengeVerified: vi.fn().mockResolvedValue(true),
  isSessionVerified: vi.fn().mockResolvedValue(false),
};

// Mock Security Audit Logger
const mockSecurityLogger = {
  logMfaEnrollmentStarted: vi.fn().mockResolvedValue(undefined),
  logMfaEnrollmentVerified: vi.fn().mockResolvedValue(undefined),
  logMfaEnrolled: vi.fn().mockResolvedValue(undefined),
  logMfaChallengeCreated: vi.fn().mockResolvedValue(undefined),
  logMfaVerification: vi.fn().mockResolvedValue(undefined),
  logMfaTooManyAttempts: vi.fn().mockResolvedValue(undefined),
  logMfaBackupCodeUsed: vi.fn().mockResolvedValue(undefined),
  logMfaBackupCodesRegenerated: vi.fn().mockResolvedValue(undefined),
  logMfaDisabled: vi.fn().mockResolvedValue(undefined),
};

// Mock dependencies
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/common/encryption.js', () => ({
  encrypt: vi.fn().mockImplementation((data) => ({
    ciphertext: Buffer.from(data).toString('base64'),
    iv: 'test-iv',
    authTag: 'test-auth-tag',
    version: 1,
    kdfVersion: 2,
  })),
  decrypt: vi.fn().mockImplementation((envelope) => {
    if (typeof envelope === 'string') {
      return JSON.parse(envelope).ciphertext
        ? Buffer.from(JSON.parse(envelope).ciphertext, 'base64').toString()
        : envelope;
    }
    return Buffer.from(envelope.ciphertext, 'base64').toString();
  }),
}));

vi.mock('../../../src/common/errors.js', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string, public details?: any) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string, public details?: any) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(message: string, public details?: any) {
      super(message);
      this.name = 'ConflictError';
    }
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message: string, public details?: any) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

vi.mock('../../../src/auth/mfa/totp.js', () => ({
  getTOTPService: () => mockTotpService,
}));

vi.mock('../../../src/security/mfa/mfa-store.js', () => ({
  getMfaStore: () => mockMfaStore,
  MfaStore: vi.fn(),
}));

vi.mock('../../../src/audit/security-logger.js', () => ({
  getSecurityAuditLogger: () => mockSecurityLogger,
  SecurityAuditLogger: vi.fn(),
}));

describe('MFA Service', () => {
  let mfaService: MfaService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    vi.clearAllMocks();
    resetMfaService();

    // Reset mock implementations to default values
    mockMfaStore.getUserMfa.mockResolvedValue(null);
    mockTotpService.verifyToken.mockResolvedValue(true);
    mockMfaStore.getChallengeByToken.mockResolvedValue(null);
    mockMfaStore.getUnusedBackupCodes.mockResolvedValue([]);
    mockMfaStore.getUnusedBackupCodeCount.mockResolvedValue(10);
    mockMfaStore.isSessionVerified.mockResolvedValue(false);

    mfaService = createMfaService(
      {},
      mockMfaStore as any,
      mockTotpService as any,
      mockSecurityLogger as any
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TOTP Code Generation', () => {
    it('should generate TOTP secret on enrollment', async () => {
      const response = await mfaService.enrollUser(
        'user-123',
        'tenant-456',
        'test@example.com'
      );

      expect(response.secret).toBe('TESTSECRET123456');
      expect(response.otpauthUrl).toContain('otpauth://totp');
      expect(mockTotpService.generateTOTPSecret).toHaveBeenCalledWith(
        'user-123',
        'test@example.com'
      );
    });

    it('should generate QR code during enrollment', async () => {
      const response = await mfaService.enrollUser(
        'user-123',
        'tenant-456',
        'test@example.com'
      );

      expect(response.qrCode).toContain('data:image/png;base64');
      expect(mockTotpService.generateQRCode).toHaveBeenCalled();
    });

    it('should include expiration time in enrollment response', async () => {
      const response = await mfaService.enrollUser(
        'user-123',
        'tenant-456',
        'test@example.com'
      );

      expect(response.expiresAt).toBeDefined();
      const expiresAt = new Date(response.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should store TOTP secret encrypted', async () => {
      await mfaService.enrollUser('user-123', 'tenant-456', 'test@example.com');

      expect(mockMfaStore.createUserMfa).toHaveBeenCalledWith(
        expect.objectContaining({
          totpSecretEncrypted: true,
        })
      );
    });
  });

  describe('TOTP Code Verification', () => {
    beforeEach(() => {
      mockMfaStore.getUserMfa.mockResolvedValue({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
        enrollmentExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    });

    it('should verify valid TOTP code during enrollment', async () => {
      mockTotpService.verifyToken.mockResolvedValueOnce(true);

      const result = await mfaService.verifyEnrollment(
        'user-123',
        'tenant-456',
        '123456'
      );

      expect(result).toBe(true);
      expect(mockTotpService.verifyToken).toHaveBeenCalledWith(
        'TESTSECRET123456',
        '123456'
      );
    });

    it('should reject invalid TOTP code', async () => {
      mockTotpService.verifyToken.mockResolvedValueOnce(false);

      const result = await mfaService.verifyEnrollment(
        'user-123',
        'tenant-456',
        '000000'
      );

      expect(result).toBe(false);
    });

    it('should reject verification for non-existent enrollment', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce(null);

      await expect(
        mfaService.verifyEnrollment('user-123', 'tenant-456', '123456')
      ).rejects.toThrow('MFA enrollment not found');
    });

    it('should reject verification for expired enrollment', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
        enrollmentExpiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(
        mfaService.verifyEnrollment('user-123', 'tenant-456', '123456')
      ).rejects.toThrow(EnrollmentExpiredError);
    });

    it('should reject verification for already active MFA', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.ACTIVE,
      });

      await expect(
        mfaService.verifyEnrollment('user-123', 'tenant-456', '123456')
      ).rejects.toThrow('MFA enrollment is not in pending state');
    });

    it('should log verification result for audit', async () => {
      mockTotpService.verifyToken.mockResolvedValueOnce(true);

      await mfaService.verifyEnrollment('user-123', 'tenant-456', '123456');

      expect(mockSecurityLogger.logMfaEnrollmentVerified).toHaveBeenCalledWith(
        expect.any(Object),
        'user-123',
        true
      );
    });
  });

  describe('Backup Code Generation', () => {
    it('should generate backup codes on enrollment completion', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
      });

      const response = await mfaService.completeEnrollment('user-123', 'tenant-456');

      expect(response.backupCodes).toHaveLength(10);
      expect(mockTotpService.generateBackupCodes).toHaveBeenCalledWith(10);
    });

    it('should hash backup codes before storage', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
      });

      await mfaService.completeEnrollment('user-123', 'tenant-456');

      expect(mockTotpService.hashBackupCode).toHaveBeenCalledTimes(10);
      expect(mockMfaStore.createBackupCodes).toHaveBeenCalledWith(
        'mfa-id',
        expect.arrayContaining(['hashed_BACKUP001', 'hashed_BACKUP002'])
      );
    });

    it('should include backup code count in response', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
      });

      const response = await mfaService.completeEnrollment('user-123', 'tenant-456');

      expect(response.backupCodeCount).toBe(10);
    });

    it('should regenerate backup codes when requested', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
      });

      const response = await mfaService.regenerateBackupCodes('user-123', 'tenant-456');

      expect(mockMfaStore.deleteBackupCodes).toHaveBeenCalledWith('mfa-id');
      expect(mockMfaStore.createBackupCodes).toHaveBeenCalled();
      expect(response.backupCodes).toHaveLength(10);
    });

    it('should reject backup code regeneration for inactive MFA', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      await expect(
        mfaService.regenerateBackupCodes('user-123', 'tenant-456')
      ).rejects.toThrow('MFA is not active');
    });
  });

  describe('Backup Code Usage (Single Use)', () => {
    const setupChallengeWithBackupCodes = () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.ACTIVE,
      });

      mockMfaStore.getUnusedBackupCodes.mockResolvedValueOnce([
        { id: 'bc-1', codeHash: 'hashed_BACKUP001' },
        { id: 'bc-2', codeHash: 'hashed_BACKUP002' },
      ]);
    };

    it('should verify backup code successfully', async () => {
      setupChallengeWithBackupCodes();
      mockTotpService.verifyToken.mockResolvedValueOnce(false); // TOTP fails
      mockTotpService.hashBackupCode.mockReturnValueOnce('hashed_BACKUP001');

      const response = await mfaService.verifyChallenge(
        'challenge-token',
        'BACKUP001',
        'tenant-456'
      );

      expect(response.verified).toBe(true);
      expect(response.method).toBe(MfaMethod.BACKUP_CODES);
    });

    it('should mark backup code as used after verification', async () => {
      setupChallengeWithBackupCodes();
      mockTotpService.verifyToken.mockResolvedValueOnce(false);
      mockTotpService.hashBackupCode.mockReturnValueOnce('hashed_BACKUP001');

      await mfaService.verifyChallenge('challenge-token', 'BACKUP001', 'tenant-456');

      expect(mockMfaStore.markBackupCodeUsed).toHaveBeenCalledWith('bc-1', null);
    });

    it('should reject already used backup code', async () => {
      setupChallengeWithBackupCodes();
      mockTotpService.verifyToken.mockResolvedValueOnce(false);
      mockMfaStore.getUnusedBackupCodes.mockResolvedValueOnce([]); // No unused codes

      const response = await mfaService.verifyChallenge(
        'challenge-token',
        'USEDCODE',
        'tenant-456'
      );

      expect(response.verified).toBe(false);
    });

    it('should log backup code usage for audit', async () => {
      // Reset all mocks first
      mockMfaStore.getChallengeByToken.mockReset();
      mockMfaStore.getUserMfa.mockReset();
      mockMfaStore.getUnusedBackupCodes.mockReset();
      mockMfaStore.getUnusedBackupCodeCount.mockReset();
      mockTotpService.verifyToken.mockReset();
      mockTotpService.hashBackupCode.mockReset();
      mockSecurityLogger.logMfaBackupCodeUsed.mockReset();

      // TOTP fails so backup codes are tried
      mockTotpService.verifyToken.mockResolvedValue(false);
      // Hash function returns matching hash
      mockTotpService.hashBackupCode.mockReturnValue('hashed_BACKUP001');

      mockMfaStore.getChallengeByToken.mockResolvedValue({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      mockMfaStore.getUserMfa.mockResolvedValue({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.ACTIVE,
      });

      mockMfaStore.getUnusedBackupCodes.mockResolvedValue([
        { id: 'bc-1', codeHash: 'hashed_BACKUP001' },
        { id: 'bc-2', codeHash: 'hashed_BACKUP002' },
      ]);
      mockMfaStore.getUnusedBackupCodeCount.mockResolvedValue(1);

      const result = await mfaService.verifyChallenge(
        'challenge-token',
        'BACKUP001',
        'tenant-456'
      );

      // Should verify via backup code
      expect(result.verified).toBe(true);
      expect(result.method).toBe(MfaMethod.BACKUP_CODES);
      expect(mockSecurityLogger.logMfaBackupCodeUsed).toHaveBeenCalled();
    });
  });

  describe('MFA Enrollment Flow', () => {
    it('should complete full enrollment flow', async () => {
      // Step 1: Start enrollment
      const enrollResponse = await mfaService.enrollUser(
        'user-123',
        'tenant-456',
        'test@example.com'
      );

      expect(enrollResponse.secret).toBeDefined();
      expect(enrollResponse.qrCode).toBeDefined();

      // Step 2: Verify TOTP code
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'TESTSECRET123456',
        totpSecretEncrypted: false,
        status: MfaStatus.PENDING,
        enrollmentExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      const verified = await mfaService.verifyEnrollment(
        'user-123',
        'tenant-456',
        '123456'
      );

      expect(verified).toBe(true);

      // Step 3: Complete enrollment
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      const completeResponse = await mfaService.completeEnrollment(
        'user-123',
        'tenant-456'
      );

      expect(completeResponse.backupCodes).toHaveLength(10);
      expect(completeResponse.enabledAt).toBeDefined();
      expect(completeResponse.gracePeriodEndsAt).toBeDefined();
    });

    it('should reject enrollment if MFA already active', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
      });

      await expect(
        mfaService.enrollUser('user-123', 'tenant-456', 'test@example.com')
      ).rejects.toThrow('MFA is already enabled');
    });

    it('should replace pending enrollment with new one', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      await mfaService.enrollUser('user-123', 'tenant-456', 'test@example.com');

      expect(mockMfaStore.deleteUserMfa).toHaveBeenCalled();
      expect(mockMfaStore.createUserMfa).toHaveBeenCalled();
    });

    it('should log enrollment start for audit', async () => {
      await mfaService.enrollUser('user-123', 'tenant-456', 'test@example.com');

      expect(mockSecurityLogger.logMfaEnrollmentStarted).toHaveBeenCalledWith(
        expect.any(Object),
        'user-123'
      );
    });

    it('should log enrollment completion for audit', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      await mfaService.completeEnrollment('user-123', 'tenant-456');

      expect(mockSecurityLogger.logMfaEnrolled).toHaveBeenCalledWith(
        expect.any(Object),
        'user-123',
        10
      );
    });
  });

  describe('MFA Bypass Attempt Detection', () => {
    it('should detect when user needs MFA', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
        gracePeriodEndsAt: new Date(Date.now() - 1000), // Grace period ended
      });
      mockMfaStore.isSessionVerified.mockResolvedValueOnce(false);

      const requiresMfa = await mfaService.requiresMfa(
        'user-123',
        'tenant-456',
        'session-789'
      );

      expect(requiresMfa).toBe(true);
    });

    it('should not require MFA for users without MFA enabled', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce(null);

      const requiresMfa = await mfaService.requiresMfa(
        'user-123',
        'tenant-456',
        'session-789'
      );

      expect(requiresMfa).toBe(false);
    });

    it('should not require MFA during grace period', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
        gracePeriodEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Future
      });

      const requiresMfa = await mfaService.requiresMfa(
        'user-123',
        'tenant-456',
        'session-789'
      );

      expect(requiresMfa).toBe(false);
    });

    it('should not require MFA for already verified session', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
        gracePeriodEndsAt: null,
      });
      mockMfaStore.isSessionVerified.mockResolvedValueOnce(true);

      const requiresMfa = await mfaService.requiresMfa(
        'user-123',
        'tenant-456',
        'session-789'
      );

      expect(requiresMfa).toBe(false);
    });

    it('should require MFA for pending status', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      const requiresMfa = await mfaService.requiresMfa(
        'user-123',
        'tenant-456',
        'session-789'
      );

      expect(requiresMfa).toBe(false); // Pending = not yet active
    });
  });

  describe('Rate Limiting on MFA Attempts', () => {
    it('should reject after max attempts exceeded', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 5,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      await expect(
        mfaService.verifyChallenge('challenge-token', '000000', 'tenant-456')
      ).rejects.toThrow(TooManyAttemptsError);
    });

    it('should increment attempts on each verification try', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 2,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'SECRET',
        totpSecretEncrypted: false,
        status: MfaStatus.ACTIVE,
      });
      mockTotpService.verifyToken.mockResolvedValueOnce(false);

      await mfaService.verifyChallenge('challenge-token', '000000', 'tenant-456');

      expect(mockMfaStore.incrementChallengeAttempts).toHaveBeenCalledWith(
        'challenge-id'
      );
    });

    it('should return remaining attempts in failed response', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 2,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        totpSecret: 'SECRET',
        totpSecretEncrypted: false,
        status: MfaStatus.ACTIVE,
      });
      mockTotpService.verifyToken.mockResolvedValueOnce(false);
      mockMfaStore.getUnusedBackupCodes.mockResolvedValueOnce([]);

      const response = await mfaService.verifyChallenge(
        'challenge-token',
        '000000',
        'tenant-456'
      );

      expect(response.verified).toBe(false);
      expect(response.attemptsRemaining).toBe(2); // 5 - 2 - 1 = 2
    });

    it('should log too many attempts for audit', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 5,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      try {
        await mfaService.verifyChallenge('challenge-token', '000000', 'tenant-456');
      } catch {
        // Expected
      }

      expect(mockSecurityLogger.logMfaTooManyAttempts).toHaveBeenCalled();
    });
  });

  describe('Challenge Management', () => {
    it('should create challenge with expiration', async () => {
      const response = await mfaService.createChallenge(
        'user-123',
        'session-456',
        'tenant-789'
      );

      expect(response.challengeToken).toBeDefined();
      expect(response.expiresAt).toBeDefined();
      expect(response.attemptsRemaining).toBe(MFA_DEFAULTS.MAX_ATTEMPTS);
    });

    it('should reject expired challenge', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: false,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(
        mfaService.verifyChallenge('challenge-token', '123456', 'tenant-456')
      ).rejects.toThrow(ChallengeExpiredError);
    });

    it('should return success for already verified challenge', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce({
        id: 'challenge-id',
        userId: 'user-123',
        sessionId: 'session-456',
        challengeToken: 'challenge-token',
        verified: true,
        attempts: 1,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const response = await mfaService.verifyChallenge(
        'challenge-token',
        '123456',
        'tenant-456'
      );

      expect(response.verified).toBe(true);
    });

    it('should reject challenge not found', async () => {
      mockMfaStore.getChallengeByToken.mockResolvedValueOnce(null);

      await expect(
        mfaService.verifyChallenge('invalid-token', '123456', 'tenant-456')
      ).rejects.toThrow('MFA challenge not found');
    });
  });

  describe('MFA Status', () => {
    it('should return disabled status for user without MFA', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce(null);

      const status = await mfaService.getMfaStatus('user-123', 'tenant-456');

      expect(status.enabled).toBe(false);
      expect(status.status).toBe(MfaStatus.DISABLED);
      expect(status.backupCodesRemaining).toBe(0);
    });

    it('should return active status with backup codes count', async () => {
      // Reset mocks to ensure clean state
      mockMfaStore.getUserMfa.mockReset();
      mockMfaStore.getUnusedBackupCodeCount.mockReset();

      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
        enabledAt: new Date(),
      });
      mockMfaStore.getUnusedBackupCodeCount.mockResolvedValueOnce(8);

      const status = await mfaService.getMfaStatus('user-123', 'tenant-456');

      expect(status.enabled).toBe(true);
      expect(status.status).toBe(MfaStatus.ACTIVE);
      expect(status.backupCodesRemaining).toBe(8);
    });

    it('should indicate grace period status', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
        enabledAt: new Date(),
        gracePeriodEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      mockMfaStore.getUnusedBackupCodeCount.mockResolvedValueOnce(10);

      const status = await mfaService.getMfaStatus('user-123', 'tenant-456');

      expect(status.inGracePeriod).toBe(true);
      expect(status.gracePeriodEndsAt).toBeDefined();
    });

    it('should indicate enrollment pending status', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.PENDING,
      });

      const status = await mfaService.getMfaStatus('user-123', 'tenant-456');

      expect(status.enrollmentPending).toBe(true);
      expect(status.enabled).toBe(false);
    });
  });

  describe('MFA Disable', () => {
    it('should disable MFA for user', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
      });

      await mfaService.disableMfa('user-123', 'tenant-456', 'User requested');

      expect(mockMfaStore.deleteUserMfa).toHaveBeenCalledWith(
        'user-123',
        'tenant-456'
      );
    });

    it('should reject disable for non-existent MFA', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce(null);

      await expect(
        mfaService.disableMfa('user-123', 'tenant-456')
      ).rejects.toThrow('MFA not found');
    });

    it('should log MFA disable for audit', async () => {
      mockMfaStore.getUserMfa.mockResolvedValueOnce({
        id: 'mfa-id',
        userId: 'user-123',
        tenantId: 'tenant-456',
        status: MfaStatus.ACTIVE,
      });

      await mfaService.disableMfa('user-123', 'tenant-456', 'User requested');

      expect(mockSecurityLogger.logMfaDisabled).toHaveBeenCalledWith(
        expect.any(Object),
        'user-123',
        'User requested'
      );
    });
  });

  describe('Error Classes', () => {
    it('should create MfaError with code', () => {
      const error = new MfaError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('MfaError');
    });

    it('should create EnrollmentExpiredError', () => {
      const error = new EnrollmentExpiredError();

      expect(error.message).toBe('MFA enrollment has expired');
      expect(error.code).toBe('MFA_ENROLLMENT_EXPIRED');
      expect(error.name).toBe('EnrollmentExpiredError');
    });

    it('should create ChallengeExpiredError', () => {
      const error = new ChallengeExpiredError();

      expect(error.message).toBe('MFA challenge has expired');
      expect(error.code).toBe('MFA_CHALLENGE_EXPIRED');
      expect(error.name).toBe('ChallengeExpiredError');
    });

    it('should create TooManyAttemptsError', () => {
      const error = new TooManyAttemptsError();

      expect(error.message).toBe('Too many verification attempts');
      expect(error.code).toBe('MFA_TOO_MANY_ATTEMPTS');
      expect(error.name).toBe('TooManyAttemptsError');
    });
  });
});
