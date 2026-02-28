/**
 * Retry Handler with Exponential Backoff
 *
 * Provides intelligent retry logic for AI provider calls with
 * exponential backoff, jitter, and provider-specific error handling.
 *
 * @packageDocumentation
 */

import type { ProviderId } from "./health-checker.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error classification
 */
export type ErrorType =
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "auth"
  | "invalid_request"
  | "model_overloaded"
  | "context_length"
  | "content_filter"
  | "network"
  | "unknown";

/**
 * Retry decision
 */
export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
  errorType: ErrorType;
  attempt: number;
  maxAttempts: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Enable jitter */
  enableJitter: boolean;
  /** Jitter factor (0-1) */
  jitterFactor: number;
  /** Retryable error types */
  retryableErrors: ErrorType[];
  /** Provider-specific overrides */
  providerOverrides?: Partial<Record<ProviderId, Partial<RetryConfig>>>;
}

/**
 * Retry context
 */
export interface RetryContext {
  provider: ProviderId;
  model?: string;
  attempt: number;
  errors: Array<{
    timestamp: Date;
    errorType: ErrorType;
    message: string;
  }>;
  startTime: Date;
  lastAttemptTime: Date | null;
}

/**
 * Provider error patterns
 */
interface ErrorPattern {
  pattern: RegExp | string;
  type: ErrorType;
  retryable: boolean;
  suggestedDelayMs?: number;
  extractRetryAfter?: (error: string) => number | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  enableJitter: true,
  jitterFactor: 0.3,
  retryableErrors: [
    "rate_limit",
    "timeout",
    "server_error",
    "model_overloaded",
    "network",
  ],
};

/**
 * Provider-specific error patterns
 */
const PROVIDER_ERROR_PATTERNS: Record<ProviderId, ErrorPattern[]> = {
  anthropic: [
    {
      pattern: /rate limit/i,
      type: "rate_limit",
      retryable: true,
      extractRetryAfter: (error) => {
        const match = error.match(/retry after (\d+)/i);
        return match ? parseInt(match[1]!, 10) * 1000 : null;
      },
    },
    {
      pattern: /overloaded/i,
      type: "model_overloaded",
      retryable: true,
      suggestedDelayMs: 30000,
    },
    {
      pattern: /context length/i,
      type: "context_length",
      retryable: false,
    },
    {
      pattern: /invalid.*api.*key/i,
      type: "auth",
      retryable: false,
    },
    {
      pattern: /content.*filter/i,
      type: "content_filter",
      retryable: false,
    },
    {
      pattern: /500|502|503|504/,
      type: "server_error",
      retryable: true,
    },
    {
      pattern: /timeout/i,
      type: "timeout",
      retryable: true,
    },
  ],
  google: [
    {
      pattern: /RESOURCE_EXHAUSTED/i,
      type: "rate_limit",
      retryable: true,
      suggestedDelayMs: 60000,
    },
    {
      pattern: /quota/i,
      type: "rate_limit",
      retryable: true,
    },
    {
      pattern: /UNAVAILABLE/i,
      type: "server_error",
      retryable: true,
    },
    {
      pattern: /DEADLINE_EXCEEDED/i,
      type: "timeout",
      retryable: true,
    },
    {
      pattern: /INVALID_ARGUMENT/i,
      type: "invalid_request",
      retryable: false,
    },
    {
      pattern: /PERMISSION_DENIED/i,
      type: "auth",
      retryable: false,
    },
  ],
  openai: [
    {
      pattern: /rate limit/i,
      type: "rate_limit",
      retryable: true,
      extractRetryAfter: (error) => {
        const match = error.match(/retry after (\d+)/i);
        return match ? parseInt(match[1]!, 10) * 1000 : null;
      },
    },
    {
      pattern: /server_error/i,
      type: "server_error",
      retryable: true,
    },
    {
      pattern: /context_length/i,
      type: "context_length",
      retryable: false,
    },
    {
      pattern: /invalid.*api.*key/i,
      type: "auth",
      retryable: false,
    },
    {
      pattern: /content.*policy/i,
      type: "content_filter",
      retryable: false,
    },
    {
      pattern: /model.*overloaded/i,
      type: "model_overloaded",
      retryable: true,
      suggestedDelayMs: 30000,
    },
  ],
  ollama: [
    {
      pattern: /connection refused/i,
      type: "network",
      retryable: true,
      suggestedDelayMs: 5000,
    },
    {
      pattern: /ECONNREFUSED/i,
      type: "network",
      retryable: true,
    },
    {
      pattern: /model.*not found/i,
      type: "invalid_request",
      retryable: false,
    },
    {
      pattern: /timeout/i,
      type: "timeout",
      retryable: true,
    },
  ],
  azure: [
    {
      pattern: /429/,
      type: "rate_limit",
      retryable: true,
    },
    {
      pattern: /500|502|503|504/,
      type: "server_error",
      retryable: true,
    },
    {
      pattern: /unauthorized/i,
      type: "auth",
      retryable: false,
    },
  ],
  bedrock: [
    {
      pattern: /ThrottlingException/i,
      type: "rate_limit",
      retryable: true,
    },
    {
      pattern: /ServiceUnavailable/i,
      type: "server_error",
      retryable: true,
    },
    {
      pattern: /ModelTimeoutException/i,
      type: "timeout",
      retryable: true,
    },
    {
      pattern: /ValidationException/i,
      type: "invalid_request",
      retryable: false,
    },
  ],
};

