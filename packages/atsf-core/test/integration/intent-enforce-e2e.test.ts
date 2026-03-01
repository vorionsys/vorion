/**
 * Integration Test: Intent -> Enforce -> CogniGate End-to-End
 *
 * Wires PersistentIntentService and TrustAwareEnforcementService together to
 * verify the full governance pipeline:
 *   submit intent -> evaluate (mocked) -> enforce decision -> verify workflow
 *
 * Covers:
 *   1. GREEN / YELLOW / RED tier decisions at varying trust levels
 *   2. Refinement workflow (YELLOW -> refined to GREEN)
 *   3. Full lifecycle with status transitions
 *   4. Tenant isolation across the pipeline
 *   5. Expired intent handling through enforcement
 *   6. Risk-aware tier determination (low/medium/high/critical)
 *   7. Policy violation enforcement (hard deny)
 *   8. Multiple intents from same entity with different risk profiles
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  PersistentIntentService,
  ActionType,
  DataSensitivity,
  Reversibility,
} from '../../src/intent/index.js';
import type { IntentSubmission, SubmitOptions } from '../../src/intent/index.js';

import { TrustAwareEnforcementService } from '../../src/enforce/trust-aware-enforcement-service.js';
import type {
  EnforcementContext,
  FluidDecisionResult,
} from '../../src/enforce/index.js';

import { TrustEngine } from '../../src/trust-engine/index.js';

import type { Intent, TrustLevel, TrustScore } from '../../src/common/types.js';
import type { EvaluationResult, RuleResult } from '../../src/basis/types.js';

// =============================================================================
// HELPERS
// =============================================================================

/** Build a passing EvaluationResult (no violations). */
function passingEvaluation(overrides?: Partial<EvaluationResult>): EvaluationResult {
  return {
    passed: true,
    finalAction: 'allow',
    rulesEvaluated: [],
    violatedRules: [],
    totalDurationMs: 1,
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a failing EvaluationResult with one or more violated rules. */
function failingEvaluation(
  violatedRules: RuleResult[],
  overrides?: Partial<EvaluationResult>,
): EvaluationResult {
  return {
    passed: false,
    finalAction: 'deny',
    rulesEvaluated: violatedRules,
    violatedRules,
    totalDurationMs: 2,
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a deny-type RuleResult (triggers RED tier). */
function denyRule(name: string, reason: string): RuleResult {
  return {
    ruleId: crypto.randomUUID(),
    ruleName: name,
    matched: true,
    action: 'deny',
    reason,
    details: {},
    durationMs: 1,
  };
}

/** Build a terminate-type RuleResult (triggers RED tier with hard denial). */
function terminateRule(name: string, reason: string): RuleResult {
  return {
    ruleId: crypto.randomUUID(),
    ruleName: name,
    matched: true,
    action: 'terminate',
    reason,
    details: {},
    durationMs: 1,
  };
}

/**
 * Build an EnforcementContext from a submitted intent plus trust/eval info.
 */
function buildEnforcementContext(
  intent: Intent,
  trustScore: TrustScore,
  trustLevel: TrustLevel,
  evaluation: EvaluationResult,
  tenantId: string,
): EnforcementContext {
  return {
    intent,
    evaluation,
    trustScore,
    trustLevel,
    tenantId,
    correlationId: intent.correlationId ?? crypto.randomUUID(),
  };
}

// =============================================================================
// LOW-RISK SUBMISSION PRESET
// =============================================================================

function lowRiskSubmission(entityId = 'agent-low'): IntentSubmission {
  return {
    entityId,
    goal: 'Read public dashboard metrics',
    context: { target: 'dashboard' },
    actionType: ActionType.READ,
    dataSensitivity: DataSensitivity.PUBLIC,
    reversibility: Reversibility.REVERSIBLE,
  };
}

function mediumRiskSubmission(entityId = 'agent-med'): IntentSubmission {
  return {
    entityId,
    goal: 'Write confidential report',
    context: { target: 'report-service' },
    actionType: ActionType.WRITE,
    dataSensitivity: DataSensitivity.CONFIDENTIAL,
    reversibility: Reversibility.PARTIALLY_REVERSIBLE,
  };
}

function highRiskSubmission(entityId = 'agent-high'): IntentSubmission {
  return {
    entityId,
    goal: 'Delete restricted records',
    context: { target: 'records-db' },
    actionType: ActionType.DELETE,
    dataSensitivity: DataSensitivity.RESTRICTED,
    reversibility: Reversibility.PARTIALLY_REVERSIBLE,
  };
}

function criticalRiskSubmission(entityId = 'agent-crit'): IntentSubmission {
  return {
    entityId,
    goal: 'Irreversible purge of restricted data',
    context: { target: 'archive-storage' },
    actionType: ActionType.DELETE,
    dataSensitivity: DataSensitivity.RESTRICTED,
    reversibility: Reversibility.IRREVERSIBLE,
  };
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Intent -> Enforce E2E Integration', () => {
  let intentService: PersistentIntentService;
  let enforceService: TrustAwareEnforcementService;
  let trustEngine: TrustEngine;

  const TENANT_A = 'tenant-alpha';
  const TENANT_B = 'tenant-beta';

  beforeEach(() => {
    // Disable sweep timers to prevent interference in tests
    intentService = new PersistentIntentService({
      expirationSweepIntervalMs: 0,
      defaultExpirationMs: 3_600_000,
    });

    trustEngine = new TrustEngine({
      decayIntervalMs: 999_999_999, // effectively disable decay in tests
    });

    enforceService = new TrustAwareEnforcementService(null, {
      autoApproveLevel: 4 as TrustLevel,
      requireRefinementLevel: 2 as TrustLevel,
      autoDenyLevel: 0 as TrustLevel,
    });
  });

  afterEach(() => {
    intentService.close();
    intentService.clear();
    enforceService.clear();
    trustEngine.removeAllListeners();
  });

  // ---------------------------------------------------------------------------
  // 1. GREEN tier: high-trust entity, low-risk action, passing evaluation
  // ---------------------------------------------------------------------------
  describe('Scenario 1: GREEN tier for high-trust, low-risk intent', () => {
    it('auto-approves and produces APPROVED workflow', async () => {
      // Step 1 - Submit intent
      const intent = await intentService.submit(lowRiskSubmission('agent-green'), {
        tenantId: TENANT_A,
        trustLevel: 5,
      });

      expect(intent.status).toBe('pending');
      expect(intent.actionType).toBe('read');
      expect(intent.dataSensitivity).toBe('PUBLIC');

      // Step 2 - Simulate evaluation (passes all checks)
      const evaluation = passingEvaluation();

      // Step 3 - Enforce
      const ctx = buildEnforcementContext(intent, 800, 5 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      // Verify decision
      expect(result.tier).toBe('GREEN');
      expect(result.decision.permitted).toBe(true);
      expect(result.decision.constraints).toBeDefined();
      expect(result.decision.intentId).toBe(intent.id);
      expect(result.decision.agentId).toBe('agent-green');

      // Verify workflow
      expect(result.workflow.state).toBe('APPROVED');
      expect(result.workflow.intentId).toBe(intent.id);
      expect(result.workflow.stateHistory).toHaveLength(1);
      expect(result.workflow.stateHistory[0].to).toBe('APPROVED');

      // Step 4 - Transition intent to match decision
      const updated = await intentService.updateStatus(intent.id, TENANT_A, 'evaluating');
      expect(updated?.status).toBe('evaluating');
      const approved = await intentService.updateStatus(intent.id, TENANT_A, 'approved');
      expect(approved?.status).toBe('approved');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. YELLOW tier: moderate trust, medium-risk action
  // ---------------------------------------------------------------------------
  describe('Scenario 2: YELLOW tier for moderate trust, medium-risk intent', () => {
    it('requires refinement and provides options', async () => {
      const intent = await intentService.submit(mediumRiskSubmission('agent-yellow'), {
        tenantId: TENANT_A,
        trustLevel: 3,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 550, 3 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      expect(result.tier).toBe('YELLOW');
      expect(result.decision.permitted).toBe(false);
      expect(result.decision.refinementOptions).toBeDefined();
      expect(result.decision.refinementOptions!.length).toBeGreaterThan(0);
      expect(result.decision.refinementDeadline).toBeDefined();
      expect(result.decision.maxRefinementAttempts).toBe(3);

      // Workflow should be PENDING_REFINEMENT
      expect(result.workflow.state).toBe('PENDING_REFINEMENT');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. RED tier: policy violation forces denial
  // ---------------------------------------------------------------------------
  describe('Scenario 3: RED tier for policy violation', () => {
    it('denies intent when evaluation has deny rules', async () => {
      const intent = await intentService.submit(highRiskSubmission('agent-red'), {
        tenantId: TENANT_A,
        trustLevel: 5,
      });

      const evaluation = failingEvaluation([
        denyRule('no-restricted-delete', 'Deleting restricted data is forbidden'),
      ]);

      const ctx = buildEnforcementContext(intent, 800, 5 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      expect(result.tier).toBe('RED');
      expect(result.decision.permitted).toBe(false);
      expect(result.decision.denialReason).toBeDefined();
      expect(result.decision.denialReason).toContain('no-restricted-delete');
      expect(result.decision.violatedPolicies).toBeDefined();
      expect(result.decision.violatedPolicies!.length).toBe(1);
      expect(result.decision.violatedPolicies![0].severity).toBe('error');

      // Workflow should be DENIED
      expect(result.workflow.state).toBe('DENIED');

      // Intent status can be transitioned to denied
      await intentService.updateStatus(intent.id, TENANT_A, 'evaluating');
      const denied = await intentService.updateStatus(intent.id, TENANT_A, 'denied');
      expect(denied?.status).toBe('denied');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. RED tier with hard denial (terminate action)
  // ---------------------------------------------------------------------------
  describe('Scenario 4: RED tier with hard denial via terminate rule', () => {
    it('sets hardDenial flag and critical severity', async () => {
      const intent = await intentService.submit(criticalRiskSubmission('agent-term'), {
        tenantId: TENANT_A,
        trustLevel: 7,
      });

      const evaluation = failingEvaluation([
        terminateRule('data-purge-blocked', 'Irreversible purge is blocked by policy'),
      ]);

      const ctx = buildEnforcementContext(intent, 960, 7 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      expect(result.tier).toBe('RED');
      expect(result.decision.hardDenial).toBe(true);
      expect(result.decision.violatedPolicies).toBeDefined();
      expect(result.decision.violatedPolicies![0].severity).toBe('critical');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Refinement workflow: YELLOW -> refine -> GREEN
  // ---------------------------------------------------------------------------
  describe('Scenario 5: Refinement workflow (YELLOW -> GREEN)', () => {
    it('upgrades a YELLOW decision to GREEN after refinement', async () => {
      // Submit medium-risk intent with moderate trust
      const intent = await intentService.submit(mediumRiskSubmission('agent-refine'), {
        tenantId: TENANT_A,
        trustLevel: 3,
      });

      // Get YELLOW decision
      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 550, 3 as TrustLevel, evaluation, TENANT_A);
      const yellowResult = await enforceService.decide(ctx);

      expect(yellowResult.tier).toBe('YELLOW');
      expect(yellowResult.decision.refinementOptions).toBeDefined();

      // Select a refinement option (ADD_CONSTRAINTS)
      const addConstraintsOption = yellowResult.decision.refinementOptions!.find(
        (opt) => opt.action === 'ADD_CONSTRAINTS',
      );
      expect(addConstraintsOption).toBeDefined();

      // Submit refinement
      const refinedResult = await enforceService.refine(
        {
          decisionId: yellowResult.decision.id,
          selectedRefinements: [addConstraintsOption!.id],
        },
        TENANT_A,
      );

      expect(refinedResult).not.toBeNull();
      expect(refinedResult!.tier).toBe('GREEN');
      expect(refinedResult!.decision.permitted).toBe(true);
      expect(refinedResult!.decision.refinementAttempt).toBe(1);
      expect(refinedResult!.decision.constraints).toBeDefined();
      expect(refinedResult!.decision.constraints!.reversibilityRequired).toBe(true);

      // Workflow should transition to APPROVED
      expect(refinedResult!.workflow.state).toBe('APPROVED');
      expect(refinedResult!.workflow.stateHistory).toHaveLength(2);
      expect(refinedResult!.workflow.stateHistory[1].from).toBe('PENDING_REFINEMENT');
      expect(refinedResult!.workflow.stateHistory[1].to).toBe('APPROVED');

      // The original decision should still be retrievable
      const originalDecision = await enforceService.getDecision(
        yellowResult.decision.id,
        TENANT_A,
      );
      expect(originalDecision).not.toBeNull();
      expect(originalDecision!.tier).toBe('YELLOW');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Full lifecycle: submit -> evaluate -> enforce -> execute -> complete
  // ---------------------------------------------------------------------------
  describe('Scenario 6: Full intent lifecycle through governance pipeline', () => {
    it('traces an intent from submission to completion', async () => {
      // 1. Submit
      const intent = await intentService.submit(lowRiskSubmission('agent-lifecycle'), {
        tenantId: TENANT_A,
        trustLevel: 5,
      });
      expect(intent.status).toBe('pending');
      expect(intent.correlationId).toBeDefined();

      // 2. Move to evaluating
      await intentService.updateStatus(intent.id, TENANT_A, 'evaluating');
      const evaluatingIntent = await intentService.get(intent.id, TENANT_A);
      expect(evaluatingIntent?.status).toBe('evaluating');

      // 3. Evaluate (mock)
      const evaluation = passingEvaluation();

      // 4. Enforce
      const ctx = buildEnforcementContext(intent, 800, 5 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);
      expect(result.tier).toBe('GREEN');

      // 5. Approve intent
      await intentService.updateStatus(intent.id, TENANT_A, 'approved');
      const approvedIntent = await intentService.get(intent.id, TENANT_A);
      expect(approvedIntent?.status).toBe('approved');

      // 6. Execute
      await intentService.updateStatus(intent.id, TENANT_A, 'executing');
      const executingIntent = await intentService.get(intent.id, TENANT_A);
      expect(executingIntent?.status).toBe('executing');

      // 7. Complete
      await intentService.updateStatus(intent.id, TENANT_A, 'completed');
      const completedIntent = await intentService.get(intent.id, TENANT_A);
      expect(completedIntent?.status).toBe('completed');

      // Verify workflow is still accessible
      const workflow = await enforceService.getWorkflow(intent.id, TENANT_A);
      expect(workflow).not.toBeNull();
      expect(workflow!.state).toBe('APPROVED');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Tenant isolation across intent + enforcement pipeline
  // ---------------------------------------------------------------------------
  describe('Scenario 7: Tenant isolation across the pipeline', () => {
    it('prevents cross-tenant access to intents and decisions', async () => {
      // Submit intents for two tenants
      const intentA = await intentService.submit(lowRiskSubmission('agent-iso'), {
        tenantId: TENANT_A,
      });
      const intentB = await intentService.submit(lowRiskSubmission('agent-iso'), {
        tenantId: TENANT_B,
      });

      // Tenant A cannot see Tenant B's intent
      const crossGet = await intentService.get(intentB.id, TENANT_A);
      expect(crossGet).toBeUndefined();

      // Tenant B cannot see Tenant A's intent
      const crossGet2 = await intentService.get(intentA.id, TENANT_B);
      expect(crossGet2).toBeUndefined();

      // Enforce for Tenant A
      const evalA = passingEvaluation();
      const ctxA = buildEnforcementContext(intentA, 800, 5 as TrustLevel, evalA, TENANT_A);
      const resultA = await enforceService.decide(ctxA);

      // Enforce for Tenant B
      const evalB = passingEvaluation();
      const ctxB = buildEnforcementContext(intentB, 800, 5 as TrustLevel, evalB, TENANT_B);
      const resultB = await enforceService.decide(ctxB);

      // Tenant A cannot see Tenant B's decision
      const crossDecision = await enforceService.getDecision(resultB.decision.id, TENANT_A);
      expect(crossDecision).toBeNull();

      // Tenant B cannot see Tenant A's workflow
      const crossWorkflow = await enforceService.getWorkflow(intentA.id, TENANT_B);
      expect(crossWorkflow).toBeNull();

      // Tenant A can see their own decision and workflow
      const ownDecision = await enforceService.getDecision(resultA.decision.id, TENANT_A);
      expect(ownDecision).not.toBeNull();
      expect(ownDecision!.intentId).toBe(intentA.id);

      const ownWorkflow = await enforceService.getWorkflow(intentA.id, TENANT_A);
      expect(ownWorkflow).not.toBeNull();
      expect(ownWorkflow!.agentId).toBe('agent-iso');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Expired intent handling through enforcement
  // ---------------------------------------------------------------------------
  describe('Scenario 8: Expired intent handling', () => {
    it('returns undefined for expired intents via PersistentIntentService.get()', async () => {
      // Submit an intent with very short expiration
      const intent = await intentService.submit(
        {
          ...lowRiskSubmission('agent-expire'),
          expiresIn: 1, // 1ms - expires almost immediately
        },
        { tenantId: TENANT_A },
      );

      expect(intent.id).toBeDefined();

      // Wait for the intent to expire
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The intent should be treated as expired
      const retrieved = await intentService.get(intent.id, TENANT_A);
      expect(retrieved).toBeUndefined();
    });

    it('enforcement can still process an intent even if it is about to expire', async () => {
      // Submit an intent with short expiration
      const intent = await intentService.submit(
        {
          ...lowRiskSubmission('agent-expire2'),
          expiresIn: 60_000, // 1 minute - not yet expired
        },
        { tenantId: TENANT_A, trustLevel: 5 },
      );

      // Enforce immediately (before expiration)
      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 800, 5 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      expect(result.tier).toBe('GREEN');
      expect(result.decision.permitted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Risk-level-driven tier determination (critical risk requires higher trust)
  // ---------------------------------------------------------------------------
  describe('Scenario 9: Critical risk requires elevated trust', () => {
    it('YELLOW for critical-risk intent even at T4 trust (no violations)', async () => {
      // Critical risk: IRREVERSIBLE + RESTRICTED -> critical risk level
      // T4 trust normally auto-approves, but critical risk requires T6+
      const intent = await intentService.submit(criticalRiskSubmission('agent-crit-t4'), {
        tenantId: TENANT_A,
        trustLevel: 4,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 700, 4 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      // Critical risk at T4 should yield YELLOW (needs refinement), not GREEN
      expect(result.tier).toBe('YELLOW');
      expect(result.decision.refinementOptions).toBeDefined();
      expect(result.decision.refinementOptions!.length).toBeGreaterThan(0);

      // Should include REDUCE_SCOPE option for high/critical risk
      const reduceScope = result.decision.refinementOptions!.find(
        (opt) => opt.action === 'REDUCE_SCOPE',
      );
      expect(reduceScope).toBeDefined();
    });

    it('GREEN for critical-risk intent at T6 trust (certified)', async () => {
      const intent = await intentService.submit(criticalRiskSubmission('agent-crit-t6'), {
        tenantId: TENANT_A,
        trustLevel: 6,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 900, 6 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      // T6 should be high enough for critical-risk GREEN
      expect(result.tier).toBe('GREEN');
      expect(result.decision.permitted).toBe(true);
      expect(result.decision.constraints).toBeDefined();
      // Critical-risk GREEN should have reversibility required
      expect(result.decision.constraints!.reversibilityRequired).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Multiple intents from the same entity with different risk profiles
  // ---------------------------------------------------------------------------
  describe('Scenario 10: Multiple intents from same entity, varied risk', () => {
    it('produces different tiers based on risk level for the same trust', async () => {
      const entityId = 'multi-risk-agent';
      const trustLevel = 4 as TrustLevel;
      const trustScore = 700;

      // Low risk -> GREEN
      const lowIntent = await intentService.submit(lowRiskSubmission(entityId), {
        tenantId: TENANT_A,
        trustLevel,
      });
      const lowResult = await enforceService.decide(
        buildEnforcementContext(lowIntent, trustScore, trustLevel, passingEvaluation(), TENANT_A),
      );

      // Medium risk -> YELLOW (T4 but medium risk means evaluation.passed
      // can still go YELLOW because T4 = autoApproveLevel but medium risk
      // for write + CONFIDENTIAL goes through standard path)
      const medIntent = await intentService.submit(mediumRiskSubmission(entityId), {
        tenantId: TENANT_A,
        trustLevel,
      });
      const medResult = await enforceService.decide(
        buildEnforcementContext(medIntent, trustScore, trustLevel, passingEvaluation(), TENANT_A),
      );

      // High risk -> YELLOW (requires elevated trust for auto-approve)
      const highIntent = await intentService.submit(highRiskSubmission(entityId), {
        tenantId: TENANT_A,
        trustLevel,
      });
      const highResult = await enforceService.decide(
        buildEnforcementContext(highIntent, trustScore, trustLevel, passingEvaluation(), TENANT_A),
      );

      // Critical risk -> YELLOW (T4 < T6 threshold for critical)
      const critIntent = await intentService.submit(criticalRiskSubmission(entityId), {
        tenantId: TENANT_A,
        trustLevel,
      });
      const critResult = await enforceService.decide(
        buildEnforcementContext(critIntent, trustScore, trustLevel, passingEvaluation(), TENANT_A),
      );

      // Low-risk with good trust should be GREEN
      expect(lowResult.tier).toBe('GREEN');

      // Higher-risk intents at T4 should be YELLOW due to risk elevation
      expect(highResult.tier).toBe('YELLOW');
      expect(critResult.tier).toBe('YELLOW');

      // All intents should belong to the same entity
      const entityIntents = await intentService.listByEntity(entityId, TENANT_A);
      expect(entityIntents.length).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Refinement with REQUEST_APPROVAL option
  // ---------------------------------------------------------------------------
  describe('Scenario 11: Refinement via REQUEST_APPROVAL', () => {
    it('adds human_review approval requirement on refinement', async () => {
      const intent = await intentService.submit(highRiskSubmission('agent-approval'), {
        tenantId: TENANT_A,
        trustLevel: 3,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 550, 3 as TrustLevel, evaluation, TENANT_A);
      const yellowResult = await enforceService.decide(ctx);
      expect(yellowResult.tier).toBe('YELLOW');

      // Select REQUEST_APPROVAL option
      const approvalOption = yellowResult.decision.refinementOptions!.find(
        (opt) => opt.action === 'REQUEST_APPROVAL',
      );
      expect(approvalOption).toBeDefined();

      const refined = await enforceService.refine(
        {
          decisionId: yellowResult.decision.id,
          selectedRefinements: [approvalOption!.id],
        },
        TENANT_A,
      );

      expect(refined).not.toBeNull();
      expect(refined!.tier).toBe('GREEN');
      expect(refined!.decision.constraints!.requiredApprovals.length).toBeGreaterThan(0);
      expect(refined!.decision.constraints!.requiredApprovals[0].type).toBe('human_review');
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Refinement on wrong tenant returns null
  // ---------------------------------------------------------------------------
  describe('Scenario 12: Refinement tenant isolation', () => {
    it('returns null when refining with wrong tenantId', async () => {
      const intent = await intentService.submit(mediumRiskSubmission('agent-iso-refine'), {
        tenantId: TENANT_A,
        trustLevel: 3,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 550, 3 as TrustLevel, evaluation, TENANT_A);
      const yellowResult = await enforceService.decide(ctx);
      expect(yellowResult.tier).toBe('YELLOW');

      const option = yellowResult.decision.refinementOptions![0];

      // Attempt refinement with wrong tenant
      const refined = await enforceService.refine(
        {
          decisionId: yellowResult.decision.id,
          selectedRefinements: [option.id],
        },
        TENANT_B, // wrong tenant
      );

      expect(refined).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Trust engine integration (live trust lookup)
  // ---------------------------------------------------------------------------
  describe('Scenario 13: TrustEngine-backed enforcement', () => {
    it('uses live trust score from TrustEngine when available', async () => {
      // Create enforcement service wired to the trust engine
      const engineBackedEnforce = new TrustAwareEnforcementService(trustEngine, {
        autoApproveLevel: 4 as TrustLevel,
        requireRefinementLevel: 2 as TrustLevel,
        autoDenyLevel: 0 as TrustLevel,
      });

      // Initialize entity in trust engine at T5 (Trusted)
      await trustEngine.initializeEntity('agent-trust-live', 5 as TrustLevel);

      const intent = await intentService.submit(lowRiskSubmission('agent-trust-live'), {
        tenantId: TENANT_A,
        trustLevel: 1, // stale/low trust passed in context
      });

      // Context has low trust, but TrustEngine has T5
      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(
        intent,
        200, // stale score in context
        1 as TrustLevel, // stale level in context
        evaluation,
        TENANT_A,
      );

      const result = await engineBackedEnforce.decide(ctx);

      // Should use the live T5 from TrustEngine, not the stale T1 from context
      expect(result.tier).toBe('GREEN');
      expect(result.decision.permitted).toBe(true);
      // Trust band should reflect the live lookup
      expect(result.decision.trustBand).toContain('T5');

      engineBackedEnforce.clear();
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Decision expiration check
  // ---------------------------------------------------------------------------
  describe('Scenario 14: Decision expiration', () => {
    it('returns null for expired decisions', async () => {
      // Create service with very short decision expiration
      const shortLivedEnforce = new TrustAwareEnforcementService(null, {
        decisionExpirationMs: 1, // expires immediately
        autoApproveLevel: 4 as TrustLevel,
        requireRefinementLevel: 2 as TrustLevel,
        autoDenyLevel: 0 as TrustLevel,
      });

      const intent = await intentService.submit(lowRiskSubmission('agent-expire-decision'), {
        tenantId: TENANT_A,
        trustLevel: 5,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 800, 5 as TrustLevel, evaluation, TENANT_A);
      const result = await shortLivedEnforce.decide(ctx);
      const decisionId = result.decision.id;

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The decision should be expired
      const expired = await shortLivedEnforce.getDecision(decisionId, TENANT_A);
      expect(expired).toBeNull();

      shortLivedEnforce.clear();
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Low-trust entity gets YELLOW even for low-risk actions
  // ---------------------------------------------------------------------------
  describe('Scenario 15: Low trust forces YELLOW on low-risk intent', () => {
    it('YELLOW for T1 trust even with low risk and passing eval', async () => {
      const intent = await intentService.submit(lowRiskSubmission('agent-low-trust'), {
        tenantId: TENANT_A,
        trustLevel: 1,
      });

      const evaluation = passingEvaluation();
      const ctx = buildEnforcementContext(intent, 250, 1 as TrustLevel, evaluation, TENANT_A);
      const result = await enforceService.decide(ctx);

      // T1 < autoApproveLevel (T4) and T1 < requireRefinementLevel (T2)
      // -> YELLOW
      expect(result.tier).toBe('YELLOW');
      expect(result.decision.permitted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Intent status transition enforcement
  // ---------------------------------------------------------------------------
  describe('Scenario 16: Intent state machine enforcement', () => {
    it('rejects invalid status transitions', async () => {
      const intent = await intentService.submit(lowRiskSubmission('agent-sm'), {
        tenantId: TENANT_A,
      });

      // pending -> approved is NOT allowed (must go through evaluating)
      await expect(
        intentService.updateStatus(intent.id, TENANT_A, 'approved'),
      ).rejects.toThrow(/Invalid status transition/);

      // pending -> evaluating is allowed
      await intentService.updateStatus(intent.id, TENANT_A, 'evaluating');

      // evaluating -> completed is NOT allowed
      await expect(
        intentService.updateStatus(intent.id, TENANT_A, 'completed'),
      ).rejects.toThrow(/Invalid status transition/);

      // evaluating -> approved is allowed
      const approved = await intentService.updateStatus(intent.id, TENANT_A, 'approved');
      expect(approved?.status).toBe('approved');
    });
  });
});
