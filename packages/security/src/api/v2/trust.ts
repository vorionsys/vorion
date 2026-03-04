/**
 * API v2 Trust Routes
 *
 * 16-factor trust model endpoints providing granular factor-level breakdowns,
 * tier-aware gating analysis, and backward-compatible legacy component shapes.
 *
 * Replaces the deprecated 4-bucket TrustComponents model from v1 with
 * per-factor scores drawn from @vorionsys/basis.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  createTrustEngine,
  type TrustRecord,
  TRUST_LEVEL_NAMES,
  TRUST_THRESHOLDS,
} from '../../trust-engine/index.js';
import { ForbiddenError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { rateLimitPerTenant } from '../middleware/rateLimit.js';
import type { TrustLevel, TrustScore, TrustComponents } from '../../common/types.js';
import {
  FACTOR_CODE_LIST,
  FACTOR_THRESHOLDS_BY_TIER,
  FACTOR_GROUPS,
  CORE_FACTORS,
  TrustTier,
  type FactorThreshold,
  getCriticalFactorsForTier,
} from '@vorionsys/basis';

const trustLogger = createLogger({ component: 'api-v2-trust' });
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

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Standard API response envelope (v2)
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
    apiVersion: 'v2';
  };
}

/**
 * A single factor within a group breakdown
 */
interface FactorDetail {
  code: string;
  name: string;
  score: number;
  weight: number;
  tier: string;
  requiredFrom: number;
  meetsCurrentThreshold: boolean;
  meetsNextThreshold: boolean;
  currentThreshold: number;
  nextThreshold: number | null;
}

/**
 * A group of factors with aggregate score
 */
interface FactorGroupResponse {
  factors: FactorDetail[];
  groupScore: number;
}

/**
 * Tier requirements info
 */
interface TierRequirements {
  currentTier: {
    name: string;
    minScore: number;
  };
  nextTier: {
    name: string;
    minScore: number;
    gatingFactors: string[];
  } | null;
}

/**
 * Full trust score response (v2) with 16-factor breakdown
 */
interface TrustScoreV2Response {
  entityId: string;
  score: TrustScore;
  level: TrustLevel;
  levelName: string;
  factorScores: Record<string, number>;
  factorGroups: {
    foundation: FactorGroupResponse;
    security: FactorGroupResponse;
    agency: FactorGroupResponse;
    maturity: FactorGroupResponse;
    evolution: FactorGroupResponse;
  };
  tierRequirements: TierRequirements;
  /** @deprecated Included for backward compatibility with v1 consumers */
  components: TrustComponents;
  updatedAt: string;
}

/**
 * Factor detail response for /factors endpoint
 */
interface FactorDetailResponse {
  entityId: string;
  score: TrustScore;
  level: TrustLevel;
  levelName: string;
  factors: FactorDetail[];
  totalFactors: number;
  meetingThreshold: number;
  belowThreshold: number;
  updatedAt: string;
}

/**
 * Gating analysis response for /gating endpoint
 */
interface GatingAnalysisResponse {
  entityId: string;
  score: TrustScore;
  level: TrustLevel;
  levelName: string;
  currentTier: {
    name: string;
    tier: number;
    minScore: number;
    maxScore: number;
  };
  nextTier: {
    name: string;
    tier: number;
    minScore: number;
    maxScore: number;
    scoreGap: number;
    gatingFactors: GatingFactor[];
    criticalFactorsRequired: string[];
    promotionReady: boolean;
  } | null;
  updatedAt: string;
}

/**
 * A factor that is blocking promotion to the next tier
 */
interface GatingFactor {
  code: string;
  name: string;
  currentScore: number;
  requiredMinimum: number;
  gap: number;
  critical: boolean;
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
    meta: { requestId, timestamp: new Date().toISOString(), apiVersion: 'v2' },
  };
}

/**
 * Create success response
 */
function successResponse<T>(data: T, requestId: string): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: { requestId, timestamp: new Date().toISOString(), apiVersion: 'v2' },
  };
}

/**
 * Map a TrustLevel (0-7) to the corresponding TrustTier enum
 */
function levelToTrustTier(level: TrustLevel): TrustTier {
  return level as number as TrustTier;
}

/**
 * Get the factor name from its code string (e.g. 'CT-COMP' -> 'Competence')
 */
function getFactorName(code: string): string {
  // Convert dash-format to underscore key: 'CT-COMP' -> 'CT_COMP'
  const key = code.replace('-', '_') as keyof typeof CORE_FACTORS;
  return CORE_FACTORS[key]?.name ?? code;
}

/**
 * Get the factor tier label from its code string
 */
function getFactorTierLabel(code: string): string {
  const key = code.replace('-', '_') as keyof typeof CORE_FACTORS;
  const factor = CORE_FACTORS[key];
  if (!factor) return 'unknown';
  switch (factor.tier as number) {
    case 1: return 'foundational';
    case 2: return 'operational';
    case 3: return 'sophisticated';
    case 4: return 'life_critical';
    default: return 'unknown';
  }
}

