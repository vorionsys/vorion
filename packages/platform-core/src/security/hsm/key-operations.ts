/**
 * Key Operations Module
 *
 * Provides high-level cryptographic operations using HSM-backed keys.
 * This module abstracts common key management patterns for:
 * - Key generation with FIPS 140-3 compliant algorithms
 * - Digital signatures (ECDSA, RSA-PSS, Ed25519)
 * - Envelope encryption with automatic key wrapping
 * - Key derivation (HKDF, PBKDF2)
 * - Secure key import/export
 *
 * @module security/hsm/key-operations
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  IHSMProvider,
  KeySpec,
  KeyHandle,
  KeyType,
  KeyUsage,
  ECCurve,
  EncryptionOptions,
  EncryptionAlgorithm,
  SigningAlgorithm,
  HSMOperationError,
  HSMKeyNotFoundError,
} from './provider.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Key purpose for automatic key specification
 */
export enum KeyPurpose {
  /** Data encryption at rest */
  DATA_ENCRYPTION = 'DATA_ENCRYPTION',
  /** Key wrapping (KEK) */
  KEY_WRAPPING = 'KEY_WRAPPING',
  /** Digital signatures */
  SIGNING = 'SIGNING',
  /** Message authentication codes */
  MAC = 'MAC',
  /** Key derivation */
  KEY_DERIVATION = 'KEY_DERIVATION',
  /** TLS/mTLS certificates */
  TLS_CERTIFICATE = 'TLS_CERTIFICATE',
  /** Code signing */
  CODE_SIGNING = 'CODE_SIGNING',
  /** Document signing */
  DOCUMENT_SIGNING = 'DOCUMENT_SIGNING',
  /** JWT/JWS signing */
  JWT_SIGNING = 'JWT_SIGNING',
  /** Root CA key */
  ROOT_CA = 'ROOT_CA',
  /** Intermediate CA key */
  INTERMEDIATE_CA = 'INTERMEDIATE_CA',
}

/**
 * FIPS 140-3 compliance level
 */
export enum FIPSComplianceLevel {
  /** Level 1: Software implementation */
  LEVEL_1 = 1,
  /** Level 2: Tamper-evident hardware */
  LEVEL_2 = 2,
  /** Level 3: Tamper-resistant hardware with identity authentication */
  LEVEL_3 = 3,
  /** Level 4: Complete physical security envelope */
  LEVEL_4 = 4,
}

/**
 * Key generation options
 */
export interface KeyGenerationOptions {
  /** Key purpose determines appropriate algorithm selection */
  purpose: KeyPurpose;
  /** Human-readable label */
  label: string;
  /** Optional key ID (auto-generated if not provided) */
  id?: string;
  /** Key expiration date */
  expiresAt?: Date;
  /** Whether key can be exported */
  exportable?: boolean;
  /** Custom attributes */
  attributes?: Record<string, unknown>;
  /** Minimum FIPS compliance level required */
  minFIPSLevel?: FIPSComplianceLevel;
}

/**
 * Envelope encryption result
 */
export interface EnvelopeEncryptionResult {
  /** Encrypted data */
  ciphertext: Buffer;
  /** Encrypted data encryption key */
  encryptedDEK: Buffer;
  /** Key encryption key ID used */
  kekId: string;
  /** Initialization vector */
  iv: Buffer;
  /** Authentication tag (for AEAD) */
  authTag: Buffer;
  /** Algorithm used */
  algorithm: string;
}

/**
 * Key derivation parameters
 */
export interface KeyDerivationParams {
  /** Derivation algorithm */
  algorithm: 'HKDF-SHA256' | 'HKDF-SHA384' | 'HKDF-SHA512' | 'PBKDF2-SHA256' | 'PBKDF2-SHA512';
  /** Salt (optional for HKDF, required for PBKDF2) */
  salt?: Buffer;
  /** Info/context for HKDF */
  info?: Buffer;
  /** Iteration count for PBKDF2 */
  iterations?: number;
  /** Desired output length in bytes */
  outputLength: number;
}

