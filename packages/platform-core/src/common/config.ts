/**
 * Configuration management for Vorion
 */

import { z } from 'zod';
import { randomBytes } from 'crypto';

/**
 * Environment configuration schema
 */
const configSchema = z.object({
  env: z.enum(['development', 'staging', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  app: z.object({
    name: z.string().default('vorion'),
    version: z.string().default('0.1.0'),
    environment: z.string().default('development'),
  }),

  telemetry: z.object({
    enabled: z.coerce.boolean().default(false),
    serviceName: z.string().default('vorion-intent'),
    otlpEndpoint: z.string().default('http://localhost:4318/v1/traces'),
    otlpHeaders: z.record(z.string()).default({}),
    sampleRate: z.coerce.number().min(0).max(1).default(1.0),
  }),

  api: z.object({
    port: z.coerce.number().default(3000),
    host: z.string().default('localhost'),
    basePath: z.string().default('/api/v1'),
    timeout: z.coerce.number().default(30000),
    rateLimit: z.coerce.number().default(1000),
    /** Separate rate limit for bulk operations (default: 10 requests per minute) */
    bulkRateLimit: z.coerce.number().default(10),
  }),

  cors: z.object({
    /** Allowed origins for CORS (used in non-production environments) */
    allowedOrigins: z.array(z.string()).default(['http://localhost:3000', 'http://localhost:5173']),
  }).default({}),

  health: z.object({
    // Per-check timeout (database, redis individual checks)
    checkTimeoutMs: z.coerce.number().default(5000),
    // Overall /ready endpoint timeout
    readyTimeoutMs: z.coerce.number().default(10000),
    // Liveness check timeout
    livenessTimeoutMs: z.coerce.number().default(1000),
  }),

  database: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(5432),
    name: z.string().default('vorion'),
    user: z.string().default('vorion'),
    password: z.string().default(''),
    poolMin: z.coerce.number().min(1).default(10),
    poolMax: z.coerce.number().min(1).default(50),
    poolIdleTimeoutMs: z.coerce.number().min(0).default(10000),
    poolConnectionTimeoutMs: z.coerce.number().min(0).default(5000),
    metricsIntervalMs: z.coerce.number().min(1000).default(5000),
    /**
     * Default statement timeout for database queries in milliseconds.
     * Queries exceeding this timeout will be cancelled by PostgreSQL.
     * Default: 30000 (30 seconds)
     */
    statementTimeoutMs: z.coerce.number().min(1000).max(600000).default(30000),
    /**
     * Extended timeout for long-running queries (reports, exports) in milliseconds.
     * Default: 120000 (2 minutes)
     */
    longQueryTimeoutMs: z.coerce.number().min(1000).max(600000).default(120000),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
    db: z.coerce.number().default(0),
  }),

  jwt: z.object({
    secret: z.string().min(32),
    expiration: z.string().default('1h'),
    refreshExpiration: z.string().default('7d'),
    requireJti: z.coerce.boolean().default(false),
  }).refine(
    (jwt) => {
      const env = process.env['VORION_ENV'] || 'development';
      const isInsecureDefault = jwt.secret === 'development-secret-change-in-production';
      // Block insecure default in production/staging
      if ((env === 'production' || env === 'staging') && isInsecureDefault) {
        return false;
      }
      return true;
    },
    { message: 'VORION_JWT_SECRET must be set to a secure value in production/staging' }
  ),

  proof: z.object({
    storage: z.enum(['local', 's3', 'gcs']).default('local'),
    localPath: z.string().default('./data/proofs'),
    retentionDays: z.coerce.number().default(2555),
  }),

  trust: z.object({
    calcInterval: z.coerce.number().default(1000),
    cacheTtl: z.coerce.number().default(30),
    /** @deprecated Inactivity decay now uses stepped milestones. See DECAY_MILESTONES in trust-engine. */
    decayRate: z.coerce.number().default(0.01).optional(),
  }),

  basis: z.object({
    evalTimeout: z.coerce.number().default(100),
    maxRules: z.coerce.number().default(10000),
    cacheEnabled: z.coerce.boolean().default(true),
  }),

  cognigate: z.object({
    timeout: z.coerce.number().default(300000),
    maxConcurrent: z.coerce.number().default(100),
    maxMemoryMb: z.coerce.number().default(512),
    maxCpuPercent: z.coerce.number().default(50),
  }),

  intent: z.object({
    defaultNamespace: z.string().default('default'),
    namespaceRouting: z.record(z.string(), z.string()).default({}),
    dedupeTtlSeconds: z.coerce.number().default(600),
    /**
     * HMAC secret for secure deduplication hash computation.
     * REQUIRED in production/staging to prevent hash prediction attacks.
     * Generate with: openssl rand -base64 32
     */
    dedupeSecret: z.string().min(32).optional(),
    /**
     * Timestamp window for deduplication in seconds.
     * Hashes are computed with a time bucket to prevent replay attacks
     * while allowing legitimate retries within the window.
     * Default: 300 seconds (5 minutes)
     */
    dedupeTimestampWindowSeconds: z.coerce.number().min(60).max(3600).default(300),
    sensitivePaths: z.array(z.string()).default([
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'credential',
      'ssn',
      'socialSecurityNumber',
      'creditCard',
      'credit_card',
      'cardNumber',
      'card_number',
      'cvv',
      'pin',
      'privateKey',
      'private_key',
    ]),
    defaultMaxInFlight: z.coerce.number().default(1000),
    tenantMaxInFlight: z.record(z.coerce.number()).default({}),
    // Queue configuration
    queueConcurrency: z.coerce.number().default(5),
    jobTimeoutMs: z.coerce.number().default(30000),
    maxRetries: z.coerce.number().default(3),
    retryBackoffMs: z.coerce.number().default(1000),
    // Queue health check threshold - max queue depth before marking unhealthy
    queueDepthThreshold: z.coerce.number().min(100).max(100000).default(10000),
    eventRetentionDays: z.coerce.number().default(90),
    // Encryption at rest
    encryptContext: z.coerce.boolean().default(true),
    // Trust gates: minimum trust level required per intent type
    trustGates: z.record(z.coerce.number().min(0).max(4)).default({}),
    defaultMinTrustLevel: z.coerce.number().min(0).max(4).default(0),
    // Re-validate trust at decision stage
    revalidateTrustAtDecision: z.coerce.boolean().default(true),
    // GDPR compliance
    softDeleteRetentionDays: z.coerce.number().default(30),
    // Escalation settings
    escalationTimeout: z.string().default('PT1H'), // ISO 8601 duration (1 hour)
    escalationDefaultRecipient: z.string().default('governance-team'),
    // Scheduled jobs
    cleanupCronSchedule: z.string().default('0 2 * * *'), // 2 AM daily
    timeoutCheckCronSchedule: z.string().default('*/5 * * * *'), // Every 5 minutes
    // Graceful shutdown timeout in milliseconds
    // Maximum time to wait for in-flight requests and workers to complete during shutdown
    shutdownTimeoutMs: z.coerce.number().min(5000).max(300000).default(30000),
    // Rate limiting configuration per intent type
    rateLimits: z.object({
      default: z.object({
        limit: z.coerce.number().min(1).default(100),
        windowSeconds: z.coerce.number().min(1).default(60),
      }).default({}),
      highRisk: z.object({
        limit: z.coerce.number().min(1).default(10),
        windowSeconds: z.coerce.number().min(1).default(60),
      }).default({}),
      dataExport: z.object({
        limit: z.coerce.number().min(1).default(5),
        windowSeconds: z.coerce.number().min(1).default(60),
      }).default({}),
      adminAction: z.object({
        limit: z.coerce.number().min(1).default(20),
        windowSeconds: z.coerce.number().min(1).default(60),
      }).default({}),
    }).default({}),
    // Policy evaluation circuit breaker configuration (legacy - prefer circuitBreaker.policyEngine)
    policyCircuitBreaker: z.object({
      /** Number of consecutive failures before opening the circuit (default: 5) */
      failureThreshold: z.coerce.number().min(1).max(100).default(5),
      /** Time in milliseconds before attempting to close the circuit (default: 30000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(300000).default(30000),
    }).default({}),
  }),

  // Per-service circuit breaker configuration
  circuitBreaker: z.object({
    database: z.object({
      /** Number of failures before opening the circuit (default: 5) */
      failureThreshold: z.coerce.number().min(1).max(100).default(5),
      /** Time in ms before attempting to close the circuit (default: 30000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(600000).default(30000),
      /** Maximum attempts in half-open state before reopening (default: 3) */
      halfOpenMaxAttempts: z.coerce.number().min(1).max(20).default(3),
      /** Time window in ms to monitor for failures (default: 60000) */
      monitorWindowMs: z.coerce.number().min(1000).max(600000).default(60000),
    }).default({}),
    redis: z.object({
      /** Number of failures before opening the circuit (default: 10) */
      failureThreshold: z.coerce.number().min(1).max(100).default(10),
      /** Time in ms before attempting to close the circuit (default: 10000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(600000).default(10000),
      /** Maximum attempts in half-open state before reopening (default: 5) */
      halfOpenMaxAttempts: z.coerce.number().min(1).max(20).default(5),
      /** Time window in ms to monitor for failures (default: 30000) */
      monitorWindowMs: z.coerce.number().min(1000).max(600000).default(30000),
    }).default({}),
    webhook: z.object({
      /** Number of failures before opening the circuit (default: 3) */
      failureThreshold: z.coerce.number().min(1).max(100).default(3),
      /** Time in ms before attempting to close the circuit (default: 60000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(600000).default(60000),
      /** Maximum attempts in half-open state before reopening (default: 2) */
      halfOpenMaxAttempts: z.coerce.number().min(1).max(20).default(2),
      /** Time window in ms to monitor for failures (default: 120000) */
      monitorWindowMs: z.coerce.number().min(1000).max(600000).default(120000),
    }).default({}),
    policyEngine: z.object({
      /** Number of failures before opening the circuit (default: 5) */
      failureThreshold: z.coerce.number().min(1).max(100).default(5),
      /** Time in ms before attempting to close the circuit (default: 15000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(600000).default(15000),
      /** Maximum attempts in half-open state before reopening (default: 3) */
      halfOpenMaxAttempts: z.coerce.number().min(1).max(20).default(3),
      /** Time window in ms to monitor for failures (default: 60000) */
      monitorWindowMs: z.coerce.number().min(1000).max(600000).default(60000),
    }).default({}),
    trustEngine: z.object({
      /** Number of failures before opening the circuit (default: 5) */
      failureThreshold: z.coerce.number().min(1).max(100).default(5),
      /** Time in ms before attempting to close the circuit (default: 15000) */
      resetTimeoutMs: z.coerce.number().min(1000).max(600000).default(15000),
      /** Maximum attempts in half-open state before reopening (default: 3) */
      halfOpenMaxAttempts: z.coerce.number().min(1).max(20).default(3),
      /** Time window in ms to monitor for failures (default: 60000) */
      monitorWindowMs: z.coerce.number().min(1000).max(600000).default(60000),
    }).default({}),
  }).default({}),

  webhook: z.object({
    // HTTP request timeout for webhook delivery (default: 10s, min: 1s, max: 60s)
    timeoutMs: z.coerce.number().min(1000).max(60000).default(10000),
    // Number of retry attempts for failed webhook deliveries
    retryAttempts: z.coerce.number().min(0).max(10).default(3),
    // Base delay between retries in milliseconds (exponential backoff applied)
    retryDelayMs: z.coerce.number().min(100).max(30000).default(1000),
    // Allow DNS changes between registration and delivery (default: false for security)
    // When false, webhooks are blocked if the resolved IP changes (DNS rebinding protection)
    allowDnsChange: z.coerce.boolean().default(false),
    // Circuit breaker: number of consecutive failures before opening circuit (default: 5)
    circuitFailureThreshold: z.coerce.number().min(1).max(100).default(5),
    // Circuit breaker: time in ms to wait before trying again when circuit is open (default: 5 min)
    circuitResetTimeoutMs: z.coerce.number().min(1000).max(3600000).default(300000),
    // Maximum number of webhooks to deliver in parallel per tenant (default: 10)
    deliveryConcurrency: z.coerce.number().min(1).max(50).default(10),
    // SSRF Protection: Allowlist of domains permitted for webhook delivery
    // If non-empty, only these domains (and their subdomains) are allowed
    // Default includes common webhook destinations (Slack, Discord, PagerDuty, etc.)
    allowedDomains: z.array(z.string()).default([
      // Common webhook/notification services
      'hooks.slack.com',
      'discord.com',
      'discordapp.com',
      'api.pagerduty.com',
      'events.pagerduty.com',
      'api.opsgenie.com',
      'api.victorops.com',
      // Automation platforms
      'hooks.zapier.com',
      'maker.ifttt.com',
      'connect.microsoft.com',
      // Development/DevOps
      'api.github.com',
      'gitlab.com',
      'bitbucket.org',
      'circleci.com',
      'api.datadoghq.com',
      'api.newrelic.com',
    ]),
    // Additional blocked domains (beyond default private/internal patterns)
    // Use this to block specific external domains if needed
    blockedDomains: z.array(z.string()).default([]),
    // If true, enforce domain allowlist strictly (only allowed domains can receive webhooks)
    // If false, domain allowlist is ignored and any valid external domain is allowed
    enforceAllowlist: z.coerce.boolean().default(false),
  }),

  gdpr: z.object({
    /** Concurrency for GDPR export worker (default: max(2, CPU count)) */
    exportConcurrency: z.coerce.number().min(1).max(32).optional(),
  }).default({}),

  audit: z.object({
    // Enterprise compliance: 365 days (1 year) minimum retention
    // For financial compliance (SOX, etc.), consider 2555 days (7 years)
    retentionDays: z.coerce.number().min(30).default(365),
    // Enable archival instead of hard delete for compliance
    archiveEnabled: z.coerce.boolean().default(true),
    // Move records to archived state after this many days
    archiveAfterDays: z.coerce.number().min(1).default(90),
    // Batch size for cleanup operations
    cleanupBatchSize: z.coerce.number().min(100).max(10000).default(1000),
  }),

  encryption: z.object({
    /**
     * Dedicated encryption key for data at rest (required in production/staging)
     * MUST be at least 32 characters. Generate with: openssl rand -base64 32
     */
    key: z.string().min(32).optional(),
    /**
     * Salt for PBKDF2 key derivation (required in production/staging)
     * MUST be at least 16 characters. Generate with: openssl rand -base64 16
     */
    salt: z.string().min(16).optional(),
    algorithm: z.string().default('aes-256-gcm'),
    /**
     * PBKDF2 iterations - higher is more secure but slower
     * Minimum 100,000 recommended by OWASP
     */
    pbkdf2Iterations: z.coerce.number().min(10000).default(100000),
    /**
     * Key derivation version for future algorithm changes
     * v1 = SHA-256 (legacy, insecure)
     * v2 = PBKDF2-SHA512 (current)
     */
    kdfVersion: z.coerce.number().min(1).max(2).default(2),
  }).default({}),

  csrf: z.object({
    /** Whether CSRF protection is enabled */
    enabled: z.coerce.boolean().default(true),
    /** Secret key for HMAC signing (min 32 chars, auto-generated if not provided) */
    secret: z.string().min(32).optional(),
    /** Name of the CSRF cookie */
    cookieName: z.string().default('__vorion_csrf'),
    /** Name of the header containing the CSRF token */
    headerName: z.string().default('X-CSRF-Token'),
    /** Token validity duration in milliseconds */
    tokenTTL: z.coerce.number().default(3600000),
    /** Paths to exclude from CSRF protection (supports glob patterns) */
    excludePaths: z.array(z.string()).default(['/api/webhooks/*', '/api/health', '/api/metrics']),
    /** HTTP methods to exclude from CSRF validation */
    excludeMethods: z.array(z.string()).default(['GET', 'HEAD', 'OPTIONS']),
  }).default({}),

  session: z.object({
    /** Whether server-side fingerprint validation is enabled */
    fingerprintEnabled: z.coerce.boolean().default(true),
    /**
     * Strictness level for fingerprint validation: 'warn' logs mismatches, 'block' rejects the request.
     * SECURITY: Default is 'block' to actively prevent session hijacking attempts.
     * Use 'warn' only during initial rollout to identify false positives before enforcement.
     * In 'block' mode, requests with mismatched fingerprints are rejected with 403 Forbidden.
     */
    fingerprintStrictness: z.enum(['warn', 'block']).default('block'),
    /** Components to include in fingerprint computation */
    fingerprintComponents: z.array(z.string()).default(['userAgent', 'acceptLanguage']),
  }).default({}),

  lite: z.object({
    /**
     * Enable lite mode for simplified single-instance deployments.
     * When enabled, Vorion can run with reduced infrastructure requirements.
     */
    enabled: z.coerce.boolean().default(false),
    /**
     * Automatically generate secure secrets for development when not provided.
     * MUST be false in production.
     */
    autoGenerateSecrets: z.coerce.boolean().default(true),
    /**
     * Directory for local data storage (proofs, temp files, etc.)
     */
    dataDirectory: z.string().default('./data'),
    /**
     * Allow running without Redis using in-memory adapters.
     * Useful for development and single-instance deployments.
     * Note: In-memory state is NOT shared across instances.
     */
    redisOptional: z.coerce.boolean().default(true),
  }).default({}),

  hsm: z.object({
    /**
     * Enable HSM integration for FIPS 140-3 compliant key management.
     * When enabled, cryptographic operations use HSM-backed keys.
     */
    enabled: z.coerce.boolean().default(false),
    /**
     * HSM provider type: aws, azure, gcp, thales, softhsm, or pkcs11.
     * Use 'softhsm' for development/testing.
     */
    provider: z.enum(['aws', 'azure', 'gcp', 'thales', 'softhsm', 'pkcs11']).default('softhsm'),
    /**
     * Enable automatic failover to backup HSM providers.
     */
    enableFailover: z.coerce.boolean().default(true),
    /**
     * Failover providers in priority order (comma-separated).
     */
    failoverProviders: z.array(z.enum(['aws', 'azure', 'gcp', 'thales', 'softhsm'])).default([]),
    /**
     * Health check interval in milliseconds.
     */
    healthCheckIntervalMs: z.coerce.number().min(5000).max(300000).default(30000),
    /**
     * Enable key metadata caching.
     */
    enableKeyCache: z.coerce.boolean().default(true),
    /**
     * Key cache TTL in seconds.
     */
    keyCacheTTLSeconds: z.coerce.number().min(60).max(3600).default(300),
    /**
     * Enable HSM operation audit logging.
     */
    enableAuditLogging: z.coerce.boolean().default(true),
    /**
     * Enable FIPS 140-3 compliance mode (restricts to FIPS-approved algorithms).
     */
    fipsMode: z.coerce.boolean().default(false),
    /**
     * Connection timeout in milliseconds.
     */
    connectionTimeoutMs: z.coerce.number().min(1000).max(120000).default(30000),
    /**
     * Operation timeout in milliseconds.
     */
    operationTimeoutMs: z.coerce.number().min(1000).max(300000).default(60000),
    /**
     * AWS CloudHSM configuration.
     */
    aws: z.object({
      clusterId: z.string().optional(),
      region: z.string().default('us-east-1'),
      cryptoUser: z.string().optional(),
    }).default({}),
    /**
     * Azure Managed HSM configuration.
     */
    azure: z.object({
      hsmName: z.string().optional(),
      region: z.string().default('eastus'),
      tenantId: z.string().optional(),
      clientId: z.string().optional(),
    }).default({}),
    /**
     * GCP Cloud HSM configuration.
     */
    gcp: z.object({
      projectId: z.string().optional(),
      location: z.string().default('us-central1'),
      keyRing: z.string().optional(),
    }).default({}),
    /**
     * Thales Luna HSM configuration.
     */
    thales: z.object({
      partitionName: z.string().optional(),
      hsmIpAddresses: z.array(z.string()).default([]),
    }).default({}),
    /**
     * PKCS#11 token configuration (for smart cards/hardware tokens).
     */
    pkcs11: z.object({
      libraryPath: z.string().optional(),
      slot: z.coerce.number().optional(),
      fipsMode: z.coerce.boolean().default(false),
    }).default({}),
  }).default({}),
}).superRefine((config, ctx) => {
  const env = config.env;
  const isProductionOrStaging = env === 'production' || env === 'staging';

  // Validate encryption key is set when encryption is enabled
  if (config.intent.encryptContext && !config.encryption.key) {
    if (isProductionOrStaging) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VORION_ENCRYPTION_KEY must be set when encryption is enabled in production/staging',
        path: ['encryption', 'key'],
      });
    }
  }

  // Validate encryption salt is set when using PBKDF2 (v2) in production
  if (config.encryption.kdfVersion === 2 && !config.encryption.salt) {
    if (isProductionOrStaging) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VORION_ENCRYPTION_SALT must be set when using PBKDF2 key derivation in production/staging',
        path: ['encryption', 'salt'],
      });
    }
  }

  // Warn if encryption key is set but fallback to v1 (insecure) in production
  if (isProductionOrStaging && config.encryption.kdfVersion === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'VORION_ENCRYPTION_KDF_VERSION=1 (legacy SHA-256) is insecure. Migrate to version 2 (PBKDF2-SHA512)',
      path: ['encryption', 'kdfVersion'],
    });
  }

  // Validate database pool settings
  if (config.database.poolMin > config.database.poolMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Database poolMin cannot exceed poolMax',
      path: ['database', 'poolMin'],
    });
  }

  // Validate retention settings
  if (config.intent.softDeleteRetentionDays > config.intent.eventRetentionDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'softDeleteRetentionDays cannot exceed eventRetentionDays',
      path: ['intent', 'softDeleteRetentionDays'],
    });
  }

  // Validate audit archive settings
  if (config.audit.archiveAfterDays >= config.audit.retentionDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'audit.archiveAfterDays must be less than audit.retentionDays',
      path: ['audit', 'archiveAfterDays'],
    });
  }

  // Validate dedupe secret is set in production/staging (security requirement)
  if (isProductionOrStaging && !config.intent.dedupeSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'VORION_DEDUPE_SECRET must be set in production/staging to prevent hash prediction attacks',
      path: ['intent', 'dedupeSecret'],
    });
  }

  // Circuit breaker validation: halfOpenMaxAttempts must be less than failureThreshold
  // This ensures the circuit can properly transition from half-open to closed state
  const circuitBreakerServices = ['database', 'redis', 'webhook', 'policyEngine', 'trustEngine'] as const;
  for (const service of circuitBreakerServices) {
    const cbConfig = config.circuitBreaker[service];
    if (cbConfig.halfOpenMaxAttempts >= cbConfig.failureThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Circuit breaker ${service}: halfOpenMaxAttempts (${cbConfig.halfOpenMaxAttempts}) must be less than failureThreshold (${cbConfig.failureThreshold}) to allow proper circuit state transitions`,
        path: ['circuitBreaker', service, 'halfOpenMaxAttempts'],
      });
    }
    if (cbConfig.resetTimeoutMs <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Circuit breaker ${service}: resetTimeoutMs must be greater than 0`,
        path: ['circuitBreaker', service, 'resetTimeoutMs'],
      });
    }
  }

  // Lite mode validation: autoGenerateSecrets must be false in production
  if (isProductionOrStaging && config.lite.enabled && config.lite.autoGenerateSecrets) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'VORION_LITE_AUTO_GENERATE_SECRETS must be false in production/staging. Use proper secret management.',
      path: ['lite', 'autoGenerateSecrets'],
    });
  }

  // HSM validation for production
  if (isProductionOrStaging && config.hsm.enabled) {
    // Validate that SoftHSM is not used in production
    if (config.hsm.provider === 'softhsm') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SoftHSM is not suitable for production. Use aws, azure, gcp, thales, or pkcs11 provider.',
        path: ['hsm', 'provider'],
      });
    }

    // Validate provider-specific configuration
    switch (config.hsm.provider) {
      case 'aws':
        if (!config.hsm.aws.clusterId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_AWS_CLUSTER_ID is required for AWS CloudHSM in production',
            path: ['hsm', 'aws', 'clusterId'],
          });
        }
        if (!config.hsm.aws.cryptoUser) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_AWS_CRYPTO_USER is required for AWS CloudHSM in production',
            path: ['hsm', 'aws', 'cryptoUser'],
          });
        }
        break;
      case 'azure':
        if (!config.hsm.azure.hsmName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_AZURE_HSM_NAME is required for Azure HSM in production',
            path: ['hsm', 'azure', 'hsmName'],
          });
        }
        if (!config.hsm.azure.tenantId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_AZURE_TENANT_ID is required for Azure HSM in production',
            path: ['hsm', 'azure', 'tenantId'],
          });
        }
        break;
      case 'gcp':
        if (!config.hsm.gcp.projectId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_GCP_PROJECT_ID is required for GCP HSM in production',
            path: ['hsm', 'gcp', 'projectId'],
          });
        }
        if (!config.hsm.gcp.keyRing) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_GCP_KEY_RING is required for GCP HSM in production',
            path: ['hsm', 'gcp', 'keyRing'],
          });
        }
        break;
      case 'thales':
        if (!config.hsm.thales.partitionName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_THALES_PARTITION_NAME is required for Thales HSM in production',
            path: ['hsm', 'thales', 'partitionName'],
          });
        }
        if (config.hsm.thales.hsmIpAddresses.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_THALES_IP_ADDRESSES is required for Thales HSM in production',
            path: ['hsm', 'thales', 'hsmIpAddresses'],
          });
        }
        break;
      case 'pkcs11':
        if (!config.hsm.pkcs11.libraryPath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'VORION_HSM_PKCS11_LIBRARY_PATH is required for PKCS#11 in production',
            path: ['hsm', 'pkcs11', 'libraryPath'],
          });
        }
        break;
    }

    // FIPS mode validation
    if (config.hsm.fipsMode && config.hsm.provider === 'softhsm') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FIPS mode requires a hardware HSM provider (aws, azure, gcp, thales, or pkcs11)',
        path: ['hsm', 'fipsMode'],
      });
    }
  }
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load configuration from environment
 */
