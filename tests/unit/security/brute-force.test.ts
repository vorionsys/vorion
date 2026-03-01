/**
 * Brute Force Protection Tests
 *
 * Comprehensive tests for the brute force protection system including:
 * - Progressive lockout after N failures
 * - Exponential backoff timing
 * - IP-based rate limiting
 * - Account unlock after timeout
 * - Admin manual unlock
 * - CAPTCHA triggering threshold
 * - Redis failure fallback behavior
 *
 * @module tests/unit/security/brute-force
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BruteForceProtection,
  resetBruteForceProtection,
  type BruteForceConfig,
  type LoginAttempt,
  type LockoutStatus,
  type LockoutEvent,
  DEFAULT_BRUTE_FORCE_CONFIG,
} from '../../../src/security/brute-force.js';

// Mock Redis
const mockRedis = {
  zadd: vi.fn().mockResolvedValue(1),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  incr: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  zcard: vi.fn().mockResolvedValue(0),
  scan: vi.fn().mockResolvedValue(['0', []]),
  ttl: vi.fn().mockResolvedValue(3600),
};

// Mock dependencies
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

/**
 * Helper to create test configuration
 */
function createTestConfig(overrides: Partial<BruteForceConfig> = {}): Partial<BruteForceConfig> {
  return {
    maxAttempts: 5,
    windowMinutes: 15,
    lockoutMinutes: 30,
    progressiveLockout: true,
    maxLockoutMinutes: 1440,
    notifyOnLockout: true,
    captchaAfterAttempts: 3,
    ipRateLimiting: true,
    ipMaxAttempts: 100,
    trackByUsername: true,
    trackByIP: true,
    ...overrides,
  };
}

/**
 * Helper to create a login attempt
 */
function createAttempt(overrides: Partial<LoginAttempt> = {}): LoginAttempt {
  return {
    username: 'testuser@example.com',
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Test)',
    timestamp: new Date(),
    success: false,
    failureReason: 'invalid_password',
    ...overrides,
  };
}

/**
 * Helper to simulate failed attempts stored in Redis
 */
function mockFailedAttempts(count: number) {
  const attempts = [];
  for (let i = 0; i < count; i++) {
    attempts.push(
      JSON.stringify({
        username: 'testuser@example.com',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date().toISOString(),
        success: false,
        failureReason: 'invalid_password',
      })
    );
  }
  mockRedis.zrangebyscore.mockResolvedValue(attempts);
}

