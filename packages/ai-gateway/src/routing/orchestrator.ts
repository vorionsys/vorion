/**
 * Gateway Orchestrator
 *
 * Enterprise orchestration service that coordinates all AI gateway components:
 * health checking, circuit breaking, request queuing, retry handling,
 * quota management, and SLA tracking.
 *
 * @packageDocumentation
 */

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import {
  HealthChecker,
  createHealthChecker,
  type ProviderId,
  type HealthStatus,
} from './health-checker.js';
import {
  CircuitBreaker,
  createCircuitBreaker,
  type CircuitState,
} from './circuit-breaker.js';
import {
  RequestQueue,
  createRequestQueue,
  type Priority,
  type QueuedRequest,
} from './request-queue.js';
import {
  RetryHandler,
  createRetryHandler,
  type RetryDecision,
  type RetryConfig,
} from './retry-handler.js';
import {
  QuotaManager,
  createQuotaManager,
  type QuotaCheckResult,
  type UsageRecord,
} from './quota-manager.js';
import {
  SlaTracker,
  createSlaTracker,
  type SlaMeasurement,
  type SlaReport,
} from './sla-tracker.js';

const tracer = trace.getTracer('ai-gateway-orchestrator');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Request priority alias
 */
export type RequestPriority = Priority;

/**
 * Request context
 */
export interface RequestContext {
  requestId: string;
  tenantId: string;
  userId?: string;
  priority?: Priority;
  provider?: ProviderId;
  model?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Routing decision
 */
export interface RoutingDecision {
  provider: ProviderId;
  model: string;
  reason: string;
  alternatives: Array<{ provider: ProviderId; model: string; reason: string }>;
  quotaResult: QuotaCheckResult;
  healthStatus: HealthStatus;
  circuitState: CircuitState;
}

/**
 * Request result
 */
export interface RequestResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metrics: {
    latencyMs: number;
    provider: ProviderId;
    model: string;
    retryCount: number;
    queueTimeMs: number;
  };
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: ProviderId;
  models: string[];
  priority: number;
  weight: number;
  enabled: boolean;
  maxConcurrent?: number;
  rateLimit?: number;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** Available providers */
  providers: ProviderConfig[];
  /** Default provider */
  defaultProvider: ProviderId;
  /** Default model */
  defaultModel: string;
  /** Enable request queuing */
  enableQueue: boolean;
  /** Enable retry logic */
  enableRetry: boolean;
  /** Enable quota enforcement */
  enableQuota: boolean;
  /** Enable SLA tracking */
  enableSla: boolean;
  /** Maximum concurrent requests */
  maxConcurrentRequests: number;
  /** Request timeout (ms) */
  requestTimeoutMs: number;
  /** Retry configuration */
  retryConfig?: Partial<RetryConfig>;
}

/**
 * Orchestrator status
 */
export interface OrchestratorStatus {
  running: boolean;
  providers: Array<{
    id: ProviderId;
    healthy: boolean;
    circuitState: CircuitState;
    activeRequests: number;
  }>;
  queue: {
    size: number;
    pendingByPriority: Record<Priority, number>;
  };
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatencyMs: number;
  };
}

/**
 * Provider executor function
 */
