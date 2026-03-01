# @vorionsys/shared-constants

Single source of truth for the Vorion ecosystem -- canonical trust tiers, domain configuration, capability definitions, rate limits, error codes, API versions, product catalog, and UI themes.

## Installation

```bash
npm install @vorionsys/shared-constants
```

## What This Package Provides

| Module | Description |
|--------|-------------|
| **Tiers** | The BASIS 8-tier trust model (T0-T7) with score ranges, names, colors, and helper functions |
| **Domains** | All Vorion, Agent Anchor, and Cognigate domains, API endpoints, emails, GitHub links, and npm package names |
| **Capabilities** | Tier-gated capability definitions with categories and constraint metadata |
| **Products** | Product catalog for both Vorion (open source) and Agent Anchor (commercial) with status and version info |
| **Rate Limits** | Per-tier rate-limiting configurations and monthly quota definitions |
| **Error Codes** | Standardized error codes (E1xxx-E7xxx) with HTTP status, categories, retry info, and message templates |
| **API Versions** | Version management for Cognigate, Trust, Logic, BASIS, and CAR Spec APIs |
| **Themes** | UI theme tokens (4 themes) with CSS custom-property generation |

## Quick Start

```typescript
import {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier,
  API_ENDPOINTS,
  CAPABILITIES,
  getCapabilitiesForTier,
} from '@vorionsys/shared-constants';

// Convert a trust score to its tier
const tier = scoreToTier(750); // TrustTier.T4_STANDARD

// Look up tier metadata
const info = TIER_THRESHOLDS[TrustTier.T4_STANDARD];
console.log(info.name);         // "Standard"
console.log(info.min, info.max); // 650, 799
console.log(info.color);        // "#22c55e"

// List capabilities available at a tier
const caps = getCapabilitiesForTier(TrustTier.T4_STANDARD);
console.log(caps.map(c => c.code));
// ["CAP-READ-PUBLIC", "CAP-GENERATE-TEXT", ..., "CAP-ESCALATE-HUMAN"]

// Get an API endpoint
const apiUrl = API_ENDPOINTS.cognigate.production;
// "https://cognigate.dev/v1"
```

## Trust Tiers

The BASIS 8-tier trust model (score range 0--1000):

| Tier | Score | Name | Description |
|------|-------|------|-------------|
| T0 | 0--199 | Sandbox | Isolated, no external access, observation only |
| T1 | 200--349 | Observed | Read-only, sandboxed execution, monitored |
| T2 | 350--499 | Provisional | Basic operations, heavy supervision |
| T3 | 500--649 | Monitored | Standard operations with continuous monitoring |
| T4 | 650--799 | Standard | External API access, policy-governed |
| T5 | 800--875 | Trusted | Cross-agent communication, delegated tasks |
| T6 | 876--950 | Certified | Admin tasks, agent spawning, minimal oversight |
| T7 | 951--1000 | Autonomous | Full autonomy, self-governance, strategic only |

## Subpath Imports

Import only the module you need to minimize bundle size:

```typescript
import { TrustTier, scoreToTier } from '@vorionsys/shared-constants/tiers';
import { VORION_DOMAINS, API_ENDPOINTS } from '@vorionsys/shared-constants/domains';
import { CAPABILITIES, getCapabilitiesForTier } from '@vorionsys/shared-constants/capabilities';
import { VORION_PRODUCTS } from '@vorionsys/shared-constants/products';
import { RATE_LIMITS, getRateLimits } from '@vorionsys/shared-constants/rate-limits';
import { ERROR_CODES, getErrorByCode } from '@vorionsys/shared-constants/error-codes';
import { API_VERSIONS, getCurrentVersion } from '@vorionsys/shared-constants/api-versions';
import { THEMES, getActiveTheme, themeToCssVars } from '@vorionsys/shared-constants/themes';
```

## Usage Examples

### Trust Tier Helpers

```typescript
import {
  TrustTier,
  scoreToTier,
  getTierName,
  getTierColor,
  getTierMinScore,
  getTierMaxScore,
  getTierCode,
  meetsTierRequirement,
  parseTier,
  ALL_TIERS,
} from '@vorionsys/shared-constants';

scoreToTier(750);                                 // TrustTier.T4_STANDARD
getTierName(TrustTier.T5_TRUSTED);                // "Trusted"
getTierColor(TrustTier.T3_MONITORED);             // "#eab308"
getTierMinScore(TrustTier.T4_STANDARD);           // 650
getTierMaxScore(TrustTier.T4_STANDARD);           // 799
getTierCode(TrustTier.T4_STANDARD);               // "T4"
meetsTierRequirement(750, TrustTier.T3_MONITORED); // true
parseTier('T3');                                   // TrustTier.T3_MONITORED
parseTier('TRUSTED');                              // TrustTier.T5_TRUSTED
ALL_TIERS;                                         // [T0, T1, T2, T3, T4, T5, T6, T7]
```

