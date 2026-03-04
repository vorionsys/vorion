/**
 * User Credentials Schema
 *
 * Database schema for user authentication credentials using Drizzle ORM.
 * Stores password hashes, account status, and login attempt tracking.
 *
 * Security considerations:
 * - Passwords are stored as Argon2id hashes (never plaintext)
 * - Login attempt tracking enables brute-force detection at the DB level
 * - Account locking is tracked for progressive lockout enforcement
 * - MFA readiness flag supports future multi-factor authentication flow
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// =============================================================================
// ENUMS
// =============================================================================

/**
 * User account status enum
 */
export const userAccountStatusEnum = pgEnum('user_account_status', [
  'active',
  'locked',
  'suspended',
  'disabled',
  'pending_verification',
]);

// =============================================================================
// USER CREDENTIALS TABLE
// =============================================================================

/**
 * User credentials table - stores authentication credentials and account state
 *
 * This table is deliberately separate from any "user profile" table to enforce
 * separation of concerns: authentication data lives here, profile/display data
 * lives elsewhere.
 */
export const userCredentials = pgTable(
  'user_credentials',
  {
    // Primary key
    id: uuid('id').primaryKey().defaultRandom(),

    // Unique user identifier (matches JWT sub claim)
    userId: uuid('user_id').notNull().unique(),

    // Tenant the user belongs to
    tenantId: uuid('tenant_id').notNull(),

    // Email for credential lookup (login identifier)
    email: text('email').notNull(),

    // Argon2id password hash (from password-hashing.ts)
    passwordHash: text('password_hash').notNull(),

    // Account status
    status: userAccountStatusEnum('status').notNull().default('active'),

    // MFA enrollment flag (true = MFA is required/enabled for this user)
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),

    // Login attempt tracking (DB-level, complementing Redis-based brute-force)
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lastFailedLoginAt: timestamp('last_failed_login_at', { withTimezone: true }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    // Password lifecycle
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),

    // Timestamps
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Fast lookup by userId (most common query path for password verification)
    userIdUniqueIdx: uniqueIndex('user_credentials_user_id_unique_idx').on(table.userId),

    // Fast lookup by email within a tenant (login flow)
    tenantEmailIdx: uniqueIndex('user_credentials_tenant_email_idx').on(table.tenantId, table.email),

    // Index by tenant for listing users
    tenantIdIdx: index('user_credentials_tenant_id_idx').on(table.tenantId),

    // Index by status for admin queries
    statusIdx: index('user_credentials_status_idx').on(table.status),

    // Index for finding locked accounts (admin/cleanup)
    lockedUntilIdx: index('user_credentials_locked_until_idx').on(table.lockedUntil),
  })
);

// =============================================================================
// LOGIN AUDIT TABLE
// =============================================================================

/**
 * Login audit event type enum
 */
export const loginAuditEventEnum = pgEnum('login_audit_event', [
  'login_success',
  'login_failed',
  'password_changed',
  'account_locked',
  'account_unlocked',
  'password_reset_requested',
  'password_reset_completed',
  'mfa_challenge_issued',
  'mfa_challenge_passed',
  'mfa_challenge_failed',
]);

/**
 * Login audit log table - immutable record of all authentication events
 *
 * This provides a persistent audit trail that survives Redis flushes,
 * complementing the Redis-based brute-force tracking for real-time decisions.
 */
export const loginAuditLog = pgTable(
  'login_audit_log',
  {
    // Primary key
    id: uuid('id').primaryKey().defaultRandom(),

    // User reference (nullable for failed lookups with unknown users)
    userId: uuid('user_id'),

    // Tenant reference
    tenantId: uuid('tenant_id'),

    // The identifier used in the login attempt (email, username, etc.)
    loginIdentifier: text('login_identifier').notNull(),

    // Event type
    event: loginAuditEventEnum('event').notNull(),

    // Request context
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Failure details (generic to prevent information leakage in logs)
    failureReason: text('failure_reason'),

    // Timestamp
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Index for looking up audit by user
    userIdIdx: index('login_audit_user_id_idx').on(table.userId),

    // Index for tenant-wide queries
    tenantIdIdx: index('login_audit_tenant_id_idx').on(table.tenantId),

    // Index for time-based queries and cleanup
    timestampIdx: index('login_audit_timestamp_idx').on(table.timestamp),

    // Composite for user + time range queries
    userTimestampIdx: index('login_audit_user_timestamp_idx').on(table.userId, table.timestamp),

    // Index for event type filtering
    eventIdx: index('login_audit_event_idx').on(table.event),

    // Index for IP-based queries (security investigations)
    ipAddressIdx: index('login_audit_ip_address_idx').on(table.ipAddress),
  })
);

// =============================================================================
// TYPE INFERENCE
// =============================================================================

export type UserCredentialRecord = typeof userCredentials.$inferSelect;
export type NewUserCredentialRecord = typeof userCredentials.$inferInsert;

export type LoginAuditLogRecord = typeof loginAuditLog.$inferSelect;
export type NewLoginAuditLogRecord = typeof loginAuditLog.$inferInsert;

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Minimal credential data needed for password verification
 * (avoids loading full record when only checking password)
 */
export interface UserCredentialForAuth {
  userId: string;
  passwordHash: string;
  status: UserCredentialRecord['status'];
  mfaEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Login audit filters for querying audit log
 */
export interface LoginAuditFilters {
  userId?: string;
  tenantId?: string;
  event?: LoginAuditLogRecord['event'];
  ipAddress?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}
