#!/usr/bin/env node
/**
 * Vorion Platform CLI
 *
 * Command-line interface for managing Vorion deployments.
 *
 * Commands:
 *   init       - Interactive setup wizard for new deployments
 *   doctor     - Diagnose configuration and dependencies
 *   deploy     - Deploy Vorion using Docker Compose
 *   secrets    - Generate and manage secrets
 *   health     - Check deployment health status
 *   config     - View and validate configuration
 *   migrate    - Database migration management
 *
 * Quick Start:
 *   vorion init              # Set up a new deployment
 *   vorion doctor            # Verify configuration
 *   vorion deploy -m personal  # Deploy in personal mode
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import { deployCommand } from './commands/deploy.js';
import { secretsCommand } from './commands/secrets.js';
import { healthCommand } from './commands/health.js';
import { configCommand } from './commands/config.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { migrateCommand } from './commands/migrate.js';

const VERSION = process.env['npm_package_version'] || '1.0.0';

const program = new Command()
  .name('vorion')
  .description('Vorion Platform CLI - Governed AI Execution Platform')
  .version(VERSION)
  .option('-v, --verbose', 'Enable verbose output')
  .option('--json', 'Output results as JSON')
  .addHelpText(
    'after',
    `
Quick Start:
  $ vorion init                    Set up a new deployment
  $ vorion doctor                  Verify configuration
  $ vorion deploy -m personal -d   Deploy in personal mode

Common Commands:
  $ vorion secrets generate        Generate secure secrets
  $ vorion health check            Check deployment health
  $ vorion config show             View current configuration

Deployment Modes:
  personal    - Lite mode for individual use (no Redis required)
  business    - Full stack for team/business use
  enterprise  - High-availability with replicas and monitoring

Documentation: https://docs.vorion.io
Support: https://github.com/vorion/vorion/issues
`
  );

// Register commands in logical order
program.addCommand(initCommand);      // Setup wizard (first step for new users)
program.addCommand(doctorCommand);    // Diagnose issues
program.addCommand(deployCommand);    // Deploy
program.addCommand(secretsCommand);   // Manage secrets
program.addCommand(healthCommand);    // Check health
program.addCommand(configCommand);    // Configuration
program.addCommand(migrateCommand);   // Database migrations

// Global error handler
program.configureOutput({
  outputError: (str: string, write: (s: string) => void) => {
    write(`\x1b[31mError: ${str}\x1b[0m`);
  },
});

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
  if (process.env['VORION_DEBUG']) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error(`\x1b[31mError: ${reason instanceof Error ? reason.message : reason}\x1b[0m`);
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (program.args.length === 0) {
  program.outputHelp();
}
