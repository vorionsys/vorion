/**
 * Multi-Factor Authentication Module
 *
 * Provides MFA capabilities including:
 * - TOTP (Time-based One-Time Password) - Google Authenticator, Authy compatible
 * - WebAuthn/FIDO2 - YubiKey, Touch ID, Windows Hello, Passkeys
 * - Backup Codes - Recovery mechanism
 *
 * @packageDocumentation
 */

// TOTP exports
export {
  TOTPService,
  getTOTPService,
  resetTOTPService,
  type TOTPConfig,
  type TOTPSecret,
  type BackupCodeVerificationResult,
} from './totp.js';

// WebAuthn exports
export {
  WebAuthnService,
  getWebAuthnService,
  type WebAuthnConfig,
  type WebAuthnCredential,
} from './webauthn.js';

/**
 * MFA method types
 */
export type MFAMethod = 'totp' | 'webauthn' | 'backup_code';

/**
 * MFA status for a user
 */
export interface MFAStatus {
  /** Whether MFA is enabled for the user */
  enabled: boolean;
  /** List of enabled MFA methods */
  methods: MFAMethod[];
  /** Whether backup codes are available */
  backupCodesAvailable: boolean;
  /** Number of remaining backup codes */
  backupCodesRemaining?: number;
  /** When MFA was first enabled */
  enabledAt?: Date;
  /** Last MFA verification timestamp */
  lastVerifiedAt?: Date;
}

/**
 * MFA verification result
 */
export interface MFAVerificationResult {
  /** Whether verification succeeded */
  verified: boolean;
  /** Method used for verification */
  method?: MFAMethod;
  /** Error message if failed */
  error?: string;
  /** Whether a backup code was consumed */
  backupCodeUsed?: boolean;
  /** Index of backup code used (for removal) */
  backupCodeIndex?: number;
}

/**
 * MFA enrollment state
 */
export interface MFAEnrollmentState {
  /** Current enrollment step */
  step: 'select_method' | 'setup' | 'verify' | 'backup_codes' | 'complete';
  /** Method being enrolled */
  method?: MFAMethod;
  /** TOTP secret (if enrolling TOTP) */
  totpSecret?: string;
  /** TOTP QR code data URL (if enrolling TOTP) */
  totpQRCode?: string;
  /** WebAuthn registration options (if enrolling WebAuthn) */
  webauthnOptions?: unknown;
  /** Generated backup codes (shown once) */
  backupCodes?: string[];
}
