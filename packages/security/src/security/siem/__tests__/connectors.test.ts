/**
 * SIEM Connectors & Service Tests
 *
 * Tests for SplunkConnector, ElasticConnector, DatadogConnector,
 * and SIEMService orchestration including buffering, circuit breaker,
 * metrics, and lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks (must be before imports)
// =============================================================================

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('prom-client', () => {
  class FakeRegistry {
    registerMetric = vi.fn();
    getSingleMetric = vi.fn();
    metrics = vi.fn().mockResolvedValue('');
    contentType = 'text/plain';
  }
  class FakeCounter {
    inc = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class FakeHistogram {
    observe = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  class FakeGauge {
    set = vi.fn();
    labels = vi.fn().mockReturnThis();
  }
  return {
    Registry: FakeRegistry,
    Counter: FakeCounter,
    Histogram: FakeHistogram,
    Gauge: FakeGauge,
    collectDefaultMetrics: vi.fn(),
  };
});

vi.mock('../../../common/metrics-registry.js', () => ({
  vorionRegistry: {
    registerMetric: vi.fn(),
    getSingleMetric: vi.fn(),
    metrics: vi.fn().mockResolvedValue(''),
    contentType: 'text/plain',
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('../enrichment.js', () => {
  class FakeEventEnricher {
    enrich = vi.fn(async (event: unknown) => ({
      event,
      enrichedFields: [],
      errors: [],
      durationMs: 0,
    }));
  }
  const noOpInstance = new FakeEventEnricher();
  return {
    EventEnricher: FakeEventEnricher,
    createNoOpEnricher: () => noOpInstance,
  };
});

vi.mock('../formatter.js', () => {
  class FakeEventFormatter {
    formatJSON = vi.fn((e: unknown) => JSON.stringify(e));
    formatCEF = vi.fn(() => '');
    formatSyslog = vi.fn(() => '');
  }
  return { EventFormatter: FakeEventFormatter };
});

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { SplunkConnector } from '../splunk.js';
import { ElasticConnector } from '../elastic.js';
import { DatadogConnector } from '../datadog.js';
import { createSIEMService } from '../service.js';
import type { SecurityEvent } from '../types.js';
import type { SIEMConnector } from '../connector.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date('2024-01-15T12:00:00Z'),
    eventType: 'LOGIN_SUCCESS',
    category: 'authentication',
    severity: 4,
    outcome: 'success',
    message: 'User authenticated',
    source: 'vorion',
    ...overrides,
  } as SecurityEvent;
}

function mockOkResponse(body: unknown = {}): Response {
  const bodyText = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

function mockErrorResponse(status = 500, body = 'Internal Server Error'): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.reject(new Error('not json')),
    headers: new Headers(),
  } as unknown as Response;
}

// =============================================================================
// Global Fetch Mock
// =============================================================================

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// =============================================================================
// Splunk Connector Tests
// =============================================================================

describe('SplunkConnector', () => {
  const splunkConfig = {
    type: 'splunk' as const,
    name: 'test-splunk',
    enabled: true,
    hecUrl: 'https://splunk.example.com:8088',
    token: 'test-token',
    index: 'security',
    sourcetype: 'vorion:security',
    maxRetries: 0,
  };

  it('stores config correctly', () => {
    const connector = new SplunkConnector(splunkConfig);

    expect(connector.name).toBe('test-splunk');
    expect(connector.type).toBe('splunk');
    expect(connector.isConnected()).toBe(false);
  });

  it('connect() succeeds when HEC health check returns 200', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ status: 'OK' }));

    const connector = new SplunkConnector(splunkConfig);
    await connector.connect();

    expect(connector.isConnected()).toBe(true);

    // Verify health check endpoint was called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://splunk.example.com:8088/services/collector/health');
    expect(init.method).toBe('GET');
    expect(init.headers).toHaveProperty('Authorization', 'Splunk test-token');
  });

  it('send() sends to correct HEC endpoint with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ text: 'Success', code: 0 }),
    );

    const connector = new SplunkConnector(splunkConfig);
    // Force connected state by directly setting
    (connector as any).connected = true;

    const event = createTestEvent();
    await connector.send([event]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://splunk.example.com:8088/services/collector/event');
    expect(init.headers).toHaveProperty('Authorization', 'Splunk test-token');
  });

  it('send() formats events as newline-delimited JSON with Splunk HEC structure', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ text: 'Success', code: 0 }),
    );

    const connector = new SplunkConnector(splunkConfig);
    (connector as any).connected = true;

    const event = createTestEvent({ id: 'evt-001' });
    await connector.send([event]);

    const [, init] = mockFetch.mock.calls[0];
    const body = init.body as string;
    const parsed = JSON.parse(body);

    // Verify Splunk HEC structure fields
    expect(parsed).toHaveProperty('time');
    expect(parsed.time).toBe(Math.floor(new Date('2024-01-15T12:00:00Z').getTime() / 1000));
    expect(parsed).toHaveProperty('source', 'vorion');
    expect(parsed).toHaveProperty('sourcetype', 'vorion:security');
    expect(parsed).toHaveProperty('index', 'security');
    expect(parsed).toHaveProperty('event');
    expect(parsed.event).toHaveProperty('event_id', 'evt-001');
    expect(parsed.event).toHaveProperty('event_type', 'LOGIN_SUCCESS');
    expect(parsed.event).toHaveProperty('category', 'authentication');
  });

  it('send() returns SendResult with success=true and eventsSent count', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ text: 'Success', code: 0 }),
    );

    const connector = new SplunkConnector(splunkConfig);
    (connector as any).connected = true;

    const events = [createTestEvent(), createTestEvent()];
    const result = await connector.send(events);

    expect(result.success).toBe(true);
    expect(result.eventsSent).toBe(2);
    expect(result.eventsFailed).toBe(0);
    expect(typeof result.durationMs).toBe('number');
  });

  it('send() returns SendResult with success=false on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(503, 'Service Unavailable'));

    const connector = new SplunkConnector(splunkConfig);
    (connector as any).connected = true;

    const events = [createTestEvent({ id: 'fail-evt' })];
    const result = await connector.send(events);

    expect(result.success).toBe(false);
    expect(result.eventsFailed).toBe(1);
    expect(result.failedEventIds).toContain('fail-evt');
  });
});

// =============================================================================
// Elastic Connector Tests
// =============================================================================

describe('ElasticConnector', () => {
  const elasticConfig = {
    type: 'elastic' as const,
    name: 'test-elastic',
    enabled: true,
    nodes: ['https://es.example.com:9200'],
    auth: 'apiKey' as const,
    apiKey: 'test-key',
    index: 'security-%{+yyyy}-%{+MM}',
    maxRetries: 0,
  };

  it('stores config correctly', () => {
    const connector = new ElasticConnector(elasticConfig);

    expect(connector.name).toBe('test-elastic');
    expect(connector.type).toBe('elastic');
    expect(connector.isConnected()).toBe(false);
  });

  it('connect() succeeds when cluster health returns green/yellow', async () => {
    // Health check response
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ cluster_name: 'test', status: 'green', timed_out: false, number_of_nodes: 3 }),
    );
    // ensureIndexTemplate call
    mockFetch.mockResolvedValueOnce(mockOkResponse({ acknowledged: true }));

    const connector = new ElasticConnector(elasticConfig);
    await connector.connect();

    expect(connector.isConnected()).toBe(true);

    // First call is health check
    const [healthUrl, healthInit] = mockFetch.mock.calls[0];
    expect(healthUrl).toBe('https://es.example.com:9200/_cluster/health');
    expect(healthInit.method).toBe('GET');
  });

  it('send() uses bulk API format (NDJSON with action + doc lines)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        took: 5,
        errors: false,
        items: [{ index: { _id: 'evt-1', _index: 'security-2024-01', status: 201 } }],
      }),
    );

    const connector = new ElasticConnector(elasticConfig);
    (connector as any).connected = true;

    const event = createTestEvent({ id: 'evt-1' });
    await connector.send([event]);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/_bulk');

    const body = init.body as string;
    const lines = body.trimEnd().split('\n');
    // NDJSON: action line + document line for each event, plus trailing newline
    expect(lines.length).toBe(2);

    const action = JSON.parse(lines[0]);
    expect(action).toHaveProperty('index');
    expect(action.index).toHaveProperty('_id', 'evt-1');

    const doc = JSON.parse(lines[1]);
    expect(doc).toHaveProperty('@timestamp');
    expect(doc).toHaveProperty('event');
    expect(doc).toHaveProperty('message', 'User authenticated');
  });

  it('send() maps events to ECS format', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        took: 3,
        errors: false,
        items: [{ index: { _id: 'ecs-evt', _index: 'security-2024-01', status: 201 } }],
      }),
    );

    const connector = new ElasticConnector(elasticConfig);
    (connector as any).connected = true;

    const event = createTestEvent({
      id: 'ecs-evt',
      sourceIp: '10.0.0.1',
      sourcePort: 12345,
    });
    await connector.send([event]);

    const body = (mockFetch.mock.calls[0][1].body as string).trimEnd().split('\n');
    const doc = JSON.parse(body[1]);

    // ECS fields
    expect(doc['@timestamp']).toBe('2024-01-15T12:00:00.000Z');
    expect(doc.event.id).toBe('ecs-evt');
    expect(doc.event.kind).toBe('event');
    expect(doc.event.category).toEqual(['authentication']);
    expect(doc.event.type).toEqual(['LOGIN_SUCCESS']);
    expect(doc.event.outcome).toBe('success');
    expect(doc.event.severity).toBe(4);
    expect(doc.source).toEqual(
      expect.objectContaining({ ip: '10.0.0.1', port: 12345 }),
    );
  });

  it('send() resolves date patterns in index name', async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        took: 1,
        errors: false,
        items: [{ index: { _id: 'idx-evt', _index: 'security-2024-01', status: 201 } }],
      }),
    );

    const connector = new ElasticConnector(elasticConfig);
    (connector as any).connected = true;

    // Event timestamp is 2024-01-15 -> security-2024-01
    const event = createTestEvent({ id: 'idx-evt' });
    await connector.send([event]);

    const body = (mockFetch.mock.calls[0][1].body as string).trimEnd().split('\n');
    const action = JSON.parse(body[0]);
    expect(action.index._index).toBe('security-2024-01');
  });

  it('send() includes correct auth header based on config', async () => {
    // Test apiKey auth
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        took: 1,
        errors: false,
        items: [{ index: { _id: 'a1', _index: 'i', status: 201 } }],
      }),
    );

    const connector = new ElasticConnector(elasticConfig);
    (connector as any).connected = true;
    await connector.send([createTestEvent({ id: 'a1' })]);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).toHaveProperty('Authorization', 'ApiKey test-key');

    // Test bearer auth
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        took: 1,
        errors: false,
        items: [{ index: { _id: 'b1', _index: 'i', status: 201 } }],
      }),
    );

    const bearerConnector = new ElasticConnector({
      ...elasticConfig,
      name: 'test-elastic-bearer',
      auth: 'bearer',
      bearerToken: 'my-bearer-token',
    });
    (bearerConnector as any).connected = true;
    await bearerConnector.send([createTestEvent({ id: 'b1' })]);

    const bearerHeaders = mockFetch.mock.calls[0][1].headers;
    expect(bearerHeaders).toHaveProperty('Authorization', 'Bearer my-bearer-token');
  });
});

// =============================================================================
// Datadog Connector Tests
// =============================================================================

describe('DatadogConnector', () => {
  const datadogConfig = {
    type: 'datadog' as const,
    name: 'test-datadog',
    enabled: true,
    site: 'us1' as const,
    apiKey: 'test-key',
    service: 'vorion',
    compress: false,
    maxRetries: 0,
  };

  it('maps site to correct intake URL (us1 -> datadoghq.com)', () => {
    const connector = new DatadogConnector(datadogConfig);

    expect(connector.name).toBe('test-datadog');
    expect(connector.type).toBe('datadog');
    // baseUrl is private, so we verify it via a send call
    expect((connector as any).baseUrl).toBe('https://http-intake.logs.datadoghq.com');
  });

  it('send() sends to /api/v2/logs with DD-API-KEY header', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ status: 'ok' }));

    const connector = new DatadogConnector(datadogConfig);
    (connector as any).connected = true;

    await connector.send([createTestEvent()]);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs');
    expect(init.headers).toHaveProperty('DD-API-KEY', 'test-key');
    expect(init.method).toBe('POST');
  });

  it('send() formats events with ddsource, ddtags, service, message fields', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ status: 'ok' }));

    const connector = new DatadogConnector(datadogConfig);
    (connector as any).connected = true;

    const event = createTestEvent({ id: 'dd-evt' });
    await connector.send([event]);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);

    // The body should be an array of log entries
    expect(Array.isArray(body)).toBe(true);
    const log = body[0];

    expect(log).toHaveProperty('message', 'User authenticated');
    expect(log).toHaveProperty('service', 'vorion');
    expect(log).toHaveProperty('ddsource', 'vorion');
    expect(log).toHaveProperty('ddtags');
    expect(typeof log.ddtags).toBe('string');
  });

  it('send() includes category and severity tags in ddtags', async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ status: 'ok' }));

    const connector = new DatadogConnector(datadogConfig);
    (connector as any).connected = true;

    const event = createTestEvent({
      category: 'authentication',
      severity: 7,
      outcome: 'failure',
      eventType: 'LOGIN_FAILED',
    });
    await connector.send([event]);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const log = body[0];

    const tags = log.ddtags;
    expect(tags).toContain('category:authentication');
    expect(tags).toContain('severity:high');
    expect(tags).toContain('outcome:failure');
    expect(tags).toContain('event_type:LOGIN_FAILED');
  });
});

// =============================================================================
// SIEMService Tests
// =============================================================================

describe('SIEMService', () => {
  function createMockConnector(name = 'mock'): SIEMConnector & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
  } {
    return {
      name,
      type: 'mock',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({
        success: true,
        eventsSent: 1,
        eventsFailed: 0,
        durationMs: 10,
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
      isConnected: vi.fn().mockReturnValue(true),
    };
  }

  it('registerConnector/getConnector/getConnectorNames works', () => {
    const service = createSIEMService({ batchSize: 100, flushIntervalMs: 60000 });
    const mockConn = createMockConnector('alpha');

    service.registerConnector(mockConn);

    expect(service.getConnector('alpha')).toBe(mockConn);
    expect(service.getConnectorNames()).toContain('alpha');

    // Cleanup
    service.shutdown();
  });

  it('send() buffers events until batchSize reached, then flushes', async () => {
    const service = createSIEMService({
      batchSize: 3,
      flushIntervalMs: 600000, // Long interval so timer does not fire
    });
    const mockConn = createMockConnector('buffer-test');
    mockConn.send.mockResolvedValue({
      success: true,
      eventsSent: 3,
      eventsFailed: 0,
      durationMs: 5,
    });

    service.registerConnector(mockConn);

    // Send 2 events -- should not flush yet
    await service.send(createTestEvent());
    await service.send(createTestEvent());
    expect(mockConn.send).not.toHaveBeenCalled();

    // Third event triggers flush
    await service.send(createTestEvent());
    expect(mockConn.send).toHaveBeenCalledTimes(1);
    expect(mockConn.send).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ eventType: 'LOGIN_SUCCESS' }),
    ]));

    await service.shutdown();
  });

  it('flush() sends buffered events to all registered connectors', async () => {
    const service = createSIEMService({
      batchSize: 100, // Large enough to not auto-flush
      flushIntervalMs: 600000,
    });

    const conn1 = createMockConnector('conn-1');
    const conn2 = createMockConnector('conn-2');

    service.registerConnector(conn1);
    service.registerConnector(conn2);

    await service.send(createTestEvent());
    await service.send(createTestEvent());

    // Explicitly flush
    const results = await service.flush();

    expect(conn1.send).toHaveBeenCalledTimes(1);
    expect(conn2.send).toHaveBeenCalledTimes(1);

    // Both connectors should receive the same 2 events
    expect(conn1.send.mock.calls[0][0]).toHaveLength(2);
    expect(conn2.send.mock.calls[0][0]).toHaveLength(2);

    expect(results.has('conn-1')).toBe(true);
    expect(results.has('conn-2')).toBe(true);

    await service.shutdown();
  });

  it('getMetrics() returns correct eventsSent/eventsFailed counts', async () => {
    const service = createSIEMService({
      batchSize: 1,
      flushIntervalMs: 600000,
    });

    const mockConn = createMockConnector('metrics-test');
    mockConn.send.mockResolvedValue({
      success: true,
      eventsSent: 1,
      eventsFailed: 0,
      durationMs: 8,
    });

    service.registerConnector(mockConn);

    await service.send(createTestEvent());

    const metrics = service.getMetrics();
    expect(metrics.eventsSent).toBe(1);
    expect(metrics.eventsFailed).toBe(0);
    expect(metrics.connectorStatus).toHaveProperty('metrics-test');

    await service.shutdown();
  });

  it('createEvent() generates event with UUID and current timestamp', () => {
    const service = createSIEMService({ flushIntervalMs: 600000 });

    const event = service.createEvent({
      eventType: 'ACCESS_DENIED',
      category: 'authorization',
      severity: 7,
      outcome: 'failure',
      message: 'Access denied to resource',
    });

    expect(event.id).toBeDefined();
    expect(typeof event.id).toBe('string');
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.eventType).toBe('ACCESS_DENIED');
    expect(event.category).toBe('authorization');
    expect(event.severity).toBe(7);
    expect(event.outcome).toBe('failure');
    expect(event.message).toBe('Access denied to resource');
    expect(event.source).toBe('vorion');

    service.shutdown();
  });

  it('shutdown() flushes remaining buffer and disconnects', async () => {
    const service = createSIEMService({
      batchSize: 100,
      flushIntervalMs: 600000,
    });

    const mockConn = createMockConnector('shutdown-test');
    service.registerConnector(mockConn);

    // Add events without reaching batch size
    await service.send(createTestEvent());
    await service.send(createTestEvent());

    expect(mockConn.send).not.toHaveBeenCalled();

    await service.shutdown();

    // Shutdown should have flushed the buffer
    expect(mockConn.send).toHaveBeenCalledTimes(1);
    expect(mockConn.send.mock.calls[0][0]).toHaveLength(2);

    // Shutdown should disconnect connectors
    expect(mockConn.disconnect).toHaveBeenCalled();
  });
});
