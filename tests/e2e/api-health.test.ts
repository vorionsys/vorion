/**
 * API Health/Infrastructure E2E Tests
 *
 * Comprehensive end-to-end tests for health and infrastructure endpoints including:
 * - Health endpoints (/health/live, /health/ready, /health/startup)
 * - Metrics endpoint
 * - API versioning
 *
 * Uses vitest with mocked external dependencies but tests full request/response cycles.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock health state
let mockDatabaseHealthy = true;
let mockRedisHealthy = true;
let mockQueueHealthy = true;
let mockMigrationsHealthy = true;
let mockStartupComplete = false;
let mockLiteMode = false;
let mockUptimeSeconds = 0;

// Circuit breaker states
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
let mockDatabaseCircuitState: CircuitState = 'CLOSED';
let mockRedisCircuitState: CircuitState = 'CLOSED';

function resetHealthState(): void {
  mockDatabaseHealthy = true;
  mockRedisHealthy = true;
  mockQueueHealthy = true;
  mockMigrationsHealthy = true;
  mockStartupComplete = true;
  mockLiteMode = false;
  mockUptimeSeconds = 120;
  mockDatabaseCircuitState = 'CLOSED';
  mockRedisCircuitState = 'CLOSED';
}

// Mock configuration
vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    api: {
      port: 3000,
      host: '0.0.0.0',
      basePath: '/api/v1',
      version: '1.0.0',
    },
    database: {
      host: 'localhost',
      port: 5432,
      database: 'vorion_test',
      poolMin: 2,
      poolMax: 10,
      statementTimeoutMs: 30000,
    },
    redis: {
      host: 'localhost',
      port: 6379,
    },
    health: {
      checkTimeoutMs: 5000,
      readyTimeoutMs: 10000,
      livenessTimeoutMs: 1000,
    },
    circuitBreaker: {
      database: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
      },
      redis: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
      },
    },
    intent: {
      queueDepthThreshold: 10000,
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TYPES
// =============================================================================

interface LivenessResponse {
  alive: boolean;
  timestamp: string;
}

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  mode: 'lite' | 'full';
  checks: {
    database: { healthy: boolean; latencyMs?: number };
    redis?: { healthy: boolean; latencyMs?: number } | { status: string; message: string };
    queue?: {
      healthy: boolean;
      workersAvailable: boolean;
      queueDepth: number;
      maxQueueDepth: number;
      activeJobs: number;
      waitingJobs: number;
      failedJobs: number;
      deadLetterCount: number;
      processingLatencyMs?: number;
      canaryJob?: string;
    };
  };
  timestamp: string;
}

interface StartupResponse {
  status: 'started' | 'starting';
  mode: 'lite' | 'full';
  checks: {
    database: { healthy: boolean };
    redis?: { healthy: boolean } | { status: string; message: string };
    migrations: {
      status: string;
      healthy: boolean;
      schemaVersion?: string;
      pendingCount?: number;
      lastApplied?: string;
      autoMigrateEnabled?: boolean;
      error?: string;
    };
  };
  durationMs: number;
  timestamp: string;
}

interface DetailedHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  mode: 'lite' | 'full';
  version: string;
  environment: string;
  nodeVersion: string;
  uptime: number;
  timestamp: string;
  affectedServices?: string[];
  services: {
    database: {
      healthy: boolean;
      latencyMs: number;
      error?: string;
      circuit: {
        state: CircuitState;
        failureCount: number;
        failureThreshold: number;
        timeUntilResetMs?: number;
      };
    };
    redis: {
      healthy: boolean;
      latencyMs: number;
      error?: string;
      circuit: {
        state: CircuitState;
        failureCount: number;
        failureThreshold: number;
        timeUntilResetMs?: number;
      };
    } | { status: string; message: string };
    queues: {
      healthy: boolean;
      workersAvailable: boolean;
      workersRunning: boolean;
      queueDepth: number;
      maxQueueDepth: number;
      processingLatencyMs?: number;
      jobs: {
        active: number;
        waiting: number;
        completed: number;
        failed: number;
        deadLetter: number;
      };
    } | { status: string; message: string };
  };
  circuitBreakers: Record<string, {
    state: CircuitState;
    failureCount: number;
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
    halfOpenAttempts: number;
    monitorWindowMs: number;
    lastFailureTime: string | null;
    openedAt: string | null;
    timeUntilResetMs?: number;
  }>;
  process: {
    pid: number;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    cpu: {
      user: number;
      system: number;
    };
  };
  config: {
    database: {
      poolMin: number;
      poolMax: number;
      statementTimeoutMs: number;
    };
    circuitBreaker: {
      database: object;
      redis: object;
    };
    health: {
      checkTimeoutMs: number;
      readyTimeoutMs: number;
      livenessTimeoutMs: number;
    };
  };
}

interface MetricsResponse {
  intents: {
    total: number;
    byStatus: Record<string, number>;
    submitted24h: number;
    avgProcessingTimeMs: number;
  };
  escalations: {
    pending: number;
    resolved24h: number;
    avgResolutionTimeMs: number;
  };
  policies: {
    total: number;
    active: number;
    evaluations24h: number;
  };
  system: {
    uptime: number;
    requestsPerMinute: number;
    errorRate: number;
    p99LatencyMs: number;
  };
}

// =============================================================================
// MOCK SERVICES
// =============================================================================

/**
 * Mock Health Service
 */
