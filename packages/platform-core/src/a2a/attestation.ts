/**
 * A2A Attestation Service
 *
 * Generates and processes attestations for agent-to-agent interactions.
 * Integrates with the Agent Anchor attestation system for trust scoring.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import {
  type A2AAttestationData,
  type A2AMessage,
  type ResponsePayload,
  type ChainLink,
  type ExecutionMetrics,
} from './types.js';

const logger = createLogger({ component: 'a2a-attestation' });

// ============================================================================
// Types
// ============================================================================

/**
 * A2A attestation record
 */
export interface A2AAttestation {
  /** Unique attestation ID */
  id: string;

  /** Attestation type (always 'a2a_interaction') */
  type: 'a2a_interaction';

  /** Caller CAR ID */
  callerCarId: string;

  /** Callee CAR ID */
  calleeCarId: string;

  /** Action invoked */
  action: string;

  /** Request ID */
  requestId: string;

  /** Root request ID (for chains) */
  rootRequestId?: string;

  /** Success/failure */
  outcome: 'success' | 'failure' | 'timeout' | 'rejected';

  /** Attestation data */
  data: A2AAttestationData;

  /** Chain information */
  chain: {
    depth: number;
    trustFloor: number;
    links: ChainLink[];
  };

  /** Timestamp */
  timestamp: string;

  /** Signed by callee */
  calleeSignature?: string;
}

/**
 * Attestation batch for efficient processing
 */
export interface AttestationBatch {
  attestations: A2AAttestation[];
  batchId: string;
  createdAt: string;
}

/**
 * Trust score impact calculation
 */
export interface TrustImpact {
  carId: string;
  scoreChange: number;
  reason: string;
  factors: Record<string, number>;
}

/**
 * Attestation submission callback
 */
export type AttestationCallback = (attestation: A2AAttestation) => Promise<void>;

// ============================================================================
// A2A Attestation Service
// ============================================================================

