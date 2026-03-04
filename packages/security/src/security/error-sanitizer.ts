/**
 * Error Sanitization Middleware
 *
 * Prevents information disclosure through error messages by:
 * - Detecting and redacting sensitive data patterns
 * - Classifying errors (operational vs programming)
 * - Generating user-safe error messages
 * - Providing correlation IDs for support
 *
 * @packageDocumentation
 * @module security/error-sanitizer
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyError,
} from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../common/logger.js';
import { VorionError, isVorionError } from '../common/errors.js';

const logger = createLogger({ component: 'error-sanitizer' });

// =============================================================================
// Types & Schemas
// =============================================================================

/**
 * Sanitized error response structure
 */
export interface SanitizedError {
  /** Machine-readable error code */
  code: string;
  /** User-safe error message */
  message: string;
  /** Request ID for support correlation */
  requestId?: string;
  /** Additional details (only in development mode) */
  details?: unknown;
}

/**
 * Error classification type
 */
export type ErrorClassification = 'operational' | 'programming';

/**
 * Configuration for error sanitizer
 */
export interface ErrorSanitizerConfig {
  /** Whether running in production mode */
  isProduction: boolean;
  /** Whether to include stack traces in development */
  includeStackInDev: boolean;
  /** Whether to include error details in development */
  includeDetailsInDev: boolean;
  /** Custom error code mappings */
  errorCodeMappings?: Map<string, ErrorCodeMapping>;
  /** Additional sensitive patterns to detect */
  additionalPatterns?: RegExp[];
  /** Whether to log sanitized errors */
  logSanitizedErrors: boolean;
  /** Function to generate request IDs */
  generateRequestId?: () => string;
}

/**
 * Mapping from internal error code to user-facing response
 */
export interface ErrorCodeMapping {
  /** User-friendly message */
  message: string;
  /** HTTP status code */
  statusCode: number;
}

/**
 * Zod schema for error sanitizer configuration
 */
export const errorSanitizerConfigSchema = z.object({
  isProduction: z.boolean().default(process.env['NODE_ENV'] === 'production'),
  includeStackInDev: z.boolean().default(true),
  includeDetailsInDev: z.boolean().default(true),
  additionalPatterns: z.array(z.instanceof(RegExp)).optional(),
  logSanitizedErrors: z.boolean().default(true),
});

// =============================================================================
// Sensitive Data Patterns
// =============================================================================

/**
 * Patterns for detecting sensitive data that should be redacted
 */
