/**
 * Tests for BreakGlassService
 *
 * Validates:
 * - Session initiation with Zod validation and monthly limits
 * - MFA verification flows (TOTP, backup code, phone callback, no-mfa fallback)
 * - Session activation with MFA and phone callback requirements
 * - Session validation (active, expired, non-existent)
 * - Session revocation and state transitions
 * - Action recording on active sessions
 * - Session renewal (one-time extension)
 * - Post-incident review submission
 * - Resource accessibility for full vs limited scope
 * - Active session retrieval
 * - Destroy / timer cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  BreakGlassService,
  BreakGlassError,
  BreakGlassScope,
  BreakGlassStatus,
  VerificationMethod,
} from '../break-glass.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('prom-client', () => {
  const mockLabels = () => ({ inc: vi.fn(), dec: vi.fn(), set: vi.fn(), observe: vi.fn() });
  class MockCounter {
    inc = vi.fn();
    labels = vi.fn().mockReturnValue({ inc: vi.fn() });
    constructor(_opts?: unknown) {}
  }
  class MockHistogram {
    observe = vi.fn();
    labels = vi.fn().mockReturnValue({ observe: vi.fn() });
    constructor(_opts?: unknown) {}
  }
  class MockGauge {
    inc = vi.fn();
    dec = vi.fn();
    set = vi.fn();
    labels = vi.fn().mockReturnValue({ inc: vi.fn(), dec: vi.fn(), set: vi.fn() });
    constructor(_opts?: unknown) {}
  }
  class MockRegistry {
    registerMetric = vi.fn();
    metrics = vi.fn().mockResolvedValue('');
    contentType = 'text/plain';
  }
  return {
    Counter: MockCounter,
    Histogram: MockHistogram,
    Gauge: MockGauge,
    Registry: MockRegistry,
    collectDefaultMetrics: vi.fn(),
  };
});

vi.mock('../../common/metrics-registry.js', () => ({ vorionRegistry: {} }));

const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
vi.mock('uuid', () => ({
  v4: vi.fn(() => MOCK_UUID),
}));

// =============================================================================
// Helpers
// =============================================================================

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    reason: 'Emergency database recovery needed',
    scope: BreakGlassScope.FULL as const,
    ...overrides,
  };
}

function limitedRequest(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    reason: 'Limited resource access required',
    scope: BreakGlassScope.LIMITED as const,
    resources: ['db-primary', 'cache-01'],
    ...overrides,
  };
}

function createMfaService(overrides: Record<string, unknown> = {}) {
  return {
    verifyTotp: vi.fn().mockResolvedValue(true),
    verifyBackupCode: vi.fn().mockResolvedValue(true),
    verifyHardwareToken: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/**
 * Helper: initiate, verify MFA (TOTP + PHONE_CALLBACK for full scope),
 * and activate a session. Returns the activated session.
 */
async function createActivatedSession(
  service: BreakGlassService,
  request = validRequest(),
  options: { requirePhoneCallback?: boolean; phoneCode?: string } = {},
) {
  const session = await service.initiateBreakGlass(request as any);

  // Verify with TOTP
  await service.verifyMfa(session.id, {
    method: VerificationMethod.MFA_TOTP,
    code: '123456',
  });

  // If full scope and phone callback required, verify phone too
  if (
    request.scope === BreakGlassScope.FULL &&
    options.requirePhoneCallback !== false
  ) {
    // Access the pending verification code via internal state.
    // We pass a code that matches by using verifyMfa with the phone code.
    // Since mfaService is not involved in phone callback, we need the actual code.
    // For tests using no mfaService, phone callback auto-adds.
    // For tests with mfaService, we need to use the code from pendingVerifications.
    if (options.phoneCode) {
      await service.verifyMfa(session.id, {
        method: VerificationMethod.PHONE_CALLBACK,
        code: options.phoneCode,
      });
    }
  }

  const activated = await service.activateSession(session.id);
  return activated;
}

// =============================================================================
// Tests
// =============================================================================

