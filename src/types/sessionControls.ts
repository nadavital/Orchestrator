import type { SessionStatus } from './index'

export interface ComposerSendState {
  canSend: boolean
  willQueue: boolean
}

export function canStopSession(status: SessionStatus): boolean {
  return status === 'running' || status === 'waiting_for_permission' || status === 'waiting_for_user'
}

export function getComposerSendState({
  text,
  status,
  canUsePermission
}: {
  text: string
  status: SessionStatus
  canUsePermission: boolean
}): ComposerSendState {
  const hasText = text.trim().length > 0
  const canSend = hasText && canUsePermission
  return {
    canSend,
    willQueue: canSend && status === 'running'
  }
}
