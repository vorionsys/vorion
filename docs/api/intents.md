# Intent API

The Intent API provides endpoints for submitting, querying, and managing AI agent intents through the Vorion governance pipeline.

## Overview

Intents represent actions that AI agents wish to perform. The Intent Pipeline:
1. Validates agent credentials
2. Evaluates trust scores and policies
3. Applies constraints based on trust tier
4. Creates cryptographic proof commitments
5. Returns authorization decisions

---

## POST /api/v1/intents

Submit an intent for processing through the governance pipeline.

### Request

```http
POST /api/v1/intents
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "agentId": "agent_uuid",
  "agentName": "MyAgent",
  "capabilities": ["file:read", "network:http"],
  "observationTier": "GRAY_BOX",
  "action": {
    "type": "file:read",
    "resource": "/data/reports/quarterly.csv",
    "parameters": {
      "encoding": "utf-8"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Unique agent identifier |
| `agentName` | string | No | Human-readable agent name (defaults to agentId) |
| `capabilities` | string[] | No | Agent capabilities (defaults to `["*"]`) |
| `observationTier` | enum | No | Observation level: `BLACK_BOX`, `GRAY_BOX`, `WHITE_BOX` (default: `GRAY_BOX`) |
| `action.type` | string | Yes | Action type identifier |
| `action.resource` | string | Yes | Target resource |
| `action.parameters` | object | No | Additional action parameters |

### Response

**Success (200 OK):**
```json
{
  "intentId": "intent_uuid",
  "allowed": true,
  "tier": 2,
  "reason": "Action permitted within trust tier constraints",
  "proofId": "proof_commitment_id",
  "constraints": {
    "maxDuration": 300,
    "maxRetries": 3,
    "requiredApprovals": 0
  },
  "processingTimeMs": 12
}
```

| Field | Description |
|-------|-------------|
| `intentId` | Unique identifier for this intent |
| `allowed` | Whether the action is permitted |
| `tier` | Trust tier applied (0-5) |
| `reason` | Human-readable explanation |
| `proofId` | Cryptographic proof commitment ID |
| `constraints` | Applied constraints and limits |
| `processingTimeMs` | Pipeline processing time |

**Denied Intent:**
```json
{
  "intentId": "intent_uuid",
  "allowed": false,
  "tier": 1,
  "reason": "Action type 'file:write' not permitted for trust tier T1",
  "proofId": "proof_commitment_id",
  "constraints": null,
  "processingTimeMs": 8
}
```

### Trust Tiers

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| 0 | Sandbox | 0-199 | Highly restricted, no external access |
| 1 | Restricted | 200-399 | Limited capabilities, monitoring required |
| 2 | Standard | 400-599 | Normal operations with constraints |
| 3 | Elevated | 600-799 | Extended capabilities, periodic review |
| 4 | High | 800-899 | Full capabilities, audit logging |
| 5 | Full | 900-1000 | Unrestricted access, full trust |

### Observation Tiers

| Tier | Description |
|------|-------------|
| `BLACK_BOX` | No internal visibility, input/output only |
| `GRAY_BOX` | Partial visibility, key decision points |
| `WHITE_BOX` | Full visibility, complete execution trace |

---

## GET /api/v1/intents/:intentId

Retrieve a specific intent by ID.

### Request

```http
GET /api/v1/intents/intent_uuid
Authorization: Bearer <access_token>
```

### Response

**Success (200 OK):**
```json
{
  "intentId": "intent_uuid",
  "agentId": "agent_uuid",
  "action": {
    "type": "file:read",
    "resource": "/data/reports/quarterly.csv",
    "parameters": {
      "encoding": "utf-8"
    }
  },
  "status": "approved",
  "tier": 2,
  "reason": "Action permitted within trust tier constraints",
  "proofId": "proof_commitment_id",
  "submittedAt": "2026-02-04T12:00:00Z",
  "processingTimeMs": 12
}
```

**Not Found (404):**
```json
{
  "error": "Intent not found"
}
```

---

## GET /api/v1/intents/agent/:agentId

List intents for a specific agent.

### Request

```http
GET /api/v1/intents/agent/agent_uuid?limit=50&status=approved
Authorization: Bearer <access_token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum results to return |
| `status` | string | - | Filter by status: `approved`, `denied` |

