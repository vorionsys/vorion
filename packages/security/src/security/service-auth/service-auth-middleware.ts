/**
 * Service Authentication Middleware
 *
 * Fastify preHandler middleware for service-to-service authentication.
 * Validates HMAC signatures in request headers and optionally issues JWT tokens.
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { createLogger } from '../../common/logger.js';
import { UnauthorizedError, ForbiddenError } from '../../common/errors.js';
import {
  ServiceAccountManager,
  getServiceAccountManager,
  ServiceAccountStatus,
  type ServiceAccount,
  ServiceAccountRevokedError,
  ServiceAccountSuspendedError,
} from './service-account.js';
import {
  ServiceTokenService,
  getServiceTokenService,
  SERVICE_AUTH_HEADERS,
  type ServiceTokenPayload,
} from './service-token.js';

const logger = createLogger({ component: 'service-auth-middleware' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Service authentication context added to request
 */
export interface ServiceAuthContext {
  /** The authenticated service account */
  serviceAccount: ServiceAccount;
  /** The client ID */
  clientId: string;
  /** The tenant ID */
  tenantId: string;
  /** Service name */
  serviceName: string;
  /** Permissions granted to the service */
  permissions: string[];
  /** Whether request was authenticated via signature or token */
  authMethod: 'signature' | 'token';
  /** The service token if one was issued/verified */
  token?: string;
  /** Token payload if authenticated via token */
  tokenPayload?: ServiceTokenPayload;
}

/**
 * Extended Fastify request with service auth context
 */
export interface ServiceAuthenticatedRequest extends FastifyRequest {
  serviceAuth?: ServiceAuthContext;
}

/**
 * Middleware configuration options
 */
export interface ServiceAuthMiddlewareOptions {
  /** Service account manager instance */
  accountManager?: ServiceAccountManager;
  /** Service token service instance */
  tokenService?: ServiceTokenService;
  /** Whether to allow token-based auth (in addition to signature) */
  allowTokenAuth?: boolean;
  /** Whether to issue a token after successful signature auth */
  issueToken?: boolean;
  /** Paths to skip authentication */
  skipPaths?: string[];
  /** Custom skip function */
  skipFn?: (request: FastifyRequest) => boolean;
  /** Whether to validate IP whitelist */
  validateIpWhitelist?: boolean;
  /** Required permissions (all must be present) */
  requiredPermissions?: string[];
  /** Required permissions (any one must be present) */
  anyPermissions?: string[];
  /** Custom error handler */
  onError?: (error: Error, request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Service authentication error
 */
export class ServiceAuthError extends UnauthorizedError {
  override code = 'SERVICE_AUTH_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ServiceAuthError';
  }
}

/**
 * Missing authentication headers error
 */
export class MissingAuthHeadersError extends ServiceAuthError {
  override code = 'MISSING_AUTH_HEADERS';

  constructor() {
    super('Missing required service authentication headers');
    this.name = 'MissingAuthHeadersError';
  }
}

/**
 * Invalid signature error
 */
export class InvalidServiceSignatureError extends ServiceAuthError {
  override code = 'INVALID_SERVICE_SIGNATURE';

  constructor(reason?: string) {
    super(reason ? `Invalid service signature: ${reason}` : 'Invalid service signature');
    this.name = 'InvalidServiceSignatureError';
  }
}

/**
 * IP not allowed error
 */
export class IpNotAllowedError extends ForbiddenError {
  override code = 'IP_NOT_ALLOWED';

  constructor(clientId: string, ip: string) {
    super(`IP address not allowed for service: ${ip}`, { clientId, ip });
    this.name = 'IpNotAllowedError';
  }
}

/**
 * Insufficient permissions error
 */
export class InsufficientPermissionsError extends ForbiddenError {
  override code = 'INSUFFICIENT_PERMISSIONS';

