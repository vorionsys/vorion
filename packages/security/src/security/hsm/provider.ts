/**
 * HSM Provider Interface and Base Implementations
 * Provides abstraction layer for Hardware Security Module operations
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Key specification for key generation
 */
export interface KeySpec {
  /** Unique identifier for the key */
  id?: string;
  /** Human-readable label */
  label: string;
  /** Key type */
  type: KeyType;
  /** Key size in bits (for symmetric keys) or curve name (for EC keys) */
  size?: number;
  /** Elliptic curve name for EC keys */
  curve?: ECCurve;
  /** Key usage permissions */
  usage: KeyUsage[];
  /** Whether the key can be extracted from the HSM */
  extractable: boolean;
  /** Key expiration date */
  expiresAt?: Date;
  /** Custom attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Supported key types
 */
export enum KeyType {
  AES = 'AES',
  RSA = 'RSA',
  EC = 'EC',
  HMAC = 'HMAC',
  DES3 = '3DES',
  CHACHA20 = 'CHACHA20',
}

/**
 * Supported elliptic curves
 */
export enum ECCurve {
  P256 = 'P-256',
  P384 = 'P-384',
  P521 = 'P-521',
  SECP256K1 = 'secp256k1',
  ED25519 = 'Ed25519',
}

/**
 * Key usage permissions
 */
export enum KeyUsage {
  ENCRYPT = 'encrypt',
  DECRYPT = 'decrypt',
  SIGN = 'sign',
  VERIFY = 'verify',
  WRAP = 'wrap',
  UNWRAP = 'unwrap',
  DERIVE = 'derive',
}

/**
 * Key handle returned from key generation or import
 */
export interface KeyHandle {
  /** Unique key identifier within the HSM */
  id: string;
  /** Key label */
  label: string;
  /** Key type */
  type: KeyType;
  /** Key size or curve */
  size?: number;
  curve?: ECCurve;
  /** Permitted usages */
  usage: KeyUsage[];
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp */
  expiresAt?: Date;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
  /** Whether key is extractable */
  extractable: boolean;
  /** Public key material (if asymmetric) */
  publicKey?: Buffer;
}

/**
 * Supported signing algorithms
 */
export enum SigningAlgorithm {
  RSASSA_PKCS1_V1_5_SHA256 = 'RSASSA-PKCS1-v1_5-SHA256',
  RSASSA_PKCS1_V1_5_SHA384 = 'RSASSA-PKCS1-v1_5-SHA384',
  RSASSA_PKCS1_V1_5_SHA512 = 'RSASSA-PKCS1-v1_5-SHA512',
  RSASSA_PSS_SHA256 = 'RSASSA-PSS-SHA256',
  RSASSA_PSS_SHA384 = 'RSASSA-PSS-SHA384',
  RSASSA_PSS_SHA512 = 'RSASSA-PSS-SHA512',
  ECDSA_SHA256 = 'ECDSA-SHA256',
  ECDSA_SHA384 = 'ECDSA-SHA384',
  ECDSA_SHA512 = 'ECDSA-SHA512',
  ED25519 = 'Ed25519',
  HMAC_SHA256 = 'HMAC-SHA256',
  HMAC_SHA384 = 'HMAC-SHA384',
  HMAC_SHA512 = 'HMAC-SHA512',
}

/**
 * Supported encryption algorithms
 */
export enum EncryptionAlgorithm {
  AES_GCM = 'AES-GCM',
  AES_CBC = 'AES-CBC',
  AES_CTR = 'AES-CTR',
  RSA_OAEP_SHA256 = 'RSA-OAEP-SHA256',
  RSA_OAEP_SHA384 = 'RSA-OAEP-SHA384',
  RSA_OAEP_SHA512 = 'RSA-OAEP-SHA512',
  CHACHA20_POLY1305 = 'CHACHA20-POLY1305',
}

/**
 * Encryption options
 */
export interface EncryptionOptions {
  algorithm?: EncryptionAlgorithm;
  iv?: Buffer;
  aad?: Buffer;
  tagLength?: number;
}

/**
 * HSM provider status
 */
export interface HSMStatus {
  connected: boolean;
  healthy: boolean;
  provider: string;
  version?: string;
  freeSlots?: number;
  usedSlots?: number;
  lastHealthCheck: Date;
  errorMessage?: string;
}

/**
 * HSM provider configuration base
 */
export interface HSMProviderConfig {
  /** Provider name */
  name: string;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Operation timeout in milliseconds */
  operationTimeout?: number;
  /** Enable audit logging */
  auditLogging?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: Date;
  operation: string;
  keyId?: string;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
}

// ============================================================================
// HSM Provider Interface
// ============================================================================

/**
 * Hardware Security Module Provider Interface
 * All HSM implementations must implement this interface
 */
export interface IHSMProvider extends EventEmitter {
  /** Provider name */
  readonly name: string;

