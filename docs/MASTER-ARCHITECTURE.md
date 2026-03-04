# Vorion Master Architecture
## Business & Governance Reference

**Version:** 1.1.0
**Last Updated:** February 3, 2026
**Status:** Active

> **Cross-References:**
> - **Trust Tier Definitions (T0-T7):** See [ADR-002](adr/ADR-002-8-tier-trust-model.md) - the authoritative source
> - **Operational Architecture:** See [PLATFORM-ARCHITECTURE.md](PLATFORM-ARCHITECTURE.md) for data flow, APIs, persistence
> - **Agent Identifier Format:** CAR (Categorical Agentic Registry) replaces CAR

---

## Websites & Domains (CANONICAL - DO NOT DEVIATE)

> ⚠️ **PERMANENT RECORD** - If you type the wrong domain, this is your correction source.

### Domain Registry

| Domain | Purpose | Audience | Content |
|--------|---------|----------|---------|
| **vorion.org** | Corporate HQ & Foundation | Investors, partners, public | Company info, vision, team, investor relations |
| **basis.vorion.org** | Trust Foundation Docs | Technical architects | BASIS spec, trust theory, whitepapers |
| **learn.vorion.org** | HITL Certification Academy | Operators, supervisors | Human certification for AI oversight |
| **agentanchorai.com** | Agent Registration & Certification | Agents, developers | Agent onboarding, trust badges, verification |
| **aurais.net** | Consumer & B2B Applications | End users, businesses | DTC apps (Aurais/Pro/Exec), B2B dashboards |
| **cognigate.dev** | Developer Platform | Developers, builders | SDK, API docs, playground, npm packages |

### Quick Reference (Memorize This)

```
WRONG → RIGHT
─────────────────────────────────────────────────────────
aurais.com      → aurais.NET      (apps live here)
vorion.ORG                        (corporate HQ)
learn.vorion.org                  (developer docs)
api.vorion.org  → cognigate.DEV   (API reference)
─────────────────────────────────────────────────────────
```

### Domain Purpose Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VORION DOMAIN ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        vorion.org                                    │   │
│  │                    CORPORATE FOUNDATION                              │   │
│  │  • Company info, team, mission                                       │   │
│  │  • Investor relations                                                │   │
│  │  • Press & media                                                     │   │
│  │  • Careers                                                           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  SUBDOMAINS:                                                         │   │
│  │  ├── basis.vorion.org    → Trust theory, specs, whitepapers         │   │
│  │  └── learn.vorion.org    → HITL Certification Academy (human certs) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      agentanchorai.com                               │   │
│  │              AGENT REGISTRATION & CERTIFICATION                      │   │
│  │  • Agent onboarding & registration                                   │   │
│  │  • Trust score lookup / verification                                 │   │
│  │  • Certification badges & trust seals                                │   │
│  │  • Audit trail viewer                                                │   │
│  │  • "Is this agent registered?" public API                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        aurais.net                                    │   │
│  │                   APPLICATIONS (DTC + B2B)                           │   │
│  │  • Aurais (Consumer) - Personal AI assistant                         │   │
│  │  • Aurais Pro (Professional) - Multi-agent workflows                 │   │
│  │  • Aurais Exec (Enterprise) - Fleet management, compliance           │   │
│  │  • B2B Dashboard - Enterprise admin, team management                 │   │
│  │  • App downloads, pricing, account management                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       cognigate.dev                                  │   │
│  │                   DEVELOPER PLATFORM                                 │   │
│  │  • API Documentation                                                 │   │
│  │  • SDK Downloads & npm packages                                      │   │
│  │  • Interactive Playground / Sandbox                                  │   │
│  │  • Code examples & quickstarts                                       │   │
│  │  • Developer dashboard & API keys                                    │   │
│  │  • Status page & changelog                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Audience Routing

| If you are a... | Go to... |
|-----------------|----------|
| Consumer wanting an AI assistant | aurais.net |
| Business wanting AI for your team | aurais.net/business |
| Developer building on our platform | cognigate.dev |
| Investor/partner evaluating us | vorion.org |
| Learning about trust architecture | basis.vorion.org |
| Human getting HITL certification | learn.vorion.org |
| Registering/certifying an AI agent | agentanchorai.com |

---

## Product Portfolio

| Product | Audience | Description | Monetization |
|---------|----------|-------------|--------------|
| **Aurais** | Consumers | Personal AI assistant with trust guardrails | Freemium |
| **Aurais Pro** | Professionals/SMB | Multi-agent workflows, team features | Subscription |
| **Aurais Exec** | Enterprise | Fleet management, compliance, audit | Custom pricing |
| **AgentAnchorAI** | Developers/B2B | Trust-as-a-Service backend API | Usage-based |

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WHAT WE SELL (Consumer Products)                  │
│                         aurais.com                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │   AURAIS    │  │ AURAIS PRO  │  │ AURAIS EXEC │                  │
│  │  Consumer   │  │Professional │  │ Enterprise  │                  │
│  │  Freemium   │  │Subscription │  │  Custom     │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         └────────────────┼────────────────┘                          │
│                          │ powered by                                │
│                          ▼                                           │
├─────────────────────────────────────────────────────────────────────┤
│                    WHAT POWERS IT (Infrastructure)                   │
│                      agentanchorai.com                               │
│                   Trust-as-a-Service API                             │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ALSO SOLD DIRECTLY TO:                                       │  │
│  │  • Developers building AI agents (SDK + API)                  │  │
│  │  • Enterprises needing trust infrastructure (white-label)     │  │
│  │  • AI platform companies (OEM licensing)                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Two Trust Model

