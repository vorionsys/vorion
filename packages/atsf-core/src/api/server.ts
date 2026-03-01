/**
 * API Server
 *
 * Fastify server providing REST API for Vorion platform.
 *
 * @packageDocumentation
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';
import type { IIntentService } from '../intent/index.js';
import { PersistentIntentService } from '../intent/persistent-intent-service.js';
import { createProofService } from '../proof/index.js';
import { createTrustEngine } from '../trust-engine/index.js';
import { createEvaluator } from '../basis/evaluator.js';
import { createGovernanceEngine } from '../governance/index.js';
import { GovernanceProofBridge } from '../governance/proof-bridge.js';

import type { ID } from '../common/types.js';
import type { GovernanceRequest, RuleQuery, GovernanceRule } from '../governance/types.js';

const apiLogger = createLogger({ component: 'api' });

// ============================================================
// Health Check Types
// ============================================================

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
type CheckStatus = 'ok' | 'degraded' | 'error' | 'unknown';

interface HealthCheckResult {
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface SystemMetrics {
  memoryUsageMB: number;
  memoryUsagePercent: number;
  heapTotalMB: number;
  uptimeSeconds: number;
  nodeVersion: string;
}

interface HealthCheckResponse {
  status: HealthStatus;
  timestamp: string;
  version?: string;
  environment: string;
  checks: Record<string, HealthCheckResult>;
  metrics?: SystemMetrics;
}

interface ReadinessCheckResponse {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: Record<string, HealthCheckResult>;
  allPassed: boolean;
}

// ============================================================
// Health Check Implementation
// ============================================================

/**
 * Get system metrics for health reporting
 */
function getSystemMetrics(startTime: Date): SystemMetrics {
  const memUsage = process.memoryUsage();
  const heapUsed = memUsage.heapUsed;
  const heapTotal = memUsage.heapTotal;

  return {
    memoryUsageMB: Math.round(heapUsed / 1024 / 1024),
    memoryUsagePercent: Math.round((heapUsed / heapTotal) * 100),
    heapTotalMB: Math.round(heapTotal / 1024 / 1024),
    uptimeSeconds: Math.round((Date.now() - startTime.getTime()) / 1000),
    nodeVersion: process.version,
  };
}

/**
 * Check system health (memory, etc.)
 */
function checkSystemHealth(startTime: Date): HealthCheckResult {
  const metrics = getSystemMetrics(startTime);

  // Warning threshold: 80% memory usage
  // Error threshold: 95% memory usage
  let status: CheckStatus = 'ok';
  let message = 'System healthy';

  if (metrics.memoryUsagePercent > 95) {
    status = 'error';
    message = 'Critical memory pressure';
  } else if (metrics.memoryUsagePercent > 80) {
    status = 'degraded';
    message = 'High memory usage';
  }

  return {
    status,
    message,
    details: {
      memoryUsageMB: metrics.memoryUsageMB,
      memoryUsagePercent: metrics.memoryUsagePercent,
      uptimeSeconds: metrics.uptimeSeconds,
    },
  };
}

/**
 * Check a service by attempting a simple operation
 */
