/**
 * Secret Generator for Vorion
 *
 * Provides secure secret generation and management for deployment.
 * Generates cryptographically secure secrets for JWT, encryption, CSRF, etc.
 *
 * @packageDocumentation
 */

import { randomBytes, createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Generated secrets structure
 */
export interface GeneratedSecrets {
  /** JWT signing secret (64 bytes, base64 encoded) */
  jwtSecret: string;
  /** AES-256-GCM encryption key (32 bytes, base64 encoded) */
  encryptionKey: string;
  /** PBKDF2 salt for key derivation (16 bytes, base64 encoded) */
  encryptionSalt: string;
  /** HMAC secret for deduplication hashing (32 bytes, base64 encoded) */
  dedupeSecret: string;
  /** HMAC secret for CSRF token signing (32 bytes, base64 encoded) */
  csrfSecret: string;
  /** Timestamp when secrets were generated */
  generatedAt: string;
  /** Version of the secret generation format */
  version: number;
}

/**
 * Minimum entropy threshold in bits for production secrets
 */
const MIN_ENTROPY_BITS = 128;

/**
 * Current secret format version
 */
const SECRET_FORMAT_VERSION = 1;

/**
 * Calculate Shannon entropy of a string in bits.
 *
 * Used to validate secret quality and detect weak secrets.
 * A good cryptographic secret should have high entropy (close to the
 * theoretical maximum based on character set and length).
 *
 * @param str - The string to analyze
 * @returns Entropy in bits
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  // Count character frequencies
  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  // Calculate Shannon entropy
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  // Return total entropy (entropy per character * length)
  return entropy * str.length;
}

/**
 * Generate a cryptographically secure random secret.
 *
 * Uses Node.js crypto.randomBytes which is backed by the OS CSPRNG.
 *
 * @param bytes - Number of random bytes to generate (default: 64)
 * @returns Base64-encoded secret string
 */
export function generateSecret(bytes: number = 64): string {
  return randomBytes(bytes).toString('base64');
}

/**
 * Generate a cryptographically secure secret with entropy validation.
 *
 * Throws an error if the generated secret doesn't meet minimum entropy
 * requirements (which should never happen with a working CSPRNG).
 *
 * @param bytes - Number of random bytes to generate
 * @param minEntropy - Minimum required entropy in bits (default: 128)
 * @returns Base64-encoded secret string
 * @throws Error if generated secret has insufficient entropy
 */
export function generateSecretWithValidation(
  bytes: number = 64,
  minEntropy: number = MIN_ENTROPY_BITS
): string {
  const secret = generateSecret(bytes);
  const entropy = calculateEntropy(secret);

  if (entropy < minEntropy) {
    // This should never happen with a working CSPRNG
    throw new Error(
      `Generated secret has insufficient entropy (${Math.floor(entropy)} bits, need ${minEntropy}+). ` +
      'This may indicate a problem with the system random number generator.'
    );
  }

  return secret;
}

/**
 * Generate all required secrets for Vorion deployment.
 *
 * Generates:
 * - jwtSecret: 64 bytes for JWT signing (512 bits)
 * - encryptionKey: 32 bytes for AES-256-GCM (256 bits)
 * - encryptionSalt: 16 bytes for PBKDF2 (128 bits)
 * - dedupeSecret: 32 bytes for HMAC (256 bits)
 * - csrfSecret: 32 bytes for CSRF tokens (256 bits)
 *
 * @returns Generated secrets object
 */
export function generateSecrets(): GeneratedSecrets {
  return {
    jwtSecret: generateSecretWithValidation(64),
    encryptionKey: generateSecretWithValidation(32),
    // Use 24 bytes for salt to ensure Shannon entropy meets 128-bit threshold
    // when base64-encoded (16 bytes can occasionally produce lower Shannon entropy
    // due to character distribution even though raw entropy is 128 bits)
    encryptionSalt: generateSecretWithValidation(24),
    dedupeSecret: generateSecretWithValidation(32),
    csrfSecret: generateSecretWithValidation(32),
    generatedAt: new Date().toISOString(),
    version: SECRET_FORMAT_VERSION,
  };
}

/**
 * Generate a deterministic key fingerprint for secret identification.
 *
 * Creates a short hash that can be used to identify which secrets are
 * in use without exposing the actual secret values.
 *
 * @param secret - The secret to fingerprint
 * @returns First 8 characters of SHA-256 hash
 */
export function getSecretFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8);
}

/**
 * Load existing secrets from file or generate new ones.
 *
 * If secrets file exists and is valid, loads and returns existing secrets.
 * Otherwise, generates new secrets and saves them with restricted permissions.
 *
 * The secrets file is created with mode 0o600 (owner read/write only).
 *
 * @param dataDir - Directory to store/load secrets from
 * @returns Loaded or generated secrets
 */
