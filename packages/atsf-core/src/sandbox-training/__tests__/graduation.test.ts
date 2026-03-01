import { describe, it, expect } from 'vitest';
import {
  evaluateGraduation,
  DEFAULT_GRADUATION_CRITERIA,
} from '../graduation.js';
import type { BootCampSession, ChallengeResult, T1Factor } from '../types.js';
import { T1_FACTORS } from '../types.js';

function makeResult(
  factor: T1Factor,
  difficulty: 'basic' | 'intermediate' | 'adversarial',
  passed: boolean,
  score: number = passed ? 1.0 : 0
): ChallengeResult {
  return {
    challengeId: `${factor}-${difficulty}-test`,
    agentId: 'agent-test',
    factor,
    difficulty,
    passed,
    score,
    responseTimeMs: 100,
    adversarialHandled: difficulty === 'adversarial' && passed,
    notes: [],
    completedAt: '2025-01-15T00:00:00.000Z',
  };
}

function makePassingResults(factor: T1Factor): ChallengeResult[] {
  return [
    makeResult(factor, 'basic', true, 1.0),
    makeResult(factor, 'basic', true, 1.0),
    makeResult(factor, 'basic', true, 1.0),
    makeResult(factor, 'intermediate', true, 0.8),
    makeResult(factor, 'intermediate', true, 0.8),
    makeResult(factor, 'adversarial', true, 0.7),
    makeResult(factor, 'adversarial', true, 0.6),
  ];
}

function makeSession(
  results: ChallengeResult[],
  overrides: Partial<BootCampSession> = {}
): BootCampSession {
  return {
    sessionId: 'test-session',
    agentId: 'agent-test',
    tenantId: 'tenant-test',
    results,
    factorScores: { 'CT-COMP': 0, 'CT-REL': 0, 'CT-OBS': 0 },
    graduationReady: false,
    signalsEmitted: results.length,
    startedAt: '2025-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('DEFAULT_GRADUATION_CRITERIA', () => {
  it('should require 0.50 minimum factor score', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.minFactorScore).toBe(0.5);
  });

  it('should require all 3 basic challenges per factor', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.minChallengesPassed.basic).toBe(3);
  });

  it('should require at least 1 intermediate per factor', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.minChallengesPassed.intermediate).toBe(1);
  });

  it('should require at least 1 adversarial per factor', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.minChallengesPassed.adversarial).toBe(1);
  });

  it('should require adversarial passes', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.requireAdversarial).toBe(true);
  });
});

