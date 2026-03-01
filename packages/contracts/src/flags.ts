/**
 * Vorion Feature Flag Registry
 *
 * Centralized feature flag definitions for the entire platform.
 * All feature flags MUST be defined here - no inline flag strings.
 *
 * Usage:
 *   import { FLAGS, type FeatureFlag } from '@vorionsys/contracts';
 *   if (isEnabled(FLAGS.TRUST_EDGE_CACHE)) { ... }
 *
 * @packageDocumentation
 */

/**
 * Feature flag registry - single source of truth
 */
export const FLAGS = {
  // ============================================================================
  // TRUST ENGINE
  // ============================================================================

  /** Enable edge caching for trust score lookups */
  TRUST_EDGE_CACHE: 'trust_edge_cache',

  /** Enable async trust score recalculation */
  TRUST_ASYNC_RECALC: 'trust_async_recalc',

  /** Enable v2 velocity calculation algorithm */
  TRUST_VELOCITY_V2: 'trust_velocity_v2',

  /** Enable trust score decay over time */
  TRUST_DECAY_ENABLED: 'trust_decay_enabled',

  /** Enable multi-dimensional trust scoring */
  TRUST_MULTIDIMENSIONAL: 'trust_multidimensional',

  // ============================================================================
  // PROOF SYSTEM
  // ============================================================================

  /** Enable async proof signing */
  PROOF_ASYNC_SIGNING: 'proof_async_signing',

  /** Enable multi-party proof attestation */
  PROOF_MULTI_PARTY: 'proof_multi_party',

  /** Enable proof compression for storage */
  PROOF_COMPRESSION: 'proof_compression',

  /** Enable real-time proof streaming */
  PROOF_STREAMING: 'proof_streaming',

  // ============================================================================
  // GOVERNANCE
  // ============================================================================

  /** Enable policy playground for testing */
  POLICY_PLAYGROUND: 'policy_playground',

  /** Enable v2 enforce response format */
  ENFORCE_V2_RESPONSE: 'enforce_v2_response',

  /** Enable council decision workflows */
  COUNCIL_DECISIONS: 'council_decisions',

  /** Enable semantic policy matching */
  SEMANTIC_POLICY: 'semantic_policy',

  // ============================================================================
  // PLATFORM / UX
  // ============================================================================

  /** Enable dark mode UI */
  DARK_MODE: 'dark_mode',

  /** Enable new user onboarding flow */
  NEW_ONBOARDING: 'new_onboarding',

  /** Enable advanced analytics dashboard */
  ADVANCED_ANALYTICS: 'advanced_analytics',

  /** Enable real-time notifications */
  REALTIME_NOTIFICATIONS: 'realtime_notifications',

  // ============================================================================
  // API / INTEGRATIONS
  // ============================================================================

  /** Enable A2A protocol v2 */
  A2A_V2: 'a2a_v2',

  /** Enable GraphQL API */
  GRAPHQL_API: 'graphql_api',

  /** Enable webhook delivery */
  WEBHOOKS: 'webhooks',

  /** Enable SDK telemetry collection */
  SDK_TELEMETRY: 'sdk_telemetry',

  // ============================================================================
  // PERFORMANCE / INFRASTRUCTURE
  // ============================================================================

  /** Enable request batching */
  REQUEST_BATCHING: 'request_batching',

  /** Enable connection pooling */
  CONNECTION_POOLING: 'connection_pooling',

  /** Enable response caching */
  RESPONSE_CACHE: 'response_cache',

  /** Enable distributed tracing */
  DISTRIBUTED_TRACING: 'distributed_tracing',

  // ============================================================================
  // PHASE 7 - CRYPTOGRAPHIC PROOFS (Q1-Q2 2026)
  // ============================================================================

  /** Enable Merkle tree proof aggregation */
  MERKLE_PROOFS: 'merkle_proofs',

  /** Enable zero-knowledge proof generation */
  ZK_PROOFS: 'zk_proofs',

  /** Enable advanced trust decay algorithms */
  ADVANCED_TRUST_DECAY: 'advanced_trust_decay',

  // ============================================================================
  // PHASE 8 - HARDWARE SECURITY (Q3 2026)
  // ============================================================================

  /** Enable Trusted Execution Environment support */
  TEE_SUPPORT: 'tee_support',

  /** Enable DPoP (Demonstration of Proof-of-Possession) tokens */
  DPOP_TOKENS: 'dpop_tokens',

  /** Enable Hardware Security Module integration */
  HSM_INTEGRATION: 'hsm_integration',

  // ============================================================================
  // PHASE 9 - ENTERPRISE (Q4 2026)
  // ============================================================================

  /** Enable multi-tenant architecture */
  MULTI_TENANT: 'multi_tenant',

  /** Enable enterprise SSO integration */
  ENTERPRISE_SSO: 'enterprise_sso',

  // ============================================================================
  // DEBUG / DEVELOPMENT
  // ============================================================================

  /** Enable verbose logging for debugging */
  VERBOSE_LOGGING: 'verbose_logging',

  /** Enable experimental API endpoints */
  EXPERIMENTAL_API: 'experimental_api',

  /** Enable legacy compatibility mode */
  LEGACY_COMPAT: 'legacy_compat',
} as const;

