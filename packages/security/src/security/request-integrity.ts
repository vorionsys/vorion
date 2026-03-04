/**
 * Request Integrity Verification Module
 *
 * Implements HMAC-SHA256 request signing with replay attack prevention.
 * Features include:
 * - HMAC-SHA256 signature generation and verification
 * - Nonce tracking using Redis or in-memory storage
 * - Timestamp validation to reject stale requests
 * - Fastify middleware integration
 * - Configurable path exclusions
 *
 * @packageDocumentation
 * @module security/request-integrity
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import type { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';

const logger = createLogger({ component: 'request-integrity' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for nonce storage */
const NONCE_PREFIX = 'vorion:request_integrity:nonce:';

/** Default maximum age for requests in milliseconds (5 minutes) */
const DEFAULT_MAX_AGE_MS = 300000;

/** Default nonce TTL in milliseconds (10 minutes) */
const DEFAULT_NONCE_TTL_MS = 600000;

/** Header name for the signature */
const SIGNATURE_HEADER = 'x-vorion-signature';

/** Header name for the timestamp */
const TIMESTAMP_HEADER = 'x-vorion-timestamp';

/** Header name for the nonce */
const NONCE_HEADER = 'x-vorion-nonce';

/** Header name for the algorithm */
const ALGORITHM_HEADER = 'x-vorion-algorithm';

// =============================================================================
// Types
// =============================================================================

/**
 * Signed request metadata
 */
export interface SignedRequest {
  /** Unix timestamp in milliseconds when the request was signed */
  timestamp: number;
  /** Unique nonce to prevent replay attacks */
  nonce: string;
  /** HMAC-SHA256 signature of the request */
  signature: string;
  /** Algorithm used for signing */
  algorithm: 'HMAC-SHA256';
}

/**
 * Configuration for request integrity verification
 */
export interface RequestIntegrityConfig {
  /** Whether request integrity verification is enabled */
  enabled: boolean;
  /** Secret key used for HMAC signing (minimum 32 characters) */
  secretKey: string;
  /** Maximum age of requests in milliseconds (default: 300000 = 5 minutes) */
  maxAgeMs: number;
  /** Storage backend for nonce tracking */
  nonceStore: 'memory' | 'redis';
  /** Time-to-live for nonces in milliseconds (default: 600000 = 10 minutes) */
  nonceTTLMs: number;
  /** Paths to exclude from integrity verification */
  excludePaths: string[];
  /** Clock skew tolerance in milliseconds (default: 60000 = 1 minute) */
  clockSkewMs?: number;
}

/**
 * Result of request integrity verification
 */
export interface IntegrityVerificationResult {
  /** Whether the request passed integrity verification */
  valid: boolean;
  /** Error message if verification failed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: IntegrityErrorCode;
}

/**
 * Error codes for integrity verification failures
 */
export type IntegrityErrorCode =
  | 'MISSING_SIGNATURE'
  | 'MISSING_TIMESTAMP'
  | 'MISSING_NONCE'
  | 'INVALID_TIMESTAMP'
  | 'REQUEST_TOO_OLD'
  | 'REQUEST_FROM_FUTURE'
  | 'INVALID_SIGNATURE'
  | 'REPLAY_DETECTED'
  | 'DISABLED';

/**
 * Input for signing a request
 */
export interface SignRequestInput {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request path (including query string if applicable) */
  path: string;
  /** Request body (optional, for POST/PUT/PATCH) */
  body?: string | object;
  /** Custom timestamp (optional, defaults to current time) */
  timestamp?: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration for request integrity
 */
export const DEFAULT_REQUEST_INTEGRITY_CONFIG: RequestIntegrityConfig = {
  enabled: true,
  secretKey: '',
  maxAgeMs: DEFAULT_MAX_AGE_MS,
  nonceStore: 'redis',
  nonceTTLMs: DEFAULT_NONCE_TTL_MS,
  excludePaths: [
    '/api/health',
    '/api/readiness',
    '/api/metrics',
    '/api/webhooks/*',
  ],
  clockSkewMs: 60000,
};

// =============================================================================
// In-Memory Nonce Store
// =============================================================================

/**
 * Simple in-memory nonce store for development/testing
 */
class MemoryNonceStore {
  private nonces: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(cleanupIntervalMs: number = 60000) {
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    // Prevent the interval from keeping the process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Check if a nonce exists (has been used)
   */
  has(nonce: string): boolean {
    const expiry = this.nonces.get(nonce);
    if (expiry === undefined) {
      return false;
    }
    if (Date.now() > expiry) {
      this.nonces.delete(nonce);
      return false;
    }
    return true;
  }

  /**
   * Record a nonce with its expiry time
   */
  set(nonce: string, ttlMs: number): void {
    this.nonces.set(nonce, Date.now() + ttlMs);
  }

  /**
   * Remove expired nonces
   */
  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.nonces.entries());
    for (const [nonce, expiry] of entries) {
      if (now > expiry) {
        this.nonces.delete(nonce);
      }
    }
  }

