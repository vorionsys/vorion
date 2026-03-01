/**
 * Zod schemas for trust profile types
 */

import { z } from 'zod';
import { observationTierSchema, trustBandSchema } from './enums.js';
import type { TrustFactorScores, TrustProfile, TrustEvidence } from '../v2/trust-profile.js';

/** Factor score range validator (0.0 to 1.0) */
const factorScoreSchema = z.number().min(0).max(1);

/** Trust factor scores validator - record of factor codes to scores */
export const trustFactorScoresSchema = z.record(
  z.string(),
  factorScoreSchema
) satisfies z.ZodType<TrustFactorScores>;

/** Composite score range validator (0-1000) */
const compositeScoreSchema = z.number().min(0).max(1000);

/** Trust evidence validator */
export const trustEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  factorCode: z.string().min(1),
  impact: z.number().min(-1000).max(1000),
  source: z.string().min(1),
  collectedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  evidenceType: z.enum([
    'automated',
    'hitl_approval',
    'hitl_rejection',
    'examination',
    'audit',
    'sandbox_test',
    'peer_review',
  ]).optional(),
  metadata: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<TrustEvidence>;

/** Trust profile validator */
export const trustProfileSchema = z.object({
  profileId: z.string().uuid(),
  agentId: z.string().uuid(),
  factorScores: trustFactorScoresSchema,
  compositeScore: compositeScoreSchema,
  observationTier: observationTierSchema,
  adjustedScore: compositeScoreSchema,
  band: trustBandSchema,
  calculatedAt: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  evidence: z.array(trustEvidenceSchema),
  version: z.number().int().min(0),
}) satisfies z.ZodType<TrustProfile>;

/** Trust calculation request validator */
export const trustCalculationRequestSchema = z.object({
  agentId: z.string().uuid(),
  observationTier: observationTierSchema,
  evidence: z.array(trustEvidenceSchema),
});

// Type inference from schemas
export type ValidatedTrustFactorScores = z.infer<typeof trustFactorScoresSchema>;
export type ValidatedTrustEvidence = z.infer<typeof trustEvidenceSchema>;
export type ValidatedTrustProfile = z.infer<typeof trustProfileSchema>;
export type ValidatedTrustCalculationRequest = z.infer<typeof trustCalculationRequestSchema>;
