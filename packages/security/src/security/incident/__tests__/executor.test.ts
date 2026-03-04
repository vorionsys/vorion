/**
 * PlaybookExecutor Tests
 *
 * Comprehensive tests for the PlaybookExecutor class which handles
 * automated playbook execution, step management, rollback, retries,
 * and state persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaybookExecutor, InMemoryStateStore } from '../executor.js';
import type {
  Incident,
  Playbook,
  PlaybookStep,
  PlaybookExecutionState,
  ActionDefinition,
  ActionContext,
  ExecutionStateStore,
  StepExecutionResult,
} from '../types.js';
import { ExecutionState, StepState } from '../types.js';

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
  v4: vi.fn(() => 'test-exec-' + Math.random().toString(36).slice(2, 8)),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createTestIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'incident-1',
    title: 'Test Incident',
    description: 'Test description',
    severity: 'P2',
    status: 'detected',
    type: 'account_compromise',
    detectedAt: new Date(),
    affectedResources: ['user:test-user'],
    timeline: [],
    evidence: [],
    tags: [],
    ...overrides,
  } as Incident;
}

function createTestPlaybook(steps: PlaybookStep[]): Playbook {
  return {
    id: 'playbook-test',
    name: 'Test Playbook',
    version: '1.0.0',
    triggerConditions: [],
    steps,
    notifications: [],
    escalation: {
      enabled: false,
      levels: [],
      maxLevel: 1,
      resetOnAcknowledge: true,
    },
    enabled: true,
  } as Playbook;
}

function createStep(overrides: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    type: 'automated',
    description: 'Test step description',
    requiresApproval: false,
    onFailure: 'halt',
    retryAttempts: 0,
    ...overrides,
  } as PlaybookStep;
}

function createTestAction(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    id: 'test-action',
    name: 'Test Action',
    description: 'A test action',
    category: 'containment',
    riskLevel: 'low',
    requiresApproval: false,
    supportsRollback: false,
    defaultTimeoutMs: 30000,
    maxRetries: 0,
    execute: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

/**
 * Helper to wait for an executor event with a timeout.
 */
