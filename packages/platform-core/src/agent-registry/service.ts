/**
 * Agent Registry Service
 *
 * Core service for agent registration, lifecycle management, and queries.
 *
 * @packageDocumentation
 */

import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";

import {
  agents,
  tenants,
  attestations,
  stateTransitions,
  approvalRequests,
  type Agent,
  type NewAgent,
  type Attestation,
  type NewAttestation,
  type StateTransition,
  type NewStateTransition,
  type AgentState,
  type AttestationType,
  type AttestationOutcome,
  type StateAction,
} from "@vorionsys/contracts/db";

import { getDatabase, type Database } from "../common/db.js";
import { createLogger } from "../common/logger.js";

const logger = createLogger({ component: "agent-registry" });

// ============================================================================
// Constants
// ============================================================================

/**
 * Domain code to bitmask mapping
 */
export const DOMAIN_BITS: Record<string, number> = {
  A: 0x001,
  B: 0x002,
  C: 0x004,
  D: 0x008,
  E: 0x010,
  F: 0x020,
  G: 0x040,
  H: 0x080,
  I: 0x100,
  S: 0x200,
};

/**
 * Trust tier score ranges
 */
export const TRUST_TIER_RANGES: Record<number, { min: number; max: number }> = {
  0: { min: 0, max: 199 },
  1: { min: 200, max: 349 },
  2: { min: 350, max: 499 },
  3: { min: 500, max: 649 },
  4: { min: 650, max: 799 },
  5: { min: 800, max: 875 },
  6: { min: 876, max: 950 },
  7: { min: 951, max: 1000 },
};

/**
 * State to tier mapping
 */
export const STATE_TO_TIER: Record<AgentState, number | null> = {
  T0_SANDBOX: 0,
  T1_OBSERVED: 1,
  T2_PROVISIONAL: 2,
  T3_MONITORED: 3,
  T4_STANDARD: 4,
  T5_TRUSTED: 5,
  T6_CERTIFIED: 6,
  T7_AUTONOMOUS: 7,
  QUARANTINE: null,
  SUSPENDED: null,
  REVOKED: null,
  EXPELLED: null,
};

/**
 * Tier to state mapping
 */
export const TIER_TO_STATE: Record<number, AgentState> = {
  0: "T0_SANDBOX",
  1: "T1_OBSERVED",
  2: "T2_PROVISIONAL",
  3: "T3_MONITORED",
  4: "T4_STANDARD",
  5: "T5_TRUSTED",
  6: "T6_CERTIFIED",
  7: "T7_AUTONOMOUS",
};

/**
 * Human approval gates - transitions that require human approval
 */
export const HUMAN_APPROVAL_GATES: Array<{ from: AgentState; to: AgentState }> =
  [
    { from: "T0_SANDBOX", to: "T1_OBSERVED" },
    { from: "T4_STANDARD", to: "T5_TRUSTED" },
    { from: "T5_TRUSTED", to: "T6_CERTIFIED" },
    { from: "T6_CERTIFIED", to: "T7_AUTONOMOUS" },
  ];

// ============================================================================
// Types
// ============================================================================

export interface RegisterAgentOptions {
  tenantId: string;
  organization: string;
  agentClass: string;
  domains: string[];
  level: number;
  version: string;
  description?: string;
  metadata?: Record<string, unknown>;
  contactEmail?: string;
}

export interface AgentQueryOptions {
  tenantId: string;
  organization?: string;
  domains?: string[];
  minLevel?: number;
  minTrustTier?: number;
  states?: AgentState[];
  limit?: number;
  offset?: number;
}

export interface SubmitAttestationOptions {
  agentId: string;
  tenantId: string;
  type: AttestationType;
  outcome: AttestationOutcome;
  action: string;
  evidence?: Record<string, unknown>;
  source?: string;
  sourceCarId?: string;
}

export interface StateTransitionOptions {
  agentId: string;
  tenantId: string;
  action: StateAction;
  reason: string;
  triggeredBy?: string;
  context?: Record<string, unknown>;
}

