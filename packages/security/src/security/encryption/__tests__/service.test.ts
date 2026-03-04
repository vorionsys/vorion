/**
 * Tests for FieldEncryptionService and EnvKeyProvider
 *
 * Exercises real AES-256-GCM, AES-256-CBC, and ChaCha20-Poly1305 crypto
 * operations through the full encrypt/decrypt lifecycle including key
 * derivation, AAD field binding, deterministic mode, object-level
 * policies, key rotation/re-encryption, and audit callbacks.
 */

// Set the encryption key env var BEFORE any imports so the key provider picks it up.
process.env.VORION_ENCRYPTION_KEY = 'vorion-test-master-key-32-bytes!!';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FieldEncryptionService,
  FieldEncryptionError,
} from '../service.js';
import { EnvKeyProvider } from '../key-provider.js';
import {
  EncryptionAlgorithm,
  DataClassification,
  EncryptionErrorCode,
  isEncryptedFieldMarker,
} from '../types.js';
import type {
  EncryptedFieldMarker,
  FieldEncryptionPolicy,
  EncryptionAuditEntry,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProvider(): EnvKeyProvider {
  return new EnvKeyProvider();
}

function createService(provider?: EnvKeyProvider): FieldEncryptionService {
  const kp = provider ?? createProvider();
  return new FieldEncryptionService({}, kp);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FieldEncryptionService', () => {
  let provider: EnvKeyProvider;
  let service: FieldEncryptionService;

  beforeEach(async () => {
    provider = createProvider();
    service = new FieldEncryptionService({}, provider);
    await service.initialize();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  // =========================================================================
  // 1. Initialization guards
  // =========================================================================

  describe('Initialization', () => {
    it('throws KEY_PROVIDER_NOT_INITIALIZED when used before initialize()', async () => {
      const uninitService = createService();
      // Do NOT call initialize()

      await expect(
        uninitService.encrypt('secret', { fieldName: 'ssn' }),
      ).rejects.toThrow(FieldEncryptionError);

      await expect(
        uninitService.encrypt('secret', { fieldName: 'ssn' }),
      ).rejects.toMatchObject({ code: EncryptionErrorCode.KEY_PROVIDER_NOT_INITIALIZED });
    });

    it('does not throw on double initialize() (logs warning only)', async () => {
      // service is already initialized in beforeEach — calling again should be safe
      await expect(service.initialize()).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // 2-4. Encrypt / Decrypt roundtrip for each algorithm
  // =========================================================================

  describe('Encrypt / Decrypt roundtrip', () => {
    const plaintext = 'Hello, Vorion! 🔐 Special chars: <>&"\'';

    it('roundtrips with AES-256-GCM (default)', async () => {
      const encrypted = await service.encrypt(plaintext, {
        fieldName: 'secret',
        classification: DataClassification.CONFIDENTIAL,
      });

      expect(isEncryptedFieldMarker(encrypted)).toBe(true);
      expect(encrypted.__encrypted).toBe(true);
      expect(encrypted.__version).toBe(2);
      expect(encrypted.field.algorithm).toBe(EncryptionAlgorithm.AES_256_GCM);
      expect(encrypted.field.keyVersion).toBeGreaterThanOrEqual(1);
      expect(encrypted.field.fieldName).toBe('secret');

      const decrypted = await service.decrypt(encrypted, { fieldName: 'secret' });
      expect(decrypted).toBe(plaintext);
    });

    it('roundtrips with AES-256-CBC', async () => {
      const encrypted = await service.encrypt(plaintext, {
        fieldName: 'note',
        classification: DataClassification.CONFIDENTIAL,
        algorithm: EncryptionAlgorithm.AES_256_CBC,
      });

      expect(encrypted.field.algorithm).toBe(EncryptionAlgorithm.AES_256_CBC);

      const decrypted = await service.decrypt(encrypted, { fieldName: 'note' });
      expect(decrypted).toBe(plaintext);
    });

    it('roundtrips with ChaCha20-Poly1305', async () => {
      const encrypted = await service.encrypt(plaintext, {
        fieldName: 'token',
        classification: DataClassification.RESTRICTED,
        algorithm: EncryptionAlgorithm.CHACHA20_POLY1305,
      });

      expect(encrypted.field.algorithm).toBe(EncryptionAlgorithm.CHACHA20_POLY1305);

      const decrypted = await service.decrypt(encrypted, { fieldName: 'token' });
      expect(decrypted).toBe(plaintext);
    });
  });

  // =========================================================================
  // 5. Deterministic encryption
  // =========================================================================

  describe('Deterministic encryption', () => {
    it('produces identical ciphertext for the same plaintext and fieldName', async () => {
      const opts = {
        fieldName: 'email',
        classification: DataClassification.CONFIDENTIAL as const,
        deterministic: true,
      };

      const enc1 = await service.encrypt('user@example.com', opts);
      const enc2 = await service.encrypt('user@example.com', opts);

      expect(enc1.field.ciphertext).toBe(enc2.field.ciphertext);
      expect(enc1.field.iv).toBe(enc2.field.iv);
      expect(enc1.field.authTag).toBe(enc2.field.authTag);
      expect(enc1.field.deterministic).toBe(true);

      // And still decrypts correctly
      const decrypted = await service.decrypt(enc1, { fieldName: 'email' });
      expect(decrypted).toBe('user@example.com');
    });
  });

  // =========================================================================
  // 6. Non-deterministic: same plaintext → different ciphertext
  // =========================================================================

  describe('Non-deterministic encryption', () => {
    it('produces different ciphertext for the same plaintext (random IV)', async () => {
      const opts = {
        fieldName: 'ssn',
        classification: DataClassification.RESTRICTED as const,
      };

      const enc1 = await service.encrypt('123-45-6789', opts);
      const enc2 = await service.encrypt('123-45-6789', opts);

      // The IVs (and therefore ciphertexts) should differ
      expect(enc1.field.iv).not.toBe(enc2.field.iv);
      expect(enc1.field.ciphertext).not.toBe(enc2.field.ciphertext);

      // Both still decrypt to the original value
      expect(await service.decrypt(enc1, { fieldName: 'ssn' })).toBe('123-45-6789');
      expect(await service.decrypt(enc2, { fieldName: 'ssn' })).toBe('123-45-6789');
    });
  });

  // =========================================================================
  // 7. AAD field binding — wrong fieldName on decrypt
  // =========================================================================

  describe('AAD field binding', () => {
    it('throws FIELD_NAME_MISMATCH when decrypting with wrong fieldName', async () => {
      const encrypted = await service.encrypt('sensitive-data', {
        fieldName: 'ssn',
        classification: DataClassification.RESTRICTED,
      });

      await expect(
        service.decrypt(encrypted, { fieldName: 'wrong_field' }),
      ).rejects.toMatchObject({ code: EncryptionErrorCode.FIELD_NAME_MISMATCH });
    });
  });

  // =========================================================================
  // 8. Tampered ciphertext detection
  // =========================================================================

  describe('Tampered ciphertext detection', () => {
    it('fails decryption when ciphertext bytes are modified (AES-256-GCM)', async () => {
      const encrypted = await service.encrypt('integrity-check', {
        fieldName: 'data',
        classification: DataClassification.CONFIDENTIAL,
        algorithm: EncryptionAlgorithm.AES_256_GCM,
      });

      // Tamper with the ciphertext — flip a character in the base64 string
      const original = encrypted.field.ciphertext;
      const tampered = Buffer.from(original, 'base64');
      tampered[0] ^= 0xff; // flip first byte
      encrypted.field.ciphertext = tampered.toString('base64');

      await expect(
        service.decrypt(encrypted, { fieldName: 'data' }),
      ).rejects.toThrow(); // GCM auth tag will not match
    });

    it('fails decryption when ciphertext bytes are modified (AES-256-CBC)', async () => {
      const encrypted = await service.encrypt('integrity-check-cbc', {
        fieldName: 'data',
        classification: DataClassification.CONFIDENTIAL,
        algorithm: EncryptionAlgorithm.AES_256_CBC,
      });

      const tampered = Buffer.from(encrypted.field.ciphertext, 'base64');
      tampered[0] ^= 0xff;
      encrypted.field.ciphertext = tampered.toString('base64');

      await expect(
        service.decrypt(encrypted, { fieldName: 'data' }),
      ).rejects.toThrow(); // HMAC verification should fail
    });
  });

  // =========================================================================
  // 9. encryptObject / decryptObject with field policy
  // =========================================================================

  describe('encryptObject / decryptObject', () => {
    it('encrypts and decrypts specified fields according to policy', async () => {
      const policy: FieldEncryptionPolicy = {
        entityName: 'User',
        fields: [
          {
            fieldName: 'ssn',
            classification: DataClassification.RESTRICTED,
            encrypted: true,
          },
          {
            fieldName: 'email',
            classification: DataClassification.CONFIDENTIAL,
            encrypted: true,
            deterministic: true,
          },
          {
            fieldName: 'name',
            classification: DataClassification.INTERNAL,
            encrypted: false, // not encrypted
          },
        ],
      };

      const original = {
        ssn: '123-45-6789',
        email: 'user@example.com',
        name: 'Alice',
      };

      const encObj = await service.encryptObject(original, policy);

      // ssn and email should now be EncryptedFieldMarkers
      expect(isEncryptedFieldMarker(encObj.ssn)).toBe(true);
      expect(isEncryptedFieldMarker(encObj.email)).toBe(true);
      // name should remain plaintext
      expect(encObj.name).toBe('Alice');

      const decObj = await service.decryptObject(encObj, policy);

      expect(decObj.ssn).toBe('123-45-6789');
      expect(decObj.email).toBe('user@example.com');
      expect(decObj.name).toBe('Alice');
    });
  });

  // =========================================================================
  // 10. Re-encrypt with new key version
  // =========================================================================

  describe('reencrypt', () => {
    it('re-encrypts data with a new key version after rotation', async () => {
      const encrypted = await service.encrypt('rotate-me', {
        fieldName: 'secret',
        classification: DataClassification.RESTRICTED,
      });

      expect(encrypted.field.keyVersion).toBe(1);

      // Set env var for V2 key and rotate
      process.env.VORION_ENCRYPTION_KEY_V2 = 'vorion-test-rotated-key-v2-32b!!';
      try {
        const newVersion = await provider.rotateKey();
        expect(newVersion).toBe(2);

        const reencrypted = await service.reencrypt(encrypted, {
          newKeyVersion: 2,
          fieldName: 'secret',
        });

        expect(reencrypted.field.keyVersion).toBe(2);
        expect(reencrypted.field.ciphertext).not.toBe(encrypted.field.ciphertext);

        // Verify the re-encrypted data still decrypts correctly
        const decrypted = await service.decrypt(reencrypted, { fieldName: 'secret' });
        expect(decrypted).toBe('rotate-me');
      } finally {
        delete process.env.VORION_ENCRYPTION_KEY_V2;
      }
    });
  });

  // =========================================================================
  // 11. Audit callback receives events
  // =========================================================================

  describe('Audit callbacks', () => {
    it('invokes the audit callback on encrypt and decrypt', async () => {
      const auditEvents: EncryptionAuditEntry[] = [];
      service.onAudit((entry) => {
        auditEvents.push(entry);
      });

      const encrypted = await service.encrypt('audit-me', {
        fieldName: 'card',
        classification: DataClassification.RESTRICTED,
      });

      await service.decrypt(encrypted, { fieldName: 'card' });

      // Should have received at least an encrypt + decrypt event
      expect(auditEvents.length).toBeGreaterThanOrEqual(2);

      const encryptEvent = auditEvents.find((e) => e.operation === 'encrypt');
      const decryptEvent = auditEvents.find((e) => e.operation === 'decrypt');

      expect(encryptEvent).toBeDefined();
      expect(encryptEvent!.success).toBe(true);
      expect(encryptEvent!.fieldName).toBe('card');
      expect(encryptEvent!.durationMs).toBeGreaterThanOrEqual(0);

      expect(decryptEvent).toBeDefined();
      expect(decryptEvent!.success).toBe(true);
      expect(decryptEvent!.fieldName).toBe('card');
    });
  });

  // =========================================================================
  // 12. Classification: PUBLIC below minimumEncryptionLevel
  // =========================================================================

  describe('Classification gating', () => {
    it('returns unencrypted marker (keyVersion 0) for PUBLIC data below threshold', async () => {
      // Default minimumEncryptionLevel is CONFIDENTIAL, so PUBLIC is below it
      const encrypted = await service.encrypt('public-info', {
        fieldName: 'bio',
        classification: DataClassification.PUBLIC,
      });

      expect(encrypted.__encrypted).toBe(true);
      expect(encrypted.field.keyVersion).toBe(0);
      // ciphertext should be the base64-encoded plaintext (no real encryption)
      expect(Buffer.from(encrypted.field.ciphertext, 'base64').toString('utf-8')).toBe(
        'public-info',
      );

      // decrypt should still return the original value
      const decrypted = await service.decrypt(encrypted, { fieldName: 'bio' });
      expect(decrypted).toBe('public-info');
    });

    it('returns unencrypted marker for INTERNAL data below CONFIDENTIAL threshold', async () => {
      const encrypted = await service.encrypt('internal-data', {
        fieldName: 'notes',
        classification: DataClassification.INTERNAL,
      });

      expect(encrypted.field.keyVersion).toBe(0);

      const decrypted = await service.decrypt(encrypted, { fieldName: 'notes' });
      expect(decrypted).toBe('internal-data');
    });
  });
});

// ===========================================================================
// EnvKeyProvider standalone tests
// ===========================================================================

describe('EnvKeyProvider', () => {
  let provider: EnvKeyProvider;

  beforeEach(async () => {
    provider = new EnvKeyProvider();
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  // =========================================================================
  // 13. deriveFieldKey produces consistent keys
  // =========================================================================

  it('deriveFieldKey produces consistent keys for the same inputs', async () => {
    const version = await provider.getCurrentVersion();
    const key1 = await provider.deriveFieldKey(version, 'ssn');
    const key2 = await provider.deriveFieldKey(version, 'ssn');

    expect(key1.length).toBe(32);
    expect(Buffer.compare(key1, key2)).toBe(0); // identical buffers
  });

  // =========================================================================
  // 14. Different field names → different keys
  // =========================================================================

  it('produces different keys for different field names', async () => {
    const version = await provider.getCurrentVersion();
    const keyA = await provider.deriveFieldKey(version, 'ssn');
    const keyB = await provider.deriveFieldKey(version, 'email');

    expect(Buffer.compare(keyA, keyB)).not.toBe(0);
  });

  // =========================================================================
  // 15. Tenant isolation
  // =========================================================================

  it('produces different keys for the same field with different tenantIds', async () => {
    const version = await provider.getCurrentVersion();
    const keyTenantA = await provider.deriveFieldKey(version, 'ssn', 'tenant-alpha');
    const keyTenantB = await provider.deriveFieldKey(version, 'ssn', 'tenant-beta');

    expect(Buffer.compare(keyTenantA, keyTenantB)).not.toBe(0);
  });

  it('getCurrentVersion returns 1 for freshly initialized provider', async () => {
    const version = await provider.getCurrentVersion();
    expect(version).toBe(1);
  });

  it('deriveDeterministicKey produces consistent keys', async () => {
    const version = await provider.getCurrentVersion();
    const key1 = await provider.deriveDeterministicKey(version, 'email');
    const key2 = await provider.deriveDeterministicKey(version, 'email');

    expect(key1.length).toBe(32);
    expect(Buffer.compare(key1, key2)).toBe(0);
  });

  it('deriveDeterministicKey differs from deriveFieldKey for same inputs', async () => {
    const version = await provider.getCurrentVersion();
    const fieldKey = await provider.deriveFieldKey(version, 'ssn');
    const deterministicKey = await provider.deriveDeterministicKey(version, 'ssn');

    expect(Buffer.compare(fieldKey, deterministicKey)).not.toBe(0);
  });
});

// ===========================================================================
// Mutation-killing: EncryptedFieldMarker structure assertions
// ===========================================================================

describe('FieldEncryptionService — mutation-killing assertions', () => {
  let provider: EnvKeyProvider;
  let service: FieldEncryptionService;

  beforeEach(async () => {
    provider = new EnvKeyProvider();
    service = new FieldEncryptionService({}, provider);
    await service.initialize();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  // =========================================================================
  // Encrypted marker field completeness
  // =========================================================================

  describe('Encrypted marker field completeness', () => {
    it('encrypt result has all required EncryptedFieldMarker fields', async () => {
      const encrypted = await service.encrypt('test-value', {
        fieldName: 'ssn',
        classification: DataClassification.RESTRICTED,
      });

      expect(encrypted.__encrypted).toBe(true);
      expect(encrypted.__version).toBe(2);
      expect(encrypted.field).toBeDefined();
      expect(encrypted.field.ciphertext).toBeDefined();
      expect(encrypted.field.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.field.iv).toBeDefined();
      expect(encrypted.field.iv.length).toBeGreaterThan(0);
      expect(encrypted.field.authTag).toBeDefined();
      expect(encrypted.field.authTag.length).toBeGreaterThan(0);
      expect(encrypted.field.algorithm).toBe(EncryptionAlgorithm.AES_256_GCM);
      expect(encrypted.field.keyVersion).toBe(1);
      expect(encrypted.field.fieldName).toBe('ssn');
      expect(encrypted.field.deterministic).toBe(false);
    });

    it('unencrypted marker (PUBLIC) has keyVersion 0 and empty iv/authTag', async () => {
      const encrypted = await service.encrypt('public-val', {
        fieldName: 'bio',
        classification: DataClassification.PUBLIC,
      });

      expect(encrypted.__encrypted).toBe(true);
      expect(encrypted.__version).toBe(2);
      expect(encrypted.field.keyVersion).toBe(0);
      expect(encrypted.field.iv).toBe('');
      expect(encrypted.field.authTag).toBe('');
      expect(encrypted.field.deterministic).toBe(false);
    });
  });

  // =========================================================================
  // AAD + fieldName logic mutations
  // =========================================================================

  describe('AAD and fieldName handling', () => {
    it('decrypt uses field.fieldName when options.fieldName not provided', async () => {
      const encrypted = await service.encrypt('aad-fallback', {
        fieldName: 'card_number',
        classification: DataClassification.RESTRICTED,
      });

      // Decrypt without explicit fieldName — should use encrypted.field.fieldName
      const decrypted = await service.decrypt(encrypted, {});
      expect(decrypted).toBe('aad-fallback');
    });

    it('encrypt with includeFieldNameInAAD disabled still roundtrips', async () => {
      const svc = new FieldEncryptionService(
        { includeFieldNameInAAD: false },
        new EnvKeyProvider(),
      );
      await svc.initialize();

      const encrypted = await svc.encrypt('no-aad', {
        fieldName: 'test',
        classification: DataClassification.RESTRICTED,
      });
      const decrypted = await svc.decrypt(encrypted, { fieldName: 'test' });
      expect(decrypted).toBe('no-aad');

      await svc.shutdown();
    });
  });

  // =========================================================================
  // Non-deterministic default (deterministic=false)
  // =========================================================================

  describe('deterministic default is false', () => {
    it('encrypt without deterministic option produces non-deterministic output', async () => {
      const opts = {
        fieldName: 'data',
        classification: DataClassification.CONFIDENTIAL as const,
      };

      const enc1 = await service.encrypt('same', opts);
      const enc2 = await service.encrypt('same', opts);

      // deterministic flag should be false
      expect(enc1.field.deterministic).toBe(false);
      expect(enc2.field.deterministic).toBe(false);

      // IVs should differ (random)
      expect(enc1.field.iv).not.toBe(enc2.field.iv);
    });
  });

  // =========================================================================
  // Nested object encryption/decryption
  // =========================================================================

  describe('Nested object with dot-notation paths', () => {
    it('encrypts and decrypts deeply nested fields', async () => {
      const policy: FieldEncryptionPolicy = {
        entityName: 'Profile',
        fields: [
          {
            fieldName: 'personal.ssn',
            classification: DataClassification.RESTRICTED,
            encrypted: true,
          },
          {
            fieldName: 'personal.name',
            classification: DataClassification.INTERNAL,
            encrypted: false,
          },
        ],
      };

      const original = {
        personal: {
          ssn: '999-88-7777',
          name: 'Bob',
        },
      };

      const encObj = await service.encryptObject(original, policy);

      // Nested ssn should be encrypted
      const nested = (encObj as any).personal.ssn;
      expect(isEncryptedFieldMarker(nested)).toBe(true);
      // Name untouched
      expect((encObj as any).personal.name).toBe('Bob');

      const decObj = await service.decryptObject(encObj, policy);
      expect((decObj as any).personal.ssn).toBe('999-88-7777');
      expect((decObj as any).personal.name).toBe('Bob');
    });

    it('handles null/undefined values in encrypted fields gracefully', async () => {
      const policy: FieldEncryptionPolicy = {
        entityName: 'NullTest',
        fields: [
          {
            fieldName: 'missing',
            classification: DataClassification.RESTRICTED,
            encrypted: true,
          },
          {
            fieldName: 'present',
            classification: DataClassification.RESTRICTED,
            encrypted: true,
          },
        ],
      };

      const original = {
        present: 'value',
        // missing is undefined
      };

      const encObj = await service.encryptObject(original as any, policy);
      // missing field should remain absent (undefined), not crash
      expect((encObj as any).missing).toBeUndefined();
      // present field should be encrypted
      expect(isEncryptedFieldMarker((encObj as any).present)).toBe(true);
    });
  });

  // =========================================================================
  // Audit event field assertions
  // =========================================================================

  describe('Audit event completeness', () => {
    it('encrypt audit entry has id, timestamp, operation, success, durationMs', async () => {
      const auditEvents: EncryptionAuditEntry[] = [];
      service.onAudit((entry) => auditEvents.push(entry));

      await service.encrypt('audit-fields', {
        fieldName: 'test',
        classification: DataClassification.RESTRICTED,
      });

      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      const entry = auditEvents.find(e => e.operation === 'encrypt');
      expect(entry).toBeDefined();
      expect(entry!.id).toBeDefined();
      expect(typeof entry!.id).toBe('string');
      expect(entry!.timestamp).toBeInstanceOf(Date);
      expect(entry!.success).toBe(true);
      expect(entry!.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry!.durationMs).toBeLessThan(10000);
      expect(entry!.fieldName).toBe('test');
      expect(entry!.keyVersion).toBe(1);
      expect(entry!.algorithm).toBe(EncryptionAlgorithm.AES_256_GCM);
    });

    it('reencrypt emits audit with REENCRYPT operation', async () => {
      const auditEvents: EncryptionAuditEntry[] = [];
      service.onAudit((entry) => auditEvents.push(entry));

      const encrypted = await service.encrypt('re-audit', {
        fieldName: 'secret',
        classification: DataClassification.RESTRICTED,
      });

      process.env.VORION_ENCRYPTION_KEY_V2 = 'vorion-test-rotated-key-v2-32b!!';
      try {
        await provider.rotateKey();
        await service.reencrypt(encrypted, {
          newKeyVersion: 2,
          fieldName: 'secret',
        });

        const reencryptEvent = auditEvents.find(e => e.operation === 'reencrypt');
        expect(reencryptEvent).toBeDefined();
        expect(reencryptEvent!.success).toBe(true);
        expect(reencryptEvent!.durationMs).toBeGreaterThanOrEqual(0);
        expect(reencryptEvent!.durationMs).toBeLessThan(10000);
        expect(reencryptEvent!.keyVersion).toBe(2);
      } finally {
        delete process.env.VORION_ENCRYPTION_KEY_V2;
      }
    });
  });

  // =========================================================================
  // Invalid input handling
  // =========================================================================

  describe('Invalid input handling', () => {
    it('decrypt throws INVALID_FORMAT for non-marker input', async () => {
      await expect(
        service.decrypt({ not: 'a marker' } as any, { fieldName: 'test' }),
      ).rejects.toMatchObject({ code: EncryptionErrorCode.INVALID_FORMAT });
    });

    it('reencrypt preserves deterministic flag', async () => {
      const encrypted = await service.encrypt('det-reencrypt', {
        fieldName: 'email',
        classification: DataClassification.CONFIDENTIAL,
        deterministic: true,
      });

      expect(encrypted.field.deterministic).toBe(true);

      process.env.VORION_ENCRYPTION_KEY_V2 = 'vorion-test-rotated-key-v2-32b!!';
      try {
        await provider.rotateKey();
        const reencrypted = await service.reencrypt(encrypted, {
          newKeyVersion: 2,
          fieldName: 'email',
        });

        expect(reencrypted.field.deterministic).toBe(true);

        const decrypted = await service.decrypt(reencrypted, { fieldName: 'email' });
        expect(decrypted).toBe('det-reencrypt');
      } finally {
        delete process.env.VORION_ENCRYPTION_KEY_V2;
      }
    });

    it('reencrypt with newAlgorithm changes the algorithm', async () => {
      const encrypted = await service.encrypt('algo-change', {
        fieldName: 'data',
        classification: DataClassification.RESTRICTED,
        algorithm: EncryptionAlgorithm.AES_256_GCM,
      });

      expect(encrypted.field.algorithm).toBe(EncryptionAlgorithm.AES_256_GCM);

      // Re-encrypt with CBC algorithm
      const reencrypted = await service.reencrypt(encrypted, {
        newKeyVersion: 1,
        fieldName: 'data',
        newAlgorithm: EncryptionAlgorithm.AES_256_CBC,
      });

      expect(reencrypted.field.algorithm).toBe(EncryptionAlgorithm.AES_256_CBC);

      const decrypted = await service.decrypt(reencrypted, { fieldName: 'data' });
      expect(decrypted).toBe('algo-change');
    });
  });

  // =========================================================================
  // getCurrentKeyVersion
  // =========================================================================

  describe('getCurrentKeyVersion', () => {
    it('returns 1 for freshly initialized service', async () => {
      const version = await service.getCurrentKeyVersion();
      expect(version).toBe(1);
    });
  });
});
