/**
 * API v1 Constraint Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { validateRule } from '../../basis/parser.js';

const constraintLogger = createLogger({ component: 'api-v1-constraints' });

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
      conditions: z.array(z.object({
        field: z.string(),
        operator: z.enum([
          'equals', 'not_equals', 'greater_than', 'less_than',
          'greater_than_or_equal', 'less_than_or_equal',
          'in', 'not_in', 'contains', 'not_contains',
          'matches', 'exists', 'not_exists',
        ]),
        value: z.unknown(),
      })).optional(),
    }),
    evaluate: z.array(z.object({
      condition: z.string(),
      result: z.enum(['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate']),
      reason: z.string().optional(),
      escalation: z.object({
        to: z.string(),
        timeout: z.string(),
        requireJustification: z.boolean().optional(),
        autoDenyOnTimeout: z.boolean().optional(),
      }).optional(),
    })),
    metadata: z.record(z.unknown()).optional(),
  }),
});

/**
 * Register v1 constraint routes
 */
export async function registerConstraintRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Validate constraint rule
  fastify.post('/constraints/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = constraintValidationBodySchema.parse(request.body ?? {});

    const validationResult = validateRule(body.rule);

    return reply.send({
      success: true,
      data: {
        valid: validationResult.valid,
        errors: validationResult.errors,
        rule: validationResult.valid ? {
          id: body.rule.id,
          name: body.rule.name,
          description: body.rule.description,
          priority: body.rule.priority ?? 100,
          enabled: body.rule.enabled ?? true,
        } : undefined,
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  constraintLogger.debug('Constraint routes registered');
}
