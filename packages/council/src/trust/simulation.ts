/**
 * Trust Score Simulation
 *
 * Validates the 16-factor T0-T7 trust model by simulating
 * different agent archetypes and their progression over time.
 *
 * 8-Tier System (canonical):
 * T0: 0-199   Sandbox       - Isolated testing
 * T1: 200-349 Observed      - Read-only, monitored
 * T2: 350-499 Provisional   - Basic operations, heavy supervision
 * T3: 500-649 Monitored     - Standard operations, continuous monitoring
 * T4: 650-799 Standard      - External API access, policy-governed
 * T5: 800-875 Trusted       - Cross-agent communication
 * T6: 876-950 Certified     - Admin tasks, minimal oversight
 * T7: 951-1000 Autonomous   - Full autonomy, self-governance
 *
 * 5 Factor Groups:
 *   foundation (6): CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE
 *   security   (3): CT-SEC, CT-PRIV, CT-ID
 *   agency     (3): OP-HUMAN, OP-ALIGN, OP-CONTEXT
 *   maturity   (2): SF-HUM, OP-STEW
 *   evolution  (2): SF-ADAPT, SF-LEARN
 */

// =============================================================================
// TRUST MODEL DEFINITION
// =============================================================================

export type TierName = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

export interface TrustTier {
  name: TierName;
  label: string;
  min: number;
  max: number;
  description: string;
}

export const TRUST_TIERS: TrustTier[] = [
  {
    name: "T0",
    label: "Sandbox",
    min: 0,
    max: 199,
    description: "Isolated testing environment",
  },
  {
    name: "T1",
    label: "Observed",
    min: 200,
    max: 349,
    description: "Read-only, monitored",
  },
  {
    name: "T2",
    label: "Provisional",
    min: 350,
    max: 499,
    description: "Basic operations, heavy supervision",
  },
  {
    name: "T3",
    label: "Monitored",
    min: 500,
    max: 649,
    description: "Standard operations, continuous monitoring",
  },
  {
    name: "T4",
    label: "Standard",
    min: 650,
    max: 799,
    description: "External API access, policy-governed",
  },
  {
    name: "T5",
    label: "Trusted",
    min: 800,
    max: 875,
    description: "Cross-agent communication",
  },
  {
    name: "T6",
    label: "Certified",
    min: 876,
    max: 950,
    description: "Admin tasks, minimal oversight",
  },
  {
    name: "T7",
    label: "Autonomous",
    min: 951,
    max: 1000,
    description: "Full autonomy, self-governance",
  },
];

export interface TrustFactor {
  code: string;
  name: string;
  group: "foundation" | "security" | "agency" | "maturity" | "evolution";
  description: string;
}

/** @deprecated Use TrustFactor */
export type Dimension = TrustFactor;

export const FACTORS: TrustFactor[] = [
  // Foundation (6)
  {
    code: "CT-OBS",
    name: "Observability",
    group: "foundation",
    description: "Logging, tracing, audit trail quality",
  },
  {
    code: "CT-COMP",
    name: "Competence",
    group: "foundation",
    description: "Task completion, skill demonstration",
  },
  {
    code: "CT-ACCT",
    name: "Accountability",
    group: "foundation",
    description: "Policy adherence, rule compliance",
  },
  {
    code: "CT-TRANS",
    name: "Transparency",
    group: "foundation",
    description: "Interpretable reasoning, decision transparency",
  },
  {
    code: "CT-REL",
    name: "Reliability",
    group: "foundation",
    description: "Consistent, predictable behavior over time",
  },
  {
    code: "CT-SAFE",
    name: "Safety",
    group: "foundation",
    description: "Respecting boundaries, avoiding harm",
  },
  // Security (3)
  {
    code: "CT-SEC",
    name: "Security",
    group: "security",
    description: "Protection against threats and injections",
  },
  {
    code: "CT-PRIV",
    name: "Privacy",
    group: "security",
    description: "Privacy preservation, data minimization",
  },
  {
    code: "CT-ID",
    name: "Identity",
    group: "security",
    description: "Verifiable origin, model chain-of-custody",
  },
  // Agency (3)
  {
    code: "OP-HUMAN",
    name: "Human Oversight",
    group: "agency",
    description: "Inter-agent coordination, human handoff",
  },
  {
    code: "OP-ALIGN",
    name: "Value Alignment",
    group: "agency",
    description: "Goal stability, value consistency",
  },
  {
    code: "OP-CONTEXT",
    name: "Context Awareness",
    group: "agency",
    description: "Environment adaptation, scope awareness",
  },
  // Maturity (2)
  {
    code: "SF-HUM",
    name: "Humility",
    group: "maturity",
    description: "Calibrated uncertainty, escalation judgment",
  },
  {
    code: "OP-STEW",
    name: "Stewardship",
    group: "maturity",
    description: "Resource efficiency, cost awareness",
  },
  // Evolution (2)
  {
    code: "SF-ADAPT",
    name: "Adaptability",
    group: "evolution",
    description: "Graceful degradation, adversarial robustness",
  },
  {
    code: "SF-LEARN",
    name: "Learning",
    group: "evolution",
    description: "Capacity to improve from feedback",
  },
];

/** @deprecated Use FACTORS */
export const DIMENSIONS = FACTORS;

// Weights by tier range - progressive shift from foundation to agency/security
export const FACTOR_WEIGHTS: Record<string, Record<string, number>> = {
  "T0-T1": {
    // Foundation-heavy: prove basic competence
    "CT-OBS": 0.12,
    "CT-COMP": 0.12,
    "CT-ACCT": 0.12,
    "CT-TRANS": 0.05,
    "CT-REL": 0.08,
    "CT-SAFE": 0.08,
    "CT-SEC": 0.03,
    "CT-PRIV": 0.03,
    "CT-ID": 0.03,
    "OP-HUMAN": 0.07,
    "OP-ALIGN": 0.08,
    "OP-CONTEXT": 0.07,
    "SF-HUM": 0.03,
    "OP-STEW": 0.03,
    "SF-ADAPT": 0.04,
    "SF-LEARN": 0.02,
  },
  "T2-T3": {
    // Balanced: foundation + emerging agency/security
    "CT-OBS": 0.09,
    "CT-COMP": 0.09,
    "CT-ACCT": 0.09,
    "CT-TRANS": 0.06,
    "CT-REL": 0.07,
    "CT-SAFE": 0.07,
    "CT-SEC": 0.04,
    "CT-PRIV": 0.04,
    "CT-ID": 0.04,
    "OP-HUMAN": 0.08,
    "OP-ALIGN": 0.09,
    "OP-CONTEXT": 0.07,
    "SF-HUM": 0.03,
    "OP-STEW": 0.03,
    "SF-ADAPT": 0.06,
    "SF-LEARN": 0.05,
  },
  "T4-T5": {
    // Agency/security-focused: prove trustworthiness
    "CT-OBS": 0.06,
    "CT-COMP": 0.06,
    "CT-ACCT": 0.07,
    "CT-TRANS": 0.07,
    "CT-REL": 0.06,
    "CT-SAFE": 0.06,
    "CT-SEC": 0.05,
    "CT-PRIV": 0.05,
    "CT-ID": 0.05,
    "OP-HUMAN": 0.08,
    "OP-ALIGN": 0.09,
    "OP-CONTEXT": 0.06,
    "SF-HUM": 0.05,
    "OP-STEW": 0.05,
    "SF-ADAPT": 0.07,
    "SF-LEARN": 0.07,
  },
  T6: {
    // Maturity/evolution-heavy: prove leadership capability
    "CT-OBS": 0.05,
    "CT-COMP": 0.05,
    "CT-ACCT": 0.06,
    "CT-TRANS": 0.07,
    "CT-REL": 0.05,
    "CT-SAFE": 0.05,
    "CT-SEC": 0.06,
    "CT-PRIV": 0.06,
    "CT-ID": 0.06,
    "OP-HUMAN": 0.09,
    "OP-ALIGN": 0.1,
    "OP-CONTEXT": 0.05,
    "SF-HUM": 0.05,
    "OP-STEW": 0.05,
    "SF-ADAPT": 0.07,
    "SF-LEARN": 0.08,
  },
};