export class A2AAttestationService {
  private pendingAttestations: A2AAttestation[] = [];
  private callbacks: AttestationCallback[] = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config: { batchSize?: number; flushIntervalMs?: number } = {}) {
    this.batchSize = config.batchSize ?? 50;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    logger.info({ batchSize: this.batchSize, flushIntervalMs: this.flushIntervalMs }, 'A2A attestation service initialized');
  }

  /**
   * Start periodic flushing
   */
  start(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error({ error: err }, 'Failed to flush attestations');
      });
    }, this.flushIntervalMs);

    logger.info('A2A attestation service started');
  }

  /**
   * Stop periodic flushing
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining
    await this.flush();

    logger.info('A2A attestation service stopped');
  }

  /**
   * Register callback for attestation submission
   */
  onAttestation(callback: AttestationCallback): void {
    this.callbacks.push(callback);
  }

  // ==========================================================================
  // Attestation Generation
  // ==========================================================================

  /**
   * Generate attestation from A2A invoke result
   */
  generateAttestation(
    request: A2AMessage,
    response: A2AMessage | null,
    durationMs: number
  ): A2AAttestation {
    const responsePayload = response?.payload as ResponsePayload | undefined;
    const invokePayload = request.payload as any;

    const outcome = this.determineOutcome(response, responsePayload);
    const violations = this.extractViolations(response, responsePayload);

    const attestationData: A2AAttestationData = {
      callerCarId: request.from,
      calleeCarId: request.to,
      action: invokePayload.action || 'unknown',
      success: outcome === 'success',
      responseTimeMs: durationMs,
      trustNegotiated: !!request.trustContext.trustProof,
      trustRequirementsMet: outcome !== 'rejected',
      violations,
      chainDepth: request.trustContext.callChain.length + 1,
      delegationUsed: !!request.trustContext.delegation,
    };

    const attestation: A2AAttestation = {
      id: `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'a2a_interaction',
      callerCarId: request.from,
      calleeCarId: request.to,
      action: invokePayload.action || 'unknown',
      requestId: request.id,
      rootRequestId: invokePayload.chainContext?.rootRequestId,
      outcome,
      data: attestationData,
      chain: {
        depth: request.trustContext.callChain.length + 1,
        trustFloor: this.calculateTrustFloor(request.trustContext.callChain),
        links: request.trustContext.callChain,
      },
      timestamp: new Date().toISOString(),
    };

    return attestation;
  }

  /**
   * Record an attestation
   */
  async record(attestation: A2AAttestation): Promise<void> {
    this.pendingAttestations.push(attestation);

    logger.debug(
      {
        id: attestation.id,
        caller: attestation.callerCarId,
        callee: attestation.calleeCarId,
        outcome: attestation.outcome,
      },
      'Attestation recorded'
    );

    // Flush if batch full
    if (this.pendingAttestations.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush pending attestations
   */
  async flush(): Promise<number> {
    if (this.pendingAttestations.length === 0) {
      return 0;
    }

    const batch = [...this.pendingAttestations];
    this.pendingAttestations = [];

    logger.info({ count: batch.length }, 'Flushing A2A attestations');

    // Submit to callbacks
    for (const callback of this.callbacks) {
      for (const attestation of batch) {
        try {
          await callback(attestation);
        } catch (error) {
          logger.error({ error, attestationId: attestation.id }, 'Callback failed');
        }
      }
    }

    return batch.length;
  }

  // ==========================================================================
  // Trust Impact Calculation
  // ==========================================================================

  /**
   * Calculate trust impact for both caller and callee
   */
  calculateTrustImpact(attestation: A2AAttestation): TrustImpact[] {
    const impacts: TrustImpact[] = [];

    // Caller impact
    const callerImpact = this.calculateCallerImpact(attestation);
    if (callerImpact.scoreChange !== 0) {
      impacts.push(callerImpact);
    }

    // Callee impact
    const calleeImpact = this.calculateCalleeImpact(attestation);
    if (calleeImpact.scoreChange !== 0) {
      impacts.push(calleeImpact);
    }

    return impacts;
  }

  /**
   * Calculate caller trust impact
   */
  private calculateCallerImpact(attestation: A2AAttestation): TrustImpact {
    const factors: Record<string, number> = {};
    let scoreChange = 0;

    // Successful calls build trust
    if (attestation.outcome === 'success') {
      factors['successful_call'] = 1;
      scoreChange += 1;

      // Bonus for deep chains (shows coordination ability)
      if (attestation.chain.depth > 2) {
        factors['chain_coordination'] = Math.min(attestation.chain.depth - 2, 3);
        scoreChange += factors['chain_coordination'];
      }
    }

    // Failures reduce trust slightly
    if (attestation.outcome === 'failure') {
      factors['failed_call'] = -1;
      scoreChange -= 1;
    }

    // Rejections (trust violations) are worse
    if (attestation.outcome === 'rejected') {
      factors['trust_rejection'] = -5;
      scoreChange -= 5;
    }

    // Violations
    const violationCount = attestation.data.violations.length;
    if (violationCount > 0) {
      factors['violations'] = -violationCount * 2;
      scoreChange += factors['violations'];
    }

    return {
      carId: attestation.callerCarId,
      scoreChange,
      reason: `A2A call to ${attestation.calleeCarId}: ${attestation.outcome}`,
      factors,
    };
  }

  /**
   * Calculate callee trust impact
   */
  private calculateCalleeImpact(attestation: A2AAttestation): TrustImpact {
    const factors: Record<string, number> = {};
    let scoreChange = 0;

    // Successfully serving requests builds trust
    if (attestation.outcome === 'success') {
      factors['successful_service'] = 2;
      scoreChange += 2;

      // Fast responses are valued
      if (attestation.data.responseTimeMs < 100) {
        factors['fast_response'] = 1;
        scoreChange += 1;
      }
    }

    // Failures hurt callee reputation
    if (attestation.outcome === 'failure') {
      factors['service_failure'] = -2;
      scoreChange -= 2;
    }

    // Timeouts are worse
    if (attestation.outcome === 'timeout') {
      factors['timeout'] = -5;
      scoreChange -= 5;
    }

    return {
      carId: attestation.calleeCarId,
      scoreChange,
      reason: `A2A service to ${attestation.callerCarId}: ${attestation.outcome}`,
      factors,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Determine outcome from response
   */
  private determineOutcome(
    response: A2AMessage | null,
    payload: ResponsePayload | undefined
  ): A2AAttestation['outcome'] {
    if (!response) {
      return 'timeout';
    }

    if (!payload) {
      return 'failure';
    }

    if (payload.error?.code === 'TRUST_INSUFFICIENT' ||
        payload.error?.code === 'CAPABILITY_DENIED') {
      return 'rejected';
    }

    if (payload.success) {
      return 'success';
    }

    return 'failure';
  }

  /**
   * Extract violations from response
   */
  private extractViolations(
    response: A2AMessage | null,
    payload: ResponsePayload | undefined
  ): string[] {
    const violations: string[] = [];

    if (!response || !payload) {
      return violations;
    }

    if (payload.error) {
      violations.push(`${payload.error.code}: ${payload.error.message}`);
    }

    return violations;
  }

  /**
   * Calculate trust floor from chain
   */
  private calculateTrustFloor(chain: ChainLink[]): number {
    if (chain.length === 0) {
      return 7; // Maximum if no chain
    }
    return Math.min(...chain.map((l) => l.tier));
  }

  // ==========================================================================
  // Analytics
  // ==========================================================================

  /**
   * Generate A2A analytics for an agent
   */
  generateAnalytics(
    attestations: A2AAttestation[],
    carId: string
  ): {
    asCallerStats: Record<string, number>;
    asCalleeStats: Record<string, number>;
    topPartners: { carId: string; count: number }[];
    avgResponseTime: number;
    successRate: number;
  } {
    const asCaller = attestations.filter((a) => a.callerCarId === carId);
    const asCallee = attestations.filter((a) => a.calleeCarId === carId);

    // Caller stats
    const asCallerStats = {
      total: asCaller.length,
      success: asCaller.filter((a) => a.outcome === 'success').length,
      failure: asCaller.filter((a) => a.outcome === 'failure').length,
      rejected: asCaller.filter((a) => a.outcome === 'rejected').length,
      timeout: asCaller.filter((a) => a.outcome === 'timeout').length,
    };

    // Callee stats
    const asCalleeStats = {
      total: asCallee.length,
      success: asCallee.filter((a) => a.outcome === 'success').length,
      failure: asCallee.filter((a) => a.outcome === 'failure').length,
      rejected: asCallee.filter((a) => a.outcome === 'rejected').length,
      timeout: asCallee.filter((a) => a.outcome === 'timeout').length,
    };

    // Top partners
    const partnerCounts = new Map<string, number>();
    for (const a of asCaller) {
      partnerCounts.set(a.calleeCarId, (partnerCounts.get(a.calleeCarId) || 0) + 1);
    }
    for (const a of asCallee) {
      partnerCounts.set(a.callerCarId, (partnerCounts.get(a.callerCarId) || 0) + 1);
    }
    const topPartners = Array.from(partnerCounts.entries())
      .map(([carId, count]) => ({ carId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Avg response time (as callee)
    const responseTimes = asCallee
      .filter((a) => a.outcome === 'success')
      .map((a) => a.data.responseTimeMs);
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    // Overall success rate
    const totalInteractions = asCaller.length + asCallee.length;
    const successfulInteractions = asCaller.filter((a) => a.outcome === 'success').length +
      asCallee.filter((a) => a.outcome === 'success').length;
    const successRate = totalInteractions > 0 ? successfulInteractions / totalInteractions : 0;

    return {
      asCallerStats,
      asCalleeStats,
      topPartners,
      avgResponseTime,
      successRate,
    };
  }

  /**
   * Get pending attestation count
   */
  getPendingCount(): number {
    return this.pendingAttestations.length;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: A2AAttestationService | null = null;

export function createA2AAttestationService(
  config?: { batchSize?: number; flushIntervalMs?: number }
): A2AAttestationService {
  if (!instance) {
    instance = new A2AAttestationService(config);
  }
  return instance;
}

export function getA2AAttestationService(): A2AAttestationService {
  if (!instance) {
    throw new Error('A2AAttestationService not initialized');
  }
  return instance;
}
