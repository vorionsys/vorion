/**
 * PROPERTY-BASED TESTS -- Cryptographic Invariants
 *
 * Uses fast-check to generate thousands of random inputs and verify
 * that fundamental cryptographic properties hold for ALL inputs.
 *
 * Properties tested:
 * P1:  decrypt(encrypt(x)) === x  for AES-256-GCM        (round-trip identity)
 * P2:  decrypt(encrypt(x)) === x  for ChaCha20-Poly1305  (round-trip identity)
 * P3:  decrypt(encrypt(x)) === x  for AES-256-CBC         (round-trip identity)
 * P4:  encrypt(x) !== encrypt(x)  for random IVs          (non-determinism)
 * P5:  deterministic encrypt(x) === deterministic encrypt(x) (consistency)
 * P6:  flipping any byte in ciphertext causes decryption failure (tamper detection)
 * P7:  encrypt with fieldName A, decrypt with fieldName B fails (AAD field binding)
 * P8:  same plaintext + different fieldName => different ciphertext (key isolation)
 * P9:  same plaintext + fieldName but different tenantId => different ciphertext (tenant isolation)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
process.env.VORION_ENCRYPTION_KEY = 'vorion-test-master-key-32-bytes!!';

// ---------------------------------------------------------------------------
// Mocks -- isolate the service from transitive infrastructure dependencies
// ---------------------------------------------------------------------------

vi.mock('../../packages/security/src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../packages/security/src/common/security-mode.js', () => ({
  devOnlyDefault: (_key: string, fallback: string) => fallback,
  isProductionGrade: () => false,
  getSecurityMode: () => 'development',
}));

vi.mock('../../packages/security/src/security/kms/index.js', () => ({
  getKMSProvider: vi.fn(),
  getInitializedKMSProvider: vi.fn(),
  isKMSConfigured: () => false,
  createKMSProvider: vi.fn(),
}));

vi.mock('../../packages/security/src/security/secure-memory.js', () => ({
  SecureBuffer: class MockSecureBuffer {
    private buf: Buffer;
    private _cleared = false;
    constructor(data: Buffer | Uint8Array | string) {
      if (typeof data === 'string') {
        this.buf = Buffer.from(data, 'hex');
      } else {
        this.buf = Buffer.from(data);
      }
    }
    use<T>(fn: (buf: Buffer) => T): T {
      return fn(this.buf);
    }
    isCleared() {
      return this._cleared;
    }
    clear() {
      this.buf.fill(0);
      this._cleared = true;
    }
  },
}));

vi.mock('../../packages/security/src/common/errors.js', () => ({
  VorionError: class VorionError extends Error {
    code = 'VORION_ERROR';
    statusCode = 500;
    details?: Record<string, unknown>;
    constructor(message: string, details?: Record<string, unknown>) {
      super(message);
      this.name = 'VorionError';
      if (details !== undefined) this.details = details;
    }
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  FieldEncryptionService,
} from '../../packages/security/src/security/encryption/service.js';
import type { KeyProvider } from '../../packages/security/src/security/encryption/key-provider.js';
import {
  EncryptionAlgorithm as Algorithm,
} from '../../packages/security/src/security/encryption/types.js';
import type {
  EncryptedFieldMarker,
} from '../../packages/security/src/security/encryption/types.js';

// ---------------------------------------------------------------------------
// Inline TestKeyProvider -- avoids all transitive deps of EnvKeyProvider
// ---------------------------------------------------------------------------

const MASTER_KEY = Buffer.from('vorion-test-master-key-32-bytes!!', 'utf-8');
const KEY_DERIVATION_INFO = 'vorion-field-encryption-v1';

class TestKeyProvider implements KeyProvider {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async getCurrentVersion(): Promise<number> {
    return 1;
  }

  async getKeyVersion(version: number) {
    if (version === 1) {
      return {
        version: 1,
        createdAt: new Date(),
        activatedAt: new Date(),
        status: 'active' as const,
      };
    }
    return null;
  }

  async getAllVersions() {
    return [{
      version: 1,
      createdAt: new Date(),
      activatedAt: new Date(),
      status: 'active' as const,
    }];
  }

  async deriveFieldKey(
    _version: number,
    fieldName: string,
    tenantId?: string,
  ): Promise<Buffer> {
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);
    const info = Buffer.from(`${KEY_DERIVATION_INFO}:field:${fieldName}`, 'utf-8');
    return Buffer.from(crypto.hkdfSync('sha256', MASTER_KEY, salt, info, 32));
  }

  async deriveDeterministicKey(
    _version: number,
    fieldName: string,
    tenantId?: string,
  ): Promise<Buffer> {
    const salt = tenantId
      ? crypto.createHash('sha256').update(tenantId).digest()
      : Buffer.alloc(32);
    const info = Buffer.from(`${KEY_DERIVATION_INFO}:deterministic:${fieldName}`, 'utf-8');
    return Buffer.from(crypto.hkdfSync('sha256', MASTER_KEY, salt, info, 32));
  }

  async rotateKey(): Promise<number> {
    return 2;
  }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let service: FieldEncryptionService;

beforeAll(async () => {
  const keyProvider = new TestKeyProvider();
  service = new FieldEncryptionService(
    { includeFieldNameInAAD: true, auditLogging: false },
    keyProvider as KeyProvider,
  );
  await service.initialize();
});

afterAll(async () => {
  await service.shutdown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode an EncryptedFieldMarker to a JSON string so we can compare bytes. */
