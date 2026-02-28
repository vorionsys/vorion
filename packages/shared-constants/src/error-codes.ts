/**
 * @vorionsys/shared-constants - Error Codes
 *
 * Standardized error codes across all Vorion ecosystem APIs
 * Ensures consistent error handling and reporting
 *
 * @see https://cognigate.dev/docs/errors
 */

// =============================================================================
// ERROR CATEGORIES
// =============================================================================

export enum ErrorCategory {
  /** Authentication and authorization errors (4xx) */
  AUTH = "auth",

  /** Validation and input errors (4xx) */
  VALIDATION = "validation",

  /** Rate limiting and quota errors (429) */
  RATE_LIMIT = "rate_limit",

  /** Resource not found errors (404) */
  NOT_FOUND = "not_found",

  /** Trust and governance errors (4xx) */
  TRUST = "trust",

  /** Server and internal errors (5xx) */
  SERVER = "server",

  /** External service errors (5xx) */
  EXTERNAL = "external",

  /** Configuration errors */
  CONFIG = "config",
}

// =============================================================================
// ERROR CODE DEFINITIONS
// =============================================================================

export interface ErrorDefinition {
  /** Unique error code */
  code: string;

  /** HTTP status code */
  httpStatus: number;

  /** Error category */
  category: ErrorCategory;

  /** Human-readable message template */
  message: string;

  /** Whether this error is retryable */
  retryable: boolean;

  /** Documentation URL for this error */
  docsUrl?: string;
}

// =============================================================================
// AUTHENTICATION ERRORS (1xxx)
// =============================================================================

export const AUTH_ERRORS = {
  MISSING_API_KEY: {
    code: "E1001",
    httpStatus: 401,
    category: ErrorCategory.AUTH,
    message: "API key is missing. Include it in the Authorization header.",
    retryable: false,
    docsUrl: "https://cognigate.dev/docs/authentication",
  },

  INVALID_API_KEY: {
    code: "E1002",
    httpStatus: 401,
    category: ErrorCategory.AUTH,
    message: "API key is invalid or has been revoked.",
    retryable: false,
    docsUrl: "https://cognigate.dev/docs/authentication",
  },

  EXPIRED_API_KEY: {
    code: "E1003",
    httpStatus: 401,
    category: ErrorCategory.AUTH,
    message: "API key has expired. Generate a new key.",
    retryable: false,
    docsUrl: "https://cognigate.dev/docs/authentication",
  },

  INSUFFICIENT_PERMISSIONS: {
    code: "E1004",
    httpStatus: 403,
    category: ErrorCategory.AUTH,
    message: "Insufficient permissions for this operation.",
    retryable: false,
  },

  AGENT_NOT_AUTHORIZED: {
    code: "E1005",
    httpStatus: 403,
    category: ErrorCategory.AUTH,
    message: "Agent is not authorized for this action.",
    retryable: false,
  },

  TOKEN_EXPIRED: {
    code: "E1006",
    httpStatus: 401,
    category: ErrorCategory.AUTH,
    message: "Authentication token has expired.",
    retryable: false,
  },

  MFA_REQUIRED: {
    code: "E1007",
    httpStatus: 403,
    category: ErrorCategory.AUTH,
    message: "Multi-factor authentication is required for this operation.",
    retryable: false,
  },
} as const;

// =============================================================================
// VALIDATION ERRORS (2xxx)
// =============================================================================

export const VALIDATION_ERRORS = {
  INVALID_REQUEST: {
    code: "E2001",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Request body is invalid or malformed.",
    retryable: false,
  },

  MISSING_REQUIRED_FIELD: {
    code: "E2002",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Required field is missing: {field}",
    retryable: false,
  },

  INVALID_FIELD_TYPE: {
    code: "E2003",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Field {field} has invalid type. Expected {expected}.",
    retryable: false,
  },

  INVALID_FIELD_VALUE: {
    code: "E2004",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Field {field} has invalid value.",
    retryable: false,
  },

  PAYLOAD_TOO_LARGE: {
    code: "E2005",
    httpStatus: 413,
    category: ErrorCategory.VALIDATION,
    message: "Request payload exceeds maximum size of {maxSize}.",
    retryable: false,
  },

  INVALID_JSON: {
    code: "E2006",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Request body is not valid JSON.",
    retryable: false,
  },

  INVALID_CAR_ID: {
    code: "E2007",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message:
      "Invalid CAR ID format. Expected: car:domain/category/name:version",
    retryable: false,
    docsUrl: "https://carid.vorion.org/format",
  },

  INVALID_TRUST_SCORE: {
    code: "E2008",
    httpStatus: 400,
    category: ErrorCategory.VALIDATION,
    message: "Trust score must be between 0 and 1000.",
    retryable: false,
  },
} as const;

