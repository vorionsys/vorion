/**
 * Policy Versions Schema
 *
 * Database schema for policy version history and rollback support.
 * Provides audit trail for all policy changes with diff tracking.
 *
 * @packageDocumentation
 */

// import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Policy versions table for storing historical policy definitions.
 * Each update to a policy creates a new version record.
 */
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Reference to the parent policy */
    policyId: uuid("policy_id").notNull(),

    /** Sequential version number (1, 2, 3...) */
    version: integer("version").notNull(),

    /** Full policy definition at this version */
    definition: jsonb("definition").notNull(),

    /** Human-readable summary of changes */
    changeSummary: text("change_summary"),

    /** User ID who made the change */
    changedBy: varchar("changed_by", { length: 255 }),

    /** When this version was created */
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** Index for efficient version history queries */
    policyVersionIdx: index("policy_versions_policy_idx").on(table.policyId),

    /** Index for version ordering */
    versionIdx: index("policy_versions_version_idx").on(
      table.policyId,
      table.version,
    ),

    /** Ensure unique version numbers per policy */
    uniqueVersion: uniqueIndex("policy_versions_unique").on(
      table.policyId,
      table.version,
    ),

    /** Index for audit queries by user */
    changedByIdx: index("policy_versions_changed_by_idx").on(table.changedBy),

    /** Index for time-based queries */
    createdAtIdx: index("policy_versions_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Type for policy version record from database
 */
export type PolicyVersionRow = typeof policyVersions.$inferSelect;

/**
 * Type for inserting a new policy version
 */
export type NewPolicyVersionRow = typeof policyVersions.$inferInsert;
