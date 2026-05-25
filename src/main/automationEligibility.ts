import type { Automation, AutomationEligibilityResult, Session } from '../types'

export function automationEligibilityForSession(
  automation: Automation,
  getSession: (sessionId: string) => Pick<Session, 'status'> | undefined
): AutomationEligibilityResult {
  if (automation.status !== 'ACTIVE') return { isEligible: false, reason: 'not_active' }
  const session = getSession(automation.target.sessionId)
  if (!session) return { isEligible: false, reason: 'missing_session' }
  if (session.status === 'running') return { isEligible: false, reason: 'turn_in_progress' }
  if (session.status === 'reconnecting') return { isEligible: false, reason: 'pending_request' }
  if (session.status === 'waiting_for_user') return { isEligible: false, reason: 'waiting_on_user_input' }
  if (session.status === 'waiting_for_permission') return { isEligible: false, reason: 'waiting_on_approval' }
  return { isEligible: true }
}
