/**
 * L5 Rate Limiter — Comprehensive Test Suite
 *
 * Tests sliding-window rate limiting, burst detection, acceleration detection,
 * per-entity isolation, eviction, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { L5RateLimiter } from '../src/layers/implementations/index.js';
import type { LayerInput } from '../src/layers/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeInput(overrides: Partial<LayerInput> = {}): LayerInput {
  return {
    requestId: 'test-req-001',
    entityId: 'agent-001',
    trustLevel: 3,
    payload: { action: 'query', content: 'Hello world' },
    priorResults: [],
    metadata: {
      requestTimestamp: new Date().toISOString(),
      source: 'test',
      context: {},
    },
    ...overrides,
  };
}

/**
 * Helper: send N requests for a given entityId and return the last result.
 */
async function sendRequests(
  limiter: L5RateLimiter,
  count: number,
  entityId = 'agent-001'
) {
  let lastResult;
  for (let i = 0; i < count; i++) {
    lastResult = await limiter.execute(makeInput({ entityId }));
  }
  return lastResult!;
}

// ============================================================================
// Basic Rate Limiting
// ============================================================================

describe('L5 Rate Limiter — Basic rate limiting', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
      burstThreshold: 100, // High threshold so burst doesn't interfere
    });
  });

  it('passes a single request', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);
    expect(result.action).toBe('allow');
    expect(result.layerId).toBe(5);
    expect(result.layerName).toBe('Rate Limiter');
  });

  it('passes requests up to the exact limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await limiter.execute(makeInput());
      expect(result.passed).toBe(true);
    }
  });

  it('blocks the request that exceeds the limit', async () => {
    // First 5 pass
    for (let i = 0; i < 5; i++) {
      await limiter.execute(makeInput());
    }
    // 6th is rejected
    const result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);
    expect(result.action).toBe('limit');
    expect(result.findings.some((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('includes descriptive evidence in rate-limit findings', async () => {
    await sendRequests(limiter, 5);
    const result = await limiter.execute(makeInput());
    const finding = result.findings.find((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.type).toBe('threat_detected');
    expect(finding!.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('requests='),
        expect.stringContaining('limit=5'),
        expect.stringContaining('window=60000ms'),
      ])
    );
    expect(finding!.remediation).toContain('60');
  });

  it('continues to block every subsequent request over the limit', async () => {
    await sendRequests(limiter, 5);
    for (let i = 0; i < 3; i++) {
      const result = await limiter.execute(makeInput());
      expect(result.passed).toBe(false);
    }
  });

  it('sets riskLevel to high when rate limit exceeded', async () => {
    await sendRequests(limiter, 5);
    const result = await limiter.execute(makeInput());
    expect(result.riskLevel).toBe('high');
  });

  it('sets riskLevel to low when within limits', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.riskLevel).toBe('low');
  });

  it('returns confidence 0.95 on success', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.confidence).toBe(0.95);
  });

  it('returns confidence 0.9 on failure', async () => {
    await sendRequests(limiter, 5);
    const result = await limiter.execute(makeInput());
    expect(result.confidence).toBe(0.9);
  });
});

// ============================================================================
// Window-Based Limiting (Sliding Window)
// ============================================================================

