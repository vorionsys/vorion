/**
 * Launch Smoke Test: CARID Identity Context → ATSF Trust → Cognigate Governance
 *
 * A5 requirement: validate the Wave 1 integration path from a CARID-style agent
 * identity context through ATSF trust scoring into Cognigate governance decisions,
 * with full audit trail integrity verified at the end.
 *
 * Executes entirely in-process (no network calls) for CI reliability.
 * "CARID identity context" uses Phase 6 ContextType — the same types CAR Mission
 * Control uses when registering production agent identity.
 *
 * Integration path:
 *   1. CARID identity context  — Phase6 ContextType.ENTERPRISE marks agent scope
 *   2. ATSF trust engine       — signals recorded, score computed
 *   3. BASIS evaluator         — rule-governed trust assertion
 *   4. Cognigate enforcement   — GovernanceEngine + GovernanceProofBridge
 *   5. Proof chain integrity   — every decision leaves a verifiable trace
 *
 * Also validates (A4):
 *   - ACI_CANONICAL_PRESETS === BASIS_CANONICAL_PRESETS (alias parity)
 *   - Preset weights sum to 1.0
 */

import { describe, it, expect } from 'vitest';
import { createTrustEngine } from '../src/trust-engine/index.js';
import {
  createGovernanceEngine,
  createGovernanceRule,
  createFieldCondition,
  createRuleEffect,
} from '../src/governance/index.js';
import { GovernanceProofBridge } from '../src/governance/proof-bridge.js';
import { createProofService } from '../src/proof/index.js';
import { createMemoryProvider } from '../src/persistence/index.js';
import {
  ContextType,
  CONTEXT_CEILINGS,
  BASIS_CANONICAL_PRESETS,
  ACI_CANONICAL_PRESETS,
} from '../src/phase6/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const AGENT_ID = 'smoke-agent-w1';
const TENANT_ID = 'smoke-tenant-w1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGovernanceEngine() {
  const engine = createGovernanceEngine({ enableCaching: false });

  engine.registerRule(
    createGovernanceRule(
      'allow-t2-compliance-read',
      'policy_enforcement',
      createFieldCondition('action', 'equals', 'compliance:read'),
      createRuleEffect('allow', 'T2+ agents may read compliance data'),
      { applicableTrustLevels: [2, 3, 4, 5, 6, 7] }
    )
  );

  engine.registerRule(
    createGovernanceRule(
      'deny-t0-t1-write',
      'security_critical',
      createFieldCondition('action', 'equals', 'compliance:write'),
      createRuleEffect('deny', 'Insufficient trust tier for write operations'),
      { applicableTrustLevels: [0, 1] }
    )
  );

  return engine;
}

// =============================================================================
// Tests
// =============================================================================

