/**
 * Decision Repository
 *
 * Persistence layer for decisions, constraints, refinements, and workflows.
 * Provides CRUD operations with proper transaction support.
 *
 * @packageDocumentation
 */

import { eq, and, desc, sql, lt, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  decisions,
  decisionConstraints,
  refinementOptions,
  workflowInstances,
  type DecisionRow,
  type NewDecisionRow,
  type DecisionConstraintsRow,
  type NewDecisionConstraintsRow,
  type RefinementOptionRow,
  type NewRefinementOptionRow,
  type WorkflowInstanceRow,
  type NewWorkflowInstanceRow,
} from './schema.js';
import { createLogger } from '../common/logger.js';
import type { ID, Timestamp } from '../common/types.js';

const logger = createLogger({ component: 'decision-repository' });

// =============================================================================
// TYPES
// =============================================================================

export interface Decision {
  id: ID;
  tenantId: ID;
  intentId: ID;
  agentId: ID;
  correlationId: ID;
  permitted: boolean;
  tier: 'GREEN' | 'YELLOW' | 'RED';
  trustBand: string;
  trustScore: number;
  policySetId?: string | null;
  reasoning: string[];
  denialReason?: string | null;
  hardDenial?: boolean;
  violatedPolicies?: Array<{
    policyId: string;
    policyName: string;
    severity: 'warning' | 'error' | 'critical';
  }> | null;
  refinementDeadline?: Timestamp | null;
  maxRefinementAttempts?: number;
  refinementAttempt: number;
  originalDecisionId?: ID | null;
  appliedRefinements?: Array<{
    refinementId: string;
    appliedAt: string;
  }> | null;
  latencyMs: number;
  version: number;
  decidedAt: Timestamp;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  constraints?: DecisionConstraints | null;
  refinementOptions?: RefinementOption[];
}

export interface DecisionConstraints {
  id: ID;
  decisionId: ID;
  tenantId: ID;
  allowedTools: string[];
  dataScopes: string[];
  rateLimits: Array<{
    resource: string;
    limit: number;
    windowSeconds: number;
  }>;
  requiredApprovals: Array<{
    type: string;
    approver: string;
    timeoutMs?: number;
    reason: string;
  }>;
  reversibilityRequired: boolean;
  maxExecutionTimeMs?: number | null;
  maxRetries?: number;
  resourceQuotas?: Record<string, number> | null;
  createdAt: Timestamp;
}

export type RefinementAction =
  | 'PROVIDE_CONTEXT'
  | 'REDUCE_SCOPE'
  | 'ADD_CONSTRAINTS'
  | 'REQUEST_APPROVAL'
  | 'DECOMPOSE'
  | 'WAIT_FOR_TRUST';

export interface RefinementOption {
  id: ID;
  decisionId: ID;
  tenantId: ID;
  action: RefinementAction;
  description: string;
  successProbability: number;
  effort: 'low' | 'medium' | 'high';
  parameters?: Record<string, unknown> | null;
  resultingConstraints?: Record<string, unknown> | null;
  selected: boolean;
  appliedAt?: Timestamp | null;
  createdAt: Timestamp;
}

export interface WorkflowInstance {
  id: ID;
  tenantId: ID;
  intentId: ID;
  agentId: ID;
  correlationId: ID;
  state: string;
  currentDecisionId?: ID | null;
  stateHistory: Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: string;
  }>;
  execution?: {
    executionId: string;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'failed';
    result?: unknown;
    error?: string;
  } | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}

