/**
 * Escalation Service - Human-in-the-loop review management
 * FR76-81: Human escalation handling
 *
 * Provides CRUD operations for managing human review escalations
 * in the trust governance system. Escalations are created when
 * automated systems require human oversight (T1 Observed tier).
 */

import { eq, and, lt, desc, count, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { auditLogger, AuditEventType } from '../bot-trust/audit-logger'

export type EscalationStatus = 'pending' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'expired'
export type EscalationPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Escalation {
  id: string
  decisionId: string
  agentId: string
  agentName?: string
  status: EscalationStatus
  priority: EscalationPriority
  reason: string
  context: {
    actionType: string
    actionDetails: string
    riskLevel: number
    councilVotes?: Record<string, string>
    precedentConflicts?: string[]
  }
  assignedTo?: string
  assignedAt?: string
  resolution?: string
  resolutionReason?: string
  resolvedBy?: string
  resolvedAt?: string
  createsPrecedent?: boolean
  precedentNote?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateEscalationInput {
  decisionId: string
  agentId: string
  reason: string
  context: Escalation['context']
  priority?: EscalationPriority
  expiresInHours?: number
}

export interface ResolveEscalationInput {
  resolution: 'approved' | 'rejected'
  resolutionReason: string
  createsPrecedent?: boolean
  precedentNote?: string
}

export interface EscalationFilters {
  status?: EscalationStatus
  priority?: EscalationPriority
  agentId?: string
  assignedTo?: string
}

/**
 * Map database row to Escalation interface
 */
function mapToEscalation(row: typeof schema.escalations.$inferSelect, agentName?: string): Escalation {
  return {
    id: row.id,
    decisionId: row.decisionId,
    agentId: row.agentId,
    agentName,
    status: row.status,
    priority: row.priority,
    reason: row.reason,
    context: row.context,
    assignedTo: row.assignedTo ?? undefined,
    assignedAt: row.assignedAt?.toISOString(),
    resolution: row.resolution ?? undefined,
    resolutionReason: row.resolutionReason ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    resolvedAt: row.resolvedAt?.toISOString(),
    createsPrecedent: row.createsPrecedent ?? undefined,
    precedentNote: row.precedentNote ?? undefined,
    expiresAt: row.expiresAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Create an escalation for human review
 *
 * @param input - Escalation creation parameters
 * @returns The created escalation
 */
export async function createEscalation(input: CreateEscalationInput): Promise<Escalation> {
  const db = getDb()

  // Calculate expiry time (default 72 hours)
  const expiresInHours = input.expiresInHours ?? 72
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

  const [row] = await db
    .insert(schema.escalations)
    .values({
      decisionId: input.decisionId,
      agentId: input.agentId,
      reason: input.reason,
      context: input.context,
      priority: input.priority ?? 'medium',
      expiresAt,
    })
    .returning()

  // Fetch agent name for response
  const agent = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, input.agentId))
    .limit(1)

  return mapToEscalation(row, agent[0]?.name)
}

/**
 * Get escalations with optional filters
 *
 * @param filters - Optional filters for status, priority, agentId, assignedTo
 * @returns Escalations matching filters and total count
 */
export async function getEscalations(filters: EscalationFilters = {}): Promise<{ escalations: Escalation[], total: number }> {
  const db = getDb()

  // Build conditions array
  const conditions = []
  if (filters.status) {
    conditions.push(eq(schema.escalations.status, filters.status))
  }
  if (filters.priority) {
    conditions.push(eq(schema.escalations.priority, filters.priority))
  }
  if (filters.agentId) {
    conditions.push(eq(schema.escalations.agentId, filters.agentId))
  }
  if (filters.assignedTo) {
    conditions.push(eq(schema.escalations.assignedTo, filters.assignedTo))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Fetch escalations with agent names
  const rows = await db
    .select({
      escalation: schema.escalations,
      agentName: schema.agents.name,
    })
    .from(schema.escalations)
    .leftJoin(schema.agents, eq(schema.escalations.agentId, schema.agents.id))
    .where(whereClause)
    .orderBy(desc(schema.escalations.createdAt))

  // Get total count
  const [countResult] = await db
    .select({ count: count() })
    .from(schema.escalations)
    .where(whereClause)

  return {
    escalations: rows.map((r) => mapToEscalation(r.escalation, r.agentName ?? undefined)),
    total: countResult?.count ?? 0,
  }
}

/**
 * Get a single escalation by ID
 *
 * @param id - Escalation UUID
 * @returns The escalation or null if not found
 */
export async function getEscalation(id: string): Promise<Escalation | null> {
  const db = getDb()

  const rows = await db
    .select({
      escalation: schema.escalations,
      agentName: schema.agents.name,
    })
    .from(schema.escalations)
    .leftJoin(schema.agents, eq(schema.escalations.agentId, schema.agents.id))
    .where(eq(schema.escalations.id, id))
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return mapToEscalation(rows[0].escalation, rows[0].agentName ?? undefined)
}

/**
 * Get count of pending escalations requiring human review
 *
 * @returns Number of pending escalations
 */
export async function getPendingEscalationCount(): Promise<number> {
  const db = getDb()

  const [result] = await db
    .select({ count: count() })
    .from(schema.escalations)
    .where(eq(schema.escalations.status, 'pending'))

  return result?.count ?? 0
}

/**
 * Assign an escalation to a human reviewer
 *
 * @param id - Escalation UUID
 * @param userId - Reviewer's user UUID
 * @returns Updated escalation
 * @throws Error if escalation not found or already resolved
 */
export async function assignEscalation(id: string, userId: string): Promise<Escalation> {
  const db = getDb()

  const [row] = await db
    .update(schema.escalations)
    .set({
      assignedTo: userId,
      assignedAt: new Date(),
      status: 'assigned',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.escalations.id, id),
        // Only assign if pending or already assigned (reassignment)
        sql`${schema.escalations.status} IN ('pending', 'assigned')`
      )
    )
    .returning()

  if (!row) {
    throw new Error(`Escalation ${id} not found or already resolved`)
  }

  // Fetch agent name
  const agent = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, row.agentId))
    .limit(1)

  return mapToEscalation(row, agent[0]?.name)
}

