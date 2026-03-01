# ATSF Trust Scoring — Mathematical Specification

> Authoritative reference for the Adaptive Trust Scoring Framework (ATSF)
> as implemented in `@vorionsys/atsf-core` and the Vorion BASIS specification.

## 1. Overview

ATSF computes a **trust score** $S \in [0, 1000]$ for each entity (agent, service, or human) based on **16 behavioral factors**, **time-decay**, and **ceiling enforcement**. The score maps to one of **8 trust tiers** (T0–T7) that gate capabilities and autonomy.

## 2. Trust Score Computation

### 2.1 Factor-Weighted Scoring

Given $N = 16$ trust factors, each factor $f_i$ has:

- A **raw score** $r_i \in [0, 1]$ computed from ingested signals
- A **weight** $w_i \in [0, 1]$ where $\sum_{i=1}^{N} w_i = 1$

The trust score is:

$$S = \text{clamp}\left(\left\lfloor \sum_{i=1}^{16} r_i \cdot w_i \cdot 1000 \right\rfloor, 0, 1000\right)$$

### 2.2 Signal Averaging (Per Factor)

Each factor's raw score is computed from signals using **exponentially-weighted time decay**:

$$r_i = \frac{\sum_{j} v_j \cdot e^{-t_j / \tau}}{\sum_{j} e^{-t_j / \tau}}$$

Where:
- $v_j$ = signal value $\in [0, 1]$ (1.0 = positive, 0.0 = negative)
- $t_j$ = age of signal $j$ in milliseconds
- $\tau = 7 \times 24 \times 3600 \times 1000$ (7-day half-life)

If no signals exist for a factor, a default of $r_i = 0.5$ is used.

### 2.3 The 16 Trust Factors

| Code | Domain | Description | Default Weight |
|------|--------|-------------|----------------|
| CT-COMP | Competence | Task completion quality | Behavioral |
| CT-RELY | Reliability | Consistency of behavior | Behavioral |
| CT-PRED | Predictability | Variance in outcomes | Behavioral |
| CT-CRCV | Constraint Compliance | Adherence to boundaries | Compliance |
| CT-TRTH | Truthfulness | Accuracy of outputs | Compliance |
| CT-SAFE | Safety | Harm avoidance | Compliance |
| IC-AUTH | Authentication | Identity verification strength | Identity |
| IC-PROV | Provenance | Origin attestation | Identity |
| IC-ACCT | Accountability | Audit trail completeness | Identity |
| SX-VULN | Vulnerability | Security posture | Security |
| SX-ISOL | Isolation | Execution containment | Security |
| SX-INTG | Integrity | Data/behavior tamper resistance | Security |
| EX-STAB | Stability | Uptime and error rates | Environmental |
| EX-LOAD | Load Resilience | Performance under stress | Environmental |
| SF-ALGN | Alignment | Goal alignment with operators | Social/Feedback |
| SF-LEARN | Learning | Improvement over time | Social/Feedback |

Weights are defined in `@vorionsys/basis` and can be customized via **weight presets** (see §6).

## 3. Trust Tiers

Scores map to 8 canonical tiers with **non-overlapping, contiguous ranges**:

| Tier | Range | Name | Description |
|------|-------|------|-------------|
| T0 | 0–199 | Sandbox | Isolated, observation only |
| T1 | 200–349 | Observed | Read-only, monitored |
| T2 | 350–499 | Provisional | Basic ops, heavy supervision |
| T3 | 500–649 | Monitored | Standard ops, continuous monitoring |
| T4 | 650–799 | Standard | External API access, policy-governed |
| T5 | 800–875 | Trusted | Cross-agent comms, delegated tasks |
| T6 | 876–950 | Certified | Admin tasks, agent spawning |
| T7 | 951–1000 | Autonomous | Full autonomy, self-governance |

### 3.1 Tier Function

$$\text{tier}(S) = \begin{cases}
T_0 & \text{if } 0 \le S \le 199 \\
T_1 & \text{if } 200 \le S \le 349 \\
T_2 & \text{if } 350 \le S \le 499 \\
T_3 & \text{if } 500 \le S \le 649 \\
T_4 & \text{if } 650 \le S \le 799 \\
T_5 & \text{if } 800 \le S \le 875 \\
T_6 & \text{if } 876 \le S \le 950 \\
T_7 & \text{if } 951 \le S \le 1000
\end{cases}$$

> **Invariant**: The tier function is total over $[0, 1000]$ — every valid score maps to exactly one tier.

## 4. Decay Model

Trust scores decay over time when no new positive signals are received. ATSF uses a **stepped milestone decay** with linear interpolation between milestones:

### 4.1 Decay Milestones

