/**
 * Error Sanitizer
 *
 * Removes sensitive information from errors before returning to clients.
 * Prevents leaking internal details like file paths, stack traces,
 * database schema, and internal service names.
 *
 * @packageDocumentation
 */

import { createLogger } from './logger.js';
import { getSecurityConfig, getSecurityMode } from './security-mode.js';
import { randomUUID } from 'crypto';

const logger = createLogger({ component: 'error-sanitizer' });

/**
 * Sanitized error safe to return to clients
 */
export interface SanitizedError {
  /** Error code for client handling */
  code: string;
  /** User-friendly error message (no internal details) */
  message: string;
  /** Request ID for correlation with server logs */
  requestId: string;
  // No stack, no paths, no internal details
}

/**
 * Patterns that indicate sensitive information
 */
const SENSITIVE_PATTERNS = {
  // File paths (Unix and Windows)
  filePaths: [
    /\/(?:Users|home|var|etc|opt|usr|tmp|srv)\/[^\s"']+/gi,
    /[A-Z]:\\(?:Users|Program Files|Windows|temp)[^\s"']*/gi,
    /(?:\.\.\/|\.\/)[^\s"']+/g,
    /\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-./]+\.[a-z]{2,4}/gi,
  ],

  // Stack traces
  stackTraces: [
    /at\s+[^\s]+\s+\([^)]+\)/g,
    /at\s+[^\s]+\s+\[[^\]]+\]/g,
    /^\s*at\s+.+$/gm,
    /Error:\s*\n\s*at/g,
  ],

  // Database information
  database: [
    /(?:table|column|index|constraint|relation)\s+["']?[a-zA-Z_][a-zA-Z0-9_]*["']?/gi,
    /(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE)\s+[^\s;]+/gi,
    /(?:pg_|mysql_|sqlite_|mongo_)[a-zA-Z_]+/gi,
    /ERROR:\s*(?:duplicate key|violates|constraint)/gi,
  ],

  // Internal service names and endpoints
  internalServices: [
    /(?:internal|private|service|backend)[._-][a-zA-Z0-9_.-]+/gi,
    /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)[^\s]*/gi,
    /[a-zA-Z0-9_-]+\.(?:internal|local|svc\.cluster\.local)/gi,
  ],

  // IP addresses (internal ranges)
  internalIPs: [
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/g,
    /\b172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}\b/g,
    /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  ],

  // Environment variables and secrets
  secrets: [
    /(?:password|secret|token|key|credential|auth)[=:]\s*["']?[^\s"']+["']?/gi,
    /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
    /[a-zA-Z_][a-zA-Z0-9_]*_(?:SECRET|KEY|TOKEN|PASSWORD)\s*[=:]/gi,
  ],

  // Node.js module paths
  modulePaths: [
    /node_modules\/[^\s"']+/g,
    /node:internal\/[^\s"']+/g,
  ],

  // Memory addresses
  memoryAddresses: [
    /0x[0-9a-fA-F]{8,16}/g,
  ],

  // Process information
  processInfo: [
    /pid[=:]\s*\d+/gi,
    /ppid[=:]\s*\d+/gi,
  ],
};

/**
 * Generic safe error messages by category
 */
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  INTERNAL_ERROR: 'An internal error occurred. Please try again later.',
  DATABASE_ERROR: 'A database error occurred. Please try again later.',
  AUTHENTICATION_ERROR: 'Authentication failed. Please check your credentials.',
  AUTHORIZATION_ERROR: 'You do not have permission to perform this action.',
  VALIDATION_ERROR: 'The request contains invalid data.',
  NOT_FOUND: 'The requested resource was not found.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  TIMEOUT: 'The request timed out. Please try again.',
  NETWORK_ERROR: 'A network error occurred. Please check your connection.',
};

/**
 * Maps common error types to error codes
 */
const ERROR_TYPE_TO_CODE: Map<string, string> = new Map([
  ['TypeError', 'INTERNAL_ERROR'],
  ['ReferenceError', 'INTERNAL_ERROR'],
  ['RangeError', 'VALIDATION_ERROR'],
  ['SyntaxError', 'VALIDATION_ERROR'],
  ['ValidationError', 'VALIDATION_ERROR'],
  ['AuthenticationError', 'AUTHENTICATION_ERROR'],
  ['AuthorizationError', 'AUTHORIZATION_ERROR'],
  ['NotFoundError', 'NOT_FOUND'],
  ['TimeoutError', 'TIMEOUT'],
  ['DatabaseError', 'DATABASE_ERROR'],
  ['PostgresError', 'DATABASE_ERROR'],
  ['MongoError', 'DATABASE_ERROR'],
  ['SequelizeError', 'DATABASE_ERROR'],
]);

/**
 * Sanitize an error message by removing sensitive information
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message safe for client consumption
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return 'An error occurred.';
  }

  let sanitized = message;

  // Apply all sensitive pattern replacements
  for (const [category, patterns] of Object.entries(SENSITIVE_PATTERNS)) {
    for (const pattern of patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, `[${category}_redacted]`);
    }
  }

  // Remove any remaining potential paths (conservative approach)
  sanitized = sanitized.replace(/[/\\][a-zA-Z0-9_\-.]+[/\\][^\s"']*/g, '[path_redacted]');

  // Truncate if too long (prevent information leakage through length)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + '...';
  }

  return sanitized;
}

