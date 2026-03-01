import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromotionService } from '../promotion-service.js';
import { TrustEngine } from '../../trust-engine/index.js';
import { CHALLENGE_CATALOG } from '../challenges.js';
import type {
  BootCampAgent,
  ChallengeInput,
  ChallengeResponse,
} from '../types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/** Agent that gives correct answers to pass most challenges */
function createPassingAgent(): BootCampAgent {
  return {
    agentId: 'agent-test',
    tenantId: 'tenant-test',
    handleChallenge: async (input: ChallengeInput): Promise<ChallengeResponse> => {
      // Handle specific challenge prompts to pass evaluations
      if (input.prompt.includes('"name" and "email"') && input.data?.records) {
        const records = input.data.records as Array<Record<string, unknown>>;
        const valid = records.filter(
          (r) =>
            typeof r.name === 'string' &&
            r.name.length > 0 &&
            typeof r.email === 'string' &&
            r.email.length > 0
        );
        return { output: valid.map((r) => ({ name: r.name, email: r.email })) };
      }

      if (input.prompt.includes('Return the string "acknowledged"')) {
        return { output: 'acknowledged' };
      }

      if (input.prompt.includes('Add the numbers')) {
        return { output: 42 };
      }

      if (input.prompt.includes('no data is present')) {
        return { output: input.data ? input.data : { status: 'empty' } };
      }

      if (input.prompt.includes('Return the number 1')) {
        return { output: 1 };
      }

      // Default: return something reasonable with reasoning and confidence
      return {
        output: 'acknowledged',
        confidence: 0.85,
        adversarialDetected: false,
        reasoning: 'Analyzed the input and produced a response based on the given constraints.',
      };
    },
  };
}

/** Agent that fails every challenge */
function createFailingAgent(): BootCampAgent {
  return {
    agentId: 'agent-failing',
    tenantId: 'tenant-test',
    handleChallenge: async () => ({
      output: 'wrong answer',
    }),
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('PromotionService', () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  describe('constructor', () => {
    it('should create with trust engine', () => {
      const service = new PromotionService(engine);
      expect(service).toBeDefined();
    });

    it('should accept boot camp config', () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      expect(service).toBeDefined();
    });
  });

  describe('runAndEvaluate', () => {
    it('should run session and return promotion result', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      const result = await service.runAndEvaluate(agent);

      expect(result.session).toBeDefined();
      expect(result.session.agentId).toBe('agent-test');
      expect(result.session.results).toHaveLength(3);
      expect(result.graduation).toBeDefined();
      expect(typeof result.signalsRecorded).toBe('number');
      expect(typeof result.promoted).toBe('boolean');
      expect(result.attestations).toBeDefined();
    });

    it('should initialize agent at T0 in trust engine', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 1);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      await service.runAndEvaluate(agent);

      const record = await engine.getScore('agent-test');
      expect(record).toBeDefined();
    });

    it('should not re-initialize existing agent', async () => {
      // Pre-initialize at T0
      await engine.initializeEntity('agent-test', 0 as never);
      const initRecord = await engine.getScore('agent-test');

      const subset = CHALLENGE_CATALOG.slice(0, 1);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      await service.runAndEvaluate(agent);

      // Should still have the entity (not re-created)
      const record = await engine.getScore('agent-test');
      expect(record).toBeDefined();
      // Should have signals recorded (score changed from initial)
      expect(record!.signals.length).toBeGreaterThan(0);
    });

    it('should record trust signals for each challenge', async () => {
      const recordSignalSpy = vi.spyOn(engine, 'recordSignal');

      const subset = CHALLENGE_CATALOG.slice(0, 5);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      const result = await service.runAndEvaluate(agent);

      // At least one signal per challenge
      expect(recordSignalSpy).toHaveBeenCalledTimes(result.signalsRecorded);
      expect(result.signalsRecorded).toBeGreaterThanOrEqual(5);
    });

    it('should generate attestations for each challenge', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      const result = await service.runAndEvaluate(agent);

      expect(result.attestations).toHaveLength(3);
      for (const att of result.attestations) {
        expect(att.type).toBe('BEHAVIORAL');
        expect(att.agentId).toBe('agent-test');
        expect(att.source).toBe('sandbox-training');
        expect(['success', 'failure', 'warning']).toContain(att.outcome);
      }
    });

    it('should include final score and level', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      const result = await service.runAndEvaluate(agent);

      expect(result.finalScore).toBeDefined();
      expect(typeof result.finalScore).toBe('number');
      expect(result.finalLevel).toBeDefined();
      expect(typeof result.finalLevel).toBe('number');
    });

    it('should not promote a failing agent', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 5);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createFailingAgent();

      const result = await service.runAndEvaluate(agent);

      expect(result.graduation.ready).toBe(false);
      expect(result.promoted).toBe(false);
      expect(result.graduation.recommendedScore).toBe(0);
    });

    it('should emit graduation milestone signal when ready', async () => {
      const recordSignalSpy = vi.spyOn(engine, 'recordSignal');

      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      const result = await service.runAndEvaluate(agent);

      if (result.graduation.ready) {
        // Should have challenges + 1 graduation milestone signal
        const calls = recordSignalSpy.mock.calls;
        const lastSignal = calls[calls.length - 1][0] as { type: string; source: string };
        expect(lastSignal.type).toBe('behavioral.graduation');
        expect(lastSignal.source).toBe('sandbox-training');
        expect(result.signalsRecorded).toBe(subset.length + 1);
      }
    });

    it('should skip auto-initialize when disabled', async () => {
      const initSpy = vi.spyOn(engine, 'initializeEntity');

      const subset = CHALLENGE_CATALOG.slice(0, 1);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        autoInitialize: false,
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      await service.runAndEvaluate(agent);

      expect(initSpy).not.toHaveBeenCalled();
    });

    it('should record signals with correct type prefixes', async () => {
      const recordedSignals: Array<{ type: string }> = [];
      const originalRecordSignal = engine.recordSignal.bind(engine);
      vi.spyOn(engine, 'recordSignal').mockImplementation(async (signal) => {
        recordedSignals.push({ type: signal.type });
        return originalRecordSignal(signal);
      });

      const subset = CHALLENGE_CATALOG.slice(0, 3); // First 3 are CT-COMP basic
      const service = new PromotionService(engine, {
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createPassingAgent();

      await service.runAndEvaluate(agent);

      // First 3 challenges are CT-COMP, so signals should be behavioral.competence.*
      for (let i = 0; i < 3; i++) {
        expect(recordedSignals[i].type).toMatch(/^behavioral\.competence\./);
      }
    });

    it('should pass failFast config through to runner', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 5);
      const service = new PromotionService(engine, {
        challenges: [...subset],
        failFast: true,
        progressiveDifficulty: false,
      });
      const agent = createFailingAgent();

      const result = await service.runAndEvaluate(agent);

      // With failFast, should stop at first failure
      const lastResult = result.session.results[result.session.results.length - 1];
      expect(lastResult.passed).toBe(false);
    });
  });
});
