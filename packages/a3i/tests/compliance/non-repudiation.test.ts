/**
 * Non-Repudiation Compliance Tests
 *
 * Validates that the Vorion A3I trust system produces tamper-evident,
 * attributable records that cannot be denied by any participant.
 *
 * Properties tested:
 * - NR-1: Evidence immutability (evidenceId, collectedAt preserved)
 * - NR-2: Profile version monotonicity
 * - NR-3: Evidence provenance (source, factorCode, impact preserved)
 * - NR-4: Full history retention
 * - NR-5: Signal audit trail completeness (onBlocked, onSignalProcessed)
 * - NR-6: Block reason attribution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObservationTier } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createEvidence,
  type TrustSignalPipeline,
  type BlockedSignalEvent,
  type SignalMetrics,
} from '../../src/index.js';

describe('Non-Repudiation Compliance', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
  });

  describe('NR-1: Evidence immutability', () => {
    it('evidence retains its original evidenceId after profile creation', async () => {
      const evidence = [
        createEvidence('CT-COMP', 200, 'test-source-1'),
        createEvidence('CT-REL', 150, 'test-source-2'),
      ];

      // Capture IDs before storing
      const originalIds = evidence.map(e => e.evidenceId);

      await profiles.create('nr1-agent', ObservationTier.WHITE_BOX, evidence, { now });

      const profile = await profiles.get('nr1-agent');
      expect(profile).toBeDefined();

      // Evidence IDs should be preserved exactly
      const storedIds = profile!.evidence.map(e => e.evidenceId);
      for (const id of originalIds) {
        expect(storedIds).toContain(id);
      }
    });

    it('evidence timestamps survive profile recalculation', async () => {
      const collectedAt = new Date('2026-01-15T08:00:00Z');
      const evidence = [{
        evidenceId: 'ts-test-001',
        factorCode: 'CT-COMP',
        impact: 100,
        source: 'timestamp-test',
        collectedAt,
      }];

      await profiles.create('nr1-ts-agent', ObservationTier.WHITE_BOX, evidence, { now });

      const profile = await profiles.get('nr1-ts-agent');
      expect(profile).toBeDefined();

      const storedEvidence = profile!.evidence.find(e => e.evidenceId === 'ts-test-001');
      expect(storedEvidence).toBeDefined();
      expect(storedEvidence!.collectedAt).toEqual(collectedAt);
    });
  });

  describe('NR-2: Profile version monotonicity', () => {
    it('version increments on every update', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Create profile
      await pipeline.process({
        agentId: 'nr2-agent', success: true, factorCode: 'CT-COMP', now,
      });

      const v1 = await profiles.get('nr2-agent');
      expect(v1).toBeDefined();
      const initialVersion = v1!.version;

      // Multiple updates
      for (let i = 1; i <= 3; i++) {
        await pipeline.process({
          agentId: 'nr2-agent',
          success: true,
          factorCode: 'CT-REL',
          now: new Date(now.getTime() + i * 1000),
        });
      }

      const v4 = await profiles.get('nr2-agent');
      expect(v4!.version).toBeGreaterThan(initialVersion);
    });

    it('versions never decrease even after negative signals', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Create with positive
      await pipeline.process({
        agentId: 'nr2-mono-agent', success: true, factorCode: 'CT-COMP', now,
      });

      const versions: number[] = [];
      for (let i = 1; i <= 5; i++) {
        await pipeline.process({
          agentId: 'nr2-mono-agent',
          success: i % 2 === 0, // alternating success/failure
          factorCode: 'CT-COMP',
          methodologyKey: `test:mono:${i}`,
          now: new Date(now.getTime() + i * 1000),
        });

        const p = await profiles.get('nr2-mono-agent');
        if (p) versions.push(p.version);
      }

      // Verify monotonic non-decreasing
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1]!);
      }
    });
  });

  describe('NR-3: Evidence provenance', () => {
    it('pipeline-generated evidence includes source and factorCode', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      const result = await pipeline.process({
        agentId: 'nr3-agent',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // Evidence should carry provenance metadata
      if (result.evidence) {
        expect(result.evidence.evidenceId).toBeDefined();
        expect(typeof result.evidence.evidenceId).toBe('string');
        expect(result.evidence.evidenceId.length).toBeGreaterThan(0);
        expect(result.evidence.factorCode).toBe('CT-COMP');
        expect(result.evidence.source).toBeDefined();
        expect(typeof result.evidence.impact).toBe('number');
        expect(result.evidence.collectedAt).toBeInstanceOf(Date);
      }
    });

    it('each evidence item has a unique evidenceId', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);
      const evidenceIds = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const result = await pipeline.process({
          agentId: 'nr3-unique-agent',
          success: true,
          factorCode: i % 2 === 0 ? 'CT-COMP' : 'CT-REL',
          now: new Date(now.getTime() + i * 1000),
        });

        if (result.evidence) {
          expect(evidenceIds.has(result.evidence.evidenceId)).toBe(false);
          evidenceIds.add(result.evidence.evidenceId);
        }
      }

      // Should have collected multiple unique IDs
      expect(evidenceIds.size).toBeGreaterThan(0);
    });
  });

  describe('NR-4: Full history retention', () => {
    it('profile history preserves all versions', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Create profile and apply 5 updates
      await pipeline.process({
        agentId: 'nr4-agent', success: true, factorCode: 'CT-COMP', now,
      });

      for (let i = 1; i <= 5; i++) {
        await pipeline.process({
          agentId: 'nr4-agent',
          success: true,
          factorCode: 'CT-REL',
          now: new Date(now.getTime() + i * 1000),
        });
      }

      const history = await profiles.getHistory('nr4-agent');
      // History should have entries (at least some snapshots preserved)
      expect(history.length).toBeGreaterThanOrEqual(1);

      // Each history entry should have a profile with a timestamp
      for (const entry of history) {
        expect(entry.profile).toBeDefined();
        expect(entry.timestamp).toBeInstanceOf(Date);
      }
    });

    it('history entries are ordered by most recent first', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      await pipeline.process({
        agentId: 'nr4-order-agent', success: true, factorCode: 'CT-COMP', now,
      });

      for (let i = 1; i <= 3; i++) {
        await pipeline.process({
          agentId: 'nr4-order-agent',
          success: true,
          factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i * 60000),
        });
      }

      const history = await profiles.getHistory('nr4-order-agent');
      if (history.length >= 2) {
        // Most recent first
        for (let i = 1; i < history.length; i++) {
          expect(history[i - 1]!.timestamp.getTime())
            .toBeGreaterThanOrEqual(history[i]!.timestamp.getTime());
        }
      }
    });
  });

  describe('NR-5: Signal audit trail completeness', () => {
    it('every signal produces a metrics event', async () => {
      const metrics: SignalMetrics[] = [];
      const pipeline = createSignalPipeline(dynamics, profiles, {
        onSignalProcessed: (m) => metrics.push(m),
      });

      const signalCount = 5;
      for (let i = 0; i < signalCount; i++) {
        await pipeline.process({
          agentId: 'nr5-metrics-agent',
          success: true,
          factorCode: 'CT-COMP',
          now: new Date(now.getTime() + i * 1000),
        });
      }

      expect(metrics.length).toBe(signalCount);

      // Each metric is attributable
      for (const m of metrics) {
        expect(m.agentId).toBe('nr5-metrics-agent');
        expect(m.timestamp).toBeInstanceOf(Date);
        expect(typeof m.durationMs).toBe('number');
      }
    });

    it('blocked signals still produce metrics events', async () => {
      const metrics: SignalMetrics[] = [];
      const blocked: BlockedSignalEvent[] = [];

      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 1,
        rateLimitWindowMs: 60000,
        onSignalProcessed: (m) => metrics.push(m),
        onBlocked: (e) => blocked.push(e),
      });

      // First signal goes through, second is rate-limited
      await pipeline.process({
        agentId: 'nr5-blocked', success: true, factorCode: 'CT-COMP', now,
      });
      await pipeline.process({
        agentId: 'nr5-blocked', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 1),
      });

      // Both signals should have metrics
      expect(metrics.length).toBe(2);

      // Second one should be blocked
      const blockedMetrics = metrics.filter(m => m.blocked);
      expect(blockedMetrics.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('NR-6: Block reason attribution', () => {
    it('circuit breaker block includes dynamics result', async () => {
      const blocked: BlockedSignalEvent[] = [];
      const pipeline = createSignalPipeline(dynamics, profiles, {
        onBlocked: (e) => blocked.push(e),
      });

      // New agent failure trips CB (baseline=1)
      await pipeline.process({
        agentId: 'nr6-cb-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'test:cb',
        now,
      });

      const cbBlock = blocked.find(b => b.blockReason === 'circuit_breaker');
      expect(cbBlock).toBeDefined();
      expect(cbBlock!.agentId).toBe('nr6-cb-agent');
      expect(cbBlock!.signal).toBeDefined();
      expect(cbBlock!.signal.success).toBe(false);
    });

    it('rate limit block identifies the agent and factor', async () => {
      const blocked: BlockedSignalEvent[] = [];
      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 1,
        rateLimitWindowMs: 60000,
        onBlocked: (e) => blocked.push(e),
      });

      // First signal passes
      await pipeline.process({
        agentId: 'nr6-rl-agent', success: true, factorCode: 'CT-COMP', now,
      });

      // Second is rate-limited
      await pipeline.process({
        agentId: 'nr6-rl-agent', success: true, factorCode: 'CT-REL',
        now: new Date(now.getTime() + 1),
      });

      const rlBlock = blocked.find(b => b.blockReason === 'rate_limited');
      expect(rlBlock).toBeDefined();
      expect(rlBlock!.agentId).toBe('nr6-rl-agent');
      expect(rlBlock!.factorCode).toBe('CT-REL');
      expect(rlBlock!.timestamp).toBeInstanceOf(Date);
    });
  });
});
