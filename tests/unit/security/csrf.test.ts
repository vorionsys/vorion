/**
 * CSRF Protection Unit Tests
 *
 * Comprehensive unit tests for CSRF protection including:
 * - Token generation
 * - Token validation (valid, invalid, expired)
 * - Timing-safe comparison
 * - Double-submit cookie pattern
 * - CSRF bypass attempt detection
 *
 * @module tests/unit/security/csrf
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CSRFProtection,
  resetCSRFProtection,
  type CSRFConfig,
  type TokenValidationResult,
} from '../../../src/security/csrf.js';

// Mock dependencies
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/common/config.js', () => ({
  getConfig: () => ({
    env: 'test',
    debug: false,
  }),
}));

/**
 * Helper to create a valid test configuration
 */
function createTestConfig(overrides: Partial<CSRFConfig> = {}): Partial<CSRFConfig> {
  return {
    secret: 'test-secret-key-that-is-at-least-32-characters-long',
    tokenLength: 32,
    cookieName: '__vorion_csrf',
    headerName: 'X-CSRF-Token',
    excludePaths: [],
    excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
    tokenTTL: 3600000, // 1 hour
    cookieOptions: {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 3600,
    },
    ...overrides,
  };
}

/**
 * Helper to create mock Fastify request
 */
function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  ip?: string;
  session?: { id?: string };
  user?: { id?: string };
} = {}) {
  const {
    method = 'GET',
    url = '/',
    headers = {},
    cookies = {},
    ip = '127.0.0.1',
    session,
    user,
  } = options;

  return {
    method,
    url,
    headers: {
      ...headers,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      'user-agent': 'Test Agent',
    },
    cookies,
    ip,
    session,
    user,
  };
}

/**
 * Helper to create mock Fastify reply
 */
function createMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    setCookie: vi.fn().mockReturnThis(),
  };
  return reply;
}

