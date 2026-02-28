/**
 * @fileoverview Canonical Middleware type definitions for the Vorion Platform.
 *
 * This file provides the authoritative definitions for middleware-related types
 * including rate limiting, CORS, error responses, and security headers.
 * These types unify various implementations across the codebase into a single
 * source of truth.
 *
 * @module @vorion/contracts/canonical/middleware
 */

import { z } from "zod";

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Configuration for rate limiting middleware.
 *
 * Defines the parameters for controlling request frequency.
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  readonly limit: number;
  /** Window size in milliseconds */
  readonly windowMs: number;
  /** Optional key generator function identifier */
  readonly keyGenerator?: string;
  /** Whether to skip rate limiting for successful requests */
  readonly skipSuccessfulRequests?: boolean;
  /** Whether to skip rate limiting for failed requests */
  readonly skipFailedRequests?: boolean;
  /** Custom message when rate limit is exceeded */
  readonly message?: string;
  /** HTTP status code when rate limit is exceeded (default: 429) */
  readonly statusCode?: number;
  /** Headers to include in rate limit responses */
  readonly headers?: boolean;
}

/**
 * Zod schema for RateLimitConfig validation.
 */
export const rateLimitConfigSchema = z.object({
  limit: z.number().int().positive(),
  windowMs: z.number().int().positive(),
  keyGenerator: z.string().optional(),
  skipSuccessfulRequests: z.boolean().optional(),
  skipFailedRequests: z.boolean().optional(),
  message: z.string().optional(),
  statusCode: z.number().int().min(400).max(599).optional(),
  headers: z.boolean().optional(),
});

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  readonly allowed: boolean;
  /** Current request count in the window */
  readonly current: number;
  /** Maximum requests allowed */
  readonly limit: number;
  /** Remaining requests in the window */
  readonly remaining: number;
  /** When the window resets (Unix timestamp in seconds) */
  readonly resetAt: number;
  /** Time until reset in seconds */
  readonly retryAfter?: number;
}

/**
 * Zod schema for RateLimitResult validation.
 */
export const rateLimitResultSchema = z.object({
  allowed: z.boolean(),
  current: z.number().int().min(0),
  limit: z.number().int().positive(),
  remaining: z.number().int().min(0),
  resetAt: z.number().int().positive(),
  retryAfter: z.number().int().min(0).optional(),
});

/**
 * Rate limit headers included in responses.
 */
export interface RateLimitHeaders {
  /** Maximum requests allowed in the window */
  readonly "X-RateLimit-Limit": string;
  /** Remaining requests in the window */
  readonly "X-RateLimit-Remaining": string;
  /** When the window resets (Unix timestamp) */
  readonly "X-RateLimit-Reset": string;
  /** Seconds until retry is allowed (when rate limited) */
  readonly "Retry-After"?: string;
}

/**
 * Tenant-specific rate limit configuration.
 */
export interface TenantRateLimitConfig extends RateLimitConfig {
  /** Tenant identifier */
  readonly tenantId: string;
  /** Whether this is a premium/elevated tier */
  readonly isPremium?: boolean;
  /** Multiplier for premium tier (default: 1) */
  readonly premiumMultiplier?: number;
}

/**
 * Zod schema for TenantRateLimitConfig validation.
 */
export const tenantRateLimitConfigSchema = rateLimitConfigSchema.extend({
  tenantId: z.string().min(1),
  isPremium: z.boolean().optional(),
  premiumMultiplier: z.number().positive().optional(),
});

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * CORS (Cross-Origin Resource Sharing) configuration.
 */
export interface CorsConfig {
  /** Allowed origins (use '*' for all, or array of specific origins) */
  readonly origin: string | readonly string[];
  /** Allowed HTTP methods */
  readonly methods?: readonly string[];
  /** Allowed request headers */
  readonly headers?: readonly string[];
  /** Headers to expose to the client */
  readonly exposedHeaders?: readonly string[];
  /** Whether to allow credentials (cookies, authorization headers) */
  readonly credentials?: boolean;
  /** Max age for preflight cache in seconds */
  readonly maxAge?: number;
  /** Whether to pass preflight response to the next handler */
  readonly preflightContinue?: boolean;
  /** Status code for successful OPTIONS requests */
  readonly optionsSuccessStatus?: number;
}

