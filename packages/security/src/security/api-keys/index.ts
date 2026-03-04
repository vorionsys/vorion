/**
 * API Key Management Module
 *
 * Comprehensive API key management for the Vorion platform including:
 * - Cryptographically secure key generation
 * - Secure storage (hashed keys only)
 * - Timing-safe validation
 * - Scope-based access control
 * - Per-key rate limiting
 * - Key rotation support
 * - Audit logging integration
 *
 * Security Features:
 * - Keys are never stored or logged in raw form
 * - SHA-256 hashing for storage
 * - Timing-safe comparison to prevent timing attacks
 * - IP whitelisting support
 * - Automatic expiration handling
 *
 * @packageDocumentation
 * @module security/api-keys
 */

// =============================================================================
// TYPES
// =============================================================================

export {
  // Scope enum
  ApiKeyScope,
  apiKeyScopeSchema,
  API_KEY_SCOPES,

  // Status enum
  ApiKeyStatus,
  apiKeyStatusSchema,

  // Rate limit types
  type ApiKeyRateLimit,
  apiKeyRateLimitSchema,
  DEFAULT_API_KEY_RATE_LIMIT,

  // API key interface
  type ApiKey,
  apiKeySchema,

  // Input types
  type CreateApiKeyInput,
  createApiKeyInputSchema,
  type UpdateApiKeyInput,
  updateApiKeyInputSchema,

  // Validation types
  type ApiKeyValidationResult,
  ApiKeyValidationErrorCode,
  apiKeyValidationResultSchema,

  // Rate limit state types
  type ApiKeyRateLimitState,
  type ApiKeyRateLimitResult,

  // Creation result
  type ApiKeyCreationResult,

  // List filters
  type ApiKeyListFilters,
  apiKeyListFiltersSchema,

  // Audit event types
  ApiKeyAuditEventType,
  type ApiKeyAuditEventType as ApiKeyAuditEventTypeType,

  // Context type
  type ApiKeyContext,

  // Key format constants
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_LENGTH,
  API_KEY_PATTERN,
} from './types.js';

// =============================================================================
// STORE
// =============================================================================

export {
  // Store interface
  type IApiKeyStore,

  // In-memory implementation
  InMemoryApiKeyStore,

  // Factory functions (legacy - in-memory only)
  getApiKeyStore,
  createApiKeyStore,
  resetApiKeyStore,

  // Factory functions (production-ready)
  type ApiKeyStoreType,
  type ApiKeyStoreFactoryOptions,
  getStoreType,
  createApiKeyStoreFactory,
  getApiKeyStoreFactory,
  resetApiKeyStoreFactory,
} from './store.js';

// =============================================================================
// DATABASE STORE
// =============================================================================

export {
  // Database implementation
  DbApiKeyStore,

  // Factory functions
  getDbApiKeyStore,
  createDbApiKeyStore,
  resetDbApiKeyStore,
} from './db-store.js';

// =============================================================================
// CACHE
// =============================================================================

export {
  // Cache class
  ApiKeyMetadataCache,

  // Cache types
  type CachedApiKeyMetadata,
  type CacheInvalidationEvent,
  type CacheStats,

  // Factory functions
  getApiKeyMetadataCache,
  createApiKeyMetadataCache,
  resetApiKeyMetadataCache,
} from './cache.js';

// =============================================================================
// SERVICE
// =============================================================================

export {
  // Service class
  ApiKeyService,

  // Error classes
  ApiKeyError,
  ApiKeyValidationError,
  ApiKeyRateLimitError,

  // Dependencies interface
  type ApiKeyServiceDependencies,

  // Audit interface
  type IAuditLogger,

  // Factory functions
  getApiKeyService,
  createApiKeyService,
  resetApiKeyService,
} from './service.js';

// =============================================================================
// MIDDLEWARE
// =============================================================================

export {
  // Middleware factory
  apiKeyMiddleware,

  // Scope enforcement
  requireScopes,
  requireReadScope,
  requireWriteScope,
  requireAdminScope,
  requireWebhookScope,
  requireIntegrationScope,

  // Fastify plugin
  apiKeyPlugin,

  // Utility functions
  getApiKey,
  getApiKeyTenantId,
  hasApiKey,
  getApiKeyScopes,

  // Types
  type ApiKeyMiddlewareOptions,
  type ScopeRequirementOptions,
  type ApiKeyPluginOptions,
  type FastifyMiddleware as ApiKeyFastifyMiddleware,
} from './middleware.js';
