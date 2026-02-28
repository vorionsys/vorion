/**
 * @vorionsys/shared-constants
 *
 * Single source of truth for the Vorion ecosystem
 *
 * This package provides shared constants, types, and helper functions
 * that ensure consistency across all Vorion products and sites:
 *
 * - Trust tiers and thresholds (T0-T7)
 * - Domain and URL configuration
 * - Capability definitions
 *
 * @example
 * ```typescript
 * import {
 *   TrustTier,
 *   TIER_THRESHOLDS,
 *   scoreToTier,
 *   API_ENDPOINTS,
 *   CAPABILITIES,
 * } from '@vorionsys/shared-constants';
 *
 * // Get tier from score
 * const tier = scoreToTier(750); // TrustTier.T4_STANDARD
 *
 * // Get tier info
 * const info = TIER_THRESHOLDS[TrustTier.T4_STANDARD];
 * console.log(info.name); // "Standard"
 * console.log(info.min, info.max); // 650, 799
 *
 * // Get API endpoint
 * const apiUrl = API_ENDPOINTS.cognigate.production;
 * // "https://cognigate.dev/v1"
 * ```
 *
 * @see https://basis.vorion.org
 * @see https://vorion.org
 */

// =============================================================================
// TRUST TIERS
// =============================================================================

export {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier,
  getTierThreshold,
  getTierName,
  getTierColor,
  getTierMinScore,
  getTierMaxScore,
  getTierCode,
  meetsTierRequirement,
  parseTier,
  ALL_TIERS,
  type TierThreshold,
  type TrustTierName,
  type TrustTierCode,
} from "./tiers.js";

// =============================================================================
// DOMAINS & URLS
// =============================================================================

export {
  VORION_DOMAINS,
  AGENTANCHOR_DOMAINS,
  COGNIGATE_DOMAINS,
  API_ENDPOINTS,
  VORION_EMAILS,
  AGENTANCHOR_EMAILS,
  GITHUB,
  NPM_PACKAGES,
  ALL_DOMAINS,
  DOMAIN_ALIASES,
  type VorionDomain,
  type AgentAnchorDomain,
  type CognigateDomain,
} from "./domains.js";

// =============================================================================
// CAPABILITIES
// =============================================================================

export {
  CapabilityCategory,
  CAPABILITIES,
  getCapabilitiesForTier,
  getCapability,
  isCapabilityAvailable,
  getCapabilityMinTier,
  getCapabilitiesByCategory,
  getAllCapabilityCodes,
  type CapabilityDefinition,
} from "./capabilities.js";

// =============================================================================
// PRODUCTS
// =============================================================================

export {
  ProductCategory,
  ProductStatus,
  VORION_PRODUCTS,
  AGENTANCHOR_PRODUCTS,
  ALL_PRODUCTS,
  getProduct,
  getProductsByCategory,
  getProductsByStatus,
  getProductsByOrganization,
  type ProductDefinition,
} from "./products.js";

// =============================================================================
// RATE LIMITS & QUOTAS
// =============================================================================

export {
  RATE_LIMITS,
  TIER_QUOTAS,
  getRateLimits,
  getMinTierForLimits,
  wouldExceedLimit,
  formatRateLimit,
  getQuota,
  isUnlimited,
  type RateLimitConfig,
  type QuotaConfig,
} from "./rate-limits.js";

// =============================================================================
// ERROR CODES
// =============================================================================

export {
  ErrorCategory,
  AUTH_ERRORS,
  VALIDATION_ERRORS,
  RATE_LIMIT_ERRORS,
  NOT_FOUND_ERRORS,
  TRUST_ERRORS,
  SERVER_ERRORS,
  EXTERNAL_ERRORS,
  ERROR_CODES,
  getErrorByCode,
  getErrorsByCategory,
  getRetryableErrors,
  formatErrorMessage,
  createErrorResponse,
  type ErrorDefinition,
  type ErrorCode,
} from "./error-codes.js";

// =============================================================================
// API VERSIONS
// =============================================================================

export {
  VersionStatus,
  COGNIGATE_VERSIONS,
  COGNIGATE_CURRENT_VERSION,
  COGNIGATE_DEFAULT_VERSION,
  TRUST_API_VERSIONS,
  TRUST_CURRENT_VERSION,
  LOGIC_API_VERSIONS,
  LOGIC_CURRENT_VERSION,
  BASIS_VERSIONS,
  BASIS_CURRENT_VERSION,
  BASIS_SPEC_VERSION,
  CAR_SPEC_VERSIONS,
  CAR_SPEC_CURRENT_VERSION,
  API_VERSIONS,
  getCurrentVersion,
  getVersionDefinition,
  isVersionSupported,
  isVersionDeprecated,
  getStableVersions,
  buildApiUrl,
  VERSION_HEADERS,
  type ApiVersionDefinition,
} from "./api-versions.js";

// =============================================================================
// THEMES
// =============================================================================

export {
  ACTIVE_THEME,
  THEMES,
  getActiveTheme,
  getAllThemeIds,
  themeToCssVars,
  type ThemeId,
  type ThemeTokens,
} from "./themes.js";

// =============================================================================
// CAR CATEGORIES
// =============================================================================

export {
  CARCategory,
  CAR_CATEGORIES,
  getCARCategory,
  getCARCategoriesForTier,
  getHighRiskCategories,
  isCARCategoryAvailable,
  getCARCategoryMinTier,
  getCARSubcategory,
  getParentCategory,
  getAllCARCategoryCodes,
  getAllCARSubcategoryCodes,
  isValidCARCategory,
  isValidCARSubcategory,
  type TrustDimension,
  type CARSubcategory,
  type CARCategoryDefinition,
} from "./car-categories.js";

// =============================================================================
// PACKAGE VERSION
// =============================================================================

/** Package version */
export const VERSION = "1.0.2";

/** Last updated date */
export const LAST_UPDATED = "2026-02-16";
