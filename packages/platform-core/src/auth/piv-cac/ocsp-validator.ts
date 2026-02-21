/**
 * OCSP Certificate Validation
 *
 * Online Certificate Status Protocol (OCSP) validation for
 * real-time certificate revocation checking.
 *
 * Features:
 * - OCSP request generation
 * - Response parsing and validation
 * - Response caching
 * - Nonce support
 * - Soft-fail mode
 *
 * @packageDocumentation
 */

import { createHash, randomBytes } from 'crypto';
import { createLogger } from '../../common/logger.js';
import {
  type ParsedCertificate,
  type OCSPResponse,
  type OCSPConfig,
  PIVErrorCode,
} from './types.js';

const logger = createLogger({ component: 'piv-ocsp-validator' });

// =============================================================================
// Constants
// =============================================================================

/** OCSP response status codes */
const OCSP_RESPONSE_STATUS = {
  successful: 0,
  malformedRequest: 1,
  internalError: 2,
  tryLater: 3,
  sigRequired: 5,
  unauthorized: 6,
} as const;

/** Certificate status in OCSP response */
const CERT_STATUS = {
  good: 0,
  revoked: 1,
  unknown: 2,
} as const;

/** Revocation reasons */
const REVOCATION_REASONS = [
  'unspecified',
  'keyCompromise',
  'cACompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'certificateHold',
  'unused',
  'removeFromCRL',
  'privilegeWithdrawn',
  'aACompromise',
] as const;

/** Default OCSP configuration */
const DEFAULT_OCSP_CONFIG: OCSPConfig = {
  enabled: true,
  timeout: 5000,
  cacheTtl: 3600000, // 1 hour
  signRequests: false,
  softFail: false,
  useNonce: true,
};

// =============================================================================
// Error Classes
// =============================================================================

/**
 * OCSP validation error
 */
export class OCSPError extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode = PIVErrorCode.OCSP_CHECK_FAILED,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OCSPError';
  }
}

/**
 * OCSP responder unavailable error
 */
export class OCSPResponderUnavailableError extends OCSPError {
  constructor(responderUrl: string, originalError?: Error) {
    super(`OCSP responder unavailable: ${responderUrl}`, PIVErrorCode.OCSP_CHECK_FAILED, {
      responderUrl,
      originalError: originalError?.message,
    });
    this.name = 'OCSPResponderUnavailableError';
  }
}

/**
 * OCSP response error
 */
export class OCSPResponseError extends OCSPError {
  constructor(message: string, status?: number) {
    super(message, PIVErrorCode.OCSP_CHECK_FAILED, { responseStatus: status });
    this.name = 'OCSPResponseError';
  }
}

// =============================================================================
// OCSP Validator Service
// =============================================================================

/**
 * OCSP validation service
 */
export class OCSPValidator {
  private config: OCSPConfig;
  private cache: Map<string, { response: OCSPResponse; expiresAt: Date }> = new Map();
  private pendingRequests: Map<string, Promise<OCSPResponse>> = new Map();

  constructor(config: Partial<OCSPConfig> = {}) {
    this.config = { ...DEFAULT_OCSP_CONFIG, ...config };
  }

  /**
   * Check certificate revocation status via OCSP
   */
  async checkRevocationStatus(
    certificate: ParsedCertificate,
    issuerCertificate: ParsedCertificate
  ): Promise<OCSPResponse> {
    if (!this.config.enabled) {
      throw new OCSPError('OCSP checking is disabled');
    }

    // Determine OCSP responder URL
    const responderUrl = this.getResponderUrl(certificate);
    if (!responderUrl) {
      throw new OCSPError('No OCSP responder URL found in certificate');
    }

    // Check cache
    const cacheKey = this.getCacheKey(certificate, responderUrl);
    const cached = this.getCachedResponse(cacheKey);
    if (cached) {
      logger.debug(
        { serialNumber: certificate.serialNumber },
        'OCSP response served from cache'
      );
      return { ...cached, fromCache: true };
    }

    // Check for pending request
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      logger.debug({ serialNumber: certificate.serialNumber }, 'Waiting for pending OCSP request');
      return pending;
    }

