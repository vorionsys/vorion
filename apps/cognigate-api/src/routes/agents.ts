/**
 * Agent Management Routes
 *
 * Wired to SQLiteTrustStore from runtime context for persistent agent storage.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'node:crypto';
import { getContext } from '../context.js';
import {
  TRUST_TIER_NAMES,
  TRUST_TIER_RANGES,
  type TrustTier,
  type AgentTrustRecord,
} from '@vorionsys/runtime';
import {
  NOT_FOUND_ERRORS,
  VALIDATION_ERRORS,
  SERVER_ERRORS,
  createErrorResponse,
} from '@vorionsys/shared-constants';

interface RegisterAgentBody {
  agentId?: string;
  name: string;
  capabilities?: string[];
  observationTier?: 'BLACK_BOX' | 'GRAY_BOX' | 'WHITE_BOX';
}

interface AgentParams {
  agentId: string;
}

interface UpdateAgentBody {
  name?: string;
  capabilities?: string[];
}

interface ListQuery {
  limit?: number;
  tier?: number;
}

export async function agentRoutes(server: FastifyInstance): Promise<void> {
  // Register a new agent - wired to TrustFacade + TrustStore
  server.post('/', async (
    request: FastifyRequest<{ Body: RegisterAgentBody }>,
    reply: FastifyReply
  ) => {
    const { trustFacade, trustStore } = getContext();
    const body = request.body;
    const agentId = body.agentId ?? crypto.randomUUID();

    // Check if agent already exists
    if (trustStore) {
      const existing = await trustStore.getAgent(agentId);
      if (existing && !existing.isRevoked) {
        const errResp = createErrorResponse(VALIDATION_ERRORS.INVALID_REQUEST);
        return reply.status(409).send({ ...errResp.error, message: 'Agent already exists' });
      }
    }

    // Admit through TrustFacade (establishes Gate Trust)
    const result = await trustFacade.admit({
      agentId,
      name: body.name,
      capabilities: body.capabilities ?? [],
      observationTier: body.observationTier ?? 'GRAY_BOX',
    });

    if (!result.admitted) {
      const errResp = createErrorResponse(VALIDATION_ERRORS.INVALID_REQUEST);
      return reply.status(errResp.status).send({
        ...errResp.error,
        message: 'Agent admission denied',
        reason: result.reason,
      });
    }

    // If we have a trust store, persist the agent record
    if (trustStore) {
      const now = new Date();
      await trustStore.saveAgent({
        agentId,
        name: body.name,
        score: result.initialScore,
        tier: result.initialTier,
        observationTier: body.observationTier ?? 'GRAY_BOX',
        observationCeiling: result.observationCeiling,
        capabilities: body.capabilities ?? [],
        admittedAt: now,
        expiresAt: result.expiresAt ? new Date(result.expiresAt) : new Date(now.getTime() + 24 * 60 * 60 * 1000),
        lastActivityAt: now,
        isRevoked: false,
      });
    }

    return reply.status(201).send({
      agentId,
      name: body.name,
      capabilities: result.capabilities,
      observationTier: body.observationTier ?? 'GRAY_BOX',
      trustScore: result.initialScore,
      trustTier: result.initialTier,
      trustTierName: TRUST_TIER_NAMES[result.initialTier as TrustTier],
      observationCeiling: result.observationCeiling,
      expiresAt: result.expiresAt,
      registeredAt: new Date().toISOString(),
    });
  });

  // Get agent by ID - wired to TrustStore + TrustFacade
  server.get('/:agentId', async (
    request: FastifyRequest<{ Params: AgentParams }>,
    reply: FastifyReply
  ) => {
    const { trustFacade, trustStore } = getContext();
    const { agentId } = request.params;

    // Get trust info from facade (in-memory dynamic trust)
    const trustInfo = trustFacade.getAgentTrustInfo(agentId);

    // Get persisted agent record if available
    let agentRecord: AgentTrustRecord | null = null;
    if (trustStore) {
      agentRecord = await trustStore.getAgent(agentId);
    }

    if (!trustInfo && !agentRecord) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.AGENT_NOT_FOUND, { agentId });
      return reply.status(errResp.status).send(errResp.error);
    }

    const score = trustInfo?.score ?? agentRecord?.score ?? 0;
    const tier = trustInfo?.tier ?? agentRecord?.tier ?? getTierFromScore(score);

    return {
      agentId,
      name: agentRecord?.name ?? agentId,
      capabilities: agentRecord?.capabilities ?? [],
      observationTier: agentRecord?.observationTier ?? 'GRAY_BOX',
      trustScore: score,
      trustTier: tier,
      trustTierName: TRUST_TIER_NAMES[tier as TrustTier],
      observationCeiling: trustInfo?.ceiling ?? agentRecord?.observationCeiling,
      isRevoked: agentRecord?.isRevoked ?? false,
      admittedAt: agentRecord?.admittedAt?.toISOString(),
      lastActivityAt: agentRecord?.lastActivityAt?.toISOString(),
    };
  });

  // List all agents - wired to TrustStore
  server.get('/', async (
    request: FastifyRequest<{ Querystring: ListQuery }>
  ) => {
    const { trustFacade, trustStore } = getContext();
    const { limit = 100, tier } = request.query;

    if (trustStore) {
      // Use persistent store
      const agents = await trustStore.listActiveAgents();

      // Enrich with current trust info from facade
      const enriched = agents.map((agent: AgentTrustRecord) => {
        const trustInfo = trustFacade.getAgentTrustInfo(agent.agentId);
        const score = trustInfo?.score ?? agent.score;
        const tierNum = trustInfo?.tier ?? agent.tier ?? getTierFromScore(score);

        return {
          agentId: agent.agentId,
          name: agent.name,
          trustScore: score,
          trustTier: tierNum,
          trustTierName: TRUST_TIER_NAMES[tierNum as TrustTier],
          isRevoked: agent.isRevoked,
        };
      });

      // Filter by tier if specified
      let results = enriched;
      if (tier !== undefined) {
        results = enriched.filter((a) => a.trustTier === tier);
      }

      return results.slice(0, limit);
    }

    // Fallback: return empty if no store
    return [];
  });

  // Update agent - wired to TrustStore
  server.patch('/:agentId', async (
    request: FastifyRequest<{ Params: AgentParams; Body: UpdateAgentBody }>,
    reply: FastifyReply
  ) => {
    const { trustStore } = getContext();
    const { agentId } = request.params;
    const body = request.body;

    if (!trustStore) {
      const errResp = createErrorResponse(SERVER_ERRORS.SERVICE_UNAVAILABLE);
      return reply.status(501).send({ ...errResp.error, message: 'Agent updates require persistent storage' });
    }

    const existing = await trustStore.getAgent(agentId);
    if (!existing) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.AGENT_NOT_FOUND, { agentId });
      return reply.status(errResp.status).send(errResp.error);
    }

    // Update fields
    const updated: AgentTrustRecord = {
      ...existing,
      name: body.name ?? existing.name,
      capabilities: body.capabilities ?? existing.capabilities,
      lastActivityAt: new Date(),
    };

    await trustStore.saveAgent(updated);

    return {
      agentId,
      name: updated.name,
      capabilities: updated.capabilities,
      updatedAt: updated.lastActivityAt.toISOString(),
    };
  });

  // Delete (revoke) agent - wired to TrustFacade + TrustStore
  server.delete('/:agentId', async (
    request: FastifyRequest<{ Params: AgentParams }>,
    reply: FastifyReply
  ) => {
    const { trustFacade, trustStore } = getContext();
    const { agentId } = request.params;

    // Revoke in TrustFacade
    trustFacade.revokeAgent(agentId, 'Deleted via API');

    // Revoke in TrustStore if available
    if (trustStore) {
      await trustStore.revokeAgent(agentId, 'Deleted via API');
    }

    return reply.status(204).send();
  });
}

/**
 * Get tier number from score
 */
function getTierFromScore(score: number): TrustTier {
  for (const [tier, range] of Object.entries(TRUST_TIER_RANGES)) {
    if (score >= range.min && score <= range.max) {
      return parseInt(tier) as TrustTier;
    }
  }
  return 0 as TrustTier; // Default to T0-Sandbox
}
