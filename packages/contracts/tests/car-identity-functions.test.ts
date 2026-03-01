/**
 * Functional tests for CAR identity, supervision, and effective permission functions.
 *
 * Covers: isSupervisionActive, calculateSupervisedTier, validateSupervisionElevation,
 * createAgentIdentity, toAgentIdentitySummary, matchesAgentCriteria,
 * capabilityVectorSatisfies, type guards, and supervision-aware permission calculation.
 */

import { describe, it, expect } from 'vitest';
import {
  isSupervisionActive,
  calculateSupervisedTier,
  validateSupervisionElevation,
  createAgentIdentity,
  toAgentIdentitySummary,
  matchesAgentCriteria,
  capabilityVectorSatisfies,
  isCapabilityVector,
  isAgentIdentity,
  isAgentIdentitySummary,
  MAX_SUPERVISION_ELEVATION,
  type SupervisionContext,
  type AgentIdentity,
  type CapabilityVector,
  type AgentRegistrationOptions,
  type AgentMatchCriteria,
} from '../src/car/identity';
import { CapabilityLevel } from '../src/car/levels';
import { CertificationTier, RuntimeTier } from '../src/car/tiers';
import { parseCAR } from '../src/car/car-string';
import { calculateEffectivePermission } from '../src/car/effective-permission';
import type { Attestation } from '../src/car/attestation';
import type { DomainCode } from '../src/car/domains';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSupervision(overrides?: Partial<SupervisionContext>): SupervisionContext {
  const now = new Date();
  return {
    supervisorCAR: 'a3i.vorion.supervisor:ABCDEF-L7@1.0.0',
    supervisorDID: 'did:web:supervisor.vorion.org',
    supervisorTier: CertificationTier.T5_TRUSTED,
    elevationTiers: 2,
    grantedAt: new Date(now.getTime() - 60000),
    expiresAt: new Date(now.getTime() + 3600000),
    heartbeatIntervalMs: 30000,
    lastHeartbeat: new Date(now.getTime() - 5000),
    ...overrides,
  };
}

function createTestAttestation(overrides?: Partial<Attestation>): Attestation {
  const now = new Date();
  return {
    id: 'urn:uuid:test-attestation',
    issuer: 'did:web:certifier.example.com',
    subject: 'did:web:agent.acme.com',
    scope: 'full',
    certificationTier: CertificationTier.T3_MONITORED,
    issuedAt: new Date(now.getTime() - 86400000),
    expiresAt: new Date(now.getTime() + 86400000 * 365),
    status: 'active',
    ...overrides,
  };
}

function createTestIdentity(overrides?: Partial<AgentIdentity>): AgentIdentity {
  const now = new Date();
  return {
    car: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
    carId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
    did: 'did:web:agent.acme.com',
    capabilities: {
      domains: ['A', 'B', 'F'] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
    },
    attestations: [createTestAttestation()],
    created: now,
    updated: now,
    active: true,
    ...overrides,
  };
}

// ============================================================================
// isSupervisionActive
// ============================================================================

