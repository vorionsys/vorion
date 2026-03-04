/**
 * INTENT GATEWAY - Jurisdictional Router / Governance Topology Selector
 * @packageDocumentation
 */
import { createHash } from "node:crypto";

import { AiActClassifier } from "./ai-act-classifier.js";
import { JurisdictionResolver } from "./jurisdiction-resolver.js";
import { PolicyComposer } from "./policy-composer.js";
import { RegimeSelector } from "./regime-selector.js";
import { DEFAULT_GATEWAY_CONFIG } from "./types.js";
import { createLogger } from "../common/logger.js";
import { extractTenantId } from "../common/tenant-context.js";

import type { AiActClassificationResult } from "./ai-act-classifier.js";
import type {
  GovernanceRegime,
  JurisdictionContext,
  ComposedPolicySet,
  GatewayDispatchResult,
  TenantJurisdictionConfig,
  IntentGatewayConfig,
} from "./types.js";
import type { TenantContext } from "../common/tenant-context.js";
import type { Intent } from "../common/types.js";
import type {
  IIntentService,
  SubmitOptions,
  IntentSubmission,
} from "../intent/types.js";

const logger = createLogger({ component: "intent-gateway" });

export class GatewayConflictError extends Error {
  public readonly conflicts: ComposedPolicySet["unresolvedConflicts"];
  constructor(conflicts: ComposedPolicySet["unresolvedConflicts"]) {
    super(
      "Intent blocked by unresolved policy conflicts: " +
        conflicts.map((c) => c.description).join("; "),
    );
    this.name = "GatewayConflictError";
    this.conflicts = conflicts;
  }
}

const EU_EEA_CODES = new Set(["EU"]);

interface CacheEntry {
  regime: GovernanceRegime;
  policySet: ComposedPolicySet;
  jurisdictionContext: JurisdictionContext;
  cachedAt: number;
}

