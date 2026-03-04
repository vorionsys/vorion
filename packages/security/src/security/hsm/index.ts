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
} from './provider';

// ============================================================================
// Provider Implementations
// ============================================================================

// AWS CloudHSM
export {
  AWSCloudHSMProvider,
  AWSCloudHSMConfig,
} from './aws-cloudhsm';

// Azure Managed HSM
export {
  AzureHSMProvider,
  AzureHSMConfig,
  AzureHSMRole,
  RoleAssignment,
} from './azure-hsm';

// Google Cloud HSM
export {
  GCPHSMProvider,
  GCPHSMConfig,
  GCPKeyAlgorithm,
  KeyVersionState,
  CloudKMSRole,
  IAMBinding,
} from './gcp-hsm';

// Thales Luna HSM
export {
  ThalesLunaProvider,
  ThalesLunaConfig,
  HAGroupMember,
  PartitionInfo,
} from './thales-luna';

// SoftHSM (Development)
export {
  SoftHSMProvider,
  SoftHSMConfig,
} from './local-softHSM';

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
} from './key-ceremony';

// ============================================================================
// HSM Service (Orchestration)
// ============================================================================

export {
  HSMService,
  HSMServiceConfig,
  HSMProviderSelector,
  createHSMService,
} from './hsm-service';

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

import { HSMService, createHSMService as createService } from './hsm-service';
import { KeyType, KeyUsage, ECCurve } from './provider';

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
