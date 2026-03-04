/**
 * Policy Simulator
 *
 * Simulates policy impact against historical data before activation.
 * Implements FR146-147 for Epic 4.
 *
 * Features:
 * - Run policies against historical intents
 * - Calculate impact percentages
 * - Identify affected agents
 * - Provide detailed simulation reports
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { intentRegistry } from '../../intent/metrics.js';
import type { ID, ControlAction, TrustLevel } from '../../common/types.js';
import type { PolicyDefinition, PolicyEvaluationContext, PolicyEvaluationResult } from '../types.js';

const logger = createLogger({ component: 'policy-simulator' });

// =============================================================================
// Metrics
// =============================================================================

const simulationsRun = new Counter({
  name: 'vorion_policy_simulations_total',
  help: 'Total policy simulations run',
  registers: [intentRegistry],
});

const simulationDuration = new Histogram({
  name: 'vorion_policy_simulation_duration_seconds',
  help: 'Time to run a policy simulation',
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [intentRegistry],
});

const activeSimulations = new Gauge({
  name: 'vorion_active_policy_simulations',
  help: 'Currently running policy simulations',
  registers: [intentRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Historical intent for simulation
 */
export interface HistoricalIntent {
  id: ID;
  action: string;
  resource: string;
  category?: string;
  parameters?: Record<string, unknown>;
  entityId: ID;
  entityType: string;
  trustScore: number;
  trustLevel: number;
  originalDecision: ControlAction;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Simulation result for a single intent
 */
export interface IntentSimulationResult {
  intentId: ID;
  originalDecision: ControlAction;
  simulatedDecision: ControlAction;
  changed: boolean;
  matchedRuleId?: string;
  matchedRuleName?: string;
  reason?: string;
}

/**
 * Impact summary by action type
 */
export interface ActionImpact {
  action: ControlAction;
  originalCount: number;
  simulatedCount: number;
  delta: number;
  deltaPercent: number;
}

/**
 * Impact by entity/agent
 */
export interface EntityImpact {
  entityId: ID;
  entityType: string;
  affectedIntents: number;
  changedDecisions: number;
  trustLevel: number;
}

/**
 * Complete simulation report
 */
export interface SimulationReport {
  /** Unique simulation ID */
  simulationId: string;
  /** Policy that was simulated */
  policyName: string;
  /** Time range of historical data */
  timeRange: {
    start: string;
    end: string;
  };
  /** Total intents evaluated */
  totalIntents: number;
  /** Intents with changed decisions */
  changedDecisions: number;
  /** Change percentage */
  changePercent: number;
  /** Impact breakdown by action type */
  actionImpact: ActionImpact[];
  /** Top affected entities */
  topAffectedEntities: EntityImpact[];
  /** Sample of changed decisions */
  sampleChanges: IntentSimulationResult[];
  /** Duration of simulation */
  durationMs: number;
  /** Timestamp */
  simulatedAt: string;
  /** Warnings or notes */
  warnings: string[];
}

/**
 * Simulation options
 */
export interface SimulationOptions {
  /** Policy to simulate */
  policy: PolicyDefinition;
  /** Policy name for reporting */
  policyName: string;
  /** Tenant ID */
  tenantId: ID;
  /** Time range for historical data (default: 30 days) */
  daysBack?: number;
  /** Maximum intents to evaluate (default: 10000) */
  maxIntents?: number;
  /** Include detailed per-intent results */
  includeDetails?: boolean;
}

/**
 * Impact analysis summary
 */
export interface ImpactAnalysis {
  /** Overall impact level */
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Impact description */
  description: string;
  /** Estimated affected intents per day */
  estimatedDailyImpact: number;
  /** Key risk factors */
  riskFactors: string[];
  /** Recommendations */
  recommendations: string[];
  /** Requires confirmation before activation? */
  requiresConfirmation: boolean;
}

// =============================================================================
// Policy Simulator
// =============================================================================

/**
 * Policy Simulator Service
 *
 * Simulates policy effects against historical intent data.
 */
export class PolicySimulator {
  private evaluator: PolicyEvaluator;

