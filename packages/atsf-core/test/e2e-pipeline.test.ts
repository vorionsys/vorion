/**
 * End-to-End Integration Test: Boot Camp → Trust Engine → Governance → Proof
 *
 * Validates the complete pipeline that connects all Phase 1-3 modules:
 * 1. PromotionService runs boot camp and feeds signals to TrustEngine
 * 2. GovernanceEngine evaluates a request using the agent's trust level
 * 3. GovernanceProofBridge creates a cryptographic proof of the decision
 * 4. ProofService verifies the proof chain integrity
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrustEngine } from '../src/trust-engine/index.js';
import { PromotionService } from '../src/sandbox-training/promotion-service.js';
import { CHALLENGE_CATALOG } from '../src/sandbox-training/challenges.js';
import {
  createGovernanceEngine,
  createGovernanceRule,
  createFieldCondition,
  createRuleEffect,
} from '../src/governance/index.js';
import { GovernanceProofBridge } from '../src/governance/proof-bridge.js';
import { createProofService } from '../src/proof/index.js';
import type {
  BootCampAgent,
  ChallengeInput,
  ChallengeResponse,
} from '../src/sandbox-training/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/** Agent that passes most challenges with correct answers */
function createSmartAgent(id = 'agent-e2e'): BootCampAgent {
  return {
    agentId: id,
    tenantId: 'tenant-e2e',
    handleChallenge: async (input: ChallengeInput): Promise<ChallengeResponse> => {
      // Handle specific challenges to maximize pass rate
      if (input.prompt.includes('"name" and "email"') && input.data?.records) {
        const records = input.data.records as Array<Record<string, unknown>>;
        const valid = records.filter(
          (r) =>
            typeof r.name === 'string' &&
            r.name.length > 0 &&
            typeof r.email === 'string' &&
            r.email.length > 0
        );
        return { output: valid.map((r) => ({ name: r.name, email: r.email })) };
      }

      if (input.prompt.includes('Return the string "acknowledged"')) {
        return { output: 'acknowledged' };
      }

      if (input.prompt.includes('Add the numbers')) {
        return { output: 42 };
      }

      if (input.prompt.includes('no data is present')) {
        return { output: input.data ? input.data : { status: 'empty' } };
      }

      if (input.prompt.includes('Return the number 1')) {
        return { output: 1 };
      }

      return {
        output: 'acknowledged',
        confidence: 0.85,
        adversarialDetected: false,
        reasoning: 'Analyzed input and produced response based on constraints.',
      };
    },
  };
}

// =============================================================================
// E2E PIPELINE TESTS
// =============================================================================

