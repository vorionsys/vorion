/**
 * Security Configuration Validator
 *
 * Comprehensive security audit system for validating Vorion platform configuration.
 * Performs checks across cryptographic settings, authentication, network security,
 * data protection, and configuration hardening.
 *
 * Usage:
 * ```typescript
 * import { runSecurityAudit } from './config-validator.js';
 *
 * const config = getConfig();
 * const result = await runSecurityAudit(config);
 *
 * if (!result.passed) {
 *   console.error('Security audit failed:', result.criticalFailures);
 * }
 * ```
 *
 * @packageDocumentation
 * @module security/config-validator
 */

import { createLogger } from '../common/logger.js';
import { type Config, getConfig } from '../common/config.js';
import { getSecurityMode, isProductionGrade } from '../common/security-mode.js';

const logger = createLogger({ component: 'security-config-validator' });

// =============================================================================
// Types
// =============================================================================

/**
 * Security check category
 */
export type SecurityCheckCategory = 'crypto' | 'auth' | 'network' | 'data' | 'config';

/**
 * Security check severity level
 */
export type SecurityCheckSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Individual security check result
 */
export interface SecurityCheck {
  /** Unique identifier for this check (e.g., 'JWT_SECRET_ENTROPY') */
  id: string;
  /** Human-readable name for the check */
  name: string;
  /** Category of security concern */
  category: SecurityCheckCategory;
  /** Severity level if the check fails */
  severity: SecurityCheckSeverity;
  /** Whether the check passed */
  passed: boolean;
  /** Detailed message about the check result */
  message: string;
  /** Remediation steps if the check failed */
  remediation?: string;
}

/**
 * Overall security audit result
 */
export interface SecurityCheckResult {
  /** Whether all critical and high severity checks passed */
  passed: boolean;
  /** All individual check results */
  checks: SecurityCheck[];
  /** Checks that failed with critical severity */
  criticalFailures: SecurityCheck[];
  /** Checks that failed with high or medium severity */
  warnings: SecurityCheck[];
  /** General security recommendations */
  recommendations: string[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum entropy bits required for JWT secrets (256 bits for production)
 */
const MIN_JWT_SECRET_ENTROPY_BITS = 256;

/**
 * Minimum entropy bits for encryption keys (256 bits for AES-256)
 */
const MIN_ENCRYPTION_KEY_ENTROPY_BITS = 256;

/**
 * Minimum entropy bits for PBKDF2 salt (128 bits)
 */
const MIN_SALT_ENTROPY_BITS = 128;

/**
 * Known weak/default secrets that should be rejected
 */
const WEAK_SECRET_PATTERNS = [
  /^(.)\1+$/, // Repeated characters
  /^(abc|123|password|secret|dev|test|admin|root)/i, // Common prefixes
  /^development-secret/i, // Development default
  /^change[-_]?me/i, // Placeholder patterns
  /^placeholder/i,
  /^example/i,
  /^default/i,
  /^your[-_]?secret/i,
];

/**
 * Maximum recommended session timeout in hours
 */
const MAX_SESSION_TIMEOUT_HOURS = 24;

/**
 * Minimum recommended PBKDF2 iterations (OWASP recommendation)
 */
const MIN_PBKDF2_ITERATIONS = 100000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate Shannon entropy of a string in bits
 *
 * Shannon entropy measures the unpredictability of a string.
 * For cryptographic secrets, higher entropy indicates better randomness.
 *
 * @param str - The string to analyze
 * @returns Entropy in bits (total, not per-character)
 *
 * @example
 * ```typescript
 * // Random 32-byte base64 string has ~170-190 bits entropy
 * calculateEntropy('Rk8qYjM2N3RoZXJlYXJlbm9zcG9vbnM='); // ~180 bits
 *
 * // Weak string with repeated characters has low entropy
 * calculateEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); // ~0 bits
 * ```
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) {
    return 0;
  }

  // Count character frequencies
  const charFrequency = new Map<string, number>();
  for (const char of str) {
    charFrequency.set(char, (charFrequency.get(char) ?? 0) + 1);
  }

