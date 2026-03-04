/**
 * Incident Response System - Type Definitions
 *
 * Comprehensive type definitions for incident management,
 * playbook execution, and notification handling.
 */

import { z } from 'zod';

// ============================================================================
// Enums and Constants
// ============================================================================

export const IncidentSeverity = {
  P1: 'P1', // Critical - System down, data breach
  P2: 'P2', // High - Major functionality impacted
  P3: 'P3', // Medium - Minor functionality impacted
  P4: 'P4', // Low - Cosmetic issues, minor bugs
} as const;

export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export const IncidentStatus = {
  DETECTED: 'detected',
  INVESTIGATING: 'investigating',
  CONTAINED: 'contained',
  ERADICATED: 'eradicated',
  RECOVERED: 'recovered',
  CLOSED: 'closed',
} as const;

export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const IncidentType = {
  DATA_BREACH: 'data_breach',
  ACCOUNT_COMPROMISE: 'account_compromise',
  MALWARE: 'malware',
  DENIAL_OF_SERVICE: 'denial_of_service',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  INSIDER_THREAT: 'insider_threat',
  PHISHING: 'phishing',
  RANSOMWARE: 'ransomware',
  CONFIGURATION_ERROR: 'configuration_error',
  OTHER: 'other',
} as const;

export type IncidentType = (typeof IncidentType)[keyof typeof IncidentType];

export const StepType = {
  MANUAL: 'manual',
  AUTOMATED: 'automated',
} as const;

export type StepType = (typeof StepType)[keyof typeof StepType];

export const NotificationChannel = {
  SLACK: 'slack',
  EMAIL: 'email',
  PAGERDUTY: 'pagerduty',
  WEBHOOK: 'webhook',
  SMS: 'sms',
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const TimelineEntryType = {
  CREATED: 'created',
  STATUS_CHANGE: 'status_change',
  ASSIGNMENT: 'assignment',
  COMMENT: 'comment',
  EVIDENCE_ADDED: 'evidence_added',
  PLAYBOOK_STARTED: 'playbook_started',
  PLAYBOOK_STEP_COMPLETED: 'playbook_step_completed',
  PLAYBOOK_STEP_FAILED: 'playbook_step_failed',
  NOTIFICATION_SENT: 'notification_sent',
  ESCALATION: 'escalation',
  RESOLUTION: 'resolution',
} as const;

export type TimelineEntryType = (typeof TimelineEntryType)[keyof typeof TimelineEntryType];

// ============================================================================
// Zod Schemas
// ============================================================================

export const EvidenceSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['log', 'screenshot', 'file', 'network_capture', 'memory_dump', 'configuration', 'other']),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  source: z.string(),
  collectedAt: z.date(),
  collectedBy: z.string(),
  hash: z.string().optional(), // SHA-256 hash for integrity
  size: z.number().optional(), // Size in bytes
  location: z.string(), // File path or URL
  metadata: z.record(z.unknown()).optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const TimelineEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.date(),
  type: z.nativeEnum(TimelineEntryType),
  actor: z.string(), // User or system that performed the action
  description: z.string(),
  metadata: z.record(z.unknown()).optional(),
  automated: z.boolean().default(false),
});

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TriggerConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'contains', 'matches', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in']),
  value: z.unknown(),
  logicalOperator: z.enum(['and', 'or']).optional(),
});

export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

export const NotificationConfigSchema = z.object({
  channel: z.nativeEnum(NotificationChannel),
  target: z.string(), // Channel ID, email, webhook URL, etc.
  template: z.string().optional(),
  severityFilter: z.array(z.nativeEnum(IncidentSeverity)).optional(),
  enabled: z.boolean().default(true),
  retryAttempts: z.number().default(3),
  retryDelayMs: z.number().default(5000),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export const EscalationLevelSchema = z.object({
  level: z.number().min(1),
  afterMinutes: z.number().min(0),
  targets: z.array(z.string()), // User IDs or team names
  channels: z.array(z.nativeEnum(NotificationChannel)),
  message: z.string().optional(),
});

export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

export const EscalationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  levels: z.array(EscalationLevelSchema),
  maxLevel: z.number().default(3),
  resetOnAcknowledge: z.boolean().default(true),
});

