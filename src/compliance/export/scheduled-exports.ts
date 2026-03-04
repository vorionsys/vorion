/**
 * Scheduled Exports
 *
 * Manages automatic scheduled exports of compliance evidence.
 * Supports weekly and monthly schedules with S3 or email delivery.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type { ID, Timestamp } from '../../common/types.js';
import { EvidenceCollector } from './evidence-collector.js';
import { HashVerifier } from './hash-verifier.js';
import { ReportGenerator, type ExportFormat } from './report-generator.js';

const logger = createLogger({ component: 'scheduled-exports' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Export schedule frequency
 */
export type ExportFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * Day of week for weekly schedules
 */
export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

/**
 * S3 destination configuration
 */
export interface S3Destination {
  type: 's3';
  bucket: string;
  region: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  roleArn?: string;
  kmsKeyId?: string;
}

/**
 * Email destination configuration
 */
export interface EmailDestination {
  type: 'email';
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  includeReport?: boolean;
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

/**
 * Webhook destination configuration
 */
export interface WebhookDestination {
  type: 'webhook';
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  includeReport?: boolean;
  timeout?: number;
}

/**
 * Export destination
 */
export type ExportDestination = S3Destination | EmailDestination | WebhookDestination;

/**
 * Export schedule configuration
 */
export interface ExportSchedule {
  /** Unique schedule ID */
  id: string;
  /** Tenant ID */
  tenantId: ID;
  /** Schedule name */
  name: string;
  /** Description */
  description?: string;
  /** Whether schedule is enabled */
  enabled: boolean;
  /** Export frequency */
  frequency: ExportFrequency;
  /** Day of week for weekly exports (0 = Sunday) */
  dayOfWeek?: DayOfWeek;
  /** Day of month for monthly exports (1-28) */
  dayOfMonth?: number;
  /** Hour of day to run (0-23, UTC) */
  hourUtc: number;
  /** Minute of hour (0-59) */
  minuteUtc: number;
  /** Export format */
  format: ExportFormat;
  /** Include raw payloads */
  includePayloads: boolean;
  /** Include tamper evidence */
  includeTamperEvidence: boolean;
  /** Event types to include */
  eventTypes?: string[];
  /** Export destinations */
  destinations: ExportDestination[];
  /** Created timestamp */
  createdAt: Timestamp;
  /** Updated timestamp */
  updatedAt: Timestamp;
  /** Last run timestamp */
  lastRunAt?: Timestamp;
  /** Next scheduled run */
  nextRunAt: Timestamp;
}

/**
 * Scheduled export job record
 */
export interface ScheduledExportJob {
  /** Job ID */
  id: string;
  /** Schedule ID */
  scheduleId: string;
  /** Tenant ID */
  tenantId: ID;
  /** Job status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Start time */
  startedAt?: Timestamp;
  /** End time */
  completedAt?: Timestamp;
  /** Report period start */
  periodStart: Timestamp;
  /** Report period end */
  periodEnd: Timestamp;
  /** Delivery results */
  deliveryResults: ExportDeliveryResult[];
  /** Error message if failed */
  error?: string;
}

/**
 * Result of delivering export to a destination
 */
export interface ExportDeliveryResult {
  /** Destination type */
  destinationType: 's3' | 'email' | 'webhook';
  /** Destination identifier */
  destinationId: string;
  /** Success status */
  success: boolean;
  /** Delivery timestamp */
  deliveredAt?: Timestamp;
  /** Error message if failed */
  error?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Configuration for scheduled export manager
 */
export interface ScheduledExportConfig {
  /** Check interval for scheduled jobs (ms) */
  checkIntervalMs?: number;
  /** Max concurrent exports */
  maxConcurrentExports?: number;
  /** Retry attempts for failed deliveries */
  retryAttempts?: number;
  /** Retry delay (ms) */
  retryDelayMs?: number;
}

// =============================================================================
// SCHEDULED EXPORT MANAGER
// =============================================================================

/**
 * Manages scheduled compliance evidence exports
 */
export class ScheduledExportManager {
  private config: Required<ScheduledExportConfig>;
  private schedules: Map<string, ExportSchedule> = new Map();
  private jobs: Map<string, ScheduledExportJob> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private activeExports: number = 0;

