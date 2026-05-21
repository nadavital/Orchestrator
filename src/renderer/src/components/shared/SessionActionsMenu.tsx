import { useState } from 'react'
import { createPortal } from 'react-dom'
import RenameChatDialog from './RenameChatDialog'
import { ConfirmDialog, MenuItem, MenuSurface } from './designSystem'

interface SessionActionsMenuSession {
  id: string
  projectId: string
  name: string
  pinned?: boolean
  workDir: string
  repoRoot?: string
  providerSessionId?: string | null
}

interface Props {
  session: SessionActionsMenuSession
  x: number
  y: number
  onClose: () => void
  onRemove?: (session: SessionActionsMenuSession) => void | Promise<void>
  projectRoot?: string
  branch?: string | null
}

export default function SessionActionsMenu({
  session,
  x,
  y,
  onClose,
  onRemove,
  projectRoot,
  branch
}: Props): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const rename = async (nextName: string): Promise<void> => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === session.name) {
      onClose()
      return
    }
    await window.api.sessions.updateName(session.id, trimmed)
    onClose()
  }

  const togglePinned = async (): Promise<void> => {
    await window.api.sessions.updatePinned(session.id, !session.pinned)
    onClose()
  }

  const copyToClipboard = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (!onRemove) return
    await onRemove(session)
    onClose()
  }

  const menu = (
    <>
    {!renaming && !confirmingArchive && (
      <MenuSurface
        className="fixed p-[5px]"
        onClose={onClose}
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 208)),
          top: Math.max(8, Math.min(y, window.innerHeight - 292)),
          width: 216,
          zIndex: 10000,
        }}
      >
        <MenuItem icon="pencil" label="Rename" onClick={() => setRenaming(true)} />
        <MenuItem
          icon="pin"
          label={session.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={() => void togglePinned()}
        />
        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '5px 3px' }} />
        <MenuItem icon="copy" label="Copy folder path" onClick={() => void copyToClipboard(session.workDir)} />
        {projectRoot && projectRoot !== session.workDir && (
          <MenuItem icon="copy" label="Copy project path" onClick={() => void copyToClipboard(projectRoot)} />
        )}
        {session.repoRoot && session.repoRoot !== session.workDir && session.repoRoot !== projectRoot && (
          <MenuItem icon="copy" label="Copy repo root" onClick={() => void copyToClipboard(session.repoRoot!)} />
        )}
        <MenuItem icon="copy" label="Copy session ID" onClick={() => void copyToClipboard(session.id)} />
        <MenuItem
          icon="copy"
          label="Copy provider session ID"
          disabled={!session.providerSessionId}
          onClick={() => void copyToClipboard(session.providerSessionId ?? '')}
        />
        {branch && <MenuItem icon="copy" label="Copy branch name" onClick={() => void copyToClipboard(branch)} />}
        {onRemove && (
          <>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '5px 3px' }} />
            <MenuItem icon="archive" label="Archive chat" onClick={() => setConfirmingArchive(true)} />
          </>
        )}
      </MenuSurface>
    )}
    {renaming && (
      <RenameChatDialog
        initialValue={session.name}
        onCancel={onClose}
        onConfirm={(value) => void rename(value)}
      />
    )}
    {confirmingArchive && (
      <ConfirmDialog
        title={`Archive "${session.name}"?`}
        description="This removes the chat from the active sidebar while keeping its record in Orchestrator."
        confirmLabel="Archive"
        tone="accent"
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={() => void remove()}
      />
    )}
    </>
  )

  return createPortal(menu, document.body)
}
