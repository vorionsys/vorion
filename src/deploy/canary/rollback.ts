/**
 * Vorion Security Platform - Canary Rollback Handler
 * Manages rollback operations for canary deployments
 */

import {
  CanaryDeployment,
  RollbackPolicy,
  RollbackInfo,
  RollbackAction,
  CanaryStatus,
  DeploymentError,
  NotificationEvent,
  Logger,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface RollbackHandlerConfig {
  /** Default drain timeout in seconds */
  defaultDrainTimeout?: number;
  /** Maximum retry attempts for rollback */
  maxRetryAttempts?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
  /** Logger instance */
  logger?: Logger;
}

export interface RollbackRequest {
  /** Deployment to rollback */
  deployment: CanaryDeployment;
  /** Reason for rollback */
  reason: string;
  /** Whether rollback is automatic or manual */
  automatic: boolean;
  /** Force immediate rollback without draining */
  force?: boolean;
  /** Custom drain timeout override */
  drainTimeout?: number;
}

export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;
  /** Rollback information */
  info: RollbackInfo;
  /** Error if failed */
  error?: DeploymentError;
  /** Actions executed */
  actionsExecuted: RollbackActionResult[];
}

export interface RollbackActionResult {
  /** Action type */
  type: string;
  /** Whether action succeeded */
  success: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

export interface DrainStatus {
  /** Whether draining is complete */
  complete: boolean;
  /** Active connections count */
  activeConnections: number;
  /** Elapsed time in seconds */
  elapsedSeconds: number;
  /** Remaining time in seconds */
  remainingSeconds: number;
}

export interface StateSnapshot {
  /** Snapshot ID */
  id: string;
  /** Deployment ID */
  deploymentId: string;
  /** Timestamp */
  timestamp: Date;
  /** Current stage */
  stage: number;
  /** Current percentage */
  percentage: number;
  /** Metrics snapshot */
  metrics?: Record<string, number>;
  /** Custom state data */
  customState?: Record<string, unknown>;
}

// ============================================================================
// State Manager
// ============================================================================

class StateManager {
  private snapshots: Map<string, StateSnapshot[]> = new Map();
  private readonly maxSnapshots: number = 50;

  /**
   * Save state snapshot
   */
  saveSnapshot(deploymentId: string, snapshot: Omit<StateSnapshot, 'id'>): StateSnapshot {
    const fullSnapshot: StateSnapshot = {
      ...snapshot,
      id: this.generateSnapshotId(),
    };

    if (!this.snapshots.has(deploymentId)) {
      this.snapshots.set(deploymentId, []);
    }

    const deploymentSnapshots = this.snapshots.get(deploymentId)!;
    deploymentSnapshots.push(fullSnapshot);

    // Limit snapshot count
    if (deploymentSnapshots.length > this.maxSnapshots) {
      deploymentSnapshots.shift();
    }

    return fullSnapshot;
  }

  /**
   * Get latest snapshot
   */
  getLatestSnapshot(deploymentId: string): StateSnapshot | null {
    const snapshots = this.snapshots.get(deploymentId);
    if (!snapshots || snapshots.length === 0) return null;
    return snapshots[snapshots.length - 1];
  }

  /**
   * Get all snapshots for deployment
   */
  getSnapshots(deploymentId: string): StateSnapshot[] {
    return this.snapshots.get(deploymentId) || [];
  }

  /**
   * Clear snapshots for deployment
   */
  clearSnapshots(deploymentId: string): void {
    this.snapshots.delete(deploymentId);
  }

  /**
   * Generate unique snapshot ID
   */
  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Connection Drainer
// ============================================================================

class ConnectionDrainer {
  private draining: Map<string, { startTime: Date; timeout: number }> = new Map();

  /**
   * Start connection draining
   */
  startDrain(deploymentId: string, timeoutSeconds: number): void {
    this.draining.set(deploymentId, {
      startTime: new Date(),
      timeout: timeoutSeconds,
    });
  }

  /**
   * Check drain status
   */
  getDrainStatus(deploymentId: string): DrainStatus | null {
    const drain = this.draining.get(deploymentId);
    if (!drain) return null;

    const elapsedMs = Date.now() - drain.startTime.getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const remainingSeconds = Math.max(0, drain.timeout - elapsedSeconds);

    // Simulate active connections (in production, query load balancer)
    const activeConnections = Math.max(0, Math.floor(100 * (remainingSeconds / drain.timeout)));

    return {
      complete: elapsedSeconds >= drain.timeout,
      activeConnections,
      elapsedSeconds,
      remainingSeconds,
    };
  }