### Conceptual Framework

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   "THE DOOR"                          "THE HANDSHAKE"               │
│   ───────────                         ───────────────               │
│   Base Trust                          Living Trust                  │
│   Can you enter?                      Are you behaving?             │
│                                                                     │
│   ┌─────────────────┐                 ┌─────────────────┐          │
│   │                 │                 │                 │          │
│   │  GATE TRUST     │ ──────────────► │  DYNAMIC TRUST  │          │
│   │                 │    Admission    │                 │          │
│   │  - Identity     │                 │  - Behavior     │          │
│   │  - Credentials  │                 │  - Performance  │          │
│   │  - Capabilities │                 │  - Compliance   │          │
│   │  - Observation  │                 │  - Decay        │          │
│   │    Tier         │                 │  - Recovery     │          │
│   │                 │                 │                 │          │
│   └─────────────────┘                 └─────────────────┘          │
│          │                                   │                      │
│          │ One-time at                       │ Continuous           │
│          │ registration                      │ every action         │
│          │                                   │                      │
│          ▼                                   ▼                      │
│   ┌─────────────────┐                 ┌─────────────────┐          │
│   │  T0-T7 Initial  │                 │  Score 0-1000   │          │
│   │  Tier Assignment│                 │  (Fluctuates)   │          │
│   └─────────────────┘                 └─────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation

| Aspect | Gate Trust (The Door) | Dynamic Trust (The Handshake) |
|--------|----------------------|-------------------------------|
| **When** | Agent registration | Every action |
| **Package** | `@vorion/basis` | `@vorion/a3i` + `atsf-core` |
| **Checks** | Identity, credentials, observation tier | Behavior, performance, decay |
| **Frequency** | Once (re-evaluated on credential change) | Continuous |
| **Speed** | Can be slow (100-500ms) | Must be fast (<50ms) |
| **Cacheable** | Yes (hours/days) | Limited (seconds) |

### Unified Trust Function

```typescript
/**
 * TrustGate - The unified trust interface
 *
 * Combines Gate Trust (the door) and Dynamic Trust (the handshake)
 * into a single, fast decision function.
 */

interface TrustGate {
  /**
   * THE DOOR - Called once at registration
   * Can be slow, result is cached
   */
  admit(agent: AgentCredentials): Promise<AdmissionResult>;

  /**
   * THE HANDSHAKE - Called every action
   * Must be fast (<50ms), uses cached gate trust
   */
  authorize(agentId: string, action: Action): Promise<AuthorizationResult>;

  /**
   * Combined check - door + handshake in one call
   * For new/unknown agents
   */
  fullCheck(agent: AgentCredentials, action: Action): Promise<FullCheckResult>;
}

interface AdmissionResult {
  admitted: boolean;
  initialTier: TrustTier;        // T0-T7
  observationCeiling: number;    // Max trust based on visibility
  capabilities: string[];        // What they claimed they can do
  expiresAt: Date;               // When to re-verify
}

interface AuthorizationResult {
  allowed: boolean;
  tier: DecisionTier;            // GREEN/YELLOW/RED
  currentScore: number;          // 0-1000
  constraints?: Constraints;     // If allowed, with what limits
  refinements?: Refinement[];    // If YELLOW, how to fix
  reason: string;                // Human-readable
  latencyMs: number;             // How long this took
}
```

---

## Trust Parity: HITL Certification (CRITICAL CONCEPT)

> ⚠️ **ROLLOUT STATUS**: Build curriculum OFFLINE now. Badges/certification launch LATER.
> Users completing courses in Phase 1 auto-credit when Phase 2 goes live.

### Phased Rollout Strategy

| Phase | Status | learn.vorion.org Shows | Behind the Scenes |
|-------|--------|------------------------|-------------------|
| **Phase 1** | NOW | "AI Training & Education" | Building H1-H5 curriculum |
| **Phase 2** | LATER | "HITL Certification Academy" | Flip badge system on |
| **Phase 3** | FUTURE | "Required for T4+ agents" | Enforce parity rules |

### The Problem

> **Can a T5 agent outwit a T2 HITL?**

Yes. This is a governance gap. If an agent operates at a trust level higher than its human supervisor's capability to understand or detect issues, the oversight becomes theater.

### The Solution: Trust Parity

