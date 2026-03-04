/**
 * HSM Service - Orchestration Layer
 * Provides unified interface for HSM operations with automatic failover,
 * health monitoring, circuit breaker protection, and audit logging
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  IHSMProvider,
  HSMStatus,
  KeySpec,
  KeyHandle,
  KeyType,
  KeyUsage,
  EncryptionOptions,
  AuditLogEntry,
  HSMConnectionError,
  HSMOperationError,
  ECCurve,
} from './provider';
import { AWSCloudHSMProvider, AWSCloudHSMConfig } from './aws-cloudhsm';
import { AzureHSMProvider, AzureHSMConfig } from './azure-hsm';
import { GCPHSMProvider, GCPHSMConfig } from './gcp-hsm';
import { ThalesLunaProvider, ThalesLunaConfig } from './thales-luna';
import { SoftHSMProvider, SoftHSMConfig } from './local-softHSM';
import {
  KeyCeremonyManager,
  CeremonyConfig,
  Ceremony,
  CeremonyType,
  CeremonyAuditEntry,
} from './key-ceremony';
import {
  withCircuitBreakerResult,
  CircuitBreakerOpenError,
  type CircuitBreakerResult,
} from '../../common/circuit-breaker.js';

// ============================================================================
// HSM Service Configuration
// ============================================================================

export interface HSMServiceConfig {
  /** Primary HSM provider configuration */
  primary: HSMProviderSelector;
  /** Failover HSM providers (in priority order) */
  failover?: HSMProviderSelector[];
  /** Enable automatic failover */
  enableFailover?: boolean;
  /** Health check interval in milliseconds */
  healthCheckInterval?: number;
  /** Maximum retries before failover */
  maxRetriesBeforeFailover?: number;
  /** Enable audit logging */
  enableAuditLogging?: boolean;
  /** Audit log destination */
  auditLogDestination?: 'memory' | 'file' | 'external';
  /** Audit log file path (if destination is 'file') */
  auditLogPath?: string;
  /** External audit log callback */
  auditLogCallback?: (entry: AuditLogEntry) => void;
  /** Enable key caching for metadata */
  enableKeyCache?: boolean;
  /** Key cache TTL in seconds */
  keyCacheTTL?: number;
  /** Environment (affects default provider selection) */
  environment?: 'development' | 'staging' | 'production';
}

/**
 * Provider type selector
 */
export type HSMProviderSelector =
  | { type: 'aws'; config: AWSCloudHSMConfig }
  | { type: 'azure'; config: AzureHSMConfig }
  | { type: 'gcp'; config: GCPHSMConfig }
  | { type: 'thales'; config: ThalesLunaConfig }
  | { type: 'softhsm'; config: SoftHSMConfig };

/**
 * Provider health status
 */
interface ProviderHealth {
  provider: IHSMProvider;
  status: HSMStatus;
  lastCheck: Date;
  consecutiveFailures: number;
  isActive: boolean;
}

/**
 * Key cache entry
 */
interface KeyCacheEntry {
  key: KeyHandle;
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * Operation metrics
 */
interface OperationMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  operationsByType: Record<string, number>;
  failoverCount: number;
}

// ============================================================================
// HSM Service
// ============================================================================

export class HSMService extends EventEmitter {
  private config: HSMServiceConfig;
  private providers: Map<string, ProviderHealth> = new Map();
  private activeProvider: IHSMProvider | null = null;
  private keyCache: Map<string, KeyCacheEntry> = new Map();
  private auditLogs: AuditLogEntry[] = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private metrics: OperationMetrics;
  private ceremonyManager: KeyCeremonyManager | null = null;
  private initialized: boolean = false;

