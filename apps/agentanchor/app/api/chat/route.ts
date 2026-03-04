/**
 * Chat API - Streaming chat with AI bots
 *
 * Phase 1 Enhanced: Error handling, validation, rate limiting, metrics
 * Phase 2: MCP Tool Integration
 */

import { NextRequest } from 'next/server'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { createRouteClient } from '@/lib/supabase/server'

// Phase 1 imports
import { catchErrors, AuthError, NotFoundError } from '@/lib/errors'
import { ChatRequestSchema, validateRequest } from '@/lib/schemas'
import { enforceRateLimit, chatRateLimit } from '@/lib/rate-limit'
import { logger, logError, logPerformance } from '@/lib/logger'
import { trackChatMessage, calculateXaiCost } from '@/lib/metrics'
import { xaiCircuitBreaker } from '@/lib/circuit-breaker'
import { withTimeout } from '@/lib/retry'
import { config } from '@/lib/config'
import { getXaiClient } from '@/lib/llm/xai'

// Phase 2: MCP imports
import { MCPRuntime, MCPServerConfig } from '@/lib/mcp'

const xai = getXaiClient()

// Maximum tool use iterations to prevent infinite loops
const MAX_TOOL_ITERATIONS = 10

export const POST = catchErrors(async (req: NextRequest) => {
  const startTime = Date.now()
  const encoder = new TextEncoder()

  // 1. Validate request body
  const data = await validateRequest(req, ChatRequestSchema)

  logger.info({
    type: 'chat_request',
    botId: data.botId,
    conversationId: data.conversationId,
    messageLength: data.message.length,
    historyLength: data.messages.length,
  })

  // 2. Authenticate user
  const supabase = await createRouteClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new AuthError('Authentication required for chat')
  }

  // 3. Enforce rate limiting (throws if limit exceeded)
  await enforceRateLimit(
    session.user.id,
    chatRateLimit,
    '/api/chat'
  )

  // 4. Get bot configuration with error handling
  const { data: bot, error: botError } = await supabase
    .from('bots')
    .select('*')
    .eq('id', data.botId)
    .eq('user_id', session.user.id)
    .single()

  if (botError || !bot) {
    logger.warn({
      type: 'bot_not_found',
      botId: data.botId,
      userId: session.user.id,
      error: botError?.message,
    })
    throw new NotFoundError('Bot')
  }

  // 5. Get MCP servers for this bot
  const { data: mcpServers } = await supabase
    .from('bot_mcp_servers')
    .select(`
      mcp_servers (
        id,
        name,
        type,
        config
      )
    `)
    .eq('bot_id', data.botId)

  // 6. Initialize MCP runtime if servers are configured
  let mcpRuntime: MCPRuntime | null = null
  let mcpTools: ChatCompletionTool[] = []

  if (mcpServers && mcpServers.length > 0) {
    const serverConfigs: MCPServerConfig[] = mcpServers
      .map((ms: any) => ms.mcp_servers)
      .filter(Boolean)

    if (serverConfigs.length > 0) {
      mcpRuntime = new MCPRuntime()
      try {
        await mcpRuntime.initialize(serverConfigs)
        mcpTools = mcpRuntime.getAllTools()

        logger.info({
          type: 'mcp_runtime_ready',
          serverCount: serverConfigs.length,
          toolCount: mcpTools.length,
        })
      } catch (error) {
        logger.error({
          type: 'mcp_runtime_init_error',
          error: error instanceof Error ? error.message : String(error),
        })
        // Continue without MCP tools
        mcpRuntime = null
      }
    }
  }

  // 7. Prepare messages for xAI (OpenAI-compatible)
  const chatMessages: ChatCompletionMessageParam[] = data.messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content,
  }))

  // Add current message
  chatMessages.push({
    role: 'user',
    content: data.message,
  })

  // 8. Build system prompt with MCP context
  let systemPrompt = bot.system_prompt
  if (mcpTools.length > 0) {
    systemPrompt += `\n\n## Available Tools\nYou have access to ${mcpTools.length} tools from connected MCP servers. Use them when they would help answer the user's question.`
  }

  // 9. Resolve xAI model
  const resolvedModel = bot.model && !bot.model.startsWith('claude')
    ? bot.model
    : config.xai.defaultModel

  // 10. Track token usage
  let inputTokens = 0
  let outputTokens = 0
  let fullResponse = ''

  // 11. Create streaming response with MCP tool support
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages: ChatCompletionMessageParam[] = [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
        ]
        let toolIterations = 0

        // Tool use loop - continues until the model responds without tool calls
        while (toolIterations < MAX_TOOL_ITERATIONS) {
          const response = await xaiCircuitBreaker.execute(async () => {
            return withTimeout(
              xai.chat.completions.create({
                model: resolvedModel,
                max_tokens: bot.max_tokens || config.xai.maxTokens,
                temperature: bot.temperature ?? config.xai.temperature,
                messages: currentMessages,
                tools: mcpTools.length > 0 ? mcpTools : undefined,
                tool_choice: mcpTools.length > 0 ? 'auto' : undefined,
              }),
              60000,
              'xAI API request timeout'
            )
          })

          inputTokens += response.usage?.prompt_tokens ?? 0
          outputTokens += response.usage?.completion_tokens ?? 0

          const assistantMessage = response.choices[0]?.message
          const toolCalls = assistantMessage?.tool_calls

          if (toolCalls && toolCalls.length > 0 && mcpRuntime) {
            const toolResults: ChatCompletionToolMessageParam[] = []

            for (const toolCall of toolCalls as ChatCompletionMessageToolCall[]) {
              // Type guard for function tool calls
              if (!('function' in toolCall) || !toolCall.function) continue
              const toolName = toolCall.function.name
              if (!toolName) continue

              // Notify client that tool is being used
              const toolNotice = JSON.stringify({
                type: 'tool_use',
                tool: toolName,
              })
              controller.enqueue(encoder.encode(`data: ${toolNotice}\n\n`))

              let toolInput: Record<string, unknown> = {}
              try {
                toolInput = toolCall.function.arguments
                  ? JSON.parse(toolCall.function.arguments)
                  : {}
              } catch (error) {
                logger.warn({
                  type: 'tool_args_parse_error',
                  toolName,
                })
              }

              const result = await mcpRuntime.executeTool(toolName, toolInput)

              toolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result.success
                  ? JSON.stringify(result.result, null, 2)
                  : `Error: ${result.error}`,
              })

              // Notify client of tool result
              const resultNotice = JSON.stringify({
                type: 'tool_result',
                tool: toolName,
                success: result.success,
              })
              controller.enqueue(encoder.encode(`data: ${resultNotice}\n\n`))
            }

            // Add assistant message with tool calls
            currentMessages.push({
              role: 'assistant',
              content: assistantMessage?.content ?? '',
              tool_calls: toolCalls,
            })

            // Add tool results
            currentMessages.push(...toolResults)

            toolIterations++
            continue
          }

          // No tool calls - send response to client (chunked)
          const finalText = assistantMessage?.content ?? ''
          fullResponse += finalText

          const chunkSize = 64
          for (let i = 0; i < finalText.length; i += chunkSize) {
            const chunk = finalText.slice(i, i + chunkSize)
            const payload = JSON.stringify({ content: chunk })
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          }

          break
        }

        if (toolIterations >= MAX_TOOL_ITERATIONS) {
          logger.warn({
            type: 'max_tool_iterations',
            botId: data.botId,
            iterations: toolIterations,
          })
        }

        // Stream complete
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()

        // 11. Track metrics and costs
        const duration = Date.now() - startTime
        const cost = calculateXaiCost(resolvedModel, inputTokens, outputTokens)

        await trackChatMessage({
          userId: session.user.id,
          botId: data.botId,
          conversationId: data.conversationId,
          model: resolvedModel,
          inputTokens,
          outputTokens,
          duration,
          cost,
        })

        logPerformance('chat_request', duration, {
          botId: data.botId,
          inputTokens,
          outputTokens,
          cost: cost.toFixed(4),
          toolIterations,
        })

        // Cleanup MCP runtime
        if (mcpRuntime) {
          await mcpRuntime.shutdown()
        }
      } catch (error) {
        // Enhanced error handling in stream
        const err = error as Error

        logError(err, {
          type: 'stream_error',
          botId: data.botId,
          userId: session.user.id,
          conversationId: data.conversationId,
        })

        // Cleanup MCP runtime on error
        if (mcpRuntime) {
          await mcpRuntime.shutdown()
        }

        // Send error to client
        const errorPayload = JSON.stringify({
          error: err.message || 'An error occurred during streaming',
        })
        controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`))
        controller.close()

        // Re-throw to be caught by outer handler
        throw error
      }
    },
  })

  // 12. Create streaming response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})
