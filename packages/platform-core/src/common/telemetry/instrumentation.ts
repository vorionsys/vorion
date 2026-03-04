/**
 * Auto-Instrumentation Configuration
 *
 * Configures automatic instrumentation for common libraries and
 * provides custom instrumentation for Vorion security operations.
 *
 * @packageDocumentation
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { Instrumentation } from '@opentelemetry/instrumentation';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Attributes,
} from '@opentelemetry/api';
import { createLogger } from '../logger.js';
import { getTracer, VorionTracers } from './tracer.js';
import { VorionSpanAttributes, VorionSpanEvents } from './spans.js';

const logger = createLogger({ component: 'telemetry-instrumentation' });

/**
 * Instrumentation configuration options
 */
export interface InstrumentationConfig {
  /** Enable HTTP instrumentation */
  http?: boolean | HttpInstrumentationConfig;
  /** Enable Fastify instrumentation */
  fastify?: boolean | FastifyInstrumentationConfig;
  /** Enable Redis instrumentation */
  redis?: boolean | RedisInstrumentationConfig;
  /** Enable PostgreSQL instrumentation */
  postgres?: boolean | PostgresInstrumentationConfig;
  /** Enable filesystem instrumentation */
  fs?: boolean;
  /** Enable DNS instrumentation */
  dns?: boolean;
  /** Custom instrumentations to add */
  custom?: Instrumentation[];
}

/**
 * HTTP instrumentation configuration
 */
export interface HttpInstrumentationConfig {
  /** Ignore specific URL paths */
  ignoreIncomingPaths?: string[];
  /** Ignore outgoing requests to specific URLs */
  ignoreOutgoingUrls?: string[];
  /** Request hook for adding attributes */
  requestHook?: (span: Span, request: unknown) => void;
  /** Response hook for adding attributes */
  responseHook?: (span: Span, response: unknown) => void;
}

/**
 * Fastify instrumentation configuration
 */
export interface FastifyInstrumentationConfig {
  /** Request hook for adding attributes */
  requestHook?: (span: Span, request: unknown) => void;
}

/**
 * Redis instrumentation configuration
 */
export interface RedisInstrumentationConfig {
  /** Enable command tracing */
  dbStatementSerializer?: (command: string, args: unknown[]) => string;
  /** Response hook */
  responseHook?: (span: Span, response: unknown) => void;
}

/**
 * PostgreSQL instrumentation configuration
 */
export interface PostgresInstrumentationConfig {
  /** Enhance spans with query information */
  enhancedDatabaseReporting?: boolean;
  /** Add query text to spans (be careful with sensitive data) */
  addSqlText?: boolean;
}

/**
 * Default paths to ignore for HTTP instrumentation
 */
const DEFAULT_IGNORE_PATHS = [
  '/health',
  '/ready',
  '/metrics',
  '/favicon.ico',
];

/**
 * Create HTTP instrumentation with Vorion-specific configuration
 */
function createHttpInstrumentation(
  config?: HttpInstrumentationConfig
): HttpInstrumentation {
  return new HttpInstrumentation({
    ignoreIncomingRequestHook: (request) => {
      // Ignore configured paths
      const ignorePaths = config?.ignoreIncomingPaths ?? DEFAULT_IGNORE_PATHS;
      const url = (request as { url?: string }).url ?? '';
      return ignorePaths.some((path) => url.startsWith(path));
    },
    ignoreOutgoingRequestHook: (request) => {
      const ignoreUrls = config?.ignoreOutgoingUrls ?? [];
      const url = (request as { host?: string; path?: string }).host ?? '';
      return ignoreUrls.some((ignoreUrl) => url.includes(ignoreUrl));
    },
    requestHook: (span, request) => {
      // Add Vorion-specific attributes
      span.setAttribute('vorion.instrumentation', 'http');

      // Call custom hook if provided
      config?.requestHook?.(span, request);
    },
    responseHook: (span, response) => {
      // Call custom hook if provided
      config?.responseHook?.(span, response);
    },
  });
}

