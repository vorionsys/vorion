import { NextRequest, NextResponse } from 'next/server'
import { listAgents, createAgent } from '@/lib/db'

/**
 * GET /api/agents — List all agents for the authenticated user
 */
export async function GET() {
  try {
    const agents = await listAgents()
    return NextResponse.json({ agents })
  } catch (error) {
    console.error('List agents error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents — Create a new agent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, system_prompt, model, specialization, capabilities, personality_traits } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 })
    }

    const agent = await createAgent({
      name: name.trim(),
      description: description?.trim(),
      system_prompt: system_prompt?.trim(),
      model,
      specialization,
      capabilities,
      personality_traits,
    })

    if (!agent) {
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
    }

    return NextResponse.json({ agent }, { status: 201 })
  } catch (error) {
    console.error('Create agent error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
