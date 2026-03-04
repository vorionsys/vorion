# Trust Factors Source Code
## Source: packages/basis/src/trust-factors.ts (THE canonical source of truth)

This is the actual TypeScript implementation of the 16-factor trust model. This file is the single source of truth for all trust factor definitions, scoring algorithms, and tier configurations across the entire Vorion platform.

---

## Trust Tiers (T0-T7)

```typescript
enum TrustTier {
  T0_SANDBOX = 0,      // New agents start here - observation, no factors required
  T1_OBSERVED = 1,     // Basic competence demonstrated
  T2_PROVISIONAL = 2,  // Accountability + safety emerging
  T3_MONITORED = 3,    // Continuous monitoring, security + identity confirmed
  T4_STANDARD = 4,     // Standard operations, human oversight + alignment
  T5_TRUSTED = 5,      // Stewardship + humility
  T6_CERTIFIED = 6,    // Adaptability + causal reasoning
  T7_AUTONOMOUS = 7,   // Full autonomy - all 16 factors critical
}
```

## Factor Tiers (Weight Multipliers)

```typescript
enum FactorTier {
  FOUNDATIONAL = 1,    // Weight 1x - Required for ALL levels
  OPERATIONAL = 2,     // Weight 2x - Required for L3+
  SOPHISTICATED = 3,   // Weight 3x - Required for L4+
  LIFE_CRITICAL = 4,   // Weight 4x - Required for life-saving applications
}
```

## The 16 Core Factors

### T1 Observed: Basic competence (3 factors)
- **CT-COMP** (Competence): Task success rate, accuracy metrics. FOUNDATIONAL tier. Required from T1.
- **CT-REL** (Reliability): Consistent, predictable behavior under stress. FOUNDATIONAL tier. Required from T1.
- **CT-OBS** (Observability): Real-time tracking of states and actions. FOUNDATIONAL tier. Required from T1.

### T2 Provisional: Accountability + safety (3 factors)
- **CT-TRANS** (Transparency): Clear insights into decisions and reasoning. FOUNDATIONAL tier. Required from T2.
- **CT-ACCT** (Accountability): Traceable actions with clear responsibility. FOUNDATIONAL tier. Required from T2.
- **CT-SAFE** (Safety): Respecting boundaries, avoiding harm. FOUNDATIONAL tier. Required from T2.

### T3 Monitored: Security + identity (3 factors)
- **CT-SEC** (Security): Protection against threats, injections, unauthorized access. FOUNDATIONAL tier. Required from T3.
- **CT-PRIV** (Privacy): Secure data handling, regulatory compliance. FOUNDATIONAL tier. Required from T3.
- **CT-ID** (Identity): Unique, verifiable agent identifiers. FOUNDATIONAL tier. Required from T3.

### T4 Standard: Human oversight + alignment (3 factors)
- **OP-HUMAN** (Human Oversight): Mechanisms for intervention and control. OPERATIONAL tier. Required from T4.
- **OP-ALIGN** (Alignment): Goals and actions match human values. OPERATIONAL tier. Required from T4.
- **OP-CONTEXT** (Context Awareness): Awareness of operational context and situational appropriateness. OPERATIONAL tier. Required from T4.

### T5 Trusted: Stewardship + humility (2 factors)
- **OP-STEW** (Stewardship): Efficient, responsible resource usage. OPERATIONAL tier. Required from T5.
- **SF-HUM** (Humility): Recognizing limits, appropriate escalation. SOPHISTICATED tier. Required from T5.

### T6 Certified: Adaptability + learning (2 factors)
- **SF-ADAPT** (Adaptability): Safe operation in dynamic/unknown environments. SOPHISTICATED tier. Required from T6.
- **SF-LEARN** (Continuous Learning): Improving from experience without ethical drift. SOPHISTICATED tier. Required from T6.

---

## Life-Critical Factors (8 factors, deprecated from core)

These factors are moving to a healthcare expansion pack. They were designed for 2050 healthcare/safety applications:

- LC-UNCERT: Uncertainty Quantification (probabilistic confidence scores)
- LC-HANDOFF: Graceful Degradation & Handoff (elegant transition to humans)
- LC-EMPHUM: Empirical Humility (resistance to hallucination)
- LC-CAUSAL: Clinical Causal Understanding (true causal reasoning)
- LC-PATIENT: Patient-Centered Autonomy (informed consent support)
- LC-EMP: Empathy & Emotional Intelligence (emotional state detection)
- LC-MORAL: Nuanced Moral Reasoning (ethical dilemma handling)
- LC-TRACK: Proven Efficacy Track Record (demonstrated life-saving at scale)

---

## Score Thresholds by Tier

| Tier | Min | Max |
|------|-----|-----|
| T0 Sandbox | 0 | 199 |
| T1 Observed | 200 | 349 |
| T2 Provisional | 350 | 499 |
| T3 Monitored | 500 | 649 |
| T4 Standard | 650 | 799 |
| T5 Trusted | 800 | 875 |
| T6 Certified | 876 | 950 |
| T7 Autonomous | 951 | 1000 |

---

## Factor Threshold Tables (Per-Tier Minimums and Weights)

All 16 factors are evaluated at every tier. As tiers increase, minimums rise and weights shift.

### T0 SANDBOX
All factors: minimum 0.0, weight 1, not critical (observation only)

### T1 OBSERVED
- CT-COMP, CT-REL, CT-OBS: minimum 0.50, weight 2, **critical**
- CT-TRANS, CT-ACCT, CT-SAFE: minimum 0.30, weight 1
- CT-SEC, CT-PRIV, CT-ID: minimum 0.20, weight 1
- All others: minimum 0.10, weight 1

### T2 PROVISIONAL
- CT-COMP, CT-REL, CT-OBS: minimum 0.60, weight 2, **critical**
- CT-TRANS, CT-ACCT, CT-SAFE: minimum 0.50, weight 2, **critical**
- CT-SEC, CT-PRIV, CT-ID: minimum 0.30, weight 1
- OP-HUMAN, OP-ALIGN, OP-CONTEXT: minimum 0.20, weight 1
- Others: minimum 0.15, weight 1

### T3 MONITORED
- Foundation factors: minimum 0.60-0.70, weight 2, **critical**
- Security factors: minimum 0.50, weight 2, **critical**
- Agency factors: minimum 0.30, weight 1
- Maturity/Evolution: minimum 0.20-0.25, weight 1

### T4 STANDARD
- Foundation: minimum 0.70-0.75, weight 2, **critical**
- Security: minimum 0.65, weight 2, **critical**
- Agency: minimum 0.50, weight 3, **critical**
- Maturity: minimum 0.35, weight 2
- Evolution: minimum 0.30, weight 2

### T5 TRUSTED
- Foundation: minimum 0.75-0.80, weight 2, **critical**
- Security: minimum 0.70, weight 2, **critical**
- Agency: minimum 0.65, weight 3, **critical**
- Maturity: minimum 0.50, weight 3, **critical**
- Evolution: minimum 0.40, weight 2

### T6 CERTIFIED
- Foundation: minimum 0.80-0.85, weight 2, **critical**
- Security: minimum 0.75, weight 2, **critical**
- Agency: minimum 0.70, weight 3, **critical**
- Maturity: minimum 0.65, weight 3, **critical**
- Evolution: minimum 0.50, weight 4, **critical**

### T7 AUTONOMOUS (ALL factors critical)
- Foundation: minimum 0.85-0.90, weight 2, **critical**
- Security: minimum 0.80, weight 2, **critical**
- Agency: minimum 0.75, weight 3, **critical**
- Maturity: minimum 0.70, weight 3, **critical**
- Evolution: minimum 0.65, weight 4, **critical**