describe('isSupervisionActive', () => {
  it('returns true for active supervision with valid heartbeat', () => {
    const ctx = createTestSupervision();
    expect(isSupervisionActive(ctx)).toBe(true);
  });

  it('returns false when supervision has expired', () => {
    const ctx = createTestSupervision({
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(isSupervisionActive(ctx)).toBe(false);
  });

  it('returns false when grantedAt is in the future', () => {
    const ctx = createTestSupervision({
      grantedAt: new Date(Date.now() + 60000),
    });
    expect(isSupervisionActive(ctx)).toBe(false);
  });

  it('returns false when heartbeat deadline missed', () => {
    const ctx = createTestSupervision({
      heartbeatIntervalMs: 5000,
      lastHeartbeat: new Date(Date.now() - 60000), // 60s ago, deadline was 5s
    });
    expect(isSupervisionActive(ctx)).toBe(false);
  });

  it('returns true when no heartbeat required (heartbeatIntervalMs=0)', () => {
    const ctx = createTestSupervision({
      heartbeatIntervalMs: 0,
      lastHeartbeat: undefined,
    });
    expect(isSupervisionActive(ctx)).toBe(true);
  });

  it('returns true when heartbeat required but no lastHeartbeat set yet', () => {
    const ctx = createTestSupervision({
      heartbeatIntervalMs: 30000,
      lastHeartbeat: undefined,
    });
    expect(isSupervisionActive(ctx)).toBe(true);
  });
});

// ============================================================================
// calculateSupervisedTier
// ============================================================================

describe('calculateSupervisedTier', () => {
  it('elevates base tier by requested amount under active supervision', () => {
    const supervision = createTestSupervision({
      supervisorTier: CertificationTier.T5_TRUSTED,
      elevationTiers: 2,
    });
    // base T2 + 2 = T4, cap = T5-1 = T4 → T4
    const result = calculateSupervisedTier(CertificationTier.T2_PROVISIONAL, supervision);
    expect(result).toBe(CertificationTier.T4_STANDARD);
  });

  it('caps elevation at supervisorTier - 1', () => {
    const supervision = createTestSupervision({
      supervisorTier: CertificationTier.T4_STANDARD,
      elevationTiers: 2,
    });
    // base T3 + 2 = T5, but cap = T4-1 = T3 → stays T3
    const result = calculateSupervisedTier(CertificationTier.T3_MONITORED, supervision);
    expect(result).toBe(CertificationTier.T3_MONITORED);
  });

  it('caps elevation at MAX_SUPERVISION_ELEVATION', () => {
    const supervision = createTestSupervision({
      supervisorTier: CertificationTier.T7_AUTONOMOUS,
      elevationTiers: 5, // exceeds MAX_SUPERVISION_ELEVATION (2)
    });
    // base T3 + min(5,2) = T5, cap = T7-1 = T6 → T5
    const result = calculateSupervisedTier(CertificationTier.T3_MONITORED, supervision);
    expect(result).toBe(CertificationTier.T5_TRUSTED);
  });

  it('returns baseTier when supervision is inactive (expired)', () => {
    const supervision = createTestSupervision({
      expiresAt: new Date(Date.now() - 1000),
      supervisorTier: CertificationTier.T7_AUTONOMOUS,
      elevationTiers: 2,
    });
    const result = calculateSupervisedTier(CertificationTier.T2_PROVISIONAL, supervision);
    expect(result).toBe(CertificationTier.T2_PROVISIONAL);
  });

  it('never lowers below baseTier', () => {
    const supervision = createTestSupervision({
      supervisorTier: CertificationTier.T2_PROVISIONAL, // supervisor lower than expected
      elevationTiers: 0,
    });
    // This shouldn't happen in practice (validator prevents it),
    // but the function should still be safe
    const result = calculateSupervisedTier(CertificationTier.T3_MONITORED, supervision);
    expect(result).toBeGreaterThanOrEqual(CertificationTier.T3_MONITORED);
  });

  it('T7 supervisor elevates to at most T6', () => {
    const supervision = createTestSupervision({
      supervisorTier: CertificationTier.T7_AUTONOMOUS,
      elevationTiers: 2,
    });
    // base T5 + 2 = T7, cap = T7-1 = T6 → T6
    const result = calculateSupervisedTier(CertificationTier.T5_TRUSTED, supervision);
    expect(result).toBe(CertificationTier.T6_CERTIFIED);
  });
});

// ============================================================================
// validateSupervisionElevation
// ============================================================================

describe('validateSupervisionElevation', () => {
  it('validates correct elevation request', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T5_TRUSTED,
      CertificationTier.T2_PROVISIONAL,
      2
    );
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe(CertificationTier.T4_STANDARD);
  });

  it('rejects negative elevation', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T5_TRUSTED,
      CertificationTier.T2_PROVISIONAL,
      -1
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('-1');
  });

  it('rejects elevation exceeding MAX_SUPERVISION_ELEVATION', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T5_TRUSTED,
      CertificationTier.T2_PROVISIONAL,
      3
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`0-${MAX_SUPERVISION_ELEVATION}`);
  });

  it('rejects when supervisor tier equals subject tier', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T3_MONITORED,
      CertificationTier.T3_MONITORED,
      1
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('must be higher');
  });

  it('rejects when supervisor tier is lower than subject tier', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T2_PROVISIONAL,
      CertificationTier.T4_STANDARD,
      1
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('must be higher');
  });

  it('caps effective tier at supervisorTier - 1', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T4_STANDARD,
      CertificationTier.T2_PROVISIONAL,
      2
    );
    expect(result.valid).toBe(true);
    // T2 + 2 = T4, cap = T4-1 = T3 → T3
    expect(result.effectiveTier).toBe(CertificationTier.T3_MONITORED);
  });

  it('handles zero elevation', () => {
    const result = validateSupervisionElevation(
      CertificationTier.T5_TRUSTED,
      CertificationTier.T2_PROVISIONAL,
      0
    );
    expect(result.valid).toBe(true);
    expect(result.effectiveTier).toBe(CertificationTier.T2_PROVISIONAL);
  });
});

