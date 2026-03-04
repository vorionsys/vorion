// =============================================================================
// BAI Command Center — Ecosystem Status
// Single source of truth for project wiring, deployment, and progress tracking.
// Update this file to reflect current state. The /ecosystem page reads from here.
//
// NOTE: This static data serves as a FALLBACK for build-time fetching.
// Pages (index.astro, packages/index.astro) fetch live data from:
//   - https://bai-cc.com/api/domains.json  (domain health)
//   - https://bai-cc.com/api/stats.json    (agent stats)
//   - https://bai-cc.com/api/npm.json      (npm download stats)
//   - https://registry.npmjs.org/@vorionsys/{name}  (package metadata)
//
// TODO: Auto-generate this file from real sources in CI pipeline.
// Recommended CI step: fetch from the APIs above and write updated values here
// so that even the fallback data stays reasonably fresh.
// =============================================================================

// --- Products ---

export type ProductStatus = 'GA' | 'BETA' | 'ALPHA' | 'DEV' | 'DEPRECATED';
export type ProductCategory = 'open-source' | 'commercial' | 'developer-tools' | 'education';

export interface Product {
  id: string;
  name: string;
  description: string;
  category: ProductCategory;
  status: ProductStatus;
  url: string;
  docsUrl?: string;
  npmPackage?: string;
  repo?: string;
  org: 'vorion' | 'agentanchor';
}

export const products: Product[] = [
  // Vorion Open Source
  { id: 'basis', name: 'BASIS', description: '8-tier trust framework with 23 factors, tier-gated capabilities, and KYA verification', category: 'open-source', status: 'GA', url: 'https://basis.vorion.org', npmPackage: '@vorionsys/basis', repo: 'packages/basis', org: 'vorion' },
  { id: 'car-id', name: 'CAR ID', description: 'Categorical Agentic Registry — universal agent identification', category: 'open-source', status: 'GA', url: 'https://carid.vorion.org', npmPackage: '@vorionsys/car-spec', repo: 'packages/car-spec', org: 'vorion' },
  { id: 'atsf', name: 'ATSF', description: 'Agent Trust & Safety Framework runtime', category: 'open-source', status: 'BETA', url: 'https://atsf.vorion.org', npmPackage: '@vorionsys/atsf-core', repo: 'packages/atsf-core', org: 'vorion' },
  { id: 'proof-plane', name: 'Proof Plane', description: 'Immutable audit trail for AI agent operations', category: 'open-source', status: 'BETA', url: 'https://vorion.org/proof-plane', npmPackage: '@vorionsys/proof-plane', repo: 'packages/proof-plane', org: 'vorion' },
  { id: 'contracts', name: 'Contracts', description: 'Shared Zod schemas and validators', category: 'open-source', status: 'BETA', url: 'https://vorion.org/contracts', npmPackage: '@vorionsys/contracts', repo: 'packages/contracts', org: 'vorion' },
  { id: 'kaizen', name: 'Kaizen', description: 'Interactive AI learning experience', category: 'education', status: 'BETA', url: 'https://learn.vorion.org', repo: 'kaizen', org: 'vorion' },
  // AgentAnchor Commercial
  { id: 'cognigate', name: 'Cognigate', description: 'Governance runtime enforcement API', category: 'commercial', status: 'GA', url: 'https://cognigate.dev', npmPackage: '@vorionsys/cognigate', repo: 'packages/cognigate', org: 'agentanchor' },
  { id: 'trust', name: 'Agent Anchor Trust', description: 'Real-time trust scoring and verification', category: 'commercial', status: 'GA', url: 'https://trust.agentanchorai.com', repo: 'apps/trust-www', org: 'agentanchor' },
  { id: 'logic', name: 'Agent Anchor Logic', description: 'Constraint-based policy engine', category: 'commercial', status: 'BETA', url: 'https://logic.agentanchorai.com', repo: 'apps/logic-www', org: 'agentanchor' },
  { id: 'platform', name: 'Agent Anchor Platform', description: 'Full agent governance platform', category: 'commercial', status: 'BETA', url: 'https://agentanchorai.com', repo: 'apps/agentanchor', org: 'agentanchor' },
];

// --- Domains ---

export interface DomainEntry {
  domain: string;
  purpose: string;
  appDir: string | null;
  hasCodebase: boolean;
  deployed: boolean;
  dnsConfigured: boolean;
}

