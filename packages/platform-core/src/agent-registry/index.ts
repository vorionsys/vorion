/**
 * Agent Registry Module
 *
 * Core module for Agent Anchor functionality including agent registration,
 * lifecycle management, attestations, and trust scoring integration.
 *
 * @packageDocumentation
 */

// Service exports
export {
  AgentRegistryService,
  createAgentRegistryService,
  getAgentRegistryService,
  DOMAIN_BITS,
  TRUST_TIER_RANGES,
  STATE_TO_TIER,
  TIER_TO_STATE,
  HUMAN_APPROVAL_GATES,
  type RegisterAgentOptions,
  type AgentQueryOptions,
  type SubmitAttestationOptions,
  type StateTransitionOptions,
  type StateTransitionResult,
} from "./service.js";

// Cache exports
export {
  A3ICacheService,
  createA3ICacheService,
  getA3ICacheService,
  type CachedTrustScore,
  type CachedAgent,
  type A3ISyncStatus,
  type A3ICacheConfig,
} from "./a3i-cache.js";

// Tenant service exports
export {
  TenantService,
  createTenantService,
  getTenantService,
  TENANT_TIERS,
  type CreateTenantOptions,
  type CreateApiKeyOptions,
  type ApiKeyWithSecret,
} from "./tenant-service.js";

// Route exports
export { registerAgentRegistryRoutes } from "./routes.js";

// Re-export schema types
export type {
  Agent,
  NewAgent,
  Tenant,
  NewTenant,
  Attestation,
  NewAttestation,
  StateTransition,
  NewStateTransition,
  ApprovalRequest,
  NewApprovalRequest,
  ApiKey,
  NewApiKey,
  AgentState,
  AttestationType,
  AttestationOutcome,
  StateAction,
} from "@vorionsys/contracts/db";
