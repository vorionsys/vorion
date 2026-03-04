/**
 * CSRF Protection System for Vorion Platform
 *
 * Implements double-submit cookie pattern with HMAC-signed tokens
 * for protection against Cross-Site Request Forgery attacks.
 *
 * @module security/csrf
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';

const logger = createLogger({ component: 'csrf' });

/**
 * Cookie options for CSRF token cookie
 */
export interface CSRFCookieOptions {
  /** Whether the cookie should only be sent over HTTPS */
  secure: boolean;
  /** Whether the cookie is inaccessible to JavaScript */
  httpOnly: boolean;
  /** SameSite attribute for the cookie */
  sameSite: 'strict' | 'lax' | 'none';
  /** Cookie path */
  path?: string;
  /** Cookie domain */
  domain?: string;
  /** Max age in seconds */
  maxAge?: number;
}

/**
 * Configuration interface for CSRF protection
 */
export interface CSRFConfig {
  /** Length of the random token component in bytes (default: 32) */
  tokenLength: number;
  /** Name of the CSRF cookie (default: '__vorion_csrf') */
  cookieName: string;
  /** Name of the header containing the CSRF token (default: 'X-CSRF-Token') */
  headerName: string;
  /** Cookie configuration options */
  cookieOptions: CSRFCookieOptions;
  /** Array of path patterns to exclude from CSRF protection (e.g., webhooks) */
  excludePaths: string[];
  /** HTTP methods to exclude from CSRF validation (default: ['GET', 'HEAD', 'OPTIONS']) */
  excludeMethods: string[];
  /** Secret key for HMAC signing (should be loaded from environment) */
  secret: string;
  /** Token validity duration in milliseconds (default: 1 hour) */
  tokenTTL: number;
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Parsed token components
 */
interface ParsedToken {
  sessionId: string;
  timestamp: number;
  random: string;
  signature: string;
}

/**
 * Default CSRF configuration
 */
const DEFAULT_CONFIG: CSRFConfig = {
  tokenLength: 32,
  cookieName: '__vorion_csrf',
  headerName: 'X-CSRF-Token',
  cookieOptions: {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 3600, // 1 hour
  },
  excludePaths: [],
  excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
  secret: '',
  tokenTTL: 3600000, // 1 hour in milliseconds
};

/**
 * CSRF Protection class implementing double-submit cookie pattern
 * with HMAC-signed tokens for secure request validation.
 *
 * @example
 * ```typescript
 * const csrf = new CSRFProtection({
 *   secret: process.env.CSRF_SECRET,
 *   excludePaths: ['/api/webhooks'],
 * });
 *
 * // Register middleware
 * fastify.addHook('preHandler', csrf.createMiddleware());
 *
 * // Generate token for a session
 * const token = csrf.generateToken('session-123');
 * ```
 */
export class CSRFProtection {
  private readonly config: CSRFConfig;

  /**
   * Creates a new CSRFProtection instance
   *
   * @param config - Partial configuration object (merged with defaults)
   * @throws {Error} If secret is not provided or is too short
   */
  constructor(config: Partial<CSRFConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Merge cookie options separately to preserve defaults
    if (config.cookieOptions) {
      this.config.cookieOptions = {
        ...DEFAULT_CONFIG.cookieOptions,
        ...config.cookieOptions,
      };
    }

    // Validate secret
    if (!this.config.secret || this.config.secret.length < 32) {
      throw new Error(
        'CSRF secret must be provided and at least 32 characters long'
      );
    }

    logger.debug('CSRF protection initialized', {
      cookieName: this.config.cookieName,
      headerName: this.config.headerName,
      excludePaths: this.config.excludePaths,
      excludeMethods: this.config.excludeMethods,
    });
  }

