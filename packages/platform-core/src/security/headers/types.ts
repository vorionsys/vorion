/**
 * Security Headers Type Definitions
 *
 * Comprehensive type definitions and Zod schemas for security headers management.
 * Includes CSP, HSTS, CORS, and Permissions Policy configurations.
 *
 * @packageDocumentation
 * @module security/headers/types
 */

import { z } from 'zod';

// =============================================================================
// CSP Directive Types
// =============================================================================

/**
 * CSP source values
 */
export type CSPSourceValue =
  | "'self'"
  | "'unsafe-inline'"
  | "'unsafe-eval'"
  | "'unsafe-hashes'"
  | "'strict-dynamic'"
  | "'report-sample'"
  | "'wasm-unsafe-eval'"
  | "'inline-speculation-rules'"
  | "'none'"
  | `'nonce-${string}'`
  | `'sha256-${string}'`
  | `'sha384-${string}'`
  | `'sha512-${string}'`
  | 'data:'
  | 'blob:'
  | 'mediastream:'
  | 'filesystem:'
  | string;

/**
 * CSP sandbox values
 */
export type CSPSandboxValue =
  | 'allow-downloads'
  | 'allow-downloads-without-user-activation'
  | 'allow-forms'
  | 'allow-modals'
  | 'allow-orientation-lock'
  | 'allow-pointer-lock'
  | 'allow-popups'
  | 'allow-popups-to-escape-sandbox'
  | 'allow-presentation'
  | 'allow-same-origin'
  | 'allow-scripts'
  | 'allow-storage-access-by-user-activation'
  | 'allow-top-navigation'
  | 'allow-top-navigation-by-user-activation'
  | 'allow-top-navigation-to-custom-protocols';

/**
 * All CSP directives
 */
export interface CSPDirectives {
  // Fetch directives
  'default-src'?: CSPSourceValue[];
  'child-src'?: CSPSourceValue[];
  'connect-src'?: CSPSourceValue[];
  'font-src'?: CSPSourceValue[];
  'frame-src'?: CSPSourceValue[];
  'img-src'?: CSPSourceValue[];
  'manifest-src'?: CSPSourceValue[];
  'media-src'?: CSPSourceValue[];
  'object-src'?: CSPSourceValue[];
  'prefetch-src'?: CSPSourceValue[];
  'script-src'?: CSPSourceValue[];
  'script-src-elem'?: CSPSourceValue[];
  'script-src-attr'?: CSPSourceValue[];
  'style-src'?: CSPSourceValue[];
  'style-src-elem'?: CSPSourceValue[];
  'style-src-attr'?: CSPSourceValue[];
  'worker-src'?: CSPSourceValue[];

  // Document directives
  'base-uri'?: CSPSourceValue[];
  sandbox?: CSPSandboxValue[];

  // Navigation directives
  'form-action'?: CSPSourceValue[];
  'frame-ancestors'?: CSPSourceValue[];
  'navigate-to'?: CSPSourceValue[];

  // Reporting directives
  'report-uri'?: string[];
  'report-to'?: string;

  // Other directives
  'require-trusted-types-for'?: ('script')[];
  'trusted-types'?: string[];
  'upgrade-insecure-requests'?: boolean;
  'block-all-mixed-content'?: boolean;
}

/**
 * Zod schema for CSP source value
 */
export const cspSourceValueSchema = z.string();

/**
 * Zod schema for CSP sandbox value
 */
