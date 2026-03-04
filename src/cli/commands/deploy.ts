/**
 * Deploy Command
 *
 * Deploy Vorion in various modes using Docker Compose.
 * Supports dry-run, validation, and improved error handling.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import { spawn, type ChildProcess, execSync } from 'child_process';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { resolve } from 'path';

// Get the project root directory (relative to dist/cli/commands/)
const PROJECT_ROOT = resolve(__dirname, '../../..');

interface DeployOptions {
  mode: string;
  detach: boolean;
  build: boolean;
  scale: string[];
  envFile?: string;
  profile?: string;
  pull: boolean;
  dryRun: boolean;
  validate: boolean;
  timeout: string;
  showLogs: boolean;
}

interface StopOptions {
  mode: string;
  removeOrphans?: boolean;
  timeout: string;
}

interface DownOptions {
  mode: string;
  volumes: boolean;
  removeOrphans?: boolean;
  timeout: string;
}

interface LogsOptions {
  mode: string;
  follow: boolean;
  tail: string;
  service?: string;
  since?: string;
}

interface StatusOptions {
  mode: string;
  json: boolean;
}

interface ValidateOptions {
  mode: string;
  envFile?: string;
}

/**
 * Deployment modes with their compose files
 */
const DEPLOYMENT_MODES = {
  personal: {
    file: 'docker-compose.personal.yml',
    description: 'Lite mode for personal use (no Redis required)',
    requiredServices: ['vorion', 'postgres'],
    optionalServices: [],
  },
  business: {
    file: 'docker-compose.business.yml',
    description: 'Full stack for team/business use',
    requiredServices: ['vorion', 'postgres', 'redis'],
    optionalServices: ['adminer', 'redis-commander'],
  },
  enterprise: {
    file: 'docker-compose.enterprise.yml',
    description: 'High-availability with replicas',
    requiredServices: ['vorion', 'traefik'],
    optionalServices: ['postgres', 'redis', 'otel-collector', 'prometheus', 'grafana'],
  },
  development: {
    file: 'docker-compose.yml',
    description: 'Development environment with dev tools',
    requiredServices: ['vorion'],
    optionalServices: [],
  },
} as const;

type DeploymentMode = keyof typeof DEPLOYMENT_MODES;

/**
 * Run a Docker Compose command
 */
function runDockerCompose(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; capture?: boolean } = {}
): ChildProcess {
  const env = { ...process.env, ...options.env };

  return spawn('docker', ['compose', ...args], {
    cwd: options.cwd ?? PROJECT_ROOT,
    env,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
}

/**
 * Run a Docker Compose command and capture output
 */
async function runDockerComposeCapture(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env };
    const proc = spawn('docker', ['compose', ...args], {
      cwd: options.cwd ?? PROJECT_ROOT,
      env,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on('error', (error) => {
      resolve({ stdout, stderr: error.message, code: 1 });
    });
  });
}

/**
 * Check if Docker is available
 */
async function checkDocker(): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['--version'], { stdio: 'pipe' });
    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const match = output.match(/Docker version ([0-9.]+)/);
        resolve({ available: true, version: match?.[1] });
      } else {
        resolve({ available: false });
      }
    });
    proc.on('error', () => resolve({ available: false }));
  });
}

/**
 * Check if Docker Compose is available
 */
async function checkDockerCompose(): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'version'], { stdio: 'pipe' });
    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const match = output.match(/v?([0-9.]+)/);
        resolve({ available: true, version: match?.[1] });
      } else {
        resolve({ available: false });
      }
    });
    proc.on('error', () => resolve({ available: false }));
  });
}

/**
 * Validate Docker Compose file
 */
