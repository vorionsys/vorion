# Ecosystem Hardening Roadmap

**Version:** 1.0
**Date:** 2026-02-20
**Authors:** Ryan Cason, Alex Blanc
**Status:** Active

---

> **TLDR:** An external audit scored Vorion 69.5/100 on a 2030 Governance Resilience Index.
> This roadmap targets 85+ across 5 phases in 16 weeks. Phase 0 eliminates all fake code, false
> claims, and mock services from production paths. Phases 1–3 build real implementations.
> Phase 4 achieves OpenID4VP/VCI self-certification.

> **Guiding principle:** Every claim must match what an auditor will find in the code.

---

## 1. Current State

### 1.1 GRI Score Breakdown

| Dimension | Current | Target | Primary Gaps |
|-----------|---------|--------|-------------|
| Swarm Containment | ~45 | 80+ | No incident chain, no multi-agent correlation |
| Security Pipeline | ~55 | 85+ | 0/46 concrete layers, 6 fake incident actions |
| Transparency | ~60 | 90+ | Fake team, false "Done" claims, inconsistent messaging |
| Incident Response | ~50 | 85+ | Observer disconnected, mocks everywhere |
| Standards Compliance | ~85 | 90+ | NIST work exists; OpenID4VP/VCI opportunity |

### 1.2 Codebase Inventory

Verified file paths and line counts as of 2026-02-20.

| Component | File | LOC | Status |
|-----------|------|-----|--------|
| SecurityPipeline | `packages/atsf-core/src/layers/index.ts` | 722 | Framework only, 0 concrete layers |
| Trust Engine | `packages/atsf-core/src/trust-engine/` | ~4,269 | **Production-ready** |
| Intent Service | `packages/atsf-core/src/intent/index.ts` | 269 | MOCK ONLY |
| Enforcement Service | `packages/atsf-core/src/enforce/index.ts` | 549 | MOCK ONLY |
| LangChain Integration | `packages/atsf-core/src/langchain/` | 1,209 | **Production-ready** |
| Observer | `apps/agentanchor/lib/observer/` | 923 | Implemented, zero automated triggers |
| Anomaly Service | `apps/agentanchor/lib/observer/anomaly-service.ts` | 458 | Detects 6 types, no automated response |
| Circuit Breaker | `apps/agentanchor/lib/circuit-breaker/` | 2,486 | Partial (pause/resume works) |
| Cascade Halt | `apps/agentanchor/lib/circuit-breaker/cascade-halt.ts` | 438 | Framework only, not connected |
| Global Kill Switch | `apps/agentanchor/lib/circuit-breaker/global-kill-switch.ts` | 397 | Implemented (4 levels, 7 triggers) |
| MIA Protocol | `apps/agentanchor/lib/mia/` + `lib/mia-protocol/` | 2,767 | Trainer-focused, not agent-focused |
| Council | `apps/agentanchor/lib/council/` | 3,223 | Framework, minimal wiring |
| Containment | `packages/atsf-core/src/containment/index.ts` | 889 | Types only, not integrated |

### 1.3 Mock/Fake Code Inventory

Every item below must be eliminated in Phase 0.

| File | What's Fake | Severity |
|------|------------|----------|
| `packages/security/src/security/incident/actions/revoke-credentials.ts` (L76-145) | MockCredentialService — credentials never revoked | Critical |
| `packages/security/src/security/incident/actions/block-ip.ts` (L81-160) | MockIpBlockingService — IPs never blocked | Critical |
| `packages/security/src/security/incident/actions/isolate-system.ts` (L71-100) | MockIsolationService — systems never isolated | Critical |
| `packages/security/src/security/incident/actions/notify-stakeholders.ts` (L80-100) | MockStakeholderNotificationService — no one notified | Critical |
| `packages/security/src/security/incident/actions/scale-monitoring.ts` (L103-120) | MockMonitoringScalingService — monitoring never scaled | Critical |
| `packages/security/src/security/incident/actions/collect-evidence.ts` (L110-237) | MockEvidenceCollectionService — no evidence collected | Critical |
| `packages/security/src/security/tee.ts` | TEE verifiers (SGX, Nitro, SEV) always return `valid: true` | Critical |
| `packages/security/src/security/zkp/snark-utils.ts` (L763-773) | loadCircuitWasm/loadZkey throw errors | High |
| `apps/aurais/src/app/about/page.tsx` (L4-8) | Fake team: Alex Chen, Sarah Williams, Michael Torres, Emily Johnson | High |
| `apps/agentanchor/lib/truth-chain/truth-chain-service.ts` (L26) | Hardcoded `'truth-chain-dev-key'` fallback | Critical |
| `apps/agentanchor/lib/credentials.ts` (L4) | "Stub implementation for build" | High |
| `apps/agentanchor/lib/governance/mcp.ts` (L293-357) | 5 MCP handler stubs | High |
| `packages/atsf-core/src/intent/index.ts` | MockIntentService as default | High |
| `packages/atsf-core/src/enforce/index.ts` | MockEnforcementService as default | High |

