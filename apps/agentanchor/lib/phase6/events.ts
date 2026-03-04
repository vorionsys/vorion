/**
 * Phase 6 Event Buffer Service
 *
 * Manages the in-memory event buffer for real-time Phase 6 event streaming.
 * Would use Redis/Kafka in production.
 */

// Event types
export type Phase6EventType =
  | 'ceiling'
  | 'role_gate'
  | 'gaming_alert'
  | 'provenance'
  | 'context_change'
  | 'heartbeat'

export interface Phase6Event {
  id: string
  type: Phase6EventType
  data: Record<string, unknown>
  timestamp: string
}

// In-memory event buffer (would use Redis/Kafka in production)
const eventBuffer: Phase6Event[] = []
const MAX_BUFFER_SIZE = 1000

/**
 * Add event to buffer (called by other services)
 */
export function emitPhase6Event(
  type: Phase6EventType,
  data: Record<string, unknown>
): void {
  const event: Phase6Event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    data,
    timestamp: new Date().toISOString(),
  }

  eventBuffer.push(event)

  // Trim buffer if too large
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE)
  }
}

/**
 * Get the event buffer
 */
export function getEventBuffer(): Phase6Event[] {
  return eventBuffer
}

/**
 * Get buffer size
 */
export function getBufferSize(): number {
  return eventBuffer.length
}

/**
 * Find events after a specific event ID
 */
export function getEventsAfter(lastEventId: string): Phase6Event[] {
  const lastIdx = eventBuffer.findIndex(e => e.id === lastEventId)
  if (lastIdx >= 0) {
    return eventBuffer.slice(lastIdx + 1)
  }
  return []
}
