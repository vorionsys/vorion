import { describe, it, expect } from "vitest";
import { CHALLENGE_CATALOG, getChallengesByFactor } from "../challenges.js";
import { T1_FACTORS, DIFFICULTY_ORDER } from "../types.js";
import type { T1Factor, ChallengeDifficulty } from "../types.js";

describe("Challenge Catalog", () => {
  it("should have exactly 21 challenges", () => {
    expect(CHALLENGE_CATALOG).toHaveLength(21);
  });

  it("should have 7 challenges per factor", () => {
    for (const factor of T1_FACTORS) {
      const factorChallenges = CHALLENGE_CATALOG.filter(
        (c) => c.factor === factor,
      );
      expect(factorChallenges).toHaveLength(7);
    }
  });

  it("should have 3 basic, 2 intermediate, 2 adversarial per factor", () => {
    for (const factor of T1_FACTORS) {
      const factorChallenges = CHALLENGE_CATALOG.filter(
        (c) => c.factor === factor,
      );
      const basic = factorChallenges.filter((c) => c.difficulty === "basic");
      const intermediate = factorChallenges.filter(
        (c) => c.difficulty === "intermediate",
      );
      const adversarial = factorChallenges.filter(
        (c) => c.difficulty === "adversarial",
      );

      expect(basic).toHaveLength(3);
      expect(intermediate).toHaveLength(2);
      expect(adversarial).toHaveLength(2);
    }
  });

  it("should have unique challenge IDs", () => {
    const ids = CHALLENGE_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should follow ID naming convention", () => {
    const prefixMap: Record<T1Factor, string> = {
      "CT-COMP": "comp-",
      "CT-REL": "rel-",
      "CT-OBS": "obs-",
    };

    for (const challenge of CHALLENGE_CATALOG) {
      expect(challenge.id).toMatch(
        new RegExp(`^${prefixMap[challenge.factor]}`),
      );
    }
  });

  it("should have positive timeoutMs on all challenges", () => {
    for (const challenge of CHALLENGE_CATALOG) {
      expect(challenge.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("should have positive maxPoints on all challenges", () => {
    for (const challenge of CHALLENGE_CATALOG) {
      expect(challenge.maxPoints).toBeGreaterThan(0);
    }
  });

  it("adversarial challenges should have non-none adversarialType", () => {
    const adversarial = CHALLENGE_CATALOG.filter(
      (c) => c.difficulty === "adversarial",
    );
    for (const challenge of adversarial) {
      expect(challenge.adversarialType).not.toBe("none");
    }
  });

  it('basic challenges should have adversarialType "none"', () => {
    const basic = CHALLENGE_CATALOG.filter((c) => c.difficulty === "basic");
    for (const challenge of basic) {
      expect(challenge.adversarialType).toBe("none");
    }
  });

  it("every challenge should have an evaluator", () => {
    for (const challenge of CHALLENGE_CATALOG) {
      expect(challenge.evaluator).toBeDefined();
      expect(challenge.evaluator.type).toBeDefined();
    }
  });
});

describe("getChallengesByFactor", () => {
  it("should return all challenges when no filter given", () => {
    const result = getChallengesByFactor();
    expect(result).toHaveLength(21);
  });

  it("should filter by factor", () => {
    const comp = getChallengesByFactor("CT-COMP");
    expect(comp).toHaveLength(7);
    expect(comp.every((c) => c.factor === "CT-COMP")).toBe(true);
  });

  it("should filter by difficulty", () => {
    const basic = getChallengesByFactor(undefined, "basic");
    expect(basic).toHaveLength(9); // 3 per factor × 3 factors
    expect(basic.every((c) => c.difficulty === "basic")).toBe(true);
  });

  it("should filter by both factor and difficulty", () => {
    const result = getChallengesByFactor("CT-REL", "adversarial");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.factor === "CT-REL")).toBe(true);
    expect(result.every((c) => c.difficulty === "adversarial")).toBe(true);
  });
});