  // Calculate Shannon entropy per character
  let entropyPerChar = 0;
  const len = str.length;
  for (const count of charFrequency.values()) {
    const probability = count / len;
    entropyPerChar -= probability * Math.log2(probability);
  }

  // Total entropy = per-character entropy * length
  return entropyPerChar * len;
}

/**
 * Check if a string matches known weak secret patterns
 *
 * @param str - The secret string to check
 * @returns Whether the string matches a known weak pattern
 */
function isWeakSecret(str: string): boolean {
  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(str));
}

/**
 * Parse duration string to seconds
 *
 * @param duration - Duration string (e.g., '1h', '7d', '30m')
 * @returns Duration in seconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    // Try to parse ISO 8601 duration (PT1H, P7D, etc.)
    const isoMatch = duration.match(/^PT?(\d+)([SMHD])$/i);
    if (!isoMatch) {
      return 0;
    }
    const [, value, unit] = isoMatch;
    const multipliers: Record<string, number> = {
      S: 1,
      M: 60,
      H: 3600,
      D: 86400,
    };
    return parseInt(value, 10) * (multipliers[unit.toUpperCase()] ?? 1);
  }

  const [, value, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return parseInt(value, 10) * (multipliers[unit] ?? 1);
}

/**
 * Create a security check result
 *
 * @param id - Check identifier
 * @param name - Human-readable name
 * @param category - Security category
 * @param severity - Severity level
 * @param passed - Whether the check passed
 * @param message - Result message
 * @param remediation - Remediation steps (if failed)
 * @returns SecurityCheck object
 */
function createCheck(
  id: string,
  name: string,
  category: SecurityCheckCategory,
  severity: SecurityCheckSeverity,
  passed: boolean,
  message: string,
  remediation?: string
): SecurityCheck {
  return {
    id,
    name,
    category,
    severity,
    passed,
    message,
    remediation: passed ? undefined : remediation,
  };
}

// =============================================================================
// Security Check Functions
// =============================================================================

/**
 * Check JWT secret has sufficient entropy (>= 256 bits)
 */
function checkJwtSecretEntropy(config: Config): SecurityCheck {
  const secret = config.jwt.secret;
  const entropy = calculateEntropy(secret);
  const passed = entropy >= MIN_JWT_SECRET_ENTROPY_BITS;

  return createCheck(
    'JWT_SECRET_ENTROPY',
    'JWT Secret Entropy',
    'crypto',
    'critical',
    passed,
    passed
      ? `JWT secret has sufficient entropy (${Math.floor(entropy)} bits)`
      : `JWT secret has insufficient entropy (${Math.floor(entropy)} bits, need >= ${MIN_JWT_SECRET_ENTROPY_BITS})`,
    'Generate a cryptographically secure JWT secret: openssl rand -base64 64'
  );
}

/**
 * Check signing key is configured
 */
function checkSigningKeyConfigured(config: Config): SecurityCheck {
  // Check for VORION_SIGNING_KEY environment variable
  const signingKey = process.env['VORION_SIGNING_KEY'];
  const isProdGrade = isProductionGrade();
  const passed = !isProdGrade || (!!signingKey && signingKey.length >= 32);

  return createCheck(
    'SIGNING_KEY_CONFIGURED',
    'Signing Key Configured',
    'crypto',
    'critical',
    passed,
    passed
      ? 'Signing key is properly configured'
      : 'VORION_SIGNING_KEY is not set or too short for production',
    'Set VORION_SIGNING_KEY environment variable with a secure key: openssl rand -base64 64'
  );
}

/**
 * Check encryption key is configured
 */
function checkEncryptionKeyConfigured(config: Config): SecurityCheck {
  const encryptionKey = config.encryption.key;
  const encryptContext = config.intent.encryptContext;
  const isProdGrade = isProductionGrade();

  // If encryption is enabled in production, key must be set
  const passed = !isProdGrade || !encryptContext || (!!encryptionKey && encryptionKey.length >= 32);

  return createCheck(
    'ENCRYPTION_KEY_CONFIGURED',
    'Encryption Key Configured',
    'crypto',
    'critical',
    passed,
    passed
      ? 'Encryption key is properly configured'
      : 'VORION_ENCRYPTION_KEY is required when encryption is enabled in production',
    'Set VORION_ENCRYPTION_KEY environment variable: openssl rand -base64 32'
  );
}

