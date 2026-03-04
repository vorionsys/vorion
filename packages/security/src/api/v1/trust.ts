/**
 * API v1 Trust Routes
 *
 * Comprehensive Trust Engine API endpoints for trust score management,
 * history tracking, signal recording, and analytics.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, desc, gte, lte, and, sql, count } from 'drizzle-orm';
import { createLogger } from '../../common/logger.js';
import {
  createTrustEngine,
  type TrustRecord,
  type TrustCalculation,
  type TrustHistoryEntry,
  TRUST_LEVEL_NAMES,
  TRUST_THRESHOLDS,
  /** @deprecated SIGNAL_WEIGHTS is deprecated; prefer FACTOR_WEIGHTS for the 16-factor model */
  SIGNAL_WEIGHTS,
  FACTOR_WEIGHTS,
  FACTOR_CODES,
  DECAY_MILESTONES,
} from '../../trust-engine/index.js';
import { getDatabase } from '../../common/db.js';
import { trustRecords, trustSignals, trustHistory } from '../../db/schema/trust.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimit, rateLimitPerTenant } from '../middleware/rateLimit.js';
import type { TrustLevel, TrustScore, TrustComponents, ID } from '../../common/types.js';
import { recordAuditEvent } from '../middleware/audit.js';

const trustLogger = createLogger({ component: 'api-v1-trust' });
const trustEngine = createTrustEngine();

// =============================================================================
// ZOD SCHEMAS - Request Validation
// =============================================================================

/**
 * Entity ID parameter schema
 */
const entityIdParamsSchema = z.object({
  entityId: z.string().uuid('Invalid entity ID format'),
});

/**
 * Trust history query parameters
 */
const historyQuerySchema = z.object({
  /** Cursor for pagination (ISO timestamp) */
  cursor: z.string().datetime().optional(),
  /** Number of records to return (default: 50, max: 100) */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Start date filter (ISO timestamp) */
  startDate: z.string().datetime().optional(),
  /** End date filter (ISO timestamp) */
  endDate: z.string().datetime().optional(),
});

/**
 * Trust signals query parameters
 */
const signalsQuerySchema = z.object({
  /** Cursor for pagination (ISO timestamp) */
  cursor: z.string().datetime().optional(),
  /** Number of records to return (default: 50, max: 100) */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Filter by signal type prefix (e.g., 'behavioral', 'compliance') */
  type: z.string().optional(),
  /** Start date filter (ISO timestamp) */
  startDate: z.string().datetime().optional(),
  /** End date filter (ISO timestamp) */
  endDate: z.string().datetime().optional(),
});

/**
 * Trust signal creation schema (admin only)
 */
const createSignalBodySchema = z.object({
  /** Signal type (e.g., 'behavioral.success', 'compliance.violation') */
  type: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z]+\.[a-z_]+$/i, 'Signal type must be in format: category.name'),
  /** Signal value (0.0 to 1.0) */
  value: z.number().min(0).max(1),
  /** Weight multiplier (default: 1.0) */
  weight: z.number().min(0).max(10).default(1.0),
  /** Source system identifier */
  source: z.string().min(1).max(100).optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Distribution query parameters
 */