  constructor(evaluator?: PolicyEvaluator) {
    this.evaluator = evaluator ?? new SimpleEvaluator();
  }

  /**
   * Run a policy simulation against historical data
   */
  async simulate(
    options: SimulationOptions,
    historicalData: HistoricalIntent[]
  ): Promise<SimulationReport> {
    const startTime = Date.now();
    const simulationId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    activeSimulations.inc();
    simulationsRun.inc();

    try {
      logger.info({
        simulationId,
        policyName: options.policyName,
        intentCount: historicalData.length,
      }, 'Starting policy simulation');

      const results: IntentSimulationResult[] = [];
      const entityImpactMap = new Map<ID, EntityImpact>();
      const actionCounts = {
        original: new Map<ControlAction, number>(),
        simulated: new Map<ControlAction, number>(),
      };
      const warnings: string[] = [];

      // Process each historical intent
      for (const intent of historicalData) {
        const context = this.buildContext(intent);
        const evalResult = await this.evaluator.evaluate(options.policy, context);

        const simulatedDecision = evalResult.action;
        const changed = intent.originalDecision !== simulatedDecision;

        // Track action counts
        actionCounts.original.set(
          intent.originalDecision,
          (actionCounts.original.get(intent.originalDecision) ?? 0) + 1
        );
        actionCounts.simulated.set(
          simulatedDecision,
          (actionCounts.simulated.get(simulatedDecision) ?? 0) + 1
        );

        // Track entity impact
        if (changed) {
          const existing = entityImpactMap.get(intent.entityId);
          if (existing) {
            existing.affectedIntents++;
            existing.changedDecisions++;
          } else {
            entityImpactMap.set(intent.entityId, {
              entityId: intent.entityId,
              entityType: intent.entityType,
              affectedIntents: 1,
              changedDecisions: 1,
              trustLevel: intent.trustLevel,
            });
          }
        }

        results.push({
          intentId: intent.id,
          originalDecision: intent.originalDecision,
          simulatedDecision,
          changed,
          matchedRuleId: evalResult.matchedRules[0]?.ruleId,
          matchedRuleName: evalResult.matchedRules[0]?.ruleName,
          reason: evalResult.reason,
        });
      }

      // Calculate action impact
      const allActions: ControlAction[] = ['allow', 'deny', 'escalate', 'constrain'];
      const actionImpact: ActionImpact[] = allActions.map(action => {
        const originalCount = actionCounts.original.get(action) ?? 0;
        const simulatedCount = actionCounts.simulated.get(action) ?? 0;
        const delta = simulatedCount - originalCount;
        const deltaPercent = originalCount > 0 ? (delta / originalCount) * 100 : (simulatedCount > 0 ? 100 : 0);

        return {
          action,
          originalCount,
          simulatedCount,
          delta,
          deltaPercent: Math.round(deltaPercent * 10) / 10,
        };
      });

      // Get top affected entities
      const topAffectedEntities = Array.from(entityImpactMap.values())
        .sort((a, b) => b.changedDecisions - a.changedDecisions)
        .slice(0, 10);

      // Get sample of changed decisions
      const changedResults = results.filter(r => r.changed);
      const sampleChanges = changedResults.slice(0, 20);

      // Generate warnings
      const changePercent = (changedResults.length / historicalData.length) * 100;
      if (changePercent > 50) {
        warnings.push(`High impact: ${Math.round(changePercent)}% of intents would have different decisions`);
      }

      const denyIncrease = actionImpact.find(a => a.action === 'deny');
      if (denyIncrease && denyIncrease.deltaPercent > 20) {
        warnings.push(`Significant increase in denials: +${denyIncrease.deltaPercent}%`);
      }

      // Calculate time range
      const timestamps = historicalData.map(i => new Date(i.timestamp).getTime());
      const timeRange = {
        start: new Date(Math.min(...timestamps)).toISOString(),
        end: new Date(Math.max(...timestamps)).toISOString(),
      };

      const durationMs = Date.now() - startTime;
      simulationDuration.observe(durationMs / 1000);

      const report: SimulationReport = {
        simulationId,
        policyName: options.policyName,
        timeRange,
        totalIntents: historicalData.length,
        changedDecisions: changedResults.length,
        changePercent: Math.round(changePercent * 10) / 10,
        actionImpact,
        topAffectedEntities,
        sampleChanges,
        durationMs,
        simulatedAt: new Date().toISOString(),
        warnings,
      };

      logger.info({
        simulationId,
        totalIntents: report.totalIntents,
        changedDecisions: report.changedDecisions,
        changePercent: report.changePercent,
        durationMs,
      }, 'Policy simulation completed');

      return report;
    } finally {
      activeSimulations.dec();
    }
  }

