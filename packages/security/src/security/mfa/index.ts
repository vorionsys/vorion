/**
 * MFA (Multi-Factor Authentication) Module
 *
 * Provides comprehensive MFA functionality including:
 * - TOTP (Time-based One-Time Password) authentication
 * - Backup codes for account recovery
 * - Challenge-based verification flow
 * - Fastify middleware for route protection
 *
 * @packageDocumentation
 * @module security/mfa
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Enums and constants
  MfaMethod,
  MfaStatus,
  MFA_DEFAULTS,

  // Database record types
  type UserMfaRecord,
  type MfaBackupCodeRecord,
  type MfaChallengeRecord,

  // Input types
  type CreateUserMfaInput,
  type CreateBackupCodeInput,
  type CreateChallengeInput,

  // API response types
  type MfaEnrollmentResponse,
  type MfaEnrollmentCompleteResponse,
  type MfaStatusResponse,
  type MfaChallengeResponse,
  type MfaVerifyResponse,
  type MfaBackupCodesResponse,

  // Request types
  type MfaEnrollVerifyRequest,
  type MfaChallengeVerifyRequest,

  // Service configuration
  type MfaServiceConfig,
  type MfaMiddlewareOptions,

  // Zod schemas
  mfaMethodSchema,
  mfaStatusSchema,
  createUserMfaInputSchema,
  createChallengeInputSchema,
  mfaEnrollmentResponseSchema,
  mfaEnrollmentCompleteResponseSchema,
  mfaStatusResponseSchema,
  mfaChallengeResponseSchema,
  mfaVerifyResponseSchema,
  mfaBackupCodesResponseSchema,
  mfaEnrollVerifyRequestSchema,
  mfaChallengeVerifyRequestSchema,
  mfaServiceConfigSchema,
  mfaMiddlewareOptionsSchema,
} from './types.js';

// =============================================================================
// Store
// =============================================================================

export {
  MfaStore,
  getMfaStore,
  resetMfaStore,
  createMfaStore,

  // Drizzle schema exports
  userMfa,
  mfaBackupCodes,
  mfaChallenges,
  mfaMethodEnum,
  mfaStatusEnum,
} from './mfa-store.js';

// =============================================================================
// Service
// =============================================================================

export {
  MfaService,
  getMfaService,
  resetMfaService,
  createMfaService,

  // Error classes
  MfaError,
  EnrollmentExpiredError,
  ChallengeExpiredError,
  TooManyAttemptsError,
} from './mfa-service.js';

// =============================================================================
// Middleware
// =============================================================================

export {
  requireMfa,
  mfaContextMiddleware,
  requireMfaEnabled,
  type MfaRequestContext,
} from './mfa-middleware.js';
