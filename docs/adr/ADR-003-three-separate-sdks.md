# ADR-003: Three Separate SDKs with Peer Dependencies

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

Vorion has three distinct products with different audiences:
- Agent Anchor (core trust infrastructure)
- Kaizen (governance engine)
- Cognigate (full platform)

Users may need any combination of these capabilities.

## Decision

Publish three separate SDKs with explicit peer dependency relationships.

### SDK Structure

```
COGNIGATE SDK (Full Stack)
├── includes: Kaizen SDK
└── includes: Agent Anchor SDK

KAIZEN SDK (Governance)
└── peer-depends: Agent Anchor SDK

AGENT ANCHOR SDK (Core)
└── standalone
```

### Package Names

| Product | TypeScript | Python |
|---------|------------|--------|
| Agent Anchor | `@agentanchor/sdk` | `agentanchor` |
| Kaizen | `@vorion/kaizen-sdk` | `vorion-kaizen` |
| Cognigate | `@vorion/cognigate-sdk` | `vorion-cognigate` |

### Usage Patterns

1. **Trust only:** Install Agent Anchor SDK
2. **Trust + Governance:** Install Kaizen SDK (pulls Agent Anchor as peer)
3. **Full platform:** Install Cognigate SDK (includes all)

## Consequences

### Positive

- Users only install what they need
- Clear separation of concerns
- Independent versioning per product
- Smaller bundle sizes for minimal use cases

### Negative

- Peer dependency management complexity
- Version compatibility matrix required
- More packages to publish and maintain

### Mitigations

- Publish compatibility matrix with each release
- Automated compatibility testing in CI
- Clear upgrade guides when breaking changes occur

## Alternatives Considered

1. **Monolithic SDK** - Rejected; forces users to include unused features
2. **Completely independent SDKs** - Rejected; code duplication, version drift
3. **Plugin architecture** - Rejected; over-engineered for current needs

## References

- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md) Section 10