  /**
   * Wait for drain to complete
   */
  async waitForDrain(
    deploymentId: string,
    onProgress?: (status: DrainStatus) => void
  ): Promise<boolean> {
    const checkInterval = 1000; // 1 second

    return new Promise((resolve) => {
      const check = () => {
        const status = this.getDrainStatus(deploymentId);
        if (!status) {
          resolve(false);
          return;
        }

        if (onProgress) {
          onProgress(status);
        }

        if (status.complete) {
          this.draining.delete(deploymentId);
          resolve(true);
        } else {
          setTimeout(check, checkInterval);
        }
      };

      check();
    });
  }

  /**
   * Force stop draining
   */
  stopDrain(deploymentId: string): void {
    this.draining.delete(deploymentId);
  }

  /**
   * Check if deployment is draining
   */
  isDraining(deploymentId: string): boolean {
    return this.draining.has(deploymentId);
  }
}

// ============================================================================
// Rollback Handler Class
// ============================================================================

export class RollbackHandler {
  private readonly defaultDrainTimeout: number;
  private readonly maxRetryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly logger?: Logger;
  private readonly stateManager: StateManager;
  private readonly connectionDrainer: ConnectionDrainer;

  private notificationCallback?: (event: NotificationEvent, data: Record<string, unknown>) => Promise<void>;
  private trafficCallback?: (percentage: number) => Promise<void>;

  constructor(config: RollbackHandlerConfig = {}) {
    this.defaultDrainTimeout = config.defaultDrainTimeout ?? 30;
    this.maxRetryAttempts = config.maxRetryAttempts ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.logger = config.logger;
    this.stateManager = new StateManager();
    this.connectionDrainer = new ConnectionDrainer();
  }

  /**
   * Set notification callback
   */
  onNotification(callback: (event: NotificationEvent, data: Record<string, unknown>) => Promise<void>): void {
    this.notificationCallback = callback;
  }

  /**
   * Set traffic update callback
   */
  onTrafficUpdate(callback: (percentage: number) => Promise<void>): void {
    this.trafficCallback = callback;
  }

  /**
   * Execute rollback for a deployment
   */
  async rollback(request: RollbackRequest): Promise<RollbackResult> {
    const { deployment, reason, automatic, force, drainTimeout } = request;

    this.logger?.info(`Starting rollback for deployment ${deployment.id}: ${reason}`);

    // Save current state before rollback
    if (deployment.config.rollbackPolicy.preserveState) {
      this.saveState(deployment);
    }

    // Notify rollback initiated
    await this.notify('rollback_initiated', {
      deploymentId: deployment.id,
      reason,
      automatic,
      fromStage: deployment.currentStage,
      fromPercentage: deployment.currentPercentage,
    });

    const actionsExecuted: RollbackActionResult[] = [];
    const startTime = Date.now();

    try {
      // Step 1: Graceful connection draining (unless forced)
      if (!force && deployment.config.rollbackPolicy.gracefulDrain) {
        const drainTimeoutSeconds = drainTimeout ?? deployment.config.rollbackPolicy.drainTimeout ?? this.defaultDrainTimeout;

        this.logger?.info(`Starting connection drain with ${drainTimeoutSeconds}s timeout`);
        this.connectionDrainer.startDrain(deployment.id, drainTimeoutSeconds);

        await this.connectionDrainer.waitForDrain(deployment.id, (status) => {
          this.logger?.debug(`Drain status: ${status.activeConnections} connections, ${status.remainingSeconds}s remaining`);
        });
      }

      // Step 2: Redirect all traffic to baseline
      await this.setTrafficToBaseline(deployment.id);

      // Step 3: Execute rollback actions
      const actions = deployment.config.rollbackPolicy.onRollback || [];
      for (const action of actions) {
        const result = await this.executeAction(action);
        actionsExecuted.push(result);

        if (!result.success) {
          this.logger?.warn(`Rollback action ${action.type} failed: ${result.error}`);
        }
      }

      const drainDuration = force ? 0 : Math.floor((Date.now() - startTime) / 1000);

      const rollbackInfo: RollbackInfo = {
        timestamp: new Date(),
        reason,
        fromStage: deployment.currentStage,
        fromPercentage: deployment.currentPercentage,
        automatic,
        drainDuration,
      };

      // Notify rollback completed
      await this.notify('rollback_completed', {
        deploymentId: deployment.id,
        rollbackInfo,
        actionsExecuted: actionsExecuted.length,
        durationMs: Date.now() - startTime,
      });

      this.logger?.info(`Rollback completed successfully for deployment ${deployment.id}`);

      return {
        success: true,
        info: rollbackInfo,
        actionsExecuted,
      };
    } catch (error) {
      const errorObj: DeploymentError = {
        code: 'ROLLBACK_FAILED',
        message: error instanceof Error ? error.message : 'Unknown rollback error',
        timestamp: new Date(),
        stage: deployment.currentStage,
        details: { reason },
      };

      this.logger?.error(`Rollback failed for deployment ${deployment.id}: ${errorObj.message}`);

      return {
        success: false,
        info: {
          timestamp: new Date(),
          reason,
          fromStage: deployment.currentStage,
          fromPercentage: deployment.currentPercentage,
          automatic,
        },
        error: errorObj,
        actionsExecuted,
      };
    }
  }

