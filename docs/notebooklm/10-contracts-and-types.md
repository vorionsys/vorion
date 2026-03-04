# Vorion Type Contracts & Evidence System
## Source: packages/contracts/src/v2/trust-profile.ts

This document covers the TypeScript type system that governs trust profiles, evidence, dynamics, and risk management across the Vorion platform.

---

## Trust Factor Scores

Each of the 16 factors is scored 0.0-1.0:
- 0.0: No evidence / unproven
- 0.5: Baseline / meets minimum
- 1.0: Maximum trust / proven excellence

Type: `TrustFactorScores = Record<string, number>`

Factor codes: CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE, CT-SEC, CT-PRIV, CT-ID, OP-HUMAN, OP-ALIGN, OP-CONTEXT, OP-STEW, SF-HUM, SF-ADAPT, SF-LEARN

---

## Evidence System

### Evidence Types and Multipliers

HITL evidence is weighted more heavily to solve the cold-start problem: a single HITL approval counts as ~5 automated observations.

| Evidence Type | Weight | Description |
|--------------|--------|-------------|
| automated | 1.0x | Standard system observations |
| hitl_approval | 5.0x | Human-in-the-loop approval |
| hitl_rejection | 5.0x | Human rejection/correction |
| examination | 3.0x | Formal examination result |
| audit | 3.0x | Third-party audit finding |
| sandbox_test | 0.5x | Shadow/testnet observation (discounted) |
| peer_review | 2.0x | Cross-agent endorsement |

### Trust Evidence Interface

Each evidence item contains:
- **evidenceId**: Unique identifier
- **factorCode**: Which trust factor this affects (e.g. 'CT-COMP', 'OP-ALIGN')
- **impact**: Score impact (-1000 to +1000)
- **source**: Human-readable source description
- **collectedAt**: When evidence was collected
- **expiresAt**: Optional expiration
- **evidenceType**: Classification (defaults to 'automated')
- **metadata**: Additional context

### Cold-Start Solution

Without HITL evidence, an agent needs ~1000 automated observations to graduate from T0. With HITL approvals at 5x weight, graduation can happen in ~200 observations -- a much more practical timeline for real deployments.

---

## Trust Profile

Complete trust state for an agent:

| Field | Type | Description |
|-------|------|-------------|
| profileId | string | Unique profile identifier |
| agentId | string | Agent this profile belongs to |
| factorScores | TrustFactorScores | Individual factor scores (each 0.0-1.0) |
| compositeScore | number | Weighted sum (0-1000) |
| observationTier | ObservationTier | Determines trust ceiling |
| adjustedScore | number | After applying observation ceiling (0-1000) |
| band | TrustBand | Current trust band (T0-T7) |
| calculatedAt | Date | When calculated |
| validUntil | Date (optional) | Expiration |
| evidence | TrustEvidence[] | Evidence items used |
| version | number | Optimistic concurrency version |

---

## Band Thresholds (0-1000 Scale)

| Band | Min | Max |
|------|-----|-----|
| T0 | 0 | 199 |
| T1 | 200 | 349 |
| T2 | 350 | 499 |
| T3 | 500 | 649 |
| T4 | 650 | 799 |
| T5 | 800 | 875 |
| T6 | 876 | 950 |
| T7 | 951 | 1000 |

### Banding Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| hysteresis | 30 points | Buffer to prevent oscillation |
| decayRate | 0.01/day | Daily decay for evidence freshness |
| promotionDelay | 7 days | Minimum days at current band before promotion |

---

## Trust Dynamics (Asymmetric Gain/Loss)

Per ATSF v2.0: "Trust is hard to gain, easy to lose" (10:1 ratio)

### Gain Formula
```
delta = gainRate * log(1 + (ceiling - current))
```
Default gainRate: 0.01 (slow, logarithmic)

### Loss Formula
```
delta = -lossRate * current
```
Default lossRate: 0.10 (10x faster, exponential)

### Safety Mechanisms

| Mechanism | Default | Description |
|-----------|---------|-------------|
| Cooldown period | 168 hours (7 days) | After any trust drop, trust cannot increase |
| Oscillation detection | 3 direction changes in 24 hours | Triggers circuit breaker |
| Reversal penalty | 2.0x | When provisional success becomes final failure |
| Circuit breaker | Score < 100 | Triggers lockdown |

---

## Risk Profiles (Temporal Outcome Tracking)

Different actions have different time horizons before outcomes can be finalized:

| Risk Profile | Outcome Window | Use Case |
|-------------|---------------|----------|
| IMMEDIATE | 5 minutes | Computations, queries |
| SHORT_TERM | 4 hours | API calls |
| MEDIUM_TERM | 3 days | Simple transactions |
| LONG_TERM | 30 days | Financial trades |
| EXTENDED | 90 days | Investments |

### Provisional Outcomes

When an agent takes an action:
1. A provisional outcome is recorded immediately
2. The outcome window opens based on risk profile
3. During the window, the outcome can be finalized (success or failure)
4. If provisional success becomes final failure (reversal), the penalty is amplified 2x
5. This prevents agents from gaming trust by taking actions that look good short-term but fail long-term

---

## Trust Dynamics State

Per-agent tracking:
- **Cooldown state**: Whether in cooldown, start/end times, reason
- **Direction changes**: Recent gain/loss transitions for oscillation detection
- **Last direction**: Current trend (gain, loss, or none)
- **Circuit breaker**: Whether tripped, reason, timestamp

---

## Validation Gate

The BASIS Validation Gate validates agent manifests before execution:

### Decisions
- **PASS**: Agent validated, proceed to Layer 2 (INTENT)
- **REJECT**: Agent fails validation, block execution
- **ESCALATE**: Agent requires human review

### Validation Steps
1. Schema validation (Zod)
2. CAR string format validation
3. Registered profile comparison
4. Trust tier requirement check
5. Domain authorization
6. Capability-vs-tier validation
7. Custom validators

### CAR String Format
```
registry.organization.class:DOMAINS-Ln@version
```
Example: `a3i.acme-corp.invoice-bot:ABF-L3@1.0.0`

### Preset Gate Configurations
- **Strict gate**: Treats warnings as errors
- **Production gate**: Requires registered profile, minimum T2 tier
