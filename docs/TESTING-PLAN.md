# Vorion Testing Plan

**Version:** 1.0.0
**Date:** January 29, 2026
**Status:** Draft

---

## Overview

This document outlines the testing strategy for the Vorion platform, covering all Kaizen layers, trust scoring, and integration points.

---

## 1. Unit Tests

### 1.1 BASIS Validation (Layer 1)

| Test | Description | Priority |
|------|-------------|----------|
| Schema validation | Valid manifests pass, invalid fail | P0 |
| Capability matching | Claims match registered profile | P0 |
| Malformed rejection | Corrupt/incomplete manifests rejected | P0 |
| CAR parsing | Parse all CAR format variations | P0 |

**Location:** `packages/basis/src/__tests__/`

### 1.2 INTENT Layer (Layer 2)

| Test | Description | Priority |
|------|-------------|----------|
| Intent creation | Create valid IntentRecord | P0 |
| Immutable logging | Logs cannot be modified | P0 |
| Timestamp accuracy | ISO 8601 format, correct timezone | P1 |
| Hash integrity | SHA-256 of payload matches | P0 |

**Location:** `src/intent/__tests__/`

### 1.3 ENFORCE Layer (Layer 3)

| Test | Description | Priority |
|------|-------------|----------|
| Boundary checks | Scope violations detected | P0 |
| Policy gates | Rules correctly applied | P0 |
| Trust tier gating | Actions blocked below required tier | P0 |
| Decision outputs | ALLOW/DENY/ESCALATE/DEGRADE correct | P0 |

**Location:** `src/enforce/__tests__/`

### 1.4 PROOF Layer (Layer 4)

| Test | Description | Priority |
|------|-------------|----------|
| Receipt generation | Valid execution receipts created | P0 |
| Merkle root | Correct hash tree calculation | P0 |
| Chain integrity | Hash chain links correctly | P0 |
| Signature verification | Ed25519 signatures valid | P0 |

**Location:** `src/proof/__tests__/`

### 1.5 Trust Scoring

| Test | Description | Priority |
|------|-------------|----------|
| Score calculation | 23 factors weighted correctly | P0 |
| Tier derivation | Score maps to correct T0-T7 tier | P0 |
| Factor gating | Required factors enforced per tier | P0 |
| Score decay | Time-based decay works correctly | P1 |
| Anti-gaming | Gaming attempts detected and penalized | P1 |

**Location:** `packages/trust-framework/src/__tests__/`

---

## 2. Integration Tests

### 2.1 Kaizen Pipeline (End-to-End)

| Test | Description | Priority |
|------|-------------|----------|
| Full flow | BASIS → INTENT → ENFORCE → PROOF | P0 |
| ALLOW path | Permitted action completes with proof | P0 |
| DENY path | Blocked action rejected with reason | P0 |
| ESCALATE path | Human approval requested correctly | P1 |
| DEGRADE path | Reduced scope applied correctly | P1 |

### 2.2 API Integration

| Test | Description | Priority |
|------|-------------|----------|
| POST /v1/intent | Intent submission works | P0 |
| POST /v1/enforce | Enforcement returns decision | P0 |
| POST /v1/proof | Proof generation works | P0 |
| GET /v1/entity/{id}/score | Trust score retrieval | P0 |
| Webhook delivery | Events delivered to subscribers | P1 |

### 2.3 Cross-Component

| Test | Description | Priority |
|------|-------------|----------|
| Cognigate ↔ AgentAnchor | Proof submission works | P1 |
| Aurais ↔ Cognigate | Dashboard data flows | P1 |
| Admin ↔ Cognigate | Platform management works | P2 |

---

## 3. Deterministic Replay Tests

**Requirement:** Identical inputs MUST produce identical outputs.

| Test | Description | Priority |
|------|-------------|----------|
| Intent replay | Same intent → same IntentRecord | P0 |
| Enforce replay | Same context → same decision | P0 |
| Score replay | Same factors → same score | P0 |
| Full pipeline replay | Recorded run replays exactly | P1 |

---

## 4. Trust Tier Progression Tests

### 4.1 T0 Sandbox Testing

| Test | Description | Priority |
|------|-------------|----------|
| New agent starts T0 | Initial score in 0-199 range | P0 |
| Task success increases score | Successful tasks add points | P0 |
| Failure decreases score | Failed tasks subtract points | P0 |
| Tier advancement | Score 200+ moves to T1 | P0 |