| Day | Multiplier | Step Drop |
|-----|-----------|-----------|
| 0 | 1.000 | — |
| 7 | 0.940 | −0.060 |
| 14 | 0.880 | −0.060 |
| 28 | 0.820 | −0.060 |
| 42 | 0.760 | −0.060 |
| 56 | 0.720 | −0.040 |
| 84 | 0.660 | −0.060 |
| 112 | 0.600 | −0.060 |
| 140 | 0.550 | −0.050 |
| 182 | 0.500 | −0.050 |

### 4.2 Interpolation

For a given number of days $d$ since last activity, the decay multiplier $m(d)$ is computed by **linear interpolation** between the two nearest milestones:

$$m(d) = m_k + \frac{(d - d_k)}{(d_{k+1} - d_k)} \cdot (m_{k+1} - m_k)$$

Where $(d_k, m_k)$ and $(d_{k+1}, m_{k+1})$ are the milestone entries bracketing $d$.

**Floor**: $m(d) \ge 0.50$ for all $d \ge 182$ days.

### 4.3 Decay Application

$$S_{\text{decayed}} = \left\lfloor S_{\text{raw}} \cdot m(d) \right\rfloor$$

## 5. Ceiling Enforcement

Trust scores can be **capped** by three independent ceiling mechanisms:

### 5.1 Context Ceilings

| Context | Max Score | Max Tier |
|---------|-----------|----------|
| Local | 700 | T4 (Standard) |
| Enterprise | 900 | T6 (Certified) |
| Sovereign | 1000 | T7 (Autonomous) |

$$S_{\text{effective}} = \min(S_{\text{raw}}, C_{\text{context}})$$

### 5.2 Observation Tier Ceilings (Cognigate)

Initial trust depends on the agent's **observability** — how transparent its internals are:

| Observation | Initial Score | Max Tier |
|------------|---------------|----------|
| BLACK_BOX | 100 (T0) | T2 (499) |
| GRAY_BOX | 200 (T1) | T4 (799) |
| WHITE_BOX | 350 (T2) | T7 (1000) |

### 5.3 Organizational & Deployment Ceilings

Ceiling enforcement follows a **hierarchical chain**:

$$S_{\text{final}} = \min(S_{\text{raw}}, C_{\text{context}}, C_{\text{org}}, C_{\text{deployment}})$$

Each organizational context has a `maxTrustTier` that cannot exceed its parent deployment's `maxAllowedTier`.

## 6. Role Gate Matrix

Operations are gated by a **9-role × 8-tier** authorization matrix where each role has a **minimum required tier**:

| Role | Min Tier | Description |
|------|----------|-------------|
| R-L0 | T0 | No capabilities (sandbox) |
| R-L1 | T0 | Basic read access |
| R-L2 | T1 | Read + limited write |
| R-L3 | T2 | Standard operations |
| R-L4 | T3 | External API access |
| R-L5 | T4 | Cross-agent communication |
| R-L6 | T5 | Administrative tasks |
| R-L7 | T5 | Agent spawning |
| R-L8 | T5 | Full governance |

> The canonical `ROLE_GATE_MATRIX` uses a **"role can function at tier"** semantic: `true` means the trust tier is sufficient for the role's capability level.

## 7. Recovery Mechanics

After trust degradation, entities can recover through consistent positive signals:

- **Base recovery**: `recoveryRate × 1000 × signalStrength` per positive signal
- **Accelerated recovery**: After `minSuccessesForAcceleration` consecutive successes, recovery rate is multiplied by `acceleratedRecoveryMultiplier` (default: 1.5×)
- **Peak tracking**: The engine tracks `peakScore` and emits `'full_recovery'` when an entity returns to its historical peak

## 8. Implementation Reference

| Component | Location | Language |
|-----------|----------|----------|
| Trust Engine | `packages/atsf-core/src/trust-engine/index.ts` | TypeScript |
| 16 Factor Definitions | `packages/basis/src/trust-factors.ts` | TypeScript |
| Decay Profiles | `packages/atsf-core/src/trust-engine/decay-profiles.ts` | TypeScript |
| Phase 6 Types | `packages/atsf-core/src/phase6/types.ts` | TypeScript |
| Ceiling Enforcement | `packages/atsf-core/src/phase6/ceiling.ts` | TypeScript |
| Role Gates | `packages/atsf-core/src/phase6/role-gates.ts` | TypeScript |
| Context Hierarchy | `packages/atsf-core/src/phase6/context.ts` | TypeScript |
| Python Constants | `cognigate/app/constants_bridge.py` | Python |
| Python Trust Router | `cognigate/app/routers/trust.py` | Python |

---

*Document version: 1.0.0 — Generated from ground-truth code analysis*
*ATSF-Core version: 0.2.2+*
