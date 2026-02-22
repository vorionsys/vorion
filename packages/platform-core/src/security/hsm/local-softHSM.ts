/**
 * Local SoftHSM Provider Implementation
 * Software-based HSM emulation for development and testing
 *
 * WARNING: This provider is NOT suitable for production use.
 * It stores keys in memory and does not provide the security
 * guarantees of a real Hardware Security Module.
 */

import * as crypto from 'crypto';
import {
  BaseHSMProvider,
  HSMProviderConfig,
  HSMStatus,
  KeySpec,
  KeyHandle,
  KeyType,
  KeyUsage,
  EncryptionOptions,
  EncryptionAlgorithm,
  HSMConnectionError,
  HSMOperationError,
  HSMKeyNotFoundError,
  ECCurve,
} from './provider.js';

// ============================================================================
// SoftHSM Configuration
// ============================================================================

export interface SoftHSMConfig extends HSMProviderConfig {
  /** Token label */
  tokenLabel?: string;
  /** Token PIN */
  tokenPin?: string;
  /** Persist keys to file (for testing) */
  persistPath?: string;
  /** Simulated latency in ms (to mimic real HSM) */
  simulatedLatency?: number;
  /** Maximum key count */
  maxKeys?: number;
  /** Whether to warn when used */
  suppressWarnings?: boolean;
}

/**
 * In-memory key storage with actual key material
 */
interface SoftKeyInfo extends KeyHandle {
  /** Actual key material (would never exist in real HSM) */
  keyMaterial: Buffer;
  /** Private key material for asymmetric keys */
  privateKeyMaterial?: Buffer;
  /** Token ID */
  tokenId: string;
}

// ============================================================================
// SoftHSM Provider
// ============================================================================

export class SoftHSMProvider extends BaseHSMProvider {
  readonly name = 'SoftHSM (Development)';
  readonly isProduction = false;

  private softConfig: SoftHSMConfig;
  private keyStore: Map<string, SoftKeyInfo> = new Map();
  private tokenId: string;
  private initialized: boolean = false;

  constructor(config: SoftHSMConfig) {
    super(config);
    this.softConfig = {
      tokenLabel: 'SoftHSM-Dev-Token',
      tokenPin: '1234',
      simulatedLatency: 0,
      maxKeys: 1000,
      suppressWarnings: false,
      ...config,
    };
    this.tokenId = `softhsm-${Date.now()}`;
  }

  /**
   * Connect to SoftHSM (simulated)
   */
  async connect(): Promise<void> {
    try {
      // Emit warning if not suppressed
      if (!this.softConfig.suppressWarnings) {
        console.warn(
          '\x1b[33m[WARNING] SoftHSM is being used. This is NOT suitable for production!\x1b[0m'
        );
        this.emit('warning', {
          message: 'SoftHSM is for development only. Do not use in production.',
        });
      }

      // Simulate initialization delay
      await this.simulateLatency();

      // Load persisted keys if path is specified
      if (this.softConfig.persistPath) {
        await this.loadPersistedKeys();
      }

      this.initialized = true;
      this.connected = true;

      this.logAudit({
        operation: 'connect',
        success: true,
        metadata: { tokenLabel: this.softConfig.tokenLabel },
      });

      this.emit('connected', { provider: this.name });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'connect',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMConnectionError(
        `Failed to initialize SoftHSM: ${err.message}`,
        this.name,
        err
      );
    }
  }

  /**
   * Simulate HSM latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.softConfig.simulatedLatency && this.softConfig.simulatedLatency > 0) {
      await this.sleep(this.softConfig.simulatedLatency);
    }
  }

  /**
   * Load persisted keys from file
   */
  private async loadPersistedKeys(): Promise<void> {
    // In real implementation, load from file
    // For now, just initialize empty
  }

  /**
   * Save keys to persistence
   */
  private async persistKeys(): Promise<void> {
    if (!this.softConfig.persistPath) return;

    // In real implementation, save to file
    // WARNING: This would expose key material - only for testing!
  }

