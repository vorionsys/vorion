/**
 * Shadow Mode Graduation API
 * POST - Graduate agent from shadow to examination
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShadowManager } from '@/lib/governance/shadow-mode'

export async function POST(
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

    // Verify the agent exists and belongs to user
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id, status, name')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (agent.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const manager = getShadowManager()
    const result = await manager.graduateAgent(agentId)

    if (result.success) {
      // Update agent status in database
      const { error: updateError } = await supabase
        .from('agents')
        .update({ status: result.newStatus })
        .eq('id', agentId)

      if (updateError) {
        console.error('Failed to update agent status:', updateError)
        return NextResponse.json({ error: 'Failed to update agent status' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: result.success,
      newStatus: result.newStatus,
      reason: result.reason,
      agentName: agent.name,
    })
  } catch (error: any) {
    console.error('Shadow graduation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
