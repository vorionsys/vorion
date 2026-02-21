/**
 * Service Account Management
 *
 * Provides types, interfaces, and management functions for service accounts
 * used in service-to-service authentication.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { VorionError, NotFoundError, ConflictError, ValidationError } from '../../common/errors.js';

const logger = createLogger({ component: 'service-account' });

// =============================================================================
// TYPES AND SCHEMAS
// =============================================================================

/**
 * Service account status
 */
export const ServiceAccountStatus = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  SUSPENDED: 'suspended',
} as const;

export type ServiceAccountStatus = (typeof ServiceAccountStatus)[keyof typeof ServiceAccountStatus];

export const serviceAccountStatusSchema = z.nativeEnum(ServiceAccountStatus);

/**
 * Service account interface
 */
export interface ServiceAccount {
  /** Unique client identifier */
  clientId: string;
  /** Hashed client secret (SHA-256) */
  clientSecret: string;
  /** Human-readable name for the service */
  name: string;
  /** List of permissions granted to this service */
  permissions: string[];
  /** Optional IP whitelist for additional security */
  ipWhitelist?: string[];
  /** Service account status */
  status: ServiceAccountStatus;
  /** Tenant ID this service belongs to */
  tenantId: string;
  /** Description of the service */
  description?: string;
  /** When the account was created */
  createdAt: Date;
  /** When the account was last used */
  lastUsedAt?: Date;
  /** When the secret was last rotated */
  secretRotatedAt?: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Service account schema for validation
 */
export const serviceAccountSchema = z.object({
  clientId: z.string().uuid(),
  clientSecret: z.string().min(64), // SHA-256 hash is 64 hex chars
  name: z.string().min(1).max(255),
  permissions: z.array(z.string()),
  ipWhitelist: z.array(z.string().ip()).optional(),
  status: serviceAccountStatusSchema,
  tenantId: z.string().uuid(),
  description: z.string().max(1000).optional(),
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().optional(),
  secretRotatedAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Input for creating a service account
 */
export interface CreateServiceAccountInput {
  name: string;
  permissions: string[];
  tenantId: string;
  ipWhitelist?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export const createServiceAccountInputSchema = z.object({
  name: z.string().min(1).max(255),
  permissions: z.array(z.string()).min(1),
  tenantId: z.string().uuid(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Result of creating a service account (includes plaintext secret)
 */
export interface ServiceAccountCreationResult {
  account: ServiceAccount;
  /** The plaintext client secret - only returned once at creation */
  clientSecretPlaintext: string;
}

/**
 * Result of rotating a service account secret
 */
export interface SecretRotationResult {
  account: ServiceAccount;
  /** The new plaintext client secret */
  newClientSecretPlaintext: string;
  /** Previous secret hash (for audit) */
  previousSecretHash: string;
}

/**
 * Input for updating a service account
 */
export interface UpdateServiceAccountInput {
  name?: string;
  permissions?: string[];
  ipWhitelist?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export const updateServiceAccountInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  permissions: z.array(z.string()).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Service account specific error
 */
export class ServiceAccountError extends VorionError {
  override code = 'SERVICE_ACCOUNT_ERROR';
  override statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ServiceAccountError';
  }
}

/**
 * Service account not found error
 */
export class ServiceAccountNotFoundError extends NotFoundError {
  override code = 'SERVICE_ACCOUNT_NOT_FOUND';

  constructor(clientId: string) {
    super(`Service account not found: ${clientId}`, { clientId });
    this.name = 'ServiceAccountNotFoundError';
  }
}

/**
 * Service account revoked error
 */
export class ServiceAccountRevokedError extends VorionError {
  override code = 'SERVICE_ACCOUNT_REVOKED';
  override statusCode = 401;

  constructor(clientId: string) {
    super(`Service account has been revoked: ${clientId}`, { clientId });
    this.name = 'ServiceAccountRevokedError';
  }
}

/**
 * Service account suspended error
 */
export class ServiceAccountSuspendedError extends VorionError {
  override code = 'SERVICE_ACCOUNT_SUSPENDED';
  override statusCode = 403;

  constructor(clientId: string) {
    super(`Service account is suspended: ${clientId}`, { clientId });
    this.name = 'ServiceAccountSuspendedError';
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Length of generated client secrets in bytes */
const CLIENT_SECRET_LENGTH = 32;

/** Prefix for client IDs */
export const SERVICE_CLIENT_ID_PREFIX = 'svc_';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a cryptographically secure client secret
 */
export function generateClientSecret(): string {
  return randomBytes(CLIENT_SECRET_LENGTH).toString('hex');
}

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
  const id = randomBytes(16).toString('hex');
  return `${SERVICE_CLIENT_ID_PREFIX}${id}`;
}

/**
 * Hash a client secret using SHA-256
 */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Verify a client secret against its hash using timing-safe comparison
 */
export function verifyClientSecret(secret: string, hashedSecret: string): boolean {
  const hashedInput = hashClientSecret(secret);

  // Use timing-safe comparison to prevent timing attacks
  if (hashedInput.length !== hashedSecret.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(hashedInput), Buffer.from(hashedSecret));
}

// =============================================================================
// SERVICE ACCOUNT STORE INTERFACE
// =============================================================================

/**
 * Interface for service account storage
 */
export interface IServiceAccountStore {
  /** Create a new service account */
  create(account: ServiceAccount): Promise<ServiceAccount>;

  /** Find a service account by client ID */
  findByClientId(clientId: string): Promise<ServiceAccount | null>;

  /** Find all service accounts for a tenant */
  findByTenantId(tenantId: string): Promise<ServiceAccount[]>;

  /** Update a service account */
  update(clientId: string, updates: Partial<ServiceAccount>): Promise<ServiceAccount>;

  /** Delete a service account */
  delete(clientId: string): Promise<boolean>;

  /** Update last used timestamp */
  updateLastUsed(clientId: string): Promise<void>;
}

// =============================================================================
// IN-MEMORY STORE (for testing/development)
// =============================================================================

/**
 * In-memory implementation of service account store
 */
export class InMemoryServiceAccountStore implements IServiceAccountStore {
  private accounts: Map<string, ServiceAccount> = new Map();

  async create(account: ServiceAccount): Promise<ServiceAccount> {
    if (this.accounts.has(account.clientId)) {
      throw new ConflictError(`Service account already exists: ${account.clientId}`);
    }
    this.accounts.set(account.clientId, { ...account });
    return { ...account };
  }

  async findByClientId(clientId: string): Promise<ServiceAccount | null> {
    const account = this.accounts.get(clientId);
    return account ? { ...account } : null;
  }

  async findByTenantId(tenantId: string): Promise<ServiceAccount[]> {
    const results: ServiceAccount[] = [];
    for (const account of this.accounts.values()) {
      if (account.tenantId === tenantId) {
        results.push({ ...account });
      }
    }
    return results;
  }

  async update(clientId: string, updates: Partial<ServiceAccount>): Promise<ServiceAccount> {
    const account = this.accounts.get(clientId);
    if (!account) {
      throw new ServiceAccountNotFoundError(clientId);
    }
    const updated = { ...account, ...updates };
    this.accounts.set(clientId, updated);
    return { ...updated };
  }

  async delete(clientId: string): Promise<boolean> {
    return this.accounts.delete(clientId);
  }

  async updateLastUsed(clientId: string): Promise<void> {
    const account = this.accounts.get(clientId);
    if (account) {
      account.lastUsedAt = new Date();
    }
  }

  /** Clear all accounts (for testing) */
  clear(): void {
    this.accounts.clear();
  }
}

// =============================================================================
// SERVICE ACCOUNT SERVICE
// =============================================================================

/**
 * Service account manager configuration
 */
export interface ServiceAccountManagerConfig {
  /** Store implementation */
  store: IServiceAccountStore;
  /** Minimum secret rotation interval in days */
  minSecretRotationDays?: number;
  /** Maximum number of service accounts per tenant */
  maxAccountsPerTenant?: number;
}

/**
 * Service account manager
 */
export class ServiceAccountManager {
  private readonly store: IServiceAccountStore;
  private readonly minSecretRotationDays: number;
  private readonly maxAccountsPerTenant: number;

  constructor(config: ServiceAccountManagerConfig) {
    this.store = config.store;
    this.minSecretRotationDays = config.minSecretRotationDays ?? 90;
    this.maxAccountsPerTenant = config.maxAccountsPerTenant ?? 100;
  }

  /**
   * Create a new service account
   */
  async createAccount(input: CreateServiceAccountInput): Promise<ServiceAccountCreationResult> {
    // Validate input
    const validated = createServiceAccountInputSchema.parse(input);

    // Check tenant account limit
    const existingAccounts = await this.store.findByTenantId(validated.tenantId);
    if (existingAccounts.length >= this.maxAccountsPerTenant) {
      throw new ValidationError(
        `Maximum service accounts per tenant exceeded (${this.maxAccountsPerTenant})`,
        { tenantId: validated.tenantId, current: existingAccounts.length }
      );
    }

    // Generate credentials
    const clientId = generateClientId();
    const clientSecretPlaintext = generateClientSecret();
    const clientSecretHash = hashClientSecret(clientSecretPlaintext);

    const now = new Date();
    const account: ServiceAccount = {
      clientId,
      clientSecret: clientSecretHash,
      name: validated.name,
      permissions: validated.permissions,
      ipWhitelist: validated.ipWhitelist,
      status: ServiceAccountStatus.ACTIVE,
      tenantId: validated.tenantId,
      description: validated.description,
      createdAt: now,
      secretRotatedAt: now,
      metadata: validated.metadata,
    };

    const created = await this.store.create(account);

    logger.info(
      { clientId, tenantId: validated.tenantId, name: validated.name },
      'Service account created'
    );

    return {
      account: created,
      clientSecretPlaintext,
    };
  }

  /**
   * Get a service account by client ID
   */
  async getAccount(clientId: string): Promise<ServiceAccount> {
    const account = await this.store.findByClientId(clientId);
    if (!account) {
      throw new ServiceAccountNotFoundError(clientId);
    }
    return account;
  }

  /**
   * Get a service account if it exists
   */
  async findAccount(clientId: string): Promise<ServiceAccount | null> {
    return this.store.findByClientId(clientId);
  }

  /**
   * List all service accounts for a tenant
   */
  async listAccounts(tenantId: string): Promise<ServiceAccount[]> {
    return this.store.findByTenantId(tenantId);
  }

  /**
   * Update a service account
   */
  async updateAccount(clientId: string, input: UpdateServiceAccountInput): Promise<ServiceAccount> {
    const validated = updateServiceAccountInputSchema.parse(input);

    // Verify account exists
    await this.getAccount(clientId);

    const updated = await this.store.update(clientId, validated);

    logger.info({ clientId }, 'Service account updated');

    return updated;
  }

  /**
   * Revoke a service account
   */
  async revokeAccount(clientId: string): Promise<ServiceAccount> {
    const account = await this.getAccount(clientId);

    if (account.status === ServiceAccountStatus.REVOKED) {
      throw new ServiceAccountError('Service account is already revoked', { clientId });
    }

    const updated = await this.store.update(clientId, {
      status: ServiceAccountStatus.REVOKED,
    });

    logger.warn({ clientId }, 'Service account revoked');

    return updated;
  }

  /**
   * Suspend a service account
   */
  async suspendAccount(clientId: string): Promise<ServiceAccount> {
    const account = await this.getAccount(clientId);

    if (account.status === ServiceAccountStatus.REVOKED) {
      throw new ServiceAccountError('Cannot suspend a revoked account', { clientId });
    }

    const updated = await this.store.update(clientId, {
      status: ServiceAccountStatus.SUSPENDED,
    });

    logger.warn({ clientId }, 'Service account suspended');

    return updated;
  }

  /**
   * Reactivate a suspended service account
   */
  async reactivateAccount(clientId: string): Promise<ServiceAccount> {
    const account = await this.getAccount(clientId);

    if (account.status === ServiceAccountStatus.REVOKED) {
      throw new ServiceAccountError('Cannot reactivate a revoked account', { clientId });
    }

    if (account.status === ServiceAccountStatus.ACTIVE) {
      throw new ServiceAccountError('Account is already active', { clientId });
    }

    const updated = await this.store.update(clientId, {
      status: ServiceAccountStatus.ACTIVE,
    });

    logger.info({ clientId }, 'Service account reactivated');

    return updated;
  }

  /**
   * Delete a service account permanently
   */
  async deleteAccount(clientId: string): Promise<boolean> {
    // Verify account exists
    await this.getAccount(clientId);

    const deleted = await this.store.delete(clientId);

    if (deleted) {
      logger.warn({ clientId }, 'Service account deleted');
    }

    return deleted;
  }

  /**
   * Rotate a service account's secret
   */
  async rotateSecret(clientId: string): Promise<SecretRotationResult> {
    const account = await this.getAccount(clientId);

    if (account.status !== ServiceAccountStatus.ACTIVE) {
      throw new ServiceAccountError('Cannot rotate secret for inactive account', {
        clientId,
        status: account.status,
      });
    }

    const previousSecretHash = account.clientSecret;
    const newClientSecretPlaintext = generateClientSecret();
    const newSecretHash = hashClientSecret(newClientSecretPlaintext);

    const updated = await this.store.update(clientId, {
      clientSecret: newSecretHash,
      secretRotatedAt: new Date(),
    });

    logger.info({ clientId }, 'Service account secret rotated');

    return {
      account: updated,
      newClientSecretPlaintext,
      previousSecretHash,
    };
  }

  /**
   * Verify credentials for a service account
   */
  async verifyCredentials(clientId: string, clientSecret: string): Promise<ServiceAccount> {
    const account = await this.findAccount(clientId);

    if (!account) {
      // Use same error to prevent enumeration
      throw new ServiceAccountError('Invalid credentials');
    }

    if (account.status === ServiceAccountStatus.REVOKED) {
      throw new ServiceAccountRevokedError(clientId);
    }

    if (account.status === ServiceAccountStatus.SUSPENDED) {
      throw new ServiceAccountSuspendedError(clientId);
    }

    if (!verifyClientSecret(clientSecret, account.clientSecret)) {
      throw new ServiceAccountError('Invalid credentials');
    }

    // Update last used timestamp asynchronously
    this.store.updateLastUsed(clientId).catch((err) => {
      logger.error({ err, clientId }, 'Failed to update lastUsedAt');
    });

    return account;
  }

  /**
   * Check if an IP address is allowed for a service account
   */
  async isIpAllowed(clientId: string, ipAddress: string): Promise<boolean> {
    const account = await this.getAccount(clientId);

    // If no whitelist, allow all
    if (!account.ipWhitelist || account.ipWhitelist.length === 0) {
      return true;
    }

    return account.ipWhitelist.includes(ipAddress);
  }

  /**
   * Check if a service account has a specific permission
   */
  async hasPermission(clientId: string, permission: string): Promise<boolean> {
    const account = await this.getAccount(clientId);

    // Check for wildcard permission
    if (account.permissions.includes('*')) {
      return true;
    }

    // Check for exact match
    if (account.permissions.includes(permission)) {
      return true;
    }

    // Check for prefix match (e.g., 'read:*' matches 'read:users')
    for (const perm of account.permissions) {
      if (perm.endsWith(':*')) {
        const prefix = perm.slice(0, -1); // Remove '*'
        if (permission.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if secret rotation is recommended
   */
  async isSecretRotationRecommended(clientId: string): Promise<boolean> {
    const account = await this.getAccount(clientId);

    if (!account.secretRotatedAt) {
      return true;
    }

    const daysSinceRotation = Math.floor(
      (Date.now() - account.secretRotatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceRotation >= this.minSecretRotationDays;
  }
}

// =============================================================================
// SINGLETON MANAGEMENT
// =============================================================================

let defaultStore: IServiceAccountStore | null = null;
let defaultManager: ServiceAccountManager | null = null;

/**
 * Get the default service account store
 */
export function getServiceAccountStore(): IServiceAccountStore {
  if (!defaultStore) {
    defaultStore = new InMemoryServiceAccountStore();
  }
  return defaultStore;
}

/**
 * Set a custom service account store
 */
export function setServiceAccountStore(store: IServiceAccountStore): void {
  defaultStore = store;
  // Reset manager to use new store
  defaultManager = null;
}

/**
 * Get the default service account manager
 */
export function getServiceAccountManager(): ServiceAccountManager {
  if (!defaultManager) {
    defaultManager = new ServiceAccountManager({
      store: getServiceAccountStore(),
    });
  }
  return defaultManager;
}

/**
 * Create a service account manager with custom config
 */
export function createServiceAccountManager(
  config: ServiceAccountManagerConfig
): ServiceAccountManager {
  return new ServiceAccountManager(config);
}

/**
 * Reset singleton instances (for testing)
 */
export function resetServiceAccountSingletons(): void {
  defaultStore = null;
  defaultManager = null;
}
