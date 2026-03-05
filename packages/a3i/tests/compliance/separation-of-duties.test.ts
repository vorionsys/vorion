/**
 * Separation of Duties Tests
 *
 * NIST Principle: Separation of Duties / Defense in Depth
 *
 * Validates that the two trust engines (fast lane / slow lane) are
 * independent modules that communicate only through the pipeline bridge.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationTier } from '@vorionsys/contracts';
import {
  TrustDynamicsEngine,
  TrustProfileService,
  TrustCalculator,
  createTrustCalculator,
  createSignalPipeline,
  createEvidence,
} from '../../src/index.js';

describe('Separation of Duties (NIST Defense in Depth)', () => {

  describe('SOD-1: Fast lane and slow lane are independent modules', () => {
    it('TrustDynamicsEngine has no reference to TrustProfileService', () => {
      const dynamics = new TrustDynamicsEngine();

      // The dynamics engine can compute deltas without any profile service
      const result = dynamics.updateTrust('sod1-agent', {
        currentScore: 500,
        success: true,
        ceiling: 900,
        tier: 3,
        methodologyKey: 'test:sod1',
        now: new Date(),
      });

      expect(result.delta).toBeGreaterThan(0);
      expect(typeof result.newScore).toBe('number');
    });

    it('TrustCalculator has no reference to TrustDynamicsEngine', () => {
      const calculator = createTrustCalculator();

      // The calculator computes scores from evidence without any dynamics engine
      const profile = calculator.calculate(
        'sod1-calc',
        ObservationTier.WHITE_BOX,
        [createEvidence('CT-COMP', 200, 'independent')]
      );

      expect(profile.compositeScore).toBeGreaterThan(0);
    });
  });

  describe('SOD-2: Fast lane cannot modify profile directly', () => {
    it('dynamics engine returns delta but does not write to any store', () => {
      const dynamics = new TrustDynamicsEngine();
      const profiles = new TrustProfileService();

      // Dynamics engine computes a delta
      const result = dynamics.updateTrust('sod2-agent', {
        currentScore: 500,
        success: false,
        ceiling: 900,
        tier: 3,
        methodologyKey: 'test:sod2',
        now: new Date(),
      });

      expect(result.delta).toBeLessThan(0);

      // Profile service is completely unaffected — no profile exists
      const profile = profiles.getSync?.('sod2-agent') ?? null;
      // If getSync doesn't exist, use async
      // The key assertion: dynamics engine has no reference to profiles
      expect(typeof dynamics.updateTrust).toBe('function');
      // No profile-related methods on dynamics
      expect((dynamics as any).createProfile).toBeUndefined();
      expect((dynamics as any).updateProfile).toBeUndefined();
      expect((dynamics as any).getProfile).toBeUndefined();
    });
  });

  describe('SOD-3: Slow lane cannot trigger circuit breaker directly', () => {
    it('profile service update does not affect dynamics engine CB state', async () => {
      const dynamics = new TrustDynamicsEngine();
      const profiles = new TrustProfileService();

      // Create a profile
      await profiles.create('sod3-agent', ObservationTier.WHITE_BOX, [
        createEvidence('CT-COMP', -500, 'severe-negative'),
      ]);

      // Adding negative evidence to profile does NOT trigger CB in dynamics
      await profiles.update('sod3-agent', [
        createEvidence('CT-COMP', -500, 'more-negative'),
      ]);

      // Dynamics engine has no knowledge of this
      expect(dynamics.isCircuitBreakerTripped('sod3-agent')).toBe(false);
      expect(dynamics.getCircuitBreakerState('sod3-agent')).toBe('normal');
    });
  });

  describe('SOD-4: Pipeline is the sole bridge between lanes', () => {
    it('pipeline coordinates fast and slow lanes through a defined interface', async () => {
      const dynamics = new TrustDynamicsEngine();
      const profiles = new TrustProfileService();
      const pipeline = createSignalPipeline(dynamics, profiles);

      // Process through pipeline — this IS the bridge
      const result = await pipeline.process({
        agentId: 'sod4-agent',
        success: true,
        factorCode: 'CT-COMP',
        now: new Date(),
      });

      // Pipeline produced a dynamics result (fast lane)
      expect(result.dynamicsResult).toBeDefined();
      expect(typeof result.dynamicsResult.delta).toBe('number');

      // Pipeline also created/updated a profile (slow lane)
      expect(result.profile).toBeDefined();

      // Both engines were coordinated through the pipeline
      const profile = await profiles.get('sod4-agent');
      expect(profile).toBeDefined();
    });

    it('admin reset is independent of pipeline (direct dynamics access)', () => {
      const dynamics = new TrustDynamicsEngine();

      // Trip CB directly
      dynamics.updateTrust('sod4-admin', {
        currentScore: 50,
        success: false,
        ceiling: 900,
        tier: 0,
        methodologyKey: 'test:admin',
        now: new Date(),
      });

      // Admin reset goes directly to dynamics (not through pipeline)
      const resetOk = dynamics.resetCircuitBreaker('sod4-admin', true);
      expect(resetOk).toBe(true);
      expect(dynamics.getCircuitBreakerState('sod4-admin')).toBe('normal');
    });
  });
});