// =============================================================================
// RATE LIMIT ERRORS (3xxx)
// =============================================================================

export const RATE_LIMIT_ERRORS = {
  RATE_LIMIT_EXCEEDED: {
    code: "E3001",
    httpStatus: 429,
    category: ErrorCategory.RATE_LIMIT,
    message: "Rate limit exceeded. Retry after {retryAfter} seconds.",
    retryable: true,
  },

  QUOTA_EXCEEDED: {
    code: "E3002",
    httpStatus: 429,
    category: ErrorCategory.RATE_LIMIT,
    message: "Monthly quota exceeded. Upgrade your tier or wait for reset.",
    retryable: false,
  },

  CONCURRENT_LIMIT: {
    code: "E3003",
    httpStatus: 429,
    category: ErrorCategory.RATE_LIMIT,
    message: "Too many concurrent requests. Max burst: {burstLimit}.",
    retryable: true,
  },

  DAILY_LIMIT_EXCEEDED: {
    code: "E3004",
    httpStatus: 429,
    category: ErrorCategory.RATE_LIMIT,
    message: "Daily request limit exceeded. Resets at midnight UTC.",
    retryable: true,
  },
} as const;

// =============================================================================
// NOT FOUND ERRORS (4xxx)
// =============================================================================

export const NOT_FOUND_ERRORS = {
  RESOURCE_NOT_FOUND: {
    code: "E4001",
    httpStatus: 404,
    category: ErrorCategory.NOT_FOUND,
    message: "Resource not found: {resourceType}/{resourceId}",
    retryable: false,
  },

  AGENT_NOT_FOUND: {
    code: "E4002",
    httpStatus: 404,
    category: ErrorCategory.NOT_FOUND,
    message: "Agent not found: {agentId}",
    retryable: false,
  },

  PROOF_NOT_FOUND: {
    code: "E4003",
    httpStatus: 404,
    category: ErrorCategory.NOT_FOUND,
    message: "Proof not found: {proofId}",
    retryable: false,
  },

  ENDPOINT_NOT_FOUND: {
    code: "E4004",
    httpStatus: 404,
    category: ErrorCategory.NOT_FOUND,
    message: "API endpoint not found.",
    retryable: false,
  },

  ATTESTATION_NOT_FOUND: {
    code: "E4005",
    httpStatus: 404,
    category: ErrorCategory.NOT_FOUND,
    message: "Attestation not found: {attestationId}",
    retryable: false,
  },
} as const;

// =============================================================================
// TRUST & GOVERNANCE ERRORS (5xxx)
// =============================================================================

export const TRUST_ERRORS = {
  TRUST_TIER_INSUFFICIENT: {
    code: "E5001",
    httpStatus: 403,
    category: ErrorCategory.TRUST,
    message: "Trust tier {currentTier} insufficient. Required: {requiredTier}.",
    retryable: false,
    docsUrl: "https://basis.vorion.org/tiers",
  },

  CAPABILITY_NOT_AVAILABLE: {
    code: "E5002",
    httpStatus: 403,
    category: ErrorCategory.TRUST,
    message: "Capability {capability} not available at tier {tier}.",
    retryable: false,
    docsUrl: "https://cognigate.dev/docs/capabilities",
  },

  GOVERNANCE_DENIED: {
    code: "E5003",
    httpStatus: 403,
    category: ErrorCategory.TRUST,
    message: "Action denied by governance policy: {reason}.",
    retryable: false,
  },

  AGENT_SUSPENDED: {
    code: "E5004",
    httpStatus: 403,
    category: ErrorCategory.TRUST,
    message: "Agent is suspended. Contact support for reinstatement.",
    retryable: false,
  },

  PROOF_VERIFICATION_FAILED: {
    code: "E5005",
    httpStatus: 400,
    category: ErrorCategory.TRUST,
    message: "Proof verification failed: {reason}.",
    retryable: false,
  },

  ATTESTATION_INVALID: {
    code: "E5006",
    httpStatus: 400,
    category: ErrorCategory.TRUST,
    message: "Attestation is invalid or has expired.",
    retryable: false,
  },

  ESCALATION_REQUIRED: {
    code: "E5007",
    httpStatus: 403,
    category: ErrorCategory.TRUST,
    message: "Action requires human approval. Escalation ID: {escalationId}.",
    retryable: false,
  },
} as const;

