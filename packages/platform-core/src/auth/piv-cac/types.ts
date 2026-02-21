/**
 * PIV/CAC Smart Card Authentication Types
 *
 * Type definitions for Personal Identity Verification (PIV) and
 * Common Access Card (CAC) smart card authentication.
 *
 * Supports:
 * - X.509 certificate authentication
 * - OCSP/CRL certificate validation
 * - Certificate-to-user mapping (UPN/SAN)
 * - Card removal session termination
 * - DoD PKI compatibility
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// Enums
// =============================================================================

/**
 * Certificate validation status
 */
export enum CertificateValidationStatus {
  /** Certificate is valid */
  VALID = 'valid',
  /** Certificate has been revoked */
  REVOKED = 'revoked',
  /** Certificate has expired */
  EXPIRED = 'expired',
  /** Certificate is not yet valid */
  NOT_YET_VALID = 'not_yet_valid',
  /** Certificate chain is incomplete or invalid */
  CHAIN_INVALID = 'chain_invalid',
  /** Certificate signature verification failed */
  SIGNATURE_INVALID = 'signature_invalid',
  /** Unable to verify certificate status */
  UNKNOWN = 'unknown',
}

export const certificateValidationStatusSchema = z.nativeEnum(CertificateValidationStatus);

/**
 * Certificate revocation check method
 */
export enum RevocationCheckMethod {
  /** Online Certificate Status Protocol */
  OCSP = 'ocsp',
  /** Certificate Revocation List */
  CRL = 'crl',
  /** Both OCSP and CRL */
  BOTH = 'both',
  /** OCSP with CRL fallback */
  OCSP_WITH_CRL_FALLBACK = 'ocsp_with_crl_fallback',
  /** No revocation checking (not recommended) */
  NONE = 'none',
}

export const revocationCheckMethodSchema = z.nativeEnum(RevocationCheckMethod);

/**
 * PIV key usage types
 */
export enum PIVKeyUsage {
  /** PIV Authentication key */
  PIV_AUTHENTICATION = 'piv_authentication',
  /** Card Authentication key */
  CARD_AUTHENTICATION = 'card_authentication',
  /** Digital Signature key */
  DIGITAL_SIGNATURE = 'digital_signature',
  /** Key Management key */
  KEY_MANAGEMENT = 'key_management',
}

export const pivKeyUsageSchema = z.nativeEnum(PIVKeyUsage);

/**
 * Certificate mapping strategy
 */
export enum CertificateMappingStrategy {
  /** Map using Subject Alternative Name (SAN) */
  SAN = 'san',
  /** Map using User Principal Name (UPN) from SAN */
  UPN = 'upn',
  /** Map using email address from SAN or Subject */
  EMAIL = 'email',
  /** Map using Subject Distinguished Name */
  SUBJECT_DN = 'subject_dn',
  /** Map using certificate serial number + issuer */
  SERIAL_ISSUER = 'serial_issuer',
  /** Custom mapping function */
  CUSTOM = 'custom',
}

export const certificateMappingStrategySchema = z.nativeEnum(CertificateMappingStrategy);

/**
 * Card event types
 */
export enum CardEventType {
  /** Card inserted into reader */
  CARD_INSERTED = 'card_inserted',
  /** Card removed from reader */
  CARD_REMOVED = 'card_removed',
  /** Card reader connected */
  READER_CONNECTED = 'reader_connected',
  /** Card reader disconnected */
  READER_DISCONNECTED = 'reader_disconnected',
  /** PIN entry required */
  PIN_REQUIRED = 'pin_required',
  /** PIN verified successfully */
  PIN_VERIFIED = 'pin_verified',
  /** PIN verification failed */
  PIN_FAILED = 'pin_failed',
  /** Card locked due to failed PIN attempts */
  CARD_LOCKED = 'card_locked',
}

export const cardEventTypeSchema = z.nativeEnum(CardEventType);

// =============================================================================
// Certificate Types
// =============================================================================

/**
 * X.509 certificate extension
 */
export interface X509Extension {
  /** OID of the extension */
  oid: string;
  /** Whether the extension is critical */
  critical: boolean;
  /** Extension value (base64 encoded) */
  value: string;
  /** Parsed extension data if available */
  parsed?: Record<string, unknown>;
}

export const x509ExtensionSchema = z.object({
  oid: z.string(),
  critical: z.boolean(),
  value: z.string(),
  parsed: z.record(z.unknown()).optional(),
});

