/**
 * Decision Aggregator
 *
 * Aggregates decisions from multiple policy sources with:
 * - Conflict resolution strategies
 * - Decision audit trail
 * - Source weighting
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { withSpan, type TraceSpan } from '../common/trace.js';
import { secureRandomString } from '../common/random.js';
import type {
  Intent,
  ControlAction,
  ID,
  Timestamp,
  TrustLevel,
  TrustScore,
  Decision,
} from '../common/types.js';

const logger = createLogger({ component: 'decision-aggregator' });

// =============================================================================
// DECISION SOURCE TYPES
// =============================================================================

/**
 * Decision source types
 */
export type DecisionSourceType =
  | 'policy-engine'
  | 'constraint-evaluator'
  | 'escalation-engine'
  | 'governance-engine'
  | 'external'
  | 'override';

/**
 * Source-specific decision
 */
export interface SourceDecision {
  /** Source identifier */
  sourceId: ID;
  /** Source type */
  sourceType: DecisionSourceType;
  /** Source name */
  sourceName: string;
  /** The decision action */
  action: ControlAction;
  /** Decision confidence (0-1) */
  confidence: number;
  /** Decision weight for aggregation */
  weight: number;
  /** Reason for decision */
  reason: string;
  /** Additional details */
  details?: Record<string, unknown>;
  /** Constraints to apply if action is 'limit' */
  constraints?: string[];
  /** Decision timestamp */
  decidedAt: Timestamp;
  /** Evaluation duration */
  durationMs?: number;
}

/**
 * Conflict resolution strategies
 */
export type ConflictStrategy =
  | 'deny-overrides'      // Any deny wins
  | 'allow-overrides'     // Any allow wins
  | 'most-restrictive'    // Most restrictive action wins
  | 'least-restrictive'   // Least restrictive action wins
  | 'weighted-average'    // Weighted by confidence and source weight
  | 'unanimous-allow'     // All must allow
  | 'majority-rules'      // Majority decision wins
  | 'priority-based';     // Highest priority source wins

/**
 * Action restrictiveness order (higher index = more restrictive)
 */
const ACTION_RESTRICTIVENESS: ControlAction[] = [
  'allow',
  'monitor',
  'limit',
  'escalate',
  'terminate',
  'deny',
];

// =============================================================================
// AGGREGATION RESULT
// =============================================================================

/**
 * Aggregated decision result
 */
export interface AggregatedDecision {
  /** Final action */
  action: ControlAction;
  /** Aggregation confidence (0-1) */
  confidence: number;
  /** Source decisions that contributed */
  sourceDecisions: SourceDecision[];
  /** Which sources agreed with final decision */
  agreingSources: ID[];
  /** Which sources disagreed with final decision */
  disagreingSources: ID[];
  /** Conflict resolution details */
  conflictResolution?: ConflictResolutionDetails;
  /** Combined constraints from all sources */
  appliedConstraints: string[];
  /** Combined reasons */
  reasons: string[];
  /** Aggregation timestamp */
  aggregatedAt: Timestamp;
  /** Total aggregation duration */
  durationMs: number;
}

/**
 * Details about conflict resolution
 */
export interface ConflictResolutionDetails {
  /** Strategy used */
  strategy: ConflictStrategy;
  /** Whether there was a conflict */
  hadConflict: boolean;
  /** Conflicting actions */
  conflictingActions: ControlAction[];
  /** How the conflict was resolved */
  resolutionReason: string;
}

// =============================================================================
// AUDIT TRAIL
// =============================================================================

/**
 * Audit trail entry
 */