  /**
   * Generates a cryptographically secure CSRF token
   *
   * Token format: base64(sessionId.timestamp.random.signature)
   * where signature = HMAC-SHA256(sessionId + timestamp + random, secret)
   *
   * @param sessionId - The session identifier to bind the token to
   * @returns A signed CSRF token string
   */
  generateToken(sessionId: string = ''): string {
    const timestamp = Date.now();
    const random = randomBytes(this.config.tokenLength).toString('hex');

    // Create the data to sign
    const data = `${sessionId}.${timestamp}.${random}`;

    // Generate HMAC signature
    const signature = this.createSignature(data);

    // Combine all parts and encode
    const token = Buffer.from(`${data}.${signature}`).toString('base64url');

    logger.debug('Generated CSRF token', {
      sessionId: sessionId ? `${sessionId.substring(0, 8)}...` : 'none',
      timestamp,
    });

    return token;
  }

  /**
   * Validates a CSRF token against the cookie token
   *
   * Performs the following checks:
   * 1. Both tokens are present and non-empty
   * 2. Tokens match exactly (timing-safe comparison)
   * 3. Token signature is valid
   * 4. Token has not expired
   *
   * @param token - The token from the request header
   * @param cookieToken - The token from the cookie
   * @returns Whether the token is valid
   */
  validateToken(token: string, cookieToken: string): boolean {
    const result = this.validateTokenWithDetails(token, cookieToken);
    return result.valid;
  }

  /**
   * Validates a CSRF token with detailed error information
   *
   * @param token - The token from the request header
   * @param cookieToken - The token from the cookie
   * @returns Validation result with error details if invalid
   */
  validateTokenWithDetails(
    token: string,
    cookieToken: string
  ): TokenValidationResult {
    // Check for presence
    if (!token || !cookieToken) {
      logger.warn('CSRF validation failed: missing token', {
        hasToken: !!token,
        hasCookieToken: !!cookieToken,
      });
      return { valid: false, error: 'Missing CSRF token' };
    }

    // Timing-safe comparison of the two tokens
    try {
      const tokenBuffer = Buffer.from(token);
      const cookieBuffer = Buffer.from(cookieToken);

      if (tokenBuffer.length !== cookieBuffer.length) {
        logger.warn('CSRF validation failed: token length mismatch');
        return { valid: false, error: 'Invalid CSRF token' };
      }

      if (!timingSafeEqual(tokenBuffer, cookieBuffer)) {
        logger.warn('CSRF validation failed: token mismatch');
        return { valid: false, error: 'Invalid CSRF token' };
      }
    } catch (error) {
      logger.warn('CSRF validation failed: comparison error', { error });
      return { valid: false, error: 'Invalid CSRF token' };
    }

    // Parse and verify the token
    const parsed = this.parseToken(token);
    if (!parsed) {
      logger.warn('CSRF validation failed: unable to parse token');
      return { valid: false, error: 'Malformed CSRF token' };
    }

    // Verify signature
    const data = `${parsed.sessionId}.${parsed.timestamp}.${parsed.random}`;
    const expectedSignature = this.createSignature(data);

    try {
      const sigBuffer = Buffer.from(parsed.signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        logger.warn('CSRF validation failed: invalid signature');
        return { valid: false, error: 'Invalid CSRF token signature' };
      }
    } catch (error) {
      logger.warn('CSRF validation failed: signature comparison error', {
        error,
      });
      return { valid: false, error: 'Invalid CSRF token' };
    }

    // Check expiration
    const age = Date.now() - parsed.timestamp;
    if (age > this.config.tokenTTL) {
      logger.warn('CSRF validation failed: token expired', {
        age,
        ttl: this.config.tokenTTL,
      });
      return { valid: false, error: 'CSRF token expired' };
    }

    // Check for future timestamps (clock skew tolerance of 60 seconds)
    if (age < -60000) {
      logger.warn('CSRF validation failed: token from future', {
        timestamp: parsed.timestamp,
        now: Date.now(),
      });
      return { valid: false, error: 'Invalid CSRF token timestamp' };
    }

    logger.debug('CSRF token validated successfully');
    return { valid: true };
  }