/**
 * Zod schema for CorsConfig validation.
 */
export const corsConfigSchema = z.object({
  origin: z.union([z.string(), z.array(z.string()).readonly()]),
  methods: z.array(z.string()).readonly().optional(),
  headers: z.array(z.string()).readonly().optional(),
  exposedHeaders: z.array(z.string()).readonly().optional(),
  credentials: z.boolean().optional(),
  maxAge: z.number().int().min(0).optional(),
  preflightContinue: z.boolean().optional(),
  optionsSuccessStatus: z.number().int().min(200).max(299).optional(),
});

// ============================================================================
// Error Response
// ============================================================================

/**
 * Standard error response structure.
 *
 * Provides a consistent format for API error responses across the platform.
 */
export interface ErrorResponse {
  readonly error: {
    /** Error code (e.g., 'VALIDATION_ERROR', 'NOT_FOUND') */
    readonly code: string;
    /** Human-readable error message */
    readonly message: string;
    /** Additional error details */
    readonly details?: Readonly<Record<string, unknown>>;
    /** Request ID for tracing */
    readonly requestId?: string;
    /** Timestamp of the error */
    readonly timestamp?: string;
    /** Path that generated the error */
    readonly path?: string;
  };
}

/**
 * Zod schema for ErrorResponse validation.
 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.unknown()).readonly().optional(),
    requestId: z.string().optional(),
    timestamp: z.string().optional(),
    path: z.string().optional(),
  }),
});

/**
 * Error category for classification.
 */
export type ErrorCategory =
  | "validation" // Input validation errors
  | "authentication" // Auth failures
  | "authorization" // Permission errors
  | "not_found" // Resource not found
  | "conflict" // State conflicts
  | "rate_limit" // Rate limit exceeded
  | "internal" // Internal server errors
  | "external" // External service errors
  | "timeout" // Request timeout
  | "unavailable"; // Service unavailable

/**
 * Zod schema for ErrorCategory validation.
 */
export const errorCategorySchema = z.enum([
  "validation",
  "authentication",
  "authorization",
  "not_found",
  "conflict",
  "rate_limit",
  "internal",
  "external",
  "timeout",
  "unavailable",
]);

// ============================================================================
// Security Headers
// ============================================================================

/**
 * Security headers configuration.
 */
export interface SecurityHeadersConfig {
  /** X-Content-Type-Options header value */
  readonly contentTypeOptions?: string;
  /** X-Frame-Options header value */
  readonly frameOptions?: string;
  /** X-XSS-Protection header value */
  readonly xssProtection?: string;
  /** Referrer-Policy header value */
  readonly referrerPolicy?: string;
  /** Permissions-Policy header value */
  readonly permissionsPolicy?: string;
}

/**
 * Zod schema for SecurityHeadersConfig validation.
 */
export const securityHeadersConfigSchema = z.object({
  contentTypeOptions: z.string().optional(),
  frameOptions: z.string().optional(),
  xssProtection: z.string().optional(),
  referrerPolicy: z.string().optional(),
  permissionsPolicy: z.string().optional(),
});

/**
 * Content Security Policy (CSP) configuration.
 */
export interface CspConfig {
  /** Default source directive */
  readonly defaultSrc?: readonly string[];
  /** Script source directive */
  readonly scriptSrc?: readonly string[];
  /** Style source directive */
  readonly styleSrc?: readonly string[];
  /** Image source directive */
  readonly imgSrc?: readonly string[];
  /** Font source directive */
  readonly fontSrc?: readonly string[];
  /** Connect source directive */
  readonly connectSrc?: readonly string[];
  /** Frame source directive */
  readonly frameSrc?: readonly string[];
  /** Object source directive */
  readonly objectSrc?: readonly string[];
  /** Media source directive */
  readonly mediaSrc?: readonly string[];
  /** Whether to report violations only */
  readonly reportOnly?: boolean;
  /** Report URI for violations */
  readonly reportUri?: string;
}

