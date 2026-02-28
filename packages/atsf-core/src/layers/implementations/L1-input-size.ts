/**
 * L1 — Input Size Limiter
 *
 * Enforces size constraints on incoming payloads to prevent denial-of-service
 * via oversized inputs, token-flooding, or memory exhaustion attacks.
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
} from "../types.js";

/** Default limits — can be overridden via constructor options */
export interface L1SizeLimits {
  /** Maximum total payload size in bytes (default: 1MB) */
  maxPayloadBytes: number;
  /** Maximum length for any single string value (default: 100KB) */
  maxStringLength: number;
  /** Maximum number of array elements (default: 10,000) */
  maxArrayLength: number;
  /** Maximum total number of fields across the entire payload (default: 1,000) */
  maxTotalFields: number;
}

const DEFAULT_LIMITS: L1SizeLimits = {
  maxPayloadBytes: 1_048_576, // 1 MB
  maxStringLength: 102_400, // 100 KB
  maxArrayLength: 10_000,
  maxTotalFields: 1_000,
};

/**
 * L1 Input Size Limiter
 *
 * Catches oversized payloads before they consume downstream resources.
 */
export class L1InputSizeLimiter extends BaseSecurityLayer {
  private limits: L1SizeLimits;

  constructor(limits?: Partial<L1SizeLimits>) {
    super(
      createLayerConfig(1, "Input Size Limiter", {
        description:
          "Enforces payload size, string length, array length, and total field count limits",
        tier: "input_validation",
        primaryThreat: "denial_of_service",
        secondaryThreats: ["resource_abuse"],
        failMode: "block",
        required: true,
        timeoutMs: 200,
        parallelizable: true,
        dependencies: [],
      }),
    );
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const findings: LayerFinding[] = [];

    const payload = input.payload;

    // 1. Total payload size (JSON serialization byte count)
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      const timing = this.buildTiming(startedAt, t0);
      return this.createFailureResult(
        "deny",
        0.95,
        [
          {
            type: "threat_detected",
            severity: "high",
            code: "L1_UNSERIALIZABLE",
            description:
              "Payload cannot be serialized to JSON — possible circular reference or exotic object",
            evidence: ["JSON.stringify failed"],
            remediation: "Ensure payload is a plain, serializable JSON object",
          },
        ],
        timing,
      );
    }

    const payloadBytes = new TextEncoder().encode(serialized).length;
    if (payloadBytes > this.limits.maxPayloadBytes) {
      findings.push({
        type: "threat_detected",
        severity: "high",
        code: "L1_PAYLOAD_TOO_LARGE",
        description: `Payload size ${payloadBytes} bytes exceeds limit of ${this.limits.maxPayloadBytes} bytes`,
        evidence: [
          `size=${payloadBytes}, limit=${this.limits.maxPayloadBytes}`,
        ],
        remediation: `Reduce payload size to under ${this.limits.maxPayloadBytes} bytes`,
      });
    }

    // 2. Walk the object checking strings, arrays, and field count
    let totalFields = 0;
    const violations: LayerFinding[] = [];

    const walk = (obj: unknown, path: string): void => {
      if (obj === null || obj === undefined) return;

      if (typeof obj === "string") {
        if (obj.length > this.limits.maxStringLength) {
          violations.push({
            type: "threat_detected",
            severity: "high",
            code: "L1_STRING_TOO_LONG",
            description: `String at '${path}' is ${obj.length} chars, exceeding limit of ${this.limits.maxStringLength}`,
            evidence: [
              `path=${path}, length=${obj.length}, limit=${this.limits.maxStringLength}`,
            ],
            remediation: `Shorten the string at '${path}'`,
          });
        }
        return;
      }

      if (Array.isArray(obj)) {
        if (obj.length > this.limits.maxArrayLength) {
          violations.push({
            type: "threat_detected",
            severity: "high",
            code: "L1_ARRAY_TOO_LONG",
            description: `Array at '${path}' has ${obj.length} elements, exceeding limit of ${this.limits.maxArrayLength}`,
            evidence: [
              `path=${path}, length=${obj.length}, limit=${this.limits.maxArrayLength}`,
            ],
            remediation: `Reduce array size at '${path}'`,
          });
        }
        // Walk array items (sample first N to avoid excessive traversal)
        const sampleSize = Math.min(obj.length, 100);
        for (let i = 0; i < sampleSize; i++) {
          walk(obj[i], `${path}[${i}]`);
        }
        return;
      }

      if (typeof obj === "object") {
        const keys = Object.keys(obj as Record<string, unknown>);
        totalFields += keys.length;

        if (totalFields > this.limits.maxTotalFields) {
          violations.push({
            type: "threat_detected",
            severity: "medium",
            code: "L1_TOO_MANY_FIELDS",
            description: `Total field count ${totalFields} exceeds limit of ${this.limits.maxTotalFields}`,
            evidence: [
              `totalFields=${totalFields}, limit=${this.limits.maxTotalFields}`,
            ],
            remediation: "Reduce the number of fields in the payload",
          });
          return; // stop walking
        }

        for (const key of keys) {
          walk(
            (obj as Record<string, unknown>)[key],
            path ? `${path}.${key}` : key,
          );
        }
      }
    };

    walk(payload, "");
    findings.push(...violations);

    const timing = this.buildTiming(startedAt, t0);
    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasHigh = findings.some((f) => f.severity === "high");
    const passed = !hasCritical && !hasHigh;

    if (passed) {
      return this.createSuccessResult("allow", 0.95, findings, [], timing);
    }

    return this.createFailureResult("deny", 0.9, findings, timing);
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
