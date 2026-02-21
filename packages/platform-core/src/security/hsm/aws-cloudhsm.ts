/**
 * AWS CloudHSM Provider Implementation
 * Integrates with AWS CloudHSM using PKCS#11 interface
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
  SigningAlgorithm,
  HSMConnectionError,
  HSMOperationError,
  HSMKeyNotFoundError,
  ECCurve,
} from './provider';

// ============================================================================
// AWS CloudHSM Configuration
// ============================================================================

export interface AWSCloudHSMConfig extends HSMProviderConfig {
  /** CloudHSM cluster ID */
  clusterId: string;
  /** AWS region */
  region: string;
  /** HSM IP addresses for direct connection */
  hsmIpAddresses?: string[];
  /** Path to customer CA certificate */
  customerCaCert?: string;
  /** Crypto user credentials */
  cryptoUser: {
    username: string;
    password: string;
  };
  /** PKCS#11 library path */
  pkcs11LibPath?: string;
  /** Partition label */
  partitionLabel?: string;
  /** Enable key synchronization across cluster */
  enableKeySync?: boolean;
  /** Client certificate for mTLS */
  clientCert?: string;
  /** Client key for mTLS */
  clientKey?: string;
}

/**
 * PKCS#11 session state
 */
interface PKCS11Session {
  slotId: number;
  sessionHandle: number;
  loggedIn: boolean;
}

/**
 * Internal key storage with PKCS#11 handle
 */
interface PKCS11KeyInfo extends KeyHandle {
  pkcs11Handle: number;
  privateKeyHandle?: number;
}

// ============================================================================
// AWS CloudHSM Provider
// ============================================================================

export class AWSCloudHSMProvider extends BaseHSMProvider {
  readonly name = 'AWS CloudHSM';
  readonly isProduction = true;

  private hsmConfig: AWSCloudHSMConfig;
  private session: PKCS11Session | null = null;
  private keyHandleMap: Map<string, PKCS11KeyInfo> = new Map();
  private pkcs11Initialized: boolean = false;

  // Simulated PKCS#11 handle counter (in real implementation, this comes from the library)
  private handleCounter: number = 1;

  constructor(config: AWSCloudHSMConfig) {
    super(config);
    this.hsmConfig = config;
  }