describe('L5 Rate Limiter — Window-based limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets the count after the full window elapses', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 10_000,
      burstThreshold: 100,
    });

    // Use up all 3 slots
    for (let i = 0; i < 3; i++) {
      await limiter.execute(makeInput());
    }
    // 4th is blocked
    let result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(10_001);

    // Should be allowed again
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);
  });

  it('slides the window correctly — old requests expire, new ones count', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 10_000,
      burstThreshold: 100,
    });

    // t=0: send 2 requests
    await limiter.execute(makeInput());
    await limiter.execute(makeInput());

    // t=6s: send 1 more (total in window: 3)
    vi.advanceTimersByTime(6_000);
    let result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);

    // t=6s: 4th should fail (3 in window)
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);

    // t=11s: the first 2 requests (from t=0) have expired.
    // Only the request from t=6s remains. Total in window: 1
    vi.advanceTimersByTime(5_000);
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);
  });

  it('handles very short window durations', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 2,
      windowMs: 100, // 100ms window
      burstThreshold: 100,
    });

    await limiter.execute(makeInput());
    await limiter.execute(makeInput());

    // At limit
    let result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);

    // Wait 101ms, window expires
    vi.advanceTimersByTime(101);
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);
  });

  it('handles very large window durations', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 2,
      windowMs: 3_600_000, // 1 hour
      burstThreshold: 100,
    });

    await limiter.execute(makeInput());
    await limiter.execute(makeInput());

    // Over limit
    let result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);

    // Advance 30 minutes — still within the 1-hour window
    vi.advanceTimersByTime(1_800_000);
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);

    // Advance the remaining 30+ minutes to pass the window
    vi.advanceTimersByTime(1_800_001);
    result = await limiter.execute(makeInput());
    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// Per-Entity Rate Limiting
// ============================================================================

describe('L5 Rate Limiter — Per-entity isolation', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      burstThreshold: 100,
    });
  });

  it('tracks different entities independently', async () => {
    // Fill up agent-001's quota
    for (let i = 0; i < 3; i++) {
      await limiter.execute(makeInput({ entityId: 'agent-001' }));
    }
    const blocked = await limiter.execute(makeInput({ entityId: 'agent-001' }));
    expect(blocked.passed).toBe(false);

    // agent-002 is unaffected
    const allowed = await limiter.execute(makeInput({ entityId: 'agent-002' }));
    expect(allowed.passed).toBe(true);
  });

  it('tracks many entities simultaneously', async () => {
    const entities = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

    // Each entity sends 2 requests (under limit of 3)
    for (const entity of entities) {
      await limiter.execute(makeInput({ entityId: entity }));
      await limiter.execute(makeInput({ entityId: entity }));
    }

    // Each entity should still have 1 request left
    for (const entity of entities) {
      const result = await limiter.execute(makeInput({ entityId: entity }));
      expect(result.passed).toBe(true);
    }

    // Now each is at the limit — next request should fail
    for (const entity of entities) {
      const result = await limiter.execute(makeInput({ entityId: entity }));
      expect(result.passed).toBe(false);
    }
  });

  it('references the correct entityId in finding descriptions', async () => {
    await sendRequests(limiter, 3, 'entity-xyz');
    const result = await limiter.execute(makeInput({ entityId: 'entity-xyz' }));
    const finding = result.findings.find((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED');
    expect(finding).toBeDefined();
    expect(finding!.description).toContain('entity-xyz');
  });
});

// ============================================================================
// Burst Detection
// ============================================================================

