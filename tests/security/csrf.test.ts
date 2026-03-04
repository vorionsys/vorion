/**
 * CSRF Protection Tests for Vorion Platform
 *
 * Tests for Cross-Site Request Forgery protection including:
 * - Token generation with HMAC signatures
 * - Token validation with timing-safe comparison
 * - Double-submit cookie pattern
 * - Token expiration handling
 * - Middleware behavior
 *
 * @module tests/security/csrf
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CSRFProtection,
  resetCSRFProtection,
  type CSRFConfig,
  type TokenValidationResult,
} from '../../src/security/csrf.js';

// Mock dependencies
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/common/config.js', () => ({
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
} = {}) {
  const { method = 'GET', url = '/', headers = {}, cookies = {} } = options;

  return {
    method,
    url,
    headers: {
      ...headers,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    },
    cookies,
    ip: '127.0.0.1',
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

describe('CSRF Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    resetCSRFProtection();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('CSRFProtection Constructor', () => {
    it('should create instance with valid configuration', () => {
      const csrf = new CSRFProtection(createTestConfig());
      expect(csrf).toBeDefined();
      expect(csrf.getConfig()).toBeDefined();
    });

    it('should throw error if secret is missing', () => {
      expect(() => {
        new CSRFProtection({ secret: '' });
      }).toThrow('CSRF secret must be provided and at least 32 characters long');
    });

    it('should throw error if secret is too short', () => {
      expect(() => {
        new CSRFProtection({ secret: 'short' });
      }).toThrow('CSRF secret must be provided and at least 32 characters long');
    });

    it('should accept secret exactly 32 characters', () => {
      const csrf = new CSRFProtection({
        secret: '12345678901234567890123456789012', // exactly 32 chars
      });
      expect(csrf).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieName: '__custom_csrf',
        tokenLength: 64,
      }));

      const config = csrf.getConfig();
      expect(config.cookieName).toBe('__custom_csrf');
      expect(config.tokenLength).toBe(64);
      expect(config.headerName).toBe('X-CSRF-Token'); // default
    });

    it('should merge cookie options with defaults', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieOptions: {
          secure: false,
          httpOnly: true,
          sameSite: 'lax',
        },
      }));

      const config = csrf.getConfig();
      expect(config.cookieOptions.secure).toBe(false);
      expect(config.cookieOptions.sameSite).toBe('lax');
      expect(config.cookieOptions.path).toBe('/'); // default preserved
    });
  });

  describe('Token Generation', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should generate valid token format', () => {
      const token = csrf.generateToken('session-123');

      // Token should be base64url encoded
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

      // Should be decodable
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      expect(parts).toHaveLength(4); // sessionId, timestamp, random, signature
    });

    it('should include session ID in token', () => {
      const sessionId = 'test-session-abc123';
      const token = csrf.generateToken(sessionId);

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      expect(parts[0]).toBe(sessionId);
    });

    it('should include current timestamp in token', () => {
      const token = csrf.generateToken('session');

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      const timestamp = parseInt(parts[1], 10);

      expect(timestamp).toBe(Date.now());
    });

    it('should generate unique tokens for same session', () => {
      const token1 = csrf.generateToken('session');
      const token2 = csrf.generateToken('session');

      expect(token1).not.toBe(token2);
    });

    it('should generate token without session ID', () => {
      const token = csrf.generateToken();

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      expect(parts[0]).toBe(''); // empty session ID
    });

    it('should generate cryptographically random component', () => {
      const tokens: string[] = [];
      for (let i = 0; i < 100; i++) {
        tokens.push(csrf.generateToken('session'));
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(100);
    });

    it('should use configured token length for random component', () => {
      const csrfCustomLength = new CSRFProtection(createTestConfig({
        tokenLength: 64,
      }));

      const token = csrfCustomLength.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      const randomPart = parts[2];

      // 64 bytes = 128 hex characters
      expect(randomPart).toHaveLength(128);
    });

    it('should include valid HMAC signature', () => {
      const token = csrf.generateToken('session-123');

      // Token should validate against itself
      expect(csrf.validateToken(token, token)).toBe(true);
    });
  });

  describe('Token Validation', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should validate matching tokens', () => {
      const token = csrf.generateToken('session');
      expect(csrf.validateToken(token, token)).toBe(true);
    });

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

    it('should reject tokens with invalid structure', () => {
      // Create a token with wrong number of parts
      const invalidToken = Buffer.from('only.two.parts').toString('base64url');
      expect(csrf.validateToken(invalidToken, invalidToken)).toBe(false);
    });

    it('should reject tokens with invalid timestamp', () => {
      // Create a token with non-numeric timestamp
      const invalidToken = Buffer.from('session.notanumber.random.signature').toString('base64url');
      expect(csrf.validateToken(invalidToken, invalidToken)).toBe(false);
    });

    it('should reject tokens with tampered signature', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Tamper with signature
      parts[3] = 'tampered' + parts[3].slice(8);
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
    });

    it('should reject tokens with tampered session ID', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Tamper with session ID
      parts[0] = 'different-session';
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
    });

    it('should reject tokens with tampered timestamp', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Tamper with timestamp
      parts[1] = String(Date.now() - 1000);
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      const token = csrf.generateToken('session');

      // This test verifies the comparison doesn't short-circuit
      // by checking that similar tokens take similar time
      const startValid = performance.now();
      for (let i = 0; i < 1000; i++) {
        csrf.validateToken(token, token);
      }
      const validTime = performance.now() - startValid;

      const differentToken = csrf.generateToken('different');
      const startInvalid = performance.now();
      for (let i = 0; i < 1000; i++) {
        csrf.validateToken(token, differentToken);
      }
      const invalidTime = performance.now() - startInvalid;

      // Times should be in the same order of magnitude (no timing attack vulnerability)
      // Allow for some variance due to test environment
      const maxExpectedDiff = Math.max(validTime * 5, 50); expect(Math.abs(validTime - invalidTime)).toBeLessThan(maxExpectedDiff);
    });
  });

  describe('Token Validation with Details', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should return valid result for matching tokens', () => {
      const token = csrf.generateToken('session');
      const result = csrf.validateTokenWithDetails(token, token);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for missing token', () => {
      const result = csrf.validateTokenWithDetails('', 'cookie-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing CSRF token');
    });

    it('should return error for missing cookie token', () => {
      const result = csrf.validateTokenWithDetails('header-token', '');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing CSRF token');
    });

    it('should return error for length mismatch', () => {
      const token = csrf.generateToken('session');
      const result = csrf.validateTokenWithDetails(token, token + 'extra');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid CSRF token');
    });

    it('should return error for token mismatch', () => {
      const token1 = csrf.generateToken('session1');
      const token2 = csrf.generateToken('session2');
      const result = csrf.validateTokenWithDetails(token1, token2);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid CSRF token');
    });

    it('should return error for malformed token', () => {
      const malformed = Buffer.from('not.enough.parts').toString('base64url');
      const result = csrf.validateTokenWithDetails(malformed, malformed);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Malformed CSRF token');
    });

    it('should return error for invalid signature', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');
      parts[3] = 'a'.repeat(64); // fake signature
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      const result = csrf.validateTokenWithDetails(tamperedToken, tamperedToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid CSRF token signature');
    });
  });

  describe('Token Expiration', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig({
        tokenTTL: 3600000, // 1 hour
      }));
    });

    it('should accept token within TTL', () => {
      const token = csrf.generateToken('session');

      // Advance time by 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should accept token at TTL boundary', () => {
      const token = csrf.generateToken('session');

      // Advance time to exactly TTL
      vi.advanceTimersByTime(3600000);

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject expired token', () => {
      const token = csrf.generateToken('session');

      // Advance time past TTL
      vi.advanceTimersByTime(3600001);

      expect(csrf.validateToken(token, token)).toBe(false);
    });

    it('should return expiration error for expired token', () => {
      const token = csrf.generateToken('session');

      // Advance time past TTL
      vi.advanceTimersByTime(3700000);

      const result = csrf.validateTokenWithDetails(token, token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('CSRF token expired');
    });

    it('should reject token with future timestamp (clock skew)', () => {
      const token = csrf.generateToken('session');

      // Move time backwards by more than 60 seconds (clock skew tolerance)
      vi.setSystemTime(new Date('2024-01-15T09:58:00.000Z'));

      const result = csrf.validateTokenWithDetails(token, token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid CSRF token timestamp');
    });

    it('should accept token with minor clock skew (within tolerance)', () => {
      const token = csrf.generateToken('session');

      // Move time backwards by 30 seconds (within tolerance)
      vi.setSystemTime(new Date('2024-01-15T09:59:30.000Z'));

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should work with custom TTL', () => {
      const shortTTLCSRF = new CSRFProtection(createTestConfig({
        tokenTTL: 60000, // 1 minute
      }));

      const token = shortTTLCSRF.generateToken('session');

      // Advance by 2 minutes
      vi.advanceTimersByTime(120000);

      expect(shortTTLCSRF.validateToken(token, token)).toBe(false);
    });
  });

  describe('Double-Submit Cookie Pattern', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should validate when header and cookie tokens match', () => {
      const token = csrf.generateToken('session');

      // Same token in both header and cookie
      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject when header and cookie tokens differ', () => {
      const headerToken = csrf.generateToken('session');

      // Attacker cannot access the cookie value
      vi.advanceTimersByTime(1); // ensure different timestamp
      const attackerToken = csrf.generateToken('session');

      expect(csrf.validateToken(attackerToken, headerToken)).toBe(false);
    });

    it('should bind token to session ID', () => {
      const token = csrf.generateToken('user-session-123');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      expect(parts[0]).toBe('user-session-123');
    });

    it('should prevent token reuse across sessions', () => {
      // Token from one session
      const session1Token = csrf.generateToken('session-1');

      // Create token for different session
      const session2Token = csrf.generateToken('session-2');

      // Cross-session usage should fail
      expect(csrf.validateToken(session1Token, session2Token)).toBe(false);
    });
  });

  describe('Middleware Behavior', () => {
    let csrf: CSRFProtection;
    let middleware: ReturnType<CSRFProtection['createMiddleware']>;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/webhooks/*', '/api/health'],
        excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
      }));
      middleware = csrf.createMiddleware();
    });

    it('should skip validation for GET requests', async () => {
      const request = createMockRequest({ method: 'GET', url: '/api/data' });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should skip validation for HEAD requests', async () => {
      const request = createMockRequest({ method: 'HEAD', url: '/api/data' });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should skip validation for OPTIONS requests', async () => {
      const request = createMockRequest({ method: 'OPTIONS', url: '/api/data' });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should validate POST requests', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Forbidden',
        statusCode: 403,
      }));
    });

    it('should validate PUT requests', async () => {
      const request = createMockRequest({
        method: 'PUT',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should validate DELETE requests', async () => {
      const request = createMockRequest({
        method: 'DELETE',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should validate PATCH requests', async () => {
      const request = createMockRequest({
        method: 'PATCH',
        url: '/api/data/123',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should skip validation for excluded exact path', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/health',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should skip validation for excluded glob path', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/webhooks/stripe',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should validate non-excluded paths', async () => {
      const request = createMockRequest({
        method: 'POST',
        url: '/api/users',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should accept valid token in header and cookie', async () => {
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: {
          'x-csrf-token': token,
        },
        cookies: {
          '__vorion_csrf': token,
        },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should set CSRF cookie on GET requests', async () => {
      const request = createMockRequest({
        method: 'GET',
        url: '/api/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      // Should set cookie via setCookie or header
      const setHeaderOrCookie =
        reply.setCookie.mock.calls.length > 0 ||
        reply.header.mock.calls.some(([name]) => name === 'Set-Cookie');

      expect(setHeaderOrCookie).toBe(true);
    });

    it('should reject request with missing header token', async () => {
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        cookies: {
          '__vorion_csrf': token,
        },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Missing CSRF token',
      }));
    });

    it('should reject request with missing cookie token', async () => {
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: {
          'x-csrf-token': token,
        },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Missing CSRF token',
      }));
    });

    it('should reject request with mismatched tokens', async () => {
      const headerToken = csrf.generateToken('session1');
      vi.advanceTimersByTime(1);
      const cookieToken = csrf.generateToken('session2');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: {
          'x-csrf-token': headerToken,
        },
        cookies: {
          '__vorion_csrf': cookieToken,
        },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).toHaveBeenCalledWith(403);
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

  describe('Path Exclusion Patterns', () => {
    it('should exclude exact path matches', async () => {
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/health'],
      }));
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
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/health'],
      }));
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/health?check=deep',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should exclude glob pattern matches', async () => {
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/webhooks/*'],
      }));
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
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/public'],
      }));
      const middleware = csrf.createMiddleware();

      const request = createMockRequest({
        method: 'POST',
        url: '/api/public/data',
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should not exclude non-matching paths', async () => {
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/webhooks/*'],
      }));
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
      const csrf = new CSRFProtection(createTestConfig({
        excludePaths: ['/api/health', '/api/webhooks/*', '/api/public/*'],
      }));
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

  describe('Cookie Configuration', () => {
    it('should set secure cookie in production', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieOptions: {
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
        },
      }));

      const config = csrf.getConfig();
      expect(config.cookieOptions.secure).toBe(true);
    });

    it('should set httpOnly flag', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieOptions: {
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
        },
      }));

      const config = csrf.getConfig();
      expect(config.cookieOptions.httpOnly).toBe(true);
    });

    it('should support strict SameSite', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieOptions: {
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
        },
      }));

      const config = csrf.getConfig();
      expect(config.cookieOptions.sameSite).toBe('strict');
    });

    it('should support lax SameSite', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieOptions: {
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        },
      }));

      const config = csrf.getConfig();
      expect(config.cookieOptions.sameSite).toBe('lax');
    });

    it('should support custom cookie name', () => {
      const csrf = new CSRFProtection(createTestConfig({
        cookieName: '__my_app_csrf',
      }));

      const config = csrf.getConfig();
      expect(config.cookieName).toBe('__my_app_csrf');
    });

    it('should support custom header name', () => {
      const csrf = new CSRFProtection(createTestConfig({
        headerName: 'X-XSRF-TOKEN',
      }));

      const config = csrf.getConfig();
      expect(config.headerName).toBe('X-XSRF-TOKEN');
    });

    it('should use custom header name in middleware', async () => {
      const csrf = new CSRFProtection(createTestConfig({
        headerName: 'X-XSRF-TOKEN',
        cookieName: '__xsrf',
      }));
      const middleware = csrf.createMiddleware();
      const token = csrf.generateToken('session');

      const request = createMockRequest({
        method: 'POST',
        url: '/api/data',
        headers: {
          'x-xsrf-token': token,
        },
        cookies: {
          '__xsrf': token,
        },
      });
      const reply = createMockReply();

      await middleware(request as any, reply as any);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });
  });

  describe('Security Edge Cases', () => {
    let csrf: CSRFProtection;

    beforeEach(() => {
      csrf = new CSRFProtection(createTestConfig());
    });

    it('should reject null byte injection in token', () => {
      const token = csrf.generateToken('session');
      const maliciousToken = token.slice(0, 10) + '\x00' + token.slice(11);

      expect(csrf.validateToken(maliciousToken, token)).toBe(false);
    });

    it('should reject extremely long tokens', () => {
      const token = csrf.generateToken('session');
      const longToken = token + 'a'.repeat(10000);

      expect(csrf.validateToken(longToken, token)).toBe(false);
    });

    it('should handle unicode in session ID', () => {
      const token = csrf.generateToken('session-\u{1F600}-emoji');

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject token with modified random component', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Modify random component
      parts[2] = 'modified' + parts[2].slice(8);
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
    });

    it('should prevent replay attacks with different secrets', () => {
      const token = csrf.generateToken('session');

      // Create new instance with different secret
      const csrfDifferentSecret = new CSRFProtection(createTestConfig({
        secret: 'completely-different-secret-that-is-at-least-32-chars',
      }));

      // Token from original should not validate with different secret
      expect(csrfDifferentSecret.validateToken(token, token)).toBe(false);
    });

    it('should handle empty session ID gracefully', () => {
      const token = csrf.generateToken('');

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should handle very long session IDs', () => {
      const longSessionId = 'session-' + 'a'.repeat(1000);
      const token = csrf.generateToken(longSessionId);

      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject token with special characters in signature', () => {
      const token = csrf.generateToken('session');
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      // Add special characters to signature
      parts[3] = '<script>alert(1)</script>';
      const tamperedToken = Buffer.from(parts.join('.')).toString('base64url');

      expect(csrf.validateToken(tamperedToken, tamperedToken)).toBe(false);
    });
  });

  describe('Configuration Retrieval', () => {
    it('should return a copy of configuration', () => {
      const csrf = new CSRFProtection(createTestConfig());
      const config1 = csrf.getConfig();
      const config2 = csrf.getConfig();

      // Should be equal but not same reference
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });

    it('should not allow modification of returned config', () => {
      const csrf = new CSRFProtection(createTestConfig());
      const config = csrf.getConfig();

      // Attempt to modify
      (config as any).secret = 'hacked';

      // Original should be unchanged
      const freshConfig = csrf.getConfig();
      expect(freshConfig.secret).not.toBe('hacked');
    });
  });

  describe('Reset Functionality', () => {
    it('should reset singleton instance', () => {
      const csrf1 = new CSRFProtection(createTestConfig());
      resetCSRFProtection();

      // After reset, creating new instance should work
      const csrf2 = new CSRFProtection(createTestConfig());
      expect(csrf2).toBeDefined();
      expect(csrf1).not.toBe(csrf2);
    });
  });
});
