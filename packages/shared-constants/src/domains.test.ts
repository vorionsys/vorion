import { describe, it, expect } from 'vitest';
import {
  VORION_DOMAINS,
  AGENTANCHOR_DOMAINS,
  COGNIGATE_DOMAINS,
  API_ENDPOINTS,
  VORION_EMAILS,
  AGENTANCHOR_EMAILS,
  GITHUB,
  NPM_PACKAGES,
  ALL_DOMAINS,
  DOMAIN_ALIASES,
} from './domains.js';

describe('VORION_DOMAINS', () => {
  it('has expected domain keys', () => {
    expect(VORION_DOMAINS.main).toBe('https://vorion.org');
    expect(VORION_DOMAINS.basis).toBe('https://basis.vorion.org');
    expect(VORION_DOMAINS.carId).toBe('https://carid.vorion.org');
    expect(VORION_DOMAINS.atsf).toBe('https://atsf.vorion.org');
    expect(VORION_DOMAINS.learn).toBe('https://learn.vorion.org');
    expect(VORION_DOMAINS.kaizen).toBe('https://kaizen.vorion.org');
  });

  it('all domains are HTTPS URLs', () => {
    for (const url of Object.values(VORION_DOMAINS)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe('AGENTANCHOR_DOMAINS', () => {
  it('has expected domain keys', () => {
    expect(AGENTANCHOR_DOMAINS.main).toBe('https://agentanchorai.com');
    expect(AGENTANCHOR_DOMAINS.trust).toContain('agentanchorai.com');
    expect(AGENTANCHOR_DOMAINS.logic).toContain('agentanchorai.com');
  });

  it('all domains are HTTPS URLs', () => {
    for (const url of Object.values(AGENTANCHOR_DOMAINS)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe('COGNIGATE_DOMAINS', () => {
  it('has main and docs', () => {
    expect(COGNIGATE_DOMAINS.main).toBe('https://cognigate.dev');
    expect(COGNIGATE_DOMAINS.docs).toBe('https://cognigate.dev/docs');
  });
});

describe('API_ENDPOINTS', () => {
  it('has cognigate endpoints', () => {
    expect(API_ENDPOINTS.cognigate.production).toContain('cognigate.dev');
    expect(API_ENDPOINTS.cognigate.staging).toContain('staging');
  });

  it('has agentAnchor endpoints', () => {
    expect(API_ENDPOINTS.agentAnchor.production).toContain('agentanchorai.com');
    expect(API_ENDPOINTS.agentAnchor.sandbox).toContain('sandbox');
  });

  it('all endpoints are HTTPS URLs', () => {
    for (const service of Object.values(API_ENDPOINTS)) {
      for (const url of Object.values(service)) {
        expect(url).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('VORION_EMAILS', () => {
  it('has standard email addresses', () => {
    expect(VORION_EMAILS.info).toContain('@vorion.org');
    expect(VORION_EMAILS.security).toContain('@vorion.org');
    expect(VORION_EMAILS.legal).toContain('@vorion.org');
  });

  it('all emails have valid format', () => {
    for (const email of Object.values(VORION_EMAILS)) {
      expect(email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
    }
  });
});

describe('AGENTANCHOR_EMAILS', () => {
  it('has support and sales emails', () => {
    expect(AGENTANCHOR_EMAILS.support).toContain('@agentanchorai.com');
    expect(AGENTANCHOR_EMAILS.sales).toContain('@agentanchorai.com');
  });

  it('all emails have valid format', () => {
    for (const email of Object.values(AGENTANCHOR_EMAILS)) {
      expect(email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
    }
  });
});

describe('GITHUB', () => {
  it('has vorion org and repo', () => {
    expect(GITHUB.vorion.org).toContain('github.com');
    expect(GITHUB.vorion.mainRepo).toContain('github.com');
  });
});

describe('NPM_PACKAGES', () => {
  it('has vorion scoped packages', () => {
    expect(NPM_PACKAGES.vorion.basis).toMatch(/^@vorionsys\//);
    expect(NPM_PACKAGES.vorion.contracts).toMatch(/^@vorionsys\//);
  });

  it('has agentAnchor scoped packages', () => {
    expect(NPM_PACKAGES.agentAnchor.sdk).toMatch(/^@agentanchor\//);
  });
});

describe('ALL_DOMAINS', () => {
  it('aggregates all domain groups', () => {
    expect(ALL_DOMAINS.vorion).toBe(VORION_DOMAINS);
    expect(ALL_DOMAINS.agentAnchor).toBe(AGENTANCHOR_DOMAINS);
    expect(ALL_DOMAINS.cognigate).toBe(COGNIGATE_DOMAINS);
    expect(ALL_DOMAINS.api).toBe(API_ENDPOINTS);
  });
});

describe('DOMAIN_ALIASES', () => {
  it('maps kaizen to learn', () => {
    expect(DOMAIN_ALIASES['kaizen.vorion.org']).toBe('learn.vorion.org');
  });
});
