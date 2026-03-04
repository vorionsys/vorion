/**
 * Test Data Factories
 *
 * Provides factory functions for creating test data with sensible defaults.
 * All factories return valid data that can be customized via overrides.
 */

import { randomUUID } from 'node:crypto';
import type { Intent, IntentStatus, TrustLevel, ControlAction } from '../../src/common/types.js';
import { TEST_TENANT_ID, TEST_USER_ID, TEST_ENTITY_ID } from './setup.js';

/**
 * Counter for generating unique sequential IDs
 */
let counter = 0;

function nextId(): string {
  return randomUUID();
}

function nextCounter(): number {
  return ++counter;
}

/**
 * Reset factory counters (call in beforeEach)
 */
export function resetFactories(): void {
  counter = 0;
}

// =============================================================================
// TENANT FACTORIES
// =============================================================================

export interface TenantData {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'inactive';
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * TenantFactory - Creates test tenant data
 */
export class TenantFactory {
  private static counter = 0;

  static create(overrides: Partial<TenantData> = {}): TenantData {
    const n = ++TenantFactory.counter;
    return {
      id: overrides.id ?? `test-tenant-${n}`,
      name: overrides.name ?? `Test Tenant ${n}`,
      status: overrides.status ?? 'active',
      settings: overrides.settings ?? { maxIntents: 1000, trustGate: 0 },
      metadata: overrides.metadata ?? { createdBy: 'test' },
    };
  }

  static createMany(count: number, overridesFn?: (index: number) => Partial<TenantData>): TenantData[] {
    return Array.from({ length: count }, (_, i) =>
      TenantFactory.create(overridesFn?.(i) ?? {})
    );
  }

  static reset(): void {
    TenantFactory.counter = 0;
  }
}

// =============================================================================
// USER FACTORIES
// =============================================================================

export interface UserData {
  id: string;
  tenantId: string;
  email?: string;
  roles: string[];
  groups: string[];
}

/**
 * UserFactory - Creates test user data
 */
export class UserFactory {
  private static counter = 0;

  static create(overrides: Partial<UserData> = {}): UserData {
    const n = ++UserFactory.counter;
    return {
      id: overrides.id ?? nextId(),
      tenantId: overrides.tenantId ?? TEST_TENANT_ID,
      email: overrides.email ?? `user${n}@test.example.com`,
      roles: overrides.roles ?? ['user'],
      groups: overrides.groups ?? [],
    };
  }

  static createAdmin(overrides: Partial<UserData> = {}): UserData {
    return UserFactory.create({
      roles: ['admin', 'user'],
      ...overrides,
    });
  }

  static createPolicyWriter(overrides: Partial<UserData> = {}): UserData {
    return UserFactory.create({
      roles: ['policy_writer', 'user'],
      ...overrides,
    });
  }

  static createPolicyReader(overrides: Partial<UserData> = {}): UserData {
    return UserFactory.create({
      roles: ['policy_reader', 'user'],
      ...overrides,
    });
  }

  static createEscalationApprover(overrides: Partial<UserData> = {}): UserData {
    return UserFactory.create({
      roles: ['escalation_approver', 'user'],
      ...overrides,
    });
  }

  static createMany(count: number, overridesFn?: (index: number) => Partial<UserData>): UserData[] {
    return Array.from({ length: count }, (_, i) =>
      UserFactory.create(overridesFn?.(i) ?? {})
    );
  }

  static reset(): void {
    UserFactory.counter = 0;
  }
}

// =============================================================================
// INTENT FACTORIES
// =============================================================================

export interface IntentSubmissionData {
  entityId: string;
  goal: string;
  context: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  intentType?: string;
  priority?: number;
  idempotencyKey?: string;
}

/**
 * IntentFactory - Creates test intent data
 */
export class IntentFactory {
  private static counter = 0;