### Domains and Endpoints

```typescript
import {
  VORION_DOMAINS,
  AGENTANCHOR_DOMAINS,
  COGNIGATE_DOMAINS,
  API_ENDPOINTS,
  VORION_EMAILS,
  GITHUB,
  NPM_PACKAGES,
  ALL_DOMAINS,
  DOMAIN_ALIASES,
} from '@vorionsys/shared-constants';

VORION_DOMAINS.basis;                  // "https://basis.vorion.org"
AGENTANCHOR_DOMAINS.trust;             // "https://trust.agentanchorai.com"
COGNIGATE_DOMAINS.main;                // "https://cognigate.dev"
API_ENDPOINTS.cognigate.production;    // "https://cognigate.dev/v1"
API_ENDPOINTS.agentAnchor.sandbox;     // "https://sandbox.agentanchorai.com/v1"
VORION_EMAILS.security;               // "security@vorion.org"
GITHUB.vorion.mainRepo;               // "https://github.com/vorionsys/vorion"
NPM_PACKAGES.vorion.sharedConstants;   // "@vorionsys/shared-constants"
```

### Capabilities

```typescript
import {
  CapabilityCategory,
  CAPABILITIES,
  getCapabilitiesForTier,
  getCapability,
  isCapabilityAvailable,
  getCapabilityMinTier,
  getCapabilitiesByCategory,
  getAllCapabilityCodes,
} from '@vorionsys/shared-constants';

// Get all capabilities unlocked at T4 or below
const caps = getCapabilitiesForTier(TrustTier.T4_STANDARD);

// Look up a single capability
const cap = getCapability('CAP-AGENT-DELEGATE');
// { code: "CAP-AGENT-DELEGATE", name: "Task Delegation", unlockTier: T5_TRUSTED, ... }

// Check if available
isCapabilityAvailable('CAP-FILE-WRITE', TrustTier.T3_MONITORED); // true (unlocks at T2)

// Get minimum tier needed
getCapabilityMinTier('CAP-AGENT-SPAWN'); // TrustTier.T6_CERTIFIED

// Filter by category
const apiCaps = getCapabilitiesByCategory(CapabilityCategory.API_ACCESS);
```

### Products

```typescript
import {
  ProductCategory,
  ProductStatus,
  VORION_PRODUCTS,
  AGENTANCHOR_PRODUCTS,
  ALL_PRODUCTS,
  getProduct,
  getProductsByCategory,
  getProductsByStatus,
  getProductsByOrganization,
} from '@vorionsys/shared-constants';

const basis = getProduct('basis');
// { id: "basis", name: "BASIS", status: "ga", url: "https://basis.vorion.org", ... }

const gaProducts = getProductsByStatus(ProductStatus.GA);
const openSource = getProductsByCategory(ProductCategory.OPEN_SOURCE);
const vorionProducts = getProductsByOrganization('vorion');
```

### Rate Limits and Quotas

```typescript
import {
  TrustTier,
  RATE_LIMITS,
  TIER_QUOTAS,
  getRateLimits,
  wouldExceedLimit,
  formatRateLimit,
  getQuota,
  isUnlimited,
} from '@vorionsys/shared-constants';

const limits = getRateLimits(TrustTier.T4_STANDARD);
// { requestsPerSecond: 20, requestsPerMinute: 600, burstLimit: 50, ... }

wouldExceedLimit(TrustTier.T4_STANDARD, 'minute', 599); // false
wouldExceedLimit(TrustTier.T4_STANDARD, 'minute', 600); // true

formatRateLimit(TrustTier.T4_STANDARD);
// "20/s, 600/min, 10000/hr"

const quota = getQuota(TrustTier.T7_AUTONOMOUS);
isUnlimited(quota.monthlyApiCalls); // true (-1 means unlimited)
```

### Error Codes