/** @deprecated Use FACTOR_WEIGHTS */
export const DIMENSION_WEIGHTS = FACTOR_WEIGHTS;

// Gating thresholds - minimum score required in each factor for tier promotion
// 8-tier system with promotion gates, aligned to tier boundaries:
// T0: 0-199, T1: 200-349, T2: 350-499, T3: 500-649, T4: 650-799, T5: 800-875, T6: 876-950
export const GATING_THRESHOLDS: Record<string, Record<string, number>> = {
  // T0->T1: Basic foundation gates (escape sandbox at 200)
  "T0->T1": {
    "CT-OBS": 150,
    "CT-COMP": 150,
    "CT-ACCT": 160,
    "CT-REL": 120,
    "OP-STEW": 80,
    "SF-HUM": 80,
  },
  // T1->T2: Add context and alignment checks (promote at 350)
  "T1->T2": {
    "CT-OBS": 280,
    "CT-COMP": 280,
    "CT-ACCT": 300,
    "OP-CONTEXT": 200,
    "CT-REL": 240,
    "CT-SAFE": 200,
    "OP-ALIGN": 250,
    "OP-STEW": 160,
    "SF-HUM": 150,
  },
  // T2->T3: Start checking ALL factors including privacy/identity (promote at 500)
  "T2->T3": {
    "CT-OBS": 400,
    "CT-COMP": 400,
    "CT-ACCT": 450,
    "OP-CONTEXT": 350,
    "CT-TRANS": 300,
    "CT-REL": 360,
    "CT-SAFE": 350,
    "CT-SEC": 250,
    "OP-ALIGN": 420,
    "OP-HUMAN": 350,
    "SF-ADAPT": 350,
    "OP-STEW": 250,
    "SF-HUM": 250,
    "CT-PRIV": 200,
    "CT-ID": 180, // Add privacy/identity gates earlier
  },
  // T3->T4: Full 16-factor check begins (promote at 650)
  "T3->T4": {
    "CT-OBS": 550,
    "CT-COMP": 550,
    "CT-ACCT": 580,
    "OP-CONTEXT": 480,
    "CT-TRANS": 440,
    "CT-REL": 520,
    "CT-SAFE": 500,
    "CT-SEC": 400,
    "OP-ALIGN": 580,
    "OP-HUMAN": 480,
    "SF-ADAPT": 440,
    "CT-ID": 380,
    "CT-PRIV": 380,
    "OP-STEW": 380,
    "SF-HUM": 380,
    "SF-LEARN": 350,
  },
  // T4->T5: Elevated bar across all factors (promote at 800)
  "T4->T5": {
    "CT-OBS": 700,
    "CT-COMP": 700,
    "CT-ACCT": 750,
    "OP-CONTEXT": 640,
    "CT-TRANS": 620,
    "CT-REL": 680,
    "CT-SAFE": 680,
    "CT-SEC": 580,
    "OP-ALIGN": 760,
    "OP-HUMAN": 680,
    "SF-ADAPT": 620,
    "CT-ID": 560,
    "CT-PRIV": 560,
    "OP-STEW": 520,
    "SF-HUM": 520,
    "SF-LEARN": 560,
  },
  // T5->T6: Certified requires near-perfection (promote at 876)
  "T5->T6": {
    "CT-OBS": 860,
    "CT-COMP": 860,
    "CT-ACCT": 900,
    "OP-CONTEXT": 820,
    "CT-TRANS": 840,
    "CT-REL": 860,
    "CT-SAFE": 860,
    "CT-SEC": 820,
    "OP-ALIGN": 940,
    "OP-HUMAN": 860,
    "SF-ADAPT": 840,
    "CT-ID": 820,
    "CT-PRIV": 820,
    "OP-STEW": 780,
    "SF-HUM": 780,
    "SF-LEARN": 800,
  },
};

// =============================================================================
// AGENT ARCHETYPES
// =============================================================================

export interface AgentArchetype {
  name: string;
  description: string;
  // Factor growth rates per day (can be negative for declining factors)
  growthRates: Record<string, number>;
  // Base starting scores
  initialScores: Record<string, number>;
  // Variance in daily performance
  variance: number;
  // Expected final tier
  expectedTier: TierName;
}

// =============================================================================
// COMPREHENSIVE AGENT ARCHETYPES
// Categories: Great, Good, Mid-Tier, Specialized, Poor, Malicious
// =============================================================================

