import { describe, it, expect, beforeEach } from 'vitest';
import {
  QuotaManager,
  InMemoryQuotaStorage,
  createQuotaManager,
  checkQuotaMiddleware,
} from '../src/routing/quota-manager.js';
import type { TenantQuotaConfig, UsageRecord } from '../src/routing/quota-manager.js';

describe('QuotaManager', () => {
  let storage: InMemoryQuotaStorage;
  let manager: QuotaManager;

  beforeEach(() => {
    storage = new InMemoryQuotaStorage();
    manager = new QuotaManager(storage, {
      enableCache: false, // Disable cache for deterministic tests
      defaultLimits: [
        { type: 'requests', period: 'minute', limit: 10, softLimit: 8 },
        { type: 'tokens', period: 'day', limit: 50000, softLimit: 40000 },
        { type: 'cost', period: 'month', limit: 5, softLimit: 4 },
      ],
      cacheTtlMs: 0,
      syncIntervalMs: 10000,
      gracePeriodMs: 60000,
    });
  });

  // ============================================
  // QUOTA CHECK — BASIC
  // ============================================

  describe('checkQuota', () => {
    it('should allow requests under quota', async () => {
      const result = await manager.checkQuota('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.exceededQuotas).toHaveLength(0);
    });

    it('should block requests exceeding hard limit', async () => {
      // Record enough requests to exceed limit (10 per minute)
      for (let i = 0; i < 10; i++) {
        await storage.incrementUsage('tenant-1', 'requests', 'minute', 1);
      }

      const result = await manager.checkQuota('tenant-1');
      expect(result.allowed).toBe(false);
      expect(result.exceededQuotas.length).toBeGreaterThan(0);
    });

    it('should generate warnings at soft limit', async () => {
      // Record usage up to soft limit (8 per minute)
      for (let i = 0; i < 8; i++) {
        await storage.incrementUsage('tenant-1', 'requests', 'minute', 1);
      }

      const result = await manager.checkQuota('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should bypass all checks for unlimited tier', async () => {
      await storage.setTenantConfig({
        tenantId: 'unlimited-1',
        tier: 'unlimited',
        limits: [],
      });

      const result = await manager.checkQuota('unlimited-1');
      expect(result.allowed).toBe(true);
      expect(result.quotas).toHaveLength(0);
    });

    it('should provide retryAfterMs when rate limited', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.incrementUsage('tenant-1', 'requests', 'minute', 1);
      }

      const result = await manager.checkQuota('tenant-1');
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs!).toBeGreaterThan(0);
    });
  });

  // ============================================
  // BURST ALLOWANCE
  // ============================================

  describe('burst allowance', () => {
    it('should allow burst when configured', async () => {
      await storage.setTenantConfig({
        tenantId: 'burst-tenant',
        tier: 'professional',
        limits: [
          { type: 'requests', period: 'minute', limit: 10, softLimit: 8 },
        ],
        burstAllowed: true,
        burstMultiplier: 1.5,
      });

      // Fill up to hard limit
      for (let i = 0; i < 10; i++) {
        await storage.incrementUsage('burst-tenant', 'requests', 'minute', 1);
      }

      const result = await manager.checkQuota('burst-tenant');
      expect(result.allowed).toBe(true);
      expect(result.burstUsed).toBe(true);
    });

    it('should block even with burst when limit fully exceeded', async () => {
      await storage.setTenantConfig({
        tenantId: 'burst-tenant',
        tier: 'professional',
        limits: [
          { type: 'requests', period: 'minute', limit: 10, softLimit: 8 },
        ],
        burstAllowed: true,
        burstMultiplier: 1.5,
      });

      // Exceed burst limit (10 * 1.5 = 15)
      for (let i = 0; i < 15; i++) {
        await storage.incrementUsage('burst-tenant', 'requests', 'minute', 1);
      }

      const result = await manager.checkQuota('burst-tenant');
      expect(result.allowed).toBe(false);
    });
  });

  // ============================================
  // USAGE RECORDING
  // ============================================

  describe('recordUsage', () => {
    it('should increment usage counters for all periods', async () => {
      const record: UsageRecord = {
        tenantId: 'tenant-1',
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        cost: 0.01,
        latencyMs: 500,
        success: true,
      };

      await manager.recordUsage(record);

      const usage = await storage.getUsage('tenant-1', 'requests', 'minute');
      expect(usage).toBe(1);

      const tokens = await storage.getUsage('tenant-1', 'tokens', 'minute');
      expect(tokens).toBe(300);
    });

    it('should skip recording for unlimited tier', async () => {
      await storage.setTenantConfig({
        tenantId: 'unlimited-1',
        tier: 'unlimited',
        limits: [],
      });

      const record: UsageRecord = {
        tenantId: 'unlimited-1',
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        cost: 0.01,
        latencyMs: 500,
        success: true,
      };

      await manager.recordUsage(record);
      const usage = await storage.getUsage('unlimited-1', 'requests', 'minute');
      expect(usage).toBe(0);
    });
  });

  // ============================================
  // TIER MANAGEMENT
  // ============================================

  describe('tier management', () => {
    it('should use free tier limits by default', async () => {
      const config = await manager.getTenantConfig('new-tenant');
      expect(config.tier).toBe('free');
    });

    it('should return tier-specific limits', () => {
      const freeLimits = manager.getTierLimits('free');
      expect(freeLimits.length).toBeGreaterThan(0);

      const enterpriseLimits = manager.getTierLimits('enterprise');
      expect(enterpriseLimits.length).toBeGreaterThan(0);

      // Enterprise should have higher limits than free
      const freeRequestLimit = freeLimits.find(l => l.type === 'requests' && l.period === 'day');
      const enterpriseRequestLimit = enterpriseLimits.find(l => l.type === 'requests' && l.period === 'day');
      expect(enterpriseRequestLimit!.limit).toBeGreaterThan(freeRequestLimit!.limit);
    });

    it('should apply tenant-specific config', async () => {
      await manager.setTenantConfig({
        tenantId: 'custom-tenant',
        tier: 'enterprise',
        limits: [
          { type: 'requests', period: 'minute', limit: 500, softLimit: 400 },
        ],
      });

      const config = await manager.getTenantConfig('custom-tenant');
      expect(config.tier).toBe('enterprise');
      expect(config.limits[0]!.limit).toBe(500);
    });
  });

  // ============================================
  // COST ESTIMATION
  // ============================================

  describe('estimateCost', () => {
    it('should estimate cost with model multiplier', () => {
      const cost = manager.estimateCost('claude-3-opus', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('should use higher multiplier for expensive models', () => {
      const opusCost = manager.estimateCost('claude-3-opus', 1000, 500);
      const haikuCost = manager.estimateCost('claude-3-haiku', 1000, 500);
      expect(opusCost).toBeGreaterThan(haikuCost);
    });

    it('should handle unknown models with default multiplier', () => {
      const cost = manager.estimateCost('unknown-model', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });
  });

  // ============================================
  // QUOTA USAGE RETRIEVAL
  // ============================================

  describe('getAllQuotaUsage', () => {
    it('should return usage for all configured limits', async () => {
      const usages = await manager.getAllQuotaUsage('tenant-1');
      expect(usages.length).toBeGreaterThan(0);
      for (const usage of usages) {
        expect(usage.current).toBe(0);
        expect(usage.remaining).toBeGreaterThan(0);
      }
    });
  });

  // ============================================
  // IN-MEMORY STORAGE
  // ============================================

  describe('InMemoryQuotaStorage', () => {
    it('should store and retrieve tenant config', async () => {
      const config: TenantQuotaConfig = {
        tenantId: 'test',
        tier: 'starter',
        limits: [],
      };
      await storage.setTenantConfig(config);
      const retrieved = await storage.getTenantConfig('test');
      expect(retrieved).toEqual(config);
    });

    it('should return null for unknown tenant', async () => {
      const config = await storage.getTenantConfig('nonexistent');
      expect(config).toBeNull();
    });

    it('should increment usage atomically', async () => {
      const v1 = await storage.incrementUsage('t1', 'requests', 'minute', 5);
      expect(v1).toBe(5);
      const v2 = await storage.incrementUsage('t1', 'requests', 'minute', 3);
      expect(v2).toBe(8);
    });

    it('should store and retrieve usage history', async () => {
      const record: UsageRecord = {
        tenantId: 'tenant-1',
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3',
        requestId: 'req-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        cost: 0.01,
        latencyMs: 500,
        success: true,
      };

      await storage.recordUsage(record);
      const history = await storage.getUsageHistory(
        'tenant-1',
        new Date(Date.now() - 60000),
        new Date(Date.now() + 60000)
      );
      expect(history).toHaveLength(1);
    });

    it('should trim history to 10000 records', async () => {
      for (let i = 0; i < 10005; i++) {
        await storage.recordUsage({
          tenantId: 'tenant-1',
          timestamp: new Date(),
          provider: 'anthropic',
          model: 'claude-3',
          requestId: `req-${i}`,
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          cost: 0.01,
          latencyMs: 500,
          success: true,
        });
      }
      const history = await storage.getUsageHistory(
        'tenant-1',
        new Date(0),
        new Date(Date.now() + 60000)
      );
      expect(history.length).toBeLessThanOrEqual(10000);
    });
  });

  // ============================================
  // MIDDLEWARE HELPER
  // ============================================

  describe('checkQuotaMiddleware', () => {
    it('should return allowed with rate limit headers', async () => {
      const result = await checkQuotaMiddleware('tenant-1', manager);
      expect(result.allowed).toBe(true);
      expect(result.headers['X-RateLimit-Limit']).toBeDefined();
      expect(result.headers['X-RateLimit-Remaining']).toBeDefined();
    });

    it('should return error with Retry-After when blocked', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.incrementUsage('tenant-1', 'requests', 'minute', 1);
      }

      const result = await checkQuotaMiddleware('tenant-1', manager);
      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('QUOTA_EXCEEDED');
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createQuotaManager', () => {
    it('should create manager with default storage', () => {
      const m = createQuotaManager();
      expect(m).toBeInstanceOf(QuotaManager);
    });
  });
});
