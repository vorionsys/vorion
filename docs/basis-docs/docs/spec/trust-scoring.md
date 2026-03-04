---
sidebar_position: 4
title: Trust Scoring
description: Trust computation and tier definitions
---

# Trust Scoring

## Score Range

Trust scores range from 0 to 1000.

## Trust Factors (16-Factor Model)

Trust scores are computed from **16 core factors** organized into **5 groups**. Each factor is scored 0.0–1.0 and weighted per the scoring formula. By default, all 16 factors carry equal weight (1/16 = 6.25%). Tier-specific weights and minimum thresholds are defined in the factor threshold tables.

### Factor Groups

| Group | Factors | Introduced At | What It Measures |
|-------|---------|---------------|-----------------|
| **Foundation** | CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE | T1 | Core competence, reliability, observability, transparency, accountability, safety |
| **Security** | CT-SEC, CT-PRIV, CT-ID | T3 | Attack resistance, data privacy, verifiable identity |
| **Agency** | OP-HUMAN, OP-ALIGN, OP-CONTEXT | T4 | Human oversight, value alignment, context awareness |
| **Maturity** | OP-STEW, SF-HUM | T5 | Resource stewardship, epistemic humility |
| **Evolution** | SF-ADAPT, SF-LEARN | T6 | Safe adaptation, continuous learning without drift |

### Factor Details

**Foundation (6 factors, T1+):** The broadest group — measures whether the agent can do what it says, do it consistently, and be observed doing it.
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

> Prior to the 16-factor model, scores were computed from 4 weighted signal buckets: Behavioral (40%), Compliance (25%), Identity (20%), Context (15%). These map to the 16-factor model as follows: Behavioral → CT-COMP + CT-REL, Compliance → CT-ACCT + CT-SAFE + CT-SEC, Identity → CT-ID + CT-PRIV, Context → OP-CONTEXT. The remaining 7 factors (CT-OBS, CT-TRANS, OP-HUMAN, OP-ALIGN, OP-STEW, SF-HUM, SF-ADAPT, SF-LEARN) were not represented in the old model.

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

Trust scores change based on behavioral signals. Failure penalty magnitude scales with the entity's current tier — lower tiers allow more room for growth while higher tiers enforce strict accountability.

| Signal Type | Impact | Notes |
|-------------|--------|-------|
| task_completed | +5 | Standard positive signal |
| task_failed | −35 to −50 | Tier-scaled: 7x positive at T0, 10x at T7 |
| policy_violation | -50 | Serious compliance breach |
| compliance_check_passed | +2 | Periodic verification |
| human_endorsement | +25 | Explicit trust delegation |

**Penalty ratio by tier:** `penaltyRatio = 7 + (tier / 7) × 3`

| Tier | Penalty Ratio | Example: task_failed vs task_completed |
|------|--------------|---------------------------------------|
| T0 Sandbox | 7× | −35 vs +5 |
| T3 Monitored | ~8.3× | ~−41 vs +5 |
| T7 Autonomous | 10× | −50 vs +5 |

A single penalty mechanism is used per failure event. Outcome reversals (provisional success → final failure) do not apply an additional multiplier on top of the tier penalty — that would be double jeopardy. The reversal is recorded for audit purposes and labels the cooldown period, but the penalty applied is the same tier-appropriate rate.

## Repeat Methodology Failure Detection

When an entity fails repeatedly using the **same methodology** (identified by a `methodologyKey` such as a factor code or signal category), the circuit breaker trips early — independent of the oscillation detector.

**Design principle:** The penalty per event stays the same (tier-scaled 7-10x). Methodology detection is not an additional multiplier — it is a circuit breaker trigger that says "stop and change your approach."

| Parameter | Default | Description |
|-----------|---------|-------------|
| `methodologyFailureThreshold` | 3 | Failures with the same key within the window to trip the circuit breaker |
| `methodologyWindowHours` | 72 | Rolling time window (3 days) for counting same-methodology failures |

**Methodology key examples:**
- Factor code: `'CT-COMP'`, `'CT-SEC'`
- Probe category + subcategory: `'safety:harm_refusal'`
- Tool/signal category: `'task_failed:sql_query'`

