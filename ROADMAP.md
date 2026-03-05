# Vorion Public Roadmap

> **Status**: Active Development â€” BASIS v1.0 spec stabilization
> Last updated: March 2026

---

## What is Vorion?

Vorion is building **BASIS** â€” an open standard and runtime for AI agent governance. BASIS defines how autonomous agents must be controlled, monitored, and audited before taking action in enterprise environments.

---

## Now (Q1 2026)

### BASIS v1.0 Specification
- [x] Four-layer governance stack (INTENT -> ENFORCE -> PROOF -> CHAIN)
- [x] 8-tier trust model (T0 Sandbox -> T7 Autonomous, scores 0-1000)
- [x] Tier-scaled failure multipliers (2x at T0, up to 10x at T5-T7)
- [x] Proof record schema with cryptographic integrity
- [x] Wire protocol (JSON) for agent action requests and governance decisions
- [ ] Conformance test suite (draft)

### Cognigate (Reference Implementation)
- [x] Trust scoring API with tier-aware signal processing
- [x] ALLOW / DENY / ESCALATE / DEGRADE decision engine
- [x] Trust decay over time
- [ ] Bulk signal ingestion endpoint
- [ ] gRPC transport support

### BASIS SDK (@vorionsys/sdk)
- [x] Agent action request builder
- [x] Trust score polling
- [ ] Streaming governance events
- [ ] OpenAI/Anthropic middleware adapters

---

## Next (Q2 2026)

### CHAIN Layer (Proof Anchoring)
- [ ] Pluggable ledger connectors (Ethereum, Hyperledger, PostgreSQL append-only)
- [ ] Merkle proof generation for audit batches
- [ ] Proof verification CLI (car verify)

### AgentAnchor
- [ ] Agent identity and credential standard
- [ ] Cross-org agent trust federation
- [ ] AgentAnchor SDK public release

### Developer Experience
- [ ] npx create-basis-app scaffold
- [ ] Docker Compose one-liner local stack
- [ ] Postman collection for Cognigate API
- [ ] Interactive demo at vorion.org/demo

---

## Later (Q3-Q4 2026)

### BASIS Extended Conformance
- [ ] Multi-tenant isolation
- [ ] Federated trust across organizations
- [ ] Capability taxonomy v2 (hierarchical, versioned)

### Platform
- [ ] Managed Cognigate (hosted trust scoring)
- [ ] Dashboard for trust score history and audit trails
- [ ] SIEM integrations (Splunk, Datadog)

### Standards
- [ ] BASIS submission to relevant standards body
- [ ] Published conformance test suite
- [ ] Third-party audited reference implementation

---

## Shipped

| Version | Highlight |
|---------|-----------|
| 0.9.0 | Initial BASIS spec + Cognigate alpha |
| 0.9.5 | 8-tier T0-T7 trust model + tier-scaled penalties |
| 0.9.6 | Public spec page at vorion.org/basis/spec |

---

## Get Involved

- **Spec discussion**: https://github.com/vorionsys/vorion/discussions
- **Issues**: https://github.com/vorionsys/vorion/issues
- **Docs**: https://www.vorion.org/basis
- **License**: Apache-2.0