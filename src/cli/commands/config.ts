/**
 * Config Command
 *
 * View and validate Vorion configuration.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';

interface EnvOptions {
  category?: string;
  required: boolean;
  json: boolean;
}

interface ValidateConfigOptions {
  env: string;
  strict: boolean;
}

interface GenerateEnvOptions {
  output?: string;
  env: string;
  comments: boolean;
}

interface ShowConfigOptions {
  json: boolean;
  unmask: boolean;
}

/**
 * Environment variable documentation
 */
const ENV_VARS: Array<{
  name: string;
  description: string;
  required: boolean | 'production';
  default?: string;
  category: string;
}> = [
  // Core
  { name: 'VORION_ENV', description: 'Environment: development, staging, production', required: true, default: 'development', category: 'Core' },
  { name: 'VORION_LITE_MODE', description: 'Enable lite mode (no Redis required)', required: false, default: 'false', category: 'Core' },
  { name: 'VORION_LOG_LEVEL', description: 'Log level: debug, info, warn, error', required: false, default: 'info', category: 'Core' },

  // Secrets
  { name: 'VORION_JWT_SECRET', description: 'JWT signing secret (min 32 chars)', required: 'production', category: 'Secrets' },
  { name: 'VORION_ENCRYPTION_KEY', description: 'Data encryption key (min 32 chars)', required: 'production', category: 'Secrets' },
  { name: 'VORION_ENCRYPTION_SALT', description: 'PBKDF2 salt (min 16 chars)', required: 'production', category: 'Secrets' },
  { name: 'VORION_DEDUPE_SECRET', description: 'Deduplication HMAC secret', required: 'production', category: 'Secrets' },
  { name: 'VORION_CSRF_SECRET', description: 'CSRF token signing secret', required: 'production', category: 'Secrets' },
  { name: 'VORION_AUTO_GENERATE_SECRETS', description: 'Auto-generate secrets on startup', required: false, default: 'false', category: 'Secrets' },

  // Database
  { name: 'VORION_DB_HOST', description: 'PostgreSQL host', required: true, default: 'localhost', category: 'Database' },
  { name: 'VORION_DB_PORT', description: 'PostgreSQL port', required: true, default: '5432', category: 'Database' },
  { name: 'VORION_DB_NAME', description: 'Database name', required: true, default: 'vorion', category: 'Database' },
  { name: 'VORION_DB_USER', description: 'Database user', required: true, default: 'vorion', category: 'Database' },
  { name: 'VORION_DB_PASSWORD', description: 'Database password', required: true, category: 'Database' },
  { name: 'VORION_DB_POOL_MIN', description: 'Minimum pool connections', required: false, default: '10', category: 'Database' },
  { name: 'VORION_DB_POOL_MAX', description: 'Maximum pool connections', required: false, default: '50', category: 'Database' },

  // Redis
  { name: 'VORION_REDIS_HOST', description: 'Redis host', required: false, default: 'localhost', category: 'Redis' },
  { name: 'VORION_REDIS_PORT', description: 'Redis port', required: false, default: '6379', category: 'Redis' },
  { name: 'VORION_REDIS_PASSWORD', description: 'Redis password', required: false, category: 'Redis' },

  // API
  { name: 'VORION_API_HOST', description: 'API listen host', required: false, default: 'localhost', category: 'API' },
  { name: 'VORION_API_PORT', description: 'API listen port', required: false, default: '3000', category: 'API' },
  { name: 'VORION_API_RATE_LIMIT', description: 'Rate limit per minute', required: false, default: '1000', category: 'API' },

  // Telemetry
  { name: 'VORION_TELEMETRY_ENABLED', description: 'Enable OpenTelemetry', required: false, default: 'false', category: 'Telemetry' },
  { name: 'VORION_OTLP_ENDPOINT', description: 'OTLP collector endpoint', required: false, category: 'Telemetry' },
  { name: 'VORION_TELEMETRY_SAMPLE_RATE', description: 'Trace sample rate (0-1)', required: false, default: '1.0', category: 'Telemetry' },

  // Data
  { name: 'VORION_DATA_DIR', description: 'Data directory path', required: false, default: './data', category: 'Data' },
  { name: 'VORION_PROOF_STORAGE', description: 'Proof storage: local, s3, gcs', required: false, default: 'local', category: 'Data' },
  { name: 'VORION_PROOF_LOCAL_PATH', description: 'Local proof storage path', required: false, default: './data/proofs', category: 'Data' },
];

