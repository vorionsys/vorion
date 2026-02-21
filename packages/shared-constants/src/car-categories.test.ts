/**
 * Tests for CAR Category Taxonomy
 */

import { describe, it, expect } from 'vitest';
import { TrustTier } from './tiers';
import {
  CARCategory,
  CAR_CATEGORIES,
  getCARCategory,
  getCARCategoriesForTier,
  getHighRiskCategories,
  isCARCategoryAvailable,
  getCARCategoryMinTier,
  getCARSubcategory,
  getParentCategory,
  getAllCARCategoryCodes,
  getAllCARSubcategoryCodes,
  isValidCARCategory,
  isValidCARSubcategory,
} from './car-categories';

// =============================================================================
// TAXONOMY STRUCTURE
// =============================================================================

describe('CAR_CATEGORIES', () => {
  it('has 17 top-level categories', () => {
    expect(CAR_CATEGORIES).toHaveLength(17);
  });

  it('every category has required fields', () => {
    for (const cat of CAR_CATEGORIES) {
      expect(cat.code).toBeDefined();
      expect(cat.name).toBeDefined();
      expect(cat.description).toBeDefined();
      expect(cat.minTier).toBeDefined();
      expect(typeof cat.euHighRisk).toBe('boolean');
      expect(cat.trustDimensions.length).toBeGreaterThan(0);
      expect(cat.subcategories.length).toBeGreaterThan(0);
    }
  });

  it('has unique category codes', () => {
    const codes = CAR_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has unique subcategory codes across all categories', () => {
    const allSubCodes = CAR_CATEGORIES.flatMap((c) =>
      c.subcategories.map((s) => s.code),
    );
    expect(new Set(allSubCodes).size).toBe(allSubCodes.length);
  });

  it('subcategory codes are prefixed by parent code', () => {
    for (const cat of CAR_CATEGORIES) {
      for (const sub of cat.subcategories) {
        expect(sub.code).toMatch(new RegExp(`^${cat.code}-`));
      }
    }
  });
});

// =============================================================================
// ENUM VALUES
// =============================================================================

describe('CARCategory enum', () => {
  it('has all 17 codes', () => {
    expect(Object.keys(CARCategory)).toHaveLength(17);
  });

  it('matches category codes', () => {
    const enumValues = Object.values(CARCategory);
    const categoryValues = CAR_CATEGORIES.map((c) => c.code);
    expect(enumValues.sort()).toEqual(categoryValues.sort());
  });
});

// =============================================================================
// EU AI ACT HIGH-RISK
// =============================================================================

describe('EU AI Act classification', () => {
  it('identifies high-risk categories', () => {
    const highRisk = getHighRiskCategories();
    expect(highRisk.length).toBeGreaterThan(0);

    const highRiskCodes = highRisk.map((c) => c.code);
    expect(highRiskCodes).toContain(CARCategory.FINANCE);
    expect(highRiskCodes).toContain(CARCategory.HEALTHCARE);
    expect(highRiskCodes).toContain(CARCategory.EMPLOYMENT);
    expect(highRiskCodes).toContain(CARCategory.COMPLIANCE);
    expect(highRiskCodes).toContain(CARCategory.SWARM);
    expect(highRiskCodes).toContain(CARCategory.SELF_IMPROVEMENT);
  });

  it('non-high-risk categories exist', () => {
    const nonHighRisk = CAR_CATEGORIES.filter((c) => !c.euHighRisk);
    expect(nonHighRisk.length).toBeGreaterThan(0);
    expect(nonHighRisk.some((c) => c.code === CARCategory.CREATIVE)).toBe(true);
    expect(nonHighRisk.some((c) => c.code === CARCategory.REASONING)).toBe(true);
  });
});

// =============================================================================
// TIER REQUIREMENTS
// =============================================================================

describe('tier requirements', () => {
  it('CREATIVE has lowest tier requirement (T1)', () => {
    expect(getCARCategoryMinTier(CARCategory.CREATIVE)).toBe(TrustTier.T1_OBSERVED);
  });

  it('SELF_IMPROVEMENT requires highest tier (T7)', () => {
    expect(getCARCategoryMinTier(CARCategory.SELF_IMPROVEMENT)).toBe(TrustTier.T7_AUTONOMOUS);
  });

  it('domain-specific high-risk categories require T5+', () => {
    expect(getCARCategoryMinTier(CARCategory.FINANCE)).toBeGreaterThanOrEqual(TrustTier.T5_TRUSTED);
    expect(getCARCategoryMinTier(CARCategory.HEALTHCARE)).toBeGreaterThanOrEqual(TrustTier.T5_TRUSTED);
    expect(getCARCategoryMinTier(CARCategory.EMPLOYMENT)).toBeGreaterThanOrEqual(TrustTier.T5_TRUSTED);
  });

  it('getCARCategoriesForTier returns appropriate categories', () => {
    const t0Cats = getCARCategoriesForTier(TrustTier.T0_SANDBOX);
    expect(t0Cats).toHaveLength(0); // No categories at T0

    const t1Cats = getCARCategoriesForTier(TrustTier.T1_OBSERVED);
    expect(t1Cats.length).toBeGreaterThan(0);
    expect(t1Cats.some((c) => c.code === CARCategory.CREATIVE)).toBe(true);

    const t7Cats = getCARCategoriesForTier(TrustTier.T7_AUTONOMOUS);
    expect(t7Cats).toHaveLength(17); // All categories at T7
  });
});

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