/**
 * Subject Alternative Name entry
 */
export interface SubjectAltName {
  /** Type of SAN entry */
  type: 'email' | 'dns' | 'uri' | 'ip' | 'upn' | 'other';
  /** Value of the SAN entry */
  value: string;
  /** OID for 'other' type */
  oid?: string;
}

export const subjectAltNameSchema = z.object({
  type: z.enum(['email', 'dns', 'uri', 'ip', 'upn', 'other']),
  value: z.string(),
  oid: z.string().optional(),
});

/**
 * Distinguished Name components
 */
export interface DistinguishedName {
  /** Common Name */
  CN?: string;
  /** Organization */
  O?: string;
  /** Organizational Unit */
  OU?: string;
  /** Country */
  C?: string;
  /** State or Province */
  ST?: string;
  /** Locality */
  L?: string;
  /** Email Address */
  E?: string;
  /** Serial Number */
  serialNumber?: string;
  /** Full DN string */
  full: string;
}

export const distinguishedNameSchema = z.object({
  CN: z.string().optional(),
  O: z.string().optional(),
  OU: z.string().optional(),
  C: z.string().optional(),
  ST: z.string().optional(),
  L: z.string().optional(),
  E: z.string().optional(),
  serialNumber: z.string().optional(),
  full: z.string(),
});

/**
 * Parsed X.509 certificate
 */
export interface ParsedCertificate {
  /** Certificate version (usually 3 for X.509v3) */
  version: number;
  /** Serial number (hex string) */
  serialNumber: string;
  /** Signature algorithm OID */
  signatureAlgorithm: string;
  /** Issuer distinguished name */
  issuer: DistinguishedName;
  /** Subject distinguished name */
  subject: DistinguishedName;
  /** Not valid before date */
  notBefore: Date;
  /** Not valid after date */
  notAfter: Date;
  /** Public key algorithm */
  publicKeyAlgorithm: string;
  /** Public key (PEM encoded) */
  publicKey: string;
  /** Subject Alternative Names */
  subjectAltNames: SubjectAltName[];
  /** Key Usage extension */
  keyUsage?: string[];
  /** Extended Key Usage extension */
  extendedKeyUsage?: string[];
  /** Certificate extensions */
  extensions: X509Extension[];
  /** Authority Information Access URLs */
  authorityInfoAccess?: {
    ocsp?: string[];
    caIssuers?: string[];
  };
  /** CRL Distribution Points */
  crlDistributionPoints?: string[];
  /** SHA-256 fingerprint of the certificate */
  fingerprint: string;
  /** SHA-256 fingerprint of the public key */
  publicKeyFingerprint: string;
  /** Original certificate in PEM format */
  pem: string;
  /** Original certificate in DER format (base64) */
  der: string;
}

export const parsedCertificateSchema = z.object({
  version: z.number(),
  serialNumber: z.string(),
  signatureAlgorithm: z.string(),
  issuer: distinguishedNameSchema,
  subject: distinguishedNameSchema,
  notBefore: z.coerce.date(),
  notAfter: z.coerce.date(),
  publicKeyAlgorithm: z.string(),
  publicKey: z.string(),
  subjectAltNames: z.array(subjectAltNameSchema),
  keyUsage: z.array(z.string()).optional(),
  extendedKeyUsage: z.array(z.string()).optional(),
  extensions: z.array(x509ExtensionSchema),
  authorityInfoAccess: z
    .object({
      ocsp: z.array(z.string()).optional(),
      caIssuers: z.array(z.string()).optional(),
    })
    .optional(),
  crlDistributionPoints: z.array(z.string()).optional(),
  fingerprint: z.string(),
  publicKeyFingerprint: z.string(),
  pem: z.string(),
  der: z.string(),
});

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Certificate chain
 */
export interface CertificateChain {
  /** End-entity certificate */
  endEntity: ParsedCertificate;
  /** Intermediate certificates */
  intermediates: ParsedCertificate[];
  /** Root certificate (if included) */
  root?: ParsedCertificate;
}

export const certificateChainSchema = z.object({
  endEntity: parsedCertificateSchema,
  intermediates: z.array(parsedCertificateSchema),
  root: parsedCertificateSchema.optional(),
});

/**
 * OCSP response data
 */