export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;

export const PlaybookStepSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  type: z.nativeEnum(StepType),
  description: z.string(),
  action: z.function().args().returns(z.promise(z.void())).optional(),
  actionId: z.string().optional(), // ID of registered ActionDefinition to execute
  timeout: z.number().optional(), // Timeout in milliseconds
  requiresApproval: z.boolean().default(false),
  approvers: z.array(z.string()).optional(),
  onFailure: z.enum(['continue', 'halt', 'retry']).default('halt'),
  retryAttempts: z.number().default(0),
  dependencies: z.array(z.string()).optional(), // Step IDs that must complete first
  metadata: z.record(z.unknown()).optional(),
});

export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

/**
 * Input type for creating playbook steps - allows optional fields with defaults
 */
export type PlaybookStepInput = Omit<PlaybookStep, 'requiresApproval' | 'onFailure' | 'retryAttempts'> & {
  requiresApproval?: boolean;
  onFailure?: 'continue' | 'halt' | 'retry';
  retryAttempts?: number;
  actionId?: string; // ID of registered ActionDefinition to execute
};

export const PlaybookSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  triggerConditions: z.array(TriggerConditionSchema),
  steps: z.array(PlaybookStepSchema),
  notifications: z.array(NotificationConfigSchema),
  escalation: EscalationConfigSchema,
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type Playbook = z.infer<typeof PlaybookSchema>;

/**
 * Input type for creating playbooks - allows optional fields with defaults
 */
export type PlaybookInput = Omit<Playbook, 'steps' | 'version' | 'enabled'> & {
  steps: PlaybookStepInput[];
  version?: string;
  enabled?: boolean;
};

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string(),
  severity: z.nativeEnum(IncidentSeverity),
  status: z.nativeEnum(IncidentStatus),
  type: z.nativeEnum(IncidentType),
  detectedAt: z.date(),
  acknowledgedAt: z.date().optional(),
  containedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  closedAt: z.date().optional(),
  assignee: z.string().optional(),
  team: z.string().optional(),
  affectedResources: z.array(z.string()),
  timeline: z.array(TimelineEntrySchema),
  evidence: z.array(EvidenceSchema),
  playbook: z.string().optional(), // Playbook ID
  playbookProgress: z.record(z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped'])).optional(),
  tags: z.array(z.string()).optional(),
  externalReferences: z.array(z.object({
    type: z.string(),
    id: z.string(),
    url: z.string().url().optional(),
  })).optional(),
  rootCause: z.string().optional(),
  remediation: z.string().optional(),
  lessonsLearned: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Incident = z.infer<typeof IncidentSchema>;

export const CreateIncidentSchema = IncidentSchema.omit({
  id: true,
  timeline: true,
  evidence: true,
  playbookProgress: true,
  acknowledgedAt: true,
  containedAt: true,
  resolvedAt: true,
  closedAt: true,
}).extend({
  affectedResources: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
});

export type CreateIncidentInput = z.infer<typeof CreateIncidentSchema>;

export const UpdateIncidentSchema = IncidentSchema.partial().omit({
  id: true,
  detectedAt: true,
  timeline: true,
});

export type UpdateIncidentInput = z.infer<typeof UpdateIncidentSchema>;

// ============================================================================
// Report Types
// ============================================================================

export interface IncidentReport {
  incident: Incident;
  generatedAt: Date;
  generatedBy: string;
  summary: {
    duration: number; // Total duration in milliseconds
    timeToDetect?: number;
    timeToContain?: number;
    timeToResolve?: number;
    escalationLevel: number;
    playbookStepsCompleted: number;
    playbookStepsTotal: number;
    evidenceCount: number;
    notificationsSent: number;
  };
  timelineFormatted: string;
  impactAssessment?: string;
  recommendations: string[];
}

export interface IncidentMetrics {
  totalIncidents: number;
  byStatus: Record<IncidentStatus, number>;
  bySeverity: Record<IncidentSeverity, number>;
  byType: Record<IncidentType, number>;
  averageTimeToDetect: number;
  averageTimeToContain: number;
  averageTimeToResolve: number;
  averageTimeToClose: number;
}

// ============================================================================
// Event Types
// ============================================================================

export interface IncidentEvent {
  type: 'incident_created' | 'incident_updated' | 'incident_closed' |
        'playbook_started' | 'playbook_completed' | 'playbook_failed' |
        'step_completed' | 'step_failed' | 'escalation_triggered' |
        'notification_sent' | 'evidence_added';
  incidentId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type IncidentEventHandler = (event: IncidentEvent) => void | Promise<void>;

// ============================================================================
// Playbook Execution Types
// ============================================================================

export interface PlaybookExecutionContext {
  incident: Incident;
  playbook: Playbook;
  currentStepIndex: number;
  startedAt: Date;
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];
  variables: Record<string, unknown>;
}

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  output?: unknown;
  error?: string;
  retryCount: number;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationPayload {
  incidentId: string;
  title: string;
  message: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  url?: string;
  additionalData?: Record<string, unknown>;
}

export interface NotificationResult {
  channel: NotificationChannel;
  target: string;
  success: boolean;
  sentAt: Date;
  messageId?: string;
  error?: string;
  retryCount: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface IncidentManagerConfig {
  defaultEscalation: EscalationConfig;
  notificationDefaults: Partial<NotificationConfig>;
  autoAssignment: {
    enabled: boolean;
    rules: Array<{
      conditions: TriggerCondition[];
      assignee: string;
    }>;
  };
  retentionDays: number;
  webhooks: {
    slack?: string;
    pagerduty?: string;
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth?: {
        user: string;
        pass: string;
      };
    };
    custom?: Array<{
      name: string;
      url: string;
      headers?: Record<string, string>;
    }>;
  };
  /** Automation configuration */
  automation: {
    /** Whether automated playbook execution is enabled */
    enabled: boolean;
    /** Maximum concurrent playbook executions */
    maxConcurrentExecutions: number;
    /** Default timeout for automated steps in milliseconds */
    defaultStepTimeoutMs: number;
    /** Whether to persist execution state */
    persistState: boolean;
    /** State storage configuration */
    stateStorage?: {
      type: 'memory' | 'redis' | 'database';
      connectionString?: string;
    };
  };
}

// ============================================================================
// Automation Types
// ============================================================================

/**
 * Execution state for a playbook
 */
export const ExecutionState = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  WAITING_APPROVAL: 'waiting_approval',
  WAITING_MANUAL: 'waiting_manual',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  CANCELLED: 'cancelled',
} as const;

