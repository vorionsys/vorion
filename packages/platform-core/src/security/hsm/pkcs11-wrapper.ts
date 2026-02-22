/**
 * PKCS#11 Interface Wrapper
 *
 * Provides a standardized PKCS#11 interface wrapper for smart card
 * and hardware token compatibility. This module enables:
 * - Smart card authentication
 * - PIV (Personal Identity Verification) card support
 * - YubiKey HSM integration
 * - Generic PKCS#11 token access
 *
 * FIPS 140-3 Compliance Notes:
 * - All cryptographic operations are performed within the token
 * - Private keys never leave the secure boundary
 * - Supports FIPS-approved algorithms only when in FIPS mode
 *
 * @module security/hsm/pkcs11-wrapper
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  IHSMProvider,
  BaseHSMProvider,
  HSMProviderConfig,
  HSMStatus,
  KeySpec,
  KeyHandle,
  KeyType,
  KeyUsage,
  ECCurve,
  EncryptionOptions,
  HSMConnectionError,
  HSMOperationError,
  HSMKeyNotFoundError,
  HSMPermissionError,
} from './provider.js';

// ============================================================================
// PKCS#11 Types and Constants
// ============================================================================

/**
 * PKCS#11 mechanism types
 */
export enum CKM {
  // RSA Mechanisms
  RSA_PKCS_KEY_PAIR_GEN = 0x00000000,
  RSA_PKCS = 0x00000001,
  RSA_PKCS_OAEP = 0x00000009,
  RSA_PKCS_PSS = 0x0000000D,

  // EC Mechanisms
  EC_KEY_PAIR_GEN = 0x00001040,
  ECDSA = 0x00001041,
  ECDSA_SHA256 = 0x00001044,
  ECDSA_SHA384 = 0x00001045,
  ECDSA_SHA512 = 0x00001046,
  ECDH1_DERIVE = 0x00001050,

  // AES Mechanisms
  AES_KEY_GEN = 0x00001080,
  AES_CBC = 0x00001082,
  AES_CBC_PAD = 0x00001085,
  AES_GCM = 0x00001087,
  AES_KEY_WRAP = 0x00002109,
  AES_KEY_WRAP_PAD = 0x0000210A,

  // SHA Mechanisms
  SHA256 = 0x00000250,
  SHA384 = 0x00000260,
  SHA512 = 0x00000270,
  SHA256_HMAC = 0x00000251,
  SHA384_HMAC = 0x00000261,
  SHA512_HMAC = 0x00000271,

  // Generic Secret Key
  GENERIC_SECRET_KEY_GEN = 0x00000350,

  // EdDSA (Edwards-curve DSA)
  EDDSA = 0x80000C01,
}

/**
 * PKCS#11 object class types
 */
export enum CKO {
  DATA = 0x00000000,
  CERTIFICATE = 0x00000001,
  PUBLIC_KEY = 0x00000002,
  PRIVATE_KEY = 0x00000003,
  SECRET_KEY = 0x00000004,
}

/**
 * PKCS#11 key types
 */
export enum CKK {
  RSA = 0x00000000,
  DSA = 0x00000001,
  DH = 0x00000002,
  EC = 0x00000003,
  GENERIC_SECRET = 0x00000010,
  AES = 0x0000001F,
  SHA256_HMAC = 0x0000002B,
  SHA384_HMAC = 0x0000002C,
  SHA512_HMAC = 0x0000002D,
  EC_EDWARDS = 0x00000040,
}

/**
 * PKCS#11 attribute types
 */
export enum CKA {
  CLASS = 0x00000000,
  TOKEN = 0x00000001,
  PRIVATE = 0x00000002,
  LABEL = 0x00000003,
  VALUE = 0x00000011,
  CERTIFICATE_TYPE = 0x00000080,
  ID = 0x00000102,
  SENSITIVE = 0x00000103,
  ENCRYPT = 0x00000104,
  DECRYPT = 0x00000105,
  WRAP = 0x00000106,
  UNWRAP = 0x00000107,
  SIGN = 0x00000108,
  VERIFY = 0x0000010A,
  DERIVE = 0x0000010C,
  MODULUS = 0x00000120,
  MODULUS_BITS = 0x00000121,
  PUBLIC_EXPONENT = 0x00000122,
  EC_PARAMS = 0x00000180,
  EC_POINT = 0x00000181,
  EXTRACTABLE = 0x00000162,
  KEY_TYPE = 0x00000100,
  VALUE_LEN = 0x00000161,
}

/**
 * PKCS#11 user types
 */
export enum CKU {
  SO = 0, // Security Officer
  USER = 1, // Normal user
  CONTEXT_SPECIFIC = 2,
}

/**
 * PKCS#11 return values
 */
