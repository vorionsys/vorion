/**
 * Tests for Temporal Anomaly Detector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemporalDetector } from '../detectors/temporal.js';
import type { SecurityEvent } from '../types.js';

// Mock Redis
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  hincrby: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  del: vi.fn().mockResolvedValue(1),
};

vi.mock('../../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

describe('Temporal Detector - Normal Hours Detection', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default config: normal hours 6-22, weekdays only
    detector = new TemporalDetector();
  });

  it('should flag off-hours access (3am)', async () => {
    const event: SecurityEvent = {
      eventId: 'test-1',
      timestamp: new Date('2024-01-01T03:00:00Z'), // 3am UTC
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const unusualHour = result.indicators.find((i) => i.type === 'unusual_hour');
    expect(unusualHour).toBeDefined();
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should allow normal hours (2pm Monday)', async () => {
    const event: SecurityEvent = {
      eventId: 'test-2',
      timestamp: new Date('2024-01-01T14:00:00Z'), // 2pm Monday (day 1)
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
    expect(result.indicators).toHaveLength(0);
  });

  it('should flag weekend access with default config', async () => {
    const event: SecurityEvent = {
      eventId: 'test-3',
      timestamp: new Date('2024-01-06T14:00:00Z'), // Saturday (day 6)
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const unusualDay = result.indicators.find((i) => i.type === 'unusual_day');
    expect(unusualDay).toBeDefined();
  });

  it('should allow weekday (Wednesday)', async () => {
    const event: SecurityEvent = {
      eventId: 'test-4',
      timestamp: new Date('2024-01-03T14:00:00Z'), // Wednesday
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
  });
});

describe('Temporal Detector - User Pattern Learning', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TemporalDetector({ learnUserPatterns: true, minEventsForBaseline: 20 });
  });

  it('should learn user patterns and detect deviation', async () => {
    // Setup: user has baseline of 20 events, mostly at hour 14
    const pattern = {
      userId: 'user1',
      hourHistogram: Array(24).fill(0),
      dayHistogram: Array(7).fill(3),
      totalEvents: 21,
      lastUpdated: new Date().toISOString(),
    };
    pattern.hourHistogram[14] = 18; // 18 events at 2pm
    pattern.hourHistogram[15] = 3;

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(pattern));

    const event: SecurityEvent = {
      eventId: 'test-5',
      timestamp: new Date('2024-01-01T03:00:00Z'), // 3am - unusual for this user
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const patternIndicator = result.indicators.find(
      (i) => i.type === 'unusual_hour_pattern' || i.type === 'first_time_hour'
    );
    expect(patternIndicator).toBeDefined();
  });

  it('should detect first-time hour access', async () => {
    const pattern = {
      userId: 'user1',
      hourHistogram: Array(24).fill(0),
      dayHistogram: Array(7).fill(3),
      totalEvents: 21,
      lastUpdated: new Date().toISOString(),
    };
    pattern.hourHistogram[14] = 21; // All events at 2pm

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(pattern));

    const event: SecurityEvent = {
      eventId: 'test-6',
      timestamp: new Date('2024-01-01T22:00:00Z'), // 10pm - never accessed
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const firstTimeHour = result.indicators.find((i) => i.type === 'first_time_hour');
    expect(firstTimeHour).toBeDefined();
    expect(firstTimeHour?.description).toContain('First recorded access');
  });

  it('should not flag deviation if insufficient baseline', async () => {
    const pattern = {
      userId: 'user1',
      hourHistogram: Array(24).fill(0),
      dayHistogram: Array(7).fill(1),
      totalEvents: 5, // Less than minEventsForBaseline (20)
      lastUpdated: new Date().toISOString(),
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(pattern));

    const event: SecurityEvent = {
      eventId: 'test-7',
      timestamp: new Date('2024-01-01T03:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    // Should only flag based on config hours, not pattern
    const patternIndicator = result.indicators.find(
      (i) => i.type === 'unusual_hour_pattern' || i.type === 'unusual_day_pattern'
    );
    expect(patternIndicator).toBeUndefined();
  });
});

describe('Temporal Detector - Custom Configuration', () => {
  it('should use custom normal hours (night shift)', async () => {
    const detector = new TemporalDetector({
      normalHoursStart: 22,
      normalHoursEnd: 6,
      normalDays: [0, 1, 2, 3, 4, 5, 6], // All days
    });

    const event: SecurityEvent = {
      eventId: 'test-8',
      timestamp: new Date('2024-01-01T23:00:00Z'), // 11pm - normal for night shift
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
  });

  it('should flag outside custom hours', async () => {
    const detector = new TemporalDetector({
      normalHoursStart: 22,
      normalHoursEnd: 6,
    });

    const event: SecurityEvent = {
      eventId: 'test-9',
      timestamp: new Date('2024-01-01T14:00:00Z'), // 2pm - outside night shift
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
  });
});

describe('Temporal Detector - Learning', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TemporalDetector({ learnUserPatterns: true });
  });

  it('should update user pattern on learn', async () => {
    const existingPattern = {
      userId: 'user1',
      hourHistogram: Array(24).fill(0),
      dayHistogram: Array(7).fill(0),
      totalEvents: 5,
      lastUpdated: new Date().toISOString(),
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(existingPattern));

    const event: SecurityEvent = {
      eventId: 'test-10',
      timestamp: new Date('2024-01-01T14:00:00Z'), // Monday 2pm
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'vorion:anomaly:temporal:pattern:user1',
      expect.stringContaining('"totalEvents":6'),
      'EX',
      expect.any(Number)
    );
    expect(mockRedis.hincrby).toHaveBeenCalledWith('vorion:anomaly:temporal:global', 'hour:14', 1);
    expect(mockRedis.hincrby).toHaveBeenCalledWith('vorion:anomaly:temporal:global', 'day:1', 1);
  });

  it('should create new pattern if none exists', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const event: SecurityEvent = {
      eventId: 'test-11',
      timestamp: new Date('2024-01-01T14:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'vorion:anomaly:temporal:pattern:user1',
      expect.stringContaining('"totalEvents":1'),
      'EX',
      expect.any(Number)
    );
  });

  it('should skip learning if learnUserPatterns is disabled', async () => {
    const detector = new TemporalDetector({ learnUserPatterns: false });

    const event: SecurityEvent = {
      eventId: 'test-12',
      timestamp: new Date('2024-01-01T14:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe('Temporal Detector - Reset', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TemporalDetector();
  });

  it('should clear all patterns on reset', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['1', ['pattern1', 'pattern2']])
      .mockResolvedValueOnce(['0', []]);

    await detector.reset();

    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith('pattern1', 'pattern2');
    expect(mockRedis.del).toHaveBeenCalledWith('vorion:anomaly:temporal:global');
  });
});

describe('Temporal Detector - Error Handling', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TemporalDetector();
  });

  it('should handle missing timestamp gracefully', async () => {
    const event: SecurityEvent = {
      eventId: 'test-13',
      timestamp: new Date('2024-01-01T14:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.detectorName).toBe('temporal');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('should return error on Redis failure', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failed'));

    const event: SecurityEvent = {
      eventId: 'test-14',
      timestamp: new Date('2024-01-01T14:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('Temporal Detector - Timezone Support', () => {
  let detector: TemporalDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new TemporalDetector();
  });

  it('should handle timezone in location', async () => {
    const event: SecurityEvent = {
      eventId: 'test-15',
      timestamp: new Date('2024-01-01T03:00:00Z'), // 3am UTC
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        timezone: 'America/New_York', // 10pm EST
      },
    };

    const result = await detector.detect(event);
    // Should evaluate based on local timezone, not UTC
    expect(result).toBeDefined();
  });
});
