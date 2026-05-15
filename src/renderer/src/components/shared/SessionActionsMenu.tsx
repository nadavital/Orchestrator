import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '../../types'
import { ConfirmDialog, MenuItem, MenuSurface, TextInputDialog } from './designSystem'

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
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const rename = async (nextName: string): Promise<void> => {
    if (nextName === session.name) {
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
    await onRemove(session)
    onClose()
  }

  const menu = (
    <>
    {!renaming && !confirmingDelete && (
      <MenuSurface
        className="fixed p-[5px]"
        onClose={onClose}
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 208)),
          top: Math.max(8, Math.min(y, window.innerHeight - 146)),
          width: 196,
          zIndex: 10000,
        }}
      >
        <MenuItem icon="pencil" label="Rename" onClick={() => setRenaming(true)} />
        <MenuItem
          icon="pin"
          label={session.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={() => void togglePinned()}
        />
        {onRemove && (
          <>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '5px 3px' }} />
            <MenuItem icon="close" label="Delete chat" tone="danger" onClick={() => setConfirmingDelete(true)} />
          </>
        )}
      </MenuSurface>
    )}
    {renaming && (
      <TextInputDialog
        title="Rename chat"
        initialValue={session.name}
        confirmLabel="Rename"
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => void rename(value)}
      />
    )}
    {confirmingDelete && (
      <ConfirmDialog
        title={`Delete "${session.name}"?`}
        description="This removes the chat from Orchestrator."
        confirmLabel="Delete"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void remove()}
      />
    )}
    </>
  )

  return createPortal(menu, document.body)
}
