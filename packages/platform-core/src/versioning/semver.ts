/**
 * Semantic Versioning Utilities
 *
 * Provides parsing, comparison, and range matching for SemVer versions.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export interface Version {
  /** Major version (breaking changes) */
  major: number;
  /** Minor version (features) */
  minor: number;
  /** Patch version (fixes) */
  patch: number;
  /** Pre-release identifier */
  prerelease?: string;
  /** Build metadata */
  build?: string;
}

export interface VersionRange {
  /** Minimum version (inclusive) */
  min?: Version;
  /** Maximum version (exclusive) */
  max?: Version;
  /** Allow pre-release versions */
  includePrerelease?: boolean;
}

// ============================================================================
// Regular Expressions
// ============================================================================

/**
 * SemVer regex pattern
 * Matches: 1.0.0, 1.0.0-beta.1, 1.0.0+build.123, 1.0.0-beta.1+build.123
 */
export const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Range operators regex
 */
const RANGE_REGEX = /^(>=?|<=?|=|\^|~)?(.+)$/;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a version string into components
 */
export function parseVersion(version: string): Version {
  const match = version.trim().match(SEMVER_REGEX);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    build: match[5],
  };
}

/**
 * Try to parse a version, returning null on failure
 */
export function tryParseVersion(version: string): Version | null {
  try {
    return parseVersion(version);
  } catch {
    return null;
  }
}

/**
 * Check if a string is a valid version
 */
export function isValidVersion(version: string): boolean {
  return SEMVER_REGEX.test(version.trim());
}

/**
 * Format a version object as a string
 */
export function formatVersion(version: Version): string {
  let result = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease) {
    result += `-${version.prerelease}`;
  }
  if (version.build) {
    result += `+${version.build}`;
  }
  return result;
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare two versions
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  // Compare major.minor.patch
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  // Pre-release versions have lower precedence than normal versions
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return comparePrereleases(a.prerelease, b.prerelease);
  }

  return 0;
}

/**
 * Compare pre-release identifiers
 */
