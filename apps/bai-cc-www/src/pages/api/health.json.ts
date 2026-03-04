/**
 * Health Check API Route
 *
 * Simple liveness endpoint returning current status and timestamp.
 * No caching — always returns a fresh response.
 */
export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    },
  );
};
