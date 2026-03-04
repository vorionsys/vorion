/**
 * Permissions Policy Manager
 *
 * Manages Permissions-Policy header configuration for controlling
 * browser feature access (camera, microphone, geolocation, etc.).
 *
 * @packageDocumentation
 * @module security/headers/permissions-policy
 */

import { createLogger } from '../../common/logger.js';
import { isProductionGrade } from '../../common/security-mode.js';
import type { PermissionsPolicyConfig, PermissionsPolicyValue } from './types.js';

const logger = createLogger({ component: 'permissions-policy' });

// =============================================================================
// Constants
// =============================================================================

/**
 * Permissions-Policy header name
 */
export const PERMISSIONS_POLICY_HEADER = 'Permissions-Policy';

/**
 * All known permission policy features
 */
export const KNOWN_FEATURES = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'battery',
  'camera',
  'display-capture',
  'document-domain',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'speaker-selection',
  'storage-access',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
  'interest-cohort',
] as const;

/**
 * High-risk features that should be disabled by default
 */
export const HIGH_RISK_FEATURES = [
  'camera',
  'microphone',
  'geolocation',
  'display-capture',
  'serial',
  'usb',
  'hid',
  'bluetooth',
  'idle-detection',
] as const;

/**
 * Sensor-related features
 */
export const SENSOR_FEATURES = [
  'accelerometer',
  'ambient-light-sensor',
  'gyroscope',
  'magnetometer',
] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Feature permission level
 */
export type FeaturePermission = 'all' | 'self' | 'none' | string[];

/**
 * Permissions Policy validation issue
 */
export interface PermissionsPolicyIssue {
  severity: 'error' | 'warning' | 'info';
  feature: string;
  message: string;
  recommendation?: string;
}

/**
 * Validation result
 */
export interface PermissionsPolicyValidationResult {
  valid: boolean;
  issues: PermissionsPolicyIssue[];
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Strict preset - Disable all powerful features
 *
 * Suitable for API servers and applications that don't need
 * browser features.
 */
export const STRICT_PERMISSIONS_PRESET: PermissionsPolicyConfig = {
  accelerometer: '()',
  'ambient-light-sensor': '()',
  autoplay: '()',
  battery: '()',
  camera: '()',
  'display-capture': '()',
  'document-domain': '()',
  fullscreen: '()',
  gamepad: '()',
  geolocation: '()',
  gyroscope: '()',
  hid: '()',
  'identity-credentials-get': '()',
  'idle-detection': '()',
  magnetometer: '()',
  microphone: '()',
  midi: '()',
  payment: '()',
  'picture-in-picture': '()',
  'publickey-credentials-create': '(self)',
  'publickey-credentials-get': '(self)',
  serial: '()',
  usb: '()',
  'xr-spatial-tracking': '()',
  'interest-cohort': '()',
};

/**
 * Moderate preset - Allow self-origin for safe features
 *
 * Suitable for web applications that need some browser features.
 */
export const MODERATE_PERMISSIONS_PRESET: PermissionsPolicyConfig = {
  accelerometer: '()',
  'ambient-light-sensor': '()',
  autoplay: '(self)',
  battery: '()',
  camera: '()',
  'display-capture': '()',
  'document-domain': '()',
  fullscreen: '(self)',
  gamepad: '(self)',
  geolocation: '()',
  gyroscope: '()',
  hid: '()',
  magnetometer: '()',
  microphone: '()',
  midi: '(self)',
  payment: '(self)',
  'picture-in-picture': '(self)',
  'publickey-credentials-create': '(self)',
  'publickey-credentials-get': '(self)',
  serial: '()',
  usb: '()',
  'xr-spatial-tracking': '()',
  'interest-cohort': '()',
};

/**
 * API preset - Minimal permissions for API-only services
 *
 * Disables all features since APIs don't serve HTML.
 */
export const API_PERMISSIONS_PRESET: PermissionsPolicyConfig = {
  accelerometer: '()',
  'ambient-light-sensor': '()',
  autoplay: '()',
  battery: '()',
  camera: '()',
  'display-capture': '()',
  'document-domain': '()',
  fullscreen: '()',
  gamepad: '()',
  geolocation: '()',
  gyroscope: '()',
  hid: '()',
  magnetometer: '()',
  microphone: '()',
  midi: '()',
  payment: '()',
  'picture-in-picture': '()',
  'publickey-credentials-create': '()',
  'publickey-credentials-get': '()',
  serial: '()',
  usb: '()',
  'xr-spatial-tracking': '()',
  'interest-cohort': '()',
};

// =============================================================================
// Permissions Policy Manager Class
// =============================================================================

/**
 * Permissions Policy Manager
 *
 * @example
 * ```typescript
 * const policy = new PermissionsPolicyManager()
 *   .preset('strict')
 *   .allow('fullscreen', 'self')
 *   .allow('payment', 'self')
 *   .deny('geolocation')
 *   .build();
 *
 * res.setHeader('Permissions-Policy', policy);
 * ```
 */
export class PermissionsPolicyManager {
  private features: Map<string, PermissionsPolicyValue> = new Map();

