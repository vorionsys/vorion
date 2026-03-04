/**
 * Cloudflare Scheduled Worker
 *
 * Syncs public dashboard data from Neon PostgreSQL to Cloudflare KV.
 * Runs every 5 minutes via cron trigger.
 *
 * Vorion Satellite Pattern: Edge data sync pipeline
 *
 * Syncs:
 * - Public agent stats and distribution
 * - Public agent list (top 100)
 * - Governance metrics (30-day window)
 * - Domain health checks (HTTP HEAD all 15 domains)
 * - Persistent health check history (service_checks table)
 * - Auto-incident detection (3 consecutive failures)
 * - npm download stats (weekly counts for all @vorionsys packages)
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

interface Env {
  BAI_CC_CACHE: KVNamespace;
  DATABASE_URL: string;
  GITHUB_TOKEN?: string;
  ATSF_API_URL?: string;
  VORION_API_KEY?: string;
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now();
    console.log('Dashboard sync started', { trigger: event.cron });

    try {
      const db = neon(env.DATABASE_URL);

      // Sync all data in parallel for performance
      const [statsResult, agentsResult, governanceResult, domainHealthResult, ciStatusResult, npmStatsResult] = await Promise.all([
        syncPublicStats(db),
        syncPublicAgents(db),
        syncGovernanceMetrics(db),
        syncDomainHealth(),
        syncCiStatus(env.GITHUB_TOKEN),
        syncNpmStats(),
      ]);

      // Write all results to KV in parallel
      await Promise.all([
        env.BAI_CC_CACHE.put(
          'dashboard:public-stats',
          JSON.stringify({
            ...statsResult,
            timestamp: new Date().toISOString(),
            syncDurationMs: Date.now() - startTime,
          }),
          { expirationTtl: 300 }
        ),
        env.BAI_CC_CACHE.put(
          'dashboard:public-agents',
          JSON.stringify({
            agents: agentsResult,
            timestamp: new Date().toISOString(),
          }),
          { expirationTtl: 300 }
        ),
        env.BAI_CC_CACHE.put(
          'dashboard:governance-metrics',
          JSON.stringify({
            ...governanceResult,
            timestamp: new Date().toISOString(),
          }),
          { expirationTtl: 300 }
        ),
        env.BAI_CC_CACHE.put(
          'dashboard:domain-health',
          JSON.stringify({
            domains: domainHealthResult,
            timestamp: new Date().toISOString(),
          }),
          { expirationTtl: 300 }
        ),
        env.BAI_CC_CACHE.put(
          'dashboard:ci-status',
          JSON.stringify({
            workflows: ciStatusResult,
            timestamp: new Date().toISOString(),
          }),
          { expirationTtl: 300 }
        ),
        env.BAI_CC_CACHE.put(
          'dashboard:npm-stats',
          JSON.stringify({
            ...npmStatsResult,
            timestamp: new Date().toISOString(),
          }),
          { expirationTtl: 300 }
        ),
      ]);

      // Persist health checks to DB and detect incidents (non-blocking)
      ctx.waitUntil(
        persistHealthChecks(db, domainHealthResult).catch((err) =>
          console.error('Failed to persist health checks:', err)
        )
      );

      // Enrich governance metrics with atsf-core backend data (non-blocking)
      if (env.ATSF_API_URL) {
        ctx.waitUntil(
          syncAtsfBackend(env).catch((err) =>
            console.error('Failed to sync atsf-core backend:', err)
          )
        );
      }

      // Build unified status object for status-www consumers
      const statusServices = domainHealthResult.map((d: DomainHealthResult) => ({
        name: d.label,
        url: d.domain,
        status: d.status === 'up' ? 'operational' : d.status === 'degraded' ? 'degraded' : 'outage',
        statusCode: d.statusCode,
        latencyMs: d.responseTimeMs,
        checkedAt: new Date().toISOString(),
      }));

      const hasOutage = statusServices.some((s: any) => s.status === 'outage');
      const hasDegraded = statusServices.some((s: any) => s.status === 'degraded');
      const overallStatus = hasOutage ? 'degraded' : hasDegraded ? 'degraded' : 'operational';

      await env.BAI_CC_CACHE.put(
        'dashboard:service-status',
        JSON.stringify({
          services: statusServices,
          overallStatus,
          lastUpdated: new Date().toISOString(),
          source: 'dashboard-api',
        }),
        { expirationTtl: 300 }
      );

      const healthy = domainHealthResult.filter((d: any) => d.status === 'up').length;
      console.log('Dashboard sync completed', {
        agents: statsResult.agents?.total ?? 0,
        governance: governanceResult.totalActions,
        domains: `${healthy}/${domainHealthResult.length} up`,
        npmDownloads: npmStatsResult.totalDownloads,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Dashboard sync failed:', error);

      ctx.waitUntil(
        env.BAI_CC_CACHE.put(
          'dashboard:sync-error',
          JSON.stringify({
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          { expirationTtl: 300 }
        )
      );

      throw error;
    }
  },
};

/**
 * Sync aggregate stats for public dashboard
 */
