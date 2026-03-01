/**
 * Agents Schema
 *
 * Database schema for agent registry, lifecycle, and attestations.
 *
 * @packageDocumentation
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// Enums
// ============================================================================

/**
 * Agent lifecycle states
 *
 * Active tiers T0-T7 plus exception states
 */
export const agentStateEnum = pgEnum('agent_state', [
  'T0_SANDBOX',
  'T1_OBSERVED',
  'T2_PROVISIONAL',
  'T3_MONITORED',
  'T4_STANDARD',
  'T5_TRUSTED',
  'T6_CERTIFIED',
  'T7_AUTONOMOUS',
  'QUARANTINE',
  'SUSPENDED',
  'REVOKED',
  'EXPELLED',
]);

/**
 * Attestation types
 */
export const attestationTypeEnum = pgEnum('attestation_type', [
  'BEHAVIORAL',
  'CREDENTIAL',
  'AUDIT',
  'A2A',
  'MANUAL',
]);

/**
 * Attestation outcomes
 */
export const attestationOutcomeEnum = pgEnum('attestation_outcome', [
  'success',
  'failure',
  'warning',
]);

/**
 * State transition actions
 */
export const stateActionEnum = pgEnum('state_action', [
  'PROMOTE',
  'REQUEST_APPROVAL',
  'QUARANTINE',
  'RELEASE',
  'SUSPEND',
  'REVOKE',
  'EXPEL',
  'REINSTATE',
]);

// ============================================================================
// Tenants Table
// ============================================================================

/**
 * Tenants table - organizations using the platform
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Tenant identity
    slug: text('slug').notNull().unique(), // e.g., 'acme', 'vorion'
    name: text('name').notNull(),
    registry: text('registry').notNull().default('a3i'),

    // Tier and quotas
    tier: text('tier').notNull().default('free'), // 'free', 'organization', 'enterprise'
    agentLimit: integer('agent_limit').notNull().default(5),
    apiCallsPerMonth: integer('api_calls_per_month').notNull().default(10000),

    // Contact
    contactEmail: text('contact_email').notNull(),
    billingEmail: text('billing_email'),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Status
    active: boolean('active').notNull().default(true),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('tenants_slug_idx').on(table.slug),
    activeIdx: index('tenants_active_idx').on(table.active),
  })
);

// ============================================================================
// Agents Table
// ============================================================================

/**
 * Agents table - registered AI agents
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // CAR ID components (immutable after creation)
    carId: text('car_id').notNull().unique(), // Full CAR ID string
    registry: text('registry').notNull(), // e.g., 'a3i'
    organization: text('organization').notNull(), // Tenant slug
    agentClass: text('agent_class').notNull(), // Agent name
    domains: text('domains').notNull(), // Domain string e.g., 'FHC'
    domainsBitmask: integer('domains_bitmask').notNull(), // Bitmask for queries
    level: integer('level').notNull(), // Capability level (0-7)
    version: text('version').notNull(), // Semver

    // Current state (mutable)
    state: agentStateEnum('state').notNull().default('T0_SANDBOX'),
    trustScore: integer('trust_score').notNull().default(0), // 0-1000
    trustTier: integer('trust_tier').notNull().default(0), // 0-7

    // Metadata
    description: text('description'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    contactEmail: text('contact_email'),

    // Lifecycle tracking
    quarantineCount: integer('quarantine_count').notNull().default(0),
    suspensionCount: integer('suspension_count').notNull().default(0),
    revocationCount: integer('revocation_count').notNull().default(0),
    lastQuarantineAt: timestamp('last_quarantine_at', { withTimezone: true }),
    lastSuspensionAt: timestamp('last_suspension_at', { withTimezone: true }),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),

    // Activity tracking
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    attestationCount: integer('attestation_count').notNull().default(0),
    successfulAttestations: integer('successful_attestations').notNull().default(0),

    // Timestamps
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    carIdIdx: uniqueIndex('agents_car_id_idx').on(table.carId),
    tenantIdx: index('agents_tenant_idx').on(table.tenantId),
    stateIdx: index('agents_state_idx').on(table.state),
    trustTierIdx: index('agents_trust_tier_idx').on(table.trustTier),
    domainsIdx: index('agents_domains_bitmask_idx').on(table.domainsBitmask),
    orgClassIdx: index('agents_org_class_idx').on(table.organization, table.agentClass),
  })
);

// ============================================================================
// Attestations Table
// ============================================================================

/**
 * Attestations table - trust attestations for agents
 */