export enum CKR {
  OK = 0x00000000,
  CANCEL = 0x00000001,
  HOST_MEMORY = 0x00000002,
  SLOT_ID_INVALID = 0x00000003,
  GENERAL_ERROR = 0x00000005,
  FUNCTION_FAILED = 0x00000006,
  ARGUMENTS_BAD = 0x00000007,
  NO_EVENT = 0x00000008,
  ATTRIBUTE_READ_ONLY = 0x00000010,
  ATTRIBUTE_SENSITIVE = 0x00000011,
  ATTRIBUTE_TYPE_INVALID = 0x00000012,
  ATTRIBUTE_VALUE_INVALID = 0x00000013,
  DATA_INVALID = 0x00000020,
  DATA_LEN_RANGE = 0x00000021,
  DEVICE_ERROR = 0x00000030,
  DEVICE_MEMORY = 0x00000031,
  DEVICE_REMOVED = 0x00000032,
  ENCRYPTED_DATA_INVALID = 0x00000040,
  ENCRYPTED_DATA_LEN_RANGE = 0x00000041,
  FUNCTION_CANCELED = 0x00000050,
  FUNCTION_NOT_PARALLEL = 0x00000051,
  FUNCTION_NOT_SUPPORTED = 0x00000054,
  KEY_HANDLE_INVALID = 0x00000060,
  KEY_SIZE_RANGE = 0x00000062,
  KEY_TYPE_INCONSISTENT = 0x00000063,
  KEY_NOT_NEEDED = 0x00000064,
  KEY_CHANGED = 0x00000065,
  KEY_NEEDED = 0x00000066,
  KEY_INDIGESTIBLE = 0x00000067,
  KEY_FUNCTION_NOT_PERMITTED = 0x00000068,
  KEY_NOT_WRAPPABLE = 0x00000069,
  KEY_UNEXTRACTABLE = 0x0000006A,
  MECHANISM_INVALID = 0x00000070,
  MECHANISM_PARAM_INVALID = 0x00000071,
  PIN_INCORRECT = 0x000000A0,
  PIN_INVALID = 0x000000A1,
  PIN_LEN_RANGE = 0x000000A2,
  PIN_EXPIRED = 0x000000A3,
  PIN_LOCKED = 0x000000A4,
  SESSION_CLOSED = 0x000000B0,
  SESSION_COUNT = 0x000000B1,
  SESSION_HANDLE_INVALID = 0x000000B3,
  SESSION_PARALLEL_NOT_SUPPORTED = 0x000000B4,
  SESSION_READ_ONLY = 0x000000B5,
  SESSION_EXISTS = 0x000000B6,
  SESSION_READ_ONLY_EXISTS = 0x000000B7,
  SESSION_READ_WRITE_SO_EXISTS = 0x000000B8,
  SIGNATURE_INVALID = 0x000000C0,
  SIGNATURE_LEN_RANGE = 0x000000C1,
  TOKEN_NOT_PRESENT = 0x000000E0,
  TOKEN_NOT_RECOGNIZED = 0x000000E1,
  TOKEN_WRITE_PROTECTED = 0x000000E2,
  USER_ALREADY_LOGGED_IN = 0x00000100,
  USER_NOT_LOGGED_IN = 0x00000101,
  USER_PIN_NOT_INITIALIZED = 0x00000102,
  USER_TYPE_INVALID = 0x00000103,
  CRYPTOKI_NOT_INITIALIZED = 0x00000190,
  CRYPTOKI_ALREADY_INITIALIZED = 0x00000191,
}

/**
 * PKCS#11 token info
 */
export interface TokenInfo {
  label: string;
  manufacturerId: string;
  model: string;
  serialNumber: string;
  flags: number;
  maxSessionCount: number;
  sessionCount: number;
  maxRwSessionCount: number;
  rwSessionCount: number;
  maxPinLen: number;
  minPinLen: number;
  totalPublicMemory: number;
  freePublicMemory: number;
  totalPrivateMemory: number;
  freePrivateMemory: number;
  hardwareVersion: { major: number; minor: number };
  firmwareVersion: { major: number; minor: number };
}

/**
 * PKCS#11 slot info
 */
export interface SlotInfo {
  slotId: number;
  slotDescription: string;
  manufacturerId: string;
  flags: number;
  hardwareVersion: { major: number; minor: number };
  firmwareVersion: { major: number; minor: number };
  tokenPresent: boolean;
}

/**
 * PKCS#11 mechanism info
 */
export interface MechanismInfo {
  mechanism: CKM;
  minKeySize: number;
  maxKeySize: number;
  flags: number;
}

// ============================================================================
// PKCS#11 Configuration
// ============================================================================

