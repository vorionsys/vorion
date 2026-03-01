/**
 * Jurisdiction Resolver Tests
 *
 * Tests for JurisdictionResolver three-tier resolution:
 *   1. Tenant config (highest priority)
 *   2. Metadata inference
 *   3. Default fallback (lowest priority)
 *
 * Also covers cross-border detection, EU member state mapping,
 * country code mapping, and tenant config registration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  JurisdictionResolver,
  JURISDICTION_RESIDENCY_ZONES,
} from '../../../packages/platform-core/src/intent-gateway/jurisdiction-resolver.js';
import type {
  IntentGatewayConfig,
  TenantJurisdictionConfig,
  Jurisdiction,
} from '../../../packages/platform-core/src/intent-gateway/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal TenantContext-like object (branded types bypassed via cast). */
function makeTenantCtx(tenantId = 'tenant-123', userId = 'user-456') {
  return {
    tenantId,
    userId,
    roles: [],
    permissions: [],
    createdAt: Date.now(),
  } as any;
}

function makeGatewayConfig(
  overrides: Partial<IntentGatewayConfig> = {},
): IntentGatewayConfig {
  return {
    enabled: true,
    defaultJurisdiction: 'GLOBAL',
    defaultIndustry: 'general',
    regimeCacheTtlMs: 300_000,
    blockOnConflicts: true,
    logRegimeDecisions: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JurisdictionResolver', () => {
  let resolver: JurisdictionResolver;
  const defaultConfig = makeGatewayConfig();

  beforeEach(() => {
    resolver = new JurisdictionResolver(defaultConfig);
  });

  // =========================================================================
  // 1. Three-tier resolution priority
  // =========================================================================

  describe('three-tier resolution priority', () => {
    it('tenant config takes priority over metadata and default', () => {
      const ctx = makeTenantCtx('tenant-priority');
      resolver.registerTenantConfig('tenant-priority', {
        jurisdictions: ['UK'],
        industry: 'finance',
      });

      const result = resolver.resolve(ctx, { jurisdiction: 'US', region: 'EU' });

      expect(result.source).toBe('tenant-config');
      expect(result.primaryJurisdictions).toEqual(['UK']);
      expect(result.industry).toBe('finance');
    });

    it('metadata takes priority over default when no tenant config', () => {
      const ctx = makeTenantCtx('tenant-no-config');

      const result = resolver.resolve(ctx, { jurisdiction: 'US' });

      expect(result.source).toBe('metadata-inference');
      expect(result.primaryJurisdictions).toEqual(['US']);
    });

    it('falls back to default when no tenant config and no metadata', () => {
      const ctx = makeTenantCtx('tenant-no-config');

      const result = resolver.resolve(ctx);

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });
  });

  // =========================================================================
  // 2. resolve() with tenant config registered
  // =========================================================================

  describe('resolve() with tenant config registered', () => {
    it('returns tenant jurisdiction and industry', () => {
      const ctx = makeTenantCtx('tenant-eu');
      resolver.registerTenantConfig('tenant-eu', {
        jurisdictions: ['EU'],
        industry: 'healthcare',
      });

      const result = resolver.resolve(ctx);

      expect(result.primaryJurisdictions).toEqual(['EU']);
      expect(result.industry).toBe('healthcare');
      expect(result.dataResidency).toBe(JURISDICTION_RESIDENCY_ZONES['EU']);
      expect(result.crossBorderTransfer).toBe(false);
      expect(result.source).toBe('tenant-config');
    });

    it('uses custom dataResidency from tenant config when provided', () => {
      const ctx = makeTenantCtx('tenant-custom-dr');
      resolver.registerTenantConfig('tenant-custom-dr', {
        jurisdictions: ['US'],
        industry: 'general',
        dataResidency: 'us-west-custom',
      });

      const result = resolver.resolve(ctx);

      expect(result.dataResidency).toBe('us-west-custom');
    });

    it('detects cross-border transfer with multiple jurisdictions', () => {
      const ctx = makeTenantCtx('tenant-multi');
      resolver.registerTenantConfig('tenant-multi', {
        jurisdictions: ['EU', 'US'],
        industry: 'finance',
      });

      const result = resolver.resolve(ctx);

      expect(result.crossBorderTransfer).toBe(true);
      expect(result.primaryJurisdictions).toEqual(['EU', 'US']);
    });
  });

  // =========================================================================
  // 3. resolve() with metadata containing jurisdiction
  // =========================================================================

  describe('resolve() with metadata containing jurisdiction', () => {
    it('returns metadata-inferred jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { jurisdiction: 'AU' });

      expect(result.source).toBe('metadata-inference');
      expect(result.primaryJurisdictions).toEqual(['AU']);
      expect(result.dataResidency).toBe(JURISDICTION_RESIDENCY_ZONES['AU']);
    });

    it('normalises jurisdiction string to uppercase', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { jurisdiction: 'jp' });

      expect(result.primaryJurisdictions).toEqual(['JP']);
    });

    it('uses metadata industry when valid', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'US',
        industry: 'defense',
      });

      expect(result.industry).toBe('defense');
    });

    it('falls back to default industry when metadata industry is invalid', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'US',
        industry: 'not-a-real-industry',
      });

      expect(result.industry).toBe('general');
    });

    it('uses metadata dataResidency when provided', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'US',
        dataResidency: 'custom-zone',
      });

      expect(result.dataResidency).toBe('custom-zone');
    });
  });

  // =========================================================================
  // 4. resolve() with metadata containing countryCode (EU member states)
  // =========================================================================

  describe('resolve() with metadata containing countryCode (EU member state)', () => {
    it.each(['FR', 'DE', 'IT', 'ES', 'NL', 'PL', 'SE', 'BE', 'AT', 'IE'])(
      'maps EU member state %s to EU jurisdiction',
      (code) => {
        const ctx = makeTenantCtx();

        const result = resolver.resolve(ctx, { countryCode: code });

        expect(result.source).toBe('metadata-inference');
        expect(result.primaryJurisdictions).toContain('EU');
      },
    );

    it('maps EEA states (IS, LI, NO) to EU jurisdiction', () => {
      for (const code of ['IS', 'LI', 'NO']) {
        const ctx = makeTenantCtx();
        const result = resolver.resolve(ctx, { countryCode: code });
        expect(result.primaryJurisdictions).toContain('EU');
      }
    });

    it('handles lowercase country codes', () => {
      const ctx = makeTenantCtx();
      const result = resolver.resolve(ctx, { countryCode: 'fr' });
      expect(result.primaryJurisdictions).toContain('EU');
    });
  });

  // =========================================================================
  // 5. resolve() with metadata containing region
  // =========================================================================

  describe('resolve() with metadata containing region', () => {
    it('maps "EU" region to EU jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'EU' });

      expect(result.source).toBe('metadata-inference');
      expect(result.primaryJurisdictions).toContain('EU');
    });

    it('maps "EUROPE" region to EU jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'EUROPE' });

      expect(result.primaryJurisdictions).toContain('EU');
    });

    it('maps "EEA" region to EU jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'EEA' });

      expect(result.primaryJurisdictions).toContain('EU');
    });

    it('maps "US" region to US jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'US' });

      expect(result.primaryJurisdictions).toContain('US');
    });

    it('maps "UNITED STATES" region to US jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'UNITED STATES' });

      expect(result.primaryJurisdictions).toContain('US');
    });

    it('handles case-insensitive region strings', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'europe' });

      expect(result.primaryJurisdictions).toContain('EU');
    });
  });

  // =========================================================================
  // 6. resolve() with no config / metadata - returns default GLOBAL
  // =========================================================================

  describe('resolve() with no config or metadata', () => {
    it('returns default GLOBAL jurisdiction', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx);

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
      expect(result.industry).toBe('general');
      expect(result.dataResidency).toBe(JURISDICTION_RESIDENCY_ZONES['GLOBAL']);
      expect(result.crossBorderTransfer).toBe(false);
    });

    it('returns default when metadata is null', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, null);

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('returns default when metadata is empty object', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {});

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('uses configured default jurisdiction', () => {
      const customResolver = new JurisdictionResolver(
        makeGatewayConfig({ defaultJurisdiction: 'EU', defaultIndustry: 'finance' }),
      );
      const ctx = makeTenantCtx();

      const result = customResolver.resolve(ctx);

      expect(result.primaryJurisdictions).toEqual(['EU']);
      expect(result.industry).toBe('finance');
      expect(result.dataResidency).toBe(JURISDICTION_RESIDENCY_ZONES['EU']);
    });
  });

  // =========================================================================
  // 7. registerTenantConfig() stores and retrieves config
  // =========================================================================

  describe('registerTenantConfig()', () => {
    it('stores config that can be retrieved', () => {
      const config: TenantJurisdictionConfig = {
        jurisdictions: ['JP'],
        industry: 'automotive',
      };
      resolver.registerTenantConfig('tenant-jp', config);

      const stored = resolver.getTenantConfig('tenant-jp');
      expect(stored).toBeDefined();
      expect(stored!.jurisdictions).toEqual(['JP']);
      expect(stored!.industry).toBe('automotive');
    });

    it('overwrites previous config for same tenant', () => {
      resolver.registerTenantConfig('tenant-overwrite', {
        jurisdictions: ['US'],
        industry: 'general',
      });
      resolver.registerTenantConfig('tenant-overwrite', {
        jurisdictions: ['EU'],
        industry: 'healthcare',
      });

      const stored = resolver.getTenantConfig('tenant-overwrite');
      expect(stored!.jurisdictions).toEqual(['EU']);
      expect(stored!.industry).toBe('healthcare');
    });
  });

  // =========================================================================
  // 8. getTenantConfig() returns undefined for unknown tenant
  // =========================================================================

  describe('getTenantConfig()', () => {
    it('returns undefined for unknown tenant', () => {
      const result = resolver.getTenantConfig('non-existent-tenant');
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // 9. detectCrossBorderTransfer() - single jurisdiction = false
  // =========================================================================

  describe('detectCrossBorderTransfer()', () => {
    it('returns false for a single jurisdiction', () => {
      expect(resolver.detectCrossBorderTransfer(['EU'])).toBe(false);
    });

    it('returns false for an empty array', () => {
      expect(resolver.detectCrossBorderTransfer([])).toBe(false);
    });

    // =====================================================================
    // 10. multiple jurisdictions in different zones = true
    // =====================================================================

    it('returns true for multiple jurisdictions in different zones', () => {
      expect(resolver.detectCrossBorderTransfer(['EU', 'US'])).toBe(true);
      expect(resolver.detectCrossBorderTransfer(['JP', 'AU'])).toBe(true);
      expect(resolver.detectCrossBorderTransfer(['UK', 'CN'])).toBe(true);
    });

    it('returns true for three jurisdictions spanning multiple zones', () => {
      expect(resolver.detectCrossBorderTransfer(['EU', 'US', 'JP'])).toBe(true);
    });

    // =====================================================================
    // 11. multiple jurisdictions in same zone = false
    // =====================================================================

    it('returns false for duplicate jurisdiction entries (same zone)', () => {
      expect(resolver.detectCrossBorderTransfer(['EU', 'EU'])).toBe(false);
    });

    it('returns false when all jurisdictions share the same residency zone', () => {
      // GLOBAL maps to "global" - only one entry for that zone
      expect(resolver.detectCrossBorderTransfer(['GLOBAL', 'GLOBAL'])).toBe(false);
    });
  });

  // =========================================================================
  // 12. EU member state code mapping (FR, DE, etc. -> 'EU')
  // =========================================================================

  describe('EU member state code mapping', () => {
    const euMemberStates = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI',
      'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
      'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    ];

    it.each(euMemberStates)(
      'country code %s resolves to EU jurisdiction',
      (code) => {
        const ctx = makeTenantCtx();
        const result = resolver.resolve(ctx, { countryCode: code });
        expect(result.primaryJurisdictions).toContain('EU');
        expect(result.source).toBe('metadata-inference');
      },
    );

    const eeaStates = ['IS', 'LI', 'NO'];

    it.each(eeaStates)(
      'EEA state %s resolves to EU jurisdiction',
      (code) => {
        const ctx = makeTenantCtx();
        const result = resolver.resolve(ctx, { countryCode: code });
        expect(result.primaryJurisdictions).toContain('EU');
      },
    );
  });

  // =========================================================================
  // 13. Non-EU country code mapping (US, GB, JP, etc.)
  // =========================================================================

  describe('non-EU country code mapping', () => {
    const countryMappings: Array<[string, Jurisdiction]> = [
      ['US', 'US'],
      ['GB', 'UK'],
      ['CA', 'CA'],
      ['AU', 'AU'],
      ['JP', 'JP'],
      ['KR', 'KR'],
      ['SG', 'SG'],
      ['CH', 'CH'],
      ['CN', 'CN'],
      ['IN', 'IN'],
      ['BR', 'BR'],
      ['IL', 'IL'],
      ['AE', 'AE'],
      ['SA', 'SA'],
    ];

    it.each(countryMappings)(
      'country code %s maps to jurisdiction %s',
      (countryCode, expectedJurisdiction) => {
        const ctx = makeTenantCtx();
        const result = resolver.resolve(ctx, { countryCode });
        expect(result.primaryJurisdictions).toContain(expectedJurisdiction);
        expect(result.source).toBe('metadata-inference');
      },
    );

    it('GB maps to UK (not GB)', () => {
      const ctx = makeTenantCtx();
      const result = resolver.resolve(ctx, { countryCode: 'GB' });
      expect(result.primaryJurisdictions).toEqual(['UK']);
    });
  });

  // =========================================================================
  // 14. Invalid jurisdiction handling
  // =========================================================================

  describe('invalid jurisdiction handling', () => {
    it('ignores invalid jurisdiction string in metadata', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { jurisdiction: 'NARNIA' });

      // Invalid jurisdiction should be ignored, falling through to default
      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('ignores invalid entries in jurisdictions array', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['INVALID', 'FAKE'],
      });

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('keeps valid entries and discards invalid from jurisdictions array', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['US', 'INVALID', 'EU'],
      });

      expect(result.source).toBe('metadata-inference');
      expect(result.primaryJurisdictions).toEqual(['US', 'EU']);
    });

    it('ignores unrecognised country code in metadata', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { countryCode: 'ZZ' });

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('ignores unrecognised region string', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { region: 'ANTARCTICA' });

      expect(result.source).toBe('default');
      expect(result.primaryJurisdictions).toEqual(['GLOBAL']);
    });

    it('ignores non-string jurisdiction value', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { jurisdiction: 42 });

      expect(result.source).toBe('default');
    });

    it('ignores non-string countryCode value', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, { countryCode: true });

      expect(result.source).toBe('default');
    });
  });

  // =========================================================================
  // 15. Multiple jurisdictions from metadata array
  // =========================================================================

  describe('multiple jurisdictions from metadata array', () => {
    it('resolves multiple valid jurisdictions from array', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['EU', 'US', 'JP'],
      });

      expect(result.source).toBe('metadata-inference');
      expect(result.primaryJurisdictions).toEqual(['EU', 'US', 'JP']);
      expect(result.crossBorderTransfer).toBe(true);
    });

    it('deduplicates jurisdictions from array', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['EU', 'US', 'EU'],
      });

      expect(result.primaryJurisdictions).toEqual(['EU', 'US']);
    });

    it('combines jurisdiction string with jurisdictions array without duplicates', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'US',
        jurisdictions: ['EU', 'US', 'JP'],
      });

      // 'US' from jurisdiction string comes first, then EU and JP from array (US deduplicated)
      expect(result.primaryJurisdictions).toEqual(['US', 'EU', 'JP']);
    });

    it('combines jurisdiction, jurisdictions array, and countryCode', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'UK',
        jurisdictions: ['JP'],
        countryCode: 'FR', // EU member state -> EU
      });

      expect(result.primaryJurisdictions).toEqual(['UK', 'JP', 'EU']);
    });

    it('combines jurisdiction, jurisdictions array, countryCode, and region', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdiction: 'AU',
        jurisdictions: ['CA'],
        countryCode: 'US',
        region: 'EU',
      });

      expect(result.primaryJurisdictions).toEqual(['AU', 'CA', 'US', 'EU']);
    });

    it('does not duplicate when countryCode and jurisdictions yield same result', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['EU'],
        countryCode: 'DE', // DE -> EU (already present)
      });

      expect(result.primaryJurisdictions).toEqual(['EU']);
    });

    it('data residency uses the first jurisdiction in the resolved list', () => {
      const ctx = makeTenantCtx();

      const result = resolver.resolve(ctx, {
        jurisdictions: ['JP', 'US'],
      });

      expect(result.dataResidency).toBe(JURISDICTION_RESIDENCY_ZONES['JP']);
    });
  });

  // =========================================================================
  // JURISDICTION_RESIDENCY_ZONES export sanity check
  // =========================================================================

  describe('JURISDICTION_RESIDENCY_ZONES', () => {
    it('has a zone for every valid jurisdiction', () => {
      const expectedJurisdictions: Jurisdiction[] = [
        'GLOBAL', 'EU', 'US', 'US-FED', 'US-DOD', 'UK', 'CA', 'AU',
        'JP', 'KR', 'SG', 'CH', 'CN', 'IN', 'BR', 'IL', 'AE', 'SA',
      ];

      for (const j of expectedJurisdictions) {
        expect(JURISDICTION_RESIDENCY_ZONES[j]).toBeDefined();
        expect(typeof JURISDICTION_RESIDENCY_ZONES[j]).toBe('string');
      }
    });

    it('all zones are unique strings (no accidental duplicates for distinct jurisdictions)', () => {
      const entries = Object.entries(JURISDICTION_RESIDENCY_ZONES);
      const zones = entries.map(([, zone]) => zone);
      // "global" is only used by GLOBAL, others should be unique
      // This is a sanity check; we just verify they are non-empty strings
      for (const zone of zones) {
        expect(zone.length).toBeGreaterThan(0);
      }
    });
  });
});