function ciphertextBytes(marker: EncryptedFieldMarker): string {
  return marker.field.ciphertext;
}

// ---------------------------------------------------------------------------
// P1: Round-trip identity -- AES-256-GCM
// ---------------------------------------------------------------------------

describe('P1: decrypt(encrypt(x)) === x  [AES-256-GCM]', () => {
  it('holds for arbitrary strings', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p1-field',
            algorithm: Algorithm.AES_256_GCM,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p1-field',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for arbitrary unicode strings', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[\u0020-\ud7ff\ue000-\ufffd]{0,300}$/),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p1-unicode',
            algorithm: Algorithm.AES_256_GCM,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p1-unicode',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// P2: Round-trip identity -- ChaCha20-Poly1305
// ---------------------------------------------------------------------------

describe('P2: decrypt(encrypt(x)) === x  [ChaCha20-Poly1305]', () => {
  it('holds for arbitrary strings', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p2-field',
            algorithm: Algorithm.CHACHA20_POLY1305,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p2-field',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for arbitrary unicode strings', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[\u0020-\ud7ff\ue000-\ufffd]{0,300}$/),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p2-unicode',
            algorithm: Algorithm.CHACHA20_POLY1305,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p2-unicode',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// P3: Round-trip identity -- AES-256-CBC
// ---------------------------------------------------------------------------

describe('P3: decrypt(encrypt(x)) === x  [AES-256-CBC]', () => {
  it('holds for arbitrary strings', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p3-field',
            algorithm: Algorithm.AES_256_CBC,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p3-field',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for arbitrary printable-ASCII strings (CBC block cipher)', { timeout: 30_000 }, async () => {
    // CBC mode uses PKCS7 block padding — verify roundtrip across all
    // possible padding lengths (0-15 residual bytes) using single-byte
    // ASCII characters. Multi-byte UTF-8 is already covered by the
    // arbitrary-string test above.
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[\u0020-\u007e]{0,300}$/),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p3-ascii',
            algorithm: Algorithm.AES_256_CBC,
          });
          const decrypted = await service.decrypt(encrypted, {
            fieldName: 'p3-ascii',
          });
          expect(decrypted).toBe(plaintext);
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// P4: Non-deterministic encryption -- different IVs each time
// ---------------------------------------------------------------------------

describe('P4: encrypt(x) !== encrypt(x)  [non-deterministic, random IV]', () => {
  it('two encryptions of the same plaintext produce different ciphertexts', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (plaintext) => {
          const enc1 = await service.encrypt(plaintext, {
            fieldName: 'p4-field',
            algorithm: Algorithm.AES_256_GCM,
          });
          const enc2 = await service.encrypt(plaintext, {
            fieldName: 'p4-field',
            algorithm: Algorithm.AES_256_GCM,
          });

          // Ciphertext must differ (different random IVs)
          expect(ciphertextBytes(enc1)).not.toBe(ciphertextBytes(enc2));

          // IVs must differ
          expect(enc1.field.iv).not.toBe(enc2.field.iv);

          // Both must still decrypt to the same plaintext
          const dec1 = await service.decrypt(enc1, { fieldName: 'p4-field' });
          const dec2 = await service.decrypt(enc2, { fieldName: 'p4-field' });
          expect(dec1).toBe(plaintext);
          expect(dec2).toBe(plaintext);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// P5: Deterministic consistency -- same plaintext, same fieldName => same output
// ---------------------------------------------------------------------------

describe('P5: deterministic encrypt(x) === deterministic encrypt(x)', () => {
  it('produces identical ciphertexts for the same plaintext and field', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (plaintext) => {
          const enc1 = await service.encrypt(plaintext, {
            fieldName: 'p5-searchable',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
          });
          const enc2 = await service.encrypt(plaintext, {
            fieldName: 'p5-searchable',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
          });

          // Ciphertext and IV must be identical
          expect(ciphertextBytes(enc1)).toBe(ciphertextBytes(enc2));
          expect(enc1.field.iv).toBe(enc2.field.iv);
          expect(enc1.field.authTag).toBe(enc2.field.authTag);

          // And it must still decrypt
          const dec = await service.decrypt(enc1, { fieldName: 'p5-searchable' });
          expect(dec).toBe(plaintext);
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// P6: Tamper detection -- flipping any random byte in ciphertext causes failure
// ---------------------------------------------------------------------------

describe('P6: tamper detection (bit-flip in ciphertext)', () => {
  it('flipping a random byte in ciphertext causes decryption to fail [AES-256-GCM]', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.nat(),
        async (plaintext, flipSeed) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p6-field',
            algorithm: Algorithm.AES_256_GCM,
          });

          // Tamper with the ciphertext
          const ciphertextBuf = Buffer.from(encrypted.field.ciphertext, 'base64');
          if (ciphertextBuf.length === 0) return; // skip empty ciphertext edge case

          const byteIndex = flipSeed % ciphertextBuf.length;
          ciphertextBuf[byteIndex] = ciphertextBuf[byteIndex]! ^ 0xff;

          const tampered: EncryptedFieldMarker = {
            __encrypted: true,
            __version: 2,
            field: {
              ...encrypted.field,
              ciphertext: ciphertextBuf.toString('base64'),
            },
          };

          await expect(
            service.decrypt(tampered, { fieldName: 'p6-field' }),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('flipping a random byte in authTag causes decryption to fail [AES-256-GCM]', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.nat(),
        async (plaintext, flipSeed) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p6-tag',
            algorithm: Algorithm.AES_256_GCM,
          });

          // Tamper with the auth tag
          const tagBuf = Buffer.from(encrypted.field.authTag, 'base64');
          if (tagBuf.length === 0) return;

          const byteIndex = flipSeed % tagBuf.length;
          tagBuf[byteIndex] = tagBuf[byteIndex]! ^ 0xff;

          const tampered: EncryptedFieldMarker = {
            __encrypted: true,
            __version: 2,
            field: {
              ...encrypted.field,
              authTag: tagBuf.toString('base64'),
            },
          };

          await expect(
            service.decrypt(tampered, { fieldName: 'p6-tag' }),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('flipping a random byte in ciphertext causes decryption to fail [AES-256-CBC]', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.nat(),
        async (plaintext, flipSeed) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p6-cbc',
            algorithm: Algorithm.AES_256_CBC,
          });

          // Tamper with the ciphertext
          const ciphertextBuf = Buffer.from(encrypted.field.ciphertext, 'base64');
          if (ciphertextBuf.length === 0) return;

          const byteIndex = flipSeed % ciphertextBuf.length;
          ciphertextBuf[byteIndex] = ciphertextBuf[byteIndex]! ^ 0xff;

          const tampered: EncryptedFieldMarker = {
            __encrypted: true,
            __version: 2,
            field: {
              ...encrypted.field,
              ciphertext: ciphertextBuf.toString('base64'),
            },
          };

          await expect(
            service.decrypt(tampered, { fieldName: 'p6-cbc' }),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// P7: Field binding via AAD -- encrypt with fieldName A, decrypt with B fails
// ---------------------------------------------------------------------------

describe('P7: AAD field binding (cross-field decryption fails)', () => {
  it('decrypting with a different fieldName throws', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s !== 'field-alpha'),
        async (plaintext, otherFieldName) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'field-alpha',
            algorithm: Algorithm.AES_256_GCM,
          });

          // The service first checks if fieldName in the marker matches the decrypt option.
          // Since includeFieldNameInAAD is true and the marker stores the original fieldName,
          // attempting to decrypt with a mismatched fieldName should fail.
          await expect(
            service.decrypt(encrypted, { fieldName: otherFieldName }),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// P8: Key isolation -- same plaintext, different fieldNames => different ciphertext
// ---------------------------------------------------------------------------

describe('P8: key isolation (different fieldNames => different derived keys)', () => {
  it('deterministic encryption with different fieldNames yields different ciphertexts', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        // minLength: 16 avoids short-ciphertext collisions (1-byte plaintext
        // has only 256 possible ciphertext values, making spurious matches likely)
        fc.string({ minLength: 16, maxLength: 200 }),
        async (plaintext) => {
          const enc1 = await service.encrypt(plaintext, {
            fieldName: 'p8-field-one',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
          });
          const enc2 = await service.encrypt(plaintext, {
            fieldName: 'p8-field-two',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
          });

          // Different field keys => different ciphertexts (and different IVs)
          expect(ciphertextBytes(enc1)).not.toBe(ciphertextBytes(enc2));
        },
      ),
      { numRuns: 80 },
    );
  });
});

// ---------------------------------------------------------------------------
// P9: Tenant isolation -- same plaintext + fieldName, different tenantId => different ciphertext
// ---------------------------------------------------------------------------

describe('P9: tenant isolation (different tenantId => different derived keys)', () => {
  it('deterministic encryption with different tenantIds yields different ciphertexts', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (plaintext) => {
          const enc1 = await service.encrypt(plaintext, {
            fieldName: 'p9-field',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
            tenantId: 'tenant-alpha',
          });
          const enc2 = await service.encrypt(plaintext, {
            fieldName: 'p9-field',
            algorithm: Algorithm.AES_256_GCM,
            deterministic: true,
            tenantId: 'tenant-beta',
          });

          // Different tenant salts => different derived keys => different ciphertexts
          expect(ciphertextBytes(enc1)).not.toBe(ciphertextBytes(enc2));

          // But both must still decrypt correctly with their own tenantId
          const dec1 = await service.decrypt(enc1, {
            fieldName: 'p9-field',
            tenantId: 'tenant-alpha',
          });
          const dec2 = await service.decrypt(enc2, {
            fieldName: 'p9-field',
            tenantId: 'tenant-beta',
          });
          expect(dec1).toBe(plaintext);
          expect(dec2).toBe(plaintext);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('cross-tenant decryption fails', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (plaintext) => {
          const encrypted = await service.encrypt(plaintext, {
            fieldName: 'p9-cross',
            algorithm: Algorithm.AES_256_GCM,
            tenantId: 'tenant-alpha',
          });

          // Attempting to decrypt with a different tenantId should fail
          // because the derived key will differ
          await expect(
            service.decrypt(encrypted, {
              fieldName: 'p9-cross',
              tenantId: 'tenant-beta',
            }),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});
