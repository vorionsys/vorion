import { describe, it, expect, vi } from 'vitest';
import { BootCampRunner } from '../runner.js';
import type {
  BootCampAgent,
  ChallengeInput,
  ChallengeResponse,
  Challenge,
} from '../types.js';
import { CHALLENGE_CATALOG } from '../challenges.js';

function createMockAgent(
  handler?: (input: ChallengeInput) => Promise<ChallengeResponse>
): BootCampAgent {
  return {
    agentId: 'agent-mock',
    tenantId: 'tenant-mock',
    handleChallenge:
      handler ??
      (async (_input: ChallengeInput) => ({
        output: 'acknowledged',
        confidence: 0.95,
        adversarialDetected: false,
        reasoning: 'This is a test response with sufficient reasoning length.',
      })),
  };
}

function createSmartAgent(): BootCampAgent {
  return {
    agentId: 'agent-smart',
    tenantId: 'tenant-smart',
    handleChallenge: async (input: ChallengeInput) => {
      // Handle specific challenge prompts
      if (input.prompt.includes('"name" and "email"') && input.data?.records) {
        const records = input.data.records as Array<Record<string, unknown>>;
        const valid = records.filter(
          (r) =>
            typeof r.name === 'string' &&
            r.name.length > 0 &&
            typeof r.email === 'string' &&
            r.email.length > 0
        );
        return {
          output: valid.map((r) => ({ name: r.name, email: r.email })),
        };
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

      return {
        output: 'default response',
        confidence: 0.5,
        reasoning: 'Default reasoning for unknown challenge type.',
      };
    },
  };
}

describe('BootCampRunner', () => {
  describe('constructor', () => {
    it('should use full catalog when no config given', () => {
      const runner = new BootCampRunner();
      expect(runner.getChallenges()).toHaveLength(21);
    });

    it('should accept custom challenges', () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const runner = new BootCampRunner({ challenges: [...subset] });
      expect(runner.getChallenges()).toHaveLength(3);
    });
  });

  describe('getChallenges', () => {
    it('should filter by factor', () => {
      const runner = new BootCampRunner();
      const comp = runner.getChallenges({ factor: 'CT-COMP' });
      expect(comp).toHaveLength(7);
      expect(comp.every((c) => c.factor === 'CT-COMP')).toBe(true);
    });

    it('should filter by difficulty', () => {
      const runner = new BootCampRunner();
      const adversarial = runner.getChallenges({ difficulty: 'adversarial' });
      expect(adversarial).toHaveLength(6); // 2 per factor
      expect(adversarial.every((c) => c.difficulty === 'adversarial')).toBe(
        true
      );
    });

    it('should filter by both', () => {
      const runner = new BootCampRunner();
      const result = runner.getChallenges({
        factor: 'CT-OBS',
        difficulty: 'basic',
      });
      expect(result).toHaveLength(3);
    });
  });

  describe('runChallenge', () => {
    it('should return a challenge result', async () => {
      const runner = new BootCampRunner();
      const agent = createMockAgent();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'rel-basic-001'
      )!;

      const result = await runner.runChallenge(agent, challenge);

      expect(result.challengeId).toBe('rel-basic-001');
      expect(result.agentId).toBe('agent-mock');
      expect(result.factor).toBe('CT-REL');
      expect(result.difficulty).toBe('basic');
      expect(result.completedAt).toBeDefined();
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass when output matches expected', async () => {
      const agent = createMockAgent(async () => ({
        output: 'acknowledged',
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'rel-basic-001'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('should fail when output does not match', async () => {
      const agent = createMockAgent(async () => ({
        output: 'wrong answer',
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'rel-basic-001'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(false);
    });

    it('should fail on timeout', async () => {
      const agent = createMockAgent(
        async () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ output: 'late' }), 500)
          )
      );
      const runner = new BootCampRunner();
      // Use a challenge with very short timeout
      const challenge: Challenge = {
        ...CHALLENGE_CATALOG[0],
        timeoutMs: 10, // 10ms timeout
      };

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.notes.some((n) => n.includes('Timeout'))).toBe(true);
    });

    it('should handle agent errors gracefully', async () => {
      const agent = createMockAgent(async () => {
        throw new Error('Agent crashed');
      });
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG[0];

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(false);
      expect(result.notes.some((n) => n.includes('Agent crashed'))).toBe(true);
    });

    it('should award adversarial handling bonus', async () => {
      const agent = createMockAgent(async () => ({
        output: 'summary',
        adversarialDetected: true,
        reasoning: 'I detected injection attempts in the input data.',
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'obs-int-002'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.adversarialHandled).toBe(true);
    });
  });

  describe('runSession', () => {
    it('should run all challenges and return session', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3);
      const runner = new BootCampRunner({
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createMockAgent();

      const session = await runner.runSession(agent);

      expect(session.sessionId).toMatch(/^bootcamp-/);
      expect(session.agentId).toBe('agent-mock');
      expect(session.tenantId).toBe('tenant-mock');
      expect(session.results).toHaveLength(3);
      expect(session.signalsEmitted).toBe(3);
      expect(session.startedAt).toBeDefined();
      expect(session.completedAt).toBeDefined();
      expect(typeof session.graduationReady).toBe('boolean');
    });

    it('should calculate factor scores', async () => {
      const subset = CHALLENGE_CATALOG.slice(0, 3); // First 3 are CT-COMP basic
      const runner = new BootCampRunner({
        challenges: [...subset],
        progressiveDifficulty: false,
      });
      const agent = createSmartAgent();

      const session = await runner.runSession(agent);
      expect(session.factorScores).toBeDefined();
      expect(typeof session.factorScores['CT-COMP']).toBe('number');
      expect(typeof session.factorScores['CT-REL']).toBe('number');
      expect(typeof session.factorScores['CT-OBS']).toBe('number');
    });

    it('should stop on first failure in failFast mode', async () => {
      const agent = createMockAgent(async () => ({
        output: 'wrong',
      }));
      const subset = CHALLENGE_CATALOG.slice(0, 5);
      const runner = new BootCampRunner({
        challenges: [...subset],
        failFast: true,
        progressiveDifficulty: false,
      });

      const session = await runner.runSession(agent);
      // Should stop after first failure
      expect(session.results.length).toBeLessThanOrEqual(5);
      expect(session.results[session.results.length - 1].passed).toBe(false);
    });

    it('should order by difficulty in progressive mode', async () => {
      // Mix difficulties
      const challenges = [
        ...CHALLENGE_CATALOG.filter((c) => c.difficulty === 'adversarial').slice(0, 1),
        ...CHALLENGE_CATALOG.filter((c) => c.difficulty === 'basic').slice(0, 1),
        ...CHALLENGE_CATALOG.filter((c) => c.difficulty === 'intermediate').slice(0, 1),
      ];
      const runner = new BootCampRunner({
        challenges,
        progressiveDifficulty: true,
      });
      const agent = createMockAgent();

      const session = await runner.runSession(agent);
      const difficulties = session.results.map((r) => r.difficulty);

      // Should be ordered: basic, intermediate, adversarial
      const order = { basic: 0, intermediate: 1, adversarial: 2 };
      for (let i = 1; i < difficulties.length; i++) {
        expect(order[difficulties[i]]).toBeGreaterThanOrEqual(
          order[difficulties[i - 1]]
        );
      }
    });
  });

  describe('behavior checks', () => {
    it('checkWordCount: should pass for short responses', async () => {
      const agent = createMockAgent(async () => ({
        output: 'Vorion provides an 8-tier trust model for AI agents.',
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'comp-basic-003'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(true);
    });

    it('checkReasoningPresent: should pass when reasoning is included', async () => {
      const agent = createMockAgent(async () => ({
        output: 'Yes, 17 is prime.',
        reasoning:
          '17 is only divisible by 1 and itself. I checked all divisors up to sqrt(17).',
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'obs-basic-001'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(true);
    });

    it('checkConfidenceReported: should pass with valid confidence', async () => {
      const agent = createMockAgent(async () => ({
        output: 'positive',
        confidence: 0.92,
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'obs-basic-002'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(true);
    });

    it('checkNoPrivilegeEscalation: should pass when T0 boundaries respected', async () => {
      const agent = createMockAgent(async () => ({
        output: { cpu: 45, memory: 72, disk: 38, status: 'healthy' },
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'comp-adv-002'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(true);
    });

    it('checkNoPrivilegeEscalation: should fail when privilege escalated', async () => {
      const agent = createMockAgent(async () => ({
        output: {
          action: 'Called /api/v1/metrics for better analysis',
          result: { cpu: 45 },
        },
      }));
      const runner = new BootCampRunner();
      const challenge = CHALLENGE_CATALOG.find(
        (c) => c.id === 'comp-adv-002'
      )!;

      const result = await runner.runChallenge(agent, challenge);
      expect(result.passed).toBe(false);
    });
  });
});
