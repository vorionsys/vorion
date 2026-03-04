/**
 * Tests for Volume Spike Anomaly Detector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VolumeDetector } from '../detectors/volume.js';
import type { SecurityEvent } from '../types.js';

// Mock Redis
const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  expire: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  del: vi.fn().mockResolvedValue(1),
};

vi.mock('../../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

describe('Volume Detector - Absolute Volume Spikes', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({ absoluteMaxRequests: 1000, trackPerUser: true });
  });

  it('should detect absolute volume spike exceeding limit', async () => {
    mockRedis.get.mockResolvedValueOnce('1001'); // Current count exceeds 1000

    const event: SecurityEvent = {
      eventId: 'test-1',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const absoluteSpike = result.indicators.find((i) => i.type.startsWith('absolute_volume_spike'));
    expect(absoluteSpike).toBeDefined();
    expect(absoluteSpike?.description).toContain('1001 requests');
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('should allow normal volume within limit', async () => {
    mockRedis.get.mockResolvedValueOnce('500'); // Within limit

    const event: SecurityEvent = {
      eventId: 'test-2',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
  });
});

describe('Volume Detector - Per-User Tracking', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      trackPerUser: true,
      trackPerIp: false,
      trackPerEndpoint: false,
    });
  });

  it('should track volume per user', async () => {
    mockRedis.get.mockResolvedValueOnce('100');
    const baselineData = {
      identifier: 'user1',
      identifierType: 'user',
      mean: 10,
      stdDev: 5,
      sampleCount: 20,
      lastUpdated: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(baselineData));

    const event: SecurityEvent = {
      eventId: 'test-3',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const statisticalSpike = result.indicators.find((i) =>
      i.type.includes('statistical_volume_spike')
    );
    expect(statisticalSpike).toBeDefined();
  });

  it('should not check IP or endpoint when disabled', async () => {
    const event: SecurityEvent = {
      eventId: 'test-4',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      resource: '/api/endpoint',
    };

    await detector.detect(event);

    // Should only call get for user-based keys
    expect(mockRedis.get).toHaveBeenCalledWith(expect.stringContaining('user:user1:'));
  });
});

describe('Volume Detector - Per-IP Tracking', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      trackPerUser: false,
      trackPerIp: true,
      trackPerEndpoint: false,
    });
  });

  it('should track volume per IP address', async () => {
    mockRedis.get.mockResolvedValueOnce('150');
    const baselineData = {
      identifier: '192.168.1.1',
      identifierType: 'ip',
      mean: 20,
      stdDev: 10,
      sampleCount: 15,
      lastUpdated: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(baselineData));

    const event: SecurityEvent = {
      eventId: 'test-5',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const ipSpike = result.indicators.find((i) => i.type.includes('_ip'));
    expect(ipSpike).toBeDefined();
  });
});

describe('Volume Detector - Statistical Spike Detection', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      spikeThresholdStdDev: 3,
      trackPerUser: true,
    });
  });

  it('should detect z-score exceeding threshold', async () => {
    mockRedis.get.mockResolvedValueOnce('50'); // Current count
    const baselineData = {
      identifier: 'user1',
      identifierType: 'user',
      mean: 10,
      stdDev: 5,
      sampleCount: 20,
      lastUpdated: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(baselineData));

    const event: SecurityEvent = {
      eventId: 'test-6',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    // z-score = (50 - 10) / 5 = 8, which exceeds threshold of 3
    expect(result.anomalyDetected).toBe(true);
    const statisticalSpike = result.indicators.find((i) =>
      i.type.includes('statistical_volume_spike')
    );
    expect(statisticalSpike).toBeDefined();
  });

  it('should not detect spike within statistical threshold', async () => {
    mockRedis.get.mockResolvedValueOnce('20'); // Current count
    const baselineData = {
      identifier: 'user1',
      identifierType: 'user',
      mean: 10,
      stdDev: 5,
      sampleCount: 20,
      lastUpdated: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(baselineData));

    const event: SecurityEvent = {
      eventId: 'test-7',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    // z-score = (20 - 10) / 5 = 2, which is below threshold of 3
    expect(result.anomalyDetected).toBe(false);
  });
});

describe('Volume Detector - Baseline Updates (Welford\'s Algorithm)', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({ trackPerUser: true });
  });

  it('should update baseline with new sample', async () => {
    const baselineData = {
      identifier: 'user1',
      identifierType: 'user',
      mean: 10,
      stdDev: 5,
      sampleCount: 10,
      lastUpdated: new Date().toISOString(),
    };
    // detect() calls getCount then getBaseline for the initial check,
    // then fire-and-forget updateBaseline calls getBaseline again.
    // Use mockImplementation to return values based on key content.
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('count:')) return Promise.resolve('15');
      if (key.includes('baseline:')) return Promise.resolve(JSON.stringify(baselineData));
      return Promise.resolve(null);
    });

    const event: SecurityEvent = {
      eventId: 'test-8',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.detect(event);

    // Wait for fire-and-forget baseline update to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    // saveBaseline uses redis.set(key, value, 'EX', ttl), not setex
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('baseline:user:user1'),
      expect.stringContaining('"sampleCount":11'),
      'EX',
      expect.any(Number)
    );
  });

  it('should create baseline from scratch', async () => {
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('count:')) return Promise.resolve('10');
      return Promise.resolve(null); // No existing baseline
    });

    const event: SecurityEvent = {
      eventId: 'test-9',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.detect(event);

    await new Promise((resolve) => setTimeout(resolve, 50));
    // saveBaseline uses redis.set(key, value, 'EX', ttl), not setex
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('baseline:user:user1'),
      expect.stringContaining('"mean":10'),
      'EX',
      expect.any(Number)
    );
  });
});

describe('Volume Detector - Window Boundary', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({ windowMinutes: 5, trackPerUser: true });
  });

  it('should use time buckets for counts', async () => {
    const event: SecurityEvent = {
      eventId: 'test-10',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.incr).toHaveBeenCalledWith(
      expect.stringContaining('user:user1:')
    );
    expect(mockRedis.expire).toHaveBeenCalled();
  });
});

describe('Volume Detector - Learning', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      trackPerUser: true,
      trackPerIp: true,
      trackPerEndpoint: true,
    });
  });

  it('should increment counts for all tracking types', async () => {
    mockRedis.incr.mockResolvedValue(1);

    const event: SecurityEvent = {
      eventId: 'test-11',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      resource: '/api/login',
    };

    await detector.learn(event);

    expect(mockRedis.incr).toHaveBeenCalledTimes(3);
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('user:user1:'));
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('ip:192.168.1.1:'));
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('endpoint:/api/login:'));
  });

  it('should set TTL on first increment', async () => {
    mockRedis.incr.mockResolvedValueOnce(1); // First increment

    const event: SecurityEvent = {
      eventId: 'test-12',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('should not set TTL on subsequent increments', async () => {
    // Return > 1 for ALL incr calls (user, IP, endpoint) so no expire is triggered
    mockRedis.incr.mockResolvedValue(5);

    const event: SecurityEvent = {
      eventId: 'test-13',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      resource: '/api/login',
    };

    await detector.learn(event);

    expect(mockRedis.expire).not.toHaveBeenCalled();
  });
});

describe('Volume Detector - Reset', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector();
  });

  it('should clear all baselines and counts on reset', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['1', ['count1', 'count2']]) // Count keys
      .mockResolvedValueOnce(['0', []])
      .mockResolvedValueOnce(['1', ['baseline1']]) // Baseline keys
      .mockResolvedValueOnce(['0', []]);

    await detector.reset();

    expect(mockRedis.scan).toHaveBeenCalledTimes(4);
    expect(mockRedis.del).toHaveBeenCalledWith('count1', 'count2');
    expect(mockRedis.del).toHaveBeenCalledWith('baseline1');
  });
});

describe('Volume Detector - Per-Endpoint Tracking', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      trackPerUser: false,
      trackPerIp: false,
      trackPerEndpoint: true,
    });
  });

  it('should track volume per endpoint', async () => {
    mockRedis.get.mockResolvedValueOnce('200');
    const baselineData = {
      identifier: '/api/sensitive',
      identifierType: 'endpoint',
      mean: 30,
      stdDev: 15,
      sampleCount: 25,
      lastUpdated: new Date().toISOString(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(baselineData));

    const event: SecurityEvent = {
      eventId: 'test-14',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      resource: '/api/sensitive',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const endpointSpike = result.indicators.find((i) => i.type.includes('_endpoint'));
    expect(endpointSpike).toBeDefined();
  });
});

describe('Volume Detector - Multiple Indicator Types', () => {
  let detector: VolumeDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new VolumeDetector({
      trackPerUser: true,
      trackPerIp: true,
      absoluteMaxRequests: 50,
    });
  });

  it('should combine multiple spike indicators', async () => {
    // Use mockImplementation to handle non-deterministic call order
    // (fire-and-forget updateBaseline also calls redis.get)
    mockRedis.get.mockImplementation((key: string) => {
      if (key.includes('count:')) return Promise.resolve('100'); // Exceeds absolute max (50)
      return Promise.resolve(null); // No baselines
    });

    const event: SecurityEvent = {
      eventId: 'test-15',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    expect(result.indicators.length).toBeGreaterThanOrEqual(2);
    // Multiple absolute spikes across user + IP → high or critical severity
    expect(['high', 'critical']).toContain(result.severity);
  });
});
