# Join the Vorion Project: Build Mission Control for Autonomous AI

## The Problem We're Solving

The AI industry has a governance problem that's about to become a crisis.

Organizations deploying autonomous AI agents face an impossible choice:
- **Option A**: Require human approval for everything → Expensive, slow, defeats the purpose of autonomy
- **Option B**: Monitor reactively → Doesn't prevent failures, just documents them after damage is done

Neither option scales. Neither option satisfies regulators. Neither option works.

**We're building Option C.**

---

## What is Vorion?

Vorion is **Mission Control for AI agents** — the command center that certifies, monitors, and governs autonomous agents across every environment.

Think of it like NASA's Mission Control, but for AI:
- New agents start in the **simulation environment**, proving competence before live missions
- As they demonstrate safe behavior, they earn higher **clearance levels** automatically
- Every governance decision is recorded in an immutable **flight recorder** with cryptographic proof
- Compliance is built-in, not bolted-on

The result: **1-3% system overhead targeting 15-40% total operational savings** by preventing failures before they happen.

---

## Why This Matters Now

- **EU AI Act** enforcement begins 2026 — high-risk AI systems need governance
- **ISO 42001** (AI Management System) is becoming the enterprise requirement
- **Agentic AI** is moving from demos to production deployments
- **Zero existing standards** for how autonomous agents should be trusted and governed

We're not just building software. We're publishing the **Credentialed Agent Registry (CAR)** — the mission certification standard for AI agents — to OpenID Foundation, W3C, and OWASP by Q2 2026.

---

## The Technical Challenge

This isn't another CRUD app. Vorion solves genuinely hard problems:

### Cryptographic Trust Chains
Build immutable evidence chains using Ed25519 signatures, Merkle tree aggregation, and optional zero-knowledge proofs. Every agent decision must be verifiable without revealing sensitive details.

### Sub-Millisecond Policy Enforcement
Evaluate complex trust policies in <1ms P99 latency while handling 100K+ concurrent agents. The kernel must be the single source of truth for capability enforcement.

### Clearance Authority (Progressive Trust)
Implement a 0-1000 clearance scoring system with 8 clearance tiers (T0-T7), 182-day decay half-life, and Return to Flight recovery. Clearance must be portable across deployments.

### Multi-Tenant Isolation
Ensure context policies are immutable at instantiation for audit clarity while supporting complex multi-tenant hierarchies.

### Standards Compliance
Map our trust model to EU AI Act requirements, ISO 42001 controls, NIST AI RMF, and SOC 2 Type II — making compliance automatic, not manual.

---

## Tech Stack

If you enjoy working with modern, well-architected TypeScript, you'll feel at home:

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+, TypeScript (strict mode) |
| Web Framework | Fastify |
| Database | PostgreSQL + Drizzle ORM |
| Message Queue | Redis + BullMQ |
| Cryptography | Ed25519, ECDSA, Merkle Trees, Groth16/Circom |
| Blockchain | Polygon (external proof anchoring) |
| Observability | OpenTelemetry, Pino, Prometheus |
| Testing | Vitest (targeting 200+ unit tests) |
| Architecture | Monorepo with npm workspaces |

---

## What You'd Work On

### Core Infrastructure

**Clearance Authority (Trust Engine)** — The 16-factor scoring system that computes agent clearance levels from real-time telemetry.

**Flight Recorder (Proof Plane)** — The immutable audit trail that creates Decision Provenance Objects with cryptographic signatures.

**Mission Gateway (Cognigate)** — The checkpoint agents pass through for every operation, enforcing clearance and mission rules.

**Mission Enforcement (Policy Engine)** — Real-time application of mission rules during agent operations.

### Integration & Standards

**Mission Standards (BASIS)** — The open governance specification with 100+ defined capabilities and compliance mappings.

**AI Gateway** — Multi-provider routing that works with OpenAI, Anthropic, Google, and local models.

**Agent SDK** — The TypeScript SDK that developers use to build governed agents.

### Products

**TrustBot** — B2C reference implementation demonstrating progressive clearance unlocking.

**AgentAnchor** — B2B mission certification portal with agent registry, compliance tools, and telemetry dashboard.

---

## Current State

This isn't a whiteboard project. Vorion has:

- ✅ **5 phases complete** with working implementations
- ✅ **Phase 6 architecture finalized** (January 2026)
- ✅ **Clean, well-documented codebase** (recent 165MB cleanup, 37% reduction)
- ✅ **Deployed systems** handling real agent workloads
- ✅ **Clear 8-week implementation roadmap** for Phase 6

We're past the "is this possible" stage and into the "let's build it right" stage.

---

## What We're Looking For

### Distributed Systems Engineers
Design and implement the trust kernel, proof chain aggregation, and multi-tenant isolation. Experience with event-driven architectures, consensus mechanisms, or blockchain systems is valuable.

### Security & Cryptography Engineers
Build the cryptographic evidence system, zero-knowledge proof integration, and secure key management. Experience with Ed25519, Merkle trees, or ZK circuits (Circom/Groth16) is ideal.

### Standards & Governance Engineers
Help map technical implementations to regulatory requirements. Experience with ISO standards, SOC 2, or regulatory compliance frameworks is useful.

### TypeScript/Node.js Engineers
Build the core packages, SDK, and API layer. Strong TypeScript skills and experience with Fastify, Drizzle, or BullMQ are helpful.

---

## Why Join

### Impact
You're not optimizing ad clicks. You're building infrastructure that determines whether autonomous AI systems can be trusted in high-stakes environments — healthcare, finance, critical infrastructure.

### Open Standards
We're publishing CAR as an open specification. Your work becomes part of the industry standard, not locked in a proprietary system.

### Technical Depth
This is systems programming for AI governance. Cryptographic proofs, distributed trust, sub-millisecond enforcement, behavioral modeling — real engineering challenges.

### Early Stage
We're past proof-of-concept but before market saturation. Contributions now shape the architecture that scales.

### Clean Codebase
Modern TypeScript, comprehensive documentation, clear architectural decisions, and active development. No legacy spaghetti.

---

## How to Get Started

1. **Explore the codebase**: Start with `/docs/` for architecture and specifications
2. **Read the Phase 6 design**: `/docs/phase-6/` contains the current implementation plan
3. **Check the packages**: `/packages/` has the core modules with clear boundaries
4. **Run the tests**: `npm test` to see current coverage
5. **Pick an issue**: Look for `good-first-issue` labels or dive into Phase 6 tasks

---

## The Vision

By Q4 2026, Vorion aims to be:
- The **published standard** for AI agent mission certification (CAR)
- Deployed as **Mission Control in 5+ enterprise environments**
- The default answer to "who governs your autonomous AI?"

We're building **Mission Control for the autonomous AI era** — the infrastructure that ensures agents can operate safely at maximum capability.

---

## Ready to Build?

The hardest problems in AI aren't about making models smarter. They're about making them *trustworthy*.

If that challenge interests you, we should talk.

---

*Vorion: Mission Control for Autonomous AI*

*Apache 2.0 Licensed | Open Standard | In Active Development*
