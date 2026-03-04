/**
 * Vercel Deployments API Route
 *
 * Returns recent Vercel deployments with build durations and commit metadata.
 * TTL: 60s — deployments can change rapidly during active development.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchVercelDeployments } from '../../lib/fetchers/vercel-deployments';
import type { VercelDeploymentsResponse } from '../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const data = await cached<VercelDeploymentsResponse>(
      'api:vercel',
      60,
      fetchVercelDeployments,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('Vercel deployments API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch Vercel deployments',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
