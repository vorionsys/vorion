/**
 * Stats API Endpoint
 *
 * Returns cached dashboard statistics from Cloudflare KV.
 * Data is synced every 5 minutes by the scheduled worker.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    // Access KV binding from Cloudflare runtime
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

    // Get cached stats from KV
    const cached = await env.BAI_CC_CACHE.get('dashboard:public-stats');

    if (!cached) {
      return new Response(
        JSON.stringify({
          error: 'Data not yet available - sync in progress',
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

    const stats = JSON.parse(cached);

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Stats endpoint error:', error);
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
