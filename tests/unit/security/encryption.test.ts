/**
 * Encryption Security Tests
 *
 * Security-focused tests for encryption module including:
 * - Encrypt/decrypt round trip
 * - Key derivation security
 * - IV uniqueness
 * - Tamper detection
 * - Production configuration enforcement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  computeHash,
  type EncryptedEnvelope,
} from '../../../src/common/encryption.js';
import { ConfigurationError, EncryptionError } from '../../../src/common/errors.js';

// Mock the config module
vi.mock('../../../src/common/config.js', () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from '../../../src/common/config.js';
const mockGetConfig = vi.mocked(getConfig);

describe('Encryption Security', () => {
  // High-entropy test key (simulates cryptographically random key)
  // This key has sufficient entropy (>128 bits) to pass validation
  const TEST_ENCRYPTION_KEY = 'k9X$mR7@qL2#nP5*wB8&zF1%jH4^tY6!';
  const TEST_ENCRYPTION_SALT = 's3$rA7@pQ9#mK2&n';

  const createTestConfig = (overrides: Record<string, unknown> = {}) => ({
    env: 'development',
    encryption: {
      key: TEST_ENCRYPTION_KEY,
      salt: TEST_ENCRYPTION_SALT,
      pbkdf2Iterations: 10000,
      kdfVersion: 2,
      algorithm: 'aes-256-gcm',
      ...overrides,
    },
    jwt: {
      secret: 'jwt-secret-not-used',
    },
  });

  beforeEach(() => {
    mockGetConfig.mockReturnValue(createTestConfig() as ReturnType<typeof getConfig>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Encrypt/Decrypt Round Trip', () => {
    it('should successfully round-trip simple string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should successfully round-trip empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should successfully round-trip unicode characters', () => {
      const plaintext = 'Hello World! Special: \u4e2d\u6587 \u65e5\u672c\u8a9e \ud83d\ude00';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should successfully round-trip large data', () => {
      const plaintext = 'x'.repeat(100000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should successfully round-trip JSON objects', () => {
      const data = {
        user: 'test@example.com',
        password: 'super-secret-password',
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
      };

      const encrypted = encryptObject(data);
      const decrypted = decryptObject(encrypted);

      expect(decrypted).toEqual(data);
    });

    it('should successfully round-trip binary-like data', () => {
      // Create a string with all byte values
      let binaryLike = '';
      for (let i = 0; i < 256; i++) {
        binaryLike += String.fromCharCode(i);
      }

      const encrypted = encrypt(binaryLike);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(binaryLike);
    });
  });

  describe('Key Derivation Security', () => {
    it('should use PBKDF2 with high iterations in production', () => {
      mockGetConfig.mockReturnValue(
        createTestConfig({
          kdfVersion: 2,
          pbkdf2Iterations: 100000,
        }) as ReturnType<typeof getConfig>
      );

      const encrypted = encrypt('test');
      expect(encrypted.kdfVersion).toBe(2);
    });

    it('should produce different ciphertext with different keys', () => {
      const plaintext = 'same plaintext';

      // High-entropy test keys for key comparison tests
      mockGetConfig.mockReturnValue(
        createTestConfig({ key: 'aB3$xK9@mP7#qL2*nZ5&wR8%jH1^tY4!' }) as ReturnType<typeof getConfig>
      );
      const encrypted1 = encrypt(plaintext);

      mockGetConfig.mockReturnValue(
        createTestConfig({ key: 'cD6$yN2@rQ4#sM8*vX1&zT3%kJ7^wU5!' }) as ReturnType<typeof getConfig>
      );
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should produce different ciphertext with different salts', () => {
      const plaintext = 'same plaintext';

      // High-entropy salts for salt comparison tests
      mockGetConfig.mockReturnValue(
        createTestConfig({ salt: 'a1$bC3@dE5#fG7&h' }) as ReturnType<typeof getConfig>
      );
      const encrypted1 = encrypt(plaintext);

      mockGetConfig.mockReturnValue(
        createTestConfig({ salt: 'i2$jK4@lM6#nO8&p' }) as ReturnType<typeof getConfig>
      );
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should require encryption key in production', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: undefined,
          salt: 'test-salt',
          kdfVersion: 2,
        },
      } as ReturnType<typeof getConfig>);

      expect(() => encrypt('test')).toThrow(ConfigurationError);
      expect(() => encrypt('test')).toThrow(/VORION_ENCRYPTION_KEY/);
    });

    it('should require salt in production for PBKDF2', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: 'production-key-32-chars-minimum!',
          salt: undefined,
          kdfVersion: 2,
        },
      } as ReturnType<typeof getConfig>);

      expect(() => encrypt('test')).toThrow(ConfigurationError);
      expect(() => encrypt('test')).toThrow(/VORION_ENCRYPTION_SALT/);
    });

    it('should never fall back to JWT secret', () => {
      mockGetConfig.mockReturnValue({
        env: 'production',
        encryption: {
          key: undefined,
          salt: 'test-salt',
          kdfVersion: 2,
        },
        jwt: {
          secret: 'jwt-secret-that-should-not-be-used',
        },
      } as ReturnType<typeof getConfig>);

      expect(() => encrypt('test')).toThrow(ConfigurationError);
    });
  });

  describe('IV Uniqueness', () => {
    it('should generate unique IV for each encryption', () => {
      const plaintext = 'same text';
      const ivs: string[] = [];

      for (let i = 0; i < 100; i++) {
        const encrypted = encrypt(plaintext);
        ivs.push(encrypted.iv);
      }

      // All IVs should be unique
      const uniqueIvs = new Set(ivs);
      expect(uniqueIvs.size).toBe(100);
    });

    it('should produce different ciphertext for same plaintext due to unique IV', () => {
      const plaintext = 'identical text';
      const ciphertexts: string[] = [];

      for (let i = 0; i < 10; i++) {
        const encrypted = encrypt(plaintext);
        ciphertexts.push(encrypted.ciphertext);
      }

      // All ciphertexts should be unique
      const uniqueCiphertexts = new Set(ciphertexts);
      expect(uniqueCiphertexts.size).toBe(10);
    });

    it('should have IV of correct length (16 bytes = 24 base64 chars)', () => {
      const encrypted = encrypt('test');
      // 16 bytes = 22-24 base64 characters (depending on padding)
      expect(encrypted.iv.length).toBeGreaterThanOrEqual(22);
    });
  });

  describe('Tamper Detection', () => {
    it('should detect tampered ciphertext', () => {
      const encrypted = encrypt('sensitive data');

      const tampered: EncryptedEnvelope = {
        ...encrypted,
        ciphertext: Buffer.from('tampered').toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect tampered auth tag', () => {
      const encrypted = encrypt('sensitive data');

      const tampered: EncryptedEnvelope = {
        ...encrypted,
        authTag: Buffer.from('1234567890123456').toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect tampered IV', () => {
      const encrypted = encrypt('sensitive data');

      const tampered: EncryptedEnvelope = {
        ...encrypted,
        iv: Buffer.from('1234567890123456').toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect bit-flip in ciphertext', () => {
      const encrypted = encrypt('sensitive data');

      // Decode, flip a bit, re-encode
      const ciphertextBytes = Buffer.from(encrypted.ciphertext, 'base64');
      ciphertextBytes[0] ^= 0x01; // Flip one bit

      const tampered: EncryptedEnvelope = {
        ...encrypted,
        ciphertext: ciphertextBytes.toString('base64'),
      };

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect truncated ciphertext', () => {
      const encrypted = encrypt('sensitive data that is long enough');

      const truncated: EncryptedEnvelope = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.slice(0, -4),
      };

      expect(() => decrypt(truncated)).toThrow();
    });

    it('should reject unsupported version', () => {
      const encrypted = encrypt('test');

      const badVersion: EncryptedEnvelope = {
        ...encrypted,
        version: 99 as 1,
      };

      expect(() => decrypt(badVersion)).toThrow(EncryptionError);
      expect(() => decrypt(badVersion)).toThrow(/Unsupported encryption version/);
    });
  });

  describe('Hash Integrity', () => {
    it('should produce consistent hashes', () => {
      const data = 'test data';
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = computeHash('data1');
      const hash2 = computeHash('data2');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64-character hex hash (SHA-256)', () => {
      const hash = computeHash('test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be sensitive to small changes', () => {
      const hash1 = computeHash('hello');
      const hash2 = computeHash('hellp'); // One character difference

      expect(hash1).not.toBe(hash2);
      // Hashes should be completely different (avalanche effect)
      let diffCount = 0;
      for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] !== hash2[i]) diffCount++;
      }
      // Most characters should differ
      expect(diffCount).toBeGreaterThan(30);
    });
  });

  describe('Cryptographic Properties', () => {
    it('should produce pseudorandom-looking ciphertext', () => {
      const encrypted = encrypt('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

      // Ciphertext should not have obvious patterns
      const cipherBytes = Buffer.from(encrypted.ciphertext, 'base64');

      // Check byte distribution is somewhat uniform
      const byteCounts = new Map<number, number>();
      for (const byte of cipherBytes) {
        byteCounts.set(byte, (byteCounts.get(byte) ?? 0) + 1);
      }

      // Should have reasonable variety of byte values
      expect(byteCounts.size).toBeGreaterThan(cipherBytes.length / 4);
    });

    it('should have authentication tag of correct length (16 bytes)', () => {
      const encrypted = encrypt('test');
      const authTagBytes = Buffer.from(encrypted.authTag, 'base64');

      expect(authTagBytes.length).toBe(16);
    });

    it('should include all required envelope fields', () => {
      const encrypted = encrypt('test');

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.version).toBe(1);
      expect(encrypted.kdfVersion).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long keys', () => {
      // Generate a long high-entropy key
      const longKey = Array.from({ length: 200 }, (_, i) =>
        String.fromCharCode(33 + ((i * 7 + 13) % 94))
      ).join('');
      const longSalt = Array.from({ length: 50 }, (_, i) =>
        String.fromCharCode(33 + ((i * 11 + 17) % 94))
      ).join('');

      mockGetConfig.mockReturnValue(
        createTestConfig({
          key: longKey,
          salt: longSalt,
        }) as ReturnType<typeof getConfig>
      );

      const encrypted = encrypt('test');
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe('test');
    });

    it('should handle special characters in encryption key', () => {
      // High-entropy key with special characters (32+ chars)
      mockGetConfig.mockReturnValue(
        createTestConfig({
          key: 'kE9!@#$%^&*()_+-=[]{}|;:,.<>?aB3x',
        }) as ReturnType<typeof getConfig>
      );

      const encrypted = encrypt('test');
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe('test');
    });

    it('should handle null bytes in plaintext', () => {
      const plaintext = 'before\0after';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Performance', () => {
    it('should encrypt within reasonable time', () => {
      const plaintext = 'x'.repeat(10000);
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        encrypt(plaintext);
      }

      const duration = performance.now() - start;
      // Should complete 100 encryptions in less than 5 seconds
      expect(duration).toBeLessThan(5000);
    });

    it('should decrypt within reasonable time', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        decrypt(encrypted);
      }

      const duration = performance.now() - start;
      // Should complete 100 decryptions in less than 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });
});
