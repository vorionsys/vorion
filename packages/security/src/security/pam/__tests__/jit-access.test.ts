/**
 * Tests for JITAccessService - Privileged Access Management
 *
 * Covers the full elevation lifecycle: request, approve, deny, revoke,
 * check, and cleanup. Uses mocked Redis, SecurityAuditLogger, and
 * AlertService dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – declared before the module-level vi.mock() calls so the factory
// closures can reference them (vitest hoists vi.mock to the top of the file).
// ---------------------------------------------------------------------------

const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  srem: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockResolvedValue([]),
  zadd: vi.fn().mockResolvedValue(1),
};

const mockSecurityLogger = {
  log: vi.fn().mockResolvedValue(undefined),
  logSessionRevoked: vi.fn().mockResolvedValue(undefined),
  logAccessDenied: vi.fn().mockResolvedValue(undefined),
  logAccessGranted: vi.fn().mockResolvedValue(undefined),
};

const mockAlertService = {
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-1' }),
};

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../common/redis.js', () => ({
  getRedis: () => mockRedis,
}));

vi.mock('../../audit/security-logger.js', () => ({
  SecurityAuditLogger: vi.fn(),
  getSecurityAuditLogger: () => mockSecurityLogger,
}));

vi.mock('../alerting/service.js', () => ({
  SecurityAlertService: vi.fn(),
  getSecurityAlertService: () => mockAlertService,
}));

vi.mock('../alerting/types.js', () => ({
  AlertSeverity: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  },
  SecurityEventType: {
    PRIVILEGE_ESCALATION: 'privilege_escalation',
    ADMIN_ACTION: 'admin_action',
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test *after* mocks are registered
// ---------------------------------------------------------------------------

import {
  JITAccessService,
  ElevationError,
  ElevationRequestSchema,
  ElevationTicketSchema,
  ElevatedSessionSchema,
} from '../jit-access.js';

import type { ElevationTicket, ElevatedSession } from '../jit-access.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid elevation request for reuse across tests. */
function validRequest() {
  return {
    userId: 'user-1',
    resource: 'production-db',
    permissions: ['read', 'write'],
    reason: 'Deploy hotfix for critical production issue',
    durationMinutes: 60,
    urgency: 'high' as const,
  };
}

/**
 * Helper: create a service instance, request elevation, and return both.
 * Configures the Redis mock so `getTicket` returns the created ticket when
 * called by approval / denial flows.
 */