  constructor(required: string[], actual: string[]) {
    super('Insufficient permissions for this operation', { required, actual });
    this.name = 'InsufficientPermissionsError';
  }
}

// =============================================================================
// MIDDLEWARE FACTORY
// =============================================================================

/**
 * Create service authentication middleware
 */
export function createServiceAuthMiddleware(
  options: ServiceAuthMiddlewareOptions = {}
): preHandlerHookHandler {
  const {
    accountManager = getServiceAccountManager(),
    allowTokenAuth = true,
    issueToken = false,
    skipPaths = [],
    skipFn,
    validateIpWhitelist = true,
    requiredPermissions = [],
    anyPermissions = [],
    onError,
  } = options;

  // Lazy-load token service to allow deferred initialization
  const getTokenSvc = () => {
    if (options.tokenService) {
      return options.tokenService;
    }
    try {
      return getServiceTokenService();
    } catch {
      return null;
    }
  };

  return async function serviceAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Check if path should be skipped
    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    // Check custom skip function
    if (skipFn && skipFn(request)) {
      return;
    }

    const authRequest = request as ServiceAuthenticatedRequest;

    try {
      let authContext: ServiceAuthContext | null = null;

      // Try token-based authentication first (if enabled)
      if (allowTokenAuth) {
        const tokenService = getTokenSvc();
        if (tokenService) {
          authContext = await tryTokenAuth(request, tokenService, accountManager);
        }
      }

      // Fall back to signature-based authentication
      if (!authContext) {
        const tokenService = getTokenSvc();
        authContext = await trySignatureAuth(
          request,
          accountManager,
          tokenService,
          issueToken
        );
      }

      if (!authContext) {
        throw new MissingAuthHeadersError();
      }

      // Validate IP whitelist if enabled
      if (validateIpWhitelist && authContext.serviceAccount.ipWhitelist?.length) {
        const clientIp = request.ip;
        if (!authContext.serviceAccount.ipWhitelist.includes(clientIp)) {
          logger.warn(
            { clientId: authContext.clientId, ip: clientIp },
            'Service auth rejected: IP not in whitelist'
          );
          throw new IpNotAllowedError(authContext.clientId, clientIp);
        }
      }

      // Validate required permissions
      if (requiredPermissions.length > 0) {
        const hasAllRequired = requiredPermissions.every(
          (perm) =>
            authContext!.permissions.includes('*') ||
            authContext!.permissions.includes(perm) ||
            hasWildcardPermission(authContext!.permissions, perm)
        );

        if (!hasAllRequired) {
          throw new InsufficientPermissionsError(requiredPermissions, authContext.permissions);
        }
      }

      // Validate any permissions
      if (anyPermissions.length > 0) {
        const hasAny = anyPermissions.some(
          (perm) =>
            authContext!.permissions.includes('*') ||
            authContext!.permissions.includes(perm) ||
            hasWildcardPermission(authContext!.permissions, perm)
        );

        if (!hasAny) {
          throw new InsufficientPermissionsError(anyPermissions, authContext.permissions);
        }
      }

      // Attach auth context to request
      authRequest.serviceAuth = authContext;

      logger.debug(
        {
          clientId: authContext.clientId,
          tenantId: authContext.tenantId,
          authMethod: authContext.authMethod,
          path: request.url,
        },
        'Service authentication successful'
      );
    } catch (error) {
      if (onError) {
        await onError(error as Error, request, reply);
        return;
      }

      logger.warn(
        {
          error: (error as Error).message,
          path: request.url,
          ip: request.ip,
        },
        'Service authentication failed'
      );

      throw error;
    }
  };
}

/**
 * Try token-based authentication
 */
async function tryTokenAuth(
  request: FastifyRequest,
  tokenService: ServiceTokenService,
  accountManager: ServiceAccountManager
): Promise<ServiceAuthContext | null> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const result = await tokenService.verifyToken(token);

  if (!result.valid || !result.payload) {
    if (result.error) {
      logger.debug({ error: result.error }, 'Token verification failed');
    }
    return null;
  }

  // Verify the service account still exists and is active
  const account = await accountManager.findAccount(result.payload.sub);

  if (!account) {
    logger.warn({ clientId: result.payload.sub }, 'Service account not found for valid token');
    return null;
  }

  if (account.status === ServiceAccountStatus.REVOKED) {
    throw new ServiceAccountRevokedError(account.clientId);
  }

  if (account.status === ServiceAccountStatus.SUSPENDED) {
    throw new ServiceAccountSuspendedError(account.clientId);
  }

  return {
    serviceAccount: account,
    clientId: account.clientId,
    tenantId: account.tenantId,
    serviceName: account.name,
    permissions: account.permissions,
    authMethod: 'token',
    token,
    tokenPayload: result.payload,
  };
}

/**
 * Try signature-based authentication
 */
