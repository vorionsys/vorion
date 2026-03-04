/**
 * Multi-Agent Council Service
 *
 * Enterprise orchestration service for multi-agent deliberation and
 * collective decision-making. Integrates with Intent, Enforce, and Proof
 * layers for full governance lifecycle.
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  CouncilConfig,
  CouncilMember,
  DeliberationSession,
  DeliberationTopic,
  SessionOutcome,
  Vote,
  VoteChoice,
  Proposal,
  Contribution,
  ConsensusType,
  MemberSelectionCriteria,
  CouncilEvent,
  DEFAULT_COUNCIL_CONFIG,
} from './types.js';
import { CouncilMemberRegistry, createMemberRegistry } from './registry.js';
import { ConsensusEngine, createConsensusEngine } from './consensus.js';
import { SessionManager, createSessionManager } from './session.js';
import { ConflictResolver, createConflictResolver } from './conflict.js';

const tracer = trace.getTracer('multi-agent-council');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Intent for council deliberation
 */
export interface CouncilIntent {
  id: string;
  type: 'policy_review' | 'action_approval' | 'dispute_resolution' | 'governance_change';
  subject: string;
  description: string;
  requestedBy: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  context: Record<string, unknown>;
  deadline?: Date;
}

/**
 * Council decision for Enforce layer
 */
export interface CouncilDecision {
  id: string;
  intentId: string;
  sessionId: string;
  outcome: SessionOutcome;
  enforceColor: 'GREEN' | 'YELLOW' | 'RED';
  confidence: number;
  conditions: string[];
  validUntil?: Date;
  appealDeadline?: Date;
}

/**
 * Proof record for council decision
 */
export interface CouncilProof {
  id: string;
  decisionId: string;
  sessionId: string;
  hash: string;
  votes: Array<{
    memberId: string;
    choice: VoteChoice;
    signature?: string;
  }>;
  timestamp: Date;
  witnesses: string[];
}

/**
 * Council service configuration
 */
export interface CouncilServiceConfig extends CouncilConfig {
  /** Enable Intent layer integration */
  enableIntentIntegration: boolean;
  /** Enable Enforce layer integration */
  enableEnforceIntegration: boolean;
  /** Enable Proof layer integration */
  enableProofIntegration: boolean;
  /** Auto-start deliberation for high priority intents */
  autoStartHighPriority: boolean;
  /** Maximum concurrent sessions */
  maxConcurrentSessions: number;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_SERVICE_CONFIG: CouncilServiceConfig = {
  // Base council config
  defaultConsensusType: 'majority',
  minQuorumPercent: 60,
  maxRounds: 5,
  sessionTimeoutMs: 30 * 60 * 1000,
  votingTimeoutMs: 5 * 60 * 1000,
  enableWeightedVoting: true,
  enableDelegation: true,
  enablePrecedents: true,
  autoEscalateOnDeadlock: true,
  chairBreaksTies: true,
  minVotingTier: 'T2',
  requireDiverseSpecializations: true,
  // Service config
  enableIntentIntegration: true,
  enableEnforceIntegration: true,
  enableProofIntegration: true,
  autoStartHighPriority: true,
  maxConcurrentSessions: 10,
};

// =============================================================================
// COUNCIL SERVICE
// =============================================================================

/**
 * Multi-Agent Council Service
 *
 * Features:
 * - Full deliberation lifecycle management
 * - Integration with Intent, Enforce, and Proof layers
 * - Multiple consensus mechanisms
 * - Conflict resolution
 * - Precedent system
 * - Comprehensive audit trail
 * - Event-driven architecture
 */
export class CouncilService extends EventEmitter {
  private config: CouncilServiceConfig;
  private registry: CouncilMemberRegistry;
  private consensus: ConsensusEngine;
  private sessions: SessionManager;
  private conflicts: ConflictResolver;
  private decisions = new Map<string, CouncilDecision>();
  private proofs = new Map<string, CouncilProof>();
  private pendingIntents = new Map<string, CouncilIntent>();

  constructor(config?: Partial<CouncilServiceConfig>) {
    super();
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
    this.registry = createMemberRegistry();
    this.consensus = createConsensusEngine(this.registry, this.config);
    this.sessions = createSessionManager(this.registry, this.consensus, this.config);
    this.conflicts = createConflictResolver(this.registry);

    // Forward events
    this.sessions.on('council_event', (event: CouncilEvent) => {
      this.emit('council_event', event);
    });

    this.conflicts.on('conflict_detected', (conflict) => {
      this.emit('conflict_detected', conflict);
    });
  }

