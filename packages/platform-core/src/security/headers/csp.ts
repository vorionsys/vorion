/**
 * Content Security Policy (CSP) Builder
 *
 * Fluent API for building Content Security Policy headers with:
 * - Type-safe directive configuration
 * - Nonce generation for inline scripts
 * - Policy validation
 * - Common presets (strict, moderate, relaxed)
 * - Report-URI/report-to configuration
 *
 * @packageDocumentation
 * @module security/headers/csp
 */

import { randomBytes } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { isProductionGrade } from '../../common/security-mode.js';
import type {
  CSPDirectives,
  CSPSourceValue,
  CSPSandboxValue,
  CSPReportingConfig,
} from './types.js';

const logger = createLogger({ component: 'csp-builder' });

// =============================================================================
// Constants
// =============================================================================

/**
 * Nonce length in bytes (produces 32 character base64 string)
 */
const NONCE_BYTE_LENGTH = 24;

/**
 * Fetch directives that accept source lists
 */
const FETCH_DIRECTIVES = [
  'default-src',
  'child-src',
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'prefetch-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'worker-src',
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * CSP preset type
 */
export type CSPPreset = 'strict' | 'moderate' | 'relaxed' | 'api';

/**
 * CSP validation error
 */
export interface CSPValidationError {
  directive: string;
  issue: string;
  severity: 'error' | 'warning';
}

/**
 * CSP build result
 */
export interface CSPBuildResult {
  /** The policy string to set in the header */
  policy: string;
  /** Generated nonce (if any) */
  nonce?: string;
  /** Whether the policy is in report-only mode */
  reportOnly: boolean;
  /** Validation errors/warnings */
  validationIssues: CSPValidationError[];
}

// =============================================================================
// Nonce Generation
// =============================================================================

/**
 * Generate a cryptographically secure nonce for CSP
 *
 * @returns Base64-encoded nonce string
 */
export function generateNonce(): string {
  return randomBytes(NONCE_BYTE_LENGTH).toString('base64');
}

/**
 * Format nonce for CSP header
 *
 * @param nonce - The nonce value
 * @returns Formatted nonce string for CSP
 */
export function formatNonce(nonce: string): CSPSourceValue {
  return `'nonce-${nonce}'`;
}

// =============================================================================
// CSP Presets
// =============================================================================

/**
 * Strict CSP preset - Maximum security for production
 *
 * - No inline scripts/styles (use nonces)
 * - No eval
 * - Self-only by default
 * - Strict frame ancestors
 */
export const STRICT_CSP_PRESET: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'strict-dynamic'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'upgrade-insecure-requests': true,
  'block-all-mixed-content': true,
};

/**
 * Moderate CSP preset - Balanced security
 *
 * - Allows some common CDN patterns
 * - Still blocks eval
 * - Allows same-origin frames
 */
export const MODERATE_CSP_PRESET: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'https:'],
  'connect-src': ["'self'"],
  'frame-src': ["'self'"],
  'frame-ancestors': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'upgrade-insecure-requests': true,
};

/**
 * Relaxed CSP preset - Development/legacy compatibility
 *
 * WARNING: Only use in development!
 * - Allows unsafe-inline for easier development
 * - Allows more external sources
 */
export const RELAXED_CSP_PRESET: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:', 'http:'],
  'font-src': ["'self'", 'https:', 'http:', 'data:'],
  'connect-src': ["'self'", 'https:', 'http:', 'ws:', 'wss:'],
  'frame-src': ["'self'"],
  'frame-ancestors': ["'self'"],
  'object-src': ["'none'"],
};

/**
 * API-only CSP preset - For pure API services
 *
 * - Minimal directives
 * - No frame embedding
 * - Strict connection rules
 */
