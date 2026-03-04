/**
 * WebAuthn/Passkey Authentication Type Definitions
 *
 * Defines types, interfaces, and Zod schemas for WebAuthn credential management,
 * registration, and authentication flows.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';

// =============================================================================
// AUTHENTICATOR TRANSPORT
// =============================================================================

/**
 * Authenticator transport types supported by WebAuthn
 */
export type AuthenticatorTransport = AuthenticatorTransportFuture;

export const authenticatorTransportSchema = z.enum([
  'usb',
  'ble',
  'nfc',
  'internal',
  'cable',
  'hybrid',
  'smart-card',
]);

// =============================================================================
// WEBAUTHN CREDENTIAL
// =============================================================================

/**
 * Stored WebAuthn credential
 */
export interface WebAuthnCredential {
  /** Internal unique identifier (UUID) */
  id: string;
  /** Base64URL encoded credential ID from authenticator */
  credentialId: string;
  /** Base64URL encoded public key */
  publicKey: string;
  /** Signature counter for replay attack prevention */
  counter: number;
  /** Supported transport methods */
  transports?: AuthenticatorTransport[];
  /** Timestamp when credential was created */
  createdAt: Date;
  /** Timestamp of last successful authentication */
  lastUsedAt: Date | null;
  /** User-friendly name for the credential */
  name: string;
  /** User ID that owns this credential */
  userId: string;
  /** Type of device (e.g., 'singleDevice', 'multiDevice') */
  deviceType?: string;
  /** Whether credential is backed up (e.g., iCloud Keychain) */
  backedUp?: boolean;
  /** AAGUID of the authenticator (if available) */
  aaguid?: string;
}

export const webAuthnCredentialSchema = z.object({
  id: z.string().uuid(),
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  counter: z.number().int().min(0),
  transports: z.array(authenticatorTransportSchema).optional(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  name: z.string().min(1).max(255),
  userId: z.string().min(1),
  deviceType: z.string().optional(),
  backedUp: z.boolean().optional(),
  aaguid: z.string().optional(),
});

// =============================================================================
// REGISTRATION OPTIONS
// =============================================================================

/**
 * Input for generating registration options
 */
export interface GenerateRegistrationOptionsInput {
  /** User ID to register the credential for */
  userId: string;
  /** User display name (usually email or username) */
  userName: string;
  /** User display name shown during registration */
  userDisplayName?: string;
  /** Optional preferred authenticator type */
  authenticatorType?: 'platform' | 'cross-platform';
  /** Whether to require user verification */
  requireUserVerification?: boolean;
}

export const generateRegistrationOptionsInputSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().min(1).max(255),
  userDisplayName: z.string().min(1).max(255).optional(),
  authenticatorType: z.enum(['platform', 'cross-platform']).optional(),
  requireUserVerification: z.boolean().optional(),
});

/**
 * Registration options returned to client
 */
export interface RegistrationOptions {
  /** The options to pass to navigator.credentials.create() */
  options: PublicKeyCredentialCreationOptionsJSON;
  /** Challenge for verification (stored server-side) */
  challenge: string;
}

export const registrationOptionsSchema = z.object({
  options: z.any(), // PublicKeyCredentialCreationOptionsJSON is complex
  challenge: z.string().min(1),
});

// =============================================================================
// REGISTRATION RESULT
// =============================================================================

/**
 * Input for verifying registration
 */
export interface VerifyRegistrationInput {
  /** User ID that initiated registration */
  userId: string;
  /** Response from navigator.credentials.create() */
  response: RegistrationResponseJSON;
  /** Optional credential name */
  credentialName?: string;
}

export const verifyRegistrationInputSchema = z.object({
  userId: z.string().min(1),
  response: z.any(), // RegistrationResponseJSON is complex
  credentialName: z.string().min(1).max(255).optional(),
});

/**
 * Result of successful registration
 */