describe('getCARCategory', () => {
  it('finds category by code', () => {
    const gov = getCARCategory(CARCategory.GOVERNANCE);
    expect(gov).toBeDefined();
    expect(gov!.name).toBe('Governance');
    expect(gov!.code).toBe('GOV');
  });

  it('finds category by string code', () => {
    const fin = getCARCategory('FIN');
    expect(fin).toBeDefined();
    expect(fin!.name).toBe('Finance');
  });

  it('returns undefined for invalid code', () => {
    expect(getCARCategory('INVALID')).toBeUndefined();
  });
});

describe('isCARCategoryAvailable', () => {
  it('returns true when tier is sufficient', () => {
    expect(isCARCategoryAvailable(CARCategory.CREATIVE, TrustTier.T1_OBSERVED)).toBe(true);
    expect(isCARCategoryAvailable(CARCategory.CREATIVE, TrustTier.T7_AUTONOMOUS)).toBe(true);
  });

  it('returns false when tier is insufficient', () => {
    expect(isCARCategoryAvailable(CARCategory.SELF_IMPROVEMENT, TrustTier.T5_TRUSTED)).toBe(false);
    expect(isCARCategoryAvailable(CARCategory.GOVERNANCE, TrustTier.T2_PROVISIONAL)).toBe(false);
  });

  it('returns false for invalid code', () => {
    expect(isCARCategoryAvailable('INVALID', TrustTier.T7_AUTONOMOUS)).toBe(false);
  });
});

describe('getCARCategoryMinTier', () => {
  it('returns correct tier for known category', () => {
    expect(getCARCategoryMinTier(CARCategory.REASONING)).toBe(TrustTier.T2_PROVISIONAL);
    expect(getCARCategoryMinTier(CARCategory.TOOL_USE)).toBe(TrustTier.T3_MONITORED);
    expect(getCARCategoryMinTier(CARCategory.SWARM)).toBe(TrustTier.T6_CERTIFIED);
  });

  it('returns undefined for invalid code', () => {
    expect(getCARCategoryMinTier('INVALID')).toBeUndefined();
  });
});

// =============================================================================
// SUBCATEGORY FUNCTIONS
// =============================================================================

describe('getCARSubcategory', () => {
  it('finds subcategory by full code', () => {
    const sub = getCARSubcategory('GOV-POL');
    expect(sub).toBeDefined();
    expect(sub!.name).toBe('Policy Enforcement');
  });

  it('finds subcategories across categories', () => {
    expect(getCARSubcategory('FIN-TRD')).toBeDefined();
    expect(getCARSubcategory('SAF-INJ')).toBeDefined();
    expect(getCARSubcategory('SWM-CON')).toBeDefined();
  });

  it('returns undefined for invalid code', () => {
    expect(getCARSubcategory('INVALID-CODE')).toBeUndefined();
  });
});

describe('getParentCategory', () => {
  it('finds parent for subcategory', () => {
    const parent = getParentCategory('GOV-POL');
    expect(parent).toBeDefined();
    expect(parent!.code).toBe(CARCategory.GOVERNANCE);
  });

  it('finds parent for finance subcategory', () => {
    const parent = getParentCategory('FIN-RSK');
    expect(parent).toBeDefined();
    expect(parent!.code).toBe(CARCategory.FINANCE);
  });

  it('returns undefined for invalid subcategory', () => {
    expect(getParentCategory('INVALID')).toBeUndefined();
  });
});

// =============================================================================
// COLLECTION FUNCTIONS
// =============================================================================

describe('getAllCARCategoryCodes', () => {
  it('returns all 17 category codes', () => {
    const codes = getAllCARCategoryCodes();
    expect(codes).toHaveLength(17);
    expect(codes).toContain(CARCategory.GOVERNANCE);
    expect(codes).toContain(CARCategory.SWARM);
    expect(codes).toContain(CARCategory.SYSTEM);
  });
});

describe('getAllCARSubcategoryCodes', () => {
  it('returns all subcategory codes', () => {
    const codes = getAllCARSubcategoryCodes();
    expect(codes.length).toBeGreaterThan(50); // At least 4 per category * 17
    expect(codes).toContain('GOV-POL');
    expect(codes).toContain('FIN-TRD');
    expect(codes).toContain('SLF-MOD');
  });
});

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

describe('isValidCARCategory', () => {
  it('validates known codes', () => {
    expect(isValidCARCategory('GOV')).toBe(true);
    expect(isValidCARCategory('FIN')).toBe(true);
    expect(isValidCARCategory('SYS')).toBe(true);
  });

  it('rejects invalid codes', () => {
    expect(isValidCARCategory('INVALID')).toBe(false);
    expect(isValidCARCategory('')).toBe(false);
    expect(isValidCARCategory('gov')).toBe(false); // Case sensitive
  });
});

describe('isValidCARSubcategory', () => {
  it('validates known subcategory codes', () => {
    expect(isValidCARSubcategory('GOV-POL')).toBe(true);
    expect(isValidCARSubcategory('FIN-AML')).toBe(true);
    expect(isValidCARSubcategory('SAF-KIL')).toBe(true);
  });

  it('rejects invalid codes', () => {
    expect(isValidCARSubcategory('INVALID')).toBe(false);
    expect(isValidCARSubcategory('GOV-FAKE')).toBe(false);
    expect(isValidCARSubcategory('')).toBe(false);
  });
});
