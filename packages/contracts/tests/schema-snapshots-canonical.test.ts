/**
 * Snapshot tests for canonical module schemas.
 *
 * Tests governance, agent, trust-band, trust-signal, risk-level,
 * intent, and middleware schemas from the canonical module.
 */

import { describe, it, expect } from "vitest";
import { describeSchema } from "./helpers/schema-descriptor";

import {
  governanceDenialReasonSchema,
  denialReasonSchema,
  anyDenialReasonSchema,
  authorizationConstraintsSchema,
  authorizationResultSchema,
  governanceRoleSchema,
  authContextSchema,
  hierarchyLevelSchema,
  hierarchyLevelConfigSchema,
  authorityScopeTypeSchema,
  controlActionSchema,
  authorityScopeSchema,
  authorityTypeSchema,
  permissionSchema,
  authoritySchema,
} from "../src/canonical/governance";

import {
  agentLifecycleStatusSchema,
  agentRuntimeStatusSchema,
  agentPermissionSchema,
  collaborationModeSchema,
  agentCapabilitySchema,
  agentSpecializationSchema,
  agentRuntimeMetricsSchema,
  agentPerformanceMetricsSchema,
  taskPrioritySchema,
  taskStatusSchema,
  taskSourceSchema,
  agentTaskSchema,
  agentPersonaSchema,
  agentConfigSchema,
} from "../src/canonical/agent";

import {
  trustBandSchema,
  trustBandThresholdSchema,
  bandComparisonSchema,
} from "../src/canonical/trust-band";

import {
  signalTypeSchema,
  signalSourceSchema,
  trustDimensionSchema,
  signalImpactSchema,
  trustSignalSchema,
  trustSignalSummarySchema,
  createTrustSignalRequestSchema,
  signalAggregationSchema,
} from "../src/canonical/trust-signal";

import { riskLevelSchema as canonicalRiskLevelSchema } from "../src/canonical/risk-level";

import {
  actionTypeSchema,
  dataSensitivitySchema,
  reversibilitySchema,
  intentStatusSchema,
  intentContextSchema,
  intentSchema,
  intentSummarySchema,
  createIntentRequestSchema,
} from "../src/canonical/intent";

import {
  rateLimitConfigSchema,
  rateLimitResultSchema,
  corsConfigSchema,
  errorResponseSchema,
  errorCategorySchema,
  securityHeadersConfigSchema,
} from "../src/canonical/middleware";

describe("Canonical Governance Schemas", () => {
  const schemas = {
    governanceDenialReasonSchema,
    denialReasonSchema,
    anyDenialReasonSchema,
    authorizationConstraintsSchema,
    authorizationResultSchema,
    governanceRoleSchema,
    authContextSchema,
    hierarchyLevelSchema,
    hierarchyLevelConfigSchema,
    authorityScopeTypeSchema,
    controlActionSchema,
    authorityScopeSchema,
    authorityTypeSchema,
    permissionSchema,
    authoritySchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("governanceDenialReasonSchema accepts MISSING_ROLES", () => {
    expect(
      governanceDenialReasonSchema.safeParse("missing_roles").success,
    ).toBe(true);
  });

  it("governanceDenialReasonSchema rejects invalid reason", () => {
    expect(governanceDenialReasonSchema.safeParse("invalid").success).toBe(
      false,
    );
  });

  it("authorizationResultSchema accepts valid result", () => {
    const result = authorizationResultSchema.safeParse({
      allowed: true,
      reason: "All checks passed",
    });
    expect(result.success).toBe(true);
  });
});

describe("Canonical Agent Schemas", () => {
  const schemas = {
    agentLifecycleStatusSchema,
    agentRuntimeStatusSchema,
    agentPermissionSchema,
    collaborationModeSchema,
    agentCapabilitySchema,
    agentSpecializationSchema,
    agentRuntimeMetricsSchema,
    agentPerformanceMetricsSchema,
    taskPrioritySchema,
    taskStatusSchema,
    taskSourceSchema,
    agentTaskSchema,
    agentPersonaSchema,
    agentConfigSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("agentLifecycleStatusSchema accepts active", () => {
    expect(agentLifecycleStatusSchema.safeParse("active").success).toBe(true);
  });

  it("agentLifecycleStatusSchema rejects unknown status", () => {
    expect(agentLifecycleStatusSchema.safeParse("deleted").success).toBe(false);
  });

  it("taskPrioritySchema accepts valid priorities", () => {
    for (const p of ["critical", "high", "medium", "low"]) {
      expect(taskPrioritySchema.safeParse(p).success).toBe(true);
    }
  });
});

describe("Canonical Trust Band Schemas", () => {
  const schemas = {
    trustBandSchema,
    trustBandThresholdSchema,
    bandComparisonSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("trustBandSchema accepts T0-T7 numeric values", () => {
    for (let i = 0; i <= 7; i++) {
      expect(trustBandSchema.safeParse(i).success).toBe(true);
    }
  });
});

describe("Canonical Trust Signal Schemas", () => {
  const schemas = {
    signalTypeSchema,
    signalSourceSchema,
    trustDimensionSchema,
    signalImpactSchema,
    trustSignalSchema,
    trustSignalSummarySchema,
    createTrustSignalRequestSchema,
    signalAggregationSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe("Canonical Risk Level Schema", () => {
  it("canonicalRiskLevelSchema shape matches snapshot", () => {
    expect(describeSchema(canonicalRiskLevelSchema)).toMatchSnapshot();
  });
});

describe("Canonical Intent Schemas", () => {
  const schemas = {
    actionTypeSchema,
    dataSensitivitySchema,
    reversibilitySchema,
    intentStatusSchema,
    intentContextSchema,
    intentSchema,
    intentSummarySchema,
    createIntentRequestSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("actionTypeSchema accepts read", () => {
    expect(actionTypeSchema.safeParse("read").success).toBe(true);
  });

  it("intentStatusSchema accepts pending", () => {
    expect(intentStatusSchema.safeParse("pending").success).toBe(true);
  });
});

describe("Canonical Middleware Schemas", () => {
  const schemas = {
    rateLimitConfigSchema,
    rateLimitResultSchema,
    corsConfigSchema,
    errorResponseSchema,
    errorCategorySchema,
    securityHeadersConfigSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("errorCategorySchema accepts valid categories", () => {
    for (const c of [
      "authentication",
      "authorization",
      "validation",
      "not_found",
      "internal",
    ]) {
      expect(errorCategorySchema.safeParse(c).success).toBe(true);
    }
  });
});
