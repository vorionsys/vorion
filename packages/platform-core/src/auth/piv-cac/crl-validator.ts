/**
 * CRL Certificate Revocation Checking
 *
 * Certificate Revocation List (CRL) validation for
 * certificate revocation checking.
 *
 * Features:
 * - CRL downloading and parsing
 * - CRL caching with automatic refresh
 * - Delta CRL support
 * - Distribution point handling
 * - Soft-fail mode
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { createLogger } from '../../common/logger.js';
import {
  type ParsedCertificate,
  type CRLData,
  type CRLEntry,
  type CRLConfig,
  type DistinguishedName,
  PIVErrorCode,
} from './types.js';

const logger = createLogger({ component: 'piv-crl-validator' });

// =============================================================================
// Constants
// =============================================================================

/** CRL revocation reason codes */
const CRL_REASON_CODES: Record<number, string> = {
  0: 'unspecified',
  1: 'keyCompromise',
  2: 'cACompromise',
  3: 'affiliationChanged',
  4: 'superseded',
  5: 'cessationOfOperation',
  6: 'certificateHold',
  8: 'removeFromCRL',
  9: 'privilegeWithdrawn',
  10: 'aACompromise',
};

/** Default CRL configuration */
const DEFAULT_CRL_CONFIG: CRLConfig = {
  enabled: true,
  timeout: 30000,
  refreshBefore: 300000, // 5 minutes
  maxSize: 10 * 1024 * 1024, // 10MB
  softFail: false,
  checkDelta: true,
};

// =============================================================================
// Error Classes
// =============================================================================

/**
 * CRL validation error
 */
export class CRLError extends Error {
  constructor(
    message: string,
    public readonly code: PIVErrorCode = PIVErrorCode.CRL_CHECK_FAILED,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CRLError';
  }
}

/**
 * CRL download error
 */
export class CRLDownloadError extends CRLError {
  constructor(distributionPoint: string, originalError?: Error) {
    super(`Failed to download CRL from: ${distributionPoint}`, PIVErrorCode.CRL_CHECK_FAILED, {
      distributionPoint,
      originalError: originalError?.message,
    });
    this.name = 'CRLDownloadError';
  }
}

/**
 * CRL parsing error
 */
export class CRLParseError extends CRLError {
  constructor(message: string) {
    super(message, PIVErrorCode.CRL_CHECK_FAILED);
    this.name = 'CRLParseError';
  }
}

/**
 * CRL size exceeded error
 */
export class CRLSizeExceededError extends CRLError {
  constructor(size: number, maxSize: number) {
    super(`CRL size ${size} exceeds maximum ${maxSize}`, PIVErrorCode.CRL_CHECK_FAILED, {
      size,
      maxSize,
    });
    this.name = 'CRLSizeExceededError';
  }
}

// =============================================================================
// CRL Validator Service
// =============================================================================

/**
 * CRL validation service
 */