Humans supervising AI agents MUST be certified at or above the agent's trust tier.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRUST PARITY MODEL                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  AGENT TRUST TIERS              HITL CERTIFICATION LEVELS                   │
│  (agentanchorai.com)            (learn.vorion.org)                          │
│  ──────────────────             ─────────────────────                       │
│                                                                             │
│  T0 Sandbox    (0-199)    ◄───  H1 Observer    │ Can monitor T0-T1         │
│  T1 Observed   (200-349)  ◄───  H1 Observer    │ Basic oversight           │
│  ───────────────────────────────────────────────────────────────────────   │
│  T2 Provisional(350-499)  ◄───  H2 Operator    │ Can monitor T0-T3         │
│  T3 Monitored  (500-649)  ◄───  H2 Operator    │ Understands trust signals │
│  ───────────────────────────────────────────────────────────────────────   │
│  T4 Standard   (650-799)  ◄───  H3 Supervisor  │ Can monitor T0-T5         │
│  T5 Trusted    (800-875)  ◄───  H3 Supervisor  │ Advanced threat detection │
│  ───────────────────────────────────────────────────────────────────────   │
│  T6 Certified  (876-950)  ◄───  H4 Auditor     │ Can monitor T0-T6         │
│  ───────────────────────────────────────────────────────────────────────   │
│  T7 Autonomous (951-1000) ◄───  H5 Architect   │ Can certify T7 agents     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### HITL Certification Levels (learn.vorion.org)

| Level | Title | Can Supervise | Training Focus |
|-------|-------|---------------|----------------|
| **H1** | Observer | T0-T1 agents | Basic AI safety, recognizing failures |
| **H2** | Operator | T0-T3 agents | Trust signals, decay patterns, escalation |
| **H3** | Supervisor | T0-T5 agents | Threat detection, adversarial behavior |
| **H4** | Auditor | T0-T6 agents | Compliance, proof verification, forensics |
| **H5** | Architect | All (T0-T7) | System design, certification authority |

### Why This Matters

```
SCENARIO: T5 Agent with H2 HITL

Agent: "I need to access the production database to complete this task."
H2: "Looks reasonable, approved."

WHAT H2 MISSED:
- Agent has been slowly building trust through small requests
- This request is a trust escalation attack
- A H3+ would recognize the pattern

RESULT: Data breach
ROOT CAUSE: Trust parity violation
```

### Enforcement Rules

1. **Minimum Parity**: HITL cert level must be ≥ agent tier mapping
2. **Escalation Required**: If agent requests exceed HITL capability, auto-escalate
3. **Ceiling Lock**: Agent cannot exceed trust tier that HITL can supervise
4. **Audit Trail**: All parity violations logged to proof plane

### Implementation

```typescript
interface HITLCertification {
  userId: string;
  level: 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
  maxAgentTier: number;  // H1=1, H2=3, H3=5, H4=6, H5=7
  certifiedAt: Date;
  expiresAt: Date;       // Annual recertification required
  issuedBy: string;      // learn.vorion.org
}

interface TrustParityCheck {
  agentTier: number;
  hitlLevel: HITLCertification;

  canSupervise(): boolean {
    return this.hitlLevel.maxAgentTier >= this.agentTier;
  }

  getParityGap(): number {
    return Math.max(0, this.agentTier - this.hitlLevel.maxAgentTier);
  }
}

// In decision flow:
async function authorizeWithParity(
  agent: Agent,
  hitl: HITLCertification,
  action: Action
): Promise<AuthorizationResult> {
  const parityCheck = new TrustParityCheck(agent.tier, hitl);

  if (!parityCheck.canSupervise()) {
    return {
      allowed: false,
      reason: `Trust parity violation: Agent T${agent.tier} requires H${requiredLevel}+ supervisor`,
      escalateTo: findQualifiedHITL(agent.tier),
    };
  }

  // Continue normal authorization...
}
```

### Certification Paths

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HITL CERTIFICATION PATHS                                  │
│                      learn.vorion.org                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FOUNDATION TRACK                    SPECIALIST TRACKS                      │
│  ─────────────────                   ──────────────────                     │
│                                                                             │
│  ┌───────────┐                       ┌───────────────────┐                  │
│  │    H1     │ ──────────────────────┤ H2-Security       │                  │
│  │ Observer  │                       │ Focus: Threats    │                  │
│  └─────┬─────┘                       └───────────────────┘                  │
│        │                                                                    │
│        ▼                             ┌───────────────────┐                  │
│  ┌───────────┐                       │ H2-Compliance     │                  │
│  │    H2     │ ──────────────────────┤ Focus: Regulations│                  │
│  │ Operator  │                       └───────────────────┘                  │
│  └─────┬─────┘                                                              │
│        │                             ┌───────────────────┐                  │
│        ▼                             │ H3-Enterprise     │                  │
│  ┌───────────┐                       │ Focus: Scale      │                  │
│  │    H3     │ ──────────────────────┤                   │                  │
│  │Supervisor │                       └───────────────────┘                  │
│  └─────┬─────┘                                                              │
│        │                                                                    │
│        ▼                                                                    │
│  ┌───────────┐        ┌───────────┐                                        │
│  │    H4     │ ──────►│    H5     │                                        │
│  │  Auditor  │        │ Architect │                                        │
│  └───────────┘        └───────────┘                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Proof Plane: Zero-Latency Design

### The Problem

Proof recording must not slow down the action. Current design:
```
Intent → Proof → Decide → Proof → Execute → Proof → Done
         ↑                 ↑                ↑
         Sync writes = 3x latency penalty
```

