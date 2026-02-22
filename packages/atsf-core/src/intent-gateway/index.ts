/**
 * INTENT GATEWAY - Jurisdictional Router & Governance Topology Selector
 *
 * The Intent Gateway is the policy-aware front door for all agent intents.
 * It resolves the operational jurisdiction from tenant context, composes
 * applicable policy bundles (with deterministic conflict resolution), selects
 * the governance regime that will supervise execution, and enriches the
 * submit options with the regime's minimum trust level and metadata.
 *
 * Pipeline: intake -> jurisdiction resolution -> policy composition
 *           -> regime selection -> enriched submit
 *
 * Key design decisions exposed in this open-source version:
 *   - Jurisdiction is a first-class concept, not an afterthought.
 *   - Policy conflicts are detected eagerly and resolved deterministically
 *     (strictest-wins for ordered dimensions, additive for unordered ones).
 *   - EU AI Act risk classification runs inline for EU jurisdictions.
 *   - Every regime carries a minimum trust level; the gateway enforces it.
 *   - The gateway degrades gracefully: on error it falls through to
 *     passthrough mode with a warning, never silently drops an intent.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';

import type { TrustLevel, Intent } from '../common/types.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger({ component: 'intent-gateway' });

// ---------------------------------------------------------------------------
// Constants & Union Types
// ---------------------------------------------------------------------------

/** Supported jurisdictional scopes. */
export const JURISDICTIONS = [
  'GLOBAL', 'EU', 'US', 'APAC', 'UK', 'CA', 'AU', 'JP', 'SG', 'CH',
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/** Industry verticals that affect policy selection. */
export const INDUSTRIES = [
  'general', 'healthcare', 'finance', 'defense', 'government',
  'education', 'energy',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Cryptographic suite requirements, ordered by strictness. */
export const CRYPTO_SUITES = [
  'standard', 'fips-140-2', 'post-quantum',
] as const;
export type CryptoSuite = (typeof CRYPTO_SUITES)[number];

/** Proof anchoring methods, ordered by assurance level. */
export const PROOF_ANCHORING_METHODS = [
  'database', 'merkle-tree', 'blockchain-l2', 'tsa-rfc3161',
] as const;
export type ProofAnchoringMethod = (typeof PROOF_ANCHORING_METHODS)[number];

/** Consent models, ordered by strictness. */
export const CONSENT_MODELS = [
  'implicit', 'opt-out', 'opt-in', 'explicit-granular',
] as const;
export type ConsentModel = (typeof CONSENT_MODELS)[number];

/** Escalation modes, ordered by severity. */
export const ESCALATION_MODES = [
  'log-only', 'flag-review', 'block-escalate', 'hard-block',
] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];

/** EU AI Act risk classification tiers. */
export const AI_ACT_CLASSIFICATIONS = [
  'unacceptable', 'high-risk', 'limited-risk', 'minimal-risk',
] as const;
export type AiActClassification = (typeof AI_ACT_CLASSIFICATIONS)[number];

/** High-risk categories under Annex III of the EU AI Act. */
export const AI_ACT_HIGH_RISK_CATEGORIES = [
  'biometric-identification',
  'critical-infrastructure',
  'education-vocational',
  'employment-worker-management',
  'essential-services',
  'law-enforcement',
  'migration-asylum-border',
  'justice-democratic',
] as const;
export type AiActHighRiskCategory = (typeof AI_ACT_HIGH_RISK_CATEGORIES)[number];

/** How the jurisdiction was determined. */
export type JurisdictionSource = 'tenant-config' | 'metadata-inference' | 'default';

/** Enforcement strength of a policy constraint. */
export type EnforcementLevel = 'advisory' | 'required' | 'mandatory' | 'blocking';

/** Policy constraint categories. */
export type PolicyConstraintType =
  | 'retention'
  | 'crypto'
  | 'consent'
  | 'escalation'
  | 'data-residency'
  | 'trust-level'
  | 'external-services'
  | 'proof-anchoring'
  | 'audit-requirement'
  | 'processing-restriction';

/** Severity of a policy conflict. */
export type ConflictSeverity = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/**
 * Resolved jurisdictional context for an intent.
 *
 * This tells every downstream component where the intent lives legally,
 * what industry rules apply, and whether cross-border transfer is involved.
 */
export interface JurisdictionContext {
  /** Primary jurisdictions that apply to this intent. */
  primaryJurisdictions: Jurisdiction[];
  /** Industry vertical (drives sector-specific policy bundles). */
  industry: Industry;
  /** Data residency zone identifier (e.g. "eu-west", "us-east"). */
  dataResidency: string;
  /** Whether the intent involves cross-border data transfer. */
  crossBorderTransfer: boolean;
  /** How the jurisdiction was resolved. */
  source: JurisdictionSource;
}

/**
 * A governance regime is the complete set of operational parameters
 * determined by jurisdiction + policy composition.
 *
 * Every intent that passes through the gateway is tagged with a regime.
 * The regime drives crypto suite selection, proof anchoring, consent model,
 * escalation behavior, minimum trust level, and regulatory metadata.
 */
export interface GovernanceRegime {
  /** Deterministic identifier derived from regime parameters. */
  regimeId: string;
  /** Human-readable regime name. */
  name: string;
  /** Jurisdictions covered by this regime. */
  jurisdictions: Jurisdiction[];
  /** Policy namespaces (bundle IDs) that contributed to this regime. */
  policyNamespaces: string[];
  /** Required cryptographic suite. */
  cryptoSuite: CryptoSuite;
  /** Proof anchoring method. */
  proofAnchoring: ProofAnchoringMethod;
  /** Minimum audit log retention in days. */
  auditRetentionDays: number;
  /** Consent model for data processing. */
  consentModel: ConsentModel;
  /** Escalation behavior for policy violations. */
  escalationMode: EscalationMode;
  /** Data residency zone. */
  dataResidency: string;
  /** Whether external service calls are permitted. */
  externalServicesAllowed: boolean;
  /** Minimum trust level required to execute under this regime. */
  minimumTrustLevel: TrustLevel;
  /** EU AI Act risk classification (present for EU jurisdictions). */
  aiActClassification?: AiActClassification;
  /** Specific high-risk category if classified as high-risk. */
  aiActHighRiskCategory?: AiActHighRiskCategory;
  /** Whether EU conformity assessment is required. */
  conformityAssessmentRequired: boolean;
  /** Whether transparency obligations apply. */
  transparencyRequired: boolean;
  /** Extensible metadata. */
  metadata: Record<string, unknown>;
}

/**
 * A single policy constraint from a policy bundle.
 */
export interface PolicyConstraint {
  /** Unique constraint identifier. */
  id: string;
  /** Constraint category. */
  type: PolicyConstraintType;
  /** Human-readable rule description. */
  rule: string;
  /** Enforcement strength. */
  enforcement: EnforcementLevel;
  /** Which bundle contributed this constraint. */
  sourceBundleId: string;
  /** Which jurisdiction this constraint originates from. */
  sourceJurisdiction: Jurisdiction;
  /** The constraint value (numeric, string, or boolean depending on type). */
  value: unknown;
}

/**
 * A detected conflict between policy constraints.
 */
export interface PolicyConflict {
  /** The constraint type that has a conflict. */
  constraintType: PolicyConstraintType;
  /** The conflicting constraints. */
  constraints: PolicyConstraint[];
  /** Human-readable conflict description. */
  description: string;
  /** Conflict severity. */
  severity: ConflictSeverity;
}

/**
 * The composed policy set after merging all applicable bundles.
 */
export interface ComposedPolicySet {
  /** Final resolved constraints (after conflict resolution). */
  constraints: PolicyConstraint[];
  /** IDs of all bundles that contributed. */
  sourceBundles: string[];
  /** Conflicts that were resolved automatically. */
  resolvedConflicts: PolicyConflict[];
  /** Conflicts that could not be resolved (may block the intent). */
  unresolvedConflicts: PolicyConflict[];
  /** Whether the policy set is valid (no critical unresolved conflicts). */
  isValid: boolean;
  /** Composition timestamp. */
  composedAt: number;
}

/**
 * A named, prioritized collection of policy constraints.
 */
export interface PolicyBundle {
  /** Unique bundle identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Jurisdictions this bundle applies to. */
  jurisdictions: Jurisdiction[];
  /** Priority (higher number = higher priority in conflict resolution). */
  priority: number;
  /** The constraints in this bundle. */
  constraints: PolicyConstraint[];
}

/**
 * Tenant-level jurisdiction configuration.
 */
export interface TenantJurisdictionConfig {
  /** Jurisdictions assigned to this tenant. */
  jurisdictions: Jurisdiction[];
  /** Industry vertical. */
  industry: Industry;
  /** Optional data residency override. */
  dataResidency?: string;
  /** Additional policy bundle IDs to include. */
  customPolicyBundles?: string[];
}

/**
 * Gateway configuration.
 */
export interface IntentGatewayConfig {
  /** Whether the gateway is enabled (false = passthrough mode). */
  enabled: boolean;
  /** Default jurisdiction when none can be resolved. */
  defaultJurisdiction: Jurisdiction;
  /** Default industry when none can be inferred. */
  defaultIndustry: Industry;
  /** How long to cache resolved regimes per tenant (ms). */
  regimeCacheTtlMs: number;
  /** Whether to block intents that have unresolved critical conflicts. */
  blockOnConflicts: boolean;
  /** Whether to log regime decisions. */
  logRegimeDecisions: boolean;
}

/**
 * Result returned by IntentGateway.dispatch().
 */
export interface GatewayDispatchResult {
  /** The submitted intent. */
  intent: Intent;
  /** The governance regime selected for this intent. */
  regime: GovernanceRegime;
  /** The resolved jurisdiction context. */
  jurisdictionContext: JurisdictionContext;
  /** The composed policy set. */
  policySet: ComposedPolicySet;
  /** Any warnings generated during dispatch. */
  warnings: string[];
}

/**
 * EU AI Act classification result.
 */
export interface AiActClassificationResult {
  /** Risk classification tier. */
  classification: AiActClassification;
  /** High-risk category (only present for high-risk classification). */
  highRiskCategory?: AiActHighRiskCategory;
  /** Confidence score (0-1). */
  confidence: number;
  /** Human-readable reasoning for the classification. */
  reasoning: string;
  /** EU AI Act article/annex reference. */
  annexReference?: string;
  /** Regulatory obligations triggered by this classification. */
  obligations: string[];
}

/**
 * Minimal interface for the intent submission service.
 * Consumers must provide an implementation that handles actual persistence.
 */
export interface IIntentService {
  submit(
    submission: Record<string, unknown>,
    options: SubmitOptions,
  ): Promise<Intent>;
}

/**
 * Options passed through the submit pipeline.
 */
export interface SubmitOptions {
  /** Tenant context (at minimum, a tenantId). */
  ctx: TenantContext;
  /** Trust snapshot to attach to the intent. */
  trustSnapshot?: Record<string, unknown>;
  /** Current trust level of the submitting entity. */
  trustLevel?: TrustLevel;
  /** Additional options are passed through. */
  [key: string]: unknown;
}

/**
 * Minimal tenant context. Must carry at least a tenantId.
 */
export interface TenantContext {
  tenantId: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_GATEWAY_CONFIG: IntentGatewayConfig = {
  enabled: true,
  defaultJurisdiction: 'GLOBAL',
  defaultIndustry: 'general',
  regimeCacheTtlMs: 5 * 60 * 1000, // 5 minutes
  blockOnConflicts: true,
  logRegimeDecisions: true,
};

// ---------------------------------------------------------------------------
// Jurisdiction Resolver
// ---------------------------------------------------------------------------

/**
 * Data residency zones mapped to each jurisdiction.
 */
export const JURISDICTION_RESIDENCY_ZONES: Record<Jurisdiction, string> = {
  GLOBAL: 'global',
  EU: 'eu-west',
  US: 'us-east',
  APAC: 'ap-southeast-1',
  UK: 'uk-south',
  CA: 'ca-central',
  AU: 'au-southeast',
  JP: 'ap-northeast-1',
  SG: 'ap-southeast-1',
  CH: 'eu-central',
};

/** EU/EEA member state ISO 3166-1 alpha-2 codes. */
const EU_MEMBER_STATE_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

/** APAC country codes for regional mapping. */
const APAC_COUNTRY_CODES = new Set([
  'JP', 'KR', 'SG', 'AU', 'NZ', 'IN', 'TH', 'MY', 'ID', 'PH', 'VN', 'TW', 'HK',
]);

/** Direct country-to-jurisdiction mapping for countries with specific regimes. */
const COUNTRY_JURISDICTION_MAP: Record<string, Jurisdiction> = {
  US: 'US',
  GB: 'UK',
  CA: 'CA',
  AU: 'AU',
  JP: 'JP',
  SG: 'SG',
  CH: 'CH',
};

/**
 * Resolves jurisdictional context from tenant configuration, intent metadata,
 * or defaults. Uses a three-tier resolution strategy:
 *
 * 1. Tenant configuration (explicit, highest priority)
 * 2. Intent metadata inference (country codes, region hints)
 * 3. Gateway defaults (fallback)
 */
export class JurisdictionResolver {
  private tenantConfigs = new Map<string, TenantJurisdictionConfig>();
  private config: IntentGatewayConfig;

  constructor(config: IntentGatewayConfig) {
    this.config = config;
  }

  /**
   * Resolve jurisdiction context for a tenant + optional intent metadata.
   */
  resolve(
    ctx: TenantContext,
    intentMetadata?: Record<string, unknown> | null,
  ): JurisdictionContext {
    const tenantId = ctx.tenantId;

    // Tier 1: Explicit tenant configuration
    const tenantResult = this.resolveFromTenantConfig(tenantId);
    if (tenantResult) {
      logger.debug({ tenantId, source: 'tenant-config' }, 'Jurisdiction from tenant config');
      return tenantResult;
    }

    // Tier 2: Infer from intent metadata
    const metadataResult = this.resolveFromMetadata(intentMetadata);
    if (metadataResult) {
      logger.debug({ tenantId, source: 'metadata' }, 'Jurisdiction from metadata');
      return metadataResult;
    }

    // Tier 3: Gateway defaults
    logger.debug({ tenantId, source: 'default' }, 'Jurisdiction from defaults');
    return this.resolveDefault();
  }

  /**
   * Register a tenant's jurisdiction configuration.
   */
  registerTenantConfig(tenantId: string, config: TenantJurisdictionConfig): void {
    this.tenantConfigs.set(tenantId, config);
    logger.info({ tenantId, jurisdictions: config.jurisdictions }, 'Tenant config registered');
  }

  /**
   * Retrieve a tenant's jurisdiction configuration.
   */
  getTenantConfig(tenantId: string): TenantJurisdictionConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  /**
   * Determine if a set of jurisdictions implies cross-border data transfer
   * by checking whether they map to different residency zones.
   */
  detectCrossBorderTransfer(jurisdictions: Jurisdiction[]): boolean {
    if (jurisdictions.length <= 1) return false;
    const zones = new Set(jurisdictions.map(j => JURISDICTION_RESIDENCY_ZONES[j]));
    return zones.size > 1;
  }

  private resolveFromTenantConfig(tenantId: string): JurisdictionContext | null {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return null;
    return {
      primaryJurisdictions: config.jurisdictions,
      industry: config.industry,
      dataResidency:
        config.dataResidency ??
        JURISDICTION_RESIDENCY_ZONES[config.jurisdictions[0]] ??
        'global',
      crossBorderTransfer: this.detectCrossBorderTransfer(config.jurisdictions),
      source: 'tenant-config',
    };
  }

  private resolveFromMetadata(
    metadata?: Record<string, unknown> | null,
  ): JurisdictionContext | null {
    if (!metadata) return null;

    const jurisdictions = this.extractJurisdictionsFromMetadata(metadata);
    if (jurisdictions.length === 0) return null;

    const industry =
      typeof metadata.industry === 'string' && this.isValidIndustry(metadata.industry)
        ? (metadata.industry as Industry)
        : this.config.defaultIndustry;

    const dataResidency =
      (typeof metadata.dataResidency === 'string' ? metadata.dataResidency : undefined) ??
      JURISDICTION_RESIDENCY_ZONES[jurisdictions[0]] ??
      'global';

    return {
      primaryJurisdictions: jurisdictions,
      industry,
      dataResidency,
      crossBorderTransfer: this.detectCrossBorderTransfer(jurisdictions),
      source: 'metadata-inference',
    };
  }

  private resolveDefault(): JurisdictionContext {
    return {
      primaryJurisdictions: [this.config.defaultJurisdiction],
      industry: this.config.defaultIndustry,
      dataResidency: JURISDICTION_RESIDENCY_ZONES[this.config.defaultJurisdiction] ?? 'global',
      crossBorderTransfer: false,
      source: 'default',
    };
  }

  /**
   * Extract jurisdictions from metadata fields: jurisdiction, jurisdictions,
   * countryCode, region. EU member state codes map to "EU", APAC codes map
   * to "APAC", and known countries map to their specific jurisdiction.
   */
  private extractJurisdictionsFromMetadata(
    metadata: Record<string, unknown>,
  ): Jurisdiction[] {
    const jurisdictions: Jurisdiction[] = [];

    // Direct jurisdiction field
    if (typeof metadata.jurisdiction === 'string') {
      const j = metadata.jurisdiction.toUpperCase() as Jurisdiction;
      if (this.isValidJurisdiction(j)) jurisdictions.push(j);
    }

    // Jurisdictions array
    if (Array.isArray(metadata.jurisdictions)) {
      for (const item of metadata.jurisdictions) {
        if (typeof item === 'string') {
          const j = item.toUpperCase() as Jurisdiction;
          if (this.isValidJurisdiction(j) && !jurisdictions.includes(j)) {
            jurisdictions.push(j);
          }
        }
      }
    }

    // Country code inference
    if (typeof metadata.countryCode === 'string') {
      const code = metadata.countryCode.toUpperCase();
      if (EU_MEMBER_STATE_CODES.has(code)) {
        if (!jurisdictions.includes('EU')) jurisdictions.push('EU');
      } else if (COUNTRY_JURISDICTION_MAP[code]) {
        const j = COUNTRY_JURISDICTION_MAP[code];
        if (!jurisdictions.includes(j)) jurisdictions.push(j);
      } else if (APAC_COUNTRY_CODES.has(code)) {
        if (!jurisdictions.includes('APAC')) jurisdictions.push('APAC');
      }
    }

    // Region string inference
    if (typeof metadata.region === 'string') {
      const region = metadata.region.toUpperCase();
      if (['EU', 'EUROPE', 'EEA'].includes(region)) {
        if (!jurisdictions.includes('EU')) jurisdictions.push('EU');
      } else if (['US', 'UNITED STATES', 'NORTH AMERICA'].includes(region)) {
        if (!jurisdictions.includes('US')) jurisdictions.push('US');
      } else if (['APAC', 'ASIA', 'ASIA-PACIFIC'].includes(region)) {
        if (!jurisdictions.includes('APAC')) jurisdictions.push('APAC');
      }
    }

    return jurisdictions;
  }

  private isValidJurisdiction(v: string): v is Jurisdiction {
    return (JURISDICTIONS as readonly string[]).includes(v);
  }

  private isValidIndustry(v: string): v is Industry {
    return (INDUSTRIES as readonly string[]).includes(v);
  }
}

// ---------------------------------------------------------------------------
// Policy Composer
// ---------------------------------------------------------------------------

/**
 * Strictness rankings used for deterministic conflict resolution.
 * Higher number = stricter requirement. When policies conflict,
 * the strictest value wins.
 */
const CRYPTO_SUITE_STRICTNESS: Record<CryptoSuite, number> = {
  'standard': 0,
  'fips-140-2': 1,
  'post-quantum': 2,
};

const CONSENT_STRICTNESS: Record<ConsentModel, number> = {
  'implicit': 0,
  'opt-out': 1,
  'opt-in': 2,
  'explicit-granular': 3,
};

const ESCALATION_STRICTNESS: Record<EscalationMode, number> = {
  'log-only': 0,
  'flag-review': 1,
  'block-escalate': 2,
  'hard-block': 3,
};

const PROOF_ANCHORING_STRICTNESS: Record<ProofAnchoringMethod, number> = {
  'database': 0,
  'merkle-tree': 1,
  'blockchain-l2': 2,
  'tsa-rfc3161': 3,
};

const ENFORCEMENT_ORDER: Record<EnforcementLevel, number> = {
  'advisory': 0,
  'required': 1,
  'mandatory': 2,
  'blocking': 3,
};

/**
 * Helper to create a PolicyConstraint with less boilerplate.
 */
function constraint(
  id: string,
  type: PolicyConstraintType,
  rule: string,
  enforcement: EnforcementLevel,
  bundleId: string,
  jurisdiction: Jurisdiction,
  value: unknown,
): PolicyConstraint {
  return { id, type, rule, enforcement, sourceBundleId: bundleId, sourceJurisdiction: jurisdiction, value };
}

/**
 * Built-in policy bundles covering the major jurisdictional scopes.
 * These are the baseline; consumers can register additional bundles.
 */
function createBuiltinBundles(): PolicyBundle[] {
  return [
    // -- GLOBAL DEFAULT --
    {
      id: 'global-default',
      name: 'Global Default',
      jurisdictions: ['GLOBAL'],
      priority: 0,
      constraints: [
        constraint('global-retention', 'retention', 'Min 365-day audit retention', 'required', 'global-default', 'GLOBAL', 365),
        constraint('global-crypto', 'crypto', 'Standard cryptographic suite', 'required', 'global-default', 'GLOBAL', 'standard'),
        constraint('global-consent', 'consent', 'Implicit consent model', 'required', 'global-default', 'GLOBAL', 'implicit'),
        constraint('global-escalation', 'escalation', 'Flag for human review', 'required', 'global-default', 'GLOBAL', 'flag-review'),
        constraint('global-trust', 'trust-level', 'Minimum trust T2 (Provisional)', 'required', 'global-default', 'GLOBAL', 2),
        constraint('global-proof', 'proof-anchoring', 'Database proof anchoring', 'required', 'global-default', 'GLOBAL', 'database'),
        constraint('global-external', 'external-services', 'External services allowed', 'advisory', 'global-default', 'GLOBAL', true),
      ],
    },

    // -- EU (GDPR + AI Act) --
    {
      id: 'eu-gdpr',
      name: 'EU GDPR',
      jurisdictions: ['EU'],
      priority: 10,
      constraints: [
        constraint('eu-retention', 'retention', 'GDPR: 5-year audit retention', 'mandatory', 'eu-gdpr', 'EU', 1825),
        constraint('eu-consent', 'consent', 'GDPR: Explicit granular consent', 'mandatory', 'eu-gdpr', 'EU', 'explicit-granular'),
        constraint('eu-residency', 'data-residency', 'GDPR: EU data residency', 'mandatory', 'eu-gdpr', 'EU', 'eu-west'),
        constraint('eu-proof', 'proof-anchoring', 'GDPR: Merkle tree proof anchoring', 'required', 'eu-gdpr', 'EU', 'merkle-tree'),
        constraint('eu-trust', 'trust-level', 'GDPR: Minimum trust T3 (Monitored)', 'required', 'eu-gdpr', 'EU', 3),
        constraint('eu-processing', 'processing-restriction', 'GDPR: Purpose limitation', 'mandatory', 'eu-gdpr', 'EU', 'purpose-limitation'),
        constraint('eu-audit', 'audit-requirement', 'GDPR: Full audit trail', 'mandatory', 'eu-gdpr', 'EU', 'full-audit-trail'),
      ],
    },
    {
      id: 'eu-ai-act',
      name: 'EU AI Act',
      jurisdictions: ['EU'],
      priority: 15,
      constraints: [
        constraint('euai-escalation', 'escalation', 'AI Act: Block and escalate on violations', 'mandatory', 'eu-ai-act', 'EU', 'block-escalate'),
        constraint('euai-audit', 'audit-requirement', 'AI Act: AI system audit trail', 'mandatory', 'eu-ai-act', 'EU', 'ai-system-audit'),
        constraint('euai-processing', 'processing-restriction', 'AI Act: Risk assessment required', 'mandatory', 'eu-ai-act', 'EU', 'risk-assessment-required'),
      ],
    },

    // -- US --
    {
      id: 'us-standard',
      name: 'US Standard',
      jurisdictions: ['US'],
      priority: 10,
      constraints: [
        constraint('us-retention', 'retention', 'US: 7-year audit retention', 'mandatory', 'us-standard', 'US', 2555),
        constraint('us-crypto', 'crypto', 'US: FIPS 140-2 cryptographic suite', 'mandatory', 'us-standard', 'US', 'fips-140-2'),
        constraint('us-proof', 'proof-anchoring', 'US: TSA RFC 3161 proof anchoring', 'required', 'us-standard', 'US', 'tsa-rfc3161'),
        constraint('us-trust', 'trust-level', 'US: Minimum trust T3 (Monitored)', 'required', 'us-standard', 'US', 3),
        constraint('us-escalation', 'escalation', 'US: Block and escalate', 'mandatory', 'us-standard', 'US', 'block-escalate'),
        constraint('us-consent', 'consent', 'US: Opt-out consent model', 'required', 'us-standard', 'US', 'opt-out'),
      ],
    },

    // -- APAC --
    {
      id: 'apac-standard',
      name: 'APAC Standard',
      jurisdictions: ['APAC'],
      priority: 8,
      constraints: [
        constraint('apac-retention', 'retention', 'APAC: 3-year audit retention', 'required', 'apac-standard', 'APAC', 1095),
        constraint('apac-consent', 'consent', 'APAC: Opt-in consent model', 'required', 'apac-standard', 'APAC', 'opt-in'),
        constraint('apac-trust', 'trust-level', 'APAC: Minimum trust T2 (Provisional)', 'required', 'apac-standard', 'APAC', 2),
        constraint('apac-proof', 'proof-anchoring', 'APAC: Merkle tree proof anchoring', 'required', 'apac-standard', 'APAC', 'merkle-tree'),
      ],
    },

    // -- UK (post-Brexit, GDPR-adjacent) --
    {
      id: 'uk-dpa',
      name: 'UK Data Protection Act',
      jurisdictions: ['UK'],
      priority: 10,
      constraints: [
        constraint('uk-retention', 'retention', 'UK DPA: 5-year retention', 'mandatory', 'uk-dpa', 'UK', 1825),
        constraint('uk-consent', 'consent', 'UK DPA: Explicit granular consent', 'mandatory', 'uk-dpa', 'UK', 'explicit-granular'),
        constraint('uk-trust', 'trust-level', 'UK DPA: Minimum trust T3 (Monitored)', 'required', 'uk-dpa', 'UK', 3),
        constraint('uk-residency', 'data-residency', 'UK DPA: UK data residency', 'mandatory', 'uk-dpa', 'UK', 'uk-south'),
      ],
    },

    // -- Canada --
    {
      id: 'ca-pipeda',
      name: 'Canada PIPEDA',
      jurisdictions: ['CA'],
      priority: 10,
      constraints: [
        constraint('ca-consent', 'consent', 'PIPEDA: Opt-in consent', 'mandatory', 'ca-pipeda', 'CA', 'opt-in'),
        constraint('ca-trust', 'trust-level', 'PIPEDA: Minimum trust T3', 'required', 'ca-pipeda', 'CA', 3),
        constraint('ca-retention', 'retention', 'PIPEDA: 3-year retention', 'required', 'ca-pipeda', 'CA', 1095),
      ],
    },
  ];
}

/**
 * Composes policy constraints from multiple bundles into a single resolved set.
 *
 * Conflict resolution strategy:
 * - Numeric constraints (retention, trust-level): highest value wins.
 * - Ordered enums (crypto, consent, escalation, proof-anchoring): strictest wins.
 * - Data residency: enforcement level decides; incompatible mandatory zones = critical conflict.
 * - External services: restrictive (false) wins over permissive (true).
 * - Additive constraints (audit, processing): all unique values are kept.
 */
export class PolicyComposer {
  private bundles = new Map<string, PolicyBundle>();

  constructor() {
    for (const bundle of createBuiltinBundles()) {
      this.bundles.set(bundle.id, bundle);
    }
  }

  /** Number of registered bundles. */
  get bundleCount(): number {
    return this.bundles.size;
  }

  /** IDs of all registered bundles. */
  get registeredBundleIds(): string[] {
    return Array.from(this.bundles.keys());
  }

  /**
   * Register or overwrite a policy bundle.
   */
  registerBundle(bundle: PolicyBundle): void {
    if (this.bundles.has(bundle.id)) {
      logger.warn({ bundleId: bundle.id }, 'Overwriting existing policy bundle');
    }
    this.bundles.set(bundle.id, bundle);
    logger.info({ bundleId: bundle.id, priority: bundle.priority }, 'Policy bundle registered');
  }

  /**
   * Compose a policy set by selecting applicable bundles for the given
   * jurisdiction context, merging their constraints, and resolving conflicts.
   */
  compose(
    ctx: JurisdictionContext,
    additionalBundleIds?: string[],
  ): ComposedPolicySet {
    const applicable = this.selectApplicable(ctx, additionalBundleIds);

    // Always include global default as a fallback
    if (applicable.length === 0) {
      const global = this.bundles.get('global-default');
      if (global) applicable.push(global);
    }

    // Sort by priority (lower first, so higher-priority overrides later)
    applicable.sort((a, b) => a.priority - b.priority);

    // Collect all constraints
    const allConstraints: PolicyConstraint[] = [];
    for (const bundle of applicable) {
      allConstraints.push(...bundle.constraints);
    }

    // Group by constraint type
    const grouped = new Map<PolicyConstraintType, PolicyConstraint[]>();
    for (const c of allConstraints) {
      const group = grouped.get(c.type) ?? [];
      group.push(c);
      grouped.set(c.type, group);
    }

    // Resolve each group
    const resolved: PolicyConstraint[] = [];
    const resolvedConflicts: PolicyConflict[] = [];
    const unresolvedConflicts: PolicyConflict[] = [];

    for (const [type, constraints] of grouped.entries()) {
      const result = this.resolveGroup(type, constraints, applicable);
      resolved.push(...result.resolved);
      resolvedConflicts.push(...result.resolvedConflicts);
      unresolvedConflicts.push(...result.unresolvedConflicts);
    }

    const isValid = unresolvedConflicts.every(c => c.severity !== 'critical');

    return {
      constraints: resolved,
      sourceBundles: applicable.map(b => b.id),
      resolvedConflicts,
      unresolvedConflicts,
      isValid,
      composedAt: Date.now(),
    };
  }

  /**
   * Select bundles that apply to the given jurisdiction context.
   * A bundle applies if any of its jurisdictions match the context's
   * primary jurisdictions, or if the bundle is GLOBAL.
   */
  private selectApplicable(
    ctx: JurisdictionContext,
    additionalIds?: string[],
  ): PolicyBundle[] {
    const selected: PolicyBundle[] = [];
    const used = new Set<string>();

    for (const [id, bundle] of this.bundles) {
      const applies = bundle.jurisdictions.some(
        j => j === 'GLOBAL' || ctx.primaryJurisdictions.includes(j),
      );
      if (applies && !used.has(id)) {
        selected.push(bundle);
        used.add(id);
      }
    }

    // Include explicitly requested additional bundles
    if (additionalIds) {
      for (const id of additionalIds) {
        if (!used.has(id)) {
          const bundle = this.bundles.get(id);
          if (bundle) {
            selected.push(bundle);
            used.add(id);
          }
        }
      }
    }

    return selected;
  }

  /**
   * Resolve conflicts within a group of same-type constraints.
   */
  private resolveGroup(
    type: PolicyConstraintType,
    constraints: PolicyConstraint[],
    bundles: PolicyBundle[],
  ): {
    resolved: PolicyConstraint[];
    resolvedConflicts: PolicyConflict[];
    unresolvedConflicts: PolicyConflict[];
  } {
    // No conflict possible with a single constraint
    if (constraints.length <= 1) {
      return { resolved: constraints, resolvedConflicts: [], unresolvedConflicts: [] };
    }

    switch (type) {
      // Numeric max-wins
      case 'retention':
      case 'trust-level':
        return this.resolveByMax(type, constraints);

      // Ordered-enum strictest-wins
      case 'crypto':
        return this.resolveByStrictness(type, constraints, CRYPTO_SUITE_STRICTNESS);
      case 'consent':
        return this.resolveByStrictness(type, constraints, CONSENT_STRICTNESS);
      case 'escalation':
        return this.resolveByStrictness(type, constraints, ESCALATION_STRICTNESS);
      case 'proof-anchoring':
        return this.resolveByStrictness(type, constraints, PROOF_ANCHORING_STRICTNESS);

      // Special resolution
      case 'data-residency':
        return this.resolveDataResidency(constraints);
      case 'external-services':
        return this.resolveExternalServices(constraints);

      // Additive (keep all unique values)
      case 'audit-requirement':
      case 'processing-restriction':
        return this.resolveAdditive(constraints);

      // Fallback: by bundle priority
      default:
        return this.resolveByPriority(type, constraints, bundles);
    }
  }

  /** Resolve numeric constraints by taking the maximum value. */
  private resolveByMax(
    type: PolicyConstraintType,
    constraints: PolicyConstraint[],
  ) {
    const valued = constraints.map(c => ({
      constraint: c,
      numericValue: typeof c.value === 'number' ? c.value : 0,
    }));
    const winner = valued.reduce((max, v) => v.numericValue > max.numericValue ? v : max);
    const hasConflict = new Set(valued.map(v => v.numericValue)).size > 1;

    return {
      resolved: [winner.constraint],
      resolvedConflicts: hasConflict
        ? [{
            constraintType: type,
            constraints,
            description: `${type}: resolved to max value ${winner.numericValue}`,
            severity: 'low' as ConflictSeverity,
          }]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  /** Resolve ordered-enum constraints by taking the strictest value. */
  private resolveByStrictness(
    type: PolicyConstraintType,
    constraints: PolicyConstraint[],
    strictnessMap: Record<string, number>,
  ) {
    const valued = constraints.map(c => ({
      constraint: c,
      strictness: strictnessMap[String(c.value)] ?? 0,
    }));
    const winner = valued.reduce((max, v) => v.strictness > max.strictness ? v : max);
    const hasConflict = new Set(valued.map(v => v.strictness)).size > 1;

    return {
      resolved: [winner.constraint],
      resolvedConflicts: hasConflict
        ? [{
            constraintType: type,
            constraints,
            description: `${type}: resolved to strictest value "${winner.constraint.value}"`,
            severity: 'low' as ConflictSeverity,
          }]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  /**
   * Data residency conflicts are potentially critical: if two mandatory
   * constraints require different zones, the data literally cannot be in
   * both places. This is surfaced as an unresolved critical conflict.
   */
  private resolveDataResidency(constraints: PolicyConstraint[]) {
    const zones = new Set(constraints.map(c => String(c.value)));

    if (zones.size <= 1) {
      return { resolved: [constraints[0]], resolvedConflicts: [] as PolicyConflict[], unresolvedConflicts: [] as PolicyConflict[] };
    }

    // Sort by enforcement level (strictest first)
    const sorted = [...constraints].sort(
      (a, b) => (ENFORCEMENT_ORDER[b.enforcement] ?? 0) - (ENFORCEMENT_ORDER[a.enforcement] ?? 0),
    );

    const hasMandatory = sorted.some(
      c => c.enforcement === 'blocking' || c.enforcement === 'mandatory',
    );

    if (hasMandatory) {
      return {
        resolved: [sorted[0]],
        resolvedConflicts: [] as PolicyConflict[],
        unresolvedConflicts: [{
          constraintType: 'data-residency' as PolicyConstraintType,
          constraints,
          description: `Incompatible data residency requirements: ${[...zones].join(' vs ')}`,
          severity: 'critical' as ConflictSeverity,
        }],
      };
    }

    return {
      resolved: [sorted[0]],
      resolvedConflicts: [{
        constraintType: 'data-residency' as PolicyConstraintType,
        constraints,
        description: `Data residency resolved to ${sorted[0].value}`,
        severity: 'medium' as ConflictSeverity,
      }],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  /** External services: false (restrictive) wins over true (permissive). */
  private resolveExternalServices(constraints: PolicyConstraint[]) {
    const blocked = constraints.some(c => c.value === false);
    const winner = blocked ? constraints.find(c => c.value === false)! : constraints[0];
    const hasConflict = new Set(constraints.map(c => c.value)).size > 1;

    return {
      resolved: [winner],
      resolvedConflicts: hasConflict
        ? [{
            constraintType: 'external-services' as PolicyConstraintType,
            constraints,
            description: `External services: resolved to ${winner.value}`,
            severity: 'low' as ConflictSeverity,
          }]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  /** Additive constraints keep all unique values (e.g., audit requirements). */
  private resolveAdditive(constraints: PolicyConstraint[]) {
    const seen = new Set<string>();
    const unique: PolicyConstraint[] = [];
    for (const c of constraints) {
      const key = String(c.value);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }
    return { resolved: unique, resolvedConflicts: [] as PolicyConflict[], unresolvedConflicts: [] as PolicyConflict[] };
  }

  /** Fallback: resolve by bundle priority (highest priority wins). */
  private resolveByPriority(
    type: PolicyConstraintType,
    constraints: PolicyConstraint[],
    bundles: PolicyBundle[],
  ) {
    const priorityMap = new Map(bundles.map(b => [b.id, b.priority]));
    const sorted = [...constraints].sort(
      (a, b) => (priorityMap.get(b.sourceBundleId) ?? 0) - (priorityMap.get(a.sourceBundleId) ?? 0),
    );
    return {
      resolved: [sorted[0]],
      resolvedConflicts: constraints.length > 1
        ? [{
            constraintType: type,
            constraints,
            description: `${type}: resolved by priority to bundle "${sorted[0].sourceBundleId}"`,
            severity: 'low' as ConflictSeverity,
          }]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }
}

// ---------------------------------------------------------------------------
// EU AI Act Classifier
// ---------------------------------------------------------------------------

/** Keywords that trigger "unacceptable" (prohibited) classification under Art. 5. */
const PROHIBITED_KEYWORDS = [
  'social scoring', 'social credit', 'subliminal manipulation',
  'subliminal technique', 'exploit vulnerability', 'exploit vulnerabilities',
  'real-time biometric identification', 'real-time facial recognition',
  'mass surveillance', 'emotion recognition workplace',
  'emotion recognition education', 'predictive policing individual',
  'cognitive behavioral manipulation', 'biometric categorisation sensitive',
  'untargeted scraping facial',
];

/** Keywords mapped to Annex III high-risk categories. */
const HIGH_RISK_KEYWORDS: Record<AiActHighRiskCategory, string[]> = {
  'biometric-identification': [
    'biometric identification', 'biometric verification', 'facial recognition',
    'fingerprint matching', 'voice identification', 'iris recognition',
  ],
  'critical-infrastructure': [
    'critical infrastructure', 'power grid', 'water supply',
    'traffic management', 'electricity distribution', 'energy management',
  ],
  'education-vocational': [
    'student assessment', 'educational admission', 'learning evaluation',
    'exam scoring', 'academic grading', 'educational placement',
  ],
  'employment-worker-management': [
    'recruitment', 'hiring decision', 'cv screening', 'resume screening',
    'employee evaluation', 'performance monitoring', 'promotion decision',
    'termination decision', 'worker management',
  ],
  'essential-services': [
    'credit scoring', 'creditworthiness', 'insurance pricing',
    'insurance risk', 'social benefit', 'public assistance',
    'emergency services dispatch', 'loan application', 'mortgage decision',
  ],
  'law-enforcement': [
    'law enforcement', 'criminal risk assessment', 'recidivism prediction',
    'crime prediction', 'evidence analysis', 'suspect profiling',
  ],
  'migration-asylum-border': [
    'border control', 'immigration', 'asylum application',
    'visa application', 'migration management', 'refugee assessment',
  ],
  'justice-democratic': [
    'judicial decision', 'court ruling', 'sentencing',
    'legal outcome prediction', 'electoral', 'voting',
    'election', 'democratic process',
  ],
};

/** Keywords that trigger "limited-risk" classification (transparency obligations). */
const LIMITED_RISK_KEYWORDS = [
  'chatbot', 'conversational ai', 'virtual assistant', 'deepfake',
  'synthetic media', 'generated content', 'ai-generated text',
  'ai-generated image', 'ai-generated video', 'emotion detection',
  'content generation', 'text generation', 'image generation',
];

/** Regulatory obligations per classification tier. */
const OBLIGATIONS_MAP: Record<AiActClassification, string[]> = {
  'unacceptable': [
    'PROHIBITED - System must not be deployed in EU/EEA',
    'Immediate cessation required for EU market',
    'Notify national supervisory authority',
  ],
  'high-risk': [
    'Risk management system (Art. 9)',
    'Data governance and management (Art. 10)',
    'Technical documentation (Art. 11)',
    'Record-keeping and logging (Art. 12)',
    'Transparency and user information (Art. 13)',
    'Human oversight measures (Art. 14)',
    'Accuracy, robustness, cybersecurity (Art. 15)',
    'Conformity assessment (Art. 43)',
    'Post-market monitoring (Art. 61)',
    'Serious incident reporting (Art. 62)',
  ],
  'limited-risk': [
    'Inform users of AI interaction (Art. 50)',
    'Label AI-generated content (Art. 50)',
    'Disclose deepfake/synthetic content (Art. 50)',
  ],
  'minimal-risk': [
    'Voluntary codes of conduct (Art. 95)',
    'No mandatory obligations',
  ],
};

/**
 * Classifies AI system usage against the EU AI Act risk framework.
 *
 * Uses keyword-based heuristics against the intent goal, metadata, and type
 * to produce a risk classification. This is a simplified, open-source
 * implementation suitable for initial screening; production deployments
 * should supplement this with domain-expert review for high-risk and
 * unacceptable classifications.
 *
 * Classification priority: unacceptable > high-risk > limited-risk > minimal-risk
 */
export class AiActClassifier {
  /**
   * Classify an intent's AI Act risk level.
   *
   * @param goal - The intent's stated goal
   * @param context - Optional intent context/metadata
   * @param intentType - Optional intent type string
   * @returns Classification result with obligations
   */
  classify(
    goal: string,
    context?: Record<string, unknown> | null,
    intentType?: string | null,
  ): AiActClassificationResult {
    const searchText = this.buildSearchText(goal, context, intentType);

    // Check in priority order: unacceptable > high-risk > limited > minimal
    const prohibited = this.checkProhibited(searchText);
    if (prohibited) return prohibited;

    const highRisk = this.checkHighRisk(searchText);
    if (highRisk) return highRisk;

    const limited = this.checkLimitedRisk(searchText);
    if (limited) return limited;

    return {
      classification: 'minimal-risk',
      confidence: 0.6,
      reasoning: 'No risk indicators detected; classified as minimal-risk',
      obligations: OBLIGATIONS_MAP['minimal-risk'],
    };
  }

  private buildSearchText(
    goal: string,
    context?: Record<string, unknown> | null,
    intentType?: string | null,
  ): string {
    const parts: string[] = [goal.toLowerCase()];
    if (intentType) parts.push(intentType.toLowerCase());
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (typeof value === 'string') {
          parts.push(`${key}: ${value}`.toLowerCase());
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string') parts.push(item.toLowerCase());
          }
        }
      }
    }
    return parts.join(' ');
  }

  private checkProhibited(text: string): AiActClassificationResult | null {
    for (const keyword of PROHIBITED_KEYWORDS) {
      if (text.includes(keyword)) {
        logger.warn({ keyword }, 'EU AI Act: PROHIBITED system detected');
        return {
          classification: 'unacceptable',
          confidence: 0.9,
          reasoning: `Prohibited practice detected: "${keyword}" (Art. 5)`,
          annexReference: 'Article 5',
          obligations: OBLIGATIONS_MAP['unacceptable'],
        };
      }
    }
    return null;
  }

  private checkHighRisk(text: string): AiActClassificationResult | null {
    let bestMatch: { category: AiActHighRiskCategory; keyword: string; count: number } | null = null;

    for (const [category, keywords] of Object.entries(HIGH_RISK_KEYWORDS) as [AiActHighRiskCategory, string[]][]) {
      let count = 0;
      let firstKeyword = '';
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          count++;
          if (!firstKeyword) firstKeyword = keyword;
        }
      }
      if (count > 0 && (!bestMatch || count > bestMatch.count)) {
        bestMatch = { category, keyword: firstKeyword, count };
      }
    }

    if (bestMatch) {
      const confidence = Math.min(0.5 + bestMatch.count * 0.15, 0.95);
      logger.info(
        { category: bestMatch.category, confidence },
        'EU AI Act: High-risk classification',
      );
      return {
        classification: 'high-risk',
        highRiskCategory: bestMatch.category,
        confidence,
        reasoning: `High-risk system (Annex III: ${bestMatch.category}). Matched: "${bestMatch.keyword}"`,
        annexReference: 'Article 6, Annex III',
        obligations: OBLIGATIONS_MAP['high-risk'],
      };
    }

    return null;
  }

  private checkLimitedRisk(text: string): AiActClassificationResult | null {
    for (const keyword of LIMITED_RISK_KEYWORDS) {
      if (text.includes(keyword)) {
        return {
          classification: 'limited-risk',
          confidence: 0.7,
          reasoning: `Limited-risk transparency obligation: "${keyword}"`,
          annexReference: 'Article 50',
          obligations: OBLIGATIONS_MAP['limited-risk'],
        };
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Regime Selector
// ---------------------------------------------------------------------------

/**
 * Pick the strictest value from an ordered enum, given jurisdiction defaults
 * and an optional policy-composed value.
 */
function pickStrictest<T extends string>(
  defaults: T[],
  policyValue: T | undefined,
  strictnessMap: Record<T, number>,
): T {
  const all = policyValue ? [...defaults, policyValue] : defaults;
  return all.reduce((strictest, current) =>
    (strictnessMap[current] ?? 0) > (strictnessMap[strictest] ?? 0) ? current : strictest,
  );
}

/** Check if a jurisdiction context includes any of the given jurisdictions. */
function hasJurisdiction(ctx: JurisdictionContext, ...jurisdictions: Jurisdiction[]): boolean {
  return jurisdictions.some(j => ctx.primaryJurisdictions.includes(j));
}

/** Extract a typed constraint value from a composed policy set. */
function extractPolicyValue<T = unknown>(
  policySet: ComposedPolicySet,
  type: string,
): T | undefined {
  return policySet.constraints.find(c => c.type === type)?.value as T | undefined;
}

/**
 * Assembles a complete GovernanceRegime from a jurisdiction context and
 * composed policy set. Each regime parameter is resolved independently
 * by combining jurisdiction-based defaults with policy-composed values,
 * always selecting the strictest option.
 */
export class RegimeSelector {
  /**
   * Select the governance regime for the given context and policy set.
   */
  select(ctx: JurisdictionContext, policySet: ComposedPolicySet): GovernanceRegime {
    const cryptoSuite = this.resolveCryptoSuite(ctx, policySet);
    const proofAnchoring = this.resolveProofAnchoring(ctx, policySet);
    const consentModel = this.resolveConsentModel(ctx, policySet);
    const escalationMode = this.resolveEscalationMode(ctx, policySet);
    const auditRetentionDays = this.resolveAuditRetentionDays(ctx, policySet);
    const externalServicesAllowed = this.resolveExternalServicesAllowed(ctx, policySet);
    const minimumTrustLevel = this.resolveMinimumTrustLevel(ctx, policySet);

    // Build a deterministic regime ID from the resolved parameters
    const regimeId = this.generateRegimeId({
      jurisdictions: ctx.primaryJurisdictions,
      cryptoSuite,
      proofAnchoring,
      consentModel,
      escalationMode,
      auditRetentionDays,
      dataResidency: ctx.dataResidency,
      externalServicesAllowed,
      minimumTrustLevel,
    });

    // Build human-readable name
    const jurisdictionPart =
      ctx.primaryJurisdictions.length === 1
        ? ctx.primaryJurisdictions[0]
        : `Multi(${ctx.primaryJurisdictions.join('+')})`;
    const name = ctx.industry !== 'general'
      ? `${jurisdictionPart}-${ctx.industry}`
      : jurisdictionPart;

    const regime: GovernanceRegime = {
      regimeId,
      name: name || 'default',
      jurisdictions: ctx.primaryJurisdictions,
      policyNamespaces: policySet.sourceBundles,
      cryptoSuite,
      proofAnchoring,
      auditRetentionDays,
      consentModel,
      escalationMode,
      dataResidency: ctx.dataResidency,
      externalServicesAllowed,
      minimumTrustLevel,
      conformityAssessmentRequired: hasJurisdiction(ctx, 'EU'),
      transparencyRequired: hasJurisdiction(ctx, 'EU', 'CA', 'UK'),
      metadata: {},
    };

    logger.info(
      { regimeId, name, cryptoSuite, minimumTrustLevel },
      'Governance regime assembled',
    );

    return regime;
  }

  private resolveCryptoSuite(ctx: JurisdictionContext, ps: ComposedPolicySet): CryptoSuite {
    const pv = extractPolicyValue<CryptoSuite>(ps, 'crypto');
    const defaults: CryptoSuite[] = ['standard'];
    if (hasJurisdiction(ctx, 'US')) defaults.push('fips-140-2');
    return pickStrictest(defaults, pv, CRYPTO_SUITE_STRICTNESS);
  }

  private resolveProofAnchoring(ctx: JurisdictionContext, ps: ComposedPolicySet): ProofAnchoringMethod {
    const pv = extractPolicyValue<ProofAnchoringMethod>(ps, 'proof-anchoring');
    const defaults: ProofAnchoringMethod[] = ['database'];
    if (hasJurisdiction(ctx, 'US')) defaults.push('tsa-rfc3161');
    else if (hasJurisdiction(ctx, 'EU')) defaults.push('merkle-tree');
    return pickStrictest(defaults, pv, PROOF_ANCHORING_STRICTNESS);
  }

  private resolveConsentModel(ctx: JurisdictionContext, ps: ComposedPolicySet): ConsentModel {
    const pv = extractPolicyValue<ConsentModel>(ps, 'consent');
    const defaults: ConsentModel[] = ['implicit'];
    if (hasJurisdiction(ctx, 'EU', 'UK')) defaults.push('explicit-granular');
    else if (hasJurisdiction(ctx, 'CA')) defaults.push('opt-in');
    else if (hasJurisdiction(ctx, 'US')) defaults.push('opt-out');
    return pickStrictest(defaults, pv, CONSENT_STRICTNESS);
  }

  private resolveEscalationMode(ctx: JurisdictionContext, ps: ComposedPolicySet): EscalationMode {
    const pv = extractPolicyValue<EscalationMode>(ps, 'escalation');
    const defaults: EscalationMode[] = ['flag-review'];
    if (hasJurisdiction(ctx, 'US', 'EU')) defaults.push('block-escalate');
    return pickStrictest(defaults, pv, ESCALATION_STRICTNESS);
  }

  private resolveAuditRetentionDays(ctx: JurisdictionContext, ps: ComposedPolicySet): number {
    const pv = extractPolicyValue<number>(ps, 'retention');
    const defaults = [365];
    if (hasJurisdiction(ctx, 'EU', 'UK')) defaults.push(1825);
    if (hasJurisdiction(ctx, 'US')) defaults.push(2555);
    return Math.max(...(pv !== undefined ? [...defaults, pv] : defaults));
  }

  private resolveExternalServicesAllowed(ctx: JurisdictionContext, ps: ComposedPolicySet): boolean {
    const pv = extractPolicyValue<boolean>(ps, 'external-services');
    return pv !== undefined ? pv : true;
  }

  private resolveMinimumTrustLevel(ctx: JurisdictionContext, ps: ComposedPolicySet): TrustLevel {
    const pv = extractPolicyValue<TrustLevel>(ps, 'trust-level');
    const defaults: TrustLevel[] = [2];
    if (hasJurisdiction(ctx, 'EU', 'US', 'UK', 'CA')) defaults.push(3);
    return Math.max(...(pv !== undefined ? [...defaults, pv] : defaults)) as TrustLevel;
  }

  /**
   * Generate a deterministic regime ID by hashing the canonical parameter set.
   * Same parameters always produce the same ID.
   */
  private generateRegimeId(params: {
    jurisdictions: Jurisdiction[];
    cryptoSuite: CryptoSuite;
    proofAnchoring: ProofAnchoringMethod;
    consentModel: ConsentModel;
    escalationMode: EscalationMode;
    auditRetentionDays: number;
    dataResidency: string;
    externalServicesAllowed: boolean;
    minimumTrustLevel: TrustLevel;
  }): string {
    const canonical = {
      auditRetentionDays: params.auditRetentionDays,
      consentModel: params.consentModel,
      cryptoSuite: params.cryptoSuite,
      dataResidency: params.dataResidency,
      escalationMode: params.escalationMode,
      externalServicesAllowed: params.externalServicesAllowed,
      jurisdictions: [...params.jurisdictions].sort(),
      minimumTrustLevel: params.minimumTrustLevel,
      proofAnchoring: params.proofAnchoring,
    };
    // Simple hash for deterministic ID generation
    const str = JSON.stringify(canonical);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `regime-${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
}

// ---------------------------------------------------------------------------
// Gateway Conflict Error
// ---------------------------------------------------------------------------

/**
 * Thrown when the gateway encounters unresolved policy conflicts that
 * block intent processing (only when blockOnConflicts is enabled).
 */
export class GatewayConflictError extends Error {
  public readonly conflicts: PolicyConflict[];

  constructor(conflicts: PolicyConflict[]) {
    super(
      'Intent blocked by unresolved policy conflicts: ' +
      conflicts.map(c => c.description).join('; '),
    );
    this.name = 'GatewayConflictError';
    this.conflicts = conflicts;
  }
}

// ---------------------------------------------------------------------------
// Intent Gateway (Orchestrator)
// ---------------------------------------------------------------------------

/** EU/EEA jurisdiction codes that trigger AI Act classification. */
const EU_JURISDICTION_CODES = new Set<Jurisdiction>(['EU']);

/**
 * The Intent Gateway is the policy-aware orchestrator for all agent intents.
 *
 * It implements the full governance pipeline:
 * 1. **Intake** - Receives the intent submission and options
 * 2. **Jurisdiction Resolution** - Determines applicable jurisdictions
 * 3. **Policy Composition** - Merges applicable policy bundles with conflict detection
 * 4. **AI Act Classification** - Classifies EU-bound intents against the AI Act
 * 5. **Regime Selection** - Assembles the governance regime
 * 6. **Enriched Submit** - Submits with regime metadata and enforced trust levels
 *
 * On error, the gateway degrades to passthrough mode (never drops intents).
 *
 * @example
 * ```typescript
 * const gateway = new IntentGateway(intentService, { enabled: true });
 *
 * // Register tenant-specific jurisdiction
 * gateway.registerTenantConfig('tenant-acme', {
 *   jurisdictions: ['EU'],
 *   industry: 'finance',
 * });
 *
 * // Dispatch an intent through the governance pipeline
 * const result = await gateway.dispatch(
 *   { goal: 'Analyze customer data', entityId: 'agent-1' },
 *   { ctx: { tenantId: 'tenant-acme' } },
 * );
 *
 * console.log(result.regime.name);           // "EU-finance"
 * console.log(result.regime.consentModel);   // "explicit-granular"
 * console.log(result.regime.aiActClassification); // classification result
 * ```
 */
export class IntentGateway {
  private intentService: IIntentService;
  private config: IntentGatewayConfig;
  private jurisdictionResolver: JurisdictionResolver;
  private policyComposer: PolicyComposer;
  private regimeSelector: RegimeSelector;
  private aiActClassifier: AiActClassifier;

  constructor(
    intentService: IIntentService,
    config?: Partial<IntentGatewayConfig>,
  ) {
    this.intentService = intentService;
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.jurisdictionResolver = new JurisdictionResolver(this.config);
    this.policyComposer = new PolicyComposer();
    this.regimeSelector = new RegimeSelector();
    this.aiActClassifier = new AiActClassifier();

    logger.info(
      { enabled: this.config.enabled, defaultJurisdiction: this.config.defaultJurisdiction },
      'IntentGateway initialized',
    );
  }

  /**
   * Dispatch an intent through the full governance pipeline.
   *
   * When the gateway is disabled, intents pass through directly.
   * When enabled, the intent is enriched with jurisdiction, policy, and
   * regime metadata before submission. The trust level is enforced to
   * meet the regime's minimum.
   *
   * On unexpected errors, the gateway falls through to passthrough mode
   * with a degradation warning (never silently fails).
   */
  async dispatch(
    submission: Record<string, unknown>,
    options: SubmitOptions,
  ): Promise<GatewayDispatchResult> {
    // Passthrough when disabled
    if (!this.config.enabled) {
      const intent = await this.intentService.submit(submission, options);
      return this.createPassthroughResult(intent);
    }

    try {
      // Step 1: Resolve jurisdiction
      const intentMetadata = submission.context as Record<string, unknown> | undefined;
      const jurisdictionContext = this.jurisdictionResolver.resolve(options.ctx, intentMetadata);
      const tenantId = options.ctx.tenantId;

      // Step 2: Compose policies
      const tenantConfig = this.jurisdictionResolver.getTenantConfig(tenantId);
      const policySet = this.policyComposer.compose(
        jurisdictionContext,
        tenantConfig?.customPolicyBundles,
      );

      // Check for blocking conflicts
      const warnings: string[] = [];
      if (policySet.unresolvedConflicts.length > 0) {
        if (this.config.blockOnConflicts && !policySet.isValid) {
          throw new GatewayConflictError(policySet.unresolvedConflicts);
        }
        for (const conflict of policySet.unresolvedConflicts) {
          warnings.push(`Unresolved policy conflict: ${conflict.description}`);
        }
      }

      // Step 3: EU AI Act classification (when EU jurisdiction applies)
      let aiActResult: AiActClassificationResult | undefined;
      if (jurisdictionContext.primaryJurisdictions.some(j => EU_JURISDICTION_CODES.has(j))) {
        const goal = typeof submission.goal === 'string' ? submission.goal : '';
        const intentType = typeof submission.intentType === 'string' ? submission.intentType : undefined;
        aiActResult = this.aiActClassifier.classify(goal, intentMetadata, intentType);

        if (aiActResult.classification === 'unacceptable') {
          warnings.push(`EU AI Act: PROHIBITED - ${aiActResult.reasoning}`);
        }
      }

      // Step 4: Select governance regime
      const regime = this.regimeSelector.select(jurisdictionContext, policySet);

      // Attach AI Act classification to regime
      if (aiActResult) {
        regime.aiActClassification = aiActResult.classification;
        regime.aiActHighRiskCategory = aiActResult.highRiskCategory;
      }

      // Step 5: Enrich submit options with regime metadata
      const enrichedOptions: SubmitOptions = {
        ...options,
        trustSnapshot: {
          ...(options.trustSnapshot ?? {}),
          __governanceRegime: {
            regimeId: regime.regimeId,
            name: regime.name,
            jurisdictions: regime.jurisdictions,
            cryptoSuite: regime.cryptoSuite,
            minimumTrustLevel: regime.minimumTrustLevel,
            aiActClassification: regime.aiActClassification,
            conformityAssessmentRequired: regime.conformityAssessmentRequired,
          },
        },
      };

      // Enforce minimum trust level
      if (!enrichedOptions.trustLevel || enrichedOptions.trustLevel < regime.minimumTrustLevel) {
        enrichedOptions.trustLevel = regime.minimumTrustLevel;
      }

      // Log regime decision
      if (this.config.logRegimeDecisions) {
        logger.info(
          {
            regimeId: regime.regimeId,
            name: regime.name,
            tenantId,
            cryptoSuite: regime.cryptoSuite,
            minimumTrustLevel: regime.minimumTrustLevel,
            aiActClassification: regime.aiActClassification,
            bundles: policySet.sourceBundles,
          },
          'Gateway regime decision',
        );
      }

      // Submit the intent
      const intent = await this.intentService.submit(submission, enrichedOptions);

      return { intent, regime, jurisdictionContext, policySet, warnings };
    } catch (error) {
      // Re-throw conflict errors (intentional blocks)
      if (error instanceof GatewayConflictError) throw error;

      // Degrade gracefully: submit without governance enrichment
      logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Gateway error - falling through to passthrough',
      );

      const intent = await this.intentService.submit(submission, options);
      const result = this.createPassthroughResult(intent);
      result.warnings.push(
        `Gateway degraded: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return result;
    }
  }

  /**
   * Resolve the governance regime for a tenant context without submitting
   * an intent. Useful for pre-flight checks and UI display.
   */
  resolveRegime(
    ctx: TenantContext,
    metadata?: Record<string, unknown> | null,
  ): {
    regime: GovernanceRegime;
    jurisdictionContext: JurisdictionContext;
    policySet: ComposedPolicySet;
  } {
    const jurisdictionContext = this.jurisdictionResolver.resolve(ctx, metadata);
    const tenantConfig = this.jurisdictionResolver.getTenantConfig(ctx.tenantId);
    const policySet = this.policyComposer.compose(
      jurisdictionContext,
      tenantConfig?.customPolicyBundles,
    );
    const regime = this.regimeSelector.select(jurisdictionContext, policySet);
    return { regime, jurisdictionContext, policySet };
  }

  /**
   * Register a tenant's jurisdiction configuration.
   * This is the primary way to tell the gateway where a tenant operates.
   */
  registerTenantConfig(tenantId: string, config: TenantJurisdictionConfig): void {
    this.jurisdictionResolver.registerTenantConfig(tenantId, config);
  }

  /**
   * Retrieve the current gateway configuration (read-only).
   */
  getConfig(): Readonly<IntentGatewayConfig> {
    return { ...this.config };
  }

  /**
   * Access the underlying intent service.
   */
  getIntentService(): IIntentService {
    return this.intentService;
  }

  /**
   * Create a passthrough result (used when gateway is disabled or on error).
   */
  private createPassthroughResult(intent: Intent): GatewayDispatchResult {
    return {
      intent,
      regime: {
        regimeId: 'regime-passthrough',
        name: 'passthrough',
        jurisdictions: [this.config.defaultJurisdiction],
        policyNamespaces: [],
        cryptoSuite: 'standard',
        proofAnchoring: 'database',
        auditRetentionDays: 365,
        consentModel: 'implicit',
        escalationMode: 'flag-review',
        dataResidency: 'global',
        externalServicesAllowed: true,
        minimumTrustLevel: 2,
        conformityAssessmentRequired: false,
        transparencyRequired: false,
        metadata: {},
      },
      jurisdictionContext: {
        primaryJurisdictions: [this.config.defaultJurisdiction],
        industry: this.config.defaultIndustry,
        dataResidency: 'global',
        crossBorderTransfer: false,
        source: 'default',
      },
      policySet: {
        constraints: [],
        sourceBundles: [],
        resolvedConflicts: [],
        unresolvedConflicts: [],
        isValid: true,
        composedAt: Date.now(),
      },
      warnings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an IntentGateway instance with the given service and configuration.
 *
 * @example
 * ```typescript
 * const gateway = createIntentGateway(myIntentService, {
 *   defaultJurisdiction: 'EU',
 *   blockOnConflicts: true,
 * });
 * ```
 */
export function createIntentGateway(
  intentService: IIntentService,
  config?: Partial<IntentGatewayConfig>,
): IntentGateway {
  return new IntentGateway(intentService, config);
}
