/**
 * Trust Negotiation Service
 *
 * Handles trust verification and negotiation between agents for A2A communication.
 * Verifies caller/callee trust requirements and generates trust proofs.
 *
 * @packageDocumentation
 */

import crypto from 'crypto';
import { createLogger } from '../common/logger.js';
import {
  type TrustContext,
  type TrustProof,
  type TrustRequirements,
  type DelegationToken,
  type ChainLink,
  type ChainContext,
  type A2AError,
  DEFAULT_TRUST_REQUIREMENTS,
  TRUST_PROOF_VALIDITY_SEC,
  MAX_CHAIN_DEPTH,
  MAX_DELEGATION_CHAIN,
} from './types.js';

const logger = createLogger({ component: 'a2a-trust-negotiation' });

// ============================================================================
// Types
// ============================================================================

/**
 * Trust verification result
 */
export interface TrustVerificationResult {
  /** Verification passed */
  verified: boolean;

  /** Effective trust tier after verification */
  effectiveTier: number;

  /** Effective trust score after verification */
  effectiveScore: number;

  /** Reason for failure (if not verified) */
  reason?: string;

  /** Warnings (non-fatal issues) */
  warnings: string[];

  /** Delegation used (if any) */
  delegationUsed?: DelegationToken;
}

/**
 * Trust negotiation result
 */
export interface NegotiationResult {
  /** Negotiation succeeded */
  success: boolean;

  /** Agreed trust requirements */
  agreedRequirements?: TrustRequirements;

  /** Reason for failure */
  reason?: string;

  /** Counter-proposal (if rejected) */
  counterProposal?: TrustRequirements;
}

/**
 * Agent trust info from registry
 */
export interface AgentTrustInfo {
  carId: string;
  tier: number;
  score: number;
  tenantId: string;
  capabilities: string[];
  state: string;
}

/**
 * Trust info provider interface (injected dependency)
 */
export interface TrustInfoProvider {
  getAgentTrust(carId: string): Promise<AgentTrustInfo | null>;
  validateTrustProof(proof: TrustProof): Promise<boolean>;
}

// ============================================================================
// Trust Negotiation Service
// ============================================================================

export class TrustNegotiationService {
  private signingKey: Buffer;
  private trustProvider: TrustInfoProvider;

  constructor(signingKey: string, trustProvider: TrustInfoProvider) {
    this.signingKey = Buffer.from(signingKey, 'hex');
    this.trustProvider = trustProvider;
    logger.info('Trust negotiation service initialized');
  }

  // ==========================================================================
  // Trust Verification
  // ==========================================================================

