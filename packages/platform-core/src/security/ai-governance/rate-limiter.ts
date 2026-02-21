/**
 * AI-Specific Rate Limiting
 * Token-based, cost-based, and quota-based rate limiting for AI models
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  RateLimitConfig,
  RateLimitRule,
  RateLimitStatus,
  RateLimitUsage,
  RemainingQuota,
  BurstConfig,
  CostLimit,
} from './types';

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  enabled: boolean;
  defaultLimits: RateLimitRule[];
  defaultBurstConfig: BurstConfig;
  defaultCostLimits: CostLimit[];
  enforcementMode: 'strict' | 'warn' | 'log-only';
  gracePeriodMs: number;
  cleanupIntervalMs: number;
}

/**
 * Usage window for tracking
 */
interface UsageWindow {
  tokens: number;
  requests: number;
  cost: number;
  windowStart: Date;
  burstTokens: number;
  burstStart?: Date;
}

/**
 * Rate limit storage interface
 */
export interface RateLimitStorage {
  getUsage(key: string): Promise<UsageWindow | null>;
  setUsage(key: string, usage: UsageWindow, ttlSeconds: number): Promise<void>;
  incrementUsage(
    key: string,
    tokens: number,
    cost: number,
    ttlSeconds: number
  ): Promise<UsageWindow>;
  getConfig(modelId: string): Promise<RateLimitConfig | null>;
  setConfig(modelId: string, config: RateLimitConfig): Promise<void>;
}

/**
 * In-memory rate limit storage
 */
