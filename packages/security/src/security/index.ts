/**
 * Security Hardening Module
 *
 * Comprehensive security controls for CAR ID specification compliance.
 * Implements critical security hardening requirements including:
 *
 * - DPoP (Demonstrating Proof-of-Possession) - RFC 9449
 * - TEE (Trusted Execution Environment) binding
 * - Pairwise DID generation for privacy
 * - Revocation management with SLA enforcement
 * - Token lifetime validation
 * - Token introspection (RFC 7662)
 *
 * Security Conformance Levels:
 * - SH-1 (Basic): DPoP required, short-lived tokens (T2)
 * - SH-2 (Standard): SH-1 + pairwise DIDs, recursive revocation (T3)
 * - SH-3 (Hardened): SH-2 + TEE binding, sync revocation checks (T4-T5)
 *
 * @packageDocumentation
 * @module security
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Trust Tier
  TrustTier,
  trustTierSchema,

  // Security Conformance
  SecurityConformanceLevel,
  securityConformanceLevelSchema,

  // DPoP Types
  type DPoPProof,
  type DPoPHeader,
  type DPoPConfig,
  type DPoPVerificationResult,
  dpopProofSchema,
  dpopHeaderSchema,
  dpopConfigSchema,
  dpopVerificationResultSchema,

  // TEE Types
  TEEPlatform,
  type TEEAttestation,
  type TEEKeyBinding,
  type TEEConfig,
  type TEEVerificationResult,
  teePlatformSchema,
  teeAttestationSchema,
  teeKeyBindingSchema,
  teeConfigSchema,
  teeVerificationResultSchema,

  // Pairwise DID Types
  DataClassification,
  PairwiseDerivationAlgorithm,
  type PairwiseDIDConfig,
  type PairwiseDerivation,
  dataClassificationSchema,
  pairwiseDerivationAlgorithmSchema,
  pairwiseDIDConfigSchema,
  pairwiseDerivationSchema,

  // Revocation Types
  RevocationStatusEnum,
  type RevocationSLA,
  type RevocationPropagationPolicy,
  type RevocationPropagation,
  type RevocationResult,
  type RevocationStatus,
  type RevocationEvent,
  DEFAULT_REVOCATION_SLAS,
  revocationSLASchema,
  revocationPropagationPolicySchema,
  revocationPropagationSchema,
  revocationResultSchema,
  revocationStatusSchema,
  revocationEventSchema,

  // Token Lifetime Types
  type TokenLifetimeConfig,
  DEFAULT_TOKEN_LIFETIME_CONFIG,
  tokenLifetimeConfigSchema,

  // Introspection Types
  type IntrospectionResult,
  introspectionResultSchema,

  // Security Context Types
  type AgentIdentity,
  type ActionRequest,
  type SecurityContext,
  type SecurityValidationResult,
  type SecurityValidationError,
  type PreRequestResult,
  type HighValueCheckResult,
  type SecurityRequirements,
  type IncomingRequest,
  type JTICache,
  type SecurityPluginOptions,
  agentIdentitySchema,
  actionRequestSchema,
  securityContextSchema,
  securityValidationResultSchema,
  securityValidationErrorSchema,
  preRequestResultSchema,
  highValueCheckResultSchema,
  securityRequirementsSchema,
  incomingRequestSchema,
  securityPluginOptionsSchema,

  // Utility Functions
  getSecurityRequirementsForTier,
} from './types.js';

// =============================================================================
// DPoP Service
// =============================================================================

export {
  DPoPService,
  DPoPError,
  createDPoPService,
} from './dpop.js';

// =============================================================================
// TEE Service
// =============================================================================

export {
  TEEBindingService,
  TEEError,
  TEEAttestationError,
  TEEKeyBindingError,
  createTEEBindingService,
} from './tee.js';

// =============================================================================
// Pairwise DID Service
// =============================================================================

export {
  PairwiseDIDService,
  PairwiseDIDError,
  createPairwiseDIDService,
} from './pairwise-did.js';

// =============================================================================
// Revocation Service
// =============================================================================

export {
  RevocationService,
  RevocationError,
  AgentRevokedError,
  createRevocationService,
  type RevocationEventCallback,
  type DelegationRegistry,
  type TokenService,
  type WebhookService,
} from './revocation.js';

// =============================================================================
// Token Lifetime Service
// =============================================================================

export {
  TokenLifetimeService,
  TokenLifetimeError,
  TokenExpiredError,
  TokenTTLTooLongError,
  createTokenLifetimeService,
  type TokenType,
  type JWTPayload,
  type TokenLifetimeValidationResult,
  HIGH_VALUE_OPERATIONS,
  type HighValueOperation,
} from './token-lifetime.js';

// =============================================================================
// Token Introspection Service
// =============================================================================

export {
  TokenIntrospectionService,
  IntrospectionError,
  TokenInactiveError,
  createTokenIntrospectionService,
  createMockIntrospectionService,
  type IntrospectionServiceOptions,
} from './introspection.js';

// =============================================================================
// Security Service (Main Coordinator)
// =============================================================================

export {
  SecurityService,
  SecurityValidationError as SecurityServiceValidationError,
  createSecurityService,
} from './security-service.js';

// =============================================================================
// Fastify Middleware
// =============================================================================

export {
  // Middleware factories
  dpopMiddleware,
  introspectionMiddleware,
  revocationMiddleware,
  securityContextMiddleware,
  markHighValueOperation,
  requireTier,
  requireDPoP,

  // Fastify plugin
  securityHardeningPlugin,

  // Types
  type FastifyMiddleware,
  type SecurityRequestContext,
} from './middleware.js';

// =============================================================================
// Security Configuration Validator
// =============================================================================

export {
  // Types
  type SecurityCheck,
  type SecurityCheckResult,
  type SecurityCheckCategory,
  type SecurityCheckSeverity,

  // Audit functions
  runSecurityAudit,
  assertSecureConfig,
  getSecurityAuditSummary,

  // Utilities
  calculateEntropy,
} from './config-validator.js';

// =============================================================================
// Security Mode (New)
// =============================================================================

export {
  getSecurityMode,
  getSecurityConfig,
  isProductionGrade,
  isDevelopmentMode,
  requireProductionSecurity,
  assertSecurityCondition,
  isSecurityFeatureAllowed,
  devOnlyDefault,
  allowEphemeralKey,
  validateSecretStrength,
  type SecurityMode,
  type SecurityModeConfig,
} from '../common/security-mode.js';

// =============================================================================
// Session Management (New)
// =============================================================================

export {
  SessionStore,
  getSessionStore,
  createSessionStore,
  type Session,
  type CreateSessionInput,
  type SessionStoreConfig,
} from './session-store.js';

export {
  SessionManager,
  getSessionManager,
  createSessionManager,
  extractFingerprintHeaders,
  type SessionManagerConfig,
  type SessionValidationResult,
  type SensitiveOperation,
  type RegenerateSessionOptions,
  type RequestHeaders as SessionRequestHeaders,
  type FingerprintValidationResult as SessionFingerprintValidationResult,
} from './session-manager.js';

// =============================================================================
// CSRF Protection (New)
// =============================================================================

export {
  CSRFProtection,
  getCSRFProtection,
  resetCSRFProtection,
  type CSRFConfig,
  type CSRFCookieOptions,
  type TokenValidationResult,
} from './csrf.js';

// =============================================================================
// Fingerprint Service (New)
// =============================================================================

export {
  FingerprintService,
  getFingerprintService,
  resetFingerprintService,
  type FingerprintConfig,
  type FingerprintResult,
  type FingerprintValidationResult,
  type RequestHeaders,
} from './fingerprint-service.js';

// =============================================================================
// Injection Detection (New)
// =============================================================================

export {
  InjectionDetector,
  createInjectionDetectionMiddleware,
  InjectionType,
  hasInjection,
  sanitizeInput,
  type InjectionDetectorConfig,
  type InjectionDetectionResult,
} from './injection-detector.js';

// =============================================================================
// Brute Force Protection (New)
// =============================================================================

export {
  BruteForceProtection,
  getBruteForceProtection,
  resetBruteForceProtection,
  createBruteForceMiddleware,
  type BruteForceConfig,
  type LoginAttempt,
  type LockoutStatus,
} from './brute-force.js';

// =============================================================================
// Password Policy (New)
// =============================================================================

export {
  PasswordPolicyEngine,
  getPasswordPolicyEngine,
  resetPasswordPolicyEngine,
  DEFAULT_PASSWORD_POLICY,
  NIST_PASSWORD_POLICY,
  type PasswordPolicy,
  type PasswordValidationResult,
} from './password-policy.js';

// =============================================================================
// Key Rotation (New)
// =============================================================================

export {
  KeyRotationManager,
  getKeyRotationManager,
  resetKeyRotationManager,
  type KeyType,
  type KeyMetadata,
  type KeyRotationConfig,
  type StoredKey,
  type RotationStatus,
} from './key-rotation.js';

// =============================================================================
// MFA (Multi-Factor Authentication)
// =============================================================================

export {
  // Types
  MfaMethod,
  MfaStatus,
  MFA_DEFAULTS,
  type MfaServiceConfig,
  type MfaMiddlewareOptions,
  type MfaEnrollmentResponse,
  type MfaEnrollmentCompleteResponse,
  type MfaStatusResponse,
  type MfaChallengeResponse,
  type MfaVerifyResponse,
  type MfaBackupCodesResponse,
  type UserMfaRecord,
  type MfaBackupCodeRecord,
  type MfaChallengeRecord,
  type MfaRequestContext,

  // Service
  MfaService,
  getMfaService,
  resetMfaService,
  createMfaService,
  MfaError,
  EnrollmentExpiredError,
  ChallengeExpiredError,
  TooManyAttemptsError,

  // Store
  MfaStore,
  getMfaStore,
  resetMfaStore,
  createMfaStore,

  // Middleware
  requireMfa,
  mfaContextMiddleware,
  requireMfaEnabled,

  // Schemas
  mfaMethodSchema,
  mfaStatusSchema,
  mfaEnrollmentResponseSchema,
  mfaEnrollmentCompleteResponseSchema,
  mfaStatusResponseSchema,
  mfaChallengeResponseSchema,
  mfaVerifyResponseSchema,
  mfaBackupCodesResponseSchema,
  mfaServiceConfigSchema,
} from './mfa/index.js';

// =============================================================================
// Request Integrity (New)
// =============================================================================

export {
  RequestIntegrity,
  getRequestIntegrity,
  resetRequestIntegrity,
  createSignatureHeaders,
  extractSignatureFromHeaders,
  INTEGRITY_HEADERS,
  DEFAULT_REQUEST_INTEGRITY_CONFIG,
  type SignedRequest,
  type RequestIntegrityConfig,
  type IntegrityVerificationResult,
  type IntegrityErrorCode,
  type SignRequestInput,
} from './request-integrity.js';

// =============================================================================
// Secure Memory (New)
// =============================================================================

export {
  SecureString,
  SecureBuffer,
  secureEnv,
  requireSecureEnv,
  secureRandomBytes,
  secureCompare,
  secureCompareBuffers,
  withSecureString,
  withSecureStringAsync,
  withSecureBuffer,
  withSecureBufferAsync,
  SecureMemoryError,
  MissingEnvironmentError,
} from './secure-memory.js';

// =============================================================================
// Error Sanitization (New)
// =============================================================================

export {
  ErrorSanitizer,
  getErrorSanitizer,
  resetErrorSanitizer,
  createErrorSanitizer,
  createErrorHandler,
  errorSanitizerPlugin,
  sanitizeErrorMessage,
  classifyError,
  generateSafeMessage,
  SENSITIVE_PATTERNS,
  DEFAULT_ERROR_MAPPINGS,
  type SanitizedError,
  type ErrorClassification,
  type ErrorSanitizerConfig,
  type ErrorCodeMapping,
  type ErrorHandlerOptions,
} from './error-sanitizer.js';

// =============================================================================
// API Key Management
// =============================================================================

export {
  // Types
  ApiKeyScope,
  apiKeyScopeSchema,
  API_KEY_SCOPES,
  ApiKeyStatus,
  apiKeyStatusSchema,
  type ApiKeyRateLimit,
  apiKeyRateLimitSchema,
  DEFAULT_API_KEY_RATE_LIMIT,
  type ApiKey,
  apiKeySchema,
  type CreateApiKeyInput,
  createApiKeyInputSchema,
  type UpdateApiKeyInput,
  updateApiKeyInputSchema,
  type ApiKeyValidationResult,
  ApiKeyValidationErrorCode,
  apiKeyValidationResultSchema,
  type ApiKeyRateLimitState,
  type ApiKeyRateLimitResult,
  type ApiKeyCreationResult,
  type ApiKeyListFilters,
  apiKeyListFiltersSchema,
  ApiKeyAuditEventType,
  type ApiKeyContext,
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_LENGTH,
  API_KEY_PATTERN,

  // Store
  type IApiKeyStore,
  InMemoryApiKeyStore,
  getApiKeyStore,
  createApiKeyStore,
  resetApiKeyStore,

  // Service
  ApiKeyService,
  ApiKeyError,
  ApiKeyValidationError,
  ApiKeyRateLimitError,
  type ApiKeyServiceDependencies,
  type IAuditLogger as IApiKeyAuditLogger,
  getApiKeyService,
  createApiKeyService,
  resetApiKeyService,

  // Middleware
  apiKeyMiddleware,
  requireScopes,
  requireReadScope,
  requireWriteScope,
  requireAdminScope,
  requireWebhookScope,
  requireIntegrationScope,
  apiKeyPlugin,
  getApiKey,
  getApiKeyTenantId,
  hasApiKey,
  getApiKeyScopes,
  type ApiKeyMiddlewareOptions,
  type ScopeRequirementOptions,
  type ApiKeyPluginOptions,
  type ApiKeyFastifyMiddleware,
} from './api-keys/index.js';

// =============================================================================
// Security Headers Management
// =============================================================================

export {
  // Types
  type CSPSourceValue,
  type CSPSandboxValue,
  type CSPDirectives,
  type CSPReportingConfig,
  type HSTSConfig,
  type CORSConfig,
  type PermissionsPolicyValue,
  type PermissionsPolicyConfig,
  type COEPValue,
  type COOPValue,
  type CORPValue,
  type ReferrerPolicyValue,
  type XFrameOptionsValue,
  type SecurityHeadersConfig,
  type ValidationSeverity,
  type ValidationIssue,
  type HeaderValidationResult,
  type CSPViolationReport,
  type CSPPreset,
  type CSPValidationError,
  type CSPBuildResult,
  type HSTSValidationResult,
  type HSTSValidationIssue,
  type FeaturePermission,
  type PermissionsPolicyIssue,
  type PermissionsPolicyValidationResult,
  type SecurityHeadersMiddlewareOptions,
  type SecurityHeadersContext,

  // Schemas
  cspSourceValueSchema,
  cspSandboxValueSchema,
  cspDirectivesSchema,
  cspReportingConfigSchema,
  hstsConfigSchema,
  HSTS_MIN_MAX_AGE_FOR_PRELOAD,
  HSTS_RECOMMENDED_MAX_AGE,
  corsConfigSchema,
  permissionsPolicyValueSchema,
  permissionsPolicyConfigSchema,
  securityHeadersConfigSchema,
  validationIssueSchema,
  headerValidationResultSchema,
  cspViolationReportSchema,

  // CSP
  CSPBuilder,
  generateNonce,
  formatNonce,
  STRICT_CSP_PRESET,
  MODERATE_CSP_PRESET,
  RELAXED_CSP_PRESET,
  API_CSP_PRESET,
  getCSPPreset,
  createStrictCSP,
  createModerateCSP,
  createAPICSP,
  createDevelopmentCSP,
  buildCSPString,
  parseCSPString,

  // HSTS
  HSTSManager,
  HSTS_HEADER_NAME,
  HSTS_MIN_RECOMMENDED_MAX_AGE,
  HSTS_MAX_SENSIBLE_MAX_AGE,
  createProductionHSTS,
  createPreloadHSTS,
  createDevelopmentHSTS,
  createHSTS,
  buildHSTSHeader,
  parseHSTSHeader,
  validateHSTSHeader,

  // Permissions Policy
  PermissionsPolicyManager,
  PERMISSIONS_POLICY_HEADER,
  KNOWN_FEATURES,
  HIGH_RISK_FEATURES,
  SENSOR_FEATURES,
  STRICT_PERMISSIONS_PRESET,
  MODERATE_PERMISSIONS_PRESET,
  API_PERMISSIONS_PRESET,
  createStrictPermissionsPolicy,
  createModeratePermissionsPolicy,
  createAPIPermissionsPolicy,
  createPermissionsPolicy,
  buildPermissionsPolicyHeader,
  parsePermissionsPolicyHeader,
  getSecureDefault,

  // Validation
  validateSecurityHeaders,
  assertValidSecurityHeaders,
  getSecurityHeadersSummary,

  // Middleware/Plugin
  securityHeadersPlugin,
  createStrictSecurityHeaders,
  createAPISecurityHeaders,
  createDevelopmentSecurityHeaders,
  createSecurityHeaders,
} from './headers/index.js';

// =============================================================================
// Distributed State Provider
// =============================================================================

export {
  RedisStateProvider,
  getRedisStateProvider,
  resetRedisStateProvider,
  createRedisStateProvider,
  type RedisStateConfig,
  type RedisHealthStatus,
  type IncrementResult,
  type InvalidationEvent,
  type InvalidationCallback,
  DEFAULT_REDIS_STATE_CONFIG,
} from './distributed-state.js';

// =============================================================================
// WebAuthn/Passkeys
// =============================================================================

export {
  // Service
  WebAuthnService,
  WebAuthnError,
  WebAuthnRegistrationError,
  WebAuthnAuthenticationError,
  getWebAuthnService,
  createWebAuthnService,
  resetWebAuthnService,
  type WebAuthnServiceDependencies,
  type IAuditLogger as IWebAuthnAuditLogger,

  // Store
  type IWebAuthnStore,
  InMemoryWebAuthnStore,
  RedisWebAuthnStore,
  getWebAuthnStore,
  createWebAuthnStore,
  createRedisWebAuthnStore,
  resetWebAuthnStore,
  enableRedisWebAuthnStore,

  // Types
  type WebAuthnCredential,
  type WebAuthnConfig,
  type ChallengeEntry,
  type RegistrationOptions,
  type AuthenticationOptions,
  type RegistrationResult,
  type AuthenticationResult,
  RegistrationErrorCode,
  AuthenticationErrorCode,
  WebAuthnAuditEventType,
  DEFAULT_WEBAUTHN_CONFIG,
} from './webauthn/index.js';

// =============================================================================
// Refresh Token Service
// =============================================================================

export {
  RefreshTokenService,
  RefreshTokenError,
  TokenReuseError,
  RefreshTokenExpiredError,
  RefreshTokenRevokedError,
  RefreshTokenInvalidError,
  getRefreshTokenService,
  createRefreshTokenService,
  resetRefreshTokenService,
  type RefreshTokenData,
  type RefreshTokenPayload,
  type TokenFamily,
  type CreateRefreshTokenInput,
  type TokenRotationResult,
  type AccessTokenGenerator,
  type RefreshTokenServiceConfig,
} from './refresh-token.js';

// =============================================================================
// Token Lifecycle Management (Unified Revocation)
// =============================================================================

export {
  TokenLifecycleService,
  TokenLifecycleError,
  getTokenLifecycleService,
  createTokenLifecycleService,
  resetTokenLifecycleService,
  type RevocationReason,
  type RevocationTrigger,
  type BulkRevocationResult,
  type RevocationOptions,
  type TokenLifecycleConfig,
  type RevocationEvent as TokenRevocationEvent,
} from './token-lifecycle.js';

// =============================================================================
// Revocation Check Middleware (Bloom Filter)
// =============================================================================

export {
  RevocationCheckService,
  revocationCheckMiddleware,
  getRevocationCheckService,
  createRevocationCheckService,
  resetRevocationCheckService,
  type RevocationCheckOptions,
  type RevocationCheckResult,
} from './revocation-check.js';

// =============================================================================
// Security Alerting System
// =============================================================================

export {
  // Enums
  AlertSeverity,
  AlertChannel,
  SecurityEventType,
  ConditionOperator,

  // Alert types
  type AlertContext,
  type SecurityAlert,
  type CreateAlertInput,

  // Rule types
  type AlertCondition,
  type AlertThreshold,
  type ChannelConfig,
  type AlertRule,

  // Configuration types
  type MaintenanceWindow,
  type EscalationPolicy,
  type AlertConfig,

  // Event types
  type AlertEvent,
  type AlertEventCallback,
  type AlertDeliveryResult,

  // Schemas
  alertSeveritySchema,
  alertChannelSchema,
  securityEventTypeSchema,
  conditionOperatorSchema,
  alertContextSchema,
  securityAlertSchema,
  createAlertInputSchema,
  alertConditionSchema,
  alertThresholdSchema,
  channelConfigSchema,
  alertRuleSchema,
  maintenanceWindowSchema,
  escalationPolicySchema,
  alertConfigSchema,
  alertDeliveryResultSchema,

  // Defaults
  DEFAULT_ALERT_CONFIG,

  // Detector
  SecurityAlertDetector,
  getSecurityAlertDetector,
  resetSecurityAlertDetector,
  createSecurityAlertDetector,
  type DetectorSecurityEvent,
  type DetectionResult,
  type BuiltInDetectorConfig,
  type SecurityAlertDetectorOptions,
  DEFAULT_BUILTIN_DETECTOR_CONFIG,

  // Service
  SecurityAlertService,
  getSecurityAlertService,
  resetSecurityAlertService,
  createSecurityAlertService,
  type SecurityAlertServiceOptions,

  // Channels
  SlackAlertChannel,
  createSlackChannel,
  type SlackChannelConfig,
  PagerDutyAlertChannel,
  createPagerDutyChannel,
  type PagerDutyChannelConfig,
  EmailAlertChannel,
  createEmailChannel,
  type EmailChannelConfig,
  WebhookAlertChannel,
  createWebhookChannel,
  createSignedWebhookChannel,
  type WebhookChannelConfig,
  SNSAlertChannel,
  createSNSChannel,
  type SNSChannelConfig,
  type AlertChannelInterface,

  // Convenience helpers
  SecurityAlerts,
} from './alerting/index.js';

// =============================================================================
// Bot Detection (Threat Intel)
// =============================================================================

export {
  BotDetectionService,
  getBotDetectionService,
  resetBotDetectionService,
  botDetectionMiddleware,
  botDetectionPlugin,
  DEFAULT_BOT_DETECTION_CONFIG,
  type BotScore,
  type BotSignal,
  type BotSignalType,
  type BotRecommendation,
  type BotDetectionConfig,
  type BotDetectionMiddlewareOptions,
  type BotDetectionPluginOptions,
} from './threat-intel/bot-detection.js';

// =============================================================================
// Data Loss Prevention (DLP)
// =============================================================================

export {
  // Scanner class
  DLPScanner,

  // Enums and types
  DataType,
  type RiskLevel,
  type ScanMode,
  type DLPFinding,
  type DLPScanResult,
  type DLPScannerConfig,

  // Schemas
  dlpScannerConfigSchema,

  // Default configuration
  DEFAULT_DLP_CONFIG,

  // Error classes
  DLPError,
  SensitiveDataBlockedError,
  DLPScanTimeoutError,

  // Middleware
  dlpRequestScanner,
  dlpResponseScanner,
  type DLPRequestScannerOptions,
  type DLPResponseScannerOptions,

  // Plugin
  dlpPlugin,
  type DLPPluginOptions,

  // Singleton management
  getDLPScanner,
  resetDLPScanner,
  createDLPScanner,
} from './dlp/index.js';

// =============================================================================
// Service-to-Service Authentication
// =============================================================================

export {
  // Service Account Types
  ServiceAccountStatus,
  type ServiceAccount,
  serviceAccountSchema,
  type CreateServiceAccountInput,
  createServiceAccountInputSchema,
  type ServiceAccountCreationResult,
  type SecretRotationResult,
  type UpdateServiceAccountInput,
  updateServiceAccountInputSchema,

  // Service Account Errors
  ServiceAccountError,
  ServiceAccountNotFoundError,
  ServiceAccountRevokedError,
  ServiceAccountSuspendedError,

  // Service Account Constants
  SERVICE_CLIENT_ID_PREFIX,

  // Service Account Utilities
  generateClientSecret,
  generateClientId,
  hashClientSecret,
  verifyClientSecret,

  // Service Account Store
  type IServiceAccountStore,
  InMemoryServiceAccountStore,

  // Service Account Manager
  ServiceAccountManager,
  type ServiceAccountManagerConfig,

  // Service Account Singletons
  getServiceAccountStore,
  setServiceAccountStore,
  getServiceAccountManager,
  createServiceAccountManager,
  resetServiceAccountSingletons,

  // Service Token Types
  type ServiceTokenPayload,
  serviceTokenPayloadSchema,
  type ServiceSignature,
  serviceSignatureSchema,
  type TokenVerificationResult,
  tokenVerificationResultSchema,
  type SignatureVerificationResult,

  // Service Token Errors
  ServiceTokenError,
  TokenExpiredError as ServiceTokenExpiredError,
  InvalidSignatureError,
  SignatureTimestampError,

  // Service Token Constants
  DEFAULT_TOKEN_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
  MIN_TOKEN_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  SERVICE_TOKEN_ISSUER,
  SERVICE_AUTH_HEADERS,

  // Service Token Service
  ServiceTokenService,
  type ServiceTokenServiceConfig,
  serviceTokenServiceConfigSchema,

  // Service Token Singletons
  initializeServiceTokenService,
  getServiceTokenService,
  createServiceTokenService,
  resetServiceTokenService,

  // Service Token Utilities
  createServiceAuthHeaders,
  extractServiceIdFromBearer,

  // Service Auth Middleware Types
  type ServiceAuthContext,
  type ServiceAuthenticatedRequest,
  type ServiceAuthMiddlewareOptions,

  // Service Auth Middleware Errors
  ServiceAuthError,
  MissingAuthHeadersError,
  InvalidServiceSignatureError,
  IpNotAllowedError,
  InsufficientPermissionsError,

  // Service Auth Middleware Factory
  createServiceAuthMiddleware,

  // Service Auth Helper Middleware
  requireServicePermissions,
  requireAnyServicePermission,
  requireServiceTenant,

  // Service Auth Request Helpers
  getServiceAuth,
  requireServiceAuth,
  hasServiceAuth,
  getServiceClientId,
  getServiceTenantId,
  getServicePermissions,
  serviceHasPermission,

  // Service Auth Fastify Plugin
  serviceAuthPlugin,
  type ServiceAuthPluginOptions,
} from './service-auth/index.js';