const distributionQuerySchema = z.object({
  /** Include inactive entities (no activity in last 30 days) */
  includeInactive: z.coerce.boolean().default(false),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Standard API response envelope
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * Paginated response with cursor
 */
interface PaginatedResponse<T> extends ApiResponse<T> {
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

/**
 * Trust score response
 */
interface TrustScoreResponse {
  entityId: string;
  score: TrustScore;
  level: TrustLevel;
  tierName: string;
  /** @deprecated Use factorScores instead */
  components: TrustComponents;
  /** Per-factor scores (0.0–1.0) for each of the 16 trust factors */
  factorScores: Record<string, number>;
  decay: {
    applied: boolean;
    multiplier: number;
    baseScore: TrustScore;
    nextMilestone: { days: number; multiplier: number } | null;
  };
  lastActivityAt: string;
  lastCalculatedAt: string;
}

/**
 * Trust history entry response
 */
interface TrustHistoryResponse {
  score: TrustScore;
  previousScore?: TrustScore;
  level: TrustLevel;
  previousLevel?: TrustLevel;
  reason: string;
  timestamp: string;
}

/**
 * Trust signal response
 */
interface TrustSignalResponse {
  id: string;
  type: string;
  value: number;
  weight: number;
  source: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

/**
 * Trust calculation breakdown response
 */
interface TrustCalculationResponse {
  entityId: string;
  currentScore: TrustScore;
  currentLevel: TrustLevel;
  calculation: {
    /** @deprecated Legacy 4-bucket components — use factorScores instead */
    components: TrustComponents;
    /** @deprecated Legacy 4-bucket weights — use factorWeights instead */
    weights: typeof SIGNAL_WEIGHTS;
    /** @deprecated Legacy 4-bucket contributions — use factorContributions instead */
    weightedContributions: {
      behavioral: number;
      compliance: number;
      identity: number;
      context: number;
    };
    /** @deprecated Legacy raw total — use factorTotal instead */
    rawTotal: number;
    finalScore: TrustScore;
    /** 16-factor scores (0.0–1.0 per factor code) */
    factorScores: Record<string, number> | undefined;
    /** 16-factor weights (equal 0.0625 each by default) */
    factorWeights: Record<string, number>;
    /** 16-factor weighted contributions (score * weight * 1000) */
    factorContributions: Record<string, number>;
    /** 16-factor total (sum of factorContributions) */
    factorTotal: number;
  };
  decay: {
    applied: boolean;
    daysSinceActivity: number;
    multiplier: number;
    baseScore: TrustScore;
    decayedScore: TrustScore;
  };
  thresholds: typeof TRUST_THRESHOLDS;
  significantFactors: string[];
  lastCalculatedAt: string;
}

/**
 * Trust tier distribution response
 */
interface TrustDistributionResponse {
  tenantId: string;
  totalEntities: number;
  activeEntities: number;
  distribution: Array<{
    level: TrustLevel;
    tierName: string;
    count: number;
    percentage: number;
    scoreRange: { min: number; max: number };
  }>;
  averageScore: number;
  medianScore: number;
  generatedAt: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract and validate tenant ID from JWT
 */
async function getTenantId(request: FastifyRequest): Promise<string> {
  const payload = await request.jwtVerify<{ tenantId?: string; sub?: string }>();

  if (!payload.tenantId) {
    throw new ForbiddenError('Tenant context missing from token');
  }

  if (!payload.sub) {
    throw new ForbiddenError('User identifier missing from token');
  }

  await requireTenantMembership(payload.sub, payload.tenantId);
  return payload.tenantId;
}

/**
 * Check if user has admin role
 */
function isAdmin(roles: string[]): boolean {
  return (
    roles.includes('admin') ||
    roles.includes('tenant:admin') ||
    roles.includes('system:admin') ||
    roles.includes('trust:admin')
  );
}

/**
 * Create error response
 */
function errorResponse(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>
): ApiResponse<never> {
  return {
    success: false,
    error: { code, message, details },
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}

/**
 * Create success response
 */
function successResponse<T>(data: T, requestId: string): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}

/**
 * Create paginated response
 */
function paginatedResponse<T>(
  data: T,
  cursor: string | null,
  hasMore: boolean,
  limit: number,
  requestId: string
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    pagination: { cursor, hasMore, limit },
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Register v1 trust routes
 */
export async function registerTrustRoutesV1(fastify: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /trust/:entityId - Get current trust score (enhanced)
  // Rate limit: 100 requests per minute per tenant
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId',
    {
      preHandler: rateLimitPerTenant({ limit: 100, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      const trustRecord: TrustRecord | undefined = await trustEngine.getScore(params.entityId, {
        tenantId,
      });

      if (!trustRecord) {
        return reply.status(404).send(
          errorResponse('ENTITY_NOT_FOUND', 'Entity trust record not found', request.id, {
            entityId: params.entityId,
          })
        );
      }

      const responseData: TrustScoreResponse = {
        entityId: trustRecord.entityId,
        score: trustRecord.score,
        level: trustRecord.level,
        tierName: TRUST_LEVEL_NAMES[trustRecord.level],
        components: trustRecord.components,
        factorScores: trustRecord.factorScores,
        decay: {
          applied: trustRecord.decayApplied,
          multiplier: trustRecord.decayMultiplier,
          baseScore: trustRecord.baseScore,
          nextMilestone: trustRecord.nextMilestone,
        },
        lastActivityAt: trustRecord.lastActivityAt,
        lastCalculatedAt: trustRecord.lastCalculatedAt,
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/:entityId/history - Get trust score history over time
  // Rate limit: 50 requests per minute per tenant (cursor-based pagination)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId/history',
    {
      preHandler: rateLimitPerTenant({ limit: 50, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});
      const query = historyQuerySchema.parse(request.query ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      const db = getDatabase();

      // Build query conditions
      const conditions = [eq(trustHistory.entityId, params.entityId)];

      if (query.cursor) {
        conditions.push(lte(trustHistory.timestamp, new Date(query.cursor)));
      }
      if (query.startDate) {
        conditions.push(gte(trustHistory.timestamp, new Date(query.startDate)));
      }
      if (query.endDate) {
        conditions.push(lte(trustHistory.timestamp, new Date(query.endDate)));
      }

      // Fetch one extra to determine hasMore
      const records = await db
        .select()
        .from(trustHistory)
        .where(and(...conditions))
        .orderBy(desc(trustHistory.timestamp))
        .limit(query.limit + 1);

      const hasMore = records.length > query.limit;
      const resultRecords = hasMore ? records.slice(0, query.limit) : records;

      const historyData: TrustHistoryResponse[] = resultRecords.map((h) => ({
        score: h.score,
        previousScore: h.previousScore ?? undefined,
        level: parseInt(h.level) as TrustLevel,
        previousLevel: h.previousLevel ? (parseInt(h.previousLevel) as TrustLevel) : undefined,
        reason: h.reason,
        timestamp: h.timestamp.toISOString(),
      }));

      // Cursor is the timestamp of the last record
      const nextCursor =
        hasMore && resultRecords.length > 0
          ? resultRecords[resultRecords.length - 1]!.timestamp.toISOString()
          : null;

      return reply.send(paginatedResponse(historyData, nextCursor, hasMore, query.limit, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/:entityId/signals - Get recent trust signals
  // Rate limit: 50 requests per minute per tenant (cursor-based pagination)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId/signals',
    {
      preHandler: rateLimitPerTenant({ limit: 50, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});
      const query = signalsQuerySchema.parse(request.query ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      const db = getDatabase();

      // Build query conditions
      const conditions = [eq(trustSignals.entityId, params.entityId)];

      if (query.cursor) {
        conditions.push(lte(trustSignals.timestamp, new Date(query.cursor)));
      }
      if (query.type) {
        // Use LIKE for type prefix matching
        conditions.push(sql`${trustSignals.type} LIKE ${query.type + '%'}`);
      }
      if (query.startDate) {
        conditions.push(gte(trustSignals.timestamp, new Date(query.startDate)));
      }
      if (query.endDate) {
        conditions.push(lte(trustSignals.timestamp, new Date(query.endDate)));
      }

      // Fetch one extra to determine hasMore
      const records = await db
        .select()
        .from(trustSignals)
        .where(and(...conditions))
        .orderBy(desc(trustSignals.timestamp))
        .limit(query.limit + 1);

      const hasMore = records.length > query.limit;
      const resultRecords = hasMore ? records.slice(0, query.limit) : records;

      const signalsData: TrustSignalResponse[] = resultRecords.map((s) => ({
        id: s.id,
        type: s.type,
        value: s.value,
        weight: s.weight,
        source: s.source,
        metadata: s.metadata as Record<string, unknown> | null,
        timestamp: s.timestamp.toISOString(),
      }));

      // Cursor is the timestamp of the last record
      const nextCursor =
        hasMore && resultRecords.length > 0
          ? resultRecords[resultRecords.length - 1]!.timestamp.toISOString()
          : null;

      return reply.send(paginatedResponse(signalsData, nextCursor, hasMore, query.limit, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // POST /trust/:entityId/signal - Record a trust signal (admin only)
  // Rate limit: 30 requests per minute (admin action, more restrictive)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/trust/:entityId/signal',
    {
      preHandler: rateLimit({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user.roles ?? [];

      // Require admin role
      if (!isAdmin(roles)) {
        trustLogger.warn({ userId: user.sub, tenantId }, 'Unauthorized signal creation attempt');
        return reply.status(403).send(
          errorResponse('FORBIDDEN', 'Admin role required to record trust signals', request.id)
        );
      }

      const params = entityIdParamsSchema.parse(request.params ?? {});
      const body = createSignalBodySchema.parse(request.body ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      // Generate signal ID
      const signalId = crypto.randomUUID();

      // Record the signal
      await trustEngine.recordSignal(
        {
          id: signalId,
          entityId: params.entityId,
          type: body.type,
          value: body.value,
          weight: body.weight,
          source: body.source ?? `admin:${user.sub}`,
          timestamp: new Date().toISOString(),
          metadata: body.metadata,
        },
        { tenantId }
      );

      // Record audit event for trust signal update
      await recordAuditEvent(request, {
        eventType: 'trust_score.updated',
        resourceType: 'entity',
        resourceId: params.entityId,
        afterState: {
          signalId,
          entityId: params.entityId,
          type: body.type,
          value: body.value,
          weight: body.weight,
        },
        metadata: {
          signalType: body.type,
          source: body.source ?? `admin:${user.sub}`,
        },
      });

      trustLogger.info(
        {
          entityId: params.entityId,
          signalId,
          signalType: body.type,
          value: body.value,
          adminUserId: user.sub,
          tenantId,
        },
        'Trust signal recorded by admin'
      );

      // Return the created signal info
      return reply.status(201).send(
        successResponse(
          {
            signalId,
            entityId: params.entityId,
            type: body.type,
            value: body.value,
            weight: body.weight,
            recordedAt: new Date().toISOString(),
          },
          request.id
        )
      );
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/:entityId/calculation - Get detailed trust calculation breakdown
  // Rate limit: 30 requests per minute per tenant (computation heavy)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId/calculation',
    {
      preHandler: rateLimitPerTenant({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      // Get current trust record
      const trustRecord = await trustEngine.getScore(params.entityId, { tenantId });

      if (!trustRecord) {
        return reply.status(404).send(
          errorResponse('ENTITY_NOT_FOUND', 'Entity trust record not found', request.id, {
            entityId: params.entityId,
          })
        );
      }

      // Force recalculation to get fresh data
      const calculation: TrustCalculation = await trustEngine.calculate(params.entityId, {
        tenantId,
      });

      // Legacy 4-bucket weighted contributions (backwards compatible)
      const weightedContributions = {
        behavioral: calculation.components.behavioral * SIGNAL_WEIGHTS.behavioral * 1000,
        compliance: calculation.components.compliance * SIGNAL_WEIGHTS.compliance * 1000,
        identity: calculation.components.identity * SIGNAL_WEIGHTS.identity * 1000,
        context: calculation.components.context * SIGNAL_WEIGHTS.context * 1000,
      };

      const rawTotal = Object.values(weightedContributions).reduce((sum, val) => sum + val, 0);

      // 16-factor weighted contributions (canonical model)
      const factorContributions: Record<string, number> = {};
      for (const code of FACTOR_CODES) {
        const score = calculation.factorScores?.[code] ?? 0.5;
        factorContributions[code] = score * FACTOR_WEIGHTS[code] * 1000;
      }
      const factorTotal = Object.values(factorContributions).reduce((sum, val) => sum + val, 0);

      // Calculate days since activity
      const lastActivityDate = new Date(trustRecord.lastActivityAt);
      const daysSinceActivity = Math.floor(
        (Date.now() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      const responseData: TrustCalculationResponse = {
        entityId: params.entityId,
        currentScore: trustRecord.score,
        currentLevel: trustRecord.level,
        calculation: {
          components: calculation.components,
          weights: SIGNAL_WEIGHTS,
          weightedContributions,
          rawTotal: Math.round(rawTotal),
          finalScore: calculation.score,
          factorScores: calculation.factorScores,
          factorWeights: FACTOR_WEIGHTS,
          factorContributions,
          factorTotal: Math.round(factorTotal),
        },
        decay: {
          applied: trustRecord.decayApplied,
          daysSinceActivity,
          multiplier: trustRecord.decayMultiplier,
          baseScore: trustRecord.baseScore,
          decayedScore: trustRecord.score,
        },
        thresholds: TRUST_THRESHOLDS,
        significantFactors: calculation.factors,
        lastCalculatedAt: new Date().toISOString(),
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // POST /trust/:entityId/recalculate - Force recalculation (admin only)
  // Rate limit: 10 requests per minute (expensive operation)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/trust/:entityId/recalculate',
    {
      preHandler: rateLimit({ limit: 10, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user.roles ?? [];

      // Require admin role
      if (!isAdmin(roles)) {
        trustLogger.warn({ userId: user.sub, tenantId }, 'Unauthorized recalculation attempt');
        return reply.status(403).send(
          errorResponse('FORBIDDEN', 'Admin role required to force recalculation', request.id)
        );
      }

      const params = entityIdParamsSchema.parse(request.params ?? {});

      // Register entity-tenant association for security
      trustEngine.registerEntityTenant(params.entityId, tenantId);

      // Check if entity exists
      const existingRecord = await trustEngine.getScore(params.entityId, { tenantId });

      if (!existingRecord) {
        return reply.status(404).send(
          errorResponse('ENTITY_NOT_FOUND', 'Entity trust record not found', request.id, {
            entityId: params.entityId,
          })
        );
      }

      const previousScore = existingRecord.score;
      const previousLevel = existingRecord.level;

      // Force recalculation
      const calculation: TrustCalculation = await trustEngine.calculate(params.entityId, {
        tenantId,
      });

      // Update the record with new calculation
      const db = getDatabase();
      await db
        .update(trustRecords)
        .set({
          score: calculation.score,
          level: calculation.level.toString() as '0' | '1' | '2' | '3' | '4',
          behavioralScore: calculation.components.behavioral,
          complianceScore: calculation.components.compliance,
          identityScore: calculation.components.identity,
          contextScore: calculation.components.context,
          lastCalculatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(trustRecords.entityId, params.entityId));

      // Record audit event for trust score recalculation
      await recordAuditEvent(request, {
        eventType: 'trust_score.recalculated',
        resourceType: 'entity',
        resourceId: params.entityId,
        beforeState: {
          score: previousScore,
          level: previousLevel,
        },
        afterState: {
          score: calculation.score,
          level: calculation.level,
          components: calculation.components,
        },
        metadata: {
          factors: calculation.factors,
          triggeredBy: user.sub,
        },
      });

      trustLogger.info(
        {
          entityId: params.entityId,
          previousScore,
          newScore: calculation.score,
          previousLevel,
          newLevel: calculation.level,
          adminUserId: user.sub,
          tenantId,
        },
        'Trust score recalculated by admin'
      );

      return reply.send(
        successResponse(
          {
            entityId: params.entityId,
            previousScore,
            previousLevel,
            newScore: calculation.score,
            newLevel: calculation.level,
            components: calculation.components,
            factors: calculation.factors,
            recalculatedAt: new Date().toISOString(),
          },
          request.id
        )
      );
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/distribution - Get trust tier distribution for tenant
  // Rate limit: 20 requests per minute per tenant (aggregation query)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/distribution',
    {
      preHandler: rateLimitPerTenant({ limit: 20, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const query = distributionQuerySchema.parse(request.query ?? {});

      const db = getDatabase();

      // Get all trust records for tenant's entities
      // Note: In production, you would have a tenant_id column on trust_records
      // For now, we rely on entity-tenant mapping

      // Build conditions for active vs inactive entities
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const conditions = query.includeInactive
        ? []
        : [gte(trustRecords.lastActivityAt, thirtyDaysAgo)];

      // Get distribution by level
      const distribution = await db
        .select({
          level: trustRecords.level,
          count: count(),
        })
        .from(trustRecords)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(trustRecords.level);

      // Get total and active counts
      const totalResult = await db.select({ count: count() }).from(trustRecords);
      const activeResult = await db
        .select({ count: count() })
        .from(trustRecords)
        .where(gte(trustRecords.lastActivityAt, thirtyDaysAgo));

      const totalEntities = totalResult[0]?.count ?? 0;
      const activeEntities = activeResult[0]?.count ?? 0;

      // Get score statistics
      const statsResult = await db
        .select({
          avgScore: sql<number>`AVG(${trustRecords.score})`,
          medianScore: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${trustRecords.score})`,
        })
        .from(trustRecords)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const avgScore = statsResult[0]?.avgScore ?? 0;
      const medianScore = statsResult[0]?.medianScore ?? 0;

      // Build distribution response
      const effectiveTotal = query.includeInactive ? totalEntities : activeEntities;
      const distributionData = (Object.keys(TRUST_LEVEL_NAMES) as unknown as TrustLevel[]).map(
        (level) => {
          const levelNum = Number(level) as TrustLevel;
          const found = distribution.find((d) => d.level === level.toString());
          const levelCount = found?.count ?? 0;

          return {
            level: levelNum,
            tierName: TRUST_LEVEL_NAMES[levelNum],
            count: levelCount,
            percentage: effectiveTotal > 0 ? Math.round((levelCount / effectiveTotal) * 10000) / 100 : 0,
            scoreRange: TRUST_THRESHOLDS[levelNum],
          };
        }
      );

      const responseData: TrustDistributionResponse = {
        tenantId,
        totalEntities,
        activeEntities,
        distribution: distributionData,
        averageScore: Math.round(avgScore),
        medianScore: Math.round(medianScore),
        generatedAt: new Date().toISOString(),
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  trustLogger.debug('Trust routes registered');
}
