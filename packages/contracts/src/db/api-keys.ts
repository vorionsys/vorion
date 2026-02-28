/**
 * API Keys Schema
 *
 * Database schema for API key storage using Drizzle ORM.
 * Includes tables for API keys and rate limit state tracking.
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
  integer,
  bigint,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * API key status enum
 */
export const apiKeyStatusEnum = pgEnum("api_key_status", [
  "active",
  "revoked",
  "expired",
]);

// =============================================================================
// API KEYS TABLE
// =============================================================================

/**
 * API keys table - stores API key records with all metadata
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    // Primary key
    id: uuid("id").primaryKey().defaultRandom(),

    // Key identification
    name: text("name").notNull(),
    prefix: text("prefix").notNull().unique(), // First 8 chars for lookup
    hashedKey: text("hashed_key").notNull(), // SHA-256 hash for validation

    // Ownership
    tenantId: text("tenant_id").notNull(),
    createdBy: text("created_by").notNull(),

    // Permissions
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    // Rate limiting configuration
    rateLimitRequestsPerMinute: integer("rate_limit_requests_per_minute")
      .notNull()
      .default(60),
    rateLimitRequestsPerHour: integer("rate_limit_requests_per_hour")
      .notNull()
      .default(1000),
    rateLimitBurstLimit: integer("rate_limit_burst_limit")
      .notNull()
      .default(10),

    // Status
    status: apiKeyStatusEnum("status").notNull().default("active"),

    // Timestamps
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    // Additional configuration
    description: text("description"),
    allowedIps: jsonb("allowed_ips").$type<string[]>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => ({
    // Index by prefix for fast lookup during validation
    prefixIdx: index("api_keys_prefix_idx").on(table.prefix),
    // Index by tenant for listing keys
    tenantIdIdx: index("api_keys_tenant_id_idx").on(table.tenantId),
    // Composite index for listing with status filter
    tenantStatusIdx: index("api_keys_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
    // Index by creator for filtering
    createdByIdx: index("api_keys_created_by_idx").on(table.createdBy),
    // Index for expiration checks
    expiresAtIdx: index("api_keys_expires_at_idx").on(table.expiresAt),
    // Index for status-based queries
    statusIdx: index("api_keys_status_idx").on(table.status),
  }),
);

// =============================================================================
// RATE LIMIT STATE TABLE
// =============================================================================

/**
 * Rate limit state table - tracks rate limiting state per API key
 *
 * Note: This is designed for database persistence when Redis is unavailable.
 * For high-performance rate limiting, Redis should be preferred.
 * This table includes TTL-based cleanup support.
 */
export const apiKeyRateLimits = pgTable(
  "api_key_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Key reference
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),

    // Second window (burst limiting)
    secondCount: integer("second_count").notNull().default(0),
    secondResetAt: bigint("second_reset_at", { mode: "number" }).notNull(),

    // Minute window
    minuteCount: integer("minute_count").notNull().default(0),
    minuteResetAt: bigint("minute_reset_at", { mode: "number" }).notNull(),

    // Hour window
    hourCount: integer("hour_count").notNull().default(0),
    hourResetAt: bigint("hour_reset_at", { mode: "number" }).notNull(),

    // TTL for cleanup - records older than this can be purged
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Last update timestamp
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Unique constraint on keyId - one rate limit record per key
    keyIdUniqueIdx: uniqueIndex("api_key_rate_limits_key_id_unique_idx").on(
      table.keyId,
    ),
    // Index for TTL-based cleanup
    expiresAtIdx: index("api_key_rate_limits_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

// =============================================================================
// TYPE INFERENCE
// =============================================================================

export type ApiKeyRecord = typeof apiKeys.$inferSelect;
export type NewApiKeyRecord = typeof apiKeys.$inferInsert;
export type ApiKeyRateLimitRecord = typeof apiKeyRateLimits.$inferSelect;
export type NewApiKeyRateLimitRecord = typeof apiKeyRateLimits.$inferInsert;