export function loadConfig(): Config {
  const env = process.env['VORION_ENV'] ?? 'development';
  const isProduction = env === 'production' || env === 'staging';

  // Critical security check: JWT secret must be set in production
  const jwtSecret = process.env['VORION_JWT_SECRET'];
  if (isProduction && !jwtSecret) {
    throw new Error(
      'CRITICAL: VORION_JWT_SECRET environment variable must be set in production/staging. ' +
      'Generate a secure secret with: openssl rand -base64 64'
    );
  }
  if (isProduction && jwtSecret && jwtSecret.length < 32) {
    throw new Error(
      'CRITICAL: VORION_JWT_SECRET must be at least 32 characters in production/staging.'
    );
  }

  // SE-C1: Entropy check for JWT secret - not just length check
  // Reject weak secrets that could bypass validation (e.g., repeated characters)
  if (isProduction && jwtSecret) {
    const entropy = calculateSecretEntropy(jwtSecret);
    const minEntropyBits = 128; // Minimum 128 bits of entropy for production
    if (entropy < minEntropyBits) {
      throw new Error(
        `CRITICAL: VORION_JWT_SECRET has insufficient entropy (${Math.floor(entropy)} bits, need ${minEntropyBits}+). ` +
        'Use a truly random secret: openssl rand -base64 64'
      );
    }
  }

  return configSchema.parse({
    env,
    logLevel: process.env['VORION_LOG_LEVEL'],

    app: {
      name: process.env['VORION_APP_NAME'],
      version: process.env['VORION_APP_VERSION'],
      environment: process.env['VORION_ENV'],
    },

    telemetry: {
      enabled: process.env['VORION_TELEMETRY_ENABLED'],
      serviceName: process.env['VORION_TELEMETRY_SERVICE_NAME'],
      otlpEndpoint: process.env['VORION_OTLP_ENDPOINT'],
      otlpHeaders: parseJsonRecord(process.env['VORION_OTLP_HEADERS']),
      sampleRate: process.env['VORION_TELEMETRY_SAMPLE_RATE'],
    },

    api: {
      port: process.env['VORION_API_PORT'],
      host: process.env['VORION_API_HOST'],
      basePath: process.env['VORION_API_BASE_PATH'],
      timeout: process.env['VORION_API_TIMEOUT'],
      rateLimit: process.env['VORION_API_RATE_LIMIT'],
      bulkRateLimit: process.env['VORION_API_BULK_RATE_LIMIT'],
    },

    cors: {
      allowedOrigins: parseListOrUndefined(process.env['VORION_CORS_ALLOWED_ORIGINS']),
    },

    health: {
      checkTimeoutMs: process.env['VORION_HEALTH_CHECK_TIMEOUT_MS'],
      readyTimeoutMs: process.env['VORION_READY_CHECK_TIMEOUT_MS'],
      livenessTimeoutMs: process.env['VORION_LIVENESS_CHECK_TIMEOUT_MS'],
    },

    database: {
      host: process.env['VORION_DB_HOST'],
      port: process.env['VORION_DB_PORT'],
      name: process.env['VORION_DB_NAME'],
      user: process.env['VORION_DB_USER'],
      password: process.env['VORION_DB_PASSWORD'],
      poolMin: process.env['VORION_DB_POOL_MIN'],
      poolMax: process.env['VORION_DB_POOL_MAX'],
      poolIdleTimeoutMs: process.env['VORION_DB_POOL_IDLE_TIMEOUT'],
      poolConnectionTimeoutMs: process.env['VORION_DB_POOL_CONNECTION_TIMEOUT'],
      metricsIntervalMs: process.env['VORION_DB_METRICS_INTERVAL_MS'],
      statementTimeoutMs: process.env['VORION_DB_STATEMENT_TIMEOUT_MS'],
      longQueryTimeoutMs: process.env['VORION_DB_LONG_QUERY_TIMEOUT_MS'],
    },

    redis: {
      host: process.env['VORION_REDIS_HOST'],
      port: process.env['VORION_REDIS_PORT'],
      password: process.env['VORION_REDIS_PASSWORD'],
      db: process.env['VORION_REDIS_DB'],
    },

    jwt: {
      // Only use fallback in development - production requires explicit secret
      secret: jwtSecret ?? (isProduction ? '' : 'dev-only-insecure-secret-do-not-use-in-prod'),
      expiration: process.env['VORION_JWT_EXPIRATION'],
      refreshExpiration: process.env['VORION_REFRESH_TOKEN_EXPIRATION'],
      requireJti: process.env['VORION_JWT_REQUIRE_JTI'],
    },

    proof: {
      storage: process.env['VORION_PROOF_STORAGE'] as 'local' | 's3' | 'gcs',
      localPath: process.env['VORION_PROOF_LOCAL_PATH'],
      retentionDays: process.env['VORION_PROOF_RETENTION_DAYS'],
    },

    trust: {
      calcInterval: process.env['VORION_TRUST_CALC_INTERVAL'],
      cacheTtl: process.env['VORION_TRUST_CACHE_TTL'],
      decayRate: process.env['VORION_TRUST_DECAY_RATE'],
    },

    basis: {
      evalTimeout: process.env['VORION_BASIS_EVAL_TIMEOUT'],
      maxRules: process.env['VORION_BASIS_MAX_RULES'],
      cacheEnabled: process.env['VORION_BASIS_CACHE_ENABLED'],
    },

    cognigate: {
      timeout: process.env['VORION_COGNIGATE_TIMEOUT'],
      maxConcurrent: process.env['VORION_COGNIGATE_MAX_CONCURRENT'],
      maxMemoryMb: process.env['VORION_COGNIGATE_MAX_MEMORY_MB'],
      maxCpuPercent: process.env['VORION_COGNIGATE_MAX_CPU_PERCENT'],
    },

    intent: {
      defaultNamespace: process.env['VORION_INTENT_DEFAULT_NAMESPACE'],
      namespaceRouting: parseJsonRecord(process.env['VORION_INTENT_NAMESPACE_ROUTING']),
      dedupeTtlSeconds: process.env['VORION_INTENT_DEDUPE_TTL'],
      dedupeSecret: process.env['VORION_DEDUPE_SECRET'],
      dedupeTimestampWindowSeconds: process.env['VORION_DEDUPE_TIMESTAMP_WINDOW_SECONDS'],
      sensitivePaths: parseList(process.env['VORION_INTENT_SENSITIVE_PATHS']),
      defaultMaxInFlight: process.env['VORION_INTENT_DEFAULT_MAX_IN_FLIGHT'],
      tenantMaxInFlight: parseNumberRecord(
        process.env['VORION_INTENT_TENANT_LIMITS']
      ),
      queueConcurrency: process.env['VORION_INTENT_QUEUE_CONCURRENCY'],
      jobTimeoutMs: process.env['VORION_INTENT_JOB_TIMEOUT_MS'],
      maxRetries: process.env['VORION_INTENT_MAX_RETRIES'],
      retryBackoffMs: process.env['VORION_INTENT_RETRY_BACKOFF_MS'],
      queueDepthThreshold: process.env['VORION_INTENT_QUEUE_DEPTH_THRESHOLD'],
      eventRetentionDays: process.env['VORION_INTENT_EVENT_RETENTION_DAYS'],
      encryptContext: process.env['VORION_INTENT_ENCRYPT_CONTEXT'],
      trustGates: parseNumberRecord(process.env['VORION_INTENT_TRUST_GATES']),
      defaultMinTrustLevel: process.env['VORION_INTENT_DEFAULT_MIN_TRUST_LEVEL'],
      revalidateTrustAtDecision: process.env['VORION_INTENT_REVALIDATE_TRUST'],
      softDeleteRetentionDays: process.env['VORION_INTENT_SOFT_DELETE_RETENTION_DAYS'],
      escalationTimeout: process.env['VORION_INTENT_ESCALATION_TIMEOUT'],
      escalationDefaultRecipient: process.env['VORION_INTENT_ESCALATION_RECIPIENT'],
      cleanupCronSchedule: process.env['VORION_INTENT_CLEANUP_CRON'],
      timeoutCheckCronSchedule: process.env['VORION_INTENT_TIMEOUT_CHECK_CRON'],
      shutdownTimeoutMs: process.env['VORION_SHUTDOWN_TIMEOUT_MS'],
      rateLimits: {
        default: {
          limit: process.env['VORION_RATELIMIT_DEFAULT_LIMIT'],
          windowSeconds: process.env['VORION_RATELIMIT_DEFAULT_WINDOW'],
        },
        highRisk: {
          limit: process.env['VORION_RATELIMIT_HIGH_RISK_LIMIT'],
          windowSeconds: process.env['VORION_RATELIMIT_HIGH_RISK_WINDOW'],
        },
        dataExport: {
          limit: process.env['VORION_RATELIMIT_DATA_EXPORT_LIMIT'],
          windowSeconds: process.env['VORION_RATELIMIT_DATA_EXPORT_WINDOW'],
        },
        adminAction: {
          limit: process.env['VORION_RATELIMIT_ADMIN_ACTION_LIMIT'],
          windowSeconds: process.env['VORION_RATELIMIT_ADMIN_ACTION_WINDOW'],
        },
      },
      policyCircuitBreaker: {
        failureThreshold: process.env['VORION_POLICY_CIRCUIT_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_POLICY_CIRCUIT_RESET_TIMEOUT_MS'],
      },
    },

    circuitBreaker: {
      database: {
        failureThreshold: process.env['VORION_CB_DATABASE_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_CB_DATABASE_RESET_TIMEOUT_MS'],
        halfOpenMaxAttempts: process.env['VORION_CB_DATABASE_HALF_OPEN_MAX_ATTEMPTS'],
        monitorWindowMs: process.env['VORION_CB_DATABASE_MONITOR_WINDOW_MS'],
      },
      redis: {
        failureThreshold: process.env['VORION_CB_REDIS_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_CB_REDIS_RESET_TIMEOUT_MS'],
        halfOpenMaxAttempts: process.env['VORION_CB_REDIS_HALF_OPEN_MAX_ATTEMPTS'],
        monitorWindowMs: process.env['VORION_CB_REDIS_MONITOR_WINDOW_MS'],
      },
      webhook: {
        failureThreshold: process.env['VORION_CB_WEBHOOK_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_CB_WEBHOOK_RESET_TIMEOUT_MS'],
        halfOpenMaxAttempts: process.env['VORION_CB_WEBHOOK_HALF_OPEN_MAX_ATTEMPTS'],
        monitorWindowMs: process.env['VORION_CB_WEBHOOK_MONITOR_WINDOW_MS'],
      },
      policyEngine: {
        failureThreshold: process.env['VORION_CB_POLICY_ENGINE_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_CB_POLICY_ENGINE_RESET_TIMEOUT_MS'],
        halfOpenMaxAttempts: process.env['VORION_CB_POLICY_ENGINE_HALF_OPEN_MAX_ATTEMPTS'],
        monitorWindowMs: process.env['VORION_CB_POLICY_ENGINE_MONITOR_WINDOW_MS'],
      },
      trustEngine: {
        failureThreshold: process.env['VORION_CB_TRUST_ENGINE_FAILURE_THRESHOLD'],
        resetTimeoutMs: process.env['VORION_CB_TRUST_ENGINE_RESET_TIMEOUT_MS'],
        halfOpenMaxAttempts: process.env['VORION_CB_TRUST_ENGINE_HALF_OPEN_MAX_ATTEMPTS'],
        monitorWindowMs: process.env['VORION_CB_TRUST_ENGINE_MONITOR_WINDOW_MS'],
      },
    },

    webhook: {
      timeoutMs: process.env['VORION_WEBHOOK_TIMEOUT_MS'],
      retryAttempts: process.env['VORION_WEBHOOK_RETRY_ATTEMPTS'],
      retryDelayMs: process.env['VORION_WEBHOOK_RETRY_DELAY_MS'],
      allowDnsChange: process.env['VORION_WEBHOOK_ALLOW_DNS_CHANGE'],
      circuitFailureThreshold: process.env['VORION_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD'],
      circuitResetTimeoutMs: process.env['VORION_WEBHOOK_CIRCUIT_RESET_TIMEOUT_MS'],
      deliveryConcurrency: process.env['VORION_WEBHOOK_DELIVERY_CONCURRENCY'],
      // SSRF protection: comma-separated list of allowed domains for webhook delivery
      allowedDomains: process.env['VORION_WEBHOOK_ALLOWED_DOMAINS']?.split(',').map(d => d.trim()).filter(Boolean),
      // SSRF protection: comma-separated list of additional blocked domains
      blockedDomains: process.env['VORION_WEBHOOK_BLOCKED_DOMAINS']?.split(',').map(d => d.trim()).filter(Boolean),
      // SSRF protection: if true, only allowed domains can receive webhooks
      enforceAllowlist: process.env['VORION_WEBHOOK_ENFORCE_ALLOWLIST'],
    },

    gdpr: {
      exportConcurrency: process.env['VORION_GDPR_EXPORT_CONCURRENCY'],
    },

    audit: {
      retentionDays: process.env['VORION_AUDIT_RETENTION_DAYS'],
      archiveEnabled: process.env['VORION_AUDIT_ARCHIVE_ENABLED'],
      archiveAfterDays: process.env['VORION_AUDIT_ARCHIVE_AFTER_DAYS'],
      cleanupBatchSize: process.env['VORION_AUDIT_CLEANUP_BATCH_SIZE'],
    },

    encryption: {
      key: process.env['VORION_ENCRYPTION_KEY'],
      salt: process.env['VORION_ENCRYPTION_SALT'],
      algorithm: process.env['VORION_ENCRYPTION_ALGORITHM'],
      pbkdf2Iterations: process.env['VORION_ENCRYPTION_PBKDF2_ITERATIONS'],
      kdfVersion: process.env['VORION_ENCRYPTION_KDF_VERSION'],
    },

    csrf: {
      enabled: process.env['VORION_CSRF_ENABLED'],
      secret: process.env['VORION_CSRF_SECRET'],
      cookieName: process.env['VORION_CSRF_COOKIE_NAME'],
      headerName: process.env['VORION_CSRF_HEADER_NAME'],
      tokenTTL: process.env['VORION_CSRF_TOKEN_TTL'],
      excludePaths: parseListOrUndefined(process.env['VORION_CSRF_EXCLUDE_PATHS']),
      excludeMethods: parseListOrUndefined(process.env['VORION_CSRF_EXCLUDE_METHODS']),
    },

    session: {
      fingerprintEnabled: process.env['VORION_SESSION_FINGERPRINT_ENABLED'],
      fingerprintStrictness: process.env['VORION_SESSION_FINGERPRINT_STRICTNESS'] as 'warn' | 'block' | undefined,
      fingerprintComponents: parseListOrUndefined(process.env['VORION_SESSION_FINGERPRINT_COMPONENTS']),
    },

    lite: {
      enabled: process.env['VORION_LITE_ENABLED'],
      autoGenerateSecrets: process.env['VORION_LITE_AUTO_GENERATE_SECRETS'],
      dataDirectory: process.env['VORION_LITE_DATA_DIRECTORY'],
      redisOptional: process.env['VORION_LITE_REDIS_OPTIONAL'],
    },

    hsm: {
      enabled: process.env['VORION_HSM_ENABLED'],
      provider: process.env['VORION_HSM_PROVIDER'] as 'aws' | 'azure' | 'gcp' | 'thales' | 'softhsm' | 'pkcs11' | undefined,
      enableFailover: process.env['VORION_HSM_ENABLE_FAILOVER'],
      failoverProviders: parseListOrUndefined(process.env['VORION_HSM_FAILOVER_PROVIDERS']) as Array<'aws' | 'azure' | 'gcp' | 'thales' | 'softhsm'> | undefined,
      healthCheckIntervalMs: process.env['VORION_HSM_HEALTH_CHECK_INTERVAL_MS'],
      enableKeyCache: process.env['VORION_HSM_ENABLE_KEY_CACHE'],
      keyCacheTTLSeconds: process.env['VORION_HSM_KEY_CACHE_TTL_SECONDS'],
      enableAuditLogging: process.env['VORION_HSM_ENABLE_AUDIT_LOGGING'],
      fipsMode: process.env['VORION_HSM_FIPS_MODE'],
      connectionTimeoutMs: process.env['VORION_HSM_CONNECTION_TIMEOUT_MS'],
      operationTimeoutMs: process.env['VORION_HSM_OPERATION_TIMEOUT_MS'],
      aws: {
        clusterId: process.env['VORION_HSM_AWS_CLUSTER_ID'],
        region: process.env['VORION_HSM_AWS_REGION'],
        cryptoUser: process.env['VORION_HSM_AWS_CRYPTO_USER'],
      },
      azure: {
        hsmName: process.env['VORION_HSM_AZURE_HSM_NAME'],
        region: process.env['VORION_HSM_AZURE_REGION'],
        tenantId: process.env['VORION_HSM_AZURE_TENANT_ID'],
        clientId: process.env['VORION_HSM_AZURE_CLIENT_ID'],
      },
      gcp: {
        projectId: process.env['VORION_HSM_GCP_PROJECT_ID'],
        location: process.env['VORION_HSM_GCP_LOCATION'],
        keyRing: process.env['VORION_HSM_GCP_KEY_RING'],
      },
      thales: {
        partitionName: process.env['VORION_HSM_THALES_PARTITION_NAME'],
        hsmIpAddresses: parseListOrUndefined(process.env['VORION_HSM_THALES_IP_ADDRESSES']),
      },
      pkcs11: {
        libraryPath: process.env['VORION_HSM_PKCS11_LIBRARY_PATH'],
        slot: process.env['VORION_HSM_PKCS11_SLOT'],
        fipsMode: process.env['VORION_HSM_PKCS11_FIPS_MODE'],
      },
    },
  });
}