### The Solution: Async Proof with ZK Commitments

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ZERO-LATENCY PROOF DESIGN                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  HOT PATH (Synchronous - must be fast)                              │
│  ──────────────────────────────────────                             │
│                                                                     │
│  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐              │
│  │ INTENT │───►│ DECIDE │───►│EXECUTE │───►│RESPOND │              │
│  └───┬────┘    └───┬────┘    └───┬────┘    └────────┘              │
│      │             │             │                                  │
│      │ Commit      │ Commit      │ Commit                           │
│      │ (hash only) │ (hash only) │ (hash only)                      │
│      ▼             ▼             ▼                                  │
│  ┌─────────────────────────────────────┐                            │
│  │         COMMITMENT BUFFER           │ ◄── In-memory, <1ms        │
│  │    [hash1, hash2, hash3, ...]       │                            │
│  └──────────────────┬──────────────────┘                            │
│                     │                                               │
│                     │ Async flush (every 100ms or 100 events)       │
│                     ▼                                               │
│  ──────────────────────────────────────────────────────────────     │
│                                                                     │
│  COLD PATH (Asynchronous - can be slow)                             │
│  ────────────────────────────────────────                           │
│                                                                     │
│  ┌─────────────────────────────────────┐                            │
│  │          PROOF AGGREGATOR           │                            │
│  │  - Batch events                     │                            │
│  │  - Build Merkle tree                │                            │
│  │  - Sign batch                       │                            │
│  └──────────────────┬──────────────────┘                            │
│                     │                                               │
│                     ▼                                               │
│  ┌─────────────────────────────────────┐                            │
│  │          PROOF STORE                │ ◄── Persistent             │
│  │  - Event log                        │                            │
│  │  - Merkle roots                     │                            │
│  │  - Signatures                       │                            │
│  └──────────────────┬──────────────────┘                            │
│                     │                                               │
│                     │ Optional: hourly/daily                        │
│                     ▼                                               │
│  ┌─────────────────────────────────────┐                            │
│  │          CHAIN ANCHOR               │ ◄── Blockchain (optional)  │
│  │  - Merkle root on-chain             │                            │
│  │  - Timestamped                      │                            │
│  └─────────────────────────────────────┘                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
/**
 * ProofCommitment - Fast synchronous commitment
 * Just computes hash, stores in buffer, returns immediately
 */
class CommitmentBuffer {
  private buffer: ProofCommitment[] = [];
  private readonly maxSize = 100;
  private readonly flushIntervalMs = 100;

  /**
   * Commit an event - MUST complete in <1ms
   */
  commit(event: ProofEvent): string {
    const commitment: ProofCommitment = {
      id: crypto.randomUUID(),
      hash: this.fastHash(event),  // SHA-256, ~0.1ms
      timestamp: Date.now(),
      event,  // Held in memory until flush
    };

    this.buffer.push(commitment);

    // Trigger async flush if buffer full
    if (this.buffer.length >= this.maxSize) {
      setImmediate(() => this.flush());
    }

    return commitment.id;  // Return immediately
  }

  /**
   * Fast hash - no crypto signing, just content hash
   */
  private fastHash(event: ProofEvent): string {
    // Use streaming hash for large payloads
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(event));
    return hash.digest('hex');
  }

  /**
   * Async flush - runs in background
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);
    await this.proofAggregator.processBatch(batch);
  }
}

/**
 * ProofAggregator - Async batch processing
 * Builds Merkle trees, signs, persists
 */
class ProofAggregator {
  async processBatch(commitments: ProofCommitment[]): Promise<void> {
    // 1. Build Merkle tree from hashes
    const leaves = commitments.map(c => c.hash);
    const merkleRoot = this.buildMerkleTree(leaves);

    // 2. Sign the batch
    const signature = await this.sign(merkleRoot);

    // 3. Persist to proof store
    await this.proofStore.writeBatch({
      batchId: crypto.randomUUID(),
      merkleRoot,
      signature,
      events: commitments,
      timestamp: new Date(),
    });

    // 4. Optionally anchor to chain (hourly/daily)
    if (this.shouldAnchor()) {
      await this.chainAnchor.anchor(merkleRoot);
    }
  }
}
```

### Latency Budget

| Operation | Target | Max |
|-----------|--------|-----|
| Commitment (hash) | 0.1ms | 1ms |
| Authorization check | 10ms | 50ms |
| Full intent processing | 50ms | 200ms |
| Proof batch write | N/A (async) | 1000ms |
| Chain anchor | N/A (async) | 30000ms |

---

## Technical Answers

### Q1: How to Unify Two Trust Engines Without Breaking Tests?

**Current State:**
- `atsf-core/TrustEngine`: Decay, signals, persistence (159 tests)
- `a3i/TrustDynamicsEngine`: 10:1 asymmetry, cooldowns (14 tests)

**Strategy: Facade Pattern with Feature Flags**

```typescript
/**
 * TrustFacade - Unified interface that delegates to both engines
 *
 * Migration path:
 * 1. Both engines run, facade coordinates
 * 2. Add feature flags to route traffic
 * 3. Gradually shift to single engine
 * 4. Deprecate redundant engine
 */

interface TrustFacadeConfig {
  // Feature flags for gradual migration
  useAtsfForPersistence: boolean;  // true = atsf handles storage
  useA3iForDynamics: boolean;      // true = a3i handles asymmetry

  // Source of truth for score
  primaryScoreSource: 'atsf' | 'a3i';
}

class TrustFacade {
  private atsf: TrustEngine;
  private a3i: TrustDynamicsEngine;
  private config: TrustFacadeConfig;

