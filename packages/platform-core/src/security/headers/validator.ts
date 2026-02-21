/**
 * Security Headers Validator
 *
 * Validates security header configurations and generates security scores.
 *
 * @packageDocumentation
 * @module security/headers/validator
 */

import { createLogger } from '../../common/logger.js';
import { isProductionGrade } from '../../common/security-mode.js';
import type {
  SecurityHeadersConfig,
  ValidationIssue,
  HeaderValidationResult,
  CSPDirectives,
  HSTSConfig,
  CORSConfig,
  PermissionsPolicyConfig,
} from './types.js';
import { HSTS_MIN_MAX_AGE_FOR_PRELOAD, HSTS_RECOMMENDED_MAX_AGE } from './types.js';

const logger = createLogger({ component: 'security-headers-validator' });

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum score for each header category
 */
const SCORE_WEIGHTS = {
  csp: 25,
  hsts: 15,
  cors: 15,
  xFrameOptions: 10,
  xContentTypeOptions: 5,
  referrerPolicy: 10,
  permissionsPolicy: 10,
  crossOriginPolicies: 10,
};

/**
 * Total possible score
 */
const MAX_SCORE = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

// =============================================================================
// CSP Validation
// =============================================================================

/**
 * Validate CSP directives
 */
function validateCSP(
  directives: CSPDirectives,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = SCORE_WEIGHTS.csp;

  // Check for default-src
  if (!directives['default-src']) {
    issues.push({
      severity: 'warning',
      header: 'Content-Security-Policy',
      message: 'Missing default-src directive',
      recommendation: "Add default-src 'self' as a baseline",
    });
    score -= 5;
  }

  // Check for object-src
  if (!directives['object-src']) {
    issues.push({
      severity: 'warning',
      header: 'Content-Security-Policy',
      message: 'Missing object-src directive',
      recommendation: "Add object-src 'none' to prevent plugin-based attacks",
    });
    score -= 3;
  } else if (!directives['object-src'].includes("'none'")) {
    issues.push({
      severity: 'warning',
      header: 'Content-Security-Policy',
      message: "object-src should be 'none'",
      recommendation: 'Plugins are legacy; set object-src to none',
    });
    score -= 2;
  }

  // Check for script-src unsafe-inline
  const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];
  if (scriptSrc.includes("'unsafe-inline'")) {
    if (isProd) {
      issues.push({
        severity: 'error',
        header: 'Content-Security-Policy',
        message: "unsafe-inline in script-src is not allowed in production",
        recommendation: 'Use nonces or hashes for inline scripts',
      });
      score -= 10;
    } else {
      issues.push({
        severity: 'warning',
        header: 'Content-Security-Policy',
        message: 'unsafe-inline in script-src is insecure',
        recommendation: 'Use nonces or hashes for inline scripts',
      });
      score -= 5;
    }
  }

  // Check for script-src unsafe-eval
  if (scriptSrc.includes("'unsafe-eval'")) {
    if (isProd) {
      issues.push({
        severity: 'error',
        header: 'Content-Security-Policy',
        message: "unsafe-eval in script-src is not allowed in production",
        recommendation: 'Remove unsafe-eval and refactor code to avoid eval()',
      });
      score -= 10;
    } else {
      issues.push({
        severity: 'warning',
        header: 'Content-Security-Policy',
        message: 'unsafe-eval in script-src allows code injection',
        recommendation: 'Avoid eval() and related functions',
      });
      score -= 5;
    }
  }

  // Check for wildcards
  const wildcardDirs = ['script-src', 'connect-src', 'frame-ancestors'] as const;
  for (const dir of wildcardDirs) {
    const values = directives[dir] ?? [];
    if (values.includes('*') || values.some((v) => v === 'https:' || v === 'http:')) {
      issues.push({
        severity: isProd ? 'error' : 'warning',
        header: 'Content-Security-Policy',
        message: `Overly permissive ${dir} directive`,
        recommendation: `Specify explicit origins instead of wildcards in ${dir}`,
      });
      score -= isProd ? 5 : 3;
    }
  }

  // Check for base-uri
  if (!directives['base-uri']) {
    issues.push({
      severity: 'warning',
      header: 'Content-Security-Policy',
      message: 'Missing base-uri directive',
      recommendation: "Add base-uri 'self' or 'none' to prevent base tag hijacking",
    });
    score -= 2;
  }

  // Check for form-action
  if (!directives['form-action']) {
    issues.push({
      severity: 'info',
      header: 'Content-Security-Policy',
      message: 'Missing form-action directive',
      recommendation: "Consider adding form-action to restrict form submissions",
    });
    score -= 1;
  }

  // Check for frame-ancestors
  if (!directives['frame-ancestors']) {
    issues.push({
      severity: 'warning',
      header: 'Content-Security-Policy',
      message: 'Missing frame-ancestors directive',
      recommendation: "Add frame-ancestors 'none' or 'self' for clickjacking protection",
    });
    score -= 2;
  }

  // Check for upgrade-insecure-requests in production
  if (isProd && !directives['upgrade-insecure-requests']) {
    issues.push({
      severity: 'info',
      header: 'Content-Security-Policy',
      message: 'upgrade-insecure-requests not enabled',
      recommendation: 'Enable upgrade-insecure-requests for HTTPS migration',
    });
    score -= 1;
  }

  // Bonus for strict-dynamic
  if (scriptSrc.includes("'strict-dynamic'")) {
    score = Math.min(score + 2, SCORE_WEIGHTS.csp);
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// HSTS Validation
// =============================================================================

/**
 * Validate HSTS configuration
 */
function validateHSTS(
  config: HSTSConfig,
  enabled: boolean,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = SCORE_WEIGHTS.hsts;

  if (!enabled) {
    if (isProd) {
      issues.push({
        severity: 'error',
        header: 'Strict-Transport-Security',
        message: 'HSTS is not enabled in production',
        recommendation: 'Enable HSTS with at least 1 year max-age',
      });
      return { issues, score: 0 };
    } else {
      issues.push({
        severity: 'info',
        header: 'Strict-Transport-Security',
        message: 'HSTS is not enabled',
        recommendation: 'Consider enabling HSTS',
      });
      return { issues, score: score - 5 };
    }
  }

  // Check max-age
  if (config.maxAge < HSTS_MIN_MAX_AGE_FOR_PRELOAD) {
    issues.push({
      severity: isProd ? 'warning' : 'info',
      header: 'Strict-Transport-Security',
      message: `max-age of ${config.maxAge} is below recommended ${HSTS_MIN_MAX_AGE_FOR_PRELOAD} (1 year)`,
      recommendation: `Increase max-age to at least ${HSTS_MIN_MAX_AGE_FOR_PRELOAD}`,
    });
    score -= 3;
  }

  if (config.maxAge < HSTS_RECOMMENDED_MAX_AGE) {
    score -= 2;
  }

  // Check includeSubDomains
  if (!config.includeSubDomains) {
    issues.push({
      severity: 'warning',
      header: 'Strict-Transport-Security',
      message: 'includeSubDomains is not enabled',
      recommendation: 'Enable includeSubDomains to protect all subdomains',
    });
    score -= 3;
  }

  // Check preload
  if (!config.preload) {
    issues.push({
      severity: 'info',
      header: 'Strict-Transport-Security',
      message: 'preload is not enabled',
      recommendation: 'Consider enabling preload and submitting to hstspreload.org',
    });
    score -= 2;
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// CORS Validation
// =============================================================================

/**
 * Validate CORS configuration
 */
function validateCORS(
  config: CORSConfig,
  enabled: boolean,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = SCORE_WEIGHTS.cors;

  if (!enabled) {
    // CORS not needed for all services
    return { issues, score };
  }

  // Check for wildcard origin
  if (config.allowedOrigins.includes('*')) {
    if (isProd) {
      issues.push({
        severity: 'error',
        header: 'CORS',
        message: 'Wildcard (*) origin is not allowed in production',
        recommendation: 'Specify explicit allowed origins',
      });
      score = 0;
    } else {
      issues.push({
        severity: 'warning',
        header: 'CORS',
        message: 'Wildcard (*) origin is insecure',
        recommendation: 'Specify explicit allowed origins',
      });
      score -= 10;
    }
  }

  // Check for credentials with wildcard
  if (config.credentials && config.allowedOrigins.includes('*')) {
    issues.push({
      severity: 'error',
      header: 'CORS',
      message: 'Cannot use credentials with wildcard origin',
      recommendation: 'Specify explicit origins when using credentials',
    });
    score -= 5;
  }

  // Check allowed methods
  const dangerousMethods = ['PUT', 'DELETE', 'PATCH'];
  const allowsDangerous = dangerousMethods.some((m) =>
    config.allowedMethods.includes(m)
  );
  if (allowsDangerous && config.allowedOrigins.includes('*')) {
    issues.push({
      severity: 'warning',
      header: 'CORS',
      message: 'Dangerous methods allowed with wildcard origin',
      recommendation: 'Restrict origins when allowing PUT/DELETE/PATCH',
    });
    score -= 3;
  }

  // Check max-age
  if (config.maxAge > 86400) {
    issues.push({
      severity: 'info',
      header: 'CORS',
      message: `CORS max-age of ${config.maxAge} is very long`,
      recommendation: 'Consider reducing max-age for faster policy updates',
    });
    score -= 1;
  }

  // Check private network access
  if (config.privateNetworkAccess && config.allowedOrigins.includes('*')) {
    issues.push({
      severity: 'error',
      header: 'CORS',
      message: 'Private network access should not be combined with wildcard origin',
      recommendation: 'Use explicit origins with private network access',
    });
    score -= 5;
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// Permissions Policy Validation
// =============================================================================

/**
 * Validate Permissions Policy configuration
 */
function validatePermissionsPolicy(
  config: PermissionsPolicyConfig,
  enabled: boolean,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = SCORE_WEIGHTS.permissionsPolicy;

  if (!enabled) {
    issues.push({
      severity: isProd ? 'warning' : 'info',
      header: 'Permissions-Policy',
      message: 'Permissions-Policy is not enabled',
      recommendation: 'Enable Permissions-Policy to control feature access',
    });
    return { issues, score: isProd ? 0 : score - 5 };
  }

  // Check for dangerous features
  const highRiskFeatures = ['camera', 'microphone', 'geolocation', 'usb', 'serial'];
  for (const feature of highRiskFeatures) {
    const value = config[feature as keyof PermissionsPolicyConfig];
    if (value && value !== '()') {
      issues.push({
        severity: isProd ? 'warning' : 'info',
        header: 'Permissions-Policy',
        message: `High-risk feature "${feature}" is enabled`,
        recommendation: `Consider disabling ${feature} unless needed`,
      });
      score -= 1;
    }
  }

  // Check for wildcard in high-risk features
  for (const feature of highRiskFeatures) {
    const value = config[feature as keyof PermissionsPolicyConfig];
    if (value === '*') {
      issues.push({
        severity: 'error',
        header: 'Permissions-Policy',
        message: `Wildcard permission for high-risk feature "${feature}"`,
        recommendation: `Restrict ${feature} to specific origins`,
      });
      score -= 3;
    }
  }

  // Check for interest-cohort opt-out
  if (!config['interest-cohort'] || config['interest-cohort'] !== '()') {
    issues.push({
      severity: 'info',
      header: 'Permissions-Policy',
      message: 'interest-cohort is not disabled',
      recommendation: 'Disable interest-cohort to opt out of FLoC/Topics',
    });
    score -= 1;
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// Cross-Origin Policies Validation
// =============================================================================

/**
 * Validate Cross-Origin policies (COEP, COOP, CORP)
 */
function validateCrossOriginPolicies(
  config: SecurityHeadersConfig,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = SCORE_WEIGHTS.crossOriginPolicies;

  // COEP
  if (!config.coep.enabled) {
    issues.push({
      severity: 'info',
      header: 'Cross-Origin-Embedder-Policy',
      message: 'COEP is not enabled',
      recommendation: 'Consider enabling COEP for cross-origin isolation',
    });
    score -= 2;
  } else if (config.coep.value === 'unsafe-none') {
    issues.push({
      severity: 'info',
      header: 'Cross-Origin-Embedder-Policy',
      message: "COEP is set to 'unsafe-none'",
      recommendation: "Use 'require-corp' or 'credentialless' for better isolation",
    });
    score -= 1;
  }

  // COOP
  if (!config.coop.enabled) {
    issues.push({
      severity: 'info',
      header: 'Cross-Origin-Opener-Policy',
      message: 'COOP is not enabled',
      recommendation: 'Consider enabling COOP for process isolation',
    });
    score -= 2;
  } else if (config.coop.value === 'unsafe-none') {
    issues.push({
      severity: 'info',
      header: 'Cross-Origin-Opener-Policy',
      message: "COOP is set to 'unsafe-none'",
      recommendation: "Use 'same-origin' or 'same-origin-allow-popups' for better isolation",
    });
    score -= 1;
  }

  // CORP
  if (!config.corp.enabled) {
    issues.push({
      severity: 'info',
      header: 'Cross-Origin-Resource-Policy',
      message: 'CORP is not enabled',
      recommendation: 'Consider enabling CORP to control resource loading',
    });
    score -= 2;
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// Other Headers Validation
// =============================================================================

/**
 * Validate other security headers
 */
function validateOtherHeaders(
  config: SecurityHeadersConfig,
  isProd: boolean
): { issues: ValidationIssue[]; score: number } {
  const issues: ValidationIssue[] = [];
  let score = 0;

  // X-Frame-Options
  if (!config.xFrameOptions.enabled) {
    issues.push({
      severity: isProd ? 'warning' : 'info',
      header: 'X-Frame-Options',
      message: 'X-Frame-Options is not enabled',
      recommendation: "Enable X-Frame-Options as fallback for CSP frame-ancestors",
    });
  } else {
    score += SCORE_WEIGHTS.xFrameOptions;
    if (config.xFrameOptions.value !== 'DENY') {
      score -= 2;
    }
  }

  // X-Content-Type-Options
  if (!config.xContentTypeOptions.enabled) {
    issues.push({
      severity: isProd ? 'warning' : 'info',
      header: 'X-Content-Type-Options',
      message: 'X-Content-Type-Options is not enabled',
      recommendation: 'Enable X-Content-Type-Options: nosniff',
    });
  } else {
    score += SCORE_WEIGHTS.xContentTypeOptions;
  }

  // Referrer-Policy
  if (!config.referrerPolicy.enabled) {
    issues.push({
      severity: isProd ? 'warning' : 'info',
      header: 'Referrer-Policy',
      message: 'Referrer-Policy is not enabled',
      recommendation: 'Enable Referrer-Policy to control referrer information',
    });
  } else {
    score += SCORE_WEIGHTS.referrerPolicy;
    const weakPolicies = ['unsafe-url', 'no-referrer-when-downgrade'];
    if (weakPolicies.includes(config.referrerPolicy.value)) {
      issues.push({
        severity: 'warning',
        header: 'Referrer-Policy',
        message: `Referrer-Policy '${config.referrerPolicy.value}' may leak sensitive URLs`,
        recommendation: "Use 'strict-origin-when-cross-origin' or stricter",
      });
      score -= 3;
    }
  }

  return { issues, score: Math.max(0, score) };
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Calculate grade from score
 */
function calculateGrade(score: number, maxScore: number): HeaderValidationResult['grade'] {
  const percentage = (score / maxScore) * 100;

  if (percentage >= 95) return 'A+';
  if (percentage >= 85) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 55) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

/**
 * Validate a complete security headers configuration
 *
 * @param config - The security headers configuration to validate
 * @returns Validation result with score, grade, and issues
 */
export function validateSecurityHeaders(
  config: SecurityHeadersConfig
): HeaderValidationResult {
  const isProd = config.mode === 'production' || isProductionGrade();
  const allIssues: ValidationIssue[] = [];
  let totalScore = 0;

  // Validate CSP
  if (config.csp.enabled) {
    const { issues, score } = validateCSP(config.csp.directives, isProd);
    allIssues.push(...issues);
    totalScore += score;
  } else {
    allIssues.push({
      severity: isProd ? 'error' : 'warning',
      header: 'Content-Security-Policy',
      message: 'CSP is not enabled',
      recommendation: 'Enable CSP with a strict policy',
    });
  }

  // Validate HSTS
  const hstsResult = validateHSTS(config.hsts.config, config.hsts.enabled, isProd);
  allIssues.push(...hstsResult.issues);
  totalScore += hstsResult.score;

  // Validate CORS
  const corsResult = validateCORS(config.cors.config, config.cors.enabled, isProd);
  allIssues.push(...corsResult.issues);
  totalScore += corsResult.score;

  // Validate Permissions Policy
  const ppResult = validatePermissionsPolicy(
    config.permissionsPolicy.config,
    config.permissionsPolicy.enabled,
    isProd
  );
  allIssues.push(...ppResult.issues);
  totalScore += ppResult.score;

  // Validate Cross-Origin policies
  const coResult = validateCrossOriginPolicies(config, isProd);
  allIssues.push(...coResult.issues);
  totalScore += coResult.score;

  // Validate other headers
  const otherResult = validateOtherHeaders(config, isProd);
  allIssues.push(...otherResult.issues);
  totalScore += otherResult.score;

  // Calculate summary
  const summary = {
    errors: allIssues.filter((i) => i.severity === 'error').length,
    warnings: allIssues.filter((i) => i.severity === 'warning').length,
    info: allIssues.filter((i) => i.severity === 'info').length,
  };

  // Determine validity
  const valid = summary.errors === 0;

  // Calculate grade
  const grade = calculateGrade(totalScore, MAX_SCORE);

  // Log validation result
  logger.info(
    {
      score: totalScore,
      maxScore: MAX_SCORE,
      grade,
      errors: summary.errors,
      warnings: summary.warnings,
      valid,
    },
    'Security headers validation completed'
  );

  return {
    valid,
    score: totalScore,
    maxScore: MAX_SCORE,
    grade,
    issues: allIssues,
    summary,
  };
}

/**
 * Assert that a security headers configuration is valid for production
 *
 * @param config - The configuration to validate
 * @throws Error if validation fails
 */
export function assertValidSecurityHeaders(config: SecurityHeadersConfig): void {
  const result = validateSecurityHeaders(config);

  if (!result.valid) {
    const errors = result.issues.filter((i) => i.severity === 'error');
    throw new Error(
      `Security headers validation failed:\n${errors.map((e) => `  - ${e.header}: ${e.message}`).join('\n')}`
    );
  }

  // Additional check for production grade
  if (isProductionGrade() && result.grade === 'F') {
    throw new Error(
      `Security headers configuration received grade F, which is not acceptable for production`
    );
  }
}

/**
 * Get a summary of the security headers configuration
 */
export function getSecurityHeadersSummary(config: SecurityHeadersConfig): {
  cspEnabled: boolean;
  hstsEnabled: boolean;
  corsEnabled: boolean;
  permissionsPolicyEnabled: boolean;
  crossOriginPoliciesEnabled: boolean;
  grade: string;
  score: number;
} {
  const result = validateSecurityHeaders(config);

  return {
    cspEnabled: config.csp.enabled,
    hstsEnabled: config.hsts.enabled,
    corsEnabled: config.cors.enabled,
    permissionsPolicyEnabled: config.permissionsPolicy.enabled,
    crossOriginPoliciesEnabled: config.coep.enabled && config.coop.enabled,
    grade: result.grade,
    score: result.score,
  };
}
