/**
 * Service Token Management
 *
 * JWT-based service tokens with short TTL for service-to-service authentication.
 * Tokens are issued after HMAC signature verification and provide time-limited access.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { VorionError, ValidationError } from '../../common/errors.js';

const logger = createLogger({ component: 'service-token' });

// =============================================================================
// TYPES AND SCHEMAS
// =============================================================================

/**
 * Standard JWT payload fields
 */
export interface JWTStandardClaims {
  /** Issued at (Unix timestamp) */
  iat?: number;
  /** Expiration (Unix timestamp) */
  exp?: number;
  /** JWT ID */
  jti?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Subject */
  sub?: string;
}

/**
 * Service token payload
 */
export interface ServiceTokenPayload extends JWTStandardClaims {
  /** Client ID */
  sub: string;
  /** Tenant ID */
  tid: string;
  /** Service name */
  svc: string;
  /** Permissions/scopes */
  permissions: string[];
  /** Token type indicator */
  type: 'service';
  /** IP address that requested the token */
  ip?: string;
}

export const serviceTokenPayloadSchema = z.object({
  sub: z.string(), // clientId
  tid: z.string().uuid(), // tenantId
  svc: z.string(), // service name
  permissions: z.array(z.string()),
  type: z.literal('service'),
  ip: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
  jti: z.string().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Service signature components
 */
export interface ServiceSignature {
  /** Unix timestamp when signature was created */
  timestamp: number;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Request body hash (SHA-256 of body, empty string if no body) */
  bodyHash: string;
  /** The signature itself */
  signature: string;
}

export const serviceSignatureSchema = z.object({
  timestamp: z.number().int().positive(),
  method: z.string().min(1),
  path: z.string().min(1),
  bodyHash: z.string(),
  signature: z.string().min(1),
});

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;
  /** The decoded payload if valid */
  payload?: ServiceTokenPayload;
  /** Error reason if invalid */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: 'EXPIRED' | 'INVALID_SIGNATURE' | 'INVALID_FORMAT' | 'REVOKED' | 'INVALID_ISSUER';
}

export const tokenVerificationResultSchema = z.object({
  valid: z.boolean(),
  payload: serviceTokenPayloadSchema.optional(),
  error: z.string().optional(),
  errorCode: z.enum(['EXPIRED', 'INVALID_SIGNATURE', 'INVALID_FORMAT', 'REVOKED', 'INVALID_ISSUER']).optional(),
});

/**
 * Signature verification result
 */
export interface SignatureVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;
  /** Client ID extracted from headers */
  clientId?: string;
  /** Error reason if invalid */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: 'EXPIRED' | 'INVALID_SIGNATURE' | 'INVALID_FORMAT' | 'CLOCK_SKEW' | 'MISSING_HEADERS';
}

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Service token error
 */
export class ServiceTokenError extends VorionError {
  override code = 'SERVICE_TOKEN_ERROR';
  override statusCode = 401;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ServiceTokenError';
  }
}

/**
 * Token expired error
 */
export class TokenExpiredError extends ServiceTokenError {
  override code = 'TOKEN_EXPIRED';

  constructor(expiredAt: Date) {
    super(`Token expired at ${expiredAt.toISOString()}`, { expiredAt: expiredAt.toISOString() });
    this.name = 'TokenExpiredError';
  }
}

/**
 * Invalid signature error
 */
export class InvalidSignatureError extends ServiceTokenError {
  override code = 'INVALID_SIGNATURE';

  constructor(reason: string) {
    super(`Invalid signature: ${reason}`, { reason });
    this.name = 'InvalidSignatureError';
  }
}

/**
 * Signature timestamp error (clock skew)
 */
export class SignatureTimestampError extends ServiceTokenError {
  override code = 'SIGNATURE_TIMESTAMP_ERROR';

