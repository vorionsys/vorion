/**
 * Cognigate Metrics - Prometheus-compatible observability
 *
 * Provides comprehensive metrics for monitoring Cognigate execution gateway,
 * including resource usage, violations, terminations, and output validation.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/metrics
 */

import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../common/metrics-registry.js';

// =============================================================================
// Execution Metrics
// =============================================================================

/**
 * Total executions started
 */
export const executionsStartedTotal = new Counter({
  name: 'vorion_cognigate_executions_started_total',
  help: 'Total number of executions started',
  labelNames: ['tenant_id', 'intent_type'] as const,
  registers: [vorionRegistry],
});

/**
 * Total executions completed (success or failure)
 */
export const executionsCompletedTotal = new Counter({
  name: 'vorion_cognigate_executions_completed_total',
  help: 'Total number of executions completed',
  labelNames: ['tenant_id', 'intent_type', 'result'] as const, // result: success, failure, terminated
  registers: [vorionRegistry],
});

/**
 * Execution duration histogram
 */
export const executionDuration = new Histogram({
  name: 'vorion_cognigate_execution_duration_seconds',
  help: 'Execution duration in seconds',
  labelNames: ['tenant_id', 'intent_type', 'result'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [vorionRegistry],
});

/**
 * Currently active executions
 */
export const activeExecutions = new Gauge({
  name: 'vorion_cognigate_active_executions',
  help: 'Number of currently active executions',
  labelNames: ['tenant_id'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Resource Usage Metrics
// =============================================================================

/**
 * Peak memory usage histogram (MB)
 */
export const memoryPeakMb = new Histogram({
  name: 'vorion_cognigate_memory_peak_mb',
  help: 'Peak memory usage in MB',
  labelNames: ['tenant_id', 'intent_type'] as const,
  buckets: [16, 32, 64, 128, 256, 512, 1024, 2048, 4096],
  registers: [vorionRegistry],
});

/**
 * CPU time usage histogram (milliseconds)
 */
export const cpuTimeMs = new Histogram({
  name: 'vorion_cognigate_cpu_time_ms',
  help: 'CPU time usage in milliseconds',
  labelNames: ['tenant_id', 'intent_type'] as const,
  buckets: [10, 50, 100, 500, 1000, 5000, 10000, 30000, 60000],
  registers: [vorionRegistry],
});

/**
 * Network requests per execution histogram
 */
export const networkRequestsPerExecution = new Histogram({
  name: 'vorion_cognigate_network_requests',
  help: 'Number of network requests per execution',
  labelNames: ['tenant_id', 'intent_type'] as const,
  buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500],
  registers: [vorionRegistry],
});

/**
 * File system operations per execution histogram
 */
export const fileSystemOpsPerExecution = new Histogram({
  name: 'vorion_cognigate_filesystem_ops',
  help: 'Number of file system operations per execution',
  labelNames: ['tenant_id', 'intent_type'] as const,
  buckets: [0, 1, 5, 10, 25, 50, 100, 500, 1000],
  registers: [vorionRegistry],
});

// =============================================================================
// Resource Violation Metrics
// =============================================================================

/**
 * Resource limit violations total
 */
export const resourceViolationsTotal = new Counter({
  name: 'vorion_cognigate_resource_violations_total',
  help: 'Total number of resource limit violations',
  labelNames: ['tenant_id', 'violation_type'] as const, // memory_exceeded, cpu_exceeded, timeout_exceeded, network_limit_exceeded, filesystem_limit_exceeded
  registers: [vorionRegistry],
});

/**
 * Executions terminated due to resource limits
 */
export const terminationsTotal = new Counter({
  name: 'vorion_cognigate_terminations_total',
  help: 'Total number of executions terminated due to resource limits',
  labelNames: ['tenant_id', 'reason'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Output Validation Metrics
// =============================================================================

/**
 * Output validations total
 */
export const outputValidationsTotal = new Counter({
  name: 'vorion_cognigate_output_validations_total',
  help: 'Total number of output validations',
  labelNames: ['tenant_id', 'result', 'mode'] as const, // result: valid, invalid; mode: strict, permissive
  registers: [vorionRegistry],
});

/**
 * Output validation duration histogram
 */
export const outputValidationDuration = new Histogram({
  name: 'vorion_cognigate_output_validation_duration_ms',
  help: 'Output validation duration in milliseconds',
  labelNames: ['tenant_id'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [vorionRegistry],
});

/**
 * PII detections total
 */
export const piiDetectionsTotal = new Counter({
  name: 'vorion_cognigate_pii_detections_total',
  help: 'Total number of PII detections in output',
  labelNames: ['tenant_id', 'pii_type'] as const,
  registers: [vorionRegistry],
});

/**
 * Output sanitizations total
 */
export const outputSanitizationsTotal = new Counter({
  name: 'vorion_cognigate_output_sanitizations_total',
  help: 'Total number of outputs sanitized',
  labelNames: ['tenant_id'] as const,
  registers: [vorionRegistry],
});

/**
 * Prohibited patterns detected total
 */
export const prohibitedPatternsTotal = new Counter({
  name: 'vorion_cognigate_prohibited_patterns_total',
  help: 'Total number of prohibited patterns detected',
  labelNames: ['tenant_id', 'pattern_type', 'severity'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Record execution start
 */
export function recordExecutionStart(tenantId: string, intentType: string): void {
  executionsStartedTotal.inc({ tenant_id: tenantId, intent_type: intentType });
  activeExecutions.inc({ tenant_id: tenantId });
}

/**
 * Record execution completion
 */
export function recordExecutionComplete(
  tenantId: string,
  intentType: string,
  result: 'success' | 'failure' | 'terminated',
  durationSeconds: number
): void {
  executionsCompletedTotal.inc({ tenant_id: tenantId, intent_type: intentType, result });
  executionDuration.observe({ tenant_id: tenantId, intent_type: intentType, result }, durationSeconds);
  activeExecutions.dec({ tenant_id: tenantId });
}

/**
 * Record resource usage
 */
export function recordResourceUsage(
  tenantId: string,
  intentType: string,
  usage: {
    memoryPeakMb: number;
    cpuTimeMs: number;
    networkRequests: number;
    fileSystemOps: number;
  }
): void {
  memoryPeakMb.observe({ tenant_id: tenantId, intent_type: intentType }, usage.memoryPeakMb);
  cpuTimeMs.observe({ tenant_id: tenantId, intent_type: intentType }, usage.cpuTimeMs);
  networkRequestsPerExecution.observe({ tenant_id: tenantId, intent_type: intentType }, usage.networkRequests);
  fileSystemOpsPerExecution.observe({ tenant_id: tenantId, intent_type: intentType }, usage.fileSystemOps);
}

/**
 * Record resource violation
 */
export function recordResourceViolation(
  tenantId: string,
  violationType: 'memory_exceeded' | 'cpu_exceeded' | 'timeout_exceeded' | 'network_limit_exceeded' | 'filesystem_limit_exceeded'
): void {
  resourceViolationsTotal.inc({ tenant_id: tenantId, violation_type: violationType });
}

/**
 * Record execution termination
 */
export function recordTermination(tenantId: string, reason: string): void {
  terminationsTotal.inc({ tenant_id: tenantId, reason });
}

/**
 * Record output validation
 */
export function recordOutputValidation(
  tenantId: string,
  result: 'valid' | 'invalid',
  mode: 'strict' | 'permissive',
  durationMs: number
): void {
  outputValidationsTotal.inc({ tenant_id: tenantId, result, mode });
  outputValidationDuration.observe({ tenant_id: tenantId }, durationMs);
}

/**
 * Record PII detection
 */
export function recordPIIDetection(tenantId: string, piiType: string): void {
  piiDetectionsTotal.inc({ tenant_id: tenantId, pii_type: piiType });
}

/**
 * Record output sanitization
 */
export function recordOutputSanitization(tenantId: string): void {
  outputSanitizationsTotal.inc({ tenant_id: tenantId });
}

/**
 * Record prohibited pattern detection
 */
export function recordProhibitedPattern(
  tenantId: string,
  patternType: string,
  severity: 'low' | 'medium' | 'high' | 'critical'
): void {
  prohibitedPatternsTotal.inc({ tenant_id: tenantId, pattern_type: patternType, severity });
}
