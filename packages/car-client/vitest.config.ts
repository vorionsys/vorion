import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', '**/*.test.ts'],
      thresholds: { lines: 50, functions: 50, branches: 50, statements: 50 },
    },
    // Pact contract tests excluded from default run — require @pact-foundation/pact and broker infrastructure
    exclude: ['tests/pact/**', '**/node_modules/**'],
  },
})
