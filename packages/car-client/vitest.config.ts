import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Pact contract tests excluded from default run — require @pact-foundation/pact and broker infrastructure
    exclude: ['tests/pact/**', '**/node_modules/**'],
  },
})
