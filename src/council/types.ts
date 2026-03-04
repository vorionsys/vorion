/**
 * Multi-Agent Council Types
 *
 * Type definitions for the enterprise multi-agent council system.
 * Supports deliberation, consensus, voting, and collective decision-making.
 *
 * @packageDocumentation
 */

// =============================================================================
// COUNCIL MEMBER TYPES
// =============================================================================

/**
 * Council member roles
 */
export type CouncilRole =
  | 'chair'           // Session moderator, tie-breaker
  | 'advisor'         // Domain expert, advisory vote
  | 'validator'       // Voting member
  | 'observer'        // Read-only participant
  | 'arbitrator'      // Conflict resolution specialist
  | 'delegate';       // Delegated voting authority

/**
 * Member specializations
 */
export type MemberSpecialization =
  | 'security'
  | 'compliance'
  | 'ethics'
  | 'technical'
  | 'business'
  | 'legal'
  | 'risk'
  | 'operations'
  | 'general';

/**
 * Council member trust tier
 */
export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7';

/**
 * Council member definition
 */
export interface CouncilMember {
  id: string;
  agentId: string;
  name: string;
  role: CouncilRole;
  specializations: MemberSpecialization[];
  trustTier: TrustTier;
  trustScore: number;
  votingWeight: number;
  delegatedFrom?: string[];
  delegatedTo?: string;
  active: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Member selection criteria
 */
export interface MemberSelectionCriteria {
  minTrustTier?: TrustTier;
  minTrustScore?: number;
  requiredSpecializations?: MemberSpecialization[];
  excludeMembers?: string[];
  preferMembers?: string[];
  minCount: number;
  maxCount: number;
  requireDiversity?: boolean;
}

// =============================================================================
// DELIBERATION TYPES
// =============================================================================

/**
 * Deliberation topic
 */
export interface DeliberationTopic {
  id: string;
  title: string;
  description: string;
  category: 'policy' | 'action' | 'dispute' | 'escalation' | 'review';
  priority: 'critical' | 'high' | 'medium' | 'low';
  context: Record<string, unknown>;
  relatedIntentId?: string;
  relatedEnforceDecisionId?: string;
  submittedBy: string;
  submittedAt: Date;
  deadline?: Date;
}

/**
 * Deliberation session status
 */
export type SessionStatus =
  | 'pending'
  | 'in_progress'
  | 'voting'
  | 'consensus_reached'
  | 'deadlocked'
  | 'escalated'
  | 'completed'
  | 'cancelled';

/**
 * Deliberation session
 */
export interface DeliberationSession {
  id: string;
  topic: DeliberationTopic;
  members: CouncilMember[];
  status: SessionStatus;
  consensusType: ConsensusType;
  quorumRequired: number;
  currentRound: number;
  maxRounds: number;
  rounds: DeliberationRound[];
  votes: Vote[];
  outcome?: SessionOutcome;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeoutAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Deliberation round
 */
export interface DeliberationRound {
  roundNumber: number;
  phase: 'discussion' | 'proposal' | 'refinement' | 'voting';
  contributions: Contribution[];
  proposals: Proposal[];
  startedAt: Date;
  completedAt?: Date;
  summary?: string;
}

/**
 * Member contribution in a round
 */
export interface Contribution {
  id: string;
  memberId: string;
  roundNumber: number;
  type: 'argument' | 'question' | 'clarification' | 'objection' | 'support' | 'amendment';
  content: string;
  referencesProposalId?: string;
  referencesContributionId?: string;
  confidence: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: Date;
}

/**
 * Proposal for voting
 */
export interface Proposal {
  id: string;
  proposedBy: string;
  roundNumber: number;
  title: string;
  description: string;
  action: ProposedAction;
  rationale: string;
  supporters: string[];
  objectors: string[];
  amendments: Amendment[];
  status: 'draft' | 'active' | 'withdrawn' | 'superseded' | 'accepted' | 'rejected';
  createdAt: Date;
}

/**
 * Proposed action
 */
export interface ProposedAction {
  type: 'approve' | 'deny' | 'modify' | 'defer' | 'escalate';
  conditions?: string[];
  modifications?: Record<string, unknown>;
  deferUntil?: Date;
  escalateTo?: string;
}

/**
 * Amendment to a proposal
 */
export interface Amendment {
  id: string;
  proposalId: string;
  amendedBy: string;
  description: string;
  changes: Record<string, unknown>;
  accepted: boolean;
  timestamp: Date;
}

// =============================================================================
// VOTING TYPES
// =============================================================================

/**
 * Consensus type for voting
 */
export type ConsensusType =
  | 'unanimous'           // All must agree
  | 'supermajority'       // 2/3 or more
  | 'majority'            // >50%
  | 'plurality'           // Most votes wins
  | 'weighted_majority'   // Weighted by trust score
  | 'ranked_choice';      // Ranked preference voting

/**
 * Vote choice
 */
export type VoteChoice = 'approve' | 'deny' | 'abstain' | 'defer';

/**
 * Individual vote
 */
export interface Vote {
  id: string;
  sessionId: string;
  proposalId: string;
  memberId: string;
  choice: VoteChoice;
  weight: number;
  reasoning: string;
  confidence: number;
  conditions?: string[];
  delegatedFrom?: string;
  timestamp: Date;
  signature?: string;
}

/**
 * Voting result
 */
export interface VotingResult {
  proposalId: string;
  totalVotes: number;
  weightedTotal: number;
  breakdown: {
    approve: { count: number; weight: number };
    deny: { count: number; weight: number };
    abstain: { count: number; weight: number };
    defer: { count: number; weight: number };
  };
  quorumMet: boolean;
  consensusReached: boolean;
  outcome: VoteChoice | 'deadlock';
  margin: number;
  detailedVotes: Vote[];
}

// =============================================================================
// OUTCOME TYPES
// =============================================================================

/**
 * Session outcome
 */
export interface SessionOutcome {
  id: string;
  sessionId: string;
  decision: 'approved' | 'denied' | 'modified' | 'deferred' | 'escalated' | 'deadlocked';
  winningProposalId?: string;
  votingResult?: VotingResult;
  conditions: string[];
  rationale: string;
  dissent: DissentRecord[];
  effectiveAt: Date;
  expiresAt?: Date;
  appealDeadline?: Date;
  enforcementActions: EnforcementAction[];
  metadata?: Record<string, unknown>;
}

/**
 * Dissent record
 */
export interface DissentRecord {
  memberId: string;
  reason: string;
  severity: 'minor' | 'major' | 'fundamental';
  timestamp: Date;
}

/**
 * Enforcement action
 */
export interface EnforcementAction {
  type: 'execute' | 'notify' | 'record' | 'escalate' | 'monitor';
  target: string;
  parameters: Record<string, unknown>;
  deadline?: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// =============================================================================
// CONFLICT RESOLUTION TYPES
// =============================================================================

/**
 * Conflict type
 */
export type ConflictType =
  | 'voting_deadlock'
  | 'policy_conflict'
  | 'interest_conflict'
  | 'authority_dispute'
  | 'procedural_objection';

/**
 * Conflict record
 */
export interface Conflict {
  id: string;
  sessionId: string;
  type: ConflictType;
  description: string;
  parties: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'mediating' | 'resolved' | 'escalated';
  resolution?: ConflictResolution;
  createdAt: Date;
  resolvedAt?: Date;
}

/**
 * Conflict resolution
 */
export interface ConflictResolution {
  method: 'chair_decision' | 'compromise' | 'arbitration' | 'escalation' | 'postponement';
  resolvedBy: string;
  decision: string;
  rationale: string;
  acceptedBy: string[];
  rejectedBy: string[];
  binding: boolean;
  appealable: boolean;
}

// =============================================================================
// PRECEDENT TYPES
// =============================================================================

/**
 * Council precedent
 */
export interface Precedent {
  id: string;
  sessionId: string;
  category: string;
  tags: string[];
  summary: string;
  decision: string;
  rationale: string;
  conditions: string[];
  applicability: number; // 0-100 similarity threshold
  citations: number;
  createdAt: Date;
  supersededBy?: string;
  active: boolean;
}

/**
 * Precedent match
 */
export interface PrecedentMatch {
  precedent: Precedent;
  similarity: number;
  applicableConditions: string[];
  recommendation: 'apply' | 'consider' | 'distinguish';
}

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * Council event types
 */
export type CouncilEventType =
  | 'session_created'
  | 'session_started'
  | 'member_joined'
  | 'member_left'
  | 'round_started'
  | 'contribution_added'
  | 'proposal_submitted'
  | 'proposal_amended'
  | 'voting_started'
  | 'vote_cast'
  | 'consensus_reached'
  | 'deadlock_detected'
  | 'conflict_raised'
  | 'conflict_resolved'
  | 'session_completed'
  | 'session_escalated'
  | 'session_cancelled';

/**
 * Council event
 */
export interface CouncilEvent {
  id: string;
  type: CouncilEventType;
  sessionId: string;
  actorId?: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Council configuration
 */
export interface CouncilConfig {
  /** Default consensus type */
  defaultConsensusType: ConsensusType;
  /** Minimum quorum percentage (0-100) */
  minQuorumPercent: number;
  /** Maximum deliberation rounds */
  maxRounds: number;
  /** Default session timeout (ms) */
  sessionTimeoutMs: number;
  /** Voting timeout per round (ms) */
  votingTimeoutMs: number;
  /** Enable weighted voting */
  enableWeightedVoting: boolean;
  /** Enable delegation */
  enableDelegation: boolean;
  /** Enable precedent matching */
  enablePrecedents: boolean;
  /** Auto-escalate on deadlock */
  autoEscalateOnDeadlock: boolean;
  /** Chair can break ties */
  chairBreaksTies: boolean;
  /** Minimum trust tier for voting */
  minVotingTier: TrustTier;
  /** Required specialization diversity */
  requireDiverseSpecializations: boolean;
}

/**
 * Default council configuration
 */
export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  defaultConsensusType: 'majority',
  minQuorumPercent: 60,
  maxRounds: 5,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  votingTimeoutMs: 5 * 60 * 1000, // 5 minutes
  enableWeightedVoting: true,
  enableDelegation: true,
  enablePrecedents: true,
  autoEscalateOnDeadlock: true,
  chairBreaksTies: true,
  minVotingTier: 'T2',
  requireDiverseSpecializations: true,
};
