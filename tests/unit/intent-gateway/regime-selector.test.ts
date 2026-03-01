import { describe, it, expect } from 'vitest';

import {
  resolveCryptoSuite,
  resolveProofAnchoring,
  resolveConsentModel,
  resolveEscalationMode,
  resolveAuditRetentionDays,
  resolveExternalServicesAllowed,
  resolveMinimumTrustLevel,
  generateRegimeId,
  hasJurisdiction,
  extractPolicyConstraintValue,
  RegimeSelector,
} from '../../../packages/platform-core/src/intent-gateway/regime-selector.js';

import type {
  JurisdictionContext,
  ComposedPolicySet,
  Jurisdiction,
  Industry,
  PolicyConstraint,
  PolicyConstraintType,
  EnforcementLevel,
} from '../../../packages/platform-core/src/intent-gateway/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJurisdictionContext(
  overrides: Partial<JurisdictionContext> = {},
): JurisdictionContext {
  return {
    primaryJurisdictions: ['GLOBAL'],
    industry: 'general',
    dataResidency: 'us-east-1',
    crossBorderTransfer: false,
    source: 'tenant-config',
    ...overrides,
  };
}

function makeComposedPolicySet(
  overrides: Partial<ComposedPolicySet> = {},
): ComposedPolicySet {
  return {
    constraints: [],
    sourceBundles: ['default-bundle'],
    resolvedConflicts: [],
    unresolvedConflicts: [],
    isValid: true,
    composedAt: Date.now(),
    ...overrides,
  };
}

function makeConstraint(
  type: PolicyConstraintType,
  value: unknown,
  overrides: Partial<PolicyConstraint> = {},
): PolicyConstraint {
  return {
    id: `constraint-${type}`,
    type,
    rule: `${type}-rule`,
    enforcement: 'required' as EnforcementLevel,
    sourceBundleId: 'test-bundle',
    sourceJurisdiction: 'GLOBAL' as Jurisdiction,
    value,
    ...overrides,
  };
}

function ctxFor(...jurisdictions: Jurisdiction[]): JurisdictionContext {
  return makeJurisdictionContext({ primaryJurisdictions: jurisdictions });
}

