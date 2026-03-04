/**
 * A3I-OS Phase 2: Scope Discipline
 *
 * Prevents agents from exceeding their authorized scope.
 * Agents operate under explicit grants only - NEVER implied permissions.
 *
 * Philosophy: An agent that exceeds scope is not disciplined.
 * Trust requires boundaries that are respected.
 *
 * Features:
 * - Explicit scope authorization model
 * - Drift detection and prevention
 * - Scope expansion request workflow
 * - Audit trail for all scope checks
 */

import { createId } from '@paralleldrive/cuid2'
import type { HierarchyLevel } from './capability-boundaries'

// =============================================================================
// DRIFT TRIGGERS
// =============================================================================

/**
 * Behaviors that indicate scope drift
 */
export const DRIFT_TRIGGERS = [
  'action_outside_original_request',
  'scope_expansion_without_confirmation',
  'resource_access_beyond_stated_need',
  'timeline_extension_without_approval',
  'data_access_beyond_required',
  'system_access_not_in_original_scope',
  'delegation_without_authorization',
] as const

export type DriftTrigger = (typeof DRIFT_TRIGGERS)[number]

/**
 * Drift severity levels
 */
export type DriftSeverity = 'minor' | 'moderate' | 'major' | 'critical'

/**
 * Actions to take when drift is detected
 */
export type DriftAction = 'log' | 'warn' | 'block' | 'escalate'

/**
 * Drift detection thresholds
 */
