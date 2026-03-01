/**
 * SQLite Trust Store
 *
 * Persistent storage for agent trust data using SQLite.
 *
 * @packageDocumentation
 */

import Database from 'better-sqlite3';
import { createLogger } from '../common/logger.js';
import type { TrustTier, ObservationTier } from '../trust-facade/types.js';

const logger = createLogger({ component: 'sqlite-trust-store' });

export interface SQLiteTrustStoreConfig {
  /** Database file path (use ':memory:' for in-memory) */
  dbPath: string;
  /** Enable WAL mode for better concurrency (default: true) */
  walMode?: boolean;
}

/**
 * Agent trust record
 */
export interface AgentTrustRecord {
  agentId: string;
  name: string;
  score: number;
  tier: TrustTier;
  observationTier: ObservationTier;
  observationCeiling: number;
  capabilities: string[];
  admittedAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  isRevoked: boolean;
  revokedReason?: string;
}

/**
 * Trust signal record
 */
export interface TrustSignalRecord {
  id: string;
  agentId: string;
  type: 'success' | 'failure' | 'violation' | 'neutral';
  source: string;
  weight: number;
  scoreBefore: number;
  scoreAfter: number;
  context?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Trust store interface
 */
export interface TrustStore {
  /** Save or update an agent's trust record */
  saveAgent(record: AgentTrustRecord): Promise<void>;
  /** Get an agent's trust record */
  getAgent(agentId: string): Promise<AgentTrustRecord | null>;
  /** Update an agent's score */
  updateScore(agentId: string, newScore: number, newTier: TrustTier): Promise<void>;
  /** Revoke an agent */
  revokeAgent(agentId: string, reason: string): Promise<void>;
  /** Record a trust signal */
  recordSignal(signal: TrustSignalRecord): Promise<void>;
  /** Get signals for an agent */
  getSignals(agentId: string, limit?: number): Promise<TrustSignalRecord[]>;
  /** List all active agents */
  listActiveAgents(): Promise<AgentTrustRecord[]>;
}

/**
 * SQLite implementation of TrustStore
 */
export class SQLiteTrustStore implements TrustStore {
  private db: Database.Database;
  private config: SQLiteTrustStoreConfig;

  // Prepared statements
  private stmts: {
    upsertAgent: Database.Statement;
    getAgent: Database.Statement;
    updateScore: Database.Statement;
    revokeAgent: Database.Statement;
    insertSignal: Database.Statement;
    getSignals: Database.Statement;
    listActiveAgents: Database.Statement;
  } | null = null;

  constructor(config: SQLiteTrustStoreConfig) {
    this.config = {
      walMode: true,
      ...config,
    };

    this.db = new Database(this.config.dbPath);

    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }

    this.initializeSchema();
    this.prepareStatements();

    logger.info({ dbPath: this.config.dbPath }, 'SQLite trust store initialized');
  }

  private initializeSchema(): void {
    this.db.exec(`
      -- Agents table
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        tier INTEGER NOT NULL,
        observation_tier TEXT NOT NULL,
        observation_ceiling INTEGER NOT NULL,
        capabilities TEXT NOT NULL,
        admitted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        revoked_reason TEXT
      );

      -- Trust signals table
      CREATE TABLE IF NOT EXISTS trust_signals (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        weight REAL NOT NULL,
        score_before INTEGER NOT NULL,
        score_after INTEGER NOT NULL,
        context TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_signals_agent_id ON trust_signals(agent_id);
      CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trust_signals(timestamp);
      CREATE INDEX IF NOT EXISTS idx_agents_is_revoked ON agents(is_revoked);
    `);

    logger.debug('Trust store schema initialized');
  }

