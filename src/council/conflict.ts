/**
 * Conflict Resolution System
 *
 * Detects and resolves conflicts during council deliberations.
 * Supports multiple resolution methods including mediation, arbitration,
 * and escalation.
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import type {
  Conflict,
  ConflictType,
  ConflictResolution,
  CouncilMember,
  DeliberationSession,
  Vote,
  Contribution,
} from './types.js';
import { CouncilMemberRegistry } from './registry.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Conflict detection result
 */
export interface ConflictDetectionResult {
  detected: boolean;
  conflicts: Conflict[];
  recommendations: string[];
}

/**
 * Resolution strategy
 */
export type ResolutionStrategy =
  | 'mediation'
  | 'arbitration'
  | 'chair_ruling'
  | 'vote_of_confidence'
  | 'postponement'
  | 'escalation';

/**
 * Conflict resolver configuration
 */
export interface ConflictResolverConfig {
  /** Auto-detect conflicts */
  autoDetect: boolean;
  /** Allow chair to make binding rulings */
  chairCanRule: boolean;
  /** Maximum mediation rounds */
  maxMediationRounds: number;
  /** Conflict severity threshold for auto-escalation */
  autoEscalateSeverity: 'high' | 'critical';
  /** Enable interest conflict detection */
  detectInterestConflicts: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: ConflictResolverConfig = {
  autoDetect: true,
  chairCanRule: true,
  maxMediationRounds: 3,
  autoEscalateSeverity: 'critical',
  detectInterestConflicts: true,
};

// =============================================================================
// CONFLICT RESOLVER
// =============================================================================

/**
 * Conflict Resolver
 *
 * Features:
 * - Automatic conflict detection
 * - Multiple resolution strategies
 * - Mediation support
 * - Arbitration by designated arbitrators
 * - Chair rulings
 * - Interest conflict detection
 * - Escalation handling
 */
export class ConflictResolver extends EventEmitter {
  private config: ConflictResolverConfig;
  private registry: CouncilMemberRegistry;
  private conflicts = new Map<string, Conflict>();
  private resolutionHistory: Array<{ conflict: Conflict; resolution: ConflictResolution }> = [];

