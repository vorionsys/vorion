/**
 * Audit Chain Service
 *
 * Provides immutable, hash-chained audit records for compliance.
 * Supports cryptographic signing and tamper detection.
 *
 * @packageDocumentation
 */

import { createHash, createSign, createVerify, randomUUID } from 'crypto';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'audit-chain' });

// ============================================================================
// Types
// ============================================================================

export type AuditEntityType = 'agent' | 'attestation' | 'trust' | 'a2a' | 'sandbox' | 'config';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'activate'
  | 'suspend'
  | 'revoke'
  | 'tier_change'
  | 'approval'
  | 'invoke'
  | 'complete'
  | 'violation';

export interface AuditRecord {
  /** Unique record ID */
  id: string;
  /** Tenant ID for multi-tenancy */
  tenantId: string;
  /** Entity type being audited */
  entityType: AuditEntityType;
  /** Entity identifier */
  entityId: string;
  /** Action performed */
  action: AuditAction;
  /** Actor (user or agent ACI) */
  actor: string;
  /** Previous record hash (chain link) */
  previousHash: string;
  /** SHA-256 hash of payload */
  dataHash: string;
  /** Audit payload */
  payload: Record<string, unknown>;
  /** Record timestamp */
  timestamp: string;
  /** Ed25519 signature (optional) */
  signature?: string;
  /** Sequence number for ordering */
  sequence: number;
}

export interface AuditQuery {
  /** Filter by tenant */
  tenantId?: string;
  /** Filter by entity type */
  entityType?: AuditEntityType;
  /** Filter by entity ID */
  entityId?: string;
  /** Filter by action */
  action?: AuditAction;
  /** Filter by actor */
  actor?: string;
  /** Start timestamp */
  startTime?: string;
  /** End timestamp */
  endTime?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface ChainVerificationResult {
  /** Chain is valid */
  valid: boolean;
  /** Number of records verified */
  recordCount: number;
  /** First broken link (if any) */
  brokenAt?: number;
  /** Error message */
  error?: string;
}

export interface AuditStats {
  /** Total records */
  totalRecords: number;
  /** Records by entity type */
  byEntityType: Record<AuditEntityType, number>;
  /** Records by action */
  byAction: Record<AuditAction, number>;
  /** Chain head hash */
  headHash: string;
  /** Chain head sequence */
  headSequence: number;
}

// ============================================================================
// Audit Chain Service
// ============================================================================

export interface AuditStorage {
  append(record: AuditRecord): Promise<void>;
  getLatest(tenantId: string): Promise<AuditRecord | null>;
  query(query: AuditQuery): Promise<AuditRecord[]>;
  getBySequenceRange(tenantId: string, start: number, end: number): Promise<AuditRecord[]>;
  getStats(tenantId: string): Promise<AuditStats>;
}

export interface AuditChainConfig {
  /** Storage backend */
  storage: AuditStorage;
  /** Private key for signing (PEM format) */
  privateKey?: string;
  /** Public key for verification (PEM format) */
  publicKey?: string;
  /** Enable signing */
  signRecords?: boolean;
}

export class AuditChainService {
  private storage: AuditStorage;
  private privateKey?: string;
  private publicKey?: string;
  private signRecords: boolean;
  private sequenceCache: Map<string, number> = new Map();

  constructor(config: AuditChainConfig) {
    this.storage = config.storage;
    this.privateKey = config.privateKey;
    this.publicKey = config.publicKey;
    this.signRecords = config.signRecords ?? false;

    if (this.signRecords && !this.privateKey) {
      throw new Error('Private key required for signing');
    }

    logger.info({ signRecords: this.signRecords }, 'Audit chain service initialized');
  }

  // ==========================================================================
  // Record Creation
  // ==========================================================================

