/**
 * Tenant Context - Secure Tenant ID Handling
 *
 * Provides branded types and secure context creation to prevent
 * tenant ID injection attacks. Tenant IDs can ONLY be extracted
 * from validated JWT tokens, never from request parameters or body.
 *
 * HIGH SECURITY: Prevents cross-tenant data access vulnerability.
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from './logger.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';
import type { ID } from './types.js';

const logger = createLogger({ component: 'tenant-context' });

// =============================================================================
// BRANDED TYPES - Compiler-enforced security
// =============================================================================

/**
 * Unique symbol for branding ValidatedTenantId
 * This ensures the type cannot be forged at compile time
 */
declare const TenantIdBrand: unique symbol;

/**
 * A tenant ID that has been validated from a JWT token.
 *
 * This branded type can ONLY be created through:
 * - `createTenantContext()` from a validated JWT
 * - `extractTenantContext()` middleware
 *
 * Raw strings cannot be assigned to this type, preventing
 * accidental use of unvalidated tenant IDs.
 *
 * @example
 * // This will NOT compile:
 * const badId: ValidatedTenantId = "some-tenant-id";
 *
 * // This is the only valid way:
 * const ctx = await extractTenantContext(request);
 * const validId: ValidatedTenantId = ctx.tenantId;
 */
export type ValidatedTenantId = string & { readonly [TenantIdBrand]: true };

/**
 * Unique symbol for branding ValidatedUserId
 */
declare const UserIdBrand: unique symbol;

/**
 * A user ID that has been validated from a JWT token.
 */
export type ValidatedUserId = string & { readonly [UserIdBrand]: true };

/**
 * Validated JWT payload structure
 */
export interface ValidatedJwtPayload {
  /** Subject (user ID) - validated from JWT */
  sub: string;
  /** Tenant ID - validated from JWT */
  tid: string;
  /** User roles from JWT */
  roles?: string[];
  /** User permissions from JWT */
  permissions?: string[];
  /** Token issued at timestamp */
  iat: number;
  /** Token expiration timestamp */
  exp: number;
}

/**
 * Zod schema for validating JWT payload for tenant context
 */
export const validatedJwtPayloadSchema = z.object({
  sub: z.string().min(1, 'Subject (sub) claim is required'),
  tid: z.string().min(1, 'Tenant ID (tid) claim is required'),
  iat: z.number().int().positive('Issued at (iat) must be a positive integer'),
  exp: z.number().int().positive('Expiration (exp) must be a positive integer'),
  roles: z.array(z.string()).optional().default([]),
  permissions: z.array(z.string()).optional().default([]),
});

// =============================================================================
// TENANT CONTEXT - Immutable security context
// =============================================================================

/**
 * Immutable tenant context created from validated JWT.
 *
 * This is the ONLY way to safely pass tenant information to services.
 * All service methods should accept TenantContext instead of raw tenantId.
 *
 * Properties are readonly to prevent mutation after creation.
 *
 * @example
 * // Service method signature (SECURE)
 * async createPolicy(ctx: TenantContext, input: CreatePolicyInput): Promise<Policy>
 *
 * // NOT this (VULNERABLE)
 * async createPolicy(tenantId: string, input: CreatePolicyInput): Promise<Policy>
 */
export interface TenantContext {
  /** Validated tenant ID - can only come from JWT */
  readonly tenantId: ValidatedTenantId;
  /** Validated user ID - can only come from JWT */
  readonly userId: ValidatedUserId;
  /** User roles from JWT token */
  readonly roles: readonly string[];
  /** User permissions from JWT token */
  readonly permissions: readonly string[];
  /** Request trace ID for correlation */
  readonly traceId?: string;
  /** Session ID if available */
  readonly sessionId?: string;
  /** Timestamp when context was created */
  readonly createdAt: number;
}

/**
 * Internal function to brand a string as ValidatedTenantId.
 * This should ONLY be called after JWT validation.
 *
 * @internal
 */
function brandTenantId(id: string): ValidatedTenantId {
  return id as ValidatedTenantId;
}

/**
 * Internal function to brand a string as ValidatedUserId.
 * This should ONLY be called after JWT validation.
 *
 * @internal
 */
function brandUserId(id: string): ValidatedUserId {
  return id as ValidatedUserId;
}

/**
 * Create a TenantContext from a validated JWT payload.
 *
 * This is the ONLY legitimate way to create a TenantContext.
 * The JWT must already be validated (signature verified, not expired).
 *
 * @param jwt - Validated JWT payload (must have passed signature verification)
 * @param options - Additional context options
 * @returns Immutable TenantContext
 *
 * @example
 * // After JWT verification in middleware:
 * const ctx = createTenantContext(validatedJwt, { traceId: request.id });
 * request.tenantContext = ctx;
 */
export function createTenantContext(
  jwt: ValidatedJwtPayload,
  options?: {
    traceId?: string;
    sessionId?: string;
  }
): TenantContext {
  // Validate the JWT payload structure
  const validated = validatedJwtPayloadSchema.parse(jwt);

  // Create immutable context with branded IDs
  const context: TenantContext = Object.freeze({
    tenantId: brandTenantId(validated.tid),
    userId: brandUserId(validated.sub),
    roles: Object.freeze([...(validated.roles ?? [])]),
    permissions: Object.freeze([...(validated.permissions ?? [])]),
    traceId: options?.traceId,
    sessionId: options?.sessionId,
    createdAt: Date.now(),
  });

  logger.debug(
    {
      tenantId: validated.tid,
      userId: validated.sub,
      roles: validated.roles,
      traceId: options?.traceId,
    },
    'TenantContext created from validated JWT'
  );

  return context;
}

