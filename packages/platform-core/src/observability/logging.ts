/**
 * Structured Logging Service
 *
 * Provides structured logging with automatic trace context injection,
 * log levels, and consistent formatting for observability.
 *
 * @packageDocumentation
 */

import { pino } from 'pino';
import { trace, context, SpanContext } from '@opentelemetry/api';
import { createLogger as createBaseLogger } from '../common/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface LogContext {
  /** Trace ID for distributed tracing */
  traceId?: string;
  /** Span ID for distributed tracing */
  spanId?: string;
  /** Tenant ID for multi-tenancy */
  tenantId?: string;
  /** Agent CAR ID */
  carId?: string;
  /** Request ID */
  requestId?: string;
  /** Component name */
  component?: string;
  /** Additional context */
  [key: string]: unknown;
}

export interface StructuredLogger {
  trace(ctx: LogContext, msg: string): void;
  debug(ctx: LogContext, msg: string): void;
  info(ctx: LogContext, msg: string): void;
  warn(ctx: LogContext, msg: string): void;
  error(ctx: LogContext, msg: string): void;
  fatal(ctx: LogContext, msg: string): void;
  child(bindings: Record<string, unknown>): StructuredLogger;
}

export interface LoggingConfig {
  /** Log level */
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Pretty print in development */
  pretty: boolean;
  /** Include trace context automatically */
  includeTraceContext: boolean;
  /** Redact sensitive fields */
  redact: string[];
  /** Service name */
  serviceName: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LoggingConfig = {
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  includeTraceContext: true,
  redact: ['password', 'apiKey', 'secret', 'token', 'authorization'],
  serviceName: 'vorion',
};

// ============================================================================
// Trace Context Extraction
// ============================================================================

/**
 * Extract trace context from current OpenTelemetry context
 */
function extractTraceContext(): { traceId?: string; spanId?: string } {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return {};
  }

  const spanContext = activeSpan.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return {};
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

// ============================================================================
// Structured Logger Implementation
// ============================================================================

class StructuredLoggerImpl implements StructuredLogger {
  private logger: pino.Logger;
  private config: LoggingConfig;
  private bindings: Record<string, unknown>;

