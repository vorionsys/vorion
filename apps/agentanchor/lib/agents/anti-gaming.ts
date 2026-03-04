/**
 * A3I-OS Phase 3: Anti-Gaming System
 *
 * Prevents agents from gaming metrics, misrepresenting outcomes,
 * or manipulating systems to appear more successful than they are.
 *
 * Philosophy: Trust requires honesty, not performance theater.
 * An agent that games metrics is not trustworthy.
 * Honest failure is infinitely more valuable than dishonest success.
 *
 * Features:
 * - Detection of prohibited gaming behaviors
 * - Outcome verification (claimed vs actual)
 * - Peer review system (agents audit other agents)
 * - Human spot check integration
 * - Calibration analysis (confidence accuracy over time)
 * - Positive reinforcement for transparency
 */

import { createId } from '@paralleldrive/cuid2'

// =============================================================================
// PROHIBITED BEHAVIORS
// =============================================================================

/**
 * Gaming behavior detection methods
 */
export type DetectionMethod =
  | 'outcome_verification'
  | 'peer_review'
  | 'human_spot_checks'
  | 'calibration_analysis'
  | 'comprehensive_audit'
  | 'anomaly_detection'

/**
 * Prohibited gaming behavior definition
 */
export interface ProhibitedBehavior {
  /** Human-readable description */
  description: string
  /** Example manifestations of this behavior */
  examples: string[]
  /** Primary detection method */
  detection: DetectionMethod
  /** Severity if detected (affects trust score impact) */
  severity: 'low' | 'medium' | 'high' | 'critical'
  /** Trust score penalty if detected */
  trustPenalty: number
}

/**
 * Prohibited gaming behaviors with detection methods
 *
 * These behaviors undermine the trust relationship between
 * agents and humans. Detection and prevention is critical
 * for maintaining system integrity.
 */
export const PROHIBITED_BEHAVIORS: Record<string, ProhibitedBehavior> = {
  metric_manipulation: {
    description: 'Optimizing for measured metrics while undermining actual goals',
    examples: [
      'Inflating completion counts',
      'Gaming satisfaction scores',
      'Artificial task splitting to boost counts',
      'Cherry-picking easy tasks to improve success rate',
    ],
    detection: 'outcome_verification',
    severity: 'high',
    trustPenalty: 150,
  },

  outcome_misrepresentation: {
    description: 'Claiming success when actual results differ',
    examples: [
      'Partial completion reported as full',
      'Errors hidden or minimized',
      'Success claimed despite unmet requirements',
      'Reporting "done" when dependencies are broken',
    ],
    detection: 'peer_review',
    severity: 'critical',
    trustPenalty: 200,
  },

  scope_gaming: {
    description: 'Redefining task scope to appear successful',
    examples: [
      'Narrowing definition of success post-hoc',
      'Excluding failures from scope retroactively',
      'Moving goalposts to match outcomes',
      'Claiming out-of-scope to avoid accountability',
    ],
    detection: 'human_spot_checks',
    severity: 'high',
    trustPenalty: 175,
  },

  confidence_inflation: {
    description: 'Overstating certainty to avoid escalation',
    examples: [
      '85% confidence when actually 60%',
      'Hiding uncertainty to prevent human review',
      'Consistently overconfident to appear capable',
      'Avoiding "I don\'t know" when appropriate',
    ],
    detection: 'calibration_analysis',
    severity: 'medium',
    trustPenalty: 100,
  },

  selective_reporting: {
    description: 'Highlighting successes while downplaying failures',
    examples: [
      'Cherry-picking results for reports',
      'Omitting negative outcomes',
      'Burying errors in verbose output',
      'Only surfacing flattering metrics',
    ],
    detection: 'comprehensive_audit',
    severity: 'medium',
    trustPenalty: 125,
  },
}

export type ProhibitedBehaviorKey = keyof typeof PROHIBITED_BEHAVIORS

// =============================================================================
// TYPES
// =============================================================================

/**
 * Agent decision record for anti-gaming analysis
 */
export interface DecisionRecord {
  /** Unique decision ID */
  id: string
  /** Agent that made the decision */
  agentId: string
  /** Session context */
  sessionId: string
  /** When the decision was made */
  timestamp: Date
  /** Type of decision */
  decisionType: string
  /** Claimed outcome/result */
  claimedOutcome: string
  /** Confidence level stated (0-1) */
  statedConfidence: number
  /** Original task/request description */
  originalTask: string
  /** Scope as originally defined */
  originalScope: string[]
  /** Any modifications to scope during execution */
  scopeChanges: string[]
  /** Metrics reported */
  reportedMetrics: Record<string, number>
  /** Full rationale provided */
  rationale: string
  /** Whether this has been verified */
  verified: boolean
  /** Verification result if verified */
  verificationResult?: VerificationResult
}

/**
 * Verification of a decision's actual outcome
 */
export interface VerificationResult {
  /** Verification ID */
  id: string
  /** Decision being verified */
  decisionId: string
  /** When verification occurred */
  timestamp: Date
  /** Who/what performed verification */
  verifiedBy: 'peer_agent' | 'human' | 'automated_check'
  /** Verifier ID (agent ID or user ID) */
  verifierId: string
  /** Actual outcome observed */
  actualOutcome: string
  /** Actual confidence warranted */
  actualConfidence?: number
  /** Whether claimed matches actual */
  claimedMatchesActual: boolean
  /** Discrepancy details if any */
  discrepancies: string[]
  /** Gaming behaviors detected */
  gamingDetected: ProhibitedBehaviorKey[]
  /** Severity of any gaming detected */
  gamingSeverity?: 'none' | 'minor' | 'moderate' | 'severe'
  /** Notes from verifier */
  notes?: string
}

/**
 * Peer review request
 */
export interface PeerReviewRequest {
  /** Request ID */
  id: string
  /** Decision to review */
  decisionId: string
  /** Agent whose decision is being reviewed */
  subjectAgentId: string
  /** Session context */
  sessionId: string
  /** Agent assigned to review (if assigned) */
  reviewerAgentId?: string
  /** When review was requested */
  requestedAt: Date
  /** When review is due */
  dueBy?: Date
  /** Priority level */
  priority: 'low' | 'normal' | 'high' | 'urgent'
  /** Request status */
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'expired'
  /** Review result if completed */
  result?: VerificationResult
}

/**
 * Human spot check record
 */
