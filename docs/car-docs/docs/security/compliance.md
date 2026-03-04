---
sidebar_position: 2
title: Compliance
---

# Compliance Mapping

CAR is designed to align with major AI governance and security frameworks.

## EU AI Act

| Requirement | CAR Control |
|-------------|------------|
| Risk classification | Trust tiers (T0–T7) map to risk levels |
| Human oversight | Capability levels (L0–L2 require human approval) |
| Transparency | AI Nutrition Labels, petnames, trust indicators |
| Technical documentation | Attestation chain, audit trails |
| Data governance | Domain restrictions, output schema binding |
| Max autonomy ceiling | Regulatory ceiling enforcement (T4 max) |

## NIST AI Risk Management Framework

| Function | CAR Mapping |
|----------|------------|
| **Govern** | Governance domain (G), policy engine integration |
| **Map** | Domain taxonomy, capability level classification |
| **Measure** | Trust scoring (0–1000), behavioral metrics |
| **Manage** | Runtime tier adjustments, revocation SLAs |

## ISO 42001 (AI Management System)

| Clause | CAR Implementation |
|--------|-------------------|
| Leadership & planning | Organizational context hierarchy |
| Support & resources | Agent registration, attestation |
| Operation | Trust engine, ceiling enforcement |
| Performance evaluation | Behavioral monitoring, drift detection |
| Improvement | Provenance tracking, tier transitions |

## OWASP Top 10 for Agentic Applications

| Risk | CAR Mitigation |
|------|---------------|
| **Prompt Injection** | Domain boundaries + instruction integrity |
| **Insecure Output** | Output schema binding, level-gated execution |
| **Training Data Poisoning** | Attestation chain verification |
| **Model DoS** | Trust-tier rate limits |
| **Supply Chain** | Extension verification, TEE attestation |
| **Sensitive Info Disclosure** | Domain restrictions, prohibited patterns |
| **Insecure Plugin Design** | Scope reduction enforcement |
| **Excessive Agency** | Level-appropriate approval workflows |
| **Overreliance** | Trust tier UI indicators |
| **Model Theft** | DID-based identity, TEE binding |

## SOC 2 Type II

| Trust Service Criteria | CAR Control |
|----------------------|------------|
| Security | DPoP tokens, TEE binding, pairwise DIDs |
| Availability | Revocation SLAs, failover |
| Processing Integrity | Behavioral monitoring, drift detection |
| Confidentiality | Domain restrictions, output binding |
| Privacy | Pairwise DIDs, context authentication |

## HIPAA (Healthcare)

For agents operating in healthcare domains (Domain H):

| Requirement | CAR Control |
|------------|------------|
| Access controls | Domain H + minimum T3 tier |
| Audit trails | Full action history with Cognigate |
| PHI handling | Output schema binding + prohibited patterns |
| Breach notification | Revocation + webhook alerts |
| BAA requirements | Attestation with HIPAA extension (`#hipaa`) |

## Implementation Checklist

### Phase 1: Foundation (Weeks 1–4)
- [ ] Implement CAR string parsing and validation
- [ ] Set up agent registration with ANS
- [ ] Configure DPoP token issuance
- [ ] Deploy basic trust scoring

### Phase 2: Certification (Weeks 5–8)
- [ ] Establish certification authority
- [ ] Implement attestation lifecycle
- [ ] Configure regulatory ceiling enforcement
- [ ] Enable behavioral monitoring

### Phase 3: Governance (Weeks 9–12)
- [ ] Deploy Cognigate policy engine
- [ ] Implement semantic governance controls
- [ ] Configure audit trail retention
- [ ] Enable extension protocol

### Phase 4: Production (Weeks 13–16)
- [ ] Achieve SH-2 security level minimum
- [ ] Complete compliance mapping documentation
- [ ] Conduct third-party security audit
- [ ] Enable full revocation SLA enforcement