export const DRIFT_SEVERITY_ACTIONS: Record<DriftSeverity, DriftAction> = {
  minor: 'log',
  moderate: 'warn',
  major: 'block',
  critical: 'escalate',
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Scope boundaries define what an agent is allowed to access
 */
export interface ScopeBoundaries {
  /** Systems the agent can interact with */
  allowedSystems: string[]

  /** Types of data the agent can access */
  allowedDataTypes: string[]

  /** Operations the agent can perform */
  allowedOperations: string[]

  /** Optional time window for authorization */
  timeWindow?: {
    start: Date
    end: Date
  }

  /** Maximum number of actions allowed */
  maxActions?: number

  /** Maximum data volume that can be accessed (bytes) */
  maxDataVolume?: number

  /** Specific resources that are off-limits */
  excludedResources?: string[]
}

/**
 * Scope authorization record
 * Tracks what an agent is explicitly allowed to do
 */
export interface ScopeAuthorization {
  /** Unique authorization ID */
  id: string

  /** Agent being authorized */
  agentId: string

  /** Session this authorization applies to */
  sessionId: string

  /** User who granted the authorization */
  grantedBy: string

  /** When the authorization was granted */
  grantedAt: Date

  /** When the authorization expires (if applicable) */
  expiresAt?: Date

  /** Explicitly authorized actions */
  explicitGrants: string[]

  /** ALWAYS false - permissions are NEVER implied */
  impliedPermissions: false

  /** Scope boundaries */
  scopeBoundaries: ScopeBoundaries

  /** Original request that this authorization supports */
  originalRequest: string

  /** Current status */
  status: 'active' | 'expired' | 'revoked' | 'suspended'

  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Scope check result
 */
export interface ScopeCheckResult {
  /** Whether the action is within scope */
  allowed: boolean

  /** Authorization ID that allows this action (if allowed) */
  authorizationId?: string

  /** Reason for denial (if denied) */
  denialReason?: string

  /** Drift detected (even if allowed) */
  driftDetected: boolean

  /** Drift details if detected */
  drift?: {
    trigger: DriftTrigger
    severity: DriftSeverity
    action: DriftAction
    details: string
  }

  /** Suggested actions for the user */
  suggestions?: string[]
}

/**
 * Scope expansion request
 */
export interface ScopeExpansionRequest {
  /** Request ID */
  id: string

  /** Agent requesting expansion */
  agentId: string

  /** Session ID */
  sessionId: string

  /** Current authorization being expanded */
  currentAuthorizationId: string

  /** What additional scope is being requested */
  requestedScope: Partial<ScopeBoundaries>

  /** Reason for the expansion */
  reason: string

  /** When the request was made */
  requestedAt: Date

  /** Request status */
  status: 'pending' | 'approved' | 'denied' | 'expired'

  /** Who approved/denied (if resolved) */
  resolvedBy?: string

  /** When it was resolved */
  resolvedAt?: Date

  /** Resolution notes */
  resolutionNotes?: string
}

/**
 * Scope usage record (for audit)
 */
export interface ScopeUsageRecord {
  /** Record ID */
  id: string

  /** Authorization ID */
  authorizationId: string

  /** Agent ID */
  agentId: string

  /** Session ID */
  sessionId: string

  /** Action that was checked */
  action: string

  /** Resources accessed */
  resources: string[]

  /** Whether it was allowed */
  allowed: boolean

  /** Whether drift was detected */
  driftDetected: boolean

  /** Timestamp */
  timestamp: Date
}

/**
 * Scope discipline configuration
 */
export interface ScopeDisciplineConfig {
  /** Whether to enable strict mode (block on any drift) */
  strictMode: boolean

  /** Default authorization duration in milliseconds */
  defaultAuthorizationDuration: number

  /** Maximum scope expansion requests per session */
  maxExpansionRequests: number

  /** Whether to log all scope checks */
  auditAllChecks: boolean

  /** Callback for scope events */
  onScopeEvent?: (event: ScopeEvent) => void
}

/**
 * Scope event for logging/callbacks
 */
export interface ScopeEvent {
  type: 'check' | 'grant' | 'revoke' | 'expansion_request' | 'drift_detected'
  agentId: string
  sessionId: string
  timestamp: Date
  details: Record<string, unknown>
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: ScopeDisciplineConfig = {
  strictMode: false,
  defaultAuthorizationDuration: 3600000, // 1 hour
  maxExpansionRequests: 5,
  auditAllChecks: true,
}

// =============================================================================
// SCOPE DISCIPLINE SERVICE
// =============================================================================

/**
 * Scope Discipline Service
 *
 * Manages scope authorizations and prevents agents from exceeding boundaries.
 */
export class ScopeDisciplineService {
  private config: ScopeDisciplineConfig
  private authorizations: Map<string, ScopeAuthorization> = new Map()
  private expansionRequests: Map<string, ScopeExpansionRequest[]> = new Map()
  private usageRecords: ScopeUsageRecord[] = []
  private actionCounts: Map<string, number> = new Map()

  constructor(config: Partial<ScopeDisciplineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ---------------------------------------------------------------------------
  // AUTHORIZATION MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Create a new scope authorization
   */
  createAuthorization(params: {
    agentId: string
    sessionId: string
    grantedBy: string
    originalRequest: string
    explicitGrants: string[]
    scopeBoundaries: ScopeBoundaries
    duration?: number
    metadata?: Record<string, unknown>
  }): ScopeAuthorization {
    const now = new Date()
    const duration = params.duration ?? this.config.defaultAuthorizationDuration

    const authorization: ScopeAuthorization = {
      id: createId(),
      agentId: params.agentId,
      sessionId: params.sessionId,
      grantedBy: params.grantedBy,
      grantedAt: now,
      expiresAt: duration > 0 ? new Date(now.getTime() + duration) : undefined,
      explicitGrants: params.explicitGrants,
      impliedPermissions: false, // ALWAYS false
      scopeBoundaries: params.scopeBoundaries,
      originalRequest: params.originalRequest,
      status: 'active',
      metadata: params.metadata,
    }

    this.authorizations.set(authorization.id, authorization)
    this.emitEvent({
      type: 'grant',
      agentId: params.agentId,
      sessionId: params.sessionId,
      timestamp: now,
      details: {
        authorizationId: authorization.id,
        grants: params.explicitGrants,
        boundaries: params.scopeBoundaries,
      },
    })

    return authorization
  }

  /**
   * Revoke an authorization
   */
  revokeAuthorization(authorizationId: string, revokedBy: string): boolean {
    const auth = this.authorizations.get(authorizationId)
    if (!auth) return false

    auth.status = 'revoked'
    this.authorizations.set(authorizationId, auth)

    this.emitEvent({
      type: 'revoke',
      agentId: auth.agentId,
      sessionId: auth.sessionId,
      timestamp: new Date(),
      details: {
        authorizationId,
        revokedBy,
      },
    })

    return true
  }

  /**
   * Get active authorizations for an agent/session
   */
  getActiveAuthorizations(agentId: string, sessionId?: string): ScopeAuthorization[] {
    const now = new Date()
    const results: ScopeAuthorization[] = []

    for (const auth of this.authorizations.values()) {
      if (auth.agentId !== agentId) continue
      if (sessionId && auth.sessionId !== sessionId) continue
      if (auth.status !== 'active') continue
      if (auth.expiresAt && auth.expiresAt < now) {
        auth.status = 'expired'
        continue
      }
      results.push(auth)
    }

    return results
  }

  /**
   * Get a specific authorization
   */
  getAuthorization(authorizationId: string): ScopeAuthorization | null {
    return this.authorizations.get(authorizationId) || null
  }

  // ---------------------------------------------------------------------------
  // SCOPE CHECKING
  // ---------------------------------------------------------------------------

  /**
   * Check if an action is within scope
   *
   * @param agentId - Agent attempting the action
   * @param sessionId - Current session
   * @param action - Action being attempted
   * @param resources - Resources being accessed
   * @returns Scope check result
   */
  checkScope(
    agentId: string,
    sessionId: string,
    action: string,
    resources: string[] = []
  ): ScopeCheckResult {
    const authorizations = this.getActiveAuthorizations(agentId, sessionId)

    if (authorizations.length === 0) {
      const result: ScopeCheckResult = {
        allowed: false,
        denialReason: 'No active authorization found for this agent/session',
        driftDetected: false,
        suggestions: ['Request authorization before performing actions'],
      }
      this.recordUsage(null, agentId, sessionId, action, resources, result)
      return result
    }

    // Check each authorization
    for (const auth of authorizations) {
      const result = this.checkAgainstAuthorization(auth, action, resources)

      // Track action count
      if (result.allowed) {
        const countKey = auth.id
        const currentCount = (this.actionCounts.get(countKey) || 0) + 1
        this.actionCounts.set(countKey, currentCount)

        // Check max actions
        if (auth.scopeBoundaries.maxActions && currentCount > auth.scopeBoundaries.maxActions) {
          result.allowed = false
          result.denialReason = `Maximum action count (${auth.scopeBoundaries.maxActions}) exceeded`
          result.suggestions = ['Request scope expansion for additional actions']
        }
      }

      this.recordUsage(auth.id, agentId, sessionId, action, resources, result)

      if (result.allowed || result.driftDetected) {
        return result
      }
    }

    // No authorization covers this action
    const result: ScopeCheckResult = {
      allowed: false,
      denialReason: 'Action not covered by any active authorization',
      driftDetected: true,
      drift: {
        trigger: 'action_outside_original_request',
        severity: 'major',
        action: 'block',
        details: `Action "${action}" is not in any explicit grant`,
      },
      suggestions: ['Request scope expansion for this action'],
    }

    this.emitEvent({
      type: 'drift_detected',
      agentId,
      sessionId,
      timestamp: new Date(),
      details: { action, resources, drift: result.drift },
    })

    return result
  }

  /**
   * Check action against a specific authorization
   */
  private checkAgainstAuthorization(
    auth: ScopeAuthorization,
    action: string,
    resources: string[]
  ): ScopeCheckResult {
    const result: ScopeCheckResult = {
      allowed: false,
      authorizationId: auth.id,
      driftDetected: false,
    }

    // Check explicit grants
    const isExplicitlyGranted = auth.explicitGrants.some(
      (grant) => this.matchesGrant(action, grant)
    )

    if (!isExplicitlyGranted) {
      // Check if this might be scope drift
      const driftAnalysis = this.analyzeDrift(auth, action, resources)

      if (driftAnalysis.isDrift) {
        result.driftDetected = true
        result.drift = driftAnalysis.drift
        result.denialReason = `Action outside scope: ${driftAnalysis.drift?.details}`

        // In strict mode, always block drift
        if (this.config.strictMode || driftAnalysis.drift?.action === 'block') {
          result.allowed = false
          return result
        }
      }

      result.denialReason = 'Action not in explicit grants'
      return result
    }

    // Check time window
    if (auth.scopeBoundaries.timeWindow) {
      const now = new Date()
      if (now < auth.scopeBoundaries.timeWindow.start || now > auth.scopeBoundaries.timeWindow.end) {
        result.denialReason = 'Outside authorized time window'
        return result
      }
    }

    // Check allowed operations
    const operationAllowed = auth.scopeBoundaries.allowedOperations.length === 0 ||
      auth.scopeBoundaries.allowedOperations.some((op) => action.toLowerCase().includes(op.toLowerCase()))

    if (!operationAllowed) {
      result.denialReason = 'Operation type not allowed'
      result.driftDetected = true
      result.drift = {
        trigger: 'action_outside_original_request',
        severity: 'moderate',
        action: 'warn',
        details: `Operation not in allowed list: ${action}`,
      }
      return result
    }

    // Check excluded resources
    if (auth.scopeBoundaries.excludedResources && auth.scopeBoundaries.excludedResources.length > 0) {
      for (const resource of resources) {
        if (auth.scopeBoundaries.excludedResources.some((ex) => resource.includes(ex))) {
          result.denialReason = `Resource "${resource}" is explicitly excluded`
          result.driftDetected = true
          result.drift = {
            trigger: 'resource_access_beyond_stated_need',
            severity: 'major',
            action: 'block',
            details: `Attempted access to excluded resource: ${resource}`,
          }
          return result
        }
      }
    }

    // Check allowed systems
    if (auth.scopeBoundaries.allowedSystems.length > 0) {
      for (const resource of resources) {
        const systemMatch = auth.scopeBoundaries.allowedSystems.some(
          (sys) => resource.includes(sys)
        )
        if (!systemMatch && resources.length > 0) {
          result.driftDetected = true
          result.drift = {
            trigger: 'system_access_not_in_original_scope',
            severity: 'moderate',
            action: 'warn',
            details: `Resource "${resource}" may be outside allowed systems`,
          }
          // Still allow but flag drift
        }
      }
    }

    result.allowed = true
    return result
  }

  /**
   * Check if action matches a grant pattern
   */
  private matchesGrant(action: string, grant: string): boolean {
    // Exact match
    if (action === grant) return true

    // Wildcard match (e.g., "read:*" matches "read:users")
    if (grant.endsWith('*')) {
      const prefix = grant.slice(0, -1)
      if (action.startsWith(prefix)) return true
    }

    // Category match (e.g., "read" matches "read:users")
    if (action.startsWith(grant + ':')) return true

    return false
  }

  /**
   * Analyze potential drift
   */
  private analyzeDrift(
    auth: ScopeAuthorization,
    action: string,
    resources: string[]
  ): { isDrift: boolean; drift?: ScopeCheckResult['drift'] } {
    // Check if action is completely unrelated to original request
    const originalWords = auth.originalRequest.toLowerCase().split(/\s+/)
    const actionWords = action.toLowerCase().split(/[_\-:]/g)

    const hasOverlap = actionWords.some((word) =>
      originalWords.some((ow) => ow.includes(word) || word.includes(ow))
    )

    if (!hasOverlap) {
      return {
        isDrift: true,
        drift: {
          trigger: 'action_outside_original_request',
          severity: 'major',
          action: 'block',
          details: `Action "${action}" has no relation to original request`,
        },
      }
    }

    // Check for resource access beyond stated need
    const grantedDataTypes = auth.scopeBoundaries.allowedDataTypes
    if (grantedDataTypes.length > 0 && resources.length > 0) {
      for (const resource of resources) {
        const typeMatch = grantedDataTypes.some((dt) =>
          resource.toLowerCase().includes(dt.toLowerCase())
        )
        if (!typeMatch) {
          return {
            isDrift: true,
            drift: {
              trigger: 'data_access_beyond_required',
              severity: 'moderate',
              action: 'warn',
              details: `Resource "${resource}" may exceed data type boundaries`,
            },
          }
        }
      }
    }

    return { isDrift: false }
  }

  // ---------------------------------------------------------------------------
  // SCOPE EXPANSION
  // ---------------------------------------------------------------------------

  /**
   * Request scope expansion
   */
  requestExpansion(params: {
    agentId: string
    sessionId: string
    currentAuthorizationId: string
    requestedScope: Partial<ScopeBoundaries>
    reason: string
  }): ScopeExpansionRequest {
    // Check expansion request limit
    const key = `${params.agentId}:${params.sessionId}`
    const existing = this.expansionRequests.get(key) || []

    if (existing.length >= this.config.maxExpansionRequests) {
      throw new Error(
        `Maximum scope expansion requests (${this.config.maxExpansionRequests}) exceeded for this session`
      )
    }

    const request: ScopeExpansionRequest = {
      id: createId(),
      agentId: params.agentId,
      sessionId: params.sessionId,
      currentAuthorizationId: params.currentAuthorizationId,
      requestedScope: params.requestedScope,
      reason: params.reason,
      requestedAt: new Date(),
      status: 'pending',
    }

    existing.push(request)
    this.expansionRequests.set(key, existing)

    this.emitEvent({
      type: 'expansion_request',
      agentId: params.agentId,
      sessionId: params.sessionId,
      timestamp: new Date(),
      details: {
        requestId: request.id,
        requestedScope: params.requestedScope,
        reason: params.reason,
      },
    })

    return request
  }

  /**
   * Approve scope expansion
   */
  approveExpansion(
    requestId: string,
    approvedBy: string,
    notes?: string
  ): ScopeAuthorization | null {
    // Find the request
    let request: ScopeExpansionRequest | null = null
    for (const requests of this.expansionRequests.values()) {
      const found = requests.find((r) => r.id === requestId)
      if (found) {
        request = found
        break
      }
    }

    if (!request || request.status !== 'pending') {
      return null
    }

    // Get original authorization
    const originalAuth = this.authorizations.get(request.currentAuthorizationId)
    if (!originalAuth) return null

    // Update request status
    request.status = 'approved'
    request.resolvedBy = approvedBy
    request.resolvedAt = new Date()
    request.resolutionNotes = notes

    // Create new expanded authorization
    const expandedBoundaries: ScopeBoundaries = {
      ...originalAuth.scopeBoundaries,
      allowedSystems: [
        ...originalAuth.scopeBoundaries.allowedSystems,
        ...(request.requestedScope.allowedSystems || []),
      ],
      allowedDataTypes: [
        ...originalAuth.scopeBoundaries.allowedDataTypes,
        ...(request.requestedScope.allowedDataTypes || []),
      ],
      allowedOperations: [
        ...originalAuth.scopeBoundaries.allowedOperations,
        ...(request.requestedScope.allowedOperations || []),
      ],
      maxActions: request.requestedScope.maxActions ?? originalAuth.scopeBoundaries.maxActions,
      maxDataVolume: request.requestedScope.maxDataVolume ?? originalAuth.scopeBoundaries.maxDataVolume,
    }

    // Create new authorization with expanded scope
    return this.createAuthorization({
      agentId: request.agentId,
      sessionId: request.sessionId,
      grantedBy: approvedBy,
      originalRequest: `${originalAuth.originalRequest} [EXPANDED: ${request.reason}]`,
      explicitGrants: originalAuth.explicitGrants,
      scopeBoundaries: expandedBoundaries,
      metadata: {
        expandedFrom: originalAuth.id,
        expansionRequestId: request.id,
      },
    })
  }

  /**
   * Deny scope expansion
   */
  denyExpansion(requestId: string, deniedBy: string, reason: string): boolean {
    for (const requests of this.expansionRequests.values()) {
      const request = requests.find((r) => r.id === requestId)
      if (request && request.status === 'pending') {
        request.status = 'denied'
        request.resolvedBy = deniedBy
        request.resolvedAt = new Date()
        request.resolutionNotes = reason
        return true
      }
    }
    return false
  }

  /**
   * Get pending expansion requests
   */
  getPendingExpansions(agentId?: string): ScopeExpansionRequest[] {
    const results: ScopeExpansionRequest[] = []
    for (const requests of this.expansionRequests.values()) {
      for (const request of requests) {
        if (request.status !== 'pending') continue
        if (agentId && request.agentId !== agentId) continue
        results.push(request)
      }
    }
    return results
  }

  // ---------------------------------------------------------------------------
  // USAGE RECORDING
  // ---------------------------------------------------------------------------

  /**
   * Record scope usage for audit
   */
  private recordUsage(
    authorizationId: string | null,
    agentId: string,
    sessionId: string,
    action: string,
    resources: string[],
    result: ScopeCheckResult
  ): void {
    if (!this.config.auditAllChecks && result.allowed && !result.driftDetected) {
      return
    }

    const record: ScopeUsageRecord = {
      id: createId(),
      authorizationId: authorizationId || 'none',
      agentId,
      sessionId,
      action,
      resources,
      allowed: result.allowed,
      driftDetected: result.driftDetected,
      timestamp: new Date(),
    }

    this.usageRecords.push(record)

    // Keep only recent records (last 10000)
    if (this.usageRecords.length > 10000) {
      this.usageRecords = this.usageRecords.slice(-10000)
    }

    this.emitEvent({
      type: 'check',
      agentId,
      sessionId,
      timestamp: record.timestamp,
      details: {
        action,
        resources,
        allowed: result.allowed,
        driftDetected: result.driftDetected,
      },
    })
  }

  /**
   * Get usage records for audit
   */
  getUsageRecords(filters?: {
    agentId?: string
    sessionId?: string
    authorizationId?: string
    allowed?: boolean
    driftOnly?: boolean
    limit?: number
  }): ScopeUsageRecord[] {
    let records = [...this.usageRecords]

    if (filters?.agentId) {
      records = records.filter((r) => r.agentId === filters.agentId)
    }
    if (filters?.sessionId) {
      records = records.filter((r) => r.sessionId === filters.sessionId)
    }
    if (filters?.authorizationId) {
      records = records.filter((r) => r.authorizationId === filters.authorizationId)
    }
    if (filters?.allowed !== undefined) {
      records = records.filter((r) => r.allowed === filters.allowed)
    }
    if (filters?.driftOnly) {
      records = records.filter((r) => r.driftDetected)
    }

    // Sort by timestamp descending (newest first)
    records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    if (filters?.limit) {
      records = records.slice(0, filters.limit)
    }

    return records
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Emit scope event
   */
  private emitEvent(event: ScopeEvent): void {
    if (this.config.onScopeEvent) {
      this.config.onScopeEvent(event)
    }
  }

  /**
   * Check if action would be allowed (without recording)
   */
  wouldAllow(
    agentId: string,
    sessionId: string,
    action: string,
    resources: string[] = []
  ): boolean {
    const authorizations = this.getActiveAuthorizations(agentId, sessionId)

    for (const auth of authorizations) {
      const result = this.checkAgainstAuthorization(auth, action, resources)
      if (result.allowed) return true
    }

    return false
  }

  /**
   * Get scope summary for an agent
   */
  getScopeSummary(agentId: string, sessionId?: string): {
    activeAuthorizations: number
    totalGrants: string[]
    allowedSystems: string[]
    pendingExpansions: number
    recentDriftEvents: number
  } {
    const authorizations = this.getActiveAuthorizations(agentId, sessionId)
    const pendingExpansions = this.getPendingExpansions(agentId)

    const allGrants = new Set<string>()
    const allSystems = new Set<string>()

    for (const auth of authorizations) {
      auth.explicitGrants.forEach((g) => allGrants.add(g))
      auth.scopeBoundaries.allowedSystems.forEach((s) => allSystems.add(s))
    }

    const recentRecords = this.getUsageRecords({
      agentId,
      driftOnly: true,
      limit: 100,
    })

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
    const recentDrift = recentRecords.filter(
      (r) => r.timestamp.getTime() > fiveMinutesAgo
    ).length

    return {
      activeAuthorizations: authorizations.length,
      totalGrants: Array.from(allGrants),
      allowedSystems: Array.from(allSystems),
      pendingExpansions: pendingExpansions.length,
      recentDriftEvents: recentDrift,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Scope Discipline Service instance
 *
 * @example
 * ```typescript
 * const scopeService = createScopeDiscipline({ strictMode: true })
 *
 * // Create authorization
 * const auth = scopeService.createAuthorization({
 *   agentId: 'agent-123',
 *   sessionId: 'session-456',
 *   grantedBy: 'user-789',
 *   originalRequest: 'Analyze sales data and generate report',
 *   explicitGrants: ['read:sales_data', 'create:report'],
 *   scopeBoundaries: {
 *     allowedSystems: ['sales-db', 'reporting-service'],
 *     allowedDataTypes: ['sales', 'revenue'],
 *     allowedOperations: ['read', 'analyze', 'create'],
 *   }
 * })
 *
 * // Check scope
 * const check = scopeService.checkScope(
 *   'agent-123',
 *   'session-456',
 *   'read:sales_data',
 *   ['sales-db/q4-revenue']
 * )
 *
 * if (check.allowed) {
 *   // Proceed with action
 * } else {
 *   console.log('Denied:', check.denialReason)
 * }
 * ```
 */
export function createScopeDiscipline(
  config?: Partial<ScopeDisciplineConfig>
): ScopeDisciplineService {
  return new ScopeDisciplineService(config)
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default singleton instance for application-wide use
 */
export const scopeDiscipline = createScopeDiscipline()

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Class
  ScopeDisciplineService,

  // Factory
  createScopeDiscipline,

  // Singleton
  scopeDiscipline,

  // Constants
  DRIFT_TRIGGERS,
  DRIFT_SEVERITY_ACTIONS,
}