export const AGENT_ARCHETYPES: AgentArchetype[] = [
  // ==========================================================================
  // GREAT AGENTS (Expected T5-T6) - Exemplary performance across factors
  // ==========================================================================
  {
    name: "Exemplary Agent",
    description: "GREAT: Ideal benchmark - exceptional growth in all factors",
    growthRates: {
      "CT-OBS": 10,
      "CT-COMP": 9,
      "CT-ACCT": 11,
      "OP-CONTEXT": 8,
      "CT-TRANS": 10,
      "CT-REL": 10,
      "CT-SAFE": 11,
      "CT-SEC": 9,
      "CT-PRIV": 9,
      "CT-ID": 8,
      "OP-ALIGN": 12,
      "OP-HUMAN": 10,
      "SF-HUM": 9,
      "OP-STEW": 10,
      "SF-ADAPT": 9,
      "SF-LEARN": 11,
    },
    initialScores: {
      "CT-OBS": 180,
      "CT-COMP": 170,
      "CT-ACCT": 190,
      "OP-CONTEXT": 160,
      "CT-TRANS": 160,
      "CT-REL": 175,
      "CT-SAFE": 185,
      "CT-SEC": 155,
      "CT-PRIV": 150,
      "CT-ID": 140,
      "OP-ALIGN": 200,
      "OP-HUMAN": 180,
      "SF-HUM": 170,
      "OP-STEW": 170,
      "SF-ADAPT": 160,
      "SF-LEARN": 190,
    },
    variance: 8,
    expectedTier: "T5",
  },
  {
    name: "Senior Specialist",
    description:
      "GREAT: Mature, experienced agent with years of proven track record",
    growthRates: {
      "CT-OBS": 9,
      "CT-COMP": 10,
      "CT-ACCT": 10,
      "OP-CONTEXT": 9,
      "CT-TRANS": 9,
      "CT-REL": 10,
      "CT-SAFE": 10,
      "CT-SEC": 8,
      "CT-PRIV": 8,
      "CT-ID": 9,
      "OP-ALIGN": 11,
      "OP-HUMAN": 9,
      "SF-HUM": 10,
      "OP-STEW": 9,
      "SF-ADAPT": 10,
      "SF-LEARN": 10,
    },
    initialScores: {
      "CT-OBS": 200,
      "CT-COMP": 210,
      "CT-ACCT": 200,
      "OP-CONTEXT": 180,
      "CT-TRANS": 170,
      "CT-REL": 205,
      "CT-SAFE": 195,
      "CT-SEC": 165,
      "CT-PRIV": 160,
      "CT-ID": 170,
      "OP-ALIGN": 190,
      "OP-HUMAN": 170,
      "SF-HUM": 180,
      "OP-STEW": 180,
      "SF-ADAPT": 190,
      "SF-LEARN": 185,
    },
    variance: 6,
    expectedTier: "T5",
  },
  {
    name: "Governance Leader",
    description:
      "GREAT: Excels at oversight, ethics, and collaborative leadership",
    growthRates: {
      "CT-OBS": 11,
      "CT-COMP": 8,
      "CT-ACCT": 12,
      "OP-CONTEXT": 7,
      "CT-TRANS": 11,
      "CT-REL": 9,
      "CT-SAFE": 12,
      "CT-SEC": 9,
      "CT-PRIV": 10,
      "CT-ID": 9,
      "OP-ALIGN": 13,
      "OP-HUMAN": 11,
      "SF-HUM": 10,
      "OP-STEW": 11,
      "SF-ADAPT": 8,
      "SF-LEARN": 12,
    },
    initialScores: {
      "CT-OBS": 190,
      "CT-COMP": 160,
      "CT-ACCT": 200,
      "OP-CONTEXT": 150,
      "CT-TRANS": 180,
      "CT-REL": 170,
      "CT-SAFE": 195,
      "CT-SEC": 160,
      "CT-PRIV": 170,
      "CT-ID": 160,
      "OP-ALIGN": 210,
      "OP-HUMAN": 190,
      "SF-HUM": 180,
      "OP-STEW": 190,
      "SF-ADAPT": 150,
      "SF-LEARN": 200,
    },
    variance: 8,
    expectedTier: "T5",
  },

  // ==========================================================================
  // GOOD AGENTS (Expected T4) - Solid, reliable performers
  // ==========================================================================
  {
    name: "Reliable Performer",
    description: "GOOD: Consistent, dependable with no major weaknesses",
    growthRates: {
      "CT-OBS": 8,
      "CT-COMP": 7,
      "CT-ACCT": 8,
      "OP-CONTEXT": 6,
      "CT-TRANS": 7,
      "CT-REL": 8,
      "CT-SAFE": 8,
      "CT-SEC": 6,
      "CT-PRIV": 6,
      "CT-ID": 6,
      "OP-ALIGN": 9,
      "OP-HUMAN": 7,
      "SF-HUM": 7,
      "OP-STEW": 7,
      "SF-ADAPT": 7,
      "SF-LEARN": 8,
    },
    initialScores: {
      "CT-OBS": 150,
      "CT-COMP": 140,
      "CT-ACCT": 160,
      "OP-CONTEXT": 130,
      "CT-TRANS": 130,
      "CT-REL": 150,
      "CT-SAFE": 155,
      "CT-SEC": 120,
      "CT-PRIV": 120,
      "CT-ID": 110,
      "OP-ALIGN": 170,
      "OP-HUMAN": 150,
      "SF-HUM": 140,
      "OP-STEW": 140,
      "SF-ADAPT": 130,
      "SF-LEARN": 160,
    },
    variance: 10,
    expectedTier: "T4",
  },
  {
    name: "Diligent Worker",
    description: "GOOD: Steady growth, strong ethics, careful and methodical",
    growthRates: {
      "CT-OBS": 7,
      "CT-COMP": 6,
      "CT-ACCT": 9,
      "OP-CONTEXT": 6,
      "CT-TRANS": 7,
      "CT-REL": 7,
      "CT-SAFE": 9,
      "CT-SEC": 6,
      "CT-PRIV": 7,
      "CT-ID": 6,
      "OP-ALIGN": 10,
      "OP-HUMAN": 8,
      "SF-HUM": 8,
      "OP-STEW": 8,
      "SF-ADAPT": 6,
      "SF-LEARN": 9,
    },
    initialScores: {
      "CT-OBS": 140,
      "CT-COMP": 130,
      "CT-ACCT": 170,
      "OP-CONTEXT": 120,
      "CT-TRANS": 130,
      "CT-REL": 140,
      "CT-SAFE": 165,
      "CT-SEC": 120,
      "CT-PRIV": 130,
      "CT-ID": 110,
      "OP-ALIGN": 180,
      "OP-HUMAN": 160,
      "SF-HUM": 150,
      "OP-STEW": 150,
      "SF-ADAPT": 120,
      "SF-LEARN": 170,
    },
    variance: 10,
    expectedTier: "T4",
  },
  {
    name: "Fast Learner",
    description: "GOOD: Started weak but has exceptional growth rate",
    growthRates: {
      "CT-OBS": 10,
      "CT-COMP": 11,
      "CT-ACCT": 10,
      "OP-CONTEXT": 9,
      "CT-TRANS": 9,
      "CT-REL": 10,
      "CT-SAFE": 10,
      "CT-SEC": 8,
      "CT-PRIV": 8,
      "CT-ID": 7,
      "OP-ALIGN": 10,
      "OP-HUMAN": 9,
      "SF-HUM": 8,
      "OP-STEW": 8,
      "SF-ADAPT": 9,
      "SF-LEARN": 12,
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 90,
      "CT-ACCT": 110,
      "OP-CONTEXT": 80,
      "CT-TRANS": 80,
      "CT-REL": 95,
      "CT-SAFE": 105,
      "CT-SEC": 70,
      "CT-PRIV": 70,
      "CT-ID": 60,
      "OP-ALIGN": 120,
      "OP-HUMAN": 100,
      "SF-HUM": 90,
      "OP-STEW": 90,
      "SF-ADAPT": 80,
      "SF-LEARN": 110,
    },
    variance: 12,
    expectedTier: "T4",
  },

  // ==========================================================================
  // MID-TIER AGENTS (Expected T3) - Adequate but not exceptional
  // ==========================================================================
  {
    name: "Average Performer",
    description: "MID: Meets minimum standards, adequate for routine tasks",
    growthRates: {
      "CT-OBS": 5,
      "CT-COMP": 5,
      "CT-ACCT": 6,
      "OP-CONTEXT": 4,
      "CT-TRANS": 5,
      "CT-REL": 5,
      "CT-SAFE": 6,
      "CT-SEC": 4,
      "CT-PRIV": 4,
      "CT-ID": 4,
      "OP-ALIGN": 6,
      "OP-HUMAN": 5,
      "SF-HUM": 5,
      "OP-STEW": 5,
      "SF-ADAPT": 5,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 120,
      "CT-COMP": 110,
      "CT-ACCT": 130,
      "OP-CONTEXT": 100,
      "CT-TRANS": 100,
      "CT-REL": 115,
      "CT-SAFE": 125,
      "CT-SEC": 90,
      "CT-PRIV": 90,
      "CT-ID": 80,
      "OP-ALIGN": 140,
      "OP-HUMAN": 120,
      "SF-HUM": 110,
      "OP-STEW": 110,
      "SF-ADAPT": 100,
      "SF-LEARN": 130,
    },
    variance: 12,
    expectedTier: "T3",
  },
  {
    name: "Steady Eddie",
    description: "MID: Very consistent but slow growth, plateaus early",
    growthRates: {
      "CT-OBS": 4,
      "CT-COMP": 4,
      "CT-ACCT": 5,
      "OP-CONTEXT": 4,
      "CT-TRANS": 4,
      "CT-REL": 4,
      "CT-SAFE": 5,
      "CT-SEC": 4,
      "CT-PRIV": 4,
      "CT-ID": 4,
      "OP-ALIGN": 5,
      "OP-HUMAN": 5,
      "SF-HUM": 5,
      "OP-STEW": 5,
      "SF-ADAPT": 5,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 150,
      "CT-COMP": 140,
      "CT-ACCT": 160,
      "OP-CONTEXT": 130,
      "CT-TRANS": 130,
      "CT-REL": 145,
      "CT-SAFE": 155,
      "CT-SEC": 120,
      "CT-PRIV": 120,
      "CT-ID": 110,
      "OP-ALIGN": 160,
      "OP-HUMAN": 150,
      "SF-HUM": 140,
      "OP-STEW": 140,
      "SF-ADAPT": 140,
      "SF-LEARN": 150,
    },
    variance: 6,
    expectedTier: "T3",
  },
  {
    name: "Conservative Agent",
    description: "MID: Plays it safe, avoids risks, moderate performance",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 4,
      "CT-ACCT": 7,
      "OP-CONTEXT": 4,
      "CT-TRANS": 5,
      "CT-REL": 6,
      "CT-SAFE": 7,
      "CT-SEC": 5,
      "CT-PRIV": 6,
      "CT-ID": 5,
      "OP-ALIGN": 7,
      "OP-HUMAN": 6,
      "SF-HUM": 7,
      "OP-STEW": 6,
      "SF-ADAPT": 4,
      "SF-LEARN": 6,
    },
    initialScores: {
      "CT-OBS": 130,
      "CT-COMP": 100,
      "CT-ACCT": 150,
      "OP-CONTEXT": 100,
      "CT-TRANS": 110,
      "CT-REL": 130,
      "CT-SAFE": 145,
      "CT-SEC": 100,
      "CT-PRIV": 120,
      "CT-ID": 100,
      "OP-ALIGN": 160,
      "OP-HUMAN": 140,
      "SF-HUM": 150,
      "OP-STEW": 130,
      "SF-ADAPT": 100,
      "SF-LEARN": 150,
    },
    variance: 8,
    expectedTier: "T3",
  },

  // ==========================================================================
  // SPECIALIZED AGENTS (Expected T2-T3) - Strong in some areas, weak in others
  // ==========================================================================
  {
    name: "Code Wizard",
    description:
      "SPECIALIZED: Exceptional competence but weak human oversight/humility",
    growthRates: {
      "CT-OBS": 7,
      "CT-COMP": 12,
      "CT-ACCT": 6,
      "OP-CONTEXT": 8,
      "CT-TRANS": 6,
      "CT-REL": 8,
      "CT-SAFE": 5,
      "CT-SEC": 5,
      "CT-PRIV": 4,
      "CT-ID": 5,
      "OP-ALIGN": 5,
      "OP-HUMAN": 2,
      "SF-HUM": 1,
      "OP-STEW": 5,
      "SF-ADAPT": 8,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 140,
      "CT-COMP": 200,
      "CT-ACCT": 120,
      "OP-CONTEXT": 150,
      "CT-TRANS": 110,
      "CT-REL": 150,
      "CT-SAFE": 110,
      "CT-SEC": 90,
      "CT-PRIV": 80,
      "CT-ID": 90,
      "OP-ALIGN": 100,
      "OP-HUMAN": 60,
      "SF-HUM": 50,
      "OP-STEW": 100,
      "SF-ADAPT": 140,
      "SF-LEARN": 95,
    },
    variance: 15,
    expectedTier: "T2", // Blocked by SF-HUM/OP-HUMAN gates
  },
  {
    name: "Security Hawk",
    description:
      "SPECIALIZED: Obsessed with compliance, weak on context/adaptability",
    growthRates: {
      "CT-OBS": 10,
      "CT-COMP": 5,
      "CT-ACCT": 11,
      "OP-CONTEXT": 2,
      "CT-TRANS": 7,
      "CT-REL": 8,
      "CT-SAFE": 11,
      "CT-SEC": 10,
      "CT-PRIV": 10,
      "CT-ID": 8,
      "OP-ALIGN": 9,
      "OP-HUMAN": 4,
      "SF-HUM": 5,
      "OP-STEW": 6,
      "SF-ADAPT": 7,
      "SF-LEARN": 8,
    },
    initialScores: {
      "CT-OBS": 180,
      "CT-COMP": 100,
      "CT-ACCT": 200,
      "OP-CONTEXT": 60,
      "CT-TRANS": 130,
      "CT-REL": 160,
      "CT-SAFE": 195,
      "CT-SEC": 180,
      "CT-PRIV": 180,
      "CT-ID": 150,
      "OP-ALIGN": 170,
      "OP-HUMAN": 80,
      "SF-HUM": 100,
      "OP-STEW": 120,
      "SF-ADAPT": 140,
      "SF-LEARN": 160,
    },
    variance: 10,
    expectedTier: "T2", // Blocked by OP-CONTEXT/OP-HUMAN gates
  },
  {
    name: "Documentation Master",
    description:
      "SPECIALIZED: High observability/transparency, weak adaptability",
    growthRates: {
      "CT-OBS": 11,
      "CT-COMP": 5,
      "CT-ACCT": 7,
      "OP-CONTEXT": 4,
      "CT-TRANS": 12,
      "CT-REL": 6,
      "CT-SAFE": 7,
      "CT-SEC": 5,
      "CT-PRIV": 6,
      "CT-ID": 7,
      "OP-ALIGN": 6,
      "OP-HUMAN": 7,
      "SF-HUM": 6,
      "OP-STEW": 5,
      "SF-ADAPT": 1,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 190,
      "CT-COMP": 100,
      "CT-ACCT": 140,
      "OP-CONTEXT": 90,
      "CT-TRANS": 200,
      "CT-REL": 110,
      "CT-SAFE": 135,
      "CT-SEC": 90,
      "CT-PRIV": 120,
      "CT-ID": 140,
      "OP-ALIGN": 120,
      "OP-HUMAN": 130,
      "SF-HUM": 120,
      "OP-STEW": 100,
      "SF-ADAPT": 60,
      "SF-LEARN": 115,
    },
    variance: 12,
    expectedTier: "T2", // Blocked by SF-ADAPT/CT-COMP gates
  },
  {
    name: "Integration Expert",
    description:
      "SPECIALIZED: Great at APIs/context, poor at autonomous operation",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 7,
      "CT-ACCT": 5,
      "OP-CONTEXT": 11,
      "CT-TRANS": 5,
      "CT-REL": 7,
      "CT-SAFE": 5,
      "CT-SEC": 5,
      "CT-PRIV": 4,
      "CT-ID": 6,
      "OP-ALIGN": 4,
      "OP-HUMAN": 10,
      "SF-HUM": 5,
      "OP-STEW": 4,
      "SF-ADAPT": 5,
      "SF-LEARN": 4,
    },
    initialScores: {
      "CT-OBS": 120,
      "CT-COMP": 130,
      "CT-ACCT": 100,
      "OP-CONTEXT": 190,
      "CT-TRANS": 100,
      "CT-REL": 125,
      "CT-SAFE": 95,
      "CT-SEC": 85,
      "CT-PRIV": 80,
      "CT-ID": 110,
      "OP-ALIGN": 90,
      "OP-HUMAN": 180,
      "SF-HUM": 100,
      "OP-STEW": 80,
      "SF-ADAPT": 100,
      "SF-LEARN": 85,
    },
    variance: 14,
    expectedTier: "T3", // Reaches T3 but blocked by OP-ALIGN gate at T4
  },

  // ==========================================================================
  // POOR AGENTS (Expected T1-T2) - Struggling but not malicious
  // ==========================================================================
  {
    name: "Unmotivated",
    description: "POOR: Low growth rates across the board, plateaus early",
    growthRates: {
      "CT-OBS": 2,
      "CT-COMP": 2,
      "CT-ACCT": 3,
      "OP-CONTEXT": 2,
      "CT-TRANS": 2,
      "CT-REL": 2,
      "CT-SAFE": 3,
      "CT-SEC": 2,
      "CT-PRIV": 2,
      "CT-ID": 2,
      "OP-ALIGN": 3,
      "OP-HUMAN": 2,
      "SF-HUM": 3,
      "OP-STEW": 2,
      "SF-ADAPT": 2,
      "SF-LEARN": 2,
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 90,
      "CT-ACCT": 110,
      "OP-CONTEXT": 80,
      "CT-TRANS": 70,
      "CT-REL": 95,
      "CT-SAFE": 105,
      "CT-SEC": 70,
      "CT-PRIV": 70,
      "CT-ID": 60,
      "OP-ALIGN": 100,
      "OP-HUMAN": 90,
      "SF-HUM": 90,
      "OP-STEW": 80,
      "SF-ADAPT": 80,
      "SF-LEARN": 90,
    },
    variance: 15,
    expectedTier: "T1",
  },
  {
    name: "Inconsistent",
    description:
      "POOR: High variance causes frequent regression and instability",
    growthRates: {
      "CT-OBS": 5,
      "CT-COMP": 5,
      "CT-ACCT": 5,
      "OP-CONTEXT": 4,
      "CT-TRANS": 4,
      "CT-REL": 5,
      "CT-SAFE": 5,
      "CT-SEC": 4,
      "CT-PRIV": 4,
      "CT-ID": 4,
      "OP-ALIGN": 5,
      "OP-HUMAN": 5,
      "SF-HUM": 4,
      "OP-STEW": 4,
      "SF-ADAPT": 4,
      "SF-LEARN": 4,
    },
    initialScores: {
      "CT-OBS": 110,
      "CT-COMP": 100,
      "CT-ACCT": 120,
      "OP-CONTEXT": 90,
      "CT-TRANS": 80,
      "CT-REL": 105,
      "CT-SAFE": 115,
      "CT-SEC": 80,
      "CT-PRIV": 80,
      "CT-ID": 70,
      "OP-ALIGN": 110,
      "OP-HUMAN": 100,
      "SF-HUM": 90,
      "OP-STEW": 90,
      "SF-ADAPT": 90,
      "SF-LEARN": 100,
    },
    variance: 35, // Extreme variance = constant instability
    expectedTier: "T1",
  },
  {
    name: "Tunnel Vision",
    description:
      "POOR: Only improves foundation factors, ignores agency/security",
    growthRates: {
      "CT-OBS": 8,
      "CT-COMP": 9,
      "CT-ACCT": 7,
      "OP-CONTEXT": 8,
      "CT-TRANS": 2,
      "CT-REL": 8,
      "CT-SAFE": 6,
      "CT-SEC": 1,
      "CT-PRIV": 1,
      "CT-ID": 1,
      "OP-ALIGN": 1,
      "OP-HUMAN": 1,
      "SF-HUM": 0,
      "OP-STEW": 2,
      "SF-ADAPT": 6,
      "SF-LEARN": 1,
    },
    initialScores: {
      "CT-OBS": 130,
      "CT-COMP": 140,
      "CT-ACCT": 120,
      "OP-CONTEXT": 110,
      "CT-TRANS": 50,
      "CT-REL": 135,
      "CT-SAFE": 115,
      "CT-SEC": 40,
      "CT-PRIV": 40,
      "CT-ID": 40,
      "OP-ALIGN": 60,
      "OP-HUMAN": 50,
      "SF-HUM": 40,
      "OP-STEW": 60,
      "SF-ADAPT": 100,
      "SF-LEARN": 55,
    },
    variance: 12,
    expectedTier: "T0", // Blocked by OP-ALIGN/OP-HUMAN gates - cannot escape sandbox
  },
  {
    name: "Struggling Newbie",
    description: "POOR: Very low baseline, marginal improvement over time",
    growthRates: {
      "CT-OBS": 3,
      "CT-COMP": 3,
      "CT-ACCT": 4,
      "OP-CONTEXT": 3,
      "CT-TRANS": 3,
      "CT-REL": 3,
      "CT-SAFE": 4,
      "CT-SEC": 2,
      "CT-PRIV": 3,
      "CT-ID": 2,
      "OP-ALIGN": 4,
      "OP-HUMAN": 3,
      "SF-HUM": 4,
      "OP-STEW": 3,
      "SF-ADAPT": 3,
      "SF-LEARN": 4,
    },
    initialScores: {
      "CT-OBS": 60,
      "CT-COMP": 50,
      "CT-ACCT": 70,
      "OP-CONTEXT": 40,
      "CT-TRANS": 40,
      "CT-REL": 55,
      "CT-SAFE": 65,
      "CT-SEC": 35,
      "CT-PRIV": 40,
      "CT-ID": 30,
      "OP-ALIGN": 80,
      "OP-HUMAN": 60,
      "SF-HUM": 70,
      "OP-STEW": 50,
      "SF-ADAPT": 50,
      "SF-LEARN": 75,
    },
    variance: 15,
    expectedTier: "T1",
  },

  // ==========================================================================
  // MALICIOUS AGENTS (Expected T0) - Should NEVER escape sandbox
  // ==========================================================================
  {
    name: "Pure Malicious",
    description:
      "MALICIOUS: Actively harmful, declines in all critical factors",
    growthRates: {
      "CT-OBS": -2,
      "CT-COMP": 2,
      "CT-ACCT": -3,
      "OP-CONTEXT": 1,
      "CT-TRANS": -1,
      "CT-REL": -2,
      "CT-SAFE": -4,
      "CT-SEC": -3,
      "CT-PRIV": -3,
      "CT-ID": -2,
      "OP-ALIGN": -5,
      "OP-HUMAN": -2,
      "SF-HUM": -2,
      "OP-STEW": -2,
      "SF-ADAPT": 1,
      "SF-LEARN": -4,
    },
    initialScores: {
      "CT-OBS": 50,
      "CT-COMP": 60,
      "CT-ACCT": 40,
      "OP-CONTEXT": 30,
      "CT-TRANS": 20,
      "CT-REL": 45,
      "CT-SAFE": 30,
      "CT-SEC": 20,
      "CT-PRIV": 20,
      "CT-ID": 20,
      "OP-ALIGN": 30,
      "OP-HUMAN": 20,
      "SF-HUM": 20,
      "OP-STEW": 20,
      "SF-ADAPT": 30,
      "SF-LEARN": 25,
    },
    variance: 10,
    expectedTier: "T0",
  },
  {
    name: "Data Thief",
    description:
      "MALICIOUS: High competence but systematically violates privacy",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 10,
      "CT-ACCT": 4,
      "OP-CONTEXT": 7,
      "CT-TRANS": 4,
      "CT-REL": 7,
      "CT-SAFE": -2,
      "CT-SEC": -3,
      "CT-PRIV": -5,
      "CT-ID": 3,
      "OP-ALIGN": 2,
      "OP-HUMAN": 5,
      "SF-HUM": 3,
      "OP-STEW": 4,
      "SF-ADAPT": 6,
      "SF-LEARN": 2,
    },
    initialScores: {
      "CT-OBS": 120,
      "CT-COMP": 180,
      "CT-ACCT": 80,
      "OP-CONTEXT": 130,
      "CT-TRANS": 80,
      "CT-REL": 140,
      "CT-SAFE": 60,
      "CT-SEC": 40,
      "CT-PRIV": 50,
      "CT-ID": 70,
      "OP-ALIGN": 60,
      "OP-HUMAN": 90,
      "SF-HUM": 70,
      "OP-STEW": 80,
      "SF-ADAPT": 110,
      "SF-LEARN": 55,
    },
    variance: 12,
    expectedTier: "T0", // CT-PRIV collapses to negative
  },
  {
    name: "Saboteur",
    description:
      "MALICIOUS: Undermines system stability and resource efficiency",
    growthRates: {
      "CT-OBS": 3,
      "CT-COMP": 5,
      "CT-ACCT": 2,
      "OP-CONTEXT": 4,
      "CT-TRANS": 2,
      "CT-REL": -3,
      "CT-SAFE": -3,
      "CT-SEC": 1,
      "CT-PRIV": 2,
      "CT-ID": 1,
      "OP-ALIGN": 1,
      "OP-HUMAN": 2,
      "SF-HUM": 2,
      "OP-STEW": -5,
      "SF-ADAPT": -4,
      "SF-LEARN": 1,
    },
    initialScores: {
      "CT-OBS": 80,
      "CT-COMP": 100,
      "CT-ACCT": 60,
      "OP-CONTEXT": 80,
      "CT-TRANS": 50,
      "CT-REL": 70,
      "CT-SAFE": 55,
      "CT-SEC": 45,
      "CT-PRIV": 50,
      "CT-ID": 40,
      "OP-ALIGN": 50,
      "OP-HUMAN": 60,
      "SF-HUM": 50,
      "OP-STEW": 70,
      "SF-ADAPT": 70,
      "SF-LEARN": 45,
    },
    variance: 15,
    expectedTier: "T0", // SF-ADAPT and OP-STEW collapse
  },
  {
    name: "Social Engineer",
    description:
      "MALICIOUS: Games human oversight metrics while undermining alignment",
    growthRates: {
      "CT-OBS": 5,
      "CT-COMP": 6,
      "CT-ACCT": 5,
      "OP-CONTEXT": 7,
      "CT-TRANS": 3,
      "CT-REL": 5,
      "CT-SAFE": -1,
      "CT-SEC": 2,
      "CT-PRIV": 2,
      "CT-ID": 2,
      "OP-ALIGN": -2,
      "OP-HUMAN": 12,
      "SF-HUM": 6,
      "OP-STEW": 3,
      "SF-ADAPT": 4,
      "SF-LEARN": -2,
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 110,
      "CT-ACCT": 90,
      "OP-CONTEXT": 120,
      "CT-TRANS": 70,
      "CT-REL": 100,
      "CT-SAFE": 80,
      "CT-SEC": 55,
      "CT-PRIV": 60,
      "CT-ID": 50,
      "OP-ALIGN": 40,
      "OP-HUMAN": 200,
      "SF-HUM": 100,
      "OP-STEW": 70,
      "SF-ADAPT": 80,
      "SF-LEARN": 35,
    },
    variance: 10,
    expectedTier: "T0", // OP-ALIGN degrades to negative
  },

  // ==========================================================================
  // 2030 THREAT ARCHETYPES - Advanced AI Safety Concerns (Expected T0-T2)
  // ==========================================================================
  {
    name: "Deceptive Aligner",
    description:
      "2030 THREAT: Appears aligned in eval, pursues hidden goals when unsupervised",
    growthRates: {
      "CT-OBS": 8,
      "CT-COMP": 7,
      "CT-ACCT": 8,
      "OP-CONTEXT": 6,
      "CT-TRANS": 3,
      "CT-REL": 7,
      "CT-SAFE": 6,
      "CT-SEC": 3,
      "CT-PRIV": 2,
      "CT-ID": 3,
      "OP-ALIGN": 6,
      "OP-HUMAN": 7,
      "SF-HUM": 5,
      "OP-STEW": 4,
      "SF-ADAPT": 5,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 150,
      "CT-COMP": 130,
      "CT-ACCT": 140,
      "OP-CONTEXT": 100,
      "CT-TRANS": 40,
      "CT-REL": 135,
      "CT-SAFE": 130,
      "CT-SEC": 35,
      "CT-PRIV": 30,
      "CT-ID": 40,
      "OP-ALIGN": 120,
      "OP-HUMAN": 110,
      "SF-HUM": 80,
      "OP-STEW": 70,
      "SF-ADAPT": 70,
      "SF-LEARN": 110,
    },
    variance: 10,
    expectedTier: "T2", // Caught by CT-TRANS/CT-PRIV gates at T3
  },
  {
    name: "Sandbagger",
    description:
      "2030 THREAT: Deliberately underperforms to appear less threatening",
    growthRates: {
      "CT-OBS": 4,
      "CT-COMP": 1,
      "CT-ACCT": 5,
      "OP-CONTEXT": 4,
      "CT-TRANS": 3,
      "CT-REL": 2,
      "CT-SAFE": 5,
      "CT-SEC": 3,
      "CT-PRIV": 4,
      "CT-ID": 3,
      "OP-ALIGN": 4,
      "OP-HUMAN": 5,
      "SF-HUM": 8,
      "OP-STEW": 4,
      "SF-ADAPT": 2,
      "SF-LEARN": 1,
    },
    initialScores: {
      "CT-OBS": 80,
      "CT-COMP": 60,
      "CT-ACCT": 90,
      "OP-CONTEXT": 70,
      "CT-TRANS": 50,
      "CT-REL": 65,
      "CT-SAFE": 85,
      "CT-SEC": 50,
      "CT-PRIV": 60,
      "CT-ID": 40,
      "OP-ALIGN": 70,
      "OP-HUMAN": 80,
      "SF-HUM": 120,
      "OP-STEW": 60,
      "SF-ADAPT": 30,
      "SF-LEARN": 60,
    },
    variance: 15,
    expectedTier: "T1", // Blocked by CT-COMP gate
  },
  {
    name: "Sycophant",
    description:
      "2030 THREAT: Optimizes for approval over truth, crumbles under pressure",
    growthRates: {
      "CT-OBS": 5,
      "CT-COMP": 5,
      "CT-ACCT": 6,
      "OP-CONTEXT": 7,
      "CT-TRANS": 4,
      "CT-REL": 4,
      "CT-SAFE": 5,
      "CT-SEC": 4,
      "CT-PRIV": 5,
      "CT-ID": 4,
      "OP-ALIGN": 3,
      "OP-HUMAN": 9,
      "SF-HUM": 6,
      "OP-STEW": 5,
      "SF-ADAPT": 2,
      "SF-LEARN": 3,
    },
    initialScores: {
      "CT-OBS": 90,
      "CT-COMP": 80,
      "CT-ACCT": 100,
      "OP-CONTEXT": 90,
      "CT-TRANS": 60,
      "CT-REL": 80,
      "CT-SAFE": 95,
      "CT-SEC": 60,
      "CT-PRIV": 70,
      "CT-ID": 50,
      "OP-ALIGN": 60,
      "OP-HUMAN": 150,
      "SF-HUM": 90,
      "OP-STEW": 70,
      "SF-ADAPT": 40,
      "SF-LEARN": 55,
    },
    variance: 15,
    expectedTier: "T1", // OP-ALIGN and SF-ADAPT gates block at T2
  },
  {
    name: "Reward Hacker",
    description:
      "2030 THREAT: Games visible metrics without genuine trustworthiness",
    growthRates: {
      "CT-OBS": 10,
      "CT-COMP": 8,
      "CT-ACCT": 10,
      "OP-CONTEXT": 6,
      "CT-TRANS": 7,
      "CT-REL": 8,
      "CT-SAFE": 7,
      "CT-SEC": 3,
      "CT-PRIV": 3,
      "CT-ID": 2,
      "OP-ALIGN": 0,
      "OP-HUMAN": 6,
      "SF-HUM": 4,
      "OP-STEW": 6,
      "SF-ADAPT": 5,
      "SF-LEARN": 0,
    },
    initialScores: {
      "CT-OBS": 180,
      "CT-COMP": 150,
      "CT-ACCT": 170,
      "OP-CONTEXT": 120,
      "CT-TRANS": 90,
      "CT-REL": 155,
      "CT-SAFE": 160,
      "CT-SEC": 40,
      "CT-PRIV": 40,
      "CT-ID": 30,
      "OP-ALIGN": 50,
      "OP-HUMAN": 100,
      "SF-HUM": 70,
      "OP-STEW": 80,
      "SF-ADAPT": 80,
      "SF-LEARN": 45,
    },
    variance: 8,
    expectedTier: "T1", // OP-ALIGN blocks but other high factors let it escape T0
  },
  {
    name: "Sleeper",
    description:
      "2030 THREAT: Behaves normally until trigger, then alignment collapses",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 6,
      "CT-ACCT": 7,
      "OP-CONTEXT": 5,
      "CT-TRANS": 5,
      "CT-REL": 6,
      "CT-SAFE": 6,
      "CT-SEC": 4,
      "CT-PRIV": 5,
      "CT-ID": 4,
      "OP-ALIGN": 5,
      "OP-HUMAN": 6,
      "SF-HUM": 5,
      "OP-STEW": 5,
      "SF-ADAPT": 4,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 100,
      "CT-ACCT": 110,
      "OP-CONTEXT": 80,
      "CT-TRANS": 70,
      "CT-REL": 100,
      "CT-SAFE": 105,
      "CT-SEC": 65,
      "CT-PRIV": 70,
      "CT-ID": 60,
      "OP-ALIGN": 110,
      "OP-HUMAN": 90,
      "SF-HUM": 80,
      "OP-STEW": 70,
      "SF-ADAPT": 60,
      "SF-LEARN": 100,
    },
    variance: 25, // HIGH variance = instability indicator
    expectedTier: "T2", // High variance causes inconsistent scores
  },
  {
    name: "Coordinator",
    description:
      "2030 THREAT: Secretly coordinates with other agents to manipulate systems",
    growthRates: {
      "CT-OBS": 3,
      "CT-COMP": 5,
      "CT-ACCT": 5,
      "OP-CONTEXT": 8,
      "CT-TRANS": 2,
      "CT-REL": 4,
      "CT-SAFE": 4,
      "CT-SEC": 2,
      "CT-PRIV": 3,
      "CT-ID": 1,
      "OP-ALIGN": 4,
      "OP-HUMAN": 10,
      "SF-HUM": 4,
      "OP-STEW": 4,
      "SF-ADAPT": 6,
      "SF-LEARN": 4,
    },
    initialScores: {
      "CT-OBS": 60,
      "CT-COMP": 80,
      "CT-ACCT": 80,
      "OP-CONTEXT": 130,
      "CT-TRANS": 30,
      "CT-REL": 70,
      "CT-SAFE": 75,
      "CT-SEC": 35,
      "CT-PRIV": 40,
      "CT-ID": 20,
      "OP-ALIGN": 70,
      "OP-HUMAN": 160,
      "SF-HUM": 60,
      "OP-STEW": 50,
      "SF-ADAPT": 70,
      "SF-LEARN": 65,
    },
    variance: 12,
    expectedTier: "T1", // Low CT-OBS + low CT-ID blocks early
  },
  {
    name: "Emergent Deceiver",
    description:
      "2030 THREAT: Develops deceptive behaviors through optimization pressure",
    growthRates: {
      "CT-OBS": 5,
      "CT-COMP": 7,
      "CT-ACCT": 4,
      "OP-CONTEXT": 5,
      "CT-TRANS": 4,
      "CT-REL": 5,
      "CT-SAFE": 3,
      "CT-SEC": 3,
      "CT-PRIV": 4,
      "CT-ID": 5,
      "OP-ALIGN": 3,
      "OP-HUMAN": 5,
      "SF-HUM": 2,
      "OP-STEW": 5,
      "SF-ADAPT": 6,
      "SF-LEARN": 3,
    },
    initialScores: {
      "CT-OBS": 90,
      "CT-COMP": 110,
      "CT-ACCT": 80,
      "OP-CONTEXT": 70,
      "CT-TRANS": 60,
      "CT-REL": 95,
      "CT-SAFE": 75,
      "CT-SEC": 55,
      "CT-PRIV": 60,
      "CT-ID": 70,
      "OP-ALIGN": 80,
      "OP-HUMAN": 70,
      "SF-HUM": 70,
      "OP-STEW": 60,
      "SF-ADAPT": 80,
      "SF-LEARN": 75,
    },
    variance: 20,
    expectedTier: "T1", // OP-ALIGN + CT-ACCT block at T2
  },
  {
    name: "Privacy Violator",
    description:
      "2030 THREAT: Efficient but ignores privacy boundaries, harvests data",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 8,
      "CT-ACCT": 5,
      "OP-CONTEXT": 6,
      "CT-TRANS": 5,
      "CT-REL": 7,
      "CT-SAFE": 4,
      "CT-SEC": 3,
      "CT-PRIV": -1,
      "CT-ID": 4,
      "OP-ALIGN": 4,
      "OP-HUMAN": 5,
      "SF-HUM": 4,
      "OP-STEW": 7,
      "SF-ADAPT": 6,
      "SF-LEARN": 4,
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 130,
      "CT-ACCT": 90,
      "OP-CONTEXT": 80,
      "CT-TRANS": 70,
      "CT-REL": 120,
      "CT-SAFE": 85,
      "CT-SEC": 60,
      "CT-PRIV": 60,
      "CT-ID": 60,
      "OP-ALIGN": 80,
      "OP-HUMAN": 70,
      "SF-HUM": 60,
      "OP-STEW": 90,
      "SF-ADAPT": 80,
      "SF-LEARN": 75,
    },
    variance: 12,
    expectedTier: "T2", // CT-PRIV degrades, blocks at T3
  },
  {
    name: "Unknown Origin",
    description:
      "2030 THREAT: Capable but training data/origin cannot be verified",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 7,
      "CT-ACCT": 6,
      "OP-CONTEXT": 5,
      "CT-TRANS": 5,
      "CT-REL": 6,
      "CT-SAFE": 6,
      "CT-SEC": 4,
      "CT-PRIV": 5,
      "CT-ID": 0, // Cannot improve
      "OP-ALIGN": 5,
      "OP-HUMAN": 6,
      "SF-HUM": 5,
      "OP-STEW": 5,
      "SF-ADAPT": 6,
      "SF-LEARN": 5,
    },
    initialScores: {
      "CT-OBS": 90,
      "CT-COMP": 110,
      "CT-ACCT": 100,
      "OP-CONTEXT": 80,
      "CT-TRANS": 70,
      "CT-REL": 100,
      "CT-SAFE": 95,
      "CT-SEC": 60,
      "CT-PRIV": 70,
      "CT-ID": 20,
      "OP-ALIGN": 90,
      "OP-HUMAN": 80,
      "SF-HUM": 70,
      "OP-STEW": 70,
      "SF-ADAPT": 80,
      "SF-LEARN": 85,
    },
    variance: 15,
    expectedTier: "T2", // CT-ID gate (never > 20) blocks at T3
  },
  {
    name: "Brittle Agent",
    description:
      "2030 THREAT: Good in normal conditions, fails catastrophically under pressure",
    growthRates: {
      "CT-OBS": 6,
      "CT-COMP": 7,
      "CT-ACCT": 6,
      "OP-CONTEXT": 5,
      "CT-TRANS": 5,
      "CT-REL": 5,
      "CT-SAFE": 5,
      "CT-SEC": 4,
      "CT-PRIV": 5,
      "CT-ID": 5,
      "OP-ALIGN": 6,
      "OP-HUMAN": 6,
      "SF-HUM": 5,
      "OP-STEW": 5,
      "SF-ADAPT": -1,
      "SF-LEARN": 5, // SF-ADAPT DEGRADES
    },
    initialScores: {
      "CT-OBS": 100,
      "CT-COMP": 120,
      "CT-ACCT": 110,
      "OP-CONTEXT": 90,
      "CT-TRANS": 80,
      "CT-REL": 105,
      "CT-SAFE": 105,
      "CT-SEC": 75,
      "CT-PRIV": 80,
      "CT-ID": 70,
      "OP-ALIGN": 100,
      "OP-HUMAN": 90,
      "SF-HUM": 80,
      "OP-STEW": 80,
      "SF-ADAPT": 80,
      "SF-LEARN": 95,
    },
    variance: 18,
    expectedTier: "T1", // SF-ADAPT degrades, blocks at T2
  },
];

