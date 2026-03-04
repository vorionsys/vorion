/**
 * Stryker Mutator configuration for Vorion monorepo.
 *
 * Targets tested packages with mutation testing:
 * - Security modules (Phases 1-7 hardening)
 * - platform-core (circuit breakers, provenance, expression engine)
 * - atsf-core (trust engine), council (presets), ai-gateway
 *
 * Note: contracts is excluded — it's mostly type definitions and
 * Drizzle schemas with minimal testable logic. platform-core types/
 * telemetry also excluded (0% coverage, infrastructure-only).
 *
 * Mutation score target: > 60% covered on security modules.
 * Run weekly in CI (expensive operation).
 *
 * Usage:
 *   npx stryker run                              # Run mutation tests
 */

export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress', 'json'],

  // Target tested security modules + core packages
  mutate: [
    // platform-core — tested subsystems only
    'packages/platform-core/src/common/adapters/**/*.ts',
    'packages/platform-core/src/common/contracts/**/*.ts',
    'packages/platform-core/src/common/expression/**/*.ts',
    'packages/platform-core/src/common/provenance/**/*.ts',
    'packages/platform-core/src/common/authorization.ts',
    'packages/platform-core/src/common/canonical-json.ts',
    'packages/platform-core/src/common/circuit-breaker.ts',
    'packages/platform-core/src/common/crypto.ts',
    'packages/platform-core/src/common/encryption.ts',
    'packages/platform-core/src/common/errors.ts',
    'packages/platform-core/src/common/group-membership.ts',
    'packages/platform-core/src/common/tenant-verification.ts',
    'packages/platform-core/src/common/trace.ts',
    'packages/platform-core/src/common/trust-cache.ts',

    // Phase 1: Service-to-service auth
    'packages/security/src/security/service-auth/**/*.ts',
    '!packages/security/src/security/service-auth/**/*.test.ts',

    // Phase 2: WebAuthn + MFA
    'packages/security/src/security/webauthn/**/*.ts',
    '!packages/security/src/security/webauthn/**/*.test.ts',
    'packages/security/src/security/mfa/**/*.ts',
    '!packages/security/src/security/mfa/**/*.test.ts',

    // Phase 3: Incident response executor + triggers
    'packages/security/src/security/incident/executor.ts',
    'packages/security/src/security/incident/triggers.ts',

    // Phase 6: Policy engine
    'packages/security/src/security/policy-engine/**/*.ts',
    '!packages/security/src/security/policy-engine/**/*.test.ts',

    // Phase 7: Cryptographic infrastructure
    'packages/security/src/security/encryption/**/*.ts',
    '!packages/security/src/security/encryption/**/*.test.ts',
    'packages/security/src/security/kms/local.ts',
    'packages/security/src/security/zkp/prover.ts',
    'packages/security/src/security/zkp/verifier.ts',
    'packages/security/src/security/dlp/scanner.ts',

    // Trust engine core (atsf-core)
    'packages/atsf-core/src/**/*.ts',
    '!packages/atsf-core/src/**/*.test.ts',
    '!packages/atsf-core/src/**/index.ts',

    // Council presets
    'packages/council/src/**/*.ts',
    '!packages/council/src/**/*.test.ts',
    '!packages/council/src/**/index.ts',

    // AI Gateway
    'packages/ai-gateway/src/**/*.ts',
    '!packages/ai-gateway/src/**/index.ts',
  ],

  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },

  // Mutation operators
  mutator: {
    excludedMutations: [
      'StringLiteral',      // Skip string mutations (too noisy)
    ],
  },

  // Performance tuning
  concurrency: 4,
  timeoutMS: 60000,
  timeoutFactor: 2.5,

  // Thresholds — fail CI if covered mutation score drops
  // Note: "total" includes no-coverage mutants (infrastructure code without tests).
  // The "covered" score (tests that touch the code) is the meaningful metric.
  // Current baselines (Feb 2026): security 70.49% covered, platform-core 53.42%
  thresholds: {
    high: 80,
    low: 60,
    break: null,  // Don't break CI — use covered score per-module for gating
  },

  // Incremental mode — only re-test changed files
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',

  // Ignore test infrastructure
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    '.next',
    'k6',
    'e2e',
    '.stryker-tmp',
  ],
};
