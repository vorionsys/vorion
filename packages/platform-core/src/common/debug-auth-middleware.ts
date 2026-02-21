/**
 * Debug Authentication Middleware
 *
 * Secures debug endpoints by:
 * - Restricting access to localhost only (127.0.0.1)
 * - Requiring a debug authentication token
 * - Logging all access attempts
 *
 * @packageDocumentation
 */

import { createLogger } from './logger.js';
import { getSecurityConfig, getSecurityMode, isDevelopmentMode } from './security-mode.js';
import { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';

const logger = createLogger({ component: 'debug-auth' });

/**
 * Debug token configuration
 */
export interface DebugTokenConfig {
  /** The debug token (from environment variable) */
  token: string;
  /** Token header name */
  headerName?: string;
}

/**
 * Debug endpoint access result
 */
export interface DebugAccessResult {
  allowed: boolean;
  reason?: string;
  clientIp?: string;
  requestId?: string;
}

/**
 * Default header name for debug token
 */
const DEFAULT_DEBUG_TOKEN_HEADER = 'X-Debug-Token';

/**
 * Environment variable name for debug token
 */
const DEBUG_TOKEN_ENV_VAR = 'VORION_DEBUG_TOKEN';

/**
 * Allowed localhost addresses
 */
const LOCALHOST_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
]);

/**
 * Get the configured debug token from environment
 *
 * @returns The debug token or null if not configured
 */
export function getDebugToken(): string | null {
  const token = process.env[DEBUG_TOKEN_ENV_VAR];
  if (!token || token.trim() === '') {
    return null;
  }
  return token;
}

/**
 * Extract client IP address from request
 *
 * Handles various proxy headers and direct connections
 */
export function getClientIp(req: IncomingMessage): string {
  // Check for forwarded headers (in order of preference)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first (original client)
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0];
    return ips?.trim() || 'unknown';
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to socket remote address
  const socketAddress = req.socket?.remoteAddress;
  if (socketAddress) {
    return socketAddress;
  }

  return 'unknown';
}

/**
 * Check if the request is from localhost
 */
export function isLocalhost(clientIp: string): boolean {
  // Normalize IPv6-mapped IPv4 addresses
  const normalizedIp = clientIp.replace(/^::ffff:/, '');
  return LOCALHOST_ADDRESSES.has(normalizedIp) || LOCALHOST_ADDRESSES.has(clientIp);
}

/**
 * Securely compare two strings using timing-safe comparison
 */
function secureCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Use Buffer for timing-safe comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Length must match for timingSafeEqual
  if (bufA.length !== bufB.length) {
    // Still perform comparison to avoid timing attack on length
    const paddedB = Buffer.alloc(bufA.length);
    bufB.copy(paddedB, 0, 0, Math.min(bufA.length, bufB.length));
    timingSafeEqual(bufA, paddedB);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate debug authentication token
 *
 * @param providedToken - Token provided in request
 * @param expectedToken - Expected token from configuration
 * @returns true if tokens match
 */
export function validateDebugToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }

  return secureCompare(providedToken, expectedToken);
}

/**
 * Check if debug endpoints are allowed for this request
 *
 * Validates:
 * 1. Debug endpoints are enabled in current security mode
 * 2. Request comes from localhost (if bind address is restricted)
 * 3. Valid debug token is provided (if required)
 *
 * @param req - The incoming HTTP request
 * @param requestId - Optional request ID for logging
 * @returns Access result indicating if request is allowed
 */
export function checkDebugAccess(
  req: IncomingMessage,
  requestId?: string
): DebugAccessResult {
  const config = getSecurityConfig();
  const mode = getSecurityMode();
  const clientIp = getClientIp(req);

  // Create base result
  const createResult = (allowed: boolean, reason?: string): DebugAccessResult => ({
    allowed,
    reason,
    clientIp,
    requestId,
  });

  // Check if debug endpoints are allowed
  if (!config.allowDebugEndpoints) {
    logger.warn(
      { clientIp, mode, requestId },
      'Debug endpoint access denied: debug endpoints disabled in current mode'
    );
    return createResult(false, `Debug endpoints are disabled in ${mode} mode`);
  }

  // Check localhost restriction (development mode)
  const bindAddress = config.debugEndpointBindAddress;
  if (bindAddress === '127.0.0.1' && !isLocalhost(clientIp)) {
    logger.warn(
      { clientIp, bindAddress, requestId },
      'Debug endpoint access denied: request not from localhost'
    );
    return createResult(false, 'Debug endpoints are only accessible from localhost');
  }

  // Check debug token authentication
  if (config.requireDebugAuth) {
    const expectedToken = getDebugToken();

    if (!expectedToken) {
      logger.error(
        { requestId },
        'Debug authentication required but VORION_DEBUG_TOKEN not configured'
      );
      return createResult(false, 'Debug authentication not configured');
    }

    const headerName = DEFAULT_DEBUG_TOKEN_HEADER.toLowerCase();
    const providedToken = req.headers[headerName] as string | undefined;

    if (!providedToken) {
      logger.warn(
        { clientIp, requestId },
        'Debug endpoint access denied: missing debug token'
      );
      return createResult(false, 'Debug authentication required');
    }

    if (!validateDebugToken(providedToken, expectedToken)) {
      logger.warn(
        { clientIp, requestId },
        'Debug endpoint access denied: invalid debug token'
      );
      return createResult(false, 'Invalid debug token');
    }
  }

  // Access granted - log successful access
  logger.info(
    { clientIp, mode, requestId, path: req.url },
    'Debug endpoint access granted'
  );

  return createResult(true);
}

