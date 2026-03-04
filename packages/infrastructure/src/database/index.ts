/**
 * Database Infrastructure Module
 *
 * Provides PostgreSQL high availability infrastructure including:
 * - Streaming replication configuration
 * - Patroni cluster management
 * - pg_auto_failover setup
 * - Replication lag monitoring
 * - Health check endpoints
 *
 * @packageDocumentation
 */

export * from './replication.js';
