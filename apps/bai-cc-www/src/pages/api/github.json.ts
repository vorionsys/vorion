/**
 * GitHub Stats API Route
 *
 * Returns repository-level statistics: PRs, issues, commits, review times.
 * TTL: 120s — balances freshness with API rate limit conservation.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchGithubStats } from '../../lib/fetchers/github-stats';
import type { GithubStatsResponse } from '../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const data = await cached<GithubStatsResponse>(
      'api:github',
      120,
      fetchGithubStats,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    console.error('GitHub stats API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch GitHub stats',
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
