/**
 * PKCS#11 Smart Card Provider
 *
 * Interface for PKCS#11 smart card communication.
 * Provides card reader management, certificate extraction,
 * and cryptographic operations.
 *
 * Features:
 * - Smart card reader enumeration
 * - Card presence monitoring
 * - Certificate extraction from PIV slots
 * - PIN verification
 * - Digital signature operations
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../common/logger.js';
import {
  type PKCS11Config,
  type CardEvent,
  type ParsedCertificate,
  CardEventType,
  PIVErrorCode,
} from './types.js';
import { parseCertificate } from './certificate-auth.js';

const logger = createLogger({ component: 'piv-pkcs11-provider' });

// =============================================================================
// Constants
// =============================================================================

/** PIV slot IDs */
export const PIV_SLOTS = {
  /** PIV Authentication (9A) */
  PIV_AUTHENTICATION: 0x9a,
  /** Card Authentication (9E) */
  CARD_AUTHENTICATION: 0x9e,
  /** Digital Signature (9C) */
  DIGITAL_SIGNATURE: 0x9c,
  /** Key Management (9D) */
  KEY_MANAGEMENT: 0x9d,
} as const;

/** PKCS#11 return values */
const CKR = {
  OK: 0x00000000,
  CANCEL: 0x00000001,
  SLOT_ID_INVALID: 0x00000003,
  TOKEN_NOT_PRESENT: 0x000000e0,
  TOKEN_NOT_RECOGNIZED: 0x000000e1,
  PIN_INCORRECT: 0x000000a0,
  PIN_LOCKED: 0x000000a4,
  USER_NOT_LOGGED_IN: 0x00000101,
} as const;

/** Default PKCS#11 configuration */
const DEFAULT_PKCS11_CONFIG: PKCS11Config = {
  libraryPath: '/usr/lib/opensc-pkcs11.so', // OpenSC default
  initializeToken: false,
  pollingInterval: 1000,
};

// =============================================================================
// Types
// =============================================================================

/**
 * Smart card reader information
 */
export interface ReaderInfo {
  /** Slot ID */
  slotId: number;
  /** Reader name/description */
  name: string;
  /** Whether card is present */
  cardPresent: boolean;
  /** Token label */
  tokenLabel?: string;
  /** Manufacturer */
  manufacturer?: string;
  /** Card ATR (Answer To Reset) */
  atr?: string;
}

/**
 * Token information
 */
export interface TokenInfo {
  /** Token label */
  label: string;
  /** Manufacturer */
  manufacturer: string;
  /** Model */
  model: string;
  /** Serial number */
  serialNumber: string;
  /** Total public memory */
  totalPublicMemory: number;
  /** Free public memory */
  freePublicMemory: number;
  /** Total private memory */
  totalPrivateMemory: number;
  /** Free private memory */
  freePrivateMemory: number;
  /** Whether token is initialized */
  initialized: boolean;
  /** Whether PIN is required */
  pinRequired: boolean;
}

/**
 * Certificate from smart card
 */
export interface SmartCardCertificate {
  /** PIV slot */
  slot: number;
  /** Slot name */
  slotName: string;
  /** Certificate label */
  label: string;
  /** Certificate ID */
  id: Buffer;
  /** Parsed certificate */
  certificate: ParsedCertificate;
}

/**
 * Sign request
 */
export interface SignRequest {
  /** Slot ID to use for signing */
  slotId: number;
  /** Key ID to use */
  keyId: Buffer;
  /** Data to sign */
  data: Buffer;
  /** Signature mechanism */
  mechanism: 'rsa-pkcs' | 'rsa-pss' | 'ecdsa';
  /** PIN for key access */
  pin?: string;
}

/**
 * PKCS#11 provider events
 */
export interface PKCS11ProviderEvents {
  initialized: () => void;
  error: (error: Error) => void;
  cardInserted: (event: CardEvent) => void;
  cardRemoved: (event: CardEvent) => void;
  readerConnected: (reader: ReaderInfo) => void;
  readerDisconnected: (slotId: number) => void;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * PKCS#11 error
 */
export class PKCS11Error extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode = PIVErrorCode.PKCS11_ERROR,
    public readonly pkcs11Code?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PKCS11Error';
  }
}

/**
 * Library not found error
 */
export class LibraryNotFoundError extends PKCS11Error {
  constructor(libraryPath: string) {
    super(
      `PKCS#11 library not found: ${libraryPath}`,
      PIVErrorCode.PKCS11_ERROR,
      undefined,
      { libraryPath }
    );
    this.name = 'LibraryNotFoundError';
  }
}