  /**
   * Append a new audit record to the chain
   */
  async append(
    tenantId: string,
    entityType: AuditEntityType,
    entityId: string,
    action: AuditAction,
    actor: string,
    payload: Record<string, unknown>
  ): Promise<AuditRecord> {
    // Get previous record for chaining
    const previous = await this.storage.getLatest(tenantId);
    const previousHash = previous?.dataHash ?? 'genesis';
    const sequence = (previous?.sequence ?? 0) + 1;

    // Compute data hash
    const dataHash = this.computeHash(payload);

    // Create record
    const record: AuditRecord = {
      id: randomUUID(),
      tenantId,
      entityType,
      entityId,
      action,
      actor,
      previousHash,
      dataHash,
      payload,
      timestamp: new Date().toISOString(),
      sequence,
    };

    // Sign if enabled
    if (this.signRecords && this.privateKey) {
      record.signature = this.signRecord(record);
    }

    // Persist
    await this.storage.append(record);

    // Update sequence cache
    this.sequenceCache.set(tenantId, sequence);

    logger.debug(
      { tenantId, entityType, entityId, action, sequence },
      'Audit record appended'
    );

    return record;
  }

  /**
   * Append multiple records atomically
   */
  async appendBatch(
    records: Array<{
      tenantId: string;
      entityType: AuditEntityType;
      entityId: string;
      action: AuditAction;
      actor: string;
      payload: Record<string, unknown>;
    }>
  ): Promise<AuditRecord[]> {
    const results: AuditRecord[] = [];

    for (const input of records) {
      const record = await this.append(
        input.tenantId,
        input.entityType,
        input.entityId,
        input.action,
        input.actor,
        input.payload
      );
      results.push(record);
    }

    return results;
  }

  // ==========================================================================
  // Chain Verification
  // ==========================================================================

  /**
   * Verify the integrity of the audit chain
   */
  async verifyChain(tenantId: string, startSequence?: number, endSequence?: number): Promise<ChainVerificationResult> {
    const start = startSequence ?? 1;
    const stats = await this.storage.getStats(tenantId);
    const end = endSequence ?? stats.headSequence;

    const records = await this.storage.getBySequenceRange(tenantId, start, end);

    if (records.length === 0) {
      return { valid: true, recordCount: 0 };
    }

    let previousHash = start === 1 ? 'genesis' : records[0].previousHash;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Verify chain link
      if (record.previousHash !== previousHash) {
        return {
          valid: false,
          recordCount: i,
          brokenAt: record.sequence,
          error: `Chain broken at sequence ${record.sequence}: expected previous hash ${previousHash}, got ${record.previousHash}`,
        };
      }

      // Verify data hash
      const computedHash = this.computeHash(record.payload);
      if (record.dataHash !== computedHash) {
        return {
          valid: false,
          recordCount: i,
          brokenAt: record.sequence,
          error: `Data tampered at sequence ${record.sequence}: hash mismatch`,
        };
      }

      // Verify signature if present
      if (record.signature && this.publicKey) {
        const signatureValid = this.verifySignature(record);
        if (!signatureValid) {
          return {
            valid: false,
            recordCount: i,
            brokenAt: record.sequence,
            error: `Invalid signature at sequence ${record.sequence}`,
          };
        }
      }

      previousHash = record.dataHash;
    }

    return { valid: true, recordCount: records.length };
  }

