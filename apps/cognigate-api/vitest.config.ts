import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'], // Entry point usually has lower coverage
      thresholds: {
        lines: 35,
        functions: 30,
        branches: 50,
        statements: 35,
      },
    },
  },
});