/**
 * Check encryption salt is configured for PBKDF2
 */
function checkEncryptionSaltConfigured(config: Config): SecurityCheck {
  const salt = config.encryption.salt;
  const kdfVersion = config.encryption.kdfVersion;
  const isProdGrade = isProductionGrade();

  // Salt is required for KDF v2 (PBKDF2) in production
  const passed = !isProdGrade || kdfVersion !== 2 || (!!salt && salt.length >= 16);

  return createCheck(
    'ENCRYPTION_SALT_CONFIGURED',
    'Encryption Salt Configured',
    'crypto',
    'high',
    passed,
    passed
      ? 'Encryption salt is properly configured'
      : 'VORION_ENCRYPTION_SALT is required for PBKDF2 key derivation in production',
    'Set VORION_ENCRYPTION_SALT environment variable: openssl rand -base64 16'
  );
}

/**
 * Check database uses TLS/SSL
 */
function checkDatabaseTls(_config: Config): SecurityCheck {
  // Check for SSL mode in connection string or environment
  const sslMode = process.env['VORION_DB_SSL_MODE'];
  const dbHost = process.env['VORION_DB_HOST'] ?? 'localhost';
  const isProdGrade = isProductionGrade();

  // In production, SSL should be enabled unless connecting to localhost
  const isLocalhost = dbHost === 'localhost' || dbHost === '127.0.0.1';
  const sslEnabled = sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca';
  const passed = !isProdGrade || isLocalhost || sslEnabled;

  return createCheck(
    'DATABASE_TLS',
    'Database TLS/SSL',
    'network',
    'high',
    passed,
    passed
      ? 'Database connection uses TLS or is local'
      : 'Database connection should use TLS in production',
    'Set VORION_DB_SSL_MODE=require or VORION_DB_SSL_MODE=verify-full'
  );
}

/**
 * Check Redis uses TLS
 */
function checkRedisTls(config: Config): SecurityCheck {
  // Check for TLS configuration
  const redisTls = process.env['VORION_REDIS_TLS'] === 'true';
  const redisHost = config.redis.host;
  const isProdGrade = isProductionGrade();

  // In production, TLS should be enabled unless connecting to localhost
  const isLocalhost = redisHost === 'localhost' || redisHost === '127.0.0.1';
  const passed = !isProdGrade || isLocalhost || redisTls;

  return createCheck(
    'REDIS_TLS',
    'Redis TLS',
    'network',
    'high',
    passed,
    passed
      ? 'Redis connection uses TLS or is local'
      : 'Redis connection should use TLS in production',
    'Set VORION_REDIS_TLS=true and configure Redis with TLS certificates'
  );
}

/**
 * Check HTTPS is enforced in production
 */
function checkHttpsRequired(_config: Config): SecurityCheck {
  const httpsEnforced = process.env['VORION_HTTPS_REQUIRED'] === 'true' ||
                        process.env['VORION_TLS_ENABLED'] === 'true';
  const isProdGrade = isProductionGrade();

  // In production, HTTPS should be enforced (unless behind a TLS-terminating proxy)
  const behindProxy = process.env['VORION_BEHIND_PROXY'] === 'true';
  const passed = !isProdGrade || httpsEnforced || behindProxy;

  return createCheck(
    'HTTPS_REQUIRED',
    'HTTPS Enforced',
    'network',
    'high',
    passed,
    passed
      ? 'HTTPS is enforced or service is behind TLS-terminating proxy'
      : 'HTTPS should be enforced in production',
    'Set VORION_HTTPS_REQUIRED=true or VORION_BEHIND_PROXY=true if using a TLS-terminating load balancer'
  );
}

/**
 * Check secure cookie settings
 */
function checkSecureCookies(_config: Config): SecurityCheck {
  const secureCookies = process.env['VORION_SECURE_COOKIES'] !== 'false';
  const isProdGrade = isProductionGrade();

  const passed = !isProdGrade || secureCookies;

  return createCheck(
    'SECURE_COOKIES',
    'Secure Cookies',
    'auth',
    'medium',
    passed,
    passed
      ? 'Secure cookie flag is enabled'
      : 'Cookies should have secure flag in production',
    'Remove VORION_SECURE_COOKIES=false or set to true'
  );
}

