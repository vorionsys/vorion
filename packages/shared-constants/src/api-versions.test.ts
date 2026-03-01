import { describe, it, expect } from 'vitest';
import {
  VersionStatus,
  COGNIGATE_VERSIONS,
  COGNIGATE_CURRENT_VERSION,
  COGNIGATE_DEFAULT_VERSION,
  TRUST_API_VERSIONS,
  TRUST_CURRENT_VERSION,
  LOGIC_API_VERSIONS,
  LOGIC_CURRENT_VERSION,
  BASIS_VERSIONS,
  BASIS_CURRENT_VERSION,
  BASIS_SPEC_VERSION,
  CAR_SPEC_VERSIONS,
  CAR_SPEC_CURRENT_VERSION,
  API_VERSIONS,
  getCurrentVersion,
  getVersionDefinition,
  isVersionSupported,
  isVersionDeprecated,
  getStableVersions,
  buildApiUrl,
  VERSION_HEADERS,
} from './api-versions.js';

describe('API_VERSIONS', () => {
  it('has all service version maps', () => {
    expect(API_VERSIONS.cognigate).toBe(COGNIGATE_VERSIONS);
    expect(API_VERSIONS.trust).toBe(TRUST_API_VERSIONS);
    expect(API_VERSIONS.logic).toBe(LOGIC_API_VERSIONS);
    expect(API_VERSIONS.basis).toBe(BASIS_VERSIONS);
    expect(API_VERSIONS.carSpec).toBe(CAR_SPEC_VERSIONS);
  });
});

describe('current version constants', () => {
  it('has valid current versions', () => {
    expect(COGNIGATE_CURRENT_VERSION).toBe('v1');
    expect(COGNIGATE_DEFAULT_VERSION).toBe('v1');
    expect(TRUST_CURRENT_VERSION).toBe('v1');
    expect(LOGIC_CURRENT_VERSION).toBe('v1');
    expect(BASIS_CURRENT_VERSION).toBe('v1');
    expect(CAR_SPEC_CURRENT_VERSION).toBe('v1');
  });

  it('has valid basis spec version', () => {
    expect(BASIS_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('getCurrentVersion', () => {
  it('returns current version for each service', () => {
    expect(getCurrentVersion('cognigate')).toBe(COGNIGATE_CURRENT_VERSION);
    expect(getCurrentVersion('trust')).toBe(TRUST_CURRENT_VERSION);
    expect(getCurrentVersion('logic')).toBe(LOGIC_CURRENT_VERSION);
    expect(getCurrentVersion('basis')).toBe(BASIS_CURRENT_VERSION);
    expect(getCurrentVersion('carSpec')).toBe(CAR_SPEC_CURRENT_VERSION);
  });
});

describe('getVersionDefinition', () => {
  it('finds known version definitions', () => {
    const def = getVersionDefinition('cognigate', 'v1');
    expect(def).toBeDefined();
    expect(def!.version).toBe('v1');
    expect(def!.fullVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(def!.releaseDate).toBeTruthy();
    expect(Object.values(VersionStatus)).toContain(def!.status);
  });

  it('returns undefined for unknown version', () => {
    expect(getVersionDefinition('cognigate', 'v999')).toBeUndefined();
  });
});

describe('isVersionSupported', () => {
  it('returns true for current stable versions', () => {
    expect(isVersionSupported('cognigate', 'v1')).toBe(true);
    expect(isVersionSupported('trust', 'v1')).toBe(true);
  });

  it('returns false for unknown versions', () => {
    expect(isVersionSupported('cognigate', 'v999')).toBe(false);
  });
});

describe('isVersionDeprecated', () => {
  it('returns false for current stable versions', () => {
    expect(isVersionDeprecated('cognigate', 'v1')).toBe(false);
  });

  it('returns false for unknown versions', () => {
    expect(isVersionDeprecated('cognigate', 'v999')).toBe(false);
  });
});

describe('getStableVersions', () => {
  it('returns stable versions for each service', () => {
    const stable = getStableVersions('cognigate');
    expect(stable.length).toBeGreaterThan(0);
    for (const v of stable) {
      expect(v.status).toBe(VersionStatus.STABLE);
    }
  });
});

describe('buildApiUrl', () => {
  it('builds correct URL', () => {
    expect(buildApiUrl('https://cognigate.dev', 'v1', 'intents')).toBe(
      'https://cognigate.dev/v1/intents'
    );
  });

  it('strips trailing slash from base', () => {
    expect(buildApiUrl('https://cognigate.dev/', 'v1', 'intents')).toBe(
      'https://cognigate.dev/v1/intents'
    );
  });

  it('strips leading slash from path', () => {
    expect(buildApiUrl('https://cognigate.dev', 'v1', '/intents')).toBe(
      'https://cognigate.dev/v1/intents'
    );
  });
});

describe('VERSION_HEADERS', () => {
  it('has all expected headers', () => {
    expect(VERSION_HEADERS.REQUEST_VERSION).toBeTruthy();
    expect(VERSION_HEADERS.RESPONSE_VERSION).toBeTruthy();
    expect(VERSION_HEADERS.DEPRECATION_WARNING).toBeTruthy();
    expect(VERSION_HEADERS.SUNSET).toBeTruthy();
  });
});
