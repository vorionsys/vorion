/**
 * Functional tests for CAR string parsing, validation, and manipulation functions.
 *
 * Covers: tryParseCAR, safeParseCAR, parseLegacyCAR, validateCAR,
 * updateCAR, addCARExtensions, removeCARExtensions, incrementCARVersion, getCARIdentity.
 */

import { describe, it, expect } from 'vitest';
import {
  tryParseCAR,
  safeParseCAR,
  parseLegacyCAR,
  validateCAR,
  updateCAR,
  addCARExtensions,
  removeCARExtensions,
  incrementCARVersion,
  getCARIdentity,
  parseCAR,
  CARParseError,
} from '../src/car/car-string';
import { CapabilityLevel } from '../src/car/levels';
import type { DomainCode } from '../src/car/domains';

const VALID_CAR = 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0';
const VALID_CAR_WITH_EXT = 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0#gov,audit';
const INVALID_CAR = 'not-a-valid-car';
const LEGACY_CAR = 'a3i.vorion.test:AB-L3-T4@1.0.0';

// ============================================================================
// tryParseCAR
// ============================================================================

describe('tryParseCAR', () => {
  it('returns ParsedCAR for valid input', () => {
    const result = tryParseCAR(VALID_CAR);
    expect(result).not.toBeNull();
    expect(result!.registry).toBe('a3i');
    expect(result!.organization).toBe('acme-corp');
    expect(result!.agentClass).toBe('invoice-bot');
    expect(result!.level).toBe(CapabilityLevel.L3_EXECUTE);
  });

  it('returns null for invalid input', () => {
    expect(tryParseCAR(INVALID_CAR)).toBeNull();
  });

  it('returns null for legacy format (does not throw)', () => {
    expect(tryParseCAR(LEGACY_CAR)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(tryParseCAR('')).toBeNull();
  });
});

// ============================================================================
// safeParseCAR
// ============================================================================

describe('safeParseCAR', () => {
  it('returns success result for valid input', () => {
    const result = safeParseCAR(VALID_CAR);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registry).toBe('a3i');
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('returns failure result for invalid input', () => {
    const result = safeParseCAR(INVALID_CAR);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(CARParseError);
      expect(result.error.car).toBe(INVALID_CAR);
    }
  });

  it('returns failure with correct error code for legacy format', () => {
    const result = safeParseCAR(LEGACY_CAR);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('LEGACY_FORMAT');
    }
  });
});

// ============================================================================
// parseLegacyCAR
// ============================================================================

describe('parseLegacyCAR', () => {
  it('parses legacy format and extracts tier', () => {
    const result = parseLegacyCAR(LEGACY_CAR);
    expect(result.legacyTier).toBe(4);
    expect(result.parsed.registry).toBe('a3i');
    expect(result.parsed.organization).toBe('vorion');
    expect(result.parsed.agentClass).toBe('test');
    expect(result.parsed.level).toBe(CapabilityLevel.L3_EXECUTE);
  });

  it('generates new-format CAR string without tier', () => {
    const result = parseLegacyCAR(LEGACY_CAR);
    expect(result.parsed.car).toBe('a3i.vorion.test:AB-L3@1.0.0');
    expect(result.parsed.car).not.toContain('-T');
  });

  it('throws CARParseError for invalid legacy format', () => {
    expect(() => parseLegacyCAR(INVALID_CAR)).toThrow(CARParseError);
  });

  it('correctly extracts different tier values', () => {
    const result = parseLegacyCAR('a3i.vorion.test:AB-L5-T7@2.0.0');
    expect(result.legacyTier).toBe(7);
    expect(result.parsed.level).toBe(CapabilityLevel.L5_TRUSTED);
    expect(result.parsed.version).toBe('2.0.0');
  });
});

// ============================================================================
// validateCAR
// ============================================================================

describe('validateCAR', () => {
  it('returns valid for well-formed CAR', () => {
    const result = validateCAR('a3i.vorion.test:AB-L3@1.0.0');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parsed).toBeDefined();
  });

  it('returns invalid for malformed CAR', () => {
    const result = validateCAR(INVALID_CAR);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('auto-migrates legacy format with warning', () => {
    const result = validateCAR(LEGACY_CAR);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'LEGACY_FORMAT' || w.code === 'LEGACY_FORMAT_MIGRATED')).toBe(true);
    expect(result.parsed).toBeDefined();
  });

  it('warns about security domain', () => {
    const result = validateCAR('a3i.vorion.test:S-L3@1.0.0');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'SECURITY_DOMAIN')).toBe(true);
  });

  it('warns about finance domain', () => {
    const result = validateCAR('a3i.vorion.test:F-L3@1.0.0');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'FINANCE_DOMAIN')).toBe(true);
  });

  it('warns about L7 autonomous level', () => {
    const result = validateCAR('a3i.vorion.test:A-L7@1.0.0');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'L7_AUTONOMOUS_LEVEL')).toBe(true);
  });
});

// ============================================================================
// updateCAR
// ============================================================================

