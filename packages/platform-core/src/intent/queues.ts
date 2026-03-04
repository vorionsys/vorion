import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { SpanStatusCode } from '@opentelemetry/api';
import { secureRandomInt } from '../common/random.js';
import type { Intent, TrustLevel, ControlAction, Decision } from '../common/types.js';
import type { EvaluationResult } from '../basis/types.js';
import type { PolicyAction } from '../policy/types.js';
import { TrustEngine } from '../trust-engine/index.js';
import { RuleEvaluator } from '../basis/evaluator.js';
import { createEnforcementService } from '../enforce/index.js';
import { createLogger, createTracedLogger } from '../common/logger.js';
import { getRedis } from '../common/redis.js';
import { getConfig } from '../common/config.js';
import type { IIntentService } from './types.js';
import {
  getTraceContext,
  runWithTraceContext,
  createTraceContext,
  addTraceToJobData,
  extractTraceFromJobData,
  type TraceContext,
} from '../common/trace.js';
import {
  createSystemTenantContext,
  type TenantContext,
} from '../common/tenant-context.js';
import {
  recordJobResult,
  updateQueueGauges,
  dlqSize,
  recordPolicyEvaluation,
  recordPolicyOverride,
  recordCircuitBreakerStateChange,
  recordCircuitBreakerExecution,
  updateCircuitBreakerFailures,
} from './metrics.js';
import {
  getCircuitBreaker,
  type CircuitState,
} from '../common/circuit-breaker.js';
import {
  getPolicyLoader,
  createPolicyEvaluator,
  type MultiPolicyEvaluationResult,
  type PolicyEvaluationContext,
} from '../policy/index.js';
import {
  createAuditService,
  createAuditHelper,
  type AuditService,
} from '../audit/index.js';
import { createWebhookService } from './webhooks.js';
import {
  getCachedTrustScore,
  cacheTrustScore,
} from '../common/trust-cache.js';
import {
  tracePolicyEvaluate,
  recordPolicyEvaluationResult,
  getTracer,
} from './tracing.js';
import { createProofService } from '../proof/index.js';
import {
  CognigateGateway,
  createGateway,
  type ExecutionContext,
  type ExecutionResult,
} from '../cognigate/index.js';
import {
  getSemanticGovernanceIntegration,
  type IntentSemanticValidationResult,
  type SemanticSignal,
} from '../semantic-governance/index.js';

const logger = createLogger({ component: 'intent-queue' });

// Singleton Cognigate gateway instance
let cognigateGateway: CognigateGateway | null = null;

/**
 * Get or create the Cognigate gateway instance
 */
function getCognigateGateway(): CognigateGateway {
  if (!cognigateGateway) {
    const config = getConfig();
    cognigateGateway = createGateway({
      timeoutMs: config.cognigate.timeout,
      maxMemoryMb: config.cognigate.maxMemoryMb,
      maxCpuPercent: config.cognigate.maxCpuPercent,
    } as any);
    logger.info('Cognigate gateway initialized');
  }
  return cognigateGateway;
}

const queueNames = {
  intake: 'intent:intake',
  evaluate: 'intent:evaluate',
  decision: 'intent:decision',
  execute: 'intent:execute',
  deadLetter: 'intent:dead-letter',
};

/**
 * Get job options from config with jitter for backoff
 */