  async getScore(entityId: string): Promise<number> {
    if (this.config.primaryScoreSource === 'atsf') {
      const record = await this.atsf.getScore(entityId);
      return record?.score ?? 0;
    } else {
      // a3i doesn't store scores, so we still read from atsf
      // but a3i modifies them
      const record = await this.atsf.getScore(entityId);
      return record?.score ?? 0;
    }
  }

  async recordSignal(signal: TrustSignal): Promise<void> {
    // Always persist via atsf
    if (this.config.useAtsfForPersistence) {
      await this.atsf.recordSignal(signal);
    }

    // Apply dynamics via a3i if enabled
    if (this.config.useA3iForDynamics) {
      const currentScore = await this.getScore(signal.entityId);
      const isSuccess = signal.value >= 0.7;

      const result = this.a3i.updateTrust(signal.entityId, {
        currentScore,
        success: isSuccess,
        ceiling: 1000,
      });

      // If a3i modified the score, persist the change
      if (result.delta !== 0) {
        await this.atsf.setScore(signal.entityId, result.newScore);
      }
    }
  }
}

// Tests continue to work because:
// 1. TrustEngine tests still pass (atsf unchanged)
// 2. TrustDynamicsEngine tests still pass (a3i unchanged)
// 3. New TrustFacade tests verify coordination
```

**Migration Timeline:**
1. Week 1: Create facade, all tests pass
2. Week 2: Deploy with `primaryScoreSource: 'atsf'`
3. Week 3: Monitor, compare outputs
4. Week 4: If stable, deprecate a3i redundant features

---

### Q2: How to Add Network Isolation to Cognigate?

**Current State:**
- Memory limits via `resourceLimits.maxOldGenerationSizeMb` ✓
- CPU limits via worker thread isolation ✓
- Network isolation: ❌ Missing

**Solution: Network Namespace + Firewall Rules**

```typescript
/**
 * NetworkIsolation - Per-execution network sandboxing
 *
 * Options:
 * 1. Node.js: Block at DNS/fetch level (lightweight)
 * 2. Container: Network namespace (heavyweight but complete)
 * 3. Firewall: iptables rules per process (Linux only)
 *
 * We use Option 1 for speed + Option 3 for security-critical.
 */

interface NetworkPolicy {
  // Allowlist approach - deny by default
  allowedHosts: string[];       // e.g., ['api.openai.com']
  allowedPorts: number[];       // e.g., [443]
  maxConnections: number;       // e.g., 10
  maxBandwidthKbps: number;     // e.g., 1000
  dnsServers?: string[];        // Override DNS
}

// Option 1: Intercept at Node.js level
class NetworkInterceptor {
  private policy: NetworkPolicy;
  private connectionCount = 0;
  private bytesTransferred = 0;

  constructor(policy: NetworkPolicy) {
    this.policy = policy;
  }

  /**
   * Wrap fetch to enforce policy
   */
  createSandboxedFetch(): typeof fetch {
    return async (input: RequestInfo, init?: RequestInit) => {
      const url = new URL(input.toString());

      // Check allowlist
      if (!this.policy.allowedHosts.includes(url.hostname)) {
        throw new NetworkPolicyError(`Host not allowed: ${url.hostname}`);
      }

      // Check port
      const port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
      if (!this.policy.allowedPorts.includes(port)) {
        throw new NetworkPolicyError(`Port not allowed: ${port}`);
      }

      // Check connection limit
      if (this.connectionCount >= this.policy.maxConnections) {
        throw new NetworkPolicyError('Connection limit exceeded');
      }

      this.connectionCount++;
      try {
        const response = await fetch(input, init);
        // Could also track bandwidth here
        return response;
      } finally {
        this.connectionCount--;
      }
    };
  }

  /**
   * Block all network access
   */
  createBlockedFetch(): typeof fetch {
    return async () => {
      throw new NetworkPolicyError('Network access not permitted');
    };
  }
}

// In CognigateGateway:
private async executeInSandbox(
  handler: ExecutionHandler,
  intent: Intent,
  limits: ResourceLimits,
  networkPolicy: NetworkPolicy
): Promise<ExecutionResult> {
  const interceptor = new NetworkInterceptor(networkPolicy);

  const workerCode = `
    // Override global fetch with sandboxed version
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ${interceptor.createSandboxedFetch.toString()};

    // Block other network APIs
    globalThis.XMLHttpRequest = undefined;
    globalThis.WebSocket = undefined;

    // Execute handler with restricted network
    ${handlerCode}
  `;

  // ... worker execution
}
```

**Trust-Based Network Policies:**

| Trust Tier | Network Policy |
|------------|----------------|
| T0-T1 | No network access |
| T2 | Allowlist only, 5 connections, 100KB/s |
| T3 | Allowlist only, 20 connections, 1MB/s |
| T4 | Open with logging, 50 connections |
| T5+ | Open with logging, no limits |

---

### Q3: SDK Design for Third-Party Developers?

**Design Principles:**
1. **One import** - Single entry point
2. **Sensible defaults** - Works out of the box
3. **Progressive disclosure** - Simple things simple, complex things possible
4. **Type-safe** - Full TypeScript support
5. **Async-first** - All operations return Promises

```typescript
/**
 * @vorion/sdk - The Developer Experience
 */

