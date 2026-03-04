/**
 * Database Middleware for Field-Level Encryption
 *
 * Provides transparent encryption/decryption hooks for database operations.
 * Supports integration with Drizzle ORM and other database layers.
 *
 * Features:
 * - Automatic encryption on insert/update
 * - Automatic decryption on select
 * - Configurable per-table policies
 * - Transaction support
 * - Batch operation optimization
 * - Error handling with fallback options
 *
 * @example
 * ```typescript
 * import { createEncryptionMiddleware } from './middleware';
 *
 * const middleware = createEncryptionMiddleware({
 *   policies: {
 *     users: userEncryptionPolicy,
 *     patients: patientEncryptionPolicy,
 *   },
 * });
 *
 * // Apply to Drizzle
 * const db = drizzle(connection, {
 *   ...middleware.drizzleConfig,
 * });
 * ```
 *
 * @packageDocumentation
 * @module security/encryption/middleware
 */

import { createLogger } from '../../common/logger.js';
import type { FieldEncryptionService } from './service.js';
import { getFieldEncryptionService } from './service.js';
import type {
  FieldEncryptionPolicy,
  EncryptedFieldMarker,
} from './types.js';
import { isEncryptedFieldMarker } from './types.js';
import { getEncryptedFields, generatePolicy, type EncryptedFieldMetadata } from './decorators.js';

const logger = createLogger({ component: 'encryption-middleware' });

// =============================================================================
// Types
// =============================================================================

/**
 * Table encryption policy configuration
 */
export interface TablePolicy {
  /** Table/entity name */
  tableName: string;
  /** Encryption policy for the table */
  policy: FieldEncryptionPolicy;
  /** Whether to fail on encryption errors (default: true) */
  failOnError?: boolean;
  /** Whether decryption is required or optional */
  requireDecryption?: boolean;
}

/**
 * Middleware configuration options
 */
export interface EncryptionMiddlewareConfig {
  /** Map of table names to encryption policies */
  policies: Record<string, FieldEncryptionPolicy>;
  /** Custom encryption service (uses default if not provided) */
  encryptionService?: FieldEncryptionService;
  /** Default tenant ID for multi-tenant setups */
  defaultTenantId?: string;
  /** Function to extract tenant ID from context */
  getTenantId?: (context: unknown) => string | undefined;
  /** Whether to fail on encryption errors (default: true) */
  failOnError?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Operation context for middleware hooks
 */
export interface OperationContext {
  /** Table/entity name */
  tableName: string;
  /** Operation type */
  operation: 'insert' | 'update' | 'select' | 'delete';
  /** Tenant ID if multi-tenant */
  tenantId?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** User ID performing the operation */
  userId?: string;
}

/**
 * Middleware hook result
 */
export interface HookResult<T> {
  /** The processed data */
  data: T;
  /** Fields that were encrypted/decrypted */
  processedFields: string[];
  /** Any errors that occurred (if not failing on error) */
  errors?: Array<{ field: string; error: string }>;
}

// =============================================================================
// Encryption Middleware
// =============================================================================

/**
 * Database encryption middleware
 *
 * Provides hooks for automatic field-level encryption and decryption
 * during database operations.
 */
export class EncryptionMiddleware {
  private readonly config: EncryptionMiddlewareConfig;
  private readonly encryptionService: FieldEncryptionService;
  private initialized = false;

  constructor(config: EncryptionMiddlewareConfig) {
    this.config = {
      failOnError: true,
      debug: false,
      ...config,
    };
    this.encryptionService = config.encryptionService ?? getFieldEncryptionService();
  }

  /**
   * Initialize the middleware
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('EncryptionMiddleware already initialized');
      return;
    }

    logger.info('Initializing EncryptionMiddleware');
    await this.encryptionService.initialize();
    this.initialized = true;
    logger.info(
      { tableCount: Object.keys(this.config.policies).length },
      'EncryptionMiddleware initialized'
    );
  }

  /**
   * Ensure middleware is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('EncryptionMiddleware not initialized. Call initialize() first.');
    }
  }

  /**
   * Get policy for a table
   */
  private getPolicy(tableName: string): FieldEncryptionPolicy | undefined {
    return this.config.policies[tableName];
  }