/**
 * Create Fastify instrumentation with Vorion-specific configuration
 */
function createFastifyInstrumentation(
  config?: FastifyInstrumentationConfig
): FastifyInstrumentation {
  return new FastifyInstrumentation({
    requestHook: (span, info) => {
      // Add Vorion-specific attributes
      span.setAttribute('vorion.instrumentation', 'fastify');

      // Extract route pattern
      const request = info.request as { routerPath?: string };
      if (request.routerPath) {
        span.setAttribute('http.route', request.routerPath);
      }

      // Call custom hook if provided
      config?.requestHook?.(span, info);
    },
  });
}

/**
 * Create Redis instrumentation with Vorion-specific configuration
 */
function createRedisInstrumentation(
  config?: RedisInstrumentationConfig
): IORedisInstrumentation {
  return new IORedisInstrumentation({
    dbStatementSerializer:
      config?.dbStatementSerializer ??
      ((command: string, args: unknown[]) => {
        // Mask potential sensitive keys
        const maskedArgs = args.map((arg) => {
          if (typeof arg === 'string' && arg.includes('token')) {
            return '[REDACTED]';
          }
          return String(arg);
        });
        return `${command} ${maskedArgs.join(' ')}`;
      }),
    responseHook: (span, response) => {
      span.setAttribute('vorion.instrumentation', 'redis');
      config?.responseHook?.(span, response);
    },
  });
}

/**
 * Create PostgreSQL instrumentation with Vorion-specific configuration
 */
function createPostgresInstrumentation(
  config?: PostgresInstrumentationConfig
): PgInstrumentation {
  return new PgInstrumentation({
    enhancedDatabaseReporting: config?.enhancedDatabaseReporting ?? true,
    addSqlCommenterCommentToQueries: false,
    responseHook: (span) => {
      span.setAttribute('vorion.instrumentation', 'postgres');
    },
  });
}

/**
 * Get all instrumentations based on configuration
 */
export function getInstrumentations(
  config: InstrumentationConfig = {}
): Instrumentation[] {
  const instrumentations: Instrumentation[] = [];

  // HTTP instrumentation
  if (config.http !== false) {
    const httpConfig = typeof config.http === 'object' ? config.http : undefined;
    instrumentations.push(createHttpInstrumentation(httpConfig));
  }

  // Fastify instrumentation
  if (config.fastify !== false) {
    const fastifyConfig =
      typeof config.fastify === 'object' ? config.fastify : undefined;
    instrumentations.push(createFastifyInstrumentation(fastifyConfig));
  }

  // Redis instrumentation
  if (config.redis !== false) {
    const redisConfig =
      typeof config.redis === 'object' ? config.redis : undefined;
    instrumentations.push(createRedisInstrumentation(redisConfig));
  }

  // PostgreSQL instrumentation
  if (config.postgres !== false) {
    const postgresConfig =
      typeof config.postgres === 'object' ? config.postgres : undefined;
    instrumentations.push(createPostgresInstrumentation(postgresConfig));
  }

  // Add custom instrumentations
  if (config.custom) {
    instrumentations.push(...config.custom);
  }

  return instrumentations;
}

/**
 * Get Node.js auto-instrumentations with Vorion-specific configuration
 */
export function getNodeInstrumentations(): Instrumentation[] {
  return getNodeAutoInstrumentations({
    // Disable noisy instrumentations
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },

    // Configure HTTP instrumentation
    '@opentelemetry/instrumentation-http': {
      enabled: true,
    },

    // Configure Fastify instrumentation
    '@opentelemetry/instrumentation-fastify': {
      enabled: true,
    },

    // Configure Redis instrumentation
    '@opentelemetry/instrumentation-ioredis': {
      enabled: true,
    },

    // Configure PostgreSQL instrumentation
    '@opentelemetry/instrumentation-pg': {
      enabled: true,
      enhancedDatabaseReporting: true,
    },
  }) as Instrumentation[];
}

// =============================================================================
// Custom Security Operation Instrumentation
// =============================================================================