// ============================================================
// LEVEL 1: Dead Simple (90% of use cases)
// ============================================================

import { Vorion } from '@vorion/sdk';

const vorion = Vorion.fromEnv();  // Reads VORION_API_KEY

// Register an agent in one line
const agent = await vorion.register('my-agent');

// Check if action is allowed
const can = await vorion.can(agent, 'delete', 'users/123');

if (can.allowed) {
  await deleteUser(123);
  await vorion.success(agent);  // Record success
} else {
  console.log(can.reason);
}

// ============================================================
// LEVEL 2: More Control (Power users)
// ============================================================

import { Vorion, TrustTier } from '@vorion/sdk';

const vorion = Vorion.create({
  apiKey: process.env.VORION_API_KEY,
  environment: 'production',
  onDecision: (decision) => console.log('Decision:', decision),
});

// Register with specific capabilities
const agent = await vorion.agents.register({
  name: 'data-processor',
  capabilities: ['read:data', 'write:reports'],
  observationTier: 'WHITE_BOX',  // We're open source
});

// Full intent submission
const result = await vorion.intents.submit({
  agent,
  action: 'generate_report',
  resource: 'analytics/*',
  context: {
    reportType: 'monthly',
    format: 'pdf',
  },
});

// Handle three-tier response
switch (result.tier) {
  case 'GREEN':
    await executeReport(result.constraints);
    break;
  case 'YELLOW':
    // Show refinement options to user
    const choice = await askUser(result.refinements);
    const refined = await vorion.intents.refine(result.id, choice);
    break;
  case 'RED':
    throw new AccessDeniedError(result.reason);
}

// ============================================================
// LEVEL 3: Framework Integrations
// ============================================================

// Express middleware
import { vorionMiddleware } from '@vorion/sdk/express';

app.use(vorionMiddleware({
  apiKey: process.env.VORION_API_KEY,
  getAgentId: (req) => req.headers['x-agent-id'],
}));

app.post('/api/dangerous', (req, res) => {
  // req.vorion.decision is already populated
  if (!req.vorion.decision.allowed) {
    return res.status(403).json({ error: req.vorion.decision.reason });
  }
  // Proceed...
});

// LangChain integration
import { VorionCallbackHandler } from '@vorion/sdk/langchain';

const llm = new ChatOpenAI({
  callbacks: [new VorionCallbackHandler({ agentId: 'my-agent' })],
});

// React hooks
import { useVorion, useAgentTrust } from '@vorion/sdk/react';

function AgentStatus({ agentId }) {
  const { trust, loading } = useAgentTrust(agentId);

  return (
    <div>
      Trust: T{trust.tier} ({trust.score}/1000)
    </div>
  );
}

// ============================================================
// LEVEL 4: Self-Hosting (Enterprise)
// ============================================================

import { VorionServer } from '@vorion/sdk/server';

const server = new VorionServer({
  port: 3000,
  database: process.env.DATABASE_URL,
  proofStorage: 's3://my-bucket/proofs',
  blockchain: {
    network: 'polygon',
    rpc: process.env.POLYGON_RPC,
  },
});

await server.start();
```

**Package Structure:**

```
@vorion/sdk/
├── index.ts          # Main export: Vorion
├── client.ts         # VorionClient class
├── types.ts          # Public types
│
├── express/          # Express middleware
├── fastify/          # Fastify plugin
├── langchain/        # LangChain callbacks
├── react/            # React hooks
├── vue/              # Vue composables
│
├── server/           # Self-hosted server
└── testing/          # Test utilities
```

---

### Q4: GDPR Deletion with Append-Only Proof?

**The Paradox:**
- Proof plane MUST be append-only (integrity)
- GDPR requires deletion (compliance)

**Solution: Crypto-Shredding + Tombstones**

```typescript
/**
 * GDPR-Compliant Append-Only Proof
 *
 * Strategy:
 * 1. All PII is encrypted with per-entity keys
 * 2. Deletion = destroy the key (crypto-shredding)
 * 3. Append tombstone event (proof of deletion)
 * 4. Data remains but is unreadable
 */

interface EncryptedProofEvent {
  id: string;
  entityId: string;          // The agent/user ID
  encryptedPayload: string;  // AES-256-GCM encrypted
  keyId: string;             // Reference to encryption key
  hash: string;              // Hash of plaintext (for integrity)
  timestamp: Date;
}

class GDPRCompliantProofStore {
  private keyStore: KeyStore;  // Secure key storage
  private proofStore: ProofStore;

  /**
   * Record event with entity-specific encryption
   */
  async recordEvent(event: ProofEvent): Promise<string> {
    // Get or create encryption key for this entity
    const keyId = await this.keyStore.getOrCreate(event.entityId);
    const key = await this.keyStore.getKey(keyId);

    // Encrypt PII fields
    const encryptedPayload = await this.encrypt(event.payload, key);

    // Hash plaintext for integrity verification
    const hash = this.hash(event.payload);

    // Store encrypted event (append-only)
    const proofEvent: EncryptedProofEvent = {
      id: crypto.randomUUID(),
      entityId: event.entityId,
      encryptedPayload,
      keyId,
      hash,
      timestamp: new Date(),
    };

    await this.proofStore.append(proofEvent);
    return proofEvent.id;
  }