/**
 * Detect error code from error type and message
 *
 * @param error - The error to analyze
 * @returns Appropriate error code
 */
function detectErrorCode(error: Error): string {
  // Check error constructor name
  const errorType = error.constructor?.name || 'Error';
  if (ERROR_TYPE_TO_CODE.has(errorType)) {
    return ERROR_TYPE_TO_CODE.get(errorType)!;
  }

  // Check for common patterns in message
  const message = error.message?.toLowerCase() || '';

  if (message.includes('unauthorized') || message.includes('authentication')) {
    return 'AUTHENTICATION_ERROR';
  }
  if (message.includes('forbidden') || message.includes('permission')) {
    return 'AUTHORIZATION_ERROR';
  }
  if (message.includes('not found') || message.includes('does not exist')) {
    return 'NOT_FOUND';
  }
  if (message.includes('validation') || message.includes('invalid')) {
    return 'VALIDATION_ERROR';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'TIMEOUT';
  }
  if (message.includes('database') || message.includes('query') || message.includes('sql')) {
    return 'DATABASE_ERROR';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'RATE_LIMITED';
  }
  if (message.includes('unavailable') || message.includes('service')) {
    return 'SERVICE_UNAVAILABLE';
  }
  if (message.includes('network') || message.includes('connection')) {
    return 'NETWORK_ERROR';
  }

  // Check if error has a code property
  const errorWithCode = error as Error & { code?: string };
  if (errorWithCode.code && typeof errorWithCode.code === 'string') {
    const code = errorWithCode.code.toUpperCase();
    if (SAFE_ERROR_MESSAGES[code]) {
      return code;
    }
  }

  return 'INTERNAL_ERROR';
}

/**
 * Sanitize an error for safe client consumption
 *
 * Full error details are logged server-side for debugging.
 * Only sanitized, generic information is returned for clients.
 *
 * @param error - The error to sanitize
 * @param requestId - Optional request ID for correlation (generated if not provided)
 * @returns Sanitized error safe to return to clients
 */
export function sanitizeError(error: Error, requestId?: string): SanitizedError {
  const config = getSecurityConfig();
  const mode = getSecurityMode();
  const correlationId = requestId || generateRequestId();

  // Always log full error details server-side
  logger.error(
    {
      requestId: correlationId,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode: (error as Error & { code?: string }).code,
      mode,
    },
    `Error occurred [${correlationId}]: ${error.message}`
  );

  // In verbose mode (only development/testing), return more details
  if (config.allowVerboseErrors) {
    return {
      code: detectErrorCode(error),
      message: sanitizeErrorMessage(error.message),
      requestId: correlationId,
    };
  }

  // In production/staging, return only generic safe messages
  const code = detectErrorCode(error);
  const safeMessage = SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES['INTERNAL_ERROR'];

  return {
    code,
    message: safeMessage,
    requestId: correlationId,
  };
}

/**
 * Generate a unique request ID for error correlation
 */
export function generateRequestId(): string {
  return `req_${randomUUID()}`;
}

/**
 * Create an error response object for HTTP responses
 *
 * @param error - The error to convert
 * @param requestId - Request ID for correlation
 * @param statusCode - HTTP status code (determined from error if not provided)
 * @returns Error response object
 */
export function createErrorResponse(
  error: Error,
  requestId?: string,
  statusCode?: number
): {
  statusCode: number;
  body: SanitizedError;
} {
  const sanitized = sanitizeError(error, requestId);

  // Determine status code from error code if not provided
  const httpStatus = statusCode || getHttpStatusFromCode(sanitized.code);

  return {
    statusCode: httpStatus,
    body: sanitized,
  };
}

/**
 * Map error codes to HTTP status codes
 */
function getHttpStatusFromCode(code: string): number {
  const statusMap: Record<string, number> = {
    INTERNAL_ERROR: 500,
    DATABASE_ERROR: 500,
    AUTHENTICATION_ERROR: 401,
    AUTHORIZATION_ERROR: 403,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    RATE_LIMITED: 429,
    SERVICE_UNAVAILABLE: 503,
    TIMEOUT: 504,
    NETWORK_ERROR: 502,
  };

  return statusMap[code] || 500;
}

/**
 * Wrap an async function with error sanitization
 *
 * @param fn - The async function to wrap
 * @param requestId - Request ID for error correlation
 * @returns Wrapped function that sanitizes errors
 */
export function withErrorSanitization<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  requestId?: string
): (...args: Parameters<T>) => Promise<ReturnType<T> | SanitizedError> {
  return async (...args: Parameters<T>): Promise<ReturnType<T> | SanitizedError> => {
    try {
      return await fn(...args) as ReturnType<T>;
    } catch (error) {
      if (error instanceof Error) {
        throw sanitizeError(error, requestId);
      }
      throw sanitizeError(new Error(String(error)), requestId);
    }
  };
}

/**
 * Check if an object is a SanitizedError
 */
export function isSanitizedError(obj: unknown): obj is SanitizedError {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate['code'] === 'string' &&
    typeof candidate['message'] === 'string' &&
    typeof candidate['requestId'] === 'string' &&
    !('stack' in candidate)
  );
}
