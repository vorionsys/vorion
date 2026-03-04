/**
 * Shadow Mode API
 * GET - Get shadow mode stats and metrics
 * POST - Create shadow execution record
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShadowManager } from '@/lib/governance/shadow-mode'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    const manager = getShadowManager()

    if (agentId) {
      // Get metrics for specific agent
      const metrics = manager.getMetrics(agentId)
      return NextResponse.json({ metrics })
    }

    // Return general shadow mode info
    return NextResponse.json({
      config: {
        graduationThreshold: 95,
        minimumExecutions: 100,
        comparisonWindow: 7,
        autoGraduate: false,
      },
      description: 'Shadow mode enables training in production without risk. Shadow agents process real data but outputs are discarded and compared for quality.',
    })
  } catch (error: any) {
    console.error('Shadow GET error:', error)
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
    const { shadowAgentId, certifiedAgentId, input, shadowOutput, certifiedOutput } = body

    if (!shadowAgentId || !input || !shadowOutput) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const manager = getShadowManager()
    const matchScore = certifiedOutput
      ? manager.calculateMatchScore(shadowOutput, certifiedOutput)
      : null

    // Record the execution
    if (certifiedAgentId && certifiedOutput && matchScore !== null) {
      manager.recordExecution({
        id: `shadow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        shadowAgentId,
        certifiedAgentId,
        input,
        shadowOutput,
        certifiedOutput,
        matchScore,
        timestamp: new Date(),
        discarded: true,
      })
    }

    const metrics = manager.getMetrics(shadowAgentId)

    return NextResponse.json({
      matchScore,
      metrics,
      readyForGraduation: metrics.readyForGraduation,
    })
  } catch (error: any) {
    console.error('Shadow POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
