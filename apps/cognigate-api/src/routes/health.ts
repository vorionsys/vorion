/**
 * Health Check Routes
 */

import type { FastifyInstance } from 'fastify';

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
  server.get('/ready', async () => {
    // TODO: Actually check component health
    return {
      ready: true,
      components: {
        trustFacade: true,
        proofCommitter: true,
      },
    };
  });

  // Liveness probe
  server.get('/live', async () => {
    return { alive: true };
  });
}
