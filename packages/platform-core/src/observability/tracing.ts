/**
 * Distributed Tracing Service
 *
 * Extends OpenTelemetry with Agent Anchor specific spans and context propagation.
 * Provides convenient wrappers for tracing agent operations, A2A calls, and sandbox execution.
 *
 * @packageDocumentation
 */

import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  Span,
  Tracer,
  Context,
  propagation,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'observability-tracing' });

// ============================================================================
// Constants
// ============================================================================

const TRACER_NAME = 'vorion-anchor';
const TRACER_VERSION = '1.0.0';

// Semantic attributes for Agent Anchor
export const AnchorAttributes = {
  // Agent attributes - Using CAR (Categorical Agentic Registry) terminology
  AGENT_CAR: 'anchor.agent.car',
  /** @deprecated Use AGENT_CAR instead */
  AGENT_ACI: 'anchor.agent.car', // Alias for backwards compatibility
  AGENT_TENANT: 'anchor.agent.tenant',
  AGENT_TIER: 'anchor.agent.tier',
  AGENT_SCORE: 'anchor.agent.score',
  AGENT_STATE: 'anchor.agent.state',

  // A2A attributes - Using CAR terminology
  A2A_CALLER_CAR: 'anchor.a2a.caller_car',
  /** @deprecated Use A2A_CALLER_CAR instead */
  A2A_CALLER_ACI: 'anchor.a2a.caller_car', // Alias for backwards compatibility
  A2A_CALLEE_CAR: 'anchor.a2a.callee_car',
  /** @deprecated Use A2A_CALLEE_CAR instead */
  A2A_CALLEE_ACI: 'anchor.a2a.callee_car', // Alias for backwards compatibility
  A2A_ACTION: 'anchor.a2a.action',
  A2A_CHAIN_DEPTH: 'anchor.a2a.chain_depth',
  A2A_CHAIN_ID: 'anchor.a2a.chain_id',
  A2A_DELEGATION_USED: 'anchor.a2a.delegation_used',

  // Trust attributes
  TRUST_SCORE: 'anchor.trust.score',
  TRUST_TIER: 'anchor.trust.tier',
  TRUST_VERIFIED: 'anchor.trust.verified',
  TRUST_PROOF_VALID: 'anchor.trust.proof_valid',

  // Sandbox attributes
  SANDBOX_CONTAINER_ID: 'anchor.sandbox.container_id',
  SANDBOX_RUNTIME: 'anchor.sandbox.runtime',
  SANDBOX_NETWORK_LEVEL: 'anchor.sandbox.network_level',
  SANDBOX_FS_LEVEL: 'anchor.sandbox.fs_level',

  // Attestation attributes
  ATTESTATION_ID: 'anchor.attestation.id',
  ATTESTATION_TYPE: 'anchor.attestation.type',
  ATTESTATION_OUTCOME: 'anchor.attestation.outcome',
} as const;

// ============================================================================
// Tracer Instance
// ============================================================================

let tracerInstance: Tracer | null = null;

/**
 * Get the Agent Anchor tracer
 */
export function getTracer(): Tracer {
  if (!tracerInstance) {
    tracerInstance = trace.getTracer(TRACER_NAME, TRACER_VERSION);
  }
  return tracerInstance;
}

// ============================================================================
// Span Builders
// ============================================================================

export interface SpanOptions {
  /** Parent context (uses current context if not provided) */
  parentContext?: Context;
  /** Additional attributes */
  attributes?: Record<string, string | number | boolean>;
  /** Span kind */
  kind?: SpanKind;
}

/**
 * Create a span for agent operations
 */
export function startAgentSpan(
  operation: string,
  carId: string,
  tenantId: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    `agent.${operation}`,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.AGENT_ACI]: carId,
        [AnchorAttributes.AGENT_TENANT]: tenantId,
        ...options.attributes,
      },
    },
    parentContext
  );
}

/**
 * Create a span for A2A calls
 */
export function startA2ASpan(
  callerCarId: string,
  calleeCarId: string,
  action: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    `a2a.invoke.${action}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [AnchorAttributes.A2A_CALLER_ACI]: callerCarId,
        [AnchorAttributes.A2A_CALLEE_ACI]: calleeCarId,
        [AnchorAttributes.A2A_ACTION]: action,
        ...options.attributes,
      },
    },
    parentContext
  );
}

/**
 * Create a span for A2A request handling (server side)
 */
export function startA2AServerSpan(
  callerCarId: string,
  action: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    `a2a.handle.${action}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        [AnchorAttributes.A2A_CALLER_ACI]: callerCarId,
        [AnchorAttributes.A2A_ACTION]: action,
        ...options.attributes,
      },
    },
    parentContext
  );
}

/**
 * Create a span for trust verification
 */