  constructor(config: HSMServiceConfig) {
    super();
    this.config = {
      enableFailover: true,
      healthCheckInterval: 30000,
      maxRetriesBeforeFailover: 3,
      enableAuditLogging: true,
      auditLogDestination: 'memory',
      enableKeyCache: true,
      keyCacheTTL: 300,
      environment: 'development',
      ...config,
    };

    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageLatency: 0,
      operationsByType: {},
      failoverCount: 0,
    };
  }

  /**
   * Initialize the HSM service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Create primary provider
      const primaryProvider = this.createProvider(this.config.primary);
      await primaryProvider.connect();

      this.providers.set('primary', {
        provider: primaryProvider,
        status: await primaryProvider.getStatus(),
        lastCheck: new Date(),
        consecutiveFailures: 0,
        isActive: true,
      });

      this.activeProvider = primaryProvider;

      // Create failover providers
      if (this.config.failover && this.config.enableFailover) {
        for (let i = 0; i < this.config.failover.length; i++) {
          const failoverConfig = this.config.failover[i];
          const failoverProvider = this.createProvider(failoverConfig);

          try {
            await failoverProvider.connect();
            this.providers.set(`failover-${i}`, {
              provider: failoverProvider,
              status: await failoverProvider.getStatus(),
              lastCheck: new Date(),
              consecutiveFailures: 0,
              isActive: false,
            });
          } catch (error) {
            console.warn(`Failed to connect failover provider ${i}:`, error);
          }
        }
      }

      // Initialize ceremony manager with adapted callback
      const ceremonyAuditCallback = this.config.auditLogCallback
        ? (entry: CeremonyAuditEntry) => {
            this.config.auditLogCallback?.({
              operation: `ceremony:${entry.action}`,
              success: true,
              keyId: entry.custodianId,
              timestamp: entry.timestamp,
              metadata: entry.metadata,
            });
          }
        : undefined;
      this.ceremonyManager = new KeyCeremonyManager(
        this.activeProvider,
        ceremonyAuditCallback
      );

      // Start health check timer
      this.startHealthChecks();

      this.initialized = true;

      this.logAudit({
        operation: 'initialize',
        success: true,
        metadata: {
          primaryProvider: this.activeProvider.name,
          failoverCount: this.providers.size - 1,
        },
      });

      this.emit('initialized', {
        activeProvider: this.activeProvider.name,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logAudit({
        operation: 'initialize',
        success: false,
        errorMessage: err.message,
      });
      throw new HSMConnectionError(
        `Failed to initialize HSM service: ${err.message}`,
        undefined,
        err
      );
    }
  }

  /**
   * Create provider from configuration
   */
  private createProvider(selector: HSMProviderSelector): IHSMProvider {
    switch (selector.type) {
      case 'aws':
        return new AWSCloudHSMProvider(selector.config);
      case 'azure':
        return new AzureHSMProvider(selector.config);
      case 'gcp':
        return new GCPHSMProvider(selector.config);
      case 'thales':
        return new ThalesLunaProvider(selector.config);
      case 'softhsm':
        return new SoftHSMProvider(selector.config);
      default:
        throw new Error(`Unknown provider type`);
    }
  }

  /**
   * Shutdown the HSM service
   */
  async shutdown(): Promise<void> {
    // Stop health checks
    this.stopHealthChecks();

    // Disconnect all providers
    for (const [name, health] of this.providers) {
      try {
        await health.provider.disconnect();
      } catch (error) {
        console.warn(`Error disconnecting provider ${name}:`, error);
      }
    }

    this.providers.clear();
    this.activeProvider = null;
    this.initialized = false;

    this.logAudit({
      operation: 'shutdown',
      success: true,
    });

    this.emit('shutdown');
  }

  /**
   * Start health check timer
   */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health check timer
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    for (const [name, health] of this.providers) {
      try {
        const status = await health.provider.getStatus();
        health.status = status;
        health.lastCheck = new Date();

        if (status.healthy) {
          health.consecutiveFailures = 0;
        } else {
          health.consecutiveFailures++;
        }

        this.emit('healthCheck', { name, status });
      } catch (error) {
        health.consecutiveFailures++;
        this.emit('healthCheckFailed', { name, error });
      }

      // Check if failover is needed
      if (
        health.isActive &&
        health.consecutiveFailures >= (this.config.maxRetriesBeforeFailover || 3)
      ) {
        await this.performFailover();
      }
    }
  }

  /**
   * Perform failover to next available provider
   */
  private async performFailover(): Promise<void> {
    if (!this.config.enableFailover) {
      return;
    }

    this.logAudit({
      operation: 'failover',
      success: false,
      metadata: { reason: 'Primary provider unhealthy' },
    });

    // Find a healthy failover provider
    for (const [name, health] of this.providers) {
      if (!health.isActive && health.status.healthy) {
        // Deactivate current active provider
        const currentActive = Array.from(this.providers.values()).find(h => h.isActive);
        if (currentActive) {
          currentActive.isActive = false;
        }

        // Activate new provider
        health.isActive = true;
        this.activeProvider = health.provider;

        this.metrics.failoverCount++;

        this.logAudit({
          operation: 'failover',
          success: true,
          metadata: { newProvider: name },
        });

        this.emit('failover', {
          newProvider: health.provider.name,
          reason: 'Health check failure',
        });

        return;
      }
    }

    this.emit('failoverFailed', { reason: 'No healthy providers available' });
  }

  /**
   * Execute operation with circuit breaker, retry, and failover
   *
   * The circuit breaker provides:
   * - Fast failure when HSM is known to be unavailable
   * - Protection against cascading failures
   * - Automatic recovery testing via half-open state
   */
  private async executeWithFailover<T>(
    operation: string,
    fn: (provider: IHSMProvider) => Promise<T>,
    keyId?: string
  ): Promise<T> {
    if (!this.activeProvider) {
      throw new HSMConnectionError('HSM service not initialized');
    }

    const startTime = Date.now();

    // Determine which circuit breaker to use based on active provider
    const providerType = this.getProviderType();
    const circuitBreakerName = providerType ? `hsm${providerType.charAt(0).toUpperCase() + providerType.slice(1)}` : 'hsm';

    // Wrap the entire operation in a circuit breaker
    const circuitResult = await withCircuitBreakerResult(circuitBreakerName, async () => {
      return this.executeWithRetryAndFailover(operation, fn, keyId, startTime);
    });

    // Handle circuit breaker result
    if (circuitResult.circuitOpen) {
      const latency = Date.now() - startTime;
      this.updateMetrics(operation, false, latency);

      this.logAudit({
        operation,
        keyId,
        success: false,
        errorMessage: `Circuit breaker open for ${circuitBreakerName}`,
        metadata: { circuitBreakerOpen: true },
      });

      this.emit('circuitBreakerOpen', {
        operation,
        provider: circuitBreakerName,
      });

      throw new HSMOperationError(
        operation,
        `HSM circuit breaker is open - service temporarily unavailable`,
        this.activeProvider?.name,
        new CircuitBreakerOpenError(circuitBreakerName)
      );
    }

    if (!circuitResult.success) {
      throw circuitResult.error;
    }

    return circuitResult.result as T;
  }

  /**
   * Get the type of the currently active provider
   */
  private getProviderType(): string | null {
    if (!this.activeProvider) return null;

    const providerName = this.activeProvider.name.toLowerCase();
    if (providerName.includes('aws') || providerName.includes('cloudhsm')) return 'Aws';
    if (providerName.includes('azure')) return 'Azure';
    if (providerName.includes('gcp') || providerName.includes('google')) return 'Gcp';
    if (providerName.includes('thales') || providerName.includes('luna')) return 'Thales';
    return null;
  }

  /**
   * Internal method for retry and failover logic
   */
  private async executeWithRetryAndFailover<T>(
    operation: string,
    fn: (provider: IHSMProvider) => Promise<T>,
    keyId: string | undefined,
    startTime: number
  ): Promise<T> {
    let lastError: Error | undefined;
    let attempts = 0;
    const maxAttempts = this.config.maxRetriesBeforeFailover || 3;

    while (attempts < maxAttempts) {
      try {
        const result = await fn(this.activeProvider!);

        // Update metrics
        const latency = Date.now() - startTime;
        this.updateMetrics(operation, true, latency);

        this.logAudit({
          operation,
          keyId,
          success: true,
          metadata: { latency, attempts: attempts + 1 },
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;

        this.emit('operationRetry', { operation, attempt: attempts, error: lastError });
      }
    }

    // All retries failed, attempt failover
    if (this.config.enableFailover) {
      await this.performFailover();

      if (this.activeProvider) {
        try {
          const result = await fn(this.activeProvider);

          const latency = Date.now() - startTime;
          this.updateMetrics(operation, true, latency);

          this.logAudit({
            operation,
            keyId,
            success: true,
            metadata: { latency, failover: true },
          });

          return result;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    // All attempts failed
    this.updateMetrics(operation, false, Date.now() - startTime);

    this.logAudit({
      operation,
      keyId,
      success: false,
      errorMessage: lastError?.message,
    });

    throw new HSMOperationError(
      operation,
      lastError?.message || 'Operation failed after all retries',
      this.activeProvider?.name,
      lastError
    );
  }

  /**
   * Update operation metrics
   */
  private updateMetrics(operation: string, success: boolean, latency: number): void {
    this.metrics.totalOperations++;

    if (success) {
      this.metrics.successfulOperations++;
    } else {
      this.metrics.failedOperations++;
    }

    // Update average latency
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (this.metrics.totalOperations - 1) + latency) /
      this.metrics.totalOperations;

    // Update operation counts by type
    this.metrics.operationsByType[operation] =
      (this.metrics.operationsByType[operation] || 0) + 1;
  }

  /**
   * Log audit entry
   */
  private logAudit(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    if (!this.config.enableAuditLogging) {
      return;
    }

    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date(),
    };

    // Store in memory
    if (this.config.auditLogDestination === 'memory') {
      this.auditLogs.push(fullEntry);

      // Keep only last 10000 entries
      if (this.auditLogs.length > 10000) {
        this.auditLogs = this.auditLogs.slice(-10000);
      }
    }

    // Call external callback
    if (this.config.auditLogCallback) {
      this.config.auditLogCallback(fullEntry);
    }

    this.emit('audit', fullEntry);
  }

  // ============================================================================
  // Key Management Operations
  // ============================================================================

  /**
   * Generate a new key
   */
  async generateKey(spec: KeySpec): Promise<KeyHandle> {
    return this.executeWithFailover('generateKey', async provider => {
      const key = await provider.generateKey(spec);

      // Cache the key metadata
      if (this.config.enableKeyCache) {
        this.cacheKey(key);
      }

      return key;
    });
  }

  /**
   * Import a key
   */
  async importKey(keyMaterial: Buffer, spec: KeySpec): Promise<KeyHandle> {
    return this.executeWithFailover('importKey', async provider => {
      const key = await provider.importKey(keyMaterial, spec);

      if (this.config.enableKeyCache) {
        this.cacheKey(key);
      }

      return key;
    });
  }

  /**
   * Get key metadata
   */
  async getKey(keyHandle: string): Promise<KeyHandle | null> {
    // Check cache first
    if (this.config.enableKeyCache) {
      const cached = this.keyCache.get(keyHandle);
      if (cached && cached.expiresAt > new Date()) {
        return cached.key;
      }
    }

    return this.executeWithFailover(
      'getKey',
      async provider => {
        const key = await provider.getKey(keyHandle);

        if (key && this.config.enableKeyCache) {
          this.cacheKey(key);
        }

        return key;
      },
      keyHandle
    );
  }

  /**
   * List all keys
   */
  async listKeys(filter?: Partial<KeySpec>): Promise<KeyHandle[]> {
    return this.executeWithFailover('listKeys', async provider => {
      return provider.listKeys(filter);
    });
  }

  /**
   * Export public key
   */
  async exportPublicKey(keyHandle: string): Promise<Buffer> {
    return this.executeWithFailover(
      'exportPublicKey',
      async provider => {
        return provider.exportPublicKey(keyHandle);
      },
      keyHandle
    );
  }

  /**
   * Destroy a key
   */
  async destroyKey(keyHandle: string): Promise<void> {
    return this.executeWithFailover(
      'destroyKey',
      async provider => {
        await provider.destroyKey(keyHandle);

        // Remove from cache
        this.keyCache.delete(keyHandle);
      },
      keyHandle
    );
  }

  // ============================================================================
  // Cryptographic Operations
  // ============================================================================

  /**
   * Sign data
   */
  async sign(keyHandle: string, data: Buffer, algorithm: string): Promise<Buffer> {
    return this.executeWithFailover(
      'sign',
      async provider => {
        return provider.sign(keyHandle, data, algorithm);
      },
      keyHandle
    );
  }

  /**
   * Verify signature
   */
  async verify(
    keyHandle: string,
    data: Buffer,
    signature: Buffer,
    algorithm: string
  ): Promise<boolean> {
    return this.executeWithFailover(
      'verify',
      async provider => {
        return provider.verify(keyHandle, data, signature, algorithm);
      },
      keyHandle
    );
  }

  /**
   * Encrypt data
   */
  async encrypt(
    keyHandle: string,
    data: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    return this.executeWithFailover(
      'encrypt',
      async provider => {
        return provider.encrypt(keyHandle, data, options);
      },
      keyHandle
    );
  }

  /**
   * Decrypt data
   */
  async decrypt(
    keyHandle: string,
    ciphertext: Buffer,
    options?: EncryptionOptions
  ): Promise<Buffer> {
    return this.executeWithFailover(
      'decrypt',
      async provider => {
        return provider.decrypt(keyHandle, ciphertext, options);
      },
      keyHandle
    );
  }

  /**
   * Wrap key
   */
  async wrapKey(
    wrappingKeyHandle: string,
    keyToWrap: string,
    algorithm?: string
  ): Promise<Buffer> {
    return this.executeWithFailover(
      'wrapKey',
      async provider => {
        return provider.wrapKey(wrappingKeyHandle, keyToWrap, algorithm);
      },
      wrappingKeyHandle
    );
  }

  /**
   * Unwrap key
   */
  async unwrapKey(
    wrappingKeyHandle: string,
    wrappedKey: Buffer,
    spec: KeySpec,
    algorithm?: string
  ): Promise<string> {
    return this.executeWithFailover(
      'unwrapKey',
      async provider => {
        const keyId = await provider.unwrapKey(wrappingKeyHandle, wrappedKey, spec, algorithm);

        // Get and cache the new key
        const key = await provider.getKey(keyId);
        if (key && this.config.enableKeyCache) {
          this.cacheKey(key);
        }

        return keyId;
      },
      wrappingKeyHandle
    );
  }

  // ============================================================================
  // Key Ceremony Operations
  // ============================================================================

  /**
   * Create a key ceremony
   */
  async createCeremony(config: CeremonyConfig): Promise<Ceremony> {
    if (!this.ceremonyManager) {
      throw new Error('Ceremony manager not initialized');
    }

    return this.ceremonyManager.createCeremony(config);
  }

  /**
   * Start a key ceremony
   */
  async startCeremony(ceremonyId: string): Promise<void> {
    if (!this.ceremonyManager) {
      throw new Error('Ceremony manager not initialized');
    }

    return this.ceremonyManager.startCeremony(ceremonyId);
  }

  /**
   * Get ceremony
   */
  getCeremony(ceremonyId: string): Ceremony | undefined {
    return this.ceremonyManager?.getCeremony(ceremonyId);
  }

  /**
   * Get ceremony manager for advanced operations
   */
  getCeremonyManager(): KeyCeremonyManager | null {
    return this.ceremonyManager;
  }

  // ============================================================================
  // Status and Monitoring
  // ============================================================================

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    initialized: boolean;
    activeProvider: string | null;
    providers: Array<{ name: string; status: HSMStatus; isActive: boolean }>;
    metrics: OperationMetrics;
  }> {
    const providerStatuses = Array.from(this.providers.entries()).map(
      ([name, health]) => ({
        name,
        status: health.status,
        isActive: health.isActive,
      })
    );

    return {
      initialized: this.initialized,
      activeProvider: this.activeProvider?.name || null,
      providers: providerStatuses,
      metrics: { ...this.metrics },
    };
  }

  /**
   * Get operation metrics
   */
  getMetrics(): OperationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get audit logs
   */
  getAuditLogs(startTime?: Date, endTime?: Date): AuditLogEntry[] {
    let logs = [...this.auditLogs];

    if (startTime) {
      logs = logs.filter(log => log.timestamp >= startTime);
    }

    if (endTime) {
      logs = logs.filter(log => log.timestamp <= endTime);
    }

    return logs;
  }

  /**
   * Clear metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageLatency: 0,
      operationsByType: {},
      failoverCount: 0,
    };
  }

  // ============================================================================
  // Key Caching
  // ============================================================================

  /**
   * Cache a key
   */
  private cacheKey(key: KeyHandle): void {
    const ttl = (this.config.keyCacheTTL || 300) * 1000;

    this.keyCache.set(key.id, {
      key,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl),
    });
  }

  /**
   * Clear key cache
   */
  clearKeyCache(): void {
    this.keyCache.clear();
  }

  /**
   * Remove expired cache entries
   */
  cleanupCache(): void {
    const now = new Date();

    for (const [keyId, entry] of this.keyCache) {
      if (entry.expiresAt < now) {
        this.keyCache.delete(keyId);
      }
    }
  }

  // ============================================================================
  // Helper Methods for Common Operations
  // ============================================================================

  /**
   * Generate a master encryption key
   */
  async generateMasterKey(label: string): Promise<KeyHandle> {
    return this.generateKey({
      label,
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT, KeyUsage.WRAP, KeyUsage.UNWRAP],
      extractable: false,
    });
  }

  /**
   * Generate a signing key pair
   */
  async generateSigningKeyPair(
    label: string,
    algorithm: 'RSA' | 'EC' = 'EC',
    curve: ECCurve = ECCurve.P256
  ): Promise<KeyHandle> {
    if (algorithm === 'RSA') {
      return this.generateKey({
        label,
        type: KeyType.RSA,
        size: 2048,
        usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
        extractable: false,
      });
    }

    return this.generateKey({
      label,
      type: KeyType.EC,
      curve,
      usage: [KeyUsage.SIGN, KeyUsage.VERIFY],
      extractable: false,
    });
  }

  /**
   * Generate a key encryption key (KEK)
   */
  async generateKEK(label: string): Promise<KeyHandle> {
    return this.generateKey({
      label,
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.WRAP, KeyUsage.UNWRAP],
      extractable: false,
    });
  }

  /**
   * Encrypt data with automatic key selection
   */
  async encryptData(keyLabel: string, data: Buffer): Promise<{ keyId: string; ciphertext: Buffer }> {
    // Find or create key
    const keys = await this.listKeys({ label: keyLabel });
    let key: KeyHandle;

    if (keys.length > 0) {
      key = keys[0];
    } else {
      key = await this.generateMasterKey(keyLabel);
    }

    const ciphertext = await this.encrypt(key.id, data);

    return { keyId: key.id, ciphertext };
  }

  /**
   * Check if running in production mode
   */
  isProductionMode(): boolean {
    if (!this.activeProvider) {
      return false;
    }

    return this.activeProvider.isProduction;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create HSM service with default configuration based on environment
 */
export function createHSMService(environment: 'development' | 'staging' | 'production'): HSMService {
  if (environment === 'development') {
    return new HSMService({
      primary: {
        type: 'softhsm',
        config: {
          name: 'SoftHSM-Dev',
          tokenLabel: 'dev-token',
          suppressWarnings: false,
        },
      },
      environment: 'development',
      enableFailover: false,
    });
  }

  // For staging/production, would typically use cloud HSM
  // This is a placeholder - actual config would come from environment variables
  return new HSMService({
    primary: {
      type: 'softhsm',
      config: {
        name: 'SoftHSM-Staging',
        tokenLabel: 'staging-token',
        suppressWarnings: true,
      },
    },
    environment,
    enableFailover: true,
  });
}
