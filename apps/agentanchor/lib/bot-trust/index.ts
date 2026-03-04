/**
 * Bot Trust System - Main Entry Point
 *
 * @deprecated This module uses a FICO-style (300-1000) scoring system that is
 * deprecated in favor of the canonical ADR-002 8-tier T0-T7 system (0-1000 scale).
 *
 * For new code, use:
 * - `@/lib/trust/trust-engine-service` for trust scoring
 * - `@/lib/governance/trust-engine-bridge` for governance integration
 *
 * This module is retained for backwards compatibility with existing bot integrations.
 */

// Export all types
export * from './types';

// Export core modules
export { DecisionTracker, decisionTracker } from './decision-tracker';
export {
  ApprovalRateCalculator,
  approvalRateCalculator,
} from './approval-rate-calculator';
export { TrustScoreEngine, trustScoreEngine } from './trust-score-engine';
export { AutonomyManager, autonomyManager } from './autonomy-manager';
export { AuditLogger, auditLogger, AuditEventType } from './audit-logger';
export {
  TelemetryCollector,
  telemetryCollector,
} from './telemetry-collector';