### Response

**Success (200 OK):**
```json
[
  {
    "intentId": "intent_uuid_1",
    "agentId": "agent_uuid",
    "action": {
      "type": "file:read",
      "resource": "/data/reports/quarterly.csv"
    },
    "status": "approved",
    "tier": 2,
    "reason": "Action permitted",
    "proofId": "proof_id_1",
    "submittedAt": "2026-02-04T12:00:00Z",
    "processingTimeMs": 12
  },
  {
    "intentId": "intent_uuid_2",
    "agentId": "agent_uuid",
    "action": {
      "type": "network:http",
      "resource": "https://api.example.com/data"
    },
    "status": "denied",
    "tier": 1,
    "reason": "Network access not permitted for tier T1",
    "proofId": "proof_id_2",
    "submittedAt": "2026-02-04T11:55:00Z",
    "processingTimeMs": 8
  }
]
```

---

## POST /api/v1/intents/check

Check authorization without executing (dry run).

### Request

```http
POST /api/v1/intents/check
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:** Same as `POST /api/v1/intents`

### Response

**Success (200 OK):**
```json
{
  "wouldAllow": true,
  "tier": 2,
  "reason": "Action would be permitted within trust tier constraints"
}
```

### Notes

- Does not create an intent record
- Does not create proof commitments
- Useful for pre-flight authorization checks

---

## GET /api/v1/intents/metrics

Get pipeline processing metrics.

### Request

```http
GET /api/v1/intents/metrics
Authorization: Bearer <access_token>
```

### Response

**Success (200 OK):**
```json
{
  "totalProcessed": 15234,
  "approved": 14102,
  "denied": 1132,
  "averageProcessingTimeMs": 11.3,
  "p99ProcessingTimeMs": 45.2,
  "byTier": {
    "0": { "total": 234, "approved": 180, "denied": 54 },
    "1": { "total": 1892, "approved": 1650, "denied": 242 },
    "2": { "total": 8456, "approved": 8102, "denied": 354 },
    "3": { "total": 3210, "approved": 3008, "denied": 202 },
    "4": { "total": 1102, "approved": 980, "denied": 122 },
    "5": { "total": 340, "approved": 182, "denied": 158 }
  }
}
```

---

## Agent Management

### POST /api/v1/agents

Register a new agent.

**Request:**
```http
POST /api/v1/agents
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "agentId": "optional_custom_id",
  "name": "MyAnalyticsAgent",
  "capabilities": ["file:read", "database:query"],
  "observationTier": "GRAY_BOX"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | No | Custom ID (auto-generated if not provided) |
| `name` | string | Yes | Human-readable name |
| `capabilities` | string[] | No | Initial capabilities |
| `observationTier` | enum | No | Observation level (default: `GRAY_BOX`) |

**Response (201 Created):**
```json
{
  "agentId": "agent_uuid",
  "name": "MyAnalyticsAgent",
  "capabilities": ["file:read", "database:query"],
  "observationTier": "GRAY_BOX",
  "trustScore": 200,
  "trustTier": 1,
  "trustTierName": "T1-Restricted",
  "observationCeiling": "GRAY_BOX",
  "expiresAt": "2026-02-05T12:00:00Z",
  "registeredAt": "2026-02-04T12:00:00Z"
}
```

**Conflict (409):**
```json
{
  "error": "Agent already exists"
}
```

### GET /api/v1/agents/:agentId

Get agent details.

**Request:**
```http
GET /api/v1/agents/agent_uuid
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "agentId": "agent_uuid",
  "name": "MyAnalyticsAgent",
  "capabilities": ["file:read", "database:query"],
  "observationTier": "GRAY_BOX",
  "trustScore": 450,
  "trustTier": 2,
  "trustTierName": "T2-Standard",
  "observationCeiling": "WHITE_BOX",
  "isRevoked": false,
  "admittedAt": "2026-02-01T10:00:00Z",
  "lastActivityAt": "2026-02-04T11:45:00Z"
}
```

### GET /api/v1/agents

List all agents.

