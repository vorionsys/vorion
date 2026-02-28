/**
 * Distributed Circuit Breaker
 *
 * Prevents cascading failures across AI providers with configurable
 * thresholds, half-open testing, and automatic recovery.
 *
 * @packageDocumentation
 */

import type { ProviderId } from "./health-checker.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Circuit breaker state
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery (half-open) */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open before closing */
  successThreshold: number;
  /** Time window for counting failures (ms) */
  failureWindowMs: number;
  /** Percentage of requests to test in half-open state */
  halfOpenRequestPercentage: number;
  /** Enable jitter for reset timeout */
  enableJitter: boolean;
  /** Maximum jitter factor (0-1) */
  jitterFactor: number;
}

/**
 * Circuit state record
 */
export interface CircuitRecord {
  provider: ProviderId;
  model?: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  lastStateChange: Date;
  nextAttempt: Date | null;
  totalFailures: number;
  totalSuccesses: number;
  recentErrors: Array<{ timestamp: Date; error: string }>;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitMetrics {
  provider: ProviderId;
  model?: string;
  state: CircuitState;
  failureRate: number;
  requestsBlocked: number;
  requestsAllowed: number;
  tripsCount: number;
  recoveryCount: number;
  averageRecoveryTimeMs: number;
}

/**
 * Call result for circuit breaker
 */
export interface CallResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  errorType?: "timeout" | "rate_limit" | "server_error" | "auth" | "other";
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  successThreshold: 3,
  failureWindowMs: 60000, // 1 minute
  halfOpenRequestPercentage: 20,
  enableJitter: true,
  jitterFactor: 0.3,
};

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