async function validateComposeFile(
  composeFile: string,
  envFile?: string
): Promise<{ valid: boolean; errors: string[] }> {
  const args = ['-f', composeFile];
  if (envFile) {
    args.push('--env-file', envFile);
  }
  args.push('config', '-q');

  const result = await runDockerComposeCapture(args);

  if (result.code === 0) {
    return { valid: true, errors: [] };
  }

  const errors = result.stderr
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/^(ERROR|error):?\s*/i, ''));

  return { valid: false, errors };
}

/**
 * Check required environment variables for a mode
 */
async function checkRequiredEnvVars(
  mode: DeploymentMode,
  envFile?: string
): Promise<{ valid: boolean; missing: string[]; warnings: string[] }> {
  const envVars: Record<string, string | undefined> = { ...process.env };

  // Load from env file if specified
  if (envFile && existsSync(envFile)) {
    const content = await fs.readFile(envFile, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        envVars[match[1]] = match[2];
      }
    }
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check based on mode
  if (mode === 'enterprise') {
    // Enterprise requires all secrets
    const requiredSecrets = [
      'VORION_JWT_SECRET',
      'VORION_ENCRYPTION_KEY',
      'VORION_ENCRYPTION_SALT',
      'VORION_DEDUPE_SECRET',
      'VORION_CSRF_SECRET',
      'VORION_DB_PASSWORD',
    ];

    for (const secret of requiredSecrets) {
      const value = envVars[secret];
      if (!value) {
        missing.push(secret);
      } else if (value.includes('CHANGE_ME') || value.length < 32) {
        warnings.push(`${secret}: Using placeholder or weak value`);
      }
    }
  } else if (mode === 'business') {
    // Business mode has optional secrets
    if (!envVars['VORION_DB_PASSWORD'] && !envVars['VORION_DB_HOST']) {
      warnings.push('No database configuration found - using defaults');
    }
  }

  return { valid: missing.length === 0, missing, warnings };
}

/**
 * Wait for services to become healthy
 */
