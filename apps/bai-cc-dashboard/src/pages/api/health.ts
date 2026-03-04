/**
 * Health Check Endpoint
 *
 * Checks KV cache availability and optionally the atsf-core backend.
 */
import type { APIRoute } from 'astro';
import { createVorionClient } from '../../lib/vorion-client.js';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  const kvAvailable = !!env?.BAI_CC_CACHE;

  // Check atsf-core backend if configured
  let backend: 'connected' | 'unavailable' | 'not_configured' = 'not_configured';
  let backendLatencyMs: number | undefined;
  const client = createVorionClient(env);

  if (client) {
    const start = Date.now();
    try {
      await client.getHealth();
      backend = 'connected';
      backendLatencyMs = Date.now() - start;
    } catch {
      backend = 'unavailable';
      backendLatencyMs = Date.now() - start;
    }
  }

  const allHealthy = kvAvailable && (backend === 'connected' || backend === 'not_configured');

  return new Response(
    JSON.stringify({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      kv: kvAvailable ? 'connected' : 'unavailable',
      backend,
      ...(backendLatencyMs !== undefined && { backendLatencyMs }),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
