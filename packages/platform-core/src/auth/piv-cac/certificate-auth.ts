/**
 * X.509 Certificate Authentication
 *
 * Provides X.509 certificate parsing, validation, and authentication
 * for PIV/CAC smart card authentication.
 *
 * Features:
 * - Certificate parsing and validation
 * - Chain building and verification
 * - Key usage and policy validation
 * - DoD PKI compatibility
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { createLogger } from '../../common/logger.js';
import {
  type ParsedCertificate,
  type CertificateChain,
  type CertificateValidationResult,
  type TrustedCAConfig,
  type PIVCACConfig,
  type DistinguishedName,
  type SubjectAltName,
  type X509Extension,
  CertificateValidationStatus,
  PIVKeyUsage,
  PIVErrorCode,
  DEFAULT_PIVCAC_CONFIG,
} from './types.js';

const logger = createLogger({ component: 'piv-certificate-auth' });

// =============================================================================
// Constants
// =============================================================================

/** OID for User Principal Name in SAN */
const OID_UPN = '1.3.6.1.4.1.311.20.2.3';

/** OID for Smart Card Logon EKU */
const OID_SMART_CARD_LOGON = '1.3.6.1.4.1.311.20.2.2';

/** OID for Client Authentication EKU */
const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

/** OID for PIV Authentication EKU */
const OID_PIV_AUTH = '2.16.840.1.101.3.6.8';

/** Key Usage bit positions */
const KEY_USAGE_BITS = {
  digitalSignature: 0,
  nonRepudiation: 1,
  keyEncipherment: 2,
  dataEncipherment: 3,
  keyAgreement: 4,
  keyCertSign: 5,
  cRLSign: 6,
  encipherOnly: 7,
  decipherOnly: 8,
} as const;

/** PIV Key Usage to required key usage bits */
const PIV_KEY_USAGE_REQUIREMENTS: Record<PIVKeyUsage, number[]> = {
  [PIVKeyUsage.PIV_AUTHENTICATION]: [KEY_USAGE_BITS.digitalSignature],
  [PIVKeyUsage.CARD_AUTHENTICATION]: [KEY_USAGE_BITS.digitalSignature],
  [PIVKeyUsage.DIGITAL_SIGNATURE]: [
    KEY_USAGE_BITS.digitalSignature,
    KEY_USAGE_BITS.nonRepudiation,
  ],
  [PIVKeyUsage.KEY_MANAGEMENT]: [KEY_USAGE_BITS.keyEncipherment],
};

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error class for certificate authentication errors
 */
export class CertificateAuthError extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CertificateAuthError';
  }
}

/**
 * Certificate parsing error
 */
export class CertificateParseError extends CertificateAuthError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, PIVErrorCode.CERTIFICATE_PARSE_ERROR, details);
    this.name = 'CertificateParseError';
  }
}

/**
 * Certificate validation error
 */
export class CertificateValidationError extends CertificateAuthError {
  constructor(
    message: string,
    code: PIVErrorCode,
    public readonly validationResult?: CertificateValidationResult,
    details?: Record<string, unknown>
  ) {
    super(message, code, details);
    this.name = 'CertificateValidationError';
  }
}

// =============================================================================
// Certificate Parser
// =============================================================================

/**
 * Parse a PEM-encoded X.509 certificate
 *
 * This implementation uses Node.js crypto module for basic parsing.
 * For production use, consider using a dedicated X.509 library like
 * @peculiar/x509 or node-forge for more complete ASN.1 parsing.
 */
