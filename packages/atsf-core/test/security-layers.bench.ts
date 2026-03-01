/**
 * Security Layers Performance Benchmarks
 *
 * Run with: npx vitest bench security-layers.bench.ts
 *
 * Benchmarks the L0-L5 input validation security layers, both individually
 * and as a full pipeline. These are the hot path for every incoming request.
 *
 * Performance targets:
 * - Individual layer execution: < 1ms
 * - Full pipeline (L0-L5): < 5ms
 * - Rate limiter under high load: < 0.5ms per check
 *
 * @packageDocumentation
 */

import { describe, bench, beforeAll, beforeEach } from 'vitest';
import {
  SecurityPipeline,
  createSecurityPipeline,
} from '../src/layers/index.js';
import type { LayerInput } from '../src/layers/types.js';
import {
  L0RequestFormatValidator,
  L1InputSizeLimiter,
  L2CharsetSanitizer,
  L3SchemaConformance,
  L4InjectionDetector,
  L5RateLimiter,
} from '../src/layers/implementations/index.js';

// ---------------------------------------------------------------------------
// Shared test input — a well-formed "query" request
// ---------------------------------------------------------------------------
function makeLayerInput(entityId = 'bench-entity'): LayerInput {
  return {
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    entityId,
    trustLevel: 3,
    payload: {
      action: 'query',
      content: 'What is the current trust score for agent alpha-7?',
      context: {
        sessionId: 'sess-abc123',
        locale: 'en-US',
      },
    },
    priorResults: [],
    metadata: {
      requestTimestamp: new Date().toISOString(),
      source: 'benchmark',
      context: {},
    },
  };
}

// A large payload for stress-testing size limiter
function makeLargePayloadInput(): LayerInput {
  const largeContent = 'A'.repeat(50_000); // 50KB string
  return {
    requestId: `req-large-${Math.random().toString(36).slice(2, 10)}`,
    entityId: 'bench-entity-large',
    trustLevel: 3,
    payload: {
      action: 'query',
      content: largeContent,
      context: { data: Array.from({ length: 100 }, (_, i) => `item-${i}`) },
    },
    priorResults: [],
    metadata: {
      requestTimestamp: new Date().toISOString(),
      source: 'benchmark',
      context: {},
    },
  };
}

// A payload with injection patterns for L4
function makeInjectionPayloadInput(): LayerInput {
  return {
    requestId: `req-inject-${Math.random().toString(36).slice(2, 10)}`,
    entityId: 'bench-entity-inject',
    trustLevel: 3,
    payload: {
      action: 'query',
      content: 'Please process this normal request about data analysis and reporting.',
    },
    priorResults: [],
    metadata: {
      requestTimestamp: new Date().toISOString(),
      source: 'benchmark',
      context: {},
    },
  };
}

// ===========================================================================
// 1. Individual Layer Throughput
// ===========================================================================

describe('Security Layers — L0 Request Format Validator', () => {
  let layer: L0RequestFormatValidator;
  let input: LayerInput;

  beforeAll(() => {
    layer = new L0RequestFormatValidator();
    input = makeLayerInput();
  });

  bench('execute — well-formed request', async () => {
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });
});

describe('Security Layers — L1 Input Size Limiter', () => {
  let layer: L1InputSizeLimiter;
  let input: LayerInput;
  let largeInput: LayerInput;

  beforeAll(() => {
    layer = new L1InputSizeLimiter();
    input = makeLayerInput();
    largeInput = makeLargePayloadInput();
  });

  bench('execute — normal payload', async () => {
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });

  bench('execute — large payload (50KB)', async () => {
    await layer.execute(largeInput);
  }, { time: 2000, iterations: 2000 });
});

describe('Security Layers — L2 Charset Sanitizer', () => {
  let layer: L2CharsetSanitizer;
  let input: LayerInput;

  beforeAll(() => {
    layer = new L2CharsetSanitizer();
    input = makeLayerInput();
  });

  bench('execute — clean ASCII input', async () => {
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });

  bench('execute — Unicode-heavy content', async () => {
    const unicodeInput = makeLayerInput();
    unicodeInput.payload = {
      ...unicodeInput.payload,
      content: 'Hello world! \u00E9\u00E8\u00EA \u00FC\u00F6\u00E4 \u4F60\u597D \u3053\u3093\u306B\u3061\u306F',
    };
    await layer.execute(unicodeInput);
  }, { time: 2000, iterations: 5000 });
});

describe('Security Layers — L3 Schema Conformance', () => {
  let layer: L3SchemaConformance;
  let input: LayerInput;

  beforeAll(() => {
    layer = new L3SchemaConformance();
    input = makeLayerInput();
  });

  bench('execute — known action (query)', async () => {
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });

  bench('execute — unknown action', async () => {
    const unknownInput = makeLayerInput();
    unknownInput.payload = { action: 'custom_unknown', content: 'data' };
    await layer.execute(unknownInput);
  }, { time: 2000, iterations: 5000 });
});