```typescript
import {
  ErrorCategory,
  ERROR_CODES,
  getErrorByCode,
  getErrorsByCategory,
  getRetryableErrors,
  formatErrorMessage,
  createErrorResponse,
} from '@vorionsys/shared-constants';

// Look up error by its code string
const err = getErrorByCode('E1001');
// { code: "E1001", httpStatus: 401, category: "auth", message: "API key is missing...", retryable: false }

// Use a named error constant
const response = createErrorResponse(
  ERROR_CODES.TRUST_TIER_INSUFFICIENT,
  { currentTier: 'T2', requiredTier: 'T4' },
  'req_abc123',
);
// { error: { code: "E5001", message: "Trust tier T2 insufficient. Required: T4.", ... }, status: 403 }

// Get all retryable errors (useful for retry logic)
const retryable = getRetryableErrors();

// Get errors by category
const authErrors = getErrorsByCategory(ErrorCategory.AUTH);
```

### API Versions

```typescript
import {
  VersionStatus,
  API_VERSIONS,
  getCurrentVersion,
  getVersionDefinition,
  isVersionSupported,
  isVersionDeprecated,
  getStableVersions,
  buildApiUrl,
  VERSION_HEADERS,
  COGNIGATE_CURRENT_VERSION,
  BASIS_SPEC_VERSION,
} from '@vorionsys/shared-constants';

getCurrentVersion('cognigate');   // "v1"
getCurrentVersion('basis');       // "v1"
BASIS_SPEC_VERSION;               // "1.0.0"

isVersionSupported('cognigate', 'v1');  // true
isVersionDeprecated('cognigate', 'v1'); // false

buildApiUrl('https://cognigate.dev', 'v1', 'agents/lookup');
// "https://cognigate.dev/v1/agents/lookup"

const stableVersions = getStableVersions('trust');

VERSION_HEADERS.REQUEST_VERSION;  // "X-API-Version"
```

### Themes

```typescript
import {
  ACTIVE_THEME,
  THEMES,
  getActiveTheme,
  getAllThemeIds,
  themeToCssVars,
} from '@vorionsys/shared-constants';

ACTIVE_THEME;              // "midnight_cyan"
getAllThemeIds();           // ["midnight_cyan", "indigo_authority", "obsidian_amber", "arctic_glass"]

const theme = getActiveTheme();
console.log(theme.accent);      // "#06b6d4"
console.log(theme.bgPrimary);   // "#0a0a0f"
console.log(theme.fontFamily);  // "'Inter', -apple-system, ..."

// Generate CSS custom properties for injection
const cssVars = themeToCssVars('midnight_cyan');
// "--bg-primary: #0a0a0f; --accent: #06b6d4; ..."
```

## API Reference

### Tiers (`@vorionsys/shared-constants/tiers`)

| Export | Kind | Description |
|--------|------|-------------|
| `TrustTier` | enum | Trust tier enum (T0_SANDBOX through T7_AUTONOMOUS) |
| `TIER_THRESHOLDS` | const | Score ranges, names, descriptions, and colors for each tier |
| `scoreToTier(score)` | function | Convert a 0-1000 score to its `TrustTier` |
| `getTierThreshold(tier)` | function | Get the full `TierThreshold` object for a tier |
| `getTierName(tier)` | function | Get human-readable tier name |
| `getTierColor(tier)` | function | Get hex color for a tier |
| `getTierMinScore(tier)` | function | Get minimum score required for a tier |
| `getTierMaxScore(tier)` | function | Get maximum score for a tier |
| `getTierCode(tier)` | function | Get short code string (e.g. "T4") |
| `meetsTierRequirement(score, minTier)` | function | Check if a score meets a minimum tier |
| `parseTier(input)` | function | Parse tier from string ("T3", "3", "MONITORED") |
| `ALL_TIERS` | const | Ordered array of all 8 tiers |
| `TierThreshold` | type | Interface for tier threshold configuration |
| `TrustTierName` | type | Union of tier display names |
| `TrustTierCode` | type | Union of tier short codes ("T0" through "T7") |

### Domains (`@vorionsys/shared-constants/domains`)

