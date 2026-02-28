/**
 * CAR Client SDK Types
 *
 * Type definitions for the Categorical Agentic Registry (CAR) standard.
 * Based on Phase 6 Trust Engine architecture decisions (Q1-Q5).
 */

import { z } from "zod";
import {
  type TrustTierCode,
  TIER_THRESHOLDS,
  TrustTier as TrustTierEnum,
} from "@vorionsys/shared-constants";

// =============================================================================
// ENUMS
// =============================================================================

/** Trust tiers from T0 (Sandbox) to T7 (Autonomous) — sourced from @vorionsys/shared-constants */
export type TrustTier = TrustTierCode;

/** Agent roles from R-L0 (Listener) to R-L8 (Ecosystem Controller) */
export type AgentRole =
  | "R_L0"
  | "R_L1"
  | "R_L2"
  | "R_L3"
  | "R_L4"
  | "R_L5"
  | "R_L6"
  | "R_L7"
  | "R_L8";

/** Context hierarchy types */
export type ContextType = "DEPLOYMENT" | "ORGANIZATION" | "AGENT" | "OPERATION";

/** Agent creation types for provenance */
export type CreationType =
  | "FRESH"
  | "CLONED"
  | "EVOLVED"
  | "PROMOTED"
  | "IMPORTED";

/** Role gate evaluation decisions */
export type RoleGateDecision = "ALLOW" | "DENY" | "ESCALATE";

/** Compliance status for ceiling events */
export type ComplianceStatus = "COMPLIANT" | "WARNING" | "VIOLATION";

/** Gaming alert types */
export type GamingAlertType =
  | "RAPID_CHANGE"
  | "OSCILLATION"
  | "BOUNDARY_TESTING"
  | "CEILING_BREACH";

/** Alert severity levels */
export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Alert status */
export type AlertStatus =
  | "ACTIVE"
  | "INVESTIGATING"
  | "RESOLVED"
  | "FALSE_POSITIVE";

/** Supported compliance frameworks */
export type ComplianceFramework =
  | "EU_AI_ACT"
  | "NIST_AI_RMF"
  | "ISO_42001"
  | "DEFAULT";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Trust tier score ranges — derived from @vorionsys/shared-constants TIER_THRESHOLDS */
export const TRUST_TIER_RANGES: Record<
  TrustTier,
  { min: number; max: number }
> = Object.fromEntries(
  Object.entries(TIER_THRESHOLDS).map(([tier, cfg]) => [
    `T${tier}`,
    { min: cfg.min, max: cfg.max },
  ]),
) as Record<TrustTier, { min: number; max: number }>;

/** Trust tier labels — derived from @vorionsys/shared-constants TIER_THRESHOLDS */
export const TRUST_TIER_LABELS: Record<TrustTier, string> = Object.fromEntries(
  Object.entries(TIER_THRESHOLDS).map(([tier, cfg]) => [`T${tier}`, cfg.name]),
) as Record<TrustTier, string>;

/** Agent role labels */
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  R_L0: "Listener",
  R_L1: "Executor",
  R_L2: "Planner",
  R_L3: "Orchestrator",
  R_L4: "Architect",
  R_L5: "Governor",
  R_L6: "Sovereign",
  R_L7: "Meta-Agent",
  R_L8: "Ecosystem Controller",
};

/** Default provenance modifiers by creation type */
export const DEFAULT_PROVENANCE_MODIFIERS: Record<CreationType, number> = {
  FRESH: 0,
  CLONED: -50,
  EVOLVED: 100,
  PROMOTED: 150,
  IMPORTED: -100,
};

/** Regulatory ceiling limits by framework */
export const REGULATORY_CEILINGS: Record<ComplianceFramework, number> = {
  EU_AI_ACT: 699,
  NIST_AI_RMF: 899,
  ISO_42001: 799,
  DEFAULT: 1000,
};

// =============================================================================
// INTERFACES
// =============================================================================

