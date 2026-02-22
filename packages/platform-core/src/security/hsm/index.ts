/**
 * Hardware Security Module (HSM) Integration Layer
 *
 * This module provides a unified interface for enterprise key management
 * across multiple HSM providers including:
 * - AWS CloudHSM
 * - Azure Dedicated/Managed HSM
 * - Google Cloud HSM
 * - Thales Luna Network HSM
 * - SoftHSM (for development)
 *
 * Features:
 * - Provider abstraction with automatic failover
 * - Key lifecycle management
 * - Multi-party key ceremonies with Shamir's Secret Sharing
 * - Health monitoring and audit logging
 * - Transparent integration with application code
 *
 * @module security/hsm
 */

// ============================================================================
// Provider Interface and Base Types
// ============================================================================

export {
  // Interfaces
  IHSMProvider,
  HSMProviderConfig,
  HSMStatus,

  // Key Types
  KeySpec,
  KeyHandle,
  KeyType,
  KeyUsage,
  ECCurve,

  // Encryption/Signing
  EncryptionOptions,
  EncryptionAlgorithm,
  SigningAlgorithm,

  // Retry and Audit
  RetryConfig,
  AuditLogEntry,

  // Base Implementation
  BaseHSMProvider,

  // Error Types
  HSMError,
  HSMConnectionError,
  HSMKeyNotFoundError,
  HSMOperationError,
  HSMPermissionError,
} from './provider.js';

// ============================================================================
// Provider Implementations
// ============================================================================

// AWS CloudHSM
export {
  AWSCloudHSMProvider,
  AWSCloudHSMConfig,
} from './aws-cloudhsm.js';

// Azure Managed HSM
export {
  AzureHSMProvider,
  AzureHSMConfig,
  AzureHSMRole,
  RoleAssignment,
} from './azure-hsm.js';

// Google Cloud HSM
export {
  GCPHSMProvider,
  GCPHSMConfig,
  GCPKeyAlgorithm,
  KeyVersionState,
  CloudKMSRole,
  IAMBinding,
} from './gcp-hsm.js';

// Thales Luna HSM
export {
  ThalesLunaProvider,
  ThalesLunaConfig,
  HAGroupMember,
  PartitionInfo,
} from './thales-luna.js';

// SoftHSM (Development)
export {
  SoftHSMProvider,
  SoftHSMConfig,
} from './local-softHSM.js';

// ============================================================================
// Key Ceremony
// ============================================================================

export {
  KeyCeremonyManager,
  CeremonyConfig,
  Ceremony,
  CeremonyType,
  CeremonyStatus,
  CeremonyAction,
  CeremonyAuditEntry,
  KeyCustodian,
  CustodianRole,
  KeyShare,
} from './key-ceremony.js';

// ============================================================================
// Key Operations
// ============================================================================

export {
  KeyOperationsService,
  createKeyOperationsService,
  KeyPurpose,
  FIPSComplianceLevel,
  KeyGenerationOptions,
  EnvelopeEncryptionResult,
  KeyDerivationParams,
  SignatureOptions,
  KeyOperationMetrics,
  getFIPSKeySpec,
} from './key-operations.js';

// ============================================================================
// PKCS#11 Wrapper
// ============================================================================

export {
  PKCS11WrapperProvider,
  PKCS11WrapperConfig,
  createPKCS11Provider,
  // PKCS#11 Types
  CKM,
  CKO,
  CKK,
  CKA,
  CKU,
  CKR,
  TokenInfo,
  SlotInfo,
  MechanismInfo,
} from './pkcs11-wrapper.js';

// ============================================================================
// HSM Service (Orchestration)
// ============================================================================

export {
  HSMService,
  HSMServiceConfig,
  HSMProviderSelector,
  createHSMService,
} from './hsm-service.js';

// ============================================================================
// Convenience Types for Common Use Cases
// ============================================================================

/**
 * Standard key specifications for common use cases
 */
export const StandardKeySpecs = {
  /**
   * AES-256 key for data encryption
   */
  DataEncryptionKey: {
    type: 'AES' as const,
    size: 256,
    usage: ['encrypt' as const, 'decrypt' as const],
    extractable: false,
  },

  /**
   * AES-256 key for wrapping other keys
   */
  KeyEncryptionKey: {
    type: 'AES' as const,
    size: 256,
    usage: ['wrap' as const, 'unwrap' as const],
    extractable: false,
  },

  /**
   * RSA-2048 key pair for signing
   */
  RSASigningKey: {
    type: 'RSA' as const,
    size: 2048,
    usage: ['sign' as const, 'verify' as const],
    extractable: false,
  },

  /**
   * RSA-2048 key pair for encryption
   */
  RSAEncryptionKey: {
    type: 'RSA' as const,
    size: 2048,
    usage: ['encrypt' as const, 'decrypt' as const],
    extractable: false,
  },

  /**
   * ECDSA P-256 key pair for signing
   */
  ECDSASigningKey: {
    type: 'EC' as const,
    curve: 'P-256' as const,
    usage: ['sign' as const, 'verify' as const],
    extractable: false,
  },

  /**
   * HMAC-SHA256 key for message authentication
   */
  HMACKey: {
    type: 'HMAC' as const,
    size: 256,
    usage: ['sign' as const, 'verify' as const],
    extractable: false,
  },
};

