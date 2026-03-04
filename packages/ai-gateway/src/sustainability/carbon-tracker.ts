/**
 * Carbon Tracking System
 * Monitors energy consumption and carbon footprint of AI operations
 * Based on 2025 sustainability best practices and CodeCarbon methodology
 */

export interface CarbonMetrics {
  taskId: string
  modelProvider: string
  modelName: string
  tokensInput: number
  tokensOutput: number
  duration: number // milliseconds
  energyConsumed: number // kWh
  carbonEmitted: number // kg CO2e
  timestamp: Date
}

export interface ModelEnergyProfile {
  provider: string
  model: string
  energyPerToken: number // Wh per token
  carbonIntensity: number // kg CO2e per kWh
  isGreenOptimized: boolean
}

/**
 * Carbon Tracker
 * Tracks energy consumption and carbon emissions for AI operations
 */
export class CarbonTracker {
  /** In-memory accumulator of all tracked task records */
  private trackedTasks: CarbonMetrics[] = []

  private static MODEL_ENERGY_PROFILES: Record<string, ModelEnergyProfile> = {
    // Anthropic - Cloud-based (US average grid)
    'claude-opus-4': {
      provider: 'anthropic',
      model: 'claude-opus-4',
      energyPerToken: 0.000025, // 25 uWh per token (large model estimate)
      carbonIntensity: 0.386, // kg CO2e per kWh (US grid average 2025)
      isGreenOptimized: false,
    },
    'claude-sonnet-4-5': {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      energyPerToken: 0.000015, // 15 uWh per token
      carbonIntensity: 0.386,
      isGreenOptimized: false,
    },
    'claude-haiku-4': {
      provider: 'anthropic',
      model: 'claude-haiku-4',
      energyPerToken: 0.000008, // 8 uWh per token (efficient)
      carbonIntensity: 0.386,
      isGreenOptimized: false,
    },

    // Google - Using renewable energy (lower carbon intensity)
    'gemini-2.5-pro': {
      provider: 'google',
      model: 'gemini-2.5-pro',
      energyPerToken: 0.000020, // 20 uWh per token
      carbonIntensity: 0.128, // Google's renewable-powered data centers
      isGreenOptimized: true,
    },
    'gemini-2.5-flash': {
      provider: 'google',
      model: 'gemini-2.5-flash',
      energyPerToken: 0.000006, // 6 uWh per token (very efficient)
      carbonIntensity: 0.128,
      isGreenOptimized: true,
    },

    // OpenAI - Cloud-based (improving renewable usage)
    'gpt-4o': {
      provider: 'openai',
      model: 'gpt-4o',
      energyPerToken: 0.000018, // 18 uWh per token
      carbonIntensity: 0.250, // Azure's carbon commitment
      isGreenOptimized: false,
    },
    'gpt-4o-mini': {
      provider: 'openai',
      model: 'gpt-4o-mini',
      energyPerToken: 0.000007, // 7 uWh per token
      carbonIntensity: 0.250,
      isGreenOptimized: true,
    },

    // Self-hosted Ollama (depends on local grid)
    'llama-3.1-70b': {
      provider: 'ollama',
      model: 'llama-3.1-70b',
      energyPerToken: 0.000012, // 12 uWh per token (on-premise efficiency)
      carbonIntensity: 0.386, // Assumes US grid average (configurable)
      isGreenOptimized: false,
    },
    'deepseek-r1': {
      provider: 'ollama',
      model: 'deepseek-r1',
      energyPerToken: 0.000010, // 10 uWh per token
      carbonIntensity: 0.386,
      isGreenOptimized: false,
    },
    'llama-3.2-90b': {
      provider: 'ollama',
      model: 'llama-3.2-90b',
      energyPerToken: 0.000014, // 14 uWh per token (larger model)
      carbonIntensity: 0.386,
      isGreenOptimized: false,
    },
  }

  /**
   * Track carbon emissions for a task
   */
  async trackTask(
    taskId: string,
    modelProvider: string,
    modelName: string,
    tokensInput: number,
    tokensOutput: number,
    duration: number
  ): Promise<CarbonMetrics> {
    const profile = this.getModelProfile(modelProvider, modelName)

    const totalTokens = tokensInput + tokensOutput
    const energyConsumed = totalTokens * profile.energyPerToken / 1000 // Convert Wh to kWh
    const carbonEmitted = energyConsumed * profile.carbonIntensity

    const metrics: CarbonMetrics = {
      taskId,
      modelProvider,
      modelName,
      tokensInput,
      tokensOutput,
      duration,
      energyConsumed,
      carbonEmitted,
      timestamp: new Date(),
    }

    // Store in the in-memory accumulator
    this.trackedTasks.push(metrics)

    console.log(
      `[CARBON_TRACKER] Task ${taskId}: ${carbonEmitted.toFixed(6)} kg CO2e (${energyConsumed.toFixed(6)} kWh) [${this.trackedTasks.length} total tracked]`
    )

    return metrics
  }

