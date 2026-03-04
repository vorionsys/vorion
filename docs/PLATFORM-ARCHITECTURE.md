# Vorion Platform Architecture

**Version:** 1.1.0
**Date:** 2026-02-03
**Status:** Operational Reference
**Authors:** Vorion Architecture Team
**Supersedes:** Party Mode Architecture Session

> **Cross-References:**
> - **Trust Tier Definitions (T0-T7):** See [ADR-002](adr/ADR-002-8-tier-trust-model.md) - the authoritative source
> - **Business & Governance:** See [MASTER-ARCHITECTURE.md](MASTER-ARCHITECTURE.md) for domains, products, HITL
> - **Agent Identifier Format:** CAR (Categorical Agentic Registry) replaces CAR

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [Agent Lifecycle](#3-agent-lifecycle)
4. [Escalation Paths](#4-escalation-paths)
5. [Multi-Tenancy](#5-multi-tenancy)
6. [API Contracts](#6-api-contracts)
7. [Agent-to-Agent Communication](#7-agent-to-agent-communication)
8. [Persistence Strategy](#8-persistence-strategy)
9. [Versioning Strategy](#9-versioning-strategy)
10. [SDK Language Support](#10-sdk-language-support)
11. [Observability](#11-observability)

---

## 1. Executive Summary

This document defines the operational architecture for the Vorion AI governance platform. It covers the ten critical architectural domains required for production deployment.

### Core Principles

| Principle | Description |
|-----------|-------------|
| **User Decides Risk** | Users set risk tolerance; system enforces tier capability caps |
| **Trust at Runtime** | Trust scores computed dynamically, not embedded in identifiers |
| **Open Standards** | BASIS, CAR, ATSF are open; Kaizen/Cognigate are commercial |
| **A3I Fast Layer** | Agent Anchor AI (A3I) provides caching + batching for speed |
| **Liability Boundaries** | Clear separation between user risk decisions and system enforcement |

### Product Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    COGNIGATE (Full Platform)                │
│                    Full orchestration + runtime              │
├─────────────────────────────────────────────────────────────┤
│                    KAIZEN (Governance Engine)               │
│                    Policy enforcement + execution            │
├─────────────────────────────────────────────────────────────┤
│                    AGENT ANCHOR (Registry + Trust)          │
│                    Identity + scoring + attestations         │
├─────────────────────────────────────────────────────────────┤
│                    A3I (Fast Data Layer)                    │
│                    Cache + queue + batch sync               │
├─────────────────────────────────────────────────────────────┤
│                    BASIS / CAR / ATSF (Open Standards)      │
│                    Schema + identifier + trust factors       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Architecture

### 2.1 Hub and Spoke Model

A3I (Agent Anchor AI) serves as the fast data layer. Agent Anchor remains the authoritative source.

```
                         ┌─────────────────┐
                         │  AGENT ANCHOR   │
                         │   (Authority)   │
                         │  PostgreSQL     │
                         └────────┬────────┘
                                  │
                         Async batch sync
                                  │
                         ┌────────▼────────┐
                         │      A3I        │
                         │  (Fast Layer)   │
                         │  Redis + Queue  │
                         └────────┬────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│    Kaizen     │       │   Cognigate   │       │  Third-Party  │
│   Instance    │       │   Instance    │       │   Consumers   │
└───────────────┘       └───────────────┘       └───────────────┘
```

### 2.2 Write Path

1. Attestation/event occurs at edge (Kaizen/Cognigate)
2. Write to A3I immediately (fast response)
3. A3I batches writes to Agent Anchor (configurable interval)
4. Agent Anchor confirms, A3I marks synced

### 2.3 Read Path

1. Request trust score
2. Check A3I cache first (< 50ms SLA)
3. If miss/stale, fetch from Agent Anchor
4. Cache in A3I with TTL

### 2.4 Batching Configuration

| Layer | Default Batch | Configurable |
|-------|---------------|--------------|
| A3I → Agent Anchor | 100 events or 5s | Yes |
| Kaizen → A3I | 50 events or 2s | Yes |
| Cognigate → A3I | Real-time + batch | Yes |

---

## 3. Agent Lifecycle

### 3.1 State Machine

```
                                    ┌─────────────────┐
                                    │   UNREGISTERED  │
                                    └────────┬────────┘
                                             │
                                    BASIS Compliance Check
                                             │
                                    ┌────────▼────────┐
                           ┌───────►│   T0 SANDBOX    │◄───────┐
                           │        │   (0-199)       │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        Human Approval Gate        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │   T1 OBSERVED   │        │
                           │        │   (200-349)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │  T2 PROVISIONAL │        │
                           │        │   (350-499)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │   T3 MONITORED  │        │
                           │        │   (500-649)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │   T4 STANDARD   │        │
                           │        │   (650-799)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        Human Approval Gate        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │   T5 TRUSTED    │        │
                           │        │   (800-875)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        Human Approval Gate        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │  T6 CERTIFIED   │        │
                           │        │   (876-950)     │        │
                           │        └────────┬────────┘        │
                           │                 │                 │
                           │        Human Approval Gate        │
                           │                 │                 │
                           │        ┌────────▼────────┐        │
                           │        │  T7 AUTONOMOUS  │        │
                           │        │   (951-1000)    │        │
                           │        └─────────────────┘        │
                           │                                   │
                           │                                   │
    ┌──────────────────────┴───────────────────────────────────┴──────────────────────┐
    │                           EXCEPTION STATES                                       │
    ├──────────────────────────────────────────────────────────────────────────────────┤
    │                                                                                  │
    │  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
    │  │ QUARANTINE  │────►│  SUSPENDED  │────►│   REVOKED   │────►│  EXPELLED   │   │
    │  │  (Warning)  │     │  (30 days)  │     │  (6 months) │     │ (Permanent) │   │
    │  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘   │
    │                                                                                  │
    └──────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 State Definitions

| State | Duration | Exit Condition |
|-------|----------|----------------|
| **T0-T7** | Active tiers | Normal operation |
| **Quarantine** | Until resolved | X successful actions to clear |
| **Suspended** | 30 days | Maintenance period ends |
| **Revoked** | 6 months | Review and reinstatement |
| **Expelled** | Permanent | None (banned forever) |

### 3.3 Transition Rules

| Trigger | Result |
|---------|--------|
| 3 quarantines in 30 days | Suspension |
| Quarantine timeout | Suspension |
| 3rd suspension | Revocation |
| 2nd revocation | Expulsion |
| Malicious/harmful intent | Immediate expulsion |

### 3.4 Human Approval Gates

| Transition | Requires Human Approval |
|------------|------------------------|
| T0 → T1 | Yes |
| T1 → T2 | No (automatic if score qualifies) |
| T2 → T3 | No |
| T3 → T4 | No |
| T4 → T5 | Yes |
| T5 → T6 | Yes |
| T6 → T7 | Yes |

### 3.5 CAR Assignment

Agents receive their CAR identifier when they:
1. Pass BASIS compliance validation
2. Enter Agent Anchor registry
3. Begin T0 Sandbox period

---

## 4. Escalation Paths

### 4.1 Escalation Triggers

| Trigger | Severity | Timeout |
|---------|----------|---------|
| Trust score drops below tier minimum | Medium | 15 min |
| Policy violation detected | High | 5 min |
| Anomalous behavior pattern | Medium | 30 min |
| Cross-tier operation attempt | High | Immediate |
| A2A trust mismatch | Medium | 10 min |
| Rate limit exceeded (3x) | Low | 1 hour |

### 4.2 Escalation Flow

```
┌─────────────┐
│   Trigger   │
│  Detected   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Auto-Hold  │────►│   Notify    │
│  Operation  │     │   Owner     │
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│   Awaiting  │
│   Decision  │
└──────┬──────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
┌─────┐ ┌─────┐
│ALLOW│ │DENY │
└──┬──┘ └──┬──┘
   │       │
   ▼       ▼
┌─────┐ ┌─────────┐
│Resume│ │Quarantine│
└─────┘ │or Suspend│
        └─────────┘
```

### 4.3 Timeout Policies

| Severity | Auto-Deny After | Auto-Allow After |
|----------|-----------------|------------------|
| Low | 24 hours | Never |
| Medium | 4 hours | Never |
| High | 1 hour | Never |
| Critical | 15 minutes | Never |

---

## 5. Multi-Tenancy

### 5.1 Tenant Model

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT ANCHOR (Authority)                 │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Org: acme   │  │ Org: vorion  │  │ Org: startup │      │
│  │ ─────────────│  │ ─────────────│  │ ─────────────│      │
│  │ Envs:        │  │ Envs:        │  │ Envs:        │      │
│  │  - sandbox   │  │  - sandbox   │  │  - sandbox   │      │
│  │  - staging   │  │  - staging   │  │  - prod      │      │
│  │  - prod      │  │  - prod      │  │              │      │
│  │              │  │              │  │              │      │
│  │ Agents: 50   │  │ Agents: 200  │  │ Agents: 5    │      │
│  │ Tier: Ent    │  │ Tier: Ent    │  │ Tier: Free   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Isolation Strategy

| Layer | Isolation Method | Scope |
|-------|------------------|-------|
| Data | Tenant ID on all records | Agent Anchor, A3I |
| Compute | Namespace isolation | Kaizen, Cognigate |
| Trust | Per-tenant trust contexts | BASIS scoring |
| Registry | Org-scoped CAR namespaces | `{registry}.{org}.*` |

### 5.3 Tenant Types

| Type | Use Case | Billing |
|------|----------|---------|
| **Free** | Solo devs, OSS | Pay-per-call past threshold |
| **Organization** | Companies | Subscription + usage |
| **Enterprise** | Custom SLAs | Negotiated contracts |

### 5.4 Federation Model

| Visibility | Description |
|------------|-------------|
| **Private** | Only visible within tenant |
| **Public** | Org marks agents as "discoverable" |
| **Partner** | Explicit grant to specific orgs |

### 5.5 Tenant Context

```typescript
interface TenantContext {
  tenantId: string;           // UUID
  orgSlug: string;            // From CAR: {registry}.{orgSlug}.*
  environment: 'sandbox' | 'staging' | 'production';
  quotas: TenantQuotas;
  isolationLevel: 'shared' | 'dedicated';
}
```

---

## 6. API Contracts

### 6.1 API Surface

| Product | API Type | Purpose |
|---------|----------|---------|
| **Agent Anchor** | REST + WebSocket | Registry, trust, attestations |
| **A3I** | gRPC + REST | Fast cache, batch sync |
| **Kaizen** | REST | Governance, policy execution |
| **Cognigate** | REST + WebSocket | Full orchestration |

### 6.2 Agent Anchor API v1

```yaml
/agents:
  POST:   # Register new agent (returns CAR)
  GET:    # List org agents (paginated)

/agents/{car}:
  GET:    # Get agent identity details (CAR metadata)
  PATCH:  # Update agent metadata
  DELETE: # Deregister agent

/agents/{car}/trust:
  GET:    # Real-time trust score from ATSF (looked up by CAR ID, not part of CAR itself)

/agents/{car}/attestations:
  POST:   # Submit attestation
  GET:    # List attestations

/agents/{car}/lifecycle:
  POST:   # Trigger state transition

/query:
  POST:   # Search agents by criteria

/validate:
  POST:   # Validate CAR string
```

### 6.3 Response Envelope

```typescript
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}
```

### 6.4 Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AGENT_NOT_FOUND` | 404 | CAR not registered |
| `TRUST_INSUFFICIENT` | 403 | Below required tier |
| `QUOTA_EXCEEDED` | 429 | Rate/usage limit hit |
| `INVALID_CAR` | 400 | Malformed CAR string |
| `LIFECYCLE_BLOCKED` | 409 | Transition not allowed |

### 6.5 Versioning

```
/v1/agents/{car}          # Current stable
/v2/agents/{car}          # Next major
/beta/agents/{car}        # Experimental
```

**Deprecation:** v(N-1) supported 12 months after v(N) release.

---

## 7. Agent-to-Agent Communication

### 7.1 Communication Models

| Model | Use Case | Trust Check |
|-------|----------|-------------|
| **Direct** | A calls B's endpoint | Caller ≥ callee's minimum |
| **Brokered** | Via Cognigate | Both validated by broker |
| **Federated** | Cross-org calls | Mutual attestation required |

### 7.2 A2A Request Structure

```typescript
interface A2ARequest {
  caller: {
    car: string;
    signature: string;
    nonce: string;
  };
  target: {
    car: string;
    endpoint: string;
    requiredTrust?: number;
  };
  action: string;
  payload: unknown;
  trustContext: {
    callerScore: number;
    attestationChain?: string[];
  };
}
```

### 7.3 Trust Negotiation Flow

```
Agent A (T4)  ──────▶  Agent B (requires T3+)
     │                        │
     │   1. Present CAR       │
     │   2. Request trust     │
     │─────────────────────────
     │                        │
     ◀────────────────────────│
         3. Trust score       │
            returned          │
                              │
     ────────────────────────▶│
         4. Call proceeds     │
            (T4 ≥ T3) ✓       │
```

### 7.4 Trust Inheritance Rules

| Scenario | Rule |
|----------|------|
| Chained calls | Trust = min(all agents in chain) |
| Parallel calls | Each pair validated independently |
| Async callbacks | Original context preserved |

### 7.5 A2A Attestation Record

```typescript
interface A2AAttestation {
  caller: string;
  callee: string;
  action: string;
  timestamp: string;
  outcome: 'success' | 'denied' | 'error';
  trustAtCall: {
    caller: number;
    calleeMin: number;
  };
}
```

---

## 8. Persistence Strategy

### 8.1 Storage Technology Mapping

```
┌─────────────────────────────────────────────────────────────┐
│                     PERSISTENCE LAYER                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  PostgreSQL  │  │    Redis     │  │  TimescaleDB │       │
│  │  • Agents    │  │  • A3I cache │  │  • A2A logs  │       │
│  │  • Orgs      │  │  • Sessions  │  │  • Metrics   │       │
│  │  • Policies  │  │  • Rate lim  │  │  • Signals   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │  S3 / Blob   │  │  EventStore  │                         │
│  │  • Archives  │  │  • Attests   │                         │
│  │  • Backups   │  │  • Lifecycle │                         │
│  │  • Audit     │  │  • Events    │                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Data Lifecycle

| Data Type | Hot | Warm | Cold |
|-----------|-----|------|------|
| Agent records | Always | — | — |
| Trust scores | 24h cache | 30d history | Yearly |
| Attestations | 90 days | 2 years | 7 years |
| A2A interactions | 7 days | 90 days | 1 year |
| Behavioral raw | 24 hours | — | Aggregates |

### 8.3 Tenant Data Isolation

```typescript
interface TenantPartitionedTable {
  tenant_id: string;        // Partition key
  // ... columns
  // Indexes always include tenant
  // Queries always filter by tenant
}
```

### 8.4 Backup & Recovery

| Component | RPO | RTO | Method |
|-----------|-----|-----|--------|
| PostgreSQL | 1 min | 15 min | Streaming + PITR |
| Redis | 5 min | 5 min | RDB + AOF |
| EventStore | 0 | 30 min | Multi-node cluster |
| Blob storage | 0 | 1 hour | Cross-region |

---

## 9. Versioning Strategy

### 9.1 What Gets Versioned

| Entity | Format | When Bumped |
|--------|--------|-------------|
| CAR (Agent) | `@MAJOR.MINOR.PATCH` | Capability changes |
| APIs | `/v1/`, `/v2/` | Breaking changes |
| SDKs | SemVer | Any release |
| Specs | SemVer in doc | Spec updates |
| Trust Factors | Schema version | Weight changes |

### 9.2 Version Lifecycle

```
alpha ──▶ beta ──▶ rc ──▶ stable ──▶ deprecated ──▶ sunset
                          │
                          └── LTS (optional)
```

### 9.3 Deprecation Policy

| Phase | Duration | Behavior |
|-------|----------|----------|
| Active | Current | Full support |
| Deprecated | 6 months | Sunset-Header warnings |
| Sunset | 3 months | 410 Gone after date |
| Removed | — | Not available |

### 9.4 Agent Version Transitions

| Change | Trust | Notification |
|--------|-------|--------------|
| PATCH | Preserved | None |
| MINOR | Preserved | Optional |
| MAJOR | Re-evaluated | Mandatory |

### 9.5 SDK Compatibility Matrix

```yaml
agent-anchor-sdk:
  version: "2.1.0"
  compatible:
    kaizen-sdk: ">=1.5.0 <3.0.0"
    cognigate-sdk: ">=1.0.0"
  api-versions:
    - "v1"
    - "v2"
```

---

## 10. SDK Language Support

### 10.1 Language Priority

| Language | Priority | Rationale |
|----------|----------|-----------|
| TypeScript | P0 | Reference implementation |
| Python | P0 | AI/ML dominant |
| Go | P1 | Cloud native |
| Rust | P1 | Performance critical |
| Java/Kotlin | P2 | Enterprise |
| C#/.NET | P2 | Enterprise |

### 10.2 Package Distribution

| Language | Registry | Package |
|----------|----------|---------|
| TypeScript | npm | `@agentanchor/sdk` |
| Python | PyPI | `agentanchor` |
| Go | go.dev | `github.com/agentanchor/agentanchor-go` |
| Rust | crates.io | `agentanchor` |
| Java | Maven | `io.agentanchor:sdk` |
| C# | NuGet | `AgentAnchor.SDK` |

### 10.3 SDK Composition

```
COGNIGATE SDK (Full Stack)
├── includes: Kaizen SDK
└── includes: Agent Anchor SDK

KAIZEN SDK (Governance)
└── peer-depends: Agent Anchor SDK

AGENT ANCHOR SDK (Core)
└── standalone
```

### 10.4 Idiomatic Examples

**TypeScript:**
```typescript
import { AgentAnchor } from '@agentanchor/sdk';
const anchor = new AgentAnchor({ apiKey: '...' });
const score = await anchor.getTrustScore('a3i.vorion.my-agent:FHC-L3@1.0.0'); // CAR identifier
```

**Python:**
```python
from agentanchor import AgentAnchor
anchor = AgentAnchor(api_key="...")
score = await anchor.get_trust_score("a3i.vorion.my-agent:FHC-L3@1.0.0")  # CAR identifier
```

**Go:**
```go
import "github.com/agentanchor/agentanchor-go"
anchor := agentanchor.New(agentanchor.WithAPIKey("..."))
score, err := anchor.GetTrustScore(ctx, "a3i.vorion.my-agent:FHC-L3@1.0.0") // CAR identifier
```

### 10.5 Release Cadence

| SDK | Frequency | Trigger |
|-----|-----------|---------|
| TypeScript | Weekly | API changes |
| Python | Weekly | Parity with TS |
| Go | Bi-weekly | Parity |
| Rust | Monthly | Catch-up |

---

## 11. Observability

### 11.1 Three Pillars + Trust Signals

| Pillar | Purpose | Tools |
|--------|---------|-------|
| Metrics | Quantitative health | Prometheus, Grafana |
| Logs | Event records | Loki, ELK |
| Traces | Request flows | Jaeger, OpenTelemetry |
| Trust Signals | Behavioral patterns | Custom pipeline |

### 11.2 Telemetry Pipeline

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Agent   │  │ A3I     │  │ Kaizen  │  │Cognigate│
│ Anchor  │  │         │  │         │  │         │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │
     └────────────┴────────────┴────────────┘
                       │
            OpenTelemetry Collector
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
┌─────────┐      ┌─────────┐      ┌─────────┐
│Prometheus│      │  Loki   │      │  Tempo  │
│ Metrics │      │  Logs   │      │ Traces  │
└────┬────┘      └────┬────┘      └────┬────┘
     └─────────────────┴─────────────────┘
                       │
                  ┌────▼────┐
                  │ Grafana │
                  └─────────┘
```

### 11.3 Key Metrics

```typescript
const METRICS = {
  // API health
  'aa_request_total': Counter,
  'aa_request_duration_ms': Histogram,
  'aa_error_rate': Gauge,

  // Trust operations
  'aa_trust_score_calculations': Counter,
  'aa_attestations_received': Counter,

  // Lifecycle
  'aa_agents_registered': Gauge,
  'aa_agents_by_tier': Gauge,
  'aa_state_transitions': Counter,

  // A3I cache
  'a3i_cache_hit_rate': Gauge,
  'a3i_sync_lag_ms': Gauge,
};
```

### 11.4 Alerting Thresholds

| Alert | Condition | Severity |
|-------|-----------|----------|
| High error rate | >1% for 5min | P1 |
| Trust calc latency | p99 > 500ms | P2 |
| A3I sync lag | >30s | P1 |
| Quarantine spike | >10/hour | P2 |
| Escalation storm | >5/hour | P1 |

### 11.5 SLO Definitions

| SLO | Target |
|-----|--------|
| Availability | 99.9% |
| Trust Calc Latency | p99 < 200ms |
| A3I Cache Freshness | < 5s stale |
| Attestation Processing | < 1s |
| Escalation Response | < 15min |

### 11.6 Log Structure

```json
{
  "timestamp": "2026-01-31T12:00:00Z",
  "level": "info",
  "service": "agent-anchor",
  "trace_id": "abc123",
  "tenant_id": "vorion",
  "event": "trust_score_calculated",
  "car": "a3i.vorion.my-agent:FHC-L3@1.0.0",
  "score": 742,
  "tier": "T4",
  "duration_ms": 12
}
```

---

## Appendix A: Quick Reference

### CAR Format

```
{registry}.{org}.{agentClass}:{domains}-L{level}@{version}
```

Example: `a3i.vorion.banquet-advisor:FHC-L3@1.2.0`

### Domain Codes

| Code | Domain |
|------|--------|
| A | Administration |
| B | Business |
| C | Communications |
| D | Data |
| E | External |
| F | Finance |
| G | Governance |
| H | Hospitality |
| I | Infrastructure |
| S | Security |

### Trust Tiers

| Tier | Name | Range |
|------|------|-------|
| T0 | Sandbox | 0-199 |
| T1 | Observed | 200-349 |
| T2 | Provisional | 350-499 |
| T3 | Monitored | 500-649 |
| T4 | Standard | 650-799 |
| T5 | Trusted | 800-875 |
| T6 | Certified | 876-950 |
| T7 | Autonomous | 951-1000 |

---

*Document Version: 1.0.0*
*Created: 2026-01-31*
*Authors: Vorion Architecture Team*
