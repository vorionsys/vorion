/**
 * Hybrid Ed25519 + Dilithium3 Signing for the Proof Layer
 *
 * Provides quantum-resistant hybrid digital signatures by combining classical
 * Ed25519 (WebCrypto) with post-quantum CRYSTALS-Dilithium3 (ML-DSA-65 via
 * @noble/post-quantum). Both signatures must verify for the result to be valid,
 * ensuring security against both classical and quantum adversaries.
 *
 * Combined format (signatures and public keys):
 *   [4 bytes uint32 BE: classical length][classical bytes][pq bytes]
 *
 * @packageDocumentation
 * @module proof/hybrid-signing
 */

import { webcrypto } from 'node:crypto';
import { DilithiumService } from '../security/crypto/post-quantum/dilithium.js';
import { DilithiumParameterSet } from '../security/crypto/post-quantum/types.js';
import { createLogger } from '../common/logger.js';

const crypto = webcrypto;
const logger = createLogger({ component: 'hybrid-signing' });

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a hybrid Ed25519 + Dilithium3 signing operation
 */
export interface HybridSignatureResult {
  /** Classical Ed25519 signature (base64) */
  classicalSignature: string;
  /** PQ Dilithium3 signature (base64) */
  pqSignature: string;
  /** Combined signature format (base64 of: 4-byte classical-length + classical + pq) */
  combinedSignature: string;
  /** Classical Ed25519 public key (base64, SPKI format) */
  classicalPublicKey: string;
  /** PQ Dilithium3 public key (base64, raw) */
  pqPublicKey: string;
  /** Combined public key (base64 of: 4-byte classical-length + classical + pq) */
  combinedPublicKey: string;
  algorithm: 'hybrid-ed25519-dilithium3';
  signedAt: string;
}

/**
 * Result of a hybrid signature verification
 */
export interface HybridVerifyResult {
  valid: boolean;
  classicalValid: boolean;
  pqValid: boolean;
  verifiedAt: string;
  error?: string;
}

// =============================================================================
// Module-level cached state
// =============================================================================

/** Cached Ed25519 key pair (WebCrypto CryptoKeyPair) */
let cachedClassicalKeyPair: CryptoKeyPair | null = null;

/** Cached Dilithium3 key pair (raw Uint8Arrays) */
let cachedPQKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;

/** Cached DilithiumService instance */
let dilithiumService: DilithiumService | null = null;

/** Whether initializeHybridSigning() has been called */
let initialized = false;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Encode a length-prefixed combined buffer from two components.
 *
 * Format: 4 bytes (uint32 big-endian) classical length + classical + pq
 */
function encodeCombined(classical: Uint8Array, pq: Uint8Array): Uint8Array {
  const lengthPrefix = new Uint8Array(4);
  const view = new DataView(lengthPrefix.buffer);
  view.setUint32(0, classical.length, false); // big-endian

  const combined = new Uint8Array(4 + classical.length + pq.length);
  combined.set(lengthPrefix, 0);
  combined.set(classical, 4);
  combined.set(pq, 4 + classical.length);
  return combined;
}

/**
 * Decode a length-prefixed combined buffer into two components.
 */
function decodeCombined(combined: Uint8Array): { classical: Uint8Array; pq: Uint8Array } {
  if (combined.length < 4) {
    throw new Error('Combined buffer too short: must be at least 4 bytes');
  }

  const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  const classicalLength = view.getUint32(0, false); // big-endian

  if (4 + classicalLength > combined.length) {
    throw new Error(
      `Invalid combined format: classical length ${classicalLength} exceeds buffer size ${combined.length - 4}`
    );
  }

  const classical = combined.slice(4, 4 + classicalLength);
  const pq = combined.slice(4 + classicalLength);
  return { classical, pq };
}

/**
 * Convert a Uint8Array to base64 string.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Convert a base64 string to Uint8Array.
 */
function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the hybrid signing subsystem.
 *
 * Generates and caches an Ed25519 key pair (WebCrypto) and a Dilithium3 key
 * pair (@noble/post-quantum via DilithiumService). Must be called before
 * {@link signHybrid} or {@link verifyHybrid}.
 */
