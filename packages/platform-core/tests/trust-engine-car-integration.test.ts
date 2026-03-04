import { describe, it, expect } from 'vitest';
import {
  scoreToTier,
  certificationTierToMinScore,
  certificationTierToMaxScore,
  certificationTierToScore,
  lookupCertificationTier,
  lookupCertificationTierWithHysteresis,
  DEFAULT_DEMOTION_HYSTERESIS,
  determineCeilingReason,
  createCARTrustContext,
  applyCARFloor,
  enforceCARCeiling,
  attestationToTrustSignal,
  CertificationTier,
  CapabilityLevel,
} from '../src/trust-engine/car-integration.js';

describe('lookupCertificationTier', () => {
  it('maps score 0 to T0_SANDBOX', () => {
    expect(lookupCertificationTier(0)).toBe(CertificationTier.T0_SANDBOX);
  });

  it('maps score 199 to T0_SANDBOX', () => {
    expect(lookupCertificationTier(199)).toBe(CertificationTier.T0_SANDBOX);
  });

  it('maps score 200 to T1_OBSERVED', () => {
    expect(lookupCertificationTier(200)).toBe(CertificationTier.T1_OBSERVED);
  });

  it('maps score 499 to T2_PROVISIONAL', () => {
    expect(lookupCertificationTier(499)).toBe(CertificationTier.T2_PROVISIONAL);
  });

  it('maps score 500 to T3_MONITORED', () => {
    expect(lookupCertificationTier(500)).toBe(CertificationTier.T3_MONITORED);
  });

  it('maps score 800 to T5_TRUSTED', () => {
    expect(lookupCertificationTier(800)).toBe(CertificationTier.T5_TRUSTED);
  });

  it('maps score 951 to T7_AUTONOMOUS', () => {
    expect(lookupCertificationTier(951)).toBe(CertificationTier.T7_AUTONOMOUS);
  });

  it('maps score 1000 to T7_AUTONOMOUS', () => {
    expect(lookupCertificationTier(1000)).toBe(CertificationTier.T7_AUTONOMOUS);
  });
});

describe('lookupCertificationTierWithHysteresis', () => {
  it('uses standard lookup when no current tier', () => {
    expect(lookupCertificationTierWithHysteresis(500, undefined)).toBe(
      CertificationTier.T3_MONITORED
    );
  });

  it('promotes immediately when score qualifies for higher tier', () => {
    const result = lookupCertificationTierWithHysteresis(
      800,
      CertificationTier.T4_STANDARD
    );
    expect(result).toBe(CertificationTier.T5_TRUSTED);
  });

  it('maintains current tier in grace zone (score above demotion threshold)', () => {
    // T5_TRUSTED min score = 800, hysteresis = 25, demotion threshold = 775
    const result = lookupCertificationTierWithHysteresis(
      780,
      CertificationTier.T5_TRUSTED
    );
    expect(result).toBe(CertificationTier.T5_TRUSTED);
  });

  it('demotes when score falls below grace zone', () => {
    // T5_TRUSTED min score = 800, hysteresis = 25, demotion threshold = 775
    const result = lookupCertificationTierWithHysteresis(
      770,
      CertificationTier.T5_TRUSTED
    );
    expect(result).toBe(CertificationTier.T4_STANDARD);
  });

  it('supports custom hysteresis values', () => {
    // T5_TRUSTED min score = 800, custom hysteresis = 50, demotion threshold = 750
    const result = lookupCertificationTierWithHysteresis(
      760,
      CertificationTier.T5_TRUSTED,
      50
    );
    expect(result).toBe(CertificationTier.T5_TRUSTED);
  });

  it('default hysteresis is 25', () => {
    expect(DEFAULT_DEMOTION_HYSTERESIS).toBe(25);
  });
});

describe('certificationTierToMinScore / certificationTierToMaxScore', () => {
  it('maps T0_SANDBOX to 0-199', () => {
    expect(certificationTierToMinScore(CertificationTier.T0_SANDBOX)).toBe(0);
    expect(certificationTierToMaxScore(CertificationTier.T0_SANDBOX)).toBe(199);
  });

  it('maps T7_AUTONOMOUS to 951-1000', () => {
    expect(certificationTierToMinScore(CertificationTier.T7_AUTONOMOUS)).toBe(951);
    expect(certificationTierToMaxScore(CertificationTier.T7_AUTONOMOUS)).toBe(1000);
  });

  it('tier ranges do not overlap', () => {
    // Filter to only numeric values (TypeScript numeric enums have reverse mappings)
    const tiers = Object.values(CertificationTier).filter(
      (v): v is CertificationTier => typeof v === 'number'
    );
    for (let i = 0; i < tiers.length - 1; i++) {
      const currentMax = certificationTierToMaxScore(tiers[i]!);
      const nextMin = certificationTierToMinScore(tiers[i + 1]!);
      expect(nextMin).toBeGreaterThan(currentMax);
    }
  });
});