export const attestations = pgTable(
  'attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Attestation details
    type: attestationTypeEnum('type').notNull(),
    outcome: attestationOutcomeEnum('outcome').notNull(),
    action: text('action').notNull(), // What action was attested

    // Evidence and context
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    source: text('source'), // Where attestation came from
    sourceCarId: text('source_car_id'), // For A2A attestations

    // Impact
    processed: boolean('processed').notNull().default(false),
    trustImpact: integer('trust_impact'), // Delta to trust score
    processedAt: timestamp('processed_at', { withTimezone: true }),

    // Timestamps
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index('attestations_agent_idx').on(table.agentId),
    tenantIdx: index('attestations_tenant_idx').on(table.tenantId),
    typeIdx: index('attestations_type_idx').on(table.type),
    timestampIdx: index('attestations_timestamp_idx').on(table.timestamp),
    processedIdx: index('attestations_processed_idx').on(table.processed),
    agentTimestampIdx: index('attestations_agent_timestamp_idx').on(
      table.agentId,
      table.timestamp
    ),
  })
);

// ============================================================================
// State Transitions Table
// ============================================================================

/**
 * State transitions table - agent lifecycle history
 */
export const stateTransitions = pgTable(
  'state_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Transition details
    action: stateActionEnum('action').notNull(),
    fromState: agentStateEnum('from_state').notNull(),
    toState: agentStateEnum('to_state').notNull(),
    reason: text('reason').notNull(),

    // Approval tracking (for human gates)
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),

    // Context
    context: jsonb('context').$type<Record<string, unknown>>(),
    triggeredBy: text('triggered_by'), // 'system', 'user', 'policy'

    // Status
    status: text('status').notNull().default('completed'), // 'pending', 'completed', 'rejected'

    // Timestamps
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index('state_transitions_agent_idx').on(table.agentId),
    tenantIdx: index('state_transitions_tenant_idx').on(table.tenantId),
    statusIdx: index('state_transitions_status_idx').on(table.status),
    timestampIdx: index('state_transitions_timestamp_idx').on(table.timestamp),
  })
);

// ============================================================================
// Approval Requests Table
// ============================================================================

/**
 * Approval requests table - human approval gates
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transitionId: uuid('transition_id').notNull().references(() => stateTransitions.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Request details
    fromState: agentStateEnum('from_state').notNull(),
    toState: agentStateEnum('to_state').notNull(),
    reason: text('reason').notNull(),

    // Approval tracking
    status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'expired'
    assignedTo: uuid('assigned_to'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNotes: text('decision_notes'),

    // Timeouts
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    timeoutAction: text('timeout_action').notNull().default('reject'), // 'reject', 'escalate'

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index('approval_requests_agent_idx').on(table.agentId),
    tenantIdx: index('approval_requests_tenant_idx').on(table.tenantId),
    statusIdx: index('approval_requests_status_idx').on(table.status),
    expiresIdx: index('approval_requests_expires_idx').on(table.expiresAt),
  })
);

// ============================================================================
// API Keys Table
// ============================================================================

/**
 * API keys table - authentication tokens for tenants
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Key details
    keyHash: text('key_hash').notNull(), // SHA256 hash of actual key
    keyPrefix: text('key_prefix').notNull(), // First 8 chars for identification
    name: text('name').notNull(), // User-provided name

    // Permissions
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]), // e.g., ['agents:read', 'agents:write']

    // Rate limiting
    rateLimit: integer('rate_limit').notNull().default(1000), // requests per minute
    rateLimitRemaining: integer('rate_limit_remaining').notNull().default(1000),
    rateLimitResetAt: timestamp('rate_limit_reset_at', { withTimezone: true }),

    // Usage tracking
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').notNull().default(0),

    // Status
    active: boolean('active').notNull().default(true),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    // Expiration
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('api_keys_tenant_idx').on(table.tenantId),
    keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
    keyPrefixIdx: index('api_keys_key_prefix_idx').on(table.keyPrefix),
    activeIdx: index('api_keys_active_idx').on(table.active),
  })
);

// ============================================================================
// Type Exports
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Attestation = typeof attestations.$inferSelect;
export type NewAttestation = typeof attestations.$inferInsert;

export type StateTransition = typeof stateTransitions.$inferSelect;
export type NewStateTransition = typeof stateTransitions.$inferInsert;

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

// State type for TypeScript
export type AgentState =
  | 'T0_SANDBOX'
  | 'T1_OBSERVED'
  | 'T2_PROVISIONAL'
  | 'T3_MONITORED'
  | 'T4_STANDARD'
  | 'T5_TRUSTED'
  | 'T6_CERTIFIED'
  | 'T7_AUTONOMOUS'
  | 'QUARANTINE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPELLED';

export type AttestationType = 'BEHAVIORAL' | 'CREDENTIAL' | 'AUDIT' | 'A2A' | 'MANUAL';
export type AttestationOutcome = 'success' | 'failure' | 'warning';
export type StateAction =
  | 'PROMOTE'
  | 'REQUEST_APPROVAL'
  | 'QUARANTINE'
  | 'RELEASE'
  | 'SUSPEND'
  | 'REVOKE'
  | 'EXPEL'
  | 'REINSTATE';
