/**
 * Consensus Engine
 *
 * Implements multiple consensus mechanisms for multi-agent council voting.
 * Supports unanimous, majority, supermajority, weighted, and ranked choice voting.
 *
 * @packageDocumentation
 */

import type {
  ConsensusType,
  Vote,
  VoteChoice,
  VotingResult,
  CouncilMember,
  CouncilConfig,
} from './types.js';
import { CouncilMemberRegistry } from './registry.js';

// =============================================================================
// CONSENSUS ENGINE
// =============================================================================

/**
 * Consensus Engine
 *
 * Features:
 * - Multiple voting mechanisms
 * - Weighted voting by trust score
 * - Delegation support
 * - Quorum validation
 * - Tie-breaking rules
 * - Ranked choice with instant runoff
 */
export class ConsensusEngine {
  private registry: CouncilMemberRegistry;
  private config: CouncilConfig;

  constructor(registry: CouncilMemberRegistry, config: CouncilConfig) {
    this.registry = registry;
    this.config = config;
  }

  /**
   * Calculate voting result
   */
  calculate(
    proposalId: string,
    votes: Vote[],
    members: CouncilMember[],
    consensusType: ConsensusType = this.config.defaultConsensusType
  ): VotingResult {
    // Deduplicate votes (use latest per member)
    const votesByMember = new Map<string, Vote>();
    for (const vote of votes) {
      const existing = votesByMember.get(vote.memberId);
      if (!existing || vote.timestamp > existing.timestamp) {
        votesByMember.set(vote.memberId, vote);
      }
    }

    const finalVotes = Array.from(votesByMember.values());

    // Calculate totals
    const breakdown = this.calculateBreakdown(finalVotes, members);
    const totalVotes = breakdown.approve.count + breakdown.deny.count + breakdown.defer.count;
    const weightedTotal = breakdown.approve.weight + breakdown.deny.weight + breakdown.defer.weight;

    // Check quorum
    const quorumRequired = Math.ceil(members.length * (this.config.minQuorumPercent / 100));
    const quorumMet = totalVotes >= quorumRequired;

    // Determine outcome based on consensus type
    const { consensusReached, outcome, margin } = this.determineOutcome(
      breakdown,
      totalVotes,
      weightedTotal,
      consensusType,
      members
    );

    return {
      proposalId,
      totalVotes: finalVotes.length,
      weightedTotal,
      breakdown,
      quorumMet,
      consensusReached: quorumMet && consensusReached,
      outcome,
      margin,
      detailedVotes: finalVotes,
    };
  }

  /**
   * Check if consensus is possible with remaining votes
   */
  canReachConsensus(
    currentVotes: Vote[],
    members: CouncilMember[],
    consensusType: ConsensusType
  ): { possible: boolean; neededForApprove: number; neededForDeny: number } {
    const breakdown = this.calculateBreakdown(currentVotes, members);
    const votedCount = currentVotes.length;
    const remainingVotes = members.length - votedCount;

    switch (consensusType) {
      case 'unanimous': {
        // If any deny, approval impossible; if any approve, denial impossible
        const approvalPossible = breakdown.deny.count === 0;
        const denialPossible = breakdown.approve.count === 0;
        return {
          possible: approvalPossible || denialPossible,
          neededForApprove: approvalPossible ? members.length - breakdown.approve.count : Infinity,
          neededForDeny: denialPossible ? members.length - breakdown.deny.count : Infinity,
        };
      }

      case 'supermajority': {
        const threshold = Math.ceil(members.length * (2 / 3));
        const neededForApprove = Math.max(0, threshold - breakdown.approve.count);
        const neededForDeny = Math.max(0, threshold - breakdown.deny.count);
        return {
          possible: neededForApprove <= remainingVotes || neededForDeny <= remainingVotes,
          neededForApprove,
          neededForDeny,
        };
      }

      case 'majority':
      default: {
        const threshold = Math.ceil(members.length / 2) + 1;
        const neededForApprove = Math.max(0, threshold - breakdown.approve.count);
        const neededForDeny = Math.max(0, threshold - breakdown.deny.count);
        return {
          possible: neededForApprove <= remainingVotes || neededForDeny <= remainingVotes,
          neededForApprove,
          neededForDeny,
        };
      }
    }
  }

  /**
   * Simulate voting outcome with hypothetical votes
   */
  simulate(
    currentVotes: Vote[],
    hypotheticalVotes: Array<{ memberId: string; choice: VoteChoice }>,
    members: CouncilMember[],
    consensusType: ConsensusType
  ): VotingResult {
    const simVotes: Vote[] = [
      ...currentVotes,
      ...hypotheticalVotes.map((v) => ({
        id: `sim-${v.memberId}`,
        sessionId: 'simulation',
        proposalId: 'simulation',
        memberId: v.memberId,
        choice: v.choice,
        weight: this.registry.getEffectiveWeight(v.memberId),
        reasoning: 'Simulated vote',
        confidence: 1,
        timestamp: new Date(),
      })),
    ];

    return this.calculate('simulation', simVotes, members, consensusType);
  }

