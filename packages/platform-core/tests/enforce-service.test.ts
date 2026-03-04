import { describe, it, expect } from 'vitest';
import {
  EnforcementService,
  createEnforcementService,
  type EnforcementContext,
  type EnforcementPolicy,
  type DecisionTier,
} from '../src/enforce/index.js';
import type { Intent, TrustScore, TrustLevel, ID } from '../src/common/types.js';
import type { EvaluationResult, RuleResult } from '../src/basis/types.js';

function makeIntent(id: string = 'intent-1', entityId: string = 'agent-1'): Intent {
  return {
    id: id as ID,
    entityId: entityId as ID,
    goal: 'test goal',
    actions: ['read'],
    resourceScope: ['test-resource'],
    correlationId: 'corr-1' as ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'submitted',
  } as unknown as Intent;
}

function makeEvaluation(
  passed: boolean,
  violatedRules: RuleResult[] = []
): EvaluationResult {
  return {
    passed,
    finalAction: passed ? 'allow' : 'deny',
    rulesEvaluated: [],
    violatedRules,
    totalDurationMs: 5,
    evaluatedAt: new Date().toISOString(),
  } as EvaluationResult;
}

function makeRuleResult(
  action: string,
  ruleId: string = 'rule-1',
  ruleName: string = 'Test Rule',
  details?: Record<string, unknown>
): RuleResult {
  return {
    ruleId,
    ruleName,
    action,
    details,
  } as unknown as RuleResult;
}

function makeContext(
  trustLevel: TrustLevel = 4,
  evaluation?: EvaluationResult,
  trustScore: TrustScore = 750 as TrustScore
): EnforcementContext {
  return {
    intent: makeIntent(),
    evaluation: evaluation ?? makeEvaluation(true),
    trustScore,
    trustLevel,
    tenantId: 'tenant-1' as ID,
    correlationId: 'corr-1' as ID,
  };
}

describe('EnforcementService constructor', () => {
  it('creates service with default policy', () => {
    const service = createEnforcementService();
    expect(service).toBeInstanceOf(EnforcementService);
  });

  it('creates service with custom policy', () => {
    const service = createEnforcementService({
      defaultAction: 'allow',
      trustThresholds: {
        autoApproveLevel: 3,
        requireRefinementLevel: 1,
        autoDenyLevel: 0,
      },
    });
    expect(service).toBeInstanceOf(EnforcementService);
  });
});

