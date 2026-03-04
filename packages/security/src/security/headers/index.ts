/**
 * Security Headers Management
 *
 * Comprehensive security headers management service for the Vorion platform.
 *
 * @packageDocumentation
 * @module security/headers
 *
 * @example
 * ```typescript
 * import {
 *   securityHeadersPlugin,
 *   createStrictSecurityHeaders,
 *   CSPBuilder,
 *   HSTSManager,
 *   PermissionsPolicyManager,
 * } from './security/headers/index.js';
 *
 * // Register plugin
 * await fastify.register(securityHeadersPlugin, createStrictSecurityHeaders());
 *
 * // Or build individual headers
 * const csp = new CSPBuilder()
 *   .preset('strict')
 *   .withNonce()
 *   .build();
 *
 * const hsts = new HSTSManager({
 *   maxAge: 63072000,
 *   includeSubDomains: true,
 *   preload: true,
 * }).buildHeader();
 *
 * const pp = new PermissionsPolicyManager()
 *   .preset('strict')
 *   .allowSelf('fullscreen')
 *   .build();
 * ```
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // CSP Types
  CSPSourceValue,
  CSPSandboxValue,
  CSPDirectives,
  CSPReportingConfig,

  // HSTS Types
  HSTSConfig,

  // CORS Types
  CORSConfig,

  // Permissions Policy Types
  PermissionsPolicyValue,
  PermissionsPolicyConfig,

  // Cross-Origin Policy Types
  COEPValue,
  COOPValue,
  CORPValue,
  ReferrerPolicyValue,
  XFrameOptionsValue,

  // Configuration Types
  SecurityHeadersConfig,

  // Validation Types
  ValidationSeverity,
  ValidationIssue,
  HeaderValidationResult,

  // CSP Violation Types
  CSPViolationReport,
} from './types.js';

// =============================================================================
// Zod Schema Exports
// =============================================================================

export {
  // CSP Schemas
  cspSourceValueSchema,
  cspSandboxValueSchema,
  cspDirectivesSchema,
  cspReportingConfigSchema,

  // HSTS Schemas
  hstsConfigSchema,
  HSTS_MIN_MAX_AGE_FOR_PRELOAD,
  HSTS_RECOMMENDED_MAX_AGE,

  // CORS Schemas
  corsConfigSchema,

  // Permissions Policy Schemas
  permissionsPolicyValueSchema,
  permissionsPolicyConfigSchema,

  // Configuration Schemas
  securityHeadersConfigSchema,

  // Validation Schemas
  validationIssueSchema,
  headerValidationResultSchema,

  // Violation Schemas
  cspViolationReportSchema,
} from './types.js';

// =============================================================================
// CSP Exports
// =============================================================================

export {
  // Class
  CSPBuilder,

  // Types
  type CSPPreset,
  type CSPValidationError,
  type CSPBuildResult,

  // Nonce Functions
  generateNonce,
  formatNonce,

  // Presets
  STRICT_CSP_PRESET,
  MODERATE_CSP_PRESET,
  RELAXED_CSP_PRESET,
  API_CSP_PRESET,
  getCSPPreset,

  // Factory Functions
  createStrictCSP,
  createModerateCSP,
  createAPICSP,
  createDevelopmentCSP,

  // Utility Functions
  buildCSPString,
  parseCSPString,
} from './csp.js';

// =============================================================================
// HSTS Exports
// =============================================================================

export {
  // Class
  HSTSManager,

  // Types
  type HSTSValidationResult,
  type HSTSValidationIssue,

  // Constants
  HSTS_HEADER_NAME,
  HSTS_MIN_RECOMMENDED_MAX_AGE,
  HSTS_MAX_SENSIBLE_MAX_AGE,

  // Factory Functions
  createProductionHSTS,
  createPreloadHSTS,
  createDevelopmentHSTS,
  createHSTS,

  // Utility Functions
  buildHSTSHeader,
  parseHSTSHeader,
  validateHSTSHeader,
} from './hsts.js';

// =============================================================================
// Permissions Policy Exports
// =============================================================================

export {
  // Class
  PermissionsPolicyManager,

  // Types
  type FeaturePermission,
  type PermissionsPolicyIssue,
  type PermissionsPolicyValidationResult,

  // Constants
  PERMISSIONS_POLICY_HEADER,
  KNOWN_FEATURES,
  HIGH_RISK_FEATURES,
  SENSOR_FEATURES,

  // Presets
  STRICT_PERMISSIONS_PRESET,
  MODERATE_PERMISSIONS_PRESET,
  API_PERMISSIONS_PRESET,

  // Factory Functions
  createStrictPermissionsPolicy,
  createModeratePermissionsPolicy,
  createAPIPermissionsPolicy,
  createPermissionsPolicy,

  // Utility Functions
  buildPermissionsPolicyHeader,
  parsePermissionsPolicyHeader,
  getSecureDefault,
} from './permissions-policy.js';

// =============================================================================
// Validator Exports
// =============================================================================

export {
  validateSecurityHeaders,
  assertValidSecurityHeaders,
  getSecurityHeadersSummary,
} from './validator.js';

// =============================================================================
// Middleware Exports
// =============================================================================

export {
  // Plugin
  securityHeadersPlugin,

  // Types
  type SecurityHeadersMiddlewareOptions,
  type SecurityHeadersContext,

  // Factory Functions
  createStrictSecurityHeaders,
  createAPISecurityHeaders,
  createDevelopmentSecurityHeaders,
  createSecurityHeaders,
} from './middleware.js';
