/**
 * Meta-Orchestrator Agents (2 agents)
 * Monitor costs, performance, and system health
 *
 * Features:
 * - Real-time cost / latency / success rate tracking
 * - File-based persistence (`.vorion/metrics/`)
 * - Anomaly detection via rolling averages
 * - Severity-based alerting (info / warning / critical)
 * - System health assessment (healthy / degraded / unhealthy)
 * - Route optimization recommendations based on metrics history
 * - Council-integrated monitor() method returning updated CouncilState
 */

import * as fs from 'fs'
import * as path from 'path'
import type { CouncilState } from '../types/index.js'

// =============================================================================
// Types
// =============================================================================

export interface MetricsSnapshot {
  requestId: string
  totalCost: number
  totalTime: number
  compliancePassed: boolean
  qaPassed: boolean
  errorCount: number
  iterationCount: number
  timestamp: number
}

export interface MetricsAlert {
  severity: 'info' | 'warning' | 'critical'
  type: string
  message: string
  value: number
  threshold: number
  timestamp: number
}

export interface AggregateStats {
  count: number
  avgCost: number
  avgTime: number
  successRate: number
  lastUpdated: number
}

export type HealthStatusLevel = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthStatus {
  status: HealthStatusLevel
  score: number // 0-100 where 100 is perfect health
  reasons: string[]
  recommendations: string[]
  timestamp: number
}

export interface OptimizationRecommendation {
  category: 'cost' | 'latency' | 'reliability' | 'quality'
  priority: 'low' | 'medium' | 'high'
  recommendation: string
  expectedImpact: string
  basedOn: string // description of the metric driving this recommendation
}

// =============================================================================
// Configuration
// =============================================================================

const ALERT_THRESHOLDS = {
  /** Cost exceeds this USD amount */
  costWarning: 0.50,
  costCritical: 2.00,
  /** Latency exceeds this many milliseconds */
  latencyWarning: 10_000,
  latencyCritical: 30_000,
  /** QA + compliance failure rate (0-1) above this triggers alert */
  failureRateWarning: 0.20,
  failureRateCritical: 0.50,
}

// =============================================================================
// Agent
// =============================================================================

export class MetaOrchestratorAgent {
  private agentId: string
  private storePath: string
  private recentSnapshots: MetricsSnapshot[] = []
  private alerts: MetricsAlert[] = []