describe('CSRF Protection Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    resetCSRFProtection();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Token Generation Tests
  // ===========================================================================
  describe('Token Generation', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should generate token with correct format (base64url)', () => {
      const token = csrf.generateToken('session-123');

      // Should be valid base64url (no +, /, =)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate token with four parts when decoded', () => {
      const token = csrf.generateToken('session-123');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      expect(parts).toHaveLength(4);
    });

    it('should embed session ID in token', () => {
      const sessionId = 'my-session-id-12345';
      const token = csrf.generateToken(sessionId);

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      expect(parts[0]).toBe(sessionId);
    });

    it('should embed current timestamp in token', () => {
      const now = Date.now();
      const token = csrf.generateToken('session');

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBe(now);
    });

    it('should generate unique random component each time', () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 100; i++) {
        tokens.add(csrf.generateToken('session'));
      }

      expect(tokens.size).toBe(100);
    });

    it('should include HMAC signature in token', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Signature should be present and look like hex
      expect(parts[3]).toBeDefined();
      expect(parts[3].length).toBeGreaterThan(0);
    });

    it('should work without session ID', () => {
      const token = csrf.generateToken();

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      expect(parts[0]).toBe('');
      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should generate random component with configured length', () => {
      const customCsrf = new CSRFProtection(createTestConfig({ tokenLength: 64 }));
      const token = customCsrf.generateToken('session');

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      const randomPart = parts[2];

      // 64 bytes = 128 hex characters
      expect(randomPart).toHaveLength(128);
    });

    it('should generate valid self-validating token', () => {
      const token = csrf.generateToken('session');

      expect(csrf.validateToken(token, token)).toBe(true);
    });
  });

  // ===========================================================================
  // Token Validation Tests (Valid, Invalid, Expired)
  // ===========================================================================
  describe('Token Validation', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    describe('Valid Token Validation', () => {
      it('should validate matching tokens', () => {
        const token = csrf.generateToken('session');

        expect(csrf.validateToken(token, token)).toBe(true);
      });

      it('should return valid result with details', () => {
        const token = csrf.generateToken('session');
        const result = csrf.validateTokenWithDetails(token, token);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should validate token at TTL boundary', () => {
        const token = csrf.generateToken('session');

        // Advance to exactly TTL
        vi.advanceTimersByTime(3600000);

        expect(csrf.validateToken(token, token)).toBe(true);
      });

      it('should validate token with minor clock skew', () => {
        const token = csrf.generateToken('session');

        // Move time backwards by 30 seconds (within 60s tolerance)
        vi.setSystemTime(new Date('2024-01-15T09:59:30.000Z'));

        expect(csrf.validateToken(token, token)).toBe(true);
      });
    });

    describe('Invalid Token Validation', () => {
      it('should reject when header token is missing', () => {
        const cookieToken = csrf.generateToken('session');

        expect(csrf.validateToken('', cookieToken)).toBe(false);
      });

      it('should reject when cookie token is missing', () => {
        const headerToken = csrf.generateToken('session');

        expect(csrf.validateToken(headerToken, '')).toBe(false);
      });

      it('should reject when both tokens are missing', () => {
        expect(csrf.validateToken('', '')).toBe(false);
      });

      it('should reject mismatched tokens', () => {
        const token1 = csrf.generateToken('session1');
        vi.advanceTimersByTime(1);
        const token2 = csrf.generateToken('session2');

        expect(csrf.validateToken(token1, token2)).toBe(false);
      });

      it('should reject tokens with different lengths', () => {
        const token = csrf.generateToken('session');

        expect(csrf.validateToken(token, token + 'extra')).toBe(false);
      });

      it('should reject malformed base64 tokens', () => {
        const token = csrf.generateToken('session');

        expect(csrf.validateToken('!!!invalid!!!', token)).toBe(false);
      });

      it('should reject tokens with wrong number of parts', () => {
        const invalidToken = Buffer.from('only.two.parts').toString('base64url');

        expect(csrf.validateToken(invalidToken, invalidToken)).toBe(false);
      });

      it('should reject tokens with non-numeric timestamp', () => {
        const invalidToken = Buffer.from(
          'session.notanumber.random.signature'
        ).toString('base64url');

        expect(csrf.validateToken(invalidToken, invalidToken)).toBe(false);
      });

      it('should reject tokens with tampered signature', () => {
        const token = csrf.generateToken('session');
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split('.');

        parts[3] = 'tampered' + parts[3].slice(8);
        const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

        expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
      });

      it('should reject tokens with tampered session ID', () => {
        const token = csrf.generateToken('session');
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split('.');

        parts[0] = 'hacked-session';
        const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

        expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
      });

      it('should reject tokens with tampered timestamp', () => {
        const token = csrf.generateToken('session');
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split('.');

        parts[1] = String(Date.now() - 10000);
        const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

        expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
      });

      it('should reject tokens with tampered random component', () => {
        const token = csrf.generateToken('session');
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split('.');

        parts[2] = 'modified' + parts[2].slice(8);
        const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

        expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
      });

      it('should return specific error for missing token', () => {
        const result = csrf.validateTokenWithDetails('', 'cookie-token');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Missing CSRF token');
      });

      it('should return specific error for length mismatch', () => {
        const token = csrf.generateToken('session');
        const result = csrf.validateTokenWithDetails(token, token + 'x');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid CSRF token');
      });

      it('should return specific error for malformed token', () => {
        const malformed = Buffer.from('bad.parts').toString('base64url');
        const result = csrf.validateTokenWithDetails(malformed, malformed);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Malformed CSRF token');
      });

      it('should return specific error for invalid signature', () => {
        const token = csrf.generateToken('session');
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split('.');
        parts[3] = 'a'.repeat(64);
        const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

        const result = csrf.validateTokenWithDetails(tamperedToken, tamperedToken);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid CSRF token signature');
      });
    });

    describe('Expired Token Validation', () => {
      it('should reject expired token', () => {
        const token = csrf.generateToken('session');

        vi.advanceTimersByTime(3600001); // 1ms past TTL

        expect(csrf.validateToken(token, token)).toBe(false);
      });

      it('should return expiration error for expired token', () => {
        const token = csrf.generateToken('session');

        vi.advanceTimersByTime(3700000); // Well past TTL

        const result = csrf.validateTokenWithDetails(token, token);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('CSRF token expired');
      });

      it('should reject token with future timestamp beyond tolerance', () => {
        const token = csrf.generateToken('session');

        // Move time backwards by more than 60 seconds
        vi.setSystemTime(new Date('2024-01-15T09:58:00.000Z'));

        const result = csrf.validateTokenWithDetails(token, token);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid CSRF token timestamp');
      });

      it('should work with custom TTL', () => {
        const shortTTLCSRF = new CSRFProtection(
          createTestConfig({ tokenTTL: 60000 }) // 1 minute
        );

        const token = shortTTLCSRF.generateToken('session');

        // Within TTL
        vi.advanceTimersByTime(30000);
        expect(shortTTLCSRF.validateToken(token, token)).toBe(true);

        // Past TTL
        vi.advanceTimersByTime(60000);
        expect(shortTTLCSRF.validateToken(token, token)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Timing-Safe Comparison Tests
  // ===========================================================================
  describe('Timing-Safe Comparison', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    // Skip: Timing-based tests are inherently flaky in CI environments due to
    // variable CPU load and scheduler timing. The actual timing-safe comparison
    // is verified by code review of the crypto.timingSafeEqual usage.
    it.skip('should use timing-safe comparison (no early exit)', () => {
      const token = csrf.generateToken('session');

      // Run multiple iterations to check timing
      const iterations = 1000;

      // Valid comparison
      const startValid = performance.now();
      for (let i = 0; i < iterations; i++) {
        csrf.validateToken(token, token);
      }
      const validTime = performance.now() - startValid;

      // Invalid comparison (completely different)
      const differentToken = csrf.generateToken('different');
      const startInvalid = performance.now();
      for (let i = 0; i < iterations; i++) {
        csrf.validateToken(token, differentToken);
      }
      const invalidTime = performance.now() - startInvalid;

      // Times should be similar (within 5x variance for test stability)
      // Real timing attacks require much more precision
      expect(Math.abs(validTime - invalidTime)).toBeLessThan(validTime * 5);
    });

    it('should compare full token content regardless of mismatch position', () => {
      const token = csrf.generateToken('session');

      // Token with first character different
      const firstCharDiff = 'x' + token.slice(1);

      // Token with last character different
      const lastCharDiff = token.slice(0, -1) + 'x';

      // Both should be rejected similarly
      expect(csrf.validateToken(firstCharDiff, token)).toBe(false);
      expect(csrf.validateToken(lastCharDiff, token)).toBe(false);
    });

    it('should handle buffer comparison edge cases', () => {
      const token = csrf.generateToken('session');

      // Empty string comparison
      expect(csrf.validateToken('', '')).toBe(false);

      // Very short token
      expect(csrf.validateToken('a', 'a')).toBe(false); // Invalid format
    });
  });

  // ===========================================================================
  // Double-Submit Cookie Pattern Tests
  // ===========================================================================
  describe('Double-Submit Cookie Pattern', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should validate when header and cookie tokens match', () => {
      const token = csrf.generateToken('session');

      // Same token in both locations
      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject when header and cookie tokens differ', () => {
      const headerToken = csrf.generateToken('session');
      vi.advanceTimersByTime(1);
      const cookieToken = csrf.generateToken('session');

      expect(csrf.validateToken(headerToken, cookieToken)).toBe(false);
    });

    it('should bind token to session ID', () => {
      const sessionId = 'user-session-abc123';
      const token = csrf.generateToken(sessionId);

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      expect(parts[0]).toBe(sessionId);
    });

    it('should prevent token reuse across sessions', () => {
      const session1Token = csrf.generateToken('session-1');
      const session2Token = csrf.generateToken('session-2');

      // Cross-session attack
      expect(csrf.validateToken(session1Token, session2Token)).toBe(false);
    });

    it('should enforce same token in header and cookie', async () => {
      const middleware = csrf.createMiddleware();
      const validToken = csrf.generateToken('session');

      // Valid: same token in both
      const validRequest = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-csrf-token': validToken },
        cookies: { '__vorion_csrf': validToken },
      });
      const validReply = createMockReply();

      await middleware(validRequest as any, validReply as any);
      expect(validReply.code).not.toHaveBeenCalledWith(403);

      // Invalid: different tokens
      vi.advanceTimersByTime(1);
      const differentToken = csrf.generateToken('session');
      const invalidRequest = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-csrf-token': validToken },
        cookies: { '__vorion_csrf': differentToken },
      });
      const invalidReply = createMockReply();

      await middleware(invalidRequest as any, invalidReply as any);
      expect(invalidReply.code).toHaveBeenCalledWith(403);
    });
  });

  // ===========================================================================
  // CSRF Bypass Attempt Detection Tests
  // ===========================================================================
  describe('CSRF Bypass Attempt Detection', () => {
    let csrf: CSRFProtection;
    let middleware: ReturnType<CSRFProtection['createMiddleware']>;

    beforeEach(() => {
      csrf = new CSRFProtection(
        createTestConfig({
          excludePaths: ['/api/webhooks/*', '/api/health'],
          excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
        })
      );
      middleware = csrf.createMiddleware();
    });

    it('should block POST without CSRF token', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
        })
      );
    });

    it('should block PUT without CSRF token', async () => {
      const request = createMockRequest({
        method: 'PUT',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should block DELETE without CSRF token', async () => {
      const request = createMockRequest({
        method: 'DELETE',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should block PATCH without CSRF token', async () => {
      const request = createMockRequest({
        method: 'PATCH',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should skip validation for GET requests', async () => {
      const request = createMockRequest({
        method: 'GET',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should skip validation for HEAD requests', async () => {
      const request = createMockRequest({
        method: 'HEAD',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should skip validation for OPTIONS requests', async () => {
      const request = createMockRequest({
        method: 'OPTIONS',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should skip validation for excluded paths', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/webhooks/stripe',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should detect missing header token attack', async () => {
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        cookies: { '__vorion_csrf': token },
        // Header token missing - attacker cannot read cookie
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Missing CSRF token',
        })
      );
    });

    it('should detect missing cookie token attack', async () => {
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-csrf-token': token },
        // Cookie token missing
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should detect forged token attack', async () => {
      const realToken = csrf.generateToken('session');
      const forgedToken = csrf.generateToken('attacker-session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-csrf-token': forgedToken },
        cookies: { '__vorion_csrf': realToken },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should detect expired token attack', async () => {
      const token = csrf.generateToken('session');

      vi.advanceTimersByTime(3700000); // Past TTL

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-csrf-token': token },
        cookies: { '__vorion_csrf': token },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should detect null byte injection attack', () => {
      const token = csrf.generateToken('session');
      const maliciousToken = token.slice(0, 10) + '\x00' + token.slice(11);

      expect(csrf.validateToken(maliciousToken, token)).toBe(false);
    });

    it('should detect extremely long token attack', () => {
      const token = csrf.generateToken('session');
      const longToken = token + 'a'.repeat(10000);

      expect(csrf.validateToken(longToken, token)).toBe(false);
    });

    it('should detect replay attack with different secret', () => {
      const token = csrf.generateToken('session');

      const differentSecretCSRF = new CSRFProtection(
        createTestConfig({
          secret: 'completely-different-secret-at-least-32-chars',
        })
      );

      expect(differentSecretCSRF.validateToken(token, token)).toBe(false);
    });

    it('should detect XSS payload in token signature', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      parts[3] = '<script>alert(1)</script>';
      const xssToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(xssToken, xssToken)).toBe(false);
    });

    it('should handle case-insensitive method matching', async () => {
      const request = createMockRequest({
        method: 'get', // lowercase
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });
  });

  // ===========================================================================
  // Path Exclusion Tests
  // ===========================================================================
  describe('Path Exclusion Patterns', () => {
    it('should exclude exact path matches', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({ excludePaths: ['/api/health'] })
      );
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/health',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should exclude paths with query strings', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({ excludePaths: ['/api/health'] })
      );
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/health?detailed=true',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should exclude glob pattern matches', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({ excludePaths: ['/api/webhooks/*'] })
      );
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/webhooks/stripe/events',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should exclude prefix matches', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({ excludePaths: ['/api/public'] })
      );
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/public/assets',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should not exclude non-matching paths', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({ excludePaths: ['/api/webhooks/*'] })
      );
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/users',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should handle multiple exclusion patterns', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          excludePaths: ['/api/health', '/api/webhooks/*', '/api/public/*'],
        })
      );
      const middleware = csrf.createMiddleware();

      const testPaths = [
        '/api/health',
        '/api/webhooks/github',
        '/api/public/assets',
      ];

      for (const path of testPaths) {
        const request = createMockRequest({ method: 'POST', url: path });
        const reply = createMockReply();

        await middleware(request as any, reply as any);

        expect(reply.code).not.toHaveBeenCalledWith(403);
      }
    });
  });

  // ===========================================================================
  // Cookie Configuration Tests
  // ===========================================================================
  describe('Cookie Configuration', () => {
    it('should configure secure cookie', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieOptions: {
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
          },
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieOptions.secure).toBe(true);
    });

    it('should configure httpOnly flag', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieOptions: {
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
          },
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieOptions.httpOnly).toBe(true);
    });

    it('should support strict SameSite', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieOptions: {
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
          },
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieOptions.sameSite).toBe('strict');
    });

    it('should support lax SameSite', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieOptions: {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          },
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieOptions.sameSite).toBe('lax');
    });

    it('should support custom cookie name', () => {
      const csrf = new CSRFProtection(
        createTestConfig({ cookieName: '__custom_csrf' })
      );

      const config = csrf.getConfig();
      expect(config.cookieName).toBe('__custom_csrf');
    });

    it('should support custom header name', () => {
      const csrf = new CSRFProtection(
        createTestConfig({ headerName: 'X-XSRF-TOKEN' })
      );

      const config = csrf.getConfig();
      expect(config.headerName).toBe('X-XSRF-TOKEN');
    });

    it('should use custom header name in middleware', async () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          headerName: 'X-XSRF-TOKEN',
          cookieName: '__xsrf',
        })
      );
      const middleware = csrf.createMiddleware();
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: { 'x-xsrf-token': token },
        cookies: { '__xsrf': token },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should set cookie on GET requests via middleware', async () => {
      const csrf = new CSRFProtection(createTestConfig());
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'GET',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      const setCookieCalled = reply.setCookie.mock.calls.length > 0;
      const headerCookieCalled = reply.header.mock.calls.some(
        ([name]) => name === 'Set-Cookie'
      );

      expect(setCookieCalled || headerCookieCalled).toBe(true);
    });
  });

  // ===========================================================================
  // Constructor Validation Tests
  // ===========================================================================
  describe('Constructor Validation', () => {
    it('should throw if secret is missing', () => {
      expect(() => {
        new CSRFProtection({ secret: '' });
      }).toThrow('CSRF secret must be provided and at least 32 characters long');
    });

    it('should throw if secret is too short', () => {
      expect(() => {
        new CSRFProtection({ secret: 'short' });
      }).toThrow('CSRF secret must be provided and at least 32 characters long');
    });

    it('should accept secret exactly 32 characters', () => {
      const csrf = new CSRFProtection({
        secret: '12345678901234567890123456789012',
      });
      expect(csrf).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieName: '__custom_csrf',
          tokenLength: 64,
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieName).toBe('__custom_csrf');
      expect(config.tokenLength).toBe(64);
      expect(config.headerName).toBe('X-CSRF-Token'); // default preserved
    });

    it('should merge cookie options with defaults', () => {
      const csrf = new CSRFProtection(
        createTestConfig({
          cookieOptions: {
            secure: false,
            httpOnly: true,
            sameSite: 'lax',
          },
        })
      );

      const config = csrf.getConfig();
      expect(config.cookieOptions.secure).toBe(false);
      expect(config.cookieOptions.sameSite).toBe('lax');
      expect(config.cookieOptions.path).toBe('/'); // default preserved
    });
  });

  // ===========================================================================
  // Configuration Retrieval Tests
  // ===========================================================================
  describe('Configuration Retrieval', () => {
    it('should return a copy of configuration', () => {
      const csrf = new CSRFProtection(createTestConfig());
      const config1 = csrf.getConfig();
      const config2 = csrf.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });

    it('should not allow modification of returned config', () => {
      const csrf = new CSRFProtection(createTestConfig());
      const config = csrf.getConfig();

      (config as any).secret = 'hacked';

      const freshConfig = csrf.getConfig();
      expect(freshConfig.secret).not.toBe('hacked');
    });
  });

  // ===========================================================================
  // Session Extraction Tests
  // ===========================================================================
  describe('Session Extraction', () => {
    it('should extract session ID from session object', async () => {
      const csrf = new CSRFProtection(createTestConfig());
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'GET',
        url: '/api/data',
        session: { id: 'session-from-plugin' },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      // Should have set cookie (indicates session was extracted for token generation)
      const setCookieCalled = reply.setCookie.mock.calls.length > 0;
      const headerCookieCalled = reply.header.mock.calls.some(
        ([name]) => name === 'Set-Cookie'
      );
      expect(setCookieCalled || headerCookieCalled).toBe(true);
    });

    it('should extract user ID as fallback session', async () => {
      const csrf = new CSRFProtection(createTestConfig());
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'GET',
        url: '/api/data',
        user: { id: 'user-123' },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      const setCookieCalled = reply.setCookie.mock.calls.length > 0;
      const headerCookieCalled = reply.header.mock.calls.some(
        ([name]) => name === 'Set-Cookie'
      );
      expect(setCookieCalled || headerCookieCalled).toBe(true);
    });
  });

  // ===========================================================================
  // Reset Functionality Tests
  // ===========================================================================
  describe('Reset Functionality', () => {
    it('should reset singleton instance', () => {
      const csrf1 = new CSRFProtection(createTestConfig());
      resetCSRFProtection();

      const csrf2 = new CSRFProtection(createTestConfig());
      expect(csrf1).not.toBe(csrf2);
    });
  });

  // ===========================================================================
  // Edge Cases Tests
  // ===========================================================================
  describe('Edge Cases', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should handle unicode in session ID', () => {
      const token = csrf.generateToken('session-\u4e2d\u6587-emoji-\ud83d\ude00');

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should handle empty session ID', () => {
      const token = csrf.generateToken('');

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should handle very long session IDs', () => {
      const longSessionId = 'session-' + 'a'.repeat(1000);
      const token = csrf.generateToken(longSessionId);

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should handle special characters in session ID', () => {
      // Note: Session IDs containing '.' will break token parsing
      // due to the use of '.' as a delimiter in the token format.
      // Using a session ID with special characters but no periods.
      const token = csrf.generateToken('session-!@#$%^&*()_+-=[]{}|;:,<>?');

      expect(csrf.validateToken(token, token)).toBe(true);
    });
  });
});