function getJobOptions(): JobsOptions {
  const config = getConfig();
  const baseDelay = config.intent.retryBackoffMs;
  // Add 0-25% jitter to prevent thundering herd
  const jitter = secureRandomInt(0, Math.floor(baseDelay * 0.25) + 1);

  return {
    attempts: config.intent.maxRetries,
    backoff: {
      type: 'exponential',
      delay: baseDelay + jitter,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: false, // Keep failed jobs for inspection
  };
}

// Redis connection pool for queue infrastructure
// Instead of duplicating connections per queue/worker, we reuse a pool of connections
const connectionPool: Map<string, ReturnType<typeof getRedis>> = new Map();
const MAX_POOL_CONNECTIONS = 10;
let connectionIndex = 0;

/**
 * Get a pooled Redis connection for queue infrastructure.
 * Reuses connections to prevent excessive connection proliferation.
 * BullMQ queues and workers can share connections safely.
 */
function connection(): ReturnType<typeof getRedis> {
  const poolKey = `queue-conn-${connectionIndex % MAX_POOL_CONNECTIONS}`;

  if (!connectionPool.has(poolKey)) {
    const conn = getRedis().duplicate();
    connectionPool.set(poolKey, conn);
    logger.debug({ poolKey, poolSize: connectionPool.size }, 'Created new pooled Redis connection');
  }

  connectionIndex++;
  return connectionPool.get(poolKey)!;
}

/**
 * Close all pooled connections during shutdown
 */
export async function closePooledConnections(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  const entries = Array.from(connectionPool.entries());
  for (let i = 0; i < entries.length; i++) {
    const [key, conn] = entries[i]!;
    closePromises.push(
      conn.quit()
        .then(() => {
          logger.debug({ key }, 'Closed pooled connection');
        })
        .catch((error) => {
          logger.warn({ key, error }, 'Error closing pooled connection');
        })
    );
  }
  await Promise.all(closePromises);
  connectionPool.clear();
  connectionIndex = 0;
  logger.info('All pooled Redis connections closed');
}

const trustEngine = new TrustEngine();
const policyLoader = getPolicyLoader();
const policyEvaluator = createPolicyEvaluator();
const ruleEvaluator = new RuleEvaluator();
const enforcementService = createEnforcementService({} as any);
const auditService = createAuditService();
const auditHelper = createAuditHelper(auditService);
const webhookService = createWebhookService();

// Policy evaluation circuit breaker - prevents cascading failures when policy engine is unhealthy
// Uses per-service circuit breaker configuration from the registry
const policyCircuitBreaker = getCircuitBreaker('policyEngine', (from: CircuitState, to: CircuitState) => {
  recordCircuitBreakerStateChange('policy-engine', from, to);
  logger.info(
    { circuitBreaker: 'policy-engine', from, to },
    'Policy circuit breaker state changed'
  );
});

/**
 * Action priority map - lower number = more restrictive
 */
const ACTION_PRIORITY: Record<ControlAction, number> = {
  deny: 1,
  escalate: 2,
  limit: 3,
  constrain: 4,
  monitor: 5,
  terminate: 6,
  allow: 7,
};

/**
 * Convert policy action interface to control action string
 */
function policyActionToControlAction(action: PolicyAction): ControlAction {
  return action.action;
}

/**
 * Determine the most restrictive action between rule and policy evaluations
 * Returns the more restrictive action (deny > escalate > limit > monitor > terminate > allow)
 */
function getMostRestrictiveAction(
  ruleAction: ControlAction,
  policyAction?: ControlAction | null
): ControlAction {
  if (!policyAction) {
    return ruleAction;
  }

  const rulePriority = ACTION_PRIORITY[ruleAction];
  const policyPriority = ACTION_PRIORITY[policyAction];

  // Return the action with lower priority number (more restrictive)
  return rulePriority <= policyPriority
    ? ruleAction
    : policyAction;
}

// Queue instances
export const intentIntakeQueue = new Queue(queueNames.intake, {
  connection: connection(),
  defaultJobOptions: getJobOptions(),
});

export const intentEvaluateQueue = new Queue(queueNames.evaluate, {
  connection: connection(),
  defaultJobOptions: getJobOptions(),
});

export const intentDecisionQueue = new Queue(queueNames.decision, {
  connection: connection(),
  defaultJobOptions: getJobOptions(),
});

export const intentExecuteQueue = new Queue(queueNames.execute, {
  connection: connection(),
  defaultJobOptions: getJobOptions(),
});

export const deadLetterQueue = new Queue(queueNames.deadLetter, {
  connection: connection(),
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// Queue event listeners for monitoring
const queueEvents: QueueEvents[] = [];

[queueNames.intake, queueNames.evaluate, queueNames.decision, queueNames.execute].forEach((name) => {
  const events = new QueueEvents(name, { connection: connection() });
  queueEvents.push(events);

  events.on('failed', ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
    logger.error({ queue: name, jobId, failedReason }, 'Job failed');
  });

  events.on('stalled', ({ jobId }: { jobId: string }) => {
    logger.warn({ queue: name, jobId }, 'Job stalled');
  });
});

// Worker instances for graceful shutdown
const workers: Worker[] = [];
let workersStarted = false;
let intentService: IIntentService | null = null;
let isShuttingDown = false;

/**
 * Move a failed job to the dead letter queue after max retries
 */
async function moveToDeadLetterQueue(
  job: Job,
  error: Error,
  stage: string
): Promise<void> {
  try {
    await deadLetterQueue.add('failed-intent', {
      originalQueue: stage,
      jobId: job.id,
      jobData: job.data,
      error: {
        message: error.message,
        stack: error.stack,
      },
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    });
    logger.info(
      { jobId: job.id, stage },
      'Moved failed job to dead letter queue'
    );
  } catch (dlqError) {
    logger.error(
      { jobId: job.id, stage, error: dlqError },
      'Failed to move job to dead letter queue'
    );
  }
}

/**
 * Update intent status to failed when job exhausts retries
 */
async function markIntentFailed(
  intentId: string,
  tenantId: string,
  error: Error
): Promise<void> {
  if (!intentService) return;
  // Create system context for background job processing
  const ctx = createSystemTenantContext(tenantId, { userId: 'system:intent-queue-worker' });
  try {
    await intentService.updateStatus(ctx, intentId, 'failed');
    await intentService.recordEvaluation(ctx, intentId, {
      stage: 'error',
      error: {
        message: error.message,
        timestamp: new Date().toISOString(),
      },
    });

    // Record failed intent audit event
    await auditHelper.recordIntentEvent(
      tenantId,
      'intent.failed',
      intentId,
      { type: 'service', id: 'intent-queue' },
      {
        outcome: 'failure',
        reason: error.message,
        stateChange: {
          after: { status: 'failed' },
        },
        metadata: {
          errorStack: error.stack,
        },
      }
    );
  } catch (updateError) {
    logger.error(
      { intentId, error: updateError },
      'Failed to mark intent as failed'
    );
  }
}

export async function enqueueIntentSubmission(
  intent: Intent,
  options?: { namespace?: string; traceContext?: TraceContext }
): Promise<void> {
  // Get current trace context or create new one
  const traceContext = options?.traceContext ?? getTraceContext() ?? createTraceContext();

  const jobData = addTraceToJobData({
    intentId: intent.id,
    tenantId: intent.tenantId,
    namespace: options?.namespace,
  }, traceContext);

  await intentIntakeQueue.add('intent.submitted', jobData);

  logger.debug(
    { intentId: intent.id, traceId: traceContext.traceId },
    'Intent enqueued for processing'
  );
}

export function registerIntentWorkers(service: IIntentService): void {
  if (workersStarted) return;
  workersStarted = true;
  intentService = service;

  const config = getConfig();
  const concurrency = config.intent.queueConcurrency;
  const lockDuration = config.intent.jobTimeoutMs;

  // Intake Worker
  const intakeWorker = new Worker(
    queueNames.intake,
    async (job: Job) => {
      const startTime = Date.now();
      if (!intentService || isShuttingDown) return;

      // Extract trace context from job data or create new one
      const traceContext = extractTraceFromJobData(job.data) ?? createTraceContext();

      // Run the job within the trace context
      return runWithTraceContext(traceContext, async () => {
        const { intentId, tenantId, namespace } = job.data as {
          intentId: string;
          tenantId: string;
          namespace?: string;
        };

        // Create system context for background job processing
        const ctx = createSystemTenantContext(tenantId, { userId: 'system:intake-worker' });

        const jobLogger = createTracedLogger(
          { component: 'intake-worker', jobId: job.id },
          traceContext.traceId,
          traceContext.spanId
        );

        try {
          const intent = await intentService!.get(ctx, intentId);
          if (!intent) {
            jobLogger.warn({ intentId }, 'Intent no longer exists');
            return;
          }

          // Check cache first, then fall back to trust engine
          let trustRecord = await getCachedTrustScore(intent.entityId, tenantId);
          if (!trustRecord) {
            // Cache miss - fetch from trust engine
            trustRecord = await trustEngine.getScore(intent.entityId, ctx) ?? null;
            // Cache the result for future lookups
            if (trustRecord) {
              await cacheTrustScore(intent.entityId, tenantId, trustRecord);
            }
          }
          const trustSnapshot = trustRecord
            ? {
                score: trustRecord.score,
                level: trustRecord.level,
                components: trustRecord.components,
              }
            : null;

          await intentService!.updateTrustMetadata(
            ctx,
            intent.id,
            trustSnapshot,
            trustRecord?.level,
            trustRecord?.score
          );

          await intentService!.updateStatus(ctx, intent.id, 'evaluating', 'pending');
          await intentService!.recordEvaluation(ctx, intent.id, {
            stage: 'trust-snapshot',
            result: trustSnapshot,
          });

          // Record audit event for intent submission
          await auditHelper.recordIntentEvent(
            tenantId,
            'intent.submitted',
            intentId,
            { type: 'agent', id: intent.entityId, name: intent.metadata['agentName'] as string },
            {
              outcome: 'success',
              metadata: {
                intentType: intent.intentType,
                goal: intent.goal,
                trustScore: trustRecord?.score,
                trustLevel: trustRecord?.level,
                namespace,
              },
            }
          ).catch((auditError) => {
            jobLogger.warn({ error: auditError }, 'Failed to record intake audit event');
          });

          // Propagate trace context to next queue
          const nextJobData = addTraceToJobData({
            intentId: intent.id,
            tenantId: intent.tenantId,
            namespace,
          }, traceContext);

          await intentEvaluateQueue.add('intent.evaluate', nextJobData);

          recordJobResult('intake', 'success', (Date.now() - startTime) / 1000);
        } catch (error) {
          recordJobResult('intake', 'failure', (Date.now() - startTime) / 1000);
          throw error;
        }
      });
    },
    {
      connection: connection(),
      concurrency,
      lockDuration,
      stalledInterval: lockDuration + 5000,
    }
  );

  intakeWorker.on('failed', async (job: Job | undefined, error: Error) => {
    if (!job) return;
    const { intentId, tenantId } = job.data as { intentId: string; tenantId: string };
    logger.error({ jobId: job.id, intentId, error: error.message }, 'Intent intake job failed');

    // Move to DLQ after final retry
    if (job.attemptsMade >= config.intent.maxRetries) {
      await moveToDeadLetterQueue(job, error, 'intake');
      await markIntentFailed(intentId, tenantId, error);
    }
  });

  workers.push(intakeWorker);

  // Evaluate Worker
  const evaluateWorker = new Worker(
    queueNames.evaluate,
    async (job) => {
      const startTime = Date.now();
      if (!intentService || isShuttingDown) return;
      const { intentId, tenantId, namespace } = job.data as {
        intentId: string;
        tenantId: string;
        namespace?: string;
      };

      // Create system context for background job processing
      const ctx = createSystemTenantContext(tenantId, { userId: 'system:evaluate-worker' });

      try {
        const intent = await intentService.get(ctx, intentId);
        if (!intent) {
          logger.warn({ intentId }, 'Intent no longer exists');
          return;
        }

        // Record evaluation started audit event
        auditHelper.recordIntentEvent(
          tenantId,
          'intent.evaluation.started',
          intentId,
          { type: 'service', id: 'intent-queue' },
          {
            outcome: 'success',
            metadata: {
              intentType: intent.intentType,
              namespace,
            },
          }
        ).catch((auditError) => {
          logger.warn({ error: auditError }, 'Failed to record evaluation started audit event');
        });

        // Build evaluation context (shared by rule and policy evaluators)
        const evaluationContext = {
          intent: {
            id: intent.id,
            type: intent.intentType ?? 'generic',
            goal: intent.goal,
            context: intent.context,
          },
          entity: {
            id: intent.entityId,
            type: (intent.metadata['entityType'] as string) ?? 'agent',
            trustScore: intent.trustScore ?? 0,
            trustLevel: (intent.trustLevel ?? 0) as TrustLevel,
            attributes: intent.metadata,
          },
          environment: {
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            requestId: randomUUID(),
          },
          custom: {
            namespace: namespace ?? config.intent.defaultNamespace,
          },
        };

        // PARALLEL EVALUATION: Run rule and policy evaluation concurrently
        // This roughly halves evaluation latency by running both evaluations at the same time
        const policyNamespace = namespace ?? config.intent.defaultNamespace;
        const ruleEvalStartTime = Date.now();
        const policyEvalStartTime = Date.now();

        // Build policy evaluation context (slightly different structure than rule context)
        const policyContext: PolicyEvaluationContext = {
          intent: {
            ...intent,
            intentType: intent.intentType ?? 'generic',
          },
          entity: {
            id: intent.entityId,
            type: (intent.metadata['entityType'] as string) ?? 'agent',
            trustScore: intent.trustScore ?? 0,
            trustLevel: (intent.trustLevel ?? 0) as TrustLevel,
            attributes: intent.metadata as Record<string, unknown>,
          },
          environment: {
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            requestId: randomUUID(),
          },
        };

        // Run rule evaluation, policy evaluation, and semantic governance in parallel
        const semanticGovernance = getSemanticGovernanceIntegration();
        const [evaluation, policyResult, semanticResult] = await Promise.all([
          // Rule-based evaluation (existing system)
          ruleEvaluator.evaluate(evaluationContext).then((result) => {
            const ruleEvalDuration = Date.now() - ruleEvalStartTime;
            logger.debug(
              {
                intentId: intent.id,
                rulesEvaluated: result.rulesEvaluated.length,
                passed: result.passed,
                finalAction: result.finalAction,
                durationMs: ruleEvalDuration,
              },
              'Rule evaluation completed'
            );
            return result;
          }),

          // Policy-based evaluation (new policy engine) with circuit breaker and tracing
          // Circuit breaker prevents cascading failures when policy engine is unhealthy
          (async (): Promise<{ evaluation: MultiPolicyEvaluationResult | null; error?: Error; circuitOpen?: boolean }> => {
            // Check if circuit is open - if so, skip policy evaluation immediately
            const isCircuitOpen = await policyCircuitBreaker.isOpen();
            if (isCircuitOpen) {
              recordCircuitBreakerExecution('policy-engine', 'rejected');
              logger.warn(
                { intentId: intent.id, circuitState: 'OPEN' },
                'Policy circuit breaker is OPEN, skipping policy evaluation and using rules only'
              );
              return { evaluation: null, circuitOpen: true };
            }

            return tracePolicyEvaluate(
              intent.id,
              intent.tenantId,
              policyNamespace,
              async (span): Promise<{ evaluation: MultiPolicyEvaluationResult | null; error?: Error; circuitOpen?: boolean }> => {
                // Execute policy evaluation through circuit breaker
                const circuitResult = await policyCircuitBreaker.execute(async () => {
                  const policies = await policyLoader.getPolicies(
                    intent.tenantId,
                    policyNamespace
                  );

                  if (policies.length === 0) {
                    recordPolicyEvaluationResult(span, 0, 0, 'none');
                    return null;
                  }

                  const policyEvaluation = await policyEvaluator.evaluateMultiple(policies, policyContext);

                  // Record policy evaluation metrics
                  const policyEvalDuration = (Date.now() - policyEvalStartTime) / 1000;
                  const matchedCount = policyEvaluation.policiesEvaluated.filter(
                    (p) => p.matchedRules.length > 0
                  ).length;
                  const policyResultType = policyEvaluation.finalAction === 'allow'
                    ? 'allow'
                    : policyEvaluation.finalAction === 'deny'
                      ? 'deny'
                      : 'escalate';

                  // Record span attributes for policy evaluation
                  recordPolicyEvaluationResult(
                    span,
                    policyEvaluation.policiesEvaluated.length,
                    matchedCount,
                    policyResultType
                  );

                  recordPolicyEvaluation(
                    intent.tenantId,
                    policyNamespace,
                    policyResultType,
                    policyEvalDuration,
                    matchedCount
                  );

                  logger.debug(
                    {
                      intentId: intent.id,
                      policiesEvaluated: policyEvaluation.policiesEvaluated.length,
                      finalAction: policyEvaluation.finalAction,
                      durationMs: Date.now() - policyEvalStartTime,
                    },
                    'Policy evaluation completed'
                  );

                  return policyEvaluation;
                });

                // Handle circuit breaker result
                if (circuitResult.success) {
                  recordCircuitBreakerExecution('policy-engine', 'success');
                  return { evaluation: circuitResult.result ?? null };
                } else if (circuitResult.circuitOpen) {
                  // Circuit opened during execution (shouldn't happen as we check above)
                  recordCircuitBreakerExecution('policy-engine', 'rejected');
                  logger.warn(
                    { intentId: intent.id },
                    'Policy circuit breaker opened during evaluation, continuing with rules only'
                  );
                  return { evaluation: null, circuitOpen: true };
                } else {
                  // Execution failed - circuit breaker already recorded the failure
                  recordCircuitBreakerExecution('policy-engine', 'failure');
                  logger.warn(
                    { intentId: intent.id, error: circuitResult.error },
                    'Policy evaluation failed (circuit breaker tracked), continuing with rules only'
                  );
                  return { evaluation: null, error: circuitResult.error };
                }
              }
            );
          })(),

          // Semantic governance validation (Layer 5 - confused deputy protection)
          // Runs in parallel with rule and policy evaluation
          (async (): Promise<IntentSemanticValidationResult> => {
            if (!semanticGovernance.isEnabled()) {
              return { valid: true, signals: [], durationMs: 0 };
            }

            const semanticStartTime = Date.now();
            try {
              const result = await semanticGovernance.validateIntent({
                intentId: intent.id,
                tenantId: intent.tenantId,
                entityId: intent.entityId,
                intentType: intent.intentType ?? undefined,
                goal: intent.goal,
                context: intent.context ?? undefined,
                trustScore: intent.trustScore ?? undefined,
                trustLevel: intent.trustLevel ?? undefined,
                messageSource: 'intent-submission',
                authenticated: true,
              });

              logger.debug(
                {
                  intentId: intent.id,
                  valid: result.valid,
                  signalsCount: result.signals.length,
                  durationMs: result.durationMs,
                },
                'Semantic governance validation completed'
              );

              return result;
            } catch (error) {
              logger.warn(
                { intentId: intent.id, error },
                'Semantic governance validation error (non-blocking)'
              );
              return {
                valid: true,
                signals: [{
                  type: 'semantic.validation.error',
                  value: -0.05,
                  weight: 0.5,
                  severity: 'medium',
                  source: 'semantic-governance',
                  metadata: { error: error instanceof Error ? error.message : String(error) },
                }],
                durationMs: Date.now() - semanticStartTime,
                warnings: [`Semantic validation error: ${error instanceof Error ? error.message : 'Unknown error'}`],
              };
            }
          })(),
        ]);

        // Extract policy evaluation result (may be null if no policies or error)
        const policyEvaluation = policyResult.evaluation;

        // Log parallel evaluation timing metrics
        const totalEvalDuration = Date.now() - ruleEvalStartTime;
        logger.debug(
          {
            intentId: intent.id,
            totalDurationMs: totalEvalDuration,
            parallelExecution: true,
            semanticValid: semanticResult.valid,
            semanticSignals: semanticResult.signals.length,
          },
          'Parallel evaluation completed'
        );

        // Record semantic signals for trust engine using batch processing
        if (semanticResult.signals.length > 0) {
          const timestamp = new Date().toISOString();
          const signalPromises = semanticResult.signals.map((signal) =>
            trustEngine.recordSignal({
              id: randomUUID(),
              entityId: intent.entityId,
              type: signal.type,
              value: signal.value,
              weight: signal.weight,
              source: signal.source,
              timestamp,
              metadata: signal.metadata,
            }, ctx).catch((error) => {
              // Log individual signal failures without blocking other signals
              logger.warn(
                { error, signalType: signal.type, entityId: intent.entityId },
                'Failed to record semantic signal'
              );
              return null; // Return null to indicate failure without throwing
            })
          );
          await Promise.all(signalPromises);
        }

        await intentService.recordEvaluation(ctx, intent.id, {
          stage: 'basis',
          evaluation,
          namespace: namespace ?? config.intent.defaultNamespace,
        });

        // Record semantic governance evaluation
        await intentService.recordEvaluation(ctx, intent.id, {
          stage: 'semantic-governance' as any,
          result: {
            valid: semanticResult.valid,
            reason: semanticResult.reason,
            signalsEmitted: semanticResult.signals.length,
            durationMs: semanticResult.durationMs,
            warnings: semanticResult.warnings,
          },
        });

        // Record evaluation completed audit event
        auditHelper.recordIntentEvent(
          tenantId,
          'intent.evaluation.completed',
          intentId,
          { type: 'service', id: 'intent-queue' },
          {
            outcome: 'success',
            metadata: {
              rulesPassed: evaluation.passed,
              rulesAction: evaluation.finalAction,
              rulesEvaluated: evaluation.rulesEvaluated.length,
              policyAction: policyEvaluation?.finalAction,
              policiesEvaluated: policyEvaluation?.policiesEvaluated.length ?? 0,
              semanticValid: semanticResult.valid,
              semanticSignals: semanticResult.signals.length,
              namespace,
            },
          }
        ).catch((auditError) => {
          logger.warn({ error: auditError }, 'Failed to record evaluation completed audit event');
        });

        await intentDecisionQueue.add('intent.decision', {
          intentId: intent.id,
          tenantId: intent.tenantId,
          evaluation,
          policyEvaluation,
          semanticValidation: {
            valid: semanticResult.valid,
            reason: semanticResult.reason,
            signals: semanticResult.signals,
            warnings: semanticResult.warnings,
          },
        });

        recordJobResult('evaluate', 'success', (Date.now() - startTime) / 1000);
      } catch (error) {
        recordJobResult('evaluate', 'failure', (Date.now() - startTime) / 1000);
        throw error;
      }
    },
    {
      connection: connection(),
      concurrency,
      lockDuration,
      stalledInterval: lockDuration + 5000,
    }
  );

  evaluateWorker.on('failed', async (job, error) => {
    if (!job) return;
    const { intentId, tenantId } = job.data as { intentId: string; tenantId: string };
    logger.error({ jobId: job.id, intentId, error: error.message }, 'Intent evaluation job failed');

    if (job.attemptsMade >= config.intent.maxRetries) {
      await moveToDeadLetterQueue(job, error, 'evaluate');
      await markIntentFailed(intentId, tenantId, error);
    }
  });

  workers.push(evaluateWorker);

  // Decision Worker
  const decisionWorker = new Worker(
    queueNames.decision,
    async (job) => {
      const startTime = Date.now();
      if (!intentService || isShuttingDown) return;
      const { intentId, tenantId, evaluation, policyEvaluation, semanticValidation } = job.data as {
        intentId: string;
        tenantId: string;
        evaluation: EvaluationResult;
        policyEvaluation?: MultiPolicyEvaluationResult | null;
        semanticValidation?: {
          valid: boolean;
          reason?: string;
          signals: SemanticSignal[];
          warnings?: string[];
        };
      };

      // Create system context for background job processing
      const ctx = createSystemTenantContext(tenantId, { userId: 'system:decision-worker' });

      try {
        const intent = await intentService.get(ctx, intentId);
        if (!intent) {
          logger.warn({ intentId }, 'Intent no longer exists');
          return;
        }

        // Re-validate trust at decision stage if configured
        if (config.intent.revalidateTrustAtDecision) {
          const currentTrust = await trustEngine.getScore(intent.entityId, ctx);
          const currentLevel = currentTrust?.level ?? 0;
          const requiredLevel = intentService.getRequiredTrustLevel(intent.intentType);

          // Record the trust gate check
          await intentService.recordEvaluation(ctx, intent.id, {
            stage: 'trust-gate',
            passed: currentLevel >= requiredLevel,
            requiredLevel,
            actualLevel: currentLevel,
          });

          if (currentLevel < requiredLevel) {
            logger.warn(
              { intentId, requiredLevel, currentLevel },
              'Trust level degraded below requirement at decision stage'
            );
            await intentService.updateStatus(ctx, intent.id, 'denied', 'evaluating');
            recordJobResult('decision', 'success', (Date.now() - startTime) / 1000);
            return;
          }

          // Update trust metadata if changed
          if (currentTrust && currentTrust.level !== intent.trustLevel) {
            await intentService.updateTrustMetadata(
              ctx,
              intent.id,
              {
                score: currentTrust.score,
                level: currentTrust.level,
                components: currentTrust.components,
                revalidatedAt: new Date().toISOString(),
              },
              currentTrust.level,
              currentTrust.score
            );
          }
        }

        // Get rule-based enforcement decision
        const ruleDecision = await enforcementService.decide({
          intent,
          evaluation,
          tenantId: intent.tenantId,
          trustScore: intent.trustScore ?? 0,
          trustLevel: (intent.trustLevel ?? 0) as TrustLevel,
        });

        // Determine final action considering policy evaluation and semantic governance
        let finalAction: ControlAction = ruleDecision.action;
        let policyOverride = false;
        let semanticOverride = false;

        // First check semantic governance - if it failed, deny
        if (semanticValidation && !semanticValidation.valid) {
          finalAction = 'deny';
          semanticOverride = true;
          logger.warn(
            {
              intentId: intent.id,
              ruleAction: ruleDecision.action,
              semanticReason: semanticValidation.reason,
              finalAction,
            },
            'Semantic governance validation failed - denying intent'
          );
        } else if (policyEvaluation && policyEvaluation.finalAction) {
          const combinedAction = getMostRestrictiveAction(
            ruleDecision.action,
            policyEvaluation.finalAction
          );

          if (combinedAction !== ruleDecision.action) {
            policyOverride = true;
            finalAction = combinedAction;

            // Record policy override metric
            recordPolicyOverride(
              intent.tenantId,
              ruleDecision.action,
              policyEvaluation.finalAction
            );

            logger.info(
              {
                intentId: intent.id,
                ruleAction: ruleDecision.action,
                policyAction: policyEvaluation.finalAction,
                finalAction,
              },
              'Policy evaluation overrode rule decision'
            );
          }
        }

        // Record rule, policy, and semantic evaluations
        await intentService.recordEvaluation(ctx, intent.id, {
          stage: 'decision',
          decision: {
            ruleDecision: {
              action: ruleDecision.action,
              constraintsEvaluated: ruleDecision.constraintsEvaluated,
            },
            policyDecision: policyEvaluation
              ? {
                  action: policyEvaluation.finalAction,
                  reason: policyEvaluation.reason,
                  policiesEvaluated: policyEvaluation.policiesEvaluated.length,
                  matchedPolicies: policyEvaluation.policiesEvaluated
                    .filter((p) => p.matchedRules.length > 0)
                    .map((p) => ({ policyId: p.policyId, action: p.action, reason: p.reason })),
                }
              : null,
            semanticDecision: semanticValidation
              ? {
                  valid: semanticValidation.valid,
                  reason: semanticValidation.reason,
                  signalsCount: semanticValidation.signals.length,
                  warnings: semanticValidation.warnings,
                }
              : null,
            finalAction,
            policyOverride,
            semanticOverride,
          },
        });

        const nextStatus =
          finalAction === 'allow'
            ? 'approved'
            : finalAction === 'deny'
              ? 'denied'
              : finalAction === 'escalate'
                ? 'escalated'
                : 'pending';

        await intentService.updateStatus(ctx, intent.id, nextStatus, 'evaluating');

        // Trigger webhook notifications for approved/denied statuses (fire and forget)
        if (nextStatus === 'approved') {
          webhookService.notifyIntent('intent.approved', intentId, tenantId, { finalAction, policyOverride, semanticOverride }).catch((error) => {
            logger.warn({ error, intentId }, 'Failed to send webhook notification');
          });

          // Enqueue for execution
          await intentExecuteQueue.add('intent.execute', {
            intentId: intent.id,
            tenantId: intent.tenantId,
            decision: ruleDecision,
          });
        } else if (nextStatus === 'denied') {
          // Determine reason - semantic override takes precedence
          const reason = semanticOverride
            ? semanticValidation?.reason ?? 'Denied by semantic governance'
            : policyEvaluation?.reason ?? 'Denied by policy';
          webhookService.notifyIntent('intent.denied', intentId, tenantId, { finalAction, reason, semanticOverride }).catch((error) => {
            logger.warn({ error, intentId }, 'Failed to send webhook notification');
          });
        }
        // Note: 'escalated' status webhook is handled by escalation creation elsewhere

        // Determine the audit event type based on final action
        const auditEventType =
          finalAction === 'allow'
            ? 'intent.approved'
            : finalAction === 'deny'
              ? 'intent.denied'
              : 'intent.escalated';

        // Record decision audit event
        auditHelper.recordIntentEvent(
          tenantId,
          auditEventType,
          intentId,
          { type: 'service', id: 'intent-queue' },
          {
            outcome: 'success',
            stateChange: {
              before: { status: 'evaluating' },
              after: { status: nextStatus },
            },
            metadata: {
              ruleAction: ruleDecision.action,
              policyAction: policyEvaluation?.finalAction,
              semanticValid: semanticValidation?.valid,
              semanticReason: semanticValidation?.reason,
              finalAction,
              policyOverride,
              semanticOverride,
              trustScore: intent.trustScore,
              trustLevel: intent.trustLevel,
            },
          }
        ).catch((auditError) => {
          logger.warn({ error: auditError }, 'Failed to record decision audit event');
        });

        recordJobResult('decision', 'success', (Date.now() - startTime) / 1000);
      } catch (error) {
        recordJobResult('decision', 'failure', (Date.now() - startTime) / 1000);
        throw error;
      }
    },
    {
      connection: connection(),
      concurrency,
      lockDuration,
      stalledInterval: lockDuration + 5000,
    }
  );

  decisionWorker.on('failed', async (job, error) => {
    if (!job) return;
    const { intentId, tenantId } = job.data as { intentId: string; tenantId: string };
    logger.error({ jobId: job.id, intentId, error: error.message }, 'Intent decision job failed');

    if (job.attemptsMade >= config.intent.maxRetries) {
      await moveToDeadLetterQueue(job, error, 'decision');
      await markIntentFailed(intentId, tenantId, error);
    }
  });

  workers.push(decisionWorker);

  // Execution worker - processes approved intents
  const tracer = getTracer();
  const executionWorker = new Worker(
    queueNames.execute,
    async (job) => {
      const startTime = Date.now();
      if (!intentService || isShuttingDown) return;

      const { intentId, tenantId, decision } = job.data as {
        intentId: string;
        tenantId: string;
        decision: Decision;
      };

      // Create system context for background job processing
      const ctx = createSystemTenantContext(tenantId, { userId: 'system:execution-worker' });

      const span = tracer.startSpan('intent.execution', {
        attributes: { intentId, tenantId },
      });

      let intent: Intent | null = null;

      try {
        // Get intent
        intent = await intentService.get(ctx, intentId);
        if (!intent) {
          logger.warn({ intentId }, 'Intent not found for execution');
          return;
        }

        // Transition to executing
        await intentService.updateStatus(ctx, intentId, 'executing', 'approved');

        // Execute via Cognigate
        const gateway = getCognigateGateway();
        const executionContext: ExecutionContext = {
          intent,
          decision,
          resourceLimits: {
            maxMemoryMb: 512,
            maxCpuPercent: 50,
            timeoutMs: 300000,
          },
        };

        const executionResult: ExecutionResult = await gateway.execute(executionContext);

        // Handle execution failure
        if (!executionResult.success) {
          logger.warn(
            { intentId, error: executionResult.error },
            'Cognigate execution failed'
          );

          // Record failure signal
          await trustEngine.recordSignal({
            id: randomUUID(),
            entityId: intent.entityId,
            type: 'behavioral.execution_failure',
            value: -0.15,
            weight: 1.0,
            source: 'cognigate-execution',
            timestamp: new Date().toISOString(),
          }, ctx);

          // Update to failed
          await intentService.updateStatus(ctx, intentId, 'failed', 'executing');

          // Audit
          await auditHelper.recordIntentEvent(
            tenantId,
            'intent.failed',
            intentId,
            { type: 'service', id: 'cognigate-gateway' },
            { outcome: 'failure', metadata: { error: executionResult.error, resourceUsage: executionResult.resourceUsage } }
          );

          span.setStatus({ code: SpanStatusCode.ERROR, message: executionResult.error });
          recordJobResult('execution', 'failure', (Date.now() - startTime) / 1000);
          return;
        }

        // Record trust signal for successful execution
        await trustEngine.recordSignal({
          id: randomUUID(),
          entityId: intent.entityId,
          type: 'behavioral.execution_success',
          value: 0.1,
          weight: 1.0,
          source: 'cognigate-execution',
          timestamp: new Date().toISOString(),
        }, ctx);

        // Create proof record
        const proofService = createProofService();
        await proofService.create({
          intent,
          decision,
          inputs: intent.context ?? {},
          outputs: executionResult.outputs,
          tenantId, // SECURITY: Required for per-tenant lock isolation
        });

        // Update to completed
        await intentService.updateStatus(ctx, intentId, 'completed', 'executing');

        // Audit
        await auditHelper.recordIntentEvent(
          tenantId,
          'intent.completed',
          intentId,
          { type: 'service', id: 'cognigate-gateway' },
          { outcome: 'success', metadata: { executionResult: { success: executionResult.success, outputs: executionResult.outputs, resourceUsage: executionResult.resourceUsage } } }
        );

        // Webhook
        const webhookPayload: Record<string, unknown> = {
          success: executionResult.success,
          outputs: executionResult.outputs,
          resourceUsage: executionResult.resourceUsage,
          completedAt: executionResult.completedAt,
        };
        webhookService.notifyIntent('intent.completed', intentId, tenantId, webhookPayload).catch((err) => {
          logger.warn({ err, intentId }, 'Failed to send completion webhook');
        });

        span.setStatus({ code: SpanStatusCode.OK });
        recordJobResult('execution', 'success', (Date.now() - startTime) / 1000);
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        logger.error({ error, intentId }, 'Execution failed');

        // Record failure signal
        await trustEngine.recordSignal({
          id: randomUUID(),
          entityId: intent?.entityId ?? 'unknown',
          type: 'behavioral.execution_failure',
          value: -0.2,
          weight: 1.0,
          source: 'intent-execution-worker',
          timestamp: new Date().toISOString(),
        }, ctx);

        // Update to failed
        await intentService.updateStatus(ctx, intentId, 'failed', 'executing');

        recordJobResult('execution', 'failure', (Date.now() - startTime) / 1000);
        throw error;
      } finally {
        span.end();
      }
    },
    {
      connection: connection(),
      concurrency,
      lockDuration,
      stalledInterval: lockDuration + 5000,
    }
  );

  executionWorker.on('failed', async (job, error) => {
    if (!job) return;
    const { intentId, tenantId } = job.data as { intentId: string; tenantId: string };
    logger.error({ jobId: job.id, intentId, error: error.message }, 'Execution job failed');

    if (job.attemptsMade >= config.intent.maxRetries) {
      await moveToDeadLetterQueue(job, error, 'execution');
    }
  });

  workers.push(executionWorker);

  logger.info(
    { concurrency, lockDuration, maxRetries: config.intent.maxRetries },
    'Intent workers registered'
  );
}

/**
 * Gracefully shutdown all workers
 * Waits for in-flight jobs to complete before closing
 */
export async function shutdownWorkers(timeoutMs = 30000): Promise<void> {
  if (!workersStarted) return;

  isShuttingDown = true;
  logger.info('Initiating graceful shutdown of intent workers');

  const shutdownPromises = workers.map(async (worker) => {
    try {
      await worker.close();
    } catch (error) {
      logger.error({ error }, 'Error closing worker');
    }
  });

  // Close queue event listeners
  const eventClosePromises = queueEvents.map(async (events) => {
    try {
      await events.close();
    } catch (error) {
      logger.error({ error }, 'Error closing queue events');
    }
  });

  // Wait for all with timeout
  const allPromises = [...shutdownPromises, ...eventClosePromises];

  await Promise.race([
    Promise.all(allPromises),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn('Shutdown timeout reached, forcing close');
        resolve();
      }, timeoutMs);
    }),
  ]);

  // Close pooled Redis connections
  await closePooledConnections();

  workersStarted = false;
  isShuttingDown = false;
  workers.length = 0;
  queueEvents.length = 0;

  logger.info('Intent workers shutdown complete');
}