  /**
   * Execute instant rollback (no draining)
   */
  async instantRollback(deployment: CanaryDeployment, reason: string): Promise<RollbackResult> {
    return this.rollback({
      deployment,
      reason,
      automatic: true,
      force: true,
    });
  }

  /**
   * Check if deployment should be rolled back based on policy
   */
  shouldRollback(
    deployment: CanaryDeployment,
    failureCount: number,
    failureWindow: number
  ): { shouldRollback: boolean; reason?: string } {
    const policy = deployment.config.rollbackPolicy;

    if (!policy.automatic) {
      return { shouldRollback: false };
    }

    if (failureCount >= policy.failureThreshold) {
      return {
        shouldRollback: true,
        reason: `Failure threshold exceeded: ${failureCount} failures in ${failureWindow}s (threshold: ${policy.failureThreshold})`,
      };
    }

    return { shouldRollback: false };
  }

  /**
   * Save deployment state for potential restoration
   */
  saveState(deployment: CanaryDeployment): StateSnapshot {
    const snapshot = this.stateManager.saveSnapshot(deployment.id, {
      deploymentId: deployment.id,
      timestamp: new Date(),
      stage: deployment.currentStage,
      percentage: deployment.currentPercentage,
      metrics: deployment.metrics ? {
        errorRate: deployment.metrics.errorRate.length > 0
          ? deployment.metrics.errorRate[deployment.metrics.errorRate.length - 1].value
          : 0,
      } : undefined,
    });

    this.logger?.debug(`Saved state snapshot ${snapshot.id} for deployment ${deployment.id}`);
    return snapshot;
  }

  /**
   * Get saved state snapshots
   */
  getSavedStates(deploymentId: string): StateSnapshot[] {
    return this.stateManager.getSnapshots(deploymentId);
  }

  /**
   * Clear saved states
   */
  clearSavedStates(deploymentId: string): void {
    this.stateManager.clearSnapshots(deploymentId);
  }

  /**
   * Check if deployment is currently draining
   */
  isDraining(deploymentId: string): boolean {
    return this.connectionDrainer.isDraining(deploymentId);
  }

  /**
   * Get drain status
   */
  getDrainStatus(deploymentId: string): DrainStatus | null {
    return this.connectionDrainer.getDrainStatus(deploymentId);
  }

  /**
   * Cancel ongoing drain
   */
  cancelDrain(deploymentId: string): void {
    this.connectionDrainer.stopDrain(deploymentId);
    this.logger?.info(`Cancelled drain for deployment ${deploymentId}`);
  }

  /**
   * Set traffic to baseline (0% canary)
   */
  private async setTrafficToBaseline(deploymentId: string): Promise<void> {
    if (this.trafficCallback) {
      await this.trafficCallback(0);
    }
    this.logger?.debug(`Traffic redirected to baseline for deployment ${deploymentId}`);
  }