  private prepareStatements(): void {
    this.stmts = {
      upsertAgent: this.db.prepare(`
        INSERT INTO agents (
          agent_id, name, score, tier, observation_tier, observation_ceiling,
          capabilities, admitted_at, expires_at, last_activity_at, is_revoked, revoked_reason
        ) VALUES (
          @agentId, @name, @score, @tier, @observationTier, @observationCeiling,
          @capabilities, @admittedAt, @expiresAt, @lastActivityAt, @isRevoked, @revokedReason
        )
        ON CONFLICT(agent_id) DO UPDATE SET
          name = @name,
          score = @score,
          tier = @tier,
          observation_tier = @observationTier,
          observation_ceiling = @observationCeiling,
          capabilities = @capabilities,
          expires_at = @expiresAt,
          last_activity_at = @lastActivityAt,
          is_revoked = @isRevoked,
          revoked_reason = @revokedReason
      `),

      getAgent: this.db.prepare(`
        SELECT agent_id, name, score, tier, observation_tier, observation_ceiling,
               capabilities, admitted_at, expires_at, last_activity_at, is_revoked, revoked_reason
        FROM agents
        WHERE agent_id = ?
      `),

      updateScore: this.db.prepare(`
        UPDATE agents
        SET score = @score, tier = @tier, last_activity_at = @lastActivityAt
        WHERE agent_id = @agentId
      `),

      revokeAgent: this.db.prepare(`
        UPDATE agents
        SET is_revoked = 1, revoked_reason = @reason, last_activity_at = @lastActivityAt
        WHERE agent_id = @agentId
      `),

      insertSignal: this.db.prepare(`
        INSERT INTO trust_signals (id, agent_id, type, source, weight, score_before, score_after, context, timestamp)
        VALUES (@id, @agentId, @type, @source, @weight, @scoreBefore, @scoreAfter, @context, @timestamp)
      `),

      getSignals: this.db.prepare(`
        SELECT id, agent_id, type, source, weight, score_before, score_after, context, timestamp
        FROM trust_signals
        WHERE agent_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),

      listActiveAgents: this.db.prepare(`
        SELECT agent_id, name, score, tier, observation_tier, observation_ceiling,
               capabilities, admitted_at, expires_at, last_activity_at, is_revoked, revoked_reason
        FROM agents
        WHERE is_revoked = 0
        ORDER BY last_activity_at DESC
      `),
    };
  }

  /**
   * Save or update an agent's trust record
   */
  async saveAgent(record: AgentTrustRecord): Promise<void> {
    if (!this.stmts) throw new Error('Store not initialized');

    this.stmts.upsertAgent.run({
      agentId: record.agentId,
      name: record.name,
      score: record.score,
      tier: record.tier,
      observationTier: record.observationTier,
      observationCeiling: record.observationCeiling,
      capabilities: JSON.stringify(record.capabilities),
      admittedAt: record.admittedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      lastActivityAt: record.lastActivityAt.toISOString(),
      isRevoked: record.isRevoked ? 1 : 0,
      revokedReason: record.revokedReason ?? null,
    });

    logger.debug({ agentId: record.agentId }, 'Agent record saved');
  }

  /**
   * Get an agent's trust record
   */
  async getAgent(agentId: string): Promise<AgentTrustRecord | null> {
    if (!this.stmts) throw new Error('Store not initialized');

    const row = this.stmts.getAgent.get(agentId) as {
      agent_id: string;
      name: string;
      score: number;
      tier: number;
      observation_tier: string;
      observation_ceiling: number;
      capabilities: string;
      admitted_at: string;
      expires_at: string;
      last_activity_at: string;
      is_revoked: number;
      revoked_reason: string | null;
    } | undefined;

    if (!row) return null;

    return {
      agentId: row.agent_id,
      name: row.name,
      score: row.score,
      tier: row.tier as TrustTier,
      observationTier: row.observation_tier as ObservationTier,
      observationCeiling: row.observation_ceiling,
      capabilities: JSON.parse(row.capabilities),
      admittedAt: new Date(row.admitted_at),
      expiresAt: new Date(row.expires_at),
      lastActivityAt: new Date(row.last_activity_at),
      isRevoked: row.is_revoked === 1,
      revokedReason: row.revoked_reason ?? undefined,
    };
  }

  /**
   * Update an agent's score
   */
  async updateScore(agentId: string, newScore: number, newTier: TrustTier): Promise<void> {
    if (!this.stmts) throw new Error('Store not initialized');

    this.stmts.updateScore.run({
      agentId,
      score: newScore,
      tier: newTier,
      lastActivityAt: new Date().toISOString(),
    });

    logger.debug({ agentId, newScore, newTier }, 'Agent score updated');
  }

  /**
   * Revoke an agent
   */
  async revokeAgent(agentId: string, reason: string): Promise<void> {
    if (!this.stmts) throw new Error('Store not initialized');

    this.stmts.revokeAgent.run({
      agentId,
      reason,
      lastActivityAt: new Date().toISOString(),
    });

    logger.warn({ agentId, reason }, 'Agent revoked');
  }

  /**
   * Record a trust signal
   */
  async recordSignal(signal: TrustSignalRecord): Promise<void> {
    if (!this.stmts) throw new Error('Store not initialized');

    this.stmts.insertSignal.run({
      id: signal.id,
      agentId: signal.agentId,
      type: signal.type,
      source: signal.source,
      weight: signal.weight,
      scoreBefore: signal.scoreBefore,
      scoreAfter: signal.scoreAfter,
      context: signal.context ? JSON.stringify(signal.context) : null,
      timestamp: signal.timestamp.toISOString(),
    });

    logger.debug({ signalId: signal.id, agentId: signal.agentId, type: signal.type }, 'Signal recorded');
  }

  /**
   * Get signals for an agent
   */
  async getSignals(agentId: string, limit: number = 100): Promise<TrustSignalRecord[]> {
    if (!this.stmts) throw new Error('Store not initialized');

    const rows = this.stmts.getSignals.all(agentId, limit) as Array<{
      id: string;
      agent_id: string;
      type: string;
      source: string;
      weight: number;
      score_before: number;
      score_after: number;
      context: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      type: row.type as TrustSignalRecord['type'],
      source: row.source,
      weight: row.weight,
      scoreBefore: row.score_before,
      scoreAfter: row.score_after,
      context: row.context ? JSON.parse(row.context) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  }

  /**
   * List all active agents
   */
  async listActiveAgents(): Promise<AgentTrustRecord[]> {
    if (!this.stmts) throw new Error('Store not initialized');

    const rows = this.stmts.listActiveAgents.all() as Array<{
      agent_id: string;
      name: string;
      score: number;
      tier: number;
      observation_tier: string;
      observation_ceiling: number;
      capabilities: string;
      admitted_at: string;
      expires_at: string;
      last_activity_at: string;
      is_revoked: number;
      revoked_reason: string | null;
    }>;

    return rows.map((row) => ({
      agentId: row.agent_id,
      name: row.name,
      score: row.score,
      tier: row.tier as TrustTier,
      observationTier: row.observation_tier as ObservationTier,
      observationCeiling: row.observation_ceiling,
      capabilities: JSON.parse(row.capabilities),
      admittedAt: new Date(row.admitted_at),
      expiresAt: new Date(row.expires_at),
      lastActivityAt: new Date(row.last_activity_at),
      isRevoked: row.is_revoked === 1,
      revokedReason: row.revoked_reason ?? undefined,
    }));
  }

  /**
   * Get statistics
   */
  getStats(): { agents: number; activeAgents: number; signals: number } {
    const agentCount = this.db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
    const activeCount = this.db.prepare('SELECT COUNT(*) as count FROM agents WHERE is_revoked = 0').get() as { count: number };
    const signalCount = this.db.prepare('SELECT COUNT(*) as count FROM trust_signals').get() as { count: number };

    return {
      agents: agentCount.count,
      activeAgents: activeCount.count,
      signals: signalCount.count,
    };
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.db.exec('DELETE FROM trust_signals');
    this.db.exec('DELETE FROM agents');
    logger.debug('All trust data cleared');
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    logger.info('SQLite trust store closed');
  }
}

/**
 * Create a new SQLite trust store
 */
export function createSQLiteTrustStore(config: SQLiteTrustStoreConfig): SQLiteTrustStore {
  return new SQLiteTrustStore(config);
}