  /**
   * Compute carbon metrics for a hypothetical task without recording it.
   * Used for estimates and comparisons that should not pollute tracked data.
   */
  computeMetrics(
    provider: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    duration: number
  ): CarbonMetrics {
    const profile = this.getModelProfile(provider, model)

    const totalTokens = tokensInput + tokensOutput
    const energyConsumed = totalTokens * profile.energyPerToken / 1000
    const carbonEmitted = energyConsumed * profile.carbonIntensity

    return {
      taskId: '_estimate',
      modelProvider: provider,
      modelName: model,
      tokensInput,
      tokensOutput,
      duration,
      energyConsumed,
      carbonEmitted,
      timestamp: new Date(),
    }
  }

  /**
   * Get all tracked task records (read-only copy)
   */
  getTrackedTasks(): ReadonlyArray<CarbonMetrics> {
    return [...this.trackedTasks]
  }

  /**
   * Get tracked tasks within a date range
   */
  getTrackedTasksInRange(startDate: Date, endDate: Date): CarbonMetrics[] {
    const start = startDate.getTime()
    const end = endDate.getTime()
    return this.trackedTasks.filter((t) => {
      const ts = t.timestamp.getTime()
      return ts >= start && ts <= end
    })
  }

  /**
   * Reset all tracked data (for testing)
   */
  reset(): void {
    this.trackedTasks = []
    console.log('[CARBON_TRACKER] All tracked data has been reset')
  }

  /**
   * Get model energy profile
   */
  private getModelProfile(provider: string, model: string): ModelEnergyProfile {
    const key = `${model}`
    const profile = CarbonTracker.MODEL_ENERGY_PROFILES[key]

    if (profile) {
      return profile
    }

    // Default profile for unknown models
    console.warn(`[CARBON_TRACKER] No profile for ${provider}/${model}, using default`)
    return {
      provider,
      model,
      energyPerToken: 0.000015, // Conservative estimate
      carbonIntensity: 0.386,
      isGreenOptimized: false,
    }
  }

  /**
   * Get green-optimized models
   */
  getGreenModels(): ModelEnergyProfile[] {
    return Object.values(CarbonTracker.MODEL_ENERGY_PROFILES).filter(
      (profile) => profile.isGreenOptimized
    )
  }

  /**
   * Calculate carbon savings
   */
  calculateSavings(
    baselineModel: string,
    greenModel: string,
    tokens: number
  ): {
    energySaved: number
    carbonSaved: number
    savingsPercent: number
  } {
    const baseline = this.getModelProfile('', baselineModel)
    const green = this.getModelProfile('', greenModel)

    const baselineEnergy = tokens * baseline.energyPerToken / 1000
    const greenEnergy = tokens * green.energyPerToken / 1000

    const baselineCarbon = baselineEnergy * baseline.carbonIntensity
    const greenCarbon = greenEnergy * green.carbonIntensity

    const energySaved = baselineEnergy - greenEnergy
    const carbonSaved = baselineCarbon - greenCarbon
    const savingsPercent = (carbonSaved / baselineCarbon) * 100

    return { energySaved, carbonSaved, savingsPercent }
  }