### 1.4 False Claims That Must Be Fixed

| Location | Claims | Reality | Action |
|----------|--------|---------|--------|
| `docs/atsf-docs/docs/index.md` | "Production-grade" | 0/46 layers, mock services | "Beta — Trust Engine and LangChain integration production-ready" |
| `docs/atsf-docs/docs/roadmap.md` L57-71 | "46 security layers: Done" | 0 implemented | "Security Layer Framework: Done. Concrete implementations: In Progress" |
| `docs/atsf-docs/docs/roadmap.md` | "CrewAI, AutoGPT: Done" | Not found in code | "LangChain: Done. CrewAI: Planned. AutoGPT: Planned" |
| `apps/aurais/src/app/about/page.tsx` | 4 fake team members | Nobody real | Replace with real founders or remove page |

---

## 2. GRI Score Projection

| Phase | Timeline | Target GRI | Delta | Key Improvements |
|-------|----------|-----------|-------|------------------|
| Baseline | — | 69.5 | — | External audit score |
| Phase 0 | Week 1 | 74.0 | +4.5 | Delete all fakes, fix all false claims |
| Phase 1 | Weeks 2-4 | 79.0 | +5.0 | First 6 real ATSF layers, real intent/enforcement |
| Phase 2 | Weeks 4-8 | 84.0 | +5.0 | Incident response chain wired (proprietary) |
| Phase 3 | Weeks 8-12 | 87.0 | +3.0 | Swarm containment (proprietary) |
| Phase 4 | Weeks 12-16 | 89.0 | +2.0 | OpenID4VP/VCI self-certification |

---

## 3. Phase 0 — Eliminate All Fakes (Week 1)

**Principle:** Delete or honestly error on everything fake. No new features — only deletions, corrections, and honest error paths.

### 3.1 Neutralize Fake Security Services

Six mock incident response services in `packages/security/src/security/incident/actions/` silently pretend to work. For each:

- Remove mock as default — make the real service implementation a required parameter
- Move mock to a `createMockXxxService()` factory export available only for test imports
- Any code path that hits an unconfigured service throws `Error('No [service] backend configured. See docs.')`

| # | File | Mock Class |
|---|------|-----------|
| 1 | `revoke-credentials.ts` | MockCredentialService |
| 2 | `block-ip.ts` | MockIpBlockingService |
| 3 | `isolate-system.ts` | MockIsolationService |
| 4 | `notify-stakeholders.ts` | MockStakeholderNotificationService |
| 5 | `scale-monitoring.ts` | MockMonitoringScalingService |
| 6 | `collect-evidence.ts` | MockEvidenceCollectionService |

### 3.2 Fix TEE Verifier

`packages/security/src/security/tee.ts` — All three TEE verifiers (SGX, Nitro, SEV) unconditionally return `{ valid: true }`. Replace with `{ valid: false, reason: 'no-verifier-configured' }` until real attestation backends are wired.

### 3.3 Fix ZKP Stubs

`packages/security/src/security/zkp/snark-utils.ts` — `loadCircuitWasm()` and `loadZkey()` throw generic errors. Replace with `throw Error('ZKP circuit loading not yet implemented. See docs for planned support.')` to make the status explicit.

### 3.4 Remove Fake Team