/**
 * Resolve an escalation with approval or rejection
 *
 * @param id - Escalation UUID
 * @param userId - Resolver's user UUID
 * @param input - Resolution details
 * @returns Updated escalation
 * @throws Error if escalation not found or already resolved
 */
export async function resolveEscalation(id: string, userId: string, input: ResolveEscalationInput): Promise<Escalation> {
  const db = getDb()

  const [row] = await db
    .update(schema.escalations)
    .set({
      status: input.resolution,
      resolution: input.resolution,
      resolutionReason: input.resolutionReason,
      resolvedBy: userId,
      resolvedAt: new Date(),
      createsPrecedent: input.createsPrecedent ?? false,
      precedentNote: input.precedentNote,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.escalations.id, id),
        // Only resolve if not already resolved
        sql`${schema.escalations.status} NOT IN ('approved', 'rejected', 'expired')`
      )
    )
    .returning()

  if (!row) {
    throw new Error(`Escalation ${id} not found or already resolved`)
  }

  // Fetch agent name
  const agent = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, row.agentId))
    .limit(1)

  // Log HITL evidence to proof trail
  // HITL approvals/rejections carry 5x weight in trust calculations
  try {
    await auditLogger.logEvent(
      row.agentId,
      input.resolution === 'approved'
        ? AuditEventType.DECISION_APPROVED
        : AuditEventType.DECISION_REJECTED,
      {
        escalationId: id,
        decisionId: row.decisionId,
        resolution: input.resolution,
        resolutionReason: input.resolutionReason,
        createsPrecedent: input.createsPrecedent,
        precedentNote: input.precedentNote,
        evidenceType: input.resolution === 'approved' ? 'hitl_approval' : 'hitl_rejection',
        evidenceWeight: 5.0, // HITL evidence carries 5x weight
        trustImpact: input.resolution === 'approved' ? 'positive' : 'negative',
      },
      { user_id: userId }
    )
  } catch (auditError) {
    // Log but don't fail the resolution if audit logging fails
    console.error('Failed to log HITL evidence:', auditError)
  }

  return mapToEscalation(row, agent[0]?.name)
}

/**
 * Expire escalations that have passed their expiry time
 * Should be called periodically (e.g., via cron job)
 *
 * @returns Number of escalations expired
 */
export async function expireOldEscalations(): Promise<number> {
  const db = getDb()

  const result = await db
    .update(schema.escalations)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(
      and(
        // Only expire pending/assigned escalations
        sql`${schema.escalations.status} IN ('pending', 'assigned', 'in_review')`,
        // Past expiry time
        lt(schema.escalations.expiresAt, new Date())
      )
    )
    .returning({ id: schema.escalations.id })

  return result.length
}
