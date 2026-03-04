/**
 * API Middleware Barrel Export
 *
 * Exports all middleware components for API hardening:
 * - Validation middleware (Zod-based input validation)
 * - Rate limiting middleware (per-tenant and per-endpoint)
 * - Security middleware (headers, request ID, logging)
 * - API key enforcement middleware (API key auth with JWT integration)
 * - DPoP enforcement middleware (sender-constrained tokens per RFC 9449)
 *
 * @packageDocumentation
 */

// Validation middleware
export {
  validateBody,
  validateQuery,
  validateParams,
  validateRequest,
  registerValidationPlugin,
  type ValidationOptions,
  type ValidationErrorDetail,
  type ZodSchema,
  type ZodError,
} from './validation.js';

// Rate limiting middleware
export {
  rateLimit,
  rateLimitPerTenant,
  rateLimitByMethod,
  registerRateLimitPlugin,
  getRateLimitStore,
  resetRateLimitStore,
  getRateLimitStats,
  resetTenantRateLimit,
  type RateLimitConfig,
  type TenantRateLimitConfig,
  type RateLimitResult,
} from './rateLimit.js';

// Security middleware
export {
  securityHeaders,
  requestIdInjection,
  requestLogging,
  combinedSecurityMiddleware,
  registerSecurityPlugin,
  maskSensitiveData,
  timingSafeEqual,
  type SecurityHeadersConfig,
  type CorsConfig,
  type CspConfig,
  type HstsConfig,
  type RequestLoggingConfig,
} from './security.js';

// API key enforcement middleware
export {
  apiKeyEnforcementPlugin,
  createRouteAuth,
  requireApiKeyAuth,
  requireJwtOrApiKey,
  // Re-exports from api-keys middleware
  apiKeyMiddleware,
  requireScopes,
  getApiKey,
  hasApiKey,
  getApiKeyTenantId,
  type AuthMethod,
  type RouteAuthConfig,
  type RoutePattern,
  type ApiKeyEnforcementOptions,
} from './api-key-enforcement.js';

// DPoP enforcement middleware
export {
  dpopEnforcementPlugin,
  dpopRequired,
  dpopOptional,
  dpopNone,
  requireDPoP,
  optionalDPoP,
  hasDPoPProof,
  getDPoPKeyThumbprint,
  getDPoPContext,
  dpopValidationFailed,
  // Re-exports from DPoP service
  DPoPService,
  DPoPError,
  createDPoPService,
  type DPoPEnforcementMode,
  type RouteDPoPConfig,
  type DPoPRoutePattern,
  type DPoPEnforcementOptions,
  type DPoPContext,
  type DPoPConfig,
  type DPoPVerificationResult,
  type JTICache,
  type TrustTier,
} from './dpop-enforcement.js';

// Redis-backed distributed rate limiting
export {
  RedisRateLimiter,
  createRateLimiter,
  redisRateLimitPlugin,
  redisRateLimitPerUser,
  redisRateLimitPerIp,
  redisRateLimitPerTenant,
  getRedisRateLimiter,
  resetRedisRateLimiter,
  type RedisRateLimiterConfig,
  type RateLimitWindow,
  type MultiWindowRateLimitConfig,
  type RateLimitCheckResult,
  type WindowResult,
  type RateLimiterFactoryOptions,
  type RedisRateLimitPluginOptions,
} from './redis-rate-limiter.js';

// API metrics middleware
export {
  metricsMiddleware,
  createApiTimer,
  type MetricsMiddlewareOptions,
} from './metrics.js';

// Webhook signature verification middleware
export {
  createWebhookVerifyMiddleware,
  webhookVerifyPlugin,
  verifyRequestSignature,
  getWebhookSecurityDocumentation,
  WEBHOOK_VERIFICATION_SAMPLE_CODE,
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  type WebhookVerifyConfig,
  type WebhookVerifyResult,
} from './webhook-verify.js';

// Comprehensive rate limits
export {
  rateLimitsPlugin,
  comprehensiveRateLimit,
  createEndpointRateLimit,
  getRateLimitStatus,
  getUserRateLimitStore,
  resetUserRateLimitStore,
  rateLimitConfig,
  defaultMultipliers,
  RATE_LIMIT_BYPASS_PERMISSION,
  type EndpointRateLimitConfig,
  type UserType,
  type RateLimitMultipliers,
  type RateLimitStatus,
  type RateLimitsPluginOptions,
} from './rate-limits.js';

// Audit middleware
export {
  // Factory and plugin
  createAuditMiddleware,
  auditMiddlewarePlugin,

  // Route decorators
  withAudit,
  captureBeforeState,
  recordAuditEvent,
  recordAccessDeniedEvent,

  // Types
  type AuditEventConfig,
  type AuditContext,
  type AuditMiddlewareOptions,
  MUTATION_METHODS,
  type MutationMethod,
} from './audit.js';
