/**
 * Observability Health Exports
 *
 * Re-exports health check functionality from the platform-core package.
 * This file exists to maintain backward compatibility with tests
 * that import from src/observability/health.js.
 */

export * from '../../packages/platform-core/src/observability/health.js';