/**
 * Signature options
 */
export interface SignatureOptions {
  /** Signing algorithm */
  algorithm?: SigningAlgorithm;
  /** Pre-hash the data */
  preHash?: boolean;
  /** Hash algorithm for pre-hashing */
  hashAlgorithm?: 'SHA-256' | 'SHA-384' | 'SHA-512';
}

/**
 * Key operation metrics
 */
export interface KeyOperationMetrics {
  totalOperations: number;
  operationsByType: Record<string, number>;
  averageLatencyMs: Record<string, number>;
  failureCount: number;
  lastOperation: Date | null;
}

// ============================================================================
// FIPS-Compliant Key Specifications
// ============================================================================

/**
 * Get FIPS 140-3 compliant key specification for a given purpose
 */
export function getFIPSKeySpec(
  purpose: KeyPurpose,
  label: string,
  options?: Partial<KeyGenerationOptions>
): KeySpec {
  const baseSpec: Partial<KeySpec> = {
    label,
    id: options?.id,
    extractable: options?.exportable ?? false,
    expiresAt: options?.expiresAt,
    attributes: options?.attributes,
  };

  switch (purpose) {
    case KeyPurpose.DATA_ENCRYPTION:
      return {
        ...baseSpec,
        type: KeyType.AES,
        size: 256, // AES-256 for FIPS compliance
        usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
      } as KeySpec;

    case KeyPurpose.KEY_WRAPPING:
      return {
        ...baseSpec,
        type: KeyType.AES,
        size: 256, // AES-256-KWP
        usage: [KeyUsage.WRAP, KeyUsage.UNWRAP],
      } as KeySpec;

    case KeyPurpose.SIGNING:
    case KeyPurpose.CODE_SIGNING:
    case KeyPurpose.DOCUMENT_SIGNING:
      return {
        ...baseSpec,
        type: KeyType.EC,
        curve: ECCurve.P384, // ECDSA P-384 for FIPS 186-5
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    case KeyPurpose.JWT_SIGNING:
      return {
        ...baseSpec,
        type: KeyType.EC,
        curve: ECCurve.P256, // ES256 is widely supported
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    case KeyPurpose.MAC:
      return {
        ...baseSpec,
        type: KeyType.HMAC,
        size: 256, // HMAC-SHA256
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    case KeyPurpose.KEY_DERIVATION:
      return {
        ...baseSpec,
        type: KeyType.AES,
        size: 256,
        usage: [KeyUsage.DERIVE],
      } as KeySpec;

    case KeyPurpose.TLS_CERTIFICATE:
      return {
        ...baseSpec,
        type: KeyType.EC,
        curve: ECCurve.P256, // Widely compatible for TLS
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    case KeyPurpose.ROOT_CA:
      return {
        ...baseSpec,
        type: KeyType.RSA,
        size: 4096, // RSA-4096 for long-lived root CAs
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    case KeyPurpose.INTERMEDIATE_CA:
      return {
        ...baseSpec,
        type: KeyType.EC,
        curve: ECCurve.P384, // ECDSA P-384 for intermediate CAs
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      } as KeySpec;

    default:
      throw new Error(`Unknown key purpose: ${purpose}`);
  }
}

// ============================================================================
// Key Operations Service
// ============================================================================

/**
 * High-level key operations service
 */
export class KeyOperationsService extends EventEmitter {
  private hsm: IHSMProvider;
  private metrics: KeyOperationMetrics;
  private keyCache: Map<string, KeyHandle> = new Map();
  private kekId: string | null = null;

  constructor(hsm: IHSMProvider) {
    super();
    this.hsm = hsm;
    this.metrics = {
      totalOperations: 0,
      operationsByType: {},
      averageLatencyMs: {},
      failureCount: 0,
      lastOperation: null,
    };
  }

  /**
   * Initialize the service with a master KEK
   */
  async initialize(masterKekLabel: string = 'vorion-master-kek'): Promise<void> {
    // Try to find existing KEK
    const existingKeys = await this.hsm.listKeys({ label: masterKekLabel });

    if (existingKeys.length > 0) {
      this.kekId = existingKeys[0].id;
    } else {
      // Generate new master KEK
      const kekSpec = getFIPSKeySpec(KeyPurpose.KEY_WRAPPING, masterKekLabel);
      const kek = await this.hsm.generateKey(kekSpec);
      this.kekId = kek.id;
    }

    this.emit('initialized', { kekId: this.kekId });
  }

  // ============================================================================
  // Key Generation
  // ============================================================================

  /**
   * Generate a key for a specific purpose with FIPS-compliant parameters
   */
  async generateKey(options: KeyGenerationOptions): Promise<KeyHandle> {
    const startTime = Date.now();
    const operationType = 'generateKey';

    try {
      const spec = getFIPSKeySpec(options.purpose, options.label, options);

      // Verify FIPS compliance level if specified
      if (options.minFIPSLevel && options.minFIPSLevel >= FIPSComplianceLevel.LEVEL_3) {
        if (!this.hsm.isProduction) {
          throw new Error(
            `FIPS Level ${options.minFIPSLevel} requires production HSM, but SoftHSM is being used`
          );
        }
      }

      const keyHandle = await this.hsm.generateKey(spec);

      // Cache the key handle
      this.keyCache.set(keyHandle.id, keyHandle);

      this.updateMetrics(operationType, Date.now() - startTime, true);
      this.emit('keyGenerated', { keyHandle, purpose: options.purpose });

      return keyHandle;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Generate a signing key pair (ECDSA or RSA)
   */
  async generateSigningKey(
    label: string,
    algorithm: 'ECDSA' | 'RSA' | 'Ed25519' = 'ECDSA',
    options?: Partial<KeyGenerationOptions>
  ): Promise<KeyHandle> {
    const spec: KeySpec = {
      label,
      id: options?.id,
      extractable: options?.exportable ?? false,
      expiresAt: options?.expiresAt,
      usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      type: algorithm === 'RSA' ? KeyType.RSA : KeyType.EC,
      ...(algorithm === 'RSA'
        ? { size: 2048 }
        : algorithm === 'Ed25519'
        ? { curve: ECCurve.ED25519 }
        : { curve: ECCurve.P256 }),
    };

    return this.hsm.generateKey(spec);
  }

  /**
   * Generate an encryption key (AES-256)
   */
  async generateEncryptionKey(
    label: string,
    options?: Partial<KeyGenerationOptions>
  ): Promise<KeyHandle> {
    return this.generateKey({
      ...options,
      purpose: KeyPurpose.DATA_ENCRYPTION,
      label,
    });
  }

  // ============================================================================
  // Envelope Encryption
  // ============================================================================

  /**
   * Envelope encryption: encrypt data with a random DEK, then wrap DEK with KEK
   */
  async envelopeEncrypt(
    data: Buffer,
    kekId?: string,
    aad?: Buffer
  ): Promise<EnvelopeEncryptionResult> {
    const startTime = Date.now();
    const operationType = 'envelopeEncrypt';

    try {
      const actualKekId = kekId || this.kekId;
      if (!actualKekId) {
        throw new Error('No KEK available. Initialize the service first.');
      }

      // Generate a random Data Encryption Key (DEK)
      const dek = crypto.randomBytes(32); // AES-256
      const iv = crypto.randomBytes(12); // GCM IV

      // Encrypt data with DEK using AES-256-GCM
      const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
      if (aad) {
        cipher.setAAD(aad);
      }
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Wrap the DEK with the KEK in the HSM
      // First, import the DEK temporarily
      const dekHandle = await this.hsm.importKey(dek, {
        label: `ephemeral-dek-${Date.now()}`,
        type: KeyType.AES,
        size: 256,
        usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
        extractable: true, // Must be extractable to wrap
      });

      // Wrap the DEK
      const encryptedDEK = await this.hsm.wrapKey(actualKekId, dekHandle.id);

      // Destroy the temporary DEK
      await this.hsm.destroyKey(dekHandle.id);

      // Securely zero the DEK in memory
      crypto.randomFillSync(dek);

      const result: EnvelopeEncryptionResult = {
        ciphertext: encrypted,
        encryptedDEK,
        kekId: actualKekId,
        iv,
        authTag,
        algorithm: 'AES-256-GCM',
      };

      this.updateMetrics(operationType, Date.now() - startTime, true);
      this.emit('envelopeEncrypted', { kekId: actualKekId, dataLength: data.length });

      return result;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Envelope decryption: unwrap DEK with KEK, then decrypt data
   */
  async envelopeDecrypt(
    envelope: EnvelopeEncryptionResult,
    aad?: Buffer
  ): Promise<Buffer> {
    const startTime = Date.now();
    const operationType = 'envelopeDecrypt';

    try {
      // Unwrap the DEK using the KEK in the HSM
      const dekId = await this.hsm.unwrapKey(
        envelope.kekId,
        envelope.encryptedDEK,
        {
          label: `unwrapped-dek-${Date.now()}`,
          type: KeyType.AES,
          size: 256,
          usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
          extractable: false,
        }
      );

      // Decrypt the data using the HSM
      const fullCiphertext = Buffer.concat([
        envelope.iv,
        envelope.authTag,
        envelope.ciphertext,
      ]);

      const plaintext = await this.hsm.decrypt(dekId, fullCiphertext, {
        algorithm: EncryptionAlgorithm.AES_GCM,
        aad,
      });

      // Destroy the temporary DEK
      await this.hsm.destroyKey(dekId);

      this.updateMetrics(operationType, Date.now() - startTime, true);

      return plaintext;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  // ============================================================================
  // Signing Operations
  // ============================================================================

  /**
   * Sign data using a key in the HSM
   */
  async sign(
    keyId: string,
    data: Buffer,
    options?: SignatureOptions
  ): Promise<Buffer> {
    const startTime = Date.now();
    const operationType = 'sign';

    try {
      const key = await this.getKey(keyId);
      if (!key) {
        throw new HSMKeyNotFoundError(keyId);
      }

      // Determine algorithm based on key type
      let algorithm = options?.algorithm;
      if (!algorithm) {
        algorithm = this.getDefaultSigningAlgorithm(key);
      }

      // Pre-hash if requested
      let dataToSign = data;
      if (options?.preHash) {
        const hashAlg = options.hashAlgorithm || 'SHA-256';
        const hash = crypto.createHash(hashAlg.replace('-', '').toLowerCase());
        dataToSign = hash.update(data).digest();
      }

      const signature = await this.hsm.sign(keyId, dataToSign, algorithm);

      this.updateMetrics(operationType, Date.now() - startTime, true);
      this.emit('dataSigned', { keyId, dataLength: data.length });

      return signature;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Verify a signature using a key in the HSM
   */
  async verify(
    keyId: string,
    data: Buffer,
    signature: Buffer,
    options?: SignatureOptions
  ): Promise<boolean> {
    const startTime = Date.now();
    const operationType = 'verify';

    try {
      const key = await this.getKey(keyId);
      if (!key) {
        throw new HSMKeyNotFoundError(keyId);
      }

      let algorithm = options?.algorithm;
      if (!algorithm) {
        algorithm = this.getDefaultSigningAlgorithm(key);
      }

      let dataToVerify = data;
      if (options?.preHash) {
        const hashAlg = options.hashAlgorithm || 'SHA-256';
        const hash = crypto.createHash(hashAlg.replace('-', '').toLowerCase());
        dataToVerify = hash.update(data).digest();
      }

      const valid = await this.hsm.verify(keyId, dataToVerify, signature, algorithm);

      this.updateMetrics(operationType, Date.now() - startTime, true);

      return valid;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Get default signing algorithm for a key type
   */
  private getDefaultSigningAlgorithm(key: KeyHandle): SigningAlgorithm {
    switch (key.type) {
      case KeyType.RSA:
        return SigningAlgorithm.RSASSA_PSS_SHA256;
      case KeyType.EC:
        if (key.curve === ECCurve.ED25519) {
          return SigningAlgorithm.ED25519;
        }
        return SigningAlgorithm.ECDSA_SHA256;
      case KeyType.HMAC:
        return SigningAlgorithm.HMAC_SHA256;
      default:
        throw new Error(`Cannot determine signing algorithm for key type: ${key.type}`);
    }
  }

  // ============================================================================
  // Key Derivation
  // ============================================================================

  /**
   * Derive a key using HKDF or PBKDF2
   */
  async deriveKey(
    masterKeyId: string,
    params: KeyDerivationParams,
    outputKeySpec: Partial<KeySpec>
  ): Promise<KeyHandle> {
    const startTime = Date.now();
    const operationType = 'deriveKey';

    try {
      const masterKey = await this.getKey(masterKeyId);
      if (!masterKey) {
        throw new HSMKeyNotFoundError(masterKeyId);
      }

      // In a real HSM, key derivation would be done inside the HSM
      // Here we simulate it for the interface

      // Get a reference value from the master key (would be HSM internal)
      const masterKeyRef = await this.hsm.sign(
        masterKeyId,
        Buffer.from('key-derivation-context'),
        SigningAlgorithm.HMAC_SHA256
      );

      let derivedMaterial: Buffer;

      if (params.algorithm.startsWith('HKDF')) {
        derivedMaterial = this.hkdf(
          masterKeyRef,
          params.salt || Buffer.alloc(0),
          params.info || Buffer.alloc(0),
          params.outputLength,
          params.algorithm.replace('HKDF-', '') as 'SHA256' | 'SHA384' | 'SHA512'
        );
      } else {
        // PBKDF2
        if (!params.salt) {
          throw new Error('Salt is required for PBKDF2');
        }
        derivedMaterial = crypto.pbkdf2Sync(
          masterKeyRef,
          params.salt,
          params.iterations || 100000,
          params.outputLength,
          params.algorithm.replace('PBKDF2-', '').toLowerCase()
        );
      }

      // Import the derived key
      const spec: KeySpec = {
        label: outputKeySpec.label || `derived-${Date.now()}`,
        type: outputKeySpec.type || KeyType.AES,
        size: params.outputLength * 8,
        usage: outputKeySpec.usage || [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
        extractable: outputKeySpec.extractable ?? false,
      };

      const derivedKey = await this.hsm.importKey(derivedMaterial, spec);

      // Zero derived material
      crypto.randomFillSync(derivedMaterial);

      this.updateMetrics(operationType, Date.now() - startTime, true);

      return derivedKey;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * HKDF implementation
   */
  private hkdf(
    ikm: Buffer,
    salt: Buffer,
    info: Buffer,
    length: number,
    hash: 'SHA256' | 'SHA384' | 'SHA512'
  ): Buffer {
    const hashName = hash.toLowerCase() as 'sha256' | 'sha384' | 'sha512';
    const hashLength = { sha256: 32, sha384: 48, sha512: 64 }[hashName];

    // Extract
    const prk = crypto.createHmac(hashName, salt.length > 0 ? salt : Buffer.alloc(hashLength))
      .update(ikm)
      .digest();

    // Expand
    const n = Math.ceil(length / hashLength);
    const okm = Buffer.alloc(n * hashLength);
    let t = Buffer.alloc(0);

    for (let i = 0; i < n; i++) {
      t = crypto.createHmac(hashName, prk)
        .update(Buffer.concat([t, info, Buffer.from([i + 1])]))
        .digest();
      t.copy(okm, i * hashLength);
    }

    return okm.subarray(0, length);
  }

  // ============================================================================
  // Key Management
  // ============================================================================

  /**
   * Get a key by ID
   */
  async getKey(keyId: string): Promise<KeyHandle | null> {
    // Check cache first
    if (this.keyCache.has(keyId)) {
      return this.keyCache.get(keyId)!;
    }

    const key = await this.hsm.getKey(keyId);
    if (key) {
      this.keyCache.set(keyId, key);
    }
    return key;
  }

  /**
   * List keys by purpose
   */
  async listKeysByPurpose(purpose: KeyPurpose): Promise<KeyHandle[]> {
    const spec = getFIPSKeySpec(purpose, '');
    return this.hsm.listKeys({
      type: spec.type,
      usage: spec.usage,
    });
  }

  /**
   * Rotate a key
   */
  async rotateKey(oldKeyId: string, newLabel?: string): Promise<KeyHandle> {
    const startTime = Date.now();
    const operationType = 'rotateKey';

    try {
      const oldKey = await this.getKey(oldKeyId);
      if (!oldKey) {
        throw new HSMKeyNotFoundError(oldKeyId);
      }

      // Generate new key with same spec
      const newKeySpec: KeySpec = {
        label: newLabel || `${oldKey.label}-rotated-${Date.now()}`,
        type: oldKey.type,
        size: oldKey.size,
        curve: oldKey.curve,
        usage: oldKey.usage,
        extractable: oldKey.extractable,
      };

      const newKey = await this.hsm.generateKey(newKeySpec);

      // Update cache
      this.keyCache.set(newKey.id, newKey);

      this.updateMetrics(operationType, Date.now() - startTime, true);
      this.emit('keyRotated', { oldKeyId, newKeyId: newKey.id });

      return newKey;
    } catch (error) {
      this.updateMetrics(operationType, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Export public key in various formats
   */
  async exportPublicKey(
    keyId: string,
    format: 'spki' | 'jwk' | 'pem' = 'spki'
  ): Promise<Buffer | string | object> {
    const publicKeyDer = await this.hsm.exportPublicKey(keyId);

    switch (format) {
      case 'spki':
        return publicKeyDer;

      case 'pem':
        const pemHeader = '-----BEGIN PUBLIC KEY-----\n';
        const pemFooter = '\n-----END PUBLIC KEY-----';
        const base64 = publicKeyDer.toString('base64');
        const formatted = base64.match(/.{1,64}/g)?.join('\n') || base64;
        return pemHeader + formatted + pemFooter;

      case 'jwk':
        // Parse the SPKI format and convert to JWK
        const publicKey = crypto.createPublicKey({
          key: publicKeyDer,
          format: 'der',
          type: 'spki',
        });
        return publicKey.export({ format: 'jwk' });

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Update operation metrics
   */
  private updateMetrics(operation: string, latencyMs: number, success: boolean): void {
    this.metrics.totalOperations++;
    this.metrics.lastOperation = new Date();

    if (!this.metrics.operationsByType[operation]) {
      this.metrics.operationsByType[operation] = 0;
      this.metrics.averageLatencyMs[operation] = 0;
    }

    const count = this.metrics.operationsByType[operation];
    this.metrics.operationsByType[operation] = count + 1;

    // Update running average
    this.metrics.averageLatencyMs[operation] =
      (this.metrics.averageLatencyMs[operation] * count + latencyMs) / (count + 1);

    if (!success) {
      this.metrics.failureCount++;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): KeyOperationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalOperations: 0,
      operationsByType: {},
      averageLatencyMs: {},
      failureCount: 0,
      lastOperation: null,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and initialize key operations service
 */
export async function createKeyOperationsService(
  hsm: IHSMProvider,
  masterKekLabel?: string
): Promise<KeyOperationsService> {
  const service = new KeyOperationsService(hsm);
  await service.initialize(masterKekLabel);
  return service;
}
