import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IncidentTrigger,
  createIncidentTrigger,
  type IncidentTriggerConfig,
} from '../src/security/incident/triggers.js';
import type { Alert, AlertRule, CreateIncidentInput } from '../src/security/incident/types.js';
import { IncidentType, IncidentSeverity, IncidentStatus } from '../src/security/incident/types.js';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    alertId: `alert-${Date.now()}`,
    source: 'test',
    type: 'test-alert',
    severity: 'warning',
    title: 'Test Alert',
    description: 'A test alert description',
    timestamp: new Date(),
    ipAddress: '192.168.1.1',
    rawData: {},
    ...overrides,
  };
}

describe('IncidentTrigger', () => {
  let trigger: IncidentTrigger;

  afterEach(() => {
    if (trigger) {
      trigger.destroy();
    }
  });

  describe('constructor', () => {
    it('creates trigger with default config and default rules', () => {
      trigger = createIncidentTrigger();
      const rules = trigger.getRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('creates trigger with custom config', () => {
      trigger = createIncidentTrigger({
        enabled: false,
        defaultCooldownSeconds: 60,
      });
      expect(trigger).toBeInstanceOf(IncidentTrigger);
    });
  });

  describe('processAlert with triggers disabled', () => {
    it('returns incidentCreated=false when disabled', async () => {
      trigger = createIncidentTrigger({ enabled: false });
      const result = await trigger.processAlert(makeAlert());
      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('processAlert rule matching', () => {
    it('creates incident for anomaly impossible travel alert', async () => {
      trigger = createIncidentTrigger();
      let createdInput: CreateIncidentInput | null = null;
      trigger.registerIncidentCreator(async (input) => {
        createdInput = input;
        return { id: 'incident-1' };
      });

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
        title: 'Impossible travel detected',
        userId: 'user-123',
      });

      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
      expect(result.incidentId).toBe('incident-1');
      expect(createdInput).not.toBeNull();
      expect(createdInput!.type).toBe(IncidentType.ACCOUNT_COMPROMISE);
    });

    it('creates incident for volume spike alert', async () => {
      trigger = createIncidentTrigger();
      let createdInput: CreateIncidentInput | null = null;
      trigger.registerIncidentCreator(async (input) => {
        createdInput = input;
        return { id: 'incident-2' };
      });

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'volume-spike',
        severity: 'warning',
      });

      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
      expect(createdInput!.type).toBe(IncidentType.DENIAL_OF_SERVICE);
    });

    it('creates incident for data exfiltration alert', async () => {
      trigger = createIncidentTrigger();
      let createdInput: CreateIncidentInput | null = null;
      trigger.registerIncidentCreator(async (input) => {
        createdInput = input;
        return { id: 'incident-3' };
      });

      const alert = makeAlert({
        source: 'dlp',
        type: 'data-exfiltration',
        severity: 'critical',
      });

      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
      expect(createdInput!.severity).toBe('P1');
      expect(createdInput!.type).toBe(IncidentType.DATA_BREACH);
    });

    it('returns no incident for unmatched alert', async () => {
      trigger = createIncidentTrigger();
      trigger.registerIncidentCreator(async () => ({ id: 'unreachable' }));

      const alert = makeAlert({
        source: 'unknown',
        type: 'no-match',
        severity: 'info',
      });

      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('No matching rule');
    });
  });

  describe('deduplication', () => {
    it('deduplicates repeated alerts within window', async () => {
      trigger = createIncidentTrigger({
        deduplication: {
          enabled: true,
          windowMinutes: 15,
          hashFields: ['source', 'type', 'userId', 'ipAddress'],
        },
      });
      trigger.registerIncidentCreator(async () => ({ id: 'incident-dedup' }));

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
        userId: 'user-1',
        ipAddress: '10.0.0.1',
      });

      const result1 = await trigger.processAlert(alert);
      expect(result1.incidentCreated).toBe(true);

      // Same alert again - should be deduplicated
      const result2 = await trigger.processAlert(alert);
      expect(result2.incidentCreated).toBe(false);
      expect(result2.reason).toContain('Deduplicated');
    });
  });

  describe('cooldown', () => {
    it('respects cooldown period between incidents from same rule', async () => {
      trigger = createIncidentTrigger();
      trigger.registerIncidentCreator(async () => ({ id: `inc-${Date.now()}` }));

      // First alert
      const alert1 = makeAlert({
        alertId: 'alert-cd-1',
        source: 'anomaly_detector',
        type: 'volume-spike',
      });
      const result1 = await trigger.processAlert(alert1);
      expect(result1.incidentCreated).toBe(true);

      // Second alert within cooldown (but with different dedup hash)
      const alert2 = makeAlert({
        alertId: 'alert-cd-2',
        source: 'anomaly_detector',
        type: 'volume-spike',
        userId: 'different-user', // Different user to avoid dedup
      });
      const result2 = await trigger.processAlert(alert2);
      // Should be in cooldown or merged
      expect(result2.incidentCreated).toBe(false);
    });
  });

  describe('addRule / removeRule', () => {
    it('adds custom rule that matches alerts', async () => {
      trigger = createIncidentTrigger();
      trigger.registerIncidentCreator(async () => ({ id: 'custom-incident' }));

      const customRule: AlertRule = {
        id: 'custom-test-rule',
        name: 'Custom Test Rule',
        enabled: true,
        conditions: [
          { field: 'type', operator: 'equals', value: 'custom-event' },
        ],
        conditionOperator: 'and',
        incidentConfig: {
          type: IncidentType.OTHER,
          severity: 'P3',
          titleTemplate: 'Custom: {{title}}',
          descriptionTemplate: '{{description}}',
        },
        cooldownSeconds: 0,
        priority: 100,
      };

      trigger.addRule(customRule);

      const alert = makeAlert({ type: 'custom-event' });
      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(true);
    });

    it('removes rules', () => {
      trigger = createIncidentTrigger();
      const initialCount = trigger.getRules().length;

      trigger.removeRule('anomaly-impossible-travel');
      expect(trigger.getRules().length).toBe(initialCount - 1);
    });

    it('removeRule returns false for non-existent rule', () => {
      trigger = createIncidentTrigger();
      expect(trigger.removeRule('non-existent')).toBe(false);
    });
  });

  describe('getRules', () => {
    it('returns rules sorted by priority descending', () => {
      trigger = createIncidentTrigger();
      const rules = trigger.getRules();
      for (let i = 0; i < rules.length - 1; i++) {
        expect(rules[i]!.priority).toBeGreaterThanOrEqual(rules[i + 1]!.priority);
      }
    });
  });

  describe('mapAlertSeverityToIncident', () => {
    it('maps critical to P1', () => {
      trigger = createIncidentTrigger();
      expect(trigger.mapAlertSeverityToIncident('critical')).toBe('P1');
    });

    it('maps error to P2', () => {
      trigger = createIncidentTrigger();
      expect(trigger.mapAlertSeverityToIncident('error')).toBe('P2');
    });

    it('maps warning to P3', () => {
      trigger = createIncidentTrigger();
      expect(trigger.mapAlertSeverityToIncident('warning')).toBe('P3');
    });

    it('maps info to P4', () => {
      trigger = createIncidentTrigger();
      expect(trigger.mapAlertSeverityToIncident('info')).toBe('P4');
    });
  });

  describe('severity escalation', () => {
    it('escalates severity when alert count exceeds threshold', async () => {
      trigger = createIncidentTrigger({
        severityEscalation: {
          enabled: true,
          alertCountThreshold: 3,
          windowMinutes: 10,
        },
        deduplication: { enabled: false, windowMinutes: 0, hashFields: [] },
      });

      let lastSeverity: string | null = null;
      trigger.registerIncidentCreator(async (input) => {
        lastSeverity = input.severity;
        return { id: `inc-${Date.now()}-${Math.random()}` };
      });

      // Add a custom rule with zero cooldown for testing
      trigger.addRule({
        id: 'escalation-test-rule',
        name: 'Escalation Test',
        enabled: true,
        conditions: [
          { field: 'type', operator: 'equals', value: 'escalation-test' },
        ],
        conditionOperator: 'and',
        incidentConfig: {
          type: IncidentType.OTHER,
          severity: 'P3',
          titleTemplate: '{{title}}',
          descriptionTemplate: '{{description}}',
        },
        cooldownSeconds: 0,
        priority: 200,
      });

      // Send multiple alerts
      for (let i = 0; i < 4; i++) {
        await trigger.processAlert(makeAlert({
          alertId: `esc-${i}`,
          type: 'escalation-test',
          ipAddress: `10.0.0.${i}`, // Different IPs to avoid dedup
        }));
      }

      // After 3+ alerts, severity should have been escalated from P3 to P2
      expect(lastSeverity).toBe('P2');
    });
  });

  describe('no incident creator', () => {
    it('returns error when no creator registered', async () => {
      trigger = createIncidentTrigger();
      // Don't register a creator

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
      });

      const result = await trigger.processAlert(alert);
      expect(result.incidentCreated).toBe(false);
      expect(result.reason).toContain('No incident creator registered');
    });
  });

  describe('template substitution', () => {
    it('applies template with alert fields', async () => {
      trigger = createIncidentTrigger();
      let createdInput: CreateIncidentInput | null = null;
      trigger.registerIncidentCreator(async (input) => {
        createdInput = input;
        return { id: 'template-test' };
      });

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
        title: 'Suspicious login from Tokyo',
        description: 'User logged in from unexpected location',
      });

      await trigger.processAlert(alert);

      expect(createdInput).not.toBeNull();
      expect(createdInput!.title).toContain('Suspicious login from Tokyo');
    });
  });

  describe('affected resources tracking', () => {
    it('includes userId and ipAddress as affected resources', async () => {
      trigger = createIncidentTrigger();
      let createdInput: CreateIncidentInput | null = null;
      trigger.registerIncidentCreator(async (input) => {
        createdInput = input;
        return { id: 'resource-test' };
      });

      const alert = makeAlert({
        source: 'anomaly_detector',
        type: 'impossible-travel',
        severity: 'error',
        userId: 'user-42',
        ipAddress: '192.168.1.100',
        resource: '/api/sensitive',
      });

      await trigger.processAlert(alert);

      expect(createdInput!.affectedResources).toContain('user:user-42');
      expect(createdInput!.affectedResources).toContain('ip:192.168.1.100');
      expect(createdInput!.affectedResources).toContain('/api/sensitive');
    });
  });
});
