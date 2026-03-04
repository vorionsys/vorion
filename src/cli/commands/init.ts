/**
 * Init Command
 *
 * Interactive setup wizard for new Vorion deployments.
 * Guides users through configuration and generates a .env file.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import {
  generateSecrets,
  generateEnvFileContent,
  getSecretFingerprint,
  type GeneratedSecrets,
} from '../../common/secret-generator.js';

/**
 * Deployment modes with their descriptions
 */
const DEPLOYMENT_MODES = {
  personal: {
    name: 'Personal',
    description: 'Single user, lite mode with embedded storage',
    features: ['No Redis required', 'SQLite or PostgreSQL', 'Minimal resources'],
    composeFile: 'docker-compose.personal.yml',
  },
  business: {
    name: 'Business',
    description: 'Team deployment with full features',
    features: ['PostgreSQL database', 'Redis caching', 'Standard scaling'],
    composeFile: 'docker-compose.business.yml',
  },
  enterprise: {
    name: 'Enterprise',
    description: 'High-availability with replicas and monitoring',
    features: ['HA PostgreSQL', 'Redis cluster', 'Load balancing', 'Observability'],
    composeFile: 'docker-compose.enterprise.yml',
  },
} as const;

type DeploymentMode = keyof typeof DEPLOYMENT_MODES;

/**
 * Configuration collected during setup
 */
interface SetupConfig {
  deploymentMode: DeploymentMode;
  environment: string;
  database: {
    type: 'postgres' | 'embedded';
    host?: string;
    port?: number;
    name?: string;
    user?: string;
    password?: string;
    url?: string;
  };
  redis: {
    type: 'redis' | 'memory';
    host?: string;
    port?: number;
    password?: string;
    url?: string;
  };
  api: {
    host: string;
    port: number;
  };
  secrets: GeneratedSecrets;
}

interface InitOptions {
  output: string;
  force: boolean;
  nonInteractive: boolean;
  mode?: string;
  dbUrl?: string;
  redisUrl?: string;
  skipSecrets: boolean;
}

/**
 * Create a readline interface for prompts
 */
