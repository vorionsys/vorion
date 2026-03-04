import { describe, it, expect } from 'vitest';
import {
  CSPBuilder,
  generateNonce,
  formatNonce,
  getCSPPreset,
  createStrictCSP,
  createModerateCSP,
  createAPICSP,
  buildCSPString,
  parseCSPString,
  STRICT_CSP_PRESET,
  MODERATE_CSP_PRESET,
  API_CSP_PRESET,
  RELAXED_CSP_PRESET,
} from './csp.js';

describe('CSPBuilder', () => {
  describe('preset()', () => {
    it('applies strict preset directives', () => {
      const builder = new CSPBuilder().preset('strict');
      const directives = builder.getDirectives();
      expect(directives['default-src']).toEqual(["'self'"]);
      expect(directives['object-src']).toEqual(["'none'"]);
      expect(directives['frame-ancestors']).toEqual(["'none'"]);
      expect(directives['upgrade-insecure-requests']).toBe(true);
    });

    it('applies api preset with none for all sources', () => {
      const builder = new CSPBuilder().preset('api');
      const directives = builder.getDirectives();
      expect(directives['default-src']).toEqual(["'none'"]);
      expect(directives['script-src']).toEqual(["'none'"]);
      expect(directives['connect-src']).toEqual(["'self'"]);
    });

    it('applies moderate preset allowing unsafe-inline in styles', () => {
      const builder = new CSPBuilder().preset('moderate');
      const directives = builder.getDirectives();
      expect(directives['style-src']).toContain("'unsafe-inline'");
    });

    it('applies relaxed preset allowing unsafe-eval', () => {
      const builder = new CSPBuilder().preset('relaxed');
      const directives = builder.getDirectives();
      expect(directives['script-src']).toContain("'unsafe-eval'");
      expect(directives['script-src']).toContain("'unsafe-inline'");
    });
  });

  describe('fluent directive setters', () => {
    it('sets and adds script-src', () => {
      const builder = new CSPBuilder()
        .scriptSrc("'self'")
        .addScriptSrc('https://cdn.example.com');
      const directives = builder.getDirectives();
      expect(directives['script-src']).toEqual(["'self'", 'https://cdn.example.com']);
    });

    it('sets and adds style-src', () => {
      const builder = new CSPBuilder()
        .styleSrc("'self'")
        .addStyleSrc("'unsafe-inline'");
      const directives = builder.getDirectives();
      expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    });

    it('sets connect-src with add', () => {
      const builder = new CSPBuilder()
        .connectSrc("'self'")
        .addConnectSrc('https://api.example.com');
      const directives = builder.getDirectives();
      expect(directives['connect-src']).toEqual(["'self'", 'https://api.example.com']);
    });

    it('sets img-src with add', () => {
      const builder = new CSPBuilder()
        .imgSrc("'self'")
        .addImgSrc('data:');
      const directives = builder.getDirectives();
      expect(directives['img-src']).toEqual(["'self'", 'data:']);
    });

    it('sets frame-ancestors', () => {
      const builder = new CSPBuilder().frameAncestors("'none'");
      expect(builder.getDirectives()['frame-ancestors']).toEqual(["'none'"]);
    });

    it('sets object-src', () => {
      const builder = new CSPBuilder().objectSrc("'none'");
      expect(builder.getDirectives()['object-src']).toEqual(["'none'"]);
    });

    it('sets base-uri', () => {
      const builder = new CSPBuilder().baseUri("'self'");
      expect(builder.getDirectives()['base-uri']).toEqual(["'self'"]);
    });

    it('sets form-action', () => {
      const builder = new CSPBuilder().formAction("'self'");
      expect(builder.getDirectives()['form-action']).toEqual(["'self'"]);
    });

    it('sets sandbox', () => {
      const builder = new CSPBuilder().sandbox('allow-scripts', 'allow-same-origin');
      expect(builder.getDirectives().sandbox).toEqual(['allow-scripts', 'allow-same-origin']);
    });

    it('enables upgrade-insecure-requests', () => {
      const builder = new CSPBuilder().upgradeInsecureRequests();
      expect(builder.getDirectives()['upgrade-insecure-requests']).toBe(true);
    });

    it('enables block-all-mixed-content', () => {
      const builder = new CSPBuilder().blockAllMixedContent();
      expect(builder.getDirectives()['block-all-mixed-content']).toBe(true);
    });
  });

  describe('nonce handling', () => {
    it('withNonce() adds nonce to build result', () => {
      const result = new CSPBuilder()
        .preset('strict')
        .withNonce()
        .build();
      expect(result.nonce).toBeDefined();
      expect(result.nonce!.length).toBeGreaterThan(0);
      expect(result.policy).toContain(`'nonce-${result.nonce}'`);
    });

    it('useNonce() uses a specific nonce', () => {
      const result = new CSPBuilder()
        .preset('strict')
        .useNonce('test-nonce-123')
        .build();
      expect(result.nonce).toBe('test-nonce-123');
      expect(result.policy).toContain("'nonce-test-nonce-123'");
    });

    it('nonce is added to both script-src and style-src', () => {
      const result = new CSPBuilder()
        .scriptSrc("'self'")
        .styleSrc("'self'")
        .useNonce('abc')
        .build();
      expect(result.policy).toContain("script-src 'self' 'nonce-abc'");
      expect(result.policy).toContain("style-src 'self' 'nonce-abc'");
    });
  });

  describe('build()', () => {
    it('produces semicolon-separated directives', () => {
      const result = new CSPBuilder()
        .defaultSrc("'self'")
        .scriptSrc("'self'")
        .build();
      expect(result.policy).toContain("default-src 'self'");
      expect(result.policy).toContain("script-src 'self'");
      expect(result.policy).toContain('; ');
    });

    it('includes boolean directives without values', () => {
      const result = new CSPBuilder()
        .defaultSrc("'self'")
        .upgradeInsecureRequests()
        .build();
      expect(result.policy).toContain('upgrade-insecure-requests');
    });

    it('includes report-to directive', () => {
      const result = new CSPBuilder()
        .defaultSrc("'self'")
        .reportTo('csp-group')
        .build();
      expect(result.policy).toContain('report-to csp-group');
    });

    it('includes report-uri directive', () => {
      const result = new CSPBuilder()
        .defaultSrc("'self'")
        .reportUri('/csp-report')
        .build();
      expect(result.policy).toContain('report-uri /csp-report');
    });

    it('sets reportOnly flag', () => {
      const result = new CSPBuilder()
        .defaultSrc("'self'")
        .asReportOnly()
        .build();
      expect(result.reportOnly).toBe(true);
    });
  });

  describe('getHeaderName()', () => {
    it('returns CSP header name by default', () => {
      const builder = new CSPBuilder();
      expect(builder.getHeaderName()).toBe('Content-Security-Policy');
    });

    it('returns report-only header name when report-only', () => {
      const builder = new CSPBuilder().asReportOnly();
      expect(builder.getHeaderName()).toBe('Content-Security-Policy-Report-Only');
    });
  });

  describe('merge()', () => {
    it('merges additional directives', () => {
      const builder = new CSPBuilder()
        .preset('strict')
        .merge({ 'worker-src': ["'self'"] });
      expect(builder.getDirectives()['worker-src']).toEqual(["'self'"]);
    });
  });

  describe('validate()', () => {
    it('warns about missing default-src', () => {
      const issues = new CSPBuilder().scriptSrc("'self'").validate();
      expect(issues.some(i => i.directive === 'default-src')).toBe(true);
    });

    it('warns about missing object-src', () => {
      const issues = new CSPBuilder().defaultSrc("'self'").validate();
      expect(issues.some(i => i.directive === 'object-src')).toBe(true);
    });

    it('warns about missing base-uri', () => {
      const issues = new CSPBuilder().defaultSrc("'self'").validate();
      expect(issues.some(i => i.directive === 'base-uri')).toBe(true);
    });

    it('warns about wildcard in sensitive directives', () => {
      const issues = new CSPBuilder().scriptSrc('*').validate();
      expect(issues.some(i => i.issue.includes('Wildcard'))).toBe(true);
    });
  });
});

