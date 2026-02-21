/**
 * Key Management Service (KMS) Module
 *
 * Provides unified KMS integration supporting multiple providers:
 * - AWS KMS
 * - HashiCorp Vault
 * - Local development provider
 *
 * Features:
 * - Factory function to create appropriate provider based on config
 * - Singleton management for global KMS provider
 * - Health checking
 * - Envelope encryption support
 *
 * @packageDocumentation
 * @module security/kms
 */

import { createLogger } from '../../common/logger.js';
import { VorionError } from '../../common/errors.js';
import type {
  KMSProvider,
  KMSConfig,
  AWSKMSConfig,
  VaultKMSConfig,
  LocalKMSConfig,
  KMSAuditCallback,
} from './types.js';
import { KMSProviderType, KMSErrorCode, kmsConfigSchema } from './types.js';
import { AWSKMSProvider } from './aws-kms.js';
import { HashiCorpVaultProvider } from './vault.js';
import { LocalKMSProvider } from './local.js';

const logger = createLogger({ component: 'kms' });

// =============================================================================
// Exports
// =============================================================================

// Re-export types
export * from './types.js';

// Re-export providers
export { AWSKMSProvider, AWSKMSError } from './aws-kms.js';
export { HashiCorpVaultProvider, VaultKMSError } from './vault.js';
export { LocalKMSProvider, LocalKMSError } from './local.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * KMS configuration error
 */
