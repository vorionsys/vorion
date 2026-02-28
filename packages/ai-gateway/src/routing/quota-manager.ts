/**
 * Quota Manager
 *
 * Enterprise quota enforcement system for AI gateway.
 * Tracks and enforces per-tenant token/request quotas with
 * support for multiple quota types and billing periods.
 *
 * @packageDocumentation
 */

import type { ProviderId } from "./health-checker.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Quota period types
 */
export type QuotaPeriod = "minute" | "hour" | "day" | "month";

/**
 * Quota types
 */
export type QuotaType =
  | "requests"
  | "tokens"
  | "input_tokens"
  | "output_tokens"
  | "cost";

/**
 * Quota limit definition
 */
export interface QuotaLimit {
  type: QuotaType;
  period: QuotaPeriod;
  limit: number;
  /** Optional soft limit for warnings */
  softLimit?: number;
}

/**
 * Tenant quota configuration
 */
export interface TenantQuotaConfig {
  tenantId: string;
  tier: "free" | "starter" | "professional" | "enterprise" | "unlimited";
  limits: QuotaLimit[];
  /** Provider-specific overrides */
  providerLimits?: Partial<Record<ProviderId, QuotaLimit[]>>;
  /** Model-specific overrides */
  modelLimits?: Record<string, QuotaLimit[]>;
  /** Allow burst above limit temporarily */
  burstAllowed?: boolean;
  /** Burst multiplier (e.g., 1.5 = 50% above limit) */
  burstMultiplier?: number;
  /** Priority for queue scheduling */
  priority?: number;
}

/**
 * Current usage for a quota
 */
export interface QuotaUsage {
  type: QuotaType;
  period: QuotaPeriod;
  current: number;
  limit: number;
  softLimit?: number;
  remaining: number;
  percentUsed: number;
  periodStart: Date;
  periodEnd: Date;
  isExceeded: boolean;
  isSoftLimitExceeded: boolean;
}

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  allowed: boolean;
  tenantId: string;
  quotas: QuotaUsage[];
  exceededQuotas: QuotaUsage[];
  warnings: string[];
  /** Suggested retry time if rate limited */
  retryAfterMs?: number;
  /** Whether burst allowance was used */
  burstUsed?: boolean;
}

/**
 * Usage record
 */
export interface UsageRecord {
  tenantId: string;
  timestamp: Date;
  provider: ProviderId;
  model: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  success: boolean;
}

/**
 * Quota manager configuration
 */
export interface QuotaManagerConfig {
  /** Default limits for tenants without explicit config */
  defaultLimits: QuotaLimit[];
  /** Enable caching of quota checks */
  enableCache: boolean;
  /** Cache TTL in ms */
  cacheTtlMs: number;
  /** Sync interval for distributed usage (ms) */
  syncIntervalMs: number;
  /** Grace period after limit exceeded (ms) */
  gracePeriodMs: number;
}

/**
 * Storage interface for quota persistence
 */