export interface CreateDecisionInput {
  tenantId: ID;
  intentId: ID;
  agentId: ID;
  correlationId: ID;
  permitted: boolean;
  tier: 'GREEN' | 'YELLOW' | 'RED';
  trustBand: string;
  trustScore: number;
  policySetId?: string;
  reasoning: string[];
  denialReason?: string;
  hardDenial?: boolean;
  violatedPolicies?: Array<{
    policyId: string;
    policyName: string;
    severity: 'warning' | 'error' | 'critical';
  }>;
  refinementDeadline?: Date;
  maxRefinementAttempts?: number;
  refinementAttempt?: number;
  originalDecisionId?: ID;
  latencyMs: number;
  expiresAt: Date;
  constraints?: Omit<NewDecisionConstraintsRow, 'id' | 'decisionId' | 'tenantId' | 'createdAt'>;
  refinementOptions?: Array<Omit<NewRefinementOptionRow, 'id' | 'decisionId' | 'tenantId' | 'createdAt'>>;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

// =============================================================================
// MAPPERS
// =============================================================================

function mapDecisionRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    tenantId: row.tenantId,
    intentId: row.intentId,
    agentId: row.agentId,
    correlationId: row.correlationId,
    permitted: row.permitted,
    tier: row.tier,
    trustBand: row.trustBand,
    trustScore: row.trustScore,
    policySetId: row.policySetId,
    reasoning: row.reasoning ?? [],
    denialReason: row.denialReason,
    hardDenial: row.hardDenial ?? false,
    violatedPolicies: row.violatedPolicies,
    refinementDeadline: row.refinementDeadline?.toISOString() ?? null,
    maxRefinementAttempts: row.maxRefinementAttempts ?? 3,
    refinementAttempt: row.refinementAttempt,
    originalDecisionId: row.originalDecisionId,
    appliedRefinements: row.appliedRefinements,
    latencyMs: row.latencyMs,
    version: row.version,
    decidedAt: row.decidedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapConstraintsRow(row: DecisionConstraintsRow): DecisionConstraints {
  return {
    id: row.id,
    decisionId: row.decisionId,
    tenantId: row.tenantId,
    allowedTools: row.allowedTools ?? [],
    dataScopes: row.dataScopes ?? [],
    rateLimits: row.rateLimits ?? [],
    requiredApprovals: row.requiredApprovals ?? [],
    reversibilityRequired: row.reversibilityRequired ?? false,
    maxExecutionTimeMs: row.maxExecutionTimeMs,
    maxRetries: row.maxRetries ?? 3,
    resourceQuotas: row.resourceQuotas,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRefinementOptionRow(row: RefinementOptionRow): RefinementOption {
  return {
    id: row.id,
    decisionId: row.decisionId,
    tenantId: row.tenantId,
    action: row.action,
    description: row.description,
    successProbability: row.successProbability,
    effort: row.effort as 'low' | 'medium' | 'high',
    parameters: row.parameters,
    resultingConstraints: row.resultingConstraints,
    selected: row.selected ?? false,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapWorkflowRow(row: WorkflowInstanceRow): WorkflowInstance {
  return {
    id: row.id,
    tenantId: row.tenantId,
    intentId: row.intentId,
    agentId: row.agentId,
    correlationId: row.correlationId,
    state: row.state,
    currentDecisionId: row.currentDecisionId,
    stateHistory: row.stateHistory ?? [],
    execution: row.execution,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class DecisionRepository {
  constructor(private db: PostgresJsDatabase) {}

  // ---------------------------------------------------------------------------
  // DECISIONS
  // ---------------------------------------------------------------------------

  /**
   * Create a decision with optional constraints and refinement options
   */
  async createDecision(input: CreateDecisionInput): Promise<Decision> {
    const startTime = Date.now();

    return await this.db.transaction(async (tx) => {
      // Insert decision
      const [decisionRow] = await tx
        .insert(decisions)
        .values({
          tenantId: input.tenantId,
          intentId: input.intentId,
          agentId: input.agentId,
          correlationId: input.correlationId,
          permitted: input.permitted,
          tier: input.tier,
          trustBand: input.trustBand as any,
          trustScore: input.trustScore,
          policySetId: input.policySetId,
          reasoning: input.reasoning,
          denialReason: input.denialReason as any,
          hardDenial: input.hardDenial,
          violatedPolicies: input.violatedPolicies,
          refinementDeadline: input.refinementDeadline,
          maxRefinementAttempts: input.maxRefinementAttempts,
          refinementAttempt: input.refinementAttempt ?? 0,
          originalDecisionId: input.originalDecisionId,
          latencyMs: input.latencyMs,
          expiresAt: input.expiresAt,
        })
        .returning();

      const decision = mapDecisionRow(decisionRow);

      // Insert constraints if provided (for GREEN decisions)
      if (input.constraints) {
        const [constraintsRow] = await tx
          .insert(decisionConstraints)
          .values({
            decisionId: decisionRow.id,
            tenantId: input.tenantId,
            ...input.constraints,
          })
          .returning();

        decision.constraints = mapConstraintsRow(constraintsRow);
      }

      // Insert refinement options if provided (for YELLOW decisions)
      if (input.refinementOptions && input.refinementOptions.length > 0) {
        const refinementRows = await tx
          .insert(refinementOptions)
          .values(
            input.refinementOptions.map((opt) => ({
              decisionId: decisionRow.id,
              tenantId: input.tenantId,
              ...opt,
            }))
          )
          .returning();

        decision.refinementOptions = refinementRows.map(mapRefinementOptionRow);
      }

      logger.info(
        {
          decisionId: decision.id,
          intentId: input.intentId,
          tier: input.tier,
          permitted: input.permitted,
          durationMs: Date.now() - startTime,
        },
        'Decision created'
      );

      return decision;
    });
  }

  /**
   * Get a decision by ID with constraints and refinement options
   */
  async getDecision(id: ID, tenantId: ID): Promise<Decision | null> {
    const [row] = await this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.id, id), eq(decisions.tenantId, tenantId)))
      .limit(1);

    if (!row) return null;

    const decision = mapDecisionRow(row);

    // Fetch constraints
    const [constraintsRow] = await this.db
      .select()
      .from(decisionConstraints)
      .where(eq(decisionConstraints.decisionId, id))
      .limit(1);

    if (constraintsRow) {
      decision.constraints = mapConstraintsRow(constraintsRow);
    }

    // Fetch refinement options
    const refinementRows = await this.db
      .select()
      .from(refinementOptions)
      .where(eq(refinementOptions.decisionId, id));

    if (refinementRows.length > 0) {
      decision.refinementOptions = refinementRows.map(mapRefinementOptionRow);
    }

    return decision;
  }

  /**
   * Get the latest decision for an intent
   */
  async getLatestDecisionForIntent(intentId: ID, tenantId: ID): Promise<Decision | null> {
    const [row] = await this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.intentId, intentId), eq(decisions.tenantId, tenantId)))
      .orderBy(desc(decisions.decidedAt))
      .limit(1);

    if (!row) return null;

    return this.getDecision(row.id, tenantId);
  }

  /**
   * List decisions for an agent
   */
  async listDecisionsByAgent(
    agentId: ID,
    tenantId: ID,
    options: { limit?: number; offset?: number } = {}
  ): Promise<PaginatedResult<Decision>> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = options.offset ?? 0;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(decisions)
      .where(and(eq(decisions.agentId, agentId), eq(decisions.tenantId, tenantId)));

    const total = countResult?.count ?? 0;

    const rows = await this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.agentId, agentId), eq(decisions.tenantId, tenantId)))
      .orderBy(desc(decisions.decidedAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map(mapDecisionRow),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Get decisions pending refinement (YELLOW tier with upcoming deadline)
   */
  async getPendingRefinements(
    tenantId: ID,
    options: { limit?: number } = {}
  ): Promise<Decision[]> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const now = new Date();

    const rows = await this.db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.tenantId, tenantId),
          eq(decisions.tier, 'YELLOW'),
          sql`${decisions.refinementDeadline} > ${now}`
        )
      )
      .orderBy(decisions.refinementDeadline)
      .limit(limit);

    return rows.map(mapDecisionRow);
  }

  /**
   * Apply a refinement to a YELLOW decision
   */
  async applyRefinement(
    decisionId: ID,
    refinementId: ID,
    tenantId: ID
  ): Promise<RefinementOption | null> {
    const [row] = await this.db
      .update(refinementOptions)
      .set({
        selected: true,
        appliedAt: new Date(),
      })
      .where(
        and(
          eq(refinementOptions.id, refinementId),
          eq(refinementOptions.decisionId, decisionId),
          eq(refinementOptions.tenantId, tenantId)
        )
      )
      .returning();

    return row ? mapRefinementOptionRow(row) : null;
  }

  // ---------------------------------------------------------------------------
  // WORKFLOWS
  // ---------------------------------------------------------------------------

  /**
   * Create a workflow instance
   */
  async createWorkflow(input: Omit<NewWorkflowInstanceRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkflowInstance> {
    const [row] = await this.db
      .insert(workflowInstances)
      .values(input)
      .returning();

    logger.info({ workflowId: row.id, intentId: input.intentId }, 'Workflow created');
    return mapWorkflowRow(row);
  }

  /**
   * Get workflow by intent ID
   */
  async getWorkflowByIntent(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null> {
    const [row] = await this.db
      .select()
      .from(workflowInstances)
      .where(and(eq(workflowInstances.intentId, intentId), eq(workflowInstances.tenantId, tenantId)))
      .limit(1);

    return row ? mapWorkflowRow(row) : null;
  }

  /**
   * Update workflow state
   */
  async updateWorkflowState(
    workflowId: ID,
    tenantId: ID,
    newState: string,
    reason: string,
    currentDecisionId?: ID
  ): Promise<WorkflowInstance | null> {
    // First get current state
    const [current] = await this.db
      .select()
      .from(workflowInstances)
      .where(and(eq(workflowInstances.id, workflowId), eq(workflowInstances.tenantId, tenantId)))
      .limit(1);

    if (!current) return null;

    const stateHistory = [
      ...(current.stateHistory ?? []),
      {
        from: current.state,
        to: newState,
        reason,
        timestamp: new Date().toISOString(),
      },
    ];

    const [row] = await this.db
      .update(workflowInstances)
      .set({
        state: newState as any,
        currentDecisionId,
        stateHistory,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowInstances.id, workflowId), eq(workflowInstances.tenantId, tenantId)))
      .returning();

    return row ? mapWorkflowRow(row) : null;
  }

  /**
   * Update workflow execution status
   */
  async updateWorkflowExecution(
    workflowId: ID,
    tenantId: ID,
    execution: WorkflowInstance['execution']
  ): Promise<WorkflowInstance | null> {
    const [row] = await this.db
      .update(workflowInstances)
      .set({
        execution,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowInstances.id, workflowId), eq(workflowInstances.tenantId, tenantId)))
      .returning();

    return row ? mapWorkflowRow(row) : null;
  }

  /**
   * Get expired workflows for cleanup
   */
  async getExpiredWorkflows(limit = 100): Promise<WorkflowInstance[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(workflowInstances)
      .where(
        and(
          lt(workflowInstances.expiresAt, now),
          sql`${workflowInstances.state} NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')`
        )
      )
      .limit(limit);

    return rows.map(mapWorkflowRow);
  }
}

/**
 * Create a decision repository instance
 */
export function createDecisionRepository(db: PostgresJsDatabase): DecisionRepository {
  return new DecisionRepository(db);
}
