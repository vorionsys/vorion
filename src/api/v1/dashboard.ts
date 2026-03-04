/**
 * Admin Dashboard API Endpoints
 *
 * Provides observability endpoints for the admin dashboard including:
 * - Dashboard summary metrics
 * - Trust analytics and forecasting
 * - Intent analytics and timelines
 * - Proof chain status
 * - System health monitoring
 *
 * All endpoints require admin authentication.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, gte, lte, desc, sql, count } from 'drizzle-orm';
import { createLogger } from '../../common/logger.js';
import { getDatabase, type Database } from '../../common/db.js';
import { getRedis } from '../../common/redis.js';
import { getConfig } from '../../common/config.js';
import { intents } from '../../db/schema/intents.js';
import { trustRecords, trustHistory } from '../../db/schema/trust.js';
import { proofs, proofChainMeta } from '../../db/schema/proofs.js';
import { escalations } from '../../db/schema/escalations.js';
import {
  checkDatabaseHealth,
  checkRedisHealth,
  checkQueueHealth,
} from '../../intent/health.js';
import { getAllCircuitBreakerStatuses } from '../../common/circuit-breaker.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
  DECAY_MILESTONES,
  calculateDecayMultiplier,
} from '../../trust-engine/index.js';
import type { TrustLevel } from '../../common/types.js';

const dashboardLogger = createLogger({ component: 'api-v1-dashboard' });

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Time range for analytics queries
 */
export type TimeRange = '24h' | '7d' | '30d';

/**
 * Intent status counts by time range
 */
export interface IntentCountsByRange {
  '24h': number;
  '7d': number;
  '30d': number;
}

/**
 * Dashboard summary response
 */
export interface DashboardSummaryResponse {
  totalIntents: IntentCountsByRange;
  approvalRate: {
    '24h': number;
    '7d': number;
    '30d': number;
  };
  averageTrustScore: number;
  activeEntitiesCount: number;
  escalationCount: {
    pending: number;
    total24h: number;
  };
  topDenialReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  timestamp: string;
}

/**
 * Trust tier distribution
 */
export interface TrustTierDistribution {
  tier: TrustLevel;
  tierName: string;
  count: number;
  percentage: number;
  scoreRange: { min: number; max: number };
}

/**
 * Trust distribution response
 */
export interface TrustDistributionResponse {
  distribution: TrustTierDistribution[];
  totalEntities: number;
  averageScore: number;
  scoreTrend: Array<{
    date: string;
    averageScore: number;
    entityCount: number;
  }>;
  timestamp: string;
}

/**
 * Entity approaching decay threshold
 */
export interface DecayForecastEntity {
  entityId: string;
  currentScore: number;
  currentTier: TrustLevel;
  daysSinceActivity: number;
  predictedScore7d: number;
  predictedTier7d: TrustLevel;
  nextMilestone: { days: number; multiplier: number } | null;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Trust decay forecast response
 */
export interface TrustDecayForecastResponse {
  entitiesAtRisk: DecayForecastEntity[];
  totalAtRisk: number;
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  };
  timestamp: string;
}

/**
 * Intent timeline data point
 */
export interface IntentTimelinePoint {
  timestamp: string;
  approved: number;
  denied: number;
  escalated: number;
  pending: number;
  total: number;
}

/**
 * Intent timeline response
 */
export interface IntentTimelineResponse {
  timeline: IntentTimelinePoint[];
  granularity: 'hour' | 'day';
  timeRange: TimeRange;
  totals: {
    approved: number;
    denied: number;
    escalated: number;
    pending: number;
  };
  timestamp: string;
}

/**
 * Top entity by activity or denial rate
 */
export interface TopEntity {
  entityId: string;
  totalIntents: number;
  approvedCount: number;
  deniedCount: number;
  escalatedCount: number;
  approvalRate: number;
  denialRate: number;
}

/**
 * Top entities response
 */