  // ===========================================================================
  // INTENT INTEGRATION
  // ===========================================================================

  /**
   * Submit an intent for council deliberation
   */
  async submitIntent(intent: CouncilIntent): Promise<DeliberationSession> {
    return tracer.startActiveSpan('council.submitIntent', async (span) => {
      span.setAttributes({
        'intent.id': intent.id,
        'intent.type': intent.type,
        'intent.priority': intent.priority,
      });

      try {
        // Store pending intent
        this.pendingIntents.set(intent.id, intent);

        // Create deliberation topic from intent
        const topic: DeliberationTopic = {
          id: nanoid(),
          title: intent.subject,
          description: intent.description,
          category: this.mapIntentTypeToCategory(intent.type),
          priority: intent.priority,
          context: {
            ...intent.context,
            intentId: intent.id,
            intentType: intent.type,
          },
          relatedIntentId: intent.id,
          submittedBy: intent.requestedBy,
          submittedAt: new Date(),
          deadline: intent.deadline,
        };

        // Determine consensus type based on priority and type
        const consensusType = this.determineConsensusType(intent);

        // Create session
        const session = this.sessions.createSession({
          topic,
          consensusType,
          selectionCriteria: this.buildSelectionCriteria(intent),
          timeoutMs: intent.deadline
            ? intent.deadline.getTime() - Date.now()
            : this.config.sessionTimeoutMs,
        });

        // Auto-start for high priority
        if (
          this.config.autoStartHighPriority &&
          (intent.priority === 'critical' || intent.priority === 'high')
        ) {
          this.sessions.startSession(session.id);
        }

        this.emit('intent_submitted', { intent, session });

        return session;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  // ===========================================================================
  // DELIBERATION LIFECYCLE
  // ===========================================================================

  /**
   * Start a deliberation session
   */
  startDeliberation(sessionId: string): DeliberationSession {
    return this.sessions.startSession(sessionId);
  }

  /**
   * Add a contribution to deliberation
   */
  addContribution(
    sessionId: string,
    memberId: string,
    params: {
      type: Contribution['type'];
      content: string;
      referencesProposalId?: string;
      confidence?: number;
    }
  ): Contribution {
    return this.sessions.addContribution(sessionId, memberId, params);
  }

  /**
   * Submit a proposal
   */
  submitProposal(
    sessionId: string,
    memberId: string,
    params: {
      title: string;
      description: string;
      action: Proposal['action'];
      rationale: string;
    }
  ): Proposal {
    return this.sessions.submitProposal(sessionId, memberId, params);
  }

  /**
   * Start voting on a proposal
   */
  startVoting(sessionId: string, proposalId: string): void {
    // Check for conflicts before voting
    const session = this.sessions.getSession(sessionId);
    const conflictResult = this.conflicts.detectConflicts(session);

    if (conflictResult.detected) {
      this.emit('conflicts_before_voting', {
        sessionId,
        conflicts: conflictResult.conflicts,
        recommendations: conflictResult.recommendations,
      });
    }

    this.sessions.startVoting(sessionId, proposalId);
  }

  /**
   * Cast a vote
   */
  castVote(
    sessionId: string,
    proposalId: string,
    memberId: string,
    params: {
      choice: VoteChoice;
      reasoning: string;
      confidence?: number;
      conditions?: string[];
    }
  ): Vote {
    return this.sessions.castVote(sessionId, proposalId, memberId, params);
  }

  /**
   * Finalize voting and get outcome
   */
  finalizeVoting(sessionId: string, proposalId: string): SessionOutcome {
    const outcome = this.sessions.finalizeVoting(sessionId, proposalId);

    // Create decision for Enforce layer
    if (this.config.enableEnforceIntegration) {
      this.createDecision(sessionId, outcome);
    }

    // Create proof for Proof layer
    if (this.config.enableProofIntegration) {
      this.createProof(sessionId, outcome);
    }

    return outcome;
  }

  /**
   * Complete a session
   */
  completeSession(sessionId: string): void {
    this.sessions.completeSession(sessionId);

    // Clean up pending intent
    const session = this.sessions.getSession(sessionId);
    if (session.topic.relatedIntentId) {
      this.pendingIntents.delete(session.topic.relatedIntentId);
    }
  }

  // ===========================================================================
  // ENFORCE INTEGRATION
  // ===========================================================================

  /**
   * Get decision for Enforce layer
   */
  getDecision(decisionId: string): CouncilDecision | undefined {
    return this.decisions.get(decisionId);
  }

  /**
   * Get decision by session ID
   */
  getDecisionBySession(sessionId: string): CouncilDecision | undefined {
    return Array.from(this.decisions.values()).find(
      (d) => d.sessionId === sessionId
    );
  }

  /**
   * Create decision for Enforce layer integration
   */
  private createDecision(sessionId: string, outcome: SessionOutcome): CouncilDecision {
    const session = this.sessions.getSession(sessionId);

    // Map outcome to enforce color
    let enforceColor: CouncilDecision['enforceColor'];
    let confidence: number;

    switch (outcome.decision) {
      case 'approved':
        enforceColor = 'GREEN';
        confidence = outcome.votingResult?.margin ? Math.min(100, 50 + outcome.votingResult.margin) / 100 : 0.8;
        break;
      case 'modified':
        enforceColor = 'YELLOW';
        confidence = 0.7;
        break;
      case 'denied':
        enforceColor = 'RED';
        confidence = outcome.votingResult?.margin ? Math.min(100, 50 + outcome.votingResult.margin) / 100 : 0.8;
        break;
      case 'deferred':
      case 'escalated':
        enforceColor = 'YELLOW';
        confidence = 0.5;
        break;
      case 'deadlocked':
      default:
        enforceColor = 'YELLOW';
        confidence = 0.3;
    }

    const decision: CouncilDecision = {
      id: nanoid(),
      intentId: session.topic.relatedIntentId ?? session.topic.id,
      sessionId,
      outcome,
      enforceColor,
      confidence,
      conditions: outcome.conditions,
      validUntil: outcome.expiresAt,
      appealDeadline: outcome.appealDeadline,
    };

    this.decisions.set(decision.id, decision);
    this.emit('decision_created', decision);

    return decision;
  }

  // ===========================================================================
  // PROOF INTEGRATION
  // ===========================================================================

  /**
   * Get proof for a decision
   */
  getProof(proofId: string): CouncilProof | undefined {
    return this.proofs.get(proofId);
  }

  /**
   * Get proof by session ID
   */
  getProofBySession(sessionId: string): CouncilProof | undefined {
    return Array.from(this.proofs.values()).find((p) => p.sessionId === sessionId);
  }

  /**
   * Create proof for Proof layer integration
   */
  private createProof(sessionId: string, outcome: SessionOutcome): CouncilProof {
    const session = this.sessions.getSession(sessionId);

    // Build vote records
    const votes = outcome.votingResult?.detailedVotes.map((v) => ({
      memberId: v.memberId,
      choice: v.choice,
      signature: v.signature,
    })) ?? [];

    // Create hash of the decision
    const proofData = {
      sessionId,
      outcomeId: outcome.id,
      decision: outcome.decision,
      votes,
      timestamp: new Date().toISOString(),
    };
    const hash = this.hashProofData(proofData);

    const proof: CouncilProof = {
      id: nanoid(),
      decisionId: outcome.id,
      sessionId,
      hash,
      votes,
      timestamp: new Date(),
      witnesses: session.members.map((m) => m.id),
    };

    this.proofs.set(proof.id, proof);
    this.emit('proof_created', proof);

    return proof;
  }

  private hashProofData(data: unknown): string {
    // Simple hash for demonstration - in production use crypto
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }

  // ===========================================================================
  // MEMBER MANAGEMENT
  // ===========================================================================

  /**
   * Register a council member
   */
  registerMember(params: Parameters<CouncilMemberRegistry['register']>[0]): CouncilMember {
    return this.registry.register(params);
  }

  /**
   * Get member by ID
   */
  getMember(memberId: string): CouncilMember | undefined {
    return this.registry.get(memberId);
  }

  /**
   * Get all active members
   */
  getActiveMembers(): CouncilMember[] {
    return this.registry.getActiveMembers();
  }

  /**
   * Delegate voting authority
   */
  delegate(fromMemberId: string, toMemberId: string): boolean {
    return this.registry.delegate(fromMemberId, toMemberId);
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DeliberationSession {
    return this.sessions.getSession(sessionId);
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): DeliberationSession[] {
    return this.sessions.getActiveSessions();
  }

  /**
   * Escalate a session
   */
  escalateSession(sessionId: string, reason: string): SessionOutcome {
    return this.sessions.escalateSession(sessionId, reason);
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string, reason: string): void {
    this.sessions.cancelSession(sessionId, reason);
  }

  // ===========================================================================
  // CONFLICT MANAGEMENT
  // ===========================================================================

  /**
   * Raise a conflict
   */
  raiseConflict(
    sessionId: string,
    params: Parameters<ConflictResolver['raiseConflict']>[1]
  ) {
    return this.conflicts.raiseConflict(sessionId, params);
  }

  /**
   * Request arbitration
   */
  requestArbitration(conflictId: string): CouncilMember | null {
    return this.conflicts.requestArbitration(conflictId);
  }

  /**
   * Get session conflicts
   */
  getSessionConflicts(sessionId: string) {
    return this.conflicts.getSessionConflicts(sessionId);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get council statistics
   */
  getStats(): {
    members: ReturnType<CouncilMemberRegistry['getStats']>;
    sessions: {
      active: number;
      completed: number;
      escalated: number;
    };
    decisions: {
      total: number;
      byColor: Record<string, number>;
    };
    conflicts: ReturnType<ConflictResolver['getResolutionStats']>;
  } {
    const activeSessions = this.sessions.getActiveSessions();

    return {
      members: this.registry.getStats(),
      sessions: {
        active: activeSessions.length,
        completed: 0, // Would track separately
        escalated: 0,
      },
      decisions: {
        total: this.decisions.size,
        byColor: {
          GREEN: Array.from(this.decisions.values()).filter((d) => d.enforceColor === 'GREEN').length,
          YELLOW: Array.from(this.decisions.values()).filter((d) => d.enforceColor === 'YELLOW').length,
          RED: Array.from(this.decisions.values()).filter((d) => d.enforceColor === 'RED').length,
        },
      },
      conflicts: this.conflicts.getResolutionStats(),
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private mapIntentTypeToCategory(
    intentType: CouncilIntent['type']
  ): DeliberationTopic['category'] {
    switch (intentType) {
      case 'policy_review':
        return 'policy';
      case 'action_approval':
        return 'action';
      case 'dispute_resolution':
        return 'dispute';
      case 'governance_change':
        return 'review';
      default:
        return 'review';
    }
  }

  private determineConsensusType(intent: CouncilIntent): ConsensusType {
    // Critical intents require supermajority
    if (intent.priority === 'critical') {
      return 'supermajority';
    }

    // Governance changes require supermajority
    if (intent.type === 'governance_change') {
      return 'supermajority';
    }

    // Disputes use weighted majority
    if (intent.type === 'dispute_resolution') {
      return 'weighted_majority';
    }

    // Default to configured type
    return this.config.defaultConsensusType;
  }

  private buildSelectionCriteria(intent: CouncilIntent): MemberSelectionCriteria {
    const criteria: MemberSelectionCriteria = {
      minCount: 3,
      maxCount: 7,
      requireDiversity: this.config.requireDiverseSpecializations,
      minTrustTier: this.config.minVotingTier,
    };

    // Critical intents need more members
    if (intent.priority === 'critical') {
      criteria.minCount = 5;
      criteria.maxCount = 9;
      criteria.minTrustTier = 'T3';
    }

    // High priority needs elevated trust
    if (intent.priority === 'high') {
      criteria.minTrustTier = 'T3';
    }

    // Add required specializations based on intent type
    switch (intent.type) {
      case 'policy_review':
        criteria.requiredSpecializations = ['compliance', 'legal'];
        break;
      case 'action_approval':
        criteria.requiredSpecializations = ['security', 'operations'];
        break;
      case 'dispute_resolution':
        criteria.requiredSpecializations = ['ethics'];
        break;
      case 'governance_change':
        criteria.requiredSpecializations = ['compliance', 'security', 'ethics'];
        break;
    }

    return criteria;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create council service
 */
export function createCouncilService(
  config?: Partial<CouncilServiceConfig>
): CouncilService {
  return new CouncilService(config);
}

/**
 * Singleton council service instance
 */
let serviceInstance: CouncilService | null = null;

/**
 * Get or create council service instance
 */
export function getCouncilService(
  config?: Partial<CouncilServiceConfig>
): CouncilService {
  if (!serviceInstance) {
    serviceInstance = new CouncilService(config);
  }
  return serviceInstance;
}

/**
 * Reset council service instance (for testing)
 */
export function resetCouncilService(): void {
  serviceInstance = null;
}
