/**
 * Vorion Security SDK - @AuditLog Decorator
 * Audit logging for method invocations
 */

import 'reflect-metadata';
import { AuditLogOptions, EvaluationContext, AuditLogEntry } from '../types';
import { getSecurityContext } from './secured';

// ============================================================================
// Audit Logger Interface
// ============================================================================

export interface AuditLogger {
  /**
   * Log an audit entry
   */
  log(entry: AuditLogEntry): Promise<void>;

  /**
   * Query audit logs
   */
  query(options: AuditQueryOptions): Promise<AuditLogEntry[]>;

  /**
   * Flush pending logs
   */
  flush(): Promise<void>;
}

export interface AuditQueryOptions {
  startTime?: Date;
  endTime?: Date;
  userId?: string;
  action?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Console Audit Logger
// ============================================================================

/**
 * Simple console-based audit logger for development
 */
export class ConsoleAuditLogger implements AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs: number;

  constructor(maxLogs: number = 1000) {
    this.maxLogs = maxLogs;
  }

  async log(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    const levelColor = this.getLevelColor(entry);
    console.log(
      `${levelColor}[AUDIT] ${entry.timestamp.toISOString()} | ${entry.action} | ` +
        `User: ${entry.userId || 'anonymous'} | Outcome: ${entry.outcome}` +
        `${entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : ''}\x1b[0m`
    );
  }

  private getLevelColor(entry: AuditLogEntry): string {
    switch (entry.outcome) {
      case 'deny':
        return '\x1b[31m'; // Red
      case 'challenge':
        return '\x1b[33m'; // Yellow
      case 'allow':
        return '\x1b[32m'; // Green
      default:
        return '\x1b[36m'; // Cyan
    }
  }

  async query(options: AuditQueryOptions): Promise<AuditLogEntry[]> {
    let results = [...this.logs];

    if (options.startTime) {
      results = results.filter((e) => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter((e) => e.timestamp <= options.endTime!);
    }
    if (options.userId) {
      results = results.filter((e) => e.userId === options.userId);
    }
    if (options.action) {
      results = results.filter((e) => e.action === options.action);
    }
    if (options.outcome) {
      results = results.filter((e) => e.outcome === options.outcome);
    }

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async flush(): Promise<void> {
    // No-op for console logger
  }

  clear(): void {
    this.logs = [];
  }
}

// ============================================================================
// Buffered Audit Logger
// ============================================================================

/**
 * Buffered audit logger that batches writes
 */
export class BufferedAuditLogger implements AuditLogger {
  private buffer: AuditLogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private destination: AuditLogger;
  private bufferSize: number;
  private flushIntervalMs: number;

  constructor(
    destination: AuditLogger,
    options: { bufferSize?: number; flushIntervalMs?: number } = {}
  ) {
    this.destination = destination;
    this.bufferSize = options.bufferSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 5000;

    this.startFlushInterval();
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);
  }

  async log(entry: AuditLogEntry): Promise<void> {
    this.buffer.push(entry);

    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  async query(options: AuditQueryOptions): Promise<AuditLogEntry[]> {
    // Flush first to ensure all logs are queryable
    await this.flush();
    return this.destination.query(options);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    for (const entry of entries) {
      await this.destination.log(entry);
    }

    await this.destination.flush();
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}

// ============================================================================
// SIEM Audit Logger
// ============================================================================

export interface SIEMConfig {
  endpoint: string;
  apiKey?: string;
  format: 'json' | 'cef' | 'leef';
  batchSize?: number;
}

/**
 * SIEM-compatible audit logger
 */
export class SIEMAuditLogger implements AuditLogger {
  private config: SIEMConfig;
  private buffer: AuditLogEntry[] = [];

  constructor(config: SIEMConfig) {
    this.config = {
      batchSize: 100,
      ...config,
    };
  }

  async log(entry: AuditLogEntry): Promise<void> {
    this.buffer.push(entry);

    if (this.buffer.length >= (this.config.batchSize || 100)) {
      await this.flush();
    }
  }

  async query(_options: AuditQueryOptions): Promise<AuditLogEntry[]> {
    // SIEM doesn't support direct queries from the client
    console.warn('SIEM logger does not support direct queries. Use SIEM console.');
    return [];
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    const payload = entries.map((entry) => this.formatEntry(entry));

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to send logs to SIEM: ${response.status}`);
        // Re-buffer failed entries
        this.buffer.unshift(...entries);
      }
    } catch (error) {
      console.error('Error sending logs to SIEM:', error);
      // Re-buffer failed entries
      this.buffer.unshift(...entries);
    }
  }

  private formatEntry(entry: AuditLogEntry): unknown {
    switch (this.config.format) {
      case 'cef':
        return this.formatCEF(entry);
      case 'leef':
        return this.formatLEEF(entry);
      default:
        return entry;
    }
  }

  private formatCEF(entry: AuditLogEntry): string {
    // Common Event Format
    const severity = this.getSeverity(entry);
    return `CEF:0|Vorion|SecuritySDK|1.0|${entry.action}|${entry.action}|${severity}|` +
      `src=${entry.context?.request?.ip || 'unknown'} ` +
      `suser=${entry.userId || 'anonymous'} ` +
      `outcome=${entry.outcome} ` +
      `rt=${entry.timestamp.getTime()}`;
  }

  private formatLEEF(entry: AuditLogEntry): string {
    // Log Event Extended Format
    return `LEEF:1.0|Vorion|SecuritySDK|1.0|${entry.action}|` +
      `src=${entry.context?.request?.ip || 'unknown'}\t` +
      `usrName=${entry.userId || 'anonymous'}\t` +
      `outcome=${entry.outcome}\t` +
      `devTime=${entry.timestamp.toISOString()}`;
  }

  private getSeverity(entry: AuditLogEntry): number {
    switch (entry.outcome) {
      case 'deny':
        return 7;
      case 'challenge':
        return 5;
      case 'audit':
        return 3;
      default:
        return 1;
    }
  }
}

// ============================================================================
// Global Audit Logger Configuration
// ============================================================================

let globalAuditLogger: AuditLogger = new ConsoleAuditLogger();

/**
 * Configure the global audit logger
 */
export function setAuditLogger(logger: AuditLogger): void {
  globalAuditLogger = logger;
}

/**
 * Get the global audit logger
 */
export function getAuditLogger(): AuditLogger {
  return globalAuditLogger;
}

// ============================================================================
// Metadata Storage
// ============================================================================

const AUDIT_LOG_METADATA_KEY = Symbol('vorion:auditLog');

// ============================================================================
// Field Redaction
// ============================================================================

/**
 * Redact sensitive fields from an object
 */
function redactFields(obj: unknown, fieldsToRedact: string[]): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactFields(item, fieldsToRedact));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (fieldsToRedact.includes(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactFields(value, fieldsToRedact);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============================================================================
// @AuditLog Decorator
// ============================================================================

/**
 * @AuditLog decorator for logging method invocations
 *
 * @example
 * class UserController {
 *   @AuditLog({ level: 'standard' })
 *   async getUser(id: string) {}
 *
 *   @AuditLog({
 *     level: 'detailed',
 *     includeRequest: true,
 *     redactFields: ['password', 'token']
 *   })
 *   async updateUser(id: string, data: UpdateUserDto) {}
 *
 *   @AuditLog({
 *     level: 'full',
 *     includeRequest: true,
 *     includeResponse: true,
 *     destination: 'siem'
 *   })
 *   async deleteUser(id: string) {}
 * }
 */
export function AuditLog(options: AuditLogOptions): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const methodName = String(propertyKey);
    const className = target.constructor.name;
    const originalMethod = descriptor.value;

    // Store metadata
    Reflect.defineMetadata(
      AUDIT_LOG_METADATA_KEY,
      { options },
      target,
      propertyKey
    );

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const startTime = Date.now();
      let context: EvaluationContext;
      let result: unknown;
      let error: Error | null = null;

      try {
        context = await getSecurityContext();
      } catch {
        context = {
          user: { id: 'unknown' },
          request: { ip: 'unknown' },
        };
      }

      try {
        result = await originalMethod.apply(this, args);
        return result;
      } catch (err) {
        error = err as Error;
        throw err;
      } finally {
        const duration = Date.now() - startTime;

        const entry = createAuditEntry(
          context,
          options,
          {
            className,
            methodName,
            args,
            result,
            error,
            duration,
          }
        );

        await globalAuditLogger.log(entry);
      }
    };

    return descriptor;
  };
}

function createAuditEntry(
  context: EvaluationContext,
  options: AuditLogOptions,
  invocation: {
    className: string;
    methodName: string;
    args: unknown[];
    result: unknown;
    error: Error | null;
    duration: number;
  }
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: generateAuditId(),
    timestamp: new Date(),
    policyId: `audit:${invocation.className}.${invocation.methodName}`,
    userId: context.user.id,
    action: `${invocation.className}.${invocation.methodName}`,
    outcome: invocation.error ? 'deny' : 'allow',
    context: {},
    metadata: {
      duration: invocation.duration,
      ...options.customFields,
    },
  };

  // Add context based on level
  switch (options.level) {
    case 'full':
      entry.context = context;
      if (options.includeRequest) {
        entry.metadata!.request = {
          args: redactFields(invocation.args, options.redactFields || []),
        };
      }
      if (options.includeResponse && !invocation.error) {
        entry.metadata!.response = redactFields(
          invocation.result,
          options.redactFields || []
        );
      }
      if (invocation.error) {
        entry.metadata!.error = {
          name: invocation.error.name,
          message: invocation.error.message,
          stack: invocation.error.stack,
        };
      }
      break;

    case 'detailed':
      entry.context = {
        user: context.user,
        request: {
          ip: context.request.ip,
          method: context.request.method,
          path: context.request.path,
        },
      };
      if (options.includeRequest) {
        entry.metadata!.request = {
          args: redactFields(invocation.args, options.redactFields || []),
        };
      }
      if (invocation.error) {
        entry.metadata!.error = {
          name: invocation.error.name,
          message: invocation.error.message,
        };
      }
      break;

    case 'standard':
      entry.context = {
        user: { id: context.user.id },
        request: { ip: context.request.ip },
      };
      if (invocation.error) {
        entry.metadata!.error = {
          message: invocation.error.message,
        };
      }
      break;

    case 'minimal':
    default:
      // No additional context
      break;
  }

  return entry;
}

function generateAuditId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get audit log options for a method
 */
export function getAuditLogOptions(
  target: object,
  methodName: string
): AuditLogOptions | undefined {
  const metadata = Reflect.getMetadata(
    AUDIT_LOG_METADATA_KEY,
    target,
    methodName
  ) as { options: AuditLogOptions } | undefined;

  return metadata?.options;
}

/**
 * Query audit logs
 */
export async function queryAuditLogs(
  options: AuditQueryOptions
): Promise<AuditLogEntry[]> {
  return globalAuditLogger.query(options);
}

/**
 * Flush pending audit logs
 */
export async function flushAuditLogs(): Promise<void> {
  return globalAuditLogger.flush();
}

/**
 * Create a manual audit log entry
 */
export async function audit(
  action: string,
  options: {
    userId?: string;
    outcome?: 'allow' | 'deny' | 'challenge' | 'audit';
    metadata?: Record<string, unknown>;
    context?: Partial<EvaluationContext>;
  } = {}
): Promise<void> {
  const entry: AuditLogEntry = {
    id: generateAuditId(),
    timestamp: new Date(),
    policyId: 'manual-audit',
    userId: options.userId,
    action,
    outcome: options.outcome || 'audit',
    context: options.context || {},
    metadata: options.metadata,
  };

  await globalAuditLogger.log(entry);
}
