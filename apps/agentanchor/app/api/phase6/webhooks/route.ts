/**
 * Phase 6 Webhook Notifications API
 *
 * Manages webhook subscriptions for Phase 6 events:
 * - Gaming alerts
 * - Ceiling breaches
 * - Role gate escalations
 * - Compliance violations
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  isValidUrl,
  VALID_WEBHOOK_EVENTS,
  type WebhookEventType,
} from '@/lib/phase6/webhooks'

/**
 * GET /api/phase6/webhooks
 * List webhook subscriptions
 */
export async function GET(request: NextRequest) {
  const subscriptions = getSubscriptions()
    .map(sub => ({
      ...sub,
      secret: '***hidden***', // Don't expose secrets
    }))

  return NextResponse.json({
    subscriptions,
    count: subscriptions.length,
  })
}

/**
 * POST /api/phase6/webhooks
 * Create a new webhook subscription
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, events, filters } = body

    // Validate URL
    if (!url || !isValidUrl(url)) {
      return NextResponse.json(
        { error: 'Invalid or missing URL' },
        { status: 400 }
      )
    }

    // Validate events
    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'At least one event type is required' },
        { status: 400 }
      )
    }

    for (const event of events) {
      if (!VALID_WEBHOOK_EVENTS.includes(event)) {
        return NextResponse.json(
          { error: `Invalid event type: ${event}` },
          { status: 400 }
        )
      }
    }

    const subscription = createSubscription({
      url,
      events: events as WebhookEventType[],
      filters,
    })

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        url: subscription.url,
        secret: subscription.secret, // Show secret only on creation
        events: subscription.events,
        active: subscription.active,
      },
      message: 'Webhook subscription created. Store the secret securely - it will not be shown again.',
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/phase6/webhooks
 * Delete a webhook subscription
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Subscription ID required' },
        { status: 400 }
      )
    }

    if (!getSubscription(id)) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }

    deleteSubscription(id)

    return NextResponse.json({
      success: true,
      message: 'Webhook subscription deleted',
    })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/phase6/webhooks
 * Update a webhook subscription (toggle active, update filters)
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, active, filters, events } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Subscription ID required' },
        { status: 400 }
      )
    }

    const subscription = updateSubscription(id, { active, filters, events })

    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        url: subscription.url,
        events: subscription.events,
        active: subscription.active,
        filters: subscription.filters,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
