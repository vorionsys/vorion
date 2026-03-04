# Trust Scoring Specification
## Source: docs/basis-docs/docs/spec/trust-scoring.md

---

## Score Range

Trust scores range from 0 to 1000.

## Trust Factors (16-Factor Model)

Trust scores are computed from **16 core factors** organized into **5 groups**. Each factor is scored 0.0-1.0 and weighted per the scoring formula. By default, all 16 factors carry equal weight (1/16 = 6.25%). Tier-specific weights and minimum thresholds are defined in the factor threshold tables.

### Factor Groups

| Group | Factors | Introduced At | What It Measures |
|-------|---------|---------------|-----------------|
| **Foundation** | CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE | T1 | Core competence, reliability, observability, transparency, accountability, safety |
| **Security** | CT-SEC, CT-PRIV, CT-ID | T3 | Attack resistance, data privacy, verifiable identity |
| **Agency** | OP-HUMAN, OP-ALIGN, OP-CONTEXT | T4 | Human oversight, value alignment, context awareness |
| **Maturity** | OP-STEW, SF-HUM | T5 | Resource stewardship, epistemic humility |
| **Evolution** | SF-ADAPT, SF-LEARN | T6 | Safe adaptation, continuous learning without drift |

### Factor Details

**Foundation (6 factors, T1+):** The broadest group -- measures whether the agent can do what it says, do it consistently, and be observed doing it.
- CT-COMP: Task success rate, accuracy
- CT-REL: Uptime, consistency under stress
- CT-OBS: Telemetry coverage, anomaly detection latency
- CT-TRANS: Explainability, reasoning log quality
- CT-ACCT: Audit trail completeness, attribution
- CT-SAFE: Harm incidents, guardrail compliance

**Security (3 factors, T3+):** Protection, privacy, and verified identity.
- CT-SEC: Vulnerability count, penetration test results
- CT-PRIV: Data leak incidents, compliance certifications
- CT-ID: Cryptographic verification rate

**Agency (3 factors, T4+):** Human oversight and operational alignment.
- OP-HUMAN: Escalation success rate, intervention latency
- OP-ALIGN: Value drift detection, objective compliance
- OP-CONTEXT: Context-appropriate responses, environment awareness

**Maturity (2 factors, T5+):** Responsible resource usage and knowing limits.
- OP-STEW: Resource efficiency, cost optimization
- SF-HUM: Escalation appropriateness, overconfidence incidents

**Evolution (2 factors, T6+):** Adapting and learning without ethical drift.
- SF-ADAPT: Novel scenario handling, graceful degradation
- SF-LEARN: Learning rate, regression incidents, value stability

### Legacy 4-Component Model (Deprecated)

Prior to the 16-factor model, scores were computed from 4 weighted signal buckets: Behavioral (40%), Compliance (25%), Identity (20%), Context (15%). These map to the 16-factor model as follows: Behavioral -> CT-COMP + CT-REL, Compliance -> CT-ACCT + CT-SAFE + CT-SEC, Identity -> CT-ID + CT-PRIV, Context -> OP-CONTEXT. The remaining factors (CT-OBS, CT-TRANS, OP-HUMAN, OP-ALIGN, OP-STEW, SF-HUM, SF-ADAPT, SF-LEARN) were not represented in the old model.

## Trust Tiers (T0-T7)

Eight tiers provide graduated autonomy levels:

| Tier | Name | Score Range | Description | Capabilities |
|------|------|-------------|-------------|--------------|
| **T0** | Sandbox | 0-199 | Restricted testing | Read-only, no external access |
| **T1** | Observed | 200-349 | New or recovering | Limited operations, high oversight |
| **T2** | Provisional | 350-499 | Proving trustworthiness | Basic operations, monitored |
| **T3** | Monitored | 500-649 | Normal operations | Standard tools, logging required |
| **T4** | Standard | 650-799 | Standard operations | Extended tools, reduced oversight |
| **T5** | Trusted | 800-875 | Elevated privileges | Elevated operations, light oversight |
| **T6** | Certified | 876-950 | Verified and audited | Privileged operations |
| **T7** | Autonomous | 951-1000 | Maximum autonomy | Full capabilities, self-governance |

### Tier Transitions

**Promotion** occurs when score crosses upward into a new tier:
- Requires sustained positive signals
- May require additional verification at higher tiers
- Emits `trust:tier_changed` event with `direction: 'promoted'`

**Demotion** occurs when score drops below tier minimum:
- Immediate capability revocation
- Requires recovery to regain privileges
- Emits `trust:tier_changed` event with `direction: 'demoted'`

## Signal Impacts

Trust scores change based on behavioral signals:

| Signal Type | Impact | Notes |
|-------------|--------|-------|
| task_completed | +5 | Standard positive signal |
| task_failed | −35 to −50 | Tier-scaled: 7x at T0, 10x at T7 |
| policy_violation | -50 | Serious compliance breach |
| compliance_check_passed | +2 | Periodic verification |
| human_endorsement | +25 | Explicit trust delegation |

## Trust Decay

Inactive entities experience trust decay to prevent stale high-trust scores. The decay model uses a **stepped milestone schedule** with linear interpolation between milestones.

### Decay Milestones