  static createSubmission(overrides: Partial<IntentSubmissionData> = {}): IntentSubmissionData {
    const n = ++IntentFactory.counter;
    return {
      entityId: overrides.entityId ?? TEST_ENTITY_ID,
      goal: overrides.goal ?? `Test goal ${n}`,
      context: overrides.context ?? { action: `test-action-${n}`, target: 'test-target' },
      metadata: overrides.metadata ?? { source: 'test' },
      intentType: overrides.intentType ?? 'test',
      priority: overrides.priority ?? 0,
      idempotencyKey: overrides.idempotencyKey,
    };
  }

  static createHighRisk(overrides: Partial<IntentSubmissionData> = {}): IntentSubmissionData {
    return IntentFactory.createSubmission({
      intentType: 'high_risk',
      goal: 'Delete all user data',
      context: {
        action: 'data_deletion',
        scope: 'all',
        irreversible: true,
      },
      priority: 10,
      ...overrides,
    });
  }

  static createMany(
    count: number,
    overridesFn?: (index: number) => Partial<IntentSubmissionData>
  ): IntentSubmissionData[] {
    return Array.from({ length: count }, (_, i) =>
      IntentFactory.createSubmission(overridesFn?.(i) ?? {})
    );
  }

  static createBulkRequest(
    count: number,
    options?: {
      stopOnError?: boolean;
      overridesFn?: (index: number) => Partial<IntentSubmissionData>;
    }
  ): { intents: IntentSubmissionData[]; options?: { stopOnError?: boolean } } {
    return {
      intents: IntentFactory.createMany(count, options?.overridesFn),
      options: options?.stopOnError !== undefined ? { stopOnError: options.stopOnError } : undefined,
    };
  }

  static reset(): void {
    IntentFactory.counter = 0;
  }
}

/**
 * Create intent submission data (alias for backwards compatibility)
 */
export function createIntentSubmission(
  overrides: Partial<IntentSubmissionData> = {}
): IntentSubmissionData {
  return IntentFactory.createSubmission(overrides);
}

/**
 * Create a high-risk intent submission
 */
export function createHighRiskIntentSubmission(
  overrides: Partial<IntentSubmissionData> = {}
): IntentSubmissionData {
  return IntentFactory.createHighRisk(overrides);
}

/**
 * Create intent data as it would appear in the database
 */
export function createIntentData(
  tenantId: string,
  overrides: Partial<Intent> = {}
): Omit<Intent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } {
  const n = nextCounter();
  return {
    id: overrides.id ?? nextId(),
    tenantId,
    entityId: overrides.entityId ?? nextId(),
    goal: overrides.goal ?? `Test goal ${n}`,
    intentType: overrides.intentType ?? 'test',
    context: overrides.context ?? { action: `test-action-${n}` },
    metadata: overrides.metadata ?? {},
    priority: overrides.priority ?? 0,
    status: overrides.status ?? 'pending',
    trustSnapshot: overrides.trustSnapshot ?? null,
    trustLevel: overrides.trustLevel ?? null,
    trustScore: overrides.trustScore ?? null,
    deletedAt: overrides.deletedAt ?? null,
    cancellationReason: overrides.cancellationReason ?? null,
  };
}

// =============================================================================
// ESCALATION FACTORIES
// =============================================================================