export interface AuditEntry {
  /** Unique audit entry ID */
  id: ID;
  /** Intent ID */
  intentId: ID;
  /** Tenant ID */
  tenantId: ID;
  /** Entity ID */
  entityId: ID;
  /** Final decision */
  decision: AggregatedDecision;
  /** Trust score at decision time */
  trustScore: TrustScore;
  /** Trust level at decision time */
  trustLevel: TrustLevel;
  /** Request context snapshot */
  contextSnapshot: Record<string, unknown>;
  /** Audit timestamp */
  timestamp: Timestamp;
  /** Audit metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Audit query options
 */
export interface AuditQueryOptions {
  /** Filter by intent ID */
  intentId?: ID;
  /** Filter by entity ID */
  entityId?: ID;
  /** Filter by tenant ID */
  tenantId?: ID;
  /** Filter by action */
  action?: ControlAction;
  /** Filter by source type */
  sourceType?: DecisionSourceType;
  /** Start time */
  startTime?: Timestamp;
  /** End time */
  endTime?: Timestamp;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// DECISION AGGREGATOR OPTIONS
// =============================================================================

/**
 * Decision aggregator options
 */
export interface DecisionAggregatorOptions {
  /** Default conflict resolution strategy */
  defaultStrategy?: ConflictStrategy;
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Enable audit trail */
  enableAudit?: boolean;
  /** Maximum audit entries to keep in memory */
  maxAuditEntries?: number;
  /** Source priority map (for priority-based strategy) */
  sourcePriorities?: Map<DecisionSourceType, number>;
  /** Default source weights */
  defaultWeights?: Map<DecisionSourceType, number>;
  /** Minimum confidence threshold to include decision */
  minConfidenceThreshold?: number;
}

// =============================================================================
// DECISION CONTEXT
// =============================================================================

/**
 * Context for decision aggregation
 */
export interface AggregationContext {
  /** The intent */
  intent: Intent;
  /** Trust score */
  trustScore: TrustScore;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Additional context */
  context?: Record<string, unknown>;
}

// =============================================================================
// DECISION AGGREGATOR
// =============================================================================

/**
 * DecisionAggregator class for combining decisions from multiple sources
 */
export class DecisionAggregator {
  private options: Required<DecisionAggregatorOptions>;
  private auditTrail: AuditEntry[] = [];
  private sourcePriorities: Map<DecisionSourceType, number>;
  private sourceWeights: Map<DecisionSourceType, number>;

  constructor(options: DecisionAggregatorOptions = {}) {
    this.options = {
      defaultStrategy: options.defaultStrategy ?? 'deny-overrides',
      enableTracing: options.enableTracing ?? true,
      enableAudit: options.enableAudit ?? true,
      maxAuditEntries: options.maxAuditEntries ?? 10000,
      sourcePriorities: options.sourcePriorities ?? new Map(),
      defaultWeights: options.defaultWeights ?? new Map(),
      minConfidenceThreshold: options.minConfidenceThreshold ?? 0,
    };

    // Initialize default priorities (lower = higher priority)
    this.sourcePriorities = new Map([
      ['override', 0],
      ['escalation-engine', 10],
      ['policy-engine', 20],
      ['constraint-evaluator', 30],
      ['governance-engine', 40],
      ['external', 50],
      ...this.options.sourcePriorities,
    ]);

    // Initialize default weights
    this.sourceWeights = new Map([
      ['override', 1.0],
      ['escalation-engine', 0.9],
      ['policy-engine', 0.8],
      ['constraint-evaluator', 0.7],
      ['governance-engine', 0.7],
      ['external', 0.5],
      ...this.options.defaultWeights,
    ]);

    logger.info({
      defaultStrategy: this.options.defaultStrategy,
      enableAudit: this.options.enableAudit,
    }, 'Decision aggregator initialized');
  }

