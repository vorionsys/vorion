# Vorion for Partners

> **Read time**: 6 minutes | **Audience**: Business Partners, Integration Partners, System Integrators

## Partnership Thesis

AI governance will not be solved by one company. It requires an ecosystem — AI platforms need governance hooks, consulting firms need governance frameworks, cloud providers need governance integrations, and GRC tools need governance data feeds. Vorion provides the standard and the infrastructure. Partners provide the reach and the context.

## Four Partnership Types

### 1. AI Platform Partners

**Who**: Companies building AI agent platforms (LangChain, CrewAI, AutoGen, custom platforms)

**Integration**: Their agents → Vorion governance → compliant operations

```
Your Platform                    Vorion
┌─────────────┐                 ┌──────────────┐
│ Agent A     │ ── register ──► │ CAR Registry │
│ Agent B     │ ── constrain ─► │ BASIS Rules  │
│ Agent C     │ ── verify ────► │ Cognigate    │
│             │ ◄── proof ───── │ PROOF Chain  │
└─────────────┘                 └──────────────┘
```

**What you get**:
- Pre-built governance for your platform (don't build it yourself)
- Regulatory compliance as a feature (sell to enterprise)
- Trust scores as a differentiator (your agents are provably governed)

**Integration effort**: 1-2 days with SDK, API key, and quickstart guide

**Available**: Wave 2 (Mar 16)

### 2. Systems Integrator / Consulting Partners

**Who**: Accenture, Deloitte, Wipro, boutique AI consulting firms

**Value**: Vorion is the implementation framework for AI governance engagements.

**What you get**:
- Structured methodology (ATSF framework, 8-tier trust model)
- Assessment tools (trust scoring, compliance mapping)
- Deliverable templates (governance policies, audit reports)
- Training curriculum (Kaizen learning platform)

**Revenue opportunity**: Governance assessments, implementation engagements, ongoing monitoring contracts. Every enterprise AI deployment needs governance — Vorion gives you the toolbox.

**Available**: Wave 3 (Mar 30) for enterprise engagements, Wave 5 (May 4) for training

### 3. Cloud Provider Partners

**Who**: AWS, Azure, GCP marketplace partners, or cloud-native AI infrastructure providers

**Integration**: Vorion as a managed service or marketplace listing

**What you get**:
- Governance-as-a-service for your AI customers
- Compliance checkbox for regulated industries
- Marketplace revenue share

**Technical integration**: Docker image (Wave 2), Helm chart (H2 2026)

**Available**: Wave 2 (Mar 16) for Docker, later for marketplace listings

### 4. GRC Tool Partners

**Who**: OneTrust, ServiceNow GRC, Archer, Securiti, Vanta

**Integration**: Vorion PROOF data → your compliance dashboards

**What you get**:
- Real-time AI governance data feed (not self-reported questionnaires)
- Automated evidence collection for AI audits
- Gap analysis powered by actual runtime behavior, not documentation

**Available**: Wave 4 (Apr 20) — requires operations console for data export

## Partnership Tiers

| Tier | Requirements | Benefits |
|------|-------------|----------|
| **Technology Partner** | SDK integration + joint testing | Co-marketing, integration docs, partner badge |
| **Solutions Partner** | Trained team + customer delivery | Deal registration, referral fees, priority support |
| **Strategic Partner** | Joint GTM + co-development | Revenue share, roadmap influence, joint customers |

## Integration Architecture

All integrations go through the public API. No special access, no hidden endpoints.

```
Partner App  ──►  @vorionsys/sdk  ──►  Cognigate API  ──►  PROOF Chain
                       │
                       └── npm install @vorionsys/sdk
                           (TypeScript, Python, or Go)
```

**API contract**: OpenAPI 3.1 spec, versioned, backward-compatible within major versions.

**Authentication**: API key (dev/test) or OAuth2 (production).

**Rate limits**: Free tier 1,000 calls/mo, Pro 100K, Enterprise unlimited.

## Co-Sell Timeline

| Wave | Partner Activities |
|------|-------------------|
| W1 (Feb 26) | Technology partners: begin SDK integration |
| W2 (Mar 16) | Technology partners: launch integrations, joint blog posts |
| W3 (Mar 30) | Solutions partners: first joint enterprise engagements |
| W4 (Apr 20) | GRC partners: data feed integration |
| W5 (May 4) | All partners: ecosystem launch, joint conference presence |

## Getting Started

1. **Explore**: `npm install @vorionsys/sdk` — try the governance flow locally
2. **Integrate**: Follow the 5-minute quickstart (available Wave 2)
3. **Partner**: Contact us for partnership agreement and integration support
4. **Launch**: Joint announcement aligned to the wave your integration ships in

## One Line

Vorion is the governance standard. You bring the context, the customers, and the reach. Together we make AI trustworthy.
