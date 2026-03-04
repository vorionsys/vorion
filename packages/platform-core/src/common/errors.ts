/**
 * Typed Error Classes for Vorion
 *
 * Provides structured error types with HTTP status codes for better error handling,
 * observability, and programmatic error discrimination.
 *
 * @packageDocumentation
 */

/**
 * Base error class for all Vorion errors.
 * Extends Error with structured metadata for API responses and logging.
 */
export class VorionError extends Error {
  /** Error code for programmatic identification */
  code: string;
  /** HTTP status code for API responses */
  statusCode: number;
  /** Additional error details for debugging */
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'VorionError';
    this.code = 'VORION_ERROR';
    this.statusCode = 500;
    if (details !== undefined) {
      this.details = details;
    }

    // Maintains proper stack trace for where our error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to a JSON-serializable object for API responses
   */
  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      code: this.code,
      message: this.message,
    };
    if (this.details) {
      json.details = this.details;
    }
    return json;
  }
}

/**
 * Validation error for invalid input data.
 * HTTP 400 Bad Request
 */
export class ValidationError extends VorionError {
  override code = 'VALIDATION_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources.
 * HTTP 404 Not Found
 */
export class NotFoundError extends VorionError {
  override code = 'NOT_FOUND';
  override statusCode = 404;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Unauthorized error for authentication failures.
 * HTTP 401 Unauthorized
 */
export class UnauthorizedError extends VorionError {
  override code = 'UNAUTHORIZED';
  override statusCode = 401;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden error for authorization failures.
 * HTTP 403 Forbidden
 */
export class ForbiddenError extends VorionError {
  override code = 'FORBIDDEN';
  override statusCode = 403;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Conflict error for resource state conflicts.
 * HTTP 409 Conflict
 */
export class ConflictError extends VorionError {
  override code = 'CONFLICT';
  override statusCode = 409;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ConflictError';
  }
}

/**
 * Rate limit error when request limits are exceeded.
 * HTTP 429 Too Many Requests
 */
export class RateLimitError extends VorionError {
  override code = 'RATE_LIMIT_EXCEEDED';
  override statusCode = 429;

  /** Seconds until rate limit resets */
  retryAfter?: number;

  constructor(message: string, retryAfter?: number, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'RateLimitError';
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }

  override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    if (this.retryAfter !== undefined) {
      json.retryAfter = this.retryAfter;
    }
    return json;
  }
}

/**
 * Configuration error for invalid or missing configuration.
 * HTTP 500 Internal Server Error
 */
export class ConfigurationError extends VorionError {
  override code = 'CONFIGURATION_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Encryption error for encryption/decryption failures.
 * HTTP 500 Internal Server Error
 */
export class EncryptionError extends VorionError {
  override code = 'ENCRYPTION_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'EncryptionError';
  }
}

/**
 * Escalation error for escalation workflow failures.
 * HTTP 400 Bad Request
 */
export class EscalationError extends VorionError {
  override code = 'ESCALATION_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'EscalationError';
  }
}

/**
 * Database error for database operation failures.
 * HTTP 500 Internal Server Error
 */
export class DatabaseError extends VorionError {
  override code = 'DATABASE_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'DatabaseError';
  }
}

/**
 * External service error for third-party service failures.
 * HTTP 502 Bad Gateway
 */
export class ExternalServiceError extends VorionError {
  override code = 'EXTERNAL_SERVICE_ERROR';
  override statusCode = 502;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ExternalServiceError';
  }
}

/**
 * Timeout error for operation timeouts.
 * HTTP 504 Gateway Timeout
 */
export class TimeoutError extends VorionError {
  override code = 'TIMEOUT';
  override statusCode = 504;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'TimeoutError';
  }
}

/**
 * Type guard to check if an error is a VorionError
 */
export function isVorionError(error: unknown): error is VorionError {
  return error instanceof VorionError;
}

/**
 * Helper to wrap unknown errors in a VorionError
 */
export function wrapError(error: unknown, fallbackMessage = 'An unexpected error occurred'): VorionError {
  if (isVorionError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new VorionError(error.message, { originalError: error.name });
  }

  return new VorionError(fallbackMessage, { originalError: String(error) });
}

/**
 * Repository error for data access layer failures.
 * HTTP 500 Internal Server Error
 */
export class RepositoryError extends VorionError {
  override code = 'REPOSITORY_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly operation: string,
    public readonly entity?: string,
    details?: Record<string, unknown>
  ) {
    super(message, { operation, entity, ...details });
    this.name = 'RepositoryError';
  }
}

/**
 * Service error for business logic failures.
 * HTTP 500 Internal Server Error
 */
export class ServiceError extends VorionError {
  override code = 'SERVICE_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly service: string,
    public readonly operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, { service, operation, ...details });
    this.name = 'ServiceError';
  }
}

/**
 * Integration error for external service failures.
 * HTTP 502 Bad Gateway
 */
export class IntegrationError extends VorionError {
  override code = 'INTEGRATION_ERROR';
  override statusCode = 502;

  constructor(
    message: string,
    public readonly integration: string,
    public readonly operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, { integration, operation, ...details });
    this.name = 'IntegrationError';
  }
}

/**
 * Queue error for message queue operations.
 * HTTP 500 Internal Server Error
 */
export class QueueError extends VorionError {
  override code = 'QUEUE_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly queue: string,
    public readonly operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, { queue, operation, ...details });
    this.name = 'QueueError';
  }
}

/**
 * Cache error for caching layer failures.
 * HTTP 500 Internal Server Error
 */
export class CacheError extends VorionError {
  override code = 'CACHE_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, { operation, ...details });
    this.name = 'CacheError';
  }
}

/**
 * Governance error for policy evaluation failures.
 * HTTP 500 Internal Server Error
 */
export class GovernanceError extends VorionError {
  override code = 'GOVERNANCE_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, { operation, ...details });
    this.name = 'GovernanceError';
  }
}

/**
 * Trust engine error for trust calculation failures.
 * HTTP 500 Internal Server Error
 */
export class TrustEngineError extends VorionError {
  override code = 'TRUST_ENGINE_ERROR';
  override statusCode = 500;

  constructor(
    message: string,
    public readonly operation: string,
    public readonly entityId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, { operation, entityId, ...details });
    this.name = 'TrustEngineError';
  }
}

/**
 * Wrap an error with operation context for better debugging.
 * Re-throws VorionErrors with additional context, wraps other errors.
 */
export function wrapErrorWithContext(
  error: unknown,
  context: { operation: string; component: string; details?: Record<string, unknown> }
): VorionError {
  const wrappedDetails = {
    operation: context.operation,
    component: context.component,
    ...context.details,
  };

  if (isVorionError(error)) {
    // Add context to existing VorionError
    error.details = { ...error.details, ...wrappedDetails };
    return error;
  }

  if (error instanceof Error) {
    return new VorionError(
      `${context.component}.${context.operation} failed: ${error.message}`,
      { originalError: error.name, stack: error.stack, ...wrappedDetails }
    );
  }

  return new VorionError(
    `${context.component}.${context.operation} failed: ${String(error)}`,
    { originalError: String(error), ...wrappedDetails }
  );
}
