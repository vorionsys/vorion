/**
 * A2A API Routes
 *
 * REST API endpoints for agent-to-agent communication.
 * Provides invoke, discovery, and chain visualization endpoints.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createLogger } from '../common/logger.js';
import {
  type A2AInvokeRequest,
  type A2AInvokeResponse,
  type InvokePayload,
  type ResponsePayload,
  type TrustContext,
  type AgentEndpoint,
  type AgentAction,
  DEFAULT_A2A_TIMEOUT_MS,
} from './types.js';
import { getA2ARouter } from './router.js';
import { getTrustNegotiationService } from './trust-negotiation.js';
import { getChainOfTrustService } from './chain-of-trust.js';
import { getA2AAttestationService } from './attestation.js';

const logger = createLogger({ component: 'a2a-routes' });

// ============================================================================
// Request Schemas
// ============================================================================

const invokeRequestSchema = z.object({
  targetCarId: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  timeoutMs: z.number().positive().optional(),
  async: z.boolean().optional(),
  stream: z.boolean().optional(),
});

const registerEndpointSchema = z.object({
  carId: z.string().min(1),
  url: z.string().url(),
  versions: z.array(z.string()).default(['1.0']),
  capabilities: z.array(z.string()).default([]),
  actions: z.array(z.object({
    name: z.string(),
    description: z.string(),
    paramsSchema: z.record(z.unknown()).default({}),
    resultSchema: z.record(z.unknown()).default({}),
    minTier: z.number().min(0).max(7).default(5),
    requiredCapabilities: z.array(z.string()).default([]),
    streaming: z.boolean().default(false),
  })).default([]),
  trustRequirements: z.object({
    minTier: z.number().min(0).max(7).default(5),
    minScore: z.number().min(0).max(1000).optional(),
    requiredCapabilities: z.array(z.string()).default([]),
    requiredAttestations: z.array(z.string()).optional(),
    maxChainDepth: z.number().positive().optional(),
    requireMtls: z.boolean().default(true),
  }).default({}),
});

const discoverSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  minTier: z.number().min(0).max(7).optional(),
  action: z.string().optional(),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function registerA2ARoutes(fastify: FastifyInstance): Promise<void> {
  // ========================================================================
  // Invoke Endpoint
  // ========================================================================

  /**
   * POST /v1/a2a/invoke
   * Invoke an action on another agent
   */
  fastify.post('/v1/a2a/invoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const callerCarId = getCallerCarId(request);
    if (!callerCarId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Caller CAR ID required' },
      });
    }

    // Parse and validate request
    const parseResult = invokeRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request body',
          details: parseResult.error.flatten(),
        },
      });
    }

    const { targetCarId, action, params, timeoutMs, async: isAsync } = parseResult.data;
    const requestId = randomUUID();
    const startTime = Date.now();

    logger.info(
      { requestId, callerCarId, targetCarId, action },
      'A2A invoke request'
    );

    try {
      const router = getA2ARouter();
      const trustService = getTrustNegotiationService();
      const chainService = getChainOfTrustService();
      const attestationService = getA2AAttestationService();

      // Build trust context
      const trustContext = await trustService.buildTrustContext(callerCarId);
      if (!trustContext) {
        return reply.status(403).send({
          success: false,
          error: { code: 'TRUST_INSUFFICIENT', message: 'Could not build trust context' },
        });
      }

      // Start chain
      const chain = chainService.startChain(requestId, {
        carId: callerCarId,
        tier: trustContext.callerTier,
        score: trustContext.callerScore,
        action: 'invoke',
        timestamp: new Date().toISOString(),
        requestId,
      });

      // Build invoke payload
      const payload: InvokePayload = {
        type: 'invoke',
        action,
        params,
        timeoutMs: timeoutMs ?? DEFAULT_A2A_TIMEOUT_MS,
        chainContext: chainService.buildContext(requestId) ?? undefined,
      };

      // Send async or sync
      if (isAsync) {
        const messageId = await router.sendAsync(
          callerCarId,
          targetCarId,
          payload,
          trustContext
        );

        return reply.status(202).send({
          success: true,
          data: {
            requestId,
            messageId,
            status: 'pending',
          },
        });
      }

      // Sync invoke
      const response = await router.send(
        callerCarId,
        targetCarId,
        payload,
        trustContext,
        { timeoutMs: timeoutMs ?? DEFAULT_A2A_TIMEOUT_MS }
      );

      const durationMs = Date.now() - startTime;
      const responsePayload = response.payload as ResponsePayload;

      // Generate attestation
      const attestation = attestationService.generateAttestation(
        {
          id: requestId,
          version: '1.0',
          type: 'invoke',
          from: callerCarId,
          to: targetCarId,
          timestamp: new Date(startTime).toISOString(),
          trustContext,
          payload,
        },
        response,
        durationMs
      );

      await attestationService.record(attestation);

      // Complete chain
      chainService.completeChain(requestId, attestation.data);

      const invokeResponse: A2AInvokeResponse = {
        requestId,
        success: responsePayload.success,
        result: responsePayload.result,
        error: responsePayload.error,
        metrics: {
          ...responsePayload.metrics,
          durationMs,
          subCallCount: responsePayload.metrics?.subCallCount ?? 0,
        },
        trustChain: chain.links,
        attestation: attestation.data,
      };

      return reply.status(responsePayload.success ? 200 : 500).send({
        success: responsePayload.success,
        data: invokeResponse,
      });

    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = (error as any).code || 'INTERNAL_ERROR';

      logger.error(
        { requestId, callerCarId, targetCarId, error: errorMessage },
        'A2A invoke failed'
      );

      return reply.status(500).send({
        success: false,
        data: {
          requestId,
          success: false,
          error: { code: errorCode, message: errorMessage },
          metrics: { durationMs, subCallCount: 0 },
          trustChain: [],
          attestation: {
            callerCarId,
            calleeCarId: targetCarId,
            action,
            success: false,
            responseTimeMs: durationMs,
            trustNegotiated: false,
            trustRequirementsMet: false,
            violations: [errorMessage],
            chainDepth: 1,
            delegationUsed: false,
          },
        },
      });
    }
  });

  // ========================================================================
  // Discovery Endpoints
  // ========================================================================

  /**
   * GET /v1/a2a/discover
   * Discover available agents
   */
  fastify.get('/v1/a2a/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = discoverSchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid query parameters' },
      });
    }

    const router = getA2ARouter();
    const endpoints = router.discoverEndpoints(parseResult.data);

    // Sanitize endpoints (remove internal details)
    const publicEndpoints = endpoints.map((ep) => ({
      carId: ep.carId,
      capabilities: ep.capabilities,
      actions: ep.actions.map((a) => ({
        name: a.name,
        description: a.description,
        minTier: a.minTier,
        streaming: a.streaming,
      })),
      trustRequirements: {
        minTier: ep.trustRequirements.minTier,
        requiredCapabilities: ep.trustRequirements.requiredCapabilities,
      },
      status: ep.status,
    }));

    return reply.send({
      success: true,
      data: {
        endpoints: publicEndpoints,
        count: publicEndpoints.length,
      },
    });
  });

  /**
   * POST /v1/a2a/register
   * Register an agent endpoint (internal use)
   */
  fastify.post('/v1/a2a/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = registerEndpointSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid endpoint registration',
          details: parseResult.error.flatten(),
        },
      });
    }

    const endpointData = parseResult.data;

    const endpoint: AgentEndpoint = {
      carId: endpointData.carId,
      url: endpointData.url,
      versions: endpointData.versions,
      capabilities: endpointData.capabilities,
      actions: endpointData.actions as AgentAction[],
      trustRequirements: {
        ...endpointData.trustRequirements,
        minTier: endpointData.trustRequirements.minTier ?? 5,
        requiredCapabilities: endpointData.trustRequirements.requiredCapabilities ?? [],
      },
      status: 'healthy',
      lastHealthCheck: new Date().toISOString(),
    };

    const router = getA2ARouter();
    router.registerEndpoint(endpoint);

    logger.info({ carId: endpoint.carId }, 'Endpoint registered via API');

    return reply.status(201).send({
      success: true,
      data: { carId: endpoint.carId, registered: true },
    });
  });

  /**
   * DELETE /v1/a2a/register/:carId
   * Unregister an agent endpoint
   */
  fastify.delete('/v1/a2a/register/:carId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { carId } = request.params as { carId: string };

    const router = getA2ARouter();
    router.unregisterEndpoint(carId);

    return reply.send({
      success: true,
      data: { carId, unregistered: true },
    });
  });

  // ========================================================================
  // Chain Visualization
  // ========================================================================

  /**
   * GET /v1/a2a/chain/:requestId
   * Get chain-of-trust information for a request
   */
  fastify.get('/v1/a2a/chain/:requestId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { requestId } = request.params as { requestId: string };

    const chainService = getChainOfTrustService();
    const exported = chainService.exportChain(requestId);

    if (!exported.chain) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chain not found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        chain: {
          rootRequestId: exported.chain.rootRequestId,
          state: exported.chain.state,
          depth: exported.chain.links.length,
          effectiveTier: exported.chain.effectiveTier,
          effectiveScore: exported.chain.effectiveScore,
          inheritanceMode: exported.chain.inheritanceMode,
          startedAt: exported.chain.startedAt,
          lastActivityAt: exported.chain.lastActivityAt,
          links: exported.chain.links,
        },
        visualization: exported.visualization,
        validation: exported.validation,
      },
    });
  });

  /**
   * GET /v1/a2a/chains
   * List active chains (monitoring)
   */
  fastify.get('/v1/a2a/chains', async (request: FastifyRequest, reply: FastifyReply) => {
    const chainService = getChainOfTrustService();
    const activeChains = chainService.getActiveChains();

    return reply.send({
      success: true,
      data: {
        chains: activeChains.map((c) => ({
          rootRequestId: c.rootRequestId,
          state: c.state,
          depth: c.links.length,
          effectiveTier: c.effectiveTier,
          startedAt: c.startedAt,
        })),
        count: activeChains.length,
        stats: chainService.getStats(),
      },
    });
  });

  // ========================================================================
  // Health and Stats
  // ========================================================================

  /**
   * GET /v1/a2a/health
   * A2A system health check
   */
  fastify.get('/v1/a2a/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const router = getA2ARouter();
    const chainService = getChainOfTrustService();
    const attestationService = getA2AAttestationService();

    const routerStats = router.getStats();
    const chainStats = chainService.getStats();

    return reply.send({
      success: true,
      data: {
        status: 'healthy',
        router: {
          endpoints: routerStats.endpoints,
          pendingRequests: routerStats.pendingRequests,
          circuitBreakers: Object.entries(routerStats.circuitBreakers)
            .filter(([_, state]) => state.state !== 'closed')
            .map(([carId, state]) => ({ carId, state: state.state })),
        },
        chains: {
          active: chainStats.activeChains,
          completed: chainStats.completedChains,
          failed: chainStats.failedChains,
          avgDepth: chainStats.avgChainDepth.toFixed(2),
        },
        attestations: {
          pending: attestationService.getPendingCount(),
        },
      },
    });
  });

  /**
   * POST /v1/a2a/ping
   * Ping another agent
   */
  fastify.post('/v1/a2a/ping', async (request: FastifyRequest, reply: FastifyReply) => {
    const { targetCarId } = request.body as { targetCarId: string };

    if (!targetCarId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'targetCarId required' },
      });
    }

    const router = getA2ARouter();
    const endpoint = router.getEndpoint(targetCarId);

    if (!endpoint) {
      return reply.send({
        success: true,
        data: {
          targetCarId,
          reachable: false,
          reason: 'Endpoint not registered',
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        targetCarId,
        reachable: endpoint.status === 'healthy',
        status: endpoint.status,
        capabilities: endpoint.capabilities,
        lastHealthCheck: endpoint.lastHealthCheck,
      },
    });
  });

  logger.info('A2A routes registered');
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract caller CAR ID from request (via auth header or context)
 */
function getCallerCarId(request: FastifyRequest): string | null {
  // Check X-Agent-CAR-ID header
  const carIdHeader = request.headers['x-agent-car-id'];
  if (typeof carIdHeader === 'string') {
    return carIdHeader;
  }

  // Check request context (set by auth middleware)
  const context = (request as any).agentContext;
  if (context?.carId) {
    return context.carId;
  }

  return null;
}