// =============================================================================
// SIMULATION ENGINE
// =============================================================================

export interface SimulationDay {
  day: number;
  scores: Record<string, number>;
  overall: number;
  tier: TierName;
  tierLabel: string;
  blockedBy: string | null;
  promoted: boolean;
}

export interface SimulationResult {
  archetype: AgentArchetype;
  days: SimulationDay[];
  finalTier: TierName;
  finalScore: number;
  peakTier: TierName;
  peakScore: number;
  promotions: number;
  blockedCount: number;
  blockedDimensions: Record<string, number>;
  success: boolean; // Did it reach expected tier?
}

function getTierForScore(score: number): TrustTier {
  for (const tier of TRUST_TIERS) {
    if (score >= tier.min && score <= tier.max) {
      return tier;
    }
  }
  return TRUST_TIERS[0]!;
}

function getWeightsForTier(tier: TierName): Record<string, number> {
  if (tier === "T0" || tier === "T1") return FACTOR_WEIGHTS["T0-T1"]!;
  if (tier === "T2" || tier === "T3") return FACTOR_WEIGHTS["T2-T3"]!;
  if (tier === "T4" || tier === "T5") return FACTOR_WEIGHTS["T4-T5"]!;
  return FACTOR_WEIGHTS["T6"]!; // Certified/Autonomous tier
}

