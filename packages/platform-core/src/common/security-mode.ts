/**
 * Security Mode Configuration
 *
 * Enforces security boundaries between development and production environments.
 * Prevents accidental deployment of insecure configurations.
 *
 * @packageDocumentation
 */

import { createLogger } from './logger.js';

const logger = createLogger({ component: 'security-mode' });

/**
 * Security mode levels
 */
export type SecurityMode = 'production' | 'staging' | 'development' | 'testing';

/**
 * Security mode configuration
 */
export interface SecurityModeConfig {
  /** Allow insecure defaults in development */
  allowInsecureDefaults: boolean;
  /** Allow ephemeral signing keys */
  allowEphemeralKeys: boolean;
  /** Allow skipping signature verification */
  allowSkipVerification: boolean;
  /** Allow debug endpoints */
  allowDebugEndpoints: boolean;
  /** Allow verbose error messages */
  allowVerboseErrors: boolean;
  /** Require HTTPS */
  requireHttps: boolean;
  /** Require strong secrets */
  requireStrongSecrets: boolean;
  /** Debug endpoint bind address (localhost only for security) */
  debugEndpointBindAddress?: string;
  /** Require debug authentication token even in development */
  requireDebugAuth?: boolean;
}

/**
 * Security configurations per mode
 */
const MODE_CONFIGS: Record<SecurityMode, SecurityModeConfig> = {
  production: {
    allowInsecureDefaults: false,
    allowEphemeralKeys: false,
    allowSkipVerification: false,
    allowDebugEndpoints: false,
    allowVerboseErrors: false,
    requireHttps: true,
    requireStrongSecrets: true,
  },
  staging: {
    allowInsecureDefaults: false,
    allowEphemeralKeys: false,
    allowSkipVerification: false,
    allowDebugEndpoints: false,
    allowVerboseErrors: false,  // Changed: no verbose errors in staging (security fix)
    requireHttps: true,
    requireStrongSecrets: true,
  },
  development: {
    allowInsecureDefaults: true,
    allowEphemeralKeys: true,
    allowSkipVerification: false,
    allowDebugEndpoints: true,
    allowVerboseErrors: true,
    requireHttps: false,
    requireStrongSecrets: false,
    debugEndpointBindAddress: '127.0.0.1',  // Localhost only for security
    requireDebugAuth: true,  // Require token even in dev
  },
  testing: {
    allowInsecureDefaults: true,
    allowEphemeralKeys: true,
    allowSkipVerification: true,
    allowDebugEndpoints: true,
    allowVerboseErrors: true,
    requireHttps: false,
    requireStrongSecrets: false,
  },
};

/**
 * Cached security mode
 */
let cachedMode: SecurityMode | null = null;
let modeInitialized = false;

/**
 * Get the current security mode based on environment
 *
 * Priority:
 * 1. VORION_SECURITY_MODE (explicit override)
 * 2. VORION_ENV
 * 3. NODE_ENV
 * 4. Default to 'production' (fail-safe)
 */
export function getSecurityMode(): SecurityMode {
  if (cachedMode !== null) {
    return cachedMode;
  }

  // Check for explicit security mode
  const explicitMode = process.env['VORION_SECURITY_MODE'];
  if (explicitMode && isValidMode(explicitMode)) {
    cachedMode = explicitMode;
    logModeSelection(cachedMode, 'VORION_SECURITY_MODE');
    return cachedMode;
  }

  // Check VORION_ENV
  const vorionEnv = process.env['VORION_ENV'];
  if (vorionEnv && isValidMode(vorionEnv)) {
    cachedMode = vorionEnv;
    logModeSelection(cachedMode, 'VORION_ENV');
    return cachedMode;
  }

  // Check NODE_ENV
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv) {
    if (nodeEnv === 'production') {
      cachedMode = 'production';
    } else if (nodeEnv === 'test') {
      cachedMode = 'testing';
    } else if (nodeEnv === 'development') {
      cachedMode = 'development';
    }
  }

  // Default to production (fail-safe)
  if (!cachedMode) {
    cachedMode = 'production';
    logger.warn(
      'No environment specified, defaulting to production security mode. ' +
      'Set VORION_ENV or VORION_SECURITY_MODE to configure.'
    );
  }

  logModeSelection(cachedMode, 'default');
  return cachedMode;
}

/**
 * Get security configuration for current mode
 */
export function getSecurityConfig(): SecurityModeConfig {
  const mode = getSecurityMode();
  return { ...MODE_CONFIGS[mode] };
}