export class IntentGateway {
  private intentService: IIntentService;
  private config: IntentGatewayConfig;
  private jurisdictionResolver: JurisdictionResolver;
  private policyComposer: PolicyComposer;
  private regimeSelector: RegimeSelector;
  private aiActClassifier: AiActClassifier;
  private cache = new Map<string, CacheEntry>();

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
      {
        enabled: this.config.enabled,
        defaultJurisdiction: this.config.defaultJurisdiction,
      },
      "IntentGateway initialized",
    );
  }

  async dispatch(
    submission: IntentSubmission | Record<string, unknown>,
    options: SubmitOptions,
  ): Promise<GatewayDispatchResult> {
    if (!this.config.enabled) {
      const intent = await this.intentService.submit(
        submission as Record<string, unknown>,
        options,
      );
      return this.createPassthroughResult(intent);
    }
    try {
      const intentMeta = (submission as Record<string, unknown>).context as
        | Record<string, unknown>
        | undefined;
      const jCtx = this.jurisdictionResolver.resolve(options.ctx, intentMeta);
      const tenantId = extractTenantId(options.ctx);
      const tConfig = this.jurisdictionResolver.getTenantConfig(tenantId);
      const policySet = this.policyComposer.compose(
        jCtx,
        tConfig?.customPolicyBundles,
      );
      const warnings: string[] = [];
      if (policySet.unresolvedConflicts.length > 0) {
        if (this.config.blockOnConflicts && !policySet.isValid)
          throw new GatewayConflictError(policySet.unresolvedConflicts);
        for (const conflict of policySet.unresolvedConflicts)
          warnings.push("Unresolved: " + conflict.description);
      }
      let aiAct: AiActClassificationResult | undefined;
      if (jCtx.primaryJurisdictions.some((j) => EU_EEA_CODES.has(j))) {
        const goal =
          typeof (submission as Record<string, unknown>).goal === "string"
            ? ((submission as Record<string, unknown>).goal as string)
            : "";
        const iType =
          typeof (submission as Record<string, unknown>).intentType === "string"
            ? ((submission as Record<string, unknown>).intentType as string)
            : undefined;
        aiAct = this.aiActClassifier.classify(goal, intentMeta, iType);
        if (aiAct.classification === "unacceptable")
          warnings.push("EU AI Act: PROHIBITED - " + aiAct.reasoning);
      }
      const regime = this.regimeSelector.select(jCtx, policySet);
      if (aiAct) {
        regime.aiActClassification = aiAct.classification;
        regime.aiActHighRiskCategory = aiAct.highRiskCategory;
      }
      this.cacheRegime(tenantId, jCtx, regime, policySet);
      const enriched: SubmitOptions = {
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
      if (
        !enriched.trustLevel ||
        enriched.trustLevel < regime.minimumTrustLevel
      )
        enriched.trustLevel = regime.minimumTrustLevel;
      if (this.config.logRegimeDecisions)
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
          "Gateway regime decision",
        );
      const intent = await this.intentService.submit(
        submission as Record<string, unknown>,
        enriched,
      );
      return { intent, regime, jurisdictionContext: jCtx, policySet, warnings };
    } catch (error) {
      if (error instanceof GatewayConflictError) throw error;
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Gateway error - falling through",
      );
      const intent = await this.intentService.submit(
        submission as Record<string, unknown>,
        options,
      );
      const result = this.createPassthroughResult(intent);
      result.warnings.push(
        "Gateway degraded: " +
          (error instanceof Error ? error.message : "Unknown"),
      );
      return result;
    }
  }

  resolveRegime(
    ctx: TenantContext,
    metadata?: Record<string, unknown> | null,
  ): {
    regime: GovernanceRegime;
    jurisdictionContext: JurisdictionContext;
    policySet: ComposedPolicySet;
  } {
    const tenantId = extractTenantId(ctx);
    const cached = this.getCachedRegime(tenantId);
    if (cached)
      return {
        regime: cached.regime,
        jurisdictionContext: cached.jurisdictionContext,
        policySet: cached.policySet,
      };
    const jCtx = this.jurisdictionResolver.resolve(ctx, metadata);
    const tConfig = this.jurisdictionResolver.getTenantConfig(tenantId);
    const policySet = this.policyComposer.compose(
      jCtx,
      tConfig?.customPolicyBundles,
    );
    const regime = this.regimeSelector.select(jCtx, policySet);
    this.cacheRegime(tenantId, jCtx, regime, policySet);
    return { regime, jurisdictionContext: jCtx, policySet };
  }

  registerTenantConfig(
    tenantId: string,
    config: TenantJurisdictionConfig,
  ): void {
    this.jurisdictionResolver.registerTenantConfig(tenantId, config);
    this.invalidateTenantCache(tenantId);
  }

  getActiveRegime(tenantId: string): GovernanceRegime | undefined {
    return this.getCachedRegime(tenantId)?.regime;
  }
  clearCache(): void {
    this.cache.clear();
  }
  getIntentService(): IIntentService {
    return this.intentService;
  }
  getConfig(): Readonly<IntentGatewayConfig> {
    return { ...this.config };
  }

  private createPassthroughResult(intent: Intent): GatewayDispatchResult {
    return {
      intent,
      regime: {
        regimeId: "regime-passthrough",
        name: "passthrough",
        jurisdictions: [this.config.defaultJurisdiction],
        policyNamespaces: [],
        cryptoSuite: "standard",
        proofAnchoring: "database",
        auditRetentionDays: 365,
        consentModel: "implicit",
        escalationMode: "flag-review",
        dataResidency: "global",
        externalServicesAllowed: true,
        minimumTrustLevel: 2,
        conformityAssessmentRequired: false,
        transparencyRequired: false,
        metadata: {},
      },
      jurisdictionContext: {
        primaryJurisdictions: [this.config.defaultJurisdiction],
        industry: this.config.defaultIndustry,
        dataResidency: "global",
        crossBorderTransfer: false,
        source: "default",
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

  private getCacheKey(tenantId: string, js?: string[]): string {
    const h = js
      ? createHash("sha256")
          .update(JSON.stringify([...js].sort()))
          .digest("hex")
          .substring(0, 12)
      : "default";
    return tenantId + ":" + h;
  }

  private cacheRegime(
    tenantId: string,
    ctx: JurisdictionContext,
    regime: GovernanceRegime,
    policySet: ComposedPolicySet,
  ): void {
    this.cache.set(this.getCacheKey(tenantId, ctx.primaryJurisdictions), {
      regime,
      policySet,
      jurisdictionContext: ctx,
      cachedAt: Date.now(),
    });
  }

  private getCachedRegime(tenantId: string): CacheEntry | undefined {
    for (const [key, entry] of this.cache) {
      if (key.startsWith(tenantId + ":")) {
        if (Date.now() - entry.cachedAt > this.config.regimeCacheTtlMs) {
          this.cache.delete(key);
          return undefined;
        }
        return entry;
      }
    }
    return undefined;
  }

  private invalidateTenantCache(tenantId: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(tenantId + ":")) this.cache.delete(key);
    }
  }
}

export function createIntentGateway(
  intentService: IIntentService,
  config?: Partial<IntentGatewayConfig>,
): IntentGateway {
  return new IntentGateway(intentService, config);
}

export { JurisdictionResolver } from "./jurisdiction-resolver.js";
export { PolicyComposer } from "./policy-composer.js";
export type { PolicyBundleDefinition } from "./policy-composer.js";
export { RegimeSelector } from "./regime-selector.js";
export { AiActClassifier } from "./ai-act-classifier.js";
export type { AiActClassificationResult } from "./ai-act-classifier.js";
export type {
  Jurisdiction,
  Industry,
  CryptoSuite,
  ProofAnchoringMethod,
  ConsentModel,
  EscalationMode,
  AiActClassification,
  AiActHighRiskCategory,
  JurisdictionContext,
  JurisdictionSource,
  GovernanceRegime,
  PolicyConstraint,
  PolicyConstraintType,
  EnforcementLevel,
  PolicyConflict,
  ConflictSeverity,
  ComposedPolicySet,
  GatewayDispatchResult,
  TenantJurisdictionConfig,
  IntentGatewayConfig,
} from "./types.js";
export { DEFAULT_GATEWAY_CONFIG } from "./types.js";
