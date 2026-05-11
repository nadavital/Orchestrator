import { deriveAgentNodes, deriveAgentNodesFromMessages } from '../../types'
import type { AgentNode, Session, SessionRunEventRecord } from '../../types'

export function deriveSessionAgentNodes(session: Session, events: SessionRunEventRecord[]): AgentNode[] {
  const fromMessages = deriveAgentNodesFromMessages(session, session.messages)
  const byId = new Map(fromMessages.map((agent) => [agent.id, agent]))

  for (const agent of deriveAgentNodes(session, events)) {
    const previous = byId.get(agent.id)
    byId.set(agent.id, {
      ...previous,
      ...agent,
      transcript: agent.transcript ?? previous?.transcript,
      summary: agent.summary ?? previous?.summary
    })
  }

  return [...byId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}