  /**
   * Execute a rollback action
   */
  private async executeAction(action: RollbackAction): Promise<RollbackActionResult> {
    const startTime = Date.now();

    try {
      switch (action.type) {
        case 'webhook':
          await this.executeWebhookAction(action.config);
          break;
        case 'script':
          await this.executeScriptAction(action.config);
          break;
        case 'notification':
          await this.executeNotificationAction(action.config);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      return {
        type: action.type,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        type: action.type,
        success: false,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute webhook action with retry
   */
  private async executeWebhookAction(config: Record<string, unknown>): Promise<void> {
    const url = config.url as string;
    const method = (config.method as string) || 'POST';
    const headers = (config.headers as Record<string, string>) || {};
    const body = config.body as Record<string, unknown>;
    const timeout = (config.timeout as number) || 10000;

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return;
      } catch (error) {
        if (attempt === this.maxRetryAttempts) {
          throw error;
        }
        await this.delay(this.retryDelayMs * attempt);
      }
    }
  }

  /**
   * Execute script action
   */
  private async executeScriptAction(config: Record<string, unknown>): Promise<void> {
    const script = config.script as string;
    const args = (config.args as string[]) || [];
    const timeout = (config.timeout as number) || 30000;

    // In production, this would execute the script
    // For now, log the script execution
    this.logger?.info(`Executing script: ${script} ${args.join(' ')} (timeout: ${timeout}ms)`);

    // Simulate script execution
    await this.delay(100);
  }

  /**
   * Execute notification action
   */
  private async executeNotificationAction(config: Record<string, unknown>): Promise<void> {
    const channel = config.channel as string;
    const message = config.message as string;

    this.logger?.info(`Sending notification to ${channel}: ${message}`);

    // Notification would be sent through the notification system
    if (this.notificationCallback) {
      await this.notificationCallback('rollback_completed', { channel, message });
    }
  }

  /**
   * Send notification
   */
  private async notify(event: NotificationEvent, data: Record<string, unknown>): Promise<void> {
    if (this.notificationCallback) {
      try {
        await this.notificationCallback(event, data);
      } catch (error) {
        this.logger?.warn(`Failed to send notification: ${error}`);
      }
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new rollback handler instance
 */
export function createRollbackHandler(config?: RollbackHandlerConfig): RollbackHandler {
  return new RollbackHandler(config);
}

/**
 * Create a default rollback policy
 */
export function createDefaultRollbackPolicy(overrides?: Partial<RollbackPolicy>): RollbackPolicy {
  return {
    automatic: true,
    failureThreshold: 3,
    failureWindow: 60,
    gracefulDrain: true,
    drainTimeout: 30,
    preserveState: true,
    onRollback: [],
    ...overrides,
  };
}

/**
 * Create a webhook rollback action
 */
export function createWebhookRollbackAction(
  url: string,
  options?: {
    method?: 'POST' | 'PUT';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    timeout?: number;
  }
): RollbackAction {
  return {
    type: 'webhook',
    config: {
      url,
      method: options?.method || 'POST',
      headers: options?.headers || {},
      body: options?.body,
      timeout: options?.timeout || 10000,
    },
  };
}

/**
 * Create a script rollback action
 */
export function createScriptRollbackAction(
  script: string,
  args?: string[],
  timeout?: number
): RollbackAction {
  return {
    type: 'script',
    config: {
      script,
      args: args || [],
      timeout: timeout || 30000,
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate rollback policy
 */
export function validateRollbackPolicy(policy: RollbackPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (policy.failureThreshold < 1) {
    errors.push('Failure threshold must be at least 1');
  }

  if (policy.failureWindow < 1) {
    errors.push('Failure window must be at least 1 second');
  }

  if (policy.drainTimeout < 0) {
    errors.push('Drain timeout cannot be negative');
  }

  if (policy.drainTimeout > 600) {
    errors.push('Drain timeout should not exceed 600 seconds');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format rollback info for display
 */
export function formatRollbackInfo(info: RollbackInfo): string {
  const lines = [
    `Rollback at ${info.timestamp.toISOString()}`,
    `  Reason: ${info.reason}`,
    `  From stage ${info.fromStage} (${info.fromPercentage}% traffic)`,
    `  Type: ${info.automatic ? 'Automatic' : 'Manual'}`,
  ];

  if (info.drainDuration !== undefined) {
    lines.push(`  Drain duration: ${info.drainDuration}s`);
  }

  return lines.join('\n');
}
