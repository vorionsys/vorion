/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * Tenant Management Service
 *
 * Service for managing tenants (organizations) and API keys.
 *
 * @packageDocumentation
 */

import crypto from "crypto";

import { eq, and, sql } from "drizzle-orm";

import {
  tenants,
  apiKeys,
  type Tenant,
  type NewTenant,
  type ApiKey,
  type NewApiKey,
} from "@vorionsys/contracts/db";

import { getDatabase, type Database } from "../common/db.js";
import { createLogger } from "../common/logger.js";

const logger = createLogger({ component: "tenant-service" });

// ============================================================================
// Constants
// ============================================================================

/**
 * API key prefix for identification
 */
const API_KEY_PREFIX = "aa_";

/**
 * Tenant tier configurations
 */
export const TENANT_TIERS: Record<
  string,
  { agentLimit: number; apiCallsPerMonth: number }
> = {
  free: { agentLimit: 5, apiCallsPerMonth: 10000 },
  organization: { agentLimit: 100, apiCallsPerMonth: 1000000 },
  enterprise: { agentLimit: -1, apiCallsPerMonth: -1 }, // Unlimited
};

// ============================================================================
// Types
// ============================================================================

export interface CreateTenantOptions {
  slug: string;
  name: string;
  contactEmail: string;
  billingEmail?: string;
  tier?: "free" | "organization" | "enterprise";
  registry?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateApiKeyOptions {
  tenantId: string;
  name: string;
  scopes?: string[];
  rateLimit?: number;
  expiresInDays?: number;
}

export interface ApiKeyWithSecret {
  apiKey: ApiKey;
  secret: string; // Only returned once on creation
}

// ============================================================================
// Service Class
// ============================================================================

export class TenantService {
  private db: Database;

  constructor() {
    this.db = getDatabase();
  }

  // ==========================================================================
  // Tenant Management
  // ==========================================================================

  /**
   * Create a new tenant
   */
  async createTenant(options: CreateTenantOptions): Promise<Tenant> {
    const {
      slug,
      name,
      contactEmail,
      billingEmail,
      tier = "free",
      registry = "a3i",
      metadata,
    } = options;

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2 || slug.length > 63) {
      throw new Error("Invalid slug format");
    }

    // Check for duplicate slug
    const existing = await this.getTenantBySlug(slug);
    if (existing) {
      throw new Error("Tenant with this slug already exists");
    }

    const tierConfig = TENANT_TIERS[tier] ?? TENANT_TIERS.free;

    const newTenant: NewTenant = {
      slug,
      name,
      registry,
      tier,
      agentLimit: tierConfig.agentLimit,
      apiCallsPerMonth: tierConfig.apiCallsPerMonth,
      contactEmail,
      billingEmail,
      metadata,
    };

    const [tenant] = await this.db
      .insert(tenants)
      .values(newTenant)
      .returning();

    logger.info({ tenantId: tenant.id, slug }, "Tenant created");

    return tenant;
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(id: string): Promise<Tenant | null> {
    const result = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Update tenant
   */
  async updateTenant(
    id: string,
    updates: Partial<
      Pick<Tenant, "name" | "contactEmail" | "billingEmail" | "metadata">
    >,
  ): Promise<Tenant | null> {
    const result = await this.db
      .update(tenants)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Upgrade tenant tier
   */
  async upgradeTier(
    id: string,
    newTier: "organization" | "enterprise",
  ): Promise<Tenant | null> {
    const tierConfig = TENANT_TIERS[newTier];

    const result = await this.db
      .update(tenants)
      .set({
        tier: newTier,
        agentLimit: tierConfig.agentLimit,
        apiCallsPerMonth: tierConfig.apiCallsPerMonth,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id))
      .returning();

    if (result[0]) {
      logger.info({ tenantId: id, newTier }, "Tenant tier upgraded");
    }

    return result[0] ?? null;
  }

  /**
   * Suspend tenant
   */
  async suspendTenant(id: string, reason: string): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        active: false,
        suspendedAt: new Date(),
        suspendedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id));

    logger.info({ tenantId: id, reason }, "Tenant suspended");
  }

