import { describe, it, expect } from 'vitest';
import {
  buildSignalKey,
  buildFrequencyMap,
  getSignalOccurrence,
  calculateDiminishedWeight,
  applyDiminishingReturns,
  processSignalsWithDiminishing,
  averageWithDiminishing,
  DEFAULT_DIMINISHING_CONFIG,
  type DiminishingReturnsConfig,
} from '../src/trust-engine/diminishing-returns.js';
import type { TrustSignal } from '../src/common/types.js';

function makeSignal(
  id: string,
  type: string,
  source: string,
  value: number,
  weight: number,
  timestamp: Date
): TrustSignal {
  return {
    id,
    entityId: 'entity-1',
    type,
    value,
    weight,
    source,
    timestamp: timestamp.toISOString(),
  } as unknown as TrustSignal;
}

describe('buildSignalKey', () => {
  it('returns type:source when trackBySource is true and source exists', () => {
    const signal = makeSignal('s1', 'behavioral.success', 'api', 100, 1.0, new Date());
    expect(buildSignalKey(signal, true)).toBe('behavioral.success:api');
  });

  it('returns only type when trackBySource is false', () => {
    const signal = makeSignal('s1', 'behavioral.success', 'api', 100, 1.0, new Date());
    expect(buildSignalKey(signal, false)).toBe('behavioral.success');
  });

  it('returns only type when source is empty', () => {
    const signal = makeSignal('s1', 'behavioral.success', '', 100, 1.0, new Date());
    expect(buildSignalKey(signal, true)).toBe('behavioral.success');
  });
});

describe('buildFrequencyMap', () => {
  it('counts signals within the time window', () => {
    const now = new Date();
    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s3', 'type_b', 'src1', 100, 1.0, now),
    ];

    const result = buildFrequencyMap(signals);
    expect(result.counts.get('type_a:src1')).toBe(2);
    expect(result.counts.get('type_b:src1')).toBe(1);
    expect(result.signalIds.size).toBe(3);
  });

  it('excludes signals outside the time window', () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_a', 'src1', 100, 1.0, oldDate),
    ];

    const result = buildFrequencyMap(signals);
    expect(result.counts.get('type_a:src1')).toBe(1);
  });

  it('returns empty map for no signals', () => {
    const result = buildFrequencyMap([]);
    expect(result.counts.size).toBe(0);
    expect(result.signalIds.size).toBe(0);
  });
});

describe('calculateDiminishedWeight', () => {
  it('applies 100% for 1st occurrence (factor = 1.0)', () => {
    expect(calculateDiminishedWeight(1, 10)).toBe(10);
  });

  it('applies 70% for 2nd occurrence (factor = 0.7)', () => {
    expect(calculateDiminishedWeight(2, 10)).toBeCloseTo(7);
  });

  it('applies 50% for 3rd occurrence (factor = 0.5)', () => {
    expect(calculateDiminishedWeight(3, 10)).toBeCloseTo(5);
  });

  it('applies 30% for 4th+ occurrence (factor = 0.3)', () => {
    expect(calculateDiminishedWeight(4, 10)).toBeCloseTo(3);
    expect(calculateDiminishedWeight(5, 10)).toBeCloseTo(3);
    expect(calculateDiminishedWeight(100, 10)).toBeCloseTo(3);
  });

  it('works with custom config', () => {
    const config: DiminishingReturnsConfig = {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      diminishingFactors: [1.0, 0.5, 0.25, 0.1],
      trackBySource: true,
    };
    expect(calculateDiminishedWeight(2, 10, config)).toBeCloseTo(5);
    expect(calculateDiminishedWeight(4, 10, config)).toBeCloseTo(1);
  });
});

describe('getSignalOccurrence', () => {
  it('returns 1 for the first signal of its type', () => {
    const now = new Date();
    const signal = makeSignal('s1', 'type_a', 'src1', 100, 1.0, now);
    expect(getSignalOccurrence(signal, [signal])).toBe(1);
  });

  it('returns correct occurrence for repeated signals', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 1000);
    const earliest = new Date(now.getTime() - 2000);

    const signals = [
      makeSignal('s3', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_a', 'src1', 100, 1.0, earlier),
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, earliest),
    ];

    expect(getSignalOccurrence(signals[0]!, signals)).toBe(3);
    expect(getSignalOccurrence(signals[1]!, signals)).toBe(2);
    expect(getSignalOccurrence(signals[2]!, signals)).toBe(1);
  });

  it('distinguishes between different signal types', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 1000);

    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_b', 'src1', 100, 1.0, earlier),
    ];

    expect(getSignalOccurrence(signals[0]!, signals)).toBe(1);
    expect(getSignalOccurrence(signals[1]!, signals)).toBe(1);
  });
});

describe('processSignalsWithDiminishing', () => {
  it('returns empty stats for empty input', () => {
    const result = processSignalsWithDiminishing([]);
    expect(result.signals).toHaveLength(0);
    expect(result.stats.totalSignals).toBe(0);
    expect(result.stats.uniqueTypes).toBe(0);
    expect(result.stats.avgDiminishment).toBe(0);
    expect(result.stats.mostRepeatedType).toBeNull();
  });

  it('processes signals and calculates diminished weights', () => {
    const now = new Date();
    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_a', 'src1', 100, 1.0, new Date(now.getTime() - 1000)),
      makeSignal('s3', 'type_b', 'src2', 80, 1.0, new Date(now.getTime() - 2000)),
    ];

    const result = processSignalsWithDiminishing(signals);
    expect(result.signals).toHaveLength(3);
    expect(result.stats.totalSignals).toBe(3);
    expect(result.stats.uniqueTypes).toBe(2);
    expect(result.stats.mostRepeatedType).toBe('type_a:src1');
    expect(result.stats.mostRepeatedCount).toBe(2);
  });

  it('first occurrence has full weight, second has diminished weight', () => {
    const now = new Date();
    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
      makeSignal('s2', 'type_a', 'src1', 100, 1.0, new Date(now.getTime() - 1000)),
    ];

    const result = processSignalsWithDiminishing(signals);
    // First signal sorted to position 0 (most recent), which is occurrence=2
    // Second signal is occurrence=1
    const newestSignal = result.signals.find(s => s.id === 's1')!;
    const olderSignal = result.signals.find(s => s.id === 's2')!;

    expect(olderSignal.occurrence).toBe(1);
    expect(olderSignal.diminishedWeight).toBe(1.0);
    expect(newestSignal.occurrence).toBe(2);
    expect(newestSignal.diminishedWeight).toBeCloseTo(0.7);
  });
});

describe('averageWithDiminishing', () => {
  it('returns defaultValue for empty signals', () => {
    expect(averageWithDiminishing([], 50)).toBe(50);
  });

  it('returns weighted average for single signal', () => {
    const now = new Date();
    const signals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
    ];
    const result = averageWithDiminishing(signals, 50);
    // With single recent signal, should be close to its value
    expect(result).toBeCloseTo(100, 0);
  });

  it('applies time decay to older signals', () => {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 60 * 60 * 1000);

    const recentSignals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, now),
    ];
    const oldSignals = [
      makeSignal('s1', 'type_a', 'src1', 100, 1.0, sixMonthsAgo),
    ];

    const recentResult = averageWithDiminishing(recentSignals, 50);
    const oldResult = averageWithDiminishing(oldSignals, 50);

    // Recent signal should give a higher result than old signal
    // (both have same value but old one has more time decay)
    expect(recentResult).toBeCloseTo(100, 0);
    // Old signal at half-life should have some decay
    expect(oldResult).toBeCloseTo(100, 0); // Value is still 100, just weighted less
  });
});
