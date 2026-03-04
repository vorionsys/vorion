/**
 * Data Loss Prevention (DLP) Module
 *
 * Comprehensive sensitive data detection and protection for CAR applications.
 * Provides scanning, redaction, and Fastify middleware for request/response
 * protection against data leakage.
 *
 * Features:
 * - Credit card number detection (Visa, Mastercard, Amex, Discover)
 * - SSN detection with format validation
 * - API key detection (AWS, GCP, Azure, Stripe, GitHub, etc.)
 * - Private key detection (RSA, EC, PGP)
 * - Password detection in URLs and JSON
 * - PII detection (email, phone numbers)
 * - IP address detection
 * - JWT token detection
 * - HIPAA-relevant health data keyword detection
 *
 * @packageDocumentation
 * @module security/dlp
 */

// =============================================================================
// Types and Enums
// =============================================================================

export {
  // Enums
  DataType,

  // Types
  type RiskLevel,
  type ScanMode,
  type DLPFinding,
  type DLPScanResult,
  type DLPScannerConfig,

  // Schemas
  dlpScannerConfigSchema,

  // Default configuration
  DEFAULT_DLP_CONFIG,
} from './scanner.js';

// =============================================================================
// Scanner Class
// =============================================================================

export {
  DLPScanner,
} from './scanner.js';

// =============================================================================
// Error Classes
// =============================================================================

export {
  DLPError,
  SensitiveDataBlockedError,
  DLPScanTimeoutError,
} from './scanner.js';

// =============================================================================
// Fastify Middleware
// =============================================================================

export {
  // Request scanner
  dlpRequestScanner,
  type DLPRequestScannerOptions,

  // Response scanner
  dlpResponseScanner,
  type DLPResponseScannerOptions,

  // Plugin
  dlpPlugin,
  type DLPPluginOptions,
} from './scanner.js';

// =============================================================================
// Singleton Management
// =============================================================================

export {
  getDLPScanner,
  resetDLPScanner,
  createDLPScanner,
} from './scanner.js';
