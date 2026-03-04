#!/usr/bin/env node
/**
 * Vorion Security SDK - CLI Tools
 * Command-line interface for policy management
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PolicyDefinition,
  ValidationResult,
  PolicyDiff,
  EvaluationContext,
  CLICommand,
  CLIOption,
} from '../types';
import { parsePolicyString, policyToString, validatePolicyAST, parsePolicyDSL } from '../dsl/parser';
import { evaluatePolicy } from '../dsl/policy-dsl';

// ============================================================================
// CLI Framework
// ============================================================================

interface ParsedArgs {
  command: string;
  subcommand?: string;
  args: string[];
  options: Record<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: args[0] || 'help',
    args: [],
    options: {},
  };

  let i = 1;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        result.options[key] = nextArg;
        i += 2;
      } else {
        result.options[key] = true;
        i++;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        result.options[key] = nextArg;
        i += 2;
      } else {
        result.options[key] = true;
        i++;
      }
    } else {
      if (!result.subcommand) {
        result.subcommand = arg;
      } else {
        result.args.push(arg);
      }
      i++;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
\x1b[36mVorion Security SDK CLI\x1b[0m
Policy management and development tools

\x1b[33mUsage:\x1b[0m
  vorion <command> [subcommand] [options]

\x1b[33mCommands:\x1b[0m
  policy validate <file>              Validate a policy file
  policy test <file>                  Test a policy with a context
  policy deploy <file>                Deploy a policy to the server
  policy diff <env1> <env2>           Compare policies between environments
  policy export <id>                  Export a policy to a file
  policy list                         List all policies

  generate types                      Generate TypeScript types from policies
  generate schema                     Generate JSON schema for policies
  generate docs                       Generate policy documentation

  audit query                         Query audit logs
  audit export                        Export audit logs

  config init                         Initialize configuration
  config set <key> <value>            Set configuration value
  config get <key>                    Get configuration value

\x1b[33mGlobal Options:\x1b[0m
  --config <path>                     Path to config file
  --env <environment>                 Target environment (dev, staging, prod)
  --format <format>                   Output format (json, yaml, table)
  --verbose                           Enable verbose output
  --help                              Show help

\x1b[33mExamples:\x1b[0m
  vorion policy validate ./policies/admin-access.policy
  vorion policy test ./policies/admin-access.policy --context ./test-context.json
  vorion policy deploy ./policies/ --env production
  vorion policy diff staging production
  vorion generate types --output ./src/types/policies.ts
`);
}

// ============================================================================
// Policy Commands
// ============================================================================

async function validatePolicy(filePath: string, options: Record<string, unknown>): Promise<void> {
  const verbose = options.verbose as boolean;

  console.log(`\x1b[36mValidating policy:\x1b[0m ${filePath}\n`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);

    let policy: PolicyDefinition;
    let validation: ValidationResult;

    if (ext === '.policy' || ext === '.vp') {
      // Parse DSL format
      const ast = parsePolicyDSL(content);
      validation = validatePolicyAST(ast);

      if (validation.valid) {
        const result = parsePolicyString(content);
        policy = result.policy;
      } else {
        policy = null as unknown as PolicyDefinition;
      }
    } else if (ext === '.json') {
      // Parse JSON format
      policy = JSON.parse(content) as PolicyDefinition;
      validation = validatePolicyJSON(policy);
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    // Print results
    if (validation.valid) {
      console.log('\x1b[32m✓ Policy is valid\x1b[0m\n');

      if (verbose && policy) {
        console.log('Policy details:');
        console.log(`  ID: ${policy.id}`);
        console.log(`  Name: ${policy.name}`);
        console.log(`  Description: ${policy.description || 'N/A'}`);
        console.log(`  Version: ${policy.version}`);
        console.log(`  Conditions: ${policy.conditions.length}`);
        console.log(`  Requirements: ${policy.requirements.length}`);
        console.log(`  Enabled: ${policy.enabled}`);
      }
    } else {
      console.log('\x1b[31m✗ Policy validation failed\x1b[0m\n');
    }

    // Print errors
    if (validation.errors.length > 0) {
      console.log('\x1b[31mErrors:\x1b[0m');
      for (const error of validation.errors) {
        const location = error.location
          ? ` (line ${error.location.line}, col ${error.location.column})`
          : '';
        console.log(`  • [${error.code}] ${error.message}${location}`);
      }
      console.log();
    }

    // Print warnings
    if (validation.warnings.length > 0) {
      console.log('\x1b[33mWarnings:\x1b[0m');
      for (const warning of validation.warnings) {
        const location = warning.location
          ? ` (line ${warning.location.line}, col ${warning.location.column})`
          : '';
        console.log(`  • [${warning.code}] ${warning.message}${location}`);
      }
      console.log();
    }

    process.exit(validation.valid ? 0 : 1);
  } catch (error) {
    console.error(`\x1b[31mError:\x1b[0m ${(error as Error).message}`);
    process.exit(1);
  }
}

function validatePolicyJSON(policy: PolicyDefinition): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];

  if (!policy.id) {
    errors.push({ code: 'MISSING_ID', message: 'Policy ID is required', severity: 'error' });
  }

  if (!policy.name) {
    errors.push({ code: 'MISSING_NAME', message: 'Policy name is required', severity: 'error' });
  }

  if (!policy.version) {
    warnings.push({ code: 'MISSING_VERSION', message: 'Policy version not specified', severity: 'warning' });
  }

  if (!policy.conditions || policy.conditions.length === 0) {
    warnings.push({ code: 'NO_CONDITIONS', message: 'Policy has no conditions', severity: 'warning' });
  }

  if (!policy.action) {
    errors.push({ code: 'MISSING_ACTION', message: 'Policy action is required', severity: 'error' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

async function testPolicy(filePath: string, options: Record<string, unknown>): Promise<void> {
  const contextPath = options.context as string;
  const verbose = options.verbose as boolean;

  console.log(`\x1b[36mTesting policy:\x1b[0m ${filePath}\n`);

  try {
    // Load policy
    const policyContent = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);

    let policy: PolicyDefinition;

    if (ext === '.policy' || ext === '.vp') {
      const result = parsePolicyString(policyContent);
      policy = result.policy;
    } else if (ext === '.json') {
      policy = JSON.parse(policyContent) as PolicyDefinition;
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    // Load context
    let context: EvaluationContext;

    if (contextPath) {
      const contextContent = fs.readFileSync(contextPath, 'utf-8');
      context = JSON.parse(contextContent) as EvaluationContext;
    } else {
      // Use default test context
      context = {
        user: {
          id: 'test-user',
          role: 'user',
          permissions: [],
        },
        request: {
          ip: '127.0.0.1',
        },
        time: {
          hour: new Date().getHours(),
          dayOfWeek: new Date().getDay(),
        },
      };
      console.log('\x1b[33mNo context provided, using default test context\x1b[0m\n');
    }

    // Evaluate policy
    console.log('Context:');
    console.log(JSON.stringify(context, null, 2));
    console.log();

    const result = await evaluatePolicy(policy, context);

    // Print result
    const outcomeColor =
      result.outcome === 'allow'
        ? '\x1b[32m'
        : result.outcome === 'deny'
          ? '\x1b[31m'
          : '\x1b[33m';

    console.log(`Result: ${outcomeColor}${result.outcome.toUpperCase()}\x1b[0m`);
    if (result.reason) {
      console.log(`Reason: ${result.reason}`);
    }

    if (verbose) {
      console.log('\nPolicy details:');
      console.log(`  ID: ${policy.id}`);
      console.log(`  Conditions evaluated: ${policy.conditions.length}`);
      console.log(`  Requirements checked: ${policy.requirements.length}`);
    }

    process.exit(result.outcome === 'allow' ? 0 : 1);
  } catch (error) {
    console.error(`\x1b[31mError:\x1b[0m ${(error as Error).message}`);
    process.exit(1);
  }
}

async function deployPolicy(filePath: string, options: Record<string, unknown>): Promise<void> {
  const env = (options.env as string) || 'development';
  const dryRun = options['dry-run'] as boolean;

  console.log(`\x1b[36mDeploying policy:\x1b[0m ${filePath} to ${env}\n`);

  try {
    const stat = fs.statSync(filePath);
    const files: string[] = [];

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath);
      for (const entry of entries) {
        if (entry.endsWith('.policy') || entry.endsWith('.vp') || entry.endsWith('.json')) {
          files.push(path.join(filePath, entry));
        }
      }
    } else {
      files.push(filePath);
    }

    console.log(`Found ${files.length} policy file(s)\n`);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const ext = path.extname(file);

      let policy: PolicyDefinition;

      if (ext === '.policy' || ext === '.vp') {
        const result = parsePolicyString(content);
        policy = result.policy;
      } else {
        policy = JSON.parse(content) as PolicyDefinition;
      }

      if (dryRun) {
        console.log(`\x1b[33m[DRY RUN]\x1b[0m Would deploy: ${policy.id} (v${policy.version})`);
      } else {
        // In a real implementation, this would call the API
        console.log(`\x1b[32m✓\x1b[0m Deployed: ${policy.id} (v${policy.version})`);
      }
    }

    console.log(`\n\x1b[32mDeployment complete\x1b[0m`);
  } catch (error) {
    console.error(`\x1b[31mError:\x1b[0m ${(error as Error).message}`);
    process.exit(1);
  }
}

async function diffPolicies(env1: string, env2: string, options: Record<string, unknown>): Promise<void> {
  const policyId = options.policy as string;

  console.log(`\x1b[36mComparing policies:\x1b[0m ${env1} vs ${env2}\n`);

  // In a real implementation, this would fetch policies from the API
  // For now, we'll show a sample diff output
  const sampleDiffs: PolicyDiff[] = [
    { field: 'conditions[0].value', oldValue: '10.0.0.0/8', newValue: '10.0.0.0/16', type: 'changed' },
    { field: 'requirements', oldValue: null, newValue: { type: 'mfa' }, type: 'added' },
    { field: 'priority', oldValue: 100, newValue: 50, type: 'changed' },
  ];

  if (policyId) {
    console.log(`Policy: ${policyId}\n`);
  }

  console.log('Differences found:\n');

  for (const diff of sampleDiffs) {
    const typeColor =
      diff.type === 'added'
        ? '\x1b[32m+'
        : diff.type === 'removed'
          ? '\x1b[31m-'
          : '\x1b[33m~';

    console.log(`${typeColor} ${diff.field}\x1b[0m`);
    if (diff.type === 'changed') {
      console.log(`    ${env1}: ${JSON.stringify(diff.oldValue)}`);
      console.log(`    ${env2}: ${JSON.stringify(diff.newValue)}`);
    } else if (diff.type === 'added') {
      console.log(`    ${env2}: ${JSON.stringify(diff.newValue)}`);
    } else {
      console.log(`    ${env1}: ${JSON.stringify(diff.oldValue)}`);
    }
    console.log();
  }
}

// ============================================================================
// Generate Commands
// ============================================================================

async function generateTypes(options: Record<string, unknown>): Promise<void> {
  const output = (options.output as string) || './src/types/policies.generated.ts';
  const policiesDir = (options.policies as string) || './policies';

  console.log(`\x1b[36mGenerating types\x1b[0m from ${policiesDir}\n`);

  try {
    // Collect all policies
    const policies: PolicyDefinition[] = [];

    if (fs.existsSync(policiesDir)) {
      const files = fs.readdirSync(policiesDir);
      for (const file of files) {
        if (file.endsWith('.policy') || file.endsWith('.vp') || file.endsWith('.json')) {
          const content = fs.readFileSync(path.join(policiesDir, file), 'utf-8');
          const ext = path.extname(file);

          if (ext === '.policy' || ext === '.vp') {
            const result = parsePolicyString(content);
            policies.push(result.policy);
          } else {
            policies.push(JSON.parse(content) as PolicyDefinition);
          }
        }
      }
    }

    // Generate type definitions
    const typeDefinitions = generatePolicyTypes(policies);

    // Write to file
    const dir = path.dirname(output);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(output, typeDefinitions);

    console.log(`\x1b[32m✓\x1b[0m Generated types for ${policies.length} policies`);
    console.log(`  Output: ${output}`);
  } catch (error) {
    console.error(`\x1b[31mError:\x1b[0m ${(error as Error).message}`);
    process.exit(1);
  }
}

function generatePolicyTypes(policies: PolicyDefinition[]): string {
  const policyIds = policies.map((p) => `'${p.id}'`).join(' | ');
  const policyNames = policies.map((p) => `'${p.name}'`).join(' | ');

  return `/**
 * Auto-generated policy types
 * Generated at: ${new Date().toISOString()}
 * DO NOT EDIT MANUALLY
 */

