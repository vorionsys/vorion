/**
 * Security Policy Engine Types
 *
 * Type definitions for the flexible security policy engine including:
 * - Policy conditions (user, request, time, risk, resource attributes)
 * - Policy rules (MFA, approval, block, rate-limit, encryption, audit)
 * - Policy actions (allow, deny, challenge, notify, log, escalate, quarantine)
 * - Policy DSL schema
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// CONDITION OPERATORS
// =============================================================================

export const ConditionOperator = {
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  GREATER_THAN: 'greater_than',
  LESS_THAN: 'less_than',
  GREATER_THAN_OR_EQUAL: 'greater_than_or_equal',
  LESS_THAN_OR_EQUAL: 'less_than_or_equal',
  IN: 'in',
  NOT_IN: 'not_in',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
  MATCHES: 'matches',
  EXISTS: 'exists',
  NOT_EXISTS: 'not_exists',
  BETWEEN: 'between',
} as const;

export type ConditionOperator = (typeof ConditionOperator)[keyof typeof ConditionOperator];

export const conditionOperatorSchema = z.nativeEnum(ConditionOperator);

// =============================================================================
// LOGICAL OPERATORS
// =============================================================================

export const LogicalOperator = {
  AND: 'and',
  OR: 'or',
  NOT: 'not',
} as const;

export type LogicalOperator = (typeof LogicalOperator)[keyof typeof LogicalOperator];

export const logicalOperatorSchema = z.nativeEnum(LogicalOperator);

// =============================================================================
// CONDITION TYPES
// =============================================================================

export const ConditionType = {
  USER_ATTRIBUTE: 'user_attribute',
  REQUEST_ATTRIBUTE: 'request_attribute',
  TIME_BASED: 'time_based',
  RISK_BASED: 'risk_based',
  RESOURCE_ATTRIBUTE: 'resource_attribute',
  COMPOSITE: 'composite',
  CUSTOM: 'custom',
} as const;

export type ConditionType = (typeof ConditionType)[keyof typeof ConditionType];

export const conditionTypeSchema = z.nativeEnum(ConditionType);

// =============================================================================
// USER ATTRIBUTE CONDITION
// =============================================================================

/**
 * User attributes that can be evaluated
 */
export interface UserAttributeCondition {
  type: 'user_attribute';
  field: 'role' | 'department' | 'tenant' | 'groups' | 'permissions' | 'email_domain' | 'custom';
  customField?: string;
  operator: ConditionOperator;
  value: unknown;
}

export const userAttributeConditionSchema = z.object({
  type: z.literal('user_attribute'),
  field: z.enum(['role', 'department', 'tenant', 'groups', 'permissions', 'email_domain', 'custom']),
  customField: z.string().optional(),
  operator: conditionOperatorSchema,
  value: z.unknown(),
});

// =============================================================================
// REQUEST ATTRIBUTE CONDITION
// =============================================================================

/**
 * Request attributes that can be evaluated
 */
export interface RequestAttributeCondition {
  type: 'request_attribute';
  field: 'ip' | 'user_agent' | 'path' | 'method' | 'header' | 'query' | 'body' | 'origin' | 'referer' | 'custom';
  customField?: string;
  headerName?: string;
  queryParam?: string;
  bodyPath?: string;
  operator: ConditionOperator;
  value: unknown;
}

export const requestAttributeConditionSchema = z.object({
  type: z.literal('request_attribute'),
  field: z.enum(['ip', 'user_agent', 'path', 'method', 'header', 'query', 'body', 'origin', 'referer', 'custom']),
  customField: z.string().optional(),
  headerName: z.string().optional(),
  queryParam: z.string().optional(),
  bodyPath: z.string().optional(),
  operator: conditionOperatorSchema,
  value: z.unknown(),
});

// =============================================================================
// TIME-BASED CONDITION
// =============================================================================

/**
 * Time-based conditions
 */
