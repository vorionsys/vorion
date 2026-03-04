import { describe, it, expect } from 'vitest';
import {
  PermissionsPolicyManager,
  createStrictPermissionsPolicy,
  createModeratePermissionsPolicy,
  createAPIPermissionsPolicy,
  createPermissionsPolicy,
  buildPermissionsPolicyHeader,
  parsePermissionsPolicyHeader,
  getSecureDefault,
  PERMISSIONS_POLICY_HEADER,
  KNOWN_FEATURES,
  HIGH_RISK_FEATURES,
  SENSOR_FEATURES,
  STRICT_PERMISSIONS_PRESET,
} from './permissions-policy.js';

describe('PermissionsPolicyManager', () => {
  describe('preset()', () => {
    it('applies strict preset', () => {
      const manager = new PermissionsPolicyManager().preset('strict');
      const config = manager.toConfig();
      expect(config.camera).toBe('()');
      expect(config.microphone).toBe('()');
      expect(config.geolocation).toBe('()');
    });

    it('applies moderate preset with self-origin for safe features', () => {
      const manager = new PermissionsPolicyManager().preset('moderate');
      const config = manager.toConfig();
      expect(config.fullscreen).toBe('(self)');
      expect(config.camera).toBe('()');
    });

    it('applies api preset disabling everything', () => {
      const manager = new PermissionsPolicyManager().preset('api');
      const config = manager.toConfig();
      for (const value of Object.values(config)) {
        expect(value).toBe('()');
      }
    });
  });

  describe('allow()', () => {
    it('allows feature for self', () => {
      const manager = new PermissionsPolicyManager().allow('camera', 'self');
      expect(manager.toConfig().camera).toBe('(self)');
    });

    it('allows feature for all', () => {
      const manager = new PermissionsPolicyManager().allow('fullscreen', 'all');
      expect(manager.toConfig().fullscreen).toBe('*');
    });

    it('allows feature for none', () => {
      const manager = new PermissionsPolicyManager().allow('geolocation', 'none');
      expect(manager.toConfig().geolocation).toBe('()');
    });

    it('allows feature for specific origins', () => {
      const manager = new PermissionsPolicyManager()
        .allow('camera', ['https://a.com', 'https://b.com']);
      expect(manager.toConfig().camera).toBe('("https://a.com" "https://b.com")');
    });

    it('handles empty origins array as none', () => {
      const manager = new PermissionsPolicyManager().allow('camera', []);
      expect(manager.toConfig().camera).toBe('()');
    });
  });

  describe('deny()', () => {
    it('denies a feature', () => {
      const manager = new PermissionsPolicyManager().deny('camera');
      expect(manager.toConfig().camera).toBe('()');
    });
  });

  describe('allowSelf()', () => {
    it('allows for self origin', () => {
      const manager = new PermissionsPolicyManager().allowSelf('fullscreen');
      expect(manager.toConfig().fullscreen).toBe('(self)');
    });
  });

  describe('allowAll()', () => {
    it('allows for all origins', () => {
      const manager = new PermissionsPolicyManager().allowAll('fullscreen');
      expect(manager.toConfig().fullscreen).toBe('*');
    });
  });

  describe('allowOrigins()', () => {
    it('allows specific origins', () => {
      const manager = new PermissionsPolicyManager()
        .allowOrigins('camera', ['https://app.example.com']);
      expect(manager.toConfig().camera).toBe('("https://app.example.com")');
    });
  });

  describe('allowSelfAndOrigins()', () => {
    it('allows self and specific origins', () => {
      const manager = new PermissionsPolicyManager()
        .allowSelfAndOrigins('camera', ['https://partner.com']);
      expect(manager.toConfig().camera).toBe('(self "https://partner.com")');
    });
  });

  describe('disableSensors()', () => {
    it('disables all sensor features', () => {
      const manager = new PermissionsPolicyManager().disableSensors();
      const config = manager.toConfig();
      for (const feature of SENSOR_FEATURES) {
        expect(config[feature]).toBe('()');
      }
    });
  });

  describe('disableHighRisk()', () => {
    it('disables all high-risk features', () => {
      const manager = new PermissionsPolicyManager().disableHighRisk();
      const config = manager.toConfig();
      for (const feature of HIGH_RISK_FEATURES) {
        expect(config[feature]).toBe('()');
      }
    });
  });

  describe('disableInterestCohort()', () => {
    it('disables interest-cohort', () => {
      const manager = new PermissionsPolicyManager().disableInterestCohort();
      expect(manager.toConfig()['interest-cohort']).toBe('()');
    });
  });

  describe('remove()', () => {
    it('removes a feature from the policy', () => {
      const manager = new PermissionsPolicyManager()
        .allowSelf('camera')
        .remove('camera');
      expect(manager.toConfig().camera).toBeUndefined();
    });
  });

  describe('clear()', () => {
    it('removes all features', () => {
      const manager = new PermissionsPolicyManager()
        .preset('strict')
        .clear();
      expect(Object.keys(manager.toConfig())).toHaveLength(0);
    });
  });

  describe('build()', () => {
    it('produces comma-separated feature=value pairs', () => {
      const header = new PermissionsPolicyManager()
        .deny('camera')
        .allowSelf('fullscreen')
        .build();
      expect(header).toContain('camera=()');
      expect(header).toContain('fullscreen=(self)');
      expect(header).toContain(', ');
    });
  });

  describe('validate()', () => {
    it('valid for strict preset', () => {
      const result = new PermissionsPolicyManager().preset('strict').validate();
      expect(result.valid).toBe(true);
    });

    it('warns about unknown features', () => {
      const result = new PermissionsPolicyManager()
        .deny('made-up-feature')
        .validate();
      expect(result.issues.some(i => i.message.includes('Unknown feature'))).toBe(true);
    });
  });

  describe('clone()', () => {
    it('creates independent copy', () => {
      const original = new PermissionsPolicyManager().deny('camera');
      const clone = original.clone();
      clone.allowSelf('camera');
      expect(original.toConfig().camera).toBe('()');
      expect(clone.toConfig().camera).toBe('(self)');
    });
  });

  describe('fromConfig()', () => {
    it('applies configuration object', () => {
      const manager = new PermissionsPolicyManager().fromConfig({
        camera: '()',
        microphone: '(self)',
      });
      expect(manager.toConfig().camera).toBe('()');
      expect(manager.toConfig().microphone).toBe('(self)');
    });
  });
});