async function waitForHealthy(
  composeFile: string,
  timeout: number
): Promise<{ healthy: boolean; services: Record<string, string> }> {
  const startTime = Date.now();
  const services: Record<string, string> = {};

  while (Date.now() - startTime < timeout) {
    const result = await runDockerComposeCapture([
      '-f',
      composeFile,
      'ps',
      '--format',
      'json',
    ]);

    if (result.code === 0 && result.stdout) {
      try {
        const lines = result.stdout.trim().split('\n');
        let allHealthy = true;

        for (const line of lines) {
          if (!line.trim()) continue;
          const svc = JSON.parse(line);
          services[svc.Service || svc.Name] = svc.Health || svc.State || 'unknown';
          if (svc.Health === 'unhealthy' || svc.State === 'exited') {
            allHealthy = false;
          }
          if (svc.Health !== 'healthy' && svc.Health) {
            allHealthy = false;
          }
        }

        if (allHealthy && Object.keys(services).length > 0) {
          return { healthy: true, services };
        }
      } catch {
        // JSON parse error, continue waiting
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { healthy: false, services };
}

/**
 * Show recent logs for failed services
 */
async function showFailedServiceLogs(composeFile: string, services: string[]): Promise<void> {
  console.log('\n  Recent logs from services:\n');

  for (const service of services) {
    console.log(`  --- ${service} ---`);
    const result = await runDockerComposeCapture([
      '-f',
      composeFile,
      'logs',
      '--tail',
      '50',
      '--no-color',
      service,
    ]);
    console.log(result.stdout || result.stderr || '  No logs available');
    console.log();
  }
}

export const deployCommand = new Command('deploy')
  .description('Deploy Vorion in various modes using Docker Compose')
  .option('-m, --mode <mode>', 'Deployment mode: personal, business, enterprise, development', 'business')
  .option('-d, --detach', 'Run in detached mode', false)
  .option('-b, --build', 'Build images before starting', false)
  .option('--no-build', 'Do not build images')
  .option('-s, --scale <service=num>', 'Scale service to num instances', (val: string, prev: string[]) => {
    prev.push(val);
    return prev;
  }, [] as string[])
  .option('--env-file <path>', 'Path to environment file')
  .option('--profile <profile>', 'Enable compose profile (e.g., dev-tools, observability)')
  .option('--pull', 'Pull images before starting', false)
  .option('--dry-run', 'Preview deployment without executing', false)
  .option('--validate', 'Validate configuration before deploying', false)
  .option('-t, --timeout <seconds>', 'Timeout for health checks in seconds', '120')
  .option('--show-logs', 'Show logs on startup failure', true)
  .addHelpText(
    'after',
    `
Examples:
  # Deploy in business mode (default)
  $ vorion deploy

  # Deploy in personal mode with detach
  $ vorion deploy -m personal -d

  # Preview deployment without executing
  $ vorion deploy --dry-run

  # Validate configuration before deploy
  $ vorion deploy --validate -m enterprise

  # Deploy with custom environment file
  $ vorion deploy --env-file .env.production

  # Scale API replicas in enterprise mode
  $ vorion deploy -m enterprise -s vorion=3

  # Deploy with dev tools profile
  $ vorion deploy --profile dev-tools

For more information, see: https://docs.vorion.io/deployment
`
  )
  .action(async (options: DeployOptions) => {
    // Check Docker availability
    console.log('\n  Vorion Deployment');
    console.log('  =================\n');

    const docker = await checkDocker();
    if (!docker.available) {
      console.error('  \x1b[31mError: Docker is not available.\x1b[0m');
      console.error('\n  Please install Docker: https://docs.docker.com/get-docker/');
      process.exit(1);
    }

    const compose = await checkDockerCompose();
    if (!compose.available) {
      console.error('  \x1b[31mError: Docker Compose is not available.\x1b[0m');
      console.error('\n  Please install Docker Compose: https://docs.docker.com/compose/install/');
      process.exit(1);
    }

    console.log(`  Docker: v${docker.version}`);
    console.log(`  Compose: v${compose.version}`);

    const mode = options.mode as DeploymentMode;

    // Validate mode
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`\n  \x1b[31mError: Invalid deployment mode: ${mode}\x1b[0m`);
      console.error('\n  Available modes:');
      for (const [key, config] of Object.entries(DEPLOYMENT_MODES)) {
        console.error(`    ${key.padEnd(12)} - ${config.description}`);
      }
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];
    const composeFile = resolve(PROJECT_ROOT, modeConfig.file);

    console.log(`\n  Mode: ${mode}`);
    console.log(`  ${modeConfig.description}`);

    // Check if compose file exists
    if (!existsSync(composeFile)) {
      console.error(`\n  \x1b[31mError: Compose file not found: ${modeConfig.file}\x1b[0m`);
      console.error('\n  Make sure you are in the Vorion project directory.');
      process.exit(1);
    }

    // Validate configuration if requested
    if (options.validate || options.dryRun) {
      console.log('\n  Validating configuration...\n');

      // Validate compose file
      const composeValidation = await validateComposeFile(modeConfig.file, options.envFile);
      if (!composeValidation.valid) {
        console.error('  \x1b[31mCompose file validation failed:\x1b[0m');
        for (const error of composeValidation.errors) {
          console.error(`    - ${error}`);
        }
        process.exit(1);
      }
      console.log('  \x1b[32mPASS\x1b[0m  Compose file syntax');

      // Check required environment variables
      const envValidation = await checkRequiredEnvVars(mode, options.envFile);
      if (!envValidation.valid) {
        console.error('  \x1b[31mFAIL\x1b[0m  Missing required environment variables:');
        for (const missing of envValidation.missing) {
          console.error(`    - ${missing}`);
        }
        console.error('\n  Run `vorion init` to generate configuration.');
        process.exit(1);
      }

      for (const warning of envValidation.warnings) {
        console.log(`  \x1b[33mWARN\x1b[0m  ${warning}`);
      }

      if (envValidation.valid && envValidation.warnings.length === 0) {
        console.log('  \x1b[32mPASS\x1b[0m  Environment variables');
      }
    }

    // Dry run - show what would be executed
    if (options.dryRun) {
      console.log('\n  Dry Run - Docker Compose Configuration Preview');
      console.log('  ' + '='.repeat(50) + '\n');

      const result = await runDockerComposeCapture(['-f', modeConfig.file, 'config']);
      if (result.code === 0) {
        console.log(result.stdout);
      } else {
        console.error(result.stderr);
      }

      console.log('\n  Command that would be executed:');
      const args: string[] = ['-f', modeConfig.file];
      if (options.envFile) args.push('--env-file', options.envFile);
      if (options.profile) args.push('--profile', options.profile);
      args.push('up');
      if (options.detach) args.push('-d');
      if (options.build) args.push('--build');
      if (options.pull) args.push('--pull', 'always');
      for (const scale of options.scale) args.push('--scale', scale);

      console.log(`  docker compose ${args.join(' ')}\n`);
      process.exit(0);
    }

    // Build compose command arguments
    const args: string[] = ['-f', modeConfig.file];

    // Add env file if specified
    if (options.envFile) {
      if (!existsSync(options.envFile)) {
        console.error(`\n  \x1b[31mError: Environment file not found: ${options.envFile}\x1b[0m`);
        console.error('\n  Run `vorion init -o ' + options.envFile + '` to create it.');
        process.exit(1);
      }
      args.push('--env-file', options.envFile);
    }

    // Add profile if specified
    if (options.profile) {
      args.push('--profile', options.profile);
    }

    // Add 'up' command
    args.push('up');

    // Add flags
    if (options.detach) {
      args.push('-d');
    }

    if (options.build) {
      args.push('--build');
    }

    if (options.pull) {
      args.push('--pull', 'always');
    }

    // Add scale options
    for (const scale of options.scale) {
      args.push('--scale', scale);
    }

    console.log(`\n  Starting deployment...`);
    console.log(`  Running: docker compose ${args.join(' ')}\n`);

    const proc = runDockerCompose(args);

    proc.on('exit', async (code) => {
      if (code === 0) {
        console.log('\n  \x1b[32mDeployment started successfully!\x1b[0m');

        if (options.detach) {
          // Wait for health checks
          const timeout = parseInt(options.timeout, 10) * 1000;
          console.log('\n  Waiting for services to become healthy...');

          const health = await waitForHealthy(modeConfig.file, timeout);

          if (health.healthy) {
            console.log('\n  Service Status:');
            for (const [service, status] of Object.entries(health.services)) {
              const color = status === 'healthy' ? '\x1b[32m' : '\x1b[33m';
              console.log(`    ${color}${status.toUpperCase().padEnd(10)}\x1b[0m ${service}`);
            }
            console.log('\n  Run `vorion health check` to verify API status.');
          } else {
            console.log('\n  \x1b[33mWarning: Some services may not be healthy yet.\x1b[0m');
            console.log('  Service Status:');
            for (const [service, status] of Object.entries(health.services)) {
              const color =
                status === 'healthy'
                  ? '\x1b[32m'
                  : status === 'unhealthy' || status === 'exited'
                  ? '\x1b[31m'
                  : '\x1b[33m';
              console.log(`    ${color}${status.toUpperCase().padEnd(10)}\x1b[0m ${service}`);
            }

            if (options.showLogs) {
              const unhealthy = Object.entries(health.services)
                .filter(([, s]) => s === 'unhealthy' || s === 'exited')
                .map(([name]) => name);
              if (unhealthy.length > 0) {
                await showFailedServiceLogs(modeConfig.file, unhealthy);
              }
            }
          }

          console.log(`\n  View logs: vorion deploy logs -m ${mode}`);
        }
        process.exit(0);
      } else {
        console.error('\n  \x1b[31mDeployment failed!\x1b[0m');
        console.error('\n  Troubleshooting steps:');
        console.error('    1. Run `vorion doctor` to check configuration');
        console.error('    2. Run `vorion deploy logs -m ' + mode + '` to view logs');
        console.error('    3. Check Docker daemon is running');
        console.error('    4. Verify ports are not in use');

        if (options.showLogs) {
          await showFailedServiceLogs(modeConfig.file, [...modeConfig.requiredServices]);
        }

        process.exit(code ?? 1);
      }
    });

    proc.on('error', (error) => {
      console.error(`\n  \x1b[31mError: Failed to start deployment\x1b[0m`);
      console.error(`  ${error.message}`);
      console.error('\n  Make sure Docker is running and you have permissions.');
      process.exit(1);
    });
  });

// Add validate subcommand
deployCommand
  .command('validate')
  .description('Validate deployment configuration without starting')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('--env-file <path>', 'Path to environment file')
  .addHelpText(
    'after',
    `
Examples:
  # Validate business deployment
  $ vorion deploy validate

  # Validate enterprise with env file
  $ vorion deploy validate -m enterprise --env-file .env.production
`
  )
  .action(async (options: ValidateOptions) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];

    console.log(`\n  Validating ${mode} deployment configuration\n`);

    // Validate compose file
    const composeValidation = await validateComposeFile(modeConfig.file, options.envFile);
    if (!composeValidation.valid) {
      console.error('  \x1b[31mFAIL\x1b[0m  Compose file:');
      for (const error of composeValidation.errors) {
        console.error(`         ${error}`);
      }
    } else {
      console.log('  \x1b[32mPASS\x1b[0m  Compose file syntax valid');
    }

    // Check environment
    const envValidation = await checkRequiredEnvVars(mode, options.envFile);
    if (!envValidation.valid) {
      console.error('  \x1b[31mFAIL\x1b[0m  Missing environment variables:');
      for (const missing of envValidation.missing) {
        console.error(`         - ${missing}`);
      }
    } else if (envValidation.warnings.length > 0) {
      for (const warning of envValidation.warnings) {
        console.log(`  \x1b[33mWARN\x1b[0m  ${warning}`);
      }
    } else {
      console.log('  \x1b[32mPASS\x1b[0m  Environment variables configured');
    }

    // Show config preview
    console.log('\n  Services that will be started:');
    for (const service of modeConfig.requiredServices) {
      console.log(`    - ${service}`);
    }
    if (modeConfig.optionalServices.length > 0) {
      console.log('\n  Optional services (use --profile to enable):');
      for (const service of modeConfig.optionalServices) {
        console.log(`    - ${service}`);
      }
    }

    console.log();

    if (!composeValidation.valid || !envValidation.valid) {
      process.exit(1);
    }
  });