// =============================================================================
// RETRY HANDLER
// =============================================================================

/**
 * Retry Handler with Exponential Backoff
 *
 * Features:
 * - Provider-specific error classification
 * - Exponential backoff with configurable multiplier
 * - Jitter to prevent thundering herd
 * - Respect Retry-After headers
 * - Non-retryable error detection
 * - Retry context tracking
 */
export class RetryHandler {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create retry context
   */
  createContext(provider: ProviderId, model?: string): RetryContext {
    return {
      provider,
      model,
      attempt: 0,
      errors: [],
      startTime: new Date(),
      lastAttemptTime: null,
    };
  }

  /**
   * Classify error
   */
  classifyError(
    provider: ProviderId,
    error: Error | string,
    statusCode?: number,
  ): ErrorType {
    const errorMessage = typeof error === "string" ? error : error.message;
    const patterns = PROVIDER_ERROR_PATTERNS[provider] ?? [];

    // Check provider-specific patterns
    for (const pattern of patterns) {
      const regex =
        typeof pattern.pattern === "string"
          ? new RegExp(pattern.pattern, "i")
          : pattern.pattern;

      if (regex.test(errorMessage)) {
        return pattern.type;
      }
    }

    // Check status code
    if (statusCode) {
      if (statusCode === 429) return "rate_limit";
      if (statusCode === 401 || statusCode === 403) return "auth";
      if (statusCode >= 500) return "server_error";
      if (statusCode >= 400) return "invalid_request";
    }

    // Generic patterns
    if (/timeout/i.test(errorMessage)) return "timeout";
    if (/network|econnrefused|enotfound/i.test(errorMessage)) return "network";
    if (/rate.*limit|too many requests/i.test(errorMessage))
      return "rate_limit";

    return "unknown";
  }

  /**
   * Decide whether to retry
   */
  shouldRetry(
    context: RetryContext,
    error: Error | string,
    statusCode?: number,
  ): RetryDecision {
    const errorMessage = typeof error === "string" ? error : error.message;
    const errorType = this.classifyError(context.provider, error, statusCode);

    // Update context
    context.attempt++;
    context.errors.push({
      timestamp: new Date(),
      errorType,
      message: errorMessage,
    });
    context.lastAttemptTime = new Date();

    // Get provider-specific config
    const providerConfig = {
      ...this.config,
      ...this.config.providerOverrides?.[context.provider],
    };

    // Check if we've exceeded max attempts
    if (context.attempt >= providerConfig.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Max attempts (${providerConfig.maxAttempts}) exceeded`,
        errorType,
        attempt: context.attempt,
        maxAttempts: providerConfig.maxAttempts,
      };
    }

    // Check if error is retryable
    if (!providerConfig.retryableErrors.includes(errorType)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Error type ${errorType} is not retryable`,
        errorType,
        attempt: context.attempt,
        maxAttempts: providerConfig.maxAttempts,
      };
    }

    // Calculate delay
    const delayMs = this.calculateDelay(context, errorMessage, providerConfig);

