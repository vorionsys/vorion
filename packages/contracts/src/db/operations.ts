/**
 * Operations Schema
 *
 * Database schema for async operation tracking.
 * Used for bulk operations and GDPR requests.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * Operation type enum
 */
export const operationTypeEnum = pgEnum('operation_type', [
  'bulk_create',
  'bulk_archive',
  'bulk_approve',
  'bulk_reject',
  'gdpr_export',
  'gdpr_erase',
]);

/**
 * Operation status enum
 */
export const operationStatusEnum = pgEnum('operation_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

/**
 * Operations table
 */
export const operations = pgTable(
  'operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),

    // Operation details
    type: operationTypeEnum('type').notNull(),
    status: operationStatusEnum('status').notNull().default('pending'),

    // Progress tracking
    progressCurrent: integer('progress_current').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),

    // Result storage
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdBy: uuid('created_by'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdIdx: index('operations_tenant_id_idx').on(table.tenantId),
    typeIdx: index('operations_type_idx').on(table.type),
    statusIdx: index('operations_status_idx').on(table.status),
    createdAtIdx: index('operations_created_at_idx').on(table.createdAt),
    // Composite for tenant-scoped queries
    tenantStatusIdx: index('operations_tenant_status_idx').on(
      table.tenantId,
      table.status
    ),
    tenantTypeIdx: index('operations_tenant_type_idx').on(
      table.tenantId,
      table.type
    ),
  })
);

// Types
export type OperationRow = typeof operations.$inferSelect;
export type NewOperationRow = typeof operations.$inferInsert;
export type OperationType = 'bulk_create' | 'bulk_archive' | 'bulk_approve' | 'bulk_reject' | 'gdpr_export' | 'gdpr_erase';
export type OperationStatus = 'pending' | 'processing' | 'completed' | 'failed';
