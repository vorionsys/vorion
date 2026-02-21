/**
 * Intent Processing Routes
 *
 * Wired to actual IntentPipeline from runtime context.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getContext } from '../context.js';
import {
  NOT_FOUND_ERRORS,
  createErrorResponse,
} from '@vorionsys/shared-constants';

// In-memory store for intent history (proofs are in ProofCommitter)
const intentHistory = new Map<string, {
  intentId: string;
  agentId: string;
  action: { type: string; resource: string; parameters?: Record<string, unknown> };
  status: 'approved' | 'denied';
  tier: string;
  reason: string;
  proofId: string;
  submittedAt: string;
  processingTimeMs: number;
}>();

interface SubmitIntentBody {
  agentId: string;
  agentName?: string;
  capabilities?: string[];
  observationTier?: 'BLACK_BOX' | 'GRAY_BOX' | 'WHITE_BOX';
  action: { type: string; resource: string; parameters?: Record<string, unknown> };
}

interface IntentParams {
  intentId: string;
}

interface AgentParams {
  agentId: string;
}

interface ListQuery {
  limit?: number;
  status?: string;
}

export async function intentRoutes(server: FastifyInstance): Promise<void> {
  // Submit an intent - wired to IntentPipeline
  server.post('/', async (request: FastifyRequest<{ Body: SubmitIntentBody }>) => {
    const { intentPipeline } = getContext();
    const body = request.body;

    // Build agent credentials
    const agentCredentials = {
      agentId: body.agentId,
      name: body.agentName ?? body.agentId,
      capabilities: body.capabilities ?? ['*'], // Default to wildcard if not specified
      observationTier: body.observationTier ?? 'GRAY_BOX' as const,
    };

    // Build action
    const action = {
      type: body.action.type,
      resource: body.action.resource,
      parameters: body.action.parameters ?? {},
    };

    // Submit through the pipeline
    const result = await intentPipeline.submit(agentCredentials, action);

    // Store in history
    intentHistory.set(result.intentId, {
      intentId: result.intentId,
      agentId: body.agentId,
      action: body.action,
      status: result.allowed ? 'approved' : 'denied',
      tier: result.tier,
      reason: result.reason,
      proofId: result.commitmentId,
      submittedAt: new Date().toISOString(),
      processingTimeMs: result.processingTimeMs,
    });

    return {
      intentId: result.intentId,
      allowed: result.allowed,
      tier: result.tier,
      reason: result.reason,
      proofId: result.commitmentId,
      constraints: result.constraints,
      processingTimeMs: result.processingTimeMs,
    };
  });

  // Get intent by ID
  server.get('/:intentId', async (
    request: FastifyRequest<{ Params: IntentParams }>,
    reply: FastifyReply
  ) => {
    const { intentId } = request.params;

    const intent = intentHistory.get(intentId);
    if (!intent) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.RESOURCE_NOT_FOUND, {
        resourceType: 'intent',
        resourceId: intentId,
      });
      return reply.status(errResp.status).send(errResp.error);
    }

    return intent;
  });

  // List intents for an agent
  server.get('/agent/:agentId', async (
    request: FastifyRequest<{ Params: AgentParams; Querystring: ListQuery }>
  ) => {
    const { agentId } = request.params;
    const { limit = 50, status } = request.query;

    let results = Array.from(intentHistory.values())
      .filter((i) => i.agentId === agentId);

    if (status) {
      results = results.filter((i) => i.status === status);
    }

    return results.slice(0, limit);
  });

  // Check authorization (dry run) - wired to IntentPipeline
  server.post('/check', async (request: FastifyRequest<{ Body: SubmitIntentBody }>) => {
    const { intentPipeline } = getContext();
    const body = request.body;

    const agentCredentials = {
      agentId: body.agentId,
      name: body.agentName ?? body.agentId,
      capabilities: body.capabilities ?? ['*'],
      observationTier: body.observationTier ?? 'GRAY_BOX' as const,
    };

    const action = {
      type: body.action.type,
      resource: body.action.resource,
      parameters: body.action.parameters ?? {},
    };

    const result = await intentPipeline.check(agentCredentials, action);

    return {
      wouldAllow: result.allowed,
      tier: result.tier,
      reason: result.reason,
    };
  });

  // Get pipeline metrics
  server.get('/metrics', async () => {
    const { intentPipeline } = getContext();
    return intentPipeline.getMetrics();
  });
}