  /** Whether this is a production-grade HSM */
  readonly isProduction: boolean;

  /**
   * Initialize connection to the HSM
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the HSM
   */
  disconnect(): Promise<void>;

  /**
   * Get HSM status
   */
  getStatus(): Promise<HSMStatus>;

  /**
   * Generate a new key in the HSM
   */
  generateKey(spec: KeySpec): Promise<KeyHandle>;

  /**
   * Import a key into the HSM
   */
  importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle>;

  /**
   * Export public key (asymmetric keys only)
   */
  exportPublicKey(keyHandle: string): Promise<Buffer>;

  /**
   * Get key metadata
   */
  getKey(keyHandle: string): Promise<KeyHandle | null>;

  /**
   * List all keys
   */
  listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]>;

  /**
   * Sign data using a key
   */
  sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer>;

  /**
   * Verify a signature
   */
  verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean>;

  /**
   * Encrypt data using a key
   */
  encrypt(keyHandle: string, data: Buffer, options?: EncryptionOptions): Promise<Buffer>;

  /**
   * Decrypt data using a key
   */
  decrypt(keyHandle: string, ciphertext: Buffer, options?: EncryptionOptions): Promise<Buffer>;

  /**
   * Wrap (encrypt) a key for export
   */
  wrapKey(wrappingKeyHandle: string, keyToWrap: string, algorithm?: string): Promise<Buffer>;

  /**
   * Unwrap (decrypt and import) a key
   */
  unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string>;

  /**
   * Destroy a key
   */
  destroyKey(keyHandle: string): Promise<void>;

  /**
   * Get audit logs
   */
  getAuditLogs(startTime?: Date, endTime?: Date): Promise<AuditLogEntry[]>;
}

// ============================================================================
// Base HSM Provider Implementation
// ============================================================================

/**
 * Abstract base class for HSM providers
 * Provides common functionality and enforces interface compliance
 */
export abstract class BaseHSMProvider extends EventEmitter implements IHSMProvider {
  abstract readonly name: string;
  abstract readonly isProduction: boolean;

  protected config: HSMProviderConfig;
  protected connected: boolean = false;
  protected auditLogs: AuditLogEntry[] = [];
  protected keys: Map<string, KeyHandle> = new Map();

  constructor(config: HSMProviderConfig) {
    super();
    this.config = {
      connectionTimeout: 30000,
      operationTimeout: 60000,
      auditLogging: true,
      retry: {
        maxAttempts: 3,
        initialDelay: 100,
        maxDelay: 5000,
        backoffMultiplier: 2,
      },
      ...config,
    };
  }

  /**
   * Log an audit entry
   */
  protected logAudit(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    if (!this.config.auditLogging) return;

    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date(),
    };

    this.auditLogs.push(fullEntry);
    this.emit('audit', fullEntry);

