/**
 * Agent Registry API Routes
 *
 * REST API endpoints for Agent Anchor functionality.
 *
 * @packageDocumentation
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../common/logger.js';
// Import directly from source files to avoid circular dependency with index.ts
import { createAgentRegistryService, TRUST_TIER_RANGES } from './service.js';
import { createA3ICacheService } from './a3i-cache.js';
import type { AgentState, AttestationType, AttestationOutcome, StateAction } from '@vorionsys/contracts/db';

const logger = createLogger({ component: 'agent-registry-routes' });

// Initialize services
const registryService = createAgentRegistryService();
const cacheService = createA3ICacheService();

// ============================================================================
// Request Schemas
// ============================================================================

const registerAgentSchema = z.object({
  organization: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
  agentClass: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
  domains: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'S'])).min(1),
  level: z.number().int().min(0).max(7),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  contactEmail: z.string().email().optional(),
});

const updateAgentSchema = z.object({
  description: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  contactEmail: z.string().email().optional(),
});

const queryAgentsSchema = z.object({
  organization: z.string().optional(),
  domains: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'S'])).optional(),
  minLevel: z.number().int().min(0).max(7).optional(),
  minTrustTier: z.number().int().min(0).max(7).optional(),
  states: z.array(z.enum([
    'T0_SANDBOX', 'T1_OBSERVED', 'T2_PROVISIONAL', 'T3_MONITORED',
    'T4_STANDARD', 'T5_TRUSTED', 'T6_CERTIFIED', 'T7_AUTONOMOUS',
    'QUARANTINE', 'SUSPENDED', 'REVOKED', 'EXPELLED',
  ])).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const submitAttestationSchema = z.object({
  type: z.enum(['BEHAVIORAL', 'CREDENTIAL', 'AUDIT', 'A2A', 'MANUAL']),
  outcome: z.enum(['success', 'failure', 'warning']),
  action: z.string().min(1).max(200),
  evidence: z.record(z.unknown()).optional(),
  source: z.string().optional(),
  sourceCarId: z.string().optional(),
});

const transitionStateSchema = z.object({
  action: z.enum([
    'PROMOTE', 'REQUEST_APPROVAL', 'QUARANTINE', 'RELEASE',
    'SUSPEND', 'REVOKE', 'EXPEL', 'REINSTATE',
  ]),
  reason: z.string().min(1).max(500),
  context: z.record(z.unknown()).optional(),
});

const carIdParamSchema = z.object({
  carId: z.string(),
});

// ============================================================================
// Response Helpers
// ============================================================================

function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({
    success: true,
    data,
    meta: {
      requestId: reply.request.id,
      timestamp: new Date().toISOString(),
      version: 'v1',
    },
  });
}

function sendError(reply: FastifyReply, code: string, message: string, statusCode = 400, details?: unknown) {
  return reply.status(statusCode).send({
    success: false,
    error: { code, message, details },
    meta: {
      requestId: reply.request.id,
      timestamp: new Date().toISOString(),
      version: 'v1',
    },
  });
}

function sendPaginated<T>(reply: FastifyReply, data: T[], total: number, offset: number, limit: number) {
  return reply.status(200).send({
    success: true,
    data,
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + data.length < total,
    },
    meta: {
      requestId: reply.request.id,
      timestamp: new Date().toISOString(),
      version: 'v1',
    },
  });
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerAgentRegistryRoutes(fastify: FastifyInstance): Promise<void> {
  // ==========================================================================
  // Agent CRUD
  // ==========================================================================

  /**
   * Register a new agent
   * POST /v1/agents
   */
  fastify.post('/v1/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = registerAgentSchema.parse(request.body);
      const tenantId = (request as any).tenantId; // From auth middleware

      if (!tenantId) {
        return sendError(reply, 'AUTH_REQUIRED', 'Authentication required', 401);
      }

      const agent = await registryService.registerAgent({
        tenantId,
        ...body,
      } as any);

      // Cache the new agent
      await cacheService.cacheAgent(agent);

      logger.info({ carId: agent.carId, tenantId }, 'Agent registered via API');

      return sendSuccess(reply, agent, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request body', 400, error.errors);
      }
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          return sendError(reply, 'DUPLICATE_CAR_ID', error.message, 409);
        }
        if (error.message.includes('limit exceeded')) {
          return sendError(reply, 'QUOTA_EXCEEDED', error.message, 429);
        }
      }
      logger.error({ error }, 'Failed to register agent');
      return sendError(reply, 'SERVER_ERROR', 'Failed to register agent', 500);
    }
  });

  /**
   * Get agent by CAR ID
   * GET /v1/agents/:carId
   */
  fastify.get('/v1/agents/:carId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);

      // Try cache first
      const cached = await cacheService.getCachedAgent(carId);
      if (cached) {
        return sendSuccess(reply, { ...cached.agent, cached: true, cacheAge: Date.now() - cached.cachedAt });
      }

      // Fetch from database
      const agent = await registryService.getAgentByCarId(carId);

      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      // Cache for future requests
      await cacheService.cacheAgent(agent);

      return sendSuccess(reply, { ...agent, cached: false });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'INVALID_CAR_ID', 'Invalid CAR ID format', 400);
      }
      logger.error({ error }, 'Failed to get agent');
      return sendError(reply, 'SERVER_ERROR', 'Failed to get agent', 500);
    }
  });

  /**
   * Update agent metadata
   * PATCH /v1/agents/:carId
   */
  fastify.patch('/v1/agents/:carId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);
      const updates = updateAgentSchema.parse(request.body);

      const agent = await registryService.getAgentByCarId(carId);
      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      const updated = await registryService.updateAgent(agent.id, updates);

      // Invalidate cache
      await cacheService.invalidateAgent(carId);

      return sendSuccess(reply, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request', 400, error.errors);
      }
      logger.error({ error }, 'Failed to update agent');
      return sendError(reply, 'SERVER_ERROR', 'Failed to update agent', 500);
    }
  });

  /**
   * Query agents
   * POST /v1/query
   */
  fastify.post('/v1/query', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = queryAgentsSchema.parse(request.body);
      const tenantId = (request as any).tenantId;

      if (!tenantId) {
        return sendError(reply, 'AUTH_REQUIRED', 'Authentication required', 401);
      }

      const result = await registryService.queryAgents({
        tenantId,
        ...query,
      });

      return sendPaginated(
        reply,
        result.data,
        result.total,
        query.offset ?? 0,
        query.limit ?? 50
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid query', 400, error.errors);
      }
      logger.error({ error }, 'Failed to query agents');
      return sendError(reply, 'SERVER_ERROR', 'Failed to query agents', 500);
    }
  });

  // ==========================================================================
  // Trust Scoring
  // ==========================================================================

  /**
   * Get trust score for an agent
   * GET /v1/agents/:carId/trust
   */
  fastify.get('/v1/agents/:carId/trust', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);
      const refresh = (request.query as any)?.refresh === 'true';

      // Try cache first (unless refresh requested)
      if (!refresh) {
        const cached = await cacheService.getTrustScoreFast(carId);
        if (cached) {
          return sendSuccess(reply, {
            score: cached.score,
            tier: cached.tier,
            tierName: getTierName(cached.tier),
            cached: true,
            cacheAge: cached.cacheAge,
          });
        }
      }

      // Get from database
      const agent = await registryService.getAgentByCarId(carId);
      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      // Process any pending attestations
      const { newScore } = await registryService.processAttestations(agent.id);
      const tier = scoreToTier(newScore);

      // Cache the result
      await cacheService.cacheTrustScore(carId, newScore, tier);

      return sendSuccess(reply, {
        score: newScore,
        tier,
        tierName: getTierName(tier),
        cached: false,
        factors: {
          behavioral: 0.5, // Placeholder - would come from trust engine
          credential: 0.5,
          temporal: 0.5,
          audit: 0.5,
          volume: 0.5,
        },
        calculatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get trust score');
      return sendError(reply, 'SERVER_ERROR', 'Failed to get trust score', 500);
    }
  });

  // ==========================================================================
  // Attestations
  // ==========================================================================

  /**
   * Submit an attestation
   * POST /v1/agents/:carId/attestations
   */
  fastify.post('/v1/agents/:carId/attestations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);
      const body = submitAttestationSchema.parse(request.body);
      const tenantId = (request as any).tenantId;

      if (!tenantId) {
        return sendError(reply, 'AUTH_REQUIRED', 'Authentication required', 401);
      }

      const agent = await registryService.getAgentByCarId(carId);
      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      const attestation = await registryService.submitAttestation({
        agentId: agent.id,
        tenantId,
        type: body.type as AttestationType,
        outcome: body.outcome as AttestationOutcome,
        action: body.action,
        evidence: body.evidence,
        source: body.source,
        sourceCarId: body.sourceCarId,
      });

      // Queue for A3I batch processing
      await cacheService.queueAttestation(carId, attestation);

      // Invalidate trust score cache
      await cacheService.invalidateTrustScore(carId);

      return sendSuccess(reply, attestation, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid attestation', 400, error.errors);
      }
      logger.error({ error }, 'Failed to submit attestation');
      return sendError(reply, 'SERVER_ERROR', 'Failed to submit attestation', 500);
    }
  });

  /**
   * Get attestations for an agent
   * GET /v1/agents/:carId/attestations
   */
  fastify.get('/v1/agents/:carId/attestations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);
      const limit = parseInt((request.query as any)?.limit ?? '50', 10);

      const agent = await registryService.getAgentByCarId(carId);
      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      const attestations = await registryService.getAttestations(agent.id, limit);

      return sendSuccess(reply, attestations);
    } catch (error) {
      logger.error({ error }, 'Failed to get attestations');
      return sendError(reply, 'SERVER_ERROR', 'Failed to get attestations', 500);
    }
  });

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Transition agent state
   * POST /v1/agents/:carId/lifecycle
   */
  fastify.post('/v1/agents/:carId/lifecycle', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = carIdParamSchema.parse(request.params);
      const body = transitionStateSchema.parse(request.body);
      const tenantId = (request as any).tenantId;

      if (!tenantId) {
        return sendError(reply, 'AUTH_REQUIRED', 'Authentication required', 401);
      }

      const agent = await registryService.getAgentByCarId(carId);
      if (!agent) {
        return sendError(reply, 'AGENT_NOT_FOUND', 'Agent not found', 404);
      }

      const result = await registryService.transitionState({
        agentId: agent.id,
        tenantId,
        action: body.action as StateAction,
        reason: body.reason,
        context: body.context,
      });

      // Invalidate caches
      await cacheService.invalidateAgent(carId);
      await cacheService.invalidateTrustScore(carId);

      if (!result.success) {
        return sendError(reply, 'LIFECYCLE_BLOCKED', result.error ?? 'Transition blocked', 409);
      }

      return sendSuccess(reply, result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request', 400, error.errors);
      }
      logger.error({ error }, 'Failed to transition state');
      return sendError(reply, 'SERVER_ERROR', 'Failed to transition state', 500);
    }
  });

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate a CAR ID string
   * POST /v1/validate
   */
  fastify.post('/v1/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { carId } = z.object({ carId: z.string() }).parse(request.body);

      // CAR ID format regex
      const carIdRegex = /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])@(\d+\.\d+\.\d+)$/;
      const match = carIdRegex.exec(carId);

      if (!match) {
        return sendSuccess(reply, {
          valid: false,
          errors: [{ code: 'INVALID_FORMAT', message: 'CAR ID does not match expected format' }],
        });
      }

      const [, registry, org, agentClass, domains, level, version] = match;

      // Check if registered
      const agent = await registryService.getAgentByCarId(carId);

      return sendSuccess(reply, {
        valid: true,
        registered: !!agent,
        parsed: {
          registry,
          organization: org,
          agentClass,
          domains: domains.split(''),
          level: parseInt(level, 10),
          version,
        },
        agent: agent ? {
          state: agent.state,
          trustScore: agent.trustScore,
          trustTier: agent.trustTier,
        } : undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid request', 400);
      }
      logger.error({ error }, 'Failed to validate CAR ID');
      return sendError(reply, 'SERVER_ERROR', 'Failed to validate CAR ID', 500);
    }
  });

  // ==========================================================================
  // Health & Status
  // ==========================================================================

  /**
   * A3I cache health check
   * GET /v1/a3i/health
   */
  fastify.get('/v1/a3i/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await cacheService.healthCheck();
      const syncStatus = await cacheService.getSyncStatus();

      return sendSuccess(reply, {
        ...health,
        syncStatus,
      });
    } catch (error) {
      logger.error({ error }, 'A3I health check failed');
      return sendError(reply, 'HEALTH_CHECK_FAILED', 'Health check failed', 503);
    }
  });

  logger.info('Agent registry routes registered');
}

// ============================================================================
// Helpers
// ============================================================================

function scoreToTier(score: number): number {
  for (const [tier, range] of Object.entries(TRUST_TIER_RANGES)) {
    if (score >= range.min && score <= range.max) {
      return parseInt(tier, 10);
    }
  }
  return 0;
}

function getTierName(tier: number): string {
  const names: Record<number, string> = {
    0: 'Sandbox',
    1: 'Observed',
    2: 'Provisional',
    3: 'Monitored',
    4: 'Standard',
    5: 'Trusted',
    6: 'Certified',
    7: 'Autonomous',
  };
  return names[tier] ?? 'Unknown';
}
