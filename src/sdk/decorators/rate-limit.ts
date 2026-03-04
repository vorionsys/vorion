/**
 * Vorion Security SDK - @RateLimit Decorator
 * Rate limiting enforcement for methods
 */

import 'reflect-metadata';
import { RateLimitOptions, EvaluationContext } from '../types';
import { getSecurityContext } from './secured';

// ============================================================================
// Rate Limiter Interface
// ============================================================================

export interface RateLimiter {
  /**
   * Check if request is allowed under rate limit
   */
  isAllowed(key: string, limit: number, windowMs: number): Promise<boolean>;

  /**
   * Get current count for a key
   */
  getCount(key: string): Promise<number>;

  /**
   * Get time until reset
   */
  getTTL(key: string): Promise<number>;

  /**
   * Reset counter for a key
   */
  reset(key: string): Promise<void>;
}

// ============================================================================
// In-Memory Rate Limiter
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter for development/testing
 */
export class InMemoryRateLimiter implements RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async isAllowed(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.store.set(key, entry);
    }

    if (entry.count >= limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  async getCount(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      return 0;
    }
    return entry.count;
  }

  async getTTL(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) {
      return 0;
    }
    return Math.max(0, entry.resetAt - Date.now());
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// ============================================================================
// Redis Rate Limiter
// ============================================================================

