# AI Agent Security in Healthcare
## Sector One-Pager for NIST CAISI Listening Session — March 20, 2026

**Submitted by:** Vorion (vorion.org · contact@vorion.org)
**Session:** Healthcare Sector Breakout
**Related docket:** NIST-2025-0035 (RFI response submitted March 9, 2026)

---

## The Healthcare Sector's Distinct Challenge

AI agents in healthcare act in an environment where errors cause irreversible patient harm. Three properties make governance requirements uniquely demanding:

1. **Life safety primacy** — Trust tier requirements cannot be negotiated around performance tradeoffs. An agent that is correct 99.9% of the time is not acceptable for clinical decision support when the 0.1% is a medication error.
2. **PHI everywhere** — Every agent interaction with a patient record is a potential HIPAA disclosure event. Agents must operate under the same minimum-necessary and access controls as human users — with automated audit trails that satisfy OCR investigation requirements.
3. **Regulatory overlap** — FDA Software as a Medical Device (SaMD) guidance, HIPAA Security Rule, ONC Interoperability, DEA for prescription authority, and state medical practice acts all apply simultaneously, with no unified framework for how AI agents interact with any of them.

---

## Current Practice Gaps

| Gap | Risk | Example |
|-----|------|---------|
| No minimum trust tier for clinical recommendations | Patient safety | Newly deployed agent with no usage history makes drug dosing suggestions |
| HIPAA audit logs not agent-specific | Attribution failure | Multi-user EHR access logs cannot isolate which agent accessed a record |
| No agent identity in FDA SaMD submissions | Regulatory gap | De novo classification requires describing "intended user"; agents are not users |
| Behavioral drift unmonitored | Clinical safety | Agent recommendations shift over months due to model updates; no detection |
| Multi-agent care coordination lacks trust hierarchy | Inconsistent care | Scheduling agent instructs clinical agent; no authority hierarchy enforced |

---

## Vorion's Approach Applied to Healthcare

### FDA SaMD Intended Use → Capability Manifest

FDA's SaMD framework requires specifying the intended use, healthcare situation, and significance of information provided. The BASIS capability manifest maps directly:

```json
{
  "agentId": "clinical-decision-support-v2",
  "intendedUse": "medication-interaction-screening",
  "tier": "T5-Trusted",
  "allowedTools": ["ehr_read", "drug_db_query"],
  "forbiddenTools": ["ehr_write", "order_entry"],
  "humanReviewRequired": ["critical_interaction", "dosing_recommendation"],
  "dataClasses": ["PHI_minimum_necessary"]
}
```

This manifest travels with every proof record, creating an FDA-auditable trail linking capability declarations to actual agent behavior.

### HIPAA Minimum Necessary → Trust-Gated Data Access

The HIPAA minimum necessary standard requires limiting PHI access to what is needed for the specific task. The A3I governance layer enforces this at decision time:
- Every agent action carries explicit data scope (`dataClasses` field)
- Data classification tags propagate through multi-agent chains — an agent that reads full-record PHI cannot pass it to a lower-trust downstream agent
- All PHI access creates proof records pseudonymized by agent DID (not employee/patient name), enabling audit without secondary disclosure

### IQ/OQ/PQ Process Validation → Trust Tier Lifecycle

FDA's Installation/Operational/Performance Qualification framework maps directly to the trust tier lifecycle:

| Qualification Phase | BASIS Analog | Entry Criteria |
|--------------------|--------------|----------------|
| IQ (Installation) | T0 Sandbox | Deployment validation, no real-patient data |
| OQ (Operational) | T1–T2 Observed/Provisional | Correct behavior in controlled conditions |
| PQ (Performance) | T3–T4 Monitored/Standard | Sustained correct behavior in production |
| Ongoing Performance | T5–T7 Trusted–Autonomous | Continuous monitoring with trust score maintenance |

**Key recommendation for NIST:** FDA SaMD guidance should recognize trust tier certifications as a structured evidence pathway for OQ and PQ qualification.

### Clinical Kill Switch → L7 Containment

Clinical environments require agent stop mechanisms that non-technical staff can activate. BASIS L7 containment:
- Must be available via a physically separate control plane (cannot reach through the agent's normal API path)
- Must stop ALL agent operations, including those in-flight
- Must log the halt event with timestamp and initiator identity for Joint Commission review
- Should provide degraded mode (L5 Simulation Only) for continued monitoring without patient-affecting actions

---

## Priority NIST Guidance Requests

1. **Minimum trust tier for clinical use cases** — NIST guidance establishing minimum trust tier requirements for different healthcare contexts (e.g., T3+ for administrative agents, T5+ for clinical decision support, T6+ for autonomous treatment recommendations) would provide a vendor-neutral baseline that FDA, CMS, and ONC could reference.

2. **Agent identity in HIPAA covered entity context** — HHS/OCR guidance on how AI agent identity relates to "workforce member" definitions under the HIPAA Security Rule is urgently needed. Current implementations treat agents as system users, creating accountability gaps in breach investigations.

3. **PHI in proof chains** — Guidance on whether cryptographic proof chains satisfy HIPAA audit log requirements (§ 164.312(b)) would eliminate costly duplicate logging systems that organizations currently maintain for HIPAA compliance alongside their agent audit infrastructure.

4. **FDA SaMD pathway for trusted agents** — A NIST-endorsed trust score format that FDA could reference in SaMD guidance would create a pathway from current rigid IQ/OQ/PQ to continuous behavioral validation — more appropriate for AI systems that can change over time.

---

## Concrete Next Steps

Vorion offers the following resources for NIST evaluation:
- Full reference implementation (Apache-2.0): [github.com/vorionsys/vorion](https://github.com/vorionsys/vorion)
- HIPAA control mapping (available on request)
- FedRAMP-aligned compliance tests (cognigate: 35 FedRAMP controls verified)
- NIST SP 800-53 AU control family test suite: proof chain audit requirements implemented as executable tests
- Live demo of clinical agent governance at basis.vorion.org

We welcome collaboration with NIST, HHS, FDA, and healthcare sector working groups on agent identity and PHI handling standards.

---

*Vorion · vorion.org · contact@vorion.org*
*March 2026*
