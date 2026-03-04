import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent, deleteAgent } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agents/[id] — Get a single agent
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const agent = await getAgent(id)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    return NextResponse.json({ agent })
  } catch (error) {
    console.error('Get agent error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id] — Update an agent
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, description, system_prompt, model, status, specialization, capabilities, personality_traits } = body

    const agent = await updateAgent(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() }),
      ...(system_prompt !== undefined && { system_prompt: system_prompt?.trim() }),
      ...(model !== undefined && { model }),
      ...(status !== undefined && { status }),
      ...(specialization !== undefined && { specialization }),
      ...(capabilities !== undefined && { capabilities }),
      ...(personality_traits !== undefined && { personality_traits }),
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found or update failed' }, { status: 404 })
    }

    return NextResponse.json({ agent })
  } catch (error) {
    console.error('Update agent error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id] — Delete an agent
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const success = await deleteAgent(id)

    if (!success) {
      return NextResponse.json({ error: 'Agent not found or delete failed' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete agent error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
