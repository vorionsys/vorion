/**
 * WebAuthn Middleware for Fastify
 *
 * Provides Fastify middleware and routes for WebAuthn authentication:
 * - Registration flow routes
 * - Authentication flow routes
 * - Credential management routes
 * - Session/JWT integration for user context
 *
 * @packageDocumentation
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import {
  type WebAuthnConfig,
  type WebAuthnCredential,
  type GenerateRegistrationOptionsInput,
  type VerifyRegistrationInput,
  type GenerateAuthenticationOptionsInput,
  type VerifyAuthenticationInput,
  RegistrationErrorCode,
  AuthenticationErrorCode,
  DEFAULT_WEBAUTHN_CONFIG,
} from './types.js';
import {
  WebAuthnService,
  WebAuthnError,
  WebAuthnRegistrationError,
  WebAuthnAuthenticationError,
  getWebAuthnService,
  createWebAuthnService,
} from './service.js';

const logger = createLogger({ component: 'webauthn-middleware' });

// =============================================================================
// METRICS
// =============================================================================

const webauthnRegistrations = new Counter({
  name: 'vorion_webauthn_registrations_total',
  help: 'Total WebAuthn registration attempts',
  labelNames: ['result'] as const,
  registers: [vorionRegistry],
});

const webauthnAuthentications = new Counter({
  name: 'vorion_webauthn_authentications_total',
  help: 'Total WebAuthn authentication attempts',
  labelNames: ['result'] as const,
  registers: [vorionRegistry],
});

const webauthnOperationDuration = new Histogram({
  name: 'vorion_webauthn_operation_duration_seconds',
  help: 'Duration of WebAuthn operations',
  labelNames: ['operation'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [vorionRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * User context from session/JWT
 */
export interface WebAuthnUserContext {
  /** User ID */
  userId: string;
  /** User email/username */
  userName?: string;
  /** User display name */
  displayName?: string;
  /** Tenant ID (optional) */
  tenantId?: string;
}

/**
 * Middleware options
 */
export interface WebAuthnMiddlewareOptions {
  /** WebAuthn service instance */
  service?: WebAuthnService;
  /** WebAuthn configuration */
  config?: Partial<WebAuthnConfig>;
  /** Route prefix (default: /webauthn) */
  prefix?: string;
  /** Function to get user context from request */
  getUserContext?: (request: FastifyRequest) => WebAuthnUserContext | null | Promise<WebAuthnUserContext | null>;
  /** Function to create session/token after authentication */
  createSession?: (userId: string, credential: WebAuthnCredential, request: FastifyRequest, reply: FastifyReply) => Promise<{ token?: string; sessionId?: string }>;
}

/**
 * Plugin options
 */
export interface WebAuthnPluginOptions extends WebAuthnMiddlewareOptions {
  /** Register routes */
  registerRoutes?: boolean;
}

// =============================================================================
// REQUEST DECORATION
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    /** WebAuthn user context */
    webauthnUser?: WebAuthnUserContext;
  }

  interface FastifyInstance {
    /** WebAuthn service */
    webauthnService?: WebAuthnService;
  }
}

// =============================================================================
// REQUEST/RESPONSE SCHEMAS
// =============================================================================

const registrationOptionsRequestSchema = {
  type: 'object',
  properties: {
    authenticatorType: { type: 'string', enum: ['platform', 'cross-platform'] },
    requireUserVerification: { type: 'boolean' },
  },
};

const registrationVerifyRequestSchema = {
  type: 'object',
  required: ['response'],
  properties: {
    response: { type: 'object' },
    credentialName: { type: 'string', minLength: 1, maxLength: 255 },
  },
};

const authenticationOptionsRequestSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    requireUserVerification: { type: 'boolean' },
  },
};

const authenticationVerifyRequestSchema = {
  type: 'object',
  required: ['userId', 'response'],
  properties: {
    userId: { type: 'string' },
    response: { type: 'object' },
  },
};

const credentialRenameRequestSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
  },
};

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Create user context extraction middleware
 */
export function createUserContextMiddleware(
  getUserContext: (request: FastifyRequest) => WebAuthnUserContext | null | Promise<WebAuthnUserContext | null>
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const context = await getUserContext(request);
      if (context) {
        request.webauthnUser = context;
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          requestId: request.id,
          url: request.url,
          operation: 'getUserContext',
        },
        'Failed to get WebAuthn user context'
      );
    }
  };
}

/**
 * Require authenticated user middleware
 */
export function requireWebAuthnUser(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.webauthnUser) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }
  };
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * Create registration options handler
 */
function createRegistrationOptionsHandler(service: WebAuthnService) {
  return async (
    request: FastifyRequest<{ Body: Partial<GenerateRegistrationOptionsInput> }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();

    try {
      const user = request.webauthnUser;
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to register a passkey',
          },
        });
      }

      const options = await service.generateRegistrationOptions({
        userId: user.userId,
        userName: user.userName ?? user.userId,
        userDisplayName: user.displayName,
        authenticatorType: request.body?.authenticatorType,
        requireUserVerification: request.body?.requireUserVerification,
      });

      const duration = (Date.now() - startTime) / 1000;
      webauthnOperationDuration.observe({ operation: 'registration_options' }, duration);

      return reply.send({
        options: options.options,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate registration options');
      webauthnRegistrations.inc({ result: 'error' });

      if (error instanceof WebAuthnError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate registration options',
        },
      });
    }
  };
}

/**
 * Create registration verify handler
 */
function createRegistrationVerifyHandler(service: WebAuthnService) {
  return async (
    request: FastifyRequest<{ Body: { response: unknown; credentialName?: string } }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();

    try {
      const user = request.webauthnUser;
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to register a passkey',
          },
        });
      }

      const result = await service.verifyRegistration({
        userId: user.userId,
        response: request.body.response as any,
        credentialName: request.body.credentialName,
      });

      const duration = (Date.now() - startTime) / 1000;
      webauthnOperationDuration.observe({ operation: 'registration_verify' }, duration);

      if (!result.verified) {
        webauthnRegistrations.inc({ result: result.errorCode ?? 'failed' });
        return reply.status(400).send({
          error: {
            code: result.errorCode ?? 'REGISTRATION_FAILED',
            message: result.error ?? 'Registration failed',
          },
        });
      }

      webauthnRegistrations.inc({ result: 'success' });

      return reply.send({
        verified: true,
        credential: {
          id: result.credential!.id,
          name: result.credential!.name,
          createdAt: result.credential!.createdAt,
          deviceType: result.credential!.deviceType,
          backedUp: result.credential!.backedUp,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to verify registration');
      webauthnRegistrations.inc({ result: 'error' });

      if (error instanceof WebAuthnError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to verify registration',
        },
      });
    }
  };
}

/**
 * Create authentication options handler
 */
function createAuthenticationOptionsHandler(service: WebAuthnService) {
  return async (
    request: FastifyRequest<{ Body?: Partial<GenerateAuthenticationOptionsInput> }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();

    try {
      const options = await service.generateAuthenticationOptions({
        userId: request.body?.userId,
        requireUserVerification: request.body?.requireUserVerification,
      });

      const duration = (Date.now() - startTime) / 1000;
      webauthnOperationDuration.observe({ operation: 'authentication_options' }, duration);

      return reply.send({
        options: options.options,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate authentication options');
      webauthnAuthentications.inc({ result: 'error' });

      if (error instanceof WebAuthnAuthenticationError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      if (error instanceof WebAuthnError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate authentication options',
        },
      });
    }
  };
}

/**
 * Create authentication verify handler
 */
function createAuthenticationVerifyHandler(
  service: WebAuthnService,
  createSession?: WebAuthnMiddlewareOptions['createSession']
) {
  return async (
    request: FastifyRequest<{ Body: { userId: string; response: unknown } }>,
    reply: FastifyReply
  ) => {
    const startTime = Date.now();

    try {
      const result = await service.verifyAuthentication({
        userId: request.body.userId,
        response: request.body.response as any,
      });

      const duration = (Date.now() - startTime) / 1000;
      webauthnOperationDuration.observe({ operation: 'authentication_verify' }, duration);

      if (!result.verified) {
        webauthnAuthentications.inc({ result: result.errorCode ?? 'failed' });
        return reply.status(401).send({
          error: {
            code: result.errorCode ?? 'AUTHENTICATION_FAILED',
            message: result.error ?? 'Authentication failed',
          },
        });
      }

      webauthnAuthentications.inc({ result: 'success' });

      // Create session/token if handler provided
      let sessionInfo: { token?: string; sessionId?: string } = {};
      if (createSession && result.userId && result.credential) {
        sessionInfo = await createSession(result.userId, result.credential, request, reply);
      }

      return reply.send({
        verified: true,
        userId: result.userId,
        credential: {
          id: result.credential!.id,
          name: result.credential!.name,
          lastUsedAt: result.credential!.lastUsedAt,
        },
        ...sessionInfo,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to verify authentication');
      webauthnAuthentications.inc({ result: 'error' });

      if (error instanceof WebAuthnError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to verify authentication',
        },
      });
    }
  };
}

/**
 * Create list credentials handler
 */
function createListCredentialsHandler(service: WebAuthnService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.webauthnUser;
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const { credentials, total } = await service.listCredentials({
        userId: user.userId,
      });

      return reply.send({
        credentials: credentials.map((cred) => ({
          id: cred.id,
          name: cred.name,
          createdAt: cred.createdAt,
          lastUsedAt: cred.lastUsedAt,
          deviceType: cred.deviceType,
          backedUp: cred.backedUp,
        })),
        total,
      });
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          userId: request.webauthnUser?.userId,
          operation: 'listCredentials',
        },
        'Failed to list credentials'
      );

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to list credentials',
        },
      });
    }
  };
}

/**
 * Create rename credential handler
 */
function createRenameCredentialHandler(service: WebAuthnService) {
  return async (
    request: FastifyRequest<{ Params: { credentialId: string }; Body: { name: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const user = request.webauthnUser;
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const credential = await service.renameCredential({
        userId: user.userId,
        credentialId: request.params.credentialId,
        name: request.body.name,
      });

      return reply.send({
        credential: {
          id: credential.id,
          name: credential.name,
          createdAt: credential.createdAt,
          lastUsedAt: credential.lastUsedAt,
          deviceType: credential.deviceType,
          backedUp: credential.backedUp,
        },
      });
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorCode: (error as any)?.code,
          userId: request.webauthnUser?.userId,
          credentialId: request.params.credentialId,
          operation: 'renameCredential',
        },
        'Failed to rename credential'
      );

      if ((error as any)?.code === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Credential not found',
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to rename credential',
        },
      });
    }
  };
}

/**
 * Create delete credential handler
 */
function createDeleteCredentialHandler(service: WebAuthnService) {
  return async (
    request: FastifyRequest<{ Params: { credentialId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const user = request.webauthnUser;
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      await service.deleteCredential({
        userId: user.userId,
        credentialId: request.params.credentialId,
      });

      return reply.status(204).send();
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorCode: (error as any)?.code,
          userId: request.webauthnUser?.userId,
          credentialId: request.params.credentialId,
          operation: 'deleteCredential',
        },
        'Failed to delete credential'
      );

      if ((error as any)?.code === 'NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Credential not found',
          },
        });
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete credential',
        },
      });
    }
  };
}

// =============================================================================
// FASTIFY PLUGIN
// =============================================================================