export interface TimeBasedCondition {
  type: 'time_based';
  field: 'hour' | 'day_of_week' | 'date' | 'business_hours' | 'weekend' | 'holiday' | 'custom';
  /** Timezone for evaluation (default: UTC) */
  timezone?: string;
  /** Start hour for business hours (0-23) */
  startHour?: number;
  /** End hour for business hours (0-23) */
  endHour?: number;
  /** Days of week (0=Sunday, 6=Saturday) */
  daysOfWeek?: number[];
  /** Specific dates to match (ISO format) */
  dates?: string[];
  /** Holiday calendar ID */
  holidayCalendar?: string;
  operator: ConditionOperator;
  value: unknown;
}

export const timeBasedConditionSchema = z.object({
  type: z.literal('time_based'),
  field: z.enum(['hour', 'day_of_week', 'date', 'business_hours', 'weekend', 'holiday', 'custom']),
  timezone: z.string().optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dates: z.array(z.string()).optional(),
  holidayCalendar: z.string().optional(),
  operator: conditionOperatorSchema,
  value: z.unknown(),
});

// =============================================================================
// RISK-BASED CONDITION
// =============================================================================

/**
 * Risk-based conditions
 */
export interface RiskBasedCondition {
  type: 'risk_based';
  field: 'user_risk_score' | 'ip_reputation' | 'device_trust' | 'session_risk' | 'anomaly_score' | 'threat_level' | 'custom';
  customField?: string;
  operator: ConditionOperator;
  value: unknown;
  /** Optional threshold for numeric comparisons */
  threshold?: number;
}

export const riskBasedConditionSchema = z.object({
  type: z.literal('risk_based'),
  field: z.enum(['user_risk_score', 'ip_reputation', 'device_trust', 'session_risk', 'anomaly_score', 'threat_level', 'custom']),
  customField: z.string().optional(),
  operator: conditionOperatorSchema,
  value: z.unknown(),
  threshold: z.number().optional(),
});

// =============================================================================
// RESOURCE ATTRIBUTE CONDITION
// =============================================================================

/**
 * Resource attribute conditions
 */
export interface ResourceAttributeCondition {
  type: 'resource_attribute';
  field: 'sensitivity_level' | 'data_type' | 'classification' | 'owner' | 'department' | 'region' | 'tags' | 'custom';
  customField?: string;
  operator: ConditionOperator;
  value: unknown;
}

export const resourceAttributeConditionSchema = z.object({
  type: z.literal('resource_attribute'),
  field: z.enum(['sensitivity_level', 'data_type', 'classification', 'owner', 'department', 'region', 'tags', 'custom']),
  customField: z.string().optional(),
  operator: conditionOperatorSchema,
  value: z.unknown(),
});

// =============================================================================
// COMPOSITE CONDITION
// =============================================================================

/**
 * Forward declaration for recursive type
 */
export interface CompositeCondition {
  type: 'composite';
  operator: LogicalOperator;
  conditions: PolicyCondition[];
}

// Schema defined after PolicyCondition

// =============================================================================
// CUSTOM CONDITION
// =============================================================================

/**
 * Custom condition using expression
 */
export interface CustomCondition {
  type: 'custom';
  /** Custom expression (e.g., JSONPath, CEL, custom DSL) */
  expression: string;
  /** Expression language */
  language?: 'jsonpath' | 'cel' | 'jmespath' | 'custom';
  /** Additional parameters for evaluation */
  params?: Record<string, unknown>;
}

export const customConditionSchema = z.object({
  type: z.literal('custom'),
  expression: z.string().min(1),
  language: z.enum(['jsonpath', 'cel', 'jmespath', 'custom']).optional(),
  params: z.record(z.unknown()).optional(),
});

// =============================================================================
// POLICY CONDITION UNION
// =============================================================================

export type PolicyCondition =
  | UserAttributeCondition
  | RequestAttributeCondition
  | TimeBasedCondition
  | RiskBasedCondition
  | ResourceAttributeCondition
  | CompositeCondition
  | CustomCondition;

