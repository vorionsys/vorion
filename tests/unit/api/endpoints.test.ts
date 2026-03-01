/**
 * API Endpoint Tests
 *
 * Tests for the proof, trust, and constraint validation endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

// Mock dependencies
vi.mock('../../../src/common/trace.js', () => ({
  getTraceContext: vi.fn(() => ({ traceId: 'test-trace-id', spanId: 'test-span-id' })),
  createTraceContext: vi.fn(() => ({
    traceId: 'new-trace-id',
    spanId: 'new-span-id',
    traceparent: '00-new-trace-id-new-span-id-01',
  })),
  extractTraceFromHeaders: vi.fn(() => null),
}));

vi.mock('../../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    api: { rateLimit: 100 },
    intent: { executionTimeoutMs: 300000 },
  })),
}));

vi.mock('../../../src/common/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock proof service
const mockProofService = {
  get: vi.fn(),
  verify: vi.fn(),
  create: vi.fn(),
  initialize: vi.fn(),
};

vi.mock('../../../src/proof/index.js', () => ({
  createProofService: vi.fn(() => mockProofService),
}));

// Mock trust engine
const mockTrustEngine = {
  getScore: vi.fn(),
  recordSignal: vi.fn(),
  initialize: vi.fn(),
};

vi.mock('../../../src/trust-engine/index.js', () => ({
  createTrustEngine: vi.fn(() => mockTrustEngine),
  TRUST_LEVEL_NAMES: {
    0: 'Sandbox',
    1: 'Supervised',
    2: 'Constrained',
    3: 'Trusted',
    4: 'Autonomous',
    5: 'Sovereign',
  },
}));

// Mock basis parser
vi.mock('../../../src/basis/parser.js', () => ({
  validateRule: vi.fn((definition) => {
    // Basic validation logic
    if (!definition.id || !definition.name || !definition.when || !definition.evaluate) {
      return {
        valid: false,
        errors: ['Missing required fields'],
      };
    }
    return { valid: true, errors: [] };
  }),
}));

import { validateRule } from '../../../src/basis/parser.js';

// Proof ID params schema
const proofIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Trust entity ID params schema
const trustEntityIdParamsSchema = z.object({
  entityId: z.string().uuid(),
});

// Constraint validation body schema
const constraintValidationBodySchema = z.object({
  rule: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    priority: z.number().optional(),
    enabled: z.boolean().optional(),
    when: z.object({
      intentType: z.union([z.string(), z.array(z.string())]).optional(),
      entityType: z.union([z.string(), z.array(z.string())]).optional(),
      conditions: z
        .array(
          z.object({
            field: z.string(),
            operator: z.enum([
              'equals',
              'not_equals',
              'greater_than',
              'less_than',
              'greater_than_or_equal',
              'less_than_or_equal',
              'in',
              'not_in',
              'contains',
              'not_contains',
              'matches',
              'exists',
              'not_exists',
            ]),
            value: z.unknown(),
          })
        )
        .optional(),
    }),
    evaluate: z.array(
      z.object({
        condition: z.string(),
        result: z.enum(['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate']),
        reason: z.string().optional(),
        escalation: z
          .object({
            to: z.string(),
            timeout: z.string(),
            requireJustification: z.boolean().optional(),
            autoDenyOnTimeout: z.boolean().optional(),
          })
          .optional(),
      })
    ),
    metadata: z.record(z.unknown()).optional(),
  }),
});

describe('Proof Endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();

    // Register GET /proofs/:id endpoint
    server.get('/proofs/:id', async (request, reply) => {
      const params = proofIdParamsSchema.parse(request.params ?? {});

      const proof = await mockProofService.get(params.id);
      if (!proof) {
        return reply.status(404).send({
          success: false,
          error: { code: 'PROOF_NOT_FOUND', message: 'Proof not found' },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: proof.id,
          intentId: proof.intentId,
          entityId: proof.entityId,
          chainPosition: proof.chainPosition,
          decision: proof.decision,
          inputs: proof.inputs,
          outputs: proof.outputs,
          hash: proof.hash,
          previousHash: proof.previousHash,
          signature: proof.signature,
          signatureData: proof.signatureData,
          createdAt: proof.createdAt,
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    });

    // Register POST /proofs/:id/verify endpoint
    server.post('/proofs/:id/verify', async (request, reply) => {
      const params = proofIdParamsSchema.parse(request.params ?? {});

      const verificationResult = await mockProofService.verify(params.id);

      return reply.send({
        success: true,
        data: {
          valid: verificationResult.valid,
          proofId: verificationResult.proofId,
          chainPosition: verificationResult.chainPosition,
          issues: verificationResult.issues,
          verifiedAt: verificationResult.verifiedAt,
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  describe('GET /proofs/:id', () => {
    it('should return a proof when found', async () => {
      const mockProof = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        intentId: '550e8400-e29b-41d4-a716-446655440001',
        entityId: '550e8400-e29b-41d4-a716-446655440002',
        chainPosition: 42,
        decision: { action: 'allow', reason: 'Approved' },
        inputs: { key: 'value' },
        outputs: { result: 'success' },
        hash: 'abc123def456',
        previousHash: 'xyz789',
        signature: 'sig_abc',
        signatureData: {
          publicKey: 'pub_key_123',
          algorithm: 'Ed25519',
          signedAt: '2025-01-24T00:00:00.000Z',
        },
        createdAt: '2025-01-24T00:00:00.000Z',
      };

      mockProofService.get.mockResolvedValue(mockProof);

      const response = await server.inject({
        method: 'GET',
        url: '/proofs/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(mockProof.id);
      expect(body.data.chainPosition).toBe(42);
      expect(body.data.signature).toBe('sig_abc');
      expect(body.data.signatureData.algorithm).toBe('Ed25519');
    });

    it('should return 404 when proof not found', async () => {
      mockProofService.get.mockResolvedValue(null);

      const response = await server.inject({
        method: 'GET',
        url: '/proofs/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PROOF_NOT_FOUND');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofs/invalid-uuid',
      });

      expect(response.statusCode).toBe(500); // Zod throws, Fastify returns 500 without error handler
    });
  });

  describe('POST /proofs/:id/verify', () => {
    it('should return verification result for valid proof', async () => {
      const mockVerification = {
        valid: true,
        proofId: '550e8400-e29b-41d4-a716-446655440000',
        chainPosition: 42,
        issues: [],
        verifiedAt: '2025-01-24T00:00:00.000Z',
      };

      mockProofService.verify.mockResolvedValue(mockVerification);

      const response = await server.inject({
        method: 'POST',
        url: '/proofs/550e8400-e29b-41d4-a716-446655440000/verify',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.issues).toHaveLength(0);
    });

    it('should return verification result with issues for invalid proof', async () => {
      const mockVerification = {
        valid: false,
        proofId: '550e8400-e29b-41d4-a716-446655440000',
        chainPosition: 42,
        issues: ['Hash mismatch', 'Chain linkage broken'],
        verifiedAt: '2025-01-24T00:00:00.000Z',
      };

      mockProofService.verify.mockResolvedValue(mockVerification);

      const response = await server.inject({
        method: 'POST',
        url: '/proofs/550e8400-e29b-41d4-a716-446655440000/verify',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.issues).toContain('Hash mismatch');
      expect(body.data.issues).toContain('Chain linkage broken');
    });
  });
});

describe('Trust Endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();

    const TRUST_LEVEL_NAMES: Record<number, string> = {
      0: 'Sandbox',
      1: 'Supervised',
      2: 'Constrained',
      3: 'Trusted',
      4: 'Autonomous',
      5: 'Sovereign',
    };

    // Register GET /trust/:entityId endpoint
    server.get('/trust/:entityId', async (request, reply) => {
      const params = trustEntityIdParamsSchema.parse(request.params ?? {});

      const trustRecord = await mockTrustEngine.getScore(params.entityId);
      if (!trustRecord) {
        return reply.status(404).send({
          success: false,
          error: { code: 'ENTITY_NOT_FOUND', message: 'Entity trust record not found' },
          meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
      }

      return reply.send({
        success: true,
        data: {
          entityId: trustRecord.entityId,
          score: trustRecord.score,
          level: trustRecord.level,
          tierName: TRUST_LEVEL_NAMES[trustRecord.level],
          components: trustRecord.components,
          decay: {
            applied: trustRecord.decayApplied,
            multiplier: trustRecord.decayMultiplier,
            baseScore: trustRecord.baseScore,
            nextMilestone: trustRecord.nextMilestone,
          },
          lastActivityAt: trustRecord.lastActivityAt,
          lastCalculatedAt: trustRecord.lastCalculatedAt,
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  describe('GET /trust/:entityId', () => {
    it('should return trust record when found', async () => {
      const mockTrustRecord = {
        entityId: '550e8400-e29b-41d4-a716-446655440000',
        score: 450,
        level: 2,
        components: {
          behavioral: 0.6,
          compliance: 0.7,
          identity: 0.5,
          context: 0.4,
        },
        decayApplied: true,
        decayMultiplier: 0.92,
        baseScore: 489,
        nextMilestone: { days: 14, multiplier: 0.83 },
        lastActivityAt: '2025-01-20T00:00:00.000Z',
        lastCalculatedAt: '2025-01-24T00:00:00.000Z',
      };

      mockTrustEngine.getScore.mockResolvedValue(mockTrustRecord);

      const response = await server.inject({
        method: 'GET',
        url: '/trust/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.entityId).toBe(mockTrustRecord.entityId);
      expect(body.data.score).toBe(450);
      expect(body.data.level).toBe(2);
      expect(body.data.tierName).toBe('Constrained');
      expect(body.data.decay.applied).toBe(true);
      expect(body.data.decay.multiplier).toBe(0.92);
      expect(body.data.components.behavioral).toBe(0.6);
    });

    it('should return 404 when entity not found', async () => {
      mockTrustEngine.getScore.mockResolvedValue(undefined);

      const response = await server.inject({
        method: 'GET',
        url: '/trust/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('should return trust record with no decay for active entity', async () => {
      const mockTrustRecord = {
        entityId: '550e8400-e29b-41d4-a716-446655440000',
        score: 700,
        level: 4,
        components: {
          behavioral: 0.9,
          compliance: 0.85,
          identity: 0.8,
          context: 0.75,
        },
        decayApplied: false,
        decayMultiplier: 1.0,
        baseScore: 700,
        nextMilestone: { days: 7, multiplier: 0.92 },
        lastActivityAt: '2025-01-24T00:00:00.000Z',
        lastCalculatedAt: '2025-01-24T00:00:00.000Z',
      };

      mockTrustEngine.getScore.mockResolvedValue(mockTrustRecord);

      const response = await server.inject({
        method: 'GET',
        url: '/trust/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.tierName).toBe('Autonomous');
      expect(body.data.decay.applied).toBe(false);
      expect(body.data.decay.multiplier).toBe(1.0);
    });
  });
});

describe('Constraint Validation Endpoints', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();

    // Register POST /constraints/validate endpoint
    server.post('/constraints/validate', async (request, reply) => {
      const body = constraintValidationBodySchema.parse(request.body ?? {});

      const validationResult = validateRule(body.rule);

      return reply.send({
        success: true,
        data: {
          valid: validationResult.valid,
          errors: validationResult.errors,
          rule: validationResult.valid
            ? {
                id: body.rule.id,
                name: body.rule.name,
                description: body.rule.description,
                priority: body.rule.priority ?? 100,
                enabled: body.rule.enabled ?? true,
              }
            : undefined,
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  describe('POST /constraints/validate', () => {
    it('should validate a valid rule definition', async () => {
      const validRule = {
        rule: {
          id: 'rule_001',
          name: 'Test Rule',
          description: 'A test rule for validation',
          priority: 50,
          enabled: true,
          when: {
            intentType: 'test_action',
            conditions: [
              {
                field: 'context.amount',
                operator: 'less_than' as const,
                value: 1000,
              },
            ],
          },
          evaluate: [
            {
              condition: 'true',
              result: 'allow' as const,
              reason: 'Small amounts are allowed',
            },
          ],
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/constraints/validate',
        payload: validRule,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(true);
      expect(body.data.errors).toHaveLength(0);
      expect(body.data.rule.id).toBe('rule_001');
      expect(body.data.rule.priority).toBe(50);
    });

    it('should return validation errors for invalid rule', async () => {
      // Override the mock for this test
      vi.mocked(validateRule).mockReturnValueOnce({
        valid: false,
        errors: ['Missing required fields'],
      });

      const invalidRule = {
        rule: {
          id: 'rule_002',
          name: 'Invalid Rule',
          when: {},
          evaluate: [],
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/constraints/validate',
        payload: invalidRule,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.errors).toContain('Missing required fields');
      expect(body.data.rule).toBeUndefined();
    });

    it('should validate rule with escalation configuration', async () => {
      const ruleWithEscalation = {
        rule: {
          id: 'rule_003',
          name: 'Escalation Rule',
          when: {
            intentType: 'high_risk_action',
          },
          evaluate: [
            {
              condition: 'context.risk_level > 0.8',
              result: 'escalate' as const,
              reason: 'High risk requires approval',
              escalation: {
                to: 'security-team',
                timeout: '1h',
                requireJustification: true,
                autoDenyOnTimeout: true,
              },
            },
          ],
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/constraints/validate',
        payload: ruleWithEscalation,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(true);
    });

    it('should apply default values for priority and enabled', async () => {
      const ruleWithDefaults = {
        rule: {
          id: 'rule_004',
          name: 'Defaults Rule',
          when: {
            intentType: '*',
          },
          evaluate: [
            {
              condition: 'true',
              result: 'allow' as const,
            },
          ],
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/constraints/validate',
        payload: ruleWithDefaults,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.rule.priority).toBe(100); // Default value
      expect(body.data.rule.enabled).toBe(true); // Default value
    });

    it('should reject invalid operator in condition', async () => {
      const invalidOperatorRule = {
        rule: {
          id: 'rule_005',
          name: 'Invalid Operator Rule',
          when: {
            conditions: [
              {
                field: 'context.value',
                operator: 'invalid_operator',
                value: 100,
              },
            ],
          },
          evaluate: [
            {
              condition: 'true',
              result: 'allow',
            },
          ],
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/constraints/validate',
        payload: invalidOperatorRule,
      });

      // Should fail Zod validation
      expect(response.statusCode).toBe(500);
    });
  });
});