// ============================================================================
// createAgentIdentity
// ============================================================================

describe('createAgentIdentity', () => {
  const baseOptions: AgentRegistrationOptions = {
    car: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
    did: 'did:web:agent.acme.com',
  };

  it('creates identity with parsedCAR capabilities', () => {
    const parsed = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');
    const identity = createAgentIdentity(baseOptions, parsed);

    expect(identity.capabilities.domains).toEqual(parsed.domains);
    expect(identity.capabilities.domainsBitmask).toBe(parsed.domainsBitmask);
    expect(identity.capabilities.level).toBe(CapabilityLevel.L3_EXECUTE);
  });

  it('creates identity with defaults when no parsedCAR', () => {
    const identity = createAgentIdentity(baseOptions);

    expect(identity.capabilities.domains).toEqual([]);
    expect(identity.capabilities.level).toBe(CapabilityLevel.L0_OBSERVE);
  });

  it('sets timestamps and active flag', () => {
    const before = new Date();
    const identity = createAgentIdentity(baseOptions);
    const after = new Date();

    expect(identity.created.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(identity.created.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(identity.updated.getTime()).toEqual(identity.created.getTime());
    expect(identity.active).toBe(true);
  });

  it('copies attestations from options', () => {
    const attestation = createTestAttestation();
    const identity = createAgentIdentity({ ...baseOptions, attestations: [attestation] });
    expect(identity.attestations).toHaveLength(1);
    expect(identity.attestations[0]).toBe(attestation);
  });

  it('defaults to empty attestations', () => {
    const identity = createAgentIdentity(baseOptions);
    expect(identity.attestations).toEqual([]);
  });

  it('sets backwards-compat fields', () => {
    const parsed = parseCAR(baseOptions.car);
    const identity = createAgentIdentity(baseOptions, parsed);

    expect(identity.carId).toBe(baseOptions.car);
    expect(identity.parsedCarId).toBe(parsed);
  });
});

// ============================================================================
// toAgentIdentitySummary
// ============================================================================

describe('toAgentIdentitySummary', () => {
  it('extracts correct fields', () => {
    const identity = createTestIdentity();
    const summary = toAgentIdentitySummary(identity);

    expect(summary.car).toBe(identity.car);
    expect(summary.did).toBe(identity.did);
    expect(summary.domains).toBe(identity.capabilities.domains);
    expect(summary.level).toBe(identity.capabilities.level);
    expect(summary.active).toBe(identity.active);
  });

  it('computes certificationTier from highest valid attestation', () => {
    const identity = createTestIdentity({
      attestations: [
        createTestAttestation({ certificationTier: CertificationTier.T2_PROVISIONAL }),
        createTestAttestation({ certificationTier: CertificationTier.T4_STANDARD }),
        createTestAttestation({ certificationTier: CertificationTier.T3_MONITORED }),
      ],
    });
    const summary = toAgentIdentitySummary(identity);
    expect(summary.certificationTier).toBe(CertificationTier.T4_STANDARD);
  });

  it('returns undefined certificationTier when no valid attestations', () => {
    const identity = createTestIdentity({ attestations: [] });
    const summary = toAgentIdentitySummary(identity);
    expect(summary.certificationTier).toBeUndefined();
  });

  it('ignores expired attestations', () => {
    const identity = createTestIdentity({
      attestations: [
        createTestAttestation({
          certificationTier: CertificationTier.T5_TRUSTED,
          expiresAt: new Date(Date.now() - 1000),
        }),
        createTestAttestation({ certificationTier: CertificationTier.T2_PROVISIONAL }),
      ],
    });
    const summary = toAgentIdentitySummary(identity);
    expect(summary.certificationTier).toBe(CertificationTier.T2_PROVISIONAL);
  });

  it('uses metadata.description as name', () => {
    const identity = createTestIdentity({
      metadata: { description: 'Invoice Processing Bot' },
    });
    const summary = toAgentIdentitySummary(identity);
    expect(summary.name).toBe('Invoice Processing Bot');
  });

  it('returns undefined name when no metadata', () => {
    const identity = createTestIdentity({ metadata: undefined });
    const summary = toAgentIdentitySummary(identity);
    expect(summary.name).toBeUndefined();
  });
});

// ============================================================================
// matchesAgentCriteria
// ============================================================================

describe('matchesAgentCriteria', () => {
  it('matches with empty criteria', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {})).toBe(true);
  });

  it('rejects inactive agent when mustBeActive=true', () => {
    const identity = createTestIdentity({ active: false });
    expect(matchesAgentCriteria(identity, { mustBeActive: true })).toBe(false);
  });

  it('matches when agent has all required domains', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {
      requiredDomains: ['A', 'B'] as DomainCode[],
    })).toBe(true);
  });

  it('rejects when agent missing required domain', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {
      requiredDomains: ['A', 'S'] as DomainCode[],
    })).toBe(false);
  });

  it('matches when agent meets minimum level', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {
      minLevel: CapabilityLevel.L3_EXECUTE,
    })).toBe(true);
  });

  it('rejects when agent below minimum level', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {
      minLevel: CapabilityLevel.L5_TRUSTED,
    })).toBe(false);
  });

  it('matches minimum certification tier from active attestations', () => {
    const identity = createTestIdentity({
      attestations: [createTestAttestation({ certificationTier: CertificationTier.T4_STANDARD })],
    });
    expect(matchesAgentCriteria(identity, {
      minCertificationTier: CertificationTier.T3_MONITORED,
    })).toBe(true);
  });

  it('rejects when attestation tier too low', () => {
    const identity = createTestIdentity({
      attestations: [createTestAttestation({ certificationTier: CertificationTier.T1_OBSERVED })],
    });
    expect(matchesAgentCriteria(identity, {
      minCertificationTier: CertificationTier.T3_MONITORED,
    })).toBe(false);
  });

  it('rejects when no attestations and minCertificationTier required', () => {
    const identity = createTestIdentity({ attestations: [] });
    expect(matchesAgentCriteria(identity, {
      minCertificationTier: CertificationTier.T1_OBSERVED,
    })).toBe(false);
  });

  it('passes runtime tier check when runtimeTier undefined', () => {
    const identity = createTestIdentity({ runtimeTier: undefined });
    expect(matchesAgentCriteria(identity, {
      minRuntimeTier: RuntimeTier.T3_MONITORED,
    })).toBe(true);
  });

  it('rejects when runtime tier too low', () => {
    const identity = createTestIdentity({ runtimeTier: RuntimeTier.T1_OBSERVED });
    expect(matchesAgentCriteria(identity, {
      minRuntimeTier: RuntimeTier.T3_MONITORED,
    })).toBe(false);
  });

  it('rejects when missing required skill', () => {
    const identity = createTestIdentity();
    expect(matchesAgentCriteria(identity, {
      requiredSkills: ['nlp' as any],
    })).toBe(false);
  });

  it('rejects when mustHaveValidAttestations but none valid', () => {
    const identity = createTestIdentity({
      attestations: [createTestAttestation({
        status: 'revoked',
      })],
    });
    expect(matchesAgentCriteria(identity, {
      mustHaveValidAttestations: true,
    })).toBe(false);
  });

  it('filters by organization from parsedCAR', () => {
    const identity = createTestIdentity({
      parsedCAR: parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'),
    });
    expect(matchesAgentCriteria(identity, { organization: 'acme-corp' })).toBe(true);
    expect(matchesAgentCriteria(identity, { organization: 'other-org' })).toBe(false);
  });

  it('filters by registry from parsedCAR', () => {
    const identity = createTestIdentity({
      parsedCAR: parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'),
    });
    expect(matchesAgentCriteria(identity, { registry: 'a3i' })).toBe(true);
    expect(matchesAgentCriteria(identity, { registry: 'other' })).toBe(false);
  });

  it('applies multiple criteria with AND logic', () => {
    const identity = createTestIdentity({
      parsedCAR: parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'),
    });
    const criteria: AgentMatchCriteria = {
      mustBeActive: true,
      requiredDomains: ['A'] as DomainCode[],
      minLevel: CapabilityLevel.L3_EXECUTE,
      organization: 'acme-corp',
    };
    expect(matchesAgentCriteria(identity, criteria)).toBe(true);

    // Fail one criterion
    expect(matchesAgentCriteria(identity, {
      ...criteria,
      minLevel: CapabilityLevel.L7_AUTONOMOUS,
    })).toBe(false);
  });
});

