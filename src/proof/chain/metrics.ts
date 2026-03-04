/**
 * Chain Anchor Metrics
 *
 * Prometheus metrics for blockchain anchoring operations.
 * Provides observability for batching, transactions, and verification.
 *
 * @packageDocumentation
 */

import { Counter, Histogram, Gauge, Registry } from 'prom-client';

// =============================================================================
// METRICS REGISTRY
// =============================================================================

/**
 * Create metrics for chain anchor service
 */
export function createChainAnchorMetrics(registry?: Registry) {
  const reg = registry ?? new Registry();

  // ===========================================================================
  // BATCH METRICS
  // ===========================================================================

  const batchesCreated = new Counter({
    name: 'chain_anchor_batches_created_total',
    help: 'Total number of anchor batches created',
    labelNames: ['tenant_id', 'chain_id'] as const,
    registers: [reg],
  });

  const batchesAnchored = new Counter({
    name: 'chain_anchor_batches_anchored_total',
    help: 'Total number of batches successfully anchored',
    labelNames: ['tenant_id', 'chain_id'] as const,
    registers: [reg],
  });

  const batchesFailed = new Counter({
    name: 'chain_anchor_batches_failed_total',
    help: 'Total number of batch anchoring failures',
    labelNames: ['tenant_id', 'chain_id', 'error_type'] as const,
    registers: [reg],
  });

  const batchesExpired = new Counter({
    name: 'chain_anchor_batches_expired_total',
    help: 'Total number of expired batches',
    labelNames: ['tenant_id', 'chain_id'] as const,
    registers: [reg],
  });

  const batchSize = new Histogram({
    name: 'chain_anchor_batch_size',
    help: 'Distribution of batch sizes (number of proofs)',
    labelNames: ['tenant_id'] as const,
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [reg],
  });

  const batchProcessingDuration = new Histogram({
    name: 'chain_anchor_batch_processing_duration_seconds',
    help: 'Time taken to process a batch',
    labelNames: ['tenant_id', 'status'] as const,
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [reg],
  });

  const pendingBatches = new Gauge({
    name: 'chain_anchor_pending_batches',
    help: 'Number of batches pending anchoring',
    labelNames: ['tenant_id'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // TRANSACTION METRICS
  // ===========================================================================

  const transactionsSubmitted = new Counter({
    name: 'chain_anchor_transactions_submitted_total',
    help: 'Total number of transactions submitted',
    labelNames: ['network'] as const,
    registers: [reg],
  });

  const transactionsConfirmed = new Counter({
    name: 'chain_anchor_transactions_confirmed_total',
    help: 'Total number of transactions confirmed',
    labelNames: ['network'] as const,
    registers: [reg],
  });

  const transactionsFailed = new Counter({
    name: 'chain_anchor_transactions_failed_total',
    help: 'Total number of failed transactions',
    labelNames: ['network', 'error_type'] as const,
    registers: [reg],
  });

  const transactionConfirmationTime = new Histogram({
    name: 'chain_anchor_transaction_confirmation_seconds',
    help: 'Time from submission to confirmation',
    labelNames: ['network'] as const,
    buckets: [10, 30, 60, 120, 300, 600, 1800, 3600],
    registers: [reg],
  });

  const transactionGasUsed = new Histogram({
    name: 'chain_anchor_transaction_gas_used',
    help: 'Gas used by anchor transactions',
    labelNames: ['network'] as const,
    buckets: [21000, 50000, 100000, 200000, 500000, 1000000],
    registers: [reg],
  });

  const transactionCostWei = new Histogram({
    name: 'chain_anchor_transaction_cost_wei',
    help: 'Transaction cost in wei',
    labelNames: ['network'] as const,
    buckets: [1e14, 1e15, 1e16, 1e17, 1e18, 1e19],
    registers: [reg],
  });

  const pendingTransactions = new Gauge({
    name: 'chain_anchor_pending_transactions',
    help: 'Number of transactions pending confirmation',
    labelNames: ['network'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // MERKLE TREE METRICS
  // ===========================================================================

  const merkleTreeBuildDuration = new Histogram({
    name: 'chain_anchor_merkle_tree_build_duration_seconds',
    help: 'Time to build Merkle tree',
    labelNames: ['tenant_id'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [reg],
  });

  const merkleTreeDepth = new Histogram({
    name: 'chain_anchor_merkle_tree_depth',
    help: 'Depth of generated Merkle trees',
    labelNames: ['tenant_id'] as const,
    buckets: [4, 6, 8, 10, 12, 14, 16],
    registers: [reg],
  });

  const proofVerifications = new Counter({
    name: 'chain_anchor_proof_verifications_total',
    help: 'Total number of proof verifications',
    labelNames: ['result'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // AGENT ANCHOR METRICS
  // ===========================================================================

  const agentAnchorSubmissions = new Counter({
    name: 'chain_anchor_agent_anchor_submissions_total',
    help: 'Total submissions to AgentAnchor platform',
    labelNames: ['status'] as const,
    registers: [reg],
  });

  const agentAnchorLatency = new Histogram({
    name: 'chain_anchor_agent_anchor_latency_seconds',
    help: 'Latency of AgentAnchor API calls',
    labelNames: ['operation'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [reg],
  });

  const agentAnchorCertificates = new Counter({
    name: 'chain_anchor_certificates_issued_total',
    help: 'Total certificates issued by AgentAnchor',
    labelNames: ['tenant_id'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // PROVIDER METRICS
  // ===========================================================================

  const providerHealth = new Gauge({
    name: 'chain_anchor_provider_health',
    help: 'Provider health status (1=healthy, 0=unhealthy)',
    labelNames: ['network'] as const,
    registers: [reg],
  });

  const providerLatency = new Histogram({
    name: 'chain_anchor_provider_latency_seconds',
    help: 'RPC call latency',
    labelNames: ['network', 'method'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [reg],
  });

  const providerErrors = new Counter({
    name: 'chain_anchor_provider_errors_total',
    help: 'Total provider errors',
    labelNames: ['network', 'error_type'] as const,
    registers: [reg],
  });

  const circuitBreakerState = new Gauge({
    name: 'chain_anchor_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['network'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // SCHEDULER METRICS
  // ===========================================================================

  const schedulerJobDuration = new Histogram({
    name: 'chain_anchor_scheduler_job_duration_seconds',
    help: 'Duration of scheduled jobs',
    labelNames: ['job_name', 'status'] as const,
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    registers: [reg],
  });

  const schedulerJobsRun = new Counter({
    name: 'chain_anchor_scheduler_jobs_run_total',
    help: 'Total scheduled jobs run',
    labelNames: ['job_name', 'status'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // PROOF METRICS
  // ===========================================================================

  const proofsAnchored = new Counter({
    name: 'chain_anchor_proofs_anchored_total',
    help: 'Total number of proofs anchored',
    labelNames: ['tenant_id'] as const,
    registers: [reg],
  });

  const proofsVerified = new Counter({
    name: 'chain_anchor_proofs_verified_total',
    help: 'Total number of proofs verified',
    labelNames: ['tenant_id', 'result'] as const,
    registers: [reg],
  });

  return {
    // Batch metrics
    batchesCreated,
    batchesAnchored,
    batchesFailed,
    batchesExpired,
    batchSize,
    batchProcessingDuration,
    pendingBatches,

    // Transaction metrics
    transactionsSubmitted,
    transactionsConfirmed,
    transactionsFailed,
    transactionConfirmationTime,
    transactionGasUsed,
    transactionCostWei,
    pendingTransactions,

    // Merkle tree metrics
    merkleTreeBuildDuration,
    merkleTreeDepth,
    proofVerifications,

    // AgentAnchor metrics
    agentAnchorSubmissions,
    agentAnchorLatency,
    agentAnchorCertificates,

    // Provider metrics
    providerHealth,
    providerLatency,
    providerErrors,
    circuitBreakerState,

    // Scheduler metrics
    schedulerJobDuration,
    schedulerJobsRun,

    // Proof metrics
    proofsAnchored,
    proofsVerified,

    // Registry
    registry: reg,
  };
}

// =============================================================================
// SINGLETON METRICS INSTANCE
// =============================================================================

let metricsInstance: ReturnType<typeof createChainAnchorMetrics> | null = null;

/**
 * Get or create metrics instance
 */
export function getChainAnchorMetrics(
  registry?: Registry
): ReturnType<typeof createChainAnchorMetrics> {
  if (!metricsInstance) {
    metricsInstance = createChainAnchorMetrics(registry);
  }
  return metricsInstance;
}

/**
 * Reset metrics instance (for testing)
 */
export function resetChainAnchorMetrics(): void {
  metricsInstance = null;
}

// =============================================================================
// METRIC HELPERS
// =============================================================================

/**
 * Record batch creation
 */
export function recordBatchCreated(tenantId: string, chainId: string): void {
  const metrics = getChainAnchorMetrics();
  metrics.batchesCreated.inc({ tenant_id: tenantId, chain_id: chainId });
}

/**
 * Record batch anchored
 */
export function recordBatchAnchored(
  tenantId: string,
  chainId: string,
  proofCount: number,
  durationMs: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.batchesAnchored.inc({ tenant_id: tenantId, chain_id: chainId });
  metrics.batchSize.observe({ tenant_id: tenantId }, proofCount);
  metrics.batchProcessingDuration.observe(
    { tenant_id: tenantId, status: 'success' },
    durationMs / 1000
  );
  metrics.proofsAnchored.inc({ tenant_id: tenantId }, proofCount);
}

/**
 * Record batch failed
 */
export function recordBatchFailed(
  tenantId: string,
  chainId: string,
  errorType: string,
  durationMs: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.batchesFailed.inc({
    tenant_id: tenantId,
    chain_id: chainId,
    error_type: errorType,
  });
  metrics.batchProcessingDuration.observe(
    { tenant_id: tenantId, status: 'failed' },
    durationMs / 1000
  );
}

/**
 * Record transaction submitted
 */
export function recordTransactionSubmitted(network: string): void {
  const metrics = getChainAnchorMetrics();
  metrics.transactionsSubmitted.inc({ network });
}

/**
 * Record transaction confirmed
 */
export function recordTransactionConfirmed(
  network: string,
  confirmationTimeMs: number,
  gasUsed: number,
  costWei: bigint
): void {
  const metrics = getChainAnchorMetrics();
  metrics.transactionsConfirmed.inc({ network });
  metrics.transactionConfirmationTime.observe(
    { network },
    confirmationTimeMs / 1000
  );
  metrics.transactionGasUsed.observe({ network }, gasUsed);
  metrics.transactionCostWei.observe({ network }, Number(costWei));
}

/**
 * Record provider metrics
 */
export function recordProviderMetrics(
  network: string,
  healthy: boolean,
  latencyMs?: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.providerHealth.set({ network }, healthy ? 1 : 0);
  if (latencyMs !== undefined) {
    metrics.providerLatency.observe({ network, method: 'rpc_call' }, latencyMs / 1000);
  }
}

/**
 * Record circuit breaker state
 */
export function recordCircuitBreakerState(
  network: string,
  state: 'closed' | 'half-open' | 'open'
): void {
  const metrics = getChainAnchorMetrics();
  const stateValue = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
  metrics.circuitBreakerState.set({ network }, stateValue);
}

/**
 * Record AgentAnchor submission
 */
export function recordAgentAnchorSubmission(
  status: 'pending' | 'submitted' | 'verified' | 'rejected' | 'failed',
  latencyMs: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.agentAnchorSubmissions.inc({ status });
  metrics.agentAnchorLatency.observe({ operation: 'submit' }, latencyMs / 1000);
}

/**
 * Record Merkle tree metrics
 */
export function recordMerkleTreeBuilt(
  tenantId: string,
  depth: number,
  durationMs: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.merkleTreeDepth.observe({ tenant_id: tenantId }, depth);
  metrics.merkleTreeBuildDuration.observe(
    { tenant_id: tenantId },
    durationMs / 1000
  );
}

/**
 * Record proof verification
 */
export function recordProofVerification(result: 'valid' | 'invalid'): void {
  const metrics = getChainAnchorMetrics();
  metrics.proofVerifications.inc({ result });
}

/**
 * Record scheduler job
 */
export function recordSchedulerJob(
  jobName: string,
  status: 'success' | 'failure',
  durationMs: number
): void {
  const metrics = getChainAnchorMetrics();
  metrics.schedulerJobsRun.inc({ job_name: jobName, status });
  metrics.schedulerJobDuration.observe(
    { job_name: jobName, status },
    durationMs / 1000
  );
}
