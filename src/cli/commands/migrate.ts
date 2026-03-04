/**
 * Migrate Command
 *
 * Database migration management commands for Vorion.
 * Provides status checking, running migrations, rollback, schema validation,
 * and encryption KDF migration.
 *
 * Commands:
 *   vorion migrate status     - Show pending migrations
 *   vorion migrate up         - Run pending migrations
 *   vorion migrate down       - Rollback last migration
 *   vorion migrate validate   - Validate schema
 *   vorion migrate encryption - Migrate KDF v1 encrypted data to v2
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import {
  checkMigrations,
  runPendingMigrations,
  rollbackLastMigration,
  validateSchema,
  detectSchemaDrift,
  type MigrationStatus,
  type SchemaValidationResult,
  type SchemaDriftResult,
} from '../../db/migration-checker.js';
import {
  getKdfDeprecationStatus,
  migrateEnvelopeBatch,
  getEnvelopeKdfVersion,
  type EncryptedEnvelope,
  type BatchMigrationResult,
} from '../../common/encryption.js';

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

/**
 * Format migration status for display
 */
function formatMigrationStatus(status: MigrationStatus, json: boolean): string {
  if (json) {
    return JSON.stringify(status, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${colors.bold}Migration Status${colors.reset}`);
  lines.push('');

  // Schema version
  lines.push(`${colors.cyan}Schema Version:${colors.reset} ${status.schemaVersion}`);

  // Last applied
  lines.push(`${colors.cyan}Last Applied:${colors.reset} ${status.lastApplied ?? 'None'}`);

  // Applied migrations
  lines.push(`${colors.cyan}Applied Migrations:${colors.reset} ${status.appliedMigrations.length}`);

  if (status.appliedMigrations.length > 0) {
    const recent = status.appliedMigrations.slice(-5);
    for (const migration of recent) {
      lines.push(`  ${colors.green}[x]${colors.reset} ${migration}`);
    }
    if (status.appliedMigrations.length > 5) {
      lines.push(`  ${colors.dim}... and ${status.appliedMigrations.length - 5} more${colors.reset}`);
    }
  }

  lines.push('');

  // Pending migrations
  if (status.hasPending) {
    lines.push(`${colors.yellow}Pending Migrations:${colors.reset} ${status.pendingCount}`);
    for (const migration of status.pendingMigrations) {
      lines.push(`  ${colors.yellow}[ ]${colors.reset} ${migration}`);
    }
    lines.push('');
    lines.push(`${colors.yellow}Run "vorion migrate up" to apply pending migrations${colors.reset}`);
  } else {
    lines.push(`${colors.green}No pending migrations${colors.reset}`);
  }

  return lines.join('\n');
}

/**
 * Format validation result for display
 */
function formatValidationResult(result: SchemaValidationResult, json: boolean): string {
  if (json) {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${colors.bold}Schema Validation${colors.reset}`);
  lines.push('');

  if (result.valid) {
    lines.push(`${colors.green}Schema is valid${colors.reset}`);
  } else {
    lines.push(`${colors.red}Schema validation failed${colors.reset}`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push(`${colors.red}Errors:${colors.reset}`);
    for (const error of result.errors) {
      lines.push(`  ${colors.red}x${colors.reset} ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(`${colors.yellow}Warnings:${colors.reset}`);
    for (const warning of result.warnings) {
      lines.push(`  ${colors.yellow}!${colors.reset} ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format drift result for display
 */
function formatDriftResult(result: SchemaDriftResult, json: boolean): string {
  if (json) {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${colors.bold}Schema Drift Detection${colors.reset}`);
  lines.push('');

  if (!result.hasDrift) {
    lines.push(`${colors.green}No schema drift detected${colors.reset}`);
    return lines.join('\n');
  }

  if (result.criticalDrift) {
    lines.push(`${colors.red}Critical drift detected - startup may be blocked${colors.reset}`);
  } else {
    lines.push(`${colors.yellow}Non-critical drift detected${colors.reset}`);
  }

  lines.push('');
  lines.push(`${colors.cyan}Drift Summary:${colors.reset} ${result.drifts.length} issue(s)`);
  lines.push('');

  // Group drifts by type
  const byType = new Map<string, typeof result.drifts>();
  for (const drift of result.drifts) {
    const existing = byType.get(drift.type) ?? [];
    existing.push(drift);
    byType.set(drift.type, existing);
  }

  for (const [type, drifts] of Array.from(byType.entries())) {
    const typeLabel = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`${colors.bold}${typeLabel}:${colors.reset}`);

    for (const drift of drifts) {
      const icon = drift.critical ? colors.red + 'x' : colors.yellow + '!';
      lines.push(`  ${icon}${colors.reset} ${drift.object}`);
      lines.push(`    ${colors.dim}${drift.description}${colors.reset}`);

      if (drift.expected && drift.actual) {
        lines.push(`    ${colors.dim}Expected: ${drift.expected}, Actual: ${drift.actual}${colors.reset}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Status subcommand - Show migration status
 */
async function statusCommand(options: { json: boolean; drift: boolean }): Promise<void> {
  try {
    const status = await checkMigrations();
    console.log(formatMigrationStatus(status, options.json));

    if (options.drift) {
      console.log('');
      const driftResult = await detectSchemaDrift();
      console.log(formatDriftResult(driftResult, options.json));
    }

    // Exit with non-zero if there are pending migrations
    if (status.hasPending) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${colors.red}Error checking migrations: ${message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Up subcommand - Run pending migrations
 */
async function upCommand(options: { dryRun: boolean; json: boolean }): Promise<void> {
  try {
    // First check status
    const status = await checkMigrations();

    if (!status.hasPending) {
      console.log(options.json
        ? JSON.stringify({ success: true, message: 'No pending migrations', applied: [] })
        : `${colors.green}No pending migrations to run${colors.reset}`
      );
      return;
    }

    if (options.dryRun) {
      console.log(options.json
        ? JSON.stringify({ dryRun: true, pendingMigrations: status.pendingMigrations })
        : `${colors.cyan}Dry run - would apply:${colors.reset}\n${status.pendingMigrations.map(m => `  - ${m}`).join('\n')}`
      );
      return;
    }

    console.log(options.json
      ? ''
      : `${colors.cyan}Running ${status.pendingCount} migration(s)...${colors.reset}`
    );

    const result = await runPendingMigrations();

    if (result.success) {
      console.log(options.json
        ? JSON.stringify({ success: true, applied: result.appliedMigrations, count: result.appliedCount })
        : `${colors.green}Successfully applied ${result.appliedCount} migration(s):${colors.reset}\n${result.appliedMigrations.map(m => `  ${colors.green}[x]${colors.reset} ${m}`).join('\n')}`
      );
    } else {
      console.error(options.json
        ? JSON.stringify({ success: false, error: result.error })
        : `${colors.red}Migration failed: ${result.error}${colors.reset}`
      );
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(options.json
      ? JSON.stringify({ success: false, error: message })
      : `${colors.red}Error running migrations: ${message}${colors.reset}`
    );
    process.exit(1);
  }
}

/**
 * Down subcommand - Rollback last migration
 */
async function downCommand(options: { json: boolean; force: boolean }): Promise<void> {
  try {
    // Check current status
    const status = await checkMigrations();

    if (!status.lastApplied) {
      console.log(options.json
        ? JSON.stringify({ success: false, error: 'No migrations to rollback' })
        : `${colors.yellow}No migrations to rollback${colors.reset}`
      );
      process.exit(1);
    }

    if (!options.force) {
      console.log(options.json
        ? ''
        : `${colors.yellow}Warning: This will rollback migration '${status.lastApplied}'${colors.reset}`
      );
      console.log(options.json
        ? ''
        : `${colors.yellow}Use --force to confirm rollback${colors.reset}`
      );
      process.exit(1);
    }

    console.log(options.json
      ? ''
      : `${colors.cyan}Rolling back '${status.lastApplied}'...${colors.reset}`
    );

    const result = await rollbackLastMigration();

    if (result.success) {
      console.log(options.json
        ? JSON.stringify({ success: true, rolledBack: result.rolledBack })
        : `${colors.green}Successfully rolled back: ${result.rolledBack}${colors.reset}`
      );
    } else {
      console.error(options.json
        ? JSON.stringify({ success: false, error: result.error })
        : `${colors.red}Rollback failed: ${result.error}${colors.reset}`
      );
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(options.json
      ? JSON.stringify({ success: false, error: message })
      : `${colors.red}Error during rollback: ${message}${colors.reset}`
    );
    process.exit(1);
  }
}

/**
 * Validate subcommand - Validate database schema
 */
async function validateCommand(options: { json: boolean; drift: boolean }): Promise<void> {
  try {
    const validationResult = await validateSchema();
    console.log(formatValidationResult(validationResult, options.json));

    if (options.drift) {
      console.log('');
      const driftResult = await detectSchemaDrift();
      console.log(formatDriftResult(driftResult, options.json));

      // Exit with non-zero if critical drift
      if (driftResult.criticalDrift) {
        process.exit(2);
      }
    }

    // Exit with non-zero if validation failed
    if (!validationResult.valid) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(options.json
      ? JSON.stringify({ valid: false, error: message })
      : `${colors.red}Error validating schema: ${message}${colors.reset}`
    );
    process.exit(1);
  }
}

/**
 * Create the migrate command
 */
export const migrateCommand = new Command('migrate')
  .description('Database and encryption migration management')
  .addHelpText('after', `
Examples:
  $ vorion migrate status              Check for pending migrations
  $ vorion migrate status --drift      Check status and detect schema drift
  $ vorion migrate up                  Run all pending migrations
  $ vorion migrate up --dry-run        Show what would be migrated
  $ vorion migrate down --force        Rollback the last migration
  $ vorion migrate validate            Validate database schema
  $ vorion migrate validate --drift    Validate and check for drift
  $ vorion migrate encryption status   Check encryption KDF migration status
  $ vorion migrate encryption          Run encryption KDF migration

Environment Variables:
  VORION_AUTO_MIGRATE=true    Automatically run migrations on startup
  VORION_DB_HOST              Database host
  VORION_DB_PORT              Database port
  VORION_DB_NAME              Database name
  VORION_DB_USER              Database user
  VORION_DB_PASSWORD          Database password
`);

// Status subcommand
migrateCommand
  .command('status')
  .description('Show migration status and pending migrations')
  .option('--json', 'Output as JSON')
  .option('--drift', 'Also check for schema drift')
  .action(statusCommand);

// Up subcommand
migrateCommand
  .command('up')
  .description('Run all pending migrations')
  .option('--dry-run', 'Show what would be migrated without applying')
  .option('--json', 'Output as JSON')
  .action(upCommand);

// Down subcommand
migrateCommand
  .command('down')
  .description('Rollback the last applied migration')
  .option('--force', 'Confirm rollback')
  .option('--json', 'Output as JSON')
  .action(downCommand);

// Validate subcommand
migrateCommand
  .command('validate')
  .description('Validate database schema against expected structure')
  .option('--json', 'Output as JSON')
  .option('--drift', 'Also check for schema drift')
  .action(validateCommand);

// ============================================================================
// Encryption KDF Migration
// ============================================================================

/**
 * Format encryption migration status
 */
function formatEncryptionStatus(
  status: ReturnType<typeof getKdfDeprecationStatus>,
  v1Count: number,
  v2Count: number,
  json: boolean
): string {
  if (json) {
    return JSON.stringify({
      deprecationStatus: status,
      v1Count,
      v2Count,
      needsMigration: v1Count > 0,
    }, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${colors.bold}Encryption KDF Status${colors.reset}`);
  lines.push('');

  // Deprecation status
  if (status.isDeprecated) {
    lines.push(`${colors.red}KDF v1 Status: DEPRECATED (past ${status.deprecationDate})${colors.reset}`);
    lines.push(`${colors.red}KDF v1 decryption is no longer supported!${colors.reset}`);
  } else {
    lines.push(`${colors.yellow}KDF v1 Status: Deprecated (until ${status.deprecationDate})${colors.reset}`);
    lines.push(`${colors.cyan}Days until v1 disabled:${colors.reset} ${status.daysUntilDeprecation}`);
  }

  lines.push('');

  // Envelope counts
  lines.push(`${colors.cyan}Envelopes using KDF v1:${colors.reset} ${v1Count}`);
  lines.push(`${colors.cyan}Envelopes using KDF v2:${colors.reset} ${v2Count}`);

  if (status.v1DecryptionCount > 0) {
    lines.push(`${colors.yellow}v1 decryption attempts this session:${colors.reset} ${status.v1DecryptionCount}`);
  }

  lines.push('');

  // Migration recommendation
  if (v1Count > 0) {
    if (status.isDeprecated) {
      lines.push(`${colors.red}CRITICAL: ${v1Count} envelope(s) require immediate migration!${colors.reset}`);
      lines.push(`${colors.red}Run: vorion migrate encryption --force${colors.reset}`);
    } else {
      lines.push(`${colors.yellow}${v1Count} envelope(s) need migration before ${status.deprecationDate}${colors.reset}`);
      lines.push(`${colors.cyan}Run: vorion migrate encryption --dry-run  (to preview)${colors.reset}`);
      lines.push(`${colors.cyan}Run: vorion migrate encryption            (to migrate)${colors.reset}`);
    }
  } else {
    lines.push(`${colors.green}All envelopes are using KDF v2. No migration needed.${colors.reset}`);
  }

  return lines.join('\n');
}

/**
 * Format batch migration result
 */
function formatMigrationResult(result: BatchMigrationResult, json: boolean): string {
  if (json) {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${colors.bold}Encryption Migration Results${colors.reset}`);
  lines.push('');

  lines.push(`${colors.cyan}Total envelopes:${colors.reset} ${result.total}`);
  lines.push(`${colors.green}Migrated:${colors.reset} ${result.migrated}`);
  lines.push(`${colors.dim}Skipped (already v2):${colors.reset} ${result.skipped}`);

  if (result.failed > 0) {
    lines.push(`${colors.red}Failed:${colors.reset} ${result.failed}`);
    lines.push('');
    lines.push(`${colors.red}Errors:${colors.reset}`);
    for (const error of result.errors) {
      lines.push(`  ${colors.red}[${error.index}]${colors.reset} ${error.error}`);
    }
  }

  lines.push('');

  if (result.failed === 0) {
    lines.push(`${colors.green}Migration completed successfully!${colors.reset}`);
  } else {
    lines.push(`${colors.yellow}Migration completed with ${result.failed} error(s).${colors.reset}`);
  }

  return lines.join('\n');
}

/**
 * Encryption migration status subcommand
 */
async function encryptionStatusCommand(options: { json: boolean }): Promise<void> {
  try {
    const deprecationStatus = getKdfDeprecationStatus();

    // Note: In a real implementation, this would query the database for encrypted envelopes
    // For now, we show the deprecation status and instruct users to check their data stores
    console.log(options.json
      ? JSON.stringify({
          deprecationStatus,
          message: 'Query your data stores to count v1/v2 envelopes. Use getEnvelopeKdfVersion() to check each envelope.',
        }, null, 2)
      : formatEncryptionStatus(deprecationStatus, 0, 0, false)
    );

    if (!options.json) {
      console.log('');
      console.log(`${colors.dim}Note: To get accurate envelope counts, query your data stores directly.${colors.reset}`);
      console.log(`${colors.dim}Use getEnvelopeKdfVersion(envelope) to check each envelope's KDF version.${colors.reset}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(options.json
      ? JSON.stringify({ error: message })
      : `${colors.red}Error checking encryption status: ${message}${colors.reset}`
    );
    process.exit(1);
  }
}

/**
 * Encryption migration run subcommand
 *
 * Note: This is a framework command that demonstrates the migration process.
 * In practice, users would integrate migrateEnvelopeBatch() into their data access layer.
 */
async function encryptionMigrateCommand(options: {
  dryRun: boolean;
  json: boolean;
  force: boolean;
}): Promise<void> {
  try {
    const deprecationStatus = getKdfDeprecationStatus();

    // Check deprecation status
    if (deprecationStatus.isDeprecated && !options.force) {
      console.error(options.json
        ? JSON.stringify({
            error: 'KDF v1 is past deprecation date. Migration requires --force flag.',
            deprecationDate: deprecationStatus.deprecationDate,
          })
        : `${colors.red}Error: KDF v1 is past deprecation date (${deprecationStatus.deprecationDate}).${colors.reset}\n` +
          `${colors.yellow}Use --force to attempt migration anyway.${colors.reset}`
      );
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(options.json
        ? JSON.stringify({
            dryRun: true,
            message: 'Dry run mode. No data will be modified.',
            instructions: [
              'Query your data stores for encrypted envelopes',
              'Check kdfVersion field (null or 1 = v1, 2 = v2)',
              'Use migrateEnvelopeBatch() to migrate v1 envelopes',
            ],
          }, null, 2)
        : `${colors.cyan}Dry run mode - showing migration instructions${colors.reset}\n\n` +
          `To migrate encrypted data:\n\n` +
          `1. Query your data stores for encrypted envelopes\n` +
          `2. Filter envelopes where kdfVersion is null or 1\n` +
          `3. Use migrateEnvelopeBatch(envelopes) to migrate\n` +
          `4. Update your data store with the migrated envelopes\n\n` +
          `Example code:\n` +
          `${colors.dim}  import { migrateEnvelopeBatch, getEnvelopeKdfVersion } from '@vorion/core';${colors.reset}\n` +
          `${colors.dim}  ${colors.reset}\n` +
          `${colors.dim}  const envelopes = await db.query('SELECT * FROM encrypted_data');${colors.reset}\n` +
          `${colors.dim}  const v1Envelopes = envelopes.filter(e => getEnvelopeKdfVersion(e) === 1);${colors.reset}\n` +
          `${colors.dim}  const { results, stats } = migrateEnvelopeBatch(v1Envelopes);${colors.reset}\n` +
          `${colors.dim}  await db.bulkUpdate(results);${colors.reset}`
      );
      return;
    }

    // Show migration instructions for actual migration
    console.log(options.json
      ? JSON.stringify({
          message: 'Encryption migration must be performed programmatically on your data stores.',
          deprecationStatus,
          instructions: [
            'Import migrateEnvelopeBatch from @vorion/core',
            'Query your data stores for v1 encrypted envelopes',
            'Call migrateEnvelopeBatch(envelopes) with progress callback',
            'Update your data stores with migrated envelopes',
          ],
          codeExample: `
import { migrateEnvelopeBatch, getEnvelopeKdfVersion } from '@vorion/core';

// 1. Query v1 envelopes from your data store
const allEnvelopes = await db.query('SELECT * FROM encrypted_data');
const v1Envelopes = allEnvelopes.filter(e => getEnvelopeKdfVersion(e.envelope) === 1);

// 2. Migrate with progress tracking
const { results, stats } = migrateEnvelopeBatch(
  v1Envelopes.map(e => e.envelope),
  (current, total) => console.log(\`Progress: \${current}/\${total}\`)
);

// 3. Update data store
for (let i = 0; i < v1Envelopes.length; i++) {
  await db.update(v1Envelopes[i].id, { envelope: results[i] });
}

console.log(\`Migrated: \${stats.migrated}, Failed: \${stats.failed}\`);
`,
        }, null, 2)
      : `${colors.bold}Encryption KDF Migration${colors.reset}\n\n` +
        `${colors.cyan}Deprecation Status:${colors.reset}\n` +
        `  Date: ${deprecationStatus.deprecationDate}\n` +
        `  Days remaining: ${deprecationStatus.daysUntilDeprecation}\n` +
        `  Is deprecated: ${deprecationStatus.isDeprecated ? colors.red + 'YES' : colors.green + 'NO'}${colors.reset}\n\n` +
        `${colors.yellow}Migration must be performed programmatically on your data stores.${colors.reset}\n\n` +
        `Steps:\n` +
        `  1. Query your data stores for v1 encrypted envelopes\n` +
        `  2. Call migrateEnvelopeBatch() with your envelopes\n` +
        `  3. Update your data stores with the migrated envelopes\n\n` +
        `See the API documentation for detailed migration examples.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(options.json
      ? JSON.stringify({ error: message })
      : `${colors.red}Error during encryption migration: ${message}${colors.reset}`
    );
    process.exit(1);
  }
}

// Encryption subcommand
const encryptionCommand = new Command('encryption')
  .description('Migrate encrypted data from KDF v1 (SHA-256) to v2 (PBKDF2-SHA512)')
  .addHelpText('after', `
Examples:
  $ vorion migrate encryption status     Check encryption KDF migration status
  $ vorion migrate encryption --dry-run  Preview migration without changes
  $ vorion migrate encryption            Run migration (shows instructions)
  $ vorion migrate encryption --force    Force migration (past deprecation date)

Security Notes:
  - KDF v1 (SHA-256) is cryptographically weak and deprecated
  - KDF v2 (PBKDF2-SHA512) is the secure, current standard
  - All v1 encrypted data must be migrated before the deprecation date
  - After deprecation, v1 decryption will throw an error

Migration Process:
  The CLI provides status and instructions. Actual migration must be done
  programmatically using the migrateEnvelopeBatch() function from @vorion/core.
`);

encryptionCommand
  .command('status')
  .description('Check encryption KDF migration status')
  .option('--json', 'Output as JSON')
  .action(encryptionStatusCommand);

encryptionCommand
  .option('--dry-run', 'Show what would be migrated without making changes')
  .option('--json', 'Output as JSON')
  .option('--force', 'Force migration even after deprecation date')
  .action(encryptionMigrateCommand);

migrateCommand.addCommand(encryptionCommand);
