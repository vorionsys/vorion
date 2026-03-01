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

  // Helper to create valid attestation
  const createValidAttestation = (
    platform: typeof TEEPlatform[keyof typeof TEEPlatform] = TEEPlatform.SGX,
    overrides: Partial<TEEAttestation> = {}
  ): TEEAttestation => ({
    platform,
    measurementHash: 'abc123def456',
    timestamp: new Date(),
    enclaveId: 'enclave-001',
    signature: 'valid-signature',
    pcrs: {
      PCR0: 'hash0',
      PCR1: 'hash1',
      PCR2: 'hash2',
    },
    validUntil: new Date(Date.now() + 86400000), // 24 hours
    ...overrides,
  });

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
      expect(result.measurementHash).toBe('abc123def456');
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
        pcrs: { PCR0: 'hash0' }, // Missing PCR1 and PCR2
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
          'enclave-001': 'abc123def456',
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
      expect(result.reason).toContain('measurement');
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