  constructor(registry: CouncilMemberRegistry, config?: Partial<ConflictResolverConfig>) {
    super();
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect conflicts in a session
   */
  detectConflicts(session: DeliberationSession): ConflictDetectionResult {
    const conflicts: Conflict[] = [];
    const recommendations: string[] = [];

    // Detect voting deadlock
    const deadlockConflict = this.detectDeadlock(session);
    if (deadlockConflict) {
      conflicts.push(deadlockConflict);
      recommendations.push('Consider using chair tie-breaker or advancing to mediation');
    }

    // Detect polarization
    const polarizationConflict = this.detectPolarization(session);
    if (polarizationConflict) {
      conflicts.push(polarizationConflict);
      recommendations.push('Consider compromise proposal or additional discussion round');
    }

    // Detect interest conflicts
    if (this.config.detectInterestConflicts) {
      const interestConflicts = this.detectInterestConflicts(session);
      conflicts.push(...interestConflicts);
      if (interestConflicts.length > 0) {
        recommendations.push('Consider recusal of conflicted members');
      }
    }

    // Detect procedural objections
    const proceduralConflicts = this.detectProceduralObjections(session);
    conflicts.push(...proceduralConflicts);

    // Store detected conflicts
    for (const conflict of conflicts) {
      this.conflicts.set(conflict.id, conflict);
      this.emit('conflict_detected', conflict);
    }

    return {
      detected: conflicts.length > 0,
      conflicts,
      recommendations,
    };
  }

  /**
   * Raise a conflict manually
   */
  raiseConflict(
    sessionId: string,
    params: {
      type: ConflictType;
      description: string;
      parties: string[];
      severity?: Conflict['severity'];
    }
  ): Conflict {
    const conflict: Conflict = {
      id: nanoid(),
      sessionId,
      type: params.type,
      description: params.description,
      parties: params.parties,
      severity: params.severity ?? 'medium',
      status: 'open',
      createdAt: new Date(),
    };

    this.conflicts.set(conflict.id, conflict);
    this.emit('conflict_raised', conflict);

    // Auto-escalate if severity is high enough
    if (
      this.config.autoEscalateSeverity === 'high' &&
      (conflict.severity === 'high' || conflict.severity === 'critical')
    ) {
      this.escalateConflict(conflict.id, 'Auto-escalated due to severity');
    } else if (
      this.config.autoEscalateSeverity === 'critical' &&
      conflict.severity === 'critical'
    ) {
      this.escalateConflict(conflict.id, 'Auto-escalated due to critical severity');
    }

    return conflict;
  }

  /**
   * Start mediation process
   */
  startMediation(conflictId: string, mediatorId: string): void {
    const conflict = this.getConflict(conflictId);
    conflict.status = 'mediating';

    this.emit('mediation_started', { conflictId, mediatorId });
  }

  /**
   * Propose a compromise resolution
   */
  proposeCompromise(
    conflictId: string,
    proposedBy: string,
    params: {
      description: string;
      terms: Record<string, unknown>;
    }
  ): { accepted: boolean; rejection_reasons?: string[] } {
    const conflict = this.getConflict(conflictId);

    // In a real implementation, this would involve the parties
    // For now, we simulate acceptance based on severity
    const accepted = conflict.severity === 'low' || conflict.severity === 'medium';

    if (accepted) {
      const resolution: ConflictResolution = {
        method: 'compromise',
        resolvedBy: proposedBy,
        decision: params.description,
        rationale: 'Compromise accepted by all parties',
        acceptedBy: conflict.parties,
        rejectedBy: [],
        binding: true,
        appealable: true,
      };

      this.resolveConflict(conflictId, resolution);
    }

    return {
      accepted,
      rejection_reasons: accepted ? undefined : ['Parties could not agree on terms'],
    };
  }

  /**
   * Request arbitration
   */
  requestArbitration(conflictId: string): CouncilMember | null {
    const conflict = this.getConflict(conflictId);

    // Find available arbitrator
    const arbitrators = this.registry.getMembersByRole('arbitrator');
    const availableArbitrator = arbitrators.find(
      (a) => !conflict.parties.includes(a.id)
    );

    if (!availableArbitrator) {
      return null;
    }

    conflict.status = 'mediating';
    this.emit('arbitration_requested', { conflictId, arbitratorId: availableArbitrator.id });

    return availableArbitrator;
  }

  /**
   * Submit arbitration decision
   */
  submitArbitrationDecision(
    conflictId: string,
    arbitratorId: string,
    params: {
      decision: string;
      rationale: string;
      binding: boolean;
    }
  ): void {
    const conflict = this.getConflict(conflictId);
    const arbitrator = this.registry.get(arbitratorId);

    if (!arbitrator || arbitrator.role !== 'arbitrator') {
      throw new Error(`${arbitratorId} is not an arbitrator`);
    }

    const resolution: ConflictResolution = {
      method: 'arbitration',
      resolvedBy: arbitratorId,
      decision: params.decision,
      rationale: params.rationale,
      acceptedBy: [], // Will be populated based on responses
      rejectedBy: [],
      binding: params.binding,
      appealable: !params.binding,
    };

    this.resolveConflict(conflictId, resolution);
  }

  /**
   * Chair ruling
   */
  chairRuling(
    conflictId: string,
    chairId: string,
    params: {
      decision: string;
      rationale: string;
    }
  ): void {
    if (!this.config.chairCanRule) {
      throw new Error('Chair rulings are not enabled');
    }

    const conflict = this.getConflict(conflictId);
    const chair = this.registry.get(chairId);

    if (!chair || chair.role !== 'chair') {
      throw new Error(`${chairId} is not a chair`);
    }

    const resolution: ConflictResolution = {
      method: 'chair_decision',
      resolvedBy: chairId,
      decision: params.decision,
      rationale: params.rationale,
      acceptedBy: [],
      rejectedBy: [],
      binding: true,
      appealable: true,
    };

    this.resolveConflict(conflictId, resolution);
  }

  /**
   * Postpone conflict resolution
   */
  postponeConflict(conflictId: string, until: Date, reason: string): void {
    const conflict = this.getConflict(conflictId);

    const resolution: ConflictResolution = {
      method: 'postponement',
      resolvedBy: 'system',
      decision: `Postponed until ${until.toISOString()}`,
      rationale: reason,
      acceptedBy: [],
      rejectedBy: [],
      binding: false,
      appealable: false,
    };

    conflict.resolution = resolution;
    conflict.status = 'resolved';
    conflict.resolvedAt = new Date();

    this.emit('conflict_postponed', { conflictId, until, reason });
  }

  /**
   * Escalate conflict
   */
  escalateConflict(conflictId: string, reason: string): void {
    const conflict = this.getConflict(conflictId);

    const resolution: ConflictResolution = {
      method: 'escalation',
      resolvedBy: 'system',
      decision: 'Escalated to higher authority',
      rationale: reason,
      acceptedBy: [],
      rejectedBy: [],
      binding: false,
      appealable: false,
    };

    conflict.resolution = resolution;
    conflict.status = 'escalated';
    conflict.resolvedAt = new Date();

    this.emit('conflict_escalated', { conflictId, reason });
  }

  /**
   * Resolve a conflict
   */
  resolveConflict(conflictId: string, resolution: ConflictResolution): void {
    const conflict = this.getConflict(conflictId);

    conflict.resolution = resolution;
    conflict.status = 'resolved';
    conflict.resolvedAt = new Date();

    this.resolutionHistory.push({ conflict, resolution });

    this.emit('conflict_resolved', { conflictId, resolution });
  }

  /**
   * Get conflict by ID
   */
  getConflict(conflictId: string): Conflict {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }
    return conflict;
  }

