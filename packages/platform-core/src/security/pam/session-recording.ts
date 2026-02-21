/**
 * Session Recording System for Privileged Access Audit Trails
 *
 * Provides comprehensive recording of privileged access sessions with:
 * - Tamper-evident hash chain for integrity
 * - Privacy controls (masking, PII hashing)
 * - Buffered storage with Redis and database persistence
 * - Compliance-ready export capabilities
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { VorionError, NotFoundError, ForbiddenError } from '../../common/errors.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import { redact, type RedactionConfig } from '../../common/redaction.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const logger = createLogger({ component: 'session-recording' });

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_BUFFER_SIZE = 100;
const HASH_ALGORITHM = 'sha256';

// =============================================================================
// Metrics
// =============================================================================

const recordingsTotal = new Counter({
  name: 'vorion_pam_recordings_total',
  help: 'Total session recordings',
  labelNames: ['status'] as const,
  registers: [vorionRegistry],
});

const eventsRecorded = new Counter({
  name: 'vorion_pam_events_recorded_total',
  help: 'Total events recorded in sessions',
  labelNames: ['event_type'] as const,
  registers: [vorionRegistry],
});

const recordingDuration = new Histogram({
  name: 'vorion_pam_recording_duration_seconds',
  help: 'Duration of session recordings',
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400],
  registers: [vorionRegistry],
});

const activeRecordings = new Gauge({
  name: 'vorion_pam_active_recordings',
  help: 'Number of currently active recordings',
  registers: [vorionRegistry],
});

const eventBufferSize = new Gauge({
  name: 'vorion_pam_event_buffer_size',
  help: 'Current size of event buffer',
  registers: [vorionRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Session event types that can be recorded
 */
export const SessionEventType = {
  API_CALL: 'api_call',
  DATA_ACCESS: 'data_access',
  PERMISSION_USAGE: 'permission_usage',
  CONFIG_CHANGE: 'config_change',
  AUTH_EVENT: 'auth_event',
  ERROR: 'error',
  CUSTOM: 'custom',
} as const;

export type SessionEventType = (typeof SessionEventType)[keyof typeof SessionEventType];

export const sessionEventTypeSchema = z.nativeEnum(SessionEventType);

/**
 * API call event details
 */
export interface ApiCallEvent {
  type: 'api_call';
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestId?: string;
  query?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
  headers?: Record<string, string>;
}

/**
 * Data access event details
 */
export interface DataAccessEvent {
  type: 'data_access';
  operation: 'read' | 'write' | 'delete' | 'list';
  resourceType: string;
  resourceId?: string;
  resourceIds?: string[];
  query?: Record<string, unknown>;
  recordCount?: number;
  dataClassification?: string;
}

/**
 * Permission usage event details
 */
export interface PermissionUsageEvent {
  type: 'permission_usage';
  permission: string;
  action: string;
  resource?: string;
  granted: boolean;
  reason?: string;
  elevatedFrom?: string;
}

/**
 * Configuration change event details
 */
export interface ConfigChangeEvent {
  type: 'config_change';
  configType: string;
  configId?: string;
  changes: {
    field: string;
    oldValue?: unknown;
    newValue?: unknown;
  }[];
  reason?: string;
}

/**
 * Authentication event details
 */
export interface AuthEventDetails {
  type: 'auth_event';
  action: 'login' | 'logout' | 'token_refresh' | 'mfa_verify' | 'session_extend' | 'impersonate';
  success: boolean;
  method?: string;
  targetUserId?: string;
  reason?: string;
}

/**
 * Error event details
 */
export interface ErrorEvent {
  type: 'error';
  errorCode: string;
  errorMessage: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity: 'warning' | 'error' | 'critical';
}

/**
 * Custom event details
 */
export interface CustomEvent {
  type: 'custom';
  eventName: string;
  data: Record<string, unknown>;
}

/**
 * Union type for all event details
 */
export type SessionEventDetails =
  | ApiCallEvent
  | DataAccessEvent
  | PermissionUsageEvent
  | ConfigChangeEvent
  | AuthEventDetails
  | ErrorEvent
  | CustomEvent;

/**
 * Session event structure
 */
export interface SessionEvent {
  id: string;
  recordingId: string;
  timestamp: string;
  sequenceNumber: number;
  eventType: SessionEventType;
  details: SessionEventDetails;
  previousHash: string | null;
  eventHash: string;
}

export const sessionEventSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  timestamp: z.string().datetime(),
  sequenceNumber: z.number().int().nonnegative(),
  eventType: sessionEventTypeSchema,
  details: z.record(z.unknown()),
  previousHash: z.string().nullable(),
  eventHash: z.string(),
});

/**
 * Recording metadata
 */
