/**
 * Database Migration Checker
 *
 * Provides migration status checking, validation, and execution
 * for application startup and CLI commands.
 *
 * Features:
 * - Check for pending migrations
 * - Run pending migrations with VORION_AUTO_MIGRATE support
 * - Schema drift detection
 * - Schema validation against Drizzle definitions
 *
 * @packageDocumentation
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getConfig } from '../common/config.js';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'migration-checker' });

/**
 * Migration status information
 */
export interface MigrationStatus {
  /** Whether there are pending migrations */
  hasPending: boolean;
  /** Number of pending migrations */
  pendingCount: number;
  /** Names of pending migrations */
  pendingMigrations: string[];
  /** Name of last applied migration, null if none */
  lastApplied: string | null;
  /** Current schema version (from drizzle migrations table) */
  schemaVersion: string;
  /** All applied migrations */
  appliedMigrations: string[];
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  /** Whether the schema is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** List of warnings (non-critical issues) */
  warnings: string[];
}

/**
 * Schema drift detection result
 */
export interface SchemaDriftResult {
  /** Whether drift was detected */
  hasDrift: boolean;
  /** Whether drift is critical (blocks startup) */
  criticalDrift: boolean;
  /** Drift details */
  drifts: SchemaDrift[];
}

/**
 * Individual schema drift
 */
export interface SchemaDrift {
  /** Type of drift */
  type: 'missing_table' | 'missing_column' | 'type_mismatch' | 'missing_index' | 'extra_table' | 'extra_column';
  /** Schema object name */
  object: string;
  /** Expected value (from Drizzle schema) */
  expected?: string;
  /** Actual value (from database) */
  actual?: string;
  /** Whether this drift is critical */
  critical: boolean;
  /** Human-readable description */
  description: string;
}

/**
 * Migration run result
 */
export interface MigrationRunResult {
  /** Whether migrations ran successfully */
  success: boolean;
  /** Number of migrations applied */
  appliedCount: number;
  /** Names of applied migrations */
  appliedMigrations: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Migration rollback result
 */
export interface MigrationRollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Migration that was rolled back */
  rolledBack: string | null;
  /** Error message if failed */
  error?: string;
}

// Migrations directory (relative to project root)
const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle/migrations');
const MIGRATIONS_JOURNAL = resolve(MIGRATIONS_DIR, 'meta/_journal.json');

/**
 * Drizzle migration journal entry
 */
interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

/**
 * Drizzle migration journal
 */
interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Create a database pool for migration operations
 */
