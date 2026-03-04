/**
 * Tests for IP Reputation Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPReputationService } from '../ip-reputation.js';

// Mock Redis
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  set: vi.fn().mockResolvedValue('OK'),
  zadd: vi.fn().mockResolvedValue(1),
  zcard: vi.fn().mockResolvedValue(0),
  zrevrange: vi.fn().mockResolvedValue([]),
  exists: vi.fn().mockResolvedValue(0),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(-1),
  scan: vi.fn().mockResolvedValue(['0', []]),
};

vi.mock('../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

describe('IPReputationService - Default Score', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({ defaultScore: 80 }, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should return default score for unknown IP', async () => {
    const reputation = await service.checkIP('1.2.3.4');

    expect(reputation.score).toBe(80);
    expect(reputation.categories).toContain('unknown');
    expect(reputation.isBlocked).toBe(false);
  });

  it('should cache result in L1 cache', async () => {
    await service.checkIP('1.2.3.4');

    // Second call should hit L1 cache
    const reputation = await service.checkIP('1.2.3.4');
    expect(reputation.fromCache).toBe(true);
    expect(reputation.cacheLayer).toBe('l1');
  });
});

describe('IPReputationService - Blocklist', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({ enableInternalBlocklist: true }, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should add IP to blocklist', async () => {
    await service.addToBlocklist('10.0.0.1', 'Malicious activity detected');

    expect(mockRedis.setex).toHaveBeenCalledWith(
      'vorion:ip_blocklist:10.0.0.1',
      expect.any(Number),
      expect.stringContaining('Malicious activity detected')
    );
    expect(mockRedis.del).toHaveBeenCalledWith('vorion:ip_reputation:10.0.0.1'); // Cache invalidation
  });

  it('should remove IP from blocklist', async () => {
    await service.removeFromBlocklist('10.0.0.1');

    expect(mockRedis.del).toHaveBeenCalledWith('vorion:ip_blocklist:10.0.0.1');
    expect(mockRedis.del).toHaveBeenCalledWith('vorion:ip_reputation:10.0.0.1');
  });

  it('should return isBlocked=true for blocked IP', async () => {
    mockRedis.exists.mockResolvedValueOnce(1); // IP is on blocklist

    const isBlocked = await service.isBlocked('10.0.0.1');

    expect(isBlocked).toBe(true);
  });
});

describe('IPReputationService - Reporting', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should increment report count', async () => {
    await service.reportMaliciousIP('10.0.0.2', 'Brute force attack', 'bruteforce');

    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'vorion:ip_reported:10.0.0.2',
      expect.any(Number),
      expect.stringContaining('Brute force attack')
    );
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('should auto-block after threshold reports', async () => {
    mockRedis.zcard.mockResolvedValueOnce(5); // 5 reports

    await service.reportMaliciousIP('10.0.0.3', 'Repeated attacks', 'bruteforce');

    // Should auto-add to blocklist
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'vorion:ip_blocklist:10.0.0.3',
      expect.any(Number),
      expect.stringContaining('Auto-blocked: 5 reports')
    );
  });
});

describe('IPReputationService - Datacenter Detection', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService(
      {
        enableDatacenterDetection: true,
        datacenterPenalty: 10,
        defaultScore: 80,
      },
      mockRedis as any
    );
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should detect AWS IP ranges', async () => {
    const reputation = await service.checkIP('52.10.20.30'); // AWS range

    expect(reputation.score).toBe(70); // 80 - 10 penalty
    expect(reputation.categories).toContain('datacenter');
    expect(reputation.categories).toContain('hosting');
  });

  it('should detect GCP IP ranges', async () => {
    const reputation = await service.checkIP('35.10.20.30'); // GCP range

    expect(reputation.score).toBe(70);
    expect(reputation.categories).toContain('datacenter');
  });
});

describe('IPReputationService - Tor Detection', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService(
      {
        enableTorDetection: true,
        torPenalty: 40,
        defaultScore: 80,
      },
      mockRedis as any
    );
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should detect Tor exit nodes', async () => {
    const reputation = await service.checkIP('185.220.100.1'); // Known Tor pattern

    expect(reputation.score).toBe(40); // 80 - 40 penalty
    expect(reputation.categories).toContain('tor');
  });
});

describe('IPReputationService - Private/Internal IPs', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should handle private IP ranges', async () => {
    const reputation = await service.checkIP('192.168.1.1');

    expect(reputation).toBeDefined();
    expect(reputation.score).toBeGreaterThan(0);
  });

  it('should handle localhost', async () => {
    const reputation = await service.checkIP('127.0.0.1');

    expect(reputation).toBeDefined();
    expect(reputation.score).toBeGreaterThan(0);
  });

  it('should handle 10.x private range', async () => {
    const reputation = await service.checkIP('10.0.0.1');

    expect(reputation).toBeDefined();
  });
});

describe('IPReputationService - L2 Cache', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should store in L2 cache after first check', async () => {
    await service.checkIP('1.2.3.4');

    expect(mockRedis.setex).toHaveBeenCalledWith(
      'vorion:ip_reputation:1.2.3.4',
      expect.any(Number),
      expect.stringContaining('"score"')
    );
  });

  it('should retrieve from L2 cache on second check', async () => {
    const cachedData = {
      score: 75,
      categories: ['datacenter'],
      lastSeen: new Date().toISOString(),
      reportCount: 0,
      source: 'builtin',
      confidence: 60,
      isBlocked: false,
      updatedAt: new Date().toISOString(),
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const reputation = await service.checkIP('1.2.3.5');

    expect(reputation.fromCache).toBe(true);
    expect(reputation.cacheLayer).toBe('l2');
    expect(reputation.score).toBe(75);
  });
});

describe('IPReputationService - Configuration', () => {
  it('should respect custom config', async () => {
    const service = new IPReputationService(
      {
        defaultScore: 90,
        blockThreshold: 30,
        torPenalty: 50,
      },
      mockRedis as any
    );

    const config = service['config'];
    expect(config.defaultScore).toBe(90);
    expect(config.blockThreshold).toBe(30);
    expect(config.torPenalty).toBe(50);

    await service.stop();
  });
});

describe('IPReputationService - Cache Statistics', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should return cache stats', async () => {
    await service.checkIP('1.2.3.4');
    await service.checkIP('1.2.3.5');

    const stats = service.getCacheStats();
    expect(stats.l1Size).toBeGreaterThan(0);
    expect(stats.l1MaxSize).toBe(1000);
  });
});

describe('IPReputationService - Clear Caches', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should clear all caches', async () => {
    mockRedis.scan.mockResolvedValueOnce(['0', ['key1', 'key2']]);

    await service.clearCaches();

    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2');

    const stats = service.getCacheStats();
    expect(stats.l1Size).toBe(0);
  });
});

describe('IPReputationService - Report Retrieval', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should retrieve reports for an IP', async () => {
    const reportData = {
      ip: '10.0.0.4',
      reason: 'Malicious activity',
      category: 'bruteforce',
      reportedAt: new Date().toISOString(),
    };

    mockRedis.zrevrange.mockResolvedValueOnce([JSON.stringify(reportData)]);

    const reports = await service.getReports('10.0.0.4');

    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('Malicious activity');
    expect(reports[0].category).toBe('bruteforce');
  });
});

describe('IPReputationService - Invalid IPs', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({}, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should handle invalid IP format', async () => {
    const reputation = await service.checkIP('not-an-ip');

    expect(reputation.score).toBeDefined();
    expect(reputation.source).toBe('invalid');
    expect(reputation.confidence).toBe(0);
  });

  it('should reject invalid IP in addToBlocklist', async () => {
    await expect(service.addToBlocklist('invalid-ip', 'test')).rejects.toThrow(
      'Invalid IP address format'
    );
  });

  it('should reject invalid IP in reportMaliciousIP', async () => {
    await expect(service.reportMaliciousIP('invalid-ip', 'test')).rejects.toThrow(
      'Invalid IP address format'
    );
  });
});

describe('IPReputationService - Report Score Adjustment', () => {
  let service: IPReputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IPReputationService({ defaultScore: 80 }, mockRedis as any);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should reduce score based on report count', async () => {
    mockRedis.zcard.mockResolvedValueOnce(3); // 3 reports

    const reputation = await service.checkIP('1.2.3.6');

    // Score should be reduced by 3 * 5 = 15 points
    expect(reputation.score).toBe(65); // 80 - 15
    expect(reputation.reportCount).toBe(3);
  });

  it('should cap report penalty at 30 points', async () => {
    mockRedis.zcard.mockResolvedValueOnce(10); // 10 reports

    const reputation = await service.checkIP('1.2.3.7');

    // Score should be reduced by max 30 points
    expect(reputation.score).toBe(50); // 80 - 30
  });
});
