/**
 * Tests for ComplianceReporter
 *
 * Validates compliance report generation, SOC 2 control coverage,
 * export formats, and summary report logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../common/trace.js', () => ({
  getTraceContext: () => null,
}));
vi.mock('../../common/random.js', () => ({
  secureRandomString: (n: number) => 'x'.repeat(n),
}));
vi.mock('../../common/db.js', () => ({
  getDatabase: () => ({}),
}));

const mockAuditService = {
  query: vi.fn(),
  record: vi.fn(),
};

// Mock the service.js module
vi.mock('../service.js', () => ({
  createAuditService: () => mockAuditService,
  AuditService: vi.fn(),
}));

import { ComplianceReporter, SOC2_CONTROLS } from '../compliance-reporter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRecord(overrides: Partial<any> = {}): any {
  return {
    id: crypto.randomUUID(),
    tenantId: 'tenant-1',
    eventType: 'LOGIN_SUCCESS',
    eventCategory: 'authentication',
    severity: 'info',
    actor: { type: 'user', id: 'user-1', name: 'Test' },
    target: { type: 'system', id: 'sys-1' },
    action: 'authenticate',
    outcome: 'success',
    requestId: 'req-1',
    sequenceNumber: 1,
    recordHash: 'hash1',
    eventTime: '2024-01-15T12:00:00Z',
    recordedAt: '2024-01-15T12:00:00Z',
    archived: false,
    ...overrides,
  };
}

const DEFAULT_FILTERS = {
  tenantId: 'tenant-1',
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-31T23:59:59Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComplianceReporter', () => {
  let reporter: ComplianceReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    reporter = new ComplianceReporter(mockAuditService as any);
  });

  // -------------------------------------------------------------------------
  // generateReport – metadata
  // -------------------------------------------------------------------------

  describe('generateReport', () => {
    it('returns report with correct metadata (id, generatedAt, version, filters, generator)', async () => {
      const records = [createMockRecord()];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);

      expect(report.metadata).toBeDefined();
      expect(report.metadata.id).toBeDefined();
      expect(typeof report.metadata.id).toBe('string');
      expect(report.metadata.generatedAt).toBeDefined();
      expect(report.metadata.version).toBe('1.0.0');
      expect(report.metadata.filters).toEqual(DEFAULT_FILTERS);
      expect(report.metadata.generator).toBe('vorion-compliance-reporter');
    });

    // -----------------------------------------------------------------------
    // generateReport – summary
    // -----------------------------------------------------------------------

    it('builds correct summary (totalEvents, byCategory, bySeverity, byOutcome, uniqueActors)', async () => {
      const records = [
        createMockRecord({ eventType: 'LOGIN_SUCCESS', eventCategory: 'authentication', severity: 'info', outcome: 'success', actor: { type: 'user', id: 'user-1', name: 'A' } }),
        createMockRecord({ eventType: 'LOGIN_FAILURE', eventCategory: 'authentication', severity: 'warning', outcome: 'failure', actor: { type: 'user', id: 'user-2', name: 'B' } }),
        createMockRecord({ eventType: 'ACCESS_GRANTED', eventCategory: 'authorization', severity: 'info', outcome: 'success', actor: { type: 'user', id: 'user-1', name: 'A' } }),
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 3, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);

      expect(report.summary.totalEvents).toBe(3);
      expect(report.summary.byCategory).toEqual({ authentication: 2, authorization: 1 });
      expect(report.summary.bySeverity).toEqual({ info: 2, warning: 1 });
      expect(report.summary.byOutcome).toEqual({ success: 2, failure: 1 });
      expect(report.summary.uniqueActors).toBe(2);
    });

    // -----------------------------------------------------------------------
    // generateReport – includeEvents
    // -----------------------------------------------------------------------

    it('includes events array when includeEvents is true', async () => {
      const records = [createMockRecord()];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS, { includeEvents: true });

      expect(report.events).toBeDefined();
      expect(Array.isArray(report.events)).toBe(true);
      expect(report.events!.length).toBe(1);
      expect(report.events![0].eventType).toBe('LOGIN_SUCCESS');
    });

    it('omits events array when includeEvents is false', async () => {
      const records = [createMockRecord()];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS, { includeEvents: false });

      expect(report.events).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // generateReport – SOC 2 coverage
    // -----------------------------------------------------------------------

    it('includes SOC 2 coverage by default', async () => {
      const records = [createMockRecord({ eventType: 'LOGIN_SUCCESS' })];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);

      expect(report.soc2Coverage).toBeDefined();
      expect(Array.isArray(report.soc2Coverage)).toBe(true);
      expect(report.soc2Coverage.length).toBe(Object.keys(SOC2_CONTROLS).length);
    });

    // -----------------------------------------------------------------------
    // generateReport – eventTypes filter
    // -----------------------------------------------------------------------

    it('filters by eventTypes correctly', async () => {
      const records = [
        createMockRecord({ eventType: 'LOGIN_SUCCESS' }),
        createMockRecord({ eventType: 'ACCESS_GRANTED' }),
        createMockRecord({ eventType: 'DATA_READ' }),
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 3, hasMore: false });

      const report = await reporter.generateReport({
        ...DEFAULT_FILTERS,
        eventTypes: ['LOGIN_SUCCESS', 'DATA_READ'],
      });

      // The in-memory filter should keep only LOGIN_SUCCESS and DATA_READ
      expect(report.summary.totalEvents).toBe(2);
    });

    // -----------------------------------------------------------------------
    // generateReport – SOC 2 coverage percentages
    // -----------------------------------------------------------------------

    it('calculates SOC 2 control coverage percentages correctly (missing event types reduce coverage)', async () => {
      // CC7.3 has 3 event types: INCIDENT_CREATED, INCIDENT_UPDATED, INCIDENT_RESOLVED
      // Provide only 1 of 3 => coverage = round(1/3 * 100) = 33%
      const records = [
        createMockRecord({ eventType: 'INCIDENT_CREATED' }),
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);

      const cc73 = report.soc2Coverage.find((c) => c.control.id === 'CC7.3');
      expect(cc73).toBeDefined();
      expect(cc73!.assessment.coveragePercent).toBe(33);
      expect(cc73!.assessment.missingEventTypes).toContain('INCIDENT_UPDATED');
      expect(cc73!.assessment.missingEventTypes).toContain('INCIDENT_RESOLVED');
      expect(cc73!.assessment.adequateCoverage).toBe(false);
    });

    // -----------------------------------------------------------------------
    // generateReport – recommendations for low coverage
    // -----------------------------------------------------------------------

    it('generates recommendations for low coverage controls', async () => {
      // Provide no events at all — every control should recommend enabling logging
      mockAuditService.query.mockResolvedValue({ records: [], total: 0, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);

      for (const coverage of report.soc2Coverage) {
        expect(coverage.assessment.recommendations.length).toBeGreaterThan(0);
        // With 0 events, both "Enable logging for:" and "No events logged" should appear
        const hasLoggingRec = coverage.assessment.recommendations.some(
          (r) => r.includes('Enable logging for:') || r.includes('No events logged'),
        );
        expect(hasLoggingRec).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // exportReport
  // -------------------------------------------------------------------------

  describe('exportReport', () => {
    it('JSON format returns valid JSON string', async () => {
      const records = [createMockRecord()];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);
      const exported = await reporter.exportReport(report, 'json');

      const parsed = JSON.parse(exported);
      expect(parsed.metadata.version).toBe('1.0.0');
      expect(parsed.summary.totalEvents).toBe(1);
    });

    it('CSV format includes header sections (# Summary, # Events by Category, etc.)', async () => {
      const records = [createMockRecord()];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const report = await reporter.generateReport(DEFAULT_FILTERS);
      const csv = await reporter.exportReport(report, 'csv');

      expect(csv).toContain('# Compliance Report');
      expect(csv).toContain('# Summary');
      expect(csv).toContain('# Events by Category');
      expect(csv).toContain('# Events by Severity');
      expect(csv).toContain('# Events by Outcome');
      expect(csv).toContain('# SOC 2 Control Coverage');
    });
  });

  // -------------------------------------------------------------------------
  // generateSoc2ControlReport
  // -------------------------------------------------------------------------

  describe('generateSoc2ControlReport', () => {
    it('throws for unknown control ID', async () => {
      await expect(
        reporter.generateSoc2ControlReport('CC99.9', DEFAULT_FILTERS),
      ).rejects.toThrow('Unknown SOC 2 control: CC99.9');
    });

    it('CC6.1 generates report filtered to CC6.1 event types', async () => {
      const cc61EventTypes = SOC2_CONTROLS['CC6.1'].eventTypes;
      const records = [
        createMockRecord({ eventType: 'LOGIN_SUCCESS' }),
        createMockRecord({ eventType: 'TOKEN_ISSUED' }),
        createMockRecord({ eventType: 'DATA_READ' }), // Not a CC6.1 event type
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 3, hasMore: false });

      const report = await reporter.generateSoc2ControlReport('CC6.1', DEFAULT_FILTERS);

      // DATA_READ is not in CC6.1 eventTypes, so should be filtered out
      expect(report.summary.totalEvents).toBe(2);

      // Verify the query was called with the correct filters
      expect(report.metadata.filters.soc2Controls).toEqual(['CC6.1']);
      expect(report.metadata.filters.eventTypes).toEqual(cc61EventTypes);
    });
  });

  // -------------------------------------------------------------------------
  // generateSoc2SummaryReport
  // -------------------------------------------------------------------------

  describe('generateSoc2SummaryReport', () => {
    it('returns all 6 SOC 2 controls', async () => {
      mockAuditService.query.mockResolvedValue({ records: [], total: 0, hasMore: false });

      const summary = await reporter.generateSoc2SummaryReport(
        'tenant-1',
        '2024-01-01T00:00:00Z',
        '2024-01-31T23:59:59Z',
      );

      expect(summary.controls.length).toBe(6);
      const controlIds = summary.controls.map((c) => c.control.id);
      expect(controlIds).toContain('CC6.1');
      expect(controlIds).toContain('CC6.2');
      expect(controlIds).toContain('CC6.5');
      expect(controlIds).toContain('CC7.2');
      expect(controlIds).toContain('CC7.3');
      expect(controlIds).toContain('CC8.1');
    });

    it('status is compliant when coverage >= 80% and failure rate < 10%', async () => {
      // CC7.3 has 3 event types: INCIDENT_CREATED, INCIDENT_UPDATED, INCIDENT_RESOLVED
      // Provide all 3 types with success outcomes => coverage 100%, failure rate 0%
      const records = [
        createMockRecord({ eventType: 'INCIDENT_CREATED', outcome: 'success' }),
        createMockRecord({ eventType: 'INCIDENT_UPDATED', outcome: 'success' }),
        createMockRecord({ eventType: 'INCIDENT_RESOLVED', outcome: 'success' }),
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 3, hasMore: false });

      const summary = await reporter.generateSoc2SummaryReport(
        'tenant-1',
        '2024-01-01T00:00:00Z',
        '2024-01-31T23:59:59Z',
      );

      const cc73 = summary.controls.find((c) => c.control.id === 'CC7.3');
      expect(cc73).toBeDefined();
      expect(cc73!.coveragePercent).toBe(100);
      expect(cc73!.status).toBe('compliant');
    });

    it('status is non_compliant when coverage < 50%', async () => {
      // CC7.3 has 3 event types. Provide only 1 => coverage = 33% which is < 50%
      const records = [
        createMockRecord({ eventType: 'INCIDENT_CREATED', outcome: 'success' }),
      ];
      mockAuditService.query.mockResolvedValue({ records, total: 1, hasMore: false });

      const summary = await reporter.generateSoc2SummaryReport(
        'tenant-1',
        '2024-01-01T00:00:00Z',
        '2024-01-31T23:59:59Z',
      );

      const cc73 = summary.controls.find((c) => c.control.id === 'CC7.3');
      expect(cc73).toBeDefined();
      expect(cc73!.coveragePercent).toBe(33);
      expect(cc73!.status).toBe('non_compliant');

      // Overall status should also be non_compliant because at least one control is
      expect(summary.overallStatus).toBe('non_compliant');

      // Should include recommendations for the non-compliant control
      const cc73Recs = summary.recommendations.filter((r) => r.startsWith('CC7.3'));
      expect(cc73Recs.length).toBeGreaterThan(0);
    });
  });
});
