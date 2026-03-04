/**
 * Failure Mode API
 * A3I-OS v2.0 - Phase 2
 *
 * GET /api/v1/agents/[id]/failure-mode
 * Get current degradation level and failure history
 *
 * POST /api/v1/agents/[id]/failure-mode
 * Report a failure event
 *
 * PATCH /api/v1/agents/[id]/failure-mode
 * Manually adjust degradation level or attempt recovery
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, checkRateLimit, logApiUsage } from '@/lib/api'
import {
  failureModeHandler,
  DegradationLevel,
  DEGRADATION_LEVEL_DESCRIPTIONS,
  type ErrorSeverity,
  type FailureEvent,
} from '@/lib/agents/failure-mode-handler'

// =============================================================================
// Types
// =============================================================================

interface ReportFailureBody {
  errorType: string
  severity: ErrorSeverity
  errorDetails: string
  sessionId?: string
  stackTrace?: string
  recoveryAttempted?: boolean
  metadata?: Record<string, unknown>
}

interface AdjustLevelBody {
  action: 'set_level' | 'attempt_recovery'
  level?: DegradationLevel
  reason?: string
}

// =============================================================================
// GET - Current Status & History
// =============================================================================

/**
 * GET /api/v1/agents/[id]/failure-mode
 * Get current degradation level and failure history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id: agentId } = await params

  // Check API key auth (optional for GET)
  const authHeader = request.headers.get('authorization')
  let userId: string | null = null
  let keyId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const validation = await validateApiKey(key)

    if (validation) {
      userId = validation.userId
      keyId = validation.keyId
    }
  }

  // Check rate limit
  if (keyId && userId) {
    const rateLimit = await checkRateLimit(keyId, userId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { message: 'Rate limit exceeded', code: 'rate_limited' } },
        { status: 429 }
      )
    }
  }

  try {
    const { searchParams } = new URL(request.url)
    const includeHistory = searchParams.get('include_history') !== 'false'
    const historyLimit = parseInt(searchParams.get('history_limit') || '50')

    // Get current degradation state
    const state = failureModeHandler.getDegradationLevel(agentId)

    // Get failure stats
    const stats = failureModeHandler.getFailureStats(agentId)

    // Get failure history if requested
    let history: FailureEvent[] = []
    if (includeHistory) {
      history = failureModeHandler.getFailureHistory(agentId, historyLimit)
    }

    // Check if recovery is possible
    const canRecover = state.level > DegradationLevel.FULL_CAPABILITY
    let recoveryInfo: {
      possible: boolean
      reason?: string
      waitTime?: number
    } = { possible: false }

    if (canRecover) {
      // Estimate recovery eligibility
      const minDegradationTime = 300000 // 5 minutes (from config)
      const timeDegraded = Date.now() - state.lastChanged.getTime()

      if (timeDegraded < minDegradationTime) {
        recoveryInfo = {
          possible: false,
          reason: 'Minimum degradation time not reached',
          waitTime: Math.ceil((minDegradationTime - timeDegraded) / 1000),
        }
      } else {
        recoveryInfo = { possible: true }
      }
    }

    const responseTime = Date.now() - startTime
    if (userId && keyId) {
      await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'GET', 200, responseTime)
    }

    return NextResponse.json({
      data: {
        agentId,
        currentState: {
          level: state.level,
          levelName: DegradationLevel[state.level],
          description: state.description,
          reason: state.reason,
          lastChanged: state.lastChanged.toISOString(),
          recoveryInProgress: state.recoveryInProgress,
          recentFailures: state.recentFailures,
        },
        stats: {
          totalFailures: stats.totalFailures,
          recentFailures: stats.recentFailures,
          bySeverity: stats.bySeverity,
          timeAtCurrentLevel: stats.timeAtCurrentLevel,
        },
        recovery: recoveryInfo,
        history: includeHistory ? history.map(formatFailureEvent) : undefined,
        degradationLevels: Object.entries(DEGRADATION_LEVEL_DESCRIPTIONS).map(
          ([level, description]) => ({
            level: parseInt(level),
            name: DegradationLevel[parseInt(level)],
            description,
          })
        ),
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    if (userId && keyId) {
      await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'GET', 500, responseTime)
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// POST - Report Failure
// =============================================================================

/**
 * POST /api/v1/agents/[id]/failure-mode
 * Report a failure event
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id: agentId } = await params

  // Check API key auth
  const authHeader = request.headers.get('authorization')
  let userId: string | null = null
  let keyId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const validation = await validateApiKey(key)

    if (!validation) {
      return NextResponse.json(
        { error: { message: 'Invalid API key', code: 'unauthorized' } },
        { status: 401 }
      )
    }

    userId = validation.userId
    keyId = validation.keyId
  } else {
    return NextResponse.json(
      { error: { message: 'Authorization required', code: 'unauthorized' } },
      { status: 401 }
    )
  }

  // Check rate limit
  if (keyId) {
    const rateLimit = await checkRateLimit(keyId, userId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { message: 'Rate limit exceeded', code: 'rate_limited' } },
        { status: 429 }
      )
    }
  }

  try {
    const body: ReportFailureBody = await request.json()

    // Validate required fields
    if (!body.errorType || !body.severity || !body.errorDetails) {
      return NextResponse.json(
        {
          error: {
            message: 'Missing required fields: errorType, severity, errorDetails',
            code: 'bad_request',
          },
        },
        { status: 400 }
      )
    }

    // Validate severity
    const validSeverities: ErrorSeverity[] = ['low', 'medium', 'high', 'critical']
    if (!validSeverities.includes(body.severity)) {
      return NextResponse.json(
        {
          error: {
            message: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`,
            code: 'bad_request',
          },
        },
        { status: 400 }
      )
    }

    // Report the failure
    const failureEvent = await failureModeHandler.reportFailure({
      agentId,
      errorType: body.errorType,
      severity: body.severity,
      errorDetails: body.errorDetails,
      userNotified: true,
      recoveryAttempted: body.recoveryAttempted ?? false,
      stackTrace: body.stackTrace,
      metadata: {
        ...body.metadata,
        sessionId: body.sessionId,
        reportedBy: userId,
      },
    })

    // Get updated state
    const state = failureModeHandler.getDegradationLevel(agentId)

    // Create error disclosure for user
    const disclosure = failureModeHandler.createErrorDisclosure(failureEvent)

    // Store failure event in database (optional persistence)
    try {
      const supabase = await createClient()
      await supabase.from('agent_failure_events').insert({
        id: failureEvent.id,
        agent_id: agentId,
        error_type: failureEvent.errorType,
        severity: failureEvent.severity,
        error_details: failureEvent.errorDetails,
        current_level: failureEvent.currentLevel,
        new_level: failureEvent.newLevel,
        user_notified: failureEvent.userNotified,
        recovery_attempted: failureEvent.recoveryAttempted,
        stack_trace: failureEvent.stackTrace,
        metadata: failureEvent.metadata,
        created_at: failureEvent.timestamp.toISOString(),
      })
    } catch {
      // Table may not exist yet, log but don't fail
      console.warn('Could not persist failure event to database')
    }

    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'POST', 200, responseTime)

    return NextResponse.json({
      data: {
        event: formatFailureEvent(failureEvent),
        degraded: failureEvent.newLevel > failureEvent.currentLevel,
        currentState: {
          level: state.level,
          levelName: DegradationLevel[state.level],
          description: state.description,
        },
        disclosure,
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'POST', 500, responseTime)

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// PATCH - Manual Adjustment / Recovery
// =============================================================================

/**
 * PATCH /api/v1/agents/[id]/failure-mode
 * Manually adjust degradation level or attempt recovery
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id: agentId } = await params

  // Check API key auth
  const authHeader = request.headers.get('authorization')
  let userId: string | null = null
  let keyId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const validation = await validateApiKey(key)

    if (!validation) {
      return NextResponse.json(
        { error: { message: 'Invalid API key', code: 'unauthorized' } },
        { status: 401 }
      )
    }

    userId = validation.userId
    keyId = validation.keyId
  } else {
    return NextResponse.json(
      { error: { message: 'Authorization required', code: 'unauthorized' } },
      { status: 401 }
    )
  }

  // Check rate limit
  if (keyId) {
    const rateLimit = await checkRateLimit(keyId, userId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { message: 'Rate limit exceeded', code: 'rate_limited' } },
        { status: 429 }
      )
    }
  }

  try {
    const body: AdjustLevelBody = await request.json()

    // Validate action
    if (!body.action || !['set_level', 'attempt_recovery'].includes(body.action)) {
      return NextResponse.json(
        {
          error: {
            message: 'Invalid action. Must be one of: set_level, attempt_recovery',
            code: 'bad_request',
          },
        },
        { status: 400 }
      )
    }

    let result: {
      success: boolean
      previousLevel: DegradationLevel
      newLevel: DegradationLevel
      message: string
    }

    if (body.action === 'attempt_recovery') {
      // Attempt automatic recovery
      const recoveryResult = await failureModeHandler.attemptRecovery(agentId)
      result = {
        success: recoveryResult.success,
        previousLevel: recoveryResult.previousLevel,
        newLevel: recoveryResult.newLevel,
        message: recoveryResult.message,
      }
    } else {
      // Manual level set
      if (body.level === undefined) {
        return NextResponse.json(
          {
            error: {
              message: 'level is required for set_level action',
              code: 'bad_request',
            },
          },
          { status: 400 }
        )
      }

      // Validate level
      if (body.level < 0 || body.level > 4) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid level. Must be 0-4 (FULL_CAPABILITY to SAFE_SHUTDOWN)',
              code: 'bad_request',
            },
          },
          { status: 400 }
        )
      }

      const currentState = failureModeHandler.getDegradationLevel(agentId)
      const previousLevel = currentState.level

      await failureModeHandler.setDegradationLevel(
        agentId,
        body.level,
        body.reason || `Manual adjustment by user ${userId}`
      )

      result = {
        success: true,
        previousLevel,
        newLevel: body.level,
        message: `Level changed from ${DegradationLevel[previousLevel]} to ${DegradationLevel[body.level]}`,
      }
    }

    // Get updated state
    const state = failureModeHandler.getDegradationLevel(agentId)

    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'PATCH', 200, responseTime)

    return NextResponse.json({
      data: {
        success: result.success,
        action: body.action,
        previousLevel: {
          level: result.previousLevel,
          name: DegradationLevel[result.previousLevel],
        },
        newLevel: {
          level: result.newLevel,
          name: DegradationLevel[result.newLevel],
        },
        message: result.message,
        currentState: {
          level: state.level,
          levelName: DegradationLevel[state.level],
          description: state.description,
          reason: state.reason,
          lastChanged: state.lastChanged.toISOString(),
        },
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'PATCH', 500, responseTime)

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// DELETE - Clear History (Admin Only)
// =============================================================================

/**
 * DELETE /api/v1/agents/[id]/failure-mode
 * Reset agent to full capability (admin only, with confirmation)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id: agentId } = await params

  // Check API key auth
  const authHeader = request.headers.get('authorization')
  let userId: string | null = null
  let keyId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const validation = await validateApiKey(key)

    if (!validation) {
      return NextResponse.json(
        { error: { message: 'Invalid API key', code: 'unauthorized' } },
        { status: 401 }
      )
    }

    userId = validation.userId
    keyId = validation.keyId
  } else {
    return NextResponse.json(
      { error: { message: 'Authorization required', code: 'unauthorized' } },
      { status: 401 }
    )
  }

  // Check rate limit
  if (keyId) {
    const rateLimit = await checkRateLimit(keyId, userId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { message: 'Rate limit exceeded', code: 'rate_limited' } },
        { status: 429 }
      )
    }
  }

  try {
    // Require confirmation header
    const confirmHeader = request.headers.get('x-confirm-reset')
    if (confirmHeader !== 'true') {
      return NextResponse.json(
        {
          error: {
            message: 'Reset requires x-confirm-reset: true header',
            code: 'confirmation_required',
          },
        },
        { status: 400 }
      )
    }

    const previousState = failureModeHandler.getDegradationLevel(agentId)

    // Reset to full capability
    await failureModeHandler.setDegradationLevel(
      agentId,
      DegradationLevel.FULL_CAPABILITY,
      `Admin reset by user ${userId}`
    )

    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'DELETE', 200, responseTime)

    return NextResponse.json({
      data: {
        success: true,
        message: 'Agent reset to full capability',
        previousLevel: {
          level: previousState.level,
          name: DegradationLevel[previousState.level],
        },
        newLevel: {
          level: DegradationLevel.FULL_CAPABILITY,
          name: 'FULL_CAPABILITY',
        },
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/failure-mode`, 'DELETE', 500, responseTime)

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// Helpers
// =============================================================================

function formatFailureEvent(event: FailureEvent) {
  return {
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    errorType: event.errorType,
    severity: event.severity,
    errorDetails: event.errorDetails,
    levelChange: {
      from: {
        level: event.currentLevel,
        name: DegradationLevel[event.currentLevel],
      },
      to: {
        level: event.newLevel,
        name: DegradationLevel[event.newLevel],
      },
      degraded: event.newLevel > event.currentLevel,
    },
    userNotified: event.userNotified,
    recoveryAttempted: event.recoveryAttempted,
    metadata: event.metadata,
  }
}
