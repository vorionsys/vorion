import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'packages/*/src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/__tests__/**/*.{test,spec}.{ts,tsx}',
      'tests/unit/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', 'dist', '.turbo', '.next'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        '**/types.ts',
        '**/index.ts',
      ],
    },
    typecheck: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@vorionsys/shared-constants': path.resolve(__dirname, 'packages/shared-constants/src'),
      '@vorionsys/basis': path.resolve(__dirname, 'packages/basis/src'),
      '@vorionsys/contracts': path.resolve(__dirname, 'packages/contracts/src'),
      '@vorionsys/atsf-core': path.resolve(__dirname, 'packages/atsf-core/src'),
      '@vorionsys/cognigate': path.resolve(__dirname, 'packages/cognigate/src'),
      '@vorionsys/runtime': path.resolve(__dirname, 'packages/runtime/src'),
      '@vorionsys/proof-plane': path.resolve(__dirname, 'packages/proof-plane/src'),
      '@vorionsys/council': path.resolve(__dirname, 'packages/council/src'),
      '@vorionsys/ai-gateway': path.resolve(__dirname, 'packages/ai-gateway/src'),
      '@vorionsys/sdk': path.resolve(__dirname, 'packages/sdk/src'),
      '@vorionsys/car-client': path.resolve(__dirname, 'packages/car-client/src'),
      '@vorionsys/car-cli': path.resolve(__dirname, 'packages/car-cli/src'),
    },
  },
});