export interface TopEntitiesResponse {
  mostActive: TopEntity[];
  highestDenialRate: TopEntity[];
  timestamp: string;
}

/**
 * Proof chain status response
 */
export interface ProofChainStatusResponse {
  totalProofs: number;
  chainLength: number;
  chainIntegrity: {
    status: 'valid' | 'invalid' | 'unknown';
    lastVerifiedAt: string | null;
    lastVerifiedPosition: number | null;
    issuesFound: number;
  };
  lastProofAt: string | null;
  merkleAggregation: {
    enabled: boolean;
    lastAggregationAt: string | null;
    pendingProofs: number;
  };
  timestamp: string;
}

/**
 * Service health status
 */
export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerStatus {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: string | null;
  nextRetry: string | null;
}

/**
 * Queue depth information
 */
export interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * System health response
 */
export interface SystemHealthResponse {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealth[];
  circuitBreakers: CircuitBreakerStatus[];
  queues: QueueDepth[];
  resources: {
    memoryUsageMb: number;
    heapUsedMb: number;
    uptimeSeconds: number;
  };
  timestamp: string;
}

// =============================================================================
// QUERY SCHEMAS
// =============================================================================

const timeRangeSchema = z.object({
  range: z.enum(['24h', '7d', '30d']).optional().default('24h'),
});

const timelineQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).optional().default('24h'),
  granularity: z.enum(['hour', 'day']).optional(),
});

const topEntitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  range: z.enum(['24h', '7d', '30d']).optional().default('7d'),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if user has admin role
 */
function isAdmin(roles: string[]): boolean {
  return (
    roles.includes('admin') ||
    roles.includes('tenant:admin') ||
    roles.includes('system:admin') ||
    roles.includes('dashboard:admin')
  );
}

/**
 * Get date for time range
 */
function getDateForRange(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Calculate trust tier from score
 */
function scoreToTier(score: number): TrustLevel {
  for (const [level, { min, max }] of Object.entries(TRUST_THRESHOLDS)) {
    if (score >= min && score <= max) {
      return parseInt(level) as TrustLevel;
    }
  }
  return 0;
}

/**
 * Calculate days since last activity
 */
function daysSinceActivity(lastActivityAt: Date): number {
  const now = Date.now();
  const lastActivity = lastActivityAt.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now - lastActivity) / msPerDay);
}

/**
 * Get the next decay milestone for a given number of inactive days
 */