function createPrompt(): {
  ask: (question: string) => Promise<string>;
  askWithDefault: (question: string, defaultValue: string) => Promise<string>;
  askSecret: (question: string) => Promise<string>;
  choose: <T extends string>(question: string, options: T[]) => Promise<T>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
} {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const askWithDefault = async (question: string, defaultValue: string): Promise<string> => {
    const answer = await ask(`${question} [${defaultValue}]: `);
    return answer || defaultValue;
  };

  const askSecret = async (question: string): Promise<string> => {
    // For secrets, we just ask normally but note it will be visible
    const answer = await ask(`${question}: `);
    return answer;
  };

  const choose = async <T extends string>(question: string, options: T[]): Promise<T> => {
    console.log(`\n${question}`);
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}) ${opt}`);
    });
    const answer = await ask(`Enter choice (1-${options.length}): `);
    const index = parseInt(answer, 10) - 1;
    if (index >= 0 && index < options.length) {
      return options[index];
    }
    console.log('Invalid choice, using first option');
    return options[0];
  };

  const confirm = async (question: string, defaultValue = true): Promise<boolean> => {
    const defaultStr = defaultValue ? 'Y/n' : 'y/N';
    const answer = await ask(`${question} [${defaultStr}]: `);
    if (!answer) return defaultValue;
    return answer.toLowerCase().startsWith('y');
  };

  return {
    ask,
    askWithDefault,
    askSecret,
    choose,
    confirm,
    close: () => rl.close(),
  };
}

/**
 * Parse a database URL into components
 */
function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
} | null {
  try {
    // postgresql://user:password@host:port/database
    const match = url.match(
      /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/
    );
    if (match) {
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4], 10),
        name: match[5],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a Redis URL into components
 */
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
} | null {
  try {
    // redis://[:password@]host:port
    const match = url.match(/^redis:\/\/(?::([^@]+)@)?([^:]+):(\d+)/);
    if (match) {
      return {
        password: match[1],
        host: match[2],
        port: parseInt(match[3], 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate the configuration
 */
function validateConfig(config: SetupConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate database config for non-embedded
  if (config.database.type === 'postgres') {
    if (!config.database.host) {
      errors.push('Database host is required');
    }
    if (!config.database.port || config.database.port < 1 || config.database.port > 65535) {
      errors.push('Database port must be between 1 and 65535');
    }
    if (!config.database.name) {
      errors.push('Database name is required');
    }
    if (!config.database.user) {
      errors.push('Database user is required');
    }
  }

  // Validate Redis config for non-memory
  if (config.redis.type === 'redis') {
    if (!config.redis.host) {
      errors.push('Redis host is required');
    }
    if (!config.redis.port || config.redis.port < 1 || config.redis.port > 65535) {
      errors.push('Redis port must be between 1 and 65535');
    }
  }

  // Validate API config
  if (config.api.port < 1 || config.api.port > 65535) {
    errors.push('API port must be between 1 and 65535');
  }

  // Validate secrets
  const requiredSecrets: (keyof GeneratedSecrets)[] = [
    'jwtSecret',
    'encryptionKey',
    'encryptionSalt',
    'dedupeSecret',
    'csrfSecret',
  ];

  for (const key of requiredSecrets) {
    const value = config.secrets[key];
    if (!value || typeof value !== 'string' || (value as string).length < 16) {
      errors.push(`Secret ${key} is missing or too short`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate .env file content from config
 */
function generateEnvFromConfig(config: SetupConfig): string {
  const lines: string[] = [
    '# Vorion Configuration',
    `# Generated: ${new Date().toISOString()}`,
    `# Deployment Mode: ${config.deploymentMode}`,
    '',
    '# =============================================================================',
    '# ENVIRONMENT',
    '# =============================================================================',
    '',
    `VORION_ENV=${config.environment}`,
    `VORION_LITE_MODE=${config.deploymentMode === 'personal' ? 'true' : 'false'}`,
    'VORION_LOG_LEVEL=info',
    '',
    '# =============================================================================',
    '# API CONFIGURATION',
    '# =============================================================================',
    '',
    `VORION_API_HOST=${config.api.host}`,
    `VORION_API_PORT=${config.api.port}`,
    '',
    '# =============================================================================',
    '# DATABASE',
    '# =============================================================================',
    '',
  ];

  if (config.database.type === 'embedded') {
    lines.push('# Using embedded database (SQLite)');
    lines.push('VORION_DB_EMBEDDED=true');
  } else {
    lines.push(`VORION_DB_HOST=${config.database.host}`);
    lines.push(`VORION_DB_PORT=${config.database.port}`);
    lines.push(`VORION_DB_NAME=${config.database.name}`);
    lines.push(`VORION_DB_USER=${config.database.user}`);
    lines.push(`VORION_DB_PASSWORD=${config.database.password || ''}`);
  }

  lines.push('');
  lines.push('# =============================================================================');
  lines.push('# REDIS');
  lines.push('# =============================================================================');
  lines.push('');

  if (config.redis.type === 'memory') {
    lines.push('# Using in-memory cache (no Redis)');
    lines.push('VORION_REDIS_ENABLED=false');
  } else {
    lines.push(`VORION_REDIS_HOST=${config.redis.host}`);
    lines.push(`VORION_REDIS_PORT=${config.redis.port}`);
    if (config.redis.password) {
      lines.push(`VORION_REDIS_PASSWORD=${config.redis.password}`);
    }
  }

  lines.push('');
  lines.push('# =============================================================================');
  lines.push('# SECRETS');
  lines.push('# =============================================================================');
  lines.push('# WARNING: Keep these secrets secure! Do not commit to version control.');
  lines.push('');
  lines.push(`VORION_JWT_SECRET=${config.secrets.jwtSecret}`);
  lines.push(`VORION_ENCRYPTION_KEY=${config.secrets.encryptionKey}`);
  lines.push(`VORION_ENCRYPTION_SALT=${config.secrets.encryptionSalt}`);
  lines.push(`VORION_DEDUPE_SECRET=${config.secrets.dedupeSecret}`);
  lines.push(`VORION_CSRF_SECRET=${config.secrets.csrfSecret}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Run non-interactive setup
 */
async function runNonInteractiveSetup(options: InitOptions): Promise<SetupConfig> {
  const mode = (options.mode || 'business') as DeploymentMode;

  const config: SetupConfig = {
    deploymentMode: mode,
    environment: mode === 'personal' ? 'development' : 'production',
    database: { type: 'postgres' },
    redis: { type: mode === 'personal' ? 'memory' : 'redis' },
    api: { host: '0.0.0.0', port: 3000 },
    secrets: options.skipSecrets
      ? {
          jwtSecret: '',
          encryptionKey: '',
          encryptionSalt: '',
          dedupeSecret: '',
          csrfSecret: '',
          generatedAt: '',
          version: 1,
        }
      : generateSecrets(),
  };

  // Parse database URL if provided
  if (options.dbUrl) {
    if (options.dbUrl === 'embedded') {
      config.database = { type: 'embedded' };
    } else {
      const parsed = parseDatabaseUrl(options.dbUrl);
      if (parsed) {
        config.database = { type: 'postgres', ...parsed };
      } else {
        throw new Error(`Invalid database URL: ${options.dbUrl}`);
      }
    }
  } else {
    // Default database config
    config.database = {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'vorion',
      user: 'vorion',
      password: 'vorion_password',
    };
  }

  // Parse Redis URL if provided
  if (options.redisUrl) {
    if (options.redisUrl === 'memory') {
      config.redis = { type: 'memory' };
    } else {
      const parsed = parseRedisUrl(options.redisUrl);
      if (parsed) {
        config.redis = { type: 'redis', ...parsed };
      } else {
        throw new Error(`Invalid Redis URL: ${options.redisUrl}`);
      }
    }
  } else if (mode !== 'personal') {
    config.redis = {
      type: 'redis',
      host: 'localhost',
      port: 6379,
    };
  }

  return config;
}

/**
 * Run interactive setup wizard
 */
async function runInteractiveSetup(options: InitOptions): Promise<SetupConfig> {
  const prompt = createPrompt();

  try {
    console.log('\n  Welcome to Vorion Setup Wizard');
    console.log('  ===============================\n');
    console.log('  This wizard will help you configure Vorion for your deployment.\n');

    // Step 1: Choose deployment mode
    console.log('  Step 1: Deployment Mode');
    console.log('  -----------------------');

    for (const [key, mode] of Object.entries(DEPLOYMENT_MODES)) {
      console.log(`\n  ${key.toUpperCase()}: ${mode.description}`);
      console.log(`    Features: ${mode.features.join(', ')}`);
    }

    const modeChoice = await prompt.choose(
      '\n  Select deployment mode:',
      ['personal', 'business', 'enterprise'] as DeploymentMode[]
    );

    const config: SetupConfig = {
      deploymentMode: modeChoice,
      environment: modeChoice === 'personal' ? 'development' : 'production',
      database: { type: 'postgres' },
      redis: { type: modeChoice === 'personal' ? 'memory' : 'redis' },
      api: { host: '0.0.0.0', port: 3000 },
      secrets: {} as GeneratedSecrets,
    };

    // Step 2: Database configuration
    console.log('\n  Step 2: Database Configuration');
    console.log('  -------------------------------');

    if (modeChoice === 'personal') {
      const useEmbedded = await prompt.confirm(
        '  Use embedded SQLite database? (recommended for personal use)',
        true
      );

      if (useEmbedded) {
        config.database = { type: 'embedded' };
      } else {
        await configurePostgres(prompt, config);
      }
    } else {
      console.log('\n  PostgreSQL is required for business/enterprise deployments.');
      const useUrl = await prompt.confirm('  Do you have a PostgreSQL connection URL?', false);

      if (useUrl) {
        const url = await prompt.ask('  Enter PostgreSQL URL: ');
        const parsed = parseDatabaseUrl(url);
        if (parsed) {
          config.database = { type: 'postgres', url, ...parsed };
        } else {
          console.log('  Invalid URL format. Please enter connection details manually.');
          await configurePostgres(prompt, config);
        }
      } else {
        await configurePostgres(prompt, config);
      }
    }

    // Step 3: Redis configuration
    console.log('\n  Step 3: Redis Configuration');
    console.log('  ----------------------------');

    if (modeChoice === 'personal') {
      const useMemory = await prompt.confirm(
        '  Use in-memory cache? (no Redis required)',
        true
      );

      if (useMemory) {
        config.redis = { type: 'memory' };
      } else {
        await configureRedis(prompt, config);
      }
    } else {
      console.log('\n  Redis is required for business/enterprise deployments.');
      const useUrl = await prompt.confirm('  Do you have a Redis connection URL?', false);

      if (useUrl) {
        const url = await prompt.ask('  Enter Redis URL: ');
        const parsed = parseRedisUrl(url);
        if (parsed) {
          config.redis = { type: 'redis', url, ...parsed };
        } else {
          console.log('  Invalid URL format. Please enter connection details manually.');
          await configureRedis(prompt, config);
        }
      } else {
        await configureRedis(prompt, config);
      }
    }

    // Step 4: API configuration
    console.log('\n  Step 4: API Configuration');
    console.log('  --------------------------');

    config.api.host = await prompt.askWithDefault('  API host', '0.0.0.0');
    const portStr = await prompt.askWithDefault('  API port', '3000');
    config.api.port = parseInt(portStr, 10);

    // Step 5: Secrets generation
    console.log('\n  Step 5: Security Secrets');
    console.log('  -------------------------');

    if (options.skipSecrets) {
      console.log('  Skipping secret generation (--skip-secrets flag)');
      config.secrets = {
        jwtSecret: '',
        encryptionKey: '',
        encryptionSalt: '',
        dedupeSecret: '',
        csrfSecret: '',
        generatedAt: new Date().toISOString(),
        version: 1,
      };
    } else {
      const generateNew = await prompt.confirm(
        '  Generate new secure secrets? (recommended)',
        true
      );

      if (generateNew) {
        console.log('\n  Generating cryptographically secure secrets...');
        config.secrets = generateSecrets();
        console.log('  Secrets generated successfully!');
        console.log('\n  Secret fingerprints (for verification):');
        console.log(`    JWT Secret: ${getSecretFingerprint(config.secrets.jwtSecret)}`);
        console.log(`    Encryption Key: ${getSecretFingerprint(config.secrets.encryptionKey)}`);
        console.log(`    CSRF Secret: ${getSecretFingerprint(config.secrets.csrfSecret)}`);
      } else {
        console.log('\n  You will need to provide secrets manually in the .env file.');
        config.secrets = {
          jwtSecret: 'CHANGE_ME_GENERATE_SECURE_SECRET',
          encryptionKey: 'CHANGE_ME_GENERATE_SECURE_SECRET',
          encryptionSalt: 'CHANGE_ME_GENERATE_SECURE_SECRET',
          dedupeSecret: 'CHANGE_ME_GENERATE_SECURE_SECRET',
          csrfSecret: 'CHANGE_ME_GENERATE_SECURE_SECRET',
          generatedAt: new Date().toISOString(),
          version: 1,
        };
      }
    }

    return config;
  } finally {
    prompt.close();
  }
}

/**
 * Configure PostgreSQL interactively
 */
async function configurePostgres(
  prompt: ReturnType<typeof createPrompt>,
  config: SetupConfig
): Promise<void> {
  config.database.type = 'postgres';
  config.database.host = await prompt.askWithDefault('  Database host', 'localhost');
  const portStr = await prompt.askWithDefault('  Database port', '5432');
  config.database.port = parseInt(portStr, 10);
  config.database.name = await prompt.askWithDefault('  Database name', 'vorion');
  config.database.user = await prompt.askWithDefault('  Database user', 'vorion');
  config.database.password = await prompt.askSecret('  Database password');
}

/**
 * Configure Redis interactively
 */
async function configureRedis(
  prompt: ReturnType<typeof createPrompt>,
  config: SetupConfig
): Promise<void> {
  config.redis.type = 'redis';
  config.redis.host = await prompt.askWithDefault('  Redis host', 'localhost');
  const portStr = await prompt.askWithDefault('  Redis port', '6379');
  config.redis.port = parseInt(portStr, 10);
  const password = await prompt.askSecret('  Redis password (leave empty if none)');
  if (password) {
    config.redis.password = password;
  }
}

export const initCommand = new Command('init')
  .description('Interactive setup wizard for new Vorion deployments')
  .option('-o, --output <path>', 'Output path for .env file', '.env')
  .option('-f, --force', 'Overwrite existing .env file', false)
  .option('-n, --non-interactive', 'Run in non-interactive mode with defaults', false)
  .option('-m, --mode <mode>', 'Deployment mode: personal, business, enterprise')
  .option('--db-url <url>', 'Database URL or "embedded" for SQLite')
  .option('--redis-url <url>', 'Redis URL or "memory" for in-memory cache')
  .option('--skip-secrets', 'Skip secret generation', false)
  .addHelpText(
    'after',
    `
Examples:
  # Interactive setup wizard
  $ vorion init

  # Non-interactive setup for business deployment
  $ vorion init -n -m business --db-url postgresql://user:pass@localhost:5432/vorion

  # Personal deployment with embedded database
  $ vorion init -n -m personal --db-url embedded --redis-url memory

  # Generate config to custom path
  $ vorion init -o config/.env.production

For more information, see: https://docs.vorion.io/getting-started/setup
`
  )
  .action(async (options: InitOptions) => {
    try {
      const outputPath = resolve(process.cwd(), options.output);

      // Check if file exists
      try {
        await fs.access(outputPath);
        if (!options.force) {
          console.error(`\nError: File already exists: ${outputPath}`);
          console.error('Use --force to overwrite.\n');
          process.exit(1);
        }
      } catch {
        // File doesn't exist, safe to proceed
      }

      // Run setup
      let config: SetupConfig;
      if (options.nonInteractive) {
        console.log('\nRunning non-interactive setup...\n');
        config = await runNonInteractiveSetup(options);
      } else {
        config = await runInteractiveSetup(options);
      }

      // Validate configuration
      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error('\nConfiguration validation failed:');
        for (const error of validation.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }

      // Generate .env content
      const envContent = generateEnvFromConfig(config);

      // Write file
      await fs.writeFile(outputPath, envContent, { mode: 0o600 });

      console.log('\n  Setup Complete!');
      console.log('  ===============\n');
      console.log(`  Configuration written to: ${outputPath}`);
      console.log(`  Deployment mode: ${config.deploymentMode}`);
      console.log(`  Database: ${config.database.type === 'embedded' ? 'SQLite (embedded)' : 'PostgreSQL'}`);
      console.log(`  Redis: ${config.redis.type === 'memory' ? 'In-memory cache' : 'Redis'}`);
      console.log('');
      console.log('  Next steps:');
      console.log('  1. Review the generated .env file');
      console.log('  2. Run `vorion doctor` to verify configuration');
      console.log(`  3. Run \`vorion deploy -m ${config.deploymentMode}\` to start Vorion`);
      console.log('');
    } catch (error) {
      console.error(`\nError: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });
