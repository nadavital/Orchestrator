import type { RunEvent } from '../types'

export interface CoalescedRunEvents {
  events: RunEvent[]
  coalescedDeltas: number
}

export function coalesceRunEvents(events: RunEvent[]): CoalescedRunEvents {
  if (events.length <= 1) return { events, coalescedDeltas: 0 }

  const coalesced: RunEvent[] = []
  let pendingDelta: Extract<RunEvent, { type: 'assistant.text.delta' }> | null = null
  let coalescedDeltas = 0

  const flushPendingDelta = (): void => {
    if (!pendingDelta) return
    coalesced.push(pendingDelta)
    pendingDelta = null
  }

  for (const event of events) {
    if (event.type !== 'assistant.text.delta') {
      flushPendingDelta()
      coalesced.push(event)
      continue
    }

    if (!pendingDelta || pendingDelta.streamId !== event.streamId) {
      flushPendingDelta()
      pendingDelta = event
      continue
    }

    coalescedDeltas += 1
    pendingDelta = event.replace
      ? event
      : {
          ...pendingDelta,
          content: `${pendingDelta.content}${event.content}`
        }
  }

  flushPendingDelta()
  return coalescedDeltas > 0 ? { events: coalesced, coalescedDeltas } : { events, coalescedDeltas: 0 }
}
