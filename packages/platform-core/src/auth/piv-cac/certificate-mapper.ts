/**
 * Certificate-to-User Mapping
 *
 * Maps X.509 certificate attributes to user identities using
 * various strategies (UPN, SAN, Subject DN, etc.).
 *
 * Features:
 * - Multiple mapping strategies
 * - Rule-based mapping with priority
 * - DoD EDIPI extraction
 * - Custom attribute mapping
 * - Tenant assignment
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  type ParsedCertificate,
  type MappedUserIdentity,
  type CertificateMappingRule,
  CertificateMappingStrategy,
  PIVErrorCode,
} from './types.js';

const logger = createLogger({ component: 'piv-certificate-mapper' });

// =============================================================================
// Constants
// =============================================================================

/** OID for User Principal Name (UPN) in SAN */
const OID_UPN = '1.3.6.1.4.1.311.20.2.3';

/** DoD EDIPI pattern in Subject DN serialNumber */
const EDIPI_PATTERN = /^\d{10}$/;

/** Email pattern */
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Certificate mapping error
 */
export class CertificateMappingError extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode = PIVErrorCode.USER_MAPPING_FAILED,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CertificateMappingError';
  }
}

/**
 * No matching rule error
 */
export class NoMatchingRuleError extends CertificateMappingError {
  constructor(certificate: ParsedCertificate) {
    super(
      'No mapping rule matched the certificate',
      PIVErrorCode.USER_MAPPING_FAILED,
      {
        subject: certificate.subject.full,
        issuer: certificate.issuer.full,
      }
    );
    this.name = 'NoMatchingRuleError';
  }
}

/**
 * Attribute not found error
 */
export class AttributeNotFoundError extends CertificateMappingError {
  constructor(attribute: string, strategy: CertificateMappingStrategy) {
    super(
      `Required attribute "${attribute}" not found in certificate for strategy "${strategy}"`,
      PIVErrorCode.USER_MAPPING_FAILED,
      { attribute, strategy }
    );
    this.name = 'AttributeNotFoundError';
  }
}

// =============================================================================
// Certificate Mapper Service
// =============================================================================

/**
 * Certificate to user identity mapper
 */
export class CertificateMapper {
  private rules: CertificateMappingRule[] = [];
  private customMappers: Map<string, (cert: ParsedCertificate) => MappedUserIdentity | undefined> =
    new Map();

  constructor(rules: CertificateMappingRule[] = []) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Map a certificate to a user identity
   */
  mapCertificate(certificate: ParsedCertificate): MappedUserIdentity {
    logger.debug(
      {
        subject: certificate.subject.CN,
        issuer: certificate.issuer.CN,
        serialNumber: certificate.serialNumber,
      },
      'Mapping certificate to user identity'
    );

    // Try each rule in priority order
    for (const rule of this.rules) {
      if (this.ruleMatches(certificate, rule)) {
        try {
          const identity = this.applyRule(certificate, rule);
          logger.info(
            {
              userId: identity.userId,
              rule: rule.name,
              strategy: rule.strategy,
            },
            'Certificate mapped successfully'
          );
          return identity;
        } catch (error) {
          logger.debug(
            { rule: rule.name, error },
            'Rule matched but mapping failed, trying next rule'
          );
          continue;
        }
      }
    }

    // No rule matched - try default strategies
    const defaultIdentity = this.tryDefaultStrategies(certificate);
    if (defaultIdentity) {
      return defaultIdentity;
    }

    throw new NoMatchingRuleError(certificate);
  }

  /**
   * Check if a rule matches the certificate
   */
  private ruleMatches(certificate: ParsedCertificate, rule: CertificateMappingRule): boolean {
    // Check issuer pattern
    if (rule.issuerPattern) {
      const regex = new RegExp(rule.issuerPattern, 'i');
      if (!regex.test(certificate.issuer.full)) {
        return false;
      }
    }

    // Check subject pattern
    if (rule.subjectPattern) {
      const regex = new RegExp(rule.subjectPattern, 'i');
      if (!regex.test(certificate.subject.full)) {
        return false;
      }
    }

    // Check required policy OID
    if (rule.requiredPolicyOid) {
      const hasPolicy = certificate.extensions.some(
        (ext) => ext.oid === '2.5.29.32' && ext.value.includes(rule.requiredPolicyOid!)
      );
      if (!hasPolicy) {
        return false;
      }
    }

    return true;
  }