export function parseCertificate(pem: string): ParsedCertificate {
  try {
    // Normalize PEM format
    const normalizedPem = normalizePem(pem);

    // Extract DER from PEM
    const der = pemToDer(normalizedPem);

    // Parse basic certificate structure
    // Note: This is a simplified parser. Production code should use
    // a proper ASN.1 parser like @peculiar/asn1-x509
    const parsed = parseX509Structure(der);

    return {
      version: parsed.version,
      serialNumber: parsed.serialNumber,
      signatureAlgorithm: parsed.signatureAlgorithm,
      issuer: parsed.issuer,
      subject: parsed.subject,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      publicKeyAlgorithm: parsed.publicKeyAlgorithm,
      publicKey: parsed.publicKey,
      subjectAltNames: parsed.subjectAltNames,
      keyUsage: parsed.keyUsage,
      extendedKeyUsage: parsed.extendedKeyUsage,
      extensions: parsed.extensions,
      authorityInfoAccess: parsed.authorityInfoAccess,
      crlDistributionPoints: parsed.crlDistributionPoints,
      fingerprint: calculateFingerprint(der),
      publicKeyFingerprint: calculatePublicKeyFingerprint(parsed.publicKey),
      pem: normalizedPem,
      der: der.toString('base64'),
    };
  } catch (error) {
    logger.error({ error }, 'Failed to parse certificate');
    throw new CertificateParseError(
      `Failed to parse certificate: ${error instanceof Error ? error.message : String(error)}`,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Parse multiple PEM certificates from a chain
 */
export function parseCertificateChain(pem: string): ParsedCertificate[] {
  const certs: ParsedCertificate[] = [];
  const pemRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const matches = pem.match(pemRegex);

  if (!matches || matches.length === 0) {
    throw new CertificateParseError('No certificates found in chain');
  }

  for (const certPem of matches) {
    certs.push(parseCertificate(certPem));
  }

  return certs;
}

/**
 * Build a certificate chain from end-entity and available certificates
 */
export function buildCertificateChain(
  endEntity: ParsedCertificate,
  availableCerts: ParsedCertificate[],
  trustedCAs: TrustedCAConfig[]
): CertificateChain {
  const intermediates: ParsedCertificate[] = [];
  let current = endEntity;
  let root: ParsedCertificate | undefined;
  const visited = new Set<string>();

  // Parse trusted CA certificates
  const trustedRoots = trustedCAs
    .filter((ca) => ca.isRoot)
    .map((ca) => parseCertificate(ca.certificate));

  // Build chain by finding issuers
  while (true) {
    const issuerDN = current.issuer.full;
    const currentSubjectDN = current.subject.full;

    // Prevent infinite loops
    if (visited.has(current.fingerprint)) {
      break;
    }
    visited.add(current.fingerprint);

    // Check if self-signed (root)
    if (issuerDN === currentSubjectDN) {
      // Check if it's a trusted root
      const isTrusted = trustedRoots.some(
        (tr) => tr.fingerprint === current.fingerprint || tr.subject.full === currentSubjectDN
      );
      if (isTrusted) {
        root = current;
      }
      break;
    }

    // Find issuer in available certs
    const issuer = availableCerts.find((c) => c.subject.full === issuerDN);
    if (issuer) {
      if (issuer !== endEntity) {
        intermediates.push(issuer);
      }
      current = issuer;
      continue;
    }

    // Check if issuer is a trusted root
    const trustedRoot = trustedRoots.find((tr) => tr.subject.full === issuerDN);
    if (trustedRoot) {
      root = trustedRoot;
      break;
    }

    // Chain incomplete
    break;
  }

  return { endEntity, intermediates, root };
}

// =============================================================================
// Certificate Validation
// =============================================================================

/**
 * Certificate authentication service
 */
export class CertificateAuthService {
  private config: PIVCACConfig;
  private trustedCAs: Map<string, ParsedCertificate> = new Map();

  constructor(config: Partial<PIVCACConfig> = {}) {
    this.config = { ...DEFAULT_PIVCAC_CONFIG, ...config };
    this.loadTrustedCAs();
  }

  /**
   * Load trusted CA certificates
   */
  private loadTrustedCAs(): void {
    for (const ca of this.config.trustedCAs) {
      try {
        const cert = parseCertificate(ca.certificate);
        this.trustedCAs.set(cert.fingerprint, cert);
        logger.info({ ca: ca.name, fingerprint: cert.fingerprint }, 'Loaded trusted CA');
      } catch (error) {
        logger.error({ ca: ca.name, error }, 'Failed to load trusted CA');
      }
    }
  }

  /**
   * Get all trusted CA certificates
   */
  getTrustedCAs(): ParsedCertificate[] {
    return Array.from(this.trustedCAs.values());
  }

  /**
   * Add a trusted CA certificate
   */
  addTrustedCA(config: TrustedCAConfig): void {
    const cert = parseCertificate(config.certificate);
    this.trustedCAs.set(cert.fingerprint, cert);
    this.config.trustedCAs.push(config);
    logger.info({ ca: config.name, fingerprint: cert.fingerprint }, 'Added trusted CA');
  }

  /**
   * Validate a certificate
   */
  async validateCertificate(
    certificate: ParsedCertificate,
    chain?: ParsedCertificate[]
  ): Promise<CertificateValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const now = new Date();

    // 1. Check validity period
    if (now < certificate.notBefore) {
      errors.push('Certificate is not yet valid');
      return this.createValidationResult(
        CertificateValidationStatus.NOT_YET_VALID,
        errors,
        warnings,
        certificate
      );
    }

    if (now > certificate.notAfter && !this.config.allowExpired) {
      errors.push('Certificate has expired');
      return this.createValidationResult(
        CertificateValidationStatus.EXPIRED,
        errors,
        warnings,
        certificate
      );
    }

    if (now > certificate.notAfter && this.config.allowExpired) {
      warnings.push('Certificate has expired but is allowed by configuration');
    }

    // 2. Validate key usage
    const keyUsageResult = this.validateKeyUsage(certificate);
    if (!keyUsageResult.valid) {
      errors.push(...keyUsageResult.errors);
    }
    warnings.push(...keyUsageResult.warnings);

    // 3. Validate extended key usage
    const ekuResult = this.validateExtendedKeyUsage(certificate);
    if (!ekuResult.valid) {
      errors.push(...ekuResult.errors);
    }
    warnings.push(...ekuResult.warnings);

    // 4. Validate certificate policies
    const policyResult = this.validateCertificatePolicies(certificate);
    if (!policyResult.valid) {
      errors.push(...policyResult.errors);
    }
    warnings.push(...policyResult.warnings);

    // 5. Build and validate chain
    const chainCerts = chain ?? [];
    const builtChain = buildCertificateChain(
      certificate,
      chainCerts,
      this.config.trustedCAs
    );

    const chainValidation = this.validateChain(builtChain);
    if (!chainValidation.valid) {
      errors.push(...chainValidation.errors);
    }
    warnings.push(...chainValidation.warnings);

    // Determine overall status
    let status = CertificateValidationStatus.VALID;
    if (errors.length > 0) {
      if (errors.some((e) => e.includes('expired'))) {
        status = CertificateValidationStatus.EXPIRED;
      } else if (errors.some((e) => e.includes('not yet valid'))) {
        status = CertificateValidationStatus.NOT_YET_VALID;
      } else if (errors.some((e) => e.includes('chain'))) {
        status = CertificateValidationStatus.CHAIN_INVALID;
      } else {
        status = CertificateValidationStatus.SIGNATURE_INVALID;
      }
    }

    return {
      status,
      isValid: errors.length === 0,
      errors,
      warnings,
      chainValidation: {
        valid: chainValidation.valid,
        depth: builtChain.intermediates.length + (builtChain.root ? 1 : 0),
        errors: chainValidation.errors,
      },
      validatedAt: now,
      expiresAt: certificate.notAfter,
      trustAnchor: builtChain.root?.subject.full,
    };
  }

  /**
   * Validate key usage extension
   */
  private validateKeyUsage(certificate: ParsedCertificate): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!certificate.keyUsage || certificate.keyUsage.length === 0) {
      if (this.config.requiredKeyUsage.length > 0) {
        errors.push('Certificate missing required key usage extension');
      } else {
        warnings.push('Certificate has no key usage extension');
      }
      return { valid: errors.length === 0, errors, warnings };
    }

    // Check required key usages for PIV authentication
    for (const required of this.config.requiredKeyUsage) {
      const requiredBits = PIV_KEY_USAGE_REQUIREMENTS[required];
      const hasRequired = requiredBits.some((bit) =>
        certificate.keyUsage!.includes(Object.keys(KEY_USAGE_BITS)[bit]!)
      );

      if (!hasRequired) {
        errors.push(
          `Certificate missing required key usage for ${required}: needs one of [${requiredBits.map(
            (b) => Object.keys(KEY_USAGE_BITS)[b]
          )}]`
        );
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate extended key usage extension
   */
  private validateExtendedKeyUsage(certificate: ParsedCertificate): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.requiredExtendedKeyUsage || this.config.requiredExtendedKeyUsage.length === 0) {
      return { valid: true, errors, warnings };
    }

    if (!certificate.extendedKeyUsage || certificate.extendedKeyUsage.length === 0) {
      errors.push('Certificate missing required extended key usage extension');
      return { valid: false, errors, warnings };
    }

    // Check that at least one required EKU is present
    const hasRequired = this.config.requiredExtendedKeyUsage.some((oid) =>
      certificate.extendedKeyUsage!.includes(oid)
    );

    if (!hasRequired) {
      errors.push(
        `Certificate missing required extended key usage. Required one of: ${this.config.requiredExtendedKeyUsage.join(', ')}`
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate certificate policies extension
   */
  private validateCertificatePolicies(certificate: ParsedCertificate): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.requiredPolicies || this.config.requiredPolicies.length === 0) {
      return { valid: true, errors, warnings };
    }

    // Find certificate policies extension
    const policiesExt = certificate.extensions.find(
      (ext) => ext.oid === '2.5.29.32' // id-ce-certificatePolicies
    );

    if (!policiesExt) {
      if (this.config.dodPkiCompatibility) {
        errors.push('Certificate missing required certificate policies extension');
        return { valid: false, errors, warnings };
      }
      warnings.push('Certificate has no certificate policies extension');
      return { valid: true, errors, warnings };
    }

    // Parse and check policies
    // Note: Full policy parsing requires ASN.1 parsing of the extension value
    // For now, we check if the extension exists and warn about policy validation

    warnings.push('Certificate policies validation requires additional parsing');

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate certificate chain
   */
  private validateChain(chain: CertificateChain): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check chain depth
    const chainDepth = chain.intermediates.length + (chain.root ? 1 : 0);
    if (chainDepth > this.config.maxChainDepth) {
      errors.push(
        `Certificate chain too long: ${chainDepth} > ${this.config.maxChainDepth}`
      );
    }

    // Check for root
    if (!chain.root) {
      errors.push('Certificate chain does not lead to a trusted root');
    }

    // Verify each link in the chain
    const allCerts = [chain.endEntity, ...chain.intermediates];
    if (chain.root) {
      allCerts.push(chain.root);
    }

    for (let i = 0; i < allCerts.length - 1; i++) {
      const cert = allCerts[i]!;
      const issuer = allCerts[i + 1];

      if (!issuer) {
        errors.push(`Missing issuer for certificate: ${cert.subject.CN || cert.subject.full}`);
        continue;
      }

      // Check that issuer DN matches
      if (cert.issuer.full !== issuer.subject.full) {
        errors.push(
          `Chain broken: ${cert.subject.CN} issuer (${cert.issuer.full}) does not match next cert subject (${issuer.subject.full})`
        );
      }

      // Verify signature (would require crypto operations)
      // Note: Full signature verification requires the issuer's public key
      // and the certificate's TBS (To Be Signed) data
    }

    // Check intermediate CA constraints
    for (const intermediate of chain.intermediates) {
      // Check basicConstraints CA flag
      const basicConstraints = intermediate.extensions.find(
        (ext) => ext.oid === '2.5.29.19' // id-ce-basicConstraints
      );

      if (!basicConstraints) {
        warnings.push(
          `Intermediate ${intermediate.subject.CN} missing basicConstraints extension`
        );
      }
      // Full validation would parse the extension to verify CA=true
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Create a validation result object
   */
  private createValidationResult(
    status: CertificateValidationStatus,
    errors: string[],
    warnings: string[],
    certificate: ParsedCertificate,
    chainValidation?: { valid: boolean; depth: number; errors: string[] }
  ): CertificateValidationResult {
    return {
      status,
      isValid: status === CertificateValidationStatus.VALID,
      errors,
      warnings,
      chainValidation,
      validatedAt: new Date(),
      expiresAt: certificate.notAfter,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PIVCACConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.trustedCAs) {
      this.trustedCAs.clear();
      this.loadTrustedCAs();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PIVCACConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize PEM format
 */
function normalizePem(pem: string): string {
  // Remove whitespace and ensure proper line endings
  let normalized = pem.trim();

  // If it's URL-encoded, decode it
  if (normalized.includes('%')) {
    normalized = decodeURIComponent(normalized);
  }

  // If it's base64 without headers, add them
  if (!normalized.includes('-----BEGIN')) {
    normalized = `-----BEGIN CERTIFICATE-----\n${normalized}\n-----END CERTIFICATE-----`;
  }

  // Ensure proper line breaks
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return normalized;
}

/**
 * Convert PEM to DER
 */
function pemToDer(pem: string): Buffer {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');

  return Buffer.from(base64, 'base64');
}

/**
 * Calculate SHA-256 fingerprint
 */
function calculateFingerprint(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex');
}

/**
 * Calculate public key fingerprint
 */
function calculatePublicKeyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex');
}

/**
 * Parse X.509 certificate structure
 * This is a simplified implementation - production code should use
 * a proper ASN.1 library for complete parsing
 */
function parseX509Structure(der: Buffer): {
  version: number;
  serialNumber: string;
  signatureAlgorithm: string;
  issuer: DistinguishedName;
  subject: DistinguishedName;
  notBefore: Date;
  notAfter: Date;
  publicKeyAlgorithm: string;
  publicKey: string;
  subjectAltNames: SubjectAltName[];
  keyUsage?: string[];
  extendedKeyUsage?: string[];
  extensions: X509Extension[];
  authorityInfoAccess?: {
    ocsp?: string[];
    caIssuers?: string[];
  };
  crlDistributionPoints?: string[];
} {
  // This is a placeholder implementation
  // A full implementation would parse the ASN.1 DER structure
  // For production, use @peculiar/x509 or node-forge

  // For now, use Node.js crypto to get basic info
  const crypto = require('crypto');

  try {
    const cert = new crypto.X509Certificate(der);

    return {
      version: 3, // X.509v3
      serialNumber: cert.serialNumber,
      signatureAlgorithm: cert.signatureAlgorithm || 'unknown',
      issuer: parseDN(cert.issuer),
      subject: parseDN(cert.subject),
      notBefore: new Date(cert.validFrom),
      notAfter: new Date(cert.validTo),
      publicKeyAlgorithm: cert.publicKey?.asymmetricKeyType || 'unknown',
      publicKey: cert.publicKey?.export({ type: 'spki', format: 'pem' }) || '',
      subjectAltNames: parseSubjectAltNames(cert.subjectAltName),
      keyUsage: parseKeyUsage(cert.keyUsage),
      extendedKeyUsage: parseExtendedKeyUsage(cert.extKeyUsage),
      extensions: [], // Would need ASN.1 parsing for full extensions
      authorityInfoAccess: parseAuthorityInfoAccess(cert.infoAccess),
      crlDistributionPoints: [], // Would need ASN.1 parsing
    };
  } catch (error) {
    logger.error({ error }, 'Failed to parse X.509 structure');
    throw new CertificateParseError('Failed to parse X.509 structure');
  }
}

/**
 * Parse Distinguished Name string
 */
function parseDN(dnString: string): DistinguishedName {
  const dn: DistinguishedName = { full: dnString };

  if (!dnString) return dn;

  // Parse common DN attributes
  const matches = dnString.matchAll(/([A-Z]+)=([^,]+)/gi);
  for (const match of matches) {
    const [, key, value] = match;
    switch (key?.toUpperCase()) {
      case 'CN':
        dn.CN = value;
        break;
      case 'O':
        dn.O = value;
        break;
      case 'OU':
        dn.OU = value;
        break;
      case 'C':
        dn.C = value;
        break;
      case 'ST':
        dn.ST = value;
        break;
      case 'L':
        dn.L = value;
        break;
      case 'E':
      case 'EMAILADDRESS':
        dn.E = value;
        break;
      case 'SERIALNUMBER':
        dn.serialNumber = value;
        break;
    }
  }

  return dn;
}

/**
 * Parse Subject Alternative Names
 */
function parseSubjectAltNames(sanString: string | undefined): SubjectAltName[] {
  const sans: SubjectAltName[] = [];

  if (!sanString) return sans;

  // Parse SAN entries (format varies by certificate)
  const entries = sanString.split(',').map((e) => e.trim());

  for (const entry of entries) {
    const [type, ...valueParts] = entry.split(':');
    const value = valueParts.join(':').trim();

    switch (type?.toLowerCase()) {
      case 'email':
        sans.push({ type: 'email', value });
        break;
      case 'dns':
        sans.push({ type: 'dns', value });
        break;
      case 'uri':
        sans.push({ type: 'uri', value });
        break;
      case 'ip':
      case 'ip address':
        sans.push({ type: 'ip', value });
        break;
      default:
        // Check for UPN (OtherName with UPN OID)
        if (entry.includes(OID_UPN)) {
          sans.push({ type: 'upn', value, oid: OID_UPN });
        } else {
          sans.push({ type: 'other', value, oid: type });
        }
    }
  }

  return sans;
}

/**
 * Parse Key Usage extension
 */
function parseKeyUsage(keyUsageString: string | undefined): string[] | undefined {
  if (!keyUsageString) return undefined;

  const usages: string[] = [];
  const parts = keyUsageString.split(',').map((p) => p.trim().toLowerCase());

  for (const part of parts) {
    if (part.includes('digital') && part.includes('signature')) {
      usages.push('digitalSignature');
    }
    if (part.includes('non') && part.includes('repudiation')) {
      usages.push('nonRepudiation');
    }
    if (part.includes('key') && part.includes('encipherment')) {
      usages.push('keyEncipherment');
    }
    if (part.includes('data') && part.includes('encipherment')) {
      usages.push('dataEncipherment');
    }
    if (part.includes('key') && part.includes('agreement')) {
      usages.push('keyAgreement');
    }
    if (part.includes('key') && part.includes('cert') && part.includes('sign')) {
      usages.push('keyCertSign');
    }
    if (part.includes('crl') && part.includes('sign')) {
      usages.push('cRLSign');
    }
  }

  return usages.length > 0 ? usages : undefined;
}

/**
 * Parse Extended Key Usage extension
 */
function parseExtendedKeyUsage(ekuString: string | undefined): string[] | undefined {
  if (!ekuString) return undefined;

  const ekus: string[] = [];
  const parts = ekuString.split(',').map((p) => p.trim());

  for (const part of parts) {
    // Extract OID if present
    const oidMatch = part.match(/(\d+(?:\.\d+)+)/);
    if (oidMatch) {
      ekus.push(oidMatch[1]!);
    }
  }

  return ekus.length > 0 ? ekus : undefined;
}

/**
 * Parse Authority Information Access extension
 */
function parseAuthorityInfoAccess(aiaString: string | undefined): {
  ocsp?: string[];
  caIssuers?: string[];
} | undefined {
  if (!aiaString) return undefined;

  const aia: { ocsp?: string[]; caIssuers?: string[] } = {};
  const parts = aiaString.split('\n');

  for (const part of parts) {
    if (part.toLowerCase().includes('ocsp')) {
      const urlMatch = part.match(/URI:(https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        aia.ocsp = aia.ocsp || [];
        aia.ocsp.push(urlMatch[1]!);
      }
    }
    if (part.toLowerCase().includes('ca issuers')) {
      const urlMatch = part.match(/URI:(https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        aia.caIssuers = aia.caIssuers || [];
        aia.caIssuers.push(urlMatch[1]!);
      }
    }
  }

  return aia.ocsp || aia.caIssuers ? aia : undefined;
}

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultService: CertificateAuthService | null = null;

/**
 * Get the default certificate authentication service
 */
export function getCertificateAuthService(
  config?: Partial<PIVCACConfig>
): CertificateAuthService {
  if (!defaultService || config) {
    defaultService = new CertificateAuthService(config);
  }
  return defaultService;
}

/**
 * Create a new certificate authentication service
 */
export function createCertificateAuthService(
  config: Partial<PIVCACConfig> = {}
): CertificateAuthService {
  return new CertificateAuthService(config);
}

/**
 * Reset the default service (for testing)
 */
export function resetCertificateAuthService(): void {
  defaultService = null;
}
