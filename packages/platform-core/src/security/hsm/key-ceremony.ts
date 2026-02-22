/**
 * Key Ceremony Support
 * Implements multi-party key generation, custodian management,
 * and ceremony audit trail for enterprise key management
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
  AuditLogEntry,
} from './provider.js';

// ============================================================================
// Key Ceremony Types
// ============================================================================

/**
 * Ceremony types
 */
export enum CeremonyType {
  /** Generate a new master key */
  MASTER_KEY_GENERATION = 'MASTER_KEY_GENERATION',
  /** Rotate an existing key */
  KEY_ROTATION = 'KEY_ROTATION',
  /** Recover a key from shares */
  KEY_RECOVERY = 'KEY_RECOVERY',
  /** Destroy a key */
  KEY_DESTRUCTION = 'KEY_DESTRUCTION',
  /** Transfer key between HSMs */
  KEY_TRANSFER = 'KEY_TRANSFER',
}

/**
 * Ceremony status
 */
export enum CeremonyStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_SHARES = 'AWAITING_SHARES',
  SHARES_COLLECTED = 'SHARES_COLLECTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Key custodian
 */
export interface KeyCustodian {
  id: string;
  name: string;
  email: string;
  role: CustodianRole;
  publicKey?: Buffer;
  shareIndex?: number;
  hasSubmittedShare?: boolean;
  submittedAt?: Date;
}

/**
 * Custodian roles
 */
export enum CustodianRole {
  ADMINISTRATOR = 'ADMINISTRATOR',
  KEY_HOLDER = 'KEY_HOLDER',
  WITNESS = 'WITNESS',
  AUDITOR = 'AUDITOR',
}

/**
 * Key share (encrypted)
 */
export interface KeyShare {
  index: number;
  custodianId: string;
  encryptedShare: Buffer;
  checksum: string;
  createdAt: Date;
}

/**
 * Ceremony configuration
 */
export interface CeremonyConfig {
  /** Ceremony type */
  type: CeremonyType;
  /** Key specification for generation */
  keySpec?: KeySpec;
  /** Key ID for rotation/destruction */
  existingKeyId?: string;
  /** Total number of shares (n in n-of-m) */
  totalShares: number;
  /** Required shares for reconstruction (m in n-of-m) */
  requiredShares: number;
  /** Custodians participating in ceremony */
  custodians: KeyCustodian[];
  /** Require all witnesses present */
  requireWitnesses?: boolean;
  /** Require dual control (two people) */
  requireDualControl?: boolean;
  /** Maximum ceremony duration in minutes */
  maxDurationMinutes?: number;
  /** Notes/description */
  description?: string;
}

/**
 * Ceremony instance
 */
export interface Ceremony {
  id: string;
  config: CeremonyConfig;
  status: CeremonyStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  keyHandle?: string;
  shares: KeyShare[];
  auditTrail: CeremonyAuditEntry[];
  presentCustodians: string[];
  error?: string;
}

/**
 * Ceremony audit entry
 */
export interface CeremonyAuditEntry {
  timestamp: Date;
  action: CeremonyAction;
  custodianId?: string;
  metadata?: Record<string, unknown>;
  signature?: Buffer;
}

/**
 * Ceremony actions for audit
 */
export enum CeremonyAction {
  CEREMONY_CREATED = 'CEREMONY_CREATED',
  CEREMONY_STARTED = 'CEREMONY_STARTED',
  CUSTODIAN_PRESENT = 'CUSTODIAN_PRESENT',
  SHARE_GENERATED = 'SHARE_GENERATED',
  SHARE_DISTRIBUTED = 'SHARE_DISTRIBUTED',
  SHARE_SUBMITTED = 'SHARE_SUBMITTED',
  SHARE_VERIFIED = 'SHARE_VERIFIED',
  KEY_GENERATED = 'KEY_GENERATED',
  KEY_RECOVERED = 'KEY_RECOVERED',
  KEY_DESTROYED = 'KEY_DESTROYED',
  CEREMONY_COMPLETED = 'CEREMONY_COMPLETED',
  CEREMONY_FAILED = 'CEREMONY_FAILED',
  CEREMONY_CANCELLED = 'CEREMONY_CANCELLED',
}

