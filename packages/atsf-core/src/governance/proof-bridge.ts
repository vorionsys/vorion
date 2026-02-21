/**
 * Governance → Proof Chain Bridge
 *
 * Wraps GovernanceEngine.evaluate() to automatically create cryptographic
 * proof records for every governance decision. Maps GovernanceResult shapes
 * to Intent + Decision shapes required by the proof service.
 *
 * The bridge accepts a `createProof` function to decouple from the concrete
 * ProofService implementation (which lives in platform-core).
 *
 * @packageDocumentation
 */

import type {
  ID,
  Timestamp,
  Intent,
  Decision,
  EvaluationResult,
  Proof,
  ControlAction,
} from '../common/types.js';
import type { GovernanceEngine } from './index.js';
import type { GovernanceRequest, GovernanceResult, EvaluatedRule } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

/** Proof creation function — injected by callers who have access to ProofService */
export interface ProofCreateFn {
  (request: ProofBridgeProofRequest): Promise<{ id: ID }>;
}

/** Simplified proof request shape matching what ProofService.create() expects */
export interface ProofBridgeProofRequest {
  intent: Intent;
  decision: Decision;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tenantId?: string;
}

/** Configuration for the governance proof bridge */
export interface ProofBridgeConfig {
  /** Function to create a proof record */
  createProof: ProofCreateFn;
  /** Tenant ID for proof chain isolation */
  tenantId: string;
}

/** Result of governance evaluation with proof */
export interface GovernanceProofResult {
  /** The governance evaluation result */
  result: GovernanceResult;
  /** ID of the created proof record */
  proofId: string;
}

// =============================================================================
// GOVERNANCE PROOF BRIDGE
// =============================================================================

/**
 * Bridges governance decisions to the cryptographic proof chain.
 *
 * Every call to `evaluateWithProof()` will:
 * 1. Run `GovernanceEngine.evaluate(request)`
 * 2. Map the result to Intent + Decision shapes
 * 3. Create a signed proof record via `createProof()`
 * 4. Return both the governance result and the proof ID
 *
 * @example
 * ```typescript
 * const engine = createGovernanceEngine();
 * const bridge = new GovernanceProofBridge(engine, {
 *   createProof: (req) => proofService.create(req),
 *   tenantId: 'tenant-123',
 * });
 *
 * const { result, proofId } = await bridge.evaluateWithProof(request);
 * ```
 */
export class GovernanceProofBridge {
  private readonly engine: GovernanceEngine;
  private readonly createProof: ProofCreateFn;
  private readonly tenantId: string;

  constructor(engine: GovernanceEngine, config: ProofBridgeConfig) {
    this.engine = engine;
    this.createProof = config.createProof;
    this.tenantId = config.tenantId;
  }

  /**
   * Evaluate governance request AND create a cryptographic proof record.
   */
  async evaluateWithProof(request: GovernanceRequest): Promise<GovernanceProofResult> {
    // Step 1: Run governance evaluation
    const result = await this.engine.evaluate(request);

    // Step 2: Map to Intent
    const intent = this.mapToIntent(request, result);

    // Step 3: Map to Decision
    const decision = this.mapToDecision(request, result);

    // Step 4: Create proof record
    const proof = await this.createProof({
      intent,
      decision,
      inputs: {
        requestId: request.requestId,
        entityId: request.entityId,
        action: request.action,
        capabilities: request.capabilities,
        resources: request.resources,
        context: request.context,
      },
      outputs: {
        resultId: result.resultId,
        decision: result.decision,
        confidence: result.confidence,
        rulesMatched: result.rulesMatched.length,
        rulesEvaluated: result.rulesEvaluated.length,
        modifications: result.modifications,
        constraints: result.constraints,
        explanation: result.explanation,
      },
      tenantId: this.tenantId,
    });

    return {
      result,
      proofId: proof.id,
    };
  }

  /**
   * Map a GovernanceRequest to an Intent for the proof chain.
   */
  private mapToIntent(request: GovernanceRequest, result: GovernanceResult): Intent {
    const now = result.evaluatedAt;
    return {
      id: request.requestId,
      tenantId: this.tenantId,
      entityId: request.entityId,
      goal: request.action,
      context: request.context,
      metadata: {
        capabilities: request.capabilities,
        resources: request.resources,
        authority: request.authority,
      },
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      trustLevel: request.trustLevel,
      source: 'governance-bridge',
    };
  }

  /**
   * Map a GovernanceResult to a Decision for the proof chain.
   */
  private mapToDecision(request: GovernanceRequest, result: GovernanceResult): Decision {
    return {
      intentId: request.requestId,
      action: result.decision,
      constraintsEvaluated: result.rulesEvaluated.map((rule) =>
        this.mapEvaluatedRuleToConstraintResult(rule)
      ),
      trustScore: Math.round(result.confidence * 1000) as number,
      trustLevel: request.trustLevel,
      decidedAt: result.evaluatedAt,
    };
  }

  /**
   * Map an EvaluatedRule to an EvaluationResult for the Decision's constraintsEvaluated.
   */
  private mapEvaluatedRuleToConstraintResult(rule: EvaluatedRule): EvaluationResult {
    return {
      constraintId: rule.ruleId,
      passed: rule.matched,
      action: (rule.effect?.action ?? 'allow') as ControlAction,
      reason: rule.matchReason,
      details: {
        ruleName: rule.ruleName,
        category: rule.category,
        evaluationMs: rule.evaluationMs,
      },
      durationMs: rule.evaluationMs,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