// ============================================================================
// capabilityVectorSatisfies
// ============================================================================

describe('capabilityVectorSatisfies', () => {
  it('returns true when A has all of B domains and level >= B', () => {
    const a: CapabilityVector = { domains: ['A', 'B', 'F'] as DomainCode[], level: CapabilityLevel.L5_TRUSTED };
    const b: CapabilityVector = { domains: ['A', 'B'] as DomainCode[], level: CapabilityLevel.L3_EXECUTE };
    expect(capabilityVectorSatisfies(a, b)).toBe(true);
  });

  it('returns false when A missing a domain from B', () => {
    const a: CapabilityVector = { domains: ['A', 'B'] as DomainCode[], level: CapabilityLevel.L5_TRUSTED };
    const b: CapabilityVector = { domains: ['A', 'S'] as DomainCode[], level: CapabilityLevel.L3_EXECUTE };
    expect(capabilityVectorSatisfies(a, b)).toBe(false);
  });

  it('returns false when A level < B level', () => {
    const a: CapabilityVector = { domains: ['A', 'B'] as DomainCode[], level: CapabilityLevel.L2_DRAFT };
    const b: CapabilityVector = { domains: ['A'] as DomainCode[], level: CapabilityLevel.L3_EXECUTE };
    expect(capabilityVectorSatisfies(a, b)).toBe(false);
  });

  it('returns true when B has skills and A has them all', () => {
    const a: CapabilityVector = {
      domains: ['A'] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      skills: ['nlp', 'cv'] as any[],
    };
    const b: CapabilityVector = {
      domains: ['A'] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      skills: ['nlp'] as any[],
    };
    expect(capabilityVectorSatisfies(a, b)).toBe(true);
  });

  it('returns false when B has skills and A missing one', () => {
    const a: CapabilityVector = {
      domains: ['A'] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      skills: ['nlp'] as any[],
    };
    const b: CapabilityVector = {
      domains: ['A'] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      skills: ['nlp', 'cv'] as any[],
    };
    expect(capabilityVectorSatisfies(a, b)).toBe(false);
  });

  it('passes when B has no skills requirement', () => {
    const a: CapabilityVector = { domains: ['A'] as DomainCode[], level: CapabilityLevel.L3_EXECUTE };
    const b: CapabilityVector = { domains: ['A'] as DomainCode[], level: CapabilityLevel.L3_EXECUTE };
    expect(capabilityVectorSatisfies(a, b)).toBe(true);
  });
});