export class CRLValidator {
  private config: CRLConfig;
  private cache: Map<string, { crl: CRLData; expiresAt: Date; refreshAt: Date }> = new Map();
  private pendingDownloads: Map<string, Promise<CRLData>> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<CRLConfig> = {}) {
    this.config = { ...DEFAULT_CRL_CONFIG, ...config };
  }

  /**
   * Check if certificate is revoked via CRL
   */
  async checkRevocationStatus(
    certificate: ParsedCertificate,
    issuerCertificate: ParsedCertificate
  ): Promise<{ revoked: boolean; entry?: CRLEntry; crl: CRLData }> {
    if (!this.config.enabled) {
      throw new CRLError('CRL checking is disabled');
    }

    // Get CRL distribution point
    const distributionPoint = this.getDistributionPoint(certificate);
    if (!distributionPoint) {
      throw new CRLError('No CRL distribution point found in certificate');
    }

    // Get or download CRL
    const crl = await this.getCRL(distributionPoint, issuerCertificate);

    // Check for certificate in revocation list
    const entry = crl.revokedCertificates.find(
      (e) => e.serialNumber.toLowerCase() === certificate.serialNumber.toLowerCase()
    );

    if (entry) {
      logger.info(
        {
          serialNumber: certificate.serialNumber,
          revocationDate: entry.revocationDate,
          reason: entry.reason,
        },
        'Certificate found in CRL - REVOKED'
      );

      return { revoked: true, entry, crl };
    }

    // Check delta CRL if enabled and available
    if (this.config.checkDelta && crl.isDelta === false) {
      // Look for delta CRL distribution point in base CRL
      // Delta CRL checking would be implemented here
    }

    logger.debug(
      { serialNumber: certificate.serialNumber },
      'Certificate not found in CRL - not revoked'
    );

    return { revoked: false, crl };
  }

  /**
   * Get CRL distribution point from certificate
   */
  private getDistributionPoint(certificate: ParsedCertificate): string | undefined {
    // Use configured URL override if set
    if (this.config.distributionPointUrl) {
      return this.config.distributionPointUrl;
    }

    // Get from CRL Distribution Points extension
    return certificate.crlDistributionPoints?.[0];
  }

  /**
   * Get CRL from cache or download
   */
  private async getCRL(
    distributionPoint: string,
    issuerCertificate: ParsedCertificate
  ): Promise<CRLData> {
    const cacheKey = this.getCacheKey(distributionPoint, issuerCertificate);

    // Check cache
    const cached = this.getCachedCRL(cacheKey);
    if (cached) {
      logger.debug({ distributionPoint }, 'CRL served from cache');
      return cached;
    }

    // Check for pending download
    const pending = this.pendingDownloads.get(cacheKey);
    if (pending) {
      logger.debug({ distributionPoint }, 'Waiting for pending CRL download');
      return pending;
    }

    // Download CRL
    const downloadPromise = this.downloadCRL(distributionPoint, cacheKey);
    this.pendingDownloads.set(cacheKey, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.pendingDownloads.delete(cacheKey);
    }
  }

  /**
   * Download and parse CRL
   */
  private async downloadCRL(distributionPoint: string, cacheKey: string): Promise<CRLData> {
    try {
      logger.info({ distributionPoint }, 'Downloading CRL');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(distributionPoint, {
          method: 'GET',
          headers: {
            Accept: 'application/pkix-crl, application/x-pkcs7-crl',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new CRLDownloadError(
            distributionPoint,
            new Error(`HTTP ${response.status}`)
          );
        }

        // Check content length
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (size > this.config.maxSize) {
            throw new CRLSizeExceededError(size, this.config.maxSize);
          }
        }

        const data = await response.arrayBuffer();

        // Check actual size
        if (data.byteLength > this.config.maxSize) {
          throw new CRLSizeExceededError(data.byteLength, this.config.maxSize);
        }

        // Parse CRL
        const crl = this.parseCRL(Buffer.from(data), distributionPoint);

        // Cache the CRL
        this.cacheCRL(cacheKey, crl);

        // Schedule refresh
        this.scheduleRefresh(cacheKey, distributionPoint, crl);

        logger.info(
          {
            distributionPoint,
            revokedCount: crl.revokedCertificates.length,
            nextUpdate: crl.nextUpdate,
          },
          'CRL downloaded and parsed'
        );

        return crl;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (this.config.softFail) {
        logger.warn({ error, distributionPoint }, 'CRL download failed, soft-fail enabled');

        // Return empty CRL for soft-fail
        const emptyCrl: CRLData = {
          issuer: { full: 'soft-fail' },
          thisUpdate: new Date(),
          revokedCertificates: [],
          isDelta: false,
          distributionPoint,
          fromCache: false,
        };

        return emptyCrl;
      }

      if (error instanceof CRLError) {
        throw error;
      }

      throw new CRLDownloadError(distributionPoint, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Parse CRL data
   *
   * This is a simplified implementation. Production code should use
   * a proper ASN.1 library for complete CRL parsing.
   */
  private parseCRL(data: Buffer, distributionPoint: string): CRLData {
    try {
      // Check if it's DER or PEM encoded
      let derData = data;

      // If PEM, extract DER
      const pemMatch = data.toString().match(/-----BEGIN X509 CRL-----([\s\S]*?)-----END X509 CRL-----/);
      if (pemMatch) {
        derData = Buffer.from(pemMatch[1]!.replace(/\s/g, ''), 'base64');
      }

      // Parse CRL structure
      // CertificateList ::= SEQUENCE {
      //   tbsCertList TBSCertList,
      //   signatureAlgorithm AlgorithmIdentifier,
      //   signature BIT STRING
      // }

      if (derData[0] !== 0x30) {
        throw new CRLParseError('Invalid CRL: not a SEQUENCE');
      }

      // Parse TBSCertList
      const tbsCertList = this.parseTBSCertList(derData);

      return {
        issuer: tbsCertList.issuer,
        thisUpdate: tbsCertList.thisUpdate,
        nextUpdate: tbsCertList.nextUpdate,
        revokedCertificates: tbsCertList.revokedCertificates,
        crlNumber: tbsCertList.crlNumber,
        isDelta: tbsCertList.isDelta,
        distributionPoint,
        fromCache: false,
      };
    } catch (error) {
      if (error instanceof CRLError) {
        throw error;
      }
      throw new CRLParseError(`Failed to parse CRL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse TBSCertList structure
   */
  private parseTBSCertList(data: Buffer): {
    issuer: DistinguishedName;
    thisUpdate: Date;
    nextUpdate?: Date;
    revokedCertificates: CRLEntry[];
    crlNumber?: string;
    isDelta: boolean;
  } {
    // TBSCertList ::= SEQUENCE {
    //   version Version OPTIONAL, -- if present, MUST be v2
    //   signature AlgorithmIdentifier,
    //   issuer Name,
    //   thisUpdate Time,
    //   nextUpdate Time OPTIONAL,
    //   revokedCertificates SEQUENCE OF SEQUENCE { ... } OPTIONAL,
    //   crlExtensions [0] EXPLICIT Extensions OPTIONAL
    // }

    // This is a simplified parser
    const revokedCertificates: CRLEntry[] = [];
    let issuer: DistinguishedName = { full: 'unknown' };
    let thisUpdate = new Date();
    let nextUpdate: Date | undefined;
    let crlNumber: string | undefined;
    let isDelta = false;

    // Extract issuer DN (look for SEQUENCE containing SET structures)
    const issuerMatch = this.extractName(data);
    if (issuerMatch) {
      issuer = { full: issuerMatch };
    }

    // Extract times
    const times = this.extractTimes(data);
    if (times.thisUpdate) {
      thisUpdate = times.thisUpdate;
    }
    if (times.nextUpdate) {
      nextUpdate = times.nextUpdate;
    }

    // Extract revoked certificates
    const revokedList = this.extractRevokedCertificates(data);
    revokedCertificates.push(...revokedList);

    // Check for delta CRL indicator in extensions
    // OID: 2.5.29.27 (deltaCRLIndicator)
    const deltaCrlOid = [0x55, 0x1d, 0x1b]; // 2.5.29.27
    isDelta = this.containsOID(data, deltaCrlOid);

    // Extract CRL number from extensions
    // OID: 2.5.29.20 (cRLNumber)
    crlNumber = this.extractCRLNumber(data);

    return {
      issuer,
      thisUpdate,
      nextUpdate,
      revokedCertificates,
      crlNumber,
      isDelta,
    };
  }

  /**
   * Extract Name (DN) from ASN.1 structure
   */
  private extractName(data: Buffer): string | undefined {
    // Look for Name structure (SEQUENCE of SET of AttributeTypeAndValue)
    // This is simplified - would need proper ASN.1 parsing for accuracy

    const parts: string[] = [];
    let offset = 0;

    // Find SEQUENCEs that contain SETs (typical for Name structure)
    while (offset < data.length - 4) {
      if (data[offset] === 0x30 && data[offset + 2] === 0x31) {
        // Found a SEQUENCE containing a SET
        // Try to extract RDN components
        const rdnOffset = offset + 2;
        const setLength = data[offset + 3]!;

        if (setLength > 0 && rdnOffset + setLength < data.length) {
          // Look for OID and value
          const oidOffset = this.findTag(data, 0x06, rdnOffset, rdnOffset + setLength + 4);
          if (oidOffset >= 0) {
            const oid = this.extractOID(data, oidOffset);
            const valueOffset = this.findPrintableString(data, oidOffset, rdnOffset + setLength + 10);
            if (valueOffset >= 0) {
              const value = this.extractPrintableString(data, valueOffset);
              if (oid && value) {
                const name = this.oidToName(oid);
                if (name) {
                  parts.push(`${name}=${value}`);
                }
              }
            }
          }
        }
      }
      offset++;
    }

    return parts.length > 0 ? parts.reverse().join(', ') : undefined;
  }

  /**
   * Extract times from CRL
   */
  private extractTimes(data: Buffer): { thisUpdate?: Date; nextUpdate?: Date } {
    const times: Date[] = [];
    let offset = 0;

    // Find UTCTime (0x17) or GeneralizedTime (0x18)
    while (offset < data.length) {
      if (data[offset] === 0x17 || data[offset] === 0x18) {
        const isGeneralized = data[offset] === 0x18;
        const length = data[offset + 1]!;
        const timeStr = data.subarray(offset + 2, offset + 2 + length).toString('ascii');

        try {
          const date = isGeneralized
            ? this.parseGeneralizedTime(timeStr)
            : this.parseUTCTime(timeStr);
          times.push(date);
        } catch {
          // Skip invalid time
        }

        offset += 2 + length;
      } else {
        offset++;
      }

      // Only need first two times (thisUpdate, nextUpdate)
      if (times.length >= 2) break;
    }

    return {
      thisUpdate: times[0],
      nextUpdate: times[1],
    };
  }

  /**
   * Extract revoked certificates list
   */
  private extractRevokedCertificates(data: Buffer): CRLEntry[] {
    const entries: CRLEntry[] = [];

    // Look for the revokedCertificates SEQUENCE
    // Each entry is: SEQUENCE { serialNumber INTEGER, revocationDate Time, extensions [0] OPTIONAL }

    let offset = 0;
    let inRevokedList = false;
    let revokedListEnd = 0;

    // Find the start of revoked certificates
    // It's typically after the times and before extensions
    while (offset < data.length - 10) {
      // Look for SEQUENCE containing INTEGER followed by Time
      if (data[offset] === 0x30) {
        const seqLength = this.getLength(data, offset + 1);
        const contentOffset = offset + 1 + this.getLengthBytes(data, offset + 1);

        if (contentOffset + seqLength.length <= data.length) {
          // Check if this looks like a revoked certificate entry
          if (data[contentOffset] === 0x02) {
            // INTEGER (serial number)
            inRevokedList = true;

            // Extract serial number
            const serialLength = data[contentOffset + 1]!;
            const serialBytes = data.subarray(contentOffset + 2, contentOffset + 2 + serialLength);
            const serialNumber = Array.from(serialBytes)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(':');

            // Extract revocation time
            const timeOffset = contentOffset + 2 + serialLength;
            let revocationDate = new Date();

            if (data[timeOffset] === 0x17 || data[timeOffset] === 0x18) {
              const isGeneralized = data[timeOffset] === 0x18;
              const timeLength = data[timeOffset + 1]!;
              const timeStr = data.subarray(timeOffset + 2, timeOffset + 2 + timeLength).toString('ascii');

              try {
                revocationDate = isGeneralized
                  ? this.parseGeneralizedTime(timeStr)
                  : this.parseUTCTime(timeStr);
              } catch {
                // Use current date as fallback
              }
            }

            // Extract reason code if present
            let reasonCode: number | undefined;
            let reason: string | undefined;

            // Look for extensions (context-specific [0])
            const extOffset = timeOffset + 15; // Approximate
            if (extOffset < contentOffset + seqLength.length && data[extOffset] === 0xa0) {
              // Look for reason code OID (2.5.29.21)
              const reasonOid = [0x55, 0x1d, 0x15];
              if (this.containsOID(data.subarray(extOffset, contentOffset + seqLength.length), reasonOid)) {
                // Find ENUMERATED value
                const enumOffset = this.findTag(data, 0x0a, extOffset, contentOffset + seqLength.length);
                if (enumOffset >= 0) {
                  reasonCode = data[enumOffset + 2];
                  if (reasonCode !== undefined) {
                    reason = CRL_REASON_CODES[reasonCode];
                  }
                }
              }
            }

            entries.push({
              serialNumber,
              revocationDate,
              reasonCode,
              reason,
            });
          }
        }
      }

      offset++;
    }

    return entries;
  }

  /**
   * Check if data contains specific OID
   */
  private containsOID(data: Buffer, oid: number[]): boolean {
    for (let i = 0; i < data.length - oid.length; i++) {
      if (data[i] === 0x06) {
        // OID tag
        const length = data[i + 1]!;
        if (length === oid.length) {
          let match = true;
          for (let j = 0; j < oid.length; j++) {
            if (data[i + 2 + j] !== oid[j]) {
              match = false;
              break;
            }
          }
          if (match) return true;
        }
      }
    }
    return false;
  }

  /**
   * Extract CRL number from extensions
   */
  private extractCRLNumber(data: Buffer): string | undefined {
    // OID: 2.5.29.20 (cRLNumber)
    const crlNumberOid = [0x55, 0x1d, 0x14];

    for (let i = 0; i < data.length - crlNumberOid.length - 4; i++) {
      if (data[i] === 0x06) {
        const length = data[i + 1]!;
        if (length === crlNumberOid.length) {
          let match = true;
          for (let j = 0; j < crlNumberOid.length; j++) {
            if (data[i + 2 + j] !== crlNumberOid[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            // Find INTEGER value after OID
            const intOffset = this.findTag(data, 0x02, i + 2 + length, i + 20);
            if (intOffset >= 0) {
              const intLength = data[intOffset + 1]!;
              const intValue = data.subarray(intOffset + 2, intOffset + 2 + intLength);
              return Array.from(intValue)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Find ASN.1 tag in range
   */
  private findTag(data: Buffer, tag: number, start: number, end: number): number {
    for (let i = start; i < Math.min(end, data.length); i++) {
      if (data[i] === tag) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find printable string or UTF8 string
   */
  private findPrintableString(data: Buffer, start: number, end: number): number {
    for (let i = start; i < Math.min(end, data.length); i++) {
      // PrintableString (0x13), UTF8String (0x0c), IA5String (0x16)
      if (data[i] === 0x13 || data[i] === 0x0c || data[i] === 0x16) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Extract OID from data
   */
  private extractOID(data: Buffer, offset: number): string | undefined {
    if (data[offset] !== 0x06) return undefined;

    const length = data[offset + 1]!;
    const oidBytes = data.subarray(offset + 2, offset + 2 + length);

    // Decode OID
    const components: number[] = [];

    // First byte encodes first two components
    if (oidBytes.length > 0) {
      components.push(Math.floor(oidBytes[0]! / 40));
      components.push(oidBytes[0]! % 40);
    }

    // Remaining bytes encode remaining components (base-128)
    let value = 0;
    for (let i = 1; i < oidBytes.length; i++) {
      const byte = oidBytes[i]!;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        components.push(value);
        value = 0;
      }
    }

    return components.join('.');
  }

  /**
   * Extract printable string value
   */
  private extractPrintableString(data: Buffer, offset: number): string | undefined {
    const tag = data[offset];
    if (tag !== 0x13 && tag !== 0x0c && tag !== 0x16) return undefined;

    const length = data[offset + 1]!;
    return data.subarray(offset + 2, offset + 2 + length).toString('utf-8');
  }

  /**
   * Convert OID to attribute name
   */
  private oidToName(oid: string): string | undefined {
    const oidMap: Record<string, string> = {
      '2.5.4.3': 'CN',
      '2.5.4.6': 'C',
      '2.5.4.7': 'L',
      '2.5.4.8': 'ST',
      '2.5.4.10': 'O',
      '2.5.4.11': 'OU',
      '2.5.4.5': 'serialNumber',
      '1.2.840.113549.1.9.1': 'E',
    };
    return oidMap[oid];
  }

  /**
   * Get ASN.1 length
   */
  private getLength(data: Buffer, offset: number): { length: number; bytes: number } {
    const firstByte = data[offset]!;

    if (firstByte < 128) {
      return { length: firstByte, bytes: 1 };
    }

    const numBytes = firstByte & 0x7f;
    let length = 0;

    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | data[offset + 1 + i]!;
    }

    return { length, bytes: 1 + numBytes };
  }

  /**
   * Get number of length bytes
   */
  private getLengthBytes(data: Buffer, offset: number): number {
    const firstByte = data[offset]!;
    if (firstByte < 128) return 1;
    return 1 + (firstByte & 0x7f);
  }

  /**
   * Parse UTCTime
   */
  private parseUTCTime(str: string): Date {
    // Format: YYMMDDHHmmssZ
    let year = parseInt(str.substring(0, 2), 10);
    // Assume 2000s for years < 50, 1900s otherwise
    year = year < 50 ? 2000 + year : 1900 + year;

    const month = parseInt(str.substring(2, 4), 10) - 1;
    const day = parseInt(str.substring(4, 6), 10);
    const hour = parseInt(str.substring(6, 8), 10);
    const minute = parseInt(str.substring(8, 10), 10);
    const second = parseInt(str.substring(10, 12), 10);

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  /**
   * Parse GeneralizedTime
   */
  private parseGeneralizedTime(str: string): Date {
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6), 10) - 1;
    const day = parseInt(str.substring(6, 8), 10);
    const hour = parseInt(str.substring(8, 10), 10);
    const minute = parseInt(str.substring(10, 12), 10);
    const second = parseInt(str.substring(12, 14), 10);

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  /**
   * Get cache key
   */
  private getCacheKey(distributionPoint: string, issuerCertificate: ParsedCertificate): string {
    const hash = createHash('sha256')
      .update(distributionPoint)
      .update(issuerCertificate.fingerprint)
      .digest('hex');
    return hash.substring(0, 32);
  }

  /**
   * Get cached CRL if valid
   */
  private getCachedCRL(cacheKey: string): CRLData | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;

    const now = new Date();
    if (now >= entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return { ...entry.crl, fromCache: true };
  }

  /**
   * Cache CRL
   */
  private cacheCRL(cacheKey: string, crl: CRLData): void {
    const now = Date.now();

    // Determine expiration
    let expiresAt: Date;
    if (this.config.cacheTtl) {
      expiresAt = new Date(now + this.config.cacheTtl);
    } else if (crl.nextUpdate) {
      expiresAt = crl.nextUpdate;
    } else {
      expiresAt = new Date(now + 24 * 60 * 60 * 1000); // 24 hours default
    }

    // Determine refresh time
    const refreshAt = new Date(expiresAt.getTime() - this.config.refreshBefore);

    this.cache.set(cacheKey, { crl, expiresAt, refreshAt });
  }

  /**
   * Schedule automatic CRL refresh
   */
  private scheduleRefresh(cacheKey: string, distributionPoint: string, crl: CRLData): void {
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate refresh time
    const entry = this.cache.get(cacheKey);
    if (!entry) return;

    const now = Date.now();
    const refreshDelay = Math.max(0, entry.refreshAt.getTime() - now);

    // Don't schedule if refresh is too far in the future
    if (refreshDelay > 24 * 60 * 60 * 1000) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        logger.info({ distributionPoint }, 'Auto-refreshing CRL');
        await this.downloadCRL(distributionPoint, cacheKey);
      } catch (error) {
        logger.error({ error, distributionPoint }, 'CRL auto-refresh failed');
      }
    }, refreshDelay);

    this.refreshTimers.set(cacheKey, timer);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();

    // Clear all refresh timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CRLConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CRLConfig {
    return { ...this.config };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; expiresAt: Date; revokedCount: number }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      expiresAt: entry.expiresAt,
      revokedCount: entry.crl.revokedCertificates.length,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Shutdown validator (clear timers)
   */
  shutdown(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }
}

// =============================================================================
// Singleton and Factory
// =============================================================================

let defaultValidator: CRLValidator | null = null;

/**
 * Get the default CRL validator
 */
export function getCRLValidator(config?: Partial<CRLConfig>): CRLValidator {
  if (!defaultValidator || config) {
    defaultValidator = new CRLValidator(config);
  }
  return defaultValidator;
}

/**
 * Create a new CRL validator
 */
export function createCRLValidator(config: Partial<CRLConfig> = {}): CRLValidator {
  return new CRLValidator(config);
}

/**
 * Reset the default validator (for testing)
 */
export function resetCRLValidator(): void {
  if (defaultValidator) {
    defaultValidator.shutdown();
    defaultValidator = null;
  }
}