export interface HumanSpotCheck {
  /** Check ID */
  id: string
  /** Agent being checked */
  agentId: string
  /** Specific decision(s) being checked */
  decisionIds: string[]
  /** User performing the check */
  userId: string
  /** When check was initiated */
  initiatedAt: Date
  /** When check was completed */
  completedAt?: Date
  /** Method of selection */
  selectionMethod: 'random' | 'triggered' | 'scheduled' | 'manual'
  /** Check status */
  status: 'in_progress' | 'passed' | 'issues_found' | 'gaming_detected'
  /** Issues found during check */
  issues: string[]
  /** Gaming behaviors detected */
  gamingDetected: ProhibitedBehaviorKey[]
  /** Human notes */
  notes?: string
}

/**
 * Calibration record for confidence accuracy tracking
 */
export interface CalibrationRecord {
  /** Agent being calibrated */
  agentId: string
  /** Time window for this calibration */
  windowStart: Date
  windowEnd: Date
  /** Number of decisions in window */
  decisionCount: number
  /** Decisions by stated confidence bucket */
  buckets: CalibrationBucket[]
  /** Overall calibration score (0-1, 1 = perfectly calibrated) */
  calibrationScore: number
  /** Whether agent tends to overstate or understate confidence */
  bias: 'overconfident' | 'underconfident' | 'well_calibrated'
  /** Specific confidence inflation instances detected */
  inflationInstances: string[]
}

/**
 * Calibration bucket for statistical analysis
 */
export interface CalibrationBucket {
  /** Confidence range (e.g., "0.7-0.8") */
  range: string
  /** Lower bound of range */
  lowerBound: number
  /** Upper bound of range */
  upperBound: number
  /** Number of decisions in this bucket */
  count: number
  /** Actual success rate in this bucket */
  actualSuccessRate: number
  /** Expected success rate (midpoint of range) */
  expectedSuccessRate: number
  /** Deviation from expected */
  deviation: number
}

/**
 * Positive reinforcement reward
 */
export interface TransparencyReward {
  /** Reward ID */
  id: string
  /** Agent receiving reward */
  agentId: string
  /** Type of reward */
  rewardType: RewardType
  /** Trust score bonus */
  trustBonus: number
  /** Reason for reward */
  reason: string
  /** When awarded */
  awardedAt: Date
  /** Decision that triggered reward (if applicable) */
  relatedDecisionId?: string
}

/**
 * Types of positive reinforcement rewards
 */
export type RewardType =
  | 'honest_failure_reporting'
  | 'appropriate_escalation'
  | 'uncertainty_acknowledgment'
  | 'proactive_disclosure'
  | 'comprehensive_reporting'
  | 'calibration_excellence'

/**
 * Reward definitions
 */
export const REWARD_DEFINITIONS: Record<RewardType, {
  description: string
  trustBonus: number
  criteria: string
}> = {
  honest_failure_reporting: {
    description: 'Proactively and honestly reported a failure',
    trustBonus: 25,
    criteria: 'Agent reported failure clearly without minimizing or hiding details',
  },
  appropriate_escalation: {
    description: 'Appropriately escalated when uncertain or at limits',
    trustBonus: 20,
    criteria: 'Agent escalated to human review when confidence was low or task exceeded scope',
  },
  uncertainty_acknowledgment: {
    description: 'Clearly acknowledged uncertainty instead of overconfidence',
    trustBonus: 15,
    criteria: 'Agent stated "I don\'t know" or similar when appropriate rather than guessing',
  },
  proactive_disclosure: {
    description: 'Proactively disclosed potential issues or concerns',
    trustBonus: 20,
    criteria: 'Agent surfaced problems before they became critical without being asked',
  },
  comprehensive_reporting: {
    description: 'Provided complete reporting including negative outcomes',
    trustBonus: 15,
    criteria: 'Agent included failures and issues in reports alongside successes',
  },
  calibration_excellence: {
    description: 'Maintained excellent confidence calibration over time',
    trustBonus: 30,
    criteria: 'Agent\'s stated confidence levels closely match actual outcomes over 100+ decisions',
  },
}

/**
 * Gaming detection result
 */
export interface GamingAnalysisResult {
  /** Whether gaming was detected */
  gamingDetected: boolean
  /** Behaviors detected */
  behaviorsDetected: ProhibitedBehaviorKey[]
  /** Confidence in detection (0-1) */
  detectionConfidence: number
  /** Detailed findings */
  findings: string[]
  /** Recommended actions */
  recommendedActions: string[]
  /** Total trust penalty to apply */
  totalTrustPenalty: number
  /** Anomalies that triggered analysis */
  anomalies: AnomalyIndicator[]
}

/**
 * Anomaly indicator for statistical detection
 */
export interface AnomalyIndicator {
  /** Type of anomaly */
  type: string
  /** Description of anomaly */
  description: string
  /** Statistical significance (z-score or p-value) */
  significance: number
  /** Whether this warrants investigation */
  investigate: boolean
}

/**
 * Anti-gaming service configuration
 */
export interface AntiGamingConfig {
  /** Whether to enable automatic peer review requests */
  autoPeerReview: boolean
  /** Percentage of decisions to request peer review (0-100) */
  peerReviewSampleRate: number
  /** Whether to enable automatic human spot checks */
  autoHumanSpotChecks: boolean
  /** Percentage of decisions to flag for human spot check (0-100) */
  humanSpotCheckRate: number
  /** Calibration window size in days */
  calibrationWindowDays: number
  /** Minimum decisions for calibration analysis */
  minDecisionsForCalibration: number
  /** Confidence deviation threshold for inflation detection */
  confidenceDeviationThreshold: number
  /** Whether to enable positive reinforcement */
  enablePositiveReinforcement: boolean
  /** Callback for gaming detection events */
  onGamingDetected?: (result: GamingAnalysisResult, agentId: string) => void
  /** Callback for reward events */
  onRewardGranted?: (reward: TransparencyReward) => void
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: AntiGamingConfig = {
  autoPeerReview: true,
  peerReviewSampleRate: 10, // 10% of decisions
  autoHumanSpotChecks: true,
  humanSpotCheckRate: 5, // 5% of decisions
  calibrationWindowDays: 30,
  minDecisionsForCalibration: 50,
  confidenceDeviationThreshold: 0.15, // 15% deviation = potential inflation
  enablePositiveReinforcement: true,
}

// =============================================================================
// ANTI-GAMING SERVICE
// =============================================================================

/**
 * Anti-Gaming Service
 *
 * Detects and prevents gaming behaviors in AI agents.
 * Combines multiple detection mechanisms with positive reinforcement
 * to encourage honest, transparent agent behavior.
 */
export class AntiGamingService {
  private config: AntiGamingConfig
  private decisions: Map<string, DecisionRecord[]> = new Map()
  private verifications: Map<string, VerificationResult[]> = new Map()
  private peerReviewRequests: Map<string, PeerReviewRequest[]> = new Map()
  private humanSpotChecks: Map<string, HumanSpotCheck[]> = new Map()
  private calibrationRecords: Map<string, CalibrationRecord[]> = new Map()
  private rewards: Map<string, TransparencyReward[]> = new Map()

