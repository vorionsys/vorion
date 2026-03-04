/**
 * Overview API Route
 *
 * Aggregated endpoint that calls all fetchers in parallel and returns
 * a unified OverviewResponse for the dashboard's top-level summary.
 * TTL: 60s — the overview should be reasonably fresh.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { cached } from '../../lib/cache';
import { fetchDomainHealth } from '../../lib/fetchers/domains';
import { fetchCiStatus } from '../../lib/fetchers/github-ci';
import { fetchNpmStats } from '../../lib/fetchers/npm-stats';
import { fetchVercelDeployments } from '../../lib/fetchers/vercel-deployments';
import { fetchGithubStats } from '../../lib/fetchers/github-stats';
import type { OverviewResponse } from '../../lib/types';

/**
 * Determine overall system health from component data.
 */
function computeOverallHealth(
  domainsDown: number,
  domainsTotal: number,
  ciFailing: number,
): OverviewResponse['overallHealth'] {
  // Critical: more than 25% of domains down or any CI failing
  if (domainsDown > domainsTotal * 0.25) return 'critical';
  // Degraded: any domain down or any CI failures
  if (domainsDown > 0 || ciFailing > 0) return 'degraded';
  return 'healthy';
}

async function buildOverview(): Promise<OverviewResponse> {
  const [domains, ci, npm, vercel, github] = await Promise.all([
    fetchDomainHealth(),
    fetchCiStatus(),
    fetchNpmStats(),
    fetchVercelDeployments(),
    fetchGithubStats(),
  ]);

  const lastDeployState =
    vercel.deployments.length > 0
      ? vercel.deployments[0].state
      : 'N/A';

  return {
    domains: {
      up: domains.summary.up,
      total: domains.summary.total,
      avgLatencyMs: domains.summary.avgResponseMs,
    },
    ci: {
      passing: ci.summary.passing,
      failing: ci.summary.failing,
      total: ci.summary.total,
    },
    npm: {
      totalDownloads: npm.totalDownloads,
      packageCount: npm.packages.length,
    },
    vercel: {
      recentDeployments: vercel.deployments.length,
      lastDeployState,
    },
    github: {
      openPRs: github.pullRequests.open,
      openIssues: github.issues.open,
      commits7d: github.commits.count7d,
    },
    overallHealth: computeOverallHealth(
      domains.summary.down,
      domains.summary.total,
      ci.summary.failing,
    ),
    timestamp: new Date().toISOString(),
  };
}

export const GET: APIRoute = async () => {
  try {
    const data = await cached<OverviewResponse>(
      'api:overview',
      60,
      buildOverview,
    );

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('Overview API error:', err);
    return new Response(
      JSON.stringify({
        error: 'Failed to build overview',
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