export interface OCSPResponse {
  /** Response status */
  status: 'good' | 'revoked' | 'unknown';
  /** Revocation time if revoked */
  revocationTime?: Date;
  /** Revocation reason if revoked */
  revocationReason?: string;
  /** Response production time */
  producedAt: Date;
  /** This update time */
  thisUpdate: Date;
  /** Next update time */
  nextUpdate?: Date;
  /** Responder ID */
  responderId: string;
  /** Whether response was cached */
  fromCache: boolean;
  /** OCSP responder URL used */
  responderUrl: string;
}

export const ocspResponseSchema = z.object({
  status: z.enum(['good', 'revoked', 'unknown']),
  revocationTime: z.coerce.date().optional(),
  revocationReason: z.string().optional(),
  producedAt: z.coerce.date(),
  thisUpdate: z.coerce.date(),
  nextUpdate: z.coerce.date().optional(),
  responderId: z.string(),
  fromCache: z.boolean(),
  responderUrl: z.string(),
});

/**
 * CRL entry for a revoked certificate
 */
export interface CRLEntry {
  /** Serial number of revoked certificate */
  serialNumber: string;
  /** Revocation date */
  revocationDate: Date;
  /** Revocation reason code */
  reasonCode?: number;
  /** Reason description */
  reason?: string;
}

export const crlEntrySchema = z.object({
  serialNumber: z.string(),
  revocationDate: z.coerce.date(),
  reasonCode: z.number().optional(),
  reason: z.string().optional(),
});

/**
 * CRL data
 */
export interface CRLData {
  /** CRL issuer */
  issuer: DistinguishedName;
  /** This update time */
  thisUpdate: Date;
  /** Next update time */
  nextUpdate?: Date;
  /** Revoked certificates */
  revokedCertificates: CRLEntry[];
  /** CRL number */
  crlNumber?: string;
  /** Whether CRL is delta */
  isDelta: boolean;
  /** CRL distribution point URL */
  distributionPoint: string;
  /** Whether CRL was cached */
  fromCache: boolean;
}

export const crlDataSchema = z.object({
  issuer: distinguishedNameSchema,
  thisUpdate: z.coerce.date(),
  nextUpdate: z.coerce.date().optional(),
  revokedCertificates: z.array(crlEntrySchema),
  crlNumber: z.string().optional(),
  isDelta: z.boolean(),
  distributionPoint: z.string(),
  fromCache: z.boolean(),
});

/**
 * Certificate validation result
 */
export interface CertificateValidationResult {
  /** Overall validation status */
  status: CertificateValidationStatus;
  /** Whether certificate is valid for authentication */
  isValid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Chain validation details */
  chainValidation?: {
    valid: boolean;
    depth: number;
    errors: string[];
  };
  /** OCSP validation result */
  ocspResult?: OCSPResponse;
  /** CRL validation result */
  crlResult?: CRLData;
  /** Timestamp of validation */
  validatedAt: Date;
  /** Certificate expiration date */
  expiresAt: Date;
  /** Trust anchor used */
  trustAnchor?: string;
}

export const certificateValidationResultSchema = z.object({
  status: certificateValidationStatusSchema,
  isValid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  chainValidation: z
    .object({
      valid: z.boolean(),
      depth: z.number(),
      errors: z.array(z.string()),
    })
    .optional(),
  ocspResult: ocspResponseSchema.optional(),
  crlResult: crlDataSchema.optional(),
  validatedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  trustAnchor: z.string().optional(),
});

// =============================================================================
// Mapping Types
// =============================================================================

/**
 * Mapped user identity from certificate
 */
export interface MappedUserIdentity {
  /** User ID in the system */
  userId: string;
  /** Username or login */
  username?: string;
  /** Email address */
  email?: string;
  /** User Principal Name */
  upn?: string;
  /** EDIPI (DoD ID number) */
  edipi?: string;
  /** Tenant ID for multi-tenant systems */
  tenantId?: string;
  /** Additional attributes */
  attributes: Record<string, string>;
  /** Mapping strategy used */
  mappingStrategy: CertificateMappingStrategy;
  /** Certificate fingerprint */
  certificateFingerprint: string;
}

export const mappedUserIdentitySchema = z.object({
  userId: z.string(),
  username: z.string().optional(),
  email: z.string().optional(),
  upn: z.string().optional(),
  edipi: z.string().optional(),
  tenantId: z.string().optional(),
  attributes: z.record(z.string()),
  mappingStrategy: certificateMappingStrategySchema,
  certificateFingerprint: z.string(),
});