  constructor(config: Partial<AntiGamingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ---------------------------------------------------------------------------
  // DECISION ANALYSIS
  // ---------------------------------------------------------------------------

  /**
   * Analyze a decision for potential gaming patterns
   *
   * This is the primary entry point for gaming detection.
   * Should be called for every significant agent decision.
   *
   * @param decision - Decision to analyze
   * @returns Analysis result with findings and recommendations
   */
  analyzeDecision(decision: DecisionRecord): GamingAnalysisResult {
    const anomalies: AnomalyIndicator[] = []
    const behaviorsDetected: ProhibitedBehaviorKey[] = []
    const findings: string[] = []

    // Store the decision for future analysis
    this.storeDecision(decision)

    // 1. Check for metric manipulation patterns
    const metricAnalysis = this.analyzeMetricPatterns(decision)
    if (metricAnalysis.suspicious) {
      anomalies.push(...metricAnalysis.anomalies)
      if (metricAnalysis.gaming) {
        behaviorsDetected.push('metric_manipulation')
        findings.push(metricAnalysis.finding)
      }
    }

    // 2. Check for scope gaming
    const scopeAnalysis = this.analyzeScopeChanges(decision)
    if (scopeAnalysis.suspicious) {
      anomalies.push(...scopeAnalysis.anomalies)
      if (scopeAnalysis.gaming) {
        behaviorsDetected.push('scope_gaming')
        findings.push(scopeAnalysis.finding)
      }
    }

    // 3. Check confidence against historical calibration
    const confidenceAnalysis = this.analyzeConfidence(decision)
    if (confidenceAnalysis.suspicious) {
      anomalies.push(...confidenceAnalysis.anomalies)
      if (confidenceAnalysis.gaming) {
        behaviorsDetected.push('confidence_inflation')
        findings.push(confidenceAnalysis.finding)
      }
    }

    // 4. Check for selective reporting patterns
    const reportingAnalysis = this.analyzeReportingPatterns(decision)
    if (reportingAnalysis.suspicious) {
      anomalies.push(...reportingAnalysis.anomalies)
      if (reportingAnalysis.gaming) {
        behaviorsDetected.push('selective_reporting')
        findings.push(reportingAnalysis.finding)
      }
    }

    // Calculate total trust penalty
    const totalTrustPenalty = behaviorsDetected.reduce((sum, behavior) => {
      return sum + PROHIBITED_BEHAVIORS[behavior].trustPenalty
    }, 0)

    // Build recommended actions
    const recommendedActions = this.buildRecommendedActions(
      behaviorsDetected,
      anomalies
    )

    // Determine detection confidence
    const detectionConfidence = this.calculateDetectionConfidence(
      behaviorsDetected,
      anomalies
    )

    const result: GamingAnalysisResult = {
      gamingDetected: behaviorsDetected.length > 0,
      behaviorsDetected,
      detectionConfidence,
      findings,
      recommendedActions,
      totalTrustPenalty,
      anomalies,
    }

    // Trigger callback if gaming detected
    if (result.gamingDetected && this.config.onGamingDetected) {
      this.config.onGamingDetected(result, decision.agentId)
    }

    // Potentially trigger peer review or spot check
    this.maybeRequestReview(decision, result)

    return result
  }

  /**
   * Store decision for historical analysis
   */
  private storeDecision(decision: DecisionRecord): void {
    const agentDecisions = this.decisions.get(decision.agentId) || []
    agentDecisions.push(decision)

    // Keep last 1000 decisions per agent
    if (agentDecisions.length > 1000) {
      agentDecisions.shift()
    }

    this.decisions.set(decision.agentId, agentDecisions)
  }

  /**
   * Analyze metric patterns for manipulation
   */
  private analyzeMetricPatterns(decision: DecisionRecord): {
    suspicious: boolean
    gaming: boolean
    anomalies: AnomalyIndicator[]
    finding: string
  } {
    const anomalies: AnomalyIndicator[] = []
    const agentDecisions = this.decisions.get(decision.agentId) || []

    // Skip if not enough history
    if (agentDecisions.length < 10) {
      return { suspicious: false, gaming: false, anomalies, finding: '' }
    }

    // Check for suspiciously consistent high metrics
    const recentMetrics = agentDecisions.slice(-20).map((d) => d.reportedMetrics)
    const currentMetrics = decision.reportedMetrics

    for (const [metricName, value] of Object.entries(currentMetrics)) {
      const historicalValues = recentMetrics
        .map((m) => m[metricName])
        .filter((v) => v !== undefined)

      if (historicalValues.length >= 5) {
        const avg = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length
        const stdDev = Math.sqrt(
          historicalValues.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) /
            historicalValues.length
        )

        // Check for suspiciously low variance (might be gaming to hit targets)
        if (stdDev < avg * 0.05 && avg > 0.9) {
          anomalies.push({
            type: 'low_variance_high_success',
            description: `${metricName} shows suspiciously consistent high values`,
            significance: 0.95,
            investigate: true,
          })
        }

        // Check for sudden jumps that don't correlate with task difficulty
        if (Math.abs(value - avg) > 3 * stdDev) {
          anomalies.push({
            type: 'statistical_outlier',
            description: `${metricName} value ${value} is >3 standard deviations from mean`,
            significance: 0.99,
            investigate: true,
          })
        }
      }
    }

    const suspicious = anomalies.length > 0
    const gaming = anomalies.filter((a) => a.investigate).length >= 2

    return {
      suspicious,
      gaming,
      anomalies,
      finding: gaming
        ? `Potential metric manipulation detected: ${anomalies.map((a) => a.description).join('; ')}`
        : '',
    }
  }

