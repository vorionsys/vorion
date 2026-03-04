/**
 * ATSF PolicyEngine Adapter
 *
 * Bridges SecurityPolicyEngine to the IPolicyEngine interface from atsf-core.
 * This allows the SecurityPolicyEngine to be injected into
 * TrustAwareEnforcementService for additional policy evaluation.
 *
 * @packageDocumentation
 */

import type { SecurityPolicyEngine } from './engine.js';
import type { PolicyContext, PolicyDecision, PolicyEvaluationResult, PolicyAction } from './types.js';

// =============================================================================
// IPolicyEngine types (re-declared locally to avoid circular dependency)
// These match the types in atsf-core/enforce/trust-aware-enforcement-service.ts
// =============================================================================

interface PolicyEvaluationInput {
  intent: {
    id: string;
    entityId: string;
    actionType?: string | null;
    dataSensitivity?: string | null;
    reversibility?: string | null;
    resourceScope?: string[] | null;
    [key: string]: unknown;
  };
  trustScore: number;
  trustLevel: number;
  context?: Record<string, unknown>;
}

interface PolicyViolation {
  policyId: string;
  policyName: string;
  action: 'deny' | 'escalate' | 'limit' | 'monitor';
  reason: string;
}

interface IPolicyEngine {
  evaluate(context: PolicyEvaluationInput): PolicyViolation[];
}

// =============================================================================
// MAPPING HELPERS
// =============================================================================

/**
 * Map ATSF dataSensitivity string to SecurityPolicyEngine sensitivityLevel.
 */
function mapSensitivity(
  sensitivity?: string | null,
): 'public' | 'internal' | 'confidential' | 'restricted' | undefined {
  if (!sensitivity) return undefined;
  switch (sensitivity.toUpperCase()) {
    case 'PUBLIC':
      return 'public';
    case 'INTERNAL':
      return 'internal';
    case 'CONFIDENTIAL':
      return 'confidential';
    case 'RESTRICTED':
      return 'restricted';
    default:
      return undefined;
  }
}

/**
 * Derive a violation action from the PolicyAction types produced by SecurityPolicyEngine.
 * Maps the rich action taxonomy to the four IPolicyEngine violation actions.
 */
function mapPolicyActionToViolationAction(
  action: PolicyAction,
): 'deny' | 'escalate' | 'limit' | 'monitor' {
  switch (action.type) {
    case 'deny':
    case 'quarantine':
      return 'deny';
    case 'challenge':
    case 'escalate':
    case 'redirect':
      return 'escalate';
    case 'modify':
      return 'limit';
    case 'notify':
    case 'log':
    case 'allow':
      return 'monitor';
    default:
      return 'monitor';
  }
}

/**
 * Build a human-readable reason string from a PolicyAction.
 */
function actionToReason(action: PolicyAction, policyName: string): string {
  switch (action.type) {
    case 'deny':
      return action.reason;
    case 'challenge':
      return `Policy "${policyName}" requires ${action.method} verification`;
    case 'escalate':
      return `Policy "${policyName}" escalated (severity: ${action.severity})`;
    case 'quarantine':
      return `Policy "${policyName}" quarantined: ${action.reason}`;
    case 'redirect':
      return `Policy "${policyName}" requires redirect`;
    case 'modify':
      return `Policy "${policyName}" requires request modification`;
    case 'notify':
      return `Policy "${policyName}" triggered notification (severity: ${action.severity})`;
    case 'log':
      return `Policy "${policyName}" triggered audit logging`;
    case 'allow':
      return `Policy "${policyName}" explicitly allowed`;
    default:
      return `Policy "${policyName}" triggered action`;
  }
}

// =============================================================================
// ADAPTER
// =============================================================================

/**
 * Adapter that wraps SecurityPolicyEngine to satisfy IPolicyEngine.
 *
 * Since SecurityPolicyEngine.evaluate() is async but IPolicyEngine.evaluate()
 * is sync, this adapter uses a pre-evaluate / cache pattern:
 *
 * 1. Call `preEvaluate(input)` (async) before the synchronous call path.
 * 2. Call `evaluate(input)` (sync) which returns the cached result.
 *
 * The TrustAwareEnforcementService calls `evaluate()` synchronously within
 * its `decide()` flow. To bridge the async gap, call `preEvaluate()` in
 * the integration layer before `decide()`, or use `evaluateAsync()` as a
 * standalone async evaluation path.
 */
export class SecurityPolicyEngineAdapter implements IPolicyEngine {
  private engine: SecurityPolicyEngine;
  private lastResult: PolicyViolation[] = [];

  constructor(engine: SecurityPolicyEngine) {
    this.engine = engine;
  }

  /**
   * Synchronous evaluate -- returns cached violations from the last
   * `preEvaluate()` call.
   *
   * For the TrustAwareEnforcementService integration, call `preEvaluate()`
   * first in the decide() flow, then this returns the cached result.
   */
  evaluate(_input: PolicyEvaluationInput): PolicyViolation[] {
    return this.lastResult;
  }