async function createServiceAndTicket(
  overrides?: {
    defaultApprovalCount?: number;
    getApprovers?: (req: unknown) => Promise<{ approvers: string[]; requiredCount: number }>;
  },
) {
  const service = new JITAccessService(
    {
      enableEscalation: false,
      defaultApprovalCount: overrides?.defaultApprovalCount ?? 1,
      getApprovers: overrides?.getApprovers,
    },
    {
      redis: mockRedis as never,
      securityLogger: mockSecurityLogger as never,
      alertService: mockAlertService as never,
    },
  );

  const ticket = await service.requestElevation(validRequest());

  // Make the ticket retrievable from Redis for subsequent operations.
  mockRedis.get.mockImplementation(async (key: string) => {
    if (key.includes(ticket.id)) {
      return JSON.stringify(ticket);
    }
    return null;
  });

  return { service, ticket };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JITAccessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  // =========================================================================
  // requestElevation
  // =========================================================================

  describe('requestElevation', () => {
    it('creates a ticket with pending status and stores it in Redis', async () => {
      const service = new JITAccessService(
        { enableEscalation: false },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      const ticket = await service.requestElevation(validRequest());

      // Ticket shape
      expect(ticket.status).toBe('pending');
      expect(ticket.request.userId).toBe('user-1');
      expect(ticket.request.resource).toBe('production-db');
      expect(ticket.request.permissions).toEqual(['read', 'write']);
      expect(ticket.currentApprovals).toEqual([]);
      expect(ticket.id).toBeDefined();
      expect(ticket.createdAt).toBeDefined();
      expect(ticket.expiresAt).toBeDefined();

      // Validates against the Zod schema
      expect(() => ElevationTicketSchema.parse(ticket)).not.toThrow();

      // Redis interactions: ticket stored + user-tickets set updated
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `vorion:pam:user:tickets:user-1`,
        ticket.id,
      );

      // Audit + alert
      expect(mockSecurityLogger.log).toHaveBeenCalled();
      expect(mockAlertService.createAlert).toHaveBeenCalled();

      await service.stop();
    });

    it('rejects a request when the reason is too short', async () => {
      const service = new JITAccessService(
        { enableEscalation: false },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      const badRequest = { ...validRequest(), reason: 'short' };

      await expect(service.requestElevation(badRequest)).rejects.toThrow();

      // Also verify via schema directly
      const result = ElevationRequestSchema.safeParse(badRequest);
      expect(result.success).toBe(false);

      await service.stop();
    });

    it('uses a custom getApprovers callback when provided', async () => {
      const customGetApprovers = vi.fn().mockResolvedValue({
        approvers: ['mgr-1', 'mgr-2'],
        requiredCount: 2,
      });

      const service = new JITAccessService(
        { enableEscalation: false, getApprovers: customGetApprovers },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      const ticket = await service.requestElevation(validRequest());

      expect(customGetApprovers).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(ticket.requiredApprovers).toEqual(['mgr-1', 'mgr-2']);
      expect(ticket.requiredApprovalCount).toBe(2);

      await service.stop();
    });
  });

  // =========================================================================
  // approveElevation
  // =========================================================================

  describe('approveElevation', () => {
    it('creates an elevated session when a single approver approves', async () => {
      const { service, ticket } = await createServiceAndTicket();

      const session = await service.approveElevation(
        ticket.id,
        'admin',
        'Looks good',
      );

      // Session shape
      expect(session.ticketId).toBe(ticket.id);
      expect(session.userId).toBe('user-1');
      expect(session.resource).toBe('production-db');
      expect(session.grantedPermissions).toEqual(['read', 'write']);
      expect(session.revokedAt).toBeUndefined();
      expect(() => ElevatedSessionSchema.parse(session)).not.toThrow();

      // Redis: session stored + added to user-sessions and resource-sessions sets
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `vorion:pam:user:sessions:user-1`,
        session.id,
      );

      await service.stop();
    });

    it('throws TICKET_NOT_FOUND when ticket does not exist', async () => {
      const service = new JITAccessService(
        { enableEscalation: false },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      // mockRedis.get already returns null by default
      await expect(
        service.approveElevation('nonexistent-id', 'admin'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'TICKET_NOT_FOUND' }),
      );

      await service.stop();
    });

    it('throws UNAUTHORIZED_APPROVER when approver is not in the required list', async () => {
      const { service, ticket } = await createServiceAndTicket();

      await expect(
        service.approveElevation(ticket.id, 'random-user'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED_APPROVER' }),
      );

      await service.stop();
    });

    it('throws ALREADY_APPROVED when the same approver tries twice', async () => {
      const { service, ticket } = await createServiceAndTicket({
        defaultApprovalCount: 1,
        getApprovers: async () => ({
          approvers: ['mgr-1', 'mgr-2'],
          requiredCount: 2,
        }),
      });

      // First approval by mgr-1 – not enough yet (requires 2), throws PENDING_APPROVALS
      // We need to update the stored ticket to reflect the first approval.
      try {
        await service.approveElevation(ticket.id, 'mgr-1', 'ok');
      } catch (err) {
        expect((err as ElevationError).code).toBe('PENDING_APPROVALS');
      }

      // Update the mock so Redis returns the ticket with the first approval included.
      const updatedTicket: ElevationTicket = {
        ...ticket,
        currentApprovals: [
          {
            approverId: 'mgr-1',
            approvedAt: new Date().toISOString(),
            comment: 'ok',
          },
        ],
      };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(ticket.id)) return JSON.stringify(updatedTicket);
        return null;
      });

      // Second approval by the same approver should throw ALREADY_APPROVED
      await expect(
        service.approveElevation(ticket.id, 'mgr-1'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'ALREADY_APPROVED' }),
      );

      await service.stop();
    });

    it('throws PENDING_APPROVALS when first approver of multi-approver ticket approves', async () => {
      const { service, ticket } = await createServiceAndTicket({
        getApprovers: async () => ({
          approvers: ['mgr-1', 'mgr-2'],
          requiredCount: 2,
        }),
      });

      await expect(
        service.approveElevation(ticket.id, 'mgr-1', 'partial ok'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'PENDING_APPROVALS' }),
      );

      await service.stop();
    });
  });

  // =========================================================================
  // denyElevation
  // =========================================================================

  describe('denyElevation', () => {
    it('sets the ticket status to denied', async () => {
      const { service, ticket } = await createServiceAndTicket();

      await service.denyElevation(ticket.id, 'admin', 'Not justified');

      // The ticket is re-stored via setex – capture the stored JSON.
      const storedCalls = mockRedis.setex.mock.calls.filter(
        (c: string[]) => typeof c[0] === 'string' && c[0].includes(ticket.id),
      );
      // The last call for this ticket should contain status: 'denied'
      const lastStored = JSON.parse(storedCalls[storedCalls.length - 1][2]);
      expect(lastStored.status).toBe('denied');
      expect(lastStored.deniedBy).toBe('admin');
      expect(lastStored.denialReason).toBe('Not justified');

      // Audit was recorded
      expect(mockSecurityLogger.log).toHaveBeenCalled();

      await service.stop();
    });

    it('throws INVALID_TICKET_STATUS when denying a non-pending ticket', async () => {
      const { service, ticket } = await createServiceAndTicket();

      // Simulate the ticket already being approved in Redis.
      const approvedTicket: ElevationTicket = { ...ticket, status: 'approved' };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(ticket.id)) return JSON.stringify(approvedTicket);
        return null;
      });

      await expect(
        service.denyElevation(ticket.id, 'admin', 'too late'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_TICKET_STATUS' }),
      );

      await service.stop();
    });
  });

  // =========================================================================
  // revokeElevation
  // =========================================================================

  describe('revokeElevation', () => {
    it('revokes an active session', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      // Make the session retrievable
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(session);
        if (key.includes(ticket.id)) {
          return JSON.stringify({ ...ticket, status: 'approved' });
        }
        return null;
      });

      await service.revokeElevation(session.id, 'Security concern', 'sec-admin');

      // Session was re-stored with revocation data
      const sessionStoredCalls = mockRedis.setex.mock.calls.filter(
        (c: string[]) => typeof c[0] === 'string' && c[0].includes(session.id),
      );
      const lastStored = JSON.parse(
        sessionStoredCalls[sessionStoredCalls.length - 1][2],
      );
      expect(lastStored.revokedAt).toBeDefined();
      expect(lastStored.revokedBy).toBe('sec-admin');
      expect(lastStored.revocationReason).toBe('Security concern');

      // Indexes cleaned
      expect(mockRedis.srem).toHaveBeenCalledWith(
        `vorion:pam:user:sessions:user-1`,
        session.id,
      );

      // Audit + alert
      expect(mockSecurityLogger.logSessionRevoked).toHaveBeenCalled();
      expect(mockAlertService.createAlert).toHaveBeenCalled();

      await service.stop();
    });

    it('throws SESSION_ALREADY_REVOKED when revoking an already-revoked session', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      const revokedSession: ElevatedSession = {
        ...session,
        revokedAt: new Date().toISOString(),
        revokedBy: 'sec-admin',
        revocationReason: 'first revocation',
      };

      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(revokedSession);
        return null;
      });

      await expect(
        service.revokeElevation(session.id, 'duplicate'),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'SESSION_ALREADY_REVOKED' }),
      );

      await service.stop();
    });
  });

  // =========================================================================
  // checkElevation
  // =========================================================================

  describe('checkElevation', () => {
    it('returns true for a user with an active matching session', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      // Wire up smembers to return the session ID, and get to return the session
      mockRedis.smembers.mockResolvedValue([session.id]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(session);
        return null;
      });

      const result = await service.checkElevation('user-1', 'production-db', 'read');

      expect(result).toBe(true);

      await service.stop();
    });

    it('returns false for an expired session', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      // Simulate an expired session
      const expiredSession: ElevatedSession = {
        ...session,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      };

      mockRedis.smembers.mockResolvedValue([session.id]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(expiredSession);
        return null;
      });

      const result = await service.checkElevation('user-1', 'production-db', 'read');

      expect(result).toBe(false);

      await service.stop();
    });

    it('returns false for a revoked session', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      const revokedSession: ElevatedSession = {
        ...session,
        revokedAt: new Date().toISOString(),
        revokedBy: 'sec-admin',
        revocationReason: 'revoked',
      };

      mockRedis.smembers.mockResolvedValue([session.id]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(revokedSession);
        return null;
      });

      const result = await service.checkElevation('user-1', 'production-db', 'read');

      expect(result).toBe(false);

      await service.stop();
    });

    it('returns false when permission does not match', async () => {
      const { service, ticket } = await createServiceAndTicket();
      const session = await service.approveElevation(ticket.id, 'admin');

      mockRedis.smembers.mockResolvedValue([session.id]);
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(session.id)) return JSON.stringify(session);
        return null;
      });

      const result = await service.checkElevation('user-1', 'production-db', 'delete');

      expect(result).toBe(false);

      await service.stop();
    });
  });

  // =========================================================================
  // ElevationError
  // =========================================================================

  describe('ElevationError', () => {
    it('carries the correct code, message, and name', () => {
      const err = new ElevationError('TICKET_NOT_FOUND', 'Ticket abc not found');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ElevationError);
      expect(err.code).toBe('TICKET_NOT_FOUND');
      expect(err.message).toBe('Ticket abc not found');
      expect(err.name).toBe('ElevationError');
    });

    it('supports all documented error codes', () => {
      const codes = [
        'TICKET_NOT_FOUND',
        'SESSION_NOT_FOUND',
        'INVALID_TICKET_STATUS',
        'UNAUTHORIZED_APPROVER',
        'ALREADY_APPROVED',
        'SESSION_ALREADY_REVOKED',
        'PENDING_APPROVALS',
        'VALIDATION_ERROR',
      ] as const;

      for (const code of codes) {
        const err = new ElevationError(code, `test ${code}`);
        expect(err.code).toBe(code);
      }
    });
  });

  // =========================================================================
  // stop (cleanup)
  // =========================================================================

  describe('stop', () => {
    it('clears the escalation interval and session timers', async () => {
      const service = new JITAccessService(
        { enableEscalation: true, escalationCheckIntervalMs: 60_000 },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      // Create a ticket and approve it so there is a session expiration timer
      const ticket = await service.requestElevation(validRequest());
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(ticket.id)) return JSON.stringify(ticket);
        return null;
      });
      const session = await service.approveElevation(ticket.id, 'admin');

      // Spy on clearInterval / clearTimeout
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await service.stop();

      // The escalation interval should have been cleared
      expect(clearIntervalSpy).toHaveBeenCalled();
      // The session expiration timer should have been cleared
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('is safe to call multiple times', async () => {
      const service = new JITAccessService(
        { enableEscalation: false },
        {
          redis: mockRedis as never,
          securityLogger: mockSecurityLogger as never,
          alertService: mockAlertService as never,
        },
      );

      await service.stop();
      await service.stop(); // should not throw

      await service.stop();
    });
  });
});
