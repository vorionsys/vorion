/**
 * Dependency Injection Utilities
 *
 * Provides interfaces and factory helpers for dependency injection,
 * replacing service locator anti-pattern with explicit dependency injection.
 *
 * @packageDocumentation
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Config } from './config.js';

// =============================================================================
// DEPENDENCY INTERFACES
// =============================================================================

/**
 * Database dependency interface
 */
export interface IDatabase {
  /** Drizzle ORM database instance */
  db: NodePgDatabase;
  /** Raw PostgreSQL pool (optional, for low-level operations) */
  pool?: Pool | null;
}

/**
 * Redis dependency interface
 */
export interface IRedis {
  /** Redis client instance */
  client: Redis;
  /** Create a duplicate connection for workers */
  duplicate(): Redis;
}

/**
 * Configuration dependency interface
 */
export interface IConfig {
  /** Full application configuration */
  config: Config;
}

/**
 * Core dependencies bundle - combines all common dependencies
 */
export interface CoreDependencies {
  /** Database connection */
  database: NodePgDatabase;
  /** Redis client */
  redis: Redis;
  /** Application configuration */
  config: Config;
  /** Optional raw database pool */
  pool?: Pool | null;
}

/**
 * Partial dependencies for services that don't need everything
 */
export type PartialDependencies = Partial<CoreDependencies>;

// =============================================================================
// DEPENDENCY CONTAINER
// =============================================================================

/**
 * Dependency container for managing application dependencies.
 *
 * This is a simple container that allows registering and retrieving dependencies.
 * For most use cases, prefer passing dependencies directly to constructors.
 *
 * Use this container only when:
 * - Multiple services need the same dependencies
 * - You need late binding of dependencies
 * - You're migrating from service locators incrementally
 */
export class DependencyContainer {
  private dependencies: Map<string, unknown> = new Map();

  /**
   * Register a dependency
   */
  register<T>(key: string, dependency: T): void {
    this.dependencies.set(key, dependency);
  }

  /**
   * Get a dependency
   * @throws Error if dependency not found
   */
  get<T>(key: string): T {
    const dep = this.dependencies.get(key);
    if (dep === undefined) {
      throw new Error(`Dependency '${key}' not found. Register it before use.`);
    }
    return dep as T;
  }

  /**
   * Get a dependency or undefined if not found
   */
  getOptional<T>(key: string): T | undefined {
    return this.dependencies.get(key) as T | undefined;
  }

  /**
   * Check if a dependency is registered
   */
  has(key: string): boolean {
    return this.dependencies.has(key);
  }

  /**
   * Clear all dependencies (useful for testing)
   */
  clear(): void {
    this.dependencies.clear();
  }

  /**
   * Get all registered dependency keys
   */
  keys(): string[] {
    return Array.from(this.dependencies.keys());
  }
}

// =============================================================================
// DEPENDENCY KEYS
// =============================================================================

/**
 * Well-known dependency keys for type-safe registration
 */
export const DependencyKeys = {
  DATABASE: 'database',
  REDIS: 'redis',
  CONFIG: 'config',
  POOL: 'pool',
  LOGGER: 'logger',
} as const;

export type DependencyKey = (typeof DependencyKeys)[keyof typeof DependencyKeys];

// =============================================================================
// FACTORY HELPERS
// =============================================================================

/**
 * Creates a factory function with pre-bound dependencies.
 *
 * This is useful for creating services that need dependencies but also
 * want to allow overrides for testing.
 *
 * @example
 * ```typescript
 * const createService = withDependencies(
 *   (deps: CoreDependencies) => new MyService(deps.database, deps.redis),
 *   () => getDefaultDependencies()
 * );
 *
 * // Use with defaults
 * const service = createService();
 *
 * // Override for testing
 * const testService = createService({ redis: mockRedis });
 * ```
 */
export function withDependencies<T, D extends PartialDependencies>(
  factory: (deps: D) => T,
  getDefaults: () => D
): (overrides?: Partial<D>) => T {
  return (overrides?: Partial<D>) => {
    const defaults = getDefaults();
    const merged = { ...defaults, ...overrides } as D;
    return factory(merged);
  };
}

/**
 * Type guard to check if an object has all required dependencies
 */
export function hasRequiredDependencies<K extends string>(
  deps: PartialDependencies,
  required: readonly K[]
): deps is PartialDependencies & Record<K, NonNullable<unknown>> {
  return required.every((key) => {
    const value = (deps as Record<string, unknown>)[key];
    return value !== undefined && value !== null;
  });
}

// =============================================================================
// LAZY INITIALIZATION HELPERS
// =============================================================================

/**
 * Creates a lazy-initialized dependency.
 *
 * The factory function is called only once on first access.
 * Subsequent accesses return the cached value.
 *
 * @example
 * ```typescript
 * const lazyDb = lazy(() => getDatabase());
 *
 * // First call initializes
 * const db1 = lazyDb();
 *
 * // Subsequent calls return cached value
 * const db2 = lazyDb();
 * ```
 */
export function lazy<T>(factory: () => T): () => T {
  let instance: T | undefined;
  let initialized = false;

  return () => {
    if (!initialized) {
      instance = factory();
      initialized = true;
    }
    return instance as T;
  };
}

/**
 * Creates an async lazy-initialized dependency.
 *
 * @example
 * ```typescript
 * const lazyConnection = lazyAsync(async () => connectToDatabase());
 *
 * // First call initializes
 * const conn1 = await lazyConnection();
 *
 * // Subsequent calls return cached promise
 * const conn2 = await lazyConnection();
 * ```
 */
export function lazyAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;

  return () => {
    if (!promise) {
      promise = factory();
    }
    return promise;
  };
}

// =============================================================================
// TESTING UTILITIES
// =============================================================================

/**
 * Creates a mock dependency container for testing.
 *
 * @example
 * ```typescript
 * const mocks = createMockDependencies({
 *   database: mockDatabase,
 *   redis: mockRedis,
 * });
 * ```
 */
export function createMockDependencies(
  overrides: PartialDependencies = {}
): CoreDependencies {
  return {
    database: overrides.database as NodePgDatabase,
    redis: overrides.redis as Redis,
    config: overrides.config as Config,
    pool: overrides.pool ?? null,
  };
}

/**
 * Verify that all required dependencies are provided.
 * Throws descriptive error if any are missing.
 */
export function validateDependencies<K extends string>(
  deps: Record<string, unknown>,
  required: readonly K[],
  serviceName: string
): void {
  const missing = required.filter((key) => {
    const value = deps[key];
    return value === undefined || value === null;
  });

  if (missing.length > 0) {
    throw new Error(
      `${serviceName} is missing required dependencies: ${missing.join(', ')}. ` +
        `Either inject them via constructor or ensure they are initialized before use.`
    );
  }
}

// =============================================================================
// DEFAULT CONTAINER INSTANCE
// =============================================================================

/**
 * Default global container instance.
 *
 * IMPORTANT: Prefer explicit dependency injection over using this container.
 * This is provided for gradual migration from service locators.
 */
export const defaultContainer = new DependencyContainer();

// =============================================================================
// DEPENDENCY INJECTION DECORATORS (for future use)
// =============================================================================

/**
 * Marker interface for injectable classes.
 * Used for documentation and potential future decorator support.
 */
export interface Injectable {
  readonly __injectable?: true;
}

/**
 * Type for a class constructor that takes dependencies
 */
export type InjectableConstructor<T, D> = new (deps: D) => T;

/**
 * Type for a factory function that creates a service
 */
export type ServiceFactory<T, D = PartialDependencies> = (deps: D) => T;
