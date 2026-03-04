/**
 * Compliance Audit Log Schema
 * Drizzle ORM schema for the compliance audit log table.
 *
 * Stores immutable audit events for SOC 2, HIPAA, and ISO 27001 compliance.
 * Hash-chained for tamper evidence and integrity verification.
 *
 * RETENTION: 7 years per regulatory requirements (SOC 2, HIPAA 164.530(j),
 * ISO 27001 A.5.33). Automated purge policies should respect this minimum.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from 'drizzle-orm/pg-core'

export const complianceAuditLogs = pgTable(
  'compliance_audit_logs',
  {
    id: text('id').primaryKey(), // App-generated audit_<ts>_<rand> format
    eventType: text('event_type').notNull(),
    entityId: text('entity_id').notNull(), // resourceId from the audit event
    entityType: text('entity_type').notNull(), // resourceType from the audit event
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    actorId: text('actor_id'), // userId or agentId
    actorType: text('actor_type'), // 'user', 'agent', or 'system'
    tenantId: text('tenant_id'), // Reserved for multi-tenant isolation
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    // Compliance-specific fields
    outcome: text('outcome').notNull(), // 'success', 'failure', 'denied', 'error'
    sensitivity: text('sensitivity').notNull(), // 'low', 'medium', 'high', 'critical'
    frameworks: jsonb('frameworks').$type<string[]>().notNull().default([]),
    controlIds: jsonb('control_ids').$type<string[]>().notNull().default([]),
    phiInvolved: boolean('phi_involved').notNull().default(false),

    // Integrity chain
    previousHash: text('previous_hash'),
    hash: text('hash').notNull(),

    // Record metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventTypeIdx: index('compliance_audit_logs_event_type_idx').on(table.eventType),
    entityIdx: index('compliance_audit_logs_entity_idx').on(table.entityType, table.entityId),
    actorIdx: index('compliance_audit_logs_actor_idx').on(table.actorType, table.actorId),
    tenantIdx: index('compliance_audit_logs_tenant_idx').on(table.tenantId),
    timestampIdx: index('compliance_audit_logs_timestamp_idx').on(table.timestamp),
    sensitivityIdx: index('compliance_audit_logs_sensitivity_idx').on(table.sensitivity),
    phiIdx: index('compliance_audit_logs_phi_idx').on(table.phiInvolved),
    hashIdx: index('compliance_audit_logs_hash_idx').on(table.hash),
  })
)

// Types
export type ComplianceAuditLogRecord = typeof complianceAuditLogs.$inferSelect
export type NewComplianceAuditLogRecord = typeof complianceAuditLogs.$inferInsert