async function syncPublicStats(db: NeonQueryFunction<false, false>) {
  const agentsResult = await db`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN trust_score >= 650 THEN 1 END)::int as trusted,
      COUNT(CASE WHEN trust_score < 200 THEN 1 END)::int as sandbox,
      ROUND(AVG(trust_score)::numeric, 2) as avg_score,
      MAX(updated_at) as last_update
    FROM agents
    WHERE visible = true AND deleted_at IS NULL
  `;

  const trustDistribution = await db`
    SELECT
      CASE
        WHEN trust_score < 200 THEN 'T0_Sandbox'
        WHEN trust_score < 350 THEN 'T1_Observed'
        WHEN trust_score < 500 THEN 'T2_Provisional'
        WHEN trust_score < 650 THEN 'T3_Monitored'
        WHEN trust_score < 800 THEN 'T4_Standard'
        WHEN trust_score < 876 THEN 'T5_Trusted'
        WHEN trust_score < 951 THEN 'T6_Certified'
        ELSE 'T7_Autonomous'
      END as band,
      COUNT(*)::int as count
    FROM agents
    WHERE visible = true AND deleted_at IS NULL
    GROUP BY band
    ORDER BY MIN(trust_score) ASC
  `;

  return {
    agents: agentsResult[0] ?? { total: 0, trusted: 0, sandbox: 0, avg_score: 0 },
    trustDistribution: trustDistribution ?? [],
    status: 'healthy',
  };
}

/**
 * Sync public agent list (top 100 by trust score)
 */
async function syncPublicAgents(db: NeonQueryFunction<false, false>) {
  const agents = await db`
    SELECT
      id,
      name,
      type,
      trust_score,
      description,
      created_at,
      updated_at,
      COALESCE(total_interactions, 0)::int as action_count,
      CASE
        WHEN COALESCE(total_interactions, 0) > 0
        THEN ROUND((COALESCE(successful_interactions, 0)::numeric / total_interactions) * 100, 1)
        ELSE 0
      END as success_rate
    FROM agents
    WHERE visible = true AND deleted_at IS NULL
    ORDER BY trust_score DESC
    LIMIT 100
  `;

  return agents;
}

/**
 * Sync governance metrics (30-day rolling window)
 */