/**
 * Feature flag type - ensures type safety when referencing flags
 */
export type FeatureFlag = (typeof FLAGS)[keyof typeof FLAGS];

/**
 * Feature flag metadata for documentation and UI
 */
export interface FeatureFlagMeta {
  flag: FeatureFlag;
  name: string;
  description: string;
  category: 'trust' | 'proof' | 'governance' | 'platform' | 'api' | 'performance' | 'crypto' | 'security' | 'enterprise' | 'debug';
  defaultEnabled: boolean;
  phase?: number;
  owner?: string;
  expiresAt?: string;
  deprecatedAt?: string;
}

/**
 * Flag metadata registry for documentation and admin UI
 */
export const FLAG_METADATA: Record<FeatureFlag, FeatureFlagMeta> = {
  [FLAGS.TRUST_EDGE_CACHE]: {
    flag: FLAGS.TRUST_EDGE_CACHE,
    name: 'Trust Edge Cache',
    description: 'Enable edge caching for trust score lookups',
    category: 'trust',
    defaultEnabled: false,
  },
  [FLAGS.TRUST_ASYNC_RECALC]: {
    flag: FLAGS.TRUST_ASYNC_RECALC,
    name: 'Async Trust Recalculation',
    description: 'Enable async trust score recalculation',
    category: 'trust',
    defaultEnabled: false,
  },
  [FLAGS.TRUST_VELOCITY_V2]: {
    flag: FLAGS.TRUST_VELOCITY_V2,
    name: 'Trust Velocity V2',
    description: 'Enable v2 velocity calculation algorithm',
    category: 'trust',
    defaultEnabled: false,
  },
  [FLAGS.TRUST_DECAY_ENABLED]: {
    flag: FLAGS.TRUST_DECAY_ENABLED,
    name: 'Trust Decay',
    description: 'Enable trust score decay over time',
    category: 'trust',
    defaultEnabled: true,
  },
  [FLAGS.TRUST_MULTIDIMENSIONAL]: {
    flag: FLAGS.TRUST_MULTIDIMENSIONAL,
    name: 'Multi-dimensional Trust',
    description: 'Enable multi-dimensional trust scoring',
    category: 'trust',
    defaultEnabled: false,
  },
  [FLAGS.PROOF_ASYNC_SIGNING]: {
    flag: FLAGS.PROOF_ASYNC_SIGNING,
    name: 'Async Proof Signing',
    description: 'Enable async proof signing',
    category: 'proof',
    defaultEnabled: false,
  },
  [FLAGS.PROOF_MULTI_PARTY]: {
    flag: FLAGS.PROOF_MULTI_PARTY,
    name: 'Multi-party Proof',
    description: 'Enable multi-party proof attestation',
    category: 'proof',
    defaultEnabled: false,
  },
  [FLAGS.PROOF_COMPRESSION]: {
    flag: FLAGS.PROOF_COMPRESSION,
    name: 'Proof Compression',
    description: 'Enable proof compression for storage',
    category: 'proof',
    defaultEnabled: false,
  },
  [FLAGS.PROOF_STREAMING]: {
    flag: FLAGS.PROOF_STREAMING,
    name: 'Proof Streaming',
    description: 'Enable real-time proof streaming',
    category: 'proof',
    defaultEnabled: false,
  },
  [FLAGS.POLICY_PLAYGROUND]: {
    flag: FLAGS.POLICY_PLAYGROUND,
    name: 'Policy Playground',
    description: 'Enable policy playground for testing',
    category: 'governance',
    defaultEnabled: false,
  },
  [FLAGS.ENFORCE_V2_RESPONSE]: {
    flag: FLAGS.ENFORCE_V2_RESPONSE,
    name: 'Enforce V2 Response',
    description: 'Enable v2 enforce response format',
    category: 'governance',
    defaultEnabled: false,
  },
  [FLAGS.COUNCIL_DECISIONS]: {
    flag: FLAGS.COUNCIL_DECISIONS,
    name: 'Council Decisions',
    description: 'Enable council decision workflows',
    category: 'governance',
    defaultEnabled: false,
  },
  [FLAGS.SEMANTIC_POLICY]: {
    flag: FLAGS.SEMANTIC_POLICY,
    name: 'Semantic Policy',
    description: 'Enable semantic policy matching',
    category: 'governance',
    defaultEnabled: false,
  },
  [FLAGS.DARK_MODE]: {
    flag: FLAGS.DARK_MODE,
    name: 'Dark Mode',
    description: 'Enable dark mode UI',
    category: 'platform',
    defaultEnabled: true,
  },
  [FLAGS.NEW_ONBOARDING]: {
    flag: FLAGS.NEW_ONBOARDING,
    name: 'New Onboarding',
    description: 'Enable new user onboarding flow',
    category: 'platform',
    defaultEnabled: false,
  },
  [FLAGS.ADVANCED_ANALYTICS]: {
    flag: FLAGS.ADVANCED_ANALYTICS,
    name: 'Advanced Analytics',
    description: 'Enable advanced analytics dashboard',
    category: 'platform',
    defaultEnabled: false,
  },
  [FLAGS.REALTIME_NOTIFICATIONS]: {
    flag: FLAGS.REALTIME_NOTIFICATIONS,
    name: 'Realtime Notifications',
    description: 'Enable real-time notifications',
    category: 'platform',
    defaultEnabled: false,
  },
  [FLAGS.A2A_V2]: {
    flag: FLAGS.A2A_V2,
    name: 'A2A Protocol V2',
    description: 'Enable A2A protocol v2',
    category: 'api',
    defaultEnabled: false,
  },
  [FLAGS.GRAPHQL_API]: {
    flag: FLAGS.GRAPHQL_API,
    name: 'GraphQL API',
    description: 'Enable GraphQL API',
    category: 'api',
    defaultEnabled: false,
  },
  [FLAGS.WEBHOOKS]: {
    flag: FLAGS.WEBHOOKS,
    name: 'Webhooks',
    description: 'Enable webhook delivery',
    category: 'api',
    defaultEnabled: false,
  },
  [FLAGS.SDK_TELEMETRY]: {
    flag: FLAGS.SDK_TELEMETRY,
    name: 'SDK Telemetry',
    description: 'Enable SDK telemetry collection',
    category: 'api',
    defaultEnabled: false,
  },
  [FLAGS.REQUEST_BATCHING]: {
    flag: FLAGS.REQUEST_BATCHING,
    name: 'Request Batching',
    description: 'Enable request batching',
    category: 'performance',
    defaultEnabled: false,
  },
  [FLAGS.CONNECTION_POOLING]: {
    flag: FLAGS.CONNECTION_POOLING,
    name: 'Connection Pooling',
    description: 'Enable connection pooling',
    category: 'performance',
    defaultEnabled: true,
  },
  [FLAGS.RESPONSE_CACHE]: {
    flag: FLAGS.RESPONSE_CACHE,
    name: 'Response Cache',
    description: 'Enable response caching',
    category: 'performance',
    defaultEnabled: false,
  },
  [FLAGS.DISTRIBUTED_TRACING]: {
    flag: FLAGS.DISTRIBUTED_TRACING,
    name: 'Distributed Tracing',
    description: 'Enable distributed tracing',
    category: 'performance',
    defaultEnabled: true,
  },
  // Phase 7 flags
  [FLAGS.MERKLE_PROOFS]: {
    flag: FLAGS.MERKLE_PROOFS,
    name: 'Merkle Proofs',
    description: 'Enable Merkle tree proof aggregation',
    category: 'crypto',
    defaultEnabled: false,
    phase: 7,
  },
  [FLAGS.ZK_PROOFS]: {
    flag: FLAGS.ZK_PROOFS,
    name: 'Zero-Knowledge Proofs',
    description: 'Enable zero-knowledge proof generation',
    category: 'crypto',
    defaultEnabled: false,
    phase: 7,
  },
  [FLAGS.ADVANCED_TRUST_DECAY]: {
    flag: FLAGS.ADVANCED_TRUST_DECAY,
    name: 'Advanced Trust Decay',
    description: 'Enable advanced trust decay algorithms',
    category: 'trust',
    defaultEnabled: false,
    phase: 7,
  },
  // Phase 8 flags
  [FLAGS.TEE_SUPPORT]: {
    flag: FLAGS.TEE_SUPPORT,
    name: 'TEE Support',
    description: 'Enable Trusted Execution Environment support',
    category: 'security',
    defaultEnabled: false,
    phase: 8,
  },
  [FLAGS.DPOP_TOKENS]: {
    flag: FLAGS.DPOP_TOKENS,
    name: 'DPoP Tokens',
    description: 'Enable Demonstration of Proof-of-Possession tokens',
    category: 'security',
    defaultEnabled: false,
    phase: 8,
  },
  [FLAGS.HSM_INTEGRATION]: {
    flag: FLAGS.HSM_INTEGRATION,
    name: 'HSM Integration',
    description: 'Enable Hardware Security Module integration',
    category: 'security',
    defaultEnabled: false,
    phase: 8,
  },
  // Phase 9 flags
  [FLAGS.MULTI_TENANT]: {
    flag: FLAGS.MULTI_TENANT,
    name: 'Multi-Tenant',
    description: 'Enable multi-tenant architecture',
    category: 'enterprise',
    defaultEnabled: false,
    phase: 9,
  },
  [FLAGS.ENTERPRISE_SSO]: {
    flag: FLAGS.ENTERPRISE_SSO,
    name: 'Enterprise SSO',
    description: 'Enable enterprise SSO integration',
    category: 'enterprise',
    defaultEnabled: false,
    phase: 9,
  },
  // Debug flags
  [FLAGS.VERBOSE_LOGGING]: {
    flag: FLAGS.VERBOSE_LOGGING,
    name: 'Verbose Logging',
    description: 'Enable verbose logging for debugging',
    category: 'debug',
    defaultEnabled: false,
  },
  [FLAGS.EXPERIMENTAL_API]: {
    flag: FLAGS.EXPERIMENTAL_API,
    name: 'Experimental API',
    description: 'Enable experimental API endpoints',
    category: 'debug',
    defaultEnabled: false,
  },
  [FLAGS.LEGACY_COMPAT]: {
    flag: FLAGS.LEGACY_COMPAT,
    name: 'Legacy Compatibility',
    description: 'Enable legacy compatibility mode',
    category: 'debug',
    defaultEnabled: false,
  },
};