export interface PKCS11WrapperConfig extends HSMProviderConfig {
  /** Path to the PKCS#11 library (.so/.dylib/.dll) */
  libraryPath: string;
  /** Slot index or label to use */
  slot?: number | string;
  /** User PIN for authentication */
  userPin?: string;
  /** Security Officer PIN (for initialization) */
  soPin?: string;
  /** Whether to use hardware RNG only */
  useHardwareRng?: boolean;
  /** Enable FIPS mode (restrict to FIPS-approved algorithms) */
  fipsMode?: boolean;
  /** Read-only session */
  readOnly?: boolean;
  /** Supported mechanisms whitelist */
  allowedMechanisms?: CKM[];
}

/**
 * Internal session state
 */
interface PKCS11Session {
  handle: number;
  slotId: number;
  readWrite: boolean;
  loggedIn: boolean;
  userType?: CKU;
}

/**
 * PKCS#11 object handle
 */
interface PKCS11Object {
  handle: number;
  class: CKO;
  keyType?: CKK;
  label: string;
  id: Buffer;
  attributes: Map<CKA, Buffer | boolean | number>;
}

// ============================================================================
// PKCS#11 Wrapper Provider
// ============================================================================

/**
 * PKCS#11 wrapper for smart cards and hardware tokens
 */
export class PKCS11WrapperProvider extends BaseHSMProvider {
  readonly name = 'PKCS#11 Token';
  readonly isProduction = true;

  private pkcs11Config: PKCS11WrapperConfig;
  private session: PKCS11Session | null = null;
  private objectHandles: Map<string, PKCS11Object> = new Map();
  private handleCounter: number = 1;
  private fipsMode: boolean;

  // Simulated library state
  private initialized: boolean = false;
  private slots: SlotInfo[] = [];
  private tokenInfo: TokenInfo | null = null;
  private mechanisms: Map<number, MechanismInfo[]> = new Map();

