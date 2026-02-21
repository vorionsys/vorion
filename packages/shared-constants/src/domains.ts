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
// AGENT ANCHOR AI (COMMERCIAL)
// =============================================================================

export const AGENTANCHOR_DOMAINS = {
  /** Main Agent Anchor AI site */
  main: 'https://agentanchorai.com',

  /** Agent Anchor Trust - Trust verification and certification */
  trust: 'https://trust.agentanchorai.com',

  /** Agent Anchor Logic - Policy engine and governance logic */
  logic: 'https://logic.agentanchorai.com',

  /** Status page */
  status: 'https://status.agentanchorai.com',

  /** Agent trust verification portal */
  verify: 'https://verify.agentanchorai.com',
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

  /** Agent Anchor AI Production API */
  agentAnchor: {
    production: 'https://api.agentanchorai.com/v1',
    staging: 'https://staging-api.agentanchorai.com/v1',
    sandbox: 'https://sandbox.agentanchorai.com/v1',
  },

  /** Trust API */
  trust: {
    production: 'https://trust.agentanchorai.com/v1',
    staging: 'https://staging.trust.agentanchorai.com/v1',
  },

  /** Logic/Policy API */
  logic: {
    production: 'https://logic.agentanchorai.com/v1',
    staging: 'https://staging.logic.agentanchorai.com/v1',
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
  support: 'support@agentanchorai.com',

  /** Sales inquiries */
  sales: 'sales@agentanchorai.com',

  /** Partner program */
  partners: 'partners@agentanchorai.com',

  /** API support */
  apiSupport: 'api-support@agentanchorai.com',

  /** Enterprise inquiries */
  enterprise: 'enterprise@agentanchorai.com',

  /** Compliance */
  compliance: 'compliance@agentanchorai.com',

  /** Team */
  team: 'team@agentanchorai.com',
} as const;

// =============================================================================
// GITHUB
// =============================================================================

export const GITHUB = {
  /** Vorion organization */
  vorion: {
    org: 'https://github.com/voriongit',
    mainRepo: 'https://github.com/voriongit/vorion',
  },

  /** Agent Anchor AI (if separate) */
  agentAnchor: {
    org: 'https://github.com/agentanchorai',
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

  /** Commercial packages (@agentanchor) */
  agentAnchor: {
    sdk: '@agentanchor/sdk',
    trust: '@agentanchor/trust',
    logic: '@agentanchor/logic',
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
