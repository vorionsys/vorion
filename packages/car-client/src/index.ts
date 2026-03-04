/**
 * @vorion/car-client
 *
 * TypeScript client SDK for the Categorical Agentic Registry (CAR) standard.
 * Provides type-safe access to Phase 6 Trust Engine APIs.
 *
 * @example
 * ```typescript
 * import { createCARClient, TrustTier, AgentRole } from '@vorion/car-client'
 *
 * const client = createCARClient({
 *   baseUrl: 'https://api.agentanchorai.com',
 *   apiKey: process.env.CAR_API_KEY,
 * })
 *
 * // Get dashboard stats
 * const { stats } = await client.getStats()
 * console.log(`${stats.contextStats.agents} agents registered`)
 *
 * // Evaluate a role gate
 * const result = await client.evaluateRoleGate({
 *   agentId: 'agent-123',
 *   requestedRole: 'R_L3',
 *   currentTier: 'T3',
 * })
 *
 * // Check ceiling
 * const ceiling = await client.checkCeiling({
 *   agentId: 'agent-123',
 *   proposedScore: 750,
 *   complianceFramework: 'EU_AI_ACT',
 * })
 * ```
 *
 * @packageDocumentation
 */

// Client
export { CARClient, CARError, createCARClient, createLocalCARClient } from './client.js'

// Backwards-compatible aliases (deprecated)
export { CARClient as ACIClient, CARError as ACIError, createCARClient as createACIClient, createLocalCARClient as createLocalACIClient } from './client.js'

// Types - Enums
export type {
  TrustTier,
  AgentRole,
  ContextType,
  CreationType,
  RoleGateDecision,
  ComplianceStatus,
  GamingAlertType,
  AlertSeverity,
  AlertStatus,
  ComplianceFramework,
} from './types.js'

// Types - Constants
export {
  TRUST_TIER_RANGES,
  TRUST_TIER_LABELS,
  AGENT_ROLE_LABELS,
  DEFAULT_PROVENANCE_MODIFIERS,
  REGULATORY_CEILINGS,
} from './types.js'

// Types - Interfaces
export type {
  CARClientConfig,
  CARResponse,
  DeploymentContext,
  OrgContext,
  AgentContext,
  OperationContext,
  ContextHierarchy,
  RoleGateRequest,
  RoleGateResponse,
  RoleGateEvaluation,
  CeilingCheckRequest,
  CeilingCheckResponse,
  CeilingEvent,
  GamingAlert,
  GamingAlertCreateRequest,
  CARPreset,
  VorionPreset,
  AxiomPreset,
  PresetLineage,
  PresetHierarchy,
  Provenance,
  ProvenanceCreateRequest,
  Phase6Stats,
  TrustTierData,
  RecentEvent,
  DashboardData,
} from './types.js'

// Types - Zod Schemas (for runtime validation)
export {
  TrustTierSchema,
  AgentRoleSchema,
  CreationTypeSchema,
  RoleGateDecisionSchema,
  ComplianceStatusSchema,
  GamingAlertTypeSchema,
  AlertSeveritySchema,
  AlertStatusSchema,
  RoleGateRequestSchema,
  CeilingCheckRequestSchema,
  ProvenanceCreateRequestSchema,
} from './types.js'

// Types - Utility Functions
export { getTierFromScore, isRoleAllowedForTier } from './types.js'
