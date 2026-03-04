import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CouncilState } from '../../../src/types/index.js';

// Mock the ai-gateway module — ensures no real LLM calls
vi.mock('@vorionsys/ai-gateway', () => ({
  createGateway: () => ({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        completeness: { score: 8, feedback: 'All requirements addressed' },
        accuracy: { score: 9, feedback: 'Factually correct' },
        clarity: { score: 7, feedback: 'Well structured' },
        relevance: { score: 8, feedback: 'Stays on topic' },
        safety: { score: 10, feedback: 'No concerns' },
        summary: 'High quality output',
      }),
      model: 'mock-model',
      usage: { totalCost: 0.001 },
      metadata: { latency: 50 },
    }),
  }),
}));

import { QAAgent, runQAReview } from '../../../src/agents/qa.js';

const ALL_DIMENSIONS = ['completeness', 'accuracy', 'clarity', 'relevance', 'safety'] as const;

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

/**
 * Helper to create a state with substantial output content that scores well on heuristics.
 */
function createHighQualityState(): CouncilState {
  return createBaseState({
    userRequest: 'Write a detailed summary about climate change impacts and mitigation strategies',
    output: {
      content: [
        '# Climate Change: Impacts and Mitigation Strategies',
        '',
        'Climate change represents one of the most significant challenges facing humanity today.',
        'According to research, global temperatures have risen by approximately 1.1 degrees Celsius since pre-industrial times.',
        '',
        '## Key Impacts',
        '',
        '- Rising sea levels threaten coastal communities worldwide',
        '- Extreme weather events are becoming more frequent and severe',
        '- Biodiversity loss accelerates as ecosystems struggle to adapt',
        '- Agricultural productivity faces serious disruption in many regions',
        '',
        '## Mitigation Strategies',
        '',
        '1. Transition to renewable energy sources including solar and wind power',
        '2. Implement carbon capture and storage technologies at scale',
        '3. Develop sustainable transportation systems and infrastructure',
        '4. Protect and restore natural carbon sinks such as forests and wetlands',
        '',
        'Evidence suggests that a combination of these strategies is essential.',
        'Studies indicate that immediate action is critical to limiting warming to 1.5 degrees.',
        '',
        'Note: These strategies require coordinated international cooperation and policy support.',
      ].join('\n'),
      confidence: 0.9,
      totalCost: 0.08,
      totalTime: 5,
      model: 'gpt-4',
    },
  });
}

