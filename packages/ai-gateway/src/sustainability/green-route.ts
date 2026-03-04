/**
 * Green Route - Sustainability-Aware Model Selection
 * Prioritizes energy-efficient models for cost and carbon reduction
 * Implements 2025 best practices for carbon-aware computing
 */

import { carbonTracker } from './carbon-tracker.js'

export interface GreenRoutingPolicy {
  enabled: boolean
  minPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' // Only route tasks at or below this priority
  carbonBudget?: number // kg CO2e per day
  offPeakOnly: boolean // Only use green routing during off-peak hours
  trackSavings: boolean
}

export interface GreenRouteDecision {
  useGreenRoute: boolean
  recommendedModel: string
  recommendedProvider: string
  reason: string
  estimatedCarbon: number // kg CO2e
  estimatedSavings?: number // kg CO2e saved vs. default
}

/** In-memory record of a single routing decision */
interface RoutingRecord {
  timestamp: Date
  useGreenRoute: boolean
  recommendedModel: string
  recommendedProvider: string
  estimatedCarbon: number // kg CO2e
  estimatedSavings: number // kg CO2e saved vs. default (0 when not green-routed)
  estimatedEnergySavings: number // kWh saved vs. default (0 when not green-routed)
}

/**
 * Green Router
 * Makes sustainability-aware routing decisions
 */
export class GreenRouter {
  private policy: GreenRoutingPolicy = {
    enabled: true,
    minPriority: 'MEDIUM', // Route LOW and MEDIUM priority tasks through green models
    offPeakOnly: false,
    trackSavings: true,
  }

  /** In-memory accumulator of all routing decisions */
  private routingRecords: RoutingRecord[] = []

  /**
   * Update routing policy
   */
  setPolicy(policy: Partial<GreenRoutingPolicy>): void {
    this.policy = { ...this.policy, ...policy }
    console.log('[GREEN_ROUTE] Policy updated:', this.policy)
  }

  /**
   * Get current policy
   */
  getPolicy(): GreenRoutingPolicy {
    return { ...this.policy }
  }

  /**
   * Make green routing decision and record it for statistics
   */
  async routeRequest(request: {
    taskType: string
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    estimatedTokens: number
    requiredCapabilities?: string[]
  }): Promise<GreenRouteDecision> {
    let decision: GreenRouteDecision

    // Check if green routing is enabled
    if (!this.policy.enabled) {
      decision = this.getDefaultRoute(request)
      this.recordRouting(decision, request.estimatedTokens, request.priority)
      return decision
    }

    // Check if task priority is eligible
    if (!this.isPriorityEligible(request.priority)) {
      decision = this.getDefaultRoute(request)
      this.recordRouting(decision, request.estimatedTokens, request.priority)
      return decision
    }

    // Check if we're in off-peak hours (if required)
    if (this.policy.offPeakOnly) {
      const isOffPeak = await carbonTracker.isLowEmissionPeriod()
      if (!isOffPeak) {
        decision = {
          useGreenRoute: false,
          ...this.getStandardModel(request),
          reason: 'Off-peak only policy, currently peak hours',
        }
        this.recordRouting(decision, request.estimatedTokens, request.priority)
        return decision
      }
    }

    // Get green recommendation
    const recommendation = await carbonTracker.getGreenRecommendation(
      request.taskType,
      request.priority
    )

    // Calculate estimated carbon
    const estimatedCarbon = this.estimateCarbon(
      recommendation.provider,
      recommendation.model,
      request.estimatedTokens
    )

    // Calculate savings vs. default
    const defaultModel = this.getDefaultModelForPriority(request.priority)
    const defaultCarbon = this.estimateCarbon(
      defaultModel.provider,
      defaultModel.model,
      request.estimatedTokens
    )

    const savings = defaultCarbon - estimatedCarbon
    const savingsPercent = defaultCarbon > 0 ? (savings / defaultCarbon) * 100 : 0

    decision = {
      useGreenRoute: true,
      recommendedModel: recommendation.model,
      recommendedProvider: recommendation.provider,
      reason: `${recommendation.reason} (${savingsPercent.toFixed(1)}% carbon reduction)`,
      estimatedCarbon,
      estimatedSavings: savings,
    }

    this.recordRouting(decision, request.estimatedTokens, request.priority)
    return decision
  }