/**
 * Get the trust tier the factor is first required from
 */
function getFactorRequiredFrom(code: string): number {
  const key = code.replace('-', '_') as keyof typeof CORE_FACTORS;
  return CORE_FACTORS[key]?.requiredFrom ?? 0;
}

/**
 * Build a FactorDetail for a given factor code
 */
function buildFactorDetail(
  code: string,
  factorScores: Record<string, number>,
  currentTier: TrustTier,
  nextTier: TrustTier | null
): FactorDetail {
  const score = factorScores[code] ?? 0;
  const currentThresholds = FACTOR_THRESHOLDS_BY_TIER[currentTier];
  const currentThreshold: FactorThreshold | undefined = currentThresholds?.[code];
  const nextThresholds = nextTier !== null ? FACTOR_THRESHOLDS_BY_TIER[nextTier] : null;
  const nextThreshold: FactorThreshold | undefined = nextThresholds?.[code] ?? undefined;

  return {
    code,
    name: getFactorName(code),
    score,
    weight: currentThreshold?.weight ?? 1,
    tier: getFactorTierLabel(code),
    requiredFrom: getFactorRequiredFrom(code),
    meetsCurrentThreshold: currentThreshold ? score >= currentThreshold.minimum : true,
    meetsNextThreshold: nextThreshold ? score >= nextThreshold.minimum : true,
    currentThreshold: currentThreshold?.minimum ?? 0,
    nextThreshold: nextThreshold?.minimum ?? null,
  };
}

/**
 * Calculate the average score for a group of factor codes
 */
function calculateGroupScore(
  factorCodes: readonly string[],
  factorScores: Record<string, number>
): number {
  if (factorCodes.length === 0) return 0;
  const total = factorCodes.reduce((sum, code) => {
    // Factor codes in FACTOR_GROUPS use underscore format (CT_COMP);
    // factorScores uses dash format (CT-COMP). Normalize.
    const dashCode = code.replace('_', '-');
    return sum + (factorScores[dashCode] ?? 0);
  }, 0);
  return Math.round((total / factorCodes.length) * 1000) / 1000;
}

/**
 * Build the factorGroups object for the response
 */
function buildFactorGroups(
  factorScores: Record<string, number>,
  currentTier: TrustTier,
  nextTier: TrustTier | null
): TrustScoreV2Response['factorGroups'] {
  const buildGroup = (groupKey: string): FactorGroupResponse => {
    const group = FACTOR_GROUPS[groupKey];
    if (!group) {
      return { factors: [], groupScore: 0 };
    }
    const factors = group.factors.map((factorKey) => {
      // Convert underscore key to dash code: CT_COMP -> CT-COMP
      const dashCode = factorKey.replace('_', '-');
      return buildFactorDetail(dashCode, factorScores, currentTier, nextTier);
    });
    const groupScore = calculateGroupScore(group.factors, factorScores);
    return { factors, groupScore };
  };

  return {
    foundation: buildGroup('FOUNDATION'),
    security: buildGroup('SECURITY'),
    agency: buildGroup('AGENCY'),
    maturity: buildGroup('MATURITY'),
    evolution: buildGroup('EVOLUTION'),
  };
}

/**
 * Build tier requirements including gating factors for the next tier
 */
function buildTierRequirements(
  level: TrustLevel,
  factorScores: Record<string, number>
): TierRequirements {
  const currentTier = levelToTrustTier(level);
  const currentThresholdRange = TRUST_THRESHOLDS[level];

  const currentTierInfo = {
    name: TRUST_LEVEL_NAMES[level],
    minScore: currentThresholdRange.min,
  };

  // If at max tier, there is no next tier
  if (level >= 7) {
    return { currentTier: currentTierInfo, nextTier: null };
  }

  const nextLevel = (level + 1) as TrustLevel;
  const nextTier = levelToTrustTier(nextLevel);
  const nextThresholdRange = TRUST_THRESHOLDS[nextLevel];
  const nextThresholds = FACTOR_THRESHOLDS_BY_TIER[nextTier];

  // Find factors that are gating (below the next tier's minimum AND critical)
  const gatingFactors: string[] = [];
  for (const code of FACTOR_CODE_LIST) {
    const threshold = nextThresholds?.[code];
    if (!threshold) continue;
    const score = factorScores[code] ?? 0;
    if (threshold.critical && score < threshold.minimum) {
      gatingFactors.push(code);
    }
  }

  return {
    currentTier: currentTierInfo,
    nextTier: {
      name: TRUST_LEVEL_NAMES[nextLevel],
      minScore: nextThresholdRange.min,
      gatingFactors,
    },
  };
}

/**
 * Find all factors gating promotion to the next tier with detailed gap analysis
 */