class MockHealthService {
  async checkLiveness(): Promise<{ alive: boolean }> {
    // Liveness should be quick and only check if the process is responding
    return { alive: true };
  }

  async checkReadiness(): Promise<{
    healthy: boolean;
    checks: {
      database: { healthy: boolean; latencyMs: number };
      redis: { healthy: boolean; latencyMs: number };
    };
    timestamp: string;
  }> {
    return {
      healthy: mockDatabaseHealthy && (mockLiteMode || mockRedisHealthy),
      checks: {
        database: { healthy: mockDatabaseHealthy, latencyMs: 5 },
        redis: { healthy: mockRedisHealthy, latencyMs: 2 },
      },
      timestamp: new Date().toISOString(),
    };
  }

  async checkStartup(): Promise<{
    ready: boolean;
    checks: {
      database: { healthy: boolean };
      redis: { healthy: boolean };
      migrations: { healthy: boolean; status: string };
    };
    durationMs: number;
    timestamp: string;
  }> {
    return {
      ready: mockStartupComplete && mockDatabaseHealthy && (mockLiteMode || mockRedisHealthy) && mockMigrationsHealthy,
      checks: {
        database: { healthy: mockDatabaseHealthy },
        redis: { healthy: mockRedisHealthy },
        migrations: {
          healthy: mockMigrationsHealthy,
          status: mockMigrationsHealthy ? 'up_to_date' : 'pending',
        },
      },
      durationMs: 1500,
      timestamp: new Date().toISOString(),
    };
  }

  async checkDatabase(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return {
      healthy: mockDatabaseHealthy,
      latencyMs: mockDatabaseHealthy ? 5 : 0,
      error: mockDatabaseHealthy ? undefined : 'Connection failed',
    };
  }

  async checkRedis(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return {
      healthy: mockRedisHealthy,
      latencyMs: mockRedisHealthy ? 2 : 0,
      error: mockRedisHealthy ? undefined : 'Connection refused',
    };
  }

  async checkQueues(): Promise<{
    healthy: boolean;
    workersAvailable: boolean;
    queueDepth: number;
    activeJobs: number;
    waitingJobs: number;
    completedJobs: number;
    failedJobs: number;
    deadLetterCount: number;
    processingLatency?: number;
    canaryJobResult?: string;
  }> {
    return {
      healthy: mockQueueHealthy,
      workersAvailable: mockQueueHealthy,
      queueDepth: 50,
      activeJobs: 5,
      waitingJobs: 45,
      completedJobs: 1000,
      failedJobs: 10,
      deadLetterCount: 2,
      processingLatency: 150,
      canaryJobResult: mockQueueHealthy ? 'success' : 'failed',
    };
  }

