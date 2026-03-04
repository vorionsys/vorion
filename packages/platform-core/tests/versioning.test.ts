import { describe, it, expect } from 'vitest';
import {
  PLATFORM_VERSION,
  API_VERSION,
  SUPPORTED_API_VERSIONS,
  MIN_SDK_VERSION,
  MAX_SDK_VERSION,
  A2A_PROTOCOL_VERSION,
  SUPPORTED_A2A_VERSIONS,
  SCHEMA_VERSION,
  ADL_VERSION,
  isSDKVersionCompatible,
  isA2AVersionSupported,
  getVersionInfo,
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
  SEMVER_REGEX,
} from '../src/versioning/index.js';

describe('Version Constants', () => {
  it('PLATFORM_VERSION is valid semver', () => {
    expect(isValidVersion(PLATFORM_VERSION)).toBe(true);
  });

  it('API_VERSION is v1', () => {
    expect(API_VERSION).toBe('v1');
  });

  it('SUPPORTED_API_VERSIONS contains v1', () => {
    expect(SUPPORTED_API_VERSIONS).toContain('v1');
  });

  it('MIN_SDK_VERSION and MAX_SDK_VERSION are valid semver', () => {
    expect(isValidVersion(MIN_SDK_VERSION)).toBe(true);
    expect(isValidVersion(MAX_SDK_VERSION)).toBe(true);
  });

  it('A2A_PROTOCOL_VERSION is 1.0', () => {
    expect(A2A_PROTOCOL_VERSION).toBe('1.0');
  });

  it('SUPPORTED_A2A_VERSIONS contains 1.0', () => {
    expect(SUPPORTED_A2A_VERSIONS).toContain('1.0');
  });

  it('SCHEMA_VERSION is defined', () => {
    expect(SCHEMA_VERSION).toBeTruthy();
  });

  it('ADL_VERSION is defined', () => {
    expect(ADL_VERSION).toBeTruthy();
  });
});

describe('isSDKVersionCompatible', () => {
  it('returns true for compatible versions', () => {
    expect(isSDKVersionCompatible('0.1.0')).toBe(true);
    expect(isSDKVersionCompatible('0.5.0')).toBe(true);
  });

  it('returns false for invalid version strings', () => {
    expect(isSDKVersionCompatible('not-a-version')).toBe(false);
    expect(isSDKVersionCompatible('')).toBe(false);
  });
});

describe('isA2AVersionSupported', () => {
  it('returns true for supported versions', () => {
    expect(isA2AVersionSupported('1.0')).toBe(true);
  });

  it('returns false for unsupported versions', () => {
    expect(isA2AVersionSupported('2.0')).toBe(false);
    expect(isA2AVersionSupported('0.9')).toBe(false);
  });
});

describe('getVersionInfo', () => {
  it('returns all version fields', () => {
    const info = getVersionInfo();
    expect(info.platform).toBe(PLATFORM_VERSION);
    expect(info.api).toBe(API_VERSION);
    expect(info.a2a).toBe(A2A_PROTOCOL_VERSION);
    expect(info.schema).toBe(SCHEMA_VERSION);
    expect(info.adl).toBe(ADL_VERSION);
  });
});

describe('parseVersion', () => {
  it('parses simple version', () => {
    const v = parseVersion('1.2.3');
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
  });

  it('parses version with prerelease', () => {
    const v = parseVersion('1.0.0-beta.1');
    expect(v.major).toBe(1);
    expect(v.prerelease).toBe('beta.1');
  });

  it('parses version with build metadata', () => {
    const v = parseVersion('1.0.0+build.123');
    expect(v.build).toBe('build.123');
  });

  it('parses version with prerelease and build', () => {
    const v = parseVersion('1.0.0-alpha.1+build.456');
    expect(v.prerelease).toBe('alpha.1');
    expect(v.build).toBe('build.456');
  });

  it('throws on invalid version', () => {
    expect(() => parseVersion('bad')).toThrow('Invalid version');
    expect(() => parseVersion('')).toThrow('Invalid version');
    expect(() => parseVersion('1.2')).toThrow('Invalid version');
  });
});

describe('tryParseVersion', () => {
  it('returns Version for valid input', () => {
    const v = tryParseVersion('1.0.0');
    expect(v).not.toBeNull();
    expect(v!.major).toBe(1);
  });

  it('returns null for invalid input', () => {
    expect(tryParseVersion('bad')).toBeNull();
    expect(tryParseVersion('')).toBeNull();
  });
});