/**
 * Security operation types
 */
export type SecurityOperationType =
  | 'authentication'
  | 'authorization'
  | 'policy-evaluation'
  | 'trust-evaluation'
  | 'escalation'
  | 'audit'
  | 'encryption'
  | 'token-validation'
  | 'mfa-verification'
  | 'session-validation';

/**
 * Security operation context
 */
export interface SecurityOperationContext {
  /** Operation type */
  operationType: SecurityOperationType;
  /** Tenant ID */
  tenantId?: string;
  /** Entity/User ID */
  entityId?: string;
  /** Intent ID (if applicable) */
  intentId?: string;
  /** Additional attributes */
  attributes?: Attributes;
}

/**
 * Instrument a security operation
 *
 * @param ctx - Security operation context
 * @param fn - Function to instrument
 * @returns Result of the function
 */
export async function instrumentSecurityOperation<T>(
  ctx: SecurityOperationContext,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer(VorionTracers.SECURITY);

  return tracer.startActiveSpan(
    `security.${ctx.operationType}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        [VorionSpanAttributes.SECURITY_EVENT]: true,
        'security.operation_type': ctx.operationType,
        ...(ctx.tenantId && { [VorionSpanAttributes.TENANT_ID]: ctx.tenantId }),
        ...(ctx.entityId && { [VorionSpanAttributes.ENTITY_ID]: ctx.entityId }),
        ...(ctx.intentId && { [VorionSpanAttributes.INTENT_ID]: ctx.intentId }),
        ...ctx.attributes,
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Instrument authentication operation
 */
export async function instrumentAuth<T>(
  tenantId: string,
  entityId: string,
  method: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'authentication',
      tenantId,
      entityId,
      attributes: {
        'auth.method': method,
      },
    },
    fn
  );
}

/**
 * Instrument authorization operation
 */
export async function instrumentAuthz<T>(
  tenantId: string,
  entityId: string,
  resource: string,
  action: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'authorization',
      tenantId,
      entityId,
      attributes: {
        'authz.resource': resource,
        'authz.action': action,
      },
    },
    fn
  );
}

/**
 * Instrument policy evaluation
 */
export async function instrumentPolicyEval<T>(
  tenantId: string,
  intentId: string,
  namespace: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'policy-evaluation',
      tenantId,
      intentId,
      attributes: {
        [VorionSpanAttributes.POLICY_NAMESPACE]: namespace,
      },
    },
    fn
  );
}

/**
 * Instrument trust evaluation
 */
export async function instrumentTrustEval<T>(
  tenantId: string,
  entityId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'trust-evaluation',
      tenantId,
      entityId,
    },
    fn
  );
}

/**
 * Instrument escalation handling
 */
export async function instrumentEscalation<T>(
  tenantId: string,
  intentId: string,
  escalationId: string,
  reason: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'escalation',
      tenantId,
      intentId,
      attributes: {
        [VorionSpanAttributes.ESCALATION_ID]: escalationId,
        [VorionSpanAttributes.ESCALATION_REASON]: reason,
      },
    },
    fn
  );
}

/**
 * Instrument token validation
 */
export async function instrumentTokenValidation<T>(
  tokenType: 'access' | 'refresh' | 'api-key',
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'token-validation',
      attributes: {
        'token.type': tokenType,
      },
    },
    fn
  );
}

/**
 * Instrument MFA verification
 */
export async function instrumentMfaVerification<T>(
  tenantId: string,
  entityId: string,
  method: 'totp' | 'webauthn' | 'sms' | 'email',
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return instrumentSecurityOperation(
    {
      operationType: 'mfa-verification',
      tenantId,
      entityId,
      attributes: {
        'mfa.method': method,
      },
    },
    fn
  );
}

/**
 * Record security event on span
 */
export function recordSecurityEvent(
  span: Span,
  event: string,
  attributes?: Attributes
): void {
  span.addEvent(`security.${event}`, {
    [VorionSpanAttributes.SECURITY_EVENT]: true,
    ...attributes,
  });
}

/**
 * Record authentication success
 */
export function recordAuthSuccess(span: Span, method: string): void {
  span.addEvent(VorionSpanEvents.AUTH_SUCCESS, {
    'auth.method': method,
    'auth.success': true,
  });
}

/**
 * Record authentication failure
 */
export function recordAuthFailure(
  span: Span,
  method: string,
  reason: string
): void {
  span.addEvent(VorionSpanEvents.AUTH_FAILURE, {
    'auth.method': method,
    'auth.success': false,
    'auth.failure_reason': reason,
  });
  span.setAttribute('auth.failure', true);
}

/**
 * Record policy denial
 */
export function recordPolicyDenial(
  span: Span,
  policyId: string,
  reason: string
): void {
  span.addEvent(VorionSpanEvents.POLICY_DENIED, {
    [VorionSpanAttributes.POLICY_ID]: policyId,
    [VorionSpanAttributes.POLICY_ACTION]: 'deny',
    'policy.denial_reason': reason,
  });
}

/**
 * Record security violation
 */
export function recordSecurityViolation(
  span: Span,
  violationType: string,
  details: Record<string, string | number | boolean>
): void {
  span.addEvent(VorionSpanEvents.SECURITY_VIOLATION_DETECTED, {
    [VorionSpanAttributes.SECURITY_VIOLATION]: violationType,
    ...details,
  });
  span.setAttribute(VorionSpanAttributes.SECURITY_RISK, 'high');
}

// =============================================================================
// Database Operation Instrumentation
// =============================================================================

/**
 * Instrument a database query
 */
export async function instrumentDbQuery<T>(
  operation: string,
  table: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer(VorionTracers.DATABASE);

  return tracer.startActiveSpan(
    `db.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
        'db.operation': operation,
        [VorionSpanAttributes.DB_TABLE]: table,
      },
    },
    async (span) => {
      const startTime = Date.now();
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.setAttribute('db.duration_ms', Date.now() - startTime);
        span.end();
      }
    }
  );
}

