import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CouncilState } from '../../../src/types/index.js';

// Mock the ai-gateway module
vi.mock('@vorionsys/ai-gateway', () => ({
  createGateway: () => ({
    chat: vi.fn().mockResolvedValue({
      content: 'Route to advisor',
      model: 'mock-model',
      usage: { totalCost: 0.001 },
      metadata: { latency: 50 },
    }),
  }),
}));

import { RoutingAgent } from '../../../src/agents/routing.js';

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: 'Help me with strategy',
    userId: 'user_test',
    requestId: 'req_test_001',
    metadata: {
      priority: 'medium',
    },
    plan: {
      steps: [
        {
          id: 'step_1',
          description: 'Get strategic advice',
          assignTo: 'advisor',
          estimatedCost: 0.10,
          estimatedTime: 120,
          dependencies: [],
          status: 'pending',
        },
        {
          id: 'step_2',
          description: 'Execute the plan',
          assignTo: 'workforce',
          estimatedCost: 0.05,
          estimatedTime: 180,
          dependencies: ['step_1'],
          status: 'pending',
        },
      ],
      estimatedCost: 0.15,
      estimatedTime: 300,
      complexity: 'moderate',
      createdBy: 'master_planner',
    },
    currentStep: 'routing',
    iterationCount: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RoutingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route', () => {
    it('should route advisor steps to advisory council', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      expect(result.routing).toBeDefined();
      const advisorAgents = result.routing!.selectedAgents.filter(
        (a) => a.agentType === 'advisor'
      );
      expect(advisorAgents.length).toBeGreaterThan(0);
    });

    it('should route workforce steps to general workforce', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      const teamAgents = result.routing!.selectedAgents.filter(
        (a) => a.agentType === 'team'
      );
      expect(teamAgents.length).toBeGreaterThan(0);
    });

    it('should select agents for each plan step', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      expect(result.routing!.selectedAgents.length).toBe(2);
    });

    it('should set currentStep to execution', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      expect(result.currentStep).toBe('execution');
    });

    it('should set routedBy identifier', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      expect(result.routing!.routedBy).toBe('routing_1');
    });

    it('should handle empty plan steps', async () => {
      const router = new RoutingAgent();
      const state = createBaseState({
        plan: {
          steps: [],
          estimatedCost: 0,
          estimatedTime: 0,
          complexity: 'simple',
          createdBy: 'master_planner',
        },
      });
      const result = await router.route(state);

      expect(result.routing!.selectedAgents).toHaveLength(0);
    });

    it('should handle missing plan', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      delete state.plan;
      const result = await router.route(state);

      expect(result.routing!.selectedAgents).toHaveLength(0);
    });

    it('should include reason for each selected agent', async () => {
      const router = new RoutingAgent();
      const state = createBaseState();
      const result = await router.route(state);

      for (const agent of result.routing!.selectedAgents) {
        expect(agent.reason).toBeTruthy();
        expect(typeof agent.reason).toBe('string');
      }
    });
  });

  describe('getConfig', () => {
    it('should return valid configuration', () => {
      const config = RoutingAgent.getConfig();
      expect(config.id).toBe('routing_1');
      expect(config.role).toBe('routing_dispatch');
      expect(config.capabilities).toContain('Agent selection');
    });
  });
});