function buildGatingAnalysis(
  level: TrustLevel,
  score: TrustScore,
  factorScores: Record<string, number>
): GatingAnalysisResponse['nextTier'] {
  if (level >= 7) return null;

  const nextLevel = (level + 1) as TrustLevel;
  const nextTier = levelToTrustTier(nextLevel);
  const nextThresholdRange = TRUST_THRESHOLDS[nextLevel];
  const nextThresholds = FACTOR_THRESHOLDS_BY_TIER[nextTier];

  const gatingFactors: GatingFactor[] = [];

  for (const code of FACTOR_CODE_LIST) {
    const threshold = nextThresholds?.[code];
    if (!threshold) continue;

    const currentScore = factorScores[code] ?? 0;
    if (currentScore < threshold.minimum) {
      gatingFactors.push({
        code,
        name: getFactorName(code),
        currentScore,
        requiredMinimum: threshold.minimum,
        gap: Math.round((threshold.minimum - currentScore) * 1000) / 1000,
        critical: threshold.critical,
      });
    }
  }

  const criticalFactorsRequired = getCriticalFactorsForTier(nextTier);
  const scoreGap = Math.max(0, nextThresholdRange.min - score);

  // Promotion is ready only if score is sufficient AND no critical factors are gating
  const criticalGating = gatingFactors.filter((f) => f.critical);
  const promotionReady = scoreGap === 0 && criticalGating.length === 0;

  return {
    name: TRUST_LEVEL_NAMES[nextLevel],
    tier: nextLevel,
    minScore: nextThresholdRange.min,
    maxScore: nextThresholdRange.max,
    scoreGap,
    gatingFactors,
    criticalFactorsRequired,
    promotionReady,
  };
}

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

/**
 * Register v2 trust routes
 *
 * All routes are prefixed with /trust and expect the Fastify instance to be
 * mounted under /api/v2 by the parent plugin.
 */
export async function registerTrustRoutesV2(fastify: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /trust/:entityId - Full 16-factor trust breakdown
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

      const currentTier = levelToTrustTier(trustRecord.level);
      const nextTier = trustRecord.level < 7 ? levelToTrustTier((trustRecord.level + 1) as TrustLevel) : null;

      const responseData: TrustScoreV2Response = {
        entityId: trustRecord.entityId,
        score: trustRecord.score,
        level: trustRecord.level,
        levelName: TRUST_LEVEL_NAMES[trustRecord.level],
        factorScores: trustRecord.factorScores,
        factorGroups: buildFactorGroups(trustRecord.factorScores, currentTier, nextTier),
        tierRequirements: buildTierRequirements(trustRecord.level, trustRecord.factorScores),
        components: trustRecord.components,
        updatedAt: trustRecord.lastCalculatedAt,
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/:entityId/factors - Factor detail with thresholds
  // Rate limit: 100 requests per minute per tenant
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId/factors',
    {
      preHandler: rateLimitPerTenant({ limit: 100, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});

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

      const currentTier = levelToTrustTier(trustRecord.level);
      const nextTier = trustRecord.level < 7 ? levelToTrustTier((trustRecord.level + 1) as TrustLevel) : null;

      const factors: FactorDetail[] = FACTOR_CODE_LIST.map((code) =>
        buildFactorDetail(code, trustRecord.factorScores, currentTier, nextTier)
      );

      const meetingThreshold = factors.filter((f) => f.meetsCurrentThreshold).length;
      const belowThreshold = factors.filter((f) => !f.meetsCurrentThreshold).length;

      const responseData: FactorDetailResponse = {
        entityId: trustRecord.entityId,
        score: trustRecord.score,
        level: trustRecord.level,
        levelName: TRUST_LEVEL_NAMES[trustRecord.level],
        factors,
        totalFactors: FACTOR_CODE_LIST.length,
        meetingThreshold,
        belowThreshold,
        updatedAt: trustRecord.lastCalculatedAt,
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  // ---------------------------------------------------------------------------
  // GET /trust/:entityId/gating - What's blocking promotion to next tier
  // Rate limit: 50 requests per minute per tenant (analysis endpoint)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/trust/:entityId/gating',
    {
      preHandler: rateLimitPerTenant({ limit: 50, windowSeconds: 60 }),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = await getTenantId(request);
      const params = entityIdParamsSchema.parse(request.params ?? {});

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

      const currentThresholdRange = TRUST_THRESHOLDS[trustRecord.level];

      const responseData: GatingAnalysisResponse = {
        entityId: trustRecord.entityId,
        score: trustRecord.score,
        level: trustRecord.level,
        levelName: TRUST_LEVEL_NAMES[trustRecord.level],
        currentTier: {
          name: TRUST_LEVEL_NAMES[trustRecord.level],
          tier: trustRecord.level,
          minScore: currentThresholdRange.min,
          maxScore: currentThresholdRange.max,
        },
        nextTier: buildGatingAnalysis(trustRecord.level, trustRecord.score, trustRecord.factorScores),
        updatedAt: trustRecord.lastCalculatedAt,
      };

      return reply.send(successResponse(responseData, request.id));
    }
  );

  trustLogger.debug('Trust v2 routes registered');
}
