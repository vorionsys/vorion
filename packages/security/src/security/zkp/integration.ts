/**
 * Policy Engine Integration for Zero-Knowledge Proofs
 *
 * Provides integration between the ZKP system and the Vorion policy engine:
 * - ZK proof as policy condition
 * - Proof caching in sessions
 * - Proof refresh policies
 * - Automatic proof validation in policy evaluation
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type ZKProof,
  type VerificationResult,
  type ZKProofPolicyCondition,
  type SessionProofCache,
  type ComplianceVerificationType,
  ZKCircuitType,
  zkProofPolicyConditionSchema,
} from './types.js';
import { ZKVerifierService, createZKVerifier } from './verifier.js';
import { ZKProverService, createZKProver } from './prover.js';

const logger = createLogger({ component: 'zkp-integration' });

// =============================================================================
// METRICS
// =============================================================================

const policyZKPConditionEvaluations = new Counter({
  name: 'vorion_zkp_policy_condition_evaluations_total',
  help: 'Total ZKP policy condition evaluations',
  labelNames: ['circuit', 'result'] as const,
  registers: [vorionRegistry],
});

const sessionCacheSize = new Gauge({
  name: 'vorion_zkp_session_cache_size',
  help: 'Current size of session proof cache',
  registers: [vorionRegistry],
});

const proofRefreshes = new Counter({
  name: 'vorion_zkp_proof_refreshes_total',
  help: 'Total proof refreshes triggered',
  labelNames: ['circuit', 'reason'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// ERRORS
// =============================================================================

/**
 * ZKP policy integration error
 */
export class ZKPPolicyError extends VorionError {
  override code = 'ZKP_POLICY_ERROR';
  override statusCode = 403;

  constructor(message: string, public readonly circuit?: string, details?: Record<string, unknown>) {
    super(message, { circuit, ...details });
    this.name = 'ZKPPolicyError';
  }
}

// =============================================================================
// SESSION PROOF CACHE
// =============================================================================

/**
 * Session-based proof cache
 *
 * Caches ZK proofs and verification results per session to avoid
 * repeated proof generation and verification.
 *
 * Features:
 * - Per-session isolation
 * - Automatic expiration
 * - Proof refresh tracking
 *
 * @example
 * ```typescript
 * const cache = new SessionProofCacheManager();
 *
 * // Store proof for session
 * await cache.storeProof(sessionId, proof);
 *
 * // Retrieve cached proof
 * const proof = cache.getProof(sessionId, 'age_verification');
 *
 * // Check if proof needs refresh
 * const needsRefresh = cache.needsRefresh(sessionId, 'age_verification');
 * ```
 */