  /**
   * Verify a single record's integrity
   */
  verifyRecord(record: AuditRecord): boolean {
    // Verify data hash
    const computedHash = this.computeHash(record.payload);
    if (record.dataHash !== computedHash) {
      return false;
    }

    // Verify signature if present
    if (record.signature && this.publicKey) {
      return this.verifySignature(record);
    }

    return true;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Query audit records
   */
  async query(query: AuditQuery): Promise<AuditRecord[]> {
    return this.storage.query(query);
  }

  /**
   * Get audit history for an entity
   */
  async getEntityHistory(
    tenantId: string,
    entityType: AuditEntityType,
    entityId: string,
    limit?: number
  ): Promise<AuditRecord[]> {
    return this.storage.query({
      tenantId,
      entityType,
      entityId,
      limit: limit ?? 100,
    });
  }

  /**
   * Get recent activity for a tenant
   */
  async getRecentActivity(tenantId: string, limit: number = 50): Promise<AuditRecord[]> {
    return this.storage.query({ tenantId, limit });
  }

  /**
   * Get chain statistics
   */
  async getStats(tenantId: string): Promise<AuditStats> {
    return this.storage.getStats(tenantId);
  }

  // ==========================================================================
  // Cryptographic Helpers
  // ==========================================================================

  /**
   * Compute SHA-256 hash of payload
   */
  private computeHash(payload: Record<string, unknown>): string {
    const data = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Sign a record using Ed25519
   */
  private signRecord(record: AuditRecord): string {
    if (!this.privateKey) {
      throw new Error('Private key not configured');
    }

    const data = this.getSignableData(record);
    const sign = createSign('SHA256');
    sign.update(data);
    return sign.sign(this.privateKey, 'base64');
  }

  /**
   * Verify record signature
   */
  private verifySignature(record: AuditRecord): boolean {
    if (!this.publicKey || !record.signature) {
      return false;
    }

    const data = this.getSignableData(record);
    const verify = createVerify('SHA256');
    verify.update(data);
    return verify.verify(this.publicKey, record.signature, 'base64');
  }

  /**
   * Get data to sign (deterministic ordering)
   */
  private getSignableData(record: AuditRecord): string {
    return JSON.stringify({
      id: record.id,
      tenantId: record.tenantId,
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      actor: record.actor,
      previousHash: record.previousHash,
      dataHash: record.dataHash,
      timestamp: record.timestamp,
      sequence: record.sequence,
    });
  }
}

// ============================================================================
// In-Memory Storage (for testing)
// ============================================================================

export class InMemoryAuditStorage implements AuditStorage {
  private records: Map<string, AuditRecord[]> = new Map();

  async append(record: AuditRecord): Promise<void> {
    const tenantRecords = this.records.get(record.tenantId) ?? [];
    tenantRecords.push(record);
    this.records.set(record.tenantId, tenantRecords);
  }

  async getLatest(tenantId: string): Promise<AuditRecord | null> {
    const tenantRecords = this.records.get(tenantId);
    if (!tenantRecords || tenantRecords.length === 0) {
      return null;
    }
    return tenantRecords[tenantRecords.length - 1];
  }

  async query(query: AuditQuery): Promise<AuditRecord[]> {
    let results: AuditRecord[] = [];

    if (query.tenantId) {
      results = this.records.get(query.tenantId) ?? [];
    } else {
      for (const tenantRecords of this.records.values()) {
        results.push(...tenantRecords);
      }
    }

    // Apply filters
    if (query.entityType) {
      results = results.filter((r) => r.entityType === query.entityType);
    }
    if (query.entityId) {
      results = results.filter((r) => r.entityId === query.entityId);
    }
    if (query.action) {
      results = results.filter((r) => r.action === query.action);
    }
    if (query.actor) {
      results = results.filter((r) => r.actor === query.actor);
    }
    if (query.startTime) {
      results = results.filter((r) => r.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      results = results.filter((r) => r.timestamp <= query.endTime!);
    }

    // Sort by sequence descending (most recent first)
    results.sort((a, b) => b.sequence - a.sequence);

    // Apply pagination
    if (query.offset) {
      results = results.slice(query.offset);
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async getBySequenceRange(tenantId: string, start: number, end: number): Promise<AuditRecord[]> {
    const tenantRecords = this.records.get(tenantId) ?? [];
    return tenantRecords
      .filter((r) => r.sequence >= start && r.sequence <= end)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getStats(tenantId: string): Promise<AuditStats> {
    const tenantRecords = this.records.get(tenantId) ?? [];
    const byEntityType: Record<AuditEntityType, number> = {
      agent: 0,
      attestation: 0,
      trust: 0,
      a2a: 0,
      sandbox: 0,
      config: 0,
    };
    const byAction: Record<AuditAction, number> = {
      create: 0,
      update: 0,
      delete: 0,
      activate: 0,
      suspend: 0,
      revoke: 0,
      tier_change: 0,
      approval: 0,
      invoke: 0,
      complete: 0,
      violation: 0,
    };

    for (const record of tenantRecords) {
      byEntityType[record.entityType]++;
      byAction[record.action]++;
    }

    const head = tenantRecords[tenantRecords.length - 1];

    return {
      totalRecords: tenantRecords.length,
      byEntityType,
      byAction,
      headHash: head?.dataHash ?? 'genesis',
      headSequence: head?.sequence ?? 0,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: AuditChainService | null = null;

export function createAuditChainService(config: AuditChainConfig): AuditChainService {
  instance = new AuditChainService(config);
  return instance;
}

export function getAuditChainService(): AuditChainService {
  if (!instance) {
    throw new Error('AuditChainService not initialized');
  }
  return instance;
}