  /**
   * Analyze impact and generate recommendations
   */
  analyzeImpact(report: SimulationReport): ImpactAnalysis {
    const riskFactors: string[] = [];
    const recommendations: string[] = [];

    // Determine impact level
    let impactLevel: ImpactAnalysis['impactLevel'] = 'low';

    if (report.changePercent > 50) {
      impactLevel = 'critical';
      riskFactors.push('Over half of intents would be affected');
    } else if (report.changePercent > 20) {
      impactLevel = 'high';
      riskFactors.push('Significant portion of intents affected');
    } else if (report.changePercent > 5) {
      impactLevel = 'medium';
    }

    // Check for denial increases
    const denyImpact = report.actionImpact.find(a => a.action === 'deny');
    if (denyImpact && denyImpact.deltaPercent > 30) {
      impactLevel = 'high';
      riskFactors.push(`${Math.abs(denyImpact.deltaPercent)}% increase in denials`);
      recommendations.push('Consider a gradual rollout or phased implementation');
    }

    // Check for escalation increases
    const escalateImpact = report.actionImpact.find(a => a.action === 'escalate');
    if (escalateImpact && escalateImpact.deltaPercent > 50) {
      riskFactors.push(`${Math.abs(escalateImpact.deltaPercent)}% increase in escalations`);
      recommendations.push('Ensure sufficient reviewer capacity before activation');
    }

    // Check high-trust entities affected
    const highTrustAffected = report.topAffectedEntities.filter(e => e.trustLevel >= 5);
    if (highTrustAffected.length > 0) {
      riskFactors.push(`${highTrustAffected.length} high-trust entities affected`);
      recommendations.push('Review impact on trusted agents before proceeding');
    }

    // Generate description
    let description = `This policy would affect ${report.changePercent}% of intents based on the last ${report.totalIntents} historical actions.`;

    if (report.changedDecisions === 0) {
      description = 'This policy would not change any decisions based on historical data.';
      recommendations.push('Policy may be redundant or too narrow - verify it matches intended behavior');
    }

    // Calculate estimated daily impact
    const daysCovered = Math.max(1, Math.ceil(
      (new Date(report.timeRange.end).getTime() - new Date(report.timeRange.start).getTime()) / (1000 * 60 * 60 * 24)
    ));
    const estimatedDailyImpact = Math.round(report.changedDecisions / daysCovered);

    // Add general recommendations
    if (impactLevel === 'low' && recommendations.length === 0) {
      recommendations.push('Low impact - safe to activate with standard monitoring');
    }

    if (impactLevel === 'critical') {
      recommendations.push('Consider starting with a subset of entities or actions');
      recommendations.push('Implement with a feature flag for quick rollback');
    }

    return {
      impactLevel,
      description,
      estimatedDailyImpact,
      riskFactors,
      recommendations,
      requiresConfirmation: impactLevel === 'high' || impactLevel === 'critical',
    };
  }

