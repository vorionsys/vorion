/**
 * Enforce Schema
 *
 * Database schema for decisions, constraints, and fluid governance workflow.
 * Aligned with @vorion/contracts Decision and FluidDecision types.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  real,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Decision tier for fluid governance (GREEN/YELLOW/RED)
 */
export const decisionTierEnum = pgEnum('decision_tier', [
  'GREEN',
  'YELLOW',
  'RED',
]);

/**
 * Workflow state for intent lifecycle
 */
export const workflowStateEnum = pgEnum('workflow_state', [
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
  'EXPIRED',
]);

/**
 * Refinement action types
 */
export const refinementActionEnum = pgEnum('refinement_action', [
  'REDUCE_SCOPE',
  'ADD_CONSTRAINTS',
  'REQUEST_APPROVAL',
  'PROVIDE_CONTEXT',
  'DECOMPOSE',
  'WAIT_FOR_TRUST',
]);

/**
 * Approval type enum
 */
export const approvalTypeEnum = pgEnum('approval_type', [
  'none',
  'human_review',
  'automated_check',
  'multi_party',
]);

/**
 * Trust band enum (T0-T7)
 */
export const trustBandEnum = pgEnum('trust_band', [
  'T0_SANDBOX',
  'T1_OBSERVED',
  'T2_PROVISIONAL',
  'T3_MONITORED',
  'T4_STANDARD',
  'T5_TRUSTED',
  'T6_CERTIFIED',
  'T7_AUTONOMOUS',
]);

/**
 * Denial reason enum
 */
export const denialReasonEnum = pgEnum('denial_reason', [
  'insufficient_trust',
  'policy_violation',
  'resource_restricted',
  'data_sensitivity_exceeded',
  'rate_limit_exceeded',
  'context_mismatch',
  'expired_intent',
  'system_error',
]);

// =============================================================================
// DECISIONS TABLE
// =============================================================================

/**
 * Decisions table - stores authorization decisions for intents
 */
export const decisions = pgTable('decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: text('tenant_id').notNull(),

  // Core identifiers
  intentId: uuid('intent_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  correlationId: uuid('correlation_id').notNull(),

  // Decision result
  permitted: boolean('permitted').notNull(),
  tier: decisionTierEnum('tier').notNull().default('GREEN'),

  // Trust state at decision time
  trustBand: trustBandEnum('trust_band').notNull(),
  trustScore: integer('trust_score').notNull(),

  // Policy reference
  policySetId: text('policy_set_id'),

  // Reasoning (array stored as JSONB)
  reasoning: jsonb('reasoning').$type<string[]>().notNull().default([]),

  // Denial details (for RED decisions)
  denialReason: denialReasonEnum('denial_reason'),
  hardDenial: boolean('hard_denial').default(false),
  violatedPolicies: jsonb('violated_policies').$type<Array<{
    policyId: string;
    policyName: string;
    severity: 'warning' | 'error' | 'critical';
  }>>(),

  // Refinement tracking (for YELLOW decisions)
  refinementDeadline: timestamp('refinement_deadline', { withTimezone: true }),
  maxRefinementAttempts: integer('max_refinement_attempts').default(3),
  refinementAttempt: integer('refinement_attempt').notNull().default(0),
  originalDecisionId: uuid('original_decision_id'),
  appliedRefinements: jsonb('applied_refinements').$type<Array<{
    refinementId: string;
    appliedAt: string;
  }>>(),

  // Performance
  latencyMs: integer('latency_ms').notNull(),

  // Versioning
  version: integer('version').notNull().default(1),

  // Timestamps
  decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('decisions_tenant_idx').on(table.tenantId),
  intentIdx: index('decisions_intent_idx').on(table.intentId),
  agentIdx: index('decisions_agent_idx').on(table.agentId),
  correlationIdx: index('decisions_correlation_idx').on(table.correlationId),
  tierIdx: index('decisions_tier_idx').on(table.tenantId, table.tier),
  decidedAtIdx: index('decisions_decided_at_idx').on(table.tenantId, table.decidedAt),
  // For finding decisions pending refinement
  pendingRefinementIdx: index('decisions_pending_refinement_idx').on(
    table.tier,
    table.refinementDeadline
  ),
}));

// =============================================================================
// DECISION CONSTRAINTS TABLE
// =============================================================================

/**
 * Decision constraints - constraints applied to permitted decisions
 */