  /**
   * Get conflicts for a session
   */
  getSessionConflicts(sessionId: string): Conflict[] {
    return Array.from(this.conflicts.values()).filter(
      (c) => c.sessionId === sessionId
    );
  }

  /**
   * Get open conflicts
   */
  getOpenConflicts(): Conflict[] {
    return Array.from(this.conflicts.values()).filter(
      (c) => c.status === 'open' || c.status === 'mediating'
    );
  }

  /**
   * Get resolution statistics
   */
  getResolutionStats(): {
    total: number;
    byMethod: Record<ConflictResolution['method'], number>;
    byType: Record<ConflictType, number>;
    averageResolutionTimeMs: number;
  } {
    const stats = {
      total: this.resolutionHistory.length,
      byMethod: {
        chair_decision: 0,
        compromise: 0,
        arbitration: 0,
        escalation: 0,
        postponement: 0,
      } as Record<ConflictResolution['method'], number>,
      byType: {
        voting_deadlock: 0,
        policy_conflict: 0,
        interest_conflict: 0,
        authority_dispute: 0,
        procedural_objection: 0,
      } as Record<ConflictType, number>,
      averageResolutionTimeMs: 0,
    };

    let totalTime = 0;

    for (const { conflict, resolution } of this.resolutionHistory) {
      stats.byMethod[resolution.method]++;
      stats.byType[conflict.type]++;

      if (conflict.resolvedAt) {
        totalTime += conflict.resolvedAt.getTime() - conflict.createdAt.getTime();
      }
    }

    if (this.resolutionHistory.length > 0) {
      stats.averageResolutionTimeMs = totalTime / this.resolutionHistory.length;
    }

    return stats;
  }

  // ===========================================================================
  // PRIVATE DETECTION METHODS
  // ===========================================================================

