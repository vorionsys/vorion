/**
 * INTENT GATEWAY Types
 * @packageDocumentation
 */
import type { TenantContext } from "../common/tenant-context.js";
import type { ID, TrustLevel } from "../common/types.js";
import type { Intent } from "../common/types.js";
import type { SubmitOptions } from "../intent/types.js";

export const JURISDICTIONS = [
  "GLOBAL",
  "EU",
  "US",
  "US-FED",
  "US-DOD",
  "UK",
  "CA",
  "AU",
  "JP",
  "KR",
  "SG",
  "CH",
  "CN",
  "IN",
  "BR",
  "IL",
  "AE",
  "SA",
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];
export const INDUSTRIES = [
  "general",
  "healthcare",
  "finance",
  "defense",
  "government",
  "education",
  "energy",
  "telecom",
  "automotive",
  "pharma",
] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const CRYPTO_SUITES = [
  "standard",
  "fips-140-2",
  "sm-national",
  "post-quantum",
  "cnsa-2.0",
] as const;
export type CryptoSuite = (typeof CRYPTO_SUITES)[number];
export const PROOF_ANCHORING_METHODS = [
  "database",
  "merkle-tree",
  "blockchain-l2",
  "tsa-rfc3161",
  "hardware-hsm",
] as const;
export type ProofAnchoringMethod = (typeof PROOF_ANCHORING_METHODS)[number];
export const CONSENT_MODELS = [
  "implicit",
  "opt-out",
  "opt-in",
  "explicit-granular",
  "dual-consent",
] as const;
export type ConsentModel = (typeof CONSENT_MODELS)[number];
export const ESCALATION_MODES = [
  "log-only",
  "flag-review",
  "block-escalate",
  "hard-block",
] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];
export const AI_ACT_CLASSIFICATIONS = [
  "unacceptable",
  "high-risk",
  "gpai",
  "limited-risk",
  "minimal-risk",
] as const;
export type AiActClassification = (typeof AI_ACT_CLASSIFICATIONS)[number];
export const AI_ACT_HIGH_RISK_CATEGORIES = [
  "biometric-identification",
  "critical-infrastructure",
  "education-vocational",
  "employment-worker-management",
  "essential-services",
  "law-enforcement",
  "migration-asylum-border",
  "justice-democratic",
] as const;
export type AiActHighRiskCategory =
  (typeof AI_ACT_HIGH_RISK_CATEGORIES)[number];

export type JurisdictionSource =
  | "tenant-config"
  | "metadata-inference"
  | "default";

export interface JurisdictionContext {
  primaryJurisdictions: Jurisdiction[];
  industry: Industry;
  dataResidency: string;
  crossBorderTransfer: boolean;
  source: JurisdictionSource;
}

export interface GovernanceRegime {
  regimeId: string;
  name: string;
  jurisdictions: Jurisdiction[];
  policyNamespaces: string[];
  cryptoSuite: CryptoSuite;
  proofAnchoring: ProofAnchoringMethod;
  auditRetentionDays: number;
  consentModel: ConsentModel;
  escalationMode: EscalationMode;
  dataResidency: string;
  externalServicesAllowed: boolean;
  minimumTrustLevel: TrustLevel;
  aiActClassification?: AiActClassification;
  aiActHighRiskCategory?: AiActHighRiskCategory;
  conformityAssessmentRequired: boolean;
  transparencyRequired: boolean;
  fedrampImpactLevel?: "low" | "moderate" | "high";
  metadata: Record<string, unknown>;
}

export type PolicyConstraintType =
  | "retention"
  | "crypto"
  | "consent"
  | "escalation"
  | "data-residency"
  | "trust-level"
  | "external-services"
  | "proof-anchoring"
  | "access-control"
  | "processing-restriction"
  | "audit-requirement"
  | "security-clearance";
export type EnforcementLevel =
  | "advisory"
  | "required"
  | "mandatory"
  | "blocking";

export interface PolicyConstraint {
  id: string;
  type: PolicyConstraintType;
  rule: string;
  enforcement: EnforcementLevel;
  sourceBundleId: string;
  sourceJurisdiction: Jurisdiction;
  value: unknown;
}

export type ConflictSeverity = "low" | "medium" | "high" | "critical";

export interface PolicyConflict {
  constraintType: PolicyConstraintType;
  constraints: PolicyConstraint[];
  description: string;
  severity: ConflictSeverity;
}

export interface ComposedPolicySet {
  constraints: PolicyConstraint[];
  sourceBundles: string[];
  resolvedConflicts: PolicyConflict[];
  unresolvedConflicts: PolicyConflict[];
  isValid: boolean;
  composedAt: number;
}

export interface GatewayDispatchResult {
  intent: Intent;
  regime: GovernanceRegime;
  jurisdictionContext: JurisdictionContext;
  policySet: ComposedPolicySet;
  warnings: string[];
}

export interface TenantJurisdictionConfig {
  jurisdictions: Jurisdiction[];
  industry: Industry;
  dataResidency?: string;
  customPolicyBundles?: string[];
  regimeOverrides?: Partial<
    Pick<
      GovernanceRegime,
      | "cryptoSuite"
      | "proofAnchoring"
      | "consentModel"
      | "escalationMode"
      | "minimumTrustLevel"
    >
  >;
}

export interface IntentGatewayConfig {
  enabled: boolean;
  defaultJurisdiction: Jurisdiction;
  defaultIndustry: Industry;
  regimeCacheTtlMs: number;
  blockOnConflicts: boolean;
  logRegimeDecisions: boolean;
}

export const DEFAULT_GATEWAY_CONFIG: IntentGatewayConfig = {
  enabled: true,
  defaultJurisdiction: "GLOBAL",
  defaultIndustry: "general",
  regimeCacheTtlMs: 5 * 60 * 1000,
  blockOnConflicts: true,
  logRegimeDecisions: true,
};

export type { ID, TrustLevel, Intent, TenantContext, SubmitOptions };
