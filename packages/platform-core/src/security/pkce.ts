/**
 * PKCE (Proof Key for Code Exchange) Service
 *
 * Implements OAuth 2.1 PKCE per RFC 7636 for CAR security hardening.
 * PKCE prevents authorization code interception attacks by binding
 * the authorization request to the token exchange request.
 *
 * Key features:
 * - Cryptographically secure code_verifier generation
 * - S256 code_challenge computation (SHA-256)
 * - Verification of code_verifier against stored challenge
 * - Redis/KV storage support for challenge state
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { VorionError } from '../common/errors.js';
import { Counter } from 'prom-client';
import { intentRegistry } from '../intent/metrics.js';
import { z } from 'zod';

const logger = createLogger({ component: 'security-pkce' });

// =============================================================================
// Constants
// =============================================================================

/**
 * PKCE code_verifier minimum length per RFC 7636
 */
export const CODE_VERIFIER_MIN_LENGTH = 43;

/**
 * PKCE code_verifier maximum length per RFC 7636
 */
export const CODE_VERIFIER_MAX_LENGTH = 128;

/**
 * PKCE code_verifier character set per RFC 7636
 * unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 */
const CODE_VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Default code_verifier length (64 chars provides ~384 bits of entropy)
 */
const DEFAULT_VERIFIER_LENGTH = 64;

/**
 * Default challenge expiry time in milliseconds (10 minutes)
 */
const DEFAULT_CHALLENGE_EXPIRY_MS = 10 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * PKCE challenge method - only S256 is supported per OAuth 2.1
 */
export const PKCEChallengeMethod = {
  S256: 'S256',
} as const;

export type PKCEChallengeMethod = (typeof PKCEChallengeMethod)[keyof typeof PKCEChallengeMethod];

export const pkceChallengeMethodSchema = z.literal('S256');

/**
 * PKCE pair containing verifier and challenge
 */
export interface PKCEPair {
  /** The code_verifier - a cryptographically random string */
  codeVerifier: string;
  /** The code_challenge - BASE64URL(SHA256(code_verifier)) */
  codeChallenge: string;
  /** The challenge method - always S256 */
  codeChallengeMethod: PKCEChallengeMethod;
}

export const pkcePairSchema = z.object({
  codeVerifier: z.string().min(CODE_VERIFIER_MIN_LENGTH).max(CODE_VERIFIER_MAX_LENGTH),
  codeChallenge: z.string().min(1),
  codeChallengeMethod: pkceChallengeMethodSchema,
});

/**
 * PKCE verification result
 */
export interface PKCEVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;
  /** Error reason if verification failed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: 'INVALID_VERIFIER' | 'CHALLENGE_MISMATCH' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND';
  /** Verification timestamp */
  verifiedAt: string;
}

export const pkceVerificationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
  errorCode: z.enum(['INVALID_VERIFIER', 'CHALLENGE_MISMATCH', 'CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND']).optional(),
  verifiedAt: z.string().datetime(),
});

/**
 * Stored PKCE challenge state
 */
export interface PKCEChallengeState {
  /** The code_challenge from authorization request */
  codeChallenge: string;
  /** The challenge method (S256) */
  codeChallengeMethod: PKCEChallengeMethod;
  /** When the challenge was created */
  createdAt: number;
  /** When the challenge expires */
  expiresAt: number;
  /** Associated state token for CSRF protection */
  state?: string;
  /** Client ID that initiated the request */
  clientId?: string;
  /** Redirect URI for callback */
  redirectUri?: string;
}

export const pkceChallengeStateSchema = z.object({
  codeChallenge: z.string().min(1),
  codeChallengeMethod: pkceChallengeMethodSchema,
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  state: z.string().optional(),
  clientId: z.string().optional(),
  redirectUri: z.string().url().optional(),
});

/**
 * PKCE configuration
 */
export interface PKCEConfig {
  /** Code verifier length (default: 64) */
  verifierLength: number;
  /** Challenge expiry in milliseconds (default: 10 minutes) */
  challengeExpiryMs: number;
  /** Require PKCE for all OAuth flows */
  required: boolean;
}

export const pkceConfigSchema = z.object({
  verifierLength: z.number().int().min(CODE_VERIFIER_MIN_LENGTH).max(CODE_VERIFIER_MAX_LENGTH).default(DEFAULT_VERIFIER_LENGTH),
  challengeExpiryMs: z.number().int().positive().default(DEFAULT_CHALLENGE_EXPIRY_MS),
  required: z.boolean().default(true),
});

/**
 * PKCE challenge store interface
 */
export interface PKCEChallengeStore {
  /** Store a challenge with its associated authorization code */
  store(authorizationCode: string, state: PKCEChallengeState): Promise<void>;
  /** Retrieve and delete a challenge (one-time use) */
  retrieve(authorizationCode: string): Promise<PKCEChallengeState | null>;
  /** Delete a challenge */
  delete(authorizationCode: string): Promise<void>;
}

// =============================================================================
// Metrics
// =============================================================================

