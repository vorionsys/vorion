/**
 * Versioning Module
 *
 * Provides semantic versioning utilities, deprecation tracking,
 * and compatibility checking for the Vorion platform.
 *
 * @packageDocumentation
 */

// Platform version
export const PLATFORM_VERSION = '0.1.0';

// SemVer utilities
export {
  type Version,
  type VersionRange,
  SEMVER_REGEX,
  parseVersion,
  tryParseVersion,
  isValidVersion,
  formatVersion,
  compareVersions,
  eq,
  gt,
  lt,
  gte,
  lte,
  satisfies,
  isCompatible,
  isApproximatelyEqual,
  increment,
  maxVersion,
  minVersion,
  sortVersions,
} from './semver.js';

// Deprecation tracking
export {
  type Deprecation,
  type DeprecationRegistry,
  createDeprecationRegistry,
  getDeprecationRegistry,
  deprecated,
  VORION_DEPRECATIONS,
  initDeprecations,
  checkApiCompatibility,
} from './deprecation.js';

// ============================================================================
// API Version Constants
// ============================================================================

/** Current API version */
export const API_VERSION = 'v1';

/** Supported API versions */
export const SUPPORTED_API_VERSIONS = ['v1'] as const;

/** Minimum SDK version for current API */
export const MIN_SDK_VERSION = '0.1.0';

/** Maximum SDK version for current API */
export const MAX_SDK_VERSION = '0.99.99';

// ============================================================================
// Protocol Version Constants
// ============================================================================

/** A2A protocol version */
export const A2A_PROTOCOL_VERSION = '1.0';

/** Supported A2A protocol versions */
export const SUPPORTED_A2A_VERSIONS = ['1.0'] as const;

// ============================================================================
// Schema Version Constants
// ============================================================================

/** Current schema version */
export const SCHEMA_VERSION = '4';

/** ADL (Agent Definition Language) version */
export const ADL_VERSION = '1.0';

// ============================================================================
// Compatibility Utilities
// ============================================================================

import { parseVersion, gte, lte, type Version } from './semver.js';

/**
 * Check if an SDK version is compatible with the current API
 */
export function isSDKVersionCompatible(sdkVersion: string): boolean {
  try {
    const version = parseVersion(sdkVersion);
    const min = parseVersion(MIN_SDK_VERSION);
    const max = parseVersion(MAX_SDK_VERSION);

    return gte(version, min) && lte(version, max);
  } catch {
    return false;
  }
}

/**
 * Check if an A2A protocol version is supported
 */
export function isA2AVersionSupported(protocolVersion: string): boolean {
  return SUPPORTED_A2A_VERSIONS.includes(protocolVersion as any);
}

/**
 * Get version info for health/status endpoints
 */
export function getVersionInfo(): {
  platform: string;
  api: string;
  a2a: string;
  schema: string;
  adl: string;
} {
  return {
    platform: PLATFORM_VERSION,
    api: API_VERSION,
    a2a: A2A_PROTOCOL_VERSION,
    schema: SCHEMA_VERSION,
    adl: ADL_VERSION,
  };
}
