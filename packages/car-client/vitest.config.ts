import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pact contract tests excluded from default run — require @pact-foundation/pact and broker infrastructure
    exclude: ["tests/pact/**", "**/node_modules/**"],
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "json", "html"],
    include: ["src/**/*.ts"],
    exclude: ["test/**/*.test.ts", "tests/pact/**"],
    thresholds: {
      lines: 60,
      functions: 50,
      branches: 55,
      statements: 55,
    },
  },
});