/**
 * Get queue health status and update Prometheus gauges
 */
export async function getQueueHealth(): Promise<{
  intake: { waiting: number; active: number; failed: number };
  evaluate: { waiting: number; active: number; failed: number };
  decision: { waiting: number; active: number; failed: number };
  deadLetter: { count: number };
}> {
  const [intakeCounts, evaluateCounts, decisionCounts, dlqCount] =
    await Promise.all([
      intentIntakeQueue.getJobCounts('waiting', 'active', 'failed'),
      intentEvaluateQueue.getJobCounts('waiting', 'active', 'failed'),
      intentDecisionQueue.getJobCounts('waiting', 'active', 'failed'),
      deadLetterQueue.getJobCounts('waiting'),
    ]);

  // Update Prometheus gauges
  updateQueueGauges('intake', intakeCounts.waiting ?? 0, intakeCounts.active ?? 0);
  updateQueueGauges('evaluate', evaluateCounts.waiting ?? 0, evaluateCounts.active ?? 0);
  updateQueueGauges('decision', decisionCounts.waiting ?? 0, decisionCounts.active ?? 0);
  dlqSize.set(dlqCount.waiting ?? 0);

  return {
    intake: {
      waiting: intakeCounts.waiting ?? 0,
      active: intakeCounts.active ?? 0,
      failed: intakeCounts.failed ?? 0,
    },
    evaluate: {
      waiting: evaluateCounts.waiting ?? 0,
      active: evaluateCounts.active ?? 0,
      failed: evaluateCounts.failed ?? 0,
    },
    decision: {
      waiting: decisionCounts.waiting ?? 0,
      active: decisionCounts.active ?? 0,
      failed: decisionCounts.failed ?? 0,
    },
    deadLetter: {
      count: dlqCount.waiting ?? 0,
    },
  };
}

