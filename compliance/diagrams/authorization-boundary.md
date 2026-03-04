# Cognigate Authorization Boundary Diagram

**Document:** Authorization Boundary Diagram
**System:** Vorion Cognigate -- AI Agent Governance Runtime
**SSP Reference:** NIST SP 800-53 Rev 5 Moderate Baseline
**Last Updated:** 2026-02-20

## Description

This diagram defines the authorization boundary for the Vorion Cognigate system. Components inside the boundary are directly managed, configured, and secured by Vorion. Components outside the boundary interact with Cognigate but are not part of the assessed system. Inherited controls from cloud providers (Vercel/AWS) are noted where applicable.

## Diagram

```mermaid
flowchart TB
    subgraph OUTSIDE["OUTSIDE Authorization Boundary"]
        direction TB

        AGENTS["External AI Agents\n(Consumers of Governance)\n---\nSubject to BASIS policies\nvia Cognigate enforcement"]

        USERS["End Users / Operators\n---\nDashboard access\nAPI key management"]

        AI_PROVIDERS["AI Provider APIs\n(OpenAI / Anthropic)\n---\nUsed by Critic AI layer\nHTTPS outbound only"]

        CICD["CI/CD Pipeline\n(GitHub Actions)\n---\nSAST, SCA, SBOM generation\nVercel deployment trigger"]

        VERCEL["Vercel Edge Network\n---\nCDN / Gateway / TLS termination\nInherited controls (PE, CP)"]
    end

    subgraph BOUNDARY["COGNIGATE AUTHORIZATION BOUNDARY"]
        direction TB

        subgraph APP["FastAPI Application Server (ASGI)"]
            direction LR
            CORS["CORS Middleware"]
            GZIP["GZip Middleware"]
            LIFESPAN["Lifespan Manager\n(init/shutdown)"]
        end

        subgraph INTENT_LAYER["INTENT Layer (/v1/intent)"]
            direction TB
            NORMALIZE["Intent Normalization\n---\nGoal parsing\nStructured plan creation"]
            TRIPWIRES["Tripwire Detection\n---\nRegex patterns\nEuphemism detection\nSystem path analysis"]
            SCHEMA_VAL["Schema Validation\n---\nPydantic models\nInput sanitization"]
        end

        subgraph ENFORCE_LAYER["ENFORCE Layer (/v1/enforce)"]
            direction TB
            POLICY_ENGINE["Policy Engine\n---\nBASIS constraint evaluation\nRule loading and matching"]
            TRUST_ENGINE["Trust Engine\n---\n8-tier model (T0-T7)\nRigor mode mapping\nVelocity caps"]
            CRITIC["Critic AI\n---\nAdversarial evaluation\nOptional for suspicious intents"]
            CIRCUIT["Circuit Breaker\n---\nCLOSED / OPEN / HALF_OPEN\nCascade failure protection\nEntity misbehavior detection"]
        end

        subgraph PROOF_LAYER["PROOF Layer (/v1/proof)"]
            direction TB
            HASH_CHAIN["SHA-256 Hash Chain\n---\nImmutable audit ledger\nDeterministic serialization"]
            SIGNATURES["Ed25519 Signatures\n---\n64-byte digital signatures\nProof record integrity"]
            EVIDENCE_HOOK["Evidence Hook\n---\nAutomatic evidence generation\non proof creation"]
            EVIDENCE_MAPPER["Evidence Mapper\n---\nControl-to-proof mapping\n13 compliance frameworks"]
        end

        subgraph ADMIN_LAYER["Admin & Management"]
            direction TB
            AGENT_MGMT["Agent Management\n(/v1/agents)\n---\nRegister, list, update, revoke"]
            AUTH_KEYS["Auth Key Management\n(/v1/auth/keys)\n---\n256-bit entropy API keys"]
            TRUST_MGMT["Trust Management\n(/v1/trust)\n---\nAdmit, signal, query scores"]
            COMPLIANCE_EP["Compliance Endpoint\n(/v1/compliance)\n---\nControl health, evidence export"]
            REFERENCE["Reference Data\n(/v1/reference)\n---\nTiers, capabilities, errors\nRate limits, versions"]
        end

        subgraph DATA["Database (Neon PostgreSQL)"]
            direction TB
            NEON["Neon PostgreSQL\n---\nManaged serverless Postgres\nNullPool connection strategy\nAsync via asyncpg driver"]
            PROOF_REPO["Proof Repository\n---\nProof records, hash chain"]
            EVIDENCE_REPO["Evidence Repository\n---\nControl evidence records"]
        end

        subgraph SUPPORT["Supporting Infrastructure"]
            direction LR
            CACHE["Cache Manager\n---\nIn-memory caching"]
            ASYNC_LOG["Async Log Queue\n---\nStructured logging (structlog)\nJSON renderer"]
        end
    end

    %% External connections
    AGENTS -->|"HTTPS\nBASIS protocol"| VERCEL
    USERS -->|"HTTPS\nBrowser / CLI"| VERCEL
    VERCEL -->|"TLS 1.2+\nForwarded request"| APP

    APP --> INTENT_LAYER
    APP --> ENFORCE_LAYER
    APP --> PROOF_LAYER
    APP --> ADMIN_LAYER

    INTENT_LAYER --> ENFORCE_LAYER
    ENFORCE_LAYER --> PROOF_LAYER
    CRITIC -->|"HTTPS outbound"| AI_PROVIDERS

    PROOF_LAYER --> DATA
    ADMIN_LAYER --> DATA
    ENFORCE_LAYER --> DATA

    CICD -->|"Git push\nDeploy trigger"| VERCEL

    %% Styling
    style OUTSIDE fill:#1a1a2e,stroke:#e94560,stroke-width:2px,color:#fff
    style BOUNDARY fill:#0f3460,stroke:#00d2ff,stroke-width:3px,color:#fff
    style APP fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style INTENT_LAYER fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style ENFORCE_LAYER fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style PROOF_LAYER fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style ADMIN_LAYER fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style DATA fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    style SUPPORT fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
```

