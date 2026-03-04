/**
 * Backward Compatibility Plugin
 *
 * Provides redirects and aliases from legacy unversioned routes
 * to the new versioned routes. This allows clients to migrate gradually.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { CURRENT_VERSION, getVersionedPrefix } from './index.js';

const compatLogger = createLogger({ component: 'api-backward-compat' });

/**
 * Backward compatibility options
 */
export interface BackwardCompatOptions {
  /** Whether to enable legacy route redirects (defaults to true) */
  enableRedirects?: boolean;
  /** Whether to log legacy route usage (defaults to true) */
  logLegacyUsage?: boolean;
  /** Redirect status code (defaults to 307 Temporary Redirect) */
  redirectStatusCode?: 301 | 302 | 307 | 308;
  /** Legacy base path to redirect from (defaults to /api) */
  legacyBasePath?: string;
}

/**
 * Legacy routes that should be redirected to versioned equivalents
 */
const LEGACY_ROUTES = [
  // Intent routes
  { method: 'POST', path: '/intents', target: '/intents' },
  { method: 'GET', path: '/intents', target: '/intents' },
  { method: 'GET', path: '/intents/:id', target: '/intents/:id' },
  { method: 'DELETE', path: '/intents/:id', target: '/intents/:id' },
  { method: 'POST', path: '/intents/:id/cancel', target: '/intents/:id/cancel' },
  { method: 'GET', path: '/intents/:id/verify', target: '/intents/:id/verify' },
  { method: 'POST', path: '/intents/:id/replay', target: '/intents/:id/replay' },
  { method: 'GET', path: '/intents/:id/escalation', target: '/intents/:id/escalation' },
  { method: 'POST', path: '/intents/bulk', target: '/intents/bulk' },

  // Escalation routes
  { method: 'GET', path: '/escalations', target: '/escalations' },
  { method: 'GET', path: '/escalations/:id', target: '/escalations/:id' },
  { method: 'POST', path: '/escalations/:id/acknowledge', target: '/escalations/:id/acknowledge' },
  { method: 'POST', path: '/escalations/:id/approve', target: '/escalations/:id/approve' },
  { method: 'POST', path: '/escalations/:id/reject', target: '/escalations/:id/reject' },
  { method: 'POST', path: '/escalations/:id/assign', target: '/escalations/:id/assign' },
  { method: 'DELETE', path: '/escalations/:id/assign/:userId', target: '/escalations/:id/assign/:userId' },
  { method: 'GET', path: '/escalations/:id/approvers', target: '/escalations/:id/approvers' },

  // Audit routes
  { method: 'GET', path: '/audit', target: '/audit' },
  { method: 'GET', path: '/audit/:id', target: '/audit/:id' },
  { method: 'GET', path: '/audit/target/:targetType/:targetId', target: '/audit/target/:targetType/:targetId' },
  { method: 'GET', path: '/audit/trace/:traceId', target: '/audit/trace/:traceId' },
  { method: 'GET', path: '/audit/stats', target: '/audit/stats' },
  { method: 'POST', path: '/audit/verify', target: '/audit/verify' },

  // Policy routes
  { method: 'POST', path: '/policies', target: '/policies' },
  { method: 'GET', path: '/policies', target: '/policies' },
  { method: 'GET', path: '/policies/:id', target: '/policies/:id' },
  { method: 'PUT', path: '/policies/:id', target: '/policies/:id' },
  { method: 'POST', path: '/policies/:id/publish', target: '/policies/:id/publish' },
  { method: 'POST', path: '/policies/:id/deprecate', target: '/policies/:id/deprecate' },
  { method: 'POST', path: '/policies/:id/archive', target: '/policies/:id/archive' },
  { method: 'DELETE', path: '/policies/:id', target: '/policies/:id' },

  // Webhook routes
  { method: 'POST', path: '/webhooks', target: '/webhooks' },
  { method: 'GET', path: '/webhooks', target: '/webhooks' },
  { method: 'DELETE', path: '/webhooks/:id', target: '/webhooks/:id' },
  { method: 'GET', path: '/webhooks/:id/deliveries', target: '/webhooks/:id/deliveries' },

  // GDPR routes
  { method: 'POST', path: '/intent/gdpr/export', target: '/intent/gdpr/export' },
  { method: 'GET', path: '/intent/gdpr/export/:requestId', target: '/intent/gdpr/export/:requestId' },
  { method: 'GET', path: '/intent/gdpr/export/:requestId/download', target: '/intent/gdpr/export/:requestId/download' },
  { method: 'DELETE', path: '/intent/gdpr/data', target: '/intent/gdpr/data' },

  // Admin routes
  { method: 'POST', path: '/admin/cleanup', target: '/admin/cleanup' },
  { method: 'POST', path: '/admin/dlq/:jobId/retry', target: '/admin/dlq/:jobId/retry' },
  { method: 'POST', path: '/admin/users/:userId/revoke-tokens', target: '/admin/users/:userId/revoke-tokens' },

  // Auth routes
  { method: 'POST', path: '/auth/logout', target: '/auth/logout' },

  // Proof routes
  { method: 'GET', path: '/proofs/:id', target: '/proofs/:id' },
  { method: 'POST', path: '/proofs/:id/verify', target: '/proofs/:id/verify' },

  // Trust routes
  { method: 'GET', path: '/trust/:entityId', target: '/trust/:entityId' },

  // Constraint routes
  { method: 'POST', path: '/constraints/validate', target: '/constraints/validate' },
] as const;

