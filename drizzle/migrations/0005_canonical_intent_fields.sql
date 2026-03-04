-- Canonical Intent Fields Migration
-- Aligns intents table with @vorion/contracts canonical Intent interface
--
-- This migration adds fields required for:
-- 1. Proper risk assessment (actionType, dataSensitivity, reversibility)
-- 2. Resource tracking (resourceScope)
-- 3. Distributed tracing (correlationId)
-- 4. Intent lifecycle (expiresAt, denialReason, failureReason)
-- 5. Cross-system linking (decisionId, executionId, source)

-- =============================================================================
-- NEW ENUMS
-- =============================================================================

-- Action types for categorizing intents
DO $$ BEGIN
  CREATE TYPE action_type AS ENUM (
    'read',
    'write',
    'delete',
    'execute',
    'communicate',
    'transfer'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Data sensitivity levels
DO $$ BEGIN
  CREATE TYPE data_sensitivity AS ENUM (
    'PUBLIC',
    'INTERNAL',
    'CONFIDENTIAL',
    'RESTRICTED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Action reversibility classification
DO $$ BEGIN
  CREATE TYPE reversibility AS ENUM (
    'REVERSIBLE',
    'PARTIALLY_REVERSIBLE',
    'IRREVERSIBLE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- NEW COLUMNS
-- =============================================================================

-- Correlation ID for distributed tracing
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "correlation_id" uuid;

-- Action type category
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "action_type" action_type;

-- Resources this intent accesses/modifies (array of resource URNs)
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "resource_scope" text[];

-- Data sensitivity level
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "data_sensitivity" data_sensitivity;

-- Whether action can be undone
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "reversibility" reversibility;

-- When this intent expires (auto-deny after this time)
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;

-- Reason for denial if status is 'denied'
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "denial_reason" text;

-- Reason for failure if status is 'failed'
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "failure_reason" text;

-- Link to decision record
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "decision_id" uuid;

-- Link to execution record
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "execution_id" uuid;

-- Source system that generated this intent
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "source" text;

-- =============================================================================
-- NEW INDEXES
-- =============================================================================

-- Correlation ID index for distributed tracing queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intents_correlation_idx"
ON "intents" ("correlation_id");

-- Expiration index for auto-expiry job
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intents_expires_at_idx"
ON "intents" ("expires_at")
WHERE "expires_at" IS NOT NULL;

-- Action type index for analytics/filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intents_action_type_idx"
ON "intents" ("tenant_id", "action_type");

-- Data sensitivity index for compliance queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intents_data_sensitivity_idx"
ON "intents" ("tenant_id", "data_sensitivity")
WHERE "data_sensitivity" IN ('CONFIDENTIAL', 'RESTRICTED');

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN "intents"."correlation_id" IS 'Correlation ID for end-to-end distributed tracing';
COMMENT ON COLUMN "intents"."action_type" IS 'Category of action: read, write, delete, execute, communicate, transfer';
COMMENT ON COLUMN "intents"."resource_scope" IS 'Array of resource URNs this intent accesses/modifies';
COMMENT ON COLUMN "intents"."data_sensitivity" IS 'Sensitivity level of data involved: PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED';
COMMENT ON COLUMN "intents"."reversibility" IS 'Whether action can be undone: REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE';
COMMENT ON COLUMN "intents"."expires_at" IS 'Auto-deny intent after this timestamp';
COMMENT ON COLUMN "intents"."denial_reason" IS 'Reason for denial when status is denied';
COMMENT ON COLUMN "intents"."failure_reason" IS 'Reason for failure when status is failed';
COMMENT ON COLUMN "intents"."decision_id" IS 'Foreign key to decisions table';
COMMENT ON COLUMN "intents"."execution_id" IS 'Foreign key to executions table';
COMMENT ON COLUMN "intents"."source" IS 'Source system/service that generated this intent';
