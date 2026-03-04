/**
 * Policy Inheritance System
 *
 * Enables policy hierarchies with inheritance and override capabilities.
 * Implements FR150 for Epic 4.
 *
 * Features:
 * - Parent-child policy relationships
 * - Rule inheritance and overrides
 * - Conflict resolution
 * - Inheritance chain validation
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type { ID } from '../../common/types.js';
import type { PolicyDefinition, PolicyRule } from '../types.js';

const logger = createLogger({ component: 'policy-inheritance' });

// =============================================================================
// Types
// =============================================================================

/**
 * Policy inheritance relationship
 */
export interface PolicyInheritance {
  /** Child policy ID */
  policyId: ID;
  /** Parent policy ID */
  parentPolicyId: ID;
  /** Whether to inherit target scope */
  inheritTarget: boolean;
  /** Whether to inherit default action */
  inheritDefaultAction: boolean;
  /** Rules to exclude from inheritance */
  excludedRuleIds: string[];
  /** Override priority offset (added to parent rule priorities) */
  priorityOffset: number;
}

/**
 * Policy node in the hierarchy tree
 */
export interface PolicyHierarchyNode {
  policyId: ID;
  policyName: string;
  parentId?: ID;
  children: PolicyHierarchyNode[];
  depth: number;
}

/**
 * Merged policy result
 */
export interface MergedPolicy {
  /** The resulting merged definition */
  definition: PolicyDefinition;
  /** Source of each rule (which policy it came from) */
  ruleSources: Map<string, ID>;
  /** Conflicts that were resolved */
  conflicts: PolicyConflict[];
  /** Inheritance chain (from root to this policy) */
  inheritanceChain: ID[];
}

/**
 * Policy conflict during merge
 */
export interface PolicyConflict {
  /** Type of conflict */
  type: 'rule_override' | 'priority_collision' | 'action_conflict';
  /** Rule ID involved */
  ruleId: string;
  /** Source policy of the conflict */
  sourcePolicyId: ID;
  /** Target policy that caused the conflict */
  targetPolicyId: ID;
  /** How it was resolved */
  resolution: 'child_wins' | 'parent_wins' | 'merged';
  /** Description */
  description: string;
}

/**
 * Inheritance validation result
 */
export interface InheritanceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  maxDepth: number;
}

// =============================================================================
// Policy Inheritance Service
// =============================================================================

/**
 * Policy Inheritance Service
 *
 * Manages policy inheritance relationships and merging.
 */
export class PolicyInheritanceService {
  private inheritanceMap: Map<ID, PolicyInheritance> = new Map();
  private policyCache: Map<ID, PolicyDefinition> = new Map();

  /**
   * Set inheritance relationship
   */
  setInheritance(inheritance: PolicyInheritance): void {
    this.inheritanceMap.set(inheritance.policyId, inheritance);
    logger.debug({
      childId: inheritance.policyId,
      parentId: inheritance.parentPolicyId,
    }, 'Inheritance relationship set');
  }

  /**
   * Remove inheritance relationship
   */
  removeInheritance(policyId: ID): boolean {
    const removed = this.inheritanceMap.delete(policyId);
    if (removed) {
      logger.debug({ policyId }, 'Inheritance relationship removed');
    }
    return removed;
  }

  /**
   * Get parent policy ID
   */
  getParent(policyId: ID): ID | undefined {
    return this.inheritanceMap.get(policyId)?.parentPolicyId;
  }

  /**
   * Get all children of a policy
   */
  getChildren(policyId: ID): ID[] {
    const children: ID[] = [];
    for (const [childId, inheritance] of this.inheritanceMap) {
      if (inheritance.parentPolicyId === policyId) {
        children.push(childId);
      }
    }
    return children;
  }

  /**
   * Get the full inheritance chain (from root to policy)
   */
  getInheritanceChain(policyId: ID): ID[] {
    const chain: ID[] = [];
    let currentId: ID | undefined = policyId;

    while (currentId) {
      if (chain.includes(currentId)) {
        // Circular reference detected
        break;
      }
      chain.unshift(currentId);
      currentId = this.getParent(currentId);
    }

    return chain;
  }

