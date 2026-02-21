/**
 * Service-to-Service Authentication Module
 *
 * Provides comprehensive service-to-service authentication for Vorion.
 * Supports HMAC signature-based authentication and JWT token issuance.
 *
 * Features:
 * - Service account management (create, revoke, rotate secrets)
 * - HMAC-SHA256 request signing and verification
 * - Short-lived JWT tokens for authenticated services
 * - IP whitelist validation
 * - Permission-based access control
 *
 * @packageDocumentation
 * @module security/service-auth
 */

// =============================================================================
// Service Account Management
// =============================================================================

export {
  // Types
  ServiceAccountStatus,
  type ServiceAccount,
  serviceAccountSchema,
  type CreateServiceAccountInput,
  createServiceAccountInputSchema,
  type ServiceAccountCreationResult,
  type SecretRotationResult,
  type UpdateServiceAccountInput,
  updateServiceAccountInputSchema,

  // Errors
  ServiceAccountError,
  ServiceAccountNotFoundError,
  ServiceAccountRevokedError,
  ServiceAccountSuspendedError,

  // Constants
  SERVICE_CLIENT_ID_PREFIX,

  // Utility functions
  generateClientSecret,
  generateClientId,
  hashClientSecret,
  verifyClientSecret,

  // Store interface
  type IServiceAccountStore,
  InMemoryServiceAccountStore,

  // Manager
  ServiceAccountManager,
  type ServiceAccountManagerConfig,

  // Singleton management
  getServiceAccountStore,
  setServiceAccountStore,
  getServiceAccountManager,
  createServiceAccountManager,
  resetServiceAccountSingletons,
} from './service-account.js';

// =============================================================================
// Service Token Management
// =============================================================================

export {
  // Types
  type ServiceTokenPayload,
  serviceTokenPayloadSchema,
  type ServiceSignature,
  serviceSignatureSchema,
  type TokenVerificationResult,
  tokenVerificationResultSchema,
  type SignatureVerificationResult,

  // Errors
  ServiceTokenError,
  TokenExpiredError,
  InvalidSignatureError,
  SignatureTimestampError,

  // Constants
  DEFAULT_TOKEN_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
  MIN_TOKEN_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  SERVICE_TOKEN_ISSUER,
  SERVICE_AUTH_HEADERS,

  // Service
  ServiceTokenService,
  type ServiceTokenServiceConfig,
  serviceTokenServiceConfigSchema,

  // Singleton management
  initializeServiceTokenService,
  getServiceTokenService,
  createServiceTokenService,
  resetServiceTokenService,

  // Utility functions
  createServiceAuthHeaders,
  extractServiceIdFromBearer,
} from './service-token.js';

// =============================================================================
// Service Authentication Middleware
// =============================================================================

export {
  // Types
  type ServiceAuthContext,
  type ServiceAuthenticatedRequest,
  type ServiceAuthMiddlewareOptions,

  // Errors
  ServiceAuthError,
  MissingAuthHeadersError,
  InvalidServiceSignatureError,
  IpNotAllowedError,
  InsufficientPermissionsError,

  // Middleware factory
  createServiceAuthMiddleware,

  // Helper middleware
  requireServicePermissions,
  requireAnyServicePermission,
  requireServiceTenant,

  // Request helpers
  getServiceAuth,
  requireServiceAuth,
  hasServiceAuth,
  getServiceClientId,
  getServiceTenantId,
  getServicePermissions,
  serviceHasPermission,

  // Fastify plugin
  serviceAuthPlugin,
  type ServiceAuthPluginOptions,
} from './service-auth-middleware.js';