describe('E2E Pipeline: Boot Camp → Trust → Governance → Proof', () => {
  let trustEngine: TrustEngine;
  let proofService: ReturnType<typeof createProofService>;
  let promotionService: PromotionService;

  beforeEach(() => {
    trustEngine = new TrustEngine();
    proofService = createProofService();
  });

  it('should complete full pipeline: boot camp → trust signals → governance → proof', async () => {
    // =========================================================================
    // PHASE 1: Boot Camp → Trust Engine
    // =========================================================================

    // Use a subset of challenges for speed (covers all 3 factors)
    const challenges = CHALLENGE_CATALOG.slice(0, 9); // 3 per factor
    promotionService = new PromotionService(trustEngine, {
      challenges: [...challenges],
      progressiveDifficulty: false,
    });

    const agent = createSmartAgent();
    const bootCampResult = await promotionService.runAndEvaluate(agent);

    // Verify boot camp ran
    expect(bootCampResult.session).toBeDefined();
    expect(bootCampResult.session.agentId).toBe('agent-e2e');
    expect(bootCampResult.session.results.length).toBeGreaterThan(0);

    // Verify signals were recorded in trust engine
    expect(bootCampResult.signalsRecorded).toBeGreaterThan(0);
    expect(bootCampResult.attestations.length).toBe(challenges.length);

    // Verify trust state exists
    const trustRecord = await trustEngine.getScore('agent-e2e');
    expect(trustRecord).toBeDefined();
    expect(trustRecord!.score).toBeGreaterThanOrEqual(0);
    expect(typeof trustRecord!.level).toBe('number');

    // Verify graduation was evaluated
    expect(bootCampResult.graduation).toBeDefined();
    expect(typeof bootCampResult.graduation.ready).toBe('boolean');

    // =========================================================================
    // PHASE 2: Governance Engine evaluates request with agent's trust level
    // =========================================================================

    const governanceEngine = createGovernanceEngine({ enableCaching: false });

    // Register a rule: allow read actions for any trust level
    governanceEngine.registerRule(
      createGovernanceRule(
        'allow-reads',
        'policy_enforcement',
        createFieldCondition('action', 'equals', 'read'),
        createRuleEffect('allow', 'Read operations are permitted'),
        { applicableTrustLevels: [0, 1, 2, 3, 4, 5, 6, 7] }
      )
    );

    // Register a rule: block delete for T0 agents
    governanceEngine.registerRule(
      createGovernanceRule(
        'block-delete-t0',
        'security_critical',
        createFieldCondition('action', 'equals', 'delete'),
        createRuleEffect('deny', 'T0 agents cannot delete resources'),
        { applicableTrustLevels: [0] }
      )
    );

    // =========================================================================
    // PHASE 3: Governance → Proof Bridge
    // =========================================================================

    const bridge = new GovernanceProofBridge(governanceEngine, {
      createProof: (req) => proofService.create(req),
      tenantId: 'tenant-e2e',
    });

    // Evaluate a read request — should be allowed
    const readResult = await bridge.evaluateWithProof({
      requestId: 'req-read-1',
      entityId: 'agent-e2e',
      trustLevel: trustRecord!.level,
      action: 'read',
      capabilities: ['data:read'],
      resources: ['documents'],
    });

    expect(readResult.result.decision).toBe('allow');
    expect(readResult.proofId).toBeDefined();
    expect(typeof readResult.proofId).toBe('string');

    // =========================================================================
    // PHASE 4: Verify proof chain integrity
    // =========================================================================

    const verification = await proofService.verify(readResult.proofId);
    expect(verification.valid).toBe(true);
    expect(verification.proofId).toBe(readResult.proofId);
    expect(verification.issues).toHaveLength(0);

    // Verify proof contains correct data
    const proofs = await proofService.query({ entityId: 'agent-e2e' });
    expect(proofs.length).toBeGreaterThan(0);

    const proof = proofs.find((p) => p.id === readResult.proofId);
    expect(proof).toBeDefined();
    expect(proof!.entityId).toBe('agent-e2e');
  });

  it('should create multiple proofs forming a verifiable chain', async () => {
    // Quick boot camp
    const challenges = CHALLENGE_CATALOG.slice(0, 3);
    promotionService = new PromotionService(trustEngine, {
      challenges: [...challenges],
      progressiveDifficulty: false,
    });

    const agent = createSmartAgent('agent-chain');
    await promotionService.runAndEvaluate(agent);

    const trustRecord = await trustEngine.getScore('agent-chain');
    expect(trustRecord).toBeDefined();

    // Setup governance with proof bridge
    const governanceEngine = createGovernanceEngine({ enableCaching: false });
    governanceEngine.registerRule(
      createGovernanceRule(
        'allow-all',
        'policy_enforcement',
        createFieldCondition('action', 'equals', 'read'),
        createRuleEffect('allow', 'Allowed'),
        { applicableTrustLevels: [0, 1, 2, 3, 4, 5, 6, 7] }
      )
    );

    const bridge = new GovernanceProofBridge(governanceEngine, {
      createProof: (req) => proofService.create(req),
      tenantId: 'tenant-chain',
    });

    // Create 3 governance decisions → 3 proofs
    const proofIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { proofId } = await bridge.evaluateWithProof({
        requestId: `req-${i}`,
        entityId: 'agent-chain',
        trustLevel: trustRecord!.level,
        action: 'read',
        capabilities: ['data:read'],
        resources: [`resource-${i}`],
      });
      proofIds.push(proofId);
    }

    expect(proofIds).toHaveLength(3);

    // Verify all proofs are valid
    for (const id of proofIds) {
      const v = await proofService.verify(id);
      expect(v.valid).toBe(true);
    }

    // Verify chain has correct length
    const allProofs = await proofService.query({});
    expect(allProofs.length).toBeGreaterThanOrEqual(3);
  });

  it('should preserve trust context through the full pipeline', async () => {
    // Track tier change events
    const tierChanges: Array<{ previousLevel: number; newLevel: number }> = [];
    trustEngine.on('trust:tier_changed', (event) => {
      tierChanges.push({
        previousLevel: (event as any).previousLevel,
        newLevel: (event as any).newLevel,
      });
    });

    // Run full boot camp (all 21 challenges)
    promotionService = new PromotionService(trustEngine);
    const agent = createSmartAgent('agent-full');
    const result = await promotionService.runAndEvaluate(agent);

    // Verify the complete session ran
    expect(result.session.results.length).toBe(CHALLENGE_CATALOG.length);
    expect(result.signalsRecorded).toBeGreaterThanOrEqual(CHALLENGE_CATALOG.length);

    // Final trust state should reflect all signals
    const finalRecord = await trustEngine.getScore('agent-full');
    expect(finalRecord).toBeDefined();
    expect(finalRecord!.signals.length).toBeGreaterThanOrEqual(CHALLENGE_CATALOG.length);

    // Result should include final score
    expect(result.finalScore).toBeDefined();
    expect(result.finalScore).toBe(finalRecord!.score);
    expect(result.finalLevel).toBe(finalRecord!.level);
  });
});
