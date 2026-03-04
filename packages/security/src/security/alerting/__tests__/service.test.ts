/**
 * Tests for SecurityAlertService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecurityAlertService } from '../service.js';
import type { CreateAlertInput, AlertRule, MaintenanceWindow, ChannelConfig } from '../types.js';
import { AlertSeverity, SecurityEventType, AlertChannel } from '../types.js';

// Mock Redis
const mockRedis = {
  exists: vi.fn().mockResolvedValue(0),
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  zadd: vi.fn().mockResolvedValue(1),
  zrevrange: vi.fn().mockResolvedValue([]),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  hset: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
};

vi.mock('../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

// Mock detector
const mockDetector = {
  detect: vi.fn().mockResolvedValue([]),
  addRule: vi.fn(),
  removeRule: vi.fn(),
};

/**
 * Helper to create a service with fresh config arrays.
 * DEFAULT_ALERT_CONFIG uses shared array references — shallow spread
 * in the constructor means addMaintenanceWindow/addRule mutate the
 * shared arrays, leaking state between tests. Passing explicit config
 * with fresh arrays prevents this.
 */
function createService(overrides: Record<string, unknown> = {}) {
  return new SecurityAlertService({
    redis: mockRedis as any,
    detector: mockDetector as any,
    config: {
      maintenanceWindows: [],
      rules: [],
      defaultChannels: [],
      escalationPolicies: [],
      channelSettings: {},
      ...overrides,
    },
  });
}

describe('SecurityAlertService - Create Alert', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should create alert with valid input', async () => {
    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
        ipAddress: '192.168.1.1',
      },
    };

    const alert = await service.createAlert(input);

    expect(alert).toBeDefined();
    expect(alert?.id).toBeDefined();
    expect(alert?.severity).toBe(AlertSeverity.HIGH);
    expect(alert?.acknowledged).toBe(false);
    expect(alert?.resolved).toBe(false);
    expect(mockRedis.setex).toHaveBeenCalled();
    expect(mockRedis.zadd).toHaveBeenCalled();
  });

  it('should deduplicate identical alerts within window', async () => {
    mockRedis.exists.mockResolvedValueOnce(1); // Alert already exists

    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
        ipAddress: '192.168.1.1',
      },
    };

    const alert = await service.createAlert(input);

    expect(alert).toBeNull();
    expect(mockRedis.setex).not.toHaveBeenCalled(); // Should not store duplicate
  });

  it('should allow duplicate after dedup window expires', async () => {
    mockRedis.exists.mockResolvedValueOnce(0); // No existing alert

    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
        ipAddress: '192.168.1.1',
      },
    };

    const alert = await service.createAlert(input);

    expect(alert).toBeDefined();
    expect(mockRedis.setex).toHaveBeenCalled();
  });
});

describe('SecurityAlertService - Maintenance Window', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should suppress alerts during maintenance window', async () => {
    const window: MaintenanceWindow = {
      id: 'mw-1',
      name: 'Scheduled Maintenance',
      startTime: new Date(Date.now() - 60000), // Started 1 minute ago
      endTime: new Date(Date.now() + 60000), // Ends in 1 minute
      suppressAll: true,
    };

    service.addMaintenanceWindow(window);

    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
      },
    };

    const alert = await service.createAlert(input);

    expect(alert).toBeNull();
  });

  it('should suppress only specific severities during maintenance', async () => {
    const window: MaintenanceWindow = {
      id: 'mw-2',
      name: 'Partial Maintenance',
      startTime: new Date(Date.now() - 60000),
      endTime: new Date(Date.now() + 60000),
      suppressedSeverities: [AlertSeverity.LOW, AlertSeverity.MEDIUM],
    };

    service.addMaintenanceWindow(window);

    // Low severity should be suppressed
    const lowInput: CreateAlertInput = {
      type: SecurityEventType.UNUSUAL_ACCESS_PATTERN,
      severity: AlertSeverity.LOW,
      title: 'Minor Anomaly',
      description: 'Low severity issue',
      context: {},
    };

    const lowAlert = await service.createAlert(lowInput);
    expect(lowAlert).toBeNull();

    // High severity should pass through
    const highInput: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'High severity issue',
      context: {},
    };

    const highAlert = await service.createAlert(highInput);
    expect(highAlert).toBeDefined();
  });
});