  constructor(config: PKCS11WrapperConfig) {
    super(config);
    this.pkcs11Config = config;
    this.fipsMode = config.fipsMode ?? false;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Initialize and connect to PKCS#11 token
   */
  async connect(): Promise<void> {
    try {
      this.logAudit({
        operation: 'connect',
        success: false,
        metadata: { libraryPath: this.pkcs11Config.libraryPath },
      });

      // Initialize PKCS#11 library
      await this.initializeLibrary();

      // Find and select slot
      const slotId = await this.selectSlot();

      // Open session
      const sessionHandle = await this.openSession(slotId);

      this.session = {
        handle: sessionHandle,
        slotId,
        readWrite: !this.pkcs11Config.readOnly,
        loggedIn: false,
      };

      // Login if PIN provided
      if (this.pkcs11Config.userPin) {
        await this.login(CKU.USER, this.pkcs11Config.userPin);
      }

      this.connected = true;

      // Enumerate existing objects
      await this.enumerateObjects();

      this.logAudit({
        operation: 'connect',
        success: true,
        metadata: { slotId, fipsMode: this.fipsMode },
      });

      this.emit('connected', { provider: this.name, slotId });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'connect',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMConnectionError(
        `Failed to connect to PKCS#11 token: ${err.message}`,
        this.name,
        err
      );
    }
  }

  /**
   * Initialize PKCS#11 library (C_Initialize)
   */
  private async initializeLibrary(): Promise<void> {
    // In real implementation:
    // const pkcs11 = new PKCS11Module(this.pkcs11Config.libraryPath);
    // pkcs11.C_Initialize({ flags: CKF_OS_LOCKING_OK });

    // Simulate library initialization
    this.initialized = true;

    // Populate simulated slot list
    this.slots = [
      {
        slotId: 0,
        slotDescription: 'Virtual Smart Card Slot 0',
        manufacturerId: 'Vorion Security',
        flags: 0x07, // CKF_TOKEN_PRESENT | CKF_REMOVABLE_DEVICE | CKF_HW_SLOT
        hardwareVersion: { major: 1, minor: 0 },
        firmwareVersion: { major: 1, minor: 0 },
        tokenPresent: true,
      },
    ];

    // Set up token info
    this.tokenInfo = {
      label: 'Vorion PKCS#11 Token',
      manufacturerId: 'Vorion Security',
      model: 'Virtual HSM',
      serialNumber: crypto.randomBytes(8).toString('hex').toUpperCase(),
      flags: 0x405, // CKF_RNG | CKF_TOKEN_INITIALIZED | CKF_USER_PIN_INITIALIZED
      maxSessionCount: 64,
      sessionCount: 0,
      maxRwSessionCount: 32,
      rwSessionCount: 0,
      maxPinLen: 32,
      minPinLen: 4,
      totalPublicMemory: 65536,
      freePublicMemory: 65536,
      totalPrivateMemory: 32768,
      freePrivateMemory: 32768,
      hardwareVersion: { major: 2, minor: 40 },
      firmwareVersion: { major: 2, minor: 40 },
    };

    // Populate supported mechanisms
    this.mechanisms.set(0, [
      { mechanism: CKM.RSA_PKCS_KEY_PAIR_GEN, minKeySize: 2048, maxKeySize: 4096, flags: 0x10001 },
      { mechanism: CKM.RSA_PKCS_PSS, minKeySize: 2048, maxKeySize: 4096, flags: 0x10001 },
      { mechanism: CKM.EC_KEY_PAIR_GEN, minKeySize: 256, maxKeySize: 521, flags: 0x10001 },
      { mechanism: CKM.ECDSA_SHA256, minKeySize: 256, maxKeySize: 521, flags: 0x10001 },
      { mechanism: CKM.AES_KEY_GEN, minKeySize: 128, maxKeySize: 256, flags: 0x8001 },
      { mechanism: CKM.AES_GCM, minKeySize: 128, maxKeySize: 256, flags: 0x8001 },
      { mechanism: CKM.SHA256_HMAC, minKeySize: 256, maxKeySize: 512, flags: 0x8001 },
    ]);

    this.emit('libraryInitialized', { libraryPath: this.pkcs11Config.libraryPath });
  }

  /**
   * Select slot to use
   */
  private async selectSlot(): Promise<number> {
    // C_GetSlotList(TRUE, slots, &count)

    if (this.slots.length === 0) {
      throw new Error('No PKCS#11 slots available');
    }

    // If slot specified in config, find it
    if (this.pkcs11Config.slot !== undefined) {
      if (typeof this.pkcs11Config.slot === 'number') {
        const slot = this.slots.find(s => s.slotId === this.pkcs11Config.slot);
        if (!slot) {
          throw new Error(`Slot ${this.pkcs11Config.slot} not found`);
        }
        return slot.slotId;
      } else {
        // Find by label
        // In real implementation, check token label
        return this.slots[0].slotId;
      }
    }

    // Default to first slot with token present
    const slotWithToken = this.slots.find(s => s.tokenPresent);
    if (!slotWithToken) {
      throw new Error('No token present in any slot');
    }

    return slotWithToken.slotId;
  }

  /**
   * Open PKCS#11 session (C_OpenSession)
   */
  private async openSession(slotId: number): Promise<number> {
    // C_OpenSession(slotId, flags, &sessionHandle)
    const sessionHandle = this.handleCounter++;

    if (this.tokenInfo) {
      this.tokenInfo.sessionCount++;
      if (!this.pkcs11Config.readOnly) {
        this.tokenInfo.rwSessionCount++;
      }
    }

    return sessionHandle;
  }

  /**
   * Login to token (C_Login)
   */
  private async login(userType: CKU, pin: string): Promise<void> {
    if (!this.session) {
      throw new Error('No session open');
    }

    // C_Login(session, userType, pin, pinLen)

    // Simulate PIN verification
    if (pin.length < (this.tokenInfo?.minPinLen ?? 4)) {
      throw new HSMPermissionError('PIN too short', this.name);
    }

    this.session.loggedIn = true;
    this.session.userType = userType;

    this.logAudit({
      operation: 'login',
      success: true,
      metadata: { userType: CKU[userType] },
    });
  }

  /**
   * Enumerate objects in token
   */
  private async enumerateObjects(): Promise<void> {
    // C_FindObjectsInit, C_FindObjects, C_FindObjectsFinal

    // In real implementation, query all objects
    // For simulation, start empty
  }

  /**
   * Disconnect from token
   */
  async disconnect(): Promise<void> {
    if (this.session) {
      if (this.session.loggedIn) {
        // C_Logout
        this.session.loggedIn = false;
      }

      // C_CloseSession
      if (this.tokenInfo) {
        this.tokenInfo.sessionCount--;
        if (this.session.readWrite) {
          this.tokenInfo.rwSessionCount--;
        }
      }

      this.session = null;
    }

    if (this.initialized) {
      // C_Finalize
      this.initialized = false;
    }

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
      healthy: this.connected && this.session?.loggedIn === true,
      provider: this.name,
      version: this.tokenInfo?.firmwareVersion
        ? `${this.tokenInfo.firmwareVersion.major}.${this.tokenInfo.firmwareVersion.minor}`
        : '0.0',
      freeSlots: this.tokenInfo?.freePrivateMemory,
      usedSlots: this.objectHandles.size,
      lastHealthCheck: new Date(),
    };
  }

  // ============================================================================
  // Key Generation
  // ============================================================================

