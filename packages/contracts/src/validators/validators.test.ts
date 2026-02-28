import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  TrustBand,
  ObservationTier,
  DataSensitivity,
  Reversibility,
  ActionType,
  ApprovalType,
} from "../v2/enums.js";
import {
  trustBandSchema,
  observationTierSchema,
  dataSensitivitySchema,
  reversibilitySchema,
  actionTypeSchema,
  approvalTypeSchema,
} from "./enums.js";
import {
  intentContextSchema,
  intentSchema,
  createIntentRequestSchema,
} from "./intent.js";
import {
  trustFactorScoresSchema,
  trustEvidenceSchema,
  trustProfileSchema,
} from "./trust-profile.js";
import {
  rateLimitSchema,
  approvalRequirementSchema,
  decisionConstraintsSchema,
  decisionSchema,
} from "./decision.js";
import { validate, safeValidate, formatValidationErrors } from "./index.js";
import { z } from "zod";

// ============================================================================
// Test helpers
// ============================================================================

const uuid = () => randomUUID();
const now = new Date();

function validIntent() {
  return {
    intentId: uuid(),
    agentId: uuid(),
    correlationId: uuid(),
    action: "Read user profile data",
    actionType: ActionType.READ,
    resourceScope: ["users/profile"],
    dataSensitivity: DataSensitivity.INTERNAL,
    reversibility: Reversibility.REVERSIBLE,
    context: {},
    createdAt: now,
  };
}

function validTrustFactorScores() {
  return {
    "CT-COMP": 0.75,
    "CT-REL": 0.6,
    "CT-OBS": 0.8,
    "CT-TRANS": 0.5,
    "CT-ACCT": 0.7,
    "CT-SAFE": 0.65,
    "CT-SEC": 0.55,
    "CT-PRIV": 0.6,
    "CT-ID": 0.7,
    "OP-HUMAN": 0.8,
    "OP-ALIGN": 0.75,
    "OP-CONTEXT": 0.65,
    "OP-STEW": 0.6,
    "SF-HUM": 0.7,
    "SF-ADAPT": 0.55,
    "SF-LEARN": 0.5,
  };
}

function validDecision() {
  return {
    decisionId: uuid(),
    intentId: uuid(),
    agentId: uuid(),
    correlationId: uuid(),
    permitted: true,
    trustBand: TrustBand.T4_STANDARD,
    trustScore: 72,
    reasoning: ["Trust score meets threshold", "Action type is read-only"],
    decidedAt: now,
    expiresAt: new Date(now.getTime() + 3600000),
    latencyMs: 12.5,
    version: 1,
  };
}

// ============================================================================
// Enum validators
// ============================================================================

describe("Enum validators", () => {
  describe("trustBandSchema", () => {
    it("accepts valid trust bands", () => {
      expect(trustBandSchema.parse(TrustBand.T0_SANDBOX)).toBe(
        TrustBand.T0_SANDBOX,
      );
      expect(trustBandSchema.parse(TrustBand.T7_AUTONOMOUS)).toBe(
        TrustBand.T7_AUTONOMOUS,
      );
    });

    it("accepts numeric values for trust bands", () => {
      expect(trustBandSchema.parse(0)).toBe(TrustBand.T0_SANDBOX);
      expect(trustBandSchema.parse(4)).toBe(TrustBand.T4_STANDARD);
    });

    it("rejects invalid values", () => {
      expect(() => trustBandSchema.parse(8)).toThrow();
      expect(() => trustBandSchema.parse(-1)).toThrow();
      expect(() => trustBandSchema.parse("invalid")).toThrow();
    });
  });

  describe("observationTierSchema", () => {
    it("accepts valid observation tiers", () => {
      expect(observationTierSchema.parse("BLACK_BOX")).toBe(
        ObservationTier.BLACK_BOX,
      );
      expect(observationTierSchema.parse("VERIFIED_BOX")).toBe(
        ObservationTier.VERIFIED_BOX,
      );
    });

    it("rejects invalid values", () => {
      expect(() => observationTierSchema.parse("UNKNOWN")).toThrow();
    });
  });

  describe("dataSensitivitySchema", () => {
    it("accepts all sensitivity levels", () => {
      expect(dataSensitivitySchema.parse("PUBLIC")).toBe(
        DataSensitivity.PUBLIC,
      );
      expect(dataSensitivitySchema.parse("RESTRICTED")).toBe(
        DataSensitivity.RESTRICTED,
      );
    });
  });

  describe("reversibilitySchema", () => {
    it("accepts all reversibility levels", () => {
      expect(reversibilitySchema.parse("REVERSIBLE")).toBe(
        Reversibility.REVERSIBLE,
      );
      expect(reversibilitySchema.parse("IRREVERSIBLE")).toBe(
        Reversibility.IRREVERSIBLE,
      );
    });
  });

  describe("actionTypeSchema", () => {
    it("accepts all action types", () => {
      for (const type of Object.values(ActionType)) {
        expect(actionTypeSchema.parse(type)).toBe(type);
      }
    });
  });

  describe("approvalTypeSchema", () => {
    it("accepts all approval types", () => {
      for (const type of Object.values(ApprovalType)) {
        expect(approvalTypeSchema.parse(type)).toBe(type);
      }
    });
  });
});

