import { describe, it, expect } from 'vitest';
import {
  ObservabilityClass,
  OBSERVABILITY_CEILINGS,
  OBSERVABILITY_CLASS_NAMES,
  getObservabilityCeiling,
  getObservabilityMaxScore,
  applyObservabilityCeiling,
  isTierAllowedForObservability,
  getRequiredObservabilityForTier,
  determineObservabilityClass,
  describeObservabilityConstraints,
  ObservabilityClassSchema,
} from '../src/trust-engine/observability.js';

describe('ObservabilityClass enum', () => {
  it('defines five observability classes with correct numeric values', () => {
    expect(ObservabilityClass.BLACK_BOX).toBe(0);
    expect(ObservabilityClass.GRAY_BOX).toBe(1);
    expect(ObservabilityClass.WHITE_BOX).toBe(2);
    expect(ObservabilityClass.ATTESTED_BOX).toBe(3);
    expect(ObservabilityClass.VERIFIED_BOX).toBe(4);
  });
});

describe('getObservabilityCeiling', () => {
  it('returns T2 for BLACK_BOX', () => {
    expect(getObservabilityCeiling(ObservabilityClass.BLACK_BOX)).toBe(2);
  });

  it('returns T4 for GRAY_BOX', () => {
    expect(getObservabilityCeiling(ObservabilityClass.GRAY_BOX)).toBe(4);
  });

  it('returns T5 for WHITE_BOX', () => {
    expect(getObservabilityCeiling(ObservabilityClass.WHITE_BOX)).toBe(5);
  });

  it('returns T6 for ATTESTED_BOX', () => {
    expect(getObservabilityCeiling(ObservabilityClass.ATTESTED_BOX)).toBe(6);
  });

  it('returns T7 for VERIFIED_BOX', () => {
    expect(getObservabilityCeiling(ObservabilityClass.VERIFIED_BOX)).toBe(7);
  });
});

describe('getObservabilityMaxScore', () => {
  it('returns 499 for BLACK_BOX', () => {
    expect(getObservabilityMaxScore(ObservabilityClass.BLACK_BOX)).toBe(499);
  });

  it('returns 799 for GRAY_BOX', () => {
    expect(getObservabilityMaxScore(ObservabilityClass.GRAY_BOX)).toBe(799);
  });

  it('returns 1000 for VERIFIED_BOX', () => {
    expect(getObservabilityMaxScore(ObservabilityClass.VERIFIED_BOX)).toBe(1000);
  });
});

describe('applyObservabilityCeiling', () => {
  it('caps score at BLACK_BOX ceiling (50%)', () => {
    const result = applyObservabilityCeiling(700 as any, ObservabilityClass.BLACK_BOX);
    expect(result).toBe(500); // 50% of 1000
  });

  it('caps score at GRAY_BOX ceiling (80%)', () => {
    const result = applyObservabilityCeiling(900 as any, ObservabilityClass.GRAY_BOX);
    expect(result).toBe(800); // 80% of 1000
  });

  it('does not cap score below ceiling', () => {
    const result = applyObservabilityCeiling(300 as any, ObservabilityClass.GRAY_BOX);
    expect(result).toBe(300);
  });

  it('does not cap VERIFIED_BOX (100%)', () => {
    const result = applyObservabilityCeiling(1000 as any, ObservabilityClass.VERIFIED_BOX);
    expect(result).toBe(1000);
  });
});

describe('isTierAllowedForObservability', () => {
  it('allows T0-T2 for BLACK_BOX', () => {
    expect(isTierAllowedForObservability(0, ObservabilityClass.BLACK_BOX)).toBe(true);
    expect(isTierAllowedForObservability(1, ObservabilityClass.BLACK_BOX)).toBe(true);
    expect(isTierAllowedForObservability(2, ObservabilityClass.BLACK_BOX)).toBe(true);
  });

  it('disallows T3+ for BLACK_BOX', () => {
    expect(isTierAllowedForObservability(3, ObservabilityClass.BLACK_BOX)).toBe(false);
    expect(isTierAllowedForObservability(7, ObservabilityClass.BLACK_BOX)).toBe(false);
  });

  it('allows all tiers for VERIFIED_BOX', () => {
    for (let tier = 0; tier <= 7; tier++) {
      expect(isTierAllowedForObservability(tier as any, ObservabilityClass.VERIFIED_BOX)).toBe(true);
    }
  });
});