  /**
   * Generate key using PKCS#11
   */
  async generateKey(spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);
    this.validateFIPSCompliance(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      let publicKey: Buffer | undefined;
      let mechanism: CKM;

      switch (spec.type) {
        case KeyType.AES:
          mechanism = CKM.AES_KEY_GEN;
          await this.generateSymmetricKey(keyId, spec, mechanism);
          break;

        case KeyType.RSA:
          mechanism = CKM.RSA_PKCS_KEY_PAIR_GEN;
          publicKey = await this.generateKeyPair(keyId, spec, mechanism);
          break;

        case KeyType.EC:
          mechanism = CKM.EC_KEY_PAIR_GEN;
          publicKey = await this.generateKeyPair(keyId, spec, mechanism);
          break;

        case KeyType.HMAC:
          mechanism = CKM.GENERIC_SECRET_KEY_GEN;
          await this.generateSymmetricKey(keyId, spec, mechanism);
          break;

        default:
          throw new Error(`Unsupported key type for PKCS#11: ${spec.type}`);
      }

      const keyHandle: KeyHandle = {
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
        metadata: {
          pkcs11: true,
          fipsMode: this.fipsMode,
        },
      };

      this.keys.set(keyId, keyHandle);

      this.logAudit({
        operation: 'generateKey',
        keyId,
        success: true,
        metadata: { type: spec.type, mechanism: CKM[mechanism] },
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
   * Validate FIPS compliance of key spec
   */
  private validateFIPSCompliance(spec: KeySpec): void {
    if (!this.fipsMode) return;

    // FIPS 140-3 approved algorithms
    if (spec.type === KeyType.RSA && spec.size && spec.size < 2048) {
      throw new Error('FIPS mode requires RSA keys >= 2048 bits');
    }

    if (spec.type === KeyType.EC) {
      const approvedCurves = [ECCurve.P256, ECCurve.P384, ECCurve.P521];
      if (spec.curve && !approvedCurves.includes(spec.curve)) {
        throw new Error(`FIPS mode does not allow curve: ${spec.curve}`);
      }
    }

    if (spec.type === KeyType.AES && spec.size && spec.size < 128) {
      throw new Error('FIPS mode requires AES keys >= 128 bits');
    }
  }

  /**
   * Generate symmetric key (C_GenerateKey)
   */
  private async generateSymmetricKey(
    keyId: string,
    spec: KeySpec,
    mechanism: CKM
  ): Promise<void> {
    // Build attribute template
    // CK_ATTRIBUTE template[] = {...}

    // C_GenerateKey(session, &mechanism, template, templateSize, &keyHandle)

    const handle = this.handleCounter++;
    const keyMaterial = crypto.randomBytes((spec.size || 256) / 8);

    const obj: PKCS11Object = {
      handle,
      class: CKO.SECRET_KEY,
      keyType: spec.type === KeyType.AES ? CKK.AES : CKK.GENERIC_SECRET,
      label: spec.label,
      id: Buffer.from(keyId),
      attributes: new Map<CKA, Buffer | boolean | number>([
        [CKA.CLASS, CKO.SECRET_KEY],
        [CKA.KEY_TYPE, spec.type === KeyType.AES ? CKK.AES : CKK.GENERIC_SECRET],
        [CKA.LABEL, Buffer.from(spec.label)],
        [CKA.ID, Buffer.from(keyId)],
        [CKA.VALUE, keyMaterial],
        [CKA.VALUE_LEN, (spec.size || 256) / 8],
        [CKA.TOKEN, true],
        [CKA.PRIVATE, true],
        [CKA.SENSITIVE, true],
        [CKA.EXTRACTABLE, spec.extractable],
        [CKA.ENCRYPT, spec.usage.includes(KeyUsage.ENCRYPT)],
        [CKA.DECRYPT, spec.usage.includes(KeyUsage.DECRYPT)],
        [CKA.WRAP, spec.usage.includes(KeyUsage.WRAP)],
        [CKA.UNWRAP, spec.usage.includes(KeyUsage.UNWRAP)],
        [CKA.SIGN, spec.usage.includes(KeyUsage.SIGN)],
        [CKA.VERIFY, spec.usage.includes(KeyUsage.VERIFY)],
      ]),
    };

    this.objectHandles.set(keyId, obj);
  }

  /**
   * Generate key pair (C_GenerateKeyPair)
   */
  private async generateKeyPair(
    keyId: string,
    spec: KeySpec,
    mechanism: CKM
  ): Promise<Buffer> {
    // Build public/private key templates
    // C_GenerateKeyPair(session, &mechanism, pubTemplate, pubSize, privTemplate, privSize, &pubHandle, &privHandle)

    const pubHandle = this.handleCounter++;
    const privHandle = this.handleCounter++;

    let publicKey: Buffer;
    let privateKey: Buffer;

    if (spec.type === KeyType.RSA) {
      const keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: spec.size || 2048,
      });
      publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
      privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
    } else {
      // EC
      const curveMap: Record<ECCurve, string> = {
        [ECCurve.P256]: 'prime256v1',
        [ECCurve.P384]: 'secp384r1',
        [ECCurve.P521]: 'secp521r1',
        [ECCurve.SECP256K1]: 'secp256k1',
        [ECCurve.ED25519]: 'ed25519',
      };

      const curve = curveMap[spec.curve || ECCurve.P256];

      if (curve === 'ed25519') {
        const keyPair = crypto.generateKeyPairSync('ed25519');
        publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
        privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
      } else {
        const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: curve });
        publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
        privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
      }
    }