export class InMemoryRateLimitStorage implements RateLimitStorage {
  private usage: Map<string, UsageWindow> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs: number = 60000) {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  async getUsage(key: string): Promise<UsageWindow | null> {
    const usage = this.usage.get(key);
    if (!usage) return null;

    // Check if window has expired
    const now = new Date();
    const windowAge = now.getTime() - usage.windowStart.getTime();
    if (windowAge > 3600000) {
      // 1 hour default window
      this.usage.delete(key);
      return null;
    }

    return { ...usage };
  }

  async setUsage(key: string, usage: UsageWindow, _ttlSeconds: number): Promise<void> {
    this.usage.set(key, { ...usage });
  }

  async incrementUsage(
    key: string,
    tokens: number,
    cost: number,
    ttlSeconds: number
  ): Promise<UsageWindow> {
    const existing = await this.getUsage(key);
    const now = new Date();

    if (!existing) {
      const usage: UsageWindow = {
        tokens,
        requests: 1,
        cost,
        windowStart: now,
        burstTokens: tokens,
        burstStart: now,
      };
      await this.setUsage(key, usage, ttlSeconds);
      return usage;
    }

    // Check if we need to reset the window
    const windowAge = now.getTime() - existing.windowStart.getTime();
    if (windowAge > ttlSeconds * 1000) {
      const usage: UsageWindow = {
        tokens,
        requests: 1,
        cost,
        windowStart: now,
        burstTokens: tokens,
        burstStart: now,
      };
      await this.setUsage(key, usage, ttlSeconds);
      return usage;
    }

    // Update existing usage
    existing.tokens += tokens;
    existing.requests += 1;
    existing.cost += cost;

    // Update burst tracking
    const burstAge = existing.burstStart
      ? now.getTime() - existing.burstStart.getTime()
      : Infinity;
    if (burstAge > 60000) {
      // Reset burst window every minute
      existing.burstTokens = tokens;
      existing.burstStart = now;
    } else {
      existing.burstTokens += tokens;
    }

    await this.setUsage(key, existing, ttlSeconds);
    return existing;
  }

  async getConfig(modelId: string): Promise<RateLimitConfig | null> {
    return this.configs.get(modelId) || null;
  }

  async setConfig(modelId: string, config: RateLimitConfig): Promise<void> {
    this.configs.set(modelId, { ...config });
  }

  private cleanup(): void {
    const now = new Date();
    for (const [key, usage] of this.usage.entries()) {
      const age = now.getTime() - usage.windowStart.getTime();
      if (age > 3600000) {
        // Remove entries older than 1 hour
        this.usage.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  status: RateLimitStatus;
  violatedRules: RateLimitRule[];
  warnings: string[];
}

/**
 * AI Rate Limiter
 * Enforces rate limits based on tokens, requests, and cost
 */
export class AIRateLimiter extends EventEmitter {
  private config: RateLimiterConfig;
  private storage: RateLimitStorage;
  private modelConfigs: Map<string, RateLimitConfig> = new Map();

  constructor(config?: Partial<RateLimiterConfig>, storage?: RateLimitStorage) {
    super();
    this.config = {
      enabled: true,
      defaultLimits: [
        { type: 'request', limit: 100, window: 3600, scope: 'user', action: 'block' },
        { type: 'token', limit: 100000, window: 3600, scope: 'user', action: 'block' },
        { type: 'cost', limit: 10, window: 86400, scope: 'user', action: 'block' },
      ],
      defaultBurstConfig: {
        enabled: true,
        maxBurstMultiplier: 2,
        recoveryTimeSeconds: 60,
        burstWindowSeconds: 10,
      },
      defaultCostLimits: [
        {
          scope: 'user',
          dailyLimit: 10,
          monthlyLimit: 100,
          currency: 'USD',
          alertThresholds: [0.5, 0.8, 0.95],
        },
      ],
      enforcementMode: 'strict',
      gracePeriodMs: 1000,
      cleanupIntervalMs: 60000,
      ...config,
    };
    this.storage = storage || new InMemoryRateLimitStorage(this.config.cleanupIntervalMs);
  }

  /**
   * Configure rate limits for a specific model
   */
  async configureModel(modelId: string, config: RateLimitConfig): Promise<void> {
    this.modelConfigs.set(modelId, config);
    await this.storage.setConfig(modelId, config);
  }

  /**
   * Get rate limit configuration for a model
   */
  async getModelConfig(modelId: string): Promise<RateLimitConfig> {
    // Check cache first
    if (this.modelConfigs.has(modelId)) {
      return this.modelConfigs.get(modelId)!;
    }

    // Check storage
    const stored = await this.storage.getConfig(modelId);
    if (stored) {
      this.modelConfigs.set(modelId, stored);
      return stored;
    }

    // Return default config
    return {
      modelId,
      limits: this.config.defaultLimits,
      burstConfig: this.config.defaultBurstConfig,
      costLimits: this.config.defaultCostLimits,
      enforcementMode: this.config.enforcementMode,
    };
  }

  /**
   * Check if a request is allowed
   */
  async checkLimit(
    modelId: string,
    userId: string,
    estimatedTokens: number,
    estimatedCost: number,
    department?: string,
    organization?: string
  ): Promise<RateLimitCheckResult> {
    if (!this.config.enabled) {
      return this.createAllowedResult(modelId, userId);
    }

    const modelConfig = await this.getModelConfig(modelId);
    const violatedRules: RateLimitRule[] = [];
    const warnings: string[] = [];

    // Check each limit rule
    for (const rule of modelConfig.limits) {
      const key = this.buildKey(modelId, rule.scope, userId, department, organization);
      const usage = await this.storage.getUsage(key);

      let currentValue = 0;
      if (usage) {
        switch (rule.type) {
          case 'request':
            currentValue = usage.requests;
            break;
          case 'token':
            currentValue = usage.tokens;
            break;
          case 'cost':
            currentValue = usage.cost;
            break;
        }
      }

      // Check with burst allowance
      let effectiveLimit = rule.limit;
      if (modelConfig.burstConfig.enabled && rule.type === 'token') {
        effectiveLimit = this.calculateBurstLimit(rule.limit, modelConfig.burstConfig, usage);
      }

      // Check estimated value
      const projectedValue = currentValue + (rule.type === 'token' ? estimatedTokens : rule.type === 'cost' ? estimatedCost : 1);

      if (projectedValue > effectiveLimit) {
        if (rule.action === 'block' || modelConfig.enforcementMode === 'strict') {
          violatedRules.push(rule);
        } else {
          warnings.push(
            `${rule.type} limit warning: ${projectedValue}/${effectiveLimit} (${rule.scope})`
          );
        }
      }

      // Check alert thresholds for cost limits
      if (rule.type === 'cost') {
        const costLimit = modelConfig.costLimits.find((c) => c.scope === rule.scope);
        if (costLimit) {
          const dailyUsage = usage?.cost || 0;
          const dailyRatio = dailyUsage / costLimit.dailyLimit;

          for (const threshold of costLimit.alertThresholds) {
            if (dailyRatio >= threshold && dailyRatio - (estimatedCost / costLimit.dailyLimit) < threshold) {
              this.emit('cost:threshold-reached', {
                modelId,
                userId,
                threshold,
                currentUsage: dailyUsage,
                limit: costLimit.dailyLimit,
              });
            }
          }
        }
      }
    }

    // Determine if request is allowed
    const allowed = violatedRules.length === 0 || this.config.enforcementMode === 'log-only';

    // Build status
    const status = await this.getStatus(modelId, userId, department, organization);

    const result: RateLimitCheckResult = {
      allowed,
      status,
      violatedRules,
      warnings,
    };

    if (!allowed) {
      this.emit('rate-limit:exceeded', {
        modelId,
        userId,
        violatedRules,
        status,
      });
    }

    return result;
  }

  /**
   * Record usage after a successful request
   */
  async recordUsage(
    modelId: string,
    userId: string,
    tokens: number,
    cost: number,
    department?: string,
    organization?: string
  ): Promise<void> {
    const modelConfig = await this.getModelConfig(modelId);

    for (const rule of modelConfig.limits) {
      const key = this.buildKey(modelId, rule.scope, userId, department, organization);
      await this.storage.incrementUsage(key, tokens, cost, rule.window);
    }
  }

  /**
   * Get current rate limit status
   */
  async getStatus(
    modelId: string,
    userId: string,
    department?: string,
    organization?: string
  ): Promise<RateLimitStatus> {
    const modelConfig = await this.getModelConfig(modelId);

    // Get user-level usage
    const userKey = this.buildKey(modelId, 'user', userId);
    const userUsage = await this.storage.getUsage(userKey);

    const currentUsage: RateLimitUsage = {
      tokens: userUsage?.tokens || 0,
      requests: userUsage?.requests || 0,
      cost: userUsage?.cost || 0,
      windowStart: userUsage?.windowStart || new Date(),
    };

    // Calculate remaining quota
    const remainingQuota = this.calculateRemainingQuota(modelConfig, currentUsage);

    // Check if currently limited
    let isLimited = false;
    let retryAfterSeconds: number | undefined;

    for (const rule of modelConfig.limits) {
      const key = this.buildKey(modelId, rule.scope, userId, department, organization);
      const usage = await this.storage.getUsage(key);

      if (usage) {
        let currentValue = 0;
        switch (rule.type) {
          case 'request':
            currentValue = usage.requests;
            break;
          case 'token':
            currentValue = usage.tokens;
            break;
          case 'cost':
            currentValue = usage.cost;
            break;
        }

        if (currentValue >= rule.limit) {
          isLimited = true;
          const windowEndTime = usage.windowStart.getTime() + rule.window * 1000;
          const secondsUntilReset = Math.ceil((windowEndTime - Date.now()) / 1000);
          retryAfterSeconds = retryAfterSeconds
            ? Math.min(retryAfterSeconds, secondsUntilReset)
            : secondsUntilReset;
        }
      }
    }

    // Calculate reset time
    const resetAt = userUsage
      ? new Date(userUsage.windowStart.getTime() + this.getMaxWindow(modelConfig) * 1000)
      : new Date(Date.now() + this.getMaxWindow(modelConfig) * 1000);

    return {
      modelId,
      userId,
      isLimited,
      currentUsage,
      limits: modelConfig.limits,
      resetAt,
      retryAfterSeconds,
      remainingQuota,
    };
  }

  /**
   * Reset rate limits for a user
   */
  async resetLimits(
    modelId: string,
    userId: string,
    department?: string,
    organization?: string
  ): Promise<void> {
    const modelConfig = await this.getModelConfig(modelId);

    for (const rule of modelConfig.limits) {
      const key = this.buildKey(modelId, rule.scope, userId, department, organization);
      await this.storage.setUsage(
        key,
        {
          tokens: 0,
          requests: 0,
          cost: 0,
          windowStart: new Date(),
          burstTokens: 0,
        },
        rule.window
      );
    }
  }

  /**
   * Build storage key for rate limit tracking
   */
  private buildKey(
    modelId: string,
    scope: RateLimitRule['scope'],
    userId: string,
    department?: string,
    organization?: string
  ): string {
    switch (scope) {
      case 'user':
        return `ratelimit:${modelId}:user:${userId}`;
      case 'department':
        return `ratelimit:${modelId}:dept:${department || 'default'}`;
      case 'organization':
        return `ratelimit:${modelId}:org:${organization || 'default'}`;
      case 'global':
        return `ratelimit:${modelId}:global`;
      default:
        return `ratelimit:${modelId}:user:${userId}`;
    }
  }

  /**
   * Calculate effective burst limit
   */
  private calculateBurstLimit(
    baseLimit: number,
    burstConfig: BurstConfig,
    usage: UsageWindow | null
  ): number {
    if (!burstConfig.enabled) return baseLimit;

    // If no recent burst activity, allow burst
    if (!usage?.burstStart) {
      return baseLimit * burstConfig.maxBurstMultiplier;
    }

    const burstAge = Date.now() - usage.burstStart.getTime();
    const burstWindowMs = burstConfig.burstWindowSeconds * 1000;

    // If within burst window and burst tokens used, reduce allowance
    if (burstAge < burstWindowMs) {
      const burstUsedRatio = usage.burstTokens / (baseLimit * burstConfig.maxBurstMultiplier);
      if (burstUsedRatio > 0.5) {
        return baseLimit; // Revert to base limit after heavy burst
      }
    }

    // Check if in recovery period
    const recoveryMs = burstConfig.recoveryTimeSeconds * 1000;
    if (burstAge < recoveryMs && usage.burstTokens > baseLimit) {
      return baseLimit; // No burst during recovery
    }

    return baseLimit * burstConfig.maxBurstMultiplier;
  }

  /**
   * Calculate remaining quota
   */
  private calculateRemainingQuota(
    config: RateLimitConfig,
    currentUsage: RateLimitUsage
  ): RemainingQuota {
    let remainingTokens = Infinity;
    let remainingRequests = Infinity;
    let remainingCostBudget = Infinity;

    for (const rule of config.limits) {
      switch (rule.type) {
        case 'token':
          remainingTokens = Math.min(remainingTokens, rule.limit - currentUsage.tokens);
          break;
        case 'request':
          remainingRequests = Math.min(remainingRequests, rule.limit - currentUsage.requests);
          break;
        case 'cost':
          remainingCostBudget = Math.min(remainingCostBudget, rule.limit - currentUsage.cost);
          break;
      }
    }

    return {
      tokens: Math.max(0, remainingTokens),
      requests: Math.max(0, remainingRequests),
      costBudget: Math.max(0, remainingCostBudget),
    };
  }

  /**
   * Get maximum window from config
   */
  private getMaxWindow(config: RateLimitConfig): number {
    return Math.max(...config.limits.map((l) => l.window));
  }

  /**
   * Create an allowed result when rate limiting is disabled
   */
  private createAllowedResult(modelId: string, userId: string): RateLimitCheckResult {
    return {
      allowed: true,
      status: {
        modelId,
        userId,
        isLimited: false,
        currentUsage: {
          tokens: 0,
          requests: 0,
          cost: 0,
          windowStart: new Date(),
        },
        limits: [],
        resetAt: new Date(),
        remainingQuota: {
          tokens: Infinity,
          requests: Infinity,
          costBudget: Infinity,
        },
      },
      violatedRules: [],
      warnings: [],
    };
  }

  /**
   * Update global configuration
   */
  updateConfig(updates: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  /**
   * Set cost limits for a scope
   */
  async setCostLimits(
    modelId: string,
    costLimits: CostLimit[]
  ): Promise<void> {
    const config = await this.getModelConfig(modelId);
    config.costLimits = costLimits;
    await this.configureModel(modelId, config);
  }

  /**
   * Get usage statistics for a model
   */
  async getModelUsageStats(
    modelId: string,
    scope: RateLimitRule['scope'],
    scopeId?: string
  ): Promise<{
    totalTokens: number;
    totalRequests: number;
    totalCost: number;
    windowStart: Date;
    utilizationPercent: number;
  }> {
    const config = await this.getModelConfig(modelId);
    const key = this.buildKey(modelId, scope, scopeId || 'default');
    const usage = await this.storage.getUsage(key);

    if (!usage) {
      return {
        totalTokens: 0,
        totalRequests: 0,
        totalCost: 0,
        windowStart: new Date(),
        utilizationPercent: 0,
      };
    }

    // Calculate utilization based on primary limit
    const primaryLimit = config.limits.find((l) => l.type === 'token') || config.limits[0];
    let currentValue = 0;
    switch (primaryLimit.type) {
      case 'token':
        currentValue = usage.tokens;
        break;
      case 'request':
        currentValue = usage.requests;
        break;
      case 'cost':
        currentValue = usage.cost;
        break;
    }
    const utilizationPercent = (currentValue / primaryLimit.limit) * 100;

    return {
      totalTokens: usage.tokens,
      totalRequests: usage.requests,
      totalCost: usage.cost,
      windowStart: usage.windowStart,
      utilizationPercent: Math.min(100, utilizationPercent),
    };
  }

  /**
   * Create a temporary limit override
   */
  async createOverride(
    modelId: string,
    userId: string,
    overrideLimits: Partial<RateLimitRule>[],
    durationSeconds: number
  ): Promise<void> {
    const config = await this.getModelConfig(modelId);
    const overrideConfig: RateLimitConfig = {
      ...config,
      limits: config.limits.map((limit) => {
        const override = overrideLimits.find((o) => o.type === limit.type && o.scope === limit.scope);
        return override ? { ...limit, ...override } : limit;
      }),
    };

    // Store override with user-specific key
    const overrideKey = `${modelId}:override:${userId}`;
    this.modelConfigs.set(overrideKey, overrideConfig);

    // Schedule removal of override
    setTimeout(() => {
      this.modelConfigs.delete(overrideKey);
    }, durationSeconds * 1000);
  }

  /**
   * Estimate if a request would exceed limits
   */
  async estimateRequest(
    modelId: string,
    userId: string,
    estimatedTokens: number,
    estimatedCost: number
  ): Promise<{
    wouldExceed: boolean;
    tokensRemaining: number;
    costRemaining: number;
    requestsRemaining: number;
  }> {
    const status = await this.getStatus(modelId, userId);

    return {
      wouldExceed:
        status.remainingQuota.tokens < estimatedTokens ||
        status.remainingQuota.costBudget < estimatedCost ||
        status.remainingQuota.requests < 1,
      tokensRemaining: status.remainingQuota.tokens,
      costRemaining: status.remainingQuota.costBudget,
      requestsRemaining: status.remainingQuota.requests,
    };
  }
}

export default AIRateLimiter;
