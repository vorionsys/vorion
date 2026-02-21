/**
 * POLICY COMPOSER
 * @packageDocumentation
 */
import { createLogger } from "../common/logger.js";

import type {
  Jurisdiction,
  JurisdictionContext,
  PolicyConstraint,
  PolicyConstraintType,
  PolicyConflict,
  ComposedPolicySet,
  EnforcementLevel,
  ConflictSeverity,
  CryptoSuite,
} from "./types.js";

const logger = createLogger({ component: "policy-composer" });

export interface PolicyBundleDefinition {
  id: string;
  name: string;
  jurisdictions: Jurisdiction[];
  priority: number;
  constraints: PolicyConstraint[];
}

export const CRYPTO_SUITE_STRICTNESS: Record<CryptoSuite, number> = {
  standard: 0,
  "fips-140-2": 1,
  "sm-national": 2,
  "post-quantum": 3,
  "cnsa-2.0": 4,
};

const ENFORCEMENT_ORDER: Record<EnforcementLevel, number> = {
  advisory: 0,
  required: 1,
  mandatory: 2,
  blocking: 3,
};

function c(
  id: string,
  type: PolicyConstraintType,
  rule: string,
  enforcement: EnforcementLevel,
  bundleId: string,
  jurisdiction: Jurisdiction,
  value: unknown,
): PolicyConstraint {
  return {
    id,
    type,
    rule,
    enforcement,
    sourceBundleId: bundleId,
    sourceJurisdiction: jurisdiction,
    value,
  };
}

