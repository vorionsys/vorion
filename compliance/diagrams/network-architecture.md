# Cognigate Network Architecture Diagram

**Document:** Network Architecture and Deployment Topology
**System:** Vorion Cognigate -- AI Agent Governance Runtime
**SSP Reference:** NIST SP 800-53 Rev 5 Moderate Baseline
**Last Updated:** 2026-02-20

## Description

This diagram shows the network topology and deployment architecture of Vorion Cognigate. It maps the flow of traffic through network zones, identifies encryption boundaries, and shows how each component communicates. The system is deployed on Vercel serverless infrastructure with Neon PostgreSQL as the managed database.

## Diagram

```mermaid
flowchart LR
    subgraph INTERNET["PUBLIC INTERNET"]
        direction TB
        AI_AGENTS["AI Agents\n(BASIS Protocol Clients)"]
        OPERATORS["Operators / End Users\n(Browser / CLI)"]
    end

    subgraph VERCEL_EDGE["VERCEL EDGE NETWORK\n(Inherited Controls: PE, CP, SC)"]
        direction TB
        CDN["CDN / Edge Cache\n---\nStatic asset delivery\nGZip compression"]
        TLS["TLS Termination\n---\nTLS 1.2+ enforced\nAutomatic certificate\nmanagement"]
        DDoS["DDoS Protection\n---\nRate limiting\nBot mitigation"]
    end

    subgraph VERCEL_COMPUTE["VERCEL SERVERLESS COMPUTE"]
        direction TB
        FUNCTIONS["Serverless Functions\n---\nCold start optimized\nAuto-scaling\nIsolated execution"]

        subgraph COGNIGATE["COGNIGATE FASTAPI (ASGI)"]
            direction TB

            MIDDLEWARE["Middleware Stack\n---\nCORS (configurable origins)\nGZip (min 500 bytes)\nStructured Logging"]

            subgraph CORE_PIPELINE["Core Governance Pipeline"]
                direction LR
                V1_INTENT["/v1/intent\n---\nNormalization\nTripwires\nCritic (optional)"]
                V1_ENFORCE["/v1/enforce\n---\nPolicy Engine\nTrust Gating\nCircuit Breaker"]
                V1_PROOF["/v1/proof\n---\nSHA-256 Chain\nEd25519 Signatures\nEvidence Hook"]
            end

            subgraph MANAGEMENT["Management APIs"]
                direction LR
                V1_AGENTS["/v1/agents\n---\nAgent Lifecycle"]
                V1_TRUST["/v1/trust\n---\nTrust Scoring"]
                V1_AUTH["/v1/auth/keys\n---\nAPI Key Mgmt"]
                V1_COMPLIANCE["/v1/compliance\n---\nControl Health"]
                V1_REFERENCE["/v1/reference\n---\nTiers, Capabilities\nError Codes"]
            end

            subgraph INTERNAL["Internal Services"]
                direction LR
                CACHE["Cache Manager\n(In-Memory)"]
                LOG_QUEUE["Async Log Queue\n(structlog JSON)"]
                SIG_MGR["Signature Manager\n(Ed25519 Keys)"]
                POLICY_ENG["Policy Engine\n(BASIS Rules)"]
            end
        end

        FUNCTIONS --> COGNIGATE
    end

    subgraph NEON["NEON POSTGRESQL\n(Managed Database Service)"]
        direction TB
        NEON_DB["Neon Serverless PostgreSQL\n---\nAsync driver: asyncpg\nPool strategy: NullPool\n(no persistent connections)\nEncryption at rest: AES-256"]
        PROOF_TABLE["proof_records\n---\nHash chain\nSignatures\nTimestamps"]
        EVIDENCE_TABLE["control_evidence\n---\nFramework mappings\nControl references"]
        AGENT_TABLE["agents / trust\n---\nAgent registry\nTrust scores\nAPI keys (hashed)"]
    end

    subgraph EXTERNAL_AI["EXTERNAL AI PROVIDERS"]
        direction TB
        OPENAI["OpenAI API\n---\nCritic evaluation\n(outbound HTTPS only)"]
        ANTHROPIC["Anthropic API\n---\nCritic evaluation\n(outbound HTTPS only)"]
    end

    subgraph CICD_ZONE["CI/CD & SECURITY PIPELINE"]
        direction TB
        GITHUB["GitHub Repository\n---\nSource of truth\nBranch protection"]
        GH_ACTIONS["GitHub Actions\n---\nSAST (Bandit, Semgrep)\nSCA (pip-audit)\nSBOM (CycloneDX, SPDX)"]
        GH_SECURITY["GitHub Security Tab\n---\nSARIF reports\nDependabot alerts\nCode scanning"]
    end

    %% Traffic flows
    AI_AGENTS -->|"HTTPS\n(TLS 1.2+)"| TLS
    OPERATORS -->|"HTTPS\n(TLS 1.2+)"| TLS

    TLS --> CDN
    TLS --> DDoS
    CDN --> FUNCTIONS
    DDoS --> FUNCTIONS

    %% Internal flows
    MIDDLEWARE --> CORE_PIPELINE
    MIDDLEWARE --> MANAGEMENT

    V1_INTENT --> V1_ENFORCE
    V1_ENFORCE --> V1_PROOF

    %% Database connections
    COGNIGATE -->|"postgresql+asyncpg://\nTLS encrypted\nNullPool (no pooling)"| NEON_DB
    NEON_DB --- PROOF_TABLE
    NEON_DB --- EVIDENCE_TABLE
    NEON_DB --- AGENT_TABLE

    %% External AI (outbound only)
    V1_INTENT -.->|"HTTPS outbound\n(Critic AI, conditional)"| OPENAI
    V1_INTENT -.->|"HTTPS outbound\n(Critic AI, conditional)"| ANTHROPIC

    %% CI/CD flows
    GITHUB -->|"Push / PR"| GH_ACTIONS
    GH_ACTIONS -->|"SARIF upload"| GH_SECURITY
    GH_ACTIONS -->|"Deploy trigger\n(Vercel CLI)"| VERCEL_COMPUTE

    %% Styling
    style INTERNET fill:#2d1b3d,stroke:#9b59b6,stroke-width:2px,color:#fff
    style VERCEL_EDGE fill:#1a3a2a,stroke:#2ecc71,stroke-width:2px,color:#fff
    style VERCEL_COMPUTE fill:#1a2a3a,stroke:#3498db,stroke-width:2px,color:#fff
    style COGNIGATE fill:#0d1f2d,stroke:#1abc9c,stroke-width:2px,color:#fff
    style CORE_PIPELINE fill:#0a1a2a,stroke:#1abc9c,stroke-width:1px,color:#fff
    style MANAGEMENT fill:#0a1a2a,stroke:#1abc9c,stroke-width:1px,color:#fff
    style INTERNAL fill:#0a1a2a,stroke:#1abc9c,stroke-width:1px,color:#fff
    style NEON fill:#2a1a0a,stroke:#e67e22,stroke-width:2px,color:#fff
    style EXTERNAL_AI fill:#3d1b1b,stroke:#e74c3c,stroke-width:2px,color:#fff
    style CICD_ZONE fill:#1b2d3d,stroke:#2980b9,stroke-width:2px,color:#fff
```

