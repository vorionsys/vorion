/**
 * TOTP (Time-based One-Time Password) MFA Implementation for Vorion Platform
 *
 * Provides secure two-factor authentication using TOTP standard (RFC 6238).
 * Compatible with Google Authenticator, Authy, Microsoft Authenticator, and other TOTP apps.
 *
 * @module auth/mfa/totp
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateURI, verify as verifyOTP } from 'otplib';
import { toDataURL } from 'qrcode';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'totp-service' });

/**
 * Configuration options for TOTP generation and verification.
 */
export interface TOTPConfig {
  /** The issuer name displayed in authenticator apps (default: 'Vorion') */
  issuer: string;
  /** Hash algorithm for TOTP generation (default: 'SHA1' for maximum compatibility) */
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  /** Number of digits in the generated code (default: 6) */
  digits: 6 | 8;
  /** Time period in seconds for code rotation (default: 30) */
  period: number;
  /** Number of periods to allow before/after current time for clock drift (default: 1) */
  window: number;
}

/**
 * Generated TOTP secret with associated metadata.
 */
export interface TOTPSecret {
  /** Base32 encoded secret key */
  secret: string;
  /** OTPAuth URL for QR code generation */
  otpauthUrl: string;
  /** Optional backup codes for account recovery */
  backupCodes?: string[];
}

/**
 * Result of backup code verification.
 */
export interface BackupCodeVerificationResult {
  /** Whether the backup code was valid */
  valid: boolean;
  /** Index of the used code in the hashed codes array (for removal) */
  usedIndex?: number;
}

/**
 * Default TOTP configuration optimized for security while maintaining broad compatibility.
 * SHA256 is recommended by NIST and supported by most modern authenticator apps.
 * Falls back to SHA1 only if explicitly configured for legacy compatibility.
 */
const DEFAULT_CONFIG: TOTPConfig = {
  issuer: 'Vorion',
  algorithm: 'SHA256',
  digits: 6,
  period: 30,
  window: 1,
};

/**
 * Service for managing TOTP-based multi-factor authentication.
 *
 * Provides methods for generating secrets, verifying tokens, managing backup codes,
 * and generating QR codes for authenticator app enrollment.
 *
 * @example
 * ```typescript
 * const totpService = getTOTPService();
 *
 * // Generate a new secret for user enrollment
 * const secret = totpService.generateTOTPSecret('user123', 'user@example.com');
 *
 * // Generate QR code for authenticator app scanning
 * const qrCodeDataUrl = await totpService.generateQRCode(secret.otpauthUrl);
 *
 * // Verify a token from the user's authenticator app
 * const isValid = await totpService.verifyToken(secret.secret, '123456');
 * ```
 */
export class TOTPService {
  private readonly config: TOTPConfig;

  /**
   * Creates a new TOTPService instance.
   *
   * @param config - Partial configuration to override defaults
   */
  constructor(config: Partial<TOTPConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('TOTPService initialized', { issuer: this.config.issuer });
  }

  /**
   * Generates a new TOTP secret for user enrollment.
   *
   * Creates a cryptographically secure random secret and formats it as a
   * base32 string along with an otpauth:// URL for QR code generation.
   *
   * @param userId - Unique identifier for the user
   * @param email - User's email address (used as account name in authenticator apps)
   * @returns TOTPSecret containing the secret and otpauth URL
   *
   * @example
   * ```typescript
   * const secret = totpService.generateTOTPSecret('user123', 'user@example.com');
   * // secret.secret: 'JBSWY3DPEHPK3PXP...'
   * // secret.otpauthUrl: 'otpauth://totp/Vorion:user@example.com?secret=...'
   * ```
   */
  generateTOTPSecret(userId: string, email: string): TOTPSecret {
    // Generate a cryptographically secure random secret
    const secret = generateSecret();

    // Build the otpauth URL for QR code generation
    const otpauthUrl = generateURI({
      issuer: this.config.issuer,
      label: email,
      secret,
      algorithm: this.config.algorithm.toLowerCase() as 'sha1' | 'sha256' | 'sha512',
      digits: this.config.digits,
      period: this.config.period,
    });

    logger.debug('Generated TOTP secret', { userId, email });

    return {
      secret,
      otpauthUrl,
    };
  }

