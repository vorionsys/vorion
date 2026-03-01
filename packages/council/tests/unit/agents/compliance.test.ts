import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CouncilState } from '../../../src/types/index.js';

// Default mock chat function
const mockChat = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    passed: true,
    issues: [],
    containsPII: false,
    sensitivityLevel: 'public',
    recommendations: 'No issues detected',
  }),
  model: 'mock-model',
  usage: { totalCost: 0.001 },
  metadata: { latency: 100 },
});

// Mock the ai-gateway module before importing agents
vi.mock('@vorionsys/ai-gateway', () => ({
  createGateway: () => ({
    chat: (...args: unknown[]) => mockChat(...args),
  }),
}));

import { ComplianceAgent, runComplianceCheck } from '../../../src/agents/compliance.js';

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: 'Help me write a business plan',
    userId: 'user_test',
    requestId: 'req_test_001',
    metadata: {
      priority: 'medium',
      expectedResponseTime: 120,
      maxCost: 1.0,
      requiresHumanApproval: false,
    },
    plan: {
      steps: [
        {
          id: 'step_1',
          description: 'Analyze request',
          assignTo: 'advisor',
          estimatedCost: 0.05,
          estimatedTime: 60,
          dependencies: [],
          status: 'pending',
        },
      ],
      estimatedCost: 0.05,
      estimatedTime: 60,
      complexity: 'simple',
      createdBy: 'master_planner',
    },
    currentStep: 'compliance_check',
    iterationCount: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ComplianceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default agent ID', () => {
      const agent = new ComplianceAgent();
      expect(agent).toBeDefined();
    });

    it('should create with custom agent ID', () => {
      const agent = new ComplianceAgent('compliance_custom');
      expect(agent).toBeDefined();
    });
  });

  describe('check', () => {
    it('should return updated state with compliance result', async () => {
      const agent = new ComplianceAgent('compliance_1');
      const state = createBaseState();
      const result = await agent.check(state);

      expect(result.compliance).toBeDefined();
      expect(result.compliance!.checkedBy).toContain('compliance_1');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should preserve existing compliance checks', async () => {
      const agent = new ComplianceAgent('compliance_2');
      const state = createBaseState({
        compliance: {
          passed: true,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'public',
          checkedBy: ['compliance_1'],
        },
      });
      const result = await agent.check(state);

      expect(result.compliance!.checkedBy).toContain('compliance_1');
      expect(result.compliance!.checkedBy).toContain('compliance_2');
    });

    it('should handle gateway errors gracefully', async () => {
      // Override the mock chat to reject
      mockChat.mockRejectedValueOnce(new Error('Gateway timeout'));

      const agent = new ComplianceAgent('compliance_err');
      const state = createBaseState();
      const result = await agent.check(state);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.step).toBe('compliance_check');
      expect(result.errors[0]!.agentId).toBe('compliance_err');
    });
  });

  describe('getConfig', () => {
    it('should return config for given agent number', () => {
      const config = ComplianceAgent.getConfig(1);
      expect(config.id).toBe('compliance_1');
      expect(config.role).toBe('compliance_ethics');
      expect(config.capabilities).toBeInstanceOf(Array);
      expect(config.capabilities.length).toBeGreaterThan(0);
    });

    it('should return unique IDs for different agent numbers', () => {
      const config1 = ComplianceAgent.getConfig(1);
      const config2 = ComplianceAgent.getConfig(2);
      expect(config1.id).not.toBe(config2.id);
    });
  });

  describe('sensitivity level hierarchy', () => {
    it('should select highest sensitivity from agent results', async () => {
      const agent = new ComplianceAgent('compliance_1');
      const state = createBaseState({
        compliance: {
          passed: true,
          issues: [],
          containsPII: false,
          sensitivityLevel: 'confidential',
          checkedBy: ['compliance_prev'],
        },
      });

      // The mock returns 'public', but existing is 'confidential'
      // getHighestSensitivity should pick 'confidential'
      const result = await agent.check(state);
      expect(result.compliance!.sensitivityLevel).toBe('confidential');
    });
  });
});

describe('runComplianceCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run 4 compliance agents in parallel', async () => {
    const state = createBaseState();
    const result = await runComplianceCheck(state);

    expect(result.compliance).toBeDefined();
    expect(result.compliance!.checkedBy!.length).toBe(4);
    expect(result.compliance!.checkedBy).toContain('compliance_1');
    expect(result.compliance!.checkedBy).toContain('compliance_4');
  });

  it('should set currentStep to routing on pass', async () => {
    const state = createBaseState();
    const result = await runComplianceCheck(state);

    expect(result.currentStep).toBe('routing');
  });

  it('should update the updatedAt timestamp', async () => {
    const state = createBaseState();
    const before = new Date();
    const result = await runComplianceCheck(state);
    const after = new Date();

    expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