export type ExecutionState = (typeof ExecutionState)[keyof typeof ExecutionState];

/**
 * Step execution state
 */
export const StepState = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  ROLLED_BACK: 'rolled_back',
  TIMED_OUT: 'timed_out',
} as const;

export type StepState = (typeof StepState)[keyof typeof StepState];

/**
 * Persistent execution state for a playbook run
 */
export interface PlaybookExecutionState {
  /** Unique execution ID */
  executionId: string;
  /** Associated incident ID */
  incidentId: string;
  /** Playbook ID being executed */
  playbookId: string;
  /** Current execution state */
  state: ExecutionState;
  /** State of each step */
  stepStates: Record<string, StepExecutionState>;
  /** Execution variables/context */
  variables: Record<string, unknown>;
  /** When execution started */
  startedAt: Date;
  /** When execution was last updated */
  updatedAt: Date;
  /** When execution completed (if applicable) */
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Steps that have been rolled back */
  rolledBackSteps: string[];
  /** Checkpoint for resuming execution */
  checkpoint?: {
    stepId: string;
    position: number;
  };
}

/**
 * State of a single step execution
 */
export interface StepExecutionState {
  stepId: string;
  state: StepState;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  output?: unknown;
  error?: string;
  approvedBy?: string;
  approvedAt?: Date;
  rollbackCompleted?: boolean;
}

/**
 * Action context provided to automated actions
 */