  /**
   * Async evaluation -- call this before the synchronous `evaluate()`.
   *
   * Converts PolicyEvaluationInput to PolicyContext, runs the engine,
   * caches the result, and returns it.
   */
  async preEvaluate(input: PolicyEvaluationInput): Promise<PolicyViolation[]> {
    const policyContext = this.buildPolicyContext(input);
    const decision = await this.engine.evaluate(policyContext);
    this.lastResult = this.convertDecision(decision);
    return this.lastResult;
  }

  /**
   * Convenience alias for `preEvaluate()` when used outside the
   * synchronous TrustAwareEnforcementService flow.
   */
  async evaluateAsync(input: PolicyEvaluationInput): Promise<PolicyViolation[]> {
    return this.preEvaluate(input);
  }

  // ===========================================================================
  // Context conversion
  // ===========================================================================

  /**
   * Convert PolicyEvaluationInput to PolicyContext.
   */
  private buildPolicyContext(input: PolicyEvaluationInput): PolicyContext {
    const intent = input.intent;
    const now = new Date();

    // Invert trust score (0-1000) to risk score (0-100).
    // High trust = low risk, low trust = high risk.
    const riskScore = Math.round((1 - input.trustScore / 1000) * 100);

    return {
      user: {
        id: intent.entityId,
        riskScore,
        tenant: (input.context?.tenantId as string) ?? undefined,
        attributes: {
          trustLevel: input.trustLevel,
          trustScore: input.trustScore,
        },
      },
      request: {
        id: intent.id,
        method: intent.actionType ?? 'unknown',
        path: `/${(intent.resourceScope as string[] | null)?.[0] ?? 'unknown'}`,
        url: `atsf://intent/${intent.id}`,
        ip: '127.0.0.1', // Internal evaluation -- no real HTTP request
      },
      resource: {
        type: (intent.actionType as string) ?? undefined,
        sensitivityLevel: mapSensitivity(intent.dataSensitivity as string | null),
        classification: (intent.dataSensitivity as string) ?? undefined,
        attributes: {
          reversibility: intent.reversibility,
          resourceScope: intent.resourceScope,
        },
      },
      risk: {
        userRiskScore: riskScore,
        threatLevel: this.trustToThreatLevel(input.trustLevel),
      },
      environment: {
        timestamp: now.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dayOfWeek: now.getDay(),
        hour: now.getHours(),
      },
      custom: {
        source: 'atsf-enforcement',
        ...input.context,
      },
    };
  }

  // ===========================================================================
  // Decision conversion
  // ===========================================================================

  /**
   * Convert PolicyDecision to PolicyViolation[].
   *
   * Only non-"allow" actions from matched policies are surfaced as violations.
   */
  private convertDecision(decision: PolicyDecision): PolicyViolation[] {
    // If allowed with no matched policies, no violations
    if (decision.outcome === 'allow' && decision.matchedPolicies.length === 0) {
      return [];
    }

    const violations: PolicyViolation[] = [];

    // Extract violations from each matched policy's actions
    for (const matched of decision.matchedPolicies) {
      const nonAllowActions = matched.actions.filter(
        (a): a is Exclude<PolicyAction, { type: 'allow' }> => a.type !== 'allow',
      );

      for (const action of nonAllowActions) {
        violations.push({
          policyId: matched.policyId,
          policyName: matched.policyName,
          action: mapPolicyActionToViolationAction(action),
          reason: actionToReason(action, matched.policyName),
        });
      }
    }

    // If overall decision is deny but no specific violations were extracted,
    // add a general denial violation
    if (decision.outcome === 'deny' && violations.length === 0) {
      violations.push({
        policyId: 'security-engine-default',
        policyName: 'Security Policy Engine',
        action: 'deny',
        reason: decision.reason,
      });
    }

    // If decision is challenge/pending but no violations were extracted,
    // add a general escalation violation
    if (
      (decision.outcome === 'challenge' || decision.outcome === 'pending') &&
      violations.length === 0
    ) {
      violations.push({
        policyId: 'security-engine-challenge',
        policyName: 'Security Policy Engine',
        action: 'escalate',
        reason: decision.reason,
      });
    }

    return violations;
  }

  // ===========================================================================
  // Mapping helpers
  // ===========================================================================

  /**
   * Map trust level (0-7) to threat level.
   * Higher trust = lower threat.
   */
  private trustToThreatLevel(
    trustLevel: number,
  ): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (trustLevel >= 6) return 'none';
    if (trustLevel >= 4) return 'low';
    if (trustLevel >= 2) return 'medium';
    if (trustLevel >= 1) return 'high';
    return 'critical';
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a SecurityPolicyEngineAdapter instance.
 */
export function createSecurityPolicyEngineAdapter(
  engine: SecurityPolicyEngine,
): SecurityPolicyEngineAdapter {
  return new SecurityPolicyEngineAdapter(engine);
}
