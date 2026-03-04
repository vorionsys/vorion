/**
 * Scope Discipline API
 * A3I-OS v2.0 - Phase 2
 *
 * GET /api/v1/agents/[id]/scope
 * Get current scope authorizations and summary
 *
 * POST /api/v1/agents/[id]/scope
 * Create authorization or request scope expansion
 *
 * DELETE /api/v1/agents/[id]/scope
 * Revoke scope authorization
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, checkRateLimit, logApiUsage } from '@/lib/api'
import {
  scopeDiscipline,
  type ScopeBoundaries,
  type ScopeAuthorization,
  type ScopeExpansionRequest,
} from '@/lib/agents/scope-discipline'

// =============================================================================
// Types
// =============================================================================

interface CreateAuthorizationBody {
  action: 'create_authorization'
  sessionId: string
  originalRequest: string
  explicitGrants: string[]
  scopeBoundaries: ScopeBoundaries
  duration?: number
  metadata?: Record<string, unknown>
}

interface CheckScopeBody {
  action: 'check_scope'
  sessionId: string
  actionToCheck: string
  resources?: string[]
}

interface RequestExpansionBody {
  action: 'request_expansion'
  sessionId: string
  authorizationId: string
  requestedScope: Partial<ScopeBoundaries>
  reason: string
}

interface ApproveExpansionBody {
  action: 'approve_expansion'
  requestId: string
  notes?: string
}

interface DenyExpansionBody {
  action: 'deny_expansion'
  requestId: string
  reason: string
}

type PostBody =
  | CreateAuthorizationBody
  | CheckScopeBody
  | RequestExpansionBody
  | ApproveExpansionBody
  | DenyExpansionBody

// =============================================================================
// GET - Current Scope Status
// =============================================================================

/**
 * GET /api/v1/agents/[id]/scope
 * Get current scope authorizations and summary
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
    const sessionId = searchParams.get('session_id') || undefined
    const includeHistory = searchParams.get('include_history') === 'true'
    const historyLimit = parseInt(searchParams.get('history_limit') || '50')

    // Get active authorizations
    const authorizations = scopeDiscipline.getActiveAuthorizations(agentId, sessionId)

    // Get scope summary
    const summary = scopeDiscipline.getScopeSummary(agentId, sessionId)

    // Get pending expansion requests
    const pendingExpansions = scopeDiscipline.getPendingExpansions(agentId)

    // Get usage history if requested
    let usageHistory: ReturnType<typeof scopeDiscipline.getUsageRecords> = []
    if (includeHistory) {
      usageHistory = scopeDiscipline.getUsageRecords({
        agentId,
        sessionId,
        limit: historyLimit,
      })
    }

    const responseTime = Date.now() - startTime
    if (userId && keyId) {
      await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'GET', 200, responseTime)
    }

    return NextResponse.json({
      data: {
        agentId,
        sessionId,
        summary: {
          activeAuthorizations: summary.activeAuthorizations,
          totalGrants: summary.totalGrants,
          allowedSystems: summary.allowedSystems,
          pendingExpansions: summary.pendingExpansions,
          recentDriftEvents: summary.recentDriftEvents,
        },
        authorizations: authorizations.map(formatAuthorization),
        pendingExpansions: pendingExpansions.map(formatExpansionRequest),
        usageHistory: includeHistory ? usageHistory.map(formatUsageRecord) : undefined,
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    if (userId && keyId) {
      await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'GET', 500, responseTime)
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// POST - Create Authorization / Check Scope / Request Expansion
// =============================================================================

/**
 * POST /api/v1/agents/[id]/scope
 * Create authorization, check scope, or request expansion
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
    const body: PostBody = await request.json()

    if (!body.action) {
      return NextResponse.json(
        {
          error: {
            message: 'action is required. Valid actions: create_authorization, check_scope, request_expansion, approve_expansion, deny_expansion',
            code: 'bad_request',
          },
        },
        { status: 400 }
      )
    }

    let responseData: Record<string, unknown>

    switch (body.action) {
      case 'create_authorization': {
        const createBody = body as CreateAuthorizationBody
        if (!createBody.sessionId || !createBody.originalRequest || !createBody.explicitGrants || !createBody.scopeBoundaries) {
          return NextResponse.json(
            {
              error: {
                message: 'Missing required fields: sessionId, originalRequest, explicitGrants, scopeBoundaries',
                code: 'bad_request',
              },
            },
            { status: 400 }
          )
        }

        const authorization = scopeDiscipline.createAuthorization({
          agentId,
          sessionId: createBody.sessionId,
          grantedBy: userId,
          originalRequest: createBody.originalRequest,
          explicitGrants: createBody.explicitGrants,
          scopeBoundaries: createBody.scopeBoundaries,
          duration: createBody.duration,
          metadata: createBody.metadata,
        })

        responseData = {
          authorization: formatAuthorization(authorization),
          message: 'Authorization created successfully',
        }
        break
      }

      case 'check_scope': {
        const checkBody = body as CheckScopeBody
        if (!checkBody.sessionId || !checkBody.actionToCheck) {
          return NextResponse.json(
            {
              error: {
                message: 'Missing required fields: sessionId, actionToCheck',
                code: 'bad_request',
              },
            },
            { status: 400 }
          )
        }

        const result = scopeDiscipline.checkScope(
          agentId,
          checkBody.sessionId,
          checkBody.actionToCheck,
          checkBody.resources || []
        )

        responseData = {
          check: {
            action: checkBody.actionToCheck,
            resources: checkBody.resources || [],
            allowed: result.allowed,
            authorizationId: result.authorizationId,
            denialReason: result.denialReason,
            driftDetected: result.driftDetected,
            drift: result.drift,
            suggestions: result.suggestions,
          },
        }
        break
      }

      case 'request_expansion': {
        const expansionBody = body as RequestExpansionBody
        if (!expansionBody.sessionId || !expansionBody.authorizationId || !expansionBody.requestedScope || !expansionBody.reason) {
          return NextResponse.json(
            {
              error: {
                message: 'Missing required fields: sessionId, authorizationId, requestedScope, reason',
                code: 'bad_request',
              },
            },
            { status: 400 }
          )
        }

        try {
          const request = scopeDiscipline.requestExpansion({
            agentId,
            sessionId: expansionBody.sessionId,
            currentAuthorizationId: expansionBody.authorizationId,
            requestedScope: expansionBody.requestedScope,
            reason: expansionBody.reason,
          })

          responseData = {
            expansionRequest: formatExpansionRequest(request),
            message: 'Expansion request submitted for approval',
          }
        } catch (err) {
          return NextResponse.json(
            {
              error: {
                message: err instanceof Error ? err.message : 'Failed to request expansion',
                code: 'expansion_limit_exceeded',
              },
            },
            { status: 400 }
          )
        }
        break
      }

      case 'approve_expansion': {
        const approveBody = body as ApproveExpansionBody
        if (!approveBody.requestId) {
          return NextResponse.json(
            {
              error: {
                message: 'Missing required field: requestId',
                code: 'bad_request',
              },
            },
            { status: 400 }
          )
        }

        const newAuth = scopeDiscipline.approveExpansion(
          approveBody.requestId,
          userId,
          approveBody.notes
        )

        if (!newAuth) {
          return NextResponse.json(
            {
              error: {
                message: 'Expansion request not found or already resolved',
                code: 'not_found',
              },
            },
            { status: 404 }
          )
        }

        responseData = {
          authorization: formatAuthorization(newAuth),
          message: 'Expansion approved and new authorization created',
        }
        break
      }

      case 'deny_expansion': {
        const denyBody = body as DenyExpansionBody
        if (!denyBody.requestId || !denyBody.reason) {
          return NextResponse.json(
            {
              error: {
                message: 'Missing required fields: requestId, reason',
                code: 'bad_request',
              },
            },
            { status: 400 }
          )
        }

        const denied = scopeDiscipline.denyExpansion(
          denyBody.requestId,
          userId,
          denyBody.reason
        )

        if (!denied) {
          return NextResponse.json(
            {
              error: {
                message: 'Expansion request not found or already resolved',
                code: 'not_found',
              },
            },
            { status: 404 }
          )
        }

        responseData = {
          denied: true,
          requestId: denyBody.requestId,
          message: 'Expansion request denied',
        }
        break
      }

      default:
        return NextResponse.json(
          {
            error: {
              message: `Invalid action: ${(body as { action: string }).action}`,
              code: 'bad_request',
            },
          },
          { status: 400 }
        )
    }

    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'POST', 200, responseTime)

    return NextResponse.json({ data: responseData })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'POST', 500, responseTime)

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: { message, code: 'internal_error' } },
      { status: 500 }
    )
  }
}

// =============================================================================
// DELETE - Revoke Authorization
// =============================================================================

/**
 * DELETE /api/v1/agents/[id]/scope
 * Revoke scope authorization
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
    const { searchParams } = new URL(request.url)
    const authorizationId = searchParams.get('authorization_id')
    const sessionId = searchParams.get('session_id')
    const revokeAll = searchParams.get('revoke_all') === 'true'

    if (!authorizationId && !revokeAll) {
      return NextResponse.json(
        {
          error: {
            message: 'Either authorization_id or revoke_all=true is required',
            code: 'bad_request',
          },
        },
        { status: 400 }
      )
    }

    let revokedCount = 0

    if (revokeAll) {
      // Revoke all authorizations for this agent/session
      const authorizations = scopeDiscipline.getActiveAuthorizations(agentId, sessionId || undefined)
      for (const auth of authorizations) {
        if (scopeDiscipline.revokeAuthorization(auth.id, userId)) {
          revokedCount++
        }
      }
    } else if (authorizationId) {
      // Revoke specific authorization
      const auth = scopeDiscipline.getAuthorization(authorizationId)
      if (!auth || auth.agentId !== agentId) {
        const responseTime = Date.now() - startTime
        await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'DELETE', 404, responseTime)

        return NextResponse.json(
          { error: { message: 'Authorization not found', code: 'not_found' } },
          { status: 404 }
        )
      }

      if (scopeDiscipline.revokeAuthorization(authorizationId, userId)) {
        revokedCount = 1
      }
    }

    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'DELETE', 200, responseTime)

    return NextResponse.json({
      data: {
        success: true,
        revokedCount,
        message: revokedCount === 1
          ? 'Authorization revoked'
          : `${revokedCount} authorizations revoked`,
      },
    })
  } catch (err: unknown) {
    const responseTime = Date.now() - startTime
    await logApiUsage(keyId, userId, `/api/v1/agents/${agentId}/scope`, 'DELETE', 500, responseTime)

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

function formatAuthorization(auth: ScopeAuthorization) {
  return {
    id: auth.id,
    agentId: auth.agentId,
    sessionId: auth.sessionId,
    grantedBy: auth.grantedBy,
    grantedAt: auth.grantedAt.toISOString(),
    expiresAt: auth.expiresAt?.toISOString(),
    status: auth.status,
    explicitGrants: auth.explicitGrants,
    impliedPermissions: auth.impliedPermissions, // Always false
    scopeBoundaries: auth.scopeBoundaries,
    originalRequest: auth.originalRequest,
    metadata: auth.metadata,
  }
}

function formatExpansionRequest(req: ScopeExpansionRequest) {
  return {
    id: req.id,
    agentId: req.agentId,
    sessionId: req.sessionId,
    currentAuthorizationId: req.currentAuthorizationId,
    requestedScope: req.requestedScope,
    reason: req.reason,
    requestedAt: req.requestedAt.toISOString(),
    status: req.status,
    resolvedBy: req.resolvedBy,
    resolvedAt: req.resolvedAt?.toISOString(),
    resolutionNotes: req.resolutionNotes,
  }
}

function formatUsageRecord(record: ReturnType<typeof scopeDiscipline.getUsageRecords>[number]) {
  return {
    id: record.id,
    authorizationId: record.authorizationId,
    action: record.action,
    resources: record.resources,
    allowed: record.allowed,
    driftDetected: record.driftDetected,
    timestamp: record.timestamp.toISOString(),
  }
}
