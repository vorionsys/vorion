/**
 * Service Accounts Schema
 *
 * Database schema for service-to-service authentication accounts
 * using Drizzle ORM.
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
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Service account status enum
 */
export const serviceAccountStatusEnum = pgEnum("service_account_status", [
  "active",
  "revoked",
  "suspended",
]);

// =============================================================================
// SERVICE ACCOUNTS TABLE
// =============================================================================

/**
 * Service accounts table - stores service account credentials and metadata
 */
export const serviceAccounts = pgTable(
  "service_accounts",
  {
    // Primary key
    id: uuid("id").primaryKey().defaultRandom(),

    // Unique client identifier (e.g., svc_abc123...)
    clientId: text("client_id").notNull().unique(),

    // Hashed client secret (SHA-256)
    clientSecret: text("client_secret").notNull(),

    // Human-readable name
    name: text("name").notNull(),

    // Description of the service
    description: text("description"),

    // Tenant ownership
    tenantId: uuid("tenant_id").notNull(),

    // Permissions granted to this service
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),

    // Optional IP whitelist for additional security
    ipWhitelist: jsonb("ip_whitelist").$type<string[]>(),

    // Status
    status: serviceAccountStatusEnum("status").notNull().default("active"),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),

    // User who created the account
    createdBy: text("created_by"),

    // Additional metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => ({
    // Unique constraint on client ID for fast lookup
    clientIdUniqueIdx: uniqueIndex("service_accounts_client_id_unique_idx").on(
      table.clientId,
    ),

    // Index by tenant for listing
    tenantIdIdx: index("service_accounts_tenant_id_idx").on(table.tenantId),

    // Composite index for listing with status filter
    tenantStatusIdx: index("service_accounts_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),

    // Index for status-based queries
    statusIdx: index("service_accounts_status_idx").on(table.status),

    // Index for finding accounts by name within tenant
    tenantNameIdx: index("service_accounts_tenant_name_idx").on(
      table.tenantId,
      table.name,
    ),

    // Index for audit: recently used accounts
    lastUsedAtIdx: index("service_accounts_last_used_at_idx").on(
      table.lastUsedAt,
    ),
  }),
);

// =============================================================================
// SERVICE ACCOUNT AUDIT LOG TABLE
// =============================================================================

/**
 * Service account audit event types
 */
export const serviceAccountAuditEventEnum = pgEnum(
  "service_account_audit_event",
  [
    "created",
    "updated",
    "revoked",
    "suspended",
    "reactivated",
    "deleted",
    "secret_rotated",
    "auth_success",
    "auth_failure",
    "permission_denied",
    "ip_blocked",
  ],
);

/**
 * Service account audit log table - tracks all changes to service accounts
 */
export const serviceAccountAuditLog = pgTable(
  "service_account_audit_log",
  {
    // Primary key
    id: uuid("id").primaryKey().defaultRandom(),

    // Reference to service account
    serviceAccountId: uuid("service_account_id").notNull(),

    // Client ID (stored separately for audit even if account deleted)
    clientId: text("client_id").notNull(),

    // Tenant ID (stored separately for audit)
    tenantId: uuid("tenant_id").notNull(),

    // Event type
    event: serviceAccountAuditEventEnum("event").notNull(),

    // Actor who performed the action (user ID or system)
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull().default("user"), // 'user', 'system', 'service'

    // Request context
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),

    // Event details
    details: jsonb("details").$type<Record<string, unknown>>().default({}),

    // Previous state (for updates)
    previousState: jsonb("previous_state").$type<Record<string, unknown>>(),

    // New state (for updates)
    newState: jsonb("new_state").$type<Record<string, unknown>>(),

    // Timestamp
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Index for looking up audit by service account
    serviceAccountIdIdx: index(
      "service_account_audit_service_account_id_idx",
    ).on(table.serviceAccountId),

    // Index for looking up audit by client ID (even after deletion)
    clientIdIdx: index("service_account_audit_client_id_idx").on(
      table.clientId,
    ),

    // Index for tenant-wide audit queries
    tenantIdIdx: index("service_account_audit_tenant_id_idx").on(
      table.tenantId,
    ),

    // Index for filtering by event type
    eventIdx: index("service_account_audit_event_idx").on(table.event),

    // Index for time-based queries
    timestampIdx: index("service_account_audit_timestamp_idx").on(
      table.timestamp,
    ),

    // Composite for tenant + time range queries
    tenantTimestampIdx: index("service_account_audit_tenant_timestamp_idx").on(
      table.tenantId,
      table.timestamp,
    ),

    // Composite for service account + event queries
    serviceAccountEventIdx: index("service_account_audit_sa_event_idx").on(
      table.serviceAccountId,
      table.event,
    ),
  }),
);

