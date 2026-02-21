/**
 * MFA (Multi-Factor Authentication) Types
 *
 * Type definitions for the MFA system including TOTP authentication,
 * backup codes, and challenge/verification flows.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// Enums and Constants
// =============================================================================

/**
 * MFA methods supported by the system
 */
export const MfaMethod = {
  TOTP: 'totp',
  BACKUP_CODES: 'backup_codes',
} as const;

export type MfaMethod = (typeof MfaMethod)[keyof typeof MfaMethod];

export const mfaMethodSchema = z.enum(['totp', 'backup_codes']);

/**
 * MFA enrollment and activation status
 */
export const MfaStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type MfaStatus = (typeof MfaStatus)[keyof typeof MfaStatus];

export const mfaStatusSchema = z.enum(['pending', 'active', 'disabled']);

/**
 * Default configuration values
 */
export const MFA_DEFAULTS = {
  /** Number of backup codes to generate */
  BACKUP_CODE_COUNT: 10,
  /** Enrollment session expiry in milliseconds (15 minutes) */
  ENROLLMENT_EXPIRY_MS: 15 * 60 * 1000,
  /** Challenge expiry in milliseconds (5 minutes) */
  CHALLENGE_EXPIRY_MS: 5 * 60 * 1000,
  /** Maximum verification attempts before lockout */
  MAX_ATTEMPTS: 5,
  /** Grace period after enabling MFA in milliseconds (24 hours) */
  GRACE_PERIOD_MS: 24 * 60 * 60 * 1000,
} as const;

// =============================================================================
// Database Record Types
// =============================================================================

/**
 * User MFA settings stored in the database
 */
export interface UserMfaRecord {
  id: string;
  userId: string;
  tenantId: string;
  totpSecret: string | null;
  totpSecretEncrypted: boolean;
  status: MfaStatus;
  enabledAt: Date | null;
  enrollmentStartedAt: Date | null;
  enrollmentExpiresAt: Date | null;
  gracePeriodEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Backup code stored in the database
 */
export interface MfaBackupCodeRecord {
  id: string;
  userMfaId: string;
  codeHash: string;
  usedAt: Date | null;
  usedFromIp: string | null;
  createdAt: Date;
}

/**
 * MFA challenge stored in the database
 */
export interface MfaChallengeRecord {
  id: string;
  userId: string;
  sessionId: string;
  challengeToken: string;
  verified: boolean;
  verifiedAt: Date | null;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  createdAt: Date;
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Input for creating a new user MFA record
 */
export interface CreateUserMfaInput {
  userId: string;
  tenantId: string;
  totpSecret: string;
  totpSecretEncrypted?: boolean;
}

export const createUserMfaInputSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  totpSecret: z.string().min(1),
  totpSecretEncrypted: z.boolean().optional().default(true),
});

/**
 * Input for creating a backup code
 */
export interface CreateBackupCodeInput {
  userMfaId: string;
  codeHash: string;
}

/**
 * Input for creating an MFA challenge
 */
export interface CreateChallengeInput {
  userId: string;
  sessionId: string;
  expiresAt: Date;
  maxAttempts?: number;
}

export const createChallengeInputSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().min(1),
  expiresAt: z.date(),
  maxAttempts: z.number().int().positive().optional(),
});

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Enrollment initiation response
 */
export interface MfaEnrollmentResponse {
  /** Base32-encoded TOTP secret */
  secret: string;
  /** OTPAuth URL for QR code generation */
  otpauthUrl: string;
  /** QR code as data URL (base64 PNG) */
  qrCode: string;
  /** When the enrollment session expires */
  expiresAt: string;
}

export const mfaEnrollmentResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  qrCode: z.string(),
  expiresAt: z.string().datetime(),
});

/**
 * Enrollment completion response
 */
export interface MfaEnrollmentCompleteResponse {
  /** Backup codes (shown only once) */
  backupCodes: string[];
  /** Number of backup codes */
  backupCodeCount: number;
  /** When MFA was enabled */
  enabledAt: string;
  /** End of grace period (MFA not required until then) */
  gracePeriodEndsAt: string;
}

export const mfaEnrollmentCompleteResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  backupCodeCount: z.number().int().positive(),
  enabledAt: z.string().datetime(),
  gracePeriodEndsAt: z.string().datetime(),
});

/**
 * MFA status response
 */