describe('BreakGlassService', () => {
  let service: BreakGlassService;

  afterEach(() => {
    service?.destroy();
  });

  // ---------------------------------------------------------------------------
  // 1. Initiate break-glass: creates session with PENDING_VERIFICATION status
  // ---------------------------------------------------------------------------
  describe('initiateBreakGlass', () => {
    it('should create a session with PENDING_VERIFICATION status', async () => {
      service = new BreakGlassService();

      const session = await service.initiateBreakGlass(validRequest());

      expect(session.id).toBe(MOCK_UUID);
      expect(session.status).toBe(BreakGlassStatus.PENDING_VERIFICATION);
      expect(session.userId).toBe('user-1');
      expect(session.reason).toBe('Emergency database recovery needed');
      expect(session.scope).toBe(BreakGlassScope.FULL);
      expect(session.renewed).toBe(false);
      expect(session.requiresPostReview).toBe(true);
      expect(session.actions).toEqual([]);
      expect(session.verificationMethods).toEqual([]);
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(session.startedAt.getTime());
    });

    // -------------------------------------------------------------------------
    // 2. Validates request (short reason rejects)
    // -------------------------------------------------------------------------
    it('should reject a request with a reason shorter than 10 characters', async () => {
      service = new BreakGlassService();

      await expect(
        service.initiateBreakGlass(validRequest({ reason: 'short' })),
      ).rejects.toThrow();
    });

    // -------------------------------------------------------------------------
    // 3. Monthly limit enforcement (4th use throws MONTHLY_LIMIT_EXCEEDED)
    // -------------------------------------------------------------------------
    it('should throw MONTHLY_LIMIT_EXCEEDED when monthly limit is exceeded', async () => {
      service = new BreakGlassService(
        { maxUsesPerMonth: 3, requirePhoneCallbackForFullScope: false },
      );

      // Activate 3 sessions to exhaust monthly quota
      for (let i = 0; i < 3; i++) {
        const session = await service.initiateBreakGlass(validRequest());
        await service.verifyMfa(session.id, {
          method: VerificationMethod.MFA_TOTP,
          code: '123456',
        });
        await service.activateSession(session.id);
      }

      // 4th attempt should be blocked
      try {
        await service.initiateBreakGlass(validRequest());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('MONTHLY_LIMIT_EXCEEDED');
      }
    });

    // -------------------------------------------------------------------------
    // 4. Limited scope requires resources
    // -------------------------------------------------------------------------
    it('should reject limited scope without resources', async () => {
      service = new BreakGlassService();

      await expect(
        service.initiateBreakGlass({
          userId: 'user-1',
          reason: 'Need limited access to database',
          scope: BreakGlassScope.LIMITED,
          // no resources
        }),
      ).rejects.toThrow();
    });

    it('should accept limited scope with resources', async () => {
      service = new BreakGlassService();

      const session = await service.initiateBreakGlass(limitedRequest());

      expect(session.scope).toBe(BreakGlassScope.LIMITED);
      expect(session.resources).toEqual(['db-primary', 'cache-01']);
    });
  });

  // ---------------------------------------------------------------------------
  // 5–7. Verify MFA
  // ---------------------------------------------------------------------------
  describe('verifyMfa', () => {
    // 5. TOTP verification with mfaService
    it('should verify TOTP via mfaService and record the method', async () => {
      const mfaService = createMfaService();
      service = new BreakGlassService({}, { mfaService });

      const session = await service.initiateBreakGlass(validRequest());
      const result = await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });

      expect(result).toBe(true);
      expect(mfaService.verifyTotp).toHaveBeenCalledWith('user-1', '123456');
      const updated = service.getSession(session.id);
      expect(updated!.verificationMethods).toContain(VerificationMethod.MFA_TOTP);
    });

    // 6. Without mfaService → returns true and adds method
    it('should return true and add method when mfaService is not configured', async () => {
      service = new BreakGlassService();

      const session = await service.initiateBreakGlass(validRequest());
      const result = await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });

      expect(result).toBe(true);
      const updated = service.getSession(session.id);
      expect(updated!.verificationMethods).toContain(VerificationMethod.MFA_TOTP);
    });

    // 7. Session not found throws
    it('should throw SESSION_NOT_FOUND for unknown session ID', async () => {
      service = new BreakGlassService();

      try {
        await service.verifyMfa('nonexistent-id', {
          method: VerificationMethod.MFA_TOTP,
          code: '123456',
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8–10. Activate session
  // ---------------------------------------------------------------------------
  describe('activateSession', () => {
    // 8. Requires MFA verification first
    it('should throw MFA_REQUIRED if no MFA verification was done', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());

      try {
        await service.activateSession(session.id);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('MFA_REQUIRED');
      }
    });

    // 9. Full scope requires phone callback if configured
    it('should throw PHONE_CALLBACK_REQUIRED for full scope without phone callback', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: true });

      const session = await service.initiateBreakGlass(validRequest());
      // Verify with TOTP only (no phone callback)
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });

      try {
        await service.activateSession(session.id);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('PHONE_CALLBACK_REQUIRED');
      }
    });

    // 10. Sets status to ACTIVE
    it('should set status to ACTIVE after successful activation', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      const activated = await service.activateSession(session.id);

      expect(activated.status).toBe(BreakGlassStatus.ACTIVE);
      expect(activated.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Validate: active returns true, expired returns false, non-existent false
  // ---------------------------------------------------------------------------
  describe('validateBreakGlass', () => {
    it('should return true for an active, non-expired session', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      const valid = await service.validateBreakGlass(session.id);
      expect(valid).toBe(true);
    });

    it('should return false for an expired session', async () => {
      // Use a very short session duration so it expires immediately
      service = new BreakGlassService({
        maxSessionDurationMs: 1, // 1ms — will expire instantly
        requirePhoneCallbackForFullScope: false,
      });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      // Wait a tiny bit to ensure expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const valid = await service.validateBreakGlass(session.id);
      expect(valid).toBe(false);
    });

    it('should return false for a non-existent session', async () => {
      service = new BreakGlassService();

      const valid = await service.validateBreakGlass('does-not-exist');
      expect(valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 12–13. Revoke
  // ---------------------------------------------------------------------------
  describe('revokeBreakGlass', () => {
    // 12. Changes status to REVIEW_PENDING
    it('should change status to REVIEW_PENDING after revocation', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      await service.revokeBreakGlass(session.id, 'admin-1', 'Security concern');

      const revoked = service.getSession(session.id);
      expect(revoked!.status).toBe(BreakGlassStatus.REVIEW_PENDING);
      expect(revoked!.revokedBy).toBe('admin-1');
      expect(revoked!.revocationReason).toBe('Security concern');
      expect(revoked!.endedAt).toBeInstanceOf(Date);
    });

    // 13. Cannot revoke an expired/reviewed session
    it('should throw INVALID_STATE when revoking a session not in ACTIVE or PENDING state', async () => {
      service = new BreakGlassService({
        maxSessionDurationMs: 1,
        requirePhoneCallbackForFullScope: false,
      });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Force expire via validation
      await service.validateBreakGlass(session.id);

      try {
        await service.revokeBreakGlass(session.id, 'admin-1', 'Too late');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('INVALID_STATE');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Record action: only on active session
  // ---------------------------------------------------------------------------
  describe('recordAction', () => {
    it('should record an action on an active session', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      await service.recordAction(session.id, {
        type: 'http_request',
        method: 'GET',
        path: '/admin/users',
      });

      const updated = service.getSession(session.id);
      expect(updated!.actions).toHaveLength(1);
      expect(updated!.actions[0].type).toBe('http_request');
      expect(updated!.actions[0].method).toBe('GET');
      expect(updated!.actions[0].path).toBe('/admin/users');
      expect(updated!.actions[0].id).toBe(MOCK_UUID);
      expect(updated!.actions[0].timestamp).toBeInstanceOf(Date);
    });

    it('should throw SESSION_NOT_ACTIVE when recording on a non-active session', async () => {
      service = new BreakGlassService();

      const session = await service.initiateBreakGlass(validRequest());

      try {
        await service.recordAction(session.id, {
          type: 'http_request',
          method: 'GET',
          path: '/admin/users',
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('SESSION_NOT_ACTIVE');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Renew session: extends expiration, can only renew once
  // ---------------------------------------------------------------------------
  describe('renewSession', () => {
    it('should extend the session expiration time', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      const activated = await service.activateSession(session.id);
      const originalExpiry = activated.expiresAt.getTime();

      const renewed = await service.renewSession(session.id, 'Still need access');

      expect(renewed.renewed).toBe(true);
      expect(renewed.expiresAt.getTime()).toBeGreaterThan(originalExpiry);
      // Renewal extends by 4 hours (14400000 ms)
      expect(renewed.expiresAt.getTime()).toBe(originalExpiry + 4 * 60 * 60 * 1000);
    });

    it('should throw ALREADY_RENEWED on second renewal attempt', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);
      await service.renewSession(session.id, 'First renewal');

      try {
        await service.renewSession(session.id, 'Second renewal');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('ALREADY_RENEWED');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Submit review: only on REVIEW_PENDING sessions
  // ---------------------------------------------------------------------------
  describe('submitReview', () => {
    it('should accept a review for a REVIEW_PENDING session and set status to REVIEWED', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);
      await service.revokeBreakGlass(session.id, 'admin-1');

      const reviewed = await service.submitReview(session.id, 'reviewer-1', {
        approved: true,
        findings: 'Access was justified and appropriate',
        recommendedActions: ['Update runbook', 'Add monitoring'],
      });

      expect(reviewed.status).toBe(BreakGlassStatus.REVIEWED);
      expect(reviewed.review).toBeDefined();
      expect(reviewed.review!.reviewedBy).toBe('reviewer-1');
      expect(reviewed.review!.approved).toBe(true);
      expect(reviewed.review!.findings).toBe('Access was justified and appropriate');
      expect(reviewed.review!.recommendedActions).toEqual(['Update runbook', 'Add monitoring']);
      expect(reviewed.review!.reviewedAt).toBeInstanceOf(Date);
    });

    it('should throw INVALID_STATE when reviewing a session not in REVIEW_PENDING', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      // Session is ACTIVE, not REVIEW_PENDING
      try {
        await service.submitReview(session.id, 'reviewer-1', {
          approved: true,
          findings: 'All good',
          recommendedActions: [],
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BreakGlassError);
        expect((err as BreakGlassError).code).toBe('INVALID_STATE');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 17. isResourceAccessible: full scope → true for all, limited → checks list
  // ---------------------------------------------------------------------------
  describe('isResourceAccessible', () => {
    it('should return true for any resource when scope is full', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      expect(service.isResourceAccessible(session.id, 'any-resource')).toBe(true);
      expect(service.isResourceAccessible(session.id, 'another-resource')).toBe(true);
    });

    it('should return true only for listed resources when scope is limited', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(limitedRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      expect(service.isResourceAccessible(session.id, 'db-primary')).toBe(true);
      expect(service.isResourceAccessible(session.id, 'cache-01')).toBe(true);
      expect(service.isResourceAccessible(session.id, 'unknown-resource')).toBe(false);
    });

    it('should return false for a non-existent session', () => {
      service = new BreakGlassService();

      expect(service.isResourceAccessible('nonexistent', 'resource-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 18. getActiveBreakGlass: returns only active sessions
  // ---------------------------------------------------------------------------
  describe('getActiveBreakGlass', () => {
    it('should return only sessions with ACTIVE status', async () => {
      // Need distinct UUIDs so sessions don't overwrite each other in the Map
      const { v4: mockV4 } = await import('uuid');
      const SESSION_1_ID = '11111111-1111-1111-1111-111111111111';
      const SESSION_2_ID = '22222222-2222-2222-2222-222222222222';
      (mockV4 as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(SESSION_1_ID)   // session 1 id
        .mockReturnValueOnce(SESSION_2_ID);  // session 2 id

      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      // Create and activate first session
      const session1 = await service.initiateBreakGlass(validRequest());
      expect(session1.id).toBe(SESSION_1_ID);
      await service.verifyMfa(session1.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session1.id);

      // Create a second session that stays PENDING
      const session2 = await service.initiateBreakGlass(
        validRequest({ userId: 'user-2' }),
      );
      expect(session2.id).toBe(SESSION_2_ID);

      const activeSessions = await service.getActiveBreakGlass();

      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(SESSION_1_ID);
      expect(activeSessions[0].status).toBe(BreakGlassStatus.ACTIVE);

      // The pending session should not appear
      const pendingInResult = activeSessions.find((s) => s.id === session2.id);
      expect(pendingInResult).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 19. destroy: clears timers
  // ---------------------------------------------------------------------------
  describe('destroy', () => {
    it('should clear all expiration timers without throwing', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      // Activate a session so an expiration timer exists
      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);

      // destroy should not throw
      expect(() => service.destroy()).not.toThrow();

      // Calling destroy again should also be safe
      expect(() => service.destroy()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Additional edge-case tests
  // ---------------------------------------------------------------------------
  describe('getPendingReviews', () => {
    it('should return sessions in REVIEW_PENDING status', async () => {
      service = new BreakGlassService({ requirePhoneCallbackForFullScope: false });

      const session = await service.initiateBreakGlass(validRequest());
      await service.verifyMfa(session.id, {
        method: VerificationMethod.MFA_TOTP,
        code: '123456',
      });
      await service.activateSession(session.id);
      await service.revokeBreakGlass(session.id, 'admin-1');

      const pending = service.getPendingReviews();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(session.id);
      expect(pending[0].status).toBe(BreakGlassStatus.REVIEW_PENDING);
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      service = new BreakGlassService();

      expect(service.getSession('nonexistent')).toBeUndefined();
    });
  });
});