// ============================================================================
// Shamir's Secret Sharing Implementation
// ============================================================================

/**
 * Shamir's Secret Sharing for key splitting
 */
class ShamirSecretSharing {
  private prime: bigint;

  constructor() {
    // Use a large prime for the finite field
    // This is a 256-bit prime
    this.prime = BigInt(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
    );
  }

  /**
   * Split a secret into shares
   */
  split(secret: Buffer, totalShares: number, requiredShares: number): Buffer[] {
    if (requiredShares > totalShares) {
      throw new Error('Required shares cannot exceed total shares');
    }

    if (requiredShares < 2) {
      throw new Error('At least 2 shares are required for security');
    }

    // Convert secret to bigint
    const secretInt = BigInt('0x' + secret.toString('hex'));

    // Generate random coefficients for polynomial
    const coefficients: bigint[] = [secretInt];
    for (let i = 1; i < requiredShares; i++) {
      const coef = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % this.prime;
      coefficients.push(coef);
    }

    // Generate shares by evaluating polynomial at different points
    const shares: Buffer[] = [];
    for (let x = 1; x <= totalShares; x++) {
      const y = this.evaluatePolynomial(coefficients, BigInt(x));
      // Share format: [1 byte x][32 bytes y]
      const share = Buffer.alloc(33);
      share[0] = x;
      const yHex = y.toString(16).padStart(64, '0');
      Buffer.from(yHex, 'hex').copy(share, 1);
      shares.push(share);
    }

    return shares;
  }

  /**
   * Reconstruct secret from shares
   */
  reconstruct(shares: Buffer[]): Buffer {
    if (shares.length < 2) {
      throw new Error('At least 2 shares required for reconstruction');
    }

    // Parse shares
    const points: Array<{ x: bigint; y: bigint }> = shares.map(share => ({
      x: BigInt(share[0]),
      y: BigInt('0x' + share.subarray(1).toString('hex')),
    }));

    // Lagrange interpolation to find secret (f(0))
    let secret = BigInt(0);

    for (let i = 0; i < points.length; i++) {
      let numerator = BigInt(1);
      let denominator = BigInt(1);

      for (let j = 0; j < points.length; j++) {
        if (i !== j) {
          numerator = (numerator * (BigInt(0) - points[j].x)) % this.prime;
          denominator = (denominator * (points[i].x - points[j].x)) % this.prime;
        }
      }

      // Modular inverse of denominator
      const inv = this.modInverse(denominator, this.prime);
      const lagrange = (numerator * inv) % this.prime;
      secret = (secret + points[i].y * lagrange) % this.prime;
    }

    // Ensure positive result
    secret = ((secret % this.prime) + this.prime) % this.prime;

    // Convert back to buffer
    const secretHex = secret.toString(16).padStart(64, '0');
    return Buffer.from(secretHex, 'hex');
  }

  /**
   * Evaluate polynomial at point x
   */
  private evaluatePolynomial(coefficients: bigint[], x: bigint): bigint {
    let result = BigInt(0);
    let power = BigInt(1);

    for (const coef of coefficients) {
      result = (result + coef * power) % this.prime;
      power = (power * x) % this.prime;
    }

    return ((result % this.prime) + this.prime) % this.prime;
  }

  /**
   * Modular multiplicative inverse using extended Euclidean algorithm
   */
  private modInverse(a: bigint, m: bigint): bigint {
    let [oldR, r] = [a, m];
    let [oldS, s] = [BigInt(1), BigInt(0)];

    while (r !== BigInt(0)) {
      const quotient = oldR / r;
      [oldR, r] = [r, oldR - quotient * r];
      [oldS, s] = [s, oldS - quotient * s];
    }

    return ((oldS % m) + m) % m;
  }
}

// ============================================================================
// Key Ceremony Manager
// ============================================================================

export class KeyCeremonyManager extends EventEmitter {
  private hsm: IHSMProvider;
  private ceremonies: Map<string, Ceremony> = new Map();
  private shamir: ShamirSecretSharing;
  private auditCallback?: (entry: CeremonyAuditEntry) => void;

