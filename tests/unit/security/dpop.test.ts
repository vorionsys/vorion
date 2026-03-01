/**
 * DPoP (Demonstrating Proof-of-Possession) Tests
 *
 * Tests for RFC 9449 DPoP implementation including:
 * - Token generation
 * - Token verification
 * - Replay attack prevention
 * - Clock skew handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DPoPService, createDPoPService, DPoPError } from '../../../src/security/dpop.js';
import type { JTICache, DPoPConfig } from '../../../src/security/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../src/intent/metrics.js', () => ({
  intentRegistry: {
    registerMetric: vi.fn(),
  },
}));

describe('DPoP Service', () => {
  let dpopService: DPoPService;
  let keyPair: CryptoKeyPair;

  beforeEach(async () => {
    // Generate test key pair - needs to be extractable for generateProof to export public key
    keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable
      ['sign', 'verify']
    );

    dpopService = createDPoPService({
      useInMemoryCache: true, // Use in-memory cache for tests (avoid Redis)
      config: {
        requiredForTiers: [2, 3, 4, 5],
        maxProofAge: 60,
        clockSkewTolerance: 5,
        allowedAlgorithms: ['ES256'],
      },
    });
  });

  // Helper to generate a key pair specifically for DPoP (private key only signs)
  async function generateDPoPKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    return kp;
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Token Generation', () => {
    it('should generate a valid DPoP proof JWT', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      expect(proof).toBeDefined();
      expect(typeof proof).toBe('string');

      // JWT has 3 parts separated by dots
      const parts = proof.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should include correct header with typ=dpop+jwt', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'GET',
        'https://api.example.com/resource'
      );

      const parts = proof.split('.');
      const header = JSON.parse(atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/')));

      expect(header.typ).toBe('dpop+jwt');
      expect(header.alg).toBe('ES256');
      expect(header.jwk).toBeDefined();
      expect(header.jwk.kty).toBe('EC');
      expect(header.jwk.crv).toBe('P-256');
    });

    it('should include required payload claims (jti, htm, htu, iat)', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const parts = proof.split('.');
      const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const padding = (4 - (payloadB64.length % 4)) % 4;
      const payload = JSON.parse(atob(payloadB64 + '='.repeat(padding)));

      expect(payload.jti).toBeDefined();
      expect(payload.jti.length).toBeGreaterThan(0);
      expect(payload.htm).toBe('POST');
      expect(payload.htu).toBe('https://api.example.com/token');
      expect(payload.iat).toBeDefined();
      expect(typeof payload.iat).toBe('number');
    });

    it('should include ath claim when access token hash is provided', async () => {
      const accessTokenHash = 'fUHyO2r2Z3DZ53EsNrWBb0xWXoaNy59IiKCAqksmQEo';
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'GET',
        'https://api.example.com/resource',
        accessTokenHash
      );

      const parts = proof.split('.');
      const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const padding = (4 - (payloadB64.length % 4)) % 4;
      const payload = JSON.parse(atob(payloadB64 + '='.repeat(padding)));

      expect(payload.ath).toBe(accessTokenHash);
    });

    it('should generate unique JTI for each proof', async () => {
      const proof1 = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );
      const proof2 = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const getJti = (proof: string) => {
        const parts = proof.split('.');
        const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
        const padding = (4 - (payloadB64.length % 4)) % 4;
        return JSON.parse(atob(payloadB64 + '='.repeat(padding))).jti;
      };

      expect(getJti(proof1)).not.toBe(getJti(proof2));
    });
  });

  describe('Token Verification', () => {
    it('should verify a valid DPoP proof', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const result = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(true);
      expect(result.keyThumbprint).toBeDefined();
      expect(result.verifiedAt).toBeDefined();
    });

    it('should reject proof with invalid signature', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // Tamper with signature
      const parts = proof.split('.');
      const tamperedProof = `${parts[0]}.${parts[1]}.invalidSignature`;

      const result = await dpopService.verifyProof(
        tamperedProof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
    });

    it('should reject proof with wrong HTTP method', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const result = await dpopService.verifyProof(
        proof,
        'GET', // Wrong method
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('METHOD_MISMATCH');
    });

    it('should reject proof with wrong URI', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const result = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/other' // Wrong URI
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('URI_MISMATCH');
    });

    it('should reject proof with invalid format (wrong number of parts)', async () => {
      const result = await dpopService.verifyProof(
        'not.a.valid.jwt.format',
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_FORMAT');
    });

    it('should reject proof with wrong typ claim', async () => {
      // Create a proof with wrong typ
      const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256', jwk: {} }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const payload = btoa(JSON.stringify({ jti: 'test', htm: 'POST', htu: 'https://example.com', iat: Date.now() / 1000 }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const fakeProof = `${header}.${payload}.fakesig`;

      const result = await dpopService.verifyProof(
        fakeProof,
        'POST',
        'https://example.com'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('dpop+jwt');
    });
  });

  describe('Replay Attack Prevention', () => {
    it('should reject replayed proofs (same JTI)', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // First use should succeed
      const result1 = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );
      expect(result1.valid).toBe(true);

      // Replay should fail
      const result2 = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );
      expect(result2.valid).toBe(false);
      expect(result2.errorCode).toBe('REPLAY');
    });

    it('should allow different proofs with unique JTIs', async () => {
      const proof1 = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );
      const proof2 = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      const result1 = await dpopService.verifyProof(
        proof1,
        'POST',
        'https://api.example.com/token'
      );
      const result2 = await dpopService.verifyProof(
        proof2,
        'POST',
        'https://api.example.com/token'
      );

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('Clock Skew Handling', () => {
    it('should reject proofs issued too far in the past', async () => {
      // Create service with short max age
      const strictService = createDPoPService({
        useInMemoryCache: true,
        config: {
          maxProofAge: 5,
          clockSkewTolerance: 2,
        },
      });

      const proof = await strictService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // Wait longer than max age + tolerance
      await new Promise(resolve => setTimeout(resolve, 100));

      // Mock time to be far in the future
      const futureTime = Date.now() + 10000;
      vi.spyOn(Date, 'now').mockImplementation(() => futureTime);

      const result = await strictService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EXPIRED');

      vi.restoreAllMocks();
    });

    it('should reject proofs issued in the future (beyond tolerance)', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // Mock time to be in the past (proof will appear to be in the future)
      const pastTime = Date.now() - 60000;
      vi.spyOn(Date, 'now').mockImplementation(() => pastTime);

      const result = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('future');

      vi.restoreAllMocks();
    });

    it('should accept proofs within clock skew tolerance', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // Mock time slightly in the past (within tolerance)
      const slightlyPastTime = Date.now() - 2000;
      vi.spyOn(Date, 'now').mockImplementation(() => slightlyPastTime);

      const result = await dpopService.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(true);

      vi.restoreAllMocks();
    });
  });

  describe('Trust Tier Requirements', () => {
    it('should require DPoP for T2+ tiers', () => {
      expect(dpopService.isRequired(0)).toBe(false);
      expect(dpopService.isRequired(1)).toBe(false);
      expect(dpopService.isRequired(2)).toBe(true);
      expect(dpopService.isRequired(3)).toBe(true);
      expect(dpopService.isRequired(4)).toBe(true);
      expect(dpopService.isRequired(5)).toBe(true);
    });

    it('should respect custom tier configuration', () => {
      const customService = createDPoPService({
        useInMemoryCache: true,
        config: {
          requiredForTiers: [3, 4, 5],
        },
      });

      expect(customService.isRequired(2)).toBe(false);
      expect(customService.isRequired(3)).toBe(true);
    });
  });

  describe('Bound Token Validation', () => {
    it('should validate token binding with matching ath claim', async () => {
      const accessToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test';
      const ath = await dpopService.generateAccessTokenHash(accessToken);

      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'GET',
        'https://api.example.com/resource',
        ath
      );

      const isValid = await dpopService.validateBoundToken(
        accessToken,
        proof,
        'GET',
        'https://api.example.com/resource'
      );

      expect(isValid).toBe(true);
    });

    it('should reject token binding with mismatched ath claim', async () => {
      const accessToken = 'real-token';
      const wrongAth = 'wrong-hash';

      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'GET',
        'https://api.example.com/resource',
        wrongAth
      );

      const isValid = await dpopService.validateBoundToken(
        accessToken,
        proof,
        'GET',
        'https://api.example.com/resource'
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Access Token Hash Generation', () => {
    it('should generate consistent hash for same token', async () => {
      const token = 'test-access-token';
      const hash1 = await dpopService.generateAccessTokenHash(token);
      const hash2 = await dpopService.generateAccessTokenHash(token);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different tokens', async () => {
      const hash1 = await dpopService.generateAccessTokenHash('token1');
      const hash2 = await dpopService.generateAccessTokenHash('token2');

      expect(hash1).not.toBe(hash2);
    });

    it('should generate base64url encoded hash', async () => {
      const hash = await dpopService.generateAccessTokenHash('test');

      // Base64url should not contain +, /, or =
      expect(hash).not.toMatch(/[+/=]/);
    });
  });

  describe('Custom JTI Cache', () => {
    it('should use custom JTI cache when provided', async () => {
      const mockCache: JTICache = {
        store: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
      };

      const serviceWithCache = new DPoPService(
        { requiredForTiers: [2, 3, 4, 5] },
        mockCache
      );

      const proof = await serviceWithCache.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      await serviceWithCache.verifyProof(
        proof,
        'POST',
        'https://api.example.com/token'
      );

      expect(mockCache.exists).toHaveBeenCalled();
      expect(mockCache.store).toHaveBeenCalled();
    });
  });

  describe('Configuration', () => {
    it('should return current configuration', () => {
      const config = dpopService.getConfig();

      expect(config.requiredForTiers).toEqual([2, 3, 4, 5]);
      expect(config.maxProofAge).toBe(60);
      expect(config.clockSkewTolerance).toBe(5);
      expect(config.allowedAlgorithms).toContain('ES256');
    });

    it('should reject unsupported algorithms', async () => {
      const proof = await dpopService.generateProof(
        keyPair.privateKey,
        'POST',
        'https://api.example.com/token'
      );

      // Modify header to use unsupported algorithm
      const parts = proof.split('.');
      const header = JSON.parse(atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/')));
      header.alg = 'RS256'; // Not in allowed list
      const newHeader = btoa(JSON.stringify(header))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const tamperedProof = `${newHeader}.${parts[1]}.${parts[2]}`;

      const result = await dpopService.verifyProof(
        tamperedProof,
        'POST',
        'https://api.example.com/token'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported algorithm');
    });
  });
});