const pkcePairsGenerated = new Counter({
  name: 'vorion_security_pkce_pairs_generated_total',
  help: 'Total PKCE pairs generated',
  registers: [intentRegistry],
});

const pkceVerifications = new Counter({
  name: 'vorion_security_pkce_verifications_total',
  help: 'Total PKCE verifications',
  labelNames: ['result'] as const, // success, invalid, expired, not_found
  registers: [intentRegistry],
});

// =============================================================================
// Errors
// =============================================================================

/**
 * PKCE-specific error
 */
export class PKCEError extends VorionError {
  override code = 'PKCE_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'PKCEError';
  }
}

// =============================================================================
// In-Memory Challenge Store (for development/single-instance)
// =============================================================================

/**
 * Simple in-memory PKCE challenge store implementation
 * For production, use Redis-backed implementation
 */
class InMemoryPKCEStore implements PKCEChallengeStore {
  private challengeCache = new Map<string, PKCEChallengeState>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async store(authorizationCode: string, state: PKCEChallengeState): Promise<void> {
    this.challengeCache.set(authorizationCode, state);
  }

  async retrieve(authorizationCode: string): Promise<PKCEChallengeState | null> {
    const state = this.challengeCache.get(authorizationCode);
    if (!state) {
      return null;
    }
    // One-time use - delete after retrieval
    this.challengeCache.delete(authorizationCode);
    return state;
  }

