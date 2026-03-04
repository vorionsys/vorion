import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'
import { getXaiClient } from '@/lib/llm/xai'
import { config } from '@/lib/config'

const xai = getXaiClient()

// POST - Get AI suggestions for which agents to use
export async function POST(req: NextRequest) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { question, availableBots } = await req.json()

    if (!question || !availableBots || availableBots.length === 0) {
      return NextResponse.json(
        { error: 'Question and available bots required' },
        { status: 400 }
      )
    }

    // Build a summary of available bots
    const botsSummary = availableBots
      .map(
        (bot: any, idx: number) =>
          `${idx + 1}. ${bot.name} (ID: ${bot.id}): ${bot.description || 'No description'}`
      )
      .join('\n')

    // Ask xAI to suggest which bots to use
    const response = await xai.chat.completions.create({
      model: config.xai.defaultModel,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: `You are an AI assistant helping users select the best AI agents for their collaboration needs.

The user wants to discuss the following:
"${question}"

Here are the available AI agents:
${botsSummary}

Based on the user's question, suggest 3-7 agents that would be most helpful for this collaboration. Consider:
1. Which agents have expertise relevant to the question
2. Complementary perspectives (e.g., technical + creative + analytical)
3. Avoid redundancy unless multiple similar agents add value
4. Prefer 3-5 agents for most questions, use 6-7 only if truly beneficial

Respond with ONLY a JSON array of bot IDs in order of relevance (most relevant first). Example format:
["bot-id-1", "bot-id-2", "bot-id-3"]

Do not include any explanation, just the JSON array.`,
        },
      ],
    })

    const content = response.choices[0]?.message?.content || ''

    // Parse the suggested bot IDs
    let suggestedBotIds: string[] = []
    try {
      // Extract JSON array from response
      const match = content.match(/\[.*\]/)
      if (match) {
        suggestedBotIds = JSON.parse(match[0])
      } else {
        throw new Error('No JSON array found in response')
      }
    } catch (parseError) {
      console.error('Error parsing xAI response:', content)
      // Fallback: return first 3-5 bots
      suggestedBotIds = availableBots.slice(0, 4).map((b: any) => b.id)
    }

    // Validate that suggested IDs exist in available bots
    const validBotIds = suggestedBotIds.filter((id) =>
      availableBots.some((b: any) => b.id === id)
    )

    return NextResponse.json({
      suggestedBotIds: validBotIds,
      reasoning: `Based on your question, these ${validBotIds.length} agents would provide the most valuable perspectives.`,
    })
  } catch (error: any) {
    console.error('Error suggesting agents:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