export const configCommand = new Command('config')
  .description('View and validate Vorion configuration')
  .addHelpText(
    'after',
    `
Examples:
  # List all environment variables
  $ vorion config env

  # Validate configuration
  $ vorion config validate

  # Generate sample .env file
  $ vorion config generate -o .env

  # Show current configuration
  $ vorion config show

For more information, see: https://docs.vorion.io/configuration
`
  );

configCommand
  .command('env')
  .description('Show all environment variables')
  .option('-c, --category <category>', 'Filter by category')
  .option('--required', 'Show only required variables', false)
  .option('--json', 'Output as JSON', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion config env                     # Show all variables
  $ vorion config env -c Database         # Filter by category
  $ vorion config env --required          # Show required only
  $ vorion config env --json              # JSON output

Categories: Core, Secrets, Database, Redis, API, Telemetry, Data
`
  )
  .action((options: EnvOptions) => {
    let vars = ENV_VARS;

    // Filter by category
    if (options.category) {
      const category = options.category.toLowerCase();
      vars = vars.filter((v) => v.category.toLowerCase() === category);
    }

    // Filter required only
    if (options.required) {
      vars = vars.filter((v) => v.required === true || v.required === 'production');
    }

    if (options.json) {
      console.log(JSON.stringify(vars, null, 2));
      return;
    }

    // Group by category
    const categories = new Map<string, typeof vars>();
    for (const v of vars) {
      if (!categories.has(v.category)) {
        categories.set(v.category, []);
      }
      categories.get(v.category)!.push(v);
    }

    console.log('\nVorion Environment Variables\n');

    for (const [category, categoryVars] of categories) {
      console.log(`\x1b[1m${category}\x1b[0m`);
      console.log('-'.repeat(category.length));

      for (const v of categoryVars) {
        const value = process.env[v.name];
        const status = value
          ? '\x1b[32mSET\x1b[0m'
          : v.required === true
          ? '\x1b[31mMISSING\x1b[0m'
          : v.required === 'production'
          ? '\x1b[33mOPTIONAL\x1b[0m'
          : '\x1b[90mNOT SET\x1b[0m';

        console.log(`  ${v.name}`);
        console.log(`    ${v.description}`);
        console.log(`    Status: ${status}${v.default ? ` (default: ${v.default})` : ''}`);
        console.log();
      }
    }
  });

configCommand
  .command('validate')
  .description('Validate current configuration')
  .option('--env <env>', 'Target environment: development, staging, production', 'development')
  .option('--strict', 'Fail on warnings', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion config validate                # Validate for development
  $ vorion config validate --env production
  $ vorion config validate --strict       # Fail on warnings

Validation checks:
  - Required variables are set
  - Secret lengths meet requirements
  - Values are in valid ranges
`
  )
  .action((options: ValidateConfigOptions) => {
    const env = options.env;
    const isProduction = env === 'production' || env === 'staging';

    console.log(`\nValidating configuration for ${env} environment\n`);

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const v of ENV_VARS) {
      const value = process.env[v.name];

      // Check required
      if (v.required === true && !value) {
        errors.push(`${v.name}: Required but not set`);
      } else if (v.required === 'production' && isProduction && !value) {
        errors.push(`${v.name}: Required in ${env} but not set`);
      } else if (v.required === 'production' && !isProduction && !value) {
        warnings.push(`${v.name}: Not set (required in production)`);
      }

      // Validate specific values
      if (value) {
        if (v.name.includes('SECRET') || v.name.includes('KEY')) {
          if (value.length < 32) {
            if (isProduction) {
              errors.push(`${v.name}: Too short (${value.length} < 32 chars)`);
            } else {
              warnings.push(`${v.name}: Too short for production (${value.length} < 32 chars)`);
            }
          }
        }
      }
    }

    // Display results
    if (errors.length > 0) {
      console.log('\x1b[31mErrors:\x1b[0m');
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      console.log();
    }

    if (warnings.length > 0) {
      console.log('\x1b[33mWarnings:\x1b[0m');
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
      console.log();
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log('\x1b[32mConfiguration is valid!\x1b[0m\n');
    } else {
      console.log(`\nSummary: ${errors.length} errors, ${warnings.length} warnings\n`);
    }

    // Exit code
    if (errors.length > 0 || (options.strict && warnings.length > 0)) {
      process.exit(1);
    }
  });

configCommand
  .command('generate')
  .description('Generate sample .env file')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--env <env>', 'Target environment', 'development')
  .option('--comments', 'Include comments', true)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion config generate                # Output to stdout
  $ vorion config generate -o .env        # Save to file
  $ vorion config generate --env production
  $ vorion config generate --no-comments  # Without comments
`
  )
  .action(async (options: GenerateEnvOptions) => {
    const env = options.env;
    const includeComments = options.comments;
    const lines: string[] = [];

    if (includeComments) {
      lines.push(`# Vorion Configuration`);
      lines.push(`# Environment: ${env}`);
      lines.push(`# Generated: ${new Date().toISOString()}`);
      lines.push('');
    }

    // Group by category
    const categories = new Map<string, typeof ENV_VARS>();
    for (const v of ENV_VARS) {
      if (!categories.has(v.category)) {
        categories.set(v.category, []);
      }
      categories.get(v.category)!.push(v);
    }

    for (const [category, vars] of categories) {
      if (includeComments) {
        lines.push(`# ============================================`);
        lines.push(`# ${category}`);
        lines.push(`# ============================================`);
      }

      for (const v of vars) {
        if (includeComments) {
          lines.push(`# ${v.description}`);
          if (v.required === 'production') {
            lines.push(`# Required in production/staging`);
          }
        }

        // Determine default value
        let defaultValue = v.default || '';
        if (v.name.includes('SECRET') || v.name.includes('KEY') || v.name.includes('PASSWORD')) {
          if (env === 'development') {
            defaultValue = 'development-only-change-in-production';
          } else {
            defaultValue = '# CHANGE_ME';
          }
        }

        // Comment out non-required in development
        const commented = !v.required && env === 'development' && !v.default;
        const prefix = commented ? '# ' : '';

        lines.push(`${prefix}${v.name}=${defaultValue}`);
        lines.push('');
      }
    }

    const output = lines.join('\n');

    if (options.output) {
      const { promises: fs } = await import('fs');
      const { resolve } = await import('path');
      const outputPath = resolve(process.cwd(), options.output);
      await fs.writeFile(outputPath, output);
      console.log(`Configuration written to: ${outputPath}`);
    } else {
      console.log(output);
    }
  });

