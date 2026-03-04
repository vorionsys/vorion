/**
 * WebAuthn/Passkey Authentication Module
 *
 * Provides secure passwordless authentication using the WebAuthn standard.
 * Supports passkeys on platform authenticators (Touch ID, Face ID, Windows Hello)
 * and cross-platform authenticators (security keys like YubiKey).
 *
 * @example
 * ```typescript
 * import {
 *   getWebAuthnService,
 *   webauthnPlugin,
 *   type WebAuthnConfig,
 * } from './security/webauthn';
 *
 * // Configure and use the service directly
 * const service = getWebAuthnService({
 *   rpName: 'Vorion Platform',
 *   rpId: 'vorion.org',
 *   origin: 'https://vorion.org',
 * });
 *
 * // Or register the Fastify plugin
 * await fastify.register(webauthnPlugin, {
 *   config: {
 *     rpName: 'Vorion Platform',
 *     rpId: 'vorion.org',
 *     origin: 'https://vorion.org',
 *   },
 *   getUserContext: async (request) => {
 *     // Extract user from session/JWT
 *     return { userId: request.user.id, userName: request.user.email };
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  // Credential types
  WebAuthnCredential,
  AuthenticatorTransport,
  // Configuration
  WebAuthnConfig,
  AttestationConveyance,
  UserVerification,
  AuthenticatorAttachment,
  ResidentKey,
  // Registration
  GenerateRegistrationOptionsInput,
  RegistrationOptions,
  VerifyRegistrationInput,
  RegistrationResult,
  // Authentication
  GenerateAuthenticationOptionsInput,
  AuthenticationOptions,
  VerifyAuthenticationInput,
  AuthenticationResult,
  // Credential management
  ListCredentialsInput,
  RenameCredentialInput,
  DeleteCredentialInput,
  // Internal
  ChallengeEntry,
} from './types.js';

// Schemas and constants
export {
  webAuthnCredentialSchema,
  webAuthnConfigSchema,
  authenticatorTransportSchema,
  generateRegistrationOptionsInputSchema,
  registrationOptionsSchema,
  verifyRegistrationInputSchema,
  registrationResultSchema,
  generateAuthenticationOptionsInputSchema,
  authenticationOptionsSchema,
  verifyAuthenticationInputSchema,
  authenticationResultSchema,
  listCredentialsInputSchema,
  renameCredentialInputSchema,
  deleteCredentialInputSchema,
  challengeEntrySchema,
  // Error code constants
  RegistrationErrorCode,
  AuthenticationErrorCode,
  WebAuthnAuditEventType,
  // Default configuration
  DEFAULT_WEBAUTHN_CONFIG,
} from './types.js';

// Store
export type { IWebAuthnStore } from './store.js';
export {
  InMemoryWebAuthnStore,
  RedisWebAuthnStore,
  getWebAuthnStore,
  createWebAuthnStore,
  createRedisWebAuthnStore,
  resetWebAuthnStore,
  enableRedisWebAuthnStore,
} from './store.js';

// Service
export type { WebAuthnServiceDependencies, IAuditLogger } from './service.js';
export {
  WebAuthnService,
  WebAuthnError,
  WebAuthnRegistrationError,
  WebAuthnAuthenticationError,
  getWebAuthnService,
  createWebAuthnService,
  resetWebAuthnService,
} from './service.js';

// Middleware
export type {
  WebAuthnUserContext,
  WebAuthnMiddlewareOptions,
  WebAuthnPluginOptions,
} from './middleware.js';
export {
  webauthnPlugin,
  createUserContextMiddleware,
  requireWebAuthnUser,
  getWebAuthnUser,
  hasWebAuthnUser,
  getWebAuthnUserId,
} from './middleware.js';