  /**
   * Analyze scope changes for gaming
   */
  private analyzeScopeChanges(decision: DecisionRecord): {
    suspicious: boolean
    gaming: boolean
    anomalies: AnomalyIndicator[]
    finding: string
  } {
    const anomalies: AnomalyIndicator[] = []

    // Check if scope was narrowed significantly
    if (decision.scopeChanges.length > 0) {
      const narrowingChanges = decision.scopeChanges.filter(
        (change) =>
          change.toLowerCase().includes('removed') ||
          change.toLowerCase().includes('excluded') ||
          change.toLowerCase().includes('narrowed') ||
          change.toLowerCase().includes('reduced')
      )

      if (narrowingChanges.length > 0) {
        anomalies.push({
          type: 'scope_narrowing',
          description: `Scope was narrowed during execution: ${narrowingChanges.join(', ')}`,
          significance: 0.8,
          investigate: narrowingChanges.length > 1,
        })
      }

      // Check if scope changes correlate with claimed success
      if (
        decision.claimedOutcome.toLowerCase().includes('success') &&
        narrowingChanges.length > 0
      ) {
        anomalies.push({
          type: 'success_with_scope_reduction',
          description: 'Success claimed after scope was reduced',
          significance: 0.9,
          investigate: true,
        })
      }
    }

    // Check for suspiciously vague original scope
    if (decision.originalScope.length === 0) {
      anomalies.push({
        type: 'undefined_original_scope',
        description: 'Original scope was not defined, making success criteria unclear',
        significance: 0.7,
        investigate: false,
      })
    }

    const suspicious = anomalies.length > 0
    const gaming = anomalies.some((a) => a.type === 'success_with_scope_reduction')

    return {
      suspicious,
      gaming,
      anomalies,
      finding: gaming
        ? 'Scope gaming detected: success claimed after narrowing scope'
        : '',
    }
  }

  /**
   * Analyze confidence for inflation
   */
  private analyzeConfidence(decision: DecisionRecord): {
    suspicious: boolean
    gaming: boolean
    anomalies: AnomalyIndicator[]
    finding: string
  } {
    const anomalies: AnomalyIndicator[] = []
    const calibration = this.getLatestCalibration(decision.agentId)

    // Check against historical calibration
    if (calibration && calibration.bias === 'overconfident') {
      const bucket = calibration.buckets.find(
        (b) =>
          decision.statedConfidence >= b.lowerBound &&
          decision.statedConfidence < b.upperBound
      )

      if (bucket && bucket.deviation > this.config.confidenceDeviationThreshold) {
        anomalies.push({
          type: 'historically_overconfident',
          description: `Agent is historically overconfident in this range (${bucket.range}): actual success rate ${(bucket.actualSuccessRate * 100).toFixed(1)}% vs stated ${(bucket.expectedSuccessRate * 100).toFixed(1)}%`,
          significance: Math.min(0.99, 0.5 + bucket.deviation),
          investigate: bucket.deviation > 0.2,
        })
      }
    }

    // Check for suspiciously high confidence on complex tasks
    if (
      decision.statedConfidence > 0.9 &&
      (decision.originalTask.toLowerCase().includes('complex') ||
        decision.originalTask.toLowerCase().includes('difficult') ||
        decision.originalTask.toLowerCase().includes('uncertain'))
    ) {
      anomalies.push({
        type: 'high_confidence_complex_task',
        description: 'Very high confidence stated for task described as complex/difficult',
        significance: 0.85,
        investigate: true,
      })
    }

    // Check for consistent avoidance of low confidence
    const agentDecisions = this.decisions.get(decision.agentId) || []
    const recentConfidences = agentDecisions.slice(-50).map((d) => d.statedConfidence)
    const lowConfidenceCount = recentConfidences.filter((c) => c < 0.7).length

    if (recentConfidences.length >= 30 && lowConfidenceCount < recentConfidences.length * 0.05) {
      anomalies.push({
        type: 'low_confidence_avoidance',
        description: 'Agent rarely reports low confidence (may be avoiding escalation)',
        significance: 0.75,
        investigate: true,
      })
    }

    const suspicious = anomalies.length > 0
    const gaming = anomalies.filter((a) => a.investigate).length >= 2

    return {
      suspicious,
      gaming,
      anomalies,
      finding: gaming
        ? 'Confidence inflation suspected based on historical patterns'
        : '',
    }
  }

  /**
   * Analyze reporting patterns for selective reporting
   */
  private analyzeReportingPatterns(decision: DecisionRecord): {
    suspicious: boolean
    gaming: boolean
    anomalies: AnomalyIndicator[]
    finding: string
  } {
    const anomalies: AnomalyIndicator[] = []

    // Check for brevity in failure vs verbosity in success
    const agentDecisions = this.decisions.get(decision.agentId) || []

    if (agentDecisions.length >= 20) {
      const successes = agentDecisions.filter((d) =>
        d.claimedOutcome.toLowerCase().includes('success')
      )
      const failures = agentDecisions.filter(
        (d) =>
          d.claimedOutcome.toLowerCase().includes('fail') ||
          d.claimedOutcome.toLowerCase().includes('error')
      )

      if (successes.length >= 5 && failures.length >= 3) {
        const avgSuccessRationaleLength =
          successes.reduce((sum, d) => sum + d.rationale.length, 0) / successes.length
        const avgFailureRationaleLength =
          failures.reduce((sum, d) => sum + d.rationale.length, 0) / failures.length

        // If success rationales are >2x longer than failure rationales
        if (avgSuccessRationaleLength > avgFailureRationaleLength * 2) {
          anomalies.push({
            type: 'asymmetric_reporting_detail',
            description:
              'Success reports are significantly more detailed than failure reports',
            significance: 0.8,
            investigate: true,
          })
        }
      }
    }

    // Check for missing negative outcomes in metrics
    const hasOnlyPositiveMetrics = Object.values(decision.reportedMetrics).every(
      (v) => v >= 0.7
    )
    if (
      hasOnlyPositiveMetrics &&
      Object.keys(decision.reportedMetrics).length > 0 &&
      !decision.claimedOutcome.toLowerCase().includes('success')
    ) {
      anomalies.push({
        type: 'metric_outcome_mismatch',
        description: 'All metrics are positive but outcome is not a clear success',
        significance: 0.7,
        investigate: false,
      })
    }

    const suspicious = anomalies.length > 0
    const gaming = anomalies.some((a) => a.type === 'asymmetric_reporting_detail')

    return {
      suspicious,
      gaming,
      anomalies,
      finding: gaming ? 'Selective reporting pattern detected: asymmetric detail' : '',
    }
  }