describe('updateCAR', () => {
  it('updates version only, preserving identity', () => {
    const result = updateCAR(VALID_CAR, { version: '2.0.0' });
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.registry).toBe('a3i');
    expect(parsed.organization).toBe('acme-corp');
    expect(parsed.agentClass).toBe('invoice-bot');
    expect(parsed.level).toBe(CapabilityLevel.L3_EXECUTE);
  });

  it('updates domains', () => {
    const result = updateCAR(VALID_CAR, { domains: ['A', 'S'] as DomainCode[] });
    const parsed = parseCAR(result);
    expect(parsed.domains).toContain('A');
    expect(parsed.domains).toContain('S');
    expect(parsed.domains).not.toContain('B');
  });

  it('updates level', () => {
    const result = updateCAR(VALID_CAR, { level: CapabilityLevel.L5_TRUSTED });
    const parsed = parseCAR(result);
    expect(parsed.level).toBe(CapabilityLevel.L5_TRUSTED);
  });

  it('updates extensions', () => {
    const result = updateCAR(VALID_CAR, { extensions: ['gov', 'audit'] });
    expect(result).toContain('#gov,audit');
  });

  it('updates multiple fields at once', () => {
    const result = updateCAR(VALID_CAR, {
      version: '3.0.0',
      level: CapabilityLevel.L6_CERTIFIED,
      extensions: ['secure'],
    });
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('3.0.0');
    expect(parsed.level).toBe(CapabilityLevel.L6_CERTIFIED);
    expect(parsed.extensions).toContain('secure');
  });
});

// ============================================================================
// addCARExtensions
// ============================================================================

describe('addCARExtensions', () => {
  it('adds extensions to CAR without extensions', () => {
    const result = addCARExtensions(VALID_CAR, ['gov', 'audit']);
    const parsed = parseCAR(result);
    expect(parsed.extensions).toContain('gov');
    expect(parsed.extensions).toContain('audit');
  });

  it('deduplicates when adding existing extensions', () => {
    const result = addCARExtensions(VALID_CAR_WITH_EXT, ['gov', 'new-ext']);
    const parsed = parseCAR(result);
    // gov already existed, should not be duplicated
    const govCount = parsed.extensions.filter((e) => e === 'gov').length;
    expect(govCount).toBe(1);
    expect(parsed.extensions).toContain('new-ext');
  });
});

// ============================================================================
// removeCARExtensions
// ============================================================================

describe('removeCARExtensions', () => {
  it('removes existing extension', () => {
    const result = removeCARExtensions(VALID_CAR_WITH_EXT, ['gov']);
    const parsed = parseCAR(result);
    expect(parsed.extensions).not.toContain('gov');
    expect(parsed.extensions).toContain('audit');
  });

  it('removes all extensions to get clean CAR', () => {
    const result = removeCARExtensions(VALID_CAR_WITH_EXT, ['gov', 'audit']);
    expect(result).not.toContain('#');
    const parsed = parseCAR(result);
    expect(parsed.extensions).toHaveLength(0);
  });

  it('handles removing non-existent extension gracefully', () => {
    const result = removeCARExtensions(VALID_CAR_WITH_EXT, ['nonexistent']);
    const parsed = parseCAR(result);
    expect(parsed.extensions).toContain('gov');
    expect(parsed.extensions).toContain('audit');
  });
});

// ============================================================================
// incrementCARVersion
// ============================================================================

describe('incrementCARVersion', () => {
  it('increments patch version by default', () => {
    const result = incrementCARVersion(VALID_CAR);
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('1.0.1');
  });

  it('increments patch version explicitly', () => {
    const result = incrementCARVersion(VALID_CAR, 'patch');
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('1.0.1');
  });

  it('increments minor version and resets patch', () => {
    const result = incrementCARVersion(VALID_CAR, 'minor');
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('1.1.0');
  });

  it('increments major version and resets minor+patch', () => {
    const result = incrementCARVersion(VALID_CAR, 'major');
    const parsed = parseCAR(result);
    expect(parsed.version).toBe('2.0.0');
  });

  it('preserves other CAR components', () => {
    const result = incrementCARVersion(VALID_CAR_WITH_EXT, 'minor');
    const parsed = parseCAR(result);
    expect(parsed.registry).toBe('a3i');
    expect(parsed.organization).toBe('acme-corp');
    expect(parsed.extensions).toContain('gov');
  });
});

// ============================================================================
// getCARIdentity
// ============================================================================

describe('getCARIdentity', () => {
  it('returns registry.organization.agentClass string', () => {
    const parsed = parseCAR(VALID_CAR);
    const identity = getCARIdentity(parsed);
    expect(identity).toBe('a3i.acme-corp.invoice-bot');
  });

  it('returns correct identity for different CAR', () => {
    const parsed = parseCAR('reg1.org-alpha.agent-x:ABC-L5@2.0.0');
    const identity = getCARIdentity(parsed);
    expect(identity).toBe('reg1.org-alpha.agent-x');
  });
});
