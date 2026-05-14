import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '../../types'
import Icon from './Icon'
import { PopoverSurface } from './designSystem'

interface Props {
  session: Session
  x: number
  y: number
  onClose: () => void
  onRemove?: (session: Session) => void | Promise<void>
}

export default function SessionActionsMenu({
  session,
  x,
  y,
  onClose,
  onRemove
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const rename = async (): Promise<void> => {
    const nextName = window.prompt('Rename chat', session.name)?.trim()
    if (!nextName || nextName === session.name) {
      onClose()
      return
    }
    await window.api.sessions.updateName(session.id, nextName)
    onClose()
  }

  const togglePinned = async (): Promise<void> => {
    await window.api.sessions.updatePinned(session.id, !session.pinned)
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (!onRemove) return
    if (!window.confirm(`Delete "${session.name}"?`)) return
    await onRemove(session)
    onClose()
  }

  const menu = (
    <PopoverSurface
      className="fixed p-[5px]"
      ref={ref}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 208)),
        top: Math.max(8, Math.min(y, window.innerHeight - 146)),
        width: 196,
        zIndex: 10000,
      }}
    >
      <MenuItem icon="pencil" label="Rename" onClick={() => void rename()} />
      <MenuItem
        icon="pin"
        label={session.pinned ? 'Unpin chat' : 'Pin chat'}
        onClick={() => void togglePinned()}
      />
      {onRemove && (
        <>
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '5px 3px' }} />
          <MenuItem icon="close" label="Delete chat" tone="danger" onClick={() => void remove()} />
        </>
      )}
    </PopoverSurface>
  )

  return createPortal(menu, document.body)
}

function MenuItem({
  icon,
  label,
  tone,
  onClick
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  tone?: 'danger'
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="motion-button flex w-full items-center gap-2 text-left"
      style={{
        height: 30,
        padding: '0 8px',
        borderRadius: 'var(--radius-md)',
        color: tone === 'danger' ? 'var(--state-danger)' : 'var(--text-primary)',
        fontSize: 12.5,
        fontWeight: 560,
        background: 'transparent',
        border: '1px solid transparent',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = 'var(--control-bg-hover)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  )
}
