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
  priority?: number;
  // Classification fields
  actionType?: string;
  dataSensitivity?: string;
  reversibility?: string;
  resourceScope?: string[];
  tenantId?: string;
  correlationId?: string;
  source?: string;
}>();

interface SubmitIntentBody {
  agentId: string;
  agentName?: string;
  capabilities?: string[];
  observationTier?: 'BLACK_BOX' | 'GRAY_BOX' | 'WHITE_BOX';
  action: { type: string; resource: string; parameters?: Record<string, unknown> };
  // Canonical classification fields (optional, with smart defaults)
  tenantId?: string;
  correlationId?: string;
  actionType?: 'read' | 'write' | 'delete' | 'execute' | 'communicate' | 'transfer';
  resourceScope?: string[];
  dataSensitivity?: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  reversibility?: 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';
  context?: {
    domain?: string;
    environment?: string;
    sessionId?: string;
    priority?: number;
    handlesPii?: boolean;
    handlesPhiData?: boolean;
    [key: string]: unknown;
  };
  expiresInMs?: number;
  source?: string;
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

/** Infer canonical actionType from action.type string */
function inferActionType(actionType: string): string {
  const lower = actionType.toLowerCase();
  if (lower.includes('read') || lower.includes('get') || lower.includes('list') || lower.includes('fetch')) return 'read';
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('drop')) return 'delete';
  if (lower.includes('execute') || lower.includes('run') || lower.includes('invoke')) return 'execute';
  if (lower.includes('send') || lower.includes('notify') || lower.includes('email')) return 'communicate';
  if (lower.includes('transfer') || lower.includes('move') || lower.includes('migrate')) return 'transfer';
  return 'write'; // Default for create, update, put, patch, etc.
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

    // Build action with canonical classification forwarding
    const action = {
      type: body.action.type,
      resource: body.action.resource,
      parameters: {
        ...body.action.parameters,
        // Classification metadata for enforcement
        __classification: {
          actionType: body.actionType ?? inferActionType(body.action.type),
          dataSensitivity: body.dataSensitivity ?? 'INTERNAL',
          reversibility: body.reversibility ?? 'REVERSIBLE',
          resourceScope: body.resourceScope ?? [body.action.resource],
          handlesPii: body.context?.handlesPii ?? false,
          handlesPhiData: body.context?.handlesPhiData ?? false,
        },
      },
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
      // Classification
      actionType: body.actionType ?? inferActionType(body.action.type),
      dataSensitivity: body.dataSensitivity ?? 'INTERNAL',
      reversibility: body.reversibility ?? 'REVERSIBLE',
      resourceScope: body.resourceScope ?? [body.action.resource],
      tenantId: body.tenantId,
      correlationId: body.correlationId,
      source: body.source,
    });

    return {
      intentId: result.intentId,
      allowed: result.allowed,
      tier: result.tier,
      reason: result.reason,
      proofId: result.commitmentId,
      constraints: result.constraints,
      processingTimeMs: result.processingTimeMs,
      classification: {
        actionType: body.actionType ?? inferActionType(body.action.type),
        dataSensitivity: body.dataSensitivity ?? 'INTERNAL',
        reversibility: body.reversibility ?? 'REVERSIBLE',
        resourceScope: body.resourceScope ?? [body.action.resource],
      },
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
      parameters: {
        ...body.action.parameters,
        __classification: {
          actionType: body.actionType ?? inferActionType(body.action.type),
          dataSensitivity: body.dataSensitivity ?? 'INTERNAL',
          reversibility: body.reversibility ?? 'REVERSIBLE',
          resourceScope: body.resourceScope ?? [body.action.resource],
          handlesPii: body.context?.handlesPii ?? false,
          handlesPhiData: body.context?.handlesPhiData ?? false,
        },
      },
    };

    const result = await intentPipeline.check(agentCredentials, action);

    return {
      wouldAllow: result.allowed,
      tier: result.tier,
      reason: result.reason,
      classification: {
        actionType: body.actionType ?? inferActionType(body.action.type),
        dataSensitivity: body.dataSensitivity ?? 'INTERNAL',
        reversibility: body.reversibility ?? 'REVERSIBLE',
        resourceScope: body.resourceScope ?? [body.action.resource],
      },
    };
  });

  // Get pipeline metrics
  server.get('/metrics', async () => {
    const { intentPipeline } = getContext();
    return intentPipeline.getMetrics();
  });

  // Cancel an intent
  server.delete('/:intentId', async (
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

    if (intent.status !== 'approved') {
      return reply.status(409).send({
        error: 'INTENT_NOT_CANCELLABLE',
        message: `Intent in '${intent.status}' status cannot be cancelled`,
      });
    }

    intent.status = 'denied';
    return { intentId, status: 'cancelled' };
  });

  // Update intent priority
  server.patch('/:intentId', async (
    request: FastifyRequest<{
      Params: IntentParams;
      Body: { priority?: number; metadata?: Record<string, unknown> };
    }>,
    reply: FastifyReply
  ) => {
    const { intentId } = request.params;
    const body = request.body;

    const intent = intentHistory.get(intentId);
    if (!intent) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.RESOURCE_NOT_FOUND, {
        resourceType: 'intent',
        resourceId: intentId,
      });
      return reply.status(errResp.status).send(errResp.error);
    }

    if (body.priority !== undefined) {
      (intent as Record<string, unknown>).priority = body.priority;
    }

    return intent;
  });
}