`apps/aurais/src/app/about/page.tsx` — Contains 4 fabricated team members (Alex Chen, Sarah Williams, Michael Torres, Emily Johnson). Replace with real founders (Ryan Cason, Alex Blanc) or remove the about page entirely until real content is ready.

### 3.5 Fix Truth Chain Dev Key

`apps/agentanchor/lib/truth-chain/truth-chain-service.ts` — Line 26 falls back to `'truth-chain-dev-key'` when no signing key is configured. Remove fallback; throw on missing `TRUTH_CHAIN_SIGNING_KEY` env var.

### 3.6 Fix Credential and MCP Stubs

- `apps/agentanchor/lib/credentials.ts` — "Stub implementation for build." Delete stub, throw honest error on any call
- `apps/agentanchor/lib/governance/mcp.ts` — Lines 293-357 contain 5 handler stubs. Replace with `throw Error('Not yet implemented')` per handler

### 3.7 Fix Mock Intent/Enforcement Defaults

- `packages/atsf-core/src/intent/index.ts` — `createIntentService()` currently returns a mock by default. Change to throw unless a real backend is passed as argument
- `packages/atsf-core/src/enforce/index.ts` — Same treatment for `createEnforcementService()`

### 3.8 Fix All False Documentation

- `docs/atsf-docs/docs/index.md` — Change "Production-grade" to "Beta"
- `docs/atsf-docs/docs/roadmap.md` — Change all false "Done" claims to actual status
- Remove claims about CrewAI and AutoGPT integrations

---

## 4. Phase 1 — Open Source Hardening (Weeks 2-4)

### 4.1 ATSF Layers L0-L5 (Input Validation Tier)

Each layer extends `BaseSecurityLayer` from `packages/atsf-core/src/layers/index.ts:49`. Each must have real detection logic, unit tests with adversarial inputs, and a defined minimum detection accuracy.

| Layer | Name | Threat Addressed | New File |
|-------|------|-----------------|----------|
| L0 | Request Format Validator | prompt_injection | `packages/atsf-core/src/layers/implementations/L0-request-format.ts` |
| L1 | Input Size Limiter | denial_of_service | `packages/atsf-core/src/layers/implementations/L1-input-size.ts` |
| L2 | Character Set Sanitizer | prompt_injection | `packages/atsf-core/src/layers/implementations/L2-charset-sanitizer.ts` |
| L3 | Schema Conformance | unauthorized_action | `packages/atsf-core/src/layers/implementations/L3-schema-conformance.ts` |
| L4 | Injection Pattern Detector | prompt_injection | `packages/atsf-core/src/layers/implementations/L4-injection-detector.ts` |
| L5 | Rate Limiter | denial_of_service | `packages/atsf-core/src/layers/implementations/L5-rate-limiter.ts` |

Priority: L0 and L4 first (request validation + injection detection = highest impact).

### 4.2 Real Intent and Enforcement Services

- Replace `MockIntentService` with `SupabaseIntentService` backed by real persistence
- Replace `MockEnforcementService` with `PolicyEnforcementService` wired to the Trust Engine
- Keep mock factories available ONLY for test files (never as production defaults)

### 4.3 CrewAI Integration

New directory: `packages/atsf-core/src/crewai/`

Follow the `packages/atsf-core/src/langchain/` pattern (1,209 lines). Provide CrewAI middleware that wraps the ATSF security pipeline around CrewAI agent execution.

### 4.4 CAR Wave 2

- `SupervisionContext` types and validation schemas
- Supervised elevation: +2 levels max, bounded by supervisor's effective level minus 1
- Mandatory heartbeat monitoring for elevation duration
- CARIdentity floating reference cleanup

---

## 5. Phase 2 — Incident Response Chain (Weeks 4-8) [PROPRIETARY]

Wire existing AgentAnchor components into an automated response pipeline:

```
Observer anomaly → Escalation Rules → Circuit Breaker / Containment → Council → Kill Switch
```