export function startTrustVerificationSpan(
  carId: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    'trust.verify',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.AGENT_ACI]: carId,
        ...options.attributes,
      },
    },
    parentContext
  );
}

/**
 * Create a span for sandbox execution
 */
export function startSandboxSpan(
  containerId: string,
  carId: string,
  runtime: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    'sandbox.execute',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.SANDBOX_CONTAINER_ID]: containerId,
        [AnchorAttributes.AGENT_ACI]: carId,
        [AnchorAttributes.SANDBOX_RUNTIME]: runtime,
        ...options.attributes,
      },
    },
    parentContext
  );
}

/**
 * Create a span for attestation processing
 */
export function startAttestationSpan(
  attestationId: string,
  type: string,
  carId: string,
  options: SpanOptions = {}
): Span {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  return tracer.startSpan(
    `attestation.process.${type}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.ATTESTATION_ID]: attestationId,
        [AnchorAttributes.ATTESTATION_TYPE]: type,
        [AnchorAttributes.AGENT_ACI]: carId,
        ...options.attributes,
      },
    },
    parentContext
  );
}

// ============================================================================
// Span Utilities
// ============================================================================

/**
 * End a span with success status
 */
export function endSpanSuccess(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * End a span with error status
 */
export function endSpanError(span: Span, error: Error | string): void {
  const message = typeof error === 'string' ? error : error.message;
  span.setStatus({ code: SpanStatusCode.ERROR, message });

  if (error instanceof Error) {
    span.recordException(error);
  }

  span.end();
}

/**
 * Add trust information to a span
 */
export function addTrustToSpan(
  span: Span,
  score: number,
  tier: number,
  verified: boolean
): void {
  span.setAttributes({
    [AnchorAttributes.TRUST_SCORE]: score,
    [AnchorAttributes.TRUST_TIER]: tier,
    [AnchorAttributes.TRUST_VERIFIED]: verified,
  });
}

/**
 * Add A2A chain information to a span
 */
export function addChainToSpan(
  span: Span,
  chainId: string,
  depth: number,
  delegationUsed: boolean
): void {
  span.setAttributes({
    [AnchorAttributes.A2A_CHAIN_ID]: chainId,
    [AnchorAttributes.A2A_CHAIN_DEPTH]: depth,
    [AnchorAttributes.A2A_DELEGATION_USED]: delegationUsed,
  });
}

// ============================================================================
// Context Propagation
// ============================================================================

const propagator = new W3CTraceContextPropagator();

/**
 * Inject trace context into headers for A2A calls
 */
export function injectTraceContext(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

/**
 * Extract trace context from headers for incoming A2A calls
 */
export function extractTraceContext(headers: Record<string, string>): Context {
  return propagation.extract(context.active(), headers);
}

/**
 * Run a function within a trace context extracted from headers
 */
export function withExtractedContext<T>(
  headers: Record<string, string>,
  fn: () => T
): T {
  const extractedContext = extractTraceContext(headers);
  return context.with(extractedContext, fn);
}

// ============================================================================
// High-Level Traced Operations
// ============================================================================

/**
 * Trace an async operation
 */
export async function traceAsync<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  options: SpanOptions = {}
): Promise<T> {
  const tracer = getTracer();
  const parentContext = options.parentContext ?? context.active();

  const span = tracer.startSpan(
    spanName,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
    },
    parentContext
  );

  try {
    const result = await context.with(trace.setSpan(parentContext, span), () => fn(span));
    endSpanSuccess(span);
    return result;
  } catch (error) {
    endSpanError(span, error instanceof Error ? error : String(error));
    throw error;
  }
}

/**
 * Trace agent registration
 */
export async function traceAgentRegistration<T>(
  carId: string,
  tenantId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return traceAsync(
    'agent.register',
    fn,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.AGENT_ACI]: carId,
        [AnchorAttributes.AGENT_TENANT]: tenantId,
      },
    }
  );
}

/**
 * Trace A2A invocation
 */
export async function traceA2AInvocation<T>(
  callerCarId: string,
  calleeCarId: string,
  action: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return traceAsync(
    `a2a.invoke.${action}`,
    fn,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [AnchorAttributes.A2A_CALLER_ACI]: callerCarId,
        [AnchorAttributes.A2A_CALLEE_ACI]: calleeCarId,
        [AnchorAttributes.A2A_ACTION]: action,
      },
    }
  );
}

/**
 * Trace sandbox execution
 */
export async function traceSandboxExecution<T>(
  containerId: string,
  carId: string,
  runtime: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return traceAsync(
    'sandbox.execute',
    fn,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AnchorAttributes.SANDBOX_CONTAINER_ID]: containerId,
        [AnchorAttributes.AGENT_ACI]: carId,
        [AnchorAttributes.SANDBOX_RUNTIME]: runtime,
      },
    }
  );
}

logger.info('Observability tracing initialized');
