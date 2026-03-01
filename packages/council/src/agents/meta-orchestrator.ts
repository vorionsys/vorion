/**
 * Meta-Orchestrator Agents (2 agents)
 * Monitor costs, performance, and system health
 *
 * Features:
 * - Real-time cost / latency / success rate tracking
 * - File-based persistence (`.vorion/metrics/`)
 * - Anomaly detection via rolling averages
 * - Severity-based alerting (info / warning / critical)
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

interface AggregateStats {
  count: number
  avgCost: number
  avgTime: number
  successRate: number
  lastUpdated: number
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