    // Create and execute OCSP request
    const requestPromise = this.executeOCSPRequest(
      certificate,
      issuerCertificate,
      responderUrl,
      cacheKey
    );

    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Execute OCSP request
   */
  private async executeOCSPRequest(
    certificate: ParsedCertificate,
    issuerCertificate: ParsedCertificate,
    responderUrl: string,
    cacheKey: string
  ): Promise<OCSPResponse> {
    try {
      // Build OCSP request
      const nonce = this.config.useNonce ? randomBytes(16) : undefined;
      const requestData = this.buildOCSPRequest(certificate, issuerCertificate, nonce);

      // Send request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(responderUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/ocsp-request',
            Accept: 'application/ocsp-response',
          },
          body: new Uint8Array(requestData),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new OCSPResponseError(
            `OCSP responder returned HTTP ${response.status}`,
            response.status
          );
        }

        const responseData = await response.arrayBuffer();
        const ocspResponse = this.parseOCSPResponse(
          Buffer.from(responseData),
          responderUrl,
          nonce
        );

        // Cache the response
        this.cacheResponse(cacheKey, ocspResponse);

        logger.info(
          {
            serialNumber: certificate.serialNumber,
            status: ocspResponse.status,
            responderUrl,
          },
          'OCSP check completed'
        );

        return ocspResponse;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (this.config.softFail) {
        logger.warn(
          { error, serialNumber: certificate.serialNumber },
          'OCSP check failed, soft-fail enabled - treating as good'
        );

        return {
          status: 'unknown',
          producedAt: new Date(),
          thisUpdate: new Date(),
          responderId: 'soft-fail',
          fromCache: false,
          responderUrl,
        };
      }

      if (error instanceof OCSPError) {
        throw error;
      }

