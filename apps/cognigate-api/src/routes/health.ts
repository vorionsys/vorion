/**
 * Health Check Routes
 */

import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';
import {
  TrustFacade,
  ProofCommitter,
  IntentPipeline,
} from '@vorionsys/runtime';

export async function healthRoutes(server: FastifyInstance): Promise<void> {
  // Basic health check
  server.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  });

  // Readiness probe
  server.get('/ready', async (_request, reply) => {
    const components: Record<string, boolean> = {
      trustFacade: false,
      proofCommitter: false,
      intentPipeline: false,
      proofStore: false,
    };

    try {
      const ctx = getContext();

      // Verify each component is initialized and the expected type
      components.trustFacade = ctx.trustFacade instanceof TrustFacade;
      components.proofCommitter = ctx.proofCommitter instanceof ProofCommitter;
      components.intentPipeline = ctx.intentPipeline instanceof IntentPipeline;
      components.proofStore = ctx.proofStore != null;

      // Lightweight functional check: getMetrics() is synchronous and cheap
      if (components.proofCommitter) {
        ctx.proofCommitter.getMetrics();
      }
    } catch {
      // getContext() throws if context was never initialized
      const allDown = Object.fromEntries(
        Object.keys(components).map((k) => [k, false]),
      );
      return reply.status(503).send({ ready: false, components: allDown });
    }

    const allHealthy = Object.values(components).every(Boolean);

    if (!allHealthy) {
      return reply.status(503).send({ ready: false, components });
    }

    return reply.status(200).send({ ready: true, components });
  });

  // Liveness probe
  server.get('/live', async () => {
    return { alive: true };
  });
}