/**
 * Instrument a cache operation
 */
export async function instrumentCacheOp<T>(
  operation: 'get' | 'set' | 'del' | 'exists',
  key: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer(VorionTracers.CACHE);

  return tracer.startActiveSpan(
    `cache.${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'redis',
        'db.operation': operation,
        [VorionSpanAttributes.CACHE_KEY]: key,
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });

        // Record cache hit/miss for get operations
        if (operation === 'get') {
          span.setAttribute(VorionSpanAttributes.CACHE_HIT, result !== null);
        }

        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

// =============================================================================
// Queue Operation Instrumentation
// =============================================================================

/**
 * Instrument queue job production
 */
export async function instrumentQueueProduce<T>(
  queueName: string,
  jobType: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer(VorionTracers.QUEUE);

  return tracer.startActiveSpan(
    `queue.${queueName}.produce`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        [VorionSpanAttributes.QUEUE_NAME]: queueName,
        'messaging.system': 'bullmq',
        'messaging.operation': 'publish',
        'messaging.destination': queueName,
        'job.type': jobType,
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Instrument queue job consumption
 */
export async function instrumentQueueConsume<T>(
  queueName: string,
  jobId: string,
  fn: (span: Span) => Promise<T>,
  parentContext?: typeof context
): Promise<T> {
  const tracer = getTracer(VorionTracers.QUEUE);
  const ctx = parentContext?.active() ?? context.active();

  return context.with(ctx, () =>
    tracer.startActiveSpan(
      `queue.${queueName}.process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          [VorionSpanAttributes.QUEUE_NAME]: queueName,
          [VorionSpanAttributes.JOB_ID]: jobId,
          'messaging.system': 'bullmq',
          'messaging.operation': 'receive',
          'messaging.destination': queueName,
        },
      },
      async (span) => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          if (error instanceof Error) {
            span.recordException(error);
          }
          throw error;
        } finally {
          span.end();
        }
      }
    )
  );
}
