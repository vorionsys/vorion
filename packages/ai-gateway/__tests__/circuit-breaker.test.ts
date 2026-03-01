import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, createCircuitBreaker } from '../src/routing/circuit-breaker.js';
import type { CircuitState } from '../src/routing/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      successThreshold: 2,
      failureWindowMs: 60000,
      halfOpenRequestPercentage: 100, // always allow in half-open for deterministic tests
      enableJitter: false,
      jitterFactor: 0,
    });
  });

  afterEach(() => {
    cb.stopCleanup();
    cb.resetAll();
  });

  // ============================================
  // INITIAL STATE
  // ============================================

  describe('initial state', () => {
    it('should start in closed state for new providers', () => {
      expect(cb.getState('anthropic')).toBe('closed');
    });

    it('should allow requests when circuit is closed', () => {
      expect(cb.canRequest('anthropic')).toBe(true);
    });

    it('should track separate circuits per provider', () => {
      expect(cb.getState('anthropic')).toBe('closed');
      expect(cb.getState('google')).toBe('closed');
    });

    it('should track separate circuits per provider+model', () => {
      cb.forceState('anthropic', 'open', 'claude-3-opus');
      expect(cb.getState('anthropic', 'claude-3-opus')).toBe('open');
      expect(cb.getState('anthropic')).toBe('closed');
    });
  });

  // ============================================
  // CLOSED -> OPEN TRANSITION
  // ============================================

  describe('closed to open transition', () => {
    it('should open circuit after reaching failure threshold', () => {
      for (let i = 0; i < 3; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100, error: 'timeout' });
      }
      expect(cb.getState('anthropic')).toBe('open');
    });

    it('should not open circuit before reaching failure threshold', () => {
      cb.recordResult('anthropic', { success: false, latencyMs: 100, error: 'err' });
      cb.recordResult('anthropic', { success: false, latencyMs: 100, error: 'err' });
      expect(cb.getState('anthropic')).toBe('closed');
    });

    it('should reset failure count on success in closed state', () => {
      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });
      // Failures reset; need 3 more to open
      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      expect(cb.getState('anthropic')).toBe('closed');
    });

    it('should block requests when circuit is open', () => {
      for (let i = 0; i < 3; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      }
      expect(cb.canRequest('anthropic')).toBe(false);
    });
  });

  // ============================================
  // OPEN -> HALF-OPEN TRANSITION
  // ============================================

  describe('open to half-open transition', () => {
    it('should transition to half-open after reset timeout', () => {
      vi.useFakeTimers();
      try {
        for (let i = 0; i < 3; i++) {
          cb.recordResult('anthropic', { success: false, latencyMs: 100 });
        }
        expect(cb.getState('anthropic')).toBe('open');

        // Advance past reset timeout
        vi.advanceTimersByTime(6000);

        // canRequest checks the timer and transitions
        const allowed = cb.canRequest('anthropic');
        expect(cb.getState('anthropic')).toBe('half-open');
        expect(allowed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not transition to half-open before reset timeout', () => {
      vi.useFakeTimers();
      try {
        for (let i = 0; i < 3; i++) {
          cb.recordResult('anthropic', { success: false, latencyMs: 100 });
        }

        vi.advanceTimersByTime(3000);
        expect(cb.canRequest('anthropic')).toBe(false);
        expect(cb.getState('anthropic')).toBe('open');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ============================================
  // HALF-OPEN -> CLOSED TRANSITION
  // ============================================

  describe('half-open to closed transition', () => {
    it('should close circuit after enough successes in half-open', () => {
      cb.forceState('anthropic', 'half-open');
      expect(cb.getState('anthropic')).toBe('half-open');

      // Need successThreshold (2) successes
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });

      expect(cb.getState('anthropic')).toBe('closed');
    });

    it('should reopen circuit on failure in half-open', () => {
      cb.forceState('anthropic', 'half-open');
      cb.recordResult('anthropic', { success: false, latencyMs: 100, error: 'fail' });
      expect(cb.getState('anthropic')).toBe('open');
    });

    it('should not close with fewer successes than threshold', () => {
      cb.forceState('anthropic', 'half-open');
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });
      expect(cb.getState('anthropic')).toBe('half-open');
    });
  });

  // ============================================
  // METRICS
  // ============================================

  describe('metrics', () => {
    it('should track allowed requests in closed state', () => {
      cb.canRequest('anthropic');
      cb.canRequest('anthropic');
      const metrics = cb.getCircuitMetrics('anthropic');
      expect(metrics.requestsAllowed).toBe(2);
    });

    it('should track blocked requests in open state', () => {
      for (let i = 0; i < 3; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      }
      cb.canRequest('anthropic');
      cb.canRequest('anthropic');
      const metrics = cb.getCircuitMetrics('anthropic');
      expect(metrics.requestsBlocked).toBe(2);
    });

    it('should track trip count', () => {
      for (let i = 0; i < 3; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      }
      const metrics = cb.getCircuitMetrics('anthropic');
      expect(metrics.tripsCount).toBe(1);
    });

    it('should calculate failure rate', () => {
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });
      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      const metrics = cb.getCircuitMetrics('anthropic');
      expect(metrics.failureRate).toBe(50);
    });

    it('should track recovery count', () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      }
      // Move to half-open
      cb.forceState('anthropic', 'half-open');
      // Recover
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });
      cb.recordResult('anthropic', { success: true, latencyMs: 50 });

      const metrics = cb.getCircuitMetrics('anthropic');
      expect(metrics.recoveryCount).toBe(1);
    });
  });

  // ============================================
  // ERROR TRACKING
  // ============================================

  describe('error tracking', () => {
    it('should track recent errors', () => {
      cb.recordResult('anthropic', { success: false, latencyMs: 100, error: 'timeout error' });
      const record = cb.getCircuitRecord('anthropic');
      expect(record.recentErrors).toHaveLength(1);
      expect(record.recentErrors[0]!.error).toBe('timeout error');
    });

    it('should limit recent errors to 10', () => {
      for (let i = 0; i < 15; i++) {
        cb.recordResult('anthropic', { success: false, latencyMs: 100, error: `error-${i}` });
      }
      const record = cb.getCircuitRecord('anthropic');
      expect(record.recentErrors.length).toBeLessThanOrEqual(10);
    });
  });

  // ============================================
  // SUMMARY AND LISTENERS
  // ============================================

  describe('summary', () => {
    it('should return accurate summary', () => {
      // Create circuits in various states
      cb.forceState('anthropic', 'open');
      cb.forceState('google', 'half-open');
      cb.getState('ollama'); // creates closed circuit

      const summary = cb.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.open).toBe(1);
      expect(summary.halfOpen).toBe(1);
      expect(summary.closed).toBe(1);
    });
  });

  describe('listeners', () => {
    it('should notify listeners on state change', () => {
      const listener = vi.fn();
      cb.onStateChange(listener);

      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      expect(listener).toHaveBeenCalled();
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();
      const remove = cb.onStateChange(listener);
      remove();

      cb.recordResult('anthropic', { success: false, latencyMs: 100 });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // RESET
  // ============================================

  describe('reset', () => {
    it('should reset a specific circuit', () => {
      cb.forceState('anthropic', 'open');
      cb.reset('anthropic');
      expect(cb.getState('anthropic')).toBe('closed');
    });

    it('should reset all circuits', () => {
      cb.forceState('anthropic', 'open');
      cb.forceState('google', 'open');
      cb.resetAll();
      expect(cb.getAllCircuits().size).toBe(0);
    });
  });

  // ============================================
  // FACTORY FUNCTION
  // ============================================

  describe('createCircuitBreaker', () => {
    it('should create a circuit breaker with custom config', () => {
      const custom = createCircuitBreaker({ failureThreshold: 10 });
      // Record 5 failures (below threshold of 10)
      for (let i = 0; i < 5; i++) {
        custom.recordResult('anthropic', { success: false, latencyMs: 100 });
      }
      expect(custom.getState('anthropic')).toBe('closed');
    });
  });
});
