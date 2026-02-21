/**
 * Base Repository Pattern
 *
 * Provides abstract repository interface for domain entities
 * with tenant scoping, soft deletes, and pagination.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'repository' });

// ============================================================================
// Types
// ============================================================================

export interface QueryOptions {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Cursor for cursor-based pagination */
  cursor?: string;
  /** Include soft-deleted records */
  includeDeleted?: boolean;
  /** Order by field */
  orderBy?: string;
  /** Order direction */
  orderDir?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  /** Items in current page */
  items: T[];
  /** Total count (if available) */
  total?: number;
  /** Limit used */
  limit: number;
  /** Offset used */
  offset?: number;
  /** Next cursor for pagination */
  nextCursor?: string;
  /** Has more results */
  hasMore: boolean;
}

export interface EntityMeta {
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Soft delete timestamp */
  deletedAt?: string;
}

export interface TenantScoped {
  /** Tenant identifier */
  tenantId: string;
}

// ============================================================================
// Base Repository
// ============================================================================

/**
 * Abstract base repository for domain entities
 */
export abstract class BaseRepository<T, ID = string> {
  protected readonly entityName: string;

  constructor(entityName: string) {
    this.entityName = entityName;
  }

  /**
   * Create a new entity
   */
  abstract create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;

  /**
   * Find entity by ID
   */
  abstract findById(id: ID): Promise<T | null>;

  /**
   * Find entities by tenant
   */
  abstract findByTenant(
    tenantId: string,
    options?: QueryOptions
  ): Promise<PaginatedResult<T>>;

  /**
   * Update an entity
   */
  abstract update(id: ID, updates: Partial<T>): Promise<T>;

  /**
   * Soft delete an entity
   */
  abstract softDelete(id: ID): Promise<void>;

  /**
   * Hard delete an entity (use with caution)
   */
  abstract hardDelete(id: ID): Promise<void>;

  /**
   * Check if entity exists
   */
  abstract exists(id: ID): Promise<boolean>;

  /**
   * Count entities by tenant
   */
  abstract countByTenant(tenantId: string): Promise<number>;

  /**
   * Log repository operation
   */
  protected logOperation(
    operation: string,
    id?: ID,
    details?: Record<string, unknown>
  ): void {
    logger.debug({ entity: this.entityName, operation, id, ...details }, `${this.entityName} ${operation}`);
  }
}

// ============================================================================
// Cached Repository Wrapper
// ============================================================================

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  deletePattern(pattern: string): Promise<void>;
}

export interface CacheOptions {
  /** TTL in milliseconds */
  ttl: number;
  /** Key prefix */
  prefix: string;
  /** Whether to cache list results */
  cacheList?: boolean;
}

/**
 * Cached repository wrapper using cache-aside pattern
 */
export class CachedRepository<T extends TenantScoped, ID = string> {
  constructor(
    private inner: BaseRepository<T, ID>,
    private cache: CacheAdapter,
    private options: CacheOptions
  ) {}

  private cacheKey(id: ID): string {
    return `${this.options.prefix}:${id}`;
  }

  private tenantCacheKey(tenantId: string): string {
    return `${this.options.prefix}:tenant:${tenantId}`;
  }

  /**
   * Find by ID with cache
   */
  async findById(id: ID): Promise<T | null> {
    const key = this.cacheKey(id);

    // Try cache first
    const cached = await this.cache.get<T>(key);
    if (cached) {
      return cached;
    }

    // Fallback to DB
    const entity = await this.inner.findById(id);
    if (entity) {
      await this.cache.set(key, entity, this.options.ttl);
    }

    return entity;
  }

  /**
   * Create with cache invalidation
   */
  async create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
    const created = await this.inner.create(entity);
    const tenantId = (entity as TenantScoped).tenantId;

    // Invalidate tenant list cache
    await this.cache.delete(this.tenantCacheKey(tenantId));

