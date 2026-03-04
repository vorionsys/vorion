/**
 * Domain Health API Route
 *
 * Returns health check results for all monitored domains.
 * TTL: 120s — probes are relatively fast but we don't want to hammer them.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchDomainHealth } from '../../lib/fetchers/domains';
import type { DomainHealthResponse } from '../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const data = await cached<DomainHealthResponse>(
      'api:domains',
      120,
      fetchDomainHealth,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    console.error('Domain health API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch domain health',
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