export class SessionProofCacheManager {
  private sessions: Map<string, SessionProofCacheEntry> = new Map();
  private readonly defaultSessionTTL: number;
  private readonly refreshThreshold: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options?: {
    /** Default session TTL in milliseconds (default: 1 hour) */
    sessionTTL?: number;
    /** Refresh threshold as percentage of TTL (default: 0.2 = 20%) */
    refreshThreshold?: number;
    /** Cleanup interval in milliseconds (default: 5 minutes) */
    cleanupInterval?: number;
  }) {
    this.defaultSessionTTL = options?.sessionTTL ?? 3600000; // 1 hour
    this.refreshThreshold = options?.refreshThreshold ?? 0.2;

    // Start cleanup timer
    const interval = options?.cleanupInterval ?? 300000; // 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), interval);

    logger.info({
      sessionTTL: this.defaultSessionTTL,
      refreshThreshold: this.refreshThreshold,
    }, 'Session proof cache manager initialized');
  }

  /**
   * Create or get a session
   */
  getOrCreateSession(sessionId: string, ttl?: number): SessionProofCacheEntry {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        sessionId,
        proofs: new Map(),
        verificationResults: new Map(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + (ttl ?? this.defaultSessionTTL)),
        lastAccessedAt: new Date(),
      };
      this.sessions.set(sessionId, session);
      sessionCacheSize.set(this.sessions.size);
    }

    session.lastAccessedAt = new Date();
    return session;
  }

  /**
   * Store a proof in the session cache
   */
  storeProof(sessionId: string, proof: ZKProof): void {
    const session = this.getOrCreateSession(sessionId);
    session.proofs.set(proof.circuit, proof);
    logger.debug({ sessionId, circuit: proof.circuit }, 'Stored proof in session cache');
  }

  /**
   * Store a verification result in the session cache
   */
  storeVerificationResult(sessionId: string, circuit: string, result: VerificationResult): void {
    const session = this.getOrCreateSession(sessionId);
    session.verificationResults.set(circuit, result);
    logger.debug({ sessionId, circuit }, 'Stored verification result in session cache');
  }

  /**
   * Get a cached proof
   */
  getProof(sessionId: string, circuit: string): ZKProof | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.lastAccessedAt = new Date();
    return session.proofs.get(circuit);
  }

  /**
   * Get a cached verification result
   */
  getVerificationResult(sessionId: string, circuit: string): VerificationResult | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.lastAccessedAt = new Date();
    return session.verificationResults.get(circuit);
  }

  /**
   * Check if a proof needs refresh based on remaining TTL
   */
  needsRefresh(sessionId: string, circuit: string): boolean {
    const proof = this.getProof(sessionId, circuit);
    if (!proof || !proof.expiresAt) return true;

    const remainingMs = proof.expiresAt.getTime() - Date.now();
    const totalMs = proof.expiresAt.getTime() - proof.timestamp.getTime();
    const remainingRatio = remainingMs / totalMs;

    return remainingRatio <= this.refreshThreshold;
  }

  /**
   * Check if a proof is valid (not expired)
   */
  isProofValid(sessionId: string, circuit: string): boolean {
    const proof = this.getProof(sessionId, circuit);
    if (!proof) return false;
    if (!proof.expiresAt) return true;

    return proof.expiresAt.getTime() > Date.now();
  }

  /**
   * Invalidate a specific proof
   */
  invalidateProof(sessionId: string, circuit: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.proofs.delete(circuit);
      session.verificationResults.delete(circuit);
      logger.debug({ sessionId, circuit }, 'Invalidated proof in session cache');
    }
  }

  /**
   * Invalidate all proofs for a session
   */
  invalidateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    sessionCacheSize.set(this.sessions.size);
    logger.debug({ sessionId }, 'Invalidated session cache');
  }

  /**
   * Get all circuits with cached proofs for a session
   */
  getCachedCircuits(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.proofs.keys());
  }

  /**
   * Clean up expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    const entries = Array.from(this.sessions.entries());
    for (const [sessionId, session] of entries) {
      if (now > session.expiresAt.getTime()) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      sessionCacheSize.set(this.sessions.size);
      logger.debug({ cleaned }, 'Cleaned up expired sessions');
    }
  }

  /**
   * Destroy the cache manager
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    sessionCacheSize.set(0);
    logger.info('Session proof cache manager destroyed');
  }
}

/**
 * Session cache entry
 */
interface SessionProofCacheEntry {
  sessionId: string;
  proofs: Map<string, ZKProof>;
  verificationResults: Map<string, VerificationResult>;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
}

// =============================================================================
// PROOF REFRESH POLICY
// =============================================================================

/**
 * Proof refresh policy configuration
 */
export interface ProofRefreshPolicy {
  /** Circuit type this policy applies to */
  circuit: ZKCircuitType | string;
  /** Minimum validity period in milliseconds */
  minValidityPeriod: number;
  /** Whether to auto-refresh when below threshold */
  autoRefresh: boolean;
  /** Refresh callback (for auto-refresh) */
  refreshCallback?: (sessionId: string, circuit: string) => Promise<ZKProof | null>;
  /** Maximum refresh attempts */
  maxRefreshAttempts: number;
}

/**
 * Proof Refresh Manager
 *
 * Manages automatic proof refresh based on policies.
 */
export class ProofRefreshManager {
  private policies: Map<string, ProofRefreshPolicy> = new Map();
  private refreshAttempts: Map<string, number> = new Map();
  private prover: ZKProverService;

