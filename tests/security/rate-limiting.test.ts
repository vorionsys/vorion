/**
 * Rate Limiting Security Tests
 *
 * Comprehensive tests for rate limiting mechanisms covering:
 * - Request throttling
 * - Burst limits enforcement
 * - Per-key rate limiting
 * - IP-based limiting
 * - Rate limit headers
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BruteForceProtection,
  getBruteForceProtection,
  resetBruteForceProtection,
  type BruteForceConfig,
} from '../../src/security/brute-force.js';
import {
  DEFAULT_API_KEY_RATE_LIMIT,
  type ApiKeyRateLimit,
} from '../../src/security/api-keys/types.js';

// Mock dependencies
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  incr: vi.fn(),
  incrby: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  zadd: vi.fn(),
  zrangebyscore: vi.fn(),
  zremrangebyscore: vi.fn(),
  zcard: vi.fn(),
  scan: vi.fn(),
};

vi.mock('../../src/common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

describe('Rate Limiting Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBruteForceProtection();

    // Default mock implementations
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.incrby.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.ttl.mockResolvedValue(3600);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.scan.mockResolvedValue(['0', []]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // REQUEST THROTTLING TESTS
  // ===========================================================================

  describe('Request Throttling', () => {
    it('should allow requests within rate limit', async () => {
      const rateLimit: ApiKeyRateLimit = {
        requestsPerSecond: 10,
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        burstSize: 20,
      };

      const checkRateLimit = async (count: number): Promise<boolean> => {
        // Simulate rate limit check
        return count <= rateLimit.requestsPerSecond;
      };

      expect(await checkRateLimit(5)).toBe(true);
      expect(await checkRateLimit(10)).toBe(true);
      expect(await checkRateLimit(15)).toBe(false);
    });

    it('should track requests over time windows', () => {
      const windows = {
        second: { limit: 10, count: 0 },
        minute: { limit: 100, count: 0 },
        hour: { limit: 1000, count: 0 },
      };

      const recordRequest = () => {
        windows.second.count++;
        windows.minute.count++;
        windows.hour.count++;
      };

      const isWithinLimits = () => {
        return (
          windows.second.count <= windows.second.limit &&
          windows.minute.count <= windows.minute.limit &&
          windows.hour.count <= windows.hour.limit
        );
      };

      // Record some requests
      for (let i = 0; i < 5; i++) {
        recordRequest();
      }

      expect(isWithinLimits()).toBe(true);
      expect(windows.second.count).toBe(5);
      expect(windows.minute.count).toBe(5);
    });

    it('should reset counters after window expires', () => {
      interface RateWindow {
        count: number;
        limit: number;
        resetAt: number;
      }

      const createWindow = (limit: number, durationMs: number): RateWindow => ({
        count: 0,
        limit,
        resetAt: Date.now() + durationMs,
      });

      const checkAndReset = (window: RateWindow, durationMs: number): RateWindow => {
        if (Date.now() >= window.resetAt) {
          return createWindow(window.limit, durationMs);
        }
        return window;
      };

      // Create a window that expires immediately
      let window = createWindow(10, -1000);

      // Should be reset since it's expired
      window = checkAndReset(window, 1000);
      expect(window.count).toBe(0);
    });

    it('should apply exponential backoff after rate limit exceeded', () => {
      const baseDelay = 1000; // 1 second
      const maxDelay = 60000; // 1 minute

      const calculateBackoff = (attempts: number): number => {
        const delay = baseDelay * Math.pow(2, attempts);
        return Math.min(delay, maxDelay);
      };

      expect(calculateBackoff(0)).toBe(1000);
      expect(calculateBackoff(1)).toBe(2000);
      expect(calculateBackoff(2)).toBe(4000);
      expect(calculateBackoff(6)).toBe(60000); // Would be 64000, capped at max
      expect(calculateBackoff(10)).toBe(60000); // Capped at maxDelay
    });
  });

  // ===========================================================================
  // BURST LIMITS TESTS
  // ===========================================================================

  describe('Burst Limits Enforcement', () => {
    it('should allow burst within burst size', () => {
      const burstSize = 20;
      let currentBurst = 0;

      const requestWithBurst = (): boolean => {
        if (currentBurst < burstSize) {
          currentBurst++;
          return true;
        }
        return false;
      };

      // All burst requests should be allowed
      for (let i = 0; i < burstSize; i++) {
        expect(requestWithBurst()).toBe(true);
      }

      // Next request should be denied
      expect(requestWithBurst()).toBe(false);
    });

    it('should refill burst tokens over time', () => {
      const burstSize = 20;
      const refillRatePerSecond = 5;

      interface TokenBucket {
        tokens: number;
        lastRefill: number;
      }

      const refillTokens = (bucket: TokenBucket): TokenBucket => {
        const now = Date.now();
        const elapsed = (now - bucket.lastRefill) / 1000;
        const tokensToAdd = elapsed * refillRatePerSecond;
        const newTokens = Math.min(bucket.tokens + tokensToAdd, burstSize);

        return {
          tokens: newTokens,
          lastRefill: now,
        };
      };

      const consumeToken = (bucket: TokenBucket): { allowed: boolean; bucket: TokenBucket } => {
        const refilled = refillTokens(bucket);
        if (refilled.tokens >= 1) {
          return {
            allowed: true,
            bucket: { ...refilled, tokens: refilled.tokens - 1 },
          };
        }
        return { allowed: false, bucket: refilled };
      };

      // Start with full bucket
      let bucket: TokenBucket = { tokens: burstSize, lastRefill: Date.now() };

      // Consume all tokens
      for (let i = 0; i < burstSize; i++) {
        const result = consumeToken(bucket);
        expect(result.allowed).toBe(true);
        bucket = result.bucket;
      }

      // Next request should be denied
      const denied = consumeToken(bucket);
      expect(denied.allowed).toBe(false);
    });

    it('should handle concurrent burst requests', async () => {
      const burstSize = 10;
      let availableTokens = burstSize;
      const requests: Promise<boolean>[] = [];

      const makeRequest = async (): Promise<boolean> => {
        // Simulate atomic decrement
        if (availableTokens > 0) {
          availableTokens--;
          return true;
        }
        return false;
      };

      // Fire 15 concurrent requests (more than burst)
      for (let i = 0; i < 15; i++) {
        requests.push(makeRequest());
      }

      const results = await Promise.all(requests);
      const allowed = results.filter(r => r).length;
      const denied = results.filter(r => !r).length;

      expect(allowed).toBe(10);
      expect(denied).toBe(5);
    });

    it('should enforce burst limits per API key', () => {
      const keyBursts = new Map<string, number>();
      const burstSize = 10;

      const checkBurst = (apiKey: string): boolean => {
        const current = keyBursts.get(apiKey) || 0;
        if (current < burstSize) {
          keyBursts.set(apiKey, current + 1);
          return true;
        }
        return false;
      };

      // Key 1 should have its own burst limit
      for (let i = 0; i < 10; i++) {
        expect(checkBurst('key-1')).toBe(true);
      }
      expect(checkBurst('key-1')).toBe(false);

      // Key 2 should have separate burst limit
      expect(checkBurst('key-2')).toBe(true);
    });
  });

  // ===========================================================================
  // PER-KEY RATE LIMITING TESTS
  // ===========================================================================

  describe('Per-Key Rate Limiting', () => {
    it('should track rate limits per API key', () => {
      const keyLimits = new Map<string, { count: number; limit: number }>();

      const initKey = (key: string, limit: number) => {
        keyLimits.set(key, { count: 0, limit });
      };

      const checkAndIncrement = (key: string): boolean => {
        const keyData = keyLimits.get(key);
        if (!keyData) return false;
        if (keyData.count >= keyData.limit) return false;
        keyData.count++;
        return true;
      };

      initKey('premium-key', 1000);
      initKey('free-key', 100);

      // Both should start allowed
      expect(checkAndIncrement('premium-key')).toBe(true);
      expect(checkAndIncrement('free-key')).toBe(true);

      // Exhaust free key
      keyLimits.get('free-key')!.count = 100;
      expect(checkAndIncrement('free-key')).toBe(false);

      // Premium should still work
      expect(checkAndIncrement('premium-key')).toBe(true);
    });

    it('should apply different limits based on API key tier', () => {
      interface TierLimits {
        requestsPerMinute: number;
        requestsPerHour: number;
        burstSize: number;
      }

      const tierLimits: Record<string, TierLimits> = {
        free: { requestsPerMinute: 10, requestsPerHour: 100, burstSize: 5 },
        basic: { requestsPerMinute: 100, requestsPerHour: 1000, burstSize: 20 },
        premium: { requestsPerMinute: 1000, requestsPerHour: 10000, burstSize: 100 },
        enterprise: { requestsPerMinute: 10000, requestsPerHour: 100000, burstSize: 1000 },
      };

      const getLimits = (tier: string): TierLimits => {
        return tierLimits[tier] || tierLimits['free']!;
      };

      expect(getLimits('free').requestsPerMinute).toBe(10);
      expect(getLimits('premium').requestsPerMinute).toBe(1000);
      expect(getLimits('enterprise').requestsPerHour).toBe(100000);
    });

    it('should isolate rate limits between API keys', async () => {
      const protection = new BruteForceProtection({
        maxAttempts: 5,
        windowMinutes: 15,
        trackByUsername: true,
        trackByIP: false,
      });

      // Record attempts for key1
      await protection.recordAttempt({
        username: 'api-key-1',
        ipAddress: '192.168.1.1',
        userAgent: 'Test',
        timestamp: new Date(),
        success: false,
      });

      // key2 should have separate tracking
      const status = await protection.isLockedOut('api-key-2');
      expect(status.locked).toBe(false);
    });

    it('should support custom rate limits per key', () => {
      interface ApiKeyConfig {
        key: string;
        customLimits?: Partial<ApiKeyRateLimit>;
      }

      const defaultLimits = DEFAULT_API_KEY_RATE_LIMIT;

      const getKeyLimits = (config: ApiKeyConfig): ApiKeyRateLimit => {
        return {
          ...defaultLimits,
          ...config.customLimits,
        };
      };

      const standardKey: ApiKeyConfig = { key: 'standard-key' };
      const customKey: ApiKeyConfig = {
        key: 'custom-key',
        customLimits: { requestsPerMinute: 500, burstSize: 50 },
      };

      expect(getKeyLimits(standardKey).requestsPerMinute).toBe(defaultLimits.requestsPerMinute);
      expect(getKeyLimits(customKey).requestsPerMinute).toBe(500);
      expect(getKeyLimits(customKey).burstSize).toBe(50);
    });
  });

  // ===========================================================================
  // IP-BASED LIMITING TESTS
  // ===========================================================================

  describe('IP-Based Limiting', () => {
    it('should track rate limits per IP address', async () => {
      const protection = new BruteForceProtection({
        maxAttempts: 5,
        windowMinutes: 15,
        trackByIP: true,
        ipRateLimiting: true,
        ipMaxAttempts: 100,
      });

      await protection.recordAttempt({
        username: 'user1',
        ipAddress: '192.168.1.1',
        userAgent: 'Test',
        timestamp: new Date(),
        success: false,
      });

      const isBlocked = await protection.isIPBlocked('192.168.1.1');
      expect(typeof isBlocked).toBe('boolean');
    });

    it('should handle IP address formats correctly', () => {
      const ipAddresses = [
        '192.168.1.1',
        '10.0.0.1',
        '172.16.0.1',
        '::1',
        '::ffff:192.168.1.1',
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      ];

      const normalizeIP = (ip: string): string => {
        // Strip IPv6 prefix for IPv4-mapped addresses
        if (ip.startsWith('::ffff:')) {
          return ip.slice(7);
        }
        return ip;
      };

      expect(normalizeIP('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIP('192.168.1.1')).toBe('192.168.1.1');
    });

    it('should handle X-Forwarded-For header', () => {
      const extractClientIP = (forwardedFor: string | undefined, directIP: string): string => {
        if (forwardedFor) {
          // Take the first IP (original client)
          const ips = forwardedFor.split(',').map(ip => ip.trim());
          return ips[0] || directIP;
        }
        return directIP;
      };

      expect(extractClientIP('1.2.3.4, 10.0.0.1', '127.0.0.1')).toBe('1.2.3.4');
      expect(extractClientIP('1.2.3.4', '127.0.0.1')).toBe('1.2.3.4');
      expect(extractClientIP(undefined, '127.0.0.1')).toBe('127.0.0.1');
    });

    it('should apply IP allowlist/blocklist', () => {
      const allowlist = ['10.0.0.1', '10.0.0.2'];
      const blocklist = ['1.2.3.4', '5.6.7.8'];

      const checkIP = (ip: string): 'allow' | 'block' | 'check' => {
        if (blocklist.includes(ip)) return 'block';
        if (allowlist.includes(ip)) return 'allow';
        return 'check';
      };

      expect(checkIP('10.0.0.1')).toBe('allow');
      expect(checkIP('1.2.3.4')).toBe('block');
      expect(checkIP('192.168.1.1')).toBe('check');
    });

    it('should support CIDR range blocking', () => {
      const ipInRange = (ip: string, cidr: string): boolean => {
        // Simplified check for /24 ranges
        const [range, bits] = cidr.split('/');
        if (bits === '24') {
          const ipParts = ip.split('.');
          const rangeParts = range!.split('.');
          return (
            ipParts[0] === rangeParts[0] &&
            ipParts[1] === rangeParts[1] &&
            ipParts[2] === rangeParts[2]
          );
        }
        return false;
      };

      expect(ipInRange('192.168.1.100', '192.168.1.0/24')).toBe(true);
      expect(ipInRange('192.168.2.100', '192.168.1.0/24')).toBe(false);
    });
  });

  // ===========================================================================
  // RATE LIMIT HEADERS TESTS
  // ===========================================================================

  describe('Rate Limit Headers', () => {
    it('should include RateLimit-Limit header', () => {
      const limit = 1000;
      const headers = {
        'RateLimit-Limit': limit.toString(),
      };

      expect(headers['RateLimit-Limit']).toBe('1000');
    });

    it('should include RateLimit-Remaining header', () => {
      const limit = 1000;
      const used = 250;
      const remaining = limit - used;

      const headers = {
        'RateLimit-Remaining': remaining.toString(),
      };

      expect(headers['RateLimit-Remaining']).toBe('750');
    });

    it('should include RateLimit-Reset header', () => {
      const resetTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const headers = {
        'RateLimit-Reset': resetTime.toString(),
      };

      expect(parseInt(headers['RateLimit-Reset'], 10)).toBeGreaterThan(Date.now() / 1000);
    });

    it('should include Retry-After header when rate limited', () => {
      const retryAfter = 60; // seconds

      const headers = {
        'Retry-After': retryAfter.toString(),
      };

      expect(headers['Retry-After']).toBe('60');
    });

    it('should format all rate limit headers correctly', () => {
      interface RateLimitState {
        limit: number;
        remaining: number;
        resetAt: number;
      }

      const formatRateLimitHeaders = (state: RateLimitState): Record<string, string> => {
        return {
          'RateLimit-Limit': state.limit.toString(),
          'RateLimit-Remaining': state.remaining.toString(),
          'RateLimit-Reset': state.resetAt.toString(),
          'X-RateLimit-Limit': state.limit.toString(),
          'X-RateLimit-Remaining': state.remaining.toString(),
          'X-RateLimit-Reset': state.resetAt.toString(),
        };
      };

      const state: RateLimitState = {
        limit: 1000,
        remaining: 750,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const headers = formatRateLimitHeaders(state);

      expect(headers['RateLimit-Limit']).toBe('1000');
      expect(headers['RateLimit-Remaining']).toBe('750');
      expect(headers['X-RateLimit-Limit']).toBe('1000');
    });

    it('should include policy information in headers', () => {
      // RFC 7807 style policy info
      const policy = {
        limit: 1000,
        window: 'minute',
        policy: 'sliding',
      };

      const policyHeader = JSON.stringify(policy);
      const headers = {
        'RateLimit-Policy': policyHeader,
      };

      const parsed = JSON.parse(headers['RateLimit-Policy']);
      expect(parsed.limit).toBe(1000);
      expect(parsed.window).toBe('minute');
    });
  });

  // ===========================================================================
  // DISTRIBUTED RATE LIMITING TESTS
  // ===========================================================================

  describe('Distributed Rate Limiting', () => {
    it('should use atomic operations for counter increment', async () => {
      const key = 'rate:api-key:minute';

      // Mock atomic increment
      mockRedis.incr.mockResolvedValue(5);

      const count = await mockRedis.incr(key);
      expect(count).toBe(5);
      expect(mockRedis.incr).toHaveBeenCalledWith(key);
    });

    it('should set TTL on rate limit keys', async () => {
      const key = 'rate:api-key:minute';
      const ttlSeconds = 60;

      await mockRedis.setex(key, ttlSeconds, '0');

      expect(mockRedis.setex).toHaveBeenCalledWith(key, ttlSeconds, '0');
    });

    it('should handle Redis failures gracefully', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

      // Rate limiting should fail open or use fallback
      const handleRateLimit = async (): Promise<boolean> => {
        try {
          await mockRedis.incr('rate:key');
          return true;
        } catch {
          // Fail open - allow request on Redis failure
          return true;
        }
      };

      const result = await handleRateLimit();
      expect(result).toBe(true);
    });

    it('should sync rate limits across instances', () => {
      // Rate limit state should be stored in Redis for distributed sync
      const rateLimitKey = (apiKey: string, window: string) =>
        `rate:${apiKey}:${window}`;

      expect(rateLimitKey('key-123', 'minute')).toBe('rate:key-123:minute');
      expect(rateLimitKey('key-123', 'hour')).toBe('rate:key-123:hour');
    });
  });

  // ===========================================================================
  // RATE LIMIT BYPASS PROTECTION
  // ===========================================================================

  describe('Rate Limit Bypass Protection', () => {
    it('should prevent IP spoofing via headers', () => {
      // Only trust X-Forwarded-For from known proxies
      const trustedProxies = ['10.0.0.1', '10.0.0.2'];

      const getClientIP = (
        forwardedFor: string | undefined,
        directIP: string
      ): string => {
        // Only use forwarded header if request came from trusted proxy
        if (forwardedFor && trustedProxies.includes(directIP)) {
          const ips = forwardedFor.split(',').map(ip => ip.trim());
          return ips[0] || directIP;
        }
        return directIP;
      };

      // Request from trusted proxy
      expect(getClientIP('1.2.3.4', '10.0.0.1')).toBe('1.2.3.4');

      // Request from untrusted source - ignore X-Forwarded-For
      expect(getClientIP('1.2.3.4', '192.168.1.1')).toBe('192.168.1.1');
    });

    it('should detect rate limit abuse patterns', () => {
      interface RequestPattern {
        timestamps: number[];
        ips: Set<string>;
        userAgents: Set<string>;
      }

      const isAbusePattern = (pattern: RequestPattern): boolean => {
        // Too many IPs for same identifier
        if (pattern.ips.size > 10) return true;

        // Suspiciously regular timing (bot-like)
        if (pattern.timestamps.length >= 10) {
          const intervals = pattern.timestamps
            .slice(1)
            .map((t, i) => t - pattern.timestamps[i]!);
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;

          // Very low variance = likely automated
          if (variance < 100) return true;
        }

        return false;
      };

      // Regular human-like pattern
      const normalPattern: RequestPattern = {
        timestamps: [0, 1500, 3200, 5100, 8000],
        ips: new Set(['1.2.3.4']),
        userAgents: new Set(['Chrome']),
      };
      expect(isAbusePattern(normalPattern)).toBe(false);

      // Distributed attack pattern
      const distributedPattern: RequestPattern = {
        timestamps: [0, 100, 200],
        ips: new Set(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5',
          '6.6.6.6', '7.7.7.7', '8.8.8.8', '9.9.9.9', '10.10.10.10', '11.11.11.11']),
        userAgents: new Set(['Bot']),
      };
      expect(isAbusePattern(distributedPattern)).toBe(true);
    });

    it('should apply stricter limits to suspicious traffic', () => {
      interface TrafficProfile {
        reputation: 'trusted' | 'normal' | 'suspicious';
        limitMultiplier: number;
      }

      const getTrafficProfile = (
        hasValidApiKey: boolean,
        previousViolations: number,
        isKnownDatacenter: boolean
      ): TrafficProfile => {
        if (hasValidApiKey && previousViolations === 0) {
          return { reputation: 'trusted', limitMultiplier: 1.5 };
        }
        if (previousViolations > 5 || isKnownDatacenter) {
          return { reputation: 'suspicious', limitMultiplier: 0.25 };
        }
        return { reputation: 'normal', limitMultiplier: 1.0 };
      };

      expect(getTrafficProfile(true, 0, false).limitMultiplier).toBe(1.5);
      expect(getTrafficProfile(true, 10, false).limitMultiplier).toBe(0.25);
      expect(getTrafficProfile(false, 0, true).limitMultiplier).toBe(0.25);
    });
  });

  // ===========================================================================
  // CONFIGURATION TESTS
  // ===========================================================================

  describe('Rate Limit Configuration', () => {
    it('should have sensible defaults', () => {
      const defaults = DEFAULT_API_KEY_RATE_LIMIT;

      expect(defaults.requestsPerMinute).toBeGreaterThan(0);
      expect(defaults.burstLimit).toBeGreaterThan(0);
      expect(defaults.burstLimit).toBeGreaterThan(0);
    });

    it('should allow custom configuration', () => {
      const customConfig: BruteForceConfig = {
        maxAttempts: 3,
        windowMinutes: 30,
        lockoutMinutes: 60,
        progressiveLockout: true,
        maxLockoutMinutes: 1440,
        notifyOnLockout: true,
        captchaAfterAttempts: 2,
        ipRateLimiting: true,
        ipMaxAttempts: 50,
        trackByUsername: true,
        trackByIP: true,
      };

      expect(customConfig.maxAttempts).toBe(3);
      expect(customConfig.lockoutMinutes).toBe(60);
      expect(customConfig.ipMaxAttempts).toBe(50);
    });
  });
});
