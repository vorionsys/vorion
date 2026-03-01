/**
 * Vorion ESLint Configuration
 *
 * Root ESLint config for the monorepo.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      // Downgrade common violations to warnings (pre-existing codebase)
      // These should be incrementally promoted to errors as code is cleaned up
      // Downgrade common violations to warnings (pre-existing codebase)
      // These should be incrementally promoted to errors as code is cleaned up
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-async-promise-executor': 'warn',
      'no-case-declarations': 'warn',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-control-regex': 'warn', // Security code uses intentional control char patterns
      'no-useless-escape': 'warn',
      'no-misleading-character-class': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-constant-binary-expression': 'warn',

      // Import direction rules
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // Contracts cannot import from other packages
            {
              target: './packages/contracts/src/**/*',
              from: './packages/!(contracts)/**/*',
              message: 'contracts cannot import from other packages - it is the foundation layer',
            },
            // Packages cannot import from apps
            {
              target: './packages/*/src/**/*',
              from: './apps/**/*',
              message: 'packages cannot import from apps - imports must flow: contracts ← packages ← apps',
            },
            // Apps cannot import from /src/ (legacy)
            {
              target: './apps/**/*',
              from: './src/**/*',
              message: '/src/ is deprecated - import from @vorionsys/platform-core instead',
            },
            // Packages cannot import from /src/ (legacy)
            {
              target: './packages/**/*',
              from: './src/**/*',
              message: '/src/ is deprecated - import from @vorionsys/platform-core instead',
            },
          ],
        },
      ],
      // Import order
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@vorionsys/contracts',
              group: 'internal',
              position: 'before',
            },
            {
              pattern: '@vorionsys/contracts/**',
              group: 'internal',
              position: 'before',
            },
            {
              pattern: '@vorionsys/**',
              group: 'internal',
              position: 'after',
            },
            {
              pattern: '@vorion/**',
              group: 'internal',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'src/**', // Legacy src directory
      'archive/**',
      'vendor/**',
      'drizzle/migrations/**',
      '**/*.generated.ts',
      '**/*.generated.js',
      '**/*.d.ts',
      'tests/fixtures/invalid/**',
      'packages/contracts/src/**/*.js', // Compiled output committed with source
    ],
  }
);