function createBuiltinBundles(): PolicyBundleDefinition[] {
  return [
    {
      id: "global-default",
      name: "Global Default",
      jurisdictions: ["GLOBAL"],
      priority: 0,
      constraints: [
        c(
          "global-retention",
          "retention",
          "Min 365-day retention",
          "required",
          "global-default",
          "GLOBAL",
          365,
        ),
        c(
          "global-crypto",
          "crypto",
          "Standard crypto",
          "required",
          "global-default",
          "GLOBAL",
          "standard",
        ),
        c(
          "global-consent",
          "consent",
          "Implicit consent",
          "required",
          "global-default",
          "GLOBAL",
          "implicit",
        ),
        c(
          "global-escalation",
          "escalation",
          "Flag for review",
          "required",
          "global-default",
          "GLOBAL",
          "flag-review",
        ),
        c(
          "global-trust",
          "trust-level",
          "Min trust T2",
          "required",
          "global-default",
          "GLOBAL",
          2,
        ),
        c(
          "global-proof",
          "proof-anchoring",
          "Database proof",
          "required",
          "global-default",
          "GLOBAL",
          "database",
        ),
        c(
          "global-external",
          "external-services",
          "External allowed",
          "advisory",
          "global-default",
          "GLOBAL",
          true,
        ),
      ],
    },
    {
      id: "eu-gdpr",
      name: "EU GDPR",
      jurisdictions: ["EU"],
      priority: 10,
      constraints: [
        c(
          "eu-retention",
          "retention",
          "GDPR: 5yr retention",
          "mandatory",
          "eu-gdpr",
          "EU",
          1825,
        ),
        c(
          "eu-consent",
          "consent",
          "GDPR: Explicit granular",
          "mandatory",
          "eu-gdpr",
          "EU",
          "explicit-granular",
        ),
        c(
          "eu-residency",
          "data-residency",
          "GDPR: EU data residency",
          "mandatory",
          "eu-gdpr",
          "EU",
          "eu-west",
        ),
        c(
          "eu-proof",
          "proof-anchoring",
          "GDPR: Merkle tree",
          "required",
          "eu-gdpr",
          "EU",
          "merkle-tree",
        ),
        c(
          "eu-trust",
          "trust-level",
          "GDPR: Min trust T3",
          "required",
          "eu-gdpr",
          "EU",
          3,
        ),
        c(
          "eu-processing",
          "processing-restriction",
          "GDPR: Purpose limitation",
          "mandatory",
          "eu-gdpr",
          "EU",
          "purpose-limitation",
        ),
        c(
          "eu-audit",
          "audit-requirement",
          "GDPR: Full audit trail",
          "mandatory",
          "eu-gdpr",
          "EU",
          "full-audit-trail",
        ),
      ],
    },
    {
      id: "eu-ai-act",
      name: "EU AI Act",
      jurisdictions: ["EU"],
      priority: 15,
      constraints: [
        c(
          "euai-escalation",
          "escalation",
          "AI Act: Block and escalate",
          "mandatory",
          "eu-ai-act",
          "EU",
          "block-escalate",
        ),
        c(
          "euai-audit",
          "audit-requirement",
          "AI Act: AI system audit",
          "mandatory",
          "eu-ai-act",
          "EU",
          "ai-system-audit",
        ),
        c(
          "euai-processing",
          "processing-restriction",
          "AI Act: Risk assessment",
          "mandatory",
          "eu-ai-act",
          "EU",
          "risk-assessment-required",
        ),
      ],
    },
    {
      id: "us-federal",
      name: "US Federal",
      jurisdictions: ["US", "US-FED"],
      priority: 10,
      constraints: [
        c(
          "usfed-retention",
          "retention",
          "US Fed: 7yr retention",
          "mandatory",
          "us-federal",
          "US-FED",
          2555,
        ),
        c(
          "usfed-crypto",
          "crypto",
          "US Fed: FIPS 140-2",
          "mandatory",
          "us-federal",
          "US-FED",
          "fips-140-2",
        ),
        c(
          "usfed-proof",
          "proof-anchoring",
          "US Fed: TSA RFC 3161",
          "required",
          "us-federal",
          "US-FED",
          "tsa-rfc3161",
        ),
        c(
          "usfed-trust",
          "trust-level",
          "US Fed: Min trust T4",
          "mandatory",
          "us-federal",
          "US-FED",
          4,
        ),
        c(
          "usfed-escalation",
          "escalation",
          "US Fed: Block and escalate",
          "mandatory",
          "us-federal",
          "US-FED",
          "block-escalate",
        ),
        c(
          "usfed-residency",
          "data-residency",
          "US Fed: US Gov regions",
          "mandatory",
          "us-federal",
          "US-FED",
          "us-gov-east",
        ),
      ],
    },
    {
      id: "us-defense",
      name: "US Defense/CMMC",
      jurisdictions: ["US-DOD"],
      priority: 20,
      constraints: [
        c(
          "usdod-retention",
          "retention",
          "DoD: 10yr retention",
          "blocking",
          "us-defense",
          "US-DOD",
          3650,
        ),
        c(
          "usdod-crypto",
          "crypto",
          "DoD: CNSA 2.0",
          "blocking",
          "us-defense",
          "US-DOD",
          "cnsa-2.0",
        ),
        c(
          "usdod-proof",
          "proof-anchoring",
          "DoD: Hardware HSM",
          "blocking",
          "us-defense",
          "US-DOD",
          "hardware-hsm",
        ),
        c(
          "usdod-trust",
          "trust-level",
          "DoD: Min trust T6",
          "blocking",
          "us-defense",
          "US-DOD",
          6,
        ),
        c(
          "usdod-escalation",
          "escalation",
          "DoD: Hard block",
          "blocking",
          "us-defense",
          "US-DOD",
          "hard-block",
        ),
        c(
          "usdod-external",
          "external-services",
          "DoD: No external",
          "blocking",
          "us-defense",
          "US-DOD",
          false,
        ),
        c(
          "usdod-residency",
          "data-residency",
          "DoD: DoD facilities",
          "blocking",
          "us-defense",
          "US-DOD",
          "us-gov-west",
        ),
        c(
          "usdod-clearance",
          "security-clearance",
          "DoD: Secret clearance",
          "blocking",
          "us-defense",
          "US-DOD",
          "secret",
        ),
        c(
          "usdod-consent",
          "consent",
          "DoD: Dual consent",
          "mandatory",
          "us-defense",
          "US-DOD",
          "dual-consent",
        ),
      ],
    },
    {
      id: "hipaa",
      name: "HIPAA",
      jurisdictions: ["US", "US-FED"],
      priority: 12,
      constraints: [
        c(
          "hipaa-retention",
          "retention",
          "HIPAA: 6yr PHI retention",
          "mandatory",
          "hipaa",
          "US",
          2190,
        ),
        c(
          "hipaa-consent",
          "consent",
          "HIPAA: Opt-in PHI",
          "mandatory",
          "hipaa",
          "US",
          "opt-in",
        ),
        c(
          "hipaa-audit",
          "audit-requirement",
          "HIPAA: PHI access audit",
          "mandatory",
          "hipaa",
          "US",
          "phi-access-audit",
        ),
        c(
          "hipaa-access",
          "access-control",
          "HIPAA: RBAC for PHI",
          "mandatory",
          "hipaa",
          "US",
          "rbac-phi",
        ),
        c(
          "hipaa-processing",
          "processing-restriction",
          "HIPAA: Minimum necessary",
          "mandatory",
          "hipaa",
          "US",
          "minimum-necessary",
        ),
      ],
    },
    {
      id: "soc2",
      name: "SOC 2 Type II",
      jurisdictions: ["US", "GLOBAL"],
      priority: 8,
      constraints: [
        c(
          "soc2-retention",
          "retention",
          "SOC 2: 1yr retention",
          "required",
          "soc2",
          "US",
          365,
        ),
        c(
          "soc2-access",
          "access-control",
          "SOC 2: Logical access",
          "required",
          "soc2",
          "US",
          "logical-access",
        ),
        c(
          "soc2-audit",
          "audit-requirement",
          "SOC 2: Change mgmt audit",
          "required",
          "soc2",
          "US",
          "change-management-audit",
        ),
        c(
          "soc2-escalation",
          "escalation",
          "SOC 2: Flag for review",
          "required",
          "soc2",
          "US",
          "flag-review",
        ),
      ],
    },
  ];
}