function comparePrereleases(a: string, b: string): -1 | 0 | 1 {
  const aParts = a.split('.');
  const bParts = b.split('.');

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (i >= aParts.length) return -1;
    if (i >= bParts.length) return 1;

    const aNum = parseInt(aParts[i], 10);
    const bNum = parseInt(bParts[i], 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1;
    } else if (!isNaN(aNum)) {
      return -1; // Numeric < alphabetic
    } else if (!isNaN(bNum)) {
      return 1;
    } else {
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Check if version a equals version b
 */
export function eq(a: Version | string, b: Version | string): boolean {
  const vA = typeof a === 'string' ? parseVersion(a) : a;
  const vB = typeof b === 'string' ? parseVersion(b) : b;
  return compareVersions(vA, vB) === 0;
}

/**
 * Check if version a is greater than version b
 */
export function gt(a: Version | string, b: Version | string): boolean {
  const vA = typeof a === 'string' ? parseVersion(a) : a;
  const vB = typeof b === 'string' ? parseVersion(b) : b;
  return compareVersions(vA, vB) === 1;
}

/**
 * Check if version a is less than version b
 */
export function lt(a: Version | string, b: Version | string): boolean {
  const vA = typeof a === 'string' ? parseVersion(a) : a;
  const vB = typeof b === 'string' ? parseVersion(b) : b;
  return compareVersions(vA, vB) === -1;
}

/**
 * Check if version a is greater than or equal to version b
 */
export function gte(a: Version | string, b: Version | string): boolean {
  return !lt(a, b);
}

/**
 * Check if version a is less than or equal to version b
 */
export function lte(a: Version | string, b: Version | string): boolean {
  return !gt(a, b);
}

// ============================================================================
// Range Matching
// ============================================================================

/**
 * Check if a version satisfies a range expression
 *
 * Supported expressions:
 * - `1.0.0` - Exact match
 * - `>1.0.0` - Greater than
 * - `>=1.0.0` - Greater than or equal
 * - `<1.0.0` - Less than
 * - `<=1.0.0` - Less than or equal
 * - `^1.0.0` - Compatible (same major, >= version)
 * - `~1.0.0` - Approximately (same major.minor, >= version)
 * - `1.x` or `1.x.x` - Any minor/patch
 * - `>=1.0.0 <2.0.0` - Range (space-separated AND)
 * - `1.0.0 || 2.0.0` - OR conditions
 */
export function satisfies(version: Version | string, range: string): boolean {
  const v = typeof version === 'string' ? parseVersion(version) : version;

  // Handle OR conditions
  if (range.includes('||')) {
    return range.split('||').some((part) => satisfies(v, part.trim()));
  }

  // Handle AND conditions (space-separated)
  const conditions = range.trim().split(/\s+/);
  return conditions.every((condition) => satisfiesCondition(v, condition));
}

/**
 * Check if version satisfies a single condition
 */
function satisfiesCondition(version: Version, condition: string): boolean {
  // Handle wildcard patterns (1.x, 1.x.x, 1.2.x)
  if (condition.includes('x') || condition.includes('*')) {
    return satisfiesWildcard(version, condition);
  }

  // Parse operator and version
  const match = condition.match(RANGE_REGEX);
  if (!match) {
    throw new Error(`Invalid range condition: ${condition}`);
  }

  const operator = match[1] || '=';
  const target = parseVersion(match[2]);

  switch (operator) {
    case '=':
    case '':
      return eq(version, target);
    case '>':
      return gt(version, target);
    case '>=':
      return gte(version, target);
    case '<':
      return lt(version, target);
    case '<=':
      return lte(version, target);
    case '^':
      return isCompatible(version, target);
    case '~':
      return isApproximatelyEqual(version, target);
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

/**
 * Check if version matches a wildcard pattern
 */
function satisfiesWildcard(version: Version, pattern: string): boolean {
  const parts = pattern.split('.');
  const major = parts[0];
  const minor = parts[1];
  const patch = parts[2];

  if (major !== 'x' && major !== '*' && version.major !== parseInt(major, 10)) {
    return false;
  }
  if (minor && minor !== 'x' && minor !== '*' && version.minor !== parseInt(minor, 10)) {
    return false;
  }
  if (patch && patch !== 'x' && patch !== '*' && version.patch !== parseInt(patch, 10)) {
    return false;
  }

  return true;
}

/**
 * Check caret (^) compatibility
 * Same major version, >= specified version
 */
export function isCompatible(actual: Version, required: Version): boolean {
  if (actual.major !== required.major) return false;
  return gte(actual, required);
}

/**
 * Check tilde (~) compatibility
 * Same major.minor, >= specified version
 */
export function isApproximatelyEqual(actual: Version, required: Version): boolean {
  if (actual.major !== required.major) return false;
  if (actual.minor !== required.minor) return false;
  return gte(actual, required);
}

// ============================================================================
// Version Manipulation
// ============================================================================

/**
 * Increment version
 */
export function increment(
  version: Version,
  type: 'major' | 'minor' | 'patch' | 'prerelease'
): Version {
  switch (type) {
    case 'major':
      return { major: version.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case 'patch':
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
    case 'prerelease':
      if (version.prerelease) {
        const parts = version.prerelease.split('.');
        const lastPart = parts[parts.length - 1];
        const num = parseInt(lastPart, 10);
        if (!isNaN(num)) {
          parts[parts.length - 1] = String(num + 1);
        } else {
          parts.push('1');
        }
        return { ...version, prerelease: parts.join('.') };
      }
      return { ...version, prerelease: '0' };
  }
}

/**
 * Find the maximum version in an array
 */
export function maxVersion(versions: (Version | string)[]): Version | null {
  if (versions.length === 0) return null;

  return versions.reduce<Version>((max, v) => {
    const version = typeof v === 'string' ? parseVersion(v) : v;
    return gt(version, max) ? version : max;
  }, typeof versions[0] === 'string' ? parseVersion(versions[0]) : versions[0]);
}

/**
 * Find the minimum version in an array
 */
export function minVersion(versions: (Version | string)[]): Version | null {
  if (versions.length === 0) return null;

  return versions.reduce<Version>((min, v) => {
    const version = typeof v === 'string' ? parseVersion(v) : v;
    return lt(version, min) ? version : min;
  }, typeof versions[0] === 'string' ? parseVersion(versions[0]) : versions[0]);
}

/**
 * Sort versions (ascending)
 */
export function sortVersions(versions: Version[]): Version[] {
  return [...versions].sort(compareVersions);
}
