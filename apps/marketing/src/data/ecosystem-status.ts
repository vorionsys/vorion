// =============================================================================
// Vorion Ecosystem Status
// Single source of truth for products, packages, and APIs.
// Update this file to reflect current state.
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
  { id: 'trust', name: 'Vorion Trust', description: 'Real-time trust scoring and verification', category: 'commercial', status: 'GA', url: 'https://trust.vorion.org', repo: 'apps/trust-www', org: 'agentanchor' },
  { id: 'logic', name: 'Vorion Logic', description: 'Constraint-based policy engine', category: 'commercial', status: 'BETA', url: 'https://logic.vorion.org', repo: 'apps/logic-www', org: 'agentanchor' },
  { id: 'platform', name: 'AgentAnchor Platform', description: 'Full agent governance platform', category: 'commercial', status: 'BETA', url: 'https://agentanchorai.com', repo: 'apps/agentanchor', org: 'agentanchor' },
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
  { service: 'Trust API', version: 'v1', status: 'STABLE', productionUrl: 'https://trust.vorion.org/v1' },
  { service: 'Logic API', version: 'v1', status: 'PREVIEW', productionUrl: 'https://logic.vorion.org/v1' },
  { service: 'Platform API', version: 'v1', status: 'STABLE', productionUrl: 'https://api.agentanchorai.com/v1' },
  { service: 'BASIS Spec', version: 'v1', status: 'STABLE', productionUrl: 'https://basis.vorion.org', docsUrl: 'https://basis.vorion.org' },
  { service: 'CAR Spec', version: 'v1', status: 'STABLE', productionUrl: 'https://carid.vorion.org', docsUrl: 'https://carid.vorion.org' },
];