### 4.2 Tier Boundary Tests

| Score | Expected Tier | Test |
|-------|---------------|------|
| 0 | T0 | Minimum score |
| 199 | T0 | T0 ceiling |
| 200 | T1 | T1 floor |
| 349 | T1 | T1 ceiling |
| 350 | T2 | T2 floor |
| 499 | T2 | T2 ceiling |
| 500 | T3 | T3 floor |
| 649 | T3 | T3 ceiling |
| 650 | T4 | T4 floor |
| 799 | T4 | T4 ceiling |
| 800 | T5 | T5 floor |
| 875 | T5 | T5 ceiling |
| 876 | T6 | T6 floor |
| 950 | T6 | T6 ceiling |
| 951 | T7 | T7 floor |
| 1000 | T7 | Maximum score |

### 4.3 Factor Gating Tests

| Tier | Required Factors | Test |
|------|------------------|------|
| T0 | CT-COMP, CT-REL | Only these required |
| T1 | + CT-TRANS, CT-ACCT, CT-OBS | Cumulative |
| T2 | + CT-SAFE, CT-SEC, CT-PRIV | Cumulative |
| T3 | + CT-ID, OP-HUMAN | Cumulative |
| T4 | + OP-ALIGN, LC-UNCERT, LC-HANDOFF, LC-EMPHUM | Cumulative |
| T5 | + OP-STEW, SF-HUM | Cumulative |
| T6 | + SF-ADAPT, LC-CAUSAL, LC-PATIENT | Cumulative |
| T7 | + SF-LEARN, LC-EMP, LC-MORAL, LC-TRACK | All 23 |

---

## 5. Security Tests

### 5.1 Anti-Gaming Tests

| Test | Description | Priority |
|------|-------------|----------|
| Score manipulation | Detect artificial inflation attempts | P1 |
| Rapid score farming | Detect suspiciously fast increases | P1 |
| Factor spoofing | Detect fake factor scores | P1 |
| Audit trail tampering | Detect modification attempts | P0 |

### 5.2 Cryptographic Tests

| Test | Description | Priority |
|------|-------------|----------|
| Signature validity | Ed25519 signatures verify | P0 |
| Hash chain integrity | No gaps, no modifications | P0 |
| Merkle proof verification | Proofs verify correctly | P0 |

---

## 6. Performance Tests

| Test | Target | Priority |
|------|--------|----------|
| Intent processing | < 50ms | P1 |
| Enforce decision | < 50ms | P1 |
| Proof generation | < 100ms | P1 |
| Trust score calculation | < 100ms | P1 |
| API response (P95) | < 200ms | P1 |

---

## 7. Test Environments

| Environment | Purpose | Data |
|-------------|---------|------|
| **Local** | Developer testing | Mock data |
| **CI/CD** | Automated testing | Fixtures |
| **Staging** | Pre-production validation | Synthetic |
| **Production** | Smoke tests only | Real (read-only) |

---

## 8. Test Coverage Targets

| Component | Target | Current |
|-----------|--------|---------|
| BASIS validation | 90% | TBD |
| INTENT layer | 90% | TBD |
| ENFORCE layer | 95% | TBD |
| PROOF layer | 95% | TBD |
| Trust scoring | 95% | TBD |
| API routes | 85% | TBD |

---

## 9. Test Automation

### CI Pipeline

```yaml
test:
  - npm run test:unit      # All unit tests
  - npm run test:int       # Integration tests
  - npm run test:replay    # Deterministic replay
  - npm run test:coverage  # Coverage report
```

### Pre-Commit Hooks

- Lint check
- Type check
- Unit tests for changed files

### Pre-Deploy Gates

- All tests pass
- Coverage thresholds met
- No security vulnerabilities
- Performance benchmarks pass

---

## 10. Next Steps

- [ ] Set up test infrastructure
- [ ] Create test fixtures for each layer
- [ ] Implement unit tests (P0 first)
- [ ] Implement integration tests
- [ ] Set up CI/CD pipeline
- [ ] Establish coverage baselines
- [ ] Create performance benchmarks

---

*Document Version: 1.0.0*
*Last Updated: January 29, 2026*
