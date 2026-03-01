/**
 * Cognigate API Server
 *
 * REST gateway for Vorion agent governance.
 * Built with Fastify for high performance.
 *
 * @packageDocumentation
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import {
  SERVER_ERRORS,
  NOT_FOUND_ERRORS,
  createErrorResponse,
} from '@vorionsys/shared-constants';

// Context and middleware
import { initializeContext, shutdownContext } from './context.js';
import { authPlugin, apiKeyRoutes } from './middleware/auth.js';

// Import routes
import { agentRoutes } from './routes/agents.js';
import { intentRoutes } from './routes/intents.js';
import { trustRoutes } from './routes/trust.js';
import { proofRoutes } from './routes/proofs.js';
import { healthRoutes } from './routes/health.js';

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
  enableAuth: boolean;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  enableAuth: process.env.ENABLE_AUTH !== 'false',
};

/**
 * Create and configure the Fastify server
 */
export async function createServer(config: Partial<ServerConfig> = {}): Promise<{
  server: FastifyInstance;
  config: ServerConfig;
}> {
  const serverConfig = { ...DEFAULT_CONFIG, ...config };

  // Initialize runtime context
  initializeContext();

  const server = Fastify({
    logger: {
      level: serverConfig.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    },
  });

  // Security middleware
  await server.register(helmet, {
    contentSecurityPolicy: false, // Disable for API
  });

  await server.register(cors, {
    origin:
      serverConfig.logLevel === 'debug' || process.env.NODE_ENV !== 'production'
        ? true
        : process.env.COGNIGATE_ALLOWED_ORIGINS?.split(',')
            .map((s) => s.trim())
            .filter(Boolean) || false,
    credentials: true,
  });

  // OpenAPI documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Cognigate API',
        description: 'REST gateway for Vorion agent governance',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${serverConfig.port}` }],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'agents', description: 'Agent management' },
        { name: 'intents', description: 'Intent submission and processing' },
        { name: 'trust', description: 'Trust score management' },
        { name: 'proofs', description: 'Proof chain operations' },
      ],
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Global rate limiting (default: T4 standard tier)
  await server.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
  });

  // Authentication (optional based on config)
  if (serverConfig.enableAuth) {
    await server.register(authPlugin);
  }

  // Register routes
  await server.register(healthRoutes, { prefix: '/api/v1' });
  await server.register(agentRoutes, { prefix: '/api/v1/agents' });
  await server.register(intentRoutes, { prefix: '/api/v1/intents' });
  await server.register(trustRoutes, { prefix: '/api/v1/trust' });
  await server.register(proofRoutes, { prefix: '/api/v1/proofs' });

  // API key management routes
  if (serverConfig.enableAuth) {
    await server.register(apiKeyRoutes, { prefix: '/api/v1/auth' });
  }

  // Global 404 handler
  server.setNotFoundHandler((_request, reply) => {
    const errResp = createErrorResponse(NOT_FOUND_ERRORS.ENDPOINT_NOT_FOUND);
    return reply.status(errResp.status).send(errResp.error);
  });

  // Global error handler
  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    const errResp = createErrorResponse(SERVER_ERRORS.INTERNAL_ERROR);
    return reply.status(errResp.status).send(errResp.error);
  });

  // Graceful shutdown
  const shutdown = async () => {
    server.log.info('Shutting down...');
    await shutdownContext();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { server, config: serverConfig };
}

/**
 * Start the server
 */
export async function startServer(config: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  const { server, config: serverConfig } = await createServer(config);

  try {
    await server.listen({
      port: serverConfig.port,
      host: serverConfig.host,
    });

    const authStatus = serverConfig.enableAuth ? 'enabled' : 'disabled';
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    COGNIGATE API v0.1.0                   ║
╠═══════════════════════════════════════════════════════════╣
║  Server:  http://${serverConfig.host}:${serverConfig.port}                          ║
║  Auth:    ${authStatus.padEnd(47)}║
║  Dev Key: vorion-dev-key-12345                            ║
╚═══════════════════════════════════════════════════════════╝
    `);

    return server;
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Start server when run directly
// Using a robust check that works cross-platform (Windows, Linux, Docker)
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const mainFile = resolve(process.argv[1] ?? '');
const isMainModule = currentFile === mainFile;

if (isMainModule) {
  startServer();
}
