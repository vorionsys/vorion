/**
 * WebAuthn/Passkey Authentication Service
 *
 * Core service for WebAuthn credential management and authentication.
 * Uses @simplewebauthn/server for cryptographic operations.
 *
 * Features:
 * - Passkey registration flow
 * - Passkey authentication flow
 * - Credential management (list, rename, delete)
 * - Replay attack prevention via counter verification
 * - Audit logging for all operations
 *
 * @packageDocumentation
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { createLogger } from '../../common/logger.js';
import { secureRandomId, secureRandomString } from '../../common/random.js';
import { VorionError, NotFoundError } from '../../common/errors.js';
import {
  type WebAuthnCredential,
  type WebAuthnConfig,
  type GenerateRegistrationOptionsInput,
  type RegistrationOptions,
  type VerifyRegistrationInput,
  type RegistrationResult,
  type GenerateAuthenticationOptionsInput,
  type AuthenticationOptions,
  type VerifyAuthenticationInput,
  type AuthenticationResult,
  type ListCredentialsInput,
  type RenameCredentialInput,
  type DeleteCredentialInput,
  type ChallengeEntry,
  RegistrationErrorCode,
  AuthenticationErrorCode,
  WebAuthnAuditEventType,
  DEFAULT_WEBAUTHN_CONFIG,
  generateRegistrationOptionsInputSchema,
  verifyRegistrationInputSchema,
  generateAuthenticationOptionsInputSchema,
  verifyAuthenticationInputSchema,
  listCredentialsInputSchema,
  renameCredentialInputSchema,
  deleteCredentialInputSchema,
} from './types.js';
import { type IWebAuthnStore, getWebAuthnStore } from './store.js';

const logger = createLogger({ component: 'webauthn-service' });

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Base error class for WebAuthn operations
 */
export class WebAuthnError extends VorionError {
  override code = 'WEBAUTHN_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'WebAuthnError';
  }
}

/**
 * Error thrown when registration fails
 */
export class WebAuthnRegistrationError extends WebAuthnError {
  override code = 'WEBAUTHN_REGISTRATION_ERROR';
  override statusCode = 400;

  constructor(
    message: string,
    public readonly errorCode: RegistrationErrorCode,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, errorCode });
    this.name = 'WebAuthnRegistrationError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class WebAuthnAuthenticationError extends WebAuthnError {
  override code = 'WEBAUTHN_AUTHENTICATION_ERROR';
  override statusCode = 401;

  constructor(
    message: string,
    public readonly errorCode: AuthenticationErrorCode,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, errorCode });
    this.name = 'WebAuthnAuthenticationError';
  }
}

// =============================================================================
// AUDIT INTERFACE
// =============================================================================

/**
 * Audit logging interface
 */
