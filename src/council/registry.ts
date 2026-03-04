/**
 * Council Member Registry
 *
 * Manages council members, their roles, capabilities, and delegation.
 * Provides member selection algorithms for balanced and diverse councils.
 *
 * @packageDocumentation
 */

import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import type {
  CouncilMember,
  CouncilRole,
  MemberSpecialization,
  TrustTier,
  MemberSelectionCriteria,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Trust tier numeric values for comparison
 */
const TIER_VALUES: Record<TrustTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
  T6: 6,
  T7: 7,
};

/**
 * Default voting weights by role
 */
const ROLE_WEIGHTS: Record<CouncilRole, number> = {
  chair: 1.5,
  advisor: 0.5,
  validator: 1.0,
  observer: 0,
  arbitrator: 1.0,
  delegate: 1.0,
};

// =============================================================================
// COUNCIL MEMBER REGISTRY
// =============================================================================

/**
 * Council Member Registry
 *
 * Features:
 * - Member registration and lifecycle management
 * - Role-based access and voting weight
 * - Delegation chains with cycle detection
 * - Intelligent member selection for sessions
 * - Specialization diversity enforcement
 * - Trust tier requirements
 */
export class CouncilMemberRegistry extends EventEmitter {
  private members = new Map<string, CouncilMember>();
  private byAgentId = new Map<string, string>(); // agentId -> memberId
  private delegations = new Map<string, Set<string>>(); // delegatee -> delegators