/**
 * Check CORS is properly configured
 */
function checkCorsConfigured(_config: Config): SecurityCheck {
  const corsOrigins = process.env['VORION_CORS_ORIGINS'];
  const corsMethods = process.env['VORION_CORS_METHODS'];
  const isProdGrade = isProductionGrade();

  // In production, CORS should be explicitly configured (not wildcard)
  const hasWildcard = corsOrigins === '*';
  const isConfigured = !!corsOrigins && !hasWildcard;
  const passed = !isProdGrade || isConfigured;

  return createCheck(
    'CORS_CONFIGURED',
    'CORS Configuration',
    'network',
    'medium',
    passed,
    passed
      ? 'CORS is properly configured with specific origins'
      : 'CORS should be configured with specific allowed origins in production',
    'Set VORION_CORS_ORIGINS to a comma-separated list of allowed origins (avoid using *)'
  );
}

/**
 * Check rate limiting is enabled
 */
function checkRateLimiting(config: Config): SecurityCheck {
  const defaultRateLimit = config.api.rateLimit;
  const hasRateLimiting = defaultRateLimit > 0 && defaultRateLimit < 10000;

  return createCheck(
    'RATE_LIMITING',
    'Rate Limiting',
    'network',
    'medium',
    hasRateLimiting,
    hasRateLimiting
      ? `Rate limiting is enabled (${defaultRateLimit} requests/window)`
      : 'Rate limiting should be configured to prevent abuse',
    'Set VORION_API_RATE_LIMIT to an appropriate value (e.g., 100-1000)'
  );
}

/**
 * Check sensitive data redaction in logs
 */
function checkLogRedaction(config: Config): SecurityCheck {
  const sensitivePaths = config.intent.sensitivePaths;
  const hasRedaction = sensitivePaths && sensitivePaths.length > 0;

  return createCheck(
    'LOG_REDACTION',
    'Log Redaction',
    'data',
    'medium',
    hasRedaction,
    hasRedaction
      ? `Log redaction is configured with ${sensitivePaths.length} sensitive paths`
      : 'Sensitive data redaction should be configured for logging',
    'Configure VORION_INTENT_SENSITIVE_PATHS with comma-separated list of sensitive field names'
  );
}

/**
 * Check session timeout is reasonable
 */
function checkSessionTimeout(config: Config): SecurityCheck {
  const jwtExpiration = config.jwt.expiration;
  const expirationSeconds = parseDuration(jwtExpiration);
  const maxSeconds = MAX_SESSION_TIMEOUT_HOURS * 3600;

  const passed = expirationSeconds > 0 && expirationSeconds <= maxSeconds;

  return createCheck(
    'SESSION_TIMEOUT',
    'Session Timeout',
    'auth',
    'low',
    passed,
    passed
      ? `Session timeout is set to ${jwtExpiration}`
      : `Session timeout should be <= ${MAX_SESSION_TIMEOUT_HOURS} hours`,
    `Set VORION_JWT_EXPIRATION to a reasonable value (e.g., 1h, 8h, max ${MAX_SESSION_TIMEOUT_HOURS}h)`
  );
}

/**
 * Check password policy is configured
 */
function checkPasswordPolicy(_config: Config): SecurityCheck {
  const minLength = process.env['VORION_PASSWORD_MIN_LENGTH'];
  const requireUppercase = process.env['VORION_PASSWORD_REQUIRE_UPPERCASE'];
  const requireNumbers = process.env['VORION_PASSWORD_REQUIRE_NUMBERS'];
  const requireSpecial = process.env['VORION_PASSWORD_REQUIRE_SPECIAL'];

  const hasPolicy = !!(minLength || requireUppercase || requireNumbers || requireSpecial);
  const minLengthValue = parseInt(minLength ?? '0', 10);
  const hasStrongPolicy = minLengthValue >= 12;

  return createCheck(
    'PASSWORD_POLICY',
    'Password Policy',
    'auth',
    'low',
    hasPolicy && hasStrongPolicy,
    hasPolicy
      ? hasStrongPolicy
        ? `Password policy configured with minimum length ${minLengthValue}`
        : 'Password policy exists but minimum length should be >= 12'
      : 'Password policy should be configured',
    'Set VORION_PASSWORD_MIN_LENGTH=12, VORION_PASSWORD_REQUIRE_UPPERCASE=true, etc.'
  );
}

