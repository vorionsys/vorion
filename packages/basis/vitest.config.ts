import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/trust-factors.test.ts'],
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts', 'src/trust-factors.test.ts'],
    thresholds: {
      lines: 90,
      functions: 70,
      branches: 85,
      statements: 90,
    },
  },
});
