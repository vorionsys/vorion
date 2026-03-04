/**
 * Council Metrics
 *
 * Prometheus metrics for multi-agent council observability.
 * Tracks sessions, voting, conflicts, and decision outcomes.
 *
 * @packageDocumentation
 */

import { Counter, Histogram, Gauge, Registry } from 'prom-client';

// =============================================================================
// METRICS
// =============================================================================

/**
 * Create metrics for council service
 */
export function createCouncilMetrics(registry?: Registry) {
  const reg = registry ?? new Registry();

  // ===========================================================================
  // SESSION METRICS
  // ===========================================================================

  const sessionsCreated = new Counter({
    name: 'council_sessions_created_total',
    help: 'Total number of council sessions created',
    labelNames: ['category', 'priority'] as const,
    registers: [reg],
  });

  const sessionsCompleted = new Counter({
    name: 'council_sessions_completed_total',
    help: 'Total number of council sessions completed',
    labelNames: ['outcome', 'consensus_type'] as const,
    registers: [reg],
  });

  const sessionsEscalated = new Counter({
    name: 'council_sessions_escalated_total',
    help: 'Total number of sessions escalated',
    labelNames: ['reason'] as const,
    registers: [reg],
  });

  const sessionDuration = new Histogram({
    name: 'council_session_duration_seconds',
    help: 'Duration of council sessions',
    labelNames: ['outcome'] as const,
    buckets: [60, 300, 600, 1800, 3600, 7200],
    registers: [reg],
  });

  const activeSessions = new Gauge({
    name: 'council_active_sessions',
    help: 'Number of currently active sessions',
    labelNames: ['status'] as const,
    registers: [reg],
  });

  const sessionRounds = new Histogram({
    name: 'council_session_rounds',
    help: 'Number of rounds per session',
    labelNames: ['outcome'] as const,
    buckets: [1, 2, 3, 4, 5, 7, 10],
    registers: [reg],
  });

  // ===========================================================================
  // VOTING METRICS
  // ===========================================================================

  const votesCast = new Counter({
    name: 'council_votes_cast_total',
    help: 'Total number of votes cast',
    labelNames: ['choice'] as const,
    registers: [reg],
  });

  const votingParticipation = new Histogram({
    name: 'council_voting_participation_percent',
    help: 'Voting participation percentage',
    buckets: [20, 40, 60, 80, 90, 95, 100],
    registers: [reg],
  });

  const votingMargin = new Histogram({
    name: 'council_voting_margin_percent',
    help: 'Margin of victory in votes',
    buckets: [1, 5, 10, 20, 30, 50, 75, 100],
    registers: [reg],
  });

  const quorumReached = new Counter({
    name: 'council_quorum_reached_total',
    help: 'Number of votes where quorum was reached',
    labelNames: ['reached'] as const,
    registers: [reg],
  });

  const consensusReached = new Counter({
    name: 'council_consensus_reached_total',
    help: 'Number of votes where consensus was reached',
    labelNames: ['type', 'reached'] as const,
    registers: [reg],
  });

  // ===========================================================================
  // MEMBER METRICS
  // ===========================================================================

  const activeMembers = new Gauge({
    name: 'council_active_members',
    help: 'Number of active council members',
    labelNames: ['role', 'tier'] as const,
    registers: [reg],
  });

  const memberParticipations = new Counter({
    name: 'council_member_participations_total',
    help: 'Total member participations in sessions',
    labelNames: ['role'] as const,
    registers: [reg],
  });

  const delegationsActive = new Gauge({
    name: 'council_delegations_active',
    help: 'Number of active voting delegations',
    registers: [reg],
  });

  // ===========================================================================
  // CONFLICT METRICS
  // ===========================================================================

  const conflictsDetected = new Counter({
    name: 'council_conflicts_detected_total',
    help: 'Total number of conflicts detected',
    labelNames: ['type', 'severity'] as const,
    registers: [reg],
  });

  const conflictsResolved = new Counter({
    name: 'council_conflicts_resolved_total',
    help: 'Total number of conflicts resolved',
    labelNames: ['method'] as const,
    registers: [reg],
  });

  const conflictResolutionDuration = new Histogram({
    name: 'council_conflict_resolution_duration_seconds',
    help: 'Time to resolve conflicts',
    labelNames: ['method'] as const,
    buckets: [60, 300, 600, 1800, 3600, 7200],
    registers: [reg],
  });

  // ===========================================================================
  // DECISION METRICS
  // ===========================================================================

  const decisionsCreated = new Counter({
    name: 'council_decisions_created_total',
    help: 'Total number of decisions created',
    labelNames: ['enforce_color', 'decision'] as const,
    registers: [reg],
  });

  const decisionConfidence = new Histogram({
    name: 'council_decision_confidence',
    help: 'Confidence level of decisions',
    labelNames: ['enforce_color'] as const,
    buckets: [0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0],
    registers: [reg],
  });

  const proofsCreated = new Counter({
    name: 'council_proofs_created_total',
    help: 'Total number of decision proofs created',
    registers: [reg],
  });

  // ===========================================================================
  // CONTRIBUTION METRICS
  // ===========================================================================

  const contributionsAdded = new Counter({
    name: 'council_contributions_added_total',
    help: 'Total number of contributions added',
    labelNames: ['type', 'sentiment'] as const,
    registers: [reg],
  });

  const proposalsSubmitted = new Counter({
    name: 'council_proposals_submitted_total',
    help: 'Total number of proposals submitted',
    labelNames: ['action_type'] as const,
    registers: [reg],
  });

  const proposalsAccepted = new Counter({
    name: 'council_proposals_accepted_total',
    help: 'Total number of proposals accepted',
    registers: [reg],
  });

  // ===========================================================================
  // PRECEDENT METRICS
  // ===========================================================================

  const precedentsCreated = new Counter({
    name: 'council_precedents_created_total',
    help: 'Total number of precedents created',
    labelNames: ['category'] as const,
    registers: [reg],
  });

  const precedentsApplied = new Counter({
    name: 'council_precedents_applied_total',
    help: 'Total number of precedents applied',
    labelNames: ['recommendation'] as const,
    registers: [reg],
  });

  return {
    // Session metrics
    sessionsCreated,
    sessionsCompleted,
    sessionsEscalated,
    sessionDuration,
    activeSessions,
    sessionRounds,

    // Voting metrics
    votesCast,
    votingParticipation,
    votingMargin,
    quorumReached,
    consensusReached,

    // Member metrics
    activeMembers,
    memberParticipations,
    delegationsActive,

    // Conflict metrics
    conflictsDetected,
    conflictsResolved,
    conflictResolutionDuration,

    // Decision metrics
    decisionsCreated,
    decisionConfidence,
    proofsCreated,

    // Contribution metrics
    contributionsAdded,
    proposalsSubmitted,
    proposalsAccepted,

    // Precedent metrics
    precedentsCreated,
    precedentsApplied,

    // Registry
    registry: reg,
  };
}

