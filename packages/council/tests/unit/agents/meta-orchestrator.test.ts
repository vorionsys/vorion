import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaOrchestratorAgent } from '../../../src/agents/meta-orchestrator.js';
import type { CouncilState } from '../../../src/types/index.js';

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: 'Test request',
    userId: 'user_test',
    requestId: 'req_test_001',
    metadata: {
      priority: 'medium',
      expectedResponseTime: 120,
    },
    currentStep: 'completed',
    iterationCount: 1,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('MetaOrchestratorAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default agent ID', () => {
      const agent = new MetaOrchestratorAgent();
      expect(agent).toBeDefined();
    });

    it('should create with custom agent ID', () => {
      const agent = new MetaOrchestratorAgent('meta_custom');
      expect(agent).toBeDefined();
    });
  });

  describe('trackMetrics', () => {
    it('should log metrics without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        output: {
          content: 'Some output',
          confidence: 0.85,
          totalCost: 0.10,
          totalTime: 5,
          model: 'gpt-4',
        },
        compliance: {
          passed: true,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'public',
          checkedBy: ['compliance_1'],
        },
        qa: {
          passed: true,
          feedback: [],
          requiresRevision: false,
          revisedCount: 0,
          reviewedBy: ['qa_1'],
        },
      });

      expect(() => agent.trackMetrics(state)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle missing output gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState();

      expect(() => agent.trackMetrics(state)).not.toThrow();
      consoleSpy.mockRestore();
    });

    it('should track error count', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        errors: [
          {
            step: 'execution',
            message: 'Error 1',
            agentId: 'agent_1',
            timestamp: new Date(),
            severity: 'error',
          },
          {
            step: 'qa_review',
            message: 'Error 2',
            agentId: 'qa_1',
            timestamp: new Date(),
            severity: 'warning',
          },
        ],
      });

      agent.trackMetrics(state);

      // Verify metrics JSON was logged containing errorCount of 2
      const logCalls = consoleSpy.mock.calls;
      const metricsCall = logCalls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('"errorCount":2')
      );
      expect(metricsCall).toBeDefined();
      consoleSpy.mockRestore();
    });

    it('should return cost warning alert when cost exceeds warning threshold', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        output: {
          content: 'output',
          confidence: 0.9,
          totalCost: 0.75,
          totalTime: 500,
          model: 'gpt-4',
        },
      });

      const { alerts } = agent.trackMetrics(state);
      expect(alerts.some(a => a.type === 'cost_elevated' && a.severity === 'warning')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return cost critical alert when cost exceeds critical threshold', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        output: {
          content: 'output',
          confidence: 0.9,
          totalCost: 2.50,
          totalTime: 500,
          model: 'gpt-4',
        },
      });

      const { alerts } = agent.trackMetrics(state);
      expect(alerts.some(a => a.type === 'cost_exceeded' && a.severity === 'critical')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return quality_failure alert when compliance or QA fails', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        output: {
          content: 'output',
          confidence: 0.9,
          totalCost: 0.01,
          totalTime: 100,
          model: 'gpt-4',
        },
        compliance: {
          passed: false,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'public',
          checkedBy: ['compliance_1'],
        },
      });

      const { alerts } = agent.trackMetrics(state);
      expect(alerts.some(a => a.type === 'quality_failure')).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // getHealthStatus
  // ===========================================================================

  describe('getHealthStatus', () => {
    it('should return healthy when no snapshots exist', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      const health = agent.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.score).toBe(100);
      expect(health.reasons).toContain('All metrics within normal parameters');
      expect(health.recommendations).toHaveLength(0);
      expect(typeof health.timestamp).toBe('number');
      consoleSpy.mockRestore();
    });

    it('should return healthy when all metrics are normal', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track several healthy requests
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_healthy_${i}`,
          output: {
            content: 'Good output',
            confidence: 0.95,
            totalCost: 0.05,
            totalTime: 1000,
            model: 'gpt-4',
          },
          compliance: {
            passed: true,
            issues: [],
            containsPII: false,
            sensitivityLevel: 'public',
            checkedBy: ['compliance_1'],
          },
          qa: {
            passed: true,
            feedback: [],
            requiresRevision: false,
            revisedCount: 0,
            reviewedBy: ['qa_1'],
          },
        }));
      }

      const health = agent.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.score).toBeGreaterThanOrEqual(80);
      consoleSpy.mockRestore();
    });

    it('should return degraded when failure rate is elevated', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track 5 requests: 2 pass, 3 fail (60% failure rate)
      for (let i = 0; i < 2; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_pass_${i}`,
          output: { content: 'ok', confidence: 0.9, totalCost: 0.05, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }
      for (let i = 0; i < 3; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_fail_${i}`,
          output: { content: 'bad', confidence: 0.3, totalCost: 0.05, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 3, reviewedBy: ['qa_1'] },
        }));
      }

      const health = agent.getHealthStatus();

      // 60% failure rate + high error density = degraded or unhealthy
      expect(['degraded', 'unhealthy']).toContain(health.status);
      expect(health.score).toBeLessThan(80);
      expect(health.reasons.length).toBeGreaterThan(0);
      expect(health.recommendations.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });

    it('should return unhealthy when average cost is critical and failure rate is high', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track 5 expensive, failing requests
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_bad_${i}`,
          output: { content: 'expensive failure', confidence: 0.2, totalCost: 3.00, totalTime: 35000, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'restricted', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 4, reviewedBy: ['qa_1'] },
          errors: [
            { step: 'execution', message: 'err1', agentId: 'a1', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err2', agentId: 'a2', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err3', agentId: 'a3', timestamp: new Date(), severity: 'error' },
          ],
        }));
      }

      const health = agent.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.score).toBeLessThan(50);
      expect(health.reasons.length).toBeGreaterThanOrEqual(2);
      consoleSpy.mockRestore();
    });

    it('should deduct points for recent critical alerts', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Trigger 3 critical cost alerts (each >= $2.00)
      for (let i = 0; i < 3; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_critical_${i}`,
          output: { content: 'costly', confidence: 0.9, totalCost: 5.00, totalTime: 100, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const health = agent.getHealthStatus();

      // Should have deductions for high cost AND recent critical alerts
      expect(health.score).toBeLessThan(100);
      expect(health.reasons.some(r => r.includes('critical alert'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // getOptimizationRecommendations
  // ===========================================================================

  describe('getOptimizationRecommendations', () => {
    it('should return empty array when not enough data exists', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      const recs = agent.getOptimizationRecommendations();

      expect(recs).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should return empty array when all metrics are healthy', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track 3 healthy, cheap, fast requests
      for (let i = 0; i < 3; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_ok_${i}`,
          output: { content: 'ok', confidence: 0.95, totalCost: 0.01, totalTime: 200, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();

      expect(recs).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should recommend cost optimization when average cost is high', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track expensive requests
      for (let i = 0; i < 3; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_expensive_${i}`,
          output: { content: 'costly', confidence: 0.9, totalCost: 3.00, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();

      expect(recs.some(r => r.category === 'cost' && r.priority === 'high')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should recommend latency optimization when average time is high', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track slow requests
      for (let i = 0; i < 3; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_slow_${i}`,
          output: { content: 'slow', confidence: 0.9, totalCost: 0.01, totalTime: 35000, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();

      expect(recs.some(r => r.category === 'latency' && r.priority === 'high')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should recommend reliability improvement when success rate is low', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track mostly failing requests
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_fail_rel_${i}`,
          output: { content: 'fail', confidence: 0.3, totalCost: 0.01, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 3, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();

      expect(recs.some(r => r.category === 'reliability')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should recommend quality improvement when iteration count is high', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track requests with high iteration counts
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_iter_${i}`,
          iterationCount: 4,
          output: { content: 'iterated', confidence: 0.8, totalCost: 0.05, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();

      expect(recs.some(r => r.category === 'quality')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should return multiple recommendations when several metrics are problematic', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Track requests that are expensive, slow, AND unreliable
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_multi_${i}`,
          iterationCount: 4,
          output: { content: 'bad all around', confidence: 0.3, totalCost: 3.00, totalTime: 35000, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 4, reviewedBy: ['qa_1'] },
        }));
      }

      const recs = agent.getOptimizationRecommendations();
      const categories = recs.map(r => r.category);

      expect(categories).toContain('cost');
      expect(categories).toContain('latency');
      expect(categories).toContain('reliability');
      expect(categories).toContain('quality');
      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // monitor (council-integrated orchestration method)
  // ===========================================================================

  describe('monitor', () => {
    it('should return an updated CouncilState without errors for a healthy request', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        output: {
          content: 'Healthy response',
          confidence: 0.95,
          totalCost: 0.05,
          totalTime: 500,
          model: 'gpt-4',
        },
        compliance: {
          passed: true,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'public',
          checkedBy: ['compliance_1'],
        },
        qa: {
          passed: true,
          feedback: [],
          requiresRevision: false,
          revisedCount: 0,
          reviewedBy: ['qa_1'],
        },
      });

      const result = agent.monitor(state);

      expect(result.currentStep).toBe('completed');
      expect(result.errors).toHaveLength(0);
      expect(result.updatedAt).toBeInstanceOf(Date);
      // Should still contain all original state data
      expect(result.requestId).toBe('req_test_001');
      expect(result.output?.content).toBe('Healthy response');
      consoleSpy.mockRestore();
    });

    it('should add a warning error when system is degraded', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Build up degraded state by feeding several failing requests
      for (let i = 0; i < 4; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_degrade_${i}`,
          output: { content: 'fail', confidence: 0.3, totalCost: 0.05, totalTime: 500, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 3, reviewedBy: ['qa_1'] },
        }));
      }

      // Now monitor a new request against this degraded system
      const state = createBaseState({
        requestId: 'req_new_in_degraded',
        output: { content: 'new attempt', confidence: 0.9, totalCost: 0.01, totalTime: 200, model: 'gpt-4' },
        compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
        qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
      });

      const result = agent.monitor(state);

      // System is degraded so a warning should be added, but step should not change to failed
      const warningErrors = result.errors.filter(e => e.severity === 'warning');
      expect(warningErrors.length).toBeGreaterThanOrEqual(1);
      expect(warningErrors[0].message).toContain('degraded');
      expect(result.currentStep).toBe('completed'); // not failed - just degraded
      consoleSpy.mockRestore();
    });

    it('should transition to failed when system is unhealthy and request has errors', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Build up unhealthy system state
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_unhealthy_${i}`,
          output: { content: 'disaster', confidence: 0.1, totalCost: 5.00, totalTime: 50000, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'restricted', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 5, reviewedBy: ['qa_1'] },
          errors: [
            { step: 'execution', message: 'err', agentId: 'a1', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err', agentId: 'a2', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err', agentId: 'a3', timestamp: new Date(), severity: 'error' },
          ],
        }));
      }

      // Monitor a request that also has errors itself
      const state = createBaseState({
        requestId: 'req_doomed',
        currentStep: 'execution',
        output: { content: 'error output', confidence: 0.1, totalCost: 4.00, totalTime: 40000, model: 'gpt-4' },
        compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'restricted', checkedBy: ['c1'] },
        qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 5, reviewedBy: ['qa_1'] },
        errors: [
          { step: 'execution', message: 'pre-existing error', agentId: 'exec_1', timestamp: new Date(), severity: 'error' },
        ],
      });

      const result = agent.monitor(state);

      expect(result.currentStep).toBe('failed');
      // Should have critical errors added by the meta-orchestrator
      const criticalErrors = result.errors.filter(e => e.severity === 'critical' && e.agentId === 'meta_1');
      expect(criticalErrors.length).toBeGreaterThanOrEqual(1);
      consoleSpy.mockRestore();
    });

    it('should not transition to failed when system is unhealthy but request has no pre-existing errors', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Build up unhealthy system (many failing requests)
      for (let i = 0; i < 5; i++) {
        agent.trackMetrics(createBaseState({
          requestId: `req_sys_bad_${i}`,
          output: { content: 'bad', confidence: 0.1, totalCost: 5.00, totalTime: 50000, model: 'gpt-4' },
          compliance: { passed: false, issues: [], containsPII: false, sensitivityLevel: 'restricted', checkedBy: ['c1'] },
          qa: { passed: false, feedback: [], requiresRevision: true, revisedCount: 5, reviewedBy: ['qa_1'] },
          errors: [
            { step: 'execution', message: 'err', agentId: 'a1', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err', agentId: 'a2', timestamp: new Date(), severity: 'error' },
            { step: 'execution', message: 'err', agentId: 'a3', timestamp: new Date(), severity: 'error' },
          ],
        }));
      }

      // Monitor a clean request (no pre-existing errors)
      const state = createBaseState({
        requestId: 'req_clean_in_bad_system',
        currentStep: 'completed',
        errors: [], // no pre-existing errors
        output: { content: 'ok', confidence: 0.9, totalCost: 0.01, totalTime: 200, model: 'gpt-4' },
        compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
        qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
      });

      const result = agent.monitor(state);

      // Should NOT transition to failed since the request itself has no errors
      expect(result.currentStep).not.toBe('failed');
      consoleSpy.mockRestore();
    });

    it('should append critical anomaly alerts as errors on the state', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');
      const state = createBaseState({
        requestId: 'req_critical_cost',
        output: {
          content: 'very expensive',
          confidence: 0.9,
          totalCost: 5.00, // well above critical threshold of $2.00
          totalTime: 500,
          model: 'gpt-4',
        },
        compliance: {
          passed: true,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'public',
          checkedBy: ['c1'],
        },
        qa: {
          passed: true,
          feedback: [],
          requiresRevision: false,
          revisedCount: 0,
          reviewedBy: ['qa_1'],
        },
      });

      const result = agent.monitor(state);

      // The critical cost alert should be present as an error on the state
      const costErrors = result.errors.filter(
        e => e.agentId === 'meta_1' && e.severity === 'critical' && e.message.includes('cost')
      );
      expect(costErrors.length).toBeGreaterThanOrEqual(1);
      consoleSpy.mockRestore();
    });

    it('should accumulate aggregate stats across multiple monitor calls', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const agent = new MetaOrchestratorAgent('meta_1');

      // Monitor 3 requests sequentially
      for (let i = 0; i < 3; i++) {
        agent.monitor(createBaseState({
          requestId: `req_agg_${i}`,
          output: { content: 'out', confidence: 0.9, totalCost: 0.10, totalTime: 1000, model: 'gpt-4' },
          compliance: { passed: true, issues: [], containsPII: false, sensitivityLevel: 'public', checkedBy: ['c1'] },
          qa: { passed: true, feedback: [], requiresRevision: false, revisedCount: 0, reviewedBy: ['qa_1'] },
        }));
      }

      const stats = agent.getAggregateStats();
      expect(stats.count).toBe(3);
      expect(stats.avgCost).toBeCloseTo(0.10, 2);
      expect(stats.avgTime).toBeCloseTo(1000, 0);
      expect(stats.successRate).toBe(1);
      consoleSpy.mockRestore();
    });
  });

  // ===========================================================================
  // getConfig (static)
  // ===========================================================================

  describe('getConfig', () => {
    it('should return config for given agent number', () => {
      const config = MetaOrchestratorAgent.getConfig(1);
      expect(config.id).toBe('meta_1');
      expect(config.role).toBe('meta_orchestrator');
      expect(config.capabilities).toContain('Cost tracking');
    });

    it('should return different IDs for different numbers', () => {
      const config1 = MetaOrchestratorAgent.getConfig(1);
      const config2 = MetaOrchestratorAgent.getConfig(2);
      expect(config1.id).not.toBe(config2.id);
    });

    it('should list all five capabilities', () => {
      const config = MetaOrchestratorAgent.getConfig(1);
      expect(config.capabilities).toContain('Cost tracking');
      expect(config.capabilities).toContain('Performance monitoring');
      expect(config.capabilities).toContain('Route optimization');
      expect(config.capabilities).toContain('Anomaly detection');
      expect(config.capabilities).toContain('System health checks');
    });
  });
});
