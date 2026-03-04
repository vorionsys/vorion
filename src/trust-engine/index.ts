/**
 * Trust Engine Exports
 *
 * Re-exports trust engine functionality from the platform-core package.
 * This file exists to maintain backward compatibility with tests
 * that import from src/trust-engine/index.js.
 *
 * Note: Uses platform-core (not security) so that the vitest setup's
 * mock of src/common/metrics-registry.js is correctly intercepted,
 * preventing Prometheus metric double-registration errors.
 */

export * from '../../packages/platform-core/src/trust-engine/index.js';