export const SENSITIVE_PATTERNS = {
  /** File paths - Unix and Windows */
  FILE_PATHS: [
    /\/Users\/[^/\s]+/gi,
    /\/home\/[^/\s]+/gi,
    /\/var\/[^/\s]+/gi,
    /\/etc\/[^/\s]+/gi,
    /\/root\b/gi,
    /\/tmp\/[^/\s]+/gi,
    /\/opt\/[^/\s]+/gi,
    /[A-Za-z]:\\[^\s]+/gi,
    /\\Users\\[^\s]+/gi,
    /\\Windows\\[^\s]+/gi,
    /\\Program Files[^\s]*/gi,
  ],

  /** IPv4 addresses */
  IPV4: [
    /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  ],

  /** IPv6 addresses */
  IPV6: [
    /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    /\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/g,
    /\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b/g,
    /\b::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}\b/g,
    /\b[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}\b/g,
  ],

  /** Database connection strings */
  DATABASE_CONNECTIONS: [
    /(?:postgres|postgresql|mysql|mariadb|mongodb|redis|mssql):\/\/[^\s]+/gi,
    /(?:host|server)=[^;\s]+/gi,
    /(?:database|dbname)=[^;\s]+/gi,
    /Data Source=[^;\s]+/gi,
    /Server=[^;\s]+/gi,
  ],

  /** API keys, tokens, and credentials */
  CREDENTIALS: [
    /(?:api[_-]?key|apikey)[=:]\s*["']?[A-Za-z0-9\-_]{16,}["']?/gi,
    /(?:token|bearer)[=:]\s*["']?[A-Za-z0-9\-_.]{16,}["']?/gi,
    /(?:password|passwd|pwd)[=:]\s*["']?[^\s"']+["']?/gi,
    /(?:secret|private[_-]?key)[=:]\s*["']?[^\s"']+["']?/gi,
    /(?:auth[_-]?token|access[_-]?token|refresh[_-]?token)[=:]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
    /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi,
    /Basic\s+[A-Za-z0-9+/=]+/gi,
    /sk_(?:live|test)_[A-Za-z0-9]+/gi,
    /pk_(?:live|test)_[A-Za-z0-9]+/gi,
    /ghp_[A-Za-z0-9]{36}/gi,
    /gho_[A-Za-z0-9]{36}/gi,
    /xox[baprs]-[A-Za-z0-9-]+/gi,
  ],

  /** Stack traces */
  STACK_TRACES: [
    /at\s+[A-Za-z0-9_$.]+\s+\([^)]+\)/g,
    /at\s+[A-Za-z0-9_$.]+\s+\[[^\]]+\]/g,
    /at\s+(?:async\s+)?[A-Za-z0-9_$./<>]+\s*$/gm,
    /^\s*at\s+.+:\d+:\d+$/gm,
    /Error:.*\n(?:\s+at\s+.*\n)+/g,
  ],

  /** SQL queries */
  SQL_QUERIES: [
    /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\s+.+(?:FROM|INTO|TABLE|SET|VALUES)/gi,
    /(?:WHERE|AND|OR)\s+[A-Za-z_]+\s*[=<>!]+\s*['"]?[^'"]+['"]?/gi,
    /(?:JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN)\s+[A-Za-z_]+/gi,
  ],

  /** Internal service URLs */
  INTERNAL_URLS: [
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s]*/gi,
    /https?:\/\/(?:10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(?::\d+)?[^\s]*/gi,
    /https?:\/\/[a-z0-9-]+\.internal[^\s]*/gi,
    /https?:\/\/[a-z0-9-]+\.local[^\s]*/gi,
    /https?:\/\/[a-z0-9-]+\.svc\.cluster\.local[^\s]*/gi,
  ],

  /** Environment variable references */
  ENV_VARIABLES: [
    /\$\{[A-Z_][A-Z0-9_]*\}/g,
    /\$[A-Z_][A-Z0-9_]*/g,
    /process\.env\.[A-Z_][A-Z0-9_]*/g,
    /process\.env\[['"][A-Z_][A-Z0-9_]*['"]\]/g,
  ],

  /** JWT tokens */
  JWT_TOKENS: [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g],

  /** UUIDs (often used as internal IDs) */
  UUIDS: [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi],
} as const;

// =============================================================================
// Default Error Code Mappings
// =============================================================================

/**
 * Default mappings from internal error codes to user-friendly responses
 */
export const DEFAULT_ERROR_MAPPINGS = new Map<string, ErrorCodeMapping>([
  // Authentication errors
  ['UNAUTHORIZED', { message: 'Authentication required', statusCode: 401 }],
  ['INVALID_TOKEN', { message: 'Invalid authentication token', statusCode: 401 }],
  ['TOKEN_EXPIRED', { message: 'Authentication token has expired', statusCode: 401 }],
  ['TOKEN_INACTIVE', { message: 'Authentication token is no longer valid', statusCode: 401 }],

  // Authorization errors
  ['FORBIDDEN', { message: 'You do not have permission to perform this action', statusCode: 403 }],
  ['INSUFFICIENT_PERMISSIONS', { message: 'Insufficient permissions', statusCode: 403 }],
  ['AGENT_REVOKED', { message: 'Access has been revoked', statusCode: 403 }],
  ['INSUFFICIENT_TRUST_TIER', { message: 'Higher trust level required for this operation', statusCode: 403 }],

  // Validation errors
  ['VALIDATION_ERROR', { message: 'Invalid request data', statusCode: 400 }],
  ['INVALID_INPUT', { message: 'Invalid input provided', statusCode: 400 }],
  ['MISSING_REQUIRED_FIELD', { message: 'Required field is missing', statusCode: 400 }],
  ['INVALID_FORMAT', { message: 'Invalid data format', statusCode: 400 }],

  // Resource errors
  ['NOT_FOUND', { message: 'The requested resource was not found', statusCode: 404 }],
  ['RESOURCE_NOT_FOUND', { message: 'Resource not found', statusCode: 404 }],
  ['CONFLICT', { message: 'Resource conflict detected', statusCode: 409 }],
  ['ALREADY_EXISTS', { message: 'Resource already exists', statusCode: 409 }],

  // Rate limiting
  ['RATE_LIMIT_EXCEEDED', { message: 'Too many requests. Please try again later.', statusCode: 429 }],
  ['QUOTA_EXCEEDED', { message: 'Usage quota exceeded', statusCode: 429 }],

  // Server errors
  ['INTERNAL_ERROR', { message: 'An unexpected error occurred', statusCode: 500 }],
  ['VORION_ERROR', { message: 'An unexpected error occurred', statusCode: 500 }],
  ['DATABASE_ERROR', { message: 'A database error occurred', statusCode: 500 }],
  ['CONFIGURATION_ERROR', { message: 'Service configuration error', statusCode: 500 }],
  ['ENCRYPTION_ERROR', { message: 'Security operation failed', statusCode: 500 }],

  // External service errors
  ['EXTERNAL_SERVICE_ERROR', { message: 'External service unavailable', statusCode: 502 }],
  ['INTEGRATION_ERROR', { message: 'Integration service error', statusCode: 502 }],
  ['SERVICE_UNAVAILABLE', { message: 'Service temporarily unavailable', statusCode: 503 }],
  ['TIMEOUT', { message: 'Request timed out', statusCode: 504 }],

  // Security errors
  ['CSRF_INVALID', { message: 'Invalid request. Please refresh and try again.', statusCode: 403 }],
  ['DPOP_REQUIRED', { message: 'Proof of possession required', statusCode: 401 }],
  ['DPOP_INVALID', { message: 'Invalid proof of possession', statusCode: 401 }],
  ['MFA_REQUIRED', { message: 'Multi-factor authentication required', statusCode: 403 }],
  ['INJECTION_DETECTED', { message: 'Invalid input detected', statusCode: 400 }],
]);

// =============================================================================
// Error Sanitizer Class
// =============================================================================

/**
 * Default error sanitizer configuration
 */
const DEFAULT_CONFIG: ErrorSanitizerConfig = {
  isProduction: process.env['NODE_ENV'] === 'production',
  includeStackInDev: true,
  includeDetailsInDev: true,
  logSanitizedErrors: true,
  generateRequestId: () => randomUUID().slice(0, 16),
};

/**
 * ErrorSanitizer class for preventing information disclosure
 *
 * @example
 * ```typescript
 * const sanitizer = new ErrorSanitizer({ isProduction: true });
 *
 * // Sanitize an error message
 * const safeMessage = sanitizer.sanitizeMessage(error.message);
 *
 * // Generate a safe error response
 * const response = sanitizer.createSafeResponse(error, requestId);
 * ```
 */
export class ErrorSanitizer {
  private readonly config: ErrorSanitizerConfig;
  private readonly errorMappings: Map<string, ErrorCodeMapping>;
  private readonly allPatterns: RegExp[];

  /**
   * Creates a new ErrorSanitizer instance
   *
   * @param config - Configuration options
   */
  constructor(config: Partial<ErrorSanitizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.errorMappings = config.errorCodeMappings ?? new Map(DEFAULT_ERROR_MAPPINGS);

    // Combine all sensitive patterns
    this.allPatterns = [
      ...SENSITIVE_PATTERNS.FILE_PATHS,
      ...SENSITIVE_PATTERNS.IPV4,
      ...SENSITIVE_PATTERNS.IPV6,
      ...SENSITIVE_PATTERNS.DATABASE_CONNECTIONS,
      ...SENSITIVE_PATTERNS.CREDENTIALS,
      ...SENSITIVE_PATTERNS.SQL_QUERIES,
      ...SENSITIVE_PATTERNS.INTERNAL_URLS,
      ...SENSITIVE_PATTERNS.ENV_VARIABLES,
      ...SENSITIVE_PATTERNS.JWT_TOKENS,
      ...(this.config.isProduction ? SENSITIVE_PATTERNS.STACK_TRACES : []),
      ...(config.additionalPatterns ?? []),
    ];

    logger.debug('Error sanitizer initialized', {
      isProduction: this.config.isProduction,
      patternCount: this.allPatterns.length,
    });
  }

  /**
   * Sanitize an error message by removing sensitive data
   *
   * @param message - The error message to sanitize
   * @returns Sanitized message
   */
  sanitizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return 'An error occurred';
    }

    let sanitized = message;

    // Apply all patterns
    for (const pattern of this.allPatterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    // Collapse multiple consecutive [REDACTED] markers
    sanitized = sanitized.replace(/(\[REDACTED\]\s*)+/g, '[REDACTED] ');

    // Trim and clean up
    sanitized = sanitized.trim();

    // If message becomes too short or just redaction markers, return generic message
    const cleanedMessage = sanitized.replace(/\[REDACTED\]/g, '').trim();
    if (cleanedMessage.length < 5) {
      return 'An error occurred';
    }

    return sanitized;
  }

  /**
   * Classify an error as operational or programming
   *
   * Operational errors are expected errors from normal operation
   * (e.g., validation failures, not found, rate limits).
   *
   * Programming errors are bugs that shouldn't happen
   * (e.g., TypeError, ReferenceError, unexpected exceptions).
   *
   * @param error - The error to classify
   * @returns Error classification
   */
  classifyError(error: Error): ErrorClassification {
    // VorionErrors are operational by design
    if (isVorionError(error)) {
      return 'operational';
    }

    // Fastify errors with statusCode < 500 are operational
    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode !== undefined && fastifyError.statusCode < 500) {
      return 'operational';
    }

    // Common operational error types
    const operationalErrorNames = [
      'ValidationError',
      'NotFoundError',
      'UnauthorizedError',
      'ForbiddenError',
      'ConflictError',
      'RateLimitError',
      'TimeoutError',
      'BadRequestError',
    ];

    if (operationalErrorNames.includes(error.name)) {
      return 'operational';
    }

    // Programming error types
    const programmingErrorNames = [
      'TypeError',
      'ReferenceError',
      'SyntaxError',
      'RangeError',
      'EvalError',
      'URIError',
    ];

    if (programmingErrorNames.includes(error.name)) {
      return 'programming';
    }

    // Check for common operational error indicators in message
    const operationalIndicators = [
      'not found',
      'invalid',
      'unauthorized',
      'forbidden',
      'expired',
      'rate limit',
      'too many',
      'conflict',
      'already exists',
      'validation',
      'required',
      'missing',
    ];

    const lowerMessage = error.message.toLowerCase();
    if (operationalIndicators.some((indicator) => lowerMessage.includes(indicator))) {
      return 'operational';
    }

    // Default to programming error for safety
    return 'programming';
  }

  /**
   * Generate a safe error message for the user
   *
   * @param error - The error to generate a message for
   * @returns User-safe error message
   */
  generateSafeMessage(error: Error): string {
    // Get error code
    const code = this.getErrorCode(error);

    // Check for mapped message
    const mapping = this.errorMappings.get(code);
    if (mapping) {
      return mapping.message;
    }

    // For operational errors, try to use a sanitized version of the message
    const classification = this.classifyError(error);
    if (classification === 'operational') {
      const sanitized = this.sanitizeMessage(error.message);
      // If the message is still meaningful after sanitization, use it
      if (sanitized !== 'An error occurred' && !sanitized.includes('[REDACTED]')) {
        return sanitized;
      }
    }

    // Default messages based on classification and status code
    const statusCode = this.getStatusCode(error);

    if (statusCode >= 400 && statusCode < 500) {
      return 'Invalid request';
    }

    return 'An unexpected error occurred';
  }

  /**
   * Get the error code from an error
   *
   * @param error - The error
   * @returns Error code string
   */
  getErrorCode(error: Error): string {
    if (isVorionError(error)) {
      return error.code;
    }

    const fastifyError = error as FastifyError;
    if (fastifyError.code) {
      return fastifyError.code;
    }

    // Map common error names to codes
    const nameToCode: Record<string, string> = {
      ValidationError: 'VALIDATION_ERROR',
      NotFoundError: 'NOT_FOUND',
      UnauthorizedError: 'UNAUTHORIZED',
      ForbiddenError: 'FORBIDDEN',
      ConflictError: 'CONFLICT',
      RateLimitError: 'RATE_LIMIT_EXCEEDED',
      TimeoutError: 'TIMEOUT',
      TypeError: 'INTERNAL_ERROR',
      ReferenceError: 'INTERNAL_ERROR',
      SyntaxError: 'INTERNAL_ERROR',
    };

    return nameToCode[error.name] ?? 'INTERNAL_ERROR';
  }

  /**
   * Get the HTTP status code for an error
   *
   * @param error - The error
   * @returns HTTP status code
   */
  getStatusCode(error: Error): number {
    if (isVorionError(error)) {
      return error.statusCode;
    }

    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode !== undefined) {
      return fastifyError.statusCode;
    }

    // Check error code mapping
    const code = this.getErrorCode(error);
    const mapping = this.errorMappings.get(code);
    if (mapping) {
      return mapping.statusCode;
    }

    // Default based on error classification
    return this.classifyError(error) === 'operational' ? 400 : 500;
  }

  /**
   * Create a sanitized error response
   *
   * @param error - The error to create a response for
   * @param requestId - Optional request ID for correlation
   * @returns Sanitized error response
   */
  createSafeResponse(error: Error, requestId?: string): SanitizedError {
    const code = this.getErrorCode(error);
    const message = this.generateSafeMessage(error);
    const finalRequestId = requestId ?? this.config.generateRequestId?.();

    const response: SanitizedError = {
      code,
      message,
    };

    if (finalRequestId) {
      response.requestId = finalRequestId;
    }

    // Include details only in development mode
    if (!this.config.isProduction && this.config.includeDetailsInDev) {
      const details: Record<string, unknown> = {
        name: error.name,
        originalMessage: this.sanitizeMessage(error.message),
        classification: this.classifyError(error),
      };

      if (isVorionError(error) && error.details) {
        details.errorDetails = this.sanitizeObject(error.details);
      }

      if (this.config.includeStackInDev && error.stack) {
        details.stack = this.sanitizeMessage(error.stack);
      }

      response.details = details;
    }

    return response;
  }

  /**
   * Sanitize an object by redacting sensitive values
   *
   * @param obj - Object to sanitize
   * @param depth - Current recursion depth
   * @returns Sanitized object
   */
  private sanitizeObject(obj: unknown, depth = 0): unknown {
    if (depth > 10) {
      return '[MAX_DEPTH]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeMessage(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, depth + 1));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      const sensitiveKeys = [
        'password',
        'secret',
        'token',
        'apiKey',
        'api_key',
        'authorization',
        'credential',
        'private_key',
        'privateKey',
        'connectionString',
        'connection_string',
      ];

      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.sanitizeObject(value, depth + 1);
        }
      }

      return result;
    }

    return String(obj);
  }

  /**
   * Add a custom error code mapping
   *
   * @param code - Error code
   * @param mapping - Error code mapping
   */
  addErrorMapping(code: string, mapping: ErrorCodeMapping): void {
    this.errorMappings.set(code, mapping);
  }

  /**
   * Check if running in production mode
   */
  isProductionMode(): boolean {
    return this.config.isProduction;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sanitize an error message by removing sensitive data
 *
 * Standalone utility function for one-off sanitization.
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message
 *
 * @example
 * ```typescript
 * const safe = sanitizeErrorMessage('Error connecting to postgres://user:pass@host/db');
 * // Returns: 'Error connecting to [REDACTED]'
 * ```
 */
export function sanitizeErrorMessage(message: string): string {
  return getErrorSanitizer().sanitizeMessage(message);
}

/**
 * Classify an error as operational or programming
 *
 * @param error - The error to classify
 * @returns 'operational' or 'programming'
 *
 * @example
 * ```typescript
 * const classification = classifyError(new ValidationError('Invalid input'));
 * // Returns: 'operational'
 *
 * const bugClassification = classifyError(new TypeError('undefined is not a function'));
 * // Returns: 'programming'
 * ```
 */
export function classifyError(error: Error): ErrorClassification {
  return getErrorSanitizer().classifyError(error);
}

/**
 * Generate a safe error message for the user
 *
 * @param error - The error to generate a message for
 * @returns User-safe error message
 *
 * @example
 * ```typescript
 * const safeMsg = generateSafeMessage(new Error('Connection to 192.168.1.1:5432 failed'));
 * // Returns: 'An unexpected error occurred'
 * ```
 */
export function generateSafeMessage(error: Error): string {
  return getErrorSanitizer().generateSafeMessage(error);
}

// =============================================================================
// Fastify Error Handler
// =============================================================================

/**
 * Options for the Fastify error handler plugin
 */
export interface ErrorHandlerOptions {
  /** Error sanitizer configuration */
  sanitizerConfig?: Partial<ErrorSanitizerConfig>;
  /** Custom error sanitizer instance */
  sanitizer?: ErrorSanitizer;
  /** Whether to log all errors */
  logErrors?: boolean;
  /** Paths to exclude from error handling */
  excludePaths?: string[];
}

/**
 * Create a Fastify error handler that sanitizes errors
 *
 * @param options - Error handler options
 * @returns Fastify error handler function
 *
 * @example
 * ```typescript
 * fastify.setErrorHandler(createErrorHandler({
 *   logErrors: true,
 *   sanitizerConfig: { isProduction: true },
 * }));
 * ```
 */
export function createErrorHandler(
  options: ErrorHandlerOptions = {}
): (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void {
  const sanitizer = options.sanitizer ?? getErrorSanitizer(options.sanitizerConfig);
  const logErrors = options.logErrors ?? true;
  const excludePaths = new Set(options.excludePaths ?? []);

  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    // Skip excluded paths
    if (excludePaths.has(request.url) || excludePaths.has(request.routeOptions?.url ?? '')) {
      reply.send(error);
      return;
    }

    // Get or generate request ID
    const requestId =
      (request.id as string) ??
      (request.headers['x-request-id'] as string) ??
      randomUUID().slice(0, 16);

    // Classify the error
    const classification = sanitizer.classifyError(error);
    const statusCode = sanitizer.getStatusCode(error);

    // Log the error
    if (logErrors) {
      const logData = {
        requestId,
        error: {
          name: error.name,
          message: error.message,
          code: (error as FastifyError).code,
          statusCode,
          classification,
        },
        request: {
          method: request.method,
          url: request.url,
          ip: request.ip,
        },
      };

      if (classification === 'programming' || statusCode >= 500) {
        logger.error({ ...logData, stack: error.stack }, 'Request error');
      } else {
        logger.warn(logData, 'Request error');
      }
    }

    // Create sanitized response
    const response = sanitizer.createSafeResponse(error, requestId);

    // Send response
    reply.status(statusCode).send({ error: response });
  };
}

/**
 * Fastify plugin that registers the sanitizing error handler
 *
 * @example
 * ```typescript
 * await fastify.register(errorSanitizerPlugin, {
 *   sanitizerConfig: { isProduction: true },
 *   logErrors: true,
 * });
 * ```
 */
export const errorSanitizerPlugin = fp(
  async (fastify: FastifyInstance, options: ErrorHandlerOptions) => {
    const handler = createErrorHandler(options);
    fastify.setErrorHandler(handler);

    logger.info('Error sanitizer plugin registered');
  },
  {
    name: 'vorion-error-sanitizer',
    fastify: '>=4.x',
  }
);

// =============================================================================
// Singleton Management
// =============================================================================

/** Singleton instance */
let errorSanitizerInstance: ErrorSanitizer | null = null;

/**
 * Get or create the singleton ErrorSanitizer instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns The singleton ErrorSanitizer instance
 *
 * @example
 * ```typescript
 * // Initialize with config
 * const sanitizer = getErrorSanitizer({ isProduction: true });
 *
 * // Later, get the same instance
 * const sameSanitizer = getErrorSanitizer();
 * ```
 */
export function getErrorSanitizer(config?: Partial<ErrorSanitizerConfig>): ErrorSanitizer {
  if (!errorSanitizerInstance) {
    errorSanitizerInstance = new ErrorSanitizer(config);
  }
  return errorSanitizerInstance;
}

/**
 * Reset the singleton instance (for testing)
 *
 * @internal
 */
export function resetErrorSanitizer(): void {
  errorSanitizerInstance = null;
  logger.debug('Error sanitizer singleton reset');
}

/**
 * Create a new ErrorSanitizer instance with custom configuration
 *
 * Use this when you need a non-singleton instance with specific configuration.
 *
 * @param config - Configuration options
 * @returns New ErrorSanitizer instance
 *
 * @example
 * ```typescript
 * const customSanitizer = createErrorSanitizer({
 *   isProduction: false,
 *   additionalPatterns: [/my-secret-pattern/gi],
 * });
 * ```
 */
export function createErrorSanitizer(config?: Partial<ErrorSanitizerConfig>): ErrorSanitizer {
  return new ErrorSanitizer(config);
}