  private evidenceCollector: EvidenceCollector;
  private hashVerifier: HashVerifier;
  private reportGenerator: ReportGenerator;

  constructor(config: ScheduledExportConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60000, // 1 minute
      maxConcurrentExports: config.maxConcurrentExports ?? 5,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelayMs: config.retryDelayMs ?? 5000,
    };

    this.evidenceCollector = new EvidenceCollector();
    this.hashVerifier = new HashVerifier();
    this.reportGenerator = new ReportGenerator();

    logger.info('Scheduled export manager initialized');
  }

  // ===========================================================================
  // SCHEDULE MANAGEMENT
  // ===========================================================================

  /**
   * Create a new export schedule
   */
  createSchedule(
    tenantId: ID,
    config: Omit<ExportSchedule, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt'>
  ): ExportSchedule {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const schedule: ExportSchedule = {
      ...config,
      id,
      tenantId,
      createdAt: now,
      updatedAt: now,
      nextRunAt: this.calculateNextRun(config),
    };

    this.schedules.set(id, schedule);

    logger.info(
      {
        scheduleId: id,
        tenantId,
        frequency: config.frequency,
        nextRunAt: schedule.nextRunAt,
      },
      'Export schedule created'
    );

    return schedule;
  }

  /**
   * Update an export schedule
   */
  updateSchedule(
    scheduleId: string,
    updates: Partial<Omit<ExportSchedule, 'id' | 'tenantId' | 'createdAt'>>
  ): ExportSchedule | undefined {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return undefined;

    const updated: ExportSchedule = {
      ...schedule,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Recalculate next run if schedule timing changed
    if (
      updates.frequency !== undefined ||
      updates.dayOfWeek !== undefined ||
      updates.dayOfMonth !== undefined ||
      updates.hourUtc !== undefined ||
      updates.minuteUtc !== undefined
    ) {
      updated.nextRunAt = this.calculateNextRun(updated);
    }

    this.schedules.set(scheduleId, updated);

    logger.info(
      { scheduleId, nextRunAt: updated.nextRunAt },
      'Export schedule updated'
    );

    return updated;
  }

  /**
   * Delete an export schedule
   */
  deleteSchedule(scheduleId: string): boolean {
    const deleted = this.schedules.delete(scheduleId);
    if (deleted) {
      logger.info({ scheduleId }, 'Export schedule deleted');
    }
    return deleted;
  }

  /**
   * Get a schedule by ID
   */
  getSchedule(scheduleId: string): ExportSchedule | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * List schedules for a tenant
   */
  listSchedules(tenantId: ID): ExportSchedule[] {
    return Array.from(this.schedules.values())
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Calculate the next run time for a schedule
   */
  private calculateNextRun(
    schedule: Pick<ExportSchedule, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'hourUtc' | 'minuteUtc'>
  ): Timestamp {
    const now = new Date();
    let nextRun = new Date();

    // Set the time
    nextRun.setUTCHours(schedule.hourUtc, schedule.minuteUtc, 0, 0);

    switch (schedule.frequency) {
      case 'daily':
        // If today's time has passed, schedule for tomorrow
        if (nextRun <= now) {
          nextRun.setDate(nextRun.getDate() + 1);
        }
        break;

      case 'weekly': {
        const dayMap: Record<DayOfWeek, number> = {
          sunday: 0,
          monday: 1,
          tuesday: 2,
          wednesday: 3,
          thursday: 4,
          friday: 5,
          saturday: 6,
        };
        const targetDay = dayMap[schedule.dayOfWeek ?? 'monday'];
        const currentDay = nextRun.getUTCDay();

        let daysUntilTarget = targetDay - currentDay;
        if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextRun <= now)) {
          daysUntilTarget += 7;
        }

        nextRun.setDate(nextRun.getDate() + daysUntilTarget);
        break;
      }

      case 'monthly': {
        const targetDay = Math.min(schedule.dayOfMonth ?? 1, 28);
        nextRun.setUTCDate(targetDay);

        // If this month's date has passed, move to next month
        if (nextRun <= now) {
          nextRun.setUTCMonth(nextRun.getUTCMonth() + 1);
        }
        break;
      }
    }

    return nextRun.toISOString();
  }

