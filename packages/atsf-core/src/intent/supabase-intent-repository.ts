/**
 * Supabase/Postgres Persistence Adapter for Intent Service
 *
 * Production-quality intent service backed by Supabase (PostgreSQL). Provides:
 * - Full IIntentService interface implementation
 * - Input validation (same rules as PersistentIntentService)
 * - State machine enforcement for status transitions
 * - Tenant isolation via tenantId column (and optional RLS)
 * - Configurable table name and schema for multi-schema deployments
 * - Correlation ID tracking for distributed tracing
 * - Type-only import of @supabase/supabase-js to avoid hard dependency
 *
 * Requires the migration in ./migrations/001_create_intents_table.sql to be
 * applied before use.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { Intent, ID, IntentStatus } from '../common/types.js';
import type { IIntentService, IntentSubmission, SubmitOptions } from './index.js';

// ---------------------------------------------------------------------------
// Type-only import of Supabase client to avoid hard dependency.
// Consumers must provide a SupabaseClient instance at construction time.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger({ component: 'supabase-intent-repository' });

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Valid status transitions for the intent lifecycle.
 * Mirrors PersistentIntentService exactly.
 */
const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  pending: ['evaluating', 'cancelled'],
  evaluating: ['approved', 'denied', 'escalated', 'failed'],
  approved: ['executing', 'cancelled'],
  denied: [],
  escalated: ['approved', 'denied', 'cancelled'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: ['pending'], // allow retry
  cancelled: [],
};

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate an IntentSubmission. Returns an array of error messages (empty = valid).
 * Mirrors PersistentIntentService validation logic exactly.
 */
function validateSubmission(submission: IntentSubmission): string[] {
  const errors: string[] = [];

  if (!submission.entityId || typeof submission.entityId !== 'string') {
    errors.push('entityId is required and must be a non-empty string');
  }
  if (!submission.goal || typeof submission.goal !== 'string') {
    errors.push('goal is required and must be a non-empty string');
  }
  if (submission.goal && submission.goal.length > 10_000) {
    errors.push('goal must be 10,000 characters or fewer');
  }
  if (
    submission.context !== undefined &&
    (typeof submission.context !== 'object' || submission.context === null)
  ) {
    errors.push('context must be a plain object');
  }
  if (submission.expiresIn !== undefined) {
    if (typeof submission.expiresIn !== 'number' || submission.expiresIn <= 0) {
      errors.push('expiresIn must be a positive number (milliseconds)');
    }
    if (submission.expiresIn > 86_400_000) {
      errors.push('expiresIn cannot exceed 24 hours (86400000ms)');
    }
  }

  return errors;
}

// =============================================================================
// DATABASE ROW TYPE
// =============================================================================

/**
 * Shape of a row in the intents table (snake_case column names).
 * Used internally for mapping between the database and the Intent domain type.
 */
interface IntentRow {
  id: string;
  tenant_id: string;
  entity_id: string;
  goal: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: IntentStatus;
  created_at: string;
  updated_at: string;
  trust_snapshot: Record<string, unknown> | null;
  trust_level: number | null;
  correlation_id: string;
  action_type: string | null;
  resource_scope: string[] | null;
  data_sensitivity: string | null;
  reversibility: string | null;
  expires_at: string | null;
  source: string | null;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for the Supabase intent repository.
 */
export interface SupabaseIntentRepositoryConfig {
  /** Supabase client instance (caller must provide) */
  client: SupabaseClient;
  /** Table name to use. Default: 'intents' */
  tableName?: string;
  /** Database schema to use (for multi-schema Supabase setups). Default: 'public' */
  schema?: string;
  /** Default expiration time for intents without explicit expiresIn (ms). Default: 1 hour */
  defaultExpirationMs?: number;
}

const CONFIG_DEFAULTS = {
  tableName: 'intents',
  schema: 'public',
  defaultExpirationMs: 3_600_000,
} as const;

// =============================================================================
// MAPPING HELPERS
// =============================================================================

/**
 * Convert a database row (snake_case) to an Intent domain object (camelCase).
 */
function rowToIntent(row: IntentRow): Intent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityId: row.entity_id,
    goal: row.goal,
    context: row.context,
    metadata: row.metadata,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trustSnapshot: row.trust_snapshot,
    trustLevel: row.trust_level,
    correlationId: row.correlation_id,
    actionType: row.action_type,
    resourceScope: row.resource_scope,
    dataSensitivity: row.data_sensitivity,
    reversibility: row.reversibility,
    expiresAt: row.expires_at,
    source: row.source,
  };
}

/**
 * Convert an Intent domain object to a database row for insertion.
 */
