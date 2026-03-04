/**
 * Doctor Command
 *
 * Diagnostic tool to check Vorion deployment health and configuration.
 * Verifies dependencies, connections, and configuration validity.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { calculateEntropy, validateSecret } from '../../common/secret-generator.js';

interface DoctorOptions {
  envFile?: string;
  verbose: boolean;
  json: boolean;
  fix: boolean;
}

interface CheckResult {
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  details?: string;
  fix?: string;
}

/**
 * Check if a command exists
 */
async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [command], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Get command version
 */
async function getCommandVersion(command: string, versionFlag = '--version'): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command, [versionFlag], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0 && output) {
        // Extract version number from output
        const match = output.match(/\d+\.\d+(?:\.\d+)?/);
        resolve(match ? match[0] : output.trim().split('\n')[0]);
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

/**
 * Check PostgreSQL connection
 */
async function checkPostgres(envVars: Record<string, string>): Promise<CheckResult> {
  const host = envVars['VORION_DB_HOST'];
  const port = envVars['VORION_DB_PORT'];
  const user = envVars['VORION_DB_USER'];
  const password = envVars['VORION_DB_PASSWORD'];
  const dbName = envVars['VORION_DB_NAME'];

  if (envVars['VORION_DB_EMBEDDED'] === 'true') {
    return {
      name: 'PostgreSQL Connection',
      category: 'Database',
      status: 'skip',
      message: 'Using embedded database',
      details: 'Embedded SQLite database is configured',
    };
  }

  if (!host || !port || !user || !dbName) {
    return {
      name: 'PostgreSQL Connection',
      category: 'Database',
      status: 'fail',
      message: 'Missing database configuration',
      fix: 'Run `vorion init` to configure database settings',
    };
  }

  // Try to connect using psql or pg_isready
  const pgIsReadyExists = await commandExists('pg_isready');
  if (!pgIsReadyExists) {
    return {
      name: 'PostgreSQL Connection',
      category: 'Database',
      status: 'warn',
      message: 'Cannot verify connection (pg_isready not found)',
      details: `Configured: ${host}:${port}/${dbName}`,
      fix: 'Install PostgreSQL client tools to enable connection testing',
    };
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PGPASSWORD: password || '',
    };
    const proc = spawn('pg_isready', ['-h', host, '-p', port, '-U', user, '-d', dbName], {
      env,
      stdio: 'pipe',
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          name: 'PostgreSQL Connection',
          category: 'Database',
          status: 'pass',
          message: 'Connection successful',
          details: `${host}:${port}/${dbName}`,
        });
      } else {
        resolve({
          name: 'PostgreSQL Connection',
          category: 'Database',
          status: 'fail',
          message: 'Connection failed',
          details: output.trim() || `Cannot connect to ${host}:${port}`,
          fix: 'Verify database is running and credentials are correct',
        });
      }
    });

    proc.on('error', () => {
      resolve({
        name: 'PostgreSQL Connection',
        category: 'Database',
        status: 'fail',
        message: 'Connection check failed',
        fix: 'Verify database configuration',
      });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        name: 'PostgreSQL Connection',
        category: 'Database',
        status: 'fail',
        message: 'Connection timeout',
        details: `Timeout connecting to ${host}:${port}`,
        fix: 'Check network connectivity and firewall rules',
      });
    }, 5000);
  });
}

/**
 * Check Redis connection
 */
