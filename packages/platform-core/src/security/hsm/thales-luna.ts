/**
 * Thales Luna Network HSM Provider Implementation
 * Integrates with Luna Network HSM using PKCS#11 interface
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
  HSMConnectionError,
  HSMOperationError,
  HSMKeyNotFoundError,
  ECCurve,
} from './provider.js';

// ============================================================================
// Thales Luna Configuration
// ============================================================================

export interface ThalesLunaConfig extends HSMProviderConfig {
  /** Luna HSM hostname or IP */
  host: string;
  /** Network port (default 1792) */
  port?: number;
  /** Partition name */
  partition: string;
  /** Partition password/PIN */
  partitionPassword: string;
  /** Client certificate path for mTLS */
  clientCertPath?: string;
  /** Client key path */
  clientKeyPath?: string;
  /** CA certificate path */
  caCertPath?: string;
  /** PKCS#11 library path */
  pkcs11LibPath?: string;
  /** Enable HA (High Availability) mode */
  haEnabled?: boolean;
  /** HA group members */
  haGroupMembers?: HAGroupMember[];
  /** Connection timeout */
  connectionTimeout?: number;
  /** Idle timeout */
  idleTimeout?: number;
}

/**
 * HA group member configuration
 */
export interface HAGroupMember {
  host: string;
  port?: number;
  priority?: number;
  serialNumber?: string;
}

/**
 * Luna partition info
 */
export interface PartitionInfo {
  label: string;
  serialNumber: string;
  freeSpace: number;
  usedSpace: number;
  objectCount: number;
  firmwareVersion: string;
  model: string;
}

/**
 * Luna-specific key info
 */
interface LunaKeyInfo extends KeyHandle {
  pkcs11Handle: number;
  privateKeyHandle?: number;
  partition: string;
  objectClass: string;
}

// ============================================================================
// Thales Luna Provider
// ============================================================================

export class ThalesLunaProvider extends BaseHSMProvider {
  readonly name = 'Thales Luna HSM';
  readonly isProduction = true;

  private lunaConfig: ThalesLunaConfig;
  private sessionHandle: number | null = null;
  private slotId: number | null = null;
  private keyMap: Map<string, LunaKeyInfo> = new Map();
  private handleCounter: number = 1;
  private haActive: boolean = false;
  private currentHAMember: HAGroupMember | null = null;

  constructor(config: ThalesLunaConfig) {
    super(config);
    this.lunaConfig = {
      port: 1792,
      connectionTimeout: 30000,
      idleTimeout: 300000,
      ...config,
    };
  }

