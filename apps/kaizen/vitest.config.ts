import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx'],
      exclude: [
        'src/**/*.test.{ts,tsx}', 
        'src/lib/supabase-client.ts',
        'src/lib/lexicon-data.ts',
        'src/lib/quiz-data.ts',
        'src/lib/learning-paths.ts'
      ],
      thresholds: {
        lines: 5,
        statements: 5,
        branches: 1.5,
        functions: 5,
      },
    },
  },
});
