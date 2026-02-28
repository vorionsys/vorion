/**
 * @fileoverview CAR Types Module
 *
 * Comprehensive type definitions and utilities for the Categorical Agent
 * Registry (CAR) specification, integrated with the Vorion Platform.
 *
 * This module provides:
 * - CAR string parsing and generation
 * - Domain codes and bitmask operations
 * - Capability levels (L0-L7)
 * - Certification tiers (external attestation)
 * - Runtime tiers (deployment autonomy)
 * - Attestation types and verification
 * - Agent identity types
 * - JWT claims for OIDC integration
 * - Effective permission calculation
 * - Cross-system mappings
 *
 * @example
 * ```typescript
 * import {
 *   parseCAR,
 *   generateCAR,
 *   CapabilityLevel,
 *   CertificationTier,
 *   RuntimeTier,
 *   calculateEffectivePermission,
 * } from '@vorionsys/contracts/car';
 *
 * // Parse a CAR string
 * const parsed = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');
 *
 * // Generate a CAR string (trust is NOT embedded - computed at runtime)
 * const car = generateCAR({
 *   registry: 'a3i',
 *   organization: 'acme-corp',
 *   agentClass: 'invoice-bot',
 *   domains: ['A', 'B', 'F'],
 *   level: CapabilityLevel.L3_EXECUTE,
 *   version: '1.0.0',
 * });
 * // Result: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'
 *
 * // Calculate effective permission
 * const permission = calculateEffectivePermission({
 *   certificationTier: CertificationTier.T3_MONITORED,
 *   competenceLevel: CapabilityLevel.L4_STANDARD,
 *   runtimeTier: RuntimeTier.T3_MONITORED,
 *   observabilityCeiling: 4,
 *   contextPolicyCeiling: 3,
 * });
 * ```
 *
 * @module @vorionsys/contracts/car
 * @packageDocumentation
 */

// ============================================================================
// Domain Codes and Bitmask
// ============================================================================

export {
  // Types
  type DomainCode,
  type DomainDefinition,
  // Constants
  DOMAIN_CODES,
  CAPABILITY_DOMAINS,
  DOMAIN_NAMES,
  ALL_DOMAINS_BITMASK,
  // Functions
  encodeDomains,
  decodeDomains,
  parseDomainString,
  formatDomainString,
  hasDomains,
  satisfiesDomainRequirements,
  intersectDomains,
  unionDomains,
  differenceDomains,
  getDomainDefinition,
  getDomainName,
  getDomainBit,
  countDomains,
  isDomainCode,
  isDomainCodeArray,
  // Zod Schemas
  domainCodeSchema,
  domainDefinitionSchema,
  domainCodeArraySchema,
  domainBitmaskSchema,
  domainStringSchema,
} from "./domains.js";

// ============================================================================
// Skill Codes and Bitmask
// ============================================================================

export {
  // Types
  type SkillCode,
  type SkillCategory,
  type SkillDefinition,
  // Constants
  SKILL_CODES,
  SKILL_DEFINITIONS,
  SKILL_NAMES,
  ALL_SKILLS_BITMASK,
  SKILLS_BY_CATEGORY,
  LEGACY_ID_TO_SKILL,
  // Functions
  encodeSkills,
  decodeSkills,
  parseSkillString,
  formatSkillString,
  hasSkills,
  satisfiesSkillRequirements,
  intersectSkills,
  unionSkills,
  differenceSkills,
  getSkillDefinition,
  getSkillName,
  getSkillBit,
  getSkillCategory,
  getSkillsInCategory,
  countSkills,
  isSkillCode,
  isSkillCodeArray,
  legacyIdToSkillCode,
  legacyIdsToSkillCodes,
  // Zod Schemas
  skillCodeSchema,
  skillDefinitionSchema,
  skillCodeArraySchema,
  skillBitmaskSchema,
  skillStringSchema,
} from "./skills.js";

// ============================================================================
// Capability Levels (L0-L7)
// ============================================================================

export {
  // Types/Enums
  CapabilityLevel,
  type CapabilityLevelConfig,
  // Constants
  CAPABILITY_LEVELS,
  CAPABILITY_LEVEL_NAMES,
  CAPABILITY_LEVEL_CODES,
  CAPABILITY_LEVEL_DESCRIPTIONS,
  CAPABILITY_LEVEL_ABILITIES,
  CAPABILITY_LEVEL_CONFIGS,
  // Functions
  isLevelHigher,
  meetsLevel,
  compareLevels,
  minLevel,
  maxLevel,
  clampLevel,
  getLevelConfig,
  getLevelName,
  getLevelCode,
  getLevelDescription,
  hasAbility,
  requiresApproval,
  canOperateAutonomously,
  parseLevel,
  tryParseLevel,
  isCapabilityLevel,
  // Zod Schemas
  capabilityLevelSchema,
  capabilityLevelConfigSchema,
  levelStringSchema,
} from "./levels.js";

// ============================================================================
// Certification and Runtime Tiers (T0-T7)
// ============================================================================

export {
  // Types/Enums
  CertificationTier,
  RuntimeTier,
  type CertificationTierConfig,
  type RuntimeTierConfig,
  // Constants
  CERTIFICATION_TIERS,
  RUNTIME_TIERS,
  CERTIFICATION_TIER_NAMES,
  RUNTIME_TIER_NAMES,
  CERTIFICATION_TIER_DESCRIPTIONS,
  RUNTIME_TIER_DESCRIPTIONS,
  CERTIFICATION_TIER_SCORES,
  RUNTIME_TIER_SCORES,
  CERTIFICATION_TIER_CONFIGS,
  RUNTIME_TIER_CONFIGS,
  // Functions
  isCertificationTierHigher,
  meetsCertificationTier,
  compareCertificationTiers,
  isRuntimeTierHigher,
  meetsRuntimeTier,
  compareRuntimeTiers,
  scoreToCertificationTier,
  scoreToRuntimeTier,
  certificationTierToScore,
  runtimeTierToScore,
  getCertificationTierMinScore,
  getCertificationTierMaxScore,
  getRuntimeTierMinScore,
  getRuntimeTierMaxScore,
  getCertificationTierConfig,
  getRuntimeTierConfig,
  getCertificationTierName,
  getRuntimeTierName,
  getCertificationTierDescription,
  getRuntimeTierDescription,
  parseCertificationTier,
  parseRuntimeTier,
  isCertificationTier,
  isRuntimeTier,
  // Zod Schemas
  certificationTierSchema,
  runtimeTierSchema,
  certificationTierConfigSchema,
  runtimeTierConfigSchema,
  tierStringSchema,
  certificationTierStringSchema,
  runtimeTierStringSchema,
} from "./tiers.js";

// ============================================================================
// CAR String Parser and Generator
// ============================================================================

export {
  // Types
  type ParsedCAR,
  type ParsedACI, // deprecated alias
  type CARIdentity,
  type ACIIdentity, // deprecated alias
  type CARParseErrorCode,
  type ACIParseErrorCode, // deprecated alias
  type GenerateCAROptions,
  type GenerateACIOptions, // deprecated alias
  type CARValidationError,
  type ACIValidationError, // deprecated alias
  type CARValidationWarning,
  type ACIValidationWarning, // deprecated alias
  type CARValidationResult,
  type ACIValidationResult, // deprecated alias
  // Constants
  CAR_REGEX,
  CAR_PARTIAL_REGEX,
  CAR_LEGACY_REGEX,
  ACI_REGEX, // deprecated alias
  ACI_PARTIAL_REGEX, // deprecated alias
  ACI_LEGACY_REGEX, // deprecated alias
  // Classes
  CARParseError,
  ACIParseError, // deprecated alias
  // Functions
  parseCAR,
  parseACI, // deprecated alias
  parseLegacyCAR,
  parseLegacyACI, // deprecated alias
  tryParseCAR,
  tryParseACI, // deprecated alias
  safeParseCAR,
  safeParseACI, // deprecated alias
  generateCAR,
  generateACI, // deprecated alias
  generateCARString,
  generateACIString, // deprecated alias
  validateCAR,
  validateACI, // deprecated alias
  isValidCAR,
  isValidACI, // deprecated alias
  isCARString,
  isACIString, // deprecated alias
  updateCAR,
  updateACI, // deprecated alias
  addCARExtensions,
  addACIExtensions, // deprecated alias
  removeCARExtensions,
  removeACIExtensions, // deprecated alias
  incrementCARVersion,
  incrementACIVersion, // deprecated alias
  getCARIdentity,
  getACIIdentity, // deprecated alias
  // Zod Schemas
  parsedCARSchema,
  parsedACISchema, // deprecated alias
  carStringSchema,
  aciStringSchema, // deprecated alias
  carSchema,
  aciSchema, // deprecated alias
  generateCAROptionsSchema,
  generateACIOptionsSchema, // deprecated alias
  carValidationErrorSchema,
  aciValidationErrorSchema, // deprecated alias
  carValidationWarningSchema,
  aciValidationWarningSchema, // deprecated alias
  carValidationResultSchema,
  aciValidationResultSchema, // deprecated alias
} from "./car-string.js";

// ============================================================================
// Attestation Types
// ============================================================================

export {
  // Types
  type AttestationScope,
  type AttestationStatus,
  type AttestationEvidence,
  type AttestationProof,
  type Attestation,
  type AttestationVerificationResult,
  type AttestationVerificationError,
  type AttestationVerificationErrorCode,
  type AttestationVerificationWarning,
  type CreateAttestationOptions,
  // Constants
  ATTESTATION_SCOPES,
  ATTESTATION_SCOPE_DESCRIPTIONS,
  // Functions
  createAttestation,
  verifyAttestation,
  isAttestationValid,
  getAttestationRemainingValidity,
  attestationCoversDomain,
  isAttestationScope,
  isAttestationStatus,
  // Zod Schemas
  attestationScopeSchema,
  attestationStatusSchema,
  attestationEvidenceSchema,
  attestationProofSchema,
  attestationSchema,
  attestationVerificationErrorSchema,
  attestationVerificationWarningSchema,
  attestationVerificationResultSchema,
} from "./attestation.js";

// ============================================================================
// Agent Identity Types
// ============================================================================

export {
  // Types
  type CapabilityVector,
  type AgentMetadata,
  type VerificationMethod,
  type ServiceEndpoint,
  type AgentIdentity,
  type AgentIdentitySummary,
  type AgentRegistrationOptions,
  type AgentMatchCriteria,
  type SupervisionContext,
  type FloatingCARReferences,
  // Constants
  MAX_SUPERVISION_ELEVATION,
  // Functions
  createAgentIdentity,
  toAgentIdentitySummary,
  matchesAgentCriteria,
  capabilityVectorSatisfies,
  isCapabilityVector,
  isAgentIdentity,
  isAgentIdentitySummary,
  isSupervisionActive,
  calculateSupervisedTier,
  validateSupervisionElevation,
  // Zod Schemas
  capabilityVectorSchema,
  agentMetadataSchema,
  verificationMethodSchema,
  serviceEndpointSchema,
  agentIdentitySchema,
  agentIdentitySummarySchema,
  agentRegistrationOptionsSchema,
  agentMatchCriteriaSchema,
  supervisionContextSchema,
  floatingCARReferencesSchema,
} from "./identity.js";

// ============================================================================
// JWT Claims (OpenID Connect)
// ============================================================================

export {
  // Types
  type StandardJWTClaims,
  type CARJWTClaims,
  type ACIJWTClaims, // deprecated alias
  type CARAttestationClaim,
  type ACIAttestationClaim, // deprecated alias
  type CARConstraintsClaim,
  type ACIConstraintsClaim, // deprecated alias
  type JWTClaimsValidationError,
  type JWTClaimsErrorCode,
  type JWTClaimsValidationResult,
  type GenerateJWTClaimsOptions,
  // Functions
  generateJWTClaims,
  generateMinimalJWTClaims,
  validateJWTClaims,
  extractCapabilityFromClaims,
  extractIdentityFromClaims,
  claimsHaveDomain,
  claimsMeetRequirements,
  // Zod Schemas
  standardJWTClaimsSchema,
  carAttestationClaimSchema,
  aciAttestationClaimSchema, // deprecated alias
  carConstraintsClaimSchema,
  aciConstraintsClaimSchema, // deprecated alias
  carJWTClaimsSchema,
  aciJWTClaimsSchema, // deprecated alias
  jwtClaimsValidationOptionsSchema,
  jwtClaimsValidationErrorSchema,
  jwtClaimsValidationResultSchema,
} from "./jwt-claims.js";

// ============================================================================
// Effective Permission Calculation
// ============================================================================

export {
  // Types
  type EffectivePermissionContext,
  type EffectivePermission,
  type ConstrainingFactor,
  type PermissionCeilings,
  type PermissionCheckResult,
  type SupervisionElevation,
  // Functions
  calculateEffectivePermission,
  permissionAllowsLevel,
  contextAllowsLevel,
  checkPermission,
  modifyContextCeiling,
  calculateRequiredChanges,
  createDefaultContext,
  createMaxPermissionContext,
  isEffectivePermissionContext,
  isEffectivePermission,
  // Zod Schemas
  effectivePermissionContextSchema,
  constrainingFactorSchema,
  permissionCeilingsSchema,
  effectivePermissionSchema,
  permissionCheckResultSchema,
  supervisionElevationSchema,
} from "./effective-permission.js";

// ============================================================================
// Cross-System Mappings
// ============================================================================

export {
  // Types
  type VorionNamespace,
  type BidirectionalMap,
  TrustBand,
  // Constants
  VORION_NAMESPACES,
  DOMAIN_TO_NAMESPACE_MAP,
  NAMESPACE_TO_DOMAIN_MAP,
  CERTIFICATION_TO_RUNTIME_TIER_MAP,
  RUNTIME_TO_CERTIFICATION_TIER_MAP,
  domainNamespaceMap,
  certificationRuntimeMap,
  // Functions
  certificationTierToRuntimeTier,
  runtimeTierToCertificationTier,
  trustBandToCertificationTier,
  trustBandToRuntimeTier,
  certificationTierToTrustBand,
  runtimeTierToTrustBand,
  scoreToBothTiers,
  normalizeScoreBetweenScales,
  carIdDomainToVorionNamespace,
  vorionNamespaceToCarIdDomain,
  carIdDomainsToVorionNamespaces,
  vorionNamespacesToCarIdDomains,
  capabilityLevelToAutonomyDescription,
  capabilityLevelToMinRuntimeTier,
  createBidirectionalMap,
  isVorionNamespace,
  isTrustBand,
  // Zod Schemas
  trustBandSchema,
  vorionNamespaceSchema,
  tierMappingResultSchema,
  domainMappingResultSchema,
} from "./mapping.js";
