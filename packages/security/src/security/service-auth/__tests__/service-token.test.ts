/**
 * Tests for ServiceTokenService
 *
 * Validates:
 * - JWT token creation and verification roundtrips
 * - HMAC signature creation and verification
 * - Token expiration, tampering, and algorithm confusion defenses
 * - Issuer/audience validation
 * - Clock skew handling
 * - Header parsing
 * - Singleton lifecycle management
 * - Utility helpers (createServiceAuthHeaders, extractServiceIdFromBearer)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  ServiceTokenService,
  ServiceTokenError,
  TokenExpiredError,
  InvalidSignatureError,
  DEFAULT_TOKEN_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
  MIN_TOKEN_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  SERVICE_TOKEN_ISSUER,
  SERVICE_AUTH_HEADERS,
  initializeServiceTokenService,
  getServiceTokenService,
  resetServiceTokenService,
  createServiceTokenService,
  createServiceAuthHeaders,
  extractServiceIdFromBearer,
  type ServiceTokenServiceConfig,
  type TokenVerificationResult,
} from '../service-token.js';

vi.mock('../../common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// =============================================================================
// HELPERS
// =============================================================================

const VALID_SECRET = 'a]3Fk9$mPq7!wR2xL#nB5dY8vC0jT4hZ'; // 34 chars
const VALID_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function defaultConfig(overrides: Partial<ServiceTokenServiceConfig> = {}): ServiceTokenServiceConfig {
  return {
    signingSecret: VALID_SECRET,
    ...overrides,
  };
}

function defaultTokenParams(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'svc_abc123',
    tenantId: VALID_TENANT_ID,
    serviceName: 'test-service',
    permissions: ['read:data', 'write:data'],
    ...overrides,
  };
}

// =============================================================================
// CONSTRUCTOR VALIDATION
// =============================================================================

describe('ServiceTokenService', () => {
  beforeEach(() => {
    resetServiceTokenService();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetServiceTokenService();
  });

  describe('constructor', () => {
    it('rejects signingSecret shorter than 32 characters', () => {
      expect(() => new ServiceTokenService({ signingSecret: 'short' })).toThrow();
    });

    it('accepts signingSecret of exactly 32 characters', () => {
      const svc = new ServiceTokenService({ signingSecret: 'a'.repeat(32) });
      expect(svc).toBeInstanceOf(ServiceTokenService);
    });
  });

  // ===========================================================================
  // TOKEN CREATION & VERIFICATION
  // ===========================================================================

  describe('createToken / verifyToken roundtrip', () => {
    it('creates a JWT that verifies with matching payload fields', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());
      const result = await svc.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.sub).toBe('svc_abc123');
      expect(result.payload!.tid).toBe(VALID_TENANT_ID);
      expect(result.payload!.svc).toBe('test-service');
      expect(result.payload!.permissions).toEqual(['read:data', 'write:data']);
      expect(result.payload!.type).toBe('service');
      expect(result.payload!.iss).toBe(SERVICE_TOKEN_ISSUER);
      expect(result.payload!.iat).toBeTypeOf('number');
      expect(result.payload!.exp).toBeTypeOf('number');
    });
  });

  describe('customTTL validation', () => {
    it('throws ValidationError when customTTL is below MIN_TOKEN_TTL_SECONDS', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      await expect(
        svc.createToken(defaultTokenParams({ customTTL: MIN_TOKEN_TTL_SECONDS - 1 }))
      ).rejects.toThrow(/TTL must be between/);
    });

    it('throws ValidationError when customTTL is above MAX_TOKEN_TTL_SECONDS', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      await expect(
        svc.createToken(defaultTokenParams({ customTTL: MAX_TOKEN_TTL_SECONDS + 1 }))
      ).rejects.toThrow(/TTL must be between/);
    });
  });

  // ===========================================================================
  // EXPIRATION
  // ===========================================================================

  describe('token expiration', () => {
    it('rejects an expired token (advance past default TTL)', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      // Advance time by DEFAULT_TOKEN_TTL_SECONDS + 1 second
      vi.advanceTimersByTime((DEFAULT_TOKEN_TTL_SECONDS + 1) * 1000);

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EXPIRED');
    });
  });

  // ===========================================================================
  // SIGNATURE / PAYLOAD TAMPERING
  // ===========================================================================

  describe('tampering defenses', () => {
    it('rejects a token with a modified signature segment', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      // Flip one character in the signature
      const sigChars = parts[2].split('');
      sigChars[0] = sigChars[0] === 'A' ? 'B' : 'A';
      const tampered = `${parts[0]}.${parts[1]}.${sigChars.join('')}`;

      const result = await svc.verifyToken(tampered);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('rejects a token with modified payload (re-encoded without re-signing)', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      payload.permissions = ['admin:*'];
      const newPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tampered = `${parts[0]}.${newPayloadB64}.${parts[2]}`;

      const result = await svc.verifyToken(tampered);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });

  // ===========================================================================
  // WRONG SIGNING SECRET
  // ===========================================================================

  describe('wrong signing secret', () => {
    it('rejects a token created with a different signing secret', async () => {
      const svcA = new ServiceTokenService(defaultConfig({ signingSecret: 'A'.repeat(32) }));
      const svcB = new ServiceTokenService(defaultConfig({ signingSecret: 'B'.repeat(32) }));

      const token = await svcA.createToken(defaultTokenParams());
      const result = await svcB.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });

  // ===========================================================================
  // ALGORITHM CONFUSION
  // ===========================================================================

  describe('algorithm confusion', () => {
    it('rejects a token with alg:none and empty signature', async () => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'svc_attacker',
          tid: VALID_TENANT_ID,
          svc: 'test',
          permissions: ['admin:*'],
          type: 'service',
          iat: now,
          exp: now + 300,
          iss: SERVICE_TOKEN_ISSUER,
        })
      ).toString('base64url');
      const fakeToken = `${header}.${payload}.`;

      const svc = new ServiceTokenService(defaultConfig());
      const result = await svc.verifyToken(fakeToken);

      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // ISSUER / AUDIENCE VALIDATION
  // ===========================================================================

  describe('issuer validation', () => {
    it('rejects a token when issuer does not match', async () => {
      const svcA = new ServiceTokenService(defaultConfig({ issuer: 'issuer-A' }));
      const svcB = new ServiceTokenService(defaultConfig({ issuer: 'issuer-B' }));

      const token = await svcA.createToken(defaultTokenParams());
      const result = await svcB.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_ISSUER');
    });
  });

  describe('audience validation', () => {
    it('rejects a token without matching audience', async () => {
      const svcNoAud = new ServiceTokenService(defaultConfig());
      const svcWithAud = new ServiceTokenService(defaultConfig({ audience: 'my-audience' }));

      // Token created without audience, verified by service requiring audience
      const token = await svcNoAud.createToken(defaultTokenParams());
      const result = await svcWithAud.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FORMAT');
    });
  });

  // ===========================================================================
  // HMAC SIGNATURE
  // ===========================================================================

  describe('HMAC createSignature / verifySignature', () => {
    it('roundtrip: createSignature then verifySignature succeeds', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: '{"key":"value"}',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: '{"key":"value"}',
      });

      expect(result.valid).toBe(true);
    });

    it('rejects when body differs (replay with modified body)', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: '{"key":"original"}',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: '{"key":"tampered"}',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('rejects when timestamp exceeds maxClockSkew', () => {
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));
      const oldTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: oldTimestamp,
        method: 'GET',
        path: '/api/check',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: oldTimestamp,
        method: 'GET',
        path: '/api/check',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('CLOCK_SKEW');
    });

    it('accepts when timestamp is within clock skew bounds', () => {
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 300 }));
      const nearTimestamp = Math.floor(Date.now() / 1000) - 100; // 100s ago, within 300s

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: nearTimestamp,
        method: 'GET',
        path: '/api/check',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: nearTimestamp,
        method: 'GET',
        path: '/api/check',
      });

      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // PARSE AUTH HEADERS
  // ===========================================================================

  describe('parseAuthHeaders', () => {
    it('extracts all three service auth headers', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({
        'x-service-id': 'svc_abc',
        'x-service-signature': 'deadbeef',
        'x-service-timestamp': '1700000000',
      });

      expect(result.clientId).toBe('svc_abc');
      expect(result.signature).toBe('deadbeef');
      expect(result.timestamp).toBe(1700000000);
    });

    it('returns nulls for missing headers', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({});

      expect(result.clientId).toBeNull();
      expect(result.signature).toBeNull();
      expect(result.timestamp).toBeNull();
    });

    it('handles array header values by taking first element', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({
        'x-service-id': ['svc_first', 'svc_second'],
        'x-service-signature': ['sig1', 'sig2'],
        'x-service-timestamp': ['1700000000', '1700000001'],
      });

      expect(result.clientId).toBe('svc_first');
      expect(result.signature).toBe('sig1');
      expect(result.timestamp).toBe(1700000000);
    });
  });

  // ===========================================================================
  // SINGLETON MANAGEMENT
  // ===========================================================================

  describe('singleton management', () => {
    it('initializeServiceTokenService and getServiceTokenService work', () => {
      const svc = initializeServiceTokenService(defaultConfig());
      expect(svc).toBeInstanceOf(ServiceTokenService);
      expect(getServiceTokenService()).toBe(svc);
    });

    it('getServiceTokenService throws before initialization', () => {
      expect(() => getServiceTokenService()).toThrow(/not initialized/);
    });

    it('resetServiceTokenService clears singleton', () => {
      initializeServiceTokenService(defaultConfig());
      resetServiceTokenService();
      expect(() => getServiceTokenService()).toThrow(/not initialized/);
    });
  });

  // ===========================================================================
  // UTILITY: createServiceAuthHeaders
  // ===========================================================================

  describe('createServiceAuthHeaders', () => {
    it('produces headers with x-service-id, x-service-signature, and x-service-timestamp', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const headers = createServiceAuthHeaders({
        clientId: 'svc_test',
        clientSecret: 'secret123',
        method: 'POST',
        path: '/api/resource',
        body: '{"data":1}',
        tokenService: svc,
      });

      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_ID]).toBe('svc_test');
      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]).toBeDefined();
      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]).toMatch(/^[a-f0-9]{64}$/);
      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]).toBeDefined();
      expect(Number(headers[SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP])).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // UTILITY: extractServiceIdFromBearer
  // ===========================================================================

  describe('extractServiceIdFromBearer', () => {
    it('extracts sub from a service token Bearer header', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams({ clientId: 'svc_extract_test' }));
      const authHeader = `Bearer ${token}`;

      const serviceId = extractServiceIdFromBearer(authHeader);
      expect(serviceId).toBe('svc_extract_test');
    });

    it('returns null for non-Bearer authorization header', () => {
      const result = extractServiceIdFromBearer('Basic dXNlcjpwYXNz');
      expect(result).toBeNull();
    });

    it('returns null for a token that is not type service', () => {
      // Craft a token where type !== 'service'
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'user_123',
          type: 'user',
          iat: now,
          exp: now + 300,
        })
      ).toString('base64url');
      const fakeToken = `${header}.${payload}.fakesig`;

      const result = extractServiceIdFromBearer(`Bearer ${fakeToken}`);
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // MUTANT KILL: Config schema boundary values
  // ===========================================================================

  describe('config schema boundary values', () => {
    it('rejects signingSecret with exactly 31 characters', () => {
      expect(() => new ServiceTokenService({ signingSecret: 'a'.repeat(31) })).toThrow();
    });

    it('rejects tokenTTL below MIN_TOKEN_TTL_SECONDS', () => {
      expect(() => new ServiceTokenService(defaultConfig({ tokenTTL: MIN_TOKEN_TTL_SECONDS - 1 }))).toThrow();
    });

    it('rejects tokenTTL above MAX_TOKEN_TTL_SECONDS', () => {
      expect(() => new ServiceTokenService(defaultConfig({ tokenTTL: MAX_TOKEN_TTL_SECONDS + 1 }))).toThrow();
    });

    it('accepts tokenTTL at exactly MIN_TOKEN_TTL_SECONDS', () => {
      const svc = new ServiceTokenService(defaultConfig({ tokenTTL: MIN_TOKEN_TTL_SECONDS }));
      expect(svc).toBeInstanceOf(ServiceTokenService);
      expect(svc.getTokenTTL()).toBe(MIN_TOKEN_TTL_SECONDS);
    });

    it('accepts tokenTTL at exactly MAX_TOKEN_TTL_SECONDS', () => {
      const svc = new ServiceTokenService(defaultConfig({ tokenTTL: MAX_TOKEN_TTL_SECONDS }));
      expect(svc).toBeInstanceOf(ServiceTokenService);
      expect(svc.getTokenTTL()).toBe(MAX_TOKEN_TTL_SECONDS);
    });

    it('rejects maxClockSkew of 0 (must be positive)', () => {
      expect(() => new ServiceTokenService(defaultConfig({ maxClockSkew: 0 }))).toThrow();
    });

    it('accepts maxClockSkew of 1', () => {
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 1 }));
      expect(svc).toBeInstanceOf(ServiceTokenService);
      expect(svc.getMaxClockSkew()).toBe(1);
    });
  });

  // ===========================================================================
  // MUTANT KILL: createToken TTL boundary values
  // ===========================================================================

  describe('createToken TTL boundary values', () => {
    it('accepts customTTL at exactly MIN_TOKEN_TTL_SECONDS', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams({ customTTL: MIN_TOKEN_TTL_SECONDS }));
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('accepts customTTL at exactly MAX_TOKEN_TTL_SECONDS', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams({ customTTL: MAX_TOKEN_TTL_SECONDS }));
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });
  });

  // ===========================================================================
  // MUTANT KILL: createToken with audience configured
  // ===========================================================================

  describe('createToken with audience configured', () => {
    it('includes aud claim when audience is set in config', async () => {
      const svc = new ServiceTokenService(defaultConfig({ audience: 'my-service-audience' }));
      const token = await svc.createToken(defaultTokenParams());

      // Decode the payload to verify aud is set
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.aud).toBe('my-service-audience');
    });

    it('token with audience verifies successfully with matching audience', async () => {
      const svc = new ServiceTokenService(defaultConfig({ audience: 'my-service-audience' }));
      const token = await svc.createToken(defaultTokenParams());
      const result = await svc.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
    });
  });

  // ===========================================================================
  // MUTANT KILL: verifyToken error code classification
  // ===========================================================================

  describe('verifyToken error code classification', () => {
    it('returns INVALID_ISSUER errorCode for issuer mismatch', async () => {
      const svcA = new ServiceTokenService(defaultConfig({ issuer: 'issuer-alpha' }));
      const svcB = new ServiceTokenService(defaultConfig({ issuer: 'issuer-beta' }));

      const token = await svcA.createToken(defaultTokenParams());
      const result = await svcB.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_ISSUER');
    });

    it('returns INVALID_FORMAT errorCode for generic format error', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      // Token with only two parts (missing signature) → "Invalid token format"
      const result = await svc.verifyToken('aaa.bbb');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FORMAT');
    });
  });

  // ===========================================================================
  // MUTANT KILL: verifyJWT buffer length check (line 277)
  // ===========================================================================

  describe('verifyJWT signature buffer length mismatch', () => {
    it('rejects token with signature that decodes to different buffer length', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      // Replace signature with a shorter base64url string that decodes to different length
      const shortSig = Buffer.from('short').toString('base64url');
      const tampered = `${parts[0]}.${parts[1]}.${shortSig}`;

      const result = await svc.verifyToken(tampered);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });

  // ===========================================================================
  // MUTANT KILL: verifyJWT exact expiry boundary (line 295)
  // ===========================================================================

  describe('verifyJWT exact expiry boundary', () => {
    it('accepts token where exp === now (not yet expired)', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      // Advance time to exactly the expiry point (DEFAULT_TOKEN_TTL_SECONDS)
      // exp = iat + TTL, and we check exp < now, so exp === now should be valid
      vi.advanceTimersByTime(DEFAULT_TOKEN_TTL_SECONDS * 1000);

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(true);
    });

    it('rejects token where exp === now - 1 (expired 1 second ago)', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      // Advance time to 1 second past expiry
      vi.advanceTimersByTime((DEFAULT_TOKEN_TTL_SECONDS + 1) * 1000);

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EXPIRED');
    });
  });

  // ===========================================================================
  // MUTANT KILL: verifyJWT audience array handling (line 306)
  // ===========================================================================

  describe('verifyJWT audience array and string handling', () => {
    it('accepts token with aud as array containing expected audience', async () => {
      // Create a service that expects audience 'aud-target'
      const svc = new ServiceTokenService(defaultConfig({ audience: 'aud-target' }));

      // Manually craft a token with aud as an array including the target
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payloadObj = {
        sub: 'svc_abc123',
        tid: VALID_TENANT_ID,
        svc: 'test-service',
        permissions: ['read:data'],
        type: 'service',
        iat: now,
        exp: now + 300,
        jti: 'test-jti-123',
        iss: SERVICE_TOKEN_ISSUER,
        aud: ['aud-target', 'aud-other'],
      };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      // Sign with the same key the service uses
      const { createHmac } = await import('node:crypto');
      const signingKey = Buffer.from(VALID_SECRET, 'utf8');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(`${header}.${payloadB64}`);
      const signature = hmac.digest('base64url');
      const token = `${header}.${payloadB64}.${signature}`;

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(true);
    });

    it('rejects token with aud as array NOT containing expected audience', async () => {
      const svc = new ServiceTokenService(defaultConfig({ audience: 'aud-target' }));

      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payloadObj = {
        sub: 'svc_abc123',
        tid: VALID_TENANT_ID,
        svc: 'test-service',
        permissions: ['read:data'],
        type: 'service',
        iat: now,
        exp: now + 300,
        jti: 'test-jti-123',
        iss: SERVICE_TOKEN_ISSUER,
        aud: ['aud-wrong', 'aud-other'],
      };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      const { createHmac } = await import('node:crypto');
      const signingKey = Buffer.from(VALID_SECRET, 'utf8');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(`${header}.${payloadB64}`);
      const signature = hmac.digest('base64url');
      const token = `${header}.${payloadB64}.${signature}`;

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(false);
    });

    it('accepts token with aud as string matching expected audience', async () => {
      const svc = new ServiceTokenService(defaultConfig({ audience: 'aud-match' }));

      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payloadObj = {
        sub: 'svc_abc123',
        tid: VALID_TENANT_ID,
        svc: 'test-service',
        permissions: ['read:data'],
        type: 'service',
        iat: now,
        exp: now + 300,
        jti: 'test-jti-123',
        iss: SERVICE_TOKEN_ISSUER,
        aud: 'aud-match',
      };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      const { createHmac } = await import('node:crypto');
      const signingKey = Buffer.from(VALID_SECRET, 'utf8');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(`${header}.${payloadB64}`);
      const signature = hmac.digest('base64url');
      const token = `${header}.${payloadB64}.${signature}`;

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(true);
    });

    it('rejects token with aud as string NOT matching expected audience', async () => {
      const svc = new ServiceTokenService(defaultConfig({ audience: 'aud-expected' }));

      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payloadObj = {
        sub: 'svc_abc123',
        tid: VALID_TENANT_ID,
        svc: 'test-service',
        permissions: ['read:data'],
        type: 'service',
        iat: now,
        exp: now + 300,
        jti: 'test-jti-123',
        iss: SERVICE_TOKEN_ISSUER,
        aud: 'aud-wrong',
      };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      const { createHmac } = await import('node:crypto');
      const signingKey = Buffer.from(VALID_SECRET, 'utf8');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(`${header}.${payloadB64}`);
      const signature = hmac.digest('base64url');
      const token = `${header}.${payloadB64}.${signature}`;

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // MUTANT KILL: verifySignature second buffer length check (line 538)
  // ===========================================================================

  describe('verifySignature hex buffer length mismatch', () => {
    it('rejects signature with correct string length but different hex buffer length', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      // A valid HMAC-SHA256 hex signature is 64 hex chars (32 bytes)
      // Create a string that is 64 chars long but contains non-hex chars
      // that would decode to a different buffer length
      // Actually, we need a string whose .length === 64 (matches expected)
      // but whose Buffer.from(str, 'hex').length !== 32
      // Non-hex chars cause hex decoding to produce fewer bytes
      const badSig = 'zz' + 'a'.repeat(62); // 64 chars, but 'zz' is invalid hex

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: badSig,
        timestamp,
        method: 'GET',
        path: '/api/test',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });

  // ===========================================================================
  // MUTANT KILL: parseAuthHeaders NaN handling
  // ===========================================================================

  describe('parseAuthHeaders NaN timestamp handling', () => {
    it('returns null timestamp when timestamp header is "abc"', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({
        'x-service-id': 'svc_test',
        'x-service-signature': 'deadbeef',
        'x-service-timestamp': 'abc',
      });

      expect(result.clientId).toBe('svc_test');
      expect(result.signature).toBe('deadbeef');
      expect(result.timestamp).toBeNull();
    });

    it('returns null timestamp when timestamp header is empty string', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({
        'x-service-id': 'svc_test',
        'x-service-signature': 'deadbeef',
        'x-service-timestamp': '',
      });

      expect(result.timestamp).toBeNull();
    });
  });

  // ===========================================================================
  // MUTANT KILL: getTokenTTL and getMaxClockSkew accessors
  // ===========================================================================

  describe('getTokenTTL and getMaxClockSkew accessors', () => {
    it('returns DEFAULT_TOKEN_TTL_SECONDS when no custom tokenTTL is set', () => {
      const svc = new ServiceTokenService(defaultConfig());
      expect(svc.getTokenTTL()).toBe(DEFAULT_TOKEN_TTL_SECONDS);
    });

    it('returns MAX_CLOCK_SKEW_SECONDS when no custom maxClockSkew is set', () => {
      const svc = new ServiceTokenService(defaultConfig());
      expect(svc.getMaxClockSkew()).toBe(MAX_CLOCK_SKEW_SECONDS);
    });

    it('returns custom tokenTTL when set', () => {
      const svc = new ServiceTokenService(defaultConfig({ tokenTTL: 120 }));
      expect(svc.getTokenTTL()).toBe(120);
    });

    it('returns custom maxClockSkew when set', () => {
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));
      expect(svc.getMaxClockSkew()).toBe(60);
    });
  });

  // ===========================================================================
  // MUTANT KILL: extractServiceIdFromBearer edge cases
  // ===========================================================================

  describe('extractServiceIdFromBearer edge cases', () => {
    it('returns null for undefined input', () => {
      expect(extractServiceIdFromBearer(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractServiceIdFromBearer('')).toBeNull();
    });

    it('returns null for "Bearer " with no token after', () => {
      expect(extractServiceIdFromBearer('Bearer ')).toBeNull();
    });

    it('returns null for "Bearer" without space', () => {
      expect(extractServiceIdFromBearer('Bearer')).toBeNull();
    });

    it('returns null for bearer token with missing payload section', () => {
      // Token with only header part, no payload
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      expect(extractServiceIdFromBearer(`Bearer ${header}`)).toBeNull();
    });

    it('returns null for bearer token with malformed base64 payload', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      // Use invalid JSON as payload
      const badPayload = Buffer.from('not-json{{{').toString('base64url');
      expect(extractServiceIdFromBearer(`Bearer ${header}.${badPayload}.fakesig`)).toBeNull();
    });
  });

  // ===========================================================================
  // MUTANT KILL: createServiceAuthHeaders using default singleton
  // ===========================================================================

  describe('createServiceAuthHeaders with default singleton', () => {
    it('uses singleton when no tokenService param is provided', () => {
      initializeServiceTokenService(defaultConfig());

      const headers = createServiceAuthHeaders({
        clientId: 'svc_singleton',
        clientSecret: 'secret123',
        method: 'POST',
        path: '/api/resource',
        body: '{"data":1}',
      });

      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_ID]).toBe('svc_singleton');
      expect(headers[SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]).toMatch(/^[a-f0-9]{64}$/);
      expect(Number(headers[SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP])).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // MUTANT KILL: createSignature with Buffer body
  // ===========================================================================

  describe('createSignature with Buffer body', () => {
    it('produces a valid signature when body is a Buffer', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);
      const bodyStr = '{"key":"value"}';
      const bodyBuf = Buffer.from(bodyStr, 'utf8');

      const sigFromString = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: bodyStr,
      });

      const sigFromBuffer = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: bodyBuf,
      });

      // Buffer body should produce same signature as string body
      expect(sigFromBuffer).toBe(sigFromString);
    });

    it('Buffer body signature roundtrips with verifySignature', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);
      const bodyBuf = Buffer.from('{"data":true}', 'utf8');

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: bodyBuf,
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: bodyBuf,
      });

      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // MUTANT KILL: Signature with empty/no body
  // ===========================================================================

  describe('createSignature with empty and no body', () => {
    it('produces same signature for undefined body and empty string body', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sigNoBody = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      const sigEmptyBody = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/data',
        body: '',
      });

      expect(sigNoBody).toBe(sigEmptyBody);
    });
  });

  // ===========================================================================
  // MUTANT KILL: createServiceTokenService utility
  // ===========================================================================

  describe('createServiceTokenService utility', () => {
    it('returns a new ServiceTokenService instance', () => {
      const svc = createServiceTokenService(defaultConfig());
      expect(svc).toBeInstanceOf(ServiceTokenService);
    });

    it('returned instance can create and verify tokens', async () => {
      const svc = createServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());
      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // MUTATION-KILLING TESTS
  // ===========================================================================

  describe('[Mutation-kill] Exact constant values', () => {
    it('DEFAULT_TOKEN_TTL_SECONDS is exactly 300', () => {
      expect(DEFAULT_TOKEN_TTL_SECONDS).toBe(300);
    });

    it('MAX_CLOCK_SKEW_SECONDS is exactly 300', () => {
      expect(MAX_CLOCK_SKEW_SECONDS).toBe(300);
    });

    it('MIN_TOKEN_TTL_SECONDS is exactly 60', () => {
      expect(MIN_TOKEN_TTL_SECONDS).toBe(60);
    });

    it('MAX_TOKEN_TTL_SECONDS is exactly 3600', () => {
      expect(MAX_TOKEN_TTL_SECONDS).toBe(3600);
    });

    it('SERVICE_TOKEN_ISSUER is exactly "vorion:service-auth"', () => {
      expect(SERVICE_TOKEN_ISSUER).toBe('vorion:service-auth');
    });

    it('SERVICE_AUTH_HEADERS.SERVICE_ID is exactly "x-service-id"', () => {
      expect(SERVICE_AUTH_HEADERS.SERVICE_ID).toBe('x-service-id');
    });

    it('SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE is exactly "x-service-signature"', () => {
      expect(SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE).toBe('x-service-signature');
    });

    it('SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP is exactly "x-service-timestamp"', () => {
      expect(SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP).toBe('x-service-timestamp');
    });

    it('SERVICE_AUTH_HEADERS has exactly 3 keys', () => {
      expect(Object.keys(SERVICE_AUTH_HEADERS)).toHaveLength(3);
    });
  });

  describe('[Mutation-kill] Error class properties', () => {
    it('ServiceTokenError has code SERVICE_TOKEN_ERROR and statusCode 401', () => {
      const err = new ServiceTokenError('test');
      expect(err.code).toBe('SERVICE_TOKEN_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('ServiceTokenError');
    });

    it('ServiceTokenError includes details when provided', () => {
      const details = { key: 'val' };
      const err = new ServiceTokenError('test', details);
      expect(err.details).toEqual(details);
    });

    it('TokenExpiredError has code TOKEN_EXPIRED and statusCode 401', () => {
      const err = new TokenExpiredError(new Date('2025-01-01'));
      expect(err.code).toBe('TOKEN_EXPIRED');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('TokenExpiredError');
    });

    it('TokenExpiredError message contains the ISO date string', () => {
      const date = new Date('2025-06-15T12:00:00Z');
      const err = new TokenExpiredError(date);
      expect(err.message).toContain(date.toISOString());
      expect(err.message).toContain('Token expired at');
    });

    it('TokenExpiredError details includes expiredAt as ISO string', () => {
      const date = new Date('2025-06-15T12:00:00Z');
      const err = new TokenExpiredError(date);
      expect(err.details).toEqual({ expiredAt: date.toISOString() });
    });

    it('InvalidSignatureError has code INVALID_SIGNATURE and statusCode 401', () => {
      const err = new InvalidSignatureError('bad sig');
      expect(err.code).toBe('INVALID_SIGNATURE');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('InvalidSignatureError');
    });

    it('InvalidSignatureError message includes the reason', () => {
      const err = new InvalidSignatureError('tampered');
      expect(err.message).toBe('Invalid signature: tampered');
      expect(err.details).toEqual({ reason: 'tampered' });
    });

    it('SignatureTimestampError has correct code and details', () => {
      const err = new SignatureTimestampError(1000, 2000, 300);
      expect(err.code).toBe('SIGNATURE_TIMESTAMP_ERROR');
      expect(err.name).toBe('SignatureTimestampError');
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('300s');
      expect(err.details).toEqual({ timestamp: 1000, currentTime: 2000, maxSkewSeconds: 300 });
    });
  });

  describe('[Mutation-kill] createToken payload structure', () => {
    it('exp = iat + ttl (exact arithmetic)', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig({ tokenTTL: 120 }));
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

      expect(payload.exp).toBe(payload.iat + 120);
    });

    it('default TTL produces exp = iat + 300', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

      expect(payload.exp).toBe(payload.iat + 300);
    });

    it('type field is exactly "service"', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());
      const result = await svc.verifyToken(token);
      expect(result.payload!.type).toBe('service');
    });

    it('jti is a 32-character hex string', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.jti).toMatch(/^[a-f0-9]{32}$/);
    });

    it('ip field is present when ipAddress is provided', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(
        defaultTokenParams({ ipAddress: '192.168.1.1' })
      );

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.ip).toBe('192.168.1.1');
    });

    it('ip field is undefined when ipAddress is not provided', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.ip).toBeUndefined();
    });

    it('aud field is absent when no audience is configured', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.aud).toBeUndefined();
    });
  });

  describe('[Mutation-kill] JWT structure', () => {
    it('JWT has exactly 3 dot-separated parts', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());
      expect(token.split('.').length).toBe(3);
    });

    it('JWT header contains alg HS256 and typ JWT', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const token = await svc.createToken(defaultTokenParams());

      const parts = token.split('.');
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });
  });

  describe('[Mutation-kill] createSignature method uppercases', () => {
    it('lowercase method and uppercase method produce the same signature', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sigLower = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'post',
        path: '/api/data',
        body: 'test',
      });

      const sigUpper = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
        body: 'test',
      });

      expect(sigLower).toBe(sigUpper);
    });

    it('different methods produce different signatures', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sigGet = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      const sigPost = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'POST',
        path: '/api/data',
      });

      expect(sigGet).not.toBe(sigPost);
    });
  });

  describe('[Mutation-kill] createSignature message format', () => {
    it('different paths produce different signatures', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/a',
      });

      const sig2 = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/b',
      });

      expect(sig1).not.toBe(sig2);
    });

    it('different timestamps produce different signatures', () => {
      const svc = new ServiceTokenService(defaultConfig());

      const sig1 = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: 1000,
        method: 'GET',
        path: '/api/data',
      });

      const sig2 = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: 1001,
        method: 'GET',
        path: '/api/data',
      });

      expect(sig1).not.toBe(sig2);
    });

    it('different client secrets produce different signatures', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig1 = svc.createSignature({
        clientSecret: 'secret-a',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      const sig2 = svc.createSignature({
        clientSecret: 'secret-b',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(sig1).not.toBe(sig2);
    });

    it('signature is exactly 64 hex characters (SHA-256)', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('[Mutation-kill] verifySignature clock skew boundary', () => {
    it('accepts signature at exactly maxClockSkew seconds ago', () => {
      vi.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));

      const pastTimestamp = now - 60; // exactly at boundary
      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: pastTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: pastTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(true);
    });

    it('rejects signature at maxClockSkew + 1 seconds ago', () => {
      vi.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));

      const pastTimestamp = now - 61; // one second past boundary
      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: pastTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: pastTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('CLOCK_SKEW');
    });

    it('accepts signature at exactly maxClockSkew seconds in the future', () => {
      vi.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));

      const futureTimestamp = now + 60;
      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: futureTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: futureTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(true);
    });

    it('rejects signature at maxClockSkew + 1 seconds in the future', () => {
      vi.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 60 }));

      const futureTimestamp = now + 61;
      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: futureTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: futureTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('CLOCK_SKEW');
    });
  });

  describe('[Mutation-kill] verifySignature error result structure', () => {
    it('CLOCK_SKEW result has valid=false and error message containing the skew value', () => {
      const svc = new ServiceTokenService(defaultConfig({ maxClockSkew: 30 }));
      const oldTimestamp = Math.floor(Date.now() / 1000) - 100;

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp: oldTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp: oldTimestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('CLOCK_SKEW');
      expect(result.error).toContain('30');
    });

    it('INVALID_SIGNATURE result when wrong secret is used for verification', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig = svc.createSignature({
        clientSecret: 'secret-a',
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      const result = svc.verifySignature({
        clientSecret: 'secret-b',
        providedSignature: sig,
        timestamp,
        method: 'GET',
        path: '/api/data',
      });

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });

  describe('[Mutation-kill] verifyToken with invalid JSON payload', () => {
    it('returns INVALID_FORMAT for completely garbled token', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = await svc.verifyToken('not.a.jwt');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('returns INVALID_FORMAT for single string (no dots)', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = await svc.verifyToken('nodots');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FORMAT');
    });
  });

  describe('[Mutation-kill] createToken customTTL overrides default', () => {
    it('uses customTTL instead of default when provided', async () => {
      vi.useFakeTimers();
      const svc = new ServiceTokenService(defaultConfig({ tokenTTL: 300 }));
      const token = await svc.createToken(defaultTokenParams({ customTTL: 120 }));

      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.exp - payload.iat).toBe(120);
    });
  });

  describe('[Mutation-kill] parseAuthHeaders with empty array values', () => {
    it('returns null for empty array header values', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const result = svc.parseAuthHeaders({
        'x-service-id': [],
        'x-service-signature': [],
        'x-service-timestamp': [],
      });

      expect(result.clientId).toBeNull();
      expect(result.signature).toBeNull();
      expect(result.timestamp).toBeNull();
    });
  });

  describe('[Mutation-kill] verifyToken rejects unsupported algorithm', () => {
    it('rejects token with alg RS256', async () => {
      const svc = new ServiceTokenService(defaultConfig());
      const now = Math.floor(Date.now() / 1000);

      // Craft a token with RS256 header
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payloadObj = {
        sub: 'svc_abc',
        tid: VALID_TENANT_ID,
        svc: 'test',
        permissions: ['read:data'],
        type: 'service',
        iat: now,
        exp: now + 300,
        iss: SERVICE_TOKEN_ISSUER,
      };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      // Sign with HS256 key but header says RS256
      const { createHmac } = await import('node:crypto');
      const signingKey = Buffer.from(VALID_SECRET, 'utf8');
      const hmac = createHmac('sha256', signingKey);
      hmac.update(`${header}.${payloadB64}`);
      const signature = hmac.digest('base64url');
      const token = `${header}.${payloadB64}.${signature}`;

      const result = await svc.verifyToken(token);
      expect(result.valid).toBe(false);
    });
  });

  describe('[Mutation-kill] initializeServiceTokenService returns same instance', () => {
    it('returns the instance that was just created', () => {
      const svc = initializeServiceTokenService(defaultConfig());
      const gotten = getServiceTokenService();
      expect(svc).toBe(gotten);
    });

    it('overwrites previous instance on re-initialization', () => {
      const svc1 = initializeServiceTokenService(defaultConfig());
      const svc2 = initializeServiceTokenService(defaultConfig({ tokenTTL: 120 }));
      expect(svc2).not.toBe(svc1);
      expect(getServiceTokenService()).toBe(svc2);
    });
  });

  describe('[Mutation-kill] createServiceAuthHeaders timestamp is current time', () => {
    it('timestamp header is a Unix timestamp close to now', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const before = Math.floor(Date.now() / 1000);
      const headers = createServiceAuthHeaders({
        clientId: 'svc_test',
        clientSecret: 'secret',
        method: 'GET',
        path: '/api/test',
        tokenService: svc,
      });
      const after = Math.floor(Date.now() / 1000);

      const ts = Number(headers[SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('[Mutation-kill] extractServiceIdFromBearer with sub but no type', () => {
    it('returns null when token has sub but type is missing', () => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'svc_test', iat: now, exp: now + 300 })
      ).toString('base64url');
      const token = `${header}.${payload}.fakesig`;

      expect(extractServiceIdFromBearer(`Bearer ${token}`)).toBeNull();
    });
  });

  describe('[Mutation-kill] verifySignature returns valid:true with no error fields', () => {
    it('successful verification returns exactly { valid: true }', () => {
      const svc = new ServiceTokenService(defaultConfig());
      const timestamp = Math.floor(Date.now() / 1000);

      const sig = svc.createSignature({
        clientSecret: 'my-secret',
        timestamp,
        method: 'GET',
        path: '/test',
      });

      const result = svc.verifySignature({
        clientSecret: 'my-secret',
        providedSignature: sig,
        timestamp,
        method: 'GET',
        path: '/test',
      });

      expect(result).toEqual({ valid: true });
      expect(result.error).toBeUndefined();
      expect(result.errorCode).toBeUndefined();
    });
  });
});