/** Client configuration options */
export interface CARClientConfig {
  /** Base URL for the CAR API */
  baseUrl: string;
  /** API key for authentication (optional) */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/** API response wrapper */
export interface CARResponse<T> {
  data: T;
  error?: string;
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

// -----------------------------------------------------------------------------
// Q2: Hierarchical Context Types
// -----------------------------------------------------------------------------

/** Deployment context (Tier 1 - IMMUTABLE) */
export interface DeploymentContext {
  id: string;
  deploymentId: string;
  name: string;
  version: string;
  environment: "development" | "staging" | "production";
  regulatoryJurisdiction?: string;
  maxTrustCeiling: number;
  contextHash: string;
  frozenAt: string;
  createdAt: string;
}

/** Organization context (Tier 2 - LOCKED after grace period) */
export interface OrgContext {
  id: string;
  deploymentId: string;
  orgId: string;
  name: string;
  complianceFrameworks: ComplianceFramework[];
  trustCeiling: number;
  contextHash: string;
  parentHash: string;
  lockedAt?: string;
  gracePeriodEnds?: string;
  createdAt: string;
  updatedAt: string;
}

/** Agent context (Tier 3 - FROZEN on registration) */
export interface AgentContext {
  id: string;
  deploymentId: string;
  orgId: string;
  agentId: string;
  name: string;
  capabilities: string[];
  trustCeiling: number;
  contextHash: string;
  parentHash: string;
  frozenAt: string;
  createdAt: string;
}

/** Operation context (Tier 4 - EPHEMERAL) */
export interface OperationContext {
  id: string;
  deploymentId: string;
  orgId: string;
  agentId: string;
  operationId: string;
  operationType: string;
  requestedRole: AgentRole;
  contextHash: string;
  parentHash: string;
  startedAt: string;
  completedAt?: string;
  ttlSeconds: number;
}

/** Full context hierarchy */
export interface ContextHierarchy {
  deployments: DeploymentContext[];
  organizations: OrgContext[];
  agents: AgentContext[];
  operations: OperationContext[];
  summary: {
    deploymentCount: number;
    orgCount: number;
    agentCount: number;
    activeOperations: number;
  };
}

// -----------------------------------------------------------------------------
// Q3: Role Gates Types
// -----------------------------------------------------------------------------

/** Role gate evaluation result */
export interface RoleGateEvaluation {
  id: string;
  agentId: string;
  requestedRole: AgentRole;
  currentTier: TrustTier;
  currentScore: number;
  kernelAllowed: boolean;
  policyResult?: RoleGateDecision;
  policyApplied?: string;
  basisOverrideUsed: boolean;
  basisApprovers?: string[];
  finalDecision: RoleGateDecision;
  decisionReason?: string;
  operationId?: string;
  attestations?: string[];
  createdAt: string;
}

/** Role gate evaluation request */
export interface RoleGateRequest {
  agentId: string;
  requestedRole: AgentRole;
  currentTier: TrustTier;
  currentScore?: number;
  operationId?: string;
  attestations?: string[];
}

/** Role gate evaluation response */
export interface RoleGateResponse {
  evaluation: RoleGateEvaluation;
  layers: {
    kernel: { allowed: boolean };
    policy: { result?: RoleGateDecision; applied?: string };
    basis: { overrideUsed: boolean };
  };
}

// -----------------------------------------------------------------------------
// Q1: Ceiling & Gaming Types
// -----------------------------------------------------------------------------

/** Ceiling event */
export interface CeilingEvent {
  id: string;
  agentId: string;
  eventType: string;
  previousScore: number;
  proposedScore: number;
  finalScore: number;
  effectiveCeiling: number;
  ceilingSource: "regulatory" | "organizational" | "agent";
  ceilingApplied: boolean;
  complianceStatus: ComplianceStatus;
  complianceFramework?: ComplianceFramework;
  auditRequired: boolean;
  retentionDays?: number;
  createdAt: string;
}

/** Ceiling check request */
export interface CeilingCheckRequest {
  agentId: string;
  previousScore?: number;
  proposedScore: number;
  complianceFramework?: ComplianceFramework;
  organizationalCeiling?: number;
}

/** Ceiling check response */
export interface CeilingCheckResponse {
  result: {
    agentId: string;
    previousScore?: number;
    proposedScore: number;
    finalScore: number;
    effectiveCeiling: number;
    ceilingSource: "regulatory" | "organizational";
    ceilingApplied: boolean;
    complianceStatus: ComplianceStatus;
    complianceFramework?: ComplianceFramework;
    auditRequired: boolean;
    retentionDays?: number;
    gamingIndicators: GamingAlertType[];
  };
  ceilingDetails: {
    regulatory: {
      framework: ComplianceFramework;
      ceiling: number;
      article?: string;
    };
    organizational: {
      ceiling: number;
    };
    effective: number;
  };
}

/** Gaming alert */
export interface GamingAlert {
  id: string;
  agentId: string;
  alertType: GamingAlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  details: string;
  occurrences: number;
  thresholdValue?: number;
  actualValue?: number;
  windowStart: string;
  windowEnd: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Gaming alert create request */
export interface GamingAlertCreateRequest {
  agentId: string;
  alertType: GamingAlertType;
  severity: AlertSeverity;
  details: string;
  occurrences?: number;
  thresholdValue?: number;
  actualValue?: number;
  windowStart?: string;
  windowEnd?: string;
}

// -----------------------------------------------------------------------------
// Q4: Federated Presets Types
// -----------------------------------------------------------------------------

/** CAR canonical preset (immutable reference) */
export interface CARPreset {
  id: string;
  presetId: string;
  name: string;
  description?: string;
  weights: Record<string, number>;
  constraints: Record<string, unknown>;
  presetHash: string;
  version: number;
  createdAt: string;
}

/** Vorion reference preset (derived from CAR) */
export interface VorionPreset {
  id: string;
  presetId: string;
  parentCarIdPresetId: string;
  name: string;
  description?: string;
  weightOverrides: Record<string, number>;
  additionalConstraints: Record<string, unknown>;
  presetHash: string;
  parentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Axiom deployment preset (derived from Vorion) */
export interface AxiomPreset {
  id: string;
  presetId: string;
  deploymentId: string;
  parentVorionPresetId: string;
  name: string;
  weightOverrides: Record<string, number>;
  deploymentConstraints: Record<string, unknown>;
  presetHash: string;
  parentHash: string;
  lineageVerified: boolean;
  lineageVerifiedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Preset lineage */
export interface PresetLineage {
  axiom: { id: string; name: string; verified: boolean };
  vorion: { id: string; name: string } | null;
  carId: { id: string; name: string } | null;
}

/** Preset hierarchy */
export interface PresetHierarchy {
  carId: CARPreset[];
  vorion: VorionPreset[];
  axiom: AxiomPreset[];
  summary: {
    carIdCount: number;
    vorionCount: number;
    axiomCount: number;
    verifiedLineages: number;
  };
  lineages: PresetLineage[];
}

// -----------------------------------------------------------------------------
// Q5: Provenance Types
// -----------------------------------------------------------------------------

/** Agent provenance record */
export interface Provenance {
  id: string;
  agentId: string;
  creationType: CreationType;
  parentAgentId?: string;
  createdBy: string;
  originDeployment?: string;
  originOrg?: string;
  trustModifier: number;
  provenanceHash: string;
  parentProvenanceHash?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Provenance create request */
export interface ProvenanceCreateRequest {
  agentId: string;
  creationType: CreationType;
  parentAgentId?: string;
  createdBy: string;
  originDeployment?: string;
  originOrg?: string;
  metadata?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Stats & Dashboard Types
// -----------------------------------------------------------------------------

/** Phase 6 statistics */
export interface Phase6Stats {
  contextStats: {
    deployments: number;
    organizations: number;
    agents: number;
    activeOperations: number;
  };
  ceilingStats: {
    totalEvents: number;
    totalAuditEntries: number;
    complianceBreakdown: {
      compliant: number;
      warning: number;
      violation: number;
    };
    agentsWithAlerts: number;
  };
  roleGateStats: {
    totalEvaluations: number;
    byDecision: {
      ALLOW: number;
      DENY: number;
      ESCALATE: number;
    };
  };
  presetStats: {
    carIdPresets: number;
    vorionPresets: number;
    axiomPresets: number;
    verifiedLineages: number;
  };
  provenanceStats: {
    totalRecords: number;
    byCreationType: Record<CreationType, number>;
  };
}

/** Trust tier distribution data */
export interface TrustTierData {
  tier: TrustTier;
  label: string;
  range: string;
  count: number;
  color: string;
}

/** Recent trust event */
export interface RecentEvent {
  id: string;
  type: "ceiling" | "role_gate" | "context" | "provenance";
  agentId: string;
  decision?: string;
  status: ComplianceStatus;
  timestamp: string;
}

/** Dashboard data response */
export interface DashboardData {
  stats: Phase6Stats;
  tierDistribution: TrustTierData[];
  recentEvents: RecentEvent[];
  version: {
    major: number;
    minor: number;
    patch: number;
    label: string;
    decisions: string[];
  };
}

// =============================================================================
// ZOD SCHEMAS (for runtime validation)
// =============================================================================

export const TrustTierSchema = z.enum([
  "T0",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
]);
export const AgentRoleSchema = z.enum([
  "R_L0",
  "R_L1",
  "R_L2",
  "R_L3",
  "R_L4",
  "R_L5",
  "R_L6",
  "R_L7",
  "R_L8",
]);
export const CreationTypeSchema = z.enum([
  "FRESH",
  "CLONED",
  "EVOLVED",
  "PROMOTED",
  "IMPORTED",
]);
export const RoleGateDecisionSchema = z.enum(["ALLOW", "DENY", "ESCALATE"]);
export const ComplianceStatusSchema = z.enum([
  "COMPLIANT",
  "WARNING",
  "VIOLATION",
]);
export const GamingAlertTypeSchema = z.enum([
  "RAPID_CHANGE",
  "OSCILLATION",
  "BOUNDARY_TESTING",
  "CEILING_BREACH",
]);
export const AlertSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
export const AlertStatusSchema = z.enum([
  "ACTIVE",
  "INVESTIGATING",
  "RESOLVED",
  "FALSE_POSITIVE",
]);

export const RoleGateRequestSchema = z.object({
  agentId: z.string().min(1),
  requestedRole: AgentRoleSchema,
  currentTier: TrustTierSchema,
  currentScore: z.number().optional(),
  operationId: z.string().optional(),
  attestations: z.array(z.string()).optional(),
});

export const CeilingCheckRequestSchema = z.object({
  agentId: z.string().min(1),
  previousScore: z.number().optional(),
  proposedScore: z.number().min(0).max(1000),
  complianceFramework: z
    .enum(["EU_AI_ACT", "NIST_AI_RMF", "ISO_42001", "DEFAULT"])
    .optional(),
  organizationalCeiling: z.number().optional(),
});

export const ProvenanceCreateRequestSchema = z.object({
  agentId: z.string().min(1),
  creationType: CreationTypeSchema,
  parentAgentId: z.string().optional(),
  createdBy: z.string().min(1),
  originDeployment: z.string().optional(),
  originOrg: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// UTILITY TYPES
// =============================================================================

/** Compute trust tier from score — canonical 8-tier model (T0-T7) */
export function getTierFromScore(score: number): TrustTier {
  if (score >= 951) return "T7";
  if (score >= 876) return "T6";
  if (score >= 800) return "T5";
  if (score >= 650) return "T4";
  if (score >= 500) return "T3";
  if (score >= 350) return "T2";
  if (score >= 200) return "T1";
  return "T0";
}

/** Check if role is allowed for tier (kernel layer) */
export function isRoleAllowedForTier(
  role: AgentRole,
  tier: TrustTier,
): boolean {
  const roleLevel = parseInt(role.split("_L")[1]);
  const tierLevel = parseInt(tier.slice(1));

  // R-L0, R-L1: Any tier
  if (roleLevel <= 1) return true;
  // R-L2: T1+
  if (roleLevel === 2) return tierLevel >= 1;
  // R-L3: T2+
  if (roleLevel === 3) return tierLevel >= 2;
  // R-L4: T3+
  if (roleLevel === 4) return tierLevel >= 3;
  // R-L5: T4+
  if (roleLevel === 5) return tierLevel >= 4;
  // R-L6, R-L7, R-L8: T5 only
  return tierLevel >= 5;
}
