import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CarbonTracker } from '../src/sustainability/carbon-tracker.js';
import { GreenRouter } from '../src/sustainability/green-route.js';

describe('CarbonTracker', () => {
  let tracker: CarbonTracker;

  beforeEach(() => {
    tracker = new CarbonTracker();
  });

  // ============================================
  // TRACK TASK
  // ============================================

  describe('trackTask', () => {
    it('should calculate carbon metrics for known models', async () => {
      const metrics = await tracker.trackTask(
        'task-1',
        'anthropic',
        'claude-sonnet-4-5',
        100,
        50,
        1000
      );

      expect(metrics.taskId).toBe('task-1');
      expect(metrics.carbonEmitted).toBeGreaterThan(0);
      expect(metrics.energyConsumed).toBeGreaterThan(0);
      expect(metrics.tokensInput).toBe(100);
      expect(metrics.tokensOutput).toBe(50);
    });

    it('should use default profile for unknown models', async () => {
      const metrics = await tracker.trackTask(
        'task-2',
        'unknown-provider',
        'unknown-model',
        100,
        50,
        1000
      );

      expect(metrics.carbonEmitted).toBeGreaterThan(0);
    });

    it('should calculate lower carbon for green models', async () => {
      const greenMetrics = await tracker.trackTask(
        'task-green',
        'google',
        'gemini-2.5-flash',
        1000,
        500,
        1000
      );

      const standardMetrics = await tracker.trackTask(
        'task-std',
        'anthropic',
        'claude-opus-4',
        1000,
        500,
        1000
      );

      expect(greenMetrics.carbonEmitted).toBeLessThan(standardMetrics.carbonEmitted);
    });

    it('should calculate proportionally to token count', async () => {
      const small = await tracker.trackTask('t1', 'anthropic', 'claude-sonnet-4-5', 100, 50, 1000);
      const large = await tracker.trackTask('t2', 'anthropic', 'claude-sonnet-4-5', 1000, 500, 1000);

      expect(large.carbonEmitted).toBeGreaterThan(small.carbonEmitted);
      // Should be roughly 10x since tokens are 10x
      const ratio = large.carbonEmitted / small.carbonEmitted;
      expect(ratio).toBeCloseTo(10, 0);
    });
  });

  // ============================================
  // GREEN MODELS
  // ============================================

  describe('getGreenModels', () => {
    it('should return green-optimized models', () => {
      const greenModels = tracker.getGreenModels();
      expect(greenModels.length).toBeGreaterThan(0);
      for (const model of greenModels) {
        expect(model.isGreenOptimized).toBe(true);
      }
    });

    it('should include Google models', () => {
      const greenModels = tracker.getGreenModels();
      const googleModels = greenModels.filter(m => m.provider === 'google');
      expect(googleModels.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // CARBON SAVINGS
  // ============================================

  describe('calculateSavings', () => {
    it('should calculate savings between models', () => {
      const savings = tracker.calculateSavings('claude-opus-4', 'gemini-2.5-flash', 10000);

      expect(savings.carbonSaved).toBeGreaterThan(0);
      expect(savings.energySaved).toBeGreaterThan(0);
      expect(savings.savingsPercent).toBeGreaterThan(0);
    });

    it('should show no savings when comparing same model', () => {
      const savings = tracker.calculateSavings('claude-sonnet-4-5', 'claude-sonnet-4-5', 10000);

      expect(savings.carbonSaved).toBe(0);
      expect(savings.energySaved).toBe(0);
    });
  });

  // ============================================
  // CARBON INTENSITY FORECAST
  // ============================================

  describe('getCarbonIntensityForecast', () => {
    it('should return 24-hour forecast', async () => {
      const forecast = await tracker.getCarbonIntensityForecast();
      expect(forecast).toHaveLength(24);
    });

    it('should mark off-peak hours as low emission', async () => {
      const forecast = await tracker.getCarbonIntensityForecast();
      const offPeakHours = forecast.filter(f => f.isLowEmission);
      expect(offPeakHours.length).toBeGreaterThan(0);
    });

    it('should have lower intensity during off-peak', async () => {
      const forecast = await tracker.getCarbonIntensityForecast();
      const offPeak = forecast.find(f => f.isLowEmission)!;
      const peak = forecast.find(f => !f.isLowEmission)!;
      expect(offPeak.intensity).toBeLessThan(peak.intensity);
    });
  });

  // ============================================
  // GREEN RECOMMENDATION
  // ============================================

  describe('getGreenRecommendation', () => {
    it('should recommend green model for low priority', async () => {
      const rec = await tracker.getGreenRecommendation('general', 'LOW');
      expect(rec.provider).toBe('google');
      expect(rec.model).toBe('gemini-2.5-flash');
    });

    it('should recommend green model for medium priority', async () => {
      const rec = await tracker.getGreenRecommendation('general', 'MEDIUM');
      expect(rec.provider).toBe('google');
    });

    it('should still return a recommendation for critical priority', async () => {
      const rec = await tracker.getGreenRecommendation('general', 'CRITICAL');
      expect(rec.model).toBeDefined();
      expect(rec.provider).toBeDefined();
    });
  });
});

// ============================================
// GREEN ROUTER
// ============================================

describe('GreenRouter', () => {
  let router: GreenRouter;

  beforeEach(() => {
    router = new GreenRouter();
  });

  describe('policy management', () => {
    it('should have default policy', () => {
      const policy = router.getPolicy();
      expect(policy.enabled).toBe(true);
      expect(policy.minPriority).toBe('MEDIUM');
    });

    it('should update policy', () => {
      router.setPolicy({ enabled: false });
      expect(router.getPolicy().enabled).toBe(false);
    });

    it('should merge policy updates', () => {
      router.setPolicy({ minPriority: 'HIGH' });
      const policy = router.getPolicy();
      expect(policy.minPriority).toBe('HIGH');
      expect(policy.enabled).toBe(true); // unchanged
    });
  });

  describe('routeRequest', () => {
    it('should use green route for eligible low priority tasks', async () => {
      const decision = await router.routeRequest({
        taskType: 'general',
        priority: 'LOW',
        estimatedTokens: 1000,
      });

      expect(decision.useGreenRoute).toBe(true);
      expect(decision.estimatedCarbon).toBeGreaterThan(0);
    });

    it('should not use green route when disabled', async () => {
      router.setPolicy({ enabled: false });

      const decision = await router.routeRequest({
        taskType: 'general',
        priority: 'LOW',
        estimatedTokens: 1000,
      });

      expect(decision.useGreenRoute).toBe(false);
    });

    it('should not use green route for critical priority', async () => {
      const decision = await router.routeRequest({
        taskType: 'general',
        priority: 'CRITICAL',
        estimatedTokens: 1000,
      });

      expect(decision.useGreenRoute).toBe(false);
    });

    it('should calculate carbon savings', async () => {
      const decision = await router.routeRequest({
        taskType: 'general',
        priority: 'LOW',
        estimatedTokens: 1000,
      });

      if (decision.useGreenRoute) {
        expect(decision.estimatedSavings).toBeDefined();
      }
    });
  });

  describe('getStatistics', () => {
    it('should return statistics', async () => {
      const stats = await router.getStatistics(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date()
      );

      expect(stats.totalRequests).toBeDefined();
      expect(stats.greenRoutedPercent).toBeDefined();
    });
  });

  describe('getCarbonBudgetStatus', () => {
    it('should return status without budget', async () => {
      const status = await router.getCarbonBudgetStatus();
      expect(status.budget).toBeUndefined();
    });

    it('should return status with budget', async () => {
      router.setPolicy({ carbonBudget: 10 });
      const status = await router.getCarbonBudgetStatus();
      expect(status.budget).toBe(10);
      expect(status.remaining).toBeDefined();
    });
  });

  describe('getRecommendations', () => {
    it('should return sustainability recommendations', async () => {
      const recs = await router.getRecommendations();
      expect(recs.length).toBeGreaterThan(0);
      for (const rec of recs) {
        expect(rec.title).toBeDefined();
        expect(rec.potentialSavings).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