// Base condition schema without composite (to avoid circular reference)
const baseConditionSchema = z.discriminatedUnion('type', [
  userAttributeConditionSchema,
  requestAttributeConditionSchema,
  timeBasedConditionSchema,
  riskBasedConditionSchema,
  resourceAttributeConditionSchema,
  customConditionSchema,
]);

// Use any for recursive schema to avoid TypeScript issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const policyConditionSchema: z.ZodSchema<any> = z.lazy(() =>
  z.union([
    baseConditionSchema,
    z.object({
      type: z.literal('composite'),
      operator: logicalOperatorSchema,
      conditions: z.array(policyConditionSchema),
    }),
  ])
);

// Composite condition schema for direct use
export const compositeConditionSchema = z.object({
  type: z.literal('composite'),
  operator: logicalOperatorSchema,
  conditions: z.array(policyConditionSchema),
});

// =============================================================================
// POLICY RULE TYPES
// =============================================================================

export const PolicyRuleType = {
  REQUIRE_MFA: 'require_mfa',
  REQUIRE_APPROVAL: 'require_approval',
  BLOCK_ACCESS: 'block_access',
  RATE_LIMIT: 'rate_limit',
  REQUIRE_ENCRYPTION: 'require_encryption',
  AUDIT_LOG: 'audit_log',
  STEP_UP_AUTH: 'step_up_auth',
  DATA_MASKING: 'data_masking',
  SESSION_TIMEOUT: 'session_timeout',
  GEO_RESTRICTION: 'geo_restriction',
  CUSTOM: 'custom',
} as const;

export type PolicyRuleType = (typeof PolicyRuleType)[keyof typeof PolicyRuleType];

export const policyRuleTypeSchema = z.nativeEnum(PolicyRuleType);

// =============================================================================
// POLICY RULE
// =============================================================================

/**
 * MFA rule configuration
 */
export interface MFARule {
  type: 'require_mfa';
  enforced: boolean;
  methods?: ('totp' | 'sms' | 'email' | 'push' | 'webauthn' | 'hardware_key')[];
  timeout?: number;
  rememberDevice?: boolean;
  rememberDuration?: number;
}

export const mfaRuleSchema = z.object({
  type: z.literal('require_mfa'),
  enforced: z.boolean(),
  methods: z.array(z.enum(['totp', 'sms', 'email', 'push', 'webauthn', 'hardware_key'])).optional(),
  timeout: z.number().int().positive().optional(),
  rememberDevice: z.boolean().optional(),
  rememberDuration: z.number().int().positive().optional(),
});

/**
 * Approval rule configuration
 */
export interface ApprovalRule {
  type: 'require_approval';
  enforced: boolean;
  approvers?: string[];
  approverRoles?: string[];
  approvalTimeout?: number;
  minApprovers?: number;
  autoRejectOnTimeout?: boolean;
  requireJustification?: boolean;
}

export const approvalRuleSchema = z.object({
  type: z.literal('require_approval'),
  enforced: z.boolean(),
  approvers: z.array(z.string()).optional(),
  approverRoles: z.array(z.string()).optional(),
  approvalTimeout: z.number().int().positive().optional(),
  minApprovers: z.number().int().positive().optional(),
  autoRejectOnTimeout: z.boolean().optional(),
  requireJustification: z.boolean().optional(),
});

/**
 * Block access rule configuration
 */
export interface BlockAccessRule {
  type: 'block_access';
  enforced: boolean;
  reason?: string;
  errorCode?: string;
  redirectUrl?: string;
}

export const blockAccessRuleSchema = z.object({
  type: z.literal('block_access'),
  enforced: z.boolean(),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
  redirectUrl: z.string().url().optional(),
});

/**
 * Rate limit rule configuration
 */
export interface RateLimitRule {
  type: 'rate_limit';
  enforced: boolean;
  limit: number;
  window: number;
  windowUnit?: 'second' | 'minute' | 'hour' | 'day';
  keyBy?: ('user' | 'ip' | 'tenant' | 'api_key' | 'custom')[];
  customKey?: string;
  burstLimit?: number;
  retryAfter?: number;
}