  /**
   * Creates a Fastify preHandler middleware for CSRF protection
   *
   * The middleware:
   * - Skips validation for excluded paths and methods
   * - Sets the CSRF cookie on all responses
   * - Validates the token from header against cookie on state-changing requests
   * - Returns 403 Forbidden on validation failure
   *
   * @returns Fastify preHandler hook function
   */
  createMiddleware(): preHandlerHookHandler {
    return async (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      const { method, url } = request;

      // Check if method is excluded
      if (this.config.excludeMethods.includes(method.toUpperCase())) {
        logger.debug('CSRF check skipped: excluded method', { method, url });
        await this.setCSRFCookie(request, reply);
        return;
      }

      // Check if path is excluded
      if (this.isPathExcluded(url)) {
        logger.debug('CSRF check skipped: excluded path', { method, url });
        return;
      }

      // Get tokens
      const headerToken = this.getTokenFromHeader(request);
      const cookieToken = this.getTokenFromCookie(request);

      // Validate tokens
      const validationResult = this.validateTokenWithDetails(
        headerToken,
        cookieToken
      );

      if (!validationResult.valid) {
        logger.warn('CSRF validation failed', {
          method,
          url,
          error: validationResult.error,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });

        reply.code(403).send({
          error: 'Forbidden',
          message: validationResult.error || 'CSRF validation failed',
          statusCode: 403,
        });
        return;
      }

      // Set new cookie for token rotation
      await this.setCSRFCookie(request, reply);

      logger.debug('CSRF validation passed', { method, url });
    };
  }

  /**
   * Gets the current configuration
   *
   * @returns A copy of the current configuration
   */
  getConfig(): Readonly<CSRFConfig> {
    return { ...this.config };
  }

  /**
   * Creates an HMAC-SHA256 signature
   *
   * @param data - Data to sign
   * @returns Hex-encoded signature
   */
  private createSignature(data: string): string {
    return createHmac('sha256', this.config.secret).update(data).digest('hex');
  }

  /**
   * Parses a token string into its components
   *
   * @param token - The base64url-encoded token
   * @returns Parsed token components or null if invalid
   */
  private parseToken(token: string): ParsedToken | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split('.');

      if (parts.length !== 4) {
        return null;
      }

      const [sessionId, timestampStr, random, signature] = parts;
      const timestamp = parseInt(timestampStr, 10);

      if (isNaN(timestamp)) {
        return null;
      }

      return { sessionId, timestamp, random, signature };
    } catch {
      return null;
    }
  }

  /**
   * Checks if a path should be excluded from CSRF protection
   *
   * @param url - The request URL
   * @returns Whether the path is excluded
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

  /**
   * Extracts the CSRF token from the request header
   *
   * @param request - Fastify request object
   * @returns The token string or empty string if not found
   */
  private getTokenFromHeader(request: FastifyRequest): string {
    const token = request.headers[this.config.headerName.toLowerCase()];
    return typeof token === 'string' ? token : '';
  }

  /**
   * Extracts the CSRF token from the cookie
   *
   * @param request - Fastify request object
   * @returns The token string or empty string if not found
   */
  private getTokenFromCookie(request: FastifyRequest): string {
    // Fastify with @fastify/cookie plugin adds cookies to request
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    if (cookies && typeof cookies[this.config.cookieName] === 'string') {
      return cookies[this.config.cookieName];
    }

    // Fallback: parse cookie header manually
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return '';
    }

    const cookies_parsed = cookieHeader.split(';').reduce(
      (acc, cookie) => {
        const [name, ...valueParts] = cookie.trim().split('=');
        if (name) {
          acc[name] = valueParts.join('=');
        }
        return acc;
      },
      {} as Record<string, string>
    );

    return cookies_parsed[this.config.cookieName] || '';
  }

  /**
   * Sets the CSRF cookie on the response
   *
   * @param request - Fastify request object
   * @param reply - Fastify reply object
   */
  private async setCSRFCookie(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Extract session ID if available (from session plugin or auth)
    const sessionId = this.extractSessionId(request);

    // Generate new token
    const token = this.generateToken(sessionId);

    // Set cookie using Fastify's setCookie if available, otherwise set header
    const setCookie = (reply as FastifyReply & { setCookie?: Function }).setCookie;
    if (typeof setCookie === 'function') {
      setCookie.call(reply, this.config.cookieName, token, {
        secure: this.config.cookieOptions.secure,
        httpOnly: this.config.cookieOptions.httpOnly,
        sameSite: this.config.cookieOptions.sameSite,
        path: this.config.cookieOptions.path,
        domain: this.config.cookieOptions.domain,
        maxAge: this.config.cookieOptions.maxAge,
      });
    } else {
      // Fallback: set cookie header manually
      const cookieParts = [
        `${this.config.cookieName}=${token}`,
        `Path=${this.config.cookieOptions.path || '/'}`,
        `SameSite=${this.config.cookieOptions.sameSite}`,
      ];

      if (this.config.cookieOptions.secure) {
        cookieParts.push('Secure');
      }
      if (this.config.cookieOptions.httpOnly) {
        cookieParts.push('HttpOnly');
      }
      if (this.config.cookieOptions.maxAge) {
        cookieParts.push(`Max-Age=${this.config.cookieOptions.maxAge}`);
      }
      if (this.config.cookieOptions.domain) {
        cookieParts.push(`Domain=${this.config.cookieOptions.domain}`);
      }

      reply.header('Set-Cookie', cookieParts.join('; '));
    }

    logger.debug('CSRF cookie set', {
      cookieName: this.config.cookieName,
      hasSession: !!sessionId,
    });
  }

  /**
   * Attempts to extract session ID from request
   *
   * @param request - Fastify request object
   * @returns Session ID or empty string
   */
  private extractSessionId(request: FastifyRequest): string {
    // Check for session from @fastify/session or similar
    const session = (request as FastifyRequest & { session?: { id?: string; sessionId?: string } }).session;
    if (session?.id) {
      return session.id;
    }
    if (session?.sessionId) {
      return session.sessionId;
    }

    // Check for user ID from authentication
    const user = (request as FastifyRequest & { user?: { id?: string } }).user;
    if (user?.id) {
      return user.id;
    }

    // No session available
    return '';
  }
}

// Singleton instance
let csrfInstance: CSRFProtection | null = null;

/**
 * Gets the singleton CSRFProtection instance
 *
 * Creates the instance on first call using configuration from getConfig().
 * Subsequent calls return the same instance.
 *
 * @returns The CSRFProtection singleton instance
 * @throws {Error} If CSRF secret is not configured
 *
 * @example
 * ```typescript
 * const csrf = getCSRFProtection();
 * fastify.addHook('preHandler', csrf.createMiddleware());
 * ```
 */
export function getCSRFProtection(): CSRFProtection {
  if (!csrfInstance) {
    const appConfig = getConfig();

    // Extract CSRF configuration from environment and defaults
    const csrfConfig: Partial<CSRFConfig> = {
      secret: process.env['VORION_CSRF_SECRET'] ?? process.env['CSRF_SECRET'] ?? '',
      excludePaths: [
        '/api/webhooks/*',
        '/api/health',
        '/api/readiness',
        '/api/metrics',
      ],
      cookieOptions: {
        secure: appConfig.env === 'production',
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 3600,
      },
    };

    csrfInstance = new CSRFProtection(csrfConfig);
    logger.info('CSRF protection singleton initialized');
  }

  return csrfInstance;
}

/**
 * Resets the singleton instance (useful for testing)
 *
 * @internal
 */
export function resetCSRFProtection(): void {
  csrfInstance = null;
  logger.debug('CSRF protection singleton reset');
}

/**
 * Type declaration for extending Fastify request with CSRF-related properties
 */
declare module 'fastify' {
  interface FastifyRequest {
    csrfToken?: string;
  }
}

export default CSRFProtection;