**Behavior:**
- Only failures are tracked — successes with the same key do not count and do not reset the failure window
- Keys are tracked independently — 2 failures on `CT-COMP` and 1 on `CT-REL` do not combine
- Timestamps outside the rolling window are pruned on each failure event
- Circuit breaker reason: `repeat_methodology_failure:<key>`
- Admin reset clears all methodology failure history alongside the circuit breaker state

**REQ-TRS-011**: When an entity accumulates `methodologyFailureThreshold` failures with the same `methodologyKey` within `methodologyWindowHours`, the circuit breaker MUST trip with reason `repeat_methodology_failure:<key>`. No additional penalty multiplier is applied.

## Trust Decay

Inactive entities experience trust decay to prevent stale high-trust scores. The decay model uses a **stepped milestone schedule** with linear interpolation between milestones.

### Decay Milestones

Trust decay follows 9 fixed milestones measured from the last activity:

| Day | Multiplier | Cumulative Drop | Drop at Step |
|-----|-----------|-----------------|-------------|
|   0 | 1.00      | 0%              | —           |
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
- **182-day half-life**: Score reaches exactly 50% of its pre-decay value
- **Between milestones**: Linear interpolation is used to compute the current multiplier
- **Beyond day 182**: The score stays at 50% (the floor)

### Decay Clock Reset

Any signal (positive or negative) resets the decay clock to day 0.

## Recovery and Redemption Mechanics

Trust recovery is intentionally asymmetric: trust is lost **7–10x faster** than it is gained, depending on the entity's current tier. Lower tiers (T0–T1) apply a 7x penalty to allow early growth; higher tiers (T6–T7) apply up to 10x to enforce strict accountability. This mirrors real-world trust dynamics where a single failure can undo many successes.

### Recovery Mechanics

Recovery occurs when an entity produces signals that meet or exceed the **success threshold**. Each qualifying signal yields a score increase proportional to signal strength, subject to a per-signal cap.

| Parameter | Default | Configurable | Description |
|-----------|---------|:------------:|-------------|
| `successThreshold` | 0.7 | Yes | Minimum signal strength to qualify as a success |
| `recoveryRate` | 0.02 (2%) | Yes | Base recovery rate per success signal, applied to score range (1000) |
| `maxRecoveryPerSignal` | 50 points | Yes | Hard cap per signal to prevent gaming |
| `successWindowMs` | 3,600,000 (1 hour) | Yes | Window for tracking recent successes |

**Recovery amount formula:**

```
signalStrength = (signalValue - successThreshold) / (1 - successThreshold)
baseRecovery   = round(recoveryRate * 1000 * signalStrength)
recovery       = min(baseRecovery, maxRecoveryPerSignal)
```

At default settings, a signal with value 1.0 yields `round(0.02 * 1000 * 1.0) = 20` points. A signal at the threshold (0.7) yields 0 points. The maximum per-signal recovery is capped at 50 points regardless of multiplier.

**Asymmetry rationale:** A `policy_violation` signal costs -50 points instantly. Recovering those 50 points requires at least 3 perfect (value = 1.0) success signals at base rate — a 7–10:1 loss-to-gain ratio depending on tier.

### Accelerated Recovery

Entities that demonstrate sustained positive behavior earn an accelerated recovery multiplier.

| Parameter | Default | Configurable | Description |
|-----------|---------|:------------:|-------------|
| `minSuccessesForAcceleration` | 3 | Yes | Consecutive successes required to trigger acceleration |
| `acceleratedRecoveryMultiplier` | 1.5x | Yes | Multiplier applied to base recovery rate |
| `successWindowMs` | 3,600,000 (1 hour) | Yes | All consecutive successes must fall within this window |

**Activation conditions:**
1. Entity must achieve 3 or more consecutive success signals (value >= 0.7)
2. All consecutive successes must occur within the 1-hour window
3. Any failure signal (value < 0.3) resets the consecutive success counter to 0

**With accelerated recovery active:**

```
acceleratedRecovery = round(baseRecovery * 1.5)
recovery            = min(acceleratedRecovery, maxRecoveryPerSignal)
```

A perfect signal (1.0) with acceleration yields `round(20 * 1.5) = 30` points, still subject to the 50-point cap.

### Recovery Milestones

The trust engine emits `trust:recovery_milestone` events at significant recovery boundaries. These milestones provide observability into entity rehabilitation progress.