| Export | Kind | Description |
|--------|------|-------------|
| `VORION_DOMAINS` | const | Vorion organization URLs (main, basis, carId, atsf, learn, kaizen) |
| `AGENTANCHOR_DOMAINS` | const | Agent Anchor AI URLs (main, trust, logic, status, verify) |
| `COGNIGATE_DOMAINS` | const | Cognigate URLs (main, docs) |
| `API_ENDPOINTS` | const | Production/staging/sandbox API base URLs |
| `VORION_EMAILS` | const | Vorion contact email addresses |
| `AGENTANCHOR_EMAILS` | const | Agent Anchor contact email addresses |
| `GITHUB` | const | GitHub organization and repo URLs |
| `NPM_PACKAGES` | const | npm package names for all published packages |
| `ALL_DOMAINS` | const | Combined object containing all domain groups |
| `DOMAIN_ALIASES` | const | Map of alternate domains to their primary |
| `VorionDomain` | type | Key union for `VORION_DOMAINS` |
| `AgentAnchorDomain` | type | Key union for `AGENTANCHOR_DOMAINS` |
| `CognigateDomain` | type | Key union for `COGNIGATE_DOMAINS` |

### Capabilities (`@vorionsys/shared-constants/capabilities`)

| Export | Kind | Description |
|--------|------|-------------|
| `CapabilityCategory` | enum | Capability categories (DATA_ACCESS, API_ACCESS, CODE_EXECUTION, etc.) |
| `CAPABILITIES` | const | Array of all capability definitions with tier gates |
| `getCapabilitiesForTier(tier)` | function | Get all capabilities available at or below a tier |
| `getCapability(code)` | function | Look up a capability by its code string |
| `isCapabilityAvailable(code, tier)` | function | Check if a capability is unlocked at a tier |
| `getCapabilityMinTier(code)` | function | Get the minimum tier required for a capability |
| `getCapabilitiesByCategory(category)` | function | Filter capabilities by category |
| `getAllCapabilityCodes()` | function | Get array of all capability code strings |
| `CapabilityDefinition` | type | Interface for a capability definition |

### Products (`@vorionsys/shared-constants/products`)

| Export | Kind | Description |
|--------|------|-------------|
| `ProductCategory` | enum | Product categories (OPEN_SOURCE, COMMERCIAL, DEVELOPER_TOOLS, EDUCATION) |
| `ProductStatus` | enum | Product lifecycle status (DEVELOPMENT through EOL) |
| `VORION_PRODUCTS` | const | Vorion open-source product definitions |
| `AGENTANCHOR_PRODUCTS` | const | Agent Anchor commercial product definitions |
| `ALL_PRODUCTS` | const | Combined product catalog |
| `getProduct(id)` | function | Look up a product by ID |
| `getProductsByCategory(category)` | function | Filter products by category |
| `getProductsByStatus(status)` | function | Filter products by lifecycle status |
| `getProductsByOrganization(org)` | function | Get products for "vorion" or "agentanchor" |
| `ProductDefinition` | type | Interface for a product definition |

### Rate Limits (`@vorionsys/shared-constants/rate-limits`)

| Export | Kind | Description |
|--------|------|-------------|
| `RATE_LIMITS` | const | Rate-limit configurations keyed by tier |
| `TIER_QUOTAS` | const | Monthly quota configurations keyed by tier |
| `getRateLimits(tier)` | function | Get `RateLimitConfig` for a tier |
| `getMinTierForLimits(config)` | function | Find the lowest tier that satisfies given limits |
| `wouldExceedLimit(tier, window, count)` | function | Check if a count exceeds a tier's limit for a time window |
| `formatRateLimit(tier)` | function | Human-readable rate-limit string |
| `getQuota(tier)` | function | Get `QuotaConfig` for a tier |
| `isUnlimited(value)` | function | Check if a quota value represents unlimited (-1) |
| `RateLimitConfig` | type | Interface for rate-limit settings |
| `QuotaConfig` | type | Interface for monthly quota settings |

### Error Codes (`@vorionsys/shared-constants/error-codes`)

| Export | Kind | Description |
|--------|------|-------------|
| `ErrorCategory` | enum | Error categories (AUTH, VALIDATION, RATE_LIMIT, NOT_FOUND, TRUST, SERVER, EXTERNAL, CONFIG) |
| `AUTH_ERRORS` | const | Authentication error definitions (E1001-E1007) |
| `VALIDATION_ERRORS` | const | Validation error definitions (E2001-E2008) |
| `RATE_LIMIT_ERRORS` | const | Rate-limit error definitions (E3001-E3004) |
| `NOT_FOUND_ERRORS` | const | Not-found error definitions (E4001-E4005) |
| `TRUST_ERRORS` | const | Trust/governance error definitions (E5001-E5007) |
| `SERVER_ERRORS` | const | Server error definitions (E6001-E6004) |
| `EXTERNAL_ERRORS` | const | External service error definitions (E7001-E7003) |
| `ERROR_CODES` | const | All error definitions merged into one object |
| `getErrorByCode(code)` | function | Look up error by code string (e.g. "E1001") |
| `getErrorsByCategory(category)` | function | Get all errors in a category |
| `getRetryableErrors()` | function | Get all errors marked as retryable |
| `formatErrorMessage(error, params)` | function | Interpolate parameters into a message template |
| `createErrorResponse(error, params?, requestId?)` | function | Build a structured error response object |
| `ErrorDefinition` | type | Interface for an error definition |
| `ErrorCode` | type | Union of all error constant keys |

