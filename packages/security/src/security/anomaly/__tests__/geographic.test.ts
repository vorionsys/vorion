/**
 * Tests for Geographic Anomaly Detector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GeographicDetector,
  calculateHaversineDistance,
  calculateTravelSpeed,
} from '../detectors/geographic.js';
import type { SecurityEvent, GeoLocation } from '../types.js';

// Mock Redis
const mockRedis = {
  zadd: vi.fn().mockResolvedValue(1),
  zcard: vi.fn().mockResolvedValue(0),
  zremrangebyrank: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zrevrange: vi.fn().mockResolvedValue([]),
  scan: vi.fn().mockResolvedValue(['0', []]),
  del: vi.fn().mockResolvedValue(1),
};

vi.mock('../../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

describe('Geographic Detector - Haversine Distance', () => {
  it('should calculate NYC to London distance accurately', () => {
    // NYC: 40.7128, -74.0060
    // London: 51.5074, -0.1278
    // Expected: ~5570 km
    const distance = calculateHaversineDistance(40.7128, -74.0060, 51.5074, -0.1278);
    expect(distance).toBeGreaterThan(5520);
    expect(distance).toBeLessThan(5620);
  });

  it('should return 0 for same point', () => {
    const distance = calculateHaversineDistance(40.7128, -74.0060, 40.7128, -74.0060);
    expect(distance).toBe(0);
  });

  it('should calculate distance for antipodal points', () => {
    // Roughly opposite sides of Earth
    const distance = calculateHaversineDistance(0, 0, 0, 180);
    expect(distance).toBeGreaterThan(19000);
    expect(distance).toBeLessThan(21000);
  });

  it('should handle negative coordinates', () => {
    const distance = calculateHaversineDistance(-33.8688, 151.2093, 40.7128, -74.0060);
    expect(distance).toBeGreaterThan(15000); // Sydney to NYC
  });
});

describe('Geographic Detector - Travel Speed', () => {
  const loc1: GeoLocation = { latitude: 40.7128, longitude: -74.0060 };
  const loc2: GeoLocation = { latitude: 34.0522, longitude: -118.2437 }; // LA

  it('should calculate travel speed in km/h', () => {
    const time1 = new Date('2024-01-01T10:00:00Z');
    const time2 = new Date('2024-01-01T15:00:00Z'); // 5 hours later
    const speed = calculateTravelSpeed(loc1, time1, loc2, time2);
    expect(speed).not.toBeNull();
    // NYC to LA is ~3935 km, over 5 hours = ~787 km/h
    expect(speed!).toBeGreaterThan(700);
    expect(speed!).toBeLessThan(900);
  });

  it('should return null when time difference is 0', () => {
    const time = new Date('2024-01-01T10:00:00Z');
    const speed = calculateTravelSpeed(loc1, time, loc2, time);
    expect(speed).toBeNull();
  });

  it('should calculate speed for short time intervals', () => {
    const time1 = new Date('2024-01-01T10:00:00Z');
    const time2 = new Date('2024-01-01T10:01:00Z'); // 1 minute
    const speed = calculateTravelSpeed(loc1, time1, loc2, time2);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(200000); // Very fast for 1 minute
  });
});

describe('Geographic Detector - Detection Logic', () => {
  let detector: GeographicDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new GeographicDetector();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return low score for event without location', async () => {
    const event: SecurityEvent = {
      eventId: 'test-1',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
    expect(result.indicators).toHaveLength(0);
  });

  it('should detect high-risk country', async () => {
    // Default config has empty highRiskCountries — create detector with KP
    const riskDetector = new GeographicDetector({ highRiskCountries: ['KP'] });
    mockRedis.zrevrange.mockResolvedValueOnce([]);

    const event: SecurityEvent = {
      eventId: 'test-2',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        countryCode: 'KP',
      },
    };

    const result = await riskDetector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    expect(result.indicators.length).toBeGreaterThan(0);
    const highRiskIndicator = result.indicators.find((i) => i.type === 'high_risk_country');
    expect(highRiskIndicator).toBeDefined();
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should return low score for normal location with no history', async () => {
    mockRedis.zrevrange.mockResolvedValueOnce([]);

    const event: SecurityEvent = {
      eventId: 'test-3',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        countryCode: 'US',
        city: 'New York',
      },
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
    expect(result.indicators).toHaveLength(0);
  });

  it('should detect impossible travel - close locations in short time', async () => {
    const previousLocation = {
      location: { latitude: 40.7128, longitude: -74.0060 },
      timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
      ipAddress: '192.168.1.1',
      eventId: 'prev-1',
    };

    mockRedis.zrevrange.mockResolvedValueOnce([JSON.stringify(previousLocation)]);

    const event: SecurityEvent = {
      eventId: 'test-4',
      timestamp: new Date('2024-01-01T10:01:00Z'), // 1 minute later
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.2',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 34.0522, // LA - ~3935 km away
        longitude: -118.2437,
        countryCode: 'US',
        city: 'Los Angeles',
      },
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(true);
    const impossibleTravel = result.indicators.find((i) => i.type === 'impossible_travel');
    expect(impossibleTravel).toBeDefined();
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('should allow legitimate travel - reasonable distance and time', async () => {
    const previousLocation = {
      location: { latitude: 40.7128, longitude: -74.0060 },
      timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
      ipAddress: '192.168.1.1',
      eventId: 'prev-1',
    };

    mockRedis.zrevrange.mockResolvedValueOnce([JSON.stringify(previousLocation)]);

    const event: SecurityEvent = {
      eventId: 'test-5',
      timestamp: new Date('2024-01-01T20:00:00Z'), // 10 hours later
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.2',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 41.8781, // Chicago - ~1150 km, 10 hours = ~115 km/h
        longitude: -87.6298,
        countryCode: 'US',
        city: 'Chicago',
      },
    };

    const result = await detector.detect(event);
    expect(result.anomalyDetected).toBe(false);
  });

  it('should respect minimum distance threshold', async () => {
    const previousLocation = {
      location: { latitude: 40.7128, longitude: -74.0060 },
      timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
      ipAddress: '192.168.1.1',
      eventId: 'prev-1',
    };

    mockRedis.zrevrange.mockResolvedValueOnce([JSON.stringify(previousLocation)]);

    const event: SecurityEvent = {
      eventId: 'test-6',
      timestamp: new Date('2024-01-01T10:01:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.2',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7228, // ~1 km away
        longitude: -74.0160,
        countryCode: 'US',
        city: 'New York',
      },
    };

    const result = await detector.detect(event);
    // Should not trigger because distance < minDistanceKm (default 100)
    expect(result.anomalyDetected).toBe(false);
  });
});

describe('Geographic Detector - Learning', () => {
  let detector: GeographicDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new GeographicDetector();
  });

  it('should store location in Redis sorted set', async () => {
    const event: SecurityEvent = {
      eventId: 'test-7',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        countryCode: 'US',
        city: 'New York',
      },
    };

    await detector.learn(event);

    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'vorion:anomaly:geo:history:user1',
      event.timestamp.getTime(),
      expect.stringContaining('"latitude":40.7128')
    );
    expect(mockRedis.zcard).toHaveBeenCalled();
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('should trim old records when exceeding max history', async () => {
    mockRedis.zcard.mockResolvedValueOnce(101); // Exceeds MAX_LOCATION_HISTORY (100)

    const event: SecurityEvent = {
      eventId: 'test-8',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        countryCode: 'US',
      },
    };

    await detector.learn(event);

    expect(mockRedis.zremrangebyrank).toHaveBeenCalled();
  });

  it('should skip learning if no location data', async () => {
    const event: SecurityEvent = {
      eventId: 'test-9',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    };

    await detector.learn(event);

    expect(mockRedis.zadd).not.toHaveBeenCalled();
  });
});

describe('Geographic Detector - Reset', () => {
  let detector: GeographicDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new GeographicDetector();
  });

  it('should clear all data on reset', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['1', ['key1', 'key2']])
      .mockResolvedValueOnce(['0', ['key3']]);

    await detector.reset();

    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledTimes(2);
    expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2');
    expect(mockRedis.del).toHaveBeenCalledWith('key3');
  });
});

describe('Geographic Detector - Custom Configuration', () => {
  it('should use custom maxTravelSpeedKmh', async () => {
    const detector = new GeographicDetector({ maxTravelSpeedKmh: 500 });

    const previousLocation = {
      location: { latitude: 40.7128, longitude: -74.0060 },
      timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
      ipAddress: '192.168.1.1',
      eventId: 'prev-1',
    };

    mockRedis.zrevrange.mockResolvedValueOnce([JSON.stringify(previousLocation)]);

    const event: SecurityEvent = {
      eventId: 'test-10',
      timestamp: new Date('2024-01-01T11:00:00Z'), // 1 hour later
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.2',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 34.0522,
        longitude: -118.2437,
        countryCode: 'US',
      },
    };

    const result = await detector.detect(event);
    // 3935 km in 1 hour = 3935 km/h, should exceed custom 500 km/h
    expect(result.anomalyDetected).toBe(true);
  });

  it('should use custom key prefix', async () => {
    const detector = new GeographicDetector({}, 'custom:prefix:');

    const event: SecurityEvent = {
      eventId: 'test-11',
      timestamp: new Date(),
      type: 'authentication',
      userId: 'user1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
        countryCode: 'US',
      },
    };

    await detector.learn(event);

    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'custom:prefix:user1',
      expect.any(Number),
      expect.any(String)
    );
  });
});