export interface MfaStatusResponse {
  /** Whether MFA is enabled and active */
  enabled: boolean;
  /** Current MFA status */
  status: MfaStatus;
  /** When MFA was enabled */
  enabledAt: string | null;
  /** Whether user is in enrollment process */
  enrollmentPending: boolean;
  /** Number of unused backup codes remaining */
  backupCodesRemaining: number;
  /** Whether user is in grace period */
  inGracePeriod: boolean;
  /** When grace period ends (if applicable) */
  gracePeriodEndsAt: string | null;
}

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
  status: mfaStatusSchema,
  enabledAt: z.string().datetime().nullable(),
  enrollmentPending: z.boolean(),
  backupCodesRemaining: z.number().int().nonnegative(),
  inGracePeriod: z.boolean(),
  gracePeriodEndsAt: z.string().datetime().nullable(),
});

/**
 * MFA challenge response
 */
export interface MfaChallengeResponse {
  /** Unique challenge token */
  challengeToken: string;
  /** When the challenge expires */
  expiresAt: string;
  /** Remaining verification attempts */
  attemptsRemaining: number;
}

export const mfaChallengeResponseSchema = z.object({
  challengeToken: z.string(),
  expiresAt: z.string().datetime(),
  attemptsRemaining: z.number().int().nonnegative(),
});

/**
 * Challenge verification response
 */
export interface MfaVerifyResponse {
  /** Whether verification succeeded */
  verified: boolean;
  /** Method used for verification */
  method: MfaMethod | null;
  /** Remaining attempts (if not verified) */
  attemptsRemaining?: number;
  /** Error message (if not verified) */
  error?: string;
}

export const mfaVerifyResponseSchema = z.object({
  verified: z.boolean(),
  method: mfaMethodSchema.nullable(),
  attemptsRemaining: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

/**
 * Backup codes regeneration response
 */
export interface MfaBackupCodesResponse {
  /** New backup codes (shown only once) */
  backupCodes: string[];
  /** Number of backup codes */
  backupCodeCount: number;
  /** When codes were generated */
  generatedAt: string;
}

export const mfaBackupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()),
  backupCodeCount: z.number().int().positive(),
  generatedAt: z.string().datetime(),
});

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Enrollment verification request
 */
export const mfaEnrollVerifyRequestSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/, 'Code must be 6 digits'),
});

export type MfaEnrollVerifyRequest = z.infer<typeof mfaEnrollVerifyRequestSchema>;

/**
 * Challenge verification request
 */
export const mfaChallengeVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
});

export type MfaChallengeVerifyRequest = z.infer<typeof mfaChallengeVerifyRequestSchema>;

// =============================================================================
// Service Types
// =============================================================================

/**
 * MFA service configuration
 */
export interface MfaServiceConfig {
  /** TOTP issuer name (displayed in authenticator apps) */
  issuer: string;
  /** Number of backup codes to generate */
  backupCodeCount: number;
  /** Enrollment session expiry in milliseconds */
  enrollmentExpiryMs: number;
  /** Challenge expiry in milliseconds */
  challengeExpiryMs: number;
  /** Maximum verification attempts */
  maxAttempts: number;
  /** Grace period after enabling MFA in milliseconds */
  gracePeriodMs: number;
  /** Whether to encrypt TOTP secrets */
  encryptSecrets: boolean;
}

export const mfaServiceConfigSchema = z.object({
  issuer: z.string().default('Vorion'),
  backupCodeCount: z.number().int().positive().default(MFA_DEFAULTS.BACKUP_CODE_COUNT),
  enrollmentExpiryMs: z.number().int().positive().default(MFA_DEFAULTS.ENROLLMENT_EXPIRY_MS),
  challengeExpiryMs: z.number().int().positive().default(MFA_DEFAULTS.CHALLENGE_EXPIRY_MS),
  maxAttempts: z.number().int().positive().default(MFA_DEFAULTS.MAX_ATTEMPTS),
  gracePeriodMs: z.number().int().positive().default(MFA_DEFAULTS.GRACE_PERIOD_MS),
  encryptSecrets: z.boolean().default(true),
});

/**
 * Options for MFA middleware
 */
export interface MfaMiddlewareOptions {
  /** Skip MFA check during grace period */
  allowGracePeriod?: boolean;
  /** Skip MFA for specific paths */
  skipPaths?: string[];
  /** Function to extract user ID from request */
  extractUserId?: (request: unknown) => string | undefined;
  /** Function to extract tenant ID from request */
  extractTenantId?: (request: unknown) => string | undefined;
  /** Function to extract session ID from request */
  extractSessionId?: (request: unknown) => string | undefined;
}

export const mfaMiddlewareOptionsSchema = z.object({
  allowGracePeriod: z.boolean().optional().default(true),
  skipPaths: z.array(z.string()).optional(),
});