function createMigrationPool(): Pool {
  const config = getConfig();

  return new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: 1, // Single connection for migrations
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

/**
 * Read the Drizzle migration journal
 */
function readMigrationJournal(): MigrationJournal | null {
  if (!existsSync(MIGRATIONS_JOURNAL)) {
    logger.warn({ path: MIGRATIONS_JOURNAL }, 'Migration journal not found');
    return null;
  }

  try {
    const content = readFileSync(MIGRATIONS_JOURNAL, 'utf8');
    return JSON.parse(content) as MigrationJournal;
  } catch (error) {
    logger.error({ error, path: MIGRATIONS_JOURNAL }, 'Failed to read migration journal');
    return null;
  }
}

/**
 * Get list of all migration files from the journal
 */
function getAllMigrations(): string[] {
  const journal = readMigrationJournal();
  if (!journal) {
    // Fallback: read migration files directly
    if (!existsSync(MIGRATIONS_DIR)) {
      return [];
    }

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    return files.map(f => f.replace('.sql', ''));
  }

  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map(e => e.tag);
}

/**
 * Get applied migrations from the database
 */
async function getAppliedMigrations(client: PoolClient): Promise<string[]> {
  try {
    // Check if the drizzle migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '__drizzle_migrations'
      )
    `);

    if (!tableCheck.rows[0]?.exists) {
      return [];
    }

    // Get applied migrations
    const result = await client.query(`
      SELECT hash, created_at
      FROM "__drizzle_migrations"
      ORDER BY created_at ASC
    `);

    return result.rows.map(row => row.hash);
  } catch (error) {
    logger.error({ error }, 'Failed to get applied migrations');
    return [];
  }
}

/**
 * Check migration status
 *
 * @returns Migration status information
 */
export async function checkMigrations(): Promise<MigrationStatus> {
  const pool = createMigrationPool();

  try {
    const client = await pool.connect();

    try {
      const allMigrations = getAllMigrations();
      const appliedMigrations = await getAppliedMigrations(client);

      // Find pending migrations
      // Drizzle stores hashes, so we need to match by migration name/tag
      const appliedSet = new Set(appliedMigrations);
      const pendingMigrations: string[] = [];

      // For Drizzle, we compare migration count and sequence
      // If we have more migrations in the journal than applied, there are pending ones
      const appliedCount = appliedMigrations.length;
      const totalCount = allMigrations.length;

      if (appliedCount < totalCount) {
        // The pending migrations are those after the last applied index
        for (let i = appliedCount; i < totalCount; i++) {
          pendingMigrations.push(allMigrations[i] ?? `migration_${i}`);
        }
      }

      const lastApplied = appliedCount > 0
        ? (allMigrations[appliedCount - 1] ?? null)
        : null;

      // Generate schema version from applied migrations count and last applied
      const schemaVersion = appliedCount > 0
        ? `${appliedCount}.0.0`
        : '0.0.0';

      return {
        hasPending: pendingMigrations.length > 0,
        pendingCount: pendingMigrations.length,
        pendingMigrations,
        lastApplied,
        schemaVersion,
        appliedMigrations: allMigrations.slice(0, appliedCount),
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Run all pending migrations
 *
 * @returns Migration run result
 */
export async function runPendingMigrations(): Promise<MigrationRunResult> {
  const pool = createMigrationPool();

  try {
    logger.info('Starting migration run');

    // Get current status before migration
    const beforeStatus = await checkMigrations();

    if (!beforeStatus.hasPending) {
      logger.info('No pending migrations to run');
      return {
        success: true,
        appliedCount: 0,
        appliedMigrations: [],
      };
    }

    logger.info(
      { pendingCount: beforeStatus.pendingCount, migrations: beforeStatus.pendingMigrations },
      'Running pending migrations'
    );

    // Run migrations using Drizzle
    const db = drizzle(pool);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    // Get status after migration
    const afterStatus = await checkMigrations();

    const appliedMigrations = beforeStatus.pendingMigrations.filter(
      m => !afterStatus.pendingMigrations.includes(m)
    );

    logger.info(
      { appliedCount: appliedMigrations.length, migrations: appliedMigrations },
      'Migrations completed successfully'
    );

    return {
      success: true,
      appliedCount: appliedMigrations.length,
      appliedMigrations,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Migration failed');

    return {
      success: false,
      appliedCount: 0,
      appliedMigrations: [],
      error: errorMessage,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Rollback the last applied migration
 *
 * NOTE: Drizzle ORM does not support automatic rollback.
 * This function attempts to find and execute a corresponding down migration file.
 *
 * @returns Rollback result
 */
export async function rollbackLastMigration(): Promise<MigrationRollbackResult> {
  const pool = createMigrationPool();

  try {
    const status = await checkMigrations();

    if (!status.lastApplied) {
      return {
        success: false,
        rolledBack: null,
        error: 'No migrations to rollback',
      };
    }

    const lastMigration = status.lastApplied;
    const downFile = resolve(MIGRATIONS_DIR, `${lastMigration}.down.sql`);

    // Check if down migration exists
    if (!existsSync(downFile)) {
      return {
        success: false,
        rolledBack: null,
        error: `No down migration found for ${lastMigration}. Manual rollback required.`,
      };
    }

    logger.info({ migration: lastMigration }, 'Rolling back migration');

    const client = await pool.connect();

    try {
      // Read and execute down migration
      const downSql = readFileSync(downFile, 'utf8');

      await client.query('BEGIN');

      try {
        // Execute the down migration
        await client.query(downSql);

        // Remove from drizzle migrations table
        await client.query(
          `DELETE FROM "__drizzle_migrations" WHERE hash = $1`,
          [lastMigration]
        );

        await client.query('COMMIT');

        logger.info({ migration: lastMigration }, 'Migration rolled back successfully');

        return {
          success: true,
          rolledBack: lastMigration,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error }, 'Rollback failed');

    return {
      success: false,
      rolledBack: null,
      error: errorMessage,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Expected tables from Drizzle schema
 * These are the core tables that must exist
 */
const EXPECTED_TABLES = [
  'intents',
  'intent_events',
  'intent_evaluations',
  'escalations',
  'audit_records',
  'policies',
  'policy_versions',
  'tenant_memberships',
  'group_memberships',
  'escalation_approvers',
  'user_consents',
  'consent_policies',
  'audit_reads',
  'webhook_deliveries',
];

/**
 * Critical tables that must exist for startup
 */
const CRITICAL_TABLES = [
  'intents',
  'intent_events',
  'escalations',
  'policies',
  'audit_records',
];

/**
 * Validate the database schema against expected structure
 *
 * @returns Validation result
 */
export async function validateSchema(): Promise<SchemaValidationResult> {
  const pool = createMigrationPool();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const client = await pool.connect();

    try {
      // Get list of actual tables
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      `);

      const actualTables = new Set(tablesResult.rows.map(r => r.table_name));

      // Check for missing critical tables
      for (const table of CRITICAL_TABLES) {
        if (!actualTables.has(table)) {
          errors.push(`Missing critical table: ${table}`);
        }
      }

      // Check for missing non-critical tables
      for (const table of EXPECTED_TABLES) {
        if (!actualTables.has(table) && !CRITICAL_TABLES.includes(table)) {
          warnings.push(`Missing table: ${table}`);
        }
      }

      // Check for drizzle migrations table
      if (!actualTables.has('__drizzle_migrations')) {
        warnings.push('Drizzle migrations table not found - database may not be managed by Drizzle');
      }

      // Check for required columns in critical tables
      const criticalColumns: Record<string, string[]> = {
        intents: ['id', 'tenant_id', 'entity_id', 'goal', 'status', 'created_at'],
        escalations: ['id', 'intent_id', 'tenant_id', 'status', 'created_at'],
        audit_records: ['id', 'tenant_id', 'event_type', 'event_time'],
      };

      for (const [table, columns] of Object.entries(criticalColumns)) {
        if (actualTables.has(table)) {
          const columnsResult = await client.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
          `, [table]);

          const actualColumns = new Set(columnsResult.rows.map(r => r.column_name));

          for (const column of columns) {
            if (!actualColumns.has(column)) {
              errors.push(`Missing column ${column} in table ${table}`);
            }
          }
        }
      }

      // Check for required indexes (basic check)
      const indexResult = await client.query(`
        SELECT indexname, tablename
        FROM pg_indexes
        WHERE schemaname = 'public'
      `);

      const indexCount = indexResult.rows.length;
      if (indexCount < 5) {
        warnings.push(`Low index count (${indexCount}) - performance may be impacted`);
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Schema validation failed: ${errorMessage}`);

    return {
      valid: false,
      errors,
      warnings,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Detect schema drift between database and expected schema
 *
 * @returns Schema drift detection result
 */
export async function detectSchemaDrift(): Promise<SchemaDriftResult> {
  const pool = createMigrationPool();
  const drifts: SchemaDrift[] = [];

  try {
    const client = await pool.connect();

    try {
      // Get list of actual tables
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%' ESCAPE '\\'
      `);

      const actualTables = new Set(tablesResult.rows.map(r => r.table_name));

      // Check for missing expected tables
      for (const table of EXPECTED_TABLES) {
        if (!actualTables.has(table)) {
          drifts.push({
            type: 'missing_table',
            object: table,
            critical: CRITICAL_TABLES.includes(table),
            description: `Expected table '${table}' does not exist in database`,
          });
        }
      }

      // Check for extra tables not in expected list
      const vorionTables = ['__drizzle_migrations'];
      for (const table of Array.from(actualTables)) {
        if (!EXPECTED_TABLES.includes(table) && !vorionTables.includes(table)) {
          // Check if it's a Vorion-related table we might have missed
          const isKnownSystemTable = table.startsWith('pg_') || table.startsWith('sql_');
          if (!isKnownSystemTable) {
            drifts.push({
              type: 'extra_table',
              object: table,
              critical: false,
              description: `Unexpected table '${table}' exists in database`,
            });
          }
        }
      }

      // Check column types for critical tables
      const expectedColumns: Record<string, Record<string, string>> = {
        intents: {
          id: 'uuid',
          tenant_id: 'text',
          entity_id: 'uuid',
          goal: 'text',
          status: 'USER-DEFINED', // enum
          created_at: 'timestamp with time zone',
        },
        escalations: {
          id: 'uuid',
          intent_id: 'uuid',
          tenant_id: 'text',
          status: 'USER-DEFINED', // enum
          created_at: 'timestamp with time zone',
        },
      };

      for (const [table, columns] of Object.entries(expectedColumns)) {
        if (actualTables.has(table)) {
          const columnsResult = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
          `, [table]);

          const actualColumns = new Map(
            columnsResult.rows.map(r => [r.column_name, r.data_type])
          );

          for (const [column, expectedType] of Object.entries(columns)) {
            const actualType = actualColumns.get(column);

            if (!actualType) {
              drifts.push({
                type: 'missing_column',
                object: `${table}.${column}`,
                expected: expectedType,
                critical: CRITICAL_TABLES.includes(table),
                description: `Column '${column}' missing from table '${table}'`,
              });
            } else if (actualType !== expectedType) {
              // Type mismatch - only flag if significantly different
              const normalizedActual = actualType.toLowerCase();
              const normalizedExpected = expectedType.toLowerCase();

              if (normalizedActual !== normalizedExpected) {
                drifts.push({
                  type: 'type_mismatch',
                  object: `${table}.${column}`,
                  expected: expectedType,
                  actual: actualType,
                  critical: false,
                  description: `Column '${table}.${column}' has type '${actualType}' but expected '${expectedType}'`,
                });
              }
            }
          }
        }
      }

      // Check for critical indexes
      const criticalIndexes = [
        'intents_pkey',
        'escalations_pkey',
        'audit_records_pkey',
      ];

      const indexResult = await client.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
      `);

      const actualIndexes = new Set(indexResult.rows.map(r => r.indexname));

      for (const index of criticalIndexes) {
        if (!actualIndexes.has(index)) {
          drifts.push({
            type: 'missing_index',
            object: index,
            critical: true,
            description: `Critical index '${index}' is missing`,
          });
        }
      }

      const hasCriticalDrift = drifts.some(d => d.critical);

      return {
        hasDrift: drifts.length > 0,
        criticalDrift: hasCriticalDrift,
        drifts,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      hasDrift: true,
      criticalDrift: true,
      drifts: [{
        type: 'missing_table',
        object: 'database',
        critical: true,
        description: `Failed to check schema drift: ${errorMessage}`,
      }],
    };
  } finally {
    await pool.end();
  }
}

/**
 * Error thrown when migrations are pending and auto-migrate is disabled
 */
export class PendingMigrationsError extends Error {
  public readonly pendingMigrations: string[];
  public readonly pendingCount: number;

  constructor(status: MigrationStatus) {
    const message = `Database has ${status.pendingCount} pending migration(s): ${status.pendingMigrations.join(', ')}. ` +
      'Set VORION_AUTO_MIGRATE=true to run automatically, or run "vorion migrate up" manually.';

    super(message);
    this.name = 'PendingMigrationsError';
    this.pendingMigrations = status.pendingMigrations;
    this.pendingCount = status.pendingCount;
  }
}

/**
 * Error thrown when critical schema drift is detected
 */
export class CriticalSchemaDriftError extends Error {
  public readonly drifts: SchemaDrift[];

  constructor(drifts: SchemaDrift[]) {
    const criticalDrifts = drifts.filter(d => d.critical);
    const message = `Critical schema drift detected:\n${criticalDrifts.map(d => `  - ${d.description}`).join('\n')}\n` +
      'Run "vorion migrate up" to apply pending migrations, or manually fix the schema.';

    super(message);
    this.name = 'CriticalSchemaDriftError';
    this.drifts = drifts;
  }
}

/**
 * Options for startup migration check
 */
export interface StartupMigrationOptions {
  /** Whether to automatically run migrations */
  autoMigrate?: boolean;
  /** Whether to validate schema after migrations */
  validateAfterMigrate?: boolean;
  /** Whether to check for schema drift */
  checkDrift?: boolean;
  /** Whether to block on critical drift */
  blockOnCriticalDrift?: boolean;
}

/**
 * Check and optionally run migrations during startup
 *
 * @param options - Startup options
 * @throws PendingMigrationsError if migrations are pending and auto-migrate is disabled
 * @throws CriticalSchemaDriftError if critical drift is detected and blocking is enabled
 */
export async function checkAndRunMigrations(options: StartupMigrationOptions = {}): Promise<{
  migrationStatus: MigrationStatus;
  validationResult?: SchemaValidationResult;
  driftResult?: SchemaDriftResult;
  migrationsRun: boolean;
}> {
  const {
    autoMigrate = process.env['VORION_AUTO_MIGRATE'] === 'true',
    validateAfterMigrate = true,
    checkDrift = true,
    blockOnCriticalDrift = true,
  } = options;

  logger.info({ autoMigrate, validateAfterMigrate, checkDrift }, 'Starting migration check');

  // Check current migration status
  let migrationStatus = await checkMigrations();
  let migrationsRun = false;

  logger.info({
    hasPending: migrationStatus.hasPending,
    pendingCount: migrationStatus.pendingCount,
    lastApplied: migrationStatus.lastApplied,
    schemaVersion: migrationStatus.schemaVersion,
  }, 'Migration status checked');

  // Handle pending migrations
  if (migrationStatus.hasPending) {
    if (autoMigrate) {
      logger.info('Auto-migrate enabled, running pending migrations');

      const result = await runPendingMigrations();

      if (!result.success) {
        throw new Error(`Migration failed: ${result.error}`);
      }

      migrationsRun = true;
      migrationStatus = await checkMigrations();
    } else {
      throw new PendingMigrationsError(migrationStatus);
    }
  }

  // Validate schema
  let validationResult: SchemaValidationResult | undefined;
  if (validateAfterMigrate) {
    validationResult = await validateSchema();

    if (!validationResult.valid) {
      logger.error({ errors: validationResult.errors }, 'Schema validation failed');
    }

    if (validationResult.warnings.length > 0) {
      logger.warn({ warnings: validationResult.warnings }, 'Schema validation warnings');
    }
  }

  // Check for schema drift
  let driftResult: SchemaDriftResult | undefined;
  if (checkDrift) {
    driftResult = await detectSchemaDrift();

    if (driftResult.hasDrift) {
      logger.warn({ driftCount: driftResult.drifts.length }, 'Schema drift detected');

      if (driftResult.criticalDrift && blockOnCriticalDrift) {
        throw new CriticalSchemaDriftError(driftResult.drifts);
      }
    }
  }

  logger.info({
    schemaVersion: migrationStatus.schemaVersion,
    migrationsRun,
    schemaValid: validationResult?.valid,
    hasDrift: driftResult?.hasDrift,
  }, 'Migration check completed');

  return {
    migrationStatus,
    validationResult,
    driftResult,
    migrationsRun,
  };
}

/**
 * Get migration status for health check endpoint
 */
export async function getMigrationStatusForHealth(): Promise<{
  healthy: boolean;
  status: 'ok' | 'pending_migrations' | 'error';
  details: {
    schemaVersion: string;
    pendingCount: number;
    lastApplied: string | null;
    autoMigrateEnabled: boolean;
  };
  error?: string;
}> {
  try {
    const status = await checkMigrations();
    const autoMigrateEnabled = process.env['VORION_AUTO_MIGRATE'] === 'true';

    // Healthy if no pending migrations OR if auto-migrate is enabled
    const healthy = !status.hasPending || autoMigrateEnabled;

    return {
      healthy,
      status: status.hasPending ? 'pending_migrations' : 'ok',
      details: {
        schemaVersion: status.schemaVersion,
        pendingCount: status.pendingCount,
        lastApplied: status.lastApplied,
        autoMigrateEnabled,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      healthy: false,
      status: 'error',
      details: {
        schemaVersion: '0.0.0',
        pendingCount: -1,
        lastApplied: null,
        autoMigrateEnabled: process.env['VORION_AUTO_MIGRATE'] === 'true',
      },
      error: errorMessage,
    };
  }
}