/**
 * Express-style middleware for debug endpoint authentication
 *
 * @example
 * ```typescript
 * import { debugAuthMiddleware } from './debug-auth-middleware';
 *
 * app.use('/debug', debugAuthMiddleware);
 * app.get('/debug/info', (req, res) => {
 *   res.json({ status: 'ok' });
 * });
 * ```
 */
export function debugAuthMiddleware(
  req: IncomingMessage & { requestId?: string },
  res: ServerResponse,
  next: () => void
): void {
  const result = checkDebugAccess(req, req.requestId);

  if (!result.allowed) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: result.reason || 'Debug access denied',
      requestId: result.requestId,
    }));
    return;
  }

  next();
}

/**
 * Create a debug endpoint handler with built-in authentication
 *
 * @param handler - The actual debug handler to wrap
 * @returns Wrapped handler with authentication
 */
export function createSecureDebugHandler<T extends IncomingMessage>(
  handler: (req: T, res: ServerResponse) => void | Promise<void>
): (req: T, res: ServerResponse) => Promise<void> {
  return async (req: T, res: ServerResponse): Promise<void> => {
    const requestId = (req as T & { requestId?: string }).requestId;
    const result = checkDebugAccess(req, requestId);

    if (!result.allowed) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: result.reason || 'Debug access denied',
        requestId: result.requestId,
      }));
      return;
    }

    await handler(req, res);
  };
}

/**
 * Configuration for debug server binding
 *
 * Returns the appropriate bind address based on security mode
 */
export function getDebugBindAddress(): string {
  const config = getSecurityConfig();

  // Always bind to localhost in development (if configured)
  if (config.debugEndpointBindAddress) {
    return config.debugEndpointBindAddress;
  }

  // Default to localhost for safety
  if (isDevelopmentMode()) {
    return '127.0.0.1';
  }

  // In production/staging, debug endpoints should be disabled
  // but if they're somehow enabled, still bind to localhost
  logger.warn('Debug bind address requested in non-development mode, defaulting to localhost');
  return '127.0.0.1';
}

/**
 * Validate debug configuration at startup
 *
 * Checks that debug endpoints are properly configured
 */
export function validateDebugConfig(): { valid: boolean; warnings: string[] } {
  const config = getSecurityConfig();
  const mode = getSecurityMode();
  const warnings: string[] = [];

  if (config.allowDebugEndpoints) {
    // Check if debug token is configured when auth is required
    if (config.requireDebugAuth && !getDebugToken()) {
      warnings.push(
        `Debug authentication is required but ${DEBUG_TOKEN_ENV_VAR} is not set. ` +
        'Debug endpoints will be inaccessible.'
      );
    }

    // Warn if debug endpoints are enabled in staging/production
    if (mode === 'staging') {
      warnings.push(
        'Debug endpoints are enabled in staging mode. ' +
        'Consider disabling them for better security.'
      );
    } else if (mode === 'production') {
      warnings.push(
        'WARNING: Debug endpoints are enabled in production mode. ' +
        'This is a security risk and should be disabled.'
      );
    }

    // Check bind address configuration
    if (!config.debugEndpointBindAddress || config.debugEndpointBindAddress !== '127.0.0.1') {
      warnings.push(
        'Debug endpoints are not restricted to localhost. ' +
        'Set debugEndpointBindAddress to "127.0.0.1" for security.'
      );
    }
  }

  // Log warnings
  for (const warning of warnings) {
    logger.warn({ mode }, warning);
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Generate a secure debug token for configuration
 *
 * @returns A random 32-byte hex string suitable for use as debug token
 */
export function generateDebugToken(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(32).toString('hex');
}
