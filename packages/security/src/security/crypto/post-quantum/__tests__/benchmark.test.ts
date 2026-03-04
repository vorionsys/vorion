/**
 * Tests for Post-Quantum Cryptography Benchmarks
 *
 * Validates the benchmark runner with minimal iterations to keep tests fast.
 * Covers result structure, export formats, and factory functions.
 *
 * @module security/crypto/post-quantum/__tests__/benchmark.test
 */

import { describe, it, expect } from 'vitest';
import {
  BenchmarkRunner,
  createBenchmarkRunner,
  runQuickBenchmark,
} from '../benchmark.js';
import { KyberParameterSet, DilithiumParameterSet } from '../types.js';

describe('BenchmarkRunner', () => {
  it('creates with default config', () => {
    const runner = new BenchmarkRunner();
    expect(runner).toBeInstanceOf(BenchmarkRunner);
  });

  it('creates with custom config (reduced iterations)', () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });
    expect(runner).toBeInstanceOf(BenchmarkRunner);
  });

  it('throws if not initialized', async () => {
    const runner = new BenchmarkRunner();
    await expect(runner.runAll()).rejects.toThrow('not initialized');
  });

  it('runAll returns BenchmarkSuiteResult with expected structure', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
      algorithms: {
        kyber: [KyberParameterSet.KYBER768],
        dilithium: [DilithiumParameterSet.DILITHIUM3],
      },
      includeHybrid: false,
      includeClassical: false,
      measureMemory: false,
    });

    await runner.initialize();
    const results = await runner.runAll();

    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.platform).toBeDefined();
    expect(results.platform.nodeVersion).toBeDefined();
    expect(results.platform.arch).toBeDefined();
    expect(typeof results.nativeBindingsUsed).toBe('boolean');
    expect(results.timestamp).toBeInstanceOf(Date);

    // Validate individual result structure
    const first = results.results[0]!;
    expect(first.operation).toBeDefined();
    expect(first.algorithm).toBeDefined();
    expect(first.iterations).toBe(2);
    expect(typeof first.totalTimeMs).toBe('number');
    expect(typeof first.avgTimeMs).toBe('number');
    expect(typeof first.minTimeMs).toBe('number');
    expect(typeof first.maxTimeMs).toBe('number');
    expect(typeof first.stdDevMs).toBe('number');
    expect(typeof first.opsPerSecond).toBe('number');
  }, 30_000);

  it('exportJSON returns valid JSON string', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
      algorithms: {
        kyber: [KyberParameterSet.KYBER768],
        dilithium: [],
      },
      includeHybrid: false,
      includeClassical: false,
      measureMemory: false,
    });
    await runner.initialize();
    const results = await runner.runAll();

    const json = runner.exportJSON(results);
    expect(() => JSON.parse(json)).not.toThrow();
  }, 30_000);

  it('exportCSV returns CSV with headers', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
      algorithms: {
        kyber: [KyberParameterSet.KYBER768],
        dilithium: [],
      },
      includeHybrid: false,
      includeClassical: false,
      measureMemory: false,
    });
    await runner.initialize();
    const results = await runner.runAll();

    const csv = runner.exportCSV(results);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Algorithm');
    expect(lines[0]).toContain('Operation');
    expect(lines.length).toBeGreaterThan(1);
  }, 30_000);
});

describe('Factory & Quick Benchmark', () => {
  it('createBenchmarkRunner creates instance', () => {
    const runner = createBenchmarkRunner({ iterations: 2 });
    expect(runner).toBeInstanceOf(BenchmarkRunner);
  });

  it('runQuickBenchmark returns valid results', async () => {
    const results = await runQuickBenchmark();

    expect(results.results).toBeInstanceOf(Array);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.timestamp).toBeInstanceOf(Date);
  }, 60_000);
});