/**
 * Environment-based provider recommendations
 */
export const ProviderRecommendations = {
  development: ['softhsm'],
  staging: ['softhsm', 'aws', 'azure', 'gcp'],
  production: ['aws', 'azure', 'gcp', 'thales'],
} as const;

// ============================================================================
// Quick Start Functions
// ============================================================================

import { HSMService, createHSMService as createService } from './hsm-service.js';
import { KeyType, KeyUsage, ECCurve } from './provider.js';

/**
 * Quick start: Create and initialize HSM service for the current environment
 *
 * @example
 * ```typescript
 * const hsm = await quickStart('development');
 * const key = await hsm.generateMasterKey('my-app-key');
 * const encrypted = await hsm.encrypt(key.id, Buffer.from('secret data'));
 * ```
 */
export async function quickStart(
  environment: 'development' | 'staging' | 'production' = 'development'
): Promise<HSMService> {
  const service = createService(environment);
  await service.initialize();
  return service;
}

/**
 * Create a simple encryption service using SoftHSM
 * Useful for development and testing
 *
 * @example
 * ```typescript
 * const crypto = await createSimpleCryptoService();
 * const { keyId, ciphertext } = await crypto.encrypt('my-data', Buffer.from('hello'));
 * const plaintext = await crypto.decrypt(keyId, ciphertext);
 * ```
 */
export async function createSimpleCryptoService(): Promise<{
  encrypt: (label: string, data: Buffer) => Promise<{ keyId: string; ciphertext: Buffer }>;
  decrypt: (keyId: string, ciphertext: Buffer) => Promise<Buffer>;
  sign: (label: string, data: Buffer) => Promise<{ keyId: string; signature: Buffer }>;
  verify: (keyId: string, data: Buffer, signature: Buffer) => Promise<boolean>;
  destroy: () => Promise<void>;
}> {
  const service = await quickStart('development');
  const keyCache = new Map<string, string>();

  return {
    async encrypt(label: string, data: Buffer) {
      let keyId = keyCache.get(`enc:${label}`);

      if (!keyId) {
        const key = await service.generateKey({
          label,
          type: KeyType.AES,
          size: 256,
          usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
          extractable: false,
        });
        keyId = key.id;
        keyCache.set(`enc:${label}`, keyId);
      }

      const ciphertext = await service.encrypt(keyId, data);
      return { keyId, ciphertext };
    },

    async decrypt(keyId: string, ciphertext: Buffer) {
      return service.decrypt(keyId, ciphertext);
    },

    async sign(label: string, data: Buffer) {
      let keyId = keyCache.get(`sign:${label}`);

      if (!keyId) {
        const key = await service.generateKey({
          label,
          type: KeyType.EC,
          curve: ECCurve.P256,
          usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
          extractable: false,
        });
        keyId = key.id;
        keyCache.set(`sign:${label}`, keyId);
      }

      const signature = await service.sign(keyId, data, 'ECDSA-SHA256');
      return { keyId, signature };
    },

    async verify(keyId: string, data: Buffer, signature: Buffer) {
      return service.verify(keyId, data, signature, 'ECDSA-SHA256');
    },

    async destroy() {
      await service.shutdown();
    },
  };
}

// ============================================================================
// Health Check Integration
// ============================================================================

import type { HealthCheck, ComponentHealth, HealthStatus } from '../../observability/health.js';

/**
 * Create HSM health check for observability integration
 *
 * @example
 * ```typescript
 * import { registerHealthCheck } from '@vorionsys/platform-core/observability';
 * import { createHSMHealthCheck } from '@vorionsys/platform-core/security/hsm';
 *
 * const hsmService = await createHSMService('production');
 * await hsmService.initialize();
 *
 * registerHealthCheck(createHSMHealthCheck(hsmService));
 * ```
 */
export function createHSMHealthCheck(
  service: HSMService,
  options?: {
    /** Whether this is a critical health check (affects overall status) */
    critical?: boolean;
    /** Custom name for the health check */
    name?: string;
    /** Timeout for health check in ms */
    timeoutMs?: number;
  }
): HealthCheck {
  const critical = options?.critical ?? true;
  const name = options?.name ?? 'hsm';
  const timeoutMs = options?.timeoutMs ?? 5000;

  return {
    name,
    critical,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();

      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('HSM health check timeout')), timeoutMs)
        );

        // Get HSM status with timeout
        const statusPromise = service.getStatus();
        const status = await Promise.race([statusPromise, timeoutPromise]);

        const latencyMs = Date.now() - start;

        // Determine health status
        let healthStatus: HealthStatus = 'healthy';

        if (!status.initialized) {
          healthStatus = 'unhealthy';
        } else if (!status.activeProvider) {
          healthStatus = 'unhealthy';
        } else {
          // Check if any provider is unhealthy
          const unhealthyProviders = status.providers.filter(
            p => !p.status.healthy
          );
          const activeProvider = status.providers.find(p => p.isActive);

          if (activeProvider && !activeProvider.status.healthy) {
            healthStatus = 'unhealthy';
          } else if (unhealthyProviders.length > 0) {
            healthStatus = 'degraded';
          }
        }

        return {
          name,
          status: healthStatus,
          latencyMs,
          details: {
            initialized: status.initialized,
            activeProvider: status.activeProvider,
            providerCount: status.providers.length,
            healthyProviders: status.providers.filter(p => p.status.healthy).length,
            metrics: {
              totalOperations: status.metrics.totalOperations,
              successRate:
                status.metrics.totalOperations > 0
                  ? (
                      (status.metrics.successfulOperations /
                        status.metrics.totalOperations) *
                      100
                    ).toFixed(2) + '%'
                  : 'N/A',
              averageLatencyMs: Math.round(status.metrics.averageLatency),
              failoverCount: status.metrics.failoverCount,
            },
            isProductionMode: service.isProductionMode(),
          },
        };
      } catch (error) {
        const latencyMs = Date.now() - start;
        return {
          name,
          status: 'unhealthy',
          latencyMs,
          message: error instanceof Error ? error.message : 'HSM health check failed',
        };
      }
    },
  };
}

/**
 * HSM Configuration Schema for config integration
 *
 * Use this with Zod for configuration validation:
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { hsmConfigSchema } from '@vorionsys/platform-core/security/hsm';
 *
 * const configSchema = z.object({
 *   // ... other config
 *   hsm: hsmConfigSchema,
 * });
 * ```
 */
export const HSMConfigDefaults = {
  /** Default HSM provider type */
  defaultProvider: 'softhsm' as const,

  /** Available provider types */
  providerTypes: ['aws', 'azure', 'gcp', 'thales', 'softhsm', 'pkcs11'] as const,

  /** Default health check interval in milliseconds */
  healthCheckIntervalMs: 30000,

  /** Default retry configuration */
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  },

  /** Default key cache TTL in seconds */
  keyCacheTTLSeconds: 300,

  /** Default connection timeout in milliseconds */
  connectionTimeoutMs: 30000,

  /** Default operation timeout in milliseconds */
  operationTimeoutMs: 60000,
} as const;

/**
 * HSM Configuration interface
 */
export interface HSMConfig {
  /** Enable HSM integration */
  enabled: boolean;

  /** HSM provider type */
  provider: 'aws' | 'azure' | 'gcp' | 'thales' | 'softhsm' | 'pkcs11';

  /** Enable failover to secondary providers */
  enableFailover: boolean;

  /** Failover provider types in priority order */
  failoverProviders?: Array<'aws' | 'azure' | 'gcp' | 'thales' | 'softhsm'>;

  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;

  /** Enable key caching */
  enableKeyCache: boolean;

  /** Key cache TTL in seconds */
  keyCacheTTLSeconds: number;

  /** Enable audit logging */
  enableAuditLogging: boolean;

  /** FIPS 140-3 compliance mode */
  fipsMode: boolean;

  /** Connection timeout in milliseconds */
  connectionTimeoutMs: number;

  /** Operation timeout in milliseconds */
  operationTimeoutMs: number;

  /** Provider-specific configuration */
  aws?: {
    clusterId: string;
    region: string;
    cryptoUser: string;
    cryptoUserPassword?: string; // Should come from secrets manager
  };

  azure?: {
    hsmName: string;
    region: string;
    tenantId: string;
    clientId: string;
  };

  gcp?: {
    projectId: string;
    location: string;
    keyRing: string;
  };

  thales?: {
    partitionName: string;
    hsmIpAddresses: string[];
  };

  pkcs11?: {
    libraryPath: string;
    slot?: number;
    fipsMode?: boolean;
  };
}