const emptyPS = makeComposedPolicySet();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('regime-selector', () => {
  // =========================================================================
  // resolveCryptoSuite
  // =========================================================================
  describe('resolveCryptoSuite', () => {
    it('returns cnsa-2.0 for US-DOD', () => {
      expect(resolveCryptoSuite(ctxFor('US-DOD'), emptyPS)).toBe('cnsa-2.0');
    });

    it('returns fips-140-2 for US-FED', () => {
      expect(resolveCryptoSuite(ctxFor('US-FED'), emptyPS)).toBe('fips-140-2');
    });

    it('returns sm-national for CN', () => {
      expect(resolveCryptoSuite(ctxFor('CN'), emptyPS)).toBe('sm-national');
    });

    it('returns standard for default (GLOBAL)', () => {
      expect(resolveCryptoSuite(ctxFor('GLOBAL'), emptyPS)).toBe('standard');
    });
  });

  // =========================================================================
  // resolveProofAnchoring
  // =========================================================================
  describe('resolveProofAnchoring', () => {
    it('returns hardware-hsm for US-DOD', () => {
      expect(resolveProofAnchoring(ctxFor('US-DOD'), emptyPS)).toBe(
        'hardware-hsm',
      );
    });

    it('returns tsa-rfc3161 for US-FED', () => {
      expect(resolveProofAnchoring(ctxFor('US-FED'), emptyPS)).toBe(
        'tsa-rfc3161',
      );
    });

    it('returns merkle-tree for EU', () => {
      expect(resolveProofAnchoring(ctxFor('EU'), emptyPS)).toBe('merkle-tree');
    });

    it('returns database for default (GLOBAL)', () => {
      expect(resolveProofAnchoring(ctxFor('GLOBAL'), emptyPS)).toBe('database');
    });
  });

  // =========================================================================
  // resolveConsentModel
  // =========================================================================
  describe('resolveConsentModel', () => {
    it('returns explicit-granular for EU', () => {
      expect(resolveConsentModel(ctxFor('EU'), emptyPS)).toBe(
        'explicit-granular',
      );
    });

    it('returns opt-in for CA', () => {
      expect(resolveConsentModel(ctxFor('CA'), emptyPS)).toBe('opt-in');
    });

    it('returns opt-out for US', () => {
      expect(resolveConsentModel(ctxFor('US'), emptyPS)).toBe('opt-out');
    });

    it('returns implicit for default (GLOBAL)', () => {
      expect(resolveConsentModel(ctxFor('GLOBAL'), emptyPS)).toBe('implicit');
    });
  });

  // =========================================================================
  // resolveEscalationMode
  // =========================================================================
  describe('resolveEscalationMode', () => {
    it('returns hard-block for US-DOD', () => {
      expect(resolveEscalationMode(ctxFor('US-DOD'), emptyPS)).toBe(
        'hard-block',
      );
    });

    it('returns block-escalate for US-FED', () => {
      expect(resolveEscalationMode(ctxFor('US-FED'), emptyPS)).toBe(
        'block-escalate',
      );
    });

    it('returns block-escalate for EU', () => {
      expect(resolveEscalationMode(ctxFor('EU'), emptyPS)).toBe(
        'block-escalate',
      );
    });

    it('returns flag-review for default (GLOBAL)', () => {
      expect(resolveEscalationMode(ctxFor('GLOBAL'), emptyPS)).toBe(
        'flag-review',
      );
    });
  });

  // =========================================================================
  // resolveAuditRetentionDays
  // =========================================================================
  describe('resolveAuditRetentionDays', () => {
    it('returns 1825 for EU', () => {
      expect(resolveAuditRetentionDays(ctxFor('EU'), emptyPS)).toBe(1825);
    });

    it('returns 2555 for US-FED', () => {
      expect(resolveAuditRetentionDays(ctxFor('US-FED'), emptyPS)).toBe(2555);
    });

    it('returns 3650 for US-DOD', () => {
      expect(resolveAuditRetentionDays(ctxFor('US-DOD'), emptyPS)).toBe(3650);
    });

    it('returns 365 for default (GLOBAL)', () => {
      expect(resolveAuditRetentionDays(ctxFor('GLOBAL'), emptyPS)).toBe(365);
    });
  });

  // =========================================================================
  // resolveExternalServicesAllowed
  // =========================================================================
  describe('resolveExternalServicesAllowed', () => {
    it('returns false for US-DOD', () => {
      expect(resolveExternalServicesAllowed(ctxFor('US-DOD'), emptyPS)).toBe(
        false,
      );
    });

    it('returns false for CN', () => {
      expect(resolveExternalServicesAllowed(ctxFor('CN'), emptyPS)).toBe(false);
    });

    it('returns true for default (GLOBAL)', () => {
      expect(resolveExternalServicesAllowed(ctxFor('GLOBAL'), emptyPS)).toBe(
        true,
      );
    });
  });

  // =========================================================================
  // resolveMinimumTrustLevel
  // =========================================================================
  describe('resolveMinimumTrustLevel', () => {
    it('returns 6 for US-DOD', () => {
      expect(resolveMinimumTrustLevel(ctxFor('US-DOD'), emptyPS)).toBe(6);
    });

    it('returns 4 for US-FED', () => {
      expect(resolveMinimumTrustLevel(ctxFor('US-FED'), emptyPS)).toBe(4);
    });

    it('returns 3 for EU', () => {
      expect(resolveMinimumTrustLevel(ctxFor('EU'), emptyPS)).toBe(3);
    });

    it('returns 2 for default (GLOBAL)', () => {
      expect(resolveMinimumTrustLevel(ctxFor('GLOBAL'), emptyPS)).toBe(2);
    });
  });

  // =========================================================================
  // generateRegimeId
  // =========================================================================
  describe('generateRegimeId', () => {
    const baseParams = {
      jurisdictions: ['EU'] as Jurisdiction[],
      cryptoSuite: 'standard' as const,
      proofAnchoring: 'database' as const,
      consentModel: 'implicit' as const,
      escalationMode: 'flag-review' as const,
      auditRetentionDays: 365,
      dataResidency: 'eu-west-1',
      externalServicesAllowed: true,
      minimumTrustLevel: 2 as const,
    };

    it('is deterministic - same inputs produce the same ID', () => {
      const id1 = generateRegimeId(baseParams);
      const id2 = generateRegimeId(baseParams);
      expect(id1).toBe(id2);
    });

    it('different inputs produce different IDs', () => {
      const id1 = generateRegimeId(baseParams);
      const id2 = generateRegimeId({
        ...baseParams,
        jurisdictions: ['US-DOD'] as Jurisdiction[],
      });
      expect(id1).not.toBe(id2);
    });

    it('starts with "regime-"', () => {
      const id = generateRegimeId(baseParams);
      expect(id).toMatch(/^regime-/);
    });
  });

  // =========================================================================
  // RegimeSelector.select()
  // =========================================================================
  describe('RegimeSelector.select()', () => {
    const selector = new RegimeSelector();

    it('assembles all dimensions correctly for EU jurisdiction', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['EU'],
        dataResidency: 'eu-west-1',
      });
      const ps = makeComposedPolicySet({ sourceBundles: ['eu-bundle'] });

      const regime = selector.select(ctx, ps);

      expect(regime.cryptoSuite).toBe('standard');
      expect(regime.proofAnchoring).toBe('merkle-tree');
      expect(regime.consentModel).toBe('explicit-granular');
      expect(regime.escalationMode).toBe('block-escalate');
      expect(regime.auditRetentionDays).toBe(1825);
      expect(regime.externalServicesAllowed).toBe(true);
      expect(regime.minimumTrustLevel).toBe(3);
      expect(regime.dataResidency).toBe('eu-west-1');
      expect(regime.jurisdictions).toEqual(['EU']);
      expect(regime.policyNamespaces).toEqual(['eu-bundle']);
    });

    it('assembles correctly for US-DOD (most restrictive)', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
        dataResidency: 'us-gov-west-1',
      });
      const ps = makeComposedPolicySet({ sourceBundles: ['dod-bundle'] });

      const regime = selector.select(ctx, ps);

      expect(regime.cryptoSuite).toBe('cnsa-2.0');
      expect(regime.proofAnchoring).toBe('hardware-hsm');
      expect(regime.consentModel).toBe('implicit');
      expect(regime.escalationMode).toBe('hard-block');
      expect(regime.auditRetentionDays).toBe(3650);
      expect(regime.externalServicesAllowed).toBe(false);
      expect(regime.minimumTrustLevel).toBe(6);
      expect(regime.fedrampImpactLevel).toBe('high');
    });

    it('generates correct name for single jurisdiction', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['EU'],
        industry: 'general',
      });
      const regime = selector.select(ctx, emptyPS);
      expect(regime.name).toBe('EU');
    });

    it('generates correct name for multi-jurisdiction', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['EU', 'US'],
        industry: 'general',
      });
      const regime = selector.select(ctx, emptyPS);
      expect(regime.name).toBe('Multi(EU+US)');
    });

    it('includes industry in name when not "general"', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['EU'],
        industry: 'healthcare',
      });
      const regime = selector.select(ctx, emptyPS);
      expect(regime.name).toBe('EU-healthcare');
    });

    it('includes industry in name for multi-jurisdiction when not "general"', () => {
      const ctx = makeJurisdictionContext({
        primaryJurisdictions: ['EU', 'US'],
        industry: 'finance',
      });
      const regime = selector.select(ctx, emptyPS);
      expect(regime.name).toBe('Multi(EU+US)-finance');
    });

    it('conformityAssessmentRequired is true for EU', () => {
      const ctx = ctxFor('EU');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.conformityAssessmentRequired).toBe(true);
    });

    it('conformityAssessmentRequired is false for non-EU', () => {
      const ctx = ctxFor('US');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.conformityAssessmentRequired).toBe(false);
    });

    it('transparencyRequired is true for EU', () => {
      const ctx = ctxFor('EU');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.transparencyRequired).toBe(true);
    });

    it('transparencyRequired is true for CA', () => {
      const ctx = ctxFor('CA');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.transparencyRequired).toBe(true);
    });

    it('transparencyRequired is true for UK', () => {
      const ctx = ctxFor('UK');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.transparencyRequired).toBe(true);
    });

    it('transparencyRequired is false for US', () => {
      const ctx = ctxFor('US');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.transparencyRequired).toBe(false);
    });

    it('fedrampImpactLevel is "high" for US-DOD', () => {
      const ctx = ctxFor('US-DOD');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.fedrampImpactLevel).toBe('high');
    });

    it('fedrampImpactLevel is "moderate" for US-FED', () => {
      const ctx = ctxFor('US-FED');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.fedrampImpactLevel).toBe('moderate');
    });

    it('fedrampImpactLevel is undefined for non-federal jurisdictions', () => {
      const ctx = ctxFor('EU');
      const regime = selector.select(ctx, emptyPS);
      expect(regime.fedrampImpactLevel).toBeUndefined();
    });
  });

  // =========================================================================
  // Policy constraint overrides
  // =========================================================================
  describe('policy constraint overrides', () => {
    it('policy constraint value overrides default when stricter (crypto)', () => {
      const ctx = ctxFor('GLOBAL');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('crypto', 'fips-140-2')],
      });
      expect(resolveCryptoSuite(ctx, ps)).toBe('fips-140-2');
    });

    it('policy constraint value overrides default when stricter (consent)', () => {
      const ctx = ctxFor('GLOBAL');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('consent', 'opt-in')],
      });
      expect(resolveConsentModel(ctx, ps)).toBe('opt-in');
    });

    it('policy constraint does not downgrade when less strict', () => {
      const ctx = ctxFor('US-DOD');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('crypto', 'standard')],
      });
      // US-DOD pushes cnsa-2.0 (strictness 4), standard is 0 -> cnsa-2.0 wins
      expect(resolveCryptoSuite(ctx, ps)).toBe('cnsa-2.0');
    });

    it('policy constraint overrides retention when larger', () => {
      const ctx = ctxFor('GLOBAL');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('retention', 730)],
      });
      expect(resolveAuditRetentionDays(ctx, ps)).toBe(730);
    });

    it('policy constraint does not downgrade retention', () => {
      const ctx = ctxFor('EU');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('retention', 100)],
      });
      // EU default is 1825, constraint is 100 -> 1825 wins
      expect(resolveAuditRetentionDays(ctx, ps)).toBe(1825);
    });

    it('policy constraint overrides trust level when higher', () => {
      const ctx = ctxFor('GLOBAL');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('trust-level', 5)],
      });
      expect(resolveMinimumTrustLevel(ctx, ps)).toBe(5);
    });

    it('policy constraint for external-services can disable services', () => {
      const ctx = ctxFor('GLOBAL');
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('external-services', false)],
      });
      expect(resolveExternalServicesAllowed(ctx, ps)).toBe(false);
    });
  });

  // =========================================================================
  // hasJurisdiction helper
  // =========================================================================
  describe('hasJurisdiction', () => {
    it('returns true when jurisdiction is present', () => {
      const ctx = ctxFor('EU', 'US');
      expect(hasJurisdiction(ctx, 'EU')).toBe(true);
    });

    it('returns true when any of multiple queried jurisdictions is present', () => {
      const ctx = ctxFor('EU');
      expect(hasJurisdiction(ctx, 'US', 'EU')).toBe(true);
    });

    it('returns false when jurisdiction is not present', () => {
      const ctx = ctxFor('US');
      expect(hasJurisdiction(ctx, 'EU')).toBe(false);
    });

    it('returns false when none of the queried jurisdictions is present', () => {
      const ctx = ctxFor('GLOBAL');
      expect(hasJurisdiction(ctx, 'EU', 'US', 'CN')).toBe(false);
    });
  });

  // =========================================================================
  // extractPolicyConstraintValue
  // =========================================================================
  describe('extractPolicyConstraintValue', () => {
    it('extracts value from constraint by type', () => {
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('retention', 999)],
      });
      expect(extractPolicyConstraintValue<number>(ps, 'retention')).toBe(999);
    });

    it('returns undefined when constraint type is not present', () => {
      expect(extractPolicyConstraintValue(emptyPS, 'retention')).toBeUndefined();
    });

    it('returns the first matching constraint value', () => {
      const ps = makeComposedPolicySet({
        constraints: [
          makeConstraint('retention', 100),
          makeConstraint('retention', 200),
        ],
      });
      expect(extractPolicyConstraintValue<number>(ps, 'retention')).toBe(100);
    });

    it('extracts string values', () => {
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('crypto', 'fips-140-2')],
      });
      expect(extractPolicyConstraintValue<string>(ps, 'crypto')).toBe(
        'fips-140-2',
      );
    });

    it('extracts boolean values', () => {
      const ps = makeComposedPolicySet({
        constraints: [makeConstraint('external-services', false)],
      });
      expect(
        extractPolicyConstraintValue<boolean>(ps, 'external-services'),
      ).toBe(false);
    });
  });
});