    return created;
  }

  /**
   * Update with cache invalidation
   */
  async update(id: ID, updates: Partial<T>): Promise<T> {
    const updated = await this.inner.update(id, updates);

    // Invalidate entity cache
    await this.cache.delete(this.cacheKey(id));

    // Invalidate tenant list cache
    await this.cache.delete(this.tenantCacheKey(updated.tenantId));

    return updated;
  }

  /**
   * Delete with cache invalidation
   */
  async softDelete(id: ID): Promise<void> {
    const entity = await this.inner.findById(id);
    if (entity) {
      await this.inner.softDelete(id);
      await this.cache.delete(this.cacheKey(id));
      await this.cache.delete(this.tenantCacheKey(entity.tenantId));
    }
  }

  /**
   * Find by tenant with optional caching
   */
  async findByTenant(
    tenantId: string,
    options?: QueryOptions
  ): Promise<PaginatedResult<T>> {
    // List results are typically not cached due to complexity
    return this.inner.findByTenant(tenantId, options);
  }

  /**
   * Invalidate cache for an entity
   */
  async invalidate(id: ID): Promise<void> {
    await this.cache.delete(this.cacheKey(id));
  }

  /**
   * Invalidate all cache for a tenant
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.cache.deletePattern(`${this.options.prefix}:tenant:${tenantId}*`);
  }
}

// ============================================================================
// Unit of Work Pattern
// ============================================================================

export interface UnitOfWork {
  /** Begin transaction */
  begin(): Promise<void>;
  /** Commit transaction */
  commit(): Promise<void>;
  /** Rollback transaction */
  rollback(): Promise<void>;
  /** Execute within transaction */
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Create a unit of work for transactional operations
 */
export function createUnitOfWork(getConnection: () => Promise<{
  query: (sql: string) => Promise<void>;
}>): UnitOfWork {
  let connection: { query: (sql: string) => Promise<void> } | null = null;

  return {
    async begin() {
      connection = await getConnection();
      await connection.query('BEGIN');
    },

    async commit() {
      if (connection) {
        await connection.query('COMMIT');
        connection = null;
      }
    },

    async rollback() {
      if (connection) {
        await connection.query('ROLLBACK');
        connection = null;
      }
    },

    async execute<T>(fn: () => Promise<T>): Promise<T> {
      await this.begin();
      try {
        const result = await fn();
        await this.commit();
        return result;
      } catch (error) {
        await this.rollback();
        throw error;
      }
    },
  };
}

// ============================================================================
// Specification Pattern
// ============================================================================

/**
 * Specification interface for complex queries
 */
export interface Specification<T> {
  /** Check if entity satisfies specification */
  isSatisfiedBy(entity: T): boolean;
  /** Convert to SQL WHERE clause */
  toSql(): { clause: string; params: unknown[] };
  /** Combine with AND */
  and(other: Specification<T>): Specification<T>;
  /** Combine with OR */
  or(other: Specification<T>): Specification<T>;
  /** Negate specification */
  not(): Specification<T>;
}

/**
 * Base specification implementation
 */
export abstract class BaseSpecification<T> implements Specification<T> {
  abstract isSatisfiedBy(entity: T): boolean;
  abstract toSql(): { clause: string; params: unknown[] };

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification(this, other);
  }

  not(): Specification<T> {
    return new NotSpecification(this);
  }
}

class AndSpecification<T> extends BaseSpecification<T> {
  constructor(
    private left: Specification<T>,
    private right: Specification<T>
  ) {
    super();
  }

  isSatisfiedBy(entity: T): boolean {
    return this.left.isSatisfiedBy(entity) && this.right.isSatisfiedBy(entity);
  }

  toSql(): { clause: string; params: unknown[] } {
    const leftSql = this.left.toSql();
    const rightSql = this.right.toSql();
    return {
      clause: `(${leftSql.clause}) AND (${rightSql.clause})`,
      params: [...leftSql.params, ...rightSql.params],
    };
  }
}

class OrSpecification<T> extends BaseSpecification<T> {
  constructor(
    private left: Specification<T>,
    private right: Specification<T>
  ) {
    super();
  }

  isSatisfiedBy(entity: T): boolean {
    return this.left.isSatisfiedBy(entity) || this.right.isSatisfiedBy(entity);
  }

  toSql(): { clause: string; params: unknown[] } {
    const leftSql = this.left.toSql();
    const rightSql = this.right.toSql();
    return {
      clause: `(${leftSql.clause}) OR (${rightSql.clause})`,
      params: [...leftSql.params, ...rightSql.params],
    };
  }
}

class NotSpecification<T> extends BaseSpecification<T> {
  constructor(private spec: Specification<T>) {
    super();
  }

  isSatisfiedBy(entity: T): boolean {
    return !this.spec.isSatisfiedBy(entity);
  }

  toSql(): { clause: string; params: unknown[] } {
    const sql = this.spec.toSql();
    return {
      clause: `NOT (${sql.clause})`,
      params: sql.params,
    };
  }
}