async function trySignatureAuth(
  request: FastifyRequest,
  accountManager: ServiceAccountManager,
  tokenService: ServiceTokenService | null,
  issueToken: boolean
): Promise<ServiceAuthContext | null> {
  const headers = request.headers as Record<string, string | string[] | undefined>;

  // Extract service auth headers
  const clientId = getHeaderValue(headers, SERVICE_AUTH_HEADERS.SERVICE_ID);
  const signature = getHeaderValue(headers, SERVICE_AUTH_HEADERS.SERVICE_SIGNATURE);
  const timestampStr = getHeaderValue(headers, SERVICE_AUTH_HEADERS.SERVICE_TIMESTAMP);

  // If no service headers, return null (might be token auth)
  if (!clientId && !signature && !timestampStr) {
    return null;
  }

  // If partial headers, that's an error
  if (!clientId || !signature || !timestampStr) {
    throw new MissingAuthHeadersError();
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    throw new InvalidServiceSignatureError('Invalid timestamp format');
  }

  // Get the service account
  const account = await accountManager.findAccount(clientId);

  if (!account) {
    // Use generic error to prevent enumeration
    throw new InvalidServiceSignatureError('Invalid credentials');
  }

  if (account.status === ServiceAccountStatus.REVOKED) {
    throw new ServiceAccountRevokedError(clientId);
  }

  if (account.status === ServiceAccountStatus.SUSPENDED) {
    throw new ServiceAccountSuspendedError(clientId);
  }

  // We need the plaintext secret to verify, but we only have the hash
  // The signature is created using the plaintext secret, so we need to
  // store a verification key or use a different approach
  //
  // For HMAC verification, the client sends:
  // - signature = HMAC(timestamp + method + path + body, clientSecret)
  //
  // We can't reverse the hash, so we need to:
  // 1. Store a separate verification key (not recommended - defeats purpose)
  // 2. Use the hashed secret as the HMAC key (both sides must agree)
  //
  // We'll use approach 2: both client and server use the same derivation
  // The client must hash their secret before using it for HMAC

  // Get request body as string
  let bodyStr = '';
  if (request.body) {
    if (typeof request.body === 'string') {
      bodyStr = request.body;
    } else if (Buffer.isBuffer(request.body)) {
      bodyStr = request.body.toString('utf8');
    } else {
      bodyStr = JSON.stringify(request.body);
    }
  }

  if (!tokenService) {
    throw new Error('Token service required for signature verification');
  }

  // Verify the signature using the hashed secret
  // Note: Client must also use hashed secret for HMAC
  const verifyResult = tokenService.verifySignature({
    clientSecret: account.clientSecret, // Using hashed secret as HMAC key
    providedSignature: signature,
    timestamp,
    method: request.method,
    path: request.url.split('?')[0], // Path without query string
    body: bodyStr,
  });

  if (!verifyResult.valid) {
    throw new InvalidServiceSignatureError(verifyResult.error);
  }

  // Update last used timestamp
  accountManager['store'].updateLastUsed(clientId).catch((err: Error) => {
    logger.error({ err, clientId }, 'Failed to update lastUsedAt');
  });

  // Optionally issue a token
  let token: string | undefined;
  if (issueToken && tokenService) {
    token = await tokenService.createToken({
      clientId: account.clientId,
      tenantId: account.tenantId,
      serviceName: account.name,
      permissions: account.permissions,
      ipAddress: request.ip,
    });
  }

  return {
    serviceAccount: account,
    clientId: account.clientId,
    tenantId: account.tenantId,
    serviceName: account.name,
    permissions: account.permissions,
    authMethod: 'signature',
    token,
  };
}

/**
 * Helper to get header value (handles arrays)
 */
function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * Check if permissions list contains a wildcard that matches the required permission
 */