  /**
   * Clear all nonces and stop cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.nonces.clear();
  }

  /**
   * Get the number of stored nonces (for testing/debugging)
   */
  size(): number {
    return this.nonces.size;
  }
}

// =============================================================================
// RequestIntegrity Class
// =============================================================================

/**
 * Request Integrity Service
 *
 * Provides HMAC-SHA256 request signing and verification with replay attack
 * prevention using nonce tracking.
 *
 * @example
 * ```typescript
 * const integrity = new RequestIntegrity({
 *   secretKey: process.env.REQUEST_SIGNING_KEY,
 *   maxAgeMs: 300000,
 *   nonceStore: 'redis',
 * });
 *
 * // Sign a request
 * const signed = integrity.signRequest({
 *   method: 'POST',
 *   path: '/api/sensitive-action',
 *   body: { action: 'transfer', amount: 1000 },
 * });
 *
 * // Verify a request in middleware
 * fastify.addHook('preHandler', integrity.middleware());
 * ```
 */
export class RequestIntegrity {
  private readonly config: RequestIntegrityConfig;
  private readonly redis: Redis | null;
  private readonly memoryStore: MemoryNonceStore | null;

  /**
   * Creates a new RequestIntegrity instance
   *
   * @param config - Configuration options
   * @param redis - Optional Redis instance (uses shared instance if not provided)
   * @throws {Error} If secret key is not provided or too short
   */
  constructor(config: Partial<RequestIntegrityConfig> = {}, redis?: Redis) {
    this.config = { ...DEFAULT_REQUEST_INTEGRITY_CONFIG, ...config };

    // Validate secret key
    if (!this.config.secretKey || this.config.secretKey.length < 32) {
      throw new Error(
        'Request integrity secret key must be provided and at least 32 characters long'
      );
    }

    // Initialize nonce store
    if (this.config.nonceStore === 'redis') {
      this.redis = redis ?? getRedis();
      this.memoryStore = null;
    } else {
      this.redis = null;
      this.memoryStore = new MemoryNonceStore();
    }

    logger.info(
      {
        enabled: this.config.enabled,
        maxAgeMs: this.config.maxAgeMs,
        nonceStore: this.config.nonceStore,
        nonceTTLMs: this.config.nonceTTLMs,
        excludePaths: this.config.excludePaths.length,
      },
      'RequestIntegrity initialized'
    );
  }

  /**
   * Signs a request and returns the signature metadata
   *
   * The signature is computed as:
   * HMAC-SHA256(method + path + body + timestamp + nonce, secretKey)
   *
   * @param input - Request data to sign
   * @returns Signed request metadata
   */
  signRequest(input: SignRequestInput): SignedRequest {
    const timestamp = input.timestamp ?? Date.now();
    const nonce = this.generateNonce();
    const bodyString = this.normalizeBody(input.body);

    // Create signature data
    const signatureData = this.createSignatureData(
      input.method.toUpperCase(),
      input.path,
      bodyString,
      timestamp,
      nonce
    );

    // Generate signature
    const signature = this.createSignature(signatureData);

    logger.debug(
      {
        method: input.method,
        path: input.path,
        timestamp,
        noncePrefix: nonce.substring(0, 8),
      },
      'Request signed'
    );

    return {
      timestamp,
      nonce,
      signature,
      algorithm: 'HMAC-SHA256',
    };
  }

