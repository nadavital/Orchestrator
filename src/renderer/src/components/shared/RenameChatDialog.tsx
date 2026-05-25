import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, DialogContent, DialogFooter, DialogHeader, MotionOverlay } from './designSystem'

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
      surfaceClassName="orchestrator-dialog-surface orchestrator-dialog-surface-wide"
      backdropStyle={{
        background: 'rgba(12, 18, 28, 0.08)',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none'
      }}
    >
      <DialogContent
        as="form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <DialogHeader title="Rename chat" />
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
            className="orchestrator-dialog-input"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!canSubmit}>
            {saving ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </MotionOverlay>
  )

  return createPortal(dialog, document.body)
}
