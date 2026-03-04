/**
 * API Key Management Type Definitions
 *
 * Defines types, interfaces, and Zod schemas for API key management
 * including creation, validation, scopes, and rate limiting.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// API KEY SCOPES
// =============================================================================

/**
 * API key scopes defining access levels
 */
export const ApiKeyScope = {
  /** Read-only access to resources */
  READ: 'read',
  /** Write access (create, update, delete) */
  WRITE: 'write',
  /** Administrative operations */
  ADMIN: 'admin',
  /** Webhook management */
  WEBHOOK: 'webhook',
  /** Integration access (external systems) */
  INTEGRATION: 'integration',
} as const;

export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const apiKeyScopeSchema = z.nativeEnum(ApiKeyScope);

export const API_KEY_SCOPES = Object.values(ApiKeyScope);

// =============================================================================
// API KEY STATUS
// =============================================================================

/**
 * API key status
 */
export const ApiKeyStatus = {
  /** Key is active and can be used */
  ACTIVE: 'active',
  /** Key is revoked and cannot be used */
  REVOKED: 'revoked',
  /** Key has expired */
  EXPIRED: 'expired',
} as const;

export type ApiKeyStatus = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];

export const apiKeyStatusSchema = z.nativeEnum(ApiKeyStatus);

// =============================================================================
// RATE LIMIT CONFIG
// =============================================================================

/**
 * Rate limit configuration for an API key
 */
export interface ApiKeyRateLimit {
  /** Maximum requests per minute */
  requestsPerMinute: number;
  /** Maximum requests per hour */
  requestsPerHour: number;
  /** Maximum burst requests (per second) */
  burstLimit: number;
}

export const apiKeyRateLimitSchema = z.object({
  requestsPerMinute: z.number().int().positive().default(60),
  requestsPerHour: z.number().int().positive().default(1000),
  burstLimit: z.number().int().positive().default(10),
});

/**
 * Default rate limits for API keys
 */
export const DEFAULT_API_KEY_RATE_LIMIT: ApiKeyRateLimit = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  burstLimit: 10,
};

// =============================================================================
// API KEY INTERFACE
// =============================================================================

/**
 * Stored API key record (never contains raw key)
 */
export interface ApiKey {
  /** Unique identifier */
  id: string;
  /** Human-readable name for the key */
  name: string;
  /** SHA-256 hash of the full key (for validation) */
  hashedKey: string;
  /** First 8 characters of the key (for lookup/display) */
  prefix: string;
  /** Tenant ID that owns this key */
  tenantId: string;
  /** Granted scopes */
  scopes: ApiKeyScope[];
  /** Rate limit configuration */
  rateLimit: ApiKeyRateLimit;
  /** Key status */
  status: ApiKeyStatus;
  /** Expiration timestamp (null = never expires) */
  expiresAt: Date | null;
  /** Creation timestamp */
  createdAt: Date;
  /** Last usage timestamp */
  lastUsedAt: Date | null;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** User ID that created this key */
  createdBy: string;
  /** Description of key purpose */
  description?: string;
  /** IP whitelist (if set, only these IPs can use the key) */
  allowedIps?: string[];
}

export const apiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  hashedKey: z.string().min(1),
  prefix: z.string().length(8),
  tenantId: z.string().min(1),
  scopes: z.array(apiKeyScopeSchema).min(1),
  rateLimit: apiKeyRateLimitSchema,
  status: apiKeyStatusSchema,
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  metadata: z.record(z.unknown()),
  createdBy: z.string().min(1),
  description: z.string().max(1000).optional(),
  allowedIps: z.array(z.string().ip()).optional(),
});

// =============================================================================
// CREATE API KEY INPUT
// =============================================================================

/**
 * Input for creating a new API key
 */
export interface CreateApiKeyInput {
  /** Human-readable name for the key */
  name: string;
  /** Tenant ID that will own this key */
  tenantId: string;
  /** Scopes to grant (must not be empty) */
  scopes: ApiKeyScope[];
  /** Optional rate limit override */
  rateLimit?: Partial<ApiKeyRateLimit>;
  /** Expiration time in days (null = never expires) */
  expiresInDays?: number | null;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
  /** User ID creating this key */
  createdBy: string;
  /** Description of key purpose */
  description?: string;
  /** IP whitelist */
  allowedIps?: string[];
}

export const createApiKeyInputSchema = z.object({
  name: z.string().min(1).max(255),
  tenantId: z.string().min(1),
  scopes: z.array(apiKeyScopeSchema).min(1),
  rateLimit: apiKeyRateLimitSchema.partial().optional(),
  expiresInDays: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().min(1),
  description: z.string().max(1000).optional(),
  allowedIps: z.array(z.string().ip()).optional(),
});

// =============================================================================
// UPDATE API KEY INPUT
// =============================================================================

/**
 * Input for updating an existing API key
 */
export interface UpdateApiKeyInput {
  /** New name (optional) */
  name?: string;
  /** New scopes (optional) */
  scopes?: ApiKeyScope[];
  /** New rate limit (optional) */
  rateLimit?: Partial<ApiKeyRateLimit>;
  /** New metadata (merged with existing) */
  metadata?: Record<string, unknown>;
  /** New description */
  description?: string;
  /** New IP whitelist */
  allowedIps?: string[];
  /** New status */
  status?: ApiKeyStatus;
}