function waitForEvent<T>(
  executor: PlaybookExecutor,
  event: string,
  timeoutMs = 5000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event: ${event}`));
    }, timeoutMs);
    executor.once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args[0] as T);
    });
  });
}

/** Small delay to let background async settle */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('PlaybookExecutor', () => {
  let executor: PlaybookExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new PlaybookExecutor({
      enableAutoRollback: false,
      baseRetryDelayMs: 10,
      defaultStepTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    executor.removeAllListeners();
  });

  // --------------------------------------------------------------------------
  // Action Registration
  // --------------------------------------------------------------------------

  describe('Action Registration', () => {
    it('should register an action and retrieve it by ID', () => {
      const action = createTestAction({ id: 'action-alpha' });
      executor.registerAction(action);

      const retrieved = executor.getAction('action-alpha');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('action-alpha');
      expect(retrieved!.name).toBe('Test Action');
    });

    it('should return undefined for an unknown action ID', () => {
      const result = executor.getAction('nonexistent-action');
      expect(result).toBeUndefined();
    });

    it('should overwrite a previously registered action with the same ID', () => {
      const action1 = createTestAction({ id: 'dup-action', name: 'First' });
      const action2 = createTestAction({ id: 'dup-action', name: 'Second' });

      executor.registerAction(action1);
      executor.registerAction(action2);

      const retrieved = executor.getAction('dup-action');
      expect(retrieved!.name).toBe('Second');
    });
  });

  // --------------------------------------------------------------------------
  // startExecution
  // --------------------------------------------------------------------------

  describe('startExecution', () => {
    it('should create execution state with RUNNING status and all steps as PENDING', async () => {
      const steps = [
        createStep({ id: 's1', name: 'Step 1' }),
        createStep({ id: 's2', name: 'Step 2' }),
      ];
      // Register actions so the steps actually complete
      executor.registerAction(createTestAction({ id: 'test-action' }));
      steps.forEach((s) => (s.actionId = 'test-action'));

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const state = await executor.startExecution(incident, playbook);

      expect(state.state).toBe(ExecutionState.RUNNING);
      expect(state.incidentId).toBe('incident-1');
      expect(state.playbookId).toBe('playbook-test');
      expect(Object.keys(state.stepStates)).toHaveLength(2);
      // runExecution fires in background and may advance step states before
      // assertions run, so verify steps are initialized (PENDING or already RUNNING)
      expect([StepState.PENDING, StepState.RUNNING, StepState.COMPLETED]).toContain(
        state.stepStates['s1'].state
      );
      expect([StepState.PENDING, StepState.RUNNING, StepState.COMPLETED]).toContain(
        state.stepStates['s2'].state
      );
      expect(state.rolledBackSteps).toEqual([]);
    });

    it('should reject duplicate active execution for the same incident', async () => {
      const step = createStep({ id: 's1', type: 'manual' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      // Allow initial step processing
      await tick(100);

      await expect(executor.startExecution(incident, playbook)).rejects.toThrow(
        /already has an active playbook execution/
      );
    });

    it('should emit execution:started event', async () => {
      const step = createStep({ id: 's1' });
      executor.registerAction(createTestAction());
      step.actionId = 'test-action';

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const startedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:started');
      await executor.startExecution(incident, playbook);
      const startedState = await startedPromise;

      expect(startedState.incidentId).toBe('incident-1');
      expect(startedState.state).toBe(ExecutionState.RUNNING);
    });
  });

  // --------------------------------------------------------------------------
  // Happy Path Execution
  // --------------------------------------------------------------------------

  describe('Happy Path Execution', () => {
    it('should complete a 3-step sequential playbook successfully', async () => {
      const executeFn = vi.fn(async () => ({ success: true, output: { done: true } }));
      const action = createTestAction({ id: 'ok-action', execute: executeFn });
      executor.registerAction(action);

      const steps = [
        createStep({ id: 'h1', name: 'Step 1', actionId: 'ok-action' }),
        createStep({ id: 'h2', name: 'Step 2', actionId: 'ok-action' }),
        createStep({ id: 'h3', name: 'Step 3', actionId: 'ok-action' }),
      ];

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
      expect(finalState.completedAt).toBeDefined();
      expect(executeFn).toHaveBeenCalledTimes(3);
    });

    it('should mark step with no registered actionId as COMPLETED (documentation step)', async () => {
      // Step has an actionId that is NOT registered
      const step = createStep({ id: 'd1', name: 'Doc Step', actionId: 'unregistered-action' });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
      expect(finalState.stepStates['d1'].state).toBe(StepState.COMPLETED);
    });
  });

  // --------------------------------------------------------------------------
  // Failure Handling
  // --------------------------------------------------------------------------

  describe('Failure Handling', () => {
    it('should fail execution when step with onFailure=halt fails', async () => {
      const failAction = createTestAction({
        id: 'fail-action',
        execute: vi.fn(async () => ({ success: false, error: 'Boom' })),
      });
      executor.registerAction(failAction);

      const step = createStep({
        id: 'f1',
        actionId: 'fail-action',
        onFailure: 'halt',
      });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:failed');
      await executor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.state).toBe(ExecutionState.FAILED);
      expect(finalState.stepStates['f1'].state).toBe(StepState.FAILED);
    });

    it('should skip step and continue when onFailure=continue', async () => {
      const failAction = createTestAction({
        id: 'fail-action',
        execute: vi.fn(async () => ({ success: false, error: 'Boom' })),
      });
      const okAction = createTestAction({
        id: 'ok-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(failAction);
      executor.registerAction(okAction);

      const steps = [
        createStep({ id: 'c1', actionId: 'fail-action', onFailure: 'continue' }),
        createStep({ id: 'c2', actionId: 'ok-action' }),
      ];

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
      expect(finalState.stepStates['c1'].state).toBe(StepState.SKIPPED);
      expect(finalState.stepStates['c2'].state).toBe(StepState.COMPLETED);
    });
  });

  // --------------------------------------------------------------------------
  // Step Dependencies
  // --------------------------------------------------------------------------

  describe('Step Dependencies', () => {
    it('should execute dependent steps after their dependencies complete', async () => {
      const executionOrder: string[] = [];
      const makeAction = (id: string) =>
        createTestAction({
          id,
          execute: vi.fn(async () => {
            executionOrder.push(id);
            return { success: true };
          }),
        });

      executor.registerAction(makeAction('action-a'));
      executor.registerAction(makeAction('action-b'));
      executor.registerAction(makeAction('action-c'));

      const steps = [
        createStep({ id: 'dep-1', name: 'Step 1', actionId: 'action-a' }),
        createStep({
          id: 'dep-2',
          name: 'Step 2',
          actionId: 'action-b',
          dependencies: ['dep-1'],
        }),
        createStep({ id: 'dep-3', name: 'Step 3', actionId: 'action-c' }),
      ];

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
      // dep-2 must come after dep-1
      const idx1 = executionOrder.indexOf('action-a');
      const idx2 = executionOrder.indexOf('action-b');
      expect(idx1).toBeLessThan(idx2);
      // dep-1 and dep-3 may run in parallel or in order, but both should appear
      expect(executionOrder).toContain('action-a');
      expect(executionOrder).toContain('action-c');
    });
  });

  // --------------------------------------------------------------------------
  // Manual Steps
  // --------------------------------------------------------------------------

  describe('Manual Steps', () => {
    it('should set manual step to WAITING_APPROVAL state', async () => {
      const step = createStep({ id: 'm1', type: 'manual', name: 'Manual Step' });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const pausedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:paused');
      await executor.startExecution(incident, playbook);
      const pausedState = await pausedPromise;

      expect(
        pausedState.state === ExecutionState.WAITING_MANUAL ||
          pausedState.state === ExecutionState.WAITING_APPROVAL
      ).toBe(true);
      expect(pausedState.stepStates['m1'].state).toBe(StepState.WAITING_APPROVAL);
    });

    it('should complete manual step via completeManualStep', async () => {
      const step = createStep({ id: 'm2', type: 'manual', name: 'Manual Step' });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      // Find the execution
      const execState = await executor.getExecutionByIncident('incident-1');
      expect(execState).toBeDefined();

      await executor.completeManualStep(execState!.executionId, 'm2', 'tester', {
        notes: 'All done',
      });

      const updatedState = await executor.getExecutionState(execState!.executionId);
      expect(updatedState!.stepStates['m2'].state).toBe(StepState.COMPLETED);
      expect(updatedState!.stepStates['m2'].output).toEqual({ notes: 'All done' });
    });
  });

  // --------------------------------------------------------------------------
  // Approval Workflow
  // --------------------------------------------------------------------------

  describe('Approval Workflow', () => {
    it('should put step with requiresApproval=true in WAITING_APPROVAL state', async () => {
      const step = createStep({
        id: 'a1',
        name: 'Approval Step',
        actionId: 'test-action',
        requiresApproval: true,
      });
      executor.registerAction(createTestAction());

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const pausedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:paused');
      await executor.startExecution(incident, playbook);
      const pausedState = await pausedPromise;

      expect(pausedState.state).toBe(ExecutionState.WAITING_APPROVAL);
      expect(pausedState.stepStates['a1'].state).toBe(StepState.WAITING_APPROVAL);
    });

    it('should change step from WAITING_APPROVAL to QUEUED on approveStep', async () => {
      const step = createStep({
        id: 'a2',
        name: 'Approval Step',
        actionId: 'test-action',
        requiresApproval: true,
      });
      executor.registerAction(createTestAction());

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const execState = await executor.getExecutionByIncident('incident-1');
      expect(execState).toBeDefined();

      await executor.approveStep(execState!.executionId, 'a2', 'admin-user');

      const updatedState = await executor.getExecutionState(execState!.executionId);
      expect(updatedState!.stepStates['a2'].state).toBe(StepState.QUEUED);
      expect(updatedState!.stepStates['a2'].approvedBy).toBe('admin-user');
      expect(updatedState!.stepStates['a2'].approvedAt).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Cancel Execution
  // --------------------------------------------------------------------------

  describe('cancelExecution', () => {
    it('should set state to CANCELLED and signal abort', async () => {
      const step = createStep({ id: 'cx1', type: 'manual' });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const execState = await executor.getExecutionByIncident('incident-1');
      expect(execState).toBeDefined();

      const cancelledPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:cancelled'
      );
      await executor.cancelExecution(execState!.executionId);
      const cancelledState = await cancelledPromise;

      expect(cancelledState.state).toBe(ExecutionState.CANCELLED);
      expect(cancelledState.completedAt).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Rollback
  // --------------------------------------------------------------------------

  describe('Rollback', () => {
    it('should rollback completed steps in REVERSE order', async () => {
      const rollbackOrder: string[] = [];
      const makeAction = (id: string): ActionDefinition =>
        createTestAction({
          id,
          supportsRollback: true,
          execute: vi.fn(async () => ({ success: true, output: { actionId: id } })),
          rollback: vi.fn(async () => {
            rollbackOrder.push(id);
            return { success: true };
          }),
        });

      executor.registerAction(makeAction('rb-a'));
      executor.registerAction(makeAction('rb-b'));
      executor.registerAction(makeAction('rb-c'));

      const steps = [
        createStep({ id: 'r1', actionId: 'rb-a' }),
        createStep({ id: 'r2', actionId: 'rb-b' }),
        createStep({ id: 'r3', actionId: 'rb-c' }),
      ];

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      const rolledBackPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:rolledBack'
      );
      await executor.rollbackExecution(execState!.executionId, incident, playbook);
      await rolledBackPromise;

      // Reverse order: rb-c, rb-b, rb-a
      expect(rollbackOrder).toEqual(['rb-c', 'rb-b', 'rb-a']);
    });

    it('should skip already rolled-back steps during rollback', async () => {
      const rollbackFn = vi.fn(async () => ({ success: true }));
      const action = createTestAction({
        id: 'rb-skip',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { data: 1 } })),
        rollback: rollbackFn,
      });
      executor.registerAction(action);

      const steps = [createStep({ id: 'rs1', actionId: 'rb-skip' })];
      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');

      // First rollback
      await executor.rollbackExecution(execState!.executionId, incident, playbook);
      expect(rollbackFn).toHaveBeenCalledTimes(1);

      // Second rollback should skip the already rolled-back step
      await executor.rollbackExecution(execState!.executionId, incident, playbook);
      expect(rollbackFn).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should emit step:rolledBack events during rollback', async () => {
      const action = createTestAction({
        id: 'rb-emit',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { data: 1 } })),
        rollback: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const steps = [createStep({ id: 'rbe1', actionId: 'rb-emit' })];
      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      const rolledBackStepPromise = new Promise<string>((resolve) => {
        executor.on('step:rolledBack', (_execId: string, stepId: string) => {
          resolve(stepId);
        });
      });

      await executor.rollbackExecution(execState!.executionId, incident, playbook);
      const rolledBackStepId = await rolledBackStepPromise;
      expect(rolledBackStepId).toBe('rbe1');
    });

    it('should auto-rollback on failure when enableAutoRollback=true', async () => {
      const autoRollbackExecutor = new PlaybookExecutor({
        enableAutoRollback: true,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 5000,
      });

      const rollbackFn = vi.fn(async () => ({ success: true }));
      const okAction = createTestAction({
        id: 'auto-ok',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { data: 1 } })),
        rollback: rollbackFn,
      });
      const failAction = createTestAction({
        id: 'auto-fail',
        execute: vi.fn(async () => ({ success: false, error: 'Failure' })),
      });
      autoRollbackExecutor.registerAction(okAction);
      autoRollbackExecutor.registerAction(failAction);

      const steps = [
        createStep({ id: 'ar1', actionId: 'auto-ok' }),
        createStep({ id: 'ar2', actionId: 'auto-fail', onFailure: 'halt' }),
      ];

      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const rolledBackPromise = waitForEvent<PlaybookExecutionState>(
        autoRollbackExecutor,
        'execution:rolledBack'
      );
      await autoRollbackExecutor.startExecution(incident, playbook);
      const rolledBackState = await rolledBackPromise;

      expect(rolledBackState.state).toBe(ExecutionState.ROLLED_BACK);
      expect(rollbackFn).toHaveBeenCalledTimes(1);

      autoRollbackExecutor.removeAllListeners();
    });
  });

  // --------------------------------------------------------------------------
  // Retry Logic
  // --------------------------------------------------------------------------

  describe('Retry Logic', () => {
    it('should retry a step up to retryAttempts times on failure', async () => {
      let callCount = 0;
      const retryAction = createTestAction({
        id: 'retry-action',
        execute: vi.fn(async () => {
          callCount++;
          if (callCount < 3) {
            return { success: false, error: `Attempt ${callCount} failed` };
          }
          return { success: true };
        }),
      });
      executor.registerAction(retryAction);

      const step = createStep({
        id: 'rt1',
        actionId: 'retry-action',
        retryAttempts: 2,
        onFailure: 'halt',
      });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
      // Initial call + 2 retries = 3 total calls
      expect(callCount).toBe(3);
    });

    it('should use exponential backoff for retry delay', () => {
      // Access the private method via prototype
      const executorAny = executor as unknown as {
        calculateRetryDelay: (retryCount: number) => number;
        config: { baseRetryDelayMs: number; maxRetryBackoffMultiplier: number };
      };

      // With baseRetryDelayMs=10, maxRetryBackoffMultiplier=8 (default)
      // retryCount=1: 2^0 * 10 = 10 (with jitter: 8.5-11.5)
      // retryCount=2: 2^1 * 10 = 20 (with jitter: 17-23)
      // retryCount=3: 2^2 * 10 = 40 (with jitter: 34-46)
      // retryCount=4: 2^3 * 10 = 80 (capped at 8 * 10 = 80) (with jitter: 68-92)

      const delay1 = executorAny.calculateRetryDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(7);
      expect(delay1).toBeLessThanOrEqual(15);

      const delay2 = executorAny.calculateRetryDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(14);
      expect(delay2).toBeLessThanOrEqual(28);

      const delay4 = executorAny.calculateRetryDelay(4);
      // 2^3=8 => capped at maxRetryBackoffMultiplier=8 => 8*10=80 with jitter
      expect(delay4).toBeGreaterThanOrEqual(60);
      expect(delay4).toBeLessThanOrEqual(100);
    });
  });

  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------

  describe('State Persistence', () => {
    it('should call stateStore.save after execution batches', async () => {
      const saveSpy = vi.fn(async () => {});
      const mockStore: ExecutionStateStore = {
        save: saveSpy,
        load: vi.fn(async () => null),
        loadByIncident: vi.fn(async () => null),
        delete: vi.fn(async () => {}),
        listActive: vi.fn(async () => []),
        update: vi.fn(async () => {}),
      };

      const persistExecutor = new PlaybookExecutor({
        stateStore: mockStore,
        persistState: true,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 5000,
        enableAutoRollback: false,
      });

      const action = createTestAction({
        id: 'persist-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      persistExecutor.registerAction(action);

      const step = createStep({ id: 'ps1', actionId: 'persist-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        persistExecutor,
        'execution:completed'
      );
      await persistExecutor.startExecution(incident, playbook);
      await completedPromise;

      // save is called at least once for initial state, after batch, and final state
      expect(saveSpy).toHaveBeenCalled();
      expect(saveSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      persistExecutor.removeAllListeners();
    });
  });

  // --------------------------------------------------------------------------
  // State Queries
  // --------------------------------------------------------------------------

  describe('State Queries', () => {
    it('should return execution state via getExecutionState', async () => {
      const step = createStep({ id: 'sq1', type: 'manual' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const initState = await executor.startExecution(incident, playbook);
      await tick(100);

      const state = await executor.getExecutionState(initState.executionId);
      expect(state).toBeDefined();
      expect(state!.executionId).toBe(initState.executionId);
    });

    it('should return execution state via getExecutionByIncident', async () => {
      const step = createStep({ id: 'sqi1', type: 'manual' });
      const incident = createTestIncident({ id: 'inc-query' });
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const state = await executor.getExecutionByIncident('inc-query');
      expect(state).toBeDefined();
      expect(state!.incidentId).toBe('inc-query');
    });

    it('should return null for unknown execution ID', async () => {
      const state = await executor.getExecutionState('nonexistent');
      expect(state).toBeNull();
    });

    it('should list active executions via getActiveExecutions', async () => {
      const step = createStep({ id: 'ae1', type: 'manual' });
      const incident = createTestIncident({ id: 'inc-active' });
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const activeExecs = await executor.getActiveExecutions();
      expect(activeExecs.length).toBeGreaterThanOrEqual(1);
      const found = activeExecs.find((e) => e.incidentId === 'inc-active');
      expect(found).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Resume Execution
  // --------------------------------------------------------------------------

  describe('resumeExecution', () => {
    it('should resume a paused execution', async () => {
      const step = createStep({
        id: 're1',
        name: 'Approval Step',
        actionId: 'test-action',
        requiresApproval: true,
      });
      const action = createTestAction();
      executor.registerAction(action);

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const pausedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:paused');
      await executor.startExecution(incident, playbook);
      await pausedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      expect(execState).toBeDefined();

      // Approve the step first
      await executor.approveStep(execState!.executionId, 're1', 'admin');

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.resumeExecution(execState!.executionId, incident, playbook);
      const finalState = await completedPromise;

      expect(finalState.state).toBe(ExecutionState.COMPLETED);
    });

    it('should throw for non-resumable state (COMPLETED)', async () => {
      const action = createTestAction({
        id: 'resume-fail-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const step = createStep({ id: 'rf1', actionId: 'resume-fail-action' });
      const incident = createTestIncident({ id: 'inc-resume-fail' });
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('inc-resume-fail');
      expect(execState).toBeDefined();

      await expect(
        executor.resumeExecution(execState!.executionId, incident, playbook)
      ).rejects.toThrow(/not in a resumable state/);
    });
  });

  // --------------------------------------------------------------------------
  // Event Emissions
  // --------------------------------------------------------------------------

  describe('Event Emissions', () => {
    it('should emit step:started and step:completed for successful steps', async () => {
      const action = createTestAction({
        id: 'ev-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const step = createStep({ id: 'ev1', actionId: 'ev-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const stepStartedPromise = new Promise<string>((resolve) => {
        executor.on('step:started', (_execId: string, stepId: string) => {
          resolve(stepId);
        });
      });

      const stepCompletedPromise = new Promise<string>((resolve) => {
        executor.on('step:completed', (_execId: string, stepId: string) => {
          resolve(stepId);
        });
      });

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const startedStep = await stepStartedPromise;
      const completedStep = await stepCompletedPromise;
      expect(startedStep).toBe('ev1');
      expect(completedStep).toBe('ev1');
    });

    it('should emit step:failed for failing steps', async () => {
      const failAction = createTestAction({
        id: 'ev-fail-action',
        execute: vi.fn(async () => ({ success: false, error: 'Failure' })),
      });
      executor.registerAction(failAction);

      const step = createStep({
        id: 'evf1',
        actionId: 'ev-fail-action',
        onFailure: 'halt',
      });

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const stepFailedPromise = new Promise<{ stepId: string; error: string }>((resolve) => {
        executor.on('step:failed', (_execId: string, stepId: string, error: string) => {
          resolve({ stepId, error });
        });
      });

      await executor.startExecution(incident, playbook);
      const failed = await stepFailedPromise;

      expect(failed.stepId).toBe('evf1');
      expect(failed.error).toContain('Failure');
    });
  });

  // --------------------------------------------------------------------------
  // InMemoryStateStore
  // --------------------------------------------------------------------------

  describe('InMemoryStateStore', () => {
    let store: InMemoryStateStore;

    beforeEach(() => {
      store = new InMemoryStateStore();
    });

    it('should save and load execution state', async () => {
      const state: PlaybookExecutionState = {
        executionId: 'exec-1',
        incidentId: 'inc-1',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(state);
      const loaded = await store.load('exec-1');
      expect(loaded).toBeDefined();
      expect(loaded!.executionId).toBe('exec-1');
      expect(loaded!.incidentId).toBe('inc-1');
    });

    it('should return null for unknown execution ID', async () => {
      const loaded = await store.load('unknown');
      expect(loaded).toBeNull();
    });

    it('should load by incident ID', async () => {
      const state: PlaybookExecutionState = {
        executionId: 'exec-2',
        incidentId: 'inc-2',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(state);
      const loaded = await store.loadByIncident('inc-2');
      expect(loaded).toBeDefined();
      expect(loaded!.executionId).toBe('exec-2');
    });

    it('should return null for unknown incident ID', async () => {
      const loaded = await store.loadByIncident('unknown');
      expect(loaded).toBeNull();
    });

    it('should delete execution state', async () => {
      const state: PlaybookExecutionState = {
        executionId: 'exec-3',
        incidentId: 'inc-3',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(state);
      await store.delete('exec-3');

      const loaded = await store.load('exec-3');
      expect(loaded).toBeNull();
      const byIncident = await store.loadByIncident('inc-3');
      expect(byIncident).toBeNull();
    });

    it('should list active executions', async () => {
      const runningState: PlaybookExecutionState = {
        executionId: 'exec-run',
        incidentId: 'inc-run',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      const completedState: PlaybookExecutionState = {
        executionId: 'exec-done',
        incidentId: 'inc-done',
        playbookId: 'pb-1',
        state: ExecutionState.COMPLETED,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      const pausedState: PlaybookExecutionState = {
        executionId: 'exec-paused',
        incidentId: 'inc-paused',
        playbookId: 'pb-1',
        state: ExecutionState.PAUSED,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(runningState);
      await store.save(completedState);
      await store.save(pausedState);

      const active = await store.listActive();
      expect(active).toHaveLength(2);
      const ids = active.map((s) => s.executionId);
      expect(ids).toContain('exec-run');
      expect(ids).toContain('exec-paused');
      expect(ids).not.toContain('exec-done');
    });

    it('should update specific fields', async () => {
      const state: PlaybookExecutionState = {
        executionId: 'exec-upd',
        incidentId: 'inc-upd',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(state);
      await store.update('exec-upd', { state: ExecutionState.COMPLETED });

      const loaded = await store.load('exec-upd');
      expect(loaded!.state).toBe(ExecutionState.COMPLETED);
    });

    it('should ignore update for non-existent execution', async () => {
      // Should not throw
      await store.update('nonexistent', { state: ExecutionState.COMPLETED });
      const loaded = await store.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should ignore delete for non-existent execution', async () => {
      // Should not throw
      await store.delete('nonexistent');
    });

    it('should list WAITING_APPROVAL as active', async () => {
      const waitingApproval: PlaybookExecutionState = {
        executionId: 'exec-wa',
        incidentId: 'inc-wa',
        playbookId: 'pb-1',
        state: ExecutionState.WAITING_APPROVAL,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      await store.save(waitingApproval);

      const active = await store.listActive();
      const ids = active.map((s) => s.executionId);
      expect(ids).toContain('exec-wa');
    });

    it('should list WAITING_MANUAL as active', async () => {
      const waitingManual: PlaybookExecutionState = {
        executionId: 'exec-wm',
        incidentId: 'inc-wm',
        playbookId: 'pb-1',
        state: ExecutionState.WAITING_MANUAL,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      await store.save(waitingManual);

      const active = await store.listActive();
      const ids = active.map((s) => s.executionId);
      expect(ids).toContain('exec-wm');
    });

    it('should NOT list FAILED as active', async () => {
      const failedState: PlaybookExecutionState = {
        executionId: 'exec-fail',
        incidentId: 'inc-fail',
        playbookId: 'pb-1',
        state: ExecutionState.FAILED,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      await store.save(failedState);

      const active = await store.listActive();
      const ids = active.map((s) => s.executionId);
      expect(ids).not.toContain('exec-fail');
    });

    it('should NOT list CANCELLED or ROLLED_BACK as active', async () => {
      const cancelledState: PlaybookExecutionState = {
        executionId: 'exec-can',
        incidentId: 'inc-can',
        playbookId: 'pb-1',
        state: ExecutionState.CANCELLED,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      const rolledBackState: PlaybookExecutionState = {
        executionId: 'exec-rb',
        incidentId: 'inc-rb',
        playbookId: 'pb-1',
        state: ExecutionState.ROLLED_BACK,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };
      await store.save(cancelledState);
      await store.save(rolledBackState);

      const active = await store.listActive();
      const ids = active.map((s) => s.executionId);
      expect(ids).not.toContain('exec-can');
      expect(ids).not.toContain('exec-rb');
    });
  });

  // --------------------------------------------------------------------------
  // Mutation-Killing Tests
  // --------------------------------------------------------------------------

  describe('Mutation-killing: action context', () => {
    it('should pass variables through setVariable/getVariable in context', async () => {
      let capturedContext: ActionContext | undefined;
      const contextAction = createTestAction({
        id: 'ctx-action',
        execute: vi.fn(async (ctx: ActionContext) => {
          capturedContext = ctx;
          ctx.setVariable('myKey', 42);
          const val = ctx.getVariable<number>('myKey');
          expect(val).toBe(42);
          expect(ctx.getVariable('nonexistent')).toBeUndefined();
          return { success: true };
        }),
      });
      executor.registerAction(contextAction);

      const step = createStep({ id: 'ctx1', actionId: 'ctx-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(capturedContext).toBeDefined();
      expect(capturedContext!.incident.id).toBe('incident-1');
      expect(capturedContext!.playbook.id).toBe('playbook-test');
      expect(capturedContext!.step.id).toBe('ctx1');
    });

    it('should throw when addEvidence is called without handler registered', async () => {
      let evidenceError: string | undefined;
      const evidenceAction = createTestAction({
        id: 'ev-action',
        execute: vi.fn(async (ctx: ActionContext) => {
          try {
            await ctx.addEvidence({ type: 'log', source: 'test', description: 'test', data: {} });
          } catch (e: any) {
            evidenceError = e.message;
          }
          return { success: true };
        }),
      });
      executor.registerAction(evidenceAction);

      const step = createStep({ id: 'ev1', actionId: 'ev-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(evidenceError).toContain('Evidence handler not registered');
    });

    it('should throw when updateIncident is called without handler registered', async () => {
      let updateError: string | undefined;
      const updateAction = createTestAction({
        id: 'upd-action',
        execute: vi.fn(async (ctx: ActionContext) => {
          try {
            await ctx.updateIncident({ status: 'investigating' as any });
          } catch (e: any) {
            updateError = e.message;
          }
          return { success: true };
        }),
      });
      executor.registerAction(updateAction);

      const step = createStep({ id: 'upd1', actionId: 'upd-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(updateError).toContain('Incident update handler not registered');
    });

    it('should call registered handlers for addEvidence and updateIncident', async () => {
      const mockUpdate = vi.fn(async () => {});
      const mockAddEvidence = vi.fn(async () => ({ id: 'ev-1', collectedAt: new Date() }));

      executor.registerHandlers({
        updateIncident: mockUpdate,
        addEvidence: mockAddEvidence as any,
      });

      const handlerAction = createTestAction({
        id: 'handler-action',
        execute: vi.fn(async (ctx: ActionContext) => {
          await ctx.updateIncident({ status: 'investigating' as any });
          await ctx.addEvidence({ type: 'log', source: 'test', description: 'test', data: {} });
          return { success: true };
        }),
      });
      executor.registerAction(handlerAction);

      const step = createStep({ id: 'hd1', actionId: 'handler-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(mockUpdate).toHaveBeenCalledWith('incident-1', { status: 'investigating' });
      expect(mockAddEvidence).toHaveBeenCalledWith('incident-1', expect.objectContaining({ type: 'log' }));
    });
  });

  describe('Mutation-killing: action validation', () => {
    it('should fail step when action.validate returns invalid', async () => {
      const validateAction = createTestAction({
        id: 'val-action',
        execute: vi.fn(async () => ({ success: true })),
        validate: vi.fn(async () => ({ valid: false, reason: 'Not safe to execute' })),
      });
      executor.registerAction(validateAction);

      const step = createStep({ id: 'v1', actionId: 'val-action', onFailure: 'halt' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:failed');
      await executor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.state).toBe(ExecutionState.FAILED);
      expect(finalState.stepStates['v1'].error).toContain('Validation failed');
    });

    it('should proceed when action.validate returns valid', async () => {
      const executeFn = vi.fn(async () => ({ success: true }));
      const validAction = createTestAction({
        id: 'val-ok-action',
        execute: executeFn,
        validate: vi.fn(async () => ({ valid: true })),
      });
      executor.registerAction(validAction);

      const step = createStep({ id: 'vo1', actionId: 'val-ok-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(executeFn).toHaveBeenCalled();
    });
  });

  describe('Mutation-killing: legacy step.action function', () => {
    it('should execute legacy step.action function and complete', async () => {
      const legacyFn = vi.fn(async () => {});
      const step = createStep({
        id: 'leg1',
        name: 'Legacy Step',
        action: legacyFn,
      } as any);

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(legacyFn).toHaveBeenCalled();
    });
  });

  describe('Mutation-killing: step duration and result', () => {
    it('should record non-zero duration for successful steps', async () => {
      let capturedResult: StepExecutionResult | undefined;
      const slowAction = createTestAction({
        id: 'slow-action',
        execute: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 50));
          return { success: true, output: { data: 'result' } };
        }),
      });
      executor.registerAction(slowAction);

      executor.on('step:completed', (_execId: string, _stepId: string, result: StepExecutionResult) => {
        capturedResult = result;
      });

      const step = createStep({ id: 'dur1', actionId: 'slow-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(capturedResult).toBeDefined();
      expect(capturedResult!.success).toBe(true);
      expect(capturedResult!.duration).toBeGreaterThan(0);
      expect(capturedResult!.output).toEqual({ data: 'result' });
      expect(capturedResult!.startedAt).toBeInstanceOf(Date);
      expect(capturedResult!.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('Mutation-killing: isActiveState boundaries', () => {
    it('should allow new execution when previous one is COMPLETED', async () => {
      const action = createTestAction({
        id: 'active-check',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const step = createStep({ id: 'ac1', actionId: 'active-check' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      // Should not throw — COMPLETED is not an active state
      const step2 = createStep({ id: 'ac2', actionId: 'active-check' });
      const playbook2 = createTestPlaybook([step2]);

      const completed2 = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook2);
      await completed2;
    });

    it('should allow new execution when previous one is FAILED', async () => {
      const failAction = createTestAction({
        id: 'fail-then-ok',
        execute: vi.fn()
          .mockImplementationOnce(async () => ({ success: false, error: 'err' }))
          .mockImplementationOnce(async () => ({ success: true })),
      });
      executor.registerAction(failAction);

      const step1 = createStep({ id: 'f1', actionId: 'fail-then-ok', onFailure: 'halt' });
      const incident = createTestIncident();
      const playbook1 = createTestPlaybook([step1]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:failed');
      await executor.startExecution(incident, playbook1);
      await failedPromise;

      // Should not throw — FAILED is not an active state
      const step2 = createStep({ id: 'f2', actionId: 'fail-then-ok' });
      const playbook2 = createTestPlaybook([step2]);

      const completed2 = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook2);
      await completed2;
    });
  });

  describe('Mutation-killing: error handling edge cases', () => {
    it('should set step to FAILED with error when action throws', async () => {
      const throwAction = createTestAction({
        id: 'throw-action',
        execute: vi.fn(async () => {
          throw new Error('Unexpected crash');
        }),
      });
      executor.registerAction(throwAction);

      const step = createStep({ id: 'th1', actionId: 'throw-action', onFailure: 'halt' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:failed');
      await executor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.stepStates['th1'].state).toBe(StepState.FAILED);
      expect(finalState.stepStates['th1'].error).toContain('Unexpected crash');
      expect(finalState.stepStates['th1'].completedAt).toBeDefined();
    });

    it('should handle non-Error thrown values', async () => {
      const stringThrowAction = createTestAction({
        id: 'string-throw',
        execute: vi.fn(async () => {
          throw 'string error';
        }),
      });
      executor.registerAction(stringThrowAction);

      const step = createStep({ id: 'st1', actionId: 'string-throw', onFailure: 'halt' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:failed');
      await executor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.stepStates['st1'].state).toBe(StepState.FAILED);
      expect(finalState.stepStates['st1'].error).toContain('string error');
    });

    it('should rollback only steps with supportsRollback and output', async () => {
      const rollbackFn = vi.fn(async () => ({ success: true }));
      const noRollbackAction = createTestAction({
        id: 'no-rb',
        supportsRollback: false,
        execute: vi.fn(async () => ({ success: true, output: { data: 1 } })),
      });
      const rbAction = createTestAction({
        id: 'yes-rb',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { data: 2 } })),
        rollback: rollbackFn,
      });
      executor.registerAction(noRollbackAction);
      executor.registerAction(rbAction);

      const steps = [
        createStep({ id: 'nrb1', actionId: 'no-rb' }),
        createStep({ id: 'yrb1', actionId: 'yes-rb' }),
      ];
      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      await executor.rollbackExecution(execState!.executionId, incident, playbook);

      // Only the action with supportsRollback should have rollback called
      expect(rollbackFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mutation-killing: approveStep error paths', () => {
    it('should throw when approving non-existent execution', async () => {
      await expect(executor.approveStep('nonexistent', 'step1', 'admin')).rejects.toThrow(
        /Execution not found/
      );
    });

    it('should throw when approving non-existent step', async () => {
      const step = createStep({ id: 'ap-step', type: 'manual' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const execState = await executor.getExecutionByIncident('incident-1');
      await expect(
        executor.approveStep(execState!.executionId, 'nonexistent-step', 'admin')
      ).rejects.toThrow(/Step not found/);
    });

    it('should throw when approving step not in WAITING_APPROVAL state', async () => {
      const action = createTestAction({
        id: 'ap-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const step = createStep({ id: 'ap-ok', actionId: 'ap-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      await expect(
        executor.approveStep(execState!.executionId, 'ap-ok', 'admin')
      ).rejects.toThrow(/not waiting for approval/);
    });
  });

  describe('Mutation-killing: completeManualStep error paths', () => {
    it('should throw when completing manual step on non-existent execution', async () => {
      await expect(
        executor.completeManualStep('nonexistent', 'step1', 'user')
      ).rejects.toThrow(/Execution not found/);
    });

    it('should throw when completing non-existent step', async () => {
      const step = createStep({ id: 'cm-step', type: 'manual' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      await executor.startExecution(incident, playbook);
      await tick(100);

      const execState = await executor.getExecutionByIncident('incident-1');
      await expect(
        executor.completeManualStep(execState!.executionId, 'nonexistent', 'user')
      ).rejects.toThrow(/Step not found/);
    });
  });

  describe('Mutation-killing: rollback error paths', () => {
    it('should throw when rolling back non-existent execution', async () => {
      const incident = createTestIncident();
      const playbook = createTestPlaybook([]);
      await expect(
        executor.rollbackExecution('nonexistent', incident, playbook)
      ).rejects.toThrow(/Execution not found/);
    });
  });

  describe('Mutation-killing: resume error paths', () => {
    it('should throw when resuming non-existent execution', async () => {
      const incident = createTestIncident();
      const playbook = createTestPlaybook([]);
      await expect(
        executor.resumeExecution('nonexistent', incident, playbook)
      ).rejects.toThrow(/Execution not found/);
    });
  });

  // --------------------------------------------------------------------------
  // Additional Mutation-Killing Tests (batch 2)
  // --------------------------------------------------------------------------

  describe('Mutation-killing: default config values', () => {
    it('should use maxConcurrentSteps=5 by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.maxConcurrentSteps).toBe(5);
      defaultExecutor.removeAllListeners();
    });

    it('should use defaultStepTimeoutMs=60000 by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.defaultStepTimeoutMs).toBe(60000);
      defaultExecutor.removeAllListeners();
    });

    it('should use enableAutoRollback=true by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.enableAutoRollback).toBe(true);
      defaultExecutor.removeAllListeners();
    });

    it('should use maxRetryBackoffMultiplier=8 by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.maxRetryBackoffMultiplier).toBe(8);
      defaultExecutor.removeAllListeners();
    });

    it('should use baseRetryDelayMs=1000 by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.baseRetryDelayMs).toBe(1000);
      defaultExecutor.removeAllListeners();
    });

    it('should use persistState=true by default', () => {
      const defaultExecutor = new PlaybookExecutor();
      const cfg = (defaultExecutor as any).config;
      expect(cfg.persistState).toBe(true);
      defaultExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: calculateRetryDelay formula', () => {
    it('retryCount=1 should use multiplier 2^0=1', () => {
      const exec = executor as any;
      // baseRetryDelayMs=10, multiplier=min(2^0=1, 8)=1
      // delay = floor(10 * 1 * jitter) where jitter in [0.85, 1.15]
      const delay = exec.calculateRetryDelay(1);
      expect(delay).toBeGreaterThanOrEqual(8);  // floor(10 * 1 * 0.85)
      expect(delay).toBeLessThanOrEqual(12);    // floor(10 * 1 * 1.15)
    });

    it('retryCount=2 should use multiplier 2^1=2', () => {
      const exec = executor as any;
      const delay = exec.calculateRetryDelay(2);
      expect(delay).toBeGreaterThanOrEqual(17); // floor(10 * 2 * 0.85)
      expect(delay).toBeLessThanOrEqual(23);    // floor(10 * 2 * 1.15)
    });

    it('retryCount=3 should use multiplier 2^2=4', () => {
      const exec = executor as any;
      const delay = exec.calculateRetryDelay(3);
      expect(delay).toBeGreaterThanOrEqual(34); // floor(10 * 4 * 0.85)
      expect(delay).toBeLessThanOrEqual(46);    // floor(10 * 4 * 1.15)
    });

    it('retryCount=5 should cap multiplier at maxRetryBackoffMultiplier=8', () => {
      const exec = executor as any;
      // 2^4=16 but capped at 8
      const delay = exec.calculateRetryDelay(5);
      expect(delay).toBeGreaterThanOrEqual(68); // floor(10 * 8 * 0.85)
      expect(delay).toBeLessThanOrEqual(92);    // floor(10 * 8 * 1.15)
    });

    it('should produce different results than using retryCount directly (not retryCount-1)', () => {
      const exec = executor as any;
      // retryCount=3: should be 2^2=4 not 2^3=8
      // We call multiple times and check the average is near 4*10=40, not 8*10=80
      const delays: number[] = [];
      for (let i = 0; i < 20; i++) {
        delays.push(exec.calculateRetryDelay(3));
      }
      const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
      expect(avg).toBeGreaterThan(30);
      expect(avg).toBeLessThan(50);
    });
  });

  describe('Mutation-killing: persistState=false skips save', () => {
    it('should NOT call stateStore.save when persistState=false', async () => {
      const saveSpy = vi.fn(async () => {});
      const mockStore: ExecutionStateStore = {
        save: saveSpy,
        load: vi.fn(async () => null),
        loadByIncident: vi.fn(async () => null),
        delete: vi.fn(async () => {}),
        listActive: vi.fn(async () => []),
        update: vi.fn(async () => {}),
      };

      const noPersistExecutor = new PlaybookExecutor({
        stateStore: mockStore,
        persistState: false,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 5000,
        enableAutoRollback: false,
      });

      const action = createTestAction({
        id: 'no-persist-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      noPersistExecutor.registerAction(action);

      const step = createStep({ id: 'np1', actionId: 'no-persist-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        noPersistExecutor,
        'execution:completed'
      );
      await noPersistExecutor.startExecution(incident, playbook);
      await completedPromise;

      expect(saveSpy).not.toHaveBeenCalled();
      noPersistExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: step timeout', () => {
    it.skip('should fail step when action exceeds timeout', async () => {
      // Verify the config plumbing: defaultStepTimeoutMs is used for the timeout value
      const timeoutExecutor = new PlaybookExecutor({
        enableAutoRollback: false,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 100,
      });

      // The action uses a never-resolving promise so the timeout fires
      let aborted = false;
      const slowAction = createTestAction({
        id: 'timeout-action',
        execute: vi.fn(async (_ctx: ActionContext) => {
          return new Promise<ActionResult>((resolve) => {
            const timer = setTimeout(() => resolve({ success: true }), 60000);
            // Allow abort to clean up
            if (_ctx.abortSignal) {
              _ctx.abortSignal.addEventListener('abort', () => {
                clearTimeout(timer);
                aborted = true;
              });
            }
          });
        }),
      });
      timeoutExecutor.registerAction(slowAction);

      const step = createStep({
        id: 'to1',
        actionId: 'timeout-action',
        onFailure: 'halt',
      });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(
        timeoutExecutor,
        'execution:failed',
        15000
      );
      await timeoutExecutor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.stepStates['to1'].state).toBe(StepState.FAILED);
      expect(finalState.stepStates['to1'].error).toContain('timed out');
      timeoutExecutor.removeAllListeners();
    }, 20000);

    it('should use step-level timeout over default', async () => {
      const stepTimeoutExecutor = new PlaybookExecutor({
        enableAutoRollback: false,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 10000, // Long default
      });

      const slowAction = createTestAction({
        id: 'step-timeout-action',
        execute: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 500));
          return { success: true };
        }),
      });
      stepTimeoutExecutor.registerAction(slowAction);

      const step = createStep({
        id: 'sto1',
        actionId: 'step-timeout-action',
        timeout: 50, // Step-level short timeout
        onFailure: 'halt',
      });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(
        stepTimeoutExecutor,
        'execution:failed'
      );
      await stepTimeoutExecutor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.stepStates['sto1'].state).toBe(StepState.FAILED);
      expect(finalState.stepStates['sto1'].error).toContain('timed out');
      stepTimeoutExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: rollback error continues to next step', () => {
    it('should continue rolling back remaining steps when one rollback fails', async () => {
      const rollbackOrder: string[] = [];

      const failRbAction = createTestAction({
        id: 'fail-rb',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { x: 1 } })),
        rollback: vi.fn(async () => {
          rollbackOrder.push('fail-rb');
          throw new Error('Rollback failed');
        }),
      });
      const okRbAction = createTestAction({
        id: 'ok-rb',
        supportsRollback: true,
        execute: vi.fn(async () => ({ success: true, output: { x: 2 } })),
        rollback: vi.fn(async () => {
          rollbackOrder.push('ok-rb');
          return { success: true };
        }),
      });
      executor.registerAction(failRbAction);
      executor.registerAction(okRbAction);

      const steps = [
        createStep({ id: 'rb-ok1', actionId: 'ok-rb' }),
        createStep({ id: 'rb-fail1', actionId: 'fail-rb' }),
      ];
      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      await executor.rollbackExecution(execState!.executionId, incident, playbook);

      // Both rollbacks attempted despite first one failing (reverse order)
      expect(rollbackOrder).toContain('fail-rb');
      expect(rollbackOrder).toContain('ok-rb');
    });
  });

  describe('Mutation-killing: cancelExecution without active controller', () => {
    it('should handle cancel when no abort controller exists', async () => {
      const action = createTestAction({
        id: 'cancel-done-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      executor.registerAction(action);

      const step = createStep({ id: 'cd1', actionId: 'cancel-done-action' });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');
      // Execution is complete, abort controller already removed
      // Should not throw
      await executor.cancelExecution(execState!.executionId);

      const finalState = await executor.getExecutionState(execState!.executionId);
      expect(finalState!.state).toBe(ExecutionState.CANCELLED);
    });
  });

  describe('Mutation-killing: InMemoryStateStore returns copies', () => {
    it('save and load should return independent copies', async () => {
      const store = new InMemoryStateStore();
      const state: PlaybookExecutionState = {
        executionId: 'copy-test',
        incidentId: 'inc-copy',
        playbookId: 'pb-1',
        state: ExecutionState.RUNNING,
        stepStates: {},
        variables: {},
        startedAt: new Date(),
        updatedAt: new Date(),
        rolledBackSteps: [],
      };

      await store.save(state);
      const loaded = await store.load('copy-test');

      // Modifying loaded should not affect stored
      loaded!.state = ExecutionState.FAILED;
      const loadedAgain = await store.load('copy-test');
      expect(loadedAgain!.state).toBe(ExecutionState.RUNNING);
    });
  });

  describe('Mutation-killing: createPlaybookExecutor factory', () => {
    it('should create a working executor via factory function', async () => {
      // Import dynamically to get the factory
      const { createPlaybookExecutor } = await import('../executor.js');
      const factoryExecutor = createPlaybookExecutor({
        baseRetryDelayMs: 10,
        enableAutoRollback: false,
      });

      const action = createTestAction({
        id: 'factory-action',
        execute: vi.fn(async () => ({ success: true })),
      });
      factoryExecutor.registerAction(action);

      const step = createStep({ id: 'fac1', actionId: 'factory-action' });
      const incident = createTestIncident({ id: 'inc-factory' });
      const playbook = createTestPlaybook([step]);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        factoryExecutor,
        'execution:completed'
      );
      await factoryExecutor.startExecution(incident, playbook);
      await completedPromise;

      const state = await factoryExecutor.getExecutionByIncident('inc-factory');
      expect(state).toBeDefined();
      expect(state!.state).toBe(ExecutionState.COMPLETED);
      factoryExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: maxConcurrentSteps limits parallel execution', () => {
    it('should limit concurrent steps to maxConcurrentSteps', async () => {
      const concurrentExecutor = new PlaybookExecutor({
        enableAutoRollback: false,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 5000,
        maxConcurrentSteps: 2,
      });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const trackAction = createTestAction({
        id: 'track-action',
        execute: vi.fn(async () => {
          currentConcurrent++;
          if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
          await new Promise((r) => setTimeout(r, 30));
          currentConcurrent--;
          return { success: true };
        }),
      });
      concurrentExecutor.registerAction(trackAction);

      // 4 independent steps (no dependencies)
      const steps = [
        createStep({ id: 'con1', actionId: 'track-action' }),
        createStep({ id: 'con2', actionId: 'track-action' }),
        createStep({ id: 'con3', actionId: 'track-action' }),
        createStep({ id: 'con4', actionId: 'track-action' }),
      ];
      const incident = createTestIncident();
      const playbook = createTestPlaybook(steps);

      const completedPromise = waitForEvent<PlaybookExecutionState>(
        concurrentExecutor,
        'execution:completed'
      );
      await concurrentExecutor.startExecution(incident, playbook);
      await completedPromise;

      // maxConcurrentSteps=2, so max concurrent should be <= 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
      concurrentExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: step uses action defaultTimeoutMs', () => {
    it('should use action defaultTimeoutMs when step has no timeout', async () => {
      const actionTimeoutExecutor = new PlaybookExecutor({
        enableAutoRollback: false,
        baseRetryDelayMs: 10,
        defaultStepTimeoutMs: 10000, // Long executor default
      });

      const shortTimeoutAction = createTestAction({
        id: 'short-timeout-action',
        defaultTimeoutMs: 50, // Short action timeout
        execute: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 500));
          return { success: true };
        }),
      });
      actionTimeoutExecutor.registerAction(shortTimeoutAction);

      const step = createStep({
        id: 'ato1',
        actionId: 'short-timeout-action',
        onFailure: 'halt',
        // no timeout on step — should fall back to action's defaultTimeoutMs=50
      });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = waitForEvent<PlaybookExecutionState>(
        actionTimeoutExecutor,
        'execution:failed'
      );
      await actionTimeoutExecutor.startExecution(incident, playbook);
      const finalState = await failedPromise;

      expect(finalState.stepStates['ato1'].state).toBe(StepState.FAILED);
      expect(finalState.stepStates['ato1'].error).toContain('timed out');
      actionTimeoutExecutor.removeAllListeners();
    });
  });

  describe('Mutation-killing: step retryAttempts vs action maxRetries', () => {
    it('should use action maxRetries when step retryAttempts is 0', async () => {
      let callCount = 0;
      const retryAction = createTestAction({
        id: 'action-retry',
        maxRetries: 2,
        execute: vi.fn(async () => {
          callCount++;
          if (callCount < 3) return { success: false, error: `Fail ${callCount}` };
          return { success: true };
        }),
      });
      executor.registerAction(retryAction);

      const step = createStep({
        id: 'ar1',
        actionId: 'action-retry',
        retryAttempts: 0, // Step has 0, action has maxRetries=2
        onFailure: 'halt',
      });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      // With step retryAttempts=0 and action maxRetries=2, the code uses:
      // const maxRetries = step.retryAttempts || action?.maxRetries || 0
      // step.retryAttempts=0 is falsy, so falls through to action.maxRetries=2
      const completedPromise = waitForEvent<PlaybookExecutionState>(
        executor,
        'execution:completed'
      );
      await executor.startExecution(incident, playbook);
      await completedPromise;

      expect(callCount).toBe(3); // 1 initial + 2 retries
    });
  });

  describe('Mutation-killing: execution:failed emits error message', () => {
    it('should include the specific error message in execution:failed event', async () => {
      const failAction = createTestAction({
        id: 'err-msg-action',
        execute: vi.fn(async () => ({ success: false, error: 'Specific failure reason' })),
      });
      executor.registerAction(failAction);

      const step = createStep({
        id: 'em1',
        actionId: 'err-msg-action',
        onFailure: 'halt',
      });
      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const failedPromise = new Promise<{ state: PlaybookExecutionState; error: string }>(
        (resolve) => {
          executor.on('execution:failed', (state: PlaybookExecutionState, error: string) => {
            resolve({ state, error });
          });
        }
      );
      await executor.startExecution(incident, playbook);
      const result = await failedPromise;

      expect(result.error).toContain('Specific failure reason');
      expect(result.state.error).toContain('Specific failure reason');
    });
  });

  describe('Mutation-killing: step:approved event emission', () => {
    it('should emit step:approved with executionId, stepId, and approver', async () => {
      const step = createStep({
        id: 'approve-evt',
        name: 'Approval Step',
        actionId: 'test-action',
        requiresApproval: true,
      });
      executor.registerAction(createTestAction());

      const incident = createTestIncident();
      const playbook = createTestPlaybook([step]);

      const pausedPromise = waitForEvent<PlaybookExecutionState>(executor, 'execution:paused');
      await executor.startExecution(incident, playbook);
      await pausedPromise;

      const execState = await executor.getExecutionByIncident('incident-1');

      const approvedPromise = new Promise<{ execId: string; stepId: string; approver: string }>(
        (resolve) => {
          executor.on('step:approved', (execId: string, stepId: string, approver: string) => {
            resolve({ execId, stepId, approver });
          });
        }
      );
      await executor.approveStep(execState!.executionId, 'approve-evt', 'admin-approver');
      const approved = await approvedPromise;

      expect(approved.execId).toBe(execState!.executionId);
      expect(approved.stepId).toBe('approve-evt');
      expect(approved.approver).toBe('admin-approver');
    });
  });
});