export interface QuotaStorage {
  getTenantConfig(tenantId: string): Promise<TenantQuotaConfig | null>;
  setTenantConfig(config: TenantQuotaConfig): Promise<void>;
  getUsage(
    tenantId: string,
    type: QuotaType,
    period: QuotaPeriod,
  ): Promise<number>;
  incrementUsage(
    tenantId: string,
    type: QuotaType,
    period: QuotaPeriod,
    amount: number,
  ): Promise<number>;
  recordUsage(record: UsageRecord): Promise<void>;
  getUsageHistory(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageRecord[]>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: QuotaManagerConfig = {
  defaultLimits: [
    { type: "requests", period: "minute", limit: 60, softLimit: 50 },
    { type: "requests", period: "hour", limit: 1000, softLimit: 800 },
    { type: "requests", period: "day", limit: 10000, softLimit: 8000 },
    { type: "tokens", period: "minute", limit: 100000, softLimit: 80000 },
    { type: "tokens", period: "day", limit: 1000000, softLimit: 800000 },
  ],
  enableCache: true,
  cacheTtlMs: 5000,
  syncIntervalMs: 10000,
  gracePeriodMs: 60000,
};

/**
 * Tier-based default limits
 */
const TIER_LIMITS: Record<TenantQuotaConfig["tier"], QuotaLimit[]> = {
  free: [
    { type: "requests", period: "minute", limit: 10, softLimit: 8 },
    { type: "requests", period: "day", limit: 100, softLimit: 80 },
    { type: "tokens", period: "day", limit: 50000, softLimit: 40000 },
    { type: "cost", period: "month", limit: 5, softLimit: 4 },
  ],
  starter: [
    { type: "requests", period: "minute", limit: 30, softLimit: 25 },
    { type: "requests", period: "day", limit: 1000, softLimit: 800 },
    { type: "tokens", period: "day", limit: 500000, softLimit: 400000 },
    { type: "cost", period: "month", limit: 50, softLimit: 40 },
  ],
  professional: [
    { type: "requests", period: "minute", limit: 100, softLimit: 80 },
    { type: "requests", period: "day", limit: 10000, softLimit: 8000 },
    { type: "tokens", period: "day", limit: 5000000, softLimit: 4000000 },
    { type: "cost", period: "month", limit: 500, softLimit: 400 },
  ],
  enterprise: [
    { type: "requests", period: "minute", limit: 500, softLimit: 400 },
    { type: "requests", period: "day", limit: 100000, softLimit: 80000 },
    { type: "tokens", period: "day", limit: 50000000, softLimit: 40000000 },
    { type: "cost", period: "month", limit: 5000, softLimit: 4000 },
  ],
  unlimited: [],
};

/**
 * Model cost multipliers (relative to base)
 */
const MODEL_COST_MULTIPLIERS: Record<string, number> = {
  // Anthropic
  "claude-3-opus": 15,
  "claude-3-sonnet": 3,
  "claude-3-haiku": 0.25,
  "claude-3-5-sonnet": 3,
  // OpenAI
  "gpt-4-turbo": 10,
  "gpt-4": 30,
  "gpt-3.5-turbo": 0.5,
  "gpt-4o": 5,
  "gpt-4o-mini": 0.15,
  // Google
  "gemini-1.5-pro": 3.5,
  "gemini-1.5-flash": 0.075,
  "gemini-1.0-pro": 0.5,
  // Default
  default: 1,
};

// =============================================================================
// IN-MEMORY STORAGE (for development/testing)
// =============================================================================

/**
 * In-memory quota storage implementation
 */
export class InMemoryQuotaStorage implements QuotaStorage {
  private configs = new Map<string, TenantQuotaConfig>();
  private usage = new Map<string, number>();
  private history: UsageRecord[] = [];

  private getUsageKey(
    tenantId: string,
    type: QuotaType,
    period: QuotaPeriod,
  ): string {
    const periodStart = this.getPeriodStart(period);
    return `${tenantId}:${type}:${period}:${periodStart.toISOString()}`;
  }

  private getPeriodStart(period: QuotaPeriod): Date {
    const now = new Date();
    switch (period) {
      case "minute":
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
          now.getMinutes(),
        );
      case "hour":
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
        );
      case "day":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "month":
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  async getTenantConfig(tenantId: string): Promise<TenantQuotaConfig | null> {
    return this.configs.get(tenantId) ?? null;
  }

  async setTenantConfig(config: TenantQuotaConfig): Promise<void> {
    this.configs.set(config.tenantId, config);
  }

  async getUsage(
    tenantId: string,
    type: QuotaType,
    period: QuotaPeriod,
  ): Promise<number> {
    const key = this.getUsageKey(tenantId, type, period);
    return this.usage.get(key) ?? 0;
  }

  async incrementUsage(
    tenantId: string,
    type: QuotaType,
    period: QuotaPeriod,
    amount: number,
  ): Promise<number> {
    const key = this.getUsageKey(tenantId, type, period);
    const current = this.usage.get(key) ?? 0;
    const newValue = current + amount;
    this.usage.set(key, newValue);
    return newValue;
  }

  async recordUsage(record: UsageRecord): Promise<void> {
    this.history.push(record);
    // Trim old records (keep last 10000)
    if (this.history.length > 10000) {
      this.history = this.history.slice(-10000);
    }
  }

  async getUsageHistory(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageRecord[]> {
    return this.history.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.timestamp >= startDate &&
        r.timestamp <= endDate,
    );
  }

  // Cleanup old period data
  cleanup(): void {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000 * 32); // 32 days ago

    for (const key of this.usage.keys()) {
      const parts = key.split(":");
      const dateStr = parts[3];
      if (dateStr && new Date(dateStr) < cutoff) {
        this.usage.delete(key);
      }
    }
  }
}

// =============================================================================
// QUOTA MANAGER
// =============================================================================

/**
 * Enterprise Quota Manager
 *
 * Features:
 * - Multi-dimensional quotas (requests, tokens, cost)
 * - Multiple time periods (minute, hour, day, month)
 * - Tier-based default limits
 * - Provider and model-specific overrides
 * - Burst allowance for temporary spikes
 * - Soft limits with warnings
 * - Usage tracking and history
 * - Distributed usage synchronization
 */
export class QuotaManager {
  private config: QuotaManagerConfig;
  private storage: QuotaStorage;
  private configCache = new Map<
    string,
    { config: TenantQuotaConfig; expiry: number }
  >();
  private usageCache = new Map<string, { value: number; expiry: number }>();

