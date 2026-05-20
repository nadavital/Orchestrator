import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
    const focusInput = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.setTimeout(focusInput, 0)
    window.requestAnimationFrame(focusInput)
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
        className="flex min-w-0 flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Rename chat</div>
        </div>
        <div className="min-w-0">
          <label className="sr-only" htmlFor="rename-chat-input">Chat name</label>
          <input
            id="rename-chat-input"
            ref={inputRef}
            value={value}
            autoFocus
            onPointerDown={() => {
              inputRef.current?.focus({ preventScroll: true })
            }}
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
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!canSubmit}>
            {saving ? 'Renaming...' : 'Rename'}
          </Button>
        </div>
      </form>
    </MotionOverlay>
  )

  return createPortal(dialog, document.body)
}
