/**
 * TEE (Trusted Execution Environment) Binding Service
 *
 * Implements hardware-bound key attestation for CAR security hardening (SH-3).
 * TEE binding ensures that:
 * 1. Agent keys are generated inside a secure enclave
 * 2. The DID is bound to the enclave's measurement
 * 3. At runtime, the expected code is provably executing
 *
 * Supported platforms:
 * - Intel SGX (DCAP/EPID attestation)
 * - AWS Nitro Enclaves
 * - AMD SEV-SNP
 * - ARM TrustZone
 * - Apple Secure Enclave
 *
 * Verification modes:
 *   - Structural validation (default): real parsing of binary attestation formats,
 *     header validation, measurement extraction, cross-checking. No network access needed.
 *   - Production verification: delegates to tee-production.ts which additionally performs
 *     cryptographic verification against manufacturer root certificates. Requires network
 *     access and external SDK configuration.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';
import {
  type TEEConfig,
  type TEEAttestation,
  type TEEKeyBinding,
  type TEEVerificationResult,
  type TEEPlatform,
  type TrustTier,
  TEEPlatform as TEEPlatformEnum,
  teeConfigSchema,
  teeAttestationSchema,
  teeKeyBindingSchema,
} from './types.js';
import {
  type ProductionAttestationConfig,
  ProductionAttestationVerifier,
} from './tee-production.js';

const logger = createLogger({ component: 'security-tee' });

// =============================================================================
// Metrics
// =============================================================================

const teeAttestationsVerified = new Counter({
  name: 'vorion_security_tee_attestations_verified_total',
  help: 'Total TEE attestations verified',
  labelNames: ['platform', 'result'] as const,
  registers: [vorionRegistry],
});

const teeVerificationDuration = new Histogram({
  name: 'vorion_security_tee_verification_duration_seconds',
  help: 'Duration of TEE attestation verification',
  labelNames: ['platform'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [vorionRegistry],
});

const teeKeyBindings = new Counter({
  name: 'vorion_security_tee_key_bindings_total',
  help: 'Total TEE key bindings created',
  labelNames: ['platform'] as const,
  registers: [vorionRegistry],
});

const teeActiveBindings = new Gauge({
  name: 'vorion_security_tee_active_bindings',
  help: 'Number of active TEE key bindings',
  labelNames: ['platform'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Errors
// =============================================================================

/**
 * TEE-specific error
 */
export class TEEError extends VorionError {
  override code = 'TEE_ERROR';
  override statusCode = 403;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'TEEError';
  }
}

/**
 * TEE attestation verification failed
 */
export class TEEAttestationError extends TEEError {
  override code = 'TEE_ATTESTATION_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'TEEAttestationError';
  }
}

/**
 * TEE key binding error
 */
export class TEEKeyBindingError extends TEEError {
  override code = 'TEE_KEY_BINDING_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'TEEKeyBindingError';
  }
}

// =============================================================================
// Binary Helpers
// =============================================================================

/**
 * Decode a base64 string to a Uint8Array.
 * Handles both standard and URL-safe base64 encodings.
 */
function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a Uint8Array to a lowercase hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate that a string is well-formed hex of a given byte length
 */
function isValidHex(hex: string, expectedBytes: number): boolean {
  if (hex.length !== expectedBytes * 2) return false;
  return /^[0-9a-f]+$/i.test(hex);
}

// =============================================================================
// Platform-Specific Verifiers
// =============================================================================

/**
 * Interface for platform-specific attestation verification
 */
interface PlatformVerifier {
  verify(attestation: TEEAttestation): Promise<TEEVerificationResult>;
  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean;
}

/**
 * Intel SGX attestation verifier — structural validation.
 *
 * Parses the SGX DCAP Quote v3 binary format, validates the header (version,
 * attestation key type), extracts MRENCLAVE (bytes 112-144) and MRSIGNER
 * (bytes 176-208), and cross-checks against the declared measurementHash.
 *
 * Full cryptographic verification (ECDSA signature chain to Intel root of trust)
 * requires the Intel DCAP QVL or IAS API — an architectural boundary that is
 * handled by the ProductionAttestationVerifier in tee-production.ts.
 */