describe('Launch Smoke: CARID → ATSF → Cognigate', () => {
  // ---------------------------------------------------------------------------
  // A5-SMOKE-1: Full Wave 1 integration path
  // ---------------------------------------------------------------------------
  it('routes CARID identity context through ATSF trust into Cognigate governance with auditable proof', async () => {
    // -----------------------------------------------------------------------
    // Step 1: CARID identity context
    // Phase6 ContextType mirrors the context types CAR Mission Control uses
    // when registering production-scoped agents. ENTERPRISE = ceiling 900.
    // -----------------------------------------------------------------------
    const contextType = ContextType.ENTERPRISE;
    expect(contextType).toBe('enterprise');
    expect(CONTEXT_CEILINGS[contextType]).toBe(900);

    // -----------------------------------------------------------------------
    // Step 2: ATSF trust engine — record behavioral signals
    // Use in-memory persistence to exercise the autoPersist hot path.
    // -----------------------------------------------------------------------
    const persistence = createMemoryProvider();
    await persistence.initialize();

    const engine = createTrustEngine({ persistence, autoPersist: true });
    await engine.initializeEntity(AGENT_ID, 2); // T2 Provisional

    const signals = [
      { type: 'behavioral.task_completed', value: 0.92 },
      { type: 'behavioral.task_completed', value: 0.88 },
      { type: 'compliance.policy_check', value: 0.95 },
    ] as const;

    for (const sig of signals) {
      await engine.recordSignal({
        id: crypto.randomUUID(),
        entityId: AGENT_ID,
        type: sig.type as string,
        value: sig.value,
        source: 'smoke-test',
        timestamp: new Date().toISOString(),
        metadata: { tenant: TENANT_ID, contextType },
      });
    }

    const trustRecord = await engine.getScore(AGENT_ID);
    expect(trustRecord).toBeDefined();
    expect(trustRecord!.score).toBeGreaterThanOrEqual(0);
    expect(trustRecord!.score).toBeLessThanOrEqual(1000);
    expect(typeof trustRecord!.level).toBe('number');

    // T2 Provisional with positive signals — score must stay in T2+ range (350+)
    expect(trustRecord!.score).toBeGreaterThanOrEqual(350);

    // -----------------------------------------------------------------------
    // Step 3: BASIS evaluator — assert trust dimension via rule evaluation
    // Uses a lightweight namespace registered at eval time (no server needed).
    // -----------------------------------------------------------------------
    const { createEvaluator } = await import('../src/basis/evaluator.js');
    const { parseNamespace } = await import('../src/basis/parser.js');

    const evaluator = createEvaluator();
    evaluator.registerNamespace(
      parseNamespace({
        namespace: 'smoke.trust.policy',
        version: '1.0.0',
        rules: [
          {
            id: 'smoke-rule-001',
            name: 'require-provisional-or-above',
            priority: 1,
            when: {
              intentType: 'compliance:read',
              conditions: [
                {
                  field: 'entity.trustLevel',
                  operator: 'greater_than_or_equal',
                  value: 2,
                },
              ],
            },
            evaluate: [
              {
                condition: 'entity.trustLevel >= 2',
                result: 'allow',
                reason: 'T2+ cleared for production data access',
              },
            ],
          },
        ],
      })
    );

    const basisResult = await evaluator.evaluate({
      intent: {
        id: crypto.randomUUID(),
        type: 'compliance:read',
        goal: 'Read audit log',
        context: { agentId: AGENT_ID, contextType },
      },
      entity: {
        id: AGENT_ID,
        type: 'agent',
        trustScore: trustRecord!.score,
        trustLevel: trustRecord!.level,
        attributes: { tenant: TENANT_ID },
      },
      environment: {
        timestamp: new Date().toISOString(),
        timezone: 'UTC',
        requestId: crypto.randomUUID(),
      },
      custom: {},
    });

    expect(basisResult).toBeDefined();
    // T2 agent with T2+ requirement — finalAction should be allow; passed = true
    expect(basisResult.passed).toBe(true);
    expect(basisResult.finalAction).toBe('allow');

    // -----------------------------------------------------------------------
    // Step 4: Cognigate enforcement path — GovernanceEngine + ProofBridge
    // Measures the governance + proof creation RTT (co-located hot path).
    // Per DEPLOYMENT.md: co-located p50 ~8ms; CI budget is generous at 500ms.
    // -----------------------------------------------------------------------
    const proofService = createProofService();
    const governanceEngine = makeGovernanceEngine();

    const bridge = new GovernanceProofBridge(governanceEngine, {
      createProof: (req) => proofService.create(req),
      tenantId: TENANT_ID,
    });

    const rttStart = performance.now();
    const enforceResult = await bridge.evaluateWithProof({
      requestId: `smoke-req-${Date.now()}`,
      entityId: AGENT_ID,
      trustLevel: trustRecord!.level,
      action: 'compliance:read',
      capabilities: ['compliance:read'],
      resources: ['audit-log'],
    });
    const rttMs = performance.now() - rttStart;

    // T2+ agent on compliance:read → allow
    expect(enforceResult.result.decision).toBe('allow');
    expect(typeof enforceResult.proofId).toBe('string');

    // RTT assertion — co-located budget (see apps/cognigate-api/DEPLOYMENT.md)
    expect(rttMs).toBeLessThan(500); // CI-safe bound; local p50 should be <8ms

    // -----------------------------------------------------------------------
    // Step 5: Proof chain integrity — every decision is immutably auditable
    // -----------------------------------------------------------------------
    const verification = await proofService.verify(enforceResult.proofId);
    expect(verification.valid).toBe(true);
    expect(verification.issues).toHaveLength(0);

    const agentProofs = await proofService.query({ entityId: AGENT_ID });
    expect(agentProofs.length).toBeGreaterThanOrEqual(1);

    const smokeProof = agentProofs.find((p) => p.id === enforceResult.proofId);
    expect(smokeProof).toBeDefined();
    expect(smokeProof!.entityId).toBe(AGENT_ID);

    await engine.close();
  });

  // ---------------------------------------------------------------------------
  // A5-SMOKE-2: Trust decision auditability
  // Every governance decision must produce a unique, independently verifiable proof.
  // ---------------------------------------------------------------------------
  it('produces an immutable verifiable proof for each governance decision', async () => {
    const proofService = createProofService();
    const governanceEngine = makeGovernanceEngine();
    const engine = createTrustEngine();

    governanceEngine.registerRule(
      createGovernanceRule(
        'allow-all-reads',
        'policy_enforcement',
        createFieldCondition('action', 'equals', 'read'),
        createRuleEffect('allow', 'Read operations permitted'),
        { applicableTrustLevels: [0, 1, 2, 3, 4, 5, 6, 7] }
      )
    );

    const bridge = new GovernanceProofBridge(governanceEngine, {
      createProof: (req) => proofService.create(req),
      tenantId: TENANT_ID,
    });

    await engine.initializeEntity('smoke-audit-agent', 1);
    const trustRecord = await engine.getScore('smoke-audit-agent');
    expect(trustRecord).toBeDefined();

    // Issue 3 sequential governance decisions
    const proofIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await bridge.evaluateWithProof({
        requestId: `audit-req-${i}`,
        entityId: 'smoke-audit-agent',
        trustLevel: trustRecord!.level,
        action: 'read',
        capabilities: ['data:read'],
        resources: [`resource-${i}`],
      });
      proofIds.push(result.proofId);
    }

    // Each proof verifies independently
    for (const proofId of proofIds) {
      const v = await proofService.verify(proofId);
      expect(v.valid).toBe(true);
      expect(v.issues).toHaveLength(0);
    }

    // Proofs are distinct (no collision, no deduplication)
    expect(new Set(proofIds).size).toBe(3);

    // Full audit log is queryable
    const allProofs = await proofService.query({});
    expect(allProofs.length).toBeGreaterThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // A4-DEPRECATION: Alias parity + preset weight integrity
  // ACI_CANONICAL_PRESETS is a deprecated alias for BASIS_CANONICAL_PRESETS.
  // ---------------------------------------------------------------------------
  it('ACI_CANONICAL_PRESETS is the same object as BASIS_CANONICAL_PRESETS (alias parity)', () => {
    // Referential equality — same object, not just deep-equal
    expect(ACI_CANONICAL_PRESETS).toBe(BASIS_CANONICAL_PRESETS);

    // Standard preset set is non-empty
    const presetKeys = Object.keys(BASIS_CANONICAL_PRESETS);
    expect(presetKeys.length).toBeGreaterThan(0);
    expect(presetKeys).toContain('basis:preset:balanced');
    expect(presetKeys).toContain('basis:preset:conservative');

    // Balanced preset — all weights equal and sum to 1.0
    const balanced = BASIS_CANONICAL_PRESETS['basis:preset:balanced'];
    expect(balanced).toBeDefined();
    expect(balanced.source).toBe('basis');
    const w = balanced.weights;
    const sum = w.observability + w.capability + w.behavior + w.governance + w.context;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);

    // Conservative preset — governance weight > balanced
    const conservative = BASIS_CANONICAL_PRESETS['basis:preset:conservative'];
    expect(conservative).toBeDefined();
    expect(conservative.weights.governance).toBeGreaterThan(balanced.weights.governance);
  });

  // ---------------------------------------------------------------------------
  // A5-SMOKE-3: Deny path — T0/T1 agents blocked from write operations
  // ---------------------------------------------------------------------------
  it('blocks T0/T1 agents from write operations via governance+proof path', async () => {
    const proofService = createProofService();
    const governanceEngine = makeGovernanceEngine();
    const engine = createTrustEngine();

    const bridge = new GovernanceProofBridge(governanceEngine, {
      createProof: (req) => proofService.create(req),
      tenantId: TENANT_ID,
    });

    // T0 Sandbox agent
    await engine.initializeEntity('smoke-t0-agent', 0);
    const t0Record = await engine.getScore('smoke-t0-agent');
    expect(t0Record!.level).toBe(0);

    const denyResult = await bridge.evaluateWithProof({
      requestId: `deny-req-${Date.now()}`,
      entityId: 'smoke-t0-agent',
      trustLevel: 0,
      action: 'compliance:write',
      capabilities: ['compliance:write'],
      resources: ['audit-log'],
    });

    // T0 agent attempting write — policy should deny
    expect(denyResult.result.decision).toBe('deny');
    expect(typeof denyResult.proofId).toBe('string');

    // Even denied decisions are auditable
    const denyVerification = await proofService.verify(denyResult.proofId);
    expect(denyVerification.valid).toBe(true);
  });
});