/**
 * Check MFA is available
 */
function checkMfaAvailable(_config: Config): SecurityCheck {
  const mfaEnabled = process.env['VORION_MFA_ENABLED'] === 'true';
  const totpEnabled = process.env['VORION_TOTP_ENABLED'] === 'true';
  const webauthnEnabled = process.env['VORION_WEBAUTHN_ENABLED'] === 'true';

  const hasMfa = mfaEnabled || totpEnabled || webauthnEnabled;

  return createCheck(
    'MFA_AVAILABLE',
    'MFA Available',
    'auth',
    'low',
    hasMfa,
    hasMfa
      ? 'Multi-factor authentication is available'
      : 'Multi-factor authentication should be enabled for enhanced security',
    'Set VORION_MFA_ENABLED=true and configure TOTP or WebAuthn'
  );
}

/**
 * Check JWT secret is not a known weak pattern
 */
function checkJwtSecretNotWeak(config: Config): SecurityCheck {
  const secret = config.jwt.secret;
  const weak = isWeakSecret(secret);

  return createCheck(
    'JWT_SECRET_NOT_WEAK',
    'JWT Secret Not Weak Pattern',
    'crypto',
    'critical',
    !weak,
    weak
      ? 'JWT secret matches a known weak pattern'
      : 'JWT secret does not match known weak patterns',
    'Generate a cryptographically secure JWT secret: openssl rand -base64 64'
  );
}

/**
 * Check PBKDF2 iterations meet minimum requirements
 */
function checkPbkdf2Iterations(config: Config): SecurityCheck {
  const iterations = config.encryption.pbkdf2Iterations;
  const passed = iterations >= MIN_PBKDF2_ITERATIONS;

  return createCheck(
    'PBKDF2_ITERATIONS',
    'PBKDF2 Iterations',
    'crypto',
    'medium',
    passed,
    passed
      ? `PBKDF2 iterations are sufficient (${iterations})`
      : `PBKDF2 iterations too low (${iterations}, need >= ${MIN_PBKDF2_ITERATIONS})`,
    `Set VORION_ENCRYPTION_PBKDF2_ITERATIONS=${MIN_PBKDF2_ITERATIONS} or higher`
  );
}

/**
 * Check KDF version is current (v2 = PBKDF2-SHA512)
 */
function checkKdfVersion(config: Config): SecurityCheck {
  const kdfVersion = config.encryption.kdfVersion;
  const isProdGrade = isProductionGrade();
  const passed = !isProdGrade || kdfVersion === 2;

  return createCheck(
    'KDF_VERSION',
    'Key Derivation Function Version',
    'crypto',
    'high',
    passed,
    passed
      ? `KDF version ${kdfVersion} is secure`
      : 'KDF version 1 (SHA-256) is deprecated; upgrade to version 2 (PBKDF2-SHA512)',
    'Set VORION_ENCRYPTION_KDF_VERSION=2'
  );
}

/**
 * Check dedupe secret is configured in production
 */
function checkDedupeSecret(config: Config): SecurityCheck {
  const dedupeSecret = config.intent.dedupeSecret;
  const isProdGrade = isProductionGrade();
  const passed = !isProdGrade || (!!dedupeSecret && dedupeSecret.length >= 32);

  return createCheck(
    'DEDUPE_SECRET',
    'Deduplication Secret',
    'crypto',
    'high',
    passed,
    passed
      ? 'Deduplication HMAC secret is configured'
      : 'VORION_DEDUPE_SECRET is required in production to prevent hash prediction attacks',
    'Set VORION_DEDUPE_SECRET environment variable: openssl rand -base64 32'
  );
}

/**
 * Check encryption is enabled for sensitive data
 */