  /**
   * Get aggregate carbon metrics computed from actual tracked tasks
   */
  async getAggregateMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalTasks: number
    totalEnergy: number
    totalCarbon: number
    avgCarbonPerTask: number
    greenTaskPercent: number
  }> {
    const tasks = this.getTrackedTasksInRange(startDate, endDate)

    if (tasks.length === 0) {
      return {
        totalTasks: 0,
        totalEnergy: 0,
        totalCarbon: 0,
        avgCarbonPerTask: 0,
        greenTaskPercent: 0,
      }
    }

    const greenModels = new Set(
      Object.values(CarbonTracker.MODEL_ENERGY_PROFILES)
        .filter((p) => p.isGreenOptimized)
        .map((p) => p.model)
    )

    let totalEnergy = 0
    let totalCarbon = 0
    let greenCount = 0

    for (const task of tasks) {
      totalEnergy += task.energyConsumed
      totalCarbon += task.carbonEmitted
      if (greenModels.has(task.modelName)) {
        greenCount++
      }
    }

    return {
      totalTasks: tasks.length,
      totalEnergy, // kWh
      totalCarbon, // kg CO2e
      avgCarbonPerTask: totalCarbon / tasks.length, // kg CO2e
      greenTaskPercent: (greenCount / tasks.length) * 100, // %
    }
  }

  /**
   * Time-of-day carbon intensity adjustment factors.
   * Off-peak hours (22:00-06:00) have lower grid carbon intensity.
   */
  private static HOURLY_ADJUSTMENT_FACTORS: number[] = [
    // 0-6: off-peak (night) — 30% lower
    0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7,
    // 7-11: morning ramp-up — 10% higher
    1.1, 1.1, 1.1, 1.1, 1.1,
    // 12-17: afternoon peak — 10% higher
    1.1, 1.1, 1.1, 1.1, 1.1, 1.1,
    // 18-21: evening — 10% higher
    1.1, 1.1, 1.1, 1.1,
    // 22-23: off-peak (night) — 30% lower
    0.7, 0.7,
  ]

  /**
   * Get hourly carbon intensity forecast.
   * Uses actual tracked hourly emission patterns as a baseline when data is
   * available, with time-of-day adjustment factors applied. Falls back to
   * the US grid average (0.386 kg CO2e/kWh) when no tracked data exists
   * for a given hour.
   */
  async getCarbonIntensityForecast(): Promise<
    Array<{
      hour: number
      intensity: number // kg CO2e per kWh
      isLowEmission: boolean
    }>
  > {
    const defaultBaseIntensity = 0.386 // US grid average (kg CO2e/kWh)

    // Build per-hour observed weighted-average carbon intensity from tracked data.
    // We compute: sum(carbonEmitted) / sum(energyConsumed) per hour bucket.
    const hourlyCarbon: number[] = new Array(24).fill(0)
    const hourlyEnergy: number[] = new Array(24).fill(0)

    for (const task of this.trackedTasks) {
      const hour = task.timestamp.getHours()
      hourlyCarbon[hour] += task.carbonEmitted
      hourlyEnergy[hour] += task.energyConsumed
    }

    const forecast = []

    for (let hour = 0; hour < 24; hour++) {
      const adjustmentFactor = CarbonTracker.HOURLY_ADJUSTMENT_FACTORS[hour]
      const isOffPeak = hour >= 22 || hour <= 6

      // If we have tracked energy data for this hour, derive the observed
      // carbon intensity (weighted average across all providers/models that
      // actually ran during this hour). Apply the time-of-day adjustment on
      // top to produce the forecast.
      let baseIntensity: number
      if (hourlyEnergy[hour] > 0) {
        baseIntensity = hourlyCarbon[hour] / hourlyEnergy[hour]
      } else {
        baseIntensity = defaultBaseIntensity
      }

      const intensity = baseIntensity * adjustmentFactor

      forecast.push({
        hour,
        intensity,
        isLowEmission: isOffPeak,
      })
    }

    return forecast
  }

  /**
   * Check if current time is low-emission period
   */
  async isLowEmissionPeriod(): Promise<boolean> {
    const hour = new Date().getHours()
    const forecast = await this.getCarbonIntensityForecast()
    const current = forecast.find((f) => f.hour === hour)
    return current?.isLowEmission ?? false
  }

  /**
   * Get recommended model for green routing
   */
  async getGreenRecommendation(
    taskType: string,
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): Promise<{
    model: string
    provider: string
    reason: string
  }> {
    const isLowEmission = await this.isLowEmissionPeriod()

    // For non-critical tasks, always prefer green models
    if (priority === 'LOW' || priority === 'MEDIUM') {
      return {
        model: 'gemini-2.5-flash',
        provider: 'google',
        reason: 'Green-optimized model with renewable energy',
      }
    }

    // For critical tasks during low-emission periods, can use larger green models
    if (priority === 'HIGH' && isLowEmission) {
      return {
        model: 'gemini-2.5-pro',
        provider: 'google',
        reason: 'High-quality green model during off-peak hours',
      }
    }

    // For critical tasks during high-emission periods, use quality model but log impact
    return {
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      reason: 'Quality priority, consider rescheduling non-urgent tasks',
    }
  }
}

// Export singleton
export const carbonTracker = new CarbonTracker()