  /**
   * Aggregate decisions from multiple sources
   */
  aggregate(
    decisions: SourceDecision[],
    context: AggregationContext,
    strategy?: ConflictStrategy
  ): AggregatedDecision {
    const startTime = performance.now();
    const effectiveStrategy = strategy ?? this.options.defaultStrategy;

    // Filter by confidence threshold
    const validDecisions = decisions.filter(
      d => d.confidence >= this.options.minConfidenceThreshold
    );

    if (validDecisions.length === 0) {
      return this.createEmptyDecision(startTime);
    }

    // Apply default weights if not specified
    const weightedDecisions = validDecisions.map(d => ({
      ...d,
      weight: d.weight > 0 ? d.weight : (this.sourceWeights.get(d.sourceType) ?? 1.0),
    }));

    // Check for conflicts
    const uniqueActions = [...new Set(weightedDecisions.map(d => d.action))];
    const hasConflict = uniqueActions.length > 1;

    // Resolve to final action
    const { action, confidence, resolutionReason } = this.resolveConflict(
      weightedDecisions,
      effectiveStrategy
    );

    // Categorize sources
    const agreingSources = weightedDecisions
      .filter(d => d.action === action)
      .map(d => d.sourceId);
    const disagreingSources = weightedDecisions
      .filter(d => d.action !== action)
      .map(d => d.sourceId);

    // Collect constraints
    const appliedConstraints = this.collectConstraints(weightedDecisions, action);

    // Collect reasons
    const reasons = weightedDecisions.map(d => `[${d.sourceName}] ${d.reason}`);

    const durationMs = performance.now() - startTime;

    const result: AggregatedDecision = {
      action,
      confidence,
      sourceDecisions: weightedDecisions,
      agreingSources,
      disagreingSources,
      conflictResolution: hasConflict ? {
        strategy: effectiveStrategy,
        hadConflict: true,
        conflictingActions: uniqueActions,
        resolutionReason,
      } : undefined,
      appliedConstraints,
      reasons,
      aggregatedAt: new Date().toISOString(),
      durationMs,
    };

    // Record audit
    if (this.options.enableAudit) {
      this.recordAudit(context, result);
    }

    logger.info({
      intentId: context.intent.id,
      action,
      confidence,
      sourcesCount: validDecisions.length,
      hadConflict: hasConflict,
      strategy: effectiveStrategy,
      durationMs,
    }, 'Decision aggregated');

    return result;
  }

  /**
   * Aggregate with OpenTelemetry tracing
   */
  async aggregateWithTracing(
    decisions: SourceDecision[],
    context: AggregationContext,
    strategy?: ConflictStrategy
  ): Promise<AggregatedDecision> {
    if (!this.options.enableTracing) {
      return this.aggregate(decisions, context, strategy);
    }

    return withSpan(
      'enforce.aggregateDecisions',
      async (span: TraceSpan) => {
        span.attributes['intent.id'] = context.intent.id;
        span.attributes['sources.count'] = decisions.length;
        span.attributes['strategy'] = strategy ?? this.options.defaultStrategy;

        const result = this.aggregate(decisions, context, strategy);

        span.attributes['result.action'] = result.action;
        span.attributes['result.confidence'] = result.confidence;
        span.attributes['result.hadConflict'] = result.conflictResolution?.hadConflict ?? false;

        return result;
      },
      { 'tenant.id': context.intent.tenantId }
    );
  }

  /**
   * Convert aggregated decision to standard Decision type
   */
  toDecision(
    aggregated: AggregatedDecision,
    context: AggregationContext
  ): Decision {
    return {
      intentId: context.intent.id,
      action: aggregated.action,
      constraintsEvaluated: aggregated.sourceDecisions.map(d => ({
        constraintId: d.sourceId,
        passed: d.action === aggregated.action,
        action: d.action,
        reason: d.reason,
        details: d.details ?? {},
        durationMs: d.durationMs ?? 0,
        evaluatedAt: d.decidedAt,
      })),
      trustScore: context.trustScore,
      trustLevel: context.trustLevel,
      decidedAt: aggregated.aggregatedAt,
    };
  }

  /**
   * Resolve conflict between decisions
   */
  private resolveConflict(
    decisions: SourceDecision[],
    strategy: ConflictStrategy
  ): { action: ControlAction; confidence: number; resolutionReason: string } {
    switch (strategy) {
      case 'deny-overrides':
        return this.resolveDenyOverrides(decisions);

      case 'allow-overrides':
        return this.resolveAllowOverrides(decisions);

      case 'most-restrictive':
        return this.resolveMostRestrictive(decisions);

      case 'least-restrictive':
        return this.resolveLeastRestrictive(decisions);

      case 'weighted-average':
        return this.resolveWeightedAverage(decisions);

      case 'unanimous-allow':
        return this.resolveUnanimousAllow(decisions);

      case 'majority-rules':
        return this.resolveMajorityRules(decisions);

      case 'priority-based':
        return this.resolvePriorityBased(decisions);

      default:
        return this.resolveDenyOverrides(decisions);
    }
  }