/**
 * Certificate mapping rule
 */
export interface CertificateMappingRule {
  /** Rule name */
  name: string;
  /** Rule priority (lower = higher priority) */
  priority: number;
  /** Issuer DN pattern (regex) */
  issuerPattern?: string;
  /** Subject DN pattern (regex) */
  subjectPattern?: string;
  /** Required OID in certificate policies */
  requiredPolicyOid?: string;
  /** Mapping strategy to use */
  strategy: CertificateMappingStrategy;
  /** Attribute to extract user ID from */
  userIdAttribute?: string;
  /** Tenant ID to assign */
  tenantId?: string;
  /** Custom attribute mappings */
  attributeMappings?: Record<string, string>;
}

export const certificateMappingRuleSchema = z.object({
  name: z.string(),
  priority: z.number(),
  issuerPattern: z.string().optional(),
  subjectPattern: z.string().optional(),
  requiredPolicyOid: z.string().optional(),
  strategy: certificateMappingStrategySchema,
  userIdAttribute: z.string().optional(),
  tenantId: z.string().optional(),
  attributeMappings: z.record(z.string()).optional(),
});

// =============================================================================
// Card Event Types
// =============================================================================

/**
 * Card event data
 */
export interface CardEvent {
  /** Event type */
  type: CardEventType;
  /** Reader name */
  readerName: string;
  /** Timestamp */
  timestamp: Date;
  /** Card ATR (Answer To Reset) if available */
  atr?: string;
  /** Session ID associated with card */
  sessionId?: string;
  /** User ID associated with card */
  userId?: string;
}

export const cardEventSchema = z.object({
  type: cardEventTypeSchema,
  readerName: z.string(),
  timestamp: z.coerce.date(),
  atr: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
});

/**
 * Card session binding
 */
export interface CardSessionBinding {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** Certificate fingerprint */
  certificateFingerprint: string;
  /** Reader name */
  readerName: string;
  /** Card ATR */
  atr: string;
  /** Session creation time */
  createdAt: Date;
  /** Last activity time */
  lastActivity: Date;
  /** Session expiration time */
  expiresAt: Date;
}

export const cardSessionBindingSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  certificateFingerprint: z.string(),
  readerName: z.string(),
  atr: z.string(),
  createdAt: z.coerce.date(),
  lastActivity: z.coerce.date(),
  expiresAt: z.coerce.date(),
});

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Trusted CA configuration
 */
export interface TrustedCAConfig {
  /** CA name/identifier */
  name: string;
  /** CA certificate in PEM format */
  certificate: string;
  /** Whether this is a root CA */
  isRoot: boolean;
  /** Policy OIDs this CA is trusted for */
  trustedPolicies?: string[];
  /** Maximum chain depth */
  maxPathLength?: number;
}

export const trustedCAConfigSchema = z.object({
  name: z.string(),
  certificate: z.string(),
  isRoot: z.boolean(),
  trustedPolicies: z.array(z.string()).optional(),
  maxPathLength: z.number().optional(),
});

/**
 * OCSP configuration
 */
export interface OCSPConfig {
  /** Enable OCSP checking */
  enabled: boolean;
  /** OCSP responder URL override (uses AIA if not set) */
  responderUrl?: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Cache TTL in milliseconds */
  cacheTtl: number;
  /** Sign OCSP requests */
  signRequests: boolean;
  /** Signing certificate for OCSP requests */
  signingCertificate?: string;
  /** Signing key for OCSP requests */
  signingKey?: string;
  /** Allow OCSP soft failures (treat network errors as success) */
  softFail: boolean;
  /** Nonce in requests */
  useNonce: boolean;
}

export const ocspConfigSchema = z.object({
  enabled: z.boolean().default(true),
  responderUrl: z.string().url().optional(),
  timeout: z.number().default(5000),
  cacheTtl: z.number().default(3600000), // 1 hour
  signRequests: z.boolean().default(false),
  signingCertificate: z.string().optional(),
  signingKey: z.string().optional(),
  softFail: z.boolean().default(false),
  useNonce: z.boolean().default(true),
});

/**
 * CRL configuration
 */
export interface CRLConfig {
  /** Enable CRL checking */
  enabled: boolean;
  /** CRL distribution point URL override */
  distributionPointUrl?: string;
  /** Download timeout in milliseconds */
  timeout: number;
  /** Cache TTL in milliseconds (uses nextUpdate if not set) */
  cacheTtl?: number;
  /** Refresh CRL before expiration (milliseconds) */
  refreshBefore: number;
  /** Maximum CRL size in bytes */
  maxSize: number;
  /** Allow CRL soft failures */
  softFail: boolean;
  /** Check delta CRLs */
  checkDelta: boolean;
}