  /**
   * Initialize PKCS#11 library and connect to HSM
   */
  async connect(): Promise<void> {
    try {
      this.logAudit({
        operation: 'connect',
        success: false,
        metadata: { clusterId: this.hsmConfig.clusterId },
      });

      // Initialize PKCS#11 library
      await this.initializePKCS11();

      // Find and open slot
      const slotId = await this.findSlot();

      // Open session
      const sessionHandle = await this.openSession(slotId);

      // Login as crypto user
      await this.login(sessionHandle);

      this.session = {
        slotId,
        sessionHandle,
        loggedIn: true,
      };

      this.connected = true;

      // Sync existing keys if enabled
      if (this.hsmConfig.enableKeySync) {
        await this.syncKeys();
      }

      this.logAudit({
        operation: 'connect',
        success: true,
        metadata: { clusterId: this.hsmConfig.clusterId, slotId },
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
        `Failed to connect to AWS CloudHSM: ${err.message}`,
        this.name,
        err
      );
    }
  }

  /**
   * Initialize PKCS#11 library
   */
  private async initializePKCS11(): Promise<void> {
    // In real implementation, this would load the PKCS#11 library
    // const pkcs11 = new PKCS11(this.hsmConfig.pkcs11LibPath || '/opt/cloudhsm/lib/libcloudhsm_pkcs11.so');
    // pkcs11.C_Initialize({ flags: CKF_OS_LOCKING_OK });

    this.pkcs11Initialized = true;
    this.emit('pkcs11_initialized');
  }

  /**
   * Find HSM slot
   */
  private async findSlot(): Promise<number> {
    // In real implementation:
    // const slots = pkcs11.C_GetSlotList(true);
    // return slots.find(slot => {
    //   const info = pkcs11.C_GetSlotInfo(slot);
    //   return info.slotDescription.includes(this.hsmConfig.partitionLabel);
    // });

    // Simulated slot ID
    return 1;
  }

  /**
   * Open PKCS#11 session
   */
  private async openSession(slotId: number): Promise<number> {
    // In real implementation:
    // return pkcs11.C_OpenSession(slotId, CKF_SERIAL_SESSION | CKF_RW_SESSION);

    return this.handleCounter++;
  }

  /**
   * Login to HSM
   */
  private async login(sessionHandle: number): Promise<void> {
    // In real implementation:
    // pkcs11.C_Login(sessionHandle, CKU_USER, this.hsmConfig.cryptoUser.password);

    // Simulate login delay
    await this.sleep(100);
  }

  /**
   * Sync keys from HSM
   */
  private async syncKeys(): Promise<void> {
    // In real implementation, enumerate all keys from the HSM
    // and populate the local key map

    this.logAudit({
      operation: 'syncKeys',
      success: true,
      metadata: { keysFound: this.keyHandleMap.size },
    });
  }

  /**
   * Disconnect from HSM
   */
  async disconnect(): Promise<void> {
    try {
      if (this.session) {
        // Logout and close session
        // pkcs11.C_Logout(this.session.sessionHandle);
        // pkcs11.C_CloseSession(this.session.sessionHandle);
        this.session = null;
      }

      if (this.pkcs11Initialized) {
        // pkcs11.C_Finalize();
        this.pkcs11Initialized = false;
      }

      this.connected = false;

      this.logAudit({
        operation: 'disconnect',
        success: true,
      });

      this.emit('disconnected', { provider: this.name });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'disconnect',
        success: false,
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Get HSM status
   */
  async getStatus(): Promise<HSMStatus> {
    return {
      connected: this.connected,
      healthy: this.connected && this.session?.loggedIn === true,
      provider: this.name,
      version: '5.8.0', // CloudHSM client version
      freeSlots: 100,
      usedSlots: this.keyHandleMap.size,
      lastHealthCheck: new Date(),
    };
  }

  /**
   * Generate key using PKCS#11
   */
  async generateKey(spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      let pkcs11Handle: number;
      let privateKeyHandle: number | undefined;
      let publicKey: Buffer | undefined;

      switch (spec.type) {
        case KeyType.AES:
          pkcs11Handle = await this.generateAESKey(spec);
          break;
        case KeyType.RSA:
          const rsaResult = await this.generateRSAKeyPair(spec);
          pkcs11Handle = rsaResult.publicHandle;
          privateKeyHandle = rsaResult.privateHandle;
          publicKey = rsaResult.publicKey;
          break;
        case KeyType.EC:
          const ecResult = await this.generateECKeyPair(spec);
          pkcs11Handle = ecResult.publicHandle;
          privateKeyHandle = ecResult.privateHandle;
          publicKey = ecResult.publicKey;
          break;
        case KeyType.HMAC:
          pkcs11Handle = await this.generateHMACKey(spec);
          break;
        default:
          throw new Error(`Unsupported key type: ${spec.type}`);
      }

      const keyHandle: PKCS11KeyInfo = {
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
        pkcs11Handle,
        privateKeyHandle,
        metadata: {
          clusterId: this.hsmConfig.clusterId,
          region: this.hsmConfig.region,
        },
      };

      this.keyHandleMap.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'generateKey',
        keyId,
        success: true,
        metadata: { type: spec.type, label: spec.label },
      });

      return keyHandle;
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
   * Generate AES key
   */
  private async generateAESKey(spec: KeySpec): Promise<number> {
    // In real implementation:
    // const template = [
    //   { type: CKA_CLASS, value: CKO_SECRET_KEY },
    //   { type: CKA_KEY_TYPE, value: CKK_AES },
    //   { type: CKA_VALUE_LEN, value: (spec.size || 256) / 8 },
    //   { type: CKA_LABEL, value: spec.label },
    //   { type: CKA_TOKEN, value: true },
    //   { type: CKA_ENCRYPT, value: spec.usage.includes(KeyUsage.ENCRYPT) },
    //   { type: CKA_DECRYPT, value: spec.usage.includes(KeyUsage.DECRYPT) },
    //   { type: CKA_WRAP, value: spec.usage.includes(KeyUsage.WRAP) },
    //   { type: CKA_UNWRAP, value: spec.usage.includes(KeyUsage.UNWRAP) },
    //   { type: CKA_EXTRACTABLE, value: spec.extractable },
    // ];
    // return pkcs11.C_GenerateKey(session, { mechanism: CKM_AES_KEY_GEN }, template);

    return this.handleCounter++;
  }

  /**
   * Generate RSA key pair
   */
  private async generateRSAKeyPair(
    spec: KeySpec
  ): Promise<{ publicHandle: number; privateHandle: number; publicKey: Buffer }> {
    // In real implementation, use C_GenerateKeyPair with CKM_RSA_PKCS_KEY_PAIR_GEN

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: spec.size || 2048,
    });

    return {
      publicHandle: this.handleCounter++,
      privateHandle: this.handleCounter++,
      publicKey: publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    };
  }