/**
 * Retry a job from the dead letter queue
 */
export async function retryDeadLetterJob(jobId: string): Promise<boolean> {
  const job = await deadLetterQueue.getJob(jobId);
  if (!job) {
    logger.warn({ jobId }, 'Dead letter job not found');
    return false;
  }

  const { originalQueue, jobData } = job.data as {
    originalQueue: string;
    jobData: Record<string, unknown>;
  };

  // Re-enqueue to original queue
  const targetQueue =
    originalQueue === 'intake'
      ? intentIntakeQueue
      : originalQueue === 'evaluate'
        ? intentEvaluateQueue
        : intentDecisionQueue;

  await targetQueue.add('retry', jobData);
  await job.remove();

  logger.info({ jobId, originalQueue }, 'Dead letter job retried');
  return true;
}

/**
 * Get the policy evaluation circuit breaker status
 * Useful for health checks and monitoring
 */
export async function getPolicyCircuitBreakerStatus(): Promise<{
  name: string;
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  lastFailureTime: Date | null;
  openedAt: Date | null;
  timeUntilReset: number | null;
}> {
  return policyCircuitBreaker.getStatus();
}

/**
 * Force the policy circuit breaker to open state
 * Useful for manual intervention during incidents
 */
export async function forcePolicyCircuitBreakerOpen(): Promise<void> {
  await policyCircuitBreaker.forceOpen();
  logger.warn({}, 'Policy circuit breaker forcibly opened');
}

