---
sidebar_position: 0
title: CAR Layer
description: Contextual Agent Record — identity resolution and credential binding
---

# CAR Layer

## Contextual Agent Record — Identity & Credentials

**The first stage of BASIS governance — before intent parsing, resolve who the agent is and what it's allowed to do.**

---

## What is CAR?

The CAR (Contextual Agent Record) layer is responsible for:

1. **Identity Resolution** — Who is this agent?
2. **Credential Binding** — What credentials does it carry?
3. **Trust Score Retrieval** — What is its current trust level?
4. **Capability Enumeration** — What actions is it authorized to perform?

```
┌─────────────────────────────────────────────────────────────┐
│                        CAR LAYER                             │
└─────────────────────────────────────────────────────────────┘

     ┌─────────────────┐
     │  Agent Request   │
     │  entityId:       │
     │  "agent_123"     │
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │   IDENTITY      │──▶ Entity: agent_123
     │   RESOLVE       │    Owner: org_456
     │                 │    Created: 2026-01-15
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │   CREDENTIAL    │──▶ Trust Score: 612
     │   BIND          │    Trust Tier: T3 (Monitored)
     │                 │    API Key: valid
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │   CAPABILITY    │──▶ Capabilities:
     │   ENUMERATE     │    - external_api_call
     │                 │    - data_read
     │                 │    - internal_compute
     └────────┬────────┘
              │
              │ Passes to INTENT layer
              ▼
```

---

## Why CAR First?

You can't evaluate intent without knowing who is asking.

| Without CAR | With CAR |
|-------------|----------|
| Anonymous request | Identified agent with trust history |
| No capability context | Known capability set |
| Trust checked at enforcement | Trust loaded upfront |
| Identity scattered across layers | Single source of agent identity |

---

## CAR Output Schema

```typescript
interface ContextualAgentRecord {
  // Identity
  entityId: string;
  organizationId: string;
  agentType: string;

  // Trust
  trustScore: number;     // 0-1000
  trustTier: string;      // T0-T7
  trustLevel: string;     // Human-readable tier name

  // Credentials
  credentials: {
    apiKeyValid: boolean;
    issuedAt: string;     // ISO8601
    expiresAt: string;    // ISO8601
  };

  // Capabilities
  capabilities: string[];
  restrictions: string[];

  // Metadata
  resolvedAt: string;     // ISO8601
  carId: string;          // Unique record ID
}
```

---

## Trust Tier Resolution

CAR resolves the agent's current trust tier from their score:

| Tier | Score Range | Capability Level |
|------|------------|-----------------|
| T0 Sandbox | 0-199 | Sandbox only |
| T1 Observed | 200-349 | Limited operations |
| T2 Provisional | 350-499 | Basic operations |
| T3 Monitored | 500-649 | Standard operations |
| T4 Standard | 650-799 | Extended operations |
| T5 Trusted | 800-875 | Elevated operations |
| T6 Certified | 876-950 | Privileged operations |
| T7 Autonomous | 951-1000 | Full autonomy |

---

## API Endpoint

```
GET /v1/car/:entityId
```

**Response:**
```json
{
  "carId": "car_x9y8z7w6",
  "entityId": "agent_123",
  "organizationId": "org_456",
  "trustScore": 612,
  "trustTier": "T3",
  "trustLevel": "Monitored",
  "capabilities": [
    "external_api_call",
    "data_read",
    "internal_compute"
  ],
  "restrictions": [
    "no_financial_transactions",
    "no_bulk_data_export"
  ],
  "credentials": {
    "apiKeyValid": true,
    "issuedAt": "2026-01-15T00:00:00Z",
    "expiresAt": "2027-01-15T00:00:00Z"
  },
  "resolvedAt": "2026-02-18T19:45:00Z"
}
```

---

## Implementation Requirements

| Requirement | Description |
|-------------|-------------|
| **REQ-CAR-001** | Resolve agent identity from entityId |
| **REQ-CAR-002** | Retrieve current trust score and tier |
| **REQ-CAR-003** | Enumerate granted capabilities |
| **REQ-CAR-004** | Validate credentials (API key, token) |
| **REQ-CAR-005** | Complete resolution in < 200ms |
| **REQ-CAR-006** | Generate unique carId per resolution |

---

## Relationship to Vorion Platform

[Vorion Platform](/vorion-platform) is the Certificate Authority that **issues** agent identities, trust scores, and capability assignments. The CAR layer **reads** these records at runtime to resolve who the agent is before governance proceeds.

```
[Vorion Platform] ──issues identity──▶ [CAR resolves at runtime]
```

---

## Next Layer

Once CAR has resolved the agent's identity and capabilities, it passes to [**INTENT**](/layers/intent) for action parsing and risk assessment.

```
[CAR] ──agent record──▶ [INTENT]
```