// Add subcommands for deployment management
deployCommand
  .command('stop')
  .description('Stop a running deployment')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('--remove-orphans', 'Remove containers for services not defined in the compose file')
  .option('-t, --timeout <seconds>', 'Timeout for stopping in seconds', '30')
  .addHelpText('after', `
Examples:
  $ vorion deploy stop
  $ vorion deploy stop -m enterprise
`)
  .action(async (options: StopOptions) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];
    const args = ['-f', modeConfig.file, 'stop', '-t', options.timeout];

    if (options.removeOrphans) {
      args.push('--remove-orphans');
    }

    console.log(`\n  Stopping ${mode} deployment...`);
    const proc = runDockerCompose(args);
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('  \x1b[32mDeployment stopped.\x1b[0m\n');
      }
      process.exit(code ?? 0);
    });
  });

deployCommand
  .command('down')
  .description('Stop and remove containers')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('-v, --volumes', 'Remove volumes (WARNING: destroys data)', false)
  .option('--remove-orphans', 'Remove containers for services not defined in the compose file')
  .option('-t, --timeout <seconds>', 'Timeout for stopping in seconds', '30')
  .addHelpText('after', `
Examples:
  $ vorion deploy down
  $ vorion deploy down -m enterprise -v  # WARNING: removes all data!
`)
  .action(async (options: DownOptions) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];
    const args = ['-f', modeConfig.file, 'down', '-t', options.timeout];

    if (options.volumes) {
      args.push('-v');
      console.log('\n  \x1b[33mWarning: This will remove all data volumes!\x1b[0m');
    }

    if (options.removeOrphans) {
      args.push('--remove-orphans');
    }

    console.log(`\n  Stopping and removing ${mode} deployment...`);
    const proc = runDockerCompose(args);
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('  \x1b[32mDeployment removed.\x1b[0m\n');
      }
      process.exit(code ?? 0);
    });
  });

