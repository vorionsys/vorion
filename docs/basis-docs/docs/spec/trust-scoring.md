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

### Pre-Action Gate Thresholds

The pre-action verification gate (`TRUST_THRESHOLDS`) maps risk levels to minimum trust scores on the **0–1000 scale**, aligned with the tier boundaries defined above. These thresholds determine whether an agent may execute an action of a given risk level.

| Risk Level | Trust Threshold | Tier Alignment | Description |
|------------|:--------------:|----------------|-------------|
| READ       | 0              | Any            | Read-only operations — anyone can perform |
| LOW        | 200            | T1 Observed    | Low-risk modifications |
| MEDIUM     | 400            | T2/T3 boundary | Medium-risk operations |
| HIGH       | 600            | T3 Monitored   | High-risk operations — requires verification |
| CRITICAL   | 800            | T5 Trusted     | Critical operations — requires human approval |

**Scale note:** These thresholds use the same 0–1000 integer scale as trust scores and tier boundaries. Earlier implementations used a 0.0–1.0 fractional scale that was inconsistent with the integer score model; the current values are the corrected canonical thresholds.

**REQ-TRS-012**: Pre-action gate thresholds MUST use the 0–1000 integer scale, matching trust score and tier boundary ranges. Thresholds MUST be configurable per deployment via `PreActionGateConfig.trustThresholds`.

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

## Diminishing Returns in Evidence Aggregation

When multiple evidence records are aggregated for the same factor, a **diminishing returns** weight curve prevents dilution attacks — where an adversary floods many small positive signals to outweigh a single large negative signal.

### Weight Curve

Evidence impacts are sorted by **absolute magnitude** (descending) before weighting. The highest-magnitude signal always receives full weight; subsequent signals receive progressively less.

| Position | Weight | Description |
|----------|:------:|-------------|
| 1st (largest magnitude) | 1.0 | Full impact |
| 2nd | 0.7 | 70% of original impact |
| 3rd | 0.5 | 50% of original impact |
| 4th–10th | 0.2 | 20% of original impact |
| 11th+ | 0.05 | 5% of original impact (near-floor) |

### Aggregation Formula

```
sortedImpacts = sort(evidence.map(e => e.impact), by: |magnitude| descending)
weightedSum   = sum(sortedImpacts[i] × weight(i) for i in 0..N)
```

The weight function `weight(i)` returns the value from the table above for 0-based index `i`. The default curve is exported as `DEFAULT_DIMINISHING_RETURNS` and is configurable via the `DiminishingReturnsWeightFn` type (see [Configurable Diminishing Returns](#configurable-diminishing-returns-weight-function)).

### Attack Mitigation

**Dilution attack scenario:** An adversary sends 20 small positive signals (+1 each) to overwhelm a single large negative signal (−35). Without diminishing returns, the 20 positive signals would sum to +20, offsetting more than half the penalty.

**With diminishing returns:** The −35 negative (largest magnitude) keeps full weight (1.0). The positive signals receive rapidly decreasing weights: +1.0, +0.7, +0.5, then +0.2 each for signals 4–10, then +0.05 each for 11+. The effective positive total drops from +20 to approximately +4.5 — preserving the intended penalty asymmetry.

**REQ-TRS-014**: Evidence aggregation MUST apply diminishing returns by sorting impacts by absolute magnitude (descending) and weighting them with the configured weight function. The default weight curve MUST be `[1.0, 0.7, 0.5, 0.2 (4-10), 0.05 (11+)]`.

### Configurable Diminishing Returns Weight Function

The weight curve is configurable via the `DiminishingReturnsWeightFn` type, which maps a 0-based impact index to a weight in the range `[0.0, 1.0]`. Each `TrustCalculator` instance accepts an optional `diminishingReturns` parameter in its configuration.

```typescript
type DiminishingReturnsWeightFn = (index: number) => number;
```

| Configuration | Description |
|---------------|-------------|
| `diminishingReturns` | Custom weight function passed to `TrustCalculatorConfig`. Overrides the default curve for that calculator instance. |
| `DEFAULT_DIMINISHING_RETURNS` | Exported constant implementing the default `[1.0, 0.7, 0.5, 0.2, 0.05]` curve. Available for reference or composition. |

**Usage example:**

```typescript
import { createTrustCalculator, DEFAULT_DIMINISHING_RETURNS } from '@vorionsys/a3i';

// Stricter curve: only top 3 impacts count meaningfully
const strictCalc = createTrustCalculator({
  diminishingReturns: (i) => i < 3 ? 1.0 : 0.01,
});

// Default curve (equivalent to omitting the option)
const defaultCalc = createTrustCalculator({
  diminishingReturns: DEFAULT_DIMINISHING_RETURNS,
});
```

**REQ-TRS-019**: The diminishing returns weight function MUST be configurable per `TrustCalculator` instance via `TrustCalculatorConfig.diminishingReturns`. The `DEFAULT_DIMINISHING_RETURNS` constant MUST be exported for reuse and composition.

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

### Cross-Methodology Rotation Detection

Same-methodology detection (above) catches repeated failures on a single key. However, an adversary could rotate across **different** methodology keys — failing once on `CT-COMP`, once on `CT-SEC`, once on `CT-REL`, etc. — to stay below the per-key threshold of 3 while accumulating many failures overall. Cross-methodology rotation detection closes this attack vector.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `crossMethodologyFailureThreshold` | 6 | Total failures across **any** methodology keys within the window to trip the circuit breaker |
| `methodologyWindowHours` | 72 | Same rolling window as per-key tracking (3 days) |

**Behavior:**
- Counts all methodology failures across all keys within the rolling `methodologyWindowHours` window
- Fires after the per-key check — if a per-key check already tripped CB, the cross-methodology check is skipped
- Uses the same rolling window and timestamp pruning as per-key tracking
- Circuit breaker reason: `cross_methodology_failure_rotation`
- Admin reset clears all methodology failure history (per-key and cross-key)

**Design rationale:** The default cross-methodology threshold (6) is 2x the per-key threshold (3). This allows genuine multi-factor exploration (failing a few times across different areas while learning) while still catching systematic abuse. An entity that produces 6 failures across any combination of keys within 72 hours is exhibiting a pattern that warrants halting, regardless of whether any single key was repeated 3 times.

**REQ-TRS-013**: When an entity accumulates `crossMethodologyFailureThreshold` total methodology failures across any combination of keys within `methodologyWindowHours`, the circuit breaker MUST trip with reason `cross_methodology_failure_rotation`. This check runs only when the per-key check (REQ-TRS-011) has not already tripped the circuit breaker.

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

## Signal Pipeline Hardening

The `TrustSignalPipeline` bridges the fast lane (`TrustDynamicsEngine`) and slow lane (`TrustProfileService`). The following hardening measures ensure the pipeline operates correctly under concurrency, abuse, and operational stress.

### Per-Agent Serialization

Concurrent signals for the **same agent** are serialized through a per-agent promise chain. Signals for **different agents** run in parallel. This prevents race conditions between the fast-lane read of `adjustedScore` and the slow-lane profile update.

**Problem:** Without serialization, two concurrent signals for the same agent could both read the same `adjustedScore`, compute deltas independently, and write conflicting profile updates — one overwriting the other.

**Solution:** The pipeline maintains a `Map<string, Promise<SignalResult>>` of in-flight processing chains. Each new signal for a given `agentId` chains onto the previous promise, guaranteeing sequential execution. The lock entry is cleaned up when the last signal in the chain completes.

```
Agent A signal 1 ──→ [process] ──→ result
Agent A signal 2 ────────────────→ [process] ──→ result  (queued behind signal 1)
Agent B signal 1 ──→ [process] ──→ result                (parallel with Agent A)
```

**REQ-TRS-015**: The signal pipeline MUST serialize signals for the same `agentId` to prevent concurrent read-modify-write races. Signals for different agents MUST be allowed to run concurrently.

### Resilient Signal Dispatch

The pipeline provides two processing modes:

| Method | Mode | Error Handling | Use Case |
|--------|------|----------------|----------|
| `process(signal)` | Awaited | Caller handles errors via try/catch | Canary probes, API handlers, tests |
| `dispatchSignal(signal)` | Fire-and-forget | Errors routed to `onDispatchError` callback | Gate checks, orchestrator, background updates |

**Problem:** Earlier patterns used `.catch(() => {})` on fire-and-forget calls, silently swallowing errors with no diagnostic trace.

**Solution:** `dispatchSignal()` routes errors to the configurable `onDispatchError(error, signal)` callback. The default handler logs to `console.error` with the agent ID and error details. Deployments can override this to integrate with their error tracking infrastructure (Sentry, Datadog, etc.).

```typescript
const pipeline = createSignalPipeline(dynamics, profiles, {
  onDispatchError: (error, signal) => {
    errorTracker.capture(error, { agentId: signal.agentId });
  },
});

// Errors are captured, not swallowed
pipeline.dispatchSignal({ agentId: 'agent-1', success: true, factorCode: 'CT-COMP' });
```

**REQ-TRS-016**: The signal pipeline MUST provide a `dispatchSignal()` method for fire-and-forget processing. Errors from dispatched signals MUST be routed to the configured `onDispatchError` handler, never silently swallowed.

### Per-Agent Rate Limiting

A sliding-window rate limiter prevents signal flooding — whether from a compromised integration, a runaway loop, or a deliberate abuse attempt. Rate limiting is applied **per agent** so that one agent's activity does not affect others.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rateLimitPerAgent` | 0 (disabled) | Maximum signals per agent within the window. Set to 0 to disable. |
| `rateLimitWindowMs` | 60,000 (1 minute) | Sliding window duration in milliseconds |

**Behavior:**
- When an agent exceeds `rateLimitPerAgent` signals within `rateLimitWindowMs`, subsequent signals are dropped immediately — before any fast-lane or slow-lane processing
- Dropped signals return `blocked: true` with `blockReason: 'rate_limited'`
- The `onBlocked` callback fires for rate-limited signals (see [Audit Trail](#audit-trail))
- Expired timestamps are pruned from the sliding window on each incoming signal
- Rate limit state is per-pipeline instance and not persisted across restarts

**REQ-TRS-017**: The signal pipeline MUST support configurable per-agent rate limiting via `rateLimitPerAgent` and `rateLimitWindowMs`. Rate-limited signals MUST be dropped before processing with `blockReason: 'rate_limited'` and MUST trigger the `onBlocked` callback.

### Audit Trail

All blocked signals — regardless of block reason — are reported via the `onBlocked(BlockedSignalEvent)` callback. This provides a unified forensic audit trail for compliance logging, anomaly detection, and incident investigation.

**Block reasons reported:**

| Block Reason | Trigger | Severity |
|-------------|---------|----------|
| `circuit_breaker` | Hard CB tripped — agent locked until admin reset or auto-reset | Critical |
| `degraded` | Soft CB — gains blocked, losses still apply | Warning |
| `cooldown` | Cooldown active after a loss; gain blocked temporarily | Info |
| `zero_delta` | Delta was 0 (e.g. gain at ceiling) | Debug |
| `rate_limited` | Agent exceeded signal rate limit | Warning |

**BlockedSignalEvent structure:**

```typescript
interface BlockedSignalEvent {
  agentId: string;
  factorCode: string;
  blockReason: 'circuit_breaker' | 'degraded' | 'cooldown' | 'zero_delta' | 'rate_limited';
  timestamp: Date;
  signal: SignalInput;           // The original signal that was blocked
  dynamicsResult?: TrustUpdateResult; // Fast-lane result (absent for rate_limited)
}
```

**Usage:**

```typescript
const pipeline = createSignalPipeline(dynamics, profiles, {
  onBlocked: (event) => {
    auditLog.write({
      type: 'trust_signal_blocked',
      agentId: event.agentId,
      reason: event.blockReason,
      factor: event.factorCode,
      timestamp: event.timestamp,
    });
  },
});
```

**REQ-TRS-018**: The signal pipeline MUST invoke the `onBlocked` callback for every blocked signal, providing the `BlockedSignalEvent` with the original signal, block reason, and timestamp. All five block reasons (`circuit_breaker`, `degraded`, `cooldown`, `zero_delta`, `rate_limited`) MUST be reported.

### Pipeline Metrics and Observability

The `onSignalProcessed(SignalMetrics)` callback fires after every signal completes processing — whether it was blocked or successfully persisted. This provides the raw data needed for dashboards, alerting, and performance monitoring.

**SignalMetrics structure:**

```typescript
interface SignalMetrics {
  agentId: string;
  factorCode: string;
  success: boolean;         // Whether the original signal was a success
  blocked: boolean;         // Whether the signal was blocked
  blockReason?: string;     // Block reason if blocked
  delta: number;            // Score delta (0 if blocked)
  durationMs: number;       // Wall-clock processing time in milliseconds
  timestamp: Date;
}
```

**Observability use cases:**
- **Latency monitoring:** Track `durationMs` to detect slow profile reads or lock contention
- **Block rate dashboards:** Monitor the ratio of blocked to processed signals per agent or globally
- **Throughput alerting:** Track signal volume and detect abnormal spikes
- **Per-factor analysis:** Aggregate deltas by `factorCode` to identify which factors are most active

**Usage:**

```typescript
const pipeline = createSignalPipeline(dynamics, profiles, {
  onSignalProcessed: (metrics) => {
    prometheus.histogram('trust_signal_duration_ms', metrics.durationMs);
    prometheus.counter('trust_signals_total', { blocked: String(metrics.blocked) });
  },
});
```

**REQ-TRS-020**: The signal pipeline MUST invoke the `onSignalProcessed` callback after every signal completes processing. The `SignalMetrics` MUST include `agentId`, `factorCode`, `success`, `blocked`, `blockReason`, `delta`, `durationMs`, and `timestamp`.

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

**REQ-TRS-011**: When an entity accumulates `methodologyFailureThreshold` failures with the same `methodologyKey` within `methodologyWindowHours`, the circuit breaker MUST trip with reason `repeat_methodology_failure:<key>`. No additional penalty multiplier is applied.

**REQ-TRS-012**: Pre-action gate thresholds MUST use the 0-1000 integer scale, matching trust score and tier boundary ranges. Thresholds MUST be configurable per deployment via `PreActionGateConfig.trustThresholds`.

**REQ-TRS-013**: When an entity accumulates `crossMethodologyFailureThreshold` total methodology failures across any combination of keys within `methodologyWindowHours`, the circuit breaker MUST trip with reason `cross_methodology_failure_rotation`. This check runs only when the per-key check (REQ-TRS-011) has not already tripped the circuit breaker.

**REQ-TRS-014**: Evidence aggregation MUST apply diminishing returns by sorting impacts by absolute magnitude (descending) and weighting them with the configured weight function. The default weight curve MUST be `[1.0, 0.7, 0.5, 0.2 (4-10), 0.05 (11+)]`.

**REQ-TRS-015**: The signal pipeline MUST serialize signals for the same `agentId` to prevent concurrent read-modify-write races. Signals for different agents MUST be allowed to run concurrently.

**REQ-TRS-016**: The signal pipeline MUST provide a `dispatchSignal()` method for fire-and-forget processing. Errors from dispatched signals MUST be routed to the configured `onDispatchError` handler, never silently swallowed.

**REQ-TRS-017**: The signal pipeline MUST support configurable per-agent rate limiting via `rateLimitPerAgent` and `rateLimitWindowMs`. Rate-limited signals MUST be dropped before processing with `blockReason: 'rate_limited'` and MUST trigger the `onBlocked` callback.

**REQ-TRS-018**: The signal pipeline MUST invoke the `onBlocked` callback for every blocked signal, providing the `BlockedSignalEvent` with the original signal, block reason, and timestamp. All five block reasons (`circuit_breaker`, `degraded`, `cooldown`, `zero_delta`, `rate_limited`) MUST be reported.

**REQ-TRS-019**: The diminishing returns weight function MUST be configurable per `TrustCalculator` instance via `TrustCalculatorConfig.diminishingReturns`. The `DEFAULT_DIMINISHING_RETURNS` constant MUST be exported for reuse and composition.

**REQ-TRS-020**: The signal pipeline MUST invoke the `onSignalProcessed` callback after every signal completes processing. The `SignalMetrics` MUST include `agentId`, `factorCode`, `success`, `blocked`, `blockReason`, `delta`, `durationMs`, and `timestamp`.
