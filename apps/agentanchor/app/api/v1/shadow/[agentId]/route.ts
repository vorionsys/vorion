/**
 * Shadow Mode Agent API
 * GET - Get shadow metrics for an agent
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShadowManager } from '@/lib/governance/shadow-mode'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the agent exists
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id, status, name')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const manager = getShadowManager()
    const metrics = manager.getMetrics(agentId)

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
      },
      metrics,
      canGraduate: metrics.readyForGraduation,
      inShadowMode: agent.status === 'training' || agent.status === 'examination',
    })
  } catch (error: any) {
    console.error('Shadow agent GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
