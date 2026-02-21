/**
 * REGIME SELECTOR
 * @packageDocumentation
 */
import { createHash } from "node:crypto";

import { createLogger } from "../common/logger.js";

import type {
  Jurisdiction,
  JurisdictionContext,
  ComposedPolicySet,
  GovernanceRegime,
  CryptoSuite,
  ProofAnchoringMethod,
  ConsentModel,
  EscalationMode,
  TrustLevel,
} from "./types.js";

const logger = createLogger({ component: "regime-selector" });

const CRYPTO_STRICTNESS: Record<CryptoSuite, number> = {
  standard: 0,
  "fips-140-2": 1,
  "sm-national": 2,
  "post-quantum": 3,
  "cnsa-2.0": 4,
};
const PROOF_STRICTNESS: Record<ProofAnchoringMethod, number> = {
  database: 0,
  "merkle-tree": 1,
  "blockchain-l2": 2,
  "tsa-rfc3161": 3,
  "hardware-hsm": 4,
};
const CONSENT_STRICTNESS: Record<ConsentModel, number> = {
  implicit: 0,
  "opt-out": 1,
  "opt-in": 2,
  "explicit-granular": 3,
  "dual-consent": 4,
};
const ESCALATION_STRICTNESS: Record<EscalationMode, number> = {
  "log-only": 0,
  "flag-review": 1,
  "block-escalate": 2,
  "hard-block": 3,
};

export function hasJurisdiction(
  ctx: JurisdictionContext,
  ...js: Jurisdiction[]
): boolean {
  return js.some((j) => ctx.primaryJurisdictions.includes(j));
}

export function hasPolicyConstraint(
  ps: ComposedPolicySet,
  type: string,
): boolean {
  return ps.constraints.some((c) => c.type === type);
}

export function extractPolicyConstraintValue<T = unknown>(
  ps: ComposedPolicySet,
  type: string,
): T | undefined {
  return ps.constraints.find((c) => c.type === type)?.value as T | undefined;
}

function pickStrictest<T extends string>(
  defaults: T[],
  pv: T | undefined,
  map: Record<T, number>,
): T {
  const all = pv ? [...defaults, pv] : defaults;
  return all.reduce((s, c) => ((map[c] ?? 0) > (map[s] ?? 0) ? c : s));
}

export function resolveCryptoSuite(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): CryptoSuite {
  const pv = extractPolicyConstraintValue<CryptoSuite>(ps, "crypto");
  const d: CryptoSuite[] = ["standard"];
  if (hasJurisdiction(ctx, "US-DOD")) d.push("cnsa-2.0");
  else if (hasJurisdiction(ctx, "US-FED")) d.push("fips-140-2");
  else if (hasJurisdiction(ctx, "CN")) d.push("sm-national");
  return pickStrictest(d, pv, CRYPTO_STRICTNESS);
}

export function resolveProofAnchoring(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): ProofAnchoringMethod {
  const pv = extractPolicyConstraintValue<ProofAnchoringMethod>(
    ps,
    "proof-anchoring",
  );
  const d: ProofAnchoringMethod[] = ["database"];
  if (hasJurisdiction(ctx, "US-DOD")) d.push("hardware-hsm");
  else if (hasJurisdiction(ctx, "US-FED")) d.push("tsa-rfc3161");
  else if (hasJurisdiction(ctx, "EU")) d.push("merkle-tree");
  return pickStrictest(d, pv, PROOF_STRICTNESS);
}

export function resolveConsentModel(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): ConsentModel {
  const pv = extractPolicyConstraintValue<ConsentModel>(ps, "consent");
  const d: ConsentModel[] = ["implicit"];
  if (hasJurisdiction(ctx, "EU")) d.push("explicit-granular");
  else if (hasJurisdiction(ctx, "CA")) d.push("opt-in");
  else if (hasJurisdiction(ctx, "US")) d.push("opt-out");
  return pickStrictest(d, pv, CONSENT_STRICTNESS);
}

export function resolveEscalationMode(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): EscalationMode {
  const pv = extractPolicyConstraintValue<EscalationMode>(ps, "escalation");
  const d: EscalationMode[] = ["flag-review"];
  if (hasJurisdiction(ctx, "US-DOD")) d.push("hard-block");
  else if (hasJurisdiction(ctx, "US-FED", "EU")) d.push("block-escalate");
  return pickStrictest(d, pv, ESCALATION_STRICTNESS);
}

