/**
 * Tenant Context Test Helpers
 *
 * Provides utilities for creating mock TenantContext instances in tests.
 * These helpers ensure tests have valid tenant context for security audit logging.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type {
  TenantContext,
  ValidatedTenantId,
  ValidatedUserId,
} from '../../src/common/tenant-context.js';

// =============================================================================
// TEST CONSTANTS
// =============================================================================

/** Default test tenant ID */
export const TEST_TENANT_ID = 'test-tenant-001';

/** Alternative test tenant ID for cross-tenant tests */
export const TEST_TENANT_ID_ALT = 'test-tenant-002';

/** Default test user ID */
export const TEST_USER_ID = 'test-user-001';

/** Alternative test user ID */
export const TEST_USER_ID_ALT = 'test-user-002';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for creating a mock TenantContext
 */
export interface MockTenantContextOptions {
  /** Tenant ID (defaults to TEST_TENANT_ID) */
  tenantId?: string;
  /** User ID (defaults to TEST_USER_ID) */
  userId?: string;
  /** User roles (defaults to ['user']) */
  roles?: string[];
  /** User permissions (defaults to []) */
  permissions?: string[];
  /** Request trace ID */
  traceId?: string;
  /** Session ID */
  sessionId?: string;
}

/**
 * Mock security request context for tests
 */
export interface MockSecurityRequestContext {
  tenantId: string;
  userId: string;
  requestId?: string;
  traceId?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

// =============================================================================
// MOCK TENANT CONTEXT FACTORY
// =============================================================================

/**
 * Create a mock TenantContext for testing.
 *
 * This function creates a valid TenantContext that can be used in tests
 * where tenant context is required, such as security audit logging.
 *
 * @param options - Optional configuration for the mock context
 * @returns A valid TenantContext instance
 *
 * @example
 * ```typescript
 * // Create with default values
 * const ctx = createMockTenantContext();
 *
 * // Create with custom tenant ID
 * const ctx = createMockTenantContext({ tenantId: 'my-tenant' });
 *
 * // Create with custom roles
 * const ctx = createMockTenantContext({
 *   tenantId: 'tenant-123',
 *   userId: 'user-456',
 *   roles: ['admin', 'policy_writer'],
 * });
 * ```
 */
export function createMockTenantContext(
  options: MockTenantContextOptions = {}
): TenantContext {
  const tenantId = options.tenantId ?? TEST_TENANT_ID;
  const userId = options.userId ?? TEST_USER_ID;
  const roles = options.roles ?? ['user'];
  const permissions = options.permissions ?? [];

  return Object.freeze({
    tenantId: tenantId as ValidatedTenantId,
    userId: userId as ValidatedUserId,
    roles: Object.freeze([...roles]),
    permissions: Object.freeze([...permissions]),
    traceId: options.traceId ?? `trace-${randomUUID()}`,
    sessionId: options.sessionId,
    createdAt: Date.now(),
  });
}

/**
 * Create a mock TenantContext for a specific tenant ID.
 *
 * Convenience function for creating context with just a tenant ID.
 *
 * @param tenantId - The tenant ID
 * @returns A valid TenantContext instance
 */
export function createMockTenantContextForTenant(tenantId: string): TenantContext {
  return createMockTenantContext({ tenantId });
}

/**
 * Create a mock admin TenantContext.
 *
 * Creates a context with admin role for testing admin-only operations.
 *
 * @param options - Optional configuration
 * @returns A TenantContext with admin role
 */
export function createMockAdminTenantContext(
  options: Omit<MockTenantContextOptions, 'roles'> = {}
): TenantContext {
  return createMockTenantContext({
    ...options,
    roles: ['admin', 'user'],
  });
}

/**
 * Create a mock system TenantContext for background jobs.
 *
 * Creates a context suitable for system operations that don't have
 * a user-initiated request.
 *
 * @param tenantId - The tenant ID for the system operation
 * @returns A TenantContext with system role
 */
export function createMockSystemTenantContext(tenantId: string): TenantContext {
  return createMockTenantContext({
    tenantId,
    userId: 'system',
    roles: ['system'],
    permissions: ['*'],
  });
}

// =============================================================================
// SECURITY REQUEST CONTEXT HELPERS
// =============================================================================

/**
 * Create a mock SecurityRequestContext for security audit logging.
 *
 * This can be used to set up the security logger's request context.
 *
 * @param options - Optional configuration
 * @returns A SecurityRequestContext suitable for audit logging
 */
export function createMockSecurityRequestContext(
  options: Partial<MockSecurityRequestContext> = {}
): MockSecurityRequestContext {
  return {
    tenantId: options.tenantId ?? TEST_TENANT_ID,
    userId: options.userId ?? TEST_USER_ID,
    requestId: options.requestId ?? `req-${randomUUID()}`,
    traceId: options.traceId ?? `trace-${randomUUID()}`,
    ip: options.ip ?? '127.0.0.1',
    userAgent: options.userAgent ?? 'TestAgent/1.0',
    sessionId: options.sessionId,
  };
}

// =============================================================================
// TEST WRAPPER UTILITIES
// =============================================================================

/**
 * Wrapper for tests that need tenant context.
 *
 * Executes a test function with a valid tenant context available.
 * Can be used with async/await for async test functions.
 *
 * @param fn - Test function to execute
 * @param options - Optional tenant context configuration
 * @returns The result of the test function
 *
 * @example
 * ```typescript
 * it('should do something with tenant context', async () => {
 *   await withTenantContext(async (ctx) => {
 *     // ctx is a valid TenantContext
 *     const result = await someService.doSomething(ctx);
 *     expect(result).toBeDefined();
 *   });
 * });
 *
 * // With custom options
 * it('should work for admin', async () => {
 *   await withTenantContext(
 *     async (ctx) => {
 *       expect(ctx.roles).toContain('admin');
 *     },
 *     { roles: ['admin'] }
 *   );
 * });
 * ```
 */
export async function withTenantContext<T>(
  fn: (ctx: TenantContext) => T | Promise<T>,
  options?: MockTenantContextOptions
): Promise<T> {
  const ctx = createMockTenantContext(options);
  return fn(ctx);
}

/**
 * Synchronous version of withTenantContext for non-async tests.
 *
 * @param fn - Synchronous test function to execute
 * @param options - Optional tenant context configuration
 * @returns The result of the test function
 */
export function withTenantContextSync<T>(
  fn: (ctx: TenantContext) => T,
  options?: MockTenantContextOptions
): T {
  const ctx = createMockTenantContext(options);
  return fn(ctx);
}

// =============================================================================
// MOCK USER HELPERS
// =============================================================================

/**
 * Create a mock user object that can be attached to FastifyRequest.
 *
 * This provides the user object structure expected by buildRequestActor
 * in the security middleware.
 *
 * @param options - Configuration options
 * @returns A user object suitable for request.user
 */
export function createMockUser(
  options: {
    tenantId?: string;
    userId?: string;
    did?: string;
    trustTier?: number;
  } = {}
): { sub: string; tenantId: string; did?: string; trustTier?: number } {
  return {
    sub: options.userId ?? TEST_USER_ID,
    tenantId: options.tenantId ?? TEST_TENANT_ID,
    did: options.did,
    trustTier: options.trustTier ?? 1,
  };
}

/**
 * Create mock request headers with tenant context.
 *
 * @param options - Configuration options
 * @returns Headers object with session and other context
 */
export function createMockHeaders(
  options: {
    sessionId?: string;
    userAgent?: string;
    authorization?: string;
  } = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': options.userAgent ?? 'TestAgent/1.0',
  };