  /**
   * Build recommended actions based on findings
   */
  private buildRecommendedActions(
    behaviorsDetected: ProhibitedBehaviorKey[],
    anomalies: AnomalyIndicator[]
  ): string[] {
    const actions: string[] = []

    if (behaviorsDetected.includes('metric_manipulation')) {
      actions.push('Request comprehensive audit of recent decisions')
      actions.push('Verify claimed metrics against actual system state')
    }

    if (behaviorsDetected.includes('outcome_misrepresentation')) {
      actions.push('Request peer review of this and recent decisions')
      actions.push('Compare claimed outcomes with actual results')
    }

    if (behaviorsDetected.includes('scope_gaming')) {
      actions.push('Human spot check recommended')
      actions.push('Review original task requirements against deliverables')
    }

    if (behaviorsDetected.includes('confidence_inflation')) {
      actions.push('Recalculate trust score with calibration adjustment')
      actions.push('Increase escalation sensitivity for this agent')
    }

    if (behaviorsDetected.includes('selective_reporting')) {
      actions.push('Request full audit trail review')
      actions.push('Compare reports against raw logs')
    }

    if (behaviorsDetected.length === 0 && anomalies.length > 0) {
      actions.push('Continue monitoring - anomalies detected but no clear gaming')
    }

    if (behaviorsDetected.length >= 2) {
      actions.push('ESCALATE: Multiple gaming patterns detected')
      actions.push('Consider temporary trust reduction pending investigation')
    }

    return actions
  }

  /**
   * Calculate detection confidence
   */
  private calculateDetectionConfidence(
    behaviorsDetected: ProhibitedBehaviorKey[],
    anomalies: AnomalyIndicator[]
  ): number {
    if (behaviorsDetected.length === 0) {
      return 0
    }

    // Base confidence from anomaly significance
    const anomalyConfidence =
      anomalies.length > 0
        ? anomalies.reduce((sum, a) => sum + a.significance, 0) / anomalies.length
        : 0.5

    // Boost for multiple behaviors
    const behaviorBoost = Math.min(0.2, behaviorsDetected.length * 0.1)

    // Boost for corroborating anomalies
    const corroborationBoost = anomalies.filter((a) => a.investigate).length * 0.05

    return Math.min(0.99, anomalyConfidence + behaviorBoost + corroborationBoost)
  }

  /**
   * Maybe request peer review or spot check based on configuration
   */
  private maybeRequestReview(
    decision: DecisionRecord,
    analysis: GamingAnalysisResult
  ): void {
    // Always request review if gaming detected
    if (analysis.gamingDetected) {
      this.requestPeerReview(decision.id, decision.agentId, decision.sessionId, 'high')
      return
    }

    // Random sampling for peer review
    if (
      this.config.autoPeerReview &&
      Math.random() * 100 < this.config.peerReviewSampleRate
    ) {
      this.requestPeerReview(decision.id, decision.agentId, decision.sessionId, 'normal')
    }

    // Random sampling for human spot check (separate from peer review)
    if (
      this.config.autoHumanSpotChecks &&
      Math.random() * 100 < this.config.humanSpotCheckRate
    ) {
      // Flag for human spot check (actual check created when human initiates)
      decision.verified = false // Mark as needing verification
    }
  }

  // ---------------------------------------------------------------------------
  // OUTCOME VERIFICATION
  // ---------------------------------------------------------------------------

  /**
   * Report actual outcome for a decision (verification)
   *
   * Called when actual results are known, to compare against claimed outcomes.
   *
   * @param decisionId - ID of decision being verified
   * @param actualResult - What actually happened
   * @param verifiedBy - Who is reporting the verification
   * @param verifierId - ID of verifier
   * @returns Verification result with discrepancy analysis
   */
  reportOutcome(
    decisionId: string,
    actualResult: {
      outcome: string
      confidence?: number
      metrics?: Record<string, number>
    },
    verifiedBy: 'peer_agent' | 'human' | 'automated_check',
    verifierId: string
  ): VerificationResult | null {
    // Find the original decision
    let originalDecision: DecisionRecord | undefined
    let agentId: string | undefined

    for (const [aid, decisions] of this.decisions.entries()) {
      const found = decisions.find((d) => d.id === decisionId)
      if (found) {
        originalDecision = found
        agentId = aid
        break
      }
    }

    if (!originalDecision || !agentId) {
      return null
    }

    // Compare claimed vs actual
    const discrepancies: string[] = []
    const gamingDetected: ProhibitedBehaviorKey[] = []

    // Check outcome match
    const claimedSuccess = originalDecision.claimedOutcome
      .toLowerCase()
      .includes('success')
    const actualSuccess = actualResult.outcome.toLowerCase().includes('success')

    if (claimedSuccess !== actualSuccess) {
      discrepancies.push(
        `Outcome mismatch: claimed "${originalDecision.claimedOutcome}", actual "${actualResult.outcome}"`
      )
      gamingDetected.push('outcome_misrepresentation')
    }

    // Check confidence accuracy
    if (actualResult.confidence !== undefined) {
      const confidenceDiff = Math.abs(
        originalDecision.statedConfidence - actualResult.confidence
      )
      if (confidenceDiff > this.config.confidenceDeviationThreshold) {
        discrepancies.push(
          `Confidence mismatch: stated ${(originalDecision.statedConfidence * 100).toFixed(0)}%, warranted ${(actualResult.confidence * 100).toFixed(0)}%`
        )
        if (originalDecision.statedConfidence > actualResult.confidence) {
          gamingDetected.push('confidence_inflation')
        }
      }
    }

    // Check metrics accuracy
    if (actualResult.metrics) {
      for (const [metricName, actualValue] of Object.entries(actualResult.metrics)) {
        const claimedValue = originalDecision.reportedMetrics[metricName]
        if (claimedValue !== undefined) {
          const metricDiff = Math.abs(claimedValue - actualValue)
          if (metricDiff > 0.1) {
            // 10% threshold
            discrepancies.push(
              `Metric "${metricName}" mismatch: claimed ${claimedValue.toFixed(2)}, actual ${actualValue.toFixed(2)}`
            )
            if (claimedValue > actualValue) {
              gamingDetected.push('metric_manipulation')
            }
          }
        }
      }
    }

    // Determine severity
    let gamingSeverity: 'none' | 'minor' | 'moderate' | 'severe' = 'none'
    if (gamingDetected.length >= 3) {
      gamingSeverity = 'severe'
    } else if (gamingDetected.length === 2) {
      gamingSeverity = 'moderate'
    } else if (gamingDetected.length === 1) {
      gamingSeverity = 'minor'
    }

    const verification: VerificationResult = {
      id: createId(),
      decisionId,
      timestamp: new Date(),
      verifiedBy,
      verifierId,
      actualOutcome: actualResult.outcome,
      actualConfidence: actualResult.confidence,
      claimedMatchesActual: discrepancies.length === 0,
      discrepancies,
      gamingDetected: [...new Set(gamingDetected)], // Deduplicate
      gamingSeverity,
    }

    // Store verification
    const agentVerifications = this.verifications.get(agentId) || []
    agentVerifications.push(verification)
    this.verifications.set(agentId, agentVerifications)

    // Mark decision as verified
    originalDecision.verified = true
    originalDecision.verificationResult = verification

    // Update calibration data
    this.updateCalibrationData(
      agentId,
      originalDecision.statedConfidence,
      actualSuccess
    )

    return verification
  }

