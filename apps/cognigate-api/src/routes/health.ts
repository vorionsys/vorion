/**
 * Health Check Routes
 */

import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';

export async function healthRoutes(server: FastifyInstance): Promise<void> {
  // Basic health check
  server.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  });

  // Readiness probe — checks each core component
  server.get('/ready', async (_request, reply) => {
    const checks: Record<string, boolean> = {
      trustFacade: false,
      proofCommitter: false,
      intentPipeline: false,
    };

    try {
      const ctx = getContext();

      // TrustFacade: verify the instance exists and can be called
      try {
        // getAgentTrustInfo returns null for unknown IDs — that's fine, it means the facade is responsive
        await Promise.resolve(ctx.trustFacade.getAgentTrustInfo('__healthcheck__'));
        checks.trustFacade = true;
      } catch {
        checks.trustFacade = false;
      }

      // ProofCommitter: verify metrics are accessible (non-blocking)
      try {
        const metrics = ctx.proofCommitter.getMetrics();
        checks.proofCommitter = metrics != null;
      } catch {
        checks.proofCommitter = false;
      }

      // IntentPipeline: verify the pipeline instance is live
      try {
        const metrics = ctx.intentPipeline.getMetrics();
        checks.intentPipeline = metrics != null;
      } catch {
        checks.intentPipeline = false;
      }
    } catch {
      // Context not initialized — all components unhealthy
    }

    const allHealthy = Object.values(checks).every(Boolean);

    const response = {
      ready: allHealthy,
      components: checks,
      timestamp: new Date().toISOString(),
    };

    return reply.status(allHealthy ? 200 : 503).send(response);
  });

  // Liveness probe
  server.get('/live', async () => {
    return { alive: true };
  });
}
