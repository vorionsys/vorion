/**
 * @vorionsys/shared-constants - Domain Configuration
 *
 * Single source of truth for all Vorion ecosystem domains and URLs
 * Used across all products and sites for consistent linking
 *
 * @see https://vorion.org
 */

// =============================================================================
// VORION (OPEN SOURCE)
// =============================================================================

export const VORION_DOMAINS = {
  /** Main Vorion organization site */
  main: 'https://vorion.org',

  /** BASIS specification and documentation */
  basis: 'https://basis.vorion.org',

  /** CAR ID specification */
  carId: 'https://carid.vorion.org',

  /** ATSF (Agent Trust & Safety Framework) */
  atsf: 'https://atsf.vorion.org',

  /** Learning and educational resources (primary) */
  learn: 'https://learn.vorion.org',

  /** Kaizen - Interactive AI Learning Experience (mirrors learn) */
  kaizen: 'https://kaizen.vorion.org',
} as const;

/**
 * Domain aliases - maps alternate domains to primary
 * Used for domain detection and routing
 */
export const DOMAIN_ALIASES = {
  'kaizen.vorion.org': 'learn.vorion.org',
} as const;

// =============================================================================
// VORION COMMERCIAL
// =============================================================================

export const AGENTANCHOR_DOMAINS = {
  /** Main Vorion platform site */
  main: 'https://vorion.org',

  /** Trust verification and certification */
  trust: 'https://trust.vorion.org',

  /** Policy engine and governance logic */
  logic: 'https://logic.vorion.org',

  /** Status page */
  status: 'https://status.vorion.org',

  /** Agent trust verification portal */
  verify: 'https://verify.vorion.org',
} as const;

// =============================================================================
// COGNIGATE
// =============================================================================

export const COGNIGATE_DOMAINS = {
  /** Cognigate main site and documentation */
  main: 'https://cognigate.dev',

  /** Cognigate API documentation */
  docs: 'https://cognigate.dev/docs',
} as const;

// =============================================================================
// API ENDPOINTS
// =============================================================================

export const API_ENDPOINTS = {
  /** Cognigate Production API */
  cognigate: {
    production: 'https://cognigate.dev/v1',
    staging: 'https://staging.cognigate.dev/v1',
  },

  /** Vorion Platform API */
  agentAnchor: {
    production: 'https://api.vorion.org/v1',
    staging: 'https://staging-api.vorion.org/v1',
    sandbox: 'https://sandbox.vorion.org/v1',
  },

  /** Trust API */
  trust: {
    production: 'https://trust.vorion.org/v1',
    staging: 'https://staging.trust.vorion.org/v1',
  },

  /** Logic/Policy API */
  logic: {
    production: 'https://logic.vorion.org/v1',
    staging: 'https://staging.logic.vorion.org/v1',
  },
} as const;

// =============================================================================
// EMAIL ADDRESSES
// =============================================================================

export const VORION_EMAILS = {
  /** General inquiries */
  info: 'info@vorion.org',

  /** Security reports */
  security: 'security@vorion.org',

  /** Legal inquiries */
  legal: 'legal@vorion.org',

  /** Community and contributions */
  community: 'community@vorion.org',

  /** Contributing */
  contribute: 'contribute@vorion.org',
} as const;

export const AGENTANCHOR_EMAILS = {
  /** General support */
  support: 'support@vorion.org',

  /** Sales inquiries */
  sales: 'sales@vorion.org',

  /** Partner program */
  partners: 'partners@vorion.org',

  /** API support */
  apiSupport: 'api-support@vorion.org',

  /** Enterprise inquiries */
  enterprise: 'enterprise@vorion.org',

  /** Compliance */
  compliance: 'compliance@vorion.org',

  /** Team */
  team: 'team@vorion.org',
} as const;

// =============================================================================
// GITHUB
// =============================================================================

export const GITHUB = {
  /** Vorion organization (public) */
  vorion: {
    org: 'https://github.com/vorionsys',
    mainRepo: 'https://github.com/vorionsys/vorion',
  },

  /** Vorion private (enterprise) */
  agentAnchor: {
    org: 'https://github.com/vorionsys',
  },
} as const;

// =============================================================================
// NPM PACKAGES
// =============================================================================

export const NPM_PACKAGES = {
  /** Open source packages (@vorionsys) */
  vorion: {
    basis: '@vorionsys/basis',
    contracts: '@vorionsys/contracts',
    carSpec: '@vorionsys/car-spec',
    atsfCore: '@vorionsys/atsf-core',
    cognigate: '@vorionsys/cognigate',
    sharedConstants: '@vorionsys/shared-constants',
  },

  /** Enterprise packages (@vorionsys) */
  agentAnchor: {
    sdk: '@vorionsys/sdk',
    trust: '@vorionsys/trust',
    logic: '@vorionsys/logic',
  },
} as const;

// =============================================================================
// ALL DOMAINS COMBINED
// =============================================================================

export const ALL_DOMAINS = {
  vorion: VORION_DOMAINS,
  agentAnchor: AGENTANCHOR_DOMAINS,
  cognigate: COGNIGATE_DOMAINS,
  api: API_ENDPOINTS,
  emails: {
    vorion: VORION_EMAILS,
    agentAnchor: AGENTANCHOR_EMAILS,
  },
  github: GITHUB,
  npm: NPM_PACKAGES,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type VorionDomain = keyof typeof VORION_DOMAINS;
export type AgentAnchorDomain = keyof typeof AGENTANCHOR_DOMAINS;
export type CognigateDomain = keyof typeof COGNIGATE_DOMAINS;