export const updateApiKeyInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(apiKeyScopeSchema).min(1).optional(),
  rateLimit: apiKeyRateLimitSchema.partial().optional(),
  metadata: z.record(z.unknown()).optional(),
  description: z.string().max(1000).optional(),
  allowedIps: z.array(z.string().ip()).optional(),
  status: apiKeyStatusSchema.optional(),
});

// =============================================================================
// API KEY VALIDATION RESULT
// =============================================================================

/**
 * Result of validating an API key
 */
export interface ApiKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** The validated API key (if valid) */
  apiKey?: ApiKey;
  /** Error message (if invalid) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: ApiKeyValidationErrorCode;
}

/**
 * Validation error codes
 */
export const ApiKeyValidationErrorCode = {
  /** Key not found */
  NOT_FOUND: 'NOT_FOUND',
  /** Key has been revoked */
  REVOKED: 'REVOKED',
  /** Key has expired */
  EXPIRED: 'EXPIRED',
  /** Invalid key format */
  INVALID_FORMAT: 'INVALID_FORMAT',
  /** Key hash mismatch */
  HASH_MISMATCH: 'HASH_MISMATCH',
  /** IP not in whitelist */
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
  /** Insufficient scope */
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  /** Rate limit exceeded */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ApiKeyValidationErrorCode =
  (typeof ApiKeyValidationErrorCode)[keyof typeof ApiKeyValidationErrorCode];

export const apiKeyValidationResultSchema = z.object({
  valid: z.boolean(),
  apiKey: apiKeySchema.optional(),
  error: z.string().optional(),
  errorCode: z.nativeEnum(ApiKeyValidationErrorCode).optional(),
});

// =============================================================================
// RATE LIMIT STATE
// =============================================================================

/**
 * Rate limit tracking state for an API key
 */
export interface ApiKeyRateLimitState {
  /** Key ID */
  keyId: string;
  /** Current minute window */
  minute: {
    count: number;
    resetAt: number;
  };
  /** Current hour window */
  hour: {
    count: number;
    resetAt: number;
  };
  /** Current second window (burst) */
  second: {
    count: number;
    resetAt: number;
  };
}

/**
 * Rate limit check result
 */
export interface ApiKeyRateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests */
  remaining: {
    minute: number;
    hour: number;
    burst: number;
  };
  /** Reset timestamps */
  resetAt: {
    minute: number;
    hour: number;
    burst: number;
  };
  /** Retry after seconds (if rate limited) */
  retryAfter?: number;
}

// =============================================================================
// API KEY CREATION RESULT
// =============================================================================

/**
 * Result of creating an API key
 * Includes the raw key which is shown only once
 */
export interface ApiKeyCreationResult {
  /** The created API key record */
  apiKey: ApiKey;
  /** The raw API key (shown only once, never stored) */
  rawKey: string;
}

// =============================================================================
// API KEY LIST FILTERS
// =============================================================================

/**
 * Filters for listing API keys
 */
export interface ApiKeyListFilters {
  /** Filter by tenant */
  tenantId: string;
  /** Filter by status */
  status?: ApiKeyStatus;
  /** Filter by scope (keys with this scope) */
  scope?: ApiKeyScope;
  /** Filter by creator */
  createdBy?: string;
  /** Pagination limit */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

export const apiKeyListFiltersSchema = z.object({
  tenantId: z.string().min(1),
  status: apiKeyStatusSchema.optional(),
  scope: apiKeyScopeSchema.optional(),
  createdBy: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// =============================================================================
// API KEY AUDIT EVENT TYPES
// =============================================================================

/**
 * Audit event types for API key operations
 */
export const ApiKeyAuditEventType = {
  CREATED: 'api_key.created',
  UPDATED: 'api_key.updated',
  REVOKED: 'api_key.revoked',
  DELETED: 'api_key.deleted',
  VALIDATED: 'api_key.validated',
  VALIDATION_FAILED: 'api_key.validation_failed',
  RATE_LIMITED: 'api_key.rate_limited',
  ROTATED: 'api_key.rotated',
} as const;

export type ApiKeyAuditEventType =
  (typeof ApiKeyAuditEventType)[keyof typeof ApiKeyAuditEventType];

// =============================================================================
// API KEY CONTEXT (for middleware)
// =============================================================================

/**
 * API key context attached to requests
 */
export interface ApiKeyContext {
  /** The validated API key */
  apiKey: ApiKey;
  /** Rate limit state */
  rateLimitState: ApiKeyRateLimitResult;
  /** Validation timestamp */
  validatedAt: Date;
}

// =============================================================================
// KEY FORMAT
// =============================================================================

/**
 * API key format: vak_${prefix}_${secret}
 * - vak: Vorion API Key prefix
 * - prefix: 8 character identifier for lookup
 * - secret: 43 character base64url encoded random bytes
 */
export const API_KEY_PREFIX = 'vak';
export const API_KEY_PREFIX_LENGTH = 8;
export const API_KEY_SECRET_LENGTH = 43; // 32 bytes = 43 chars in base64url

/**
 * Regex pattern for validating API key format
 */
export const API_KEY_PATTERN = /^vak_[a-zA-Z0-9]{8}_[a-zA-Z0-9_-]{43}$/;