export interface RecordingMetadata {
  /** Reason for elevated access */
  reason: string;
  /** Associated ticket/request ID */
  ticketId?: string;
  /** List of approvers who authorized access */
  approvers?: string[];
  /** Business justification */
  justification?: string;
  /** Target resources being accessed */
  targetResources?: string[];
  /** Expected duration in minutes */
  expectedDurationMinutes?: number;
  /** Risk level assessment */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /** Additional custom metadata */
  custom?: Record<string, unknown>;
}

export const recordingMetadataSchema = z.object({
  reason: z.string().min(1),
  ticketId: z.string().optional(),
  approvers: z.array(z.string()).optional(),
  justification: z.string().optional(),
  targetResources: z.array(z.string()).optional(),
  expectedDurationMinutes: z.number().int().positive().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  custom: z.record(z.unknown()).optional(),
});

/**
 * Recording summary statistics
 */
export interface RecordingSummary {
  totalEvents: number;
  eventsByType: Record<SessionEventType, number>;
  dataAccessed: {
    resourceTypes: string[];
    totalRecords: number;
    operations: Record<string, number>;
  };
  permissionsUsed: {
    permissions: string[];
    denied: number;
    granted: number;
  };
  errors: {
    count: number;
    bySeverity: Record<string, number>;
  };
  apiCalls: {
    count: number;
    avgDurationMs: number;
    statusCodes: Record<string, number>;
  };
  durationSeconds: number;
  integrityValid: boolean;
}

export const recordingSummarySchema = z.object({
  totalEvents: z.number().int().nonnegative(),
  eventsByType: z.record(z.number()),
  dataAccessed: z.object({
    resourceTypes: z.array(z.string()),
    totalRecords: z.number().int().nonnegative(),
    operations: z.record(z.number()),
  }),
  permissionsUsed: z.object({
    permissions: z.array(z.string()),
    denied: z.number().int().nonnegative(),
    granted: z.number().int().nonnegative(),
  }),
  errors: z.object({
    count: z.number().int().nonnegative(),
    bySeverity: z.record(z.number()),
  }),
  apiCalls: z.object({
    count: z.number().int().nonnegative(),
    avgDurationMs: z.number().nonnegative(),
    statusCodes: z.record(z.number()),
  }),
  durationSeconds: z.number().nonnegative(),
  integrityValid: z.boolean(),
});

/**
 * Recording status
 */
export const RecordingStatus = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ARCHIVED: 'archived',
} as const;

export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

export const recordingStatusSchema = z.nativeEnum(RecordingStatus);

/**
 * Complete recording structure
 */
export interface Recording {
  id: string;
  sessionId: string;
  userId: string;
  tenantId?: string;
  status: RecordingStatus;
  startedAt: string;
  endedAt?: string;
  events: SessionEvent[];
  metadata: RecordingMetadata;
  summary?: RecordingSummary;
  retentionUntil: string;
  recordingHash: string;
  createdBy: string;
  deletionApprovedBy?: string;
  deletionApprovedAt?: string;
}

export const recordingSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string(),
  userId: z.string(),
  tenantId: z.string().optional(),
  status: recordingStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  events: z.array(sessionEventSchema),
  metadata: recordingMetadataSchema,
  summary: recordingSummarySchema.optional(),
  retentionUntil: z.string().datetime(),
  recordingHash: z.string(),
  createdBy: z.string(),
  deletionApprovedBy: z.string().optional(),
  deletionApprovedAt: z.string().datetime().optional(),
});

/**
 * Recording filter for search
 */
export interface RecordingFilter {
  userId?: string;
  sessionId?: string;
  tenantId?: string;
  status?: RecordingStatus;
  startedAfter?: string;
  startedBefore?: string;
  ticketId?: string;
  riskLevel?: string;
  hasErrors?: boolean;
  permissionUsed?: string;
  resourceAccessed?: string;
  limit?: number;
  offset?: number;
}

export const recordingFilterSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  tenantId: z.string().optional(),
  status: recordingStatusSchema.optional(),
  startedAfter: z.string().datetime().optional(),
  startedBefore: z.string().datetime().optional(),
  ticketId: z.string().optional(),
  riskLevel: z.string().optional(),
  hasErrors: z.boolean().optional(),
  permissionUsed: z.string().optional(),
  resourceAccessed: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

// =============================================================================
// Errors
// =============================================================================

/**
 * Session recording error
 */
export class SessionRecordingError extends VorionError {
  override code = 'SESSION_RECORDING_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'SessionRecordingError';
  }
}

/**
 * Recording not found error
 */
export class RecordingNotFoundError extends NotFoundError {
  override code = 'RECORDING_NOT_FOUND';

  constructor(recordingId: string) {
    super(`Recording not found: ${recordingId}`, { recordingId });
    this.name = 'RecordingNotFoundError';
  }
}

/**
 * Recording deletion denied error
 */
export class RecordingDeletionDeniedError extends ForbiddenError {
  override code = 'RECORDING_DELETION_DENIED';

  constructor(recordingId: string, reason: string) {
    super(`Recording deletion denied: ${reason}`, { recordingId, reason });
    this.name = 'RecordingDeletionDeniedError';
  }
}