  /**
   * Start from a preset
   */
  preset(name: 'strict' | 'moderate' | 'api'): this {
    let presetConfig: PermissionsPolicyConfig;

    switch (name) {
      case 'strict':
        presetConfig = STRICT_PERMISSIONS_PRESET;
        break;
      case 'moderate':
        presetConfig = MODERATE_PERMISSIONS_PRESET;
        break;
      case 'api':
        presetConfig = API_PERMISSIONS_PRESET;
        break;
      default:
        presetConfig = STRICT_PERMISSIONS_PRESET;
    }

    for (const [feature, value] of Object.entries(presetConfig)) {
      if (value !== undefined) {
        this.features.set(feature, value);
      }
    }

    return this;
  }

  /**
   * Allow a feature for specific origins
   *
   * @param feature - The feature name
   * @param permission - 'self', 'all', 'none', or array of origins
   */
  allow(feature: string, permission: FeaturePermission): this {
    const value = this.formatPermission(permission);
    this.features.set(feature, value);
    return this;
  }

  /**
   * Deny a feature completely
   */
  deny(feature: string): this {
    this.features.set(feature, '()');
    return this;
  }

  /**
   * Allow a feature for self only
   */
  allowSelf(feature: string): this {
    this.features.set(feature, '(self)');
    return this;
  }

  /**
   * Allow a feature for all origins
   *
   * WARNING: This is generally not recommended for sensitive features!
   */
  allowAll(feature: string): this {
    this.features.set(feature, '*');
    return this;
  }

  /**
   * Allow a feature for specific origins
   */
  allowOrigins(feature: string, origins: string[]): this {
    const formatted = origins.map((o) => `"${o}"`).join(' ');
    this.features.set(feature, `(${formatted})`);
    return this;
  }

  /**
   * Allow a feature for self and specific origins
   */
  allowSelfAndOrigins(feature: string, origins: string[]): this {
    const formatted = origins.map((o) => `"${o}"`).join(' ');
    this.features.set(feature, `(self ${formatted})`);
    return this;
  }

  /**
   * Disable all sensor-related features
   */
  disableSensors(): this {
    for (const feature of SENSOR_FEATURES) {
      this.features.set(feature, '()');
    }
    return this;
  }

  /**
   * Disable all high-risk features
   */
  disableHighRisk(): this {
    for (const feature of HIGH_RISK_FEATURES) {
      this.features.set(feature, '()');
    }
    return this;
  }

  /**
   * Opt out of FLoC/Topics (interest-cohort)
   */
  disableInterestCohort(): this {
    this.features.set('interest-cohort', '()');
    return this;
  }

  /**
   * Apply a configuration object
   */
  fromConfig(config: PermissionsPolicyConfig): this {
    for (const [feature, value] of Object.entries(config)) {
      if (value !== undefined) {
        this.features.set(feature, value);
      }
    }
    return this;
  }

  /**
   * Remove a feature from the policy
   */
  remove(feature: string): this {
    this.features.delete(feature);
    return this;
  }

  /**
   * Clear all features
   */
  clear(): this {
    this.features.clear();
    return this;
  }

  /**
   * Validate the policy configuration
   */
  validate(): PermissionsPolicyValidationResult {
    const issues: PermissionsPolicyIssue[] = [];
    const isProd = isProductionGrade();

    // Check for unknown features
    for (const feature of Array.from(this.features.keys())) {
      if (!KNOWN_FEATURES.includes(feature as typeof KNOWN_FEATURES[number])) {
        issues.push({
          severity: 'warning',
          feature,
          message: `Unknown feature: ${feature}`,
          recommendation: 'Verify the feature name is correct',
        });
      }
    }

    // Check for high-risk features allowed in production
    if (isProd) {
      for (const feature of HIGH_RISK_FEATURES) {
        const value = this.features.get(feature);
        if (value && value !== '()') {
          issues.push({
            severity: 'warning',
            feature,
            message: `High-risk feature "${feature}" is enabled in production`,
            recommendation: `Consider disabling ${feature} or restricting to specific origins`,
          });
        }
      }
    }

    // Check for wildcard permissions on sensitive features
    for (const feature of HIGH_RISK_FEATURES) {
      const value = this.features.get(feature);
      if (value === '*') {
        issues.push({
          severity: isProd ? 'error' : 'warning',
          feature,
          message: `Wildcard (*) permission for high-risk feature "${feature}"`,
          recommendation: `Restrict ${feature} to specific origins or 'self'`,
        });
      }
    }

    // Check for interest-cohort opt-out
    const interestCohort = this.features.get('interest-cohort');
    if (!interestCohort || interestCohort !== '()') {
      issues.push({
        severity: 'info',
        feature: 'interest-cohort',
        message: 'interest-cohort is not explicitly disabled',
        recommendation: "Add interest-cohort=() to opt out of FLoC/Topics",
      });
    }

    const hasErrors = issues.some((i) => i.severity === 'error');
    return { valid: !hasErrors, issues };
  }

