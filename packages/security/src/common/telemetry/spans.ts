/**
 * Span Utilities for OpenTelemetry
 *
 * Provides helper functions for creating spans, wrapping async functions,
 * adding attributes, and recording errors with proper context propagation.
 *
 * @packageDocumentation
 */

import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
  type Context,
  type Attributes,
  type Link,
  type TimeInput,
  type SpanOptions,
} from '@opentelemetry/api';
import { getTracer, VorionTracers } from './tracer.js';

/**
 * Span creation options
 */
export interface CreateSpanOptions {
  /** Span kind (default: INTERNAL) */
  kind?: SpanKind;
  /** Initial attributes */
  attributes?: Attributes;
  /** Links to related spans */
  links?: Link[];
  /** Start time (default: now) */
  startTime?: TimeInput;
  /** Parent context (default: active context) */
  parentContext?: Context;
  /** Root span (ignores parent context) */
  root?: boolean;
}

/**
 * Create a new span with automatic context propagation
 *
 * @param tracer - Tracer instance or tracer name
 * @param name - Span name
 * @param options - Span options
 * @returns Created span
 *
 * @example
 * ```typescript
 * const span = createSpan(getIntentTracer(), 'process-intent', {
 *   attributes: { 'intent.id': intentId },
 *   kind: SpanKind.INTERNAL,
 * });
 *
 * try {
 *   // Do work...
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } catch (error) {
 *   recordException(span, error);
 * } finally {
 *   span.end();
 * }
 * ```
 */
export function createSpan(
  tracer: Tracer | string,
  name: string,
  options: CreateSpanOptions = {}
): Span {
  const tracerInstance = typeof tracer === 'string' ? getTracer(tracer) : tracer;

  const spanOptions: SpanOptions = {
    kind: options.kind ?? SpanKind.INTERNAL,
    attributes: options.attributes,
    links: options.links,
    startTime: options.startTime,
    root: options.root,
  };

  const parentContext = options.parentContext ?? context.active();

  return tracerInstance.startSpan(name, spanOptions, parentContext);
}

/**
 * Execute a function within a span context
 *
 * Automatically handles span lifecycle including error recording
 * and status setting.
 *
 * @param tracer - Tracer instance or tracer name
 * @param name - Span name
 * @param fn - Async function to execute within the span
 * @param options - Span options
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withSpan(
 *   'vorion.intent',
 *   'validate-intent',
 *   async (span) => {
 *     span.setAttribute('intent.type', intentType);
 *     return await validateIntent(intent);
 *   },
 *   { attributes: { 'intent.id': intent.id } }
 * );
 * ```
 */