export const decisionConstraints = pgTable('decision_constraints', {
  id: uuid('id').defaultRandom().primaryKey(),
  decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),

  // Tool restrictions
  allowedTools: jsonb('allowed_tools').$type<string[]>().notNull().default([]),

  // Data scope restrictions
  dataScopes: jsonb('data_scopes').$type<string[]>().notNull().default([]),

  // Rate limits
  rateLimits: jsonb('rate_limits').$type<Array<{
    resource: string;
    limit: number;
    windowSeconds: number;
  }>>().notNull().default([]),

  // Required approvals
  requiredApprovals: jsonb('required_approvals').$type<Array<{
    type: string;
    approver: string;
    timeoutMs?: number;
    reason: string;
  }>>().notNull().default([]),

  // Execution constraints
  reversibilityRequired: boolean('reversibility_required').default(false),
  maxExecutionTimeMs: integer('max_execution_time_ms'),
  maxRetries: integer('max_retries').default(3),
  resourceQuotas: jsonb('resource_quotas').$type<Record<string, number>>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  decisionIdx: uniqueIndex('decision_constraints_decision_idx').on(table.decisionId),
  tenantIdx: index('decision_constraints_tenant_idx').on(table.tenantId),
}));

// =============================================================================
// REFINEMENT OPTIONS TABLE
// =============================================================================

/**
 * Refinement options - available refinements for YELLOW decisions
 */
export const refinementOptions = pgTable('refinement_options', {
  id: uuid('id').defaultRandom().primaryKey(),
  decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull(),

  // Refinement details
  action: refinementActionEnum('action').notNull(),
  description: text('description').notNull(),
  successProbability: real('success_probability').notNull(),
  effort: text('effort').notNull().$type<'low' | 'medium' | 'high'>(),

  // Parameters and resulting constraints
  parameters: jsonb('parameters').$type<Record<string, unknown>>(),
  resultingConstraints: jsonb('resulting_constraints').$type<Record<string, unknown>>(),

  // Status
  selected: boolean('selected').default(false),
  appliedAt: timestamp('applied_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  decisionIdx: index('refinement_options_decision_idx').on(table.decisionId),
  tenantIdx: index('refinement_options_tenant_idx').on(table.tenantId),
}));

// =============================================================================
// WORKFLOW INSTANCES TABLE
// =============================================================================

/**
 * Workflow instances - tracks intent lifecycle through governance
 */
export const workflowInstances = pgTable('workflow_instances', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: text('tenant_id').notNull(),

  // Core identifiers
  intentId: uuid('intent_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  correlationId: uuid('correlation_id').notNull(),

  // Current state
  state: workflowStateEnum('state').notNull().default('SUBMITTED'),
  currentDecisionId: uuid('current_decision_id'),

  // State history (JSONB array)
  stateHistory: jsonb('state_history').$type<Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: string;
  }>>().notNull().default([]),

  // Execution details
  execution: jsonb('execution').$type<{
    executionId: string;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'failed';
    result?: unknown;
    error?: string;
  }>(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({
  tenantIdx: index('workflow_instances_tenant_idx').on(table.tenantId),
  intentIdx: uniqueIndex('workflow_instances_intent_idx').on(table.intentId),
  agentIdx: index('workflow_instances_agent_idx').on(table.agentId),
  correlationIdx: index('workflow_instances_correlation_idx').on(table.correlationId),
  stateIdx: index('workflow_instances_state_idx').on(table.tenantId, table.state),
  expiresAtIdx: index('workflow_instances_expires_at_idx').on(table.expiresAt),
}));

// =============================================================================
// RELATIONS
// =============================================================================

export const decisionsRelations = relations(decisions, ({ one, many }) => ({
  constraints: one(decisionConstraints, {
    fields: [decisions.id],
    references: [decisionConstraints.decisionId],
  }),
  refinementOptions: many(refinementOptions),
  originalDecision: one(decisions, {
    fields: [decisions.originalDecisionId],
    references: [decisions.id],
    relationName: 'refinedFrom',
  }),
  refinedDecisions: many(decisions, {
    relationName: 'refinedFrom',
  }),
}));

export const decisionConstraintsRelations = relations(decisionConstraints, ({ one }) => ({
  decision: one(decisions, {
    fields: [decisionConstraints.decisionId],
    references: [decisions.id],
  }),
}));

export const refinementOptionsRelations = relations(refinementOptions, ({ one }) => ({
  decision: one(decisions, {
    fields: [refinementOptions.decisionId],
    references: [decisions.id],
  }),
}));

export const workflowInstancesRelations = relations(workflowInstances, ({ one }) => ({
  currentDecision: one(decisions, {
    fields: [workflowInstances.currentDecisionId],
    references: [decisions.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type DecisionRow = typeof decisions.$inferSelect;
export type NewDecisionRow = typeof decisions.$inferInsert;
export type DecisionConstraintsRow = typeof decisionConstraints.$inferSelect;
export type NewDecisionConstraintsRow = typeof decisionConstraints.$inferInsert;
export type RefinementOptionRow = typeof refinementOptions.$inferSelect;
export type NewRefinementOptionRow = typeof refinementOptions.$inferInsert;
export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstanceRow = typeof workflowInstances.$inferInsert;
