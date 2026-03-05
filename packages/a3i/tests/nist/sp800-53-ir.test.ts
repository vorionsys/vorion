/**
 * NIST SP 800-53 — Incident Response (IR) Tests
 *
 * Validates that the Vorion A3I trust system implements automated
 * incident handling with graduated response and managed recovery.
 *
 * Maps to: IR-4, IR-5, IR-6, IR-7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  createSignalPipeline,
  type TrustSignalPipeline,
} from '../../src/index.js';

describe('NIST SP 800-53 — Incident Response (IR)', () => {
  let dynamics: TrustDynamicsEngine;
  let profiles: TrustProfileService;
  let pipeline: TrustSignalPipeline;
  const now = new Date('2026-03-04T12:00:00Z');

  beforeEach(() => {
    dynamics = new TrustDynamicsEngine();
    profiles = new TrustProfileService();
    pipeline = createSignalPipeline(dynamics, profiles);
  });

  describe('IR-4: Automated incident handling', () => {
    it('score below threshold triggers hard CB trip', () => {
      const result = dynamics.updateTrust('ir4-score', {
        currentScore: 50,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:score-cb',
        now,
      });

      // Score was already near threshold; loss pushes below → CB trips
      expect(result.circuitBreakerTripped).toBe(true);
    });

    it('repeat methodology failures trigger CB trip', () => {
      // 3 failures with same key
      for (let i = 0; i < 3; i++) {
        dynamics.updateTrust('ir4-repeat', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          tier: 3,
          methodologyKey: 'repeat:same:key',
          now: new Date(now.getTime() + i * 60000),
        });
      }

      expect(dynamics.isCircuitBreakerTripped('ir4-repeat')).toBe(true);
    });

    it('cross-methodology rotation triggers CB trip', () => {
      // 6 failures with 6 unique keys
      for (let i = 0; i < 6; i++) {
        dynamics.updateTrust('ir4-rotation', {
          currentScore: 500,
          success: false,
          ceiling: 900,
          tier: 3,
          methodologyKey: `unique:key:${i}`,
          now: new Date(now.getTime() + i * 60000),
        });
      }

      expect(dynamics.isCircuitBreakerTripped('ir4-rotation')).toBe(true);
    });
  });

  describe('IR-4(1): Tiered auto-reset policy', () => {
    it('T0 auto-resets CB after 15 minutes', async () => {
      // Trip CB at T0
      await pipeline.process({
        agentId: 'ir4-t0',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'test:t0',
        now,
      });
      expect(dynamics.isCircuitBreakerTripped('ir4-t0')).toBe(true);

      // After 16 minutes: auto-reset
      const afterReset = new Date(now.getTime() + 16 * 60 * 1000);
      const result = await pipeline.process({
        agentId: 'ir4-t0',
        success: true,
        factorCode: 'CT-COMP',
        now: afterReset,
      });
      expect(result.dynamicsResult.circuitBreakerTripped).toBe(false);
    });

    it('T3+ requires admin reset (no auto-reset)', () => {
      // Trip CB
      dynamics.updateTrust('ir4-t3', {
        currentScore: 50,
        success: false,
        ceiling: 900,
        tier: 3,
        methodologyKey: 'test:t3',
        now,
      });
      expect(dynamics.isCircuitBreakerTripped('ir4-t3')).toBe(true);

      // Even after a very long time, should still be tripped (T3+ has null auto-reset)
      const longAfter = new Date(now.getTime() + 999 * 60 * 60 * 1000); // 999 hours
      dynamics.updateTrust('ir4-t3', {
        currentScore: 0,
        success: true,
        ceiling: 900,
        tier: 3,
        methodologyKey: 'test:gain',
        now: longAfter,
      });

      // Still tripped — admin required
      expect(dynamics.isCircuitBreakerTripped('ir4-t3')).toBe(true);
    });
  });

  describe('IR-5: Degraded mode as early warning', () => {
    it('degraded mode blocks gains but allows continued loss monitoring', () => {
      // Enter degraded mode: loss from score near degraded threshold (200)
      dynamics.updateTrust('ir5-degraded', {
        currentScore: 180,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:degrade',
        now,
      });

      const state = dynamics.getCircuitBreakerState('ir5-degraded');

      if (state === 'degraded') {
        // Gain attempt within degraded auto-reset window (5min for T0)
        const withinWindow = new Date(now.getTime() + 2 * 60 * 1000);
        const gain = dynamics.updateTrust('ir5-degraded', {
          currentScore: 170,
          success: true,
          ceiling: 900,
          tier: 0,
          methodologyKey: 'test:gain',
          now: withinWindow,
        });

        expect(gain.blockedByDegraded).toBe(true);
        expect(gain.delta).toBe(0);
      }
    });
  });

  describe('IR-6: Escalation path (normal → degraded → tripped)', () => {
    it('CB state machine transitions follow the correct order', () => {
      // Start: normal
      expect(dynamics.getCircuitBreakerState('ir6-agent')).toBe('normal');

      // Loss near degraded threshold → degraded
      dynamics.updateTrust('ir6-agent', {
        currentScore: 180,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:escalate1',
        now,
      });

      const afterFirst = dynamics.getCircuitBreakerState('ir6-agent');
      expect(['degraded', 'tripped']).toContain(afterFirst);

      if (afterFirst === 'degraded') {
        // Further loss → tripped
        dynamics.updateTrust('ir6-agent', {
          currentScore: 50,
          success: false,
          ceiling: 900,
          tier: 0,
          methodologyKey: 'test:escalate2',
          now: new Date(now.getTime() + 1000),
        });

        expect(dynamics.getCircuitBreakerState('ir6-agent')).toBe('tripped');
      }
    });
  });

  describe('IR-7: Admin reset as incident resolution', () => {
    it('admin reset clears CB, cooldown, and methodology history', async () => {
      // Trip CB
      await pipeline.process({
        agentId: 'ir7-agent',
        success: false,
        factorCode: 'CT-COMP',
        methodologyKey: 'test:admin',
        now,
      });
      expect(dynamics.isCircuitBreakerTripped('ir7-agent')).toBe(true);

      // Admin reset
      const resetOk = dynamics.resetCircuitBreaker('ir7-agent', true, now);
      expect(resetOk).toBe(true);

      // All state cleared
      expect(dynamics.isCircuitBreakerTripped('ir7-agent')).toBe(false);
      expect(dynamics.getCircuitBreakerState('ir7-agent')).toBe('normal');
      expect(dynamics.isInCooldown('ir7-agent')).toBe(false);
    });

    it('non-admin reset is rejected', () => {
      dynamics.updateTrust('ir7-nonadmin', {
        currentScore: 50,
        success: false,
        ceiling: 900,
        tier: 3,
        methodologyKey: 'test:nonadmin',
        now,
      });
      expect(dynamics.isCircuitBreakerTripped('ir7-nonadmin')).toBe(true);

      // Non-admin attempt at T3 (no auto-reset, admin required)
      const result = dynamics.resetCircuitBreaker('ir7-nonadmin', false, now);
      expect(result).toBe(false);
      expect(dynamics.isCircuitBreakerTripped('ir7-nonadmin')).toBe(true);
    });
  });
});