describe('isValidVersion', () => {
  it('validates correct versions', () => {
    expect(isValidVersion('0.0.0')).toBe(true);
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('10.20.30')).toBe(true);
    expect(isValidVersion('1.0.0-alpha')).toBe(true);
    expect(isValidVersion('1.0.0+build')).toBe(true);
  });

  it('rejects invalid versions', () => {
    expect(isValidVersion('1')).toBe(false);
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('a.b.c')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('formatVersion', () => {
  it('formats simple version', () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('includes prerelease', () => {
    expect(formatVersion({ major: 1, minor: 0, patch: 0, prerelease: 'beta.1' })).toBe('1.0.0-beta.1');
  });

  it('includes build metadata', () => {
    expect(formatVersion({ major: 1, minor: 0, patch: 0, build: 'abc' })).toBe('1.0.0+abc');
  });

  it('includes both prerelease and build', () => {
    expect(formatVersion({ major: 1, minor: 0, patch: 0, prerelease: 'rc.1', build: '42' })).toBe('1.0.0-rc.1+42');
  });
});

describe('compareVersions', () => {
  it('compares major versions', () => {
    expect(compareVersions(parseVersion('2.0.0'), parseVersion('1.0.0'))).toBe(1);
    expect(compareVersions(parseVersion('1.0.0'), parseVersion('2.0.0'))).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareVersions(parseVersion('1.2.0'), parseVersion('1.1.0'))).toBe(1);
  });

  it('compares patch versions', () => {
    expect(compareVersions(parseVersion('1.0.2'), parseVersion('1.0.1'))).toBe(1);
  });

  it('equal versions return 0', () => {
    expect(compareVersions(parseVersion('1.2.3'), parseVersion('1.2.3'))).toBe(0);
  });

  it('prerelease is lower than release', () => {
    expect(compareVersions(parseVersion('1.0.0-alpha'), parseVersion('1.0.0'))).toBe(-1);
    expect(compareVersions(parseVersion('1.0.0'), parseVersion('1.0.0-alpha'))).toBe(1);
  });

  it('compares prerelease identifiers', () => {
    expect(compareVersions(parseVersion('1.0.0-alpha'), parseVersion('1.0.0-beta'))).toBe(-1);
    expect(compareVersions(parseVersion('1.0.0-beta.2'), parseVersion('1.0.0-beta.1'))).toBe(1);
  });
});

describe('eq/gt/lt/gte/lte', () => {
  it('eq works with strings', () => {
    expect(eq('1.0.0', '1.0.0')).toBe(true);
    expect(eq('1.0.0', '1.0.1')).toBe(false);
  });

  it('gt works', () => {
    expect(gt('2.0.0', '1.0.0')).toBe(true);
    expect(gt('1.0.0', '2.0.0')).toBe(false);
  });

  it('lt works', () => {
    expect(lt('1.0.0', '2.0.0')).toBe(true);
    expect(lt('2.0.0', '1.0.0')).toBe(false);
  });

  it('gte works', () => {
    expect(gte('1.0.0', '1.0.0')).toBe(true);
    expect(gte('1.0.1', '1.0.0')).toBe(true);
    expect(gte('1.0.0', '1.0.1')).toBe(false);
  });

  it('lte works', () => {
    expect(lte('1.0.0', '1.0.0')).toBe(true);
    expect(lte('1.0.0', '1.0.1')).toBe(true);
    expect(lte('1.0.1', '1.0.0')).toBe(false);
  });
});

describe('satisfies', () => {
  it('exact match', () => {
    expect(satisfies('1.0.0', '1.0.0')).toBe(true);
    expect(satisfies('1.0.1', '1.0.0')).toBe(false);
  });

  it('greater than', () => {
    expect(satisfies('2.0.0', '>1.0.0')).toBe(true);
    expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
  });

  it('greater than or equal', () => {
    expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
    expect(satisfies('0.9.0', '>=1.0.0')).toBe(false);
  });

  it('less than', () => {
    expect(satisfies('0.9.0', '<1.0.0')).toBe(true);
    expect(satisfies('1.0.0', '<1.0.0')).toBe(false);
  });

  it('caret (compatible)', () => {
    expect(satisfies('1.5.0', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
  });

  it('tilde (approximately equal)', () => {
    expect(satisfies('1.0.5', '~1.0.0')).toBe(true);
    expect(satisfies('1.1.0', '~1.0.0')).toBe(false);
  });

  it('range (AND)', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('OR conditions', () => {
    expect(satisfies('1.0.0', '1.0.0 || 2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '1.0.0 || 2.0.0')).toBe(true);
    expect(satisfies('3.0.0', '1.0.0 || 2.0.0')).toBe(false);
  });

  it('wildcard', () => {
    expect(satisfies('1.5.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('1.0.5', '1.0.x')).toBe(true);
  });
});

describe('isCompatible', () => {
  it('same major is compatible', () => {
    expect(isCompatible(parseVersion('1.5.0'), parseVersion('1.0.0'))).toBe(true);
  });

  it('different major is not compatible', () => {
    expect(isCompatible(parseVersion('2.0.0'), parseVersion('1.0.0'))).toBe(false);
  });

  it('lower version is not compatible', () => {
    expect(isCompatible(parseVersion('1.0.0'), parseVersion('1.5.0'))).toBe(false);
  });
});

describe('isApproximatelyEqual', () => {
  it('same major.minor is approximately equal', () => {
    expect(isApproximatelyEqual(parseVersion('1.0.5'), parseVersion('1.0.0'))).toBe(true);
  });

  it('different minor is not approximately equal', () => {
    expect(isApproximatelyEqual(parseVersion('1.1.0'), parseVersion('1.0.0'))).toBe(false);
  });
});

describe('increment', () => {
  it('increments major', () => {
    const v = increment(parseVersion('1.2.3'), 'major');
    expect(formatVersion(v)).toBe('2.0.0');
  });

  it('increments minor', () => {
    const v = increment(parseVersion('1.2.3'), 'minor');
    expect(formatVersion(v)).toBe('1.3.0');
  });

  it('increments patch', () => {
    const v = increment(parseVersion('1.2.3'), 'patch');
    expect(formatVersion(v)).toBe('1.2.4');
  });

  it('increments prerelease with numeric suffix', () => {
    const v = increment(parseVersion('1.0.0-beta.1'), 'prerelease');
    expect(v.prerelease).toBe('beta.2');
  });

  it('adds prerelease to release version', () => {
    const v = increment(parseVersion('1.0.0'), 'prerelease');
    expect(v.prerelease).toBe('0');
  });
});

describe('maxVersion', () => {
  it('finds maximum version', () => {
    const max = maxVersion(['1.0.0', '3.0.0', '2.0.0']);
    expect(max).not.toBeNull();
    expect(formatVersion(max!)).toBe('3.0.0');
  });

  it('returns null for empty array', () => {
    expect(maxVersion([])).toBeNull();
  });
});

describe('minVersion', () => {
  it('finds minimum version', () => {
    const min = minVersion(['3.0.0', '1.0.0', '2.0.0']);
    expect(min).not.toBeNull();
    expect(formatVersion(min!)).toBe('1.0.0');
  });

  it('returns null for empty array', () => {
    expect(minVersion([])).toBeNull();
  });
});

describe('sortVersions', () => {
  it('sorts versions ascending', () => {
    const versions = ['3.0.0', '1.0.0', '2.0.0'].map(parseVersion);
    const sorted = sortVersions(versions);
    expect(formatVersion(sorted[0])).toBe('1.0.0');
    expect(formatVersion(sorted[1])).toBe('2.0.0');
    expect(formatVersion(sorted[2])).toBe('3.0.0');
  });

  it('does not mutate original array', () => {
    const versions = ['3.0.0', '1.0.0'].map(parseVersion);
    const sorted = sortVersions(versions);
    expect(formatVersion(versions[0])).toBe('3.0.0'); // unchanged
    expect(formatVersion(sorted[0])).toBe('1.0.0');
  });
});

describe('SEMVER_REGEX', () => {
  it('matches valid versions', () => {
    expect(SEMVER_REGEX.test('0.0.0')).toBe(true);
    expect(SEMVER_REGEX.test('1.0.0')).toBe(true);
    expect(SEMVER_REGEX.test('1.0.0-alpha')).toBe(true);
    expect(SEMVER_REGEX.test('1.0.0+build')).toBe(true);
    expect(SEMVER_REGEX.test('1.0.0-alpha.1+build.123')).toBe(true);
  });

  it('rejects invalid versions', () => {
    expect(SEMVER_REGEX.test('1')).toBe(false);
    expect(SEMVER_REGEX.test('1.2')).toBe(false);
    expect(SEMVER_REGEX.test('a.b.c')).toBe(false);
  });
});