describe('SecurityAlertService - Alert Lifecycle', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should acknowledge alert', async () => {
    // storedAlertSchema requires id to be UUID format
    const alertData = {
      id: 'a1111111-1111-1111-1111-111111111111',
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Test Alert',
      description: 'Test description',
      timestamp: new Date().toISOString(),
      fingerprint: 'fp-123',
      acknowledged: false,
      resolved: false,
      context: {},
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(alertData));

    const acknowledged = await service.acknowledgeAlert(
      'a1111111-1111-1111-1111-111111111111',
      'admin-user'
    );

    expect(acknowledged).toBeDefined();
    expect(acknowledged?.acknowledged).toBe(true);
    expect(acknowledged?.acknowledgedBy).toBe('admin-user');
    expect(acknowledged?.acknowledgedAt).toBeDefined();
    expect(mockRedis.setex).toHaveBeenCalled();
  });

  it('should resolve alert', async () => {
    const alertData = {
      id: 'a2222222-2222-2222-2222-222222222222',
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Test Alert',
      description: 'Test description',
      timestamp: new Date().toISOString(),
      fingerprint: 'fp-123',
      acknowledged: true,
      resolved: false,
      context: {},
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(alertData));

    const resolved = await service.resolveAlert(
      'a2222222-2222-2222-2222-222222222222',
      'Issue resolved manually'
    );

    expect(resolved).toBeDefined();
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.resolutionNotes).toBe('Issue resolved manually');
    expect(mockRedis.setex).toHaveBeenCalled();
  });

  it('should return null for non-existent alert', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const result = await service.getAlert('non-existent');

    expect(result).toBeNull();
  });
});

describe('SecurityAlertService - Channel Routing', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService({ enabled: true, defaultChannels: [] });
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should filter channels by severity', async () => {
    const alertData = {
      id: 'alert-3',
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.MEDIUM,
      title: 'Test Alert',
      description: 'Test description',
      timestamp: new Date(),
      fingerprint: 'fp-123',
      acknowledged: false,
      resolved: false,
      context: {},
    };

    const channels: ChannelConfig[] = [
      {
        channel: AlertChannel.EMAIL,
        severityFilter: [AlertSeverity.HIGH, AlertSeverity.CRITICAL],
      },
      {
        channel: AlertChannel.SLACK,
        severityFilter: [AlertSeverity.MEDIUM, AlertSeverity.HIGH],
      },
    ];

    const results = await service.sendAlert(alertData as any, channels);

    // EMAIL should be filtered out (MEDIUM not in filter)
    // Only SLACK should receive the alert
    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe(AlertChannel.SLACK);
  });

  it('should respect rate limits', async () => {
    mockRedis.incr
      .mockResolvedValueOnce(1) // First request
      .mockResolvedValueOnce(11); // Exceeds limit of 10

    const alertData = {
      id: 'alert-4',
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Test Alert',
      description: 'Test description',
      timestamp: new Date(),
      fingerprint: 'fp-123',
      acknowledged: false,
      resolved: false,
      context: {},
    };

    const channels: ChannelConfig[] = [
      {
        channel: AlertChannel.EMAIL,
        rateLimit: 10, // 10 per minute
      },
    ];

    // First send should succeed
    await service.sendAlert(alertData as any, channels);

    // Second send should be rate limited
    const results = await service.sendAlert(alertData as any, channels);
    expect(results).toHaveLength(0);
  });
});

describe('SecurityAlertService - Event Callbacks', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should invoke event callback on alert creation', async () => {
    const callback = vi.fn();
    service.onEvent(callback);

    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
      },
    };

    await service.createAlert(input);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'created',
        alert: expect.objectContaining({
          severity: AlertSeverity.HIGH,
        }),
      })
    );
  });

  it('should invoke callback on deduplication', async () => {
    mockRedis.exists.mockResolvedValueOnce(1);

    const callback = vi.fn();
    service.onEvent(callback);

    const input: CreateAlertInput = {
      type: SecurityEventType.BRUTE_FORCE,
      severity: AlertSeverity.HIGH,
      title: 'Brute Force Detected',
      description: 'Multiple failed login attempts',
      context: {
        userId: 'user1',
      },
    };

    await service.createAlert(input);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'deduplicated',
      })
    );
  });
});