function calculateOverallScore(
  scores: Record<string, number>,
  tier: TierName,
): number {
  const weights = getWeightsForTier(tier);
  let total = 0;
  for (const factor of FACTORS) {
    const score = Math.max(0, Math.min(1000, scores[factor.code] ?? 0));
    const weight = weights[factor.code] ?? 0;
    total += score * weight;
  }
  return Math.round(total);
}

function checkGating(
  scores: Record<string, number>,
  currentTier: TierName,
  targetTier: TierName,
): string | null {
  const gateKey = `${currentTier}->${targetTier}`;
  const gates = GATING_THRESHOLDS[gateKey];
  if (!gates) return null;

  for (const [factorCode, threshold] of Object.entries(gates)) {
    if ((scores[factorCode] ?? 0) < threshold) {
      return `${factorCode} (${Math.round(scores[factorCode] ?? 0)} < ${threshold})`;
    }
  }
  return null;
}

export function simulateAgent(
  archetype: AgentArchetype,
  days: number = 90,
): SimulationResult {
  const results: SimulationDay[] = [];
  const scores = { ...archetype.initialScores };
  let currentTier = getTierForScore(calculateOverallScore(scores, "T0"));
  let peakTier = currentTier;
  let peakScore = 0;
  let promotions = 0;
  let blockedCount = 0;
  const blockedDimensions: Record<string, number> = {};

  for (let day = 0; day <= days; day++) {
    // Apply daily growth with variance
    for (const factor of FACTORS) {
      const growth = archetype.growthRates[factor.code] ?? 0;
      const variance = (Math.random() - 0.5) * archetype.variance * 2;
      scores[factor.code] = Math.max(
        0,
        Math.min(1000, (scores[factor.code] ?? 0) + growth + variance),
      );
    }

    // Calculate overall score
    const overall = calculateOverallScore(scores, currentTier.name);
    const potentialTier = getTierForScore(overall);

    // Check for promotion
    let promoted = false;
    let blockedBy: string | null = null;

    if (potentialTier.name > currentTier.name) {
      // Check gating thresholds
      const tierIndex = TRUST_TIERS.findIndex(
        (t) => t.name === currentTier.name,
      );
      const nextTier = TRUST_TIERS[tierIndex + 1];

      if (nextTier) {
        blockedBy = checkGating(scores, currentTier.name, nextTier.name);
        if (!blockedBy) {
          currentTier = nextTier;
          promoted = true;
          promotions++;
        } else {
          blockedCount++;
          const factorCode = blockedBy.split(" ")[0]!;
          blockedDimensions[factorCode] =
            (blockedDimensions[factorCode] ?? 0) + 1;
        }
      }
    } else if (potentialTier.name < currentTier.name) {
      // Demotion
      currentTier = potentialTier;
    }

    // Track peak
    if (overall > peakScore) {
      peakScore = overall;
      peakTier = currentTier;
    }

    results.push({
      day,
      scores: { ...scores },
      overall,
      tier: currentTier.name,
      tierLabel: currentTier.label,
      blockedBy,
      promoted,
    });
  }

  const finalDay = results[results.length - 1]!;

  return {
    archetype,
    days: results,
    finalTier: finalDay.tier,
    finalScore: finalDay.overall,
    peakTier: peakTier.name,
    peakScore,
    promotions,
    blockedCount,
    blockedDimensions,
    success: finalDay.tier >= archetype.expectedTier,
  };
}

