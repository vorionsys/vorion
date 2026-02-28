/**
 * Validation tests for CAR string parsing and generation.
 *
 * Tests the full L0-L7 level range, all 26 domain codes (A-Z),
 * extensions, and edge cases to verify the fixes from ADR-018.
 */

import { describe, it, expect } from "vitest";
import {
  CAR_REGEX,
  CAR_PARTIAL_REGEX,
  CAR_LEGACY_REGEX,
  parseCAR,
  generateCAR,
  parsedCARSchema,
  carStringSchema,
  generateCAROptionsSchema,
} from "../src/car/car-string";
import { CapabilityLevel } from "../src/car/levels";
import type { DomainCode } from "../src/car/domains";

// ============================================================================
// Level Range Tests (L0-L7)
// ============================================================================

describe("CAR Level Range (L0-L7)", () => {
  const levels = [
    { level: 0, enum: CapabilityLevel.L0_OBSERVE, name: "L0_OBSERVE" },
    { level: 1, enum: CapabilityLevel.L1_ADVISE, name: "L1_ADVISE" },
    { level: 2, enum: CapabilityLevel.L2_DRAFT, name: "L2_DRAFT" },
    { level: 3, enum: CapabilityLevel.L3_EXECUTE, name: "L3_EXECUTE" },
    { level: 4, enum: CapabilityLevel.L4_AUTONOMOUS, name: "L4_AUTONOMOUS" },
    { level: 5, enum: CapabilityLevel.L5_TRUSTED, name: "L5_TRUSTED" },
    { level: 6, enum: CapabilityLevel.L6_CERTIFIED, name: "L6_CERTIFIED" },
    { level: 7, enum: CapabilityLevel.L7_AUTONOMOUS, name: "L7_AUTONOMOUS" },
  ];

  describe("CAR_REGEX accepts all levels", () => {
    for (const { level, name } of levels) {
      it(`accepts ${name} (L${level})`, () => {
        const car = `a3i.vorion.test-agent:AB-L${level}@1.0.0`;
        expect(CAR_REGEX.test(car)).toBe(true);
      });
    }

    it("rejects L8 (out of range)", () => {
      expect(CAR_REGEX.test("a3i.vorion.test-agent:AB-L8@1.0.0")).toBe(false);
    });

    it("rejects L9 (out of range)", () => {
      expect(CAR_REGEX.test("a3i.vorion.test-agent:AB-L9@1.0.0")).toBe(false);
    });
  });

  describe("CAR_PARTIAL_REGEX accepts all levels", () => {
    for (const { level, name } of levels) {
      it(`accepts ${name} (L${level})`, () => {
        const car = `a3i.vorion.test-agent:AB-L${level}@1.0.0`;
        expect(CAR_PARTIAL_REGEX.test(car)).toBe(true);
      });
    }
  });

  describe("parseCAR handles all levels", () => {
    for (const { level, enum: levelEnum, name } of levels) {
      it(`parses ${name} (L${level})`, () => {
        const car = `a3i.vorion.test-agent:AB-L${level}@1.0.0`;
        const parsed = parseCAR(car);
        expect(parsed.level).toBe(levelEnum);
      });
    }
  });

  describe("generateCAR produces all levels", () => {
    for (const { enum: levelEnum, name } of levels) {
      it(`generates ${name}`, () => {
        const car = generateCAR({
          registry: "a3i",
          organization: "vorion",
          agentClass: "test-agent",
          domains: ["A", "B"] as DomainCode[],
          level: levelEnum,
          version: "1.0.0",
        });
        expect(car).toContain(`-L${levelEnum}@`);
        expect(parseCAR(car).level).toBe(levelEnum);
      });
    }
  });

  describe("carStringSchema validates all levels", () => {
    for (const { level, name } of levels) {
      it(`accepts ${name} (L${level})`, () => {
        const car = `a3i.vorion.test-agent:AB-L${level}@1.0.0`;
        expect(carStringSchema.safeParse(car).success).toBe(true);
      });
    }

    it("rejects L8", () => {
      expect(
        carStringSchema.safeParse("a3i.vorion.test-agent:AB-L8@1.0.0").success,
      ).toBe(false);
    });
  });
});

// ============================================================================
// Domain Code Tests (A-Z)
// ============================================================================

