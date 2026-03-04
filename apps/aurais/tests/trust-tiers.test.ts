import { describe, it, expect } from 'vitest'
import {
  getTierStylesFromScore,
  getTierStylesFromName,
  parseTierName,
  getTierColor,
  getTierKeyFromScore,
  TIER_STYLES,
  TIER_INFO,
} from '@/lib/trust-tiers'
import { TrustTier } from '@vorionsys/shared-constants'

// =============================================================================
// getTierStylesFromScore
// =============================================================================

describe('getTierStylesFromScore', () => {
  it('returns Sandbox styles for score 0', () => {
    const style = getTierStylesFromScore(0)
    expect(style.name).toBe('Sandbox')
    expect(style.color).toContain('stone')
  })

  it('returns Autonomous styles for score 1000', () => {
    const style = getTierStylesFromScore(1000)
    expect(style.name).toBe('Autonomous')
    expect(style.color).toContain('cyan')
  })

  it('clamps negative scores to Sandbox', () => {
    const style = getTierStylesFromScore(-100)
    expect(style.name).toBe('Sandbox')
  })

  it('clamps scores above 1000 to Autonomous', () => {
    const style = getTierStylesFromScore(9999)
    expect(style.name).toBe('Autonomous')
  })

  it('returns Standard for mid-range score 700', () => {
    const style = getTierStylesFromScore(700)
    expect(style.name).toBe('Standard')
    expect(style.color).toContain('green')
  })
})

// =============================================================================
// getTierStylesFromName
// =============================================================================

describe('getTierStylesFromName', () => {
  it('maps lowercase tier names correctly', () => {
    expect(getTierStylesFromName('sandbox').name).toBe('Sandbox')
    expect(getTierStylesFromName('observed').name).toBe('Observed')
    expect(getTierStylesFromName('provisional').name).toBe('Provisional')
    expect(getTierStylesFromName('monitored').name).toBe('Monitored')
    expect(getTierStylesFromName('standard').name).toBe('Standard')
    expect(getTierStylesFromName('trusted').name).toBe('Trusted')
    expect(getTierStylesFromName('certified').name).toBe('Certified')
    expect(getTierStylesFromName('autonomous').name).toBe('Autonomous')
  })

  it('is case-insensitive', () => {
    expect(getTierStylesFromName('SANDBOX').name).toBe('Sandbox')
    expect(getTierStylesFromName('Trusted').name).toBe('Trusted')
  })

  it('falls back to Sandbox for unknown tier', () => {
    expect(getTierStylesFromName('unknown').name).toBe('Sandbox')
  })
})

// =============================================================================
// parseTierName
// =============================================================================

describe('parseTierName', () => {
  it('maps known names to correct enum values', () => {
    expect(parseTierName('sandbox')).toBe(TrustTier.T0_SANDBOX)
    expect(parseTierName('autonomous')).toBe(TrustTier.T7_AUTONOMOUS)
    expect(parseTierName('standard')).toBe(TrustTier.T4_STANDARD)
  })

  it('falls back to T0_SANDBOX for unknown', () => {
    expect(parseTierName('garbage')).toBe(TrustTier.T0_SANDBOX)
  })
})

// =============================================================================
// getTierColor
// =============================================================================

describe('getTierColor', () => {
  it('returns a text color class', () => {
    expect(getTierColor('trusted')).toContain('text-')
    expect(getTierColor('certified')).toContain('purple')
  })
})

// =============================================================================
// getTierKeyFromScore
// =============================================================================

describe('getTierKeyFromScore', () => {
  it('returns TrustTier enum for valid scores', () => {
    expect(getTierKeyFromScore(0)).toBe(TrustTier.T0_SANDBOX)
    expect(getTierKeyFromScore(500)).toBe(TrustTier.T3_MONITORED)
    expect(getTierKeyFromScore(1000)).toBe(TrustTier.T7_AUTONOMOUS)
  })
})

// =============================================================================
// TIER_STYLES / TIER_INFO completeness
// =============================================================================

describe('TIER_STYLES completeness', () => {
  it('has an entry for every TrustTier', () => {
    const allTiers = [
      TrustTier.T0_SANDBOX,
      TrustTier.T1_OBSERVED,
      TrustTier.T2_PROVISIONAL,
      TrustTier.T3_MONITORED,
      TrustTier.T4_STANDARD,
      TrustTier.T5_TRUSTED,
      TrustTier.T6_CERTIFIED,
      TrustTier.T7_AUTONOMOUS,
    ]
    for (const tier of allTiers) {
      expect(TIER_STYLES[tier]).toBeDefined()
      expect(TIER_STYLES[tier].name).toBeTruthy()
      expect(TIER_STYLES[tier].color).toBeTruthy()
      expect(TIER_STYLES[tier].bg).toBeTruthy()
    }
  })
})

describe('TIER_INFO completeness', () => {
  it('has min, max, description for every tier', () => {
    const allTiers = [
      TrustTier.T0_SANDBOX,
      TrustTier.T1_OBSERVED,
      TrustTier.T2_PROVISIONAL,
      TrustTier.T3_MONITORED,
      TrustTier.T4_STANDARD,
      TrustTier.T5_TRUSTED,
      TrustTier.T6_CERTIFIED,
      TrustTier.T7_AUTONOMOUS,
    ]
    for (const tier of allTiers) {
      const info = TIER_INFO[tier]
      expect(info).toBeDefined()
      expect(typeof info.min).toBe('number')
      expect(typeof info.max).toBe('number')
      expect(info.description).toBeTruthy()
      expect(info.max).toBeGreaterThanOrEqual(info.min)
    }
  })
})