export const API_CSP_PRESET: CSPDirectives = {
  'default-src': ["'none'"],
  'script-src': ["'none'"],
  'style-src': ["'none'"],
  'img-src': ["'none'"],
  'font-src': ["'none'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/**
 * Get CSP preset by name
 */
export function getCSPPreset(preset: CSPPreset): CSPDirectives {
  switch (preset) {
    case 'strict':
      return { ...STRICT_CSP_PRESET };
    case 'moderate':
      return { ...MODERATE_CSP_PRESET };
    case 'relaxed':
      return { ...RELAXED_CSP_PRESET };
    case 'api':
      return { ...API_CSP_PRESET };
    default:
      return { ...STRICT_CSP_PRESET };
  }
}

// =============================================================================
// CSP Builder Class
// =============================================================================

/**
 * Fluent builder for Content Security Policy
 *
 * @example
 * ```typescript
 * const csp = new CSPBuilder()
 *   .preset('strict')
 *   .addScriptSrc('https://cdn.example.com')
 *   .withNonce()
 *   .reportTo('csp-violations')
 *   .build();
 *
 * // Use in response
 * res.setHeader('Content-Security-Policy', csp.policy);
 * // Pass nonce to templates for inline scripts
 * res.locals.nonce = csp.nonce;
 * ```
 */
export class CSPBuilder {
  private directives: CSPDirectives = {};
  private nonce: string | undefined;
  private reportOnly = false;
  private reporting: CSPReportingConfig = {};

  /**
   * Start from a preset configuration
   */
  preset(preset: CSPPreset): this {
    this.directives = getCSPPreset(preset);
    return this;
  }

  /**
   * Set default-src directive
   */
  defaultSrc(...sources: CSPSourceValue[]): this {
    this.directives['default-src'] = sources;
    return this;
  }

  /**
   * Set script-src directive
   */
  scriptSrc(...sources: CSPSourceValue[]): this {
    this.directives['script-src'] = sources;
    return this;
  }

  /**
   * Add source to script-src
   */
  addScriptSrc(...sources: CSPSourceValue[]): this {
    this.directives['script-src'] = [
      ...(this.directives['script-src'] ?? []),
      ...sources,
    ];
    return this;
  }

  /**
   * Set style-src directive
   */
  styleSrc(...sources: CSPSourceValue[]): this {
    this.directives['style-src'] = sources;
    return this;
  }

  /**
   * Add source to style-src
   */
  addStyleSrc(...sources: CSPSourceValue[]): this {
    this.directives['style-src'] = [
      ...(this.directives['style-src'] ?? []),
      ...sources,
    ];
    return this;
  }

  /**
   * Set img-src directive
   */
  imgSrc(...sources: CSPSourceValue[]): this {
    this.directives['img-src'] = sources;
    return this;
  }

  /**
   * Add source to img-src
   */
  addImgSrc(...sources: CSPSourceValue[]): this {
    this.directives['img-src'] = [
      ...(this.directives['img-src'] ?? []),
      ...sources,
    ];
    return this;
  }

  /**
   * Set font-src directive
   */
  fontSrc(...sources: CSPSourceValue[]): this {
    this.directives['font-src'] = sources;
    return this;
  }

  /**
   * Set connect-src directive
   */
  connectSrc(...sources: CSPSourceValue[]): this {
    this.directives['connect-src'] = sources;
    return this;
  }

  /**
   * Add source to connect-src
   */
  addConnectSrc(...sources: CSPSourceValue[]): this {
    this.directives['connect-src'] = [
      ...(this.directives['connect-src'] ?? []),
      ...sources,
    ];
    return this;
  }

  /**
   * Set frame-src directive
   */
  frameSrc(...sources: CSPSourceValue[]): this {
    this.directives['frame-src'] = sources;
    return this;
  }

  /**
   * Set frame-ancestors directive
   */
  frameAncestors(...sources: CSPSourceValue[]): this {
    this.directives['frame-ancestors'] = sources;
    return this;
  }

  /**
   * Set object-src directive
   */
  objectSrc(...sources: CSPSourceValue[]): this {
    this.directives['object-src'] = sources;
    return this;
  }

  /**
   * Set base-uri directive
   */
  baseUri(...sources: CSPSourceValue[]): this {
    this.directives['base-uri'] = sources;
    return this;
  }

  /**
   * Set form-action directive
   */
  formAction(...sources: CSPSourceValue[]): this {
    this.directives['form-action'] = sources;
    return this;
  }

  /**
   * Set worker-src directive
   */
  workerSrc(...sources: CSPSourceValue[]): this {
    this.directives['worker-src'] = sources;
    return this;
  }

  /**
   * Set sandbox directive
   */
  sandbox(...values: CSPSandboxValue[]): this {
    this.directives.sandbox = values;
    return this;
  }

  /**
   * Enable upgrade-insecure-requests
   */
  upgradeInsecureRequests(): this {
    this.directives['upgrade-insecure-requests'] = true;
    return this;
  }

  /**
   * Enable block-all-mixed-content
   */
  blockAllMixedContent(): this {
    this.directives['block-all-mixed-content'] = true;
    return this;
  }

  /**
   * Generate and add a nonce for inline scripts
   *
   * The generated nonce will be added to script-src and returned in the build result.
   */
  withNonce(): this {
    this.nonce = generateNonce();
    return this;
  }

  /**
   * Use a specific nonce value
   */
  useNonce(nonce: string): this {
    this.nonce = nonce;
    return this;
  }

  /**
   * Set report-to endpoint
   */
  reportTo(groupName: string): this {
    this.reporting.reportTo = groupName;
    return this;
  }

  /**
   * Set report-uri endpoints (deprecated but still needed for some browsers)
   */
  reportUri(...uris: string[]): this {
    this.reporting.reportUri = uris;
    return this;
  }

  /**
   * Configure reporting endpoints
   */
  reportingEndpoints(endpoints: Record<string, string>): this {
    this.reporting.reportingEndpoints = endpoints;
    return this;
  }

  /**
   * Set policy to report-only mode
   */
  asReportOnly(): this {
    this.reportOnly = true;
    return this;
  }

  /**
   * Set a custom directive
   */
  directive<K extends keyof CSPDirectives>(name: K, value: CSPDirectives[K]): this {
    this.directives[name] = value;
    return this;
  }

  /**
   * Merge additional directives
   */
  merge(directives: Partial<CSPDirectives>): this {
    this.directives = { ...this.directives, ...directives };
    return this;
  }

  /**
   * Validate the CSP configuration
   */
  validate(): CSPValidationError[] {
    const issues: CSPValidationError[] = [];
    const isProd = isProductionGrade();

    // Check for unsafe-inline in script-src (production only)
    const scriptSrc = this.directives['script-src'] ?? [];
    if (isProd && scriptSrc.includes("'unsafe-inline'")) {
      issues.push({
        directive: 'script-src',
        issue: "unsafe-inline is not allowed in production",
        severity: 'error',
      });
    }

    // Check for unsafe-eval in script-src (production only)
    if (isProd && scriptSrc.includes("'unsafe-eval'")) {
      issues.push({
        directive: 'script-src',
        issue: "unsafe-eval is not allowed in production",
        severity: 'error',
      });
    }

    // Check for unsafe-inline in style-src (warning in production)
    const styleSrc = this.directives['style-src'] ?? [];
    if (isProd && styleSrc.includes("'unsafe-inline'") && !this.nonce) {
      issues.push({
        directive: 'style-src',
        issue: "unsafe-inline in style-src is discouraged; consider using nonces",
        severity: 'warning',
      });
    }

    // Check for wildcard in sensitive directives
    const wildcardCheck = ['script-src', 'connect-src', 'frame-ancestors'] as const;
    for (const dir of wildcardCheck) {
      const values = this.directives[dir] ?? [];
      if (values.includes('*')) {
        issues.push({
          directive: dir,
          issue: `Wildcard (*) in ${dir} is insecure`,
          severity: isProd ? 'error' : 'warning',
        });
      }
    }

    // Ensure default-src is set
    if (!this.directives['default-src']) {
      issues.push({
        directive: 'default-src',
        issue: "Missing default-src directive",
        severity: 'warning',
      });
    }

    // Check for missing object-src (should be 'none')
    if (!this.directives['object-src']) {
      issues.push({
        directive: 'object-src',
        issue: "Missing object-src directive; should be set to 'none'",
        severity: 'warning',
      });
    }

    // Check for missing base-uri (should be 'self' or 'none')
    if (!this.directives['base-uri']) {
      issues.push({
        directive: 'base-uri',
        issue: "Missing base-uri directive; vulnerable to base tag injection",
        severity: 'warning',
      });
    }

    // Check for frame-ancestors vs X-Frame-Options
    if (!this.directives['frame-ancestors']) {
      issues.push({
        directive: 'frame-ancestors',
        issue: "Missing frame-ancestors directive; consider adding for clickjacking protection",
        severity: 'info' as 'warning',
      });
    }

    return issues;
  }

  /**
   * Build the CSP header value
   */
  build(): CSPBuildResult {
    // Run validation
    const validationIssues = this.validate();

    // Check for errors in production
    const errors = validationIssues.filter((i) => i.severity === 'error');
    if (isProductionGrade() && errors.length > 0) {
      logger.error(
        { errors },
        'CSP validation failed in production mode'
      );
      throw new Error(
        `CSP validation failed: ${errors.map((e) => e.issue).join('; ')}`
      );
    }

    // Build the policy string
    const parts: string[] = [];

    // Add nonce to script-src if present
    let directives = { ...this.directives };
    if (this.nonce) {
      const nonceValue = formatNonce(this.nonce);
      directives['script-src'] = [
        ...(directives['script-src'] ?? ["'self'"]),
        nonceValue,
      ];
      // Also add to style-src if it exists
      if (directives['style-src']) {
        directives['style-src'] = [...directives['style-src'], nonceValue];
      }
    }

    // Build directive strings
    for (const [key, value] of Object.entries(directives)) {
      if (value === undefined) continue;

      if (typeof value === 'boolean') {
        if (value) {
          parts.push(key);
        }
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          parts.push(`${key} ${value.join(' ')}`);
        }
      }
    }

    // Add reporting directives
    if (this.reporting.reportUri && this.reporting.reportUri.length > 0) {
      parts.push(`report-uri ${this.reporting.reportUri.join(' ')}`);
    }
    if (this.reporting.reportTo) {
      parts.push(`report-to ${this.reporting.reportTo}`);
    }

    const policy = parts.join('; ');

    // Log any warnings
    const warnings = validationIssues.filter((i) => i.severity === 'warning');
    if (warnings.length > 0) {
      logger.warn(
        { warnings },
        'CSP built with warnings'
      );
    }

    return {
      policy,
      nonce: this.nonce,
      reportOnly: this.reportOnly,
      validationIssues,
    };
  }

  /**
   * Get the header name based on report-only mode
   */
  getHeaderName(): string {
    return this.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy';
  }

  /**
   * Get the current directives (for inspection)
   */
  getDirectives(): CSPDirectives {
    return { ...this.directives };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a CSP builder with strict defaults
 */
export function createStrictCSP(): CSPBuilder {
  return new CSPBuilder().preset('strict');
}

/**
 * Create a CSP builder with moderate defaults
 */
export function createModerateCSP(): CSPBuilder {
  return new CSPBuilder().preset('moderate');
}

/**
 * Create a CSP builder for API services
 */
export function createAPICSP(): CSPBuilder {
  return new CSPBuilder().preset('api');
}

/**
 * Create a CSP builder for development (relaxed)
 *
 * WARNING: Only use in development!
 */
export function createDevelopmentCSP(): CSPBuilder {
  if (isProductionGrade()) {
    logger.warn('createDevelopmentCSP() called in production - using moderate preset instead');
    return new CSPBuilder().preset('moderate');
  }
  return new CSPBuilder().preset('relaxed');
}

/**
 * Build a CSP string directly from directives
 */
export function buildCSPString(directives: CSPDirectives, nonce?: string): string {
  const builder = new CSPBuilder();
  builder.merge(directives);
  if (nonce) {
    builder.useNonce(nonce);
  }
  return builder.build().policy;
}

/**
 * Parse a CSP string into directives (for analysis)
 */
export function parseCSPString(policy: string): CSPDirectives {
  const directives: CSPDirectives = {};
  const parts = policy.split(';').map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const [name, ...values] = part.split(/\s+/);

    if (!name) continue;

    // Boolean directives
    if (name === 'upgrade-insecure-requests') {
      directives['upgrade-insecure-requests'] = true;
      continue;
    }
    if (name === 'block-all-mixed-content') {
      directives['block-all-mixed-content'] = true;
      continue;
    }

    // Source list directives
    if (FETCH_DIRECTIVES.includes(name as typeof FETCH_DIRECTIVES[number])) {
      (directives as Record<string, CSPSourceValue[]>)[name] = values as CSPSourceValue[];
      continue;
    }

    // Other directives
    if (name === 'report-uri') {
      directives['report-uri'] = values;
      continue;
    }
    if (name === 'report-to') {
      directives['report-to'] = values[0];
      continue;
    }
    if (name === 'sandbox') {
      directives.sandbox = values as CSPSandboxValue[];
      continue;
    }
    if (name === 'frame-ancestors') {
      directives['frame-ancestors'] = values as CSPSourceValue[];
      continue;
    }
    if (name === 'base-uri') {
      directives['base-uri'] = values as CSPSourceValue[];
      continue;
    }
    if (name === 'form-action') {
      directives['form-action'] = values as CSPSourceValue[];
      continue;
    }
  }

  return directives;
}