export const domains: DomainEntry[] = [
  // Vorion
  { domain: 'vorion.org', purpose: 'Main organization site', appDir: 'vorion-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'basis.vorion.org', purpose: 'BASIS specification docs', appDir: 'docs/basis-docs', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'carid.vorion.org', purpose: 'CAR ID specification', appDir: 'apps/carid-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'atsf.vorion.org', purpose: 'ATSF framework docs', appDir: 'docs/atsf-docs', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'learn.vorion.org', purpose: 'Educational platform (Kaizen)', appDir: 'kaizen', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'kaizen.vorion.org', purpose: 'Alias for learn.vorion.org', appDir: 'kaizen', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'car.vorion.org', purpose: 'CAR specification docs', appDir: 'docs/car-docs', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'aci.vorion.org', purpose: 'ACI specification docs (legacy)', appDir: 'docs/aci-docs', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'feedback.vorion.org', purpose: 'Community feedback portal', appDir: 'apps/feedback-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'opensource.vorion.org', purpose: 'Open source portal', appDir: 'apps/opensource-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  // AgentAnchor
  { domain: 'agentanchorai.com', purpose: 'AgentAnchor marketing site', appDir: 'apps/agentanchor-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'app.agentanchorai.com', purpose: 'AgentAnchor platform', appDir: 'apps/agentanchor', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'aurais.agentanchorai.com', purpose: 'Aurais demo assistant', appDir: 'apps/aurais', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'trust.agentanchorai.com', purpose: 'Trust scoring portal', appDir: 'apps/trust-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'logic.agentanchorai.com', purpose: 'Policy engine portal', appDir: 'apps/logic-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'status.agentanchorai.com', purpose: 'Platform status page', appDir: 'apps/status-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'verify.agentanchorai.com', purpose: 'Trust verification portal', appDir: 'apps/verify-www', hasCodebase: true, deployed: true, dnsConfigured: true },
  // Other
  { domain: 'cognigate.dev', purpose: 'Cognigate main site', appDir: 'apps/cognigate-api', hasCodebase: true, deployed: true, dnsConfigured: true },
  { domain: 'bai-cc.com', purpose: 'BAI Command Center (internal)', appDir: 'apps/bai-cc-www', hasCodebase: true, deployed: true, dnsConfigured: true },
];

// --- Packages ---

export interface PackageEntry {
  name: string;
  version: string;
  published: boolean;
  sourceDir: string;
  npmUrl?: string;
}

export const packages: PackageEntry[] = [
  // Published (@vorionsys)
  { name: '@vorionsys/basis', version: '1.0.1', published: true, sourceDir: 'packages/basis', npmUrl: 'https://www.npmjs.com/package/@vorionsys/basis' },
  { name: '@vorionsys/shared-constants', version: '1.0.0', published: true, sourceDir: 'packages/shared-constants', npmUrl: 'https://www.npmjs.com/package/@vorionsys/shared-constants' },
  { name: '@vorionsys/contracts', version: '1.0.0', published: true, sourceDir: 'packages/contracts', npmUrl: 'https://www.npmjs.com/package/@vorionsys/contracts' },
  { name: '@vorionsys/car-spec', version: '1.1.0', published: true, sourceDir: 'packages/car-spec', npmUrl: 'https://www.npmjs.com/package/@vorionsys/car-spec' },
  { name: '@vorionsys/cognigate', version: '1.0.0', published: true, sourceDir: 'packages/cognigate', npmUrl: 'https://www.npmjs.com/package/@vorionsys/cognigate' },
  { name: '@vorionsys/atsf-core', version: '1.0.0', published: true, sourceDir: 'packages/atsf-core', npmUrl: 'https://www.npmjs.com/package/@vorionsys/atsf-core' },
  { name: '@vorionsys/proof-plane', version: '1.0.0', published: true, sourceDir: 'packages/proof-plane', npmUrl: 'https://www.npmjs.com/package/@vorionsys/proof-plane' },
  // Internal
  { name: '@vorion/council', version: '0.1.0', published: false, sourceDir: 'packages/council' },
  { name: '@vorion/ai-gateway', version: '0.1.0', published: false, sourceDir: 'packages/ai-gateway' },
  { name: '@vorion/runtime', version: '0.1.0', published: false, sourceDir: 'packages/runtime' },
  { name: '@vorion/security', version: '0.1.0', published: false, sourceDir: 'packages/security' },
  { name: '@vorion/sdk', version: '0.1.0', published: false, sourceDir: 'packages/sdk' },
  { name: '@vorion/agent-sdk', version: '0.1.0', published: false, sourceDir: 'packages/agent-sdk' },
  { name: '@vorion/agentanchor-sdk', version: '0.1.0', published: false, sourceDir: 'packages/agentanchor-sdk' },
  { name: '@vorion/car-client', version: '0.1.0', published: false, sourceDir: 'packages/car-client' },
  { name: '@vorion/car-cli', version: '0.1.0', published: false, sourceDir: 'packages/car-cli' },
  { name: '@vorion/car-python', version: '1.0.0', published: false, sourceDir: 'packages/car-python' },
];

// --- APIs ---

export interface ApiEntry {
  service: string;
  version: string;
  status: 'STABLE' | 'PREVIEW' | 'DEV';
  productionUrl: string;
  stagingUrl?: string;
  docsUrl?: string;
}

export const apis: ApiEntry[] = [
  { service: 'Cognigate', version: 'v1', status: 'STABLE', productionUrl: 'https://cognigate.dev/v1', stagingUrl: 'https://staging.cognigate.dev/v1' },
  { service: 'Trust API', version: 'v1', status: 'STABLE', productionUrl: 'https://trust.agentanchorai.com/v1', stagingUrl: 'https://staging.trust.agentanchorai.com/v1' },
  { service: 'Logic API', version: 'v1', status: 'PREVIEW', productionUrl: 'https://logic.agentanchorai.com/v1', stagingUrl: 'https://staging.logic.agentanchorai.com/v1' },
  { service: 'Platform API', version: 'v1', status: 'STABLE', productionUrl: 'https://api.agentanchorai.com/v1', stagingUrl: 'https://staging-api.agentanchorai.com/v1' },
  { service: 'BASIS Spec', version: 'v1', status: 'STABLE', productionUrl: 'https://basis.vorion.org', docsUrl: 'https://basis.vorion.org' },
  { service: 'CAR Spec', version: 'v1', status: 'STABLE', productionUrl: 'https://carid.vorion.org', docsUrl: 'https://carid.vorion.org' },
];

// --- Wiring Checklist ---

export interface WiringItem {
  category: string;
  description: string;
  done: boolean;
}

export const wiring: WiringItem[] = [
  // Standards → Packages
  { category: 'Standards', description: 'BASIS spec published to npm as @vorionsys/basis', done: true },
  { category: 'Standards', description: 'CAR spec published to npm as @vorionsys/car-spec', done: true },
  { category: 'Standards', description: 'Trust tiers (T0–T7) aligned across all packages', done: true },
  { category: 'Standards', description: 'shared-constants exports canonical tier definitions', done: true },

  // Packages → APIs
  { category: 'Packages', description: 'car-client SDK connects to Trust API', done: true },
  { category: 'Packages', description: 'car-python SDK connects to Trust API', done: true },
  { category: 'Packages', description: 'cognigate package implements policy evaluation', done: true },
  { category: 'Packages', description: 'atsf-core implements trust scoring runtime', done: true },
  { category: 'Packages', description: 'proof-plane logs to immutable audit trail', done: true },
  { category: 'Packages', description: 'contracts package Zod schemas used by all APIs', done: true },

  // APIs → Dashboard
  { category: 'Integration', description: 'AgentAnchor dashboard reads Trust API', done: true },
  { category: 'Integration', description: 'AgentAnchor dashboard reads agent registry', done: true },
  { category: 'Integration', description: 'BAI CC dashboard syncs agent stats from DB', done: true },
  { category: 'Integration', description: 'Cognigate runtime evaluates policies from Logic API', done: true },
  { category: 'Integration', description: 'Proof Plane receives events from Cognigate decisions', done: true },

  // Sites → Deployment
  { category: 'Deployment', description: 'vorion.org deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'basis.vorion.org deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'agentanchorai.com deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'app.agentanchorai.com deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'trust.agentanchorai.com deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'logic.agentanchorai.com deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'carid.vorion.org deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'status.agentanchorai.com deployed and DNS configured', done: true },
  { category: 'Deployment', description: 'verify.agentanchorai.com deployed and DNS configured', done: true },

  // CI/CD
  { category: 'CI/CD', description: 'GitHub Actions CI pipeline runs on all PRs', done: true },
  { category: 'CI/CD', description: 'All 17 packages build clean via turbo', done: true },
  { category: 'CI/CD', description: 'License checker in CI (MIT/Apache-2.0 allowlist)', done: true },
  { category: 'CI/CD', description: 'Dependabot auto-merge for patch updates', done: true },
  { category: 'CI/CD', description: 'npm publish workflow for @vorionsys packages', done: true },
  { category: 'CI/CD', description: 'Vercel preview deployments for all -www apps', done: true },
];
