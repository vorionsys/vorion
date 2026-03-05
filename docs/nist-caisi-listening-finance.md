# AI Agent Security in Financial Services
## Sector One-Pager for NIST CAISI Listening Session — March 20, 2026

**Submitted by:** Vorion (vorion.org · contact@vorion.org)
**Session:** Financial Sector Breakout
**Related docket:** NIST-2025-0035 (RFI response submitted March 9, 2026)

---

## The Financial Sector's Distinct Challenge

AI agents in financial services operate in environments where a single autonomous decision can move markets, trigger compliance violations, or execute irreversible transactions. Three properties make this sector uniquely high-stakes:

1. **Irreversibility** — Most financial agent actions (trades, settlements, wire transfers) cannot be undone once executed. Traditional "undo" mechanisms do not apply.
2. **Regulatory density** — Agents must satisfy simultaneous requirements from SEC, FINRA, OCC, FDIC, CFPB, Basel III (capital adequacy), SR 11-7 (model risk), MiFID II, and Dodd-Frank — across a single action decision.
3. **Speed vs. oversight tension** — High-frequency and algorithmic trading environments operate at millisecond scales, where human-in-the-loop review is physically impossible for individual transactions but essential at the policy level.

---

## Current Practice Gaps

| Gap | Risk | Example |
|-----|------|---------|
| No agent identity separate from service accounts | Attribution failure | Rogue trade attributed to shared API key; no responsible agent identified |
| Binary authorization (allowed/not allowed) | Lack of proportionality | Agent with $1M single-trade authorization can attempt $1M trades indefinitely without trust decay |
| Audit trails in application logs, not cryptographic chains | Tamper risk | Log manipulation possible; no integrity proof for regulators |
| No behavioral baseline per agent | Drift undetected | Flash crash pattern emerges over weeks; no alert until market event |
| Multi-agent systems lack trust propagation rules | Cascade risk | One compromised agent instructs others; no trust degradation propagates |

---

## Vorion's Approach Applied to Finance

### SR 11-7 Model Risk Management → Trust Tier Governance

OCC's SR 11-7 requires validation, ongoing monitoring, and documented limitations for models. The BASIS standard's 8-tier trust model (T0 Sandbox → T7 Autonomous) maps directly:

| SR 11-7 Requirement | BASIS/A3I Implementation |
|--------------------|--------------------------|
| Initial validation | T0-T2 probationary period with bounded authority |
| Ongoing performance monitoring | Continuous trust score with 182-day behavioral decay |
| Model limitations documentation | Capability manifest + containment level in proof record |
| Overrides require documentation | Human-in-loop (L4 containment) creates signed override record |
| Escalation for anomalous results | Circuit breaker → degraded mode → halt sequence (L5–L7) |

### SEC/FINRA Audit Requirements → Cryptographic Proof Chains

Regulatory audits require complete, tamper-evident records of automated trading decisions. BASIS proof records use dual-hash (SHA-256 + SHA3-256) with Merkle aggregation, providing:
- Non-repudiation for every agent action
- Immutable chain with tamper detection
- Pseudonymized records (agent DID, not employee name) satisfying GDPR/CCPA
- Cross-firm verification without exposing proprietary models

### Market Disruption Prevention → Progressive Containment

Algorithmic trading kill-switch requirements (FINRA Rule 3110, Regulation SCI) align with L7 containment:
- L1–L4: Normal operation with proportional restrictions
- **L5 Simulation Only**: Agent continues computing decisions but executes nothing — critical for preserving agent state during circuit events
- **L7 Halt**: Complete stop via architecturally isolated kill plane (not reachable through the agent's own control path)

**Key recommendation for NIST:** The kill switch must be on a separate control plane. An agent that can reason about its own kill switch is not safely contained.

---

## Priority NIST Guidance Requests

1. **Agent identity for regulated entities** — Define how AI agent identity relates to SEC "person associated with a broker-dealer" definitions. CAR-ID (Categorical Agentic Registry) provides a technical vehicle; NIST/SEC alignment on what constitutes a registrable agent identity is needed.

2. **Trust score as a model risk metric** — NIST guidance on whether a real-time trust score satisfies SR 11-7 "ongoing monitoring" would accelerate adoption across thousands of regulated entities currently relying on static validation.

3. **Proof record as examination evidence** — Guidance that cryptographic proof chains satisfy SEC examination record requirements would eliminate the current practice of maintaining duplicate audit logs (one cryptographic, one human-readable) for the same events.

4. **Multi-agent trust propagation standard** — Broker-dealer networks and clearing infrastructure involve dozens of interconnected agent systems from different vendors. Interoperable trust propagation rules are needed for cross-firm risk management.

---

## Concrete Next Steps

Vorion offers the following resources for NIST evaluation:
- Full reference implementation (Apache-2.0): [github.com/vorionsys/vorion](https://github.com/vorionsys/vorion)
- NIST SP 800-53 compliance test suite (AC, AU, IR, SC control families): executable, verifiable
- SR 11-7 control mapping (available on request)
- Live demo of financial trading agent governance at basis.vorion.org

We welcome collaboration with NIST, SEC, and financial sector working groups on agent identity and proof record standards.

---

*Vorion · vorion.org · contact@vorion.org*
*March 2026*