| # | Action | Details |
|---|--------|---------|
| 2.1 | Escalation rules engine | New: `apps/agentanchor/lib/observer/escalation-rules.ts` |
| 2.2 | Wire anomaly to escalation | `anomaly-service.ts` emits to escalation rules on detection |
| 2.3 | Circuit breaker ↔ trust decay | `circuit-breaker-service.ts` subscribes to trust engine events |
| 2.4 | Multi-agent correlation | New: `apps/agentanchor/lib/observer/multi-agent-correlator.ts` |
| 2.5 | Agent-focused MIA | Extend `lib/mia-protocol/` for agent heartbeat monitoring |
| 2.6 | Council swarm decisions | Extend `lib/council/` with quorum-based swarm response |
| 2.7 | Integration tests | New: `apps/agentanchor/tests/integration/incident-response-chain.test.ts` |

---

## 6. Phase 3 — Swarm Hardening (Weeks 8-12) [PROPRIETARY]

| # | Action | New File |
|---|--------|----------|
| 3.1 | Agent network topology model | `apps/agentanchor/lib/swarm/topology-service.ts` |
| 3.2 | Contagion spread rate tracking | `apps/agentanchor/lib/swarm/contagion-model.ts` |
| 3.3 | Network segment isolation | `apps/agentanchor/lib/swarm/segment-isolation.ts` |
| 3.4 | Segment-level kill switch | Extend `apps/agentanchor/lib/circuit-breaker/global-kill-switch.ts` |
| 3.5 | Automated containment escalation | `apps/agentanchor/lib/swarm/containment-escalation.ts` |
| 3.6 | Swarm health dashboard | `apps/agentanchor/app/(dashboard)/swarm/page.tsx` |

---

## 7. Phase 4 — OpenID4VP/VCI Self-Certification (Weeks 12-16)

### 7.1 Strategic Context

The OpenID Foundation launched self-certification for OpenID4VP 1.0, OpenID4VCI 1.0, and HAIP 1.0 on February 26, 2026. Vorion's attestation system is approximately 60-70% aligned with these specifications. Self-certification provides industry-standard credibility for agent identity at low implementation cost.

### 7.2 Existing Alignment

| What Exists | Where |
|------------|-------|
| Attestation model maps to W3C Verifiable Credentials | `packages/contracts/src/car/attestation.ts` |
| JWT claims for agent capabilities | `packages/contracts/src/car/jwt-claims.ts` |
| Agent registration parallels credential issuance | `packages/contracts/src/car/identity.ts` |
| OIDC provider with discovery support | `packages/security/src/auth/sso/oidc-provider.ts` |
| Pairwise DID system with HKDF derivation | `packages/security/src/security/pairwise-did.ts` |

### 7.3 Gaps to Close

| Gap | Impact |
|-----|--------|
| No Verifiable Presentation (VP) protocol | Cannot present credentials to verifiers |
| No credential issuance endpoint | Cannot issue credentials in standard format |
| No `/.well-known/openid4vp` metadata | Verifiers cannot discover VP capabilities |
| No `/.well-known/openid-credential-issuer` metadata | Holders cannot discover issuance capabilities |
| Missing credential format descriptors in JWT claims | Non-standard credential format |
| Missing DID resolution for VP verifiers | Cannot resolve agent DIDs during verification |

### 7.4 Implementation Plan

| # | Action | Package |
|---|--------|---------|
| 4.1 | `/.well-known/openid4vp` metadata endpoint | `packages/security` |
| 4.2 | `/.well-known/openid-credential-issuer` metadata endpoint | `packages/security` |
| 4.3 | VP presentation protocol (authorization request/response) | `packages/security` |
| 4.4 | Map CAR attestations to W3C Verifiable Credential format | `packages/contracts` |
| 4.5 | Credential offer and issuance endpoint | `packages/security` |
| 4.6 | Add credential format descriptors to JWT claims | `packages/contracts` |
| 4.7 | Run OpenID Foundation conformance test suite | CI |
| 4.8 | Submit self-certification applications (VP, VCI, HAIP) | External |

### 7.5 Why This Matters

- Being among the first agent identity systems to achieve OpenID4VP/VCI certification positions Vorion as the standard for agentic identity
- HAIP 1.0 (High Assurance Interoperability Profile) certification directly validates the trust/attestation model
- Self-certification is free and process-driven — technical conformance is the only barrier
- OpenID4VCI maps directly to CAR registration: registry = issuer, attestation = credential, agent = holder