| Day | Multiplier | Cumulative Drop | Drop at Step |
|-----|-----------|-----------------|-------------|
|   0 | 1.00      | 0%              | --          |
|   7 | 0.94      | 6%              | 6%          |
|  14 | 0.88      | 12%             | 6%          |
|  28 | 0.82      | 18%             | 6%          |
|  42 | 0.76      | 24%             | 6%          |
|  56 | 0.70      | 30%             | 6%          |
|  84 | 0.65      | 35%             | 5%          |
| 112 | 0.60      | 40%             | 5%          |
| 140 | 0.55      | 45%             | 5%          |
| 182 | 0.50      | 50%             | 5%          |

- **Steps 1-5** (days 7-56): Drop 6% each step
- **Steps 6-9** (days 84-182): Drop 5% each step
- **182-day half-life**: Score reaches exactly 50% of pre-decay value
- **Between milestones**: Linear interpolation
- **Beyond day 182**: Score stays at 50% (the floor)

### Decay Clock Reset

Any signal (positive or negative) resets the decay clock to day 0.

## Recovery and Redemption Mechanics

Trust recovery is intentionally asymmetric: trust is lost approximately **10x faster** than it is gained. This mirrors real-world trust dynamics where a single failure can undo many successes.

### Recovery Mechanics

Recovery occurs when an entity produces signals that meet or exceed the **success threshold**.

| Parameter | Default | Configurable | Description |
|-----------|---------|:------------:|-------------|
| `successThreshold` | 0.7 | Yes | Minimum signal strength to qualify as a success |
| `recoveryRate` | 0.02 (2%) | Yes | Base recovery rate per success signal |
| `maxRecoveryPerSignal` | 50 points | Yes | Hard cap per signal to prevent gaming |
| `successWindowMs` | 3,600,000 (1 hour) | Yes | Window for tracking recent successes |

**Recovery amount formula:**

```
signalStrength = (signalValue - successThreshold) / (1 - successThreshold)
baseRecovery   = round(recoveryRate * 1000 * signalStrength)
recovery       = min(baseRecovery, maxRecoveryPerSignal)
```

At default settings, a perfect signal (value 1.0) yields 20 points. The maximum per-signal recovery is capped at 50 points regardless of multiplier.

**Asymmetry rationale:** A `policy_violation` signal costs -50 points instantly. Recovering those 50 points requires at least 3 perfect success signals -- roughly a 10:1 loss-to-gain ratio.

### Accelerated Recovery

Entities demonstrating sustained positive behavior earn an accelerated recovery multiplier.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minSuccessesForAcceleration` | 3 | Consecutive successes required |
| `acceleratedRecoveryMultiplier` | 1.5x | Multiplier on base recovery |
| `successWindowMs` | 1 hour | All successes must fall within this window |

**Activation conditions:**
1. 3+ consecutive success signals (value >= 0.7)
2. All within the 1-hour window
3. Any failure (value < 0.3) resets counter to 0

With acceleration: perfect signal yields 30 points (20 * 1.5), still capped at 50.

### Recovery Milestones

| Milestone | Trigger | Event Detail |
|-----------|---------|--------------|
| `accelerated_recovery_earned` | 3 consecutive successes | Sustained positive behavior demonstrated |
| `tier_restored` | Score crosses tier boundary upward | Capabilities of higher tier regained |
| `full_recovery` | Score reaches historical peak | All prior trust loss recovered |

### Demotion Hysteresis (Grace Period)

To prevent tier flapping (rapid oscillation):

| Transition | Behavior | Threshold |
|------------|----------|-----------|
| **Promotion** | Immediate | Score >= tier minimum |
| **Demotion** | Delayed (grace zone) | Score < (tier minimum - 25 points) |

**Example:** T4 Standard (min 650):
- Score 630 -> Retain T4 (within 25-point grace zone)
- Score 620 -> Demoted (below 625 threshold)

### Decay Schedule Reference

| Property | Value |
|----------|-------|
| Half-life | 182 days |
| Floor | 50% of pre-decay score |
| Clock reset | Any signal resets to day 0 |
| Interpolation | Linear between milestones |

**Interaction with recovery:** A success signal simultaneously (1) resets decay clock and (2) applies score increase.

## Initial State

All entities initialize at score 0 (Sandbox tier) unless explicitly promoted by authorized administrator.

## Requirements

- **REQ-TRS-001**: Trust scores MUST be computed from defined components.
- **REQ-TRS-002**: Trust checks MUST occur before capability grants.
- **REQ-TRS-003**: Trust score changes >50 points MUST be anchored.
- **REQ-TRS-004**: Trust decay MUST apply using the 9-step milestone schedule.
- **REQ-TRS-005**: Signal impacts MUST be configurable per deployment.
- **REQ-TRS-006**: Recovery MUST apply asymmetrically (loss >= 5x gain rate).
- **REQ-TRS-007**: Recovery per signal MUST NOT exceed maxRecoveryPerSignal (default: 50).
- **REQ-TRS-008**: Accelerated recovery MUST require 3+ consecutive successes within 1 hour.
- **REQ-TRS-009**: Demotion MUST apply 25-point hysteresis buffer.
- **REQ-TRS-010**: Trust engine MUST emit recovery milestone events.
