/**
 * npm Stats API Route
 *
 * Returns download counts, versions, and publish dates for monitored packages.
 * TTL: 300s — npm stats don't change that frequently.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchNpmStats } from '../../lib/fetchers/npm-stats';
import type { NpmStatsResponse } from '../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const data = await cached<NpmStatsResponse>(
      'api:npm',
      300,
      fetchNpmStats,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('npm stats API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch npm stats',
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
