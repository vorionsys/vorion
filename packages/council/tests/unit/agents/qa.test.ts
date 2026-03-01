import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CouncilState } from '../../../src/types/index.js';

// Mock the ai-gateway module
vi.mock('@vorionsys/ai-gateway', () => ({
  createGateway: () => ({
    chat: vi.fn().mockResolvedValue({
      content: 'Quality looks good',
      model: 'mock-model',
      usage: { totalCost: 0.001 },
      metadata: { latency: 50 },
    }),
  }),
}));

import { QAAgent, runQAReview } from '../../../src/agents/qa.js';

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: 'Write a summary',
    userId: 'user_test',
    requestId: 'req_test_001',
    metadata: {
      priority: 'medium',
    },
    output: {
      content: 'Here is a summary of the topic.',
      confidence: 0.85,
      totalCost: 0.05,
      totalTime: 3,
      model: 'gpt-4',
    },
    currentStep: 'qa_review',
    iterationCount: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('QAAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('review', () => {
    it('should return state with QA results', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa).toBeDefined();
      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.reviewedBy).toContain('qa_1');
    });

    it('should add feedback with completeness aspect', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa!.feedback.length).toBe(1);
      expect(result.qa!.feedback[0]!.aspect).toBe('completeness');
      expect(result.qa!.feedback[0]!.score).toBe(8);
    });

    it('should preserve existing feedback when multiple agents review', async () => {
      const agent = new QAAgent('qa_2');
      const state = createBaseState({
        qa: {
          passed: true,
          feedback: [
            {
              aspect: 'accuracy',
              score: 9,
              feedback: 'Accurate content',
              reviewedBy: 'qa_1',
              requiresRevision: false,
            },
          ],
          requiresRevision: false,
          revisedCount: 0,
          reviewedBy: ['qa_1'],
        },
      });

      const result = await agent.review(state);

      expect(result.qa!.feedback.length).toBe(2);
      expect(result.qa!.reviewedBy).toContain('qa_1');
      expect(result.qa!.reviewedBy).toContain('qa_2');
    });

    it('should set currentStep to completed', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.currentStep).toBe('completed');
    });

    it('should set requiresRevision to false', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa!.requiresRevision).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return config for given agent number', () => {
      const config = QAAgent.getConfig(1);
      expect(config.id).toBe('qa_1');
      expect(config.role).toBe('qa_critique');
      expect(config.capabilities).toContain('Accuracy assessment');
    });
  });
});

describe('runQAReview', () => {
  it('should run a QA review using qa_1 agent', async () => {
    const state = createBaseState();
    const result = await runQAReview(state);

    expect(result.qa).toBeDefined();
    expect(result.qa!.reviewedBy).toContain('qa_1');
    expect(result.qa!.passed).toBe(true);
  });
});