describe('EnforcementService.decide (in-memory mode)', () => {
  it('returns GREEN for trusted agent with passing evaluation', async () => {
    const service = createEnforcementService();
    const context = makeContext(5, makeEvaluation(true));
    const result = await service.decide(context);

    expect(result.tier).toBe('GREEN');
    expect(result.action).toBe('allow');
    expect(result.decision.permitted).toBe(true);
    expect(result.decision.tier).toBe('GREEN');
  });

  it('returns RED for hard policy violation (deny action)', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('deny', 'rule-block', 'Block Rule')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(5, evaluation);

    const result = await service.decide(context);

    expect(result.tier).toBe('RED');
    expect(result.action).toBe('deny');
    expect(result.decision.permitted).toBe(false);
  });

  it('returns RED for terminate action in violated rules', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('terminate', 'rule-term', 'Terminate Rule')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(5, evaluation);

    const result = await service.decide(context);

    expect(result.tier).toBe('RED');
    expect(result.action).toBe('deny');
  });

  it('returns YELLOW for soft violations (escalate)', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate', 'rule-esc', 'Escalation Rule')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(5, evaluation);

    const result = await service.decide(context);

    expect(result.tier).toBe('YELLOW');
    expect(result.action).toBe('escalate');
  });

  it('returns YELLOW for soft violations (limit)', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('limit', 'rule-lim', 'Limit Rule')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(5, evaluation);

    const result = await service.decide(context);

    expect(result.tier).toBe('YELLOW');
  });

  it('returns YELLOW for low trust level (below requireRefinementLevel)', async () => {
    const service = createEnforcementService();
    const context = makeContext(1, makeEvaluation(true));

    const result = await service.decide(context);

    expect(result.tier).toBe('YELLOW');
  });

  it('provides refinement options for YELLOW decisions', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(3, evaluation);

    const result = await service.decide(context);

    expect(result.tier).toBe('YELLOW');
    expect(result.refinementOptions).toBeDefined();
    expect(result.refinementOptions!.length).toBeGreaterThan(0);
  });

  it('includes ADD_CONSTRAINTS refinement option for YELLOW', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(3, evaluation);

    const result = await service.decide(context);

    const constraintOption = result.refinementOptions!.find(
      (o) => o.action === 'ADD_CONSTRAINTS'
    );
    expect(constraintOption).toBeDefined();
    expect(constraintOption!.successProbability).toBeGreaterThan(0);
  });

  it('includes REQUEST_APPROVAL for low trust YELLOW decisions', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(2, evaluation);

    const result = await service.decide(context);

    const approvalOption = result.refinementOptions!.find(
      (o) => o.action === 'REQUEST_APPROVAL'
    );
    expect(approvalOption).toBeDefined();
  });

  it('includes WAIT_FOR_TRUST for low trust YELLOW decisions', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(2, evaluation);

    const result = await service.decide(context);

    const waitOption = result.refinementOptions!.find(
      (o) => o.action === 'WAIT_FOR_TRUST'
    );
    expect(waitOption).toBeDefined();
  });

  it('GREEN decisions include constraints', async () => {
    const service = createEnforcementService();
    const context = makeContext(5, makeEvaluation(true));

    const result = await service.decide(context);

    expect(result.tier).toBe('GREEN');
    expect(result.constraintsEvaluated).toBe(true);
    expect(result.decision.constraints).toBeDefined();
  });

  it('includes reasoning in decision', async () => {
    const service = createEnforcementService();
    const context = makeContext(5, makeEvaluation(true));

    const result = await service.decide(context);

    expect(result.decision.reasoning).toBeDefined();
    expect(result.decision.reasoning.length).toBeGreaterThan(0);
  });

  it('creates workflow instance', async () => {
    const service = createEnforcementService();
    const context = makeContext(5, makeEvaluation(true));

    const result = await service.decide(context);

    expect(result.workflow).toBeDefined();
    expect(result.workflow.intentId).toBe(context.intent.id);
    expect(result.workflow.state).toBe('APPROVED');
  });

  it('YELLOW decision creates PENDING_REFINEMENT workflow', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('escalate')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(3, evaluation);

    const result = await service.decide(context);

    expect(result.workflow.state).toBe('PENDING_REFINEMENT');
  });

  it('RED decision creates DENIED workflow', async () => {
    const service = createEnforcementService();
    const violatedRules = [makeRuleResult('deny')];
    const evaluation = makeEvaluation(false, violatedRules);
    const context = makeContext(5, evaluation);

    const result = await service.decide(context);

    expect(result.workflow.state).toBe('DENIED');
  });
});

describe('EnforcementService.setPolicy', () => {
  it('updates policy thresholds', async () => {
    const service = createEnforcementService();

    // With default policy, T3 with passing evaluation should be YELLOW
    // because autoApproveLevel defaults to T4
    const context1 = makeContext(3, makeEvaluation(true));
    const result1 = await service.decide(context1);
    expect(result1.tier).toBe('YELLOW');

    // Update policy to auto-approve at T3
    service.setPolicy({
      defaultAction: 'deny',
      trustThresholds: {
        autoApproveLevel: 3,
        requireRefinementLevel: 1,
        autoDenyLevel: 0,
      },
    });

    const result2 = await service.decide(context1);
    expect(result2.tier).toBe('GREEN');
  });
});

describe('EnforcementService.getDecision / getWorkflow (no persistence)', () => {
  it('returns null when no persistence is configured', async () => {
    const service = createEnforcementService();
    const decision = await service.getDecision('id-1' as ID, 'tenant-1' as ID);
    expect(decision).toBeNull();
  });

  it('getWorkflow returns null without persistence', async () => {
    const service = createEnforcementService();
    const workflow = await service.getWorkflow('intent-1' as ID, 'tenant-1' as ID);
    expect(workflow).toBeNull();
  });
});