// =============================================================================
// SINGLETON METRICS INSTANCE
// =============================================================================

let metricsInstance: ReturnType<typeof createCouncilMetrics> | null = null;

/**
 * Get or create metrics instance
 */
export function getCouncilMetrics(
  registry?: Registry
): ReturnType<typeof createCouncilMetrics> {
  if (!metricsInstance) {
    metricsInstance = createCouncilMetrics(registry);
  }
  return metricsInstance;
}

/**
 * Reset metrics instance (for testing)
 */
export function resetCouncilMetrics(): void {
  metricsInstance = null;
}

// =============================================================================
// METRIC HELPERS
// =============================================================================

/**
 * Record session created
 */
export function recordSessionCreated(
  category: string,
  priority: string
): void {
  const metrics = getCouncilMetrics();
  metrics.sessionsCreated.inc({ category, priority });
  metrics.activeSessions.inc({ status: 'pending' });
}

/**
 * Record session started
 */
export function recordSessionStarted(): void {
  const metrics = getCouncilMetrics();
  metrics.activeSessions.dec({ status: 'pending' });
  metrics.activeSessions.inc({ status: 'in_progress' });
}

/**
 * Record session completed
 */
export function recordSessionCompleted(
  outcome: string,
  consensusType: string,
  durationMs: number,
  rounds: number
): void {
  const metrics = getCouncilMetrics();
  metrics.sessionsCompleted.inc({ outcome, consensus_type: consensusType });
  metrics.sessionDuration.observe({ outcome }, durationMs / 1000);
  metrics.sessionRounds.observe({ outcome }, rounds);
  metrics.activeSessions.dec({ status: 'in_progress' });
}

/**
 * Record vote cast
 */
export function recordVoteCast(choice: string): void {
  const metrics = getCouncilMetrics();
  metrics.votesCast.inc({ choice });
}

/**
 * Record voting result
 */
export function recordVotingResult(
  participation: number,
  margin: number,
  quorumMet: boolean,
  consensusReached: boolean,
  consensusType: string
): void {
  const metrics = getCouncilMetrics();
  metrics.votingParticipation.observe(participation);
  metrics.votingMargin.observe(margin);
  metrics.quorumReached.inc({ reached: quorumMet ? 'true' : 'false' });
  metrics.consensusReached.inc({
    type: consensusType,
    reached: consensusReached ? 'true' : 'false',
  });
}

/**
 * Record conflict detected
 */
export function recordConflictDetected(
  type: string,
  severity: string
): void {
  const metrics = getCouncilMetrics();
  metrics.conflictsDetected.inc({ type, severity });
}

/**
 * Record conflict resolved
 */
export function recordConflictResolved(
  method: string,
  durationMs: number
): void {
  const metrics = getCouncilMetrics();
  metrics.conflictsResolved.inc({ method });
  metrics.conflictResolutionDuration.observe({ method }, durationMs / 1000);
}

/**
 * Record decision created
 */
export function recordDecisionCreated(
  enforceColor: string,
  decision: string,
  confidence: number
): void {
  const metrics = getCouncilMetrics();
  metrics.decisionsCreated.inc({ enforce_color: enforceColor, decision });
  metrics.decisionConfidence.observe({ enforce_color: enforceColor }, confidence);
}

/**
 * Record contribution added
 */
export function recordContributionAdded(
  type: string,
  sentiment: string
): void {
  const metrics = getCouncilMetrics();
  metrics.contributionsAdded.inc({ type, sentiment });
}

/**
 * Record proposal submitted
 */
export function recordProposalSubmitted(actionType: string): void {
  const metrics = getCouncilMetrics();
  metrics.proposalsSubmitted.inc({ action_type: actionType });
}

/**
 * Update active members gauge
 */
export function updateActiveMembersGauge(
  membersByRoleAndTier: Array<{ role: string; tier: string; count: number }>
): void {
  const metrics = getCouncilMetrics();
  for (const { role, tier, count } of membersByRoleAndTier) {
    metrics.activeMembers.set({ role, tier }, count);
  }
}

/**
 * Update delegations gauge
 */
export function updateDelegationsGauge(count: number): void {
  const metrics = getCouncilMetrics();
  metrics.delegationsActive.set(count);
}