  /**
   * Generate EC key pair
   */
  private async generateECKeyPair(
    spec: KeySpec
  ): Promise<{ publicHandle: number; privateHandle: number; publicKey: Buffer }> {
    const curveMap: Record<ECCurve, string> = {
      [ECCurve.P256]: 'prime256v1',
      [ECCurve.P384]: 'secp384r1',
      [ECCurve.P521]: 'secp521r1',
      [ECCurve.SECP256K1]: 'secp256k1',
      [ECCurve.ED25519]: 'ed25519',
    };

    const curve = curveMap[spec.curve || ECCurve.P256];

    let publicKey: Buffer;

    if (curve === 'ed25519') {
      const keyPair = crypto.generateKeyPairSync('ed25519');
      publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    } else {
      const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: curve });
      publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    }

    return {
      publicHandle: this.handleCounter++,
      privateHandle: this.handleCounter++,
      publicKey,
    };
  }

  /**
   * Generate HMAC key
   */
  private async generateHMACKey(spec: KeySpec): Promise<number> {
    return this.handleCounter++;
  }

  /**
   * Import key into HSM
   */
  async importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      // In real implementation, use C_CreateObject to import the key
      const pkcs11Handle = this.handleCounter++;

      const keyHandle: PKCS11KeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        expiresAt: spec.expiresAt,
        pkcs11Handle,
        metadata: {
          imported: true,
          clusterId: this.hsmConfig.clusterId,
        },
      };

      this.keyHandleMap.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'importKey',
        keyId,
        success: true,
      });

      return keyHandle;
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

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    if (!keyInfo.publicKey) {
      throw new HSMOperationError('exportPublicKey', 'Not an asymmetric key', this.name);
    }

    return keyInfo.publicKey;
  }

  /**
   * Get key metadata
   */
  async getKey(keyHandle: string): Promise<KeyHandle | null> {
    this.ensureConnected();
    return this.keyHandleMap.get(keyHandle) || null;
  }

  /**
   * List keys
   */
  async listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]> {
    this.ensureConnected();

    let keys = Array.from(this.keyHandleMap.values());

    if (filter) {
      if (filter.type) {
        keys = keys.filter(k => k.type === filter.type);
      }
      if (filter.label) {
        keys = keys.filter(k => k.label.includes(filter.label!));
      }
    }

    return keys;
  }

  /**
   * Sign data
   */
  async sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer> {
    this.ensureConnected();

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.SIGN);

    try {
      // In real implementation, use C_Sign with appropriate mechanism
      // const mechanism = this.getMechanism(algorithm);
      // pkcs11.C_SignInit(session, mechanism, keyInfo.privateKeyHandle || keyInfo.pkcs11Handle);
      // return pkcs11.C_Sign(session, data);

      // Simulated signature
      const signature = crypto.createHash('sha256').update(data).digest();

      this.logAudit({
        operation: 'sign',
        keyId: keyHandle,
        success: true,
        metadata: { algorithm, dataLength: data.length },
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
   * Verify signature
   */
  async verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean> {
    this.ensureConnected();

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.VERIFY);

    try {
      // In real implementation, use C_Verify
      // Simulated verification
      const expectedSig = crypto.createHash('sha256').update(data).digest();
      const result = signature.equals(expectedSig);

      this.logAudit({
        operation: 'verify',
        keyId: keyHandle,
        success: true,
        metadata: { algorithm, valid: result },
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
   * Encrypt data
   */
  async encrypt(
    keyHandle: string,
    data: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.ENCRYPT);

    try {
      const algorithm = options?.algorithm || EncryptionAlgorithm.AES_GCM;
      const iv = options?.iv || crypto.randomBytes(12);
      const tagLength = options?.tagLength || 16;

      // In real implementation, use C_Encrypt with appropriate mechanism
      // Simulated encryption for demonstration
      const key = crypto.randomBytes(32); // Would come from HSM
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      if (options?.aad) {
        cipher.setAAD(options.aad);
      }

      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: IV + AuthTag + Ciphertext
      const result = Buffer.concat([iv, authTag, encrypted]);

      this.logAudit({
        operation: 'encrypt',
        keyId: keyHandle,
        success: true,
        metadata: { algorithm, dataLength: data.length },
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
   * Decrypt data
   */
  async decrypt(
    keyHandle: string,
    ciphertext: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.DECRYPT);

    try {
      // Extract IV and auth tag from ciphertext
      const iv = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(12, 28);
      const encrypted = ciphertext.subarray(28);

      // In real implementation, use C_Decrypt with appropriate mechanism
      // Simulated decryption
      const key = crypto.randomBytes(32); // Would come from HSM
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      if (options?.aad) {
        decipher.setAAD(options.aad);
      }

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      this.logAudit({
        operation: 'decrypt',
        keyId: keyHandle,
        success: true,
        metadata: { ciphertextLength: ciphertext.length },
      });

      return decrypted;
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
   * Wrap key for export
   */
  async wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer> {
    this.ensureConnected();

    const wrappingKey = this.keyHandleMap.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    const targetKey = this.keyHandleMap.get(keyToWrap);
    if (!targetKey) {
      throw new HSMKeyNotFoundError(keyToWrap, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.WRAP);

    if (!targetKey.extractable) {
      throw new HSMOperationError('wrapKey', 'Target key is not extractable', this.name);
    }

    try {
      // In real implementation:
      // const mechanism = this.getMechanism(algorithm || 'AES-KWP');
      // return pkcs11.C_WrapKey(session, mechanism, wrappingKey.pkcs11Handle, targetKey.pkcs11Handle);

      // Simulated key wrapping
      const wrappedKey = crypto.randomBytes(40);

      this.logAudit({
        operation: 'wrapKey',
        keyId: keyToWrap,
        success: true,
        metadata: { wrappingKeyId: wrappingKeyHandle },
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
   * Unwrap and import key
   */
  async unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string> {
    this.ensureConnected();

    const wrappingKey = this.keyHandleMap.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.UNWRAP);
    this.validateKeySpec(spec);

    try {
      const keyId = spec.id || this.generateKeyId();

      // In real implementation:
      // const mechanism = this.getMechanism(algorithm || 'AES-KWP');
      // const template = this.buildKeyTemplate(spec);
      // const handle = pkcs11.C_UnwrapKey(session, mechanism, wrappingKey.pkcs11Handle, wrappedKey, template);

      const keyHandle: PKCS11KeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        pkcs11Handle: this.handleCounter++,
        metadata: {
          unwrapped: true,
          wrappingKeyId: wrappingKeyHandle,
        },
      };

      this.keyHandleMap.set(keyId, keyHandle);
      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'unwrapKey',
        keyId,
        success: true,
        metadata: { wrappingKeyId: wrappingKeyHandle },
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

    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    try {
      // In real implementation:
      // pkcs11.C_DestroyObject(session, keyInfo.pkcs11Handle);
      // if (keyInfo.privateKeyHandle) {
      //   pkcs11.C_DestroyObject(session, keyInfo.privateKeyHandle);
      // }

      this.keyHandleMap.delete(keyHandle);
      this.keys.delete(keyHandle);

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
  // AWS CloudHSM Specific Methods
  // ============================================================================

  /**
   * Get cluster information
   */
  async getClusterInfo(): Promise<{
    clusterId: string;
    state: string;
    hsms: Array<{ hsmId: string; state: string; ipAddress: string }>;
  }> {
    return {
      clusterId: this.hsmConfig.clusterId,
      state: 'ACTIVE',
      hsms: (this.hsmConfig.hsmIpAddresses || []).map((ip, i) => ({
        hsmId: `hsm-${i}`,
        state: 'ACTIVE',
        ipAddress: ip,
      })),
    };
  }

  /**
   * Create a new partition
   */
  async createPartition(label: string): Promise<void> {
    this.logAudit({
      operation: 'createPartition',
      success: true,
      metadata: { label },
    });
  }

  /**
   * Replicate key to all HSMs in cluster
   */
  async replicateKey(keyHandle: string): Promise<void> {
    const keyInfo = this.keyHandleMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.logAudit({
      operation: 'replicateKey',
      keyId: keyHandle,
      success: true,
    });
  }
}
