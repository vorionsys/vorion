/**
 * Contracts package — export verification test.
 *
 * Verifies that the main entry point exports are accessible at runtime.
 * Comprehensive schema snapshot tests are in the schema-snapshots-* files.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as contracts from "../src/index";
import * as Canonical from "../src/canonical/index";

describe("contracts package exports", () => {
  it("exports Canonical namespace", () => {
    expect(contracts.Canonical).toBeDefined();
  });

  it("exports db namespace", () => {
    expect(contracts.db).toBeDefined();
  });

  it("Canonical module exports Zod schemas", () => {
    // Verify a sample of key exports are ZodType instances
    expect(Canonical.trustBandSchema).toBeInstanceOf(z.ZodType);
    expect(Canonical.intentSchema).toBeInstanceOf(z.ZodType);
    expect(Canonical.agentLifecycleStatusSchema).toBeInstanceOf(z.ZodType);
  });
});
