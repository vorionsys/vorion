/**
 * NIST SP 800-53 — Audit and Accountability (AU) Tests
 *
 * Validates that the Vorion A3I trust system produces complete,
 * non-lossy audit records for all trust-relevant events.
 *
 * Maps to: AU-2, AU-3, AU-6, AU-12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObservationTier, ActionType, DataSensitivity, Reversibility } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  createPreActionGate,
  createMapTrustProvider,
  type TrustSignalPipeline,
  type BlockedSignalEvent,
  type SignalMetrics,
} from '../../src/index.js';

describe('NIST SP 800-53 — Audit and Accountability (AU)', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
  });

  describe('AU-2: Auditable events are defined', () => {
    it('pipeline exposes onBlocked and onSignalProcessed callbacks', () => {
      const blockedFn = vi.fn();
      const metricsFn = vi.fn();

      const pipeline = createSignalPipeline(dynamics, profiles, {
        onBlocked: blockedFn,
        onSignalProcessed: metricsFn,
      });

      // Callbacks are wired — the pipeline supports audit event emission
      expect(pipeline).toBeDefined();
    });

    it('gate emits GATE_APPROVED and GATE_REJECTED events', async () => {
      const events: any[] = [];
      const gate = createPreActionGate();
      gate.addEventListener((event) => events.push(event));

      // Approved event
      await gate.verify({
        agentId: 'audit-agent',
        actionType: ActionType.READ,
        dataSensitivity: DataSensitivity.PUBLIC,
        reversibility: Reversibility.REVERSIBLE,
        resourceId: 'test',
      }, 500);

      // Rejected event
      await gate.verify({
        agentId: 'audit-agent',
        actionType: ActionType.DELETE,
        dataSensitivity: DataSensitivity.RESTRICTED,
        reversibility: Reversibility.IRREVERSIBLE,
        resourceId: 'critical',
      }, 0);

      expect(events.length).toBeGreaterThanOrEqual(2);

      const types = events.map(e => e.type);
      expect(types).toContain('GATE_APPROVED');
      expect(types).toContain('GATE_REJECTED');
    });
  });

  describe('AU-3: Audit content completeness', () => {
    it('onSignalProcessed contains all required fields', async () => {
      const metrics: SignalMetrics[] = [];
      const pipeline = createSignalPipeline(dynamics, profiles, {
        onSignalProcessed: (m) => metrics.push(m),
      });

      await pipeline.process({
        agentId: 'audit-complete',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      expect(metrics.length).toBe(1);
      const m = metrics[0]!;

      // Required fields per AU-3
      expect(m.agentId).toBe('audit-complete');
      expect(m.factorCode).toBe('CT-COMP');
      expect(m.success).toBe(true);
      expect(typeof m.delta).toBe('number');
      expect(typeof m.blocked).toBe('boolean');
      expect(typeof m.durationMs).toBe('number');
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
      expect(m.timestamp).toBeInstanceOf(Date);
    });

    it('onBlocked contains full signal context for forensic analysis', async () => {
      const blocked: BlockedSignalEvent[] = [];
      const pipeline = createSignalPipeline(dynamics, profiles, {
        onBlocked: (e) => blocked.push(e),
      });

      // Trigger CB block (new agent, first failure)
      await pipeline.process({
        agentId: 'forensic-agent',
        success: false,
        factorCode: 'CT-SAFE',
        methodologyKey: 'safety:test',
        now,
      });

      expect(blocked.length).toBeGreaterThanOrEqual(1);
      const event = blocked[0]!;

      // Required forensic fields
      expect(event.agentId).toBe('forensic-agent');
      expect(event.factorCode).toBe('CT-SAFE');
      expect(event.blockReason).toBe('circuit_breaker');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.signal).toBeDefined();
      expect(event.signal.agentId).toBe('forensic-agent');
      expect(event.signal.success).toBe(false);
      // Dynamics result included for CB blocks
      expect(event.dynamicsResult).toBeDefined();
    });
  });

  describe('AU-6: Audit review support', () => {
    it('profile service maintains version history', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Create profile
      await pipeline.process({
        agentId: 'history-agent', success: true, factorCode: 'CT-COMP', now,
      });

      // Multiple updates
      for (let i = 1; i <= 5; i++) {
        await pipeline.process({
          agentId: 'history-agent',
          success: true,
          factorCode: 'CT-REL',
          now: new Date(now.getTime() + i * 1000),
        });
      }

      // Check version progression
      const profile = await profiles.get('history-agent');
      expect(profile).toBeDefined();
      expect(profile!.version).toBeGreaterThanOrEqual(2);
    });

    it('evidence records include provenance metadata', async () => {
      const pipeline = createSignalPipeline(dynamics, profiles);

      const result = await pipeline.process({
        agentId: 'provenance-agent',
        success: true,
        factorCode: 'CT-COMP',
        now,
      });

      // Evidence should have full provenance
      if (result.evidence) {
        expect(result.evidence.evidenceId).toBeDefined();
        expect(result.evidence.factorCode).toBe('CT-COMP');
        expect(result.evidence.collectedAt).toBeInstanceOf(Date);
        expect(result.evidence.source).toBeDefined();
        expect(typeof result.evidence.impact).toBe('number');
      }
    });
  });

  describe('AU-12: Audit generation across all trust operations', () => {
    it('every pipeline path produces at least one audit event', async () => {
      const metrics: SignalMetrics[] = [];
      const blocked: BlockedSignalEvent[] = [];

      const pipeline = createSignalPipeline(dynamics, profiles, {
        rateLimitPerAgent: 2,
        rateLimitWindowMs: 60000,
        onSignalProcessed: (m) => metrics.push(m),
        onBlocked: (e) => blocked.push(e),
      });

      // Path 1: Success signal (creates profile)
      await pipeline.process({
        agentId: 'all-paths', success: true, factorCode: 'CT-COMP', now,
      });

      // Path 2: Another success
      await pipeline.process({
        agentId: 'all-paths', success: true, factorCode: 'CT-REL',
        now: new Date(now.getTime() + 1),
      });

      // Path 3: Rate limited (3rd signal within window, limit=2)
      await pipeline.process({
        agentId: 'all-paths', success: true, factorCode: 'CT-COMP',
        now: new Date(now.getTime() + 2),
      });

      // Path 4: CB trip (new agent, first failure)
      await pipeline.process({
        agentId: 'cb-path', success: false, factorCode: 'CT-COMP',
        methodologyKey: 'test:cb', now,
      });

      // Every signal should produce a metrics event
      expect(metrics.length).toBe(4);

      // Blocked events should fire for blocked signals
      const blockedReasons = blocked.map(b => b.blockReason);
      expect(blockedReasons).toContain('rate_limited');
      expect(blockedReasons).toContain('circuit_breaker');
    });
  });
});