describe('getRequiredObservabilityForTier', () => {
  it('requires BLACK_BOX for T0-T2', () => {
    expect(getRequiredObservabilityForTier(0)).toBe(ObservabilityClass.BLACK_BOX);
    expect(getRequiredObservabilityForTier(1)).toBe(ObservabilityClass.BLACK_BOX);
    expect(getRequiredObservabilityForTier(2)).toBe(ObservabilityClass.BLACK_BOX);
  });

  it('requires GRAY_BOX for T3-T4', () => {
    expect(getRequiredObservabilityForTier(3)).toBe(ObservabilityClass.GRAY_BOX);
    expect(getRequiredObservabilityForTier(4)).toBe(ObservabilityClass.GRAY_BOX);
  });

  it('requires WHITE_BOX for T5', () => {
    expect(getRequiredObservabilityForTier(5)).toBe(ObservabilityClass.WHITE_BOX);
  });

  it('requires ATTESTED_BOX for T6', () => {
    expect(getRequiredObservabilityForTier(6)).toBe(ObservabilityClass.ATTESTED_BOX);
  });

  it('requires VERIFIED_BOX for T7', () => {
    expect(getRequiredObservabilityForTier(7)).toBe(ObservabilityClass.VERIFIED_BOX);
  });
});

describe('determineObservabilityClass', () => {
  it('returns BLACK_BOX with no metadata', () => {
    expect(determineObservabilityClass({})).toBe(ObservabilityClass.BLACK_BOX);
  });

  it('returns explicit class when set', () => {
    expect(
      determineObservabilityClass({ class: ObservabilityClass.WHITE_BOX })
    ).toBe(ObservabilityClass.WHITE_BOX);
  });

  it('infers VERIFIED_BOX from verificationProof', () => {
    expect(
      determineObservabilityClass({ verificationProof: 'proof-hash-123' })
    ).toBe(ObservabilityClass.VERIFIED_BOX);
  });

  it('infers ATTESTED_BOX from attestationProvider', () => {
    expect(
      determineObservabilityClass({ attestationProvider: 'aws-nitro' })
    ).toBe(ObservabilityClass.ATTESTED_BOX);
  });

  it('infers WHITE_BOX from sourceCodeUrl', () => {
    expect(
      determineObservabilityClass({ sourceCodeUrl: 'https://github.com/org/repo' })
    ).toBe(ObservabilityClass.WHITE_BOX);
  });

  it('infers GRAY_BOX from lastAuditDate', () => {
    expect(
      determineObservabilityClass({ lastAuditDate: new Date() })
    ).toBe(ObservabilityClass.GRAY_BOX);
  });

  it('priority: explicit > verificationProof > attestation > source > audit', () => {
    // Explicit wins over everything
    expect(
      determineObservabilityClass({
        class: ObservabilityClass.BLACK_BOX,
        verificationProof: 'proof',
        attestationProvider: 'provider',
        sourceCodeUrl: 'https://example.com',
        lastAuditDate: new Date(),
      })
    ).toBe(ObservabilityClass.BLACK_BOX);
  });
});

describe('describeObservabilityConstraints', () => {
  it('includes class name and tier information', () => {
    const desc = describeObservabilityConstraints(ObservabilityClass.GRAY_BOX);
    expect(desc).toContain('Gray Box');
    expect(desc).toContain('T4');
    expect(desc).toContain('80%');
  });
});

describe('ObservabilityClassSchema', () => {
  it('validates correct numeric values', () => {
    expect(ObservabilityClassSchema.safeParse(0).success).toBe(true);
    expect(ObservabilityClassSchema.safeParse(4).success).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(ObservabilityClassSchema.safeParse(5).success).toBe(false);
    expect(ObservabilityClassSchema.safeParse(-1).success).toBe(false);
    expect(ObservabilityClassSchema.safeParse('invalid').success).toBe(false);
  });
});