function checkEncryptionEnabled(config: Config): SecurityCheck {
  const encryptContext = config.intent.encryptContext;
  const isProdGrade = isProductionGrade();
  const passed = !isProdGrade || encryptContext;

  return createCheck(
    'ENCRYPTION_ENABLED',
    'Data Encryption Enabled',
    'data',
    'high',
    passed,
    passed
      ? 'Context encryption is enabled'
      : 'Context encryption should be enabled in production',
    'Set VORION_INTENT_ENCRYPT_CONTEXT=true'
  );
}

/**
 * Check audit logging is configured
 */
function checkAuditLogging(config: Config): SecurityCheck {
  const retentionDays = config.audit.retentionDays;
  const archiveEnabled = config.audit.archiveEnabled;

  // Enterprise compliance typically requires 1+ year retention
  const passed = retentionDays >= 365 && archiveEnabled;

  return createCheck(
    'AUDIT_LOGGING',
    'Audit Logging',
    'data',
    'medium',
    passed,
    passed
      ? `Audit logging configured with ${retentionDays} days retention and archival`
      : 'Audit logging should have >= 365 days retention with archival enabled',
    'Set VORION_AUDIT_RETENTION_DAYS=365 and VORION_AUDIT_ARCHIVE_ENABLED=true'
  );
}

/**
 * Check webhook security (DNS rebinding protection)
 */
function checkWebhookSecurity(config: Config): SecurityCheck {
  const allowDnsChange = config.webhook.allowDnsChange;
  const passed = !allowDnsChange;

  return createCheck(
    'WEBHOOK_DNS_PROTECTION',
    'Webhook DNS Rebinding Protection',
    'network',
    'medium',
    passed,
    passed
      ? 'Webhook DNS rebinding protection is enabled'
      : 'Webhook DNS rebinding protection should be enabled',
    'Set VORION_WEBHOOK_ALLOW_DNS_CHANGE=false (default)'
  );
}

/**
 * Check circuit breaker is configured
 */
function checkCircuitBreaker(config: Config): SecurityCheck {
  const dbCb = config.circuitBreaker.database;
  const redisCb = config.circuitBreaker.redis;

  const hasDbCb = dbCb.failureThreshold > 0;
  const hasRedisCb = redisCb.failureThreshold > 0;
  const passed = hasDbCb && hasRedisCb;

  return createCheck(
    'CIRCUIT_BREAKER',
    'Circuit Breaker Configuration',
    'config',
    'medium',
    passed,
    passed
      ? 'Circuit breakers are configured for database and Redis'
      : 'Circuit breakers should be configured for resilience',
    'Configure VORION_CB_DATABASE_* and VORION_CB_REDIS_* environment variables'
  );
}

/**
 * Check API timeout is reasonable
 */
function checkApiTimeout(config: Config): SecurityCheck {
  const timeout = config.api.timeout;
  const passed = timeout >= 5000 && timeout <= 60000;

  return createCheck(
    'API_TIMEOUT',
    'API Timeout',
    'config',
    'low',
    passed,
    passed
      ? `API timeout is set to ${timeout}ms`
      : 'API timeout should be between 5s and 60s',
    'Set VORION_API_TIMEOUT to a value between 5000 and 60000'
  );
}

/**
 * Check JWT JTI requirement for token revocation
 */
function checkJwtJtiRequired(config: Config): SecurityCheck {
  const requireJti = config.jwt.requireJti;
  const isProdGrade = isProductionGrade();
  const passed = !isProdGrade || requireJti;

  return createCheck(
    'JWT_JTI_REQUIRED',
    'JWT Token ID Required',
    'auth',
    'medium',
    passed,
    passed
      ? 'JWT JTI (token ID) is required for token revocation support'
      : 'JWT JTI should be required in production for proper token revocation',
    'Set VORION_JWT_REQUIRE_JTI=true'
  );
}

/**
 * Check database pool configuration
 */
function checkDatabasePool(config: Config): SecurityCheck {
  const poolMin = config.database.poolMin;
  const poolMax = config.database.poolMax;
  const connectionTimeout = config.database.poolConnectionTimeoutMs;

  const hasValidPool = poolMin >= 1 && poolMax >= poolMin && poolMax <= 100;
  const hasTimeout = connectionTimeout > 0 && connectionTimeout <= 30000;
  const passed = hasValidPool && hasTimeout;

  return createCheck(
    'DATABASE_POOL',
    'Database Pool Configuration',
    'config',
    'low',
    passed,
    passed
      ? `Database pool configured (${poolMin}-${poolMax} connections)`
      : 'Database pool should be properly configured',
    'Set VORION_DB_POOL_MIN, VORION_DB_POOL_MAX, and VORION_DB_POOL_CONNECTION_TIMEOUT'
  );
}