async function syncGovernanceMetrics(db: NeonQueryFunction<false, false>) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const metricsResult = await db`
    SELECT
      COUNT(*)::int as total_actions,
      COUNT(CASE WHEN status = 'approved' THEN 1 END)::int as approved_actions,
      COUNT(CASE WHEN status = 'escalated' THEN 1 END)::int as escalated_actions,
      COUNT(CASE WHEN status IN ('blocked', 'denied') THEN 1 END)::int as blocked_actions,
      ROUND(AVG(EXTRACT(MILLISECONDS FROM (updated_at - created_at)))::numeric, 0) as avg_response_time_ms
    FROM intents
    WHERE created_at >= ${thirtyDaysAgo.toISOString()}
  `;

  const policyCount = await db`
    SELECT COUNT(*)::int as count
    FROM policies
    WHERE status = 'published'
  `;

  const recentActivity = await db`
    SELECT
      id,
      action_type as action,
      status,
      created_at as timestamp
    FROM intents
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const metrics = metricsResult[0] ?? {
    total_actions: 0,
    approved_actions: 0,
    escalated_actions: 0,
    blocked_actions: 0,
    avg_response_time_ms: 0,
  };

  const totalActions = metrics.total_actions || 1;

  // Ensure percentages always sum to exactly 100% (avoid rounding to 101%)
  const approvalRate = Math.round((metrics.approved_actions / totalActions) * 100);
  const escalationRate = Math.round((metrics.escalated_actions / totalActions) * 100);
  const blockRate = 100 - approvalRate - escalationRate;

  return {
    totalActions: metrics.total_actions,
    approvedActions: metrics.approved_actions,
    escalatedActions: metrics.escalated_actions,
    blockedActions: metrics.blocked_actions,
    approvalRate,
    escalationRate,
    blockRate: Math.max(0, blockRate),
    activePolicies: policyCount[0]?.count ?? 0,
    complianceRate: Math.round(((metrics.approved_actions + metrics.escalated_actions) / totalActions) * 100),
    avgResponseTimeMs: Math.round(metrics.avg_response_time_ms || 0),
    recentActivity: recentActivity ?? [],
    status: 'healthy',
  };
}

/**
 * All Vorion ecosystem domains to health-check
 */
const DOMAINS = [
  { domain: 'vorion.org', label: 'Vorion Main', org: 'vorion' },
  { domain: 'basis.vorion.org', label: 'BASIS Spec', org: 'vorion' },
  { domain: 'carid.vorion.org', label: 'CAR ID', org: 'vorion' },
  { domain: 'atsf.vorion.org', label: 'ATSF Docs', org: 'vorion' },
  { domain: 'learn.vorion.org', label: 'Kaizen', org: 'vorion' },
  { domain: 'car.vorion.org', label: 'CAR Spec', org: 'vorion' },
  { domain: 'aci.vorion.org', label: 'ACI Docs', org: 'vorion' },
  { domain: 'feedback.vorion.org', label: 'Feedback', org: 'vorion' },
  { domain: 'opensource.vorion.org', label: 'Open Source', org: 'vorion' },
  { domain: 'agentanchorai.com', label: 'AgentAnchor', org: 'agentanchor' },
  { domain: 'app.agentanchorai.com', label: 'AA Platform', org: 'agentanchor' },
  { domain: 'trust.agentanchorai.com', label: 'Trust Portal', org: 'agentanchor' },
  { domain: 'logic.agentanchorai.com', label: 'Logic Portal', org: 'agentanchor' },
  { domain: 'cognigate.dev', label: 'Cognigate', org: 'agentanchor' },
  { domain: 'bai-cc.com', label: 'BAI CC', org: 'vorion' },
] as const;

interface DomainHealthResult {
  domain: string;
  label: string;
  org: string;
  status: 'up' | 'down' | 'degraded';
  statusCode: number | null;
  responseTimeMs: number;
  error?: string;
}

/**
 * HTTP HEAD all ecosystem domains in parallel.
 * 3-second timeout per domain. Non-blocking — failures don't crash the sync.
 */
async function syncDomainHealth(): Promise<DomainHealthResult[]> {
  const results = await Promise.all(
    DOMAINS.map(async ({ domain, label, org }): Promise<DomainHealthResult> => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`https://${domain}`, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);
        const responseTimeMs = Date.now() - start;

        return {
          domain,
          label,
          org,
          status: response.ok ? 'up' : 'degraded',
          statusCode: response.status,
          responseTimeMs,
        };
      } catch (err) {
        return {
          domain,
          label,
          org,
          status: 'down',
          statusCode: null,
          responseTimeMs: Date.now() - start,
          error: err instanceof Error ? err.name : 'Unknown',
        };
      }
    })
  );

  return results;
}

// =============================================================================
// CI STATUS (GitHub Actions)
// =============================================================================

const WORKFLOWS = [
  { id: 'ci.yml', name: 'CI', description: 'TypeScript build + lint + typecheck' },
  { id: 'ci-python.yml', name: 'Python CI', description: 'Cognigate API tests' },
  { id: 'secrets-scan.yml', name: 'Secrets Scan', description: 'Credential leak detection' },
  { id: 'deploy.yml', name: 'Deploy', description: 'Production deployment' },
  { id: 'preview.yml', name: 'Preview', description: 'PR preview deployments' },
  { id: 'schema-check.yml', name: 'Schema Check', description: 'Schema drift detection' },
  { id: 'publish-packages.yml', name: 'Publish', description: 'npm package publishing' },
] as const;

interface CiWorkflowStatus {
  id: string;
  name: string;
  description: string;
  status: 'success' | 'failure' | 'pending' | 'unknown';
  conclusion: string | null;
  runUrl: string | null;
  updatedAt: string | null;
}