  /**
   * Verifies request integrity and checks for replay attacks
   *
   * Performs the following checks:
   * 1. Required headers are present
   * 2. Timestamp is within acceptable range
   * 3. Signature is valid
   * 4. Nonce has not been used before
   *
   * @param request - Fastify request object
   * @param signature - Signature metadata from headers
   * @returns Verification result
   */
  async verifyRequest(
    request: FastifyRequest,
    signature: SignedRequest
  ): Promise<IntegrityVerificationResult> {
    // Check if enabled
    if (!this.config.enabled) {
      return { valid: false, error: 'Request integrity disabled', errorCode: 'DISABLED' };
    }

    // Validate timestamp
    const timestampResult = this.validateTimestamp(signature.timestamp);
    if (!timestampResult.valid) {
      logger.warn(
        {
          timestamp: signature.timestamp,
          error: timestampResult.error,
          ip: request.ip,
          path: request.url,
        },
        'Request integrity failed: timestamp validation'
      );
      return timestampResult;
    }

    // Check for replay attack
    const isReplay = await this.isReplay(signature.nonce);
    if (isReplay) {
      logger.warn(
        {
          noncePrefix: signature.nonce.substring(0, 8),
          ip: request.ip,
          path: request.url,
        },
        'Request integrity failed: replay detected'
      );
      return {
        valid: false,
        error: 'Replay attack detected: nonce already used',
        errorCode: 'REPLAY_DETECTED',
      };
    }

    // Verify signature
    const method = request.method.toUpperCase();
    const path = request.url;
    const bodyString = this.normalizeBody(request.body as string | object | undefined);

    const expectedData = this.createSignatureData(
      method,
      path,
      bodyString,
      signature.timestamp,
      signature.nonce
    );
    const expectedSignature = this.createSignature(expectedData);

    const signatureValid = this.constantTimeCompare(
      signature.signature,
      expectedSignature
    );

    if (!signatureValid) {
      logger.warn(
        {
          method,
          path,
          ip: request.ip,
        },
        'Request integrity failed: invalid signature'
      );
      return {
        valid: false,
        error: 'Invalid request signature',
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    // Record nonce to prevent replay
    await this.recordNonce(signature.nonce);

    logger.debug(
      {
        method,
        path,
        timestamp: signature.timestamp,
      },
      'Request integrity verified'
    );

    return { valid: true };
  }

  /**
   * Creates Fastify middleware for request integrity verification
   *
   * @returns Fastify preHandler hook function
   */
  middleware(): preHandlerHookHandler {
    return async (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      // Skip if disabled
      if (!this.config.enabled) {
        return;
      }

      // Check excluded paths
      if (this.isPathExcluded(request.url)) {
        logger.debug({ path: request.url }, 'Request integrity skipped: excluded path');
        return;
      }

      // Extract signature headers
      const signatureHeader = request.headers[SIGNATURE_HEADER];
      const timestampHeader = request.headers[TIMESTAMP_HEADER];
      const nonceHeader = request.headers[NONCE_HEADER];
      const algorithmHeader = request.headers[ALGORITHM_HEADER];

      // Validate required headers
      if (!signatureHeader || typeof signatureHeader !== 'string') {
        logger.warn({ path: request.url, ip: request.ip }, 'Missing signature header');
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing request signature',
          code: 'MISSING_SIGNATURE',
        });
        return;
      }

      if (!timestampHeader || typeof timestampHeader !== 'string') {
        logger.warn({ path: request.url, ip: request.ip }, 'Missing timestamp header');
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing request timestamp',
          code: 'MISSING_TIMESTAMP',
        });
        return;
      }