  /**
   * Disconnect from SoftHSM
   */
  async disconnect(): Promise<void> {
    // Persist keys if needed
    if (this.softConfig.persistPath) {
      await this.persistKeys();
    }

    this.initialized = false;
    this.connected = false;

    this.logAudit({
      operation: 'disconnect',
      success: true,
    });

    this.emit('disconnected', { provider: this.name });
  }

  /**
   * Get HSM status
   */
  async getStatus(): Promise<HSMStatus> {
    return {
      connected: this.connected,
      healthy: this.connected && this.initialized,
      provider: this.name,
      version: '2.6.0', // SoftHSM version
      freeSlots: (this.softConfig.maxKeys || 1000) - this.keyStore.size,
      usedSlots: this.keyStore.size,
      lastHealthCheck: new Date(),
      errorMessage: this.isProduction
        ? undefined
        : 'WARNING: SoftHSM is not for production use',
    };
  }

  /**
   * Generate key in SoftHSM
   */
  async generateKey(spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    // Check key limit
    if (this.keyStore.size >= (this.softConfig.maxKeys || 1000)) {
      throw new HSMOperationError('generateKey', 'Maximum key limit reached', this.name);
    }

    const keyId = spec.id || this.generateKeyId();

    try {
      await this.simulateLatency();

      let keyMaterial: Buffer;
      let privateKeyMaterial: Buffer | undefined;
      let publicKey: Buffer | undefined;

      switch (spec.type) {
        case KeyType.AES:
          keyMaterial = crypto.randomBytes((spec.size || 256) / 8);
          break;

        case KeyType.RSA: {
          const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: spec.size || 2048,
          });
          publicKey = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
          privateKeyMaterial = privKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
          keyMaterial = publicKey;
          break;
        }

        case KeyType.EC: {
          const curveMap: Record<ECCurve, string> = {
            [ECCurve.P256]: 'prime256v1',
            [ECCurve.P384]: 'secp384r1',
            [ECCurve.P521]: 'secp521r1',
            [ECCurve.SECP256K1]: 'secp256k1',
            [ECCurve.ED25519]: 'ed25519',
          };

          const curve = curveMap[spec.curve || ECCurve.P256];

          if (curve === 'ed25519') {
            const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('ed25519');
            publicKey = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
            privateKeyMaterial = privKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
          } else {
            const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('ec', {
              namedCurve: curve,
            });
            publicKey = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
            privateKeyMaterial = privKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
          }
          keyMaterial = publicKey;
          break;
        }

        case KeyType.HMAC:
          keyMaterial = crypto.randomBytes((spec.size || 256) / 8);
          break;

        case KeyType.DES3:
          keyMaterial = crypto.randomBytes(24);
          break;

        case KeyType.CHACHA20:
          keyMaterial = crypto.randomBytes(32);
          break;

        default:
          throw new Error(`Unsupported key type: ${spec.type}`);
      }

