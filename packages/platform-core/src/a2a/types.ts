/**
 * Agent-to-Agent Communication Types
 *
 * Defines the protocol, message formats, and trust negotiation
 * types for inter-agent communication.
 *
 * @packageDocumentation
 */

// ============================================================================
// A2A Protocol Messages
// ============================================================================

/**
 * A2A message envelope - wraps all inter-agent communication
 */
export interface A2AMessage {
  /** Unique message ID */
  id: string;

  /** Protocol version */
  version: '1.0';

  /** Message type */
  type: A2AMessageType;

  /** Sender CAR ID */
  from: string;

  /** Recipient CAR ID */
  to: string;

  /** Timestamp (ISO 8601) */
  timestamp: string;

  /** Request correlation ID (for responses) */
  correlationId?: string;

  /** Trust context */
  trustContext: TrustContext;

  /** Message payload */
  payload: A2APayload;

  /** Digital signature */
  signature?: string;
}

/**
 * A2A message types
 */
export type A2AMessageType =
  | 'invoke'           // Request agent action
  | 'response'         // Response to invoke
  | 'stream'           // Streaming response chunk
  | 'stream_end'       // End of stream
  | 'ping'             // Heartbeat/capability check
  | 'pong'             // Heartbeat response
  | 'negotiate'        // Trust negotiation request
  | 'negotiate_ack'    // Trust negotiation acknowledgment
  | 'delegate'         // Delegation request
  | 'revoke';          // Revoke delegation

/**
 * A2A payload types
 */
export type A2APayload =
  | InvokePayload
  | ResponsePayload
  | StreamPayload
  | PingPayload
  | NegotiatePayload
  | DelegatePayload;

// ============================================================================
// Invoke/Response
// ============================================================================

/**
 * Invoke payload - request another agent to perform an action
 */
export interface InvokePayload {
  type: 'invoke';

  /** Action to perform */
  action: string;

  /** Action parameters */
  params: Record<string, unknown>;

  /** Required capabilities for this action */
  requiredCapabilities?: string[];

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Maximum trust tier allowed to execute */
  maxTier?: number;

  /** Chain context (for nested calls) */
  chainContext?: ChainContext;
}

/**
 * Response payload - result of an invoke
 */
export interface ResponsePayload {
  type: 'response';

  /** Success/failure */
  success: boolean;

  /** Result data (if success) */
  result?: unknown;

  /** Error details (if failure) */
  error?: A2AError;

  /** Execution metrics */
  metrics: ExecutionMetrics;
}

/**
 * Stream payload - chunk of streaming response
 */
export interface StreamPayload {
  type: 'stream' | 'stream_end';

  /** Sequence number */
  sequence: number;

  /** Chunk data */
  data?: unknown;

  /** Is final chunk */
  final: boolean;
}

/**
 * A2A error structure
 */
export interface A2AError {
  code: A2AErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * A2A error codes
 */
export type A2AErrorCode =
  | 'TRUST_INSUFFICIENT'       // Caller trust too low
  | 'CAPABILITY_DENIED'        // Requested capability not allowed
  | 'ACTION_NOT_FOUND'         // Unknown action
  | 'TIMEOUT'                  // Execution timeout
  | 'RATE_LIMITED'             // Rate limit exceeded
  | 'CHAIN_DEPTH_EXCEEDED'     // Call chain too deep
  | 'DELEGATION_EXPIRED'       // Delegation no longer valid
  | 'SIGNATURE_INVALID'        // Message signature failed
  | 'AGENT_UNAVAILABLE'        // Target agent not reachable
  | 'INTERNAL_ERROR';          // Internal processing error

/**
 * Execution metrics for attestation
 */
export interface ExecutionMetrics {
  /** Processing time in ms */
  durationMs: number;

  /** Memory used in bytes */
  memoryBytes?: number;

  /** Number of sub-calls made */
  subCallCount: number;

  /** Network bytes transferred */
  networkBytes?: number;
}

// ============================================================================
// Trust Negotiation
// ============================================================================

/**
 * Trust context attached to every A2A message
 */
export interface TrustContext {
  /** Caller's current trust tier */
  callerTier: number;

