/**
 * GitHub Repository Stats Fetcher
 *
 * Fetches repo-level statistics from the GitHub REST API:
 * - Open PRs, recently merged PRs (7d), average review time
 * - Open issues, recently closed issues (7d)
 * - Recent commits (7d)
 *
 * Requires GITHUB_TOKEN env var.
 */
import { GITHUB_REPO } from '../constants';
import type {
  GithubPR,
  GithubIssue,
  GithubCommit,
  GithubStatsResponse,
} from '../types';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'bai-cc-www';

/** Shared headers for GitHub API requests */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
}

/** ISO date string for N days ago */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

// --------------------------------------------------------------------------
// Pull Requests
// --------------------------------------------------------------------------

interface GitHubPRResponse {
  number: number;
  title: string;
  user?: { login: string };
  state: string;
  created_at: string;
  merged_at: string | null;
  updated_at: string;
}

async function fetchOpenPRs(
  token: string,
  signal: AbortSignal,
): Promise<GitHubPRResponse[]> {
  const response = await fetch(
    `${GITHUB_API}/repos/${GITHUB_REPO}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
    { headers: githubHeaders(token), signal },
  );
  if (!response.ok) return [];
  return (await response.json()) as GitHubPRResponse[];
}

async function fetchRecentlyMergedPRs(
  token: string,
  signal: AbortSignal,
): Promise<GitHubPRResponse[]> {
  // GitHub search API for recently merged PRs
  const since = daysAgo(7);
  const query = encodeURIComponent(
    `repo:${GITHUB_REPO} is:pr is:merged merged:>=${since.slice(0, 10)}`,
  );
  const response = await fetch(
    `${GITHUB_API}/search/issues?q=${query}&per_page=50&sort=updated&order=desc`,
    { headers: githubHeaders(token), signal },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { items?: GitHubPRResponse[] };
  return data.items ?? [];
}

/**
 * Estimate average PR review time in hours.
 * Uses the time from PR creation to merge as a proxy for review time.
 */
function computeAvgReviewTime(
  mergedPRs: GitHubPRResponse[],
): number | null {
  const prsWithMergeTime = mergedPRs.filter((pr) => pr.merged_at && pr.created_at);
  if (prsWithMergeTime.length === 0) return null;

  const totalHours = prsWithMergeTime.reduce((sum, pr) => {
    const created = new Date(pr.created_at).getTime();
    const merged = new Date(pr.merged_at!).getTime();
    return sum + (merged - created) / (1000 * 60 * 60);
  }, 0);

  return Math.round((totalHours / prsWithMergeTime.length) * 10) / 10;
}

// --------------------------------------------------------------------------
// Issues
// --------------------------------------------------------------------------

interface GitHubIssueResponse {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  created_at: string;
  state: string;
  closed_at: string | null;
  pull_request?: unknown; // present if this is actually a PR
}

async function fetchOpenIssues(
  token: string,
  signal: AbortSignal,
): Promise<GitHubIssueResponse[]> {
  const response = await fetch(
    `${GITHUB_API}/repos/${GITHUB_REPO}/issues?state=open&per_page=100&sort=updated&direction=desc`,
    { headers: githubHeaders(token), signal },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as GitHubIssueResponse[];
  // GitHub's issues endpoint includes PRs — filter them out
  return data.filter((i) => !i.pull_request);
}

async function fetchRecentlyClosedIssues(
  token: string,
  signal: AbortSignal,
): Promise<GitHubIssueResponse[]> {
  const since = daysAgo(7);
  const response = await fetch(
    `${GITHUB_API}/repos/${GITHUB_REPO}/issues?state=closed&since=${since}&per_page=50&sort=updated&direction=desc`,
    { headers: githubHeaders(token), signal },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as GitHubIssueResponse[];
  return data.filter((i) => !i.pull_request);
}

// --------------------------------------------------------------------------
// Commits
// --------------------------------------------------------------------------

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author?: { name: string; date: string };
  };
  author?: { login: string };
}

async function fetchRecentCommits(
  token: string,
  signal: AbortSignal,
): Promise<GitHubCommitResponse[]> {
  const since = daysAgo(7);
  const response = await fetch(
    `${GITHUB_API}/repos/${GITHUB_REPO}/commits?since=${since}&per_page=100`,
    { headers: githubHeaders(token), signal },
  );
  if (!response.ok) return [];
  return (await response.json()) as GitHubCommitResponse[];
}

// --------------------------------------------------------------------------
// Main fetcher
// --------------------------------------------------------------------------

/**
 * Fetch comprehensive GitHub repository statistics.
 * Returns empty/zero data if GITHUB_TOKEN is not configured.
 */
export async function fetchGithubStats(): Promise<GithubStatsResponse> {
  const token = import.meta.env.GITHUB_TOKEN;

  const emptyResponse: GithubStatsResponse = {
    pullRequests: {
      open: 0,
      merged7d: 0,
      avgReviewTimeHours: null,
      recent: [],
    },
    issues: {
      open: 0,
      closed7d: 0,
      recent: [],
    },
    commits: {
      count7d: 0,
      recent: [],
    },
    timestamp: new Date().toISOString(),
  };

  if (!token) {
    console.warn('GITHUB_TOKEN not set — GitHub stats will be empty');
    return emptyResponse;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const [openPRs, mergedPRs, openIssues, closedIssues, commits] =
      await Promise.all([
        fetchOpenPRs(token, controller.signal),
        fetchRecentlyMergedPRs(token, controller.signal),
        fetchOpenIssues(token, controller.signal),
        fetchRecentlyClosedIssues(token, controller.signal),
        fetchRecentCommits(token, controller.signal),
      ]);

    clearTimeout(timeout);

    // Map PRs
    const recentPRs: GithubPR[] = [...openPRs, ...mergedPRs]
      .slice(0, 20)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login ?? 'unknown',
        state: pr.state,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
      }));

    // Map issues
    const recentIssues: GithubIssue[] = openIssues.slice(0, 20).map((i) => ({
      number: i.number,
      title: i.title,
      labels: i.labels.map((l) => l.name),
      createdAt: i.created_at,
    }));

    // Map commits
    const recentCommits: GithubCommit[] = commits.slice(0, 20).map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0], // first line only
      author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
      date: c.commit.author?.date ?? '',
    }));

    return {
      pullRequests: {
        open: openPRs.length,
        merged7d: mergedPRs.length,
        avgReviewTimeHours: computeAvgReviewTime(mergedPRs),
        recent: recentPRs,
      },
      issues: {
        open: openIssues.length,
        closed7d: closedIssues.length,
        recent: recentIssues,
      },
      commits: {
        count7d: commits.length,
        recent: recentCommits,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      'GitHub stats fetch failed:',
      err instanceof Error ? err.message : err,
    );
    return emptyResponse;
  }
}
