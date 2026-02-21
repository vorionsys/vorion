/**
 * Tests for PersistentIntentService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistentIntentService } from '../src/intent/persistent-intent-service.js';
import type { IntentSubmission, SubmitOptions } from '../src/intent/index.js';

// =============================================================================
// HELPERS
// =============================================================================

function makeSubmission(overrides?: Partial<IntentSubmission>): IntentSubmission {
  return {
    entityId: 'agent-001',
    goal: 'Send a notification',
    context: { channel: 'email' },
    ...overrides,
  };
}

const defaultOptions: SubmitOptions = {
  tenantId: 'tenant-1',
  trustLevel: 4,
};

// =============================================================================
// TESTS
// =============================================================================

describe('PersistentIntentService', () => {
  let service: PersistentIntentService;

  beforeEach(() => {
    service = new PersistentIntentService({
      expirationSweepIntervalMs: 0, // disable automatic sweep in tests
    });
  });

  afterEach(() => {
    service.close();
  });

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  describe('submit', () => {
    it('creates an intent with all fields populated', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);

      expect(intent.id).toBeDefined();
      expect(intent.tenantId).toBe('tenant-1');
      expect(intent.entityId).toBe('agent-001');
      expect(intent.goal).toBe('Send a notification');
      expect(intent.status).toBe('pending');
      expect(intent.createdAt).toBeDefined();
      expect(intent.updatedAt).toBeDefined();
      expect(intent.correlationId).toBeDefined();
      expect(intent.expiresAt).toBeDefined();
    });

    it('uses provided correlationId', async () => {
      const intent = await service.submit(
        makeSubmission({ correlationId: 'corr-123' }),
        defaultOptions,
      );
      expect(intent.correlationId).toBe('corr-123');
    });

    it('sets canonical fields from submission', async () => {
      const intent = await service.submit(
        makeSubmission({
          actionType: 'execute',
          resourceScope: ['db:users'],
          dataSensitivity: 'CONFIDENTIAL',
          reversibility: 'IRREVERSIBLE',
          source: 'test-runner',
        }),
        defaultOptions,
      );

      expect(intent.actionType).toBe('execute');
      expect(intent.resourceScope).toEqual(['db:users']);
      expect(intent.dataSensitivity).toBe('CONFIDENTIAL');
      expect(intent.reversibility).toBe('IRREVERSIBLE');
      expect(intent.source).toBe('test-runner');
    });

    it('sets custom expiresIn', async () => {
      const intent = await service.submit(
        makeSubmission({ expiresIn: 30_000 }),
        defaultOptions,
      );
      const expiresAt = new Date(intent.expiresAt!).getTime();
      const now = Date.now();
      // Should expire ~30s from now (allow 5s tolerance)
      expect(expiresAt).toBeGreaterThan(now + 25_000);
      expect(expiresAt).toBeLessThan(now + 35_000);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  describe('validation', () => {
    it('rejects missing entityId', async () => {
      await expect(
        service.submit(makeSubmission({ entityId: '' }), defaultOptions),
      ).rejects.toThrow('entityId is required');
    });

    it('rejects missing goal', async () => {
      await expect(
        service.submit(makeSubmission({ goal: '' }), defaultOptions),
      ).rejects.toThrow('goal is required');
    });

    it('rejects goal exceeding 10,000 chars', async () => {
      await expect(
        service.submit(makeSubmission({ goal: 'x'.repeat(10_001) }), defaultOptions),
      ).rejects.toThrow('10,000 characters');
    });

    it('rejects invalid expiresIn (negative)', async () => {
      await expect(
        service.submit(makeSubmission({ expiresIn: -1 }), defaultOptions),
      ).rejects.toThrow('expiresIn must be a positive number');
    });

    it('rejects expiresIn exceeding 24 hours', async () => {
      await expect(
        service.submit(makeSubmission({ expiresIn: 86_400_001 }), defaultOptions),
      ).rejects.toThrow('24 hours');
    });

    it('rejects missing tenantId', async () => {
      await expect(
        service.submit(makeSubmission(), { tenantId: '' }),
      ).rejects.toThrow('tenantId is required');
    });
  });

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  describe('get', () => {
    it('retrieves an intent by ID with correct tenant', async () => {
      const created = await service.submit(makeSubmission(), defaultOptions);
      const retrieved = await service.get(created.id, 'tenant-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });

    it('returns undefined for wrong tenant', async () => {
      const created = await service.submit(makeSubmission(), defaultOptions);
      const result = await service.get(created.id, 'tenant-other');
      expect(result).toBeUndefined();
    });

    it('returns undefined for non-existent ID', async () => {
      const result = await service.get('non-existent', 'tenant-1');
      expect(result).toBeUndefined();
    });

    it('returns undefined for expired intent', async () => {
      const created = await service.submit(
        makeSubmission({ expiresIn: 1 }), // 1ms — will expire immediately
        defaultOptions,
      );
      // Wait for expiration
      await new Promise((r) => setTimeout(r, 10));
      const result = await service.get(created.id, 'tenant-1');
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Status transitions (state machine)
  // ---------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('transitions pending → evaluating', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      const updated = await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      expect(updated!.status).toBe('evaluating');
    });

    it('transitions evaluating → approved', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      const updated = await service.updateStatus(intent.id, 'tenant-1', 'approved');
      expect(updated!.status).toBe('approved');
    });

    it('transitions approved → executing → completed', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      await service.updateStatus(intent.id, 'tenant-1', 'approved');
      await service.updateStatus(intent.id, 'tenant-1', 'executing');
      const updated = await service.updateStatus(intent.id, 'tenant-1', 'completed');
      expect(updated!.status).toBe('completed');
    });

    it('allows failed → pending (retry)', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      await service.updateStatus(intent.id, 'tenant-1', 'failed');
      const updated = await service.updateStatus(intent.id, 'tenant-1', 'pending');
      expect(updated!.status).toBe('pending');
    });

    it('rejects invalid transition pending → completed', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await expect(
        service.updateStatus(intent.id, 'tenant-1', 'completed'),
      ).rejects.toThrow('Invalid status transition');
    });

    it('rejects transition from terminal state (denied)', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      await service.updateStatus(intent.id, 'tenant-1', 'denied');
      await expect(
        service.updateStatus(intent.id, 'tenant-1', 'evaluating'),
      ).rejects.toThrow('Invalid status transition');
    });

    it('returns undefined for wrong tenant', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      const result = await service.updateStatus(intent.id, 'tenant-other', 'evaluating');
      expect(result).toBeUndefined();
    });

    it('removes completed intents from entity index', async () => {
      const intent = await service.submit(makeSubmission(), defaultOptions);
      await service.updateStatus(intent.id, 'tenant-1', 'evaluating');
      await service.updateStatus(intent.id, 'tenant-1', 'approved');
      await service.updateStatus(intent.id, 'tenant-1', 'executing');
      await service.updateStatus(intent.id, 'tenant-1', 'completed');

      // Entity index should no longer include this intent
      const entityIntents = await service.listByEntity('agent-001', 'tenant-1');
      expect(entityIntents.find((i) => i.id === intent.id)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // List by entity
  // ---------------------------------------------------------------------------

  describe('listByEntity', () => {
    it('returns intents for the correct entity and tenant', async () => {
      await service.submit(makeSubmission({ entityId: 'agent-001' }), defaultOptions);
      await service.submit(makeSubmission({ entityId: 'agent-001' }), defaultOptions);
      await service.submit(makeSubmission({ entityId: 'agent-002' }), defaultOptions);

      const results = await service.listByEntity('agent-001', 'tenant-1');
      expect(results).toHaveLength(2);
      expect(results.every((i) => i.entityId === 'agent-001')).toBe(true);
    });

    it('returns empty array for unknown entity', async () => {
      const results = await service.listByEntity('unknown', 'tenant-1');
      expect(results).toEqual([]);
    });

    it('sorts by creation time (newest first)', async () => {
      const first = await service.submit(makeSubmission(), defaultOptions);
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.submit(makeSubmission(), defaultOptions);

      const results = await service.listByEntity('agent-001', 'tenant-1');
      expect(results[0].id).toBe(second.id);
      expect(results[1].id).toBe(first.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Per-entity limits
  // ---------------------------------------------------------------------------

  describe('entity limits', () => {
    it('enforces maxIntentsPerEntity', async () => {
      const limitedService = new PersistentIntentService({
        maxIntentsPerEntity: 2,
        expirationSweepIntervalMs: 0,
      });

      await limitedService.submit(makeSubmission(), defaultOptions);
      await limitedService.submit(makeSubmission(), defaultOptions);

      await expect(
        limitedService.submit(makeSubmission(), defaultOptions),
      ).rejects.toThrow('maximum of 2 active intents');

      limitedService.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Count & clear
  // ---------------------------------------------------------------------------

  describe('count and clear', () => {
    it('tracks intent count', async () => {
      expect(service.count()).toBe(0);
      await service.submit(makeSubmission(), defaultOptions);
      expect(service.count()).toBe(1);
      await service.submit(makeSubmission(), defaultOptions);
      expect(service.count()).toBe(2);
    });

    it('clears all intents', async () => {
      await service.submit(makeSubmission(), defaultOptions);
      await service.submit(makeSubmission(), defaultOptions);
      service.clear();
      expect(service.count()).toBe(0);
    });
  });
});