export interface RedisClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<number>;
  del(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

/**
 * Redis-based rate limiter using sliding window algorithm
 */
export class RedisRateLimiter implements RateLimiter {
  private client: RedisClient;
  private keyPrefix: string;

  constructor(client: RedisClient, keyPrefix: string = 'vorion:ratelimit:') {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async isAllowed(key: string, limit: number, windowMs: number): Promise<boolean> {
    const redisKey = this.keyPrefix + key;
    const windowSeconds = Math.ceil(windowMs / 1000);

    // Lua script for atomic rate limiting
    const script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])

      -- Remove old entries
      redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)

      -- Count current entries
      local count = redis.call('ZCARD', key)

      if count < limit then
        -- Add new entry
        redis.call('ZADD', key, now, now)
        redis.call('EXPIRE', key, window)
        return 1
      else
        return 0
      end
    `;

    const result = await this.client.eval(
      script,
      [redisKey],
      [limit, windowSeconds, Date.now()]
    );

    return result === 1;
  }

  async getCount(key: string): Promise<number> {
    const redisKey = this.keyPrefix + key;
    const value = await this.client.get(redisKey);
    return value ? parseInt(value, 10) : 0;
  }

  async getTTL(key: string): Promise<number> {
    const redisKey = this.keyPrefix + key;
    const ttl = await this.client.ttl(redisKey);
    return ttl > 0 ? ttl * 1000 : 0;
  }

  async reset(key: string): Promise<void> {
    const redisKey = this.keyPrefix + key;
    await this.client.del(redisKey);
  }
}

// ============================================================================
// Global Rate Limiter Configuration
// ============================================================================

let globalRateLimiter: RateLimiter = new InMemoryRateLimiter();

/**
 * Configure the global rate limiter
 */
export function setRateLimiter(limiter: RateLimiter): void {
  globalRateLimiter = limiter;
}

/**
 * Get the global rate limiter
 */
export function getRateLimiter(): RateLimiter {
  return globalRateLimiter;
}

// ============================================================================
// Rate Limit Exceeded Handler
// ============================================================================

export type RateLimitExceededHandler = (
  context: EvaluationContext,
  options: RateLimitOptions,
  retryAfter: number
) => Promise<void>;

let rateLimitExceededHandler: RateLimitExceededHandler | null = null;

/**
 * Configure rate limit exceeded handler
 */
export function setRateLimitExceededHandler(handler: RateLimitExceededHandler): void {
  rateLimitExceededHandler = handler;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse window string to milliseconds
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid window format: ${window}. Use format like '100ms', '10s', '1m', '1h', '1d'`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

/**
 * Generate rate limit key based on options
 */
async function generateKey(
  context: EvaluationContext,
  options: RateLimitOptions,
  methodName: string
): Promise<string> {
  if (options.customKey) {
    return `${methodName}:${options.customKey(context)}`;
  }

  switch (options.keyBy) {
    case 'ip':
      return `${methodName}:ip:${context.request.ip}`;
    case 'user':
      return `${methodName}:user:${context.user.id}`;
    case 'session':
      return `${methodName}:session:${context.user.sessionId || 'anonymous'}`;
    default:
      return `${methodName}:ip:${context.request.ip}`;
  }
}

// ============================================================================
// Metadata Storage
// ============================================================================

const RATE_LIMIT_METADATA_KEY = Symbol('vorion:rateLimit');

interface RateLimitMetadata {
  options: RateLimitOptions;
}

// ============================================================================
// @RateLimit Decorator
// ============================================================================

/**
 * @RateLimit decorator for rate limiting method calls
 *
 * @example
 * class ApiController {
 *   @RateLimit({ requests: 100, window: '1m' })
 *   async publicEndpoint() {}
 *
 *   @RateLimit({ requests: 10, window: '1s', keyBy: 'user' })
 *   async sensitiveEndpoint() {}
 *
 *   @RateLimit({
 *     requests: 5,
 *     window: '1m',
 *     onExceeded: 'queue',
 *     skipIf: (ctx) => ctx.user.role === 'admin'
 *   })
 *   async throttledEndpoint() {}
 * }
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const methodName = String(propertyKey);
    const originalMethod = descriptor.value;

    // Store metadata
    Reflect.defineMetadata(
      RATE_LIMIT_METADATA_KEY,
      { options },
      target,
      propertyKey
    );

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const context = await getSecurityContext();

      // Check if rate limiting should be skipped
      if (options.skipIf && options.skipIf(context)) {
        return originalMethod.apply(this, args);
      }

      const key = await generateKey(context, options, methodName);
      const windowMs = parseWindow(options.window);
      const limiter = getRateLimiter();

      const isAllowed = await limiter.isAllowed(key, options.requests, windowMs);

      if (!isAllowed) {
        const retryAfter = await limiter.getTTL(key);

        // Call exceeded handler if configured
        if (rateLimitExceededHandler) {
          await rateLimitExceededHandler(context, options, retryAfter);
        }

        // Handle based on onExceeded option
        switch (options.onExceeded) {
          case 'queue':
            // Wait and retry (simplified implementation)
            await new Promise((resolve) => setTimeout(resolve, retryAfter));
            return originalMethod.apply(this, args);

          case 'degrade':
            // Return degraded response (throw specific error for caller to handle)
            throw new RateLimitDegradedError(
              'Rate limit exceeded - degraded mode',
              retryAfter
            );

          case 'deny':
          default:
            throw new RateLimitExceededError(
              `Rate limit exceeded. Retry after ${Math.ceil(retryAfter / 1000)} seconds`,
              retryAfter
            );
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

// ============================================================================
// Errors
// ============================================================================

export class RateLimitExceededError extends Error {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}

export class RateLimitDegradedError extends Error {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'RateLimitDegradedError';
    this.retryAfter = retryAfter;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get rate limit info for a method
 */
export function getRateLimitInfo(
  target: object,
  methodName: string
): RateLimitOptions | undefined {
  const metadata = Reflect.getMetadata(
    RATE_LIMIT_METADATA_KEY,
    target,
    methodName
  ) as RateLimitMetadata | undefined;

  return metadata?.options;
}

/**
 * Check current rate limit status for a key
 */
export async function getRateLimitStatus(
  key: string
): Promise<{ count: number; remaining: number; resetIn: number } | null> {
  const limiter = getRateLimiter();
  const count = await limiter.getCount(key);
  const ttl = await limiter.getTTL(key);

  if (count === 0 && ttl === 0) {
    return null;
  }

  // Note: remaining requires knowing the limit, which isn't stored
  return {
    count,
    remaining: -1, // Unknown without limit
    resetIn: ttl,
  };
}

/**
 * Reset rate limit for a specific key
 */
export async function resetRateLimit(key: string): Promise<void> {
  const limiter = getRateLimiter();
  await limiter.reset(key);
}

/**
 * Create rate limit middleware for Express/Koa
 */
export function createRateLimitMiddleware(options: RateLimitOptions) {
  return async function rateLimitMiddleware(
    req: { ip: string; user?: { id: string } },
    res: { status: (code: number) => { json: (data: unknown) => void }; setHeader: (name: string, value: string) => void },
    next: () => void
  ): Promise<void> {
    const context: EvaluationContext = {
      user: {
        id: req.user?.id || 'anonymous',
      },
      request: {
        ip: req.ip,
      },
    };

    if (options.skipIf && options.skipIf(context)) {
      next();
      return;
    }

    const key = await generateKey(context, options, 'middleware');
    const windowMs = parseWindow(options.window);
    const limiter = getRateLimiter();

    const isAllowed = await limiter.isAllowed(key, options.requests, windowMs);
    const ttl = await limiter.getTTL(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(options.requests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.requests - await limiter.getCount(key))));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + ttl) / 1000)));

    if (!isAllowed) {
      res.setHeader('Retry-After', String(Math.ceil(ttl / 1000)));
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(ttl / 1000),
      });
      return;
    }

    next();
  };
}