export interface IAuditLogger {
  record(input: {
    tenantId: string;
    eventType: string;
    actor: { type: 'user' | 'agent' | 'service' | 'system'; id: string; name?: string };
    target: { type: string; id: string; name?: string };
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

// =============================================================================
// SERVICE
// =============================================================================

/**
 * WebAuthn Service Dependencies
 */
export interface WebAuthnServiceDependencies {
  /** WebAuthn store */
  store?: IWebAuthnStore;
  /** WebAuthn configuration */
  config?: Partial<WebAuthnConfig>;
  /** Audit logger */
  auditLogger?: IAuditLogger;
}

/**
 * WebAuthn Authentication Service
 */
export class WebAuthnService {
  private store: IWebAuthnStore;
  private config: WebAuthnConfig;
  private auditLogger?: IAuditLogger;

  constructor(deps: WebAuthnServiceDependencies = {}) {
    this.store = deps.store ?? getWebAuthnStore();
    this.config = { ...DEFAULT_WEBAUTHN_CONFIG, ...deps.config };
    this.auditLogger = deps.auditLogger;

    logger.info(
      {
        rpName: this.config.rpName,
        rpId: this.config.rpId,
        origin: this.config.origin,
        attestation: this.config.attestation,
        userVerification: this.config.userVerification,
      },
      'WebAuthn service initialized'
    );
  }

  // ===========================================================================
  // REGISTRATION FLOW
  // ===========================================================================

  /**
   * Generate registration options for a new passkey
   *
   * @param input - Registration options input
   * @returns Registration options to send to client
   */
  async generateRegistrationOptions(
    input: GenerateRegistrationOptionsInput
  ): Promise<RegistrationOptions> {
    const validated = generateRegistrationOptionsInputSchema.parse(input);

    logger.debug(
      { userId: validated.userId, userName: validated.userName },
      'Generating registration options'
    );

    // Get user's existing credentials to exclude
    const existingCredentials = await this.store.getCredentialsByUserId(validated.userId);
    const excludeCredentials = existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports,
    }));

    // Build authenticator selection
    const authenticatorSelection: AuthenticatorSelectionCriteria = {
      residentKey: this.config.residentKey,
      userVerification: validated.requireUserVerification
        ? 'required'
        : this.config.userVerification,
    };

    if (validated.authenticatorType) {
      authenticatorSelection.authenticatorAttachment = validated.authenticatorType;
    } else if (this.config.authenticatorAttachment) {
      authenticatorSelection.authenticatorAttachment = this.config.authenticatorAttachment;
    }

    // Generate options
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: validated.userName,
      userDisplayName: validated.userDisplayName ?? validated.userName,
      timeout: this.config.timeout,
      attestationType: this.config.attestation,
      excludeCredentials,
      authenticatorSelection,
      supportedAlgorithmIDs: this.config.supportedAlgorithms,
    });

    // Store challenge
    const challengeKey = this.getChallengeKey(validated.userId, 'registration');
    const challengeEntry: ChallengeEntry = {
      challenge: options.challenge,
      userId: validated.userId,
      type: 'registration',
      expiresAt: Date.now() + this.config.challengeTTL,
      createdAt: new Date(),
    };
    await this.store.setChallenge(challengeKey, challengeEntry);

    // Audit log
    await this.audit({
      userId: validated.userId,
      eventType: WebAuthnAuditEventType.REGISTRATION_OPTIONS_GENERATED,
      targetId: validated.userId,
      targetName: validated.userName,
      action: 'generate_registration_options',
      outcome: 'success',
      metadata: {
        existingCredentials: existingCredentials.length,
        authenticatorType: validated.authenticatorType,
      },
    });

    logger.info(
      {
        userId: validated.userId,
        existingCredentials: existingCredentials.length,
        challenge: options.challenge.substring(0, 10) + '...',
      },
      'Registration options generated'
    );

    return {
      options,
      challenge: options.challenge,
    };
  }

  /**
   * Verify registration response and store credential
   *
   * @param input - Registration verification input
   * @returns Registration result
   */
  async verifyRegistration(input: VerifyRegistrationInput): Promise<RegistrationResult> {
    const validated = verifyRegistrationInputSchema.parse(input);

    logger.debug({ userId: validated.userId }, 'Verifying registration');

    // Get stored challenge
    const challengeKey = this.getChallengeKey(validated.userId, 'registration');
    const challengeEntry = await this.store.getChallenge(challengeKey);

    if (!challengeEntry) {
      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_registration',
        outcome: 'failure',
        reason: 'Challenge not found or expired',
      });

      return {
        verified: false,
        error: 'Challenge not found or expired',
        errorCode: RegistrationErrorCode.CHALLENGE_NOT_FOUND,
      };
    }

    // Verify registration response
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: validated.response,
        expectedChallenge: challengeEntry.challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: this.config.userVerification === 'required',
      });
    } catch (error) {
      logger.error(
        {
          userId: validated.userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Registration verification failed'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_registration',
        outcome: 'failure',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        verified: false,
        error: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: RegistrationErrorCode.VERIFICATION_FAILED,
      };
    }

    if (!verification.verified || !verification.registrationInfo) {
      logger.warn({ userId: validated.userId }, 'Registration not verified');

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_registration',
        outcome: 'failure',
        reason: 'Verification returned false',
      });

      return {
        verified: false,
        error: 'Registration verification failed',
        errorCode: RegistrationErrorCode.VERIFICATION_FAILED,
      };
    }

    const { registrationInfo } = verification;

    // Check if credential already exists
    const existingCredential = await this.store.getCredentialByCredentialId(
      registrationInfo.credential.id
    );
    if (existingCredential) {
      logger.warn(
        { userId: validated.userId, credentialId: registrationInfo.credential.id },
        'Credential already exists'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.REGISTRATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_registration',
        outcome: 'failure',
        reason: 'Credential already exists',
      });

      return {
        verified: false,
        error: 'Credential already exists',
        errorCode: RegistrationErrorCode.CREDENTIAL_EXISTS,
      };
    }

    // Create credential record
    const credentialName = validated.credentialName ?? this.generateCredentialName();
    const credential: WebAuthnCredential = {
      id: secureRandomId(),
      credentialId: registrationInfo.credential.id,
      publicKey: this.uint8ArrayToBase64Url(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      transports: registrationInfo.credential.transports,
      createdAt: new Date(),
      lastUsedAt: null,
      name: credentialName,
      userId: validated.userId,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      aaguid: registrationInfo.aaguid,
    };

    // Store credential
    await this.store.createCredential(credential);

    // Audit log
    await this.audit({
      userId: validated.userId,
      eventType: WebAuthnAuditEventType.REGISTRATION_COMPLETED,
      targetId: credential.id,
      targetName: credentialName,
      action: 'verify_registration',
      outcome: 'success',
      metadata: {
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
        aaguid: credential.aaguid,
      },
    });

    logger.info(
      {
        userId: validated.userId,
        credentialId: credential.id,
        name: credentialName,
        deviceType: credential.deviceType,
        backedUp: credential.backedUp,
      },
      'Registration completed successfully'
    );

    return {
      verified: true,
      credential,
    };
  }

  // ===========================================================================
  // AUTHENTICATION FLOW
  // ===========================================================================

  /**
   * Generate authentication options
   *
   * @param input - Authentication options input
   * @returns Authentication options to send to client
   */
  async generateAuthenticationOptions(
    input: GenerateAuthenticationOptionsInput
  ): Promise<AuthenticationOptions> {
    const validated = generateAuthenticationOptionsInputSchema.parse(input);

    logger.debug({ userId: validated.userId }, 'Generating authentication options');

    let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> | undefined;
    let challengeKey: string;

    if (validated.userId) {
      // Get user's credentials
      const credentials = await this.store.getCredentialsByUserId(validated.userId);

      if (credentials.length === 0) {
        logger.warn({ userId: validated.userId }, 'No credentials found for user');

        await this.audit({
          userId: validated.userId,
          eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
          targetId: validated.userId,
          targetName: validated.userId,
          action: 'generate_authentication_options',
          outcome: 'failure',
          reason: 'No credentials found',
        });

        throw new WebAuthnAuthenticationError(
          'No credentials found for user',
          AuthenticationErrorCode.NO_CREDENTIALS
        );
      }

      allowCredentials = credentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
      }));

      challengeKey = this.getChallengeKey(validated.userId, 'authentication');
    } else {
      // Discoverable credential flow (resident key)
      challengeKey = this.getChallengeKey(`anonymous:${secureRandomString(16)}`, 'authentication');
    }

    // Generate options
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      timeout: this.config.timeout,
      allowCredentials,
      userVerification: validated.requireUserVerification
        ? 'required'
        : this.config.userVerification,
    });

    // Store challenge
    const challengeEntry: ChallengeEntry = {
      challenge: options.challenge,
      userId: validated.userId ?? 'anonymous',
      type: 'authentication',
      expiresAt: Date.now() + this.config.challengeTTL,
      createdAt: new Date(),
    };
    await this.store.setChallenge(challengeKey, challengeEntry);

    // Audit log
    await this.audit({
      userId: validated.userId ?? 'anonymous',
      eventType: WebAuthnAuditEventType.AUTHENTICATION_OPTIONS_GENERATED,
      targetId: validated.userId ?? 'anonymous',
      targetName: validated.userId ?? 'anonymous',
      action: 'generate_authentication_options',
      outcome: 'success',
      metadata: {
        allowedCredentials: allowCredentials?.length ?? 0,
      },
    });

    logger.info(
      {
        userId: validated.userId,
        allowedCredentials: allowCredentials?.length ?? 0,
        challenge: options.challenge.substring(0, 10) + '...',
      },
      'Authentication options generated'
    );

    return {
      options,
      challenge: options.challenge,
    };
  }

  /**
   * Verify authentication response
   *
   * @param input - Authentication verification input
   * @returns Authentication result
   */
  async verifyAuthentication(input: VerifyAuthenticationInput): Promise<AuthenticationResult> {
    const validated = verifyAuthenticationInputSchema.parse(input);

    logger.debug({ userId: validated.userId }, 'Verifying authentication');

    // Get stored challenge
    const challengeKey = this.getChallengeKey(validated.userId, 'authentication');
    const challengeEntry = await this.store.getChallenge(challengeKey);

    if (!challengeEntry) {
      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: 'Challenge not found or expired',
      });

      return {
        verified: false,
        error: 'Challenge not found or expired',
        errorCode: AuthenticationErrorCode.CHALLENGE_NOT_FOUND,
      };
    }

    // Get credential by credential ID from response
    const credentialId = validated.response.id;
    const credential = await this.store.getCredentialByCredentialId(credentialId);

    if (!credential) {
      logger.warn({ credentialId }, 'Credential not found');

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
        targetId: validated.userId,
        targetName: validated.userId,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: 'Credential not found',
        metadata: { credentialId },
      });

      return {
        verified: false,
        error: 'Credential not found',
        errorCode: AuthenticationErrorCode.CREDENTIAL_NOT_FOUND,
      };
    }

    // Verify the credential belongs to the user
    if (credential.userId !== validated.userId) {
      logger.warn(
        {
          credentialId,
          credentialUserId: credential.userId,
          requestedUserId: validated.userId,
        },
        'Credential does not belong to user'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
        targetId: credential.id,
        targetName: credential.name,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: 'Credential does not belong to user',
      });

      return {
        verified: false,
        error: 'Credential not found',
        errorCode: AuthenticationErrorCode.CREDENTIAL_NOT_FOUND,
      };
    }

    // Verify authentication response
    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: validated.response,
        expectedChallenge: challengeEntry.challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: this.base64UrlToUint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: this.config.userVerification === 'required',
      });
    } catch (error) {
      logger.error(
        {
          userId: validated.userId,
          credentialId: credential.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Authentication verification failed'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
        targetId: credential.id,
        targetName: credential.name,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        verified: false,
        error: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: AuthenticationErrorCode.VERIFICATION_FAILED,
      };
    }

    if (!verification.verified) {
      logger.warn(
        { userId: validated.userId, credentialId: credential.id },
        'Authentication not verified'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.AUTHENTICATION_FAILED,
        targetId: credential.id,
        targetName: credential.name,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: 'Verification returned false',
      });

      return {
        verified: false,
        error: 'Authentication verification failed',
        errorCode: AuthenticationErrorCode.VERIFICATION_FAILED,
      };
    }

    const { authenticationInfo } = verification;
    const newCounter = authenticationInfo.newCounter;

    // Check for counter rollback (potential cloned authenticator)
    if (newCounter <= credential.counter && credential.counter !== 0) {
      logger.error(
        {
          userId: validated.userId,
          credentialId: credential.id,
          storedCounter: credential.counter,
          receivedCounter: newCounter,
        },
        'Counter rollback detected - possible cloned authenticator'
      );

      await this.audit({
        userId: validated.userId,
        eventType: WebAuthnAuditEventType.COUNTER_ROLLBACK_DETECTED,
        targetId: credential.id,
        targetName: credential.name,
        action: 'verify_authentication',
        outcome: 'failure',
        reason: 'Counter rollback detected',
        metadata: {
          storedCounter: credential.counter,
          receivedCounter: newCounter,
        },
      });

      return {
        verified: false,
        error: 'Counter rollback detected - authentication rejected',
        errorCode: AuthenticationErrorCode.COUNTER_ROLLBACK,
      };
    }

    // Update credential counter and last used timestamp
    const updatedCredential = await this.store.updateCredential(credential.id, {
      counter: newCounter,
      lastUsedAt: new Date(),
    });

    // Audit log
    await this.audit({
      userId: validated.userId,
      eventType: WebAuthnAuditEventType.AUTHENTICATION_COMPLETED,
      targetId: credential.id,
      targetName: credential.name,
      action: 'verify_authentication',
      outcome: 'success',
      metadata: {
        oldCounter: credential.counter,
        newCounter,
      },
    });

    logger.info(
      {
        userId: validated.userId,
        credentialId: credential.id,
        name: credential.name,
        oldCounter: credential.counter,
        newCounter,
      },
      'Authentication completed successfully'
    );

    return {
      verified: true,
      credential: updatedCredential ?? credential,
      userId: credential.userId,
    };
  }

  // ===========================================================================
  // CREDENTIAL MANAGEMENT
  // ===========================================================================

  /**
   * List user's credentials
   *
   * @param input - List credentials input
   * @returns Array of credentials
   */
  async listCredentials(
    input: ListCredentialsInput
  ): Promise<{ credentials: WebAuthnCredential[]; total: number }> {
    const validated = listCredentialsInputSchema.parse(input);

    const credentials = await this.store.getCredentialsByUserId(validated.userId);

    // Apply pagination
    const total = credentials.length;
    const offset = validated.offset ?? 0;
    const limit = validated.limit ?? 50;
    const paginatedCredentials = credentials.slice(offset, offset + limit);

    logger.debug(
      { userId: validated.userId, total, returned: paginatedCredentials.length },
      'Listed user credentials'
    );

    return {
      credentials: paginatedCredentials,
      total,
    };
  }

  /**
   * Rename a credential
   *
   * @param input - Rename credential input
   * @returns Updated credential
   */
  async renameCredential(input: RenameCredentialInput): Promise<WebAuthnCredential> {
    const validated = renameCredentialInputSchema.parse(input);

    const credential = await this.store.getCredentialById(validated.credentialId);

    if (!credential || credential.userId !== validated.userId) {
      throw new NotFoundError(`Credential not found: ${validated.credentialId}`);
    }

    const oldName = credential.name;
    const updated = await this.store.updateCredential(validated.credentialId, {
      name: validated.name,
    });

    if (!updated) {
      throw new NotFoundError(`Credential not found: ${validated.credentialId}`);
    }

    // Audit log
    await this.audit({
      userId: validated.userId,
      eventType: WebAuthnAuditEventType.CREDENTIAL_RENAMED,
      targetId: credential.id,
      targetName: validated.name,
      action: 'rename_credential',
      outcome: 'success',
      metadata: {
        oldName,
        newName: validated.name,
      },
    });

    logger.info(
      {
        userId: validated.userId,
        credentialId: credential.id,
        oldName,
        newName: validated.name,
      },
      'Credential renamed'
    );

    return updated;
  }

  /**
   * Delete a credential
   *
   * @param input - Delete credential input
   */
  async deleteCredential(input: DeleteCredentialInput): Promise<void> {
    const validated = deleteCredentialInputSchema.parse(input);

    const credential = await this.store.getCredentialById(validated.credentialId);

    if (!credential || credential.userId !== validated.userId) {
      throw new NotFoundError(`Credential not found: ${validated.credentialId}`);
    }

    const deleted = await this.store.deleteCredential(validated.credentialId);

    if (!deleted) {
      throw new NotFoundError(`Credential not found: ${validated.credentialId}`);
    }

    // Audit log
    await this.audit({
      userId: validated.userId,
      eventType: WebAuthnAuditEventType.CREDENTIAL_DELETED,
      targetId: credential.id,
      targetName: credential.name,
      action: 'delete_credential',
      outcome: 'success',
    });

    logger.info(
      {
        userId: validated.userId,
        credentialId: credential.id,
        name: credential.name,
      },
      'Credential deleted'
    );
  }

  /**
   * Get credential count for a user
   */
  async getCredentialCount(userId: string): Promise<number> {
    return this.store.countCredentialsByUserId(userId);
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Get challenge storage key
   */
  private getChallengeKey(userId: string, type: 'registration' | 'authentication'): string {
    return `webauthn:${type}:${userId}`;
  }

  /**
   * Generate a default credential name
   */
  private generateCredentialName(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `Passkey ${dateStr}`;
  }

  /**
   * Convert Uint8Array to base64url string
   */
  private uint8ArrayToBase64Url(array: Uint8Array): string {
    const base64 = Buffer.from(array).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Convert base64url string to Uint8Array
   */
  private base64UrlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const buffer = Buffer.from(paddedBase64, 'base64');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  /**
   * Record an audit event
   */
  private async audit(params: {
    userId: string;
    eventType: string;
    targetId: string;
    targetName: string;
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogger) {
      return;
    }

    try {
      await this.auditLogger.record({
        tenantId: 'default', // WebAuthn is typically per-user, not per-tenant
        eventType: params.eventType,
        actor: { type: 'user', id: params.userId },
        target: { type: 'webauthn_credential', id: params.targetId, name: params.targetName },
        action: params.action,
        outcome: params.outcome,
        reason: params.reason,
        metadata: params.metadata,
      });
    } catch (error) {
      // Don't fail the operation if audit logging fails
      logger.error({ error, params }, 'Failed to record audit event');
    }
  }

  /**
   * Get service configuration
   */
  getConfig(): WebAuthnConfig {
    return { ...this.config };
  }
}

// =============================================================================
// FACTORY & SINGLETON
// =============================================================================

let service: WebAuthnService | null = null;

/**
 * Get the WebAuthn service singleton
 */
export function getWebAuthnService(config?: Partial<WebAuthnConfig>): WebAuthnService {
  if (!service) {
    service = new WebAuthnService({ config });
    logger.info('WebAuthn service singleton initialized');
  }
  return service;
}

/**
 * Create a new WebAuthn service instance
 */
export function createWebAuthnService(deps?: WebAuthnServiceDependencies): WebAuthnService {
  return new WebAuthnService(deps);
}

/**
 * Reset the WebAuthn service singleton (for testing)
 */
export function resetWebAuthnService(): void {
  service = null;
  logger.info('WebAuthn service singleton reset');
}
