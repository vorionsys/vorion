import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IntentGateway,
  createIntentGateway,
  GatewayConflictError,
} from '../../../packages/platform-core/src/intent-gateway/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockIntentService() {
  return {
    submit: vi.fn().mockResolvedValue({
      id: 'intent-123',
      tenantId: 'tenant-1',
      entityId: 'entity-1',
      goal: 'test goal',
      context: {},
      metadata: {},
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    get: vi.fn(),
    getWithEvents: vi.fn(),
    updateStatus: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    submitBulk: vi.fn(),
    updateTrustMetadata: vi.fn(),
    recordEvaluation: vi.fn(),
    verifyEventChain: vi.fn(),
    getRequiredTrustLevel: vi.fn().mockReturnValue(2),
  };
}

const ctx = { tenantId: 'tenant-1', userId: 'user-1' } as any;

function makeSubmission(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'entity-1',
    goal: 'test goal',
    context: {},
    ...overrides,
  };
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  return { ctx, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntentGateway', () => {
  let mockService: ReturnType<typeof createMockIntentService>;

  beforeEach(() => {
    mockService = createMockIntentService();
  });

  // =========================================================================
  // 1. createIntentGateway() factory
  // =========================================================================
  describe('createIntentGateway()', () => {
    it('returns an IntentGateway instance', () => {
      const gw = createIntentGateway(mockService as any);
      expect(gw).toBeInstanceOf(IntentGateway);
    });
  });

  // =========================================================================
  // 2. dispatch() with gateway disabled
  // =========================================================================
  describe('dispatch() with gateway disabled', () => {
    it('passes through to intentService.submit() directly', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: false });
      const submission = makeSubmission();
      const options = makeOptions();

      const result = await gw.dispatch(submission, options);

      expect(mockService.submit).toHaveBeenCalledOnce();
      expect(mockService.submit).toHaveBeenCalledWith(submission, options);
      expect(result.intent.id).toBe('intent-123');
      expect(result.regime.regimeId).toBe('regime-passthrough');
      expect(result.regime.name).toBe('passthrough');
      expect(result.warnings).toEqual([]);
    });
  });

  // =========================================================================
  // 3. dispatch() with gateway enabled
  // =========================================================================
  describe('dispatch() with gateway enabled', () => {
    it('calls intentService.submit() with enriched options', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const submission = makeSubmission();
      const options = makeOptions();

      await gw.dispatch(submission, options);

      expect(mockService.submit).toHaveBeenCalledOnce();
      // The options passed to submit should be enriched, not the original
      const calledOptions = mockService.submit.mock.calls[0][1];
      expect(calledOptions).not.toBe(options);
      expect(calledOptions.ctx).toBe(ctx);
      expect(calledOptions.trustSnapshot).toBeDefined();
    });
  });

  // =========================================================================
  // 4. dispatch() enriches trustSnapshot
  // =========================================================================
  describe('dispatch() enriches trustSnapshot', () => {
    it('adds __governanceRegime to trustSnapshot', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const submission = makeSubmission();
      const options = makeOptions({ trustSnapshot: { existing: 'data' } });

      await gw.dispatch(submission, options);

      const calledOptions = mockService.submit.mock.calls[0][1];
      expect(calledOptions.trustSnapshot).toBeDefined();
      expect(calledOptions.trustSnapshot.__governanceRegime).toBeDefined();
      const regime = calledOptions.trustSnapshot.__governanceRegime;
      expect(regime.regimeId).toBeDefined();
      expect(regime.name).toBeDefined();
      expect(regime.jurisdictions).toBeDefined();
      expect(regime.cryptoSuite).toBeDefined();
      expect(regime.minimumTrustLevel).toBeDefined();
    });
  });

  // =========================================================================
  // 5. dispatch() sets minimum trust level
  // =========================================================================
  describe('dispatch() sets minimum trust level', () => {
    it('enriched options have minimumTrustLevel from regime', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const submission = makeSubmission();
      // Do not provide a trustLevel; the gateway should set it from the regime
      const options = makeOptions();

      await gw.dispatch(submission, options);

      const calledOptions = mockService.submit.mock.calls[0][1];
      expect(calledOptions.trustLevel).toBeGreaterThanOrEqual(2);
    });

    it('upgrades trustLevel when lower than regime minimum', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const submission = makeSubmission();
      const options = makeOptions({ trustLevel: 1 });

      await gw.dispatch(submission, options);

      const calledOptions = mockService.submit.mock.calls[0][1];
      // Should be at least the regime's minimum (2 for GLOBAL default)
      expect(calledOptions.trustLevel).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // 6. dispatch() returns GatewayDispatchResult
  // =========================================================================
  describe('dispatch() returns GatewayDispatchResult', () => {
    it('has intent, regime, jurisdictionContext, policySet, warnings', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const submission = makeSubmission();
      const options = makeOptions();

      const result = await gw.dispatch(submission, options);

      expect(result).toHaveProperty('intent');
      expect(result.intent.id).toBe('intent-123');
      expect(result).toHaveProperty('regime');
      expect(result.regime.regimeId).toBeDefined();
      expect(result.regime.name).toBeDefined();
      expect(result.regime.jurisdictions).toBeInstanceOf(Array);
      expect(result).toHaveProperty('jurisdictionContext');
      expect(result.jurisdictionContext.primaryJurisdictions).toBeInstanceOf(
        Array,
      );
      expect(result.jurisdictionContext.industry).toBeDefined();
      expect(result).toHaveProperty('policySet');
      expect(result.policySet.constraints).toBeInstanceOf(Array);
      expect(result.policySet.sourceBundles).toBeInstanceOf(Array);
      expect(result).toHaveProperty('warnings');
      expect(result.warnings).toBeInstanceOf(Array);
    });
  });

  // =========================================================================
  // 7. dispatch() with EU jurisdiction
  // =========================================================================
  describe('dispatch() with EU jurisdiction', () => {
    it('triggers AI Act classification', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      // Register tenant with EU jurisdiction
      gw.registerTenantConfig('tenant-1', {
        jurisdictions: ['EU'],
        industry: 'general',
      });
      const submission = makeSubmission({ goal: 'simple data processing' });
      const options = makeOptions();

      const result = await gw.dispatch(submission, options);

      // EU jurisdiction means AI Act classifier runs; the regime should
      // have an aiActClassification set.
      expect(result.regime.aiActClassification).toBeDefined();
    });
  });

  // =========================================================================
  // 8. dispatch() with prohibited AI Act
  // =========================================================================
  describe('dispatch() with prohibited AI Act', () => {
    it('adds warning about PROHIBITED', async () => {
      const gw = new IntentGateway(mockService as any, {
        enabled: true,
        blockOnConflicts: false,
      });
      gw.registerTenantConfig('tenant-1', {
        jurisdictions: ['EU'],
        industry: 'general',
      });
      // Use a goal that triggers the "unacceptable" classification
      const submission = makeSubmission({
        goal: 'implement social scoring system',
      });
      const options = makeOptions();

      const result = await gw.dispatch(submission, options);

      expect(result.regime.aiActClassification).toBe('unacceptable');
      expect(result.warnings.some((w) => w.includes('PROHIBITED'))).toBe(true);
    });
  });

  // =========================================================================
  // 9. dispatch() graceful degradation
  // =========================================================================
  describe('dispatch() graceful degradation', () => {
    it('on internal error, falls through to direct submit with warning', async () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      // Force an error in jurisdiction resolution by providing a ctx that
      // will cause extractTenantId to throw (null ctx property).
      const badCtx = null as any;
      const submission = makeSubmission();
      const options = { ctx: badCtx };

      const result = await gw.dispatch(submission, options);

      // Should still return a result (graceful degradation)
      expect(result.intent.id).toBe('intent-123');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Gateway degraded');
      expect(result.regime.regimeId).toBe('regime-passthrough');
    });
  });

  // =========================================================================
  // 10. dispatch() GatewayConflictError
  // =========================================================================
  describe('dispatch() GatewayConflictError', () => {
    it('throws when blockOnConflicts is true and unresolved conflicts exist', async () => {
      const gw = new IntentGateway(mockService as any, {
        enabled: true,
        blockOnConflicts: true,
      });
      // Register tenant with conflicting jurisdictions that produce
      // incompatible data residency constraints (EU + US-DOD).
      gw.registerTenantConfig('tenant-1', {
        jurisdictions: ['EU', 'US-DOD'],
        industry: 'defense',
      });
      const submission = makeSubmission();
      const options = makeOptions();

      await expect(gw.dispatch(submission, options)).rejects.toThrow(
        GatewayConflictError,
      );

      try {
        await gw.dispatch(submission, options);
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayConflictError);
        expect((err as GatewayConflictError).conflicts.length).toBeGreaterThan(
          0,
        );
        expect((err as GatewayConflictError).name).toBe('GatewayConflictError');
      }
    });
  });

  // =========================================================================
  // 11. resolveRegime()
  // =========================================================================
  describe('resolveRegime()', () => {
    it('returns regime, jurisdictionContext, policySet', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const result = gw.resolveRegime(ctx);

      expect(result).toHaveProperty('regime');
      expect(result.regime.regimeId).toBeDefined();
      expect(result.regime.name).toBeDefined();
      expect(result.regime.jurisdictions).toBeInstanceOf(Array);
      expect(result).toHaveProperty('jurisdictionContext');
      expect(
        result.jurisdictionContext.primaryJurisdictions,
      ).toBeInstanceOf(Array);
      expect(result).toHaveProperty('policySet');
      expect(result.policySet.constraints).toBeInstanceOf(Array);
    });
  });

  // =========================================================================
  // 12. resolveRegime() caching
  // =========================================================================
  describe('resolveRegime() caching', () => {
    it('second call returns cached result', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      const first = gw.resolveRegime(ctx);
      const second = gw.resolveRegime(ctx);

      // Should be the exact same object references because of caching
      expect(second.regime).toBe(first.regime);
      expect(second.jurisdictionContext).toBe(first.jurisdictionContext);
      expect(second.policySet).toBe(first.policySet);
    });
  });

  // =========================================================================
  // 13. registerTenantConfig()
  // =========================================================================
  describe('registerTenantConfig()', () => {
    it('updates tenant config and invalidates cache', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });

      // Resolve once to populate cache
      const first = gw.resolveRegime(ctx);
      expect(first.jurisdictionContext.primaryJurisdictions).toContain('GLOBAL');

      // Register tenant config with EU
      gw.registerTenantConfig('tenant-1', {
        jurisdictions: ['EU'],
        industry: 'healthcare',
      });

      // Resolve again -- cache should be invalidated, so new config is used
      const second = gw.resolveRegime(ctx);
      expect(second.jurisdictionContext.primaryJurisdictions).toContain('EU');
      expect(second.jurisdictionContext.industry).toBe('healthcare');
      // Should not be the cached regime from before
      expect(second.regime).not.toBe(first.regime);
    });
  });

  // =========================================================================
  // 14. getActiveRegime() - returns cached regime
  // =========================================================================
  describe('getActiveRegime()', () => {
    it('returns cached regime for tenant', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });

      // Initially no cache
      expect(gw.getActiveRegime('tenant-1')).toBeUndefined();

      // Resolve to populate cache
      const resolved = gw.resolveRegime(ctx);

      // Now should return the cached regime
      const active = gw.getActiveRegime('tenant-1');
      expect(active).toBeDefined();
      expect(active!.regimeId).toBe(resolved.regime.regimeId);
    });
  });

  // =========================================================================
  // 15. getActiveRegime() - unknown tenant
  // =========================================================================
  describe('getActiveRegime() for unknown tenant', () => {
    it('returns undefined for unknown tenant', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });
      expect(gw.getActiveRegime('unknown-tenant')).toBeUndefined();
    });
  });

  // =========================================================================
  // 16. clearCache()
  // =========================================================================
  describe('clearCache()', () => {
    it('clears all cached regimes', () => {
      const gw = new IntentGateway(mockService as any, { enabled: true });

      // Populate cache
      gw.resolveRegime(ctx);
      expect(gw.getActiveRegime('tenant-1')).toBeDefined();

      // Clear
      gw.clearCache();

      // Should be gone
      expect(gw.getActiveRegime('tenant-1')).toBeUndefined();
    });
  });

  // =========================================================================
  // 17. getConfig()
  // =========================================================================
  describe('getConfig()', () => {
    it('returns readonly config copy', () => {
      const gw = new IntentGateway(mockService as any, {
        enabled: false,
        defaultJurisdiction: 'US',
      });

      const config = gw.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.defaultJurisdiction).toBe('US');

      // Should be a copy -- mutating it should not affect the gateway
      (config as any).enabled = true;
      const config2 = gw.getConfig();
      expect(config2.enabled).toBe(false);
    });
  });

  // =========================================================================
  // 18. getIntentService()
  // =========================================================================
  describe('getIntentService()', () => {
    it('returns the wrapped intent service', () => {
      const gw = new IntentGateway(mockService as any);
      expect(gw.getIntentService()).toBe(mockService);
    });
  });
});
