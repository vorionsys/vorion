/**
 * Server-Side Fingerprint Service
 *
 * Computes and validates server-side fingerprints from request headers
 * for session binding and anomaly detection.
 *
 * Features:
 * - Deterministic fingerprint generation from request headers
 * - SHA-256 hashing for compact, collision-resistant fingerprints
 * - Configurable strictness (warn vs block)
 * - Configurable components for fingerprint computation
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';

const logger = createLogger({ component: 'fingerprint-service' });

/**
 * Headers that can be used for fingerprint computation
 */
export interface RequestHeaders {
  /** User-Agent header */
  userAgent?: string;
  /** Accept-Language header */
  acceptLanguage?: string;
  /** Accept-Encoding header */
  acceptEncoding?: string;
  /** DNT (Do Not Track) header */
  dnt?: string;
  /** Accept header */
  accept?: string;
  /** Sec-CH-UA header (Client Hints) */
  secChUa?: string;
  /** Sec-CH-UA-Mobile header */
  secChUaMobile?: string;
  /** Sec-CH-UA-Platform header */
  secChUaPlatform?: string;
}

/**
 * Fingerprint service configuration
 */
export interface FingerprintConfig {
  /** Whether fingerprint validation is enabled */
  enabled: boolean;
  /** Strictness level: 'warn' logs mismatches, 'block' rejects the request */
  strictness: 'warn' | 'block';
  /** Components to include in fingerprint computation */
  components: string[];
}

const DEFAULT_CONFIG: FingerprintConfig = {
  enabled: true,
  strictness: 'warn',
  components: ['userAgent', 'acceptLanguage'],
};

/**
 * Result of fingerprint computation
 */
export interface FingerprintResult {
  /** The computed fingerprint hash */
  fingerprint: string;
  /** Components that were used in computation */
  componentsUsed: string[];
  /** Whether any components were missing */
  missingComponents: string[];
}

/**
 * Result of fingerprint validation
 */
export interface FingerprintValidationResult {
  /** Whether the fingerprint is valid (matches) */
  valid: boolean;
  /** Reason for validation failure */
  reason?: string;
  /** Whether the request should be blocked (based on strictness) */
  shouldBlock: boolean;
  /** Current fingerprint from request */
  currentFingerprint?: string;
  /** Stored fingerprint from session */
  storedFingerprint?: string;
  /** Components that changed */
  changedComponents?: string[];
}

/**
 * Server-side fingerprint service for session binding
 */
export class FingerprintService {
  private config: FingerprintConfig;

  constructor(config: Partial<FingerprintConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.debug('Fingerprint service initialized', {
      enabled: this.config.enabled,
      strictness: this.config.strictness,
      components: this.config.components,
    });
  }

  /**
   * Compute a fingerprint from request headers
   *
   * @param headers - Request headers to fingerprint
   * @returns Fingerprint result with hash and metadata
   */
  computeFingerprint(headers: RequestHeaders): FingerprintResult {
    const componentsUsed: string[] = [];
    const missingComponents: string[] = [];
    const parts: string[] = [];

    // Build fingerprint from configured components
    for (const component of this.config.components) {
      const value = this.getHeaderValue(headers, component);
      if (value !== undefined && value !== '') {
        componentsUsed.push(component);
        parts.push(`${component}:${value}`);
      } else {
        missingComponents.push(component);
      }
    }

    // Create deterministic fingerprint string
    const fingerprintData = parts.sort().join('|');

    // Hash with SHA-256 for compact, collision-resistant output
    const fingerprint = createHash('sha256')
      .update(fingerprintData)
      .digest('hex');

    logger.debug('Fingerprint computed', {
      fingerprintPrefix: fingerprint.substring(0, 8),
      componentsUsed,
      missingComponents,
    });

    return {
      fingerprint,
      componentsUsed,
      missingComponents,
    };
  }