function intentToRow(intent: Intent): IntentRow {
  return {
    id: intent.id,
    tenant_id: intent.tenantId ?? '',
    entity_id: intent.entityId,
    goal: intent.goal,
    context: intent.context,
    metadata: intent.metadata,
    status: intent.status,
    created_at: intent.createdAt,
    updated_at: intent.updatedAt,
    trust_snapshot: intent.trustSnapshot ?? null,
    trust_level: intent.trustLevel ?? null,
    correlation_id: intent.correlationId ?? crypto.randomUUID(),
    action_type: intent.actionType ?? null,
    resource_scope: intent.resourceScope ?? null,
    data_sensitivity: intent.dataSensitivity ?? null,
    reversibility: intent.reversibility ?? null,
    expires_at: intent.expiresAt ?? null,
    source: intent.source ?? null,
  };
}

// =============================================================================
// SUPABASE INTENT REPOSITORY
// =============================================================================

/**
 * Supabase/Postgres-backed intent service.
 *
 * Implements the full IIntentService interface with durable persistence,
 * input validation, state machine enforcement, and tenant isolation.
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js';
 * import { createSupabaseIntentRepository } from '@vorionsys/atsf-core/intent/supabase-intent-repository';
 *
 * const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
 * const intentService = createSupabaseIntentRepository({ client: supabase });
 *
 * const intent = await intentService.submit(
 *   { entityId: 'agent-1', goal: 'Send email', context: {} },
 *   { tenantId: 'tenant-abc' }
 * );
 * ```
 */
export class SupabaseIntentRepository implements IIntentService {
  private readonly client: SupabaseClient;
  private readonly tableName: string;
  private readonly schema: string;
  private readonly defaultExpirationMs: number;

  constructor(config: SupabaseIntentRepositoryConfig) {
    if (!config.client) {
      throw new Error('SupabaseIntentRepository requires a SupabaseClient instance');
    }

    this.client = config.client;
    this.tableName = config.tableName ?? CONFIG_DEFAULTS.tableName;
    this.schema = config.schema ?? CONFIG_DEFAULTS.schema;
    this.defaultExpirationMs = config.defaultExpirationMs ?? CONFIG_DEFAULTS.defaultExpirationMs;

    logger.info(
      { tableName: this.tableName, schema: this.schema },
      'SupabaseIntentRepository initialized'
    );
  }

  // ---------------------------------------------------------------------------
  // Private: get a schema-scoped query builder for the intents table
  // ---------------------------------------------------------------------------

  private table() {
    return this.client.schema(this.schema).from(this.tableName);
  }

  // ---------------------------------------------------------------------------
  // IIntentService.submit
  // ---------------------------------------------------------------------------

