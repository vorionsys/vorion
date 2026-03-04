# Vorion Cognigate -- Architecture Overview

**System:** Vorion Cognigate AI Agent Governance Engine
**Version:** 1.0.0
**Classification:** MODERATE (Confidentiality: M / Integrity: M / Availability: M)
**Specification:** BASIS (Behavioral AI Safety Interoperability Standard) v1.0

---

## Purpose

Vorion Cognigate is the operational engine that enforces the BASIS standard for AI agent governance. It provides real-time intent normalization, policy enforcement, trust scoring, and cryptographic proof generation for autonomous AI agent operations.

Cognigate serves dual roles in the compliance ecosystem:

1. **Inherited Control Enforcement Layer** -- Downstream AI execution environments inherit Cognigate's governance controls, reducing their individual compliance burden.
2. **Standards Setter for Agentic Systems** -- The BASIS specification defines behavioral safety interoperability across all governing bodies, not limited to NIST. Vorion adapts to NIST 800-53, SOC 2, GDPR, ISO 27001, FedRAMP, CMMC, and emerging AI-specific frameworks.

---

## Three-Layer Architecture

Cognigate implements a pipeline architecture where every AI agent action flows through three sequential governance layers:

```
+-------------------------------------------------------------------+
|                         EXTERNAL AGENTS                           |
|  (AI agents, autonomous systems, LLM-based tools, agentic apps)  |
+-------------------------------------------------------------------+
                              |
                              v
+===================================================================+
|                                                                   |
|  LAYER 1: INTENT                                                  |
|  Normalize. Validate. Classify.                                   |
|                                                                   |
|  - Receives raw agent action intention                            |
|  - Normalizes to BASIS intent schema                              |
|  - Validates structure and permissions                            |
|  - Assigns unique intent_id                                       |
|  - Classifies action type and risk level                          |
|                                                                   |
|  Endpoint: POST /v1/intent                                        |
|                                                                   |
+===================================================================+
                              |
                              v
+===================================================================+
|                                                                   |
|  LAYER 2: ENFORCE                                                 |
|  Evaluate. Decide. Constrain.                                     |
|                                                                   |
|  - Evaluates intent against active BASIS policies                 |
|  - Checks trust level gates (8-tier model)                        |
|  - Validates permission scope boundaries                          |
|  - Enforces resource constraints                                  |
|  - Applies behavioral pattern checks                              |
|  - Runs velocity/rate limiting                                    |
|  - Renders verdict: ALLOW / DENY / ESCALATE / MODIFY             |
|                                                                   |
|  Endpoint: POST /v1/enforce                                       |
|                                                                   |
+===================================================================+
                              |
                              v
+===================================================================+
|                                                                   |
|  LAYER 3: PROOF                                                   |
|  Record. Seal. Chain.                                             |
|                                                                   |
|  - Creates immutable proof record for every decision              |
|  - Computes SHA-256 hash of inputs and outputs                    |
|  - Links to previous record via previous_hash (chain)             |
|  - Signs record with Ed25519 digital signature                    |
|  - Appends to SHA-256 hash chain (append-only, tamper-evident)    |
|                                                                   |
|  Endpoints: POST /v1/proof                                        |
|             GET  /v1/proof/{id}                                    |
|             POST /v1/proof/query                                   |
|             GET  /v1/proof/{id}/verify                             |
|                                                                   |
+===================================================================+
```

### Data Flow: INTENT --> ENFORCE --> PROOF --> CHAIN

```
Agent        Cognigate                                    Database
  |              |                                           |
  |-- Intent --> |                                           |
  |              |-- Normalize & Validate                    |
  |              |-- Classify risk level                     |
  |              |                                           |
  |              |-- Evaluate against policies               |
  |              |-- Check trust gates                       |
  |              |-- Apply constraints                       |
  |              |-- Render verdict                          |
  |              |                                           |
  |              |-- Create proof record                     |
  |              |-- SHA-256 hash (inputs + outputs)         |
  |              |-- Link to previous hash                   |
  |              |-- Ed25519 sign                            |
  |              |-- Append to chain ---------------------> |
  |              |                                           |
  | <-- Result - |                                           |
  |              |                                           |
```

---

## Trust Model

Cognigate implements an 8-tier trust model with dynamic scoring on a 0-1000 scale:

| Tier | Range | Description | Capabilities |
|------|-------|-------------|--------------|
| **Sandbox** | 0-199 | Isolated, no actions permitted | Read-only, monitoring |
| **Observed** | 200-349 | Severely restricted | Basic queries only |
| **Provisional** | 350-499 | Limited trust, heavy monitoring | Simple tasks, supervised |
| **Monitored** | 500-649 | Standard restrictions apply | Standard operations |
| **Standard** | 650-799 | Normal operations permitted | Most operations allowed |
| **Trusted** | 800-875 | Elevated trust, reduced checks | Advanced operations |
| **Certified** | 876-950 | High trust, minimal restrictions | Cross-domain operations |
| **Autonomous** | 951-1000 | Maximum trust level | Full autonomous capability |