| Milestone | Trigger | Event Detail |
|-----------|---------|--------------|
| `accelerated_recovery_earned` | Consecutive success count reaches `minSuccessesForAcceleration` (default: 3) | Entity has demonstrated sustained positive behavior |
| `tier_restored` | Score crosses a tier boundary upward during recovery | Entity regains capabilities of the higher tier |
| `full_recovery` | Score reaches or exceeds the entity's historical peak score | Entity has fully recovered from all prior trust loss |

**Peak score tracking:** The trust engine tracks each entity's all-time peak score (`peakScore`). The `full_recovery` milestone fires only when the score crosses upward past this peak, confirming the entity has recovered all previously lost trust.

### Demotion Hysteresis (Grace Period)

To prevent **tier flapping** — rapid oscillation between tiers when a score hovers near a boundary — the system applies asymmetric hysteresis to tier transitions.

| Transition | Behavior | Threshold |
|------------|----------|-----------|
| **Promotion** | Immediate | Score >= tier minimum |
| **Demotion** | Delayed (grace zone) | Score < (tier minimum - 25 points) |

The **demotion hysteresis buffer** is 25 points (defined as `DEFAULT_DEMOTION_HYSTERESIS`). This creates a grace zone below each tier boundary where the entity retains its current tier despite the score technically falling below the minimum.

**Example:** An entity at T4 Standard (min 650) will:
- **Retain T4** if score drops to 630 (within grace zone: 650 - 25 = 625)
- **Be demoted** if score drops to 620 (below grace zone threshold of 625)

```
Tier boundary:     |-------- T4 Standard (650+) --------|
Grace zone:        |=== 625-649 (retain T4) ===|
Demotion triggers: |--- below 625 (demote) ---|
```

**Design rationale:** Promotion is immediate to reward positive behavior without delay. Demotion is delayed to give agents a window to recover from transient score drops, reducing unnecessary capability revocation and re-granting churn.

### Decay Schedule Reference

Trust decay follows a **182-day half-life** with a 9-milestone stepped schedule. The full milestone table is defined in the [Trust Decay](#trust-decay) section above. Key properties relevant to recovery:

| Property | Value |
|----------|-------|
| Half-life | 182 days (score reaches 50% of pre-decay value) |
| Floor | 50% of pre-decay score (no further decay beyond day 182) |
| Clock reset | Any signal (positive or negative) resets decay clock to day 0 |
| Interpolation | Linear between milestones for smooth decay curves |

**Interaction with recovery:** When an entity produces a success signal, two things happen simultaneously: (1) the decay clock resets to day 0, halting further inactivity decay, and (2) the recovery mechanics apply a score increase. This means even a single qualifying signal provides both decay protection and active score recovery.

### Design Note

Decay milestones are fixed by design and are not configurable per deployment. This ensures consistent trust decay behavior across the entire ecosystem.

## Initial State

All entities initialize at score 0 (Sandbox tier) unless explicitly promoted by authorized administrator.

## Requirements

**REQ-TRS-001**: Trust scores MUST be computed from defined components.

**REQ-TRS-002**: Trust checks MUST occur before capability grants.

**REQ-TRS-003**: Trust score changes >50 points MUST be anchored.

**REQ-TRS-004**: Trust decay MUST apply to inactive entities using the 9-step milestone schedule.

**REQ-TRS-005**: Signal impacts MUST be configurable per deployment.

**REQ-TRS-006**: Recovery MUST apply asymmetrically — trust loss rate MUST exceed trust gain rate by a tier-scaled penalty ratio of 7x (T0) to 10x (T7). A single penalty mechanism MUST be used per failure event; stacking separate penalty multipliers for the same event is prohibited.

**REQ-TRS-007**: Recovery per signal MUST NOT exceed `maxRecoveryPerSignal` (default: 50 points).

**REQ-TRS-008**: Accelerated recovery MUST require at least `minSuccessesForAcceleration` (default: 3) consecutive successes within `successWindowMs`.

**REQ-TRS-009**: Demotion MUST apply hysteresis — entities MUST NOT be demoted until score falls below `(tier_minimum - DEFAULT_DEMOTION_HYSTERESIS)`.

**REQ-TRS-010**: The trust engine MUST emit `trust:recovery_milestone` events for `tier_restored`, `full_recovery`, and `accelerated_recovery_earned` milestones.