  /**
   * Apply chair tie-breaker
   */
  applyTieBreaker(
    result: VotingResult,
    chair: CouncilMember,
    chairChoice: VoteChoice
  ): VotingResult {
    if (!this.config.chairBreaksTies) {
      return result;
    }

    if (result.outcome !== 'deadlock') {
      return result;
    }

    // Chair breaks the tie
    const tieBreakVote: Vote = {
      id: `tiebreak-${chair.id}`,
      sessionId: 'tiebreak',
      proposalId: result.proposalId,
      memberId: chair.id,
      choice: chairChoice,
      weight: 0.1, // Minimal weight to break tie
      reasoning: 'Chair tie-breaker vote',
      confidence: 1,
      timestamp: new Date(),
    };

    return {
      ...result,
      outcome: chairChoice === 'abstain' ? 'deadlock' : chairChoice,
      consensusReached: chairChoice !== 'abstain',
      detailedVotes: [...result.detailedVotes, tieBreakVote],
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private calculateBreakdown(
    votes: Vote[],
    members: CouncilMember[]
  ): VotingResult['breakdown'] {
    const breakdown = {
      approve: { count: 0, weight: 0 },
      deny: { count: 0, weight: 0 },
      abstain: { count: 0, weight: 0 },
      defer: { count: 0, weight: 0 },
    };

    for (const vote of votes) {
      const effectiveWeight = this.config.enableWeightedVoting
        ? this.registry.getEffectiveWeight(vote.memberId)
        : 1;

      breakdown[vote.choice].count++;
      breakdown[vote.choice].weight += effectiveWeight;
    }

    return breakdown;
  }

  private determineOutcome(
    breakdown: VotingResult['breakdown'],
    totalVotes: number,
    weightedTotal: number,
    consensusType: ConsensusType,
    members: CouncilMember[]
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    switch (consensusType) {
      case 'unanimous':
        return this.unanimousOutcome(breakdown, members.length);

      case 'supermajority':
        return this.supermajorityOutcome(breakdown, totalVotes);

      case 'majority':
        return this.majorityOutcome(breakdown, totalVotes);

      case 'plurality':
        return this.pluralityOutcome(breakdown);

      case 'weighted_majority':
        return this.weightedMajorityOutcome(breakdown, weightedTotal);

      case 'ranked_choice':
        // Ranked choice requires different vote structure
        // Fall back to majority for single-choice votes
        return this.majorityOutcome(breakdown, totalVotes);

      default:
        return this.majorityOutcome(breakdown, totalVotes);
    }
  }

  private unanimousOutcome(
    breakdown: VotingResult['breakdown'],
    totalMembers: number
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    const activeVotes = breakdown.approve.count + breakdown.deny.count;

    // All active voters must agree (abstain/defer don't count)
    if (breakdown.deny.count === 0 && breakdown.approve.count > 0) {
      // Check if enough have voted
      if (activeVotes >= Math.ceil(totalMembers * 0.5)) {
        return {
          consensusReached: true,
          outcome: 'approve',
          margin: 100,
        };
      }
    }

    if (breakdown.approve.count === 0 && breakdown.deny.count > 0) {
      if (activeVotes >= Math.ceil(totalMembers * 0.5)) {
        return {
          consensusReached: true,
          outcome: 'deny',
          margin: 100,
        };
      }
    }

    // Mixed votes = no unanimous consensus
    if (breakdown.approve.count > 0 && breakdown.deny.count > 0) {
      return {
        consensusReached: false,
        outcome: 'deadlock',
        margin: 0,
      };
    }

    // Not enough votes yet
    return {
      consensusReached: false,
      outcome: 'deadlock',
      margin: 0,
    };
  }

  private supermajorityOutcome(
    breakdown: VotingResult['breakdown'],
    totalVotes: number
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    const threshold = 2 / 3; // 66.67%
    const activeVotes = breakdown.approve.count + breakdown.deny.count;

    if (activeVotes === 0) {
      return { consensusReached: false, outcome: 'deadlock', margin: 0 };
    }

    const approvePercent = breakdown.approve.count / activeVotes;
    const denyPercent = breakdown.deny.count / activeVotes;

    if (approvePercent >= threshold) {
      return {
        consensusReached: true,
        outcome: 'approve',
        margin: (approvePercent - threshold) * 100,
      };
    }

    if (denyPercent >= threshold) {
      return {
        consensusReached: true,
        outcome: 'deny',
        margin: (denyPercent - threshold) * 100,
      };
    }

    return {
      consensusReached: false,
      outcome: 'deadlock',
      margin: Math.max(approvePercent, denyPercent) * 100 - threshold * 100,
    };
  }

  private majorityOutcome(
    breakdown: VotingResult['breakdown'],
    totalVotes: number
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    const activeVotes = breakdown.approve.count + breakdown.deny.count;

    if (activeVotes === 0) {
      return { consensusReached: false, outcome: 'deadlock', margin: 0 };
    }

    const approvePercent = breakdown.approve.count / activeVotes;
    const denyPercent = breakdown.deny.count / activeVotes;

    if (approvePercent > 0.5) {
      return {
        consensusReached: true,
        outcome: 'approve',
        margin: (approvePercent - 0.5) * 100,
      };
    }

    if (denyPercent > 0.5) {
      return {
        consensusReached: true,
        outcome: 'deny',
        margin: (denyPercent - 0.5) * 100,
      };
    }

    // Exactly 50/50 = deadlock
    return {
      consensusReached: false,
      outcome: 'deadlock',
      margin: 0,
    };
  }

  private pluralityOutcome(
    breakdown: VotingResult['breakdown']
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    const choices: Array<{ choice: VoteChoice; count: number }> = [
      { choice: 'approve', count: breakdown.approve.count },
      { choice: 'deny', count: breakdown.deny.count },
      { choice: 'defer', count: breakdown.defer.count },
    ];

    choices.sort((a, b) => b.count - a.count);

    if (choices[0]!.count === 0) {
      return { consensusReached: false, outcome: 'deadlock', margin: 0 };
    }

    // Check for tie
    if (choices[0]!.count === choices[1]!.count) {
      return {
        consensusReached: false,
        outcome: 'deadlock',
        margin: 0,
      };
    }

    return {
      consensusReached: true,
      outcome: choices[0]!.choice,
      margin: choices[0]!.count - choices[1]!.count,
    };
  }

  private weightedMajorityOutcome(
    breakdown: VotingResult['breakdown'],
    weightedTotal: number
  ): { consensusReached: boolean; outcome: VoteChoice | 'deadlock'; margin: number } {
    const activeWeight = breakdown.approve.weight + breakdown.deny.weight;

    if (activeWeight === 0) {
      return { consensusReached: false, outcome: 'deadlock', margin: 0 };
    }

    const approvePercent = breakdown.approve.weight / activeWeight;
    const denyPercent = breakdown.deny.weight / activeWeight;

    if (approvePercent > 0.5) {
      return {
        consensusReached: true,
        outcome: 'approve',
        margin: (approvePercent - 0.5) * 100,
      };
    }

    if (denyPercent > 0.5) {
      return {
        consensusReached: true,
        outcome: 'deny',
        margin: (denyPercent - 0.5) * 100,
      };
    }

    return {
      consensusReached: false,
      outcome: 'deadlock',
      margin: 0,
    };
  }
}

// =============================================================================
// RANKED CHOICE VOTING
// =============================================================================

/**
 * Ranked choice vote
 */
export interface RankedVote {
  memberId: string;
  rankings: Array<{ choice: string; rank: number }>;
  timestamp: Date;
}

/**
 * Ranked choice voting result
 */
export interface RankedChoiceResult {
  winner: string | null;
  rounds: Array<{
    roundNumber: number;
    counts: Record<string, number>;
    eliminated?: string;
  }>;
  finalCounts: Record<string, number>;
}

/**
 * Calculate ranked choice voting with instant runoff
 */
export function calculateRankedChoice(
  votes: RankedVote[],
  choices: string[]
): RankedChoiceResult {
  const rounds: RankedChoiceResult['rounds'] = [];
  let activeChoices = [...choices];
  let currentVotes = votes.map((v) => ({
    memberId: v.memberId,
    rankings: [...v.rankings].sort((a, b) => a.rank - b.rank),
  }));

  while (activeChoices.length > 1) {
    // Count first-choice votes
    const counts: Record<string, number> = {};
    for (const choice of activeChoices) {
      counts[choice] = 0;
    }

    for (const vote of currentVotes) {
      const topChoice = vote.rankings.find((r) => activeChoices.includes(r.choice));
      if (topChoice) {
        counts[topChoice.choice]!++;
      }
    }

    const totalVotes = Object.values(counts).reduce((sum, c) => sum + c, 0);
    const roundNumber = rounds.length + 1;

    // Check for majority winner
    for (const [choice, count] of Object.entries(counts)) {
      if (count > totalVotes / 2) {
        rounds.push({ roundNumber, counts });
        return {
          winner: choice,
          rounds,
          finalCounts: counts,
        };
      }
    }

    // Find choice with fewest votes
    let minCount = Infinity;
    let eliminated: string | null = null;
    for (const [choice, count] of Object.entries(counts)) {
      if (count < minCount) {
        minCount = count;
        eliminated = choice;
      }
    }

    rounds.push({ roundNumber, counts, eliminated: eliminated ?? undefined });

    // Eliminate lowest choice
    if (eliminated) {
      activeChoices = activeChoices.filter((c) => c !== eliminated);
    }
  }

  // Single choice remaining
  const finalCounts: Record<string, number> = {};
  finalCounts[activeChoices[0]!] = currentVotes.length;

  return {
    winner: activeChoices[0] ?? null,
    rounds,
    finalCounts,
  };
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create consensus engine
 */
export function createConsensusEngine(
  registry: CouncilMemberRegistry,
  config: CouncilConfig
): ConsensusEngine {
  return new ConsensusEngine(registry, config);
}
