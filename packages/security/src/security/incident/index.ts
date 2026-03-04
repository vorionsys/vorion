/**
 * Incident Response System - Incident Manager
 *
 * Core incident management functionality including incident lifecycle,
 * playbook execution, escalation workflows, and reporting.
 *
 * Features:
 * - Automated playbook execution
 * - Trigger-based incident creation from alerts
 * - Parallel step execution with dependencies
 * - State persistence and recovery
 * - Rollback capabilities
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../common/logger.js';
import {
  Incident,
  IncidentSchema,
  CreateIncidentInput,
  CreateIncidentSchema,
  UpdateIncidentInput,
  UpdateIncidentSchema,
  Playbook,
  PlaybookStep,
  PlaybookInput,
  PlaybookStepInput,
  PlaybookExecutionContext,
  PlaybookExecutionState,
  StepExecutionResult,
  TimelineEntry,
  TimelineEntryType,
  Evidence,
  EvidenceSchema,
  IncidentStatus,
  IncidentSeverity,
  IncidentType,
  IncidentReport,
  IncidentMetrics,
  IncidentEvent,
  IncidentEventHandler,
  EscalationConfig,
  TriggerCondition,
  IncidentManagerConfig,
  NotificationConfig,
  ExecutionState,
  Alert,
} from './types.js';
import { NotificationService, NotificationServiceConfig } from './notification.js';
import { PlaybookExecutor, createPlaybookExecutor } from './executor.js';
import { IncidentTrigger, createIncidentTrigger } from './triggers.js';
import { builtInActions } from './actions/index.js';
import { dataBreachPlaybook } from './playbooks/data-breach.js';
import { accountCompromisePlaybook } from './playbooks/account-compromise.js';

const logger = createLogger({ component: 'incident-response' });

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: IncidentManagerConfig = {
  defaultEscalation: {
    enabled: true,
    levels: [
      {
        level: 1,
        afterMinutes: 15,
        targets: ['oncall'],
        channels: ['slack', 'pagerduty'],
      },
      {
        level: 2,
        afterMinutes: 30,
        targets: ['security-lead'],
        channels: ['slack', 'pagerduty', 'email'],
      },
      {
        level: 3,
        afterMinutes: 60,
        targets: ['ciso'],
        channels: ['pagerduty', 'email', 'sms'],
      },
    ],
    maxLevel: 3,
    resetOnAcknowledge: true,
  },
  notificationDefaults: {
    enabled: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  autoAssignment: {
    enabled: false,
    rules: [],
  },
  retentionDays: 365,
  webhooks: {},
  automation: {
    enabled: true,
    maxConcurrentExecutions: 10,
    defaultStepTimeoutMs: 60000,
    persistState: true,
    stateStorage: {
      type: 'memory',
    },
  },
};

// ============================================================================
// Incident Manager Class
// ============================================================================

export class IncidentManager {
  private incidents: Map<string, Incident> = new Map();
  private playbooks: Map<string, Playbook> = new Map();
  private eventHandlers: Set<IncidentEventHandler> = new Set();
  private escalationTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private executionContexts: Map<string, PlaybookExecutionContext> = new Map();
  private config: IncidentManagerConfig;
  private notificationService: NotificationService;
  private executor: PlaybookExecutor;
  private trigger: IncidentTrigger;
  private automationEnabled: boolean;

  constructor(
    config: Partial<IncidentManagerConfig> = {},
    notificationConfig: NotificationServiceConfig = {}
  ) {
    this.config = { ...defaultConfig, ...config };
    this.notificationService = new NotificationService(notificationConfig);
    this.automationEnabled = this.config.automation?.enabled ?? true;

    // Initialize the playbook executor
    this.executor = createPlaybookExecutor({
      maxConcurrentSteps: this.config.automation?.maxConcurrentExecutions ?? 5,
      defaultStepTimeoutMs: this.config.automation?.defaultStepTimeoutMs ?? 60000,
      enableAutoRollback: true,
      persistState: this.config.automation?.persistState ?? true,
    });

    // Register executor handlers
    this.executor.registerHandlers({
      updateIncident: async (incidentId, updates) => {
        await this.updateIncident(incidentId, updates);
      },
      addEvidence: async (incidentId, evidence) => {
        return this.addEvidence(incidentId, evidence);
      },
    });

    // Register built-in actions
    for (const action of builtInActions) {
      this.executor.registerAction(action);
    }

    // Set up executor event handlers
    this.setupExecutorEvents();

    // Initialize the incident trigger
    this.trigger = createIncidentTrigger({
      enabled: this.automationEnabled,
    });

    // Register incident creator with trigger
    this.trigger.registerIncidentCreator(async (input) => {
      const incident = await this.createIncident(input);
      return { id: incident.id };
    });

    // Register built-in playbooks
    this.registerPlaybook(dataBreachPlaybook);
    this.registerPlaybook(accountCompromisePlaybook);

    // Register playbooks with trigger for auto-selection
    this.trigger.registerPlaybooks(Array.from(this.playbooks.values()));

    logger.info('IncidentManager initialized', {
      playbooksRegistered: this.playbooks.size,
      autoAssignment: this.config.autoAssignment.enabled,
      automationEnabled: this.automationEnabled,
      actionsRegistered: builtInActions.length,
    });
  }

  /**
   * Set up event handlers for the executor
   */
  private setupExecutorEvents(): void {
    this.executor.on('execution:started', (state: PlaybookExecutionState) => {
      this.emitEvent({
        type: 'playbook_started',
        incidentId: state.incidentId,
        timestamp: new Date(),
        data: { executionId: state.executionId, playbookId: state.playbookId },
      });
    });

    this.executor.on('execution:completed', (state: PlaybookExecutionState) => {
      const incident = this.incidents.get(state.incidentId);
      if (incident) {
        incident.timeline.push(this.createTimelineEntry(
          TimelineEntryType.PLAYBOOK_STEP_COMPLETED,
          'system',
          `Playbook execution completed`,
          true
        ));
      }

      this.emitEvent({
        type: 'playbook_completed',
        incidentId: state.incidentId,
        timestamp: new Date(),
        data: { executionId: state.executionId, playbookId: state.playbookId },
      });
    });

    this.executor.on('execution:failed', (state: PlaybookExecutionState, error: string) => {
      const incident = this.incidents.get(state.incidentId);
      if (incident) {
        incident.timeline.push(this.createTimelineEntry(
          TimelineEntryType.PLAYBOOK_STEP_FAILED,
          'system',
          `Playbook execution failed: ${error}`,
          true
        ));
      }

      this.emitEvent({
        type: 'playbook_failed',
        incidentId: state.incidentId,
        timestamp: new Date(),
        data: { executionId: state.executionId, error },
      });
    });

    this.executor.on('execution:paused', (state: PlaybookExecutionState, reason: string) => {
      const incident = this.incidents.get(state.incidentId);
      if (incident) {
        incident.timeline.push(this.createTimelineEntry(
          TimelineEntryType.COMMENT,
          'system',
          `Playbook paused: ${reason}`,
          true
        ));
      }
    });

    this.executor.on('step:waiting', (executionId: string, stepId: string, reason: 'approval' | 'manual') => {
      this.executor.getExecutionState(executionId).then((state) => {
        if (!state) return;

        const incident = this.incidents.get(state.incidentId);
        const playbook = this.playbooks.get(state.playbookId);
        const step = playbook?.steps.find((s) => s.id === stepId);

        if (incident && step) {
          incident.timeline.push(this.createTimelineEntry(
            TimelineEntryType.COMMENT,
            'system',
            reason === 'approval'
              ? `Step "${step.name}" awaiting approval`
              : `Manual step "${step.name}" awaiting completion`,
            true
          ));

          // Send notification for manual steps
          if (playbook) {
            this.notifyStepWaiting(incident, playbook, step, reason);
          }
        }
      });
    });

    this.executor.on('step:completed', (executionId: string, stepId: string, result: StepExecutionResult) => {
      this.executor.getExecutionState(executionId).then((state) => {
        if (!state) return;

        const incident = this.incidents.get(state.incidentId);
        const playbook = this.playbooks.get(state.playbookId);
        const step = playbook?.steps.find((s) => s.id === stepId);

        if (incident && step) {
          incident.playbookProgress![stepId] = 'completed';

          this.emitEvent({
            type: 'step_completed',
            incidentId: state.incidentId,
            timestamp: new Date(),
            data: { stepId, stepName: step.name, result },
          });
        }
      });
    });

    this.executor.on('step:failed', (executionId: string, stepId: string, error: string) => {
      this.executor.getExecutionState(executionId).then((state) => {
        if (!state) return;

        const incident = this.incidents.get(state.incidentId);
        const playbook = this.playbooks.get(state.playbookId);
        const step = playbook?.steps.find((s) => s.id === stepId);

        if (incident && step) {
          incident.playbookProgress![stepId] = 'failed';

          incident.timeline.push(this.createTimelineEntry(
            TimelineEntryType.PLAYBOOK_STEP_FAILED,
            'system',
            `Step "${step.name}" failed: ${error}`,
            true
          ));

          this.emitEvent({
            type: 'step_failed',
            incidentId: state.incidentId,
            timestamp: new Date(),
            data: { stepId, stepName: step.name, error },
          });
        }
      });
    });
  }

  /**
   * Send notification when a step is waiting for action
   */
  private async notifyStepWaiting(
    incident: Incident,
    playbook: Playbook,
    step: PlaybookStep,
    reason: 'approval' | 'manual'
  ): Promise<void> {
    const message = reason === 'approval'
      ? `Playbook step "${step.name}" requires approval before execution`
      : `Manual step "${step.name}" is ready for execution`;

    // Send to playbook notifications
    const payload = {
      incidentId: incident.id,
      title: `Action Required: ${incident.title}`,
      message: `${message}\n\nIncident: ${incident.title}\nSeverity: ${incident.severity}\nStep: ${step.name}\n\n${step.description}`,
      severity: incident.severity,
      status: incident.status,
      additionalData: {
        stepId: step.id,
        stepName: step.name,
        action: reason,
        approvers: step.approvers,
      },
    };

    await this.notificationService.sendMultiple(playbook.notifications, payload);
  }

  // ============================================================================
  // Incident Lifecycle Management
  // ============================================================================

  /**
   * Create a new incident
   */
  async createIncident(input: CreateIncidentInput): Promise<Incident> {
    // Validate input
    const validatedInput = CreateIncidentSchema.parse(input);

    const now = new Date();
    const incident: Incident = {
      ...validatedInput,
      id: uuidv4(),
      timeline: [],
      evidence: [],
      playbookProgress: {},
      detectedAt: validatedInput.detectedAt || now,
      affectedResources: validatedInput.affectedResources || [],
    };

    // Add creation timeline entry
    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.CREATED,
      'system',
      `Incident created: ${incident.title}`,
      true
    ));

    // Validate full incident
    IncidentSchema.parse(incident);

    // Store incident
    this.incidents.set(incident.id, incident);

    logger.info('Incident created', {
      incidentId: incident.id,
      severity: incident.severity,
      type: incident.type,
    });

    // Auto-assignment if enabled
    if (this.config.autoAssignment.enabled) {
      await this.tryAutoAssign(incident);
    }

    // Find and attach matching playbook
    const matchingPlaybook = this.findMatchingPlaybook(incident);
    if (matchingPlaybook) {
      incident.playbook = matchingPlaybook.id;
      await this.startPlaybook(incident.id, matchingPlaybook.id);
    }

    // Send notifications
    if (matchingPlaybook) {
      await this.notificationService.notifyIncidentCreated(incident, matchingPlaybook.notifications);
    }

    // Start escalation timer
    this.startEscalationTimer(incident);

    // Emit event
    await this.emitEvent({
      type: 'incident_created',
      incidentId: incident.id,
      timestamp: now,
      data: { incident },
    });

    return incident;
  }

  /**
   * Update an existing incident
   */
  async updateIncident(incidentId: string, updates: UpdateIncidentInput): Promise<Incident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    // Validate updates
    const validatedUpdates = UpdateIncidentSchema.parse(updates);
    const previousStatus = incident.status;

    // Apply updates
    Object.assign(incident, validatedUpdates);

    // Handle status transitions
    if (validatedUpdates.status && validatedUpdates.status !== previousStatus) {
      await this.handleStatusTransition(incident, previousStatus, validatedUpdates.status);
    }

    // Handle assignment changes
    if (validatedUpdates.assignee && validatedUpdates.assignee !== incident.assignee) {
      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.ASSIGNMENT,
        'system',
        `Incident assigned to ${validatedUpdates.assignee}`
      ));
    }

    logger.info('Incident updated', {
      incidentId,
      updates: Object.keys(validatedUpdates),
    });

    await this.emitEvent({
      type: 'incident_updated',
      incidentId,
      timestamp: new Date(),
      data: { updates: validatedUpdates },
    });

    return incident;
  }

  /**
   * Get an incident by ID
   */
  getIncident(incidentId: string): Incident | undefined {
    return this.incidents.get(incidentId);
  }

  /**
   * Get all incidents with optional filters
   */
  getIncidents(filters?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    type?: IncidentType;
    assignee?: string;
    fromDate?: Date;
    toDate?: Date;
  }): Incident[] {
    let incidents = Array.from(this.incidents.values());

    if (filters) {
      if (filters.status) {
        incidents = incidents.filter(i => i.status === filters.status);
      }
      if (filters.severity) {
        incidents = incidents.filter(i => i.severity === filters.severity);
      }
      if (filters.type) {
        incidents = incidents.filter(i => i.type === filters.type);
      }
      if (filters.assignee) {
        incidents = incidents.filter(i => i.assignee === filters.assignee);
      }
      if (filters.fromDate) {
        incidents = incidents.filter(i => i.detectedAt >= filters.fromDate!);
      }
      if (filters.toDate) {
        incidents = incidents.filter(i => i.detectedAt <= filters.toDate!);
      }
    }

    return incidents.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  /**
   * Acknowledge an incident
   */
  async acknowledgeIncident(incidentId: string, acknowledger: string): Promise<Incident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const now = new Date();
    incident.acknowledgedAt = now;

    if (incident.status === IncidentStatus.DETECTED) {
      incident.status = IncidentStatus.INVESTIGATING;
    }

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.STATUS_CHANGE,
      acknowledger,
      'Incident acknowledged'
    ));

    // Reset escalation if configured
    const playbook = incident.playbook ? this.playbooks.get(incident.playbook) : undefined;
    if (playbook?.escalation.resetOnAcknowledge) {
      this.clearEscalationTimers(incidentId);
    }

    logger.info('Incident acknowledged', { incidentId, acknowledger });

    return incident;
  }

  /**
   * Close an incident
   */
  async closeIncident(
    incidentId: string,
    closedBy: string,
    resolution: { rootCause?: string; remediation?: string; lessonsLearned?: string }
  ): Promise<Incident> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const now = new Date();
    incident.status = IncidentStatus.CLOSED;
    incident.closedAt = now;
    incident.resolvedAt = incident.resolvedAt || now;

    if (resolution.rootCause) incident.rootCause = resolution.rootCause;
    if (resolution.remediation) incident.remediation = resolution.remediation;
    if (resolution.lessonsLearned) incident.lessonsLearned = resolution.lessonsLearned;

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.RESOLUTION,
      closedBy,
      'Incident closed'
    ));

    // Clear escalation timers
    this.clearEscalationTimers(incidentId);

    // Notify resolution
    const playbook = incident.playbook ? this.playbooks.get(incident.playbook) : undefined;
    if (playbook) {
      await this.notificationService.notifyIncidentResolved(incident, playbook.notifications);
    }

    logger.info('Incident closed', { incidentId, closedBy });

    await this.emitEvent({
      type: 'incident_closed',
      incidentId,
      timestamp: now,
      data: { resolution },
    });

    return incident;
  }

  // ============================================================================
  // Evidence Management
  // ============================================================================

  /**
   * Add evidence to an incident
   */
  async addEvidence(
    incidentId: string,
    evidence: Omit<Evidence, 'id' | 'collectedAt'>
  ): Promise<Evidence> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const fullEvidence: Evidence = {
      ...evidence,
      id: uuidv4(),
      collectedAt: new Date(),
    };

    EvidenceSchema.parse(fullEvidence);
    incident.evidence.push(fullEvidence);

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.EVIDENCE_ADDED,
      evidence.collectedBy,
      `Evidence added: ${evidence.name}`
    ));

    logger.info('Evidence added', {
      incidentId,
      evidenceId: fullEvidence.id,
      type: evidence.type,
    });

    await this.emitEvent({
      type: 'evidence_added',
      incidentId,
      timestamp: new Date(),
      data: { evidence: fullEvidence },
    });

    return fullEvidence;
  }

  /**
   * Add a comment to the incident timeline
   */
  async addComment(incidentId: string, author: string, comment: string): Promise<void> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.COMMENT,
      author,
      comment
    ));

    logger.debug('Comment added to incident', { incidentId, author });
  }

  // ============================================================================
  // Playbook Management
  // ============================================================================

  /**
   * Register a playbook
   */
  registerPlaybook(input: PlaybookInput): void {
    // Normalize PlaybookInput to Playbook with defaults
    const normalizedSteps: PlaybookStep[] = input.steps.map((step: PlaybookStepInput) => ({
      ...step,
      requiresApproval: step.requiresApproval ?? false,
      onFailure: step.onFailure ?? 'halt',
      retryAttempts: step.retryAttempts ?? 0,
    }));

    const playbook: Playbook = {
      ...input,
      version: input.version ?? '1.0.0',
      enabled: input.enabled ?? true,
      steps: normalizedSteps,
    };

    this.playbooks.set(playbook.id, playbook);
    logger.info('Playbook registered', { playbookId: playbook.id, name: playbook.name });
  }

  /**
   * Get a playbook by ID
   */
  getPlaybook(playbookId: string): Playbook | undefined {
    return this.playbooks.get(playbookId);
  }

  /**
   * Get all registered playbooks
   */
  getPlaybooks(): Playbook[] {
    return Array.from(this.playbooks.values());
  }

  /**
   * Start executing a playbook for an incident
   */
  async startPlaybook(incidentId: string, playbookId: string): Promise<void> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const playbook = this.playbooks.get(playbookId);
    if (!playbook) {
      throw new Error(`Playbook not found: ${playbookId}`);
    }

    // Initialize execution context
    const context: PlaybookExecutionContext = {
      incident,
      playbook,
      currentStepIndex: 0,
      startedAt: new Date(),
      completedSteps: [],
      failedSteps: [],
      skippedSteps: [],
      variables: {},
    };

    this.executionContexts.set(incidentId, context);

    // Initialize playbook progress
    incident.playbookProgress = {};
    for (const step of playbook.steps) {
      incident.playbookProgress[step.id] = 'pending';
    }

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.PLAYBOOK_STARTED,
      'system',
      `Playbook started: ${playbook.name}`,
      true
    ));

    logger.info('Playbook started', { incidentId, playbookId });

    await this.emitEvent({
      type: 'playbook_started',
      incidentId,
      timestamp: new Date(),
      data: { playbookId },
    });

    // Execute first automated steps
    await this.executeNextSteps(incidentId);
  }

  /**
   * Execute a specific playbook step
   */
  async executeStep(incidentId: string, stepId: string): Promise<StepExecutionResult> {
    const context = this.executionContexts.get(incidentId);
    if (!context) {
      throw new Error(`No playbook execution context for incident: ${incidentId}`);
    }

    const step = context.playbook.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const incident = this.incidents.get(incidentId)!;
    const startTime = new Date();
    let result: StepExecutionResult = {
      stepId,
      success: false,
      startedAt: startTime,
      completedAt: startTime,
      duration: 0,
      retryCount: 0,
    };

    // Check dependencies
    if (step.dependencies?.length) {
      const unmetDeps = step.dependencies.filter(
        depId => !context.completedSteps.includes(depId)
      );
      if (unmetDeps.length > 0) {
        throw new Error(`Unmet dependencies: ${unmetDeps.join(', ')}`);
      }
    }

    // Update progress
    incident.playbookProgress![stepId] = 'in_progress';

    logger.info('Executing playbook step', {
      incidentId,
      stepId,
      stepName: step.name,
      type: step.type,
    });

    if (step.type === 'manual') {
      // Manual steps are marked as completed when acknowledged
      result.success = true;
      result.completedAt = new Date();
      result.duration = result.completedAt.getTime() - startTime.getTime();
    } else if (step.action) {
      // Execute automated step
      const maxRetries = step.retryAttempts || 0;

      while (result.retryCount <= maxRetries) {
        try {
          const timeout = step.timeout || 30000;
          await Promise.race([
            step.action(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Step timeout')), timeout)
            ),
          ]);

          result.success = true;
          break;
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
          result.retryCount++;

          logger.warn('Step execution failed', {
            incidentId,
            stepId,
            error: result.error,
            retryCount: result.retryCount,
          });

          if (result.retryCount <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      result.completedAt = new Date();
      result.duration = result.completedAt.getTime() - startTime.getTime();
    }

    // Update context and progress
    if (result.success) {
      context.completedSteps.push(stepId);
      incident.playbookProgress![stepId] = 'completed';

      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.PLAYBOOK_STEP_COMPLETED,
        'system',
        `Step completed: ${step.name}`,
        true
      ));

      await this.emitEvent({
        type: 'step_completed',
        incidentId,
        timestamp: new Date(),
        data: { stepId, result },
      });
    } else {
      context.failedSteps.push(stepId);
      incident.playbookProgress![stepId] = 'failed';

      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.PLAYBOOK_STEP_FAILED,
        'system',
        `Step failed: ${step.name} - ${result.error}`,
        true
      ));

      await this.emitEvent({
        type: 'step_failed',
        incidentId,
        timestamp: new Date(),
        data: { stepId, result },
      });

      // Handle failure based on step configuration
      if (step.onFailure === 'halt') {
        logger.error('Playbook halted due to step failure', { incidentId, stepId });
        return result;
      }
    }

    // Continue with next steps if possible
    await this.executeNextSteps(incidentId);

    return result;
  }

  /**
   * Mark a manual step as completed
   */
  async completeManualStep(incidentId: string, stepId: string, completedBy: string): Promise<void> {
    const context = this.executionContexts.get(incidentId);
    if (!context) {
      throw new Error(`No playbook execution context for incident: ${incidentId}`);
    }

    const step = context.playbook.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    if (step.type !== 'manual') {
      throw new Error(`Step ${stepId} is not a manual step`);
    }

    const incident = this.incidents.get(incidentId)!;

    context.completedSteps.push(stepId);
    incident.playbookProgress![stepId] = 'completed';

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.PLAYBOOK_STEP_COMPLETED,
      completedBy,
      `Manual step completed: ${step.name}`
    ));

    logger.info('Manual step completed', { incidentId, stepId, completedBy });

    await this.emitEvent({
      type: 'step_completed',
      incidentId,
      timestamp: new Date(),
      data: { stepId, completedBy },
    });

    // Continue with next steps
    await this.executeNextSteps(incidentId);
  }

  /**
   * Approve a step that requires approval
   */
  async approveStep(incidentId: string, stepId: string, approver: string): Promise<void> {
    const context = this.executionContexts.get(incidentId);
    if (!context) {
      throw new Error(`No playbook execution context for incident: ${incidentId}`);
    }

    const step = context.playbook.steps.find(s => s.id === stepId);
    if (!step || !step.requiresApproval) {
      throw new Error(`Step ${stepId} does not require approval`);
    }

    // Store approval in context
    context.variables[`${stepId}_approved`] = true;
    context.variables[`${stepId}_approver`] = approver;

    const incident = this.incidents.get(incidentId)!;
    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.COMMENT,
      approver,
      `Approved step: ${step.name}`
    ));

    logger.info('Step approved', { incidentId, stepId, approver });

    // Execute the step now that it's approved
    await this.executeStep(incidentId, stepId);
  }

  /**
   * Get playbook execution status
   */
  getPlaybookStatus(incidentId: string): {
    inProgress: boolean;
    completedSteps: number;
    totalSteps: number;
    pendingApprovals: string[];
    pendingManualSteps: string[];
    failedSteps: string[];
  } | null {
    const context = this.executionContexts.get(incidentId);
    if (!context) {
      return null;
    }

    const incident = this.incidents.get(incidentId)!;
    const pendingApprovals: string[] = [];
    const pendingManualSteps: string[] = [];

    for (const step of context.playbook.steps) {
      if (incident.playbookProgress![step.id] === 'pending') {
        if (step.requiresApproval && !context.variables[`${step.id}_approved`]) {
          pendingApprovals.push(step.id);
        } else if (step.type === 'manual') {
          pendingManualSteps.push(step.id);
        }
      }
    }

    return {
      inProgress: context.completedSteps.length < context.playbook.steps.length,
      completedSteps: context.completedSteps.length,
      totalSteps: context.playbook.steps.length,
      pendingApprovals,
      pendingManualSteps,
      failedSteps: context.failedSteps,
    };
  }

  // ============================================================================
  // Escalation Management
  // ============================================================================

  private startEscalationTimer(incident: Incident): void {
    const playbook = incident.playbook ? this.playbooks.get(incident.playbook) : undefined;
    const escalation = playbook?.escalation || this.config.defaultEscalation;

    if (!escalation.enabled) {
      return;
    }

    const timers: NodeJS.Timeout[] = [];

    for (const level of escalation.levels) {
      const timer = setTimeout(async () => {
        // Check if incident is still active
        const currentIncident = this.incidents.get(incident.id);
        if (!currentIncident ||
            currentIncident.status === IncidentStatus.CLOSED ||
            currentIncident.status === IncidentStatus.RECOVERED) {
          return;
        }

        // Check if already acknowledged (if reset on acknowledge is enabled)
        if (escalation.resetOnAcknowledge && currentIncident.acknowledgedAt) {
          return;
        }

        logger.info('Escalating incident', {
          incidentId: incident.id,
          level: level.level,
        });

        currentIncident.timeline.push(this.createTimelineEntry(
          TimelineEntryType.ESCALATION,
          'system',
          `Escalated to level ${level.level}`,
          true
        ));

        // Send escalation notifications
        await this.notificationService.sendEscalation(currentIncident, level);

        await this.emitEvent({
          type: 'escalation_triggered',
          incidentId: incident.id,
          timestamp: new Date(),
          data: { level: level.level },
        });

      }, level.afterMinutes * 60 * 1000);

      timers.push(timer);
    }

    this.escalationTimers.set(incident.id, timers);
  }

  private clearEscalationTimers(incidentId: string): void {
    const timers = this.escalationTimers.get(incidentId);
    if (timers) {
      timers.forEach(timer => clearTimeout(timer));
      this.escalationTimers.delete(incidentId);
    }
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  /**
   * Generate an incident report
   */
  generateReport(incidentId: string, generatedBy: string): IncidentReport {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const now = new Date();
    const duration = (incident.closedAt || now).getTime() - incident.detectedAt.getTime();

    const context = this.executionContexts.get(incidentId);
    const playbookStepsCompleted = context?.completedSteps.length || 0;
    const playbookStepsTotal = context?.playbook.steps.length || 0;

    const notificationEntries = incident.timeline.filter(
      e => e.type === TimelineEntryType.NOTIFICATION_SENT
    );

    const report: IncidentReport = {
      incident,
      generatedAt: now,
      generatedBy,
      summary: {
        duration,
        timeToDetect: incident.detectedAt.getTime() - incident.detectedAt.getTime(), // Would need original detection time
        timeToContain: incident.containedAt
          ? incident.containedAt.getTime() - incident.detectedAt.getTime()
          : undefined,
        timeToResolve: incident.resolvedAt
          ? incident.resolvedAt.getTime() - incident.detectedAt.getTime()
          : undefined,
        escalationLevel: incident.timeline.filter(e => e.type === TimelineEntryType.ESCALATION).length,
        playbookStepsCompleted,
        playbookStepsTotal,
        evidenceCount: incident.evidence.length,
        notificationsSent: notificationEntries.length,
      },
      timelineFormatted: this.formatTimeline(incident.timeline),
      recommendations: this.generateRecommendations(incident),
    };

    logger.info('Incident report generated', { incidentId, generatedBy });

    return report;
  }

  /**
   * Get incident metrics
   */
  getMetrics(fromDate?: Date, toDate?: Date): IncidentMetrics {
    let incidents = Array.from(this.incidents.values());

    if (fromDate) {
      incidents = incidents.filter(i => i.detectedAt >= fromDate);
    }
    if (toDate) {
      incidents = incidents.filter(i => i.detectedAt <= toDate);
    }

    const metrics: IncidentMetrics = {
      totalIncidents: incidents.length,
      byStatus: {
        detected: 0,
        investigating: 0,
        contained: 0,
        eradicated: 0,
        recovered: 0,
        closed: 0,
      },
      bySeverity: {
        P1: 0,
        P2: 0,
        P3: 0,
        P4: 0,
      },
      byType: {} as Record<IncidentType, number>,
      averageTimeToDetect: 0,
      averageTimeToContain: 0,
      averageTimeToResolve: 0,
      averageTimeToClose: 0,
    };

    // Initialize type counts
    Object.values(IncidentType).forEach(type => {
      metrics.byType[type] = 0;
    });

    let totalTimeToContain = 0;
    let containedCount = 0;
    let totalTimeToResolve = 0;
    let resolvedCount = 0;
    let totalTimeToClose = 0;
    let closedCount = 0;

    for (const incident of incidents) {
      metrics.byStatus[incident.status]++;
      metrics.bySeverity[incident.severity]++;
      metrics.byType[incident.type]++;

      if (incident.containedAt) {
        totalTimeToContain += incident.containedAt.getTime() - incident.detectedAt.getTime();
        containedCount++;
      }
      if (incident.resolvedAt) {
        totalTimeToResolve += incident.resolvedAt.getTime() - incident.detectedAt.getTime();
        resolvedCount++;
      }
      if (incident.closedAt) {
        totalTimeToClose += incident.closedAt.getTime() - incident.detectedAt.getTime();
        closedCount++;
      }
    }

    if (containedCount > 0) {
      metrics.averageTimeToContain = totalTimeToContain / containedCount;
    }
    if (resolvedCount > 0) {
      metrics.averageTimeToResolve = totalTimeToResolve / resolvedCount;
    }
    if (closedCount > 0) {
      metrics.averageTimeToClose = totalTimeToClose / closedCount;
    }

    return metrics;
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Subscribe to incident events
   */
  onEvent(handler: IncidentEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private createTimelineEntry(
    type: TimelineEntryType,
    actor: string,
    description: string,
    automated: boolean = false,
    metadata?: Record<string, unknown>
  ): TimelineEntry {
    return {
      id: uuidv4(),
      timestamp: new Date(),
      type,
      actor,
      description,
      automated,
      metadata,
    };
  }

  private async handleStatusTransition(
    incident: Incident,
    fromStatus: IncidentStatus,
    toStatus: IncidentStatus
  ): Promise<void> {
    const now = new Date();

    switch (toStatus) {
      case IncidentStatus.INVESTIGATING:
        if (!incident.acknowledgedAt) {
          incident.acknowledgedAt = now;
        }
        break;
      case IncidentStatus.CONTAINED:
        incident.containedAt = now;
        break;
      case IncidentStatus.RECOVERED:
        incident.resolvedAt = now;
        break;
      case IncidentStatus.CLOSED:
        incident.closedAt = now;
        if (!incident.resolvedAt) {
          incident.resolvedAt = now;
        }
        break;
    }

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.STATUS_CHANGE,
      'system',
      `Status changed from ${fromStatus} to ${toStatus}`,
      true
    ));

    logger.info('Incident status changed', {
      incidentId: incident.id,
      fromStatus,
      toStatus,
    });
  }

  private findMatchingPlaybook(incident: Incident): Playbook | undefined {
    const playbooks = Array.from(this.playbooks.values());
    for (const playbook of playbooks) {
      if (!playbook.enabled) continue;

      const matches = this.evaluateTriggerConditions(incident, playbook.triggerConditions);
      if (matches) {
        return playbook;
      }
    }
    return undefined;
  }

  private evaluateTriggerConditions(incident: Incident, conditions: TriggerCondition[]): boolean {
    if (conditions.length === 0) return false;

    let result = false;
    let useOr = false;

    for (const condition of conditions) {
      const fieldValue = (incident as Record<string, unknown>)[condition.field];
      let conditionResult = false;

      switch (condition.operator) {
        case 'equals':
          conditionResult = fieldValue === condition.value;
          break;
        case 'contains':
          conditionResult = String(fieldValue).includes(String(condition.value));
          break;
        case 'matches':
          conditionResult = new RegExp(String(condition.value)).test(String(fieldValue));
          break;
        case 'gt':
          conditionResult = Number(fieldValue) > Number(condition.value);
          break;
        case 'lt':
          conditionResult = Number(fieldValue) < Number(condition.value);
          break;
        case 'gte':
          conditionResult = Number(fieldValue) >= Number(condition.value);
          break;
        case 'lte':
          conditionResult = Number(fieldValue) <= Number(condition.value);
          break;
        case 'in':
          conditionResult = Array.isArray(condition.value) && condition.value.includes(fieldValue);
          break;
        case 'not_in':
          conditionResult = Array.isArray(condition.value) && !condition.value.includes(fieldValue);
          break;
      }

      if (useOr) {
        result = result || conditionResult;
      } else {
        result = conditions.indexOf(condition) === 0 ? conditionResult : result && conditionResult;
      }

      useOr = condition.logicalOperator === 'or';
    }

    return result;
  }

  private async tryAutoAssign(incident: Incident): Promise<void> {
    for (const rule of this.config.autoAssignment.rules) {
      if (this.evaluateTriggerConditions(incident, rule.conditions)) {
        incident.assignee = rule.assignee;
        incident.timeline.push(this.createTimelineEntry(
          TimelineEntryType.ASSIGNMENT,
          'system',
          `Auto-assigned to ${rule.assignee}`,
          true
        ));
        break;
      }
    }
  }

  private async executeNextSteps(incidentId: string): Promise<void> {
    const context = this.executionContexts.get(incidentId);
    if (!context) return;

    const incident = this.incidents.get(incidentId)!;

    for (const step of context.playbook.steps) {
      // Skip completed or failed steps
      if (context.completedSteps.includes(step.id) || context.failedSteps.includes(step.id)) {
        continue;
      }

      // Check dependencies
      if (step.dependencies?.length) {
        const unmetDeps = step.dependencies.filter(
          depId => !context.completedSteps.includes(depId)
        );
        if (unmetDeps.length > 0) {
          continue;
        }
      }

      // Check if step requires approval
      if (step.requiresApproval && !context.variables[`${step.id}_approved`]) {
        logger.info('Step awaiting approval', { incidentId, stepId: step.id });
        continue;
      }

      // Execute automated steps
      if (step.type === 'automated') {
        await this.executeStep(incidentId, step.id);
      }
    }

    // Check if playbook is complete
    const allStepsComplete = context.playbook.steps.every(
      step => context.completedSteps.includes(step.id) ||
              context.failedSteps.includes(step.id) ||
              context.skippedSteps.includes(step.id)
    );

    if (allStepsComplete) {
      logger.info('Playbook completed', { incidentId, playbookId: context.playbook.id });

      await this.emitEvent({
        type: 'playbook_completed',
        incidentId,
        timestamp: new Date(),
        data: {
          playbookId: context.playbook.id,
          completedSteps: context.completedSteps.length,
          failedSteps: context.failedSteps.length,
        },
      });
    }
  }

  private async emitEvent(event: IncidentEvent): Promise<void> {
    const handlers = Array.from(this.eventHandlers);
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error('Event handler error', { error, eventType: event.type });
      }
    }
  }

  private formatTimeline(timeline: TimelineEntry[]): string {
    return timeline
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(entry => {
        const time = entry.timestamp.toISOString();
        const actor = entry.automated ? '[SYSTEM]' : entry.actor;
        return `[${time}] ${actor}: ${entry.description}`;
      })
      .join('\n');
  }

  private generateRecommendations(incident: Incident): string[] {
    const recommendations: string[] = [];

    // Time-based recommendations
    if (incident.containedAt && incident.detectedAt) {
      const containmentTime = incident.containedAt.getTime() - incident.detectedAt.getTime();
      if (containmentTime > 60 * 60 * 1000) { // More than 1 hour
        recommendations.push('Consider implementing automated containment procedures to reduce time to contain');
      }
    }

    // Severity-based recommendations
    if (incident.severity === 'P1' && !incident.lessonsLearned) {
      recommendations.push('Document lessons learned from this critical incident');
    }

    // Type-based recommendations
    if (incident.type === IncidentType.DATA_BREACH) {
      recommendations.push('Review data classification and access controls');
      recommendations.push('Consider implementing additional DLP measures');
    }

    if (incident.type === IncidentType.ACCOUNT_COMPROMISE) {
      recommendations.push('Review authentication policies and MFA coverage');
      recommendations.push('Consider implementing credential monitoring');
    }

    // Evidence-based recommendations
    if (incident.evidence.length === 0) {
      recommendations.push('Ensure evidence is properly collected and documented for future incidents');
    }

    return recommendations;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear all escalation timers
    const incidentIds = Array.from(this.escalationTimers.keys());
    for (const incidentId of incidentIds) {
      this.clearEscalationTimers(incidentId);
    }

    this.eventHandlers.clear();
    this.trigger.destroy();
    logger.info('IncidentManager destroyed');
  }

  // ============================================================================
  // Automation API
  // ============================================================================

  /**
   * Process an alert and potentially create an incident
   */
  async processAlert(alert: Alert): Promise<{ incidentCreated: boolean; incidentId?: string; reason?: string }> {
    if (!this.automationEnabled) {
      return { incidentCreated: false, reason: 'Automation disabled' };
    }

    return this.trigger.processAlert(alert);
  }

  /**
   * Get playbook execution state for an incident
   */
  async getExecutionState(incidentId: string): Promise<PlaybookExecutionState | null> {
    return this.executor.getExecutionByIncident(incidentId);
  }

  /**
   * Approve a step in a playbook execution
   */
  async approvePlaybookStep(incidentId: string, stepId: string, approver: string): Promise<void> {
    const state = await this.executor.getExecutionByIncident(incidentId);
    if (!state) {
      throw new Error(`No active execution for incident: ${incidentId}`);
    }

    const incident = this.incidents.get(incidentId);
    const playbook = incident?.playbook ? this.playbooks.get(incident.playbook) : undefined;

    await this.executor.approveStep(state.executionId, stepId, approver);

    if (incident) {
      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.COMMENT,
        approver,
        `Approved step: ${stepId}`
      ));
    }

    // Resume execution if paused
    if (state.state === ExecutionState.WAITING_APPROVAL && playbook && incident) {
      await this.executor.resumeExecution(state.executionId, incident, playbook);
    }
  }

  /**
   * Complete a manual step in a playbook execution
   */
  async completeManualPlaybookStep(
    incidentId: string,
    stepId: string,
    completedBy: string,
    output?: unknown
  ): Promise<void> {
    const state = await this.executor.getExecutionByIncident(incidentId);
    if (!state) {
      throw new Error(`No active execution for incident: ${incidentId}`);
    }

    const incident = this.incidents.get(incidentId);
    const playbook = incident?.playbook ? this.playbooks.get(incident.playbook) : undefined;

    await this.executor.completeManualStep(state.executionId, stepId, completedBy, output);

    if (incident) {
      const step = playbook?.steps.find((s) => s.id === stepId);
      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.PLAYBOOK_STEP_COMPLETED,
        completedBy,
        `Completed manual step: ${step?.name || stepId}`
      ));
    }

    // Resume execution if paused
    if (state.state === ExecutionState.WAITING_MANUAL && playbook && incident) {
      await this.executor.resumeExecution(state.executionId, incident, playbook);
    }
  }

  /**
   * Cancel a playbook execution
   */
  async cancelPlaybookExecution(incidentId: string): Promise<void> {
    const state = await this.executor.getExecutionByIncident(incidentId);
    if (!state) {
      throw new Error(`No active execution for incident: ${incidentId}`);
    }

    await this.executor.cancelExecution(state.executionId);

    const incident = this.incidents.get(incidentId);
    if (incident) {
      incident.timeline.push(this.createTimelineEntry(
        TimelineEntryType.COMMENT,
        'system',
        'Playbook execution cancelled',
        true
      ));
    }
  }

  /**
   * Rollback a failed playbook execution
   */
  async rollbackPlaybookExecution(incidentId: string): Promise<void> {
    const state = await this.executor.getExecutionByIncident(incidentId);
    if (!state) {
      throw new Error(`No execution to rollback for incident: ${incidentId}`);
    }

    const incident = this.incidents.get(incidentId);
    const playbook = incident?.playbook ? this.playbooks.get(incident.playbook) : undefined;

    if (!incident || !playbook) {
      throw new Error(`Incident or playbook not found for: ${incidentId}`);
    }

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.COMMENT,
      'system',
      'Starting playbook rollback',
      true
    ));

    await this.executor.rollbackExecution(state.executionId, incident, playbook);

    incident.timeline.push(this.createTimelineEntry(
      TimelineEntryType.COMMENT,
      'system',
      'Playbook rollback completed',
      true
    ));
  }

  /**
   * Get all active playbook executions
   */
  async getActiveExecutions(): Promise<PlaybookExecutionState[]> {
    return this.executor.getActiveExecutions();
  }

  /**
   * Register a custom action with the executor
   */
  registerAction(action: Parameters<typeof this.executor.registerAction>[0]): void {
    this.executor.registerAction(action);
    logger.info('Custom action registered', { actionId: action.id });
  }

  /**
   * Add an alert rule for automatic incident creation
   */
  addAlertRule(rule: Parameters<typeof this.trigger.addRule>[0]): void {
    this.trigger.addRule(rule);
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    return this.trigger.removeRule(ruleId);
  }

  /**
   * Get all alert rules
   */
  getAlertRules(): ReturnType<typeof this.trigger.getRules> {
    return this.trigger.getRules();
  }

  /**
   * Enable or disable automation
   */
  setAutomationEnabled(enabled: boolean): void {
    this.automationEnabled = enabled;
    logger.info('Automation setting changed', { enabled });
  }

  /**
   * Check if automation is enabled
   */
  isAutomationEnabled(): boolean {
    return this.automationEnabled;
  }

  /**
   * Get the executor instance (for advanced usage)
   */
  getExecutor(): PlaybookExecutor {
    return this.executor;
  }

  /**
   * Get the trigger instance (for advanced usage)
   */
  getTrigger(): IncidentTrigger {
    return this.trigger;
  }
}

// ============================================================================
// Factory and Exports
// ============================================================================

export const createIncidentManager = (
  config?: Partial<IncidentManagerConfig>,
  notificationConfig?: NotificationServiceConfig
): IncidentManager => {
  return new IncidentManager(config, notificationConfig);
};

// Re-export types and utilities
export * from './types.js';
export { NotificationService, createNotificationService } from './notification.js';
export { PlaybookExecutor, createPlaybookExecutor } from './executor.js';
export { IncidentTrigger, createIncidentTrigger } from './triggers.js';
export * from './actions/index.js';
export { dataBreachPlaybook } from './playbooks/data-breach.js';
export { accountCompromisePlaybook } from './playbooks/account-compromise.js';