// ============================================================================
// Intent validators
// ============================================================================

describe("Intent validators", () => {
  describe("intentContextSchema", () => {
    it("accepts empty context", () => {
      expect(intentContextSchema.parse({})).toEqual({});
    });

    it("accepts full context", () => {
      const ctx = {
        domain: "finance",
        environment: "production" as const,
        onBehalfOf: "user-123",
        sessionId: "sess-abc",
        parentIntentId: uuid(),
        priority: 5,
        handlesPii: true,
        handlesPhi: false,
        jurisdictions: ["US", "EU"],
        metadata: { key: "value" },
      };
      const result = intentContextSchema.parse(ctx);
      expect(result.domain).toBe("finance");
      expect(result.priority).toBe(5);
    });

    it("rejects invalid environment", () => {
      expect(() =>
        intentContextSchema.parse({ environment: "invalid" }),
      ).toThrow();
    });

    it("rejects priority out of range", () => {
      expect(() => intentContextSchema.parse({ priority: -1 })).toThrow();
      expect(() => intentContextSchema.parse({ priority: 11 })).toThrow();
    });

    it("rejects non-UUID parentIntentId", () => {
      expect(() =>
        intentContextSchema.parse({ parentIntentId: "not-a-uuid" }),
      ).toThrow();
    });
  });

  describe("intentSchema", () => {
    it("accepts valid intent", () => {
      const intent = validIntent();
      const result = intentSchema.parse(intent);
      expect(result.intentId).toBe(intent.intentId);
      expect(result.action).toBe("Read user profile data");
    });

    it("rejects missing required fields", () => {
      expect(() => intentSchema.parse({})).toThrow();
    });

    it("rejects non-UUID intentId", () => {
      const intent = validIntent();
      intent.intentId = "not-a-uuid" as any;
      expect(() => intentSchema.parse(intent)).toThrow();
    });

    it("rejects empty action", () => {
      const intent = { ...validIntent(), action: "" };
      expect(() => intentSchema.parse(intent)).toThrow();
    });

    it("rejects action exceeding 1000 chars", () => {
      const intent = { ...validIntent(), action: "x".repeat(1001) };
      expect(() => intentSchema.parse(intent)).toThrow();
    });

    it("accepts action at max 1000 chars", () => {
      const intent = { ...validIntent(), action: "x".repeat(1000) };
      expect(() => intentSchema.parse(intent)).not.toThrow();
    });

    it("coerces date strings to Date objects", () => {
      const intent = { ...validIntent(), createdAt: "2025-01-01T00:00:00Z" };
      const result = intentSchema.parse(intent);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("accepts optional expiresAt", () => {
      const intent = { ...validIntent(), expiresAt: new Date() };
      const result = intentSchema.parse(intent);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("createIntentRequestSchema", () => {
    it("accepts valid request", () => {
      const request = {
        agentId: uuid(),
        action: "Send email notification",
        actionType: ActionType.COMMUNICATE,
        resourceScope: ["email/outbound"],
        dataSensitivity: DataSensitivity.CONFIDENTIAL,
        reversibility: Reversibility.IRREVERSIBLE,
      };
      const result = createIntentRequestSchema.parse(request);
      expect(result.agentId).toBe(request.agentId);
    });

    it("accepts optional correlationId", () => {
      const request = {
        agentId: uuid(),
        correlationId: uuid(),
        action: "Test action",
        actionType: ActionType.READ,
        resourceScope: [],
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: Reversibility.REVERSIBLE,
      };
      expect(() => createIntentRequestSchema.parse(request)).not.toThrow();
    });

    it("accepts optional expiresIn", () => {
      const request = {
        agentId: uuid(),
        action: "Test action",
        actionType: ActionType.READ,
        resourceScope: [],
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: Reversibility.REVERSIBLE,
        expiresIn: 3600,
      };
      const result = createIntentRequestSchema.parse(request);
      expect(result.expiresIn).toBe(3600);
    });
  });
});

// ============================================================================
// Trust profile validators
// ============================================================================

describe("Trust profile validators", () => {
  describe("trustFactorScoresSchema", () => {
    it("accepts valid factor scores", () => {
      const scores = validTrustFactorScores();
      expect(trustFactorScoresSchema.parse(scores)).toEqual(scores);
    });

    it("rejects scores below 0", () => {
      expect(() =>
        trustFactorScoresSchema.parse({ "CT-COMP": -0.1 }),
      ).toThrow();
    });

    it("rejects scores above 1.0", () => {
      expect(() => trustFactorScoresSchema.parse({ "CT-COMP": 1.1 })).toThrow();
    });

    it("accepts boundary values 0.0 and 1.0", () => {
      const minScores = { "CT-COMP": 0.0, "CT-REL": 0.0 };
      expect(() => trustFactorScoresSchema.parse(minScores)).not.toThrow();

      const maxScores = { "CT-COMP": 1.0, "CT-REL": 1.0 };
      expect(() => trustFactorScoresSchema.parse(maxScores)).not.toThrow();
    });

    it("accepts any string keys as factor codes", () => {
      const scores = { "CT-COMP": 0.5, "OP-ALIGN": 0.7 };
      expect(() => trustFactorScoresSchema.parse(scores)).not.toThrow();
    });

    it("accepts empty record", () => {
      expect(() => trustFactorScoresSchema.parse({})).not.toThrow();
    });
  });

  describe("trustEvidenceSchema", () => {
    it("accepts valid evidence", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "CT-COMP",
        impact: 10,
        source: "automated-test",
        collectedAt: now,
      };
      const result = trustEvidenceSchema.parse(evidence);
      expect(result.evidenceId).toBe(evidence.evidenceId);
      expect(result.impact).toBe(10);
    });

    it("accepts negative impact", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "CT-REL",
        impact: -50,
        source: "incident-report",
        collectedAt: now,
      };
      expect(() => trustEvidenceSchema.parse(evidence)).not.toThrow();
    });

    it("rejects impact below -1000", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "CT-COMP",
        impact: -1001,
        source: "test",
        collectedAt: now,
      };
      expect(() => trustEvidenceSchema.parse(evidence)).toThrow();
    });

    it("rejects impact above 1000", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "CT-COMP",
        impact: 1001,
        source: "test",
        collectedAt: now,
      };
      expect(() => trustEvidenceSchema.parse(evidence)).toThrow();
    });

    it("rejects empty factorCode", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "",
        impact: 10,
        source: "test",
        collectedAt: now,
      };
      expect(() => trustEvidenceSchema.parse(evidence)).toThrow();
    });

    it("accepts valid factor codes", () => {
      for (const code of ["CT-COMP", "CT-REL", "OP-ALIGN", "SF-LEARN"]) {
        const evidence = {
          evidenceId: uuid(),
          factorCode: code,
          impact: 10,
          source: "test",
          collectedAt: now,
        };
        expect(() => trustEvidenceSchema.parse(evidence)).not.toThrow();
      }
    });

    it("accepts optional evidenceType", () => {
      const evidence = {
        evidenceId: uuid(),
        factorCode: "CT-COMP",
        impact: 10,
        source: "test",
        collectedAt: now,
        evidenceType: "hitl_approval" as const,
      };
      expect(() => trustEvidenceSchema.parse(evidence)).not.toThrow();
    });
  });

  describe("trustProfileSchema", () => {
    it("accepts valid trust profile", () => {
      const profile = {
        profileId: uuid(),
        agentId: uuid(),
        factorScores: validTrustFactorScores(),
        compositeScore: 680,
        observationTier: ObservationTier.WHITE_BOX,
        adjustedScore: 610,
        band: TrustBand.T3_MONITORED,
        calculatedAt: now,
        evidence: [],
        version: 1,
      };
      const result = trustProfileSchema.parse(profile);
      expect(result.compositeScore).toBe(680);
      expect(result.band).toBe(TrustBand.T3_MONITORED);
    });

    it("rejects compositeScore above 1000", () => {
      const profile = {
        profileId: uuid(),
        agentId: uuid(),
        factorScores: validTrustFactorScores(),
        compositeScore: 1001,
        observationTier: ObservationTier.WHITE_BOX,
        adjustedScore: 900,
        band: TrustBand.T6_CERTIFIED,
        calculatedAt: now,
        evidence: [],
        version: 1,
      };
      expect(() => trustProfileSchema.parse(profile)).toThrow();
    });

    it("accepts profile with evidence array", () => {
      const profile = {
        profileId: uuid(),
        agentId: uuid(),
        factorScores: validTrustFactorScores(),
        compositeScore: 680,
        observationTier: ObservationTier.GRAY_BOX,
        adjustedScore: 510,
        band: TrustBand.T2_PROVISIONAL,
        calculatedAt: now,
        evidence: [
          {
            evidenceId: uuid(),
            factorCode: "CT-COMP",
            impact: 5,
            source: "canary-probe",
            collectedAt: now,
          },
        ],
        version: 0,
      };
      const result = trustProfileSchema.parse(profile);
      expect(result.evidence).toHaveLength(1);
    });
  });
});