/**
 * Check if current mode is production-grade (production or staging)
 */
export function isProductionGrade(): boolean {
  const mode = getSecurityMode();
  return mode === 'production' || mode === 'staging';
}

/**
 * Check if current mode allows development features
 */
export function isDevelopmentMode(): boolean {
  const mode = getSecurityMode();
  return mode === 'development' || mode === 'testing';
}

/**
 * Require production-grade security
 *
 * Call this before operations that should never run with reduced security.
 *
 * @throws Error if not in production-grade mode
 */
export function requireProductionSecurity(operation: string): void {
  if (!isProductionGrade()) {
    const mode = getSecurityMode();
    throw new Error(
      `Operation "${operation}" requires production security mode. ` +
      `Current mode: ${mode}. ` +
      `Set VORION_ENV=production or VORION_SECURITY_MODE=production.`
    );
  }
}

/**
 * Assert a security condition, throwing if not met in production
 *
 * In development, logs a warning instead of throwing.
 */
export function assertSecurityCondition(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>
): void {
  if (condition) return;

  if (isProductionGrade()) {
    logger.error({ ...context }, `Security assertion failed: ${message}`);
    throw new Error(`Security assertion failed: ${message}`);
  } else {
    logger.warn(
      { ...context, mode: getSecurityMode() },
      `Security warning (would fail in production): ${message}`
    );
  }
}

/**
 * Check if a specific security feature is allowed in current mode
 */
export function isSecurityFeatureAllowed(feature: keyof SecurityModeConfig): boolean {
  const config = getSecurityConfig();
  const value = config[feature];

  // For 'require*' features, invert the logic
  if (feature.startsWith('require')) {
    return true; // These are always "allowed" to be checked
  }

  return value === true;
}

/**
 * Guard for insecure development defaults
 *
 * SECURITY: For encryption keys, this function ALWAYS throws an error.
 * Hardcoded encryption credentials are never allowed, even in development.
 *
 * Use this when providing fallback values that should only work in development.
 * Note: Encryption-related configurations should NOT use this function.
 *
 * @example
 * const secret = process.env.SOME_CONFIG ?? devOnlyDefault('some-config', 'dev-value');
 *
 * @throws Error always for encryption keys (VORION_ENCRYPTION_KEY, VORION_ENCRYPTION_SALT)
 * @throws Error in production/staging for other configurations
 */
export function devOnlyDefault<T>(name: string, defaultValue: T): T {
  // SECURITY: Encryption keys are NEVER allowed to use fallbacks
  // This is a critical security control - do not remove or weaken
  const encryptionRelatedKeys = [
    'VORION_ENCRYPTION_KEY',
    'VORION_ENCRYPTION_SALT',
    'encryption_key',
    'encryption_salt',
  ];

  const nameLower = name.toLowerCase();
  if (encryptionRelatedKeys.some(key => nameLower.includes(key.toLowerCase()))) {
    throw new Error(
      `SECURITY VIOLATION: ${name} cannot use fallback values.\n\n` +
      `Encryption keys must be explicitly configured in ALL environments.\n` +
      `This is a critical security control to prevent credential exposure.\n\n` +
      `To configure encryption keys:\n` +
      `  1. Generate secure keys: vorion secrets generate --type encryption\n` +
      `  2. Set environment variables:\n` +
      `     export VORION_ENCRYPTION_KEY="<your-generated-key>"\n` +
      `     export VORION_ENCRYPTION_SALT="<your-generated-salt>"\n\n` +
      `For more information, see: docs/security/ENCRYPTION_SETUP.md`
    );
  }

  const config = getSecurityConfig();

  if (!config.allowInsecureDefaults) {
    throw new Error(
      `Missing required configuration: ${name}. ` +
      `Insecure defaults are not allowed in ${getSecurityMode()} mode. ` +
      `Please set the appropriate environment variable.`
    );
  }

  logger.warn(
    { configName: name, mode: getSecurityMode() },
    `Using insecure default for ${name}. This is only allowed in development.`
  );

  return defaultValue;
}

/**
 * Guard for ephemeral keys
 *
 * Use this when generating keys that won't persist across restarts.
 */
export function allowEphemeralKey(keyType: string): void {
  const config = getSecurityConfig();

  if (!config.allowEphemeralKeys) {
    throw new Error(
      `Ephemeral ${keyType} keys are not allowed in ${getSecurityMode()} mode. ` +
      `Ephemeral keys cause signature/encryption failures after restart. ` +
      `Please configure a persistent key via environment variable.`
    );
  }

  logger.warn(
    { keyType, mode: getSecurityMode() },
    `Using ephemeral ${keyType} key. This is only allowed in development.`
  );
}