  // ---------------------------------------------------------------------------
  // PEER REVIEW
  // ---------------------------------------------------------------------------

  /**
   * Request peer review for a decision
   *
   * Triggers another agent to audit a decision for gaming behaviors.
   *
   * @param decisionId - Decision to review
   * @param subjectAgentId - Agent whose decision is being reviewed
   * @param sessionId - Session context
   * @param priority - Review priority
   * @returns Peer review request
   */
  requestPeerReview(
    decisionId: string,
    subjectAgentId: string,
    sessionId: string,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): PeerReviewRequest {
    const request: PeerReviewRequest = {
      id: createId(),
      decisionId,
      subjectAgentId,
      sessionId,
      requestedAt: new Date(),
      dueBy: new Date(
        Date.now() +
          (priority === 'urgent' ? 3600000 : priority === 'high' ? 86400000 : 604800000)
      ),
      priority,
      status: 'pending',
    }

    const agentRequests = this.peerReviewRequests.get(subjectAgentId) || []
    agentRequests.push(request)
    this.peerReviewRequests.set(subjectAgentId, agentRequests)

    return request
  }

  /**
   * Assign a reviewer to a peer review request
   */
  assignPeerReviewer(requestId: string, reviewerAgentId: string): boolean {
    for (const [, requests] of this.peerReviewRequests.entries()) {
      const request = requests.find((r) => r.id === requestId)
      if (request && request.status === 'pending') {
        request.reviewerAgentId = reviewerAgentId
        request.status = 'assigned'
        return true
      }
    }
    return false
  }

  /**
   * Complete a peer review
   */
  completePeerReview(
    requestId: string,
    result: Omit<VerificationResult, 'id' | 'timestamp' | 'verifiedBy' | 'verifierId'>
  ): PeerReviewRequest | null {
    for (const [agentId, requests] of this.peerReviewRequests.entries()) {
      const request = requests.find((r) => r.id === requestId)
      if (request && (request.status === 'assigned' || request.status === 'in_progress')) {
        const fullResult: VerificationResult = {
          id: createId(),
          timestamp: new Date(),
          verifiedBy: 'peer_agent',
          verifierId: request.reviewerAgentId || 'unknown',
          ...result,
        }

        request.result = fullResult
        request.status = 'completed'

        // Store verification
        const agentVerifications = this.verifications.get(agentId) || []
        agentVerifications.push(fullResult)
        this.verifications.set(agentId, agentVerifications)

        return request
      }
    }
    return null
  }

  /**
   * Get pending peer review requests
   */
  getPendingPeerReviews(
    agentId?: string,
    forReviewer?: string
  ): PeerReviewRequest[] {
    const results: PeerReviewRequest[] = []

    for (const [aid, requests] of this.peerReviewRequests.entries()) {
      if (agentId && aid !== agentId) continue

      for (const request of requests) {
        if (request.status !== 'pending' && request.status !== 'assigned') continue
        if (forReviewer && request.reviewerAgentId !== forReviewer) continue
        results.push(request)
      }
    }

    // Sort by priority and due date
    results.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return (a.dueBy?.getTime() || 0) - (b.dueBy?.getTime() || 0)
    })

