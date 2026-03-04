/**
 * Multi-Agent Council Module
 *
 * Enterprise multi-agent deliberation and collective decision-making system.
 * Supports consensus-based governance with integration to Intent, Enforce,
 * and Proof layers.
 *
 * Features:
 * - Council member registry with roles and trust tiers
 * - Round-based deliberation sessions
 * - Multiple consensus mechanisms (unanimous, majority, weighted, ranked)
 * - Conflict detection and resolution
 * - Precedent system for consistent decisions
 * - Full audit trail with proofs
 * - Prometheus metrics for observability
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Member types
  CouncilRole,
  MemberSpecialization,
  TrustTier,
  CouncilMember,
  MemberSelectionCriteria,

  // Deliberation types
  DeliberationTopic,
  SessionStatus,
  DeliberationSession,
  DeliberationRound,
  Contribution,
  Proposal,
  ProposedAction,
  Amendment,

  // Voting types
  ConsensusType,
  VoteChoice,
  Vote,
  VotingResult,

  // Outcome types
  SessionOutcome,
  DissentRecord,
  EnforcementAction,

  // Conflict types
  ConflictType,
  Conflict,
  ConflictResolution,

  // Precedent types
  Precedent,
  PrecedentMatch,

  // Event types
  CouncilEventType,
  CouncilEvent,

  // Configuration
  CouncilConfig,
} from './types.js';

export { DEFAULT_COUNCIL_CONFIG } from './types.js';

// =============================================================================
// REGISTRY
// =============================================================================

export {
  CouncilMemberRegistry,
  createMemberRegistry,
  getMemberRegistry,
  resetMemberRegistry,
} from './registry.js';

// =============================================================================
// CONSENSUS
// =============================================================================

export {
  ConsensusEngine,
  createConsensusEngine,
  calculateRankedChoice,
  type RankedVote,
  type RankedChoiceResult,
} from './consensus.js';

// =============================================================================
// SESSION
// =============================================================================

export {
  SessionManager,
  createSessionManager,
} from './session.js';

// =============================================================================
// CONFLICT
// =============================================================================

export {
  ConflictResolver,
  createConflictResolver,
  type ConflictDetectionResult,
  type ResolutionStrategy,
  type ConflictResolverConfig,
} from './conflict.js';

// =============================================================================
// SERVICE
// =============================================================================

export {
  CouncilService,
  createCouncilService,
  getCouncilService,
  resetCouncilService,
  type CouncilIntent,
  type CouncilDecision,
  type CouncilProof,
  type CouncilServiceConfig,
} from './service.js';

// =============================================================================
// METRICS
// =============================================================================

export {
  createCouncilMetrics,
  getCouncilMetrics,
  resetCouncilMetrics,
  recordSessionCreated,
  recordSessionStarted,
  recordSessionCompleted,
  recordVoteCast,
  recordVotingResult,
  recordConflictDetected,
  recordConflictResolved,
  recordDecisionCreated,
  recordContributionAdded,
  recordProposalSubmitted,
  updateActiveMembersGauge,
  updateDelegationsGauge,
} from './metrics.js';