export interface EscalationData {
  id?: string;
  intentId: string;
  tenantId: string;
  reason: string;
  reasonCategory: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review' | 'constraint_escalate';
  escalatedTo: string;
  escalatedBy?: string;
  status: 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'timeout' | 'cancelled';
  timeout: string;
  timeoutAt: Date;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Create escalation data
 */
export function createEscalationData(
  intentId: string,
  tenantId: string,
  overrides: Partial<EscalationData> = {}
): EscalationData {
  const timeoutAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  return {
    id: overrides.id ?? nextId(),
    intentId,
    tenantId,
    reason: overrides.reason ?? 'Requires human approval',
    reasonCategory: overrides.reasonCategory ?? 'manual_review',
    escalatedTo: overrides.escalatedTo ?? 'governance-team',
    escalatedBy: overrides.escalatedBy,
    status: overrides.status ?? 'pending',
    timeout: overrides.timeout ?? 'PT1H',
    timeoutAt: overrides.timeoutAt ?? timeoutAt,
    context: overrides.context ?? {},
    metadata: overrides.metadata ?? {},
  };
}

// =============================================================================
// POLICY FACTORIES
// =============================================================================

export interface PolicyDefinition {
  version: '1.0';
  target?: {
    intentTypes?: string[];
    entityTypes?: string[];
    trustLevels?: number[];
    namespaces?: string[];
  };
  rules: Array<{
    id: string;
    name: string;
    description?: string;
    priority: number;
    enabled: boolean;
    when: Record<string, unknown>;
    then: {
      action: ControlAction;
      reason?: string;
      escalation?: {
        to: string;
        timeout: string;
        requireJustification?: boolean;
        autoDenyOnTimeout?: boolean;
      };
      constraints?: Record<string, unknown>;
    };
  }>;
  defaultAction: ControlAction;
  defaultReason?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyData {
  name: string;
  namespace?: string;
  description?: string;
  definition: PolicyDefinition;
  metadata?: Record<string, unknown>;
}

/**
 * PolicyFactory - Creates test policy data
 */
export class PolicyFactory {
  private static counter = 0;

  static createAllow(overrides: Partial<PolicyData> = {}): PolicyData {
    const n = ++PolicyFactory.counter;
    return {
      name: overrides.name ?? `Allow Policy ${n}`,
      namespace: overrides.namespace ?? 'default',
      description: overrides.description ?? 'A policy that allows all intents',
      definition: overrides.definition ?? {
        version: '1.0',
        rules: [
          {
            id: `rule-allow-${n}`,
            name: 'Allow All',
            priority: 100,
            enabled: true,
            when: { type: 'field', field: 'intent.intentType', operator: 'exists', value: true },
            then: { action: 'allow', reason: 'Default allow' },
          },
        ],
        defaultAction: 'allow',
      },
      metadata: overrides.metadata ?? {},
    };
  }

  static createDeny(intentTypes: string[], overrides: Partial<PolicyData> = {}): PolicyData {
    const n = ++PolicyFactory.counter;
    return {
      name: overrides.name ?? `Deny Policy ${n}`,
      namespace: overrides.namespace ?? 'default',
      description: overrides.description ?? `A policy that denies ${intentTypes.join(', ')} intents`,
      definition: overrides.definition ?? {
        version: '1.0',
        rules: [
          {
            id: `rule-deny-${n}`,
            name: 'Deny Specific Types',
            priority: 10,
            enabled: true,
            when: { type: 'field', field: 'intent.intentType', operator: 'in', value: intentTypes },
            then: { action: 'deny', reason: 'Intent type not allowed' },
          },
        ],
        defaultAction: 'allow',
      },
      metadata: overrides.metadata ?? {},
    };
  }

  static createEscalation(intentTypes: string[], overrides: Partial<PolicyData> = {}): PolicyData {
    const n = ++PolicyFactory.counter;
    return {
      name: overrides.name ?? `Escalation Policy ${n}`,
      namespace: overrides.namespace ?? 'default',
      description: overrides.description ?? `A policy that escalates ${intentTypes.join(', ')} intents`,
      definition: overrides.definition ?? {
        version: '1.0',
        rules: [
          {
            id: `rule-escalate-${n}`,
            name: 'Escalate High Risk',
            priority: 10,
            enabled: true,
            when: { type: 'field', field: 'intent.intentType', operator: 'in', value: intentTypes },
            then: {
              action: 'escalate',
              reason: 'Requires human approval',
              escalation: {
                to: 'governance-team',
                timeout: 'PT1H',
                requireJustification: true,
                autoDenyOnTimeout: true,
              },
            },
          },
        ],
        defaultAction: 'allow',
      },
      metadata: overrides.metadata ?? {},
    };
  }

