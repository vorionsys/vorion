/**
 * Secrets Command
 *
 * Generate and manage secrets for Vorion deployment.
 * Supports JWT secrets, encryption keys, and Ed25519 signing keypairs.
 *
 * @packageDocumentation
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { randomBytes, generateKeyPairSync, createPublicKey } from 'crypto';
import {
  generateSecrets,
  generateEnvFileContent,
  loadOrGenerateSecrets,
  validateSecret,
  getSecretFingerprint,
  calculateEntropy,
  type GeneratedSecrets,
} from '../../common/secret-generator.js';

interface GenerateOptions {
  output?: string;
  format: string;
  force: boolean;
  type?: string;
  append: boolean;
}

interface KeypairOptions {
  output?: string;
  format: string;
  force: boolean;
}

/**
 * Generate a 256-bit (32 byte) secret
 */
function generate256BitSecret(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Generate an Ed25519 keypair
 */
function generateEd25519Keypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { publicKey, privateKey };
}

/**
 * Get public key from private key (Ed25519)
 */
function derivePublicKey(privateKeyPem: string): string {
  const publicKey = createPublicKey(privateKeyPem);
  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}

interface InitOptions {
  dataDir: string;
  show: boolean;
}

interface ValidateOptions {
  env: boolean;
  file?: string;
}

interface ShowOptions {
  file?: string;
  dataDir: string;
}

interface RotateOptions {
  file?: string;
  output?: string;
  backup: boolean;
}

/**
 * Format secrets for display (masked)
 */
function formatSecretsForDisplay(secrets: GeneratedSecrets): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string' && key !== 'generatedAt' && key !== 'version') {
      // Show first 8 chars, mask the rest
      result[key] = value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : '****';
    }
  }
  return result;
}

export const secretsCommand = new Command('secrets')
  .description('Generate and manage secrets for Vorion deployment')
  .addHelpText(
    'after',
    `
Examples:
  # Generate all secrets and output to stdout
  $ vorion secrets generate

  # Generate secrets and save to .env file
  $ vorion secrets generate -o .env

  # Generate just a JWT secret (256-bit)
  $ vorion secrets generate --type jwt

  # Generate Ed25519 signing keypair
  $ vorion secrets keypair -o keys/

  # Validate secrets from environment
  $ vorion secrets validate -e

  # Show secret fingerprints
  $ vorion secrets show

For more information, see: https://docs.vorion.io/security/secrets
`
  );

