import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { Button, MotionOverlay } from './designSystem'

interface Props {
  initialValue: string
  onCancel: () => void
  onConfirm: (value: string) => void | Promise<void>
}

export default function RenameChatDialog({ initialValue, onCancel, onConfirm }: Props): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = useMemo(() => value.trim(), [value])
  const canSubmit = trimmed.length > 0 && !saving

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    if (trimmed === initialValue.trim()) {
      onCancel()
      return
    }
    setSaving(true)
    try {
      await onConfirm(trimmed)
    } catch (error) {
      setSaving(false)
      console.error('Failed to rename chat', error)
    }
  }

  const dialog = (
    <MotionOverlay
      onClose={onCancel}
      className="items-start pt-[12vh]"
      surfaceClassName="w-[min(440px,calc(100vw-28px))] overflow-hidden rounded-xl"
      surfaceStyle={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-popover)'
      }}
      backdropStyle={{
        background: 'rgba(12, 18, 28, 0.08)',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none'
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}>
            <Icon name="pencil" size={14} />
          </span>
          <div className="min-w-0 flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Rename chat
          </div>
        </div>
        <div className="px-3 py-2">
          <label className="sr-only" htmlFor="rename-chat-input">Chat name</label>
          <input
            id="rename-chat-input"
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="Chat name"
            data-testid="rename-chat-input"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--control-bg)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          />
        </div>
        <div
          className="flex items-center justify-end gap-3 border-t px-3 py-2"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Button variant="primary" type="submit" disabled={!canSubmit}>
            {saving ? 'Renaming...' : 'Rename'}
          </Button>
        </div>
      </form>
    </MotionOverlay>
  )

  return createPortal(dialog, document.body)
}
