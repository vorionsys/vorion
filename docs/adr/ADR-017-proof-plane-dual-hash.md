# ADR-017: Proof Plane with Dual-Hash Audit Chain

**Status:** Accepted
**Date:** 2026-02-11
**Deciders:** Vorion Architecture Team

## Context

AI governance decisions -- trust score changes, role grants, policy evaluations, ceiling enforcements -- require cryptographic proof for regulatory compliance (NIST AI RMF, EU AI Act). Every governance action must be independently verifiable by external auditors without trusting the platform itself. Traditional audit logging is insufficient because logs can be silently modified or deleted. The platform needs tamper-evident, append-only records that provide cryptographic guarantees of integrity.

## Decision

Implement a **Proof Plane** -- a dual-hash append-only audit chain that cryptographically binds every governance decision into a verifiable sequence.

### Design

1. **Every governance decision produces a proof record** -- trust score changes, role grants, policy evaluations, and ceiling enforcements all emit records
2. **Each record is hashed with SHA-256 AND SHA3-256** (dual-hash for algorithm agility)
3. **Records chain together** -- each proof includes the hash of the previous proof, forming an append-only chain
4. **Verification endpoint** `GET /api/v1/verify/:proof_hash` allows independent verification without platform trust
5. **RLS enforces append-only** -- `INSERT` allowed, `UPDATE`/`DELETE` denied even for the service role

### Key Components

| Component | Purpose |
|-----------|---------|
| `packages/proof-plane/` | Core proof generation, hashing, and chain verification logic |
| `ProofRecord` type | `id`, `tenantId`, `eventType`, `payload`, `sha256Hash`, `sha3Hash`, `previousHash`, `timestamp` |
| Merkle tree batching | Periodic anchoring of proof batches for efficient bulk verification |

### Hash Strategy

Dual-hashing every record with both SHA-256 and SHA3-256 provides an algorithm migration path. If SHA-256 is weakened, SHA3-256 hashes remain valid and the chain can transition without re-hashing historical records.

## Consequences

### Positive

- **Tamper-evident audit trail** -- any modification breaks the hash chain and is immediately detectable
- **Cryptographically verifiable by external auditors** -- no platform trust required
- **Dual-hash provides algorithm migration path** -- SHA-256 to SHA3 transition without chain rebuild
- **Satisfies NIST AI RMF "Govern" function** requirements for auditable AI decision records
- **Chain integrity detectable via hash verification** -- O(1) for single record, full chain auditable on demand

### Negative

- **Append-only means no correction of bad records** -- erroneous entries must be corrected by appending correction records
- **Dual-hash doubles compute** for each proof generation
- **Storage grows monotonically** -- records are never deleted; requires retention and archival strategy
- **Hash chain verification is O(n)** for full chain validation

## Alternatives Considered

| Alternative | Why Not |
|-------------|---------|
| **Single-hash chain (SHA-256 only)** | Simpler but no algorithm agility; migration would require chain rebuild |
| **Blockchain anchoring** | Expensive and operationally complex; overkill for single-organization audit |
| **Traditional audit logging** | Not cryptographically verifiable; logs can be silently altered |

## References

- [NIST AI Risk Management Framework](https://www.nist.gov/artificial-intelligence/risk-management-framework)
- [EU AI Act](https://artificialintelligenceact.eu/)
- [ADR-002: 8-Tier Trust Model](ADR-002-8-tier-trust-model.md)