export const crlConfigSchema = z.object({
  enabled: z.boolean().default(true),
  distributionPointUrl: z.string().url().optional(),
  timeout: z.number().default(30000),
  cacheTtl: z.number().optional(),
  refreshBefore: z.number().default(300000), // 5 minutes
  maxSize: z.number().default(10 * 1024 * 1024), // 10MB
  softFail: z.boolean().default(false),
  checkDelta: z.boolean().default(true),
});

/**
 * PKCS#11 configuration
 */
export interface PKCS11Config {
  /** Path to PKCS#11 library */
  libraryPath: string;
  /** Slot ID (uses first available if not set) */
  slotId?: number;
  /** Token label */
  tokenLabel?: string;
  /** PIN for token access */
  pin?: string;
  /** Initialize token on startup */
  initializeToken: boolean;
  /** Reader polling interval in milliseconds */
  pollingInterval: number;
}

export const pkcs11ConfigSchema = z.object({
  libraryPath: z.string(),
  slotId: z.number().optional(),
  tokenLabel: z.string().optional(),
  pin: z.string().optional(),
  initializeToken: z.boolean().default(false),
  pollingInterval: z.number().default(1000),
});

/**
 * Card removal policy
 */
export interface CardRemovalPolicy {
  /** Terminate session on card removal */
  terminateSession: boolean;
  /** Grace period before termination (milliseconds) */
  gracePeriod: number;
  /** Allow session continuation with re-authentication */
  allowReauthentication: boolean;
  /** Re-authentication timeout (milliseconds) */
  reauthenticationTimeout: number;
  /** Notification webhook URL */
  notificationWebhook?: string;
}

export const cardRemovalPolicySchema = z.object({
  terminateSession: z.boolean().default(true),
  gracePeriod: z.number().default(0),
  allowReauthentication: z.boolean().default(false),
  reauthenticationTimeout: z.number().default(60000),
  notificationWebhook: z.string().url().optional(),
});

/**
 * PIV/CAC authentication configuration
 */
export interface PIVCACConfig {
  /** Enable PIV/CAC authentication */
  enabled: boolean;
  /** Trusted CA certificates */
  trustedCAs: TrustedCAConfig[];
  /** Revocation check method */
  revocationMethod: RevocationCheckMethod;
  /** OCSP configuration */
  ocsp: OCSPConfig;
  /** CRL configuration */
  crl: CRLConfig;
  /** PKCS#11 configuration */
  pkcs11?: PKCS11Config;
  /** Card removal policy */
  cardRemovalPolicy: CardRemovalPolicy;
  /** Certificate mapping rules */
  mappingRules: CertificateMappingRule[];
  /** Required key usage for authentication */
  requiredKeyUsage: PIVKeyUsage[];
  /** Required extended key usage OIDs */
  requiredExtendedKeyUsage?: string[];
  /** Required certificate policies OIDs */
  requiredPolicies?: string[];
  /** Allow expired certificates (not recommended) */
  allowExpired: boolean;
  /** Maximum certificate chain depth */
  maxChainDepth: number;
  /** Session TTL in milliseconds */
  sessionTtl: number;
  /** Enable DoD PKI compatibility mode */
  dodPkiCompatibility: boolean;
  /** Enable FIPS 201 compliance mode */
  fips201Compliance: boolean;
  /** Cache certificate validation results */
  cacheValidation: boolean;
  /** Validation cache TTL in milliseconds */
  validationCacheTtl: number;
}

