/**
 * Unified Observability Metrics
 *
 * Prometheus-compatible metrics for Agent Anchor, A2A, and Sandbox subsystems.
 * Extends the existing intent metrics with governance-specific instrumentation.
 *
 * @packageDocumentation
 */

import { Registry, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'observability-metrics' });

// ============================================================================
// Registry
// ============================================================================

/**
 * Dedicated registry for Agent Anchor observability metrics
 */
export const anchorRegistry = new Registry();

// ============================================================================
// Agent Registry Metrics
// ============================================================================

/**
 * Total agents registered
 */
export const agentsRegisteredTotal = new Counter({
  name: 'anchor_agents_registered_total',
  help: 'Total number of agents registered',
  labelNames: ['tenant_id', 'domain', 'level'] as const,
  registers: [anchorRegistry],
});

/**
 * Current agent count by state
 */
export const agentsCurrentByState = new Gauge({
  name: 'anchor_agents_current',
  help: 'Current number of agents by state',
  labelNames: ['tenant_id', 'state'] as const,
  registers: [anchorRegistry],
});

/**
 * Agent state transitions
 */
export const agentStateTransitions = new Counter({
  name: 'anchor_agent_state_transitions_total',
  help: 'Total agent state transitions',
  labelNames: ['tenant_id', 'from_state', 'to_state', 'action'] as const,
  registers: [anchorRegistry],
});

/**
 * Agent registration latency
 */