  constructor(prover?: ZKProverService) {
    this.prover = prover ?? createZKProver();
    logger.info('Proof refresh manager initialized');
  }

  /**
   * Register a refresh policy for a circuit
   */
  registerPolicy(policy: ProofRefreshPolicy): void {
    this.policies.set(policy.circuit, policy);
    logger.info({ circuit: policy.circuit }, 'Registered proof refresh policy');
  }

  /**
   * Get policy for a circuit
   */
  getPolicy(circuit: string): ProofRefreshPolicy | undefined {
    return this.policies.get(circuit);
  }

  /**
   * Check if proof needs refresh based on policy
   */
  needsRefresh(proof: ZKProof): boolean {
    const policy = this.policies.get(proof.circuit);
    if (!policy) return false;

    if (!proof.expiresAt) return false;

    const remainingMs = proof.expiresAt.getTime() - Date.now();
    return remainingMs < policy.minValidityPeriod;
  }

  /**
   * Attempt to refresh a proof
   */
  async refreshProof(
    sessionId: string,
    circuit: string,
    currentProof?: ZKProof
  ): Promise<ZKProof | null> {
    const policy = this.policies.get(circuit);
    if (!policy || !policy.autoRefresh) {
      return null;
    }

    const attemptKey = `${sessionId}:${circuit}`;
    const attempts = this.refreshAttempts.get(attemptKey) ?? 0;

    if (attempts >= policy.maxRefreshAttempts) {
      logger.warn({ sessionId, circuit, attempts }, 'Max refresh attempts reached');
      proofRefreshes.inc({ circuit, reason: 'max_attempts' });
      return null;
    }

    try {
      this.refreshAttempts.set(attemptKey, attempts + 1);

      let newProof: ZKProof | null = null;

      if (policy.refreshCallback) {
        newProof = await policy.refreshCallback(sessionId, circuit);
      }

      if (newProof) {
        // Reset attempts on success
        this.refreshAttempts.delete(attemptKey);
        proofRefreshes.inc({ circuit, reason: 'success' });
        logger.info({ sessionId, circuit }, 'Proof refreshed successfully');
      }

      return newProof;

    } catch (error) {
      proofRefreshes.inc({ circuit, reason: 'error' });
      logger.error({ error, sessionId, circuit }, 'Proof refresh failed');
      return null;
    }
  }

  /**
   * Clear refresh attempts for a session
   */
  clearAttempts(sessionId: string): void {
    const keys = Array.from(this.refreshAttempts.keys());
    for (const key of keys) {
      if (key.startsWith(`${sessionId}:`)) {
        this.refreshAttempts.delete(key);
      }
    }
  }
}

// =============================================================================
// POLICY ENGINE INTEGRATION
// =============================================================================

/**
 * ZKP Policy Condition Evaluator
 *
 * Evaluates ZK proof conditions as part of policy evaluation.
 *
 * Integration with Vorion policy engine:
 * - Register as custom condition type
 * - Evaluate ZKP requirements
 * - Cache results in session
 *
 * @example
 * ```typescript
 * const evaluator = new ZKPPolicyConditionEvaluator();
 *
 * // Define a policy condition requiring age proof
 * const condition: ZKProofPolicyCondition = {
 *   circuit: ZKCircuitType.AGE_VERIFICATION,
 *   publicInputsPattern: { ageThreshold: 18 },
 *   maxProofAge: 3600000 // 1 hour
 * };
 *
 * // Evaluate condition
 * const result = await evaluator.evaluate(sessionId, condition, proof);
 * ```
 */
export class ZKPPolicyConditionEvaluator {
  private verifier: ZKVerifierService;
  private sessionCache: SessionProofCacheManager;
  private refreshManager: ProofRefreshManager;