  constructor(agentId: string = 'meta_1', storePath: string = '.vorion/metrics') {
    this.agentId = agentId
    this.storePath = storePath
    this.ensureStoreExists()
    this.loadRecentSnapshots()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  trackMetrics(state: CouncilState): { alerts: MetricsAlert[] } {
    const tag = `[${this.agentId.toUpperCase()}]`
    console.log(`${tag} Tracking metrics...`)

    const snapshot: MetricsSnapshot = {
      requestId: state.requestId,
      totalCost: state.output?.totalCost || 0,
      totalTime: state.output?.totalTime || 0,
      compliancePassed: state.compliance?.passed ?? true,
      qaPassed: state.qa?.passed ?? true,
      errorCount: state.errors.length,
      iterationCount: state.iterationCount,
      timestamp: Date.now(),
    }

    console.log(`${tag} Metrics:`, JSON.stringify(snapshot))

    // Persist snapshot to disk
    this.persistSnapshot(snapshot)

    // Update rolling window (keep last 100)
    this.recentSnapshots.push(snapshot)
    if (this.recentSnapshots.length > 100) {
      this.recentSnapshots = this.recentSnapshots.slice(-100)
    }

    // Run anomaly detection and collect alerts
    const newAlerts = this.detectAnomalies(snapshot)
    this.alerts.push(...newAlerts)

    if (newAlerts.length > 0) {
      for (const alert of newAlerts) {
        const icon = alert.severity === 'critical' ? 'CRITICAL' : alert.severity === 'warning' ? 'WARN' : 'INFO'
        console.log(`${tag} [${icon}] ${alert.message}`)
      }
      this.persistAlerts(newAlerts)
    }

    // Persist aggregate stats
    this.persistAggregateStats()

    return { alerts: newAlerts }
  }

  getAlerts(): MetricsAlert[] {
    return this.alerts
  }

  getAggregateStats(): AggregateStats {
    const snapshots = this.recentSnapshots
    if (snapshots.length === 0) {
      return { count: 0, avgCost: 0, avgTime: 0, successRate: 1, lastUpdated: Date.now() }
    }

    const count = snapshots.length
    const avgCost = snapshots.reduce((s, m) => s + m.totalCost, 0) / count
    const avgTime = snapshots.reduce((s, m) => s + m.totalTime, 0) / count
    const successes = snapshots.filter(m => m.compliancePassed && m.qaPassed).length
    const successRate = successes / count

    return { count, avgCost, avgTime, successRate, lastUpdated: Date.now() }
  }

  /**
   * Assess overall system health based on aggregate metrics and recent alerts.
   *
   * Health scoring:
   * - Starts at 100 and deducts points for poor metrics
   * - >= 80 = healthy, 50-79 = degraded, < 50 = unhealthy
   */
  getHealthStatus(): HealthStatus {
    const tag = `[${this.agentId.toUpperCase()}]`
    console.log(`${tag} Assessing system health...`)

    const stats = this.getAggregateStats()
    const reasons: string[] = []
    const recommendations: string[] = []
    let score = 100

    // --- Evaluate success rate ---
    if (stats.count >= 3) {
      if (stats.successRate < 0.5) {
        score -= 40
        reasons.push(`Critical failure rate: ${((1 - stats.successRate) * 100).toFixed(0)}% of recent requests failed QA or compliance`)
        recommendations.push('Investigate root cause of widespread failures; consider pausing non-critical traffic')
      } else if (stats.successRate < 0.8) {
        score -= 20
        reasons.push(`Elevated failure rate: ${((1 - stats.successRate) * 100).toFixed(0)}% of recent requests failed`)
        recommendations.push('Review compliance and QA feedback for recurring issues')
      }
    }

    // --- Evaluate average cost ---
    if (stats.avgCost >= ALERT_THRESHOLDS.costCritical) {
      score -= 25
      reasons.push(`Average cost $${stats.avgCost.toFixed(2)} exceeds critical threshold`)
      recommendations.push('Switch to more cost-efficient models for low-priority tasks')
    } else if (stats.avgCost >= ALERT_THRESHOLDS.costWarning) {
      score -= 10
      reasons.push(`Average cost $${stats.avgCost.toFixed(2)} above warning threshold`)
      recommendations.push('Consider caching frequent queries to reduce cost')
    }

    // --- Evaluate average latency ---
    if (stats.avgTime >= ALERT_THRESHOLDS.latencyCritical) {
      score -= 25
      reasons.push(`Average latency ${stats.avgTime.toFixed(0)}ms exceeds critical threshold`)
      recommendations.push('Route time-sensitive requests to faster models; investigate bottlenecks')
    } else if (stats.avgTime >= ALERT_THRESHOLDS.latencyWarning) {
      score -= 10
      reasons.push(`Average latency ${stats.avgTime.toFixed(0)}ms above warning threshold`)
      recommendations.push('Enable request batching or reduce max token limits for faster responses')
    }

    // --- Evaluate recent critical alerts ---
    const recentWindow = Date.now() - 5 * 60 * 1000 // last 5 minutes
    const recentCritical = this.alerts.filter(a => a.severity === 'critical' && a.timestamp >= recentWindow)
    if (recentCritical.length >= 3) {
      score -= 15
      reasons.push(`${recentCritical.length} critical alerts in the last 5 minutes`)
      recommendations.push('Activate circuit breaker; escalate to on-call team')
    } else if (recentCritical.length >= 1) {
      score -= 5
      reasons.push(`${recentCritical.length} critical alert(s) in the last 5 minutes`)
      recommendations.push('Monitor closely for further degradation')
    }

    // --- Evaluate error density ---
    const recentSnapshots = this.recentSnapshots.slice(-10)
    if (recentSnapshots.length >= 3) {
      const avgErrors = recentSnapshots.reduce((sum, s) => sum + s.errorCount, 0) / recentSnapshots.length
      if (avgErrors >= 3) {
        score -= 15
        reasons.push(`Average of ${avgErrors.toFixed(1)} errors per request in recent window`)
        recommendations.push('Review error logs; high error counts may indicate upstream provider issues')
      } else if (avgErrors >= 1) {
        score -= 5
        reasons.push(`Average of ${avgErrors.toFixed(1)} errors per request in recent window`)
        recommendations.push('Investigate intermittent errors to prevent escalation')
      }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score))

    // Determine status level
    let status: HealthStatusLevel
    if (score >= 80) {
      status = 'healthy'
    } else if (score >= 50) {
      status = 'degraded'
    } else {
      status = 'unhealthy'
    }

    // If everything is perfect, say so
    if (reasons.length === 0) {
      reasons.push('All metrics within normal parameters')
    }

    const healthStatus: HealthStatus = {
      status,
      score,
      reasons,
      recommendations,
      timestamp: Date.now(),
    }

    console.log(`${tag} Health status: ${status} (score: ${score})`)
    return healthStatus
  }