/**
 * Force the policy circuit breaker to closed state
 * Useful for recovery after manual intervention
 */
export async function forcePolicyCircuitBreakerClose(): Promise<void> {
  await policyCircuitBreaker.forceClose();
  logger.info({}, 'Policy circuit breaker forcibly closed');
}

/**
 * Reset the policy circuit breaker state
 * Clears all failure counts and state
 */
export async function resetPolicyCircuitBreaker(): Promise<void> {
  await policyCircuitBreaker.reset();
  logger.info({}, 'Policy circuit breaker reset');
}

// ============================================================================
// Enhanced Queue Health Check
// ============================================================================

/**
 * Queue health check result with comprehensive metrics
 */
export interface QueueHealthCheckResult {
  healthy: boolean;
  activeJobs: number;
  waitingJobs: number;
  completedJobs: number;
  failedJobs: number;
  processingLatency: number; // ms
  workersAvailable: boolean;
  queueDepth: number;
  deadLetterCount: number;
  details: {
    intake: { waiting: number; active: number; failed: number; completed: number };
    evaluate: { waiting: number; active: number; failed: number; completed: number };
    decision: { waiting: number; active: number; failed: number; completed: number };
    execute: { waiting: number; active: number; failed: number; completed: number };
    deadLetter: { count: number };
  };
  canaryJobResult?: {
    success: boolean;
    latencyMs: number;
    error?: string;
  };
}

