/**
 * CI Status API Route
 *
 * Returns GitHub Actions workflow statuses for all monitored workflows.
 * TTL: 120s — CI runs change frequently enough but not second-by-second.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchCiStatus } from '../../lib/fetchers/github-ci';
import type { CiStatusResponse } from '../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const data = await cached<CiStatusResponse>(
      'api:ci',
      120,
      fetchCiStatus,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    console.error('CI status API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch CI status',
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