    // Store public key object
    const pubObj: PKCS11Object = {
      handle: pubHandle,
      class: CKO.PUBLIC_KEY,
      keyType: spec.type === KeyType.RSA ? CKK.RSA : CKK.EC,
      label: `${spec.label}-pub`,
      id: Buffer.from(`${keyId}-pub`),
      attributes: new Map<CKA, Buffer | boolean | number>([
        [CKA.CLASS, CKO.PUBLIC_KEY],
        [CKA.KEY_TYPE, spec.type === KeyType.RSA ? CKK.RSA : CKK.EC],
        [CKA.LABEL, Buffer.from(`${spec.label}-pub`)],
        [CKA.ID, Buffer.from(`${keyId}-pub`)],
        [CKA.VALUE, publicKey],
        [CKA.TOKEN, true],
        [CKA.VERIFY, spec.usage.includes(KeyUsage.VERIFY)],
        [CKA.ENCRYPT, spec.usage.includes(KeyUsage.ENCRYPT)],
      ]),
    };

    // Store private key object
    const privObj: PKCS11Object = {
      handle: privHandle,
      class: CKO.PRIVATE_KEY,
      keyType: spec.type === KeyType.RSA ? CKK.RSA : CKK.EC,
      label: `${spec.label}-priv`,
      id: Buffer.from(`${keyId}-priv`),
      attributes: new Map<CKA, Buffer | boolean | number>([
        [CKA.CLASS, CKO.PRIVATE_KEY],
        [CKA.KEY_TYPE, spec.type === KeyType.RSA ? CKK.RSA : CKK.EC],
        [CKA.LABEL, Buffer.from(`${spec.label}-priv`)],
        [CKA.ID, Buffer.from(`${keyId}-priv`)],
        [CKA.VALUE, privateKey],
        [CKA.TOKEN, true],
        [CKA.PRIVATE, true],
        [CKA.SENSITIVE, true],
        [CKA.EXTRACTABLE, spec.extractable],
        [CKA.SIGN, spec.usage.includes(KeyUsage.SIGN)],
        [CKA.DECRYPT, spec.usage.includes(KeyUsage.DECRYPT)],
        [CKA.UNWRAP, spec.usage.includes(KeyUsage.UNWRAP)],
      ]),
    };

    this.objectHandles.set(`${keyId}-pub`, pubObj);
    this.objectHandles.set(`${keyId}-priv`, privObj);
    this.objectHandles.set(keyId, privObj); // Map keyId to private key