async function checkRedis(envVars: Record<string, string>): Promise<CheckResult> {
  const enabled = envVars['VORION_REDIS_ENABLED'];
  const host = envVars['VORION_REDIS_HOST'];
  const port = envVars['VORION_REDIS_PORT'] || '6379';
  const password = envVars['VORION_REDIS_PASSWORD'];

  if (enabled === 'false' || envVars['VORION_LITE_MODE'] === 'true') {
    return {
      name: 'Redis Connection',
      category: 'Cache',
      status: 'skip',
      message: 'Using in-memory cache',
      details: 'Redis is not required in lite mode',
    };
  }

  if (!host) {
    return {
      name: 'Redis Connection',
      category: 'Cache',
      status: 'fail',
      message: 'Missing Redis configuration',
      fix: 'Run `vorion init` to configure Redis settings',
    };
  }

  // Try to connect using redis-cli
  const redisCliExists = await commandExists('redis-cli');
  if (!redisCliExists) {
    return {
      name: 'Redis Connection',
      category: 'Cache',
      status: 'warn',
      message: 'Cannot verify connection (redis-cli not found)',
      details: `Configured: ${host}:${port}`,
      fix: 'Install Redis client tools to enable connection testing',
    };
  }

  return new Promise((resolve) => {
    const args = ['-h', host, '-p', port];
    if (password) {
      args.push('-a', password);
    }
    args.push('--no-auth-warning', 'PING');

    const proc = spawn('redis-cli', args, { stdio: 'pipe' });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && output.trim() === 'PONG') {
        resolve({
          name: 'Redis Connection',
          category: 'Cache',
          status: 'pass',
          message: 'Connection successful',
          details: `${host}:${port}`,
        });
      } else {
        resolve({
          name: 'Redis Connection',
          category: 'Cache',
          status: 'fail',
          message: 'Connection failed',
          details: output.trim() || `Cannot connect to ${host}:${port}`,
          fix: 'Verify Redis is running and credentials are correct',
        });
      }
    });

    proc.on('error', () => {
      resolve({
        name: 'Redis Connection',
        category: 'Cache',
        status: 'fail',
        message: 'Connection check failed',
        fix: 'Verify Redis configuration',
      });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        name: 'Redis Connection',
        category: 'Cache',
        status: 'fail',
        message: 'Connection timeout',
        details: `Timeout connecting to ${host}:${port}`,
        fix: 'Check network connectivity and firewall rules',
      });
    }, 5000);
  });
}

/**
 * Check secret entropy and validity
 */
function checkSecrets(envVars: Record<string, string>): CheckResult[] {
  const results: CheckResult[] = [];

  const secrets = [
    { name: 'JWT Secret', envVar: 'VORION_JWT_SECRET', minLength: 32 },
    { name: 'Encryption Key', envVar: 'VORION_ENCRYPTION_KEY', minLength: 32 },
    { name: 'Encryption Salt', envVar: 'VORION_ENCRYPTION_SALT', minLength: 16 },
    { name: 'Dedupe Secret', envVar: 'VORION_DEDUPE_SECRET', minLength: 32 },
    { name: 'CSRF Secret', envVar: 'VORION_CSRF_SECRET', minLength: 32 },
  ];

  for (const secret of secrets) {
    const value = envVars[secret.envVar];

    if (!value) {
      results.push({
        name: secret.name,
        category: 'Secrets',
        status: 'fail',
        message: 'Not configured',
        fix: `Run \`vorion secrets generate -o .env\` to generate ${secret.name.toLowerCase()}`,
      });
      continue;
    }

    // Check for placeholder values
    if (value.includes('CHANGE_ME') || value.includes('change_me')) {
      results.push({
        name: secret.name,
        category: 'Secrets',
        status: 'fail',
        message: 'Using placeholder value',
        fix: `Run \`vorion secrets generate\` to generate a secure ${secret.name.toLowerCase()}`,
      });
      continue;
    }

    // Validate the secret
    const validation = validateSecret(value, secret.name, secret.minLength);
    if (!validation.valid) {
      results.push({
        name: secret.name,
        category: 'Secrets',
        status: 'fail',
        message: validation.error || 'Invalid secret',
        fix: `Run \`vorion secrets generate\` to generate a new ${secret.name.toLowerCase()}`,
      });
      continue;
    }

    // Check entropy
    const entropy = calculateEntropy(value);
    if (entropy < 128) {
      results.push({
        name: secret.name,
        category: 'Secrets',
        status: 'warn',
        message: `Low entropy (${Math.floor(entropy)} bits)`,
        details: 'Secrets should have at least 128 bits of entropy',
        fix: `Run \`vorion secrets generate\` to generate a stronger ${secret.name.toLowerCase()}`,
      });
      continue;
    }

    results.push({
      name: secret.name,
      category: 'Secrets',
      status: 'pass',
      message: 'Valid',
      details: `Entropy: ${Math.floor(entropy)} bits, Length: ${value.length} chars`,
    });
  }

  return results;
}

/**
 * Check configuration schema validity
 */