export interface StateTransitionResult {
  success: boolean;
  previousState: AgentState;
  newState: AgentState;
  transitionedAt: string;
  pendingApproval?: boolean;
  approvalRequestId?: string;
  error?: string;
}

// ============================================================================
// Service Class
// ============================================================================

export class AgentRegistryService {
  private db: Database;

  constructor() {
    this.db = getDatabase();
  }

  // ==========================================================================
  // Agent Registration
  // ==========================================================================

  /**
   * Register a new agent
   */
  async registerAgent(options: RegisterAgentOptions): Promise<Agent> {
    const {
      tenantId,
      organization,
      agentClass,
      domains,
      level,
      version,
      description,
      metadata,
      contactEmail,
    } = options;

    // Validate tenant exists
    const tenant = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      throw new Error("Tenant not found");
    }

    // Check agent limit
    const agentCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agents)
      .where(eq(agents.tenantId, tenantId));

    if (agentCount[0].count >= tenant[0].agentLimit) {
      throw new Error("Agent limit exceeded for tenant");
    }

    // Generate CAR ID
    const registry = tenant[0].registry;
    const domainString = [...domains].sort().join("");
    const domainsBitmask = this.encodeDomains(domains);
    const carId = `${registry}.${organization}.${agentClass}:${domainString}-L${level}@${version}`;

    // Check for duplicate CAR ID
    const existing = await this.db
      .select()
      .from(agents)
      .where(eq(agents.carId, carId))
      .limit(1);

    if (existing.length > 0) {
      throw new Error("Agent with this CAR ID already exists");
    }

    // Insert agent
    const newAgent: NewAgent = {
      tenantId,
      carId,
      registry,
      organization,
      agentClass,
      domains: domainString,
      domainsBitmask,
      level,
      version,
      state: "T0_SANDBOX",
      trustScore: 0,
      trustTier: 0,
      description,
      metadata,
      contactEmail,
    };

    const [agent] = await this.db.insert(agents).values(newAgent).returning();

    logger.info({ carId: agent.carId, tenantId }, "Agent registered");

    // Record initial state transition
    await this.recordTransition({
      agentId: agent.id,
      tenantId,
      action: "PROMOTE",
      fromState: "T0_SANDBOX",
      toState: "T0_SANDBOX",
      reason: "Initial registration",
      triggeredBy: "system",
    });

    return agent;
  }

  /**
   * Get agent by CAR ID
   */
  async getAgentByCarId(carId: string): Promise<Agent | null> {
    const result = await this.db
      .select()
      .from(agents)
      .where(eq(agents.carId, carId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get agent by ID
   */
  async getAgentById(id: string): Promise<Agent | null> {
    const result = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Update agent metadata
   */
  async updateAgent(
    id: string,
    updates: Partial<Pick<Agent, "description" | "metadata" | "contactEmail">>,
  ): Promise<Agent | null> {
    const result = await this.db
      .update(agents)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Query agents with filters
   */
  async queryAgents(
    options: AgentQueryOptions,
  ): Promise<{ data: Agent[]; total: number }> {
    const {
      tenantId,
      organization,
      domains,
      minLevel,
      minTrustTier,
      states,
      limit = 50,
      offset = 0,
    } = options;

    const conditions = [eq(agents.tenantId, tenantId)];

    if (organization) {
      conditions.push(eq(agents.organization, organization));
    }

    if (domains && domains.length > 0) {
      // Agent must have all required domains
      const requiredMask = this.encodeDomains(domains);
      conditions.push(
        sql`(${agents.domainsBitmask} & ${requiredMask}) = ${requiredMask}`,
      );
    }

    if (minLevel !== undefined) {
      conditions.push(gte(agents.level, minLevel));
    }

    if (minTrustTier !== undefined) {
      conditions.push(gte(agents.trustTier, minTrustTier));
    }

    if (states && states.length > 0) {
      conditions.push(inArray(agents.state, states));
    }

    const whereClause = and(...conditions);

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agents)
      .where(whereClause);

    // Get paginated results
    const data = await this.db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(desc(agents.registeredAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      total: countResult[0].count,
    };
  }

  // ==========================================================================
  // Attestations
  // ==========================================================================

  /**
   * Submit an attestation for an agent
   */
  async submitAttestation(
    options: SubmitAttestationOptions,
  ): Promise<Attestation> {
    const {
      agentId,
      tenantId,
      type,
      outcome,
      action,
      evidence,
      source,
      sourceCarId,
    } = options;

    const newAttestation: NewAttestation = {
      agentId,
      tenantId,
      type,
      outcome,
      action,
      evidence,
      source,
      sourceCarId,
      processed: false,
    };

    const [attestation] = await this.db
      .insert(attestations)
      .values(newAttestation)
      .returning();

    // Update agent activity
    await this.db
      .update(agents)
      .set({
        lastActiveAt: new Date(),
        attestationCount: sql`${agents.attestationCount} + 1`,
        successfulAttestations:
          outcome === "success"
            ? sql`${agents.successfulAttestations} + 1`
            : sql`${agents.successfulAttestations}`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId));

    logger.info(
      { attestationId: attestation.id, agentId, type, outcome },
      "Attestation submitted",
    );

    return attestation;
  }

  /**
   * Get attestations for an agent
   */
  async getAttestations(agentId: string, limit = 50): Promise<Attestation[]> {
    return this.db
      .select()
      .from(attestations)
      .where(eq(attestations.agentId, agentId))
      .orderBy(desc(attestations.timestamp))
      .limit(limit);
  }

  /**
   * Process pending attestations and update trust scores
   */
  async processAttestations(
    agentId: string,
  ): Promise<{ processed: number; newScore: number }> {
    // Get agent
    const agent = await this.getAgentById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    // Get unprocessed attestations
    const pending = await this.db
      .select()
      .from(attestations)
      .where(
        and(
          eq(attestations.agentId, agentId),
          eq(attestations.processed, false),
        ),
      )
      .orderBy(attestations.timestamp);

    if (pending.length === 0) {
      return { processed: 0, newScore: agent.trustScore };
    }

    // Calculate trust impact for each attestation
    let scoreChange = 0;
    for (const att of pending) {
      const impact = this.calculateAttestationImpact(att);
      scoreChange += impact;

      // Mark as processed
      await this.db
        .update(attestations)
        .set({
          processed: true,
          trustImpact: impact,
          processedAt: new Date(),
        })
        .where(eq(attestations.id, att.id));
    }

    // Update agent trust score
    const newScore = Math.max(
      0,
      Math.min(1000, agent.trustScore + scoreChange),
    );
    const newTier = this.scoreToTier(newScore);

    await this.db
      .update(agents)
      .set({
        trustScore: newScore,
        trustTier: newTier,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId));

    logger.info(
      {
        agentId,
        processed: pending.length,
        oldScore: agent.trustScore,
        newScore,
      },
      "Attestations processed",
    );

    return { processed: pending.length, newScore };
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Transition agent state
   */
  async transitionState(
    options: StateTransitionOptions,
  ): Promise<StateTransitionResult> {
    const {
      agentId,
      tenantId,
      action,
      reason,
      triggeredBy = "user",
      context,
    } = options;

    const agent = await this.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        previousState: "T0_SANDBOX",
        newState: "T0_SANDBOX",
        transitionedAt: new Date().toISOString(),
        error: "Agent not found",
      };
    }

    const currentState = agent.state as AgentState;
    let targetState: AgentState;
    let requiresApproval = false;

    // Determine target state based on action
    switch (action) {
      case "PROMOTE": {
        const currentTier = STATE_TO_TIER[currentState];
        if (currentTier === null || currentTier >= 7) {
          return {
            success: false,
            previousState: currentState,
            newState: currentState,
            transitionedAt: new Date().toISOString(),
            error: "Cannot promote from current state",
          };
        }
        targetState = TIER_TO_STATE[currentTier + 1];
        break;
      }

      case "REQUEST_APPROVAL": {
        const currentTier = STATE_TO_TIER[currentState];
        if (currentTier === null || currentTier >= 7) {
          return {
            success: false,
            previousState: currentState,
            newState: currentState,
            transitionedAt: new Date().toISOString(),
            error: "Cannot request approval from current state",
          };
        }
        targetState = TIER_TO_STATE[currentTier + 1];
        requiresApproval = true;
        break;
      }

      case "QUARANTINE":
        targetState = "QUARANTINE";
        break;

      case "RELEASE": {
        if (currentState !== "QUARANTINE") {
          return {
            success: false,
            previousState: currentState,
            newState: currentState,
            transitionedAt: new Date().toISOString(),
            error: "Can only release from quarantine",
          };
        }
        // Return to previous tier (stored in context or default to T0)
        const prevTier = (context?.previousTier as number) ?? 0;
        targetState = TIER_TO_STATE[prevTier];
        break;
      }

      case "SUSPEND":
        targetState = "SUSPENDED";
        break;

      case "REVOKE":
        targetState = "REVOKED";
        break;

      case "EXPEL":
        targetState = "EXPELLED";
        break;

      case "REINSTATE":
        if (currentState !== "SUSPENDED" && currentState !== "REVOKED") {
          return {
            success: false,
            previousState: currentState,
            newState: currentState,
            transitionedAt: new Date().toISOString(),
            error: "Can only reinstate from suspended or revoked",
          };
        }
        targetState = "T0_SANDBOX"; // Back to sandbox
        break;

      default:
        return {
          success: false,
          previousState: currentState,
          newState: currentState,
          transitionedAt: new Date().toISOString(),
          error: "Invalid action",
        };
    }

    // Check if this transition requires human approval
    const needsGate = HUMAN_APPROVAL_GATES.some(
      (g) => g.from === currentState && g.to === targetState,
    );

    if (needsGate && !requiresApproval && triggeredBy !== "approval") {
      requiresApproval = true;
    }

    // Record the transition
    const transition = await this.recordTransition({
      agentId,
      tenantId,
      action,
      fromState: currentState,
      toState: targetState,
      reason,
      triggeredBy,
      context,
      requiresApproval,
    });

    // If approval required, create approval request
    if (requiresApproval) {
      const approvalRequest = await this.createApprovalRequest({
        transitionId: transition.id,
        agentId,
        tenantId,
        fromState: currentState,
        toState: targetState,
        reason,
      });

      return {
        success: true,
        previousState: currentState,
        newState: currentState, // State doesn't change until approved
        transitionedAt: new Date().toISOString(),
        pendingApproval: true,
        approvalRequestId: approvalRequest.id,
      };
    }

    // Apply the state change
    await this.applyStateChange(agentId, currentState, targetState, action);

    return {
      success: true,
      previousState: currentState,
      newState: targetState,
      transitionedAt: new Date().toISOString(),
    };
  }

  /**
   * Record a state transition
   */
  private async recordTransition(
    data: NewStateTransition & { requiresApproval?: boolean },
  ): Promise<StateTransition> {
    const [transition] = await this.db
      .insert(stateTransitions)
      .values({
        ...data,
        status: data.requiresApproval ? "pending" : "completed",
      })
      .returning();

    return transition;
  }

  /**
   * Create an approval request
   */
  private async createApprovalRequest(data: {
    transitionId: string;
    agentId: string;
    tenantId: string;
    fromState: AgentState;
    toState: AgentState;
    reason: string;
  }) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour timeout

    const [request] = await this.db
      .insert(approvalRequests)
      .values({
        ...data,
        expiresAt,
        timeoutAction: "reject",
      })
      .returning();

    logger.info(
      {
        requestId: request.id,
        agentId: data.agentId,
        fromState: data.fromState,
        toState: data.toState,
      },
      "Approval request created",
    );

    return request;
  }

  /**
   * Apply a state change to an agent
   */
  private async applyStateChange(
    agentId: string,
    fromState: AgentState,
    toState: AgentState,
    action: StateAction,
  ): Promise<void> {
    const updates: Partial<Agent> = {
      state: toState,
      stateChangedAt: new Date(),
      updatedAt: new Date(),
    };

    // Track lifecycle events
    if (action === "QUARANTINE") {
      updates.quarantineCount =
        sql`${agents.quarantineCount} + 1` as unknown as number;
      updates.lastQuarantineAt = new Date();
    } else if (action === "SUSPEND") {
      updates.suspensionCount =
        sql`${agents.suspensionCount} + 1` as unknown as number;
      updates.lastSuspensionAt = new Date();
    } else if (action === "REVOKE") {
      updates.revocationCount =
        sql`${agents.revocationCount} + 1` as unknown as number;
    }

    await this.db.update(agents).set(updates).where(eq(agents.id, agentId));

    logger.info({ agentId, fromState, toState, action }, "Agent state changed");
  }

  /**
   * Check for automatic lifecycle actions (quarantine escalation, etc.)
   */
  async checkLifecycleRules(agentId: string): Promise<void> {
    const agent = await this.getAgentById(agentId);
    if (!agent) return;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Check: 3 quarantines in 30 days = suspension
    if (
      agent.state !== "SUSPENDED" &&
      agent.state !== "REVOKED" &&
      agent.state !== "EXPELLED" &&
      agent.quarantineCount >= 3 &&
      agent.lastQuarantineAt &&
      agent.lastQuarantineAt > thirtyDaysAgo
    ) {
      await this.transitionState({
        agentId,
        tenantId: agent.tenantId,
        action: "SUSPEND",
        reason: "3 quarantines in 30 days - automatic suspension",
        triggeredBy: "system",
      });
      return;
    }

    // Check: 3rd suspension = revocation
    if (agent.state === "SUSPENDED" && agent.suspensionCount >= 3) {
      await this.transitionState({
        agentId,
        tenantId: agent.tenantId,
        action: "REVOKE",
        reason: "3rd suspension - automatic revocation",
        triggeredBy: "system",
      });
      return;
    }

    // Check: 2nd revocation = expulsion
    if (agent.state === "REVOKED" && agent.revocationCount >= 2) {
      await this.transitionState({
        agentId,
        tenantId: agent.tenantId,
        action: "EXPEL",
        reason: "2nd revocation - automatic expulsion",
        triggeredBy: "system",
      });
      return;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Encode domain codes to bitmask
   */
  private encodeDomains(domains: string[]): number {
    return domains.reduce((mask, code) => mask | (DOMAIN_BITS[code] ?? 0), 0);
  }

  /**
   * Convert trust score to tier
   */
  private scoreToTier(score: number): number {
    for (const [tier, range] of Object.entries(TRUST_TIER_RANGES)) {
      if (score >= range.min && score <= range.max) {
        return parseInt(tier, 10);
      }
    }
    return 0;
  }

  /**
   * Calculate trust impact from an attestation
   */
  private calculateAttestationImpact(attestation: Attestation): number {
    const baseImpact =
      attestation.outcome === "success"
        ? 5
        : attestation.outcome === "failure"
          ? -10
          : -3;

    // Type multipliers
    const typeMultipliers: Record<AttestationType, number> = {
      BEHAVIORAL: 1.0,
      CREDENTIAL: 1.5,
      AUDIT: 2.0,
      A2A: 1.2,
      MANUAL: 0.8,
    };

    return Math.round(baseImpact * (typeMultipliers[attestation.type] ?? 1.0));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let instance: AgentRegistryService | null = null;

export function createAgentRegistryService(): AgentRegistryService {
  if (!instance) {
    instance = new AgentRegistryService();
  }
  return instance;
}

export function getAgentRegistryService(): AgentRegistryService {
  if (!instance) {
    throw new Error("AgentRegistryService not initialized");
  }
  return instance;
}
