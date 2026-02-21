/**
 * Provider Health Checker
 *
 * Monitors AI provider health with active probing and passive tracking.
 * Provides real-time availability information for routing decisions.
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Provider identifier
 */
export type ProviderId = 'anthropic' | 'google' | 'ollama' | 'openai' | 'azure' | 'bedrock';

/**
 * Model identifier (provider:model format)
 */
export type ModelId = string;

/**
 * Health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Provider health record
 */
export interface ProviderHealth {
  provider: ProviderId;
  status: HealthStatus;
  latencyMs: number;
  lastCheck: Date;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  successRate: number; // 0-100
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  errorCounts: Record<string, number>;
  models: Map<string, ModelHealth>;
}

/**
 * Model-specific health
 */
export interface ModelHealth {
  modelId: string;
  status: HealthStatus;
  latencyMs: number;
  successRate: number;
  lastCheck: Date;
  errorRate: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  provider: ProviderId;
  model?: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  errorType?: string;
  timestamp: Date;
}

/**
 * Health checker configuration
 */
export interface HealthCheckerConfig {
  /** Interval between health checks (ms) */
  checkIntervalMs: number;
  /** Timeout for health check requests (ms) */
  checkTimeoutMs: number;
  /** Number of failures before marking unhealthy */
  unhealthyThreshold: number;
  /** Number of successes before marking healthy again */
  recoveryThreshold: number;
  /** Window size for success rate calculation */
  rateWindowSize: number;
  /** Enable active health probing */
  enableActiveProbing: boolean;
  /** Providers to monitor */
  providers: ProviderId[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: HealthCheckerConfig = {
  checkIntervalMs: 30000, // 30 seconds
  checkTimeoutMs: 10000, // 10 seconds
  unhealthyThreshold: 3,
  recoveryThreshold: 2,
  rateWindowSize: 100,
  enableActiveProbing: true,
  providers: ['anthropic', 'google', 'ollama'],
};

/**
 * Provider endpoints for health checks
 */
const PROVIDER_HEALTH_ENDPOINTS: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  google: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/models',
  ollama: 'http://localhost:11434/api/tags',
  azure: '', // Configured per deployment
  bedrock: '', // Uses AWS SDK
};

// =============================================================================
// HEALTH CHECKER
// =============================================================================

/**
 * Provider Health Checker
 *
 * Features:
 * - Active health probing with configurable intervals
 * - Passive tracking from actual requests
 * - Per-model health tracking
 * - Success rate calculation over sliding window
 * - Automatic degraded/unhealthy detection
 * - Recovery detection
 */
export class HealthChecker {
  private config: HealthCheckerConfig;
  private providerHealth: Map<ProviderId, ProviderHealth> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private recentResults: Map<ProviderId, HealthCheckResult[]> = new Map();
  private listeners: Set<(provider: ProviderId, health: ProviderHealth) => void> = new Set();

  constructor(config?: Partial<HealthCheckerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize provider health records
    for (const provider of this.config.providers) {
      this.providerHealth.set(provider, this.createInitialHealth(provider));
      this.recentResults.set(provider, []);
    }
  }

  /**
   * Create initial health record
   */
  private createInitialHealth(provider: ProviderId): ProviderHealth {
    return {
      provider,
      status: 'unknown',
      latencyMs: 0,
      lastCheck: new Date(0),
      lastSuccess: null,
      lastFailure: null,
      successRate: 100,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      errorCounts: {},
      models: new Map(),
    };
  }

  /**
   * Start health checking
   */
  start(): void {
    if (this.checkTimer) {
      return;
    }

    console.log('[HEALTH] Starting health checker...');

    // Run initial check
    this.checkAllProviders();

    // Schedule periodic checks
    if (this.config.enableActiveProbing) {
      this.checkTimer = setInterval(
        () => this.checkAllProviders(),
        this.config.checkIntervalMs
      );
    }
  }

  /**
   * Stop health checking
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    console.log('[HEALTH] Health checker stopped');
  }

  /**
   * Check all providers
   */
  private async checkAllProviders(): Promise<void> {
    const checks = this.config.providers.map((provider) =>
      this.checkProvider(provider).catch((error) => {
        console.error(`[HEALTH] Check failed for ${provider}:`, error);
      })
    );

    await Promise.allSettled(checks);
  }

