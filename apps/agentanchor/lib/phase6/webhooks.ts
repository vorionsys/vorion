/**
 * Phase 6 Webhook Service
 *
 * Manages webhook subscriptions and deliveries for Phase 6 events.
 */

import { createHash, createHmac } from 'crypto'

// =============================================================================
// TYPES
// =============================================================================

export interface WebhookSubscription {
  id: string
  url: string
  secret: string
  events: WebhookEventType[]
  filters?: {
    agentIds?: string[]
    severities?: string[]
    complianceFrameworks?: string[]
  }
  active: boolean
  createdAt: string
  lastTriggered?: string
  failureCount: number
}

export type WebhookEventType =
  | 'gaming_alert.created'
  | 'gaming_alert.resolved'
  | 'ceiling.breach'
  | 'ceiling.warning'
  | 'role_gate.escalate'
  | 'role_gate.deny'
  | 'compliance.violation'
  | 'provenance.created'

export interface WebhookPayload {
  id: string
  event: WebhookEventType
  timestamp: string
  data: Record<string, unknown>
}

export const VALID_WEBHOOK_EVENTS: WebhookEventType[] = [
  'gaming_alert.created',
  'gaming_alert.resolved',
  'ceiling.breach',
  'ceiling.warning',
  'role_gate.escalate',
  'role_gate.deny',
  'compliance.violation',
  'provenance.created',
]

// =============================================================================
// IN-MEMORY STORAGE (use database in production)
// =============================================================================

const webhookSubscriptions: Map<string, WebhookSubscription> = new Map()

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

export function getSubscriptions(): WebhookSubscription[] {
  return Array.from(webhookSubscriptions.values())
}

export function getSubscription(id: string): WebhookSubscription | undefined {
  return webhookSubscriptions.get(id)
}

export function createSubscription(params: {
  url: string
  events: WebhookEventType[]
  filters?: WebhookSubscription['filters']
}): WebhookSubscription {
  const id = generateId()
  const secret = generateSecret()

  const subscription: WebhookSubscription = {
    id,
    url: params.url,
    secret,
    events: params.events,
    filters: params.filters,
    active: true,
    createdAt: new Date().toISOString(),
    failureCount: 0,
  }

  webhookSubscriptions.set(id, subscription)
  return subscription
}

export function updateSubscription(
  id: string,
  updates: {
    active?: boolean
    filters?: WebhookSubscription['filters']
    events?: WebhookEventType[]
  }
): WebhookSubscription | null {
  const subscription = webhookSubscriptions.get(id)
  if (!subscription) return null

  if (updates.active !== undefined) {
    subscription.active = updates.active
  }
  if (updates.filters !== undefined) {
    subscription.filters = updates.filters
  }
  if (updates.events !== undefined) {
    subscription.events = updates.events
  }

  webhookSubscriptions.set(id, subscription)
  return subscription
}

export function deleteSubscription(id: string): boolean {
  return webhookSubscriptions.delete(id)
}

// =============================================================================
// WEBHOOK DELIVERY
// =============================================================================

/**
 * Deliver webhook to all matching subscriptions
 */
export async function deliverWebhook(
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<{ delivered: number; failed: number }> {
  const payload: WebhookPayload = {
    id: generateId(),
    event,
    timestamp: new Date().toISOString(),
    data,
  }

  let delivered = 0
  let failed = 0

  for (const subscription of webhookSubscriptions.values()) {
    // Check if subscription matches
    if (!subscription.active) continue
    if (!subscription.events.includes(event)) continue

    // Check filters
    if (subscription.filters) {
      if (subscription.filters.agentIds && data.agentId) {
        if (!subscription.filters.agentIds.includes(data.agentId as string)) {
          continue
        }
      }
      if (subscription.filters.severities && data.severity) {
        if (!subscription.filters.severities.includes(data.severity as string)) {
          continue
        }
      }
    }

    // Deliver webhook
    try {
      const signature = signPayload(payload, subscription.secret)

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-ID': payload.id,
          'X-Webhook-Event': event,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })

      if (response.ok) {
        subscription.lastTriggered = new Date().toISOString()
        subscription.failureCount = 0
        delivered++
      } else {
        subscription.failureCount++
        failed++
      }
    } catch (error) {
      subscription.failureCount++
      failed++

      // Disable after 5 consecutive failures
      if (subscription.failureCount >= 5) {
        subscription.active = false
        console.warn(`[Webhook] Disabled subscription ${subscription.id} after 5 failures`)
      }
    }
  }

  return { delivered, failed }
}

// =============================================================================
// UTILITIES
// =============================================================================

export function generateId(): string {
  return `whk_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

export function generateSecret(): string {
  return `whsec_${createHash('sha256')
    .update(Math.random().toString())
    .digest('hex')
    .slice(0, 32)}`
}

export function signPayload(payload: WebhookPayload, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  return `t=${timestamp},v1=${signature}`
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * Verify webhook signature (for webhook receivers)
 */
export function verifyWebhookSignature(
  signature: string,
  body: string,
  secret: string,
  tolerance: number = 300 // 5 minutes
): boolean {
  const parts = signature.split(',')
  const timestampPart = parts.find(p => p.startsWith('t='))
  const signaturePart = parts.find(p => p.startsWith('v1='))

  if (!timestampPart || !signaturePart) {
    return false
  }

  const timestamp = parseInt(timestampPart.slice(2), 10)
  const receivedSig = signaturePart.slice(3)

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > tolerance) {
    return false
  }

  // Verify signature
  const expectedSig = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  return receivedSig === expectedSig
}
