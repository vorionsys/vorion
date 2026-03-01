import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlaTracker, createSlaTracker, exportSlaMetrics } from '../src/routing/sla-tracker.js';
import type { SlaMeasurement } from '../src/routing/sla-tracker.js';

describe('SlaTracker', () => {
  let tracker: SlaTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new SlaTracker({
      defaultTargets: [
        { metric: 'latency_p95', target: 3000, warningThreshold: 2500, windowMs: 5 * 60 * 1000 },
        { metric: 'availability', target: 99.9, warningThreshold: 99.5, windowMs: 60 * 60 * 1000 },
        { metric: 'error_rate', target: 0.1, warningThreshold: 0.5, windowMs: 5 * 60 * 1000 },
      ],
      retentionMs: 24 * 60 * 60 * 1000,
      aggregationIntervalMs: 60 * 60 * 1000, // 1 hour (long interval so cleanup doesn't interfere)
      enableAlerts: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // RECORDING MEASUREMENTS
  // ============================================

  describe('record', () => {
    it('should record a measurement', () => {
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3',
        latencyMs: 500,
        success: true,
      });

      const report = tracker.getReport('anthropic');
      expect(report.totalRequests).toBe(1);
      expect(report.successfulRequests).toBe(1);
    });

    it('should track failed measurements', () => {
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        latencyMs: 500,
        success: false,
        errorType: 'timeout',
      });

      const report = tracker.getReport('anthropic');
      expect(report.totalRequests).toBe(1);
      expect(report.successfulRequests).toBe(0);
    });
  });

  // ============================================
  // SLA REPORTS
  // ============================================

  describe('getReport', () => {
    it('should calculate latency percentiles', () => {
      // Record 100 measurements with varying latencies
      for (let i = 1; i <= 100; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: i * 10, // 10ms to 1000ms
          success: true,
        });
      }

      const report = tracker.getReport('anthropic');
      expect(report.p50LatencyMs).toBeGreaterThan(0);
      expect(report.p95LatencyMs).toBeGreaterThan(report.p50LatencyMs);
      expect(report.p99LatencyMs).toBeGreaterThanOrEqual(report.p95LatencyMs);
    });

    it('should calculate availability percentage', () => {
      // 9 successes, 1 failure = 90% availability
      for (let i = 0; i < 9; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 500,
          success: true,
        });
      }
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        latencyMs: 500,
        success: false,
      });

      const report = tracker.getReport('anthropic');
      expect(report.uptimePercentage).toBe(90);
    });

    it('should detect SLA breaches', () => {
      // Record 10 requests with very high latency (breaches p95 target of 3000ms)
      for (let i = 0; i < 10; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 5000, // Exceeds 3000ms target
          success: true,
        });
      }

      const report = tracker.getReport('anthropic');
      expect(report.breachCount).toBeGreaterThan(0);
      expect(report.overallStatus).toBe('breached');
    });

    it('should report healthy status when within targets', () => {
      // Record 100 successful fast requests
      for (let i = 0; i < 100; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 100,
          success: true,
        });
      }

      const report = tracker.getReport('anthropic');
      expect(report.overallStatus).toBe('healthy');
    });

    it('should filter by model', () => {
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3-opus',
        latencyMs: 500,
        success: true,
      });
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        model: 'claude-3-haiku',
        latencyMs: 100,
        success: true,
      });

      const opusReport = tracker.getReport('anthropic', { model: 'claude-3-opus' });
      expect(opusReport.totalRequests).toBe(1);
    });

    it('should return 100% availability when no requests', () => {
      const report = tracker.getReport('google');
      expect(report.uptimePercentage).toBe(100);
      expect(report.totalRequests).toBe(0);
    });
  });

  // ============================================
  // STATUS
  // ============================================

  describe('getStatus', () => {
    it('should return quick status for provider', () => {
      tracker.record({
        timestamp: new Date(),
        provider: 'anthropic',
        latencyMs: 100,
        success: true,
      });

      const status = tracker.getStatus('anthropic');
      expect(status.status).toBeDefined();
      expect(status.metrics.availability).toBeDefined();
    });
  });

  // ============================================
  // ALERTS
  // ============================================

  describe('alerts', () => {
    it('should generate alerts on SLA breach', () => {
      // Cause an SLA breach
      for (let i = 0; i < 10; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 10000, // Way above target
          success: true,
        });
      }

      const alerts = tracker.getAlerts({ provider: 'anthropic' });
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('should call onAlert callback', () => {
      const onAlert = vi.fn();
      const alertTracker = new SlaTracker({
        defaultTargets: [
          { metric: 'latency_p95', target: 100, warningThreshold: 80, windowMs: 5 * 60 * 1000 },
        ],
        retentionMs: 24 * 60 * 60 * 1000,
        aggregationIntervalMs: 60 * 60 * 1000,
        enableAlerts: true,
        onAlert,
      });

      for (let i = 0; i < 10; i++) {
        alertTracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 5000,
          success: true,
        });
      }

      expect(onAlert).toHaveBeenCalled();
    });

    it('should filter alerts by severity', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 10000,
          success: true,
        });
      }

      const criticalAlerts = tracker.getAlerts({ severity: 'critical' });
      const warningAlerts = tracker.getAlerts({ severity: 'warning' });
      // At least one type should be present
      expect(criticalAlerts.length + warningAlerts.length).toBeGreaterThan(0);
    });

    it('should clear alert by ID', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 10000,
          success: true,
        });
      }

      const alerts = tracker.getAlerts();
      if (alerts.length > 0) {
        const cleared = tracker.clearAlert(alerts[0]!.id);
        expect(cleared).toBe(true);
      }
    });

    it('should return false for non-existent alert ID', () => {
      expect(tracker.clearAlert('nonexistent')).toBe(false);
    });
  });

  // ============================================
  // TIERS AND CREDITS
  // ============================================

  describe('tiers and credits', () => {
    it('should get SLA tiers', () => {
      const standard = tracker.getTier('standard');
      expect(standard).toBeDefined();
      expect(standard!.name).toBe('Standard');

      const enterprise = tracker.getTier('enterprise');
      expect(enterprise).toBeDefined();
      expect(enterprise!.creditPercentage).toBe(50);
    });

    it('should calculate credit for breached SLA', () => {
      // Cause breaches
      for (let i = 0; i < 20; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 10000,
          success: true,
        });
      }

      const tier = tracker.getTier('enterprise')!;
      const credit = tracker.calculateCredit(
        'anthropic',
        tier,
        new Date(Date.now() - 60 * 60 * 1000),
        new Date()
      );

      expect(credit.eligible).toBe(true);
      expect(credit.creditPercentage).toBe(50);
      expect(credit.breaches.length).toBeGreaterThan(0);
    });

    it('should return no credit when SLA is met', () => {
      for (let i = 0; i < 100; i++) {
        tracker.record({
          timestamp: new Date(),
          provider: 'anthropic',
          latencyMs: 100,
          success: true,
        });
      }

      const tier = tracker.getTier('standard')!;
      const credit = tracker.calculateCredit(
        'anthropic',
        tier,
        new Date(Date.now() - 60 * 60 * 1000),
        new Date()
      );

      expect(credit.eligible).toBe(false);
      expect(credit.creditPercentage).toBe(0);
    });
  });

  // ============================================
  // PROVIDER RANKING
  // ============================================

  describe('rankProviders', () => {
    it('should rank providers by SLA performance', () => {
      // Anthropic: fast and reliable
      for (let i = 0; i < 10; i++) {
        tracker.record({ timestamp: new Date(), provider: 'anthropic', latencyMs: 200, success: true });
      }

      // Google: slower
      for (let i = 0; i < 10; i++) {
        tracker.record({ timestamp: new Date(), provider: 'google', latencyMs: 1000, success: true });
      }

      const ranked = tracker.rankProviders(['anthropic', 'google']);
      expect(ranked[0]!.provider).toBe('anthropic');
      expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    });
  });

  // ============================================
  // PROMETHEUS EXPORT
  // ============================================

  describe('exportSlaMetrics', () => {
    it('should export metrics in Prometheus format', () => {
      tracker.record({ timestamp: new Date(), provider: 'anthropic', latencyMs: 200, success: true });

      const metrics = exportSlaMetrics(tracker, ['anthropic']);
      expect(metrics).toContain('ai_gateway_sla_availability');
      expect(metrics).toContain('ai_gateway_sla_latency_p95');
      expect(metrics).toContain('ai_gateway_sla_error_rate');
      expect(metrics).toContain('anthropic');
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createSlaTracker', () => {
    it('should create tracker with custom config', () => {
      const custom = createSlaTracker({
        enableAlerts: false,
        aggregationIntervalMs: 60 * 60 * 1000,
      });
      expect(custom).toBeInstanceOf(SlaTracker);
    });
  });
});
