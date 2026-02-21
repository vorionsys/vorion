/**
 * HTTP Strict Transport Security (HSTS) Manager
 *
 * Manages HSTS header configuration with:
 * - Preload list compatibility checking
 * - Max-age validation
 * - includeSubDomains configuration
 *
 * @packageDocumentation
 * @module security/headers/hsts
 */

import { createLogger } from '../../common/logger.js';
import { isProductionGrade } from '../../common/security-mode.js';
import {
  type HSTSConfig,
  HSTS_MIN_MAX_AGE_FOR_PRELOAD,
  HSTS_RECOMMENDED_MAX_AGE,
  hstsConfigSchema,
} from './types.js';

const logger = createLogger({ component: 'hsts-manager' });

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum recommended max-age (6 months in seconds)
 */
export const HSTS_MIN_RECOMMENDED_MAX_AGE = 15768000;

/**
 * Maximum sensible max-age (2 years in seconds)
 */
export const HSTS_MAX_SENSIBLE_MAX_AGE = 63072000;

/**
 * HSTS header name
 */
export const HSTS_HEADER_NAME = 'Strict-Transport-Security';

// =============================================================================
// Types
// =============================================================================

/**
 * HSTS validation result
 */
export interface HSTSValidationResult {
  valid: boolean;
  preloadReady: boolean;
  issues: HSTSValidationIssue[];
}

/**
 * HSTS validation issue
 */
export interface HSTSValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
}

// =============================================================================
// HSTS Manager Class
// =============================================================================

/**
 * HSTS Manager for configuring Strict-Transport-Security headers
 *
 * @example
 * ```typescript
 * const hsts = new HSTSManager({
 *   maxAge: 63072000, // 2 years
 *   includeSubDomains: true,
 *   preload: true,
 * });
 *
 * // Validate configuration
 * const validation = hsts.validate();
 * if (!validation.valid) {
 *   console.error('HSTS configuration invalid:', validation.issues);
 * }
 *
 * // Build header
 * const headerValue = hsts.buildHeader();
 * res.setHeader('Strict-Transport-Security', headerValue);
 * ```
 */
export class HSTSManager {
  private config: HSTSConfig;

  constructor(config: Partial<HSTSConfig> = {}) {
    // Apply defaults and validate
    const validated = hstsConfigSchema.parse({
      maxAge: config.maxAge ?? HSTS_RECOMMENDED_MAX_AGE,
      includeSubDomains: config.includeSubDomains ?? true,
      preload: config.preload ?? false,
    }) as HSTSConfig;

    this.config = validated;
  }

  /**
   * Get current configuration
   */
  getConfig(): HSTSConfig {
    return { ...this.config };
  }

  /**
   * Update max-age value
   */
  setMaxAge(maxAge: number): this {
    if (maxAge < 0) {
      throw new Error('max-age cannot be negative');
    }
    if (this.config.preload && maxAge < HSTS_MIN_MAX_AGE_FOR_PRELOAD) {
      throw new Error(
        `max-age must be at least ${HSTS_MIN_MAX_AGE_FOR_PRELOAD} seconds (1 year) for preload`
      );
    }
    this.config.maxAge = maxAge;
    return this;
  }

  /**
   * Enable or disable includeSubDomains
   */
  setIncludeSubDomains(include: boolean): this {
    if (this.config.preload && !include) {
      throw new Error('includeSubDomains must be true when preload is enabled');
    }
    this.config.includeSubDomains = include;
    return this;
  }

  /**
   * Enable or disable preload
   *
   * Enabling preload will automatically ensure:
   * - max-age is at least 1 year (31536000 seconds)
   * - includeSubDomains is enabled
   */
  setPreload(enable: boolean): this {
    if (enable) {
      // Enforce preload requirements
      if (this.config.maxAge < HSTS_MIN_MAX_AGE_FOR_PRELOAD) {
        logger.info(
          { oldMaxAge: this.config.maxAge, newMaxAge: HSTS_MIN_MAX_AGE_FOR_PRELOAD },
          'Increasing max-age to meet preload requirement'
        );
        this.config.maxAge = HSTS_MIN_MAX_AGE_FOR_PRELOAD;
      }
      this.config.includeSubDomains = true;
    }
    this.config.preload = enable;
    return this;
  }

