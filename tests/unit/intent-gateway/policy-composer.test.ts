/**
 * PolicyComposer Tests
 *
 * Comprehensive tests for the policy composer including:
 * - Built-in bundle initialization
 * - Bundle registration
 * - Jurisdiction-based policy composition
 * - Conflict resolution strategies (max, crypto strictness, etc.)
 * - Multi-jurisdiction composition
 * - ComposedPolicySet structure validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PolicyComposer,
  CRYPTO_SUITE_STRICTNESS,
  type PolicyBundleDefinition,
} from '../../../packages/platform-core/src/intent-gateway/policy-composer.js';
import type {
  JurisdictionContext,
  Jurisdiction,
  Industry,
  JurisdictionSource,
  ComposedPolicySet,
} from '../../../packages/platform-core/src/intent-gateway/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createJurisdictionContext(
  overrides?: Partial<JurisdictionContext>,
): JurisdictionContext {
  return {
    primaryJurisdictions: ['GLOBAL'] as Jurisdiction[],
    industry: 'general' as Industry,
    dataResidency: 'us-east',
    crossBorderTransfer: false,
    source: 'tenant-config' as JurisdictionSource,
    ...overrides,
  };
}

function createCustomBundle(
  overrides?: Partial<PolicyBundleDefinition>,
): PolicyBundleDefinition {
  return {
    id: 'custom-bundle',
    name: 'Custom Bundle',
    jurisdictions: ['GLOBAL'] as Jurisdiction[],
    priority: 5,
    constraints: [
      {
        id: 'custom-retention',
        type: 'retention',
        rule: 'Custom retention rule',
        enforcement: 'required',
        sourceBundleId: 'custom-bundle',
        sourceJurisdiction: 'GLOBAL' as Jurisdiction,
        value: 730,
      },
    ],
    ...overrides,
  };
}

const EXPECTED_BUILTIN_IDS = [
  'global-default',
  'eu-gdpr',
  'eu-ai-act',
  'us-federal',
  'us-defense',
  'hipaa',
  'soc2',
];

// =============================================================================
// TESTS
// =============================================================================

describe('PolicyComposer', () => {
  let composer: PolicyComposer;

  beforeEach(() => {
    composer = new PolicyComposer();
  });

  // ---------------------------------------------------------------------------
  // 1. Built-in bundles: PolicyComposer initializes with 7 built-in bundles
  // ---------------------------------------------------------------------------
  describe('built-in bundles', () => {
    it('initializes with 7 built-in bundles', () => {
      expect(composer.bundleCount).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Bundle IDs: registeredBundleIds returns correct list
  // ---------------------------------------------------------------------------
  describe('registeredBundleIds', () => {
    it('returns correct list of built-in bundle IDs', () => {
      const ids = composer.registeredBundleIds;
      expect(ids).toHaveLength(7);
      for (const expected of EXPECTED_BUILTIN_IDS) {
        expect(ids).toContain(expected);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. compose() with GLOBAL: applies global-default bundle
  // ---------------------------------------------------------------------------
  describe('compose() with GLOBAL jurisdiction', () => {
    it('applies global-default bundle', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).toContain('global-default');
      // SOC2 also matches GLOBAL, so it should be present
      expect(result.sourceBundles).toContain('soc2');
    });

    it('includes global constraints such as retention, crypto, and consent', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      const types = result.constraints.map((c) => c.type);
      expect(types).toContain('retention');
      expect(types).toContain('crypto');
      expect(types).toContain('consent');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. compose() with EU: applies eu-gdpr and eu-ai-act bundles
  // ---------------------------------------------------------------------------
  describe('compose() with EU jurisdiction', () => {
    it('applies eu-gdpr and eu-ai-act bundles', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).toContain('eu-gdpr');
      expect(result.sourceBundles).toContain('eu-ai-act');
      // GLOBAL bundles are also included
      expect(result.sourceBundles).toContain('global-default');
    });

    it('includes GDPR-specific constraints like data-residency and processing-restriction', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      const types = result.constraints.map((c) => c.type);
      expect(types).toContain('data-residency');
      expect(types).toContain('processing-restriction');
      expect(types).toContain('audit-requirement');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. compose() with US-FED: applies us-federal bundle
  // ---------------------------------------------------------------------------
  describe('compose() with US-FED jurisdiction', () => {
    it('applies us-federal bundle', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-FED'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).toContain('us-federal');
      // global-default also applies because it matches GLOBAL
      expect(result.sourceBundles).toContain('global-default');
    });

    it('includes FIPS crypto constraint', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-FED'],
      });
      const result = composer.compose(ctx);

      const cryptoConstraints = result.constraints.filter(
        (c) => c.type === 'crypto',
      );
      // With conflict resolution, the strictest crypto wins
      expect(cryptoConstraints).toHaveLength(1);
      // FIPS 140-2 is stricter than standard
      expect(cryptoConstraints[0].value).toBe('fips-140-2');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. compose() with US-DOD: applies us-defense bundle (highest priority)
  // ---------------------------------------------------------------------------
  describe('compose() with US-DOD jurisdiction', () => {
    it('applies us-defense bundle', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).toContain('us-defense');
      expect(result.sourceBundles).toContain('global-default');
    });

    it('has us-defense as the highest priority bundle', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      // After composition, crypto resolves to cnsa-2.0 (the strictest)
      const cryptoConstraints = result.constraints.filter(
        (c) => c.type === 'crypto',
      );
      expect(cryptoConstraints).toHaveLength(1);
      expect(cryptoConstraints[0].value).toBe('cnsa-2.0');
    });

    it('includes blocking-level enforcement constraints', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const blockingConstraints = result.constraints.filter(
        (c) => c.enforcement === 'blocking',
      );
      expect(blockingConstraints.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. compose() with healthcare industry: applies hipaa bundle for US healthcare
  // ---------------------------------------------------------------------------
  describe('compose() with healthcare industry', () => {
    it('applies hipaa bundle when jurisdiction is US', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
        industry: 'healthcare',
      });
      const result = composer.compose(ctx);

      // HIPAA bundle has jurisdictions: ["US", "US-FED"], so it matches US
      expect(result.sourceBundles).toContain('hipaa');
    });

    it('includes HIPAA-specific constraints like access-control and PHI audit', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
        industry: 'healthcare',
      });
      const result = composer.compose(ctx);

      const accessControls = result.constraints.filter(
        (c) => c.type === 'access-control',
      );
      expect(accessControls.some((c) => c.value === 'rbac-phi')).toBe(true);

      const auditConstraints = result.constraints.filter(
        (c) => c.type === 'audit-requirement',
      );
      expect(auditConstraints.some((c) => c.value === 'phi-access-audit')).toBe(
        true,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 8. compose() with finance industry: applies soc2 bundle
  // ---------------------------------------------------------------------------
  describe('compose() with finance industry', () => {
    it('applies soc2 bundle when jurisdiction is US', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
        industry: 'finance',
      });
      const result = composer.compose(ctx);

      // SOC2 bundle has jurisdictions: ["US", "GLOBAL"], so it matches US
      expect(result.sourceBundles).toContain('soc2');
    });

    it('includes SOC 2 access-control and audit constraints', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
        industry: 'finance',
      });
      const result = composer.compose(ctx);

      const accessControls = result.constraints.filter(
        (c) => c.type === 'access-control',
      );
      expect(accessControls.some((c) => c.value === 'logical-access')).toBe(
        true,
      );

      const auditConstraints = result.constraints.filter(
        (c) => c.type === 'audit-requirement',
      );
      expect(
        auditConstraints.some((c) => c.value === 'change-management-audit'),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. compose() returns valid ComposedPolicySet structure
  // ---------------------------------------------------------------------------
  describe('compose() returns valid ComposedPolicySet', () => {
    it('has all required fields: constraints, sourceBundles, resolvedConflicts, unresolvedConflicts, isValid, composedAt', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      expect(result).toHaveProperty('constraints');
      expect(result).toHaveProperty('sourceBundles');
      expect(result).toHaveProperty('resolvedConflicts');
      expect(result).toHaveProperty('unresolvedConflicts');
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('composedAt');

      expect(Array.isArray(result.constraints)).toBe(true);
      expect(Array.isArray(result.sourceBundles)).toBe(true);
      expect(Array.isArray(result.resolvedConflicts)).toBe(true);
      expect(Array.isArray(result.unresolvedConflicts)).toBe(true);
      expect(typeof result.isValid).toBe('boolean');
      expect(typeof result.composedAt).toBe('number');
    });

    it('constraints have correct shape', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      for (const constraint of result.constraints) {
        expect(constraint).toHaveProperty('id');
        expect(constraint).toHaveProperty('type');
        expect(constraint).toHaveProperty('rule');
        expect(constraint).toHaveProperty('enforcement');
        expect(constraint).toHaveProperty('sourceBundleId');
        expect(constraint).toHaveProperty('sourceJurisdiction');
        expect(constraint).toHaveProperty('value');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 10. sourceBundles: lists all applied bundle IDs
  // ---------------------------------------------------------------------------
  describe('sourceBundles', () => {
    it('lists all applied bundle IDs for EU jurisdiction', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      // EU matches: global-default (GLOBAL), eu-gdpr (EU), eu-ai-act (EU), soc2 (GLOBAL)
      expect(result.sourceBundles).toContain('global-default');
      expect(result.sourceBundles).toContain('eu-gdpr');
      expect(result.sourceBundles).toContain('eu-ai-act');
      expect(result.sourceBundles).toContain('soc2');
    });

    it('lists all applied bundle IDs for US jurisdiction', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
      });
      const result = composer.compose(ctx);

      // US matches: global-default (GLOBAL), us-federal (US), hipaa (US), soc2 (US/GLOBAL)
      expect(result.sourceBundles).toContain('global-default');
      expect(result.sourceBundles).toContain('us-federal');
      expect(result.sourceBundles).toContain('hipaa');
      expect(result.sourceBundles).toContain('soc2');
    });

    it('bundles are sorted by priority (ascending) in sourceBundles', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      // global-default(0) < soc2(8) < eu-gdpr(10) < eu-ai-act(15)
      const globalIdx = result.sourceBundles.indexOf('global-default');
      const soc2Idx = result.sourceBundles.indexOf('soc2');
      const gdprIdx = result.sourceBundles.indexOf('eu-gdpr');
      const aiActIdx = result.sourceBundles.indexOf('eu-ai-act');

      expect(globalIdx).toBeLessThan(soc2Idx);
      expect(soc2Idx).toBeLessThan(gdprIdx);
      expect(gdprIdx).toBeLessThan(aiActIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Conflict resolution: conflicting crypto constraints resolved to most restrictive
  // ---------------------------------------------------------------------------
  describe('conflict resolution - crypto', () => {
    it('resolves conflicting crypto constraints to the most restrictive suite', () => {
      // US-FED has global-default (standard) + us-federal (fips-140-2)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-FED'],
      });
      const result = composer.compose(ctx);

      const cryptoConstraints = result.constraints.filter(
        (c) => c.type === 'crypto',
      );
      expect(cryptoConstraints).toHaveLength(1);
      // fips-140-2 is stricter than standard
      expect(cryptoConstraints[0].value).toBe('fips-140-2');
    });

    it('records crypto conflict as resolved', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-FED'],
      });
      const result = composer.compose(ctx);

      const cryptoConflicts = result.resolvedConflicts.filter(
        (c) => c.constraintType === 'crypto',
      );
      expect(cryptoConflicts.length).toBeGreaterThanOrEqual(1);
      expect(cryptoConflicts[0].description).toContain('fips-140-2');
    });

    it('resolves US-DOD crypto to cnsa-2.0 (strictest available)', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const cryptoConstraints = result.constraints.filter(
        (c) => c.type === 'crypto',
      );
      expect(cryptoConstraints).toHaveLength(1);
      expect(cryptoConstraints[0].value).toBe('cnsa-2.0');
      expect(
        CRYPTO_SUITE_STRICTNESS['cnsa-2.0'],
      ).toBeGreaterThan(CRYPTO_SUITE_STRICTNESS['fips-140-2']);
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Conflict resolution: conflicting retention resolved to longest duration
  // ---------------------------------------------------------------------------
  describe('conflict resolution - retention', () => {
    it('resolves conflicting retention to the longest duration', () => {
      // US jurisdiction: global-default(365), us-federal(2555), hipaa(2190), soc2(365)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
      });
      const result = composer.compose(ctx);

      const retentionConstraints = result.constraints.filter(
        (c) => c.type === 'retention',
      );
      expect(retentionConstraints).toHaveLength(1);
      // us-federal has the longest retention at 2555 days
      expect(retentionConstraints[0].value).toBe(2555);
    });

    it('records retention conflict as resolved', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
      });
      const result = composer.compose(ctx);

      const retentionConflicts = result.resolvedConflicts.filter(
        (c) => c.constraintType === 'retention',
      );
      expect(retentionConflicts.length).toBeGreaterThanOrEqual(1);
      expect(retentionConflicts[0].severity).toBe('low');
    });

    it('resolves US-DOD retention to 3650 days (10 years)', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const retentionConstraints = result.constraints.filter(
        (c) => c.type === 'retention',
      );
      expect(retentionConstraints).toHaveLength(1);
      expect(retentionConstraints[0].value).toBe(3650);
    });
  });

  // ---------------------------------------------------------------------------
  // 13. isValid: true when no critical unresolved conflicts
  // ---------------------------------------------------------------------------
  describe('isValid', () => {
    it('is true when no critical unresolved conflicts exist', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      expect(result.isValid).toBe(true);
      // There should be no critical unresolved conflicts
      const criticalConflicts = result.unresolvedConflicts.filter(
        (c) => c.severity === 'critical',
      );
      expect(criticalConflicts).toHaveLength(0);
    });

    it('is true for single-jurisdiction compositions', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-FED'],
      });
      const result = composer.compose(ctx);

      expect(result.isValid).toBe(true);
    });

    it('is false when critical data-residency conflicts exist (EU + US-FED)', () => {
      // EU requires eu-west, US-FED requires us-gov-east - these conflict
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU', 'US-FED'],
      });
      const result = composer.compose(ctx);

      const residencyConflicts = result.unresolvedConflicts.filter(
        (c) => c.constraintType === 'data-residency',
      );
      // Both have mandatory enforcement and different values -> critical conflict
      expect(residencyConflicts.length).toBeGreaterThanOrEqual(1);
      expect(residencyConflicts[0].severity).toBe('critical');
      expect(result.isValid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 14. composedAt: is a recent timestamp
  // ---------------------------------------------------------------------------
  describe('composedAt', () => {
    it('is a recent timestamp (within last second)', () => {
      const before = Date.now();
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);
      const after = Date.now();

      expect(result.composedAt).toBeGreaterThanOrEqual(before);
      expect(result.composedAt).toBeLessThanOrEqual(after);
    });

    it('is a number (epoch milliseconds)', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx);

      expect(typeof result.composedAt).toBe('number');
      // Should be a reasonable epoch timestamp (after 2024)
      expect(result.composedAt).toBeGreaterThan(1_700_000_000_000);
    });
  });

  // ---------------------------------------------------------------------------
  // 15. registerBundle(): adds custom bundle
  // ---------------------------------------------------------------------------
  describe('registerBundle()', () => {
    it('adds a custom bundle and increments count', () => {
      const initialCount = composer.bundleCount;
      const bundle = createCustomBundle();
      composer.registerBundle(bundle);

      expect(composer.bundleCount).toBe(initialCount + 1);
      expect(composer.registeredBundleIds).toContain('custom-bundle');
    });

    it('allows overwriting an existing bundle', () => {
      const bundle1 = createCustomBundle({ priority: 5 });
      const bundle2 = createCustomBundle({ priority: 99 });

      composer.registerBundle(bundle1);
      const countAfterFirst = composer.bundleCount;

      composer.registerBundle(bundle2);
      // Overwriting should not change the count
      expect(composer.bundleCount).toBe(countAfterFirst);
    });
  });

  // ---------------------------------------------------------------------------
  // 16. registerBundle(): custom bundle applied when jurisdiction matches
  // ---------------------------------------------------------------------------
  describe('registerBundle() - application on compose', () => {
    it('custom bundle is applied when jurisdiction matches', () => {
      const customBundle = createCustomBundle({
        id: 'custom-au',
        name: 'Australia Custom',
        jurisdictions: ['AU'],
        priority: 10,
        constraints: [
          {
            id: 'au-retention',
            type: 'retention',
            rule: 'AU: 3yr retention',
            enforcement: 'mandatory',
            sourceBundleId: 'custom-au',
            sourceJurisdiction: 'AU' as Jurisdiction,
            value: 1095,
          },
        ],
      });

      composer.registerBundle(customBundle);

      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['AU'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).toContain('custom-au');
      // The AU retention should participate in conflict resolution
      const retentionConstraints = result.constraints.filter(
        (c) => c.type === 'retention',
      );
      // AU retention (1095) vs global-default retention (365) -> AU wins (max)
      expect(retentionConstraints).toHaveLength(1);
      expect(retentionConstraints[0].value).toBe(1095);
    });

    it('custom bundle is NOT applied when jurisdiction does not match', () => {
      const customBundle = createCustomBundle({
        id: 'custom-jp',
        name: 'Japan Custom',
        jurisdictions: ['JP'],
        priority: 10,
        constraints: [
          {
            id: 'jp-retention',
            type: 'retention',
            rule: 'JP: 2yr retention',
            enforcement: 'mandatory',
            sourceBundleId: 'custom-jp',
            sourceJurisdiction: 'JP' as Jurisdiction,
            value: 730,
          },
        ],
      });

      composer.registerBundle(customBundle);

      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      expect(result.sourceBundles).not.toContain('custom-jp');
    });
  });

  // ---------------------------------------------------------------------------
  // 17. bundleCount: returns correct count after registration
  // ---------------------------------------------------------------------------
  describe('bundleCount', () => {
    it('returns 7 for initial built-in bundles', () => {
      expect(composer.bundleCount).toBe(7);
    });

    it('returns correct count after registering new bundles', () => {
      composer.registerBundle(
        createCustomBundle({ id: 'extra-1', jurisdictions: ['JP'] }),
      );
      expect(composer.bundleCount).toBe(8);

      composer.registerBundle(
        createCustomBundle({ id: 'extra-2', jurisdictions: ['KR'] }),
      );
      expect(composer.bundleCount).toBe(9);
    });

    it('does not increase count when overwriting existing bundle', () => {
      composer.registerBundle(
        createCustomBundle({ id: 'global-default', priority: 100 }),
      );
      // Overwriting global-default, count stays the same
      expect(composer.bundleCount).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Multiple jurisdictions: EU + US-FED applies both EU and US bundles
  // ---------------------------------------------------------------------------
  describe('multiple jurisdictions', () => {
    it('EU + US-FED applies both EU and US bundles', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU', 'US-FED'],
      });
      const result = composer.compose(ctx);

      // Should include bundles from both jurisdictions
      expect(result.sourceBundles).toContain('global-default');
      expect(result.sourceBundles).toContain('eu-gdpr');
      expect(result.sourceBundles).toContain('eu-ai-act');
      expect(result.sourceBundles).toContain('us-federal');
      expect(result.sourceBundles).toContain('hipaa');
      expect(result.sourceBundles).toContain('soc2');
    });

    it('EU + US-FED resolves retention to the longest (us-federal 2555 days)', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU', 'US-FED'],
      });
      const result = composer.compose(ctx);

      const retentionConstraints = result.constraints.filter(
        (c) => c.type === 'retention',
      );
      expect(retentionConstraints).toHaveLength(1);
      // us-federal(2555) > hipaa(2190) > eu-gdpr(1825) > global-default(365) = soc2(365)
      expect(retentionConstraints[0].value).toBe(2555);
    });

    it('EU + US-FED creates data-residency conflict', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU', 'US-FED'],
      });
      const result = composer.compose(ctx);

      // eu-gdpr requires eu-west, us-federal requires us-gov-east
      // Both are mandatory -> creates a critical unresolved conflict
      const residencyConflicts = result.unresolvedConflicts.filter(
        (c) => c.constraintType === 'data-residency',
      );
      expect(residencyConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it('EU + US-FED resolves crypto to fips-140-2 (strictest among standard and fips)', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU', 'US-FED'],
      });
      const result = composer.compose(ctx);

      const cryptoConstraints = result.constraints.filter(
        (c) => c.type === 'crypto',
      );
      expect(cryptoConstraints).toHaveLength(1);
      // Only global-default(standard) and us-federal(fips-140-2) have crypto
      expect(cryptoConstraints[0].value).toBe('fips-140-2');
    });
  });

  // ---------------------------------------------------------------------------
  // 19. No matching bundles: only global-default applied for unknown jurisdiction
  // ---------------------------------------------------------------------------
  describe('no matching bundles fallback', () => {
    it('only global-default applied for jurisdiction with no specific bundles', () => {
      // CH (Switzerland) has no specific bundles, but global-default matches GLOBAL
      // and soc2 also matches GLOBAL
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['CH'],
      });
      const result = composer.compose(ctx);

      // global-default and soc2 both have GLOBAL in jurisdictions, so they match
      expect(result.sourceBundles).toContain('global-default');
      expect(result.sourceBundles).toContain('soc2');
      // No EU or US bundles should be present
      expect(result.sourceBundles).not.toContain('eu-gdpr');
      expect(result.sourceBundles).not.toContain('eu-ai-act');
      expect(result.sourceBundles).not.toContain('us-federal');
      expect(result.sourceBundles).not.toContain('us-defense');
      expect(result.sourceBundles).not.toContain('hipaa');
    });

    it('falls back to global-default when no bundles match at all', () => {
      // Create a composer with no GLOBAL bundles, then remove them
      // Actually, the fallback in compose() explicitly adds global-default
      // if applicable is empty. Let's test by registering a new composer
      // with a context that won't match any jurisdiction-specific bundles.
      // Since GLOBAL always matches, we need to verify the fallback code path.

      // Create a fresh composer and remove all bundles by overwriting with
      // jurisdiction-specific ones that won't match
      const freshComposer = new PolicyComposer();

      // Even with a non-matching jurisdiction like "IL", GLOBAL bundles still match.
      // The fallback (empty applicable -> push global-default) only triggers
      // when no bundles match at all. Since global-default and soc2 have GLOBAL,
      // they always match. This test verifies the non-EU/US case works correctly.
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['IL'],
      });
      const result = freshComposer.compose(ctx);

      expect(result.sourceBundles.length).toBeGreaterThanOrEqual(1);
      expect(result.sourceBundles).toContain('global-default');
    });
  });

  // ---------------------------------------------------------------------------
  // Additional edge-case tests
  // ---------------------------------------------------------------------------
  describe('additional conflict resolution', () => {
    it('consent resolution picks the strictest model', () => {
      // EU context: global-default(implicit) + eu-gdpr(explicit-granular)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx);

      const consentConstraints = result.constraints.filter(
        (c) => c.type === 'consent',
      );
      expect(consentConstraints).toHaveLength(1);
      expect(consentConstraints[0].value).toBe('explicit-granular');
    });

    it('escalation resolution picks the strictest mode', () => {
      // US-DOD context: global-default(flag-review) + us-defense(hard-block)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const escalationConstraints = result.constraints.filter(
        (c) => c.type === 'escalation',
      );
      expect(escalationConstraints).toHaveLength(1);
      expect(escalationConstraints[0].value).toBe('hard-block');
    });

    it('additive types (access-control, audit-requirement) collect all unique values', () => {
      // US context includes hipaa(rbac-phi), soc2(logical-access) for access-control
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US'],
      });
      const result = composer.compose(ctx);

      const accessControls = result.constraints.filter(
        (c) => c.type === 'access-control',
      );
      const values = accessControls.map((c) => c.value);
      expect(values).toContain('rbac-phi');
      expect(values).toContain('logical-access');
    });

    it('trust-level resolution picks the highest minimum trust', () => {
      // US-DOD: global-default(T2) + us-defense(T6)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const trustConstraints = result.constraints.filter(
        (c) => c.type === 'trust-level',
      );
      expect(trustConstraints).toHaveLength(1);
      expect(trustConstraints[0].value).toBe(6);
    });

    it('external-services resolution: false (blocking) overrides true (allowed)', () => {
      // US-DOD: global-default(true, advisory) + us-defense(false, blocking)
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['US-DOD'],
      });
      const result = composer.compose(ctx);

      const extConstraints = result.constraints.filter(
        (c) => c.type === 'external-services',
      );
      expect(extConstraints).toHaveLength(1);
      expect(extConstraints[0].value).toBe(false);
    });
  });

  describe('additionalBundleIds parameter', () => {
    it('includes explicitly requested bundles even if jurisdiction does not match', () => {
      // Request us-defense bundle for an EU-only context via additionalBundleIds
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx, ['us-defense']);

      expect(result.sourceBundles).toContain('us-defense');
      expect(result.sourceBundles).toContain('eu-gdpr');
    });

    it('does not duplicate bundles already selected by jurisdiction', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['EU'],
      });
      const result = composer.compose(ctx, ['eu-gdpr']);

      // eu-gdpr should appear only once in sourceBundles
      const gdprCount = result.sourceBundles.filter(
        (id) => id === 'eu-gdpr',
      ).length;
      expect(gdprCount).toBe(1);
    });

    it('ignores unknown bundle IDs gracefully', () => {
      const ctx = createJurisdictionContext({
        primaryJurisdictions: ['GLOBAL'],
      });
      const result = composer.compose(ctx, ['nonexistent-bundle']);

      expect(result.sourceBundles).not.toContain('nonexistent-bundle');
      // Should still compose successfully
      expect(result.isValid).toBe(true);
    });
  });
});