## Legend

| Component | Boundary Status | Description |
|-----------|----------------|-------------|
| **FastAPI Application Server** | Inside | Core ASGI application with CORS and GZip middleware |
| **INTENT Layer** | Inside | Goal normalization, tripwire detection, schema validation |
| **ENFORCE Layer** | Inside | Policy engine, trust engine, Critic AI, circuit breaker |
| **PROOF Layer** | Inside | SHA-256 hash chain, Ed25519 signatures, evidence generation |
| **Admin & Management** | Inside | Agent lifecycle, API keys, trust scoring, compliance endpoints |
| **Neon PostgreSQL** | Inside (Managed) | Serverless PostgreSQL with NullPool; managed by Neon |
| **External AI Agents** | Outside | Consumers of Cognigate governance; subject to BASIS policies |
| **AI Provider APIs** | Outside | OpenAI/Anthropic APIs used by Critic for adversarial evaluation |
| **Vercel Edge Network** | Outside (Inherited) | CDN, TLS termination, DDoS protection; 16 PE controls inherited |
| **End Users / Operators** | Outside | Human operators accessing dashboard and API management |
| **CI/CD Pipeline** | Outside | GitHub Actions for SAST, SCA, SBOM, and deployment |

## Inherited Controls

The following control families are partially or fully inherited from cloud infrastructure providers:

- **Physical and Environmental Protection (PE):** 16 controls inherited from Vercel/AWS
- **Contingency Planning (CP):** Multi-region failover inherited from Vercel
- **System and Communications Protection (SC):** TLS 1.2+ termination at Vercel Edge

## Rendering

Render this diagram with any Mermaid-compatible viewer (GitHub, VS Code Mermaid extension, mermaid.live, or similar).
