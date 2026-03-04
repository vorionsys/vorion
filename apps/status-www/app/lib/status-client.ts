/**
 * Status API Client
 *
 * Fetches real-time service health data from the bai-cc-dashboard API.
 * Falls back to direct HTTP checks if the dashboard API is unavailable.
 */

const DASHBOARD_API = 'https://bai-cc.com/api/domains.json';
const FETCH_TIMEOUT_MS = 8000;

export interface ServiceStatus {
  name: string;
  url: string;
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  statusCode: number | null;
  latencyMs: number;
  checkedAt: string;
}

export interface StatusData {
  services: ServiceStatus[];
  overallStatus: 'operational' | 'degraded' | 'outage' | 'unknown';
  lastUpdated: string;
  source: 'dashboard-api' | 'direct-check' | 'fallback';
}

/** Direct health check services if dashboard API is unavailable */
const MONITORED_SERVICES = [
  { name: 'Trust API', url: 'trust.agentanchorai.com', label: 'Trust Portal' },
  { name: 'Logic API', url: 'logic.agentanchorai.com', label: 'Logic Portal' },
  { name: 'Platform API', url: 'api.agentanchorai.com', label: 'AA Platform' },
  { name: 'Cognigate', url: 'cognigate.dev', label: 'Cognigate' },
  { name: 'AgentAnchor', url: 'app.agentanchorai.com', label: 'AgentAnchor' },
  { name: 'Vorion', url: 'vorion.org', label: 'Vorion Main' },
] as const;

function mapDashboardStatus(status: string): ServiceStatus['status'] {
  if (status === 'up') return 'operational';
  if (status === 'degraded') return 'degraded';
  if (status === 'down') return 'outage';
  return 'unknown';
}

function deriveOverallStatus(services: ServiceStatus[]): StatusData['overallStatus'] {
  const hasOutage = services.some((s) => s.status === 'outage');
  const hasDegraded = services.some((s) => s.status === 'degraded');
  if (hasOutage) return services.every((s) => s.status === 'outage') ? 'outage' : 'degraded';
  if (hasDegraded) return 'degraded';
  if (services.every((s) => s.status === 'unknown')) return 'unknown';
  return 'operational';
}

/**
 * Fetch status from the bai-cc-dashboard domains API.
 * This is the primary data source — real health checks run every 5 minutes.
 */
async function fetchFromDashboard(): Promise<StatusData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(DASHBOARD_API, {
      signal: controller.signal,
      next: { revalidate: 60 },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const domains: Array<{
      domain: string;
      label: string;
      status: string;
      statusCode: number | null;
      responseTimeMs: number;
    }> = data.domains ?? [];

    const timestamp = data.timestamp ?? new Date().toISOString();

    // Map dashboard domains to our monitored services
    const services: ServiceStatus[] = MONITORED_SERVICES.map((svc) => {
      const match = domains.find((d) => d.domain === svc.url);
      if (match) {
        return {
          name: svc.name,
          url: svc.url,
          status: mapDashboardStatus(match.status),
          statusCode: match.statusCode,
          latencyMs: match.responseTimeMs,
          checkedAt: timestamp,
        };
      }
      return {
        name: svc.name,
        url: svc.url,
        status: 'unknown' as const,
        statusCode: null,
        latencyMs: 0,
        checkedAt: timestamp,
      };
    });

    return {
      services,
      overallStatus: deriveOverallStatus(services),
      lastUpdated: timestamp,
      source: 'dashboard-api',
    };
  } catch {
    return null;
  }
}

/**
 * Direct HTTP health checks as fallback.
 * Used when the dashboard API is unavailable.
 */
async function directHealthChecks(): Promise<StatusData> {
  const now = new Date().toISOString();

  const services = await Promise.all(
    MONITORED_SERVICES.map(async (svc): Promise<ServiceStatus> => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`https://${svc.url}`, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);
        const latencyMs = Date.now() - start;

        return {
          name: svc.name,
          url: svc.url,
          status: response.ok ? (latencyMs > 2000 ? 'degraded' : 'operational') : 'degraded',
          statusCode: response.status,
          latencyMs,
          checkedAt: now,
        };
      } catch {
        return {
          name: svc.name,
          url: svc.url,
          status: 'outage',
          statusCode: null,
          latencyMs: Date.now() - start,
          checkedAt: now,
        };
      }
    })
  );

  return {
    services,
    overallStatus: deriveOverallStatus(services),
    lastUpdated: now,
    source: 'direct-check',
  };
}

/**
 * Get current service status.
 * Tries dashboard API first, falls back to direct health checks.
 */
export async function getServiceStatus(): Promise<StatusData> {
  const dashboardData = await fetchFromDashboard();
  if (dashboardData) return dashboardData;

  return directHealthChecks();
}
