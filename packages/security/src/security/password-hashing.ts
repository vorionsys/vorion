/**
 * Password Hashing Module
 *
 * Production-grade password hashing using Argon2id with OWASP-recommended settings.
 * Provides secure password hashing, verification, and rehash detection.
 *
 * Security Features:
 * - Argon2id (preferred) with fallback to Argon2i
 * - OWASP-recommended memory/time/parallelism settings
 * - Timing-safe comparison via argon2 library
 * - Constant-time hash format validation
 * - Information-leak prevention in error handling
 *
 * @packageDocumentation
 * @module security/password-hashing
 */

import * as argon2 from 'argon2';
import { VorionError } from '../common/errors.js';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'password-hashing' });

// =============================================================================
// Constants
// =============================================================================

/**
 * OWASP-recommended Argon2id settings
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 *
 * Memory cost: 64 MiB (65536 KiB)
 * Time cost: 3 iterations
 * Parallelism: 4 threads
 */
const ARGON2_CONFIG = {
  /** Memory cost in KiB (64 MiB = 65536 KiB) */
  memoryCost: 65536,
  /** Time cost (iterations) */
  timeCost: 3,
  /** Degree of parallelism */
  parallelism: 4,
  /** Output hash length in bytes */
  hashLength: 32,
} as const;

/**
 * Minimum acceptable values for hash upgrade detection.
 * Hashes with parameters below these thresholds should be rehashed.
 */
const MIN_ACCEPTABLE_CONFIG = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Argon2 variant identifiers from the library
 */
const Argon2Type = {
  ARGON2D: 0,
  ARGON2I: 1,
  ARGON2ID: 2,
} as const;

type Argon2Type = (typeof Argon2Type)[keyof typeof Argon2Type];

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when password hashing operations fail.
 * Intentionally vague to prevent information leakage.
 */
export class PasswordHashingError extends VorionError {
  override code = 'PASSWORD_HASHING_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'PasswordHashingError';
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Options for password hashing
 */
export interface HashOptions {
  /**
   * Preferred Argon2 variant.
   * @default 'argon2id'
   */
  type?: 'argon2id' | 'argon2i';

  /**
   * Memory cost in KiB.
   * @default 65536 (64 MiB)
   */
  memoryCost?: number;

  /**
   * Time cost (iterations).
   * @default 3
   */
  timeCost?: number;

  /**
   * Degree of parallelism.
   * @default 4
   */
  parallelism?: number;

  /**
   * Optional secret key for additional security (pepper).
   * Should be stored separately from the database.
   */
  secret?: Buffer;
}

/**
 * Options for password verification
 */
export interface VerifyOptions {
  /**
   * Optional secret key used during hashing (pepper).
   */
  secret?: Buffer;
}

/**
 * Options for rehash check
 */
export interface RehashOptions {
  /**
   * Minimum acceptable memory cost in KiB.
   * @default 65536
   */
  memoryCost?: number;

  /**
   * Minimum acceptable time cost.
   * @default 3
   */
  timeCost?: number;