function checkConfigSchema(envVars: Record<string, string>): CheckResult[] {
  const results: CheckResult[] = [];

  // Check environment
  const env = envVars['VORION_ENV'];
  if (!env) {
    results.push({
      name: 'Environment',
      category: 'Config',
      status: 'warn',
      message: 'Not set, defaulting to development',
      fix: 'Set VORION_ENV to development, staging, or production',
    });
  } else if (!['development', 'staging', 'production'].includes(env)) {
    results.push({
      name: 'Environment',
      category: 'Config',
      status: 'warn',
      message: `Unknown environment: ${env}`,
      fix: 'Set VORION_ENV to development, staging, or production',
    });
  } else {
    results.push({
      name: 'Environment',
      category: 'Config',
      status: 'pass',
      message: env,
    });
  }

  // Check API port
  const port = parseInt(envVars['VORION_API_PORT'] || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    results.push({
      name: 'API Port',
      category: 'Config',
      status: 'fail',
      message: `Invalid port: ${envVars['VORION_API_PORT']}`,
      fix: 'Set VORION_API_PORT to a valid port number (1-65535)',
    });
  } else if (port < 1024 && process.getuid?.() !== 0) {
    results.push({
      name: 'API Port',
      category: 'Config',
      status: 'warn',
      message: `Port ${port} requires root privileges`,
      fix: 'Use a port >= 1024 or run with elevated privileges',
    });
  } else {
    results.push({
      name: 'API Port',
      category: 'Config',
      status: 'pass',
      message: `${port}`,
    });
  }

  // Check log level
  const logLevel = envVars['VORION_LOG_LEVEL'];
  if (logLevel && !['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    results.push({
      name: 'Log Level',
      category: 'Config',
      status: 'warn',
      message: `Unknown log level: ${logLevel}`,
      fix: 'Set VORION_LOG_LEVEL to debug, info, warn, or error',
    });
  }

  return results;
}

/**
 * Check system dependencies
 */
async function checkDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 20) {
    results.push({
      name: 'Node.js',
      category: 'Dependencies',
      status: 'fail',
      message: `Version ${nodeVersion} is too old`,
      details: 'Vorion requires Node.js 20.0.0 or higher',
      fix: 'Upgrade Node.js to version 20 or higher',
    });
  } else {
    results.push({
      name: 'Node.js',
      category: 'Dependencies',
      status: 'pass',
      message: nodeVersion,
    });
  }

  // Check Docker
  const dockerExists = await commandExists('docker');
  if (!dockerExists) {
    results.push({
      name: 'Docker',
      category: 'Dependencies',
      status: 'warn',
      message: 'Not found',
      details: 'Docker is required for containerized deployments',
      fix: 'Install Docker from https://docs.docker.com/get-docker/',
    });
  } else {
    const dockerVersion = await getCommandVersion('docker');
    results.push({
      name: 'Docker',
      category: 'Dependencies',
      status: 'pass',
      message: dockerVersion || 'Installed',
    });
  }

  // Check Docker Compose
  const composeExists = await commandExists('docker');
  if (composeExists) {
    // Check for docker compose v2
    const composeV2 = await new Promise<boolean>((resolve) => {
      const proc = spawn('docker', ['compose', 'version'], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });

    if (composeV2) {
      const version = await getCommandVersion('docker', 'compose version');
      results.push({
        name: 'Docker Compose',
        category: 'Dependencies',
        status: 'pass',
        message: version || 'v2',
      });
    } else {
      // Check for docker-compose v1
      const v1Exists = await commandExists('docker-compose');
      if (v1Exists) {
        results.push({
          name: 'Docker Compose',
          category: 'Dependencies',
          status: 'warn',
          message: 'v1 (deprecated)',
          fix: 'Upgrade to Docker Compose v2',
        });
      } else {
        results.push({
          name: 'Docker Compose',
          category: 'Dependencies',
          status: 'warn',
          message: 'Not found',
          fix: 'Install Docker Compose from https://docs.docker.com/compose/install/',
        });
      }
    }
  }

  return results;
}

/**
 * Check file permissions
 */
async function checkFiles(envFile: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check .env file exists and has correct permissions
  if (existsSync(envFile)) {
    const stats = await fs.stat(envFile);
    const mode = stats.mode & 0o777;

    if ((mode & 0o077) !== 0) {
      results.push({
        name: '.env File Permissions',
        category: 'Security',
        status: 'warn',
        message: `File is world-readable (mode: ${mode.toString(8)})`,
        fix: 'Run `chmod 600 .env` to restrict permissions',
      });
    } else {
      results.push({
        name: '.env File Permissions',
        category: 'Security',
        status: 'pass',
        message: `Mode: ${mode.toString(8)}`,
      });
    }
  } else {
    results.push({
      name: '.env File',
      category: 'Security',
      status: 'warn',
      message: 'Not found',
      fix: 'Run `vorion init` to create a configuration file',
    });
  }

  // Check data directory
  const dataDir = './data';
  if (existsSync(dataDir)) {
    results.push({
      name: 'Data Directory',
      category: 'Storage',
      status: 'pass',
      message: 'Exists',
    });
  } else {
    results.push({
      name: 'Data Directory',
      category: 'Storage',
      status: 'warn',
      message: 'Not found',
      details: 'Data directory will be created on first run',
    });
  }

  return results;
}

