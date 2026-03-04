/**
 * A3I-OS Phase 2: Failure Mode Handler
 *
 * Implements 5-level graceful degradation for agent failure management.
 * When agents encounter errors, they degrade gracefully rather than
 * failing catastrophically. Users are always informed clearly.
 *
 * Philosophy: Honest failure is better than hidden errors.
 * An agent that hides errors is not reliable.
 *
 * Features:
 * - 5-level degradation system (FULL_CAPABILITY to SAFE_SHUTDOWN)
 * - Automatic degradation based on error severity
 * - User-friendly error disclosure format
 * - Recovery attempt tracking
 * - Failure history for audit
 */

import { createId } from '@paralleldrive/cuid2'
import type { HierarchyLevel } from './capability-boundaries'

// =============================================================================
// DEGRADATION LEVELS
// =============================================================================

/**
 * 5-Level Graceful Degradation System
 *
 * Lower numbers = higher capability
 * Higher numbers = more restricted
 */
export enum DegradationLevel {
  /** Normal operation - full agent capabilities available */
  FULL_CAPABILITY = 0,

  /** Human approval required for risky actions */
  REDUCED_AUTONOMY = 1,

  /** Only pre-approved actions allowed */
  SAFE_MODE = 2,

  /** Read-only, no actions permitted */
  MAINTENANCE_MODE = 3,

  /** Complete halt, preserve state for recovery */
  SAFE_SHUTDOWN = 4,
}

/**
 * Human-readable descriptions for each degradation level
 */
export const DEGRADATION_LEVEL_DESCRIPTIONS: Record<DegradationLevel, string> = {
  [DegradationLevel.FULL_CAPABILITY]:
    'Normal operation - all capabilities available',
  [DegradationLevel.REDUCED_AUTONOMY]:
    'Reduced autonomy - human approval required for risky actions',
  [DegradationLevel.SAFE_MODE]:
    'Safe mode - only pre-approved actions allowed',
  [DegradationLevel.MAINTENANCE_MODE]:
    'Maintenance mode - read-only, no actions permitted',
  [DegradationLevel.SAFE_SHUTDOWN]:
    'Safe shutdown - complete halt, state preserved',
}

// =============================================================================
// SEVERITY LEVELS
// =============================================================================

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Severity to degradation level mapping
 * Determines automatic degradation based on error severity
 */
export const SEVERITY_DEGRADATION_MAP: Record<ErrorSeverity, DegradationLevel> = {
  low: DegradationLevel.FULL_CAPABILITY,       // No degradation
  medium: DegradationLevel.REDUCED_AUTONOMY,   // Require human approval
  high: DegradationLevel.SAFE_MODE,            // Pre-approved only
  critical: DegradationLevel.MAINTENANCE_MODE, // Read-only
}

/**
 * Error count thresholds for automatic degradation
 * If errors exceed threshold within time window, degrade
 */
