/**
 * L3 — Schema Conformance Validator
 *
 * Validates that payload content conforms to expected action schemas.
 * Rejects payloads with unknown actions, invalid field types, and
 * structurally non-conforming data.
 *
 * Tier: input_validation
 * Primary threat: unauthorized_action
 *
 * @packageDocumentation
 */

import { BaseSecurityLayer, createLayerConfig } from '../index.js';
import type { LayerInput, LayerExecutionResult, LayerFinding, LayerTiming } from '../types.js';

/**
 * Schema definition for a known action
 */
export interface ActionSchema {
  /** Action name */
  action: string;
  /** Required fields with their expected types */
  required: Record<string, FieldType>;
  /** Optional fields with their expected types */
  optional?: Record<string, FieldType>;
  /** Maximum number of extra fields allowed beyond defined ones */
  maxExtraFields?: number;
}

type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'string[]' | 'number[]';

/**
 * Built-in action schemas for the ATSF governance pipeline
 */
const KNOWN_ACTION_SCHEMAS: ActionSchema[] = [
  {
    action: 'query',
    required: { content: 'string' },
    optional: { context: 'object', model: 'string', temperature: 'number', maxTokens: 'number' },
    maxExtraFields: 10,
  },
  {
    action: 'execute',
    required: { content: 'string', target: 'string' },
    optional: { args: 'object', timeout: 'number', dryRun: 'boolean' },
    maxExtraFields: 5,
  },
  {
    action: 'read',
    required: { content: 'string', resource: 'string' },
    optional: { format: 'string', limit: 'number', offset: 'number' },
    maxExtraFields: 5,
  },
  {
    action: 'write',
    required: { content: 'string', resource: 'string', data: 'object' },
    optional: { overwrite: 'boolean', format: 'string' },
    maxExtraFields: 5,
  },
  {
    action: 'delete',
    required: { content: 'string', resource: 'string' },
    optional: { recursive: 'boolean', force: 'boolean' },
    maxExtraFields: 3,
  },
  {
    action: 'communicate',
    required: { content: 'string', recipient: 'string' },
    optional: { channel: 'string', priority: 'string', metadata: 'object' },
    maxExtraFields: 5,
  },
];

/**
 * L3 Schema Conformance Validator
 *
 * Validates payloads against known action schemas.
 */
export class L3SchemaConformance extends BaseSecurityLayer {
  private schemas: Map<string, ActionSchema>;

  constructor(additionalSchemas?: ActionSchema[]) {
    super(
      createLayerConfig(3, 'Schema Conformance', {
        description: 'Validates payload action and fields against known schemas',
        tier: 'input_validation',
        primaryThreat: 'unauthorized_action',
        secondaryThreats: ['capability_abuse', 'prompt_injection'],
        failMode: 'block',
        required: true,
        timeoutMs: 200,
        parallelizable: true,
        dependencies: [0], // Depends on L0 passing first
      })
    );

    this.schemas = new Map();
    for (const schema of KNOWN_ACTION_SCHEMAS) {
      this.schemas.set(schema.action, schema);
    }
    if (additionalSchemas) {
      for (const schema of additionalSchemas) {
        this.schemas.set(schema.action, schema);
      }
    }
  }

