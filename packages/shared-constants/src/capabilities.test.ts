import { describe, it, expect } from 'vitest';
import { TrustTier, ALL_TIERS } from './tiers.js';
import {
  CapabilityCategory,
  CAPABILITIES,
  getCapabilitiesForTier,
  getCapability,
  isCapabilityAvailable,
  getCapabilityMinTier,
  getCapabilitiesByCategory,
  getAllCapabilityCodes,
} from './capabilities.js';

describe('CAPABILITIES', () => {
  it('has at least one capability per tier', () => {
    for (const tier of ALL_TIERS) {
      const caps = CAPABILITIES.filter(c => c.unlockTier === tier);
      expect(caps.length).toBeGreaterThan(0);
    }
  });

  it('all capabilities have unique codes', () => {
    const codes = CAPABILITIES.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('all capabilities have required fields', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.code).toBeTruthy();
      expect(cap.name).toBeTruthy();
      expect(cap.description).toBeTruthy();
      expect(Object.values(CapabilityCategory)).toContain(cap.category);
      expect(cap.unlockTier).toBeGreaterThanOrEqual(0);
      expect(cap.unlockTier).toBeLessThanOrEqual(7);
    }
  });

  it('capability codes follow CAP- prefix pattern', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.code).toMatch(/^CAP-/);
    }
  });
});

describe('getCapabilitiesForTier', () => {
  it('T0 has only T0 capabilities', () => {
    const caps = getCapabilitiesForTier(TrustTier.T0_SANDBOX);
    for (const cap of caps) {
      expect(cap.unlockTier).toBe(TrustTier.T0_SANDBOX);
    }
  });

  it('higher tiers have more capabilities', () => {
    for (let i = 1; i < ALL_TIERS.length; i++) {
      const prev = getCapabilitiesForTier(ALL_TIERS[i - 1]).length;
      const curr = getCapabilitiesForTier(ALL_TIERS[i]).length;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('T7 has all capabilities', () => {
    const allCaps = getCapabilitiesForTier(TrustTier.T7_AUTONOMOUS);
    expect(allCaps.length).toBe(CAPABILITIES.length);
  });
});

describe('getCapability', () => {
  it('finds existing capability by code', () => {
    const cap = getCapability('CAP-READ-PUBLIC');
    expect(cap).toBeDefined();
    expect(cap!.name).toBe('Read Public Data');
  });

  it('returns undefined for unknown code', () => {
    expect(getCapability('CAP-NONEXISTENT')).toBeUndefined();
  });
});

describe('isCapabilityAvailable', () => {
  it('returns true when tier meets requirement', () => {
    expect(isCapabilityAvailable('CAP-READ-PUBLIC', TrustTier.T0_SANDBOX)).toBe(true);
    expect(isCapabilityAvailable('CAP-READ-PUBLIC', TrustTier.T7_AUTONOMOUS)).toBe(true);
  });

  it('returns false when tier is below requirement', () => {
    expect(isCapabilityAvailable('CAP-SELF-MODIFY', TrustTier.T0_SANDBOX)).toBe(false);
  });

  it('returns false for unknown capability', () => {
    expect(isCapabilityAvailable('UNKNOWN', TrustTier.T7_AUTONOMOUS)).toBe(false);
  });
});

describe('getCapabilityMinTier', () => {
  it('returns correct tier for known capability', () => {
    expect(getCapabilityMinTier('CAP-READ-PUBLIC')).toBe(TrustTier.T0_SANDBOX);
    expect(getCapabilityMinTier('CAP-SELF-MODIFY')).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('returns undefined for unknown capability', () => {
    expect(getCapabilityMinTier('UNKNOWN')).toBeUndefined();
  });
});

describe('getCapabilitiesByCategory', () => {
  it('returns capabilities for each category', () => {
    for (const category of Object.values(CapabilityCategory)) {
      const caps = getCapabilitiesByCategory(category);
      for (const cap of caps) {
        expect(cap.category).toBe(category);
      }
    }
  });
});

describe('getAllCapabilityCodes', () => {
  it('returns all codes', () => {
    const codes = getAllCapabilityCodes();
    expect(codes.length).toBe(CAPABILITIES.length);
    expect(codes).toContain('CAP-READ-PUBLIC');
    expect(codes).toContain('CAP-SELF-MODIFY');
  });
});
