/**
 * Operation Tracker Service
 *
 * Provides async operation tracking for bulk operations and GDPR requests.
 * Operations are stored in PostgreSQL with Redis-based progress caching.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { createLogger } from './logger.js';
import { getConfig, type Config } from './config.js';
import { getRedis } from './redis.js';
import { getDatabase } from './db.js';
import type { ID } from './types.js';
import {
  operations,
  type OperationType,
  type OperationStatus,
  type OperationRow,
} from '@vorionsys/contracts/db';

const logger = createLogger({ component: 'operation-tracker' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Async operation structure
 */
export interface AsyncOperation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  progress: {
    current: number;
    total: number;
  };
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Dependencies for OperationTrackerService
 */
export interface OperationTrackerDependencies {
  database?: NodePgDatabase;
  redis?: Redis;
  config?: Config;
}

/**
 * Options for creating an operation
 */
export interface CreateOperationOptions {
  type: OperationType;
  tenantId: ID;
  createdBy?: ID;
  metadata?: Record<string, unknown>;
  totalItems?: number;
}

// =============================================================================
// OPERATION TRACKER SERVICE
// =============================================================================

/**
 * Operation Tracker Service
 *
 * Tracks async operations with progress updates and result storage.
 * Uses PostgreSQL for persistence and Redis for fast progress lookups.
 */
export class OperationTrackerService {
  private db: NodePgDatabase;
  private redis: Redis;
  private config: Config;
  private readonly cachePrefix = 'operation:';
  private readonly progressPrefix = 'operation:progress:';
  private readonly cacheTtlSeconds = 3600; // 1 hour cache
  private readonly longPollTimeoutMs = 30000; // 30 seconds max wait

  constructor(deps: OperationTrackerDependencies = {}) {
    this.db = deps.database ?? getDatabase();
    this.redis = deps.redis ?? getRedis();
    this.config = deps.config ?? getConfig();
  }