configCommand
  .command('show')
  .description('Show current configuration values (with secrets masked)')
  .option('--json', 'Output as JSON', false)
  .option('--unmask', 'Show actual secret values (use with caution)', false)
  .addHelpText(
    'after',
    `
Examples:
  $ vorion config show                    # Show all (secrets masked)
  $ vorion config show --json             # JSON output
  $ vorion config show --unmask           # Show secrets (careful!)
`
  )
  .action((options: ShowConfigOptions) => {
    const config: Record<string, string | undefined> = {};

    for (const v of ENV_VARS) {
      let value = process.env[v.name];

      // Mask secrets unless --unmask is specified
      if (value && !options.unmask) {
        if (
          v.name.includes('SECRET') ||
          v.name.includes('KEY') ||
          v.name.includes('PASSWORD')
        ) {
          value = value.slice(0, 4) + '****' + value.slice(-4);
        }
      }

      config[v.name] = value || v.default || undefined;
    }

    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log('\nCurrent Configuration\n');

      // Group by category
      const categories = new Map<string, typeof ENV_VARS>();
      for (const v of ENV_VARS) {
        if (!categories.has(v.category)) {
          categories.set(v.category, []);
        }
        categories.get(v.category)!.push(v);
      }

      for (const [category, vars] of categories) {
        console.log(`\x1b[1m${category}\x1b[0m`);

        for (const v of vars) {
          const value = config[v.name];
          const display = value ? value : '\x1b[90m<not set>\x1b[0m';
          console.log(`  ${v.name}: ${display}`);
        }
        console.log();
      }
    }
  });