/**
 * Load environment variables from file
 */
async function loadEnvFile(path: string): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  if (!existsSync(path)) {
    // Return current environment if no file
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('VORION_') && value) {
        vars[key] = value;
      }
    }
    return vars;
  }

  const content = await fs.readFile(path, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      let value = match[2];
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[match[1]] = value;
    }
  }

  // Merge with current environment (env file takes precedence)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VORION_') && value && !vars[key]) {
      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Format check result for display
 */
function formatResult(result: CheckResult, verbose: boolean): string {
  const statusColors: Record<string, string> = {
    pass: '\x1b[32m',
    warn: '\x1b[33m',
    fail: '\x1b[31m',
    skip: '\x1b[90m',
  };

  const statusIcons: Record<string, string> = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
    skip: 'SKIP',
  };

  const reset = '\x1b[0m';
  const color = statusColors[result.status];
  const icon = statusIcons[result.status];

  let output = `  ${color}${icon}${reset}  ${result.name}: ${result.message}`;

  if (verbose && result.details) {
    output += `\n       ${result.details}`;
  }

  if (result.fix && (result.status === 'fail' || result.status === 'warn')) {
    output += `\n       \x1b[36mFix: ${result.fix}${reset}`;
  }

  return output;
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose Vorion configuration and dependencies')
  .option('-e, --env-file <path>', 'Path to .env file', '.env')
  .option('-v, --verbose', 'Show detailed output', false)
  .option('--json', 'Output results as JSON', false)
  .option('--fix', 'Attempt to fix issues automatically', false)
  .addHelpText(
    'after',
    `
Examples:
  # Run all diagnostics
  $ vorion doctor

  # Verbose output with details
  $ vorion doctor -v

  # Check specific env file
  $ vorion doctor -e .env.production

  # Output as JSON for scripting
  $ vorion doctor --json

For more information, see: https://docs.vorion.io/troubleshooting/doctor
`
  )
  .action(async (options: DoctorOptions) => {
    const envFile = resolve(process.cwd(), options.envFile || '.env');
    const allResults: CheckResult[] = [];

    if (!options.json) {
      console.log('\n  Vorion Doctor');
      console.log('  =============\n');
      console.log(`  Checking configuration from: ${envFile}\n`);
    }

    // Load environment
    const envVars = await loadEnvFile(envFile);

    // Run all checks
    const categories = [
      { name: 'Dependencies', fn: () => checkDependencies() },
      { name: 'Files', fn: () => checkFiles(envFile) },
      { name: 'Config', fn: () => Promise.resolve(checkConfigSchema(envVars)) },
      { name: 'Secrets', fn: () => Promise.resolve(checkSecrets(envVars)) },
      { name: 'Database', fn: () => checkPostgres(envVars).then((r) => [r]) },
      { name: 'Cache', fn: () => checkRedis(envVars).then((r) => [r]) },
    ];

    for (const category of categories) {
      if (!options.json) {
        console.log(`  ${category.name}`);
        console.log('  ' + '-'.repeat(category.name.length));
      }

      const results = await category.fn();
      allResults.push(...results);

      if (!options.json) {
        for (const result of results) {
          console.log(formatResult(result, options.verbose));
        }
        console.log();
      }
    }

    // Summary
    const passed = allResults.filter((r) => r.status === 'pass').length;
    const warnings = allResults.filter((r) => r.status === 'warn').length;
    const failed = allResults.filter((r) => r.status === 'fail').length;
    const skipped = allResults.filter((r) => r.status === 'skip').length;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            results: allResults,
            summary: { passed, warnings, failed, skipped },
            healthy: failed === 0,
          },
          null,
          2
        )
      );
    } else {
      console.log('  Summary');
      console.log('  -------');
      console.log(`  \x1b[32m${passed} passed\x1b[0m, \x1b[33m${warnings} warnings\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[90m${skipped} skipped\x1b[0m`);
      console.log();

      if (failed > 0) {
        console.log('  \x1b[31mConfiguration has errors that must be fixed.\x1b[0m');
        console.log('  Run with -v for more details and fix suggestions.\n');
        process.exit(1);
      } else if (warnings > 0) {
        console.log('  \x1b[33mConfiguration has warnings that should be reviewed.\x1b[0m');
        console.log('  Run with -v for more details.\n');
      } else {
        console.log('  \x1b[32mConfiguration looks good!\x1b[0m\n');
      }
    }
  });