  /**
   * Create a new async operation
   */
  async createOperation(options: CreateOperationOptions): Promise<string> {
    const operationId = randomUUID();
    const now = new Date();

    const [row] = await this.db
      .insert(operations)
      .values({
        id: operationId,
        tenantId: options.tenantId,
        type: options.type,
        status: 'pending',
        progressCurrent: 0,
        progressTotal: options.totalItems ?? 0,
        metadata: options.metadata ?? null,
        createdBy: options.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new Error('Failed to create operation');
    }

    // Initialize progress in Redis for fast lookups
    await this.redis.hset(this.progressPrefix + operationId, {
      current: '0',
      total: String(options.totalItems ?? 0),
      status: 'pending',
    });
    await this.redis.expire(this.progressPrefix + operationId, this.cacheTtlSeconds);

    logger.info(
      { operationId, type: options.type, tenantId: options.tenantId },
      'Operation created'
    );

    return operationId;
  }

  /**
   * Update operation progress
   */
  async updateProgress(
    operationId: ID,
    current: number,
    total: number
  ): Promise<void> {
    const now = new Date();

    // Update Redis first for fast reads
    await this.redis.hset(this.progressPrefix + operationId, {
      current: String(current),
      total: String(total),
      status: 'processing',
    });

    // Update database
    await this.db
      .update(operations)
      .set({
        status: 'processing',
        progressCurrent: current,
        progressTotal: total,
        updatedAt: now,
      })
      .where(eq(operations.id, operationId));

    // Publish progress update for long-polling
    await this.redis.publish(`operation:${operationId}:progress`, JSON.stringify({
      current,
      total,
      status: 'processing',
    }));

    logger.debug(
      { operationId, current, total },
      'Operation progress updated'
    );
  }

  /**
   * Mark operation as completed
   */
  async completeOperation(
    operationId: ID,
    result: unknown
  ): Promise<void> {
    const now = new Date();

    // Update Redis
    await this.redis.hset(this.progressPrefix + operationId, {
      status: 'completed',
    });

    // Update database
    await this.db
      .update(operations)
      .set({
        status: 'completed',
        result: result as Record<string, unknown>,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(operations.id, operationId));

    // Cache the completed operation
    const operation = await this.getOperationFromDb(operationId);
    if (operation) {
      await this.redis.set(
        this.cachePrefix + operationId,
        JSON.stringify(operation),
        'EX',
        this.cacheTtlSeconds
      );
    }

    // Publish completion event for long-polling
    await this.redis.publish(`operation:${operationId}:progress`, JSON.stringify({
      status: 'completed',
      result,
    }));

    logger.info(
      { operationId },
      'Operation completed'
    );
  }

  /**
   * Mark operation as failed
   */
  async failOperation(
    operationId: ID,
    error: string
  ): Promise<void> {
    const now = new Date();

    // Update Redis
    await this.redis.hset(this.progressPrefix + operationId, {
      status: 'failed',
      error,
    });

    // Update database
    await this.db
      .update(operations)
      .set({
        status: 'failed',
        error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(operations.id, operationId));

    // Publish failure event for long-polling
    await this.redis.publish(`operation:${operationId}:progress`, JSON.stringify({
      status: 'failed',
      error,
    }));

    logger.error(
      { operationId, error },
      'Operation failed'
    );
  }

  /**
   * Get operation by ID
   */
  async getOperation(
    operationId: ID,
    tenantId?: ID
  ): Promise<AsyncOperation | null> {
    // Try cache first
    const cached = await this.redis.get(this.cachePrefix + operationId);
    if (cached) {
      const operation = JSON.parse(cached) as AsyncOperation;
      return operation;
    }

    // Get from database
    const operation = await this.getOperationFromDb(operationId, tenantId);
    if (!operation) {
      return null;
    }

    // If completed, cache it
    if (operation.status === 'completed' || operation.status === 'failed') {
      await this.redis.set(
        this.cachePrefix + operationId,
        JSON.stringify(operation),
        'EX',
        this.cacheTtlSeconds
      );
    }

    return operation;
  }

  /**
   * Get operation with long-polling support
   *
   * If wait=true and operation is not completed, waits for completion
   * or timeout (whichever comes first).
   */
  async getOperationWithWait(
    operationId: ID,
    tenantId?: ID,
    wait: boolean = false,
    timeoutMs: number = 30000
  ): Promise<AsyncOperation | null> {
    const operation = await this.getOperation(operationId, tenantId);

    if (!operation) {
      return null;
    }

    // If not waiting or already complete, return immediately
    if (!wait || operation.status === 'completed' || operation.status === 'failed') {
      return operation;
    }

    // Long-poll for completion
    const effectiveTimeout = Math.min(timeoutMs, this.longPollTimeoutMs);

    return new Promise<AsyncOperation | null>((resolve) => {
      const channel = `operation:${operationId}:progress`;
      const subscriber = this.redis.duplicate();
      let resolved = false;

      const cleanup = async () => {
        if (!resolved) {
          resolved = true;
          try {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      // Set timeout
      const timer = setTimeout(async () => {
        await cleanup();
        // Return current state on timeout
        const currentOp = await this.getOperation(operationId, tenantId);
        resolve(currentOp);
      }, effectiveTimeout);

      // Subscribe to progress updates
      subscriber.subscribe(channel, async (err) => {
        if (err) {
          clearTimeout(timer);
          await cleanup();
          const currentOp = await this.getOperation(operationId, tenantId);
          resolve(currentOp);
          return;
        }
      });

      subscriber.on('message', async (_channel: string, message: string) => {
        try {
          const update = JSON.parse(message);
          if (update.status === 'completed' || update.status === 'failed') {
            clearTimeout(timer);
            await cleanup();
            const finalOp = await this.getOperation(operationId, tenantId);
            resolve(finalOp);
          }
        } catch {
          // Ignore parse errors
        }
      });
    });
  }

  /**
   * Get operation from database
   */
  private async getOperationFromDb(
    operationId: ID,
    tenantId?: ID
  ): Promise<AsyncOperation | null> {
    const conditions = [eq(operations.id, operationId)];
    if (tenantId) {
      conditions.push(eq(operations.tenantId, tenantId));
    }

    const [row] = await this.db
      .select()
      .from(operations)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .limit(1);

    if (!row) {
      return null;
    }

    return this.rowToOperation(row);
  }

  /**
   * Get fast progress from Redis
   * Falls back to database if not in cache
   */
  async getProgress(operationId: ID): Promise<{ current: number; total: number; status: OperationStatus } | null> {
    const progress = await this.redis.hgetall(this.progressPrefix + operationId);

    if (progress && progress.status) {
      return {
        current: parseInt(progress.current ?? '0', 10),
        total: parseInt(progress.total ?? '0', 10),
        status: progress.status as OperationStatus,
      };
    }

    // Fall back to database
    const operation = await this.getOperation(operationId);
    if (!operation) {
      return null;
    }

    return {
      current: operation.progress.current,
      total: operation.progress.total,
      status: operation.status,
    };
  }

  /**
   * Convert database row to AsyncOperation
   */
  private rowToOperation(row: OperationRow): AsyncOperation {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: {
        current: row.progressCurrent,
        total: row.progressTotal,
      },
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? undefined,
    };
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

let operationTrackerInstance: OperationTrackerService | null = null;

/**
 * Get or create the operation tracker service singleton
 */
export function getOperationTracker(): OperationTrackerService {
  if (!operationTrackerInstance) {
    operationTrackerInstance = new OperationTrackerService();
  }
  return operationTrackerInstance;
}

/**
 * Create a new operation tracker service instance
 */
export function createOperationTracker(
  deps: OperationTrackerDependencies = {}
): OperationTrackerService {
  return new OperationTrackerService(deps);
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a new async operation
 */
export async function createOperation(
  type: OperationType,
  tenantId: ID,
  metadata?: Record<string, unknown>
): Promise<string> {
  const tracker = getOperationTracker();
  return tracker.createOperation({ type, tenantId, metadata });
}

/**
 * Update operation progress
 */
export async function updateProgress(
  operationId: ID,
  current: number,
  total: number
): Promise<void> {
  const tracker = getOperationTracker();
  return tracker.updateProgress(operationId, current, total);
}

/**
 * Mark operation as completed
 */
export async function completeOperation(
  operationId: ID,
  result: unknown
): Promise<void> {
  const tracker = getOperationTracker();
  return tracker.completeOperation(operationId, result);
}

/**
 * Mark operation as failed
 */
export async function failOperation(
  operationId: ID,
  error: string
): Promise<void> {
  const tracker = getOperationTracker();
  return tracker.failOperation(operationId, error);
}

/**
 * Get operation by ID
 */
export async function getOperation(
  operationId: ID
): Promise<AsyncOperation | null> {
  const tracker = getOperationTracker();
  return tracker.getOperation(operationId);
}