async function checkService(
  name: string,
  checkFn: () => Promise<void>
): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await checkFn();
    return {
      status: 'ok',
      latencyMs: Date.now() - start,
      message: `${name} operational`,
    };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: `${name} error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// Request body types
interface IntentSubmitBody {
  entityId: ID;
  goal: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// SDK-compatible request types
interface SDKIntentSubmitBody {
  agentId: string;
  agentName?: string;
  capabilities?: string[];
  observationTier?: string;
  action: { type: string; resource: string; parameters?: Record<string, unknown> };
}

interface SDKIntentCheckBody {
  agentId: string;
  agentName?: string;
  capabilities?: string[];
  observationTier?: string;
  action: { type: string; resource: string };
}

interface SDKAdmitBody {
  agentId: string;
  name: string;
  capabilities: string[];
  observationTier: string;
}

interface SDKSignalBody {
  type: 'success' | 'failure' | 'violation' | 'neutral';
  source: string;
  weight?: number;
  context?: Record<string, unknown>;
}

interface ConstraintValidateBody {
  entityId: ID;
  intentType: string;
  context?: Record<string, unknown>;
}

/**
 * Create and configure the API server
 */
export async function createServer(deps?: {
  intentService?: IIntentService;
}): Promise<FastifyInstance> {
  const config = getConfig();
  const startTime = new Date();

  // Initialize services
  const intentService = deps?.intentService ?? new PersistentIntentService();
  const proofService = createProofService();
  const trustEngine = createTrustEngine();
  const evaluator = createEvaluator();
  const governanceEngine = createGovernanceEngine({ enableCaching: false });
  const governanceBridge = new GovernanceProofBridge(governanceEngine, {
    createProof: async (req) => {
      const proof = await proofService.create(req);
      return { id: proof.id };
    },
    tenantId: '__system__',
  });
  // Use pino logger config for Fastify 5
  const isTest = process.env['NODE_ENV'] === 'test' || process.env['VITEST'];
  const server = Fastify({
    logger: isTest ? false : {
      level: config.env === 'production' ? 'info' : 'debug',
      transport: config.env !== 'production' ? {
        target: 'pino-pretty',
        options: { colorize: true },
      } : undefined,
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  // Register plugins
  await server.register(cors, {
    origin: config.env === 'production' ? false : true,
    credentials: true,
  });

  await server.register(helmet, {
    contentSecurityPolicy: config.env === 'production',
  });

  await server.register(rateLimit, {
    max: config.api.rateLimit,
    timeWindow: '1 minute',
  });

  // API Key authentication for protected routes
  const API_KEY = process.env['VORION_API_KEY'] || config.api.apiKey;
  const requiresAuth = (url: string): boolean => {
    // Public endpoints that don't require auth
    const publicPaths = ['/health', '/ready', '/live', '/api/v1/health'];
    return !publicPaths.some(path => url === path || url.startsWith(path + '?'));
  };

  server.addHook('onRequest', async (request, reply) => {
    // Skip auth in test mode or for public endpoints
    if (isTest || !requiresAuth(request.url)) {
      return;
    }

    // Skip auth if no API key is configured (development mode)
    if (!API_KEY) {
      return;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' },
      });
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || token !== API_KEY) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      });
    }
  });

  // Health check endpoint - performs actual checks on all services
  server.get('/health', async (): Promise<HealthCheckResponse> => {
    const checks: Record<string, HealthCheckResult> = {};

    // Check trust engine
    checks.trustEngine = await checkService('Trust engine', async () => {
      await trustEngine.getScore('__health_check__');
    });

    // Check proof service
    checks.proofService = await checkService('Proof service', async () => {
      await proofService.get('__health_check_proof__');
    });

    // Check intent service
    checks.intentService = await checkService('Intent service', async () => {
      await intentService.get('__health_check_intent__', '__system__');
    });

    // Check system health
    checks.system = checkSystemHealth(startTime);

    // Determine overall status
    const statuses = Object.values(checks).map((c) => c.status);
    let status: HealthStatus;
    if (statuses.every((s) => s === 'ok')) {
      status = 'healthy';
    } else if (statuses.some((s) => s === 'error')) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'],
      environment: config.env,
      checks,
      metrics: getSystemMetrics(startTime),
    };
  });

  // Ready check endpoint - verifies all critical services are ready
  server.get('/ready', async (_request, reply): Promise<ReadinessCheckResponse> => {
    const checks: Record<string, HealthCheckResult> = {};

    // Check trust engine (critical)
    checks.trustEngine = await checkService('Trust engine', async () => {
      await trustEngine.getScore('__health_check__');
    });

    // Check proof service (critical)
    checks.proofService = await checkService('Proof service', async () => {
      await proofService.get('__health_check_proof__');
    });

    // Check intent service (critical)
    checks.intentService = await checkService('Intent service', async () => {
      await intentService.get('__health_check_intent__', '__system__');
    });

    const allPassed = Object.values(checks).every(
      (c) => c.status === 'ok' || c.status === 'degraded'
    );

    // Return 503 if not ready (for Kubernetes probes)
    if (!allPassed) {
      reply.status(503);
    }

    return {
      status: allPassed ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
      allPassed,
    };
  });

  // Liveness probe endpoint - simple alive check (no deep checks)
  server.get('/live', async () => ({
    status: 'alive',
    timestamp: new Date().toISOString(),
  }));

  // API routes
  server.register(
    async (api) => {
      // SDK: Health check endpoint
      api.get('/health', async () => ({
        status: 'healthy',
        version: process.env['npm_package_version'] ?? '0.1.0',
      }));

      // Intent routes - unified handler for both legacy and SDK formats
      api.post<{ Body: IntentSubmitBody | SDKIntentSubmitBody }>(
        '/intents',
        async (request: FastifyRequest<{ Body: IntentSubmitBody | SDKIntentSubmitBody }>, reply: FastifyReply) => {
          const body = request.body;

          // Detect format: SDK format has 'agentId' and 'action', legacy has 'entityId' and 'goal'
          if ('agentId' in body && 'action' in body) {
            // SDK format
            const startTime = Date.now();
            const { agentId, capabilities = [], action } = body as SDKIntentSubmitBody;

            if (!agentId || !action?.type || !action?.resource) {
              return reply.status(400).send({
                error: { code: 'INVALID_REQUEST', message: 'Missing required fields: agentId, action.type, action.resource' },
              });
            }

            // Get or create agent trust record
            let trustRecord = await trustEngine.getScore(agentId);
            if (!trustRecord) {
              await trustEngine.initializeEntity(agentId, 3); // Default to T3
              trustRecord = await trustEngine.getScore(agentId);
            }

            // Check capability
            const hasCapability = capabilities.some(cap =>
              cap === '*' ||
              cap === action.type ||
              cap === `${action.type}:*` ||
              cap === `${action.type}:${action.resource.split('/')[0]}`
            );

            // Determine decision
            const trustLevel = trustRecord?.level ?? 3;
            const trustScore = trustRecord?.score ?? 500;
            const allowed = hasCapability && trustScore >= 200;

            // Decision tier based on trust level
            let tier: 'GREEN' | 'YELLOW' | 'RED';
            if (!allowed) {
              tier = 'RED';
            } else if (trustLevel >= 5) {
              tier = 'GREEN';
            } else {
              tier = 'YELLOW';
            }

            // Create proof record
            const proofId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const intentId = `intent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

            // Determine constraints based on tier
            const constraints: string[] = [];
            if (trustLevel <= 1) {
              constraints.push('rate_limit:10/min', 'audit:full', 'sandbox:true');
            } else if (trustLevel <= 3) {
              constraints.push('rate_limit:100/min', 'audit:standard');
            } else if (trustLevel <= 5) {
              constraints.push('rate_limit:1000/min', 'audit:light');
            }

            const reason = allowed
              ? 'Action permitted based on capabilities and trust level'
              : hasCapability
                ? `Trust score ${trustScore} below minimum threshold (200)`
                : `Missing capability for ${action.type}:${action.resource.split('/')[0]}`;

            apiLogger.info({ intentId, agentId, action: action.type, allowed, tier }, 'Intent processed');

            return {
              intentId,
              allowed,
              tier,
              reason,
              proofId,
              constraints: allowed ? constraints : undefined,
              processingTimeMs: Date.now() - startTime,
            };
          } else {
            // Legacy format
            const { entityId, goal, context, metadata } = body as IntentSubmitBody;

            if (!entityId || !goal) {
              return reply.status(400).send({
                error: { code: 'INVALID_REQUEST', message: 'Missing required fields: entityId, goal' },
              });
            }

            const intent = await intentService.submit({
              entityId,
              goal,
              context: context ?? {},
              metadata,
            }, { tenantId: '__system__' });

            apiLogger.info({ intentId: intent.id, entityId }, 'Intent submitted');
            return reply.status(201).send({ intent });
          }
        }
      );

      api.get<{ Params: { id: ID } }>(
        '/intents/:id',
        async (request: FastifyRequest<{ Params: { id: ID } }>, reply: FastifyReply) => {
          const intent = await intentService.get(request.params.id, '__system__');

          if (!intent) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Intent not found' },
            });
          }

          return { intent };
        }
      );

      // SDK: Check intent (pre-flight, no side effects)
      api.post<{ Body: SDKIntentCheckBody }>(
        '/intents/check',
        async (request: FastifyRequest<{ Body: SDKIntentCheckBody }>, reply: FastifyReply) => {
          const { agentId, capabilities = [], action } = request.body;

          if (!agentId || !action?.type || !action?.resource) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
            });
          }

          // Get agent trust record
          const trustRecord = await trustEngine.getScore(agentId);
          const trustScore = trustRecord?.score ?? 0;
          const trustLevel = trustRecord?.level ?? 0;

          // Check capability
          const hasCapability = capabilities.some(cap =>
            cap === '*' ||
            cap === action.type ||
            cap === `${action.type}:*` ||
            cap === `${action.type}:${action.resource.split('/')[0]}`
          );

          const wouldAllow = hasCapability && trustScore >= 200;

          let tier: 'GREEN' | 'YELLOW' | 'RED';
          if (!wouldAllow) {
            tier = 'RED';
          } else if (trustLevel >= 5) {
            tier = 'GREEN';
          } else {
            tier = 'YELLOW';
          }

          const reason = wouldAllow
            ? 'Action would be permitted'
            : hasCapability
              ? `Trust score ${trustScore} below minimum threshold`
              : `Missing capability for ${action.type}`;

          return { wouldAllow, tier, reason };
        }
      );

      // Proof routes
      api.get<{ Params: { id: ID } }>(
        '/proofs/:id',
        async (request: FastifyRequest<{ Params: { id: ID } }>, reply: FastifyReply) => {
          const proof = await proofService.get(request.params.id);

          if (!proof) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Proof not found' },
            });
          }

          return { proof };
        }
      );

      api.post<{ Params: { id: ID } }>(
        '/proofs/:id/verify',
        async (request: FastifyRequest<{ Params: { id: ID } }>, reply: FastifyReply) => {
          const result = await proofService.verify(request.params.id);

          if (result.chainPosition === -1) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Proof not found' },
            });
          }

          return { verification: result };
        }
      );

      // Trust routes
      api.get<{ Params: { entityId: ID } }>(
        '/trust/:entityId',
        async (request: FastifyRequest<{ Params: { entityId: ID } }>) => {
          const record = await trustEngine.getScore(request.params.entityId);

          if (!record) {
            // Return null values for non-existent agents (SDK compatible)
            return {
              agentId: request.params.entityId,
              score: null,
              tier: null,
              tierName: null,
              message: 'Agent not found',
            };
          }

          return {
            agentId: record.entityId,
            score: record.score,
            tier: record.level,
            tierName: trustEngine.getLevelName(record.level),
            observationCeiling: 7, // Max tier ceiling
          };
        }
      );

      // SDK: Admit agent endpoint
      api.post<{ Body: SDKAdmitBody }>(
        '/trust/admit',
        async (request: FastifyRequest<{ Body: SDKAdmitBody }>, reply: FastifyReply) => {
          const { agentId, name, capabilities, observationTier } = request.body;

          if (!agentId || !name) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required fields: agentId, name' },
            });
          }

          // Initialize agent in trust engine at T3 (Monitored)
          const initialLevel = 3;
          await trustEngine.initializeEntity(agentId, initialLevel);

          const record = await trustEngine.getScore(agentId);
          const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year

          apiLogger.info({ agentId, name, initialLevel }, 'Agent admitted');

          return reply.status(201).send({
            admitted: true,
            initialTier: record?.level ?? initialLevel,
            initialScore: record?.score ?? 500,
            observationCeiling: observationTier === 'WHITE_BOX' ? 7 : observationTier === 'GRAY_BOX' ? 5 : 3,
            capabilities: capabilities ?? [],
            expiresAt,
          });
        }
      );

      // SDK: Record trust signal
      api.post<{ Params: { agentId: ID }; Body: SDKSignalBody }>(
        '/trust/:agentId/signal',
        async (request: FastifyRequest<{ Params: { agentId: ID }; Body: SDKSignalBody }>, reply: FastifyReply) => {
          const { agentId } = request.params;
          const { type, source, weight = 0.1, context } = request.body;

          const recordBefore = await trustEngine.getScore(agentId);
          if (!recordBefore) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Agent not found' },
            });
          }

          const scoreBefore = recordBefore.score;

          // Map signal type to trust value
          const valueMap: Record<string, number> = {
            success: 0.8 + (weight * 0.2),
            failure: 0.2 - (weight * 0.1),
            violation: 0.0,
            neutral: 0.5,
          };

          // Record the signal
          await trustEngine.recordSignal({
            id: `signal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            entityId: agentId,
            type: `behavioral.${type}`,
            value: valueMap[type] ?? 0.5,
            source,
            timestamp: new Date().toISOString(),
            metadata: context ?? {},
          });

          const recordAfter = await trustEngine.getScore(agentId);
          const scoreAfter = recordAfter?.score ?? scoreBefore;

          return {
            accepted: true,
            scoreBefore,
            scoreAfter,
            change: scoreAfter - scoreBefore,
            newTier: recordAfter?.level ?? null,
            newTierName: recordAfter ? trustEngine.getLevelName(recordAfter.level) : null,
          };
        }
      );

      // ================================================================
      // Governance routes
      // ================================================================

      // Evaluate governance request (with proof chain)
      api.post<{ Body: GovernanceRequest }>(
        '/governance/evaluate',
        async (request: FastifyRequest<{ Body: GovernanceRequest }>, reply: FastifyReply) => {
          const body = request.body;

          if (!body.requestId || !body.entityId || !body.action) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required fields: requestId, entityId, action' },
            });
          }

          const startTime = Date.now();
          const { result, proofId } = await governanceBridge.evaluateWithProof(body);

          apiLogger.info({
            requestId: body.requestId,
            entityId: body.entityId,
            decision: result.decision,
            proofId,
          }, 'Governance evaluation completed');

          return {
            result,
            proofId,
            processingTimeMs: Date.now() - startTime,
          };
        }
      );

      // Query governance rules
      api.get<{ Querystring: RuleQuery }>(
        '/governance/rules',
        async (request: FastifyRequest<{ Querystring: RuleQuery }>) => {
          const rules = await governanceEngine.queryRules(request.query);
          return { rules, count: rules.length };
        }
      );

      // Register governance rule
      api.post<{ Body: GovernanceRule }>(
        '/governance/rules',
        async (request: FastifyRequest<{ Body: GovernanceRule }>, reply: FastifyReply) => {
          const rule = request.body;

          if (!rule.ruleId || !rule.name || !rule.condition || !rule.effect) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required rule fields' },
            });
          }

          governanceEngine.registerRule(rule);

          apiLogger.info({ ruleId: rule.ruleId, name: rule.name }, 'Governance rule registered');

          return reply.status(201).send({ registered: true, ruleId: rule.ruleId });
        }
      );

      // ================================================================
      // Boot Camp routes
      // ================================================================

      // Run boot camp for an agent
      api.post<{ Params: { agentId: ID }; Body: { tenantId: string } }>(
        '/agents/:agentId/bootcamp',
        async (request: FastifyRequest<{ Params: { agentId: ID }; Body: { tenantId: string } }>, reply: FastifyReply) => {
          const { agentId } = request.params;
          const { tenantId } = request.body;

          if (!tenantId) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required field: tenantId' },
            });
          }

          // The agent must implement handleChallenge — for API usage,
          // this is a placeholder that indicates the boot camp needs
          // to be driven by the calling service with a real agent adapter.
          // For now, return the service configuration info.
          apiLogger.info({ agentId, tenantId }, 'Boot camp requested');

          return reply.status(501).send({
            error: {
              code: 'NOT_IMPLEMENTED',
              message: 'Boot camp must be run programmatically via PromotionService. ' +
                'Use the @vorionsys/atsf-core SDK to run boot camp with a BootCampAgent implementation.',
            },
            hint: {
              sdk: '@vorionsys/atsf-core',
              import: 'PromotionService',
              usage: 'new PromotionService(trustEngine).runAndEvaluate(agent)',
            },
          });
        }
      );

      // Constraint routes
      api.post<{ Body: ConstraintValidateBody }>(
        '/constraints/validate',
        async (request: FastifyRequest<{ Body: ConstraintValidateBody }>, reply: FastifyReply) => {
          const { entityId, intentType, context } = request.body;

          if (!entityId || !intentType) {
            return reply.status(400).send({
              error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
            });
          }

          // Get entity trust record
          const trustRecord = await trustEngine.getScore(entityId);
          if (!trustRecord) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Entity not found' },
            });
          }

          // Create evaluation context
          const evalContext = {
            intent: {
              id: 'validation-check',
              type: intentType,
              goal: 'constraint-validation',
              context: context ?? {},
            },
            entity: {
              id: entityId,
              type: 'agent',
              trustScore: trustRecord.score,
              trustLevel: trustRecord.level,
              attributes: {},
            },
            environment: {
              timestamp: new Date().toISOString(),
              timezone: 'UTC',
              requestId: request.id,
            },
            custom: {},
          };

          // Evaluate constraints
          const result = await evaluator.evaluate(evalContext);

          return {
            validation: {
              passed: result.passed,
              action: result.finalAction,
              rulesEvaluated: result.rulesEvaluated.length,
              violations: result.violatedRules.map((r) => ({
                ruleId: r.ruleId,
                reason: r.reason,
              })),
            },
          };
        }
      );
    },
    { prefix: config.api.basePath }
  );

  // Error handler
  server.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    apiLogger.error(
      {
        error: error.message,
        stack: error.stack,
        requestId: request.id,
      },
      'Request error'
    );

    reply.status(error.statusCode ?? 500).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message:
          config.env === 'production'
            ? 'An error occurred'
            : error.message,
      },
    });
  });

  return server;
}

/**
 * Start the API server
 */
export async function startServer(): Promise<void> {
  const config = getConfig();
  const server = await createServer();

  try {
    await server.listen({
      port: config.api.port,
      host: config.api.host,
    });

    apiLogger.info(
      {
        port: config.api.port,
        host: config.api.host,
        environment: config.env,
      },
      'Server started'
    );
  } catch (error) {
    apiLogger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}