  /**
   * Apply a mapping rule to extract user identity
   */
  private applyRule(certificate: ParsedCertificate, rule: CertificateMappingRule): MappedUserIdentity {
    let identity: MappedUserIdentity;

    switch (rule.strategy) {
      case CertificateMappingStrategy.UPN:
        identity = this.mapByUPN(certificate);
        break;

      case CertificateMappingStrategy.SAN:
        identity = this.mapBySAN(certificate);
        break;

      case CertificateMappingStrategy.EMAIL:
        identity = this.mapByEmail(certificate);
        break;

      case CertificateMappingStrategy.SUBJECT_DN:
        identity = this.mapBySubjectDN(certificate, rule.userIdAttribute);
        break;

      case CertificateMappingStrategy.SERIAL_ISSUER:
        identity = this.mapBySerialIssuer(certificate);
        break;

      case CertificateMappingStrategy.CUSTOM:
        const customMapper = this.customMappers.get(rule.name);
        if (!customMapper) {
          throw new CertificateMappingError(
            `Custom mapper "${rule.name}" not registered`
          );
        }
        const customIdentity = customMapper(certificate);
        if (!customIdentity) {
          throw new CertificateMappingError(
            `Custom mapper "${rule.name}" returned no identity`
          );
        }
        identity = customIdentity;
        break;

      default:
        throw new CertificateMappingError(
          `Unknown mapping strategy: ${rule.strategy}`
        );
    }

    // Apply tenant ID from rule
    if (rule.tenantId) {
      identity.tenantId = rule.tenantId;
    }

    // Apply custom attribute mappings
    if (rule.attributeMappings) {
      for (const [targetAttr, sourceAttr] of Object.entries(rule.attributeMappings)) {
        const value = this.extractAttribute(certificate, sourceAttr);
        if (value) {
          identity.attributes[targetAttr] = value;
        }
      }
    }

    identity.mappingStrategy = rule.strategy;

    return identity;
  }

  /**
   * Try default mapping strategies
   */
  private tryDefaultStrategies(certificate: ParsedCertificate): MappedUserIdentity | undefined {
    // Try UPN first
    try {
      return this.mapByUPN(certificate);
    } catch {
      // Continue to next strategy
    }

    // Try email
    try {
      return this.mapByEmail(certificate);
    } catch {
      // Continue to next strategy
    }

    // Try SAN
    try {
      return this.mapBySAN(certificate);
    } catch {
      // Continue to next strategy
    }

    // Try Subject DN with CN
    try {
      return this.mapBySubjectDN(certificate, 'CN');
    } catch {
      // Continue to next strategy
    }

    return undefined;
  }

  /**
   * Map by User Principal Name (UPN) in SAN
   */
  private mapByUPN(certificate: ParsedCertificate): MappedUserIdentity {
    // Find UPN in SAN
    const upnEntry = certificate.subjectAltNames.find(
      (san) => san.type === 'upn' || san.oid === OID_UPN
    );

    if (!upnEntry) {
      throw new AttributeNotFoundError('UPN', CertificateMappingStrategy.UPN);
    }

    const upn = upnEntry.value;

    // Extract username and domain from UPN (format: user@domain)
    const [username, domain] = upn.split('@');

    return {
      userId: upn,
      username,
      email: upn, // UPN is often the same as email
      upn,
      edipi: this.extractEDIPI(certificate),
      tenantId: domain,
      attributes: {
        domain: domain || '',
        cn: certificate.subject.CN || '',
      },
      mappingStrategy: CertificateMappingStrategy.UPN,
      certificateFingerprint: certificate.fingerprint,
    };
  }

  /**
   * Map by Subject Alternative Name (SAN)
   */
  private mapBySAN(certificate: ParsedCertificate): MappedUserIdentity {
    if (certificate.subjectAltNames.length === 0) {
      throw new AttributeNotFoundError('SAN', CertificateMappingStrategy.SAN);
    }

    // Priority: email > upn > dns > uri
    let userId: string | undefined;
    let email: string | undefined;
    let upn: string | undefined;

    for (const san of certificate.subjectAltNames) {
      switch (san.type) {
        case 'email':
          email = san.value;
          if (!userId) userId = san.value;
          break;
        case 'upn':
          upn = san.value;
          if (!userId) userId = san.value;
          break;
        case 'dns':
          if (!userId) userId = san.value;
          break;
        case 'uri':
          if (!userId) userId = san.value;
          break;
      }
    }

    if (!userId) {
      userId = certificate.subjectAltNames[0]?.value;
    }

    if (!userId) {
      throw new AttributeNotFoundError('SAN value', CertificateMappingStrategy.SAN);
    }

    return {
      userId,
      username: email?.split('@')[0] || upn?.split('@')[0],
      email,
      upn,
      edipi: this.extractEDIPI(certificate),
      attributes: {
        cn: certificate.subject.CN || '',
        sanCount: String(certificate.subjectAltNames.length),
      },
      mappingStrategy: CertificateMappingStrategy.SAN,
      certificateFingerprint: certificate.fingerprint,
    };
  }