  /**
   * Check a specific provider
   */
  async checkProvider(provider: ProviderId): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const endpoint = PROVIDER_HEALTH_ENDPOINTS[provider];

    if (!endpoint) {
      return {
        provider,
        healthy: false,
        latencyMs: 0,
        error: 'No health endpoint configured',
        errorType: 'configuration',
        timestamp: new Date(),
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.checkTimeoutMs
      );

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: this.getHealthCheckHeaders(provider),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const healthy = response.status >= 200 && response.status < 500;

      const result: HealthCheckResult = {
        provider,
        healthy,
        latencyMs,
        error: healthy ? undefined : `HTTP ${response.status}`,
        errorType: healthy ? undefined : 'http_error',
        timestamp: new Date(),
      };

      this.recordResult(result);
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      const errorType = this.classifyError(errorMessage);

      const result: HealthCheckResult = {
        provider,
        healthy: false,
        latencyMs,
        error: errorMessage,
        errorType,
        timestamp: new Date(),
      };

      this.recordResult(result);
      return result;
    }
  }

  /**
   * Get headers for health check requests
   */
  private getHealthCheckHeaders(provider: ProviderId): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Vorion-HealthChecker/1.0',
    };

    // Add API keys from environment
    switch (provider) {
      case 'anthropic':
        if (process.env['ANTHROPIC_API_KEY']) {
          headers['x-api-key'] = process.env['ANTHROPIC_API_KEY'];
          headers['anthropic-version'] = '2024-01-01';
        }
        break;
      case 'google':
        if (process.env['GOOGLE_API_KEY']) {
          headers['x-goog-api-key'] = process.env['GOOGLE_API_KEY'];
        }
        break;
      case 'openai':
        if (process.env['OPENAI_API_KEY']) {
          headers['Authorization'] = `Bearer ${process.env['OPENAI_API_KEY']}`;
        }
        break;
    }

    return headers;
  }

  /**
   * Classify error type
   */
  private classifyError(errorMessage: string): string {
    const lower = errorMessage.toLowerCase();

    if (lower.includes('timeout') || lower.includes('abort')) {
      return 'timeout';
    }
    if (lower.includes('econnrefused') || lower.includes('enotfound')) {
      return 'connection';
    }
    if (lower.includes('rate limit') || lower.includes('429')) {
      return 'rate_limit';
    }
    if (lower.includes('auth') || lower.includes('401') || lower.includes('403')) {
      return 'auth';
    }
    if (lower.includes('500') || lower.includes('502') || lower.includes('503')) {
      return 'server_error';
    }

    return 'unknown';
  }

  /**
   * Record a health check result
   */
  private recordResult(result: HealthCheckResult): void {
    const health = this.providerHealth.get(result.provider);
    if (!health) return;

    // Update recent results
    const results = this.recentResults.get(result.provider) ?? [];
    results.push(result);
    if (results.length > this.config.rateWindowSize) {
      results.shift();
    }
    this.recentResults.set(result.provider, results);

    // Update health record
    health.lastCheck = result.timestamp;
    health.latencyMs = result.latencyMs;

    if (result.healthy) {
      health.lastSuccess = result.timestamp;
      health.consecutiveSuccesses++;
      health.consecutiveFailures = 0;
    } else {
      health.lastFailure = result.timestamp;
      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;

      // Track error types
      if (result.errorType) {
        health.errorCounts[result.errorType] =
          (health.errorCounts[result.errorType] ?? 0) + 1;
      }
    }

    // Calculate success rate
    const successCount = results.filter((r) => r.healthy).length;
    health.successRate = results.length > 0
      ? (successCount / results.length) * 100
      : 100;

    // Determine status
    health.status = this.determineStatus(health);

    // Notify listeners
    this.notifyListeners(result.provider, health);
  }

  /**
   * Record a request result (passive tracking)
   */
  recordRequest(
    provider: ProviderId,
    model: string,
    success: boolean,
    latencyMs: number,
    error?: string
  ): void {
    const result: HealthCheckResult = {
      provider,
      model,
      healthy: success,
      latencyMs,
      error,
      errorType: error ? this.classifyError(error) : undefined,
      timestamp: new Date(),
    };

    this.recordResult(result);

    // Update model-specific health
    const health = this.providerHealth.get(provider);
    if (health) {
      let modelHealth = health.models.get(model);
      if (!modelHealth) {
        modelHealth = {
          modelId: model,
          status: 'unknown',
          latencyMs: 0,
          successRate: 100,
          lastCheck: new Date(0),
          errorRate: 0,
        };
        health.models.set(model, modelHealth);
      }

      modelHealth.latencyMs = latencyMs;
      modelHealth.lastCheck = result.timestamp;
      modelHealth.status = success ? 'healthy' : 'unhealthy';
    }
  }

  /**
   * Determine health status based on metrics
   */
  private determineStatus(health: ProviderHealth): HealthStatus {
    // Check for unhealthy conditions
    if (health.consecutiveFailures >= this.config.unhealthyThreshold) {
      return 'unhealthy';
    }

    // Check for degraded conditions
    if (health.successRate < 90) {
      return 'degraded';
    }

    if (health.consecutiveFailures > 0) {
      return 'degraded';
    }

    // Check for healthy conditions
    if (health.consecutiveSuccesses >= this.config.recoveryThreshold) {
      return 'healthy';
    }

    // If we have enough data and success rate is good
    if (health.successRate >= 95 && health.lastSuccess) {
      return 'healthy';
    }

    return 'unknown';
  }

  /**
   * Get provider health
   */
  getHealth(provider: ProviderId): ProviderHealth | undefined {
    return this.providerHealth.get(provider);
  }

  /**
   * Get all provider health
   */
  getAllHealth(): Map<ProviderId, ProviderHealth> {
    return new Map(this.providerHealth);
  }

  /**
   * Check if provider is available
   */
  isAvailable(provider: ProviderId): boolean {
    const health = this.providerHealth.get(provider);
    if (!health) return false;

    return health.status === 'healthy' || health.status === 'degraded';
  }

  /**
   * Get available providers sorted by health
   */
  getAvailableProviders(): ProviderId[] {
    const available: Array<{ provider: ProviderId; health: ProviderHealth }> = [];

    for (const [provider, health] of this.providerHealth) {
      if (this.isAvailable(provider)) {
        available.push({ provider, health });
      }
    }

    // Sort by status (healthy first) then by latency
    return available
      .sort((a, b) => {
        if (a.health.status !== b.health.status) {
          return a.health.status === 'healthy' ? -1 : 1;
        }
        return a.health.latencyMs - b.health.latencyMs;
      })
      .map((a) => a.provider);
  }

  /**
   * Add health change listener
   */
  onHealthChange(
    listener: (provider: ProviderId, health: ProviderHealth) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners of health change
   */
  private notifyListeners(provider: ProviderId, health: ProviderHealth): void {
    for (const listener of this.listeners) {
      try {
        listener(provider, health);
      } catch (error) {
        console.error('[HEALTH] Listener error:', error);
      }
    }
  }

  /**
   * Get health summary
   */
  getSummary(): {
    providers: Record<ProviderId, HealthStatus>;
    availableCount: number;
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
  } {
    const providers: Record<string, HealthStatus> = {};
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;

    for (const [provider, health] of this.providerHealth) {
      providers[provider] = health.status;

      switch (health.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
        case 'unhealthy':
          unhealthyCount++;
          break;
      }
    }

    return {
      providers: providers as Record<ProviderId, HealthStatus>,
      availableCount: healthyCount + degradedCount,
      healthyCount,
      degradedCount,
      unhealthyCount,
    };
  }
}

/**
 * Create health checker instance
 */
export function createHealthChecker(
  config?: Partial<HealthCheckerConfig>
): HealthChecker {
  return new HealthChecker(config);
}

/**
 * Singleton health checker instance
 */
export const healthChecker = new HealthChecker();