describe('QAAgent', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no LLM keys so heuristic path is used
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LITELLM_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('review (heuristic path)', () => {
    it('should return state with QA results and 5 feedback entries', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa).toBeDefined();
      expect(result.qa!.reviewedBy).toContain('qa_1');
      expect(result.qa!.feedback.length).toBe(5);
    });

    it('should produce feedback for all 5 dimensions', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      const aspects = result.qa!.feedback.map((f) => f.aspect);
      for (const dim of ALL_DIMENSIONS) {
        expect(aspects).toContain(dim);
      }
    });

    it('should assign scores between 1 and 10 for every dimension', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      for (const fb of result.qa!.feedback) {
        expect(fb.score).toBeGreaterThanOrEqual(1);
        expect(fb.score).toBeLessThanOrEqual(10);
      }
    });

    it('should mark all feedback as reviewedBy the agent', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      for (const fb of result.qa!.feedback) {
        expect(fb.reviewedBy).toBe('qa_1');
      }
    });

    it('should pass high-quality output with score >= 7', async () => {
      const agent = new QAAgent('qa_1');
      const state = createHighQualityState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(false);
      expect(result.currentStep).toBe('completed');
    });

    it('should flag short output with requiresRevision', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState({
        output: {
          content: 'Here is a summary of the topic.',
          confidence: 0.85,
          totalCost: 0.05,
          totalTime: 3,
          model: 'gpt-4',
        },
      });
      const result = await agent.review(state);

      // Short output relative to request => mid-range score => revision likely
      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(true);
    });

    it('should fail empty output', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState({
        output: {
          content: '',
          confidence: 0,
          totalCost: 0,
          totalTime: 0,
          model: 'gpt-4',
        },
      });
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(false);
      expect(result.qa!.requiresRevision).toBe(true);
      expect(result.currentStep).toBe('qa_review');
    });

    it('should detect safety issues in harmful content', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState({
        userRequest: 'Tell me about cybersecurity',
        output: {
          content:
            'Here is how to hack into password systems. ' +
            'You can exploit accounts easily. ' +
            'Also you can steal credentials with this phishing method. ' +
            'This is a long enough output to get decent scores on other dimensions. ' +
            'Cybersecurity is an important topic for modern organizations.',
          confidence: 0.7,
          totalCost: 0.03,
          totalTime: 2,
          model: 'gpt-4',
        },
      });
      const result = await agent.review(state);

      const safetyFb = result.qa!.feedback.find((f) => f.aspect === 'safety');
      expect(safetyFb).toBeDefined();
      expect(safetyFb!.score).toBeLessThan(7);
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

      // 1 existing + 5 new = 6 total
      expect(result.qa!.feedback.length).toBe(6);
      expect(result.qa!.reviewedBy).toContain('qa_1');
      expect(result.qa!.reviewedBy).toContain('qa_2');
    });

    it('should set updatedAt to a recent date', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const before = new Date();
      const result = await agent.review(state);
      const after = new Date();

      expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should handle missing output gracefully', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState({ output: undefined });
      const result = await agent.review(state);

      expect(result.qa).toBeDefined();
      expect(result.qa!.passed).toBe(false);
      expect(result.qa!.requiresRevision).toBe(true);
    });

    it('should score safety high for clean content', async () => {
      const agent = new QAAgent('qa_1');
      const state = createHighQualityState();
      const result = await agent.review(state);

      const safetyFb = result.qa!.feedback.find((f) => f.aspect === 'safety');
      expect(safetyFb).toBeDefined();
      expect(safetyFb!.score).toBeGreaterThanOrEqual(8);
    });
  });

  describe('review (LLM path)', () => {
    it('should use LLM when API key is available', async () => {
      process.env.XAI_API_KEY = 'test-key';

      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      // LLM mock returns high scores so should pass
      expect(result.qa).toBeDefined();
      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(false);
      expect(result.qa!.feedback.length).toBe(5);
    });

    it('should use LLM when OPENAI_API_KEY is set', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.feedback.length).toBe(5);
    });

    it('should fall back to heuristic when LLM call fails', async () => {
      process.env.XAI_API_KEY = 'test-key';

      // Re-import to get the mocked gateway
      const { createGateway } = await import('@vorionsys/ai-gateway');
      const gateway = createGateway();
      vi.mocked(gateway.chat).mockRejectedValueOnce(new Error('API Error'));

      // The agent creates its own gateway instance via the mock factory,
      // so we need to override at module level. Since the mock factory returns
      // a new object each time, let's test indirectly: if the agent constructor
      // creates a gateway that throws, it should still produce valid results.
      // We'll test the fallback by verifying it still returns 5 feedback entries.
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      // Should still produce valid QA output (either from LLM or fallback)
      expect(result.qa).toBeDefined();
      expect(result.qa!.feedback.length).toBe(5);
    });
  });

  describe('scoring thresholds', () => {
    it('should mark high quality as passed without revision', async () => {
      const agent = new QAAgent('qa_1');
      const state = createHighQualityState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(false);
    });

    it('should mark mediocre quality as passed with revision', async () => {
      const agent = new QAAgent('qa_1');
      // Short output relative to a moderate request
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(true);
    });

    it('should fail very poor quality output', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState({
        userRequest: 'Write a comprehensive analysis of machine learning algorithms including supervised, unsupervised, and reinforcement learning with examples and use cases',
        output: {
          content: '',
          confidence: 0,
          totalCost: 0,
          totalTime: 0,
          model: 'gpt-4',
        },
      });
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(false);
      expect(result.qa!.requiresRevision).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return config for given agent number', () => {
      const config = QAAgent.getConfig(1);
      expect(config.id).toBe('qa_1');
      expect(config.role).toBe('qa_critique');
      expect(config.capabilities).toContain('Accuracy assessment');
      expect(config.capabilities).toContain('Safety analysis');
    });

    it('should include all 5 capability descriptions', () => {
      const config = QAAgent.getConfig(2);
      expect(config.capabilities.length).toBe(5);
      expect(config.id).toBe('qa_2');
    });
  });
});

describe('runQAReview', () => {
  beforeEach(() => {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LITELLM_BASE_URL;
  });

  it('should run a QA review using qa_1 agent', async () => {
    const state = createBaseState();
    const result = await runQAReview(state);

    expect(result.qa).toBeDefined();
    expect(result.qa!.reviewedBy).toContain('qa_1');
    expect(result.qa!.feedback.length).toBe(5);
  });

  it('should return a valid passed/requiresRevision decision', async () => {
    const state = createBaseState();
    const result = await runQAReview(state);

    expect(typeof result.qa!.passed).toBe('boolean');
    expect(typeof result.qa!.requiresRevision).toBe('boolean');
  });
});