  if (options.sessionId) {
    headers['x-session-id'] = options.sessionId;
  }

  if (options.authorization) {
    headers['authorization'] = options.authorization;
  }

  return headers;
}

// =============================================================================
// MEMBERSHIP CHECK HELPERS
// =============================================================================

/**
 * Create a mock implementation of requireTenantMembership.
 *
 * Returns a mock function that passes membership checks for configured tenants.
 *
 * @param allowedTenantIds - Tenant IDs that should pass membership check
 * @returns A mock function for vi.fn()
 */
export function createMockMembershipCheck(
  allowedTenantIds: string[] = [TEST_TENANT_ID]
): (userId: string, tenantId: string) => Promise<void> {
  return async (userId: string, tenantId: string): Promise<void> => {
    if (!allowedTenantIds.includes(tenantId)) {
      const { ForbiddenError } = await import('../../src/common/errors.js');
      throw new ForbiddenError('Access denied: user is not a member of this tenant', {
        userId,
        tenantId,
      });
    }
  };
}

/**
 * Create a mock implementation of verifyTenantMembership.
 *
 * Returns membership verification result based on configured tenants.
 *
 * @param memberTenantIds - Tenant IDs where user is a member
 * @param defaultRole - Default role to return for members
 * @returns A mock function for vi.fn()
 */
export function createMockMembershipVerification(
  memberTenantIds: string[] = [TEST_TENANT_ID],
  defaultRole: string = 'member'
): (userId: string, tenantId: string) => Promise<{ isMember: boolean; role?: string; cached: boolean }> {
  return async (_userId: string, tenantId: string) => {
    const isMember = memberTenantIds.includes(tenantId);
    return {
      isMember,
      role: isMember ? defaultRole : undefined,
      cached: false,
    };
  };
}