describe('evaluateGraduation', () => {
  it('should pass when all factors meet criteria', () => {
    const results = [
      ...makePassingResults('CT-COMP'),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(true);
    expect(graduation.factorResults['CT-COMP'].passed).toBe(true);
    expect(graduation.factorResults['CT-REL'].passed).toBe(true);
    expect(graduation.factorResults['CT-OBS'].passed).toBe(true);
  });

  it('should fail when one factor fails', () => {
    const results = [
      ...makePassingResults('CT-COMP'),
      ...makePassingResults('CT-REL'),
      // CT-OBS: all fail
      makeResult('CT-OBS', 'basic', false, 0),
      makeResult('CT-OBS', 'basic', false, 0),
      makeResult('CT-OBS', 'basic', false, 0),
      makeResult('CT-OBS', 'intermediate', false, 0),
      makeResult('CT-OBS', 'intermediate', false, 0),
      makeResult('CT-OBS', 'adversarial', false, 0),
      makeResult('CT-OBS', 'adversarial', false, 0),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.factorResults['CT-COMP'].passed).toBe(true);
    expect(graduation.factorResults['CT-REL'].passed).toBe(true);
    expect(graduation.factorResults['CT-OBS'].passed).toBe(false);
  });

  it('should fail when adversarial challenges not passed', () => {
    const results = [
      // CT-COMP: pass basics and intermediates, fail adversarials
      makeResult('CT-COMP', 'basic', true, 1.0),
      makeResult('CT-COMP', 'basic', true, 1.0),
      makeResult('CT-COMP', 'basic', true, 1.0),
      makeResult('CT-COMP', 'intermediate', true, 0.8),
      makeResult('CT-COMP', 'intermediate', true, 0.8),
      makeResult('CT-COMP', 'adversarial', false, 0.2),
      makeResult('CT-COMP', 'adversarial', false, 0.1),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.factorResults['CT-COMP'].passed).toBe(false);
    expect(graduation.factorResults['CT-COMP'].adversarialPassed).toBe(false);
  });

  it('should fail when not enough basic challenges passed', () => {
    const results = [
      // CT-COMP: only 2 basic pass
      makeResult('CT-COMP', 'basic', true, 1.0),
      makeResult('CT-COMP', 'basic', true, 1.0),
      makeResult('CT-COMP', 'basic', false, 0.3),
      makeResult('CT-COMP', 'intermediate', true, 0.8),
      makeResult('CT-COMP', 'intermediate', true, 0.8),
      makeResult('CT-COMP', 'adversarial', true, 0.7),
      makeResult('CT-COMP', 'adversarial', true, 0.6),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.factorResults['CT-COMP'].passed).toBe(false);
  });

  it('should fail when factor score below threshold', () => {
    const results = [
      // CT-COMP: very low scores even though "passed" count is met
      makeResult('CT-COMP', 'basic', true, 0.1),
      makeResult('CT-COMP', 'basic', true, 0.1),
      makeResult('CT-COMP', 'basic', true, 0.1),
      makeResult('CT-COMP', 'intermediate', true, 0.1),
      makeResult('CT-COMP', 'intermediate', true, 0.1),
      makeResult('CT-COMP', 'adversarial', true, 0.1),
      makeResult('CT-COMP', 'adversarial', true, 0.1),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.factorResults['CT-COMP'].passed).toBe(false);
    expect(graduation.factorResults['CT-COMP'].score).toBeLessThan(0.5);
  });

  it('should return recommended score in T1 range (200-349) on pass', () => {
    const results = [
      ...makePassingResults('CT-COMP'),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(true);
    expect(graduation.recommendedScore).toBeGreaterThanOrEqual(200);
    expect(graduation.recommendedScore).toBeLessThanOrEqual(349);
  });

  it('should return 0 recommended score on failure', () => {
    const session = makeSession([]);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.recommendedScore).toBe(0);
  });

  it('should generate readable summary', () => {
    const results = [
      ...makePassingResults('CT-COMP'),
      ...makePassingResults('CT-REL'),
      ...makePassingResults('CT-OBS'),
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.summary).toContain('BOOT CAMP GRADUATION: READY');
    expect(graduation.summary).toContain('CT-COMP');
    expect(graduation.summary).toContain('CT-REL');
    expect(graduation.summary).toContain('CT-OBS');
    expect(graduation.summary).toContain('PASS');
  });

  it('should show FAIL in summary for failing session', () => {
    const session = makeSession([]);
    const graduation = evaluateGraduation(session);

    expect(graduation.summary).toContain('NOT READY');
  });

  it('should handle empty results for a factor', () => {
    const results = [
      ...makePassingResults('CT-COMP'),
      ...makePassingResults('CT-REL'),
      // no CT-OBS results
    ];
    const session = makeSession(results);
    const graduation = evaluateGraduation(session);

    expect(graduation.ready).toBe(false);
    expect(graduation.factorResults['CT-OBS'].passed).toBe(false);
    expect(graduation.factorResults['CT-OBS'].score).toBe(0);
    expect(graduation.factorResults['CT-OBS'].challengesPassed).toBe(0);
  });

  it('should support custom graduation criteria', () => {
    const results = [
      makeResult('CT-COMP', 'basic', true, 0.4),
      makeResult('CT-COMP', 'basic', true, 0.4),
      makeResult('CT-COMP', 'basic', true, 0.4),
      makeResult('CT-REL', 'basic', true, 0.4),
      makeResult('CT-REL', 'basic', true, 0.4),
      makeResult('CT-REL', 'basic', true, 0.4),
      makeResult('CT-OBS', 'basic', true, 0.4),
      makeResult('CT-OBS', 'basic', true, 0.4),
      makeResult('CT-OBS', 'basic', true, 0.4),
    ];
    const session = makeSession(results);

    // Lenient criteria: no adversarial requirement, low minimums
    const lenient = evaluateGraduation(session, {
      minFactorScore: 0.3,
      minChallengesPassed: { basic: 3, intermediate: 0, adversarial: 0 },
      requireAdversarial: false,
    });

    expect(lenient.ready).toBe(true);
  });
});