export async function withSpan<T>(
  tracer: Tracer | string,
  name: string,
  fn: (span: Span) => Promise<T>,
  options: CreateSpanOptions = {}
): Promise<T> {
  const tracerInstance = typeof tracer === 'string' ? getTracer(tracer) : tracer;
  const parentContext = options.parentContext ?? context.active();

  return tracerInstance.startActiveSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
      links: options.links,
      startTime: options.startTime,
      root: options.root,
    },
    parentContext,
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        recordException(span, error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Execute a synchronous function within a span context
 *
 * @param tracer - Tracer instance or tracer name
 * @param name - Span name
 * @param fn - Synchronous function to execute within the span
 * @param options - Span options
 * @returns Result of the function
 */
export function withSpanSync<T>(
  tracer: Tracer | string,
  name: string,
  fn: (span: Span) => T,
  options: CreateSpanOptions = {}
): T {
  const tracerInstance = typeof tracer === 'string' ? getTracer(tracer) : tracer;
  const parentContext = options.parentContext ?? context.active();

  return tracerInstance.startActiveSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: options.attributes,
      links: options.links,
      startTime: options.startTime,
      root: options.root,
    },
    parentContext,
    (span) => {
      try {
        const result = fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        recordException(span, error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Add attributes to a span
 *
 * @param span - Span to add attributes to
 * @param attributes - Attributes to add
 *
 * @example
 * ```typescript
 * addSpanAttributes(span, {
 *   'intent.id': intent.id,
 *   'intent.type': intent.type,
 *   'tenant.id': tenantId,
 *   'trust.level': trustLevel,
 * });
 * ```
 */
export function addSpanAttributes(span: Span, attributes: Attributes): void {
  span.setAttributes(attributes);
}

/**
 * Add a single attribute to a span
 *
 * @param span - Span to add attribute to
 * @param key - Attribute key
 * @param value - Attribute value
 */
export function addSpanAttribute(
  span: Span,
  key: string,
  value: string | number | boolean | string[] | number[] | boolean[]
): void {
  span.setAttribute(key, value);
}

/**
 * Record an exception on a span
 *
 * Sets the span status to ERROR and records exception details.
 *
 * @param span - Span to record exception on
 * @param error - Error to record
 * @param attributes - Additional attributes for the exception event
 *
 * @example
 * ```typescript
 * try {
 *   await processIntent(intent);
 * } catch (error) {
 *   recordException(span, error, {
 *     'error.category': 'validation',
 *     'intent.id': intent.id,
 *   });
 *   throw error;
 * }
 * ```
 */
export function recordException(
  span: Span,
  error: unknown,
  attributes?: Attributes
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessage,
  });

  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException({
      name: 'Error',
      message: errorMessage,
      stack: errorStack,
    });
  }

  // Add additional attributes as event if provided
  if (attributes) {
    span.addEvent('exception.context', attributes);
  }
}

/**
 * Add an event to a span
 *
 * @param span - Span to add event to
 * @param name - Event name
 * @param attributes - Event attributes
 * @param timestamp - Event timestamp
 *
 * @example
 * ```typescript
 * addSpanEvent(span, 'trust.evaluation.complete', {
 *   'trust.level': trustLevel,
 *   'trust.score': trustScore,
 *   'trust.factors': JSON.stringify(factors),
 * });
 * ```
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Attributes,
  timestamp?: TimeInput
): void {
  span.addEvent(name, attributes, timestamp);
}

/**
 * Create a link to another span
 *
 * Used to link related spans that are not in a parent-child relationship.
 *
 * @param traceId - Trace ID of the linked span
 * @param spanId - Span ID of the linked span
 * @param attributes - Link attributes
 * @returns Link object
 *
 * @example
 * ```typescript
 * const link = createSpanLink(originalTraceId, originalSpanId, {
 *   'link.type': 'retry',
 *   'link.attempt': 2,
 * });
 *
 * const span = createSpan(tracer, 'retry-operation', {
 *   links: [link],
 * });
 * ```
 */
export function createSpanLink(
  traceId: string,
  spanId: string,
  attributes?: Attributes
): Link {
  return {
    context: {
      traceId,
      spanId,
      traceFlags: 1, // Sampled
    },
    attributes,
  };
}

/**
 * Create multiple links to related spans
 *
 * @param links - Array of link specifications
 * @returns Array of Link objects
 */
export function createSpanLinks(
  links: Array<{
    traceId: string;
    spanId: string;
    attributes?: Attributes;
  }>
): Link[] {
  return links.map((link) => createSpanLink(link.traceId, link.spanId, link.attributes));
}

/**
 * Get the current active span
 *
 * @returns Active span or undefined
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Get the current span context
 *
 * @returns Span context with trace and span IDs
 */
export function getSpanContext(): {
  traceId: string;
  spanId: string;
  traceFlags: number;
} | null {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return null;
  }

  const ctx = activeSpan.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    traceFlags: ctx.traceFlags,
  };
}

/**
 * Run a function with a specific context
 *
 * @param ctx - Context to use
 * @param fn - Function to run
 * @returns Result of the function
 */
export function runWithContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

/**
 * Get the current active context
 *
 * @returns Active context
 */
export function getActiveContext(): Context {
  return context.active();
}

/**
 * Vorion-specific span attributes
 */