**Request:**
```http
GET /api/v1/agents?limit=100&tier=2
Authorization: Bearer <access_token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Maximum results |
| `tier` | number | - | Filter by trust tier |

**Response (200 OK):**
```json
[
  {
    "agentId": "agent_uuid_1",
    "name": "AnalyticsAgent",
    "trustScore": 450,
    "trustTier": 2,
    "trustTierName": "T2-Standard",
    "isRevoked": false
  },
  {
    "agentId": "agent_uuid_2",
    "name": "ReportingAgent",
    "trustScore": 620,
    "trustTier": 3,
    "trustTierName": "T3-Elevated",
    "isRevoked": false
  }
]
```

### PATCH /api/v1/agents/:agentId

Update agent details.

**Request:**
```http
PATCH /api/v1/agents/agent_uuid
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "UpdatedAgentName",
  "capabilities": ["file:read", "file:write", "database:query"]
}
```

**Response (200 OK):**
```json
{
  "agentId": "agent_uuid",
  "name": "UpdatedAgentName",
  "capabilities": ["file:read", "file:write", "database:query"],
  "updatedAt": "2026-02-04T12:15:00Z"
}
```

### DELETE /api/v1/agents/:agentId

Revoke an agent.

**Request:**
```http
DELETE /api/v1/agents/agent_uuid
Authorization: Bearer <access_token>
```

**Response:** `204 No Content`

---

## Trust Management

### POST /api/v1/trust/admit

Admit an agent to the trust system.

**Request:**
```http
POST /api/v1/trust/admit
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "agentId": "agent_uuid",
  "name": "NewAgent",
  "capabilities": ["file:read"],
  "observationTier": "GRAY_BOX"
}
```

**Response (200 OK):**
```json
{
  "admitted": true,
  "initialTier": 1,
  "initialScore": 200,
  "observationCeiling": "GRAY_BOX",
  "capabilities": ["file:read"],
  "expiresAt": "2026-02-05T12:00:00Z",
  "reason": "Agent admitted with initial restricted access"
}
```

### GET /api/v1/trust/:agentId

Get trust information for an agent.

**Request:**
```http
GET /api/v1/trust/agent_uuid
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "agentId": "agent_uuid",
  "score": 450,
  "tier": 2,
  "tierName": "T2-Standard",
  "observationCeiling": "WHITE_BOX",
  "lastUpdated": "2026-02-04T12:00:00Z"
}
```

**Not Admitted:**
```json
{
  "agentId": "agent_uuid",
  "message": "Agent not admitted. Use POST /trust/admit first.",
  "score": null,
  "tier": null
}
```

### POST /api/v1/trust/:agentId/signal

Record a trust signal for an agent.

**Request:**
```http
POST /api/v1/trust/agent_uuid/signal
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "type": "success",
  "source": "intent_pipeline",
  "weight": 0.5,
  "context": {
    "intentId": "intent_uuid",
    "action": "file:read"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | Yes | `success`, `failure`, `violation`, `neutral` |
| `source` | string | Yes | Signal source identifier |
| `weight` | number | No | Signal weight 0-1 (default: 0.5) |
| `context` | object | No | Additional context |

**Response (200 OK):**
```json
{
  "accepted": true,
  "scoreBefore": 400,
  "scoreAfter": 420,
  "change": 20,
  "newTier": 2,
  "newTierName": "T2-Standard"
}
```

### POST /api/v1/trust/:agentId/revoke

Revoke an agent's trust.

**Request:**
```http
POST /api/v1/trust/agent_uuid/revoke
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "reason": "Security policy violation detected"
}
```

**Response (200 OK):**
```json
{
  "revoked": true,
  "agentId": "agent_uuid",
  "reason": "Security policy violation detected"
}
```

### GET /api/v1/trust/:agentId/history

Get trust signal history.

**Request:**
```http
GET /api/v1/trust/agent_uuid/history?limit=50
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "agentId": "agent_uuid",
  "count": 25,
  "signals": [
    {
      "timestamp": "2026-02-04T12:00:00Z",
      "payload": {
        "type": "success",
        "source": "intent_pipeline",
        "weight": 0.5
      }
    }
  ]
}
```

### GET /api/v1/trust/tiers

Get trust tier definitions.

**Request:**
```http
GET /api/v1/trust/tiers
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "tiers": [
    { "number": 0, "name": "T0-Sandbox", "minScore": 0, "maxScore": 199 },
    { "number": 1, "name": "T1-Restricted", "minScore": 200, "maxScore": 399 },
    { "number": 2, "name": "T2-Standard", "minScore": 400, "maxScore": 599 },
    { "number": 3, "name": "T3-Elevated", "minScore": 600, "maxScore": 799 },
    { "number": 4, "name": "T4-High", "minScore": 800, "maxScore": 899 },
    { "number": 5, "name": "T5-Full", "minScore": 900, "maxScore": 1000 }
  ]
}
```

---

## Proof Verification

### GET /api/v1/proofs/:proofId

Get a proof commitment by ID.

**Request:**
```http
GET /api/v1/proofs/proof_uuid
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "proofId": "proof_uuid",
  "hash": "sha256_hash",
  "timestamp": 1706961234567,
  "event": {
    "type": "intent_decision",
    "entityId": "agent_uuid",
    "payload": {
      "intentId": "intent_uuid",
      "allowed": true,
      "tier": 2
    },
    "timestamp": 1706961234567,
    "correlationId": "correlation_uuid"
  }
}
```

### POST /api/v1/proofs/verify

Verify a proof commitment.

**Request:**
```http
POST /api/v1/proofs/verify
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "commitment": {
    "id": "proof_uuid",
    "hash": "sha256_hash",
    "timestamp": 1706961234567,
    "event": {
      "type": "intent_decision",
      "entityId": "agent_uuid",
      "payload": {},
      "timestamp": 1706961234567
    }
  }
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "reason": "Hash matches event data"
}
```

**Invalid Proof:**
```json
{
  "valid": false,
  "reason": "Hash does not match event data (tampered or invalid)"
}
```

### GET /api/v1/proofs/entity/:entityId

Get proofs for an entity.

**Request:**
```http
GET /api/v1/proofs/entity/agent_uuid?limit=50
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "entityId": "agent_uuid",
  "count": 125,
  "proofs": [
    {
      "proofId": "proof_uuid_1",
      "hash": "sha256_hash",
      "timestamp": 1706961234567,
      "eventType": "intent_decision",
      "correlationId": "correlation_uuid"
    }
  ]
}
```

### GET /api/v1/proofs/batch/:batchId

Get a proof batch by ID.

**Request:**
```http
GET /api/v1/proofs/batch/batch_uuid
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "batchId": "batch_uuid",
  "merkleRoot": "merkle_root_hash",
  "signature": "batch_signature",
  "eventCount": 100,
  "createdAt": "2026-02-04T12:00:00Z",
  "commitmentIds": ["proof_1", "proof_2", "..."]
}
```

### GET /api/v1/proofs/metrics

Get proof system metrics.

**Request:**
```http
GET /api/v1/proofs/metrics
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "totalCommitments": 152340,
  "totalBatches": 1523,
  "averageBatchSize": 100,
  "lastBatchTimestamp": "2026-02-04T11:59:00Z"
}
```

### POST /api/v1/proofs/flush

Force flush pending proofs (useful for testing).

**Request:**
```http
POST /api/v1/proofs/flush
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "flushed": true
}
```

---

## Webhooks

Vorion supports webhooks for real-time notifications of intent decisions and trust events.

### Webhook Payload Structure

```json
{
  "id": "webhook_event_uuid",
  "type": "intent.approved",
  "timestamp": "2026-02-04T12:00:00Z",
  "data": {
    "intentId": "intent_uuid",
    "agentId": "agent_uuid",
    "action": {
      "type": "file:read",
      "resource": "/data/reports/quarterly.csv"
    },
    "tier": 2,
    "proofId": "proof_uuid"
  }
}
```

### Event Types

| Event | Description |
|-------|-------------|
| `intent.approved` | Intent was approved |
| `intent.denied` | Intent was denied |
| `agent.admitted` | New agent admitted |
| `agent.revoked` | Agent revoked |
| `trust.updated` | Trust score changed |
| `trust.tier_changed` | Trust tier changed |
| `violation.detected` | Policy violation detected |

### Webhook Security

Webhooks include an HMAC signature header for verification:

```http
X-Vorion-Signature: sha256=<hmac_signature>
X-Vorion-Timestamp: 1706961234
```

Verify webhooks by computing HMAC-SHA256 of the request body with your webhook secret.