  /** Caller's trust score (0-1000) */
  callerScore: number;

  /** Caller's tenant ID */
  callerTenant: string;

  /** Proof of trust (signed by Agent Anchor) */
  trustProof?: TrustProof;

  /** Delegated authority (if acting on behalf of another) */
  delegation?: DelegationToken;

  /** Call chain for nested invocations */
  callChain: ChainLink[];
}

/**
 * Trust proof signed by Agent Anchor
 */
export interface TrustProof {
  /** Agent CAR ID */
  carId: string;

  /** Trust tier at time of signing */
  tier: number;

  /** Trust score at time of signing */
  score: number;

  /** Proof timestamp */
  issuedAt: string;

  /** Proof expiration */
  expiresAt: string;

  /** Agent Anchor signature */
  signature: string;

  /** Registry that issued the proof */
  registry: string;
}

/**
 * Ping payload - capability check
 */
export interface PingPayload {
  type: 'ping';

  /** Capabilities being checked */
  checkCapabilities?: string[];
}

/**
 * Negotiate payload - trust negotiation
 */
export interface NegotiatePayload {
  type: 'negotiate' | 'negotiate_ack';

  /** Proposed trust requirements */
  requirements?: TrustRequirements;

  /** Accepted/rejected */
  accepted?: boolean;

  /** Counter-proposal (if rejected) */
  counterProposal?: TrustRequirements;
}

/**
 * Trust requirements for an interaction
 */
export interface TrustRequirements {
  /** Minimum trust tier required */
  minTier: number;

  /** Minimum trust score required */
  minScore?: number;

  /** Required capabilities */
  requiredCapabilities: string[];

  /** Required attestation types */
  requiredAttestations?: string[];

  /** Maximum call chain depth */
  maxChainDepth?: number;

  /** Require mTLS */
  requireMtls?: boolean;
}

// ============================================================================
// Delegation
// ============================================================================

/**
 * Delegate payload - request delegation authority
 */
export interface DelegatePayload {
  type: 'delegate' | 'revoke';

  /** Delegation details */
  delegation?: DelegationRequest;

  /** Revocation ID (for revoke) */
  revokeId?: string;
}

/**
 * Delegation request
 */
export interface DelegationRequest {
  /** Actions being delegated */
  actions: string[];

  /** Maximum tier the delegate can act at */
  maxTier: number;

  /** Delegation duration in seconds */
  durationSec: number;

  /** Maximum number of uses */
  maxUses?: number;

  /** Can the delegate re-delegate */
  canRedelegate: boolean;

  /** Constraints on delegation */
  constraints?: DelegationConstraints;
}

/**
 * Delegation constraints
 */
export interface DelegationConstraints {
  /** Allowed target agents */
  allowedTargets?: string[];

  /** Blocked target agents */
  blockedTargets?: string[];

  /** Time-of-day restrictions */
  timeRestrictions?: {
    allowedHours: number[];
    timezone: string;
  };

  /** Rate limit for delegated calls */
  rateLimit?: number;
}

/**
 * Delegation token - proof of delegated authority
 */
export interface DelegationToken {
  /** Unique delegation ID */
  id: string;

  /** Delegator CAR ID (who granted) */
  delegator: string;

  /** Delegate CAR ID (who received) */
  delegate: string;

  /** Delegated actions */
  actions: string[];

  /** Max tier for delegation */
  maxTier: number;

  /** Issued timestamp */
  issuedAt: string;

  /** Expiration timestamp */
  expiresAt: string;

  /** Uses remaining (-1 = unlimited) */
  usesRemaining: number;

  /** Can re-delegate */
  canRedelegate: boolean;

  /** Constraints */
  constraints?: DelegationConstraints;

  /** Delegator signature */
  signature: string;

  /** Chain of delegations (for re-delegation) */
  chain?: DelegationToken[];
}

// ============================================================================
// Chain of Trust
// ============================================================================

/**
 * Chain context for nested A2A calls
 */
export interface ChainContext {
  /** Root request ID */
  rootRequestId: string;

  /** Current depth in chain */
  depth: number;

  /** Maximum allowed depth */
  maxDepth: number;