export const rateLimitRuleSchema = z.object({
  type: z.literal('rate_limit'),
  enforced: z.boolean(),
  limit: z.number().int().positive(),
  window: z.number().int().positive(),
  windowUnit: z.enum(['second', 'minute', 'hour', 'day']).optional(),
  keyBy: z.array(z.enum(['user', 'ip', 'tenant', 'api_key', 'custom'])).optional(),
  customKey: z.string().optional(),
  burstLimit: z.number().int().positive().optional(),
  retryAfter: z.number().int().positive().optional(),
});

/**
 * Encryption rule configuration
 */
export interface EncryptionRule {
  type: 'require_encryption';
  enforced: boolean;
  fields?: string[];
  algorithm?: 'AES-256-GCM' | 'RSA-OAEP' | 'ChaCha20-Poly1305';
  keyId?: string;
}

export const encryptionRuleSchema = z.object({
  type: z.literal('require_encryption'),
  enforced: z.boolean(),
  fields: z.array(z.string()).optional(),
  algorithm: z.enum(['AES-256-GCM', 'RSA-OAEP', 'ChaCha20-Poly1305']).optional(),
  keyId: z.string().optional(),
});

/**
 * Audit log rule configuration
 */
export interface AuditLogRule {
  type: 'audit_log';
  enforced: boolean;
  level?: 'basic' | 'detailed' | 'full';
  includeRequest?: boolean;
  includeResponse?: boolean;
  includeHeaders?: boolean;
  redactFields?: string[];
  destination?: string;
}

export const auditLogRuleSchema = z.object({
  type: z.literal('audit_log'),
  enforced: z.boolean(),
  level: z.enum(['basic', 'detailed', 'full']).optional(),
  includeRequest: z.boolean().optional(),
  includeResponse: z.boolean().optional(),
  includeHeaders: z.boolean().optional(),
  redactFields: z.array(z.string()).optional(),
  destination: z.string().optional(),
});

/**
 * Step-up authentication rule
 */
export interface StepUpAuthRule {
  type: 'step_up_auth';
  enforced: boolean;
  requiredLevel: number;
  method?: 'mfa' | 'password' | 'biometric';
  timeout?: number;
}

export const stepUpAuthRuleSchema = z.object({
  type: z.literal('step_up_auth'),
  enforced: z.boolean(),
  requiredLevel: z.number().int().min(0).max(7),
  method: z.enum(['mfa', 'password', 'biometric']).optional(),
  timeout: z.number().int().positive().optional(),
});

/**
 * Data masking rule
 */
export interface DataMaskingRule {
  type: 'data_masking';
  enforced: boolean;
  fields: string[];
  maskType?: 'full' | 'partial' | 'hash' | 'tokenize';
  partialMaskPattern?: string;
}

export const dataMaskingRuleSchema = z.object({
  type: z.literal('data_masking'),
  enforced: z.boolean(),
  fields: z.array(z.string()),
  maskType: z.enum(['full', 'partial', 'hash', 'tokenize']).optional(),
  partialMaskPattern: z.string().optional(),
});

/**
 * Session timeout rule
 */
export interface SessionTimeoutRule {
  type: 'session_timeout';
  enforced: boolean;
  maxDuration?: number;
  idleTimeout?: number;
  requireReauth?: boolean;
}

export const sessionTimeoutRuleSchema = z.object({
  type: z.literal('session_timeout'),
  enforced: z.boolean(),
  maxDuration: z.number().int().positive().optional(),
  idleTimeout: z.number().int().positive().optional(),
  requireReauth: z.boolean().optional(),
});

/**
 * Geo restriction rule
 */
export interface GeoRestrictionRule {
  type: 'geo_restriction';
  enforced: boolean;
  allowedCountries?: string[];
  blockedCountries?: string[];
  allowedRegions?: string[];
  blockedRegions?: string[];
}

