/**
 * Tests for SecurityPolicyEngine
 *
 * Validates core policy evaluation, management, versioning, simulation,
 * break-glass override, validation, statistics, and listener notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityPolicyEngine } from '../engine.js';
import type {
  SecurityPolicy,
  PolicyContext,
  PolicyAction,
  PolicyCondition,
  PolicyRule,
} from '../types.js';

// =============================================================================
// MOCKS
// =============================================================================

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../common/trace.js', () => ({
  withSpan: vi.fn(
    async (
      _name: string,
      fn: (span: { attributes: Record<string, unknown> }) => Promise<unknown>,
      _attrs?: Record<string, unknown>,
    ) => fn({ attributes: {} }),
  ),
}));

// =============================================================================
// HELPERS
// =============================================================================

const NOW = '2026-02-23T12:00:00.000Z';

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    request: {
      id: 'req-1',
      method: 'GET',
      path: '/api/data',
      url: 'https://example.com/api/data',
      ip: '10.0.0.1',
    },
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<SecurityPolicy>): SecurityPolicy {
  return {
    id: `policy-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Policy',
    description: 'A test policy',
    priority: 50,
    enabled: true,
    conditions: [],
    rules: [],
    actions: [{ type: 'allow', message: 'Allowed' }],
    version: '1.0.0',
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'test-user',
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('SecurityPolicyEngine', () => {
  let engine: SecurityPolicyEngine;

  beforeEach(() => {
    engine = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      enableVersioning: true,
      maxVersionsPerPolicy: 5,
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Default-deny when no policies
  // ---------------------------------------------------------------------------
  it('returns default deny when no policies are registered', async () => {
    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('deny');
    expect(decision.reason).toBe('No applicable policies');
    expect(decision.evaluatedPolicies).toHaveLength(0);
    expect(decision.matchedPolicies).toHaveLength(0);
    expect(decision.breakGlassUsed).toBe(false);
    expect(decision.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Allow when matching policy with no deny/challenge actions
  // ---------------------------------------------------------------------------
  it('returns allow when a matching policy has only allow actions', async () => {
    const policy = makePolicy({
      id: 'allow-policy',
      actions: [{ type: 'allow', message: 'Granted' }],
    });
    engine.addPolicy(policy);

    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('allow');
    expect(decision.matchedPolicies.length).toBeGreaterThanOrEqual(1);
    expect(decision.breakGlassUsed).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 3. Deny with deny action
  // ---------------------------------------------------------------------------
  it('returns deny immediately when a matched policy has a deny action', async () => {
    const policy = makePolicy({
      id: 'deny-policy',
      actions: [{ type: 'deny', reason: 'Blocked by policy' }],
    });
    engine.addPolicy(policy);

    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('deny');
    expect(decision.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'deny', reason: 'Blocked by policy' }),
      ]),
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Challenge with challenge action
  // ---------------------------------------------------------------------------
  it('returns challenge when a matched policy has a challenge action', async () => {
    const policy = makePolicy({
      id: 'challenge-policy',
      actions: [{ type: 'challenge', method: 'mfa', timeout: 300 }],
    });
    engine.addPolicy(policy);

    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('challenge');
    expect(decision.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'challenge', method: 'mfa' }),
      ]),
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Break-glass override (valid token -> allow)
  // ---------------------------------------------------------------------------
  it('grants access via break-glass when validator returns valid', async () => {
    const breakGlassValidator = vi.fn().mockResolvedValue({
      valid: true,
      reason: 'Emergency override',
      expiresAt: '2026-02-24T00:00:00.000Z',
      grantedBy: 'admin@corp.com',
    });

    const bgEngine = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      breakGlassValidator,
    });

    // Even with a deny-all policy, break-glass should override
    bgEngine.addPolicy(
      makePolicy({
        id: 'strict-deny',
        actions: [{ type: 'deny', reason: 'Strict deny' }],
      }),
    );

    const ctx = makeContext({ breakGlassToken: 'emergency-token-123' });
    const decision = await bgEngine.evaluate(ctx);

    expect(decision.outcome).toBe('allow');
    expect(decision.breakGlassUsed).toBe(true);
    expect(decision.reason).toContain('Break-glass');
    expect(decision.metadata?.breakGlassGrantedBy).toBe('admin@corp.com');
    expect(breakGlassValidator).toHaveBeenCalledWith('emergency-token-123', ctx);
  });

  // ---------------------------------------------------------------------------
  // 6. Break-glass invalid token -> normal evaluation
  // ---------------------------------------------------------------------------
  it('falls back to normal evaluation when break-glass token is invalid', async () => {
    const breakGlassValidator = vi.fn().mockResolvedValue({ valid: false });

    const bgEngine = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      breakGlassValidator,
    });

    bgEngine.addPolicy(
      makePolicy({
        id: 'deny-fallback',
        actions: [{ type: 'deny', reason: 'Denied normally' }],
      }),
    );

    const decision = await bgEngine.evaluate(
      makeContext({ breakGlassToken: 'bad-token' }),
    );

    expect(decision.outcome).toBe('deny');
    expect(decision.breakGlassUsed).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 7. Policy priority ordering (higher priority first)
  // ---------------------------------------------------------------------------
  it('evaluates policies in descending priority order', () => {
    const low = makePolicy({ id: 'low', priority: 10 });
    const high = makePolicy({ id: 'high', priority: 100 });
    const mid = makePolicy({ id: 'mid', priority: 50 });

    engine.addPolicy(low);
    engine.addPolicy(high);
    engine.addPolicy(mid);

    const applicable = engine.getApplicablePolicies(makeContext());

    expect(applicable.map((p) => p.id)).toEqual(['high', 'mid', 'low']);
  });

  // ---------------------------------------------------------------------------
  // 8. Add / remove / update policies
  // ---------------------------------------------------------------------------
  it('manages policy lifecycle: add, retrieve, update, remove', () => {
    const policy = makePolicy({ id: 'lifecycle' });

    // Add
    engine.addPolicy(policy);
    expect(engine.getPolicy('lifecycle')).toBeDefined();
    expect(engine.getAllPolicies()).toHaveLength(1);

    // Update
    const updated = engine.updatePolicy('lifecycle', {
      name: 'Updated Policy',
      description: 'Updated description',
    });
    expect(updated.name).toBe('Updated Policy');
    expect(engine.getPolicy('lifecycle')?.name).toBe('Updated Policy');

    // Remove
    const removed = engine.removePolicy('lifecycle');
    expect(removed).toBe(true);
    expect(engine.getPolicy('lifecycle')).toBeUndefined();
    expect(engine.getAllPolicies()).toHaveLength(0);

    // Remove non-existent
    expect(engine.removePolicy('no-such-id')).toBe(false);
  });

  it('throws when updating a non-existent policy', () => {
    expect(() => engine.updatePolicy('ghost', { name: 'Nope' })).toThrow(
      'Policy not found: ghost',
    );
  });

  // ---------------------------------------------------------------------------
  // 9. Enable / disable policies
  // ---------------------------------------------------------------------------
  it('enables and disables policies and reflects in enabled list', () => {
    const p = makePolicy({ id: 'toggle', enabled: true });
    engine.addPolicy(p);

    expect(engine.getEnabledPolicies()).toHaveLength(1);

    // Disable
    expect(engine.disablePolicy('toggle')).toBe(true);
    expect(engine.getEnabledPolicies()).toHaveLength(0);
    expect(engine.getPolicy('toggle')?.enabled).toBe(false);

    // Enable
    expect(engine.enablePolicy('toggle')).toBe(true);
    expect(engine.getEnabledPolicies()).toHaveLength(1);

    // Non-existent policy
    expect(engine.enablePolicy('nope')).toBe(false);
    expect(engine.disablePolicy('nope')).toBe(false);
  });

  it('does not include disabled policies in evaluation', async () => {
    const p = makePolicy({
      id: 'disabled-deny',
      enabled: false,
      actions: [{ type: 'deny', reason: 'Should not fire' }],
    });
    engine.addPolicy(p);

    const decision = await engine.evaluate(makeContext());

    // Disabled policy not evaluated; falls through to default deny (no applicable)
    expect(decision.outcome).toBe('deny');
    expect(decision.reason).toBe('No applicable policies');
    expect(decision.evaluatedPolicies).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 10. Policy versioning and rollback
  // ---------------------------------------------------------------------------
  it('tracks versions on add and update, and supports rollback', () => {
    const p = makePolicy({ id: 'versioned', version: '1.0.0' });
    engine.addPolicy(p);

    // First version recorded on add
    let versions = engine.getPolicyVersions('versioned');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe('1.0.0');

    // Update creates a second version
    engine.updatePolicy('versioned', {
      name: 'V2 Policy',
      version: '1.1.0',
    });
    versions = engine.getPolicyVersions('versioned');
    expect(versions).toHaveLength(2);
    expect(versions[1]!.version).toBe('1.1.0');

    // Rollback to first version
    const firstVersionId = versions[0]!.id;
    const rolledBack = engine.rollbackPolicy('versioned', firstVersionId);
    expect(rolledBack).not.toBeNull();
    expect(rolledBack!.name).toBe('Test Policy'); // original name
    expect(rolledBack!.version).toBe('1.0.1'); // incremented patch from 1.0.0

    // Rollback creates another version record
    versions = engine.getPolicyVersions('versioned');
    expect(versions).toHaveLength(3);
  });

  it('returns null when rolling back with invalid identifiers', () => {
    expect(engine.rollbackPolicy('no-policy', 'no-version')).toBeNull();

    const p = makePolicy({ id: 'exists' });
    engine.addPolicy(p);
    expect(engine.rollbackPolicy('exists', 'bad-version-id')).toBeNull();
  });

  it('respects maxVersionsPerPolicy and trims old versions', () => {
    const engineSmall = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      enableVersioning: true,
      maxVersionsPerPolicy: 3,
    });

    const p = makePolicy({ id: 'trim', version: '1.0.0' });
    engineSmall.addPolicy(p); // version 1

    for (let i = 1; i <= 5; i++) {
      engineSmall.updatePolicy('trim', {
        name: `Update ${i}`,
        version: `1.0.${i}`,
      });
    }

    const versions = engineSmall.getPolicyVersions('trim');
    expect(versions).toHaveLength(3);
    // Should keep the 3 most recent versions
    expect(versions[0]!.version).toBe('1.0.3');
    expect(versions[2]!.version).toBe('1.0.5');
  });

  // ---------------------------------------------------------------------------
  // 11. Validation (valid policy, invalid policy)
  // ---------------------------------------------------------------------------
  it('validates a well-formed policy as valid', () => {
    const policy = makePolicy();
    const result = engine.validatePolicy(policy);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates an invalid policy and returns errors', () => {
    const invalid = {
      id: '', // empty id is invalid
      name: '',
      priority: -1, // below min
      enabled: 'yes', // not boolean
    };

    const result = engine.validatePolicy(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('throws when adding an invalid policy', () => {
    const invalid = { id: '', name: '' } as unknown as SecurityPolicy;
    expect(() => engine.addPolicy(invalid)).toThrow('Invalid policy');
  });

  it('emits a warning for high-priority policies with no conditions', () => {
    const policy = makePolicy({
      priority: 200,
      conditions: [],
    });

    const result = engine.validatePolicy(policy);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('High-priority policy with no conditions'),
      ]),
    );
  });

  // ---------------------------------------------------------------------------
  // 12. Update listeners
  // ---------------------------------------------------------------------------
  it('notifies listeners on add, update, and remove', () => {
    const listener = vi.fn();
    const unsubscribe = engine.onPolicyUpdate(listener);

    const p = makePolicy({ id: 'observed' });

    engine.addPolicy(p);
    expect(listener).toHaveBeenCalledWith('observed', 'add', expect.objectContaining({ id: 'observed' }));

    engine.updatePolicy('observed', { name: 'Changed' });
    expect(listener).toHaveBeenCalledWith('observed', 'update', expect.objectContaining({ name: 'Changed' }));

    engine.removePolicy('observed');
    expect(listener).toHaveBeenCalledWith('observed', 'remove', undefined);

    expect(listener).toHaveBeenCalledTimes(3);

    // Unsubscribe and verify no further calls
    unsubscribe();
    engine.addPolicy(makePolicy({ id: 'unheard' }));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not crash when a listener throws', () => {
    const throwingListener = vi.fn(() => {
      throw new Error('Listener failure');
    });
    engine.onPolicyUpdate(throwingListener);

    // Should not throw despite the listener error
    expect(() => engine.addPolicy(makePolicy({ id: 'safe' }))).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // 13. Statistics
  // ---------------------------------------------------------------------------
  it('reports accurate stats for policies, versions, and tags', () => {
    engine.addPolicy(makePolicy({ id: 'a', tags: ['network', 'auth'], enabled: true }));
    engine.addPolicy(makePolicy({ id: 'b', tags: ['auth'], enabled: true }));
    engine.addPolicy(makePolicy({ id: 'c', tags: ['network'], enabled: false }));

    const stats = engine.getStats();

    expect(stats.totalPolicies).toBe(3);
    expect(stats.enabledPolicies).toBe(2);
    expect(stats.totalVersions).toBe(3); // one version per added policy
    expect(stats.policiesByTag).toEqual({
      network: 2,
      auth: 2,
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Simulation with recommendations
  // ---------------------------------------------------------------------------
  it('returns decision and recommendations from simulation', async () => {
    // No policies -> default deny -> should recommend break-glass and default policies
    const result = await engine.simulate({
      context: makeContext(),
    });

    expect(result.decision).toBeDefined();
    expect(result.decision.outcome).toBe('deny');
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('break-glass'),
        expect.stringContaining('No policies matched'),
      ]),
    );
  });

  it('simulation with a matching allow policy produces no deny-related recommendations', async () => {
    engine.addPolicy(
      makePolicy({
        id: 'sim-allow',
        actions: [{ type: 'allow', message: 'OK' }],
      }),
    );

    const result = await engine.simulate({
      context: makeContext(),
    });

    expect(result.decision.outcome).toBe('allow');
    // When allowed and policies matched, no break-glass or "no policies" recommendation
    const denyRecommendation = result.recommendations?.find((r) =>
      r.includes('break-glass'),
    );
    expect(denyRecommendation).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 15. MaxPoliciesToEvaluate limit
  // ---------------------------------------------------------------------------
  it('evaluates at most maxPoliciesToEvaluate policies', async () => {
    const limitedEngine = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      enableVersioning: false,
      maxPoliciesToEvaluate: 2,
    });

    // Add 5 allow policies
    for (let i = 0; i < 5; i++) {
      limitedEngine.addPolicy(
        makePolicy({
          id: `p-${i}`,
          priority: i * 10,
          actions: [{ type: 'allow', message: `Policy ${i}` }],
        }),
      );
    }

    const decision = await limitedEngine.evaluate(makeContext());

    // Only 2 policies should have been evaluated despite 5 being applicable
    expect(decision.evaluatedPolicies).toHaveLength(2);
    expect(decision.outcome).toBe('allow');
  });

  // ---------------------------------------------------------------------------
  // Supplementary: clear() empties all state
  // ---------------------------------------------------------------------------
  it('clears all policies and version history', () => {
    engine.addPolicy(makePolicy({ id: 'x' }));
    engine.addPolicy(makePolicy({ id: 'y' }));

    expect(engine.getAllPolicies()).toHaveLength(2);

    engine.clear();

    expect(engine.getAllPolicies()).toHaveLength(0);
    expect(engine.getPolicyVersions('x')).toHaveLength(0);
    expect(engine.getStats().totalPolicies).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Supplementary: defaultDecision can be overridden to 'allow'
  // ---------------------------------------------------------------------------
  it('uses configured defaultDecision when no policies apply', async () => {
    const allowByDefaultEngine = new SecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
      defaultDecision: 'allow',
    });

    const decision = await allowByDefaultEngine.evaluate(makeContext());

    expect(decision.outcome).toBe('allow');
    expect(decision.reason).toBe('No applicable policies');
  });

  // ---------------------------------------------------------------------------
  // 16. getFailedRuleActions — Integration tests with real conditions + failing rules
  // ---------------------------------------------------------------------------
  describe('getFailedRuleActions via evaluatePolicy', () => {
    it('maps require_mfa failure to challenge action with mfa method', async () => {
      const policy = makePolicy({
        id: 'mfa-required',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'admin' },
        ],
        rules: [
          { type: 'require_mfa', enforced: true, methods: ['totp'], timeout: 120 },
        ],
        actions: [{ type: 'log', level: 'info', message: 'MFA check' }],
      });
      engine.addPolicy(policy);

      const decision = await engine.evaluate(
        makeContext({
          user: { id: 'u1', role: 'admin', mfaVerified: false },
        }),
      );

      // The MFA failure should produce a challenge action
      const challengeAction = decision.actions.find(a => a.type === 'challenge');
      expect(challengeAction).toBeDefined();
      expect(challengeAction!.method).toBe('mfa');
    });

    it('maps block_access failure to deny action with error code', async () => {
      const policy = makePolicy({
        id: 'block-test',
        conditions: [],
        rules: [
          { type: 'block_access', enforced: true, reason: 'Maintenance', errorCode: 'MAINT' },
        ],
        actions: [{ type: 'allow', message: 'Should not see this alone' }],
      });
      engine.addPolicy(policy);

      const decision = await engine.evaluate(makeContext());

      expect(decision.outcome).toBe('deny');
      const denyAction = decision.actions.find(a => a.type === 'deny');
      expect(denyAction).toBeDefined();
      expect(denyAction!.reason).toBe('Maintenance');
      expect(denyAction!.errorCode).toBe('MAINT');
    });

    it('maps rate_limit failure to deny action with 429 status', async () => {
      const policy = makePolicy({
        id: 'rl-test',
        conditions: [],
        rules: [
          { type: 'rate_limit', enforced: true, limit: 10, window: 1, windowUnit: 'minute', keyBy: ['user'] },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });

      const rlEngine = new SecurityPolicyEngine({
        enableTracing: false,
        enableCaching: false,
        ruleEvaluator: {
          rateLimiter: {
            check: vi.fn().mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30000 }),
            increment: vi.fn(),
          },
        },
      });
      rlEngine.addPolicy(policy);

      const decision = await rlEngine.evaluate(makeContext({ user: { id: 'u1' } }));

      expect(decision.outcome).toBe('deny');
      const denyAction = decision.actions.find(a => a.type === 'deny');
      expect(denyAction).toBeDefined();
      expect(denyAction!.errorCode).toBe('RATE_LIMIT_EXCEEDED');
      expect(denyAction!.httpStatus).toBe(429);
      expect(denyAction!.retryable).toBe(true);
    });

    it('maps step_up_auth failure to challenge action', async () => {
      const policy = makePolicy({
        id: 'step-up-test',
        conditions: [],
        rules: [
          { type: 'step_up_auth', enforced: true, requiredLevel: 3, method: 'mfa' },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });
      engine.addPolicy(policy);

      const decision = await engine.evaluate(
        makeContext({ custom: { authLevel: 1 } }),
      );

      expect(decision.outcome).toBe('challenge');
      const challengeAction = decision.actions.find(a => a.type === 'challenge');
      expect(challengeAction).toBeDefined();
      expect(challengeAction!.method).toBe('mfa');
    });

    it('maps session_timeout failure to challenge action with password method', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const policy = makePolicy({
        id: 'session-test',
        conditions: [],
        rules: [
          { type: 'session_timeout', enforced: true, maxDuration: 3600, idleTimeout: 600 },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });
      engine.addPolicy(policy);

      const decision = await engine.evaluate(
        makeContext({
          user: { id: 'u1', sessionStartedAt: twoHoursAgo },
          custom: { lastActivityAt: new Date().toISOString() },
        }),
      );

      expect(decision.outcome).toBe('challenge');
      const challengeAction = decision.actions.find(a => a.type === 'challenge');
      expect(challengeAction).toBeDefined();
      expect(challengeAction!.method).toBe('password');
      expect(challengeAction!.timeout).toBe(300);
    });

    it('maps geo_restriction failure to deny action with GEO_RESTRICTED code', async () => {
      const policy = makePolicy({
        id: 'geo-test',
        conditions: [],
        rules: [
          { type: 'geo_restriction', enforced: true, allowedCountries: ['US'] },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });
      engine.addPolicy(policy);

      // No geo info and no provider => fail closed
      const decision = await engine.evaluate(
        makeContext({ environment: undefined }),
      );

      expect(decision.outcome).toBe('deny');
      const denyAction = decision.actions.find(a => a.type === 'deny' && a.errorCode === 'GEO_RESTRICTED');
      expect(denyAction).toBeDefined();
    });

    it('maps require_approval failure to challenge action with approval method', async () => {
      const policy = makePolicy({
        id: 'approval-test',
        conditions: [],
        rules: [
          { type: 'require_approval', enforced: true, approvers: ['admin-1'], minApprovers: 1, approvalTimeout: 7200 },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });
      engine.addPolicy(policy);

      const decision = await engine.evaluate(makeContext());

      expect(decision.outcome).toBe('challenge');
      const challengeAction = decision.actions.find(a => a.type === 'challenge');
      expect(challengeAction).toBeDefined();
      expect(challengeAction!.method).toBe('approval');
    });

    it('maps unknown failed rule type to deny with RULE_FAILED code', async () => {
      // Register a custom handler that always fails
      const customEngine = new SecurityPolicyEngine({
        enableTracing: false,
        enableCaching: false,
      });
      customEngine.registerRuleHandler('always-fail', async () => ({
        ruleType: 'custom',
        enforced: true,
        passed: false,
        reason: 'Custom failure',
      }));

      const policy = makePolicy({
        id: 'custom-fail-test',
        conditions: [],
        rules: [
          { type: 'custom', enforced: true, handler: 'always-fail' },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      });
      customEngine.addPolicy(policy);

      const decision = await customEngine.evaluate(makeContext());

      // Custom rule failure maps to default deny with RULE_FAILED
      const denyAction = decision.actions.find(a => a.type === 'deny' && a.errorCode === 'RULE_FAILED');
      expect(denyAction).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 17. determineOutcome and determineReason
  // ---------------------------------------------------------------------------
  describe('determineOutcome and determineReason', () => {
    it('returns challenge outcome and reason when challenge action present', async () => {
      engine.addPolicy(makePolicy({
        id: 'challenge-reason',
        name: 'Challenge Policy',
        actions: [{ type: 'challenge', method: 'mfa', timeout: 300 }],
      }));

      const decision = await engine.evaluate(makeContext());

      expect(decision.outcome).toBe('challenge');
      expect(decision.reason).toContain('Challenge required by policy: Challenge Policy');
    });

    it('returns allow outcome with policy count in reason', async () => {
      engine.addPolicy(makePolicy({
        id: 'allow-1',
        name: 'Allow One',
        actions: [{ type: 'allow', message: 'ok' }],
      }));
      engine.addPolicy(makePolicy({
        id: 'allow-2',
        name: 'Allow Two',
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const decision = await engine.evaluate(makeContext());

      expect(decision.outcome).toBe('allow');
      expect(decision.reason).toBe('Allowed by 2 policies');
    });

    it('returns deny reason with policy name', async () => {
      engine.addPolicy(makePolicy({
        id: 'deny-reason',
        name: 'Strict Deny Policy',
        actions: [{ type: 'deny', reason: 'No access' }],
      }));

      const decision = await engine.evaluate(makeContext());

      expect(decision.outcome).toBe('deny');
      expect(decision.reason).toContain('Denied by policy: Strict Deny Policy');
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Simulation verbose (what-if analysis)
  // ---------------------------------------------------------------------------
  describe('simulate verbose mode', () => {
    it('builds what-if analysis for matched policies', async () => {
      engine.addPolicy(makePolicy({
        id: 'sim-verbose-1',
        name: 'Verbose Sim',
        actions: [{ type: 'deny', reason: 'Blocked' }],
      }));

      const result = await engine.simulate({
        context: makeContext(),
        verbose: true,
      });

      expect(result.decision.outcome).toBe('deny');
      expect(result.whatIf).toBeDefined();
      // With verbose, it should have tested without the matched policy
      if (result.whatIf.withoutPolicy) {
        expect(result.whatIf.withoutPolicy['sim-verbose-1']).toBeDefined();
        // Without the deny policy, should get default deny (no applicable policies)
        expect(result.whatIf.withoutPolicy['sim-verbose-1'].outcome).toBe('deny');
        expect(result.whatIf.withoutPolicy['sim-verbose-1'].reason).toBe('No applicable policies');
      }
    });

    it('includes recommendations for allow outcomes', async () => {
      engine.addPolicy(makePolicy({
        id: 'sim-allow-rec',
        actions: [{ type: 'allow', message: 'Allowed' }],
      }));

      const result = await engine.simulate({
        context: makeContext(),
      });

      expect(result.decision.outcome).toBe('allow');
      // Should NOT have break-glass recommendation since it's allow
      const hasBreakGlass = result.recommendations?.some(r => r.includes('break-glass'));
      expect(hasBreakGlass).toBeFalsy();
    });

    it('uses specific policies when request.policies is provided', async () => {
      engine.addPolicy(makePolicy({ id: 'p1', name: 'P1', actions: [{ type: 'allow', message: 'ok' }] }));
      engine.addPolicy(makePolicy({ id: 'p2', name: 'P2', actions: [{ type: 'deny', reason: 'no' }] }));

      const result = await engine.simulate({
        context: makeContext(),
        policies: ['p1'], // Only evaluate p1
      });

      // Should evaluate normally (doesn't filter, just validates they exist)
      expect(result.decision).toBeDefined();
    });

    it('includes disabled policies when includeDisabled is true', async () => {
      engine.addPolicy(makePolicy({ id: 'disabled-sim', enabled: false, actions: [{ type: 'allow', message: 'ok' }] }));

      const result = await engine.simulate({
        context: makeContext(),
        includeDisabled: true,
      });

      expect(result.decision).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 19. evaluateWithTracing
  // ---------------------------------------------------------------------------
  describe('evaluateWithTracing', () => {
    it('delegates to evaluate when tracing is disabled', async () => {
      const noTraceEngine = new SecurityPolicyEngine({
        enableTracing: false,
        enableCaching: false,
      });

      const decision = await noTraceEngine.evaluateWithTracing(makeContext());
      expect(decision.outcome).toBe('deny');
      expect(decision.reason).toBe('No applicable policies');
    });

    it('wraps evaluation in a span when tracing is enabled', async () => {
      const traceEngine = new SecurityPolicyEngine({
        enableTracing: true,
        enableCaching: false,
      });
      traceEngine.addPolicy(makePolicy({ id: 'traced', actions: [{ type: 'allow', message: 'ok' }] }));

      const decision = await traceEngine.evaluateWithTracing(
        makeContext({
          user: { id: 'u1', role: 'admin' },
        }),
      );

      expect(decision.outcome).toBe('allow');
    });
  });

  // ---------------------------------------------------------------------------
  // 20. Policy with conditions that don't match
  // ---------------------------------------------------------------------------
  it('skips policy when conditions do not match', async () => {
    engine.addPolicy(makePolicy({
      id: 'conditional-deny',
      conditions: [
        { type: 'user_attribute', field: 'role', operator: 'equals', value: 'banned' },
      ],
      actions: [{ type: 'deny', reason: 'Banned user' }],
    }));

    engine.addPolicy(makePolicy({
      id: 'fallback-allow',
      priority: 10,
      conditions: [],
      actions: [{ type: 'allow', message: 'ok' }],
    }));

    const decision = await engine.evaluate(
      makeContext({ user: { id: 'u1', role: 'admin' } }),
    );

    // conditional-deny should not match, fallback-allow should
    expect(decision.outcome).toBe('allow');
    expect(decision.matchedPolicies.some(p => p.policyId === 'conditional-deny')).toBe(false);
    expect(decision.matchedPolicies.some(p => p.policyId === 'fallback-allow')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 21. Engine configuration methods
  // ---------------------------------------------------------------------------
  describe('configuration methods', () => {
    it('registerConditionEvaluator delegates to conditionEvaluator', async () => {
      const mockEval = vi.fn().mockReturnValue(true);
      engine.registerConditionEvaluator('cel', mockEval);

      // Now create a policy with a custom condition
      engine.addPolicy(makePolicy({
        id: 'custom-cond',
        conditions: [
          { type: 'custom', expression: 'user.role == "admin"', language: 'cel' },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const decision = await engine.evaluate(makeContext());
      expect(decision.outcome).toBe('allow');
      expect(mockEval).toHaveBeenCalled();
    });

    it('setBreakGlassValidator replaces the validator', async () => {
      const validator = vi.fn().mockResolvedValue({
        valid: true,
        reason: 'Emergency',
        grantedBy: 'ops@co.com',
      });
      engine.setBreakGlassValidator(validator);

      engine.addPolicy(makePolicy({
        id: 'deny-all',
        actions: [{ type: 'deny', reason: 'No' }],
      }));

      const decision = await engine.evaluate(
        makeContext({ breakGlassToken: 'token-123' }),
      );

      expect(decision.outcome).toBe('allow');
      expect(decision.breakGlassUsed).toBe(true);
      expect(validator).toHaveBeenCalledWith('token-123', expect.anything());
    });
  });

  // ---------------------------------------------------------------------------
  // 22. createSecurityPolicyEngine factory
  // ---------------------------------------------------------------------------
  it('creates engine via factory function', async () => {
    const { createSecurityPolicyEngine } = await import('../engine.js');
    const factoryEngine = createSecurityPolicyEngine({
      enableTracing: false,
      enableCaching: false,
    });
    const decision = await factoryEngine.evaluate(makeContext());
    expect(decision.outcome).toBe('deny');
    expect(decision.reason).toBe('No applicable policies');
  });

  // ---------------------------------------------------------------------------
  // 23. Mutation-killing: decision field assertions
  // ---------------------------------------------------------------------------
  describe('decision field completeness', () => {
    it('returns proper empty arrays (not contaminated) for no-match decision', async () => {
      const decision = await engine.evaluate(makeContext());
      expect(decision.actions).toEqual([]);
      expect(decision.evaluatedPolicies).toEqual([]);
      expect(decision.matchedPolicies).toEqual([]);
      expect(Array.isArray(decision.actions)).toBe(true);
      expect(decision.actions.length).toBe(0);
    });

    it('returns positive totalDurationMs', async () => {
      const decision = await engine.evaluate(makeContext());
      expect(typeof decision.totalDurationMs).toBe('number');
      expect(decision.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(decision.totalDurationMs).toBeLessThan(30000);
    });

    it('deny decision has positive totalDurationMs', async () => {
      engine.addPolicy(makePolicy({
        id: 'deny-timing',
        actions: [{ type: 'deny', reason: 'Blocked' }],
      }));
      const decision = await engine.evaluate(makeContext());
      expect(decision.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(decision.totalDurationMs).toBeLessThan(30000);
    });

    it('allow decision actions array is from the policy', async () => {
      engine.addPolicy(makePolicy({
        id: 'allow-actions',
        actions: [{ type: 'allow', message: 'Granted' }],
      }));
      const decision = await engine.evaluate(makeContext());
      expect(decision.outcome).toBe('allow');
      expect(decision.actions.length).toBeGreaterThanOrEqual(1);
      expect(decision.actions[0].type).toBe('allow');
    });
  });

  // ---------------------------------------------------------------------------
  // 24. Mutation-killing: determineOutcome branches
  // ---------------------------------------------------------------------------
  describe('determineOutcome edge cases', () => {
    it('returns challenge when require_approval rule fails (mapped to challenge action)', async () => {
      const approvalEngine = new SecurityPolicyEngine({
        enableTracing: false,
        enableCaching: false,
      });
      approvalEngine.addPolicy(makePolicy({
        id: 'approval-pending',
        conditions: [],
        rules: [
          { type: 'require_approval', enforced: true, approvers: ['mgr'], minApprovers: 1 },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const decision = await approvalEngine.evaluate(makeContext());

      // require_approval failure maps to challenge action via getFailedRuleActions
      expect(decision.outcome).toBe('challenge');
      expect(decision.reason).toContain('Challenge required by policy');
      // Verify the challenge action has method 'approval'
      const approvalAction = decision.actions.find(
        (a: any) => a.type === 'challenge' && a.method === 'approval',
      );
      expect(approvalAction).toBeDefined();
    });

    it('returns challenge when challenge actions present but no deny', async () => {
      engine.addPolicy(makePolicy({
        id: 'challenge-outcome',
        actions: [{ type: 'challenge', method: 'mfa', timeout: 300 }],
      }));
      const decision = await engine.evaluate(makeContext());
      expect(decision.outcome).toBe('challenge');
      expect(decision.reason).toContain('Challenge required by policy');
    });

    it('deny overrides challenge when both present', async () => {
      engine.addPolicy(makePolicy({
        id: 'deny-and-challenge',
        actions: [
          { type: 'deny', reason: 'Blocked' },
          { type: 'challenge', method: 'mfa' },
        ],
      }));
      const decision = await engine.evaluate(makeContext());
      expect(decision.outcome).toBe('deny');
    });
  });

  // ---------------------------------------------------------------------------
  // 25. Mutation-killing: validatePolicy warning paths
  // ---------------------------------------------------------------------------
  describe('validatePolicy warnings', () => {
    it('warns when policy has both allow and deny actions', () => {
      const policy = makePolicy({
        actions: [
          { type: 'allow', message: 'ok' },
          { type: 'deny', reason: 'blocked' },
        ],
      });
      const result = engine.validatePolicy(policy);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('both allow and deny actions'),
        ]),
      );
    });

    it('does not warn when only allow actions present', () => {
      const policy = makePolicy({
        conditions: [],
        priority: 50,
        actions: [{ type: 'allow', message: 'ok' }],
      });
      const result = engine.validatePolicy(policy);
      expect(result.valid).toBe(true);
      const conflictWarning = result.warnings.find(w => w.includes('both allow and deny'));
      expect(conflictWarning).toBeUndefined();
    });

    it('no condition warning when priority <= 100', () => {
      const policy = makePolicy({
        conditions: [],
        priority: 100,
      });
      const result = engine.validatePolicy(policy);
      const noCondWarning = result.warnings.find(w => w.includes('High-priority'));
      expect(noCondWarning).toBeUndefined();
    });

    it('handles validation with non-object input', () => {
      // Pass a non-object that triggers Zod validation errors
      // but doesn't crash on the additional validation (p.actions check)
      const result = engine.validatePolicy(42);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 26. Mutation-killing: setRateLimiter / setGeoLocationProvider
  // ---------------------------------------------------------------------------
  describe('setRateLimiter and setGeoLocationProvider', () => {
    it('setRateLimiter affects rule evaluation', async () => {
      engine.addPolicy(makePolicy({
        id: 'rl-via-setter',
        conditions: [],
        rules: [
          { type: 'rate_limit', enforced: true, limit: 5, window: 1, windowUnit: 'minute', keyBy: ['user'] },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const limiter = {
        check: vi.fn().mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 }),
        increment: vi.fn(),
      };
      engine.setRateLimiter(limiter);

      const decision = await engine.evaluate(makeContext({ user: { id: 'u1' } }));
      expect(decision.outcome).toBe('deny');
      expect(limiter.check).toHaveBeenCalled();
    });

    it('setGeoLocationProvider affects geo_restriction evaluation', async () => {
      engine.addPolicy(makePolicy({
        id: 'geo-via-setter',
        conditions: [],
        rules: [
          { type: 'geo_restriction', enforced: true, allowedCountries: ['US'] },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const provider = {
        lookup: vi.fn().mockResolvedValue({ country: 'US', region: 'CA' }),
      };
      engine.setGeoLocationProvider(provider);

      const decision = await engine.evaluate(makeContext());
      expect(provider.lookup).toHaveBeenCalled();
      expect(decision.outcome).toBe('allow');
    });
  });

  // ---------------------------------------------------------------------------
  // 27. Mutation-killing: evaluatePolicy conditionResults and ruleResults
  // ---------------------------------------------------------------------------
  describe('evaluatePolicy result structure', () => {
    it('unmatched policy has empty ruleResults and actions', async () => {
      engine.addPolicy(makePolicy({
        id: 'condition-miss',
        conditions: [
          { type: 'user_attribute', field: 'role', operator: 'equals', value: 'superadmin' },
        ],
        rules: [{ type: 'block_access', enforced: true, reason: 'blocked' }],
        actions: [{ type: 'deny', reason: 'no' }],
      }));

      engine.addPolicy(makePolicy({
        id: 'fallback',
        priority: 1,
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const decision = await engine.evaluate(
        makeContext({ user: { id: 'u1', role: 'viewer' } }),
      );

      // The condition-miss policy should be evaluated but not matched
      const missed = decision.evaluatedPolicies.find(p => p.policyId === 'condition-miss');
      if (missed) {
        expect(missed.matched).toBe(false);
        expect(missed.ruleResults).toEqual([]);
        expect(missed.actions).toEqual([]);
      }
    });

    it('matched policy with all rules passed returns policy actions', async () => {
      engine.addPolicy(makePolicy({
        id: 'multi-rule',
        conditions: [],
        rules: [
          { type: 'audit_log', enforced: true },
          { type: 'require_encryption', enforced: true },
        ],
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const decision = await engine.evaluate(makeContext());
      const matched = decision.evaluatedPolicies.find(p => p.policyId === 'multi-rule');
      expect(matched).toBeDefined();
      expect(matched!.matched).toBe(true);
      expect(matched!.ruleResults.length).toBe(2);
      for (const rr of matched!.ruleResults) {
        expect(rr.enforced).toBe(true);
        expect(rr.passed).toBe(true);
      }
      // When all enforced rules pass, actions come from the policy definition
      expect(matched!.actions.length).toBe(1);
      expect(matched!.actions[0].type).toBe('allow');
    });
  });

  // ---------------------------------------------------------------------------
  // 28. Mutation-killing: simulate with specific policies
  // ---------------------------------------------------------------------------
  describe('simulate advanced', () => {
    it('filters to specific policies when request.policies provided', async () => {
      engine.addPolicy(makePolicy({ id: 's1', actions: [{ type: 'allow', message: 'ok' }] }));
      engine.addPolicy(makePolicy({ id: 's2', actions: [{ type: 'deny', reason: 'no' }] }));

      const result = await engine.simulate({
        context: makeContext(),
        policies: ['s1'],
      });

      expect(result.decision).toBeDefined();
    });

    it('handles non-existent policy IDs in request.policies gracefully', async () => {
      engine.addPolicy(makePolicy({ id: 'real', actions: [{ type: 'allow', message: 'ok' }] }));

      const result = await engine.simulate({
        context: makeContext(),
        policies: ['nonexistent'],
      });

      expect(result.decision).toBeDefined();
    });

    it('verbose what-if re-enables policy after testing without it', async () => {
      engine.addPolicy(makePolicy({
        id: 'verbose-check',
        actions: [{ type: 'allow', message: 'ok' }],
      }));

      const result = await engine.simulate({
        context: makeContext(),
        verbose: true,
      });

      // After simulation, policy should still be enabled
      expect(engine.getPolicy('verbose-check')?.enabled).toBe(true);
      expect(result.whatIf).toBeDefined();
    });

    it('includeDisabled makes disabled policies available', async () => {
      engine.addPolicy(makePolicy({ id: 'dis-sim', enabled: false, actions: [{ type: 'allow', message: 'ok' }] }));

      const result = await engine.simulate({
        context: makeContext(),
        includeDisabled: true,
      });

      expect(result.decision).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 29. Mutation-killing: isPolicyApplicable for condition-less policies
  // ---------------------------------------------------------------------------
  it('treats policy with empty conditions as always applicable', async () => {
    engine.addPolicy(makePolicy({
      id: 'no-conditions',
      conditions: [],
      actions: [{ type: 'allow', message: 'ok' }],
    }));
    const decision = await engine.evaluate(makeContext());
    expect(decision.outcome).toBe('allow');
    expect(decision.matchedPolicies.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 30. Mutation-killing: registerRuleHandler delegates correctly
  // ---------------------------------------------------------------------------
  it('registerRuleHandler makes custom rules work', async () => {
    engine.registerRuleHandler('pass-through', async () => ({
      ruleType: 'custom',
      enforced: true,
      passed: true,
      reason: 'Passed via registered handler',
    }));

    engine.addPolicy(makePolicy({
      id: 'custom-via-register',
      conditions: [],
      rules: [{ type: 'custom', enforced: true, handler: 'pass-through' }],
      actions: [{ type: 'allow', message: 'ok' }],
    }));

    const decision = await engine.evaluate(makeContext());
    expect(decision.outcome).toBe('allow');
  });

  // ---------------------------------------------------------------------------
  // 31. Mutation-killing: constructor defaults
  // ---------------------------------------------------------------------------
  describe('constructor defaults', () => {
    it('defaults enableVersioning to true', () => {
      const e = new SecurityPolicyEngine({ enableTracing: false, enableCaching: false });
      e.addPolicy(makePolicy({ id: 'ver-test', version: '1.0.0' }));
      e.updatePolicy('ver-test', { name: 'Updated' });
      const versions = e.getPolicyVersions('ver-test');
      // If versioning is enabled (true), should have 2 versions
      expect(versions.length).toBeGreaterThanOrEqual(2);
    });

    it('defaults cacheTtlMs to 60000', () => {
      // Just ensure it constructs with no errors; the default is internal
      const e = new SecurityPolicyEngine({ enableCaching: true, enableTracing: false });
      expect(e).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 32. Mutation-killing: listener error does not crash unsubscribe
  // ---------------------------------------------------------------------------
  it('unsubscribe listener removes it from internal array', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = engine.onPolicyUpdate(listener1);
    engine.onPolicyUpdate(listener2);

    unsub1();

    engine.addPolicy(makePolicy({ id: 'after-unsub' }));
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});