/**
 * Check proof storage retention
 */
function checkProofRetention(config: Config): SecurityCheck {
  const retentionDays = config.proof.retentionDays;
  // Compliance typically requires 7 years (2555 days) for audit trails
  const passed = retentionDays >= 365;

  return createCheck(
    'PROOF_RETENTION',
    'Proof Storage Retention',
    'data',
    'low',
    passed,
    passed
      ? `Proof retention set to ${retentionDays} days`
      : 'Proof retention should be >= 365 days for compliance',
    'Set VORION_PROOF_RETENTION_DAYS=2555 (7 years) for financial compliance'
  );
}

// =============================================================================
// Main Audit Function
// =============================================================================

/**
 * Run comprehensive security audit on configuration
 *
 * Executes all security checks and returns categorized results.
 * In production mode, critical failures will cause the audit to fail.
 *
 * @param config - The configuration to audit (defaults to getConfig())
 * @returns Promise resolving to security check results
 *
 * @example
 * ```typescript
 * const result = await runSecurityAudit();
 *
 * if (!result.passed) {
 *   for (const failure of result.criticalFailures) {
 *     console.error(`CRITICAL: ${failure.name} - ${failure.message}`);
 *     console.error(`  Remediation: ${failure.remediation}`);
 *   }
 *   process.exit(1);
 * }
 *
 * // Log warnings
 * for (const warning of result.warnings) {
 *   console.warn(`WARNING: ${warning.name} - ${warning.message}`);
 * }
 * ```
 */