export class PolicyComposer {
  private bundles = new Map<string, PolicyBundleDefinition>();
  constructor() {
    for (const b of createBuiltinBundles()) this.bundles.set(b.id, b);
  }
  get bundleCount(): number {
    return this.bundles.size;
  }
  get registeredBundleIds(): string[] {
    return Array.from(this.bundles.keys());
  }

  registerBundle(bundle: PolicyBundleDefinition): void {
    if (this.bundles.has(bundle.id))
      logger.warn({ bundleId: bundle.id }, "Overwriting bundle");
    this.bundles.set(bundle.id, bundle);
    logger.info(
      { bundleId: bundle.id, priority: bundle.priority },
      "Bundle registered",
    );
  }

  compose(
    ctx: JurisdictionContext,
    additionalBundleIds?: string[],
  ): ComposedPolicySet {
    const applicable = this.selectApplicable(ctx, additionalBundleIds);
    if (applicable.length === 0) {
      const g = this.bundles.get("global-default");
      if (g) applicable.push(g);
    }
    applicable.sort((a, b) => a.priority - b.priority);
    const all: PolicyConstraint[] = [];
    for (const b of applicable) all.push(...b.constraints);
    const grouped = new Map<PolicyConstraintType, PolicyConstraint[]>();
    for (const co of all) {
      const g = grouped.get(co.type) ?? [];
      g.push(co);
      grouped.set(co.type, g);
    }
    const resolved: PolicyConstraint[] = [];
    const rConflicts: PolicyConflict[] = [];
    const uConflicts: PolicyConflict[] = [];
    for (const [type, cons] of grouped.entries()) {
      const r = this.resolveGroup(type, cons, applicable);
      resolved.push(...r.resolved);
      rConflicts.push(...r.resolvedConflicts);
      uConflicts.push(...r.unresolvedConflicts);
    }
    const isValid = uConflicts.every((co) => co.severity !== "critical");
    return {
      constraints: resolved,
      sourceBundles: applicable.map((b) => b.id),
      resolvedConflicts: rConflicts,
      unresolvedConflicts: uConflicts,
      isValid,
      composedAt: Date.now(),
    };
  }

