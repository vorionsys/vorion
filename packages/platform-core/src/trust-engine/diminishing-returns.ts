/**
 * Diminishing Returns for Trust Signals
 *
 * Prevents gaming by reducing the impact of repeated same-type signals.
 * Each subsequent signal of the same type/source within a window has
 * progressively reduced weight.
 *
 * @packageDocumentation
 */

import type { TrustSignal as TrustSignalType } from '../common/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Diminishing returns configuration
 */
export interface DiminishingReturnsConfig {
  /** Time window in milliseconds for tracking repeated signals (default: 7 days) */
  windowMs: number;
  /** Weight factors for 1st, 2nd, 3rd, 4th+ signals of same type */
  diminishingFactors: [number, number, number, number];
  /** Whether to track by source in addition to type */
  trackBySource: boolean;
}

/**
 * Default configuration
 *
 * - 7-day window for tracking repeats
 * - 1st signal: 100%, 2nd: 70%, 3rd: 50%, 4th+: 30%
 * - Track by type+source combination
 */
export const DEFAULT_DIMINISHING_CONFIG: DiminishingReturnsConfig = {
  windowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  diminishingFactors: [1.0, 0.7, 0.5, 0.3],
  trackBySource: true,
};

// =============================================================================
// SIGNAL FREQUENCY TRACKING
// =============================================================================

/**
 * Tracks frequency of signal types within a window
 */
export interface SignalFrequencyMap {
  /** Map of signal key to count within window */
  counts: Map<string, number>;
  /** Signals included in this frequency map */
  signalIds: Set<string>;
}

/**
 * Build a signal key for frequency tracking
 *
 * @param signal - The signal to key
 * @param trackBySource - Whether to include source in key
 */
export function buildSignalKey(
  signal: TrustSignalType,
  trackBySource: boolean
): string {
  if (trackBySource && signal.source) {
    return `${signal.type}:${signal.source}`;
  }
  return signal.type;
}

/**
 * Build frequency map from signals within time window
 *
 * @param signals - All signals to analyze (should be sorted by timestamp desc)
 * @param config - Diminishing returns configuration
 * @returns Frequency map with counts per signal type/source
 */
export function buildFrequencyMap(
  signals: TrustSignalType[],
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): SignalFrequencyMap {
  const counts = new Map<string, number>();
  const signalIds = new Set<string>();
  const now = Date.now();
  const cutoff = now - config.windowMs;

  for (const signal of signals) {
    const signalTime = new Date(signal.timestamp).getTime();

    // Only count signals within the window
    if (signalTime < cutoff) continue;

    const key = buildSignalKey(signal, config.trackBySource);
    const currentCount = counts.get(key) ?? 0;
    counts.set(key, currentCount + 1);
    signalIds.add(signal.id);
  }

  return { counts, signalIds };
}

/**
 * Get the occurrence number for a signal (1st, 2nd, 3rd, etc. of its type)
 *
 * This counts how many signals of the same type occurred BEFORE this one
 * within the window, to determine this signal's position.
 *
 * @param signal - The signal to check
 * @param allSignals - All signals sorted by timestamp descending
 * @param config - Diminishing returns configuration
 * @returns 1-based occurrence number (1 = first of type, 2 = second, etc.)
 */
export function getSignalOccurrence(
  signal: TrustSignalType,
  allSignals: TrustSignalType[],
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): number {
  const signalTime = new Date(signal.timestamp).getTime();
  const cutoff = signalTime - config.windowMs;
  const key = buildSignalKey(signal, config.trackBySource);

  let occurrence = 1; // This signal is at least the 1st

  for (const other of allSignals) {
    if (other.id === signal.id) continue;

    const otherTime = new Date(other.timestamp).getTime();

    // Only count signals before this one and within window
    if (otherTime >= signalTime) continue;
    if (otherTime < cutoff) continue;

    const otherKey = buildSignalKey(other, config.trackBySource);
    if (otherKey === key) {
      occurrence++;
    }
  }

  return occurrence;
}

// =============================================================================
// DIMINISHING WEIGHT CALCULATION
// =============================================================================

/**
 * Calculate diminished weight for a signal based on its occurrence
 *
 * @param occurrence - 1-based occurrence number (1 = first, 2 = second, etc.)
 * @param baseWeight - Original signal weight
 * @param config - Diminishing returns configuration
 * @returns Adjusted weight after diminishing returns
 */