  static createTrustGated(minTrustLevel: TrustLevel, overrides: Partial<PolicyData> = {}): PolicyData {
    const n = ++PolicyFactory.counter;
    return {
      name: overrides.name ?? `Trust Gated Policy ${n}`,
      namespace: overrides.namespace ?? 'default',
      description: overrides.description ?? `Requires trust level ${minTrustLevel}+`,
      definition: overrides.definition ?? {
        version: '1.0',
        target: {
          trustLevels: [minTrustLevel, minTrustLevel + 1, minTrustLevel + 2, 4, 5].filter(l => l <= 5) as number[],
        },
        rules: [
          {
            id: `rule-trust-gate-${n}`,
            name: 'Trust Gate',
            priority: 1,
            enabled: true,
            when: {
              type: 'trust',
              level: minTrustLevel,
              operator: 'less_than',
            },
            then: {
              action: 'deny',
              reason: `Insufficient trust level (requires ${minTrustLevel}+)`,
            },
          },
        ],
        defaultAction: 'allow',
      },
      metadata: overrides.metadata ?? {},
    };
  }

  static createInvalid(): PolicyData {
    return {
      name: 'Invalid Policy',
      namespace: 'default',
      description: 'An invalid policy for testing validation',
      definition: {
        version: '1.0' as const,
        rules: [
          {
            id: '', // Invalid: empty ID
            name: '', // Invalid: empty name
            priority: -1, // Invalid: negative priority
            enabled: true,
            when: {}, // Invalid: empty condition
            then: { action: 'invalid' as ControlAction }, // Invalid action
          },
        ],
        defaultAction: 'invalid' as ControlAction, // Invalid action
      },
    };
  }