/**
 * Canary job data for health check
 */
interface CanaryJobData {
  type: 'canary';
  timestamp: number;
  healthCheckId: string;
}

// Canary queue for health checks
let canaryQueue: Queue | null = null;
let canaryWorker: Worker | null = null;
const canaryResults = new Map<string, { success: boolean; latencyMs: number; error?: string }>();

/**
 * Initialize canary queue for health checks
 */
function initCanaryQueue(): Queue {
  if (!canaryQueue) {
    canaryQueue = new Queue('intent:canary', {
      connection: connection(),
      defaultJobOptions: {
        removeOnComplete: { age: 60, count: 10 }, // Keep for 1 minute max
        removeOnFail: { age: 60, count: 10 },
        attempts: 1,
      },
    });

    // Create a worker to process canary jobs
    canaryWorker = new Worker(
      'intent:canary',
      async (job) => {
        const data = job.data as CanaryJobData;
        const latencyMs = Date.now() - data.timestamp;
        canaryResults.set(data.healthCheckId, {
          success: true,
          latencyMs,
        });
        return { processed: true, latencyMs };
      },
      {
        connection: connection(),
        concurrency: 1,
      }
    );

    canaryWorker.on('failed', (job, error) => {
      if (job) {
        const data = job.data as CanaryJobData;
        canaryResults.set(data.healthCheckId, {
          success: false,
          latencyMs: Date.now() - data.timestamp,
          error: error.message,
        });
      }
    });

    logger.debug('Canary queue initialized for health checks');
  }
  return canaryQueue;
}