// =============================================================================
// Privacy Controls
// =============================================================================

/**
 * Privacy configuration for recordings
 */
export interface PrivacyConfig {
  /** Fields to always mask */
  maskFields: string[];
  /** Fields to exclude entirely */
  excludeFields: string[];
  /** Fields containing PII to hash */
  piiFields: string[];
  /** Custom redaction config */
  redactionConfig?: RedactionConfig;
  /** Whether to mask request bodies */
  maskRequestBodies: boolean;
  /** Whether to mask response bodies */
  maskResponseBodies: boolean;
  /** Maximum body size to record (bytes) */
  maxBodySize: number;
}

const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = {
  maskFields: [
    'password',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'sessionId',
    'refreshToken',
    'accessToken',
    'privateKey',
    'private_key',
  ],
  excludeFields: [
    'x-api-key',
    'x-auth-token',
    'set-cookie',
  ],
  piiFields: [
    'email',
    'phone',
    'ssn',
    'socialSecurityNumber',
    'dateOfBirth',
    'address',
    'creditCard',
    'bankAccount',
  ],
  maskRequestBodies: false,
  maskResponseBodies: true,
  maxBodySize: 10000,
};

/**
 * Apply privacy controls to event data
 */
function applyPrivacyControls(
  data: unknown,
  config: PrivacyConfig
): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Use redaction utility with custom config
  const redactionConfig: RedactionConfig = {
    sensitivePatterns: config.maskFields.map(
      (field) => new RegExp(field, 'i')
    ),
    replacement: '[MASKED]',
    allowedFields: [],
    ...config.redactionConfig,
  };

  let result = redact(data, redactionConfig);

  // Hash PII fields
  if (typeof result === 'object' && result !== null) {
    result = hashPiiFields(result as Record<string, unknown>, config.piiFields);
  }

  // Remove excluded fields
  if (typeof result === 'object' && result !== null) {
    result = removeExcludedFields(result as Record<string, unknown>, config.excludeFields);
  }

  return result;
}

/**
 * Hash PII fields for privacy
 */