  /**
   * Record a routing decision in the in-memory accumulator.
   * Computes energy savings by comparing the green model's energy against
   * the default model for the given priority.
   */
  private recordRouting(
    decision: GreenRouteDecision,
    estimatedTokens: number,
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): void {
    let estimatedEnergySavings = 0

    if (decision.useGreenRoute && priority) {
      const greenEnergy = this.estimateEnergy(
        decision.recommendedProvider,
        decision.recommendedModel,
        estimatedTokens
      )

      const defaultModel = this.getDefaultModelForPriority(priority)
      const defaultEnergy = this.estimateEnergy(
        defaultModel.provider,
        defaultModel.model,
        estimatedTokens
      )

      estimatedEnergySavings = defaultEnergy - greenEnergy
    }

    this.routingRecords.push({
      timestamp: new Date(),
      useGreenRoute: decision.useGreenRoute,
      recommendedModel: decision.recommendedModel,
      recommendedProvider: decision.recommendedProvider,
      estimatedCarbon: decision.estimatedCarbon,
      estimatedSavings: decision.estimatedSavings ?? 0,
      estimatedEnergySavings,
    })
  }

  /**
   * Check if priority is eligible for green routing
   */
  private isPriorityEligible(priority: string): boolean {
    const priorityOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const taskPriorityIndex = priorityOrder.indexOf(priority)
    const policyPriorityIndex = priorityOrder.indexOf(this.policy.minPriority)

    return taskPriorityIndex <= policyPriorityIndex
  }

  /**
   * Get default route (no green optimization)
   */
  private getDefaultRoute(request: {
    priority: string
    estimatedTokens: number
  }): GreenRouteDecision {
    const defaultModel = this.getDefaultModelForPriority(
      request.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    )

    const estimatedCarbon = this.estimateCarbon(
      defaultModel.provider,
      defaultModel.model,
      request.estimatedTokens
    )

    return {
      useGreenRoute: false,
      recommendedModel: defaultModel.model,
      recommendedProvider: defaultModel.provider,
      reason: 'Default routing (green route not applicable)',
      estimatedCarbon,
    }
  }

  /**
   * Get standard model for comparison
   */
  private getStandardModel(request: {
    priority: string
    estimatedTokens: number
  }): {
    recommendedModel: string
    recommendedProvider: string
    estimatedCarbon: number
  } {
    const model = this.getDefaultModelForPriority(
      request.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    )
    const estimatedCarbon = this.estimateCarbon(
      model.provider,
      model.model,
      request.estimatedTokens
    )

    return {
      recommendedModel: model.model,
      recommendedProvider: model.provider,
      estimatedCarbon,
    }
  }

  /**
   * Get default model for priority level
   */
  private getDefaultModelForPriority(
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): { provider: string; model: string } {
    switch (priority) {
      case 'LOW':
        return { provider: 'google', model: 'gemini-2.5-flash' }
      case 'MEDIUM':
        return { provider: 'google', model: 'gemini-2.5-pro' }
      case 'HIGH':
        return { provider: 'anthropic', model: 'claude-sonnet-4-5' }
      case 'CRITICAL':
        return { provider: 'anthropic', model: 'claude-opus-4' }
    }
  }

  /**
   * Estimate carbon for a request without recording it in the tracker.
   * Uses computeMetrics() so estimates never pollute tracked data.
   */
  private estimateCarbon(
    provider: string,
    model: string,
    tokens: number
  ): number {
    const metrics = carbonTracker.computeMetrics(
      provider,
      model,
      tokens * 0.7, // Assume 70% input tokens
      tokens * 0.3, // Assume 30% output tokens
      0
    )

    return metrics.carbonEmitted
  }

  /**
   * Estimate energy for a request without recording it in the tracker.
   */
  private estimateEnergy(
    provider: string,
    model: string,
    tokens: number
  ): number {
    const metrics = carbonTracker.computeMetrics(
      provider,
      model,
      tokens * 0.7,
      tokens * 0.3,
      0
    )

    return metrics.energyConsumed
  }