function hasWildcardPermission(permissions: string[], required: string): boolean {
  for (const perm of permissions) {
    if (perm.endsWith(':*')) {
      const prefix = perm.slice(0, -1); // Remove '*'
      if (required.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

// =============================================================================
// HELPER MIDDLEWARE FACTORIES
// =============================================================================

/**
 * Create middleware that requires specific permissions
 */
export function requireServicePermissions(
  permissions: string[],
  options: { all?: boolean } = { all: true }
): preHandlerHookHandler {
  const baseOptions: ServiceAuthMiddlewareOptions = options.all
    ? { requiredPermissions: permissions }
    : { anyPermissions: permissions };

  return createServiceAuthMiddleware(baseOptions);
}

/**
 * Create middleware that requires any of the specified permissions
 */
export function requireAnyServicePermission(permissions: string[]): preHandlerHookHandler {
  return createServiceAuthMiddleware({ anyPermissions: permissions });
}

/**
 * Create middleware that validates service belongs to a specific tenant
 */
export function requireServiceTenant(tenantId: string): preHandlerHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authRequest = request as ServiceAuthenticatedRequest;

    if (!authRequest.serviceAuth) {
      throw new ServiceAuthError('Service authentication required');
    }

    if (authRequest.serviceAuth.tenantId !== tenantId) {
      throw new ForbiddenError('Service not authorized for this tenant', {
        serviceTenant: authRequest.serviceAuth.tenantId,
        requiredTenant: tenantId,
      });
    }
  };
}

// =============================================================================
// REQUEST HELPERS
// =============================================================================

/**
 * Get service auth context from request
 */
export function getServiceAuth(request: FastifyRequest): ServiceAuthContext | undefined {
  return (request as ServiceAuthenticatedRequest).serviceAuth;
}

/**
 * Require service auth context from request
 */
export function requireServiceAuth(request: FastifyRequest): ServiceAuthContext {
  const auth = getServiceAuth(request);
  if (!auth) {
    throw new ServiceAuthError('Service authentication required');
  }
  return auth;
}

/**
 * Check if request has service auth
 */
export function hasServiceAuth(request: FastifyRequest): boolean {
  return !!(request as ServiceAuthenticatedRequest).serviceAuth;
}

/**
 * Get service client ID from request
 */
export function getServiceClientId(request: FastifyRequest): string | undefined {
  return getServiceAuth(request)?.clientId;
}

/**
 * Get service tenant ID from request
 */
export function getServiceTenantId(request: FastifyRequest): string | undefined {
  return getServiceAuth(request)?.tenantId;
}

/**
 * Get service permissions from request
 */
export function getServicePermissions(request: FastifyRequest): string[] {
  return getServiceAuth(request)?.permissions ?? [];
}

/**
 * Check if service has a specific permission
 */
export function serviceHasPermission(request: FastifyRequest, permission: string): boolean {
  const permissions = getServicePermissions(request);

  if (permissions.includes('*')) {
    return true;
  }

  if (permissions.includes(permission)) {
    return true;
  }

  return hasWildcardPermission(permissions, permission);
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

/**
 * Service auth plugin options
 */
export interface ServiceAuthPluginOptions extends ServiceAuthMiddlewareOptions {
  /** Register as global preHandler */
  global?: boolean;
  /** Decorate request with helper methods */
  decorateRequest?: boolean;
}

/**
 * Service auth Fastify plugin
 */
const serviceAuthPluginAsync: FastifyPluginAsync<ServiceAuthPluginOptions> = async (
  fastify: FastifyInstance,
  options: ServiceAuthPluginOptions
) => {
  const { global = false, decorateRequest = true, ...middlewareOptions } = options;

  // Create middleware
  const middleware = createServiceAuthMiddleware(middlewareOptions);

  // Register globally if requested
  if (global) {
    fastify.addHook('preHandler', middleware);
  }

  // Decorate request with helpers
  if (decorateRequest) {
    fastify.decorateRequest('serviceAuth', null);
    fastify.decorateRequest('getServiceAuth', function (this: FastifyRequest) {
      return getServiceAuth(this);
    });
    fastify.decorateRequest('requireServiceAuth', function (this: FastifyRequest) {
      return requireServiceAuth(this);
    });
    fastify.decorateRequest('hasServiceAuth', function (this: FastifyRequest) {
      return hasServiceAuth(this);
    });
    fastify.decorateRequest('serviceHasPermission', function (
      this: FastifyRequest,
      permission: string
    ) {
      return serviceHasPermission(this, permission);
    });
  }

  // Decorate fastify with middleware factory
  fastify.decorate('serviceAuthMiddleware', createServiceAuthMiddleware);
  fastify.decorate('requireServicePermissions', requireServicePermissions);
  fastify.decorate('requireAnyServicePermission', requireAnyServicePermission);

  logger.info({ global }, 'Service auth plugin registered');
};

/**
 * Service auth Fastify plugin
 */
export const serviceAuthPlugin = fp(serviceAuthPluginAsync, {
  name: 'service-auth',
  fastify: '>=4.x',
});

// =============================================================================
// TYPE AUGMENTATION
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    serviceAuth?: ServiceAuthContext;
    getServiceAuth?: () => ServiceAuthContext | undefined;
    requireServiceAuth?: () => ServiceAuthContext;
    hasServiceAuth?: () => boolean;
    serviceHasPermission?: (permission: string) => boolean;
  }

  interface FastifyInstance {
    serviceAuthMiddleware?: typeof createServiceAuthMiddleware;
    requireServicePermissions?: typeof requireServicePermissions;
    requireAnyServicePermission?: typeof requireAnyServicePermission;
  }
}
