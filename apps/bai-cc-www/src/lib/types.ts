/**
 * Shared TypeScript types for all dashboard API responses.
 */

// --- Domain Health ---

export interface DomainHealthEntry {
  domain: string;
  label: string;
  org: 'vorion' | 'agentanchor';
  status: 'up' | 'down' | 'degraded';
  statusCode: number | null;
  responseTimeMs: number;
  sslDaysRemaining: number | null;
  error?: string;
}

export interface DomainHealthResponse {
  domains: DomainHealthEntry[];
  summary: {
    total: number;
    up: number;
    degraded: number;
    down: number;
    avgResponseMs: number;
  };
  timestamp: string;
}

// --- CI/CD Status ---

export interface CiWorkflowEntry {
  id: string;
  name: string;
  description: string;
  status: 'success' | 'failure' | 'pending' | 'unknown';
  conclusion: string | null;
  runUrl: string | null;
  updatedAt: string | null;
  durationSeconds: number | null;
}

export interface CiStatusResponse {
  workflows: CiWorkflowEntry[];
  summary: {
    total: number;
    passing: number;
    failing: number;
    pending: number;
  };
  timestamp: string;
}

// --- npm Stats ---

export interface NpmPackageEntry {
  name: string;
  label: string;
  latestVersion: string;
  weeklyDownloads: number;
  lastPublished: string | null;
  deprecated: boolean;
}

export interface NpmStatsResponse {
  packages: NpmPackageEntry[];
  totalDownloads: number;
  timestamp: string;
}

// --- Vercel Deployments ---

export interface VercelDeploymentEntry {
  uid: string;
  name: string;
  url: string;
  state: 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'CANCELED';
  createdAt: string;
  readyAt: string | null;
  buildDurationMs: number | null;
  source: string;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubRepo?: string;
  };
}

export interface VercelProjectSummary {
  name: string;
  latestState: string;
  url: string;
}

export interface VercelDeploymentsResponse {
  deployments: VercelDeploymentEntry[];
  projects: VercelProjectSummary[];
  timestamp: string;
}

// --- GitHub Stats ---

export interface GithubPR {
  number: number;
  title: string;
  author: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
}

export interface GithubIssue {
  number: number;
  title: string;
  labels: string[];
  createdAt: string;
}

export interface GithubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GithubStatsResponse {
  pullRequests: {
    open: number;
    merged7d: number;
    avgReviewTimeHours: number | null;
    recent: GithubPR[];
  };
  issues: {
    open: number;
    closed7d: number;
    recent: GithubIssue[];
  };
  commits: {
    count7d: number;
    recent: GithubCommit[];
  };
  timestamp: string;
}

// --- Overview (aggregated) ---

export interface OverviewResponse {
  domains: { up: number; total: number; avgLatencyMs: number };
  ci: { passing: number; failing: number; total: number };
  npm: { totalDownloads: number; packageCount: number };
  vercel: { recentDeployments: number; lastDeployState: string };
  github: { openPRs: number; openIssues: number; commits7d: number };
  overallHealth: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
}

// --- Activity Feed ---

export interface ActivityItem {
  type: 'deploy' | 'ci' | 'pr' | 'commit' | 'alert';
  title: string;
  timestamp: string;
  url?: string;
  status?: string;
}
