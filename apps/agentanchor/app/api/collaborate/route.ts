import { NextRequest } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'
import { getXaiClient } from '@/lib/llm/xai'
import { config } from '@/lib/config'

const xai = getXaiClient()

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  try {
    const { conversationId, message, messages, bots } = await req.json()

    // Verify authentication
    const supabase = await createRouteClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Prepare messages for xAI
    const chatMessages = messages.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }))

    // Add current message
    chatMessages.push({
      role: 'user',
      content: message,
    })

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // ALL selected bots will respond in sequence
          for (let i = 0; i < bots.length; i++) {
            const bot = bots[i]

            // Signal which bot is starting
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'bot_start',
                  bot: { id: bot.id, name: bot.name },
                })}\n\n`
              )
            )

            // Build system prompt for collaboration context
            let botSystemPrompt = bot.system_prompt

            if (i === 0) {
              // First bot
              botSystemPrompt += `\n\nYou are ${bot.name}, the first agent responding in a collaborative session with ${bots.length - 1} other agent${bots.length - 1 !== 1 ? 's' : ''}. Provide your expertise and perspective. Other agents will build on your response.`
            } else if (i === bots.length - 1) {
              // Last bot
              const previousBotNames = bots
                .slice(0, i)
                .map((b: any) => b.name)
                .join(', ')
              botSystemPrompt += `\n\nYou are ${bot.name}, the final agent in this collaborative session. You've seen responses from ${previousBotNames}. Provide your unique perspective, synthesize insights from other agents where appropriate, and offer a comprehensive conclusion.`
            } else {
              // Middle bots
              const previousBotNames = bots
                .slice(0, i)
                .map((b: any) => b.name)
                .join(', ')
              const upcomingCount = bots.length - i - 1
              botSystemPrompt += `\n\nYou are ${bot.name}, responding in a collaborative session. You've seen responses from ${previousBotNames}. ${upcomingCount} more agent${upcomingCount !== 1 ? 's' : ''} will respond after you. Build on what's been discussed and add your unique expertise.`
            }

            // Get bot's response
            const messageStream = await xai.chat.completions.create({
              model: config.xai.defaultModel,
              max_tokens: Math.min(bot.max_tokens || config.xai.maxTokens, 2048),
              temperature: bot.temperature ?? config.xai.temperature,
              messages: [
                { role: 'system', content: botSystemPrompt },
                ...chatMessages,
              ],
              stream: true,
            })

            let botResponse = ''

            for await (const event of messageStream) {
              const delta = event.choices[0]?.delta?.content
              if (delta) {
                botResponse += delta
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'content',
                      content: delta,
                    })}\n\n`
                  )
                )
              }
            }

            // Add bot's response to conversation history for next bots
            chatMessages.push({
              role: 'assistant',
              content: `[${bot.name}]: ${botResponse}`,
            })
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error: any) {
          console.error('Collaboration streaming error:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error.message })}\n\n`
            )
          )
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('Collaboration API error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }
}
