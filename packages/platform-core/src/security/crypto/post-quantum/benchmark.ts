/**
 * Post-Quantum Cryptography Benchmarks
 *
 * Performance benchmarking utilities for post-quantum cryptographic operations:
 * - Key generation timing
 * - Encapsulation/decapsulation timing
 * - Signature/verification timing
 * - Memory usage estimation
 * - Comparison with classical algorithms
 *
 * Use these benchmarks to:
 * - Evaluate PQ algorithm performance on your hardware
 * - Compare native vs reference implementations
 * - Make informed decisions about algorithm selection
 * - Monitor performance regressions
 *
 * @packageDocumentation
 * @module security/crypto/post-quantum/benchmark
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createLogger } from '../../../common/logger.js';
import { KyberService, createKyberService } from './kyber.js';
import { DilithiumService, createDilithiumService } from './dilithium.js';
import { HybridKEM, HybridSign, createHybridKEM, createHybridSign } from './hybrid.js';
import {
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  type BenchmarkOperation,
  type KyberParameterSet,
  type DilithiumParameterSet,
  BenchmarkOperation as BenchOp,
  KyberParameterSet as KyberPS,
  DilithiumParameterSet as DilithiumPS,
  KYBER_PARAMETERS,
  DILITHIUM_PARAMETERS,
  benchmarkResultSchema,
  benchmarkSuiteResultSchema,
} from './types.js';

const logger = createLogger({ component: 'pq-benchmark' });

// =============================================================================
// Benchmark Configuration
// =============================================================================

/**
 * Benchmark configuration options
 */
export interface BenchmarkConfig {
  /** Number of iterations per benchmark */
  iterations: number;
  /** Warmup iterations (not counted) */
  warmupIterations: number;
  /** Include memory measurements */
  measureMemory: boolean;
  /** Algorithms to benchmark */
  algorithms: {
    kyber: KyberParameterSet[];
    dilithium: DilithiumParameterSet[];
  };
  /** Include hybrid mode benchmarks */
  includeHybrid: boolean;
  /** Include classical comparison */
  includeClassical: boolean;
  /** Message size for signature benchmarks */
  messageSize: number;
}

const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  iterations: 100,
  warmupIterations: 10,
  measureMemory: true,
  algorithms: {
    kyber: [KyberPS.KYBER512, KyberPS.KYBER768, KyberPS.KYBER1024],
    dilithium: [DilithiumPS.DILITHIUM2, DilithiumPS.DILITHIUM3, DilithiumPS.DILITHIUM5],
  },
  includeHybrid: true,
  includeClassical: true,
  messageSize: 1024,
};

// =============================================================================
// Statistics Helpers
// =============================================================================

/**
 * Calculate statistics for timing measurements
 */
function calculateStats(times: number[]): {
  avg: number;
  min: number;
  max: number;
  stdDev: number;
  total: number;
} {
  const n = times.length;
  if (n === 0) {
    return { avg: 0, min: 0, max: 0, stdDev: 0, total: 0 };
  }

  const total = times.reduce((a, b) => a + b, 0);
  const avg = total / n;
  const min = Math.min(...times);
  const max = Math.max(...times);

  const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return { avg, min, max, stdDev, total };
}

/**
 * Get memory usage in bytes
 */
function getMemoryUsage(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed;
}

/**
 * Force garbage collection if available
 */
function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

// =============================================================================
// Benchmark Runner
// =============================================================================

/**
 * Runs post-quantum cryptography benchmarks
 *
 * @example
 * ```typescript
 * const runner = new BenchmarkRunner();
 * await runner.initialize();
 *
 * // Run all benchmarks
 * const results = await runner.runAll();
 *
 * // Print results
 * runner.printResults(results);
 * ```
 */