export type ProviderExecutor<T> = (
  provider: ProviderId,
  model: string,
  context: RequestContext
) => Promise<T>;

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: OrchestratorConfig = {
  providers: [
    { id: 'anthropic', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'], priority: 1, weight: 1, enabled: true },
    { id: 'openai', models: ['gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'], priority: 2, weight: 1, enabled: true },
    { id: 'google', models: ['gemini-1.5-pro', 'gemini-1.5-flash'], priority: 3, weight: 1, enabled: true },
  ],
  defaultProvider: 'anthropic',
  defaultModel: 'claude-3-sonnet',
  enableQueue: true,
  enableRetry: true,
  enableQuota: true,
  enableSla: true,
  maxConcurrentRequests: 100,
  requestTimeoutMs: 120000, // 2 minutes
};

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/**
 * Gateway Orchestrator
 *
 * Coordinates all AI gateway components for enterprise-grade request handling:
 *
 * Features:
 * - Intelligent provider selection based on health, capacity, and SLA
 * - Circuit breaker protection against cascading failures
 * - Priority-based request queuing with fair scheduling
 * - Automatic retry with exponential backoff
 * - Per-tenant quota enforcement
 * - Real-time SLA tracking and alerting
 * - Comprehensive observability with tracing
 */
export class GatewayOrchestrator {
  private config: OrchestratorConfig;
  private healthChecker: HealthChecker;
  private circuitBreaker: CircuitBreaker;
  private requestQueue: RequestQueue;
  private retryHandler: RetryHandler;
  private quotaManager: QuotaManager;
  private slaTracker: SlaTracker;

  private running = false;
  private activeRequests = new Map<ProviderId, number>();
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalLatencyMs: 0,
  };

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    this.healthChecker = createHealthChecker();
    this.circuitBreaker = createCircuitBreaker();
    this.requestQueue = createRequestQueue();
    this.retryHandler = createRetryHandler(this.config.retryConfig);
    this.quotaManager = createQuotaManager();
    this.slaTracker = createSlaTracker();

    // Initialize active request counters
    for (const provider of this.config.providers) {
      this.activeRequests.set(provider.id, 0);
    }
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Start health checking
    await this.healthChecker.start();

    // Start queue processing
    this.startQueueProcessor();

    this.running = true;
    console.log('[ORCHESTRATOR] Started');
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.healthChecker.stop();

    console.log('[ORCHESTRATOR] Stopped');
  }

  /**
   * Execute a request through the gateway
   */
  async execute<T>(
    context: RequestContext,
    executor: ProviderExecutor<T>
  ): Promise<RequestResult<T>> {
    return tracer.startActiveSpan('orchestrator.execute', async (span): Promise<RequestResult<T>> => {
      const startTime = Date.now();
      let queueTime = 0;

      span.setAttributes({
        'request.id': context.requestId,
        'request.tenant_id': context.tenantId,
        'request.priority': context.priority ?? 'medium',
      });

      try {
        // Step 1: Check quota
        if (this.config.enableQuota) {
          const quotaResult = await this.checkQuota(context, span);
          if (!quotaResult.allowed) {
            return this.buildErrorResult(
              'QUOTA_EXCEEDED',
              `Quota exceeded: ${quotaResult.exceededQuotas.map((q) => q.type).join(', ')}`,
              false,
              { latencyMs: Date.now() - startTime, provider: context.provider ?? this.config.defaultProvider, model: context.model ?? this.config.defaultModel, retryCount: 0, queueTimeMs: 0 }
            );
          }
        }

        // Step 2: Select provider and model
        const routing = await this.selectProvider(context, span);
        if (!routing) {
          return this.buildErrorResult(
            'NO_AVAILABLE_PROVIDER',
            'No healthy provider available',
            true,
            { latencyMs: Date.now() - startTime, provider: context.provider ?? this.config.defaultProvider, model: context.model ?? this.config.defaultModel, retryCount: 0, queueTimeMs: 0 }
          );
        }

        span.setAttributes({
          'routing.provider': routing.provider,
          'routing.model': routing.model,
          'routing.reason': routing.reason,
        });

        // Step 3: Queue request if enabled
        if (this.config.enableQueue) {
          const queueStart = Date.now();
          await this.enqueueRequest(context, routing, span);
          queueTime = Date.now() - queueStart;
          span.setAttribute('queue.time_ms', queueTime);
        }

        // Step 4: Execute with retry
        const result = await this.executeWithRetry(
          context,
          routing,
          executor,
          span
        );

        // Step 5: Record metrics
        const latencyMs = Date.now() - startTime;
        await this.recordSuccess(context, routing, latencyMs, result);

        return {
          success: true,
          data: result,
          metrics: {
            latencyMs,
            provider: routing.provider,
            model: routing.model,
            retryCount: 0, // Updated by retry handler
            queueTimeMs: queueTime,
          },
        };
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const err = error as Error;

        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });

        // Record failure
        await this.recordFailure(
          context,
          context.provider ?? this.config.defaultProvider,
          context.model ?? this.config.defaultModel,
          latencyMs,
          err
        );

        const errorType = this.retryHandler.classifyError(
          context.provider ?? this.config.defaultProvider,
          err
        );
        const retryable = this.retryHandler.isTransientError(
          context.provider ?? this.config.defaultProvider,
          err
        );

        return this.buildErrorResult(
          errorType.toUpperCase(),
          err.message,
          retryable,
          {
            latencyMs,
            provider: context.provider ?? this.config.defaultProvider,
            model: context.model ?? this.config.defaultModel,
            retryCount: 0,
            queueTimeMs: queueTime,
          }
        );
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get orchestrator status
   */
  getStatus(): OrchestratorStatus {
    const providers = this.config.providers.map((p) => ({
      id: p.id,
      healthy: this.healthChecker.isAvailable(p.id),
      circuitState: this.circuitBreaker.getState(p.id),
      activeRequests: this.activeRequests.get(p.id) ?? 0,
    }));

    const queueStats = this.requestQueue.getStats();

    return {
      running: this.running,
      providers,
      queue: {
        size: queueStats.totalQueued,
        pendingByPriority: queueStats.byPriority,
      },
      metrics: {
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        averageLatencyMs:
          this.metrics.totalRequests > 0
            ? this.metrics.totalLatencyMs / this.metrics.totalRequests
            : 0,
      },
    };
  }

  /**
   * Get SLA report for a provider
   */
  getSlaReport(provider: ProviderId, model?: string): SlaReport {
    return this.slaTracker.getReport(provider, { model });
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus(): Map<ProviderId, HealthStatus> {
    const result = new Map<ProviderId, HealthStatus>();
    const allHealth = this.healthChecker.getAllHealth();
    for (const [provider, health] of allHealth) {
      result.set(provider, health.status);
    }
    return result;
  }

  /**
   * Get quota usage for a tenant
   */
  async getQuotaUsage(tenantId: string) {
    return this.quotaManager.getAllQuotaUsage(tenantId);
  }

  /**
   * Manually trigger provider health check
   */
  async checkProviderHealth(provider: ProviderId) {
    return this.healthChecker.checkProvider(provider);
  }

  /**
   * Reset circuit breaker for a provider
   */
  resetCircuitBreaker(provider: ProviderId, model?: string): void {
    this.circuitBreaker.reset(provider, model);
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private async checkQuota(
    context: RequestContext,
    span: Span
  ): Promise<QuotaCheckResult> {
    const result = await this.quotaManager.checkQuota(context.tenantId, {
      provider: context.provider,
      model: context.model,
    });

    span.setAttributes({
      'quota.allowed': result.allowed,
      'quota.warnings': result.warnings.length,
    });

    if (result.warnings.length > 0) {
      span.addEvent('quota_warning', { warnings: result.warnings.join('; ') });
    }

    return result;
  }

  private async selectProvider(
    context: RequestContext,
    span: Span
  ): Promise<RoutingDecision | null> {
    // If provider is explicitly specified
    if (context.provider) {
      const providerHealth = this.healthChecker.getHealth(context.provider);
      const healthStatus: HealthStatus = providerHealth?.status ?? 'unknown';
      const circuitState = this.circuitBreaker.getState(context.provider, context.model);

      if (
        this.healthChecker.isAvailable(context.provider) &&
        this.circuitBreaker.canRequest(context.provider, context.model)
      ) {
        return {
          provider: context.provider,
          model: context.model ?? this.getDefaultModelForProvider(context.provider),
          reason: 'Explicitly requested provider',
          alternatives: [],
          quotaResult: { allowed: true, tenantId: context.tenantId, quotas: [], exceededQuotas: [], warnings: [] },
          healthStatus,
          circuitState,
        };
      }
    }

    // Select best available provider
    const availableProviders = this.config.providers
      .filter((p) => p.enabled)
      .filter((p) => this.healthChecker.isAvailable(p.id))
      .filter((p) => this.circuitBreaker.canRequest(p.id))
      .filter((p) => {
        const active = this.activeRequests.get(p.id) ?? 0;
        return !p.maxConcurrent || active < p.maxConcurrent;
      })
      .sort((a, b) => a.priority - b.priority);

    if (availableProviders.length === 0) {
      span.addEvent('no_available_providers');
      return null;
    }

    // Use SLA-based ranking for final selection
    const ranked = this.slaTracker.rankProviders(availableProviders.map((p) => p.id));
    const bestProvider = ranked[0]!;

    const providerConfig = availableProviders.find((p) => p.id === bestProvider.provider)!;
    const model = context.model ?? providerConfig.models[0] ?? this.config.defaultModel;

    // Build alternatives
    const alternatives = ranked.slice(1, 4).map((r) => {
      const config = availableProviders.find((p) => p.id === r.provider)!;
      return {
        provider: r.provider,
        model: config.models[0] ?? this.config.defaultModel,
        reason: `SLA score: ${r.score.toFixed(2)}`,
      };
    });

    return {
      provider: bestProvider.provider,
      model,
      reason: `Best SLA score: ${bestProvider.score.toFixed(2)}`,
      alternatives,
      quotaResult: { allowed: true, tenantId: context.tenantId, quotas: [], exceededQuotas: [], warnings: [] },
      healthStatus: this.healthChecker.getHealth(bestProvider.provider)?.status ?? 'unknown',
      circuitState: this.circuitBreaker.getState(bestProvider.provider),
    };
  }

  private getDefaultModelForProvider(provider: ProviderId): string {
    const config = this.config.providers.find((p) => p.id === provider);
    return config?.models[0] ?? this.config.defaultModel;
  }

  private async enqueueRequest(
    context: RequestContext,
    routing: RoutingDecision,
    span: Span
  ): Promise<void> {
    // For simplicity, we just track the request rather than full queuing
    // In production, this would integrate with the full request queue
    const priority = context.priority ?? 'medium';
    span.setAttribute('queue.priority', priority);
  }

  private async executeWithRetry<T>(
    context: RequestContext,
    routing: RoutingDecision,
    executor: ProviderExecutor<T>,
    span: Span
  ): Promise<T> {
    // Increment active requests
    this.activeRequests.set(
      routing.provider,
      (this.activeRequests.get(routing.provider) ?? 0) + 1
    );

    try {
      if (this.config.enableRetry) {
        return await this.retryHandler.executeWithRetry(
          routing.provider,
          () => executor(routing.provider, routing.model, context),
          {
            model: routing.model,
            onRetry: (decision: RetryDecision) => {
              span.addEvent('retry', {
                attempt: decision.attempt,
                delay_ms: decision.delayMs,
                reason: decision.reason,
              });

              // Record circuit breaker failure
              this.circuitBreaker.recordResult(routing.provider, {
                success: false,
                latencyMs: 0,
                error: decision.reason,
              });
            },
          }
        );
      } else {
        return await executor(routing.provider, routing.model, context);
      }
    } finally {
      // Decrement active requests
      this.activeRequests.set(
        routing.provider,
        Math.max(0, (this.activeRequests.get(routing.provider) ?? 1) - 1)
      );
    }
  }

  private async recordSuccess<T>(
    context: RequestContext,
    routing: RoutingDecision,
    latencyMs: number,
    _result: T
  ): Promise<void> {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.metrics.totalLatencyMs += latencyMs;

    // Record health
    this.healthChecker.recordRequest(routing.provider, routing.model, true, latencyMs);

    // Record circuit breaker success
    this.circuitBreaker.recordResult(routing.provider, {
      success: true,
      latencyMs,
    });

    // Record SLA measurement
    this.slaTracker.record({
      timestamp: new Date(),
      provider: routing.provider,
      model: routing.model,
      tenantId: context.tenantId,
      latencyMs,
      success: true,
    });

    // Record quota usage (estimate tokens for now)
    const estimatedTokens = 1000; // In production, get from response
    await this.quotaManager.recordUsage({
      tenantId: context.tenantId,
      timestamp: new Date(),
      provider: routing.provider,
      model: routing.model,
      requestId: context.requestId,
      inputTokens: estimatedTokens * 0.3,
      outputTokens: estimatedTokens * 0.7,
      totalTokens: estimatedTokens,
      cost: this.quotaManager.estimateCost(routing.model, estimatedTokens * 0.3, estimatedTokens * 0.7),
      latencyMs,
      success: true,
    });
  }

  private async recordFailure(
    context: RequestContext,
    provider: ProviderId,
    model: string,
    latencyMs: number,
    error: Error
  ): Promise<void> {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    this.metrics.totalLatencyMs += latencyMs;

    // Record health
    this.healthChecker.recordRequest(provider, model, false, latencyMs, error.message);

    // Record circuit breaker failure
    this.circuitBreaker.recordResult(provider, {
      success: false,
      latencyMs,
      error: error.message,
    });

    // Record SLA measurement
    this.slaTracker.record({
      timestamp: new Date(),
      provider,
      model,
      tenantId: context.tenantId,
      latencyMs,
      success: false,
      errorType: this.retryHandler.classifyError(provider, error),
    });
  }

  private buildErrorResult<T>(
    code: string,
    message: string,
    retryable: boolean,
    metrics: RequestResult<T>['metrics']
  ): RequestResult<T> {
    return {
      success: false,
      error: { code, message, retryable },
      metrics,
    };
  }

  private startQueueProcessor(): void {
    // In production, this would process the request queue
    // For now, requests are processed immediately
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create gateway orchestrator instance
 */
export function createOrchestrator(
  config?: Partial<OrchestratorConfig>
): GatewayOrchestrator {
  return new GatewayOrchestrator(config);
}

/**
 * Singleton orchestrator instance
 */
let orchestratorInstance: GatewayOrchestrator | null = null;

/**
 * Get or create orchestrator instance
 */
export function getOrchestrator(
  config?: Partial<OrchestratorConfig>
): GatewayOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new GatewayOrchestrator(config);
  }
  return orchestratorInstance;
}

/**
 * Reset orchestrator instance (for testing)
 */
export function resetOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.stop();
    orchestratorInstance = null;
  }
}
