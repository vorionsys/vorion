/**
 * Database Client
 *
 * Drizzle ORM client configuration for Vorion platform.
 * Uses schemas from @vorion/contracts/db.
 *
 * Usage:
 *   import { db, getDb } from '@vorionsys/platform-core/db/client';
 *
 * @packageDocumentation
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "@vorionsys/contracts/db";

// Re-export schema for convenience
export { schema };

/**
 * Database client type with full schema
 */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Maximum number of connections in pool */
  maxConnections?: number;
  /** Idle timeout in milliseconds */
  idleTimeoutMs?: number;
  /** Connect timeout in milliseconds */
  connectionTimeoutMs?: number;
  /** Enable SSL */
  ssl?: boolean | PoolConfig["ssl"];
}

// Module-level singleton
let dbInstance: Database | null = null;
let pool: Pool | null = null;

/**
 * Initialize database connection
 */
export function initDb(config: DatabaseConfig): Database {
  if (dbInstance) {
    return dbInstance;
  }

  pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
    ssl: config.ssl,
  });

  dbInstance = drizzle(pool, { schema });

  return dbInstance;
}

/**
 * Get database client instance
 * @throws Error if database not initialized
 */
export function getDb(): Database {
  if (!dbInstance) {
    throw new Error(
      "Database not initialized. Call initDb() first or use createDb() for a new instance.",
    );
  }
  return dbInstance;
}

/**
 * Create a new database client instance (does not use singleton)
 */
export function createDb(config: DatabaseConfig): { db: Database; pool: Pool } {
  const newPool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
    ssl: config.ssl,
  });

  return {
    db: drizzle(newPool, { schema }),
    pool: newPool,
  };
}

/**
 * Close database connection
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}

/**
 * Get database connection from environment
 */
export function getDbFromEnv(): Database {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return initDb({
    connectionString,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
    maxConnections: process.env.DATABASE_POOL_SIZE
      ? parseInt(process.env.DATABASE_POOL_SIZE, 10)
      : undefined,
  });
}

/**
 * Get the underlying connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return pool;
}

// Default export for convenience
export const db = {
  init: initDb,
  get: getDb,
  create: createDb,
  close: closeDb,
  fromEnv: getDbFromEnv,
  getPool,
};

export default db;