  static reset(): void {
    PolicyFactory.counter = 0;
  }
}

/**
 * Create a basic allow-all policy (alias for backwards compatibility)
 */
export function createAllowPolicy(overrides: Partial<PolicyData> = {}): PolicyData {
  return PolicyFactory.createAllow(overrides);
}

/**
 * Create a deny policy for specific intent types
 */
export function createDenyPolicy(
  intentTypes: string[],
  overrides: Partial<PolicyData> = {}
): PolicyData {
  return PolicyFactory.createDeny(intentTypes, overrides);
}

/**
 * Create an escalation policy
 */
export function createEscalationPolicy(
  intentTypes: string[],
  overrides: Partial<PolicyData> = {}
): PolicyData {
  return PolicyFactory.createEscalation(intentTypes, overrides);
}

/**
 * Create a trust-gated policy
 */
export function createTrustGatedPolicy(
  minTrustLevel: TrustLevel,
  overrides: Partial<PolicyData> = {}
): PolicyData {
  return PolicyFactory.createTrustGated(minTrustLevel, overrides);
}

// =============================================================================
// WEBHOOK FACTORIES
// =============================================================================

export interface WebhookData {
  url: string;
  secret?: string;
  events: string[];
  enabled?: boolean;
}

/**
 * Create webhook registration data
 */
export function createWebhookData(overrides: Partial<WebhookData> = {}): WebhookData {
  const n = nextCounter();
  return {
    url: overrides.url ?? `https://webhook.example.com/callback-${n}`,
    secret: overrides.secret ?? `webhook-secret-${n}-minimum-16-chars`,
    events: overrides.events ?? ['intent.approved', 'intent.denied', 'escalation.created'],
    enabled: overrides.enabled ?? true,
  };
}

// =============================================================================
// AUDIT FACTORIES
// =============================================================================

export interface AuditRecordData {
  eventType: string;
  eventCategory: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  actorType: string;
  actorId: string;
  targetType: string;
  targetId: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial';
  metadata?: Record<string, unknown>;
}

/**
 * Create audit record data
 */
export function createAuditRecordData(
  tenantId: string,
  overrides: Partial<AuditRecordData> = {}
): AuditRecordData & { tenantId: string } {
  const n = nextCounter();
  return {
    tenantId,
    eventType: overrides.eventType ?? `test.event.${n}`,
    eventCategory: overrides.eventCategory ?? 'intent',
    severity: overrides.severity ?? 'info',
    actorType: overrides.actorType ?? 'user',
    actorId: overrides.actorId ?? nextId(),
    targetType: overrides.targetType ?? 'intent',
    targetId: overrides.targetId ?? nextId(),
    action: overrides.action ?? 'create',
    outcome: overrides.outcome ?? 'success',
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Create user data for authentication (alias for backwards compatibility)
 */
export function createUserData(overrides: Partial<UserData> = {}): UserData {
  return UserFactory.create(overrides);
}

/**
 * Create admin user data
 */
export function createAdminUserData(overrides: Partial<UserData> = {}): UserData {
  return UserFactory.createAdmin(overrides);
}

/**
 * Create policy writer user data
 */
export function createPolicyWriterUserData(overrides: Partial<UserData> = {}): UserData {
  return UserFactory.createPolicyWriter(overrides);
}

// =============================================================================
// CONSTRAINT/RULE FACTORIES
// =============================================================================

export interface ConstraintRuleData {
  id: string;
  name: string;
  description?: string;
  priority?: number;
  enabled?: boolean;
  when: {
    intentType?: string | string[];
    entityType?: string | string[];
    conditions?: Array<{
      field: string;
      operator: string;
      value: unknown;
    }>;
  };
  evaluate: Array<{
    condition: string;
    result: ControlAction;
    reason?: string;
    escalation?: {
      to: string;
      timeout: string;
      requireJustification?: boolean;
      autoDenyOnTimeout?: boolean;
    };
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Create a constraint rule
 */
export function createConstraintRule(overrides: Partial<ConstraintRuleData> = {}): ConstraintRuleData {
  const n = nextCounter();
  return {
    id: overrides.id ?? `rule-${n}`,
    name: overrides.name ?? `Test Rule ${n}`,
    description: overrides.description ?? `A test constraint rule ${n}`,
    priority: overrides.priority ?? 100,
    enabled: overrides.enabled ?? true,
    when: overrides.when ?? { intentType: '*' },
    evaluate: overrides.evaluate ?? [
      { condition: 'true', result: 'allow', reason: 'Default allow' },
    ],
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Create a trust-based constraint rule
 */
export function createTrustConstraintRule(
  minTrustLevel: TrustLevel,
  overrides: Partial<ConstraintRuleData> = {}
): ConstraintRuleData {
  const n = nextCounter();
  return createConstraintRule({
    id: `trust-rule-${n}`,
    name: `Trust Level Gate ${n}`,
    description: `Requires trust level >= ${minTrustLevel}`,
    priority: 1,
    when: { intentType: '*' },
    evaluate: [
      {
        condition: `entity.trustLevel >= ${minTrustLevel}`,
        result: 'allow',
        reason: 'Trust level sufficient',
      },
      {
        condition: 'true',
        result: 'deny',
        reason: `Trust level insufficient (requires ${minTrustLevel}+)`,
      },
    ],
    ...overrides,
  });
}

// =============================================================================
// BULK DATA FACTORIES
// =============================================================================

/**
 * Create multiple intent submissions
 */
export function createIntentSubmissions(
  count: number,
  overridesFn?: (index: number) => Partial<IntentSubmissionData>
): IntentSubmissionData[] {
  return IntentFactory.createMany(count, overridesFn);
}

/**
 * Create bulk intent submission request body
 */
export function createBulkIntentRequest(
  count: number,
  options?: {
    stopOnError?: boolean;
    overridesFn?: (index: number) => Partial<IntentSubmissionData>;
  }
): { intents: IntentSubmissionData[]; options?: { stopOnError?: boolean } } {
  return IntentFactory.createBulkRequest(count, options);
}

// =============================================================================
// FACTORY RESET
// =============================================================================

/**
 * Reset all factory counters
 */
export function resetAllFactories(): void {
  counter = 0;
  TenantFactory.reset();
  UserFactory.reset();
  IntentFactory.reset();
  PolicyFactory.reset();
}