/**
 * PIN error
 */
export class PINError extends PKCS11Error {
  constructor(message: string, code: PIVErrorCode) {
    super(message, code);
    this.name = 'PINError';
  }
}

/**
 * Card not present error
 */
export class CardNotPresentError extends PKCS11Error {
  constructor(slotId: number) {
    super('Card not present in reader', PIVErrorCode.CARD_REMOVED, undefined, { slotId });
    this.name = 'CardNotPresentError';
  }
}

// =============================================================================
// PKCS#11 Provider
// =============================================================================

/**
 * PKCS#11 smart card provider
 *
 * NOTE: This is an interface/abstraction layer. The actual PKCS#11
 * implementation requires native bindings (e.g., node-pkcs11 or graphene-pk11).
 * This code provides the API contract and mock implementation for testing.
 */
export class PKCS11Provider extends EventEmitter {
  private config: PKCS11Config;
  private initialized: boolean = false;
  private readers: Map<number, ReaderInfo> = new Map();
  private pollingTimer?: NodeJS.Timeout;

  // PKCS#11 module instance (would be from native binding)
  private pkcs11?: unknown;

  constructor(config: Partial<PKCS11Config> = {}) {
    super();
    this.config = { ...DEFAULT_PKCS11_CONFIG, ...config };
  }

  /**
   * Initialize PKCS#11 library
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info({ libraryPath: this.config.libraryPath }, 'Initializing PKCS#11 library');

      // In a real implementation, this would load the native PKCS#11 library
      // using a package like 'graphene-pk11' or 'pkcs11js'
      //
      // Example with graphene-pk11:
      // const graphene = require('graphene-pk11');
      // const Module = graphene.Module;
      // const mod = Module.load(this.config.libraryPath);
      // mod.initialize();
      // this.pkcs11 = mod;

      // For now, simulate initialization
      await this.simulateInitialization();

      this.initialized = true;

      // Start polling for card changes
      this.startPolling();

      logger.info('PKCS#11 library initialized');
      this.emit('initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize PKCS#11 library');
      throw new LibraryNotFoundError(this.config.libraryPath);
    }
  }

  /**
   * Simulate PKCS#11 initialization for testing/development
   */
  private async simulateInitialization(): Promise<void> {
    // Simulate finding a reader
    const mockReader: ReaderInfo = {
      slotId: 0,
      name: 'Simulated Smart Card Reader',
      cardPresent: false,
      manufacturer: 'Vorion',
    };

    this.readers.set(0, mockReader);
  }

  /**
   * Finalize and cleanup
   */
  async finalize(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.stopPolling();

    // In a real implementation:
    // this.pkcs11?.finalize();

    this.readers.clear();
    this.initialized = false;

    logger.info('PKCS#11 library finalized');
  }

  /**
   * Get available readers
   */
  getReaders(): ReaderInfo[] {
    this.ensureInitialized();
    return Array.from(this.readers.values());
  }

  /**
   * Get reader by slot ID
   */
  getReader(slotId: number): ReaderInfo | undefined {
    this.ensureInitialized();
    return this.readers.get(slotId);
  }

  /**
   * Check if card is present in reader
   */
  isCardPresent(slotId: number): boolean {
    const reader = this.readers.get(slotId);
    return reader?.cardPresent ?? false;
  }

  /**
   * Get token info from card
   */
  async getTokenInfo(slotId: number): Promise<TokenInfo> {
    this.ensureInitialized();
    this.ensureCardPresent(slotId);

    // In a real implementation:
    // const slot = this.pkcs11.getSlots()[slotId];
    // const token = slot.getToken();
    // return {
    //   label: token.label,
    //   manufacturer: token.manufacturerID,
    //   ...
    // };

    // Mock implementation
    return {
      label: 'PIV Card',
      manufacturer: 'US Government',
      model: 'PIV-II',
      serialNumber: '00000000',
      totalPublicMemory: 0,
      freePublicMemory: 0,
      totalPrivateMemory: 0,
      freePrivateMemory: 0,
      initialized: true,
      pinRequired: true,
    };
  }