export interface ActionContext {
  /** The incident being handled */
  incident: Incident;
  /** The playbook being executed */
  playbook: Playbook;
  /** The current step being executed */
  step: PlaybookStep;
  /** Execution variables */
  variables: Record<string, unknown>;
  /** Logger for the action */
  logger: {
    debug: (message: string, data?: Record<string, unknown>) => void;
    info: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
  /** Add evidence to the incident */
  addEvidence: (evidence: Omit<Evidence, 'id' | 'collectedAt'>) => Promise<Evidence>;
  /** Update incident */
  updateIncident: (updates: UpdateIncidentInput) => Promise<void>;
  /** Set a variable for later steps */
  setVariable: (key: string, value: unknown) => void;
  /** Get a variable from a previous step */
  getVariable: <T = unknown>(key: string) => T | undefined;
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
}

/**
 * Result of executing an automated action
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Output data from the action */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Metrics about the action */
  metrics?: {
    durationMs: number;
    itemsProcessed?: number;
    itemsFailed?: number;
  };
  /** Whether the action can be rolled back */
  canRollback?: boolean;
  /** Data needed for rollback */
  rollbackData?: unknown;
}

/**
 * Definition of an automated action
 */
export interface ActionDefinition {
  /** Unique action ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the action does */
  description: string;
  /** Category of action */
  category: 'containment' | 'eradication' | 'recovery' | 'notification' | 'evidence' | 'monitoring';
  /** Risk level of the action */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the action requires approval by default */
  requiresApproval: boolean;
  /** Whether the action supports rollback */
  supportsRollback: boolean;
  /** Default timeout in milliseconds */
  defaultTimeoutMs: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Execute the action */
  execute: (context: ActionContext) => Promise<ActionResult>;
  /** Rollback the action (if supported) */
  rollback?: (context: ActionContext, rollbackData: unknown) => Promise<ActionResult>;
  /** Validate that the action can be executed */
  validate?: (context: ActionContext) => Promise<{ valid: boolean; reason?: string }>;
}

/**
 * Rollback procedure for a step
 */
export interface RollbackProcedure {
  stepId: string;
  rollbackSteps: Array<{
    order: number;
    description: string;
    action: (context: ActionContext, rollbackData: unknown) => Promise<void>;
  }>;
}

/**
 * Alert rule for triggering incidents
 */
export interface AlertRule {
  /** Unique rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Whether the rule is enabled */
  enabled: boolean;
  /** Conditions that trigger the rule */
  conditions: AlertCondition[];
  /** How conditions are combined */
  conditionOperator: 'and' | 'or';
  /** Resulting incident configuration */
  incidentConfig: {
    type: IncidentType;
    severity: IncidentSeverity;
    titleTemplate: string;
    descriptionTemplate: string;
    tags?: string[];
    autoAssignee?: string;
  };
  /** Playbook to auto-attach */
  playbookId?: string;
  /** Cooldown period to prevent duplicate incidents (in seconds) */
  cooldownSeconds: number;
  /** Priority for rule matching (higher = checked first) */
  priority: number;
}

/**
 * Condition for alert rules
 */
export interface AlertCondition {
  /** Field to evaluate */
  field: string;
  /** Operator for comparison */
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'matches' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in' | 'exists' | 'not_exists';
  /** Value to compare against */
  value?: unknown;
}

/**
 * Alert from an external system or detector
 */
export interface Alert {
  /** Unique alert ID */
  alertId: string;
  /** Alert source (e.g., 'anomaly_detector', 'waf', 'ids') */
  source: string;
  /** Alert type/category */
  type: string;
  /** Alert severity */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Alert title/summary */
  title: string;
  /** Detailed description */
  description: string;
  /** When the alert was generated */
  timestamp: Date;
  /** Associated user ID if any */
  userId?: string;
  /** Associated IP address if any */
  ipAddress?: string;
  /** Associated resource/endpoint if any */
  resource?: string;
  /** Raw alert data */
  rawData: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * State storage interface for persisting execution state
 */
export interface ExecutionStateStore {
  /** Save execution state */
  save(state: PlaybookExecutionState): Promise<void>;
  /** Load execution state */
  load(executionId: string): Promise<PlaybookExecutionState | null>;
  /** Load execution state by incident ID */
  loadByIncident(incidentId: string): Promise<PlaybookExecutionState | null>;
  /** Delete execution state */
  delete(executionId: string): Promise<void>;
  /** List all active executions */
  listActive(): Promise<PlaybookExecutionState[]>;
  /** Update specific fields */
  update(executionId: string, updates: Partial<PlaybookExecutionState>): Promise<void>;
}
