/**
 * JURISDICTION RESOLVER - Three-tier resolution
 * @packageDocumentation
 */
import { createLogger } from "../common/logger.js";
import { extractTenantId } from "../common/tenant-context.js";

import type {
  Jurisdiction,
  Industry,
  JurisdictionContext,
  TenantJurisdictionConfig,
  IntentGatewayConfig,
} from "./types.js";
import type { TenantContext } from "../common/tenant-context.js";

const logger = createLogger({ component: "jurisdiction-resolver" });

export const JURISDICTION_RESIDENCY_ZONES: Record<Jurisdiction, string> = {
  GLOBAL: "global",
  EU: "eu-west",
  US: "us-east",
  "US-FED": "us-gov-east",
  "US-DOD": "us-gov-west",
  UK: "uk-south",
  CA: "ca-central",
  AU: "au-southeast",
  JP: "ap-northeast-1",
  KR: "ap-northeast-2",
  SG: "ap-southeast-1",
  CH: "eu-central",
  CN: "cn-north",
  IN: "ap-south",
  BR: "sa-east",
  IL: "me-west",
  AE: "me-central",
  SA: "me-south",
};

const EU_MEMBER_STATE_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);

const COUNTRY_JURISDICTION_MAP: Record<string, Jurisdiction> = {
  US: "US",
  GB: "UK",
  CA: "CA",
  AU: "AU",
  JP: "JP",
  KR: "KR",
  SG: "SG",
  CH: "CH",
  CN: "CN",
  IN: "IN",
  BR: "BR",
  IL: "IL",
  AE: "AE",
  SA: "SA",
};

export class JurisdictionResolver {
  private tenantConfigs = new Map<string, TenantJurisdictionConfig>();
  private config: IntentGatewayConfig;

  constructor(config: IntentGatewayConfig) {
    this.config = config;
  }

  resolve(
    ctx: TenantContext,
    intentMetadata?: Record<string, unknown> | null,
  ): JurisdictionContext {
    const tenantId = extractTenantId(ctx);
    const tenantResult = this.resolveFromTenantConfig(tenantId);
    if (tenantResult) {
      logger.debug(
        { tenantId, source: "tenant-config" },
        "Jurisdiction from tenant config",
      );
      return tenantResult;
    }
    const metadataResult = this.resolveFromMetadata(intentMetadata);
    if (metadataResult) {
      logger.debug(
        { tenantId, source: "metadata" },
        "Jurisdiction from metadata",
      );
      return metadataResult;
    }
    const defaultResult = this.resolveDefault();
    logger.debug({ tenantId, source: "default" }, "Jurisdiction from defaults");
    return defaultResult;
  }

  registerTenantConfig(
    tenantId: string,
    config: TenantJurisdictionConfig,
  ): void {
    this.tenantConfigs.set(tenantId, config);
    logger.info(
      { tenantId, jurisdictions: config.jurisdictions },
      "Tenant config registered",
    );
  }

  getTenantConfig(tenantId: string): TenantJurisdictionConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  detectCrossBorderTransfer(jurisdictions: Jurisdiction[]): boolean {
    if (jurisdictions.length <= 1) return false;
    const zones = new Set(
      jurisdictions.map((j) => JURISDICTION_RESIDENCY_ZONES[j]),
    );
    return zones.size > 1;
  }

  private resolveFromTenantConfig(
    tenantId: string,
  ): JurisdictionContext | null {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return null;
    return {
      primaryJurisdictions: config.jurisdictions,
      industry: config.industry,
      dataResidency:
        config.dataResidency ??
        JURISDICTION_RESIDENCY_ZONES[config.jurisdictions[0]] ??
        "global",
      crossBorderTransfer: this.detectCrossBorderTransfer(config.jurisdictions),
      source: "tenant-config",
    };
  }

  private resolveFromMetadata(
    metadata?: Record<string, unknown> | null,
  ): JurisdictionContext | null {
    if (!metadata) return null;
    const jurisdictions = this.extractJurisdictionFromMetadata(metadata);
    if (jurisdictions.length === 0) return null;
    const industry =
      typeof metadata.industry === "string" &&
      this.isValidIndustry(metadata.industry)
        ? (metadata.industry as Industry)
        : this.config.defaultIndustry;
    const dataResidency =
      (typeof metadata.dataResidency === "string"
        ? metadata.dataResidency
        : undefined) ??
      JURISDICTION_RESIDENCY_ZONES[jurisdictions[0]] ??
      "global";
    return {
      primaryJurisdictions: jurisdictions,
      industry,
      dataResidency,
      crossBorderTransfer: this.detectCrossBorderTransfer(jurisdictions),
      source: "metadata-inference",
    };
  }

  private resolveDefault(): JurisdictionContext {
    return {
      primaryJurisdictions: [this.config.defaultJurisdiction],
      industry: this.config.defaultIndustry,
      dataResidency:
        JURISDICTION_RESIDENCY_ZONES[this.config.defaultJurisdiction] ??
        "global",
      crossBorderTransfer: false,
      source: "default",
    };
  }

  private extractJurisdictionFromMetadata(
    metadata: Record<string, unknown>,
  ): Jurisdiction[] {
    const jurisdictions: Jurisdiction[] = [];
    if (typeof metadata.jurisdiction === "string") {
      const j = metadata.jurisdiction.toUpperCase() as Jurisdiction;
      if (this.isValidJurisdiction(j)) jurisdictions.push(j);
    }
    if (Array.isArray(metadata.jurisdictions)) {
      for (const item of metadata.jurisdictions) {
        if (typeof item === "string") {
          const j = item.toUpperCase() as Jurisdiction;
          if (this.isValidJurisdiction(j) && !jurisdictions.includes(j))
            jurisdictions.push(j);
        }
      }
    }
    if (typeof metadata.countryCode === "string") {
      const code = metadata.countryCode.toUpperCase();
      if (EU_MEMBER_STATE_CODES.has(code)) {
        if (!jurisdictions.includes("EU")) jurisdictions.push("EU");
      } else if (COUNTRY_JURISDICTION_MAP[code]) {
        const j = COUNTRY_JURISDICTION_MAP[code];
        if (!jurisdictions.includes(j)) jurisdictions.push(j);
      }
    }
    if (typeof metadata.region === "string") {
      const region = metadata.region.toUpperCase();
      if (["EU", "EUROPE", "EEA"].includes(region)) {
        if (!jurisdictions.includes("EU")) jurisdictions.push("EU");
      } else if (["US", "UNITED STATES"].includes(region)) {
        if (!jurisdictions.includes("US")) jurisdictions.push("US");
      }
    }
    return jurisdictions;
  }

  private isValidJurisdiction(v: string): v is Jurisdiction {
    return [
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
    ].includes(v);
  }

  private isValidIndustry(v: string): v is Industry {
    return [
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
    ].includes(v);
  }
}
