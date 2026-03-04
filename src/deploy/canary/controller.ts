/**
 * Vorion Security Platform - Canary Deployment Controller
 * Main orchestrator for canary deployments with traffic splitting and automatic promotion/rollback
 */

import {
  CanaryConfig,
  CanaryDeployment,
  CanaryStatus,
  CanaryStage,
  StageTransition,
  MetricsSnapshot,
  DeploymentError,
  CollectedMetrics,
  MetricThreshold,
  RollbackPolicy,
  NotificationEvent,
  CanaryEvent,
  CanaryEventType,
  Logger,
  DeploymentStore,
} from './types';
import { MetricsAnalyzer, createMetricsAnalyzer, createEmptyMetrics } from './metrics-analyzer';
import { TrafficRouter, createTrafficRouter, TrafficRouterConfig } from './traffic-router';
import { RollbackHandler, createRollbackHandler, RollbackHandlerConfig } from './rollback';
import { NotificationManager, createNotificationManager, NotificationManagerConfig } from './notifications';

// ============================================================================
// Types
// ============================================================================

export interface CanaryControllerConfig {
  /** Traffic router configuration */
  trafficRouter?: TrafficRouterConfig;
  /** Rollback handler configuration */
  rollbackHandler?: RollbackHandlerConfig;
  /** Notification manager configuration */
  notificationManager?: NotificationManagerConfig;
  /** Metrics collection interval in seconds */
  metricsInterval?: number;
  /** Default promotion delay in seconds */
  defaultPromotionDelay?: number;
  /** Enable automatic progression */
  autoProgress?: boolean;
  /** Deployment store for persistence */
  store?: DeploymentStore;
  /** Logger instance */
  logger?: Logger;
}

export interface DeploymentOptions {
  /** Skip initial validation */
  skipValidation?: boolean;
  /** Force start even if another deployment is active */
  force?: boolean;
  /** Actor initiating the deployment */
  actor?: string;
}

export interface ControllerState {
  /** Active deployments */
  activeDeployments: Map<string, CanaryDeployment>;
  /** Deployment timers */
  timers: Map<string, NodeJS.Timeout>;
  /** Metrics collection intervals */
  metricsIntervals: Map<string, NodeJS.Timeout>;
  /** Failure counters */
  failureCounters: Map<string, { count: number; windowStart: number }>;
}

// ============================================================================
// Default Stages
// ============================================================================

/**
 * Default canary stages: 1% -> 5% -> 25% -> 50% -> 100%
 */
export const DEFAULT_CANARY_STAGES: CanaryStage[] = [
  { percentage: 1, duration: 300, requiredSuccessRate: 0.99, name: 'Initial' },
  { percentage: 5, duration: 300, requiredSuccessRate: 0.99, name: 'Early Adopters' },
  { percentage: 25, duration: 600, requiredSuccessRate: 0.98, name: 'Expansion' },
  { percentage: 50, duration: 600, requiredSuccessRate: 0.97, name: 'Majority' },
  { percentage: 100, duration: 0, requiredSuccessRate: 0.95, name: 'Full Rollout' },
];

/**
 * Default metric thresholds
 */
export const DEFAULT_METRIC_THRESHOLDS: MetricThreshold[] = [
  { metric: 'error_rate', operator: 'lt', threshold: 0.01, window: 60, critical: true },
  { metric: 'latency_p99', operator: 'lt', threshold: 1000, window: 60, critical: false },
  { metric: 'latency_p95', operator: 'lt', threshold: 500, window: 60, critical: false },
];

/**
 * Default rollback policy
 */
export const DEFAULT_ROLLBACK_POLICY: RollbackPolicy = {
  automatic: true,
  failureThreshold: 3,
  failureWindow: 60,
  gracefulDrain: true,
  drainTimeout: 30,
  preserveState: true,
  onRollback: [],
};

// ============================================================================
// Canary Controller Class
// ============================================================================

export class CanaryController {
  private readonly trafficRouter: TrafficRouter;
  private readonly rollbackHandler: RollbackHandler;
  private readonly metricsAnalyzer: MetricsAnalyzer;
  private readonly notificationManager?: NotificationManager;
  private readonly metricsInterval: number;
  private readonly defaultPromotionDelay: number;
  private readonly autoProgress: boolean;
  private readonly store?: DeploymentStore;
  private readonly logger?: Logger;