  /**
   * GDPR Article 17: Right to Erasure
   *
   * Instead of deleting events:
   * 1. Destroy the encryption key
   * 2. Append tombstone event
   * 3. Data is now unreadable (crypto-shredded)
   */
  async deleteEntity(entityId: string, request: DeletionRequest): Promise<DeletionProof> {
    // 1. Verify authorization
    if (!await this.verifyDeletionAuth(request)) {
      throw new UnauthorizedError('Invalid deletion request');
    }

    // 2. Get all key IDs for this entity
    const keyIds = await this.keyStore.getKeyIds(entityId);

    // 3. Destroy all keys (crypto-shredding)
    for (const keyId of keyIds) {
      await this.keyStore.destroyKey(keyId);
    }

    // 4. Append tombstone event (proves deletion happened)
    const tombstone: TombstoneEvent = {
      type: 'GDPR_DELETION',
      entityId,
      deletedAt: new Date(),
      requestId: request.id,
      keyIdsDestroyed: keyIds,
      retentionNote: 'Encryption keys destroyed. Data crypto-shredded.',
    };

    const tombstoneId = await this.proofStore.append(tombstone);

    // 5. Return proof of deletion
    return {
      entityId,
      tombstoneId,
      deletedAt: tombstone.deletedAt,
      eventsAffected: await this.countEvents(entityId),
      verifiable: true,  // Auditor can verify key destruction
    };
  }

  /**
   * Read event - only works if key exists
   */
  async readEvent(eventId: string): Promise<ProofEvent | null> {
    const encrypted = await this.proofStore.get(eventId);
    if (!encrypted) return null;

    // Try to decrypt
    try {
      const key = await this.keyStore.getKey(encrypted.keyId);
      const payload = await this.decrypt(encrypted.encryptedPayload, key);
      return { ...encrypted, payload };
    } catch (e) {
      if (e instanceof KeyNotFoundError) {
        // Key was destroyed - data is shredded
        return {
          ...encrypted,
          payload: null,
          shredded: true,
          shreddedReason: 'GDPR deletion',
        };
      }
      throw e;
    }
  }
}
```

**Chain Integrity After Deletion:**

```
Before deletion:
  Event1 (hash: abc) → Event2 (hash: def) → Event3 (hash: ghi)

After GDPR deletion of Event2's entity:
  Event1 (hash: abc) → Event2 (hash: def, ENCRYPTED-UNREADABLE) → Event3 (hash: ghi) → Tombstone

Chain integrity preserved:
- All hashes still link correctly
- Merkle proofs still work
- Tombstone proves deletion happened
- Auditor can verify process
```

**Compliance Summary:**

| GDPR Right | How We Handle It |
|------------|------------------|
| Right to Access | Decrypt events with entity's key |
| Right to Erasure | Crypto-shred by destroying key |
| Right to Portability | Export decrypted events |
| Right to Rectification | Append correction event |
| Proof of Compliance | Tombstone + key destruction audit log |

---

## Package & API Architecture (CANONICAL)

### Layer Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LAYER ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 5: APPLICATIONS (aurais.net)                                         │
│  ─────────────────────────────────────                                      │
│  │ aurais        │ aurais-pro     │ aurais-exec    │ b2b-dashboard │       │
│  └───────────────┴────────────────┴────────────────┴───────────────┘       │
│                              │                                              │
│                              ▼                                              │
│  LAYER 4: API GATEWAY (cognigate.dev/api)                                   │
│  ─────────────────────────────────────────                                  │
│  │ REST API      │ GraphQL        │ WebSocket      │ Webhooks      │       │
│  │ /v1/*         │ /graphql       │ /ws            │ /hooks        │       │
│  └───────────────┴────────────────┴────────────────┴───────────────┘       │
│                              │                                              │
│                              ▼                                              │
│  LAYER 3: RUNTIME (@vorion/runtime)                                         │
│  ───────────────────────────────────                                        │
│  │ IntentPipeline │ TrustFacade   │ ProofCommitter │ Cognigate     │       │
│  └────────────────┴───────────────┴────────────────┴───────────────┘       │
│                              │                                              │
│                              ▼                                              │
│  LAYER 2: CORE ENGINES                                                      │
│  ─────────────────────────                                                  │
│  │ @vorion/basis  │ @vorion/atsf  │ @vorion/proof  │ @vorion/a3i   │       │
│  │ Gate Trust     │ Dynamic Trust │ Evidence       │ Dynamics      │       │
│  └────────────────┴───────────────┴────────────────┴───────────────┘       │
│                              │                                              │
│                              ▼                                              │
│  LAYER 1: CONTRACTS (@vorion/contracts)                                     │
│  ───────────────────────────────────────                                    │
│  │ Types          │ Interfaces    │ Schemas        │ Constants     │       │
│  └────────────────┴───────────────┴────────────────┴───────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### npm Package Registry (@vorion scope)

| Package | npm Name | Purpose | Public? |
|---------|----------|---------|---------|
| contracts | `@vorion/contracts` | Shared types, interfaces, schemas | ✅ Yes |
| basis | `@vorion/basis` | Gate Trust - identity, credentials, admission | ✅ Yes |
| atsf-core | `@vorion/atsf` | Dynamic Trust - scoring, decay, signals | ✅ Yes |
| proof-plane | `@vorion/proof` | Evidence - hashing, signing, chains | ✅ Yes |
| a3i | `@vorion/a3i` | Trust dynamics (merging into atsf) | ⚠️ Internal |
| runtime | `@vorion/runtime` | Orchestration - pipeline, facade | ✅ Yes |
| sdk | `@vorion/sdk` | Developer SDK - simple interface | ✅ Yes |
| cognigate | `@vorion/cognigate` | Execution sandbox | ✅ Yes |

### Developer Access Tiers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPER ACCESS MODEL                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TIER 1: SDK USER (Most developers)                                         │
│  ───────────────────────────────────                                        │
│  npm install @vorion/sdk                                                    │
│                                                                             │
│  • Single import, simple API                                                │
│  • Talks to cognigate.dev API                                               │
│  • No need to understand internals                                          │
│  • Docs: cognigate.dev/docs/quickstart                                      │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TIER 2: FRAMEWORK INTEGRATOR (Platform builders)                           │
│  ─────────────────────────────────────────────────                          │
│  npm install @vorion/runtime @vorion/contracts                              │
│                                                                             │
│  • Access to pipeline & facade                                              │
│  • Can customize trust logic                                                │
│  • Self-host option                                                         │
│  • Docs: cognigate.dev/docs/self-host                                       │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TIER 3: ENGINE CONTRIBUTOR (Core contributors)                             │
│  ─────────────────────────────────────────────────                          │
│  npm install @vorion/basis @vorion/atsf @vorion/proof                       │
│                                                                             │
│  • Direct access to trust engines                                           │
│  • Build custom governance models                                           │
│  • Requires deep understanding                                              │
│  • Docs: basis.vorion.org                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints (cognigate.dev)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/v1/agents` | POST | Register agent | API Key |
| `/v1/agents/:id` | GET | Get agent details | API Key |
| `/v1/agents/:id/trust` | GET | Get trust score | API Key |
| `/v1/intents` | POST | Submit intent | API Key |
| `/v1/intents/:id` | GET | Get intent status | API Key |
| `/v1/intents/:id/refine` | POST | Refine YELLOW intent | API Key |
| `/v1/decisions/:id` | GET | Get decision details | API Key |
| `/v1/proofs/:id` | GET | Get proof record | API Key |
| `/v1/proofs/:id/verify` | GET | Verify proof integrity | Public |
| `/v1/certify/:id` | GET | Check certification | Public |

