-- Migration: 0006_escalation_approvers
-- Description: Create escalation_approvers table for explicit approver assignments
-- Created: 2026-01-25
--
-- SECURITY: This table provides fine-grained authorization for escalation approval.
--           It supplements group-based authorization with explicit user assignments.

-- =============================================================================
-- 1. ESCALATION APPROVERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "escalation_approvers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "escalation_id" uuid NOT NULL REFERENCES "escalations"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "assigned_by" text NOT NULL,
  "assigned_at" timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

-- Index for looking up all approvers for an escalation
CREATE INDEX IF NOT EXISTS "escalation_approvers_escalation_idx"
ON "escalation_approvers" ("escalation_id");

-- Index for looking up all escalations a user can approve in a tenant
CREATE INDEX IF NOT EXISTS "escalation_approvers_tenant_user_idx"
ON "escalation_approvers" ("tenant_id", "user_id");

-- Unique constraint: a user can only be assigned once per escalation
CREATE UNIQUE INDEX IF NOT EXISTS "escalation_approvers_unique"
ON "escalation_approvers" ("escalation_id", "user_id");

-- =============================================================================
-- 3. COMMENTS
-- =============================================================================

COMMENT ON TABLE "escalation_approvers" IS 'Explicit approver assignments for escalations (supplements group-based authorization)';
COMMENT ON COLUMN "escalation_approvers"."escalation_id" IS 'The escalation this approver is assigned to';
COMMENT ON COLUMN "escalation_approvers"."tenant_id" IS 'Tenant for multi-tenant isolation';
COMMENT ON COLUMN "escalation_approvers"."user_id" IS 'The user ID who is assigned as an approver';
COMMENT ON COLUMN "escalation_approvers"."assigned_by" IS 'The user or system that assigned this approver';
COMMENT ON COLUMN "escalation_approvers"."assigned_at" IS 'When the approver was assigned';
