/**
 * Governance Metrics API Endpoint
 *
 * Returns governance and compliance metrics.
 * Data sources (in priority order):
 * 1. Cloudflare KV cache (populated by scheduled worker)
 * 2. Live fetch from atsf-core API (if ATSF_API_URL is configured)
 * 3. Default empty metrics (status: 'syncing')
 */
import type { APIRoute } from 'astro';
import { createVorionClient } from '../../lib/vorion-client.js';

export const prerender = false;

const DEFAULT_METRICS = {
  totalActions: 0,
  approvedActions: 0,
  escalatedActions: 0,
  blockedActions: 0,
  approvalRate: 0,
  escalationRate: 0,
  blockRate: 0,
  activePolicies: 0,
  complianceRate: 0,
  avgResponseTimeMs: 0,
  recentActivity: [] as unknown[],
};

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    if (!env?.BAI_CC_CACHE) {
      return new Response(
        JSON.stringify({
          error: 'Cache not available',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }
      );
    }

    // Try KV cache first
    const cached = await env.BAI_CC_CACHE.get('dashboard:governance-metrics');

    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        },
      });
    }

    // KV empty — try live fetch from atsf-core backend
    const client = createVorionClient(env);
    if (client) {
      try {
        const metrics = await client.getGovernanceMetrics();
        const hasRealData = metrics.totalActions > 0 || metrics.activePolicies > 0;

        // Only cache in KV if we got meaningful data (avoid caching cold-start zeros)
        if (hasRealData) {
          await env.BAI_CC_CACHE.put(
            'dashboard:governance-metrics',
            JSON.stringify(metrics),
            { expirationTtl: 300 }
          );
        }

        return new Response(JSON.stringify({
          ...metrics,
          status: hasRealData ? metrics.status : 'syncing',
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': hasRealData ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=30',
          },
        });
      } catch (err) {
        console.error('Failed to fetch from atsf-core:', err);
        // Fall through to default metrics
      }
    }

    // No cache, no backend — return default structure
    return new Response(
      JSON.stringify({
        ...DEFAULT_METRICS,
        timestamp: new Date().toISOString(),
        status: 'syncing',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  } catch (error) {
    console.error('Governance endpoint error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