secretsCommand
  .command('generate')
  .description('Generate new secrets (JWT, encryption keys, CSRF tokens)')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('-f, --format <format>', 'Output format: json, env, shell', 'env')
  .option('--force', 'Overwrite existing file', false)
  .option('-t, --type <type>', 'Generate specific type: all, jwt, encryption, csrf (default: all)')
  .option('-a, --append', 'Append to existing file instead of overwriting', false)
  .addHelpText(
    'after',
    `
Examples:
  # Generate all secrets
  $ vorion secrets generate

  # Generate and save to .env
  $ vorion secrets generate -o .env

  # Generate only JWT secret
  $ vorion secrets generate --type jwt

  # Output as JSON
  $ vorion secrets generate -f json

  # Append to existing .env
  $ vorion secrets generate -o .env --append
`
  )
  .action(async (options: GenerateOptions) => {
    try {
      let output: string;
      let secrets: GeneratedSecrets | Record<string, string>;

      // Generate specific type or all
      if (options.type && options.type !== 'all') {
        const singleSecrets: Record<string, string> = {};

        switch (options.type) {
          case 'jwt':
            singleSecrets['VORION_JWT_SECRET'] = generate256BitSecret();
            console.log('\n  Generated 256-bit JWT Secret');
            console.log(`  Entropy: ${Math.floor(calculateEntropy(singleSecrets['VORION_JWT_SECRET']))} bits\n`);
            break;
          case 'encryption':
            singleSecrets['VORION_ENCRYPTION_KEY'] = generate256BitSecret();
            singleSecrets['VORION_ENCRYPTION_SALT'] = randomBytes(16).toString('base64');
            console.log('\n  ============================================');
            console.log('  ENCRYPTION KEY GENERATION');
            console.log('  ============================================\n');
            console.log('  Generated cryptographically secure encryption credentials:\n');
            console.log(`  Key Entropy: ${Math.floor(calculateEntropy(singleSecrets['VORION_ENCRYPTION_KEY']))} bits (minimum required: 128)`);
            console.log(`  Salt Entropy: ${Math.floor(calculateEntropy(singleSecrets['VORION_ENCRYPTION_SALT']))} bits`);
            console.log('\n  IMPORTANT: These keys are REQUIRED for Vorion to start.');
            console.log('  Add them to your environment before running Vorion.\n');
            break;
          case 'csrf':
            singleSecrets['VORION_CSRF_SECRET'] = generate256BitSecret();
            console.log('\n  Generated 256-bit CSRF Secret');
            console.log(`  Entropy: ${Math.floor(calculateEntropy(singleSecrets['VORION_CSRF_SECRET']))} bits\n`);
            break;
          default:
            console.error(`Error: Unknown secret type: ${options.type}`);
            console.error('Available types: all, jwt, encryption, csrf');
            process.exit(1);
        }

        secrets = singleSecrets;

        switch (options.format) {
          case 'json':
            output = JSON.stringify(secrets, null, 2);
            break;
          case 'shell':
            output = Object.entries(secrets)
              .map(([key, value]) => `export ${key}="${value}"`)
              .join('\n');
            break;
          case 'env':
          default:
            output = Object.entries(secrets)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n');
            break;
        }
      } else {
        // Generate all secrets
        secrets = generateSecrets();

        switch (options.format) {
          case 'json':
            output = JSON.stringify(secrets, null, 2);
            break;
          case 'shell':
            output = Object.entries(secrets)
              .filter(([key]) => !['generatedAt', 'version'].includes(key))
              .map(([key, value]) => {
                const envKey = key.replace(/([A-Z])/g, '_$1').toUpperCase();
                return `export VORION_${envKey}="${value}"`;
              })
              .join('\n');
            break;
          case 'env':
          default:
            output = generateEnvFileContent(secrets as GeneratedSecrets);
            break;
        }
      }

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);

        // Check if file exists
        let existingContent = '';
        try {
          existingContent = await fs.readFile(outputPath, 'utf-8');
          if (!options.force && !options.append) {
            console.error(`Error: File already exists: ${outputPath}`);
            console.error('Use --force to overwrite or --append to add to existing file.');
            process.exit(1);
          }
        } catch {
          // File doesn't exist, safe to write
        }

        if (options.append && existingContent) {
          output = existingContent.trimEnd() + '\n\n# Added by vorion secrets generate\n' + output;
        }

        await fs.writeFile(outputPath, output, { mode: 0o600 });
        console.log(`Secrets written to: ${outputPath}`);
        console.log('\nSecret fingerprints:');
        for (const [key, value] of Object.entries(secrets)) {
          if (typeof value === 'string' && !['generatedAt', 'version'].includes(key)) {
            const displayKey = key.startsWith('VORION_') ? key : key;
            console.log(`  ${displayKey}: ${getSecretFingerprint(value)}`);
          }
        }
      } else {
        console.log(output);
      }
    } catch (error) {
      console.error(`Error generating secrets: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Add keypair generation subcommand
secretsCommand
  .command('keypair')
  .description('Generate Ed25519 signing keypair for JWT/token signing')
  .option('-o, --output <path>', 'Output directory for key files')
  .option('-f, --format <format>', 'Output format: pem, env, json', 'pem')
  .option('--force', 'Overwrite existing files', false)
  .addHelpText(
    'after',
    `
Examples:
  # Generate keypair and output to stdout
  $ vorion secrets keypair

  # Save keypair to files
  $ vorion secrets keypair -o ./keys/

  # Output as environment variables
  $ vorion secrets keypair -f env
`
  )
  .action(async (options: KeypairOptions) => {
    try {
      console.log('\n  Generating Ed25519 Signing Keypair');
      console.log('  ===================================\n');

      const { publicKey, privateKey } = generateEd25519Keypair();

      // Validate the keypair
      const derivedPublic = derivePublicKey(privateKey);
      if (derivedPublic !== publicKey) {
        throw new Error('Keypair validation failed');
      }

      console.log('  Keypair generated and validated successfully!');
      console.log(`  Public Key Fingerprint: ${getSecretFingerprint(publicKey)}`);
      console.log(`  Private Key Fingerprint: ${getSecretFingerprint(privateKey)}\n`);

      if (options.output) {
        const outputDir = resolve(process.cwd(), options.output);

        // Create directory if it doesn't exist
        await fs.mkdir(outputDir, { recursive: true });

        const publicKeyPath = resolve(outputDir, 'vorion-signing.pub');
        const privateKeyPath = resolve(outputDir, 'vorion-signing.key');

        // Check if files exist
        try {
          await fs.access(publicKeyPath);
          if (!options.force) {
            console.error(`Error: File already exists: ${publicKeyPath}`);
            console.error('Use --force to overwrite.');
            process.exit(1);
          }
        } catch {
          // File doesn't exist
        }

        // Write key files with restricted permissions
        await fs.writeFile(publicKeyPath, publicKey, { mode: 0o644 });
        await fs.writeFile(privateKeyPath, privateKey, { mode: 0o600 });

        console.log(`  Public key saved to: ${publicKeyPath}`);
        console.log(`  Private key saved to: ${privateKeyPath}`);
        console.log('\n  Add to your .env file:');
        console.log(`    VORION_SIGNING_PUBLIC_KEY_FILE=${publicKeyPath}`);
        console.log(`    VORION_SIGNING_PRIVATE_KEY_FILE=${privateKeyPath}`);
      } else {
        switch (options.format) {
          case 'env':
            // Base64 encode for environment variable storage
            const pubB64 = Buffer.from(publicKey).toString('base64');
            const privB64 = Buffer.from(privateKey).toString('base64');
            console.log('# Ed25519 Signing Keys (base64 encoded)');
            console.log(`VORION_SIGNING_PUBLIC_KEY=${pubB64}`);
            console.log(`VORION_SIGNING_PRIVATE_KEY=${privB64}`);
            break;
          case 'json':
            console.log(JSON.stringify({
              publicKey,
              privateKey,
              algorithm: 'Ed25519',
              generatedAt: new Date().toISOString(),
            }, null, 2));
            break;
          case 'pem':
          default:
            console.log('# Public Key (share this)');
            console.log(publicKey);
            console.log('# Private Key (keep secret!)');
            console.log(privateKey);
            break;
        }
      }

      console.log('\n  Security Notes:');
      console.log('  - Keep the private key secure and never commit to version control');
      console.log('  - The public key can be shared for signature verification');
      console.log('  - Use VORION_SIGNING_PRIVATE_KEY_FILE for file-based key loading\n');
    } catch (error) {
      console.error(`Error generating keypair: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

secretsCommand
  .command('init')
  .description('Initialize secrets in a data directory (creates if not exists)')
  .option('-d, --data-dir <path>', 'Data directory path', './data')
  .option('--show', 'Show generated secrets', false)
  .addHelpText(
    'after',
    `
Examples:
  # Initialize secrets in default data directory
  $ vorion secrets init

  # Initialize in custom directory
  $ vorion secrets init -d /var/vorion/data

  # Show generated secrets (use with caution)
  $ vorion secrets init --show
`
  )
  .action(async (options: InitOptions) => {
    try {
      const dataDir = resolve(process.cwd(), options.dataDir);

      console.log(`Initializing secrets in: ${dataDir}`);

      const secrets = await loadOrGenerateSecrets(dataDir);

      console.log('\nSecrets initialized successfully!');
      console.log('\nSecret fingerprints:');
      for (const [key, value] of Object.entries(secrets)) {
        if (typeof value === 'string' && !['generatedAt', 'version'].includes(key)) {
          console.log(`  ${key}: ${getSecretFingerprint(value)}`);
        }
      }

      if (options.show) {
        console.log('\nSecrets (masked):');
        const masked = formatSecretsForDisplay(secrets);
        for (const [key, value] of Object.entries(masked)) {
          console.log(`  ${key}: ${value}`);
        }
      }

      console.log(`\nSecrets file: ${resolve(dataDir, '.vorion-secrets.json')}`);
    } catch (error) {
      console.error(`Error initializing secrets: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

secretsCommand
  .command('validate')
  .description('Validate secrets from environment or file')
  .option('-e, --env', 'Validate from environment variables', false)
  .option('-f, --file <path>', 'Validate from secrets file')
  .addHelpText(
    'after',
    `
Examples:
  # Validate secrets from environment
  $ vorion secrets validate -e

  # Validate from JSON secrets file
  $ vorion secrets validate -f ./data/.vorion-secrets.json

Validation checks:
  - Secret presence and length requirements
  - Entropy analysis (minimum 128 bits recommended)
  - Detection of weak patterns and placeholder values
`
  )
  .action(async (options: ValidateOptions) => {
    const requiredSecrets = [
      { name: 'JWT Secret', envVar: 'VORION_JWT_SECRET', key: 'jwtSecret', minLength: 32 },
      { name: 'Encryption Key', envVar: 'VORION_ENCRYPTION_KEY', key: 'encryptionKey', minLength: 32 },
      { name: 'Encryption Salt', envVar: 'VORION_ENCRYPTION_SALT', key: 'encryptionSalt', minLength: 16 },
      { name: 'Dedupe Secret', envVar: 'VORION_DEDUPE_SECRET', key: 'dedupeSecret', minLength: 32 },
      { name: 'CSRF Secret', envVar: 'VORION_CSRF_SECRET', key: 'csrfSecret', minLength: 32 },
    ];

    let secrets: Record<string, string> = {};
    let source = 'environment';

    if (options.file) {
      try {
        const filePath = resolve(process.cwd(), options.file);
        const content = await fs.readFile(filePath, 'utf-8');
        secrets = JSON.parse(content);
        source = `file: ${filePath}`;
      } catch (error) {
        console.error(`Error reading secrets file: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    } else {
      // Read from environment
      for (const { envVar, key } of requiredSecrets) {
        const value = process.env[envVar];
        if (value) {
          secrets[key] = value;
        }
      }
    }

    console.log(`\nValidating secrets from ${source}\n`);

    let allValid = true;
    const results: Array<{ name: string; valid: boolean; error?: string; entropy?: number }> = [];

    for (const { name, key, minLength } of requiredSecrets) {
      const value = secrets[key];
      const validation = validateSecret(value, name, minLength);

      if (!validation.valid) {
        allValid = false;
      }

      const entropy = value ? calculateEntropy(value) : 0;

      results.push({
        name,
        valid: validation.valid,
        error: validation.error,
        entropy: Math.floor(entropy),
      });
    }

    // Display results
    for (const result of results) {
      const status = result.valid ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${status}  ${result.name}`);
      if (result.valid) {
        console.log(`        Entropy: ${result.entropy} bits`);
      } else {
        console.log(`        ${result.error}`);
      }
    }

    console.log();

    if (allValid) {
      console.log('\x1b[32mAll secrets are valid!\x1b[0m');
      process.exit(0);
    } else {
      console.log('\x1b[31mSome secrets failed validation.\x1b[0m');
      console.log('\nRun `vorion secrets generate` to create new secrets.');
      process.exit(1);
    }
  });

secretsCommand
  .command('show')
  .description('Show secret fingerprints (not the actual values)')
  .option('-f, --file <path>', 'Secrets file path')
  .option('-d, --data-dir <path>', 'Data directory with secrets', './data')
  .addHelpText(
    'after',
    `
Examples:
  # Show fingerprints from default data directory
  $ vorion secrets show

  # Show fingerprints from specific file
  $ vorion secrets show -f ./data/.vorion-secrets.json

Note: This command shows fingerprints (SHA-256 hash prefixes) that can be
used to verify which secrets are in use without exposing actual values.
`
  )
  .action(async (options: ShowOptions) => {
    try {
      let secrets: GeneratedSecrets;

      if (options.file) {
        const filePath = resolve(process.cwd(), options.file);
        const content = await fs.readFile(filePath, 'utf-8');
        secrets = JSON.parse(content);
      } else {
        const dataDir = resolve(process.cwd(), options.dataDir);
        secrets = await loadOrGenerateSecrets(dataDir);
      }

      console.log('\nSecret Fingerprints (SHA-256 prefix):\n');

      for (const [key, value] of Object.entries(secrets)) {
        if (typeof value === 'string' && !['generatedAt', 'version'].includes(key)) {
          const fingerprint = getSecretFingerprint(value);
          const entropy = Math.floor(calculateEntropy(value));
          console.log(`  ${key}:`);
          console.log(`    Fingerprint: ${fingerprint}`);
          console.log(`    Length: ${value.length} chars`);
          console.log(`    Entropy: ${entropy} bits`);
          console.log();
        }
      }

      if (secrets.generatedAt) {
        console.log(`Generated: ${secrets.generatedAt}`);
      }
      if (secrets.version) {
        console.log(`Format version: ${secrets.version}`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

secretsCommand
  .command('rotate')
  .description('Generate new secrets and optionally update existing file')
  .option('-f, --file <path>', 'Existing secrets file to update')
  .option('-o, --output <path>', 'Output file for new secrets')
  .option('--backup', 'Create backup of existing secrets', true)
  .addHelpText(
    'after',
    `
Examples:
  # Rotate secrets and output to stdout
  $ vorion secrets rotate

  # Rotate secrets in existing file (creates backup)
  $ vorion secrets rotate -f ./data/.vorion-secrets.json

  # Rotate and save to new file
  $ vorion secrets rotate -o .env.new

  # Rotate without backup (use with caution)
  $ vorion secrets rotate -f ./data/.vorion-secrets.json --no-backup

After rotation, remember to:
  1. Update all running services with new secrets
  2. Restart services to pick up new configuration
  3. Consider a rolling restart to avoid downtime
`
  )
  .action(async (options: RotateOptions) => {
    try {
      const newSecrets = generateSecrets();

      // If updating existing file, create backup
      if (options.file) {
        const filePath = resolve(process.cwd(), options.file);

        try {
          const existing = await fs.readFile(filePath, 'utf-8');

          if (options.backup) {
            const backupPath = `${filePath}.backup.${Date.now()}`;
            await fs.writeFile(backupPath, existing, { mode: 0o600 });
            console.log(`Backup created: ${backupPath}`);
          }

          // Write new secrets
          await fs.writeFile(filePath, JSON.stringify(newSecrets, null, 2), { mode: 0o600 });
          console.log(`Secrets rotated: ${filePath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.error(`Error: File not found: ${filePath}`);
            process.exit(1);
          }
          throw error;
        }
      } else if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await fs.writeFile(outputPath, JSON.stringify(newSecrets, null, 2), { mode: 0o600 });
        console.log(`New secrets written: ${outputPath}`);
      } else {
        // Output to stdout
        console.log(generateEnvFileContent(newSecrets));
      }

      console.log('\nNew secret fingerprints:');
      for (const [key, value] of Object.entries(newSecrets)) {
        if (typeof value === 'string' && !['generatedAt', 'version'].includes(key)) {
          console.log(`  ${key}: ${getSecretFingerprint(value)}`);
        }
      }

      console.log('\n\x1b[33mWarning: After rotating secrets, you must:\x1b[0m');
      console.log('  1. Update all running services with new secrets');
      console.log('  2. Restart services to pick up new configuration');
      console.log('  3. Consider a rolling restart to avoid downtime');
    } catch (error) {
      console.error(`Error rotating secrets: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });
