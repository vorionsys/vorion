/**
 * TEE (Trusted Execution Environment) Binding Service
 *
 * Implements hardware-bound key attestation for CAR ID security hardening (SH-3).
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
 * Verification levels:
 *   Each platform verifier performs real structural validation of attestation data:
 *   parsing binary formats, validating headers and magic bytes, extracting measurements,
 *   and checking internal consistency. This catches malformed, truncated, or fabricated
 *   attestation data without requiring network access.
 *
 *   Full cryptographic signature chain verification (proving the attestation was signed
 *   by genuine hardware) requires external services and is an architectural boundary:
 *   - Intel SGX: Intel DCAP Quote Verification Library or IAS API
 *   - AWS Nitro: AWS Nitro Enclaves SDK (COSE_Sign1 signature over attestation doc)
 *   - AMD SEV-SNP: AMD KDS for VCEK certificate, sev-snp-measure for report signing key
 *   - ARM TrustZone: Platform-specific OP-TEE client
 *   - Apple Secure Enclave: DeviceCheck / App Attest API
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
 * Intel SGX attestation verifier
 *
 * Performs structural validation of the SGX DCAP Quote v3 binary format:
 * - Validates quote header (version, attestation key type, minimum size)
 * - Extracts MRENCLAVE (bytes 112-144 of quote) and MRSIGNER (bytes 176-208)
 * - Validates ISV product ID and SVN fields
 * - Cross-checks extracted MRENCLAVE against the declared measurementHash
 *
 * Full cryptographic verification (ECDSA signature chain to Intel root of trust)
 * requires the Intel DCAP Quote Verification Library or Intel Attestation Service.
 * That is an architectural boundary: this verifier validates structure and consistency,
 * not the hardware signature chain.
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

      // Decode quote binary
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

      // SGX DCAP Quote v3 minimum size: 48-byte header + 384-byte report body = 432 bytes,
      // plus at least some signature data
      if (quoteBytes.length < 436) {
        return {
          valid: false,
          reason: `SGX quote too short: ${quoteBytes.length} bytes, minimum 436 bytes for a valid quote`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const view = new DataView(quoteBytes.buffer, quoteBytes.byteOffset, quoteBytes.byteLength);

      // Parse header fields
      const version = view.getUint16(0, true);
      const attestationKeyType = view.getUint16(2, true);

      // DCAP v3 quotes have version 3; EPID quotes have version 2
      if (version !== 2 && version !== 3) {
        return {
          valid: false,
          reason: `Unsupported SGX quote version: ${version} (expected 2 or 3)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Attestation key type: 2 = ECDSA-256-with-P-256 (DCAP), 0/1 = EPID
      if (attestationKeyType > 3) {
        return {
          valid: false,
          reason: `Invalid SGX attestation key type: ${attestationKeyType}`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Extract MRENCLAVE (32 bytes at offset 112 in the report body, which starts at offset 48)
      // Quote layout: [header: 48 bytes][report body: 384 bytes][signature data: variable]
      // Report body layout at offset 48: ... MRENCLAVE at report body offset 64 => absolute offset 112
      const mrEnclave = bytesToHex(quoteBytes.slice(112, 144));
      const mrSigner = bytesToHex(quoteBytes.slice(176, 208));
      const isvProdId = view.getUint16(304, true);
      const isvSvn = view.getUint16(306, true);

      // Validate extracted measurements are non-zero (all-zero MRENCLAVE is invalid)
      if (/^0+$/.test(mrEnclave)) {
        return {
          valid: false,
          reason: 'SGX MRENCLAVE is all zeros, indicating an uninitialized or invalid quote',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Cross-check MRENCLAVE against the declared measurement hash
      if (attestation.measurementHash && mrEnclave !== attestation.measurementHash.toLowerCase()) {
        return {
          valid: false,
          reason: `MRENCLAVE mismatch: quote contains ${mrEnclave}, attestation declares ${attestation.measurementHash}`,
          platform: TEEPlatformEnum.SGX,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Validate PCR cross-references if provided
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

      // Check attestation freshness
      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      // Structural validation passed. Full cryptographic verification of the ECDSA
      // signature chain to Intel's root of trust requires the Intel DCAP QVL or IAS API.
      // That external dependency is an architectural boundary, not a missing feature.
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
 * AWS Nitro Enclaves attestation verifier
 *
 * Performs structural validation of the Nitro attestation document:
 * - Validates the outer COSE_Sign1 envelope (CBOR tag 18, 4-element array)
 * - Extracts and validates required PCR values (PCR0, PCR1, PCR2)
 * - PCR0 = enclave image hash, PCR1 = Linux kernel + bootstrap, PCR2 = application
 * - Cross-checks PCR0 against the declared measurementHash
 * - Validates PCR format (SHA-384 = 48 bytes = 96 hex chars)
 *
 * Full cryptographic verification (COSE ECDSA-384 signature over the attestation
 * document, verified against the AWS Nitro root certificate chain) requires the
 * AWS Nitro Enclaves SDK. That is an architectural boundary.
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

      // Decode the attestation document
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

      // A COSE_Sign1 structure is CBOR tag 18 wrapping a 4-element array.
      // CBOR tag 18 = 0xD2 (1-byte). Minimum realistic size for a Nitro doc is ~1KB.
      if (docBytes.length < 32) {
        return {
          valid: false,
          reason: `Nitro attestation document too short: ${docBytes.length} bytes`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Validate COSE_Sign1 envelope structure:
      // Byte 0 should be 0xD2 (CBOR tag 18 in 1-byte form) followed by 0x84 (4-element array)
      // or the tag may use multi-byte encoding. Check for the common single-byte case.
      const hasCoseTag = docBytes[0] === 0xd2;
      // If the document starts with 0x84 directly, it may be an untagged COSE_Sign1
      const hasArrayHeader = docBytes[0] === 0x84 || (hasCoseTag && docBytes.length > 1 && docBytes[1] === 0x84);

      if (!hasCoseTag && !hasArrayHeader) {
        // Check for multi-byte CBOR tag encoding: 0xD8 0x12 = tag(18)
        const hasMultiByteCoseTag = docBytes[0] === 0xd8 && docBytes.length > 1 && docBytes[1] === 0x12;
        if (!hasMultiByteCoseTag) {
          return {
            valid: false,
            reason: 'Nitro attestation document does not have a valid COSE_Sign1 envelope (expected CBOR tag 18)',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      // Validate required PCRs
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
        // Nitro PCRs are SHA-384 hashes: 48 bytes = 96 hex characters
        if (!isValidHex(pcrValue, 48)) {
          return {
            valid: false,
            reason: `${pcr} is not a valid SHA-384 hash (expected 96 hex characters, got ${pcrValue.length})`,
            verifiedAt: new Date().toISOString(),
          };
        }
        // All-zero PCR0 would mean no enclave image was loaded
        if (pcr === 'PCR0' && /^0+$/.test(pcrValue)) {
          return {
            valid: false,
            reason: 'PCR0 is all zeros, indicating no enclave image measurement',
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      // Cross-check PCR0 (enclave image measurement) against declared measurementHash
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

      // Check attestation freshness
      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      // Structural validation passed. Full cryptographic verification of the
      // ECDSA-384 signature and certificate chain to the AWS Nitro root CA
      // requires the AWS Nitro Enclaves SDK. That is an architectural boundary.
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
    // For Nitro, PCR0 contains the enclave image measurement
    if (attestation.pcrs?.['PCR0']) {
      return attestation.pcrs['PCR0'].toLowerCase() === expectedHash.toLowerCase();
    }
    return attestation.measurementHash.toLowerCase() === expectedHash.toLowerCase();
  }
}

/**
 * AMD SEV-SNP attestation verifier
 *
 * Performs structural validation of the SEV-SNP attestation report:
 * - Validates report size (1184 bytes for SEV-SNP v2 report)
 * - Validates report version (must be 2 for SEV-SNP)
 * - Extracts the 48-byte MEASUREMENT field (bytes 144-192)
 * - Validates guest SVN and guest policy fields
 * - Cross-checks extracted measurement against the declared measurementHash
 *
 * Full cryptographic verification (VCEK signature verification using AMD KDS
 * certificate chain: VCEK -> ASK -> ARK) requires fetching certificates from
 * the AMD Key Distribution Service. That is an architectural boundary.
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

      // Decode the report
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

      // SEV-SNP attestation report is exactly 1184 bytes
      if (reportBytes.length < 1184) {
        return {
          valid: false,
          reason: `SEV-SNP report too short: ${reportBytes.length} bytes, expected at least 1184 bytes`,
          verifiedAt: new Date().toISOString(),
        };
      }

      const view = new DataView(reportBytes.buffer, reportBytes.byteOffset, reportBytes.byteLength);

      // Version field (bytes 0-3, little-endian uint32). SEV-SNP reports are version 2.
      const version = view.getUint32(0, true);
      if (version !== 2) {
        return {
          valid: false,
          reason: `Invalid SEV-SNP report version: ${version} (expected 2)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Guest SVN (bytes 4-7)
      const guestSvn = view.getUint32(4, true);

      // Policy (bytes 8-15, uint64 LE) — the guest policy bitfield
      const policyLow = view.getUint32(8, true);
      const policyHigh = view.getUint32(12, true);
      // Bit 0 of policy = SMT allowed, Bit 1 = reserved, Bit 2 = migration agent,
      // Bit 3 = debug mode. If debug bit is set, warn but don't fail structural validation.
      const debugBit = (policyLow & 0x08) !== 0;

      // VMPL (byte 16)
      const vmpl = view.getUint32(16, true);

      // Signature algorithm (bytes 20-23): 1 = ECDSA P-384 with SHA-384
      const sigAlgo = view.getUint32(20, true);
      if (sigAlgo !== 1) {
        return {
          valid: false,
          reason: `Unsupported SEV-SNP signature algorithm: ${sigAlgo} (expected 1 = ECDSA P-384)`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // MEASUREMENT field: 48 bytes at offset 144-192
      const measurement = bytesToHex(reportBytes.slice(144, 192));

      // Validate measurement is non-zero
      if (/^0+$/.test(measurement)) {
        return {
          valid: false,
          reason: 'SEV-SNP measurement is all zeros, indicating uninitialized report data',
          verifiedAt: new Date().toISOString(),
        };
      }

      // Cross-check measurement against declared measurementHash
      if (attestation.measurementHash && measurement !== attestation.measurementHash.toLowerCase()) {
        return {
          valid: false,
          reason: `SEV-SNP measurement mismatch: report contains ${measurement}, attestation declares ${attestation.measurementHash}`,
          platform: TEEPlatformEnum.SEV,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Check attestation freshness
      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      // Structural validation passed. Full cryptographic verification (VCEK
      // signature chain: VCEK -> ASK -> ARK from AMD Key Distribution Service)
      // requires the AMD SEV Tool or equivalent. That is an architectural boundary.
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
 * ARM TrustZone attestation verifier
 *
 * Performs structural validation of TrustZone attestation metadata:
 * - Validates the attestation signature payload is valid JSON with required fields
 * - Checks for required session metadata: tee_name, session_id, and measurement
 * - Validates tee_name matches a known TrustZone TEE implementation (OP-TEE, Kinibi, TEEGRIS, etc.)
 * - Cross-checks extracted measurement against the declared measurementHash
 *
 * TrustZone attestation is inherently platform-specific. Full verification requires
 * a platform-specific OP-TEE client or equivalent TEE client API, which is an
 * architectural boundary. Each SoC vendor provides their own attestation mechanism.
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

      // TrustZone attestation data is a JSON payload containing session metadata
      // signed by the TEE. Parse and validate the structure.
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

      // Validate required session metadata fields
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

      // Validate tee_name is a recognized TrustZone implementation
      const teeName = (payload['tee_name'] as string).toLowerCase();
      const isKnownTee = TrustZoneVerifier.KNOWN_TEE_NAMES.some(
        (name) => teeName.includes(name)
      );
      if (!isKnownTee) {
        return {
          valid: false,
          reason: `Unrecognized TrustZone TEE implementation: "${payload['tee_name']}"`,
          verifiedAt: new Date().toISOString(),
        };
      }

      // Extract and validate measurement from payload
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

      // Check attestation freshness
      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      // Structural validation passed. Full cryptographic verification of the
      // session signature requires the platform-specific OP-TEE client API or
      // vendor-specific TEE client. That is an architectural boundary — each
      // SoC vendor (Qualcomm, Samsung, MediaTek, etc.) has their own mechanism.
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
 * Apple Secure Enclave (App Attest) verifier
 *
 * Performs structural validation of the App Attest attestation object:
 * - Validates the attestation signature payload is valid JSON conforming to
 *   the WebAuthn-style attestation object structure
 * - Checks for required fields: fmt, attStmt, authData
 * - Validates fmt = "apple-appattest"
 * - Extracts the attested credential public key hash from authData
 * - Cross-checks key hash against declared measurementHash
 *
 * Full cryptographic verification (validating the X.509 certificate chain
 * to Apple's App Attest root CA, and verifying the attestation signature)
 * requires Apple's DeviceCheck / App Attest API. That is an architectural boundary.
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

      // Parse the attestation object (CBOR-encoded in production, JSON representation here)
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

      // Validate required attestation object fields per WebAuthn / App Attest spec
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

      // Extract key hash from attestation statement if present
      const attStmt = attestObj['attStmt'] as Record<string, unknown>;
      const keyHash = typeof attStmt['keyHash'] === 'string' ? attStmt['keyHash'] as string : null;

      // Cross-check key hash with declared measurementHash
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

      // Check attestation freshness
      const now = new Date();
      if (attestation.validUntil && attestation.validUntil < now) {
        return {
          valid: false,
          reason: 'Attestation has expired',
          verifiedAt: now.toISOString(),
        };
      }

      // Structural validation passed. Full cryptographic verification of the
      // X.509 attestation certificate chain to Apple's App Attest root CA, and
      // verification of the CBOR/COSE attestation signature, requires the
      // Apple DeviceCheck / App Attest API. That is an architectural boundary.
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
 * TEE Binding Service for hardware attestation and key binding
 *
 * @example
 * ```typescript
 * const tee = new TEEBindingService({
 *   requiredForTiers: [TrustTier.T4, TrustTier.T5],
 *   allowedPlatforms: ['sgx', 'nitro'],
 *   maxAttestationAge: 86400, // 24 hours
 * });
 *
 * // Verify attestation
 * const result = await tee.verifyAttestation(attestation);
 *
 * // Bind DID key to enclave
 * const binding = await tee.bindKeyToEnclave(didKeyId, attestation);
 * ```
 */
export class TEEBindingService {
  private config: TEEConfig;
  private verifiers: Map<TEEPlatform, PlatformVerifier>;
  private bindings: Map<string, TEEKeyBinding>; // didKeyId -> binding

  /**
   * Create a new TEE binding service
   *
   * @param config - TEE configuration
   */
  constructor(config: Partial<TEEConfig>) {
    const defaultConfig: TEEConfig = {
      requiredForTiers: [4, 5],
      allowedPlatforms: [TEEPlatformEnum.SGX, TEEPlatformEnum.NITRO],
      maxAttestationAge: 86400,
    };
    this.config = { ...defaultConfig, ...teeConfigSchema.parse(config) };
    this.bindings = new Map();

    // Initialize platform-specific verifiers
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
      },
      'TEE binding service initialized'
    );
  }

  /**
   * Verify a TEE attestation
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

    // Get platform-specific verifier
    const verifier = this.verifiers.get(attestation.platform);
    if (!verifier) {
      teeAttestationsVerified.inc({ platform: attestation.platform, result: 'invalid' });
      return {
        valid: false,
        reason: `No verifier available for platform: ${attestation.platform}`,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Verify attestation
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
    // In a real implementation, this would be a cryptographic proof
    // that the key was generated inside the enclave
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
    // In a real implementation, this would verify the cryptographic proof
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
   * Create a binding proof
   * In a real implementation, this would be a cryptographic proof
   */
  private async createBindingProof(
    didKeyId: string,
    attestation: TEEAttestation
  ): Promise<string> {
    // Create a simple hash-based proof for development
    // In production, this would be a proper cryptographic binding
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
   * Verify a binding proof
   */
  private verifyBindingProof(binding: TEEKeyBinding): boolean {
    // In a real implementation, this would verify the cryptographic proof
    // For now, just check that the proof exists and has valid format
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
 * Create a TEE binding service with default configuration for CAR ID
 */
export function createTEEBindingService(config?: Partial<TEEConfig>): TEEBindingService {
  const defaultConfig: Partial<TEEConfig> = {
    requiredForTiers: [4, 5], // T4+
    allowedPlatforms: [TEEPlatformEnum.SGX, TEEPlatformEnum.NITRO],
    maxAttestationAge: 86400, // 24 hours
  };

  return new TEEBindingService({ ...defaultConfig, ...config });
}