// =============================================================================
// SERVER ERRORS (6xxx)
// =============================================================================

export const SERVER_ERRORS = {
  INTERNAL_ERROR: {
    code: "E6001",
    httpStatus: 500,
    category: ErrorCategory.SERVER,
    message: "An internal error occurred. Please try again later.",
    retryable: true,
  },

  SERVICE_UNAVAILABLE: {
    code: "E6002",
    httpStatus: 503,
    category: ErrorCategory.SERVER,
    message: "Service is temporarily unavailable. Please try again later.",
    retryable: true,
  },

  DATABASE_ERROR: {
    code: "E6003",
    httpStatus: 500,
    category: ErrorCategory.SERVER,
    message: "Database operation failed. Please try again later.",
    retryable: true,
  },

  MAINTENANCE_MODE: {
    code: "E6004",
    httpStatus: 503,
    category: ErrorCategory.SERVER,
    message: "Service is under maintenance. Expected completion: {eta}.",
    retryable: true,
  },
} as const;

// =============================================================================
// EXTERNAL SERVICE ERRORS (7xxx)
// =============================================================================

export const EXTERNAL_ERRORS = {
  BLOCKCHAIN_ERROR: {
    code: "E7001",
    httpStatus: 502,
    category: ErrorCategory.EXTERNAL,
    message: "Blockchain network error. Please try again later.",
    retryable: true,
  },

  UPSTREAM_TIMEOUT: {
    code: "E7002",
    httpStatus: 504,
    category: ErrorCategory.EXTERNAL,
    message: "Upstream service timed out.",
    retryable: true,
  },

  EXTERNAL_SERVICE_ERROR: {
    code: "E7003",
    httpStatus: 502,
    category: ErrorCategory.EXTERNAL,
    message: "External service error: {service}.",
    retryable: true,
  },
} as const;

// =============================================================================
// ALL ERROR CODES
// =============================================================================

export const ERROR_CODES = {
  ...AUTH_ERRORS,
  ...VALIDATION_ERRORS,
  ...RATE_LIMIT_ERRORS,
  ...NOT_FOUND_ERRORS,
  ...TRUST_ERRORS,
  ...SERVER_ERRORS,
  ...EXTERNAL_ERRORS,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get error definition by code
 */
export function getErrorByCode(code: string): ErrorDefinition | undefined {
  return Object.values(ERROR_CODES).find((e) => e.code === code);
}

/**
 * Get all errors by category
 */
export function getErrorsByCategory(
  category: ErrorCategory,
): ErrorDefinition[] {
  return Object.values(ERROR_CODES).filter((e) => e.category === category);
}

/**
 * Get all retryable errors
 */
export function getRetryableErrors(): ErrorDefinition[] {
  return Object.values(ERROR_CODES).filter((e) => e.retryable);
}

/**
 * Format error message with parameters
 */
export function formatErrorMessage(
  error: ErrorDefinition,
  params: Record<string, string | number>,
): string {
  let message = error.message;
  for (const [key, value] of Object.entries(params)) {
    message = message.replace(`{${key}}`, String(value));
  }
  return message;
}

/**
 * Create a structured error response
 */
export function createErrorResponse(
  error: ErrorDefinition,
  params?: Record<string, string | number>,
  requestId?: string,
) {
  return {
    error: {
      code: error.code,
      message: params ? formatErrorMessage(error, params) : error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.docsUrl && { docsUrl: error.docsUrl }),
      ...(requestId && { requestId }),
    },
    status: error.httpStatus,
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ErrorCode = keyof typeof ERROR_CODES;