  constructor(options?: {
    verifier?: ZKVerifierService;
    sessionCache?: SessionProofCacheManager;
    refreshManager?: ProofRefreshManager;
  }) {
    this.verifier = options?.verifier ?? createZKVerifier();
    this.sessionCache = options?.sessionCache ?? new SessionProofCacheManager();
    this.refreshManager = options?.refreshManager ?? new ProofRefreshManager();
    logger.info('ZKP policy condition evaluator initialized');
  }

  /**
   * Evaluate a ZKP policy condition
   */
  async evaluate(
    sessionId: string,
    condition: ZKProofPolicyCondition,
    providedProof?: ZKProof
  ): Promise<PolicyConditionResult> {
    zkProofPolicyConditionSchema.parse(condition);

    try {
      // Get proof from session cache or use provided proof
      let proof = providedProof ?? this.sessionCache.getProof(sessionId, condition.circuit);

      // Check if we need to refresh
      if (proof && this.refreshManager.needsRefresh(proof)) {
        logger.debug({ sessionId, circuit: condition.circuit }, 'Proof needs refresh');

        const refreshedProof = await this.refreshManager.refreshProof(
          sessionId,
          condition.circuit,
          proof
        );

        if (refreshedProof) {
          proof = refreshedProof;
          this.sessionCache.storeProof(sessionId, proof);
        }
      }

      // No proof available
      if (!proof) {
        policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'no_proof' });

        return {
          satisfied: false,
          reason: 'No ZK proof available for required circuit',
          circuit: condition.circuit,
          requiresProof: true,
        };
      }

      // Check proof age
      if (condition.maxProofAge) {
        const proofAge = Date.now() - proof.timestamp.getTime();
        if (proofAge > condition.maxProofAge) {
          policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'expired' });