/**
 * Get all flags in a category
 */
export function getFlagsByCategory(
  category: FeatureFlagMeta['category']
): FeatureFlag[] {
  return Object.values(FLAG_METADATA)
    .filter((meta) => meta.category === category)
    .map((meta) => meta.flag);
}

/**
 * Get flag metadata
 */
export function getFlagMeta(flag: FeatureFlag): FeatureFlagMeta {
  return FLAG_METADATA[flag];
}

/**
 * Check if a feature flag is enabled
 * @param flag - The feature flag to check
 * @param overrides - Optional overrides for testing
 */
export function isFeatureEnabled(
  flag: FeatureFlag,
  overrides?: Partial<Record<FeatureFlag, boolean>>
): boolean {
  if (overrides?.[flag] !== undefined) {
    return overrides[flag];
  }
  return FLAG_METADATA[flag]?.defaultEnabled ?? false;
}

/**
 * Get all enabled feature flags
 * @param overrides - Optional overrides for testing
 */
export function getEnabledFeatures(
  overrides?: Partial<Record<FeatureFlag, boolean>>
): FeatureFlag[] {
  return Object.values(FLAGS).filter((flag) => isFeatureEnabled(flag, overrides));
}

/**
 * Get all flags belonging to a specific implementation phase
 * @param phase - The phase number (7, 8, 9, etc.)
 */
export function getFlagsByPhase(phase: number): FeatureFlag[] {
  return Object.values(FLAG_METADATA)
    .filter((meta) => meta.phase === phase)
    .map((meta) => meta.flag);
}

/**
 * Legacy alias for FLAGS constant
 * @deprecated Use FLAGS instead
 */
export const FeatureFlags = FLAGS;