export const VorionSpanAttributes = {
  // Intent attributes
  INTENT_ID: 'vorion.intent.id',
  INTENT_TYPE: 'vorion.intent.type',
  INTENT_STATUS: 'vorion.intent.status',
  INTENT_PRIORITY: 'vorion.intent.priority',

  // Tenant attributes
  TENANT_ID: 'vorion.tenant.id',
  ENTITY_ID: 'vorion.entity.id',

  // Trust attributes
  TRUST_LEVEL: 'vorion.trust.level',
  TRUST_SCORE: 'vorion.trust.score',
  TRUST_FACTORS: 'vorion.trust.factors',

  // Policy attributes
  POLICY_ID: 'vorion.policy.id',
  POLICY_ACTION: 'vorion.policy.action',
  POLICY_NAMESPACE: 'vorion.policy.namespace',

  // Security attributes
  SECURITY_EVENT: 'vorion.security.event',
  SECURITY_RISK: 'vorion.security.risk',
  SECURITY_VIOLATION: 'vorion.security.violation',

  // Escalation attributes
  ESCALATION_ID: 'vorion.escalation.id',
  ESCALATION_REASON: 'vorion.escalation.reason',
  ESCALATION_STATUS: 'vorion.escalation.status',

  // Queue attributes
  QUEUE_NAME: 'vorion.queue.name',
  JOB_ID: 'vorion.job.id',
  JOB_ATTEMPT: 'vorion.job.attempt',

  // Database attributes
  DB_OPERATION: 'vorion.db.operation',
  DB_TABLE: 'vorion.db.table',
  DB_ROWS_AFFECTED: 'vorion.db.rows_affected',

  // Cache attributes
  CACHE_HIT: 'vorion.cache.hit',
  CACHE_KEY: 'vorion.cache.key',

  // Webhook attributes
  WEBHOOK_ID: 'vorion.webhook.id',
  WEBHOOK_EVENT: 'vorion.webhook.event',
  WEBHOOK_STATUS: 'vorion.webhook.status',
} as const;

/**
 * Span event names for Vorion operations
 */
export const VorionSpanEvents = {
  // Intent events
  INTENT_SUBMITTED: 'vorion.intent.submitted',
  INTENT_VALIDATED: 'vorion.intent.validated',
  INTENT_EVALUATED: 'vorion.intent.evaluated',
  INTENT_DECIDED: 'vorion.intent.decided',
  INTENT_COMPLETED: 'vorion.intent.completed',

  // Trust events
  TRUST_EVALUATED: 'vorion.trust.evaluated',
  TRUST_GATE_PASSED: 'vorion.trust.gate_passed',
  TRUST_GATE_FAILED: 'vorion.trust.gate_failed',

  // Policy events
  POLICY_MATCHED: 'vorion.policy.matched',
  POLICY_EVALUATED: 'vorion.policy.evaluated',
  POLICY_DENIED: 'vorion.policy.denied',

  // Security events
  SECURITY_VIOLATION_DETECTED: 'vorion.security.violation_detected',
  AUTH_SUCCESS: 'vorion.auth.success',
  AUTH_FAILURE: 'vorion.auth.failure',

  // Escalation events
  ESCALATION_CREATED: 'vorion.escalation.created',
  ESCALATION_RESOLVED: 'vorion.escalation.resolved',
  ESCALATION_TIMEOUT: 'vorion.escalation.timeout',
} as const;

/**
 * Create an intent span with standard attributes
 */
export async function withIntentSpan<T>(
  name: string,
  intentId: string,
  tenantId: string,
  fn: (span: Span) => Promise<T>,
  additionalAttributes?: Attributes
): Promise<T> {
  return withSpan(
    VorionTracers.INTENT,
    name,
    fn,
    {
      attributes: {
        [VorionSpanAttributes.INTENT_ID]: intentId,
        [VorionSpanAttributes.TENANT_ID]: tenantId,
        ...additionalAttributes,
      },
    }
  );
}

/**
 * Create a security span with standard attributes
 */
export async function withSecuritySpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  return withSpan(
    VorionTracers.SECURITY,
    name,
    fn,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [VorionSpanAttributes.SECURITY_EVENT]: true,
        ...attributes,
      },
    }
  );
}

/**
 * Create a policy evaluation span
 */
export async function withPolicySpan<T>(
  intentId: string,
  tenantId: string,
  namespace: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(
    VorionTracers.POLICY,
    'policy.evaluate',
    fn,
    {
      attributes: {
        [VorionSpanAttributes.INTENT_ID]: intentId,
        [VorionSpanAttributes.TENANT_ID]: tenantId,
        [VorionSpanAttributes.POLICY_NAMESPACE]: namespace,
      },
    }
  );
}

/**
 * Create a database operation span
 */
export async function withDatabaseSpan<T>(
  operation: string,
  table: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(
    VorionTracers.DATABASE,
    `db.${operation}`,
    fn,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [VorionSpanAttributes.DB_OPERATION]: operation,
        [VorionSpanAttributes.DB_TABLE]: table,
        'db.system': 'postgresql',
      },
    }
  );
}

/**
 * Create a cache operation span
 */
export async function withCacheSpan<T>(
  operation: string,
  key: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withSpan(
    VorionTracers.CACHE,
    `cache.${operation}`,
    fn,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [VorionSpanAttributes.CACHE_KEY]: key,
        'db.system': 'redis',
      },
    }
  );
}
