/**
 * Database Schema Index
 *
 * Exports all database schemas for Drizzle ORM.
 *
 * @packageDocumentation
 */

// Agent registry tables and types (apiKeys excluded — re-exported from api-keys.ts)
export {
  agentStateEnum,
  attestationTypeEnum,
  attestationOutcomeEnum,
  stateActionEnum,
  tenants,
  agents,
  attestations,
  stateTransitions,
  approvalRequests,
  type Tenant,
  type NewTenant,
  type Agent,
  type NewAgent,
  type Attestation,
  type NewAttestation,
  type StateTransition,
  type NewStateTransition,
  type ApprovalRequest,
  type NewApprovalRequest,
  type ApiKey,
  type NewApiKey,
  type AgentState,
  type AttestationType,
  type AttestationOutcome,
  type StateAction,
} from './agents.js';

export * from './proofs.js';
export * from './trust.js';
export * from './escalations.js';
export * from './intents.js';
export * from './api-keys.js';
export * from './merkle.js';
export * from './webhooks.js';
export * from './policy-versions.js';
export * from './service-accounts.js';
export * from './operations.js';
export * from './rbac.js';