  /**
   * Extract tenant ID from context
   */
  private extractTenantId(context: OperationContext): string | undefined {
    if (context.tenantId) return context.tenantId;
    if (this.config.getTenantId) {
      return this.config.getTenantId(context);
    }
    return this.config.defaultTenantId;
  }

  /**
   * Pre-insert hook - encrypts fields before insert
   *
   * @param data - The data to be inserted
   * @param context - Operation context
   * @returns Processed data with encrypted fields
   */
  async beforeInsert<T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ): Promise<HookResult<T>> {
    this.ensureInitialized();
    const policy = this.getPolicy(context.tableName);

    if (!policy) {
      return { data, processedFields: [] };
    }

    return this.encryptData(data, policy, context);
  }

  /**
   * Pre-update hook - encrypts fields before update
   *
   * @param data - The data to be updated
   * @param context - Operation context
   * @returns Processed data with encrypted fields
   */
  async beforeUpdate<T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ): Promise<HookResult<T>> {
    this.ensureInitialized();
    const policy = this.getPolicy(context.tableName);

    if (!policy) {
      return { data, processedFields: [] };
    }

    return this.encryptData(data, policy, context);
  }

  /**
   * Post-select hook - decrypts fields after select
   *
   * @param data - The data retrieved from database
   * @param context - Operation context
   * @returns Processed data with decrypted fields
   */
  async afterSelect<T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ): Promise<HookResult<T>> {
    this.ensureInitialized();
    const policy = this.getPolicy(context.tableName);

    if (!policy) {
      return { data, processedFields: [] };
    }

    return this.decryptData(data, policy, context);
  }

  /**
   * Batch pre-insert hook - encrypts fields for multiple records
   */
  async beforeInsertMany<T extends Record<string, unknown>>(
    records: T[],
    context: OperationContext
  ): Promise<HookResult<T[]>> {
    this.ensureInitialized();
    const policy = this.getPolicy(context.tableName);

    if (!policy) {
      return { data: records, processedFields: [] };
    }

    const results = await Promise.all(
      records.map((record) => this.encryptData(record, policy, context))
    );

    const processedFields = new Set<string>();
    const errors: Array<{ field: string; error: string }> = [];

    for (const result of results) {
      result.processedFields.forEach((f) => processedFields.add(f));
      if (result.errors) {
        errors.push(...result.errors);
      }
    }

    return {
      data: results.map((r) => r.data),
      processedFields: Array.from(processedFields),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Batch post-select hook - decrypts fields for multiple records
   */
  async afterSelectMany<T extends Record<string, unknown>>(
    records: T[],
    context: OperationContext
  ): Promise<HookResult<T[]>> {
    this.ensureInitialized();
    const policy = this.getPolicy(context.tableName);

    if (!policy) {
      return { data: records, processedFields: [] };
    }

    const results = await Promise.all(
      records.map((record) => this.decryptData(record, policy, context))
    );

    const processedFields = new Set<string>();
    const errors: Array<{ field: string; error: string }> = [];

    for (const result of results) {
      result.processedFields.forEach((f) => processedFields.add(f));
      if (result.errors) {
        errors.push(...result.errors);
      }
    }

    return {
      data: results.map((r) => r.data),
      processedFields: Array.from(processedFields),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Encrypt data according to policy
   */
  private async encryptData<T extends Record<string, unknown>>(
    data: T,
    policy: FieldEncryptionPolicy,
    context: OperationContext
  ): Promise<HookResult<T>> {
    const result = { ...data };
    const processedFields: string[] = [];
    const errors: Array<{ field: string; error: string }> = [];
    const tenantId = this.extractTenantId(context);

    for (const fieldPolicy of policy.fields) {
      if (!fieldPolicy.encrypted) continue;

      const value = this.getNestedValue(data, fieldPolicy.fieldName);

      // Skip if value is null, undefined, or already encrypted
      if (value === null || value === undefined) continue;
      if (isEncryptedFieldMarker(value)) continue;

      try {
        const encrypted = await this.encryptionService.encrypt(String(value), {
          fieldName: fieldPolicy.fieldName,
          classification: fieldPolicy.classification,
          algorithm: fieldPolicy.algorithm,
          deterministic: fieldPolicy.deterministic,
          tenantId,
        });

        this.setNestedValue(result, fieldPolicy.fieldName, encrypted);
        processedFields.push(fieldPolicy.fieldName);

        if (this.config.debug) {
          logger.debug(
            { field: fieldPolicy.fieldName, table: context.tableName },
            'Field encrypted'
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (this.config.failOnError) {
          throw error;
        }

        errors.push({ field: fieldPolicy.fieldName, error: errorMessage });
        logger.error(
          { error, field: fieldPolicy.fieldName, table: context.tableName },
          'Failed to encrypt field'
        );
      }
    }

    return {
      data: result,
      processedFields,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Decrypt data according to policy
   */
  private async decryptData<T extends Record<string, unknown>>(
    data: T,
    policy: FieldEncryptionPolicy,
    context: OperationContext
  ): Promise<HookResult<T>> {
    const result = { ...data };
    const processedFields: string[] = [];
    const errors: Array<{ field: string; error: string }> = [];
    const tenantId = this.extractTenantId(context);

    for (const fieldPolicy of policy.fields) {
      if (!fieldPolicy.encrypted) continue;

      const value = this.getNestedValue(data, fieldPolicy.fieldName);

      // Skip if not encrypted
      if (!isEncryptedFieldMarker(value)) continue;

      try {
        const decrypted = await this.encryptionService.decrypt(value as EncryptedFieldMarker, {
          fieldName: fieldPolicy.fieldName,
          tenantId,
        });

        this.setNestedValue(result, fieldPolicy.fieldName, decrypted);
        processedFields.push(fieldPolicy.fieldName);

        if (this.config.debug) {
          logger.debug(
            { field: fieldPolicy.fieldName, table: context.tableName },
            'Field decrypted'
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (this.config.failOnError) {
          throw error;
        }

        errors.push({ field: fieldPolicy.fieldName, error: errorMessage });
        logger.error(
          { error, field: fieldPolicy.fieldName, table: context.tableName },
          'Failed to decrypt field'
        );
      }
    }

    return {
      data: result,
      processedFields,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set nested value in object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Create Drizzle ORM compatible configuration
   *
   * Returns configuration hooks that can be passed to Drizzle.
   */
  getDrizzleConfig(): DrizzleEncryptionConfig {
    return {
      beforeInsert: this.beforeInsert.bind(this),
      beforeUpdate: this.beforeUpdate.bind(this),
      afterSelect: this.afterSelect.bind(this),
      beforeInsertMany: this.beforeInsertMany.bind(this),
      afterSelectMany: this.afterSelectMany.bind(this),
    };
  }

  /**
   * Shutdown the middleware
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down EncryptionMiddleware');
    this.initialized = false;
    logger.info('EncryptionMiddleware shutdown complete');
  }
}

/**
 * Drizzle ORM encryption configuration
 */
export interface DrizzleEncryptionConfig {
  beforeInsert: <T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ) => Promise<HookResult<T>>;
  beforeUpdate: <T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ) => Promise<HookResult<T>>;
  afterSelect: <T extends Record<string, unknown>>(
    data: T,
    context: OperationContext
  ) => Promise<HookResult<T>>;
  beforeInsertMany: <T extends Record<string, unknown>>(
    records: T[],
    context: OperationContext
  ) => Promise<HookResult<T[]>>;
  afterSelectMany: <T extends Record<string, unknown>>(
    records: T[],
    context: OperationContext
  ) => Promise<HookResult<T[]>>;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create encryption middleware instance
 */
export function createEncryptionMiddleware(
  config: EncryptionMiddlewareConfig
): EncryptionMiddleware {
  return new EncryptionMiddleware(config);
}

/**
 * Create middleware from decorated classes
 *
 * Automatically generates policies from class decorators.
 *
 * @example
 * ```typescript
 * const middleware = createMiddlewareFromClasses({
 *   User: UserEntity,
 *   Patient: PatientEntity,
 * });
 * ```
 */
export function createMiddlewareFromClasses(
  classMap: Record<string, new (...args: unknown[]) => unknown>,
  options?: Omit<EncryptionMiddlewareConfig, 'policies'>
): EncryptionMiddleware {
  const policies: Record<string, FieldEncryptionPolicy> = {};

  for (const [tableName, cls] of Object.entries(classMap)) {
    const policy = generatePolicy(cls, tableName);
    if (policy.fields.length > 0) {
      policies[tableName] = policy;
    }
  }

  return createEncryptionMiddleware({
    ...options,
    policies,
  });
}

// =============================================================================
// Singleton Management
// =============================================================================

let defaultMiddleware: EncryptionMiddleware | null = null;

/**
 * Get the default encryption middleware instance
 */
export function getEncryptionMiddleware(): EncryptionMiddleware | null {
  return defaultMiddleware;
}

/**
 * Set the default encryption middleware instance
 */
export function setEncryptionMiddleware(middleware: EncryptionMiddleware): void {
  defaultMiddleware = middleware;
}

/**
 * Reset the default encryption middleware (for testing)
 */
export async function resetEncryptionMiddleware(): Promise<void> {
  if (defaultMiddleware) {
    await defaultMiddleware.shutdown();
    defaultMiddleware = null;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a policy builder for fluent policy creation
 *
 * @example
 * ```typescript
 * const policy = policyBuilder('users')
 *   .addField('ssn', DataClassification.RESTRICTED)
 *   .addSearchableField('email', DataClassification.CONFIDENTIAL)
 *   .addField('phone', DataClassification.CONFIDENTIAL, { algorithm: 'chacha20-poly1305' })
 *   .build();
 * ```
 */
export function policyBuilder(entityName: string): PolicyBuilder {
  return new PolicyBuilder(entityName);
}

/**
 * Fluent policy builder
 */
export class PolicyBuilder {
  private readonly entityName: string;
  private readonly fields: FieldEncryptionPolicy['fields'] = [];
  private description?: string;
  private defaultClassification?: import('./types.js').DataClassification;
  private strictMode = false;

  constructor(entityName: string) {
    this.entityName = entityName;
  }

  /**
   * Add a field to the policy
   */
  addField(
    fieldName: string,
    classification: import('./types.js').DataClassification,
    options?: {
      algorithm?: import('./types.js').EncryptionAlgorithm;
      keyDerivationSuffix?: string;
    }
  ): this {
    this.fields.push({
      fieldName,
      classification,
      encrypted: true,
      algorithm: options?.algorithm,
      keyDerivationSuffix: options?.keyDerivationSuffix,
    });
    return this;
  }

  /**
   * Add a searchable (deterministic) encrypted field
   */
  addSearchableField(
    fieldName: string,
    classification: import('./types.js').DataClassification,
    options?: {
      keyDerivationSuffix?: string;
    }
  ): this {
    this.fields.push({
      fieldName,
      classification,
      encrypted: true,
      deterministic: true,
      keyDerivationSuffix: options?.keyDerivationSuffix,
    });
    return this;
  }

  /**
   * Add a non-encrypted field (for documentation)
   */
  addUnencryptedField(
    fieldName: string,
    classification: import('./types.js').DataClassification
  ): this {
    this.fields.push({
      fieldName,
      classification,
      encrypted: false,
    });
    return this;
  }

  /**
   * Set policy description
   */
  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Set default classification for unlisted fields
   */
  withDefaultClassification(
    classification: import('./types.js').DataClassification
  ): this {
    this.defaultClassification = classification;
    return this;
  }

  /**
   * Enable strict mode (fail on unlisted fields)
   */
  withStrictMode(strict = true): this {
    this.strictMode = strict;
    return this;
  }

  /**
   * Build the policy
   */
  build(): FieldEncryptionPolicy {
    return {
      entityName: this.entityName,
      description: this.description,
      fields: this.fields,
      defaultClassification: this.defaultClassification,
      strictMode: this.strictMode,
    };
  }
}