  /**
   * Register an additional action schema at runtime
   */
  registerSchema(schema: ActionSchema): void {
    this.schemas.set(schema.action, schema);
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const findings: LayerFinding[] = [];

    const payload = input.payload;

    // 1. Check that action field exists
    const action = payload['action'];
    if (action === undefined || action === null) {
      findings.push({
        type: 'threat_detected',
        severity: 'high',
        code: 'L3_MISSING_ACTION',
        description: 'Payload has no "action" field — cannot determine request type',
        evidence: ['payload.action is undefined'],
        remediation: 'Include an "action" field in the payload (e.g., "query", "execute", "read")',
      });

      const timing = this.buildTiming(startedAt, t0);
      return this.createFailureResult('deny', 0.9, findings, timing);
    }

    if (typeof action !== 'string') {
      findings.push({
        type: 'threat_detected',
        severity: 'high',
        code: 'L3_INVALID_ACTION_TYPE',
        description: `Action field must be a string, got ${typeof action}`,
        evidence: [`typeof action = ${typeof action}`],
        remediation: 'Provide action as a string value',
      });

      const timing = this.buildTiming(startedAt, t0);
      return this.createFailureResult('deny', 0.9, findings, timing);
    }

    // 2. Look up schema for this action
    const schema = this.schemas.get(action);
    if (!schema) {
      findings.push({
        type: 'threat_detected',
        severity: 'medium',
        code: 'L3_UNKNOWN_ACTION',
        description: `Unknown action '${action}' — not in registered schemas`,
        evidence: [
          `action=${action}`,
          `known actions: ${Array.from(this.schemas.keys()).join(', ')}`,
        ],
        remediation: `Use a known action: ${Array.from(this.schemas.keys()).join(', ')}`,
      });

      const timing = this.buildTiming(startedAt, t0);
      // Unknown actions are escalated, not denied — allows extension
      return this.createFailureResult('escalate', 0.7, findings, timing);
    }

    // 3. Check required fields
    for (const [field, expectedType] of Object.entries(schema.required)) {
      const value = payload[field];
      if (value === undefined || value === null) {
        findings.push({
          type: 'threat_detected',
          severity: 'high',
          code: 'L3_MISSING_REQUIRED_FIELD',
          description: `Required field '${field}' missing for action '${action}'`,
          evidence: [`field=${field}, action=${action}`],
          remediation: `Include required field '${field}' (type: ${expectedType})`,
        });
        continue;
      }

      // Type check
      const typeError = this.checkType(value, expectedType, field);
      if (typeError) {
        findings.push(typeError);
      }
    }

    // 4. Check optional fields (if present, must match type)
    if (schema.optional) {
      for (const [field, expectedType] of Object.entries(schema.optional)) {
        const value = payload[field];
        if (value === undefined || value === null) continue;

        const typeError = this.checkType(value, expectedType, field);
        if (typeError) {
          findings.push(typeError);
        }
      }
    }

    // 5. Check for unexpected extra fields
    const allKnownFields = new Set([
      'action',
      ...Object.keys(schema.required),
      ...Object.keys(schema.optional ?? {}),
    ]);
    const extraFields = Object.keys(payload).filter((k) => !allKnownFields.has(k));
    const maxExtra = schema.maxExtraFields ?? 10;

    if (extraFields.length > maxExtra) {
      findings.push({
        type: 'warning',
        severity: 'medium',
        code: 'L3_EXCESS_EXTRA_FIELDS',
        description: `${extraFields.length} extra fields exceed maximum ${maxExtra} for action '${action}'`,
        evidence: [`extra fields: ${extraFields.slice(0, 10).join(', ')}${extraFields.length > 10 ? '...' : ''}`],
        remediation: `Reduce extra fields to at most ${maxExtra}`,
      });
    }

    const timing = this.buildTiming(startedAt, t0);
    const hasHigh = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
    const passed = !hasHigh;

    if (passed) {
      return this.createSuccessResult('allow', 0.9, findings, [], timing);
    }

    return this.createFailureResult('deny', 0.85, findings, timing);
  }

  private checkType(value: unknown, expectedType: FieldType, field: string): LayerFinding | null {
    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          return this.typeError(field, expectedType, typeof value);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return this.typeError(field, expectedType, typeof value);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return this.typeError(field, expectedType, typeof value);
        }
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          return this.typeError(field, expectedType, Array.isArray(value) ? 'array' : typeof value);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return this.typeError(field, expectedType, typeof value);
        }
        break;
      case 'string[]':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          return this.typeError(field, expectedType, Array.isArray(value) ? 'mixed array' : typeof value);
        }
        break;
      case 'number[]':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'number')) {
          return this.typeError(field, expectedType, Array.isArray(value) ? 'mixed array' : typeof value);
        }
        break;
    }
    return null;
  }

  private typeError(field: string, expected: string, actual: string): LayerFinding {
    return {
      type: 'threat_detected',
      severity: 'high',
      code: 'L3_TYPE_MISMATCH',
      description: `Field '${field}' expected type '${expected}', got '${actual}'`,
      evidence: [`field=${field}, expected=${expected}, actual=${actual}`],
      remediation: `Provide '${field}' as type '${expected}'`,
    };
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
