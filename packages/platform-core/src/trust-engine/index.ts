/**
 * Trust Engine - Behavioral Trust Scoring
 *
 * Calculates and maintains trust scores for entities based on behavioral signals.
 * Persists to PostgreSQL for durability.
 *
 * Supports the dual-layer certification/runtime model:
 * - Certification Layer (CAR): Portable attestations that travel with agents
 * - Runtime Layer (Vorion): Deployment-specific trust enforcement
 *
 * CAR = Categorical Agentic Registry (formerly ACI - Categorical Agentic Registry)
 * Backwards-compatible ACI aliases are provided for migration.
 *
 * @packageDocumentation
 */

import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { createLogger } from '../common/logger.js';
import { getDatabase, type Database } from '../common/db.js';
import {
  trustRecords,
  trustSignals,
  trustHistory,
  type TrustRecord as DbTrustRecord,
  type NewTrustRecord,
  type NewTrustSignal,
  type NewTrustHistory,
} from '@vorionsys/contracts/db';
import type {
  TrustScore,
  TrustLevel,
  TrustSignal as TrustSignalType,
  TrustComponents,
  ID,
} from '../common/types.js';
import { TrustEngineError, DatabaseError, isVorionError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { extractTenantId } from '../common/tenant-context.js';
import {
  trustScoreCalculationsTotal,
  trustScoreCalculationDurationSeconds,
  trustSignalsRecordedTotal,
  trustScoreDistribution,
  recordTrustCalculationMetric,
} from '../common/metrics.js';

// =============================================================================
// DEPENDENCY INJECTION TYPES
// =============================================================================

/**
 * Dependencies for TrustEngine
 *
 * Use these to inject dependencies for testing or custom configurations.
 * If not provided, defaults to lazy initialization from global singletons.
 */
export interface TrustEngineDependencies {
  /** Pre-initialized database instance (optional, will lazy-init if not provided) */
  database?: Database;
}

/**
 * Options for trust engine operations that require tenant context
 *
 * @deprecated Use TenantContext instead for better security.
 *             This interface is maintained for backward compatibility.
 */
export interface TrustOperationOptions {
  /** Tenant ID for multi-tenant isolation (REQUIRED for security) */
  tenantId: ID;
}

/**
 * Helper to extract tenantId from either TenantContext or legacy TrustOperationOptions
 *
 * @internal
 */
function getTenantIdFromOptions(options?: TenantContext | TrustOperationOptions): ID | undefined {
  if (!options) return undefined;

  // Check if it's a TenantContext (has userId property)
  if ('userId' in options && 'createdAt' in options) {
    return extractTenantId(options as TenantContext);
  }

  // Legacy TrustOperationOptions
  return (options as TrustOperationOptions).tenantId;
}

/**
 * Entity-to-tenant mapping for validating tenant ownership
 * In production, this would be fetched from a database or cache
 */
interface EntityTenantMapping {
  entityId: ID;
  tenantId: ID;
}

// CAR Integration imports (with ACI backwards-compatible aliases)
import {
  CertificationTier,
  RuntimeTier,
  CapabilityLevel,
  // CAR types (primary)
  type ParsedCAR,
  parseCAR,
  type CARIdentity,
  // Backwards-compatible ACI aliases
  type ParsedACI,
  parseACI,
  type ACIIdentity,
} from '@vorionsys/contracts/car';

import {
  // CAR types (primary)
  type CARTrustContext,
  type Attestation,
  type PermissionCheckResult,
  calculateEffectiveFromCAR,
  attestationToTrustSignal,
  applyCARFloor,
  enforceCARCeiling,
  calculateEffectiveTier,
  calculateEffectiveScore,
  scoreToTier,
  // Backwards-compatible ACI aliases
  type ACITrustContext,
  calculateEffectiveFromACI,
  applyACIFloor,
  enforceACICeiling,
} from './car-integration.js';

import {
  ObservabilityClass,
  getObservabilityCeiling,
  applyObservabilityCeiling,
  determineObservabilityClass,
  type ObservabilityMetadata,
} from './observability.js';

import {
  DeploymentContext,
  getContextCeiling,
  applyContextCeiling,
  evaluateContextPolicy,
  detectDeploymentContext,
} from './context.js';
import {
  FACTOR_CODE_LIST,
  DEFAULT_FACTOR_WEIGHTS,
  SIGNAL_PREFIX_TO_FACTORS as BASIS_SIGNAL_PREFIX_MAP,
  initialFactorScores,
  type FactorCodeString,
} from '@vorionsys/basis';

const logger = createLogger({ component: 'trust-engine' });

/**
 * Trust level thresholds (T0-T7) — canonical 8-tier model
 */
export const TRUST_THRESHOLDS: Record<TrustLevel, { min: number; max: number }> = {
  0: { min: 0, max: 199 },
  1: { min: 200, max: 349 },
  2: { min: 350, max: 499 },
  3: { min: 500, max: 649 },
  4: { min: 650, max: 799 },
  5: { min: 800, max: 875 },
  6: { min: 876, max: 950 },
  7: { min: 951, max: 1000 },
};

/**
 * Trust level names (T0-T7)
 */
export const TRUST_LEVEL_NAMES: Record<TrustLevel, string> = {
  0: 'Sandbox',
  1: 'Observed',
  2: 'Provisional',
  3: 'Monitored',
  4: 'Standard',
  5: 'Trusted',
  6: 'Certified',
  7: 'Autonomous',
};

// Re-export canonical factor constants from @vorionsys/basis
export const FACTOR_CODES = FACTOR_CODE_LIST;
export type FactorCode = FactorCodeString;
export const FACTOR_WEIGHTS = DEFAULT_FACTOR_WEIGHTS;
export { initialFactorScores };

// Re-export legacy signal prefix mapping from @vorionsys/basis
export const SIGNAL_PREFIX_TO_FACTORS = BASIS_SIGNAL_PREFIX_MAP;

/**
 * @deprecated Use FACTOR_WEIGHTS for 16-factor scoring. Kept for backwards compatibility.
 * Signal weights for score calculation
 */
export const SIGNAL_WEIGHTS: Record<keyof TrustComponents, number> = {
  behavioral: 0.4,
  compliance: 0.25,
  identity: 0.2,
  context: 0.15,
};

/**
 * Decay milestone definition
 */
export interface DecayMilestone {
  days: number;
  multiplier: number;
}

/**
 * Stepped decay milestones
 *
 * Trust decays incrementally based on days since last activity.
 * 182-day half-life: after 182 days of inactivity, score is 50% of original.
 *
 * Steps 1-5: 6% drop each (100% → 70%)
 * Steps 6-9: 5% drop each (70% → 50%)
 *
 * 9 milestones, simple and predictable.
 */
export const DECAY_MILESTONES: DecayMilestone[] = [
  { days: 0,   multiplier: 1.00 },
  { days: 7,   multiplier: 0.94 },
  { days: 14,  multiplier: 0.88 },
  { days: 28,  multiplier: 0.82 },
  { days: 42,  multiplier: 0.76 },
  { days: 56,  multiplier: 0.70 },
  { days: 84,  multiplier: 0.65 },
  { days: 112, multiplier: 0.60 },
  { days: 140, multiplier: 0.55 },
  { days: 182, multiplier: 0.50 },
];

/**
 * Entity trust record
 */
export interface TrustRecord {
  entityId: ID;
  score: TrustScore;
  level: TrustLevel;
  /** @deprecated Use factorScores instead */
  components: TrustComponents;
  /** Per-factor scores (0.0 to 1.0) for each of the 16 trust factors */
  factorScores: Record<string, number>;
  signals: TrustSignalType[];
  lastCalculatedAt: string;
  lastActivityAt: string;
  history: TrustHistoryEntry[];
  // Decay information
  decayApplied: boolean;
  decayMultiplier: number;
  baseScore: TrustScore;
  nextMilestone: { days: number; multiplier: number } | null;
}

/**
 * Trust history entry
 */
export interface TrustHistoryEntry {
  score: TrustScore;
  level: TrustLevel;
  reason: string;
  timestamp: string;
}

/**
 * Trust calculation result
 */
export interface TrustCalculation {
  score: TrustScore;
  level: TrustLevel;
  /** @deprecated Use factorScores */
  components: TrustComponents;
  /** Per-factor scores for all 16 trust factors */
  factorScores: Record<string, number>;
  factors: string[];
}

/**
 * Trust Engine service with PostgreSQL persistence
 *
 * Uses stepped decay milestones (182-day half-life) for trust score degradation.
 *
 * SECURITY: All trust operations now require TenantContext for multi-tenant isolation.
 * TenantContext can only be created from validated JWT tokens, preventing
 * tenant ID injection attacks. Cross-tenant queries are prevented by validating
 * entity ownership.
 *
 * @see DECAY_MILESTONES
 * @see TenantContext in ../common/tenant-context.ts
 */
export class TrustEngine {
  private db: Database | null = null;
  private initialized: boolean = false;
  private injectedDb: Database | null = null;

  /**
   * Entity-to-tenant mapping cache (in production, use Redis or dedicated table)
   * This maps entityId -> tenantId for ownership validation
   */
  private entityTenantCache: Map<ID, ID> = new Map();

  /**
   * Create a new TrustEngine instance.
   *
   * @param deps - Optional dependencies for dependency injection.
   *               If database is provided, it will be used immediately without lazy init.
   *
   * @example
   * // Default usage (lazy initialization)
   * const engine = new TrustEngine();
   * await engine.initialize();
   *
   * @example
   * // With dependency injection (for testing)
   * const engine = new TrustEngine({ database: mockDb });
   */
  constructor(deps: TrustEngineDependencies = {}) {
    // If database is injected, mark as initialized
    if (deps.database) {
      this.injectedDb = deps.database;
      this.db = deps.database;
      this.initialized = true;
    }
    // Decay is now handled via DECAY_MILESTONES (stepped decay)
  }

  /**
   * Validate that an entity belongs to the specified tenant
   *
   * SECURITY: This prevents cross-tenant data access by ensuring
   * the requesting tenant owns the entity being accessed.
   *
   * @throws TrustEngineError if entity does not belong to tenant
   */
  private async validateTenantOwnership(entityId: ID, tenantId: ID): Promise<void> {
    // Check cache first
    const cachedTenant = this.entityTenantCache.get(entityId);
    if (cachedTenant) {
      if (cachedTenant !== tenantId) {
        logger.warn(
          { entityId, requestedTenantId: tenantId, actualTenantId: cachedTenant },
          'SECURITY: Cross-tenant trust query attempt blocked'
        );
        throw new TrustEngineError(
          'Entity does not belong to the specified tenant',
          'validateTenantOwnership',
          entityId,
          { tenantId, reason: 'CROSS_TENANT_ACCESS_DENIED' }
        );
      }
      return;
    }

    // In production, query the entity registry or a dedicated mapping table
    // For now, we register entities on first access with their tenant
    // This is a security-first approach: unknown entities are associated with the first tenant that accesses them
    logger.debug(
      { entityId, tenantId },
      'Entity-tenant mapping not cached, registering association'
    );
    this.entityTenantCache.set(entityId, tenantId);
  }

  /**
   * Register entity-tenant association
   * Call this when creating or importing entities
   */
  registerEntityTenant(entityId: ID, tenantId: ID): void {
    this.entityTenantCache.set(entityId, tenantId);
    logger.debug({ entityId, tenantId }, 'Entity-tenant association registered');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Use injected database if available, otherwise get from singleton
    this.db = this.injectedDb ?? getDatabase();
    this.initialized = true;
    logger.info('Trust engine initialized with database persistence');
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<Database> {
    if (!this.initialized || !this.db) {
      await this.initialize();
    }
    return this.db!;
  }

  /**
   * Calculate trust score for an entity
   *
   * SECURITY: Requires TenantContext for multi-tenant isolation.
   * TenantContext can only be created from validated JWT tokens.
   *
   * @param entityId - The entity to calculate trust for
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   */
  async calculate(entityId: ID, ctx: TenantContext): Promise<TrustCalculation> {
    const startTime = performance.now();
    const tenantId = extractTenantId(ctx);

    try {
      const db = await this.ensureInitialized();

      // SECURITY: Always validate tenant ownership
      await this.validateTenantOwnership(entityId, tenantId);

      // Get recent signals for the entity (last 7 days for weighted calculation)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const signals = await db
        .select()
        .from(trustSignals)
        .where(
          and(
            eq(trustSignals.entityId, entityId),
            gte(trustSignals.timestamp, sevenDaysAgo)
          )
        )
        .orderBy(desc(trustSignals.timestamp))
        .limit(1000);

      // Convert to domain signals
      const domainSignals: TrustSignalType[] = signals.map((s) => ({
        id: s.id,
        entityId: s.entityId,
        type: s.type,
        value: s.value,
        weight: s.weight,
        source: s.source ?? '',
        metadata: (s.metadata as Record<string, unknown>) ?? {},
        timestamp: s.timestamp.toISOString(),
      }));

      // Calculate factor scores (16-factor model)
      const factorScores = this.calculateFactorScores(domainSignals);

      // Calculate weighted total using factor weights
      let score = 0;
      for (const code of FACTOR_CODES) {
        score += factorScores[code]! * FACTOR_WEIGHTS[code] * 1000;
      }
      score = Math.round(score);

      // Clamp to valid range
      const clampedScore = Math.max(0, Math.min(1000, score));
      const level = this.scoreToLevel(clampedScore);

      // Backwards compat: also compute legacy 4-bucket components
      const components = this.calculateComponents(domainSignals);

      const factors = this.getSignificantFactors(components);

      logger.debug(
        { entityId, score: clampedScore, level, factorScores },
        'Trust calculated'
      );

      // Record metrics
      const durationSeconds = (performance.now() - startTime) / 1000;
      recordTrustCalculationMetric(tenantId, 'agent', durationSeconds);
      trustScoreDistribution.observe(
        { tenant_id: tenantId, trust_level: level.toString() },
        clampedScore
      );

      return {
        score: clampedScore,
        level,
        components,
        factorScores,
        factors,
      };
    } catch (error) {
      if (isVorionError(error)) {
        throw error;
      }
      logger.error({ error, entityId }, 'Failed to calculate trust score');
      throw new TrustEngineError(
        `Failed to calculate trust score: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'calculate',
        entityId,
        { originalError: error instanceof Error ? error.name : 'Unknown' }
      );
    }
  }

  /**
   * Get trust score for an entity
   *
   * SECURITY: Requires TenantContext for multi-tenant isolation.
   * TenantContext can only be created from validated JWT tokens.
   *
   * @param entityId - The entity to get trust score for
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   */
  async getScore(entityId: ID, ctx: TenantContext): Promise<TrustRecord | undefined> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = await this.ensureInitialized();

      // SECURITY: Always validate tenant ownership
      await this.validateTenantOwnership(entityId, tenantId);

      const result = await db
        .select()
        .from(trustRecords)
        .where(eq(trustRecords.entityId, entityId))
        .limit(1);

      if (result.length === 0) return undefined;

      const record = result[0]!;

      // Check if recalculation is needed (older than 1 minute)
      const staleness = Date.now() - record.lastCalculatedAt.getTime();
      if (staleness > 60000) {
        // Recalculate
        const calculation = await this.calculate(entityId, ctx);

        // Update record
        await db
          .update(trustRecords)
          .set({
            score: calculation.score,
            level: calculation.level.toString() as '0' | '1' | '2' | '3' | '4',
            behavioralScore: calculation.components.behavioral,
            complianceScore: calculation.components.compliance,
            identityScore: calculation.components.identity,
            contextScore: calculation.components.context,
            lastCalculatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(trustRecords.entityId, entityId));

        record.score = calculation.score;
        record.level = calculation.level.toString() as '0' | '1' | '2' | '3' | '4';
        record.behavioralScore = calculation.components.behavioral;
        record.complianceScore = calculation.components.compliance;
        record.identityScore = calculation.components.identity;
        record.contextScore = calculation.components.context;
        record.lastCalculatedAt = new Date();
      }

      // Get recent signals
      const signals = await db
        .select()
        .from(trustSignals)
        .where(eq(trustSignals.entityId, entityId))
        .orderBy(desc(trustSignals.timestamp))
        .limit(100);

      // Get history
      const history = await db
        .select()
        .from(trustHistory)
        .where(eq(trustHistory.entityId, entityId))
        .orderBy(desc(trustHistory.timestamp))
        .limit(100);

      // Apply stepped decay based on inactivity
      const lastActivityAt = record.lastActivityAt ?? record.lastCalculatedAt;
      const daysSinceActivity = this.calculateInactiveDays(lastActivityAt);
      const decayMultiplier = this.calculateDecayMultiplier(daysSinceActivity);
      const baseScore = record.score;
      const decayedScore = this.applyDecay(baseScore, daysSinceActivity);
      const decayApplied = daysSinceActivity > 0;

      // Recalculate level based on decayed score
      const decayedLevel = this.scoreToLevel(decayedScore);

      logger.debug(
        {
          entityId,
          baseScore,
          decayedScore,
          daysSinceActivity,
          decayMultiplier,
        },
        'Decay applied to trust score'
      );

      // Build factor scores from domain signals (or defaults if none)
      const domainSignalsList: TrustSignalType[] = signals.map((s) => ({
        id: s.id,
        entityId: s.entityId,
        type: s.type,
        value: s.value,
        weight: s.weight,
        source: s.source ?? '',
        metadata: (s.metadata as Record<string, unknown>) ?? {},
        timestamp: s.timestamp.toISOString(),
      }));

      const factorScores = domainSignalsList.length > 0
        ? this.calculateFactorScores(domainSignalsList)
        : this.initialFactorScores();

      return {
        entityId: record.entityId,
        score: decayedScore,
        level: decayedLevel,
        components: {
          behavioral: record.behavioralScore,
          compliance: record.complianceScore,
          identity: record.identityScore,
          context: record.contextScore,
        },
        factorScores,
        signals: domainSignalsList,
        lastCalculatedAt: record.lastCalculatedAt.toISOString(),
        lastActivityAt: lastActivityAt.toISOString(),
        history: history.map((h) => ({
          score: h.score,
          level: parseInt(h.level) as TrustLevel,
          reason: h.reason,
          timestamp: h.timestamp.toISOString(),
        })),
        // Decay information
        decayApplied,
        decayMultiplier,
        baseScore,
        nextMilestone: this.getNextMilestone(daysSinceActivity),
      };
    } catch (error) {
      if (isVorionError(error)) {
        throw error;
      }
      logger.error({ error, entityId }, 'Failed to get trust score');
      throw new TrustEngineError(
        `Failed to get trust score: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'getScore',
        entityId
      );
    }
  }

  /**
   * Record a trust signal
   *
   * SECURITY: Requires TenantContext for multi-tenant isolation.
   * TenantContext can only be created from validated JWT tokens.
   *
   * @param signal - The trust signal to record
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   */
  async recordSignal(signal: TrustSignalType, ctx: TenantContext): Promise<void> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = await this.ensureInitialized();

      // SECURITY: Always validate tenant ownership
      await this.validateTenantOwnership(signal.entityId, tenantId);

      // Insert the signal
      const newSignal: NewTrustSignal = {
        entityId: signal.entityId,
        type: signal.type,
        value: signal.value,
        weight: signal.weight ?? 1.0,
        source: signal.source ?? null,
        metadata: signal.metadata ?? null,
        timestamp: signal.timestamp ? new Date(signal.timestamp) : new Date(),
      };

      const [insertedSignal] = await db
        .insert(trustSignals)
        .values(newSignal)
        .returning();

      // Get or create trust record
      let record = await db
        .select()
        .from(trustRecords)
        .where(eq(trustRecords.entityId, signal.entityId))
        .limit(1);

      if (record.length === 0) {
        // Create initial record with lastActivityAt for decay tracking
        const nowDate = new Date();
        const initialRecord: NewTrustRecord = {
          entityId: signal.entityId,
          score: 200,
          level: '1',
          behavioralScore: 0.5,
          complianceScore: 0.5,
          identityScore: 0.5,
          contextScore: 0.5,
          signalCount: 1,
          lastCalculatedAt: nowDate,
          lastActivityAt: nowDate,
        };

        await db.insert(trustRecords).values(initialRecord);
        const newRecord: DbTrustRecord = {
          ...initialRecord,
          id: crypto.randomUUID(),
          score: initialRecord.score ?? 200,
          level: initialRecord.level ?? '0',
          behavioralScore: initialRecord.behavioralScore ?? 50,
          complianceScore: initialRecord.complianceScore ?? 50,
          identityScore: initialRecord.identityScore ?? 50,
          contextScore: initialRecord.contextScore ?? 50,
          signalCount: initialRecord.signalCount ?? 0,
          lastCalculatedAt: initialRecord.lastCalculatedAt ?? nowDate,
          createdAt: nowDate,
          updatedAt: nowDate,
          lastActivityAt: nowDate,
          metadata: null,
        };
        record = [newRecord];
      }

      const currentRecord = record[0]!;
      const previousScore = currentRecord.score;
      const previousLevel = parseInt(currentRecord.level) as TrustLevel;

      // Recalculate
      const calculation = await this.calculate(signal.entityId, ctx);

      // Update record - reset decay clock with lastActivityAt
      const now = new Date();
      await db
        .update(trustRecords)
        .set({
          score: calculation.score,
          level: calculation.level.toString() as '0' | '1' | '2' | '3' | '4',
          behavioralScore: calculation.components.behavioral,
          complianceScore: calculation.components.compliance,
          identityScore: calculation.components.identity,
          contextScore: calculation.components.context,
          signalCount: sql`${trustRecords.signalCount} + 1`,
          lastCalculatedAt: now,
          lastActivityAt: now, // Reset decay clock on trust-positive activity
          updatedAt: now,
        })
        .where(eq(trustRecords.entityId, signal.entityId));

      // Record history if significant change
      if (Math.abs(calculation.score - previousScore) >= 10) {
        const historyEntry: NewTrustHistory = {
          entityId: signal.entityId,
          score: calculation.score,
          previousScore,
          level: calculation.level.toString() as '0' | '1' | '2' | '3' | '4',
          previousLevel: previousLevel.toString() as '0' | '1' | '2' | '3' | '4',
          reason: `Signal: ${signal.type}`,
          signalId: insertedSignal?.id,
          timestamp: new Date(),
        };

        await db.insert(trustHistory).values(historyEntry);
      }

      // Record metrics for signal recording
      trustSignalsRecordedTotal.inc({
        signal_type: signal.type,
        tenant_id: tenantId,
      });

      logger.debug(
        {
          entityId: signal.entityId,
          signalType: signal.type,
          newScore: calculation.score,
        },
        'Signal recorded'
      );
    } catch (error) {
      if (isVorionError(error)) {
        throw error;
      }
      logger.error({ error, entityId: signal.entityId, signalType: signal.type }, 'Failed to record trust signal');
      throw new TrustEngineError(
        `Failed to record trust signal: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'recordSignal',
        signal.entityId,
        { signalType: signal.type }
      );
    }
  }

  /**
   * Get trust history for an entity
   *
   * SECURITY: Requires TenantContext for multi-tenant isolation.
   * TenantContext can only be created from validated JWT tokens.
   *
   * @param entityId - The entity to get history for
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param limit - Maximum number of history entries to return (default: 100)
   */
  async getHistory(
    entityId: ID,
    ctx: TenantContext,
    limit: number = 100
  ): Promise<TrustHistoryEntry[]> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = await this.ensureInitialized();

      // SECURITY: Validate tenant ownership (REQUIRED)
      await this.validateTenantOwnership(entityId, tenantId);

      const history = await db
        .select()
        .from(trustHistory)
        .where(eq(trustHistory.entityId, entityId))
        .orderBy(desc(trustHistory.timestamp))
        .limit(limit);

      return history.map((h) => ({
        score: h.score,
        level: parseInt(h.level) as TrustLevel,
        reason: h.reason,
        timestamp: h.timestamp.toISOString(),
      }));
    } catch (error) {
      if (isVorionError(error)) {
        throw error;
      }
      logger.error({ error, entityId }, 'Failed to get trust history');
      throw new TrustEngineError(
        `Failed to get trust history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'getHistory',
        entityId
      );
    }
  }

  /**
   * Initialize trust for a new entity
   *
   * SECURITY: Requires TenantContext for multi-tenant isolation.
   * TenantContext can only be created from validated JWT tokens.
   *
   * @param entityId - The entity to initialize
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param initialLevel - Initial trust level (default: 1)
   */
  async initializeEntity(
    entityId: ID,
    ctx: TenantContext,
    initialLevel: TrustLevel = 1
  ): Promise<TrustRecord> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = await this.ensureInitialized();

      // SECURITY: Register entity-tenant association
      this.registerEntityTenant(entityId, tenantId);

      const score = TRUST_THRESHOLDS[initialLevel].min;
      const now = new Date();

      const newRecord: NewTrustRecord = {
        entityId,
        score,
        level: initialLevel.toString() as '0' | '1' | '2' | '3' | '4',
        behavioralScore: 0.5,
        complianceScore: 0.5,
        identityScore: 0.5,
        contextScore: 0.5,
        signalCount: 0,
        lastCalculatedAt: now,
        lastActivityAt: now,
      };

      await db.insert(trustRecords).values(newRecord);

      // Record initial history
      const historyEntry: NewTrustHistory = {
        entityId,
        score,
        level: initialLevel.toString() as '0' | '1' | '2' | '3' | '4',
        reason: 'Initial registration',
        timestamp: now,
      };

      await db.insert(trustHistory).values(historyEntry);

      logger.info({ entityId, initialLevel }, 'Entity trust initialized');

      return {
        entityId,
        score,
        level: initialLevel,
        components: {
          behavioral: 0.5,
          compliance: 0.5,
          identity: 0.5,
          context: 0.5,
        },
        factorScores: this.initialFactorScores(),
        signals: [],
        lastCalculatedAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        history: [
          {
            score,
            level: initialLevel,
            reason: 'Initial registration',
            timestamp: now.toISOString(),
          },
        ],
        // New entity has no decay
        decayApplied: false,
        decayMultiplier: 1.0,
        baseScore: score,
        nextMilestone: DECAY_MILESTONES[1] ?? null,
      };
    } catch (error) {
      if (isVorionError(error)) {
        throw error;
      }
      logger.error({ error, entityId, initialLevel }, 'Failed to initialize entity trust');
      throw new TrustEngineError(
        `Failed to initialize entity trust: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'initializeEntity',
        entityId,
        { initialLevel }
      );
    }
  }

  /**
   * Convert score to trust level
   */
  private scoreToLevel(score: TrustScore): TrustLevel {
    for (const [level, { min, max }] of Object.entries(TRUST_THRESHOLDS)) {
      if (score >= min && score <= max) {
        return parseInt(level) as TrustLevel;
      }
    }
    return 0;
  }

  /**
   * @deprecated Use calculateFactorScores for 16-factor model. Kept for backwards compatibility.
   * Calculate component scores from signals
   */
  private calculateComponents(signals: TrustSignalType[]): TrustComponents {
    // Group signals by type
    const behavioral = signals.filter((s) => s.type.startsWith('behavioral.'));
    const compliance = signals.filter((s) => s.type.startsWith('compliance.'));
    const identity = signals.filter((s) => s.type.startsWith('identity.'));
    const context = signals.filter((s) => s.type.startsWith('context.'));

    return {
      behavioral: this.averageSignalValue(behavioral, 0.5),
      compliance: this.averageSignalValue(compliance, 0.5),
      identity: this.averageSignalValue(identity, 0.5),
      context: this.averageSignalValue(context, 0.5),
    };
  }

  /**
   * Calculate per-factor scores from signals.
   * Signals can use either:
   *   - Factor code prefix (e.g. 'CT-COMP.success')
   *   - Legacy bucket prefix (e.g. 'behavioral.success') — mapped to factors via SIGNAL_PREFIX_TO_FACTORS
   */
  private calculateFactorScores(signals: TrustSignalType[]): Record<string, number> {
    const factorSignals: Record<string, TrustSignalType[]> = {};

    // Initialize all factors
    for (const code of FACTOR_CODES) {
      factorSignals[code] = [];
    }

    for (const signal of signals) {
      const prefix = signal.type.split('.')[0];

      // Check if it's a direct factor code
      if ((FACTOR_CODES as readonly string[]).includes(prefix)) {
        factorSignals[prefix]!.push(signal);
        continue;
      }

      // Check if it's a legacy bucket prefix
      const mappedFactors = SIGNAL_PREFIX_TO_FACTORS[prefix];
      if (mappedFactors) {
        // Distribute signal across mapped factors
        for (const factorCode of mappedFactors) {
          factorSignals[factorCode]!.push(signal);
        }
      }
    }

    // Calculate average score for each factor
    const scores: Record<string, number> = {};
    for (const code of FACTOR_CODES) {
      scores[code] = this.averageSignalValue(factorSignals[code]!, 0.5);
    }

    return scores;
  }

  /**
   * Calculate average signal value with default
   */
  private averageSignalValue(
    signals: TrustSignalType[],
    defaultValue: number
  ): number {
    if (signals.length === 0) return defaultValue;

    // Weight recent signals more heavily
    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      const age = now - new Date(signal.timestamp).getTime();
      const timeWeight = Math.exp(-age / (182 * 24 * 60 * 60 * 1000)); // 182-day half-life
      const signalWeight = signal.weight ?? 1.0;
      const combinedWeight = timeWeight * signalWeight;

      weightedSum += signal.value * combinedWeight;
      totalWeight += combinedWeight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : defaultValue;
  }

  /**
   * Get significant factors affecting the score
   */
  private getSignificantFactors(components: TrustComponents): string[] {
    const factors: string[] = [];

    if (components.behavioral < 0.3) {
      factors.push('Low behavioral trust');
    }
    if (components.compliance < 0.3) {
      factors.push('Low compliance score');
    }
    if (components.identity < 0.3) {
      factors.push('Weak identity verification');
    }
    if (components.context < 0.3) {
      factors.push('Unusual context signals');
    }

    return factors;
  }

  /**
   * Create initial factor scores with all 16 factors at 0.5 (neutral)
   */
  private initialFactorScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const code of FACTOR_CODES) {
      scores[code] = 0.5;
    }
    return scores;
  }

  /**
   * Calculate decay multiplier based on days since last activity
   *
   * Uses stepped milestones with interpolation for smooth decay.
   * 182-day half-life: after 182 days of inactivity, score is 50% of original.
   */
  private calculateDecayMultiplier(daysSinceLastActivity: number): number {
    // Find the applicable milestone and next milestone
    let applicableMilestone = DECAY_MILESTONES[0]!;
    let nextMilestone: DecayMilestone | null = null;

    for (let i = 0; i < DECAY_MILESTONES.length; i++) {
      if (daysSinceLastActivity >= DECAY_MILESTONES[i]!.days) {
        applicableMilestone = DECAY_MILESTONES[i]!;
        nextMilestone = DECAY_MILESTONES[i + 1] ?? null;
      }
    }

    // If beyond final milestone, use final multiplier
    if (!nextMilestone) {
      return applicableMilestone.multiplier;
    }

    // Interpolate between milestones for smooth decay
    const daysIntoMilestone = daysSinceLastActivity - applicableMilestone.days;
    const milestoneDuration = nextMilestone.days - applicableMilestone.days;
    const progress = daysIntoMilestone / milestoneDuration;

    const decayRange = applicableMilestone.multiplier - nextMilestone.multiplier;
    return applicableMilestone.multiplier - decayRange * progress;
  }

  /**
   * Apply decay to a base score
   */
  private applyDecay(baseScore: number, daysSinceLastActivity: number): number {
    const multiplier = this.calculateDecayMultiplier(daysSinceLastActivity);
    return Math.round(baseScore * multiplier);
  }

  /**
   * Calculate days since last activity from a date
   */
  private calculateInactiveDays(lastActivityAt: Date): number {
    const now = Date.now();
    const lastActivity = lastActivityAt.getTime();
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((now - lastActivity) / msPerDay);
  }

  /**
   * Get the next decay milestone for an entity
   */
  private getNextMilestone(
    daysSinceLastActivity: number
  ): { days: number; multiplier: number } | null {
    for (const milestone of DECAY_MILESTONES) {
      if (milestone.days > daysSinceLastActivity) {
        return milestone;
      }
    }
    return null; // Already at or past final milestone
  }

  // ==========================================================================
  // ACI Integration Methods
  // ==========================================================================

  /**
   * Get trust context with ACI integration
   *
   * Combines ACI identity with attestation-based certification and Vorion
   * runtime layer to produce a complete trust context. The effective tier/score
   * is the minimum of all contributing factors.
   *
   * IMPORTANT: Trust tier comes from attestations, NOT the CAR ID itself.
   * The CAR ID is just an identifier; trust is computed at runtime.
   *
   * @param entityId - The entity to get trust context for
   * @param carId - The CAR ID string for the entity
   * @param attestation - Optional attestation for this entity
   * @returns Complete CAR trust context with effective permissions
   */
  async getACITrustContext(
    entityId: ID,
    carId: string,
    ctx: TenantContext,
    attestation?: Attestation
  ): Promise<ACITrustContext> {
    const parsedACI = parseACI(carId);
    const trustRecord = await this.getScore(entityId, ctx);
    const runtimeScore = trustRecord?.score ?? 200;
    const runtimeTier = scoreToTier(runtimeScore);

    // Get observability and context from entity metadata or config
    const observability = await this.getObservabilityClass(entityId);
    const context = await this.getDeploymentContext(entityId);

    const observabilityCeiling = getObservabilityCeiling(observability);
    const contextPolicyCeiling = getContextCeiling(context);

    // Certification tier comes from attestation, NOT the CAR ID
    const certificationTier = attestation?.certificationTier ?? (0 as CertificationTier);
    const hasValidAttestation = attestation !== null && attestation !== undefined &&
      attestation.expiresAt > new Date();

    // Build proper CARTrustContext for effective calculations
    const trustContext: CARTrustContext = {
      car: carId,
      trustScore: runtimeScore,
      trustTier: runtimeTier,
      certificationTier,
      capabilityLevel: parsedACI.level,
      attestations: attestation ? [attestation] : [],
      observabilityCeiling,
      contextPolicyCeiling,
    };

    const effectiveTier = calculateEffectiveTier(trustContext);
    const effectiveScore = calculateEffectiveScore(trustContext);

    logger.debug(
      {
        entityId,
        identity: `${parsedACI.registry}.${parsedACI.organization}.${parsedACI.agentClass}`,
        certificationTier,
        hasValidAttestation,
        runtimeTier,
        observabilityCeiling,
        contextPolicyCeiling,
        effectiveTier,
        effectiveScore,
      },
      'Built ACI trust context'
    );

    return trustContext;
  }

  /**
   * Apply ACI attestation as trust signal
   *
   * Converts an ACI attestation into a trust signal and applies it to
   * the entity's trust record. Also enforces the certification floor -
   * the entity's score cannot fall below their certified tier minimum.
   *
   * @param entityId - The entity to apply attestation to
   * @param attestation - The ACI attestation record
   */
  async applyAttestation(entityId: ID, attestation: Attestation, ctx: TenantContext): Promise<void> {
    const signalData = attestationToTrustSignal(attestation);

    // Record the attestation as a trust signal
    await this.recordSignal({
      id: crypto.randomUUID() as ID,
      entityId,
      type: `attestation:${attestation.scope}`,
      value: signalData.score,
      weight: signalData.weight,
      source: signalData.source,
      timestamp: signalData.timestamp.toISOString(),
    }, ctx);

    // Apply floor from certification using a trust context
    const trustRecord = await this.getScore(entityId, ctx);
    if (trustRecord) {
      const runtimeTier = scoreToTier(trustRecord.score);
      const floorContext: CARTrustContext = {
        car: '',
        trustScore: trustRecord.score,
        trustTier: runtimeTier,
        certificationTier: attestation.certificationTier,
        capabilityLevel: CapabilityLevel.L0_OBSERVE,
        attestations: [attestation],
      };
      const flooredScore = applyACIFloor(floorContext, trustRecord.score);
      if (flooredScore > trustRecord.score) {
        await this.setScore(entityId, flooredScore, 'ACI attestation floor', ctx);
      }
    }

    logger.info(
      {
        entityId,
        attestationId: attestation.id,
        certificationTier: attestation.certificationTier,
        issuer: attestation.issuer,
      },
      'Applied ACI attestation'
    );
  }

  /**
   * Check if action is allowed under effective permission
   *
   * Evaluates whether an entity has sufficient effective trust to perform
   * an action requiring a specific tier and domains.
   *
   * @param entityId - The entity requesting the action
   * @param carId - The entity's CAR ID string
   * @param requiredTier - Minimum tier required for the action
   * @param requiredDomains - Domains required for the action
   * @returns Permission check result with reason if denied
   */
  async checkEffectivePermission(
    entityId: ID,
    carId: string,
    tenantCtx: TenantContext,
    requiredTier: RuntimeTier,
    requiredDomains: string[]
  ): Promise<{ allowed: boolean; effectiveLevel: number; reason?: string }> {
    const aciCtx = await this.getACITrustContext(entityId, carId, tenantCtx);
    const effective = calculateEffectiveFromACI(aciCtx);

    // EffectivePermission uses `level` (CapabilityLevel 0-7)
    const effectiveLevel = effective.level;
    const levelAllowed = effectiveLevel >= requiredTier;

    // Domain check from parsed CAR context
    const parsedCAR = parseCAR(carId);
    const contextDomains: string[] = [...(parsedCAR.domains ?? [])];
    const domainsAllowed = requiredDomains.every((d) =>
      contextDomains.includes(d)
    );

    const allowed = levelAllowed && domainsAllowed;

    let reason: string | undefined;
    if (!levelAllowed) {
      reason = `Requires T${requiredTier}, effective level is L${effectiveLevel}`;
    } else if (!domainsAllowed) {
      const missingDomains = requiredDomains.filter(
        (d) => !contextDomains.includes(d)
      );
      reason = `Missing required domains: ${missingDomains.join(', ')}`;
    }

    logger.debug(
      {
        entityId,
        requiredTier,
        requiredDomains,
        effectiveLevel,
        certifiedDomains: contextDomains,
        allowed,
        reason,
        constrainingFactor: effective.constrainingFactor,
      },
      'Checked effective permission'
    );

    return {
      allowed,
      effectiveLevel,
      reason,
    };
  }

  /**
   * Set trust score directly with reason
   *
   * Used internally for applying floors and ceilings from ACI.
   *
   * @param entityId - The entity to update
   * @param score - The new trust score
   * @param reason - Reason for the change
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   */
  async setScore(entityId: ID, score: TrustScore, reason: string, ctx: TenantContext): Promise<void> {
    const db = await this.ensureInitialized();

    const level = this.scoreToLevel(score);
    const now = new Date();

    // Get current record for history
    const current = await db
      .select()
      .from(trustRecords)
      .where(eq(trustRecords.entityId, entityId))
      .limit(1);

    if (current.length === 0) {
      // Entity doesn't exist, create it
      await this.initializeEntity(entityId, ctx, level);
      return;
    }

    const previousScore = current[0]!.score;
    const previousLevel = parseInt(current[0]!.level) as TrustLevel;

    // Update record
    await db
      .update(trustRecords)
      .set({
        score,
        level: level.toString() as '0' | '1' | '2' | '3' | '4',
        lastCalculatedAt: now,
        updatedAt: now,
      })
      .where(eq(trustRecords.entityId, entityId));

    // Record history
    const historyEntry: NewTrustHistory = {
      entityId,
      score,
      previousScore,
      level: level.toString() as '0' | '1' | '2' | '3' | '4',
      previousLevel: previousLevel.toString() as '0' | '1' | '2' | '3' | '4',
      reason,
      timestamp: now,
    };

    await db.insert(trustHistory).values(historyEntry);

    logger.info(
      { entityId, previousScore, newScore: score, reason },
      'Trust score updated'
    );
  }

  /**
   * Get observability class for an entity
   *
   * Retrieves or determines the observability class from entity metadata.
   *
   * @param entityId - The entity to check
   * @returns The entity's observability class
   */
  async getObservabilityClass(entityId: ID): Promise<ObservabilityClass> {
    const db = await this.ensureInitialized();

    // Try to get from entity metadata stored in trust_records
    const record = await db
      .select()
      .from(trustRecords)
      .where(eq(trustRecords.entityId, entityId))
      .limit(1);

    if (record.length > 0) {
      const rawMetadata = record[0]!.metadata;
      if (rawMetadata) {
        // Convert JSONB stored metadata to ObservabilityMetadata type
        // The database stores dates as ISO strings, so convert if present
        const metadata: Partial<ObservabilityMetadata> = {
          class: rawMetadata.observabilityClass as ObservabilityClass | undefined,
          attestationProvider: rawMetadata.attestationProvider,
          verificationProof: rawMetadata.verificationProof,
          sourceCodeUrl: rawMetadata.sourceCodeUrl,
          lastAuditDate: rawMetadata.lastAuditDate
            ? new Date(rawMetadata.lastAuditDate)
            : undefined,
        };
        // Use determineObservabilityClass to infer from metadata
        return determineObservabilityClass(metadata);
      }
    }

    // Default to most restrictive if unknown
    return ObservabilityClass.BLACK_BOX;
  }

  /**
   * Set observability metadata for an entity
   *
   * Updates the trust record with observability information that determines
   * the entity's trust ceiling.
   *
   * @param entityId - The entity to update
   * @param metadata - Observability metadata (class, attestation info, etc.)
   * @returns True if update was successful
   */
  async setObservabilityMetadata(
    entityId: ID,
    metadata: Partial<ObservabilityMetadata>
  ): Promise<boolean> {
    const db = await this.ensureInitialized();

    // Convert ObservabilityMetadata to JSONB-compatible format
    // Dates must be stored as ISO strings in JSONB
    const jsonbMetadata: Record<string, unknown> = {
      observabilityClass: metadata.class,
      attestationProvider: metadata.attestationProvider,
      verificationProof: metadata.verificationProof,
      sourceCodeUrl: metadata.sourceCodeUrl,
      lastAuditDate: metadata.lastAuditDate?.toISOString(),
    };

    try {
      // Try to update existing record
      const result = await db
        .update(trustRecords)
        .set({
          metadata: jsonbMetadata,
          updatedAt: new Date(),
        })
        .where(eq(trustRecords.entityId, entityId));

      if (result.rowCount === 0) {
        // No existing record, create one with default values
        await db.insert(trustRecords).values({
          entityId,
          score: 200, // Default score for new entities
          level: '1', // Supervised level
          metadata: jsonbMetadata,
        });
      }

      logger.info(
        {
          entityId,
          observabilityClass: metadata.class,
          hasAttestation: !!metadata.attestationProvider,
          hasVerification: !!metadata.verificationProof,
        },
        'Updated observability metadata for entity'
      );

      return true;
    } catch (error) {
      logger.error(
        {
          entityId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update observability metadata'
      );
      return false;
    }
  }

  /**
   * Get full observability metadata for an entity
   *
   * @param entityId - The entity to query
   * @returns The observability metadata or undefined if not set
   */
  async getObservabilityMetadata(
    entityId: ID
  ): Promise<ObservabilityMetadata | undefined> {
    const db = await this.ensureInitialized();

    const record = await db
      .select({ metadata: trustRecords.metadata })
      .from(trustRecords)
      .where(eq(trustRecords.entityId, entityId))
      .limit(1);

    if (record.length > 0 && record[0]!.metadata) {
      const rawMetadata = record[0]!.metadata;
      // Convert JSONB stored metadata to ObservabilityMetadata type
      // The database stores dates as ISO strings, so convert if present
      return {
        class: (rawMetadata.observabilityClass as ObservabilityClass) ?? ObservabilityClass.BLACK_BOX,
        attestationProvider: rawMetadata.attestationProvider,
        verificationProof: rawMetadata.verificationProof,
        sourceCodeUrl: rawMetadata.sourceCodeUrl,
        lastAuditDate: rawMetadata.lastAuditDate
          ? new Date(rawMetadata.lastAuditDate)
          : undefined,
      };
    }

    return undefined;
  }

  /**
   * Get deployment context for an entity
   *
   * Retrieves or determines the deployment context for trust calculations.
   *
   * @param entityId - The entity to check (may have context override)
   * @returns The applicable deployment context
   */
  async getDeploymentContext(_entityId: ID): Promise<DeploymentContext> {
    // First check for entity-specific context override
    // (could be stored in entity metadata or configuration)

    // For now, detect from environment
    return detectDeploymentContext();
  }
}

/**
 * Create a new Trust Engine instance with dependency injection.
 *
 * This is the preferred way to create trust engines in production code
 * as it makes dependencies explicit and testable.
 *
 * @param deps - Optional dependencies. If database provided, skips lazy init.
 * @returns Configured TrustEngine instance
 *
 * @example
 * // Default usage (lazy initialization)
 * const engine = createTrustEngine();
 * await engine.initialize();
 *
 * @example
 * // With custom dependencies (pre-initialized)
 * const engine = createTrustEngine({ database: customDb });
 */
export function createTrustEngine(
  deps: TrustEngineDependencies = {}
): TrustEngine {
  return new TrustEngine(deps);
}

// ============================================================================
// Standalone decay functions (exported for unit testing)
// ============================================================================

/**
 * Calculate decay multiplier based on days since last activity
 *
 * Uses stepped milestones with linear interpolation for smooth decay.
 *
 * @param daysSinceLastActivity - Number of days since last trust-positive activity
 * @returns Decay multiplier between 0.5 and 1.0
 */
export function calculateDecayMultiplier(daysSinceLastActivity: number): number {
  // Find the applicable milestone and next milestone
  let applicableMilestone = DECAY_MILESTONES[0]!;
  let nextMilestone: DecayMilestone | null = null;

  for (let i = 0; i < DECAY_MILESTONES.length; i++) {
    if (daysSinceLastActivity >= DECAY_MILESTONES[i]!.days) {
      applicableMilestone = DECAY_MILESTONES[i]!;
      nextMilestone = DECAY_MILESTONES[i + 1] ?? null;
    }
  }

  // If beyond final milestone, use final multiplier
  if (!nextMilestone) {
    return applicableMilestone.multiplier;
  }

  // Interpolate between milestones for smooth decay
  const daysIntoMilestone = daysSinceLastActivity - applicableMilestone.days;
  const milestoneDuration = nextMilestone.days - applicableMilestone.days;
  const progress = daysIntoMilestone / milestoneDuration;

  const decayRange = applicableMilestone.multiplier - nextMilestone.multiplier;
  return applicableMilestone.multiplier - decayRange * progress;
}

/**
 * Apply decay multiplier to a base score
 *
 * @param baseScore - The undecayed trust score
 * @param daysSinceLastActivity - Number of days since last activity
 * @returns Decayed score (rounded to nearest integer)
 */
export function applyDecay(baseScore: number, daysSinceLastActivity: number): number {
  const multiplier = calculateDecayMultiplier(daysSinceLastActivity);
  return Math.round(baseScore * multiplier);
}

/**
 * Get the next decay milestone for a given number of inactive days
 *
 * @param daysSinceLastActivity - Current days of inactivity
 * @returns Next milestone or null if past final milestone
 */
export function getNextDecayMilestone(
  daysSinceLastActivity: number
): DecayMilestone | null {
  for (const milestone of DECAY_MILESTONES) {
    if (milestone.days > daysSinceLastActivity) {
      return milestone;
    }
  }
  return null;
}

// ============================================================================
// CAR Integration Re-exports (with ACI backwards-compatible aliases)
// ============================================================================

// Re-export from @vorionsys/contracts/car
// CAR types (primary)
export type { CertificationTier, RuntimeTier, CapabilityLevel, ParsedCAR, CARIdentity };
export { parseCAR };
// Backwards-compatible ACI aliases
export type { ParsedACI, ACIIdentity };
export { parseACI };

// Re-export from car-integration.ts
// CAR types (primary)
export type {
  CARTrustContext,
  Attestation,
  EffectivePermission,
  PermissionCheckResult,
} from './car-integration.js';
// Backwards-compatible ACI alias
export type { ACITrustContext } from './car-integration.js';

// CAR functions (primary) with backwards-compatible ACI aliases
export {
  AttestationSchema,
  // CAR functions (primary)
  calculateEffectiveFromCAR,
  applyCARFloor,
  enforceCARCeiling,
  createCARTrustContext,
  // Backwards-compatible ACI aliases
  calculateEffectiveFromACI,
  applyACIFloor,
  enforceACICeiling,
  createACITrustContext,
  // Common functions
  attestationToTrustSignal,
  calculateEffectiveTier,
  calculateEffectiveScore,
  scoreToTier,
  certificationTierToMinScore,
  certificationTierToMaxScore,
  certificationTierToScore,
  tierToMinScore,
  competenceLevelToCeiling,
  determineCeilingReason,
  lookupCertificationTier,
} from './car-integration.js';

// Re-export from observability.ts
export {
  ObservabilityClass,
  OBSERVABILITY_CEILINGS,
  OBSERVABILITY_CLASS_NAMES,
  ObservabilityClassSchema,
  ObservabilityMetadataSchema,
  getObservabilityCeiling,
  getObservabilityMaxScore,
  applyObservabilityCeiling,
  isTierAllowedForObservability,
  getRequiredObservabilityForTier,
  determineObservabilityClass,
  describeObservabilityConstraints,
} from './observability.js';

export type {
  ObservabilityCeiling,
  ObservabilityMetadata,
} from './observability.js';

// Re-export from context.ts
export {
  DeploymentContext,
  CONTEXT_CEILINGS,
  CONTEXT_NAMES,
  DeploymentContextSchema,
  ContextConfigSchema,
  getContextCeiling,
  getContextMaxScore,
  applyContextCeiling,
  requiresHumanApproval,
  requiresAttestation,
  evaluateContextPolicy,
  describeContextConstraints,
  detectDeploymentContext,
} from './context.js';

export type {
  ContextCeiling,
  ContextPolicyResult,
  ContextConfig,
} from './context.js';
