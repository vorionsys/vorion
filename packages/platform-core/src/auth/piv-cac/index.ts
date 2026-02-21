/**
 * PIV/CAC Smart Card Authentication Module
 *
 * Comprehensive support for Personal Identity Verification (PIV) and
 * Common Access Card (CAC) smart card authentication.
 *
 * Features:
 * - X.509 certificate authentication
 * - OCSP certificate revocation checking
 * - CRL certificate revocation checking
 * - Certificate-to-user mapping (UPN/SAN)
 * - Card removal session termination
 * - PKCS#11 smart card integration
 * - Fastify middleware and routes
 * - DoD PKI compatibility
 *
 * @example
 * ```typescript
 * import {
 *   pivAuthPlugin,
 *   registerPIVRoutes,
 *   requirePIVAuth,
 *   type PIVCACConfig,
 * } from '@vorionsys/platform-core/auth/piv-cac';
 *
 * // Configure PIV authentication
 * const config: Partial<PIVCACConfig> = {
 *   enabled: true,
 *   trustedCAs: [
 *     { name: 'DoD Root CA', certificate: '...', isRoot: true }
 *   ],
 *   revocationMethod: 'ocsp_with_crl_fallback',
 *   dodPkiCompatibility: true,
 * };
 *
 * // Register plugin
 * await fastify.register(pivAuthPlugin, { config });
 *
 * // Register routes
 * await registerPIVRoutes(fastify, { prefix: '/auth/piv' });
 *
 * // Protect routes
 * fastify.get('/protected', { preHandler: [requirePIVAuth()] }, handler);
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Enums
  CertificateValidationStatus,
  RevocationCheckMethod,
  PIVKeyUsage,
  CertificateMappingStrategy,
  CardEventType,
  PIVErrorCode,

  // Certificate types
  type X509Extension,
  type SubjectAltName,
  type DistinguishedName,
  type ParsedCertificate,
  type CertificateChain,

  // Validation types
  type OCSPResponse,
  type CRLEntry,
  type CRLData,
  type CertificateValidationResult,

  // Mapping types
  type MappedUserIdentity,
  type CertificateMappingRule,

  // Card event types
  type CardEvent,
  type CardSessionBinding,

  // Configuration types
  type TrustedCAConfig,
  type OCSPConfig,
  type CRLConfig,
  type PKCS11Config,
  type CardRemovalPolicy,
  type PIVCACConfig,

  // Auth types
  type PIVAuthRequest,
  type PIVAuthResult,
  type PIVAuthContext,
  type PIVMiddlewareOptions,

  // Schemas
  certificateValidationStatusSchema,
  revocationCheckMethodSchema,
  pivKeyUsageSchema,
  certificateMappingStrategySchema,
  cardEventTypeSchema,
  pivErrorCodeSchema,
  x509ExtensionSchema,
  subjectAltNameSchema,
  distinguishedNameSchema,
  parsedCertificateSchema,
  certificateChainSchema,
  ocspResponseSchema,
  crlEntrySchema,
  crlDataSchema,
  certificateValidationResultSchema,
  mappedUserIdentitySchema,
  certificateMappingRuleSchema,
  cardEventSchema,
  cardSessionBindingSchema,
  trustedCAConfigSchema,
  ocspConfigSchema,
  crlConfigSchema,
  pkcs11ConfigSchema,
  cardRemovalPolicySchema,
  pivCacConfigSchema,
  pivAuthRequestSchema,
  pivAuthResultSchema,
  pivAuthContextSchema,
  pivMiddlewareOptionsSchema,

  // Default configuration
  DEFAULT_PIVCAC_CONFIG,
  DOD_PKI_CONFIG,
} from './types.js';

// =============================================================================
// Certificate Authentication
// =============================================================================

export {
  // Service
  CertificateAuthService,
  getCertificateAuthService,
  createCertificateAuthService,
  resetCertificateAuthService,

  // Functions
  parseCertificate,
  parseCertificateChain,
  buildCertificateChain,

  // Errors
  CertificateAuthError,
  CertificateParseError,
  CertificateValidationError,
} from './certificate-auth.js';

// =============================================================================
// OCSP Validation
// =============================================================================

export {
  // Service
  OCSPValidator,
  getOCSPValidator,
  createOCSPValidator,
  resetOCSPValidator,

  // Errors
  OCSPError,
  OCSPResponderUnavailableError,
  OCSPResponseError,
} from './ocsp-validator.js';

// =============================================================================
// CRL Validation
// =============================================================================

export {
  // Service
  CRLValidator,
  getCRLValidator,
  createCRLValidator,
  resetCRLValidator,

  // Errors
  CRLError,
  CRLDownloadError,
  CRLParseError,
  CRLSizeExceededError,
} from './crl-validator.js';

// =============================================================================
// Certificate Mapping
// =============================================================================

export {
  // Service
  CertificateMapper,
  getCertificateMapper,
  createCertificateMapper,
  resetCertificateMapper,

  // Default rules
  DOD_CAC_RULE,
  PIV_RULE,
  EMAIL_FALLBACK_RULE,
  CN_FALLBACK_RULE,
  DEFAULT_MAPPING_RULES,

  // Errors
  CertificateMappingError,
  NoMatchingRuleError,
  AttributeNotFoundError,
} from './certificate-mapper.js';

// =============================================================================
// Card Removal Handler
// =============================================================================

export {
  // Service
  CardRemovalHandler,
  getCardRemovalHandler,
  createCardRemovalHandler,
  resetCardRemovalHandler,

  // Enum
  SessionState,

  // Types
  type CardRemovalEvent,
  type SessionTerminationEvent,
  type CardRemovalHandlerEvents,

  // Errors
  CardRemovalError,
  SessionNotFoundError,
  ReauthenticationRequiredError,
} from './card-removal-handler.js';

// =============================================================================
// PKCS#11 Provider
// =============================================================================

export {
  // Service
  PKCS11Provider,
  getPKCS11Provider,
  createPKCS11Provider,
  resetPKCS11Provider,

  // Constants
  PIV_SLOTS,
  PKCS11_LIBRARY_PATHS,

  // Functions
  detectPKCS11Library,

  // Types
  type ReaderInfo,
  type TokenInfo,
  type SmartCardCertificate,
  type SignRequest,
  type PKCS11ProviderEvents,

  // Errors
  PKCS11Error,
  LibraryNotFoundError,
  PINError,
  CardNotPresentError,
} from './pkcs11-provider.js';

// =============================================================================
// Middleware
// =============================================================================

export {
  // Plugin
  pivAuthPlugin,

  // Middleware factories
  pivAuthMiddleware,
  requirePIVAuth,
  requireCertificateAttribute,
  requireEDIPI,

  // Request helpers
  getPIVAuth,
  hasPIVAuth,
  getPIVUser,
  getPIVUserId,
  getCertificateFingerprint,
  getEDIPI,

  // Types
  type PIVAuthServices,
  type PIVPluginOptions,
} from './piv-middleware.js';

// =============================================================================
// Routes
// =============================================================================

export {
  // Route registration
  registerPIVRoutes,
  pivRoutesPlugin,
} from './piv-routes.js';

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Initialize PIV/CAC authentication services with configuration
 */