  constructor(storage?: QuotaStorage, config?: Partial<QuotaManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage ?? new InMemoryQuotaStorage();
  }

  /**
   * Check if request is allowed under quotas
   */
  async checkQuota(
    tenantId: string,
    options?: {
      provider?: ProviderId;
      model?: string;
      estimatedTokens?: number;
      estimatedCost?: number;
    },
  ): Promise<QuotaCheckResult> {
    const tenantConfig = await this.getTenantConfig(tenantId);
    const limits = this.getEffectiveLimits(
      tenantConfig,
      options?.provider,
      options?.model,
    );

    // Unlimited tier bypasses all checks
    if (tenantConfig.tier === "unlimited") {
      return {
        allowed: true,
        tenantId,
        quotas: [],
        exceededQuotas: [],
        warnings: [],
      };
    }

    const quotas: QuotaUsage[] = [];
    const exceededQuotas: QuotaUsage[] = [];
    const warnings: string[] = [];
    let burstUsed = false;

    for (const limit of limits) {
      const usage = await this.getQuotaUsage(tenantId, limit);
      quotas.push(usage);

      // Check soft limit
      if (usage.isSoftLimitExceeded && !usage.isExceeded) {
        warnings.push(
          `Approaching ${limit.type} limit for ${limit.period}: ` +
            `${usage.current}/${usage.limit} (${usage.percentUsed.toFixed(1)}%)`,
        );
      }

      // Check hard limit
      if (usage.isExceeded) {
        // Check for burst allowance
        if (tenantConfig.burstAllowed && tenantConfig.burstMultiplier) {
          const burstLimit = limit.limit * tenantConfig.burstMultiplier;
          if (usage.current < burstLimit) {
            burstUsed = true;
            warnings.push(
              `Using burst allowance for ${limit.type}: ` +
                `${usage.current}/${burstLimit} (burst)`,
            );
            continue;
          }
        }
        exceededQuotas.push(usage);
      }
    }

    const allowed = exceededQuotas.length === 0;

    // Calculate retry time if not allowed
    let retryAfterMs: number | undefined;
    if (!allowed) {
      const shortestPeriodExceeded = exceededQuotas.reduce((shortest, q) => {
        const periodMs = this.getPeriodMs(q.period);
        return periodMs < this.getPeriodMs(shortest.period) ? q : shortest;
      });
      retryAfterMs = shortestPeriodExceeded.periodEnd.getTime() - Date.now();
    }

    return {
      allowed,
      tenantId,
      quotas,
      exceededQuotas,
      warnings,
      retryAfterMs,
      burstUsed,
    };
  }

  /**
   * Record usage for a request
   */
  async recordUsage(record: UsageRecord): Promise<void> {
    const tenantConfig = await this.getTenantConfig(record.tenantId);

    // Skip recording for unlimited tier
    if (tenantConfig.tier === "unlimited") {
      return;
    }

    // Increment all relevant quota types
    const periods: QuotaPeriod[] = ["minute", "hour", "day", "month"];

    for (const period of periods) {
      // Request count
      await this.storage.incrementUsage(record.tenantId, "requests", period, 1);

      // Token counts
      await this.storage.incrementUsage(
        record.tenantId,
        "tokens",
        period,
        record.totalTokens,
      );
      await this.storage.incrementUsage(
        record.tenantId,
        "input_tokens",
        period,
        record.inputTokens,
      );
      await this.storage.incrementUsage(
        record.tenantId,
        "output_tokens",
        period,
        record.outputTokens,
      );

      // Cost
      await this.storage.incrementUsage(
        record.tenantId,
        "cost",
        period,
        record.cost,
      );

      // Invalidate cache
      this.invalidateUsageCache(record.tenantId, period);
    }

    // Store full record for history
    await this.storage.recordUsage(record);
  }

