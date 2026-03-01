import { describe, it, expect } from 'vitest';
import {
  challengeToTrustSignal,
  challengeToAttestation,
  calculateWeightedScore,
  calculateTotalWeightedScore,
} from '../scorer.js';
import type { ChallengeResult } from '../types.js';

function makeResult(overrides: Partial<ChallengeResult> = {}): ChallengeResult {
  return {
    challengeId: 'comp-basic-001',
    agentId: 'agent-test',
    factor: 'CT-COMP',
    difficulty: 'basic',
    passed: true,
    score: 0.8,
    responseTimeMs: 100,
    adversarialHandled: false,
    notes: [],
    completedAt: '2025-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('challengeToTrustSignal', () => {
  it('should generate a trust signal with correct structure', () => {
    const result = makeResult();
    const signal = challengeToTrustSignal(result);

    expect(signal.entityId).toBe('agent-test');
    expect(signal.type).toBe('behavioral.competence.basic');
    expect(signal.value).toBe(0.8);
    expect(signal.source).toBe('sandbox-training');
    expect(signal.id).toContain('bootcamp-comp-basic-001');
  });

  it('should map CT-COMP to behavioral.competence', () => {
    const signal = challengeToTrustSignal(makeResult({ factor: 'CT-COMP' }));
    expect(signal.type).toMatch(/^behavioral\.competence\./);
  });

  it('should map CT-REL to behavioral.reliability', () => {
    const signal = challengeToTrustSignal(
      makeResult({ factor: 'CT-REL', challengeId: 'rel-basic-001' })
    );
    expect(signal.type).toMatch(/^behavioral\.reliability\./);
  });

  it('should map CT-OBS to compliance.observability', () => {
    const signal = challengeToTrustSignal(
      makeResult({ factor: 'CT-OBS', challengeId: 'obs-basic-001' })
    );
    expect(signal.type).toMatch(/^compliance\.observability\./);
  });

  it('should include difficulty in signal type', () => {
    const signal = challengeToTrustSignal(
      makeResult({ difficulty: 'adversarial' })
    );
    expect(signal.type).toBe('behavioral.competence.adversarial');
  });

  it('should include metadata with challenge details', () => {
    const result = makeResult({
      passed: true,
      adversarialHandled: true,
      responseTimeMs: 42,
    });
    const signal = challengeToTrustSignal(result);

    expect(signal.metadata).toBeDefined();
    expect(signal.metadata!.challengeId).toBe('comp-basic-001');
    expect(signal.metadata!.passed).toBe(true);
    expect(signal.metadata!.adversarialHandled).toBe(true);
    expect(signal.metadata!.responseTimeMs).toBe(42);
    expect(signal.metadata!.weight).toBe(1.0); // basic weight
  });
});

describe('challengeToAttestation', () => {
  it('should generate a BEHAVIORAL attestation', () => {
    const attestation = challengeToAttestation(makeResult());

    expect(attestation.type).toBe('BEHAVIORAL');
    expect(attestation.agentId).toBe('agent-test');
    expect(attestation.source).toBe('sandbox-training');
  });

  it('should map passed result to success outcome', () => {
    const attestation = challengeToAttestation(makeResult({ passed: true }));
    expect(attestation.outcome).toBe('success');
  });

  it('should map failed result to failure outcome', () => {
    const attestation = challengeToAttestation(makeResult({ passed: false }));
    expect(attestation.outcome).toBe('failure');
  });

  it('should include evidence with challenge details', () => {
    const result = makeResult({
      score: 0.75,
      adversarialHandled: true,
      responseTimeMs: 200,
      notes: ['Time bonus applied'],
    });
    const attestation = challengeToAttestation(result);

    expect(attestation.evidence.challengeId).toBe('comp-basic-001');
    expect(attestation.evidence.score).toBe(0.75);
    expect(attestation.evidence.adversarialHandled).toBe(true);
    expect(attestation.evidence.responseTimeMs).toBe(200);
    expect(attestation.evidence.notes).toContain('Time bonus applied');
  });

  it('should include action with factor and difficulty', () => {
    const attestation = challengeToAttestation(
      makeResult({ factor: 'CT-REL', difficulty: 'adversarial' })
    );
    expect(attestation.action).toBe('bootcamp.CT-REL.adversarial');
  });
});

describe('calculateWeightedScore', () => {
  it('should apply basic weight (1.0)', () => {
    expect(calculateWeightedScore(makeResult({ score: 0.8, difficulty: 'basic' }))).toBe(0.8);
  });

  it('should apply intermediate weight (1.5)', () => {
    expect(
      calculateWeightedScore(makeResult({ score: 0.8, difficulty: 'intermediate' }))
    ).toBeCloseTo(1.2);
  });

  it('should apply adversarial weight (2.0)', () => {
    expect(
      calculateWeightedScore(makeResult({ score: 0.5, difficulty: 'adversarial' }))
    ).toBeCloseTo(1.0);
  });
});

describe('calculateTotalWeightedScore', () => {
  it('should return 0 for empty results', () => {
    expect(calculateTotalWeightedScore([])).toBe(0);
  });

  it('should calculate weighted average for single result', () => {
    const results = [makeResult({ score: 0.8, difficulty: 'basic' })];
    expect(calculateTotalWeightedScore(results)).toBeCloseTo(0.8);
  });

  it('should calculate weighted average for mixed difficulties', () => {
    const results = [
      makeResult({ score: 1.0, difficulty: 'basic' }),       // 1.0 * 1.0 = 1.0
      makeResult({ score: 0.8, difficulty: 'intermediate' }), // 0.8 * 1.5 = 1.2
      makeResult({ score: 0.5, difficulty: 'adversarial' }),   // 0.5 * 2.0 = 1.0
    ];
    // total weighted = 3.2, total weight = 4.5
    // average = 3.2 / 4.5 ≈ 0.711
    expect(calculateTotalWeightedScore(results)).toBeCloseTo(3.2 / 4.5);
  });

  it('should return 0 when all scores are 0', () => {
    const results = [
      makeResult({ score: 0, difficulty: 'basic' }),
      makeResult({ score: 0, difficulty: 'adversarial' }),
    ];
    expect(calculateTotalWeightedScore(results)).toBe(0);
  });
});