// ============================================================================
// Type Guards
// ============================================================================

describe('isCapabilityVector', () => {
  it('returns true for valid CapabilityVector', () => {
    expect(isCapabilityVector({ domains: ['A'], level: 3 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isCapabilityVector(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isCapabilityVector('not a vector')).toBe(false);
  });

  it('returns false for missing domains', () => {
    expect(isCapabilityVector({ level: 3 })).toBe(false);
  });

  it('returns false for missing level', () => {
    expect(isCapabilityVector({ domains: ['A'] })).toBe(false);
  });
});

describe('isAgentIdentity', () => {
  it('returns true for valid AgentIdentity', () => {
    expect(isAgentIdentity({
      car: 'test',
      did: 'did:web:test',
      capabilities: { domains: [], level: 0 },
      attestations: [],
    })).toBe(true);
  });

  it('returns true with carId (backwards compat)', () => {
    expect(isAgentIdentity({
      carId: 'test',
      did: 'did:web:test',
      capabilities: { domains: [], level: 0 },
      attestations: [],
    })).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect(isAgentIdentity({ did: 'test' })).toBe(false);
    expect(isAgentIdentity(null)).toBe(false);
    expect(isAgentIdentity(42)).toBe(false);
  });
});

describe('isAgentIdentitySummary', () => {
  it('returns true for valid summary', () => {
    expect(isAgentIdentitySummary({
      car: 'test',
      did: 'did:web:test',
      domains: ['A'],
      level: 3,
    })).toBe(true);
  });

  it('returns true with carId (backwards compat)', () => {
    expect(isAgentIdentitySummary({
      carId: 'test',
      did: 'did:web:test',
      domains: ['A'],
      level: 3,
    })).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect(isAgentIdentitySummary({ car: 'test', did: 'test' })).toBe(false);
    expect(isAgentIdentitySummary(null)).toBe(false);
  });
});

// ============================================================================
// Effective Permission with Supervision
// ============================================================================

describe('calculateEffectivePermission with supervision', () => {
  it('boosts certification ceiling when supervision active', () => {
    const result = calculateEffectivePermission({
      certificationTier: CertificationTier.T2_PROVISIONAL,
      competenceLevel: CapabilityLevel.L7_AUTONOMOUS,
      runtimeTier: RuntimeTier.T7_AUTONOMOUS,
      observabilityCeiling: 7,
      contextPolicyCeiling: 7,
      supervisionElevation: {
        supervisorTier: CertificationTier.T5_TRUSTED,
        grantedElevation: 2,
      },
    });
    // Without supervision: T2 → maxCapLevel=3 (L3), so effective = L3
    // With supervision: T2+2=T4, cap=T5-1=T4 → maxCapLevel=5 (L5)
    // Other ceilings are all 7, so effective should be L5
    expect(result.level).toBe(CapabilityLevel.L5_TRUSTED);
  });

  it('supervision capped at supervisorTier - 1', () => {
    const result = calculateEffectivePermission({
      certificationTier: CertificationTier.T3_MONITORED,
      competenceLevel: CapabilityLevel.L7_AUTONOMOUS,
      runtimeTier: RuntimeTier.T7_AUTONOMOUS,
      observabilityCeiling: 7,
      contextPolicyCeiling: 7,
      supervisionElevation: {
        supervisorTier: CertificationTier.T4_STANDARD,
        grantedElevation: 2,
      },
    });
    // T3+2=T5, cap=T4-1=T3 → stays T3, maxCapLevel=4 (L4)
    expect(result.level).toBe(CapabilityLevel.L4_AUTONOMOUS);
  });

  it('supervision cannot lower base certification tier', () => {
    const result = calculateEffectivePermission({
      certificationTier: CertificationTier.T4_STANDARD,
      competenceLevel: CapabilityLevel.L7_AUTONOMOUS,
      runtimeTier: RuntimeTier.T7_AUTONOMOUS,
      observabilityCeiling: 7,
      contextPolicyCeiling: 7,
      supervisionElevation: {
        supervisorTier: CertificationTier.T3_MONITORED, // lower than base
        grantedElevation: 0,
      },
    });
    // base T4 maxCapLevel=5, supervision doesn't lower it
    expect(result.level).toBeGreaterThanOrEqual(CapabilityLevel.L5_TRUSTED);
  });

  it('works normally without supervision', () => {
    const result = calculateEffectivePermission({
      certificationTier: CertificationTier.T3_MONITORED,
      competenceLevel: CapabilityLevel.L4_AUTONOMOUS,
      runtimeTier: RuntimeTier.T3_MONITORED,
      observabilityCeiling: 4,
      contextPolicyCeiling: 3,
    });
    // T3 maxCapLevel=4, competence=4, runtime=3, obs=4, policy=3
    // MIN = 3
    expect(result.level).toBe(CapabilityLevel.L3_EXECUTE);
    expect(result.constrained).toBe(true);
  });

  it('picks correct minimum even with supervision boost', () => {
    const result = calculateEffectivePermission({
      certificationTier: CertificationTier.T2_PROVISIONAL,
      competenceLevel: CapabilityLevel.L7_AUTONOMOUS,
      runtimeTier: RuntimeTier.T2_PROVISIONAL,
      observabilityCeiling: 7,
      contextPolicyCeiling: 7,
      supervisionElevation: {
        supervisorTier: CertificationTier.T7_AUTONOMOUS,
        grantedElevation: 2,
      },
    });
    // Certification: T2+2=T4, cap=T6 → T4 → maxCapLevel=5
    // Runtime: T2 → ceiling=2
    // Runtime is the bottleneck at 2
    expect(result.level).toBe(CapabilityLevel.L2_DRAFT);
    expect(result.constrainingFactor).toBe('runtime_tier');
  });
});