  /**
   * Get usage for a specific quota
   */
  async getQuotaUsage(
    tenantId: string,
    limit: QuotaLimit,
  ): Promise<QuotaUsage> {
    const cacheKey = `${tenantId}:${limit.type}:${limit.period}`;

    // Check cache
    if (this.config.enableCache) {
      const cached = this.usageCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return this.buildQuotaUsage(cached.value, limit);
      }
    }

    const current = await this.storage.getUsage(
      tenantId,
      limit.type,
      limit.period,
    );

    // Update cache
    if (this.config.enableCache) {
      this.usageCache.set(cacheKey, {
        value: current,
        expiry: Date.now() + this.config.cacheTtlMs,
      });
    }

    return this.buildQuotaUsage(current, limit);
  }

  /**
   * Get all quota usage for a tenant
   */
  async getAllQuotaUsage(tenantId: string): Promise<QuotaUsage[]> {
    const tenantConfig = await this.getTenantConfig(tenantId);
    const limits = this.getEffectiveLimits(tenantConfig);

    const usages: QuotaUsage[] = [];
    for (const limit of limits) {
      usages.push(await this.getQuotaUsage(tenantId, limit));
    }

    return usages;
  }

  /**
   * Get usage history for a tenant
   */
  async getUsageHistory(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageRecord[]> {
    return this.storage.getUsageHistory(tenantId, startDate, endDate);
  }

  /**
   * Set tenant quota configuration
   */
  async setTenantConfig(config: TenantQuotaConfig): Promise<void> {
    await this.storage.setTenantConfig(config);
    this.configCache.delete(config.tenantId);
  }

  /**
   * Get or create tenant configuration
   */
  async getTenantConfig(tenantId: string): Promise<TenantQuotaConfig> {
    // Check cache
    if (this.config.enableCache) {
      const cached = this.configCache.get(tenantId);
      if (cached && cached.expiry > Date.now()) {
        return cached.config;
      }
    }

    let config = await this.storage.getTenantConfig(tenantId);

    if (!config) {
      // Create default config
      config = {
        tenantId,
        tier: "free",
        limits: TIER_LIMITS.free,
      };
    }

    // Update cache
    if (this.config.enableCache) {
      this.configCache.set(tenantId, {
        config,
        expiry: Date.now() + this.config.cacheTtlMs * 10, // Config cached longer
      });
    }

    return config;
  }

  /**
   * Estimate cost for a request
   */
  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const multiplier =
      MODEL_COST_MULTIPLIERS[model] ?? MODEL_COST_MULTIPLIERS.default!;
    // Base cost: $0.001 per 1K tokens, adjusted by model multiplier
    const baseCostPer1K = 0.001;
    const inputCost = (inputTokens / 1000) * baseCostPer1K * multiplier;
    const outputCost = (outputTokens / 1000) * baseCostPer1K * multiplier * 3; // Output typically 3x input
    return inputCost + outputCost;
  }