  /**
   * Verify caller trust for an A2A invocation
   */
  async verifyCallerTrust(
    callerCarId: string,
    calleeCarId: string,
    trustContext: TrustContext,
    requirements: TrustRequirements = DEFAULT_TRUST_REQUIREMENTS
  ): Promise<TrustVerificationResult> {
    const warnings: string[] = [];

    // 1. Verify caller exists and is active
    const callerInfo = await this.trustProvider.getAgentTrust(callerCarId);
    if (!callerInfo) {
      return {
        verified: false,
        effectiveTier: 0,
        effectiveScore: 0,
        reason: 'Caller agent not found',
        warnings,
      };
    }

    if (callerInfo.state !== 'active' && !callerInfo.state.startsWith('T')) {
      return {
        verified: false,
        effectiveTier: 0,
        effectiveScore: 0,
        reason: `Caller agent in invalid state: ${callerInfo.state}`,
        warnings,
      };
    }

    // 2. Verify trust context matches actual trust
    if (trustContext.callerTier !== callerInfo.tier) {
      warnings.push(`Trust context tier (${trustContext.callerTier}) differs from actual (${callerInfo.tier})`);
    }

    // 3. Verify trust proof if provided
    if (trustContext.trustProof) {
      const proofValid = await this.verifyTrustProof(trustContext.trustProof, callerCarId);
      if (!proofValid) {
        return {
          verified: false,
          effectiveTier: 0,
          effectiveScore: 0,
          reason: 'Invalid trust proof',
          warnings,
        };
      }
    }

    // 4. Calculate effective trust (considering delegation)
    let effectiveTier = callerInfo.tier;
    let effectiveScore = callerInfo.score;
    let delegationUsed: DelegationToken | undefined;

    if (trustContext.delegation) {
      const delegationResult = await this.verifyDelegation(
        trustContext.delegation,
        callerCarId,
        calleeCarId
      );

      if (delegationResult.valid) {
        // Delegation caps the effective tier
        effectiveTier = Math.min(effectiveTier, delegationResult.maxTier);
        delegationUsed = trustContext.delegation;
        logger.debug({ callerCarId, effectiveTier }, 'Using delegation for trust');
      } else {
        warnings.push(`Delegation invalid: ${delegationResult.reason}`);
      }
    }

    // 5. Apply chain-of-trust floor
    if (trustContext.callChain.length > 0) {
      const chainFloor = this.calculateChainTrustFloor(trustContext.callChain);
      effectiveTier = Math.min(effectiveTier, chainFloor.tier);
      effectiveScore = Math.min(effectiveScore, chainFloor.score);
    }

    // 6. Check against requirements
    if (effectiveTier < requirements.minTier) {
      return {
        verified: false,
        effectiveTier,
        effectiveScore,
        reason: `Trust tier ${effectiveTier} below required ${requirements.minTier}`,
        warnings,
      };
    }

    if (requirements.minScore && effectiveScore < requirements.minScore) {
      return {
        verified: false,
        effectiveTier,
        effectiveScore,
        reason: `Trust score ${effectiveScore} below required ${requirements.minScore}`,
        warnings,
      };
    }

    // 7. Check required capabilities
    for (const cap of requirements.requiredCapabilities) {
      if (!callerInfo.capabilities.includes(cap)) {
        return {
          verified: false,
          effectiveTier,
          effectiveScore,
          reason: `Missing required capability: ${cap}`,
          warnings,
        };
      }
    }

    // 8. Check chain depth
    const chainDepth = trustContext.callChain.length;
    if (requirements.maxChainDepth && chainDepth >= requirements.maxChainDepth) {
      return {
        verified: false,
        effectiveTier,
        effectiveScore,
        reason: `Chain depth ${chainDepth} exceeds maximum ${requirements.maxChainDepth}`,
        warnings,
      };
    }

    logger.debug(
      { callerCarId, calleeCarId, effectiveTier, effectiveScore, chainDepth },
      'Trust verification passed'
    );

    return {
      verified: true,
      effectiveTier,
      effectiveScore,
      warnings,
      delegationUsed,
    };
  }

  /**
   * Verify a trust proof
   */
  async verifyTrustProof(proof: TrustProof, expectedCarId: string): Promise<boolean> {
    // Check CAR ID matches
    if (proof.carId !== expectedCarId) {
      logger.warn({ proofCarId: proof.carId, expectedCarId }, 'Trust proof CAR ID mismatch');
      return false;
    }

    // Check expiration
    const expiresAt = new Date(proof.expiresAt);
    if (expiresAt < new Date()) {
      logger.warn({ expiresAt }, 'Trust proof expired');
      return false;
    }

    // Verify signature (delegate to provider)
    const valid = await this.trustProvider.validateTrustProof(proof);
    if (!valid) {
      logger.warn({ carId: proof.carId }, 'Trust proof signature invalid');
      return false;
    }

    return true;
  }

  /**
   * Generate a trust proof for an agent
   */
  async generateTrustProof(carId: string): Promise<TrustProof | null> {
    const agentInfo = await this.trustProvider.getAgentTrust(carId);
    if (!agentInfo) {
      return null;
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TRUST_PROOF_VALIDITY_SEC * 1000);

    const proof: Omit<TrustProof, 'signature'> = {
      carId,
      tier: agentInfo.tier,
      score: agentInfo.score,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      registry: 'a3i', // Agent Anchor registry
    };

    // Sign the proof
    const signature = this.signProof(proof);

    return {
      ...proof,
      signature,
    };
  }

  /**
   * Sign a trust proof
   */
  private signProof(proof: Omit<TrustProof, 'signature'>): string {
    const payload = JSON.stringify(proof);
    const hmac = crypto.createHmac('sha256', this.signingKey);
    hmac.update(payload);
    return hmac.digest('hex');
  }

  // ==========================================================================
  // Delegation Verification
  // ==========================================================================

