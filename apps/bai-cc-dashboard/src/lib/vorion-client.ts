/**
 * Vorion ATSF-Core API Client
 *
 * Lightweight fetch wrapper for the atsf-core REST API.
 * Used by dashboard API routes and the scheduled worker
 * to pull governance, trust, and agent data from the backend.
 */

export interface VorionClientConfig {
  /** Base URL of the atsf-core API (e.g. "https://api.vorion.org") */
  baseUrl: string;
  /** Optional API key for authenticated requests */
  apiKey?: string;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
}

export interface GovernanceEvaluation {
  result: {
    resultId: string;
    requestId: string;
    decision: string;
    confidence: number;
    rulesEvaluated: unknown[];
    rulesMatched: unknown[];
    explanation: string;
    evaluatedAt: string;
    durationMs: number;
  };
  proofId: string;
  processingTimeMs: number;
}

export interface GovernanceMetrics {
  totalActions: number;
  approvedActions: number;
  escalatedActions: number;
  blockedActions: number;
  approvalRate: number;
  escalationRate: number;
  blockRate: number;
  activePolicies: number;
  complianceRate: number;
  avgResponseTimeMs: number;
  recentActivity: Array<{ id: string; action: string; status: string; timestamp: string }>;
  status: 'healthy' | 'degraded' | 'error';
  timestamp: string;
  source: 'atsf-core';
}

export interface TrustRecord {
  agentId: string;
  score: number | null;
  tier: number | null;
  tierName: string | null;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, { status: string; latencyMs?: number; message?: string }>;
}

export class VorionClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: VorionClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  /**
   * Check if the atsf-core backend is reachable and healthy.
   */
  async getHealth(): Promise<HealthStatus> {
    return this.fetch<HealthStatus>('/health');
  }

  /**
   * Get trust record for an agent.
   */
  async getAgentTrust(agentId: string): Promise<TrustRecord> {
    return this.fetch<TrustRecord>(`/api/v1/trust/${encodeURIComponent(agentId)}`);
  }

  /**
   * Query governance rules.
   */
  async getGovernanceRules(): Promise<{ rules: unknown[]; count: number }> {
    return this.fetch<{ rules: unknown[]; count: number }>('/api/v1/governance/rules');
  }

  /**
   * Fetch governance metrics from the backend.
   * Tries the dedicated metrics endpoint first (real data from PostgreSQL),
   * falls back to constructing partial metrics from health + rules count.
   */
  async getGovernanceMetrics(): Promise<GovernanceMetrics> {
    // Try dedicated metrics endpoint first (served when atsf-core API has DB access)
    try {
      const metrics = await this.fetch<GovernanceMetrics>('/api/v1/governance/metrics');
      return { ...metrics, source: 'atsf-core' };
    } catch {
      // Endpoint not available — fall back to partial data
    }

    const [healthResult, rulesResult] = await Promise.all([
      this.fetch<HealthStatus>('/health').catch(() => null),
      this.fetch<{ rules: unknown[]; count: number }>('/api/v1/governance/rules').catch(() => null),
    ]);

    const activePolicies = rulesResult?.count ?? 0;
    const isHealthy = healthResult?.status === 'healthy';

    return {
      totalActions: 0,
      approvedActions: 0,
      escalatedActions: 0,
      blockedActions: 0,
      approvalRate: 0,
      escalationRate: 0,
      blockRate: 0,
      activePolicies,
      complianceRate: 0,
      avgResponseTimeMs: 0,
      recentActivity: [],
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      source: 'atsf-core',
    };
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(options?.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`ATSF API error: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Create a VorionClient from environment variables.
 * Returns null if ATSF_API_URL is not configured.
 */
export function createVorionClient(env: { ATSF_API_URL?: string; VORION_API_KEY?: string }): VorionClient | null {
  if (!env.ATSF_API_URL) return null;

  return new VorionClient({
    baseUrl: env.ATSF_API_URL,
    apiKey: env.VORION_API_KEY,
    timeoutMs: 5000,
  });
}