  constructor(hsm: IHSMProvider, auditCallback?: (entry: CeremonyAuditEntry) => void) {
    super();
    this.hsm = hsm;
    this.shamir = new ShamirSecretSharing();
    this.auditCallback = auditCallback;
  }

  /**
   * Create a new ceremony
   */
  async createCeremony(config: CeremonyConfig): Promise<Ceremony> {
    // Validate configuration
    this.validateCeremonyConfig(config);

    const ceremony: Ceremony = {
      id: this.generateCeremonyId(),
      config,
      status: CeremonyStatus.PENDING,
      createdAt: new Date(),
      shares: [],
      auditTrail: [],
      presentCustodians: [],
    };

    this.ceremonies.set(ceremony.id, ceremony);

    await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_CREATED, undefined, {
      type: config.type,
      totalShares: config.totalShares,
      requiredShares: config.requiredShares,
    });

    this.emit('ceremonyCreated', ceremony);

    return ceremony;
  }

  /**
   * Validate ceremony configuration
   */
  private validateCeremonyConfig(config: CeremonyConfig): void {
    if (config.totalShares < 2) {
      throw new Error('Total shares must be at least 2');
    }

    if (config.requiredShares < 2) {
      throw new Error('Required shares must be at least 2');
    }

    if (config.requiredShares > config.totalShares) {
      throw new Error('Required shares cannot exceed total shares');
    }

    const keyHolders = config.custodians.filter(
      c => c.role === CustodianRole.KEY_HOLDER
    );

    if (keyHolders.length < config.totalShares) {
      throw new Error('Not enough key holders for the specified share count');
    }

    if (config.requireDualControl && keyHolders.length < 2) {
      throw new Error('Dual control requires at least 2 key holders');
    }

    if (config.requireWitnesses) {
      const witnesses = config.custodians.filter(
        c => c.role === CustodianRole.WITNESS
      );
      if (witnesses.length === 0) {
        throw new Error('At least one witness is required');
      }
    }
  }

  /**
   * Generate unique ceremony ID
   */
  private generateCeremonyId(): string {
    return `ceremony-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Start a ceremony
   */
  async startCeremony(ceremonyId: string): Promise<void> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (ceremony.status !== CeremonyStatus.PENDING) {
      throw new Error(`Ceremony cannot be started from status: ${ceremony.status}`);
    }

    // Check if required custodians are present
    if (ceremony.config.requireWitnesses) {
      const witnesses = ceremony.config.custodians.filter(
        c => c.role === CustodianRole.WITNESS
      );
      const presentWitnesses = witnesses.filter(w =>
        ceremony.presentCustodians.includes(w.id)
      );

      if (presentWitnesses.length !== witnesses.length) {
        throw new Error('All witnesses must be present to start the ceremony');
      }
    }

    if (ceremony.config.requireDualControl) {
      if (ceremony.presentCustodians.length < 2) {
        throw new Error('Dual control requires at least 2 custodians present');
      }
    }

    ceremony.status = CeremonyStatus.IN_PROGRESS;
    ceremony.startedAt = new Date();

    await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_STARTED);

    this.emit('ceremonyStarted', ceremony);
  }

  /**
   * Mark custodian as present
   */
  async markCustodianPresent(
    ceremonyId: string,
    custodianId: string,
    verificationData?: Buffer
  ): Promise<void> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    const custodian = ceremony.config.custodians.find(c => c.id === custodianId);
    if (!custodian) {
      throw new Error(`Custodian not found: ${custodianId}`);
    }

    // Verify custodian identity if public key is available
    if (custodian.publicKey && verificationData) {
      // In real implementation, verify signature with custodian's public key
    }

    if (!ceremony.presentCustodians.includes(custodianId)) {
      ceremony.presentCustodians.push(custodianId);
    }

    await this.addAuditEntry(ceremony, CeremonyAction.CUSTODIAN_PRESENT, custodianId);

    this.emit('custodianPresent', { ceremony, custodian });
  }

  /**
   * Execute master key generation ceremony
   */
  async executeMasterKeyGeneration(ceremonyId: string): Promise<KeyHandle> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (ceremony.status !== CeremonyStatus.IN_PROGRESS) {
      throw new Error('Ceremony must be started before execution');
    }

    if (ceremony.config.type !== CeremonyType.MASTER_KEY_GENERATION) {
      throw new Error('Invalid ceremony type for key generation');
    }

    if (!ceremony.config.keySpec) {
      throw new Error('Key specification required for key generation');
    }

    try {
      // Generate master key in HSM
      const keyHandle = await this.hsm.generateKey(ceremony.config.keySpec);

      await this.addAuditEntry(ceremony, CeremonyAction.KEY_GENERATED, undefined, {
        keyId: keyHandle.id,
        keyType: keyHandle.type,
      });

      // Generate split key for backup/recovery
      // This creates a separate "key encryption key" that is split among custodians
      const kekSpec: KeySpec = {
        label: `KEK-${keyHandle.id}`,
        type: KeyType.AES,
        size: 256,
        usage: [KeyUsage.WRAP, KeyUsage.UNWRAP],
        extractable: true, // Extractable for splitting
      };

      const kek = await this.hsm.generateKey(kekSpec);

      // Export KEK for splitting (only possible because it's extractable)
      // In real implementation, we'd use a more secure method
      const kekMaterial = crypto.randomBytes(32); // Simulated

      // Split the KEK among custodians
      const shares = this.shamir.split(
        kekMaterial,
        ceremony.config.totalShares,
        ceremony.config.requiredShares
      );

      // Distribute shares to custodians
      const keyHolders = ceremony.config.custodians.filter(
        c => c.role === CustodianRole.KEY_HOLDER
      );

      for (let i = 0; i < shares.length; i++) {
        const custodian = keyHolders[i];
        const share = shares[i];

        // Encrypt share with custodian's public key if available
        let encryptedShare: Buffer;
        if (custodian.publicKey) {
          const publicKey = crypto.createPublicKey({
            key: custodian.publicKey,
            format: 'der',
            type: 'spki',
          });
          encryptedShare = crypto.publicEncrypt(publicKey, share);
        } else {
          // For demo, just use the raw share (NOT SECURE)
          encryptedShare = share;
        }

        const keyShare: KeyShare = {
          index: i + 1,
          custodianId: custodian.id,
          encryptedShare,
          checksum: crypto.createHash('sha256').update(share).digest('hex'),
          createdAt: new Date(),
        };

        ceremony.shares.push(keyShare);
        custodian.shareIndex = i + 1;

        await this.addAuditEntry(
          ceremony,
          CeremonyAction.SHARE_DISTRIBUTED,
          custodian.id,
          { shareIndex: i + 1 }
        );
      }

      // Destroy the extractable KEK after splitting
      await this.hsm.destroyKey(kek.id);

      ceremony.keyHandle = keyHandle.id;
      ceremony.status = CeremonyStatus.COMPLETED;
      ceremony.completedAt = new Date();

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_COMPLETED, undefined, {
        keyId: keyHandle.id,
        sharesDistributed: ceremony.shares.length,
      });

      this.emit('ceremonyCompleted', ceremony);

      return keyHandle;
    } catch (error) {
      ceremony.status = CeremonyStatus.FAILED;
      ceremony.error = error instanceof Error ? error.message : String(error);

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_FAILED, undefined, {
        error: ceremony.error,
      });

      this.emit('ceremonyFailed', { ceremony, error });
      throw error;
    }
  }

  /**
   * Submit a share for key recovery
   */
  async submitShare(
    ceremonyId: string,
    custodianId: string,
    encryptedShare: Buffer
  ): Promise<void> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (
      ceremony.status !== CeremonyStatus.IN_PROGRESS &&
      ceremony.status !== CeremonyStatus.AWAITING_SHARES
    ) {
      throw new Error('Ceremony not accepting shares');
    }

    const custodian = ceremony.config.custodians.find(c => c.id === custodianId);
    if (!custodian) {
      throw new Error(`Custodian not found: ${custodianId}`);
    }

    if (custodian.hasSubmittedShare) {
      throw new Error('Custodian has already submitted a share');
    }

    // Store the submitted share
    const share: KeyShare = {
      index: custodian.shareIndex || ceremony.shares.length + 1,
      custodianId,
      encryptedShare,
      checksum: crypto.createHash('sha256').update(encryptedShare).digest('hex'),
      createdAt: new Date(),
    };

    ceremony.shares.push(share);
    custodian.hasSubmittedShare = true;
    custodian.submittedAt = new Date();

    await this.addAuditEntry(ceremony, CeremonyAction.SHARE_SUBMITTED, custodianId, {
      shareIndex: share.index,
    });

    // Check if we have enough shares
    const submittedCount = ceremony.config.custodians.filter(
      c => c.hasSubmittedShare
    ).length;

    if (submittedCount >= ceremony.config.requiredShares) {
      ceremony.status = CeremonyStatus.SHARES_COLLECTED;
      this.emit('sharesCollected', ceremony);
    } else {
      ceremony.status = CeremonyStatus.AWAITING_SHARES;
    }

    this.emit('shareSubmitted', { ceremony, custodian });
  }

  /**
   * Execute key recovery ceremony
   */
  async executeKeyRecovery(ceremonyId: string): Promise<Buffer> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (ceremony.status !== CeremonyStatus.SHARES_COLLECTED) {
      throw new Error('Not enough shares collected for recovery');
    }

    if (ceremony.config.type !== CeremonyType.KEY_RECOVERY) {
      throw new Error('Invalid ceremony type for key recovery');
    }

    try {
      // Decrypt shares (using custodian private keys in real implementation)
      const decryptedShares: Buffer[] = ceremony.shares
        .slice(0, ceremony.config.requiredShares)
        .map(share => share.encryptedShare);

      // Reconstruct the secret
      const recoveredKey = this.shamir.reconstruct(decryptedShares);

      await this.addAuditEntry(ceremony, CeremonyAction.KEY_RECOVERED);

      ceremony.status = CeremonyStatus.COMPLETED;
      ceremony.completedAt = new Date();

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_COMPLETED);

      this.emit('ceremonyCompleted', ceremony);

      return recoveredKey;
    } catch (error) {
      ceremony.status = CeremonyStatus.FAILED;
      ceremony.error = error instanceof Error ? error.message : String(error);

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_FAILED, undefined, {
        error: ceremony.error,
      });

      this.emit('ceremonyFailed', { ceremony, error });
      throw error;
    }
  }

  /**
   * Execute key destruction ceremony
   */
  async executeKeyDestruction(ceremonyId: string): Promise<void> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (ceremony.status !== CeremonyStatus.IN_PROGRESS) {
      throw new Error('Ceremony must be in progress');
    }

    if (ceremony.config.type !== CeremonyType.KEY_DESTRUCTION) {
      throw new Error('Invalid ceremony type for key destruction');
    }

    if (!ceremony.config.existingKeyId) {
      throw new Error('Key ID required for destruction');
    }

    // Verify dual control if required
    if (ceremony.config.requireDualControl) {
      const keyHolders = ceremony.presentCustodians.filter(id => {
        const custodian = ceremony.config.custodians.find(c => c.id === id);
        return custodian?.role === CustodianRole.KEY_HOLDER;
      });

      if (keyHolders.length < 2) {
        throw new Error('Dual control requires 2 key holders present for destruction');
      }
    }

    try {
      // Destroy the key
      await this.hsm.destroyKey(ceremony.config.existingKeyId);

      await this.addAuditEntry(ceremony, CeremonyAction.KEY_DESTROYED, undefined, {
        keyId: ceremony.config.existingKeyId,
      });

      ceremony.status = CeremonyStatus.COMPLETED;
      ceremony.completedAt = new Date();

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_COMPLETED);

      this.emit('ceremonyCompleted', ceremony);
    } catch (error) {
      ceremony.status = CeremonyStatus.FAILED;
      ceremony.error = error instanceof Error ? error.message : String(error);

      await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_FAILED, undefined, {
        error: ceremony.error,
      });

      this.emit('ceremonyFailed', { ceremony, error });
      throw error;
    }
  }

  /**
   * Cancel a ceremony
   */
  async cancelCeremony(ceremonyId: string, reason?: string): Promise<void> {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    if (
      ceremony.status === CeremonyStatus.COMPLETED ||
      ceremony.status === CeremonyStatus.CANCELLED
    ) {
      throw new Error(`Ceremony cannot be cancelled from status: ${ceremony.status}`);
    }

    ceremony.status = CeremonyStatus.CANCELLED;
    ceremony.completedAt = new Date();
    ceremony.error = reason;

    await this.addAuditEntry(ceremony, CeremonyAction.CEREMONY_CANCELLED, undefined, {
      reason,
    });

    this.emit('ceremonyCancelled', ceremony);
  }

  /**
   * Get ceremony by ID
   */
  getCeremony(ceremonyId: string): Ceremony | undefined {
    return this.ceremonies.get(ceremonyId);
  }

  /**
   * Get ceremony or throw
   */
  private getCeremonyOrThrow(ceremonyId: string): Ceremony {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      throw new Error(`Ceremony not found: ${ceremonyId}`);
    }
    return ceremony;
  }

  /**
   * List all ceremonies
   */
  listCeremonies(filter?: { status?: CeremonyStatus; type?: CeremonyType }): Ceremony[] {
    let ceremonies = Array.from(this.ceremonies.values());

    if (filter?.status) {
      ceremonies = ceremonies.filter(c => c.status === filter.status);
    }

    if (filter?.type) {
      ceremonies = ceremonies.filter(c => c.config.type === filter.type);
    }

    return ceremonies;
  }

  /**
   * Get ceremony audit trail
   */
  getCeremonyAuditTrail(ceremonyId: string): CeremonyAuditEntry[] {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);
    return [...ceremony.auditTrail];
  }

  /**
   * Add audit entry
   */
  private async addAuditEntry(
    ceremony: Ceremony,
    action: CeremonyAction,
    custodianId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: CeremonyAuditEntry = {
      timestamp: new Date(),
      action,
      custodianId,
      metadata: {
        ...metadata,
        ceremonyId: ceremony.id,
      },
    };

    // Sign the entry (in real implementation, use HSM)
    const entryData = JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      action: entry.action,
      custodianId: entry.custodianId,
      metadata: entry.metadata,
    });
    entry.signature = crypto.createHash('sha256').update(entryData).digest();

    ceremony.auditTrail.push(entry);

    if (this.auditCallback) {
      this.auditCallback(entry);
    }

    this.emit('auditEntry', entry);
  }

  /**
   * Export ceremony report
   */
  exportCeremonyReport(ceremonyId: string): string {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    const report = {
      ceremonyId: ceremony.id,
      type: ceremony.config.type,
      status: ceremony.status,
      created: ceremony.createdAt,
      started: ceremony.startedAt,
      completed: ceremony.completedAt,
      configuration: {
        totalShares: ceremony.config.totalShares,
        requiredShares: ceremony.config.requiredShares,
        dualControl: ceremony.config.requireDualControl,
        witnesses: ceremony.config.requireWitnesses,
      },
      custodians: ceremony.config.custodians.map(c => ({
        name: c.name,
        role: c.role,
        present: ceremony.presentCustodians.includes(c.id),
        shareSubmitted: c.hasSubmittedShare,
      })),
      keyGenerated: ceremony.keyHandle,
      sharesDistributed: ceremony.shares.length,
      auditTrail: ceremony.auditTrail.map(e => ({
        timestamp: e.timestamp,
        action: e.action,
        custodian: e.custodianId,
      })),
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Verify ceremony integrity
   */
  verifyCeremonyIntegrity(ceremonyId: string): boolean {
    const ceremony = this.getCeremonyOrThrow(ceremonyId);

    // Verify all audit entries have valid signatures
    for (const entry of ceremony.auditTrail) {
      if (!entry.signature) continue;

      const entryData = JSON.stringify({
        timestamp: entry.timestamp.toISOString(),
        action: entry.action,
        custodianId: entry.custodianId,
        metadata: entry.metadata,
      });

      const expectedSignature = crypto.createHash('sha256').update(entryData).digest();

      if (!entry.signature.equals(expectedSignature)) {
        return false;
      }
    }

    return true;
  }
}