  /**
   * Get limits for a tier
   */
  getTierLimits(tier: TenantQuotaConfig["tier"]): QuotaLimit[] {
    return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private getEffectiveLimits(
    config: TenantQuotaConfig,
    provider?: ProviderId,
    model?: string,
  ): QuotaLimit[] {
    // Start with tenant's configured limits or tier defaults
    let limits =
      config.limits.length > 0 ? config.limits : TIER_LIMITS[config.tier];

    // Apply provider-specific overrides
    if (provider && config.providerLimits?.[provider]) {
      limits = this.mergeLimits(limits, config.providerLimits[provider]!);
    }

    // Apply model-specific overrides
    if (model && config.modelLimits?.[model]) {
      limits = this.mergeLimits(limits, config.modelLimits[model]!);
    }

    return limits;
  }

  private mergeLimits(
    base: QuotaLimit[],
    overrides: QuotaLimit[],
  ): QuotaLimit[] {
    const merged = new Map<string, QuotaLimit>();

    // Add base limits
    for (const limit of base) {
      merged.set(`${limit.type}:${limit.period}`, limit);
    }

    // Override with specific limits
    for (const limit of overrides) {
      merged.set(`${limit.type}:${limit.period}`, limit);
    }

    return Array.from(merged.values());
  }

  private buildQuotaUsage(current: number, limit: QuotaLimit): QuotaUsage {
    const { periodStart, periodEnd } = this.getPeriodBounds(limit.period);
    const remaining = Math.max(0, limit.limit - current);
    const percentUsed = limit.limit > 0 ? (current / limit.limit) * 100 : 0;

    return {
      type: limit.type,
      period: limit.period,
      current,
      limit: limit.limit,
      softLimit: limit.softLimit,
      remaining,
      percentUsed,
      periodStart,
      periodEnd,
      isExceeded: current >= limit.limit,
      isSoftLimitExceeded:
        limit.softLimit !== undefined && current >= limit.softLimit,
    };
  }

  private getPeriodBounds(period: QuotaPeriod): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    switch (period) {
      case "minute":
        periodStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
          now.getMinutes(),
        );
        periodEnd = new Date(periodStart.getTime() + 60 * 1000);
        break;
      case "hour":
        periodStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours(),
        );
        periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);
        break;
      case "day":
        periodStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
        break;
      case "month":
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
    }

    return { periodStart, periodEnd };
  }

  private getPeriodMs(period: QuotaPeriod): number {
    switch (period) {
      case "minute":
        return 60 * 1000;
      case "hour":
        return 60 * 60 * 1000;
      case "day":
        return 24 * 60 * 60 * 1000;
      case "month":
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private invalidateUsageCache(tenantId: string, period: QuotaPeriod): void {
    const types: QuotaType[] = [
      "requests",
      "tokens",
      "input_tokens",
      "output_tokens",
      "cost",
    ];
    for (const type of types) {
      this.usageCache.delete(`${tenantId}:${type}:${period}`);
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create quota manager instance
 */
export function createQuotaManager(
  storage?: QuotaStorage,
  config?: Partial<QuotaManagerConfig>,
): QuotaManager {
  return new QuotaManager(storage, config);
}

/**
 * Singleton quota manager instance
 */
export const quotaManager = new QuotaManager();

// =============================================================================
// QUOTA MIDDLEWARE HELPER
// =============================================================================

/**
 * Create quota check middleware result
 */
export async function checkQuotaMiddleware(
  tenantId: string,
  manager: QuotaManager,
  options?: {
    provider?: ProviderId;
    model?: string;
    estimatedTokens?: number;
  },
): Promise<{
  allowed: boolean;
  headers: Record<string, string>;
  error?: { code: string; message: string; retryAfter?: number };
}> {
  const result = await manager.checkQuota(tenantId, options);

  // Build rate limit headers
  const headers: Record<string, string> = {};

  // Find the most relevant quota for headers (requests per minute)
  const requestsMinute = result.quotas.find(
    (q) => q.type === "requests" && q.period === "minute",
  );
  if (requestsMinute) {
    headers["X-RateLimit-Limit"] = requestsMinute.limit.toString();
    headers["X-RateLimit-Remaining"] = requestsMinute.remaining.toString();
    headers["X-RateLimit-Reset"] = Math.ceil(
      requestsMinute.periodEnd.getTime() / 1000,
    ).toString();
  }

  if (!result.allowed) {
    const retryAfter = result.retryAfterMs
      ? Math.ceil(result.retryAfterMs / 1000)
      : undefined;

    if (retryAfter) {
      headers["Retry-After"] = retryAfter.toString();
    }

    return {
      allowed: false,
      headers,
      error: {
        code: "QUOTA_EXCEEDED",
        message: `Quota exceeded: ${result.exceededQuotas
          .map((q) => `${q.type} (${q.period})`)
          .join(", ")}`,
        retryAfter,
      },
    };
  }

  // Add warnings header if approaching limits
  if (result.warnings.length > 0) {
    headers["X-RateLimit-Warning"] = result.warnings[0]!;
  }

  return { allowed: true, headers };
}
