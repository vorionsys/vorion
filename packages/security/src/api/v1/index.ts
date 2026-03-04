/**
 * API v1 Routes
 *
 * This module exports the v1 API route registration function.
 * All v1 routes are registered under the /api/v1 prefix.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '../../common/logger.js';
import { registerIntentRoutesV1 } from './intents.js';
import { registerEscalationRoutesV1 } from './escalations.js';
import { registerAuditRoutesV1 } from './audit.js';
import { registerPolicyRoutesV1 } from './policies.js';
import { registerWebhookRoutesV1 } from './webhooks.js';
import { registerGdprRoutesV1 } from './gdpr.js';
import { registerAdminRoutesV1 } from './admin.js';
import { registerAuthRoutesV1 } from './auth.js';
import { registerProofRoutesV1 } from './proofs.js';
import { registerTrustRoutesV1 } from './trust.js';
import { registerConstraintRoutesV1 } from './constraints.js';
import { registerDocsRoutesV1 } from './docs.js';
import { registerHealthRoutesV1 } from './health.js';
import { registerSessionRoutes } from './sessions.js';
import { registerSecurityDashboardRoutes } from './security-dashboard.js';
import { registerDashboardRoutesV1 } from './dashboard.js';
import { registerExtensionRoutes } from '../routes/extensions.js';
import { registerMfaRoutesV1 } from '../routes/mfa.js';
import { registerServiceAccountsRoutesV1 } from './service-accounts.js';
import { registerComplianceRoutesV1 } from './compliance.js';
import { registerOperationRoutesV1 } from './operations.js';

const v1Logger = createLogger({ component: 'api-v1' });

/**
 * V1 API Routes Plugin Options
 */
export interface V1RoutesOptions {
  /** Whether to include deprecated routes for backward compatibility */
  includeDeprecatedRoutes?: boolean;
}

/**
 * Register all v1 API routes
 *
 * This function registers all route handlers for API v1.
 * Routes are organized by domain/resource.
 */
const v1RoutesPluginAsync: FastifyPluginAsync<V1RoutesOptions> = async (
  fastify: FastifyInstance,
  _opts: V1RoutesOptions
) => {
  v1Logger.info('Registering API v1 routes');

  // Register route groups
  await registerAuthRoutesV1(fastify);
  await registerIntentRoutesV1(fastify);
  await registerEscalationRoutesV1(fastify);
  await registerAuditRoutesV1(fastify);
  await registerPolicyRoutesV1(fastify);
  await registerWebhookRoutesV1(fastify);
  await registerGdprRoutesV1(fastify);
  await registerAdminRoutesV1(fastify);
  await registerProofRoutesV1(fastify);
  await registerTrustRoutesV1(fastify);
  await registerConstraintRoutesV1(fastify);
  await registerDocsRoutesV1(fastify);
  await registerHealthRoutesV1(fastify);

  // Register CAR ID extension routes
  await registerExtensionRoutes(fastify);

  // Register MFA routes
  await registerMfaRoutesV1(fastify);

  // Register Session routes
  await registerSessionRoutes(fastify);

  // Register Security Dashboard routes
  await registerSecurityDashboardRoutes(fastify);

  // Register Admin Dashboard routes (observability UI)
  await registerDashboardRoutesV1(fastify);

  // Register Service Accounts routes (service-to-service auth)
  await registerServiceAccountsRoutesV1(fastify);

  // Register Compliance routes (retention policies, litigation holds)
  await registerComplianceRoutesV1(fastify);

  // Register Operation tracking routes (async operation status)
  await registerOperationRoutesV1(fastify);

  v1Logger.info('API v1 routes registered successfully');
};

/**
 * V1 API Routes Plugin
 */
export const v1RoutesPlugin = fp(v1RoutesPluginAsync, {
  name: 'api-v1-routes',
  fastify: '>=4.x',
});

export default v1RoutesPlugin;