## Network Zones

| Zone | Components | Security Controls |
|------|-----------|-------------------|
| **Public Internet** | AI Agents, End Users | No trust assumed; all traffic encrypted via TLS |
| **Vercel Edge Network** | CDN, TLS Termination, DDoS Protection | TLS 1.2+ enforced, automatic certificate management, rate limiting |
| **Vercel Serverless Compute** | Serverless Functions, Cognigate ASGI | Isolated execution environment, auto-scaling, cold start optimization |
| **Neon PostgreSQL** | Database, Proof Records, Evidence, Agents | AES-256 encryption at rest, TLS in transit, NullPool connections |
| **External AI Providers** | OpenAI, Anthropic APIs | Outbound HTTPS only; used conditionally by Critic AI |
| **CI/CD Pipeline** | GitHub, Actions, Security Tab | Branch protection, SAST/SCA scanning, SARIF reporting |

## Connection Details

| Source | Destination | Protocol | Port | Notes |
|--------|------------|----------|------|-------|
| AI Agents | Vercel Edge | HTTPS | 443 | TLS 1.2+ required |
| Operators | Vercel Edge | HTTPS | 443 | TLS 1.2+ required |
| Vercel Edge | Serverless Functions | Internal | -- | Vercel internal routing |
| Cognigate | Neon PostgreSQL | postgresql+asyncpg | 5432 | TLS encrypted, NullPool strategy |
| Cognigate | OpenAI/Anthropic | HTTPS | 443 | Outbound only, conditional (Critic) |
| GitHub Actions | Vercel | HTTPS | 443 | Deploy via Vercel CLI |
| GitHub Actions | GitHub Security | Internal | -- | SARIF upload for code scanning |

## Database Connection Strategy

Cognigate uses **NullPool** for database connections, meaning no persistent connection pool is maintained. Each request opens a new connection and closes it when complete. This is the correct strategy for serverless deployments where:

- Function instances are ephemeral and may not persist between requests
- Connection pool state cannot be reliably maintained across cold starts
- Neon PostgreSQL handles connection management on the server side

Connection string format: `postgresql+asyncpg://{user}:{password}@{host}/{database}?sslmode=require`

## Encryption Boundaries

| Boundary | Encryption | Standard |
|----------|-----------|----------|
| Client to Vercel Edge | TLS 1.2+ | Automatic certificate via Let's Encrypt |
| Vercel to Cognigate | Internal TLS | Vercel platform security |
| Cognigate to Neon PostgreSQL | TLS (sslmode=require) | Server-side certificate validation |
| Cognigate to AI Providers | HTTPS/TLS 1.2+ | Provider certificate validation |
| Data at rest (Neon) | AES-256 | Neon managed encryption |
| Proof records (integrity) | Ed25519 signatures | RFC 8032 digital signatures |
| Hash chain (integrity) | SHA-256 | Deterministic JSON serialization |

## Rendering

Render this diagram with any Mermaid-compatible viewer (GitHub, VS Code Mermaid extension, mermaid.live, or similar).
