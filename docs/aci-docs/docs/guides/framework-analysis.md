---
sidebar_position: 3
title: Framework Analysis
---

# ACI Architectural Differentiation Analysis

Strategic analysis comparing ACI against major agentic AI frameworks, demonstrating that ACI occupies a unique unfilled niche as an identity and certification standard complementary to execution frameworks.

## Executive Summary

ACI is **not** an execution framework — it is a **capability certification layer** that works alongside any agent framework. While frameworks like AutoGen, LangGraph, and CrewAI focus on *how agents execute*, ACI focuses on *who agents are* and *what they're authorized to do*.

## Competitive Positioning

| Dimension | Execution Frameworks | ACI |
|-----------|---------------------|-----|
| **Focus** | Agent orchestration & execution | Agent identity & certification |
| **Scope** | Runtime behavior | Lifetime identity |
| **Trust** | Implicit (framework-level) | Explicit (cryptographic) |
| **Standards** | Proprietary APIs | W3C DID, OIDC, OAuth |
| **Interop** | Framework-specific | Cross-framework |
| **Governance** | Code-level | Protocol-level |

## ACI's Unique Value Proposition

### 1. Identity-First Architecture
No other framework provides a standardized, cryptographically verifiable agent identity format.

### 2. Capability Certification
ACI certifies *what an agent can do* independently of *how it does it*.

### 3. Trust Quantification
8-tier trust model with continuous scoring maps to real-world compliance requirements.

### 4. Standards-Based Interop
Built on W3C DID, OpenID Connect, and OAuth 2.0 — not proprietary APIs.

### 5. Layered Security
5-layer architecture from identity to semantic governance provides defense-in-depth.

## The Gap ACI Fills

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                      │
│                  (Your Agent Logic)                       │
├─────────────────────────────────────────────────────────┤
│              Execution Framework Layer                    │
│        (AutoGen, LangGraph, CrewAI, etc.)                │
├─────────────────────────────────────────────────────────┤
│           ★ ACI: Identity & Certification ★              │
│     (Identity, Capability, Trust, Governance)            │
├─────────────────────────────────────────────────────────┤
│              Infrastructure Layer                         │
│         (Cloud, APIs, Databases, LLMs)                   │
└─────────────────────────────────────────────────────────┘
```

ACI sits **between** execution frameworks and infrastructure, providing the missing identity and trust layer.

## Framework Compatibility

ACI integrates with any agent framework:

- **AutoGen**: Register each AutoGen agent with an ACI, enforce capability checks in tool calls
- **LangGraph**: Gate graph nodes with ACI capability level checks
- **CrewAI**: Map crew roles to ACI domains, enforce trust tiers for task delegation
- **Semantic Kernel**: Use ACI claims in plugin authorization
- **LangChain**: Add ACI middleware to chain execution

## Strategic Recommendations

1. **Publish as open standard** — Submit to OpenID Foundation and W3C CCG
2. **Build reference implementations** — SDK for major frameworks
3. **Partner with registries** — Establish trust anchors with cloud providers
4. **Develop certification programs** — Third-party agent certification
5. **Create extension marketplace** — Community-driven governance extensions