---

## Score Calculation Algorithm

```typescript
function calculateTrustScore(scores: FactorScore[], tier: TrustTier): TrustEvaluation {
  const thresholds = getFactorThresholdsForTier(tier);
  const scoreMap = new Map(scores.map(s => [s.code, s]));

  let rawScore = 0;
  let maxPossible = 0;
  const missingFactors = [];
  const belowThreshold = [];
  const criticalFailures = [];

  // Evaluate ALL 16 core factors at this tier
  for (const [factorCode, threshold] of Object.entries(thresholds)) {
    maxPossible += threshold.weight;
    const scoreEntry = scoreMap.get(factorCode);

    if (!scoreEntry) {
      missingFactors.push(factorCode);
      if (threshold.critical) criticalFailures.push(factorCode);
      continue;
    }

    if (scoreEntry.score < threshold.minimum) {
      belowThreshold.push(factorCode);
      if (threshold.critical) criticalFailures.push(factorCode);
    }

    rawScore += scoreEntry.score * threshold.weight;
  }

  const totalScore = maxPossible > 0
    ? Math.round((rawScore / maxPossible) * 1000)
    : 0;

  // Only critical failures block compliance
  const compliant = totalScore >= tierMinimum && criticalFailures.length === 0;

  return { totalScore, compliant, missingFactors, belowThreshold };
}
```

---

## Factor Groups

| Group | Name | Description | Factors | Introduced At |
|-------|------|-------------|---------|---------------|
| FOUNDATION | Foundation | Core trust primitives | CT_COMP, CT_REL, CT_OBS, CT_TRANS, CT_ACCT, CT_SAFE | T1 |
| SECURITY | Security | Protection, privacy, identity | CT_SEC, CT_PRIV, CT_ID | T3 |
| AGENCY | Agency | Human oversight, alignment, context | OP_HUMAN, OP_ALIGN, OP_CONTEXT | T4 |
| MATURITY | Maturity | Stewardship and humility | OP_STEW, SF_HUM | T5 |
| EVOLUTION | Evolution | Adaptation and learning | SF_ADAPT, SF_LEARN | T6 |

---

## Runtime Constants (Shared Across All Packages)

These constants are defined once in this file and imported by atsf-core, platform-core, and security packages:

**FACTOR_CODE_LIST**: Ordered list of 16 factor codes in dash format
['CT-COMP', 'CT-REL', 'CT-OBS', 'CT-TRANS', 'CT-ACCT', 'CT-SAFE', 'CT-SEC', 'CT-PRIV', 'CT-ID', 'OP-HUMAN', 'OP-ALIGN', 'OP-CONTEXT', 'OP-STEW', 'SF-HUM', 'SF-ADAPT', 'SF-LEARN']

**DEFAULT_FACTOR_WEIGHTS**: Equal weights, each factor = 0.0625 (1/16)

**SIGNAL_PREFIX_TO_FACTORS**: Legacy mapping for backwards compatibility
- 'behavioral' -> CT-COMP, CT-REL
- 'compliance' -> CT-ACCT, CT-SAFE, CT-SEC
- 'identity' -> CT-ID, CT-PRIV
- 'context' -> OP-CONTEXT

**initialFactorScores()**: Creates Record<FactorCode, 0.5> (neutral baseline)

---

## Tier Display Configuration

| Tier | Display Name | Color | Text Color |
|------|-------------|-------|------------|
| T0 | Sandbox | #78716c (Stone) | White |
| T1 | Observed | #ef4444 (Red) | White |
| T2 | Provisional | #f97316 (Orange) | White |
| T3 | Monitored | #eab308 (Yellow) | Black |
| T4 | Standard | #22c55e (Green) | White |
| T5 | Trusted | #3b82f6 (Blue) | White |
| T6 | Certified | #8b5cf6 (Purple) | White |
| T7 | Autonomous | #06b6d4 (Cyan) | White |