  /**
   * Validate the HSTS configuration
   */
  validate(): HSTSValidationResult {
    const issues: HSTSValidationIssue[] = [];
    let valid = true;
    let preloadReady = true;

    // Check max-age
    if (this.config.maxAge < HSTS_MIN_RECOMMENDED_MAX_AGE) {
      issues.push({
        severity: 'warning',
        message: `max-age of ${this.config.maxAge} seconds is below recommended minimum of ${HSTS_MIN_RECOMMENDED_MAX_AGE} (6 months)`,
        recommendation: `Increase max-age to at least ${HSTS_MIN_RECOMMENDED_MAX_AGE} seconds`,
      });
    }

    if (this.config.maxAge > HSTS_MAX_SENSIBLE_MAX_AGE) {
      issues.push({
        severity: 'info',
        message: `max-age of ${this.config.maxAge} seconds exceeds typical maximum of ${HSTS_MAX_SENSIBLE_MAX_AGE} (2 years)`,
      });
    }

    // Check preload requirements
    if (this.config.preload) {
      if (this.config.maxAge < HSTS_MIN_MAX_AGE_FOR_PRELOAD) {
        valid = false;
        preloadReady = false;
        issues.push({
          severity: 'error',
          message: `preload requires max-age of at least ${HSTS_MIN_MAX_AGE_FOR_PRELOAD} seconds (1 year), got ${this.config.maxAge}`,
          recommendation: `Set max-age to ${HSTS_MIN_MAX_AGE_FOR_PRELOAD} or higher`,
        });
      }

      if (!this.config.includeSubDomains) {
        valid = false;
        preloadReady = false;
        issues.push({
          severity: 'error',
          message: 'preload requires includeSubDomains to be enabled',
          recommendation: 'Enable includeSubDomains',
        });
      }
    } else {
      // Not preload, but check if it could be
      if (
        this.config.maxAge >= HSTS_MIN_MAX_AGE_FOR_PRELOAD &&
        this.config.includeSubDomains
      ) {
        issues.push({
          severity: 'info',
          message: 'Configuration meets preload requirements but preload is not enabled',
          recommendation: 'Consider enabling preload for additional security',
        });
      } else {
        preloadReady = false;
        if (this.config.maxAge < HSTS_MIN_MAX_AGE_FOR_PRELOAD) {
          issues.push({
            severity: 'info',
            message: `max-age of ${this.config.maxAge} is below preload requirement of ${HSTS_MIN_MAX_AGE_FOR_PRELOAD}`,
          });
        }
        if (!this.config.includeSubDomains) {
          issues.push({
            severity: 'info',
            message: 'includeSubDomains is not enabled; required for preload',
          });
        }
      }
    }

    // Production-specific checks
    if (isProductionGrade()) {
      if (this.config.maxAge < HSTS_MIN_RECOMMENDED_MAX_AGE) {
        issues.push({
          severity: 'warning',
          message: 'HSTS max-age is below recommended minimum for production',
          recommendation: `Set max-age to at least ${HSTS_MIN_RECOMMENDED_MAX_AGE} seconds`,
        });
      }

      if (!this.config.includeSubDomains) {
        issues.push({
          severity: 'warning',
          message: 'includeSubDomains should be enabled in production',
          recommendation: 'Enable includeSubDomains to protect all subdomains',
        });
      }
    }

    return { valid, preloadReady, issues };
  }