  private selectApplicable(
    ctx: JurisdictionContext,
    ids?: string[],
  ): PolicyBundleDefinition[] {
    const sel: PolicyBundleDefinition[] = [];
    const used = new Set<string>();
    for (const [id, b] of this.bundles) {
      if (
        b.jurisdictions.some(
          (j) => j === "GLOBAL" || ctx.primaryJurisdictions.includes(j),
        ) &&
        !used.has(id)
      ) {
        sel.push(b);
        used.add(id);
      }
    }
    if (ids)
      for (const id of ids) {
        if (!used.has(id)) {
          const b = this.bundles.get(id);
          if (b) {
            sel.push(b);
            used.add(id);
          }
        }
      }
    return sel;
  }

  private resolveGroup(
    type: PolicyConstraintType,
    cons: PolicyConstraint[],
    bundles: PolicyBundleDefinition[],
  ) {
    type R = {
      resolved: PolicyConstraint[];
      resolvedConflicts: PolicyConflict[];
      unresolvedConflicts: PolicyConflict[];
    };
    if (cons.length <= 1)
      return {
        resolved: cons,
        resolvedConflicts: [],
        unresolvedConflicts: [],
      } as R;
    switch (type) {
      case "retention":
      case "trust-level":
        return this.byMax(type, cons);
      case "crypto":
        return this.byCrypto(cons);
      case "consent":
        return this.byStrictness(type, cons, {
          implicit: 0,
          "opt-out": 1,
          "opt-in": 2,
          "explicit-granular": 3,
          "dual-consent": 4,
        });
      case "escalation":
        return this.byStrictness(type, cons, {
          "log-only": 0,
          "flag-review": 1,
          "block-escalate": 2,
          "hard-block": 3,
        });
      case "proof-anchoring":
        return this.byStrictness(type, cons, {
          database: 0,
          "merkle-tree": 1,
          "blockchain-l2": 2,
          "tsa-rfc3161": 3,
          "hardware-hsm": 4,
        });
      case "security-clearance":
        return this.byStrictness(type, cons, {
          none: 0,
          public: 0,
          confidential: 1,
          secret: 2,
          "top-secret": 3,
        });
      case "data-residency":
        return this.dataResidency(cons);
      case "external-services":
        return this.extServices(cons);
      case "access-control":
      case "processing-restriction":
      case "audit-requirement":
        return this.additive(cons);
      default:
        return this.byPriority(type, cons, bundles);
    }
  }