export const geoRestrictionRuleSchema = z.object({
  type: z.literal('geo_restriction'),
  enforced: z.boolean(),
  allowedCountries: z.array(z.string()).optional(),
  blockedCountries: z.array(z.string()).optional(),
  allowedRegions: z.array(z.string()).optional(),
  blockedRegions: z.array(z.string()).optional(),
});

/**
 * Custom rule
 */
export interface CustomRule {
  type: 'custom';
  enforced: boolean;
  handler: string;
  config?: Record<string, unknown>;
}

export const customRuleSchema = z.object({
  type: z.literal('custom'),
  enforced: z.boolean(),
  handler: z.string().min(1),
  config: z.record(z.unknown()).optional(),
});

/**
 * Union of all rule types
 */
export type PolicyRule =
  | MFARule
  | ApprovalRule
  | BlockAccessRule
  | RateLimitRule
  | EncryptionRule
  | AuditLogRule
  | StepUpAuthRule
  | DataMaskingRule
  | SessionTimeoutRule
  | GeoRestrictionRule
  | CustomRule;

export const policyRuleSchema = z.discriminatedUnion('type', [
  mfaRuleSchema,
  approvalRuleSchema,
  blockAccessRuleSchema,
  rateLimitRuleSchema,
  encryptionRuleSchema,
  auditLogRuleSchema,
  stepUpAuthRuleSchema,
  dataMaskingRuleSchema,
  sessionTimeoutRuleSchema,
  geoRestrictionRuleSchema,
  customRuleSchema,
]);

// =============================================================================
// POLICY ACTION TYPES
// =============================================================================

export const PolicyActionType = {
  ALLOW: 'allow',
  DENY: 'deny',
  CHALLENGE: 'challenge',
  NOTIFY: 'notify',
  LOG: 'log',
  ESCALATE: 'escalate',
  QUARANTINE: 'quarantine',
  REDIRECT: 'redirect',
  MODIFY: 'modify',
} as const;

export type PolicyActionType = (typeof PolicyActionType)[keyof typeof PolicyActionType];

export const policyActionTypeSchema = z.nativeEnum(PolicyActionType);

// =============================================================================
// POLICY ACTIONS
// =============================================================================

/**
 * Allow action
 */
export interface AllowAction {
  type: 'allow';
  message?: string;
  metadata?: Record<string, unknown>;
}