      const keyHandle: SoftKeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        expiresAt: spec.expiresAt,
        publicKey,
        keyMaterial,
        privateKeyMaterial,
        tokenId: this.tokenId,
        metadata: {
          provider: 'SoftHSM',
          warning: 'Development only - not secure',
        },
      };

      this.keyStore.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      // Persist if enabled
      if (this.softConfig.persistPath) {
        await this.persistKeys();
      }

      this.logAudit({
        operation: 'generateKey',
        keyId,
        success: true,
        metadata: { type: spec.type, label: spec.label },
      });

      // Return without exposing key material
      const { keyMaterial: _, privateKeyMaterial: __, ...safeHandle } = keyHandle;
      return safeHandle;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'generateKey',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('generateKey', err.message, this.name, err);
    }
  }

  /**
   * Import key into SoftHSM
   */
  async importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      await this.simulateLatency();

      const keyHandle: SoftKeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        expiresAt: spec.expiresAt,
        keyMaterial: Buffer.from(keyMaterial),
        tokenId: this.tokenId,
        metadata: {
          imported: true,
        },
      };

      this.keyStore.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'importKey',
        keyId,
        success: true,
      });

      const { keyMaterial: _, privateKeyMaterial: __, ...safeHandle } = keyHandle;
      return safeHandle;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'importKey',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('importKey', err.message, this.name, err);
    }
  }

  /**
   * Export public key
   */
  async exportPublicKey(keyHandle: string): Promise<Buffer> {
    this.ensureConnected();
    await this.simulateLatency();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    if (!keyInfo.publicKey) {
      throw new HSMOperationError('exportPublicKey', 'Not an asymmetric key', this.name);
    }

    return keyInfo.publicKey;
  }

  /**
   * Get key
   */
  async getKey(keyHandle: string): Promise<KeyHandle | null> {
    this.ensureConnected();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) return null;

    // Don't expose key material
    const { keyMaterial: _, privateKeyMaterial: __, ...safeHandle } = keyInfo;
    return safeHandle;
  }

  /**
   * List keys
   */
  async listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]> {
    this.ensureConnected();

    let keys = Array.from(this.keyStore.values());

    if (filter) {
      if (filter.type) {
        keys = keys.filter(k => k.type === filter.type);
      }
      if (filter.label) {
        keys = keys.filter(k => k.label.includes(filter.label!));
      }
    }

    // Don't expose key material
    return keys.map(({ keyMaterial: _, privateKeyMaterial: __, ...safe }) => safe);
  }

  /**
   * Sign data using actual cryptographic operations
   */
  async sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer> {
    this.ensureConnected();
    await this.simulateLatency();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.SIGN);

    try {
      let signature: Buffer;

      switch (keyInfo.type) {
        case KeyType.RSA: {
          if (!keyInfo.privateKeyMaterial) {
            throw new Error('Private key not available');
          }
          const privateKey = crypto.createPrivateKey({
            key: keyInfo.privateKeyMaterial,
            format: 'der',
            type: 'pkcs8',
          });
          signature = crypto.sign('sha256', data, privateKey);
          break;
        }

        case KeyType.EC: {
          if (!keyInfo.privateKeyMaterial) {
            throw new Error('Private key not available');
          }
          const privateKey = crypto.createPrivateKey({
            key: keyInfo.privateKeyMaterial,
            format: 'der',
            type: 'pkcs8',
          });
          signature = crypto.sign(
            keyInfo.curve === ECCurve.ED25519 ? null : 'sha256',
            data,
            privateKey
          );
          break;
        }

        case KeyType.HMAC: {
          const hmac = crypto.createHmac('sha256', keyInfo.keyMaterial);
          hmac.update(data);
          signature = hmac.digest();
          break;
        }

        default:
          throw new Error(`Signing not supported for key type: ${keyInfo.type}`);
      }

      this.logAudit({
        operation: 'sign',
        keyId: keyHandle,
        success: true,
        metadata: { algorithm },
      });

      return signature;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'sign',
        keyId: keyHandle,
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('sign', err.message, this.name, err);
    }
  }

  /**
   * Verify signature using actual cryptographic operations
   */
  async verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean> {
    this.ensureConnected();
    await this.simulateLatency();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.VERIFY);

    try {
      let result: boolean;

      switch (keyInfo.type) {
        case KeyType.RSA: {
          if (!keyInfo.publicKey) {
            throw new Error('Public key not available');
          }
          const publicKey = crypto.createPublicKey({
            key: keyInfo.publicKey,
            format: 'der',
            type: 'spki',
          });
          result = crypto.verify('sha256', data, publicKey, signature);
          break;
        }

        case KeyType.EC: {
          if (!keyInfo.publicKey) {
            throw new Error('Public key not available');
          }
          const publicKey = crypto.createPublicKey({
            key: keyInfo.publicKey,
            format: 'der',
            type: 'spki',
          });
          result = crypto.verify(
            keyInfo.curve === ECCurve.ED25519 ? null : 'sha256',
            data,
            publicKey,
            signature
          );
          break;
        }

        case KeyType.HMAC: {
          const hmac = crypto.createHmac('sha256', keyInfo.keyMaterial);
          hmac.update(data);
          const expectedSig = hmac.digest();
          result = crypto.timingSafeEqual(signature, expectedSig);
          break;
        }

        default:
          throw new Error(`Verification not supported for key type: ${keyInfo.type}`);
      }

      this.logAudit({
        operation: 'verify',
        keyId: keyHandle,
        success: true,
        metadata: { valid: result },
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'verify',
        keyId: keyHandle,
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('verify', err.message, this.name, err);
    }
  }

  /**
   * Encrypt data using actual cryptographic operations
   */
  async encrypt(
    keyHandle: string,
    data: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();
    await this.simulateLatency();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.ENCRYPT);

    try {
      const algorithm = options?.algorithm || EncryptionAlgorithm.AES_GCM;
      let result: Buffer;

      switch (keyInfo.type) {
        case KeyType.AES: {
          const iv = options?.iv || crypto.randomBytes(12);
          const cipher = crypto.createCipheriv(
            'aes-256-gcm',
            keyInfo.keyMaterial.length === 32
              ? keyInfo.keyMaterial
              : crypto.createHash('sha256').update(keyInfo.keyMaterial).digest(),
            iv
          );

          if (options?.aad) {
            cipher.setAAD(options.aad);
          }

          const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
          const authTag = cipher.getAuthTag();
          result = Buffer.concat([iv, authTag, encrypted]);
          break;
        }

        case KeyType.RSA: {
          if (!keyInfo.publicKey) {
            throw new Error('Public key not available');
          }
          const publicKey = crypto.createPublicKey({
            key: keyInfo.publicKey,
            format: 'der',
            type: 'spki',
          });
          result = crypto.publicEncrypt(
            {
              key: publicKey,
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: 'sha256',
            },
            data
          );
          break;
        }

        default:
          throw new Error(`Encryption not supported for key type: ${keyInfo.type}`);
      }

      this.logAudit({
        operation: 'encrypt',
        keyId: keyHandle,
        success: true,
        metadata: { algorithm },
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'encrypt',
        keyId: keyHandle,
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('encrypt', err.message, this.name, err);
    }
  }

  /**
   * Decrypt data using actual cryptographic operations
   */
  async decrypt(
    keyHandle: string,
    ciphertext: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();
    await this.simulateLatency();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.DECRYPT);

    try {
      let result: Buffer;

      switch (keyInfo.type) {
        case KeyType.AES: {
          const iv = ciphertext.subarray(0, 12);
          const authTag = ciphertext.subarray(12, 28);
          const encrypted = ciphertext.subarray(28);

          const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            keyInfo.keyMaterial.length === 32
              ? keyInfo.keyMaterial
              : crypto.createHash('sha256').update(keyInfo.keyMaterial).digest(),
            iv
          );
          decipher.setAuthTag(authTag);

          if (options?.aad) {
            decipher.setAAD(options.aad);
          }

          result = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          break;
        }

        case KeyType.RSA: {
          if (!keyInfo.privateKeyMaterial) {
            throw new Error('Private key not available');
          }
          const privateKey = crypto.createPrivateKey({
            key: keyInfo.privateKeyMaterial,
            format: 'der',
            type: 'pkcs8',
          });
          result = crypto.privateDecrypt(
            {
              key: privateKey,
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: 'sha256',
            },
            ciphertext
          );
          break;
        }

        default:
          throw new Error(`Decryption not supported for key type: ${keyInfo.type}`);
      }

      this.logAudit({
        operation: 'decrypt',
        keyId: keyHandle,
        success: true,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'decrypt',
        keyId: keyHandle,
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('decrypt', err.message, this.name, err);
    }
  }

  /**
   * Wrap key
   */
  async wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer> {
    this.ensureConnected();
    await this.simulateLatency();

    const wrappingKey = this.keyStore.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    const targetKey = this.keyStore.get(keyToWrap);
    if (!targetKey) {
      throw new HSMKeyNotFoundError(keyToWrap, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.WRAP);

    if (!targetKey.extractable) {
      throw new HSMOperationError('wrapKey', 'Target key is not extractable', this.name);
    }

    try {
      // Use AES-KWP (Key Wrap with Padding)
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        wrappingKey.keyMaterial.length === 32
          ? wrappingKey.keyMaterial
          : crypto.createHash('sha256').update(wrappingKey.keyMaterial).digest(),
        iv
      );

      const encrypted = Buffer.concat([
        cipher.update(targetKey.keyMaterial),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      const wrappedKey = Buffer.concat([iv, authTag, encrypted]);

      this.logAudit({
        operation: 'wrapKey',
        keyId: keyToWrap,
        success: true,
      });

      return wrappedKey;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'wrapKey',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('wrapKey', err.message, this.name, err);
    }
  }

  /**
   * Unwrap key
   */
  async unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string> {
    this.ensureConnected();
    await this.simulateLatency();

    const wrappingKey = this.keyStore.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.UNWRAP);
    this.validateKeySpec(spec);

    try {
      // Unwrap using AES-GCM
      const iv = wrappedKey.subarray(0, 12);
      const authTag = wrappedKey.subarray(12, 28);
      const encrypted = wrappedKey.subarray(28);

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        wrappingKey.keyMaterial.length === 32
          ? wrappingKey.keyMaterial
          : crypto.createHash('sha256').update(wrappingKey.keyMaterial).digest(),
        iv
      );
      decipher.setAuthTag(authTag);

      const keyMaterial = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      const keyId = spec.id || this.generateKeyId();

      const keyHandle: SoftKeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        keyMaterial,
        tokenId: this.tokenId,
        metadata: {
          unwrapped: true,
        },
      };

      this.keyStore.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'unwrapKey',
        keyId,
        success: true,
      });

      return keyId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'unwrapKey',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('unwrapKey', err.message, this.name, err);
    }
  }

  /**
   * Destroy key
   */
  async destroyKey(keyHandle: string): Promise<void> {
    this.ensureConnected();

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    try {
      // Securely zero the key material before deletion
      if (keyInfo.keyMaterial) {
        crypto.randomFillSync(keyInfo.keyMaterial);
      }
      if (keyInfo.privateKeyMaterial) {
        crypto.randomFillSync(keyInfo.privateKeyMaterial);
      }

      this.keyStore.delete(keyHandle);
      this.keys.delete(keyHandle);

      if (this.softConfig.persistPath) {
        await this.persistKeys();
      }

      this.logAudit({
        operation: 'destroyKey',
        keyId: keyHandle,
        success: true,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'destroyKey',
        keyId: keyHandle,
        success: false,
        errorMessage: err.message,
      });
      throw new HSMOperationError('destroyKey', err.message, this.name, err);
    }
  }

  // ============================================================================
  // SoftHSM-Specific Methods (for testing)
  // ============================================================================

  /**
   * Export key material (TESTING ONLY - never in production HSM)
   */
  async exportKeyMaterial(keyHandle: string): Promise<Buffer> {
    if (!this.softConfig.suppressWarnings) {
      console.warn('\x1b[31m[DANGER] Exporting key material - TESTING ONLY!\x1b[0m');
    }

    const keyInfo = this.keyStore.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    if (!keyInfo.extractable) {
      throw new HSMOperationError('exportKeyMaterial', 'Key is not extractable', this.name);
    }

    return Buffer.from(keyInfo.keyMaterial);
  }

  /**
   * Clear all keys (TESTING ONLY)
   */
  async clearAllKeys(): Promise<void> {
    for (const keyInfo of this.keyStore.values()) {
      if (keyInfo.keyMaterial) {
        crypto.randomFillSync(keyInfo.keyMaterial);
      }
      if (keyInfo.privateKeyMaterial) {
        crypto.randomFillSync(keyInfo.privateKeyMaterial);
      }
    }

    this.keyStore.clear();
    this.keys.clear();

    this.logAudit({
      operation: 'clearAllKeys',
      success: true,
    });
  }

  /**
   * Get token info
   */
  async getTokenInfo(): Promise<{
    label: string;
    tokenId: string;
    keyCount: number;
    maxKeys: number;
  }> {
    return {
      label: this.softConfig.tokenLabel || 'SoftHSM-Dev-Token',
      tokenId: this.tokenId,
      keyCount: this.keyStore.size,
      maxKeys: this.softConfig.maxKeys || 1000,
    };
  }
}