  /**
   * Submit a new intent with full validation and persist to Supabase.
   */
  async submit(submission: IntentSubmission, options: SubmitOptions): Promise<Intent> {
    // Validate input
    const errors = validateSubmission(submission);
    if (errors.length > 0) {
      throw new Error(`Invalid intent submission: ${errors.join('; ')}`);
    }

    if (!options.tenantId) {
      throw new Error('tenantId is required in SubmitOptions');
    }

    const now = new Date().toISOString();
    const correlationId = submission.correlationId ?? crypto.randomUUID();
    const expiresAt = submission.expiresIn
      ? new Date(Date.now() + submission.expiresIn).toISOString()
      : new Date(Date.now() + this.defaultExpirationMs).toISOString();

    const intent: Intent = {
      id: crypto.randomUUID(),
      tenantId: options.tenantId,
      entityId: submission.entityId,
      goal: submission.goal,
      context: submission.context ?? {},
      metadata: submission.metadata ?? {},
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      trustSnapshot: options.trustSnapshot ?? null,
      trustLevel: options.trustLevel ?? null,
      correlationId,
      actionType: submission.actionType ?? null,
      resourceScope: submission.resourceScope ?? null,
      dataSensitivity: submission.dataSensitivity ?? null,
      reversibility: submission.reversibility ?? null,
      expiresAt,
      source: submission.source ?? null,
    };

    const row = intentToRow(intent);

    const { data, error } = await this.table()
      .insert(row)
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, code: error.code, intentId: intent.id },
        'Failed to insert intent into Supabase'
      );
      throw new Error(`Failed to persist intent: ${error.message}`);
    }

    const persisted = rowToIntent(data as IntentRow);

    logger.info(
      {
        intentId: persisted.id,
        entityId: persisted.entityId,
        tenantId: options.tenantId,
        goal: persisted.goal.slice(0, 100),
        correlationId,
        actionType: persisted.actionType,
      },
      'Intent submitted'
    );

    return persisted;
  }

  // ---------------------------------------------------------------------------
  // IIntentService.get
  // ---------------------------------------------------------------------------

  /**
   * Retrieve an intent by ID with tenant isolation.
   * Returns undefined if not found or if the intent belongs to a different tenant.
   */
  async get(id: ID, tenantId: ID): Promise<Intent | undefined> {
    const { data, error } = await this.table()
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      logger.error(
        { error: error.message, code: error.code, intentId: id },
        'Failed to fetch intent from Supabase'
      );
      throw new Error(`Failed to fetch intent: ${error.message}`);
    }

    if (!data) {
      return undefined;
    }

    const intent = rowToIntent(data as IntentRow);

    // Check expiration: if expired and not yet terminal, auto-cancel
    if (this.isExpired(intent)) {
      await this.expireIntent(intent);
      return undefined;
    }

    return intent;
  }

  // ---------------------------------------------------------------------------
  // IIntentService.updateStatus
  // ---------------------------------------------------------------------------

  /**
   * Update the status of an intent with state machine enforcement.
   * Returns the updated intent, or undefined if not found / wrong tenant.
   * Throws if the requested transition is invalid.
   */
  async updateStatus(
    id: ID,
    tenantId: ID,
    status: IntentStatus
  ): Promise<Intent | undefined> {
    // First, fetch the current intent to validate the transition
    const { data: currentData, error: fetchError } = await this.table()
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError) {
      logger.error(
        { error: fetchError.message, code: fetchError.code, intentId: id },
        'Failed to fetch intent for status update'
      );
      throw new Error(`Failed to fetch intent for status update: ${fetchError.message}`);
    }

    if (!currentData) {
      return undefined;
    }

    const currentIntent = rowToIntent(currentData as IntentRow);

    // Validate transition against the state machine
    const allowed = VALID_TRANSITIONS[currentIntent.status];
    if (!allowed || !allowed.includes(status)) {
      throw new Error(
        `Invalid status transition: '${currentIntent.status}' -> '${status}'. ` +
          `Allowed transitions from '${currentIntent.status}': [${allowed?.join(', ') ?? 'none'}]`
      );
    }

    // Perform the update
    const { data: updatedData, error: updateError } = await this.table()
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      logger.error(
        { error: updateError.message, code: updateError.code, intentId: id },
        'Failed to update intent status in Supabase'
      );
      throw new Error(`Failed to update intent status: ${updateError.message}`);
    }

    const updated = rowToIntent(updatedData as IntentRow);

    logger.info(
      { intentId: id, from: currentIntent.status, to: status },
      'Intent status updated'
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // IIntentService.listByEntity
  // ---------------------------------------------------------------------------

  /**
   * List all intents for a given entity within a tenant.
   * Results are sorted by creation time (newest first).
   * Expired intents are excluded.
   */
  async listByEntity(entityId: ID, tenantId: ID): Promise<Intent[]> {
    const { data, error } = await this.table()
      .select('*')
      .eq('entity_id', entityId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(
        { error: error.message, code: error.code, entityId, tenantId },
        'Failed to list intents from Supabase'
      );
      throw new Error(`Failed to list intents: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return [];
    }

    const now = Date.now();
    const results: Intent[] = [];

    for (const row of data as IntentRow[]) {
      const intent = rowToIntent(row);
      if (!this.isExpired(intent, now)) {
        results.push(intent);
      }
    }

    return results;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Check if an intent has passed its expiration time.
   */
  private isExpired(intent: Intent, now?: number): boolean {
    if (!intent.expiresAt) return false;
    return new Date(intent.expiresAt).getTime() < (now ?? Date.now());
  }

  /**
   * Mark an expired, non-terminal intent as cancelled in the database.
   */
  private async expireIntent(intent: Intent): Promise<void> {
    const terminalStatuses: IntentStatus[] = ['completed', 'cancelled', 'denied'];
    if (terminalStatuses.includes(intent.status)) {
      return;
    }

    const { error } = await this.table()
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', intent.id)
      .eq('tenant_id', intent.tenantId ?? '');

    if (error) {
      logger.warn(
        { error: error.message, intentId: intent.id },
        'Failed to auto-cancel expired intent'
      );
    } else {
      logger.debug({ intentId: intent.id }, 'Intent expired and auto-cancelled');
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new SupabaseIntentRepository instance.
 *
 * This factory provides a convenient way to instantiate the repository
 * without directly importing the class, useful for dependency injection
 * and testing.
 *
 * @param config - Repository configuration including the Supabase client
 * @returns A configured SupabaseIntentRepository implementing IIntentService
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js';
 * import { createSupabaseIntentRepository } from '@vorionsys/atsf-core/intent/supabase-intent-repository';
 *
 * const supabase = createClient(
 *   process.env.SUPABASE_URL!,
 *   process.env.SUPABASE_SERVICE_KEY!
 * );
 *
 * const intentService = createSupabaseIntentRepository({
 *   client: supabase,
 *   tableName: 'intents',         // default
 *   schema: 'public',             // default
 *   defaultExpirationMs: 3600000, // 1 hour default
 * });
 *
 * // Wire it into the service locator
 * import { setIntentService } from '@vorionsys/atsf-core';
 * setIntentService(intentService);
 * ```
 */
export function createSupabaseIntentRepository(
  config: SupabaseIntentRepositoryConfig
): SupabaseIntentRepository {
  return new SupabaseIntentRepository(config);
}