  /** Cumulative trust floor (minimum of all agents in chain) */
  trustFloor: number;

  /** Chain links */
  chain: ChainLink[];
}

/**
 * Single link in a call chain
 */
export interface ChainLink {
  /** Agent CAR ID */
  carId: string;

  /** Agent trust tier at time of call */
  tier: number;

  /** Agent trust score at time of call */
  score: number;

  /** Action performed */
  action: string;

  /** Timestamp */
  timestamp: string;

  /** Request ID */
  requestId: string;
}

/**
 * Trust inheritance mode for chains
 */
export type TrustInheritanceMode =
  | 'minimum'      // Trust = min of all agents in chain
  | 'weighted'     // Trust = weighted average
  | 'caller_only'  // Trust = only immediate caller
  | 'root_only';   // Trust = only root caller

// ============================================================================
// A2A Service Types
// ============================================================================

/**
 * A2A invoke request (API level)
 */
export interface A2AInvokeRequest {
  /** Target agent CAR ID */
  targetCarId: string;

  /** Action to invoke */
  action: string;

  /** Action parameters */
  params: Record<string, unknown>;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Wait for response or fire-and-forget */
  async?: boolean;

  /** Streaming response */
  stream?: boolean;
}

/**
 * A2A invoke response (API level)
 */
export interface A2AInvokeResponse {
  /** Request ID */
  requestId: string;

  /** Success/failure */
  success: boolean;

  /** Result data */
  result?: unknown;

  /** Error details */
  error?: A2AError;

  /** Execution metrics */
  metrics: ExecutionMetrics;

  /** Trust chain used */
  trustChain: ChainLink[];

  /** Attestation data generated */
  attestation: A2AAttestationData;
}

/**
 * A2A attestation data for trust scoring
 */
export interface A2AAttestationData {
  /** Caller CAR ID */
  callerCarId: string;

  /** Callee CAR ID */
  calleeCarId: string;

  /** Action invoked */
  action: string;

  /** Success/failure */
  success: boolean;

  /** Response time ms */
  responseTimeMs: number;

  /** Trust negotiation outcome */
  trustNegotiated: boolean;

  /** Trust requirements met */
  trustRequirementsMet: boolean;

  /** Policy violations */
  violations: string[];

  /** Chain depth */
  chainDepth: number;

  /** Delegation used */
  delegationUsed: boolean;
}

// ============================================================================
// A2A Registry Types
// ============================================================================

/**
 * Agent endpoint registration for A2A discovery
 */
export interface AgentEndpoint {
  /** Agent CAR ID */
  carId: string;

  /** Endpoint URL */
  url: string;

  /** Supported protocol versions */
  versions: string[];

  /** Capabilities offered */
  capabilities: string[];

  /** Actions available */
  actions: AgentAction[];

  /** Trust requirements to invoke */
  trustRequirements: TrustRequirements;

  /** Health status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Last health check */
  lastHealthCheck: string;
}

/**
 * Action definition for discovery
 */
export interface AgentAction {
  /** Action name */
  name: string;

  /** Description */
  description: string;

  /** Parameter schema (JSON Schema) */
  paramsSchema: Record<string, unknown>;

  /** Result schema (JSON Schema) */
  resultSchema: Record<string, unknown>;

  /** Minimum tier required */
  minTier: number;

  /** Required capabilities */
  requiredCapabilities: string[];

  /** Supports streaming */
  streaming: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default trust requirements
 */
export const DEFAULT_TRUST_REQUIREMENTS: TrustRequirements = {
  minTier: 5, // T5+ for A2A by default
  minScore: 800,
  requiredCapabilities: ['a2a:invoke'],
  maxChainDepth: 5,
  requireMtls: true,
};

/**
 * Maximum call chain depth
 */
export const MAX_CHAIN_DEPTH = 10;

/**
 * Default A2A timeout in milliseconds
 */
export const DEFAULT_A2A_TIMEOUT_MS = 30000;

/**
 * Trust proof validity period in seconds
 */
export const TRUST_PROOF_VALIDITY_SEC = 300; // 5 minutes

/**
 * Maximum delegation chain length
 */
export const MAX_DELEGATION_CHAIN = 3;