describe('Security Layers — L4 Injection Detector', () => {
  let layer: L4InjectionDetector;
  let cleanInput: LayerInput;

  beforeAll(() => {
    layer = new L4InjectionDetector();
    cleanInput = makeInjectionPayloadInput();
  });

  bench('execute — clean content (no injection)', async () => {
    await layer.execute(cleanInput);
  }, { time: 2000, iterations: 5000 });

  bench('execute — long clean content (1000 chars)', async () => {
    const longInput = makeLayerInput();
    longInput.payload = {
      action: 'query',
      content: 'This is a perfectly normal request about data analysis. '.repeat(20),
    };
    await layer.execute(longInput);
  }, { time: 2000, iterations: 3000 });
});

describe('Security Layers — L5 Rate Limiter', () => {
  let layer: L5RateLimiter;

  beforeAll(() => {
    layer = new L5RateLimiter({
      maxRequests: 10_000,     // high limit so we measure throughput, not rejection
      burstThreshold: 10_000,
      windowMs: 60_000,
    });
  });

  bench('execute — single entity check', async () => {
    const input = makeLayerInput('rate-entity');
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });

  bench('execute — unique entities (cache miss path)', async () => {
    const input = makeLayerInput(`rate-unique-${Math.random()}`);
    await layer.execute(input);
  }, { time: 2000, iterations: 5000 });
});

// ===========================================================================
// 2. Full Security Pipeline (all L0-L5 layers)
// ===========================================================================

describe('Security Pipeline — Full L0-L5', () => {
  let pipeline: SecurityPipeline;
  let input: LayerInput;

  beforeAll(() => {
    pipeline = createSecurityPipeline({ maxTotalTimeMs: 10_000 });

    // Register all 6 layers
    pipeline.registerLayer(new L0RequestFormatValidator());
    pipeline.registerLayer(new L1InputSizeLimiter());
    pipeline.registerLayer(new L2CharsetSanitizer());
    pipeline.registerLayer(new L3SchemaConformance());
    pipeline.registerLayer(new L4InjectionDetector());
    pipeline.registerLayer(new L5RateLimiter({
      maxRequests: 100_000,
      burstThreshold: 100_000,
      windowMs: 60_000,
    }));

    input = makeLayerInput();
  });

  bench('execute — full pipeline, clean input', async () => {
    await pipeline.execute(input);
  }, { time: 5000, iterations: 1000 });

  bench('execute — full pipeline, unique entity per call', async () => {
    const uniqueInput = makeLayerInput(`pipeline-${Math.random()}`);
    await pipeline.execute(uniqueInput);
  }, { time: 5000, iterations: 1000 });
});

// ===========================================================================
// 3. Rate Limiter Under High Concurrency
// ===========================================================================

describe('Security Layers — L5 Rate Limiter Concurrency', () => {
  let layer: L5RateLimiter;

  beforeAll(() => {
    layer = new L5RateLimiter({
      maxRequests: 100_000,
      burstThreshold: 100_000,
      windowMs: 60_000,
      maxTrackedEntities: 50_000,
    });
  });

  bench('10 concurrent entities, 10 requests each', async () => {
    const promises: Promise<unknown>[] = [];
    for (let e = 0; e < 10; e++) {
      const entityId = `concurrent-${e}`;
      for (let r = 0; r < 10; r++) {
        promises.push(layer.execute(makeLayerInput(entityId)));
      }
    }
    await Promise.all(promises);
  }, { time: 5000, iterations: 100 });

  bench('100 unique entities (simulating burst)', async () => {
    const promises: Promise<unknown>[] = [];
    for (let e = 0; e < 100; e++) {
      promises.push(layer.execute(makeLayerInput(`burst-${Math.random()}`)));
    }
    await Promise.all(promises);
  }, { time: 5000, iterations: 50 });
});

/**
 * Performance Expectations Summary
 *
 * | Operation                              | Target   | Notes                              |
 * |----------------------------------------|----------|------------------------------------|
 * | L0 Request Format Validator            | < 0.1ms  | Structural checks only             |
 * | L1 Input Size Limiter (normal)         | < 0.2ms  | JSON serialize + walk              |
 * | L1 Input Size Limiter (50KB)           | < 1ms    | Larger serialize cost              |
 * | L2 Charset Sanitizer (clean)           | < 0.2ms  | Regex scanning                     |
 * | L3 Schema Conformance                  | < 0.1ms  | Map lookup + type checks           |
 * | L4 Injection Detector (clean)          | < 0.5ms  | 15+ regex patterns per string      |
 * | L5 Rate Limiter                        | < 0.1ms  | Array filter + push                |
 * | Full pipeline (L0-L5)                  | < 3ms    | Sum of individual layers            |
 * | Rate limiter — 10x10 concurrent        | < 5ms    | Parallelized                        |
 * | Rate limiter — 100 burst entities      | < 10ms   | New entity creation path            |
 */
