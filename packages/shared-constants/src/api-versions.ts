/**
 * @vorionsys/shared-constants - API Versions
 *
 * Centralized API version management across all services
 * Ensures consistent versioning strategy
 *
 * @see https://cognigate.dev/docs/versioning
 */

// =============================================================================
// VERSION STATUS
// =============================================================================

export enum VersionStatus {
  /** Currently in development, not available */
  DEVELOPMENT = 'development',

  /** Available as preview/beta */
  PREVIEW = 'preview',

  /** Stable and recommended */
  STABLE = 'stable',

  /** Still supported but deprecated */
  DEPRECATED = 'deprecated',

  /** No longer supported */
  RETIRED = 'retired',
}

// =============================================================================
// API VERSION DEFINITIONS
// =============================================================================

export interface ApiVersionDefinition {
  /** Version identifier (e.g., "v1") */
  version: string;

  /** Full version number (e.g., "1.0.0") */
  fullVersion: string;

  /** Release date */
  releaseDate: string;

  /** End of support date (if deprecated/retired) */
  endOfLife?: string;

  /** Current status */
  status: VersionStatus;

  /** Changelog URL */
  changelogUrl?: string;

  /** Migration guide URL (if deprecated) */
  migrationUrl?: string;
}

// =============================================================================
// COGNIGATE API VERSIONS
// =============================================================================

export const COGNIGATE_VERSIONS: Record<string, ApiVersionDefinition> = {
  v1: {
    version: 'v1',
    fullVersion: '1.0.0',
    releaseDate: '2026-02-01',
    status: VersionStatus.STABLE,
    changelogUrl: 'https://cognigate.dev/changelog/v1',
  },
} as const;

export const COGNIGATE_CURRENT_VERSION = 'v1';
export const COGNIGATE_DEFAULT_VERSION = 'v1';

// =============================================================================
// VORION TRUST API VERSIONS
// =============================================================================

export const TRUST_API_VERSIONS: Record<string, ApiVersionDefinition> = {
  v1: {
    version: 'v1',
    fullVersion: '1.0.0',
    releaseDate: '2026-02-01',
    status: VersionStatus.STABLE,
    changelogUrl: 'https://trust.vorion.org/changelog/v1',
  },
} as const;

export const TRUST_CURRENT_VERSION = 'v1';

// =============================================================================
// VORION LOGIC API VERSIONS
// =============================================================================

export const LOGIC_API_VERSIONS: Record<string, ApiVersionDefinition> = {
  v1: {
    version: 'v1',
    fullVersion: '1.0.0',
    releaseDate: '2026-02-01',
    status: VersionStatus.PREVIEW,
    changelogUrl: 'https://logic.vorion.org/changelog/v1',
  },
} as const;

export const LOGIC_CURRENT_VERSION = 'v1';

// =============================================================================
// BASIS SPEC VERSIONS
// =============================================================================

export const BASIS_VERSIONS: Record<string, ApiVersionDefinition> = {
  v1: {
    version: 'v1',
    fullVersion: '1.0.0',
    releaseDate: '2026-02-01',
    status: VersionStatus.STABLE,
    changelogUrl: 'https://basis.vorion.org/changelog',
  },
} as const;

export const BASIS_CURRENT_VERSION = 'v1';
export const BASIS_SPEC_VERSION = '1.0.0';

// =============================================================================
// CAR SPEC VERSIONS
// =============================================================================

export const CAR_SPEC_VERSIONS: Record<string, ApiVersionDefinition> = {
  v1: {
    version: 'v1',
    fullVersion: '1.0.0',
    releaseDate: '2026-02-01',
    status: VersionStatus.STABLE,
    changelogUrl: 'https://carid.vorion.org/changelog',
  },
} as const;

export const CAR_SPEC_CURRENT_VERSION = 'v1';

// =============================================================================
// ALL API VERSIONS
// =============================================================================

export const API_VERSIONS = {
  cognigate: COGNIGATE_VERSIONS,
  trust: TRUST_API_VERSIONS,
  logic: LOGIC_API_VERSIONS,
  basis: BASIS_VERSIONS,
  carSpec: CAR_SPEC_VERSIONS,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the current stable version for a service
 */
export function getCurrentVersion(
  service: 'cognigate' | 'trust' | 'logic' | 'basis' | 'carSpec',
): string {
  switch (service) {
    case 'cognigate':
      return COGNIGATE_CURRENT_VERSION;
    case 'trust':
      return TRUST_CURRENT_VERSION;
    case 'logic':
      return LOGIC_CURRENT_VERSION;
    case 'basis':
      return BASIS_CURRENT_VERSION;
    case 'carSpec':
      return CAR_SPEC_CURRENT_VERSION;
  }
}

/**
 * Get version definition
 */
export function getVersionDefinition(
  service: 'cognigate' | 'trust' | 'logic' | 'basis' | 'carSpec',
  version: string,
): ApiVersionDefinition | undefined {
  return API_VERSIONS[service][version];
}

/**
 * Check if a version is still supported
 */
export function isVersionSupported(
  service: 'cognigate' | 'trust' | 'logic' | 'basis' | 'carSpec',
  version: string,
): boolean {
  const def = getVersionDefinition(service, version);
  if (!def) return false;
  return def.status !== VersionStatus.RETIRED;
}

/**
 * Check if a version is deprecated
 */
export function isVersionDeprecated(
  service: 'cognigate' | 'trust' | 'logic' | 'basis' | 'carSpec',
  version: string,
): boolean {
  const def = getVersionDefinition(service, version);
  if (!def) return false;
  return def.status === VersionStatus.DEPRECATED;
}

/**
 * Get all stable versions for a service
 */
export function getStableVersions(
  service: 'cognigate' | 'trust' | 'logic' | 'basis' | 'carSpec',
): ApiVersionDefinition[] {
  return Object.values(API_VERSIONS[service]).filter(
    v => v.status === VersionStatus.STABLE,
  );
}

/**
 * Build versioned API URL
 */
export function buildApiUrl(
  baseUrl: string,
  version: string,
  path: string,
): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${cleanBase}/${version}/${cleanPath}`;
}

// =============================================================================
// HTTP HEADERS
// =============================================================================

export const VERSION_HEADERS = {
  /** Header to request specific API version */
  REQUEST_VERSION: 'X-API-Version',

  /** Header indicating actual API version used */
  RESPONSE_VERSION: 'X-API-Version',

  /** Header warning about deprecation */
  DEPRECATION_WARNING: 'X-Deprecation-Warning',

  /** Header with sunset date */
  SUNSET: 'Sunset',
} as const;