  /**
   * Verify a delegation token
   */
  async verifyDelegation(
    delegation: DelegationToken,
    delegateCarId: string,
    targetCarId: string
  ): Promise<{ valid: boolean; maxTier: number; reason?: string }> {
    // Check delegate matches
    if (delegation.delegate !== delegateCarId) {
      return { valid: false, maxTier: 0, reason: 'Delegate CAR ID mismatch' };
    }

    // Check expiration
    const expiresAt = new Date(delegation.expiresAt);
    if (expiresAt < new Date()) {
      return { valid: false, maxTier: 0, reason: 'Delegation expired' };
    }

    // Check uses remaining
    if (delegation.usesRemaining === 0) {
      return { valid: false, maxTier: 0, reason: 'Delegation uses exhausted' };
    }

    // Check constraints
    if (delegation.constraints) {
      const { allowedTargets, blockedTargets, timeRestrictions, rateLimit } = delegation.constraints;

      // Check allowed targets
      if (allowedTargets && !allowedTargets.includes(targetCarId)) {
        return { valid: false, maxTier: 0, reason: 'Target not in allowed list' };
      }

      // Check blocked targets
      if (blockedTargets && blockedTargets.includes(targetCarId)) {
        return { valid: false, maxTier: 0, reason: 'Target in blocked list' };
      }

      // Check time restrictions
      if (timeRestrictions) {
        const now = new Date();
        const hour = now.getUTCHours(); // Simplified - should use timezone
        if (!timeRestrictions.allowedHours.includes(hour)) {
          return { valid: false, maxTier: 0, reason: 'Outside allowed hours' };
        }
      }
    }

    // Check delegation chain length
    const chainLength = this.getDelegationChainLength(delegation);
    if (chainLength > MAX_DELEGATION_CHAIN) {
      return { valid: false, maxTier: 0, reason: 'Delegation chain too long' };
    }

    // Verify delegator trust
    const delegatorInfo = await this.trustProvider.getAgentTrust(delegation.delegator);
    if (!delegatorInfo || delegatorInfo.tier < delegation.maxTier) {
      return { valid: false, maxTier: 0, reason: 'Delegator trust insufficient for granted tier' };
    }

    return { valid: true, maxTier: delegation.maxTier };
  }

  /**
   * Get delegation chain length
   */
  private getDelegationChainLength(delegation: DelegationToken): number {
    if (!delegation.chain || delegation.chain.length === 0) {
      return 1;
    }
    return 1 + Math.max(...delegation.chain.map((d) => this.getDelegationChainLength(d)));
  }

  // ==========================================================================
  // Chain of Trust
  // ==========================================================================

  /**
   * Calculate trust floor from call chain
   */
  calculateChainTrustFloor(chain: ChainLink[]): { tier: number; score: number } {
    if (chain.length === 0) {
      return { tier: 7, score: 1000 };
    }

    const minTier = Math.min(...chain.map((link) => link.tier));
    const minScore = Math.min(...chain.map((link) => link.score));

    return { tier: minTier, score: minScore };
  }

  /**
   * Build chain context for nested call
   */
  buildChainContext(
    callerCarId: string,
    callerTier: number,
    callerScore: number,
    action: string,
    requestId: string,
    parentContext?: ChainContext
  ): ChainContext {
    const newLink: ChainLink = {
      carId: callerCarId,
      tier: callerTier,
      score: callerScore,
      action,
      timestamp: new Date().toISOString(),
      requestId,
    };

    if (parentContext) {
      // Extend existing chain
      return {
        rootRequestId: parentContext.rootRequestId,
        depth: parentContext.depth + 1,
        maxDepth: parentContext.maxDepth,
        trustFloor: Math.min(parentContext.trustFloor, callerTier),
        chain: [...parentContext.chain, newLink],
      };
    }

    // Start new chain
    return {
      rootRequestId: requestId,
      depth: 1,
      maxDepth: MAX_CHAIN_DEPTH,
      trustFloor: callerTier,
      chain: [newLink],
    };
  }