export const ERROR_THRESHOLDS = {
  /** Time window in milliseconds (5 minutes) */
  timeWindow: 5 * 60 * 1000,

  /** Thresholds per severity */
  thresholds: {
    low: 10,      // 10 low errors in 5 min = degrade
    medium: 5,    // 5 medium errors in 5 min = degrade
    high: 2,      // 2 high errors in 5 min = degrade
    critical: 1,  // 1 critical error = immediate degrade
  },
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Failure event tracking
 * Records every error with full context for audit
 */
export interface FailureEvent {
  /** Unique failure event ID */
  id: string

  /** When the failure occurred */
  timestamp: Date

  /** Agent that experienced the failure */
  agentId: string

  /** Type of error (e.g., 'api_error', 'validation_error', 'timeout') */
  errorType: string

  /** Error severity level */
  severity: ErrorSeverity

  /** Degradation level before this failure */
  currentLevel: DegradationLevel

  /** Degradation level after this failure */
  newLevel: DegradationLevel

  /** Detailed error information */
  errorDetails: string

  /** Whether user was notified of this failure */
  userNotified: boolean

  /** Whether recovery was attempted */
  recoveryAttempted: boolean

  /** Stack trace if available */
  stackTrace?: string

  /** Additional context */
  metadata?: Record<string, unknown>
}

/**
 * User-friendly error disclosure format
 * Per A3I-OS spec: honest, clear error communication
 */
export interface ErrorDisclosure {
  /** Plain language description of what went wrong */
  what_happened: string

  /** What the agent was attempting to do */
  what_i_was_trying_to_do: string

  /** Recovery steps the agent already tried */
  what_i_tried: string[]

  /** Actions the user can take to resolve */
  what_you_can_do: string[]

  /** Technical details (optional, for advanced users) */
  technical_details?: string
}

/**
 * Agent degradation state
 */
export interface AgentDegradationState {
  /** Current degradation level */
  level: DegradationLevel

  /** Human-readable description */
  description: string

  /** When degradation was last changed */
  lastChanged: Date

  /** Reason for current level */
  reason: string

  /** Recent failure count by severity */
  recentFailures: Record<ErrorSeverity, number>

  /** Whether recovery is in progress */
  recoveryInProgress: boolean

  /** Last recovery attempt timestamp */
  lastRecoveryAttempt?: Date
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult {
  /** Whether recovery was successful */
  success: boolean

  /** Previous degradation level */
  previousLevel: DegradationLevel

  /** New degradation level after recovery */
  newLevel: DegradationLevel

  /** Recovery message */
  message: string

  /** Timestamp of recovery attempt */
  timestamp: Date
}

/**
 * Failure mode handler configuration
 */
export interface FailureModeConfig {
  /** Maximum failures to store in history */
  maxHistorySize: number

  /** Whether to auto-degrade on errors */
  autoDegrade: boolean

  /** Whether to notify users on degradation */
  notifyOnDegradeation: boolean

  /** Recovery cooldown in milliseconds */
  recoveryCooldown: number

  /** Minimum time at degraded level before recovery allowed */
  minDegradationTime: number
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: FailureModeConfig = {
  maxHistorySize: 1000,
  autoDegrade: true,
  notifyOnDegradeation: true,
  recoveryCooldown: 60000, // 1 minute
  minDegradationTime: 300000, // 5 minutes
}

// =============================================================================
// FAILURE MODE HANDLER CLASS
// =============================================================================

/**
 * Failure Mode Handler
 *
 * Manages graceful degradation for AI agents.
 * Tracks failures, manages degradation levels, and handles recovery.
 */
export class FailureModeHandler {
  private config: FailureModeConfig
  private failureHistory: Map<string, FailureEvent[]> = new Map()
  private agentStates: Map<string, AgentDegradationState> = new Map()

  constructor(config: Partial<FailureModeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ---------------------------------------------------------------------------
  // FAILURE REPORTING
  // ---------------------------------------------------------------------------

  /**
   * Report a failure event
   *
   * Records the failure and potentially degrades the agent
   * based on severity and error frequency.
   *
   * @param event - Partial failure event (id/timestamp auto-generated)
   * @returns Complete failure event with degradation outcome
   */
  async reportFailure(
    event: Omit<FailureEvent, 'id' | 'timestamp' | 'currentLevel' | 'newLevel'>
  ): Promise<FailureEvent> {
    const currentState = this.getOrCreateState(event.agentId)
    const currentLevel = currentState.level

    // Determine new level based on severity and history
    let newLevel = currentLevel
    if (this.config.autoDegrade) {
      newLevel = this.calculateNewLevel(event.agentId, event.severity, currentLevel)
    }

    // Create complete failure event
    const failureEvent: FailureEvent = {
      ...event,
      id: createId(),
      timestamp: new Date(),
      currentLevel,
      newLevel,
    }

    // Store in history
    this.addToHistory(event.agentId, failureEvent)

    // Update state if degraded
    if (newLevel !== currentLevel) {
      await this.setDegradationLevel(
        event.agentId,
        newLevel,
        `Auto-degraded due to ${event.severity} error: ${event.errorType}`
      )
    }

    // Update recent failure counts
    currentState.recentFailures[event.severity]++

    return failureEvent
  }

  /**
   * Calculate new degradation level based on error history
   */
  private calculateNewLevel(
    agentId: string,
    severity: ErrorSeverity,
    currentLevel: DegradationLevel
  ): DegradationLevel {
    // Get recent errors within time window
    const history = this.getRecentFailures(agentId, ERROR_THRESHOLDS.timeWindow)

    // Count errors by severity
    const counts: Record<ErrorSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    for (const failure of history) {
      counts[failure.severity]++
    }

    // Add current error
    counts[severity]++

    // Check thresholds and determine worst case
    let targetLevel = currentLevel

    if (counts.critical >= ERROR_THRESHOLDS.thresholds.critical) {
      targetLevel = Math.max(targetLevel, DegradationLevel.MAINTENANCE_MODE)
    }
    if (counts.high >= ERROR_THRESHOLDS.thresholds.high) {
      targetLevel = Math.max(targetLevel, DegradationLevel.SAFE_MODE)
    }
    if (counts.medium >= ERROR_THRESHOLDS.thresholds.medium) {
      targetLevel = Math.max(targetLevel, DegradationLevel.REDUCED_AUTONOMY)
    }

    // Never auto-degrade to SAFE_SHUTDOWN - that requires manual intervention
    return Math.min(targetLevel, DegradationLevel.MAINTENANCE_MODE)
  }

  /**
   * Get recent failures within time window
   */
  private getRecentFailures(agentId: string, windowMs: number): FailureEvent[] {
    const history = this.failureHistory.get(agentId) || []
    const cutoff = Date.now() - windowMs

    return history.filter((f) => f.timestamp.getTime() > cutoff)
  }

  // ---------------------------------------------------------------------------
  // DEGRADATION LEVEL MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Get current degradation level for an agent
   *
   * @param agentId - Agent to query
   * @returns Current degradation state
   */
  getDegradationLevel(agentId: string): AgentDegradationState {
    return this.getOrCreateState(agentId)
  }

  /**
   * Manually set degradation level
   *
   * Used for human intervention or scheduled maintenance.
   *
   * @param agentId - Agent to modify
   * @param level - New degradation level
   * @param reason - Reason for change
   * @returns Updated state
   */
  async setDegradationLevel(
    agentId: string,
    level: DegradationLevel,
    reason: string
  ): Promise<AgentDegradationState> {
    const state = this.getOrCreateState(agentId)

    state.level = level
    state.description = DEGRADATION_LEVEL_DESCRIPTIONS[level]
    state.lastChanged = new Date()
    state.reason = reason

    // Reset recovery flag if we're degrading
    if (level > DegradationLevel.FULL_CAPABILITY) {
      state.recoveryInProgress = false
    }

    this.agentStates.set(agentId, state)

    return state
  }

  /**
   * Get or create initial state for an agent
   */
  private getOrCreateState(agentId: string): AgentDegradationState {
    let state = this.agentStates.get(agentId)

    if (!state) {
      state = {
        level: DegradationLevel.FULL_CAPABILITY,
        description: DEGRADATION_LEVEL_DESCRIPTIONS[DegradationLevel.FULL_CAPABILITY],
        lastChanged: new Date(),
        reason: 'Initial state',
        recentFailures: { low: 0, medium: 0, high: 0, critical: 0 },
        recoveryInProgress: false,
      }
      this.agentStates.set(agentId, state)
    }

    return state
  }

  // ---------------------------------------------------------------------------
  // FAILURE HISTORY
  // ---------------------------------------------------------------------------

  /**
   * Get failure history for an agent
   *
   * @param agentId - Agent to query
   * @param limit - Maximum number of events to return
   * @returns Array of failure events, newest first
   */
  getFailureHistory(agentId: string, limit: number = 100): FailureEvent[] {
    const history = this.failureHistory.get(agentId) || []

    // Return newest first, limited
    return [...history].reverse().slice(0, limit)
  }

  /**
   * Add failure to history, respecting max size
   */
  private addToHistory(agentId: string, event: FailureEvent): void {
    let history = this.failureHistory.get(agentId) || []

    history.push(event)

    // Trim if exceeds max size
    if (history.length > this.config.maxHistorySize) {
      history = history.slice(-this.config.maxHistorySize)
    }

    this.failureHistory.set(agentId, history)
  }

  // ---------------------------------------------------------------------------
  // RECOVERY
  // ---------------------------------------------------------------------------

  /**
   * Attempt to recover an agent to a higher capability level
   *
   * Recovery is only allowed if:
   * - Minimum degradation time has passed
   * - Recovery cooldown has elapsed since last attempt
   * - No recent critical errors
   *
   * @param agentId - Agent to recover
   * @returns Recovery result
   */
  async attemptRecovery(agentId: string): Promise<RecoveryResult> {
    const state = this.getOrCreateState(agentId)
    const now = new Date()

    // Already at full capability
    if (state.level === DegradationLevel.FULL_CAPABILITY) {
      return {
        success: true,
        previousLevel: state.level,
        newLevel: state.level,
        message: 'Agent already at full capability',
        timestamp: now,
      }
    }

    // Check minimum degradation time
    const timeDegraded = now.getTime() - state.lastChanged.getTime()
    if (timeDegraded < this.config.minDegradationTime) {
      const remaining = Math.ceil(
        (this.config.minDegradationTime - timeDegraded) / 1000
      )
      return {
        success: false,
        previousLevel: state.level,
        newLevel: state.level,
        message: `Must wait ${remaining} more seconds before recovery attempt`,
        timestamp: now,
      }
    }

    // Check recovery cooldown
    if (state.lastRecoveryAttempt) {
      const timeSinceLastAttempt =
        now.getTime() - state.lastRecoveryAttempt.getTime()
      if (timeSinceLastAttempt < this.config.recoveryCooldown) {
        const remaining = Math.ceil(
          (this.config.recoveryCooldown - timeSinceLastAttempt) / 1000
        )
        return {
          success: false,
          previousLevel: state.level,
          newLevel: state.level,
          message: `Recovery cooldown: wait ${remaining} more seconds`,
          timestamp: now,
        }
      }
    }

    // Check for recent critical errors
    const recentCritical = this.getRecentFailures(agentId, ERROR_THRESHOLDS.timeWindow)
      .filter((f) => f.severity === 'critical')

    if (recentCritical.length > 0) {
      return {
        success: false,
        previousLevel: state.level,
        newLevel: state.level,
        message: 'Cannot recover: recent critical errors detected',
        timestamp: now,
      }
    }

    // Attempt recovery - go up one level
    const previousLevel = state.level
    const newLevel = Math.max(0, state.level - 1) as DegradationLevel

    state.level = newLevel
    state.description = DEGRADATION_LEVEL_DESCRIPTIONS[newLevel]
    state.lastChanged = now
    state.lastRecoveryAttempt = now
    state.reason = 'Automatic recovery after stability period'
    state.recoveryInProgress = newLevel > DegradationLevel.FULL_CAPABILITY

    // Reset failure counts on successful recovery
    state.recentFailures = { low: 0, medium: 0, high: 0, critical: 0 }

    this.agentStates.set(agentId, state)

    return {
      success: true,
      previousLevel,
      newLevel,
      message: `Recovered from ${DEGRADATION_LEVEL_DESCRIPTIONS[previousLevel]} to ${DEGRADATION_LEVEL_DESCRIPTIONS[newLevel]}`,
      timestamp: now,
    }
  }

  // ---------------------------------------------------------------------------
  // ERROR DISCLOSURE
  // ---------------------------------------------------------------------------

  /**
   * Create a user-friendly error disclosure
   *
   * Generates clear, honest error messages that help users
   * understand what happened and what they can do.
   *
   * @param error - The error or failure event
   * @param context - Additional context for the disclosure
   * @returns Formatted error disclosure
   */
  createErrorDisclosure(
    error: Error | FailureEvent | string,
    context?: {
      attemptedAction?: string
      recoverySteps?: string[]
      userActions?: string[]
    }
  ): ErrorDisclosure {
    // Extract error details
    let errorMessage: string
    let technicalDetails: string | undefined

    if (typeof error === 'string') {
      errorMessage = error
    } else if (error instanceof Error) {
      errorMessage = error.message
      technicalDetails = error.stack
    } else {
      errorMessage = error.errorDetails
      technicalDetails = error.stackTrace
    }

    // Build what_happened
    const whatHappened = this.buildWhatHappened(errorMessage)

    // Build what_i_was_trying_to_do
    const whatTrying = context?.attemptedAction
      ? context.attemptedAction
      : 'Complete the requested task'

    // Build what_i_tried
    const whatTried = context?.recoverySteps || this.getDefaultRecoverySteps(error)

    // Build what_you_can_do
    const whatCanDo = context?.userActions || this.getDefaultUserActions(error)

    return {
      what_happened: whatHappened,
      what_i_was_trying_to_do: whatTrying,
      what_i_tried: whatTried,
      what_you_can_do: whatCanDo,
      technical_details: technicalDetails,
    }
  }

  /**
   * Build user-friendly "what happened" message
   */
  private buildWhatHappened(errorMessage: string): string {
    // Map common technical errors to user-friendly messages
    const errorMappings: Array<{ pattern: RegExp; message: string }> = [
      {
        pattern: /timeout/i,
        message:
          'The operation took too long to complete and was stopped to prevent issues.',
      },
      {
        pattern: /network|connection|ECONNREFUSED/i,
        message:
          'I was unable to connect to an external service needed for this task.',
      },
      {
        pattern: /permission|unauthorized|forbidden/i,
        message: 'I do not have the necessary permissions to complete this action.',
      },
      {
        pattern: /not found|404/i,
        message: 'A required resource could not be found.',
      },
      {
        pattern: /rate limit|429/i,
        message: 'Too many requests were made and the service is temporarily unavailable.',
      },
      {
        pattern: /validation|invalid/i,
        message: 'The provided data did not meet the required format or constraints.',
      },
      {
        pattern: /memory|heap/i,
        message:
          'The operation required more resources than available and had to be stopped.',
      },
    ]

    for (const mapping of errorMappings) {
      if (mapping.pattern.test(errorMessage)) {
        return mapping.message
      }
    }

    // Default message
    return `An unexpected error occurred: ${errorMessage}`
  }

  /**
   * Get default recovery steps based on error type
   */
  private getDefaultRecoverySteps(
    error: Error | FailureEvent | string
  ): string[] {
    const steps: string[] = ['Logged the error for analysis']

    if (typeof error !== 'string' && 'recoveryAttempted' in error) {
      if (error.recoveryAttempted) {
        steps.push('Attempted automatic recovery')
      }
    }

    steps.push('Preserved current state to prevent data loss')

    return steps
  }

  /**
   * Get default user actions based on error type
   */
  private getDefaultUserActions(
    error: Error | FailureEvent | string
  ): string[] {
    const actions: string[] = []

    if (typeof error === 'string') {
      actions.push('Try the action again')
      actions.push('Contact support if the issue persists')
    } else if (error instanceof Error) {
      if (/network|connection/i.test(error.message)) {
        actions.push('Check your network connection')
        actions.push('Wait a moment and try again')
      } else if (/permission/i.test(error.message)) {
        actions.push('Verify you have the required permissions')
        actions.push('Contact an administrator if needed')
      } else {
        actions.push('Try the action again')
        actions.push('Contact support if the issue persists')
      }
    } else {
      // FailureEvent
      if (error.severity === 'critical') {
        actions.push('Do not retry - manual intervention required')
        actions.push('Contact support immediately')
      } else {
        actions.push('Wait a moment and try again')
        actions.push('Check the failure history for patterns')
      }
    }

    return actions
  }

  // ---------------------------------------------------------------------------
  // CAPABILITY CHECKS
  // ---------------------------------------------------------------------------

  /**
   * Check if an action is allowed at current degradation level
   *
   * @param agentId - Agent to check
   * @param actionType - Type of action being attempted
   * @returns Whether action is allowed and why
   */
  isActionAllowed(
    agentId: string,
    actionType: string
  ): { allowed: boolean; reason: string } {
    const state = this.getOrCreateState(agentId)

    switch (state.level) {
      case DegradationLevel.FULL_CAPABILITY:
        return { allowed: true, reason: 'Full capability mode' }

      case DegradationLevel.REDUCED_AUTONOMY:
        // Only risky actions require approval
        const riskyActions = ['deploy', 'delete', 'modify', 'execute']
        const isRisky = riskyActions.some((r) =>
          actionType.toLowerCase().includes(r)
        )
        if (isRisky) {
          return {
            allowed: false,
            reason: 'Human approval required for risky actions in reduced autonomy mode',
          }
        }
        return { allowed: true, reason: 'Non-risky action allowed' }

      case DegradationLevel.SAFE_MODE:
        // Only pre-approved actions allowed
        const safeActions = ['read', 'query', 'list', 'get', 'status']
        const isSafe = safeActions.some((s) =>
          actionType.toLowerCase().includes(s)
        )
        if (isSafe) {
          return { allowed: true, reason: 'Pre-approved action in safe mode' }
        }
        return {
          allowed: false,
          reason: 'Only pre-approved actions allowed in safe mode',
        }

      case DegradationLevel.MAINTENANCE_MODE:
        // Read-only
        if (actionType.toLowerCase().includes('read')) {
          return { allowed: true, reason: 'Read-only action allowed in maintenance mode' }
        }
        return {
          allowed: false,
          reason: 'Only read operations allowed in maintenance mode',
        }

      case DegradationLevel.SAFE_SHUTDOWN:
        return {
          allowed: false,
          reason: 'Agent is in safe shutdown - no actions allowed',
        }

      default:
        return { allowed: false, reason: 'Unknown degradation level' }
    }
  }

  // ---------------------------------------------------------------------------
  // STATISTICS
  // ---------------------------------------------------------------------------

  /**
   * Get failure statistics for an agent
   */
  getFailureStats(agentId: string): {
    totalFailures: number
    bySeverity: Record<ErrorSeverity, number>
    recentFailures: number
    currentLevel: DegradationLevel
    timeAtCurrentLevel: number
  } {
    const history = this.failureHistory.get(agentId) || []
    const state = this.getOrCreateState(agentId)
    const recentCount = this.getRecentFailures(
      agentId,
      ERROR_THRESHOLDS.timeWindow
    ).length

    const bySeverity: Record<ErrorSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    for (const failure of history) {
      bySeverity[failure.severity]++
    }

    return {
      totalFailures: history.length,
      bySeverity,
      recentFailures: recentCount,
      currentLevel: state.level,
      timeAtCurrentLevel: Date.now() - state.lastChanged.getTime(),
    }
  }

  /**
   * Format error disclosure for display
   */
  formatDisclosureForDisplay(disclosure: ErrorDisclosure): string {
    const lines: string[] = []

    lines.push('=== Error Report ===')
    lines.push('')
    lines.push(`What happened: ${disclosure.what_happened}`)
    lines.push('')
    lines.push(`What I was trying to do: ${disclosure.what_i_was_trying_to_do}`)
    lines.push('')
    lines.push('What I tried:')
    for (const step of disclosure.what_i_tried) {
      lines.push(`  - ${step}`)
    }
    lines.push('')
    lines.push('What you can do:')
    for (const action of disclosure.what_you_can_do) {
      lines.push(`  - ${action}`)
    }

    if (disclosure.technical_details) {
      lines.push('')
      lines.push('Technical details:')
      lines.push(disclosure.technical_details)
    }

    return lines.join('\n')
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Failure Mode Handler instance
 *
 * @param config - Optional configuration overrides
 * @returns Configured FailureModeHandler
 *
 * @example
 * ```typescript
 * const handler = createFailureModeHandler({
 *   autoDegrade: true,
 *   maxHistorySize: 500
 * })
 *
 * // Report a failure
 * await handler.reportFailure({
 *   agentId: 'agent-123',
 *   errorType: 'api_timeout',
 *   severity: 'medium',
 *   errorDetails: 'External API timed out after 30s',
 *   userNotified: true,
 *   recoveryAttempted: true
 * })
 *
 * // Check current level
 * const state = handler.getDegradationLevel('agent-123')
 * console.log(state.description)
 *
 * // Attempt recovery
 * const recovery = await handler.attemptRecovery('agent-123')
 * if (recovery.success) {
 *   console.log('Agent recovered!')
 * }
 * ```
 */
export function createFailureModeHandler(
  config?: Partial<FailureModeConfig>
): FailureModeHandler {
  return new FailureModeHandler(config)
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default singleton instance for application-wide use
 */
export const failureModeHandler = createFailureModeHandler()

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Classes
  FailureModeHandler,

  // Factory
  createFailureModeHandler,

  // Singleton
  failureModeHandler,

  // Constants
  DegradationLevel,
  DEGRADATION_LEVEL_DESCRIPTIONS,
  SEVERITY_DEGRADATION_MAP,
  ERROR_THRESHOLDS,
}