Trust scores are dynamic and influenced by:
- Behavioral history (policy compliance rate)
- Outcome alignment (did actions achieve stated goals?)
- Velocity patterns (abnormal request rates trigger trust decay)
- Temporal consistency (sudden behavioral changes reduce trust)
- Cross-reference integrity (consistency with declared identity)

---

## Security Boundaries

```
+---------------------------------------------------------------+
|                  AUTHORIZATION BOUNDARY                        |
|                                                               |
|  +------------------+  +------------------+                   |
|  | API Gateway      |  | Cognigate Engine |                   |
|  | - TLS termination|  | - INTENT handler |                   |
|  | - Rate limiting  |  | - ENFORCE handler|                   |
|  | - CORS policy    |  | - PROOF handler  |                   |
|  | - Auth middleware |  | - Admin API      |                   |
|  +------------------+  +------------------+                   |
|                                                               |
|  +------------------+  +------------------+                   |
|  | Policy Engine    |  | Trust Engine     |                   |
|  | - BASIS rules    |  | - Score compute  |                   |
|  | - Policy chain   |  | - 8-tier model   |                   |
|  | - Hot reload     |  | - Decay/boost    |                   |
|  +------------------+  +------------------+                   |
|                                                               |
|  +------------------+  +------------------+                   |
|  | PROOF Plane      |  | Data Layer       |                   |
|  | - Dual-hash chain|  | - PostgreSQL     |                   |
|  | - Ed25519 sigs   |  | - Encrypted      |                   |
|  | - Append-only    |  | - Backup/HA      |                   |
|  +------------------+  +------------------+                   |
|                                                               |
|  +------------------+                                         |
|  | Cache Layer      |                                         |
|  | - Redis          |                                         |
|  | - Session cache  |                                         |
|  | - Policy cache   |                                         |
|  +------------------+                                         |
|                                                               |
+---------------------------------------------------------------+
                    |
                    | TLS 1.2+
                    |
    +-------------------------------+
    |    EXTERNAL (Outside Boundary) |
    |    - AI Agents                 |
    |    - Host Environments         |
    |    - Auditor Portals           |
    |    - Integration APIs          |
    +-------------------------------+
```

---

## Cryptographic Controls

| Function | Algorithm | Purpose |
|----------|-----------|---------|
| Content hashing | SHA-256 | Primary hash for PROOF records (inputs_hash, outputs_hash) |
| Chain linkage | SHA-256 | Previous-hash linking for chain integrity |
| Digital signatures | Ed25519 | Non-repudiation for proof records |
| Transport | TLS 1.2+ | Confidentiality and integrity of data in transit |
| Data at rest | AES-256 | Database encryption |
| API authentication | Ed25519 / API keys | Agent and admin authentication |

### PROOF Chain Integrity

Each PROOF record contains:
- `inputs_hash`: SHA-256 of decision inputs
- `outputs_hash`: SHA-256 of decision outputs
- `previous_hash`: Hash of the preceding PROOF record (chain linkage)
- `hash`: SHA-256 of the complete record (content integrity)
- `signature`: Ed25519 signature over the record hash (non-repudiation)

Chain verification traverses the entire chain, confirming each record's `previous_hash` matches the preceding record's `hash`.

---

## Multi-Framework Compliance Posture

Cognigate's governance model is framework-agnostic by design. The same enforcement pipeline satisfies requirements across multiple frameworks:

| Framework | Relevance | Key Mapped Controls |
|-----------|-----------|---------------------|
| **NIST 800-53 Rev 5** | Primary | AC, AU, CA, CM, IA, SC, SI families (Moderate baseline) |
| **SOC 2 Type II** | Active | CC6 (Logical Access), CC7 (System Operations), CC2 (Communications) |
| **GDPR** | Active | Art. 25 (Privacy by Design), Art. 30 (Records of Processing), Art. 32 (Security) |
| **ISO 27001** | Active | A.5-A.18 controls via governance matrix |
| **FedRAMP Moderate** | Target | Full Moderate baseline via OSCAL SSP |
| **CMMC Level 2** | Target | Practice domains mapped via control registry |
| **NIST AI RMF** | Active | Govern, Map, Measure, Manage functions |
| **EU AI Act** | Monitoring | High-risk AI system requirements |

### Key Differentiator

Vorion does not build compliance for one framework at a time. The BASIS specification and Cognigate engine implement a **unified governance layer** that maps to any framework. When a new standard emerges (e.g., NIST AI 600-1, EU AI Act technical standards), the mapping is additive -- the enforcement pipeline is already in place.

---

## Key Metrics

| Metric | Value |
|--------|-------|
| API Response Time (p95) | < 50ms |
| PROOF Record Creation | < 10ms |
| Chain Verification (full) | < 500ms |
| Policy Evaluation (per intent) | < 20ms |
| Trust Score Computation | < 5ms |
| Uptime Target | 99.9% |
| PROOF Chain Integrity | 100% (automated verification) |

---

## Contact

**Organization:** Vorion, Inc.
**System:** Cognigate AI Agent Governance Engine
**Specification:** BASIS (Behavioral AI Safety Interoperability Standard)

---

*This document is part of the Vorion Cognigate ICP Evidence Package. For the full OSCAL SSP, see ssp-draft.json.*