/**
 * Fastify plugin for WebAuthn authentication
 *
 * @example
 * ```typescript
 * await fastify.register(webauthnPlugin, {
 *   config: {
 *     rpName: 'My App',
 *     rpId: 'myapp.com',
 *     origin: 'https://myapp.com',
 *   },
 *   getUserContext: async (request) => {
 *     // Extract user from JWT/session
 *     const token = request.headers.authorization?.replace('Bearer ', '');
 *     if (!token) return null;
 *     const user = await verifyToken(token);
 *     return { userId: user.id, userName: user.email };
 *   },
 *   createSession: async (userId, credential, request, reply) => {
 *     const token = await createJWT({ userId });
 *     return { token };
 *   },
 * });
 * ```
 */
export const webauthnPlugin = fp(
  async (fastify: FastifyInstance, options: WebAuthnPluginOptions) => {
    const service = options.service ?? createWebAuthnService({ config: options.config });
    const prefix = options.prefix ?? '/webauthn';

    // Decorate fastify with service
    fastify.decorate('webauthnService', service);

    // Add user context middleware if provided
    if (options.getUserContext) {
      fastify.addHook('preHandler', createUserContextMiddleware(options.getUserContext));
    }

    // Register routes if enabled (default: true)
    if (options.registerRoutes !== false) {
      // Registration routes
      fastify.post(
        `${prefix}/register/options`,
        {
          schema: {
            body: registrationOptionsRequestSchema,
            response: {
              200: { type: 'object' },
            },
          },
        },
        createRegistrationOptionsHandler(service)
      );

      fastify.post(
        `${prefix}/register/verify`,
        {
          schema: {
            body: registrationVerifyRequestSchema,
            response: {
              200: { type: 'object' },
            },
          },
        },
        createRegistrationVerifyHandler(service)
      );

      // Authentication routes
      fastify.post(
        `${prefix}/authenticate/options`,
        {
          schema: {
            body: authenticationOptionsRequestSchema,
            response: {
              200: { type: 'object' },
            },
          },
        },
        createAuthenticationOptionsHandler(service)
      );

      fastify.post(
        `${prefix}/authenticate/verify`,
        {
          schema: {
            body: authenticationVerifyRequestSchema,
            response: {
              200: { type: 'object' },
            },
          },
        },
        createAuthenticationVerifyHandler(service, options.createSession)
      );

      // Credential management routes
      fastify.get(
        `${prefix}/credentials`,
        {
          schema: {
            response: {
              200: { type: 'object' },
            },
          },
        },
        createListCredentialsHandler(service)
      );

      fastify.patch(
        `${prefix}/credentials/:credentialId`,
        {
          schema: {
            params: {
              type: 'object',
              properties: {
                credentialId: { type: 'string' },
              },
              required: ['credentialId'],
            },
            body: credentialRenameRequestSchema,
            response: {
              200: { type: 'object' },
            },
          },
        },
        createRenameCredentialHandler(service)
      );

      fastify.delete(
        `${prefix}/credentials/:credentialId`,
        {
          schema: {
            params: {
              type: 'object',
              properties: {
                credentialId: { type: 'string' },
              },
              required: ['credentialId'],
            },
          },
        },
        createDeleteCredentialHandler(service)
      );
    }

    logger.info(
      {
        prefix,
        routesRegistered: options.registerRoutes !== false,
        hasUserContext: !!options.getUserContext,
        hasCreateSession: !!options.createSession,
      },
      'WebAuthn plugin registered'
    );
  },
  {
    name: 'vorion-webauthn',
    fastify: '5.x',
  }
);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get WebAuthn user context from request
 */
export function getWebAuthnUser(request: FastifyRequest): WebAuthnUserContext | undefined {
  return request.webauthnUser;
}

/**
 * Check if request has WebAuthn user context
 */
export function hasWebAuthnUser(request: FastifyRequest): boolean {
  return request.webauthnUser !== undefined;
}

/**
 * Get user ID from WebAuthn context
 */
export function getWebAuthnUserId(request: FastifyRequest): string | undefined {
  return request.webauthnUser?.userId;
}
