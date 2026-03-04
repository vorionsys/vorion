/**
 * Friction Feedback API Routes
 *
 * REST endpoints for friction feedback system.
 * Implements FR119-FR122 API surface.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
import { createFrictionFeedbackService } from './index.js';
import type { FrictionContext, AgentUnderstandingSignal } from './index.js';

const logger = createLogger({ component: 'friction-routes' });
const frictionService = createFrictionFeedbackService();

// =============================================================================
// Request Schemas
// =============================================================================

const generateFeedbackSchema = z.object({
  intentId: z.string().uuid(),
  agentId: z.string().uuid(),
  decision: z.object({
    intentId: z.string(),
    action: z.enum(['allow', 'deny', 'escalate', 'constrain']),
    constraintsEvaluated: z.array(z.object({
      constraintId: z.string(),
      passed: z.boolean(),
      action: z.string().optional(),
      reason: z.string().optional(),
      details: z.record(z.unknown()).optional(),
      durationMs: z.number().optional(),
      evaluatedAt: z.string().optional(),
    })).optional(),
    trustScore: z.number(),
    trustLevel: z.number(),
    decidedAt: z.string(),
  }),
  action: z.string(),
  category: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

const recordSignalSchema = z.object({
  agentId: z.string().uuid(),
  feedbackId: z.string(),
  type: z.enum(['acknowledged', 'confused', 'retried_same', 'retried_modified', 'escalated', 'abandoned']),
  responseTimeMs: z.number().min(0),
  context: z.record(z.unknown()).optional(),
});

const getSignalsParamsSchema = z.object({
  agentId: z.string().uuid(),
});

const analyzePatternParamsSchema = z.object({
  agentId: z.string().uuid(),
});

// =============================================================================
// Route Registration
// =============================================================================

/**
 * Register friction feedback routes
 */
export async function registerFrictionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/friction/feedback
   *
   * Generate friction feedback for a denied or escalated action.
   * Returns human-readable explanation and actionable next steps.
   */
  app.post<{
    Body: z.infer<typeof generateFeedbackSchema>;
  }>('/api/v1/friction/feedback', async (request, reply) => {
    try {
      const parsed = generateFeedbackSchema.parse(request.body);

      // Get tenant from JWT (authenticated request)
      const tenantId = (request.user as { tenantId?: string })?.tenantId;
      if (!tenantId) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Tenant ID required',
        });
      }

      const context: FrictionContext = {
        intentId: parsed.intentId,
        agentId: parsed.agentId,
        tenantId,
        decision: parsed.decision as FrictionContext['decision'],
        action: parsed.action,
        category: parsed.category,
        parameters: parsed.parameters,
      };

      const feedback = frictionService.generateFeedback(context);

      logger.info(
        { feedbackId: feedback.feedbackId, intentId: parsed.intentId, agentId: parsed.agentId },
        'Friction feedback generated via API'
      );

      return reply.status(200).send(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Failed to generate friction feedback');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to generate friction feedback',
      });
    }
  });

  /**
   * POST /api/v1/friction/signals
   *
   * Record an agent understanding signal.
   * Used to track how agents respond to friction feedback.
   */
  app.post<{
    Body: z.infer<typeof recordSignalSchema>;
  }>('/api/v1/friction/signals', async (request, reply) => {
    try {
      const parsed = recordSignalSchema.parse(request.body);

      const signal = frictionService.recordUnderstandingSignal(
        parsed.agentId,
        parsed.feedbackId,
        parsed.type,
        parsed.responseTimeMs,
        parsed.context
      );

      logger.debug(
        { signalId: signal.signalId, agentId: parsed.agentId, type: parsed.type },
        'Understanding signal recorded via API'
      );

      return reply.status(201).send(signal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Failed to record understanding signal');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to record understanding signal',
      });
    }
  });

  /**
   * GET /api/v1/friction/signals/:agentId
   *
   * Get understanding signals for an agent.
   */
  app.get<{
    Params: z.infer<typeof getSignalsParamsSchema>;
  }>('/api/v1/friction/signals/:agentId', async (request, reply) => {
    try {
      const parsed = getSignalsParamsSchema.parse(request.params);
      const signals = frictionService.getUnderstandingSignals(parsed.agentId);

      return reply.status(200).send({
        agentId: parsed.agentId,
        signals,
        count: signals.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid agent ID',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Failed to get understanding signals');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get understanding signals',
      });
    }
  });

  /**
   * GET /api/v1/friction/analysis/:agentId
   *
   * Analyze understanding patterns for an agent.
   * Returns rates and recommendations for improving communication.
   */
  app.get<{
    Params: z.infer<typeof analyzePatternParamsSchema>;
  }>('/api/v1/friction/analysis/:agentId', async (request, reply) => {
    try {
      const parsed = analyzePatternParamsSchema.parse(request.params);
      const analysis = frictionService.analyzeUnderstandingPatterns(parsed.agentId);

      return reply.status(200).send({
        agentId: parsed.agentId,
        analysis,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid agent ID',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Failed to analyze understanding patterns');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to analyze understanding patterns',
      });
    }
  });

  /**
   * GET /api/v1/friction/decision-options
   *
   * Get available decision options for human reviewers.
   */
  app.get('/api/v1/friction/decision-options', async (_request, reply) => {
    const { REVIEWER_DECISION_OPTIONS } = await import('./index.js');

    return reply.status(200).send({
      options: REVIEWER_DECISION_OPTIONS,
    });
  });

  logger.info('Friction feedback routes registered');
}