  /**
   * Build the Permissions-Policy header value
   */
  build(): string {
    // Validate in production
    const validation = this.validate();
    if (isProductionGrade() && !validation.valid) {
      const errors = validation.issues.filter((i) => i.severity === 'error');
      throw new Error(
        `Permissions-Policy validation failed: ${errors.map((e) => e.message).join('; ')}`
      );
    }

    // Log warnings
    const warnings = validation.issues.filter((i) => i.severity === 'warning');
    if (warnings.length > 0) {
      logger.warn({ warnings }, 'Permissions-Policy built with warnings');
    }

    const parts: string[] = [];

    for (const [feature, value] of Array.from(this.features.entries())) {
      parts.push(`${feature}=${value}`);
    }

    return parts.join(', ');
  }

  /**
   * Get the current configuration as an object
   */
  toConfig(): PermissionsPolicyConfig {
    const config: PermissionsPolicyConfig = {};
    for (const [feature, value] of Array.from(this.features.entries())) {
      (config as Record<string, PermissionsPolicyValue>)[feature] = value;
    }
    return config;
  }

  /**
   * Format a permission value to the correct syntax
   */
  private formatPermission(permission: FeaturePermission): PermissionsPolicyValue {
    if (permission === 'all') {
      return '*';
    }
    if (permission === 'self') {
      return '(self)';
    }
    if (permission === 'none') {
      return '()';
    }
    if (Array.isArray(permission)) {
      if (permission.length === 0) {
        return '()';
      }
      const origins = permission.map((o) => `"${o}"`).join(' ');
      return `(${origins})`;
    }
    return permission;
  }

  /**
   * Clone the manager
   */
  clone(): PermissionsPolicyManager {
    const clone = new PermissionsPolicyManager();
    clone.features = new Map(this.features);
    return clone;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a strict permissions policy (disable all sensitive features)
 */
export function createStrictPermissionsPolicy(): PermissionsPolicyManager {
  return new PermissionsPolicyManager().preset('strict');
}

/**
 * Create a moderate permissions policy
 */
export function createModeratePermissionsPolicy(): PermissionsPolicyManager {
  return new PermissionsPolicyManager().preset('moderate');
}

/**
 * Create an API permissions policy (disable everything)
 */
export function createAPIPermissionsPolicy(): PermissionsPolicyManager {
  return new PermissionsPolicyManager().preset('api');
}

/**
 * Create a permissions policy from configuration
 */
export function createPermissionsPolicy(
  config: PermissionsPolicyConfig
): PermissionsPolicyManager {
  return new PermissionsPolicyManager().fromConfig(config);
}

/**
 * Build a Permissions-Policy header directly from configuration
 */
export function buildPermissionsPolicyHeader(config: PermissionsPolicyConfig): string {
  return new PermissionsPolicyManager().fromConfig(config).build();
}

/**
 * Parse a Permissions-Policy header value
 */
export function parsePermissionsPolicyHeader(header: string): PermissionsPolicyConfig {
  const config: PermissionsPolicyConfig = {};
  const parts = header.split(',').map((p) => p.trim());

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;

    const feature = part.substring(0, eqIndex).trim();
    const value = part.substring(eqIndex + 1).trim();

    (config as Record<string, string>)[feature] = value;
  }

  return config;
}

/**
 * Get the secure default for a specific feature
 */
export function getSecureDefault(feature: string): PermissionsPolicyValue {
  // High-risk features should be disabled by default
  if (HIGH_RISK_FEATURES.includes(feature as typeof HIGH_RISK_FEATURES[number])) {
    return '()';
  }

  // Sensor features should be disabled by default
  if (SENSOR_FEATURES.includes(feature as typeof SENSOR_FEATURES[number])) {
    return '()';
  }

  // WebAuthn features allow self
  if (feature === 'publickey-credentials-create' || feature === 'publickey-credentials-get') {
    return '(self)';
  }

  // Everything else is disabled by default
  return '()';
}
