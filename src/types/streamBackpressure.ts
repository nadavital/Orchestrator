export interface BufferedStreamingUpsert<TMessage> {
  sessionId: string
  message: TMessage
}

export interface InactiveSessionFlush<TMessage, TEvent> {
  streamingUpserts: BufferedStreamingUpsert<TMessage>[]
  events: TEvent[]
}

export class InactiveSessionStreamBuffer<TMessage, TEvent> {
  private readonly streamingUpserts = new Map<string, BufferedStreamingUpsert<TMessage>>()
  private readonly eventBuffers = new Map<string, TEvent[]>()

  constructor(private readonly maxEventsPerSession = 500) {}

  bufferStreamingUpsert(sessionId: string, messageId: string, message: TMessage): void {
    this.streamingUpserts.set(streamingBufferKey(sessionId, messageId), { sessionId, message })
  }

  deleteStreamingUpsert(sessionId: string, messageId: string): void {
    this.streamingUpserts.delete(streamingBufferKey(sessionId, messageId))
  }

  bufferEvents(sessionId: string, events: TEvent[]): void {
    if (events.length === 0) return
    const current = this.eventBuffers.get(sessionId) ?? []
    this.eventBuffers.set(sessionId, [...current, ...events].slice(-this.maxEventsPerSession))
  }

  flush(sessionId: string | null): InactiveSessionFlush<TMessage, TEvent> {
    if (!sessionId) return { streamingUpserts: [], events: [] }
    const streamingUpserts: BufferedStreamingUpsert<TMessage>[] = []
    for (const [key, item] of this.streamingUpserts.entries()) {
      if (item.sessionId !== sessionId) continue
      streamingUpserts.push(item)
      this.streamingUpserts.delete(key)
    }

    const events = this.eventBuffers.get(sessionId) ?? []
    this.eventBuffers.delete(sessionId)
    return { streamingUpserts, events }
  }

  clear(): void {
    this.streamingUpserts.clear()
    this.eventBuffers.clear()
  }

  streamingUpsertCount(sessionId?: string): number {
    if (!sessionId) return this.streamingUpserts.size
    return [...this.streamingUpserts.values()].filter((item) => item.sessionId === sessionId).length
  }

  eventCount(sessionId?: string): number {
    if (sessionId) return this.eventBuffers.get(sessionId)?.length ?? 0
    return [...this.eventBuffers.values()].reduce((sum, events) => sum + events.length, 0)
  }
}

export function streamingBufferKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}
