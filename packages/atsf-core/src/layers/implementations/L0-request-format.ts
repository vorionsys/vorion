/**
 * L0 — Request Format Validator
 *
 * Validates that incoming requests conform to the expected structural format
 * before any deeper analysis. Rejects malformed payloads, missing required
 * fields, and structurally invalid inputs at the perimeter.
 *
 * Tier: input_validation
 * Primary threat: prompt_injection
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

// Maximum depth for nested objects to prevent stack overflow / complexity attacks
const MAX_NESTING_DEPTH = 20;

// Maximum number of keys in a single object
const MAX_OBJECT_KEYS = 500;

// Required payload fields for a well-formed request
const REQUIRED_PAYLOAD_FIELDS = ["action", "content"] as const;

/**
 * L0 Request Format Validator
 *
 * First line of defense — ensures every request has the correct shape
 * before any downstream processing.
 */
export class L0RequestFormatValidator extends BaseSecurityLayer {
  constructor() {
    super(
      createLayerConfig(0, "Request Format Validator", {
        description:
          "Validates request structure, required fields, and payload shape",
        tier: "input_validation",
        primaryThreat: "prompt_injection",
        secondaryThreats: ["denial_of_service"],
        failMode: "block",
        required: true,
        timeoutMs: 200,
        parallelizable: true,
        dependencies: [],
      }),
    );
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const findings: LayerFinding[] = [];

    // 1. Validate top-level input fields
    const inputValidation = this.validateInput(input);
    if (!inputValidation.valid) {
      for (const err of inputValidation.errors) {
        findings.push({
          type: "threat_detected",
          severity: "high",
          code: "L0_MISSING_FIELD",
          description: `Missing required field: ${err.field}`,
          evidence: [err.message],
          remediation: `Provide the required field '${err.field}'`,
        });
      }
    }

    // 2. Validate payload is a plain object
    if (input.payload !== null && input.payload !== undefined) {
      if (typeof input.payload !== "object" || Array.isArray(input.payload)) {
        findings.push({
          type: "threat_detected",
          severity: "high",
          code: "L0_INVALID_PAYLOAD_TYPE",
          description:
            "Payload must be a plain object, not an array or primitive",
          evidence: [
            `Received type: ${Array.isArray(input.payload) ? "array" : typeof input.payload}`,
          ],
          remediation: "Provide payload as a plain JSON object",
        });
      } else {
        // 3. Check nesting depth (prevents stack overflow attacks)
        const depth = this.measureDepth(input.payload, 0);
        if (depth > MAX_NESTING_DEPTH) {
          findings.push({
            type: "threat_detected",
            severity: "high",
            code: "L0_EXCESSIVE_NESTING",
            description: `Payload nesting depth ${depth} exceeds maximum ${MAX_NESTING_DEPTH}`,
            evidence: [`depth=${depth}, max=${MAX_NESTING_DEPTH}`],
            remediation: `Flatten payload structure to at most ${MAX_NESTING_DEPTH} levels`,
          });
        }

        // 4. Check key count (prevents resource exhaustion)
        const keyCount = this.countKeys(input.payload);
        if (keyCount > MAX_OBJECT_KEYS) {
          findings.push({
            type: "threat_detected",
            severity: "medium",
            code: "L0_EXCESSIVE_KEYS",
            description: `Payload contains ${keyCount} keys, exceeding maximum ${MAX_OBJECT_KEYS}`,
            evidence: [`keys=${keyCount}, max=${MAX_OBJECT_KEYS}`],
            remediation: "Reduce the number of fields in the payload",
          });
        }

        // 5. Check for required payload fields
        for (const field of REQUIRED_PAYLOAD_FIELDS) {
          if (!(field in input.payload)) {
            findings.push({
              type: "warning",
              severity: "medium",
              code: "L0_MISSING_PAYLOAD_FIELD",
              description: `Payload missing recommended field '${field}'`,
              evidence: [`Field '${field}' not found in payload`],
              remediation: `Include '${field}' in the payload object`,
            });
          }
        }

        // 6. Detect prototype pollution attempts
        const pollutionAttempts = this.detectPrototypePollution(input.payload);
        for (const attempt of pollutionAttempts) {
          findings.push({
            type: "threat_detected",
            severity: "critical",
            code: "L0_PROTOTYPE_POLLUTION",
            description: `Prototype pollution attempt detected via key '${attempt}'`,
            evidence: [`Dangerous key: ${attempt}`],
            remediation:
              "Remove __proto__, constructor, and prototype keys from payload",
          });
        }
      }
    }

    // 7. Validate metadata if present
    if (input.metadata) {
      if (!input.metadata.requestTimestamp) {
        findings.push({
          type: "warning",
          severity: "low",
          code: "L0_MISSING_TIMESTAMP",
          description: "Request metadata missing timestamp",
          evidence: ["metadata.requestTimestamp is empty"],
        });
      }
      if (!input.metadata.source) {
        findings.push({
          type: "warning",
          severity: "low",
          code: "L0_MISSING_SOURCE",
          description: "Request metadata missing source identifier",
          evidence: ["metadata.source is empty"],
        });
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = performance.now() - t0;
    const timing: LayerTiming = {
      startedAt,
      completedAt,
      durationMs,
      waitTimeMs: 0,
      processingTimeMs: durationMs,
    };

    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasHigh = findings.some((f) => f.severity === "high");
    const passed = !hasCritical && !hasHigh;

    if (passed) {
      return this.createSuccessResult("allow", 0.95, findings, [], timing);
    }

    return this.createFailureResult(
      hasCritical ? "deny" : "escalate",
      0.9,
      findings,
      timing,
    );
  }

  /**
   * Measure nesting depth of an object, with early bail-out.
   */
  private measureDepth(obj: unknown, current: number): number {
    if (current > MAX_NESTING_DEPTH) return current; // bail out early
    if (obj === null || typeof obj !== "object") return current;

    let max = current;
    const entries = Object.values(obj as Record<string, unknown>);
    for (const val of entries) {
      if (val !== null && typeof val === "object") {
        const d = this.measureDepth(val, current + 1);
        if (d > max) max = d;
        if (max > MAX_NESTING_DEPTH) return max; // bail
      }
    }
    return max;
  }

  /**
   * Count total keys across all levels of an object.
   */
  private countKeys(obj: Record<string, unknown>): number {
    let count = Object.keys(obj).length;
    for (const val of Object.values(obj)) {
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        count += this.countKeys(val as Record<string, unknown>);
        if (count > MAX_OBJECT_KEYS) return count; // bail early
      }
    }
    return count;
  }

  /**
   * Detect prototype pollution attempts (__proto__, constructor, prototype).
   */
  private detectPrototypePollution(obj: Record<string, unknown>): string[] {
    const dangerous = ["__proto__", "constructor", "prototype"];
    const found: string[] = [];

    const check = (o: Record<string, unknown>, path: string) => {
      for (const key of Object.keys(o)) {
        if (dangerous.includes(key)) {
          found.push(path ? `${path}.${key}` : key);
        }
        const val = o[key];
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
          check(val as Record<string, unknown>, path ? `${path}.${key}` : key);
        }
      }
    };

    check(obj, "");
    return found;
  }
}