/**
 * Fetch latest workflow run status from GitHub Actions API.
 * Requires GITHUB_TOKEN secret for API access. Gracefully returns 'unknown'
 * when token is missing or API fails.
 */
// =============================================================================
// NPM DOWNLOAD STATS
// =============================================================================

const NPM_PACKAGES = [
  { name: '@vorionsys/basis', label: 'BASIS Standard' },
  { name: '@vorionsys/shared-constants', label: 'Shared Constants' },
  { name: '@vorionsys/contracts', label: 'Contracts' },
  { name: '@vorionsys/car-spec', label: 'CAR Spec' },
  { name: '@vorionsys/cognigate', label: 'Cognigate SDK' },
  { name: '@vorionsys/atsf-core', label: 'ATSF Core' },
  { name: '@vorionsys/proof-plane', label: 'Proof Plane' },
] as const;

interface NpmPackageStats {
  name: string;
  label: string;
  weeklyDownloads: number;
  error?: string;
}

interface NpmStatsResult {
  packages: NpmPackageStats[];
  totalDownloads: number;
}

/**
 * Fetch weekly download counts from the npm registry API for all @vorionsys packages.
 * Non-blocking — individual package failures don't crash the sync.
 */
async function syncNpmStats(): Promise<NpmStatsResult> {
  const packages = await Promise.all(
    NPM_PACKAGES.map(async (pkg): Promise<NpmPackageStats> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg.name)}`,
          { signal: controller.signal }
        );

        clearTimeout(timeout);

        if (!response.ok) {
          return { name: pkg.name, label: pkg.label, weeklyDownloads: 0, error: `HTTP ${response.status}` };
        }

        const data = await response.json() as { downloads?: number };
        return { name: pkg.name, label: pkg.label, weeklyDownloads: data.downloads ?? 0 };
      } catch (err) {
        return {
          name: pkg.name,
          label: pkg.label,
          weeklyDownloads: 0,
          error: err instanceof Error ? err.name : 'Unknown',
        };
      }
    })
  );

  const totalDownloads = packages.reduce((sum, pkg) => sum + pkg.weeklyDownloads, 0);

  return { packages, totalDownloads };
}

// =============================================================================
// PERSISTENT HEALTH CHECK STORAGE + AUTO-INCIDENT DETECTION
// =============================================================================

/**
 * Persist health check results to the service_checks table and detect incidents.
 *
 * Creates tables if they don't exist (idempotent).
 * Auto-creates incidents when a service has 3 consecutive failures.
 * Auto-resolves incidents when service recovers.
 */
async function persistHealthChecks(
  db: NeonQueryFunction<false, false>,
  results: DomainHealthResult[]
): Promise<void> {
  // Ensure tables exist (idempotent — safe to run every sync)
  await db`
    CREATE TABLE IF NOT EXISTS service_checks (
      id SERIAL PRIMARY KEY,
      service_name TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INT,
      latency_ms INT,
      is_healthy BOOLEAN NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_checks_service_time
    ON service_checks(service_name, checked_at DESC)
  `;
  await db`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT CHECK (severity IN ('critical', 'major', 'minor')),
      status TEXT CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
      affected TEXT[],
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      created_by TEXT DEFAULT 'system',
      updates JSONB DEFAULT '[]'
    )
  `;

  // Insert all health check results
  for (const result of results) {
    await db`
      INSERT INTO service_checks (service_name, url, status_code, latency_ms, is_healthy, checked_at)
      VALUES (${result.domain}, ${`https://${result.domain}`}, ${result.statusCode}, ${result.responseTimeMs}, ${result.status === 'up'}, NOW())
    `;
  }

  // Auto-incident detection: check for 3 consecutive failures per service
  for (const result of results) {
    if (result.status === 'down') {
      // Count recent consecutive failures
      const recentChecks = await db`
        SELECT is_healthy FROM service_checks
        WHERE service_name = ${result.domain}
        ORDER BY checked_at DESC
        LIMIT 3
      `;

      const consecutiveFailures = recentChecks.filter((c: any) => !c.is_healthy).length;

      if (consecutiveFailures >= 3) {
        // Check if there's already an open incident for this service
        const existingIncident = await db`
          SELECT id FROM incidents
          WHERE ${result.domain} = ANY(affected)
            AND status != 'resolved'
          LIMIT 1
        `;

        if (existingIncident.length === 0) {
          await db`
            INSERT INTO incidents (title, severity, status, affected, started_at, created_by)
            VALUES (
              ${`${result.label} is down`},
              'major',
              'investigating',
              ${[result.domain]},
              NOW(),
              'system'
            )
          `;
          console.log(`Auto-incident created: ${result.label} is down (3 consecutive failures)`);
        }
      }
    } else if (result.status === 'up') {
      // Auto-resolve incidents when service recovers
      const openIncidents = await db`
        SELECT id FROM incidents
        WHERE ${result.domain} = ANY(affected)
          AND status != 'resolved'
      `;

      for (const incident of openIncidents) {
        await db`
          UPDATE incidents
          SET status = 'resolved', resolved_at = NOW()
          WHERE id = ${incident.id}
        `;
        console.log(`Auto-resolved incident ${incident.id}: ${result.label} recovered`);
      }
    }
  }

  // Prune old health check data (keep 90 days)
  await db`
    DELETE FROM service_checks
    WHERE checked_at < NOW() - INTERVAL '90 days'
  `;
}

/**
 * Enrich KV governance metrics with live data from atsf-core backend.
 * Non-blocking — failures are logged but don't affect the main sync.
 */
async function syncAtsfBackend(env: Env): Promise<void> {
  const baseUrl = env.ATSF_API_URL!.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.VORION_API_KEY) {
    headers['Authorization'] = `Bearer ${env.VORION_API_KEY}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Fetch health + governance rules in parallel
    const [healthRes, rulesRes] = await Promise.all([
      fetch(`${baseUrl}/health`, { headers, signal: controller.signal }).catch(() => null),
      fetch(`${baseUrl}/api/v1/governance/rules`, { headers, signal: controller.signal }).catch(() => null),
    ]);

    const health = healthRes?.ok ? await healthRes.json() as { status: string } : null;
    const rules = rulesRes?.ok ? await rulesRes.json() as { count: number } : null;

    // Read existing governance metrics from KV and enrich with backend data
    const existing = await env.BAI_CC_CACHE.get('dashboard:governance-metrics', 'json') as Record<string, unknown> | null;
    if (existing) {
      const enriched = {
        ...existing,
        activePolicies: rules?.count ?? existing.activePolicies ?? 0,
        backendStatus: health?.status ?? 'unavailable',
        source: 'atsf-core',
        backendSyncedAt: new Date().toISOString(),
      };
      await env.BAI_CC_CACHE.put(
        'dashboard:governance-metrics',
        JSON.stringify(enriched),
        { expirationTtl: 300 }
      );
    }

    console.log('atsf-core backend sync completed', {
      health: health?.status ?? 'unreachable',
      rulesCount: rules?.count ?? 'n/a',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function syncCiStatus(token?: string): Promise<CiWorkflowStatus[]> {
  if (!token) {
    return WORKFLOWS.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      status: 'unknown' as const,
      conclusion: null,
      runUrl: null,
      updatedAt: null,
    }));
  }

  const results = await Promise.all(
    WORKFLOWS.map(async (workflow): Promise<CiWorkflowStatus> => {
      try {
        const response = await fetch(
          `https://api.github.com/repos/voriongit/vorion/actions/workflows/${workflow.id}/runs?per_page=1&branch=master`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'bai-cc-dashboard',
            },
          }
        );

        if (!response.ok) {
          return {
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            status: 'unknown',
            conclusion: null,
            runUrl: null,
            updatedAt: null,
          };
        }

        const data = await response.json() as { workflow_runs: Array<{ conclusion: string | null; status: string; html_url: string; updated_at: string }> };
        const run = data.workflow_runs?.[0];

        if (!run) {
          return {
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            status: 'unknown',
            conclusion: null,
            runUrl: null,
            updatedAt: null,
          };
        }

        const status = run.conclusion === 'success' ? 'success'
          : run.conclusion === 'failure' ? 'failure'
          : run.status === 'in_progress' || run.status === 'queued' ? 'pending'
          : 'unknown';

        return {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          status,
          conclusion: run.conclusion,
          runUrl: run.html_url,
          updatedAt: run.updated_at,
        };
      } catch {
        return {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          status: 'unknown',
          conclusion: null,
          runUrl: null,
          updatedAt: null,
        };
      }
    })
  );

  return results;
}
