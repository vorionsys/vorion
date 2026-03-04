/**
 * Tests for SecurityPolicyEngineAdapter (ATSF bridge)
 *
 * Validates that the adapter correctly:
 * - Converts PolicyEvaluationInput → PolicyContext
 * - Converts PolicyDecision → PolicyViolation[]
 * - Maps trust scores to risk scores and threat levels
 * - Handles the sync evaluate() / async preEvaluate() caching pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SecurityPolicyEngineAdapter,
  createSecurityPolicyEngineAdapter,
} from '../atsf-adapter.js';
import type { PolicyDecision, PolicyAction } from '../types.js';

// =============================================================================
// MOCK ENGINE
// =============================================================================

function createMockEngine(decision?: Partial<PolicyDecision>) {
  const defaultDecision: PolicyDecision = {
    id: 'dec-1',
    requestId: 'req-1',
    outcome: 'allow',
    reason: 'No policies matched',
    actions: [],
    evaluatedPolicies: [],
    matchedPolicies: [],
    breakGlassUsed: false,
    totalDurationMs: 1,
    decidedAt: new Date().toISOString(),
  };

  return {
    evaluate: vi.fn().mockResolvedValue({ ...defaultDecision, ...decision }),
  } as any;
}

function createInput(overrides?: Record<string, unknown>) {
  return {
    intent: {
      id: 'intent-1',
      entityId: 'entity-1',
      actionType: 'read',
      dataSensitivity: 'CONFIDENTIAL',
      reversibility: 'reversible',
      resourceScope: ['documents'],
      ...(overrides?.intent as Record<string, unknown>),
    },
    trustScore: 800,
    trustLevel: 5,
    context: { tenantId: 'tenant-1' },
    ...overrides,
  };
}

// =============================================================================
// ADAPTER LIFECYCLE
// =============================================================================

describe('SecurityPolicyEngineAdapter', () => {
  let mockEngine: ReturnType<typeof createMockEngine>;
  let adapter: SecurityPolicyEngineAdapter;

  beforeEach(() => {
    mockEngine = createMockEngine();
    adapter = new SecurityPolicyEngineAdapter(mockEngine);
  });

  it('constructs without error', () => {
    expect(adapter).toBeInstanceOf(SecurityPolicyEngineAdapter);
  });

  it('evaluate() returns empty array before any preEvaluate', () => {
    const result = adapter.evaluate(createInput());
    expect(result).toEqual([]);
  });

  it('preEvaluate() calls engine.evaluate() with converted context', async () => {
    await adapter.preEvaluate(createInput());
    expect(mockEngine.evaluate).toHaveBeenCalledTimes(1);

    const ctx = mockEngine.evaluate.mock.calls[0][0];
    expect(ctx.user.id).toBe('entity-1');
    expect(ctx.request.id).toBe('intent-1');
    expect(ctx.request.method).toBe('read');
    expect(ctx.request.url).toBe('atsf://intent/intent-1');
    expect(ctx.resource.sensitivityLevel).toBe('confidential');
  });

  it('evaluate() returns cached result after preEvaluate()', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Blocked by policy',
      matchedPolicies: [],
    });
    const ad = new SecurityPolicyEngineAdapter(engine);

    const preResult = await ad.preEvaluate(createInput());
    const syncResult = ad.evaluate(createInput());

    expect(syncResult).toEqual(preResult);
    // Engine only called once (from preEvaluate, not from sync evaluate)
    expect(engine.evaluate).toHaveBeenCalledTimes(1);
  });

  it('evaluateAsync() is an alias for preEvaluate()', async () => {
    const result = await adapter.evaluateAsync(createInput());
    expect(result).toEqual([]);
    expect(mockEngine.evaluate).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// CONTEXT CONVERSION (buildPolicyContext)
// =============================================================================

describe('Context conversion (buildPolicyContext)', () => {
  it('inverts trust score to risk score', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    // trustScore 800 / 1000 → risk = (1 - 0.8) * 100 = 20
    await adapter.preEvaluate(createInput({ trustScore: 800 }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.user.riskScore).toBe(20);
    expect(ctx.risk.userRiskScore).toBe(20);
  });

  it('maps trust score 0 → risk 100', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({ trustScore: 0 }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.user.riskScore).toBe(100);
  });

  it('maps trust score 1000 → risk 0', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({ trustScore: 1000 }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.user.riskScore).toBe(0);
  });

  it('maps trust level to threat level', async () => {
    const cases: [number, string][] = [
      [7, 'none'],
      [6, 'none'],
      [5, 'low'],
      [4, 'low'],
      [3, 'medium'],
      [2, 'medium'],
      [1, 'high'],
      [0, 'critical'],
    ];

    for (const [trustLevel, expectedThreat] of cases) {
      const engine = createMockEngine();
      const ad = new SecurityPolicyEngineAdapter(engine);
      await ad.preEvaluate(createInput({ trustLevel }));
      const ctx = engine.evaluate.mock.calls[0][0];
      expect(ctx.risk.threatLevel).toBe(expectedThreat);
    }
  });

  it('maps sensitivity levels case-insensitively', async () => {
    const cases: [string, string][] = [
      ['PUBLIC', 'public'],
      ['public', 'public'],
      ['INTERNAL', 'internal'],
      ['CONFIDENTIAL', 'confidential'],
      ['RESTRICTED', 'restricted'],
    ];

    for (const [input, expected] of cases) {
      const engine = createMockEngine();
      const ad = new SecurityPolicyEngineAdapter(engine);
      await ad.preEvaluate(createInput({
        intent: { id: 'i', entityId: 'e', dataSensitivity: input },
      }));
      const ctx = engine.evaluate.mock.calls[0][0];
      expect(ctx.resource.sensitivityLevel).toBe(expected);
    }
  });

  it('maps unknown sensitivity to undefined', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({
      intent: { id: 'i', entityId: 'e', dataSensitivity: 'UNKNOWN_LEVEL' },
    }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.resource.sensitivityLevel).toBeUndefined();
  });

  it('maps null sensitivity to undefined', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({
      intent: { id: 'i', entityId: 'e', dataSensitivity: null },
    }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.resource.sensitivityLevel).toBeUndefined();
  });

  it('derives request path from resourceScope', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({
      intent: { id: 'i', entityId: 'e', resourceScope: ['users', 'profiles'] },
    }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.request.path).toBe('/users');
  });

  it('falls back to /unknown when resourceScope is null', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({
      intent: { id: 'i', entityId: 'e', resourceScope: null },
    }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.request.path).toBe('/unknown');
  });

  it('passes tenantId from context', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({ context: { tenantId: 'acme' } }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.user.tenant).toBe('acme');
  });

  it('sets custom.source to atsf-enforcement', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput());
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.custom.source).toBe('atsf-enforcement');
  });

  it('spreads extra context into custom field', async () => {
    const engine = createMockEngine();
    const adapter = new SecurityPolicyEngineAdapter(engine);

    await adapter.preEvaluate(createInput({ context: { tenantId: 'acme', extra: 42 } }));
    const ctx = engine.evaluate.mock.calls[0][0];
    expect(ctx.custom.extra).toBe(42);
  });
});

// =============================================================================
// DECISION CONVERSION (convertDecision)
// =============================================================================

describe('Decision conversion (convertDecision)', () => {
  it('returns empty violations for allow with no matched policies', async () => {
    const engine = createMockEngine({
      outcome: 'allow',
      matchedPolicies: [],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());
    expect(violations).toEqual([]);
  });

  it('extracts deny violations from matched policies', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Policy violation',
      matchedPolicies: [{
        policyId: 'pol-1',
        policyName: 'Block High Risk',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'deny', reason: 'Risk too high' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      policyId: 'pol-1',
      policyName: 'Block High Risk',
      action: 'deny',
      reason: 'Risk too high',
    });
  });

  it('maps challenge actions to escalate violations', async () => {
    const engine = createMockEngine({
      outcome: 'challenge',
      reason: 'MFA required',
      matchedPolicies: [{
        policyId: 'pol-2',
        policyName: 'MFA Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'challenge', method: 'mfa' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('escalate');
    expect(violations[0].reason).toContain('mfa verification');
  });

  it('maps escalate actions to escalate violations', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Escalated',
      matchedPolicies: [{
        policyId: 'pol-3',
        policyName: 'Escalation Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'escalate', severity: 'high' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('escalate');
    expect(violations[0].reason).toContain('severity: high');
  });

  it('maps quarantine actions to deny violations', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Quarantined',
      matchedPolicies: [{
        policyId: 'pol-4',
        policyName: 'Quarantine Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'quarantine', duration: 3600, reason: 'Suspicious activity' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('deny');
    expect(violations[0].reason).toContain('Suspicious activity');
  });

  it('maps modify actions to limit violations', async () => {
    const engine = createMockEngine({
      outcome: 'allow',
      reason: 'Modified',
      matchedPolicies: [{
        policyId: 'pol-5',
        policyName: 'Modify Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'modify', addHeaders: { 'x-test': 'true' } } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('limit');
    expect(violations[0].reason).toContain('request modification');
  });

  it('maps notify actions to monitor violations', async () => {
    const engine = createMockEngine({
      outcome: 'allow',
      reason: 'Notified',
      matchedPolicies: [{
        policyId: 'pol-6',
        policyName: 'Notify Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'notify', channels: ['email'], severity: 'low' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('monitor');
    expect(violations[0].reason).toContain('severity: low');
  });

  it('maps log actions to monitor violations', async () => {
    const engine = createMockEngine({
      outcome: 'allow',
      reason: 'Logged',
      matchedPolicies: [{
        policyId: 'pol-7',
        policyName: 'Audit Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'log', level: 'info' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('monitor');
    expect(violations[0].reason).toContain('audit logging');
  });

  it('maps redirect actions to escalate violations', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Redirected',
      matchedPolicies: [{
        policyId: 'pol-8',
        policyName: 'Redirect Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [{ type: 'redirect', url: '/auth' } as PolicyAction],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('escalate');
    expect(violations[0].reason).toContain('redirect');
  });

  it('filters out allow actions from violations', async () => {
    const engine = createMockEngine({
      outcome: 'allow',
      reason: 'Allowed with logging',
      matchedPolicies: [{
        policyId: 'pol-9',
        policyName: 'Allow+Log Policy',
        policyVersion: '1.0',
        matched: true,
        conditionResults: [],
        ruleResults: [],
        actions: [
          { type: 'allow', message: 'ok' } as PolicyAction,
          { type: 'log', level: 'info' } as PolicyAction,
        ],
        durationMs: 1,
        evaluatedAt: new Date().toISOString(),
      }],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    // Only the log action should be a violation, not the allow
    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('monitor');
  });

  it('adds default deny violation when outcome is deny but no actions extracted', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'General denial',
      matchedPolicies: [],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      policyId: 'security-engine-default',
      policyName: 'Security Policy Engine',
      action: 'deny',
      reason: 'General denial',
    });
  });

  it('adds default escalation when outcome is challenge but no actions extracted', async () => {
    const engine = createMockEngine({
      outcome: 'challenge',
      reason: 'Verification required',
      matchedPolicies: [],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      policyId: 'security-engine-challenge',
      policyName: 'Security Policy Engine',
      action: 'escalate',
      reason: 'Verification required',
    });
  });

  it('adds default escalation when outcome is pending but no actions extracted', async () => {
    const engine = createMockEngine({
      outcome: 'pending',
      reason: 'Awaiting approval',
      matchedPolicies: [],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe('escalate');
    expect(violations[0].reason).toBe('Awaiting approval');
  });

  it('collects violations from multiple matched policies', async () => {
    const engine = createMockEngine({
      outcome: 'deny',
      reason: 'Multiple violations',
      matchedPolicies: [
        {
          policyId: 'pol-a',
          policyName: 'Policy A',
          policyVersion: '1.0',
          matched: true,
          conditionResults: [],
          ruleResults: [],
          actions: [{ type: 'deny', reason: 'Risk too high' } as PolicyAction],
          durationMs: 1,
          evaluatedAt: new Date().toISOString(),
        },
        {
          policyId: 'pol-b',
          policyName: 'Policy B',
          policyVersion: '1.0',
          matched: true,
          conditionResults: [],
          ruleResults: [],
          actions: [{ type: 'escalate', severity: 'critical' } as PolicyAction],
          durationMs: 1,
          evaluatedAt: new Date().toISOString(),
        },
      ],
    });
    const adapter = new SecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());

    expect(violations).toHaveLength(2);
    expect(violations[0].policyId).toBe('pol-a');
    expect(violations[0].action).toBe('deny');
    expect(violations[1].policyId).toBe('pol-b');
    expect(violations[1].action).toBe('escalate');
  });
});

// =============================================================================
// FACTORY
// =============================================================================

describe('createSecurityPolicyEngineAdapter', () => {
  it('creates adapter instance', () => {
    const engine = createMockEngine();
    const adapter = createSecurityPolicyEngineAdapter(engine);
    expect(adapter).toBeInstanceOf(SecurityPolicyEngineAdapter);
  });

  it('returned adapter evaluates correctly', async () => {
    const engine = createMockEngine({ outcome: 'allow', matchedPolicies: [] });
    const adapter = createSecurityPolicyEngineAdapter(engine);
    const violations = await adapter.preEvaluate(createInput());
    expect(violations).toEqual([]);
  });
});