export const agentRegistrationDuration = new Histogram({
  name: 'anchor_agent_registration_duration_seconds',
  help: 'Time to register an agent',
  labelNames: ['tenant_id'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [anchorRegistry],
});

// ============================================================================
// Trust Score Metrics
// ============================================================================

/**
 * Trust score computations
 */
export const trustScoreComputations = new Counter({
  name: 'anchor_trust_score_computations_total',
  help: 'Total trust score computations',
  labelNames: ['tenant_id', 'trigger'] as const, // trigger: request, attestation, decay
  registers: [anchorRegistry],
});

/**
 * Trust score computation latency
 */
export const trustScoreComputationDuration = new Histogram({
  name: 'anchor_trust_score_computation_duration_seconds',
  help: 'Time to compute trust score',
  labelNames: ['tenant_id'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [anchorRegistry],
});

/**
 * Trust score distribution
 */
export const trustScoreDistribution = new Histogram({
  name: 'anchor_trust_score_distribution',
  help: 'Distribution of trust scores',
  labelNames: ['tenant_id'] as const,
  buckets: [0, 100, 200, 350, 500, 650, 800, 876, 951, 1000],
  registers: [anchorRegistry],
});

/**
 * Current agents by tier
 */
export const agentsByTier = new Gauge({
  name: 'anchor_agents_by_tier',
  help: 'Current agent count by trust tier',
  labelNames: ['tenant_id', 'tier'] as const,
  registers: [anchorRegistry],
});

/**
 * Tier transitions
 */
export const tierTransitions = new Counter({
  name: 'anchor_tier_transitions_total',
  help: 'Total tier transitions',
  labelNames: ['tenant_id', 'from_tier', 'to_tier', 'direction'] as const, // direction: up, down
  registers: [anchorRegistry],
});

/**
 * Human approval requests
 */
export const humanApprovalRequests = new Counter({
  name: 'anchor_human_approval_requests_total',
  help: 'Total human approval requests for tier transitions',
  labelNames: ['tenant_id', 'target_tier', 'outcome'] as const, // outcome: approved, rejected, pending
  registers: [anchorRegistry],
});

// ============================================================================
// Attestation Metrics
// ============================================================================

/**
 * Attestations submitted
 */
export const attestationsSubmitted = new Counter({
  name: 'anchor_attestations_submitted_total',
  help: 'Total attestations submitted',
  labelNames: ['tenant_id', 'type', 'outcome'] as const,
  registers: [anchorRegistry],
});

/**
 * Attestation processing latency
 */
export const attestationProcessingDuration = new Histogram({
  name: 'anchor_attestation_processing_duration_seconds',
  help: 'Time to process an attestation',
  labelNames: ['tenant_id', 'type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [anchorRegistry],
});

/**
 * Attestation batch sizes
 */
export const attestationBatchSize = new Summary({
  name: 'anchor_attestation_batch_size',
  help: 'Size of attestation batches',
  labelNames: ['tenant_id'] as const,
  percentiles: [0.5, 0.9, 0.95, 0.99],
  registers: [anchorRegistry],
});

/**
 * Attestations pending flush
 */
export const attestationsPending = new Gauge({
  name: 'anchor_attestations_pending',
  help: 'Number of attestations pending flush',
  labelNames: ['type'] as const,
  registers: [anchorRegistry],
});

// ============================================================================
// A2A Communication Metrics
// ============================================================================

/**
 * A2A invocations
 */
export const a2aInvocationsTotal = new Counter({
  name: 'anchor_a2a_invocations_total',
  help: 'Total A2A invocations',
  labelNames: ['caller_tenant', 'callee_tenant', 'action', 'outcome'] as const,
  registers: [anchorRegistry],
});

/**
 * A2A invocation latency
 */
export const a2aInvocationDuration = new Histogram({
  name: 'anchor_a2a_invocation_duration_seconds',
  help: 'A2A invocation latency',
  labelNames: ['caller_tenant', 'action'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [anchorRegistry],
});

/**
 * A2A chain depth distribution
 */
export const a2aChainDepth = new Histogram({
  name: 'anchor_a2a_chain_depth',
  help: 'Distribution of A2A chain depths',
  labelNames: ['root_tenant'] as const,
  buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  registers: [anchorRegistry],
});

/**
 * A2A active chains
 */
export const a2aActiveChains = new Gauge({
  name: 'anchor_a2a_active_chains',
  help: 'Currently active A2A chains',
  registers: [anchorRegistry],
});

/**
 * A2A trust verification results
 */
export const a2aTrustVerifications = new Counter({
  name: 'anchor_a2a_trust_verifications_total',
  help: 'A2A trust verification results',
  labelNames: ['caller_tier', 'outcome'] as const, // outcome: passed, rejected
  registers: [anchorRegistry],
});

/**
 * A2A delegation usage
 */
export const a2aDelegationUsage = new Counter({
  name: 'anchor_a2a_delegation_usage_total',
  help: 'A2A delegation token usage',
  labelNames: ['delegator_tenant', 'delegate_tenant', 'outcome'] as const,
  registers: [anchorRegistry],
});

/**
 * A2A circuit breaker state changes
 */
export const a2aCircuitBreakerStateChanges = new Counter({
  name: 'anchor_a2a_circuit_breaker_state_changes_total',
  help: 'A2A circuit breaker state transitions',
  labelNames: ['target_aci', 'from_state', 'to_state'] as const,
  registers: [anchorRegistry],
});

/**
 * A2A registered endpoints
 */
export const a2aRegisteredEndpoints = new Gauge({
  name: 'anchor_a2a_registered_endpoints',
  help: 'Number of registered A2A endpoints',
  labelNames: ['status'] as const, // status: healthy, unhealthy, unknown
  registers: [anchorRegistry],
});

// ============================================================================
// Sandbox Metrics
// ============================================================================

/**
 * Sandbox containers created
 */
export const sandboxContainersCreated = new Counter({
  name: 'anchor_sandbox_containers_created_total',
  help: 'Total sandbox containers created',
  labelNames: ['tenant_id', 'tier', 'runtime'] as const,
  registers: [anchorRegistry],
});

/**
 * Sandbox containers active
 */
export const sandboxContainersActive = new Gauge({
  name: 'anchor_sandbox_containers_active',
  help: 'Currently active sandbox containers',
  labelNames: ['tier', 'runtime'] as const,
  registers: [anchorRegistry],
});

/**
 * Sandbox container lifecycle duration
 */
export const sandboxContainerDuration = new Histogram({
  name: 'anchor_sandbox_container_duration_seconds',
  help: 'Sandbox container lifetime',
  labelNames: ['tier', 'exit_reason'] as const, // exit_reason: completed, timeout, error, killed
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [anchorRegistry],
});

/**
 * Capability requests
 */
export const capabilityRequests = new Counter({
  name: 'anchor_capability_requests_total',
  help: 'Capability requests from agents',
  labelNames: ['tenant_id', 'capability_type', 'outcome'] as const, // outcome: granted, denied, escalated
  registers: [anchorRegistry],
});

/**
 * Network policy violations
 */
export const networkPolicyViolations = new Counter({
  name: 'anchor_network_policy_violations_total',
  help: 'Network policy violations in sandbox',
  labelNames: ['tenant_id', 'tier', 'violation_type'] as const,
  registers: [anchorRegistry],
});

/**
 * Filesystem policy violations
 */
export const filesystemPolicyViolations = new Counter({
  name: 'anchor_filesystem_policy_violations_total',
  help: 'Filesystem policy violations in sandbox',
  labelNames: ['tenant_id', 'tier', 'violation_type'] as const,
  registers: [anchorRegistry],
});

/**
 * Resource usage per sandbox
 */
export const sandboxResourceUsage = new Gauge({
  name: 'anchor_sandbox_resource_usage',
  help: 'Resource usage per sandbox',
  labelNames: ['container_id', 'resource_type'] as const, // resource_type: cpu_percent, memory_bytes, disk_bytes
  registers: [anchorRegistry],
});

// ============================================================================
// API Metrics
// ============================================================================

/**
 * API request count
 */
export const apiRequestsTotal = new Counter({
  name: 'anchor_api_requests_total',
  help: 'Total API requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [anchorRegistry],
});

/**
 * API request latency
 */
export const apiRequestDuration = new Histogram({
  name: 'anchor_api_request_duration_seconds',
  help: 'API request latency',
  labelNames: ['method', 'path'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [anchorRegistry],
});

/**
 * API errors
 */
export const apiErrors = new Counter({
  name: 'anchor_api_errors_total',
  help: 'API errors by type',
  labelNames: ['method', 'path', 'error_type'] as const,
  registers: [anchorRegistry],
});

// ============================================================================
// Database Replication Metrics
// ============================================================================

/**
 * PostgreSQL replication lag in bytes
 */
export const dbReplicationLagBytes = new Gauge({
  name: 'anchor_db_replication_lag_bytes',
  help: 'PostgreSQL replication lag in bytes',
  labelNames: ['cluster', 'replica_id', 'replica_host'] as const,
  registers: [anchorRegistry],
});

/**
 * PostgreSQL replication lag in seconds
 */
export const dbReplicationLagSeconds = new Gauge({
  name: 'anchor_db_replication_lag_seconds',
  help: 'PostgreSQL replication lag in seconds',
  labelNames: ['cluster', 'replica_id', 'replica_host'] as const,
  registers: [anchorRegistry],
});

/**
 * PostgreSQL replica status
 */
export const dbReplicaStatus = new Gauge({
  name: 'anchor_db_replica_status',
  help: 'PostgreSQL replica status (1=streaming, 0.75=catchup, 0.5=potential, 0.25=disconnected, 0=failed)',
  labelNames: ['cluster', 'replica_id', 'status'] as const,
  registers: [anchorRegistry],
});

/**
 * PostgreSQL cluster health
 */
export const dbClusterHealth = new Gauge({
  name: 'anchor_db_cluster_health',
  help: 'PostgreSQL cluster health (1=healthy, 0=unhealthy)',
  labelNames: ['cluster'] as const,
  registers: [anchorRegistry],
});

/**
 * Number of healthy PostgreSQL replicas
 */
export const dbHealthyReplicaCount = new Gauge({
  name: 'anchor_db_healthy_replica_count',
  help: 'Number of healthy PostgreSQL replicas',
  labelNames: ['cluster'] as const,
  registers: [anchorRegistry],
});

/**
 * PostgreSQL failover events
 */
export const dbFailoverEvents = new Counter({
  name: 'anchor_db_failover_events_total',
  help: 'Total PostgreSQL failover events',
  labelNames: ['cluster', 'reason', 'success'] as const,
  registers: [anchorRegistry],
});

/**
 * PostgreSQL health check duration
 */
export const dbHealthCheckDuration = new Histogram({
  name: 'anchor_db_health_check_duration_seconds',
  help: 'PostgreSQL health check duration',
  labelNames: ['cluster', 'node_id', 'role'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [anchorRegistry],
});

// ============================================================================
// Cache Metrics (A3I)
// ============================================================================

/**
 * A3I cache operations
 */
export const a3iCacheOperations = new Counter({
  name: 'anchor_a3i_cache_operations_total',
  help: 'A3I cache operations',
  labelNames: ['operation', 'result'] as const, // operation: get, set, delete; result: hit, miss, success, error
  registers: [anchorRegistry],
});

/**
 * A3I sync operations
 */
export const a3iSyncOperations = new Counter({
  name: 'anchor_a3i_sync_operations_total',
  help: 'A3I sync operations to Agent Anchor',
  labelNames: ['entity_type', 'result'] as const,
  registers: [anchorRegistry],
});

/**
 * A3I sync latency
 */
export const a3iSyncDuration = new Histogram({
  name: 'anchor_a3i_sync_duration_seconds',
  help: 'A3I sync latency',
  labelNames: ['entity_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [anchorRegistry],
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Record an agent registration
 */
export function recordAgentRegistration(
  tenantId: string,
  domains: string[],
  level: number,
  durationSeconds: number
): void {
  const domainLabel = domains.length > 0 ? domains[0] : 'none';
  agentsRegisteredTotal.inc({ tenant_id: tenantId, domain: domainLabel, level: String(level) });
  agentRegistrationDuration.observe({ tenant_id: tenantId }, durationSeconds);
}

/**
 * Record a trust score computation
 */
export function recordTrustScoreComputation(
  tenantId: string,
  trigger: 'request' | 'attestation' | 'decay',
  score: number,
  durationSeconds: number
): void {
  trustScoreComputations.inc({ tenant_id: tenantId, trigger });
  trustScoreComputationDuration.observe({ tenant_id: tenantId }, durationSeconds);
  trustScoreDistribution.observe({ tenant_id: tenantId }, score);
}

/**
 * Record an A2A invocation
 */
export function recordA2AInvocation(
  callerTenant: string,
  calleeTenant: string,
  action: string,
  outcome: 'success' | 'failure' | 'timeout' | 'rejected',
  durationSeconds: number,
  chainDepth: number
): void {
  a2aInvocationsTotal.inc({ caller_tenant: callerTenant, callee_tenant: calleeTenant, action, outcome });
  a2aInvocationDuration.observe({ caller_tenant: callerTenant, action }, durationSeconds);
  a2aChainDepth.observe({ root_tenant: callerTenant }, chainDepth);
}

/**
 * Record an attestation
 */
export function recordAttestation(
  tenantId: string,
  type: string,
  outcome: 'success' | 'failure',
  durationSeconds: number
): void {
  attestationsSubmitted.inc({ tenant_id: tenantId, type, outcome });
  attestationProcessingDuration.observe({ tenant_id: tenantId, type }, durationSeconds);
}

/**
 * Record a sandbox operation
 */
export function recordSandboxContainer(
  tenantId: string,
  tier: number,
  runtime: 'gvisor' | 'docker' | 'none',
  operation: 'created' | 'destroyed',
  durationSeconds?: number,
  exitReason?: 'completed' | 'timeout' | 'error' | 'killed'
): void {
  if (operation === 'created') {
    sandboxContainersCreated.inc({ tenant_id: tenantId, tier: String(tier), runtime });
    sandboxContainersActive.inc({ tier: String(tier), runtime });
  } else if (operation === 'destroyed' && durationSeconds !== undefined && exitReason) {
    sandboxContainersActive.dec({ tier: String(tier), runtime });
    sandboxContainerDuration.observe({ tier: String(tier), exit_reason: exitReason }, durationSeconds);
  }
}

/**
 * Record database replication lag metrics
 */
export function recordDbReplicationLag(
  cluster: string,
  replicaId: string,
  replicaHost: string,
  lagBytes: number,
  lagSeconds: number,
  status: 'streaming' | 'catchup' | 'potential' | 'disconnected' | 'failed' | 'unknown'
): void {
  dbReplicationLagBytes.set(
    { cluster, replica_id: replicaId, replica_host: replicaHost },
    lagBytes
  );
  dbReplicationLagSeconds.set(
    { cluster, replica_id: replicaId, replica_host: replicaHost },
    lagSeconds
  );

  // Map status to numeric value
  const statusValue = {
    streaming: 1,
    catchup: 0.75,
    potential: 0.5,
    disconnected: 0.25,
    failed: 0,
    unknown: 0,
  }[status];

  dbReplicaStatus.set({ cluster, replica_id: replicaId, status }, statusValue);
}

/**
 * Record database cluster health metrics
 */
export function recordDbClusterHealth(
  cluster: string,
  healthy: boolean,
  healthyReplicaCount: number
): void {
  dbClusterHealth.set({ cluster }, healthy ? 1 : 0);
  dbHealthyReplicaCount.set({ cluster }, healthyReplicaCount);
}

/**
 * Record database failover event
 */
export function recordDbFailover(
  cluster: string,
  reason: string,
  success: boolean
): void {
  dbFailoverEvents.inc({ cluster, reason, success: String(success) });
}

/**
 * Record database health check duration
 */
export function recordDbHealthCheck(
  cluster: string,
  nodeId: string,
  role: 'primary' | 'replica' | 'witness',
  durationSeconds: number
): void {
  dbHealthCheckDuration.observe({ cluster, node_id: nodeId, role }, durationSeconds);
}

/**
 * Get metrics output
 */
export async function getMetrics(): Promise<string> {
  return anchorRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return anchorRegistry.contentType;
}

logger.info('Observability metrics initialized');