  private detectDeadlock(session: DeliberationSession): Conflict | null {
    if (session.status !== 'voting') return null;

    // Find the active proposal being voted on
    const currentRound = session.rounds[session.currentRound - 1];
    if (!currentRound) return null;

    const activeProposal = currentRound.proposals.find((p) => p.status === 'active');
    if (!activeProposal) return null;

    // Check votes for this proposal
    const proposalVotes = session.votes.filter((v) => v.proposalId === activeProposal.id);
    const approves = proposalVotes.filter((v) => v.choice === 'approve').length;
    const denies = proposalVotes.filter((v) => v.choice === 'deny').length;

    // Detect 50/50 split or near-deadlock
    const totalVotes = approves + denies;
    if (totalVotes > 0 && Math.abs(approves - denies) <= 1) {
      return {
        id: nanoid(),
        sessionId: session.id,
        type: 'voting_deadlock',
        description: `Voting deadlock on proposal "${activeProposal.title}": ${approves} approve, ${denies} deny`,
        parties: proposalVotes.map((v) => v.memberId),
        severity: 'medium',
        status: 'open',
        createdAt: new Date(),
      };
    }

    return null;
  }

  private detectPolarization(session: DeliberationSession): Conflict | null {
    // Analyze contributions for polarization
    const currentRound = session.rounds[session.currentRound - 1];
    if (!currentRound || currentRound.contributions.length < 4) return null;

    const supports = currentRound.contributions.filter((c) => c.type === 'support').length;
    const objections = currentRound.contributions.filter((c) => c.type === 'objection').length;

    // High objection rate indicates polarization
    const total = supports + objections;
    if (total > 0 && objections > supports && objections >= 3) {
      const objectors = currentRound.contributions
        .filter((c) => c.type === 'objection')
        .map((c) => c.memberId);
      const supporters = currentRound.contributions
        .filter((c) => c.type === 'support')
        .map((c) => c.memberId);

      return {
        id: nanoid(),
        sessionId: session.id,
        type: 'policy_conflict',
        description: `High polarization detected: ${objections} objections vs ${supports} supports`,
        parties: [...new Set([...objectors, ...supporters])],
        severity: objections > supports * 2 ? 'high' : 'medium',
        status: 'open',
        createdAt: new Date(),
      };
    }

    return null;
  }

  private detectInterestConflicts(session: DeliberationSession): Conflict[] {
    const conflicts: Conflict[] = [];

    // Check if any member has a potential conflict of interest
    // based on topic metadata
    const topicContext = session.topic.context as Record<string, unknown>;

    for (const member of session.members) {
      // Check for direct involvement
      if (topicContext.involvedAgents && Array.isArray(topicContext.involvedAgents)) {
        if ((topicContext.involvedAgents as string[]).includes(member.agentId)) {
          conflicts.push({
            id: nanoid(),
            sessionId: session.id,
            type: 'interest_conflict',
            description: `Member ${member.name} is directly involved in the topic under deliberation`,
            parties: [member.id],
            severity: 'high',
            status: 'open',
            createdAt: new Date(),
          });
        }
      }

      // Check for same-organization conflict
      if (topicContext.organizationId && member.metadata?.organizationId === topicContext.organizationId) {
        conflicts.push({
          id: nanoid(),
          sessionId: session.id,
          type: 'interest_conflict',
          description: `Member ${member.name} belongs to the same organization as the topic subject`,
          parties: [member.id],
          severity: 'medium',
          status: 'open',
          createdAt: new Date(),
        });
      }
    }

    return conflicts;
  }

  private detectProceduralObjections(session: DeliberationSession): Conflict[] {
    const conflicts: Conflict[] = [];

    // Check for procedural objection contributions
    for (const round of session.rounds) {
      const objections = round.contributions.filter(
        (c) => c.type === 'objection' && c.content.toLowerCase().includes('procedur')
      );

      for (const objection of objections) {
        conflicts.push({
          id: nanoid(),
          sessionId: session.id,
          type: 'procedural_objection',
          description: objection.content,
          parties: [objection.memberId],
          severity: 'low',
          status: 'open',
          createdAt: new Date(),
        });
      }
    }

    return conflicts;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create conflict resolver
 */
export function createConflictResolver(
  registry: CouncilMemberRegistry,
  config?: Partial<ConflictResolverConfig>
): ConflictResolver {
  return new ConflictResolver(registry, config);
}