  private byMax(type: PolicyConstraintType, cons: PolicyConstraint[]) {
    const vals = cons.map((co) => ({
      co,
      n: typeof co.value === "number" ? co.value : 0,
    }));
    const max = vals.reduce((m, v) => (v.n > m.n ? v : m));
    const conflict = new Set(vals.map((v) => v.n)).size > 1;
    return {
      resolved: [max.co],
      resolvedConflicts: conflict
        ? [
            {
              constraintType: type,
              constraints: cons,
              description: type + ": max=" + max.n,
              severity: "low" as ConflictSeverity,
            },
          ]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private byCrypto(cons: PolicyConstraint[]) {
    const vals = cons.map((co) => ({
      co,
      s: CRYPTO_SUITE_STRICTNESS[co.value as CryptoSuite] ?? 0,
    }));
    const best = vals.reduce((m, v) => (v.s > m.s ? v : m));
    const conflict = new Set(vals.map((v) => v.s)).size > 1;
    return {
      resolved: [best.co],
      resolvedConflicts: conflict
        ? [
            {
              constraintType: "crypto" as PolicyConstraintType,
              constraints: cons,
              description: "Crypto: strictest=" + best.co.value,
              severity: "low" as ConflictSeverity,
            },
          ]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private byStrictness(
    type: PolicyConstraintType,
    cons: PolicyConstraint[],
    map: Record<string, number>,
  ) {
    const vals = cons.map((co) => ({ co, s: map[String(co.value)] ?? 0 }));
    const best = vals.reduce((m, v) => (v.s > m.s ? v : m));
    const conflict = new Set(vals.map((v) => v.s)).size > 1;
    return {
      resolved: [best.co],
      resolvedConflicts: conflict
        ? [
            {
              constraintType: type,
              constraints: cons,
              description: type + ": strictest=" + best.co.value,
              severity: "low" as ConflictSeverity,
            },
          ]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private dataResidency(cons: PolicyConstraint[]) {
    const zones = new Set(cons.map((co) => String(co.value)));
    if (zones.size <= 1)
      return {
        resolved: [cons[0]],
        resolvedConflicts: [] as PolicyConflict[],
        unresolvedConflicts: [] as PolicyConflict[],
      };
    const sorted = [...cons].sort(
      (a, b) =>
        (ENFORCEMENT_ORDER[b.enforcement] ?? 0) -
        (ENFORCEMENT_ORDER[a.enforcement] ?? 0),
    );
    const blocking = sorted.some(
      (co) => co.enforcement === "blocking" || co.enforcement === "mandatory",
    );
    if (blocking)
      return {
        resolved: [sorted[0]],
        resolvedConflicts: [] as PolicyConflict[],
        unresolvedConflicts: [
          {
            constraintType: "data-residency" as PolicyConstraintType,
            constraints: cons,
            description: "Incompatible residency: " + [...zones].join(" vs "),
            severity: "critical" as ConflictSeverity,
          },
        ],
      };
    return {
      resolved: [sorted[0]],
      resolvedConflicts: [
        {
          constraintType: "data-residency" as PolicyConstraintType,
          constraints: cons,
          description: "Residency resolved to " + sorted[0].value,
          severity: "medium" as ConflictSeverity,
        },
      ],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private extServices(cons: PolicyConstraint[]) {
    const blocked = cons.some((co) => co.value === false);
    const winner = blocked ? cons.find((co) => co.value === false)! : cons[0];
    const conflict = new Set(cons.map((co) => co.value)).size > 1;
    return {
      resolved: [winner],
      resolvedConflicts: conflict
        ? [
            {
              constraintType: "external-services" as PolicyConstraintType,
              constraints: cons,
              description: "External services: " + winner.value,
              severity: "low" as ConflictSeverity,
            },
          ]
        : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private additive(cons: PolicyConstraint[]) {
    const seen = new Set<string>();
    const unique: PolicyConstraint[] = [];
    for (const co of cons) {
      const k = String(co.value);
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(co);
      }
    }
    return {
      resolved: unique,
      resolvedConflicts: [] as PolicyConflict[],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }

  private byPriority(
    type: PolicyConstraintType,
    cons: PolicyConstraint[],
    bundles: PolicyBundleDefinition[],
  ) {
    const pm = new Map(bundles.map((b) => [b.id, b.priority]));
    const sorted = [...cons].sort(
      (a, b) =>
        (pm.get(b.sourceBundleId) ?? 0) - (pm.get(a.sourceBundleId) ?? 0),
    );
    return {
      resolved: [sorted[0]],
      resolvedConflicts:
        cons.length > 1
          ? [
              {
                constraintType: type,
                constraints: cons,
                description: type + ": by priority=" + sorted[0].sourceBundleId,
                severity: "low" as ConflictSeverity,
              },
            ]
          : [],
      unresolvedConflicts: [] as PolicyConflict[],
    };
  }
}
