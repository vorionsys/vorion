-- Decision and Fluid Governance Migration
-- Adds persistence for enforcement decisions with three-tier governance support
--
-- This migration creates:
-- 1. decisions - Authorization decisions for intents
-- 2. decision_constraints - Constraints applied to permitted decisions
-- 3. refinement_options - Available refinements for YELLOW decisions
-- 4. workflow_instances - Tracks intent lifecycle through governance

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Decision tier for fluid governance
DO $$ BEGIN
  CREATE TYPE decision_tier AS ENUM ('GREEN', 'YELLOW', 'RED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Workflow state for intent lifecycle
DO $$ BEGIN
  CREATE TYPE workflow_state AS ENUM (
    'SUBMITTED',
    'EVALUATING',
    'APPROVED',
    'PENDING_REFINEMENT',
    'PENDING_REVIEW',
    'DENIED',
    'EXECUTING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Refinement action types
DO $$ BEGIN
  CREATE TYPE refinement_action AS ENUM (
    'REDUCE_SCOPE',
    'ADD_CONSTRAINTS',
    'REQUEST_APPROVAL',
    'PROVIDE_CONTEXT',
    'DECOMPOSE',
    'WAIT_FOR_TRUST'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Approval type enum
DO $$ BEGIN
  CREATE TYPE approval_type AS ENUM (
    'none',
    'human_review',
    'automated_check',
    'multi_party'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Trust band enum (T0-T7)
DO $$ BEGIN
  CREATE TYPE trust_band AS ENUM (
    'T0_SANDBOX',
    'T1_OBSERVED',
    'T2_PROVISIONAL',
    'T3_MONITORED',
    'T4_STANDARD',
    'T5_TRUSTED',
    'T6_CERTIFIED',
    'T7_AUTONOMOUS'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Denial reason enum
DO $$ BEGIN
  CREATE TYPE denial_reason AS ENUM (
    'insufficient_trust',
    'policy_violation',
    'resource_restricted',
    'data_sensitivity_exceeded',
    'rate_limit_exceeded',
    'context_mismatch',
    'expired_intent',
    'system_error'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- DECISIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,

  -- Core identifiers
  "intent_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,

  -- Decision result
  "permitted" boolean NOT NULL,
  "tier" decision_tier NOT NULL DEFAULT 'GREEN',

  -- Trust state at decision time
  "trust_band" trust_band NOT NULL,
  "trust_score" integer NOT NULL,

  -- Policy reference
  "policy_set_id" text,

  -- Reasoning (array stored as JSONB)
  "reasoning" jsonb NOT NULL DEFAULT '[]',

  -- Denial details (for RED decisions)
  "denial_reason" denial_reason,
  "hard_denial" boolean DEFAULT false,
  "violated_policies" jsonb,

  -- Refinement tracking (for YELLOW decisions)
  "refinement_deadline" timestamptz,
  "max_refinement_attempts" integer DEFAULT 3,
  "refinement_attempt" integer NOT NULL DEFAULT 0,
  "original_decision_id" uuid REFERENCES "decisions"("id"),
  "applied_refinements" jsonb,

  -- Performance
  "latency_ms" integer NOT NULL,

  -- Versioning
  "version" integer NOT NULL DEFAULT 1,

  -- Timestamps
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for decisions
CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_tenant_idx"
ON "decisions" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_intent_idx"
ON "decisions" ("intent_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_agent_idx"
ON "decisions" ("agent_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_correlation_idx"
ON "decisions" ("correlation_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_tier_idx"
ON "decisions" ("tenant_id", "tier");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_decided_at_idx"
ON "decisions" ("tenant_id", "decided_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decisions_pending_refinement_idx"
ON "decisions" ("tier", "refinement_deadline")
WHERE "tier" = 'YELLOW';

-- =============================================================================
-- DECISION CONSTRAINTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "decision_constraints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "decision_id" uuid NOT NULL REFERENCES "decisions"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,

  -- Tool restrictions
  "allowed_tools" jsonb NOT NULL DEFAULT '[]',

  -- Data scope restrictions
  "data_scopes" jsonb NOT NULL DEFAULT '[]',

  -- Rate limits
  "rate_limits" jsonb NOT NULL DEFAULT '[]',

  -- Required approvals
  "required_approvals" jsonb NOT NULL DEFAULT '[]',

  -- Execution constraints
  "reversibility_required" boolean DEFAULT false,
  "max_execution_time_ms" integer,
  "max_retries" integer DEFAULT 3,
  "resource_quotas" jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for decision_constraints
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "decision_constraints_decision_idx"
ON "decision_constraints" ("decision_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "decision_constraints_tenant_idx"
ON "decision_constraints" ("tenant_id");

-- =============================================================================
-- REFINEMENT OPTIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "refinement_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "decision_id" uuid NOT NULL REFERENCES "decisions"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,

  -- Refinement details
  "action" refinement_action NOT NULL,
  "description" text NOT NULL,
  "success_probability" real NOT NULL,
  "effort" text NOT NULL,

  -- Parameters and resulting constraints
  "parameters" jsonb,
  "resulting_constraints" jsonb,

  -- Status
  "selected" boolean DEFAULT false,
  "applied_at" timestamptz,

  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for refinement_options
CREATE INDEX CONCURRENTLY IF NOT EXISTS "refinement_options_decision_idx"
ON "refinement_options" ("decision_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "refinement_options_tenant_idx"
ON "refinement_options" ("tenant_id");

-- =============================================================================
-- WORKFLOW INSTANCES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "workflow_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,

  -- Core identifiers
  "intent_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,

  -- Current state
  "state" workflow_state NOT NULL DEFAULT 'SUBMITTED',
  "current_decision_id" uuid REFERENCES "decisions"("id"),

  -- State history (JSONB array)
  "state_history" jsonb NOT NULL DEFAULT '[]',

  -- Execution details
  "execution" jsonb,

  -- Timestamps
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);

-- Indexes for workflow_instances
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_tenant_idx"
ON "workflow_instances" ("tenant_id");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_intent_idx"
ON "workflow_instances" ("intent_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_agent_idx"
ON "workflow_instances" ("agent_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_correlation_idx"
ON "workflow_instances" ("correlation_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_state_idx"
ON "workflow_instances" ("tenant_id", "state");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_instances_expires_at_idx"
ON "workflow_instances" ("expires_at");

-- =============================================================================
-- LINK INTENTS TO DECISIONS
-- =============================================================================

-- Add decision_id to intents table if not already present (from previous migration)
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "decision_id" uuid;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE "decisions" IS 'Authorization decisions for intents with three-tier fluid governance';
COMMENT ON COLUMN "decisions"."tier" IS 'GREEN=approved, YELLOW=refinable, RED=denied';
COMMENT ON COLUMN "decisions"."permitted" IS 'Whether the intent is permitted (GREEN=true, YELLOW=false pending refinement, RED=false)';
COMMENT ON COLUMN "decisions"."refinement_attempt" IS '0=initial decision, 1+=refined decision';

COMMENT ON TABLE "decision_constraints" IS 'Constraints applied to permitted (GREEN) decisions';
COMMENT ON TABLE "refinement_options" IS 'Available refinement options for YELLOW decisions';
COMMENT ON TABLE "workflow_instances" IS 'Tracks intent lifecycle through the governance pipeline';