/**
 * Validate that a secret meets minimum strength requirements
 *
 * @returns true if valid, throws in production if invalid
 */
export function validateSecretStrength(
  secretName: string,
  secret: string,
  minLength: number = 32,
  minEntropy: number = 128
): boolean {
  const config = getSecurityConfig();

  const issues: string[] = [];

  if (secret.length < minLength) {
    issues.push(`length ${secret.length} < minimum ${minLength}`);
  }

  const entropy = calculateEntropy(secret);
  if (entropy < minEntropy) {
    issues.push(`entropy ${entropy.toFixed(0)} bits < minimum ${minEntropy} bits`);
  }

  // Check for obviously weak patterns
  if (/^(.)\1+$/.test(secret)) {
    issues.push('consists of repeated characters');
  }
  if (/^(abc|123|password|secret|dev|test)/i.test(secret)) {
    issues.push('starts with common weak pattern');
  }

  if (issues.length > 0) {
    const message = `Secret "${secretName}" is weak: ${issues.join(', ')}`;

    if (config.requireStrongSecrets) {
      throw new Error(
        `${message}. Strong secrets are required in ${getSecurityMode()} mode.`
      );
    } else {
      logger.warn({ secretName, issues }, message);
      return false;
    }
  }

  return true;
}

/**
 * Calculate entropy of a string in bits
 */