function getNextMilestone(
  daysSinceLastActivity: number
): { days: number; multiplier: number } | null {
  for (const milestone of DECAY_MILESTONES) {
    if (milestone.days > daysSinceLastActivity) {
      return milestone;
    }
  }
  return null;
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * Register admin dashboard routes
 */
export async function registerDashboardRoutesV1(
  fastify: FastifyInstance
): Promise<void> {
  const db = getDatabase();

  // ==========================================================================
  // Dashboard Summary
  // ==========================================================================

  /**
   * GET /dashboard/summary
   * Returns high-level dashboard metrics
   */
  fastify.get(
    '/dashboard/summary',
    {
      preHandler: rateLimit({ limit: 60, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        dashboardLogger.warn({ userId: user?.sub }, 'Unauthorized dashboard access attempt');
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        const now = new Date();
        const date24h = getDateForRange('24h');
        const date7d = getDateForRange('7d');
        const date30d = getDateForRange('30d');

        // Get intent counts by time range
        const [count24h, count7d, count30d] = await Promise.all([
          db
            .select({ count: count() })
            .from(intents)
            .where(gte(intents.createdAt, date24h)),
          db
            .select({ count: count() })
            .from(intents)
            .where(gte(intents.createdAt, date7d)),
          db
            .select({ count: count() })
            .from(intents)
            .where(gte(intents.createdAt, date30d)),
        ]);

        // Get approval rates
        const [approved24h, approved7d, approved30d] = await Promise.all([
          db
            .select({ count: count() })
            .from(intents)
            .where(
              and(
                gte(intents.createdAt, date24h),
                eq(intents.status, 'approved')
              )
            ),
          db
            .select({ count: count() })
            .from(intents)
            .where(
              and(gte(intents.createdAt, date7d), eq(intents.status, 'approved'))
            ),
          db
            .select({ count: count() })
            .from(intents)
            .where(
              and(
                gte(intents.createdAt, date30d),
                eq(intents.status, 'approved')
              )
            ),
        ]);

        // Get average trust score
        const avgTrustResult = await db
          .select({ avg: sql<number>`AVG(${trustRecords.score})` })
          .from(trustRecords);

        // Get active entities count (entities with activity in last 30 days)
        const activeEntitiesResult = await db
          .select({ count: count() })
          .from(trustRecords)
          .where(gte(trustRecords.lastActivityAt, date30d));

        // Get escalation counts
        const [pendingEscalations, totalEscalations24h] = await Promise.all([
          db
            .select({ count: count() })
            .from(escalations)
            .where(eq(escalations.status, 'pending')),
          db
            .select({ count: count() })
            .from(escalations)
            .where(gte(escalations.createdAt, date24h)),
        ]);

        // Get top denial reasons (from intent context/metadata where status is denied)
        // This is a simplified version - in production, you'd have a dedicated denial_reasons table
        const deniedIntents = await db
          .select({
            metadata: intents.metadata,
          })
          .from(intents)
          .where(
            and(gte(intents.createdAt, date7d), eq(intents.status, 'denied'))
          )
          .limit(1000);

        // Aggregate denial reasons from metadata
        const reasonCounts = new Map<string, number>();
        for (const intent of deniedIntents) {
          const reason =
            (intent.metadata as Record<string, unknown>)?.denialReason ||
            (intent.metadata as Record<string, unknown>)?.reason ||
            'Unspecified';
          const reasonStr = String(reason);
          reasonCounts.set(reasonStr, (reasonCounts.get(reasonStr) || 0) + 1);
        }

        const totalDenied = deniedIntents.length;
        const topDenialReasons = Array.from(reasonCounts.entries())
          .map(([reason, reasonCount]) => ({
            reason,
            count: reasonCount,
            percentage:
              totalDenied > 0
                ? Math.round((reasonCount / totalDenied) * 100)
                : 0,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const total24hCount = count24h[0]?.count ?? 0;
        const total7dCount = count7d[0]?.count ?? 0;
        const total30dCount = count30d[0]?.count ?? 0;

        const response: DashboardSummaryResponse = {
          totalIntents: {
            '24h': total24hCount,
            '7d': total7dCount,
            '30d': total30dCount,
          },
          approvalRate: {
            '24h':
              total24hCount > 0
                ? Math.round(
                    ((approved24h[0]?.count ?? 0) / total24hCount) * 100
                  )
                : 0,
            '7d':
              total7dCount > 0
                ? Math.round(
                    ((approved7d[0]?.count ?? 0) / total7dCount) * 100
                  )
                : 0,
            '30d':
              total30dCount > 0
                ? Math.round(
                    ((approved30d[0]?.count ?? 0) / total30dCount) * 100
                  )
                : 0,
          },
          averageTrustScore: Math.round(avgTrustResult[0]?.avg ?? 0),
          activeEntitiesCount: activeEntitiesResult[0]?.count ?? 0,
          escalationCount: {
            pending: pendingEscalations[0]?.count ?? 0,
            total24h: totalEscalations24h[0]?.count ?? 0,
          },
          topDenialReasons,
          timestamp: now.toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch dashboard summary');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch dashboard summary',
          },
        });
      }
    }
  );

  // ==========================================================================
  // Trust Analytics
  // ==========================================================================

  /**
   * GET /dashboard/trust/distribution
   * Returns trust tier distribution and score trends
   */
  fastify.get(
    '/dashboard/trust/distribution',
    {
      preHandler: rateLimit({ limit: 60, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        // Get all trust records for distribution
        const allRecords = await db.select().from(trustRecords);

        const totalEntities = allRecords.length;

        // Calculate tier distribution
        const tierCounts = new Map<TrustLevel, number>();
        let totalScore = 0;

        for (const record of allRecords) {
          const tier = parseInt(record.level) as TrustLevel;
          tierCounts.set(tier, (tierCounts.get(tier) || 0) + 1);
          totalScore += record.score;
        }

        const distribution: TrustTierDistribution[] = [];
        for (let tier = 0; tier <= 5; tier++) {
          const tierLevel = tier as TrustLevel;
          const tierCount = tierCounts.get(tierLevel) || 0;
          distribution.push({
            tier: tierLevel,
            tierName: TRUST_LEVEL_NAMES[tierLevel] || `Level ${tier}`,
            count: tierCount,
            percentage:
              totalEntities > 0
                ? Math.round((tierCount / totalEntities) * 100)
                : 0,
            scoreRange: TRUST_THRESHOLDS[tierLevel] || { min: 0, max: 0 },
          });
        }

        // Get score trend over last 30 days from trust history
        const date30d = getDateForRange('30d');
        const historyRecords = await db
          .select({
            date: sql<string>`DATE(${trustHistory.timestamp})`,
            avgScore: sql<number>`AVG(${trustHistory.score})`,
            entityCount: sql<number>`COUNT(DISTINCT ${trustHistory.entityId})`,
          })
          .from(trustHistory)
          .where(gte(trustHistory.timestamp, date30d))
          .groupBy(sql`DATE(${trustHistory.timestamp})`)
          .orderBy(sql`DATE(${trustHistory.timestamp})`);

        const scoreTrend = historyRecords.map((record) => ({
          date: record.date,
          averageScore: Math.round(record.avgScore),
          entityCount: record.entityCount,
        }));

        const response: TrustDistributionResponse = {
          distribution,
          totalEntities,
          averageScore:
            totalEntities > 0 ? Math.round(totalScore / totalEntities) : 0,
          scoreTrend,
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch trust distribution');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch trust distribution',
          },
        });
      }
    }
  );

  /**
   * GET /dashboard/trust/decay-forecast
   * Returns entities approaching decay thresholds
   */
  fastify.get(
    '/dashboard/trust/decay-forecast',
    {
      preHandler: rateLimit({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        // Get entities with activity more than 7 days ago (potential decay candidates)
        const date7dAgo = getDateForRange('7d');

        const atRiskRecords = await db
          .select()
          .from(trustRecords)
          .where(lte(trustRecords.lastActivityAt, date7dAgo))
          .orderBy(desc(trustRecords.score))
          .limit(100);

        const entitiesAtRisk: DecayForecastEntity[] = [];
        let highRisk = 0;
        let mediumRisk = 0;
        let lowRisk = 0;

        for (const record of atRiskRecords) {
          const days = daysSinceActivity(record.lastActivityAt);
          const currentTier = parseInt(record.level) as TrustLevel;

          // Calculate predicted score after 7 more days
          const daysIn7d = days + 7;
          const multiplier7d = calculateDecayMultiplier(daysIn7d);
          const predictedScore7d = Math.round(record.score * multiplier7d);
          const predictedTier7d = scoreToTier(predictedScore7d);

          // Determine risk level based on tier change
          let riskLevel: 'low' | 'medium' | 'high' = 'low';
          const tierDrop = currentTier - predictedTier7d;

          if (tierDrop >= 2) {
            riskLevel = 'high';
            highRisk++;
          } else if (tierDrop === 1) {
            riskLevel = 'medium';
            mediumRisk++;
          } else {
            riskLevel = 'low';
            lowRisk++;
          }

          entitiesAtRisk.push({
            entityId: record.entityId,
            currentScore: record.score,
            currentTier,
            daysSinceActivity: days,
            predictedScore7d,
            predictedTier7d,
            nextMilestone: getNextMilestone(days),
            riskLevel,
          });
        }

        // Sort by risk level (high first)
        entitiesAtRisk.sort((a, b) => {
          const riskOrder = { high: 0, medium: 1, low: 2 };
          return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        });

        const response: TrustDecayForecastResponse = {
          entitiesAtRisk,
          totalAtRisk: entitiesAtRisk.length,
          summary: {
            highRisk,
            mediumRisk,
            lowRisk,
          },
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch decay forecast');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch decay forecast',
          },
        });
      }
    }
  );

  // ==========================================================================
  // Intent Analytics
  // ==========================================================================

  /**
   * GET /dashboard/intents/timeline
   * Returns intent counts over time grouped by status
   */
  fastify.get(
    '/dashboard/intents/timeline',
    {
      preHandler: rateLimit({ limit: 60, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        const query = timelineQuerySchema.parse(request.query ?? {});
        const range = query.range as TimeRange;
        const granularity =
          query.granularity || (range === '24h' ? 'hour' : 'day');

        const startDate = getDateForRange(range);
        const dateFormat =
          granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

        // Get timeline data grouped by status
        const timelineData = await db
          .select({
            period: sql<string>`TO_CHAR(${intents.createdAt}, '${sql.raw(granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD')}')`,
            status: intents.status,
            count: count(),
          })
          .from(intents)
          .where(gte(intents.createdAt, startDate))
          .groupBy(
            sql`TO_CHAR(${intents.createdAt}, '${sql.raw(granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD')}')`,
            intents.status
          )
          .orderBy(
            sql`TO_CHAR(${intents.createdAt}, '${sql.raw(granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD')}')`
          );

        // Aggregate by period
        const periodMap = new Map<
          string,
          {
            approved: number;
            denied: number;
            escalated: number;
            pending: number;
            total: number;
          }
        >();

        for (const row of timelineData) {
          const period = row.period;
          if (!periodMap.has(period)) {
            periodMap.set(period, {
              approved: 0,
              denied: 0,
              escalated: 0,
              pending: 0,
              total: 0,
            });
          }

          const entry = periodMap.get(period)!;
          const rowCount = row.count;
          entry.total += rowCount;

          switch (row.status) {
            case 'approved':
            case 'completed':
              entry.approved += rowCount;
              break;
            case 'denied':
            case 'failed':
              entry.denied += rowCount;
              break;
            case 'escalated':
              entry.escalated += rowCount;
              break;
            case 'pending':
            case 'evaluating':
              entry.pending += rowCount;
              break;
          }
        }

        const timeline: IntentTimelinePoint[] = Array.from(periodMap.entries())
          .map(([timestamp, data]) => ({
            timestamp,
            ...data,
          }))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Calculate totals
        const totals = {
          approved: 0,
          denied: 0,
          escalated: 0,
          pending: 0,
        };

        for (const point of timeline) {
          totals.approved += point.approved;
          totals.denied += point.denied;
          totals.escalated += point.escalated;
          totals.pending += point.pending;
        }

        const response: IntentTimelineResponse = {
          timeline,
          granularity: granularity as 'hour' | 'day',
          timeRange: range,
          totals,
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch intent timeline');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch intent timeline',
          },
        });
      }
    }
  );

  /**
   * GET /dashboard/intents/top-entities
   * Returns most active entities and highest denial rate entities
   */
  fastify.get(
    '/dashboard/intents/top-entities',
    {
      preHandler: rateLimit({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        const query = topEntitiesQuerySchema.parse(request.query ?? {});
        const startDate = getDateForRange(query.range as TimeRange);
        const limit = query.limit;

        // Get entity statistics
        const entityStats = await db
          .select({
            entityId: intents.entityId,
            totalIntents: count(),
            approvedCount: sql<number>`SUM(CASE WHEN ${intents.status} IN ('approved', 'completed') THEN 1 ELSE 0 END)`,
            deniedCount: sql<number>`SUM(CASE WHEN ${intents.status} IN ('denied', 'failed') THEN 1 ELSE 0 END)`,
            escalatedCount: sql<number>`SUM(CASE WHEN ${intents.status} = 'escalated' THEN 1 ELSE 0 END)`,
          })
          .from(intents)
          .where(gte(intents.createdAt, startDate))
          .groupBy(intents.entityId)
          .having(sql`COUNT(*) >= 5`); // Only include entities with at least 5 intents

        const entitiesWithRates: TopEntity[] = entityStats.map((stat) => {
          const total = stat.totalIntents;
          const approved = stat.approvedCount || 0;
          const denied = stat.deniedCount || 0;

          return {
            entityId: stat.entityId,
            totalIntents: total,
            approvedCount: approved,
            deniedCount: denied,
            escalatedCount: stat.escalatedCount || 0,
            approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
            denialRate: total > 0 ? Math.round((denied / total) * 100) : 0,
          };
        });

        // Sort for most active (by total intents)
        const mostActive = [...entitiesWithRates]
          .sort((a, b) => b.totalIntents - a.totalIntents)
          .slice(0, limit);

        // Sort for highest denial rate
        const highestDenialRate = [...entitiesWithRates]
          .sort((a, b) => b.denialRate - a.denialRate)
          .slice(0, limit);

        const response: TopEntitiesResponse = {
          mostActive,
          highestDenialRate,
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch top entities');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch top entities',
          },
        });
      }
    }
  );

  // ==========================================================================
  // Proof Chain Status
  // ==========================================================================

  /**
   * GET /dashboard/proofs/status
   * Returns proof chain status and integrity information
   */
  fastify.get(
    '/dashboard/proofs/status',
    {
      preHandler: rateLimit({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        // Get chain metadata
        const chainMeta = await db
          .select()
          .from(proofChainMeta)
          .where(eq(proofChainMeta.chainId, 'default'))
          .limit(1);

        const meta = chainMeta[0];

        // Get last proof timestamp
        const lastProof = await db
          .select({ createdAt: proofs.createdAt })
          .from(proofs)
          .orderBy(desc(proofs.createdAt))
          .limit(1);

        // Determine chain integrity status
        let integrityStatus: 'valid' | 'invalid' | 'unknown' = 'unknown';
        if (meta?.lastVerifiedAt) {
          // If verified recently (within 24 hours), consider it valid
          const verifiedRecently =
            Date.now() - meta.lastVerifiedAt.getTime() < 24 * 60 * 60 * 1000;
          integrityStatus = verifiedRecently ? 'valid' : 'unknown';
        }

        const response: ProofChainStatusResponse = {
          totalProofs: meta?.chainLength ?? 0,
          chainLength: meta?.chainLength ?? 0,
          chainIntegrity: {
            status: integrityStatus,
            lastVerifiedAt: meta?.lastVerifiedAt?.toISOString() ?? null,
            lastVerifiedPosition: meta?.lastVerifiedPosition ?? null,
            issuesFound: 0, // Would come from verification results
          },
          lastProofAt: lastProof[0]?.createdAt?.toISOString() ?? null,
          merkleAggregation: {
            enabled: false, // Feature flag - set true when implemented
            lastAggregationAt: null,
            pendingProofs: 0,
          },
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch proof chain status');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch proof chain status',
          },
        });
      }
    }
  );

  // ==========================================================================
  // System Health
  // ==========================================================================

  /**
   * GET /dashboard/health/services
   * Returns detailed system health status
   */
  fastify.get(
    '/dashboard/health/services',
    {
      preHandler: rateLimit({ limit: 30, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { sub?: string; roles?: string[] };
      const roles = user?.roles ?? [];

      if (!isAdmin(roles)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Admin role required' },
        });
      }

      try {
        // Check all services
        const [dbHealth, redisHealth, queueHealth] = await Promise.all([
          checkDatabaseHealth(),
          checkRedisHealth(),
          checkQueueHealth(),
        ]);

        const services: ServiceHealth[] = [
          {
            name: 'database',
            status:
              dbHealth.status === 'ok'
                ? 'healthy'
                : dbHealth.status === 'timeout'
                  ? 'degraded'
                  : 'unhealthy',
            latencyMs: dbHealth.latencyMs,
            message: dbHealth.message,
          },
          {
            name: 'redis',
            status:
              redisHealth.status === 'ok'
                ? 'healthy'
                : redisHealth.status === 'timeout'
                  ? 'degraded'
                  : 'unhealthy',
            latencyMs: redisHealth.latencyMs,
            message: redisHealth.message,
          },
          {
            name: 'queues',
            status:
              queueHealth.status === 'ok'
                ? 'healthy'
                : queueHealth.status === 'timeout'
                  ? 'degraded'
                  : 'unhealthy',
            latencyMs: queueHealth.latencyMs,
            message: queueHealth.message,
          },
        ];

        // Get circuit breaker states
        const circuitBreakers: CircuitBreakerStatus[] = [];

        // Get all registered circuit breaker states
        try {
          const cbStatuses = await getAllCircuitBreakerStatuses();
          for (const [name, status] of cbStatuses) {
            circuitBreakers.push({
              name,
              state: status.state.toLowerCase() as 'closed' | 'open' | 'half-open',
              failures: status.failureCount,
              lastFailure: status.lastFailureTime?.toISOString() ?? null,
              nextRetry:
                status.timeUntilReset !== null
                  ? new Date(Date.now() + status.timeUntilReset).toISOString()
                  : null,
            });
          }
        } catch (error) {
          dashboardLogger.warn({ error }, 'Failed to fetch circuit breaker states');
        }

        // Get queue depths from Redis
        const queues: QueueDepth[] = [];
        try {
          const redis = getRedis();
          const queueNames = [
            'intent:intake',
            'intent:evaluate',
            'intent:decision',
            'intent:execute',
            'intent:dead-letter',
          ];

          for (const queueName of queueNames) {
            const [waiting, active, completed, failed, delayed] =
              await Promise.all([
                redis.llen(`bull:${queueName}:wait`).catch(() => 0),
                redis.llen(`bull:${queueName}:active`).catch(() => 0),
                redis.get(`bull:${queueName}:completed`).then((v) => parseInt(v || '0', 10)),
                redis.get(`bull:${queueName}:failed`).then((v) => parseInt(v || '0', 10)),
                redis.zcard(`bull:${queueName}:delayed`).catch(() => 0),
              ]);

            queues.push({
              name: queueName,
              waiting,
              active,
              completed,
              failed,
              delayed,
            });
          }
        } catch (error) {
          dashboardLogger.warn({ error }, 'Failed to fetch queue depths');
        }

        // Get resource usage
        const memUsage = process.memoryUsage();

        // Determine overall health
        const anyUnhealthy = services.some((s) => s.status === 'unhealthy');
        const anyDegraded = services.some((s) => s.status === 'degraded');

        const overall: 'healthy' | 'degraded' | 'unhealthy' = anyUnhealthy
          ? 'unhealthy'
          : anyDegraded
            ? 'degraded'
            : 'healthy';

        const response: SystemHealthResponse = {
          overall,
          services,
          circuitBreakers,
          queues,
          resources: {
            memoryUsageMb: Math.round(memUsage.rss / 1024 / 1024),
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            uptimeSeconds: Math.round(process.uptime()),
          },
          timestamp: new Date().toISOString(),
        };

        return reply.send({
          success: true,
          data: response,
          meta: { requestId: request.id },
        });
      } catch (error) {
        dashboardLogger.error({ error }, 'Failed to fetch system health');
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch system health',
          },
        });
      }
    }
  );

  dashboardLogger.debug('Dashboard routes registered');
}
