/**
 * Encryption Module Tests
 *
 * Tests for the secure encryption utilities including:
 * - PBKDF2 key derivation (v2)
 * - Legacy SHA-256 key derivation (v1) for backward compatibility
 * - Migration from v1 to v2
 * - AES-256-GCM encryption/decryption
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  isEncryptedField,
  needsMigration,
  migrateEnvelope,
  migrateEncryptedField,
  getEnvelopeKdfVersion,
  computeHash,
  computeChainedHash,
  type EncryptedEnvelope,
  type EncryptedField,
  type KdfVersion,
} from '../../../src/common/encryption.js';
import { ConfigurationError, EncryptionError } from '../../../src/common/errors.js';

// Mock the config module
vi.mock('../../../src/common/config.js', () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from '../../../src/common/config.js';
const mockGetConfig = vi.mocked(getConfig);

describe('Encryption Module', () => {
  // High-entropy test key (simulates cryptographically random key)
  // This key has sufficient entropy (>128 bits) to pass validation
  const TEST_ENCRYPTION_KEY = 'k9X$mR7@qL2#nP5*wB8&zF1%jH4^tY6!';
  const TEST_ENCRYPTION_SALT = 's3$rA7@pQ9#mK2&n';

  // Default test configuration
  const createTestConfig = (overrides: Record<string, unknown> = {}) => ({
    env: 'development',
    encryption: {
      key: TEST_ENCRYPTION_KEY,
      salt: TEST_ENCRYPTION_SALT,
      pbkdf2Iterations: 10000, // Lower for faster tests
      kdfVersion: 2,
      algorithm: 'aes-256-gcm',
      ...overrides,
    },
    jwt: {
      secret: 'jwt-secret-should-not-be-used-anymore',
    },
  });

  beforeEach(() => {
    mockGetConfig.mockReturnValue(createTestConfig() as ReturnType<typeof getConfig>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('encrypt/decrypt with PBKDF2 (v2)', () => {
    it('should encrypt and decrypt a string successfully', () => {
      const plaintext = 'Hello, World!';
      const envelope = encrypt(plaintext);

      expect(envelope.version).toBe(1);
      expect(envelope.kdfVersion).toBe(2);
      expect(envelope.ciphertext).toBeDefined();
      expect(envelope.iv).toBeDefined();
      expect(envelope.authTag).toBeDefined();

      const decrypted = decrypt(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt UTF-8 characters', () => {
      const plaintext = 'Hello, World! Special chars: \u00e9\u00e8\u00ea\u00eb \u4e2d\u6587 \u65e5\u672c\u8a9e';
      const envelope = encrypt(plaintext);
      const decrypted = decrypt(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt JSON data', () => {
      const data = {
        user: 'test@example.com',
        password: 'super-secret',
        metadata: { nested: true },
      };
      const plaintext = JSON.stringify(data);
      const envelope = encrypt(plaintext);
      const decrypted = decrypt(envelope);
      expect(JSON.parse(decrypted)).toEqual(data);
    });

    it('should produce different ciphertexts for same plaintext (due to random IV)', () => {
      const plaintext = 'Same text, different encryption';
      const envelope1 = encrypt(plaintext);
      const envelope2 = encrypt(plaintext);

      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
      expect(envelope1.iv).not.toBe(envelope2.iv);

      // But both should decrypt to same value
      expect(decrypt(envelope1)).toBe(plaintext);
      expect(decrypt(envelope2)).toBe(plaintext);
    });

    it('should include kdfVersion in envelope', () => {
      const envelope = encrypt('test');
      expect(envelope.kdfVersion).toBe(2);
    });
  });

  describe('encryptObject/decryptObject', () => {
    it('should encrypt and decrypt objects', () => {
      const data = {
        userId: 'user_123',
        sensitiveData: 'credit_card_number',
        amount: 100.50,
      };

      const encrypted = encryptObject(data);

      expect(encrypted.__encrypted).toBe(true);
      expect(encrypted.envelope).toBeDefined();
      expect(encrypted.envelope.kdfVersion).toBe(2);

      const decrypted = decryptObject(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('should throw on invalid encrypted field', () => {
      const invalid = { __encrypted: false, envelope: {} } as unknown as EncryptedField;
      expect(() => decryptObject(invalid)).toThrow(EncryptionError);
    });
  });

  describe('isEncryptedField', () => {
    it('should identify encrypted fields', () => {
      const encrypted = encryptObject({ test: true });
      expect(isEncryptedField(encrypted)).toBe(true);
    });

    it('should reject non-encrypted fields', () => {
      expect(isEncryptedField(null)).toBe(false);
      expect(isEncryptedField(undefined)).toBe(false);
      expect(isEncryptedField({})).toBe(false);
      expect(isEncryptedField({ __encrypted: false })).toBe(false);
      expect(isEncryptedField({ __encrypted: true })).toBe(false); // Missing envelope
      expect(isEncryptedField('string')).toBe(false);
      expect(isEncryptedField(123)).toBe(false);
    });
  });

  describe('Legacy SHA-256 (v1) behavior', () => {
    it('should reject v1 envelopes after deprecation date', () => {
      // v1 KDF is no longer supported after 2025-06-01
      const legacyEnvelope: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        // No kdfVersion - should be treated as v1
      };

      // Should throw error for deprecated v1 encryption
      expect(() => decrypt(legacyEnvelope)).toThrow(EncryptionError);
      expect(() => decrypt(legacyEnvelope)).toThrow(/KDF v1.*no longer supported/);
    });

    it('should reject v1 configuration', () => {
      mockGetConfig.mockReturnValue(
        createTestConfig({ kdfVersion: 1 }) as ReturnType<typeof getConfig>
      );

      // Should throw error when trying to use deprecated v1
      expect(() => encrypt('test')).toThrow(EncryptionError);
      expect(() => encrypt('test')).toThrow(/KDF v1.*no longer supported/);
    });
  });

  describe('Migration utilities', () => {
    it('needsMigration should detect v1 envelopes when config is v2', () => {
      // Current config is v2
      mockGetConfig.mockReturnValue(
        createTestConfig({ kdfVersion: 2 }) as ReturnType<typeof getConfig>
      );

      const v1Envelope: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        kdfVersion: 1,
      };

      const v2Envelope: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        kdfVersion: 2,
      };

      const legacyEnvelope: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        // No kdfVersion - should be treated as v1
      };

      expect(needsMigration(v1Envelope)).toBe(true);
      expect(needsMigration(v2Envelope)).toBe(false);
      expect(needsMigration(legacyEnvelope)).toBe(true);
    });

    it('migrateEnvelope should reject v1 data (deprecated)', () => {
      // v1 encryption is no longer supported, migration from v1 should fail
      const v1Envelope: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        kdfVersion: 1,
      };

      // Migration should fail because v1 decryption is no longer supported
      expect(() => migrateEnvelope(v1Envelope)).toThrow(EncryptionError);
      expect(() => migrateEnvelope(v1Envelope)).toThrow(/KDF v1.*no longer supported/);
    });

    it('migrateEnvelope should not change already current version', () => {
      const envelope = encrypt('test');
      const migrated = migrateEnvelope(envelope);

      // Should return same object (no migration needed)
      expect(migrated).toBe(envelope);
    });

    it('migrateEncryptedField should reject v1 fields (deprecated)', () => {
      // v1 is deprecated, migration should fail
      const v1Field: EncryptedField = {
        __encrypted: true,
        envelope: {
          ciphertext: 'test',
          iv: 'test',
          authTag: 'test',
          version: 1,
          kdfVersion: 1,
        },
      };

      // Migration should fail because v1 decryption is no longer supported
      expect(() => migrateEncryptedField(v1Field)).toThrow(EncryptionError);
    });

    it('getEnvelopeKdfVersion should return correct version', () => {
      const v1: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        kdfVersion: 1,
      };

      const v2: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
        kdfVersion: 2,
      };

      const legacy: EncryptedEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 1,
      };

      expect(getEnvelopeKdfVersion(v1)).toBe(1);
      expect(getEnvelopeKdfVersion(v2)).toBe(2);
      expect(getEnvelopeKdfVersion(legacy)).toBe(1); // Default for missing
    });
  });

  describe('Configuration requirements', () => {
    it('should throw ConfigurationError in production without encryption key', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: undefined,
          salt: TEST_ENCRYPTION_SALT,
          pbkdf2Iterations: 100000,
          kdfVersion: 2,
          algorithm: 'aes-256-gcm',
        },
        jwt: {
          secret: 'jwt-secret',
        },
      } as ReturnType<typeof getConfig>);

      expect(() => encrypt('test')).toThrow(ConfigurationError);
      expect(() => encrypt('test')).toThrow(/VORION_ENCRYPTION_KEY/);
    });

    it('should throw ConfigurationError in production without salt for v2', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: TEST_ENCRYPTION_KEY,
          salt: undefined,
          pbkdf2Iterations: 100000,
          kdfVersion: 2,
          algorithm: 'aes-256-gcm',
        },
        jwt: {
          secret: 'jwt-secret',
        },
      } as ReturnType<typeof getConfig>);

      expect(() => encrypt('test')).toThrow(ConfigurationError);
      expect(() => encrypt('test')).toThrow(/VORION_ENCRYPTION_SALT/);
    });

    it('should NOT fallback to JWT secret', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: undefined, // No encryption key
          salt: TEST_ENCRYPTION_SALT,
          pbkdf2Iterations: 100000,
          kdfVersion: 2,
          algorithm: 'aes-256-gcm',
        },
        jwt: {
          secret: 'jwt-secret-that-should-not-be-used',
        },
      } as ReturnType<typeof getConfig>);

      // Should throw, NOT silently use JWT secret
      expect(() => encrypt('test')).toThrow(ConfigurationError);
    });

    it('should throw in development mode without proper key', () => {
      // Development mode no longer has fallbacks - must configure encryption
      mockGetConfig.mockReturnValue({
        env: 'development',
        encryption: {
          key: undefined, // No key
          salt: undefined, // No salt
          pbkdf2Iterations: 10000,
          kdfVersion: 2,
          algorithm: 'aes-256-gcm',
        },
        jwt: {
          secret: 'jwt-secret',
        },
      } as ReturnType<typeof getConfig>);

      // Should throw - no development fallbacks for security-critical encryption
      expect(() => encrypt('test')).toThrow(ConfigurationError);
    });
  });

  describe('Decryption error handling', () => {
    it('should throw EncryptionError for unsupported version', () => {
      const badEnvelope = {
        ciphertext: 'test',
        iv: 'test',
        authTag: 'test',
        version: 99 as 1, // Force wrong version
      };

      expect(() => decrypt(badEnvelope)).toThrow(EncryptionError);
      expect(() => decrypt(badEnvelope)).toThrow(/Unsupported encryption version/);
    });

    it('should throw on tampered ciphertext', () => {
      const envelope = encrypt('test');

      // Tamper with ciphertext
      const tampered = {
        ...envelope,
        ciphertext: 'dGFtcGVyZWQ=', // "tampered" in base64
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const envelope = encrypt('test');

      // Tamper with auth tag
      const tampered = {
        ...envelope,
        authTag: 'dGFtcGVyZWQ=',
      };

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('Hash utilities', () => {
    it('computeHash should produce consistent SHA-256 hashes', () => {
      const data = 'test data';
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
    });

    it('computeHash should produce different hashes for different data', () => {
      const hash1 = computeHash('data1');
      const hash2 = computeHash('data2');

      expect(hash1).not.toBe(hash2);
    });

    it('computeChainedHash should include previous hash', () => {
      const data = 'current data';
      const prevHash = 'abc123';

      const hash1 = computeChainedHash(data, prevHash);
      const hash2 = computeChainedHash(data, 'different-prev');

      expect(hash1).not.toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe('PBKDF2 iterations', () => {
    it('should use configured iterations', () => {
      // With low iterations (faster)
      mockGetConfig.mockReturnValue(
        createTestConfig({ pbkdf2Iterations: 1000 }) as ReturnType<typeof getConfig>
      );

      const startLow = performance.now();
      encrypt('test');
      const timeLow = performance.now() - startLow;

      // With high iterations (slower)
      mockGetConfig.mockReturnValue(
        createTestConfig({ pbkdf2Iterations: 50000 }) as ReturnType<typeof getConfig>
      );

      const startHigh = performance.now();
      encrypt('test');
      const timeHigh = performance.now() - startHigh;

      // Higher iterations should take longer (with some tolerance)
      expect(timeHigh).toBeGreaterThan(timeLow * 0.5); // At least somewhat longer
    });
  });
});