  /**
   * Map by email address
   */
  private mapByEmail(certificate: ParsedCertificate): MappedUserIdentity {
    // Try SAN email first
    const emailSan = certificate.subjectAltNames.find((san) => san.type === 'email');
    let email = emailSan?.value;

    // Try Subject E attribute
    if (!email) {
      email = certificate.subject.E;
    }

    // Try to extract from CN
    if (!email && certificate.subject.CN) {
      const cnMatch = certificate.subject.CN.match(EMAIL_PATTERN);
      if (cnMatch) {
        email = cnMatch[0];
      }
    }

    if (!email) {
      throw new AttributeNotFoundError('email', CertificateMappingStrategy.EMAIL);
    }

    const [username, domain] = email.split('@');

    return {
      userId: email,
      username,
      email,
      edipi: this.extractEDIPI(certificate),
      tenantId: domain,
      attributes: {
        domain: domain || '',
        cn: certificate.subject.CN || '',
      },
      mappingStrategy: CertificateMappingStrategy.EMAIL,
      certificateFingerprint: certificate.fingerprint,
    };
  }

  /**
   * Map by Subject Distinguished Name attribute
   */
  private mapBySubjectDN(
    certificate: ParsedCertificate,
    attribute?: string
  ): MappedUserIdentity {
    const attr = attribute || 'CN';

    const value =
      attr === 'CN'
        ? certificate.subject.CN
        : attr === 'serialNumber'
          ? certificate.subject.serialNumber
          : attr === 'E'
            ? certificate.subject.E
            : attr === 'OU'
              ? certificate.subject.OU
              : attr === 'O'
                ? certificate.subject.O
                : undefined;

    if (!value) {
      throw new AttributeNotFoundError(attr, CertificateMappingStrategy.SUBJECT_DN);
    }

    // Try to extract email from CN if it looks like an email
    let email: string | undefined;
    if (attr === 'CN' && EMAIL_PATTERN.test(value)) {
      email = value;
    }

    return {
      userId: value,
      username: value,
      email,
      edipi: this.extractEDIPI(certificate),
      attributes: {
        subjectDN: certificate.subject.full,
        mappedAttribute: attr,
        organization: certificate.subject.O || '',
        organizationalUnit: certificate.subject.OU || '',
      },
      mappingStrategy: CertificateMappingStrategy.SUBJECT_DN,
      certificateFingerprint: certificate.fingerprint,
    };
  }

  /**
   * Map by certificate serial number and issuer
   */
  private mapBySerialIssuer(certificate: ParsedCertificate): MappedUserIdentity {
    const userId = `${certificate.serialNumber}@${certificate.issuer.CN || certificate.issuer.O || 'unknown'}`;

    return {
      userId,
      attributes: {
        serialNumber: certificate.serialNumber,
        issuerDN: certificate.issuer.full,
        subjectDN: certificate.subject.full,
      },
      mappingStrategy: CertificateMappingStrategy.SERIAL_ISSUER,
      certificateFingerprint: certificate.fingerprint,
    };
  }

