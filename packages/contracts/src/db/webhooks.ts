/**
 * Webhook Database Schema
 *
 * Defines the database schema for webhook configurations including
 * secret management for request signing.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Webhook configurations table
 *
 * Stores webhook endpoint configurations including:
 * - URL and event subscriptions
 * - Secret hash for HMAC signing (not stored in plaintext)
 * - Secret rotation tracking
 * - SSRF protection via resolved IP pinning
 */
export const webhookConfigs = pgTable(
  "webhook_configs",
  {
    /** Unique webhook identifier */
    id: uuid("id").primaryKey().defaultRandom(),

    /** Tenant ID for multi-tenant isolation */
    tenantId: text("tenant_id").notNull(),

    /** Webhook endpoint URL */
    url: text("url").notNull(),

    /**
     * Hashed webhook secret for signature verification.
     * The actual secret is only returned once on creation/rotation.
     * Stored as SHA-256 hash for verification purposes.
     */
    secretHash: text("secret_hash").notNull(),

    /**
     * Secret ID prefix shown to users (e.g., "whsec_abc...xyz").
     * Allows users to identify which secret is in use without exposing it.
     */
    secretPrefix: text("secret_prefix").notNull(),

    /** Whether the webhook is enabled for delivery */
    enabled: boolean("enabled").notNull().default(true),

    /** Array of event types this webhook subscribes to */
    events: jsonb("events").notNull().$type<string[]>(),

    /** Number of retry attempts for failed deliveries */
    retryAttempts: text("retry_attempts"),

    /** Delay between retry attempts in milliseconds */
    retryDelayMs: text("retry_delay_ms"),

    /**
     * Resolved IP address at registration time for DNS pinning.
     * Prevents DNS rebinding attacks.
     */
    resolvedIp: text("resolved_ip"),

    /** Timestamp of last secret rotation */
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),

    /** Created timestamp */
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** Updated timestamp */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** Index for efficient tenant-scoped queries */
    tenantIdx: index("webhook_configs_tenant_idx").on(table.tenantId),

    /** Index for finding webhooks by tenant and enabled status */
    tenantEnabledIdx: index("webhook_configs_tenant_enabled_idx").on(
      table.tenantId,
      table.enabled,
    ),

    /** Unique constraint: only one webhook per URL per tenant */
    tenantUrlUnique: uniqueIndex("webhook_configs_tenant_url_unique").on(
      table.tenantId,
      table.url,
    ),
  }),
);

/**
 * Webhook secret rotation history for audit purposes.
 * Tracks when secrets were rotated and by whom.
 */
export const webhookSecretRotations = pgTable(
  "webhook_secret_rotations",
  {
    /** Unique rotation record identifier */
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the webhook */
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhookConfigs.id, { onDelete: "cascade" }),

    /** Tenant ID for multi-tenant isolation */
    tenantId: text("tenant_id").notNull(),

    /** User ID who performed the rotation (if applicable) */
    rotatedBy: text("rotated_by"),

    /** Previous secret hash (for audit trail) */
    previousSecretHash: text("previous_secret_hash"),

    /** Reason for rotation */
    reason: text("reason"),

    /** Timestamp of rotation */
    rotatedAt: timestamp("rotated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** Index for efficient webhook history queries */
    webhookIdx: index("webhook_secret_rotations_webhook_idx").on(
      table.webhookId,
    ),

    /** Index for tenant-scoped audit queries */
    tenantIdx: index("webhook_secret_rotations_tenant_idx").on(table.tenantId),
  }),
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type WebhookConfigRow = typeof webhookConfigs.$inferSelect;
export type NewWebhookConfigRow = typeof webhookConfigs.$inferInsert;
export type WebhookSecretRotationRow =
  typeof webhookSecretRotations.$inferSelect;
export type NewWebhookSecretRotationRow =
  typeof webhookSecretRotations.$inferInsert;