  // ===========================================================================
  // SCHEDULER
  // ===========================================================================

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      logger.warn('Scheduler already running');
      return;
    }

    this.running = true;
    this.checkTimer = setInterval(
      () => this.checkSchedules(),
      this.config.checkIntervalMs
    );

    logger.info(
      { checkIntervalMs: this.config.checkIntervalMs },
      'Scheduled export manager started'
    );
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    logger.info('Scheduled export manager stopped');
  }

  /**
   * Check for schedules that need to run
   */
  private async checkSchedules(): Promise<void> {
    if (this.activeExports >= this.config.maxConcurrentExports) {
      return;
    }

    const now = new Date();

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;

      const nextRun = new Date(schedule.nextRunAt);
      if (nextRun <= now) {
        if (this.activeExports >= this.config.maxConcurrentExports) {
          break;
        }

        // Run the export
        this.runScheduledExport(schedule).catch((err) => {
          logger.error(
            { scheduleId: schedule.id, error: err },
            'Scheduled export failed'
          );
        });
      }
    }
  }

  /**
   * Run a scheduled export
   */
  private async runScheduledExport(schedule: ExportSchedule): Promise<void> {
    this.activeExports++;

    const jobId = crypto.randomUUID();
    const now = new Date();

    // Calculate report period based on frequency
    const periodEnd = new Date(schedule.nextRunAt);
    let periodStart: Date;

    switch (schedule.frequency) {
      case 'daily':
        periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() - 1);
        break;
      case 'weekly':
        periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() - 7);
        break;
      case 'monthly':
        periodStart = new Date(periodEnd);
        periodStart.setMonth(periodStart.getMonth() - 1);
        break;
    }

    const job: ScheduledExportJob = {
      id: jobId,
      scheduleId: schedule.id,
      tenantId: schedule.tenantId,
      status: 'running',
      startedAt: now.toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      deliveryResults: [],
    };

    this.jobs.set(jobId, job);

    logger.info(
      {
        jobId,
        scheduleId: schedule.id,
        periodStart: job.periodStart,
        periodEnd: job.periodEnd,
      },
      'Starting scheduled export'
    );

    try {
      // Initialize collectors
      await this.evidenceCollector.initialize();

      // Collect evidence
      const collection = await this.evidenceCollector.collectEvidence({
        tenantId: schedule.tenantId,
        startDate: periodStart,
        endDate: periodEnd,
        eventTypes: schedule.eventTypes as any,
        includePayloads: schedule.includePayloads,
      });

      // Create tamper evidence if requested
      let tamperEvidence;
      if (schedule.includeTamperEvidence) {
        tamperEvidence = await this.hashVerifier.createTamperEvidentPackage(collection);
      }

      // Generate report
      const report = await this.reportGenerator.generateReport(
        collection,
        tamperEvidence,
        {
          format: schedule.format,
          includeTamperEvidence: schedule.includeTamperEvidence,
          includePayloads: schedule.includePayloads,
          title: `Scheduled Compliance Export - ${schedule.name}`,
        }
      );

      // Format report
      let formattedReport: string | Record<string, string>;
      switch (schedule.format) {
        case 'json':
          formattedReport = this.reportGenerator.formatAsJson(report);
          break;
        case 'csv':
          formattedReport = this.reportGenerator.formatAsCsv(report);
          break;
        case 'pdf':
          formattedReport = this.reportGenerator.formatAsPdfHtml(report);
          break;
      }

      // Deliver to destinations
      for (const destination of schedule.destinations) {
        const result = await this.deliverToDestination(
          destination,
          formattedReport,
          schedule,
          job
        );
        job.deliveryResults.push(result);
      }

      // Update job status
      job.status = job.deliveryResults.every((r) => r.success)
        ? 'completed'
        : 'failed';
      job.completedAt = new Date().toISOString();

      // Update schedule next run
      schedule.lastRunAt = now.toISOString();
      schedule.nextRunAt = this.calculateNextRun(schedule);
      schedule.updatedAt = new Date().toISOString();
      this.schedules.set(schedule.id, schedule);

      logger.info(
        {
          jobId,
          scheduleId: schedule.id,
          status: job.status,
          deliveries: job.deliveryResults.length,
          nextRunAt: schedule.nextRunAt,
        },
        'Scheduled export completed'
      );
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        { jobId, scheduleId: schedule.id, error },
        'Scheduled export failed'
      );

      // Still update next run time to avoid infinite retry
      schedule.nextRunAt = this.calculateNextRun(schedule);
      schedule.updatedAt = new Date().toISOString();
      this.schedules.set(schedule.id, schedule);
    } finally {
      this.jobs.set(jobId, job);
      this.activeExports--;
    }
  }

  /**
   * Deliver report to a destination
   */
  private async deliverToDestination(
    destination: ExportDestination,
    report: string | Record<string, string>,
    schedule: ExportSchedule,
    job: ScheduledExportJob
  ): Promise<ExportDeliveryResult> {
    const destinationId = destination.type === 's3'
      ? destination.bucket
      : destination.type === 'email'
        ? destination.recipients[0] ?? 'unknown'
        : destination.url;

    try {
      switch (destination.type) {
        case 's3':
          return await this.deliverToS3(destination, report, schedule, job);
        case 'email':
          return await this.deliverToEmail(destination, report, schedule, job);
        case 'webhook':
          return await this.deliverToWebhook(destination, report, schedule, job);
        default:
          throw new Error(`Unsupported destination type: ${(destination as any).type}`);
      }
    } catch (error) {
      return {
        destinationType: destination.type,
        destinationId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Deliver to S3 bucket
   */
  private async deliverToS3(
    destination: S3Destination,
    report: string | Record<string, string>,
    schedule: ExportSchedule,
    job: ScheduledExportJob
  ): Promise<ExportDeliveryResult> {
    // In a real implementation, this would use the AWS SDK
    // For now, we'll simulate the upload

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = destination.prefix ?? 'compliance-exports';
    const extension = schedule.format === 'csv' ? 'zip' : schedule.format;
    const key = `${prefix}/${schedule.tenantId}/${timestamp}-${schedule.name}.${extension}`;

    logger.info(
      {
        bucket: destination.bucket,
        key,
        region: destination.region,
      },
      'Uploading to S3 (simulated)'
    );

    // Simulate S3 upload
    // In production, this would be:
    // const s3Client = new S3Client({ region: destination.region });
    // await s3Client.send(new PutObjectCommand({
    //   Bucket: destination.bucket,
    //   Key: key,
    //   Body: typeof report === 'string' ? report : JSON.stringify(report),
    //   ContentType: schedule.format === 'json' ? 'application/json' : 'text/html',
    //   ...(destination.kmsKeyId && { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: destination.kmsKeyId }),
    // }));

    return {
      destinationType: 's3',
      destinationId: destination.bucket,
      success: true,
      deliveredAt: new Date().toISOString(),
      details: {
        bucket: destination.bucket,
        key,
        region: destination.region,
      },
    };
  }

  /**
   * Deliver via email
   */
  private async deliverToEmail(
    destination: EmailDestination,
    report: string | Record<string, string>,
    schedule: ExportSchedule,
    job: ScheduledExportJob
  ): Promise<ExportDeliveryResult> {
    // In a real implementation, this would use nodemailer or a mail service
    // For now, we'll simulate the email send

    const subject = destination.subject ??
      `Compliance Export: ${schedule.name} - ${new Date(job.periodEnd).toISOString().split('T')[0]}`;

    logger.info(
      {
        recipients: destination.recipients,
        subject,
        includeReport: destination.includeReport,
      },
      'Sending email (simulated)'
    );

    // Simulate email send
    // In production, this would be:
    // const transporter = nodemailer.createTransport(destination.smtpConfig);
    // await transporter.sendMail({
    //   to: destination.recipients.join(', '),
    //   cc: destination.cc?.join(', '),
    //   bcc: destination.bcc?.join(', '),
    //   subject,
    //   text: `Compliance evidence export for period ${job.periodStart} to ${job.periodEnd}`,
    //   attachments: destination.includeReport ? [{
    //     filename: `compliance-export.${schedule.format}`,
    //     content: typeof report === 'string' ? report : JSON.stringify(report),
    //   }] : undefined,
    // });

    return {
      destinationType: 'email',
      destinationId: destination.recipients[0] ?? 'unknown',
      success: true,
      deliveredAt: new Date().toISOString(),
      details: {
        recipients: destination.recipients,
        subject,
      },
    };
  }

  /**
   * Deliver via webhook
   */
  private async deliverToWebhook(
    destination: WebhookDestination,
    report: string | Record<string, string>,
    schedule: ExportSchedule,
    job: ScheduledExportJob
  ): Promise<ExportDeliveryResult> {
    const method = destination.method ?? 'POST';
    const timeout = destination.timeout ?? 30000;

    logger.info(
      {
        url: destination.url,
        method,
        includeReport: destination.includeReport,
      },
      'Calling webhook'
    );

    try {
      const body = {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        tenantId: schedule.tenantId,
        jobId: job.id,
        periodStart: job.periodStart,
        periodEnd: job.periodEnd,
        format: schedule.format,
        ...(destination.includeReport && {
          report: typeof report === 'string' ? report : report,
        }),
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(destination.url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...destination.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      return {
        destinationType: 'webhook',
        destinationId: destination.url,
        success: true,
        deliveredAt: new Date().toISOString(),
        details: {
          url: destination.url,
          method,
          status: response.status,
        },
      };
    } catch (error) {
      throw new Error(
        `Webhook delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ===========================================================================
  // JOB MANAGEMENT
  // ===========================================================================

  /**
   * Get a job by ID
   */
  getJob(jobId: string): ScheduledExportJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List jobs for a schedule
   */
  listJobsForSchedule(scheduleId: string): ScheduledExportJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => j.scheduleId === scheduleId)
      .sort((a, b) => {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      });
  }

  /**
   * Manually trigger a scheduled export
   */
  async triggerExport(scheduleId: string): Promise<ScheduledExportJob | undefined> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return undefined;

    // Run immediately
    await this.runScheduledExport(schedule);

    // Return the latest job for this schedule
    const jobs = this.listJobsForSchedule(scheduleId);
    return jobs[0];
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let scheduledExportManagerInstance: ScheduledExportManager | null = null;

/**
 * Get the singleton scheduled export manager instance
 */
export function getScheduledExportManager(
  config?: ScheduledExportConfig
): ScheduledExportManager {
  if (!scheduledExportManagerInstance) {
    scheduledExportManagerInstance = new ScheduledExportManager(config);
  }
  return scheduledExportManagerInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetScheduledExportManager(): void {
  if (scheduledExportManagerInstance) {
    scheduledExportManagerInstance.stop();
  }
  scheduledExportManagerInstance = null;
}