    return {
      shouldRetry: true,
      delayMs,
      reason: `Retrying after ${delayMs}ms (attempt ${context.attempt}/${providerConfig.maxAttempts})`,
      errorType,
      attempt: context.attempt,
      maxAttempts: providerConfig.maxAttempts,
    };
  }

  /**
   * Calculate retry delay
   */
  private calculateDelay(
    context: RetryContext,
    errorMessage: string,
    config: RetryConfig,
  ): number {
    // Check for Retry-After in error message
    const patterns = PROVIDER_ERROR_PATTERNS[context.provider] ?? [];
    for (const pattern of patterns) {
      if (pattern.extractRetryAfter) {
        const retryAfter = pattern.extractRetryAfter(errorMessage);
        if (retryAfter !== null) {
          return Math.min(retryAfter, config.maxDelayMs);
        }
      }

      // Check for suggested delay
      const regex =
        typeof pattern.pattern === "string"
          ? new RegExp(pattern.pattern, "i")
          : pattern.pattern;

      if (regex.test(errorMessage) && pattern.suggestedDelayMs) {
        return Math.min(pattern.suggestedDelayMs, config.maxDelayMs);
      }
    }

    // Calculate exponential backoff
    let delay =
      config.initialDelayMs *
      Math.pow(config.backoffMultiplier, context.attempt - 1);

    // Apply jitter
    if (config.enableJitter) {
      const jitter = delay * config.jitterFactor * (Math.random() * 2 - 1);
      delay += jitter;
    }

    // Clamp to max delay
    return Math.min(Math.max(delay, 0), config.maxDelayMs);
  }

  /**
   * Execute with retry
   */
  async executeWithRetry<T>(
    provider: ProviderId,
    operation: () => Promise<T>,
    options?: {
      model?: string;
      onRetry?: (decision: RetryDecision) => void;
    },
  ): Promise<T> {
    const context = this.createContext(provider, options?.model);

    while (true) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        const decision = this.shouldRetry(context, error as Error);

        if (!decision.shouldRetry) {
          throw error;
        }

        // Notify retry callback
        options?.onRetry?.(decision);

        console.log(
          `[RETRY] ${provider}${options?.model ? `:${options.model}` : ""} - ` +
            `${decision.reason}`,
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
      }
    }
  }

  /**
   * Get retry statistics for context
   */
  getContextStats(context: RetryContext): {
    attempts: number;
    totalDurationMs: number;
    errorTypes: Record<ErrorType, number>;
    lastError: string | null;
  } {
    const errorTypes: Record<string, number> = {};
    for (const error of context.errors) {
      errorTypes[error.errorType] = (errorTypes[error.errorType] ?? 0) + 1;
    }

    const lastError = context.errors[context.errors.length - 1];

    return {
      attempts: context.attempt,
      totalDurationMs: Date.now() - context.startTime.getTime(),
      errorTypes: errorTypes as Record<ErrorType, number>,
      lastError: lastError?.message ?? null,
    };
  }

  /**
   * Check if error is transient
   */
  isTransientError(provider: ProviderId, error: Error | string): boolean {
    const errorType = this.classifyError(provider, error);
    return this.config.retryableErrors.includes(errorType);
  }

  /**
   * Get suggested wait time for error
   */
  getSuggestedWaitTime(
    provider: ProviderId,
    error: Error | string,
  ): number | null {
    const errorMessage = typeof error === "string" ? error : error.message;
    const patterns = PROVIDER_ERROR_PATTERNS[provider] ?? [];

    for (const pattern of patterns) {
      const regex =
        typeof pattern.pattern === "string"
          ? new RegExp(pattern.pattern, "i")
          : pattern.pattern;

      if (regex.test(errorMessage)) {
        if (pattern.extractRetryAfter) {
          const retryAfter = pattern.extractRetryAfter(errorMessage);
          if (retryAfter !== null) return retryAfter;
        }
        if (pattern.suggestedDelayMs) {
          return pattern.suggestedDelayMs;
        }
      }
    }

    return null;
  }
}

/**
 * Create retry handler instance
 */
export function createRetryHandler(
  config?: Partial<RetryConfig>,
): RetryHandler {
  return new RetryHandler(config);
}

/**
 * Singleton retry handler instance
 */
export const retryHandler = new RetryHandler();

/**
 * Utility: Sleep with optional jitter
 */
export function sleep(ms: number, jitter: number = 0): Promise<void> {
  const actualMs = jitter > 0 ? ms + ms * jitter * (Math.random() * 2 - 1) : ms;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, actualMs)));
}

/**
 * Utility: Calculate exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 60000,
  multiplier: number = 2,
): number {
  const delay = baseMs * Math.pow(multiplier, attempt - 1);
  return Math.min(delay, maxMs);
}