describe('factory functions', () => {
  it('createStrictPermissionsPolicy denies sensitive features', () => {
    const config = createStrictPermissionsPolicy().toConfig();
    expect(config.camera).toBe('()');
    expect(config.microphone).toBe('()');
  });

  it('createModeratePermissionsPolicy allows some features for self', () => {
    const config = createModeratePermissionsPolicy().toConfig();
    expect(config.fullscreen).toBe('(self)');
  });

  it('createAPIPermissionsPolicy disables everything', () => {
    const config = createAPIPermissionsPolicy().toConfig();
    expect(config.camera).toBe('()');
    expect(config.fullscreen).toBe('()');
  });

  it('createPermissionsPolicy applies custom config', () => {
    const manager = createPermissionsPolicy({ camera: '(self)' });
    expect(manager.toConfig().camera).toBe('(self)');
  });
});

describe('buildPermissionsPolicyHeader', () => {
  it('builds header from config', () => {
    const header = buildPermissionsPolicyHeader({ camera: '()', fullscreen: '(self)' });
    expect(header).toContain('camera=()');
    expect(header).toContain('fullscreen=(self)');
  });
});

describe('parsePermissionsPolicyHeader', () => {
  it('parses feature=value pairs', () => {
    const config = parsePermissionsPolicyHeader('camera=(), fullscreen=(self)');
    expect(config.camera).toBe('()');
    expect(config.fullscreen).toBe('(self)');
  });

  it('handles wildcard values', () => {
    const config = parsePermissionsPolicyHeader('fullscreen=*');
    expect(config.fullscreen).toBe('*');
  });

  it('roundtrips with buildPermissionsPolicyHeader', () => {
    const original = { camera: '()', fullscreen: '(self)', geolocation: '()' };
    const header = buildPermissionsPolicyHeader(original);
    const parsed = parsePermissionsPolicyHeader(header);
    expect(parsed).toEqual(original);
  });
});

describe('getSecureDefault', () => {
  it('returns () for high-risk features', () => {
    expect(getSecureDefault('camera')).toBe('()');
    expect(getSecureDefault('microphone')).toBe('()');
    expect(getSecureDefault('geolocation')).toBe('()');
  });

  it('returns () for sensor features', () => {
    expect(getSecureDefault('accelerometer')).toBe('()');
    expect(getSecureDefault('gyroscope')).toBe('()');
  });

  it('returns (self) for WebAuthn features', () => {
    expect(getSecureDefault('publickey-credentials-create')).toBe('(self)');
    expect(getSecureDefault('publickey-credentials-get')).toBe('(self)');
  });

  it('returns () for unknown features', () => {
    expect(getSecureDefault('unknown-feature')).toBe('()');
  });
});

describe('constants', () => {
  it('PERMISSIONS_POLICY_HEADER is correct', () => {
    expect(PERMISSIONS_POLICY_HEADER).toBe('Permissions-Policy');
  });

  it('KNOWN_FEATURES has expected features', () => {
    expect(KNOWN_FEATURES).toContain('camera');
    expect(KNOWN_FEATURES).toContain('microphone');
    expect(KNOWN_FEATURES).toContain('geolocation');
    expect(KNOWN_FEATURES).toContain('fullscreen');
  });

  it('HIGH_RISK_FEATURES is a subset of common features', () => {
    expect(HIGH_RISK_FEATURES).toContain('camera');
    expect(HIGH_RISK_FEATURES).toContain('microphone');
    expect(HIGH_RISK_FEATURES).toContain('geolocation');
  });
});