// ============================================================================
// Decision validators
// ============================================================================

describe("Decision validators", () => {
  describe("rateLimitSchema", () => {
    it("accepts valid rate limit", () => {
      const rl = { resource: "api/v1", limit: 100, windowSeconds: 60 };
      expect(rateLimitSchema.parse(rl)).toEqual(rl);
    });

    it("rejects empty resource", () => {
      expect(() =>
        rateLimitSchema.parse({ resource: "", limit: 100, windowSeconds: 60 }),
      ).toThrow();
    });

    it("rejects non-positive limit", () => {
      expect(() =>
        rateLimitSchema.parse({ resource: "api", limit: 0, windowSeconds: 60 }),
      ).toThrow();
      expect(() =>
        rateLimitSchema.parse({
          resource: "api",
          limit: -1,
          windowSeconds: 60,
        }),
      ).toThrow();
    });
  });

  describe("approvalRequirementSchema", () => {
    it("accepts valid approval", () => {
      const approval = {
        type: ApprovalType.HUMAN_REVIEW,
        approver: "security-team",
        reason: "High-risk operation",
      };
      expect(approvalRequirementSchema.parse(approval)).toEqual(approval);
    });

    it("accepts optional timeoutMs", () => {
      const approval = {
        type: ApprovalType.MULTI_PARTY,
        approver: "admin",
        timeoutMs: 300000,
        reason: "Multi-party required",
      };
      const result = approvalRequirementSchema.parse(approval);
      expect(result.timeoutMs).toBe(300000);
    });
  });

  describe("decisionConstraintsSchema", () => {
    it("accepts valid constraints", () => {
      const constraints = {
        requiredApprovals: [],
        allowedTools: ["read-db", "write-log"],
        dataScopes: ["users/*"],
        rateLimits: [],
        reversibilityRequired: true,
      };
      const result = decisionConstraintsSchema.parse(constraints);
      expect(result.allowedTools).toEqual(["read-db", "write-log"]);
    });

    it("accepts constraints with nested rate limits", () => {
      const constraints = {
        requiredApprovals: [],
        allowedTools: [],
        dataScopes: [],
        rateLimits: [{ resource: "api", limit: 10, windowSeconds: 60 }],
        reversibilityRequired: false,
        maxExecutionTimeMs: 30000,
        maxRetries: 3,
      };
      const result = decisionConstraintsSchema.parse(constraints);
      expect(result.rateLimits).toHaveLength(1);
      expect(result.maxRetries).toBe(3);
    });
  });

  describe("decisionSchema", () => {
    it("accepts valid decision", () => {
      const decision = validDecision();
      const result = decisionSchema.parse(decision);
      expect(result.permitted).toBe(true);
      expect(result.trustScore).toBe(72);
    });

    it("rejects trustScore above 100", () => {
      const decision = { ...validDecision(), trustScore: 101 };
      expect(() => decisionSchema.parse(decision)).toThrow();
    });

    it("rejects trustScore below 0", () => {
      const decision = { ...validDecision(), trustScore: -1 };
      expect(() => decisionSchema.parse(decision)).toThrow();
    });

    it("rejects negative version", () => {
      const decision = { ...validDecision(), version: -1 };
      expect(() => decisionSchema.parse(decision)).toThrow();
    });

    it("accepts decision with constraints", () => {
      const decision = {
        ...validDecision(),
        constraints: {
          requiredApprovals: [],
          allowedTools: ["read-only"],
          dataScopes: ["public/*"],
          rateLimits: [],
          reversibilityRequired: true,
        },
      };
      const result = decisionSchema.parse(decision);
      expect(result.constraints).toBeDefined();
      expect(result.constraints!.allowedTools).toEqual(["read-only"]);
    });

    it("accepts decision without constraints", () => {
      const decision = validDecision();
      const result = decisionSchema.parse(decision);
      expect(result.constraints).toBeUndefined();
    });

    it("coerces date strings", () => {
      const decision = {
        ...validDecision(),
        decidedAt: "2025-06-01T00:00:00Z",
        expiresAt: "2025-06-01T01:00:00Z",
      };
      const result = decisionSchema.parse(decision);
      expect(result.decidedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });
});

// ============================================================================
// Utility functions
// ============================================================================

describe("Validation utilities", () => {
  const simpleSchema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  describe("validate", () => {
    it("returns parsed data for valid input", () => {
      const result = validate(simpleSchema, { name: "Alice", age: 30 });
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("throws ZodError for invalid input", () => {
      expect(() => validate(simpleSchema, { name: "", age: -1 })).toThrow();
    });

    it("works with complex schemas", () => {
      const intent = validIntent();
      const result = validate(intentSchema, intent);
      expect(result.intentId).toBe(intent.intentId);
    });
  });

  describe("safeValidate", () => {
    it("returns success for valid input", () => {
      const result = safeValidate(simpleSchema, { name: "Bob", age: 25 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Bob");
      }
    });

    it("returns errors for invalid input", () => {
      const result = safeValidate(simpleSchema, { name: "", age: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("captures all validation errors", () => {
      const result = safeValidate(simpleSchema, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("formatValidationErrors", () => {
    it("formats errors with paths", () => {
      const result = safeValidate(simpleSchema, { name: 123, age: "abc" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationErrors(result.errors);
        expect(formatted.length).toBeGreaterThan(0);
        expect(formatted.some((e) => e.includes("name"))).toBe(true);
      }
    });

    it("formats errors without paths", () => {
      const schema = z.string().min(1);
      const result = schema.safeParse("");
      if (!result.success) {
        const formatted = formatValidationErrors(result.error.issues);
        expect(formatted.length).toBeGreaterThan(0);
      }
    });

    it("handles nested path errors", () => {
      const result = safeValidate(intentSchema, {
        ...validIntent(),
        context: { priority: 99 },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatValidationErrors(result.errors);
        expect(formatted.some((e) => e.includes("context"))).toBe(true);
      }
    });
  });
});
