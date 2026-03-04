# ADR-001: A3I as Fast Data Layer

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

Agent Anchor serves as the authoritative source for agent registration, trust scores, and attestations. However, real-time operations (trust score lookups, attestation ingestion) require sub-50ms response times that direct database queries cannot consistently provide.

## Decision

Introduce A3I (Agent Anchor AI) as a dedicated fast data layer between consuming services (Kaizen, Cognigate, third-party) and Agent Anchor.

### Architecture

```
Consumers → A3I (Redis + Queue) → Agent Anchor (PostgreSQL)
```

### Responsibilities

| Component | Role |
|-----------|------|
| A3I | Cache, queue, batch, fast reads |
| Agent Anchor | Authority, persistence, validation |

### Data Flow

- **Writes:** Go to A3I first, batch-synced to Agent Anchor
- **Reads:** A3I cache with TTL, fallback to Agent Anchor

## Consequences

### Positive

- Sub-50ms read latency SLA achievable
- Scales horizontally for high-volume attestation ingestion
- Reduces load on primary database
- Configurable batching for cost optimization

### Negative

- Eventual consistency between A3I and Agent Anchor
- Additional infrastructure to maintain
- Potential for stale data in cache

### Mitigations

- Maximum cache TTL of 5 seconds for critical data
- Sync lag monitoring with P1 alerts at 30s
- Guaranteed delivery queue for write path

## Alternatives Considered

1. **Direct database access** - Rejected due to latency requirements
2. **Read replicas only** - Rejected; doesn't solve write batching
3. **Edge caching (CDN)** - Rejected; insufficient for dynamic trust data

## References

- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md) Section 2