  private resolveDenyOverrides(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    const denyDecision = decisions.find(d => d.action === 'deny');
    if (denyDecision) {
      return {
        action: 'deny',
        confidence: denyDecision.confidence,
        resolutionReason: `Deny from ${denyDecision.sourceName} overrides all`,
      };
    }

    // Find most common non-deny action
    const actions = decisions.map(d => d.action);
    const actionCounts = new Map<ControlAction, number>();
    for (const action of actions) {
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }

    let maxAction: ControlAction = 'allow';
    let maxCount = 0;
    for (const [action, count] of actionCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxAction = action;
      }
    }

    const avgConfidence = decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length;

    return {
      action: maxAction,
      confidence: avgConfidence,
      resolutionReason: 'No deny decisions; using most common action',
    };
  }

  private resolveAllowOverrides(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    const allowDecision = decisions.find(d => d.action === 'allow');
    if (allowDecision) {
      return {
        action: 'allow',
        confidence: allowDecision.confidence,
        resolutionReason: `Allow from ${allowDecision.sourceName} overrides all`,
      };
    }

    // Find least restrictive
    return this.resolveLeastRestrictive(decisions);
  }

  private resolveMostRestrictive(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    let mostRestrictive: SourceDecision = decisions[0]!;
    let maxIndex = ACTION_RESTRICTIVENESS.indexOf(mostRestrictive.action);

    for (const decision of decisions.slice(1)) {
      const index = ACTION_RESTRICTIVENESS.indexOf(decision.action);
      if (index > maxIndex) {
        maxIndex = index;
        mostRestrictive = decision;
      }
    }

    return {
      action: mostRestrictive.action,
      confidence: mostRestrictive.confidence,
      resolutionReason: `Most restrictive action from ${mostRestrictive.sourceName}`,
    };
  }

  private resolveLeastRestrictive(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    let leastRestrictive: SourceDecision = decisions[0]!;
    let minIndex = ACTION_RESTRICTIVENESS.indexOf(leastRestrictive.action);

    for (const decision of decisions.slice(1)) {
      const index = ACTION_RESTRICTIVENESS.indexOf(decision.action);
      if (index < minIndex) {
        minIndex = index;
        leastRestrictive = decision;
      }
    }

    return {
      action: leastRestrictive.action,
      confidence: leastRestrictive.confidence,
      resolutionReason: `Least restrictive action from ${leastRestrictive.sourceName}`,
    };
  }