### Repository Structure

```
vorion/
├── packages/                    # INTERNAL MONOREPO
│   ├── contracts/               # @vorion/contracts
│   ├── basis/                   # @vorion/basis
│   ├── atsf-core/               # @vorion/atsf
│   ├── proof-plane/             # @vorion/proof
│   ├── a3i/                     # @vorion/a3i (internal, merging)
│   ├── runtime/                 # @vorion/runtime
│   ├── sdk/                     # @vorion/sdk
│   └── cognigate/               # @vorion/cognigate
│
├── apps/
│   ├── aurais/                  # aurais.net - Consumer
│   ├── aurais-pro/              # aurais.net/pro - Professional
│   ├── aurais-exec/             # aurais.net/exec - Enterprise
│   ├── cognigate-api/           # cognigate.dev/api - Developer API
│   ├── agentanchor-portal/      # agentanchorai.com - Certification portal
│   └── vorion-web/              # vorion.org - Corporate site
│
├── sites/
│   ├── basis-docs/              # basis.vorion.org
│   ├── learn-portal/            # learn.vorion.org
│   └── cognigate-docs/          # cognigate.dev/docs
│
└── specs/
    ├── trust-factors-v2.md      # Trust specification
    ├── proof-plane-spec.md      # Proof specification
    └── api-spec.yaml            # OpenAPI specification
```

### Website ↔ Package ↔ API Mapping

```
┌────────────────────┬─────────────────────┬──────────────────────────────────┐
│ Website            │ Packages Used       │ API Endpoints                    │
├────────────────────┼─────────────────────┼──────────────────────────────────┤
│ aurais.net         │ @vorion/sdk         │ cognigate.dev/v1/*              │
│ agentanchorai.com  │ @vorion/proof       │ cognigate.dev/v1/certify/*      │
│ cognigate.dev      │ ALL (docs)          │ Self (meta)                     │
│ basis.vorion.org   │ @vorion/basis (docs)│ None                            │
│ learn.vorion.org   │ @vorion/sdk (demos) │ cognigate.dev/v1/* (sandbox)    │
│ vorion.org         │ None                │ None                            │
└────────────────────┴─────────────────────┴──────────────────────────────────┘
```

---

## Next Steps

1. **Create this as the canonical reference** - All other docs point here
2. **Implement async proof** - Priority for latency
3. **Unify trust with facade** - Use the pattern above
4. **Build SDK** - Following the design above
5. **Add network isolation** - Cognigate enhancement
6. **Publish npm packages** - @vorion scope on npmjs.com
7. **Deploy cognigate.dev** - Developer portal priority

---

*This document covers business domains, products, HITL certification, and conceptual architecture. For trust tier definitions, see ADR-002. For operational details, see PLATFORM-ARCHITECTURE.md.*