  /**
   * Validate a fingerprint against a stored fingerprint
   *
   * @param headers - Current request headers
   * @param storedFingerprint - Previously stored fingerprint from session
   * @param sessionId - Session ID for logging
   * @returns Validation result
   */
  validateFingerprint(
    headers: RequestHeaders,
    storedFingerprint: string,
    sessionId?: string
  ): FingerprintValidationResult {
    if (!this.config.enabled) {
      return {
        valid: true,
        shouldBlock: false,
        reason: 'Fingerprint validation disabled',
      };
    }

    const current = this.computeFingerprint(headers);

    // Exact match
    if (current.fingerprint === storedFingerprint) {
      logger.debug('Fingerprint validated successfully', {
        sessionId,
        fingerprintPrefix: current.fingerprint.substring(0, 8),
      });

      return {
        valid: true,
        shouldBlock: false,
        currentFingerprint: current.fingerprint,
        storedFingerprint,
      };
    }

    // Mismatch detected
    const changedComponents = this.detectChangedComponents(headers, storedFingerprint);

    const result: FingerprintValidationResult = {
      valid: false,
      reason: 'Fingerprint mismatch detected',
      shouldBlock: this.config.strictness === 'block',
      currentFingerprint: current.fingerprint,
      storedFingerprint,
      changedComponents,
    };

    // Log based on strictness
    if (this.config.strictness === 'block') {
      logger.warn(
        {
          sessionId,
          currentFingerprintPrefix: current.fingerprint.substring(0, 8),
          storedFingerprintPrefix: storedFingerprint.substring(0, 8),
          changedComponents,
        },
        'Fingerprint mismatch - blocking request'
      );
    } else {
      logger.info(
        {
          sessionId,
          currentFingerprintPrefix: current.fingerprint.substring(0, 8),
          storedFingerprintPrefix: storedFingerprint.substring(0, 8),
          changedComponents,
        },
        'Fingerprint mismatch - warning only'
      );
    }

    return result;
  }

  /**
   * Check if fingerprint validation is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current strictness setting
   */
  getStrictness(): 'warn' | 'block' {
    return this.config.strictness;
  }

  /**
   * Get the configured components
   */
  getComponents(): string[] {
    return [...this.config.components];
  }

  /**
   * Extract a header value by component name
   */
  private getHeaderValue(headers: RequestHeaders, component: string): string | undefined {
    switch (component) {
      case 'userAgent':
        return headers.userAgent;
      case 'acceptLanguage':
        return headers.acceptLanguage;
      case 'acceptEncoding':
        return headers.acceptEncoding;
      case 'dnt':
        return headers.dnt;
      case 'accept':
        return headers.accept;
      case 'secChUa':
        return headers.secChUa;
      case 'secChUaMobile':
        return headers.secChUaMobile;
      case 'secChUaPlatform':
        return headers.secChUaPlatform;
      default:
        logger.warn({ component }, 'Unknown fingerprint component');
        return undefined;
    }
  }

  /**
   * Attempt to detect which components changed
   * This is approximate as we can't reverse the hash
   */
  private detectChangedComponents(
    _headers: RequestHeaders,
    _storedFingerprint: string
  ): string[] {
    // Since fingerprints are hashed, we can't determine exact changes
    // without storing individual component hashes
    // For now, return all configured components as potentially changed
    return [...this.config.components];
  }
}

// Singleton instance
let fingerprintService: FingerprintService | null = null;

/**
 * Get the fingerprint service singleton
 *
 * Initializes with configuration from getConfig() on first call.
 */
export function getFingerprintService(): FingerprintService {
  if (!fingerprintService) {
    const appConfig = getConfig();

    fingerprintService = new FingerprintService({
      enabled: appConfig.session.fingerprintEnabled,
      strictness: appConfig.session.fingerprintStrictness,
      components: appConfig.session.fingerprintComponents,
    });

    logger.info('Fingerprint service singleton initialized');
  }

  return fingerprintService;
}

/**
 * Reset the singleton instance (useful for testing)
 *
 * @internal
 */
export function resetFingerprintService(): void {
  fingerprintService = null;
  logger.debug('Fingerprint service singleton reset');
}

/**
 * Extract fingerprint-relevant headers from a Fastify request
 *
 * @param requestHeaders - Raw request headers object
 * @returns Normalized headers for fingerprint computation
 */
export function extractFingerprintHeaders(
  requestHeaders: Record<string, string | string[] | undefined>
): RequestHeaders {
  const getHeader = (name: string): string | undefined => {
    const value = requestHeaders[name] ?? requestHeaders[name.toLowerCase()];
    return typeof value === 'string' ? value : value?.[0];
  };

  return {
    userAgent: getHeader('user-agent'),
    acceptLanguage: getHeader('accept-language'),
    acceptEncoding: getHeader('accept-encoding'),
    dnt: getHeader('dnt'),
    accept: getHeader('accept'),
    secChUa: getHeader('sec-ch-ua'),
    secChUaMobile: getHeader('sec-ch-ua-mobile'),
    secChUaPlatform: getHeader('sec-ch-ua-platform'),
  };
}

export default FingerprintService;
