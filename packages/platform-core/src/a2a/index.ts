/**
 * Agent-to-Agent Communication Module
 *
 * Provides the A2A protocol implementation for inter-agent communication
 * including trust negotiation, message routing, and chain-of-trust tracking.
 *
 * @packageDocumentation
 */

// Types
export {
  // Message types
  type A2AMessage,
  type A2AMessageType,
  type A2APayload,
  type InvokePayload,
  type ResponsePayload,
  type StreamPayload,
  type PingPayload,
  type NegotiatePayload,
  type DelegatePayload,

  // Trust types
  type TrustContext,
  type TrustProof,
  type TrustRequirements,
  type DelegationToken,
  type DelegationRequest,
  type DelegationConstraints,

  // Chain types
  type ChainContext,
  type ChainLink,
  type TrustInheritanceMode,

  // Error types
  type A2AError,
  type A2AErrorCode,
  type ExecutionMetrics,

  // API types
  type A2AInvokeRequest,
  type A2AInvokeResponse,
  type A2AAttestationData,

  // Registry types
  type AgentEndpoint,
  type AgentAction,

  // Constants
  DEFAULT_TRUST_REQUIREMENTS,
  MAX_CHAIN_DEPTH,
  DEFAULT_A2A_TIMEOUT_MS,
  TRUST_PROOF_VALIDITY_SEC,
  MAX_DELEGATION_CHAIN,
} from './types.js';

// Trust Negotiation
export {
  TrustNegotiationService,
  createTrustNegotiationService,
  getTrustNegotiationService,
  type TrustVerificationResult,
  type NegotiationResult,
  type AgentTrustInfo,
  type TrustInfoProvider,
} from './trust-negotiation.js';

// Router
export {
  A2ARouter,
  createA2ARouter,
  getA2ARouter,
  type RouterConfig,
  type MessageHandler,
  type MessageContext,
} from './router.js';

// Chain of Trust
export {
  ChainOfTrustService,
  createChainOfTrustService,
  getChainOfTrustService,
  type ActiveChain,
  type ChainValidationResult,
  type ChainViolation,
  type ChainStats,
} from './chain-of-trust.js';

// Attestation
export {
  A2AAttestationService,
  createA2AAttestationService,
  getA2AAttestationService,
  type A2AAttestation,
  type AttestationBatch,
  type TrustImpact,
  type AttestationCallback,
} from './attestation.js';

// Routes
export { registerA2ARoutes } from './routes.js';