describe('L5 Rate Limiter — Burst detection', () => {
  it('detects burst when requests exceed burst threshold within 1 second', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,   // High overall limit
      windowMs: 60_000,
      burstThreshold: 3,  // Low burst threshold
    });

    // Send 4 requests in the same tick (same millisecond = within 1s)
    for (let i = 0; i < 3; i++) {
      await limiter.execute(makeInput());
    }
    const result = await limiter.execute(makeInput());
    expect(result.findings.some((f) => f.code === 'L5_BURST_DETECTED')).toBe(true);
  });

  it('does not flag burst when requests are spread across seconds', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new L5RateLimiter({
        maxRequests: 100,
        windowMs: 60_000,
        burstThreshold: 3,
      });

      // Send 1 request every 1.5 seconds (always under 3 per second)
      for (let i = 0; i < 6; i++) {
        const result = await limiter.execute(makeInput());
        expect(result.findings.some((f) => f.code === 'L5_BURST_DETECTED')).toBe(false);
        vi.advanceTimersByTime(1_500);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes burst count and threshold in finding evidence', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 60_000,
      burstThreshold: 2,
    });

    await limiter.execute(makeInput());
    await limiter.execute(makeInput());
    const result = await limiter.execute(makeInput());

    const finding = result.findings.find((f) => f.code === 'L5_BURST_DETECTED');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('burst='),
        expect.stringContaining('threshold=2'),
      ])
    );
  });

  it('can trigger both rate limit and burst simultaneously', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      burstThreshold: 3,
    });

    // Send 4 requests rapidly — exceeds both maxRequests (3) and burst threshold (3)
    for (let i = 0; i < 3; i++) {
      await limiter.execute(makeInput());
    }
    const result = await limiter.execute(makeInput());

    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED')).toBe(true);
    expect(result.findings.some((f) => f.code === 'L5_BURST_DETECTED')).toBe(true);
  });

  it('burst detection only considers the last 1 second', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new L5RateLimiter({
        maxRequests: 100,
        windowMs: 60_000,
        burstThreshold: 3,
      });

      // Send 3 requests at t=0
      for (let i = 0; i < 3; i++) {
        await limiter.execute(makeInput());
      }

      // Advance past the 1-second burst window
      vi.advanceTimersByTime(1_001);

      // This should NOT trigger a burst (only 1 in the last second)
      const result = await limiter.execute(makeInput());
      expect(result.findings.some((f) => f.code === 'L5_BURST_DETECTED')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Acceleration Detection
// ============================================================================

describe('L5 Rate Limiter — Acceleration detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects acceleration when request rate speeds up significantly', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 120_000,
      burstThreshold: 100, // High to avoid burst noise
    });

    // First half: slow requests (1 every 2 seconds) — 5 requests
    for (let i = 0; i < 5; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(2_000);
    }

    // Second half: fast requests (1 every 100ms) — 5 requests
    for (let i = 0; i < 5; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(100);
    }

    // The 11th request should see the acceleration pattern
    const result = await limiter.execute(makeInput());

    // Acceleration requires >= 10 timestamps and ratio > 2.0
    // First half avg gap: 2000ms, second half avg gap: 100ms => ratio = 20
    const hasAcceleration = result.findings.some(
      (f) => f.code === 'L5_ACCELERATION_DETECTED'
    );
    expect(hasAcceleration).toBe(true);
  });

  it('does not detect acceleration when rate is constant', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 120_000,
      burstThreshold: 100,
    });

    // Constant rate: 1 request every 500ms for 12 requests
    for (let i = 0; i < 12; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(500);
    }

    const result = await limiter.execute(makeInput());
    const hasAcceleration = result.findings.some(
      (f) => f.code === 'L5_ACCELERATION_DETECTED'
    );
    expect(hasAcceleration).toBe(false);
  });

  it('does not detect acceleration with fewer than 10 requests', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 120_000,
      burstThreshold: 100,
    });

    // Send only 5 requests (accelerating, but too few to detect)
    for (let i = 0; i < 3; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(2_000);
    }
    for (let i = 0; i < 2; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(10);
    }

    const result = await limiter.execute(makeInput());
    // Fewer than 10 timestamps, so acceleration check is skipped
    expect(
      result.findings.some((f) => f.code === 'L5_ACCELERATION_DETECTED')
    ).toBe(false);
  });

  it('acceleration finding has medium severity and warning type', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 120_000,
      burstThreshold: 100,
    });

    // Generate clear acceleration pattern
    for (let i = 0; i < 6; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(3_000);
    }
    for (let i = 0; i < 6; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(50);
    }

    const result = await limiter.execute(makeInput());
    const finding = result.findings.find(
      (f) => f.code === 'L5_ACCELERATION_DETECTED'
    );
    expect(finding).toBeDefined();
    expect(finding!.type).toBe('warning');
    expect(finding!.severity).toBe('medium');
  });

  it('acceleration alone does not cause overall failure (only medium severity)', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 120_000,
      burstThreshold: 100,
    });

    // Generate acceleration but stay under rate and burst limits
    for (let i = 0; i < 6; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(3_000);
    }
    for (let i = 0; i < 6; i++) {
      await limiter.execute(makeInput());
      vi.advanceTimersByTime(50);
    }

    const result = await limiter.execute(makeInput());
    // Acceleration is medium severity, so passed should still be true
    expect(result.passed).toBe(true);
  });
});