export async function initializeHybridSigning(): Promise<void> {
  if (initialized) {
    logger.debug('Hybrid signing already initialized, skipping');
    return;
  }

  logger.info('Initializing hybrid Ed25519 + Dilithium3 signing');

  // Initialize DilithiumService with noble
  dilithiumService = new DilithiumService();
  await dilithiumService.initialize();

  // Generate Ed25519 key pair via WebCrypto
  cachedClassicalKeyPair = (await crypto.subtle.generateKey(
    'Ed25519',
    true, // extractable - needed to export the public key
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  logger.debug('Ed25519 key pair generated via WebCrypto');

  // Generate Dilithium3 key pair
  const pqKeyPair = await dilithiumService.generateKeyPair(DilithiumParameterSet.DILITHIUM3);
  cachedPQKeyPair = {
    publicKey: pqKeyPair.publicKey,
    privateKey: pqKeyPair.privateKey,
  };

  logger.debug(
    {
      pqPublicKeySize: pqKeyPair.publicKey.length,
      pqPrivateKeySize: pqKeyPair.privateKey.length,
      nobleAvailable: dilithiumService.isNativeAvailable(),
    },
    'Dilithium3 key pair generated'
  );

  initialized = true;
  logger.info('Hybrid signing initialized successfully');
}

/**
 * Sign data with both Ed25519 (WebCrypto) and Dilithium3 (noble via DilithiumService).
 *
 * Produces individual signatures and a combined signature that concatenates both
 * using a length-prefixed format.
 *
 * @param data - The string data to sign
 * @returns Hybrid signature result with individual and combined signatures/keys
 * @throws Error if {@link initializeHybridSigning} has not been called
 */
export async function signHybrid(data: string): Promise<HybridSignatureResult> {
  if (!initialized || !cachedClassicalKeyPair || !cachedPQKeyPair || !dilithiumService) {
    throw new Error(
      'Hybrid signing not initialized. Call initializeHybridSigning() first.'
    );
  }

  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);

  // --- Ed25519 signature (WebCrypto) ---
  const classicalSigBuffer = await crypto.subtle.sign(
    'Ed25519',
    cachedClassicalKeyPair.privateKey,
    dataBytes,
  );
  const classicalSigBytes = new Uint8Array(classicalSigBuffer);

  // Export the classical public key in SPKI format
  const classicalPubKeyBuffer = await crypto.subtle.exportKey(
    'spki',
    cachedClassicalKeyPair.publicKey,
  );
  const classicalPubKeyBytes = new Uint8Array(classicalPubKeyBuffer);

  // --- Dilithium3 signature ---
  const pqResult = await dilithiumService.sign(
    cachedPQKeyPair.privateKey,
    dataBytes,
    DilithiumParameterSet.DILITHIUM3,
  );
  const pqSigBytes = pqResult.signature;
  const pqPubKeyBytes = cachedPQKeyPair.publicKey;

  // --- Build combined formats ---
  const combinedSigBytes = encodeCombined(classicalSigBytes, pqSigBytes);
  const combinedPubKeyBytes = encodeCombined(classicalPubKeyBytes, pqPubKeyBytes);

  const signedAt = new Date().toISOString();

  logger.debug(
    {
      classicalSigSize: classicalSigBytes.length,
      pqSigSize: pqSigBytes.length,
      combinedSigSize: combinedSigBytes.length,
    },
    'Hybrid signature generated'
  );

  return {
    classicalSignature: toBase64(classicalSigBytes),
    pqSignature: toBase64(pqSigBytes),
    combinedSignature: toBase64(combinedSigBytes),
    classicalPublicKey: toBase64(classicalPubKeyBytes),
    pqPublicKey: toBase64(pqPubKeyBytes),
    combinedPublicKey: toBase64(combinedPubKeyBytes),
    algorithm: 'hybrid-ed25519-dilithium3',
    signedAt,
  };
}

/**
 * Verify a hybrid Ed25519 + Dilithium3 signature.
 *
 * Splits the combined signature and combined public key, then verifies each
 * independently. Both MUST be valid for the overall result to be valid.
 *
 * @param data - The original string data that was signed
 * @param combinedSignature - Base64 encoded combined signature (length-prefixed)
 * @param combinedPublicKey - Base64 encoded combined public key (length-prefixed)
 * @returns Verification result with individual and overall validity
 */
export async function verifyHybrid(
  data: string,
  combinedSignature: string,
  combinedPublicKey: string,
): Promise<HybridVerifyResult> {
  const verifiedAt = new Date().toISOString();

  if (!dilithiumService) {
    // Allow verification even without full initialization by creating
    // a fresh DilithiumService on the fly.
    dilithiumService = new DilithiumService();
    await dilithiumService.initialize();
  }

  try {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);

    // Decode combined signature and public key
    const sigParts = decodeCombined(fromBase64(combinedSignature));
    const keyParts = decodeCombined(fromBase64(combinedPublicKey));

    // --- Verify Ed25519 (classical) ---
    let classicalValid = false;
    try {
      const classicalPubKey = await crypto.subtle.importKey(
        'spki',
        keyParts.classical,
        { name: 'Ed25519' },
        false,
        ['verify'],
      );

      classicalValid = await crypto.subtle.verify(
        'Ed25519',
        classicalPubKey,
        sigParts.classical,
        dataBytes,
      );
    } catch (err) {
      logger.debug({ error: err }, 'Classical Ed25519 verification failed');
      classicalValid = false;
    }

    // --- Verify Dilithium3 (PQ) ---
    let pqValid = false;
    try {
      const pqResult = await dilithiumService.verify(
        keyParts.pq,
        dataBytes,
        sigParts.pq,
        DilithiumParameterSet.DILITHIUM3,
      );
      pqValid = pqResult.valid;
    } catch (err) {
      logger.debug({ error: err }, 'Dilithium3 PQ verification failed');
      pqValid = false;
    }

    const valid = classicalValid && pqValid;

    logger.debug(
      { classicalValid, pqValid, valid },
      'Hybrid verification complete'
    );

    return {
      valid,
      classicalValid,
      pqValid,
      verifiedAt,
      error: valid
        ? undefined
        : `Classical: ${classicalValid}, PQ: ${pqValid}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Hybrid verification encountered an error');

    return {
      valid: false,
      classicalValid: false,
      pqValid: false,
      verifiedAt,
      error: message,
    };
  }
}

/**
 * Check whether the given algorithm string identifies the hybrid Ed25519 + Dilithium3 scheme.
 *
 * @param algorithm - Algorithm identifier to test
 * @returns true if the algorithm is 'hybrid-ed25519-dilithium3'
 */
export function isHybridAlgorithm(algorithm: string): boolean {
  return algorithm === 'hybrid-ed25519-dilithium3';
}