  /**
   * Get routing records within a date range
   */
  private getRecordsInRange(startDate: Date, endDate: Date): RoutingRecord[] {
    const start = startDate.getTime()
    const end = endDate.getTime()
    return this.routingRecords.filter((r) => {
      const ts = r.timestamp.getTime()
      return ts >= start && ts <= end
    })
  }

  /**
   * Get green routing statistics computed from actual routing records
   */
  async getStatistics(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalRequests: number
    greenRoutedRequests: number
    greenRoutedPercent: number
    totalCarbonSaved: number // kg CO2e
    totalEnergySaved: number // kWh
  }> {
    const records = this.getRecordsInRange(startDate, endDate)

    if (records.length === 0) {
      return {
        totalRequests: 0,
        greenRoutedRequests: 0,
        greenRoutedPercent: 0,
        totalCarbonSaved: 0,
        totalEnergySaved: 0,
      }
    }

    let greenRoutedRequests = 0
    let totalCarbonSaved = 0
    let totalEnergySaved = 0

    for (const record of records) {
      if (record.useGreenRoute) {
        greenRoutedRequests++
        totalCarbonSaved += record.estimatedSavings
        totalEnergySaved += record.estimatedEnergySavings
      }
    }

    return {
      totalRequests: records.length,
      greenRoutedRequests,
      greenRoutedPercent: (greenRoutedRequests / records.length) * 100,
      totalCarbonSaved, // kg CO2e
      totalEnergySaved, // kWh
    }
  }

  /**
   * Get carbon budget status computed from actual tracked carbon for the current day.
   * Queries the carbon tracker's real task data to determine how much carbon
   * has been emitted today, then compares against the configured budget.
   */
  async getCarbonBudgetStatus(): Promise<{
    budget?: number
    used: number
    remaining?: number
    percentUsed?: number
  }> {
    // Compute today's actual carbon usage from the carbon tracker
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const todayMetrics = await carbonTracker.getAggregateMetrics(startOfDay, endOfDay)
    const used = todayMetrics.totalCarbon // kg CO2e actually emitted today

    if (!this.policy.carbonBudget) {
      return {
        used,
        budget: undefined,
        remaining: undefined,
        percentUsed: undefined,
      }
    }

    const remaining = Math.max(0, this.policy.carbonBudget - used)
    const percentUsed = (used / this.policy.carbonBudget) * 100

    return {
      budget: this.policy.carbonBudget,
      used,
      remaining,
      percentUsed,
    }
  }

  /**
   * Reset all tracked routing data (for testing)
   */
  reset(): void {
    this.routingRecords = []
    console.log('[GREEN_ROUTE] All routing records have been reset')
  }

  /**
   * Get all routing records (read-only copy, for testing/debugging)
   */
  getRoutingRecords(): ReadonlyArray<RoutingRecord> {
    return [...this.routingRecords]
  }

  /**
   * Get recommendation for sustainability improvements
   */
  async getRecommendations(): Promise<
    Array<{
      title: string
      description: string
      potentialSavings: number // kg CO2e per day
      implementation: string
    }>
  > {
    const stats = await this.getStatistics(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      new Date()
    )

    const recommendations = []

    // Recommendation 1: Increase green routing coverage
    if (stats.greenRoutedPercent < 50) {
      recommendations.push({
        title: 'Increase Green Routing Coverage',
        description: `Currently only ${stats.greenRoutedPercent.toFixed(1)}% of tasks use green routing`,
        potentialSavings: 0.5,
        implementation: 'Set minPriority to HIGH to route more tasks through green models',
      })
    }

    // Recommendation 2: Enable off-peak scheduling
    if (!this.policy.offPeakOnly) {
      recommendations.push({
        title: 'Enable Off-Peak Scheduling',
        description: 'Schedule non-urgent tasks during off-peak hours (10pm-6am)',
        potentialSavings: 0.3,
        implementation: 'Enable offPeakOnly policy and implement task queuing',
      })
    }

    // Recommendation 3: Use local models for sensitive data
    recommendations.push({
      title: 'Expand Local Model Usage',
      description: 'Use self-hosted Ollama models for more tasks to reduce data center emissions',
      potentialSavings: 0.2,
      implementation: 'Route privacy-sensitive and batch tasks to local infrastructure',
    })

    return recommendations
  }
}

// Export singleton
export const greenRouter = new GreenRouter()