  private resolveWeightedAverage(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    // Calculate weighted score for each action
    const actionScores = new Map<ControlAction, number>();
    let totalWeight = 0;

    for (const decision of decisions) {
      const score = decision.confidence * decision.weight;
      const current = actionScores.get(decision.action) ?? 0;
      actionScores.set(decision.action, current + score);
      totalWeight += decision.weight;
    }

    // Find action with highest weighted score
    let bestAction: ControlAction = 'deny';
    let bestScore = -1;

    for (const [action, score] of actionScores) {
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    const confidence = totalWeight > 0 ? bestScore / totalWeight : 0;

    return {
      action: bestAction,
      confidence: Math.min(1, confidence),
      resolutionReason: `Weighted average favors ${bestAction}`,
    };
  }

  private resolveUnanimousAllow(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    const allAllow = decisions.every(d => d.action === 'allow');
    if (allAllow) {
      const avgConfidence = decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length;
      return {
        action: 'allow',
        confidence: avgConfidence,
        resolutionReason: 'All sources unanimously allow',
      };
    }

    // Find most restrictive non-allow
    const nonAllow = decisions.filter(d => d.action !== 'allow');
    return this.resolveMostRestrictive(nonAllow.length > 0 ? nonAllow : decisions);
  }

  private resolveMajorityRules(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    // Count votes for each action
    const votes = new Map<ControlAction, number>();
    for (const decision of decisions) {
      votes.set(decision.action, (votes.get(decision.action) ?? 0) + 1);
    }

    // Find majority
    const threshold = decisions.length / 2;
    let majorityAction: ControlAction | null = null;
    let maxVotes = 0;

    for (const [action, count] of votes) {
      if (count > threshold && count > maxVotes) {
        maxVotes = count;
        majorityAction = action;
      }
    }

    if (majorityAction) {
      const majorityDecisions = decisions.filter(d => d.action === majorityAction);
      const avgConfidence = majorityDecisions.reduce((sum, d) => sum + d.confidence, 0) / majorityDecisions.length;

      return {
        action: majorityAction,
        confidence: avgConfidence,
        resolutionReason: `Majority (${maxVotes}/${decisions.length}) voted ${majorityAction}`,
      };
    }

    // No majority - fall back to most restrictive
    return {
      ...this.resolveMostRestrictive(decisions),
      resolutionReason: 'No majority; using most restrictive action',
    };
  }

  private resolvePriorityBased(decisions: SourceDecision[]): { action: ControlAction; confidence: number; resolutionReason: string } {
    // Sort by source priority (lower = higher priority)
    const sorted = [...decisions].sort((a, b) => {
      const priorityA = this.sourcePriorities.get(a.sourceType) ?? 100;
      const priorityB = this.sourcePriorities.get(b.sourceType) ?? 100;
      return priorityA - priorityB;
    });

    const highest = sorted[0]!;

    return {
      action: highest.action,
      confidence: highest.confidence,
      resolutionReason: `Highest priority source ${highest.sourceName} decides`,
    };
  }

  /**
   * Collect constraints from decisions based on final action
   */
  private collectConstraints(decisions: SourceDecision[], finalAction: ControlAction): string[] {
    const constraints: Set<string> = new Set();

    for (const decision of decisions) {
      // Include constraints if decision agrees with final action or is 'limit'
      if (decision.action === finalAction || decision.action === 'limit') {
        if (decision.constraints) {
          for (const constraint of decision.constraints) {
            constraints.add(constraint);
          }
        }
      }
    }

    return Array.from(constraints);
  }

  /**
   * Create empty decision when no valid sources
   */
  private createEmptyDecision(startTime: number): AggregatedDecision {
    return {
      action: 'deny',
      confidence: 0,
      sourceDecisions: [],
      agreingSources: [],
      disagreingSources: [],
      appliedConstraints: [],
      reasons: ['No valid decision sources'],
      aggregatedAt: new Date().toISOString(),
      durationMs: performance.now() - startTime,
    };
  }

  // =============================================================================
  // AUDIT TRAIL
  // =============================================================================

  /**
   * Record audit entry
   */
  private recordAudit(context: AggregationContext, decision: AggregatedDecision): void {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${secureRandomString(9)}`,
      intentId: context.intent.id,
      tenantId: context.intent.tenantId,
      entityId: context.intent.entityId,
      decision,
      trustScore: context.trustScore,
      trustLevel: context.trustLevel,
      contextSnapshot: context.context ?? {},
      timestamp: new Date().toISOString(),
    };

    this.auditTrail.push(entry);

    // Trim if exceeds max
    if (this.auditTrail.length > this.options.maxAuditEntries) {
      this.auditTrail.splice(0, this.auditTrail.length - this.options.maxAuditEntries);
    }

    logger.debug({ auditId: entry.id, intentId: entry.intentId }, 'Audit entry recorded');
  }

  /**
   * Query audit trail
   */
  queryAudit(options: AuditQueryOptions = {}): AuditEntry[] {
    let results = [...this.auditTrail];

    // Apply filters
    if (options.intentId) {
      results = results.filter(e => e.intentId === options.intentId);
    }
    if (options.entityId) {
      results = results.filter(e => e.entityId === options.entityId);
    }
    if (options.tenantId) {
      results = results.filter(e => e.tenantId === options.tenantId);
    }
    if (options.action) {
      results = results.filter(e => e.decision.action === options.action);
    }
    if (options.sourceType) {
      results = results.filter(e =>
        e.decision.sourceDecisions.some(s => s.sourceType === options.sourceType)
      );
    }
    if (options.startTime) {
      const start = new Date(options.startTime).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() >= start);
    }
    if (options.endTime) {
      const end = new Date(options.endTime).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() <= end);
    }

    // Sort by timestamp descending
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get audit entry by ID
   */
  getAuditEntry(auditId: ID): AuditEntry | undefined {
    return this.auditTrail.find(e => e.id === auditId);
  }

  /**
   * Get audit statistics
   */
  getAuditStats(): {
    totalEntries: number;
    byAction: Record<ControlAction, number>;
    bySourceType: Record<string, number>;
    conflictRate: number;
  } {
    const byAction: Record<string, number> = {};
    const bySourceType: Record<string, number> = {};
    let conflictCount = 0;

    for (const entry of this.auditTrail) {
      // Count by action
      const action = entry.decision.action;
      byAction[action] = (byAction[action] ?? 0) + 1;

      // Count by source type
      for (const source of entry.decision.sourceDecisions) {
        bySourceType[source.sourceType] = (bySourceType[source.sourceType] ?? 0) + 1;
      }

      // Count conflicts
      if (entry.decision.conflictResolution?.hadConflict) {
        conflictCount++;
      }
    }

    return {
      totalEntries: this.auditTrail.length,
      byAction: byAction as Record<ControlAction, number>,
      bySourceType,
      conflictRate: this.auditTrail.length > 0
        ? conflictCount / this.auditTrail.length
        : 0,
    };
  }

  /**
   * Clear audit trail
   */
  clearAudit(): void {
    this.auditTrail = [];
    logger.info('Audit trail cleared');
  }

  /**
   * Export audit trail
   */
  exportAudit(): AuditEntry[] {
    return [...this.auditTrail];
  }

  // =============================================================================
  // CONFIGURATION
  // =============================================================================

  /**
   * Set source priority
   */
  setSourcePriority(sourceType: DecisionSourceType, priority: number): void {
    this.sourcePriorities.set(sourceType, priority);
    logger.debug({ sourceType, priority }, 'Source priority updated');
  }

  /**
   * Set source weight
   */
  setSourceWeight(sourceType: DecisionSourceType, weight: number): void {
    this.sourceWeights.set(sourceType, weight);
    logger.debug({ sourceType, weight }, 'Source weight updated');
  }

  /**
   * Get source priorities
   */
  getSourcePriorities(): Map<DecisionSourceType, number> {
    return new Map(this.sourcePriorities);
  }

  /**
   * Get source weights
   */
  getSourceWeights(): Map<DecisionSourceType, number> {
    return new Map(this.sourceWeights);
  }

  /**
   * Get aggregator statistics
   */
  getStats(): {
    auditEntries: number;
    sourcePriorities: [DecisionSourceType, number][];
    sourceWeights: [DecisionSourceType, number][];
    defaultStrategy: ConflictStrategy;
  } {
    return {
      auditEntries: this.auditTrail.length,
      sourcePriorities: Array.from(this.sourcePriorities.entries()),
      sourceWeights: Array.from(this.sourceWeights.entries()),
      defaultStrategy: this.options.defaultStrategy,
    };
  }
}

/**
 * Create a new decision aggregator instance
 */
export function createDecisionAggregator(options?: DecisionAggregatorOptions): DecisionAggregator {
  return new DecisionAggregator(options);
}

/**
 * Create a source decision
 */
export function createSourceDecision(
  partial: Partial<SourceDecision> & Pick<SourceDecision, 'sourceId' | 'sourceType' | 'sourceName' | 'action' | 'reason'>
): SourceDecision {
  return {
    confidence: 1.0,
    weight: 1.0,
    decidedAt: new Date().toISOString(),
    ...partial,
  };
}