  constructor(timestamp: number, currentTime: number, maxSkewSeconds: number) {
    super(
      `Signature timestamp outside allowed window (${maxSkewSeconds}s)`,
      { timestamp, currentTime, maxSkewSeconds }
    );
    this.name = 'SignatureTimestampError';
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default token TTL in seconds (5 minutes) */
export const DEFAULT_TOKEN_TTL_SECONDS = 300;

/** Maximum allowed clock skew for signature validation (5 minutes) */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/** Minimum token TTL in seconds */
export const MIN_TOKEN_TTL_SECONDS = 60;

/** Maximum token TTL in seconds (1 hour) */
export const MAX_TOKEN_TTL_SECONDS = 3600;

/** Service token issuer */
export const SERVICE_TOKEN_ISSUER = 'vorion:service-auth';

/** Header names for service authentication */
export const SERVICE_AUTH_HEADERS = {
  SERVICE_ID: 'x-service-id',
  SERVICE_SIGNATURE: 'x-service-signature',
  SERVICE_TIMESTAMP: 'x-service-timestamp',
} as const;

// =============================================================================
// JWT UTILITIES (Manual implementation to avoid ESM issues with jose)
// =============================================================================

/**
 * Base64url encode a string or buffer
 */
function base64urlEncode(input: string | Buffer): string {
  const buffer = typeof input === 'string' ? Buffer.from(input) : input;
  return buffer.toString('base64url');
}

/**
 * Base64url decode a string
 */
function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Create HMAC-SHA256 signature for JWT
 */
function createJWTSignature(headerB64: string, payloadB64: string, secret: Buffer): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${headerB64}.${payloadB64}`);
  return hmac.digest('base64url');
}

/**
 * Create a JWT token manually
 */
function createJWT(payload: Record<string, unknown>, secret: Buffer): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = createJWTSignature(headerB64, payloadB64, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
function verifyJWT(
  token: string,
  secret: Buffer,
  options?: { issuer?: string; audience?: string }
): { valid: boolean; payload?: Record<string, unknown>; error?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const expectedSignature = createJWTSignature(headerB64, payloadB64, secret);
    const providedSignatureBuffer = Buffer.from(signatureB64, 'base64url');
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

    if (providedSignatureBuffer.length !== expectedSignatureBuffer.length) {
      return { valid: false, error: 'Invalid signature' };
    }

    if (!timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Decode header
    const header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
    if (header.alg !== 'HS256') {
      return { valid: false, error: 'Unsupported algorithm' };
    }

    // Decode payload
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token has expired' };
    }

    // Check issuer
    if (options?.issuer && payload.iss !== options.issuer) {
      return { valid: false, error: 'Invalid issuer' };
    }

    // Check audience
    if (options?.audience) {
      const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!tokenAud.includes(options.audience)) {
        return { valid: false, error: 'Invalid audience' };
      }
    }

    return { valid: true, payload };
  } catch (error) {
    logger.warn({ error }, 'JWT verification failed');
    return { valid: false, error: 'Invalid token format' };
  }
}

// =============================================================================
// SERVICE TOKEN SERVICE
// =============================================================================

/**
 * Configuration for service token service
 */
export interface ServiceTokenServiceConfig {
  /** Secret key for signing tokens (32+ bytes recommended) */
  signingSecret: string;
  /** Token TTL in seconds */
  tokenTTL?: number;
  /** Token issuer */
  issuer?: string;
  /** Token audience */
  audience?: string;
  /** Maximum allowed clock skew for signatures in seconds */
  maxClockSkew?: number;
}

export const serviceTokenServiceConfigSchema = z.object({
  signingSecret: z.string().min(32),
  tokenTTL: z.number().int().min(MIN_TOKEN_TTL_SECONDS).max(MAX_TOKEN_TTL_SECONDS).optional(),
  issuer: z.string().optional(),
  audience: z.string().optional(),
  maxClockSkew: z.number().int().positive().optional(),
});

/**
 * Service token service for creating and verifying JWT tokens
 */
export class ServiceTokenService {
  private readonly signingKey: Buffer;
  private readonly tokenTTL: number;
  private readonly issuer: string;
  private readonly audience: string | undefined;
  private readonly maxClockSkew: number;

  constructor(config: ServiceTokenServiceConfig) {
    const validated = serviceTokenServiceConfigSchema.parse(config);

    this.signingKey = Buffer.from(validated.signingSecret, 'utf8');
    this.tokenTTL = validated.tokenTTL ?? DEFAULT_TOKEN_TTL_SECONDS;
    this.issuer = validated.issuer ?? SERVICE_TOKEN_ISSUER;
    this.audience = validated.audience;
    this.maxClockSkew = validated.maxClockSkew ?? MAX_CLOCK_SKEW_SECONDS;
  }

  /**
   * Create a service token
   */
  async createToken(params: {
    clientId: string;
    tenantId: string;
    serviceName: string;
    permissions: string[];
    ipAddress?: string;
    customTTL?: number;
  }): Promise<string> {
    const { clientId, tenantId, serviceName, permissions, ipAddress, customTTL } = params;

    const ttl = customTTL ?? this.tokenTTL;
    if (ttl < MIN_TOKEN_TTL_SECONDS || ttl > MAX_TOKEN_TTL_SECONDS) {
      throw new ValidationError(`Token TTL must be between ${MIN_TOKEN_TTL_SECONDS} and ${MAX_TOKEN_TTL_SECONDS} seconds`);
    }

    const now = Math.floor(Date.now() / 1000);
    const jti = randomBytes(16).toString('hex');

    const payload: ServiceTokenPayload = {
      sub: clientId,
      tid: tenantId,
      svc: serviceName,
      permissions,
      type: 'service',
      ip: ipAddress,
      iat: now,
      exp: now + ttl,
      jti,
      iss: this.issuer,
    };

    if (this.audience) {
      payload.aud = this.audience;
    }

    const token = createJWT(payload as unknown as Record<string, unknown>, this.signingKey);

    logger.debug(
      { clientId, tenantId, serviceName, jti, ttl },
      'Service token created'
    );

    return token;
  }

  /**
   * Verify and decode a service token
   */
  async verifyToken(token: string): Promise<TokenVerificationResult> {
    const result = verifyJWT(token, this.signingKey, {
      issuer: this.issuer,
      audience: this.audience,
    });

    if (!result.valid) {
      let errorCode: TokenVerificationResult['errorCode'] = 'INVALID_FORMAT';
      if (result.error?.includes('expired')) {
        errorCode = 'EXPIRED';
      } else if (result.error?.includes('signature')) {
        errorCode = 'INVALID_SIGNATURE';
      } else if (result.error?.includes('issuer')) {
        errorCode = 'INVALID_ISSUER';
      }

      return {
        valid: false,
        error: result.error,
        errorCode,
      };
    }

    try {
      // Validate payload structure
      const validatedPayload = serviceTokenPayloadSchema.parse(result.payload);

      // Check type
      if (validatedPayload.type !== 'service') {
        return {
          valid: false,
          error: 'Invalid token type',
          errorCode: 'INVALID_FORMAT',
        };
      }

      return {
        valid: true,
        payload: validatedPayload as ServiceTokenPayload,
      };
    } catch (error) {
      logger.warn({ error }, 'Token payload validation failed');
      return {
        valid: false,
        error: 'Invalid token payload',
        errorCode: 'INVALID_FORMAT',
      };
    }
  }

  /**
   * Create an HMAC signature for a request
   */
  createSignature(params: {
    clientSecret: string;
    timestamp: number;
    method: string;
    path: string;
    body?: string | Buffer;
  }): string {
    const { clientSecret, timestamp, method, path, body } = params;

    // Create message to sign: timestamp + method + path + body
    const bodyStr = body ? (Buffer.isBuffer(body) ? body.toString('utf8') : body) : '';
    const message = `${timestamp}.${method.toUpperCase()}.${path}.${bodyStr}`;

    // Create HMAC-SHA256 signature
    const hmac = createHmac('sha256', clientSecret);
    hmac.update(message);
    const signature = hmac.digest('hex');

    return signature;
  }

  /**
   * Verify a request signature
   */
  verifySignature(params: {
    clientSecret: string;
    providedSignature: string;
    timestamp: number;
    method: string;
    path: string;
    body?: string | Buffer;
  }): SignatureVerificationResult {
    const { clientSecret, providedSignature, timestamp, method, path, body } = params;

    // Check timestamp is within allowed window
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - timestamp);

    if (timeDiff > this.maxClockSkew) {
      return {
        valid: false,
        error: `Timestamp outside allowed window (${this.maxClockSkew}s)`,
        errorCode: 'CLOCK_SKEW',
      };
    }

    // Calculate expected signature
    const expectedSignature = this.createSignature({
      clientSecret,
      timestamp,
      method,
      path,
      body,
    });

    // Timing-safe comparison
    if (providedSignature.length !== expectedSignature.length) {
      return {
        valid: false,
        error: 'Invalid signature',
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    const providedBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (providedBuffer.length !== expectedBuffer.length) {
      return {
        valid: false,
        error: 'Invalid signature format',
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    const isValid = timingSafeEqual(providedBuffer, expectedBuffer);

    if (!isValid) {
      return {
        valid: false,
        error: 'Signature verification failed',
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    return { valid: true };
  }

  /**
   * Parse service auth headers from a request
   */
  parseAuthHeaders(headers: Record<string, string | string[] | undefined>): {
    clientId: string | null;
    signature: string | null;
    timestamp: number | null;
  } {
    const getHeader = (name: string): string | null => {
      const value = headers[name] ?? headers[name.toLowerCase()];
      if (Array.isArray(value)) {
        return value[0] ?? null;
      }
      return value ?? null;
    };

    const clientId = getHeader(SERVICE_AUTH_HEADERS.SERVICE_ID);
    const signature = getHeader(SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE);
    const timestampStr = getHeader(SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP);

    let timestamp: number | null = null;
    if (timestampStr) {
      const parsed = parseInt(timestampStr, 10);
      if (!isNaN(parsed)) {
        timestamp = parsed;
      }
    }

    return { clientId, signature, timestamp };
  }

  /**
   * Get token TTL
   */
  getTokenTTL(): number {
    return this.tokenTTL;
  }

  /**
   * Get max clock skew
   */
  getMaxClockSkew(): number {
    return this.maxClockSkew;
  }
}

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

let defaultTokenService: ServiceTokenService | null = null;

/**
 * Initialize the default service token service
 */
export function initializeServiceTokenService(config: ServiceTokenServiceConfig): ServiceTokenService {
  defaultTokenService = new ServiceTokenService(config);
  return defaultTokenService;
}

/**
 * Get the default service token service
 */
export function getServiceTokenService(): ServiceTokenService {
  if (!defaultTokenService) {
    throw new Error('ServiceTokenService not initialized. Call initializeServiceTokenService first.');
  }
  return defaultTokenService;
}

/**
 * Create a new service token service instance
 */
export function createServiceTokenService(config: ServiceTokenServiceConfig): ServiceTokenService {
  return new ServiceTokenService(config);
}

/**
 * Reset the singleton (for testing)
 */
export function resetServiceTokenService(): void {
  defaultTokenService = null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create signature headers for a request
 */
export function createServiceAuthHeaders(params: {
  clientId: string;
  clientSecret: string;
  method: string;
  path: string;
  body?: string | Buffer;
  tokenService?: ServiceTokenService;
}): Record<string, string> {
  const { clientId, clientSecret, method, path, body } = params;
  const tokenService = params.tokenService ?? getServiceTokenService();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = tokenService.createSignature({
    clientSecret,
    timestamp,
    method,
    path,
    body,
  });

  return {
    [SERVICE_AUTH_HEADERS.SERVICE_ID]: clientId,
    [SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE]: signature,
    [SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP]: timestamp.toString(),
  };
}

/**
 * Extract service ID from authorization header if present
 */
export function extractServiceIdFromBearer(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  // Try to decode the token to get the service ID
  // This is a lightweight check without verification
  try {
    const token = authHeader.slice(7);
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.type === 'service' && payload.sub) {
      return payload.sub;
    }
  } catch {
    // Invalid token format
  }

  return null;
}
