/**
 * Unified Status API Endpoint
 *
 * Returns current service health status with CORS headers for cross-origin consumption.
 * Used by status-www (status.agentanchorai.com) and other consumers.
 *
 * Data is synced every 5 minutes by the scheduled worker from real HTTP health checks.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    if (!env?.BAI_CC_CACHE) {
      return new Response(
        JSON.stringify({
          services: [],
          overallStatus: 'unknown',
          lastUpdated: new Date().toISOString(),
          source: 'fallback',
          error: 'Cache not available',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Try unified status first, fall back to domain health
    let cached = await env.BAI_CC_CACHE.get('dashboard:service-status');

    if (!cached) {
      // Fall back to raw domain health data
      const domainsCached = await env.BAI_CC_CACHE.get('dashboard:domain-health');
      if (domainsCached) {
        const domainsData = JSON.parse(domainsCached);
        const domains: Array<{
          domain: string;
          label: string;
          status: string;
          statusCode: number | null;
          responseTimeMs: number;
        }> = domainsData.domains ?? [];

        const services = domains.map((d) => ({
          name: d.label,
          url: d.domain,
          status: d.status === 'up' ? 'operational' : d.status === 'degraded' ? 'degraded' : 'outage',
          statusCode: d.statusCode,
          latencyMs: d.responseTimeMs,
          checkedAt: domainsData.timestamp,
        }));

        const hasOutage = services.some((s) => s.status === 'outage');
        const hasDegraded = services.some((s) => s.status === 'degraded');

        cached = JSON.stringify({
          services,
          overallStatus: hasOutage ? 'degraded' : hasDegraded ? 'degraded' : 'operational',
          lastUpdated: domainsData.timestamp,
          source: 'dashboard-api',
        });
      }
    }

    if (!cached) {
      return new Response(
        JSON.stringify({
          services: [],
          overallStatus: 'unknown',
          lastUpdated: new Date().toISOString(),
          source: 'fallback',
          message: 'Data sync in progress',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
            ...CORS_HEADERS,
          },
        }
      );
    }

    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error('Status endpoint error:', error);
    return new Response(
      JSON.stringify({
        services: [],
        overallStatus: 'unknown',
        lastUpdated: new Date().toISOString(),
        source: 'fallback',
        error: 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      }
    );
  }
};
