/**
 * Playbook Definitions Tests
 *
 * Tests for the playbook definitions module ensuring all playbooks
 * have correct structure, proper IDs, valid step references, and
 * adhere to incident response best practices.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  allPlaybooks,
  playbookList,
  getPlaybookById,
  getEnabledPlaybooks,
  accountCompromisePlaybook,
  dataBreachPlaybook,
  ransomwarePlaybook,
} from '../playbooks/index.js';
import type { PlaybookInput, PlaybookStepInput } from '../types.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('Playbook Definitions', () => {
  // --------------------------------------------------------------------------
  // allPlaybooks & playbookList
  // --------------------------------------------------------------------------

  describe('allPlaybooks', () => {
    it('should contain 8 playbooks indexed by ID', () => {
      const ids = Object.keys(allPlaybooks);
      expect(ids).toHaveLength(8);
    });

    it('should have each ID matching the playbook.id property', () => {
      for (const [key, playbook] of Object.entries(allPlaybooks)) {
        expect(key).toBe(playbook.id);
      }
    });
  });

  describe('playbookList', () => {
    it('should have 8 entries', () => {
      expect(playbookList).toHaveLength(8);
    });

    it('should contain the same playbooks as allPlaybooks values', () => {
      const allValues = Object.values(allPlaybooks);
      for (const playbook of playbookList) {
        expect(allValues).toContainEqual(playbook);
      }
    });
  });

  // --------------------------------------------------------------------------
  // getPlaybookById
  // --------------------------------------------------------------------------

  describe('getPlaybookById', () => {
    it('should return the correct playbook for a known ID', () => {
      const pb = getPlaybookById('playbook-account-compromise-v1');
      expect(pb).toBeDefined();
      expect(pb!.name).toBe('Account Compromise Response');
    });

    it('should return undefined for an unknown ID', () => {
      const pb = getPlaybookById('nonexistent-playbook');
      expect(pb).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getEnabledPlaybooks
  // --------------------------------------------------------------------------

  describe('getEnabledPlaybooks', () => {
    it('should return only playbooks with enabled=true or enabled undefined (defaults to true)', () => {
      const enabled = getEnabledPlaybooks();
      expect(enabled.length).toBeGreaterThan(0);

      for (const pb of enabled) {
        // enabled is either true or undefined (which defaults to true)
        expect(pb.enabled === true || pb.enabled === undefined).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Structural Validation
  // --------------------------------------------------------------------------

  describe('Playbook Structure', () => {
    it.each(playbookList.map((pb) => [pb.id, pb]))(
      'playbook "%s" should have required structure',
      (_id, playbook) => {
        const pb = playbook as PlaybookInput;
        expect(pb.id).toBeTruthy();
        expect(typeof pb.id).toBe('string');
        expect(pb.name).toBeTruthy();
        expect(typeof pb.name).toBe('string');
        expect(Array.isArray(pb.steps)).toBe(true);
        expect(pb.steps.length).toBeGreaterThan(0);
        expect(Array.isArray(pb.triggerConditions)).toBe(true);
        expect(Array.isArray(pb.notifications)).toBe(true);
        expect(pb.escalation).toBeDefined();
        expect(typeof pb.escalation.enabled).toBe('boolean');
        expect(Array.isArray(pb.escalation.levels)).toBe(true);
      }
    );

    it.each(playbookList.flatMap((pb) => pb.steps.map((step) => [`${pb.id}/${step.id}`, step])))(
      'step "%s" should have valid structure',
      (_stepPath, step) => {
        const s = step as PlaybookStepInput;
        expect(s.id).toBeTruthy();
        expect(typeof s.id).toBe('string');
        expect(s.name).toBeTruthy();
        expect(typeof s.name).toBe('string');
        expect(['manual', 'automated']).toContain(s.type);
        expect(s.description).toBeTruthy();
        expect(typeof s.description).toBe('string');
      }
    );
  });

  // --------------------------------------------------------------------------
  // Uniqueness
  // --------------------------------------------------------------------------

  describe('Uniqueness', () => {
    it('should have all playbook IDs unique', () => {
      const ids = playbookList.map((pb) => pb.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have all step IDs unique within each playbook', () => {
      for (const playbook of playbookList) {
        const stepIds = playbook.steps.map((s) => s.id);
        const uniqueStepIds = new Set(stepIds);
        expect(uniqueStepIds.size).toBe(stepIds.length);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Step Dependency Validation
  // --------------------------------------------------------------------------

  describe('Step Dependencies', () => {
    it('should only reference valid step IDs within the same playbook for dependencies', () => {
      for (const playbook of playbookList) {
        const validStepIds = new Set(playbook.steps.map((s) => s.id));

        for (const step of playbook.steps) {
          if (step.dependencies && step.dependencies.length > 0) {
            for (const depId of step.dependencies) {
              expect(validStepIds.has(depId)).toBe(true);
            }
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Specific Playbook Tests
  // --------------------------------------------------------------------------

  describe('Account Compromise Playbook', () => {
    it('should have credential revocation and isolation steps', () => {
      const steps = accountCompromisePlaybook.steps;
      const stepNames = steps.map((s) => s.name.toLowerCase());

      const hasCredentialRevocation = stepNames.some(
        (n) => n.includes('revoke') || n.includes('credential')
      );
      expect(hasCredentialRevocation).toBe(true);

      // Check for blocking / isolation steps
      const hasIsolation = stepNames.some(
        (n) => n.includes('block') || n.includes('isolat')
      );
      expect(hasIsolation).toBe(true);
    });
  });

  describe('Data Breach Playbook', () => {
    it('should have evidence collection steps', () => {
      const steps = dataBreachPlaybook.steps;
      const stepNames = steps.map((s) => s.name.toLowerCase());

      const hasEvidenceCollection = stepNames.some(
        (n) => n.includes('evidence') || n.includes('forensic')
      );
      expect(hasEvidenceCollection).toBe(true);
    });
  });

  describe('Ransomware Playbook', () => {
    it('should have system isolation as first step (isolate-first principle)', () => {
      const firstStep = ransomwarePlaybook.steps[0];
      expect(firstStep).toBeDefined();

      const nameOrDesc = (firstStep.name + ' ' + firstStep.description).toLowerCase();
      const isIsolation =
        nameOrDesc.includes('isolat') ||
        nameOrDesc.includes('disconnect') ||
        (firstStep.actionId && firstStep.actionId.includes('isolat'));

      expect(isIsolation).toBe(true);
    });

    it('should have first step with no approval required for emergency response', () => {
      const firstStep = ransomwarePlaybook.steps[0];
      // requiresApproval defaults to false or is explicitly false
      expect(firstStep.requiresApproval === false || firstStep.requiresApproval === undefined).toBe(
        true
      );
    });
  });
});