          return {
            satisfied: false,
            reason: 'ZK proof exceeds maximum age',
            circuit: condition.circuit,
            requiresProof: true,
            proofAge,
          };
        }
      }

      // Check cached verification result
      if (condition.allowCachedVerification !== false) {
        const cachedResult = this.sessionCache.getVerificationResult(sessionId, condition.circuit);
        if (cachedResult?.valid) {
          policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'cached_valid' });

          return {
            satisfied: true,
            circuit: condition.circuit,
            verificationResult: cachedResult,
            fromCache: true,
          };
        }
      }

      // Verify the proof
      const verificationResult = await this.verifier.verify(proof);
      this.sessionCache.storeVerificationResult(sessionId, condition.circuit, verificationResult);

      if (!verificationResult.valid) {
        policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'invalid' });

        return {
          satisfied: false,
          reason: verificationResult.error ?? 'ZK proof verification failed',
          circuit: condition.circuit,
          verificationResult,
          requiresProof: true,
        };
      }

      // Check public inputs pattern
      if (condition.publicInputsPattern) {
        const patternMatch = this.matchPublicInputsPattern(
          proof.publicInputs,
          condition.publicInputsPattern
        );

        if (!patternMatch) {
          policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'pattern_mismatch' });

          return {
            satisfied: false,
            reason: 'ZK proof public inputs do not match required pattern',
            circuit: condition.circuit,
            verificationResult,
          };
        }
      }

      policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'satisfied' });

      return {
        satisfied: true,
        circuit: condition.circuit,
        verificationResult,
      };

    } catch (error) {
      policyZKPConditionEvaluations.inc({ circuit: condition.circuit, result: 'error' });
      logger.error({ error, sessionId, circuit: condition.circuit }, 'ZKP condition evaluation error');

      return {
        satisfied: false,
        reason: `Evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        circuit: condition.circuit,
      };
    }
  }

  /**
   * Evaluate multiple conditions (AND logic)
   */
  async evaluateAll(
    sessionId: string,
    conditions: ZKProofPolicyCondition[],
    proofs?: Map<string, ZKProof>
  ): Promise<MultiConditionResult> {
    const results: PolicyConditionResult[] = [];

    for (const condition of conditions) {
      const proof = proofs?.get(condition.circuit);
      const result = await this.evaluate(sessionId, condition, proof);
      results.push(result);

      // Short-circuit on failure (AND logic)
      if (!result.satisfied) {
        return {
          allSatisfied: false,
          results,
          failedCondition: result,
        };
      }
    }

    return {
      allSatisfied: true,
      results,
    };
  }

  /**
   * Evaluate conditions with OR logic (any one satisfied)
   */
  async evaluateAny(
    sessionId: string,
    conditions: ZKProofPolicyCondition[],
    proofs?: Map<string, ZKProof>
  ): Promise<MultiConditionResult> {
    const results: PolicyConditionResult[] = [];
    let satisfiedResult: PolicyConditionResult | undefined;

    for (const condition of conditions) {
      const proof = proofs?.get(condition.circuit);
      const result = await this.evaluate(sessionId, condition, proof);
      results.push(result);

      if (result.satisfied) {
        satisfiedResult = result;
        break; // Found one that works
      }
    }

    return {
      allSatisfied: satisfiedResult !== undefined,
      results,
      satisfiedCondition: satisfiedResult,
    };
  }

  /**
   * Get missing proofs for conditions
   */
  getMissingProofs(sessionId: string, conditions: ZKProofPolicyCondition[]): string[] {
    const missing: string[] = [];

    for (const condition of conditions) {
      const proof = this.sessionCache.getProof(sessionId, condition.circuit);
      if (!proof || !this.sessionCache.isProofValid(sessionId, condition.circuit)) {
        missing.push(condition.circuit);
      }
    }

    return missing;
  }

  /**
   * Match public inputs against a pattern
   */
  private matchPublicInputsPattern(
    publicInputs: string[],
    pattern: Record<string, unknown>
  ): boolean {
    // Pattern matching is based on index-based or named inputs
    // For simplicity, we check that required values appear in the inputs
    const requiredValues = Object.values(pattern).map(v => String(v));

    for (const required of requiredValues) {
      if (!publicInputs.includes(required)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the session cache manager
   */
  getSessionCache(): SessionProofCacheManager {
    return this.sessionCache;
  }

  /**
   * Get the refresh manager
   */
  getRefreshManager(): ProofRefreshManager {
    return this.refreshManager;
  }

  /**
   * Destroy the evaluator and cleanup resources
   */
  destroy(): void {
    this.sessionCache.destroy();
    this.verifier.destroy();
    logger.info('ZKP policy condition evaluator destroyed');
  }
}

/**
 * Result of evaluating a single policy condition
 */
export interface PolicyConditionResult {
  /** Whether condition is satisfied */
  satisfied: boolean;
  /** Reason for failure */
  reason?: string;
  /** Circuit that was evaluated */
  circuit: string;
  /** Verification result if available */
  verificationResult?: VerificationResult;
  /** Whether proof is required but missing */
  requiresProof?: boolean;
  /** Whether result was from cache */
  fromCache?: boolean;
  /** Proof age in milliseconds */
  proofAge?: number;
}

/**
 * Result of evaluating multiple conditions
 */
export interface MultiConditionResult {
  /** Whether all (AND) or any (OR) conditions are satisfied */
  allSatisfied: boolean;
  /** Individual results */
  results: PolicyConditionResult[];
  /** First failed condition (for AND) */
  failedCondition?: PolicyConditionResult;
  /** First satisfied condition (for OR) */
  satisfiedCondition?: PolicyConditionResult;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a session proof cache manager
 */
export function createSessionProofCache(options?: {
  sessionTTL?: number;
  refreshThreshold?: number;
  cleanupInterval?: number;
}): SessionProofCacheManager {
  return new SessionProofCacheManager(options);
}

/**
 * Create a proof refresh manager
 */
export function createProofRefreshManager(prover?: ZKProverService): ProofRefreshManager {
  return new ProofRefreshManager(prover);
}

/**
 * Create a ZKP policy condition evaluator
 */
export function createZKPPolicyEvaluator(options?: {
  verifier?: ZKVerifierService;
  sessionCache?: SessionProofCacheManager;
  refreshManager?: ProofRefreshManager;
}): ZKPPolicyConditionEvaluator {
  return new ZKPPolicyConditionEvaluator(options);
}
