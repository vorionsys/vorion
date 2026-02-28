/**
 * L5 — Rate Limiter
 *
 * In-memory sliding window rate limiter that tracks request rates per entity.
 * Enforces configurable requests-per-window limits and detects burst patterns.
 *
 * Tier: input_validation
 * Primary threat: denial_of_service
 *
 * @packageDocumentation
 */

import { BaseSecurityLayer, createLayerConfig } from "../index.js";
import type {
  LayerInput,
  LayerExecutionResult,
  LayerFinding,
  LayerTiming,
  LayerHealthStatus,
} from "../types.js";

/**
 * Rate limit configuration
 */
export interface L5RateLimitConfig {
  /** Maximum requests per window (default: 100) */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60_000 = 1 minute) */
  windowMs: number;
  /** Burst threshold — max requests in 1 second (default: 20) */
  burstThreshold: number;
  /** Maximum number of entities to track before evicting oldest (default: 10,000) */
  maxTrackedEntities: number;
}

const DEFAULT_CONFIG: L5RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000,
  burstThreshold: 20,
  maxTrackedEntities: 10_000,
};

interface EntityWindow {
  /** Sorted timestamps of requests within the current window */
  timestamps: number[];
  /** Total requests ever seen from this entity */
  totalRequests: number;
  /** When this entity was first seen */
  firstSeen: number;
}

/**
 * L5 Rate Limiter
 *
 * Sliding window rate limiter with burst detection.
 */
export class L5RateLimiter extends BaseSecurityLayer {
  private rateLimitConfig: L5RateLimitConfig;
  private windows: Map<string, EntityWindow> = new Map();

  constructor(config?: Partial<L5RateLimitConfig>) {
    super(
      createLayerConfig(5, "Rate Limiter", {
        description:
          "Sliding window rate limiter with burst detection per entity",
        tier: "input_validation",
        primaryThreat: "denial_of_service",
        secondaryThreats: ["resource_abuse"],
        failMode: "block",
        required: true,
        timeoutMs: 100,
        parallelizable: false, // Stateful — must run serially
        dependencies: [],
      }),
    );
    this.rateLimitConfig = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const now = Date.now();
    const findings: LayerFinding[] = [];

    const entityId = input.entityId;

    // Evict oldest entries if at capacity
    if (this.windows.size >= this.rateLimitConfig.maxTrackedEntities) {
      this.evictOldest();
    }

    // Get or create the sliding window for this entity
    let window = this.windows.get(entityId);
    if (!window) {
      window = { timestamps: [], totalRequests: 0, firstSeen: now };
      this.windows.set(entityId, window);
    }

    // Slide the window: remove timestamps older than windowMs
    const cutoff = now - this.rateLimitConfig.windowMs;
    window.timestamps = window.timestamps.filter((ts) => ts > cutoff);

    // Record this request
    window.timestamps.push(now);
    window.totalRequests++;

    const requestsInWindow = window.timestamps.length;

    // 1. Check rate limit
    if (requestsInWindow > this.rateLimitConfig.maxRequests) {
      findings.push({
        type: "threat_detected",
        severity: "high",
        code: "L5_RATE_LIMIT_EXCEEDED",
        description: `Entity '${entityId}' exceeded rate limit: ${requestsInWindow}/${this.rateLimitConfig.maxRequests} requests in ${this.rateLimitConfig.windowMs}ms window`,
        evidence: [
          `requests=${requestsInWindow}`,
          `limit=${this.rateLimitConfig.maxRequests}`,
          `window=${this.rateLimitConfig.windowMs}ms`,
        ],
        remediation: `Reduce request rate to under ${this.rateLimitConfig.maxRequests} per ${this.rateLimitConfig.windowMs / 1000}s`,
      });
    }

    // 2. Check burst (requests in last 1 second)
    const burstCutoff = now - 1000;
    const burstCount = window.timestamps.filter(
      (ts) => ts > burstCutoff,
    ).length;
    if (burstCount > this.rateLimitConfig.burstThreshold) {
      findings.push({
        type: "threat_detected",
        severity: "high",
        code: "L5_BURST_DETECTED",
        description: `Entity '${entityId}' burst detected: ${burstCount} requests in 1 second (threshold: ${this.rateLimitConfig.burstThreshold})`,
        evidence: [
          `burst=${burstCount}`,
          `threshold=${this.rateLimitConfig.burstThreshold}`,
        ],
        remediation: `Reduce burst rate to under ${this.rateLimitConfig.burstThreshold} requests per second`,
      });
    }

    // 3. Check for acceleration pattern (requests speeding up)
    if (window.timestamps.length >= 10) {
      const acceleration = this.detectAcceleration(window.timestamps);
      if (acceleration > 2.0) {
        findings.push({
          type: "warning",
          severity: "medium",
          code: "L5_ACCELERATION_DETECTED",
          description: `Entity '${entityId}' request rate accelerating (${acceleration.toFixed(1)}x over window)`,
          evidence: [
            `acceleration=${acceleration.toFixed(1)}x`,
            `totalRequests=${window.totalRequests}`,
          ],
          remediation: "Maintain a steady request rate",
        });
      }
    }

    const timing = this.buildTiming(startedAt, t0);
    const hasHigh = findings.some(
      (f) => f.severity === "high" || f.severity === "critical",
    );
    const passed = !hasHigh;

    if (passed) {
      return this.createSuccessResult("allow", 0.95, findings, [], timing);
    }

    return this.createFailureResult("limit", 0.9, findings, timing);
  }

  /**
   * Detect if request rate is accelerating.
   * Compares average inter-request time in first half vs second half.
   * Returns ratio > 1 if accelerating.
   */
  private detectAcceleration(timestamps: number[]): number {
    const n = timestamps.length;
    if (n < 4) return 1.0;

    const mid = Math.floor(n / 2);

    // Average gap in first half
    let firstHalfGaps = 0;
    for (let i = 1; i < mid; i++) {
      firstHalfGaps += timestamps[i] - timestamps[i - 1];
    }
    const avgFirstGap = firstHalfGaps / (mid - 1);

    // Average gap in second half
    let secondHalfGaps = 0;
    for (let i = mid + 1; i < n; i++) {
      secondHalfGaps += timestamps[i] - timestamps[i - 1];
    }
    const avgSecondGap = secondHalfGaps / (n - mid - 1);

    if (avgSecondGap === 0) return 10.0; // Effectively instant — maximum acceleration
    return avgFirstGap / avgSecondGap;
  }

  /**
   * Evict the oldest 10% of tracked entities.
   */
  private evictOldest(): void {
    const entries = Array.from(this.windows.entries());
    entries.sort((a, b) => a[1].firstSeen - b[1].firstSeen);

    const evictCount = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < evictCount; i++) {
      this.windows.delete(entries[i][0]);
    }
  }

  override async healthCheck(): Promise<LayerHealthStatus> {
    return {
      healthy: true,
      lastCheck: new Date().toISOString(),
      issues: [],
      metrics: {
        requestsProcessed: Array.from(this.windows.values()).reduce(
          (sum, w) => sum + w.totalRequests,
          0,
        ),
        averageLatencyMs: 0,
        errorRate: 0,
      },
    };
  }

  override async reset(): Promise<void> {
    this.windows.clear();
  }

  private buildTiming(startedAt: string, t0: number): LayerTiming {
    const durationMs = performance.now() - t0;
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      waitTimeMs: 0,
      processingTimeMs: durationMs,
    };
  }
}