export const allowActionSchema = z.object({
  type: z.literal('allow'),
  message: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Deny action
 */
export interface DenyAction {
  type: 'deny';
  reason: string;
  errorCode?: string;
  httpStatus?: number;
  retryable?: boolean;
  retryAfter?: number;
}

export const denyActionSchema = z.object({
  type: z.literal('deny'),
  reason: z.string().min(1),
  errorCode: z.string().optional(),
  httpStatus: z.number().int().min(400).max(599).optional(),
  retryable: z.boolean().optional(),
  retryAfter: z.number().int().positive().optional(),
});

/**
 * Challenge action (request additional authentication)
 */
export interface ChallengeAction {
  type: 'challenge';
  method: 'mfa' | 'password' | 'captcha' | 'approval' | 'custom';
  timeout?: number;
  redirectUrl?: string;
  customChallenge?: string;
}

export const challengeActionSchema = z.object({
  type: z.literal('challenge'),
  method: z.enum(['mfa', 'password', 'captcha', 'approval', 'custom']),
  timeout: z.number().int().positive().optional(),
  redirectUrl: z.string().url().optional(),
  customChallenge: z.string().optional(),
});

/**
 * Notify action (alert security team)
 */
export interface NotifyAction {
  type: 'notify';
  channels: ('email' | 'slack' | 'pagerduty' | 'webhook' | 'sms')[];
  recipients?: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  template?: string;
  includeContext?: boolean;
}

export const notifyActionSchema = z.object({
  type: z.literal('notify'),
  channels: z.array(z.enum(['email', 'slack', 'pagerduty', 'webhook', 'sms'])),
  recipients: z.array(z.string()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  template: z.string().optional(),
  includeContext: z.boolean().optional(),
});

/**
 * Log action (audit trail)
 */
export interface LogAction {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  includeContext?: boolean;
  includeRequest?: boolean;
  includeUser?: boolean;
  destination?: string;
  tags?: string[];
}

export const logActionSchema = z.object({
  type: z.literal('log'),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().optional(),
  includeContext: z.boolean().optional(),
  includeRequest: z.boolean().optional(),
  includeUser: z.boolean().optional(),
  destination: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Escalate action (create incident)
 */
export interface EscalateAction {
  type: 'escalate';
  severity: 'low' | 'medium' | 'high' | 'critical';
  assignTo?: string[];
  assignToRoles?: string[];
  createIncident?: boolean;
  incidentType?: string;
  timeout?: number;
  autoResolve?: boolean;
}

export const escalateActionSchema = z.object({
  type: z.literal('escalate'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  assignTo: z.array(z.string()).optional(),
  assignToRoles: z.array(z.string()).optional(),
  createIncident: z.boolean().optional(),
  incidentType: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  autoResolve: z.boolean().optional(),
});

/**
 * Quarantine action (temporary block)
 */
export interface QuarantineAction {
  type: 'quarantine';
  duration: number;
  durationUnit?: 'second' | 'minute' | 'hour' | 'day';
  reason: string;
  notifyUser?: boolean;
  notifyAdmin?: boolean;
  allowAppeal?: boolean;
}

export const quarantineActionSchema = z.object({
  type: z.literal('quarantine'),
  duration: z.number().int().positive(),
  durationUnit: z.enum(['second', 'minute', 'hour', 'day']).optional(),
  reason: z.string().min(1),
  notifyUser: z.boolean().optional(),
  notifyAdmin: z.boolean().optional(),
  allowAppeal: z.boolean().optional(),
});

/**
 * Redirect action
 */
export interface RedirectAction {
  type: 'redirect';
  url: string;
  statusCode?: 301 | 302 | 303 | 307 | 308;
  preserveQuery?: boolean;
}

export const redirectActionSchema = z.object({
  type: z.literal('redirect'),
  url: z.string().url(),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(303), z.literal(307), z.literal(308)]).optional(),
  preserveQuery: z.boolean().optional(),
});

/**
 * Modify action (modify request/response)
 */
export interface ModifyAction {
  type: 'modify';
  addHeaders?: Record<string, string>;
  removeHeaders?: string[];
  modifyBody?: Record<string, unknown>;
  addClaims?: Record<string, unknown>;
}

export const modifyActionSchema = z.object({
  type: z.literal('modify'),
  addHeaders: z.record(z.string()).optional(),
  removeHeaders: z.array(z.string()).optional(),
  modifyBody: z.record(z.unknown()).optional(),
  addClaims: z.record(z.unknown()).optional(),
});

/**
 * Union of all action types
 */
export type PolicyAction =
  | AllowAction
  | DenyAction
  | ChallengeAction
  | NotifyAction
  | LogAction
  | EscalateAction
  | QuarantineAction
  | RedirectAction
  | ModifyAction;

export const policyActionSchema = z.discriminatedUnion('type', [
  allowActionSchema,
  denyActionSchema,
  challengeActionSchema,
  notifyActionSchema,
  logActionSchema,
  escalateActionSchema,
  quarantineActionSchema,
  redirectActionSchema,
  modifyActionSchema,
]);

// =============================================================================
// SECURITY POLICY
// =============================================================================

/**
 * Security policy definition
 */
export interface SecurityPolicy {
  /** Unique policy identifier */
  id: string;
  /** Human-readable policy name */
  name: string;
  /** Policy description */
  description: string;
  /** Policy priority (higher = evaluated first) */
  priority: number;
  /** Whether policy is enabled */
  enabled: boolean;
  /** Conditions that determine when policy applies */
  conditions: PolicyCondition[];
  /** Rules that define what to enforce */
  rules: PolicyRule[];
  /** Actions to take when policy matches */
  actions: PolicyAction[];
  /** Policy version */
  version: string;
  /** Policy tags for categorization */
  tags?: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Created by user ID */
  createdBy?: string;
  /** Updated by user ID */
  updatedBy?: string;
}

export const securityPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(2000),
  priority: z.number().int().min(0).max(10000),
  enabled: z.boolean(),
  conditions: z.array(policyConditionSchema),
  rules: z.array(policyRuleSchema),
  actions: z.array(policyActionSchema),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

// =============================================================================
// POLICY CONTEXT
// =============================================================================

/**
 * User information in policy context
 */
export interface PolicyContextUser {
  id: string;
  email?: string;
  role?: string;
  roles?: string[];
  department?: string;
  tenant?: string;
  groups?: string[];
  permissions?: string[];
  attributes?: Record<string, unknown>;
  riskScore?: number;
  mfaVerified?: boolean;
  lastMfaAt?: string;
  sessionStartedAt?: string;
}

/**
 * Request information in policy context
 */
export interface PolicyContextRequest {
  id: string;
  method: string;
  path: string;
  url: string;
  ip: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  contentType?: string;
}

/**
 * Resource information in policy context
 */
export interface PolicyContextResource {
  id?: string;
  type?: string;
  sensitivityLevel?: 'public' | 'internal' | 'confidential' | 'restricted' | 'top_secret';
  dataType?: string;
  classification?: string;
  owner?: string;
  department?: string;
  region?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
}

/**
 * Risk information in policy context
 */
export interface PolicyContextRisk {
  userRiskScore?: number;
  ipReputation?: number;
  deviceTrust?: number;
  sessionRisk?: number;
  anomalyScore?: number;
  threatLevel?: 'none' | 'low' | 'medium' | 'high' | 'critical';
  riskFactors?: string[];
}

/**
 * Environment information in policy context
 */
export interface PolicyContextEnvironment {
  timestamp: string;
  timezone: string;
  dayOfWeek: number;
  hour: number;
  isBusinessHours?: boolean;
  isWeekend?: boolean;
  isHoliday?: boolean;
  geoLocation?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

/**
 * Full policy evaluation context
 */
export interface PolicyContext {
  /** User making the request */
  user?: PolicyContextUser;
  /** Request details */
  request: PolicyContextRequest;
  /** Resource being accessed */
  resource?: PolicyContextResource;
  /** Risk assessment */
  risk?: PolicyContextRisk;
  /** Environment context */
  environment?: PolicyContextEnvironment;
  /** Custom context data */
  custom?: Record<string, unknown>;
  /** Break-glass override token */
  breakGlassToken?: string;
}

export const policyContextSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().email().optional(),
    role: z.string().optional(),
    roles: z.array(z.string()).optional(),
    department: z.string().optional(),
    tenant: z.string().optional(),
    groups: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    attributes: z.record(z.unknown()).optional(),
    riskScore: z.number().min(0).max(100).optional(),
    mfaVerified: z.boolean().optional(),
    lastMfaAt: z.string().datetime().optional(),
    sessionStartedAt: z.string().datetime().optional(),
  }).optional(),
  request: z.object({
    id: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    url: z.string().min(1),
    ip: z.string().min(1),
    userAgent: z.string().optional(),
    origin: z.string().optional(),
    referer: z.string().optional(),
    headers: z.record(z.union([z.string(), z.array(z.string()), z.undefined()])).optional(),
    query: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    body: z.unknown().optional(),
    contentType: z.string().optional(),
  }),
  resource: z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    sensitivityLevel: z.enum(['public', 'internal', 'confidential', 'restricted', 'top_secret']).optional(),
    dataType: z.string().optional(),
    classification: z.string().optional(),
    owner: z.string().optional(),
    department: z.string().optional(),
    region: z.string().optional(),
    tags: z.array(z.string()).optional(),
    attributes: z.record(z.unknown()).optional(),
  }).optional(),
  risk: z.object({
    userRiskScore: z.number().min(0).max(100).optional(),
    ipReputation: z.number().min(0).max(100).optional(),
    deviceTrust: z.number().min(0).max(100).optional(),
    sessionRisk: z.number().min(0).max(100).optional(),
    anomalyScore: z.number().min(0).max(100).optional(),
    threatLevel: z.enum(['none', 'low', 'medium', 'high', 'critical']).optional(),
    riskFactors: z.array(z.string()).optional(),
  }).optional(),
  environment: z.object({
    timestamp: z.string().datetime(),
    timezone: z.string(),
    dayOfWeek: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    isBusinessHours: z.boolean().optional(),
    isWeekend: z.boolean().optional(),
    isHoliday: z.boolean().optional(),
    geoLocation: z.object({
      country: z.string().optional(),
      region: z.string().optional(),
      city: z.string().optional(),
    }).optional(),
  }).optional(),
  custom: z.record(z.unknown()).optional(),
  breakGlassToken: z.string().optional(),
});