  /**
   * Validate chain context
   */
  validateChainContext(context: ChainContext): { valid: boolean; reason?: string } {
    // Check depth
    if (context.depth > context.maxDepth) {
      return { valid: false, reason: `Chain depth ${context.depth} exceeds max ${context.maxDepth}` };
    }

    if (context.depth > MAX_CHAIN_DEPTH) {
      return { valid: false, reason: `Chain depth ${context.depth} exceeds system max ${MAX_CHAIN_DEPTH}` };
    }

    // Check chain consistency
    if (context.chain.length !== context.depth) {
      return { valid: false, reason: 'Chain length does not match depth' };
    }

    // Check trust floor consistency
    const calculatedFloor = this.calculateChainTrustFloor(context.chain);
    if (calculatedFloor.tier !== context.trustFloor) {
      return { valid: false, reason: 'Trust floor mismatch' };
    }

    return { valid: true };
  }

  // ==========================================================================
  // Trust Negotiation
  // ==========================================================================

  /**
   * Negotiate trust requirements between caller and callee
   */
  async negotiate(
    callerCarId: string,
    calleeCarId: string,
    callerRequirements: TrustRequirements,
    calleeRequirements: TrustRequirements
  ): Promise<NegotiationResult> {
    // Get both agents' trust info
    const callerInfo = await this.trustProvider.getAgentTrust(callerCarId);
    const calleeInfo = await this.trustProvider.getAgentTrust(calleeCarId);

    if (!callerInfo || !calleeInfo) {
      return {
        success: false,
        reason: 'One or both agents not found',
      };
    }

    // Check if caller meets callee's requirements
    if (callerInfo.tier < calleeRequirements.minTier) {
      return {
        success: false,
        reason: `Caller tier ${callerInfo.tier} below callee requirement ${calleeRequirements.minTier}`,
        counterProposal: {
          ...calleeRequirements,
          minTier: callerInfo.tier,
        },
      };
    }

    // Check if callee meets caller's requirements
    if (calleeInfo.tier < callerRequirements.minTier) {
      return {
        success: false,
        reason: `Callee tier ${calleeInfo.tier} below caller requirement ${callerRequirements.minTier}`,
        counterProposal: {
          ...callerRequirements,
          minTier: calleeInfo.tier,
        },
      };
    }

    // Merge requirements (take stricter of each)
    const agreedRequirements: TrustRequirements = {
      minTier: Math.max(callerRequirements.minTier, calleeRequirements.minTier),
      minScore: Math.max(
        callerRequirements.minScore || 0,
        calleeRequirements.minScore || 0
      ) || undefined,
      requiredCapabilities: [
        ...new Set([
          ...callerRequirements.requiredCapabilities,
          ...calleeRequirements.requiredCapabilities,
        ]),
      ],
      requiredAttestations: [
        ...new Set([
          ...(callerRequirements.requiredAttestations || []),
          ...(calleeRequirements.requiredAttestations || []),
        ]),
      ],
      maxChainDepth: Math.min(
        callerRequirements.maxChainDepth || MAX_CHAIN_DEPTH,
        calleeRequirements.maxChainDepth || MAX_CHAIN_DEPTH
      ),
      requireMtls: callerRequirements.requireMtls || calleeRequirements.requireMtls,
    };

    logger.info(
      { callerCarId, calleeCarId, agreedTier: agreedRequirements.minTier },
      'Trust negotiation successful'
    );

    return {
      success: true,
      agreedRequirements,
    };
  }

  /**
   * Build TrustContext for an A2A call
   */
  async buildTrustContext(
    callerCarId: string,
    delegation?: DelegationToken,
    parentChain?: ChainContext
  ): Promise<TrustContext | null> {
    const callerInfo = await this.trustProvider.getAgentTrust(callerCarId);
    if (!callerInfo) {
      return null;
    }

    const trustProof = await this.generateTrustProof(callerCarId);

    return {
      callerTier: callerInfo.tier,
      callerScore: callerInfo.score,
      callerTenant: callerInfo.tenantId,
      trustProof: trustProof || undefined,
      delegation,
      callChain: parentChain?.chain || [],
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: TrustNegotiationService | null = null;

export function createTrustNegotiationService(
  signingKey: string,
  trustProvider: TrustInfoProvider
): TrustNegotiationService {
  if (!instance) {
    instance = new TrustNegotiationService(signingKey, trustProvider);
  }
  return instance;
}

export function getTrustNegotiationService(): TrustNegotiationService {
  if (!instance) {
    throw new Error('TrustNegotiationService not initialized');
  }
  return instance;
}