  /**
   * Produce actionable route-optimization recommendations based on metrics history.
   *
   * Analyzes cost, latency, reliability, and quality trends to suggest routing
   * adjustments that the council workflow can act on.
   */
  getOptimizationRecommendations(): OptimizationRecommendation[] {
    const tag = `[${this.agentId.toUpperCase()}]`
    console.log(`${tag} Generating optimization recommendations...`)

    const stats = this.getAggregateStats()
    const recommendations: OptimizationRecommendation[] = []

    // Not enough data to make recommendations
    if (stats.count < 2) {
      console.log(`${tag} Insufficient data for optimization (${stats.count} snapshots)`)
      return recommendations
    }

    // --- Cost optimization ---
    if (stats.avgCost >= ALERT_THRESHOLDS.costCritical) {
      recommendations.push({
        category: 'cost',
        priority: 'high',
        recommendation: 'Route low-priority and simple-complexity tasks to cost-efficient models (e.g. general/fast instead of reasoning/complex)',
        expectedImpact: 'Reduce average request cost by 40-60%',
        basedOn: `Average cost $${stats.avgCost.toFixed(2)} exceeds critical threshold $${ALERT_THRESHOLDS.costCritical.toFixed(2)}`,
      })
    } else if (stats.avgCost >= ALERT_THRESHOLDS.costWarning) {
      recommendations.push({
        category: 'cost',
        priority: 'medium',
        recommendation: 'Enable response caching for repeated or similar queries to reduce redundant LLM calls',
        expectedImpact: 'Reduce average request cost by 15-30%',
        basedOn: `Average cost $${stats.avgCost.toFixed(2)} exceeds warning threshold $${ALERT_THRESHOLDS.costWarning.toFixed(2)}`,
      })
    }

    // --- Latency optimization ---
    if (stats.avgTime >= ALERT_THRESHOLDS.latencyCritical) {
      recommendations.push({
        category: 'latency',
        priority: 'high',
        recommendation: 'Reduce max token limits for non-critical tasks and parallelize independent plan steps',
        expectedImpact: 'Reduce average latency by 30-50%',
        basedOn: `Average latency ${stats.avgTime.toFixed(0)}ms exceeds critical threshold ${ALERT_THRESHOLDS.latencyCritical}ms`,
      })
    } else if (stats.avgTime >= ALERT_THRESHOLDS.latencyWarning) {
      recommendations.push({
        category: 'latency',
        priority: 'medium',
        recommendation: 'Use streaming responses for long-running tasks and set tighter timeouts on advisory consultations',
        expectedImpact: 'Reduce perceived latency by 20-35%',
        basedOn: `Average latency ${stats.avgTime.toFixed(0)}ms exceeds warning threshold ${ALERT_THRESHOLDS.latencyWarning}ms`,
      })
    }

    // --- Reliability optimization ---
    if (stats.successRate < 0.5) {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        recommendation: 'Enable automatic retry with fallback providers; add circuit breakers for consistently failing upstream services',
        expectedImpact: 'Improve success rate by 20-40 percentage points',
        basedOn: `Success rate ${(stats.successRate * 100).toFixed(0)}% is below 50%`,
      })
    } else if (stats.successRate < 0.8) {
      recommendations.push({
        category: 'reliability',
        priority: 'medium',
        recommendation: 'Add retry logic for transient failures and increase compliance check timeout',
        expectedImpact: 'Improve success rate by 10-20 percentage points',
        basedOn: `Success rate ${(stats.successRate * 100).toFixed(0)}% is below 80%`,
      })
    }

    // --- Quality optimization based on iteration counts ---
    const recentSnapshots = this.recentSnapshots.slice(-10)
    if (recentSnapshots.length >= 3) {
      const avgIterations = recentSnapshots.reduce((sum, s) => sum + s.iterationCount, 0) / recentSnapshots.length
      if (avgIterations >= 3) {
        recommendations.push({
          category: 'quality',
          priority: 'high',
          recommendation: 'Improve system prompts and increase temperature precision to reduce QA revision cycles',
          expectedImpact: 'Reduce average iteration count from ' + avgIterations.toFixed(1) + ' to under 2',
          basedOn: `Average iteration count ${avgIterations.toFixed(1)} indicates repeated QA failures`,
        })
      } else if (avgIterations >= 2) {
        recommendations.push({
          category: 'quality',
          priority: 'low',
          recommendation: 'Fine-tune QA scoring thresholds to balance quality with throughput',
          expectedImpact: 'Reduce unnecessary revision cycles by 20-30%',
          basedOn: `Average iteration count ${avgIterations.toFixed(1)} suggests room for prompt improvement`,
        })
      }
    }

    console.log(`${tag} Generated ${recommendations.length} optimization recommendation(s)`)
    return recommendations
  }

  /**
   * Primary council-integration method.
   *
   * Follows the same pattern as other council agents (MasterPlannerAgent.plan,
   * ComplianceAgent.check, RoutingAgent.route, QAAgent.review,
   * HumanGatewayOrchestrator.checkEscalation) by accepting and returning
   * CouncilState.
   *
   * Responsibilities:
   * 1. Track metrics for the current request
   * 2. Assess overall system health
   * 3. Produce route-optimization recommendations
   * 4. Attach monitoring metadata to the state
   * 5. Transition to 'failed' if system is unhealthy and the request has errors
   */
  monitor(state: CouncilState): CouncilState {
    const tag = `[${this.agentId.toUpperCase()}]`
    console.log(`${tag} Running full monitoring cycle for request ${state.requestId}...`)

    // Step 1: Track metrics (creates snapshot, detects anomalies, persists)
    const { alerts: newAlerts } = this.trackMetrics(state)

    // Step 2: Assess health
    const health = this.getHealthStatus()

    // Step 3: Get optimization recommendations
    const optimizations = this.getOptimizationRecommendations()

    // Step 4: Decide if monitoring warrants a state transition
    //   - If the system is unhealthy AND this request itself has errors, mark failed
    //   - If the system is degraded, add a warning-level error but allow continuation
    //   - Otherwise, pass through the current step unchanged
    const errors = [...state.errors]
    let nextStep = state.currentStep

    if (health.status === 'unhealthy' && state.errors.length > 0) {
      errors.push({
        step: state.currentStep,
        message: `System unhealthy (score ${health.score}): ${health.reasons.join('; ')}`,
        agentId: this.agentId,
        timestamp: new Date(),
        severity: 'critical',
      })
      nextStep = 'failed'
    } else if (health.status === 'degraded') {
      errors.push({
        step: state.currentStep,
        message: `System degraded (score ${health.score}): ${health.reasons.join('; ')}`,
        agentId: this.agentId,
        timestamp: new Date(),
        severity: 'warning',
      })
    }

    // Step 5: If critical alerts fired for this request, also add them as errors
    for (const alert of newAlerts.filter(a => a.severity === 'critical')) {
      errors.push({
        step: state.currentStep,
        message: alert.message,
        agentId: this.agentId,
        timestamp: new Date(),
        severity: 'critical',
      })
    }

    console.log(`${tag} Monitoring complete. Health: ${health.status}, Alerts: ${newAlerts.length}, Optimizations: ${optimizations.length}`)

    return {
      ...state,
      errors,
      currentStep: nextStep,
      updatedAt: new Date(),
    }
  }

  // ---------------------------------------------------------------------------
  // Anomaly Detection
  // ---------------------------------------------------------------------------

  private detectAnomalies(snapshot: MetricsSnapshot): MetricsAlert[] {
    const alerts: MetricsAlert[] = []
    const now = Date.now()

    // Cost alerts
    if (snapshot.totalCost >= ALERT_THRESHOLDS.costCritical) {
      alerts.push({
        severity: 'critical',
        type: 'cost_exceeded',
        message: `Request ${snapshot.requestId} cost $${snapshot.totalCost.toFixed(2)} exceeds critical threshold`,
        value: snapshot.totalCost,
        threshold: ALERT_THRESHOLDS.costCritical,
        timestamp: now,
      })
    } else if (snapshot.totalCost >= ALERT_THRESHOLDS.costWarning) {
      alerts.push({
        severity: 'warning',
        type: 'cost_elevated',
        message: `Request ${snapshot.requestId} cost $${snapshot.totalCost.toFixed(2)} exceeds warning threshold`,
        value: snapshot.totalCost,
        threshold: ALERT_THRESHOLDS.costWarning,
        timestamp: now,
      })
    }

    // Latency alerts
    if (snapshot.totalTime >= ALERT_THRESHOLDS.latencyCritical) {
      alerts.push({
        severity: 'critical',
        type: 'latency_exceeded',
        message: `Request ${snapshot.requestId} took ${snapshot.totalTime}ms (critical)`,
        value: snapshot.totalTime,
        threshold: ALERT_THRESHOLDS.latencyCritical,
        timestamp: now,
      })
    } else if (snapshot.totalTime >= ALERT_THRESHOLDS.latencyWarning) {
      alerts.push({
        severity: 'warning',
        type: 'latency_elevated',
        message: `Request ${snapshot.requestId} took ${snapshot.totalTime}ms (warning)`,
        value: snapshot.totalTime,
        threshold: ALERT_THRESHOLDS.latencyWarning,
        timestamp: now,
      })
    }

    // Rolling failure rate
    const stats = this.getAggregateStats()
    const failureRate = 1 - stats.successRate
    if (stats.count >= 5) {
      if (failureRate >= ALERT_THRESHOLDS.failureRateCritical) {
        alerts.push({
          severity: 'critical',
          type: 'failure_rate_critical',
          message: `Rolling failure rate ${(failureRate * 100).toFixed(0)}% exceeds critical threshold`,
          value: failureRate,
          threshold: ALERT_THRESHOLDS.failureRateCritical,
          timestamp: now,
        })
      } else if (failureRate >= ALERT_THRESHOLDS.failureRateWarning) {
        alerts.push({
          severity: 'warning',
          type: 'failure_rate_elevated',
          message: `Rolling failure rate ${(failureRate * 100).toFixed(0)}% exceeds warning threshold`,
          value: failureRate,
          threshold: ALERT_THRESHOLDS.failureRateWarning,
          timestamp: now,
        })
      }
    }

    // Compliance / QA failure on this request
    if (!snapshot.compliancePassed || !snapshot.qaPassed) {
      alerts.push({
        severity: 'info',
        type: 'quality_failure',
        message: `Request ${snapshot.requestId}: compliance=${snapshot.compliancePassed}, qa=${snapshot.qaPassed}`,
        value: 0,
        threshold: 0,
        timestamp: now,
      })
    }

    return alerts
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private ensureStoreExists(): void {
    try {
      if (!fs.existsSync(this.storePath)) {
        fs.mkdirSync(this.storePath, { recursive: true })
      }
    } catch {
      // Ignore — storage is best-effort
    }
  }

  private persistSnapshot(snapshot: MetricsSnapshot): void {
    try {
      const file = path.join(this.storePath, `snapshot-${snapshot.requestId}.json`)
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2))
    } catch {
      // Ignore persistence errors
    }
  }

  private persistAlerts(alerts: MetricsAlert[]): void {
    try {
      const file = path.join(this.storePath, 'alerts.json')
      let existing: MetricsAlert[] = []
      if (fs.existsSync(file)) {
        existing = JSON.parse(fs.readFileSync(file, 'utf-8'))
      }
      // Keep last 500 alerts
      const merged = [...existing, ...alerts].slice(-500)
      fs.writeFileSync(file, JSON.stringify(merged, null, 2))
    } catch {
      // Ignore persistence errors
    }
  }

  private persistAggregateStats(): void {
    try {
      const file = path.join(this.storePath, 'aggregate-stats.json')
      fs.writeFileSync(file, JSON.stringify(this.getAggregateStats(), null, 2))
    } catch {
      // Ignore persistence errors
    }
  }

  private loadRecentSnapshots(): void {
    try {
      const files = fs.readdirSync(this.storePath).filter(f => f.startsWith('snapshot-'))
      // Load last 100 by modification time
      const sorted = files
        .map(f => ({ file: f, mtime: fs.statSync(path.join(this.storePath, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime)
        .slice(-100)

      for (const entry of sorted) {
        try {
          const raw = fs.readFileSync(path.join(this.storePath, entry.file), 'utf-8')
          this.recentSnapshots.push(JSON.parse(raw))
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // No prior snapshots
    }
  }

  // ---------------------------------------------------------------------------
  // Static config
  // ---------------------------------------------------------------------------

  static getConfig(agentNumber: number) {
    return {
      id: `meta_${agentNumber}`,
      name: `Meta-Orchestrator ${agentNumber}`,
      role: 'meta_orchestrator' as const,
      description: 'Monitors costs, performance, and system health',
      capabilities: [
        'Cost tracking',
        'Performance monitoring',
        'Route optimization',
        'Anomaly detection',
        'System health checks'
      ],
      model: 'general/fast',
      systemPrompt: 'Monitor system metrics and optimize routing rules.'
    }
  }
}