  /**
   * Reactivate tenant
   */
  async reactivateTenant(id: string): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        active: true,
        suspendedAt: null,
        suspendedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id));

    logger.info({ tenantId: id }, "Tenant reactivated");
  }

  // ==========================================================================
  // API Key Management
  // ==========================================================================

  // The apiKeys table has a dual schema conflict in contracts (agents.ts vs api-keys.ts).
  // The NewApiKey/ApiKey types come from agents.ts but the Drizzle table comes from api-keys.ts.
  // Cast to any for column access until the contracts schema is unified.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get ak(): any { return apiKeys; }

  /**
   * Create a new API key
   */
  async createApiKey(options: CreateApiKeyOptions): Promise<ApiKeyWithSecret> {
    const {
      tenantId,
      name,
      scopes = ["agents:read", "agents:write", "attestations:write"],
      rateLimit = 1000,
      expiresInDays,
    } = options;

    // Generate API key
    const secret = this.generateApiKey();
    const keyHash = this.hashApiKey(secret);
    const keyPrefix = secret.substring(0, 11); // "aa_" + 8 chars

    let expiresAt: Date | undefined;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const newApiKey = {
      tenantId,
      keyHash,
      keyPrefix,
      name,
      scopes,
      rateLimit,
      rateLimitRemaining: rateLimit,
      expiresAt,
    };

    const [apiKey] = await this.db
      .insert(this.ak)
      .values(newApiKey)
      .returning() as ApiKey[];

    logger.info({ apiKeyId: apiKey.id, tenantId, name }, "API key created");

    return {
      apiKey,
      secret, // Only returned on creation!
    };
  }

  /**
   * Validate an API key and return tenant context
   */
  async validateApiKey(
    key: string,
  ): Promise<{
    valid: boolean;
    tenantId?: string;
    scopes?: string[];
    error?: string;
  }> {
    if (!key.startsWith(API_KEY_PREFIX)) {
      return { valid: false, error: "Invalid key format" };
    }

    const keyHash = this.hashApiKey(key);

    const result = await this.db
      .select()
      .from(this.ak)
      .where(and(eq(this.ak.keyHash, keyHash), eq(this.ak.active, true)))
      .limit(1);

    if (result.length === 0) {
      return { valid: false, error: "Key not found or inactive" };
    }

    const apiKey = result[0];

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false, error: "Key expired" };
    }

    // Check rate limit
    if (apiKey.rateLimitRemaining <= 0) {
      return { valid: false, error: "Rate limit exceeded" };
    }

    // Update usage
    await this.db
      .update(this.ak)
      .set({
        lastUsedAt: new Date(),
        usageCount: apiKey.usageCount + 1,
        rateLimitRemaining: apiKey.rateLimitRemaining - 1,
        updatedAt: new Date(),
      })
      .where(eq(this.ak.id, apiKey.id));

    return {
      valid: true,
      tenantId: apiKey.tenantId,
      scopes: apiKey.scopes as string[],
    };
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(id: string, reason: string): Promise<void> {
    await this.db
      .update(this.ak)
      .set({
        active: false,
        revokedAt: new Date(),
        revokedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(this.ak.id, id));

    logger.info({ apiKeyId: id, reason }, "API key revoked");
  }

  /**
   * List API keys for a tenant
   */
  async listApiKeys(tenantId: string): Promise<ApiKey[]> {
    return this.db.select().from(this.ak).where(eq(this.ak.tenantId, tenantId)) as unknown as Promise<ApiKey[]>;
  }

  /**
   * Reset rate limits (called by scheduler)
   */
  async resetRateLimits(): Promise<number> {
    const result = await this.db
      .update(this.ak)
      .set({
        rateLimitRemaining: sql`${this.ak.rateLimit}`,
        rateLimitResetAt: new Date(),
      })
      .where(eq(this.ak.active, true))
      .returning() as ApiKey[];

    logger.info({ count: result.length }, "Rate limits reset");

    return result.length;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Generate a new API key
   */
  private generateApiKey(): string {
    const bytes = crypto.randomBytes(32);
    const key = bytes.toString("base64url");
    return `${API_KEY_PREFIX}${key}`;
  }

  /**
   * Hash an API key for storage
   */
  private hashApiKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex");
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: TenantService | null = null;

export function createTenantService(): TenantService {
  if (!instance) {
    instance = new TenantService();
  }
  return instance;
}

export function getTenantService(): TenantService {
  if (!instance) {
    throw new Error("TenantService not initialized");
  }
  return instance;
}
