/**
 * Sandbox Adversarial Training Boot Camp
 *
 * Structured training gauntlet for T0→T1 trust promotion.
 * Tests Competence (CT-COMP), Reliability (CT-REL), and
 * Observability (CT-OBS) through 21 adversarial challenges.
 *
 * @packageDocumentation
 */

// Core runner
export { BootCampRunner } from "./runner.js";

// Types
export type {
  Challenge,
  ChallengeInput,
  ChallengeEvaluator,
  ChallengeResult,
  ChallengeResponse,
  BootCampSession,
  BootCampAgent,
  BootCampConfig,
  T1Factor,
  ChallengeDifficulty,
  AdversarialType,
  GraduationResult,
  GraduationCriteria,
  FactorGraduationResult,
} from "./types.js";

// Constants
export {
  T1_FACTORS,
  DIFFICULTY_ORDER,
  DIFFICULTY_WEIGHTS,
  FACTOR_TO_SIGNAL,
} from "./types.js";

// Challenge catalog
export { CHALLENGE_CATALOG, getChallengesByFactor } from "./challenges.js";

// Scoring
export {
  challengeToTrustSignal,
  challengeToAttestation,
  calculateWeightedScore,
  calculateTotalWeightedScore,
} from "./scorer.js";
export type { BootCampAttestation } from "./scorer.js";

// Graduation
export {
  evaluateGraduation,
  DEFAULT_GRADUATION_CRITERIA,
} from "./graduation.js";

// Promotion Service (boot camp → trust engine pipeline)
export { PromotionService } from "./promotion-service.js";
export type {
  PromotionResult,
  PromotionServiceConfig,
} from "./promotion-service.js";