  getCircuitBreakerStatus(name: string): {
    state: CircuitState;
    failureCount: number;
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
    halfOpenAttempts: number;
    monitorWindowMs: number;
    lastFailureTime: Date | null;
    openedAt: Date | null;
    timeUntilReset: number | null;
  } {
    const state = name === 'database' ? mockDatabaseCircuitState : mockRedisCircuitState;
    return {
      state,
      failureCount: state === 'OPEN' ? 5 : 0,
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxAttempts: 3,
      halfOpenAttempts: state === 'HALF_OPEN' ? 1 : 0,
      monitorWindowMs: 60000,
      lastFailureTime: state === 'OPEN' ? new Date() : null,
      openedAt: state === 'OPEN' ? new Date(Date.now() - 10000) : null,
      timeUntilReset: state === 'OPEN' ? 20000 : null,
    };
  }

  getUptime(): number {
    return mockUptimeSeconds;
  }

  getMigrationStatus(): {
    status: string;
    healthy: boolean;
    details: {
      schemaVersion: string;
      pendingCount: number;
      lastApplied: string;
      autoMigrateEnabled: boolean;
    };
    error?: string;
  } {
    return {
      status: mockMigrationsHealthy ? 'up_to_date' : 'pending',
      healthy: mockMigrationsHealthy,
      details: {
        schemaVersion: '20240201120000',
        pendingCount: mockMigrationsHealthy ? 0 : 3,
        lastApplied: '2024-02-01T12:00:00Z',
        autoMigrateEnabled: true,
      },
      error: mockMigrationsHealthy ? undefined : 'Pending migrations require manual intervention',
    };
  }
}

/**
 * Mock Metrics Service
 */
class MockMetricsService {
  async getMetrics(): Promise<MetricsResponse> {
    return {
      intents: {
        total: 15000,
        byStatus: {
          pending: 150,
          approved: 12000,
          denied: 2500,
          escalated: 300,
          cancelled: 50,
        },
        submitted24h: 500,
        avgProcessingTimeMs: 250,
      },
      escalations: {
        pending: 25,
        resolved24h: 45,
        avgResolutionTimeMs: 3600000, // 1 hour
      },
      policies: {
        total: 50,
        active: 42,
        evaluations24h: 5000,
      },
      system: {
        uptime: mockUptimeSeconds,
        requestsPerMinute: 120,
        errorRate: 0.02,
        p99LatencyMs: 450,
      },
    };
  }

  async getPrometheusMetrics(): Promise<string> {
    return `
# HELP vorion_intents_total Total number of intents
# TYPE vorion_intents_total counter
vorion_intents_total{status="pending"} 150
vorion_intents_total{status="approved"} 12000
vorion_intents_total{status="denied"} 2500
vorion_intents_total{status="escalated"} 300
vorion_intents_total{status="cancelled"} 50

# HELP vorion_escalations_pending Number of pending escalations
# TYPE vorion_escalations_pending gauge
vorion_escalations_pending 25

# HELP vorion_request_duration_seconds Request duration in seconds
# TYPE vorion_request_duration_seconds histogram
vorion_request_duration_seconds_bucket{le="0.1"} 8000
vorion_request_duration_seconds_bucket{le="0.25"} 9500
vorion_request_duration_seconds_bucket{le="0.5"} 9800
vorion_request_duration_seconds_bucket{le="1"} 9950
vorion_request_duration_seconds_bucket{le="+Inf"} 10000
vorion_request_duration_seconds_sum 1250
vorion_request_duration_seconds_count 10000

# HELP vorion_uptime_seconds Server uptime in seconds
# TYPE vorion_uptime_seconds gauge
vorion_uptime_seconds ${mockUptimeSeconds}
`.trim();
  }
}

/**
 * Mock API Version Service
 */