/**
 * Shutdown the canary queue and worker
 */
export async function shutdownCanaryQueue(): Promise<void> {
  if (canaryWorker) {
    await canaryWorker.close();
    canaryWorker = null;
  }
  if (canaryQueue) {
    await canaryQueue.close();
    canaryQueue = null;
  }
  canaryResults.clear();
}

/**
 * Run a canary job to test actual job processing
 * Returns the processing latency or null if the test times out
 */
async function runCanaryJob(timeoutMs: number = 5000): Promise<{
  success: boolean;
  latencyMs: number;
  error?: string;
}> {
  const queue = initCanaryQueue();
  const healthCheckId = randomUUID();
  const startTime = Date.now();

  try {
    // Add canary job
    await queue.add('canary', {
      type: 'canary',
      timestamp: startTime,
      healthCheckId,
    } as CanaryJobData);

    // Wait for result with timeout
    const pollInterval = 100;
    let elapsed = 0;

    while (elapsed < timeoutMs) {
      const result = canaryResults.get(healthCheckId);
      if (result) {
        canaryResults.delete(healthCheckId);
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    // Timeout
    return {
      success: false,
      latencyMs: timeoutMs,
      error: 'Canary job timed out - workers may be unavailable or overloaded',
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Enhanced queue health check
 *
 * Performs comprehensive health check including:
 * - Queue depth and job counts
 * - Worker availability check via canary job
 * - Processing latency measurement
 * - Dead letter queue monitoring
 *
 * @param options.runCanary - Whether to run a canary job (default: true)
 * @param options.canaryTimeoutMs - Timeout for canary job (default: 5000ms)
 * @param options.maxQueueDepth - Maximum allowed queue depth before unhealthy (default: 10000)
 */
export async function checkQueueHealth(options?: {
  runCanary?: boolean;
  canaryTimeoutMs?: number;
  maxQueueDepth?: number;
}): Promise<QueueHealthCheckResult> {
  const config = getConfig();
  const runCanary = options?.runCanary ?? true;
  const canaryTimeoutMs = options?.canaryTimeoutMs ?? 5000;
  const maxQueueDepth = options?.maxQueueDepth ?? config.intent.queueDepthThreshold ?? 10000;

  // Get job counts from all queues in parallel
  const [
    intakeCounts,
    evaluateCounts,
    decisionCounts,
    executeCounts,
    dlqCount,
  ] = await Promise.all([
    intentIntakeQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
    intentEvaluateQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
    intentDecisionQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
    intentExecuteQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
    deadLetterQueue.getJobCounts('waiting'),
  ]);

  // Calculate totals
  const totalWaiting =
    (intakeCounts.waiting ?? 0) +
    (evaluateCounts.waiting ?? 0) +
    (decisionCounts.waiting ?? 0) +
    (executeCounts.waiting ?? 0);

  const totalActive =
    (intakeCounts.active ?? 0) +
    (evaluateCounts.active ?? 0) +
    (decisionCounts.active ?? 0) +
    (executeCounts.active ?? 0);

  const totalFailed =
    (intakeCounts.failed ?? 0) +
    (evaluateCounts.failed ?? 0) +
    (decisionCounts.failed ?? 0) +
    (executeCounts.failed ?? 0);

  const totalCompleted =
    (intakeCounts.completed ?? 0) +
    (evaluateCounts.completed ?? 0) +
    (decisionCounts.completed ?? 0) +
    (executeCounts.completed ?? 0);

  const queueDepth = totalWaiting + totalActive;
  const deadLetterCount = dlqCount.waiting ?? 0;

  // Update Prometheus gauges
  updateQueueGauges('intake', intakeCounts.waiting ?? 0, intakeCounts.active ?? 0);
  updateQueueGauges('evaluate', evaluateCounts.waiting ?? 0, evaluateCounts.active ?? 0);
  updateQueueGauges('decision', decisionCounts.waiting ?? 0, decisionCounts.active ?? 0);
  updateQueueGauges('execute', executeCounts.waiting ?? 0, executeCounts.active ?? 0);
  dlqSize.set(deadLetterCount);

  // Run canary job to test actual processing
  let canaryJobResult: { success: boolean; latencyMs: number; error?: string } | undefined;
  let workersAvailable = workersStarted && !isShuttingDown;
  let processingLatency = 0;

  if (runCanary && workersAvailable) {
    canaryJobResult = await runCanaryJob(canaryTimeoutMs);
    workersAvailable = canaryJobResult.success;
    processingLatency = canaryJobResult.latencyMs;
  }

  // Determine health status
  const isHealthy =
    workersAvailable &&
    queueDepth <= maxQueueDepth &&
    !isShuttingDown;

  const result: QueueHealthCheckResult = {
    healthy: isHealthy,
    activeJobs: totalActive,
    waitingJobs: totalWaiting,
    completedJobs: totalCompleted,
    failedJobs: totalFailed,
    processingLatency,
    workersAvailable,
    queueDepth,
    deadLetterCount,
    details: {
      intake: {
        waiting: intakeCounts.waiting ?? 0,
        active: intakeCounts.active ?? 0,
        failed: intakeCounts.failed ?? 0,
        completed: intakeCounts.completed ?? 0,
      },
      evaluate: {
        waiting: evaluateCounts.waiting ?? 0,
        active: evaluateCounts.active ?? 0,
        failed: evaluateCounts.failed ?? 0,
        completed: evaluateCounts.completed ?? 0,
      },
      decision: {
        waiting: decisionCounts.waiting ?? 0,
        active: decisionCounts.active ?? 0,
        failed: decisionCounts.failed ?? 0,
        completed: decisionCounts.completed ?? 0,
      },
      execute: {
        waiting: executeCounts.waiting ?? 0,
        active: executeCounts.active ?? 0,
        failed: executeCounts.failed ?? 0,
        completed: executeCounts.completed ?? 0,
      },
      deadLetter: {
        count: deadLetterCount,
      },
    },
    ...(canaryJobResult && { canaryJobResult }),
  };

  if (!isHealthy) {
    logger.warn(
      {
        healthy: isHealthy,
        workersAvailable,
        queueDepth,
        maxQueueDepth,
        isShuttingDown,
        canaryResult: canaryJobResult,
      },
      'Queue health check failed'
    );
  }

  return result;
}

/**
 * Check if queue workers are currently running
 */
export function areWorkersRunning(): boolean {
  return workersStarted && !isShuttingDown;
}

/**
 * Get the current queue depth (waiting + active jobs)
 */
export async function getQueueDepth(): Promise<number> {
  const health = await getQueueHealth();
  return (
    health.intake.waiting +
    health.intake.active +
    health.evaluate.waiting +
    health.evaluate.active +
    health.decision.waiting +
    health.decision.active
  );
}

/**
 * Pause all queue workers (stop processing new jobs)
 * Existing jobs in progress will continue to completion
 */
export async function pauseWorkers(): Promise<void> {
  logger.info('Pausing queue workers');
  const pausePromises = workers.map(async (worker) => {
    try {
      await worker.pause();
    } catch (error) {
      logger.warn({ error }, 'Error pausing worker');
    }
  });
  await Promise.all(pausePromises);
  logger.info('All queue workers paused');
}

/**
 * Resume all queue workers
 */
export async function resumeWorkers(): Promise<void> {
  logger.info('Resuming queue workers');
  const resumePromises = workers.map(async (worker) => {
    try {
      worker.resume();
    } catch (error) {
      logger.warn({ error }, 'Error resuming worker');
    }
  });
  await Promise.all(resumePromises);
  logger.info('All queue workers resumed');
}

/**
 * Wait for all active jobs to complete with timeout
 * Returns true if all jobs completed, false if timeout was reached
 */
export async function waitForActiveJobs(timeoutMs: number): Promise<{
  completed: boolean;
  remainingJobs: number;
}> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    const health = await getQueueHealth();
    const activeJobs =
      health.intake.active +
      health.evaluate.active +
      health.decision.active;

    if (activeJobs === 0) {
      return { completed: true, remainingJobs: 0 };
    }

    logger.debug(
      { activeJobs, elapsedMs: Date.now() - startTime, timeoutMs },
      'Waiting for active jobs to complete'
    );

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout reached - get final count
  const finalHealth = await getQueueHealth();
  const remainingJobs =
    finalHealth.intake.active +
    finalHealth.evaluate.active +
    finalHealth.decision.active;

  return { completed: false, remainingJobs };
}
