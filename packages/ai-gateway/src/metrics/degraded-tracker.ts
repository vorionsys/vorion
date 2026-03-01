/**
 * Degraded-Mode Metrics Tracker
 *
 * Tracks when the AI Gateway serves fallback/degraded responses so operators
 * can monitor fallback frequency, identify failing primary models, and
 * understand which fallback models are absorbing load.
 *
 * Pure in-memory counters -- no external dependencies.  Query via the
 * singleton `degradedTracker` or programmatically through `getMetrics()`.
 */

// ============================================
// TYPES
// ============================================

export interface DegradedMetrics {
  /** Total requests tracked (normal + degraded) */
  totalRequests: number;
  /** Requests that were served via a fallback model */
  degradedRequests: number;
  /** Count of fallback invocations keyed by the fallback model name */
  fallbacksByModel: Record<string, number>;
  /** Count of fallback invocations keyed by the failure reason */
  failureReasons: Record<string, number>;
  /** Timestamp of the most recent degraded response, or null if none */
  lastDegradedAt: Date | null;
  /** Percentage of requests that were degraded (0-100) */
  degradedRate: number;
}

// ============================================
// DEGRADED TRACKER
// ============================================

export class DegradedTracker {
  private _totalRequests = 0;
  private _degradedRequests = 0;
  private _fallbacksByModel: Record<string, number> = {};
  private _failureReasons: Record<string, number> = {};
  private _lastDegradedAt: Date | null = null;

  // -------------------------------------------
  // Public accessors (read-only snapshots)
  // -------------------------------------------

  get totalRequests(): number {
    return this._totalRequests;
  }

  get degradedRequests(): number {
    return this._degradedRequests;
  }

  get fallbacksByModel(): Record<string, number> {
    return { ...this._fallbacksByModel };
  }

  get failureReasons(): Record<string, number> {
    return { ...this._failureReasons };
  }

  get lastDegradedAt(): Date | null {
    return this._lastDegradedAt;
  }

  // -------------------------------------------
  // Derived metric
  // -------------------------------------------

  /** Returns the percentage of requests that were degraded (0-100). */
  degradedRate(): number {
    if (this._totalRequests === 0) return 0;
    return (this._degradedRequests / this._totalRequests) * 100;
  }

  // -------------------------------------------
  // Recording methods
  // -------------------------------------------

  /** Record a request that completed successfully on the primary model. */
  recordNormal(): void {
    this._totalRequests++;
  }

  /**
   * Record a request that was served via a fallback/degraded path.
   *
   * @param fallbackModel - The model name that handled the fallback (e.g. "privacy/coding")
   * @param reason        - Human-readable reason the primary model failed
   */
  recordDegraded(fallbackModel: string, reason: string): void {
    this._totalRequests++;
    this._degradedRequests++;
    this._lastDegradedAt = new Date();

    this._fallbacksByModel[fallbackModel] =
      (this._fallbacksByModel[fallbackModel] || 0) + 1;

    this._failureReasons[reason] =
      (this._failureReasons[reason] || 0) + 1;
  }

  // -------------------------------------------
  // Query / lifecycle
  // -------------------------------------------

  /** Return a point-in-time snapshot of all metrics. */
  getMetrics(): DegradedMetrics {
    return {
      totalRequests: this._totalRequests,
      degradedRequests: this._degradedRequests,
      fallbacksByModel: { ...this._fallbacksByModel },
      failureReasons: { ...this._failureReasons },
      lastDegradedAt: this._lastDegradedAt,
      degradedRate: this.degradedRate(),
    };
  }

  /** Reset all counters to zero. Useful for periodic metric windows or tests. */
  reset(): void {
    this._totalRequests = 0;
    this._degradedRequests = 0;
    this._fallbacksByModel = {};
    this._failureReasons = {};
    this._lastDegradedAt = null;
  }
}

// ============================================
// SINGLETON
// ============================================

/** Global singleton for the degraded-mode metrics tracker. */
export const degradedTracker = new DegradedTracker();
