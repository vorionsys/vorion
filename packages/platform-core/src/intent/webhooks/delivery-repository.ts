/**
 * Webhook Delivery Repository
 *
 * Repository for managing webhook delivery persistence.
 * Provides CRUD operations for webhook delivery records.
 *
 * @packageDocumentation
 */

import { and, desc, eq, lt, lte } from 'drizzle-orm';
import { createLogger } from '../../common/logger.js';
import { getDatabase } from '../../common/db.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import type { ID } from '../../common/types.js';
import {
  webhookDeliveries,
  type WebhookDeliveryRow,
  type NewWebhookDeliveryRow,
} from '../schema.js';
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  CreateDeliveryOptions,
  UpdateDeliveryStatusOptions,
} from './types.js';

const logger = createLogger({ component: 'webhook-delivery-repository' });

/**
 * Default page size for delivery history queries
 */
const DEFAULT_DELIVERY_PAGE_SIZE = 50;

/**
 * Maximum page size for delivery history queries
 */
const MAX_DELIVERY_PAGE_SIZE = 100;

/**
 * Map database row to WebhookDelivery
 */
function mapDeliveryRow(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhookId,
    tenantId: row.tenantId,
    eventType: row.eventType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastError: row.lastError ?? null,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Calculate next retry time with exponential backoff.
 *
 * Uses the formula: baseDelay * 2^(attempt - 1)
 * With a maximum delay cap to prevent extremely long waits.
 *
 * @param attempt - Current attempt number (1-based)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param maxDelayMs - Maximum delay cap in milliseconds (default: 1 hour)
 * @returns Date when next retry should occur
 */
export function calculateNextRetryTime(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 3600000 // 1 hour
): Date {
  const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  return new Date(Date.now() + delayMs);
}

/**
 * Repository for managing webhook delivery persistence.
 */
export class WebhookDeliveryRepository {
  private _db: ReturnType<typeof getDatabase> | null = null;

  /**
   * Get database instance (lazy initialization).
   */
  private get db(): ReturnType<typeof getDatabase> {
    if (!this._db) {
      this._db = getDatabase();
    }
    return this._db;
  }

  /**
   * Create a new delivery record.
   */
  async createDelivery(data: CreateDeliveryOptions): Promise<WebhookDelivery> {
    const insertData: NewWebhookDeliveryRow = {
      webhookId: data.webhookId,
      tenantId: data.tenantId,
      eventType: data.eventType,
      payload: data.payload,
      status: 'pending',
      attempts: 0,
    };

    const [row] = await this.db
      .insert(webhookDeliveries)
      .values(insertData)
      .returning();

    if (!row) {
      throw new Error('Failed to create webhook delivery record');
    }

    logger.info(
      { deliveryId: row.id, webhookId: data.webhookId, tenantId: data.tenantId, eventType: data.eventType },
      'Created webhook delivery record'
    );

    return mapDeliveryRow(row);
  }

  /**
   * Update delivery status with details.
   */
  async updateDeliveryStatus(
    id: ID,
    options: UpdateDeliveryStatusOptions
  ): Promise<WebhookDelivery> {
    const updateData: Partial<WebhookDeliveryRow> = {
      status: options.status,
    };

    if (options.attempts !== undefined) {
      updateData.attempts = options.attempts;
    }
    if (options.lastAttemptAt !== undefined) {
      updateData.lastAttemptAt = options.lastAttemptAt;
    }
    if (options.lastError !== undefined) {
      updateData.lastError = options.lastError;
    }
    if (options.nextRetryAt !== undefined) {
      updateData.nextRetryAt = options.nextRetryAt;
    }
    if (options.deliveredAt !== undefined) {
      updateData.deliveredAt = options.deliveredAt;
    }
    if (options.responseStatus !== undefined) {
      updateData.responseStatus = options.responseStatus;
    }
    if (options.responseBody !== undefined) {
      updateData.responseBody = options.responseBody;
    }

    const [row] = await this.db
      .update(webhookDeliveries)
      .set(updateData)
      .where(eq(webhookDeliveries.id, id))
      .returning();

    if (!row) {
      throw new NotFoundError(`Webhook delivery not found: ${id}`);
    }

    logger.debug(
      { deliveryId: id, status: options.status, attempts: options.attempts },
      'Updated webhook delivery status'
    );

    return mapDeliveryRow(row);
  }

  /**
   * Get delivery by ID.
   */
  async getDeliveryById(id: ID): Promise<WebhookDelivery | null> {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id));

    return row ? mapDeliveryRow(row) : null;
  }

  /**
   * Get delivery history for a webhook.
   */
  async getDeliveryHistory(
    webhookId: ID,
    limit: number = DEFAULT_DELIVERY_PAGE_SIZE
  ): Promise<WebhookDelivery[]> {
    const effectiveLimit = Math.min(limit, MAX_DELIVERY_PAGE_SIZE);

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(effectiveLimit);

    return rows.map(mapDeliveryRow);
  }

  /**
   * Get pending retries that are due for processing.
   */
  async getPendingRetries(limit: number = 100): Promise<WebhookDelivery[]> {
    const now = new Date();

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, 'retrying'),
          lte(webhookDeliveries.nextRetryAt, now)
        )
      )
      .orderBy(webhookDeliveries.nextRetryAt)
      .limit(limit);

    return rows.map(mapDeliveryRow);
  }

  /**
   * Get failed deliveries for a tenant.
   */
  async getFailedDeliveries(
    tenantId: ID,
    limit: number = DEFAULT_DELIVERY_PAGE_SIZE
  ): Promise<WebhookDelivery[]> {
    const effectiveLimit = Math.min(limit, MAX_DELIVERY_PAGE_SIZE);

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.tenantId, tenantId),
          eq(webhookDeliveries.status, 'failed')
        )
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(effectiveLimit);

    return rows.map(mapDeliveryRow);
  }

  /**
   * Get deliveries by tenant with pagination.
   */
  async getDeliveriesByTenant(
    tenantId: ID,
    options: {
      limit?: number;
      offset?: number;
      status?: WebhookDeliveryStatus;
    } = {}
  ): Promise<{ items: WebhookDelivery[]; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? DEFAULT_DELIVERY_PAGE_SIZE, MAX_DELIVERY_PAGE_SIZE);
    const offset = options.offset ?? 0;

    const whereConditions = [eq(webhookDeliveries.tenantId, tenantId)];
    if (options.status) {
      whereConditions.push(eq(webhookDeliveries.status, options.status));
    }

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(...whereConditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map(mapDeliveryRow),
      hasMore,
    };
  }

  /**
   * Mark a delivery for immediate replay.
   */
  async markForReplay(id: ID): Promise<WebhookDelivery> {
    const delivery = await this.getDeliveryById(id);
    if (!delivery) {
      throw new NotFoundError(`Webhook delivery not found: ${id}`);
    }

    // Only allow replay of failed deliveries
    if (delivery.status !== 'failed') {
      throw new ValidationError(
        `Cannot replay delivery with status '${delivery.status}'. Only failed deliveries can be replayed.`,
        { deliveryId: id, currentStatus: delivery.status }
      );
    }

    const updatedDelivery = await this.updateDeliveryStatus(id, {
      status: 'retrying',
      nextRetryAt: new Date(), // Immediate retry
      lastError: null, // Clear last error for retry
    });

    logger.info(
      { deliveryId: id, webhookId: delivery.webhookId, tenantId: delivery.tenantId },
      'Marked webhook delivery for replay'
    );

    return updatedDelivery;
  }

  /**
   * Clean up old delivery records.
   */
  async cleanupOldDeliveries(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.createdAt, cutoffDate))
      .returning({ id: webhookDeliveries.id });

    const deletedCount = result.length;

    if (deletedCount > 0) {
      logger.info(
        { deletedCount, retentionDays, cutoffDate: cutoffDate.toISOString() },
        'Cleaned up old webhook delivery records'
      );
    }

    return deletedCount;
  }
}

/**
 * Create webhook delivery repository instance
 */
export function createWebhookDeliveryRepository(): WebhookDeliveryRepository {
  return new WebhookDeliveryRepository();
}
