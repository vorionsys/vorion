/**
 * Tests for RuleEvaluator
 *
 * Validates evaluation of all 11 rule types:
 *   require_mfa, require_approval, block_access, rate_limit, require_encryption,
 *   audit_log, step_up_auth, data_masking, session_timeout, geo_restriction, custom
 *
 * Also covers: non-enforced rules, evaluateAll, custom handler registration,
 * setRateLimiter / setGeoLocationProvider, and unknown-rule-type error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleEvaluator } from '../rule-evaluator.js';
import type { PolicyContext, PolicyRule } from '../types.js';
import type { RateLimiter, GeoLocationProvider } from '../rule-evaluator.js';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid PolicyContext that every test can extend. */
function baseContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    request: {
      id: 'req-1',
      method: 'GET',
      path: '/api/data',
      url: 'https://example.com/api/data',
      ip: '10.0.0.1',
      headers: {},
    },
    user: {
      id: 'user-1',
      mfaVerified: false,
      sessionStartedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

/** Creates a mock RateLimiter. */
function mockRateLimiter(overrides: Partial<RateLimiter> = {}): RateLimiter {
  return {
    check: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
    increment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Creates a mock GeoLocationProvider. */
function mockGeoProvider(result: { country?: string; region?: string; city?: string } | null = null): GeoLocationProvider {
  return {
    lookup: vi.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator;

  beforeEach(() => {
    evaluator = new RuleEvaluator();
  });

  // =========================================================================
  // 1. Non-enforced rule
  // =========================================================================

  it('should pass immediately when a rule is not enforced', async () => {
    const rule: PolicyRule = { type: 'block_access', enforced: false, reason: 'Maintenance' };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(true);
    expect(result.enforced).toBe(false);
    expect(result.ruleType).toBe('block_access');
    expect(result.reason).toBe('Rule is not enforced');
  });

  // =========================================================================
  // 2. require_mfa
  // =========================================================================

  describe('require_mfa', () => {
    const mfaRule: PolicyRule = { type: 'require_mfa', enforced: true, methods: ['totp'] };

    it('should fail when MFA is not verified', async () => {
      const ctx = baseContext({ user: { id: 'u1', mfaVerified: false } });
      const result = await evaluator.evaluate(mfaRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('MFA verification required');
      expect(result.metadata?.methods).toEqual(['totp']);
    });

    it('should pass when MFA is verified', async () => {
      const ctx = baseContext({
        user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date().toISOString() },
      });
      const result = await evaluator.evaluate(mfaRule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('MFA verification passed');
    });

    it('should fail when MFA verification has expired', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const ruleWithTimeout: PolicyRule = {
        type: 'require_mfa',
        enforced: true,
        timeout: 60, // 60 seconds
      };
      const ctx = baseContext({
        user: { id: 'u1', mfaVerified: true, lastMfaAt: twoHoursAgo },
      });
      const result = await evaluator.evaluate(ruleWithTimeout, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('MFA verification expired');
      expect(result.metadata?.expiredAt).toBeDefined();
    });
  });

  // =========================================================================
  // 3. require_approval
  // =========================================================================

  describe('require_approval', () => {
    const approvalRule: PolicyRule = {
      type: 'require_approval',
      enforced: true,
      approvers: ['admin-1'],
      minApprovers: 2,
    };

    it('should fail when approval has not been granted', async () => {
      const ctx = baseContext({ custom: {} });
      const result = await evaluator.evaluate(approvalRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Approval required');
      expect(result.metadata?.approvers).toEqual(['admin-1']);
      expect(result.metadata?.minApprovers).toBe(2);
      expect(result.metadata?.timeout).toBe(3600); // defaultApprovalTimeout
    });

    it('should pass when approval is granted with an approvalId', async () => {
      const ctx = baseContext({
        custom: { approvalGranted: true, approvalId: 'appr-123' },
      });
      const result = await evaluator.evaluate(approvalRule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Approval granted');
      expect(result.metadata?.approvalId).toBe('appr-123');
    });
  });

  // =========================================================================
  // 4. block_access
  // =========================================================================

  it('should always fail for block_access when enforced', async () => {
    const rule: PolicyRule = {
      type: 'block_access',
      enforced: true,
      reason: 'System under maintenance',
      errorCode: 'MAINT_001',
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('System under maintenance');
    expect(result.metadata?.errorCode).toBe('MAINT_001');
  });

  // =========================================================================
  // 5. rate_limit
  // =========================================================================

  describe('rate_limit', () => {
    const rateLimitRule: PolicyRule = {
      type: 'rate_limit',
      enforced: true,
      limit: 100,
      window: 1,
      windowUnit: 'minute',
      keyBy: ['user', 'ip'],
    };

    it('should pass when within rate limit', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const result = await evaluator.evaluate(rateLimitRule, baseContext());

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Within rate limit');
      expect(result.metadata?.remaining).toBe(9);
      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('policy-rl'),
        100,
        60, // 1 * 60 for 'minute'
      );
    });

    it('should fail when rate limit is exceeded', async () => {
      const resetAt = Date.now() + 30_000;
      const limiter = mockRateLimiter({
        check: vi.fn().mockResolvedValue({ allowed: false, remaining: 0, resetAt }),
      });
      evaluator.setRateLimiter(limiter);

      const result = await evaluator.evaluate(rateLimitRule, baseContext());

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Rate limit exceeded');
      expect(result.metadata?.retryAfter).toBeDefined();
      expect(typeof result.metadata?.retryAfter).toBe('number');
    });

    it('should pass when no rate limiter is configured', async () => {
      // evaluator has no limiter set (default)
      const result = await evaluator.evaluate(rateLimitRule, baseContext());

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Rate limiter not configured');
    });
  });

  // =========================================================================
  // 6. require_encryption
  // =========================================================================

  describe('require_encryption', () => {
    const encRule: PolicyRule = { type: 'require_encryption', enforced: true };

    it('should pass when URL starts with https://', async () => {
      const ctx = baseContext(); // default url is https://
      const result = await evaluator.evaluate(encRule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Encryption requirements met');
    });

    it('should fail when URL is plain http', async () => {
      const ctx = baseContext({
        request: {
          id: 'req-2',
          method: 'GET',
          path: '/api',
          url: 'http://example.com/api',
          ip: '10.0.0.1',
          headers: {},
        },
      });
      const result = await evaluator.evaluate(encRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Encrypted connection required');
    });

    it('should pass when x-forwarded-proto header is https', async () => {
      const ctx = baseContext({
        request: {
          id: 'req-3',
          method: 'GET',
          path: '/api',
          url: 'http://example.com/api',
          ip: '10.0.0.1',
          headers: { 'x-forwarded-proto': 'https' },
        },
      });
      const result = await evaluator.evaluate(encRule, ctx);

      expect(result.passed).toBe(true);
    });
  });

  // =========================================================================
  // 7. audit_log
  // =========================================================================

  it('should always pass for audit_log rule', async () => {
    const rule: PolicyRule = {
      type: 'audit_log',
      enforced: true,
      level: 'detailed',
      includeRequest: true,
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(true);
    expect(result.reason).toBe('Audit logging enabled');
    expect(result.metadata?.level).toBe('detailed');
    expect(result.metadata?.includeRequest).toBe(true);
  });

  // =========================================================================
  // 8. step_up_auth
  // =========================================================================

  describe('step_up_auth', () => {
    const stepUpRule: PolicyRule = {
      type: 'step_up_auth',
      enforced: true,
      requiredLevel: 3,
      method: 'mfa',
    };

    it('should pass when auth level meets the requirement', async () => {
      const ctx = baseContext({ custom: { authLevel: 5 } });
      const result = await evaluator.evaluate(stepUpRule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Authentication level sufficient');
      expect(result.metadata?.currentLevel).toBe(5);
      expect(result.metadata?.requiredLevel).toBe(3);
    });

    it('should fail when auth level is below the requirement', async () => {
      const ctx = baseContext({ custom: { authLevel: 1 } });
      const result = await evaluator.evaluate(stepUpRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Step-up authentication required');
      expect(result.metadata?.currentLevel).toBe(1);
      expect(result.metadata?.requiredLevel).toBe(3);
      expect(result.metadata?.method).toBe('mfa');
    });
  });

  // =========================================================================
  // 9. data_masking
  // =========================================================================

  it('should always pass for data_masking rule', async () => {
    const rule: PolicyRule = {
      type: 'data_masking',
      enforced: true,
      fields: ['ssn', 'creditCard'],
      maskType: 'partial',
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(true);
    expect(result.reason).toBe('Data masking will be applied');
    expect(result.metadata?.fields).toEqual(['ssn', 'creditCard']);
    expect(result.metadata?.maskType).toBe('partial');
  });

  // =========================================================================
  // 10. session_timeout
  // =========================================================================

  describe('session_timeout', () => {
    const sessionRule: PolicyRule = {
      type: 'session_timeout',
      enforced: true,
      maxDuration: 3600,  // 1 hour max
      idleTimeout: 600,   // 10 min idle
    };

    it('should fail when max session duration is exceeded', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: twoHoursAgo },
        custom: { lastActivityAt: new Date().toISOString() }, // recent activity
      });
      const result = await evaluator.evaluate(sessionRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Session duration exceeded');
      expect(result.metadata?.maxDuration).toBe(3600);
      expect(result.metadata?.requireReauth).toBe(true);
    });

    it('should fail when idle timeout is exceeded', async () => {
      const now = Date.now();
      const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: new Date(now - 5 * 60 * 1000).toISOString() },
        custom: { lastActivityAt: new Date(now - 15 * 60 * 1000).toISOString() }, // 15 min idle > 10 min allowed
      });
      const result = await evaluator.evaluate(sessionRule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Session idle timeout exceeded');
      expect(result.metadata?.idleTimeout).toBe(600);
    });

    it('should pass when session is within valid bounds', async () => {
      const now = Date.now();
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: new Date(now - 10 * 60 * 1000).toISOString() },
        custom: { lastActivityAt: new Date(now - 60 * 1000).toISOString() }, // 1 min idle
      });
      const result = await evaluator.evaluate(sessionRule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Session is valid');
    });
  });

  // =========================================================================
  // 11. geo_restriction
  // =========================================================================

  describe('geo_restriction', () => {
    it('should fail when country is in the blocked list', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        blockedCountries: ['CN', 'RU'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'CN', region: 'BJ' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('blocked');
      expect(result.metadata?.country).toBe('CN');
    });

    it('should pass when country is in the allowed list', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['US', 'CA', 'GB'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'US', region: 'CA' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Geo restriction passed');
    });

    it('should fail closed when geo location cannot be determined', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['US'],
      };
      // No environment / geoLocation and no provider
      const ctx = baseContext({ environment: undefined });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Unable to determine geo location');
    });

    it('should use geoLocationProvider when context has no geo info', async () => {
      const provider = mockGeoProvider({ country: 'GB', region: 'LND' });
      evaluator.setGeoLocationProvider(provider);

      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['GB'],
      };
      const ctx = baseContext({ environment: undefined });
      const result = await evaluator.evaluate(rule, ctx);

      expect(provider.lookup).toHaveBeenCalledWith('10.0.0.1');
      expect(result.passed).toBe(true);
      expect(result.metadata?.country).toBe('GB');
    });
  });

  // =========================================================================
  // 12. custom
  // =========================================================================

  describe('custom', () => {
    it('should invoke a registered custom handler and return its result', async () => {
      const handler = vi.fn().mockResolvedValue({
        ruleType: 'custom' as const,
        enforced: true,
        passed: true,
        reason: 'Custom check passed',
      });
      evaluator.registerCustomHandler('my-check', handler);

      const rule: PolicyRule = { type: 'custom', enforced: true, handler: 'my-check' };
      const ctx = baseContext();
      const result = await evaluator.evaluate(rule, ctx);

      expect(handler).toHaveBeenCalledWith(rule, ctx);
      expect(result.passed).toBe(true);
      expect(result.reason).toBe('Custom check passed');
    });

    it('should fail when no handler is registered for the given name', async () => {
      const rule: PolicyRule = { type: 'custom', enforced: true, handler: 'nonexistent' };
      const result = await evaluator.evaluate(rule, baseContext());

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('No handler registered for: nonexistent');
    });
  });

  // =========================================================================
  // 13. evaluateAll
  // =========================================================================

  it('should process multiple rules and return all results via evaluateAll', async () => {
    const rules: PolicyRule[] = [
      { type: 'audit_log', enforced: true },
      { type: 'require_encryption', enforced: true },
      { type: 'block_access', enforced: true, reason: 'Denied' },
    ];

    const results = await evaluator.evaluateAll(rules, baseContext());

    expect(results).toHaveLength(3);
    expect(results[0].ruleType).toBe('audit_log');
    expect(results[0].passed).toBe(true);
    expect(results[1].ruleType).toBe('require_encryption');
    expect(results[1].passed).toBe(true); // https in default context
    expect(results[2].ruleType).toBe('block_access');
    expect(results[2].passed).toBe(false);
  });

  // =========================================================================
  // 14. Error handling — unknown rule type
  // =========================================================================

  it('should return passed=false for an unknown rule type', async () => {
    const rule = { type: 'totally_unknown', enforced: true } as unknown as PolicyRule;
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(false);
    expect(result.enforced).toBe(true);
    expect(result.reason).toContain('Unknown rule type');
  });

  // =========================================================================
  // 15. Custom handler unregistration
  // =========================================================================

  it('should unregister a custom handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      ruleType: 'custom' as const,
      enforced: true,
      passed: true,
      reason: 'ok',
    });
    evaluator.registerCustomHandler('temp', handler);

    const removed = evaluator.unregisterCustomHandler('temp');
    expect(removed).toBe(true);

    const rule: PolicyRule = { type: 'custom', enforced: true, handler: 'temp' };
    const result = await evaluator.evaluate(rule, baseContext());
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('No handler registered');
  });

  // =========================================================================
  // 16. Rate limit — key building (tenant, api_key, custom, windowUnit)
  // =========================================================================

  describe('rate_limit key building', () => {
    it('should include tenant in key when keyBy contains "tenant"', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 100,
        window: 1,
        windowUnit: 'minute',
        keyBy: ['tenant'],
      };
      const ctx = baseContext({
        user: { id: 'u1', tenant: 'acme' },
      });
      await evaluator.evaluate(rule, ctx);

      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('t:acme'),
        100,
        60,
      );
    });

    it('should include api_key (first 8 chars) when keyBy contains "api_key"', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 50,
        window: 1,
        windowUnit: 'second',
        keyBy: ['api_key'],
      };
      const ctx = baseContext({
        request: {
          id: 'req-1',
          method: 'GET',
          path: '/api',
          url: 'https://example.com/api',
          ip: '10.0.0.1',
          headers: { 'x-api-key': 'abcdefghijklmnop' },
        },
      });
      await evaluator.evaluate(rule, ctx);

      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('ak:abcdefgh'),
        50,
        1,
      );
    });

    it('should include custom key via nested path when keyBy contains "custom"', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 20,
        window: 5,
        windowUnit: 'minute',
        keyBy: ['custom'],
        customKey: 'custom.clientId',
      };
      const ctx = baseContext({
        custom: { clientId: 'cli-42' },
      });
      await evaluator.evaluate(rule, ctx);

      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('c:cli-42'),
        20,
        300,
      );
    });

    it('should calculate window in seconds for "hour" windowUnit', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 1000,
        window: 2,
        windowUnit: 'hour',
        keyBy: ['user'],
      };
      await evaluator.evaluate(rule, baseContext());

      expect(limiter.check).toHaveBeenCalledWith(
        expect.any(String),
        1000,
        7200, // 2 * 3600
      );
    });

    it('should calculate window in seconds for "day" windowUnit', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 10000,
        window: 1,
        windowUnit: 'day',
        keyBy: ['user'],
      };
      await evaluator.evaluate(rule, baseContext());

      expect(limiter.check).toHaveBeenCalledWith(
        expect.any(String),
        10000,
        86400, // 1 * 86400
      );
    });

    it('should default to "second" multiplier for undefined windowUnit', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 10,
        window: 30,
        keyBy: ['ip'],
      };
      await evaluator.evaluate(rule, baseContext());

      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('ip:10.0.0.1'),
        10,
        30, // 30 * 1 (default second)
      );
    });

    it('should default keyBy to ["user"] when not specified', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 100,
        window: 60,
        windowUnit: 'second',
      };
      await evaluator.evaluate(rule, baseContext());

      expect(limiter.check).toHaveBeenCalledWith(
        expect.stringContaining('u:user-1'),
        100,
        60,
      );
    });

    it('should handle rate limiter check error (fail open)', async () => {
      const limiter = mockRateLimiter({
        check: vi.fn().mockRejectedValue(new Error('Redis down')),
      });
      evaluator.setRateLimiter(limiter);

      const rule: PolicyRule = {
        type: 'rate_limit',
        enforced: true,
        limit: 100,
        window: 1,
        windowUnit: 'minute',
        keyBy: ['user'],
      };
      const result = await evaluator.evaluate(rule, baseContext());

      expect(result.passed).toBe(true);
      expect(result.reason).toContain('Rate limit check failed');
    });
  });

  // =========================================================================
  // 17. Geo-restriction — region blocking and allowing
  // =========================================================================

  describe('geo_restriction regions', () => {
    it('should fail when region is in blockedRegions', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        blockedRegions: ['BJ', 'SH'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'CN', region: 'BJ' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('blocked from region');
    });

    it('should fail when country-region combo is in blockedRegions', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        blockedRegions: ['CN-BJ'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'CN', region: 'BJ' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('blocked from region');
    });

    it('should fail when region is not in allowedRegions', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedRegions: ['CA', 'NY'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'US', region: 'TX' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('not allowed from region');
    });

    it('should pass when region is in allowedRegions', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedRegions: ['CA', 'NY'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'US', region: 'CA' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
    });

    it('should pass when country-region combo is in allowedRegions', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedRegions: ['US-CA'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'US', region: 'CA' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
    });

    it('should fail when country is not in allowed list', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['US', 'CA'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'JP', region: 'TK' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('not allowed from country');
    });

    it('should use geoLocationProvider when lookup fails gracefully', async () => {
      const provider = mockGeoProvider(null);
      (provider.lookup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));
      evaluator.setGeoLocationProvider(provider);

      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['US'],
      };
      const ctx = baseContext({ environment: undefined });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Unable to determine geo location');
    });

    it('should pass all checks and return metadata with country and region', async () => {
      const rule: PolicyRule = {
        type: 'geo_restriction',
        enforced: true,
        allowedCountries: ['US'],
        allowedRegions: ['CA'],
      };
      const ctx = baseContext({
        environment: {
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
          dayOfWeek: 1,
          hour: 10,
          geoLocation: { country: 'US', region: 'CA' },
        },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
      expect(result.metadata?.country).toBe('US');
      expect(result.metadata?.region).toBe('CA');
    });
  });

  // =========================================================================
  // 18. Session timeout — early returns
  // =========================================================================

  describe('session_timeout edge cases', () => {
    it('should pass when user has no sessionStartedAt', async () => {
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
        maxDuration: 3600,
      };
      const ctx = baseContext({
        user: { id: 'u1' }, // no sessionStartedAt
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('No session information available');
    });

    it('should pass when no user at all', async () => {
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
        maxDuration: 3600,
      };
      const ctx = baseContext({ user: undefined });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('No session information available');
    });

    it('should use sessionStartedAt as lastActivity when custom.lastActivityAt is missing', async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
        maxDuration: 7200,
        idleTimeout: 600, // 10 min
      };
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: fifteenMinAgo },
        // no custom.lastActivityAt
      });
      const result = await evaluator.evaluate(rule, ctx);

      // sessionStartedAt was 15 min ago, idleTimeout is 10 min => exceeded
      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Session idle timeout exceeded');
    });

    it('should use default idle timeout when not specified in rule', async () => {
      const customEval = new RuleEvaluator({ defaultSessionIdleTimeout: 120 }); // 2 min
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
      };
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: new Date().toISOString() },
        custom: { lastActivityAt: threeMinAgo },
      });
      const result = await customEval.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Session idle timeout exceeded');
      expect(result.metadata?.idleTimeout).toBe(120);
    });

    it('should report sessionAge and idleDuration when session is valid', async () => {
      const now = Date.now();
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
        maxDuration: 7200,
        idleTimeout: 600,
      };
      const ctx = baseContext({
        user: { id: 'u1', sessionStartedAt: new Date(now - 5 * 60 * 1000).toISOString() },
        custom: { lastActivityAt: new Date(now - 30 * 1000).toISOString() },
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(true);
      expect(result.metadata?.sessionAge).toBeGreaterThan(0);
      expect(result.metadata?.idleDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 19. MFA edge cases
  // =========================================================================

  describe('require_mfa edge cases', () => {
    it('should pass when no user present (mfaVerified check fails safely)', async () => {
      const rule: PolicyRule = { type: 'require_mfa', enforced: true };
      const ctx = baseContext({ user: undefined });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('MFA verification required');
    });

    it('should use default MFA timeout', async () => {
      const customEval = new RuleEvaluator({ defaultMfaTimeout: 60 });
      const rule: PolicyRule = { type: 'require_mfa', enforced: true };
      const ctx = baseContext({ user: { id: 'u1', mfaVerified: false } });
      const result = await customEval.evaluate(rule, ctx);

      expect(result.metadata?.timeout).toBe(60);
    });
  });

  // =========================================================================
  // 20. Approval edge cases
  // =========================================================================

  describe('require_approval edge cases', () => {
    it('should include approverRoles in metadata', async () => {
      const rule: PolicyRule = {
        type: 'require_approval',
        enforced: true,
        approverRoles: ['manager', 'admin'],
        requireJustification: true,
      };
      const result = await evaluator.evaluate(rule, baseContext());

      expect(result.passed).toBe(false);
      expect(result.metadata?.approverRoles).toEqual(['manager', 'admin']);
      expect(result.metadata?.requireJustification).toBe(true);
    });

    it('should not pass when approved but no approvalId', async () => {
      const rule: PolicyRule = {
        type: 'require_approval',
        enforced: true,
        approvers: ['admin-1'],
      };
      const ctx = baseContext({
        custom: { approvalGranted: true }, // no approvalId
      });
      const result = await evaluator.evaluate(rule, ctx);

      expect(result.passed).toBe(false);
    });
  });

  // =========================================================================
  // 21. Block access defaults
  // =========================================================================

  it('should use default reason for block_access when none provided', async () => {
    const rule: PolicyRule = {
      type: 'block_access',
      enforced: true,
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Access blocked by policy');
  });

  // =========================================================================
  // 22. Audit log defaults
  // =========================================================================

  it('should use default values for audit_log metadata', async () => {
    const rule: PolicyRule = {
      type: 'audit_log',
      enforced: true,
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(true);
    expect(result.metadata?.level).toBe('basic');
    expect(result.metadata?.includeRequest).toBe(false);
    expect(result.metadata?.includeResponse).toBe(false);
  });

  // =========================================================================
  // 23. Data masking defaults
  // =========================================================================

  it('should use default maskType "partial" when not specified', async () => {
    const rule: PolicyRule = {
      type: 'data_masking',
      enforced: true,
      fields: ['email'],
    };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(true);
    expect(result.metadata?.maskType).toBe('partial');
  });

  // =========================================================================
  // 24. Step-up auth boundary
  // =========================================================================

  it('should pass when authLevel equals requiredLevel', async () => {
    const rule: PolicyRule = {
      type: 'step_up_auth',
      enforced: true,
      requiredLevel: 3,
    };
    const ctx = baseContext({ custom: { authLevel: 3 } });
    const result = await evaluator.evaluate(rule, ctx);

    expect(result.passed).toBe(true);
    expect(result.reason).toBe('Authentication level sufficient');
  });

  it('should default authLevel to 0 when not in context', async () => {
    const rule: PolicyRule = {
      type: 'step_up_auth',
      enforced: true,
      requiredLevel: 1,
    };
    const ctx = baseContext({ custom: {} });
    const result = await evaluator.evaluate(rule, ctx);

    expect(result.passed).toBe(false);
    expect(result.metadata?.currentLevel).toBe(0);
  });

  // =========================================================================
  // 25. Custom handler error handling
  // =========================================================================

  it('should catch custom handler errors and return failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Handler crashed'));
    evaluator.registerCustomHandler('crasher', handler);

    const rule: PolicyRule = { type: 'custom', enforced: true, handler: 'crasher' };
    const result = await evaluator.evaluate(rule, baseContext());

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Custom handler error: Handler crashed');
  });

  // =========================================================================
  // 26. Top-level error handler
  // =========================================================================

  it('should catch unexpected errors and return evaluation error', async () => {
    // Force an error by passing null context
    const rule: PolicyRule = { type: 'require_encryption', enforced: true };
    const result = await evaluator.evaluate(rule, null as any);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Evaluation error');
  });

  // =========================================================================
  // 27. createRuleEvaluator factory
  // =========================================================================

  it('should create instance via factory function', async () => {
    const { createRuleEvaluator } = await import('../rule-evaluator.js');
    const eval2 = createRuleEvaluator();
    const rule: PolicyRule = { type: 'audit_log', enforced: true };
    const result = await eval2.evaluate(rule, baseContext());
    expect(result.passed).toBe(true);
  });

  // =========================================================================
  // 28. Constructor with options
  // =========================================================================

  it('should accept all options in constructor', () => {
    const customHandlers = new Map();
    const limiter = mockRateLimiter();
    const geo = mockGeoProvider({ country: 'US' });

    const evalWithOpts = new RuleEvaluator({
      rateLimiter: limiter,
      geoLocationProvider: geo,
      customHandlers,
      defaultMfaTimeout: 120,
      defaultApprovalTimeout: 1800,
      defaultSessionIdleTimeout: 900,
    });

    // Just verify it was constructed without error
    expect(evalWithOpts).toBeDefined();
  });

  // =========================================================================
  // 29. Mutation-killing: assert enforced=true in all passing results
  // =========================================================================

  describe('enforced field assertions', () => {
    it('require_mfa pass returns enforced=true', async () => {
      const ctx = baseContext({
        user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date().toISOString() },
      });
      const result = await evaluator.evaluate(
        { type: 'require_mfa', enforced: true, methods: ['totp'] },
        ctx,
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('require_mfa fail returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_mfa', enforced: true },
        baseContext({ user: { id: 'u1', mfaVerified: false } }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('require_approval pass returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_approval', enforced: true, approvers: ['a'] },
        baseContext({ custom: { approvalGranted: true, approvalId: 'appr-1' } }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('rate_limit pass returns enforced=true', async () => {
      evaluator.setRateLimiter(mockRateLimiter());
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 100, window: 1, keyBy: ['user'] },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('rate_limit without limiter returns enforced=true', async () => {
      const freshEval = new RuleEvaluator();
      const result = await freshEval.evaluate(
        { type: 'rate_limit', enforced: true, limit: 100, window: 1 },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('rate_limit error returns enforced=true', async () => {
      const limiter = mockRateLimiter({
        check: vi.fn().mockRejectedValue(new Error('fail')),
      });
      evaluator.setRateLimiter(limiter);
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 10, window: 1, keyBy: ['user'] },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
    });

    it('require_encryption pass returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_encryption', enforced: true },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('require_encryption fail returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_encryption', enforced: true },
        baseContext({
          request: { id: 'r', method: 'GET', path: '/', url: 'http://example.com/', ip: '1.2.3.4' },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('audit_log returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'audit_log', enforced: true },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('step_up_auth pass returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'step_up_auth', enforced: true, requiredLevel: 1 },
        baseContext({ custom: { authLevel: 5 } }),
      );
      expect(result.enforced).toBe(true);
    });

    it('data_masking returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'data_masking', enforced: true, fields: ['ssn'] },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('session_timeout pass returns enforced=true', async () => {
      const now = Date.now();
      const result = await evaluator.evaluate(
        { type: 'session_timeout', enforced: true, maxDuration: 7200, idleTimeout: 600 },
        baseContext({
          user: { id: 'u1', sessionStartedAt: new Date(now - 60000).toISOString() },
          custom: { lastActivityAt: new Date(now - 5000).toISOString() },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('session_timeout no-session returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'session_timeout', enforced: true, maxDuration: 3600 },
        baseContext({ user: undefined }),
      );
      expect(result.enforced).toBe(true);
    });

    it('session_timeout idle fail returns enforced=true', async () => {
      const now = Date.now();
      const result = await evaluator.evaluate(
        { type: 'session_timeout', enforced: true, idleTimeout: 60 },
        baseContext({
          user: { id: 'u1', sessionStartedAt: new Date(now - 60000).toISOString() },
          custom: { lastActivityAt: new Date(now - 120000).toISOString() },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('geo_restriction pass returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, allowedCountries: ['US'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'US', region: 'CA' },
          },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('geo_restriction blocked returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, blockedCountries: ['RU'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'RU', region: 'MOW' },
          },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('geo_restriction blocked region returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, blockedRegions: ['BJ'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'CN', region: 'BJ' },
          },
        }),
      );
      expect(result.enforced).toBe(true);
    });

    it('geo_restriction not in allowed region returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, allowedRegions: ['CA'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'US', region: 'TX' },
          },
        }),
      );
      expect(result.enforced).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('geo_restriction no info returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, allowedCountries: ['US'] },
        baseContext({ environment: undefined }),
      );
      expect(result.enforced).toBe(true);
    });

    it('custom handler pass returns enforced=true', async () => {
      evaluator.registerCustomHandler('e-test', async () => ({
        ruleType: 'custom',
        enforced: true,
        passed: true,
        reason: 'ok',
      }));
      const result = await evaluator.evaluate(
        { type: 'custom', enforced: true, handler: 'e-test' },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
    });

    it('custom handler missing returns enforced=true', async () => {
      const result = await evaluator.evaluate(
        { type: 'custom', enforced: true, handler: 'missing' },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
    });

    it('custom handler error returns enforced=true', async () => {
      evaluator.registerCustomHandler('err-test', async () => { throw new Error('boom'); });
      const result = await evaluator.evaluate(
        { type: 'custom', enforced: true, handler: 'err-test' },
        baseContext(),
      );
      expect(result.enforced).toBe(true);
    });
  });

  // =========================================================================
  // 30. Mutation-killing: metadata value precision
  // =========================================================================

  describe('metadata precision assertions', () => {
    it('session_timeout pass metadata has reasonable sessionAge and idleDuration', async () => {
      const now = Date.now();
      const sessionStart = now - 300_000; // 5 min ago
      const lastActivity = now - 30_000;  // 30 sec ago
      const rule: PolicyRule = {
        type: 'session_timeout',
        enforced: true,
        maxDuration: 7200,
        idleTimeout: 600,
      };
      const result = await evaluator.evaluate(rule, baseContext({
        user: { id: 'u1', sessionStartedAt: new Date(sessionStart).toISOString() },
        custom: { lastActivityAt: new Date(lastActivity).toISOString() },
      }));

      expect(result.passed).toBe(true);
      // sessionAge should be ~300 seconds (± a few for test execution time)
      expect(result.metadata?.sessionAge).toBeGreaterThanOrEqual(299);
      expect(result.metadata?.sessionAge).toBeLessThan(310);
      // idleDuration should be ~30 seconds
      expect(result.metadata?.idleDuration).toBeGreaterThanOrEqual(29);
      expect(result.metadata?.idleDuration).toBeLessThan(40);
    });

    it('session_timeout fail metadata has correct maxDuration and sessionAge', async () => {
      const now = Date.now();
      const sessionStart = now - 7200_000; // 2 hours ago
      const result = await evaluator.evaluate(
        { type: 'session_timeout', enforced: true, maxDuration: 3600, idleTimeout: 600 },
        baseContext({
          user: { id: 'u1', sessionStartedAt: new Date(sessionStart).toISOString() },
          custom: { lastActivityAt: new Date(now - 1000).toISOString() },
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.metadata?.sessionAge).toBeGreaterThanOrEqual(7199);
      expect(result.metadata?.sessionAge).toBeLessThan(7210);
    });

    it('session_timeout idle fail has correct idleDuration', async () => {
      const now = Date.now();
      const result = await evaluator.evaluate(
        { type: 'session_timeout', enforced: true, maxDuration: 7200, idleTimeout: 600 },
        baseContext({
          user: { id: 'u1', sessionStartedAt: new Date(now - 300_000).toISOString() },
          custom: { lastActivityAt: new Date(now - 900_000).toISOString() },
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.metadata?.idleDuration).toBeGreaterThanOrEqual(899);
      expect(result.metadata?.idleDuration).toBeLessThan(910);
      expect(result.metadata?.requireReauth).toBe(true);
    });

    it('MFA expiry metadata has correct expiredAt', async () => {
      const lastMfa = Date.now() - 120_000; // 2 min ago
      const timeout = 60; // 60 seconds
      const result = await evaluator.evaluate(
        { type: 'require_mfa', enforced: true, timeout },
        baseContext({
          user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date(lastMfa).toISOString() },
        }),
      );

      expect(result.passed).toBe(false);
      const expiredAt = new Date(result.metadata?.expiredAt as string).getTime();
      // expiredAt should be lastMfa + timeout*1000
      const expected = lastMfa + timeout * 1000;
      expect(Math.abs(expiredAt - expected)).toBeLessThan(100);
    });

    it('require_approval fail metadata has correct defaults', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_approval', enforced: true, approvers: ['a'] },
        baseContext(),
      );
      expect(result.passed).toBe(false);
      // Approval fail metadata includes approvers, timeout, minApprovers, requireJustification
      expect(result.metadata?.approvers).toEqual(['a']);
      expect(result.metadata?.minApprovers).toBe(1);
      expect(result.metadata?.requireJustification).toBe(false);
    });

    it('require_encryption pass metadata includes fields and algorithm', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_encryption', enforced: true, fields: ['ssn'], algorithm: 'AES-256' },
        baseContext(),
      );
      expect(result.passed).toBe(true);
      expect(result.metadata?.fields).toEqual(['ssn']);
      expect(result.metadata?.algorithm).toBe('AES-256');
    });

    it('require_encryption fail metadata includes fields and algorithm', async () => {
      const result = await evaluator.evaluate(
        { type: 'require_encryption', enforced: true, fields: ['cc'], algorithm: 'RSA' },
        baseContext({
          request: { id: 'r', method: 'GET', path: '/', url: 'http://example.com/', ip: '1.2.3.4' },
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.metadata?.fields).toEqual(['cc']);
      expect(result.metadata?.algorithm).toBe('RSA');
    });

    it('geo_restriction blocked metadata has country and region', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, blockedCountries: ['CN'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'CN', region: 'BJ' },
          },
        }),
      );
      expect(result.metadata?.country).toBe('CN');
      expect(result.metadata?.region).toBe('BJ');
    });

    it('geo_restriction blocked region metadata has country and region', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, blockedRegions: ['BJ'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'CN', region: 'BJ' },
          },
        }),
      );
      expect(result.metadata?.country).toBe('CN');
      expect(result.metadata?.region).toBe('BJ');
    });

    it('geo_restriction not-in-allowed-region metadata has country and region', async () => {
      const result = await evaluator.evaluate(
        { type: 'geo_restriction', enforced: true, allowedRegions: ['NY'] },
        baseContext({
          environment: {
            timestamp: new Date().toISOString(),
            timezone: 'UTC',
            dayOfWeek: 1,
            hour: 10,
            geoLocation: { country: 'US', region: 'TX' },
          },
        }),
      );
      expect(result.metadata?.country).toBe('US');
      expect(result.metadata?.region).toBe('TX');
    });
  });

  // =========================================================================
  // 31. Mutation-killing: getNestedValue null/undefined paths
  // =========================================================================

  describe('rate_limit with null/undefined context paths', () => {
    it('handles missing user for user keyBy', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 10, window: 1, keyBy: ['user'] },
        baseContext({ user: undefined }),
      );
      // Should still work (user.id would be undefined)
      expect(result.passed).toBe(true);
    });

    it('handles missing tenant for tenant keyBy', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 10, window: 1, keyBy: ['tenant'] },
        baseContext({ user: { id: 'u1' } }), // no tenant
      );
      expect(result.passed).toBe(true);
    });

    it('handles missing headers for api_key keyBy', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 10, window: 1, keyBy: ['api_key'] },
        baseContext(), // headers has no x-api-key
      );
      expect(result.passed).toBe(true);
    });

    it('handles missing custom path for custom keyBy', async () => {
      const limiter = mockRateLimiter();
      evaluator.setRateLimiter(limiter);
      const result = await evaluator.evaluate(
        { type: 'rate_limit', enforced: true, limit: 10, window: 1, keyBy: ['custom'], customKey: 'deep.nested.val' },
        baseContext({ custom: {} }),
      );
      expect(result.passed).toBe(true);
    });
  });

  // =========================================================================
  // 32. Mutation-killing: MFA timeout precision
  // =========================================================================

  describe('MFA timeout arithmetic', () => {
    it('uses rule.timeout * 1000 for millisecond conversion', async () => {
      const now = Date.now();
      const lastMfa = now - 61_000; // 61 seconds ago
      const result = await evaluator.evaluate(
        { type: 'require_mfa', enforced: true, timeout: 60 }, // 60 seconds
        baseContext({
          user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date(lastMfa).toISOString() },
        }),
      );
      // 61 sec > 60 sec timeout => should fail
      expect(result.passed).toBe(false);

      // Now test with 62 second timeout - should pass
      const result2 = await evaluator.evaluate(
        { type: 'require_mfa', enforced: true, timeout: 62 },
        baseContext({
          user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date(lastMfa).toISOString() },
        }),
      );
      expect(result2.passed).toBe(true);
    });

    it('passes when rule.timeout not set even with stale MFA (no timeout guard)', async () => {
      // When rule.timeout is not set, the timeout check block is skipped entirely
      // MFA passes as long as mfaVerified is true, regardless of lastMfaAt age
      const customEval = new RuleEvaluator({ defaultMfaTimeout: 30 });
      const now = Date.now();
      const result = await customEval.evaluate(
        { type: 'require_mfa', enforced: true },
        baseContext({
          user: { id: 'u1', mfaVerified: true, lastMfaAt: new Date(now - 31_000).toISOString() },
        }),
      );
      // Without explicit rule.timeout, no expiry check happens → passes
      expect(result.passed).toBe(true);
    });

    it('defaultMfaTimeout used in fail metadata when rule has explicit timeout', async () => {
      // The defaultMfaTimeout is used as fallback in the metadata, not as a guard
      const customEval = new RuleEvaluator({ defaultMfaTimeout: 45 });
      const result = await customEval.evaluate(
        { type: 'require_mfa', enforced: true },
        baseContext({
          user: { id: 'u1', mfaVerified: false },
        }),
      );
      expect(result.passed).toBe(false);
      // When MFA not verified, metadata.timeout = rule.timeout ?? defaultMfaTimeout
      expect(result.metadata?.timeout).toBe(45);
    });
  });
});