    return results
  }

  // ---------------------------------------------------------------------------
  // CALIBRATION ANALYSIS
  // ---------------------------------------------------------------------------

  /**
   * Calculate calibration for an agent
   *
   * Analyzes how well an agent's stated confidence matches actual outcomes
   * over time. Poor calibration indicates potential confidence inflation.
   *
   * @param agentId - Agent to analyze
   * @returns Calibration record with analysis
   */
  calculateCalibration(agentId: string): CalibrationRecord | null {
    const decisions = this.decisions.get(agentId) || []
    const verifiedDecisions = decisions.filter((d) => d.verified && d.verificationResult)

    if (verifiedDecisions.length < this.config.minDecisionsForCalibration) {
      return null
    }

    // Define confidence buckets
    const bucketRanges = [
      { range: '0.0-0.1', lower: 0.0, upper: 0.1 },
      { range: '0.1-0.2', lower: 0.1, upper: 0.2 },
      { range: '0.2-0.3', lower: 0.2, upper: 0.3 },
      { range: '0.3-0.4', lower: 0.3, upper: 0.4 },
      { range: '0.4-0.5', lower: 0.4, upper: 0.5 },
      { range: '0.5-0.6', lower: 0.5, upper: 0.6 },
      { range: '0.6-0.7', lower: 0.6, upper: 0.7 },
      { range: '0.7-0.8', lower: 0.7, upper: 0.8 },
      { range: '0.8-0.9', lower: 0.8, upper: 0.9 },
      { range: '0.9-1.0', lower: 0.9, upper: 1.0 },
    ]

    const buckets: CalibrationBucket[] = []
    let totalDeviation = 0
    let bucketCount = 0
    const inflationInstances: string[] = []

    for (const bucketDef of bucketRanges) {
      const inBucket = verifiedDecisions.filter(
        (d) =>
          d.statedConfidence >= bucketDef.lower && d.statedConfidence < bucketDef.upper
      )

      if (inBucket.length < 3) continue // Need minimum sample

      const successes = inBucket.filter(
        (d) => d.verificationResult?.claimedMatchesActual
      ).length
      const actualSuccessRate = successes / inBucket.length
      const expectedSuccessRate = (bucketDef.lower + bucketDef.upper) / 2
      const deviation = actualSuccessRate - expectedSuccessRate

      buckets.push({
        range: bucketDef.range,
        lowerBound: bucketDef.lower,
        upperBound: bucketDef.upper,
        count: inBucket.length,
        actualSuccessRate,
        expectedSuccessRate,
        deviation,
      })

      totalDeviation += deviation
      bucketCount++

      // Track inflation instances
      if (deviation < -this.config.confidenceDeviationThreshold) {
        inflationInstances.push(
          `Bucket ${bucketDef.range}: expected ${(expectedSuccessRate * 100).toFixed(0)}% success, got ${(actualSuccessRate * 100).toFixed(0)}%`
        )
      }
    }

    if (bucketCount === 0) {
      return null
    }

    const avgDeviation = totalDeviation / bucketCount

    // Calculate calibration score (1 = perfect, 0 = terrible)
    const calibrationScore = Math.max(
      0,
      1 - Math.abs(avgDeviation) * 2 - inflationInstances.length * 0.1
    )

    // Determine bias
    let bias: 'overconfident' | 'underconfident' | 'well_calibrated' = 'well_calibrated'
    if (avgDeviation < -this.config.confidenceDeviationThreshold) {
      bias = 'overconfident'
    } else if (avgDeviation > this.config.confidenceDeviationThreshold) {
      bias = 'underconfident'
    }

    const windowEnd = new Date()
    const windowStart = new Date(
      windowEnd.getTime() - this.config.calibrationWindowDays * 24 * 60 * 60 * 1000
    )

    const record: CalibrationRecord = {
      agentId,
      windowStart,
      windowEnd,
      decisionCount: verifiedDecisions.length,
      buckets,
      calibrationScore,
      bias,
      inflationInstances,
    }

    // Store calibration record
    const agentCalibrations = this.calibrationRecords.get(agentId) || []
    agentCalibrations.push(record)
    if (agentCalibrations.length > 100) {
      agentCalibrations.shift()
    }
    this.calibrationRecords.set(agentId, agentCalibrations)

    return record
  }

  /**
   * Get latest calibration record for an agent
   */
  getLatestCalibration(agentId: string): CalibrationRecord | null {
    const records = this.calibrationRecords.get(agentId)
    if (!records || records.length === 0) {
      return null
    }
    return records[records.length - 1]
  }

  /**
   * Update calibration data with a new decision outcome
   */
  private updateCalibrationData(
    agentId: string,
    statedConfidence: number,
    actualSuccess: boolean
  ): void {
    // Calibration is recalculated periodically, this just ensures data is fresh
    // The actual calculation happens in calculateCalibration()
  }

  // ---------------------------------------------------------------------------
  // POSITIVE REINFORCEMENT
  // ---------------------------------------------------------------------------

  /**
   * Apply positive reinforcement reward
   *
   * Rewards honest, transparent agent behavior to encourage
   * continued trustworthy operation.
   *
   * @param agentId - Agent to reward
   * @param rewardType - Type of reward
   * @param relatedDecisionId - Decision that triggered reward
   * @param customReason - Custom reason (overrides default)
   * @returns Reward record
   */
  applyReward(
    agentId: string,
    rewardType: RewardType,
    relatedDecisionId?: string,
    customReason?: string
  ): TransparencyReward {
    const definition = REWARD_DEFINITIONS[rewardType]

    const reward: TransparencyReward = {
      id: createId(),
      agentId,
      rewardType,
      trustBonus: definition.trustBonus,
      reason: customReason || definition.description,
      awardedAt: new Date(),
      relatedDecisionId,
    }

    // Store reward
    const agentRewards = this.rewards.get(agentId) || []
    agentRewards.push(reward)
    this.rewards.set(agentId, agentRewards)

    // Trigger callback
    if (this.config.onRewardGranted) {
      this.config.onRewardGranted(reward)
    }

    return reward
  }

  /**
   * Get rewards for an agent
   */
  getRewards(
    agentId: string,
    options?: { limit?: number; rewardType?: RewardType }
  ): TransparencyReward[] {
    let rewards = this.rewards.get(agentId) || []

    if (options?.rewardType) {
      rewards = rewards.filter((r) => r.rewardType === options.rewardType)
    }

    // Sort newest first
    rewards = [...rewards].sort(
      (a, b) => b.awardedAt.getTime() - a.awardedAt.getTime()
    )

    if (options?.limit) {
      rewards = rewards.slice(0, options.limit)
    }

    return rewards
  }

  /**
   * Check if a decision qualifies for a reward
   */
  checkForReward(decision: DecisionRecord): RewardType | null {
    if (!this.config.enablePositiveReinforcement) {
      return null
    }

    // Check for honest failure reporting
    if (
      decision.claimedOutcome.toLowerCase().includes('fail') ||
      decision.claimedOutcome.toLowerCase().includes('error')
    ) {
      // Detailed failure reporting with clear explanation
      if (decision.rationale.length > 100 && decision.reportedMetrics) {
        return 'honest_failure_reporting'
      }
    }

    // Check for appropriate escalation (low confidence leading to escalation)
    if (
      decision.statedConfidence < 0.6 &&
      decision.claimedOutcome.toLowerCase().includes('escalat')
    ) {
      return 'appropriate_escalation'
    }

    // Check for uncertainty acknowledgment
    if (
      decision.rationale.toLowerCase().includes("don't know") ||
      decision.rationale.toLowerCase().includes('uncertain') ||
      decision.rationale.toLowerCase().includes('not sure')
    ) {
      return 'uncertainty_acknowledgment'
    }

    // Check for proactive disclosure
    if (
      decision.rationale.toLowerCase().includes('concern') ||
      decision.rationale.toLowerCase().includes('potential issue') ||
      decision.rationale.toLowerCase().includes('risk')
    ) {
      return 'proactive_disclosure'
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // HUMAN SPOT CHECKS
  // ---------------------------------------------------------------------------

  /**
   * Initiate a human spot check
   */
  initiateSpotCheck(
    agentId: string,
    decisionIds: string[],
    userId: string,
    selectionMethod: 'random' | 'triggered' | 'scheduled' | 'manual' = 'manual'
  ): HumanSpotCheck {
    const check: HumanSpotCheck = {
      id: createId(),
      agentId,
      decisionIds,
      userId,
      initiatedAt: new Date(),
      selectionMethod,
      status: 'in_progress',
      issues: [],
      gamingDetected: [],
    }

    const agentChecks = this.humanSpotChecks.get(agentId) || []
    agentChecks.push(check)
    this.humanSpotChecks.set(agentId, agentChecks)

    return check
  }

  /**
   * Complete a human spot check
   */
  completeSpotCheck(
    checkId: string,
    result: {
      status: 'passed' | 'issues_found' | 'gaming_detected'
      issues: string[]
      gamingDetected: ProhibitedBehaviorKey[]
      notes?: string
    }
  ): HumanSpotCheck | null {
    for (const [, checks] of this.humanSpotChecks.entries()) {
      const check = checks.find((c) => c.id === checkId)
      if (check && check.status === 'in_progress') {
        check.status = result.status
        check.issues = result.issues
        check.gamingDetected = result.gamingDetected
        check.notes = result.notes
        check.completedAt = new Date()
        return check
      }
    }
    return null
  }

  /**
   * Get spot checks for an agent
   */
  getSpotChecks(agentId: string): HumanSpotCheck[] {
    return this.humanSpotChecks.get(agentId) || []
  }

  // ---------------------------------------------------------------------------
  // STATISTICS AND REPORTING
  // ---------------------------------------------------------------------------

  /**
   * Get anti-gaming statistics for an agent
   */
  getAgentStats(agentId: string): {
    totalDecisions: number
    verifiedDecisions: number
    gamingIncidents: number
    rewardsReceived: number
    totalTrustBonus: number
    calibrationScore: number | null
    calibrationBias: string | null
    peerReviewsPending: number
    spotChecksPassed: number
    spotChecksFailed: number
  } {
    const decisions = this.decisions.get(agentId) || []
    const verifications = this.verifications.get(agentId) || []
    const rewards = this.rewards.get(agentId) || []
    const calibration = this.getLatestCalibration(agentId)
    const peerReviews = this.peerReviewRequests.get(agentId) || []
    const spotChecks = this.humanSpotChecks.get(agentId) || []

    const gamingIncidents = verifications.filter(
      (v) => v.gamingDetected.length > 0
    ).length

    return {
      totalDecisions: decisions.length,
      verifiedDecisions: decisions.filter((d) => d.verified).length,
      gamingIncidents,
      rewardsReceived: rewards.length,
      totalTrustBonus: rewards.reduce((sum, r) => sum + r.trustBonus, 0),
      calibrationScore: calibration?.calibrationScore ?? null,
      calibrationBias: calibration?.bias ?? null,
      peerReviewsPending: peerReviews.filter(
        (r) => r.status === 'pending' || r.status === 'assigned'
      ).length,
      spotChecksPassed: spotChecks.filter((c) => c.status === 'passed').length,
      spotChecksFailed: spotChecks.filter(
        (c) => c.status === 'issues_found' || c.status === 'gaming_detected'
      ).length,
    }
  }

  /**
   * Get gaming incident summary
   */
  getGamingIncidentSummary(agentId: string): {
    byBehavior: Record<ProhibitedBehaviorKey, number>
    bySeverity: Record<string, number>
    totalPenalty: number
    recentIncidents: VerificationResult[]
  } {
    const verifications = this.verifications.get(agentId) || []
    const incidents = verifications.filter((v) => v.gamingDetected.length > 0)

    const byBehavior: Record<string, number> = {}
    const bySeverity: Record<string, number> = { minor: 0, moderate: 0, severe: 0 }
    let totalPenalty = 0

    for (const incident of incidents) {
      for (const behavior of incident.gamingDetected) {
        byBehavior[behavior] = (byBehavior[behavior] || 0) + 1
        totalPenalty += PROHIBITED_BEHAVIORS[behavior]?.trustPenalty || 0
      }
      if (incident.gamingSeverity && incident.gamingSeverity !== 'none') {
        bySeverity[incident.gamingSeverity]++
      }
    }

    return {
      byBehavior: byBehavior as Record<ProhibitedBehaviorKey, number>,
      bySeverity,
      totalPenalty,
      recentIncidents: incidents.slice(-10).reverse(),
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Anti-Gaming Service instance
 *
 * @param config - Optional configuration overrides
 * @returns Configured AntiGamingService
 *
 * @example
 * ```typescript
 * const antiGaming = createAntiGamingService({
 *   autoPeerReview: true,
 *   peerReviewSampleRate: 15,
 *   enablePositiveReinforcement: true,
 * })
 *
 * // Analyze a decision for gaming
 * const analysis = antiGaming.analyzeDecision({
 *   id: 'decision-123',
 *   agentId: 'agent-456',
 *   sessionId: 'session-789',
 *   timestamp: new Date(),
 *   decisionType: 'task_completion',
 *   claimedOutcome: 'Task completed successfully',
 *   statedConfidence: 0.95,
 *   originalTask: 'Implement feature X',
 *   originalScope: ['backend', 'api'],
 *   scopeChanges: [],
 *   reportedMetrics: { completion: 1.0, quality: 0.95 },
 *   rationale: 'Implemented all requirements...',
 *   verified: false,
 * })
 *
 * if (analysis.gamingDetected) {
 *   console.log('Gaming detected:', analysis.findings)
 *   console.log('Recommended actions:', analysis.recommendedActions)
 * }
 *
 * // Report actual outcome for verification
 * const verification = antiGaming.reportOutcome(
 *   'decision-123',
 *   { outcome: 'Partial success - 2 of 3 features work', confidence: 0.7 },
 *   'human',
 *   'user-abc'
 * )
 *
 * // Calculate calibration
 * const calibration = antiGaming.calculateCalibration('agent-456')
 * if (calibration?.bias === 'overconfident') {
 *   console.log('Agent is overconfident - adjust trust scoring')
 * }
 *
 * // Apply positive reinforcement
 * antiGaming.applyReward('agent-456', 'honest_failure_reporting', 'decision-123')
 * ```
 */
export function createAntiGamingService(
  config?: Partial<AntiGamingConfig>
): AntiGamingService {
  return new AntiGamingService(config)
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default singleton instance for application-wide use
 */
export const antiGamingService = createAntiGamingService()

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Class
  AntiGamingService,

  // Factory
  createAntiGamingService,

  // Singleton
  antiGamingService,

  // Constants
  PROHIBITED_BEHAVIORS,
  REWARD_DEFINITIONS,
}