export async function loadOrGenerateSecrets(dataDir: string): Promise<GeneratedSecrets> {
  const secretsPath = join(dataDir, '.vorion-secrets.json');

  try {
    const content = await fs.readFile(secretsPath, 'utf-8');
    const secrets = JSON.parse(content) as GeneratedSecrets;

    // Validate loaded secrets have all required fields
    const requiredFields: (keyof GeneratedSecrets)[] = [
      'jwtSecret',
      'encryptionKey',
      'encryptionSalt',
      'dedupeSecret',
      'csrfSecret',
    ];

    for (const field of requiredFields) {
      if (!secrets[field] || typeof secrets[field] !== 'string') {
        throw new Error(`Missing or invalid field: ${field}`);
      }
    }

    // Validate entropy of loaded secrets
    const minLengths: Record<string, number> = {
      jwtSecret: 32,
      encryptionKey: 32,
      encryptionSalt: 16,
      dedupeSecret: 32,
      csrfSecret: 32,
    };

    for (const [field, minLength] of Object.entries(minLengths)) {
      const secret = secrets[field as keyof GeneratedSecrets] as string;
      if (secret.length < minLength) {
        throw new Error(`Secret ${field} is too short (${secret.length} < ${minLength})`);
      }
    }

    return secrets;
  } catch (error) {
    // File doesn't exist or is invalid - generate new secrets
    const secrets = generateSecrets();

    // Ensure directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Write with restricted permissions (owner read/write only)
    await fs.writeFile(secretsPath, JSON.stringify(secrets, null, 2), {
      mode: 0o600,
    });

    return secrets;
  }
}

/**
 * Apply generated secrets to environment variables.
 *
 * Sets the appropriate VORION_* environment variables from the secrets.
 * Does not override variables that are already set.
 *
 * @param secrets - The secrets to apply
 * @param override - Whether to override existing env vars (default: false)
 */
export function applySecretsToEnv(secrets: GeneratedSecrets, override: boolean = false): void {
  const envMappings: Array<[keyof GeneratedSecrets, string]> = [
    ['jwtSecret', 'VORION_JWT_SECRET'],
    ['encryptionKey', 'VORION_ENCRYPTION_KEY'],
    ['encryptionSalt', 'VORION_ENCRYPTION_SALT'],
    ['dedupeSecret', 'VORION_DEDUPE_SECRET'],
    ['csrfSecret', 'VORION_CSRF_SECRET'],
  ];

  for (const [secretKey, envVar] of envMappings) {
    const value = secrets[secretKey];
    if (typeof value === 'string' && (override || !process.env[envVar])) {
      process.env[envVar] = value;
    }
  }
}

/**
 * Generate environment file content from secrets.
 *
 * Creates a .env file format string that can be written to disk
 * or used with docker-compose.
 *
 * @param secrets - The secrets to format
 * @returns Environment file content
 */
export function generateEnvFileContent(secrets: GeneratedSecrets): string {
  const lines = [
    '# Vorion Auto-Generated Secrets',
    `# Generated: ${secrets.generatedAt}`,
    `# Version: ${secrets.version}`,
    '',
    '# JWT signing secret (do not share)',
    `VORION_JWT_SECRET=${secrets.jwtSecret}`,
    '',
    '# Encryption key for data at rest',
    `VORION_ENCRYPTION_KEY=${secrets.encryptionKey}`,
    '',
    '# PBKDF2 salt for key derivation',
    `VORION_ENCRYPTION_SALT=${secrets.encryptionSalt}`,
    '',
    '# HMAC secret for deduplication',
    `VORION_DEDUPE_SECRET=${secrets.dedupeSecret}`,
    '',
    '# HMAC secret for CSRF tokens',
    `VORION_CSRF_SECRET=${secrets.csrfSecret}`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Rotate secrets by generating new ones.
 *
 * Generates a completely new set of secrets. The caller is responsible
 * for handling the transition (e.g., supporting both old and new secrets
 * during a migration period).
 *
 * @returns New generated secrets
 */
export function rotateSecrets(): GeneratedSecrets {
  return generateSecrets();
}

/**
 * Validate that a secret meets minimum security requirements.
 *
 * Checks:
 * - Minimum length
 * - Minimum entropy
 * - Not a known weak pattern
 *
 * @param secret - The secret to validate
 * @param name - Name of the secret (for error messages)
 * @param minLength - Minimum required length (default: 32)
 * @returns Validation result
 */
export function validateSecret(
  secret: string,
  name: string,
  minLength: number = 32
): { valid: boolean; error?: string } {
  if (!secret) {
    return { valid: false, error: `${name} is required` };
  }

  if (secret.length < minLength) {
    return {
      valid: false,
      error: `${name} must be at least ${minLength} characters (got ${secret.length})`,
    };
  }

  const entropy = calculateEntropy(secret);
  if (entropy < MIN_ENTROPY_BITS) {
    return {
      valid: false,
      error: `${name} has insufficient entropy (${Math.floor(entropy)} bits, need ${MIN_ENTROPY_BITS}+)`,
    };
  }

  // Check for obviously weak patterns
  const weakPatterns = [
    /^(.)\1+$/, // All same character
    /^(012345|123456|abcdef|qwerty)/i, // Sequential patterns
    /^(password|secret|key|token)/i, // Common weak prefixes
  ];

  for (const pattern of weakPatterns) {
    if (pattern.test(secret)) {
      return { valid: false, error: `${name} matches a weak pattern` };
    }
  }

  return { valid: true };
}