describe('certificationTierToScore', () => {
  it('returns midpoint of tier range', () => {
    const score = certificationTierToScore(CertificationTier.T0_SANDBOX);
    expect(score).toBe(Math.floor((0 + 199) / 2));
  });

  it('returns midpoint for T7', () => {
    const score = certificationTierToScore(CertificationTier.T7_AUTONOMOUS);
    expect(score).toBe(Math.floor((951 + 1000) / 2));
  });
});

describe('createCARTrustContext', () => {
  it('creates context with required fields', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 750,
      capabilityLevel: CapabilityLevel.L4,
    });

    expect(ctx.car).toBe('car:test:v1');
    expect(ctx.trustScore).toBe(750);
    expect(ctx.capabilityLevel).toBe(CapabilityLevel.L4);
    expect(ctx.attestations).toEqual([]);
  });

  it('derives trustTier from score via scoreToTier', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 850,
      capabilityLevel: CapabilityLevel.L5,
    });

    expect(ctx.trustTier).toBeDefined();
  });
});

describe('determineCeilingReason', () => {
  it('returns trust score ceiling when no other ceilings set', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 500,
      capabilityLevel: CapabilityLevel.L7,
    });

    const { ceiling, reason } = determineCeilingReason(ctx);
    // trustScore 500 / 125 = 4
    expect(ceiling).toBe(4);
    expect(reason).toContain('Trust score');
  });

  it('returns most restrictive ceiling', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 900,
      capabilityLevel: CapabilityLevel.L7,
      observabilityCeiling: 3,
    });

    const { ceiling } = determineCeilingReason(ctx);
    expect(ceiling).toBe(3); // observability is more restrictive
  });

  it('considers context policy ceiling', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 900,
      capabilityLevel: CapabilityLevel.L7,
      contextPolicyCeiling: 2,
    });

    const { ceiling } = determineCeilingReason(ctx);
    expect(ceiling).toBe(2);
  });
});

describe('applyCARFloor', () => {
  it('raises score to attestation floor', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 100,
      capabilityLevel: CapabilityLevel.L3,
      attestations: [
        {
          scope: 'compliance',
          status: 'active',
          issuedAt: new Date(),
          issuedBy: 'test',
          expiresAt: new Date(Date.now() + 86400000),
        } as any,
      ],
    });

    const result = applyCARFloor(ctx, 100);
    expect(result).toBe(250); // compliance scope = 250 weight/score
  });

  it('does not lower score below floor', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 500,
      capabilityLevel: CapabilityLevel.L3,
      attestations: [
        {
          scope: 'domain',
          status: 'active',
          issuedAt: new Date(),
          issuedBy: 'test',
          expiresAt: new Date(Date.now() + 86400000),
        } as any,
      ],
    });

    const result = applyCARFloor(ctx, 500);
    expect(result).toBe(500); // domain floor = 100, score already higher
  });

  it('ignores inactive attestations', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 100,
      capabilityLevel: CapabilityLevel.L3,
      attestations: [
        {
          scope: 'compliance',
          status: 'revoked',
          issuedAt: new Date(),
          issuedBy: 'test',
        } as any,
      ],
    });

    const result = applyCARFloor(ctx, 100);
    expect(result).toBe(100); // revoked attestation gives 0 floor
  });
});

describe('enforceCARCeiling', () => {
  it('caps score at ceiling level', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 900,
      capabilityLevel: CapabilityLevel.L7,
      observabilityCeiling: 3,
    });

    const result = enforceCARCeiling(ctx, 900);
    // Ceiling 3 -> maxScore = (3+1)*125 - 1 = 499
    expect(result).toBe(499);
  });

  it('does not raise score', () => {
    const ctx = createCARTrustContext({
      car: 'car:test:v1',
      trustScore: 200,
      capabilityLevel: CapabilityLevel.L7,
    });

    const result = enforceCARCeiling(ctx, 200);
    expect(result).toBeLessThanOrEqual(1000);
    expect(result).toBe(200);
  });
});

describe('attestationToTrustSignal', () => {
  it('converts active attestation to signal', () => {
    const attestation = {
      scope: 'capability',
      status: 'active',
      issuedAt: new Date(),
      issuedBy: 'test-authority',
    } as any;

    const signal = attestationToTrustSignal(attestation);
    expect(signal.source).toBe('attestation:capability');
    expect(signal.weight).toBe(150 / 250);
    expect(signal.score).toBe(150);
  });

  it('gives zero score for non-active attestation', () => {
    const attestation = {
      scope: 'identity',
      status: 'expired',
      issuedAt: new Date(),
      issuedBy: 'test-authority',
    } as any;

    const signal = attestationToTrustSignal(attestation);
    expect(signal.score).toBe(0);
    expect(signal.weight).toBe(200 / 250);
  });
});
