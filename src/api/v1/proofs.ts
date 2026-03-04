/**
 * API v1 Proof Routes
 *
 * Includes proof management and Merkle tree aggregation endpoints.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  createProofService,
  getMerkleService,
  type VerificationResult,
  type MerkleRootInfo,
} from '../../proof/index.js';

const proofLogger = createLogger({ component: 'api-v1-proofs' });
const proofService = createProofService();
const merkleService = getMerkleService();

const proofIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const merkleRootsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  includeUnanchored: z.coerce.boolean().default(true),
});

const merkleVerifyBodySchema = z.object({
  proofId: z.string().uuid(),
  proofHash: z.string().min(64).max(64),
  expectedRoot: z.string().min(64).max(64).optional(),
});

/**
 * Register v1 proof routes
 */
export async function registerProofRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Get proof by ID
  fastify.get('/proofs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = proofIdParamsSchema.parse(request.params ?? {});

    const proof = await proofService.get(params.id);
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

  // Verify proof
  fastify.post('/proofs/:id/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = proofIdParamsSchema.parse(request.params ?? {});

    const verificationResult: VerificationResult = await proofService.verify(params.id);

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

  // ========================================
  // Merkle Tree Aggregation Endpoints
  // ========================================

  /**
   * GET /proofs/:id/merkle - Get Merkle proof for a specific proof
   *
   * Returns the Merkle proof that allows verification of this proof's
   * inclusion in a Merkle tree aggregation.
   */
  fastify.get('/proofs/:id/merkle', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = proofIdParamsSchema.parse(request.params ?? {});

    await merkleService.initialize();
    const merkleProofResponse = await merkleService.getMerkleProof(params.id);

    if (!merkleProofResponse.found) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'MERKLE_PROOF_NOT_FOUND',
          message: 'Merkle proof not found. The proof may not have been aggregated yet.',
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }

    return reply.send({
      success: true,
      data: {
        proofId: merkleProofResponse.proofId,
        merkleProof: merkleProofResponse.merkleProof,
        rootId: merkleProofResponse.rootId,
        rootHash: merkleProofResponse.rootHash,
        anchorTx: merkleProofResponse.anchorTx,
        anchorChain: merkleProofResponse.anchorChain,
        anchoredAt: merkleProofResponse.anchoredAt,
        createdAt: merkleProofResponse.createdAt,
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * GET /merkle/roots - List recent Merkle roots
   *
   * Returns a paginated list of Merkle roots with their metadata,
   * including anchor information if available.
   */
  fastify.get('/merkle/roots', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = merkleRootsQuerySchema.parse(request.query ?? {});

    await merkleService.initialize();
    const roots = await merkleService.listRoots(query.limit, query.includeUnanchored);

    return reply.send({
      success: true,
      data: {
        roots: roots.map((root) => ({
          id: root.id,
          rootHash: root.rootHash,
          leafCount: root.leafCount,
          windowStart: root.windowStart.toISOString(),
          windowEnd: root.windowEnd.toISOString(),
          anchorTx: root.anchorTx,
          anchorChain: root.anchorChain,
          anchoredAt: root.anchoredAt?.toISOString() ?? null,
          anchored: root.anchored,
          createdAt: root.createdAt.toISOString(),
        })),
        count: roots.length,
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * GET /merkle/roots/:id - Get a specific Merkle root by ID
   */
  fastify.get('/merkle/roots/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = proofIdParamsSchema.parse(request.params ?? {});

    await merkleService.initialize();
    const root = await merkleService.getRoot(params.id);

    if (!root) {
      return reply.status(404).send({
        success: false,
        error: { code: 'MERKLE_ROOT_NOT_FOUND', message: 'Merkle root not found' },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }

    return reply.send({
      success: true,
      data: {
        id: root.id,
        rootHash: root.rootHash,
        leafCount: root.leafCount,
        windowStart: root.windowStart.toISOString(),
        windowEnd: root.windowEnd.toISOString(),
        anchorTx: root.anchorTx,
        anchorChain: root.anchorChain,
        anchoredAt: root.anchoredAt?.toISOString() ?? null,
        anchored: root.anchored,
        createdAt: root.createdAt.toISOString(),
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * POST /merkle/verify - Verify a Merkle proof
   *
   * Verifies that a proof (by ID and hash) is included in a Merkle tree.
   * Optionally verifies against a specific expected root hash.
   */
  fastify.post('/merkle/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = merkleVerifyBodySchema.parse(request.body ?? {});

    await merkleService.initialize();
    const result = await merkleService.verifyMerkleProof(
      body.proofId,
      body.proofHash,
      body.expectedRoot
    );

    return reply.send({
      success: true,
      data: {
        valid: result.valid,
        proofId: body.proofId,
        error: result.error,
        verifiedAt: new Date().toISOString(),
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * GET /merkle/stats - Get Merkle aggregation statistics
   */
  fastify.get('/merkle/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await merkleService.initialize();
    const stats = await merkleService.getStats();

    return reply.send({
      success: true,
      data: stats,
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  /**
   * POST /merkle/aggregate - Trigger manual aggregation of pending proofs
   *
   * This endpoint is primarily for administrative use. In production,
   * aggregation should be handled by the scheduled job.
   */
  fastify.post('/merkle/aggregate', async (request: FastifyRequest, reply: FastifyReply) => {
    await merkleService.initialize();
    const result = await merkleService.aggregatePendingProofs();

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'AGGREGATION_FAILED',
          message: result.error ?? 'Aggregation failed',
        },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
    }

    return reply.send({
      success: true,
      data: {
        rootId: result.rootId,
        rootHash: result.rootHash,
        leafCount: result.leafCount,
      },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  });

  proofLogger.debug('Proof and Merkle routes registered');
}