/**
 * Zod schema for CspConfig validation.
 */
export const cspConfigSchema = z.object({
  defaultSrc: z.array(z.string()).readonly().optional(),
  scriptSrc: z.array(z.string()).readonly().optional(),
  styleSrc: z.array(z.string()).readonly().optional(),
  imgSrc: z.array(z.string()).readonly().optional(),
  fontSrc: z.array(z.string()).readonly().optional(),
  connectSrc: z.array(z.string()).readonly().optional(),
  frameSrc: z.array(z.string()).readonly().optional(),
  objectSrc: z.array(z.string()).readonly().optional(),
  mediaSrc: z.array(z.string()).readonly().optional(),
  reportOnly: z.boolean().optional(),
  reportUri: z.string().url().optional(),
});

/**
 * HTTP Strict Transport Security (HSTS) configuration.
 */
export interface HstsConfig {
  /** Max age in seconds */
  readonly maxAge: number;
  /** Whether to include subdomains */
  readonly includeSubDomains?: boolean;
  /** Whether to enable preload */
  readonly preload?: boolean;
}

/**
 * Zod schema for HstsConfig validation.
 */
export const hstsConfigSchema = z.object({
  maxAge: z.number().int().min(0),
  includeSubDomains: z.boolean().optional(),
  preload: z.boolean().optional(),
});

// ============================================================================
// Request Logging
// ============================================================================

/**
 * Request logging configuration.
 */
export interface RequestLoggingConfig {
  /** Whether to log request bodies */
  readonly logBody?: boolean;
  /** Whether to log response bodies */
  readonly logResponse?: boolean;
  /** Whether to log headers */
  readonly logHeaders?: boolean;
  /** Headers to redact from logs */
  readonly redactHeaders?: readonly string[];
  /** Maximum body size to log (bytes) */
  readonly maxBodySize?: number;
  /** Log level */
  readonly level?: "debug" | "info" | "warn" | "error";
}

/**
 * Zod schema for RequestLoggingConfig validation.
 */
export const requestLoggingConfigSchema = z.object({
  logBody: z.boolean().optional(),
  logResponse: z.boolean().optional(),
  logHeaders: z.boolean().optional(),
  redactHeaders: z.array(z.string()).readonly().optional(),
  maxBodySize: z.number().int().positive().optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
});

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for RateLimitConfig.
 */
export function isRateLimitConfig(value: unknown): value is RateLimitConfig {
  return rateLimitConfigSchema.safeParse(value).success;
}

/**
 * Type guard for CorsConfig.
 */
export function isCorsConfig(value: unknown): value is CorsConfig {
  return corsConfigSchema.safeParse(value).success;
}

/**
 * Type guard for ErrorResponse.
 */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return errorResponseSchema.safeParse(value).success;
}

/**
 * Type guard for ErrorCategory.
 */
export function isErrorCategory(value: unknown): value is ErrorCategory {
  return errorCategorySchema.safeParse(value).success;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a standard error response.
 *
 * @param code - Error code
 * @param message - Human-readable message
 * @param options - Additional options
 * @returns ErrorResponse object
 */
export function createErrorResponse(
  code: string,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    path?: string;
  },
): ErrorResponse {
  return {
    error: {
      code,
      message,
      details: options?.details,
      requestId: options?.requestId,
      timestamp: new Date().toISOString(),
      path: options?.path,
    },
  };
}

/**
 * Default rate limit configuration.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  headers: true,
  statusCode: 429,
  message: "Too many requests, please try again later.",
};

/**
 * Default CORS configuration.
 */
export const DEFAULT_CORS_CONFIG: CorsConfig = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  headers: ["Content-Type", "Authorization", "X-API-Key", "X-Request-ID"],
  credentials: false,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 204,
};

/**
 * Default security headers configuration.
 */
export const DEFAULT_SECURITY_HEADERS_CONFIG: SecurityHeadersConfig = {
  contentTypeOptions: "nosniff",
  frameOptions: "DENY",
  xssProtection: "1; mode=block",
  referrerPolicy: "strict-origin-when-cross-origin",
};
