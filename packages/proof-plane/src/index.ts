/**
 * Vorion Package - Proof Plane for AI Agent Operations
 *
 * The Vorion proof plane provides an immutable audit trail for all
 * AI agent operations, enabling compliance, debugging, and trust verification.
 *
 * Key components:
 * - ProofPlane: High-level API for the audit system
 * - ProofEventStore: Abstract storage interface
 * - ProofEventEmitter: Event creation with hash chaining
 *
 * @example
 * ```typescript
 * import { createProofPlane } from '@vorion/proof-plane';
 *
 * const proofPlane = createProofPlane({ signedBy: 'my-service' });
 *
 * // Log events
 * await proofPlane.logIntentReceived(intent);
 * await proofPlane.logDecisionMade(decision);
 *
 * // Query events
 * const trace = await proofPlane.getTrace(correlationId);
 *
 * // Verify chain integrity
 * const verification = await proofPlane.verifyChain();
 * ```
 */

// Main exports
export {
  ProofPlane,
  createProofPlane,
  type ProofPlaneConfig,
} from './proof-plane/proof-plane.js';

export {
  ProofPlaneLoggerImpl,
  createProofPlaneLogger,
  noopProofPlaneLogger,
  type ProofPlaneLogger,
  type ProofPlaneLoggerConfig,
} from './proof-plane/logger.js';

// Event store exports
export {
  type ProofEventStore,
  type EventQueryOptions,
  type EventQueryResult,
  type EventStats,
  EventStoreError,
  EventStoreErrorCode,
} from './events/event-store.js';

export {
  InMemoryEventStore,
  createInMemoryEventStore,
} from './events/memory-store.js';

// Event emitter exports
export {
  ProofEventEmitter,
  createEventEmitter,
  type EventEmitterConfig,
  type EventListener,
  type EmitResult,
  type BatchEmitOptions,
  type BatchEmitResult,
} from './events/event-emitter.js';

// Hash chain exports
export {
  sha256,
  sha3_256,
  computeEventHash,
  computeEventHash3,
  verifyEventHash,
  verifyEventHash3,
  verifyChainLink,
  verifyChain,
  verifyChainWithDetails,
  getGenesisHash,
  type ChainVerificationResult,
} from './events/hash-chain.js';

// Event signature exports
export {
  generateSigningKeyPair,
  signEvent,
  verifyEventSignature,
  verifyEventSignatures,
  EventSigningService,
  createSigningService,
  type SigningKeyPair,
  type PublicKey,
  type SignatureVerificationResult,
  type SigningServiceConfig,
  type BatchVerificationResult,
} from './events/event-signatures.js';

// Merkle tree exports
export {
  MerkleTree,
  type MerkleProof,
} from './events/merkle-tree.js';

// API route exports
export {
  createProofRoutes,
  registerProofRoutes,
  createProofExpressRouter,
  type ProofRoute,
} from './api/index.js';
