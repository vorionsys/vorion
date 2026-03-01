/**
 * Sandbox Adversarial Training Boot Camp — Promotion Service
 *
 * Orchestrates the end-to-end T0→T1 promotion pipeline:
 * Boot camp → trust signals → graduation evaluation → promotion.
 *
 * Bridges the gap between the pure-logic BootCampRunner and the
 * trust engine by feeding challenge results as real trust signals.
 *
 * @packageDocumentation
 */

import type { TrustSignal, TrustLevel } from '../common/types.js';
import type { TrustEngine, TrustTierChangedEvent } from '../trust-engine/index.js';
import { BootCampRunner } from './runner.js';
import { evaluateGraduation } from './graduation.js';
import { challengeToTrustSignal, challengeToAttestation } from './scorer.js';
import type {
  BootCampAgent,
  BootCampSession,
  BootCampConfig,
  GraduationResult,
} from './types.js';
import type { BootCampAttestation } from './scorer.js';

// =============================================================================
// TYPES
// =============================================================================

/** Result of a full promotion pipeline run */
export interface PromotionResult {
  /** The completed boot camp session */
  session: BootCampSession;
  /** Graduation evaluation */
  graduation: GraduationResult;
  /** Number of trust signals successfully recorded */
  signalsRecorded: number;
  /** Attestations generated (one per challenge) */
  attestations: BootCampAttestation[];
  /** Whether the agent was promoted to T1 */
  promoted: boolean;
  /** Final trust score after all signals recorded */
  finalScore?: number;
  /** Final trust level after all signals recorded */
  finalLevel?: TrustLevel;
}

/** Configuration for the promotion service */
export interface PromotionServiceConfig extends BootCampConfig {
  /** Whether to initialize the entity in the trust engine if not found (default: true) */
  autoInitialize?: boolean;
}

// =============================================================================
// PROMOTION SERVICE
// =============================================================================

/**
 * Orchestrates boot camp execution and trust engine integration.
 *
 * Unlike the pure-logic BootCampRunner, the PromotionService:
 * 1. Feeds every challenge signal to `TrustEngine.recordSignal()`
 * 2. Evaluates graduation readiness
 * 3. Emits a graduation milestone signal if ready
 * 4. Listens for `trust:tier_changed` to confirm promotion
 *
 * @example
 * ```typescript
 * const engine = new TrustEngine();
 * const service = new PromotionService(engine);
 * const result = await service.runAndEvaluate(agent);
 *
 * if (result.promoted) {
 *   console.log(`Agent promoted to T1 with score ${result.finalScore}`);
 * }
 * ```
 */
export class PromotionService {
  private readonly trustEngine: TrustEngine;
  private readonly runner: BootCampRunner;
  private readonly autoInitialize: boolean;

  constructor(trustEngine: TrustEngine, config: PromotionServiceConfig = {}) {
    this.trustEngine = trustEngine;
    this.runner = new BootCampRunner(config);
    this.autoInitialize = config.autoInitialize ?? true;
  }

  /**
   * Run boot camp, feed signals to trust engine, evaluate graduation.
   *
   * Full pipeline:
   * 1. Ensure agent exists in trust engine (initialize at T0 if needed)
   * 2. Run all boot camp challenges
   * 3. Record each challenge result as a trust signal
   * 4. Evaluate graduation readiness
   * 5. If ready, emit graduation milestone signal
   * 6. Return full audit trail
   */
  async runAndEvaluate(agent: BootCampAgent): Promise<PromotionResult> {
    // Step 1: Ensure agent exists in trust engine at T0
    if (this.autoInitialize) {
      const existing = await this.trustEngine.getScore(agent.agentId);
      if (!existing) {
        await this.trustEngine.initializeEntity(agent.agentId, 0 as TrustLevel);
      }
    }

    // Step 2: Run boot camp session
    const session = await this.runner.runSession(agent);

    // Step 3: Record each challenge result as a trust signal
    let signalsRecorded = 0;
    const attestations: BootCampAttestation[] = [];

    for (const result of session.results) {
      const signal = challengeToTrustSignal(result);
      await this.trustEngine.recordSignal(signal);
      signalsRecorded++;

      const attestation = challengeToAttestation(result);
      attestations.push(attestation);
    }

    // Step 4: Evaluate graduation
    const graduation = evaluateGraduation(session);

    // Step 5: If graduation ready, emit milestone signal
    let promoted = false;
    if (graduation.ready) {
      const milestoneSignal: TrustSignal = {
        id: `bootcamp-graduation-${session.sessionId}-${Date.now()}`,
        entityId: agent.agentId,
        type: 'behavioral.graduation',
        value: 1.0,
        source: 'sandbox-training',
        timestamp: new Date().toISOString(),
        metadata: {
          sessionId: session.sessionId,
          recommendedScore: graduation.recommendedScore,
          factorResults: graduation.factorResults,
        },
      };
      await this.trustEngine.recordSignal(milestoneSignal);
      signalsRecorded++;

      // Check if tier changed to T1+
      const record = await this.trustEngine.getScore(agent.agentId);
      if (record && record.level >= 1) {
        promoted = true;
      }
    }

    // Step 6: Get final state
    const finalRecord = await this.trustEngine.getScore(agent.agentId);

    return {
      session,
      graduation,
      signalsRecorded,
      attestations,
      promoted,
      finalScore: finalRecord?.score,
      finalLevel: finalRecord?.level,
    };
  }
}