export function initializePIVAuth(config: Partial<import('./types.js').PIVCACConfig> = {}) {
  const { getCertificateAuthService } = require('./certificate-auth.js');
  const { getOCSPValidator } = require('./ocsp-validator.js');
  const { getCRLValidator } = require('./crl-validator.js');
  const { getCertificateMapper } = require('./certificate-mapper.js');
  const { getCardRemovalHandler } = require('./card-removal-handler.js');
  const { DEFAULT_PIVCAC_CONFIG } = require('./types.js');

  const mergedConfig = { ...DEFAULT_PIVCAC_CONFIG, ...config };

  return {
    certAuth: getCertificateAuthService(mergedConfig),
    ocspValidator: getOCSPValidator(mergedConfig.ocsp),
    crlValidator: getCRLValidator(mergedConfig.crl),
    certificateMapper: getCertificateMapper(mergedConfig.mappingRules),
    cardRemovalHandler: getCardRemovalHandler(mergedConfig.cardRemovalPolicy),
    config: mergedConfig,
  };
}

/**
 * Reset all PIV/CAC singletons (for testing)
 */
export function resetAllPIVServices(): void {
  const { resetCertificateAuthService } = require('./certificate-auth.js');
  const { resetOCSPValidator } = require('./ocsp-validator.js');
  const { resetCRLValidator } = require('./crl-validator.js');
  const { resetCertificateMapper } = require('./certificate-mapper.js');
  const { resetCardRemovalHandler } = require('./card-removal-handler.js');
  const { resetPKCS11Provider } = require('./pkcs11-provider.js');

  resetCertificateAuthService();
  resetOCSPValidator();
  resetCRLValidator();
  resetCertificateMapper();
  resetCardRemovalHandler();
  resetPKCS11Provider();
}