/**
 * Build redirect URL preserving path parameters and query string
 */
function buildRedirectUrl(
  request: FastifyRequest,
  legacyPath: string,
  targetPath: string,
  legacyBasePath: string
): string {
  const versionedPrefix = getVersionedPrefix(CURRENT_VERSION);

  // Extract the actual path after the base path
  const urlPath = request.url.split('?')[0];
  const queryString = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';

  // Replace the legacy base path with versioned prefix
  const newPath = urlPath.replace(legacyBasePath, versionedPrefix);

  return newPath + queryString;
}

/**
 * Backward Compatibility Plugin
 *
 * Registers redirect routes from legacy unversioned paths to versioned paths.
 * Adds deprecation warning headers to encourage migration.
 */
const backwardCompatPluginAsync: FastifyPluginAsync<BackwardCompatOptions> = async (
  fastify: FastifyInstance,
  opts: BackwardCompatOptions
) => {
  const {
    enableRedirects = true,
    logLegacyUsage = true,
    redirectStatusCode = 307,
    legacyBasePath = '/api',
  } = opts;

  if (!enableRedirects) {
    compatLogger.info('Backward compatibility redirects disabled');
    return;
  }

  const versionedPrefix = getVersionedPrefix(CURRENT_VERSION);

  // Create redirect handler factory
  const createRedirectHandler = (legacyPath: string, targetPath: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const redirectUrl = buildRedirectUrl(request, legacyPath, targetPath, legacyBasePath);

      if (logLegacyUsage) {
        compatLogger.warn(
          {
            legacyPath: request.url,
            redirectTo: redirectUrl,
            method: request.method,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          'Legacy unversioned API route used - redirecting to versioned route'
        );
      }

      // Add deprecation headers
      reply.header('Deprecation', 'true');
      reply.header('Sunset', '2025-12-31'); // Set appropriate sunset date
      reply.header('Link', `<${redirectUrl}>; rel="successor-version"`);
      reply.header(
        'Warning',
        `299 - "This endpoint is deprecated. Please use ${versionedPrefix} prefix for all API calls."`
      );

      return reply.redirect(redirectStatusCode, redirectUrl);
    };
  };

  // Register all legacy route redirects
  for (const route of LEGACY_ROUTES) {
    const legacyFullPath = `${legacyBasePath}${route.path}`;

    // Skip if route matches versioned pattern
    if (route.path.startsWith('/v')) {
      continue;
    }

    try {
      const handler = createRedirectHandler(route.path, route.target);

      switch (route.method) {
        case 'GET':
          fastify.get(legacyFullPath, handler);
          break;
        case 'POST':
          fastify.post(legacyFullPath, handler);
          break;
        case 'PUT':
          fastify.put(legacyFullPath, handler);
          break;
        case 'DELETE':
          fastify.delete(legacyFullPath, handler);
          break;
      }
    } catch (error) {
      // Route may already exist, log and continue
      compatLogger.debug(
        { path: legacyFullPath, method: route.method, error },
        'Could not register legacy redirect (route may already exist)'
      );
    }
  }

  compatLogger.info(
    { routeCount: LEGACY_ROUTES.length, redirectStatusCode },
    'Backward compatibility redirects registered'
  );
};

/**
 * Backward Compatibility Plugin (wrapped with fastify-plugin)
 */
export const backwardCompatPlugin = fp(backwardCompatPluginAsync, {
  name: 'api-backward-compat',
  fastify: '4.x',
});

export default backwardCompatPlugin;
