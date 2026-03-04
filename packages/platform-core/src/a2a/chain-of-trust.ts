/**
 * Chain of Trust Service
 *
 * Tracks and manages trust chains for nested A2A calls.
 * Implements trust inheritance policies and chain validation.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import {
  type ChainContext,
  type ChainLink,
  type TrustInheritanceMode,
  type A2AAttestationData,
  MAX_CHAIN_DEPTH,
} from './types.js';

const logger = createLogger({ component: 'a2a-chain-of-trust' });

// ============================================================================
// Types
// ============================================================================

/**
 * Active chain tracking
 */
export interface ActiveChain {
  /** Root request ID */
  rootRequestId: string;

  /** Chain links */
  links: ChainLink[];

  /** Trust inheritance mode */
  inheritanceMode: TrustInheritanceMode;

  /** Current effective trust tier */
  effectiveTier: number;

  /** Current effective trust score */
  effectiveScore: number;

  /** Started timestamp */
  startedAt: Date;

  /** Last activity */
  lastActivityAt: Date;

  /** Chain state */
  state: 'active' | 'completed' | 'failed' | 'expired';

  /** Attestation data collected */
  attestations: A2AAttestationData[];
}

/**
 * Chain validation result
 */
export interface ChainValidationResult {
  valid: boolean;
  effectiveTier: number;
  effectiveScore: number;
  warnings: string[];
  violations: ChainViolation[];
}

/**
 * Chain violation
 */
export interface ChainViolation {
  type: 'depth_exceeded' | 'trust_drop' | 'loop_detected' | 'stale_chain' | 'invalid_link';
  message: string;
  linkIndex?: number;
}

/**
 * Chain statistics
 */
export interface ChainStats {
  totalChains: number;
  activeChains: number;
  completedChains: number;
  failedChains: number;
  avgChainDepth: number;
  avgChainDuration: number;
  loopDetections: number;
  depthViolations: number;
}

// ============================================================================
// Chain of Trust Service
// ============================================================================

export class ChainOfTrustService {
  private activeChains: Map<string, ActiveChain> = new Map();
  private stats: ChainStats = {
    totalChains: 0,
    activeChains: 0,
    completedChains: 0,
    failedChains: 0,
    avgChainDepth: 0,
    avgChainDuration: 0,
    loopDetections: 0,
    depthViolations: 0,
  };
  private defaultInheritanceMode: TrustInheritanceMode = 'minimum';

  constructor(inheritanceMode?: TrustInheritanceMode) {
    if (inheritanceMode) {
      this.defaultInheritanceMode = inheritanceMode;
    }
    logger.info({ inheritanceMode: this.defaultInheritanceMode }, 'Chain of trust service initialized');
  }

  // ==========================================================================
  // Chain Management
  // ==========================================================================

  /**
   * Start a new chain
   */
  startChain(
    rootRequestId: string,
    initiator: ChainLink,
    inheritanceMode: TrustInheritanceMode = this.defaultInheritanceMode
  ): ActiveChain {
    const chain: ActiveChain = {
      rootRequestId,
      links: [initiator],
      inheritanceMode,
      effectiveTier: initiator.tier,
      effectiveScore: initiator.score,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      state: 'active',
      attestations: [],
    };

    this.activeChains.set(rootRequestId, chain);
    this.stats.totalChains++;
    this.stats.activeChains++;

    logger.debug(
      { rootRequestId, initiator: initiator.carId, tier: initiator.tier },
      'Chain started'
    );

    return chain;
  }

  /**
   * Add a link to an existing chain
   */
  addLink(
    rootRequestId: string,
    link: ChainLink
  ): ChainValidationResult {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) {
      return {
        valid: false,
        effectiveTier: 0,
        effectiveScore: 0,
        warnings: [],
        violations: [{ type: 'invalid_link', message: 'Chain not found' }],
      };
    }

    if (chain.state !== 'active') {
      return {
        valid: false,
        effectiveTier: chain.effectiveTier,
        effectiveScore: chain.effectiveScore,
        warnings: [],
        violations: [{ type: 'invalid_link', message: `Chain in ${chain.state} state` }],
      };
    }

    // Validate before adding
    const validationResult = this.validateLink(chain, link);
    if (!validationResult.valid) {
      return validationResult;
    }

    // Add link
    chain.links.push(link);
    chain.lastActivityAt = new Date();

    // Recalculate effective trust
    const { tier, score } = this.calculateEffectiveTrust(chain.links, chain.inheritanceMode);
    chain.effectiveTier = tier;
    chain.effectiveScore = score;

    logger.debug(
      {
        rootRequestId,
        carId: link.carId,
        depth: chain.links.length,
        effectiveTier: tier,
      },
      'Link added to chain'
    );