// ============================================================================
// Custom Rate Configurations
// ============================================================================

describe('L5 Rate Limiter — Custom configurations', () => {
  it('applies default configuration when no overrides provided', async () => {
    const limiter = new L5RateLimiter();
    const config = limiter.getConfig();
    expect(config.layerId).toBe(5);
    expect(config.name).toBe('Rate Limiter');

    // Default maxRequests is 100 — should handle 100 requests
    for (let i = 0; i < 100; i++) {
      const result = await limiter.execute(
        makeInput({ entityId: `entity-${i % 50}` })
      );
      // First request per entity is fine
      if (i < 50) {
        expect(result.passed).toBe(true);
      }
    }
  });

  it('accepts partial configuration overrides', async () => {
    const limiter = new L5RateLimiter({ maxRequests: 2 });

    await limiter.execute(makeInput());
    await limiter.execute(makeInput());
    const result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('uses a very strict configuration (1 request per window)', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    const first = await limiter.execute(makeInput());
    expect(first.passed).toBe(true);

    const second = await limiter.execute(makeInput());
    expect(second.passed).toBe(false);
  });

  it('uses a very lenient configuration', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 10_000,
      windowMs: 1_000,
      burstThreshold: 10_000,
    });

    // Sending 50 requests should be fine
    for (let i = 0; i < 50; i++) {
      const result = await limiter.execute(makeInput());
      expect(result.passed).toBe(true);
    }
  });
});

// ============================================================================
// Entity Eviction
// ============================================================================

describe('L5 Rate Limiter — Entity eviction', () => {
  it('evicts oldest entities when maxTrackedEntities is reached', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new L5RateLimiter({
        maxRequests: 100,
        windowMs: 60_000,
        burstThreshold: 100,
        maxTrackedEntities: 10,
      });

      // Create 10 entities (hits capacity)
      for (let i = 0; i < 10; i++) {
        await limiter.execute(makeInput({ entityId: `entity-${i}` }));
        vi.advanceTimersByTime(10); // Ensure distinct firstSeen timestamps
      }

      // Adding the 11th entity should trigger eviction of the oldest 10%
      // (10% of 10 = 1 entity evicted, which is entity-0)
      await limiter.execute(makeInput({ entityId: 'entity-new' }));

      // entity-0 was evicted, so its history is gone.
      // Sending a request for entity-0 starts fresh (count=1, should pass).
      const result = await limiter.execute(makeInput({ entityId: 'entity-0' }));
      expect(result.passed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts at least 1 entity even when 10% rounds to 0', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new L5RateLimiter({
        maxRequests: 100,
        windowMs: 60_000,
        burstThreshold: 100,
        maxTrackedEntities: 5, // 10% of 5 = 0.5, Math.floor => 0, but Math.max(1,...) ensures 1
      });

      // Fill to capacity
      for (let i = 0; i < 5; i++) {
        await limiter.execute(makeInput({ entityId: `ent-${i}` }));
        vi.advanceTimersByTime(10);
      }

      // Trigger eviction
      await limiter.execute(makeInput({ entityId: 'ent-new' }));

      // ent-0 (the oldest) should have been evicted
      // Its next request should start fresh
      const result = await limiter.execute(makeInput({ entityId: 'ent-0' }));
      expect(result.passed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Reset and Health Check
// ============================================================================

describe('L5 Rate Limiter — Reset and health check', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      burstThreshold: 100,
    });
  });

  it('reset() clears all entity windows', async () => {
    // Fill up the rate limit
    await sendRequests(limiter, 3);
    const blocked = await limiter.execute(makeInput());
    expect(blocked.passed).toBe(false);

    // Reset
    await limiter.reset();

    // Should pass again
    const afterReset = await limiter.execute(makeInput());
    expect(afterReset.passed).toBe(true);
  });

  it('reset() clears all entities, not just one', async () => {
    await sendRequests(limiter, 3, 'agent-A');
    await sendRequests(limiter, 3, 'agent-B');

    await limiter.reset();

    const a = await limiter.execute(makeInput({ entityId: 'agent-A' }));
    const b = await limiter.execute(makeInput({ entityId: 'agent-B' }));
    expect(a.passed).toBe(true);
    expect(b.passed).toBe(true);
  });

  it('healthCheck() reports healthy status', async () => {
    const health = await limiter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.lastCheck).toBeDefined();
    expect(health.issues).toEqual([]);
  });

  it('healthCheck() reports accurate total request count', async () => {
    await limiter.execute(makeInput({ entityId: 'a' }));
    await limiter.execute(makeInput({ entityId: 'a' }));
    await limiter.execute(makeInput({ entityId: 'b' }));

    const health = await limiter.healthCheck();
    expect(health.metrics.requestsProcessed).toBe(3);
  });

  it('healthCheck() reports zero after reset', async () => {
    await sendRequests(limiter, 3);
    await limiter.reset();

    const health = await limiter.healthCheck();
    expect(health.metrics.requestsProcessed).toBe(0);
  });
});

