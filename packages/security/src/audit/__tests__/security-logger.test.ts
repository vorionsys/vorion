/**
 * Tests for SecurityAuditLogger
 *
 * Validates:
 * - Core log() method: event recording, actor enrichment, hash chain, severity filter
 * - Context management: setRequestContext, clearRequestContext, withContext
 * - Authentication helpers: logAuthAttempt (success/failure)
 * - Session helpers: logSessionCreated
 * - MFA helpers: logMfaVerification (success/failure)
 * - Authorization helpers: logAccessDenied
 * - Incident helpers: logBruteForceDetected
 * - Data access helpers: logDataAccess (operation mapping)
 * - Hash chain integrity: sequential events link via previousHash/recordHash
 * - Tenant ID enforcement: throws when no tenantId available
 * - Default metadata merging
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (must precede any imports from the modules under test)
// ---------------------------------------------------------------------------

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../common/trace.js', () => ({
  getTraceContext: () => null,
}));

vi.mock('../../common/random.js', () => ({
  secureRandomString: (n: number) => 'x'.repeat(n),
}));

// Mock the service.ts module to prevent getDatabase() call
const mockAuditService = {
  record: vi.fn().mockResolvedValue({
    id: 'audit-1',
    tenantId: 'tenant-1',
    eventType: 'LOGIN_SUCCESS',
    eventCategory: 'authentication',
    severity: 'info',
    actor: { type: 'user', id: 'user-1' },
    target: { type: 'system', id: 'system-1' },
    action: 'authenticate',
    outcome: 'success',
    sequenceNumber: 1,
    recordHash: 'hash1',
    eventTime: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    archived: false,
    requestId: 'req-1',
  }),
};

vi.mock('../service.js', () => ({
  createAuditService: () => mockAuditService,
  AuditService: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { SecurityAuditLogger } from '../security-logger.js';
import type {
  SecurityActor,
  SecurityResource,
  CreateSecurityEventInput,
} from '../security-events.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const testActor: SecurityActor = {
  type: 'user' as const,
  id: 'user-1',
  name: 'Test User',
  tenantId: 'tenant-1',
};

const testResource: SecurityResource = { type: 'system', id: 'sys-1' };

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SecurityAuditLogger', () => {
  let securityLogger: SecurityAuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    securityLogger = new SecurityAuditLogger(
      {},
      { auditService: mockAuditService as any },
    );
  });

  // =========================================================================
  // Core log() method
  // =========================================================================

  describe('log()', () => {
    it('records a LOGIN_SUCCESS event with correct fields', async () => {
      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      const event = await securityLogger.log(input);

      expect(event.eventType).toBe('LOGIN_SUCCESS');
      expect(event.category).toBe('authentication');
      expect(event.severity).toBe('info');
      expect(event.soc2Control).toBe('CC6.1');
      expect(event.action).toBe('authenticate');
      expect(event.outcome).toBe('success');
      expect(event.actor.id).toBe('user-1');
      expect(event.resource).toEqual(testResource);
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.requestId).toBeDefined();
    });

    it('passes enriched actor to auditService.record', async () => {
      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      await securityLogger.log(input);

      expect(mockAuditService.record).toHaveBeenCalledTimes(1);

      const recordArg = mockAuditService.record.mock.calls[0][0];
      expect(recordArg.tenantId).toBe('tenant-1');
      expect(recordArg.eventType).toBe('LOGIN_SUCCESS');
      expect(recordArg.actor.type).toBe('user');
      expect(recordArg.actor.id).toBe('user-1');
      expect(recordArg.actor.name).toBe('Test User');
      expect(recordArg.action).toBe('authenticate');
      expect(recordArg.outcome).toBe('success');
    });

    it('generates hash chain when enableHashChain=true (default)', async () => {
      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      const event = await securityLogger.log(input);

      expect(event.sequenceNumber).toBe(1);
      expect(event.previousHash).toBeUndefined();
      expect(event.recordHash).toBeDefined();
      expect(typeof event.recordHash).toBe('string');
      expect(event.recordHash!.length).toBeGreaterThan(0);
    });

    it('skips hash chain when enableHashChain=false', async () => {
      const logger = new SecurityAuditLogger(
        { enableHashChain: false },
        { auditService: mockAuditService as any },
      );

      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      const event = await logger.log(input);

      expect(event.sequenceNumber).toBeUndefined();
      expect(event.previousHash).toBeUndefined();
      expect(event.recordHash).toBeUndefined();
    });

    it('respects minSeverity filter (throws for events below minimum)', async () => {
      const logger = new SecurityAuditLogger(
        { minSeverity: 'high' },
        { auditService: mockAuditService as any },
      );

      // LOGIN_SUCCESS has severity 'info', which is below 'high'
      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      await expect(logger.log(input)).rejects.toThrow(
        /severity info below minimum high/,
      );
    });

    it('throws when no tenantId is available', async () => {
      const actorWithoutTenant: SecurityActor = {
        type: 'user',
        id: 'user-1',
        name: 'Test User',
        // no tenantId
      };

      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: actorWithoutTenant,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      await expect(securityLogger.log(input)).rejects.toThrow(
        'Tenant ID is required for security audit logging',
      );
    });

    it('merges defaultMetadata with input metadata', async () => {
      const logger = new SecurityAuditLogger(
        { defaultMetadata: { environment: 'test', version: '1.0' } },
        { auditService: mockAuditService as any },
      );

      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
        metadata: { browser: 'chrome' },
      };

      const event = await logger.log(input);

      // defaultMetadata is merged, with input metadata taking precedence
      expect(event.metadata).toEqual({
        environment: 'test',
        version: '1.0',
        browser: 'chrome',
      });
    });
  });

  // =========================================================================
  // Context management
  // =========================================================================

  describe('setRequestContext / clearRequestContext', () => {
    it('enriches actor with request context fields', async () => {
      securityLogger.setRequestContext({
        ip: '192.168.1.1',
        userAgent: 'TestBrowser/1.0',
        sessionId: 'sess-ctx',
        tenantId: 'tenant-1',
      });

      const actorNoExtras: SecurityActor = {
        type: 'user',
        id: 'user-1',
        tenantId: 'tenant-1',
      };

      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: actorNoExtras,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      const event = await securityLogger.log(input);

      expect(event.actor.ip).toBe('192.168.1.1');
      expect(event.actor.userAgent).toBe('TestBrowser/1.0');
      expect(event.actor.sessionId).toBe('sess-ctx');

      // Clear context and verify it no longer applies
      securityLogger.clearRequestContext();

      const event2 = await securityLogger.log(input);
      expect(event2.actor.ip).toBeUndefined();
      expect(event2.actor.userAgent).toBeUndefined();
      expect(event2.actor.sessionId).toBeUndefined();
    });
  });

  describe('withContext()', () => {
    it('creates a ScopedSecurityLogger that enriches events with context', async () => {
      const scopedLogger = securityLogger.withContext({
        ip: '10.0.0.1',
        userAgent: 'ScopedAgent/2.0',
        sessionId: 'scoped-sess',
        tenantId: 'tenant-1',
      });

      const input: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: { type: 'user', id: 'user-1', tenantId: 'tenant-1' },
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };

      const event = await scopedLogger.log(input);

      expect(event.actor.ip).toBe('10.0.0.1');
      expect(event.actor.userAgent).toBe('ScopedAgent/2.0');
      expect(event.actor.sessionId).toBe('scoped-sess');
    });
  });

  // =========================================================================
  // Authentication helpers
  // =========================================================================

  describe('logAuthAttempt()', () => {
    it('logs LOGIN_SUCCESS when success=true', async () => {
      const event = await securityLogger.logAuthAttempt(
        testActor,
        true,
        testResource,
      );

      expect(event.eventType).toBe('LOGIN_SUCCESS');
      expect(event.outcome).toBe('success');
      expect(event.action).toBe('authenticate');
    });

    it('logs LOGIN_FAILURE when success=false with reason', async () => {
      const event = await securityLogger.logAuthAttempt(
        testActor,
        false,
        testResource,
        {},
        'bad password',
      );

      expect(event.eventType).toBe('LOGIN_FAILURE');
      expect(event.outcome).toBe('failure');
      expect(event.reason).toBe('bad password');
    });
  });

  // =========================================================================
  // Session helpers
  // =========================================================================

  describe('logSessionCreated()', () => {
    it('logs SESSION_CREATED event with session resource', async () => {
      const event = await securityLogger.logSessionCreated(
        testActor,
        'sess-1',
      );

      expect(event.eventType).toBe('SESSION_CREATED');
      expect(event.action).toBe('create_session');
      expect(event.resource).toEqual({ type: 'session', id: 'sess-1' });
      expect(event.outcome).toBe('success');
    });
  });

  // =========================================================================
  // MFA helpers
  // =========================================================================

  describe('logMfaVerification()', () => {
    it('logs MFA_VERIFICATION_SUCCESS when success=true', async () => {
      const event = await securityLogger.logMfaVerification(
        testActor,
        'user-1',
        true,
        'totp',
      );

      expect(event.eventType).toBe('MFA_VERIFICATION_SUCCESS');
      expect(event.outcome).toBe('success');
      expect(event.metadata).toMatchObject({ method: 'totp' });
    });

    it('logs MFA_VERIFICATION_FAILED when success=false with attemptsRemaining', async () => {
      const event = await securityLogger.logMfaVerification(
        testActor,
        'user-1',
        false,
        'totp',
        2,
      );

      expect(event.eventType).toBe('MFA_VERIFICATION_FAILED');
      expect(event.outcome).toBe('failure');
      expect(event.metadata).toMatchObject({ method: 'totp', attemptsRemaining: 2 });
    });
  });

  // =========================================================================
  // Authorization helpers
  // =========================================================================

  describe('logAccessDenied()', () => {
    it('logs ACCESS_DENIED with outcome=blocked', async () => {
      const event = await securityLogger.logAccessDenied(
        testActor,
        testResource,
        'no permission',
      );

      expect(event.eventType).toBe('ACCESS_DENIED');
      expect(event.outcome).toBe('blocked');
      expect(event.reason).toBe('no permission');
      expect(event.action).toBe('access');
    });
  });

  // =========================================================================
  // Incident helpers
  // =========================================================================

  describe('logBruteForceDetected()', () => {
    it('logs BRUTE_FORCE_DETECTED with attemptCount in metadata', async () => {
      const event = await securityLogger.logBruteForceDetected(
        testActor,
        testResource,
        10,
      );

      expect(event.eventType).toBe('BRUTE_FORCE_DETECTED');
      expect(event.outcome).toBe('blocked');
      expect(event.metadata).toMatchObject({ attemptCount: 10 });
    });
  });

  // =========================================================================
  // Data access helpers
  // =========================================================================

  describe('logDataAccess()', () => {
    it('maps "read" operation to DATA_READ event type', async () => {
      const event = await securityLogger.logDataAccess(
        testActor,
        testResource,
        'read',
      );

      expect(event.eventType).toBe('DATA_READ');
      expect(event.action).toBe('read');
      expect(event.outcome).toBe('success');
    });
  });

  // =========================================================================
  // Hash chain integrity across sequential events
  // =========================================================================

  describe('hash chain', () => {
    it('two sequential logs have linked hashes', async () => {
      const input1: CreateSecurityEventInput = {
        eventType: 'LOGIN_SUCCESS',
        actor: testActor,
        action: 'authenticate',
        resource: testResource,
        outcome: 'success',
      };
      const input2: CreateSecurityEventInput = {
        eventType: 'SESSION_CREATED',
        actor: testActor,
        action: 'create_session',
        resource: { type: 'session', id: 'sess-1' },
        outcome: 'success',
      };

      const event1 = await securityLogger.log(input1);
      const event2 = await securityLogger.log(input2);

      // First event has no previous hash; second links to first
      expect(event1.sequenceNumber).toBe(1);
      expect(event1.previousHash).toBeUndefined();
      expect(event1.recordHash).toBeDefined();

      expect(event2.sequenceNumber).toBe(2);
      expect(event2.previousHash).toBe(event1.recordHash);
      expect(event2.recordHash).toBeDefined();
      expect(event2.recordHash).not.toBe(event1.recordHash);
    });
  });
});