    // Keep only last 10000 entries in memory
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }
  }

  /**
   * Execute operation with retry
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const { maxAttempts, initialDelay, maxDelay, backoffMultiplier } = this.config.retry!;
    let lastError: Error | undefined;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          this.emit('retry', { operation: operationName, attempt, error: lastError });
          await this.sleep(delay);
          delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a unique key ID
   */
  protected generateKeyId(): string {
    return `key-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Validate key spec
   */
  protected validateKeySpec(spec: KeySpec): void {
    if (!spec.label) {
      throw new Error('Key label is required');
    }

    if (!spec.type) {
      throw new Error('Key type is required');
    }

    if (!spec.usage || spec.usage.length === 0) {
      throw new Error('At least one key usage must be specified');
    }

    // Type-specific validation
    switch (spec.type) {
      case KeyType.AES:
        if (spec.size && ![128, 192, 256].includes(spec.size)) {
          throw new Error('AES key size must be 128, 192, or 256 bits');
        }
        break;
      case KeyType.RSA:
        if (spec.size && spec.size < 2048) {
          throw new Error('RSA key size must be at least 2048 bits');
        }
        break;
      case KeyType.EC:
        if (!spec.curve) {
          throw new Error('EC curve must be specified');
        }
        break;
    }
  }

  /**
   * Get key or throw
   */
  protected getKeyOrThrow(keyHandle: string): KeyHandle {
    const key = this.keys.get(keyHandle);
    if (!key) {
      throw new Error(`Key not found: ${keyHandle}`);
    }
    return key;
  }

  /**
   * Validate key usage
   */
  protected validateKeyUsage(key: KeyHandle, requiredUsage: KeyUsage): void {
    if (!key.usage.includes(requiredUsage)) {
      throw new Error(`Key ${key.id} does not permit ${requiredUsage} operation`);
    }
  }

  /**
   * Ensure connected
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error('HSM is not connected');
    }
  }

  // Abstract methods to be implemented by subclasses
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getStatus(): Promise<HSMStatus>;
  abstract generateKey(spec: KeySpec): Promise<KeyHandle>;
  abstract importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle>;
  abstract exportPublicKey(keyHandle: string): Promise<Buffer>;
  abstract getKey(keyHandle: string): Promise<KeyHandle | null>;
  abstract listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]>;
  abstract sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer>;
  abstract verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean>;
  abstract encrypt(keyHandle: string, data: Buffer, options?: EncryptionOptions): Promise<Buffer>;
  abstract decrypt(
    keyHandle: string,
    ciphertext: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer>;
  abstract wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer>;
  abstract unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string>;
  abstract destroyKey(keyHandle: string): Promise<void>;

  /**
   * Get audit logs
   */
  async getAuditLogs(startTime?: Date, endTime?: Date): Promise<AuditLogEntry[]> {
    let logs = [...this.auditLogs];

    if (startTime) {
      logs = logs.filter(log => log.timestamp >= startTime);
    }

    if (endTime) {
      logs = logs.filter(log => log.timestamp <= endTime);
    }

    return logs;
  }
}

// ============================================================================
// HSM Error Types
// ============================================================================

export class HSMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'HSMError';
  }
}

export class HSMConnectionError extends HSMError {
  constructor(message: string, provider?: string, cause?: Error) {
    super(message, 'CONNECTION_ERROR', provider, cause);
    this.name = 'HSMConnectionError';
  }
}

export class HSMKeyNotFoundError extends HSMError {
  constructor(keyId: string, provider?: string) {
    super(`Key not found: ${keyId}`, 'KEY_NOT_FOUND', provider);
    this.name = 'HSMKeyNotFoundError';
  }
}

export class HSMOperationError extends HSMError {
  constructor(operation: string, message: string, provider?: string, cause?: Error) {
    super(`${operation} failed: ${message}`, 'OPERATION_ERROR', provider, cause);
    this.name = 'HSMOperationError';
  }
}

export class HSMPermissionError extends HSMError {
  constructor(message: string, provider?: string) {
    super(message, 'PERMISSION_DENIED', provider);
    this.name = 'HSMPermissionError';
  }
}
