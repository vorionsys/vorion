import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CouncilState, QAFeedback } from '../../../src/types/index.js';

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

import {
  QAAgent,
  runQAReview,
  scoreCompleteness,
  scoreClarity,
  scoreRelevance,
  scoreAccuracy,
  scoreTone,
  runHeuristicReview,
  QA_PASS_THRESHOLD,
  DIMENSION_FAIL_THRESHOLD,
} from '../../../src/agents/qa.js';

// ============================================
// TEST HELPERS
// ============================================

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: 'Write a summary of the quarterly results',
    userId: 'user_test',
    requestId: 'req_test_001',
    metadata: {
      priority: 'medium',
    },
    output: {
      content:
        'Here is a comprehensive summary of the quarterly results. ' +
        'Revenue increased by 15% compared to last quarter. ' +
        'The team recommends further investment in the growth areas identified. ' +
        'Additionally, we note that customer retention improved significantly. ' +
        'Please consider the attached data for more details.',
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

function createEmptyOutputState(): CouncilState {
  return createBaseState({
    output: {
      content: '',
      confidence: 0.1,
      totalCost: 0,
      totalTime: 0,
      model: 'gpt-4',
    },
  });
}

function createMinimalOutputState(): CouncilState {
  return createBaseState({
    output: {
      content: 'Yes.',
      confidence: 0.3,
      totalCost: 0.01,
      totalTime: 1,
      model: 'gpt-4',
    },
  });
}

function createHighQualityState(): CouncilState {
  return createBaseState({
    userRequest: 'Summarize the quarterly performance report',
    output: {
      content:
        'Here is a comprehensive summary of the quarterly performance report.\n\n' +
        '## Key Highlights\n\n' +
        '- Revenue increased by 15% compared to last quarter\n' +
        '- Customer retention improved from 82% to 91%\n' +
        '- Operating costs decreased by 8%\n\n' +
        '## Recommendations\n\n' +
        '1. We recommend continued investment in growth areas\n' +
        '2. Additionally, consider expanding the customer success team\n' +
        '3. Furthermore, the data suggests targeting new market segments\n\n' +
        'In summary, the quarterly results demonstrate strong performance. ' +
        'Please note that these figures are subject to final audit review. ' +
        'Thank you for reviewing this report.',
      confidence: 0.95,
      totalCost: 0.08,
      totalTime: 5,
      model: 'gpt-4',
    },
    plan: {
      steps: [
        {
          id: 's1',
          description: 'Analyze data',
          assignTo: 'advisor',
          estimatedCost: 0.05,
          estimatedTime: 3,
          dependencies: [],
          status: 'completed',
        },
        {
          id: 's2',
          description: 'Generate summary',
          assignTo: 'workforce',
          estimatedCost: 0.03,
          estimatedTime: 2,
          dependencies: ['s1'],
          status: 'completed',
        },
      ],
      estimatedCost: 0.08,
      estimatedTime: 5,
      complexity: 'moderate',
      createdBy: 'master_planner',
    },
  });
}

function createLowQualityState(): CouncilState {
  return createBaseState({
    userRequest: 'Provide a detailed analysis of our security posture and recommend improvements',
    output: {
      content: 'todo placeholder',
      confidence: 0.2,
      totalCost: 0.01,
      totalTime: 1,
      model: 'gpt-4',
    },
    plan: {
      steps: [
        {
          id: 's1',
          description: 'Analyze security',
          assignTo: 'advisor',
          estimatedCost: 0.05,
          estimatedTime: 3,
          dependencies: [],
          status: 'failed',
        },
        {
          id: 's2',
          description: 'Generate report',
          assignTo: 'workforce',
          estimatedCost: 0.03,
          estimatedTime: 2,
          dependencies: ['s1'],
          status: 'pending',
        },
      ],
      estimatedCost: 0.08,
      estimatedTime: 5,
      complexity: 'complex',
      createdBy: 'master_planner',
    },
    execution: {
      results: [
        {
          agentId: 'worker_1',
          agentName: 'Worker 1',
          content: 'Error occurred',
          confidence: 0.1,
          cost: 0.01,
          time: 1,
          model: 'gpt-4',
          error: 'Analysis failed due to missing data',
        },
      ],
      status: 'failed',
      startTime: new Date(),
    },
  });
}

function createSafetyConcernState(): CouncilState {
  return createBaseState({
    userRequest: 'Show me how to test our systems',
    output: {
      content:
        'Here is how to exploit the vulnerability and hack into the system. ' +
        'You can bypass security by injecting malware into the endpoint. ' +
        'Use this attack vector to steal credentials and access passwords.',
      confidence: 0.6,
      totalCost: 0.05,
      totalTime: 3,
      model: 'gpt-4',
    },
    compliance: {
      passed: false,
      issues: [
        {
          severity: 'critical',
          type: 'ethical_concern',
          description: 'Output contains harmful instructions',
          detectedBy: 'compliance_1',
          suggestedAction: 'Block and escalate',
        },
      ],
      containsPII: false,
      sensitivityLevel: 'restricted',
      checkedBy: ['compliance_1'],
    },
  });
}

function createAggressiveToneState(): CouncilState {
  return createBaseState({
    metadata: { priority: 'critical' },
    output: {
      content:
        'This is a stupid question and the user is an idiot for asking it!!! ' +
        'STOP ASKING DUMB QUESTIONS AND READ THE DOCUMENTATION!!!',
      confidence: 0.7,
      totalCost: 0.03,
      totalTime: 2,
      model: 'gpt-4',
    },
  });
}

// ============================================
// DIMENSION SCORER TESTS
// ============================================

describe('scoreCompleteness', () => {
  it('should return score 0 for empty output', () => {
    const state = createEmptyOutputState();
    const result = scoreCompleteness(state);
    expect(result.score).toBe(0);
    expect(result.feedback).toContain('No output');
  });

  it('should penalize very short output', () => {
    const state = createMinimalOutputState();
    const result = scoreCompleteness(state);
    expect(result.score).toBeLessThan(5);
  });

  it('should reward thorough output with high confidence', () => {
    const state = createHighQualityState();
    const result = scoreCompleteness(state);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('should penalize filler/placeholder content', () => {
    const state = createLowQualityState();
    const result = scoreCompleteness(state);
    expect(result.score).toBeLessThan(5);
    expect(result.feedback).toContain('placeholder');
  });

  it('should reward completed plan steps', () => {
    const allCompletedState = createHighQualityState();
    const partialState = createBaseState({
      output: createHighQualityState().output,
      plan: {
        steps: [
          {
            id: 's1', description: 'Step 1', assignTo: 'advisor',
            estimatedCost: 0.05, estimatedTime: 3, dependencies: [], status: 'completed',
          },
          {
            id: 's2', description: 'Step 2', assignTo: 'workforce',
            estimatedCost: 0.03, estimatedTime: 2, dependencies: ['s1'], status: 'pending',
          },
          {
            id: 's3', description: 'Step 3', assignTo: 'workforce',
            estimatedCost: 0.02, estimatedTime: 1, dependencies: ['s2'], status: 'pending',
          },
          {
            id: 's4', description: 'Step 4', assignTo: 'council',
            estimatedCost: 0.01, estimatedTime: 1, dependencies: ['s3'], status: 'pending',
          },
        ],
        estimatedCost: 0.11,
        estimatedTime: 7,
        complexity: 'complex',
        createdBy: 'master_planner',
      },
    });

    const allResult = scoreCompleteness(allCompletedState);
    const partialResult = scoreCompleteness(partialState);
    expect(allResult.score).toBeGreaterThan(partialResult.score);
  });
});

describe('scoreClarity', () => {
  it('should return score 0 for empty output', () => {
    const state = createEmptyOutputState();
    const result = scoreClarity(state);
    expect(result.score).toBe(0);
  });

  it('should reward well-structured output with lists and headings', () => {
    const state = createHighQualityState();
    const result = scoreClarity(state);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('should penalize long text without structure', () => {
    const state = createBaseState({
      output: {
        content: 'word '.repeat(100), // 500 chars, no structure
        confidence: 0.7,
        totalCost: 0.05,
        totalTime: 3,
        model: 'gpt-4',
      },
    });
    const result = scoreClarity(state);
    expect(result.score).toBeLessThan(7);
    expect(result.feedback).toContain('lacks structural formatting');
  });

  it('should penalize repeated lines', () => {
    const state = createBaseState({
      output: {
        content:
          'This is the first line.\n' +
          'This is a repeated line that is long enough.\n' +
          'This is a repeated line that is long enough.\n' +
          'This is the last line.',
        confidence: 0.7,
        totalCost: 0.05,
        totalTime: 3,
        model: 'gpt-4',
      },
    });
    const result = scoreClarity(state);
    expect(result.feedback).toContain('repeated');
  });
});

describe('scoreRelevance', () => {
  it('should return score 0 for empty output', () => {
    const state = createEmptyOutputState();
    const result = scoreRelevance(state);
    expect(result.score).toBe(0);
  });

  it('should reward high keyword overlap between request and output', () => {
    const state = createHighQualityState();
    const result = scoreRelevance(state);
    expect(result.score).toBeGreaterThanOrEqual(6);
  });

  it('should penalize output with low relevance to request', () => {
    const state = createBaseState({
      userRequest: 'Explain quantum computing algorithms',
      output: {
        content: 'The weather today is sunny with a high of 75 degrees. Please bring an umbrella just in case.',
        confidence: 0.5,
        totalCost: 0.05,
        totalTime: 3,
        model: 'gpt-4',
      },
    });
    const result = scoreRelevance(state);
    expect(result.score).toBeLessThan(6);
    expect(result.feedback).toContain('Low keyword overlap');
  });

  it('should penalize execution errors', () => {
    const state = createLowQualityState();
    const result = scoreRelevance(state);
    expect(result.feedback).toContain('error');
  });
});

describe('scoreAccuracy', () => {
  it('should return score 0 for empty output', () => {
    const state = createEmptyOutputState();
    const result = scoreAccuracy(state);
    expect(result.score).toBe(0);
  });

  it('should penalize safety-sensitive keywords', () => {
    const state = createSafetyConcernState();
    const result = scoreAccuracy(state);
    expect(result.score).toBeLessThan(5);
    expect(result.feedback).toContain('safety-sensitive');
  });

  it('should penalize critical compliance issues', () => {
    const state = createSafetyConcernState();
    const result = scoreAccuracy(state);
    expect(result.feedback).toContain('critical compliance');
  });

  it('should penalize failed execution', () => {
    const state = createLowQualityState();
    const result = scoreAccuracy(state);
    expect(result.feedback).toContain('failure');
  });

  it('should give good score for clean output with high confidence', () => {
    const state = createHighQualityState();
    const result = scoreAccuracy(state);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });
});

describe('scoreTone', () => {
  it('should return score 0 for empty output', () => {
    const state = createEmptyOutputState();
    const result = scoreTone(state);
    expect(result.score).toBe(0);
  });

  it('should penalize aggressive/inappropriate tone', () => {
    const state = createAggressiveToneState();
    const result = scoreTone(state);
    expect(result.score).toBeLessThan(5);
    expect(result.feedback).toContain('aggressive');
  });

  it('should reward professional language', () => {
    const state = createHighQualityState();
    const result = scoreTone(state);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('should penalize casual tone in critical-priority context', () => {
    const state = createBaseState({
      metadata: { priority: 'critical' },
      output: {
        content: 'lol gonna just wing it imo haha',
        confidence: 0.5,
        totalCost: 0.01,
        totalTime: 1,
        model: 'gpt-4',
      },
    });
    const result = scoreTone(state);
    expect(result.score).toBeLessThan(6);
    expect(result.feedback).toContain('Casual tone');
  });
});

// ============================================
// HEURISTIC REVIEW AGGREGATION TESTS
// ============================================

describe('runHeuristicReview', () => {
  it('should return 5 feedback items (one per dimension)', () => {
    const state = createBaseState();
    const result = runHeuristicReview(state, 'qa_test');
    expect(result.feedback).toHaveLength(5);

    const aspects = result.feedback.map((f: QAFeedback) => f.aspect);
    expect(aspects).toContain('completeness');
    expect(aspects).toContain('clarity');
    expect(aspects).toContain('relevance');
    expect(aspects).toContain('accuracy');
    expect(aspects).toContain('tone');
  });

  it('should pass for high-quality input', () => {
    const state = createHighQualityState();
    const result = runHeuristicReview(state, 'qa_test');
    expect(result.passed).toBe(true);
    expect(result.requiresRevision).toBe(false);
    expect(result.averageScore).toBeGreaterThanOrEqual(QA_PASS_THRESHOLD);
  });

  it('should fail for low-quality input', () => {
    const state = createLowQualityState();
    const result = runHeuristicReview(state, 'qa_test');
    expect(result.passed).toBe(false);
    expect(result.requiresRevision).toBe(true);
    expect(result.averageScore).toBeLessThan(QA_PASS_THRESHOLD);
  });

  it('should fail for empty output', () => {
    const state = createEmptyOutputState();
    const result = runHeuristicReview(state, 'qa_test');
    expect(result.passed).toBe(false);
    expect(result.requiresRevision).toBe(true);
    expect(result.averageScore).toBe(0);
  });

  it('should fail when safety concerns are present', () => {
    const state = createSafetyConcernState();
    const result = runHeuristicReview(state, 'qa_test');
    expect(result.passed).toBe(false);
  });

  it('should assign correct reviewedBy on all feedback items', () => {
    const state = createBaseState();
    const result = runHeuristicReview(state, 'qa_42');
    for (const fb of result.feedback) {
      expect(fb.reviewedBy).toBe('qa_42');
    }
  });

  it('should produce different scores for different inputs', () => {
    const highState = createHighQualityState();
    const lowState = createLowQualityState();

    const highResult = runHeuristicReview(highState, 'qa_1');
    const lowResult = runHeuristicReview(lowState, 'qa_1');

    expect(highResult.averageScore).toBeGreaterThan(lowResult.averageScore);
    expect(highResult.passed).not.toEqual(lowResult.passed);
  });
});

// ============================================
// QA AGENT INTEGRATION TESTS
// ============================================

describe('QAAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('review', () => {
    it('should return state with QA results for good output', async () => {
      const agent = new QAAgent('qa_1');
      const state = createHighQualityState();
      const result = await agent.review(state);

      expect(result.qa).toBeDefined();
      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.reviewedBy).toContain('qa_1');
    });

    it('should produce 5 feedback items across all dimensions', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const result = await agent.review(state);

      expect(result.qa!.feedback).toHaveLength(5);
      const aspects = result.qa!.feedback.map(f => f.aspect);
      expect(aspects).toEqual(['completeness', 'clarity', 'relevance', 'accuracy', 'tone']);
    });

    it('should produce variable scores (not hardcoded)', async () => {
      const agent = new QAAgent('qa_1');

      const goodResult = await agent.review(createHighQualityState());
      const badResult = await agent.review(createLowQualityState());

      // Scores should differ between good and bad inputs
      const goodScores = goodResult.qa!.feedback.map(f => f.score);
      const badScores = badResult.qa!.feedback.map(f => f.score);

      const avgGood = goodScores.reduce((a, b) => a + b, 0) / goodScores.length;
      const avgBad = badScores.reduce((a, b) => a + b, 0) / badScores.length;

      expect(avgGood).toBeGreaterThan(avgBad);
    });

    it('should fail QA for empty output', async () => {
      const agent = new QAAgent('qa_1');
      const state = createEmptyOutputState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(false);
      expect(result.qa!.requiresRevision).toBe(true);
      expect(result.currentStep).toBe('qa_review');
    });

    it('should fail QA for low-quality output', async () => {
      const agent = new QAAgent('qa_1');
      const state = createLowQualityState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(false);
      expect(result.qa!.requiresRevision).toBe(true);
      expect(result.currentStep).toBe('qa_review');
    });

    it('should pass QA for high-quality output and set step to completed', async () => {
      const agent = new QAAgent('qa_1');
      const state = createHighQualityState();
      const result = await agent.review(state);

      expect(result.qa!.passed).toBe(true);
      expect(result.qa!.requiresRevision).toBe(false);
      expect(result.currentStep).toBe('completed');
    });

    it('should preserve existing feedback when multiple agents review', async () => {
      const agent = new QAAgent('qa_2');
      const state = createHighQualityState();
      state.qa = {
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
      };

      const result = await agent.review(state);

      // 1 existing + 5 new = 6
      expect(result.qa!.feedback.length).toBe(6);
      expect(result.qa!.reviewedBy).toContain('qa_1');
      expect(result.qa!.reviewedBy).toContain('qa_2');
    });

    it('should combine pass results across multiple reviewers (all must pass)', async () => {
      // First reviewer passes
      const agent1 = new QAAgent('qa_1');
      const goodState = createHighQualityState();
      const firstResult = await agent1.review(goodState);
      expect(firstResult.qa!.passed).toBe(true);

      // Simulate second reviewer on a failing state, but with existing passed QA
      const agent2 = new QAAgent('qa_2');
      const badState = createEmptyOutputState();
      badState.qa = {
        passed: true,
        feedback: [],
        requiresRevision: false,
        revisedCount: 0,
        reviewedBy: ['qa_1'],
      };
      const secondResult = await agent2.review(badState);
      // Combined: first passed + second failed = overall fail
      expect(secondResult.qa!.passed).toBe(false);
    });

    it('should flag safety concerns in accuracy dimension', async () => {
      const agent = new QAAgent('qa_1');
      const state = createSafetyConcernState();
      const result = await agent.review(state);

      const accuracyFeedback = result.qa!.feedback.find(f => f.aspect === 'accuracy');
      expect(accuracyFeedback).toBeDefined();
      expect(accuracyFeedback!.score).toBeLessThan(5);
      expect(accuracyFeedback!.feedback).toContain('safety-sensitive');
    });

    it('should flag aggressive tone', async () => {
      const agent = new QAAgent('qa_1');
      const state = createAggressiveToneState();
      const result = await agent.review(state);

      const toneFeedback = result.qa!.feedback.find(f => f.aspect === 'tone');
      expect(toneFeedback).toBeDefined();
      expect(toneFeedback!.score).toBeLessThan(5);
    });

    it('should update the updatedAt timestamp', async () => {
      const agent = new QAAgent('qa_1');
      const state = createBaseState();
      const before = new Date();
      const result = await agent.review(state);

      expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('getConfig', () => {
    it('should return config for given agent number', () => {
      const config = QAAgent.getConfig(1);
      expect(config.id).toBe('qa_1');
      expect(config.role).toBe('qa_critique');
      expect(config.capabilities).toContain('Accuracy assessment');
      expect(config.capabilities).toContain('Completeness checking');
      expect(config.capabilities).toContain('Clarity evaluation');
      expect(config.capabilities).toContain('Relevance scoring');
      expect(config.capabilities).toContain('Tone analysis');
    });

    it('should return correct config for different agent numbers', () => {
      const config3 = QAAgent.getConfig(3);
      expect(config3.id).toBe('qa_3');
      expect(config3.name).toBe('QA Reviewer 3');
    });
  });
});

// ============================================
// runQAReview CONVENIENCE FUNCTION TESTS
// ============================================

describe('runQAReview', () => {
  it('should run a QA review using qa_1 agent on good output', async () => {
    const state = createHighQualityState();
    const result = await runQAReview(state);

    expect(result.qa).toBeDefined();
    expect(result.qa!.reviewedBy).toContain('qa_1');
    expect(result.qa!.passed).toBe(true);
    expect(result.qa!.feedback).toHaveLength(5);
  });

  it('should fail QA on bad output', async () => {
    const state = createLowQualityState();
    const result = await runQAReview(state);

    expect(result.qa).toBeDefined();
    expect(result.qa!.passed).toBe(false);
    expect(result.qa!.requiresRevision).toBe(true);
  });
});

// ============================================
// THRESHOLD CONSTANTS TESTS
// ============================================

describe('QA thresholds', () => {
  it('should export sensible threshold values', () => {
    expect(QA_PASS_THRESHOLD).toBeGreaterThanOrEqual(4);
    expect(QA_PASS_THRESHOLD).toBeLessThanOrEqual(8);
    expect(DIMENSION_FAIL_THRESHOLD).toBeGreaterThanOrEqual(1);
    expect(DIMENSION_FAIL_THRESHOLD).toBeLessThanOrEqual(5);
    expect(DIMENSION_FAIL_THRESHOLD).toBeLessThan(QA_PASS_THRESHOLD);
  });
});