describe('SecurityAlertService - Rule Management', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should add custom alert rule', () => {
    const rule: AlertRule = {
      id: 'rule-1',
      name: 'Custom Rule',
      description: 'Test rule',
      enabled: true,
      conditions: {
        eventTypes: [SecurityEventType.BRUTE_FORCE],
        minSeverity: AlertSeverity.MEDIUM,
      },
      actions: {
        createAlert: true,
        severity: AlertSeverity.HIGH,
        title: 'Custom Alert',
        description: 'Custom description',
      },
    };

    service.addRule(rule);

    expect(mockDetector.addRule).toHaveBeenCalledWith(rule);
  });

  it('should remove custom alert rule', () => {
    const rule: AlertRule = {
      id: 'rule-2',
      name: 'Custom Rule',
      description: 'Test rule',
      enabled: true,
      conditions: {
        eventTypes: [SecurityEventType.BRUTE_FORCE],
      },
      actions: {
        createAlert: true,
        severity: AlertSeverity.HIGH,
        title: 'Custom Alert',
        description: 'Custom description',
      },
    };

    service.addRule(rule);
    const removed = service.removeRule('rule-2');

    expect(removed).toBe(true);
    expect(mockDetector.removeRule).toHaveBeenCalledWith('rule-2');
  });
});

describe('SecurityAlertService - Maintenance Windows', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should add maintenance window', () => {
    const window: MaintenanceWindow = {
      id: 'mw-3',
      name: 'Test Maintenance',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      suppressAll: true,
    };

    service.addMaintenanceWindow(window);
    const active = service.getActiveMaintenanceWindows();

    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('mw-3');
  });

  it('should remove maintenance window', () => {
    const window: MaintenanceWindow = {
      id: 'mw-4',
      name: 'Test Maintenance',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      suppressAll: true,
    };

    service.addMaintenanceWindow(window);
    const removed = service.removeMaintenanceWindow('mw-4');

    expect(removed).toBe(true);
    expect(service.getActiveMaintenanceWindows()).toHaveLength(0);
  });

  it('should only return active maintenance windows', () => {
    const pastWindow: MaintenanceWindow = {
      id: 'mw-past',
      name: 'Past Maintenance',
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 3600000),
      suppressAll: true,
    };

    const activeWindow: MaintenanceWindow = {
      id: 'mw-active',
      name: 'Active Maintenance',
      startTime: new Date(Date.now() - 60000),
      endTime: new Date(Date.now() + 60000),
      suppressAll: true,
    };

    service.addMaintenanceWindow(pastWindow);
    service.addMaintenanceWindow(activeWindow);

    const active = service.getActiveMaintenanceWindows();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('mw-active');
  });
});

describe('SecurityAlertService - Shutdown', () => {
  it('should cleanup on shutdown', () => {
    const service = createService();

    service.shutdown();
    // Should not throw
  });
});

describe('SecurityAlertService - Stats', () => {
  let service: SecurityAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should compute alert statistics', async () => {
    // storedAlertSchema requires UUID-formatted IDs
    const id1 = 'a5555555-5555-5555-5555-555555555555';
    const id2 = 'a6666666-6666-6666-6666-666666666666';
    const now = new Date();

    const alerts = [
      {
        id: id1,
        type: SecurityEventType.BRUTE_FORCE,
        severity: AlertSeverity.HIGH,
        title: 'Alert 1',
        description: 'Description 1',
        timestamp: now.toISOString(),
        fingerprint: 'fp-1',
        acknowledged: true,
        acknowledgedAt: new Date(now.getTime() + 60000).toISOString(),
        resolved: false,
        context: {},
      },
      {
        id: id2,
        type: SecurityEventType.UNUSUAL_ACCESS_PATTERN,
        severity: AlertSeverity.MEDIUM,
        title: 'Alert 2',
        description: 'Description 2',
        timestamp: now.toISOString(),
        fingerprint: 'fp-2',
        acknowledged: false,
        resolved: true,
        context: {},
      },
    ];

    mockRedis.zrevrange.mockResolvedValueOnce([id1, id2]);
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify(alerts[0]))
      .mockResolvedValueOnce(JSON.stringify(alerts[1]));

    const stats = await service.getStats(24);

    expect(stats.total).toBe(2);
    expect(stats.acknowledged).toBe(1);
    expect(stats.resolved).toBe(1);
    expect(stats.bySeverity[AlertSeverity.HIGH]).toBe(1);
    expect(stats.bySeverity[AlertSeverity.MEDIUM]).toBe(1);
  });
});
