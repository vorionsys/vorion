/**
 * ESLint Import Direction Rules
 *
 * Enforces the Vorion import hierarchy:
 *   packages/contracts ← packages/* ← apps/*
 *
 * Usage in .eslintrc.js:
 *   module.exports = {
 *     extends: ['./configs/eslint/import-direction.js'],
 *   };
 */

module.exports = {
  plugins: ['import'],
  rules: {
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
            target: './apps/*/src/**/*',
            from: './src/**/*',
            message: '/src/ is deprecated - import from @vorionsys/platform-core instead',
          },
          {
            target: './apps/*/**/*',
            from: './src/**/*',
            message: '/src/ is deprecated - import from @vorionsys/platform-core instead',
          },
          // Packages cannot import from /src/ (legacy)
          {
            target: './packages/*/src/**/*',
            from: './src/**/*',
            message: '/src/ is deprecated - import from @vorionsys/platform-core instead',
          },
          // No cross-app imports
          {
            target: './apps/agentanchor/**/*',
            from: './apps/!(agentanchor)/**/*',
            message: 'Cannot import across apps - extract shared code to packages/',
          },
          {
            target: './apps/bai-cc-dashboard/**/*',
            from: './apps/!(bai-cc-dashboard)/**/*',
            message: 'Cannot import across apps - extract shared code to packages/',
          },
          {
            target: './apps/cognigate-api/**/*',
            from: './apps/!(cognigate-api)/**/*',
            message: 'Cannot import across apps - extract shared code to packages/',
          },
          {
            target: './apps/vorion-admin/**/*',
            from: './apps/!(vorion-admin)/**/*',
            message: 'Cannot import across apps - extract shared code to packages/',
          },
        ],
      },
    ],
    // Enforce import order
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
          // @vorionsys/contracts should come first among internal
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
          // Then other @vorionsys packages
          {
            pattern: '@vorionsys/**',
            group: 'internal',
            position: 'after',
          },
          // Then @vorion packages
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
    // No relative parent imports going too far up
    'import/no-relative-parent-imports': 'off', // Can enable for stricter rules
  },
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['./tsconfig.json', './packages/*/tsconfig.json', './apps/*/tsconfig.json'],
      },
    },
  },
};
