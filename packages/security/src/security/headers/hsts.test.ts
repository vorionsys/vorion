import { describe, it, expect } from 'vitest';
import {
  HSTSManager,
  createProductionHSTS,
  createPreloadHSTS,
  createDevelopmentHSTS,
  createHSTS,
  buildHSTSHeader,
  parseHSTSHeader,
  validateHSTSHeader,
  HSTS_HEADER_NAME,
  HSTS_MIN_RECOMMENDED_MAX_AGE,
  HSTS_MAX_SENSIBLE_MAX_AGE,
} from './hsts.js';

describe('HSTSManager', () => {
  describe('constructor', () => {
    it('uses recommended defaults', () => {
      const hsts = new HSTSManager();
      const config = hsts.getConfig();
      expect(config.includeSubDomains).toBe(true);
      expect(config.preload).toBe(false);
      expect(config.maxAge).toBeGreaterThan(0);
    });

    it('accepts partial config', () => {
      const hsts = new HSTSManager({ maxAge: 300, includeSubDomains: false });
      const config = hsts.getConfig();
      expect(config.maxAge).toBe(300);
      expect(config.includeSubDomains).toBe(false);
    });
  });

  describe('buildHeader()', () => {
    it('builds basic header with max-age', () => {
      const hsts = new HSTSManager({ maxAge: 3600, includeSubDomains: false, preload: false });
      expect(hsts.buildHeader()).toBe('max-age=3600');
    });

    it('includes includeSubDomains when enabled', () => {
      const hsts = new HSTSManager({ maxAge: 3600, includeSubDomains: true, preload: false });
      expect(hsts.buildHeader()).toBe('max-age=3600; includeSubDomains');
    });

    it('includes preload when enabled', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true, preload: true });
      const header = hsts.buildHeader();
      expect(header).toContain('max-age=63072000');
      expect(header).toContain('includeSubDomains');
      expect(header).toContain('preload');
    });
  });

  describe('setMaxAge()', () => {
    it('updates max-age', () => {
      const hsts = new HSTSManager({ maxAge: 100 });
      hsts.setMaxAge(500);
      expect(hsts.getConfig().maxAge).toBe(500);
    });

    it('throws for negative max-age', () => {
      const hsts = new HSTSManager();
      expect(() => hsts.setMaxAge(-1)).toThrow('cannot be negative');
    });

    it('throws if preload enabled and max-age too low', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true, preload: true });
      expect(() => hsts.setMaxAge(100)).toThrow('preload');
    });

    it('returns this for chaining', () => {
      const hsts = new HSTSManager({ maxAge: 100 });
      expect(hsts.setMaxAge(200)).toBe(hsts);
    });
  });

  describe('setIncludeSubDomains()', () => {
    it('enables includeSubDomains', () => {
      const hsts = new HSTSManager({ includeSubDomains: false });
      hsts.setIncludeSubDomains(true);
      expect(hsts.getConfig().includeSubDomains).toBe(true);
    });

    it('throws if preload requires includeSubDomains', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true, preload: true });
      expect(() => hsts.setIncludeSubDomains(false)).toThrow('includeSubDomains must be true');
    });
  });

  describe('setPreload()', () => {
    it('enables preload and auto-sets includeSubDomains', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: false });
      hsts.setPreload(true);
      const config = hsts.getConfig();
      expect(config.preload).toBe(true);
      expect(config.includeSubDomains).toBe(true);
    });

    it('increases max-age if below preload minimum', () => {
      const hsts = new HSTSManager({ maxAge: 100 });
      hsts.setPreload(true);
      expect(hsts.getConfig().maxAge).toBeGreaterThanOrEqual(31536000);
    });

    it('disables preload without changing other settings', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true, preload: true });
      hsts.setPreload(false);
      expect(hsts.getConfig().preload).toBe(false);
      expect(hsts.getConfig().includeSubDomains).toBe(true);
    });
  });

  describe('validate()', () => {
    it('valid for well-configured production HSTS', () => {
      const result = new HSTSManager({ maxAge: 63072000, includeSubDomains: true }).validate();
      expect(result.valid).toBe(true);
    });

    it('warns when max-age is below recommended minimum', () => {
      const result = new HSTSManager({ maxAge: 300 }).validate();
      expect(result.issues.some(i => i.message.includes('below recommended'))).toBe(true);
    });

    it('reports info when max-age exceeds sensible maximum', () => {
      const result = new HSTSManager({ maxAge: 100000000 }).validate();
      expect(result.issues.some(i => i.message.includes('exceeds'))).toBe(true);
    });

    it('reports preload readiness when config qualifies', () => {
      const result = new HSTSManager({ maxAge: 63072000, includeSubDomains: true }).validate();
      expect(result.preloadReady).toBe(true);
    });

    it('reports not preload ready when max-age too low', () => {
      const result = new HSTSManager({ maxAge: 300, includeSubDomains: true }).validate();
      expect(result.preloadReady).toBe(false);
    });
  });

  describe('isPreloadReady()', () => {
    it('returns true when all preload requirements met', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true, preload: true });
      expect(hsts.isPreloadReady()).toBe(true);
    });

    it('returns false when preload not enabled', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: true });
      expect(hsts.isPreloadReady()).toBe(false);
    });

    it('returns false when includeSubDomains off', () => {
      const hsts = new HSTSManager({ maxAge: 63072000, includeSubDomains: false });
      expect(hsts.isPreloadReady()).toBe(false);
    });
  });

  describe('getTimeRemaining()', () => {
    it('returns max-age when set just now', () => {
      const hsts = new HSTSManager({ maxAge: 3600 });
      const remaining = hsts.getTimeRemaining(new Date());
      expect(remaining).toBeGreaterThanOrEqual(3599);
      expect(remaining).toBeLessThanOrEqual(3600);
    });

    it('returns 0 when expired', () => {
      const hsts = new HSTSManager({ maxAge: 10 });
      const oneMinuteAgo = new Date(Date.now() - 60000);
      expect(hsts.getTimeRemaining(oneMinuteAgo)).toBe(0);
    });
  });

  describe('clone()', () => {
    it('creates independent copy', () => {
      const original = new HSTSManager({ maxAge: 3600 });
      const clone = original.clone();
      clone.setMaxAge(7200);
      expect(original.getConfig().maxAge).toBe(3600);
      expect(clone.getConfig().maxAge).toBe(7200);
    });
  });
});