export class BenchmarkRunner {
  private readonly config: BenchmarkConfig;
  private kyber!: KyberService;
  private dilithium!: DilithiumService;
  private hybridKEM!: HybridKEM;
  private hybridSign!: HybridSign;
  private initialized: boolean = false;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };
  }

  /**
   * Initialize benchmark services
   */
  async initialize(): Promise<void> {
    this.kyber = createKyberService();
    this.dilithium = createDilithiumService();
    this.hybridKEM = createHybridKEM();
    this.hybridSign = createHybridSign();

    await Promise.all([
      this.kyber.initialize(),
      this.dilithium.initialize(),
      this.hybridKEM.initialize(),
      this.hybridSign.initialize(),
    ]);

    this.initialized = true;
    logger.info('Benchmark runner initialized');
  }

  /**
   * Ensure runner is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('BenchmarkRunner not initialized. Call initialize() first.');
    }
  }

  /**
   * Run all benchmarks
   */
  async runAll(): Promise<BenchmarkSuiteResult> {
    this.ensureInitialized();

    const results: BenchmarkResult[] = [];

    logger.info(
      {
        iterations: this.config.iterations,
        warmup: this.config.warmupIterations,
        kyberAlgorithms: this.config.algorithms.kyber,
        dilithiumAlgorithms: this.config.algorithms.dilithium,
      },
      'Starting benchmark suite'
    );

    // Kyber benchmarks
    for (const alg of this.config.algorithms.kyber) {
      results.push(await this.benchmarkKyberKeyGen(alg));
      results.push(await this.benchmarkKyberEncaps(alg));
      results.push(await this.benchmarkKyberDecaps(alg));
    }

    // Dilithium benchmarks
    for (const alg of this.config.algorithms.dilithium) {
      results.push(await this.benchmarkDilithiumKeyGen(alg));
      results.push(await this.benchmarkDilithiumSign(alg));
      results.push(await this.benchmarkDilithiumVerify(alg));
    }

    // Hybrid benchmarks
    if (this.config.includeHybrid) {
      results.push(await this.benchmarkHybridKEMKeyGen());
      results.push(await this.benchmarkHybridKEMEncaps());
      results.push(await this.benchmarkHybridKEMDecaps());
      results.push(await this.benchmarkHybridSignKeyGen());
      results.push(await this.benchmarkHybridSignSign());
      results.push(await this.benchmarkHybridSignVerify());
    }

    // Classical benchmarks for comparison
    if (this.config.includeClassical) {
      results.push(await this.benchmarkX25519KeyGen());
      results.push(await this.benchmarkX25519DH());
      results.push(await this.benchmarkEd25519KeyGen());
      results.push(await this.benchmarkEd25519Sign());
      results.push(await this.benchmarkEd25519Verify());
    }

    const suiteResult: BenchmarkSuiteResult = {
      timestamp: new Date(),
      platform: {
        nodeVersion: process.version,
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        cpuCores: os.cpus().length,
      },
      results,
      nativeBindingsUsed: this.kyber.isNativeAvailable(),
    };

    logger.info(
      {
        totalBenchmarks: results.length,
        nativeBindings: suiteResult.nativeBindingsUsed,
      },
      'Benchmark suite complete'
    );

    return suiteResult as BenchmarkSuiteResult;
  }

  // ===========================================================================
  // Kyber Benchmarks
  // ===========================================================================

  async benchmarkKyberKeyGen(alg: KyberParameterSet): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, alg, async () => {
      await this.kyber.generateKeyPair(alg);
    });
  }

  async benchmarkKyberEncaps(alg: KyberParameterSet): Promise<BenchmarkResult> {
    const keyPair = await this.kyber.generateKeyPair(alg);

    return this.runBenchmark(BenchOp.ENCAPSULATION, alg, async () => {
      await this.kyber.encapsulate(keyPair.publicKey, alg);
    });
  }

  async benchmarkKyberDecaps(alg: KyberParameterSet): Promise<BenchmarkResult> {
    const keyPair = await this.kyber.generateKeyPair(alg);
    const { ciphertext } = await this.kyber.encapsulate(keyPair.publicKey, alg);

    return this.runBenchmark(BenchOp.DECAPSULATION, alg, async () => {
      await this.kyber.decapsulate(keyPair.privateKey, ciphertext, alg);
    });
  }

  // ===========================================================================
  // Dilithium Benchmarks
  // ===========================================================================

  async benchmarkDilithiumKeyGen(alg: DilithiumParameterSet): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, alg, async () => {
      await this.dilithium.generateKeyPair(alg);
    });
  }

  async benchmarkDilithiumSign(alg: DilithiumParameterSet): Promise<BenchmarkResult> {
    const keyPair = await this.dilithium.generateKeyPair(alg);
    const message = crypto.randomBytes(this.config.messageSize);

    return this.runBenchmark(BenchOp.SIGN, alg, async () => {
      await this.dilithium.sign(keyPair.privateKey, message, alg);
    });
  }

  async benchmarkDilithiumVerify(alg: DilithiumParameterSet): Promise<BenchmarkResult> {
    const keyPair = await this.dilithium.generateKeyPair(alg);
    const message = crypto.randomBytes(this.config.messageSize);
    const { signature } = await this.dilithium.sign(keyPair.privateKey, message, alg);

    return this.runBenchmark(BenchOp.VERIFY, alg, async () => {
      await this.dilithium.verify(keyPair.publicKey, message, signature, alg);
    });
  }

  // ===========================================================================
  // Hybrid Benchmarks
  // ===========================================================================

  async benchmarkHybridKEMKeyGen(): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, 'hybrid-kem', async () => {
      await this.hybridKEM.generateKeyPair();
    });
  }

  async benchmarkHybridKEMEncaps(): Promise<BenchmarkResult> {
    const keyPair = await this.hybridKEM.generateKeyPair();

    return this.runBenchmark(BenchOp.ENCAPSULATION, 'hybrid-kem', async () => {
      await this.hybridKEM.encapsulate(keyPair);
    });
  }

  async benchmarkHybridKEMDecaps(): Promise<BenchmarkResult> {
    const keyPair = await this.hybridKEM.generateKeyPair();
    const { ciphertext } = await this.hybridKEM.encapsulate(keyPair);

    return this.runBenchmark(BenchOp.DECAPSULATION, 'hybrid-kem', async () => {
      await this.hybridKEM.decapsulate(keyPair, ciphertext);
    });
  }

  async benchmarkHybridSignKeyGen(): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, 'hybrid-sign', async () => {
      await this.hybridSign.generateKeyPair();
    });
  }

  async benchmarkHybridSignSign(): Promise<BenchmarkResult> {
    const keyPair = await this.hybridSign.generateKeyPair();
    const message = crypto.randomBytes(this.config.messageSize);

    return this.runBenchmark(BenchOp.SIGN, 'hybrid-sign', async () => {
      await this.hybridSign.sign(keyPair, message);
    });
  }

  async benchmarkHybridSignVerify(): Promise<BenchmarkResult> {
    const keyPair = await this.hybridSign.generateKeyPair();
    const message = crypto.randomBytes(this.config.messageSize);
    const { signature } = await this.hybridSign.sign(keyPair, message);

    return this.runBenchmark(BenchOp.VERIFY, 'hybrid-sign', async () => {
      await this.hybridSign.verify(keyPair, message, signature);
    });
  }

  // ===========================================================================
  // Classical Benchmarks (for comparison)
  // ===========================================================================

  async benchmarkX25519KeyGen(): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, 'x25519', async () => {
      crypto.generateKeyPairSync('x25519');
    });
  }

  async benchmarkX25519DH(): Promise<BenchmarkResult> {
    const alice = crypto.generateKeyPairSync('x25519');
    const bob = crypto.generateKeyPairSync('x25519');

    return this.runBenchmark(BenchOp.ENCAPSULATION, 'x25519', async () => {
      crypto.diffieHellman({
        privateKey: alice.privateKey,
        publicKey: bob.publicKey,
      });
    });
  }

  async benchmarkEd25519KeyGen(): Promise<BenchmarkResult> {
    return this.runBenchmark(BenchOp.KEY_GENERATION, 'ed25519', async () => {
      crypto.generateKeyPairSync('ed25519');
    });
  }

  async benchmarkEd25519Sign(): Promise<BenchmarkResult> {
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const message = crypto.randomBytes(this.config.messageSize);

    return this.runBenchmark(BenchOp.SIGN, 'ed25519', async () => {
      crypto.sign(null, message, keyPair.privateKey);
    });
  }

  async benchmarkEd25519Verify(): Promise<BenchmarkResult> {
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const message = crypto.randomBytes(this.config.messageSize);
    const signature = crypto.sign(null, message, keyPair.privateKey);

    return this.runBenchmark(BenchOp.VERIFY, 'ed25519', async () => {
      crypto.verify(null, message, keyPair.publicKey, signature);
    });
  }

  // ===========================================================================
  // Benchmark Helper
  // ===========================================================================

  private async runBenchmark(
    operation: BenchmarkOperation,
    algorithm: string,
    fn: () => Promise<void> | void
  ): Promise<BenchmarkResult> {
    const times: number[] = [];
    let memoryBefore = 0;
    let memoryAfter = 0;

    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await fn();
    }

    // Force GC before measurement
    if (this.config.measureMemory) {
      forceGC();
      memoryBefore = getMemoryUsage();
    }

    // Actual benchmark
    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    // Measure memory after
    if (this.config.measureMemory) {
      memoryAfter = getMemoryUsage();
    }

    const stats = calculateStats(times);

    const result: BenchmarkResult = {
      operation,
      algorithm,
      iterations: this.config.iterations,
      totalTimeMs: stats.total,
      avgTimeMs: stats.avg,
      minTimeMs: stats.min,
      maxTimeMs: stats.max,
      stdDevMs: stats.stdDev,
      opsPerSecond: 1000 / stats.avg,
    };

    if (this.config.measureMemory && memoryAfter > memoryBefore) {
      result.memoryUsageBytes = memoryAfter - memoryBefore;
    }

    logger.debug(
      {
        operation,
        algorithm,
        avgMs: stats.avg.toFixed(3),
        opsPerSec: result.opsPerSecond.toFixed(1),
      },
      'Benchmark complete'
    );

    return result;
  }

  // ===========================================================================
  // Result Formatting
  // ===========================================================================

  /**
   * Print benchmark results to console
   */
  printResults(results: BenchmarkSuiteResult): void {
    console.log('\n' + '='.repeat(80));
    console.log('POST-QUANTUM CRYPTOGRAPHY BENCHMARK RESULTS');
    console.log('='.repeat(80));
    console.log(`\nTimestamp: ${results.timestamp.toISOString()}`);
    console.log(`Platform: ${results.platform.cpuModel}`);
    console.log(`Node.js: ${results.platform.nodeVersion}`);
    console.log(`Architecture: ${results.platform.arch}`);
    console.log(`CPU Cores: ${results.platform.cpuCores}`);
    console.log(`Native Bindings: ${results.nativeBindingsUsed ? 'Yes' : 'No (reference implementation)'}`);
    console.log('\n' + '-'.repeat(80));

    // Group by algorithm
    const byAlgorithm = new Map<string, BenchmarkResult[]>();
    for (const result of results.results) {
      const existing = byAlgorithm.get(result.algorithm) || [];
      existing.push(result);
      byAlgorithm.set(result.algorithm, existing);
    }

    for (const [algorithm, algResults] of Array.from(byAlgorithm.entries())) {
      console.log(`\n${algorithm.toUpperCase()}`);
      console.log('-'.repeat(40));

      for (const result of algResults) {
        const memStr = result.memoryUsageBytes
          ? ` | Memory: ${(result.memoryUsageBytes / 1024).toFixed(1)} KB`
          : '';

        console.log(
          `  ${result.operation.padEnd(15)} | ` +
          `Avg: ${result.avgTimeMs.toFixed(3).padStart(8)} ms | ` +
          `Ops/s: ${result.opsPerSecond.toFixed(0).padStart(8)} | ` +
          `StdDev: ${result.stdDevMs.toFixed(3).padStart(6)} ms` +
          memStr
        );
      }
    }

    console.log('\n' + '='.repeat(80));

    // Print comparison summary
    this.printComparisonSummary(results);
  }

  /**
   * Print comparison summary between classical and PQ
   */
  private printComparisonSummary(results: BenchmarkSuiteResult): void {
    console.log('\nPERFORMANCE COMPARISON (Classical vs Post-Quantum)');
    console.log('-'.repeat(60));

    // Find comparable operations
    const getAvg = (alg: string, op: BenchmarkOperation): number | undefined => {
      return results.results.find(r => r.algorithm === alg && r.operation === op)?.avgTimeMs;
    };

    // KEM comparison
    const x25519KeyGen = getAvg('x25519', BenchOp.KEY_GENERATION);
    const kyber768KeyGen = getAvg('kyber768', BenchOp.KEY_GENERATION);

    if (x25519KeyGen && kyber768KeyGen) {
      const ratio = kyber768KeyGen / x25519KeyGen;
      console.log(`\nKey Generation (X25519 vs Kyber768):`);
      console.log(`  X25519:   ${x25519KeyGen.toFixed(3)} ms`);
      console.log(`  Kyber768: ${kyber768KeyGen.toFixed(3)} ms`);
      console.log(`  Ratio:    ${ratio.toFixed(1)}x slower`);
    }

    // Signature comparison
    const ed25519Sign = getAvg('ed25519', BenchOp.SIGN);
    const dilithium3Sign = getAvg('dilithium3', BenchOp.SIGN);

    if (ed25519Sign && dilithium3Sign) {
      const ratio = dilithium3Sign / ed25519Sign;
      console.log(`\nSigning (Ed25519 vs Dilithium3):`);
      console.log(`  Ed25519:    ${ed25519Sign.toFixed(3)} ms`);
      console.log(`  Dilithium3: ${dilithium3Sign.toFixed(3)} ms`);
      console.log(`  Ratio:      ${ratio.toFixed(1)}x slower`);
    }

    // Verification comparison
    const ed25519Verify = getAvg('ed25519', BenchOp.VERIFY);
    const dilithium3Verify = getAvg('dilithium3', BenchOp.VERIFY);

    if (ed25519Verify && dilithium3Verify) {
      const ratio = dilithium3Verify / ed25519Verify;
      console.log(`\nVerification (Ed25519 vs Dilithium3):`);
      console.log(`  Ed25519:    ${ed25519Verify.toFixed(3)} ms`);
      console.log(`  Dilithium3: ${dilithium3Verify.toFixed(3)} ms`);
      console.log(`  Ratio:      ${ratio.toFixed(1)}x slower`);
    }

    // Key/signature sizes
    console.log('\nKEY AND SIGNATURE SIZES');
    console.log('-'.repeat(60));

    console.log('\nKEM Public Key Sizes:');
    console.log(`  X25519:     32 bytes`);
    console.log(`  Kyber512:   ${KYBER_PARAMETERS[KyberPS.KYBER512].publicKeySize} bytes`);
    console.log(`  Kyber768:   ${KYBER_PARAMETERS[KyberPS.KYBER768].publicKeySize} bytes`);
    console.log(`  Kyber1024:  ${KYBER_PARAMETERS[KyberPS.KYBER1024].publicKeySize} bytes`);

    console.log('\nSignature Sizes:');
    console.log(`  Ed25519:     64 bytes`);
    console.log(`  Dilithium2:  ${DILITHIUM_PARAMETERS[DilithiumPS.DILITHIUM2].signatureSize} bytes`);
    console.log(`  Dilithium3:  ${DILITHIUM_PARAMETERS[DilithiumPS.DILITHIUM3].signatureSize} bytes`);
    console.log(`  Dilithium5:  ${DILITHIUM_PARAMETERS[DilithiumPS.DILITHIUM5].signatureSize} bytes`);

    console.log('\n' + '='.repeat(80) + '\n');
  }

  /**
   * Export results as JSON
   */
  exportJSON(results: BenchmarkSuiteResult): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Export results as CSV
   */
  exportCSV(results: BenchmarkSuiteResult): string {
    const headers = [
      'Algorithm',
      'Operation',
      'Iterations',
      'Total (ms)',
      'Avg (ms)',
      'Min (ms)',
      'Max (ms)',
      'StdDev (ms)',
      'Ops/sec',
      'Memory (bytes)',
    ];

    const rows = results.results.map(r => [
      r.algorithm,
      r.operation,
      r.iterations,
      r.totalTimeMs.toFixed(3),
      r.avgTimeMs.toFixed(3),
      r.minTimeMs.toFixed(3),
      r.maxTimeMs.toFixed(3),
      r.stdDevMs.toFixed(3),
      r.opsPerSecond.toFixed(2),
      r.memoryUsageBytes?.toString() || '',
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a benchmark runner
 */
export function createBenchmarkRunner(config?: Partial<BenchmarkConfig>): BenchmarkRunner {
  return new BenchmarkRunner(config);
}

/**
 * Run quick benchmark (reduced iterations)
 */
export async function runQuickBenchmark(): Promise<BenchmarkSuiteResult> {
  const runner = new BenchmarkRunner({
    iterations: 10,
    warmupIterations: 2,
    algorithms: {
      kyber: [KyberPS.KYBER768],
      dilithium: [DilithiumPS.DILITHIUM3],
    },
    includeHybrid: false,
    includeClassical: true,
  });

  await runner.initialize();
  return runner.runAll();
}

/**
 * Run full benchmark suite
 */
export async function runFullBenchmark(): Promise<BenchmarkSuiteResult> {
  const runner = new BenchmarkRunner();
  await runner.initialize();
  return runner.runAll();
}
