/**
 * Persistence Module
 *
 * Provides a tiered persistence architecture:
 * - Fast data layer (A3I Cache / Redis)
 * - Primary data layer (PostgreSQL / Drizzle)
 * - Audit layer (Immutable hash chain)
 *
 * @packageDocumentation
 */

// Repository Pattern
export {
  type QueryOptions,
  type PaginatedResult,
  type EntityMeta,
  type TenantScoped,
  BaseRepository,
  type CacheAdapter,
  type CacheOptions,
  CachedRepository,
  type UnitOfWork,
  createUnitOfWork,
  type Specification,
  BaseSpecification,
} from './repository.js';

// Audit Chain
export {
  type AuditEntityType,
  type AuditAction,
  type AuditRecord,
  type AuditQuery,
  type ChainVerificationResult,
  type AuditStats,
  type AuditStorage,
  type AuditChainConfig,
  AuditChainService,
  InMemoryAuditStorage,
  createAuditChainService,
  getAuditChainService,
} from './audit.js';