describe('factory functions', () => {
  it('createProductionHSTS has production defaults', () => {
    const hsts = createProductionHSTS();
    const config = hsts.getConfig();
    expect(config.includeSubDomains).toBe(true);
    expect(config.preload).toBe(false);
    expect(config.maxAge).toBeGreaterThanOrEqual(HSTS_MIN_RECOMMENDED_MAX_AGE);
  });

  it('createPreloadHSTS is preload-ready', () => {
    const hsts = createPreloadHSTS();
    expect(hsts.isPreloadReady()).toBe(true);
  });

  it('createDevelopmentHSTS has short max-age', () => {
    const hsts = createDevelopmentHSTS();
    expect(hsts.getConfig().maxAge).toBeLessThanOrEqual(300);
  });

  it('createHSTS accepts custom config', () => {
    const hsts = createHSTS({ maxAge: 1234 });
    expect(hsts.getConfig().maxAge).toBe(1234);
  });
});

describe('buildHSTSHeader', () => {
  it('builds header from config', () => {
    const header = buildHSTSHeader({ maxAge: 3600 });
    expect(header).toContain('max-age=3600');
  });
});

describe('parseHSTSHeader', () => {
  it('parses max-age', () => {
    const config = parseHSTSHeader('max-age=3600');
    expect(config.maxAge).toBe(3600);
  });

  it('parses includeSubDomains', () => {
    const config = parseHSTSHeader('max-age=3600; includeSubDomains');
    expect(config.includeSubDomains).toBe(true);
  });

  it('parses preload', () => {
    const config = parseHSTSHeader('max-age=63072000; includeSubDomains; preload');
    expect(config.preload).toBe(true);
    expect(config.maxAge).toBe(63072000);
  });

  it('handles case insensitive parsing', () => {
    const config = parseHSTSHeader('Max-Age=3600; includeSubDomains; Preload');
    expect(config.maxAge).toBe(3600);
    expect(config.includeSubDomains).toBe(true);
    expect(config.preload).toBe(true);
  });

  it('roundtrips with buildHSTSHeader', () => {
    const original = { maxAge: 63072000, includeSubDomains: true, preload: true };
    const header = buildHSTSHeader(original);
    const parsed = parseHSTSHeader(header);
    expect(parsed).toEqual(original);
  });
});

describe('validateHSTSHeader', () => {
  it('validates a good header', () => {
    const result = validateHSTSHeader('max-age=63072000; includeSubDomains');
    expect(result.valid).toBe(true);
  });

  it('warns on short max-age', () => {
    const result = validateHSTSHeader('max-age=300');
    expect(result.issues.some(i => i.message.includes('below recommended'))).toBe(true);
  });
});

describe('constants', () => {
  it('HSTS_HEADER_NAME is correct', () => {
    expect(HSTS_HEADER_NAME).toBe('Strict-Transport-Security');
  });

  it('HSTS_MIN_RECOMMENDED_MAX_AGE is 6 months', () => {
    expect(HSTS_MIN_RECOMMENDED_MAX_AGE).toBe(15768000);
  });

  it('HSTS_MAX_SENSIBLE_MAX_AGE is 2 years', () => {
    expect(HSTS_MAX_SENSIBLE_MAX_AGE).toBe(63072000);
  });
});
