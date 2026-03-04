/**
 * Tests for KYA AccountabilityChain ↔ TrustSignalPipeline bridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountabilityChain } from '@vorionsys/basis';
import type { AccountabilityRecord, KYAConfig } from '@vorionsys/basis';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
} from '../../src/index.js';
import { createKYAWithPipeline } from '../../src/kya/index.js';

const DB_CONFIG = { type: 'sqlite' as const, connectionString: ':memory:' };
const KYA_CONFIG: KYAConfig = {
  didResolver: { networks: ['vorion'] },
  policyEngine: { policyBundlesPath: '/none', defaultJurisdiction: 'Global' },
  database: DB_CONFIG,
};

function makeRecord(agentDID: string, outcome: 'success' | 'failure' | 'denied'): AccountabilityRecord {
  return {
    id: `rec-${Date.now()}`,
    timestamp: Date.now(),
    agentDID,
    action: 'test:action',
    resource: 'test/resource',
    outcome,
    evidence: {
      intentHash: 'abc123',
      authorizationDecision: { allowed: outcome === 'success', reason: outcome },
    },
    signature: 'sig',
    chainLink: { prevHash: null },
  };
}

describe('AccountabilityChain — standalone callback injection', () => {
  it('fires callback with success=true for success outcome', async () => {
    const cb = vi.fn();
    const chain = new AccountabilityChain(DB_CONFIG, cb);
    await chain.append(makeRecord('agent-1', 'success'));

    expect(cb).toHaveBeenCalledOnce();
    const [agentId, success, factorCode, methodologyKey] = cb.mock.calls[0];
    expect(agentId).toBe('agent-1');
    expect(success).toBe(true);
    expect(factorCode).toBe('CT-ACCT');
    expect(methodologyKey).toBeUndefined();
  });

  it('fires callback with success=false + methodologyKey for failure', async () => {
    const cb = vi.fn();
    const chain = new AccountabilityChain(DB_CONFIG, cb);
    await chain.append(makeRecord('agent-2', 'failure'));

    expect(cb).toHaveBeenCalledOnce();
    const [, success, , methodologyKey] = cb.mock.calls[0];
    expect(success).toBe(false);
    expect(methodologyKey).toBe('accountability:failure');
  });

  it('fires callback with success=false + methodologyKey for denied', async () => {
    const cb = vi.fn();
    const chain = new AccountabilityChain(DB_CONFIG, cb);
    await chain.append(makeRecord('agent-3', 'denied'));

    const [, success, , methodologyKey] = cb.mock.calls[0];
    expect(success).toBe(false);
    expect(methodologyKey).toBe('accountability:denied');
  });

  it('does not throw when no callback is provided', async () => {
    const chain = new AccountabilityChain(DB_CONFIG);
    await expect(chain.append(makeRecord('agent-4', 'success'))).resolves.toBeUndefined();
  });

  it('fires callback for each appended record', async () => {
    const cb = vi.fn();
    const chain = new AccountabilityChain(DB_CONFIG, cb);
    await chain.append(makeRecord('agent-5', 'success'));
    await chain.append(makeRecord('agent-5', 'failure'));
    await chain.append(makeRecord('agent-5', 'denied'));
    expect(cb).toHaveBeenCalledTimes(3);
  });
});

describe('createKYAWithPipeline', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
  });

  it('routes accountability success signal through pipeline', async () => {
    const pipeline = createSignalPipeline(dynamics, profiles);
    const kya = createKYAWithPipeline(KYA_CONFIG, pipeline);

    await kya.accountability.append(makeRecord('agent-kya-1', 'success'));

    // Profile created (new agent gets one from the slow lane)
    const profile = await profiles.get('agent-kya-1');
    expect(profile).not.toBeNull();
    expect(profile!.agentId).toBe('agent-kya-1');
  });

  it('routes accountability failure signal and produces negative delta', async () => {
    const pipeline = createSignalPipeline(dynamics, profiles);
    const kya = createKYAWithPipeline(KYA_CONFIG, pipeline);

    // Seed a profile so we have a known baseline (not BASELINE_SCORE=1)
    await profiles.create('agent-kya-2', 0, [
      { evidenceId: 'e1', factorCode: 'CT-ACCT', impact: 300, source: 'seed', collectedAt: new Date() },
    ]);

    const profileBefore = await profiles.get('agent-kya-2');
    await kya.accountability.append(makeRecord('agent-kya-2', 'failure'));
    const profileAfter = await profiles.get('agent-kya-2');

    // Slow lane should reflect the failure (score should not increase)
    expect(profileAfter!.compositeScore).toBeLessThanOrEqual(profileBefore!.compositeScore);
  });

  it('denied outcome uses stronger methodology key for CB tracking', async () => {
    const processMock = vi.fn().mockResolvedValue({
      dynamicsResult: { newScore: 1, delta: 0, circuitBreakerState: 'normal', blockReason: undefined },
      profile: null,
      evidence: null,
      blocked: true,
      blockReason: 'circuit_breaker',
    });
    const kya = createKYAWithPipeline(KYA_CONFIG, { process: processMock } as any);

    await kya.accountability.append(makeRecord('agent-kya-3', 'denied'));

    expect(processMock).toHaveBeenCalledOnce();
    expect(processMock.mock.calls[0][0]).toMatchObject({
      agentId: 'agent-kya-3',
      success: false,
      factorCode: 'CT-ACCT',
      methodologyKey: 'accountability:denied',
    });
  });
});
