/**
 * Stepped Milestone Trust Decay
 *
 * Implements a simple stepped decay system where trust scores decay
 * based on fixed milestones tied to days of inactivity. Interpolation
 * between milestones provides smooth decay curves.
 *
 * 9 milestones (not counting day 0):
 * - Steps 1-5 drop 6% each (days 7, 14, 28, 42, 56)
 * - Steps 6-9 drop 5% each (days 84, 112, 140, 182)
 * - At 182 days = 50% of original score
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A single decay milestone mapping days of inactivity to a multiplier
 */
export interface DecayMilestone {
  /** Days since last activity */
  days: number;
  /** Score multiplier at this milestone (0.0 to 1.0) */
  multiplier: number;
}

// ============================================================================
// Milestones
// ============================================================================

/**
 * Fixed decay milestones for inactivity-based trust decay
 *
 * Steps 1-5 drop 6% each. Steps 6-9 drop 5% each.
 * At 182 days of inactivity, score is 50% of original.
 */
export const DECAY_MILESTONES: DecayMilestone[] = [
  { days: 0,   multiplier: 1.00 },
  { days: 7,   multiplier: 0.94 },
  { days: 14,  multiplier: 0.88 },
  { days: 28,  multiplier: 0.82 },
  { days: 42,  multiplier: 0.76 },
  { days: 56,  multiplier: 0.70 },
  { days: 84,  multiplier: 0.65 },
  { days: 112, multiplier: 0.60 },
  { days: 140, multiplier: 0.55 },
  { days: 182, multiplier: 0.50 },
];

// ============================================================================
// Core Decay Functions
// ============================================================================

/**
 * Calculate the decay multiplier for a given number of days since last activity
 *
 * Finds the two surrounding milestones and linearly interpolates between them
 * for a smooth decay curve. Returns the floor multiplier (0.50) for days
 * beyond the last milestone.
 *
 * @param daysSinceLastActivity - Days since the entity's last trust-relevant action
 * @returns Decay multiplier between 0.50 and 1.00
 */
export function calculateDecayMultiplier(daysSinceLastActivity: number): number {
  // Negative or zero days = no decay
  if (daysSinceLastActivity <= 0) {
    return 1.0;
  }

  // Beyond the last milestone = floor multiplier
  const lastMilestone = DECAY_MILESTONES[DECAY_MILESTONES.length - 1]!;
  if (daysSinceLastActivity >= lastMilestone.days) {
    return lastMilestone.multiplier;
  }

  // Find the two surrounding milestones and interpolate
  for (let i = 0; i < DECAY_MILESTONES.length - 1; i++) {
    const current = DECAY_MILESTONES[i]!;
    const next = DECAY_MILESTONES[i + 1]!;

    if (daysSinceLastActivity >= current.days && daysSinceLastActivity < next.days) {
      // Linear interpolation between milestones
      const progress = (daysSinceLastActivity - current.days) / (next.days - current.days);
      return current.multiplier + progress * (next.multiplier - current.multiplier);
    }
  }

  // Fallback (should not be reached)
  return lastMilestone.multiplier;
}

/**
 * Apply decay to a base trust score based on days of inactivity
 *
 * @param baseScore - The entity's base trust score (0-1000)
 * @param daysSinceLastActivity - Days since the entity's last trust-relevant action
 * @returns Decayed score as a rounded integer, minimum 0
 */
export function applyDecay(baseScore: number, daysSinceLastActivity: number): number {
  const multiplier = calculateDecayMultiplier(daysSinceLastActivity);
  return Math.max(0, Math.round(baseScore * multiplier));
}

/**
 * Get the next decay milestone that the entity will hit
 *
 * Returns the next milestone after the entity's current inactivity period,
 * or null if the entity has already passed the final milestone.
 *
 * @param daysSinceLastActivity - Days since the entity's last trust-relevant action
 * @returns The next DecayMilestone, or null if past the final milestone
 */
export function getNextDecayMilestone(daysSinceLastActivity: number): DecayMilestone | null {
  for (const milestone of DECAY_MILESTONES) {
    if (milestone.days > daysSinceLastActivity) {
      return milestone;
    }
  }
  return null;
}