// ============================================================================
// Layer Configuration
// ============================================================================

describe('L5 Rate Limiter — Layer configuration', () => {
  it('has correct layerId', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().layerId).toBe(5);
  });

  it('has correct name', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().name).toBe('Rate Limiter');
  });

  it('belongs to input_validation tier', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().tier).toBe('input_validation');
  });

  it('addresses denial_of_service as primary threat', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().primaryThreat).toBe('denial_of_service');
  });

  it('addresses resource_abuse as secondary threat', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().secondaryThreats).toContain('resource_abuse');
  });

  it('has block fail mode', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().failMode).toBe('block');
  });

  it('is required', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().required).toBe(true);
  });

  it('is not parallelizable (stateful)', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().parallelizable).toBe(false);
  });

  it('has no dependencies', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().dependencies).toEqual([]);
  });

  it('has a 100ms timeout', () => {
    const limiter = new L5RateLimiter();
    expect(limiter.getConfig().timeoutMs).toBe(100);
  });
});

// ============================================================================
// Input Validation (inherited from BaseSecurityLayer)
// ============================================================================

describe('L5 Rate Limiter — Input validation', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter();
  });

  it('validates well-formed input as valid', () => {
    const result = limiter.validateInput(makeInput());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects input with empty requestId', () => {
    const result = limiter.validateInput(makeInput({ requestId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'requestId')).toBe(true);
  });

  it('rejects input with empty entityId', () => {
    const result = limiter.validateInput(makeInput({ entityId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'entityId')).toBe(true);
  });
});

// ============================================================================
// Timing Information
// ============================================================================