      if (!nonceHeader || typeof nonceHeader !== 'string') {
        logger.warn({ path: request.url, ip: request.ip }, 'Missing nonce header');
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing request nonce',
          code: 'MISSING_NONCE',
        });
        return;
      }

      // Parse timestamp
      const timestamp = parseInt(timestampHeader, 10);
      if (isNaN(timestamp)) {
        logger.warn({ path: request.url, ip: request.ip, timestampHeader }, 'Invalid timestamp');
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid request timestamp',
          code: 'INVALID_TIMESTAMP',
        });
        return;
      }

      // Build signature object
      const signedRequest: SignedRequest = {
        timestamp,
        nonce: nonceHeader,
        signature: signatureHeader,
        algorithm: (algorithmHeader as 'HMAC-SHA256') || 'HMAC-SHA256',
      };

      // Verify request
      const result = await this.verifyRequest(request, signedRequest);

      if (!result.valid) {
        const statusCode = result.errorCode === 'REPLAY_DETECTED' ? 409 : 401;
        reply.code(statusCode).send({
          error: statusCode === 409 ? 'Conflict' : 'Unauthorized',
          message: result.error,
          code: result.errorCode,
        });
        return;
      }

      // Mark request as verified
      (request as FastifyRequest & { integrityVerified?: boolean }).integrityVerified = true;
    };
  }

  /**
   * Checks if a nonce has already been used
   *
   * @param nonce - The nonce to check
   * @returns True if the nonce has been used (replay attack)
   */
  async isReplay(nonce: string): Promise<boolean> {
    if (this.redis) {
      const key = `${NONCE_PREFIX}${nonce}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    }

    if (this.memoryStore) {
      return this.memoryStore.has(nonce);
    }

    return false;
  }

  /**
   * Records a nonce to prevent replay attacks
   *
   * @param nonce - The nonce to record
   */
  async recordNonce(nonce: string): Promise<void> {
    const ttlSeconds = Math.ceil(this.config.nonceTTLMs / 1000);

    if (this.redis) {
      const key = `${NONCE_PREFIX}${nonce}`;
      await this.redis.setex(key, ttlSeconds, '1');
      return;
    }

    if (this.memoryStore) {
      this.memoryStore.set(nonce, this.config.nonceTTLMs);
      return;
    }
  }

  /**
   * Gets the current configuration
   *
   * @returns A copy of the current configuration (with secret redacted)
   */
  getConfig(): Omit<RequestIntegrityConfig, 'secretKey'> & { secretKey: string } {
    return {
      ...this.config,
      secretKey: this.config.secretKey ? '[REDACTED]' : '',
    };
  }

  /**
   * Checks if the service is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Cleans up resources (call when shutting down)
   */
  destroy(): void {
    if (this.memoryStore) {
      this.memoryStore.destroy();
    }
    logger.debug('RequestIntegrity destroyed');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generates a cryptographically secure nonce
   */
  private generateNonce(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Normalizes request body for signing
   */
  private normalizeBody(body: string | object | undefined): string {
    if (!body) {
      return '';
    }
    if (typeof body === 'string') {
      return body;
    }
    // Canonical JSON serialization (sorted keys)
    return JSON.stringify(body, Object.keys(body).sort());
  }

  /**
   * Creates the data string for signing
   */
  private createSignatureData(
    method: string,
    path: string,
    body: string,
    timestamp: number,
    nonce: string
  ): string {
    return `${method}\n${path}\n${body}\n${timestamp}\n${nonce}`;
  }

  /**
   * Creates an HMAC-SHA256 signature
   */
  private createSignature(data: string): string {
    return createHmac('sha256', this.config.secretKey)
      .update(data)
      .digest('hex');
  }

  /**
   * Validates request timestamp
   */
  private validateTimestamp(timestamp: number): IntegrityVerificationResult {
    const now = Date.now();
    const clockSkew = this.config.clockSkewMs ?? 60000;

    // Check if timestamp is valid
    if (isNaN(timestamp) || timestamp <= 0) {
      return {
        valid: false,
        error: 'Invalid timestamp format',
        errorCode: 'INVALID_TIMESTAMP',
      };
    }

    // Check if request is too old
    const age = now - timestamp;
    if (age > this.config.maxAgeMs) {
      return {
        valid: false,
        error: `Request too old: ${Math.round(age / 1000)}s (max: ${Math.round(this.config.maxAgeMs / 1000)}s)`,
        errorCode: 'REQUEST_TOO_OLD',
      };
    }

    // Check for future timestamp (with clock skew tolerance)
    if (timestamp > now + clockSkew) {
      return {
        valid: false,
        error: 'Request timestamp is in the future',
        errorCode: 'REQUEST_FROM_FUTURE',
      };
    }

    return { valid: true };
  }

  /**
   * Performs constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    try {
      const bufferA = Buffer.from(a);
      const bufferB = Buffer.from(b);

      if (bufferA.length !== bufferB.length) {
        return false;
      }

      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  /**
   * Checks if a path should be excluded from verification
   */
  private isPathExcluded(url: string): boolean {
    // Extract path without query string
    const path = url.split('?')[0];

    return this.config.excludePaths.some((excludePath) => {
      // Support glob-like patterns with *
      if (excludePath.includes('*')) {
        const regex = new RegExp(
          '^' + excludePath.replace(/\*/g, '.*') + '$'
        );
        return regex.test(path);
      }
      // Exact match or prefix match (for paths ending with /)
      return path === excludePath || path.startsWith(excludePath + '/');
    });
  }
}

// =============================================================================
// Fastify Request Type Extension
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    /** Whether request integrity has been verified */
    integrityVerified?: boolean;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let requestIntegrityInstance: RequestIntegrity | null = null;

/**
 * Gets or creates the singleton RequestIntegrity instance
 *
 * Creates the instance on first call using configuration from environment.
 * Subsequent calls return the same instance.
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The RequestIntegrity singleton instance
 * @throws {Error} If secret key is not configured
 *
 * @example
 * ```typescript
 * // Initialize with custom config
 * const integrity = getRequestIntegrity({
 *   secretKey: process.env.REQUEST_SIGNING_KEY,
 *   maxAgeMs: 300000,
 * });
 *
 * // Register middleware
 * fastify.addHook('preHandler', integrity.middleware());
 *
 * // Later, get the same instance
 * const sameIntegrity = getRequestIntegrity();
 * ```
 */
export function getRequestIntegrity(
  config?: Partial<RequestIntegrityConfig>
): RequestIntegrity {
  if (!requestIntegrityInstance) {
    const secretKey =
      config?.secretKey ??
      process.env['VORION_REQUEST_SIGNING_KEY'] ??
      process.env['REQUEST_SIGNING_KEY'] ??
      '';

    const integrityConfig: Partial<RequestIntegrityConfig> = {
      ...config,
      secretKey,
      enabled: config?.enabled ?? process.env['VORION_REQUEST_INTEGRITY_ENABLED'] !== 'false',
    };

    requestIntegrityInstance = new RequestIntegrity(integrityConfig);
    logger.info('RequestIntegrity singleton initialized');
  }

  return requestIntegrityInstance;
}

/**
 * Resets the singleton instance (useful for testing)
 *
 * @internal
 */
export function resetRequestIntegrity(): void {
  if (requestIntegrityInstance) {
    requestIntegrityInstance.destroy();
    requestIntegrityInstance = null;
  }
  logger.debug('RequestIntegrity singleton reset');
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates request signing headers from a SignedRequest
 *
 * @param signed - The signed request metadata
 * @returns Headers object to add to the request
 *
 * @example
 * ```typescript
 * const integrity = getRequestIntegrity();
 * const signed = integrity.signRequest({
 *   method: 'POST',
 *   path: '/api/transfer',
 *   body: { amount: 1000 },
 * });
 *
 * const headers = createSignatureHeaders(signed);
 * // Use headers in fetch or HTTP client
 * fetch('/api/transfer', {
 *   method: 'POST',
 *   headers: {
 *     ...headers,
 *     'Content-Type': 'application/json',
 *   },
 *   body: JSON.stringify({ amount: 1000 }),
 * });
 * ```
 */
export function createSignatureHeaders(
  signed: SignedRequest
): Record<string, string> {
  return {
    [SIGNATURE_HEADER]: signed.signature,
    [TIMESTAMP_HEADER]: signed.timestamp.toString(),
    [NONCE_HEADER]: signed.nonce,
    [ALGORITHM_HEADER]: signed.algorithm,
  };
}

/**
 * Extracts signature metadata from request headers
 *
 * @param headers - Request headers object
 * @returns SignedRequest or null if headers are missing/invalid
 */
export function extractSignatureFromHeaders(
  headers: Record<string, string | string[] | undefined>
): SignedRequest | null {
  const signature = headers[SIGNATURE_HEADER];
  const timestamp = headers[TIMESTAMP_HEADER];
  const nonce = headers[NONCE_HEADER];
  const algorithm = headers[ALGORITHM_HEADER];

  if (
    typeof signature !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string'
  ) {
    return null;
  }

  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum)) {
    return null;
  }

  return {
    signature,
    timestamp: timestampNum,
    nonce,
    algorithm: (algorithm as 'HMAC-SHA256') || 'HMAC-SHA256',
  };
}

/**
 * Header names used for request signing
 */
export const INTEGRITY_HEADERS = {
  SIGNATURE: SIGNATURE_HEADER,
  TIMESTAMP: TIMESTAMP_HEADER,
  NONCE: NONCE_HEADER,
  ALGORITHM: ALGORITHM_HEADER,
} as const;

export default RequestIntegrity;