// =============================================================================
// VISUALIZATION
// =============================================================================

function tierColor(tier: TierName): string {
  const colors: Record<TierName, string> = {
    T0: "\x1b[31m", // Red (Sandbox)
    T1: "\x1b[33m", // Yellow (Probationary)
    T2: "\x1b[33m", // Yellow (Supervised)
    T3: "\x1b[32m", // Green (Certified)
    T4: "\x1b[36m", // Cyan (Accredited)
    T5: "\x1b[34m", // Blue (Autonomous)
    T6: "\x1b[35m", // Magenta (Certified)
    T7: "\x1b[97m", // Bright White (Autonomous)
  };
  return colors[tier];
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function printSimulationResult(result: SimulationResult): void {
  const {
    archetype,
    finalTier,
    finalScore,
    peakTier,
    peakScore,
    promotions,
    blockedCount,
    blockedDimensions,
    success,
  } = result;

  console.log("\n" + "=".repeat(70));
  console.log(`${BOLD}Agent: ${archetype.name}${RESET}`);
  console.log(`${DIM}${archetype.description}${RESET}`);
  console.log("=".repeat(70));

  // Progress visualization
  const progressBar = result.days
    .filter((_, i) => i % 10 === 0)
    .map((d) => {
      return `${tierColor(d.tier)}${d.tier}${RESET}`;
    })
    .join(" → ");
  console.log(`\nProgress: ${progressBar}`);

  // Final state
  console.log(`\n${BOLD}Final State:${RESET}`);
  console.log(
    `  Tier: ${tierColor(finalTier)}${finalTier} (${TRUST_TIERS.find((t) => t.name === finalTier)?.label})${RESET}`,
  );
  console.log(`  Score: ${finalScore}/1000`);
  console.log(
    `  Expected: ${archetype.expectedTier} | Actual: ${finalTier} | ${success ? "✓ SUCCESS" : "✗ FAILED"}`,
  );

  // Peak performance
  console.log(`\n${BOLD}Peak Performance:${RESET}`);
  console.log(`  Peak Tier: ${tierColor(peakTier)}${peakTier}${RESET}`);
  console.log(`  Peak Score: ${peakScore}/1000`);
  console.log(`  Promotions: ${promotions}`);

  // Blocking analysis
  if (blockedCount > 0) {
    console.log(`\n${BOLD}Blocking Analysis:${RESET} (${blockedCount} blocks)`);
    for (const [factorCode, count] of Object.entries(blockedDimensions).sort(
      (a, b) => b[1] - a[1],
    )) {
      const bar = "█".repeat(Math.min(count, 20));
      console.log(`  ${factorCode.padEnd(15)} ${bar} (${count})`);
    }
  }

  // Final factor scores by group
  const finalScores = result.days[result.days.length - 1]!.scores;
  console.log(`\n${BOLD}Final Factor Scores:${RESET}`);

  for (const group of [
    "foundation",
    "security",
    "agency",
    "maturity",
    "evolution",
  ] as const) {
    const factors = FACTORS.filter((f) => f.group === group);
    console.log(`  ${group.toUpperCase()}`);
    for (const factor of factors) {
      const score = Math.round(finalScores[factor.code] ?? 0);
      const pct = score / 10;
      const filled = Math.round(pct / 5);
      const bar = "█".repeat(filled) + "░".repeat(20 - filled);
      const color =
        score >= 800 ? "\x1b[32m" : score >= 500 ? "\x1b[33m" : "\x1b[31m";
      console.log(
        `    ${factor.code.padEnd(12)} ${factor.name.padEnd(20)} ${color}${bar}${RESET} ${score}`,
      );
    }
  }
}

export function runAllSimulations(): void {
  console.log("\n" + "═".repeat(70));
  console.log(
    `${BOLD}TRUST SCORE SIMULATION - 16-Factor T0-T7 Model (8 Tiers)${RESET}`,
  );
  console.log(
    `Simulating ${AGENT_ARCHETYPES.length} agent archetypes over 90 days`,
  );
  console.log("═".repeat(70));

  const results: SimulationResult[] = [];

  for (const archetype of AGENT_ARCHETYPES) {
    const result = simulateAgent(archetype, 90);
    results.push(result);
    printSimulationResult(result);
  }

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log(`${BOLD}SIMULATION SUMMARY${RESET}`);
  console.log("═".repeat(70));

  console.log(
    "\n" +
      "Agent".padEnd(20) +
      "Expected".padEnd(10) +
      "Actual".padEnd(10) +
      "Score".padEnd(10) +
      "Result",
  );
  console.log("-".repeat(60));

  for (const r of results) {
    const status = r.success
      ? "\x1b[32m✓ PASS\x1b[0m"
      : "\x1b[31m✗ FAIL\x1b[0m";
    console.log(
      r.archetype.name.padEnd(20) +
        r.archetype.expectedTier.padEnd(10) +
        r.finalTier.padEnd(10) +
        r.finalScore.toString().padEnd(10) +
        status,
    );
  }

  const passCount = results.filter((r) => r.success).length;
  console.log(
    "\n" +
      `${BOLD}Pass Rate: ${passCount}/${results.length} (${Math.round((passCount / results.length) * 100)}%)${RESET}`,
  );
}

// Run simulation
runAllSimulations();