/**
 * Distributed Circuit Breaker
 *
 * Features:
 * - Per-provider and per-model circuit tracking
 * - Configurable failure thresholds and timeouts
 * - Half-open state with gradual recovery testing
 * - Jitter on reset timeout to prevent thundering herd
 * - Metrics and event tracking
 * - Automatic cleanup of stale circuits
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private circuits: Map<string, CircuitRecord> = new Map();
  private metrics: Map<string, CircuitMetrics> = new Map();
  private listeners: Set<(key: string, record: CircuitRecord) => void> =
    new Set();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get circuit key
   */
  private getKey(provider: ProviderId, model?: string): string {
    return model ? `${provider}:${model}` : provider;
  }

  /**
   * Get or create circuit record
   */
  private getCircuit(provider: ProviderId, model?: string): CircuitRecord {
    const key = this.getKey(provider, model);
    let circuit = this.circuits.get(key);

    if (!circuit) {
      circuit = {
        provider,
        model,
        state: "closed",
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        lastStateChange: new Date(),
        nextAttempt: null,
        totalFailures: 0,
        totalSuccesses: 0,
        recentErrors: [],
      };
      this.circuits.set(key, circuit);
    }

    return circuit;
  }

  /**
   * Get or create metrics record
   */
  private getMetrics(provider: ProviderId, model?: string): CircuitMetrics {
    const key = this.getKey(provider, model);
    let metrics = this.metrics.get(key);

    if (!metrics) {
      metrics = {
        provider,
        model,
        state: "closed",
        failureRate: 0,
        requestsBlocked: 0,
        requestsAllowed: 0,
        tripsCount: 0,
        recoveryCount: 0,
        averageRecoveryTimeMs: 0,
      };
      this.metrics.set(key, metrics);
    }

    return metrics;
  }

  /**
   * Check if request should be allowed
   */
  canRequest(provider: ProviderId, model?: string): boolean {
    const circuit = this.getCircuit(provider, model);
    const metrics = this.getMetrics(provider, model);

    switch (circuit.state) {
      case "closed":
        metrics.requestsAllowed++;
        return true;

      case "open":
        // Check if we should transition to half-open
        if (circuit.nextAttempt && new Date() >= circuit.nextAttempt) {
          this.transitionTo(circuit, "half-open");
          return this.allowHalfOpenRequest(circuit, metrics);
        }
        metrics.requestsBlocked++;
        return false;

      case "half-open":
        return this.allowHalfOpenRequest(circuit, metrics);
    }
  }

  /**
   * Decide whether to allow request in half-open state
   */
  private allowHalfOpenRequest(
    circuit: CircuitRecord,
    metrics: CircuitMetrics,
  ): boolean {
    // Allow a percentage of requests through for testing
    const shouldAllow =
      Math.random() * 100 < this.config.halfOpenRequestPercentage;

    if (shouldAllow) {
      metrics.requestsAllowed++;
    } else {
      metrics.requestsBlocked++;
    }

    return shouldAllow;
  }

  /**
   * Record call result
   */
  recordResult(provider: ProviderId, result: CallResult, model?: string): void {
    const circuit = this.getCircuit(provider, model);
    const metrics = this.getMetrics(provider, model);

    if (result.success) {
      this.recordSuccess(circuit, metrics);
    } else {
      this.recordFailure(circuit, metrics, result.error, result.errorType);
    }
  }

  /**
   * Record successful call
   */
  private recordSuccess(circuit: CircuitRecord, metrics: CircuitMetrics): void {
    circuit.successes++;
    circuit.totalSuccesses++;
    circuit.lastSuccess = new Date();

    switch (circuit.state) {
      case "closed":
        // Reset failure count on success
        circuit.failures = 0;
        break;

      case "half-open":
        // Check if we have enough successes to close
        if (circuit.successes >= this.config.successThreshold) {
          this.transitionTo(circuit, "closed");
          metrics.recoveryCount++;

          // Calculate recovery time
          if (circuit.lastFailure) {
            const recoveryTime =
              new Date().getTime() - circuit.lastFailure.getTime();
            metrics.averageRecoveryTimeMs =
              (metrics.averageRecoveryTimeMs + recoveryTime) / 2;
          }
        }
        break;

      case "open":
        // Shouldn't happen, but handle anyway
        break;
    }

    this.updateMetrics(circuit, metrics);
    this.notifyListeners(circuit);
  }

  /**
   * Record failed call
   */
  private recordFailure(
    circuit: CircuitRecord,
    metrics: CircuitMetrics,
    error?: string,
    errorType?: string,
  ): void {
    circuit.failures++;
    circuit.totalFailures++;
    circuit.lastFailure = new Date();
    circuit.successes = 0; // Reset success counter

    // Track recent errors
    circuit.recentErrors.push({
      timestamp: new Date(),
      error: error ?? "Unknown error",
    });
    if (circuit.recentErrors.length > 10) {
      circuit.recentErrors.shift();
    }

    // Clean up old failures outside the window
    const windowStart = new Date(Date.now() - this.config.failureWindowMs);
    circuit.recentErrors = circuit.recentErrors.filter(
      (e) => e.timestamp >= windowStart,
    );

    switch (circuit.state) {
      case "closed":
        // Check if we should open the circuit
        if (circuit.failures >= this.config.failureThreshold) {
          this.transitionTo(circuit, "open");
          metrics.tripsCount++;
        }
        break;

      case "half-open":
        // Any failure in half-open should reopen
        this.transitionTo(circuit, "open");
        break;

      case "open":
        // Already open, extend the timeout
        this.setNextAttempt(circuit);
        break;
    }

    this.updateMetrics(circuit, metrics);
    this.notifyListeners(circuit);
  }

  /**
   * Transition to new state
   */
  private transitionTo(circuit: CircuitRecord, newState: CircuitState): void {
    const oldState = circuit.state;
    circuit.state = newState;
    circuit.lastStateChange = new Date();

    if (newState === "open") {
      this.setNextAttempt(circuit);
    } else {
      circuit.nextAttempt = null;
    }

    if (newState === "closed") {
      circuit.failures = 0;
      circuit.successes = 0;
    }

    if (newState === "half-open") {
      circuit.successes = 0;
    }

    console.log(
      `[CIRCUIT] ${circuit.provider}${circuit.model ? `:${circuit.model}` : ""} ` +
        `transitioned: ${oldState} -> ${newState}`,
    );
  }

  /**
   * Set next attempt time with jitter
   */
  private setNextAttempt(circuit: CircuitRecord): void {
    let timeout = this.config.resetTimeoutMs;

    if (this.config.enableJitter) {
      const jitter =
        timeout * this.config.jitterFactor * (Math.random() * 2 - 1);
      timeout += jitter;
    }

    circuit.nextAttempt = new Date(Date.now() + timeout);
  }

  /**
   * Update metrics
   */
  private updateMetrics(circuit: CircuitRecord, metrics: CircuitMetrics): void {
    metrics.state = circuit.state;

    const total = circuit.totalSuccesses + circuit.totalFailures;
    metrics.failureRate = total > 0 ? (circuit.totalFailures / total) * 100 : 0;
  }

  /**
   * Get circuit state
   */
  getState(provider: ProviderId, model?: string): CircuitState {
    const circuit = this.getCircuit(provider, model);
    return circuit.state;
  }

  /**
   * Get circuit record
   */
  getCircuitRecord(provider: ProviderId, model?: string): CircuitRecord {
    return this.getCircuit(provider, model);
  }

  /**
   * Get all circuits
   */
  getAllCircuits(): Map<string, CircuitRecord> {
    return new Map(this.circuits);
  }

  /**
   * Get metrics for circuit
   */
  getCircuitMetrics(provider: ProviderId, model?: string): CircuitMetrics {
    return this.getMetrics(provider, model);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, CircuitMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Force circuit state (for testing/manual intervention)
   */
  forceState(provider: ProviderId, state: CircuitState, model?: string): void {
    const circuit = this.getCircuit(provider, model);
    this.transitionTo(circuit, state);
  }

  /**
   * Reset circuit
   */
  reset(provider: ProviderId, model?: string): void {
    const key = this.getKey(provider, model);
    this.circuits.delete(key);
    this.metrics.delete(key);
    console.log(`[CIRCUIT] Reset: ${key}`);
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    this.circuits.clear();
    this.metrics.clear();
    console.log("[CIRCUIT] All circuits reset");
  }

  /**
   * Add state change listener
   */
  onStateChange(
    listener: (key: string, record: CircuitRecord) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners
   */
  private notifyListeners(circuit: CircuitRecord): void {
    const key = this.getKey(circuit.provider, circuit.model);
    for (const listener of this.listeners) {
      try {
        listener(key, circuit);
      } catch (error) {
        console.error("[CIRCUIT] Listener error:", error);
      }
    }
  }

  /**
   * Get summary of all circuits
   */
  getSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    providers: Record<string, CircuitState>;
  } {
    let closed = 0;
    let open = 0;
    let halfOpen = 0;
    const providers: Record<string, CircuitState> = {};

    for (const [key, circuit] of this.circuits) {
      providers[key] = circuit.state;

      switch (circuit.state) {
        case "closed":
          closed++;
          break;
        case "open":
          open++;
          break;
        case "half-open":
          halfOpen++;
          break;
      }
    }

    return {
      total: this.circuits.size,
      closed,
      open,
      halfOpen,
      providers,
    };
  }

  /**
   * Start automatic cleanup
   */
  startCleanup(intervalMs: number = 300000): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const staleThreshold = Date.now() - this.config.failureWindowMs * 10;

      for (const [key, circuit] of this.circuits) {
        if (
          circuit.state === "closed" &&
          circuit.lastStateChange.getTime() < staleThreshold
        ) {
          this.circuits.delete(key);
          this.metrics.delete(key);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/**
 * Create circuit breaker instance
 */
export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  return new CircuitBreaker(config);
}

/**
 * Singleton circuit breaker instance
 */
export const circuitBreaker = new CircuitBreaker();
