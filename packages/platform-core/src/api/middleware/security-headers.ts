/**
 * Security Headers Middleware
 *
 * Provides comprehensive security headers for HTTP responses including:
 * - Content Security Policy (CSP) with configurable directives
 * - Subresource Integrity (SRI) hash generation and validation
 * - Standard security headers (HSTS, X-Frame-Options, etc.)
 * - Nonce generation for inline scripts
 * - Environment-specific CSP configurations
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, createHash } from 'node:crypto';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'security-headers' });

// ============================================================================
// Types
// ============================================================================

/**
 * Content Security Policy directive configuration
 */
export interface CspDirectives {
  'default-src'?: string[];
  'script-src'?: string[];
  'style-src'?: string[];
  'img-src'?: string[];
  'font-src'?: string[];
  'connect-src'?: string[];
  'media-src'?: string[];
  'object-src'?: string[];
  'frame-src'?: string[];
  'frame-ancestors'?: string[];
  'form-action'?: string[];
  'base-uri'?: string[];
  'worker-src'?: string[];
  'manifest-src'?: string[];
  'upgrade-insecure-requests'?: boolean;
  'block-all-mixed-content'?: boolean;
  'report-uri'?: string;
  'report-to'?: string;
}

/**
 * Environment-specific CSP configuration
 */
export interface EnvironmentCspConfig {
  /** CSP configuration for development */
  development: CspDirectives;
  /** CSP configuration for staging */
  staging: CspDirectives;
  /** CSP configuration for production */
  production: CspDirectives;
}

/**
 * Security headers configuration options
 */
export interface SecurityHeadersOptions {
  /** Content Security Policy configuration */
  csp?: CspDirectives | false;
  /** Use environment-specific CSP */
  environmentCsp?: EnvironmentCspConfig;
  /** Enable X-Content-Type-Options: nosniff */
  noSniff?: boolean;
  /** X-Frame-Options value */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Enable X-XSS-Protection header */
  xssProtection?: boolean;
  /** HSTS configuration */
  hsts?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  } | false;
  /** Referrer-Policy value */
  referrerPolicy?: string | false;
  /** Permissions-Policy value */
  permissionsPolicy?: string | false;
  /** Generate nonce for inline scripts */
  useNonce?: boolean;
  /** Custom headers to add */
  customHeaders?: Record<string, string>;
  /** Paths to exclude from CSP */
  excludePaths?: string[];
}

/**
 * Subresource Integrity (SRI) hash
 */
export interface SriHash {
  /** The algorithm used (sha256, sha384, sha512) */
  algorithm: 'sha256' | 'sha384' | 'sha512';
  /** The base64-encoded hash */
  hash: string;
  /** The full integrity attribute value */
  integrity: string;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default security headers applied to all responses
 */
export const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Default CSP directives for APIs
 */
export const DEFAULT_API_CSP: CspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'upgrade-insecure-requests': true,
};

/**
 * CSP configuration for Swagger UI pages
 */
export const SWAGGER_UI_CSP: CspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https://validator.swagger.io'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/**
 * Environment-specific CSP configurations
 */
export const ENVIRONMENT_CSP_CONFIG: EnvironmentCspConfig = {
  development: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'ws:', 'wss:', 'http://localhost:*', 'https://localhost:*'],
    'object-src': ["'none'"],
    'frame-ancestors': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  },
  staging: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': true,
  },
  production: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': true,
    'block-all-mixed-content': true,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a cryptographically secure nonce for CSP
 *
 * @returns Base64-encoded nonce string
 */
export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Generate Subresource Integrity (SRI) hash for content
 *
 * @param content - The content to hash (string or Buffer)
 * @param algorithm - Hash algorithm to use (default: sha384)
 * @returns SRI hash object with algorithm, hash, and full integrity value
 */
export function generateSriHash(
  content: string | Buffer,
  algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha384'
): SriHash {
  const hash = createHash(algorithm)
    .update(content)
    .digest('base64');

  return {
    algorithm,
    hash,
    integrity: `${algorithm}-${hash}`,
  };
}

/**
 * Verify content against SRI hash
 *
 * @param content - Content to verify
 * @param expectedIntegrity - Expected integrity attribute value
 * @returns True if content matches the hash
 */