### API Versions (`@vorionsys/shared-constants/api-versions`)

| Export | Kind | Description |
|--------|------|-------------|
| `VersionStatus` | enum | Version lifecycle status (DEVELOPMENT, PREVIEW, STABLE, DEPRECATED, RETIRED) |
| `COGNIGATE_VERSIONS` | const | Cognigate API version definitions |
| `COGNIGATE_CURRENT_VERSION` | const | Current Cognigate API version string |
| `COGNIGATE_DEFAULT_VERSION` | const | Default Cognigate API version string |
| `TRUST_API_VERSIONS` | const | Trust API version definitions |
| `TRUST_CURRENT_VERSION` | const | Current Trust API version string |
| `LOGIC_API_VERSIONS` | const | Logic API version definitions |
| `LOGIC_CURRENT_VERSION` | const | Current Logic API version string |
| `BASIS_VERSIONS` | const | BASIS spec version definitions |
| `BASIS_CURRENT_VERSION` | const | Current BASIS spec version string |
| `BASIS_SPEC_VERSION` | const | Full semver of BASIS spec ("1.0.0") |
| `CAR_SPEC_VERSIONS` | const | CAR Spec version definitions |
| `CAR_SPEC_CURRENT_VERSION` | const | Current CAR Spec version string |
| `API_VERSIONS` | const | All API version definitions grouped by service |
| `getCurrentVersion(service)` | function | Get current version for a service |
| `getVersionDefinition(service, version)` | function | Get full version definition |
| `isVersionSupported(service, version)` | function | Check if a version is still supported |
| `isVersionDeprecated(service, version)` | function | Check if a version is deprecated |
| `getStableVersions(service)` | function | Get all stable versions for a service |
| `buildApiUrl(baseUrl, version, path)` | function | Build a versioned API URL |
| `VERSION_HEADERS` | const | Standard HTTP header names for version negotiation |
| `ApiVersionDefinition` | type | Interface for an API version definition |

### Themes (`@vorionsys/shared-constants/themes`)

| Export | Kind | Description |
|--------|------|-------------|
| `ACTIVE_THEME` | const | Currently active theme ID |
| `THEMES` | const | All theme token definitions keyed by `ThemeId` |
| `getActiveTheme()` | function | Get token object for the active theme |
| `getAllThemeIds()` | function | Get array of all available theme IDs |
| `themeToCssVars(themeId?)` | function | Generate CSS custom-property string for a theme |
| `ThemeId` | type | Union of theme identifiers |
| `ThemeTokens` | type | Interface for a complete set of theme tokens |

### Root Exports

| Export | Kind | Description |
|--------|------|-------------|
| `VERSION` | const | Package version string |
| `LAST_UPDATED` | const | Last updated date string |

## TypeScript

All types are fully exported and can be imported as type-only:

```typescript
import type {
  TrustTier,
  TierThreshold,
  TrustTierName,
  TrustTierCode,
  CapabilityDefinition,
  CapabilityCategory,
  ProductDefinition,
  ProductCategory,
  ProductStatus,
  RateLimitConfig,
  QuotaConfig,
  ErrorDefinition,
  ErrorCode,
  ErrorCategory,
  ApiVersionDefinition,
  VersionStatus,
  ThemeId,
  ThemeTokens,
  VorionDomain,
  AgentAnchorDomain,
  CognigateDomain,
} from '@vorionsys/shared-constants';
```

## Requirements

- Node.js >= 18
- TypeScript >= 5.7 (for type-only imports)

## Documentation

Full platform documentation is available at [https://vorion.org/docs](https://vorion.org/docs).

## Repository

This package lives in the Vorion monorepo:

[https://github.com/vorionsys/vorion/tree/master/packages/shared-constants](https://github.com/vorionsys/vorion/tree/master/packages/shared-constants)

## License

Apache-2.0 -- Copyright 2026 Vorion Systems