    return {
      valid: true,
      effectiveTier: chain.effectiveTier,
      effectiveScore: chain.effectiveScore,
      warnings: validationResult.warnings,
      violations: [],
    };
  }

  /**
   * Complete a chain
   */
  completeChain(rootRequestId: string, attestation: A2AAttestationData): void {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) return;

    chain.attestations.push(attestation);
    chain.state = 'completed';
    chain.lastActivityAt = new Date();

    this.stats.activeChains--;
    this.stats.completedChains++;
    this.updateAverages(chain);

    logger.debug(
      { rootRequestId, depth: chain.links.length },
      'Chain completed'
    );

    // Keep completed chains for a short time for debugging
    setTimeout(() => {
      this.activeChains.delete(rootRequestId);
    }, 60000); // 1 minute retention
  }

  /**
   * Fail a chain
   */
  failChain(rootRequestId: string, reason: string): void {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) return;

    chain.state = 'failed';
    chain.lastActivityAt = new Date();

    this.stats.activeChains--;
    this.stats.failedChains++;

    logger.warn(
      { rootRequestId, reason, depth: chain.links.length },
      'Chain failed'
    );

    // Cleanup after short delay
    setTimeout(() => {
      this.activeChains.delete(rootRequestId);
    }, 60000);
  }

  /**
   * Get active chain
   */
  getChain(rootRequestId: string): ActiveChain | undefined {
    return this.activeChains.get(rootRequestId);
  }

  /**
   * Build chain context from active chain
   */
  buildContext(rootRequestId: string): ChainContext | null {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) return null;

    return {
      rootRequestId,
      depth: chain.links.length,
      maxDepth: MAX_CHAIN_DEPTH,
      trustFloor: chain.effectiveTier,
      chain: [...chain.links],
    };
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate a new link
   */
  private validateLink(chain: ActiveChain, link: ChainLink): ChainValidationResult {
    const warnings: string[] = [];
    const violations: ChainViolation[] = [];

    // Check depth
    if (chain.links.length >= MAX_CHAIN_DEPTH) {
      violations.push({
        type: 'depth_exceeded',
        message: `Chain depth ${chain.links.length + 1} would exceed maximum ${MAX_CHAIN_DEPTH}`,
      });
      this.stats.depthViolations++;
    }

    // Check for loops (same agent appearing twice)
    const existingLink = chain.links.find((l) => l.carId === link.carId);
    if (existingLink) {
      violations.push({
        type: 'loop_detected',
        message: `Agent ${link.carId} already in chain`,
        linkIndex: chain.links.indexOf(existingLink),
      });
      this.stats.loopDetections++;
    }

    // Check for significant trust drop
    const lastLink = chain.links[chain.links.length - 1];
    if (link.tier < lastLink.tier - 2) {
      warnings.push(`Trust tier dropped significantly: ${lastLink.tier} -> ${link.tier}`);
    }

    // Check for stale chain
    const chainAge = Date.now() - chain.startedAt.getTime();
    if (chainAge > 300000) { // 5 minutes
      warnings.push('Chain is stale (> 5 minutes old)');
    }

    return {
      valid: violations.length === 0,
      effectiveTier: chain.effectiveTier,
      effectiveScore: chain.effectiveScore,
      warnings,
      violations,
    };
  }

  /**
   * Validate a complete chain context
   */
  validateChainContext(context: ChainContext): ChainValidationResult {
    const warnings: string[] = [];
    const violations: ChainViolation[] = [];

    // Check depth
    if (context.depth > context.maxDepth) {
      violations.push({
        type: 'depth_exceeded',
        message: `Depth ${context.depth} exceeds max ${context.maxDepth}`,
      });
    }

    if (context.depth > MAX_CHAIN_DEPTH) {
      violations.push({
        type: 'depth_exceeded',
        message: `Depth ${context.depth} exceeds system max ${MAX_CHAIN_DEPTH}`,
      });
    }

    // Check chain length matches depth
    if (context.chain.length !== context.depth) {
      violations.push({
        type: 'invalid_link',
        message: `Chain length ${context.chain.length} doesn't match depth ${context.depth}`,
      });
    }

    // Check for loops
    const carIds = context.chain.map((l) => l.carId);
    const uniqueCarIds = new Set(carIds);
    if (uniqueCarIds.size !== carIds.length) {
      violations.push({
        type: 'loop_detected',
        message: 'Duplicate agent in chain',
      });
    }

    // Verify trust floor
    const { tier, score } = this.calculateEffectiveTrust(context.chain, 'minimum');
    if (tier !== context.trustFloor) {
      violations.push({
        type: 'invalid_link',
        message: `Trust floor mismatch: claimed ${context.trustFloor}, calculated ${tier}`,
      });
    }

    return {
      valid: violations.length === 0,
      effectiveTier: tier,
      effectiveScore: score,
      warnings,
      violations,
    };
  }

  // ==========================================================================
  // Trust Calculation
  // ==========================================================================

  /**
   * Calculate effective trust from chain
   */
  calculateEffectiveTrust(
    links: ChainLink[],
    mode: TrustInheritanceMode
  ): { tier: number; score: number } {
    if (links.length === 0) {
      return { tier: 0, score: 0 };
    }

    switch (mode) {
      case 'minimum':
        // Trust is the minimum of all agents in chain
        return {
          tier: Math.min(...links.map((l) => l.tier)),
          score: Math.min(...links.map((l) => l.score)),
        };

      case 'weighted':
        // Trust is weighted average, more weight to recent links
        const totalWeight = links.reduce((sum, _, i) => sum + (i + 1), 0);
        const weightedTier = links.reduce((sum, l, i) => sum + l.tier * (i + 1), 0) / totalWeight;
        const weightedScore = links.reduce((sum, l, i) => sum + l.score * (i + 1), 0) / totalWeight;
        return {
          tier: Math.floor(weightedTier),
          score: Math.floor(weightedScore),
        };

      case 'caller_only':
        // Trust is only the immediate caller (last in chain)
        const lastLink = links[links.length - 1];
        return {
          tier: lastLink.tier,
          score: lastLink.score,
        };

      case 'root_only':
        // Trust is only the root caller (first in chain)
        return {
          tier: links[0].tier,
          score: links[0].score,
        };

      default:
        return {
          tier: Math.min(...links.map((l) => l.tier)),
          score: Math.min(...links.map((l) => l.score)),
        };
    }
  }

  /**
   * Get minimum tier required for an action given a chain
   */
  getMinimumTierForAction(
    chain: ChainLink[],
    actionMinTier: number,
    mode: TrustInheritanceMode = 'minimum'
  ): number {
    const { tier } = this.calculateEffectiveTrust(chain, mode);
    return Math.max(tier, actionMinTier);
  }

  // ==========================================================================
  // Chain Visualization
  // ==========================================================================

  /**
   * Generate chain visualization for debugging
   */
  visualizeChain(rootRequestId: string): string {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) return 'Chain not found';

    const lines: string[] = [
      `Chain: ${rootRequestId}`,
      `State: ${chain.state}`,
      `Mode: ${chain.inheritanceMode}`,
      `Effective: T${chain.effectiveTier} (${chain.effectiveScore})`,
      '',
      'Links:',
    ];

    chain.links.forEach((link, i) => {
      const indent = '  '.repeat(i);
      lines.push(
        `${indent}${i + 1}. ${link.carId} [T${link.tier}:${link.score}] -> ${link.action}`
      );
    });

    return lines.join('\n');
  }

  /**
   * Export chain for analysis
   */
  exportChain(rootRequestId: string): {
    chain: ActiveChain | null;
    visualization: string;
    validation: ChainValidationResult | null;
  } {
    const chain = this.activeChains.get(rootRequestId);
    if (!chain) {
      return {
        chain: null,
        visualization: 'Chain not found',
        validation: null,
      };
    }

    const context = this.buildContext(rootRequestId);

    return {
      chain,
      visualization: this.visualizeChain(rootRequestId),
      validation: context ? this.validateChainContext(context) : null,
    };
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Update rolling averages
   */
  private updateAverages(chain: ActiveChain): void {
    const duration = chain.lastActivityAt.getTime() - chain.startedAt.getTime();
    const completedCount = this.stats.completedChains;

    // Rolling average
    this.stats.avgChainDepth =
      (this.stats.avgChainDepth * (completedCount - 1) + chain.links.length) / completedCount;
    this.stats.avgChainDuration =
      (this.stats.avgChainDuration * (completedCount - 1) + duration) / completedCount;
  }

  /**
   * Get statistics
   */
  getStats(): ChainStats {
    return { ...this.stats };
  }

  /**
   * Get all active chains (for monitoring)
   */
  getActiveChains(): ActiveChain[] {
    return Array.from(this.activeChains.values()).filter((c) => c.state === 'active');
  }

  /**
   * Cleanup expired chains
   */
  cleanupExpiredChains(maxAgeMs: number = 600000): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [id, chain] of this.activeChains) {
      const age = now - chain.lastActivityAt.getTime();
      if (age > maxAgeMs && chain.state === 'active') {
        chain.state = 'expired';
        this.stats.activeChains--;
        this.stats.failedChains++;
        cleaned++;

        logger.warn({ rootRequestId: id, age }, 'Chain expired');

        // Remove after short delay
        setTimeout(() => {
          this.activeChains.delete(id);
        }, 10000);
      }
    }

    return cleaned;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: ChainOfTrustService | null = null;

export function createChainOfTrustService(
  inheritanceMode?: TrustInheritanceMode
): ChainOfTrustService {
  if (!instance) {
    instance = new ChainOfTrustService(inheritanceMode);
  }
  return instance;
}

export function getChainOfTrustService(): ChainOfTrustService {
  if (!instance) {
    throw new Error('ChainOfTrustService not initialized');
  }
  return instance;
}