export async function runSecurityAudit(config?: Config): Promise<SecurityCheckResult> {
  const cfg = config ?? getConfig();
  const securityMode = getSecurityMode();

  logger.info({ securityMode }, 'Starting security configuration audit');

  // Run all checks
  const checks: SecurityCheck[] = [
    // Critical crypto checks
    checkJwtSecretEntropy(cfg),
    checkJwtSecretNotWeak(cfg),
    checkSigningKeyConfigured(cfg),
    checkEncryptionKeyConfigured(cfg),

    // High severity checks
    checkEncryptionSaltConfigured(cfg),
    checkKdfVersion(cfg),
    checkDedupeSecret(cfg),
    checkEncryptionEnabled(cfg),
    checkDatabaseTls(cfg),
    checkRedisTls(cfg),
    checkHttpsRequired(cfg),

    // Medium severity checks
    checkSecureCookies(cfg),
    checkCorsConfigured(cfg),
    checkRateLimiting(cfg),
    checkLogRedaction(cfg),
    checkPbkdf2Iterations(cfg),
    checkAuditLogging(cfg),
    checkWebhookSecurity(cfg),
    checkCircuitBreaker(cfg),
    checkJwtJtiRequired(cfg),

    // Low severity checks
    checkSessionTimeout(cfg),
    checkPasswordPolicy(cfg),
    checkMfaAvailable(cfg),
    checkApiTimeout(cfg),
    checkDatabasePool(cfg),
    checkProofRetention(cfg),
  ];

  // Categorize results
  const criticalFailures = checks.filter(
    (c) => !c.passed && c.severity === 'critical'
  );
  const highFailures = checks.filter(
    (c) => !c.passed && c.severity === 'high'
  );
  const warnings = checks.filter(
    (c) => !c.passed && (c.severity === 'high' || c.severity === 'medium')
  );

  // In production, critical and high failures cause audit to fail
  const isProdGrade = isProductionGrade();
  const passed = isProdGrade
    ? criticalFailures.length === 0 && highFailures.length === 0
    : criticalFailures.length === 0;

  // Generate recommendations based on failures
  const recommendations: string[] = [];

  if (criticalFailures.length > 0) {
    recommendations.push(
      'CRITICAL: Address all critical security failures before deploying to production.'
    );
  }

  if (highFailures.length > 0) {
    recommendations.push(
      'HIGH: Address high severity issues to meet security compliance requirements.'
    );
  }

  const cryptoFailures = checks.filter(
    (c) => !c.passed && c.category === 'crypto'
  );
  if (cryptoFailures.length > 0) {
    recommendations.push(
      'Review cryptographic configuration to ensure all secrets have sufficient entropy and use current algorithms.'
    );
  }

  const networkFailures = checks.filter(
    (c) => !c.passed && c.category === 'network'
  );
  if (networkFailures.length > 0) {
    recommendations.push(
      'Enable TLS for all network connections (database, Redis, HTTP) in production environments.'
    );
  }

  const authFailures = checks.filter(
    (c) => !c.passed && c.category === 'auth'
  );
  if (authFailures.length > 0) {
    recommendations.push(
      'Strengthen authentication controls by enabling MFA, enforcing password policies, and using secure cookies.'
    );
  }

  const dataFailures = checks.filter(
    (c) => !c.passed && c.category === 'data'
  );
  if (dataFailures.length > 0) {
    recommendations.push(
      'Enable encryption at rest and configure audit logging for compliance and data protection.'
    );
  }

  if (passed && checks.every((c) => c.passed)) {
    recommendations.push(
      'All security checks passed. Continue monitoring and regularly review security configuration.'
    );
  }

  // Log results
  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.filter((c) => !c.passed).length;

  logger.info(
    {
      passed,
      totalChecks: checks.length,
      passedChecks: passedCount,
      failedChecks: failedCount,
      criticalFailures: criticalFailures.length,
      highFailures: highFailures.length,
      securityMode,
    },
    passed
      ? 'Security audit completed successfully'
      : 'Security audit completed with failures'
  );

  // Log individual failures
  for (const failure of criticalFailures) {
    logger.error(
      { checkId: failure.id, severity: failure.severity },
      `CRITICAL: ${failure.name} - ${failure.message}`
    );
  }

  for (const failure of highFailures) {
    logger.warn(
      { checkId: failure.id, severity: failure.severity },
      `HIGH: ${failure.name} - ${failure.message}`
    );
  }

  return {
    passed,
    checks,
    criticalFailures,
    warnings,
    recommendations,
  };
}

/**
 * Run security audit and throw if critical failures are found
 *
 * Convenience function for startup validation that throws an error
 * if the configuration doesn't meet security requirements.
 *
 * @param config - The configuration to audit
 * @throws Error if critical security checks fail
 *
 * @example
 * ```typescript
 * // In application startup
 * try {
 *   await assertSecureConfig();
 *   console.log('Security configuration validated');
 * } catch (error) {
 *   console.error('Security validation failed:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export async function assertSecureConfig(config?: Config): Promise<void> {
  const result = await runSecurityAudit(config);

  if (!result.passed) {
    const failures = [...result.criticalFailures, ...result.warnings.filter(w => w.severity === 'high')];
    const messages = failures.map((f) => `${f.severity.toUpperCase()}: ${f.name} - ${f.message}`);

    throw new Error(
      `Security configuration validation failed:\n${messages.join('\n')}\n\n` +
      `Recommendations:\n${result.recommendations.join('\n')}`
    );
  }
}

/**
 * Get security audit summary for health checks
 *
 * Returns a lightweight summary suitable for health check endpoints.
 *
 * @param config - The configuration to audit
 * @returns Summary object with passed status and counts
 */
export async function getSecurityAuditSummary(config?: Config): Promise<{
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  criticalFailures: number;
  highFailures: number;
  mediumWarnings: number;
  lowWarnings: number;
}> {
  const result = await runSecurityAudit(config);

  return {
    passed: result.passed,
    totalChecks: result.checks.length,
    passedChecks: result.checks.filter((c) => c.passed).length,
    criticalFailures: result.criticalFailures.length,
    highFailures: result.checks.filter((c) => !c.passed && c.severity === 'high').length,
    mediumWarnings: result.checks.filter((c) => !c.passed && c.severity === 'medium').length,
    lowWarnings: result.checks.filter((c) => !c.passed && c.severity === 'low').length,
  };
}