  private readonly state: ControllerState = {
    activeDeployments: new Map(),
    timers: new Map(),
    metricsIntervals: new Map(),
    failureCounters: new Map(),
  };

  private readonly eventListeners: Map<CanaryEventType, Array<(event: CanaryEvent) => void>> = new Map();
  private baselineMetrics: Map<string, CollectedMetrics> = new Map();

  constructor(config: CanaryControllerConfig = {}) {
    this.trafficRouter = createTrafficRouter(config.trafficRouter);
    this.rollbackHandler = createRollbackHandler(config.rollbackHandler);
    this.metricsAnalyzer = createMetricsAnalyzer({ logger: config.logger });

    if (config.notificationManager) {
      this.notificationManager = createNotificationManager(config.notificationManager);
    }

    this.metricsInterval = config.metricsInterval ?? 15;
    this.defaultPromotionDelay = config.defaultPromotionDelay ?? 300;
    this.autoProgress = config.autoProgress ?? true;
    this.store = config.store;
    this.logger = config.logger;

    // Wire up rollback handler callbacks
    this.rollbackHandler.onTrafficUpdate(async (percentage) => {
      await this.trafficRouter.setTrafficSplit(percentage);
    });
  }

  // ============================================================================
  // Deployment Lifecycle
  // ============================================================================

  /**
   * Start a new canary deployment
   */
  async start(config: CanaryConfig, options: DeploymentOptions = {}): Promise<CanaryDeployment> {
    this.logger?.info(`Starting canary deployment: ${config.name}`);

    // Validate configuration
    if (!options.skipValidation) {
      this.validateConfig(config);
    }

    // Check for existing deployments
    const existingDeployment = this.getActiveDeployment(config.targetService, config.namespace);
    if (existingDeployment && !options.force) {
      throw new Error(`Active deployment already exists for ${config.targetService} in ${config.namespace}`);
    }

    // Create deployment
    const deployment: CanaryDeployment = {
      id: this.generateDeploymentId(),
      config,
      status: 'initializing',
      currentStage: 0,
      currentPercentage: 0,
      startTime: new Date(),
      lastUpdated: new Date(),
      stageHistory: [],
      metrics: createEmptyMetrics(),
    };

    // Store deployment
    this.state.activeDeployments.set(deployment.id, deployment);
    if (this.store) {
      await this.store.save(deployment);
    }

    // Emit event
    this.emitEvent('deployment_created', deployment, { actor: options.actor });

    // Start deployment process
    try {
      // Collect baseline metrics
      this.logger?.info('Collecting baseline metrics...');
      const baselineMetrics = await this.collectMetrics(deployment, 'baseline');
      this.baselineMetrics.set(deployment.id, baselineMetrics);

      // Set initial traffic split
      const initialStage = config.stages[0];
      await this.trafficRouter.setTrafficSplit(initialStage.percentage);

      // Update deployment state
      deployment.status = 'progressing';
      deployment.currentStage = 0;
      deployment.currentPercentage = initialStage.percentage;
      deployment.lastUpdated = new Date();

      // Record stage transition
      deployment.stageHistory.push({
        stage: 0,
        percentage: initialStage.percentage,
        timestamp: new Date(),
        status: 'success',
        reason: 'Initial deployment',
      });

      // Persist and emit
      await this.persistDeployment(deployment);
      this.emitEvent('deployment_started', deployment);

      // Notify
      await this.notificationManager?.notifyDeploymentStarted(deployment);

      // Start metrics collection
      this.startMetricsCollection(deployment);

      // Schedule automatic progression if enabled
      if (this.autoProgress) {
        this.scheduleStageProgression(deployment);
      }

      this.logger?.info(`Canary deployment started: ${deployment.id} at ${initialStage.percentage}%`);
      return deployment;
    } catch (error) {
      deployment.status = 'failed';
      deployment.error = {
        code: 'START_FAILED',
        message: error instanceof Error ? error.message : 'Failed to start deployment',
        timestamp: new Date(),
      };

      await this.persistDeployment(deployment);
      this.emitEvent('deployment_failed', deployment, { error: deployment.error });

      throw error;
    }
  }

