# ADR-005: Proof Plane Dual-Hash Audit Chain

## Status: Accepted

## Date: 2026-02-25

## Context

AI governance decisions -- trust score changes, role grants, policy evaluations, ceiling enforcements, intent authorizations, execution outcomes -- require cryptographic proof for regulatory compliance. NIST AI RMF (GOVERN, MEASURE functions), EU AI Act (Article 12 record-keeping), and ISO 42001 mandate independently verifiable audit trails. Traditional application-level logging is insufficient because:

1. Logs can be silently modified or deleted by anyone with database access.
2. Log integrity depends entirely on application-level access controls, which are a single point of failure.
3. Logs provide no cryptographic binding between records -- inserting, removing, or reordering entries is undetectable.

Vorion needed an audit system that provides tamper-evidence as a structural property of the data itself, independent of who has access to the database.

## Decision

Implement a **Proof Plane** -- a dual-hash append-only audit chain in `packages/proof-plane/` that cryptographically binds every governance decision into a verifiable sequence.

### Architecture

The Proof Plane consists of four modules:

```
packages/proof-plane/src/
  proof-plane/
    proof-plane.ts   -- High-level API (ProofPlane class)
    logger.ts        -- Structured logging
  events/
    hash-chain.ts    -- SHA-256 + SHA3-256 dual hashing, chain verification
    event-emitter.ts -- Event creation, serialized chaining, batch emit
    event-store.ts   -- Store interface (abstract)
    memory-store.ts  -- In-memory implementation for testing
    merkle-tree.ts   -- Binary Merkle tree for batch verification
    event-signatures.ts -- Ed25519 digital signatures
  api/
    routes.ts        -- Verification API endpoints
```

### Dual-Hash Design

Every proof event is hashed with **both SHA-256 and SHA3-256**:

```typescript
// hash-chain.ts
export async function computeEventHash(
  event: Omit<ProofEvent, 'eventHash' | 'recordedAt'>
): Promise<string> {
  const hashable = getHashableData(event);
  const sortedHashable = sortObjectKeys(hashable);  // Deterministic serialization
  const serialized = JSON.stringify(sortedHashable);
  return sha256(serialized);                          // Primary chain hash
}

export function computeEventHash3(
  event: Omit<ProofEvent, 'eventHash' | 'eventHash3' | 'recordedAt'>
): string {
  const hashable = getHashableData(event);
  const sortedHashable = sortObjectKeys(hashable);
  const serialized = JSON.stringify(sortedHashable);
  return sha3_256(serialized);                        // Integrity anchor hash
}
```

**Why dual-hash?** SHA-256 (NIST FIPS 180-4) and SHA3-256 (NIST FIPS 202) are cryptographically independent algorithms built on different mathematical foundations (Merkle-Damgard vs. Keccak sponge). If a practical attack is discovered against SHA-256, the SHA3-256 hashes remain valid. The chain can transition to SHA3-256 as the primary hash without re-hashing historical records.

### Hash Chain Linking

Each event stores the SHA-256 hash of the previous event, forming a linear chain:

```
Event N:  { payload, previousHash: hash(Event N-1), eventHash: hash(self), eventHash3: sha3(self) }
Event N-1: { payload, previousHash: hash(Event N-2), eventHash: hash(self), eventHash3: sha3(self) }
...
Event 0 (genesis): { payload, previousHash: null, eventHash: hash(self), eventHash3: sha3(self) }
```

The `hashableData` includes: `eventId`, `eventType`, `correlationId`, `agentId`, `payload`, `previousHash`, `occurredAt`, `signedBy`, and `signature`. Object keys are recursively sorted before serialization to ensure deterministic hashing regardless of property insertion order.

### Serialized Emission

The `ProofEventEmitter` uses a lock-based serialization mechanism to guarantee correct chaining under concurrent writes:

```typescript
private async serializedEmit(request: LogProofEventRequest): Promise<EmitResult> {
  const previousLock = this.emitLock;
  let resolve: () => void;
  this.emitLock = new Promise(r => { resolve = r; });
  try {
    await previousLock;
    return await this.createAndStoreEvent(request);
  } finally {
    resolve!();
  }
}
```

This ensures that even under concurrent governance decisions, events are chained in a deterministic order with correct `previousHash` linkage.

### Event Types

The Proof Plane logs typed events for each governance action:

| Event Type | Trigger | Payload |
|-----------|---------|---------|
| `INTENT_RECEIVED` | Agent submits an action intent | `intentId`, `action`, `actionType`, `resourceScope` |
| `DECISION_MADE` | Authorization decision issued | `decisionId`, `intentId`, `permitted`, `trustBand`, `trustScore`, `reasoning` |
| `TRUST_DELTA` | Trust score changes | `previousScore`, `newScore`, `previousBand`, `newBand`, `reason` |
| `EXECUTION_STARTED` | Authorized action begins | `executionId`, `actionId`, `decisionId`, `adapterId` |
| `EXECUTION_COMPLETED` | Action completes | `executionId`, `status`, `durationMs`, `outputHash` |
| `EXECUTION_FAILED` | Action fails | `executionId`, `error`, `durationMs`, `retryable` |
| `COMPONENT_UPDATED` | System state change | Generic payload (used for shadow verification events) |

### Ed25519 Digital Signatures

Events can optionally be signed with Ed25519 for authenticity and non-repudiation:

- **Key generation** via Web Crypto API (`crypto.subtle.generateKey('Ed25519')`).
- **Signing** occurs before hash computation -- the signature is included in the hash input, binding the signature to the chain.
- **Verification** via `EventSigningService` with a trusted key registry. Batch verification supports auditing entire chains.
- **Signing service** is injected into the `ProofPlane` via configuration, keeping key management external to the audit logic.

### Merkle Tree Aggregation

The `MerkleTree` class in `events/merkle-tree.ts` provides batch verification:

- Standard binary Merkle tree with SHA-256 internal hashing.
- Odd leaf counts handled by duplicating the last node.
- `getProof(leafIndex)` returns a proof-of-inclusion with sibling hashes and positions.
- `verify(leaf, proof, root)` validates inclusion in O(log n) without requiring the full dataset.

Merkle roots are periodically computed over batches of proof events for efficient bulk verification and potential external anchoring (blockchain, RFC 3161 timestamp authorities).

### Chain Verification

```typescript
// Verify entire chain integrity
const result = await proofPlane.verifyChain();
// result: { valid: boolean, verifiedCount: number, totalEvents: number, brokenAtEventId?: string }

// Verify chain AND signatures
const full = await proofPlane.verifyChainAndSignatures();
// full: { chain: ChainVerificationResult, signatures: BatchVerificationResult, fullyVerified: boolean }
```

Verification checks three properties for each event:
1. **SHA-256 hash integrity** -- Recompute the hash from the event data and compare to stored `eventHash`.
2. **SHA3-256 integrity anchor** -- Recompute and compare to stored `eventHash3` (gracefully skipped for pre-upgrade records).
3. **Chain link validity** -- Verify `event.previousHash === previousEvent.eventHash`.

### Shadow Mode (T0 Sandbox)

Events from T0_SANDBOX agents are tagged with `shadowMode: 'shadow' | 'testnet'` and require Human-in-the-Loop (HITL) verification before counting toward production trust scores. Shadow verification creates a new event (not modifying the original), preserving append-only semantics.

## Consequences

### Positive

- **Tamper-evident audit trail** -- Any modification to a proof record (insert, update, delete, reorder) breaks the hash chain and is immediately detectable via `verifyChain()`.
- **Algorithm migration path** -- Dual SHA-256 + SHA3-256 hashing means SHA-256 deprecation does not require re-hashing historical records.
- **Independently verifiable** -- External auditors can verify chain integrity without trusting the platform. The verification logic is self-contained in `hash-chain.ts`.
- **Non-repudiation via Ed25519 signatures** -- When signing is enabled, events are cryptographically attributable to specific service components.
- **Efficient batch verification** -- Merkle tree aggregation enables O(log n) proof-of-inclusion for individual events without scanning the entire chain.
- **Regulatory compliance** -- Satisfies NIST AI RMF GOVERN/MEASURE functions, EU AI Act Article 12 record-keeping, and ISO 42001 audit trail requirements.

### Negative

- **Append-only means no correction** -- Erroneous proof records cannot be modified. Corrections must be recorded as new events referencing the original, increasing storage and complexity.
- **Dual-hash doubles computation** -- Every proof record requires two independent hash computations (SHA-256 via Web Crypto + SHA3-256 via Node.js `crypto`).
- **Storage grows monotonically** -- Proof records are never deleted. Requires retention policies and archival strategy for long-lived deployments.
- **Full chain verification is O(n)** -- Verifying the entire chain from genesis scales linearly. Merkle tree batching mitigates this for subset verification.
- **Serialized emission** -- The lock-based serialization mechanism limits proof event throughput to sequential writes within a single `ProofPlane` instance.

### Mitigations

- Correction events carry a `correction_for` reference to the original event, enabling auditors to trace the full history.
- Batch Merkle roots provide efficient checkpoints -- full chain verification only needed between the last checkpoint and the current head.
- Archival strategy planned: older proof batches anchored externally (blockchain, RFC 3161) and compressed.
- Multiple `ProofPlane` instances can operate on per-tenant chains for horizontal scaling.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Single-hash chain (SHA-256 only)** | No algorithm migration path. If SHA-256 is weakened, the entire chain must be re-hashed or abandoned. |
| **Blockchain-native storage** | Expensive per-record gas costs. Operationally complex. Overkill for single-organization audit where the threat model is internal tampering, not decentralized consensus. |
| **Traditional audit logging (INSERT-only table)** | Not cryptographically verifiable. An administrator with database access can silently modify or delete records. No chain integrity guarantee. |
| **RFC 3161 Timestamp Authority only** | Provides timestamping but not content integrity or chaining. Does not prevent record modification between timestamps. Planned as an enhancement for external anchoring of Merkle roots. |

## References

- [Proof Plane source code](/packages/proof-plane/src/)
- [Hash chain implementation](/packages/proof-plane/src/events/hash-chain.ts)
- [Merkle tree implementation](/packages/proof-plane/src/events/merkle-tree.ts)
- [Event emitter with serialized chaining](/packages/proof-plane/src/events/event-emitter.ts)
- [Ed25519 signature service](/packages/proof-plane/src/events/event-signatures.ts)
- [Proof database schema](/packages/contracts/src/db/proofs.ts)
- [NIST AI RMF](https://www.nist.gov/artificial-intelligence/risk-management-framework)
- [EU AI Act Article 12](https://artificialintelligenceact.eu/)
