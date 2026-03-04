/**
 * Vercel Deployments Fetcher
 *
 * Fetches recent deployments from the Vercel REST API.
 * Requires VERCEL_TOKEN env var. Optionally uses VERCEL_TEAM_ID.
 *
 * Gets the last 20 deployments with build duration, state, and commit info.
 */
import type {
  VercelDeploymentEntry,
  VercelProjectSummary,
  VercelDeploymentsResponse,
} from '../types';

/** Vercel API deployment shape (subset) */
interface VercelAPIDeployment {
  uid: string;
  name: string;
  url: string;
  state:
    | 'READY'
    | 'ERROR'
    | 'BUILDING'
    | 'QUEUED'
    | 'CANCELED'
    | 'INITIALIZING';
  created: number; // epoch ms
  ready?: number; // epoch ms
  buildingAt?: number; // epoch ms
  source?: string;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubRepo?: string;
    githubCommitRef?: string;
  };
  creator?: {
    username?: string;
  };
}

interface VercelDeploymentsAPIResponse {
  deployments: VercelAPIDeployment[];
}

/**
 * Normalize Vercel deployment state. The API can return values like
 * 'INITIALIZING' which we map to 'BUILDING' for our simpler model.
 */
function normalizeState(
  state: string,
): VercelDeploymentEntry['state'] {
  const upper = state.toUpperCase();
  if (upper === 'READY') return 'READY';
  if (upper === 'ERROR') return 'ERROR';
  if (upper === 'BUILDING' || upper === 'INITIALIZING') return 'BUILDING';
  if (upper === 'QUEUED') return 'QUEUED';
  if (upper === 'CANCELED') return 'CANCELED';
  return 'QUEUED'; // fallback for unknown states
}

/**
 * Compute build duration in milliseconds.
 * Uses buildingAt -> ready if available, otherwise created -> ready.
 */
function computeBuildDuration(deploy: VercelAPIDeployment): number | null {
  if (deploy.ready) {
    const start = deploy.buildingAt ?? deploy.created;
    return deploy.ready - start;
  }
  return null;
}

/**
 * Derive per-project summary from deployments.
 */
function deriveProjectSummaries(
  deployments: VercelDeploymentEntry[],
): VercelProjectSummary[] {
  const projectMap = new Map<string, VercelProjectSummary>();

  for (const deploy of deployments) {
    if (!projectMap.has(deploy.name)) {
      projectMap.set(deploy.name, {
        name: deploy.name,
        latestState: deploy.state,
        url: deploy.url,
      });
    }
  }

  return Array.from(projectMap.values());
}

/**
 * Fetch recent deployments from the Vercel API.
 * Returns an empty response if VERCEL_TOKEN is not configured.
 */
export async function fetchVercelDeployments(): Promise<VercelDeploymentsResponse> {
  const token = import.meta.env.VERCEL_TOKEN;

  if (!token) {
    console.warn('VERCEL_TOKEN not set — Vercel deployments will be empty');
    return {
      deployments: [],
      projects: [],
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // Build URL with optional team ID
    const url = new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('limit', '20');

    const teamId = import.meta.env.VERCEL_TEAM_ID;
    if (teamId) {
      url.searchParams.set('teamId', teamId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(
        `Vercel API responded with ${response.status}: ${response.statusText}`,
      );
      return {
        deployments: [],
        projects: [],
        timestamp: new Date().toISOString(),
      };
    }

    const data = (await response.json()) as VercelDeploymentsAPIResponse;

    const deployments: VercelDeploymentEntry[] = (
      data.deployments ?? []
    ).map((d) => ({
      uid: d.uid,
      name: d.name,
      url: d.url ? `https://${d.url}` : '',
      state: normalizeState(d.state),
      createdAt: new Date(d.created).toISOString(),
      readyAt: d.ready ? new Date(d.ready).toISOString() : null,
      buildDurationMs: computeBuildDuration(d),
      source: d.source ?? 'unknown',
      meta: d.meta
        ? {
            githubCommitSha: d.meta.githubCommitSha,
            githubCommitMessage: d.meta.githubCommitMessage,
            githubRepo: d.meta.githubRepo,
          }
        : undefined,
    }));

    const projects = deriveProjectSummaries(deployments);

    return {
      deployments,
      projects,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      'Vercel deployments fetch failed:',
      err instanceof Error ? err.message : err,
    );
    return {
      deployments: [],
      projects: [],
      timestamp: new Date().toISOString(),
    };
  }
}