  /**
   * Build the policy hierarchy tree
   */
  buildHierarchy(
    policies: { id: ID; name: string }[]
  ): PolicyHierarchyNode[] {
    const policyMap = new Map(policies.map(p => [p.id, p]));
    const rootNodes: PolicyHierarchyNode[] = [];
    const nodeMap = new Map<ID, PolicyHierarchyNode>();

    // Create nodes
    for (const policy of policies) {
      nodeMap.set(policy.id, {
        policyId: policy.id,
        policyName: policy.name,
        parentId: this.getParent(policy.id),
        children: [],
        depth: 0,
      });
    }

    // Build tree
    for (const [policyId, node] of nodeMap) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId)!;
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        rootNodes.push(node);
      }
    }

    // Calculate depths for non-root nodes
    this.calculateDepths(rootNodes);

    return rootNodes;
  }

  /**
   * Validate inheritance relationships
   */
  validateInheritance(policyId: ID): InheritanceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let maxDepth = 0;

    // Check for circular references
    const visited = new Set<ID>();
    let currentId: ID | undefined = policyId;
    let depth = 0;

    while (currentId) {
      if (visited.has(currentId)) {
        errors.push(`Circular inheritance detected: ${currentId} appears multiple times in the chain`);
        break;
      }
      visited.add(currentId);
      depth++;
      currentId = this.getParent(currentId);
    }

    maxDepth = depth;

    // Warn about deep hierarchies
    if (depth > 5) {
      warnings.push(`Deep inheritance hierarchy (${depth} levels). Consider flattening.`);
    }

    // Check for orphaned references
    const inheritance = this.inheritanceMap.get(policyId);
    if (inheritance) {
      if (!this.policyCache.has(inheritance.parentPolicyId)) {
        warnings.push(`Parent policy ${inheritance.parentPolicyId} not found in cache. May need to load.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      maxDepth,
    };
  }

  /**
   * Merge policy with its ancestors
   */
  mergeWithAncestors(
    policyId: ID,
    childPolicy: PolicyDefinition,
    getPolicyFn: (id: ID) => Promise<PolicyDefinition | null>
  ): Promise<MergedPolicy> {
    return this.mergePolicy(policyId, childPolicy, getPolicyFn);
  }

  /**
   * Internal merge implementation
   */
  private async mergePolicy(
    policyId: ID,
    policy: PolicyDefinition,
    getPolicyFn: (id: ID) => Promise<PolicyDefinition | null>
  ): Promise<MergedPolicy> {
    const inheritance = this.inheritanceMap.get(policyId);

    // No inheritance - return as-is
    if (!inheritance) {
      const ruleSources = new Map<string, ID>();
      for (const rule of policy.rules) {
        ruleSources.set(rule.id, policyId);
      }

      return {
        definition: policy,
        ruleSources,
        conflicts: [],
        inheritanceChain: [policyId],
      };
    }

    // Get parent policy
    const parentPolicy = await getPolicyFn(inheritance.parentPolicyId);
    if (!parentPolicy) {
      throw new Error(`Parent policy not found: ${inheritance.parentPolicyId}`);
    }

    // Recursively merge parent
    const parentMerged = await this.mergePolicy(
      inheritance.parentPolicyId,
      parentPolicy,
      getPolicyFn
    );

    // Now merge child into parent
    const conflicts: PolicyConflict[] = [...parentMerged.conflicts];
    const ruleSources = new Map(parentMerged.ruleSources);

    // Start with parent rules (with priority offset)
    const mergedRules: PolicyRule[] = parentMerged.definition.rules
      .filter(r => !inheritance.excludedRuleIds.includes(r.id))
      .map(r => ({
        ...r,
        priority: r.priority + inheritance.priorityOffset,
      }));

    // Child rules override parent rules with same ID
    const childRuleIds = new Set(policy.rules.map(r => r.id));

    for (const childRule of policy.rules) {
      const existingIndex = mergedRules.findIndex(r => r.id === childRule.id);

      if (existingIndex >= 0) {
        // Override
        conflicts.push({
          type: 'rule_override',
          ruleId: childRule.id,
          sourcePolicyId: inheritance.parentPolicyId,
          targetPolicyId: policyId,
          resolution: 'child_wins',
          description: `Rule "${childRule.name}" overrides parent rule`,
        });

        mergedRules[existingIndex] = childRule;
        ruleSources.set(childRule.id, policyId);
      } else {
        // Add new rule
        mergedRules.push(childRule);
        ruleSources.set(childRule.id, policyId);
      }
    }

    // Check for priority collisions
    const priorityMap = new Map<number, PolicyRule[]>();
    for (const rule of mergedRules) {
      const existing = priorityMap.get(rule.priority) ?? [];
      existing.push(rule);
      priorityMap.set(rule.priority, existing);
    }

    for (const [priority, rules] of priorityMap) {
      if (rules.length > 1) {
        conflicts.push({
          type: 'priority_collision',
          ruleId: rules.map(r => r.id).join(','),
          sourcePolicyId: policyId,
          targetPolicyId: policyId,
          resolution: 'merged',
          description: `Multiple rules with priority ${priority}: ${rules.map(r => r.name).join(', ')}`,
        });
      }
    }

    // Sort by priority
    mergedRules.sort((a, b) => a.priority - b.priority);

    // Merge target
    const mergedTarget = inheritance.inheritTarget
      ? this.mergeTargets(parentMerged.definition.target, policy.target)
      : policy.target;

    // Merge default action
    const defaultAction = inheritance.inheritDefaultAction
      ? parentMerged.definition.defaultAction
      : policy.defaultAction;

    const defaultReason = inheritance.inheritDefaultAction
      ? parentMerged.definition.defaultReason
      : policy.defaultReason;

    const definition: PolicyDefinition = {
      version: policy.version,
      target: mergedTarget,
      rules: mergedRules,
      defaultAction,
      defaultReason,
      metadata: {
        ...parentMerged.definition.metadata,
        ...policy.metadata,
        inheritedFrom: inheritance.parentPolicyId,
      },
    };

    return {
      definition,
      ruleSources,
      conflicts,
      inheritanceChain: [...parentMerged.inheritanceChain, policyId],
    };
  }

  /**
   * Merge policy targets
   */
  private mergeTargets(
    parent: PolicyDefinition['target'],
    child: PolicyDefinition['target']
  ): PolicyDefinition['target'] {
    if (!parent) return child;
    if (!child) return parent;

    return {
      intentTypes: [...(parent.intentTypes ?? []), ...(child.intentTypes ?? [])].filter(
        (v, i, a) => a.indexOf(v) === i
      ),
      entityTypes: [...(parent.entityTypes ?? []), ...(child.entityTypes ?? [])].filter(
        (v, i, a) => a.indexOf(v) === i
      ),
      trustLevels: [...(parent.trustLevels ?? []), ...(child.trustLevels ?? [])].filter(
        (v, i, a) => a.indexOf(v) === i
      ),
      namespaces: [...(parent.namespaces ?? []), ...(child.namespaces ?? [])].filter(
        (v, i, a) => a.indexOf(v) === i
      ),
    };
  }

  /**
   * Calculate depths recursively
   */
  private calculateDepths(nodes: PolicyHierarchyNode[], depth = 0): void {
    for (const node of nodes) {
      node.depth = depth;
      this.calculateDepths(node.children, depth + 1);
    }
  }

  /**
   * Cache a policy for inheritance lookups
   */
  cachePolicy(id: ID, policy: PolicyDefinition): void {
    this.policyCache.set(id, policy);
  }

  /**
   * Clear the policy cache
   */
  clearCache(): void {
    this.policyCache.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a policy inheritance service instance
 */
export function createPolicyInheritanceService(): PolicyInheritanceService {
  return new PolicyInheritanceService();
}
