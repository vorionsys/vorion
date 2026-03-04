/**
 * Single source of truth for monitored resources.
 * Ported from bai-cc-dashboard/functions/scheduled.ts.
 */

export const MONITORED_DOMAINS = [
  // Vorion
  { domain: 'vorion.org', label: 'Vorion Main', org: 'vorion' as const },
  { domain: 'basis.vorion.org', label: 'BASIS Spec', org: 'vorion' as const },
  { domain: 'carid.vorion.org', label: 'CAR ID', org: 'vorion' as const },
  { domain: 'atsf.vorion.org', label: 'ATSF Docs', org: 'vorion' as const },
  { domain: 'learn.vorion.org', label: 'Kaizen', org: 'vorion' as const },
  { domain: 'car.vorion.org', label: 'CAR Spec', org: 'vorion' as const },
  { domain: 'aci.vorion.org', label: 'ACI Docs', org: 'vorion' as const },
  { domain: 'feedback.vorion.org', label: 'Feedback', org: 'vorion' as const },
  { domain: 'opensource.vorion.org', label: 'Open Source', org: 'vorion' as const },
  // AgentAnchor
  { domain: 'agentanchorai.com', label: 'AgentAnchor', org: 'agentanchor' as const },
  { domain: 'app.agentanchorai.com', label: 'AA Platform', org: 'agentanchor' as const },
  { domain: 'trust.agentanchorai.com', label: 'Trust Portal', org: 'agentanchor' as const },
  { domain: 'logic.agentanchorai.com', label: 'Logic Portal', org: 'agentanchor' as const },
  { domain: 'status.agentanchorai.com', label: 'Status Page', org: 'agentanchor' as const },
  { domain: 'verify.agentanchorai.com', label: 'Verify Portal', org: 'agentanchor' as const },
  { domain: 'aurais.agentanchorai.com', label: 'Aurais', org: 'agentanchor' as const },
  // Other
  { domain: 'cognigate.dev', label: 'Cognigate', org: 'agentanchor' as const },
  { domain: 'bai-cc.com', label: 'BAI CC', org: 'vorion' as const },
] as const;

export const MONITORED_WORKFLOWS = [
  { id: 'ci.yml', name: 'CI', description: 'TypeScript build + lint + typecheck' },
  { id: 'ci-python.yml', name: 'Python CI', description: 'Cognigate API tests' },
  { id: 'secrets-scan.yml', name: 'Secrets Scan', description: 'Credential leak detection' },
  { id: 'deploy.yml', name: 'Deploy', description: 'Production deployment' },
  { id: 'preview.yml', name: 'Preview', description: 'PR preview deployments' },
  { id: 'schema-check.yml', name: 'Schema Check', description: 'Schema drift detection' },
  { id: 'publish-packages.yml', name: 'Publish', description: 'npm package publishing' },
] as const;

export const MONITORED_PACKAGES = [
  { name: '@vorionsys/basis', label: 'BASIS Standard' },
  { name: '@vorionsys/shared-constants', label: 'Shared Constants' },
  { name: '@vorionsys/contracts', label: 'Contracts' },
  { name: '@vorionsys/car-spec', label: 'CAR Spec' },
  { name: '@vorionsys/cognigate', label: 'Cognigate SDK' },
  { name: '@vorionsys/atsf-core', label: 'ATSF Core' },
  { name: '@vorionsys/proof-plane', label: 'Proof Plane' },
] as const;

export const GITHUB_REPO = 'vorionsys/vorion';
export const GITHUB_REPO_PUBLIC = 'vorionsys/vorion';
