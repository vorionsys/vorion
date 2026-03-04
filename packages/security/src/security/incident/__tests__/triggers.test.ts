/**
 * IncidentTrigger Tests
 *
 * Comprehensive tests for the IncidentTrigger class which handles
 * alert-to-incident mapping, rule evaluation, deduplication,
 * cooldown enforcement, severity escalation, and playbook selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncidentTrigger } from '../triggers.js';
import type {
  Alert,
  AlertRule,
  AlertCondition,
  Playbook,
  CreateIncidentInput,
  IncidentType,
  IncidentSeverity,
} from '../types.js';

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

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

// Mock anomaly types to avoid import issues
vi.mock('../../anomaly/types.js', () => ({}));

// ============================================================================
// Test Helpers
// ============================================================================

function createTestAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    alertId: 'alert-1',
    source: 'test-source',
    type: 'test-type',
    severity: 'warning',
    title: 'Test Alert Title',
    description: 'Test alert description',
    timestamp: new Date(),
    rawData: {},
    ...overrides,
  };
}

function createTestRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    enabled: true,
    conditions: [{ field: 'type', operator: 'equals', value: 'test-type' }],
    conditionOperator: 'and',
    incidentConfig: {
      type: 'account_compromise' as IncidentType,
      severity: 'P3' as IncidentSeverity,
      titleTemplate: 'Incident: {{title}}',
      descriptionTemplate: 'Details: {{description}}',
      tags: ['test'],
    },
    cooldownSeconds: 0,
    priority: 50,
    ...overrides,
  };
}

function createTestPlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'playbook-test',
    name: 'Test Playbook',
    version: '1.0.0',
    triggerConditions: [
      { field: 'type', operator: 'equals', value: 'account_compromise' },
    ],
    steps: [
      {
        id: 'step-1',
        name: 'Step 1',
        type: 'automated',
        description: 'Test step',
        requiresApproval: false,
        onFailure: 'halt',
        retryAttempts: 0,
      },
    ],
    notifications: [],
    escalation: {
      enabled: false,
      levels: [],
      maxLevel: 1,
      resetOnAcknowledge: true,
    },
    enabled: true,
    ...overrides,
  } as Playbook;
}

// ============================================================================
// Tests
// ============================================================================

describe('IncidentTrigger', () => {
  let trigger: IncidentTrigger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    trigger = new IncidentTrigger();
  });

  afterEach(() => {
    trigger.destroy();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Default Rules
  // --------------------------------------------------------------------------

  describe('Default Rules', () => {
    it('should load at least 8 default alert rules', () => {
      const rules = trigger.getRules();
      expect(rules.length).toBeGreaterThanOrEqual(8);
    });

    it('should have all default rules enabled', () => {
      const rules = trigger.getRules();
      const allEnabled = rules.every((r) => r.enabled);
      expect(allEnabled).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Rule Management
  // --------------------------------------------------------------------------

  describe('Rule Management', () => {
    it('should add a new rule', () => {
      const initialCount = trigger.getRules().length;
      const newRule = createTestRule({ id: 'custom-rule', priority: 99 });
      trigger.addRule(newRule);

      const rules = trigger.getRules();
      expect(rules.length).toBe(initialCount + 1);
      const found = rules.find((r) => r.id === 'custom-rule');
      expect(found).toBeDefined();
    });

    it('should remove a rule by ID', () => {
      const newRule = createTestRule({ id: 'removable-rule' });
      trigger.addRule(newRule);
      const initialCount = trigger.getRules().length;

      const removed = trigger.removeRule('removable-rule');
      expect(removed).toBe(true);
      expect(trigger.getRules().length).toBe(initialCount - 1);
    });

    it('should return false when removing a non-existent rule', () => {
      const removed = trigger.removeRule('nonexistent');
      expect(removed).toBe(false);
    });

    it('should return rules sorted by priority (highest first)', () => {
      trigger.addRule(createTestRule({ id: 'low-prio', priority: 10 }));
      trigger.addRule(createTestRule({ id: 'high-prio', priority: 999 }));

      const rules = trigger.getRules();
      for (let i = 1; i < rules.length; i++) {
        expect(rules[i - 1].priority).toBeGreaterThanOrEqual(rules[i].priority);
      }
      expect(rules[0].id).toBe('high-prio');
    });
  });

  // --------------------------------------------------------------------------
  // processAlert
  // --------------------------------------------------------------------------

  describe('processAlert', () => {
    it('should return incidentCreated=false when triggers are disabled', async () => {
      const disabledTrigger = new IncidentTrigger({ enabled: false });
      const alert = createTestAlert();

      const result = await disabledTrigger.processAlert(alert);

      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toBe('Triggers disabled');
      disabledTrigger.destroy();
    });

    it('should create incident when alert matches a rule', async () => {
      const creator = vi.fn(async () => ({ id: 'new-incident-1' }));
      trigger.registerIncidentCreator(creator);

      // Use a matching alert for the default impossible-travel rule
      const alert = createTestAlert({
        alertId: 'alert-match',
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
      });

      const result = await trigger.processAlert(alert);

      expect(result.incidentCreated).toBe(true);
      expect(result.incidentId).toBe('new-incident-1');
      expect(creator).toHaveBeenCalledTimes(1);
    });

    it('should return incidentCreated=false when no rule matches', async () => {
      const creator = vi.fn(async () => ({ id: 'inc-1' }));
      trigger.registerIncidentCreator(creator);

      const alert = createTestAlert({
        source: 'completely-unknown-source',
        type: 'completely-unknown-type',
      });

      const result = await trigger.processAlert(alert);

      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toBe('No matching rule');
      expect(creator).not.toHaveBeenCalled();
    });

    it('should return incidentCreated=false when no incident creator is registered', async () => {
      // Add a simple rule that will match
      trigger.addRule(
        createTestRule({
          id: 'no-creator-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'specific-type' }],
          priority: 999,
        })
      );

      const alert = createTestAlert({ type: 'specific-type' });
      const result = await trigger.processAlert(alert);

      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('No incident creator registered');
    });

    it('should apply template substitution for {{title}} and {{description}}', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'tmpl-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'tmpl-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'tmpl-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: 'Detected: {{title}}',
            descriptionTemplate: 'Alert says: {{description}}',
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'tmpl-type',
        title: 'Something Bad',
        description: 'Very bad thing happened',
      });

      await trigger.processAlert(alert);

      expect(capturedInput).toBeDefined();
      expect(capturedInput!.title).toBe('Detected: Something Bad');
      expect(capturedInput!.description).toBe('Alert says: Very bad thing happened');
    });

    it('should populate affected resources from alert userId, ipAddress, and resource', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'res-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'res-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'res-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'res-type',
        userId: 'user-123',
        ipAddress: '10.0.0.1',
        resource: 'db:production',
      });

      await trigger.processAlert(alert);

      expect(capturedInput!.affectedResources).toContain('user:user-123');
      expect(capturedInput!.affectedResources).toContain('ip:10.0.0.1');
      expect(capturedInput!.affectedResources).toContain('db:production');
    });
  });

  // --------------------------------------------------------------------------
  // Condition Evaluation - All Operators
  // --------------------------------------------------------------------------

  describe('Condition Evaluation', () => {
    // Helper to test a single condition match
    async function testCondition(
      condition: AlertCondition,
      alertOverrides: Partial<Alert>,
      shouldMatch: boolean
    ): Promise<void> {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'cond-inc' }));

      // Remove all default rules
      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) {
        freshTrigger.removeRule(r.id);
      }

      freshTrigger.addRule(
        createTestRule({
          id: 'cond-rule',
          conditions: [condition],
          conditionOperator: 'and',
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert(alertOverrides);
      const result = await freshTrigger.processAlert(alert);

      if (shouldMatch) {
        expect(result.incidentCreated).toBe(true);
      } else {
        expect(result.incidentCreated).toBe(false);
      }
      freshTrigger.destroy();
    }

    it('equals: should match when field equals value', async () => {
      await testCondition(
        { field: 'type', operator: 'equals', value: 'specific' },
        { type: 'specific' },
        true
      );
    });

    it('equals: should not match when field does not equal value', async () => {
      await testCondition(
        { field: 'type', operator: 'equals', value: 'specific' },
        { type: 'different' },
        false
      );
    });

    it('not_equals: should match when field does not equal value', async () => {
      await testCondition(
        { field: 'type', operator: 'not_equals', value: 'specific' },
        { type: 'different' },
        true
      );
    });

    it('contains: should match when string includes value', async () => {
      await testCondition(
        { field: 'type', operator: 'contains', value: 'mal' },
        { type: 'malware-detected' },
        true
      );
    });

    it('not_contains: should match when string does not include value', async () => {
      await testCondition(
        { field: 'type', operator: 'not_contains', value: 'xyz' },
        { type: 'malware-detected' },
        true
      );
    });

    it('matches: should match when regex test passes', async () => {
      await testCondition(
        { field: 'type', operator: 'matches', value: '^mal.*detected$' },
        { type: 'malware-detected' },
        true
      );
    });

    it('gt: should match when field is greater than value', async () => {
      await testCondition(
        { field: 'rawData.score', operator: 'gt', value: 50 },
        { rawData: { score: 75 } },
        true
      );
    });

    it('lt: should match when field is less than value', async () => {
      await testCondition(
        { field: 'rawData.score', operator: 'lt', value: 50 },
        { rawData: { score: 25 } },
        true
      );
    });

    it('gte: should match when field is greater than or equal to value', async () => {
      await testCondition(
        { field: 'rawData.score', operator: 'gte', value: 50 },
        { rawData: { score: 50 } },
        true
      );
    });

    it('lte: should match when field is less than or equal to value', async () => {
      await testCondition(
        { field: 'rawData.score', operator: 'lte', value: 50 },
        { rawData: { score: 50 } },
        true
      );
    });

    it('in: should match when value array includes field', async () => {
      await testCondition(
        { field: 'severity', operator: 'in', value: ['critical', 'error'] },
        { severity: 'error' },
        true
      );
    });

    it('not_in: should match when value array does not include field', async () => {
      await testCondition(
        { field: 'severity', operator: 'not_in', value: ['critical', 'error'] },
        { severity: 'info' },
        true
      );
    });

    it('exists: should match when field is not undefined/null', async () => {
      await testCondition(
        { field: 'userId', operator: 'exists' },
        { userId: 'user-1' },
        true
      );
    });

    it('not_exists: should match when field is undefined/null', async () => {
      await testCondition(
        { field: 'userId', operator: 'not_exists' },
        {},
        true
      );
    });
  });

  // --------------------------------------------------------------------------
  // Condition Operators (AND / OR)
  // --------------------------------------------------------------------------

  describe('Condition Operators', () => {
    it('should require all conditions to match when operator is AND', async () => {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'and-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'and-rule',
          conditions: [
            { field: 'source', operator: 'equals', value: 'test' },
            { field: 'type', operator: 'equals', value: 'login' },
          ],
          conditionOperator: 'and',
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Only one condition matches
      const alert = createTestAlert({ source: 'test', type: 'different' });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);

      // Both conditions match
      const alert2 = createTestAlert({ source: 'test', type: 'login', alertId: 'a2' });
      const result2 = await freshTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(true);

      freshTrigger.destroy();
    });

    it('should require any condition to match when operator is OR', async () => {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'or-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'or-rule',
          conditions: [
            { field: 'source', operator: 'equals', value: 'source-a' },
            { field: 'source', operator: 'equals', value: 'source-b' },
          ],
          conditionOperator: 'or',
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ source: 'source-b' });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);

      freshTrigger.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Nested Field Access
  // --------------------------------------------------------------------------

  describe('Nested Field Access', () => {
    it('should access nested fields like rawData.category', async () => {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'nest-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'nest-rule',
          conditions: [{ field: 'rawData.category', operator: 'equals', value: 'security' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ rawData: { category: 'security' } });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);

      freshTrigger.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Cooldown Enforcement
  // --------------------------------------------------------------------------

  describe('Cooldown Enforcement', () => {
    it('should reject second alert within cooldown period', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'cool-inc' }));

      trigger.addRule(
        createTestRule({
          id: 'cool-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'cooldown-type' }],
          priority: 999,
          cooldownSeconds: 300,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'cool-a1',
        type: 'cooldown-type',
        source: 'cool-src',
        userId: 'user-cool',
      });
      const result1 = await trigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      // Second alert within cooldown
      const alert2 = createTestAlert({
        alertId: 'cool-a2',
        type: 'cooldown-type',
        source: 'cool-src',
        userId: 'user-cool',
      });
      const result2 = await trigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(false);
    });

    it('should return existing incidentId when auto-merge is enabled during cooldown', async () => {
      const mergeTrigger = new IncidentTrigger({
        autoMerge: { enabled: true, windowMinutes: 30 },
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      mergeTrigger.registerIncidentCreator(async () => ({ id: 'merge-inc-1' }));

      const defaultRules = mergeTrigger.getRules();
      for (const r of defaultRules) mergeTrigger.removeRule(r.id);

      mergeTrigger.addRule(
        createTestRule({
          id: 'merge-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'merge-type' }],
          priority: 100,
          cooldownSeconds: 300,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'mg-1',
        type: 'merge-type',
        userId: 'user-m',
      });
      const result1 = await mergeTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);
      expect(result1.incidentId).toBe('merge-inc-1');

      // Second alert during cooldown - should merge
      const alert2 = createTestAlert({
        alertId: 'mg-2',
        type: 'merge-type',
        userId: 'user-m',
      });
      const result2 = await mergeTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(false);
      expect(result2.incidentId).toBe('merge-inc-1');
      expect(result2.reason).toContain('Merged');

      mergeTrigger.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // Deduplication
  // --------------------------------------------------------------------------

  describe('Deduplication', () => {
    it('should deduplicate duplicate alerts within the dedup window', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'dedup-inc' }));

      trigger.addRule(
        createTestRule({
          id: 'dedup-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'dedup-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'dd-1',
        type: 'dedup-type',
        source: 'dedup-src',
        userId: 'user-dd',
        ipAddress: '1.2.3.4',
      });
      const result1 = await trigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      // Same hash fields: source, type, userId, ipAddress
      const alert2 = createTestAlert({
        alertId: 'dd-2',
        type: 'dedup-type',
        source: 'dedup-src',
        userId: 'user-dd',
        ipAddress: '1.2.3.4',
      });
      const result2 = await trigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(false);
      expect(result2.reason).toContain('Deduplicated');
    });
  });

  // --------------------------------------------------------------------------
  // Severity Escalation
  // --------------------------------------------------------------------------

  describe('Severity Escalation', () => {
    it('should escalate severity when alert count threshold is reached', async () => {
      let capturedSeverity: IncidentSeverity | undefined;
      const escalationTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 3,
          windowMinutes: 10,
        },
      });

      escalationTrigger.registerIncidentCreator(async (input) => {
        capturedSeverity = input.severity;
        return { id: 'esc-inc-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = escalationTrigger.getRules();
      for (const r of defaultRules) escalationTrigger.removeRule(r.id);

      escalationTrigger.addRule(
        createTestRule({
          id: 'esc-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'esc-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Send alerts to build up count
      for (let i = 0; i < 3; i++) {
        await escalationTrigger.processAlert(
          createTestAlert({
            alertId: `esc-${i}`,
            type: 'esc-type',
            source: `src-${i}`,
            userId: `user-esc-${i}`,
            ipAddress: `10.0.0.${i}`,
          })
        );
      }

      // NOTE: Source code escalation direction is inverted — severityOrder
      // ['P4','P3','P2','P1'] with currentIndex-1 goes toward P4 (lower severity).
      // P3 (index 1) → P4 (index 0). This documents the actual behavior.
      expect(capturedSeverity).toBe('P4');

      escalationTrigger.destroy();
    });

    it('should reset count after escalation window expires', async () => {
      const severities: IncidentSeverity[] = [];
      const windowTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 3,
          windowMinutes: 1, // 1 minute window
        },
      });

      windowTrigger.registerIncidentCreator(async (input) => {
        severities.push(input.severity);
        return { id: 'win-inc-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = windowTrigger.getRules();
      for (const r of defaultRules) windowTrigger.removeRule(r.id);

      windowTrigger.addRule(
        createTestRule({
          id: 'win-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'win-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Send 2 alerts (below threshold)
      for (let i = 0; i < 2; i++) {
        await windowTrigger.processAlert(
          createTestAlert({
            alertId: `win-pre-${i}`,
            type: 'win-type',
            source: `src-win-${i}`,
            userId: `user-win-${i}`,
            ipAddress: `10.1.0.${i}`,
          })
        );
      }

      // Advance time past window
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Send another alert - count should have reset
      await windowTrigger.processAlert(
        createTestAlert({
          alertId: 'win-post',
          type: 'win-type',
          source: 'src-win-post',
          userId: 'user-win-post',
          ipAddress: '10.1.0.99',
        })
      );

      // All severities should be P3 (no escalation since count reset)
      expect(severities.every((s) => s === 'P3')).toBe(true);

      windowTrigger.destroy();
    });

    it('should modify P1 severity when escalation triggers (inverted direction)', async () => {
      let capturedSeverity: IncidentSeverity | undefined;
      const p1Trigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 2,
          windowMinutes: 10,
        },
      });

      p1Trigger.registerIncidentCreator(async (input) => {
        capturedSeverity = input.severity;
        return { id: 'p1-inc-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = p1Trigger.getRules();
      for (const r of defaultRules) p1Trigger.removeRule(r.id);

      p1Trigger.addRule(
        createTestRule({
          id: 'p1-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'p1-type' }],
          incidentConfig: {
            type: 'data_breach' as IncidentType,
            severity: 'P1' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      for (let i = 0; i < 3; i++) {
        await p1Trigger.processAlert(
          createTestAlert({
            alertId: `p1-${i}`,
            type: 'p1-type',
            source: `src-p1-${i}`,
            userId: `user-p1-${i}`,
            ipAddress: `10.2.0.${i}`,
          })
        );
      }

      // NOTE: Source code has no guard for P1 being highest severity.
      // P1 (index 3) → currentIndex-1 → P2 (index 2). Documents actual behavior.
      expect(capturedSeverity).toBe('P2');

      p1Trigger.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // mapAlertSeverityToIncident
  // --------------------------------------------------------------------------

  describe('mapAlertSeverityToIncident', () => {
    it('should map critical to P1', () => {
      expect(trigger.mapAlertSeverityToIncident('critical')).toBe('P1');
    });

    it('should map error to P2', () => {
      expect(trigger.mapAlertSeverityToIncident('error')).toBe('P2');
    });

    it('should map warning to P3', () => {
      expect(trigger.mapAlertSeverityToIncident('warning')).toBe('P3');
    });

    it('should map info to P4', () => {
      expect(trigger.mapAlertSeverityToIncident('info')).toBe('P4');
    });
  });

  // --------------------------------------------------------------------------
  // selectPlaybook
  // --------------------------------------------------------------------------

  describe('selectPlaybook', () => {
    it('should return matching playbook for incident type', () => {
      const playbook = createTestPlaybook({
        id: 'pb-account',
        triggerConditions: [
          { field: 'type', operator: 'equals', value: 'account_compromise' },
        ],
        enabled: true,
      });

      trigger.registerPlaybooks([playbook]);
      const selected = trigger.selectPlaybook('account_compromise' as IncidentType, 'P2');
      expect(selected).toBeDefined();
      expect(selected!.id).toBe('pb-account');
    });

    it('should return undefined when no playbook matches', () => {
      trigger.registerPlaybooks([
        createTestPlaybook({
          id: 'pb-other',
          triggerConditions: [
            { field: 'type', operator: 'equals', value: 'malware' },
          ],
        }),
      ]);

      const selected = trigger.selectPlaybook('phishing' as IncidentType, 'P3');
      expect(selected).toBeUndefined();
    });

    it('should not return disabled playbooks', () => {
      trigger.registerPlaybooks([
        createTestPlaybook({
          id: 'pb-disabled',
          triggerConditions: [
            { field: 'type', operator: 'equals', value: 'account_compromise' },
          ],
          enabled: false,
        }),
      ]);

      const selected = trigger.selectPlaybook('account_compromise' as IncidentType, 'P2');
      expect(selected).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Event Emissions
  // --------------------------------------------------------------------------

  describe('Event Emissions', () => {
    it('should emit alert:received when processing an alert', async () => {
      const receivedPromise = new Promise<Alert>((resolve) => {
        trigger.on('alert:received', resolve);
      });

      const alert = createTestAlert();
      await trigger.processAlert(alert);

      const received = await receivedPromise;
      expect(received.alertId).toBe('alert-1');
    });

    it('should emit alert:matched when an alert matches a rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'ev-inc' }));

      const matchedPromise = new Promise<{ alert: Alert; rule: AlertRule }>((resolve) => {
        trigger.on('alert:matched', (alert: Alert, rule: AlertRule) => {
          resolve({ alert, rule });
        });
      });

      const alert = createTestAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
      });
      await trigger.processAlert(alert);

      const matched = await matchedPromise;
      expect(matched.alert.type).toBe('impossible-travel');
      expect(matched.rule).toBeDefined();
    });

    it('should emit incident:created when an incident is created', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'ev-created-inc' }));

      const createdPromise = new Promise<{ input: CreateIncidentInput; rule: AlertRule }>(
        (resolve) => {
          trigger.on('incident:created', (input: CreateIncidentInput, rule: AlertRule) => {
            resolve({ input, rule });
          });
        }
      );

      const alert = createTestAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        alertId: 'ev-alert',
      });
      await trigger.processAlert(alert);

      const created = await createdPromise;
      expect(created.input).toBeDefined();
      expect(created.rule).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Cleanup (destroy)
  // --------------------------------------------------------------------------

  describe('destroy', () => {
    it('should clean up intervals and maps without throwing', () => {
      const localTrigger = new IncidentTrigger();
      expect(() => localTrigger.destroy()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Mutation-Killing Tests
  // --------------------------------------------------------------------------

  describe('Mutation-killing: condition evaluation edge cases', () => {
    async function testConditionNegative(
      condition: AlertCondition,
      alertOverrides: Partial<Alert>
    ): Promise<void> {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'neg-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'neg-rule',
          conditions: [condition],
          conditionOperator: 'and',
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert(alertOverrides);
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      freshTrigger.destroy();
    }

    it('contains: should NOT match when field is not a string', async () => {
      await testConditionNegative(
        { field: 'rawData.score', operator: 'contains', value: '42' },
        { rawData: { score: 42 } }
      );
    });

    it('not_contains: should NOT match when field is not a string', async () => {
      await testConditionNegative(
        { field: 'rawData.score', operator: 'not_contains', value: '42' },
        { rawData: { score: 42 } }
      );
    });

    it('gt: should NOT match when field is not a number', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'gt', value: 50 },
        { type: 'not-a-number' }
      );
    });

    it('lt: should NOT match when field is not a number', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'lt', value: 50 },
        { type: 'not-a-number' }
      );
    });

    it('gte: should NOT match when field is not a number', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'gte', value: 50 },
        { type: 'not-a-number' }
      );
    });

    it('lte: should NOT match when field is not a number', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'lte', value: 50 },
        { type: 'not-a-number' }
      );
    });

    it('gt: should NOT match when equal (boundary)', async () => {
      await testConditionNegative(
        { field: 'rawData.score', operator: 'gt', value: 50 },
        { rawData: { score: 50 } }
      );
    });

    it('lt: should NOT match when equal (boundary)', async () => {
      await testConditionNegative(
        { field: 'rawData.score', operator: 'lt', value: 50 },
        { rawData: { score: 50 } }
      );
    });

    it('matches: should NOT match when field is not a string', async () => {
      await testConditionNegative(
        { field: 'rawData.score', operator: 'matches', value: '\\d+' },
        { rawData: { score: 42 } }
      );
    });

    it('in: should NOT match when value is not an array', async () => {
      await testConditionNegative(
        { field: 'severity', operator: 'in', value: 'critical' as any },
        { severity: 'critical' }
      );
    });

    it('not_in: should NOT match when value is not an array', async () => {
      await testConditionNegative(
        { field: 'severity', operator: 'not_in', value: 'critical' as any },
        { severity: 'info' }
      );
    });

    it('equals: negative test - different values', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'equals', value: 'expected' },
        { type: 'actual-different' }
      );
    });

    it('not_equals: negative test - same values', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'not_equals', value: 'same' },
        { type: 'same' }
      );
    });

    it('in: negative test - value not in array', async () => {
      await testConditionNegative(
        { field: 'severity', operator: 'in', value: ['critical', 'error'] },
        { severity: 'info' }
      );
    });

    it('not_in: negative test - value in array', async () => {
      await testConditionNegative(
        { field: 'severity', operator: 'not_in', value: ['critical', 'error'] },
        { severity: 'error' }
      );
    });

    it('exists: negative test - field is undefined', async () => {
      await testConditionNegative(
        { field: 'userId', operator: 'exists' },
        {}
      );
    });

    it('not_exists: negative test - field exists', async () => {
      await testConditionNegative(
        { field: 'userId', operator: 'not_exists' },
        { userId: 'user-present' }
      );
    });

    it('unknown operator should not match', async () => {
      await testConditionNegative(
        { field: 'type', operator: 'unknown_op' as any, value: 'test' },
        { type: 'test' }
      );
    });
  });

  describe('Mutation-killing: template substitution edge cases', () => {
    it('should substitute {{source}}, {{type}}, {{severity}}, {{alertId}} in templates', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'tmpl-inc-2' };
      });

      trigger.addRule(
        createTestRule({
          id: 'tmpl2-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'tmpl2-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{source}}/{{type}}/{{severity}}/{{alertId}}',
            descriptionTemplate: 'Source={{source}} Type={{type}}',
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'tmpl2-type',
        source: 'my-source',
        severity: 'critical',
        alertId: 'alert-xyz',
      });

      await trigger.processAlert(alert);

      expect(capturedInput).toBeDefined();
      expect(capturedInput!.title).toBe('my-source/tmpl2-type/critical/alert-xyz');
      expect(capturedInput!.description).toBe('Source=my-source Type=tmpl2-type');
    });

    it('should substitute {{userId}} and {{ipAddress}} when present', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'tmpl-inc-3' };
      });

      trigger.addRule(
        createTestRule({
          id: 'tmpl3-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'tmpl3-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: 'User:{{userId}} IP:{{ipAddress}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'tmpl3-type',
        userId: 'user-456',
        ipAddress: '192.168.1.1',
      });

      await trigger.processAlert(alert);

      expect(capturedInput!.title).toBe('User:user-456 IP:192.168.1.1');
    });
  });

  describe('Mutation-killing: buildIncidentInput metadata and tags', () => {
    it('should include alert metadata in incident input', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'meta-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'meta-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'meta-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P2' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
            tags: ['custom-tag', 'security'],
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        alertId: 'alert-meta',
        type: 'meta-type',
        source: 'meta-source',
        severity: 'error',
        rawData: { extra: 'info' },
      });

      await trigger.processAlert(alert);

      expect(capturedInput).toBeDefined();
      expect(capturedInput!.tags).toContain('custom-tag');
      expect(capturedInput!.tags).toContain('security');
      expect(capturedInput!.tags).toContain('source:meta-source');
      expect(capturedInput!.tags).toContain('alert:alert-meta');
      expect(capturedInput!.tags).toContain('rule:meta-rule');
      expect(capturedInput!.metadata).toBeDefined();
      expect(capturedInput!.metadata!.alertId).toBe('alert-meta');
      expect(capturedInput!.metadata!.alertSource).toBe('meta-source');
      expect(capturedInput!.metadata!.alertType).toBe('meta-type');
      expect(capturedInput!.metadata!.ruleId).toBe('meta-rule');
      expect(capturedInput!.metadata!.originalAlertSeverity).toBe('error');
    });

    it('should include autoAssignee when configured in rule', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'assign-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'assign-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'assign-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P2' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
            autoAssignee: 'security-team',
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'assign-type' });
      await trigger.processAlert(alert);

      expect(capturedInput!.assignee).toBe('security-team');
    });
  });

  describe('Mutation-killing: default rules fire correctly', () => {
    it('should match anomaly-impossible-travel rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'default-inc' }));

      const alert = createTestAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('should match anomaly-volume-spike rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'vol-inc' }));

      const alert = createTestAlert({
        source: 'anomaly_detector',
        type: 'volume-spike',
        severity: 'warning',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('should match data-exfiltration rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'exfil-inc' }));

      const alert = createTestAlert({
        type: 'data-exfiltration',
        severity: 'critical',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('should match malware-detected rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'mal-inc' }));

      const alert = createTestAlert({
        type: 'malware-found',
        severity: 'critical',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('should match ransomware-activity rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'ransom-inc' }));

      const alert = createTestAlert({
        type: 'ransomware',
        severity: 'critical',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('should match insider-threat-activity rule', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'insider-inc' }));

      const alert = createTestAlert({
        type: 'insider-activity',
        severity: 'warning',
      });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });
  });

  describe('Mutation-killing: incident creation error handling', () => {
    it('should handle incident creator throwing an error', async () => {
      trigger.registerIncidentCreator(async () => {
        throw new Error('Database down');
      });

      trigger.addRule(
        createTestRule({
          id: 'err-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'err-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'err-type' });
      const result = await trigger.processAlert(alert);

      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('Database down');
    });

    it('should handle incident creator throwing a non-Error', async () => {
      trigger.registerIncidentCreator(async () => {
        throw 'string failure';
      });

      trigger.addRule(
        createTestRule({
          id: 'str-err-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'str-err-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'str-err-type' });
      const result = await trigger.processAlert(alert);

      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('string failure');
    });
  });

  describe('Mutation-killing: deduplication time window boundary', () => {
    it('should NOT deduplicate when outside the dedup window', async () => {
      const dedupTrigger = new IncidentTrigger({
        deduplication: {
          enabled: true,
          windowMinutes: 1,
          hashFields: ['source', 'type'],
        },
      });
      dedupTrigger.registerIncidentCreator(async () => ({
        id: 'dedup-win-' + Math.random().toString(36).slice(2, 6),
      }));

      const defaultRules = dedupTrigger.getRules();
      for (const r of defaultRules) dedupTrigger.removeRule(r.id);

      dedupTrigger.addRule(
        createTestRule({
          id: 'dedup-time-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'dedup-time' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert1 = createTestAlert({ type: 'dedup-time', source: 'src-d' });
      const result1 = await dedupTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      // Advance past window
      vi.advanceTimersByTime(2 * 60 * 1000);

      const alert2 = createTestAlert({
        alertId: 'dedup-a2',
        type: 'dedup-time',
        source: 'src-d',
      });
      const result2 = await dedupTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(true); // Not deduplicated

      dedupTrigger.destroy();
    });
  });

  describe('Mutation-killing: cooldown with no autoMerge', () => {
    it('should return in cooldown without merge when autoMerge is disabled', async () => {
      const noMergeTrigger = new IncidentTrigger({
        autoMerge: { enabled: false, windowMinutes: 0 },
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      noMergeTrigger.registerIncidentCreator(async () => ({ id: 'no-merge-inc' }));

      const defaultRules = noMergeTrigger.getRules();
      for (const r of defaultRules) noMergeTrigger.removeRule(r.id);

      noMergeTrigger.addRule(
        createTestRule({
          id: 'no-merge-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'nm-type' }],
          priority: 100,
          cooldownSeconds: 600,
        })
      );

      const alert1 = createTestAlert({ type: 'nm-type', userId: 'user-nm' });
      const result1 = await noMergeTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      const alert2 = createTestAlert({ alertId: 'nm-a2', type: 'nm-type', userId: 'user-nm' });
      const result2 = await noMergeTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(false);
      expect(result2.reason).toBe('In cooldown period');
      expect(result2.incidentId).toBeUndefined();

      noMergeTrigger.destroy();
    });
  });

  describe('Mutation-killing: getFieldValue nested path', () => {
    it('should return undefined for deeply nested null path', async () => {
      const freshTrigger = new IncidentTrigger({ deduplication: { enabled: false, windowMinutes: 0, hashFields: [] } });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'deep-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'deep-rule',
          conditions: [{ field: 'rawData.nested.deep', operator: 'equals', value: 'found' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // rawData.nested is null
      const alert = createTestAlert({ rawData: { nested: null } });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);

      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: severity escalation boundary', () => {
    it('should NOT escalate when count is below threshold', async () => {
      const severities: IncidentSeverity[] = [];
      const belowTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 5,
          windowMinutes: 10,
        },
      });

      belowTrigger.registerIncidentCreator(async (input) => {
        severities.push(input.severity);
        return { id: 'below-inc-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = belowTrigger.getRules();
      for (const r of defaultRules) belowTrigger.removeRule(r.id);

      belowTrigger.addRule(
        createTestRule({
          id: 'below-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'below-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Send 4 alerts (below threshold of 5)
      for (let i = 0; i < 4; i++) {
        await belowTrigger.processAlert(
          createTestAlert({
            alertId: `below-${i}`,
            type: 'below-type',
            source: `src-below-${i}`,
            userId: `user-below-${i}`,
            ipAddress: `10.3.0.${i}`,
          })
        );
      }

      // All should be P3 (no escalation)
      expect(severities.every((s) => s === 'P3')).toBe(true);

      belowTrigger.destroy();
    });
  });

  describe('Mutation-killing: registerPlaybooks', () => {
    it('should register multiple playbooks', () => {
      const pb1 = createTestPlaybook({
        id: 'pb-reg-1',
        triggerConditions: [{ field: 'type', operator: 'equals', value: 'account_compromise' }],
      });
      const pb2 = createTestPlaybook({
        id: 'pb-reg-2',
        triggerConditions: [{ field: 'type', operator: 'equals', value: 'data_breach' }],
      });

      trigger.registerPlaybooks([pb1, pb2]);

      const selected1 = trigger.selectPlaybook('account_compromise' as IncidentType, 'P2');
      expect(selected1).toBeDefined();
      expect(selected1!.id).toBe('pb-reg-1');

      const selected2 = trigger.selectPlaybook('data_breach' as IncidentType, 'P1');
      expect(selected2).toBeDefined();
      expect(selected2!.id).toBe('pb-reg-2');
    });
  });

  // --------------------------------------------------------------------------
  // Additional Mutation-Killing Tests (batch 2)
  // --------------------------------------------------------------------------

  describe('Mutation-killing: default config exact values', () => {
    it('should have enabled=true by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.enabled).toBe(true);
    });

    it('should have defaultCooldownSeconds=300 by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.defaultCooldownSeconds).toBe(300);
    });

    it('should have deduplication.enabled=true by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.deduplication.enabled).toBe(true);
    });

    it('should have deduplication.windowMinutes=15 by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.deduplication.windowMinutes).toBe(15);
    });

    it('should have deduplication.hashFields = [source, type, userId, ipAddress]', () => {
      const cfg = (trigger as any).config;
      expect(cfg.deduplication.hashFields).toEqual(['source', 'type', 'userId', 'ipAddress']);
    });

    it('should have autoMerge.enabled=true by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.autoMerge.enabled).toBe(true);
    });

    it('should have autoMerge.windowMinutes=30 by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.autoMerge.windowMinutes).toBe(30);
    });

    it('should have severityEscalation.enabled=true by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.severityEscalation.enabled).toBe(true);
    });

    it('should have severityEscalation.alertCountThreshold=5 by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.severityEscalation.alertCountThreshold).toBe(5);
    });

    it('should have severityEscalation.windowMinutes=10 by default', () => {
      const cfg = (trigger as any).config;
      expect(cfg.severityEscalation.windowMinutes).toBe(10);
    });
  });

  describe('Mutation-killing: evaluateConditions with empty conditions returns false', () => {
    it('should not match a rule with empty conditions array', async () => {
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'empty-cond-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'empty-cond-rule',
          conditions: [], // Empty conditions
          conditionOperator: 'and',
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'anything' });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      freshTrigger.destroy();
    });

    it('should not match a rule with empty conditions using OR operator', async () => {
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'empty-or-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'empty-or-rule',
          conditions: [],
          conditionOperator: 'or',
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'anything' });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: disabled rules are skipped', () => {
    it('should not match a disabled rule even if conditions match', async () => {
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async () => ({ id: 'disabled-inc' }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'disabled-rule',
          enabled: false,
          conditions: [{ field: 'type', operator: 'equals', value: 'target-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'target-type' });
      const result = await freshTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toBe('No matching rule');
      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: cooldown key includes userId and ipAddress', () => {
    it('should not trigger cooldown for different users on same rule', async () => {
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async () => ({
        id: 'cd-inc-' + Math.random().toString(36).slice(2, 6),
      }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'cd-user-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'cd-type' }],
          priority: 100,
          cooldownSeconds: 600,
        })
      );

      // Alert from user-A
      const alert1 = createTestAlert({
        alertId: 'cd-u1',
        type: 'cd-type',
        userId: 'user-A',
        ipAddress: '10.0.0.1',
      });
      const result1 = await freshTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      // Alert from user-B (different user) — should NOT be in cooldown
      const alert2 = createTestAlert({
        alertId: 'cd-u2',
        type: 'cd-type',
        userId: 'user-B',
        ipAddress: '10.0.0.2',
      });
      const result2 = await freshTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(true);

      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: cooldown with zero cooldownSeconds', () => {
    it('should not enforce cooldown when cooldownSeconds=0', async () => {
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async () => ({
        id: 'zero-cd-' + Math.random().toString(36).slice(2, 6),
      }));

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'zero-cd-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'zero-cd-type' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'zc1',
        type: 'zero-cd-type',
        userId: 'same-user',
      });
      const result1 = await freshTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      const alert2 = createTestAlert({
        alertId: 'zc2',
        type: 'zero-cd-type',
        userId: 'same-user',
      });
      const result2 = await freshTrigger.processAlert(alert2);
      // No cooldown, so should still create (may dedup but we disabled that)
      expect(result2.incidentCreated).toBe(true);

      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: alert hash computation', () => {
    it('should produce same hash for alerts with same hash fields', async () => {
      // Access private method via type assertion
      const freshTrigger = new IncidentTrigger({
        deduplication: {
          enabled: true,
          windowMinutes: 15,
          hashFields: ['source', 'type'],
        },
      });

      const calcHash = (freshTrigger as any).calculateAlertHash.bind(freshTrigger);

      const alert1 = createTestAlert({ source: 'src-x', type: 'type-y' });
      const alert2 = createTestAlert({ source: 'src-x', type: 'type-y', alertId: 'different' });
      const alert3 = createTestAlert({ source: 'src-z', type: 'type-y' });

      const hash1 = calcHash(alert1);
      const hash2 = calcHash(alert2);
      const hash3 = calcHash(alert3);

      // Same hash fields => same hash
      expect(hash1).toBe(hash2);
      // Different source => different hash
      expect(hash1).not.toBe(hash3);

      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: template {{resource}} substitution', () => {
    it('should substitute {{resource}} when alert has a resource', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'res-tmpl-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'res-tmpl-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'res-tmpl-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: 'Resource: {{resource}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'res-tmpl-type',
        resource: 'api:/v1/users',
      });

      await trigger.processAlert(alert);

      expect(capturedInput!.title).toBe('Resource: api:/v1/users');
    });
  });

  describe('Mutation-killing: incident status set to detected', () => {
    it('should set incident status to detected', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'status-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'status-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'status-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'status-type' });
      await trigger.processAlert(alert);

      expect(capturedInput!.status).toBe('detected');
    });
  });

  describe('Mutation-killing: playbook field in incident input', () => {
    it('should include playbookId from rule in incident input', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'pb-field-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'pb-field-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'pb-field-type' }],
          playbookId: 'playbook-custom-v1',
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'pb-field-type' });
      await trigger.processAlert(alert);

      expect(capturedInput!.playbook).toBe('playbook-custom-v1');
    });

    it('should set playbook to undefined when rule has no playbookId', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'no-pb-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'no-pb-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'no-pb-type' }],
          // No playbookId
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'no-pb-type' });
      await trigger.processAlert(alert);

      expect(capturedInput!.playbook).toBeUndefined();
    });
  });

  describe('Mutation-killing: createIncidentTrigger factory', () => {
    it('should create a working trigger via factory function', async () => {
      const { createIncidentTrigger } = await import('../triggers.js');
      const factoryTrigger = createIncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });

      factoryTrigger.registerIncidentCreator(async () => ({ id: 'factory-inc' }));

      const defaultRules = factoryTrigger.getRules();
      for (const r of defaultRules) factoryTrigger.removeRule(r.id);

      factoryTrigger.addRule(
        createTestRule({
          id: 'factory-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'factory-type' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'factory-type' });
      const result = await factoryTrigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);

      factoryTrigger.destroy();
    });
  });

  describe('Mutation-killing: severity escalation exact threshold boundary', () => {
    it('should NOT escalate at count = threshold - 1', async () => {
      const severities: IncidentSeverity[] = [];
      const thresholdTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 3,
          windowMinutes: 10,
        },
      });

      thresholdTrigger.registerIncidentCreator(async (input) => {
        severities.push(input.severity);
        return { id: 'thresh-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = thresholdTrigger.getRules();
      for (const r of defaultRules) thresholdTrigger.removeRule(r.id);

      thresholdTrigger.addRule(
        createTestRule({
          id: 'thresh-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'thresh-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Send exactly 2 alerts (threshold=3, so 2 should not escalate)
      for (let i = 0; i < 2; i++) {
        await thresholdTrigger.processAlert(
          createTestAlert({
            alertId: `thresh-${i}`,
            type: 'thresh-type',
            source: `src-thresh-${i}`,
            userId: `user-thresh-${i}`,
            ipAddress: `10.5.0.${i}`,
          })
        );
      }

      // All should be P3 (no escalation below threshold)
      expect(severities).toEqual(['P3', 'P3']);

      thresholdTrigger.destroy();
    });

    it('should escalate at exactly the threshold count', async () => {
      let lastSeverity: IncidentSeverity | undefined;
      const exactTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 3,
          windowMinutes: 10,
        },
      });

      exactTrigger.registerIncidentCreator(async (input) => {
        lastSeverity = input.severity;
        return { id: 'exact-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = exactTrigger.getRules();
      for (const r of defaultRules) exactTrigger.removeRule(r.id);

      exactTrigger.addRule(
        createTestRule({
          id: 'exact-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'exact-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      // Send exactly 3 alerts (meets threshold)
      for (let i = 0; i < 3; i++) {
        await exactTrigger.processAlert(
          createTestAlert({
            alertId: `exact-${i}`,
            type: 'exact-type',
            source: `src-exact-${i}`,
            userId: `user-exact-${i}`,
            ipAddress: `10.6.0.${i}`,
          })
        );
      }

      // Third alert should be escalated
      expect(lastSeverity).not.toBe('P3');

      exactTrigger.destroy();
    });
  });

  describe('Mutation-killing: severity escalation disabled', () => {
    it('should NOT escalate when severityEscalation.enabled=false', async () => {
      const severities: IncidentSeverity[] = [];
      const noEscTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
        severityEscalation: {
          enabled: false,
          alertCountThreshold: 2,
          windowMinutes: 10,
        },
      });

      noEscTrigger.registerIncidentCreator(async (input) => {
        severities.push(input.severity);
        return { id: 'noesc-' + Math.random().toString(36).slice(2, 6) };
      });

      const defaultRules = noEscTrigger.getRules();
      for (const r of defaultRules) noEscTrigger.removeRule(r.id);

      noEscTrigger.addRule(
        createTestRule({
          id: 'noesc-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'noesc-type' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P3' as IncidentSeverity,
            titleTemplate: '{{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      for (let i = 0; i < 5; i++) {
        await noEscTrigger.processAlert(
          createTestAlert({
            alertId: `noesc-${i}`,
            type: 'noesc-type',
            source: `src-noesc-${i}`,
            userId: `user-noesc-${i}`,
            ipAddress: `10.7.0.${i}`,
          })
        );
      }

      // All should remain P3 since escalation is disabled
      expect(severities.every((s) => s === 'P3')).toBe(true);

      noEscTrigger.destroy();
    });
  });

  describe('Mutation-killing: deduplication disabled', () => {
    it('should NOT deduplicate when deduplication.enabled=false', async () => {
      const noDedupTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 15, hashFields: ['source', 'type'] },
      });
      noDedupTrigger.registerIncidentCreator(async () => ({
        id: 'nodedup-' + Math.random().toString(36).slice(2, 6),
      }));

      const defaultRules = noDedupTrigger.getRules();
      for (const r of defaultRules) noDedupTrigger.removeRule(r.id);

      noDedupTrigger.addRule(
        createTestRule({
          id: 'nodedup-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'nodedup-type' }],
          priority: 100,
          cooldownSeconds: 0,
        })
      );

      const alert1 = createTestAlert({ type: 'nodedup-type', source: 'same-src' });
      const result1 = await noDedupTrigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      const alert2 = createTestAlert({
        alertId: 'nodedup-a2',
        type: 'nodedup-type',
        source: 'same-src',
      });
      const result2 = await noDedupTrigger.processAlert(alert2);
      expect(result2.incidentCreated).toBe(true); // Not deduplicated

      noDedupTrigger.destroy();
    });
  });

  describe('Mutation-killing: alert:deduplicated event', () => {
    it('should emit alert:deduplicated with alert and existing incident ID', async () => {
      trigger.registerIncidentCreator(async () => ({ id: 'dedup-evt-inc' }));

      trigger.addRule(
        createTestRule({
          id: 'dedup-evt-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'dedup-evt-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'de1',
        type: 'dedup-evt-type',
        source: 'dedup-evt-src',
        userId: 'dedup-evt-user',
        ipAddress: '1.1.1.1',
      });
      await trigger.processAlert(alert1);

      const dedupPromise = new Promise<{ alert: Alert; incidentId: string }>((resolve) => {
        trigger.on('alert:deduplicated', (alert: Alert, incidentId: string) => {
          resolve({ alert, incidentId });
        });
      });

      const alert2 = createTestAlert({
        alertId: 'de2',
        type: 'dedup-evt-type',
        source: 'dedup-evt-src',
        userId: 'dedup-evt-user',
        ipAddress: '1.1.1.1',
      });
      await trigger.processAlert(alert2);
      const deduped = await dedupPromise;

      expect(deduped.alert.alertId).toBe('de2');
      expect(deduped.incidentId).toBe('dedup-evt-inc');
    });
  });

  describe('Mutation-killing: incident:merged event', () => {
    it('should emit incident:merged during cooldown with autoMerge enabled', async () => {
      const mergeTrigger = new IncidentTrigger({
        autoMerge: { enabled: true, windowMinutes: 30 },
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      mergeTrigger.registerIncidentCreator(async () => ({ id: 'merged-evt-inc' }));

      const defaultRules = mergeTrigger.getRules();
      for (const r of defaultRules) mergeTrigger.removeRule(r.id);

      mergeTrigger.addRule(
        createTestRule({
          id: 'merged-evt-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'merged-evt-type' }],
          priority: 100,
          cooldownSeconds: 600,
        })
      );

      const alert1 = createTestAlert({
        alertId: 'me1',
        type: 'merged-evt-type',
        userId: 'merge-user',
      });
      await mergeTrigger.processAlert(alert1);

      const mergedPromise = new Promise<{ alertId: string; incidentId: string }>((resolve) => {
        mergeTrigger.on('incident:merged', (alertId: string, incidentId: string) => {
          resolve({ alertId, incidentId });
        });
      });

      const alert2 = createTestAlert({
        alertId: 'me2',
        type: 'merged-evt-type',
        userId: 'merge-user',
      });
      await mergeTrigger.processAlert(alert2);
      const merged = await mergedPromise;

      expect(merged.alertId).toBe('me2');
      expect(merged.incidentId).toBe('merged-evt-inc');

      mergeTrigger.destroy();
    });
  });

  describe('Mutation-killing: rule priority ordering', () => {
    it('should match highest priority rule when multiple rules match', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      const freshTrigger = new IncidentTrigger({
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });
      freshTrigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'prio-inc' };
      });

      const defaultRules = freshTrigger.getRules();
      for (const r of defaultRules) freshTrigger.removeRule(r.id);

      freshTrigger.addRule(
        createTestRule({
          id: 'low-prio-rule',
          conditions: [{ field: 'type', operator: 'contains', value: 'prio' }],
          incidentConfig: {
            type: 'account_compromise' as IncidentType,
            severity: 'P4' as IncidentSeverity,
            titleTemplate: 'Low: {{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 10,
          cooldownSeconds: 0,
        })
      );

      freshTrigger.addRule(
        createTestRule({
          id: 'high-prio-rule',
          conditions: [{ field: 'type', operator: 'contains', value: 'prio' }],
          incidentConfig: {
            type: 'data_breach' as IncidentType,
            severity: 'P1' as IncidentSeverity,
            titleTemplate: 'High: {{title}}',
            descriptionTemplate: '{{description}}',
          },
          priority: 90,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({ type: 'prio-test' });
      await freshTrigger.processAlert(alert);

      // Should match high priority rule
      expect(capturedInput!.severity).toBe('P1');
      expect(capturedInput!.title).toContain('High:');

      freshTrigger.destroy();
    });
  });

  describe('Mutation-killing: affected resources edge cases', () => {
    it('should have empty affectedResources when alert has no userId, ipAddress, or resource', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'no-res-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'no-res-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'no-res-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'no-res-type',
        // No userId, ipAddress, or resource
      });
      await trigger.processAlert(alert);

      expect(capturedInput!.affectedResources).toEqual([]);
    });
  });

  describe('Mutation-killing: detectedAt from alert timestamp', () => {
    it('should set detectedAt to the alert timestamp', async () => {
      let capturedInput: CreateIncidentInput | undefined;
      const specificDate = new Date('2026-01-15T10:30:00Z');
      trigger.registerIncidentCreator(async (input) => {
        capturedInput = input;
        return { id: 'time-inc' };
      });

      trigger.addRule(
        createTestRule({
          id: 'time-rule',
          conditions: [{ field: 'type', operator: 'equals', value: 'time-type' }],
          priority: 999,
          cooldownSeconds: 0,
        })
      );

      const alert = createTestAlert({
        type: 'time-type',
        timestamp: specificDate,
      });
      await trigger.processAlert(alert);

      expect(capturedInput!.detectedAt).toBe(specificDate);
    });
  });
});
