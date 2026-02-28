/**
 * Snapshot tests for v2 contract schemas.
 *
 * Tests evidence, retention, and other v2 module schemas.
 */

import { describe, it, expect } from "vitest";
import { describeSchema } from "./helpers/schema-descriptor";

import {
  EvidenceTypeSchema,
  EvidenceClassificationSchema,
  EvidenceItemSchema,
  EvidencePackSchema,
  ProofEventSchema,
} from "../src/v2/evidence";

import {
  RetentionPolicySchema,
  LegalHoldSchema,
  SealEventSchema,
  RetentionScheduleSchema,
} from "../src/v2/retention";

describe("V2 Evidence Schemas", () => {
  const schemas = {
    EvidenceTypeSchema,
    EvidenceClassificationSchema,
    EvidenceItemSchema,
    EvidencePackSchema,
    ProofEventSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it("EvidenceTypeSchema accepts INTENT_SUBMISSION", () => {
    expect(EvidenceTypeSchema.safeParse("INTENT_SUBMISSION").success).toBe(
      true,
    );
  });

  it("EvidenceTypeSchema rejects invalid type", () => {
    expect(EvidenceTypeSchema.safeParse("UNKNOWN_TYPE").success).toBe(false);
  });

  it("EvidenceClassificationSchema accepts all classifications", () => {
    for (const c of [
      "ROUTINE",
      "SIGNIFICANT",
      "COMPLIANCE_RELEVANT",
      "SECURITY_RELEVANT",
      "INCIDENT_RELATED",
      "LEGAL_HOLD",
    ]) {
      expect(EvidenceClassificationSchema.safeParse(c).success).toBe(true);
    }
  });
});

describe("V2 Retention Schemas", () => {
  const schemas = {
    RetentionPolicySchema,
    LegalHoldSchema,
    SealEventSchema,
    RetentionScheduleSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});