---

## 8. Future — 2030 Vision (Q2 2026+)

- **Cognitive Cube:** Temporal Knowledge Graph, ART clustering, Granger causality for behavioral prediction
- **ATSF Layers L6-L46:** 40 additional layers across 5 remaining tiers (behavioral analysis, context evaluation, output filtering, audit trail, governance)
- **Framework Integrations:** AutoGPT, LlamaIndex, LangGraph, AutoGen (following the LangChain pattern)
- **CAR Wave 3:** Domain governance, skill codes in CAR string, multi-registry federation, full ACI alias deprecation

---

## 9. Open/Proprietary Boundary

| Open Source (Apache-2.0) | Proprietary (AgentAnchor) |
|--------------------------|---------------------------|
| ATSF Security Pipeline (L0-L46) | Observer + Anomaly Detection |
| Trust Engine + Decay Profiles | Multi-Agent Correlation |
| Intent/Enforcement Services | Incident Response Chain |
| LangChain/CrewAI Integrations | Circuit Breaker + Kill Switch |
| CAR Identity + Supervision | Swarm Topology + Containment |
| Proof Plane | Council Governance |
| Contracts (Zod schemas) | Contagion Modeling |
| OpenID4VP/VCI Integration | MIA Protocol |

---

## 10. Risk Register

| Risk | Mitigation |
|------|-----------|
| Phase 0 deletions break builds | Full test suite after each deletion batch; throw errors instead of silent fallbacks |
| Phase 1 layers are superficial pass-throughs | Define minimum detection accuracy per layer; adversarial test suites |
| Phase 2 integration regressions | Feature flags for new escalation paths; gradual rollout |
| Phase 3 topology doesn't scale to 1000+ agents | Benchmark at scale early; consider graph DB if needed |
| Phase 4 OpenID conformance test failures | Run test suite iteratively; engage OpenID community for guidance |
| Real services behave differently than mocks | Gradual rollout with monitoring; keep mocks ONLY in test files |

---

## 11. Success Metrics

| Metric | Ph0 | Ph1 | Ph2 | Ph3 | Ph4 |
|--------|-----|-----|-----|-----|-----|
| GRI Score | 74 | 79 | 84 | 87 | 89 |
| Mock Services in Production Paths | 0 | 0 | 0 | 0 | 0 |
| False Claims in Documentation | 0 | 0 | 0 | 0 | 0 |
| ATSF Layers Implemented | 0 | 6 | 6 | 6 | 6+ |
| Framework Integrations | 1 | 2 | 2 | 2 | 2+ |
| Automated Response Actions | 0 | 0 | 4 | 8 | 8+ |
| OpenID Certifications | 0 | 0 | 0 | 0 | 3 |

---

## 12. Immediate Next Steps

1. **Ryan — Phase 0 (Week 1):** Delete all 6 fake incident response service defaults, fix TEE verifier, fix truth chain dev key, fix mock intent/enforcement defaults
2. **Ryan — Phase 0 (Week 1):** Fix all false ATSF documentation claims (index.md, roadmap.md)
3. **Alex — Phase 0 (Week 1):** Replace fake team members with real founders or remove about page
4. **Week 2:** Begin L0 (Request Format Validator) and L4 (Injection Pattern Detector) — highest-impact layers
5. **Week 2:** Start replacing MockIntentService with real Supabase-backed implementation
6. **Week 12:** Begin OpenID4VP/VCI implementation — target self-certification by end of Phase 4

---

## Appendix: Alignment with NIST RFI v2.1

The NIST CAISI RFI response (v2.1, 2026-02-20) underwent 12 surgical edits to remove overclaims, unverifiable statistics, and factual inaccuracies. Every claim in the March 9 submission now matches what NIST will find if they examine the code, the published spec, and the website.

This roadmap extends that honesty-first approach to the entire ecosystem:

- Phase 0 eliminates every mock and false claim that would contradict an external audit
- Each phase's GRI projections are conservative and defensible
- The open/proprietary boundary is enforced throughout — no open-source claims about proprietary features
- Success metrics track "Mock Services in Production Paths" and "False Claims in Documentation" — both must remain at 0 from Phase 0 onward