export function calculateDiminishedWeight(
  occurrence: number,
  baseWeight: number,
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): number {
  // occurrence is 1-based, factors array is 0-based
  const index = Math.min(occurrence - 1, config.diminishingFactors.length - 1);
  const factor = config.diminishingFactors[index] ?? config.diminishingFactors[3]!;
  return baseWeight * factor;
}

/**
 * Apply diminishing returns to a signal's weight
 *
 * Combines occurrence-based diminishing with the signal's base weight.
 *
 * @param signal - The signal to adjust
 * @param allSignals - All signals for context (sorted by timestamp desc)
 * @param config - Diminishing returns configuration
 * @returns Adjusted weight
 */
export function applyDiminishingReturns(
  signal: TrustSignalType,
  allSignals: TrustSignalType[],
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): number {
  const baseWeight = signal.weight ?? 1.0;
  const occurrence = getSignalOccurrence(signal, allSignals, config);
  return calculateDiminishedWeight(occurrence, baseWeight, config);
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Result of applying diminishing returns to signals
 */
export interface DiminishedSignalsResult {
  /** Signals with adjusted weights */
  signals: Array<TrustSignalType & { diminishedWeight: number; occurrence: number }>;
  /** Summary statistics */
  stats: {
    totalSignals: number;
    uniqueTypes: number;
    avgDiminishment: number;
    mostRepeatedType: string | null;
    mostRepeatedCount: number;
  };
}

/**
 * Apply diminishing returns to all signals and return adjusted weights
 *
 * @param signals - Signals to process (will be sorted internally)
 * @param config - Diminishing returns configuration
 * @returns Signals with diminished weights and statistics
 */
export function processSignalsWithDiminishing(
  signals: TrustSignalType[],
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): DiminishedSignalsResult {
  // Sort by timestamp descending (most recent first)
  const sorted = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const frequencyMap = buildFrequencyMap(sorted, config);

  // Find most repeated type
  let mostRepeatedType: string | null = null;
  let mostRepeatedCount = 0;
  for (const [type, count] of frequencyMap.counts) {
    if (count > mostRepeatedCount) {
      mostRepeatedType = type;
      mostRepeatedCount = count;
    }
  }

  // Process each signal
  let totalDiminishment = 0;
  const processed = sorted.map((signal) => {
    const baseWeight = signal.weight ?? 1.0;
    const occurrence = getSignalOccurrence(signal, sorted, config);
    const diminishedWeight = calculateDiminishedWeight(occurrence, baseWeight, config);
    totalDiminishment += baseWeight - diminishedWeight;

    return {
      ...signal,
      diminishedWeight,
      occurrence,
    };
  });

  return {
    signals: processed,
    stats: {
      totalSignals: signals.length,
      uniqueTypes: frequencyMap.counts.size,
      avgDiminishment: signals.length > 0 ? totalDiminishment / signals.length : 0,
      mostRepeatedType,
      mostRepeatedCount,
    },
  };
}

/**
 * Calculate weighted average with diminishing returns applied
 *
 * This is the primary function to use in TrustEngine.averageSignalValue
 *
 * @param signals - Signals to average
 * @param defaultValue - Default if no signals
 * @param config - Diminishing returns configuration
 * @returns Weighted average with diminishing returns applied
 */
export function averageWithDiminishing(
  signals: TrustSignalType[],
  defaultValue: number,
  config: DiminishingReturnsConfig = DEFAULT_DIMINISHING_CONFIG
): number {
  if (signals.length === 0) return defaultValue;

  // Sort by timestamp descending
  const sorted = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const signal of sorted) {
    // Time decay (182-day half-life)
    const age = now - new Date(signal.timestamp).getTime();
    const timeWeight = Math.exp(-age / (182 * 24 * 60 * 60 * 1000));

    // Diminishing returns based on occurrence
    const diminishedWeight = applyDiminishingReturns(signal, sorted, config);

    // Combined weight = time decay × diminished signal weight
    const combinedWeight = timeWeight * diminishedWeight;

    weightedSum += signal.value * combinedWeight;
    totalWeight += combinedWeight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : defaultValue;
}