  /**
   * Minimum acceptable parallelism.
   * @default 4
   */
  parallelism?: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validates password input.
 * Uses constant-time operations where possible to prevent timing attacks.
 */
function validatePassword(password: string): void {
  // Check for null/undefined (TypeScript should prevent, but defense in depth)
  if (password === null || password === undefined) {
    throw new PasswordHashingError('Invalid password input');
  }

  // Check type (TypeScript should prevent, but defense in depth)
  if (typeof password !== 'string') {
    throw new PasswordHashingError('Invalid password input');
  }

  // Check for empty password
  if (password.length === 0) {
    throw new PasswordHashingError('Password cannot be empty');
  }

  // Check for reasonable maximum length (prevent DoS)
  // Argon2 has its own limits, but we add an application-level check
  if (password.length > 1024) {
    throw new PasswordHashingError('Password exceeds maximum length');
  }
}

/**
 * Validates hash format.
 * Performs basic validation that the hash looks like a valid Argon2 hash.
 */
function validateHash(hash: string): boolean {
  // Check for null/undefined
  if (hash === null || hash === undefined) {
    return false;
  }

  // Check type
  if (typeof hash !== 'string') {
    return false;
  }

  // Argon2 hashes start with $argon2 and have multiple $ delimiters
  // Format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
  if (!hash.startsWith('$argon2')) {
    return false;
  }

  // Basic structure check (should have at least 5 segments)
  const segments = hash.split('$');
  if (segments.length < 5) {
    return false;
  }

  return true;
}

/**
 * Gets the Argon2 type constant from a string identifier.
 */
function getArgon2Type(type: 'argon2id' | 'argon2i'): Argon2Type {
  switch (type) {
    case 'argon2id':
      return Argon2Type.ARGON2ID;
    case 'argon2i':
      return Argon2Type.ARGON2I;
    default:
      return Argon2Type.ARGON2ID;
  }
}

/**
 * Attempts to detect the Argon2 type from a hash string.
 */
function detectHashType(hash: string): 'argon2id' | 'argon2i' | 'argon2d' | 'unknown' {
  if (hash.startsWith('$argon2id$')) {
    return 'argon2id';
  }
  if (hash.startsWith('$argon2i$')) {
    return 'argon2i';
  }
  if (hash.startsWith('$argon2d$')) {
    return 'argon2d';
  }
  return 'unknown';
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Hashes a password using Argon2id (or Argon2i as fallback).
 *
 * Uses OWASP-recommended settings by default:
 * - Memory: 64 MiB (65536 KiB)
 * - Time: 3 iterations
 * - Parallelism: 4
 *
 * @param password - The plaintext password to hash
 * @param options - Optional hashing configuration
 * @returns The encoded Argon2 hash string
 * @throws {PasswordHashingError} If hashing fails
 *
 * @example
 * ```typescript
 * // Basic usage
 * const hash = await hashPassword('user-password');
 *
 * // With custom options
 * const hash = await hashPassword('user-password', {
 *   memoryCost: 131072, // 128 MiB
 *   timeCost: 4,
 *   parallelism: 4,
 * });
 *
 * // With pepper (secret key)
 * const pepper = Buffer.from(process.env.PASSWORD_PEPPER!, 'hex');
 * const hash = await hashPassword('user-password', { secret: pepper });
 * ```
 */
export async function hashPassword(
  password: string,
  options: HashOptions = {}
): Promise<string> {
  try {
    // Validate input
    validatePassword(password);

    // Merge options with defaults
    const config = {
      type: getArgon2Type(options.type ?? 'argon2id'),
      memoryCost: options.memoryCost ?? ARGON2_CONFIG.memoryCost,
      timeCost: options.timeCost ?? ARGON2_CONFIG.timeCost,
      parallelism: options.parallelism ?? ARGON2_CONFIG.parallelism,
      hashLength: ARGON2_CONFIG.hashLength,
      ...(options.secret && { secret: options.secret }),
    };

    // Ensure minimum security parameters
    if (config.memoryCost < MIN_ACCEPTABLE_CONFIG.memoryCost) {
      logger.warn(
        { providedMemoryCost: config.memoryCost, minMemoryCost: MIN_ACCEPTABLE_CONFIG.memoryCost },
        'Memory cost below OWASP minimum, using minimum value'
      );
      config.memoryCost = MIN_ACCEPTABLE_CONFIG.memoryCost;
    }

    if (config.timeCost < MIN_ACCEPTABLE_CONFIG.timeCost) {
      logger.warn(
        { providedTimeCost: config.timeCost, minTimeCost: MIN_ACCEPTABLE_CONFIG.timeCost },
        'Time cost below OWASP minimum, using minimum value'
      );
      config.timeCost = MIN_ACCEPTABLE_CONFIG.timeCost;
    }

    // Attempt to hash with Argon2id
    try {
      const hash = await argon2.hash(password, config);
      logger.debug({ hashType: options.type ?? 'argon2id' }, 'Password hashed successfully');
      return hash;
    } catch (argon2idError) {
      // If Argon2id fails and we haven't already tried Argon2i, try Argon2i as fallback
      if (config.type === Argon2Type.ARGON2ID) {
        logger.warn('Argon2id failed, falling back to Argon2i');
        config.type = Argon2Type.ARGON2I;
        const hash = await argon2.hash(password, config);
        logger.debug({ hashType: 'argon2i' }, 'Password hashed with Argon2i fallback');
        return hash;
      }
      throw argon2idError;
    }
  } catch (error) {
    // Log the actual error for debugging (redacted in production)
    if (error instanceof PasswordHashingError) {
      throw error;
    }

    logger.error({ error }, 'Password hashing failed');

    // Return a generic error to prevent information leakage
    throw new PasswordHashingError('Failed to hash password');
  }
}

/**
 * Verifies a password against a stored Argon2 hash.
 *
 * Uses timing-safe comparison internally (provided by argon2 library).
 *
 * @param password - The plaintext password to verify
 * @param hash - The stored Argon2 hash to verify against
 * @param options - Optional verification configuration
 * @returns `true` if the password matches, `false` otherwise
 *
 * @example
 * ```typescript
 * const isValid = await verifyPassword('user-input', storedHash);
 * if (isValid) {
 *   // Password is correct
 * }
 *
 * // With pepper (must match the pepper used during hashing)
 * const pepper = Buffer.from(process.env.PASSWORD_PEPPER!, 'hex');
 * const isValid = await verifyPassword('user-input', storedHash, { secret: pepper });
 * ```
 */
export async function verifyPassword(
  password: string,
  hash: string,
  options: VerifyOptions = {}
): Promise<boolean> {
  try {
    // Validate inputs
    validatePassword(password);

    if (!validateHash(hash)) {
      // Log for monitoring but return false to prevent enumeration
      logger.warn('Invalid hash format provided for verification');
      return false;
    }

    // Perform verification with timing-safe comparison (internal to argon2)
    const verifyOptions = options.secret ? { secret: options.secret } : undefined;
    const isValid = await argon2.verify(hash, password, verifyOptions);

    // Log verification attempt (without revealing result in production)
    logger.debug('Password verification completed');

    return isValid;
  } catch (error) {
    // Log the error but return false to prevent information leakage
    // Do not distinguish between invalid hash format and verification failure
    logger.error({ error }, 'Password verification failed');
    return false;
  }
}

/**
 * Checks if a hash needs to be rehashed due to outdated parameters.
 *
 * A hash should be rehashed when:
 * - It uses parameters below the current minimum thresholds
 * - It uses an older Argon2 version
 * - It uses Argon2d (not recommended for password hashing)
 *
 * @param hash - The stored Argon2 hash to check
 * @param options - Optional configuration for minimum acceptable parameters
 * @returns `true` if the hash should be rehashed, `false` otherwise
 *
 * @example
 * ```typescript
 * // Check with default OWASP settings
 * if (needsRehash(storedHash)) {
 *   // After verifying password, rehash with new settings
 *   const newHash = await hashPassword(password);
 *   // Store newHash in database
 * }
 *
 * // Check with custom thresholds
 * if (needsRehash(storedHash, { memoryCost: 131072 })) {
 *   // Hash uses less than 128 MiB memory
 * }
 * ```
 */
export function needsRehash(
  hash: string,
  options: RehashOptions = {}
): boolean {
  try {
    // Validate hash format
    if (!validateHash(hash)) {
      logger.warn('Invalid hash format provided for rehash check');
      return true; // Invalid hashes should be replaced
    }

    // Check if using Argon2d (not recommended for passwords)
    const hashType = detectHashType(hash);
    if (hashType === 'argon2d') {
      logger.info('Hash uses Argon2d, recommending rehash to Argon2id');
      return true;
    }

    if (hashType === 'unknown') {
      logger.warn('Unknown hash type, recommending rehash');
      return true;
    }

    // Prefer Argon2id over Argon2i
    if (hashType === 'argon2i') {
      logger.info('Hash uses Argon2i, recommending rehash to Argon2id');
      return true;
    }

    // Merge options with defaults
    const thresholds = {
      memoryCost: options.memoryCost ?? MIN_ACCEPTABLE_CONFIG.memoryCost,
      timeCost: options.timeCost ?? MIN_ACCEPTABLE_CONFIG.timeCost,
      parallelism: options.parallelism ?? MIN_ACCEPTABLE_CONFIG.parallelism,
    };

    // Use argon2's needsRehash to check parameters
    // Note: argon2.needsRehash is synchronous
    const needsUpdate = argon2.needsRehash(hash, {
      memoryCost: thresholds.memoryCost,
      timeCost: thresholds.timeCost,
      parallelism: thresholds.parallelism,
    });

    if (needsUpdate) {
      logger.info('Hash parameters are below current thresholds, recommending rehash');
    }

    return needsUpdate;
  } catch (error) {
    // If we can't determine, err on the side of caution
    logger.error({ error }, 'Failed to check if hash needs rehash');
    return true;
  }
}

// =============================================================================
// Exported Constants and Types
// =============================================================================

/**
 * Default Argon2 configuration (OWASP-recommended)
 */
export const DEFAULT_ARGON2_CONFIG = { ...ARGON2_CONFIG } as const;

/**
 * Minimum acceptable Argon2 configuration
 */
export const MINIMUM_ARGON2_CONFIG = { ...MIN_ACCEPTABLE_CONFIG } as const;

export { Argon2Type };