  /**
   * Get certificates from card
   */
  async getCertificates(slotId: number, pin?: string): Promise<SmartCardCertificate[]> {
    this.ensureInitialized();
    this.ensureCardPresent(slotId);

    const certificates: SmartCardCertificate[] = [];

    // In a real implementation:
    // 1. Open session
    // 2. Login with PIN if required
    // 3. Find certificate objects
    // 4. Extract certificate data
    // 5. Close session

    // Example with graphene-pk11:
    // const slot = this.pkcs11.getSlots()[slotId];
    // const session = slot.open(graphene.SessionFlag.RW_SESSION);
    // if (pin) session.login(pin, graphene.UserType.USER);
    //
    // const certs = session.find({ class: graphene.ObjectClass.CERTIFICATE });
    // for (const cert of certs) {
    //   const value = cert.getAttribute(graphene.CKA_VALUE);
    //   // Parse certificate
    // }
    // session.close();

    // Mock implementation - return empty array
    // Real implementation would extract PIV certificates from card

    logger.debug({ slotId, pin: pin ? '[REDACTED]' : undefined }, 'Getting certificates from card');

    return certificates;
  }

  /**
   * Get authentication certificate (slot 9A)
   */
  async getAuthenticationCertificate(
    slotId: number,
    pin?: string
  ): Promise<SmartCardCertificate | undefined> {
    const certs = await this.getCertificates(slotId, pin);
    return certs.find((c) => c.slot === PIV_SLOTS.PIV_AUTHENTICATION);
  }

  /**
   * Verify PIN
   */
  async verifyPIN(slotId: number, pin: string): Promise<boolean> {
    this.ensureInitialized();
    this.ensureCardPresent(slotId);

    // In a real implementation:
    // const slot = this.pkcs11.getSlots()[slotId];
    // const session = slot.open();
    // try {
    //   session.login(pin, UserType.USER);
    //   return true;
    // } catch (error) {
    //   if (error.code === CKR.PIN_INCORRECT) return false;
    //   if (error.code === CKR.PIN_LOCKED) throw new PINError(...);
    //   throw error;
    // } finally {
    //   session.close();
    // }

    logger.debug({ slotId }, 'Verifying PIN');

    // Mock implementation
    return pin.length >= 4;
  }

  /**
   * Sign data using card's private key
   */
  async sign(request: SignRequest): Promise<Buffer> {
    this.ensureInitialized();
    this.ensureCardPresent(request.slotId);

    // In a real implementation:
    // 1. Open session
    // 2. Login with PIN
    // 3. Find private key by ID
    // 4. Set mechanism
    // 5. Sign data
    // 6. Return signature
    // 7. Close session

    logger.debug(
      {
        slotId: request.slotId,
        mechanism: request.mechanism,
        dataLength: request.data.length,
      },
      'Signing data with smart card'
    );

    // Mock implementation - return empty signature
    throw new PKCS11Error(
      'Sign operation requires PKCS#11 native bindings',
      PIVErrorCode.PKCS11_ERROR
    );
  }

  /**
   * Challenge-response authentication
   */
  async challengeResponse(
    slotId: number,
    challenge: Buffer,
    pin?: string
  ): Promise<Buffer> {
    this.ensureInitialized();
    this.ensureCardPresent(slotId);

    // Get authentication certificate
    const cert = await this.getAuthenticationCertificate(slotId, pin);
    if (!cert) {
      throw new PKCS11Error(
        'No authentication certificate found on card',
        PIVErrorCode.PKCS11_ERROR
      );
    }

    // Sign challenge
    return this.sign({
      slotId,
      keyId: cert.id,
      data: challenge,
      mechanism: 'rsa-pkcs',
      pin,
    });
  }

  /**
   * Get card ATR (Answer To Reset)
   */
  async getATR(slotId: number): Promise<string | undefined> {
    this.ensureInitialized();
    this.ensureCardPresent(slotId);

    // In a real implementation:
    // const slot = this.pkcs11.getSlots()[slotId];
    // return slot.getATR().toString('hex');

    const reader = this.readers.get(slotId);
    return reader?.atr;
  }

