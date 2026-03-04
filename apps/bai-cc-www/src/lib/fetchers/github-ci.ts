/**
 * GitHub Actions CI Status Fetcher
 *
 * Fetches the latest workflow run for each monitored workflow from the
 * GitHub Actions API. Requires GITHUB_TOKEN env var.
 *
 * Ported from bai-cc-dashboard/functions/scheduled.ts syncCiStatus().
 */
import { MONITORED_WORKFLOWS, GITHUB_REPO } from '../constants';
import type { CiWorkflowEntry, CiStatusResponse } from '../types';

/** Shape of a GitHub Actions workflow run from the API */
interface GitHubWorkflowRun {
  conclusion: string | null;
  status: string;
  html_url: string;
  updated_at: string;
  run_started_at?: string;
  created_at?: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRun[];
}

/**
 * Map GitHub run data to a normalized status.
 */
function resolveStatus(
  run: GitHubWorkflowRun,
): 'success' | 'failure' | 'pending' | 'unknown' {
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'failure') return 'failure';
  if (run.status === 'in_progress' || run.status === 'queued') return 'pending';
  return 'unknown';
}

/**
 * Compute approximate run duration in seconds from GitHub's timestamps.
 */
function computeDuration(run: GitHubWorkflowRun): number | null {
  const startStr = run.run_started_at ?? run.created_at;
  if (!startStr || !run.updated_at) return null;
  const startMs = new Date(startStr).getTime();
  const endMs = new Date(run.updated_at).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return null;
  return Math.round((endMs - startMs) / 1000);
}

/**
 * Fetch latest run for a single workflow.
 */
async function fetchWorkflowStatus(
  workflow: (typeof MONITORED_WORKFLOWS)[number],
  token: string,
): Promise<CiWorkflowEntry> {
  const unknownResult: CiWorkflowEntry = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status: 'unknown',
    conclusion: null,
    runUrl: null,
    updatedAt: null,
    durationSeconds: null,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow.id}/runs?per_page=1&branch=master`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'bai-cc-www',
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(
        `GitHub Actions API ${response.status} for ${workflow.id}`,
      );
      return unknownResult;
    }

    const data = (await response.json()) as GitHubWorkflowRunsResponse;
    const run = data.workflow_runs?.[0];

    if (!run) return unknownResult;

    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      status: resolveStatus(run),
      conclusion: run.conclusion,
      runUrl: run.html_url,
      updatedAt: run.updated_at,
      durationSeconds: computeDuration(run),
    };
  } catch (err) {
    console.warn(
      `GitHub Actions fetch failed for ${workflow.id}:`,
      err instanceof Error ? err.message : err,
    );
    return unknownResult;
  }
}

/**
 * Fetch CI status for all monitored workflows.
 * Returns unknown status for all workflows if GITHUB_TOKEN is not set.
 */
export async function fetchCiStatus(): Promise<CiStatusResponse> {
  const token = import.meta.env.GITHUB_TOKEN;

  if (!token) {
    console.warn('GITHUB_TOKEN not set — CI status will be unknown');
    const workflows: CiWorkflowEntry[] = MONITORED_WORKFLOWS.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      status: 'unknown',
      conclusion: null,
      runUrl: null,
      updatedAt: null,
      durationSeconds: null,
    }));

    return {
      workflows,
      summary: {
        total: workflows.length,
        passing: 0,
        failing: 0,
        pending: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  const workflows = await Promise.all(
    MONITORED_WORKFLOWS.map((w) => fetchWorkflowStatus(w, token)),
  );

  const passing = workflows.filter((w) => w.status === 'success').length;
  const failing = workflows.filter((w) => w.status === 'failure').length;
  const pending = workflows.filter((w) => w.status === 'pending').length;

  return {
    workflows,
    summary: {
      total: workflows.length,
      passing,
      failing,
      pending,
    },
    timestamp: new Date().toISOString(),
  };
}