  /**
   * Generates a QR code image as a data URL for authenticator app enrollment.
   *
   * The returned data URL can be directly used as an image src attribute
   * or embedded in HTML/email for user scanning.
   *
   * @param otpauthUrl - The otpauth:// URL to encode in the QR code
   * @returns Promise resolving to a data URL (base64 PNG image)
   *
   * @example
   * ```typescript
   * const dataUrl = await totpService.generateQRCode(secret.otpauthUrl);
   * // Returns: 'data:image/png;base64,iVBORw0KGgo...'
   * ```
   */
  async generateQRCode(otpauthUrl: string): Promise<string> {
    try {
      const dataUrl = await toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 2,
        width: 256,
      });

      logger.debug('Generated QR code for TOTP enrollment');
      return dataUrl;
    } catch (error) {
      logger.error('Failed to generate QR code', { error });
      throw new Error('Failed to generate QR code for TOTP enrollment');
    }
  }

  /**
   * Verifies a TOTP token against the stored secret.
   *
   * Accounts for clock drift by allowing tokens within the configured
   * time window (default: 1 period before/after current time).
   *
   * @param secret - The base32 encoded secret associated with the user
   * @param token - The 6 or 8 digit token from the authenticator app
   * @returns Promise resolving to true if the token is valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = await totpService.verifyToken(userSecret, '123456');
   * if (isValid) {
   *   // Grant access
   * }
   * ```
   */
  async verifyToken(secret: string, token: string): Promise<boolean> {
    try {
      // Ensure token is the expected length
      if (token.length !== this.config.digits) {
        logger.debug('Token verification failed: invalid length', {
          expected: this.config.digits,
          received: token.length,
        });
        return false;
      }

      // Ensure token contains only digits
      if (!/^\d+$/.test(token)) {
        logger.debug('Token verification failed: non-numeric characters');
        return false;
      }

      const result = await verifyOTP({
        secret,
        token,
        algorithm: this.config.algorithm.toLowerCase() as 'sha1' | 'sha256' | 'sha512',
        digits: this.config.digits,
        period: this.config.period,
        epochTolerance: this.config.window * this.config.period,
      });

      logger.debug('Token verification completed', { valid: result.valid });
      return result.valid;
    } catch (error) {
      logger.error('Token verification error', { error });
      return false;
    }
  }

  /**
   * Generates cryptographically secure backup codes for account recovery.
   *
   * Backup codes are formatted as readable groups (e.g., 'XXXX-XXXX')
   * and should be hashed before storage using hashBackupCode().
   *
   * @param count - Number of backup codes to generate (default: 10)
   * @returns Array of plain-text backup codes to show to the user once
   *
   * @example
   * ```typescript
   * const codes = totpService.generateBackupCodes(10);
   * // Returns: ['A1B2-C3D4', 'E5F6-G7H8', ...]
   *
   * // Hash codes before storing
   * const hashedCodes = codes.map(code => totpService.hashBackupCode(code));
   * ```
   */
  generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    for (let i = 0; i < count; i++) {
      // Generate 8 random bytes for each code
      const bytes = randomBytes(8);
      let code = '';

      // Convert bytes to alphanumeric characters
      for (let j = 0; j < 8; j++) {
        code += characters[bytes[j] % characters.length];
      }

      // Format as XXXX-XXXX for readability
      codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
    }

    logger.debug('Generated backup codes', { count });
    return codes;
  }

  /**
   * Hashes a backup code for secure storage.
   *
   * Uses SHA-256 to create a one-way hash of the backup code.
   * The plain-text code should never be stored.
   *
   * @param code - The plain-text backup code to hash
   * @returns SHA-256 hash of the backup code (hex encoded)
   *
   * @example
   * ```typescript
   * const hashed = totpService.hashBackupCode('A1B2-C3D4');
   * // Store 'hashed' in database, never store plain-text code
   * ```
   */
  hashBackupCode(code: string): string {
    // Normalize the code (uppercase, remove formatting)
    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

    return createHash('sha256').update(normalizedCode).digest('hex');
  }

  /**
   * Verifies a backup code against a list of hashed codes.
   *
   * If valid, returns the index of the used code so it can be removed
   * from the stored list (backup codes are single-use).
   *
   * @param code - The plain-text backup code entered by the user
   * @param hashedCodes - Array of SHA-256 hashed backup codes from storage
   * @returns Object indicating validity and the index of the matched code
   *
   * @example
   * ```typescript
   * const result = totpService.verifyBackupCode('A1B2-C3D4', storedHashedCodes);
   * if (result.valid) {
   *   // Remove used code from storage
   *   storedHashedCodes.splice(result.usedIndex!, 1);
   *   // Grant access
   * }
   * ```
   */
  verifyBackupCode(
    code: string,
    hashedCodes: string[]
  ): BackupCodeVerificationResult {
    const hashedInput = this.hashBackupCode(code);

    // Use timing-safe comparison to prevent timing attacks
    for (let i = 0; i < hashedCodes.length; i++) {
      const storedHash = hashedCodes[i];

      // Compare hashes using constant-time comparison
      if (this.constantTimeEquals(hashedInput, storedHash)) {
        logger.debug('Backup code verified successfully', { codeIndex: i });
        return { valid: true, usedIndex: i };
      }
    }

    logger.debug('Backup code verification failed: no match');
    return { valid: false };
  }

  /**
   * Performs a constant-time string comparison to prevent timing attacks.
   *
   * SECURITY CRITICAL:
   * - Uses Node.js crypto.timingSafeEqual (guaranteed constant-time)
   * - Pads strings to same length to prevent length-based timing leaks
   * - No fallback implementations - requires Node.js crypto module
   *
   * @param a - First string to compare
   * @param b - Second string to compare
   * @returns true if strings are equal, false otherwise
   */
  private constantTimeEquals(a: string, b: string): boolean {
    // Convert to buffers
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');

    // Get maximum length for padding
    const maxLength = Math.max(bufferA.length, bufferB.length);

    // Handle empty strings case
    if (maxLength === 0) {
      return bufferA.length === bufferB.length;
    }

    // Pad both buffers to the same length to prevent length-based timing attacks
    // SECURITY: We must pad BEFORE comparison to prevent early-return timing leaks
    const paddedA = Buffer.alloc(maxLength, 0);
    const paddedB = Buffer.alloc(maxLength, 0);

    bufferA.copy(paddedA);
    bufferB.copy(paddedB);

    // Perform constant-time comparison on padded buffers
    const contentsEqual = timingSafeEqual(paddedA, paddedB);

    // Both contents AND original lengths must match
    return contentsEqual && bufferA.length === bufferB.length;
  }

  /**
   * Gets the current configuration.
   *
   * @returns The active TOTP configuration
   */
  getConfig(): Readonly<TOTPConfig> {
    return { ...this.config };
  }
}

// Singleton instance
let totpServiceInstance: TOTPService | null = null;

/**
 * Gets the singleton TOTPService instance.
 *
 * Creates a new instance on first call with default configuration.
 * Subsequent calls return the same instance.
 *
 * @param config - Optional configuration for the service (only used on first call)
 * @returns The TOTPService singleton instance
 *
 * @example
 * ```typescript
 * // Get default instance
 * const totpService = getTOTPService();
 *
 * // Or initialize with custom config on first call
 * const totpService = getTOTPService({ issuer: 'MyApp', digits: 8 });
 * ```
 */
export function getTOTPService(config?: Partial<TOTPConfig>): TOTPService {
  if (!totpServiceInstance) {
    totpServiceInstance = new TOTPService(config);
  }
  return totpServiceInstance;
}

/**
 * Resets the singleton instance (primarily for testing).
 *
 * @internal
 */
export function resetTOTPService(): void {
  totpServiceInstance = null;
}
