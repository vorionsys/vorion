/**
 * WebAuthn/FIDO2 MFA Implementation for Vorion Platform
 *
 * Provides secure passwordless authentication using WebAuthn standard.
 * Supports multiple authenticators per user including YubiKey, Touch ID,
 * Windows Hello, and other FIDO2-compliant devices.
 *
 * @module auth/mfa/webauthn
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifiedRegistrationResponse,
  type GenerateAuthenticationOptionsOpts,
  type VerifyAuthenticationResponseOpts,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'webauthn' });

/**
 * Authenticator transport types supported by WebAuthn
 */
export type AuthenticatorTransport = AuthenticatorTransportFuture;

/**
 * Configuration options for WebAuthn service
 */
export interface WebAuthnConfig {
  /** Relying Party name displayed to users during registration */
  rpName: string;
  /** Relying Party ID (domain), e.g., 'vorion.ai' */
  rpId: string;
  /** Full origin URL, e.g., 'https://vorion.ai' */
  origin: string;
  /** Attestation conveyance preference */
  attestation: 'none' | 'direct';
  /** User verification requirement */
  userVerification: 'required' | 'preferred' | 'discouraged';
  /** Timeout for WebAuthn operations in milliseconds */
  timeout: number;
}

/**
 * Default WebAuthn configuration
 */
const DEFAULT_CONFIG: WebAuthnConfig = {
  rpName: 'Vorion',
  rpId: 'vorion.ai',
  origin: 'https://vorion.ai',
  attestation: 'none',
  userVerification: 'preferred',
  timeout: 60000,
};

/**
 * Represents a stored WebAuthn credential
 */
export interface WebAuthnCredential {
  /** Internal unique identifier */
  id: string;
  /** Base64URL encoded credential ID from authenticator */
  credentialId: string;
  /** Base64URL encoded public key */
  publicKey: string;
  /** Signature counter for replay attack prevention */
  counter: number;
  /** Type of device (e.g., 'singleDevice', 'multiDevice') */
  deviceType: string;
  /** Whether credential is backed up (e.g., iCloud Keychain) */
  backedUp: boolean;
  /** Supported transport methods */
  transports?: AuthenticatorTransport[];
  /** Timestamp when credential was created */
  createdAt: Date;
  /** Timestamp of last successful authentication */
  lastUsedAt?: Date;
  /** User-friendly name for the credential */
  name?: string;
}

/**
 * Challenge storage entry with TTL
 */
interface ChallengeEntry {
  challenge: string;
  userId: string;
  expiresAt: number;
}

/**
 * In-memory challenge store with TTL support
 * In production, this should be replaced with Redis or similar
 */
class ChallengeStore {
  private challenges: Map<string, ChallengeEntry> = new Map();
  private readonly defaultTTL: number = 300000; // 5 minutes

  /**
   * Store a challenge with automatic expiration
   * @param userId - User identifier
   * @param challenge - The challenge string
   * @param ttl - Time to live in milliseconds
   */
  set(userId: string, challenge: string, ttl: number = this.defaultTTL): void {
    const entry: ChallengeEntry = {
      challenge,
      userId,
      expiresAt: Date.now() + ttl,
    };
    this.challenges.set(userId, entry);
    this.cleanup();
  }

  /**
   * Retrieve and delete a challenge (one-time use)
   * @param userId - User identifier
   * @returns The challenge if valid and not expired, undefined otherwise
   */
  get(userId: string): string | undefined {
    const entry = this.challenges.get(userId);
    if (!entry) {
      return undefined;
    }

    // Delete after retrieval (one-time use)
    this.challenges.delete(userId);

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      logger.warn('Challenge expired', { userId });
      return undefined;
    }

    return entry.challenge;
  }

  /**
   * Remove expired challenges
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.challenges.entries()) {
      if (now > entry.expiresAt) {
        this.challenges.delete(key);
      }
    }
  }
}

/**
 * WebAuthn service for handling FIDO2 registration and authentication
 *
 * @example
 * ```typescript
 * const webauthn = getWebAuthnService({
 *   rpName: 'Vorion',
 *   rpId: 'vorion.ai',
 *   origin: 'https://vorion.ai'
 * });
 *
 * // Generate registration options
 * const options = await webauthn.generateRegistrationOpts(
 *   'user-123',
 *   'john@vorion.ai'
 * );
 *
 * // After user completes registration on client
 * const credential = await webauthn.verifyRegistration(
 *   'user-123',
 *   clientResponse,
 *   expectedChallenge
 * );
 * ```
 */
export class WebAuthnService {
  private readonly config: WebAuthnConfig;
  private readonly challengeStore: ChallengeStore;

  /**
   * Create a new WebAuthn service instance
   * @param config - Partial configuration (merged with defaults)
   */
  constructor(config: Partial<WebAuthnConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.challengeStore = new ChallengeStore();
    logger.info('WebAuthn service initialized', {
      rpId: this.config.rpId,
      rpName: this.config.rpName,
    });
  }

  /**
   * Generate registration options for a new WebAuthn credential
   *
   * Creates the necessary options for the WebAuthn navigator.credentials.create() call.
   * Excludes any existing credentials to prevent duplicate registration.
   *
   * @param userId - Unique user identifier
   * @param userName - Human-readable user name (usually email)
   * @param existingCredentials - User's existing credentials to exclude
   * @returns PublicKeyCredentialCreationOptionsJSON for client-side registration
   *
   * @example
   * ```typescript
   * const options = await service.generateRegistrationOpts(
   *   'user-123',
   *   'john@vorion.ai',
   *   existingCredentials
   * );
   * // Send options to client for navigator.credentials.create()
   * ```
   */
  async generateRegistrationOpts(
    userId: string,
    userName: string,
    existingCredentials: WebAuthnCredential[] = []
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    logger.debug('Generating registration options', { userId, userName });

    // Convert existing credentials to exclude format
    const excludeCredentials = existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports,
    }));

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName,
      userDisplayName: userName,
      timeout: this.config.timeout,
      attestationType: this.config.attestation,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: this.config.userVerification,
      },
      supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
    });

    // Store challenge for verification
    this.challengeStore.set(userId, options.challenge, this.config.timeout);

    logger.info('Registration options generated', {
      userId,
      challenge: options.challenge.substring(0, 10) + '...',
    });

    return options;
  }

  /**
   * Verify a registration response from the client
   *
   * Validates the attestation and creates a new credential record.
   *
   * @param userId - User identifier (must match the one used in generateRegistrationOpts)
   * @param response - Registration response from navigator.credentials.create()
   * @param expectedChallenge - The challenge that was sent to the client
   * @returns The verified WebAuthn credential to store
   * @throws Error if verification fails
   *
   * @example
   * ```typescript
   * try {
   *   const credential = await service.verifyRegistration(
   *     'user-123',
   *     clientResponse,
   *     storedChallenge
   *   );
   *   // Save credential to database
   * } catch (error) {
   *   console.error('Registration failed:', error.message);
   * }
   * ```
   */
  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    expectedChallenge: string
  ): Promise<WebAuthnCredential> {
    logger.debug('Verifying registration', { userId });

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: this.config.userVerification === 'required',
      });
    } catch (error) {
      logger.error('Registration verification failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Registration verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      logger.warn('Registration not verified', { userId });
      throw new Error('Registration verification failed');
    }

    const { registrationInfo } = verification;

    // Create credential record
    const credential: WebAuthnCredential = {
      id: this.generateCredentialId(),
      credentialId: registrationInfo.credential.id,
      publicKey: this.uint8ArrayToBase64Url(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      transports: registrationInfo.credential.transports,
      createdAt: new Date(),
    };

    logger.info('Registration verified successfully', {
      userId,
      credentialId: credential.id,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
    });

    return credential;
  }

  /**
   * Generate authentication options for WebAuthn login
   *
   * Creates options for navigator.credentials.get() call.
   *
   * @param existingCredentials - User's registered credentials
   * @returns PublicKeyCredentialRequestOptionsJSON for client-side authentication
   *
   * @example
   * ```typescript
   * const options = await service.generateAuthenticationOpts(userCredentials);
   * // Send options to client for navigator.credentials.get()
   * ```
   */
  async generateAuthenticationOpts(
    existingCredentials: WebAuthnCredential[]
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    logger.debug('Generating authentication options', {
      credentialCount: existingCredentials.length,
    });

    if (existingCredentials.length === 0) {
      throw new Error('No credentials available for authentication');
    }

    // Convert credentials to allowCredentials format
    const allowCredentials = existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports,
    }));

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      timeout: this.config.timeout,
      allowCredentials,
      userVerification: this.config.userVerification,
    });

    // Store challenge - use first credential's ID as key for lookup
    // In practice, you'd use a session ID or similar
    const sessionKey = `auth:${existingCredentials[0].id}`;
    this.challengeStore.set(sessionKey, options.challenge, this.config.timeout);

    logger.info('Authentication options generated', {
      allowedCredentials: existingCredentials.length,
      challenge: options.challenge.substring(0, 10) + '...',
    });

    return options;
  }

  /**
   * Verify an authentication response from the client
   *
   * Validates the assertion and checks the signature counter to prevent replay attacks.
   *
   * @param credential - The stored credential being used
   * @param response - Authentication response from navigator.credentials.get()
   * @param expectedChallenge - The challenge that was sent to the client
   * @returns Object containing verification status and new counter value
   * @throws Error if verification fails
   *
   * @example
   * ```typescript
   * const result = await service.verifyAuthentication(
   *   storedCredential,
   *   clientResponse,
   *   storedChallenge
   * );
   *
   * if (result.verified) {
   *   // Update credential counter in database
   *   credential.counter = result.newCounter;
   *   credential.lastUsedAt = new Date();
   * }
   * ```
   */
  async verifyAuthentication(
    credential: WebAuthnCredential,
    response: AuthenticationResponseJSON,
    expectedChallenge: string
  ): Promise<{ verified: boolean; newCounter: number }> {
    logger.debug('Verifying authentication', { credentialId: credential.id });

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
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
      logger.error('Authentication verification failed', {
        credentialId: credential.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Authentication verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!verification.verified) {
      logger.warn('Authentication not verified', { credentialId: credential.id });
      return { verified: false, newCounter: credential.counter };
    }

    const { authenticationInfo } = verification;
    const newCounter = authenticationInfo.newCounter;

    // Check for counter rollback (potential cloned authenticator)
    if (newCounter <= credential.counter && credential.counter !== 0) {
      logger.error('Counter rollback detected - possible cloned authenticator', {
        credentialId: credential.id,
        storedCounter: credential.counter,
        receivedCounter: newCounter,
      });
      throw new Error('Counter rollback detected - authentication rejected');
    }

    logger.info('Authentication verified successfully', {
      credentialId: credential.id,
      oldCounter: credential.counter,
      newCounter,
    });

    return {
      verified: true,
      newCounter,
    };
  }

  /**
   * Get a stored challenge for a user (consumes the challenge)
   * @param userId - User identifier
   * @returns The stored challenge or undefined if not found/expired
   */
  getStoredChallenge(userId: string): string | undefined {
    return this.challengeStore.get(userId);
  }

  /**
   * Generate a unique credential ID
   */
  private generateCredentialId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return this.uint8ArrayToBase64Url(bytes);
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
}

/**
 * Factory function to create a WebAuthn service instance
 *
 * @param config - Partial WebAuthn configuration (merged with defaults)
 * @returns Configured WebAuthnService instance
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const webauthn = getWebAuthnService();
 *
 * // Custom configuration
 * const webauthn = getWebAuthnService({
 *   rpName: 'My App',
 *   rpId: 'myapp.com',
 *   origin: 'https://myapp.com',
 *   userVerification: 'required',
 * });
 * ```
 */
export function getWebAuthnService(config: Partial<WebAuthnConfig> = {}): WebAuthnService {
  return new WebAuthnService(config);
}

export default WebAuthnService;