describe("CAR Domain Codes (A-Z)", () => {
  const allCodes: DomainCode[] = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
  ];

  describe("CAR_REGEX accepts all domain codes", () => {
    for (const code of allCodes) {
      it(`accepts domain code ${code}`, () => {
        const car = `a3i.vorion.test-agent:${code}-L3@1.0.0`;
        expect(CAR_REGEX.test(car)).toBe(true);
      });
    }
  });

  describe("parseCAR handles all domain codes", () => {
    for (const code of allCodes) {
      it(`parses domain code ${code}`, () => {
        const car = `a3i.vorion.test-agent:${code}-L3@1.0.0`;
        const parsed = parseCAR(car);
        expect(parsed.domains).toContain(code);
      });
    }
  });

  describe("generateCAR handles all domain codes", () => {
    for (const code of allCodes) {
      it(`generates with domain code ${code}`, () => {
        const car = generateCAR({
          registry: "a3i",
          organization: "vorion",
          agentClass: "test-agent",
          domains: [code],
          level: CapabilityLevel.L3_EXECUTE,
          version: "1.0.0",
        });
        expect(parseCAR(car).domains).toContain(code);
      });
    }
  });

  it("handles all 26 domains together", () => {
    const car = generateCAR({
      registry: "a3i",
      organization: "vorion",
      agentClass: "omni-agent",
      domains: allCodes,
      level: CapabilityLevel.L5_TRUSTED,
      version: "1.0.0",
    });
    const parsed = parseCAR(car);
    expect(parsed.domains).toHaveLength(26);
  });

  it("sorts domains alphabetically", () => {
    const car = generateCAR({
      registry: "a3i",
      organization: "vorion",
      agentClass: "test-agent",
      domains: ["Z", "A", "M"] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      version: "1.0.0",
    });
    expect(car).toContain(":AMZ-L3@");
  });

  describe("parsedCARSchema validates all domain codes", () => {
    for (const code of allCodes) {
      it(`accepts domain code ${code} in schema`, () => {
        const result = parsedCARSchema.safeParse({
          car: `a3i.vorion.test:${code}-L3@1.0.0`,
          registry: "a3i",
          organization: "vorion",
          agentClass: "test",
          domains: [code],
          domainsBitmask: 1,
          level: CapabilityLevel.L3_EXECUTE,
          version: "1.0.0",
          extensions: [],
        });
        expect(result.success).toBe(true);
      });
    }
  });

  describe("generateCAROptionsSchema validates all domain codes", () => {
    for (const code of allCodes) {
      it(`accepts domain code ${code} in options schema`, () => {
        const result = generateCAROptionsSchema.safeParse({
          registry: "a3i",
          organization: "vorion",
          agentClass: "test",
          domains: [code],
          level: CapabilityLevel.L3_EXECUTE,
          version: "1.0.0",
        });
        expect(result.success).toBe(true);
      });
    }
  });
});

// ============================================================================
// Legacy Format Tests
// ============================================================================

describe("CAR Legacy Format", () => {
  it("CAR_LEGACY_REGEX accepts L6 and L7", () => {
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L6-T5@1.0.0")).toBe(true);
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L7-T7@1.0.0")).toBe(true);
  });

  it("CAR_LEGACY_REGEX accepts T6 and T7", () => {
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L3-T6@1.0.0")).toBe(true);
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L3-T7@1.0.0")).toBe(true);
  });

  it("CAR_LEGACY_REGEX rejects L8 and T8", () => {
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L8-T3@1.0.0")).toBe(false);
    expect(CAR_LEGACY_REGEX.test("a3i.vorion.test:AB-L3-T8@1.0.0")).toBe(false);
  });
});

// ============================================================================
// Extension Tests
// ============================================================================

describe("CAR Extensions", () => {
  it("parses extensions correctly", () => {
    const car = "a3i.vorion.test:AB-L3@1.0.0#cognigate,gov,audit";
    const parsed = parseCAR(car);
    expect(parsed.extensions).toEqual(["cognigate", "gov", "audit"]);
  });

  it("handles CAR without extensions", () => {
    const car = "a3i.vorion.test:AB-L3@1.0.0";
    const parsed = parseCAR(car);
    expect(parsed.extensions).toEqual([]);
  });

  it("generates CAR with extensions", () => {
    const car = generateCAR({
      registry: "a3i",
      organization: "vorion",
      agentClass: "test",
      domains: ["A", "B"] as DomainCode[],
      level: CapabilityLevel.L3_EXECUTE,
      version: "1.0.0",
      extensions: ["cognigate", "gov"],
    });
    expect(car).toBe("a3i.vorion.test:AB-L3@1.0.0#cognigate,gov");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("CAR Edge Cases", () => {
  it("rejects lowercase domain codes", () => {
    expect(CAR_REGEX.test("a3i.vorion.test:ab-L3@1.0.0")).toBe(false);
  });

  it("rejects empty domains", () => {
    expect(CAR_REGEX.test("a3i.vorion.test:-L3@1.0.0")).toBe(false);
  });

  it("rejects uppercase registry", () => {
    expect(CAR_REGEX.test("A3I.vorion.test:AB-L3@1.0.0")).toBe(false);
  });

  it("rejects missing version", () => {
    expect(CAR_REGEX.test("a3i.vorion.test:AB-L3@")).toBe(false);
  });

  it("highest valid CAR: L7 with all domains", () => {
    const car = "a3i.vorion.sovereign:ABCDEFGHIJKLMNOPQRSTUVWXYZ-L7@1.0.0";
    expect(CAR_REGEX.test(car)).toBe(true);
    const parsed = parseCAR(car);
    expect(parsed.level).toBe(CapabilityLevel.L7_AUTONOMOUS);
    expect(parsed.domains).toHaveLength(26);
  });

  it("lowest valid CAR: L0 with single domain", () => {
    const car = "a3i.vorion.observer:A-L0@0.1.0";
    expect(CAR_REGEX.test(car)).toBe(true);
    const parsed = parseCAR(car);
    expect(parsed.level).toBe(CapabilityLevel.L0_OBSERVE);
    expect(parsed.domains).toHaveLength(1);
  });
});
