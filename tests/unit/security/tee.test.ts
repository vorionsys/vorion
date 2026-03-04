/**
 * TEE (Trusted Execution Environment) Binding Tests
 *
 * Tests for TEE attestation and key binding including:
 * - Attestation verification
 * - Binding validation
 * - Mock TEE environment
 * - Platform-specific behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TEEBindingService,
  createTEEBindingService,
  TEEError,
  TEEAttestationError,
  TEEKeyBindingError,
} from '../../../src/security/tee.js';
import {
  TEEPlatform,
  type TEEAttestation,
  type TEEKeyBinding,
} from '../../../src/security/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../src/intent/metrics.js', () => ({
  intentRegistry: {
    registerMetric: vi.fn(),
  },
}));

describe('TEE Binding Service', () => {
  let teeService: TEEBindingService;

  // ── Mock helpers: build platform-specific attestation structures ────────────

  // SGX DCAP Quote v3: 436-byte buffer, version=3 at [0:2], MRENCLAVE at [112:144]
  const buildSGXQuote = (measurementInput: string): string => {
    const buf = Buffer.alloc(436, 0);
    buf[0] = 0x03; buf[1] = 0x00; // version = 3 LE
    // Build 32-byte MRENCLAVE: hex decode if possible, else use UTF-8 bytes (non-zero fill)
    const mrBuf = Buffer.alloc(32, 0x42);
    const hexStr = measurementInput.padEnd(64, '4');
    const hexBytes = Buffer.from(hexStr, 'hex');
    if (hexBytes.length >= 8) {
      hexBytes.copy(mrBuf, 0, 0, Math.min(hexBytes.length, 32));
    } else {
      // Non-hex input: embed as UTF-8 so the quote is non-zero and distinct
      Buffer.from(measurementInput, 'utf8').copy(mrBuf, 0, 0, 32);
    }
    mrBuf.copy(buf, 112, 0, 32);
    return buf.toString('base64');
  };

  // Nitro COSE_Sign1 envelope: 64-byte buffer starting with CBOR tag 0xD2
  const buildNitroDoc = (): string => {
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0xd2; // COSE_Sign1 tag
    return buf.toString('base64');
  };

  // SEV-SNP report: 1184-byte buffer, version=2 at [0:4], sigAlgo=1 at [20:24],
  // MEASUREMENT at [144:192] matching the given 96-char hex string
  const buildSEVReport = (measurementHex: string): string => {
    const buf = Buffer.alloc(1184, 0);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 2, true);  // version = 2
    view.setUint32(20, 1, true); // sigAlgo = 1 (ECDSA P-384)
    const measBytes = Buffer.from(measurementHex.slice(0, 96).padEnd(96, '0'), 'hex');
    measBytes.copy(buf, 144, 0, 48);
    return buf.toString('base64');
  };

  // Predefined mock measurement values per platform
  const MOCK_NITRO_PCR = 'a'.repeat(96);       // 96 hex chars = valid SHA-384, non-zero
  const MOCK_SEV_MEAS  = 'ab'.repeat(48);      // 96 hex chars = 48 bytes of 0xAB
  // SGX: MRENCLAVE is 32 bytes = 64 hex chars; must match attestation.measurementHash exactly
  const MOCK_SGX_MEAS  = 'abc123def456' + '4'.repeat(52); // full 64-char MRENCLAVE

  // Build a valid TEEAttestation for any platform, with optional field overrides
  const createValidAttestation = (
    platform: typeof TEEPlatform[keyof typeof TEEPlatform] = TEEPlatform.SGX,
    overrides: Partial<TEEAttestation> = {}
  ): TEEAttestation => {
    let signature: string;
    let measurementHash: string;
    let pcrs: Record<string, string>;

    switch (platform) {
      case TEEPlatform.NITRO:
        measurementHash = MOCK_NITRO_PCR;
        signature = buildNitroDoc();
        pcrs = { PCR0: MOCK_NITRO_PCR, PCR1: 'b'.repeat(96), PCR2: 'c'.repeat(96) };
        break;
      case TEEPlatform.SEV:
        measurementHash = MOCK_SEV_MEAS;
        signature = buildSEVReport(MOCK_SEV_MEAS);
        pcrs = { PCR0: 'hash0', PCR1: 'hash1', PCR2: 'hash2' };
        break;
      case TEEPlatform.TRUSTZONE:
        measurementHash = MOCK_SGX_MEAS;
        signature = Buffer.from(JSON.stringify({
          tee_name: 'op-tee', session_id: 'session-001', measurement: MOCK_SGX_MEAS,
        })).toString('base64');
        pcrs = { PCR0: 'hash0', PCR1: 'hash1', PCR2: 'hash2' };
        break;
      case TEEPlatform.SECURE_ENCLAVE:
        measurementHash = MOCK_SGX_MEAS;
        signature = Buffer.from(JSON.stringify({
          fmt: 'apple-appattest',
          attStmt: { keyHash: MOCK_SGX_MEAS },
          authData: 'dGVzdA==',
        })).toString('base64');
        pcrs = { PCR0: 'hash0', PCR1: 'hash1', PCR2: 'hash2' };
        break;
      default: // SGX
        measurementHash = MOCK_SGX_MEAS;
        signature = buildSGXQuote(MOCK_SGX_MEAS);
        pcrs = { PCR0: 'hash0', PCR1: 'hash1', PCR2: 'hash2' };
    }

    const base: TEEAttestation = {
      platform,
      measurementHash,
      timestamp: new Date(),
      enclaveId: 'enclave-001',
      signature,
      pcrs,
      validUntil: new Date(Date.now() + 86400000), // 24 hours
    };

    // For SGX: if measurementHash is overridden without a signature override,
    // regenerate the SGX quote to match the new measurementHash prefix
    const merged = { ...base, ...overrides };
    if (
      platform === TEEPlatform.SGX &&
      overrides.measurementHash !== undefined &&
      overrides.signature === undefined
    ) {
      merged.signature = buildSGXQuote(overrides.measurementHash);
    }

    return merged;
  };

  beforeEach(() => {
    teeService = createTEEBindingService({
      requiredForTiers: [4, 5],
      allowedPlatforms: [TEEPlatform.SGX, TEEPlatform.NITRO],
      maxAttestationAge: 86400,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Attestation Verification', () => {
    it('should verify valid SGX attestation', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.SGX);
      // measurementHash is the 64-char MRENCLAVE extracted from the mock quote
      expect(result.measurementHash).toMatch(/^abc123def456/);
    });

    it('should verify valid Nitro attestation', async () => {
      const attestation = createValidAttestation(TEEPlatform.NITRO);
      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.NITRO);
    });

    it('should reject attestation from disallowed platform', async () => {
      const attestation = createValidAttestation(TEEPlatform.SEV);
      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Platform not allowed');
    });

    it('should reject expired attestation', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX, {
        timestamp: new Date(Date.now() - 100000000), // Way in the past
      });

      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too old');
    });

    it('should reject attestation with missing signature', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX, {
        signature: undefined,
      });

      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing');
    });

    it('should reject attestation with incomplete PCRs for Nitro', async () => {
      const attestation = createValidAttestation(TEEPlatform.NITRO, {
        pcrs: { PCR0: 'a'.repeat(96) }, // Valid PCR0 format but missing PCR1 and PCR2
      });

      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing required PCR');
    });

    it('should reject attestation with invalid validUntil date', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX, {
        validUntil: new Date(Date.now() - 1000), // Already expired
      });

      const result = await teeService.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });
  });

  describe('Binding Validation', () => {
    it('should bind key to enclave with valid attestation', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      const binding = await teeService.bindKeyToEnclave(
        'did:key:z123#key-1',
        attestation
      );

      expect(binding.didKeyId).toBe('did:key:z123#key-1');
      expect(binding.enclaveKeyId).toBe('enclave-001');
      expect(binding.bindingProof).toBeDefined();
      expect(binding.boundAt).toBeDefined();
    });

    it('should throw error when binding with invalid attestation', async () => {
      const invalidAttestation = createValidAttestation(TEEPlatform.SEV); // Disallowed platform

      await expect(
        teeService.bindKeyToEnclave('did:key:z123#key-1', invalidAttestation)
      ).rejects.toThrow(TEEAttestationError);
    });

    it('should verify valid key binding', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      const binding = await teeService.bindKeyToEnclave(
        'did:key:z123#key-1',
        attestation
      );

      const isValid = await teeService.verifyKeyBinding(binding);
      expect(isValid).toBe(true);
    });

    it('should reject expired key binding', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      const binding = await teeService.bindKeyToEnclave(
        'did:key:z456#key-1',
        attestation
      );

      // Manually expire the binding
      const expiredBinding: TEEKeyBinding = {
        ...binding,
        validUntil: new Date(Date.now() - 1000),
      };

      const isValid = await teeService.verifyKeyBinding(expiredBinding);
      expect(isValid).toBe(false);
    });

    it('should reject binding with empty proof', async () => {
      const invalidBinding: TEEKeyBinding = {
        didKeyId: 'did:key:z123#key-1',
        enclaveKeyId: 'enclave-001',
        bindingProof: '',
        boundAt: new Date(),
      };

      const isValid = await teeService.verifyKeyBinding(invalidBinding);
      expect(isValid).toBe(false);
    });
  });

  describe('Mock TEE Environment', () => {
    it('should support SGX platform verification', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.SGX],
      });

      const attestation = createValidAttestation(TEEPlatform.SGX);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.SGX);
    });

    it('should support Nitro platform verification', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.NITRO],
      });

      const attestation = createValidAttestation(TEEPlatform.NITRO);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.NITRO);
    });

    it('should support SEV platform verification', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.SEV],
      });

      const attestation = createValidAttestation(TEEPlatform.SEV);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.SEV);
    });

    it('should support TrustZone platform verification', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.TRUSTZONE],
      });

      const attestation = createValidAttestation(TEEPlatform.TRUSTZONE);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.TRUSTZONE);
    });

    it('should support Secure Enclave platform verification', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.SECURE_ENCLAVE],
      });

      const attestation = createValidAttestation(TEEPlatform.SECURE_ENCLAVE);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.platform).toBe(TEEPlatform.SECURE_ENCLAVE);
    });
  });

  describe('Trust Tier Requirements', () => {
    it('should require TEE for T4+ tiers', () => {
      expect(teeService.isRequired(0)).toBe(false);
      expect(teeService.isRequired(1)).toBe(false);
      expect(teeService.isRequired(2)).toBe(false);
      expect(teeService.isRequired(3)).toBe(false);
      expect(teeService.isRequired(4)).toBe(true);
      expect(teeService.isRequired(5)).toBe(true);
    });

    it('should respect custom tier configuration', () => {
      const customService = createTEEBindingService({
        requiredForTiers: [3, 4, 5],
      });

      expect(customService.isRequired(2)).toBe(false);
      expect(customService.isRequired(3)).toBe(true);
    });
  });

  describe('Code Measurement Validation', () => {
    it('should validate matching code measurement', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.SGX],
        expectedMeasurements: {
          'enclave-001': MOCK_SGX_MEAS, // must match the full 64-char MRENCLAVE
        },
      });

      const attestation = createValidAttestation(TEEPlatform.SGX);
      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
    });

    it('should reject mismatched code measurement', async () => {
      const service = createTEEBindingService({
        allowedPlatforms: [TEEPlatform.SGX],
        expectedMeasurements: {
          'enclave-001': 'expected-hash',
        },
      });

      const attestation = createValidAttestation(TEEPlatform.SGX, {
        measurementHash: 'different-hash',
      });

      const result = await service.verifyAttestation(attestation);

      expect(result.valid).toBe(false);
      // Reason contains 'mismatch' (structural MRENCLAVE or measurement mismatch)
      expect(result.reason).toContain('mismatch');
    });

    it('should validate PCR0 for Nitro attestation', () => {
      const attestation = createValidAttestation(TEEPlatform.NITRO, {
        pcrs: { PCR0: 'expected-pcr0', PCR1: 'hash1', PCR2: 'hash2' },
      });

      const isValid = teeService.validateCodeMeasurement('expected-pcr0', attestation);
      expect(isValid).toBe(true);
    });
  });

  describe('Binding Management', () => {
    it('should store and retrieve bindings', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      const binding = await teeService.bindKeyToEnclave(
        'did:key:z789#key-1',
        attestation
      );

      const retrieved = teeService.getBinding('did:key:z789#key-1');
      expect(retrieved).toEqual(binding);
    });

    it('should return undefined for non-existent binding', () => {
      const binding = teeService.getBinding('did:key:nonexistent#key-1');
      expect(binding).toBeUndefined();
    });

    it('should remove bindings', async () => {
      const attestation = createValidAttestation(TEEPlatform.SGX);
      await teeService.bindKeyToEnclave('did:key:zremove#key-1', attestation);

      teeService.removeBinding('did:key:zremove#key-1');

      const binding = teeService.getBinding('did:key:zremove#key-1');
      expect(binding).toBeUndefined();
    });
  });

  describe('Configuration', () => {
    it('should return current configuration', () => {
      const config = teeService.getConfig();

      expect(config.requiredForTiers).toEqual([4, 5]);
      expect(config.allowedPlatforms).toContain(TEEPlatform.SGX);
      expect(config.allowedPlatforms).toContain(TEEPlatform.NITRO);
      expect(config.maxAttestationAge).toBe(86400);
    });
  });

  describe('Error Handling', () => {
    it('should throw TEEAttestationError for invalid attestation in binding', async () => {
      const invalidAttestation = createValidAttestation(TEEPlatform.SEV);

      try {
        await teeService.bindKeyToEnclave('did:key:z123#key-1', invalidAttestation);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TEEAttestationError);
        expect((error as TEEAttestationError).code).toBe('TEE_ATTESTATION_ERROR');
      }
    });

    it('should handle malformed attestation gracefully', async () => {
      const malformedAttestation = {
        platform: TEEPlatform.SGX,
        // Missing required fields
      } as TEEAttestation;

      const result = await teeService.verifyAttestation(malformedAttestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid');
    });
  });
});