  /**
   * Extract EDIPI (DoD Electronic Data Interchange Personal Identifier) from certificate
   */
  private extractEDIPI(certificate: ParsedCertificate): string | undefined {
    // EDIPI is typically in the Subject DN serialNumber attribute
    const serialNumber = certificate.subject.serialNumber;

    if (serialNumber && EDIPI_PATTERN.test(serialNumber)) {
      return serialNumber;
    }

    // Also check CN for EDIPI
    const cn = certificate.subject.CN;
    if (cn) {
      const match = cn.match(/\b(\d{10})\b/);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Extract a generic attribute from certificate
   */
  private extractAttribute(certificate: ParsedCertificate, attribute: string): string | undefined {
    // Check subject DN attributes
    switch (attribute.toUpperCase()) {
      case 'CN':
        return certificate.subject.CN;
      case 'O':
        return certificate.subject.O;
      case 'OU':
        return certificate.subject.OU;
      case 'C':
        return certificate.subject.C;
      case 'ST':
        return certificate.subject.ST;
      case 'L':
        return certificate.subject.L;
      case 'E':
      case 'EMAIL':
        return certificate.subject.E;
      case 'SERIALNUMBER':
        return certificate.subject.serialNumber;
      case 'ISSUER_CN':
        return certificate.issuer.CN;
      case 'ISSUER_O':
        return certificate.issuer.O;
      case 'SERIAL':
        return certificate.serialNumber;
      case 'FINGERPRINT':
        return certificate.fingerprint;
    }

    // Check SAN attributes
    if (attribute.startsWith('SAN_')) {
      const sanType = attribute.substring(4).toLowerCase();
      const san = certificate.subjectAltNames.find((s) => s.type === sanType);
      return san?.value;
    }

    return undefined;
  }

  /**
   * Add a mapping rule
   */
  addRule(rule: CertificateMappingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
    logger.info({ rule: rule.name, priority: rule.priority }, 'Added mapping rule');
  }

  /**
   * Remove a mapping rule
   */
  removeRule(name: string): boolean {
    const index = this.rules.findIndex((r) => r.name === name);
    if (index >= 0) {
      this.rules.splice(index, 1);
      logger.info({ rule: name }, 'Removed mapping rule');
      return true;
    }
    return false;
  }

  /**
   * Get all rules
   */
  getRules(): CertificateMappingRule[] {
    return [...this.rules];
  }

  /**
   * Register a custom mapper function
   */
  registerCustomMapper(
    name: string,
    mapper: (cert: ParsedCertificate) => MappedUserIdentity | undefined
  ): void {
    this.customMappers.set(name, mapper);
    logger.info({ name }, 'Registered custom mapper');
  }

  /**
   * Unregister a custom mapper
   */
  unregisterCustomMapper(name: string): boolean {
    const result = this.customMappers.delete(name);
    if (result) {
      logger.info({ name }, 'Unregistered custom mapper');
    }
    return result;
  }
}

// =============================================================================
// Default Rules
// =============================================================================

/**
 * Default DoD CAC mapping rule
 */
export const DOD_CAC_RULE: CertificateMappingRule = {
  name: 'dod-cac',
  priority: 10,
  issuerPattern: 'DOD|Department of Defense',
  strategy: CertificateMappingStrategy.UPN,
};

/**
 * Default PIV mapping rule
 */
export const PIV_RULE: CertificateMappingRule = {
  name: 'piv-upn',
  priority: 20,
  requiredPolicyOid: '2.16.840.1.101.3.2.1', // id-fpki-common-authentication
  strategy: CertificateMappingStrategy.UPN,
};

/**
 * Fallback email mapping rule
 */
export const EMAIL_FALLBACK_RULE: CertificateMappingRule = {
  name: 'email-fallback',
  priority: 100,
  strategy: CertificateMappingStrategy.EMAIL,
};

/**
 * Fallback CN mapping rule
 */
export const CN_FALLBACK_RULE: CertificateMappingRule = {
  name: 'cn-fallback',
  priority: 200,
  strategy: CertificateMappingStrategy.SUBJECT_DN,
  userIdAttribute: 'CN',
};

/**
 * Default mapping rules
 */
export const DEFAULT_MAPPING_RULES: CertificateMappingRule[] = [
  DOD_CAC_RULE,
  PIV_RULE,
  EMAIL_FALLBACK_RULE,
  CN_FALLBACK_RULE,
];

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultMapper: CertificateMapper | null = null;

/**
 * Get the default certificate mapper
 */
export function getCertificateMapper(rules?: CertificateMappingRule[]): CertificateMapper {
  if (!defaultMapper || rules) {
    defaultMapper = new CertificateMapper(rules ?? DEFAULT_MAPPING_RULES);
  }
  return defaultMapper;
}

/**
 * Create a new certificate mapper
 */
export function createCertificateMapper(
  rules: CertificateMappingRule[] = DEFAULT_MAPPING_RULES
): CertificateMapper {
  return new CertificateMapper(rules);
}

/**
 * Reset the default mapper (for testing)
 */
export function resetCertificateMapper(): void {
  defaultMapper = null;
}
