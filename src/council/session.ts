/**
 * Deliberation Session Manager
 *
 * Manages the lifecycle of council deliberation sessions including
 * rounds, contributions, proposals, voting, and outcome determination.
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import type {
  DeliberationSession,
  DeliberationTopic,
  DeliberationRound,
  Contribution,
  Proposal,
  ProposedAction,
  Amendment,
  Vote,
  VoteChoice,
  SessionOutcome,
  SessionStatus,
  CouncilMember,
  CouncilConfig,
  ConsensusType,
  CouncilEvent,
  CouncilEventType,
  MemberSelectionCriteria,
  Precedent,
  PrecedentMatch,
} from './types.js';
import { CouncilMemberRegistry } from './registry.js';
import { ConsensusEngine } from './consensus.js';

// =============================================================================
// SESSION MANAGER
// =============================================================================

/**
 * Deliberation Session Manager
 *
 * Features:
 * - Session lifecycle management
 * - Round-based deliberation protocol
 * - Contribution and proposal tracking
 * - Voting orchestration
 * - Precedent matching
 * - Timeout and escalation handling
 * - Event-driven architecture
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, DeliberationSession>();
  private registry: CouncilMemberRegistry;
  private consensus: ConsensusEngine;
  private config: CouncilConfig;
  private precedents: Precedent[] = [];
  private timeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    registry: CouncilMemberRegistry,
    consensus: ConsensusEngine,
    config: CouncilConfig
  ) {
    super();
    this.registry = registry;
    this.consensus = consensus;
    this.config = config;
  }

  /**
   * Create a new deliberation session
   */
  createSession(params: {
    topic: DeliberationTopic;
    selectionCriteria?: MemberSelectionCriteria;
    consensusType?: ConsensusType;
    timeoutMs?: number;
  }): DeliberationSession {
    const { topic, selectionCriteria, consensusType, timeoutMs } = params;

    // Select members
    const criteria: MemberSelectionCriteria = selectionCriteria ?? {
      minTrustTier: this.config.minVotingTier,
      minCount: 3,
      maxCount: 7,
      requireDiversity: this.config.requireDiverseSpecializations,
    };

    const members = this.registry.selectMembers(criteria);

    if (members.length < criteria.minCount) {
      throw new Error(
        `Insufficient eligible members: ${members.length} < ${criteria.minCount}`
      );
    }

    // Calculate quorum
    const quorumRequired = Math.ceil(
      members.length * (this.config.minQuorumPercent / 100)
    );

    const session: DeliberationSession = {
      id: nanoid(),
      topic,
      members,
      status: 'pending',
      consensusType: consensusType ?? this.config.defaultConsensusType,
      quorumRequired,
      currentRound: 0,
      maxRounds: this.config.maxRounds,
      rounds: [],
      votes: [],
      createdAt: new Date(),
      timeoutAt: new Date(Date.now() + (timeoutMs ?? this.config.sessionTimeoutMs)),
    };

    this.sessions.set(session.id, session);
    this.emitEvent(session.id, 'session_created', { topic });

    // Set timeout
    this.setSessionTimeout(session);

    return session;
  }

  /**
   * Start a session
   */
  startSession(sessionId: string): DeliberationSession {
    const session = this.getSession(sessionId);

    if (session.status !== 'pending') {
      throw new Error(`Session ${sessionId} is not pending`);
    }

    session.status = 'in_progress';
    session.startedAt = new Date();

    // Check for precedents
    if (this.config.enablePrecedents) {
      const matches = this.findPrecedents(session.topic);
      if (matches.length > 0) {
        session.metadata = {
          ...session.metadata,
          precedentMatches: matches,
        };
      }
    }

    // Start first round
    this.startRound(session);

    this.emitEvent(sessionId, 'session_started', {
      members: session.members.map((m) => m.id),
    });

    return session;
  }

  /**
   * Add a contribution to the current round
   */
  addContribution(
    sessionId: string,
    memberId: string,
    params: {
      type: Contribution['type'];
      content: string;
      referencesProposalId?: string;
      referencesContributionId?: string;
      confidence?: number;
      sentiment?: Contribution['sentiment'];
    }
  ): Contribution {
    const session = this.getSession(sessionId);

    if (session.status !== 'in_progress') {
      throw new Error(`Session ${sessionId} is not in progress`);
    }

    // Verify member is part of session
    const member = session.members.find((m) => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} is not in session ${sessionId}`);
    }

    const currentRound = session.rounds[session.currentRound - 1];
    if (!currentRound) {
      throw new Error(`No active round in session ${sessionId}`);
    }

    const contribution: Contribution = {
      id: nanoid(),
      memberId,
      roundNumber: session.currentRound,
      type: params.type,
      content: params.content,
      referencesProposalId: params.referencesProposalId,
      referencesContributionId: params.referencesContributionId,
      confidence: params.confidence ?? 0.8,
      sentiment: params.sentiment ?? 'neutral',
      timestamp: new Date(),
    };

    currentRound.contributions.push(contribution);

    this.emitEvent(sessionId, 'contribution_added', {
      contributionId: contribution.id,
      memberId,
      type: params.type,
    });

    // Update member activity
    this.registry.update(memberId, { lastActiveAt: new Date() });

    return contribution;
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
      action: ProposedAction;
      rationale: string;
    }
  ): Proposal {
    const session = this.getSession(sessionId);

    if (session.status !== 'in_progress') {
      throw new Error(`Session ${sessionId} is not in progress`);
    }

    const member = session.members.find((m) => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} is not in session ${sessionId}`);
    }

    const currentRound = session.rounds[session.currentRound - 1];
    if (!currentRound) {
      throw new Error(`No active round in session ${sessionId}`);
    }

    const proposal: Proposal = {
      id: nanoid(),
      proposedBy: memberId,
      roundNumber: session.currentRound,
      title: params.title,
      description: params.description,
      action: params.action,
      rationale: params.rationale,
      supporters: [memberId],
      objectors: [],
      amendments: [],
      status: 'active',
      createdAt: new Date(),
    };

    currentRound.proposals.push(proposal);

    this.emitEvent(sessionId, 'proposal_submitted', {
      proposalId: proposal.id,
      memberId,
      action: params.action.type,
    });

    return proposal;
  }

  /**
   * Amend a proposal
   */
  amendProposal(
    sessionId: string,
    proposalId: string,
    memberId: string,
    params: {
      description: string;
      changes: Record<string, unknown>;
    }
  ): Amendment {
    const session = this.getSession(sessionId);
    const proposal = this.findProposal(session, proposalId);

    if (!proposal || proposal.status !== 'active') {
      throw new Error(`Proposal ${proposalId} is not active`);
    }

    const amendment: Amendment = {
      id: nanoid(),
      proposalId,
      amendedBy: memberId,
      description: params.description,
      changes: params.changes,
      accepted: false,
      timestamp: new Date(),
    };

    proposal.amendments.push(amendment);

    this.emitEvent(sessionId, 'proposal_amended', {
      proposalId,
      amendmentId: amendment.id,
      memberId,
    });

    return amendment;
  }

  /**
   * Support or object to a proposal
   */
  expressPosition(
    sessionId: string,
    proposalId: string,
    memberId: string,
    position: 'support' | 'object'
  ): void {
    const session = this.getSession(sessionId);
    const proposal = this.findProposal(session, proposalId);

    if (!proposal || proposal.status !== 'active') {
      throw new Error(`Proposal ${proposalId} is not active`);
    }

    // Remove from both lists first
    proposal.supporters = proposal.supporters.filter((id) => id !== memberId);
    proposal.objectors = proposal.objectors.filter((id) => id !== memberId);

    // Add to appropriate list
    if (position === 'support') {
      proposal.supporters.push(memberId);
    } else {
      proposal.objectors.push(memberId);
    }
  }

  /**
   * Advance to voting phase
   */
  startVoting(sessionId: string, proposalId: string): void {
    const session = this.getSession(sessionId);

    if (session.status !== 'in_progress') {
      throw new Error(`Session ${sessionId} is not in progress`);
    }

    const proposal = this.findProposal(session, proposalId);
    if (!proposal || proposal.status !== 'active') {
      throw new Error(`Proposal ${proposalId} is not active`);
    }

    session.status = 'voting';

    this.emitEvent(sessionId, 'voting_started', { proposalId });

    // Set voting timeout
    const votingTimeout = setTimeout(
      () => this.handleVotingTimeout(sessionId, proposalId),
      this.config.votingTimeoutMs
    );
    this.timeouts.set(`voting-${sessionId}`, votingTimeout);
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
    const session = this.getSession(sessionId);

    if (session.status !== 'voting') {
      throw new Error(`Session ${sessionId} is not in voting phase`);
    }

    const member = session.members.find((m) => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} is not in session ${sessionId}`);
    }

    // Check if already voted
    const existingVote = session.votes.find(
      (v) => v.memberId === memberId && v.proposalId === proposalId
    );
    if (existingVote) {
      throw new Error(`Member ${memberId} has already voted on ${proposalId}`);
    }

    const vote: Vote = {
      id: nanoid(),
      sessionId,
      proposalId,
      memberId,
      choice: params.choice,
      weight: this.registry.getEffectiveWeight(memberId),
      reasoning: params.reasoning,
      confidence: params.confidence ?? 0.8,
      conditions: params.conditions,
      timestamp: new Date(),
    };

    session.votes.push(vote);

    this.emitEvent(sessionId, 'vote_cast', {
      voteId: vote.id,
      memberId,
      choice: params.choice,
    });

    // Check if all members have voted
    const votedCount = session.votes.filter((v) => v.proposalId === proposalId).length;
    if (votedCount >= session.members.length) {
      this.finalizeVoting(sessionId, proposalId);
    }

    return vote;
  }

  /**
   * Finalize voting and determine outcome
   */
  finalizeVoting(sessionId: string, proposalId: string): SessionOutcome {
    const session = this.getSession(sessionId);

    // Clear voting timeout
    const timeoutKey = `voting-${sessionId}`;
    const timeout = this.timeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(timeoutKey);
    }

    // Calculate result
    const proposalVotes = session.votes.filter((v) => v.proposalId === proposalId);
    const result = this.consensus.calculate(
      proposalId,
      proposalVotes,
      session.members,
      session.consensusType
    );

    // Check for deadlock
    if (!result.consensusReached && result.quorumMet) {
      // Try chair tie-breaker
      const chair = session.members.find((m) => m.role === 'chair');
      if (chair && this.config.chairBreaksTies) {
        const chairVote = proposalVotes.find((v) => v.memberId === chair.id);
        if (chairVote) {
          const updatedResult = this.consensus.applyTieBreaker(
            result,
            chair,
            chairVote.choice
          );
          if (updatedResult.consensusReached) {
            return this.buildOutcome(session, proposalId, updatedResult);
          }
        }
      }

      // Still deadlocked
      if (this.config.autoEscalateOnDeadlock) {
        return this.escalateSession(sessionId, 'Voting deadlock');
      }

      session.status = 'deadlocked';
      this.emitEvent(sessionId, 'deadlock_detected', { proposalId });

      return this.buildOutcome(session, proposalId, result);
    }

    if (!result.quorumMet) {
      // Quorum not met
      session.status = 'deadlocked';
      this.emitEvent(sessionId, 'deadlock_detected', {
        proposalId,
        reason: 'Quorum not met',
      });

      return this.buildOutcome(session, proposalId, result);
    }

    // Consensus reached
    session.status = 'consensus_reached';
    this.emitEvent(sessionId, 'consensus_reached', {
      proposalId,
      outcome: result.outcome,
    });

    return this.buildOutcome(session, proposalId, result);
  }

  /**
   * Advance to next round
   */
  advanceRound(sessionId: string): DeliberationRound {
    const session = this.getSession(sessionId);

    if (session.currentRound >= session.maxRounds) {
      throw new Error(`Maximum rounds (${session.maxRounds}) reached`);
    }

    // Complete current round
    const currentRound = session.rounds[session.currentRound - 1];
    if (currentRound) {
      currentRound.completedAt = new Date();
    }

    // Start new round
    return this.startRound(session);
  }

  /**
   * Escalate session
   */
  escalateSession(sessionId: string, reason: string): SessionOutcome {
    const session = this.getSession(sessionId);

    session.status = 'escalated';
    session.completedAt = new Date();

    const outcome: SessionOutcome = {
      id: nanoid(),
      sessionId,
      decision: 'escalated',
      conditions: [],
      rationale: reason,
      dissent: [],
      effectiveAt: new Date(),
      enforcementActions: [
        {
          type: 'escalate',
          target: 'human_review',
          parameters: { reason, sessionId },
          status: 'pending',
        },
      ],
    };

    session.outcome = outcome;

    this.emitEvent(sessionId, 'session_escalated', { reason });

    return outcome;
  }

  /**
   * Complete session
   */
  completeSession(sessionId: string): void {
    const session = this.getSession(sessionId);

    if (!session.outcome) {
      throw new Error(`Session ${sessionId} has no outcome`);
    }

    session.status = 'completed';
    session.completedAt = new Date();

    // Clear any timeouts
    this.clearSessionTimeouts(sessionId);

    // Create precedent if applicable
    if (this.config.enablePrecedents && session.outcome.decision !== 'escalated') {
      this.createPrecedent(session);
    }

    this.emitEvent(sessionId, 'session_completed', {
      outcome: session.outcome.decision,
    });
  }

  /**
   * Cancel session
   */
  cancelSession(sessionId: string, reason: string): void {
    const session = this.getSession(sessionId);

    session.status = 'cancelled';
    session.completedAt = new Date();
    session.metadata = { ...session.metadata, cancellationReason: reason };

    this.clearSessionTimeouts(sessionId);

    this.emitEvent(sessionId, 'session_cancelled', { reason });
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DeliberationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): DeliberationSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'pending' || s.status === 'in_progress' || s.status === 'voting'
    );
  }

  /**
   * Find matching precedents
   */
  findPrecedents(topic: DeliberationTopic): PrecedentMatch[] {
    const matches: PrecedentMatch[] = [];

    for (const precedent of this.precedents) {
      if (!precedent.active) continue;

      // Simple similarity based on category and tags
      let similarity = 0;

      if (precedent.category === topic.category) {
        similarity += 30;
      }

      // Check tag overlap (simplified)
      const topicText = `${topic.title} ${topic.description}`.toLowerCase();
      for (const tag of precedent.tags) {
        if (topicText.includes(tag.toLowerCase())) {
          similarity += 10;
        }
      }

      if (similarity >= precedent.applicability) {
        matches.push({
          precedent,
          similarity,
          applicableConditions: precedent.conditions,
          recommendation: similarity >= 70 ? 'apply' : similarity >= 50 ? 'consider' : 'distinguish',
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  /**
   * Add a precedent
   */
  addPrecedent(precedent: Precedent): void {
    this.precedents.push(precedent);
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private startRound(session: DeliberationSession): DeliberationRound {
    session.currentRound++;

    const round: DeliberationRound = {
      roundNumber: session.currentRound,
      phase: 'discussion',
      contributions: [],
      proposals: [],
      startedAt: new Date(),
    };

    session.rounds.push(round);

    this.emitEvent(session.id, 'round_started', {
      roundNumber: session.currentRound,
    });

    return round;
  }

  private findProposal(session: DeliberationSession, proposalId: string): Proposal | undefined {
    for (const round of session.rounds) {
      const proposal = round.proposals.find((p) => p.id === proposalId);
      if (proposal) return proposal;
    }
    return undefined;
  }

  private buildOutcome(
    session: DeliberationSession,
    proposalId: string,
    result: import('./types.js').VotingResult
  ): SessionOutcome {
    const proposal = this.findProposal(session, proposalId);

    // Map voting result to decision
    let decision: SessionOutcome['decision'];
    switch (result.outcome) {
      case 'approve':
        decision = proposal?.action.type === 'modify' ? 'modified' : 'approved';
        break;
      case 'deny':
        decision = 'denied';
        break;
      case 'defer':
        decision = 'deferred';
        break;
      default:
        decision = 'deadlocked';
    }

    // Collect dissent
    const dissent = result.detailedVotes
      .filter((v) => v.choice === 'deny' && result.outcome === 'approve')
      .map((v) => ({
        memberId: v.memberId,
        reason: v.reasoning,
        severity: v.confidence > 0.8 ? 'major' : 'minor' as const,
        timestamp: v.timestamp,
      }));

    const outcome: SessionOutcome = {
      id: nanoid(),
      sessionId: session.id,
      decision,
      winningProposalId: proposalId,
      votingResult: result,
      conditions: proposal?.action.conditions ?? [],
      rationale: proposal?.rationale ?? 'Majority decision',
      dissent,
      effectiveAt: new Date(),
      enforcementActions: [],
    };

    session.outcome = outcome;

    return outcome;
  }

  private handleVotingTimeout(sessionId: string, proposalId: string): void {
    try {
      const session = this.sessions.get(sessionId);
      if (!session || session.status !== 'voting') return;

      // Finalize with current votes
      this.finalizeVoting(sessionId, proposalId);
    } catch {
      // Session may have been completed
    }
  }

  private setSessionTimeout(session: DeliberationSession): void {
    const timeoutMs = session.timeoutAt.getTime() - Date.now();
    if (timeoutMs <= 0) return;

    const timeout = setTimeout(() => {
      if (session.status === 'in_progress' || session.status === 'voting') {
        this.escalateSession(session.id, 'Session timeout');
      }
    }, timeoutMs);

    this.timeouts.set(`session-${session.id}`, timeout);
  }

  private clearSessionTimeouts(sessionId: string): void {
    const sessionTimeout = this.timeouts.get(`session-${sessionId}`);
    if (sessionTimeout) {
      clearTimeout(sessionTimeout);
      this.timeouts.delete(`session-${sessionId}`);
    }

    const votingTimeout = this.timeouts.get(`voting-${sessionId}`);
    if (votingTimeout) {
      clearTimeout(votingTimeout);
      this.timeouts.delete(`voting-${sessionId}`);
    }
  }

  private createPrecedent(session: DeliberationSession): void {
    if (!session.outcome) return;

    const precedent: Precedent = {
      id: nanoid(),
      sessionId: session.id,
      category: session.topic.category,
      tags: this.extractTags(session.topic),
      summary: session.topic.title,
      decision: session.outcome.decision,
      rationale: session.outcome.rationale,
      conditions: session.outcome.conditions,
      applicability: 50,
      citations: 0,
      createdAt: new Date(),
      active: true,
    };

    this.precedents.push(precedent);
  }

  private extractTags(topic: DeliberationTopic): string[] {
    // Simple tag extraction from title and description
    const text = `${topic.title} ${topic.description}`.toLowerCase();
    const words = text.split(/\s+/).filter((w) => w.length > 4);
    return [...new Set(words)].slice(0, 10);
  }

  private emitEvent(
    sessionId: string,
    type: CouncilEventType,
    data: Record<string, unknown>
  ): void {
    const event: CouncilEvent = {
      id: nanoid(),
      type,
      sessionId,
      data,
      timestamp: new Date(),
    };

    this.emit(type, event);
    this.emit('council_event', event);
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create session manager
 */
export function createSessionManager(
  registry: CouncilMemberRegistry,
  consensus: ConsensusEngine,
  config: CouncilConfig
): SessionManager {
  return new SessionManager(registry, consensus, config);
}