  /**
   * Start polling for card changes
   */
  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    this.pollingTimer = setInterval(async () => {
      try {
        await this.pollReaders();
      } catch (error) {
        logger.error({ error }, 'Error polling readers');
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    }, this.config.pollingInterval);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  /**
   * Poll readers for changes
   */
  private async pollReaders(): Promise<void> {
    // In a real implementation, check each slot for card presence changes
    // and emit appropriate events

    for (const [slotId, reader] of this.readers) {
      // Check if card state changed
      // const newState = this.pkcs11.getSlotInfo(slotId);
      // if (newState.flags.tokenPresent !== reader.cardPresent) {
      //   ...
      // }
    }
  }

  /**
   * Simulate card insertion (for testing)
   */
  simulateCardInsert(slotId: number, atr?: string): void {
    const reader = this.readers.get(slotId);
    if (!reader) return;

    reader.cardPresent = true;
    reader.atr = atr || '3B8F8001804F0CA0000003060300030000000068';

    const event: CardEvent = {
      type: CardEventType.CARD_INSERTED,
      readerName: reader.name,
      timestamp: new Date(),
      atr: reader.atr,
    };

    logger.info({ slotId, readerName: reader.name, atr: reader.atr }, 'Card inserted');
    this.emit('cardInserted', event);
  }

  /**
   * Simulate card removal (for testing)
   */
  simulateCardRemove(slotId: number): void {
    const reader = this.readers.get(slotId);
    if (!reader) return;

    const atr = reader.atr;
    reader.cardPresent = false;
    reader.atr = undefined;

    const event: CardEvent = {
      type: CardEventType.CARD_REMOVED,
      readerName: reader.name,
      timestamp: new Date(),
      atr,
    };

    logger.info({ slotId, readerName: reader.name }, 'Card removed');
    this.emit('cardRemoved', event);
  }

  /**
   * Ensure library is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new PKCS11Error('PKCS#11 library not initialized', PIVErrorCode.PKCS11_ERROR);
    }
  }

  /**
   * Ensure card is present
   */
  private ensureCardPresent(slotId: number): void {
    if (!this.isCardPresent(slotId)) {
      throw new CardNotPresentError(slotId);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): PKCS11Config {
    return { ...this.config };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultProvider: PKCS11Provider | null = null;

/**
 * Get the default PKCS#11 provider
 */
export function getPKCS11Provider(config?: Partial<PKCS11Config>): PKCS11Provider {
  if (!defaultProvider || config) {
    defaultProvider = new PKCS11Provider(config);
  }
  return defaultProvider;
}

/**
 * Create a new PKCS#11 provider
 */
export function createPKCS11Provider(config: Partial<PKCS11Config> = {}): PKCS11Provider {
  return new PKCS11Provider(config);
}

/**
 * Reset the default provider (for testing)
 */
export async function resetPKCS11Provider(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.finalize();
    defaultProvider = null;
  }
}

// =============================================================================
// Platform-specific library paths
// =============================================================================

/**
 * Common PKCS#11 library paths by platform
 */
export const PKCS11_LIBRARY_PATHS = {
  /** OpenSC on Linux */
  openscLinux: '/usr/lib/opensc-pkcs11.so',
  /** OpenSC on macOS */
  openscMac: '/usr/local/lib/opensc-pkcs11.so',
  /** OpenSC on macOS (Homebrew) */
  openscMacBrew: '/opt/homebrew/lib/opensc-pkcs11.so',
  /** OpenSC on Windows */
  openscWindows: 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll',
  /** CoolKey on Linux */
  coolkey: '/usr/lib64/pkcs11/libcoolkeypk11.so',
  /** YubiKey */
  yubikey: '/usr/lib/x86_64-linux-gnu/libykcs11.so',
  /** SafeNet on Windows */
  safenet: 'C:\\Program Files\\SafeNet\\Authentication\\SAC\\x64\\sac10x.dll',
  /** Gemalto on Windows */
  gemalto: 'C:\\Windows\\System32\\gclib.dll',
} as const;

/**
 * Detect available PKCS#11 library
 */
export async function detectPKCS11Library(): Promise<string | undefined> {
  const { existsSync } = await import('fs');

  const platform = process.platform;

  let paths: string[];

  switch (platform) {
    case 'linux':
      paths = [
        PKCS11_LIBRARY_PATHS.openscLinux,
        PKCS11_LIBRARY_PATHS.coolkey,
        PKCS11_LIBRARY_PATHS.yubikey,
      ];
      break;

    case 'darwin':
      paths = [
        PKCS11_LIBRARY_PATHS.openscMacBrew,
        PKCS11_LIBRARY_PATHS.openscMac,
      ];
      break;

    case 'win32':
      paths = [
        PKCS11_LIBRARY_PATHS.openscWindows,
        PKCS11_LIBRARY_PATHS.safenet,
        PKCS11_LIBRARY_PATHS.gemalto,
      ];
      break;

    default:
      paths = [];
  }

  for (const path of paths) {
    if (existsSync(path)) {
      logger.info({ libraryPath: path }, 'Detected PKCS#11 library');
      return path;
    }
  }

  return undefined;
}
