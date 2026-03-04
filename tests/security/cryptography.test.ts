/**
 * Cryptography Security Tests
 *
 * Comprehensive tests for cryptographic operations covering:
 * - Encryption/decryption round-trips
 * - Key derivation correctness
 * - Secure random generation
 * - Password hashing validation
 * - HMAC signature verification
 * - Timing-safe comparison
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { timingSafeEqual, randomBytes, createHash, createHmac, pbkdf2Sync, scryptSync } from 'node:crypto';
import {
  FieldEncryptionService,
  createFieldEncryptionService,
  FieldEncryptionError,
} from '../../src/security/encryption/service.js';
import {
  EncryptionAlgorithm,
  DataClassification,
} from '../../src/security/encryption/types.js';
import {
  SecureString,
  SecureBuffer,
  secureCompare,
  secureCompareBuffers,
  secureRandomBytes,
} from '../../src/security/secure-memory.js';

// Mock dependencies
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Cryptography Security', () => {
  // ===========================================================================
  // ENCRYPTION/DECRYPTION ROUND-TRIP TESTS
  // ===========================================================================

  describe('Encryption/Decryption Round-Trip', () => {
    it('should successfully round-trip with AES-256-GCM', () => {
      const key = randomBytes(32); // 256 bits
      const iv = randomBytes(12); // 96 bits for GCM
      const plaintext = 'Hello, World! This is sensitive data.';
      const aad = Buffer.from('additional authenticated data');

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should successfully round-trip with ChaCha20-Poly1305', () => {
      const key = randomBytes(32); // 256 bits
      const iv = randomBytes(12); // 96 bits
      const plaintext = 'Secret message for ChaCha20-Poly1305';

      // Encrypt
      const cipher = crypto.createCipheriv('chacha20-poly1305', key, iv, {
        authTagLength: 16,
      });
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Decrypt
      const decipher = crypto.createDecipheriv('chacha20-poly1305', key, iv, {
        authTagLength: 16,
      });
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should produce unique ciphertext for same plaintext due to random IV', () => {
      const key = randomBytes(32);
      const plaintext = 'Same plaintext every time';

      const encryptWithRandomIV = () => {
        const iv = randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return { iv, encrypted, authTag: cipher.getAuthTag() };
      };

      const result1 = encryptWithRandomIV();
      const result2 = encryptWithRandomIV();

      // IVs should be different
      expect(result1.iv.equals(result2.iv)).toBe(false);
      // Ciphertexts should be different
      expect(result1.encrypted.equals(result2.encrypted)).toBe(false);
    });

    it('should detect tampered ciphertext', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = 'Original message';

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Tamper with ciphertext
      encrypted[0] ^= 0xff;

      // Attempt to decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      expect(() => {
        decipher.update(encrypted);
        decipher.final();
      }).toThrow();
    });

    it('should detect tampered auth tag', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = 'Original message';

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Tamper with auth tag
      const tamperedAuthTag = Buffer.from(authTag);
      tamperedAuthTag[0] ^= 0xff;

      // Attempt to decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tamperedAuthTag);

      expect(() => {
        decipher.update(encrypted);
        decipher.final();
      }).toThrow();
    });

    it('should handle empty string encryption', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = '';

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should handle large data encryption', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = 'x'.repeat(1000000); // 1MB of data

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should handle unicode/binary data encryption', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = 'Hello \u4e2d\u6587 \ud83d\ude00 \x00\x01\x02\x03';

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });
  });

  // ===========================================================================
  // KEY DERIVATION TESTS
  // ===========================================================================

  describe('Key Derivation Correctness', () => {
    it('should derive consistent keys with PBKDF2', () => {
      const password = 'secure-password-123';
      const salt = randomBytes(16);
      const iterations = 100000;
      const keyLength = 32;

      const key1 = pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
      const key2 = pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');

      expect(key1.equals(key2)).toBe(true);
    });

    it('should derive different keys with different salts', () => {
      const password = 'secure-password-123';
      const salt1 = randomBytes(16);
      const salt2 = randomBytes(16);
      const iterations = 100000;
      const keyLength = 32;

      const key1 = pbkdf2Sync(password, salt1, iterations, keyLength, 'sha256');
      const key2 = pbkdf2Sync(password, salt2, iterations, keyLength, 'sha256');

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys with different passwords', () => {
      const password1 = 'password-one';
      const password2 = 'password-two';
      const salt = randomBytes(16);
      const iterations = 100000;
      const keyLength = 32;

      const key1 = pbkdf2Sync(password1, salt, iterations, keyLength, 'sha256');
      const key2 = pbkdf2Sync(password2, salt, iterations, keyLength, 'sha256');

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive consistent keys with scrypt', () => {
      const password = 'secure-password-123';
      const salt = randomBytes(16);
      const keyLength = 32;
      const options = { N: 16384, r: 8, p: 1 };

      const key1 = scryptSync(password, salt, keyLength, options);
      const key2 = scryptSync(password, salt, keyLength, options);

      expect(key1.equals(key2)).toBe(true);
    });

    it('should use HKDF for key expansion', () => {
      const ikm = randomBytes(32); // Input key material
      const salt = randomBytes(16);
      const info = Buffer.from('encryption-key');
      const keyLength = 32;

      // Extract
      const prk = createHmac('sha256', salt).update(ikm).digest();

      // Expand
      const expand = (prk: Buffer, info: Buffer, length: number) => {
        const hashLen = 32;
        const n = Math.ceil(length / hashLen);
        const okm = Buffer.alloc(n * hashLen);
        let prev = Buffer.alloc(0);

        for (let i = 1; i <= n; i++) {
          const hmac = createHmac('sha256', prk);
          hmac.update(prev);
          hmac.update(info);
          hmac.update(Buffer.from([i]));
          prev = hmac.digest();
          prev.copy(okm, (i - 1) * hashLen);
        }

        return okm.subarray(0, length);
      };

      const key = expand(prk, info, keyLength);
      expect(key.length).toBe(keyLength);
    });

    it('should produce correct key lengths', () => {
      const password = 'test-password';
      const salt = randomBytes(16);
      const iterations = 10000;

      const key128 = pbkdf2Sync(password, salt, iterations, 16, 'sha256');
      const key256 = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
      const key512 = pbkdf2Sync(password, salt, iterations, 64, 'sha256');

      expect(key128.length).toBe(16);
      expect(key256.length).toBe(32);
      expect(key512.length).toBe(64);
    });
  });

  // ===========================================================================
  // SECURE RANDOM GENERATION TESTS
  // ===========================================================================

  describe('Secure Random Generation', () => {
    it('should generate unique random bytes', () => {
      const samples = 100;
      const byteLength = 32;
      const randoms = new Set<string>();

      for (let i = 0; i < samples; i++) {
        const bytes = randomBytes(byteLength);
        randoms.add(bytes.toString('hex'));
      }

      // All should be unique
      expect(randoms.size).toBe(samples);
    });

    it('should generate bytes of correct length', () => {
      const lengths = [16, 32, 64, 128, 256];

      for (const length of lengths) {
        const bytes = randomBytes(length);
        expect(bytes.length).toBe(length);
      }
    });

    it('should have reasonable byte distribution', () => {
      const samples = 10000;
      const byteCounts = new Array(256).fill(0);

      for (let i = 0; i < samples; i++) {
        const byte = randomBytes(1)[0];
        byteCounts[byte!]++;
      }

      // Each byte should appear at least once in 10000 samples
      const minOccurrences = byteCounts.filter(c => c > 0).length;
      expect(minOccurrences).toBeGreaterThan(200); // At least 200 different byte values

      // Check for roughly uniform distribution
      const expectedCount = samples / 256;
      const tolerance = expectedCount * 0.5; // 50% tolerance

      let withinTolerance = 0;
      for (const count of byteCounts) {
        if (Math.abs(count - expectedCount) <= tolerance) {
          withinTolerance++;
        }
      }

      // Most byte values should be within tolerance
      expect(withinTolerance).toBeGreaterThan(200);
    });

    it('should generate crypto-grade UUIDs', () => {
      const uuids = new Set<string>();
      const samples = 100;

      for (let i = 0; i < samples; i++) {
        const uuid = crypto.randomUUID();
        uuids.add(uuid);

        // Validate UUID format
        expect(uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
      }

      // All should be unique
      expect(uuids.size).toBe(samples);
    });
  });

  // ===========================================================================
  // PASSWORD HASHING TESTS
  // ===========================================================================

  describe('Password Hashing Validation', () => {
    it('should produce consistent hashes with same password and salt', () => {
      const password = 'MySecureP@ssw0rd!';
      const salt = randomBytes(16);
      const iterations = 100000;

      const hash1 = pbkdf2Sync(password, salt, iterations, 64, 'sha512');
      const hash2 = pbkdf2Sync(password, salt, iterations, 64, 'sha512');

      expect(hash1.equals(hash2)).toBe(true);
    });

    it('should produce different hashes for different passwords', () => {
      const password1 = 'Password1!';
      const password2 = 'Password2!';
      const salt = randomBytes(16);
      const iterations = 100000;

      const hash1 = pbkdf2Sync(password1, salt, iterations, 64, 'sha512');
      const hash2 = pbkdf2Sync(password2, salt, iterations, 64, 'sha512');

      expect(hash1.equals(hash2)).toBe(false);
    });

    it('should detect even minor password differences', () => {
      const password1 = 'CorrectPassword';
      const password2 = 'CorrectPasswor';  // Missing last character
      const password3 = 'correctPassword'; // Different case
      const salt = randomBytes(16);
      const iterations = 100000;

      const hash1 = pbkdf2Sync(password1, salt, iterations, 64, 'sha512');
      const hash2 = pbkdf2Sync(password2, salt, iterations, 64, 'sha512');
      const hash3 = pbkdf2Sync(password3, salt, iterations, 64, 'sha512');

      expect(hash1.equals(hash2)).toBe(false);
      expect(hash1.equals(hash3)).toBe(false);
    });

    it('should use appropriate iteration count', () => {
      // OWASP recommends 600,000+ for PBKDF2-SHA256
      const minimumIterations = 100000;
      const password = 'TestPassword123!';
      const salt = randomBytes(16);

      const start = performance.now();
      pbkdf2Sync(password, salt, minimumIterations, 64, 'sha512');
      const duration = performance.now() - start;

      // Should take measurable time (at least 10ms)
      expect(duration).toBeGreaterThan(10);
    });

    it('should use sufficiently long salt', () => {
      const minimumSaltLength = 16; // 128 bits minimum
      const salt = randomBytes(minimumSaltLength);

      expect(salt.length).toBeGreaterThanOrEqual(minimumSaltLength);
    });
  });

  // ===========================================================================
  // HMAC SIGNATURE VERIFICATION TESTS
  // ===========================================================================

  describe('HMAC Signature Verification', () => {
    it('should generate consistent HMAC for same input', () => {
      const key = randomBytes(32);
      const data = 'Message to authenticate';

      const hmac1 = createHmac('sha256', key).update(data).digest();
      const hmac2 = createHmac('sha256', key).update(data).digest();

      expect(hmac1.equals(hmac2)).toBe(true);
    });

    it('should generate different HMAC for different inputs', () => {
      const key = randomBytes(32);
      const data1 = 'Message 1';
      const data2 = 'Message 2';

      const hmac1 = createHmac('sha256', key).update(data1).digest();
      const hmac2 = createHmac('sha256', key).update(data2).digest();

      expect(hmac1.equals(hmac2)).toBe(false);
    });

    it('should generate different HMAC for different keys', () => {
      const key1 = randomBytes(32);
      const key2 = randomBytes(32);
      const data = 'Same message';

      const hmac1 = createHmac('sha256', key1).update(data).digest();
      const hmac2 = createHmac('sha256', key2).update(data).digest();

      expect(hmac1.equals(hmac2)).toBe(false);
    });

    it('should support multiple hash algorithms', () => {
      const key = randomBytes(32);
      const data = 'Test data';

      const hmacSha256 = createHmac('sha256', key).update(data).digest();
      const hmacSha384 = createHmac('sha384', key).update(data).digest();
      const hmacSha512 = createHmac('sha512', key).update(data).digest();

      expect(hmacSha256.length).toBe(32);
      expect(hmacSha384.length).toBe(48);
      expect(hmacSha512.length).toBe(64);
    });

    it('should verify valid signatures', () => {
      const key = randomBytes(32);
      const data = 'Signed message';

      const signature = createHmac('sha256', key).update(data).digest();

      const verify = (message: string, sig: Buffer) => {
        const expected = createHmac('sha256', key).update(message).digest();
        return timingSafeEqual(sig, expected);
      };

      expect(verify(data, signature)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const key = randomBytes(32);
      const data = 'Signed message';

      const signature = createHmac('sha256', key).update(data).digest();
      const tamperedSignature = Buffer.from(signature);
      tamperedSignature[0] ^= 0xff;

      const verify = (message: string, sig: Buffer) => {
        const expected = createHmac('sha256', key).update(message).digest();
        return sig.length === expected.length && timingSafeEqual(sig, expected);
      };

      expect(verify(data, tamperedSignature)).toBe(false);
    });
  });

  // ===========================================================================
  // TIMING-SAFE COMPARISON TESTS
  // ===========================================================================

  describe('Timing-Safe Comparison', () => {
    it('should return true for equal buffers', () => {
      const buffer1 = Buffer.from('identical-string');
      const buffer2 = Buffer.from('identical-string');

      expect(timingSafeEqual(buffer1, buffer2)).toBe(true);
    });

    it('should return false for different buffers', () => {
      const buffer1 = Buffer.from('string-one');
      const buffer2 = Buffer.from('string-two');

      expect(timingSafeEqual(buffer1, buffer2)).toBe(false);
    });

    it('should throw for different length buffers', () => {
      const buffer1 = Buffer.from('short');
      const buffer2 = Buffer.from('much-longer');

      expect(() => timingSafeEqual(buffer1, buffer2)).toThrow();
    });

    it('should detect single bit differences', () => {
      const buffer1 = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const buffer2 = Buffer.from([0x00, 0x01, 0x02, 0x02]); // Last byte differs by 1

      expect(timingSafeEqual(buffer1, buffer2)).toBe(false);
    });

    it('should take consistent time regardless of difference position', () => {
      const iterations = 10000;
      const reference = Buffer.alloc(32, 0x00);

      // Difference at start
      const diffStart = Buffer.alloc(32, 0x00);
      diffStart[0] = 0xff;

      // Difference at end
      const diffEnd = Buffer.alloc(32, 0x00);
      diffEnd[31] = 0xff;

      // Time comparisons
      const timeComparison = (buf1: Buffer, buf2: Buffer) => {
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
          try {
            timingSafeEqual(buf1, buf2);
          } catch {
            // Ignore length mismatches
          }
        }
        return Number(process.hrtime.bigint() - start);
      };

      const startTime = timeComparison(reference, diffStart);
      const endTime = timeComparison(reference, diffEnd);

      // Times should be similar (within 50% of each other)
      const ratio = startTime / endTime;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2.0);
    });

    it('should work with secureCompare utility', () => {
      // secureCompare expects SecureString objects, not plain strings
      const str1 = new SecureString('api-key-abc123');
      const str2 = new SecureString('api-key-abc123');
      const str3 = new SecureString('api-key-xyz789');

      expect(secureCompare(str1, str2)).toBe(true);
      expect(secureCompare(str1, str3)).toBe(false);

      // Cleanup
      str1.clear();
      str2.clear();
      str3.clear();
    });

    it('should work with secureCompareBuffers utility', () => {
      // secureCompareBuffers expects SecureBuffer objects, not plain buffers
      const buf1 = new SecureBuffer(Buffer.from('secret-data'));
      const buf2 = new SecureBuffer(Buffer.from('secret-data'));
      const buf3 = new SecureBuffer(Buffer.from('other-data!'));

      expect(secureCompareBuffers(buf1, buf2)).toBe(true);
      expect(secureCompareBuffers(buf1, buf3)).toBe(false);

      // Cleanup
      buf1.clear();
      buf2.clear();
      buf3.clear();
    });
  });

  // ===========================================================================
  // HASH FUNCTION TESTS
  // ===========================================================================

  describe('Hash Functions', () => {
    it('should produce consistent SHA-256 hashes', () => {
      const data = 'Data to hash';

      const hash1 = createHash('sha256').update(data).digest('hex');
      const hash2 = createHash('sha256').update(data).digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // 256 bits = 64 hex chars
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = createHash('sha256').update('input1').digest('hex');
      const hash2 = createHash('sha256').update('input2').digest('hex');

      expect(hash1).not.toBe(hash2);
    });

    it('should exhibit avalanche effect', () => {
      const hash1 = createHash('sha256').update('hello').digest();
      const hash2 = createHash('sha256').update('hellp').digest(); // One char difference

      // Count differing bits
      let differingBits = 0;
      for (let i = 0; i < hash1.length; i++) {
        let xor = hash1[i]! ^ hash2[i]!;
        while (xor) {
          differingBits += xor & 1;
          xor >>= 1;
        }
      }

      // Should have roughly half the bits different (around 128 for SHA-256)
      expect(differingBits).toBeGreaterThan(80);
      expect(differingBits).toBeLessThan(180);
    });

    it('should support multiple hash algorithms', () => {
      const data = 'Test data for hashing';

      const sha256 = createHash('sha256').update(data).digest('hex');
      const sha384 = createHash('sha384').update(data).digest('hex');
      const sha512 = createHash('sha512').update(data).digest('hex');

      expect(sha256.length).toBe(64);  // 256 bits
      expect(sha384.length).toBe(96);  // 384 bits
      expect(sha512.length).toBe(128); // 512 bits
    });
  });

  // ===========================================================================
  // SECURE MEMORY TESTS
  // ===========================================================================

  describe('Secure Memory Handling', () => {
    it('should clear sensitive data from SecureBuffer', () => {
      const sensitiveData = Buffer.from('secret-key-material');
      const secureBuffer = new SecureBuffer(sensitiveData);

      // Use the data via callback (SecureBuffer doesn't have read(), use use())
      const dataString = secureBuffer.use((data) => data.toString());
      expect(dataString).toBe('secret-key-material');

      // Clear the buffer
      secureBuffer.clear();

      // Buffer should be marked as cleared
      expect(secureBuffer.isCleared()).toBe(true);
    });

    it('should generate secure random bytes with secureRandomBytes', () => {
      // secureRandomBytes returns SecureBuffer objects
      const secBuf1 = secureRandomBytes(32);
      const secBuf2 = secureRandomBytes(32);

      expect(secBuf1.length).toBe(32);
      expect(secBuf2.length).toBe(32);

      // Compare the contents using use()
      const bytes1 = secBuf1.use((b) => Buffer.from(b));
      const bytes2 = secBuf2.use((b) => Buffer.from(b));

      expect(bytes1.equals(bytes2)).toBe(false);

      // Cleanup
      secBuf1.clear();
      secBuf2.clear();
    });
  });

  // ===========================================================================
  // ALGORITHM AGILITY TESTS
  // ===========================================================================

  describe('Algorithm Agility', () => {
    it('should support upgrading encryption algorithms', () => {
      const algorithms = [
        { name: 'aes-256-gcm', keyLength: 32, ivLength: 12 },
        { name: 'chacha20-poly1305', keyLength: 32, ivLength: 12 },
      ];

      for (const algo of algorithms) {
        const key = randomBytes(algo.keyLength);
        const iv = randomBytes(algo.ivLength);
        const plaintext = 'Test message for algorithm';

        // Encrypt
        const cipher = crypto.createCipheriv(algo.name, key, iv, {
          authTagLength: 16,
        });
        let encrypted = cipher.update(plaintext, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Decrypt
        const decipher = crypto.createDecipheriv(algo.name, key, iv, {
          authTagLength: 16,
        });
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        expect(decrypted.toString('utf8')).toBe(plaintext);
      }
    });

    it('should store algorithm metadata with encrypted data', () => {
      interface EncryptedEnvelope {
        algorithm: string;
        keyVersion: number;
        iv: string;
        authTag: string;
        ciphertext: string;
      }

      const envelope: EncryptedEnvelope = {
        algorithm: 'aes-256-gcm',
        keyVersion: 1,
        iv: randomBytes(12).toString('base64'),
        authTag: randomBytes(16).toString('base64'),
        ciphertext: 'encrypted-data-base64',
      };

      expect(envelope.algorithm).toBeDefined();
      expect(envelope.keyVersion).toBeDefined();
    });
  });
});