// =============================================================================
// POLICY DECISION
// =============================================================================

/**
 * Decision outcome
 */
export const DecisionOutcome = {
  ALLOW: 'allow',
  DENY: 'deny',
  CHALLENGE: 'challenge',
  PENDING: 'pending',
} as const;

export type DecisionOutcome = (typeof DecisionOutcome)[keyof typeof DecisionOutcome];

/**
 * Individual policy evaluation result
 */
export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  policyVersion: string;
  matched: boolean;
  conditionResults: ConditionEvaluationResult[];
  ruleResults: RuleEvaluationResult[];
  actions: PolicyAction[];
  durationMs: number;
  evaluatedAt: string;
}

/**
 * Condition evaluation result
 */
export interface ConditionEvaluationResult {
  conditionType: ConditionType | 'composite';
  field?: string;
  operator?: ConditionOperator | LogicalOperator;
  expected?: unknown;
  actual?: unknown;
  matched: boolean;
  error?: string;
}

/**
 * Rule evaluation result
 */
export interface RuleEvaluationResult {
  ruleType: PolicyRuleType;
  enforced: boolean;
  passed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Final policy decision
 */
export interface PolicyDecision {
  /** Decision ID */
  id: string;
  /** Request ID */
  requestId: string;
  /** Decision outcome */
  outcome: DecisionOutcome;
  /** Primary reason for decision */
  reason: string;
  /** Actions to execute */
  actions: PolicyAction[];
  /** All evaluated policies */
  evaluatedPolicies: PolicyEvaluationResult[];
  /** Matched policies (subset of evaluated) */
  matchedPolicies: PolicyEvaluationResult[];
  /** Whether break-glass was used */
  breakGlassUsed: boolean;
  /** Total evaluation time */
  totalDurationMs: number;
  /** Decision timestamp */
  decidedAt: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// POLICY VERSION
// =============================================================================

/**
 * Policy version record
 */
export interface PolicyVersionRecord {
  id: string;
  policyId: string;
  version: string;
  policy: SecurityPolicy;
  changeSummary?: string;
  createdBy?: string;
  createdAt: string;
}

// =============================================================================
// SIMULATION/DRY-RUN
// =============================================================================

/**
 * Simulation request
 */
export interface PolicySimulationRequest {
  context: PolicyContext;
  policies?: string[];
  includeDisabled?: boolean;
  verbose?: boolean;
}

/**
 * Simulation result
 */
export interface PolicySimulationResult {
  decision: PolicyDecision;
  whatIf: {
    withoutPolicy?: Record<string, PolicyDecision>;
    withModifiedContext?: Record<string, PolicyDecision>;
  };
  recommendations?: string[];
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Policy validation error
 */
export interface PolicyValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Policy validation result
 */
export interface PolicyValidationResult {
  valid: boolean;
  errors: PolicyValidationError[];
  warnings: string[];
}
