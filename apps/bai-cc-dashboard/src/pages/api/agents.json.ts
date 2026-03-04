/**
 * Agents API Endpoint
 *
 * Returns cached list of public agents from Cloudflare KV.
 * Data is synced every 5 minutes by the scheduled worker.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    if (!env?.BAI_CC_CACHE) {
      return new Response(
        JSON.stringify({
          error: 'Cache not available',
          agents: [],
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

    const cached = await env.BAI_CC_CACHE.get('dashboard:public-agents');

    if (!cached) {
      return new Response(
        JSON.stringify({
          agents: [],
          message: 'Data sync in progress',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
          },
        }
      );
    }

    const data = JSON.parse(cached);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Agents endpoint error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        agents: [],
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