export const cspSandboxValueSchema = z.enum([
  'allow-downloads',
  'allow-downloads-without-user-activation',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

/**
 * Zod schema for CSP directives
 */
export const cspDirectivesSchema = z.object({
  'default-src': z.array(cspSourceValueSchema).optional(),
  'child-src': z.array(cspSourceValueSchema).optional(),
  'connect-src': z.array(cspSourceValueSchema).optional(),
  'font-src': z.array(cspSourceValueSchema).optional(),
  'frame-src': z.array(cspSourceValueSchema).optional(),
  'img-src': z.array(cspSourceValueSchema).optional(),
  'manifest-src': z.array(cspSourceValueSchema).optional(),
  'media-src': z.array(cspSourceValueSchema).optional(),
  'object-src': z.array(cspSourceValueSchema).optional(),
  'prefetch-src': z.array(cspSourceValueSchema).optional(),
  'script-src': z.array(cspSourceValueSchema).optional(),
  'script-src-elem': z.array(cspSourceValueSchema).optional(),
  'script-src-attr': z.array(cspSourceValueSchema).optional(),
  'style-src': z.array(cspSourceValueSchema).optional(),
  'style-src-elem': z.array(cspSourceValueSchema).optional(),
  'style-src-attr': z.array(cspSourceValueSchema).optional(),
  'worker-src': z.array(cspSourceValueSchema).optional(),
  'base-uri': z.array(cspSourceValueSchema).optional(),
  sandbox: z.array(cspSandboxValueSchema).optional(),
  'form-action': z.array(cspSourceValueSchema).optional(),
  'frame-ancestors': z.array(cspSourceValueSchema).optional(),
  'navigate-to': z.array(cspSourceValueSchema).optional(),
  'report-uri': z.array(z.string().url()).optional(),
  'report-to': z.string().optional(),
  'require-trusted-types-for': z.array(z.literal('script')).optional(),
  'trusted-types': z.array(z.string()).optional(),
  'upgrade-insecure-requests': z.boolean().optional(),
  'block-all-mixed-content': z.boolean().optional(),
}).strict();

// =============================================================================
// HSTS Types
// =============================================================================

/**
 * HSTS Configuration
 */
export interface HSTSConfig {
  /** Max-age in seconds (minimum 31536000 for preload) */
  maxAge: number;
  /** Include all subdomains */
  includeSubDomains: boolean;
  /** Enable preload (requires maxAge >= 31536000 and includeSubDomains) */
  preload: boolean;
}

/**
 * Minimum max-age for HSTS preload list submission (1 year in seconds)
 */
export const HSTS_MIN_MAX_AGE_FOR_PRELOAD = 31536000;

/**
 * Recommended max-age for HSTS (2 years in seconds)
 */
export const HSTS_RECOMMENDED_MAX_AGE = 63072000;

/**
 * Zod schema for HSTS configuration
 */
export const hstsConfigSchema = z.object({
  maxAge: z.number().int().min(0).default(HSTS_RECOMMENDED_MAX_AGE),
  includeSubDomains: z.boolean().default(true),
  preload: z.boolean().default(false),
}).refine(
  (config) => {
    // If preload is enabled, maxAge must be at least 1 year and includeSubDomains must be true
    if (config.preload) {
      return config.maxAge >= HSTS_MIN_MAX_AGE_FOR_PRELOAD && config.includeSubDomains;
    }
    return true;
  },
  {
    message: `HSTS preload requires maxAge >= ${HSTS_MIN_MAX_AGE_FOR_PRELOAD} (1 year) and includeSubDomains: true`,
  }
);

// =============================================================================
// CORS Types
// =============================================================================

/**
 * Validated CORS Configuration
 *
 * Unlike basic CORS config, this enforces security constraints:
 * - No wildcard origins in production
 * - Explicit allowed methods and headers
 * - Validated credentials mode
 */
export interface CORSConfig {
  /** Allowed origins (specific URLs, no wildcards in production) */
  allowedOrigins: string[];
  /** Allowed HTTP methods */
  allowedMethods: string[];
  /** Allowed request headers */
  allowedHeaders: string[];
  /** Headers exposed to the client */
  exposedHeaders: string[];
  /** Allow credentials (cookies, authorization headers) */
  credentials: boolean;
  /** Max age for preflight cache (seconds) */
  maxAge: number;
  /** Private network access (Access-Control-Allow-Private-Network) */
  privateNetworkAccess: boolean;
}

/**
 * Zod schema for CORS configuration
 */
export const corsConfigSchema = z.object({
  allowedOrigins: z.array(z.string()).min(1, 'At least one origin must be specified'),
  allowedMethods: z.array(z.string()).default(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']),
  allowedHeaders: z.array(z.string()).default([
    'Accept',
    'Accept-Language',
    'Content-Language',
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
  ]),
  exposedHeaders: z.array(z.string()).default([]),
  credentials: z.boolean().default(false),
  maxAge: z.number().int().min(0).max(86400).default(600),
  privateNetworkAccess: z.boolean().default(false),
}).refine(
  (config) => {
    // Credentials cannot be used with wildcard origin
    if (config.credentials && config.allowedOrigins.includes('*')) {
      return false;
    }
    return true;
  },
  {
    message: 'credentials: true cannot be used with wildcard (*) origin',
  }
);

// =============================================================================
// Permissions Policy Types
// =============================================================================

/**
 * Permissions Policy feature value
 */
export type PermissionsPolicyValue =
  | '*'
  | 'self'
  | '()'
  | `("${string}")`
  | `(self "${string}")`
  | string;

/**
 * Permissions Policy features
 */
export interface PermissionsPolicyConfig {
  // Powerful features
  accelerometer?: PermissionsPolicyValue;
  'ambient-light-sensor'?: PermissionsPolicyValue;
  autoplay?: PermissionsPolicyValue;
  battery?: PermissionsPolicyValue;
  camera?: PermissionsPolicyValue;
  'display-capture'?: PermissionsPolicyValue;
  'document-domain'?: PermissionsPolicyValue;
  'encrypted-media'?: PermissionsPolicyValue;
  fullscreen?: PermissionsPolicyValue;
  gamepad?: PermissionsPolicyValue;
  geolocation?: PermissionsPolicyValue;
  gyroscope?: PermissionsPolicyValue;
  'hid'?: PermissionsPolicyValue;
  'identity-credentials-get'?: PermissionsPolicyValue;
  'idle-detection'?: PermissionsPolicyValue;
  'local-fonts'?: PermissionsPolicyValue;
  magnetometer?: PermissionsPolicyValue;
  microphone?: PermissionsPolicyValue;
  midi?: PermissionsPolicyValue;
  'otp-credentials'?: PermissionsPolicyValue;
  payment?: PermissionsPolicyValue;
  'picture-in-picture'?: PermissionsPolicyValue;
  'publickey-credentials-create'?: PermissionsPolicyValue;
  'publickey-credentials-get'?: PermissionsPolicyValue;
  'screen-wake-lock'?: PermissionsPolicyValue;
  serial?: PermissionsPolicyValue;
  'speaker-selection'?: PermissionsPolicyValue;
  'storage-access'?: PermissionsPolicyValue;
  usb?: PermissionsPolicyValue;
  'web-share'?: PermissionsPolicyValue;
  'window-management'?: PermissionsPolicyValue;
  'xr-spatial-tracking'?: PermissionsPolicyValue;

  // Interest cohort (deprecated but still needed for opt-out)
  'interest-cohort'?: PermissionsPolicyValue;
}

/**
 * Zod schema for Permissions Policy value
 */
export const permissionsPolicyValueSchema = z.string();

/**
 * Zod schema for Permissions Policy configuration
 */
export const permissionsPolicyConfigSchema = z.object({
  accelerometer: permissionsPolicyValueSchema.optional(),
  'ambient-light-sensor': permissionsPolicyValueSchema.optional(),
  autoplay: permissionsPolicyValueSchema.optional(),
  battery: permissionsPolicyValueSchema.optional(),
  camera: permissionsPolicyValueSchema.optional(),
  'display-capture': permissionsPolicyValueSchema.optional(),
  'document-domain': permissionsPolicyValueSchema.optional(),
  'encrypted-media': permissionsPolicyValueSchema.optional(),
  fullscreen: permissionsPolicyValueSchema.optional(),
  gamepad: permissionsPolicyValueSchema.optional(),
  geolocation: permissionsPolicyValueSchema.optional(),
  gyroscope: permissionsPolicyValueSchema.optional(),
  hid: permissionsPolicyValueSchema.optional(),
  'identity-credentials-get': permissionsPolicyValueSchema.optional(),
  'idle-detection': permissionsPolicyValueSchema.optional(),
  'local-fonts': permissionsPolicyValueSchema.optional(),
  magnetometer: permissionsPolicyValueSchema.optional(),
  microphone: permissionsPolicyValueSchema.optional(),
  midi: permissionsPolicyValueSchema.optional(),
  'otp-credentials': permissionsPolicyValueSchema.optional(),
  payment: permissionsPolicyValueSchema.optional(),
  'picture-in-picture': permissionsPolicyValueSchema.optional(),
  'publickey-credentials-create': permissionsPolicyValueSchema.optional(),
  'publickey-credentials-get': permissionsPolicyValueSchema.optional(),
  'screen-wake-lock': permissionsPolicyValueSchema.optional(),
  serial: permissionsPolicyValueSchema.optional(),
  'speaker-selection': permissionsPolicyValueSchema.optional(),
  'storage-access': permissionsPolicyValueSchema.optional(),
  usb: permissionsPolicyValueSchema.optional(),
  'web-share': permissionsPolicyValueSchema.optional(),
  'window-management': permissionsPolicyValueSchema.optional(),
  'xr-spatial-tracking': permissionsPolicyValueSchema.optional(),
  'interest-cohort': permissionsPolicyValueSchema.optional(),
}).strict();

// =============================================================================
// Cross-Origin Policy Types
// =============================================================================

/**
 * Cross-Origin Embedder Policy values
 */
export type COEPValue = 'unsafe-none' | 'require-corp' | 'credentialless';

/**
 * Cross-Origin Opener Policy values
 */
export type COOPValue = 'unsafe-none' | 'same-origin-allow-popups' | 'same-origin';

/**
 * Cross-Origin Resource Policy values
 */
export type CORPValue = 'same-site' | 'same-origin' | 'cross-origin';

/**
 * Referrer Policy values
 */
export type ReferrerPolicyValue =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

/**
 * X-Frame-Options values
 */
export type XFrameOptionsValue = 'DENY' | 'SAMEORIGIN';

// =============================================================================
// Security Headers Configuration
// =============================================================================

/**
 * CSP Reporting configuration
 */
export interface CSPReportingConfig {
  /** Report-URI endpoints (deprecated but still supported) */
  reportUri?: string[];
  /** Report-To group name */
  reportTo?: string;
  /** Reporting endpoint configuration */
  reportingEndpoints?: Record<string, string>;
}

/**
 * Complete Security Headers Configuration
 */
export interface SecurityHeadersConfig {
  /** Environment mode for conditional strictness */
  mode: 'production' | 'development' | 'testing';

  /** Content Security Policy */
  csp: {
    enabled: boolean;
    directives: CSPDirectives;
    reportOnly: boolean;
    reporting?: CSPReportingConfig;
  };

  /** HTTP Strict Transport Security */
  hsts: {
    enabled: boolean;
    config: HSTSConfig;
  };

  /** Cross-Origin Resource Sharing */
  cors: {
    enabled: boolean;
    config: CORSConfig;
  };

  /** Permissions Policy */
  permissionsPolicy: {
    enabled: boolean;
    config: PermissionsPolicyConfig;
  };

  /** Cross-Origin Embedder Policy */
  coep: {
    enabled: boolean;
    value: COEPValue;
  };

  /** Cross-Origin Opener Policy */
  coop: {
    enabled: boolean;
    value: COOPValue;
  };

  /** Cross-Origin Resource Policy */
  corp: {
    enabled: boolean;
    value: CORPValue;
  };

  /** Referrer Policy */
  referrerPolicy: {
    enabled: boolean;
    value: ReferrerPolicyValue;
  };

  /** X-Frame-Options (legacy, prefer CSP frame-ancestors) */
  xFrameOptions: {
    enabled: boolean;
    value: XFrameOptionsValue;
  };

  /** X-Content-Type-Options: nosniff */
  xContentTypeOptions: {
    enabled: boolean;
  };

  /** X-XSS-Protection (deprecated, set to 0) */
  xXssProtection: {
    enabled: boolean;
  };

  /** X-DNS-Prefetch-Control */
  xDnsPrefetchControl: {
    enabled: boolean;
    value: 'on' | 'off';
  };

  /** X-Permitted-Cross-Domain-Policies */
  xPermittedCrossDomainPolicies: {
    enabled: boolean;
    value: 'none' | 'master-only' | 'by-content-type' | 'all';
  };

  /** Paths to exclude from security headers */
  excludePaths?: string[];
}

/**
 * Zod schema for CSP reporting configuration
 */
export const cspReportingConfigSchema = z.object({
  reportUri: z.array(z.string().url()).optional(),
  reportTo: z.string().optional(),
  reportingEndpoints: z.record(z.string().url()).optional(),
});

/**
 * Zod schema for Security Headers Configuration
 */
export const securityHeadersConfigSchema = z.object({
  mode: z.enum(['production', 'development', 'testing']).default('production'),
  csp: z.object({
    enabled: z.boolean().default(true),
    directives: cspDirectivesSchema,
    reportOnly: z.boolean().default(false),
    reporting: cspReportingConfigSchema.optional(),
  }),
  hsts: z.object({
    enabled: z.boolean().default(true),
    config: hstsConfigSchema,
  }),
  cors: z.object({
    enabled: z.boolean().default(true),
    config: corsConfigSchema,
  }),
  permissionsPolicy: z.object({
    enabled: z.boolean().default(true),
    config: permissionsPolicyConfigSchema,
  }),
  coep: z.object({
    enabled: z.boolean().default(false),
    value: z.enum(['unsafe-none', 'require-corp', 'credentialless']).default('unsafe-none'),
  }),
  coop: z.object({
    enabled: z.boolean().default(false),
    value: z.enum(['unsafe-none', 'same-origin-allow-popups', 'same-origin']).default('unsafe-none'),
  }),
  corp: z.object({
    enabled: z.boolean().default(false),
    value: z.enum(['same-site', 'same-origin', 'cross-origin']).default('same-origin'),
  }),
  referrerPolicy: z.object({
    enabled: z.boolean().default(true),
    value: z.enum([
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ]).default('strict-origin-when-cross-origin'),
  }),
  xFrameOptions: z.object({
    enabled: z.boolean().default(true),
    value: z.enum(['DENY', 'SAMEORIGIN']).default('DENY'),
  }),
  xContentTypeOptions: z.object({
    enabled: z.boolean().default(true),
  }),
  xXssProtection: z.object({
    enabled: z.boolean().default(true),
  }),
  xDnsPrefetchControl: z.object({
    enabled: z.boolean().default(true),
    value: z.enum(['on', 'off']).default('off'),
  }),
  xPermittedCrossDomainPolicies: z.object({
    enabled: z.boolean().default(true),
    value: z.enum(['none', 'master-only', 'by-content-type', 'all']).default('none'),
  }),
  excludePaths: z.array(z.string()).optional(),
});

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Security header validation severity
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Individual validation issue
 */
export interface ValidationIssue {
  severity: ValidationSeverity;
  header: string;
  message: string;
  recommendation?: string;
}

/**
 * Validation result
 */
export interface HeaderValidationResult {
  valid: boolean;
  score: number;
  maxScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Zod schema for validation issue
 */
export const validationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  header: z.string(),
  message: z.string(),
  recommendation: z.string().optional(),
});

/**
 * Zod schema for validation result
 */
export const headerValidationResultSchema = z.object({
  valid: z.boolean(),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  grade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']),
  issues: z.array(validationIssueSchema),
  summary: z.object({
    errors: z.number().int().min(0),
    warnings: z.number().int().min(0),
    info: z.number().int().min(0),
  }),
});

// =============================================================================
// CSP Violation Report Types
// =============================================================================

/**
 * CSP Violation Report (browser-sent format)
 */
export interface CSPViolationReport {
  'csp-report': {
    'document-uri': string;
    'violated-directive': string;
    'effective-directive': string;
    'original-policy': string;
    'blocked-uri': string;
    'status-code': number;
    'source-file'?: string;
    'line-number'?: number;
    'column-number'?: number;
    'script-sample'?: string;
    disposition?: 'enforce' | 'report';
    referrer?: string;
  };
}

/**
 * Zod schema for CSP violation report
 */
export const cspViolationReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string(),
    'violated-directive': z.string(),
    'effective-directive': z.string(),
    'original-policy': z.string(),
    'blocked-uri': z.string(),
    'status-code': z.number().int(),
    'source-file': z.string().optional(),
    'line-number': z.number().int().optional(),
    'column-number': z.number().int().optional(),
    'script-sample': z.string().optional(),
    disposition: z.enum(['enforce', 'report']).optional(),
    referrer: z.string().optional(),
  }),
});