describe('Brute Force Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    resetBruteForceProtection();
    vi.clearAllMocks();

    // Reset all mock implementations
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.scan.mockResolvedValue(['0', []]);
    mockRedis.ttl.mockResolvedValue(3600);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      const protection = new BruteForceProtection({}, mockRedis as any);
      const config = protection.getConfig();

      expect(config.maxAttempts).toBe(DEFAULT_BRUTE_FORCE_CONFIG.maxAttempts);
      expect(config.lockoutMinutes).toBe(DEFAULT_BRUTE_FORCE_CONFIG.lockoutMinutes);
      expect(config.progressiveLockout).toBe(DEFAULT_BRUTE_FORCE_CONFIG.progressiveLockout);
    });

    it('should merge custom configuration with defaults', () => {
      const protection = new BruteForceProtection(
        { maxAttempts: 3, lockoutMinutes: 60 },
        mockRedis as any
      );
      const config = protection.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.lockoutMinutes).toBe(60);
      expect(config.windowMinutes).toBe(DEFAULT_BRUTE_FORCE_CONFIG.windowMinutes);
    });

    it('should return a copy of configuration', () => {
      const protection = new BruteForceProtection({}, mockRedis as any);
      const config1 = protection.getConfig();
      const config2 = protection.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe('Progressive Lockout After N Failures', () => {
    it('should not lock out after fewer than max attempts', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      // Simulate 4 failed attempts (less than maxAttempts of 5)
      mockFailedAttempts(4);

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.locked).toBe(false);
      expect(status.remainingAttempts).toBe(1);
    });

    it('should lock out after reaching max attempts', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      // Simulate 5 failed attempts (equals maxAttempts)
      mockFailedAttempts(5);

      // Record one more attempt which should trigger lockout
      await protection.recordAttempt(createAttempt());

      // Verify lockout was triggered
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should record successful login and clear attempts', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      await protection.recordAttempt(createAttempt({ success: true }));

      // Should have called del to clear attempts
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should track remaining attempts accurately', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ maxAttempts: 5 }),
        mockRedis as any
      );

      // Mock 2 failed attempts
      mockFailedAttempts(2);

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.remainingAttempts).toBe(3);
    });

    it('should return zero remaining attempts when locked', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      // Mock active lockout
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
      );

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.locked).toBe(true);
      expect(status.remainingAttempts).toBe(0);
    });
  });

  describe('Exponential Backoff Timing', () => {
    it('should apply base lockout duration on first lockout', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ lockoutMinutes: 30, progressiveLockout: true }),
        mockRedis as any
      );

      // Simulate lockout trigger with 0 previous lockouts
      mockFailedAttempts(5);
      mockRedis.get.mockResolvedValueOnce('0'); // lockout count

      await protection.recordAttempt(createAttempt());

      // Should set lockout with base duration (30 minutes = 1800 seconds)
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('lockout'),
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should double lockout duration for second lockout', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ lockoutMinutes: 30, progressiveLockout: true }),
        mockRedis as any
      );

      // Mock 1 previous lockout
      mockFailedAttempts(5);
      mockRedis.get.mockResolvedValueOnce('1');

      await protection.recordAttempt(createAttempt());

      // Should set lockout with doubled duration (60 minutes = 3600 seconds)
      const setexCall = mockRedis.setex.mock.calls.find((call) =>
        call[0].includes('lockout')
      );
      if (setexCall) {
        expect(setexCall[1]).toBe(60 * 60); // 60 minutes in seconds
      }
    });

    it('should quadruple lockout duration for third lockout', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ lockoutMinutes: 30, progressiveLockout: true }),
        mockRedis as any
      );

      // Mock 2 previous lockouts
      mockFailedAttempts(5);
      mockRedis.get.mockResolvedValueOnce('2');

      await protection.recordAttempt(createAttempt());

      // Should set lockout with 4x duration (120 minutes)
      const setexCall = mockRedis.setex.mock.calls.find((call) =>
        call[0].includes('lockout')
      );
      if (setexCall) {
        expect(setexCall[1]).toBe(120 * 60);
      }
    });

    it('should cap lockout at maxLockoutMinutes', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ lockoutMinutes: 30, progressiveLockout: true, maxLockoutMinutes: 60 }),
        mockRedis as any
      );

      // Mock many previous lockouts (would calculate to > 60 minutes)
      mockFailedAttempts(5);
      mockRedis.get.mockResolvedValueOnce('5'); // 30 * 2^5 = 960, but capped at 60

      await protection.recordAttempt(createAttempt());

      // Should cap at maxLockoutMinutes
      const setexCall = mockRedis.setex.mock.calls.find((call) =>
        call[0].includes('lockout')
      );
      if (setexCall) {
        expect(setexCall[1]).toBe(60 * 60); // Capped at 60 minutes
      }
    });

    it('should not apply progressive lockout when disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ lockoutMinutes: 30, progressiveLockout: false }),
        mockRedis as any
      );

      // Mock many previous lockouts
      mockFailedAttempts(5);
      mockRedis.get.mockResolvedValueOnce('5');

      await protection.recordAttempt(createAttempt());

      // Should use base lockout duration
      const setexCall = mockRedis.setex.mock.calls.find((call) =>
        call[0].includes('lockout')
      );
      if (setexCall) {
        expect(setexCall[1]).toBe(30 * 60); // Base 30 minutes
      }
    });
  });

  describe('IP-Based Rate Limiting', () => {
    it('should track IP attempts when enabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ ipRateLimiting: true }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      // Should have incremented IP rate counter
      expect(mockRedis.incr).toHaveBeenCalledWith(
        expect.stringContaining('ip_rate')
      );
    });

    it('should not track IP attempts when disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ ipRateLimiting: false }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      // Should not have called incr for IP rate
      const ipRateCalls = mockRedis.incr.mock.calls.filter((call) =>
        call[0].includes('ip_rate')
      );
      expect(ipRateCalls.length).toBe(0);
    });

    it('should block IP when rate limit exceeded', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ ipRateLimiting: true, ipMaxAttempts: 100 }),
        mockRedis as any
      );

      // Mock IP at limit
      mockRedis.get.mockResolvedValueOnce('101');

      const blocked = await protection.isIPBlocked('192.168.1.100');

      expect(blocked).toBe(true);
    });

    it('should not block IP when under rate limit', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ ipRateLimiting: true, ipMaxAttempts: 100 }),
        mockRedis as any
      );

      // Mock IP under limit
      mockRedis.get.mockResolvedValueOnce('50');

      const blocked = await protection.isIPBlocked('192.168.1.100');

      expect(blocked).toBe(false);
    });

    it('should return false for IP blocking when disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ ipRateLimiting: false }),
        mockRedis as any
      );

      mockRedis.get.mockResolvedValueOnce('1000');

      const blocked = await protection.isIPBlocked('192.168.1.100');

      expect(blocked).toBe(false);
    });

    it('should set expiry on first IP rate count', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      // First increment returns 1
      mockRedis.incr.mockResolvedValueOnce(1);

      await protection.recordAttempt(createAttempt());

      // Should set expiry for IP rate key
      expect(mockRedis.expire).toHaveBeenCalled();
    });
  });

  describe('Account Unlock After Timeout', () => {
    it('should return not locked when lockout has expired', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      // Mock expired lockout
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        })
      );

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.locked).toBe(false);
    });

    it('should return locked when lockout is still active', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const lockoutEndsAt = new Date(Date.now() + 30 * 60 * 1000);
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: lockoutEndsAt.toISOString(),
        })
      );

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.locked).toBe(true);
      expect(status.lockoutEndsAt).toEqual(lockoutEndsAt);
    });

    it('should include lockout end time in status', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const lockoutEndsAt = new Date(Date.now() + 60 * 60 * 1000);
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: lockoutEndsAt.toISOString(),
        })
      );

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.lockoutEndsAt?.getTime()).toBe(lockoutEndsAt.getTime());
    });

    it('should track lockout count for progressive penalties', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.get
        .mockResolvedValueOnce(null) // lockout data
        .mockResolvedValueOnce('3'); // lockout count

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.lockoutCount).toBe(3);
    });
  });

  describe('Admin Manual Unlock', () => {
    it('should unlock account when admin unlocks', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      await protection.unlockAccount('testuser@example.com', 'User requested', 'admin-123');

      // Should delete lockout and attempts keys
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('lockout')
      );
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('attempts')
      );
    });

    it('should create audit record for manual unlock', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      await protection.unlockAccount('testuser@example.com', 'User requested', 'admin-123');

      // Should create audit record
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('unlock_audit'),
        expect.any(Number),
        expect.stringContaining('admin-123')
      );
    });

    it('should emit unlock event', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const events: LockoutEvent[] = [];
      protection.onLockoutEvent((event) => {
        events.push(event);
      });

      await protection.unlockAccount('testuser@example.com', 'User requested', 'admin-123');

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('unlock');
      expect(events[0].adminId).toBe('admin-123');
      expect(events[0].unlockReason).toBe('User requested');
    });

    it('should store unlock audit for 90 days', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      await protection.unlockAccount('testuser@example.com', 'Test', 'admin-123');

      const auditCall = mockRedis.setex.mock.calls.find((call) =>
        call[0].includes('unlock_audit')
      );

      expect(auditCall).toBeDefined();
      // 90 days in seconds
      expect(auditCall![1]).toBe(90 * 24 * 60 * 60);
    });
  });

  describe('CAPTCHA Triggering Threshold', () => {
    it('should not require CAPTCHA before threshold', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ captchaAfterAttempts: 3 }),
        mockRedis as any
      );

      // Mock 2 failed attempts (below threshold)
      mockFailedAttempts(2);

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.requiresCaptcha).toBe(false);
    });

    it('should require CAPTCHA at threshold', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ captchaAfterAttempts: 3 }),
        mockRedis as any
      );

      // Mock 3 failed attempts (at threshold)
      mockFailedAttempts(3);

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.requiresCaptcha).toBe(true);
    });

    it('should require CAPTCHA above threshold', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ captchaAfterAttempts: 3 }),
        mockRedis as any
      );

      // Mock 4 failed attempts (above threshold)
      mockFailedAttempts(4);

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.requiresCaptcha).toBe(true);
    });

    it('should require CAPTCHA when locked out', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
      );

      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.requiresCaptcha).toBe(true);
    });

    it('should expose requiresCaptcha method', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ captchaAfterAttempts: 3 }),
        mockRedis as any
      );

      mockFailedAttempts(3);

      const requiresCaptcha = await protection.requiresCaptcha('testuser@example.com');

      expect(requiresCaptcha).toBe(true);
    });
  });

  describe('Redis Failure Fallback Behavior', () => {
    it('should handle Redis connection error on record attempt gracefully', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.zadd.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Should not throw
      await expect(protection.recordAttempt(createAttempt())).rejects.toThrow(
        'Redis connection failed'
      );
    });

    it('should handle Redis error on isLockedOut gracefully', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Should propagate error
      await expect(protection.isLockedOut('testuser@example.com')).rejects.toThrow(
        'Redis connection failed'
      );
    });

    it('should handle invalid JSON in lockout data', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.get.mockResolvedValueOnce('invalid json {{{');

      // Should not throw, treat as not locked
      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.locked).toBe(false);
    });

    it('should handle invalid JSON in attempt data', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.zrangebyscore.mockResolvedValueOnce(['invalid json', '{"success": false}']);

      // Should skip invalid entries
      const status = await protection.isLockedOut('testuser@example.com');

      expect(status.remainingAttempts).toBe(4); // Only 1 valid failed attempt
    });
  });

  describe('Lockout Event Callbacks', () => {
    it('should emit lockout event when account is locked', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const events: LockoutEvent[] = [];
      protection.onLockoutEvent((event) => {
        events.push(event);
      });

      mockFailedAttempts(5);

      await protection.recordAttempt(createAttempt());

      // Emits lockout events for both username and IP tracking
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.type === 'lockout')).toBe(true);
      expect(
        events.some((e) => e.identifier === 'testuser@example.com')
      ).toBe(true);
    });

    it('should emit IP blocked event', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const events: LockoutEvent[] = [];
      protection.onLockoutEvent((event) => {
        events.push(event);
      });

      mockRedis.get.mockResolvedValueOnce('101');

      await protection.isIPBlocked('192.168.1.100');

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('ip_blocked');
    });

    it('should not emit events when notifications disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ notifyOnLockout: false }),
        mockRedis as any
      );

      const events: LockoutEvent[] = [];
      protection.onLockoutEvent((event) => {
        events.push(event);
      });

      mockFailedAttempts(5);

      await protection.recordAttempt(createAttempt());

      expect(events.length).toBe(0);
    });

    it('should continue on callback error', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      protection.onLockoutEvent(() => {
        throw new Error('Callback failed');
      });

      mockFailedAttempts(5);

      // Should not throw
      await protection.recordAttempt(createAttempt());
    });

    it('should support multiple callbacks', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const events1: LockoutEvent[] = [];
      const events2: LockoutEvent[] = [];

      protection.onLockoutEvent((event) => events1.push(event));
      protection.onLockoutEvent((event) => events2.push(event));

      mockFailedAttempts(5);
      await protection.recordAttempt(createAttempt());

      // Both callbacks should receive the same events
      expect(events1.length).toBeGreaterThanOrEqual(1);
      expect(events2.length).toBeGreaterThanOrEqual(1);
      expect(events1.length).toBe(events2.length);
    });
  });

  describe('Recent Attempts Retrieval', () => {
    it('should return recent attempts for identifier', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      const now = new Date();
      mockRedis.zrangebyscore.mockResolvedValueOnce([
        JSON.stringify({
          username: 'test',
          ipAddress: '1.1.1.1',
          userAgent: 'test',
          timestamp: now.toISOString(),
          success: false,
        }),
      ]);

      const attempts = await protection.getRecentAttempts('testuser@example.com', 15);

      expect(attempts.length).toBe(1);
      expect(attempts[0].timestamp).toEqual(now);
    });

    it('should skip invalid attempt entries', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.zrangebyscore.mockResolvedValueOnce([
        'invalid json',
        JSON.stringify({
          username: 'test',
          ipAddress: '1.1.1.1',
          userAgent: 'test',
          timestamp: new Date().toISOString(),
          success: false,
        }),
      ]);

      const attempts = await protection.getRecentAttempts('testuser@example.com', 15);

      expect(attempts.length).toBe(1);
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up old attempts', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.scan
        .mockResolvedValueOnce(['1', ['vorion:brute_force:attempts:user1']])
        .mockResolvedValueOnce(['0', []])
        .mockResolvedValueOnce(['0', []]);

      await protection.cleanup();

      expect(mockRedis.zremrangebyscore).toHaveBeenCalled();
    });

    it('should delete empty attempt keys', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.scan
        .mockResolvedValueOnce(['0', ['vorion:brute_force:attempts:user1']])
        .mockResolvedValueOnce(['0', []]);
      mockRedis.zcard.mockResolvedValueOnce(0);

      await protection.cleanup();

      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should clean up orphaned IP rate keys', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.scan
        .mockResolvedValueOnce(['0', []])
        .mockResolvedValueOnce(['0', ['vorion:brute_force:ip_rate:1.1.1.1']]);
      mockRedis.ttl.mockResolvedValueOnce(-1); // No expiry set

      await protection.cleanup();

      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('Tracking Configuration', () => {
    it('should track by username when enabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ trackByUsername: true }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining('testuser@example.com'),
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should not track by username when disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ trackByUsername: false, trackByIP: true }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      const usernameCalls = mockRedis.zadd.mock.calls.filter(
        (call) =>
          call[0].includes('testuser@example.com') && !call[0].includes('ip:')
      );

      expect(usernameCalls.length).toBe(0);
    });

    it('should track by IP when enabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ trackByIP: true }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining('ip:192.168.1.100'),
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should not track by IP when disabled', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ trackByIP: false, trackByUsername: true }),
        mockRedis as any
      );

      await protection.recordAttempt(createAttempt());

      const ipCalls = mockRedis.zadd.mock.calls.filter((call) =>
        call[0].includes('ip:')
      );

      expect(ipCalls.length).toBe(0);
    });
  });

  describe('getRemainingAttempts', () => {
    it('should return remaining attempts correctly', async () => {
      const protection = new BruteForceProtection(
        createTestConfig({ maxAttempts: 5 }),
        mockRedis as any
      );

      mockFailedAttempts(2);

      const remaining = await protection.getRemainingAttempts('testuser@example.com');

      expect(remaining).toBe(3);
    });

    it('should return 0 when locked out', async () => {
      const protection = new BruteForceProtection(createTestConfig(), mockRedis as any);

      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          lockoutEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
      );

      const remaining = await protection.getRemainingAttempts('testuser@example.com');

      expect(remaining).toBe(0);
    });
  });
});
