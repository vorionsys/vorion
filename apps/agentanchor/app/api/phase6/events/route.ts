/**
 * Phase 6 Real-time Events API (SSE)
 *
 * Server-Sent Events endpoint for real-time trust event streaming.
 * Streams ceiling events, role gate evaluations, gaming alerts, etc.
 */

import { NextRequest } from 'next/server'
import {
  emitPhase6Event,
  getEventBuffer,
  getEventsAfter,
  getBufferSize,
  type Phase6Event,
} from '@/lib/phase6/events'

/**
 * GET /api/phase6/events
 * SSE endpoint for real-time event streaming
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const filterType = searchParams.get('type')
  const filterAgentId = searchParams.get('agentId')
  const lastEventId = searchParams.get('lastEventId')

  // Create readable stream for SSE
  const encoder = new TextEncoder()
  let isConnected = true
  const eventBuffer = getEventBuffer()

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      const connectEvent = `event: connected\ndata: ${JSON.stringify({
        message: 'Connected to Phase 6 event stream',
        filters: { type: filterType, agentId: filterAgentId },
        timestamp: new Date().toISOString(),
      })}\n\n`
      controller.enqueue(encoder.encode(connectEvent))

      // Send any buffered events after lastEventId
      if (lastEventId) {
        const missedEvents = getEventsAfter(lastEventId)
        for (const event of missedEvents) {
          if (shouldSendEvent(event, filterType, filterAgentId)) {
            const sseEvent = formatSSEEvent(event)
            controller.enqueue(encoder.encode(sseEvent))
          }
        }
      }

      // Start heartbeat
      const heartbeatInterval = setInterval(() => {
        if (!isConnected) {
          clearInterval(heartbeatInterval)
          return
        }

        const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({
          timestamp: new Date().toISOString(),
          bufferSize: getBufferSize(),
        })}\n\n`
        controller.enqueue(encoder.encode(heartbeat))
      }, 30000) // Every 30 seconds

      // Poll for new events (would use pub/sub in production)
      let lastProcessedIndex = eventBuffer.length - 1
      const pollInterval = setInterval(() => {
        if (!isConnected) {
          clearInterval(pollInterval)
          return
        }

        const currentBuffer = getEventBuffer()
        // Check for new events
        if (currentBuffer.length > lastProcessedIndex + 1) {
          const newEvents = currentBuffer.slice(lastProcessedIndex + 1)
          for (const event of newEvents) {
            if (shouldSendEvent(event, filterType, filterAgentId)) {
              const sseEvent = formatSSEEvent(event)
              controller.enqueue(encoder.encode(sseEvent))
            }
          }
          lastProcessedIndex = currentBuffer.length - 1
        }
      }, 1000) // Poll every second

      // Handle disconnect
      request.signal.addEventListener('abort', () => {
        isConnected = false
        clearInterval(heartbeatInterval)
        clearInterval(pollInterval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

function shouldSendEvent(
  event: Phase6Event,
  filterType: string | null,
  filterAgentId: string | null
): boolean {
  if (filterType && event.type !== filterType) {
    return false
  }

  if (filterAgentId && event.data.agentId !== filterAgentId) {
    return false
  }

  return true
}

function formatSSEEvent(event: Phase6Event): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * POST /api/phase6/events
 * Publish an event (internal use)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, data } = body

    if (!type || !data) {
      return Response.json(
        { error: 'Missing type or data' },
        { status: 400 }
      )
    }

    emitPhase6Event(type, data)

    return Response.json({
      success: true,
      eventCount: getBufferSize(),
    })
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
