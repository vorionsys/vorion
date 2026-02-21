/**
 * Proof Verification Routes
 *
 * Wired to actual ProofCommitter from runtime context.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getContext } from '../context.js';
import type { ProofCommitment } from '@vorionsys/runtime';
import {
  NOT_FOUND_ERRORS,
  createErrorResponse,
} from '@vorionsys/shared-constants';

interface ProofParams {
  proofId: string;
}

interface EntityParams {
  entityId: string;
}

interface BatchParams {
  batchId: string;
}

interface VerifyBody {
  commitment: {
    id: string;
    hash: string;
    timestamp: number;
    event: {
      type: string;
      entityId: string;
      payload: Record<string, unknown>;
      timestamp: number;
      correlationId?: string;
    };
  };
}

interface EntityQuery {
  limit?: number;
}

export async function proofRoutes(server: FastifyInstance): Promise<void> {
  // Get proof by ID - wired to ProofCommitter
  server.get('/:proofId', async (
    request: FastifyRequest<{ Params: ProofParams }>,
    reply: FastifyReply
  ) => {
    const { proofCommitter } = getContext();
    const { proofId } = request.params;

    // Flush to ensure recent proofs are available
    await proofCommitter.flush();

    const commitment = await proofCommitter.getCommitment(proofId);

    if (!commitment) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.PROOF_NOT_FOUND, { proofId });
      return reply.status(errResp.status).send(errResp.error);
    }

    return {
      proofId: commitment.id,
      hash: commitment.hash,
      timestamp: commitment.timestamp,
      event: commitment.event,
    };
  });

  // Verify a proof - wired to ProofCommitter
  server.post('/verify', async (request: FastifyRequest<{ Body: VerifyBody }>) => {
    const { proofCommitter } = getContext();
    const { commitment } = request.body;

    // Cast to ProofCommitment (caller must provide valid event type)
    const isValid = proofCommitter.verifyCommitment(commitment as unknown as ProofCommitment);

    return {
      valid: isValid,
      reason: isValid ? 'Hash matches event data' : 'Hash does not match event data (tampered or invalid)',
    };
  });

  // Get proofs for an entity - wired to ProofCommitter
  server.get('/entity/:entityId', async (
    request: FastifyRequest<{ Params: EntityParams; Querystring: EntityQuery }>
  ) => {
    const { proofCommitter } = getContext();
    const { entityId } = request.params;
    const { limit = 50 } = request.query;

    // Flush to ensure recent proofs are available
    await proofCommitter.flush();

    const commitments = await proofCommitter.getCommitmentsForEntity(entityId);

    return {
      entityId,
      count: commitments.length,
      proofs: commitments.slice(0, limit).map((c) => ({
        proofId: c.id,
        hash: c.hash,
        timestamp: c.timestamp,
        eventType: c.event.type,
        correlationId: c.event.correlationId,
      })),
    };
  });

  // Get batch by ID - wired to ProofStore
  server.get('/batch/:batchId', async (
    request: FastifyRequest<{ Params: BatchParams }>,
    reply: FastifyReply
  ) => {
    const { proofStore } = getContext();
    const { batchId } = request.params;

    const batch = await proofStore.getBatch(batchId);

    if (!batch) {
      const errResp = createErrorResponse(NOT_FOUND_ERRORS.RESOURCE_NOT_FOUND, {
        resourceType: 'batch',
        resourceId: batchId,
      });
      return reply.status(errResp.status).send(errResp.error);
    }

    return {
      batchId: batch.batchId,
      merkleRoot: batch.merkleRoot,
      signature: batch.signature,
      eventCount: batch.eventCount,
      createdAt: batch.createdAt,
      commitmentIds: batch.commitments.map((c) => c.id),
    };
  });

  // Get proof metrics - wired to ProofCommitter
  server.get('/metrics', async () => {
    const { proofCommitter } = getContext();
    return proofCommitter.getMetrics();
  });

  // Force flush (useful for testing)
  server.post('/flush', async () => {
    const { proofCommitter } = getContext();
    await proofCommitter.flush();
    return { flushed: true };
  });
}
