/**
 * Vorion Security Platform - Canary Deployment System
 *
 * A comprehensive canary deployment system for gradual rollouts with:
 * - Traffic splitting (percentage-based routing)
 * - Gradual rollout stages (1% -> 5% -> 25% -> 50% -> 100%)
 * - Automatic promotion based on metrics
 * - Automatic rollback on failure detection
 * - Manual pause/resume/abort controls
 *
 * @module @vorion/deploy/canary
 */

// Types
export * from './types';

// Core components
export {
  CanaryController,
  CanaryControllerConfig,
  createCanaryController,
  createDefaultCanaryConfig,
  DEFAULT_CANARY_STAGES,
  DEFAULT_METRIC_THRESHOLDS,
  DEFAULT_ROLLBACK_POLICY,
} from './controller';

export {
  MetricsAnalyzer,
  MetricsAnalyzerConfig,
  createMetricsAnalyzer,
  createEmptyMetrics,
  mergeMetrics,
} from './metrics-analyzer';

export {
  TrafficRouter,
  TrafficRouterConfig,
  TrafficSplit,
  RoutingContext,
  createTrafficRouter,
  createRoutingContext,
  createHeaderRoute,
  createCookieRoute,
  validateTrafficSplit,
} from './traffic-router';

export {
  RollbackHandler,
  RollbackHandlerConfig,
  RollbackRequest,
  RollbackResult,
  DrainStatus,
  StateSnapshot,
  createRollbackHandler,
  createDefaultRollbackPolicy,
  createWebhookRollbackAction,
  createScriptRollbackAction,
  validateRollbackPolicy,
  formatRollbackInfo,
} from './rollback';

export {
  NotificationManager,
  NotificationManagerConfig,
  NotificationPayload,
  NotificationResult,
  DeploymentTimelineEvent,
  createNotificationManager,
  createDefaultNotificationConfig,
  createSlackChannel,
  createPagerDutyChannel,
  createEmailChannel,
} from './notifications';

export {
  CanaryCLI,
  CLIOptions,
  createCanaryCLI,
  runCLI,
} from './cli';

// ============================================================================
// Quick Start Example
// ============================================================================

/**
 * Quick start example:
 *
 * ```typescript
 * import {
 *   createCanaryController,
 *   createDefaultCanaryConfig,
 *   createSlackChannel,
 *   createDefaultNotificationConfig,
 * } from '@vorion/deploy/canary';
 *
 * // Create controller with notifications
 * const controller = createCanaryController({
 *   notificationManager: {
 *     config: createDefaultNotificationConfig({
 *       channels: [
 *         createSlackChannel('https://hooks.slack.com/...'),
 *       ],
 *     }),
 *   },
 * });
 *
 * // Create and start deployment
 * const config = createDefaultCanaryConfig(
 *   'my-service-v2',
 *   'my-service',
 *   'production'
 * );
 *
 * const deployment = await controller.start(config);
 * console.log(`Started deployment: ${deployment.id}`);
 *
 * // Monitor status
 * const status = controller.getStatus(deployment.id);
 * console.log(`Current stage: ${status.deployment.currentStage}`);
 * console.log(`Traffic: ${status.trafficSplit.canary}% canary`);
 *
 * // Manual controls
 * await controller.pause(deployment.id);
 * await controller.resume(deployment.id);
 * await controller.promote(deployment.id);
 * await controller.rollback(deployment.id, 'Manual rollback requested');
 * ```
 */

// ============================================================================
// CLI Usage Example
// ============================================================================

/**
 * CLI usage example:
 *
 * ```bash
 * # Start a canary deployment
 * canary start my-deployment --service my-service --namespace production
 *
 * # Check status
 * canary status my-deployment-id
 *
 * # Promote to next stage
 * canary promote my-deployment-id
 *
 * # Rollback
 * canary rollback my-deployment-id --reason "High error rate detected"
 *
 * # Pause/Resume
 * canary pause my-deployment-id
 * canary resume my-deployment-id
 *
 * # List all deployments
 * canary list --format json
 *
 * # View metrics
 * canary metrics my-deployment-id --compare --window 15
 * ```
 */
