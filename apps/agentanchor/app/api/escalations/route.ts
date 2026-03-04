/**
 * Escalations API
 * GET - List escalations with stats
 * POST - Create escalation
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getEscalations,
  createEscalation,
  getPendingEscalationCount,
  type EscalationStatus,
  type EscalationPriority,
} from '@/lib/escalations'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as EscalationStatus | null
    const priority = searchParams.get('priority') as EscalationPriority | null

    const filters: { status?: EscalationStatus; priority?: EscalationPriority } = {}
    if (status) filters.status = status
    if (priority) filters.priority = priority

    // Get escalations
    const { escalations, total } = await getEscalations(filters)

    // Get pending count for stats
    const pending = await getPendingEscalationCount()

    // Calculate today's stats
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const approvedToday = escalations.filter(
      e => e.status === 'approved' && e.resolvedAt && new Date(e.resolvedAt) >= today
    ).length
    const rejectedToday = escalations.filter(
      e => e.status === 'rejected' && e.resolvedAt && new Date(e.resolvedAt) >= today
    ).length

    return NextResponse.json({
      escalations,
      total,
      stats: {
        pending,
        approved_today: approvedToday,
        rejected_today: rejectedToday,
        total,
      },
    })
  } catch (error: any) {
    console.error('Escalations GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { decisionId, agentId, reason, priority, context } = body

    if (!decisionId || !agentId || !reason || !context) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const escalation = await createEscalation({
      decisionId,
      agentId,
      reason,
      priority,
      context,
    })

    return NextResponse.json({ escalation })
  } catch (error: any) {
    console.error('Escalations POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
