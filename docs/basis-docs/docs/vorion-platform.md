---
sidebar_position: 7
title: Vorion Platform
description: Enterprise AI Agent Governance Platform
---

# Vorion Platform

## Enterprise AI Agent Governance Platform

**Deploy governed AI agents with trust scoring, policy enforcement, and complete auditability.**

[Platform](https://vorion.org) · [Documentation](https://vorion.org/docs) · [API](https://vorion.org/api)

---

## What is the Vorion Platform?

The Vorion Platform is the enterprise platform for deploying and governing AI agents using the BASIS standard:

- **Trust Scoring** — Quantified trustworthiness (0-1000) with behavioral tracking
- **Policy Enforcement** — Real-time governance with capability gating
- **Audit Trails** — Immutable proof chains for every decision
- **Compliance Ready** — EU AI Act, ISO 42001, NIST AI RMF aligned

---

## Core Capabilities

### Trust Engine

Every agent gets a dynamic trust score (0-1000) based on four weighted components:

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| **Behavioral** | 40% | Runtime reliability, success rate, violation history |
| **Compliance** | 25% | BASIS standard adherence, policy conformance |
| **Identity** | 20% | Verification level, credential strength, provenance |
| **Context** | 15% | Environmental factors, deployment conditions |

### Trust Tiers (8-Tier Model)

| Tier | Name | Score Range | Capabilities |
|------|------|-------------|--------------|
| T0 | Sandbox | [0, 200) | Isolated testing only |
| T1 | Observed | [200, 350) | Read public data |
| T2 | Provisional | [350, 500) | Internal messaging, basic actions |
| T3 | Monitored | [500, 650) | Limited external communication |
| T4 | Standard | [650, 800) | External API calls |
| T5 | Trusted | [800, 876) | Cross-system operations |
| T6 | Certified | [876, 951) | Financial transactions |
| T7 | Autonomous | [951, 1000] | Full autonomy within policy bounds |

### Trust Decay

Trust decay uses a stepped milestone system with a 182-day half-life. Between milestones, scores are linearly interpolated.

```
Stepped Milestone Decay (182-day half-life):

| Day | Multiplier | Drop |
|-----|-----------|------|
|   0 | 1.00      | —    |
|   7 | 0.94      | 6%   |
|  14 | 0.88      | 6%   |
|  28 | 0.82      | 6%   |
|  42 | 0.76      | 6%   |
|  56 | 0.70      | 6%   |
|  84 | 0.65      | 5%   |
| 112 | 0.60      | 5%   |
| 140 | 0.55      | 5%   |
| 182 | 0.50      | 5%   |
```

- **9 milestones** after day 0: steps 1–5 drop 6% each, steps 6–9 drop 5% each
- **182-day half-life:** Score reaches 50% of its pre-decay value at day 182
- **Linear interpolation** between milestones for any intermediate day
- **Score floor:** Score cannot decay below 50% of its pre-decay value (floors at day 182 multiplier)
- **Activity reset:** Any activity resets the decay clock to day 0

### Trust Recovery

- **Base recovery:** 2% per success signal
- **Accelerated recovery:** 1.5x after 3+ consecutive successes
- **Max per signal:** 50 points
- **Asymmetric dynamics:** Trust loss is ~10x faster than trust gain

---

## Governance Architecture

Vorion Platform implements the BASIS four-layer governance model:

```
┌─────────────────────────────────────────────────────────────┐
│                    HUMAN LAYER                               │
│   Escalation for high-risk decisions                        │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────┐
│                    ENFORCE LAYER                             │
│   Policy evaluation against trust scores and constraints     │
│   Output: ALLOW, DENY, ESCALATE, or DEGRADE                 │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────┐
│                    INTENT LAYER                              │
│   Parse and classify agent action requests                   │
│   Risk classification and capability mapping                 │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    PROOF LAYER                               │
│   SHA-256 chained audit records for every decision          │
│   Ed25519 signatures for tamper detection                   │
└─────────────────────────────────────────────────────────────┘
```

---

## For Developers

### SDK Integration

```typescript
import { VorionPlatform } from '@vorion/sdk';

const platform = new VorionPlatform({
  apiKey: process.env.VORION_API_KEY
});

// Register an agent
const agent = await platform.agents.register({
  name: 'my-agent',
  capabilities: ['data/read_public', 'communication/internal']
});

// Check trust before action
const decision = await platform.enforce.check({
  agentId: agent.id,
  action: 'communication/send_external',
  context: { recipient: 'partner@example.com' }
});

if (decision.action === 'allow') {
  // Execute action
} else if (decision.action === 'escalate') {
  // Request human approval
}
```

### Cognigate Integration

Vorion Platform uses [Cognigate](/cognigate) as its constrained execution runtime:

```typescript
import { createGateway } from '@vorion/atsf-core/cognigate';

const gateway = createGateway({
  maxMemoryMb: 512,
  timeoutMs: 30000
});

// Execute within resource limits
const result = await gateway.execute({
  intent,
  decision,
  resourceLimits: { maxMemoryMb: 256 }
});
```

---

## For Enterprises

### Deploy Governed Agents

1. **Register** — Define agents with capability manifests
2. **Configure** — Set trust thresholds and policies
3. **Deploy** — Run agents through Vorion Platform governance
4. **Monitor** — Real-time dashboards and alerts
5. **Audit** — Complete proof chains for compliance

### Compliance Features

| Requirement | Vorion Platform Capability |
|-------------|------------------------|
| EU AI Act Article 19 | Immutable audit trails, 6+ month retention |
| ISO 42001 | AI management system integration |
| NIST AI RMF | Risk management, measurement, governance |
| SOC 2 Type II | Security controls, access logging |

### API Verification

```bash
curl https://api.vorion.org/v1/verify/ag_vendor_agent

{
  "valid": true,
  "trustScore": 687,
  "tier": "trusted",
  "lastAction": "2026-01-18T10:30:00Z",
  "complianceStatus": "active"
}
```

---

## Pricing

| Plan | Agents | Features | Price |
|------|--------|----------|-------|
| **Starter** | Up to 5 | Trust scoring, basic audit | $299/mo |
| **Professional** | Up to 25 | + Policy engine, API access | $999/mo |
| **Enterprise** | Unlimited | + SSO, SLA, dedicated support | Custom |

---

## API Overview

```yaml
# Agents
POST /v1/agents              # Register agent
GET  /v1/agents/{id}         # Get agent details
PUT  /v1/agents/{id}         # Update agent

# Trust
GET  /v1/trust/score/{id}    # Current score
GET  /v1/trust/history/{id}  # Score history
POST /v1/trust/signal        # Report behavioral signal

# Governance
POST /v1/enforce/check       # Check action permission
POST /v1/escalate            # Request human approval
GET  /v1/decisions/{id}      # Get decision details

# Audit
GET  /v1/proof/{id}          # Get proof record
GET  /v1/proof/chain/{id}    # Verify chain integrity
GET  /v1/audit/export        # Export audit logs
```

---

## Get Started

- **Free Trial**: [vorion.org/trial](https://vorion.org/trial)
- **Documentation**: [vorion.org/docs](https://vorion.org/docs)
- **API Reference**: [vorion.org/api](https://vorion.org/api)
- **Enterprise Demo**: [vorion.org/demo](https://vorion.org/demo)

---

*Vorion Platform is built on the [BASIS](/spec/overview) standard and powered by [Cognigate](/cognigate).*
