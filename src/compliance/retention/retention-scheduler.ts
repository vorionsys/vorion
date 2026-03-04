/**
 * Retention Policy Scheduler
 *
 * Manages scheduled jobs for retention policy enforcement:
 * - Daily enforcement at 2 AM
 * - Weekly compliance reports
 * - Alert generation on failures
 *
 * Uses leader election to ensure only one instance runs scheduled tasks.
 *
 * @packageDocumentation
 */

import cron, { type ScheduledTask as CronTask } from 'node-cron';
import { createLogger } from '../../common/logger.js';
import { getConfig } from '../../common/config.js';
import { getLeaderElection, type LeaderElection } from '../../common/leader-election.js';
import {
  getRetentionEnforcer,
  type RetentionEnforcer,
  type EnforcementOptions,
} from './retention-enforcer.js';
import type { RetentionReport, RetentionComplianceStatus } from './retention-policy.js';

const logger = createLogger({ component: 'retention-scheduler' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Scheduler configuration
 */
export interface RetentionSchedulerConfig {
  /** Enable/disable the scheduler */
  enabled: boolean;
  /** Cron expression for daily enforcement (default: 2 AM) */
  enforcementCron: string;
  /** Cron expression for weekly compliance report (default: Sunday 3 AM) */
  reportCron: string;
  /** Batch size for enforcement operations */
  batchSize: number;
  /** Alert callback for enforcement failures */
  onEnforcementFailure?: (report: RetentionReport, errors: string[]) => Promise<void>;
  /** Alert callback for compliance issues */
  onComplianceIssue?: (status: RetentionComplianceStatus) => Promise<void>;
  /** Report generation callback */
  onReportGenerated?: (report: RetentionReport) => Promise<void>;
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: RetentionSchedulerConfig = {
  enabled: true,
  enforcementCron: '0 2 * * *',  // Daily at 2 AM
  reportCron: '0 3 * * 0',       // Sunday at 3 AM
  batchSize: 1000,
};

/**
 * Scheduled task entry
 */
interface ScheduledTask {
  name: string;
  task: CronTask;
  cronExpression: string;
}

/**
 * Scheduler status
 */
export interface RetentionSchedulerStatus {
  isLeader: boolean;
  instanceId: string | null;
  enabled: boolean;
  tasks: Array<{
    name: string;
    cronExpression: string;
    running: boolean;
  }>;
  lastEnforcementRun?: string;
  lastReportRun?: string;
  nextEnforcementRun?: string;
  nextReportRun?: string;
}

// =============================================================================
// RETENTION SCHEDULER
// =============================================================================

/**
 * Scheduler for retention policy enforcement
 */
export class RetentionScheduler {
  private config: RetentionSchedulerConfig;
  private enforcer: RetentionEnforcer;
  private leaderElection: LeaderElection | null = null;
  private scheduledTasks: ScheduledTask[] = [];
  private lastEnforcementRun?: string;
  private lastReportRun?: string;
  private started = false;

  constructor(
    config: Partial<RetentionSchedulerConfig> = {},
    enforcer?: RetentionEnforcer
  ) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.enforcer = enforcer ?? getRetentionEnforcer();
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Retention scheduler already started');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Retention scheduler is disabled');
      return;
    }

    // Initialize leader election
    this.leaderElection = getLeaderElection();

    // Create tasks (but don't start them yet)
    this.createScheduledTasks();

    // Try to become leader
    const isLeader = await this.leaderElection.tryBecomeLeader();

    if (isLeader) {
      logger.info(
        { instanceId: this.leaderElection.getInstanceId() },
        'This instance is the retention scheduler leader'
      );

      // Start heartbeat to maintain leadership
      this.leaderElection.startHeartbeat();

      // Start cron jobs
      this.startTasks();

      logger.info({ taskCount: this.scheduledTasks.length }, 'Retention scheduler started as leader');
    } else {
      logger.info(
        { instanceId: this.leaderElection.getInstanceId() },
        'Another instance is the retention scheduler leader, waiting for leadership'
      );

      // Start periodic leader check
      this.leaderElection.startLeaderCheck(() => {
        logger.info(
          { instanceId: this.leaderElection?.getInstanceId() },
          'Acquired retention scheduler leadership, starting tasks'
        );
        this.startTasks();
      });

      logger.info('Retention scheduler started in standby mode');
    }

    this.started = true;
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // Stop all tasks
    this.stopTasks();

    // Resign leadership
    if (this.leaderElection) {
      await this.leaderElection.resign();
      this.leaderElection = null;
    }

    this.scheduledTasks = [];
    this.started = false;

    logger.info('Retention scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus(): RetentionSchedulerStatus {
    return {
      isLeader: this.leaderElection?.isLeader() ?? false,
      instanceId: this.leaderElection?.getInstanceId() ?? null,
      enabled: this.config.enabled,
      tasks: this.scheduledTasks.map((t) => ({
        name: t.name,
        cronExpression: t.cronExpression,
        running: this.leaderElection?.isLeader() ?? false,
      })),
      lastEnforcementRun: this.lastEnforcementRun,
      lastReportRun: this.lastReportRun,
      nextEnforcementRun: this.getNextRunTime(this.config.enforcementCron),
      nextReportRun: this.getNextRunTime(this.config.reportCron),
    };
  }

  /**
   * Run enforcement immediately (for manual trigger or testing)
   */
  async runEnforcementNow(options?: EnforcementOptions): Promise<RetentionReport> {
    logger.info({ dryRun: options?.dryRun }, 'Running retention enforcement on demand');

    const report = await this.enforcer.enforceRetention({
      batchSize: this.config.batchSize,
      ...options,
    });

    this.lastEnforcementRun = new Date().toISOString();

    // Handle failures
    if (!report.success && this.config.onEnforcementFailure) {
      try {
        await this.config.onEnforcementFailure(report, report.criticalErrors);
      } catch (error) {
        logger.error({ error }, 'Failed to send enforcement failure alert');
      }
    }

    // Notify on report generation
    if (this.config.onReportGenerated) {
      try {
        await this.config.onReportGenerated(report);
      } catch (error) {
        logger.error({ error }, 'Failed to send report notification');
      }
    }

    return report;
  }

  /**
   * Generate compliance report immediately (for manual trigger or testing)
   */
  async generateComplianceReportNow(): Promise<RetentionComplianceStatus> {
    logger.info('Generating compliance status report on demand');

    const status = await this.enforcer.getComplianceStatus();

    this.lastReportRun = new Date().toISOString();

    // Check for compliance issues
    if (!status.compliant && this.config.onComplianceIssue) {
      try {
        await this.config.onComplianceIssue(status);
      } catch (error) {
        logger.error({ error }, 'Failed to send compliance issue alert');
      }
    }

    return status;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Create scheduled tasks
   */
  private createScheduledTasks(): void {
    this.scheduledTasks = [];

    // Daily enforcement task
    const enforcementTask = cron.createTask(this.config.enforcementCron, async () => {
      if (!this.leaderElection?.isLeader()) {
        logger.debug('Skipping retention enforcement - not leader');
        return;
      }

      logger.info('Starting scheduled retention enforcement');
      const startTime = Date.now();

      const maxRetries = 3;
      const baseDelayMs = 1000;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const report = await this.enforcer.enforceRetention({
            batchSize: this.config.batchSize,
          });

          this.lastEnforcementRun = new Date().toISOString();
          const durationMs = Date.now() - startTime;

          logger.info(
            {
              totalDeleted: report.summary.totalRecordsDeleted,
              totalAnonymized: report.summary.totalRecordsAnonymized,
              totalSkipped: report.summary.totalRecordsSkipped,
              durationMs,
              success: report.success,
              attempt,
            },
            'Scheduled retention enforcement completed'
          );

          // Handle failures
          if (!report.success && this.config.onEnforcementFailure) {
            await this.config.onEnforcementFailure(report, report.criticalErrors);
          }

          // Notify on report generation
          if (this.config.onReportGenerated) {
            await this.config.onReportGenerated(report);
          }

          return;
        } catch (error) {
          lastError = error;

          if (attempt < maxRetries) {
            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            logger.warn(
              {
                error: error instanceof Error ? error.message : 'Unknown error',
                attempt,
                maxRetries,
                nextRetryDelayMs: delayMs,
              },
              'Retention enforcement failed, retrying'
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      // All retries exhausted
      logger.error(
        {
          error: lastError instanceof Error ? lastError.message : 'Unknown error',
          attempts: maxRetries,
        },
        'Retention enforcement failed after all retries'
      );

      // Send failure alert
      if (this.config.onEnforcementFailure) {
        const errorReport: RetentionReport = {
          reportId: 'error',
          generatedAt: new Date().toISOString(),
          enforcementStartedAt: new Date(startTime).toISOString(),
          enforcementCompletedAt: new Date().toISOString(),
          totalDurationMs: Date.now() - startTime,
          policyConfig: this.enforcer.getPolicyConfig(),
          results: {
            intents: { category: 'intents', recordsDeleted: 0, recordsAnonymized: 0, recordsSkipped: 0, errors: [], durationMs: 0 },
            auditLogs: { category: 'auditLogs', recordsDeleted: 0, recordsAnonymized: 0, recordsSkipped: 0, errors: [], durationMs: 0 },
            proofs: { category: 'proofs', recordsDeleted: 0, recordsAnonymized: 0, recordsSkipped: 0, errors: [], durationMs: 0 },
            sessions: { category: 'sessions', recordsDeleted: 0, recordsAnonymized: 0, recordsSkipped: 0, errors: [], durationMs: 0 },
            apiKeyLogs: { category: 'apiKeyLogs', recordsDeleted: 0, recordsAnonymized: 0, recordsSkipped: 0, errors: [], durationMs: 0 },
          },
          summary: {
            totalRecordsProcessed: 0,
            totalRecordsDeleted: 0,
            totalRecordsAnonymized: 0,
            totalRecordsSkipped: 0,
            totalErrors: 1,
          },
          activeLitigationHolds: 0,
          success: false,
          criticalErrors: [lastError instanceof Error ? lastError.message : 'Unknown error'],
        };

        try {
          await this.config.onEnforcementFailure(errorReport, errorReport.criticalErrors);
        } catch (alertError) {
          logger.error({ error: alertError }, 'Failed to send enforcement failure alert');
        }
      }
    });

    this.scheduledTasks.push({
      name: 'retention-enforcement',
      task: enforcementTask,
      cronExpression: this.config.enforcementCron,
    });

    // Weekly compliance report task
    const reportTask = cron.createTask(this.config.reportCron, async () => {
      if (!this.leaderElection?.isLeader()) {
        logger.debug('Skipping compliance report - not leader');
        return;
      }

      logger.info('Generating scheduled compliance report');

      try {
        const status = await this.enforcer.getComplianceStatus();
        this.lastReportRun = new Date().toISOString();

        logger.info(
          {
            compliant: status.compliant,
            overdueCategories: status.overdueCategories.length,
            activeLitigationHolds: status.activeLitigationHolds.length,
          },
          'Scheduled compliance report generated'
        );

        // Check for compliance issues
        if (!status.compliant && this.config.onComplianceIssue) {
          await this.config.onComplianceIssue(status);
        }
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to generate compliance report'
        );
      }
    });

    this.scheduledTasks.push({
      name: 'compliance-report',
      task: reportTask,
      cronExpression: this.config.reportCron,
    });
  }

  /**
   * Start all tasks
   */
  private startTasks(): void {
    for (const scheduledTask of this.scheduledTasks) {
      scheduledTask.task.start();
      logger.info(
        { name: scheduledTask.name, cron: scheduledTask.cronExpression },
        'Retention task started'
      );
    }
  }

  /**
   * Stop all tasks
   */
  private stopTasks(): void {
    for (const scheduledTask of this.scheduledTasks) {
      scheduledTask.task.stop();
      logger.info({ name: scheduledTask.name }, 'Retention task stopped');
    }
  }

  /**
   * Get the next run time for a cron expression
   */
  private getNextRunTime(cronExpression: string): string | undefined {
    try {
      // Simple calculation - node-cron doesn't expose next run time directly
      // This is an approximation based on cron expression parsing
      const now = new Date();
      const parts = cronExpression.split(' ');

      if (parts.length >= 5) {
        const minute = parseInt(parts[0], 10);
        const hour = parseInt(parts[1], 10);

        const next = new Date(now);
        next.setMinutes(minute);
        next.setHours(hour);
        next.setSeconds(0);
        next.setMilliseconds(0);

        // If the time has passed today, move to tomorrow
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }

        return next.toISOString();
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

let schedulerInstance: RetentionScheduler | null = null;

/**
 * Get or create the retention scheduler singleton
 */
export function getRetentionScheduler(
  config?: Partial<RetentionSchedulerConfig>,
  enforcer?: RetentionEnforcer
): RetentionScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new RetentionScheduler(config, enforcer);
  }
  return schedulerInstance;
}

/**
 * Create a new retention scheduler instance
 */
export function createRetentionScheduler(
  config?: Partial<RetentionSchedulerConfig>,
  enforcer?: RetentionEnforcer
): RetentionScheduler {
  return new RetentionScheduler(config, enforcer);
}

/**
 * Reset the retention scheduler singleton (for testing)
 */
export function resetRetentionScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}

/**
 * Start the global retention scheduler
 */
export async function startRetentionScheduler(
  config?: Partial<RetentionSchedulerConfig>
): Promise<void> {
  const scheduler = getRetentionScheduler(config);
  await scheduler.start();
}

/**
 * Stop the global retention scheduler
 */
export async function stopRetentionScheduler(): Promise<void> {
  if (schedulerInstance) {
    await schedulerInstance.stop();
  }
}