// =============================================================================
// SERVICE TOKENS TABLE (Optional - for token tracking/revocation)
// =============================================================================

/**
 * Service tokens table - tracks issued service tokens for revocation support
 * Optional: Only needed if you want to track and revoke individual tokens
 */
export const serviceTokens = pgTable(
  "service_tokens",
  {
    // Primary key - the JWT ID (jti)
    id: uuid("id").primaryKey().defaultRandom(),

    // JWT ID for lookup
    jti: text("jti").notNull().unique(),

    // Reference to service account
    serviceAccountId: uuid("service_account_id")
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: "cascade" }),

    // Client ID (for queries after account deletion)
    clientId: text("client_id").notNull(),

    // Tenant ID
    tenantId: uuid("tenant_id").notNull(),

    // Token metadata
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Revocation status
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    revokedReason: text("revoked_reason"),

    // Request context at issuance
    issuedIp: text("issued_ip"),
    issuedUserAgent: text("issued_user_agent"),
  },
  (table) => ({
    // Unique index on JTI for fast lookup
    jtiUniqueIdx: uniqueIndex("service_tokens_jti_unique_idx").on(table.jti),

    // Index for service account token queries
    serviceAccountIdIdx: index("service_tokens_service_account_id_idx").on(
      table.serviceAccountId,
    ),

    // Index for tenant queries
    tenantIdIdx: index("service_tokens_tenant_id_idx").on(table.tenantId),

    // Index for expiration cleanup
    expiresAtIdx: index("service_tokens_expires_at_idx").on(table.expiresAt),

    // Index for revocation queries
    revokedAtIdx: index("service_tokens_revoked_at_idx").on(table.revokedAt),

    // Composite for finding active tokens
    activeTokensIdx: index("service_tokens_active_idx").on(
      table.serviceAccountId,
      table.expiresAt,
      table.revokedAt,
    ),
  }),
);

// =============================================================================
// TYPE INFERENCE
// =============================================================================

export type ServiceAccountRecord = typeof serviceAccounts.$inferSelect;
export type NewServiceAccountRecord = typeof serviceAccounts.$inferInsert;

export type ServiceAccountAuditLogRecord =
  typeof serviceAccountAuditLog.$inferSelect;
export type NewServiceAccountAuditLogRecord =
  typeof serviceAccountAuditLog.$inferInsert;

export type ServiceTokenRecord = typeof serviceTokens.$inferSelect;
export type NewServiceTokenRecord = typeof serviceTokens.$inferInsert;

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Service account with relations
 */
export interface ServiceAccountWithAudit extends ServiceAccountRecord {
  auditLog?: ServiceAccountAuditLogRecord[];
  activeTokenCount?: number;
}

/**
 * Service account list filters
 */
export interface ServiceAccountListFilters {
  tenantId?: string;
  status?: "active" | "revoked" | "suspended";
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  lastUsedAfter?: Date;
  lastUsedBefore?: Date;
  limit?: number;
  offset?: number;
  orderBy?: "name" | "createdAt" | "lastUsedAt";
  orderDir?: "asc" | "desc";
}

/**
 * Service account audit filters
 */
export interface ServiceAccountAuditFilters {
  serviceAccountId?: string;
  clientId?: string;
  tenantId?: string;
  event?: ServiceAccountAuditLogRecord["event"];
  actorId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}