deployCommand
  .command('logs')
  .description('View deployment logs')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('-f, --follow', 'Follow log output', false)
  .option('-t, --tail <lines>', 'Number of lines to show from the end', '100')
  .option('--service <service>', 'Show logs for specific service')
  .option('--since <duration>', 'Show logs since duration (e.g., 10m, 1h)')
  .addHelpText('after', `
Examples:
  $ vorion deploy logs
  $ vorion deploy logs -f                    # Follow logs
  $ vorion deploy logs --service vorion      # Specific service
  $ vorion deploy logs --since 30m           # Last 30 minutes
`)
  .action(async (options: LogsOptions) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];
    const args = ['-f', modeConfig.file, 'logs'];

    if (options.follow) {
      args.push('-f');
    }

    args.push('--tail', options.tail);

    if (options.since) {
      args.push('--since', options.since);
    }

    if (options.service) {
      args.push(options.service);
    }

    const proc = runDockerCompose(args);
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

deployCommand
  .command('status')
  .description('Show deployment status')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('--json', 'Output as JSON', false)
  .addHelpText('after', `
Examples:
  $ vorion deploy status
  $ vorion deploy status -m enterprise --json
`)
  .action(async (options: StatusOptions) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];

    if (options.json) {
      const result = await runDockerComposeCapture(['-f', modeConfig.file, 'ps', '--format', 'json']);
      if (result.code === 0) {
        try {
          const services = result.stdout
            .trim()
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l));
          console.log(JSON.stringify(services, null, 2));
        } catch {
          console.log(result.stdout);
        }
      }
      process.exit(result.code);
    }

    console.log(`\n  ${mode} deployment status:\n`);
    const args = ['-f', modeConfig.file, 'ps', '--format', 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'];

    const proc = runDockerCompose(args);
    proc.on('exit', (code) => {
      console.log();
      process.exit(code ?? 0);
    });
  });

deployCommand
  .command('restart')
  .description('Restart deployment services')
  .option('-m, --mode <mode>', 'Deployment mode', 'business')
  .option('--service <service>', 'Restart specific service only')
  .option('-t, --timeout <seconds>', 'Timeout for stopping in seconds', '30')
  .addHelpText('after', `
Examples:
  $ vorion deploy restart
  $ vorion deploy restart --service vorion
`)
  .action(async (options: { mode: string; service?: string; timeout: string }) => {
    const mode = options.mode as DeploymentMode;
    if (!(mode in DEPLOYMENT_MODES)) {
      console.error(`Error: Invalid deployment mode: ${mode}`);
      process.exit(1);
    }

    const modeConfig = DEPLOYMENT_MODES[mode];
    const args = ['-f', modeConfig.file, 'restart', '-t', options.timeout];

    if (options.service) {
      args.push(options.service);
      console.log(`\n  Restarting ${options.service}...`);
    } else {
      console.log(`\n  Restarting ${mode} deployment...`);
    }

    const proc = runDockerCompose(args);
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('  \x1b[32mRestart complete.\x1b[0m\n');
      }
      process.exit(code ?? 0);
    });
  });
