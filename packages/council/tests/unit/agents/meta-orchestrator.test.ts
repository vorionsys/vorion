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
  });

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
  });
});