export class KMSConfigError extends VorionError {
  override code = KMSErrorCode.INVALID_CONFIG;
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'KMSConfigError';
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a KMS provider based on configuration
 *
 * @param config - KMS configuration
 * @returns KMS provider instance (not initialized)
 *
 * @example
 * ```typescript
 * // Create AWS KMS provider
 * const awsProvider = createKMSProvider({
 *   provider: 'aws',
 *   region: 'us-west-2',
 *   keyArn: 'arn:aws:kms:us-west-2:123456789:key/abc-123',
 * });
 *
 * // Create Vault provider
 * const vaultProvider = createKMSProvider({
 *   provider: 'vault',
 *   address: 'https://vault.example.com:8200',
 *   token: process.env.VAULT_TOKEN,
 *   keyName: 'my-key',
 * });
 *
 * // Create local provider for development
 * const localProvider = createKMSProvider({
 *   provider: 'local',
 *   keyEnvVar: 'VORION_LOCAL_KMS_KEY',
 * });
 *
 * await provider.initialize();
 * ```
 */
export function createKMSProvider(config: KMSConfig): KMSProvider {
  // Validate configuration
  const validationResult = kmsConfigSchema.safeParse(config);
  if (!validationResult.success) {
    throw new KMSConfigError(
      `Invalid KMS configuration: ${validationResult.error.message}`,
      { errors: validationResult.error.errors }
    );
  }

  const validatedConfig = validationResult.data;

  switch (validatedConfig.provider) {
    case KMSProviderType.AWS:
      return new AWSKMSProvider(validatedConfig as AWSKMSConfig);

    case KMSProviderType.VAULT:
      return new HashiCorpVaultProvider(validatedConfig as VaultKMSConfig);

    case KMSProviderType.LOCAL:
      return new LocalKMSProvider(validatedConfig as LocalKMSConfig);

    default:
      throw new KMSConfigError(
        `Unsupported KMS provider: ${(validatedConfig as KMSConfig).provider}`,
        { provider: (validatedConfig as KMSConfig).provider }
      );
  }
}

/**
 * Create a KMS provider from environment variables
 *
 * Environment variables:
 * - VORION_KMS_PROVIDER: 'aws' | 'vault' | 'local'
 *
 * AWS-specific:
 * - AWS_KMS_KEY_ARN: KMS key ARN
 * - AWS_REGION: AWS region (optional)
 * - AWS_KMS_ENDPOINT: Custom endpoint (optional, for LocalStack)
 *
 * Vault-specific:
 * - VAULT_ADDR: Vault server address
 * - VAULT_TOKEN: Vault token
 * - VAULT_TRANSIT_KEY: Key name in transit engine
 * - VAULT_TRANSIT_MOUNT: Transit mount path (default: 'transit')
 * - VAULT_NAMESPACE: Vault namespace (optional)
 *
 * Local-specific:
 * - VORION_LOCAL_KMS_KEY: Base64-encoded master key
 *
 * @returns KMS provider instance (not initialized)
 */
export function createKMSProviderFromEnv(): KMSProvider {
  const providerType = process.env['VORION_KMS_PROVIDER'] ?? 'local';

  logger.info({ provider: providerType }, 'Creating KMS provider from environment');

  switch (providerType) {
    case 'aws': {
      const keyArn = process.env['AWS_KMS_KEY_ARN'];
      if (!keyArn) {
        throw new KMSConfigError(
          'AWS_KMS_KEY_ARN environment variable is required for AWS KMS provider'
        );
      }

      const config: AWSKMSConfig = {
        provider: 'aws',
        keyArn,
        region: process.env['AWS_REGION'],
        endpoint: process.env['AWS_KMS_ENDPOINT'],
        enableCaching: true,
        cacheTtlSeconds: parseInt(process.env['KMS_CACHE_TTL_SECONDS'] ?? '300', 10),
        enableAuditLogging: process.env['KMS_AUDIT_LOGGING'] !== 'false',
      };

      return new AWSKMSProvider(config);
    }

    case 'vault': {
      const address = process.env['VAULT_ADDR'];
      if (!address) {
        throw new KMSConfigError(
          'VAULT_ADDR environment variable is required for Vault KMS provider'
        );
      }

      const keyName = process.env['VAULT_TRANSIT_KEY'];
      if (!keyName) {
        throw new KMSConfigError(
          'VAULT_TRANSIT_KEY environment variable is required for Vault KMS provider'
        );
      }

      const config: VaultKMSConfig = {
        provider: 'vault',
        address,
        token: process.env['VAULT_TOKEN'],
        keyName,
        transitMount: process.env['VAULT_TRANSIT_MOUNT'] ?? 'transit',
        namespace: process.env['VAULT_NAMESPACE'],
        enableTokenRenewal: process.env['VAULT_TOKEN_RENEWAL'] !== 'false',
        enableCaching: true,
        cacheTtlSeconds: parseInt(process.env['KMS_CACHE_TTL_SECONDS'] ?? '300', 10),
        enableAuditLogging: process.env['KMS_AUDIT_LOGGING'] !== 'false',
      };

      return new HashiCorpVaultProvider(config);
    }

    case 'local': {
      const config: LocalKMSConfig = {
        provider: 'local',
        keyEnvVar: 'VORION_LOCAL_KMS_KEY',
        masterKey: process.env['VORION_LOCAL_KMS_KEY'],
        enableCaching: true,
        cacheTtlSeconds: parseInt(process.env['KMS_CACHE_TTL_SECONDS'] ?? '300', 10),
        enableAuditLogging: process.env['KMS_AUDIT_LOGGING'] !== 'false',
      };

      return new LocalKMSProvider(config);
    }

    default:
      throw new KMSConfigError(
        `Unsupported KMS provider: ${providerType}. Valid options: aws, vault, local`
      );
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let defaultProvider: KMSProvider | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Get the default KMS provider instance
 *
 * Creates the provider from environment variables if not already set.
 * Returns null if no provider is configured and creation fails.
 *
 * @returns The default KMS provider or null
 */
export function getKMSProvider(): KMSProvider | null {
  if (!defaultProvider) {
    try {
      defaultProvider = createKMSProviderFromEnv();
    } catch (error) {
      logger.warn({ error }, 'Failed to create default KMS provider');
      return null;
    }
  }
  return defaultProvider;
}

/**
 * Get and initialize the default KMS provider
 *
 * Creates the provider from environment variables if not already set,
 * and ensures it is initialized.
 *
 * @returns Promise resolving to the initialized KMS provider
 * @throws KMSConfigError if provider creation or initialization fails
 */
export async function getInitializedKMSProvider(): Promise<KMSProvider> {
  const provider = getKMSProvider();

  if (!provider) {
    throw new KMSConfigError('Failed to create KMS provider from environment');
  }

  // Use a shared initialization promise to prevent concurrent initialization
  if (!initializationPromise) {
    initializationPromise = provider.initialize();
  }

  await initializationPromise;
  return provider;
}

/**
 * Set a custom KMS provider as the default
 *
 * @param provider - The KMS provider to use as default
 */
export function setKMSProvider(provider: KMSProvider): void {
  defaultProvider = provider;
  initializationPromise = null;
  logger.info({ provider: provider.name }, 'Default KMS provider set');
}

/**
 * Reset the default KMS provider
 *
 * Shuts down the current provider if one exists.
 */
export async function resetKMSProvider(): Promise<void> {
  if (defaultProvider) {
    await defaultProvider.shutdown();
    defaultProvider = null;
    initializationPromise = null;
    logger.info('Default KMS provider reset');
  }
}

// =============================================================================
// Health Checking
// =============================================================================

/**
 * KMS health status
 */
export interface KMSHealthStatus {
  /** Whether the provider is healthy */
  healthy: boolean;
  /** Provider name */
  provider: string;
  /** Whether the provider is initialized */
  initialized: boolean;
  /** Error message if unhealthy */
  error?: string;
  /** Cache statistics */
  cacheStats?: {
    size: number;
    ttlMs: number;
    maxUsages: number;
  };
}

/**
 * Check KMS provider health
 *
 * @param provider - Optional specific provider to check (defaults to global)
 * @returns Health status
 */
export async function checkKMSHealth(provider?: KMSProvider): Promise<KMSHealthStatus> {
  const targetProvider = provider ?? defaultProvider;

  if (!targetProvider) {
    return {
      healthy: false,
      provider: 'none',
      initialized: false,
      error: 'No KMS provider configured',
    };
  }

  try {
    const isHealthy = await targetProvider.healthCheck();

    // Get cache stats if available
    let cacheStats: KMSHealthStatus['cacheStats'];
    if ('getCacheStats' in targetProvider && typeof targetProvider.getCacheStats === 'function') {
      cacheStats = (targetProvider as AWSKMSProvider).getCacheStats() ?? undefined;
    }

    return {
      healthy: isHealthy,
      provider: targetProvider.name,
      initialized: isHealthy,
      cacheStats,
    };
  } catch (error) {
    return {
      healthy: false,
      provider: targetProvider.name,
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Audit Logging
// =============================================================================

/**
 * Register an audit callback on the default KMS provider
 *
 * @param callback - Audit callback function
 */
export function onKMSAudit(callback: KMSAuditCallback): void {
  const provider = getKMSProvider();

  if (!provider) {
    logger.warn('Cannot register audit callback: no KMS provider configured');
    return;
  }

  if ('onAudit' in provider && typeof provider.onAudit === 'function') {
    (provider as AWSKMSProvider).onAudit(callback);
    logger.debug('KMS audit callback registered');
  } else {
    logger.warn('KMS provider does not support audit callbacks');
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine KMS provider type from configuration or environment
 *
 * @returns The provider type that would be used
 */
export function detectKMSProviderType(): KMSProviderType {
  const envProvider = process.env['VORION_KMS_PROVIDER'];

  if (envProvider === 'aws' || process.env['AWS_KMS_KEY_ARN']) {
    return KMSProviderType.AWS;
  }

  if (envProvider === 'vault' || process.env['VAULT_ADDR']) {
    return KMSProviderType.VAULT;
  }

  return KMSProviderType.LOCAL;
}

/**
 * Check if a KMS provider is configured in the environment
 *
 * @returns True if a KMS provider can be created from environment
 */
export function isKMSConfigured(): boolean {
  const providerType = process.env['VORION_KMS_PROVIDER'];

  switch (providerType) {
    case 'aws':
      return !!process.env['AWS_KMS_KEY_ARN'];
    case 'vault':
      return !!process.env['VAULT_ADDR'] && !!process.env['VAULT_TRANSIT_KEY'];
    case 'local':
      return true; // Local always works (generates key if needed)
    default:
      // Check if any provider-specific vars are set
      return !!process.env['AWS_KMS_KEY_ARN'] ||
             (!!process.env['VAULT_ADDR'] && !!process.env['VAULT_TRANSIT_KEY']) ||
             !!process.env['VORION_LOCAL_KMS_KEY'];
  }
}