  /**
   * Manually promote to next stage
   */
  async promote(deploymentId: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'progressing' && deployment.status !== 'paused') {
      throw new Error(`Cannot promote deployment in status: ${deployment.status}`);
    }

    const currentStage = deployment.currentStage;
    const nextStage = currentStage + 1;

    if (nextStage >= deployment.config.stages.length) {
      // Final promotion - complete deployment
      return this.complete(deploymentId, actor);
    }

    this.logger?.info(`Promoting deployment ${deploymentId} from stage ${currentStage} to ${nextStage}`);

    // Cancel scheduled progression
    this.cancelScheduledProgression(deploymentId);

    // Perform promotion
    await this.progressToStage(deployment, nextStage, actor);

    return deployment;
  }

  /**
   * Manually rollback deployment
   */
  async rollback(deploymentId: string, reason: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger?.info(`Manual rollback requested for ${deploymentId}: ${reason}`);

    // Cancel all scheduled operations
    this.cancelScheduledProgression(deploymentId);
    this.stopMetricsCollection(deploymentId);

    // Execute rollback
    const result = await this.rollbackHandler.rollback({
      deployment,
      reason,
      automatic: false,
    });

    if (result.success) {
      deployment.status = 'rolled_back';
      deployment.rollbackInfo = result.info;
    } else {
      deployment.status = 'failed';
      deployment.error = result.error;
    }

    deployment.lastUpdated = new Date();
    await this.persistDeployment(deployment);

    // Emit events
    this.emitEvent('rollback_completed', deployment, { actor, reason });

    // Notify
    await this.notificationManager?.notifyRollback(deployment, reason, false);

    // Cleanup
    this.state.activeDeployments.delete(deploymentId);

    return deployment;
  }

  /**
   * Pause deployment
   */
  async pause(deploymentId: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'progressing') {
      throw new Error(`Cannot pause deployment in status: ${deployment.status}`);
    }

    this.logger?.info(`Pausing deployment: ${deploymentId}`);

    // Cancel scheduled progression but keep metrics collection
    this.cancelScheduledProgression(deploymentId);

    deployment.status = 'paused';
    deployment.lastUpdated = new Date();
    await this.persistDeployment(deployment);

    this.emitEvent('deployment_paused', deployment, { actor });

    return deployment;
  }

  /**
   * Resume paused deployment
   */
  async resume(deploymentId: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'paused') {
      throw new Error(`Cannot resume deployment in status: ${deployment.status}`);
    }

    this.logger?.info(`Resuming deployment: ${deploymentId}`);

    deployment.status = 'progressing';
    deployment.lastUpdated = new Date();
    await this.persistDeployment(deployment);

    // Resume automatic progression if enabled
    if (this.autoProgress) {
      this.scheduleStageProgression(deployment);
    }

    this.emitEvent('deployment_resumed', deployment, { actor });

    return deployment;
  }

  /**
   * Abort deployment
   */
  async abort(deploymentId: string, reason: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger?.info(`Aborting deployment: ${deploymentId}`);

    // Stop all operations
    this.cancelScheduledProgression(deploymentId);
    this.stopMetricsCollection(deploymentId);

    // Reset traffic to baseline
    await this.trafficRouter.setTrafficSplit(0);

    deployment.status = 'aborted';
    deployment.lastUpdated = new Date();
    deployment.error = {
      code: 'ABORTED',
      message: reason,
      timestamp: new Date(),
    };

    await this.persistDeployment(deployment);
    this.emitEvent('deployment_aborted', deployment, { actor, reason });

    // Cleanup
    this.state.activeDeployments.delete(deploymentId);

    return deployment;
  }

  /**
   * Complete deployment (100% traffic to canary)
   */
  private async complete(deploymentId: string, actor?: string): Promise<CanaryDeployment> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger?.info(`Completing deployment: ${deploymentId}`);

    // Stop scheduled operations
    this.cancelScheduledProgression(deploymentId);
    this.stopMetricsCollection(deploymentId);

    // Set traffic to 100%
    await this.trafficRouter.setTrafficSplit(100);

    deployment.status = 'succeeded';
    deployment.currentPercentage = 100;
    deployment.lastUpdated = new Date();

    // Record final transition
    deployment.stageHistory.push({
      stage: deployment.config.stages.length - 1,
      percentage: 100,
      timestamp: new Date(),
      status: 'success',
      reason: 'Deployment completed',
    });

    await this.persistDeployment(deployment);
    this.emitEvent('deployment_succeeded', deployment, { actor });

    // Notify
    await this.notificationManager?.notifyDeploymentSucceeded(deployment);

    // Cleanup
    this.state.activeDeployments.delete(deploymentId);
    this.baselineMetrics.delete(deploymentId);

    return deployment;
  }

  // ============================================================================
  // Stage Progression
  // ============================================================================

  /**
   * Progress to a specific stage
   */
  private async progressToStage(deployment: CanaryDeployment, stageIndex: number, actor?: string): Promise<void> {
    const stage = deployment.config.stages[stageIndex];
    if (!stage) {
      throw new Error(`Invalid stage index: ${stageIndex}`);
    }

    const previousStage = deployment.currentStage;
    const previousPercentage = deployment.currentPercentage;

    this.logger?.info(`Progressing to stage ${stageIndex} (${stage.percentage}%)`);

    // Update traffic
    await this.trafficRouter.setTrafficSplit(stage.percentage);

    // Update deployment
    deployment.currentStage = stageIndex;
    deployment.currentPercentage = stage.percentage;
    deployment.lastUpdated = new Date();

    // Record transition
    const metricsSnapshot = await this.captureMetricsSnapshot(deployment);
    deployment.stageHistory.push({
      stage: stageIndex,
      percentage: stage.percentage,
      timestamp: new Date(),
      status: 'success',
      metricsSnapshot,
      reason: `Promoted from stage ${previousStage}`,
    });

    await this.persistDeployment(deployment);
    this.emitEvent('stage_completed', deployment, {
      previousStage,
      newStage: stageIndex,
      actor,
    });

    // Notify
    await this.notificationManager?.notifyStagePromoted(
      deployment,
      previousStage,
      stageIndex,
      metricsSnapshot?.errorRate ? (1 - metricsSnapshot.errorRate) * 100 : undefined
    );

    // Schedule next progression if not final stage
    if (this.autoProgress && stageIndex < deployment.config.stages.length - 1) {
      this.scheduleStageProgression(deployment);
    } else if (stageIndex === deployment.config.stages.length - 1) {
      // Final stage reached
      await this.complete(deployment.id, actor);
    }
  }

  /**
   * Schedule automatic stage progression
   */
  private scheduleStageProgression(deployment: CanaryDeployment): void {
    const currentStage = deployment.config.stages[deployment.currentStage];
    const delay = (currentStage.duration || this.defaultPromotionDelay) * 1000;

    this.logger?.debug(`Scheduling progression for ${deployment.id} in ${delay}ms`);

    const timer = setTimeout(async () => {
      try {
        await this.evaluateAndProgress(deployment);
      } catch (error) {
        this.logger?.error(`Auto-progression failed: ${error}`);
      }
    }, delay);

    this.state.timers.set(deployment.id, timer);
  }

  /**
   * Cancel scheduled progression
   */
  private cancelScheduledProgression(deploymentId: string): void {
    const timer = this.state.timers.get(deploymentId);
    if (timer) {
      clearTimeout(timer);
      this.state.timers.delete(deploymentId);
    }
  }

  /**
   * Evaluate metrics and progress if healthy
   */
  private async evaluateAndProgress(deployment: CanaryDeployment): Promise<void> {
    // Get fresh deployment state
    const currentDeployment = this.getDeployment(deployment.id);
    if (!currentDeployment || currentDeployment.status !== 'progressing') {
      return;
    }

    this.logger?.info(`Evaluating deployment ${deployment.id} for progression`);

    // Get baseline and canary metrics
    const baselineMetrics = this.baselineMetrics.get(deployment.id) || createEmptyMetrics();
    const canaryMetrics = currentDeployment.metrics;

    // Analyze metrics
    const comparison = await this.metricsAnalyzer.compare(
      baselineMetrics,
      canaryMetrics,
      currentDeployment.config.metrics
    );

    // Check if should promote
    const currentStage = currentDeployment.config.stages[currentDeployment.currentStage];
    const { shouldPromote, reason: promoteReason } = await this.metricsAnalyzer.shouldPromote(
      comparison,
      currentStage.requiredSuccessRate
    );

    if (shouldPromote) {
      const nextStage = currentDeployment.currentStage + 1;
      if (nextStage < currentDeployment.config.stages.length) {
        await this.progressToStage(currentDeployment, nextStage);
      } else {
        await this.complete(currentDeployment.id);
      }
    } else {
      // Check if should rollback
      const { shouldRollback, reason: rollbackReason } = await this.metricsAnalyzer.shouldRollback(
        comparison,
        currentDeployment.config.rollbackPolicy.failureThreshold
      );

      if (shouldRollback) {
        this.logger?.warn(`Auto-rollback triggered: ${rollbackReason}`);
        await this.triggerAutoRollback(currentDeployment, rollbackReason);
      } else {
        // Not ready to promote but not failing - reschedule check
        this.logger?.info(`Not ready to promote: ${promoteReason}. Will check again.`);
        this.scheduleStageProgression(currentDeployment);
      }
    }
  }

  /**
   * Trigger automatic rollback
   */
  private async triggerAutoRollback(deployment: CanaryDeployment, reason: string): Promise<void> {
    // Stop all scheduled operations
    this.cancelScheduledProgression(deployment.id);
    this.stopMetricsCollection(deployment.id);

    // Execute rollback
    const result = await this.rollbackHandler.rollback({
      deployment,
      reason,
      automatic: true,
    });

    if (result.success) {
      deployment.status = 'rolled_back';
      deployment.rollbackInfo = result.info;
    } else {
      deployment.status = 'failed';
      deployment.error = result.error;
    }

    deployment.lastUpdated = new Date();
    await this.persistDeployment(deployment);

    this.emitEvent('rollback_completed', deployment, { automatic: true, reason });
    await this.notificationManager?.notifyRollback(deployment, reason, true);

    // Cleanup
    this.state.activeDeployments.delete(deployment.id);
  }

  // ============================================================================
  // Metrics Collection
  // ============================================================================

  /**
   * Start metrics collection for deployment
   */
  private startMetricsCollection(deployment: CanaryDeployment): void {
    const intervalMs = this.metricsInterval * 1000;

    const interval = setInterval(async () => {
      try {
        await this.collectAndUpdateMetrics(deployment.id);
      } catch (error) {
        this.logger?.error(`Metrics collection failed: ${error}`);
      }
    }, intervalMs);

    this.state.metricsIntervals.set(deployment.id, interval);
  }

  /**
   * Stop metrics collection
   */
  private stopMetricsCollection(deploymentId: string): void {
    const interval = this.state.metricsIntervals.get(deploymentId);
    if (interval) {
      clearInterval(interval);
      this.state.metricsIntervals.delete(deploymentId);
    }
  }

  /**
   * Collect and update metrics for deployment
   */
  private async collectAndUpdateMetrics(deploymentId: string): Promise<void> {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) return;

    const newMetrics = await this.collectMetrics(deployment, 'canary');

    // Merge with existing metrics
    deployment.metrics.errorRate.push(...newMetrics.errorRate);
    deployment.metrics.requestCount.push(...newMetrics.requestCount);
    deployment.metrics.latency.p50.push(...newMetrics.latency.p50);
    deployment.metrics.latency.p75.push(...newMetrics.latency.p75);
    deployment.metrics.latency.p90.push(...newMetrics.latency.p90);
    deployment.metrics.latency.p95.push(...newMetrics.latency.p95);
    deployment.metrics.latency.p99.push(...newMetrics.latency.p99);

    // Limit metrics history (keep last 1000 points)
    const maxPoints = 1000;
    const trimArray = (arr: Array<unknown>) => {
      if (arr.length > maxPoints) {
        arr.splice(0, arr.length - maxPoints);
      }
    };

    trimArray(deployment.metrics.errorRate);
    trimArray(deployment.metrics.requestCount);
    trimArray(deployment.metrics.latency.p50);
    trimArray(deployment.metrics.latency.p75);
    trimArray(deployment.metrics.latency.p90);
    trimArray(deployment.metrics.latency.p95);
    trimArray(deployment.metrics.latency.p99);

    deployment.lastUpdated = new Date();

    // Check thresholds
    await this.checkThresholds(deployment);

    this.emitEvent('metrics_collected', deployment);
  }

  /**
   * Collect metrics (simulated - in production, connect to metrics backend)
   */
  private async collectMetrics(deployment: CanaryDeployment, target: 'baseline' | 'canary'): Promise<CollectedMetrics> {
    // In production, this would query Prometheus, Datadog, etc.
    // For now, generate simulated metrics

    const now = new Date();
    const baseErrorRate = target === 'canary' ? 0.005 : 0.003;
    const baseLatency = target === 'canary' ? 120 : 100;

    // Add some random variation
    const errorRate = baseErrorRate + (Math.random() - 0.5) * 0.002;
    const latencyBase = baseLatency + (Math.random() - 0.5) * 20;

    return {
      errorRate: [{ timestamp: now, value: Math.max(0, errorRate) }],
      latency: {
        p50: [{ timestamp: now, value: latencyBase }],
        p75: [{ timestamp: now, value: latencyBase * 1.3 }],
        p90: [{ timestamp: now, value: latencyBase * 1.8 }],
        p95: [{ timestamp: now, value: latencyBase * 2.5 }],
        p99: [{ timestamp: now, value: latencyBase * 4 }],
      },
      requestCount: [{ timestamp: now, value: Math.floor(100 + Math.random() * 50) }],
      custom: {},
    };
  }

  /**
   * Check metric thresholds
   */
  private async checkThresholds(deployment: CanaryDeployment): Promise<void> {
    const baselineMetrics = this.baselineMetrics.get(deployment.id) || createEmptyMetrics();

    const comparison = await this.metricsAnalyzer.compare(
      baselineMetrics,
      deployment.metrics,
      deployment.config.metrics
    );

    // Detect anomalies
    const anomalies = this.metricsAnalyzer.detectAnomalies(deployment.metrics);
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');

    for (const anomaly of criticalAnomalies) {
      this.emitEvent('anomaly_detected', deployment, { anomaly });
      await this.notificationManager?.notifyAnomalyDetected(
        deployment,
        anomaly.type,
        anomaly.severity,
        anomaly.description
      );
    }

    // Check for threshold breaches
    for (const assessment of comparison.health.metrics) {
      if (assessment.status === 'fail') {
        this.recordFailure(deployment.id);
        this.emitEvent('threshold_breached', deployment, { assessment });

        // Check if we should auto-rollback
        if (this.shouldAutoRollback(deployment)) {
          await this.triggerAutoRollback(
            deployment,
            `Threshold breach: ${assessment.metric} (${assessment.value} vs ${assessment.threshold})`
          );
        }
      }
    }
  }

  /**
   * Record a failure for rollback tracking
   */
  private recordFailure(deploymentId: string): void {
    const deployment = this.getDeployment(deploymentId);
    if (!deployment) return;

    const window = deployment.config.rollbackPolicy.failureWindow * 1000;
    const now = Date.now();

    let counter = this.state.failureCounters.get(deploymentId);
    if (!counter || now - counter.windowStart > window) {
      counter = { count: 0, windowStart: now };
    }

    counter.count++;
    this.state.failureCounters.set(deploymentId, counter);
  }

  /**
   * Check if auto-rollback should be triggered
   */
  private shouldAutoRollback(deployment: CanaryDeployment): boolean {
    if (!deployment.config.rollbackPolicy.automatic) {
      return false;
    }

    const counter = this.state.failureCounters.get(deployment.id);
    if (!counter) return false;

    return counter.count >= deployment.config.rollbackPolicy.failureThreshold;
  }

  /**
   * Capture metrics snapshot
   */
  private async captureMetricsSnapshot(deployment: CanaryDeployment): Promise<MetricsSnapshot> {
    const metrics = deployment.metrics;
    const getLatestValue = (arr: Array<{ value: number }>) =>
      arr.length > 0 ? arr[arr.length - 1].value : 0;

    return {
      timestamp: new Date(),
      errorRate: getLatestValue(metrics.errorRate),
      latencyP50: getLatestValue(metrics.latency.p50),
      latencyP95: getLatestValue(metrics.latency.p95),
      latencyP99: getLatestValue(metrics.latency.p99),
      requestCount: getLatestValue(metrics.requestCount),
      customMetrics: {},
    };
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get deployment by ID
   */
  getDeployment(deploymentId: string): CanaryDeployment | undefined {
    return this.state.activeDeployments.get(deploymentId);
  }

  /**
   * Get active deployment for service/namespace
   */
  getActiveDeployment(service: string, namespace: string): CanaryDeployment | undefined {
    for (const deployment of this.state.activeDeployments.values()) {
      if (deployment.config.targetService === service &&
          deployment.config.namespace === namespace &&
          ['initializing', 'progressing', 'paused'].includes(deployment.status)) {
        return deployment;
      }
    }
    return undefined;
  }

  /**
   * List all active deployments
   */
  listActiveDeployments(): CanaryDeployment[] {
    return Array.from(this.state.activeDeployments.values());
  }

  /**
   * Get deployment status summary
   */
  getStatus(deploymentId: string): {
    deployment: CanaryDeployment | null;
    trafficSplit: { baseline: number; canary: number };
    health?: { status: string; score: number };
  } {
    const deployment = this.getDeployment(deploymentId);
    const trafficSplit = this.trafficRouter.getTrafficSplit();

    if (!deployment) {
      return { deployment: null, trafficSplit };
    }

    return {
      deployment,
      trafficSplit,
      health: undefined, // Would be populated from latest metrics analysis
    };
  }

  // ============================================================================
  // Event System
  // ============================================================================

  /**
   * Subscribe to deployment events
   */
  on(eventType: CanaryEventType, listener: (event: CanaryEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * Unsubscribe from deployment events
   */
  off(eventType: CanaryEventType, listener: (event: CanaryEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emitEvent(type: CanaryEventType, deployment: CanaryDeployment, data?: Record<string, unknown>): void {
    const event: CanaryEvent = {
      id: this.generateEventId(),
      type,
      deploymentId: deployment.id,
      timestamp: new Date(),
      data: data || {},
    };

    const listeners = this.eventListeners.get(type) || [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.error(`Event listener error: ${error}`);
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Validate canary configuration
   */
  private validateConfig(config: CanaryConfig): void {
    if (!config.name) {
      throw new Error('Deployment name is required');
    }
    if (!config.targetService) {
      throw new Error('Target service is required');
    }
    if (!config.stages || config.stages.length === 0) {
      throw new Error('At least one stage is required');
    }

    // Validate stages
    let previousPercentage = 0;
    for (let i = 0; i < config.stages.length; i++) {
      const stage = config.stages[i];
      if (stage.percentage <= previousPercentage) {
        throw new Error(`Stage ${i} percentage must be greater than previous stage`);
      }
      if (stage.percentage > 100) {
        throw new Error(`Stage ${i} percentage cannot exceed 100`);
      }
      if (stage.requiredSuccessRate < 0 || stage.requiredSuccessRate > 1) {
        throw new Error(`Stage ${i} required success rate must be between 0 and 1`);
      }
      previousPercentage = stage.percentage;
    }

    // Validate final stage is 100%
    if (config.stages[config.stages.length - 1].percentage !== 100) {
      throw new Error('Final stage must have 100% traffic');
    }
  }

  /**
   * Persist deployment to store
   */
  private async persistDeployment(deployment: CanaryDeployment): Promise<void> {
    if (this.store) {
      await this.store.save(deployment);
    }
  }

  /**
   * Generate deployment ID
   */
  private generateDeploymentId(): string {
    return `canary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown controller
   */
  async shutdown(): Promise<void> {
    this.logger?.info('Shutting down canary controller');

    // Stop all timers and intervals
    for (const timer of this.state.timers.values()) {
      clearTimeout(timer);
    }
    for (const interval of this.state.metricsIntervals.values()) {
      clearInterval(interval);
    }

    this.state.timers.clear();
    this.state.metricsIntervals.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new canary controller
 */
export function createCanaryController(config?: CanaryControllerConfig): CanaryController {
  return new CanaryController(config);
}

/**
 * Create a default canary configuration
 */
export function createDefaultCanaryConfig(
  name: string,
  targetService: string,
  namespace: string,
  overrides?: Partial<CanaryConfig>
): CanaryConfig {
  return {
    name,
    targetService,
    namespace,
    stages: DEFAULT_CANARY_STAGES,
    metrics: DEFAULT_METRIC_THRESHOLDS,
    rollbackPolicy: DEFAULT_ROLLBACK_POLICY,
    promotionDelay: 300,
    ...overrides,
  };
}