export interface RegistrationResult {
  /** Whether registration was successful */
  verified: boolean;
  /** The created credential (if successful) */
  credential?: WebAuthnCredential;
  /** Error message (if failed) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: RegistrationErrorCode;
}

/**
 * Registration error codes
 */
export const RegistrationErrorCode = {
  /** Challenge not found or expired */
  CHALLENGE_NOT_FOUND: 'CHALLENGE_NOT_FOUND',
  /** Challenge has expired */
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  /** Verification failed */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /** Credential already exists */
  CREDENTIAL_EXISTS: 'CREDENTIAL_EXISTS',
  /** Invalid response format */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  /** User not found */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
} as const;

export type RegistrationErrorCode =
  (typeof RegistrationErrorCode)[keyof typeof RegistrationErrorCode];

export const registrationResultSchema = z.object({
  verified: z.boolean(),
  credential: webAuthnCredentialSchema.optional(),
  error: z.string().optional(),
  errorCode: z.nativeEnum(RegistrationErrorCode).optional(),
});

// =============================================================================
// AUTHENTICATION OPTIONS
// =============================================================================

/**
 * Input for generating authentication options
 */
export interface GenerateAuthenticationOptionsInput {
  /** User ID to authenticate (optional for resident credentials) */
  userId?: string;
  /** Whether to require user verification */
  requireUserVerification?: boolean;
}

export const generateAuthenticationOptionsInputSchema = z.object({
  userId: z.string().min(1).optional(),
  requireUserVerification: z.boolean().optional(),
});

/**
 * Authentication options returned to client
 */
export interface AuthenticationOptions {
  /** The options to pass to navigator.credentials.get() */
  options: PublicKeyCredentialRequestOptionsJSON;
  /** Challenge for verification (stored server-side) */
  challenge: string;
}

export const authenticationOptionsSchema = z.object({
  options: z.any(), // PublicKeyCredentialRequestOptionsJSON is complex
  challenge: z.string().min(1),
});

// =============================================================================
// AUTHENTICATION RESULT
// =============================================================================

/**
 * Input for verifying authentication
 */
export interface VerifyAuthenticationInput {
  /** User ID being authenticated */
  userId: string;
  /** Response from navigator.credentials.get() */
  response: AuthenticationResponseJSON;
}

export const verifyAuthenticationInputSchema = z.object({
  userId: z.string().min(1),
  response: z.any(), // AuthenticationResponseJSON is complex
});

/**
 * Result of authentication verification
 */
export interface AuthenticationResult {
  /** Whether authentication was successful */
  verified: boolean;
  /** The credential used (if successful) */
  credential?: WebAuthnCredential;
  /** User ID (if successful) */
  userId?: string;
  /** Error message (if failed) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: AuthenticationErrorCode;
}

/**
 * Authentication error codes
 */
export const AuthenticationErrorCode = {
  /** Challenge not found or expired */
  CHALLENGE_NOT_FOUND: 'CHALLENGE_NOT_FOUND',
  /** Challenge has expired */
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  /** Credential not found */
  CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
  /** Verification failed */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /** Counter rollback detected (potential cloned authenticator) */
  COUNTER_ROLLBACK: 'COUNTER_ROLLBACK',
  /** User has no credentials */
  NO_CREDENTIALS: 'NO_CREDENTIALS',
  /** Invalid response format */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  /** User not found */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
} as const;

export type AuthenticationErrorCode =
  (typeof AuthenticationErrorCode)[keyof typeof AuthenticationErrorCode];

export const authenticationResultSchema = z.object({
  verified: z.boolean(),
  credential: webAuthnCredentialSchema.optional(),
  userId: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.nativeEnum(AuthenticationErrorCode).optional(),
});

// =============================================================================
// WEBAUTHN CONFIGURATION
// =============================================================================

/**
 * Attestation conveyance preference
 * Note: simplewebauthn only supports 'none', 'direct', and 'enterprise'
 */
export type AttestationConveyance = 'none' | 'direct' | 'enterprise';

/**
 * User verification requirement
 */
export type UserVerification = 'required' | 'preferred' | 'discouraged';

/**
 * Authenticator attachment preference
 */
export type AuthenticatorAttachment = 'platform' | 'cross-platform';

/**
 * Resident key requirement
 */
export type ResidentKey = 'required' | 'preferred' | 'discouraged';

/**
 * WebAuthn service configuration
 */
export interface WebAuthnConfig {
  /** Relying Party name displayed to users during registration */
  rpName: string;
  /** Relying Party ID (domain), e.g., 'vorion.org' */
  rpId: string;
  /** Full origin URL, e.g., 'https://vorion.org' */
  origin: string | string[];
  /** Attestation conveyance preference */
  attestation: AttestationConveyance;
  /** User verification requirement */
  userVerification: UserVerification;
  /** Timeout for WebAuthn operations in milliseconds */
  timeout: number;
  /** Default authenticator attachment preference */
  authenticatorAttachment?: AuthenticatorAttachment;
  /** Resident key requirement */
  residentKey: ResidentKey;
  /** Challenge TTL in milliseconds */
  challengeTTL: number;
  /** Supported algorithm IDs (e.g., -7 for ES256, -257 for RS256) */
  supportedAlgorithms: number[];
}

export const webAuthnConfigSchema = z.object({
  rpName: z.string().min(1).max(255),
  rpId: z.string().min(1),
  origin: z.union([z.string().url(), z.array(z.string().url())]),
  attestation: z.enum(['none', 'direct', 'enterprise']),
  userVerification: z.enum(['required', 'preferred', 'discouraged']),
  timeout: z.number().int().positive().max(600000),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  residentKey: z.enum(['required', 'preferred', 'discouraged']),
  challengeTTL: z.number().int().positive().max(600000),
  supportedAlgorithms: z.array(z.number().int()),
});

/**
 * Default WebAuthn configuration
 */
export const DEFAULT_WEBAUTHN_CONFIG: WebAuthnConfig = {
  rpName: 'Vorion Platform',
  rpId: 'localhost',
  origin: 'http://localhost:3000',
  attestation: 'none',
  userVerification: 'preferred',
  timeout: 60000,
  residentKey: 'preferred',
  challengeTTL: 300000, // 5 minutes
  supportedAlgorithms: [-7, -257], // ES256 and RS256
};

// =============================================================================
// CREDENTIAL MANAGEMENT
// =============================================================================

/**
 * Input for listing credentials
 */
export interface ListCredentialsInput {
  /** User ID to list credentials for */
  userId: string;
  /** Pagination limit */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

export const listCredentialsInputSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Input for renaming a credential
 */
export interface RenameCredentialInput {
  /** User ID that owns the credential */
  userId: string;
  /** Credential ID to rename */
  credentialId: string;
  /** New name for the credential */
  name: string;
}

export const renameCredentialInputSchema = z.object({
  userId: z.string().min(1),
  credentialId: z.string().uuid(),
  name: z.string().min(1).max(255),
});

/**
 * Input for deleting a credential
 */
export interface DeleteCredentialInput {
  /** User ID that owns the credential */
  userId: string;
  /** Credential ID to delete */
  credentialId: string;
}

export const deleteCredentialInputSchema = z.object({
  userId: z.string().min(1),
  credentialId: z.string().uuid(),
});

// =============================================================================
// AUDIT EVENT TYPES
// =============================================================================

/**
 * Audit event types for WebAuthn operations
 */
export const WebAuthnAuditEventType = {
  REGISTRATION_OPTIONS_GENERATED: 'webauthn.registration_options_generated',
  REGISTRATION_COMPLETED: 'webauthn.registration_completed',
  REGISTRATION_FAILED: 'webauthn.registration_failed',
  AUTHENTICATION_OPTIONS_GENERATED: 'webauthn.authentication_options_generated',
  AUTHENTICATION_COMPLETED: 'webauthn.authentication_completed',
  AUTHENTICATION_FAILED: 'webauthn.authentication_failed',
  COUNTER_ROLLBACK_DETECTED: 'webauthn.counter_rollback_detected',
  CREDENTIAL_DELETED: 'webauthn.credential_deleted',
  CREDENTIAL_RENAMED: 'webauthn.credential_renamed',
} as const;

export type WebAuthnAuditEventType =
  (typeof WebAuthnAuditEventType)[keyof typeof WebAuthnAuditEventType];

// =============================================================================
// CHALLENGE STORAGE
// =============================================================================

/**
 * Challenge entry with metadata
 */
export interface ChallengeEntry {
  /** The challenge string */
  challenge: string;
  /** User ID associated with this challenge */
  userId: string;
  /** Type of operation (registration or authentication) */
  type: 'registration' | 'authentication';
  /** Expiration timestamp (Unix ms) */
  expiresAt: number;
  /** Creation timestamp */
  createdAt: Date;
}

export const challengeEntrySchema = z.object({
  challenge: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(['registration', 'authentication']),
  expiresAt: z.number().int().positive(),
  createdAt: z.date(),
});