function calculateEntropy(str: string): number {
  if (str.length === 0) return 0;

  const charFrequency = new Map<string, number>();
  for (const char of str) {
    charFrequency.set(char, (charFrequency.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of charFrequency.values()) {
    const probability = count / str.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy * str.length;
}

/**
 * Check if a string is a valid security mode
 */
function isValidMode(mode: string): mode is SecurityMode {
  return ['production', 'staging', 'development', 'testing'].includes(mode);
}

/**
 * Log mode selection (only once)
 */
function logModeSelection(mode: SecurityMode, source: string): void {
  if (!modeInitialized) {
    modeInitialized = true;
    const config = MODE_CONFIGS[mode];

    logger.info(
      {
        mode,
        source,
        allowInsecureDefaults: config.allowInsecureDefaults,
        allowEphemeralKeys: config.allowEphemeralKeys,
        requireHttps: config.requireHttps,
        requireStrongSecrets: config.requireStrongSecrets,
      },
      `Security mode initialized: ${mode}`
    );

    if (mode === 'production') {
      logger.info('Production security enforced: all protections active');
    } else if (mode !== 'staging') {
      logger.warn(
        `Running in ${mode} mode with reduced security. ` +
        'Do not use in production.'
      );
    }
  }
}

/**
 * Reset cached mode (for testing only)
 */
export function resetSecurityMode(): void {
  if (getSecurityMode() !== 'testing') {
    throw new Error('resetSecurityMode() can only be called in testing mode');
  }
  cachedMode = null;
  modeInitialized = false;
}

/**
 * Override security mode (for testing only)
 */
export function overrideSecurityMode(mode: SecurityMode): void {
  const currentMode = getSecurityMode();
  if (currentMode !== 'testing') {
    throw new Error('overrideSecurityMode() can only be called in testing mode');
  }
  cachedMode = mode;
  logger.info({ mode }, 'Security mode overridden for testing');
}

// ============================================================================
// Encryption Configuration Validation
// ============================================================================

/**
 * Result of encryption configuration validation
 */
export interface EncryptionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate encryption configuration at startup
 *
 * This function validates that encryption keys are properly configured.
 * It should be called during application initialization to ensure the
 * system has proper encryption credentials before processing any data.
 *
 * SECURITY: Encryption keys are REQUIRED in ALL environments including development.
 * This prevents accidental exposure of hardcoded credentials.
 *
 * @param options.throwOnError - If true, throws an error when validation fails (default: true)
 * @returns Validation result with errors and warnings
 * @throws Error if validation fails and throwOnError is true
 *
 * @example
 * ```typescript
 * // Call at application startup
 * import { validateEncryptionConfig } from './security-mode.js';
 *
 * try {
 *   validateEncryptionConfig();
 *   console.log('Encryption configuration validated successfully');
 * } catch (error) {
 *   console.error('Encryption configuration error:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export function validateEncryptionConfig(options: { throwOnError?: boolean } = {}): EncryptionValidationResult {
  const { throwOnError = true } = options;
  const mode = getSecurityMode();

  const result: EncryptionValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const encryptionKey = process.env['VORION_ENCRYPTION_KEY'];
  const encryptionSalt = process.env['VORION_ENCRYPTION_SALT'];

  // Validate encryption key
  if (!encryptionKey) {
    result.valid = false;
    result.errors.push(
      `VORION_ENCRYPTION_KEY is not configured. ` +
      `Encryption keys are required in ALL environments (current: ${mode}).`
    );
  } else {
    // Check minimum length
    if (encryptionKey.length < 32) {
      result.valid = false;
      result.errors.push(
        `VORION_ENCRYPTION_KEY is too short (${encryptionKey.length} chars). ` +
        `Minimum length is 32 characters.`
      );
    }

    // Check for obvious placeholder values
    const weakPatterns = [
      'dev',
      'test',
      'example',
      'placeholder',
      'changeme',
      'password',
      'secret',
      'vorion-dev',
      'do-not-use',
    ];

    const keyLower = encryptionKey.toLowerCase();
    for (const pattern of weakPatterns) {
      if (keyLower.includes(pattern)) {
        result.valid = false;
        result.errors.push(
          `VORION_ENCRYPTION_KEY appears to contain a placeholder/weak value ("${pattern}"). ` +
          `Use a cryptographically random key.`
        );
        break;
      }
    }

    // Check entropy
    const entropy = calculateEntropy(encryptionKey);
    if (entropy < 128) {
      result.valid = false;
      result.errors.push(
        `VORION_ENCRYPTION_KEY has insufficient entropy (${entropy.toFixed(0)} bits). ` +
        `Minimum required is 128 bits. Use a cryptographically random key.`
      );
    }
  }

  // Validate encryption salt (required for PBKDF2)
  if (!encryptionSalt) {
    result.valid = false;
    result.errors.push(
      `VORION_ENCRYPTION_SALT is not configured. ` +
      `Encryption salt is required in ALL environments (current: ${mode}).`
    );
  } else {
    if (encryptionSalt.length < 16) {
      result.valid = false;
      result.errors.push(
        `VORION_ENCRYPTION_SALT is too short (${encryptionSalt.length} chars). ` +
        `Minimum length is 16 characters.`
      );
    }

    // Check for obvious placeholder values
    const saltLower = encryptionSalt.toLowerCase();
    const weakPatterns = ['dev', 'test', 'example', 'placeholder', 'vorion-dev'];
    for (const pattern of weakPatterns) {
      if (saltLower.includes(pattern)) {
        result.valid = false;
        result.errors.push(
          `VORION_ENCRYPTION_SALT appears to contain a placeholder/weak value ("${pattern}"). ` +
          `Use a cryptographically random salt.`
        );
        break;
      }
    }
  }

  // Log validation result
  if (result.valid) {
    logger.info(
      { mode, keyLength: encryptionKey?.length, saltLength: encryptionSalt?.length },
      'Encryption configuration validated successfully'
    );
  } else {
    logger.error(
      { mode, errors: result.errors, warnings: result.warnings },
      'Encryption configuration validation failed'
    );
  }

  // Throw if validation failed and throwOnError is true
  if (!result.valid && throwOnError) {
    const errorMessage = formatEncryptionConfigError(result.errors, mode);
    throw new Error(errorMessage);
  }

  return result;
}

/**
 * Format encryption configuration error message
 */
function formatEncryptionConfigError(errors: string[], mode: SecurityMode): string {
  return `CRITICAL: Encryption configuration validation failed.

Vorion cannot start without properly configured encryption keys.
This requirement applies to ALL environments including ${mode}.

Errors:
${errors.map(e => `  - ${e}`).join('\n')}

To fix this issue:

1. Generate secure encryption keys:
   $ vorion secrets generate --type encryption

2. Set the environment variables:
   export VORION_ENCRYPTION_KEY="<generated-key>"
   export VORION_ENCRYPTION_SALT="<generated-salt>"

3. Or add to your .env file:
   VORION_ENCRYPTION_KEY=<generated-key>
   VORION_ENCRYPTION_SALT=<generated-salt>

For development setup instructions, see: docs/security/ENCRYPTION_SETUP.md
For key rotation procedures, see: docs/security/KEY_ROTATION.md

SECURITY NOTE: Hardcoded fallback credentials have been removed to prevent
accidental exposure. All environments must explicitly configure encryption keys.`;
}