// =============================================================================
// REQUEST AUGMENTATION
// =============================================================================

/**
 * Extend FastifyRequest with tenant context
 */
declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Validated tenant context from JWT.
     * Only available after `requireTenantContext` middleware.
     */
    tenantContext?: TenantContext;
  }
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Extract and validate tenant context from JWT token.
 *
 * This middleware:
 * 1. Extracts the Bearer token from Authorization header
 * 2. Verifies the JWT signature
 * 3. Validates required claims (sub, tid)
 * 4. Creates an immutable TenantContext
 * 5. Attaches it to request.tenantContext
 *
 * SECURITY: Tenant ID is extracted ONLY from the JWT, never from
 * request body, query params, or other user-controlled input.
 *
 * @example
 * // Register as route preHandler
 * fastify.post('/api/v1/policies', {
 *   preHandler: [requireTenantContext],
 * }, async (request, reply) => {
 *   const ctx = request.tenantContext!;
 *   const policy = await policyService.create(ctx, input);
 * });
 */
export async function requireTenantContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Use Fastify's JWT verification (signature + expiration)
    const jwt = await request.jwtVerify<ValidatedJwtPayload>();

    // Validate required claims
    const validation = validatedJwtPayloadSchema.safeParse(jwt);
    if (!validation.success) {
      logger.warn(
        {
          errors: validation.error.errors,
          requestId: request.id,
        },
        'SECURITY: JWT missing required tenant claims'
      );

      reply.status(401).send({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token missing required tenant claims',
        },
      });
      return;
    }

    // Create immutable tenant context
    request.tenantContext = createTenantContext(validation.data as ValidatedJwtPayload, {
      traceId: request.id,
    });

    logger.debug(
      {
        tenantId: request.tenantContext.tenantId,
        userId: request.tenantContext.userId,
        requestId: request.id,
      },
      'Tenant context extracted from JWT'
    );
  } catch (error) {
    // Handle JWT verification errors
    logger.warn(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: request.id,
      },
      'SECURITY: JWT verification failed'
    );

    reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      },
    });
  }
}

/**
 * Get the tenant context from a request, throwing if not available.
 *
 * Use this in route handlers after `requireTenantContext` middleware.
 *
 * @param request - Fastify request
 * @returns TenantContext
 * @throws UnauthorizedError if context is not set
 *
 * @example
 * fastify.get('/policies', {
 *   preHandler: [requireTenantContext],
 * }, async (request) => {
 *   const ctx = getTenantContext(request);
 *   return policyService.list(ctx);
 * });
 */
export function getTenantContext(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) {
    throw new UnauthorizedError('Tenant context not available - ensure requireTenantContext middleware is used');
  }
  return request.tenantContext;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if user has any of the specified roles
 */
export function hasRole(ctx: TenantContext, ...roles: string[]): boolean {
  return roles.some((role) => ctx.roles.includes(role));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasPermission(ctx: TenantContext, ...permissions: string[]): boolean {
  return permissions.every((perm) => ctx.permissions.includes(perm));
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(ctx: TenantContext, ...permissions: string[]): boolean {
  return permissions.some((perm) => ctx.permissions.includes(perm));
}

/**
 * Check if user is an admin (has admin or super_admin role)
 */
export function isAdmin(ctx: TenantContext): boolean {
  return hasRole(ctx, 'admin', 'super_admin', 'tenant:admin');
}

/**
 * Check if user is a super admin (cross-tenant access)
 */
export function isSuperAdmin(ctx: TenantContext): boolean {
  return hasRole(ctx, 'super_admin');
}

/**
 * Create a tenant context for system operations (internal use only).
 *
 * WARNING: This bypasses JWT validation and should ONLY be used for:
 * - Background jobs
 * - Internal service-to-service calls
 * - Scheduled tasks
 *
 * NEVER use this for handling user requests.
 *
 * @internal
 */
export function createSystemTenantContext(
  tenantId: string,
  options?: {
    userId?: string;
    roles?: string[];
    traceId?: string;
  }
): TenantContext {
  logger.info(
    {
      tenantId,
      userId: options?.userId ?? 'system',
      traceId: options?.traceId,
      caller: new Error().stack?.split('\n')[2]?.trim(),
    },
    'AUDIT: System tenant context created (bypassing JWT)'
  );

  return Object.freeze({
    tenantId: brandTenantId(tenantId),
    userId: brandUserId(options?.userId ?? 'system'),
    roles: Object.freeze(options?.roles ?? ['system']),
    permissions: Object.freeze(['*']),
    traceId: options?.traceId,
    createdAt: Date.now(),
  });
}

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

/**
 * Extract raw tenant ID from context for legacy code migration.
 *
 * @deprecated Use TenantContext directly in service methods.
 *             This function exists only for incremental migration.
 *
 * @param ctx - TenantContext
 * @returns Raw tenant ID string
 */
export function extractTenantId(ctx: TenantContext): ID {
  return ctx.tenantId as string;
}

/**
 * Extract raw user ID from context for legacy code migration.
 *
 * @deprecated Use TenantContext directly in service methods.
 *
 * @param ctx - TenantContext
 * @returns Raw user ID string
 */
export function extractUserId(ctx: TenantContext): ID {
  return ctx.userId as string;
}
