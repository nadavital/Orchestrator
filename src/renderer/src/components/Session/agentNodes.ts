import { deriveAgentThreadGraph } from '../../types'
import type { AgentNode, AgentThread, AgentThreadGraph, Session, SessionRunEventRecord } from '../../types'

export function deriveSessionAgentNodes(session: Session, events: SessionRunEventRecord[]): AgentNode[] {
  return deriveSessionAgentThreads(session, events).map((thread) => thread.agent)
}

export function deriveSessionAgentThreads(session: Session, events: SessionRunEventRecord[]): AgentThread[] {
  return deriveSessionAgentThreadGraph(session, events).threads
}

export function deriveSessionAgentThreadGraph(session: Session, events: SessionRunEventRecord[]): AgentThreadGraph {
  return deriveAgentThreadGraph(session, events)
}