function hashPiiFields(
  obj: Record<string, unknown>,
  piiFields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (piiFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      if (typeof value === 'string') {
        result[key] = `[PII:${createHash('sha256').update(value).digest('hex').substring(0, 8)}]`;
      } else {
        result[key] = '[PII:HASHED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? hashPiiFields(item as Record<string, unknown>, piiFields)
            : item
        );
      } else {
        result[key] = hashPiiFields(value as Record<string, unknown>, piiFields);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Remove excluded fields from object
 */
function removeExcludedFields(
  obj: Record<string, unknown>,
  excludeFields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (excludeFields.some((field) => key.toLowerCase() === field.toLowerCase())) {
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? removeExcludedFields(item as Record<string, unknown>, excludeFields)
            : item
        );
      } else {
        result[key] = removeExcludedFields(value as Record<string, unknown>, excludeFields);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Storage interface for recordings
 */
export interface RecordingStorage {
  /** Save a recording */
  save(recording: Recording): Promise<void>;
  /** Get a recording by ID */
  get(recordingId: string): Promise<Recording | null>;
  /** Update a recording */
  update(recording: Recording): Promise<void>;
  /** Search recordings */
  search(filter: RecordingFilter): Promise<{ recordings: Recording[]; total: number }>;
  /** Delete a recording (requires approval) */
  delete(recordingId: string, approvedBy: string): Promise<void>;
  /** Flush buffered events to storage */
  flushEvents(recordingId: string, events: SessionEvent[]): Promise<void>;
  /** Get events for a recording */
  getEvents(recordingId: string): Promise<SessionEvent[]>;
}

/**
 * In-memory storage implementation (for development/testing)
 */
export class InMemoryRecordingStorage implements RecordingStorage {
  private recordings = new Map<string, Recording>();
  private events = new Map<string, SessionEvent[]>();

  async save(recording: Recording): Promise<void> {
    this.recordings.set(recording.id, { ...recording });
    this.events.set(recording.id, [...recording.events]);
  }

  async get(recordingId: string): Promise<Recording | null> {
    const recording = this.recordings.get(recordingId);
    if (!recording) return null;

    const events = this.events.get(recordingId) ?? [];
    return { ...recording, events: [...events] };
  }

  async update(recording: Recording): Promise<void> {
    if (!this.recordings.has(recording.id)) {
      throw new RecordingNotFoundError(recording.id);
    }
    this.recordings.set(recording.id, { ...recording });
  }

  async search(filter: RecordingFilter): Promise<{ recordings: Recording[]; total: number }> {
    let results = Array.from(this.recordings.values());

    // Apply filters
    if (filter.userId) {
      results = results.filter((r) => r.userId === filter.userId);
    }
    if (filter.sessionId) {
      results = results.filter((r) => r.sessionId === filter.sessionId);
    }
    if (filter.tenantId) {
      results = results.filter((r) => r.tenantId === filter.tenantId);
    }
    if (filter.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter.startedAfter) {
      results = results.filter((r) => r.startedAt >= filter.startedAfter!);
    }
    if (filter.startedBefore) {
      results = results.filter((r) => r.startedAt <= filter.startedBefore!);
    }
    if (filter.ticketId) {
      results = results.filter((r) => r.metadata.ticketId === filter.ticketId);
    }
    if (filter.riskLevel) {
      results = results.filter((r) => r.metadata.riskLevel === filter.riskLevel);
    }
    if (filter.hasErrors) {
      results = results.filter((r) => {
        const errorEvents = this.events.get(r.id) ?? [];
        return errorEvents.some((e) => e.eventType === SessionEventType.ERROR);
      });
    }

    const total = results.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;

    results = results
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(offset, offset + limit);

    // Attach events to recordings
    return {
      recordings: results.map((r) => ({
        ...r,
        events: this.events.get(r.id) ?? [],
      })),
      total,
    };
  }

  async delete(recordingId: string, approvedBy: string): Promise<void> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new RecordingNotFoundError(recordingId);
    }

    // Mark as deleted with approval
    recording.deletionApprovedBy = approvedBy;
    recording.deletionApprovedAt = new Date().toISOString();
    this.recordings.delete(recordingId);
    this.events.delete(recordingId);
  }

  async flushEvents(recordingId: string, events: SessionEvent[]): Promise<void> {
    const existing = this.events.get(recordingId) ?? [];
    this.events.set(recordingId, [...existing, ...events]);
  }

  async getEvents(recordingId: string): Promise<SessionEvent[]> {
    return this.events.get(recordingId) ?? [];
  }
}

// =============================================================================
// Session Recorder
// =============================================================================

/**
 * Session recorder configuration
 */
export interface SessionRecorderConfig {
  /** Storage backend */
  storage: RecordingStorage;
  /** Privacy configuration */
  privacy?: Partial<PrivacyConfig>;
  /** Default retention period in days */
  retentionDays?: number;
  /** Event buffer flush interval in ms */
  flushIntervalMs?: number;
  /** Maximum events to buffer before force flush */
  maxBufferSize?: number;
  /** Tenant ID for multi-tenant setups */
  tenantId?: string;
}

/**
 * Session Recorder Class
 *
 * Records privileged access sessions with tamper-evident logging,
 * privacy controls, and compliance-ready exports.
 *
 * @example
 * ```typescript
 * const recorder = new SessionRecorder({
 *   storage: new InMemoryRecordingStorage(),
 *   retentionDays: 90,
 * });
 *
 * // Start recording
 * const recording = await recorder.startRecording('session-123', 'user-456', {
 *   reason: 'Production database maintenance',
 *   ticketId: 'JIRA-789',
 *   approvers: ['admin-1', 'admin-2'],
 * });
 *
 * // Record events
 * await recorder.recordEvent(recording.id, {
 *   type: 'api_call',
 *   method: 'GET',
 *   path: '/api/users',
 *   statusCode: 200,
 *   durationMs: 45,
 * });
 *
 * // Stop recording
 * const summary = await recorder.stopRecording(recording.id);
 * ```
 */
export class SessionRecorder {
  private storage: RecordingStorage;
  private privacyConfig: PrivacyConfig;
  private retentionDays: number;
  private flushIntervalMs: number;
  private maxBufferSize: number;
  private tenantId?: string;

  // Active recording state
  private activeRecordings = new Map<string, {
    recording: Recording;
    buffer: SessionEvent[];
    sequenceNumber: number;
    lastHash: string | null;
  }>();

  // Flush timer
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionRecorderConfig) {
    this.storage = config.storage;
    this.privacyConfig = { ...DEFAULT_PRIVACY_CONFIG, ...config.privacy };
    this.retentionDays = config.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferSize = config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.tenantId = config.tenantId;

    // Start flush timer
    this.startFlushTimer();

    logger.info(
      {
        retentionDays: this.retentionDays,
        flushIntervalMs: this.flushIntervalMs,
        maxBufferSize: this.maxBufferSize,
      },
      'Session recorder initialized'
    );
  }

  /**
   * Start recording a session
   */
  async startRecording(
    sessionId: string,
    userId: string,
    metadata: RecordingMetadata
  ): Promise<Recording> {
    // Validate metadata
    recordingMetadataSchema.parse(metadata);

    const now = new Date();
    const retentionUntil = new Date(now);
    retentionUntil.setDate(retentionUntil.getDate() + this.retentionDays);

    const recording: Recording = {
      id: randomUUID(),
      sessionId,
      userId,
      tenantId: this.tenantId,
      status: RecordingStatus.ACTIVE,
      startedAt: now.toISOString(),
      events: [],
      metadata,
      retentionUntil: retentionUntil.toISOString(),
      recordingHash: '',
      createdBy: userId,
    };

    // Compute initial recording hash
    recording.recordingHash = this.computeRecordingHash(recording);

    // Initialize active recording state
    this.activeRecordings.set(recording.id, {
      recording,
      buffer: [],
      sequenceNumber: 0,
      lastHash: null,
    });

    // Save to storage
    await this.storage.save(recording);

    activeRecordings.inc();
    recordingsTotal.inc({ status: 'started' });

    logger.info(
      {
        recordingId: recording.id,
        sessionId,
        userId,
        reason: metadata.reason,
        ticketId: metadata.ticketId,
      },
      'Session recording started'
    );

    return recording;
  }

  /**
   * Record an event in a session
   */
  async recordEvent(
    recordingId: string,
    eventDetails: SessionEventDetails
  ): Promise<void> {
    const state = this.activeRecordings.get(recordingId);

    if (!state) {
      // Try to load from storage if not active
      const recording = await this.storage.get(recordingId);
      if (!recording) {
        throw new RecordingNotFoundError(recordingId);
      }
      if (recording.status !== RecordingStatus.ACTIVE) {
        throw new SessionRecordingError(
          `Cannot record event: recording is ${recording.status}`,
          { recordingId, status: recording.status }
        );
      }
      throw new SessionRecordingError(
        'Recording not active in this instance',
        { recordingId }
      );
    }

    // Apply privacy controls
    const sanitizedDetails = applyPrivacyControls(
      eventDetails,
      this.privacyConfig
    ) as SessionEventDetails;

    // Create event
    const event: SessionEvent = {
      id: randomUUID(),
      recordingId,
      timestamp: new Date().toISOString(),
      sequenceNumber: state.sequenceNumber++,
      eventType: eventDetails.type as SessionEventType,
      details: sanitizedDetails,
      previousHash: state.lastHash,
      eventHash: '',
    };

    // Compute event hash (hash chain)
    event.eventHash = this.computeEventHash(event);
    state.lastHash = event.eventHash;

    // Add to buffer
    state.buffer.push(event);

    eventsRecorded.inc({ event_type: event.eventType });
    eventBufferSize.set(state.buffer.length);

    // Force flush if buffer is full
    if (state.buffer.length >= this.maxBufferSize) {
      await this.flushBuffer(recordingId);
    }
  }

  /**
   * Stop recording and finalize
   */
  async stopRecording(recordingId: string): Promise<RecordingSummary> {
    const state = this.activeRecordings.get(recordingId);

    if (!state) {
      throw new RecordingNotFoundError(recordingId);
    }

    // Flush any remaining events
    if (state.buffer.length > 0) {
      await this.flushBuffer(recordingId);
    }

    // Get all events from storage
    const events = await this.storage.getEvents(recordingId);

    // Compute summary
    const summary = this.computeSummary(events, state.recording.startedAt);

    // Update recording
    state.recording.status = RecordingStatus.COMPLETED;
    state.recording.endedAt = new Date().toISOString();
    state.recording.summary = summary;
    state.recording.events = events;
    state.recording.recordingHash = this.computeRecordingHash(state.recording);

    // Save final state
    await this.storage.update(state.recording);

    // Remove from active recordings
    this.activeRecordings.delete(recordingId);

    activeRecordings.dec();
    recordingsTotal.inc({ status: 'completed' });

    const durationSeconds = summary.durationSeconds;
    recordingDuration.observe(durationSeconds);

    logger.info(
      {
        recordingId,
        sessionId: state.recording.sessionId,
        userId: state.recording.userId,
        totalEvents: summary.totalEvents,
        durationSeconds,
        hasErrors: summary.errors.count > 0,
      },
      'Session recording stopped'
    );

    return summary;
  }

  /**
   * Get a recording by ID
   */
  async getRecording(recordingId: string): Promise<Recording> {
    // Check active recordings first
    const state = this.activeRecordings.get(recordingId);
    if (state) {
      const events = await this.storage.getEvents(recordingId);
      return {
        ...state.recording,
        events: [...events, ...state.buffer],
      };
    }

    // Load from storage
    const recording = await this.storage.get(recordingId);
    if (!recording) {
      throw new RecordingNotFoundError(recordingId);
    }

    return recording;
  }

  /**
   * Search recordings
   */
  async searchRecordings(filter: RecordingFilter): Promise<Recording[]> {
    recordingFilterSchema.parse(filter);

    const { recordings } = await this.storage.search(filter);
    return recordings;
  }

  /**
   * Export recording for audit
   */
  async exportRecording(
    recordingId: string,
    format: 'json' | 'csv'
  ): Promise<string> {
    const recording = await this.getRecording(recordingId);

    if (format === 'json') {
      return JSON.stringify(recording, null, 2);
    }

    // CSV format
    const lines: string[] = [];

    // Header
    lines.push(
      'Recording ID,Session ID,User ID,Started At,Ended At,Status,Reason,Ticket ID'
    );
    lines.push(
      [
        recording.id,
        recording.sessionId,
        recording.userId,
        recording.startedAt,
        recording.endedAt ?? '',
        recording.status,
        `"${recording.metadata.reason.replace(/"/g, '""')}"`,
        recording.metadata.ticketId ?? '',
      ].join(',')
    );

    lines.push('');
    lines.push('Events:');
    lines.push(
      'Event ID,Timestamp,Sequence,Type,Details Hash'
    );

    for (const event of recording.events) {
      lines.push(
        [
          event.id,
          event.timestamp,
          event.sequenceNumber.toString(),
          event.eventType,
          event.eventHash.substring(0, 16),
        ].join(',')
      );
    }

    if (recording.summary) {
      lines.push('');
      lines.push('Summary:');
      lines.push(`Total Events,${recording.summary.totalEvents}`);
      lines.push(`Duration (seconds),${recording.summary.durationSeconds}`);
      lines.push(`API Calls,${recording.summary.apiCalls.count}`);
      lines.push(`Errors,${recording.summary.errors.count}`);
      lines.push(`Integrity Valid,${recording.summary.integrityValid}`);
    }

    return lines.join('\n');
  }

  /**
   * Verify recording integrity
   */
  async verifyIntegrity(recordingId: string): Promise<{
    valid: boolean;
    brokenAt?: number;
    error?: string;
  }> {
    const recording = await this.getRecording(recordingId);

    let previousHash: string | null = null;

    for (const event of recording.events) {
      // Verify hash chain
      if (event.previousHash !== previousHash) {
        return {
          valid: false,
          brokenAt: event.sequenceNumber,
          error: `Hash chain broken at sequence ${event.sequenceNumber}`,
        };
      }

      // Verify event hash
      const expectedHash = this.computeEventHash({
        ...event,
        eventHash: '',
      });

      if (event.eventHash !== expectedHash) {
        return {
          valid: false,
          brokenAt: event.sequenceNumber,
          error: `Event hash mismatch at sequence ${event.sequenceNumber}`,
        };
      }

      previousHash = event.eventHash;
    }

    return { valid: true };
  }

  /**
   * Request deletion of a recording (requires admin approval)
   */
  async requestDeletion(
    recordingId: string,
    requestedBy: string,
    reason: string
  ): Promise<void> {
    const recording = await this.getRecording(recordingId);

    // Check if within retention period
    const retentionUntil = new Date(recording.retentionUntil);
    const now = new Date();

    if (now < retentionUntil) {
      throw new RecordingDeletionDeniedError(
        recordingId,
        `Recording is within retention period (until ${recording.retentionUntil})`
      );
    }

    logger.warn(
      {
        recordingId,
        requestedBy,
        reason,
        retentionUntil: recording.retentionUntil,
      },
      'Recording deletion requested'
    );

    // Note: Actual deletion should go through approval workflow
    // This just validates the request can be made
  }

  /**
   * Approve and execute deletion (admin only)
   */
  async approveDeletion(
    recordingId: string,
    approvedBy: string
  ): Promise<void> {
    const recording = await this.getRecording(recordingId);

    // Remove from active recordings if present
    this.activeRecordings.delete(recordingId);

    // Delete from storage
    await this.storage.delete(recordingId, approvedBy);

    logger.warn(
      {
        recordingId,
        approvedBy,
        sessionId: recording.sessionId,
        userId: recording.userId,
      },
      'Recording deleted with admin approval'
    );
  }

  /**
   * Check if a session has an active recording
   */
  isRecording(sessionId: string): boolean {
    const states = Array.from(this.activeRecordings.values());
    for (const state of states) {
      if (state.recording.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get active recording for a session
   */
  getActiveRecordingForSession(sessionId: string): Recording | null {
    const states = Array.from(this.activeRecordings.values());
    for (const state of states) {
      if (state.recording.sessionId === sessionId) {
        return state.recording;
      }
    }
    return null;
  }

  /**
   * Destroy the recorder and cleanup resources
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Attempt to flush remaining buffers
    const entries = Array.from(this.activeRecordings.entries());
    for (const [recordingId] of entries) {
      this.flushBuffer(recordingId).catch((error) => {
        logger.error({ error, recordingId }, 'Failed to flush buffer on destroy');
      });
    }

    logger.info('Session recorder destroyed');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushAllBuffers().catch((error) => {
        logger.error({ error }, 'Failed to flush buffers');
      });
    }, this.flushIntervalMs);
  }

  private async flushAllBuffers(): Promise<void> {
    const entries = Array.from(this.activeRecordings.entries());
    for (const [recordingId, state] of entries) {
      if (state.buffer.length > 0) {
        await this.flushBuffer(recordingId);
      }
    }
  }

  private async flushBuffer(recordingId: string): Promise<void> {
    const state = this.activeRecordings.get(recordingId);
    if (!state || state.buffer.length === 0) {
      return;
    }

    const events = [...state.buffer];
    state.buffer = [];

    await this.storage.flushEvents(recordingId, events);

    eventBufferSize.set(state.buffer.length);

    logger.debug(
      { recordingId, eventCount: events.length },
      'Flushed event buffer'
    );
  }

  private computeEventHash(event: Omit<SessionEvent, 'eventHash'> & { eventHash?: string }): string {
    const payload = {
      id: event.id,
      recordingId: event.recordingId,
      timestamp: event.timestamp,
      sequenceNumber: event.sequenceNumber,
      eventType: event.eventType,
      details: event.details,
      previousHash: event.previousHash,
    };

    return createHash(HASH_ALGORITHM)
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest('hex');
  }

  private computeRecordingHash(recording: Recording): string {
    const payload = {
      id: recording.id,
      sessionId: recording.sessionId,
      userId: recording.userId,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      metadata: recording.metadata,
      eventCount: recording.events.length,
      lastEventHash: recording.events[recording.events.length - 1]?.eventHash,
    };

    return createHash(HASH_ALGORITHM)
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest('hex');
  }

  private computeSummary(events: SessionEvent[], startedAt: string): RecordingSummary {
    const summary: RecordingSummary = {
      totalEvents: events.length,
      eventsByType: {} as Record<SessionEventType, number>,
      dataAccessed: {
        resourceTypes: [],
        totalRecords: 0,
        operations: {},
      },
      permissionsUsed: {
        permissions: [],
        denied: 0,
        granted: 0,
      },
      errors: {
        count: 0,
        bySeverity: {},
      },
      apiCalls: {
        count: 0,
        avgDurationMs: 0,
        statusCodes: {},
      },
      durationSeconds: 0,
      integrityValid: true,
    };

    // Initialize event type counts
    for (const type of Object.values(SessionEventType)) {
      summary.eventsByType[type] = 0;
    }

    const resourceTypes = new Set<string>();
    const permissions = new Set<string>();
    let totalApiDuration = 0;

    // Verify hash chain and compute stats
    let previousHash: string | null = null;

    for (const event of events) {
      // Check hash chain
      if (event.previousHash !== previousHash) {
        summary.integrityValid = false;
      }
      previousHash = event.eventHash;

      // Count by type
      summary.eventsByType[event.eventType]++;

      // Process by type
      const details = event.details as SessionEventDetails;

      switch (details.type) {
        case 'api_call': {
          summary.apiCalls.count++;
          totalApiDuration += details.durationMs;
          const statusKey = String(details.statusCode);
          summary.apiCalls.statusCodes[statusKey] =
            (summary.apiCalls.statusCodes[statusKey] ?? 0) + 1;
          break;
        }

        case 'data_access': {
          resourceTypes.add(details.resourceType);
          summary.dataAccessed.totalRecords += details.recordCount ?? 1;
          summary.dataAccessed.operations[details.operation] =
            (summary.dataAccessed.operations[details.operation] ?? 0) + 1;
          break;
        }

        case 'permission_usage': {
          permissions.add(details.permission);
          if (details.granted) {
            summary.permissionsUsed.granted++;
          } else {
            summary.permissionsUsed.denied++;
          }
          break;
        }

        case 'error': {
          summary.errors.count++;
          summary.errors.bySeverity[details.severity] =
            (summary.errors.bySeverity[details.severity] ?? 0) + 1;
          break;
        }
      }
    }

    summary.dataAccessed.resourceTypes = Array.from(resourceTypes);
    summary.permissionsUsed.permissions = Array.from(permissions);

    if (summary.apiCalls.count > 0) {
      summary.apiCalls.avgDurationMs = totalApiDuration / summary.apiCalls.count;
    }

    // Calculate duration
    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      const start = new Date(startedAt).getTime();
      const end = new Date(lastEvent.timestamp).getTime();
      summary.durationSeconds = (end - start) / 1000;
    }

    return summary;
  }
}

// =============================================================================
// Fastify Integration
// =============================================================================

/**
 * Options for the session recording Fastify plugin
 */
export interface SessionRecordingPluginOptions {
  /** Session recorder instance */
  recorder: SessionRecorder;
  /** Function to determine if request should be recorded */
  shouldRecord?: (request: FastifyRequest) => boolean;
  /** Function to get session ID from request */
  getSessionId?: (request: FastifyRequest) => string | null;
  /** Function to get user ID from request */
  getUserId?: (request: FastifyRequest) => string | null;
  /** Paths to exclude from recording */
  excludePaths?: string[];
  /** Whether to record request bodies */
  recordRequestBodies?: boolean;
  /** Whether to record response bodies */
  recordResponseBodies?: boolean;
}

/**
 * Create a Fastify plugin for auto-recording requests during elevated sessions
 */
export function createSessionRecordingPlugin(options: SessionRecordingPluginOptions) {
  const {
    recorder,
    shouldRecord = () => true,
    getSessionId = (req) => (req as FastifyRequest & { session?: { id?: string } }).session?.id ?? null,
    getUserId = (req) => (req as FastifyRequest & { user?: { id?: string } }).user?.id ?? null,
    excludePaths = ['/health', '/ready', '/metrics'],
    recordRequestBodies = false,
    recordResponseBodies = false,
  } = options;

  return async function sessionRecordingPlugin(fastify: FastifyInstance) {
    // Add recording context to request
    fastify.decorateRequest('pamRecording', null);

    // Pre-handler to check for active recording
    fastify.addHook('preHandler', async (request: FastifyRequest) => {
      // Skip excluded paths
      if (excludePaths.some((p) => request.url.startsWith(p))) {
        return;
      }

      // Check if we should record this request
      if (!shouldRecord(request)) {
        return;
      }

      const sessionId = getSessionId(request);
      if (!sessionId) {
        return;
      }

      // Check for active recording
      const recording = recorder.getActiveRecordingForSession(sessionId);
      if (!recording) {
        return;
      }

      // Store recording ID on request for response hook
      (request as FastifyRequest & { pamRecording?: { id: string; startTime: number } }).pamRecording = {
        id: recording.id,
        startTime: Date.now(),
      };
    });

    // Response hook to record the API call
    fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
      const pamContext = (request as FastifyRequest & { pamRecording?: { id: string; startTime: number } }).pamRecording;
      if (!pamContext) {
        return;
      }

      const durationMs = Date.now() - pamContext.startTime;

      const eventDetails: ApiCallEvent = {
        type: 'api_call',
        method: request.method,
        path: request.url,
        statusCode: reply.statusCode,
        durationMs,
        requestId: request.id,
      };

      // Optionally include query params
      if (Object.keys(request.query as object).length > 0) {
        eventDetails.query = request.query as Record<string, unknown>;
      }

      // Optionally include bodies
      if (recordRequestBodies && request.body) {
        eventDetails.requestBody = request.body;
      }

      try {
        await recorder.recordEvent(pamContext.id, eventDetails);
      } catch (error) {
        logger.error(
          { error, recordingId: pamContext.id, path: request.url },
          'Failed to record API call event'
        );
      }
    });

    logger.info('Session recording plugin registered');
  };
}

// =============================================================================
// PAM Integration Hooks
// =============================================================================

/**
 * PAM session hooks for auto-starting/stopping recordings
 */
export interface PAMSessionHooks {
  /** Called when a PAM session starts */
  onSessionStart: (
    sessionId: string,
    userId: string,
    metadata: RecordingMetadata
  ) => Promise<Recording>;
  /** Called when a PAM session ends */
  onSessionEnd: (sessionId: string) => Promise<RecordingSummary | null>;
  /** Record a permission usage event */
  recordPermissionUsage: (
    sessionId: string,
    permission: string,
    action: string,
    granted: boolean,
    details?: Partial<PermissionUsageEvent>
  ) => Promise<void>;
  /** Record a data access event */
  recordDataAccess: (
    sessionId: string,
    operation: 'read' | 'write' | 'delete' | 'list',
    resourceType: string,
    details?: Partial<DataAccessEvent>
  ) => Promise<void>;
}

/**
 * Create PAM session hooks
 */
export function createPAMSessionHooks(recorder: SessionRecorder): PAMSessionHooks {
  return {
    async onSessionStart(sessionId, userId, metadata) {
      return recorder.startRecording(sessionId, userId, metadata);
    },

    async onSessionEnd(sessionId) {
      const recording = recorder.getActiveRecordingForSession(sessionId);
      if (!recording) {
        return null;
      }
      return recorder.stopRecording(recording.id);
    },

    async recordPermissionUsage(sessionId, permission, action, granted, details) {
      const recording = recorder.getActiveRecordingForSession(sessionId);
      if (!recording) {
        return;
      }

      const event: PermissionUsageEvent = {
        type: 'permission_usage',
        permission,
        action,
        granted,
        ...details,
      };

      await recorder.recordEvent(recording.id, event);
    },

    async recordDataAccess(sessionId, operation, resourceType, details) {
      const recording = recorder.getActiveRecordingForSession(sessionId);
      if (!recording) {
        return;
      }

      const event: DataAccessEvent = {
        type: 'data_access',
        operation,
        resourceType,
        ...details,
      };

      await recorder.recordEvent(recording.id, event);
    },
  };
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a session recorder with default configuration
 */
export function createSessionRecorder(
  options?: Partial<SessionRecorderConfig>
): SessionRecorder {
  const storage = options?.storage ?? new InMemoryRecordingStorage();

  return new SessionRecorder({
    storage,
    privacy: options?.privacy,
    retentionDays: options?.retentionDays,
    flushIntervalMs: options?.flushIntervalMs,
    maxBufferSize: options?.maxBufferSize,
    tenantId: options?.tenantId,
  });
}

// =============================================================================
// Exports
// =============================================================================

export {
  DEFAULT_PRIVACY_CONFIG,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_BUFFER_SIZE,
};