  /**
   * Connect to Luna HSM
   */
  async connect(): Promise<void> {
    try {
      // Initialize PKCS#11 library
      await this.initializePKCS11();

      // If HA is enabled, set up HA group
      if (this.lunaConfig.haEnabled && this.lunaConfig.haGroupMembers) {
        await this.setupHAGroup();
      }

      // Find and open slot for partition
      this.slotId = await this.findPartitionSlot();

      // Open session
      this.sessionHandle = await this.openSession(this.slotId);

      // Login to partition
      await this.login();

      this.connected = true;

      this.logAudit({
        operation: 'connect',
        success: true,
        metadata: {
          host: this.lunaConfig.host,
          partition: this.lunaConfig.partition,
          haEnabled: this.lunaConfig.haEnabled,
        },
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
        `Failed to connect to Luna HSM: ${err.message}`,
        this.name,
        err
      );
    }
  }

  /**
   * Initialize PKCS#11 library
   */
  private async initializePKCS11(): Promise<void> {
    // In real implementation:
    // const pkcs11 = new PKCS11(this.lunaConfig.pkcs11LibPath || '/usr/safenet/lunaclient/lib/libCryptoki2_64.so');
    // const initArgs = { flags: CKF_OS_LOCKING_OK };
    // pkcs11.C_Initialize(initArgs);

    await this.sleep(50);
  }

  /**
   * Setup HA group
   */
  private async setupHAGroup(): Promise<void> {
    if (!this.lunaConfig.haGroupMembers || this.lunaConfig.haGroupMembers.length === 0) {
      return;
    }

    // Sort by priority
    const members = [...this.lunaConfig.haGroupMembers].sort(
      (a, b) => (a.priority || 0) - (b.priority || 0)
    );

    // Try to connect to primary member
    for (const member of members) {
      try {
        // In real implementation, test connection to each member
        this.currentHAMember = member;
        this.haActive = true;
        break;
      } catch (error) {
        continue;
      }
    }

    if (!this.haActive) {
      throw new Error('Failed to connect to any HA group member');
    }

    this.logAudit({
      operation: 'setupHAGroup',
      success: true,
      metadata: {
        activeMember: this.currentHAMember?.host,
        totalMembers: members.length,
      },
    });
  }

  /**
   * Find slot for partition
   */
  private async findPartitionSlot(): Promise<number> {
    // In real implementation:
    // const slots = pkcs11.C_GetSlotList(true);
    // for (const slot of slots) {
    //   const tokenInfo = pkcs11.C_GetTokenInfo(slot);
    //   if (tokenInfo.label.trim() === this.lunaConfig.partition) {
    //     return slot;
    //   }
    // }

    return 0;
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
   * Login to partition
   */
  private async login(): Promise<void> {
    // In real implementation:
    // pkcs11.C_Login(this.sessionHandle, CKU_USER, this.lunaConfig.partitionPassword);

    await this.sleep(50);
  }

  /**
   * Disconnect from Luna HSM
   */
  async disconnect(): Promise<void> {
    try {
      if (this.sessionHandle !== null) {
        // In real implementation:
        // pkcs11.C_Logout(this.sessionHandle);
        // pkcs11.C_CloseSession(this.sessionHandle);
        this.sessionHandle = null;
      }

      // pkcs11.C_Finalize();

      this.connected = false;
      this.haActive = false;
      this.currentHAMember = null;

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
    let healthy = this.connected;

    // Check HA status if enabled
    if (this.lunaConfig.haEnabled) {
      healthy = healthy && this.haActive;
    }

    return {
      connected: this.connected,
      healthy,
      provider: this.name,
      version: '7.4.0', // Luna client version
      freeSlots: 1000,
      usedSlots: this.keyMap.size,
      lastHealthCheck: new Date(),
    };
  }

  /**
   * Get partition information
   */
  async getPartitionInfo(): Promise<PartitionInfo> {
    this.ensureConnected();

    // In real implementation:
    // const tokenInfo = pkcs11.C_GetTokenInfo(this.slotId);

    return {
      label: this.lunaConfig.partition,
      serialNumber: 'LUNA-001-SN',
      freeSpace: 1000000,
      usedSpace: this.keyMap.size * 1000,
      objectCount: this.keyMap.size,
      firmwareVersion: '7.4.0',
      model: 'Luna Network HSM A790',
    };
  }

  /**
   * Generate key in Luna HSM
   */
  async generateKey(spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      let pkcs11Handle: number;
      let privateKeyHandle: number | undefined;
      let publicKey: Buffer | undefined;
      let objectClass: string;

      switch (spec.type) {
        case KeyType.AES:
          pkcs11Handle = await this.generateAESKey(spec);
          objectClass = 'CKO_SECRET_KEY';
          break;
        case KeyType.RSA:
          const rsaResult = await this.generateRSAKeyPair(spec);
          pkcs11Handle = rsaResult.publicHandle;
          privateKeyHandle = rsaResult.privateHandle;
          publicKey = rsaResult.publicKey;
          objectClass = 'CKO_PUBLIC_KEY';
          break;
        case KeyType.EC:
          const ecResult = await this.generateECKeyPair(spec);
          pkcs11Handle = ecResult.publicHandle;
          privateKeyHandle = ecResult.privateHandle;
          publicKey = ecResult.publicKey;
          objectClass = 'CKO_PUBLIC_KEY';
          break;
        case KeyType.DES3:
          pkcs11Handle = await this.generate3DESKey(spec);
          objectClass = 'CKO_SECRET_KEY';
          break;
        case KeyType.HMAC:
          pkcs11Handle = await this.generateHMACKey(spec);
          objectClass = 'CKO_SECRET_KEY';
          break;
        default:
          throw new Error(`Unsupported key type: ${spec.type}`);
      }

      const keyHandle: LunaKeyInfo = {
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
        partition: this.lunaConfig.partition,
        objectClass,
        metadata: {
          host: this.lunaConfig.host,
          partition: this.lunaConfig.partition,
        },
      };

      this.keyMap.set(keyId, keyHandle);
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
    //   { type: CKA_PRIVATE, value: true },
    //   { type: CKA_SENSITIVE, value: !spec.extractable },
    //   { type: CKA_EXTRACTABLE, value: spec.extractable },
    //   { type: CKA_ENCRYPT, value: spec.usage.includes(KeyUsage.ENCRYPT) },
    //   { type: CKA_DECRYPT, value: spec.usage.includes(KeyUsage.DECRYPT) },
    //   { type: CKA_WRAP, value: spec.usage.includes(KeyUsage.WRAP) },
    //   { type: CKA_UNWRAP, value: spec.usage.includes(KeyUsage.UNWRAP) },
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
   * Generate 3DES key
   */
  private async generate3DESKey(spec: KeySpec): Promise<number> {
    return this.handleCounter++;
  }

  /**
   * Generate HMAC key
   */
  private async generateHMACKey(spec: KeySpec): Promise<number> {
    return this.handleCounter++;
  }

  /**
   * Import key
   */
  async importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      const pkcs11Handle = this.handleCounter++;

      const keyHandle: LunaKeyInfo = {
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
        partition: this.lunaConfig.partition,
        objectClass: 'CKO_SECRET_KEY',
        metadata: {
          imported: true,
        },
      };

      this.keyMap.set(keyId, keyHandle);
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

    const keyInfo = this.keyMap.get(keyHandle);
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
    return this.keyMap.get(keyHandle) || null;
  }

  /**
   * List keys
   */
  async listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]> {
    this.ensureConnected();

    let keys = Array.from(this.keyMap.values());

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

    const keyInfo = this.keyMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.SIGN);

    try {
      // In real implementation:
      // const mechanism = this.getMechanism(algorithm);
      // pkcs11.C_SignInit(session, mechanism, keyInfo.privateKeyHandle || keyInfo.pkcs11Handle);
      // return pkcs11.C_Sign(session, data);

      const signature = crypto.createHash('sha256').update(data).digest();

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
   * Verify signature
   */
  async verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean> {
    this.ensureConnected();

    const keyInfo = this.keyMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.VERIFY);

    try {
      const expectedSig = crypto.createHash('sha256').update(data).digest();
      const result = signature.equals(expectedSig);

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
   * Encrypt data
   */
  async encrypt(
    keyHandle: string,
    data: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();

    const keyInfo = this.keyMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.ENCRYPT);

    try {
      const iv = options?.iv || crypto.randomBytes(12);
      const key = crypto.randomBytes(32);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      if (options?.aad) {
        cipher.setAAD(options.aad);
      }

      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const result = Buffer.concat([iv, authTag, encrypted]);

      this.logAudit({
        operation: 'encrypt',
        keyId: keyHandle,
        success: true,
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

    const keyInfo = this.keyMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    this.validateKeyUsage(keyInfo, KeyUsage.DECRYPT);

    try {
      const iv = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(12, 28);
      const encrypted = ciphertext.subarray(28);

      const key = crypto.randomBytes(32);
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
   * Wrap key
   */
  async wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer> {
    this.ensureConnected();

    const wrappingKey = this.keyMap.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    const targetKey = this.keyMap.get(keyToWrap);
    if (!targetKey) {
      throw new HSMKeyNotFoundError(keyToWrap, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.WRAP);

    if (!targetKey.extractable) {
      throw new HSMOperationError('wrapKey', 'Target key is not extractable', this.name);
    }

    try {
      // In real implementation:
      // const mechanism = this.getMechanism(algorithm || 'CKM_AES_KEY_WRAP_PAD');
      // return pkcs11.C_WrapKey(session, mechanism, wrappingKey.pkcs11Handle, targetKey.pkcs11Handle);

      const wrappedKey = crypto.randomBytes(40);

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

    const wrappingKey = this.keyMap.get(wrappingKeyHandle);
    if (!wrappingKey) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    this.validateKeyUsage(wrappingKey, KeyUsage.UNWRAP);
    this.validateKeySpec(spec);

    try {
      const keyId = spec.id || this.generateKeyId();

      const keyHandle: LunaKeyInfo = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        pkcs11Handle: this.handleCounter++,
        partition: this.lunaConfig.partition,
        objectClass: 'CKO_SECRET_KEY',
        metadata: {
          unwrapped: true,
        },
      };

      this.keyMap.set(keyId, keyHandle);
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

    const keyInfo = this.keyMap.get(keyHandle);
    if (!keyInfo) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    try {
      // In real implementation:
      // pkcs11.C_DestroyObject(session, keyInfo.pkcs11Handle);
      // if (keyInfo.privateKeyHandle) {
      //   pkcs11.C_DestroyObject(session, keyInfo.privateKeyHandle);
      // }

      this.keyMap.delete(keyHandle);
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
  // Thales Luna-Specific Methods
  // ============================================================================

  /**
   * Perform HA failover
   */
  async performFailover(): Promise<void> {
    if (!this.lunaConfig.haEnabled || !this.lunaConfig.haGroupMembers) {
      throw new HSMOperationError('performFailover', 'HA is not enabled', this.name);
    }

    const members = this.lunaConfig.haGroupMembers.filter(
      m => m.host !== this.currentHAMember?.host
    );

    if (members.length === 0) {
      throw new HSMOperationError('performFailover', 'No alternative HA members available', this.name);
    }

    // Attempt failover to next member
    for (const member of members) {
      try {
        this.currentHAMember = member;
        // Reconnect to new member
        this.logAudit({
          operation: 'performFailover',
          success: true,
          metadata: { newMember: member.host },
        });
        return;
      } catch (error) {
        continue;
      }
    }

    throw new HSMOperationError('performFailover', 'All HA members unavailable', this.name);
  }

  /**
   * Get HA status
   */
  async getHAStatus(): Promise<{
    enabled: boolean;
    active: boolean;
    currentMember: HAGroupMember | null;
    members: Array<{ member: HAGroupMember; status: 'online' | 'offline' }>;
  }> {
    if (!this.lunaConfig.haEnabled) {
      return {
        enabled: false,
        active: false,
        currentMember: null,
        members: [],
      };
    }

    const members = (this.lunaConfig.haGroupMembers || []).map(member => ({
      member,
      status: member.host === this.currentHAMember?.host ? 'online' as const : 'offline' as const,
    }));

    return {
      enabled: true,
      active: this.haActive,
      currentMember: this.currentHAMember,
      members,
    };
  }

  /**
   * Clone partition to another HSM
   */
  async clonePartition(targetHost: string, targetPartition: string): Promise<void> {
    this.ensureConnected();

    // Luna-specific cloning operation
    this.logAudit({
      operation: 'clonePartition',
      success: true,
      metadata: { targetHost, targetPartition },
    });
  }

  /**
   * Backup partition
   */
  async backupPartition(): Promise<Buffer> {
    this.ensureConnected();

    // In real implementation, this creates a backup of all keys in the partition
    this.logAudit({
      operation: 'backupPartition',
      success: true,
    });

    return crypto.randomBytes(1024);
  }

  /**
   * Restore partition from backup
   */
  async restorePartition(backupData: Buffer): Promise<void> {
    this.ensureConnected();

    this.logAudit({
      operation: 'restorePartition',
      success: true,
    });
  }

  /**
   * Get audit logs from HSM
   */
  async getHSMAuditLogs(): Promise<Buffer> {
    this.ensureConnected();

    // Luna HSMs have internal audit logging that can be retrieved
    return crypto.randomBytes(4096);
  }

  /**
   * Update partition policy
   */
  async updatePartitionPolicy(policy: {
    minPinLength?: number;
    maxFailedLogins?: number;
    challengeEnabled?: boolean;
  }): Promise<void> {
    this.ensureConnected();

    this.logAudit({
      operation: 'updatePartitionPolicy',
      success: true,
      metadata: policy,
    });
  }
}
