# @vorionsys/proof-plane

Immutable dual-hash audit trail for AI agent governance decisions.

[![npm](https://img.shields.io/npm/v/@vorionsys/proof-plane)](https://www.npmjs.com/package/@vorionsys/proof-plane)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

---

## Overview

The **Proof Plane** is a core component of the [Vorion](https://github.com/voriongit/vorion) AI governance stack, built on the **BASIS** (Baseline Authority for Safe & Interoperable Systems) framework. It provides a cryptographically verifiable, immutable audit trail for every decision made by AI agents -- from intent submission through authorization, execution, and trust score changes.

Every event in the proof plane is:

- **Hash-chained** using dual hashing (SHA-256 + SHA3-256) so that tampering with any record breaks the chain
- **Digitally signed** (optional Ed25519 signatures) for authenticity and non-repudiation
- **Correlation-linked** so that complete request traces can be reconstructed from intent to outcome

This makes the Proof Plane the **single source of truth** for compliance auditing, incident forensics, and trust calibration in multi-agent AI systems.

## Installation

```bash
npm install @vorionsys/proof-plane
```

> Requires Node.js >= 18.0.0

## What is PROOF?

PROOF stands for the immutable audit trail at the heart of Vorion's AI governance model. Every time an AI agent submits an intent, receives an authorization decision, begins or completes execution, or has its trust score adjusted, a **proof event** is emitted and appended to the chain.

The proof chain answers critical governance questions:

- **What did this agent request?** (INTENT_RECEIVED)
- **Was it authorized, and why?** (DECISION_MADE -- includes trust band, score, and reasoning)
- **What trust score change occurred?** (TRUST_DELTA)
- **Did execution succeed or fail?** (EXECUTION_STARTED / EXECUTION_COMPLETED / EXECUTION_FAILED)
- **Has anyone tampered with this record?** (Chain and signature verification)

## How Dual-Hash Works

Each proof event carries two independent hashes for defense-in-depth tamper detection:

```
Event N
+--------------------------------------------+
| eventId, eventType, correlationId,         |
| agentId, payload, occurredAt, signedBy     |
| previousHash -----> Event N-1 eventHash    |
+--------------------------------------------+
| eventHash  = SHA-256(canonical content)    |  <-- primary chain hash
| eventHash3 = SHA3-256(canonical content)   |  <-- integrity anchor
+--------------------------------------------+
```

1. **SHA-256 content hash (`eventHash`)** -- The primary chain hash. Each event's `previousHash` field points to the preceding event's `eventHash`, forming a linked chain identical in principle to a blockchain.

2. **SHA3-256 integrity anchor (`eventHash3`)** -- A secondary hash computed with a different algorithm family (Keccak-based SHA-3). Even if a collision or weakness is discovered in SHA-256, the SHA3-256 anchor provides an independent integrity check.

Content is **canonically serialized** (sorted keys, deterministic JSON) before hashing, guaranteeing that the same logical event always produces the same hash regardless of property insertion order.

**Verification** walks the chain from genesis to tip, recomputing both hashes for every event and confirming that each `previousHash` matches the prior event's `eventHash`. A single mismatch pinpoints the exact tampered record.

## Quick Start

```typescript
import {
  createProofPlane,
  createInMemoryEventStore,
} from '@vorionsys/proof-plane';

// 1. Create an event store (in-memory for dev; use Postgres/Supabase in production)
const store = createInMemoryEventStore();

// 2. Create the proof plane
const proofPlane = createProofPlane({
  signedBy: 'my-service',
  store,
});

// 3. Log governance events
const intentResult = await proofPlane.logIntentReceived(intent);
const decisionResult = await proofPlane.logDecisionMade(decision);

// 4. Retrieve a full request trace by correlation ID
const trace = await proofPlane.getTrace(correlationId);
// Returns: [INTENT_RECEIVED, DECISION_MADE, ...] in chronological order

// 5. Verify chain integrity
const verification = await proofPlane.verifyChain();
console.log(verification.valid);        // true
console.log(verification.verifiedCount); // number of events checked
```

## Usage Examples

### Creating and Chaining Proof Events

```typescript
import { createProofPlane } from '@vorionsys/proof-plane';

const proofPlane = createProofPlane({ signedBy: 'auth-service' });

// Log an intent (first event becomes the genesis -- previousHash is null)
const r1 = await proofPlane.logIntentReceived(intent);
console.log(r1.isGenesis);      // true
console.log(r1.previousHash);   // null

// Log a decision (chains to previous event)
const r2 = await proofPlane.logDecisionMade(decision);
console.log(r2.isGenesis);      // false
console.log(r2.previousHash);   // r1.event.eventHash

// Log execution lifecycle
await proofPlane.logExecutionStarted(executionId, actionId, decisionId, adapterId, agentId, correlationId);
await proofPlane.logExecutionCompleted(executionId, actionId, durationMs, outputHash, agentId, correlationId);

// Log trust score changes
await proofPlane.logTrustDelta(agentId, previousProfile, newProfile, 'Positive behavioral evidence');
```

### Verifying Chain Integrity

```typescript
// Verify the entire chain
const result = await proofPlane.verifyChain();
// {
//   valid: true,
//   verifiedCount: 42,
//   totalEvents: 42,
//   firstEventId: '...',
//   lastEventId: '...'
// }

// Verify a specific correlation chain
const traceResult = await proofPlane.verifyCorrelationChain(correlationId);

// Low-level: verify individual events
import { verifyEventHash, verifyChainWithDetails } from '@vorionsys/proof-plane';

const hashOk = await verifyEventHash(event);       // recompute + compare SHA-256
const details = await verifyChainWithDetails(events); // full chain walk
```

### Querying Audit Records

```typescript
// Get trace for a specific request
const trace = await proofPlane.getTrace(correlationId);

// Get all events for an agent
const history = await proofPlane.getAgentHistory(agentId);

// Query with filters and pagination
const result = await proofPlane.queryEvents(
  { agentId, eventTypes: [ProofEventType.DECISION_MADE] },
  { limit: 50, offset: 0, order: 'desc' }
);
console.log(result.events);
console.log(result.totalCount);
console.log(result.hasMore);

// Get statistics
const stats = await proofPlane.getStats();
// { totalEvents, byType: { INTENT_RECEIVED: 10, ... }, byAgent: { ... } }
```

### Ed25519 Digital Signatures

```typescript
import {
  createProofPlane,
  generateSigningKeyPair,
  createSigningService,
} from '@vorionsys/proof-plane';

// Generate a key pair
const keyPair = await generateSigningKeyPair('auth-service');

// Create a signing service
const signingService = createSigningService({
  serviceId: 'auth-service',
  privateKey: keyPair.privateKey,
  keyId: keyPair.keyId,
  trustedKeys: [{ publicKey: keyPair.publicKey, keyId: keyPair.keyId, owner: 'auth-service' }],
});

// Create proof plane with signing enabled
const proofPlane = createProofPlane({
  signedBy: 'auth-service',
  enableSignatures: true,
  signingService,
});

// Events are now automatically signed
const result = await proofPlane.logIntentReceived(intent);
console.log(result.event.signature); // base64-encoded Ed25519 signature

// Verify signatures
const sigResult = await proofPlane.verifyEventSignature(result.event);
console.log(sigResult.valid); // true

// Verify both chain AND signatures in one call
const fullVerification = await proofPlane.verifyChainAndSignatures();
console.log(fullVerification.fullyVerified); // true
```

### Real-Time Event Subscriptions

```typescript
// Subscribe to all events
const unsubscribe = proofPlane.subscribe((event) => {
  console.log(`[${event.eventType}] ${event.correlationId}`);
});

// Subscribe to specific event types
proofPlane.subscribeToType(ProofEventType.DECISION_MADE, (event) => {
  console.log('Decision:', event.payload);
});

// Unsubscribe when done
unsubscribe();
```

### Custom Event Stores

```typescript
import type { ProofEventStore, EventQueryOptions } from '@vorionsys/proof-plane';

class PostgresEventStore implements ProofEventStore {
  async append(event) { /* INSERT INTO proof_events ... */ }
  async get(eventId) { /* SELECT ... WHERE event_id = $1 */ }
  async getLatest() { /* SELECT ... ORDER BY occurred_at DESC LIMIT 1 */ }
  async getLatestHash() { /* ... */ }
  async query(filter?, options?) { /* ... */ }
  async getByCorrelationId(id, options?) { /* ... */ }
  async getByAgentId(id, options?) { /* ... */ }
  async getByTimeRange(from, to, options?) { /* ... */ }
  async getByType(type, options?) { /* ... */ }
  async getSummaries(filter?, options?) { /* ... */ }
  async getChain(fromEventId?, limit?) { /* ... */ }
  async count(filter?) { /* ... */ }
  async getStats() { /* ... */ }
  async exists(eventId) { /* ... */ }
  async clear() { /* ... */ }
}

const proofPlane = createProofPlane({
  store: new PostgresEventStore(pool),
  signedBy: 'my-service',
});
```

### REST API Routes

```typescript
// Fastify
import Fastify from 'fastify';
import { createProofPlane } from '@vorionsys/proof-plane';
import { registerProofRoutes } from '@vorionsys/proof-plane/api';

const app = Fastify();
const proofPlane = createProofPlane({ signedBy: 'api-service' });

await app.register(async (instance) => {
  registerProofRoutes(instance, proofPlane);
}, { prefix: '/v1' });

// Express
import express from 'express';
import { createProofExpressRouter } from '@vorionsys/proof-plane/api';

const app = express();
const { handler } = createProofExpressRouter(proofPlane);
app.use('/v1', handler);
```

**Available endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/proof` | Submit a new proof event |
| `GET` | `/proof/:id` | Retrieve a proof event by ID |
| `GET` | `/proof/verify/:id` | Verify a single event (hash + signature) |
| `GET` | `/proof/chain/:correlationId` | Get event trace by correlation ID |
| `POST` | `/proof/chain/verify` | Verify chain integrity |
| `GET` | `/proof/stats` | Get event statistics |
| `GET` | `/proof/latest` | Get the most recent event |

See [`openapi.yaml`](./openapi.yaml) for the full OpenAPI 3.1 specification.

## Subpath Imports

The package exposes granular entry points for tree-shaking:

```typescript
// Main entry -- everything
import { createProofPlane, sha256, InMemoryEventStore } from '@vorionsys/proof-plane';

// Events module -- stores, emitter, hash chain, signatures
import { InMemoryEventStore, createEventEmitter } from '@vorionsys/proof-plane/events';

// Proof Plane module -- ProofPlane class and logger
import { ProofPlane, createProofPlaneLogger } from '@vorionsys/proof-plane/proof-plane';

// API module -- REST route handlers
import { createProofRoutes, registerProofRoutes } from '@vorionsys/proof-plane/api';
```

## API Reference

### Core

| Export | Type | Description |
|--------|------|-------------|
| `ProofPlane` | class | Main proof plane class |
| `createProofPlane(config?)` | function | Factory for ProofPlane instances |
| `ProofPlaneConfig` | type | Configuration options (store, signedBy, signatures, shadow mode, hooks) |

### Event Logging (ProofPlane methods)

| Method | Description |
|--------|-------------|
| `logIntentReceived(intent, correlationId?)` | Log an intent submission |
| `logDecisionMade(decision, correlationId?)` | Log an authorization decision |
| `logTrustDelta(agentId, prevProfile, newProfile, reason, correlationId?)` | Log a trust score change |
| `logExecutionStarted(executionId, actionId, decisionId, adapterId, agentId, correlationId)` | Log execution start |
| `logExecutionCompleted(executionId, actionId, durationMs, outputHash, agentId, correlationId, status?)` | Log execution completion |
| `logExecutionFailed(executionId, actionId, error, durationMs, retryable, agentId, correlationId)` | Log execution failure |
| `logEvent(eventType, correlationId, payload, agentId?)` | Log a generic event |

### Querying (ProofPlane methods)

| Method | Description |
|--------|-------------|
| `getEvent(eventId)` | Get event by ID |
| `getLatestEvent()` | Get most recent event |
| `getTrace(correlationId)` | Get all events for a correlation ID |
| `getAgentHistory(agentId, options?)` | Get all events for an agent |
| `getEventsByType(eventType, options?)` | Get events by type |
| `queryEvents(filter?, options?)` | Query with filters and pagination |
| `getEventCount(filter?)` | Count matching events |
| `getStats()` | Get aggregate statistics |

### Verification (ProofPlane methods)

| Method | Description |
|--------|-------------|
| `verifyChain(fromEventId?, limit?)` | Verify hash chain integrity |
| `verifyCorrelationChain(correlationId)` | Verify chain for a correlation ID |
| `verifyEventSignature(event)` | Verify Ed25519 signature on an event |
| `verifySignatures(events)` | Batch signature verification |
| `verifyChainAndSignatures(fromEventId?, limit?)` | Verify both chain and signatures |

### Hash Chain Utilities

| Export | Description |
|--------|-------------|
| `sha256(data)` | Compute SHA-256 hash |
| `sha3_256(data)` | Compute SHA3-256 hash |
| `computeEventHash(event)` | Compute SHA-256 event hash |
| `computeEventHash3(event)` | Compute SHA3-256 event hash |
| `verifyEventHash(event)` | Verify event SHA-256 hash |
| `verifyEventHash3(event)` | Verify event SHA3-256 hash |
| `verifyChainLink(event, previousEvent)` | Verify a single chain link |
| `verifyChain(events)` | Verify a chain of events |
| `verifyChainWithDetails(events)` | Verify chain with detailed results |
| `getGenesisHash()` | Get the genesis hash (null) |

### Event Signatures

| Export | Description |
|--------|-------------|
| `generateSigningKeyPair(owner)` | Generate Ed25519 key pair |
| `signEvent(event, privateKey, signedBy)` | Sign an event |
| `verifyEventSignature(event, publicKey)` | Verify an event signature |
| `verifyEventSignatures(events, signingService)` | Batch verification |
| `EventSigningService` | class | Key management and signing service |
| `createSigningService(config)` | Factory for EventSigningService |

### Event Store

| Export | Description |
|--------|-------------|
| `ProofEventStore` | interface | Abstract storage interface |
| `InMemoryEventStore` | class | Reference in-memory implementation |
| `createInMemoryEventStore()` | Factory for InMemoryEventStore |
| `EventStoreError` | class | Storage error type |
| `EventStoreErrorCode` | enum | Error codes (DUPLICATE_EVENT, NOT_FOUND, etc.) |

### Event Emitter

| Export | Description |
|--------|-------------|
| `ProofEventEmitter` | class | Event creation with hash chaining |
| `createEventEmitter(config)` | Factory for ProofEventEmitter |

### Logger (A3I Bridge)

| Export | Description |
|--------|-------------|
| `ProofPlaneLoggerImpl` | class | Bridges A3I authorization engine to proof plane |
| `createProofPlaneLogger(config)` | Factory for the logger |
| `noopProofPlaneLogger` | No-op logger when proof plane is not connected |

### API Routes

| Export | Description |
|--------|-------------|
| `createProofRoutes(proofPlane)` | Create route definitions |
| `registerProofRoutes(fastify, proofPlane)` | Register routes on a Fastify instance |
| `createProofExpressRouter(proofPlane)` | Create an Express middleware handler |

### Key Types

```typescript
import type {
  ProofPlaneConfig,
  ProofPlaneLogger,
  ProofPlaneLoggerConfig,
  ProofEventStore,
  EventQueryOptions,
  EventQueryResult,
  EventStats,
  EventEmitterConfig,
  EventListener,
  EmitResult,
  BatchEmitOptions,
  BatchEmitResult,
  ChainVerificationResult,
  SigningKeyPair,
  PublicKey,
  SignatureVerificationResult,
  SigningServiceConfig,
  BatchVerificationResult,
  ProofRoute,
} from '@vorionsys/proof-plane';
```

## Shadow Mode (T0 Sandbox)

The proof plane supports **shadow mode** for sandbox and testnet environments. Events emitted in shadow mode are tagged and can be filtered separately, enabling safe experimentation with T0_SANDBOX agents whose events require human-in-the-loop (HITL) verification before counting toward production trust scores.

```typescript
const sandboxPlane = createProofPlane({
  signedBy: 'sandbox-service',
  shadowMode: 'shadow',
  environment: 'testnet',
});

// Query unverified shadow events
const pending = await sandboxPlane.getUnverifiedShadowEvents(agentId);

// Mark a shadow event as HITL-verified
await sandboxPlane.verifyShadowEvent(eventId, verificationId, 'human-reviewer', true);
```

## Architecture

The proof plane sits at the foundation of the Vorion governance stack:

```
+----------------------------+
|     Application Layer      |
+----------------------------+
|     A3I Authorization      |  <-- emits intents & decisions
+----------------------------+
|     PROOF PLANE            |  <-- this package
|  (dual-hash chain +        |
|   Ed25519 signatures)      |
+----------------------------+
|     Event Store            |  <-- pluggable (memory, Postgres, etc.)
+----------------------------+
```

## License

[Apache-2.0](./LICENSE)

## Repository

This package is part of the [Vorion](https://github.com/voriongit/vorion) monorepo.

```
vorion/
  packages/
    proof-plane/    <-- you are here
    contracts/
    ...
```
