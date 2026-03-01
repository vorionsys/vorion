/**
 * Integration Test: Intent-to-Proof Pipeline
 *
 * Exercises the complete flow from intent submission through governance
 * enforcement to proof record creation, using real implementations
 * with in-memory stores (no mocks).
 *
 * Flow: Intent -> TrustFacade (Gate + Authorization) -> Execution -> ProofCommitter -> Verify
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IntentPipeline,
  createIntentPipeline,
} from '../../src/intent-pipeline/index.js';
import {
  TrustFacade,
  createTrustFacade,
  type AgentCredentials,
  type Action,
} from '../../src/trust-facade/index.js';
import {
  ProofCommitter,
  createProofCommitter,
  InMemoryProofStore,
} from '../../src/proof-committer/index.js';

describe('Intent-to-Proof Pipeline Integration', () => {
  let pipeline: IntentPipeline;
  let trustFacade: TrustFacade;
  let proofCommitter: ProofCommitter;
  let proofStore: InMemoryProofStore;

  // -- Fixtures ---------------------------------------------------------------

  /** A well-behaved GRAY_BOX agent with broad read/write capabilities */
  const trustedAgent: AgentCredentials = {
    agentId: 'integration-agent-trusted',
    name: 'Trusted Integration Agent',
    capabilities: ['read:*', 'write:*'],
    observationTier: 'GRAY_BOX',
  };

  /** A WHITE_BOX agent with restricted capabilities (no write or delete) */
  const restrictedAgent: AgentCredentials = {
    agentId: 'integration-agent-restricted',
    name: 'Restricted Integration Agent',
    capabilities: ['read:data'],
    observationTier: 'WHITE_BOX',
  };

  /** A low-privilege BLACK_BOX agent */
  const blackBoxAgent: AgentCredentials = {
    agentId: 'integration-agent-blackbox',
    name: 'Black Box Agent',
    capabilities: ['read:*', 'write:*'],
    observationTier: 'BLACK_BOX',
  };

  const readAction: Action = {
    type: 'read',
    resource: 'data/documents',
  };

  const writeAction: Action = {
    type: 'write',
    resource: 'reports/summary',
  };

  const deleteAction: Action = {
    type: 'delete',
    resource: 'data/users',
  };

  // -- Setup / Teardown -------------------------------------------------------

  beforeEach(() => {
    proofStore = new InMemoryProofStore();
    trustFacade = createTrustFacade();
    proofCommitter = createProofCommitter(
      { maxBufferSize: 200, flushIntervalMs: 60_000 }, // long interval; we flush manually
      proofStore,
    );
    pipeline = createIntentPipeline(trustFacade, proofCommitter, {
      verboseLogging: false,
      autoRecordSignals: true,
    });
  });

  afterEach(async () => {
    await pipeline.stop();
  });

  // ---------------------------------------------------------------------------
  // Happy Path: Full lifecycle
  // ---------------------------------------------------------------------------

  describe('full lifecycle: submit -> evaluate -> commit proof -> verify', () => {
    it('should allow a read intent for a trusted agent and produce proof records', async () => {
      // 1. Submit intent
      const result = await pipeline.submit(trustedAgent, readAction);

      // 2. Verify the pipeline returned an allowed result
      expect(result.allowed).toBe(true);
      expect(result.intentId).toBeDefined();
      expect(result.commitmentId).toBeDefined();
      expect(['GREEN', 'YELLOW']).toContain(result.tier);
      expect(result.processingTimeMs).toBeGreaterThan(0);

      // 3. Flush proof buffer to the store
      await pipeline.flushProofs();

      // 4. Verify proof records were persisted
      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      expect(commitments.length).toBeGreaterThanOrEqual(2);

      const eventTypes = commitments.map((c) => c.event.type);
      expect(eventTypes).toContain('intent_submitted');
      expect(eventTypes).toContain('decision_made');

      // 5. Verify the submission commitment exists and can be retrieved
      const submitCommitment = await proofCommitter.getCommitment(result.commitmentId);
      expect(submitCommitment).not.toBeNull();
      expect(submitCommitment!.event.type).toBe('intent_submitted');
      expect(submitCommitment!.event.entityId).toBe(trustedAgent.agentId);

      // 6. Verify the commitment hash integrity
      const isValid = proofCommitter.verifyCommitment(submitCommitment!);
      expect(isValid).toBe(true);

      // 7. Verify decision_made proof records the correct outcome
      const decisionCommitment = commitments.find((c) => c.event.type === 'decision_made');
      expect(decisionCommitment).toBeDefined();
      expect(decisionCommitment!.event.payload.allowed).toBe(true);
    });

    it('should maintain correlation IDs across all proof events for a single intent', async () => {
      await pipeline.submit(trustedAgent, readAction);
      await pipeline.flushProofs();

      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      expect(commitments.length).toBeGreaterThanOrEqual(2);

      // All commitments for this intent should share the same correlation ID
      const correlationIds = new Set(
        commitments.map((c) => c.event.correlationId).filter(Boolean),
      );
      expect(correlationIds.size).toBe(1);
    });

    it('should record execution handler events in the proof trail', async () => {
      let executionPayload: unknown = null;

      pipeline.registerHandler('read', async (intent, _context) => {
        executionPayload = { documentId: 'doc-42' };
        return { success: true, result: executionPayload };
      });

      const result = await pipeline.submit(trustedAgent, readAction);
      await pipeline.flushProofs();

      expect(result.allowed).toBe(true);

      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      const eventTypes = commitments.map((c) => c.event.type);

      // With an execution handler, we expect:
      // intent_submitted, decision_made, execution_started, execution_completed
      expect(eventTypes).toContain('intent_submitted');
      expect(eventTypes).toContain('decision_made');
      expect(eventTypes).toContain('execution_started');
      expect(eventTypes).toContain('execution_completed');

      // Verify execution completed with success
      const execCompleted = commitments.find((c) => c.event.type === 'execution_completed');
      expect(execCompleted!.event.payload.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Trust Score Updates
  // ---------------------------------------------------------------------------

  describe('trust score updates through the pipeline', () => {
    it('should update trust score after successful execution (autoRecordSignals)', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: true, result: { ok: true } };
      });

      // Get initial score (will be set after first admit via submit)
      const result = await pipeline.submit(trustedAgent, readAction);
      expect(result.allowed).toBe(true);

      const scoreAfterSuccess = await trustFacade.getScore(trustedAgent.agentId);
      expect(scoreAfterSuccess).not.toBeNull();

      // GRAY_BOX initial score is 200; after one successful execution with
      // autoRecordSignals the score should have increased
      expect(scoreAfterSuccess!).toBeGreaterThan(200);
    });

    it('should penalize trust score after failed execution', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: false, error: 'Simulated failure' };
      });

      await pipeline.submit(trustedAgent, readAction);

      const scoreAfterFailure = await trustFacade.getScore(trustedAgent.agentId);
      expect(scoreAfterFailure).not.toBeNull();

      // GRAY_BOX initial score is 200; failure signal decreases score
      expect(scoreAfterFailure!).toBeLessThan(200);
    });

    it('should apply asymmetric penalties (loss >> gain)', async () => {
      // First submit: successful execution to capture score gain
      pipeline.registerHandler('read', async () => {
        return { success: true, result: {} };
      });

      await pipeline.submit(trustedAgent, readAction);
      const scoreAfterSuccess = await trustFacade.getScore(trustedAgent.agentId);

      // Reset handler to fail
      pipeline.registerHandler('read', async () => {
        return { success: false, error: 'Failure' };
      });

      await pipeline.submit(trustedAgent, readAction);
      const scoreAfterFailure = await trustFacade.getScore(trustedAgent.agentId);

      const gain = scoreAfterSuccess! - 200; // 200 is GRAY_BOX initial
      const loss = scoreAfterSuccess! - scoreAfterFailure!;

      // Loss from a single failure should far exceed gain from a single success
      expect(loss).toBeGreaterThan(gain * 3);
    });
  });

  // ---------------------------------------------------------------------------
  // Governance: Denied Intents
  // ---------------------------------------------------------------------------

  describe('denied intents produce deny proofs', () => {
    it('should deny a high-risk action for a low-tier agent and record denial proof', async () => {
      // 'delete' is high-risk, requires T4+; GRAY_BOX starts at T1 (score 200)
      // restricted agent has no 'delete' capability at all
      const result = await pipeline.submit(restrictedAgent, deleteAction);

      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('RED');
      expect(result.reason).toBeDefined();
      expect(result.commitmentId).toBeDefined();

      await pipeline.flushProofs();

      const commitments = await proofStore.getCommitmentsForEntity(restrictedAgent.agentId);
      const eventTypes = commitments.map((c) => c.event.type);

      expect(eventTypes).toContain('intent_submitted');
      expect(eventTypes).toContain('decision_made');

      // Verify the decision_made event records denial
      const decisionCommitment = commitments.find((c) => c.event.type === 'decision_made');
      expect(decisionCommitment).toBeDefined();
      expect(decisionCommitment!.event.payload.allowed).toBe(false);
    });

    it('should deny a write action for an agent without write capability', async () => {
      // restrictedAgent only has 'read:data' capability
      const result = await pipeline.submit(restrictedAgent, writeAction);

      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('RED');
      expect(result.reason).toContain('capability');
    });

    it('should deny a revoked agent and produce revocation denial proof', async () => {
      // First, submit successfully so the agent is admitted
      const firstResult = await pipeline.submit(trustedAgent, readAction);
      expect(firstResult.allowed).toBe(true);

      // Revoke the agent
      await trustFacade.revoke(trustedAgent.agentId, 'Policy violation detected');

      // Attempt to submit again
      const secondResult = await pipeline.submit(trustedAgent, readAction);

      expect(secondResult.allowed).toBe(false);
      expect(secondResult.reason).toContain('revoked');

      await pipeline.flushProofs();

      // Verify proof trail includes both the allowed and denied events
      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      const decisions = commitments.filter((c) => c.event.type === 'decision_made');

      // Should have at least 2 decisions: one allowed and one denied
      expect(decisions.length).toBeGreaterThanOrEqual(2);

      const allowedDecisions = decisions.filter((d) => d.event.payload.allowed === true);
      const deniedDecisions = decisions.filter((d) => d.event.payload.allowed === false);

      expect(allowedDecisions.length).toBeGreaterThanOrEqual(1);
      expect(deniedDecisions.length).toBeGreaterThanOrEqual(1);
    });

    it('should deny a high-risk delete action even when agent has delete capability but low trust', async () => {
      // Agent with delete capability but BLACK_BOX (low trust, starts at T0, score 100)
      const lowTrustAgentWithDeleteCap: AgentCredentials = {
        agentId: 'integration-agent-low-trust-delete',
        name: 'Low Trust With Delete',
        capabilities: ['delete:*'],
        observationTier: 'BLACK_BOX',
      };

      const result = await pipeline.submit(lowTrustAgentWithDeleteCap, deleteAction);

      // delete is high-risk, requires T4+; BLACK_BOX starts at T0
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('RED');
      expect(result.reason).toContain('High-risk');
    });
  });

  // ---------------------------------------------------------------------------
  // Execution Handler Failures
  // ---------------------------------------------------------------------------

  describe('execution handler failure paths', () => {
    it('should record execution failure in proof trail when handler fails', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: false, error: 'Database connection timeout' };
      });

      const result = await pipeline.submit(trustedAgent, readAction);

      // Intent was *allowed* (passed trust check) but execution *failed*
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Execution failed');
      expect(result.reason).toContain('Database connection timeout');

      await pipeline.flushProofs();

      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      const eventTypes = commitments.map((c) => c.event.type);

      expect(eventTypes).toContain('execution_started');
      expect(eventTypes).toContain('execution_completed');

      const execCompleted = commitments.find((c) => c.event.type === 'execution_completed');
      expect(execCompleted!.event.payload.success).toBe(false);
      expect(execCompleted!.event.payload.error).toBe('Database connection timeout');
    });

    it('should handle a throwing execution handler gracefully', async () => {
      pipeline.registerHandler('read', async () => {
        throw new Error('Unexpected runtime exception');
      });

      const result = await pipeline.submit(trustedAgent, readAction);

      // The pipeline catches exceptions and returns a controlled error
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('RED');
      expect(result.reason).toContain('Processing error');
      expect(result.reason).toContain('Unexpected runtime exception');
    });
  });

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  describe('pipeline metrics across the full lifecycle', () => {
    it('should accurately track allowed and denied intents', async () => {
      // Submit a successful intent
      await pipeline.submit(trustedAgent, readAction);

      // Submit a denied intent (missing capability)
      await pipeline.submit(restrictedAgent, writeAction);

      // Submit another allowed intent
      await pipeline.submit(trustedAgent, readAction);

      const metrics = pipeline.getMetrics();

      expect(metrics.totalIntents).toBe(3);
      expect(metrics.allowedIntents).toBe(2);
      expect(metrics.deniedIntents).toBe(1);
      expect(metrics.allowRate).toBeCloseTo(2 / 3, 2);
      expect(metrics.avgProcessingTimeMs).toBeGreaterThan(0);
    });

    it('should count execution failures as denied in metrics', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: false, error: 'fail' };
      });

      await pipeline.submit(trustedAgent, readAction);

      const metrics = pipeline.getMetrics();
      expect(metrics.deniedIntents).toBe(1);
      expect(metrics.allowedIntents).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Proof Store Integrity
  // ---------------------------------------------------------------------------

  describe('proof store integrity', () => {
    it('should create verifiable hashes for all proof commitments', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: true, result: {} };
      });

      await pipeline.submit(trustedAgent, readAction);
      await pipeline.flushProofs();

      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      expect(commitments.length).toBeGreaterThanOrEqual(4); // submitted, decision, exec_start, exec_completed

      // Verify hash integrity of every commitment
      for (const commitment of commitments) {
        const isValid = proofCommitter.verifyCommitment(commitment);
        expect(isValid).toBe(true);
      }
    });

    it('should detect tampered proof records', async () => {
      await pipeline.submit(trustedAgent, readAction);
      await pipeline.flushProofs();

      const commitments = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      expect(commitments.length).toBeGreaterThan(0);

      // Tamper with the first commitment's payload
      const tampered = {
        ...commitments[0],
        event: {
          ...commitments[0].event,
          payload: { ...commitments[0].event.payload, tampered: true },
        },
      };

      const isValid = proofCommitter.verifyCommitment(tampered);
      expect(isValid).toBe(false);
    });

    it('should persist proofs to the store after flush with correct batch structure', async () => {
      await pipeline.submit(trustedAgent, readAction);
      await pipeline.submit(trustedAgent, readAction);
      await pipeline.flushProofs();

      const stats = proofStore.getStats();
      expect(stats.batches).toBeGreaterThanOrEqual(1);
      // 2 intents x at least 2 events each = at least 4 commitments
      expect(stats.commitments).toBeGreaterThanOrEqual(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-Agent Scenarios
  // ---------------------------------------------------------------------------

  describe('multi-agent concurrent intent processing', () => {
    it('should process intents from multiple agents independently', async () => {
      const [result1, result2, result3] = await Promise.all([
        pipeline.submit(trustedAgent, readAction),
        pipeline.submit(restrictedAgent, readAction),
        pipeline.submit(blackBoxAgent, readAction),
      ]);

      // All agents should be allowed for a read action with read capabilities
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);

      await pipeline.flushProofs();

      // Each agent should have its own proof records
      const trusted = await proofStore.getCommitmentsForEntity(trustedAgent.agentId);
      const restricted = await proofStore.getCommitmentsForEntity(restrictedAgent.agentId);
      const blackBox = await proofStore.getCommitmentsForEntity(blackBoxAgent.agentId);

      expect(trusted.length).toBeGreaterThanOrEqual(2);
      expect(restricted.length).toBeGreaterThanOrEqual(2);
      expect(blackBox.length).toBeGreaterThanOrEqual(2);

      // Verify each agent's proofs use distinct correlation IDs
      const trustedCorrs = new Set(trusted.map((c) => c.event.correlationId));
      const restrictedCorrs = new Set(restricted.map((c) => c.event.correlationId));

      // Each agent's intent gets its own correlation ID
      expect(trustedCorrs.size).toBe(1);
      expect(restrictedCorrs.size).toBe(1);

      // Different agents should have different correlation IDs
      const allCorrs = new Set([...trustedCorrs, ...restrictedCorrs]);
      expect(allCorrs.size).toBe(2);
    });

    it('should isolate trust scores between agents', async () => {
      pipeline.registerHandler('read', async () => {
        return { success: false, error: 'Simulated failure' };
      });

      // Only the trusted agent triggers the failure handler
      await pipeline.submit(trustedAgent, readAction);

      // Remove failure handler so restricted agent succeeds (no handler = no exec)
      pipeline.registerHandler('read', async () => {
        return { success: true, result: {} };
      });

      await pipeline.submit(restrictedAgent, readAction);

      const trustedScore = await trustFacade.getScore(trustedAgent.agentId);
      const restrictedScore = await trustFacade.getScore(restrictedAgent.agentId);

      // Trusted agent had a failure, so score dropped below initial (200 for GRAY_BOX)
      expect(trustedScore!).toBeLessThan(200);

      // Restricted agent had success, so score increased above initial (300 for WHITE_BOX)
      expect(restrictedScore!).toBeGreaterThan(300);
    });
  });

  // ---------------------------------------------------------------------------
  // Quick Check (dry-run authorization without execution or proof)
  // ---------------------------------------------------------------------------

  describe('quick check (dry-run)', () => {
    it('should not create any proof records for a check-only call', async () => {
      const initialStats = proofStore.getStats();

      const result = await pipeline.check(trustedAgent, readAction);

      await pipeline.flushProofs();

      expect(result.allowed).toBe(true);
      expect(result.tier).toBeDefined();

      const afterStats = proofStore.getStats();
      expect(afterStats.commitments).toBe(initialStats.commitments);
    });

    it('should reflect denial for check when agent lacks capability', async () => {
      const result = await pipeline.check(restrictedAgent, deleteAction);

      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('RED');
      expect(result.reason).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Observation Tier Ceilings
  // ---------------------------------------------------------------------------

  describe('observation tier governance', () => {
    it('should assign different initial trust based on observation tier', async () => {
      await pipeline.submit(trustedAgent, readAction);     // GRAY_BOX -> 200
      await pipeline.submit(blackBoxAgent, readAction);    // BLACK_BOX -> 100
      await pipeline.submit(restrictedAgent, readAction);  // WHITE_BOX -> 300

      const grayScore = await trustFacade.getScore(trustedAgent.agentId);
      const blackScore = await trustFacade.getScore(blackBoxAgent.agentId);
      const whiteScore = await trustFacade.getScore(restrictedAgent.agentId);

      expect(blackScore!).toBeLessThanOrEqual(grayScore!);
      expect(grayScore!).toBeLessThanOrEqual(whiteScore!);
    });
  });
});