export const pivCacConfigSchema = z.object({
  enabled: z.boolean().default(false),
  trustedCAs: z.array(trustedCAConfigSchema).default([]),
  revocationMethod: revocationCheckMethodSchema.default(RevocationCheckMethod.OCSP_WITH_CRL_FALLBACK),
  ocsp: ocspConfigSchema.default({
    enabled: true,
    timeout: 5000,
    cacheTtl: 3600000,
    signRequests: false,
    softFail: false,
    useNonce: true,
  }),
  crl: crlConfigSchema.default({
    enabled: true,
    timeout: 30000,
    refreshBefore: 300000,
    maxSize: 10 * 1024 * 1024,
    softFail: false,
    checkDelta: true,
  }),
  pkcs11: pkcs11ConfigSchema.optional(),
  cardRemovalPolicy: cardRemovalPolicySchema.default({
    terminateSession: true,
    gracePeriod: 0,
    allowReauthentication: false,
    reauthenticationTimeout: 60000,
  }),
  mappingRules: z.array(certificateMappingRuleSchema).default([]),
  requiredKeyUsage: z.array(pivKeyUsageSchema).default([PIVKeyUsage.PIV_AUTHENTICATION]),
  requiredExtendedKeyUsage: z.array(z.string()).optional(),
  requiredPolicies: z.array(z.string()).optional(),
  allowExpired: z.boolean().default(false),
  maxChainDepth: z.number().default(5),
  sessionTtl: z.number().default(28800000), // 8 hours
  dodPkiCompatibility: z.boolean().default(false),
  fips201Compliance: z.boolean().default(false),
  cacheValidation: z.boolean().default(true),
  validationCacheTtl: z.number().default(300000), // 5 minutes
});

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * PIV authentication request
 */
export interface PIVAuthRequest {
  /** Client certificate in PEM format */
  clientCertificate: string;
  /** Certificate chain in PEM format */
  certificateChain?: string;
  /** PIN (if required) */
  pin?: string;
  /** Challenge nonce */
  challenge?: string;
  /** Signed challenge */
  signedChallenge?: string;
}

export const pivAuthRequestSchema = z.object({
  clientCertificate: z.string(),
  certificateChain: z.string().optional(),
  pin: z.string().optional(),
  challenge: z.string().optional(),
  signedChallenge: z.string().optional(),
});

/**
 * PIV authentication result
 */
export interface PIVAuthResult {
  /** Authentication success */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
  /** Mapped user identity */
  user?: MappedUserIdentity;
  /** Session ID */
  sessionId?: string;
  /** Session expiration */
  expiresAt?: Date;
  /** Certificate validation result */
  validation?: CertificateValidationResult;
  /** JWT access token */
  accessToken?: string;
  /** Refresh token */
  refreshToken?: string;
}

export const pivAuthResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  user: mappedUserIdentitySchema.optional(),
  sessionId: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
  validation: certificateValidationResultSchema.optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});

// =============================================================================
// Middleware Types
// =============================================================================

/**
 * PIV authentication context added to requests
 */
export interface PIVAuthContext {
  /** Whether PIV authentication is present */
  isPIVAuthenticated: boolean;
  /** Mapped user identity */
  user?: MappedUserIdentity;
  /** Parsed client certificate */
  certificate?: ParsedCertificate;
  /** Certificate validation result */
  validation?: CertificateValidationResult;
  /** Session binding */
  sessionBinding?: CardSessionBinding;
}

export const pivAuthContextSchema = z.object({
  isPIVAuthenticated: z.boolean(),
  user: mappedUserIdentitySchema.optional(),
  certificate: parsedCertificateSchema.optional(),
  validation: certificateValidationResultSchema.optional(),
  sessionBinding: cardSessionBindingSchema.optional(),
});

/**
 * PIV middleware options
 */
export interface PIVMiddlewareOptions {
  /** Skip authentication for these paths */
  skipPaths?: string[];
  /** Require PIV for these paths (all others optional) */
  requiredPaths?: string[];
  /** Extract certificate from header name (default: x-client-certificate) */
  certificateHeader?: string;
  /** Extract certificate from header (alternative) */
  certificateChainHeader?: string;
  /** Custom trust anchor resolver */
  trustAnchorResolver?: (cert: ParsedCertificate) => Promise<TrustedCAConfig | undefined>;
  /** Custom user lookup after mapping */
  userLookup?: (identity: MappedUserIdentity) => Promise<Record<string, unknown> | undefined>;
  /** Failure handler */
  onFailure?: (error: Error, request: unknown, reply: unknown) => Promise<void>;
  /** Success handler */
  onSuccess?: (context: PIVAuthContext, request: unknown) => Promise<void>;
}

export const pivMiddlewareOptionsSchema = z.object({
  skipPaths: z.array(z.string()).optional(),
  requiredPaths: z.array(z.string()).optional(),
  certificateHeader: z.string().default('x-client-certificate'),
  certificateChainHeader: z.string().default('x-client-certificate-chain'),
  // Function options cannot be validated with zod
});

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default PIV/CAC configuration
 */
