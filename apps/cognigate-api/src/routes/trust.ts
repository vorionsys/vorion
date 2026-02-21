/**
 * Trust Management Routes
 *
 * Wired to actual TrustFacade from runtime context.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getContext } from '../context.js';
import { TRUST_TIER_NAMES, TRUST_TIER_RANGES } from '@vorionsys/runtime';

interface AgentParams {
  agentId: string;
}

interface SignalBody {
  type: 'success' | 'failure' | 'violation' | 'neutral';
  source: string;
  weight?: number;
  context?: Record<string, unknown>;
}

interface AdmitBody {
  agentId: string;
  name: string;
  capabilities: string[];
  observationTier: 'BLACK_BOX' | 'GRAY_BOX' | 'WHITE_BOX';
}

interface HistoryQuery {
  limit?: number;
}

export async function trustRoutes(server: FastifyInstance): Promise<void> {
  // Admit an agent (Gate Trust) - wired to TrustFacade
  server.post('/admit', async (request: FastifyRequest<{ Body: AdmitBody }>) => {
    const { trustFacade } = getContext();
    const body = request.body;

    const result = await trustFacade.admit({
      agentId: body.agentId,
      name: body.name,
      capabilities: body.capabilities,
      observationTier: body.observationTier,
    });

    return {
      admitted: result.admitted,
      initialTier: result.initialTier,
      initialScore: result.initialScore,
      observationCeiling: result.observationCeiling,
      capabilities: result.capabilities,
      expiresAt: result.expiresAt,
      reason: result.reason,
    };
  });

  // Get trust info for an agent - wired to TrustFacade
  server.get('/:agentId', async (request: FastifyRequest<{ Params: AgentParams }>) => {
    const { trustFacade } = getContext();
    const { agentId } = request.params;

    const info = trustFacade.getAgentTrustInfo(agentId);

    if (!info) {
      return {
        agentId,
        message: 'Agent not admitted. Use POST /trust/admit first.',
        score: null,
        tier: null,
      };
    }

    return {
      agentId,
      score: info.score,
      tier: info.tier,
      tierName: TRUST_TIER_NAMES[info.tier],
      observationCeiling: info.ceiling,
      lastUpdated: new Date().toISOString(),
    };
  });

  // Record a trust signal - wired to TrustFacade
  server.post('/:agentId/signal', async (
    request: FastifyRequest<{ Params: AgentParams; Body: SignalBody }>
  ) => {
    const { trustFacade } = getContext();
    const { agentId } = request.params;
    const body = request.body;

    // Get score before
    const beforeInfo = trustFacade.getAgentTrustInfo(agentId);
    const scoreBefore = beforeInfo?.score ?? 0;

    // Record the signal
    await trustFacade.recordSignal({
      agentId,
      type: body.type,
      source: body.source,
      weight: body.weight ?? 0.5,
      context: body.context,
    });

    // Get score after
    const afterInfo = trustFacade.getAgentTrustInfo(agentId);
    const scoreAfter = afterInfo?.score ?? scoreBefore;

    return {
      accepted: true,
      scoreBefore,
      scoreAfter,
      change: scoreAfter - scoreBefore,
      newTier: afterInfo?.tier,
      newTierName: afterInfo ? TRUST_TIER_NAMES[afterInfo.tier] : null,
    };
  });

  // Revoke an agent - wired to TrustFacade
  server.post('/:agentId/revoke', async (
    request: FastifyRequest<{ Params: AgentParams; Body: { reason: string } }>
  ) => {
    const { trustFacade } = getContext();
    const { agentId } = request.params;
    const { reason } = request.body;

    trustFacade.revokeAgent(agentId, reason);

    return {
      revoked: true,
      agentId,
      reason,
    };
  });

  // Get trust history (from proofs)
  server.get('/:agentId/history', async (
    request: FastifyRequest<{ Params: AgentParams; Querystring: HistoryQuery }>
  ) => {
    const { proofCommitter } = getContext();
    const { agentId } = request.params;
    const { limit = 50 } = request.query;

    await proofCommitter.flush();

    const commitments = await proofCommitter.getCommitmentsForEntity(agentId);

    // Filter to trust_signal events
    const signalEvents = commitments
      .filter((c) => c.event.type === 'trust_signal')
      .slice(0, limit);

    return {
      agentId,
      count: signalEvents.length,
      signals: signalEvents.map((c) => ({
        timestamp: c.timestamp,
        payload: c.event.payload,
      })),
    };
  });

  // Get tier thresholds
  server.get('/tiers', async () => {
    const tiers = Object.entries(TRUST_TIER_RANGES).map(([tier, range]) => ({
      number: parseInt(tier),
      name: TRUST_TIER_NAMES[parseInt(tier) as keyof typeof TRUST_TIER_NAMES],
      minScore: range.min,
      maxScore: range.max,
    }));

    return { tiers };
  });
}