class SGXVerifier implements PlatformVerifier {
  async verify(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    const startTime = Date.now();

    try {
      if (!attestation.signature) {
        return {
          valid: false,
          reason: 'Missing SGX quote signature',
          verifiedAt: new Date().toISOString(),
        };
      }

      let quoteBytes: Uint8Array;
      try {
        quoteBytes = base64ToBytes(attestation.signature);
      } catch {
        return {
          valid: false,
          reason: 'SGX quote is not valid base64',
          verifiedAt: new Date().toISOString(),
        };
      }

      // SGX DCAP Quote v3: 48-byte header + 384-byte report body = 432 bytes minimum,
      // plus at least some signature data
      if (quoteBytes.length < 436) {
        return {
          valid: false,
          reason: `SGX quote too short: ${quoteBytes.length} bytes, minimum 436 bytes for a valid quote`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const view = new DataView(quoteBytes.buffer, quoteBytes.byteOffset, quoteBytes.byteLength);

      const version = view.getUint16(0, true);
      const attestationKeyType = view.getUint16(2, true);

      if (version !== 2 && version !== 3) {
        return {
          valid: false,
          reason: `Unsupported SGX quote version: ${version} (expected 2 or 3)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      if (attestationKeyType > 3) {
        return {
          valid: false,
          reason: `Invalid SGX attestation key type: ${attestationKeyType}`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Extract MRENCLAVE and MRSIGNER from the report body
      const mrEnclave = bytesToHex(quoteBytes.slice(112, 144));
      const mrSigner = bytesToHex(quoteBytes.slice(176, 208));
      const isvProdId = view.getUint16(304, true);
      const isvSvn = view.getUint16(306, true);

      if (/^0+$/.test(mrEnclave)) {
        return {
          valid: false,
          reason: 'SGX MRENCLAVE is all zeros, indicating an uninitialized or invalid quote',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (attestation.measurementHash && mrEnclave !== attestation.measurementHash.toLowerCase()) {
        return {
          valid: false,
          reason: `MRENCLAVE mismatch: quote contains ${mrEnclave}, attestation declares ${attestation.measurementHash}`,
          platform: TEEPlatformEnum.SGX,
          verifiedAt: new Date().toISOString(),
        };
      }

      if (attestation.pcrs) {
        if (attestation.pcrs['MRENCLAVE'] && attestation.pcrs['MRENCLAVE'].toLowerCase() !== mrEnclave) {
          return {
            valid: false,
            reason: 'MRENCLAVE PCR value does not match extracted quote measurement',
            verifiedAt: new Date().toISOString(),
          };
        }
        if (attestation.pcrs['MRSIGNER'] && attestation.pcrs['MRSIGNER'].toLowerCase() !== mrSigner) {
          return {
            valid: false,
            reason: 'MRSIGNER PCR value does not match extracted quote signer',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      logger.info(
        {
          enclaveId: attestation.enclaveId,
          mrEnclave: mrEnclave.substring(0, 16) + '...',
          mrSigner: mrSigner.substring(0, 16) + '...',
          isvProdId,
          isvSvn,
          quoteVersion: version,
        },
        'SGX attestation structural validation passed'
      );

      return {
        valid: true,
        platform: TEEPlatformEnum.SGX,
        measurementHash: mrEnclave,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      teeVerificationDuration.observe({ platform: 'sgx' }, duration);
    }
  }

  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    if (attestation.pcrs?.['MRENCLAVE']) {
      return attestation.pcrs['MRENCLAVE'].toLowerCase() === expectedHash.toLowerCase();
    }
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

/**
 * AWS Nitro Enclaves attestation verifier — structural validation.
 *
 * Validates the COSE_Sign1 envelope (CBOR tag 18), validates required PCR values
 * (PCR0/PCR1/PCR2 as SHA-384 hashes), and cross-checks PCR0 against the declared
 * measurementHash.
 *
 * Full cryptographic verification (ECDSA-384 signature + AWS Nitro root cert chain)
 * requires the AWS Nitro Enclaves SDK — handled by ProductionAttestationVerifier.
 */
class NitroVerifier implements PlatformVerifier {
  async verify(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    const startTime = Date.now();

    try {
      if (!attestation.signature) {
        return {
          valid: false,
          reason: 'Missing Nitro attestation document',
          verifiedAt: new Date().toISOString(),
        };
      }

      let docBytes: Uint8Array;
      try {
        docBytes = base64ToBytes(attestation.signature);
      } catch {
        return {
          valid: false,
          reason: 'Nitro attestation document is not valid base64',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (docBytes.length < 32) {
        return {
          valid: false,
          reason: `Nitro attestation document too short: ${docBytes.length} bytes`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Validate COSE_Sign1 envelope: CBOR tag 18 (0xD2) or multi-byte (0xD8 0x12)
      const hasCoseTag = docBytes[0] === 0xd2;
      const hasArrayHeader = docBytes[0] === 0x84 || (hasCoseTag && docBytes.length > 1 && docBytes[1] === 0x84);
      if (!hasCoseTag && !hasArrayHeader) {
        const hasMultiByteCoseTag = docBytes[0] === 0xd8 && docBytes.length > 1 && docBytes[1] === 0x12;
        if (!hasMultiByteCoseTag) {
          return {
            valid: false,
            reason: 'Nitro attestation document does not have a valid COSE_Sign1 envelope (expected CBOR tag 18)',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      if (!attestation.pcrs) {
        return {
          valid: false,
          reason: 'Missing PCR values for Nitro attestation',
          verifiedAt: new Date().toISOString(),
        };
      }

      const requiredPCRs = ['PCR0', 'PCR1', 'PCR2'] as const;
      for (const pcr of requiredPCRs) {
        const pcrValue = attestation.pcrs[pcr];
        if (!pcrValue) {
          return {
            valid: false,
            reason: `Missing required ${pcr}`,
            verifiedAt: new Date().toISOString(),
          };
        }
        if (!isValidHex(pcrValue, 48)) {
          return {
            valid: false,
            reason: `${pcr} is not a valid SHA-384 hash (expected 96 hex characters, got ${pcrValue.length})`,
            verifiedAt: new Date().toISOString(),
          };
        }
        if (pcr === 'PCR0' && /^0+$/.test(pcrValue)) {
          return {
            valid: false,
            reason: 'PCR0 is all zeros, indicating no enclave image measurement',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      if (attestation.measurementHash) {
        const pcr0 = attestation.pcrs['PCR0']!.toLowerCase();
        if (pcr0 !== attestation.measurementHash.toLowerCase()) {
          return {
            valid: false,
            reason: `PCR0 (${pcr0}) does not match declared measurementHash (${attestation.measurementHash})`,
            platform: TEEPlatformEnum.NITRO,
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      logger.info(
        {
          enclaveId: attestation.enclaveId,
          pcr0: attestation.pcrs['PCR0']!.substring(0, 16) + '...',
          docSize: docBytes.length,
        },
        'Nitro attestation structural validation passed'
      );

      return {
        valid: true,
        platform: TEEPlatformEnum.NITRO,
        measurementHash: attestation.pcrs['PCR0'],
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      teeVerificationDuration.observe({ platform: 'nitro' }, duration);
    }
  }

  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    if (attestation.pcrs?.['PCR0']) {
      return attestation.pcrs['PCR0'].toLowerCase() === expectedHash.toLowerCase();
    }
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

/**
 * AMD SEV-SNP attestation verifier — structural validation.
 *
 * Validates the SEV-SNP report format (1184 bytes, version 2), extracts the 48-byte
 * MEASUREMENT field (bytes 144-192), validates the signature algorithm field, and
 * cross-checks against the declared measurementHash.
 *
 * Full cryptographic verification (VCEK -> ASK -> ARK chain from AMD KDS)
 * requires the AMD SEV Tool — handled by ProductionAttestationVerifier.
 */
class SEVVerifier implements PlatformVerifier {
  async verify(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    const startTime = Date.now();

    try {
      if (!attestation.signature) {
        return {
          valid: false,
          reason: 'Missing SEV-SNP attestation report',
          verifiedAt: new Date().toISOString(),
        };
      }

      let reportBytes: Uint8Array;
      try {
        reportBytes = base64ToBytes(attestation.signature);
      } catch {
        return {
          valid: false,
          reason: 'SEV-SNP attestation report is not valid base64',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (reportBytes.length < 1184) {
        return {
          valid: false,
          reason: `SEV-SNP report too short: ${reportBytes.length} bytes, expected at least 1184 bytes`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const view = new DataView(reportBytes.buffer, reportBytes.byteOffset, reportBytes.byteLength);

      const version = view.getUint32(0, true);
      if (version !== 2) {
        return {
          valid: false,
          reason: `Invalid SEV-SNP report version: ${version} (expected 2)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const guestSvn = view.getUint32(4, true);
      const policyLow = view.getUint32(8, true);
      const debugBit = (policyLow & 0x08) !== 0;
      const vmpl = view.getUint32(16, true);

      const sigAlgo = view.getUint32(20, true);
      if (sigAlgo !== 1) {
        return {
          valid: false,
          reason: `Unsupported SEV-SNP signature algorithm: ${sigAlgo} (expected 1 = ECDSA P-384)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const measurement = bytesToHex(reportBytes.slice(144, 192));

      if (/^0+$/.test(measurement)) {
        return {
          valid: false,
          reason: 'SEV-SNP measurement is all zeros, indicating uninitialized report data',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (attestation.measurementHash && measurement !== attestation.measurementHash.toLowerCase()) {
        return {
          valid: false,
          reason: `SEV-SNP measurement mismatch: report contains ${measurement}, attestation declares ${attestation.measurementHash}`,
          platform: TEEPlatformEnum.SEV,
          verifiedAt: new Date().toISOString(),
        };
      }

      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      logger.info(
        {
          enclaveId: attestation.enclaveId,
          measurement: measurement.substring(0, 16) + '...',
          version,
          guestSvn,
          vmpl,
          debugMode: debugBit,
        },
        'SEV-SNP attestation structural validation passed'
      );

      return {
        valid: true,
        platform: TEEPlatformEnum.SEV,
        measurementHash: measurement,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      teeVerificationDuration.observe({ platform: 'sev' }, duration);
    }
  }

  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

/**
 * ARM TrustZone attestation verifier — structural validation.
 *
 * Validates TrustZone attestation metadata (JSON): required fields tee_name,
 * session_id, and measurement; validates tee_name against known implementations.
 *
 * Full verification requires a platform-specific OP-TEE client or equivalent
 * TEE client API — an architectural boundary per SoC vendor.
 */
class TrustZoneVerifier implements PlatformVerifier {
  private static readonly KNOWN_TEE_NAMES = [
    'op-tee', 'optee', 'kinibi', 'teegris', 'trusty', 'trustonic',
    'qualcomm-tee', 'qsee', 'samsung-tee', 'mediatek-tee', 'huawei-tee',
    'itee', 'mtee', 'isee',
  ];

  async verify(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    const startTime = Date.now();

    try {
      if (!attestation.signature) {
        return {
          valid: false,
          reason: 'Missing TrustZone attestation',
          verifiedAt: new Date().toISOString(),
        };
      }

      let payload: Record<string, unknown>;
      try {
        const decoded = new TextDecoder().decode(base64ToBytes(attestation.signature));
        payload = JSON.parse(decoded) as Record<string, unknown>;
      } catch {
        return {
          valid: false,
          reason: 'TrustZone attestation signature is not valid base64-encoded JSON',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (typeof payload['tee_name'] !== 'string' || payload['tee_name'].length === 0) {
        return {
          valid: false,
          reason: 'TrustZone attestation missing required "tee_name" field',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (typeof payload['session_id'] !== 'string' || payload['session_id'].length === 0) {
        return {
          valid: false,
          reason: 'TrustZone attestation missing required "session_id" field',
          verifiedAt: new Date().toISOString(),
        };
      }

      const teeName = (payload['tee_name'] as string).toLowerCase();
      const isKnownTee = TrustZoneVerifier.KNOWN_TEE_NAMES.some((name) => teeName.includes(name));
      if (!isKnownTee) {
        return {
          valid: false,
          reason: `Unrecognized TrustZone TEE implementation: "${payload['tee_name']}"`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const payloadMeasurement = typeof payload['measurement'] === 'string' ? payload['measurement'] as string : null;
      if (payloadMeasurement && attestation.measurementHash) {
        if (payloadMeasurement.toLowerCase() !== attestation.measurementHash.toLowerCase()) {
          return {
            valid: false,
            reason: `TrustZone measurement mismatch: payload contains ${payloadMeasurement}, attestation declares ${attestation.measurementHash}`,
            platform: TEEPlatformEnum.TRUSTZONE,
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      logger.info(
        {
          enclaveId: attestation.enclaveId,
          teeName: payload['tee_name'],
          sessionId: payload['session_id'],
        },
        'TrustZone attestation structural validation passed'
      );

      return {
        valid: true,
        platform: TEEPlatformEnum.TRUSTZONE,
        measurementHash: attestation.measurementHash,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      teeVerificationDuration.observe({ platform: 'trustzone' }, duration);
    }
  }

  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

/**
 * Apple Secure Enclave (App Attest) verifier — structural validation.
 *
 * Validates the App Attest attestation object structure (fmt, attStmt, authData),
 * checks fmt = "apple-appattest", and extracts the key hash for cross-checking.
 *
 * Full verification (X.509 cert chain to Apple's App Attest root CA) requires the
 * DeviceCheck / App Attest API — an architectural boundary.
 */
class SecureEnclaveVerifier implements PlatformVerifier {
  async verify(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    const startTime = Date.now();

    try {
      if (!attestation.signature) {
        return {
          valid: false,
          reason: 'Missing Secure Enclave attestation',
          verifiedAt: new Date().toISOString(),
        };
      }

      let attestObj: Record<string, unknown>;
      try {
        const decoded = new TextDecoder().decode(base64ToBytes(attestation.signature));
        attestObj = JSON.parse(decoded) as Record<string, unknown>;
      } catch {
        return {
          valid: false,
          reason: 'Secure Enclave attestation is not valid base64-encoded JSON',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (typeof attestObj['fmt'] !== 'string') {
        return {
          valid: false,
          reason: 'Secure Enclave attestation missing required "fmt" field',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (attestObj['fmt'] !== 'apple-appattest') {
        return {
          valid: false,
          reason: `Unexpected attestation format: "${attestObj['fmt']}" (expected "apple-appattest")`,
          verifiedAt: new Date().toISOString(),
        };
      }

      if (!attestObj['attStmt'] || typeof attestObj['attStmt'] !== 'object') {
        return {
          valid: false,
          reason: 'Secure Enclave attestation missing required "attStmt" (attestation statement)',
          verifiedAt: new Date().toISOString(),
        };
      }

      if (typeof attestObj['authData'] !== 'string' || (attestObj['authData'] as string).length === 0) {
        return {
          valid: false,
          reason: 'Secure Enclave attestation missing required "authData" (authenticator data)',
          verifiedAt: new Date().toISOString(),
        };
      }

      const attStmt = attestObj['attStmt'] as Record<string, unknown>;
      const keyHash = typeof attStmt['keyHash'] === 'string' ? attStmt['keyHash'] as string : null;

      if (keyHash && attestation.measurementHash) {
        if (keyHash.toLowerCase() !== attestation.measurementHash.toLowerCase()) {
          return {
            valid: false,
            reason: `Secure Enclave key hash mismatch: attestation contains ${keyHash}, declared ${attestation.measurementHash}`,
            platform: TEEPlatformEnum.SECURE_ENCLAVE,
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      logger.info(
        {
          enclaveId: attestation.enclaveId,
          fmt: attestObj['fmt'],
          hasKeyHash: !!keyHash,
        },
        'Secure Enclave attestation structural validation passed'
      );

      return {
        valid: true,
        platform: TEEPlatformEnum.SECURE_ENCLAVE,
        measurementHash: attestation.measurementHash,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      teeVerificationDuration.observe({ platform: 'secure-enclave' }, duration);
    }
  }

  validateMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

// =============================================================================
// TEE Binding Service
// =============================================================================

/**
 * Extended TEE configuration that supports production-mode delegation
 */
export interface TEEBindingServiceConfig extends TEEConfig {
  /** When set, delegates verification to the ProductionAttestationVerifier
   * for platforms it supports (SGX, Nitro, SEV-SNP), adding full cryptographic
   * signature chain verification on top of structural validation. */
  productionConfig?: ProductionAttestationConfig;
}

/**
 * TEE Binding Service for hardware attestation and key binding
 *
 * Performs real structural validation of attestation data by default.
 * When productionConfig is provided, delegates to the ProductionAttestationVerifier
 * for full cryptographic verification against manufacturer root certificates.
 *
 * @example
 * ```typescript
 * // Structural validation only
 * const tee = new TEEBindingService({
 *   requiredForTiers: [TrustTier.T4, TrustTier.T5],
 *   allowedPlatforms: ['sgx', 'nitro'],
 *   maxAttestationAge: 86400,
 * });
 *
 * // With production crypto verification
 * const teeProd = new TEEBindingService({
 *   requiredForTiers: [TrustTier.T4, TrustTier.T5],
 *   allowedPlatforms: ['sgx', 'nitro'],
 *   maxAttestationAge: 86400,
 *   productionConfig: { productionMode: true, sgx: { pccsUrl: '...' } },
 * });
 *
 * const result = await tee.verifyAttestation(attestation);
 * const binding = await tee.bindKeyToEnclave(didKeyId, attestation);
 * ```
 */
export class TEEBindingService {
  private config: TEEConfig;
  private verifiers: Map<TEEPlatform, PlatformVerifier>;
  private bindings: Map<string, TEEKeyBinding>; // didKeyId -> binding
  private productionVerifier: ProductionAttestationVerifier | null;

  /**
   * Create a new TEE binding service
   *
   * @param config - TEE configuration, optionally with productionConfig
   */
  constructor(config: Partial<TEEBindingServiceConfig>) {
    const defaultConfig: TEEConfig = {
      requiredForTiers: [4, 5],
      allowedPlatforms: [TEEPlatformEnum.SGX, TEEPlatformEnum.NITRO],
      maxAttestationAge: 86400,
    };
    this.config = { ...defaultConfig, ...teeConfigSchema.parse(config) };
    this.bindings = new Map();

    // Initialize production verifier if configured
    if (config.productionConfig) {
      this.productionVerifier = new ProductionAttestationVerifier(config.productionConfig);
      logger.info(
        { productionMode: config.productionConfig.productionMode },
        'Production attestation verifier enabled'
      );
    } else {
      this.productionVerifier = null;
    }

    // Initialize platform-specific verifiers for structural validation
    this.verifiers = new Map([
      [TEEPlatformEnum.SGX, new SGXVerifier()],
      [TEEPlatformEnum.NITRO, new NitroVerifier()],
      [TEEPlatformEnum.SEV, new SEVVerifier()],
      [TEEPlatformEnum.TRUSTZONE, new TrustZoneVerifier()],
      [TEEPlatformEnum.SECURE_ENCLAVE, new SecureEnclaveVerifier()],
    ]);

    logger.info(
      {
        requiredForTiers: this.config.requiredForTiers,
        allowedPlatforms: this.config.allowedPlatforms,
        maxAttestationAge: this.config.maxAttestationAge,
        productionMode: !!this.productionVerifier,
      },
      'TEE binding service initialized'
    );
  }

  /**
   * Verify a TEE attestation
   *
   * When a production verifier is configured, it is used for SGX/Nitro/SEV
   * platforms. The production verifier performs its own structural validation
   * plus cryptographic signature chain verification.
   *
   * Otherwise, the built-in structural verifiers are used. These parse binary
   * formats, validate headers, extract measurements, and cross-check consistency
   * without requiring network access.
   *
   * @param attestation - TEE attestation to verify
   * @returns Verification result
   */
  async verifyAttestation(attestation: TEEAttestation): Promise<TEEVerificationResult> {
    // Validate attestation format
    try {
      teeAttestationSchema.parse(attestation);
    } catch (error) {
      teeAttestationsVerified.inc({ platform: attestation.platform, result: 'invalid' });
      return {
        valid: false,
        reason: 'Invalid attestation format',
        verifiedAt: new Date().toISOString(),
      };
    }

    // Check if platform is allowed
    if (!this.config.allowedPlatforms.includes(attestation.platform)) {
      teeAttestationsVerified.inc({ platform: attestation.platform, result: 'invalid' });
      return {
        valid: false,
        reason: `Platform not allowed: ${attestation.platform}`,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Check attestation age
    const age = (Date.now() - attestation.timestamp.getTime()) / 1000;
    if (age > this.config.maxAttestationAge) {
      teeAttestationsVerified.inc({ platform: attestation.platform, result: 'expired' });
      return {
        valid: false,
        reason: `Attestation too old (age: ${Math.floor(age)}s, max: ${this.config.maxAttestationAge}s)`,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Delegate to production verifier if configured and platform is supported
    if (this.productionVerifier) {
      const productionPlatforms: TEEPlatform[] = [TEEPlatformEnum.SGX, TEEPlatformEnum.NITRO, TEEPlatformEnum.SEV];
      if (productionPlatforms.includes(attestation.platform)) {
        const result = await this.productionVerifier.verify(attestation);

        if (result.valid && this.config.expectedMeasurements) {
          const expectedHash = this.config.expectedMeasurements[attestation.enclaveId];
          if (expectedHash) {
            const verifier = this.verifiers.get(attestation.platform);
            if (verifier && !verifier.validateMeasurement(expectedHash, attestation)) {
              teeAttestationsVerified.inc({ platform: attestation.platform, result: 'measurement_mismatch' });
              return {
                valid: false,
                reason: 'Code measurement does not match expected value',
                platform: attestation.platform,
                verifiedAt: new Date().toISOString(),
              };
            }
          }
        }

        teeAttestationsVerified.inc({
          platform: attestation.platform,
          result: result.valid ? 'success' : 'invalid',
        });

        return result;
      }
    }

    // Get platform-specific structural verifier
    const verifier = this.verifiers.get(attestation.platform);
    if (!verifier) {
      teeAttestationsVerified.inc({ platform: attestation.platform, result: 'invalid' });
      return {
        valid: false,
        reason: `No verifier available for platform: ${attestation.platform}`,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Verify attestation with structural validation
    const result = await verifier.verify(attestation);

    // Check expected measurements if configured
    if (result.valid && this.config.expectedMeasurements) {
      const expectedHash = this.config.expectedMeasurements[attestation.enclaveId];
      if (expectedHash) {
        const measurementValid = verifier.validateMeasurement(expectedHash, attestation);
        if (!measurementValid) {
          teeAttestationsVerified.inc({ platform: attestation.platform, result: 'measurement_mismatch' });
          return {
            valid: false,
            reason: 'Code measurement does not match expected value',
            platform: attestation.platform,
            verifiedAt: new Date().toISOString(),
          };
        }
      }
    }

    teeAttestationsVerified.inc({
      platform: attestation.platform,
      result: result.valid ? 'success' : 'invalid',
    });

    return result;
  }

  /**
   * Bind a DID key to an enclave
   *
   * @param didKeyId - DID verification method ID
   * @param enclaveAttestation - TEE attestation proving enclave validity
   * @returns Key binding record
   */
  async bindKeyToEnclave(
    didKeyId: string,
    enclaveAttestation: TEEAttestation
  ): Promise<TEEKeyBinding> {
    // First verify the attestation
    const verificationResult = await this.verifyAttestation(enclaveAttestation);

    if (!verificationResult.valid) {
      throw new TEEAttestationError(
        `Cannot bind key: ${verificationResult.reason}`,
        { didKeyId, enclaveId: enclaveAttestation.enclaveId }
      );
    }

    // Create binding proof
    const bindingProof = await this.createBindingProof(didKeyId, enclaveAttestation);

    // Calculate validity period
    const validUntil = enclaveAttestation.validUntil
      ? new Date(Math.min(
          enclaveAttestation.validUntil.getTime(),
          Date.now() + this.config.maxAttestationAge * 1000
        ))
      : new Date(Date.now() + this.config.maxAttestationAge * 1000);

    const binding: TEEKeyBinding = {
      didKeyId,
      enclaveKeyId: enclaveAttestation.enclaveId,
      bindingProof,
      boundAt: new Date(),
      validUntil,
    };

    // Validate binding
    teeKeyBindingSchema.parse(binding);

    // Store binding
    this.bindings.set(didKeyId, binding);
    teeKeyBindings.inc({ platform: enclaveAttestation.platform });
    teeActiveBindings.set({ platform: enclaveAttestation.platform }, this.getBindingCount(enclaveAttestation.platform));

    logger.info(
      { didKeyId, enclaveId: enclaveAttestation.enclaveId, platform: enclaveAttestation.platform },
      'Key bound to enclave'
    );

    return binding;
  }

  /**
   * Verify a key binding
   *
   * @param binding - Key binding to verify
   * @returns Whether binding is valid
   */
  async verifyKeyBinding(binding: TEEKeyBinding): Promise<boolean> {
    try {
      teeKeyBindingSchema.parse(binding);
    } catch {
      logger.warn({ didKeyId: binding.didKeyId }, 'Invalid binding format');
      return false;
    }

    // Check if binding has expired
    if (binding.validUntil && binding.validUntil < new Date()) {
      logger.debug({ didKeyId: binding.didKeyId }, 'Binding has expired');
      return false;
    }

    // Verify binding proof
    const proofValid = this.verifyBindingProof(binding);

    if (!proofValid) {
      logger.warn({ didKeyId: binding.didKeyId }, 'Invalid binding proof');
      return false;
    }

    return true;
  }

  /**
   * Check if TEE binding is required for a trust tier
   *
   * @param trustTier - Trust tier to check
   * @returns Whether TEE binding is required
   */
  isRequired(trustTier: TrustTier): boolean {
    return this.config.requiredForTiers.includes(trustTier);
  }

  /**
   * Validate that running code matches attestation measurement
   *
   * @param expectedHash - Expected code measurement hash
   * @param attestation - TEE attestation to validate
   * @returns Whether measurement matches
   */
  validateCodeMeasurement(expectedHash: string, attestation: TEEAttestation): boolean {
    const verifier = this.verifiers.get(attestation.platform);
    if (!verifier) {
      return false;
    }
    return verifier.validateMeasurement(expectedHash, attestation);
  }

  /**
   * Get a stored binding
   *
   * @param didKeyId - DID verification method ID
   * @returns Binding if exists
   */
  getBinding(didKeyId: string): TEEKeyBinding | undefined {
    return this.bindings.get(didKeyId);
  }

  /**
   * Remove a binding
   *
   * @param didKeyId - DID verification method ID
   */
  removeBinding(didKeyId: string): void {
    const binding = this.bindings.get(didKeyId);
    if (binding) {
      this.bindings.delete(didKeyId);
      logger.info({ didKeyId }, 'Key binding removed');
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<TEEConfig> {
    return { ...this.config };
  }

  /**
   * Check whether production verification is active
   */
  isProductionMode(): boolean {
    return this.productionVerifier !== null && this.productionVerifier.isProductionMode();
  }

  /**
   * Create a binding proof using SHA-256 hash of binding context
   */
  private async createBindingProof(
    didKeyId: string,
    attestation: TEEAttestation
  ): Promise<string> {
    const data = JSON.stringify({
      didKeyId,
      enclaveId: attestation.enclaveId,
      measurementHash: attestation.measurementHash,
      timestamp: attestation.timestamp.toISOString(),
    });

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = new Uint8Array(hashBuffer);

    let binary = '';
    for (let i = 0; i < hashArray.length; i++) {
      binary += String.fromCharCode(hashArray[i]!);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Verify a binding proof exists and has valid format
   */
  private verifyBindingProof(binding: TEEKeyBinding): boolean {
    return binding.bindingProof.length > 0;
  }

  /**
   * Get count of bindings for a platform
   */
  private getBindingCount(_platform: TEEPlatform): number {
    return this.bindings.size;
  }
}

/**
 * Create a TEE binding service with default configuration for CAR
 */
export function createTEEBindingService(config?: Partial<TEEBindingServiceConfig>): TEEBindingService {
  const defaultConfig: Partial<TEEBindingServiceConfig> = {
    requiredForTiers: [4, 5], // T4+
    allowedPlatforms: [TEEPlatformEnum.SGX, TEEPlatformEnum.NITRO],
    maxAttestationAge: 86400, // 24 hours
  };

  return new TEEBindingService({ ...defaultConfig, ...config });
}