  /**
   * Build evaluation context from historical intent
   */
  private buildContext(intent: HistoricalIntent): PolicyEvaluationContext {
    return {
      intent: {
        id: intent.id,
        tenantId: '', // Not needed for simulation
        entityId: intent.entityId,
        goal: intent.action, // Map action to goal
        context: {
          resource: intent.resource,
          ...(intent.parameters ?? {}),
        },
        status: 'completed',
        metadata: intent.metadata ?? {},
        createdAt: intent.timestamp,
        updatedAt: intent.timestamp,
      },
      entity: {
        id: intent.entityId,
        type: intent.entityType,
        trustScore: intent.trustScore,
        trustLevel: intent.trustLevel as TrustLevel,
        attributes: {},
      },
      environment: {
        timestamp: intent.timestamp,
        timezone: 'UTC',
        requestId: intent.id,
      },
    };
  }
}

// =============================================================================
// Simple Evaluator (for simulation without full policy service)
// =============================================================================

interface PolicyEvaluator {
  evaluate(policy: PolicyDefinition, context: PolicyEvaluationContext): Promise<PolicyEvaluationResult>;
}

class SimpleEvaluator implements PolicyEvaluator {
  async evaluate(policy: PolicyDefinition, context: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
    const startTime = Date.now();
    const rulesEvaluated = [];
    const matchedRules = [];

    // Sort rules by priority
    const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (!rule.enabled) continue;

      const matched = this.evaluateCondition(rule.when, context);

      rulesEvaluated.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched,
        conditionsMet: matched,
        action: rule.then.action,
        reason: rule.then.reason,
        durationMs: 0,
      });

      if (matched) {
        matchedRules.push(rulesEvaluated[rulesEvaluated.length - 1]);
      }
    }

    // Determine final action from first matched rule or default
    const firstMatch = matchedRules[0];
    const action = firstMatch?.action ?? policy.defaultAction;
    const reason = firstMatch?.reason ?? policy.defaultReason;

    return {
      policyId: 'simulation',
      policyName: 'Simulation',
      policyVersion: 1,
      matched: matchedRules.length > 0,
      action,
      reason,
      rulesEvaluated,
      matchedRules,
      durationMs: Date.now() - startTime,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private evaluateCondition(condition: any, context: PolicyEvaluationContext): boolean {
    if (condition.type === 'compound') {
      const results = condition.conditions.map((c: any) => this.evaluateCondition(c, context));

      if (condition.operator === 'and') {
        return results.every((r: boolean) => r);
      } else if (condition.operator === 'or') {
        return results.some((r: boolean) => r);
      } else if (condition.operator === 'not') {
        return !results[0];
      }
      return false;
    }

    if (condition.type === 'trust') {
      const trustLevel = context.entity.trustLevel;
      const threshold = condition.level;

      switch (condition.operator) {
        case 'equals': return trustLevel === threshold;
        case 'greater_than': return trustLevel > threshold;
        case 'less_than': return trustLevel < threshold;
        case 'greater_than_or_equal': return trustLevel >= threshold;
        case 'less_than_or_equal': return trustLevel <= threshold;
        default: return false;
      }
    }

    if (condition.type === 'time') {
      const now = new Date(context.environment.timestamp);

      let fieldValue: number;
      switch (condition.field) {
        case 'hour': fieldValue = now.getHours(); break;
        case 'dayOfWeek': fieldValue = now.getDay(); break;
        default: return false;
      }

      return this.compareValues(fieldValue, condition.operator, condition.value);
    }

    // Field condition
    const fieldValue = this.getFieldValue(condition.field, context);
    return this.compareValues(fieldValue, condition.operator, condition.value);
  }

  private getFieldValue(path: string, context: PolicyEvaluationContext): unknown {
    const parts = path.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }

    return value;
  }

  private compareValues(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'not_equals':
        return actual !== expected;
      case 'greater_than':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'less_than':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case 'greater_than_or_equal':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      case 'less_than_or_equal':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(actual);
      case 'contains':
        return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
      case 'not_contains':
        return typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected);
      case 'starts_with':
        return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
      case 'ends_with':
        return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
      case 'matches':
        return typeof actual === 'string' && typeof expected === 'string' && new RegExp(expected).test(actual);
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'not_exists':
        return actual === undefined || actual === null;
      default:
        return false;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a policy simulator instance
 */
export function createPolicySimulator(): PolicySimulator {
  return new PolicySimulator();
}
