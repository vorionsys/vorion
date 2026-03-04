# Vorion Architecture Overview

Vorion is an AI Governance Platform that provides trust-based execution control, policy enforcement, and audit capabilities for AI agents. This document provides a high-level overview of the system architecture.

## System Overview

Vorion enables organizations to safely deploy AI agents by:

- **Trust Scoring**: Behavioral trust calculation with an 8-tier model (T0-T7)
- **Intent Processing**: Goal-based request handling with validation and consent management
- **Policy Enforcement**: Rule evaluation and constraint application
- **Execution Control**: Constrained execution with resource limits and graceful degradation
- **Security**: Multi-layered authentication including DPoP, CSRF, MFA, and session management
- **Audit Trail**: Cryptographic proof chain for compliance (GDPR, SOC2, FedRAMP)

## Core Components Diagram

```
+-------------------+     +-------------------+     +-------------------+
|                   |     |                   |     |                   |
|  External Agent   +---->+   API Gateway     +---->+  Intent Service   |
|                   |     |   (Fastify)       |     |                   |
+-------------------+     +--------+----------+     +--------+----------+
                                   |                         |
                                   v                         v
                          +--------+----------+     +--------+----------+
                          |                   |     |                   |
                          |  Security Layer   |     |  Trust Engine     |
                          |  - DPoP           |     |  - Score Calc     |
                          |  - CSRF           |     |  - Trust Tiers    |
                          |  - MFA            |     |  - Decay/Signals  |
                          |  - Sessions       |     |                   |
                          +--------+----------+     +--------+----------+
                                   |                         |
                                   v                         v
                          +--------+----------+     +--------+----------+
                          |                   |     |                   |
                          |  RBAC Service     |     |  BASIS Engine     |
                          |  - Roles          |     |  - Rule Eval      |
                          |  - Permissions    |     |  - Expressions    |
                          |  - Authorization  |     |  - Namespaces     |
                          +--------+----------+     +--------+----------+
                                   |                         |
                                   v                         v
                          +--------+----------+     +--------+----------+
                          |                   |     |                   |
                          |  ENFORCE Module   +---->+  Cognigate        |
                          |  - Policy Engine  |     |  - Execution      |
                          |  - Constraints    |     |  - Resources      |
                          |  - Decisions      |     |  - Degradation    |
                          +-------------------+     +-------------------+
                                   |
                                   v
                          +-------------------+
                          |                   |
                          |  Proof Chain      |
                          |  - Merkle Tree    |
                          |  - Audit Log      |
                          |  - Compliance     |
                          +-------------------+
```

## Data Flow

### Intent Lifecycle

1. **Submission**: Agent submits intent with goal, context, and metadata
2. **Validation**: Schema validation, payload limits, deduplication
3. **Consent Check**: GDPR data processing consent verification
4. **Trust Gate**: Minimum trust level enforcement
5. **Evaluation**: BASIS rule engine processes intent against policies
6. **Decision**: ENFORCE module produces allow/deny/escalate decision
7. **Execution**: Cognigate executes approved intents with constraints
8. **Proof**: Cryptographic record appended to audit chain

```
Submit --> Validate --> Consent --> Trust Gate --> Evaluate --> Decide --> Execute --> Proof
   |                                    |              |           |          |         |
   v                                    v              v           v          v         v
 Intent                              Trust         BASIS       ENFORCE   Cognigate   Merkle
Service                              Engine        Rules       Policy    Gateway      Tree
```

### Trust Calculation Flow

1. **Signal Collection**: Behavioral, compliance, identity, context signals
2. **Component Scoring**: Weighted calculation per component (0-1)
3. **Aggregate Score**: Combined score (0-1000 scale)
4. **Tier Assignment**: Map score to trust tier (T0-T7)
5. **Decay Application**: 182-day half-life stepped decay

```
Signals --> Components --> Aggregate --> Tier --> Decay --> Effective Trust
```

## Technology Stack

### Runtime
- **Node.js** (v20+) - Runtime environment
- **TypeScript** - Type-safe development
- **Fastify** - High-performance HTTP server
- **Zod** - Runtime schema validation

### Data Layer
- **PostgreSQL** - Primary database with JSONB support
- **Drizzle ORM** - Type-safe database operations
- **Redis** - Caching, sessions, rate limiting, distributed locks

### Security
- **DPoP (RFC 9449)** - Sender-constrained tokens
- **HMAC-SHA256** - CSRF token signing
- **TOTP (RFC 6238)** - Multi-factor authentication
- **Encrypted Sessions** - Redis-backed session store

### Observability
- **Prom-client** - Prometheus metrics
- **Structured Logging** - JSON logging with correlation IDs
- **OpenTelemetry** - Distributed tracing support

### Compliance
- **GDPR** - Consent management, data retention
- **SOC2** - Audit logging, access controls
- **FedRAMP** - Continuous monitoring support

## Key Design Principles

1. **Trust-First Architecture**: All operations are governed by trust scores and tiers
2. **Defense in Depth**: Multiple security layers (DPoP + CSRF + MFA + RBAC)
3. **Graceful Degradation**: Progressive capability reduction vs. hard termination
4. **Tenant Isolation**: Multi-tenant with strict data boundaries
5. **Audit Everything**: Cryptographic proof chain for all decisions
6. **Redis Optionality**: Memory adapters for development/testing

## Module Organization

```
packages/platform-core/src/
+-- a2a/              # Agent-to-Agent Protocol
+-- agent-registry/   # Agent Anchor core
+-- api/              # API server and middleware
+-- audit/            # Audit logging and SIEM
+-- basis/            # Rule engine (BASIS)
+-- cognigate/        # Execution gateway
+-- common/           # Shared utilities
+-- enforce/          # Policy enforcement
+-- friction/         # Denial feedback system
+-- governance/       # Governance workflows
+-- intent/           # Intent processing
+-- observability/    # Metrics, logging, tracing
+-- persistence/      # Repository pattern
+-- policy/           # Policy management
+-- proof/            # Merkle tree proofs
+-- security/         # Auth, sessions, MFA
+-- semantic-governance/  # Semantic rules
+-- trust-engine/     # Trust scoring
+-- versioning/       # SemVer, deprecation
```

## Related Documentation

- [Component Details](./components.md) - Detailed component documentation
- [Security Architecture](./security.md) - Authentication and authorization
- [Data Model](./data-model.md) - Database schema and relationships