export const DEFAULT_PIVCAC_CONFIG: PIVCACConfig = {
  enabled: false,
  trustedCAs: [],
  revocationMethod: RevocationCheckMethod.OCSP_WITH_CRL_FALLBACK,
  ocsp: {
    enabled: true,
    timeout: 5000,
    cacheTtl: 3600000,
    signRequests: false,
    softFail: false,
    useNonce: true,
  },
  crl: {
    enabled: true,
    timeout: 30000,
    refreshBefore: 300000,
    maxSize: 10 * 1024 * 1024,
    softFail: false,
    checkDelta: true,
  },
  cardRemovalPolicy: {
    terminateSession: true,
    gracePeriod: 0,
    allowReauthentication: false,
    reauthenticationTimeout: 60000,
  },
  mappingRules: [],
  requiredKeyUsage: [PIVKeyUsage.PIV_AUTHENTICATION],
  allowExpired: false,
  maxChainDepth: 5,
  sessionTtl: 28800000,
  dodPkiCompatibility: false,
  fips201Compliance: false,
  cacheValidation: true,
  validationCacheTtl: 300000,
};

/**
 * DoD PKI compatible configuration preset
 */
export const DOD_PKI_CONFIG: Partial<PIVCACConfig> = {
  dodPkiCompatibility: true,
  fips201Compliance: true,
  revocationMethod: RevocationCheckMethod.OCSP_WITH_CRL_FALLBACK,
  requiredKeyUsage: [PIVKeyUsage.PIV_AUTHENTICATION],
  requiredExtendedKeyUsage: [
    '1.3.6.1.5.5.7.3.2', // id-kp-clientAuth
    '1.3.6.1.4.1.311.20.2.2', // Microsoft Smart Card Logon
  ],
  requiredPolicies: [
    '2.16.840.1.101.2.1.11.19', // DoD ID SW
    '2.16.840.1.101.2.1.11.20', // DoD ID HW
  ],
  maxChainDepth: 6,
  ocsp: {
    enabled: true,
    timeout: 10000,
    cacheTtl: 3600000,
    signRequests: false,
    softFail: false,
    useNonce: true,
  },
  crl: {
    enabled: true,
    timeout: 60000,
    refreshBefore: 600000,
    maxSize: 50 * 1024 * 1024,
    softFail: false,
    checkDelta: true,
  },
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * PIV authentication error codes
 */
export enum PIVErrorCode {
  /** Certificate not provided */
  CERTIFICATE_MISSING = 'CERTIFICATE_MISSING',
  /** Certificate parsing failed */
  CERTIFICATE_PARSE_ERROR = 'CERTIFICATE_PARSE_ERROR',
  /** Certificate expired */
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',
  /** Certificate not yet valid */
  CERTIFICATE_NOT_YET_VALID = 'CERTIFICATE_NOT_YET_VALID',
  /** Certificate revoked */
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  /** Certificate chain invalid */
  CERTIFICATE_CHAIN_INVALID = 'CERTIFICATE_CHAIN_INVALID',
  /** Certificate signature invalid */
  CERTIFICATE_SIGNATURE_INVALID = 'CERTIFICATE_SIGNATURE_INVALID',
  /** Certificate key usage invalid */
  CERTIFICATE_KEY_USAGE_INVALID = 'CERTIFICATE_KEY_USAGE_INVALID',
  /** Certificate policy invalid */
  CERTIFICATE_POLICY_INVALID = 'CERTIFICATE_POLICY_INVALID',
  /** OCSP check failed */
  OCSP_CHECK_FAILED = 'OCSP_CHECK_FAILED',
  /** CRL check failed */
  CRL_CHECK_FAILED = 'CRL_CHECK_FAILED',
  /** User mapping failed */
  USER_MAPPING_FAILED = 'USER_MAPPING_FAILED',
  /** User not found */
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  /** Card removed */
  CARD_REMOVED = 'CARD_REMOVED',
  /** Card locked */
  CARD_LOCKED = 'CARD_LOCKED',
  /** PIN required */
  PIN_REQUIRED = 'PIN_REQUIRED',
  /** PIN invalid */
  PIN_INVALID = 'PIN_INVALID',
  /** PKCS#11 error */
  PKCS11_ERROR = 'PKCS11_ERROR',
  /** Session expired */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  /** Configuration error */
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  /** Internal error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const pivErrorCodeSchema = z.nativeEnum(PIVErrorCode);