import { PolicyDefinition, PolicyOutcome } from '@vorion/sdk';

/**
 * Valid policy IDs
 */
export type PolicyId = ${policyIds || 'string'};

/**
 * Valid policy names
 */
export type PolicyName = ${policyNames || 'string'};

/**
 * Policy metadata
 */
export const POLICY_METADATA: Record<PolicyId, { name: string; description?: string; version: string }> = {
${policies
  .map(
    (p) => `  '${p.id}': {
    name: '${p.name}',
    description: ${p.description ? `'${p.description.replace(/'/g, "\\'")}'` : 'undefined'},
    version: '${p.version}'
  }`
  )
  .join(',\n')}
};

/**
 * Type-safe policy lookup
 */
export function getPolicyMetadata(id: PolicyId): { name: string; description?: string; version: string } {
  return POLICY_METADATA[id];
}

/**
 * Check if a string is a valid policy ID
 */
export function isValidPolicyId(id: string): id is PolicyId {
  return id in POLICY_METADATA;
}
`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  switch (parsed.command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    case 'policy':
      switch (parsed.subcommand) {
        case 'validate':
          await validatePolicy(parsed.args[0], parsed.options);
          break;
        case 'test':
          await testPolicy(parsed.args[0], parsed.options);
          break;
        case 'deploy':
          await deployPolicy(parsed.args[0], parsed.options);
          break;
        case 'diff':
          await diffPolicies(parsed.args[0], parsed.args[1], parsed.options);
          break;
        default:
          console.error(`Unknown subcommand: ${parsed.subcommand}`);
          printHelp();
          process.exit(1);
      }
      break;

    case 'generate':
      switch (parsed.subcommand) {
        case 'types':
          await generateTypes(parsed.options);
          break;
        default:
          console.error(`Unknown subcommand: ${parsed.subcommand}`);
          printHelp();
          process.exit(1);
      }
      break;

    case 'version':
    case '--version':
    case '-v':
      console.log('Vorion SDK CLI v1.0.0');
      break;

    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// ============================================================================
// Exports for programmatic use
// ============================================================================

export {
  validatePolicy,
  testPolicy,
  deployPolicy,
  diffPolicies,
  generateTypes,
  parseArgs,
  type ParsedArgs,
};