  async delete(authorizationCode: string): Promise<void> {
    this.challengeCache.delete(authorizationCode);
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.challengeCache.entries());
    for (const [code, state] of entries) {
      if (now > state.expiresAt) {
        this.challengeCache.delete(code);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.challengeCache.clear();
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a cryptographically secure code_verifier
 */
function generateCodeVerifier(length: number = DEFAULT_VERIFIER_LENGTH): string {
  if (length < CODE_VERIFIER_MIN_LENGTH || length > CODE_VERIFIER_MAX_LENGTH) {
    throw new PKCEError(
      `code_verifier length must be between ${CODE_VERIFIER_MIN_LENGTH} and ${CODE_VERIFIER_MAX_LENGTH}`,
      { providedLength: length }
    );
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let verifier = '';
  for (let i = 0; i < length; i++) {
    verifier += CODE_VERIFIER_CHARSET[bytes[i]! % CODE_VERIFIER_CHARSET.length];
  }

  return verifier;
}

/**
 * Calculate code_challenge from code_verifier using S256 method
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
async function calculateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);

  // Base64url encode
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Validate code_verifier format per RFC 7636
 */
function isValidCodeVerifier(codeVerifier: string): boolean {
  if (codeVerifier.length < CODE_VERIFIER_MIN_LENGTH || codeVerifier.length > CODE_VERIFIER_MAX_LENGTH) {
    return false;
  }

  // Check all characters are in the allowed set
  const validChars = /^[A-Za-z0-9\-._~]+$/;
  return validChars.test(codeVerifier);
}

// =============================================================================
// PKCE Service
// =============================================================================

/**
 * PKCE Service for generating and verifying PKCE challenges
 *
 * @example
 * ```typescript
 * const pkce = new PKCEService();
 *
 * // Generate a PKCE pair for authorization request
 * const pair = await pkce.generatePair();
 * // Send code_challenge to authorization endpoint
 * // Store code_verifier securely for token exchange
 *
 * // On callback, verify the code_verifier
 * const result = await pkce.verify(codeVerifier, storedChallenge);
 * ```
 */
export class PKCEService {
  private config: PKCEConfig;
  private challengeStore: PKCEChallengeStore;

  /**
   * Create a new PKCE service
   *
   * @param config - PKCE configuration
   * @param challengeStore - Store for PKCE challenges (defaults to in-memory)
   */
  constructor(config?: Partial<PKCEConfig>, challengeStore?: PKCEChallengeStore) {
    const defaultConfig: PKCEConfig = {
      verifierLength: DEFAULT_VERIFIER_LENGTH,
      challengeExpiryMs: DEFAULT_CHALLENGE_EXPIRY_MS,
      required: true,
    };
    this.config = { ...defaultConfig, ...pkceConfigSchema.parse(config || {}) };
    this.challengeStore = challengeStore ?? new InMemoryPKCEStore();

    logger.info(
      {
        verifierLength: this.config.verifierLength,
        challengeExpiryMs: this.config.challengeExpiryMs,
        required: this.config.required,
      },
      'PKCE service initialized'
    );
  }

  /**
   * Generate a PKCE pair (code_verifier and code_challenge)
   *
   * @returns PKCE pair with verifier, challenge, and method
   */
  async generatePair(): Promise<PKCEPair> {
    const codeVerifier = generateCodeVerifier(this.config.verifierLength);
    const codeChallenge = await calculateCodeChallenge(codeVerifier);

    pkcePairsGenerated.inc();
    logger.debug({ challengeLength: codeChallenge.length }, 'PKCE pair generated');

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: PKCEChallengeMethod.S256,
    };
  }

  /**
   * Store a PKCE challenge for later verification
   *
   * @param authorizationCode - The authorization code from OAuth callback
   * @param codeChallenge - The code_challenge from authorization request
   * @param options - Additional options (state, clientId, redirectUri)
   */
  async storeChallenge(
    authorizationCode: string,
    codeChallenge: string,
    options?: {
      state?: string;
      clientId?: string;
      redirectUri?: string;
    }
  ): Promise<void> {
    const now = Date.now();
    const challengeState: PKCEChallengeState = {
      codeChallenge,
      codeChallengeMethod: PKCEChallengeMethod.S256,
      createdAt: now,
      expiresAt: now + this.config.challengeExpiryMs,
      state: options?.state,
      clientId: options?.clientId,
      redirectUri: options?.redirectUri,
    };

    await this.challengeStore.store(authorizationCode, challengeState);
    logger.debug({ authorizationCode: authorizationCode.substring(0, 8) + '...' }, 'PKCE challenge stored');
  }

  /**
   * Verify a code_verifier against a stored challenge
   *
   * @param authorizationCode - The authorization code
   * @param codeVerifier - The code_verifier from token exchange request
   * @returns Verification result
   */
  async verifyChallenge(
    authorizationCode: string,
    codeVerifier: string
  ): Promise<PKCEVerificationResult> {
    // Validate verifier format
    if (!isValidCodeVerifier(codeVerifier)) {
      pkceVerifications.inc({ result: 'invalid' });
      return {
        valid: false,
        error: 'Invalid code_verifier format',
        errorCode: 'INVALID_VERIFIER',
        verifiedAt: new Date().toISOString(),
      };
    }

    // Retrieve stored challenge
    const storedState = await this.challengeStore.retrieve(authorizationCode);
    if (!storedState) {
      pkceVerifications.inc({ result: 'not_found' });
      return {
        valid: false,
        error: 'PKCE challenge not found or already used',
        errorCode: 'CHALLENGE_NOT_FOUND',
        verifiedAt: new Date().toISOString(),
      };
    }

    // Check expiry
    if (Date.now() > storedState.expiresAt) {
      pkceVerifications.inc({ result: 'expired' });
      return {
        valid: false,
        error: 'PKCE challenge expired',
        errorCode: 'CHALLENGE_EXPIRED',
        verifiedAt: new Date().toISOString(),
      };
    }

    // Calculate challenge from verifier and compare
    const computedChallenge = await calculateCodeChallenge(codeVerifier);
    if (computedChallenge !== storedState.codeChallenge) {
      pkceVerifications.inc({ result: 'invalid' });
      logger.warn('PKCE challenge mismatch');
      return {
        valid: false,
        error: 'code_verifier does not match code_challenge',
        errorCode: 'CHALLENGE_MISMATCH',
        verifiedAt: new Date().toISOString(),
      };
    }

    pkceVerifications.inc({ result: 'success' });
    logger.debug('PKCE challenge verified successfully');

    return {
      valid: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify a code_verifier directly against a code_challenge
   * (without using the store - for stateless verification)
   *
   * @param codeVerifier - The code_verifier from token exchange
   * @param codeChallenge - The code_challenge from authorization request
   * @returns Verification result
   */
  async verifyDirect(
    codeVerifier: string,
    codeChallenge: string
  ): Promise<PKCEVerificationResult> {
    // Validate verifier format
    if (!isValidCodeVerifier(codeVerifier)) {
      pkceVerifications.inc({ result: 'invalid' });
      return {
        valid: false,
        error: 'Invalid code_verifier format',
        errorCode: 'INVALID_VERIFIER',
        verifiedAt: new Date().toISOString(),
      };
    }

    // Calculate challenge from verifier and compare
    const computedChallenge = await calculateCodeChallenge(codeVerifier);
    if (computedChallenge !== codeChallenge) {
      pkceVerifications.inc({ result: 'invalid' });
      return {
        valid: false,
        error: 'code_verifier does not match code_challenge',
        errorCode: 'CHALLENGE_MISMATCH',
        verifiedAt: new Date().toISOString(),
      };
    }

    pkceVerifications.inc({ result: 'success' });
    return {
      valid: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a code_challenge from a code_verifier
   *
   * @param codeVerifier - The code_verifier to hash
   * @returns The code_challenge (BASE64URL(SHA256(code_verifier)))
   */
  async generateChallenge(codeVerifier: string): Promise<string> {
    if (!isValidCodeVerifier(codeVerifier)) {
      throw new PKCEError('Invalid code_verifier format');
    }
    return calculateCodeChallenge(codeVerifier);
  }

  /**
   * Check if PKCE is required
   */
  isRequired(): boolean {
    return this.config.required;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<PKCEConfig> {
    return { ...this.config };
  }
}

/**
 * Create a PKCE service with default configuration for OAuth 2.1
 */
export function createPKCEService(
  config?: Partial<PKCEConfig>,
  challengeStore?: PKCEChallengeStore
): PKCEService {
  return new PKCEService(config, challengeStore);
}

// =============================================================================
// Utility Exports
// =============================================================================

export {
  generateCodeVerifier,
  calculateCodeChallenge,
  isValidCodeVerifier,
};