// Singleton config instance
let configInstance: Config | null = null;

/**
 * Get configuration (loads once)
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

function parseJsonRecord(value: string | undefined | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parse a comma-separated list, returning undefined if not set.
 * This allows zod defaults to be applied for optional array fields.
 */
function parseListOrUndefined(value: string | undefined | null): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseNumberRecord(value: string | undefined | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      const result: Record<string, number> = {};
      for (const [key, val] of Object.entries(parsed)) {
        const num = Number(val);
        if (!Number.isNaN(num)) {
          result[key] = num;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Minimum entropy bits required for production secrets
 */
const MIN_PRODUCTION_ENTROPY_BITS = 128;

/**
 * Calculate Shannon entropy of a secret string in bits.
 * Used to detect weak secrets like repeated characters, simple patterns, etc.
 *
 * SE-C1: Entropy check (not just length check) to prevent weak secrets
 * that could bypass validation in production.
 *
 * @param secret - The secret string to analyze
 * @returns Entropy in bits
 */
export function calculateSecretEntropy(secret: string): number {
  if (!secret || secret.length === 0) return 0;

  // Count character frequencies
  const freq = new Map<string, number>();
  for (const char of secret) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  // Calculate Shannon entropy
  const len = secret.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  // Scale by length to get total entropy in bits
  // Multiply by length to get total entropy (not per-character)
  return entropy * len;
}

/**
 * Generate a cryptographically secure secret with entropy validation.
 *
 * Uses Node.js crypto.randomBytes which is backed by the OS CSPRNG.
 * Validates that the generated secret meets minimum entropy requirements.
 *
 * @param bytes - Number of random bytes to generate (default: 64)
 * @param minEntropy - Minimum required entropy in bits (default: 128)
 * @returns Base64-encoded secret string
 * @throws Error if generated secret has insufficient entropy (indicates CSPRNG issue)
 *
 * @example
 * ```typescript
 * const secret = generateStrongSecret(64); // 64 bytes = 512 bits
 * // Returns base64 string with ~340+ bits of entropy
 * ```
 */
export function generateStrongSecret(
  bytes: number = 64,
  minEntropy: number = MIN_PRODUCTION_ENTROPY_BITS
): string {
  const secret = randomBytes(bytes).toString('base64');
  const entropy = calculateSecretEntropy(secret);

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
 * Production configuration validation errors
 */
export interface ProductionConfigError {
  field: string;
  message: string;
  critical: boolean;
}

/**
 * Validate configuration for production deployment.
 *
 * This function performs comprehensive validation of all CRITICAL security
 * fields required for production deployments. It should be called during
 * application startup to ensure the deployment is properly configured.
 *
 * Validates:
 * - JWT_SECRET: Not default, minimum 32 chars, minimum 128 bits entropy
 * - ENCRYPTION_KEY: Minimum 32 chars, minimum 128 bits entropy
 * - SIGNING_PRIVATE_KEY: Valid Ed25519/ECDSA key format
 * - DATABASE_URL/connection: Valid PostgreSQL connection string
 *
 * @throws Error if any critical validation fails with detailed message
 * @returns void on success
 *
 * @example
 * ```typescript
 * import { validateProductionConfig } from './config.js';
 *
 * // Call at application startup
 * try {
 *   validateProductionConfig();
 *   console.log('Production configuration validated successfully');
 * } catch (error) {
 *   console.error('Configuration error:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export function validateProductionConfig(): void {
  const env = process.env['VORION_ENV'] ?? 'development';

  // Only enforce strict validation in production/staging
  if (env !== 'production' && env !== 'staging') {
    return;
  }

  const errors: ProductionConfigError[] = [];

  // =========================================================================
  // JWT_SECRET validation
  // =========================================================================
  const jwtSecret = process.env['VORION_JWT_SECRET'];
  const defaultSecrets = [
    'development-secret-change-in-production',
    'dev-only-insecure-secret-do-not-use-in-prod',
    'changeme',
    'secret',
    'password',
  ];

  if (!jwtSecret) {
    errors.push({
      field: 'VORION_JWT_SECRET',
      message: 'JWT secret is required in production. Generate with: openssl rand -base64 64',
      critical: true,
    });
  } else {
    // Check for default/insecure values
    if (defaultSecrets.some(d => jwtSecret.toLowerCase().includes(d.toLowerCase()))) {
      errors.push({
        field: 'VORION_JWT_SECRET',
        message: 'JWT secret appears to be a default/development value. Use a unique, randomly generated secret.',
        critical: true,
      });
    }

    // Check minimum length
    if (jwtSecret.length < 32) {
      errors.push({
        field: 'VORION_JWT_SECRET',
        message: `JWT secret must be at least 32 characters (got ${jwtSecret.length}). Generate with: openssl rand -base64 64`,
        critical: true,
      });
    }

    // Check entropy
    const jwtEntropy = calculateSecretEntropy(jwtSecret);
    if (jwtEntropy < MIN_PRODUCTION_ENTROPY_BITS) {
      errors.push({
        field: 'VORION_JWT_SECRET',
        message: `JWT secret has insufficient entropy (${Math.floor(jwtEntropy)} bits, need ${MIN_PRODUCTION_ENTROPY_BITS}+). Use a truly random secret.`,
        critical: true,
      });
    }
  }

  // =========================================================================
  // ENCRYPTION_KEY validation
  // =========================================================================
  const encryptionKey = process.env['VORION_ENCRYPTION_KEY'];

  if (!encryptionKey) {
    errors.push({
      field: 'VORION_ENCRYPTION_KEY',
      message: 'Encryption key is required in production. Generate with: openssl rand -base64 32',
      critical: true,
    });
  } else {
    // Check minimum length
    if (encryptionKey.length < 32) {
      errors.push({
        field: 'VORION_ENCRYPTION_KEY',
        message: `Encryption key must be at least 32 characters (got ${encryptionKey.length}). Generate with: openssl rand -base64 32`,
        critical: true,
      });
    }

    // Check entropy
    const encryptionEntropy = calculateSecretEntropy(encryptionKey);
    if (encryptionEntropy < MIN_PRODUCTION_ENTROPY_BITS) {
      errors.push({
        field: 'VORION_ENCRYPTION_KEY',
        message: `Encryption key has insufficient entropy (${Math.floor(encryptionEntropy)} bits, need ${MIN_PRODUCTION_ENTROPY_BITS}+). Use a truly random key.`,
        critical: true,
      });
    }
  }

  // =========================================================================
  // SIGNING_PRIVATE_KEY validation (Ed25519/ECDSA)
  // =========================================================================
  const signingKey = process.env['VORION_SIGNING_KEY'];

  if (!signingKey) {
    errors.push({
      field: 'VORION_SIGNING_KEY',
      message: 'Signing key is required in production. Generate Ed25519 key pair and export as JSON.',
      critical: true,
    });
  } else {
    // Validate JSON format and structure
    try {
      const keyData = JSON.parse(signingKey);

      if (!keyData.publicKey || !keyData.privateKey) {
        errors.push({
          field: 'VORION_SIGNING_KEY',
          message: 'Signing key must be JSON with "publicKey" and "privateKey" fields (base64 encoded SPKI/PKCS8).',
          critical: true,
        });
      } else {
        // Basic format validation - should be base64 encoded
        const base64Pattern = /^[A-Za-z0-9+/=]+$/;

        if (!base64Pattern.test(keyData.publicKey)) {
          errors.push({
            field: 'VORION_SIGNING_KEY',
            message: 'Public key must be base64 encoded (SPKI format).',
            critical: true,
          });
        }

        if (!base64Pattern.test(keyData.privateKey)) {
          errors.push({
            field: 'VORION_SIGNING_KEY',
            message: 'Private key must be base64 encoded (PKCS8 format).',
            critical: true,
          });
        }

        // Ed25519 public key in SPKI format is typically 44 bytes (59 base64 chars)
        // ECDSA P-256 public key in SPKI format is typically 91 bytes (122 base64 chars)
        const minPublicKeyLength = 40; // Allow some variance
        if (keyData.publicKey.length < minPublicKeyLength) {
          errors.push({
            field: 'VORION_SIGNING_KEY',
            message: `Public key appears too short (${keyData.publicKey.length} chars). Ensure proper Ed25519/ECDSA key export.`,
            critical: true,
          });
        }
      }
    } catch {
      errors.push({
        field: 'VORION_SIGNING_KEY',
        message: 'Signing key must be valid JSON. Format: {"publicKey":"base64...","privateKey":"base64..."}',
        critical: true,
      });
    }
  }

  // =========================================================================
  // DATABASE connection validation
  // =========================================================================
  const dbHost = process.env['VORION_DB_HOST'];
  const dbPort = process.env['VORION_DB_PORT'];
  const dbName = process.env['VORION_DB_NAME'];
  const dbUser = process.env['VORION_DB_USER'];
  const dbPassword = process.env['VORION_DB_PASSWORD'];

  // Check if DATABASE_URL is provided as alternative
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    // Validate DATABASE_URL format: postgresql://user:password@host:port/database
    const postgresUrlPattern = /^postgres(ql)?:\/\/[^:]+:[^@]+@[^:]+:\d+\/\w+/;
    if (!postgresUrlPattern.test(databaseUrl)) {
      errors.push({
        field: 'DATABASE_URL',
        message: 'Invalid DATABASE_URL format. Expected: postgresql://user:password@host:port/database',
        critical: true,
      });
    }
  } else {
    // Validate individual connection parameters
    if (!dbHost) {
      errors.push({
        field: 'VORION_DB_HOST',
        message: 'Database host is required. Set VORION_DB_HOST or DATABASE_URL.',
        critical: true,
      });
    }

    if (!dbName) {
      errors.push({
        field: 'VORION_DB_NAME',
        message: 'Database name is required. Set VORION_DB_NAME or DATABASE_URL.',
        critical: true,
      });
    }

    if (!dbUser) {
      errors.push({
        field: 'VORION_DB_USER',
        message: 'Database user is required. Set VORION_DB_USER or DATABASE_URL.',
        critical: true,
      });
    }

    if (!dbPassword) {
      errors.push({
        field: 'VORION_DB_PASSWORD',
        message: 'Database password is required in production. Set VORION_DB_PASSWORD or DATABASE_URL.',
        critical: true,
      });
    }

    // Validate port if provided
    if (dbPort) {
      const port = parseInt(dbPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push({
          field: 'VORION_DB_PORT',
          message: `Invalid database port: ${dbPort}. Must be a number between 1 and 65535.`,
          critical: true,
        });
      }
    }
  }

  // =========================================================================
  // Report errors
  // =========================================================================
  const criticalErrors = errors.filter(e => e.critical);

  if (criticalErrors.length > 0) {
    const errorMessages = criticalErrors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(
      `CRITICAL: Production configuration validation failed with ${criticalErrors.length} error(s):\n\n${errorMessages}\n\n` +
      'Fix these issues before deploying to production. See docs/security/HARDENING_GUIDE.md for details.'
    );
  }
}