  constructor(config: LoggingConfig, bindings: Record<string, unknown> = {}) {
    this.config = config;
    this.bindings = bindings;

    const pinoConfig: pino.LoggerOptions = {
      level: config.level,
      redact: config.redact,
      base: {
        service: config.serviceName,
        ...bindings,
      },
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => bindings,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    if (config.pretty) {
      this.logger = pino({
        ...pinoConfig,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      });
    } else {
      this.logger = pino(pinoConfig);
    }
  }

  private enrichContext(ctx: LogContext): Record<string, unknown> {
    const enriched: Record<string, unknown> = { ...ctx };

    // Add trace context if enabled and not already present
    if (this.config.includeTraceContext && !ctx.traceId) {
      const traceCtx = extractTraceContext();
      if (traceCtx.traceId) {
        enriched.traceId = traceCtx.traceId;
        enriched.spanId = traceCtx.spanId;
      }
    }

    return enriched;
  }

  trace(ctx: LogContext, msg: string): void {
    this.logger.trace(this.enrichContext(ctx), msg);
  }

  debug(ctx: LogContext, msg: string): void {
    this.logger.debug(this.enrichContext(ctx), msg);
  }

  info(ctx: LogContext, msg: string): void {
    this.logger.info(this.enrichContext(ctx), msg);
  }

  warn(ctx: LogContext, msg: string): void {
    this.logger.warn(this.enrichContext(ctx), msg);
  }

  error(ctx: LogContext, msg: string): void {
    this.logger.error(this.enrichContext(ctx), msg);
  }

  fatal(ctx: LogContext, msg: string): void {
    this.logger.fatal(this.enrichContext(ctx), msg);
  }

  child(bindings: Record<string, unknown>): StructuredLogger {
    return new StructuredLoggerImpl(this.config, { ...this.bindings, ...bindings });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalLogger: StructuredLogger | null = null;
let globalConfig: LoggingConfig = DEFAULT_CONFIG;

/**
 * Initialize logging with configuration
 */
export function initLogging(config: Partial<LoggingConfig> = {}): StructuredLogger {
  globalConfig = { ...DEFAULT_CONFIG, ...config };
  globalLogger = new StructuredLoggerImpl(globalConfig);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): StructuredLogger {
  if (!globalLogger) {
    globalLogger = new StructuredLoggerImpl(globalConfig);
  }
  return globalLogger;
}

/**
 * Create a component-scoped logger
 */
export function createComponentLogger(component: string): StructuredLogger {
  const base = getLogger();
  return base.child({ component });
}

// ============================================================================
// Specialized Loggers
// ============================================================================

/**
 * Create an Agent Anchor logger with CAR context
 */
export function createAgentLogger(carId: string, tenantId: string): StructuredLogger {
  return getLogger().child({ carId, tenantId, component: 'agent-anchor' });
}

/**
 * Create an A2A logger with call chain context
 */
export function createA2ALogger(
  requestId: string,
  callerCarId: string,
  calleeCarId: string
): StructuredLogger {
  return getLogger().child({
    requestId,
    callerCarId,
    calleeCarId,
    component: 'a2a',
  });
}

/**
 * Create a sandbox logger with container context
 */
export function createSandboxLogger(
  containerId: string,
  carId: string,
  tier: number
): StructuredLogger {
  return getLogger().child({
    containerId,
    carId,
    tier,
    component: 'sandbox',
  });
}

// ============================================================================
// Log Helpers
// ============================================================================

/**
 * Log an agent lifecycle event
 */
export function logAgentEvent(
  logger: StructuredLogger,
  event: 'registered' | 'activated' | 'suspended' | 'revoked' | 'archived',
  carId: string,
  details?: Record<string, unknown>
): void {
  logger.info(
    { event: `agent.${event}`, carId, ...details },
    `Agent ${event}: ${carId}`
  );
}

/**
 * Log a trust score change
 */
export function logTrustChange(
  logger: StructuredLogger,
  carId: string,
  oldScore: number,
  newScore: number,
  oldTier: number,
  newTier: number,
  reason: string
): void {
  const tierChanged = oldTier !== newTier;
  const ctx: LogContext = {
    event: tierChanged ? 'trust.tier_change' : 'trust.score_change',
    carId,
    oldScore,
    newScore,
    oldTier,
    newTier,
    reason,
  };

  if (tierChanged) {
    logger.info(ctx, `Trust tier changed: ${carId} T${oldTier} -> T${newTier}`);
  } else {
    logger.debug(ctx, `Trust score updated: ${carId} ${oldScore} -> ${newScore}`);
  }
}

/**
 * Log an A2A invocation
 */
export function logA2AInvocation(
  logger: StructuredLogger,
  phase: 'start' | 'success' | 'failure' | 'timeout',
  callerCarId: string,
  calleeCarId: string,
  action: string,
  details?: Record<string, unknown>
): void {
  const ctx: LogContext = {
    event: `a2a.invoke.${phase}`,
    callerCarId,
    calleeCarId,
    action,
    ...details,
  };

  switch (phase) {
    case 'start':
      logger.info(ctx, `A2A invoke: ${callerCarId} -> ${calleeCarId}:${action}`);
      break;
    case 'success':
      logger.info(ctx, `A2A success: ${callerCarId} -> ${calleeCarId}:${action}`);
      break;
    case 'failure':
      logger.warn(ctx, `A2A failed: ${callerCarId} -> ${calleeCarId}:${action}`);
      break;
    case 'timeout':
      logger.warn(ctx, `A2A timeout: ${callerCarId} -> ${calleeCarId}:${action}`);
      break;
  }
}

/**
 * Log a sandbox event
 */
export function logSandboxEvent(
  logger: StructuredLogger,
  event: 'created' | 'started' | 'stopped' | 'destroyed' | 'violation',
  containerId: string,
  details?: Record<string, unknown>
): void {
  const ctx: LogContext = {
    event: `sandbox.${event}`,
    containerId,
    ...details,
  };

  if (event === 'violation') {
    logger.warn(ctx, `Sandbox violation: ${containerId}`);
  } else {
    logger.info(ctx, `Sandbox ${event}: ${containerId}`);
  }
}

/**
 * Log an attestation
 */
export function logAttestation(
  logger: StructuredLogger,
  type: string,
  carId: string,
  outcome: 'success' | 'failure',
  details?: Record<string, unknown>
): void {
  const ctx: LogContext = {
    event: 'attestation.recorded',
    type,
    carId,
    outcome,
    ...details,
  };

  logger.info(ctx, `Attestation recorded: ${type} for ${carId}`);
}