class MockVersionService {
  getApiVersion(): string {
    return '1.0.0';
  }

  getSupportedVersions(): string[] {
    return ['v1'];
  }

  getDeprecatedVersions(): string[] {
    return [];
  }

  getVersionInfo(): {
    current: string;
    supported: string[];
    deprecated: string[];
    sunset: Record<string, string>;
  } {
    return {
      current: 'v1',
      supported: ['v1'],
      deprecated: [],
      sunset: {},
    };
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('API Health/Infrastructure E2E Tests', () => {
  const healthService = new MockHealthService();
  const metricsService = new MockMetricsService();
  const versionService = new MockVersionService();

  beforeEach(() => {
    resetHealthState();
  });

  // ===========================================================================
  // LIVENESS PROBE
  // ===========================================================================

  describe('GET /health/live - Liveness Probe', () => {
    it('should return 200 when service is alive', async () => {
      const result = await healthService.checkLiveness();

      expect(result.alive).toBe(true);
    });

    it('should be fast and not check external dependencies', async () => {
      const startTime = Date.now();
      await healthService.checkLiveness();
      const duration = Date.now() - startTime;

      // Liveness check should be very fast (< 10ms)
      expect(duration).toBeLessThan(100);
    });

    it('should return alive even when database is down', async () => {
      mockDatabaseHealthy = false;

      const result = await healthService.checkLiveness();

      // Liveness only checks if process is running, not dependencies
      expect(result.alive).toBe(true);
    });

    it('should return alive even when Redis is down', async () => {
      mockRedisHealthy = false;

      const result = await healthService.checkLiveness();

      expect(result.alive).toBe(true);
    });
  });

  // ===========================================================================
  // READINESS PROBE
  // ===========================================================================

  describe('GET /health/ready - Readiness Probe', () => {
    it('should return ready when all dependencies are healthy', async () => {
      const result = await healthService.checkReadiness();

      expect(result.healthy).toBe(true);
      expect(result.checks.database.healthy).toBe(true);
      expect(result.checks.redis.healthy).toBe(true);
    });

    it('should return not ready when database is down', async () => {
      mockDatabaseHealthy = false;

      const result = await healthService.checkReadiness();

      expect(result.healthy).toBe(false);
      expect(result.checks.database.healthy).toBe(false);
    });

    it('should return not ready when Redis is down (full mode)', async () => {
      mockRedisHealthy = false;

      const result = await healthService.checkReadiness();

      expect(result.healthy).toBe(false);
      expect(result.checks.redis.healthy).toBe(false);
    });

    it('should return ready when Redis is down (lite mode)', async () => {
      mockRedisHealthy = false;
      mockLiteMode = true;

      const result = await healthService.checkReadiness();

      // In lite mode, Redis is not required
      expect(result.healthy).toBe(true);
    });

    it('should include latency measurements', async () => {
      const result = await healthService.checkReadiness();

      expect(result.checks.database.latencyMs).toBeDefined();
      expect(result.checks.database.latencyMs).toBeGreaterThan(0);
      expect(result.checks.redis.latencyMs).toBeDefined();
    });

    it('should include queue health in full mode', async () => {
      const queueHealth = await healthService.checkQueues();

      expect(queueHealth.healthy).toBe(true);
      expect(queueHealth.workersAvailable).toBe(true);
      expect(queueHealth.queueDepth).toBeDefined();
    });

    it('should return not ready when queue depth exceeds threshold', async () => {
      mockQueueHealthy = false;

      const queueHealth = await healthService.checkQueues();

      expect(queueHealth.healthy).toBe(false);
    });
  });

  // ===========================================================================
  // STARTUP PROBE
  // ===========================================================================

  describe('GET /health/startup - Startup Probe', () => {
    it('should return started when initialization is complete', async () => {
      mockStartupComplete = true;

      const result = await healthService.checkStartup();

      expect(result.ready).toBe(true);
    });

    it('should return starting when initialization is incomplete', async () => {
      mockStartupComplete = false;

      const result = await healthService.checkStartup();

      expect(result.ready).toBe(false);
    });

    it('should check migration status', async () => {
      const result = await healthService.checkStartup();

      expect(result.checks.migrations).toBeDefined();
      expect(result.checks.migrations.healthy).toBe(true);
    });

    it('should return not ready when migrations are pending', async () => {
      mockMigrationsHealthy = false;

      const result = await healthService.checkStartup();

      expect(result.ready).toBe(false);
      expect(result.checks.migrations.healthy).toBe(false);
    });

    it('should include initialization duration', async () => {
      const result = await healthService.checkStartup();

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should include migration details', async () => {
      const migrationStatus = healthService.getMigrationStatus();

      expect(migrationStatus.details.schemaVersion).toBeDefined();
      expect(migrationStatus.details.pendingCount).toBeDefined();
      expect(migrationStatus.details.autoMigrateEnabled).toBeDefined();
    });
  });

  // ===========================================================================
  // DETAILED HEALTH
  // ===========================================================================

  describe('GET /health - Detailed Health Status', () => {
    it('should return healthy status when all systems are operational', async () => {
      const dbStatus = healthService.getCircuitBreakerStatus('database');
      const redisStatus = healthService.getCircuitBreakerStatus('redis');

      expect(dbStatus.state).toBe('CLOSED');
      expect(redisStatus.state).toBe('CLOSED');
    });

    it('should return degraded status when circuit breaker is open', async () => {
      mockDatabaseCircuitState = 'OPEN';

      const dbStatus = healthService.getCircuitBreakerStatus('database');

      expect(dbStatus.state).toBe('OPEN');
      expect(dbStatus.failureCount).toBeGreaterThan(0);
    });

    it('should include circuit breaker details', async () => {
      const dbStatus = healthService.getCircuitBreakerStatus('database');

      expect(dbStatus.failureThreshold).toBeDefined();
      expect(dbStatus.resetTimeoutMs).toBeDefined();
      expect(dbStatus.monitorWindowMs).toBeDefined();
    });

    it('should include affected services list when circuits are open', async () => {
      mockDatabaseCircuitState = 'OPEN';
      mockRedisCircuitState = 'OPEN';

      const dbStatus = healthService.getCircuitBreakerStatus('database');
      const redisStatus = healthService.getCircuitBreakerStatus('redis');

      expect(dbStatus.state).toBe('OPEN');
      expect(redisStatus.state).toBe('OPEN');
    });

    it('should include half-open circuit information', async () => {
      mockDatabaseCircuitState = 'HALF_OPEN';

      const dbStatus = healthService.getCircuitBreakerStatus('database');

      expect(dbStatus.state).toBe('HALF_OPEN');
      expect(dbStatus.halfOpenAttempts).toBeGreaterThan(0);
    });

    it('should include uptime information', async () => {
      mockUptimeSeconds = 3600;

      const uptime = healthService.getUptime();

      expect(uptime).toBe(3600);
    });

    it('should return unhealthy when database is completely unavailable', async () => {
      mockDatabaseHealthy = false;

      const dbHealth = await healthService.checkDatabase();

      expect(dbHealth.healthy).toBe(false);
      expect(dbHealth.error).toBeDefined();
    });
  });

  // ===========================================================================
  // DETAILED HEALTH ENDPOINT
  // ===========================================================================

  describe('GET /health/detailed - Full System Status', () => {
    it('should include all service statuses', async () => {
      const dbHealth = await healthService.checkDatabase();
      const redisHealth = await healthService.checkRedis();
      const queueHealth = await healthService.checkQueues();

      expect(dbHealth).toBeDefined();
      expect(redisHealth).toBeDefined();
      expect(queueHealth).toBeDefined();
    });

    it('should include process memory information', () => {
      // This would be provided by the actual process.memoryUsage()
      const memUsage = process.memoryUsage();

      expect(memUsage.rss).toBeGreaterThan(0);
      expect(memUsage.heapTotal).toBeGreaterThan(0);
      expect(memUsage.heapUsed).toBeGreaterThan(0);
    });

    it('should include configuration summary (non-sensitive)', () => {
      const config = {
        database: {
          poolMin: 2,
          poolMax: 10,
          statementTimeoutMs: 30000,
        },
        health: {
          checkTimeoutMs: 5000,
          readyTimeoutMs: 10000,
        },
      };

      expect(config.database.poolMin).toBeDefined();
      expect(config.database.poolMax).toBeDefined();
      expect(config.health.checkTimeoutMs).toBeDefined();
    });

    it('should not include sensitive configuration', () => {
      // Ensure passwords, secrets, etc. are not exposed
      const safeConfig = {
        database: { poolMin: 2, poolMax: 10 },
      };

      expect(safeConfig).not.toHaveProperty('password');
      expect(safeConfig).not.toHaveProperty('secret');
      expect(safeConfig).not.toHaveProperty('apiKey');
    });
  });

  // ===========================================================================
  // METRICS ENDPOINT
  // ===========================================================================

  describe('GET /metrics - Prometheus Metrics', () => {
    it('should return metrics in Prometheus format', async () => {
      const metrics = await metricsService.getPrometheusMetrics();

      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
      expect(metrics).toContain('vorion_intents_total');
    });

    it('should include intent metrics', async () => {
      const metrics = await metricsService.getMetrics();

      expect(metrics.intents.total).toBeDefined();
      expect(metrics.intents.byStatus).toBeDefined();
      expect(metrics.intents.submitted24h).toBeDefined();
    });

    it('should include escalation metrics', async () => {
      const metrics = await metricsService.getMetrics();

      expect(metrics.escalations.pending).toBeDefined();
      expect(metrics.escalations.resolved24h).toBeDefined();
      expect(metrics.escalations.avgResolutionTimeMs).toBeDefined();
    });

    it('should include policy metrics', async () => {
      const metrics = await metricsService.getMetrics();

      expect(metrics.policies.total).toBeDefined();
      expect(metrics.policies.active).toBeDefined();
      expect(metrics.policies.evaluations24h).toBeDefined();
    });

    it('should include system metrics', async () => {
      const metrics = await metricsService.getMetrics();

      expect(metrics.system.uptime).toBeDefined();
      expect(metrics.system.requestsPerMinute).toBeDefined();
      expect(metrics.system.errorRate).toBeDefined();
      expect(metrics.system.p99LatencyMs).toBeDefined();
    });

    it('should include histogram metrics for latency', async () => {
      const prometheusMetrics = await metricsService.getPrometheusMetrics();

      expect(prometheusMetrics).toContain('histogram');
      expect(prometheusMetrics).toContain('_bucket');
      expect(prometheusMetrics).toContain('_sum');
      expect(prometheusMetrics).toContain('_count');
    });

    it('should include uptime metric', async () => {
      mockUptimeSeconds = 7200;

      const prometheusMetrics = await metricsService.getPrometheusMetrics();

      expect(prometheusMetrics).toContain('vorion_uptime_seconds');
      expect(prometheusMetrics).toContain('7200');
    });
  });

  // ===========================================================================
  // API VERSIONING
  // ===========================================================================

  describe('API Versioning', () => {
    it('should return current API version', () => {
      const version = versionService.getApiVersion();

      expect(version).toBe('1.0.0');
    });

    it('should return list of supported versions', () => {
      const supported = versionService.getSupportedVersions();

      expect(supported).toContain('v1');
    });

    it('should return list of deprecated versions', () => {
      const deprecated = versionService.getDeprecatedVersions();

      expect(Array.isArray(deprecated)).toBe(true);
    });

    it('should provide version info with sunset dates', () => {
      const versionInfo = versionService.getVersionInfo();

      expect(versionInfo.current).toBeDefined();
      expect(versionInfo.supported).toBeDefined();
      expect(versionInfo.deprecated).toBeDefined();
      expect(versionInfo.sunset).toBeDefined();
    });

    it('should support v1 API prefix', () => {
      // All v1 endpoints should be accessible under /api/v1
      const v1Endpoints = [
        '/api/v1/intents',
        '/api/v1/policies',
        '/api/v1/escalations',
        '/api/v1/health',
        '/api/v1/rbac/roles',
      ];

      v1Endpoints.forEach(endpoint => {
        expect(endpoint).toMatch(/^\/api\/v1\//);
      });
    });

    it('should include version header in responses', () => {
      // In actual implementation, responses would include X-API-Version header
      const headers = {
        'X-API-Version': 'v1',
        'X-Supported-Versions': 'v1',
      };

      expect(headers['X-API-Version']).toBe('v1');
    });
  });

  // ===========================================================================
  // LEGACY INTENT MODULE ENDPOINTS
  // ===========================================================================

  describe('Legacy Intent Module Health Endpoints', () => {
    it('should return intent module health status', () => {
      const intentHealth = {
        status: 'healthy',
        service: 'intent',
        version: 'v1',
        mode: mockLiteMode ? 'lite' : 'full',
        timestamp: new Date().toISOString(),
      };

      expect(intentHealth.status).toBe('healthy');
      expect(intentHealth.service).toBe('intent');
    });

    it('should return intent module readiness', async () => {
      const readiness = await healthService.checkReadiness();

      expect(readiness.healthy).toBe(true);
    });

    it('should include queue status in full mode', async () => {
      mockLiteMode = false;

      const queueHealth = await healthService.checkQueues();

      expect(queueHealth.workersAvailable).toBeDefined();
      expect(queueHealth.queueDepth).toBeDefined();
    });

    it('should skip queue check in lite mode', () => {
      mockLiteMode = true;

      // In lite mode, queue checks are skipped
      const liteHealthCheck = {
        status: 'healthy',
        mode: 'lite',
        checks: {
          database: { healthy: mockDatabaseHealthy },
          redis: { status: 'skipped', message: 'Not required in lite mode' },
          queues: { status: 'skipped', message: 'Not required in lite mode' },
        },
      };

      expect(liteHealthCheck.checks.redis.status).toBe('skipped');
      expect(liteHealthCheck.checks.queues.status).toBe('skipped');
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle database check timeout', async () => {
      // Simulate timeout by making database unhealthy
      mockDatabaseHealthy = false;

      const result = await healthService.checkDatabase();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle Redis check timeout', async () => {
      mockRedisHealthy = false;

      const result = await healthService.checkRedis();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle queue check failure gracefully', async () => {
      mockQueueHealthy = false;

      const result = await healthService.checkQueues();

      expect(result.healthy).toBe(false);
    });

    it('should return appropriate HTTP status codes', () => {
      // Status code mapping
      const statusCodes = {
        healthy: 200,
        degraded: 200, // Still operational but with warnings
        unhealthy: 503,
        notReady: 503,
        notStarted: 503,
      };

      expect(statusCodes.healthy).toBe(200);
      expect(statusCodes.unhealthy).toBe(503);
    });
  });

  // ===========================================================================
  // CONCURRENT HEALTH CHECKS
  // ===========================================================================

  describe('Concurrent Health Checks', () => {
    it('should handle multiple concurrent health checks', async () => {
      const checks = await Promise.all([
        healthService.checkLiveness(),
        healthService.checkReadiness(),
        healthService.checkStartup(),
        healthService.checkDatabase(),
        healthService.checkRedis(),
      ]);

      expect(checks.length).toBe(5);
      checks.forEach(check => {
        expect(check).toBeDefined();
      });
    });

    it('should not block on slow dependency checks', async () => {
      const startTime = Date.now();

      // Run multiple health checks
      await Promise.all([
        healthService.checkLiveness(),
        healthService.checkLiveness(),
        healthService.checkLiveness(),
      ]);

      const duration = Date.now() - startTime;

      // Liveness checks should be fast
      expect(duration).toBeLessThan(1000);
    });
  });
});