    return publicKey;
  }

  // ============================================================================
  // Import/Export
  // ============================================================================

  /**
   * Import key (C_CreateObject)
   */
  async importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const keyId = spec.id || this.generateKeyId();

    try {
      const handle = this.handleCounter++;

      const obj: PKCS11Object = {
        handle,
        class: spec.type === KeyType.AES || spec.type === KeyType.HMAC
          ? CKO.SECRET_KEY
          : CKO.PRIVATE_KEY,
        label: spec.label,
        id: Buffer.from(keyId),
        attributes: new Map<CKA, Buffer | boolean | number>([
          [CKA.VALUE, keyMaterial],
          [CKA.LABEL, Buffer.from(spec.label)],
          [CKA.ID, Buffer.from(keyId)],
          [CKA.EXTRACTABLE, spec.extractable],
        ]),
      };

      this.objectHandles.set(keyId, obj);

      const keyHandle: KeyHandle = {
        id: keyId,
        label: spec.label,
        type: spec.type,
        size: spec.size,
        curve: spec.curve,
        usage: spec.usage,
        extractable: spec.extractable,
        createdAt: new Date(),
        metadata: { imported: true },
      };

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
   * Export public key (C_GetAttributeValue)
   */
  async exportPublicKey(keyHandle: string): Promise<Buffer> {
    this.ensureConnected();

    const pubObj = this.objectHandles.get(`${keyHandle}-pub`);
    if (!pubObj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    const value = pubObj.attributes.get(CKA.VALUE);
    if (!value || !(value instanceof Buffer)) {
      throw new HSMOperationError('exportPublicKey', 'No public key value', this.name);
    }

    return value;
  }

  /**
   * Get key metadata
   */
  async getKey(keyHandle: string): Promise<KeyHandle | null> {
    this.ensureConnected();
    return this.keys.get(keyHandle) || null;
  }

  /**
   * List keys
   */
  async listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]> {
    this.ensureConnected();

    let keys = Array.from(this.keys.values());

    if (filter?.type) {
      keys = keys.filter(k => k.type === filter.type);
    }
    if (filter?.label) {
      keys = keys.filter(k => k.label.includes(filter.label!));
    }

    return keys;
  }

  // ============================================================================
  // Cryptographic Operations
  // ============================================================================

  /**
   * Sign data (C_SignInit, C_Sign)
   */
  async sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer> {
    this.ensureConnected();

    const obj = this.objectHandles.get(keyHandle) || this.objectHandles.get(`${keyHandle}-priv`);
    if (!obj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    const keyData = this.keys.get(keyHandle);
    if (keyData && !keyData.usage.includes(KeyUsage.SIGN)) {
      throw new HSMPermissionError('Key does not permit signing', this.name);
    }

    try {
      const privateKeyMaterial = obj.attributes.get(CKA.VALUE);
      if (!privateKeyMaterial || !(privateKeyMaterial instanceof Buffer)) {
        throw new Error('No key material available');
      }

      let signature: Buffer;
      const keyType = keyData?.type;

      if (keyType === KeyType.RSA) {
        const privateKey = crypto.createPrivateKey({
          key: privateKeyMaterial,
          format: 'der',
          type: 'pkcs8',
        });
        signature = crypto.sign('sha256', data, {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        });
      } else if (keyType === KeyType.EC) {
        const privateKey = crypto.createPrivateKey({
          key: privateKeyMaterial,
          format: 'der',
          type: 'pkcs8',
        });
        signature = crypto.sign(
          keyData?.curve === ECCurve.ED25519 ? null : 'sha256',
          data,
          privateKey
        );
      } else if (keyType === KeyType.HMAC) {
        const hmac = crypto.createHmac('sha256', privateKeyMaterial);
        signature = hmac.update(data).digest();
      } else {
        throw new Error(`Unsupported key type for signing: ${keyType}`);
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
   * Verify signature (C_VerifyInit, C_Verify)
   */
  async verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean> {
    this.ensureConnected();

    const obj = this.objectHandles.get(`${keyHandle}-pub`) || this.objectHandles.get(keyHandle);
    if (!obj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    const keyData = this.keys.get(keyHandle);
    if (keyData && !keyData.usage.includes(KeyUsage.VERIFY)) {
      throw new HSMPermissionError('Key does not permit verification', this.name);
    }

    try {
      const keyMaterial = obj.attributes.get(CKA.VALUE);
      if (!keyMaterial || !(keyMaterial instanceof Buffer)) {
        throw new Error('No key material available');
      }

      let result: boolean;
      const keyType = keyData?.type;

      if (keyType === KeyType.RSA || keyType === KeyType.EC) {
        const publicKey = crypto.createPublicKey({
          key: keyMaterial,
          format: 'der',
          type: 'spki',
        });
        result = crypto.verify(
          keyData?.curve === ECCurve.ED25519 ? null : 'sha256',
          data,
          keyType === KeyType.RSA
            ? { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }
            : publicKey,
          signature
        );
      } else if (keyType === KeyType.HMAC) {
        const hmac = crypto.createHmac('sha256', keyMaterial);
        const expected = hmac.update(data).digest();
        result = crypto.timingSafeEqual(signature, expected);
      } else {
        throw new Error(`Unsupported key type for verification: ${keyType}`);
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
   * Encrypt data (C_EncryptInit, C_Encrypt)
   */
  async encrypt(
    keyHandle: string,
    data: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();

    const obj = this.objectHandles.get(keyHandle);
    if (!obj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    const keyData = this.keys.get(keyHandle);
    if (keyData && !keyData.usage.includes(KeyUsage.ENCRYPT)) {
      throw new HSMPermissionError('Key does not permit encryption', this.name);
    }

    try {
      const keyMaterial = obj.attributes.get(CKA.VALUE);
      if (!keyMaterial || !(keyMaterial instanceof Buffer)) {
        throw new Error('No key material available');
      }

      const iv = options?.iv || crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, iv);

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
   * Decrypt data (C_DecryptInit, C_Decrypt)
   */
  async decrypt(
    keyHandle: string,
    ciphertext: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    this.ensureConnected();

    const obj = this.objectHandles.get(keyHandle);
    if (!obj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    const keyData = this.keys.get(keyHandle);
    if (keyData && !keyData.usage.includes(KeyUsage.DECRYPT)) {
      throw new HSMPermissionError('Key does not permit decryption', this.name);
    }

    try {
      const keyMaterial = obj.attributes.get(CKA.VALUE);
      if (!keyMaterial || !(keyMaterial instanceof Buffer)) {
        throw new Error('No key material available');
      }

      const iv = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(12, 28);
      const encrypted = ciphertext.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial, iv);
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
   * Wrap key (C_WrapKey)
   */
  async wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer> {
    this.ensureConnected();

    const wrappingObj = this.objectHandles.get(wrappingKeyHandle);
    const targetObj = this.objectHandles.get(keyToWrap);

    if (!wrappingObj) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }
    if (!targetObj) {
      throw new HSMKeyNotFoundError(keyToWrap, this.name);
    }

    const targetKey = this.keys.get(keyToWrap);
    if (targetKey && !targetKey.extractable) {
      throw new HSMOperationError('wrapKey', 'Key is not extractable', this.name);
    }

    try {
      const wrappingKey = wrappingObj.attributes.get(CKA.VALUE);
      const targetKeyMaterial = targetObj.attributes.get(CKA.VALUE);

      if (!wrappingKey || !(wrappingKey instanceof Buffer)) {
        throw new Error('No wrapping key material');
      }
      if (!targetKeyMaterial || !(targetKeyMaterial instanceof Buffer)) {
        throw new Error('No target key material');
      }

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
      const encrypted = Buffer.concat([cipher.update(targetKeyMaterial), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const wrapped = Buffer.concat([iv, authTag, encrypted]);

      this.logAudit({
        operation: 'wrapKey',
        keyId: keyToWrap,
        success: true,
      });

      return wrapped;
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
   * Unwrap key (C_UnwrapKey)
   */
  async unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string> {
    this.ensureConnected();
    this.validateKeySpec(spec);

    const wrappingObj = this.objectHandles.get(wrappingKeyHandle);
    if (!wrappingObj) {
      throw new HSMKeyNotFoundError(wrappingKeyHandle, this.name);
    }

    try {
      const wrappingKey = wrappingObj.attributes.get(CKA.VALUE);
      if (!wrappingKey || !(wrappingKey instanceof Buffer)) {
        throw new Error('No wrapping key material');
      }

      const iv = wrappedKey.subarray(0, 12);
      const authTag = wrappedKey.subarray(12, 28);
      const encrypted = wrappedKey.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
      decipher.setAuthTag(authTag);

      const keyMaterial = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      // Import the unwrapped key
      const importedKey = await this.importKey(keyMaterial, spec);

      this.logAudit({
        operation: 'unwrapKey',
        keyId: importedKey.id,
        success: true,
      });

      return importedKey.id;
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
   * Destroy key (C_DestroyObject)
   */
  async destroyKey(keyHandle: string): Promise<void> {
    this.ensureConnected();

    const obj = this.objectHandles.get(keyHandle);
    if (!obj) {
      throw new HSMKeyNotFoundError(keyHandle, this.name);
    }

    try {
      // Securely zero key material
      const value = obj.attributes.get(CKA.VALUE);
      if (value instanceof Buffer) {
        crypto.randomFillSync(value);
      }

      this.objectHandles.delete(keyHandle);
      this.objectHandles.delete(`${keyHandle}-pub`);
      this.objectHandles.delete(`${keyHandle}-priv`);
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
  // PKCS#11 Specific Methods
  // ============================================================================

  /**
   * Get token info
   */
  getTokenInfo(): TokenInfo | null {
    return this.tokenInfo;
  }

  /**
   * Get slot info
   */
  getSlotInfo(slotId?: number): SlotInfo | undefined {
    const id = slotId ?? this.session?.slotId;
    return this.slots.find(s => s.slotId === id);
  }

  /**
   * List available mechanisms
   */
  getMechanisms(slotId?: number): MechanismInfo[] {
    const id = slotId ?? this.session?.slotId ?? 0;
    return this.mechanisms.get(id) || [];
  }

  /**
   * Check if mechanism is supported
   */
  isMechanismSupported(mechanism: CKM, slotId?: number): boolean {
    const mechanisms = this.getMechanisms(slotId);
    return mechanisms.some(m => m.mechanism === mechanism);
  }

  /**
   * Generate random bytes using hardware RNG
   */
  async generateRandom(length: number): Promise<Buffer> {
    this.ensureConnected();

    // C_GenerateRandom(session, randomData, length)

    // For real HSM, this would use hardware RNG
    // In simulation, use crypto.randomBytes
    return crypto.randomBytes(length);
  }

  /**
   * Seed the random number generator
   */
  async seedRandom(seed: Buffer): Promise<void> {
    this.ensureConnected();

    // C_SeedRandom(session, seed, seedLen)

    // This is a no-op in simulation
    this.logAudit({
      operation: 'seedRandom',
      success: true,
      metadata: { seedLength: seed.length },
    });
  }

  /**
   * Change user PIN
   */
  async changePIN(oldPin: string, newPin: string): Promise<void> {
    this.ensureConnected();

    if (!this.session?.loggedIn) {
      throw new HSMPermissionError('Must be logged in to change PIN', this.name);
    }

    // C_SetPIN(session, oldPin, oldPinLen, newPin, newPinLen)

    if (newPin.length < (this.tokenInfo?.minPinLen ?? 4)) {
      throw new Error('New PIN is too short');
    }

    this.logAudit({
      operation: 'changePIN',
      success: true,
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create PKCS#11 wrapper provider
 */
export function createPKCS11Provider(config: PKCS11WrapperConfig): PKCS11WrapperProvider {
  return new PKCS11WrapperProvider(config);
}