export function resolveAuditRetentionDays(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): number {
  const pv = extractPolicyConstraintValue<number>(ps, "retention");
  const d = [365];
  if (hasJurisdiction(ctx, "EU")) d.push(1825);
  if (hasJurisdiction(ctx, "US-FED")) d.push(2555);
  if (hasJurisdiction(ctx, "US-DOD")) d.push(3650);
  return Math.max(...(pv ? [...d, pv] : d));
}

export function resolveExternalServicesAllowed(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): boolean {
  if (hasJurisdiction(ctx, "US-DOD", "CN")) return false;
  const pv = extractPolicyConstraintValue<boolean>(ps, "external-services");
  return pv !== undefined ? pv : true;
}

export function resolveMinimumTrustLevel(
  ctx: JurisdictionContext,
  ps: ComposedPolicySet,
): TrustLevel {
  const pv = extractPolicyConstraintValue<TrustLevel>(ps, "trust-level");
  const d: TrustLevel[] = [2];
  if (hasJurisdiction(ctx, "US-DOD")) d.push(6);
  else if (hasJurisdiction(ctx, "US-FED")) d.push(4);
  else if (hasJurisdiction(ctx, "EU")) d.push(3);
  return Math.max(...(pv !== undefined ? [...d, pv] : d)) as TrustLevel;
}

export function generateRegimeId(p: {
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
    auditRetentionDays: p.auditRetentionDays,
    consentModel: p.consentModel,
    cryptoSuite: p.cryptoSuite,
    dataResidency: p.dataResidency,
    escalationMode: p.escalationMode,
    externalServicesAllowed: p.externalServicesAllowed,
    jurisdictions: [...p.jurisdictions].sort(),
    minimumTrustLevel: p.minimumTrustLevel,
    proofAnchoring: p.proofAnchoring,
  };
  return (
    "regime-" +
    createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex")
      .substring(0, 16)
  );
}

export class RegimeSelector {
  select(ctx: JurisdictionContext, ps: ComposedPolicySet): GovernanceRegime {
    const cs = resolveCryptoSuite(ctx, ps);
    const pa = resolveProofAnchoring(ctx, ps);
    const cm = resolveConsentModel(ctx, ps);
    const em = resolveEscalationMode(ctx, ps);
    const ard = resolveAuditRetentionDays(ctx, ps);
    const esa = resolveExternalServicesAllowed(ctx, ps);
    const mtl = resolveMinimumTrustLevel(ctx, ps);
    const rid = generateRegimeId({
      jurisdictions: ctx.primaryJurisdictions,
      cryptoSuite: cs,
      proofAnchoring: pa,
      consentModel: cm,
      escalationMode: em,
      auditRetentionDays: ard,
      dataResidency: ctx.dataResidency,
      externalServicesAllowed: esa,
      minimumTrustLevel: mtl,
    });
    const nameParts =
      ctx.primaryJurisdictions.length === 1
        ? ctx.primaryJurisdictions[0]
        : "Multi(" + ctx.primaryJurisdictions.join("+") + ")";
    const name =
      ctx.industry !== "general" ? nameParts + "-" + ctx.industry : nameParts;
    const regime: GovernanceRegime = {
      regimeId: rid,
      name: name || "default",
      jurisdictions: ctx.primaryJurisdictions,
      policyNamespaces: ps.sourceBundles,
      cryptoSuite: cs,
      proofAnchoring: pa,
      auditRetentionDays: ard,
      consentModel: cm,
      escalationMode: em,
      dataResidency: ctx.dataResidency,
      externalServicesAllowed: esa,
      minimumTrustLevel: mtl,
      conformityAssessmentRequired: hasJurisdiction(ctx, "EU"),
      transparencyRequired: hasJurisdiction(ctx, "EU", "CA", "UK"),
      metadata: {},
    };
    if (hasJurisdiction(ctx, "US-DOD")) regime.fedrampImpactLevel = "high";
    else if (hasJurisdiction(ctx, "US-FED"))
      regime.fedrampImpactLevel = "moderate";
    logger.info(
      { regimeId: rid, name, cryptoSuite: cs, minimumTrustLevel: mtl },
      "Regime assembled",
    );
    return regime;
  }
}