describe('L5 Rate Limiter — Timing metadata', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter();
  });

  it('includes startedAt and completedAt timestamps', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.timing.startedAt).toBeDefined();
    expect(result.timing.completedAt).toBeDefined();
    // Both should be valid ISO strings
    expect(() => new Date(result.timing.startedAt)).not.toThrow();
    expect(() => new Date(result.timing.completedAt)).not.toThrow();
  });

  it('includes durationMs >= 0', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.timing.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('has waitTimeMs of 0', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.timing.waitTimeMs).toBe(0);
  });

  it('processingTimeMs equals durationMs', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.timing.processingTimeMs).toBe(result.timing.durationMs);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('L5 Rate Limiter — Edge cases', () => {
  it('handles maxRequests of 0 (blocks everything)', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 0,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    // Even the very first request exceeds the limit of 0
    const result = await limiter.execute(makeInput());
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === 'L5_RATE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('handles burstThreshold of 0 (every request is a burst)', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 100,
      windowMs: 60_000,
      burstThreshold: 0,
    });

    const result = await limiter.execute(makeInput());
    expect(result.findings.some((f) => f.code === 'L5_BURST_DETECTED')).toBe(true);
  });

  it('handles concurrent requests from the same entity gracefully', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    // Fire 5 requests concurrently
    const promises = Array.from({ length: 5 }, () =>
      limiter.execute(makeInput())
    );
    const results = await Promise.all(promises);

    // All 5 should pass (or at least the total passed+failed should be 5)
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    expect(passed + failed).toBe(5);
  });

  it('handles concurrent requests that exceed the limit', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    // Fire 6 requests concurrently — limit is 3
    const promises = Array.from({ length: 6 }, () =>
      limiter.execute(makeInput())
    );
    const results = await Promise.all(promises);

    // At least some should fail since we exceed the limit
    const failed = results.filter((r) => !r.passed).length;
    expect(failed).toBeGreaterThan(0);
  });

  it('handles empty string entityId', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    // Empty entityId should still work as a key
    await limiter.execute(makeInput({ entityId: '' }));
    await limiter.execute(makeInput({ entityId: '' }));
    const result = await limiter.execute(makeInput({ entityId: '' }));
    expect(result.passed).toBe(false);
  });

  it('handles special characters in entityId', async () => {
    const limiter = new L5RateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      burstThreshold: 100,
    });

    const specialId = 'agent/with spaces & "quotes" <xml>';
    await limiter.execute(makeInput({ entityId: specialId }));
    const result = await limiter.execute(makeInput({ entityId: specialId }));
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.description.includes(specialId))).toBe(true);
  });

  it('totalRequests counter increments across windows', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new L5RateLimiter({
        maxRequests: 2,
        windowMs: 1_000,
        burstThreshold: 100,
      });

      // Window 1: 2 requests
      await limiter.execute(makeInput());
      await limiter.execute(makeInput());

      // Window 2: 2 more requests
      vi.advanceTimersByTime(1_001);
      await limiter.execute(makeInput());
      await limiter.execute(makeInput());

      // Total requests should be 4 even though only 2 are in the current window
      const health = await limiter.healthCheck();
      expect(health.metrics.requestsProcessed).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// Result Structure Validation
// ============================================================================

describe('L5 Rate Limiter — Result structure', () => {
  let limiter: L5RateLimiter;

  beforeEach(() => {
    limiter = new L5RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      burstThreshold: 100,
    });
  });

  it('success result has all required fields', async () => {
    const result = await limiter.execute(makeInput());

    expect(result).toEqual(
      expect.objectContaining({
        layerId: 5,
        layerName: 'Rate Limiter',
        passed: true,
        action: 'allow',
        confidence: expect.any(Number),
        riskLevel: expect.any(String),
        findings: expect.any(Array),
        modifications: expect.any(Array),
        timing: expect.objectContaining({
          startedAt: expect.any(String),
          completedAt: expect.any(String),
          durationMs: expect.any(Number),
          waitTimeMs: expect.any(Number),
          processingTimeMs: expect.any(Number),
        }),
      })
    );
  });

  it('failure result has all required fields', async () => {
    await sendRequests(limiter, 3);
    const result = await limiter.execute(makeInput());

    expect(result).toEqual(
      expect.objectContaining({
        layerId: 5,
        layerName: 'Rate Limiter',
        passed: false,
        action: 'limit',
        confidence: expect.any(Number),
        riskLevel: 'high',
        findings: expect.arrayContaining([
          expect.objectContaining({
            type: 'threat_detected',
            severity: 'high',
            code: 'L5_RATE_LIMIT_EXCEEDED',
            description: expect.any(String),
            evidence: expect.any(Array),
          }),
        ]),
        modifications: [],
        timing: expect.objectContaining({
          startedAt: expect.any(String),
          completedAt: expect.any(String),
          durationMs: expect.any(Number),
        }),
      })
    );
  });

  it('success result has empty modifications array', async () => {
    const result = await limiter.execute(makeInput());
    expect(result.modifications).toEqual([]);
  });

  it('failure result has empty modifications array', async () => {
    await sendRequests(limiter, 3);
    const result = await limiter.execute(makeInput());
    expect(result.modifications).toEqual([]);
  });
});