export function verifySriHash(content: string | Buffer, expectedIntegrity: string): boolean {
  // Parse the integrity value (e.g., "sha384-abc123")
  const match = expectedIntegrity.match(/^(sha256|sha384|sha512)-(.+)$/);
  if (!match) {
    return false;
  }

  const [, algorithm, expectedHash] = match;
  const actualHash = createHash(algorithm as 'sha256' | 'sha384' | 'sha512')
    .update(content)
    .digest('base64');

  return actualHash === expectedHash;
}

/**
 * Build CSP header string from directives object
 *
 * @param directives - CSP directives configuration
 * @param nonce - Optional nonce to include in script-src and style-src
 * @returns CSP header value string
 */
export function buildCspHeader(directives: CspDirectives, nonce?: string): string {
  const parts: string[] = [];

  for (const [directive, value] of Object.entries(directives)) {
    if (value === undefined) continue;

    // Handle boolean directives
    if (typeof value === 'boolean') {
      if (value) {
        parts.push(directive);
      }
      continue;
    }

    // Handle string directives (report-uri, report-to)
    if (typeof value === 'string') {
      parts.push(`${directive} ${value}`);
      continue;
    }

    // Handle array directives
    if (Array.isArray(value)) {
      let sources = [...value];

      // Add nonce to script-src and style-src if provided
      if (nonce && (directive === 'script-src' || directive === 'style-src')) {
        sources.push(`'nonce-${nonce}'`);
      }

      parts.push(`${directive} ${sources.join(' ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Get CSP configuration for the current environment
 *
 * @param config - Environment CSP configuration
 * @returns CSP directives for current environment
 */
export function getEnvironmentCsp(config: EnvironmentCspConfig): CspDirectives {
  const env = process.env.NODE_ENV || 'development';

  switch (env) {
    case 'production':
      return config.production;
    case 'staging':
    case 'test':
      return config.staging;
    default:
      return config.development;
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create security headers middleware for Fastify
 *
 * Applies comprehensive security headers to all responses including:
 * - Content-Security-Policy with configurable directives
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options
 * - X-XSS-Protection
 * - Strict-Transport-Security (HSTS)
 * - Referrer-Policy
 * - Permissions-Policy
 *
 * @param options - Security headers configuration
 * @returns Fastify onRequest hook function
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * server.addHook('onRequest', securityHeadersMiddleware());
 *
 * // With custom CSP
 * server.addHook('onRequest', securityHeadersMiddleware({
 *   csp: {
 *     'default-src': ["'self'"],
 *     'script-src': ["'self'", "'unsafe-inline'"],
 *     'style-src': ["'self'", "'unsafe-inline'"],
 *   }
 * }));
 *
 * // With nonce generation for inline scripts
 * server.addHook('onRequest', securityHeadersMiddleware({
 *   useNonce: true,
 * }));
 * ```
 */
export function securityHeadersMiddleware(
  options: SecurityHeadersOptions = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const {
    noSniff = true,
    frameOptions = 'DENY',
    xssProtection = true,
    hsts = { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy = 'strict-origin-when-cross-origin',
    permissionsPolicy = 'geolocation=(), microphone=(), camera=()',
    useNonce = false,
    customHeaders = {},
    excludePaths = [],
  } = options;

  // Get CSP configuration
  let cspDirectives: CspDirectives | false;
  if (options.csp === false) {
    cspDirectives = false;
  } else if (options.environmentCsp) {
    cspDirectives = getEnvironmentCsp(options.environmentCsp);
  } else if (options.csp) {
    cspDirectives = options.csp;
  } else {
    cspDirectives = DEFAULT_API_CSP;
  }

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip excluded paths
    if (excludePaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    // Generate nonce if enabled
    let nonce: string | undefined;
    if (useNonce) {
      nonce = generateNonce();
      // Store nonce on request for use in templates
      (request as FastifyRequest & { cspNonce: string }).cspNonce = nonce;
    }

    // Apply CSP
    if (cspDirectives !== false) {
      const cspHeader = buildCspHeader(cspDirectives, nonce);
      reply.header('Content-Security-Policy', cspHeader);
    }

    // X-Content-Type-Options
    if (noSniff) {
      reply.header('X-Content-Type-Options', 'nosniff');
    }

    // X-Frame-Options
    if (frameOptions) {
      reply.header('X-Frame-Options', frameOptions);
    }

    // X-XSS-Protection
    if (xssProtection) {
      reply.header('X-XSS-Protection', '1; mode=block');
    }

    // HSTS
    if (hsts) {
      let hstsValue = `max-age=${hsts.maxAge}`;
      if (hsts.includeSubDomains) {
        hstsValue += '; includeSubDomains';
      }
      if (hsts.preload) {
        hstsValue += '; preload';
      }
      reply.header('Strict-Transport-Security', hstsValue);
    }

    // Referrer-Policy
    if (referrerPolicy) {
      reply.header('Referrer-Policy', referrerPolicy);
    }

    // Permissions-Policy
    if (permissionsPolicy) {
      reply.header('Permissions-Policy', permissionsPolicy);
    }

    // Custom headers
    for (const [name, value] of Object.entries(customHeaders)) {
      reply.header(name, value);
    }
  };
}

/**
 * Create security headers middleware specifically for Swagger UI
 *
 * Applies CSP and security headers optimized for Swagger UI pages
 * that serve self-hosted Swagger UI assets.
 *
 * @param options - Additional security header options
 * @returns Fastify onRequest hook function
 */
export function swaggerSecurityHeaders(
  options: Omit<SecurityHeadersOptions, 'csp'> = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return securityHeadersMiddleware({
    ...options,
    csp: SWAGGER_UI_CSP,
  });
}

/**
 * Apply default security headers to a FastifyReply
 *
 * Convenience function to apply all default security headers
 * to a single response without middleware registration.
 *
 * @param reply - Fastify reply object
 * @param csp - Optional CSP directives (defaults to API CSP)
 */
export function applySecurityHeaders(
  reply: FastifyReply,
  csp?: CspDirectives | false
): void {
  // Apply CSP
  if (csp !== false) {
    const cspHeader = buildCspHeader(csp ?? DEFAULT_API_CSP);
    reply.header('Content-Security-Policy', cspHeader);
  }

  // Apply other security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

// ============================================================================
// Plugin Registration
// ============================================================================

/**
 * Register security headers plugin for Fastify
 *
 * Registers the security headers middleware as a Fastify plugin,
 * applying headers to all requests by default.
 *
 * @param server - Fastify instance
 * @param options - Security headers configuration
 *
 * @example
 * ```typescript
 * await server.register(registerSecurityHeadersPlugin, {
 *   environmentCsp: ENVIRONMENT_CSP_CONFIG,
 *   useNonce: true,
 *   excludePaths: ['/health', '/metrics'],
 * });
 * ```
 */
export async function registerSecurityHeadersPlugin(
  server: FastifyInstance,
  options: SecurityHeadersOptions = {}
): Promise<void> {
  const middleware = securityHeadersMiddleware(options);

  // Add security headers to all requests
  server.addHook('onRequest', middleware);

  // Decorate server with utility functions
  server.decorate('generateCspNonce', generateNonce);
  server.decorate('generateSriHash', generateSriHash);
  server.decorate('verifySriHash', verifySriHash);

  logger.info(
    { excludePaths: options.excludePaths, useNonce: options.useNonce },
    'Security headers plugin registered'
  );
}

// ============================================================================
// SRI Hash Generation for Swagger UI Assets
// ============================================================================

/**
 * Pre-computed SRI hashes for Swagger UI 5.x assets
 *
 * These hashes should be updated when Swagger UI version changes.
 * Use generateSriHashForFile() to regenerate hashes.
 *
 * Note: When self-hosting, generate hashes from your actual files.
 */
export const SWAGGER_UI_SRI_HASHES = {
  // These are placeholders - actual hashes must be generated from the specific files
  css: 'sha384-PLACEHOLDER-GENERATE-FROM-ACTUAL-FILE',
  bundle: 'sha384-PLACEHOLDER-GENERATE-FROM-ACTUAL-FILE',
  standalonePreset: 'sha384-PLACEHOLDER-GENERATE-FROM-ACTUAL-FILE',
} as const;

/**
 * Generate SRI hash for a file (for build-time hash generation)
 *
 * @param content - File content as string or Buffer
 * @returns SRI integrity attribute value
 */
export function generateSriHashForFile(content: string | Buffer): string {
  return generateSriHash(content, 'sha384').integrity;
}

// ============================================================================
// Export Types for Declaration Merging
// ============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    generateCspNonce: typeof generateNonce;
    generateSriHash: typeof generateSriHash;
    verifySriHash: typeof verifySriHash;
  }

  interface FastifyRequest {
    cspNonce?: string;
  }
}