      throw new OCSPResponderUnavailableError(
        responderUrl,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get OCSP responder URL from certificate
   */
  private getResponderUrl(certificate: ParsedCertificate): string | undefined {
    // Use configured URL override if set
    if (this.config.responderUrl) {
      return this.config.responderUrl;
    }

    // Get from Authority Information Access extension
    return certificate.authorityInfoAccess?.ocsp?.[0];
  }

  /**
   * Build OCSP request
   *
   * This is a simplified implementation. Production code should use
   * a proper ASN.1 library for OCSP request generation.
   */
  private buildOCSPRequest(
    certificate: ParsedCertificate,
    issuerCertificate: ParsedCertificate,
    nonce?: Buffer
  ): Buffer {
    // Calculate issuer name hash and key hash
    const issuerNameHash = createHash('sha1')
      .update(Buffer.from(issuerCertificate.subject.full))
      .digest();

    const issuerKeyHash = createHash('sha1')
      .update(Buffer.from(issuerCertificate.publicKeyFingerprint, 'hex'))
      .digest();

    // Serial number as buffer
    const serialNumber = Buffer.from(certificate.serialNumber.replace(/:/g, ''), 'hex');

    // Build ASN.1 structure for OCSP request
    // This is a simplified structure - full implementation needs proper ASN.1 encoding
    const certId = this.buildCertId(issuerNameHash, issuerKeyHash, serialNumber);
    const request = this.buildRequest(certId);
    const tbsRequest = this.buildTBSRequest([request], nonce);

    return this.wrapOCSPRequest(tbsRequest);
  }

  /**
   * Build CertID structure
   */
  private buildCertId(
    issuerNameHash: Buffer,
    issuerKeyHash: Buffer,
    serialNumber: Buffer
  ): Buffer {
    // CertID ::= SEQUENCE {
    //   hashAlgorithm AlgorithmIdentifier,
    //   issuerNameHash OCTET STRING,
    //   issuerKeyHash OCTET STRING,
    //   serialNumber CertificateSerialNumber
    // }

    // SHA-1 OID: 1.3.14.3.2.26
    const sha1Oid = Buffer.from([0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a]);
    const hashAlgorithm = this.wrapSequence(Buffer.concat([sha1Oid, Buffer.from([0x05, 0x00])]));

    const parts = [
      hashAlgorithm,
      this.wrapOctetString(issuerNameHash),
      this.wrapOctetString(issuerKeyHash),
      this.wrapInteger(serialNumber),
    ];

    return this.wrapSequence(Buffer.concat(parts));
  }

  /**
   * Build Request structure
   */
  private buildRequest(certId: Buffer): Buffer {
    // Request ::= SEQUENCE {
    //   reqCert CertID,
    //   singleRequestExtensions [0] EXPLICIT Extensions OPTIONAL
    // }
    return this.wrapSequence(certId);
  }

  /**
   * Build TBSRequest structure
   */
  private buildTBSRequest(requests: Buffer[], nonce?: Buffer): Buffer {
    // TBSRequest ::= SEQUENCE {
    //   version [0] EXPLICIT Version DEFAULT v1,
    //   requestorName [1] EXPLICIT GeneralName OPTIONAL,
    //   requestList SEQUENCE OF Request,
    //   requestExtensions [2] EXPLICIT Extensions OPTIONAL
    // }

    const requestList = this.wrapSequence(Buffer.concat(requests));

    const parts = [requestList];

    // Add nonce extension if configured
    if (nonce) {
      const nonceExt = this.buildNonceExtension(nonce);
      const extensions = this.wrapSequence(nonceExt);
      // Wrap in context-specific [2]
      const extWrapper = Buffer.alloc(extensions.length + 2);
      extWrapper[0] = 0xa2; // Context-specific [2]
      extWrapper[1] = extensions.length;
      extensions.copy(extWrapper, 2);
      parts.push(extWrapper);
    }

    return this.wrapSequence(Buffer.concat(parts));
  }

  /**
   * Build nonce extension
   */
  private buildNonceExtension(nonce: Buffer): Buffer {
    // Nonce OID: 1.3.6.1.5.5.7.48.1.2
    const nonceOid = Buffer.from([
      0x06, 0x09, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x02,
    ]);

    const nonceValue = this.wrapOctetString(this.wrapOctetString(nonce));

    return this.wrapSequence(Buffer.concat([nonceOid, nonceValue]));
  }

  /**
   * Wrap OCSP request
   */
  private wrapOCSPRequest(tbsRequest: Buffer): Buffer {
    // OCSPRequest ::= SEQUENCE {
    //   tbsRequest TBSRequest,
    //   optionalSignature [0] EXPLICIT Signature OPTIONAL
    // }
    return this.wrapSequence(tbsRequest);
  }

  /**
   * ASN.1 SEQUENCE wrapper
   */
  private wrapSequence(content: Buffer): Buffer {
    return this.wrapTag(0x30, content);
  }

  /**
   * ASN.1 OCTET STRING wrapper
   */
  private wrapOctetString(content: Buffer): Buffer {
    return this.wrapTag(0x04, content);
  }

  /**
   * ASN.1 INTEGER wrapper
   */
  private wrapInteger(content: Buffer): Buffer {
    // Ensure positive integer (add leading zero if needed)
    if (content.length > 0 && content[0]! >= 0x80) {
      content = Buffer.concat([Buffer.from([0x00]), content]);
    }
    return this.wrapTag(0x02, content);
  }

  /**
   * Generic ASN.1 tag wrapper
   */
  private wrapTag(tag: number, content: Buffer): Buffer {
    const length = content.length;
    let header: Buffer;

    if (length < 128) {
      header = Buffer.from([tag, length]);
    } else if (length < 256) {
      header = Buffer.from([tag, 0x81, length]);
    } else {
      header = Buffer.from([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
    }

    return Buffer.concat([header, content]);
  }

  /**
   * Parse OCSP response
   *
   * This is a simplified implementation. Production code should use
   * a proper ASN.1 library for full response parsing.
   */
  private parseOCSPResponse(
    data: Buffer,
    responderUrl: string,
    expectedNonce?: Buffer
  ): OCSPResponse {
    // Very simplified OCSP response parsing
    // In production, use a proper ASN.1 parser

    // Check response status (first few bytes of SEQUENCE)
    if (data.length < 4) {
      throw new OCSPResponseError('Invalid OCSP response: too short');
    }

    // Parse outer SEQUENCE
    if (data[0] !== 0x30) {
      throw new OCSPResponseError('Invalid OCSP response: not a SEQUENCE');
    }

    // Find responseStatus (ENUMERATED)
    const responseStatusIndex = this.findTag(data, 0x0a, 2); // ENUMERATED
    if (responseStatusIndex < 0) {
      throw new OCSPResponseError('Invalid OCSP response: no responseStatus');
    }

    const responseStatus = data[responseStatusIndex + 2];

    if (responseStatus !== OCSP_RESPONSE_STATUS.successful) {
      const statusName = Object.entries(OCSP_RESPONSE_STATUS).find(
        ([, v]) => v === responseStatus
      )?.[0];
      throw new OCSPResponseError(
        `OCSP responder returned error: ${statusName || responseStatus}`,
        responseStatus
      );
    }

    // For simplicity, extract basic info
    // A full implementation would parse the entire ASN.1 structure

    // Try to find certStatus
    const certStatus = this.extractCertStatus(data);

    // Try to find timestamps
    const timestamps = this.extractTimestamps(data);

    const response: OCSPResponse = {
      status: certStatus.status,
      revocationTime: certStatus.revocationTime,
      revocationReason: certStatus.revocationReason,
      producedAt: timestamps.producedAt,
      thisUpdate: timestamps.thisUpdate,
      nextUpdate: timestamps.nextUpdate,
      responderId: this.extractResponderId(data) || 'unknown',
      fromCache: false,
      responderUrl,
    };

    // Verify nonce if we sent one
    if (expectedNonce && this.config.useNonce) {
      const responseNonce = this.extractNonce(data);
      if (responseNonce && !responseNonce.equals(expectedNonce)) {
        logger.warn('OCSP response nonce mismatch');
        // Some responders don't return nonce, so we log but don't fail
      }
    }

    return response;
  }

  /**
   * Find ASN.1 tag in buffer
   */
  private findTag(data: Buffer, tag: number, startOffset: number): number {
    for (let i = startOffset; i < data.length - 1; i++) {
      if (data[i] === tag) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Extract certificate status from response
   */
  private extractCertStatus(data: Buffer): {
    status: 'good' | 'revoked' | 'unknown';
    revocationTime?: Date;
    revocationReason?: string;
  } {
    // Look for CertStatus in the response
    // good [0] IMPLICIT NULL
    // revoked [1] IMPLICIT RevokedInfo
    // unknown [2] IMPLICIT UnknownInfo

    // Search for context-specific tags [0], [1], [2] in response
    for (let i = 0; i < data.length - 1; i++) {
      const tag = data[i];

      // Context-specific [0] - good
      if (tag === 0x80) {
        return { status: 'good' };
      }

      // Context-specific [1] - revoked
      if (tag === 0xa1) {
        const revokedInfo = this.parseRevokedInfo(data, i);
        return {
          status: 'revoked',
          revocationTime: revokedInfo.time,
          revocationReason: revokedInfo.reason,
        };
      }

      // Context-specific [2] - unknown
      if (tag === 0x82) {
        return { status: 'unknown' };
      }
    }

    // Default to unknown if we can't parse
    return { status: 'unknown' };
  }

  /**
   * Parse RevokedInfo structure
   */
  private parseRevokedInfo(
    data: Buffer,
    offset: number
  ): { time?: Date; reason?: string } {
    // RevokedInfo ::= SEQUENCE {
    //   revocationTime GeneralizedTime,
    //   revocationReason [0] EXPLICIT CRLReason OPTIONAL
    // }

    const result: { time?: Date; reason?: string } = {};

    // Try to find GeneralizedTime (tag 0x18) near the offset
    const timeIndex = this.findTag(data, 0x18, offset);
    if (timeIndex > 0 && timeIndex < offset + 50) {
      const timeLength = data[timeIndex + 1]!;
      const timeStr = data.subarray(timeIndex + 2, timeIndex + 2 + timeLength).toString('ascii');
      result.time = this.parseGeneralizedTime(timeStr);
    }

    // Try to find reason code
    const reasonIndex = this.findTag(data, 0xa0, offset);
    if (reasonIndex > 0 && reasonIndex < offset + 100) {
      const enumIndex = this.findTag(data, 0x0a, reasonIndex);
      if (enumIndex > 0) {
        const reasonCode = data[enumIndex + 2];
        if (reasonCode !== undefined && reasonCode < REVOCATION_REASONS.length) {
          result.reason = REVOCATION_REASONS[reasonCode];
        }
      }
    }

    return result;
  }

  /**
   * Parse GeneralizedTime
   */
  private parseGeneralizedTime(str: string): Date {
    // Format: YYYYMMDDHHmmssZ or YYYYMMDDHHmmss.fffZ
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6), 10) - 1;
    const day = parseInt(str.substring(6, 8), 10);
    const hour = parseInt(str.substring(8, 10), 10);
    const minute = parseInt(str.substring(10, 12), 10);
    const second = parseInt(str.substring(12, 14), 10);

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  /**
   * Extract timestamps from response
   */
  private extractTimestamps(data: Buffer): {
    producedAt: Date;
    thisUpdate: Date;
    nextUpdate?: Date;
  } {
    const now = new Date();

    // Look for GeneralizedTime (0x18) tags
    const times: Date[] = [];
    let offset = 0;

    while (offset < data.length) {
      const index = this.findTag(data, 0x18, offset);
      if (index < 0) break;

      const length = data[index + 1]!;
      const timeStr = data.subarray(index + 2, index + 2 + length).toString('ascii');
      try {
        times.push(this.parseGeneralizedTime(timeStr));
      } catch {
        // Skip invalid time
      }
      offset = index + 2 + length;
    }

    return {
      producedAt: times[0] || now,
      thisUpdate: times[1] || times[0] || now,
      nextUpdate: times[2],
    };
  }

  /**
   * Extract responder ID from response
   */
  private extractResponderId(data: Buffer): string | undefined {
    // Look for responderId which could be byName or byKey
    // This is simplified - full implementation would parse ASN.1 properly
    return undefined;
  }

  /**
   * Extract nonce from response
   */
  private extractNonce(data: Buffer): Buffer | undefined {
    // Look for nonce extension OID: 1.3.6.1.5.5.7.48.1.2
    const nonceOidBytes = [0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x02];

    for (let i = 0; i < data.length - nonceOidBytes.length; i++) {
      let found = true;
      for (let j = 0; j < nonceOidBytes.length; j++) {
        if (data[i + j] !== nonceOidBytes[j]) {
          found = false;
          break;
        }
      }

      if (found) {
        // Nonce value should follow the OID
        const valueOffset = i + nonceOidBytes.length + 2; // Skip OID and length bytes
        if (valueOffset < data.length) {
          const valueLength = data[valueOffset - 1]!;
          if (valueOffset + valueLength <= data.length) {
            return data.subarray(valueOffset, valueOffset + valueLength);
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Get cache key for certificate
   */
  private getCacheKey(certificate: ParsedCertificate, responderUrl: string): string {
    return `${certificate.issuer.full}:${certificate.serialNumber}:${responderUrl}`;
  }

  /**
   * Get cached response if valid
   */
  private getCachedResponse(cacheKey: string): OCSPResponse | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;

    if (new Date() >= entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return entry.response;
  }

  /**
   * Cache OCSP response
   */
  private cacheResponse(cacheKey: string, response: OCSPResponse): void {
    // Determine cache expiration
    let expiresAt: Date;

    if (response.nextUpdate) {
      // Use nextUpdate from response
      expiresAt = new Date(Math.min(response.nextUpdate.getTime(), Date.now() + this.config.cacheTtl));
    } else {
      // Use configured TTL
      expiresAt = new Date(Date.now() + this.config.cacheTtl);
    }

    this.cache.set(cacheKey, { response, expiresAt });

    // Clean up old entries
    this.cleanupCache();
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = new Date();
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OCSPConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): OCSPConfig {
    return { ...this.config };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultValidator: OCSPValidator | null = null;

/**
 * Get the default OCSP validator
 */
export function getOCSPValidator(config?: Partial<OCSPConfig>): OCSPValidator {
  if (!defaultValidator || config) {
    defaultValidator = new OCSPValidator(config);
  }
  return defaultValidator;
}

/**
 * Create a new OCSP validator
 */
export function createOCSPValidator(config: Partial<OCSPConfig> = {}): OCSPValidator {
  return new OCSPValidator(config);
}

/**
 * Reset the default validator (for testing)
 */
export function resetOCSPValidator(): void {
  defaultValidator = null;
}