  /**
   * Register a new council member
   */
  register(params: {
    agentId: string;
    name: string;
    role: CouncilRole;
    specializations: MemberSpecialization[];
    trustTier: TrustTier;
    trustScore: number;
    votingWeight?: number;
    metadata?: Record<string, unknown>;
  }): CouncilMember {
    // Check if agent already registered
    if (this.byAgentId.has(params.agentId)) {
      const existingId = this.byAgentId.get(params.agentId)!;
      const existing = this.members.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const member: CouncilMember = {
      id: nanoid(),
      agentId: params.agentId,
      name: params.name,
      role: params.role,
      specializations: params.specializations,
      trustTier: params.trustTier,
      trustScore: params.trustScore,
      votingWeight: params.votingWeight ?? ROLE_WEIGHTS[params.role],
      active: true,
      joinedAt: new Date(),
      lastActiveAt: new Date(),
      metadata: params.metadata,
    };

    this.members.set(member.id, member);
    this.byAgentId.set(params.agentId, member.id);

    this.emit('member_registered', { member });

    return member;
  }

  /**
   * Get member by ID
   */
  get(memberId: string): CouncilMember | undefined {
    return this.members.get(memberId);
  }

  /**
   * Get member by agent ID
   */
  getByAgentId(agentId: string): CouncilMember | undefined {
    const memberId = this.byAgentId.get(agentId);
    return memberId ? this.members.get(memberId) : undefined;
  }

  /**
   * Update member
   */
  update(
    memberId: string,
    updates: Partial<Omit<CouncilMember, 'id' | 'agentId' | 'joinedAt'>>
  ): CouncilMember | undefined {
    const member = this.members.get(memberId);
    if (!member) return undefined;

    const updated: CouncilMember = {
      ...member,
      ...updates,
      lastActiveAt: new Date(),
    };

    this.members.set(memberId, updated);
    this.emit('member_updated', { member: updated, changes: updates });

    return updated;
  }

  /**
   * Deactivate member
   */
  deactivate(memberId: string): boolean {
    const member = this.members.get(memberId);
    if (!member) return false;

    member.active = false;
    member.lastActiveAt = new Date();

    // Remove any delegations
    if (member.delegatedTo) {
      this.revokeDelegation(memberId);
    }

    // Remove delegations to this member
    const delegators = this.delegations.get(memberId);
    if (delegators) {
      for (const delegatorId of delegators) {
        const delegator = this.members.get(delegatorId);
        if (delegator) {
          delegator.delegatedTo = undefined;
        }
      }
      this.delegations.delete(memberId);
    }

    this.emit('member_deactivated', { member });

    return true;
  }

  /**
   * Reactivate member
   */
  reactivate(memberId: string): boolean {
    const member = this.members.get(memberId);
    if (!member) return false;

    member.active = true;
    member.lastActiveAt = new Date();

    this.emit('member_reactivated', { member });

    return true;
  }

  /**
   * Delegate voting authority
   */
  delegate(fromMemberId: string, toMemberId: string): boolean {
    const from = this.members.get(fromMemberId);
    const to = this.members.get(toMemberId);

    if (!from || !to) return false;
    if (!from.active || !to.active) return false;
    if (from.role === 'observer') return false;

    // Check for delegation cycles
    if (this.wouldCreateCycle(fromMemberId, toMemberId)) {
      return false;
    }

    // Revoke existing delegation
    if (from.delegatedTo) {
      this.revokeDelegation(fromMemberId);
    }

    // Create delegation
    from.delegatedTo = toMemberId;
    from.lastActiveAt = new Date();

    if (!to.delegatedFrom) {
      to.delegatedFrom = [];
    }
    to.delegatedFrom.push(fromMemberId);
    to.lastActiveAt = new Date();

    // Track delegation
    if (!this.delegations.has(toMemberId)) {
      this.delegations.set(toMemberId, new Set());
    }
    this.delegations.get(toMemberId)!.add(fromMemberId);

    this.emit('delegation_created', { from: fromMemberId, to: toMemberId });

    return true;
  }

  /**
   * Revoke delegation
   */
  revokeDelegation(memberId: string): boolean {
    const member = this.members.get(memberId);
    if (!member || !member.delegatedTo) return false;

    const delegatee = this.members.get(member.delegatedTo);
    if (delegatee?.delegatedFrom) {
      delegatee.delegatedFrom = delegatee.delegatedFrom.filter((id) => id !== memberId);
    }

    this.delegations.get(member.delegatedTo)?.delete(memberId);

    const previousDelegatee = member.delegatedTo;
    member.delegatedTo = undefined;
    member.lastActiveAt = new Date();

    this.emit('delegation_revoked', { from: memberId, to: previousDelegatee });

    return true;
  }

  /**
   * Get effective voting weight including delegations
   */
  getEffectiveWeight(memberId: string): number {
    const member = this.members.get(memberId);
    if (!member || !member.active) return 0;

    // If delegated away, weight is 0
    if (member.delegatedTo) return 0;

    let weight = member.votingWeight;

    // Add delegated weight
    const delegators = this.delegations.get(memberId);
    if (delegators) {
      for (const delegatorId of delegators) {
        const delegator = this.members.get(delegatorId);
        if (delegator?.active) {
          weight += delegator.votingWeight;
        }
      }
    }

    return weight;
  }

  /**
   * Select members for a session based on criteria
   */
  selectMembers(criteria: MemberSelectionCriteria): CouncilMember[] {
    const candidates = this.getEligibleMembers(criteria);

    if (candidates.length < criteria.minCount) {
      // Not enough eligible members
      return candidates;
    }

    // Apply preferences
    let selected: CouncilMember[] = [];

    // First, add preferred members
    if (criteria.preferMembers) {
      for (const memberId of criteria.preferMembers) {
        const member = candidates.find((m) => m.id === memberId);
        if (member && selected.length < criteria.maxCount) {
          selected.push(member);
        }
      }
    }

    // Ensure diversity if required
    if (criteria.requireDiversity) {
      selected = this.ensureDiversity(selected, candidates, criteria);
    } else {
      // Fill remaining slots by trust score
      const remaining = candidates
        .filter((m) => !selected.includes(m))
        .sort((a, b) => b.trustScore - a.trustScore);

      for (const member of remaining) {
        if (selected.length >= criteria.maxCount) break;
        selected.push(member);
      }
    }

    // Ensure we have at least minCount
    if (selected.length < criteria.minCount) {
      const remaining = candidates.filter((m) => !selected.includes(m));
      for (const member of remaining) {
        if (selected.length >= criteria.minCount) break;
        selected.push(member);
      }
    }

    return selected;
  }

  /**
   * Get all active members
   */
  getActiveMembers(): CouncilMember[] {
    return Array.from(this.members.values()).filter((m) => m.active);
  }

  /**
   * Get members by role
   */
  getMembersByRole(role: CouncilRole): CouncilMember[] {
    return Array.from(this.members.values()).filter(
      (m) => m.active && m.role === role
    );
  }

  /**
   * Get members by specialization
   */
  getMembersBySpecialization(spec: MemberSpecialization): CouncilMember[] {
    return Array.from(this.members.values()).filter(
      (m) => m.active && m.specializations.includes(spec)
    );
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    active: number;
    byRole: Record<CouncilRole, number>;
    byTier: Record<TrustTier, number>;
    delegations: number;
  } {
    const stats = {
      total: this.members.size,
      active: 0,
      byRole: {
        chair: 0,
        advisor: 0,
        validator: 0,
        observer: 0,
        arbitrator: 0,
        delegate: 0,
      } as Record<CouncilRole, number>,
      byTier: {
        T1: 0,
        T2: 0,
        T3: 0,
        T4: 0,
        T5: 0,
      } as Record<TrustTier, number>,
      delegations: 0,
    };

    for (const member of this.members.values()) {
      if (member.active) {
        stats.active++;
        stats.byRole[member.role]++;
        stats.byTier[member.trustTier]++;
        if (member.delegatedTo) {
          stats.delegations++;
        }
      }
    }

    return stats;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private getEligibleMembers(criteria: MemberSelectionCriteria): CouncilMember[] {
    return Array.from(this.members.values()).filter((member) => {
      // Must be active
      if (!member.active) return false;

      // Must be voter (not observer)
      if (member.role === 'observer') return false;

      // Check excluded
      if (criteria.excludeMembers?.includes(member.id)) return false;

      // Check minimum trust tier
      if (criteria.minTrustTier) {
        if (TIER_VALUES[member.trustTier] < TIER_VALUES[criteria.minTrustTier]) {
          return false;
        }
      }

      // Check minimum trust score
      if (criteria.minTrustScore !== undefined) {
        if (member.trustScore < criteria.minTrustScore) return false;
      }

      // Check required specializations
      if (criteria.requiredSpecializations?.length) {
        const hasRequired = criteria.requiredSpecializations.some((spec) =>
          member.specializations.includes(spec)
        );
        if (!hasRequired) return false;
      }

      return true;
    });
  }

  private ensureDiversity(
    selected: CouncilMember[],
    candidates: CouncilMember[],
    criteria: MemberSelectionCriteria
  ): CouncilMember[] {
    const result = [...selected];
    const coveredSpecs = new Set<MemberSpecialization>();

    // Track covered specializations
    for (const member of result) {
      for (const spec of member.specializations) {
        coveredSpecs.add(spec);
      }
    }

    // Sort remaining candidates by how many uncovered specs they have
    const remaining = candidates
      .filter((m) => !result.includes(m))
      .map((m) => ({
        member: m,
        newSpecs: m.specializations.filter((s) => !coveredSpecs.has(s)).length,
        trustScore: m.trustScore,
      }))
      .sort((a, b) => {
        // Prefer members with more uncovered specs
        if (b.newSpecs !== a.newSpecs) return b.newSpecs - a.newSpecs;
        // Then by trust score
        return b.trustScore - a.trustScore;
      });

    for (const { member } of remaining) {
      if (result.length >= criteria.maxCount) break;

      result.push(member);
      for (const spec of member.specializations) {
        coveredSpecs.add(spec);
      }
    }

    return result;
  }

  private wouldCreateCycle(fromId: string, toId: string): boolean {
    // Check if toId already delegates (directly or indirectly) to fromId
    const visited = new Set<string>();
    const queue = [toId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === fromId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const member = this.members.get(current);
      if (member?.delegatedTo) {
        queue.push(member.delegatedTo);
      }
    }

    return false;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create council member registry
 */
export function createMemberRegistry(): CouncilMemberRegistry {
  return new CouncilMemberRegistry();
}

/**
 * Singleton registry instance
 */
let registryInstance: CouncilMemberRegistry | null = null;

/**
 * Get or create registry instance
 */
export function getMemberRegistry(): CouncilMemberRegistry {
  if (!registryInstance) {
    registryInstance = new CouncilMemberRegistry();
  }
  return registryInstance;
}

/**
 * Reset registry instance (for testing)
 */
export function resetMemberRegistry(): void {
  registryInstance = null;
}
