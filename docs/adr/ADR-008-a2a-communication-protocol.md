# ADR-008: Agent-to-Agent Communication Protocol

## Status
**Accepted** - January 2025

## Context

As AI agent ecosystems grow, agents need to collaborate with each other. A payment processor agent might need to invoke an invoice generator, or a data analysis agent might query multiple specialized data sources. Without a standardized A2A protocol:

1. **Trust becomes unmaintainable** - Each integration requires custom trust verification
2. **Chains are untracked** - Multi-hop calls lose accountability
3. **Attestations are fragmented** - A2A interactions don't contribute to trust scoring
4. **Security is ad-hoc** - No standard for capability negotiation

## Decision

We implement a **trust-aware A2A protocol** with the following components:

### 1. Message Envelope

All A2A communication uses a standard envelope:

```typescript
interface A2AMessage {
  id: string;
  version: '1.0';
  type: 'invoke' | 'response' | 'stream' | 'negotiate' | 'delegate';
  from: string;  // Caller CAR
  to: string;    // Callee CAR
  timestamp: string;
  correlationId?: string;
  trustContext: TrustContext;
  payload: A2APayload;
  signature?: string;
}
```

### 2. Trust Context

Every message carries trust context:

```typescript
interface TrustContext {
  callerTier: number;
  callerScore: number;
  callerTenant: string;
  trustProof?: TrustProof;    // Signed by Agent Anchor
  delegation?: DelegationToken;
  callChain: ChainLink[];     // For nested calls
}
```

### 3. Trust Verification

Before executing an A2A call:

1. **Verify caller exists** in Agent Anchor registry
2. **Validate trust proof** signature and expiration
3. **Check against requirements** (min tier, capabilities)
4. **Calculate effective trust** considering delegation and chain

### 4. Chain-of-Trust Tracking

Nested calls maintain a trust chain:

| Mode | Effective Trust |
|------|-----------------|
| `minimum` | min(all agents in chain) |
| `weighted` | weighted average, recent = higher |
| `caller_only` | immediate caller only |
| `root_only` | original initiator only |

Default: `minimum` - trust is the weakest link.

### 5. Delegation

Agents can delegate authority:

```typescript
interface DelegationToken {
  delegator: string;
  delegate: string;
  actions: string[];
  maxTier: number;        // Cannot exceed delegator's tier
  expiresAt: string;
  usesRemaining: number;
  canRedelegate: boolean;
  constraints?: {
    allowedTargets?: string[];
    blockedTargets?: string[];
    rateLimit?: number;
  };
}
```

### 6. A2A Attestations

Every A2A interaction generates attestation data:

- Caller/callee CARs
- Action and outcome
- Response time
- Trust requirements met/violated
- Chain depth
- Delegation usage

This feeds into trust scoring for both parties.

## Trust Requirements by Tier

| Tier | A2A Capabilities |
|------|-----------------|
| T0-T4 | Cannot initiate A2A |
| T5 | Can invoke T5+ agents |
| T6 | Can invoke any agent, receive delegations |
| T7 | Full A2A, can delegate |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/a2a/invoke` | POST | Invoke action on another agent |
| `/v1/a2a/discover` | GET | Discover available agents |
| `/v1/a2a/register` | POST | Register A2A endpoint |
| `/v1/a2a/chain/:id` | GET | Get chain-of-trust info |
| `/v1/a2a/ping` | POST | Check agent availability |
| `/v1/a2a/health` | GET | A2A system health |

## Consequences

### Positive
- **Standardized trust** - All A2A uses same verification
- **Accountability** - Full chain tracked and attested
- **Trust building** - A2A interactions improve scores
- **Delegation** - Enables complex agent orchestration

### Negative
- **Overhead** - Trust verification on every call (~10ms)
- **Complexity** - Chain tracking adds state management
- **T5+ requirement** - Blocks low-tier agents from A2A

### Neutral
- **Circuit breakers** - Required for resilience
- **Message signing** - Optional but recommended for T6+

## Implementation

### Files Created
- `src/a2a/types.ts` - Protocol types and constants
- `src/a2a/trust-negotiation.ts` - Trust verification service
- `src/a2a/router.ts` - Message routing with circuit breakers
- `src/a2a/chain-of-trust.ts` - Chain tracking and validation
- `src/a2a/attestation.ts` - A2A attestation generation
- `src/a2a/routes.ts` - REST API endpoints
- `src/a2a/index.ts` - Module exports

### SDK Extensions
- `anchor.a2aInvoke()` - Invoke another agent
- `anchor.a2aDiscover()` - Find available agents
- `anchor.a2aPing()` - Check availability
- `anchor.a2aGetChain()` - Get chain info
- `anchor.a2aRegisterEndpoint()` - Register for A2A

## Alternatives Considered

### 1. Direct HTTP Between Agents
Rejected: No trust verification, no chain tracking, fragmented attestations.

### 2. Message Queue (NATS/Kafka)
Rejected: Adds infrastructure complexity. Protocol can use any transport; HTTP is default.

### 3. Trust Caller Only (No Chain Tracking)
Rejected: Multi-hop calls would bypass trust requirements. A malicious T7 could proxy requests from T0.

### 4. Allow All Tiers to A2A
Rejected: Low-tier agents haven't proven trustworthy. T5+ requirement ensures baseline reliability.

## Security Considerations

1. **Trust proofs expire in 5 minutes** - Prevents replay attacks
2. **Chain depth limited to 10** - Prevents infinite loops
3. **Delegation chain limited to 3** - Prevents authority laundering
4. **Circuit breakers per endpoint** - Prevents cascade failures
5. **Rate limiting per caller** - Prevents abuse

## References

- [ADR-002: 8-Tier Trust Model](ADR-002-8-tier-trust-model.md)
- [ADR-004: Trust Computed at Runtime](ADR-004-trust-computed-at-runtime.md)
- [ADR-007: Tier-Based Sandbox Isolation](ADR-007-tier-based-sandbox-isolation.md)