describe('generateNonce', () => {
  it('produces base64 string', () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThan(0);
    expect(() => Buffer.from(nonce, 'base64')).not.toThrow();
  });

  it('produces unique values', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe('formatNonce', () => {
  it('wraps nonce in CSP format', () => {
    expect(formatNonce('abc123')).toBe("'nonce-abc123'");
  });
});

describe('getCSPPreset', () => {
  it('returns copies of presets', () => {
    const preset = getCSPPreset('strict');
    preset['default-src'] = ["'none'"];
    expect(STRICT_CSP_PRESET['default-src']).toEqual(["'self'"]);
  });

  it('defaults to strict for unknown preset', () => {
    const preset = getCSPPreset('unknown' as any);
    expect(preset['default-src']).toEqual(["'self'"]);
  });
});

describe('factory functions', () => {
  it('createStrictCSP uses strict preset', () => {
    const builder = createStrictCSP();
    expect(builder.getDirectives()['default-src']).toEqual(["'self'"]);
  });

  it('createModerateCSP uses moderate preset', () => {
    const builder = createModerateCSP();
    expect(builder.getDirectives()['style-src']).toContain("'unsafe-inline'");
  });

  it('createAPICSP uses api preset', () => {
    const builder = createAPICSP();
    expect(builder.getDirectives()['default-src']).toEqual(["'none'"]);
  });
});

describe('buildCSPString', () => {
  it('builds policy from directives', () => {
    const policy = buildCSPString({ 'default-src': ["'self'"] });
    expect(policy).toContain("default-src 'self'");
  });

  it('includes nonce when provided', () => {
    const policy = buildCSPString({ 'script-src': ["'self'"] }, 'test-nonce');
    expect(policy).toContain("'nonce-test-nonce'");
  });
});

describe('parseCSPString', () => {
  it('parses source list directives', () => {
    const directives = parseCSPString("default-src 'self'; script-src 'self' https://cdn.example.com");
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'", 'https://cdn.example.com']);
  });

  it('parses boolean directives', () => {
    const directives = parseCSPString("default-src 'self'; upgrade-insecure-requests");
    expect(directives['upgrade-insecure-requests']).toBe(true);
  });

  it('parses block-all-mixed-content', () => {
    const directives = parseCSPString("default-src 'self'; block-all-mixed-content");
    expect(directives['block-all-mixed-content']).toBe(true);
  });

  it('parses frame-ancestors', () => {
    const directives = parseCSPString("frame-ancestors 'none'");
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
  });

  it('parses report-to', () => {
    const directives = parseCSPString("default-src 'self'; report-to csp-group");
    expect(directives['report-to']).toBe('csp-group');
  });

  it('parses sandbox', () => {
    const directives = parseCSPString("sandbox allow-scripts allow-same-origin");
    expect(directives.sandbox).toEqual(['allow-scripts', 'allow-same-origin']);
  });

  it('roundtrips with buildCSPString', () => {
    const original = {
      'default-src': ["'self'"] as string[],
      'script-src': ["'self'", 'https://cdn.example.com'] as string[],
      'object-src': ["'none'"] as string[],
    };
    const policy = buildCSPString(original);
    const parsed = parseCSPString(policy);
    expect(parsed['default-src']).toEqual(original['default-src']);
    expect(parsed['script-src']).toEqual(original['script-src']);
    expect(parsed['object-src']).toEqual(original['object-src']);
  });
});