  /**
   * Build the HSTS header value
   */
  buildHeader(): string {
    const parts: string[] = [`max-age=${this.config.maxAge}`];

    if (this.config.includeSubDomains) {
      parts.push('includeSubDomains');
    }

    if (this.config.preload) {
      parts.push('preload');
    }

    return parts.join('; ');
  }

  /**
   * Check if configuration is ready for HSTS preload list submission
   *
   * Requirements for hstspreload.org:
   * 1. Serve a valid certificate
   * 2. Redirect from HTTP to HTTPS on the same host
   * 3. Serve all subdomains over HTTPS
   * 4. Serve an HSTS header on the base domain with:
   *    - max-age at least 31536000 (1 year)
   *    - includeSubDomains directive
   *    - preload directive
   */
  isPreloadReady(): boolean {
    return (
      this.config.maxAge >= HSTS_MIN_MAX_AGE_FOR_PRELOAD &&
      this.config.includeSubDomains &&
      this.config.preload
    );
  }

  /**
   * Get time until max-age expires (for monitoring)
   *
   * @param setAt - When the header was set (defaults to now)
   * @returns Remaining seconds
   */
  getTimeRemaining(setAt: Date = new Date()): number {
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - setAt.getTime()) / 1000);
    return Math.max(0, this.config.maxAge - elapsed);
  }

  /**
   * Clone the manager with the same configuration
   */
  clone(): HSTSManager {
    return new HSTSManager({ ...this.config });
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an HSTS manager with production-ready defaults
 *
 * - max-age: 2 years
 * - includeSubDomains: true
 * - preload: false (enable explicitly after testing)
 */
export function createProductionHSTS(): HSTSManager {
  return new HSTSManager({
    maxAge: HSTS_RECOMMENDED_MAX_AGE,
    includeSubDomains: true,
    preload: false,
  });
}

/**
 * Create an HSTS manager with preload-ready configuration
 *
 * - max-age: 2 years (exceeds 1 year minimum)
 * - includeSubDomains: true
 * - preload: true
 */
export function createPreloadHSTS(): HSTSManager {
  return new HSTSManager({
    maxAge: HSTS_RECOMMENDED_MAX_AGE,
    includeSubDomains: true,
    preload: true,
  });
}

/**
 * Create an HSTS manager for development/testing
 *
 * WARNING: Uses short max-age for testing purposes only!
 *
 * - max-age: 300 seconds (5 minutes)
 * - includeSubDomains: false
 * - preload: false
 */
export function createDevelopmentHSTS(): HSTSManager {
  if (isProductionGrade()) {
    logger.warn('createDevelopmentHSTS() called in production - using production defaults');
    return createProductionHSTS();
  }

  return new HSTSManager({
    maxAge: 300, // 5 minutes for testing
    includeSubDomains: false,
    preload: false,
  });
}

/**
 * Create an HSTS manager with custom configuration
 */
export function createHSTS(config: Partial<HSTSConfig>): HSTSManager {
  return new HSTSManager(config);
}

/**
 * Build an HSTS header value directly
 */
export function buildHSTSHeader(config: Partial<HSTSConfig>): string {
  return new HSTSManager(config).buildHeader();
}

/**
 * Parse an HSTS header value into configuration
 */
export function parseHSTSHeader(header: string): HSTSConfig {
  const config: HSTSConfig = {
    maxAge: 0,
    includeSubDomains: false,
    preload: false,
  };

  const parts = header.split(';').map((p) => p.trim().toLowerCase());

  for (const part of parts) {
    if (part.startsWith('max-age=')) {
      const value = parseInt(part.substring(8), 10);
      if (!isNaN(value)) {
        config.maxAge = value;
      }
    } else if (part === 'includesubdomains') {
      config.includeSubDomains = true;
    } else if (part === 'preload') {
      config.preload = true;
    }
  }

  return config;
}

/**
 * Validate an HSTS header string
 */
export function validateHSTSHeader(header: string): HSTSValidationResult {
  const config = parseHSTSHeader(header);
  return new HSTSManager(config).validate();
}
