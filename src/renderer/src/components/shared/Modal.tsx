import { IconButton, MotionOverlay } from './designSystem'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function Modal({ title, onClose, children }: Props): JSX.Element {
  return (
    <MotionOverlay
      onClose={onClose}
      surfaceClassName="w-full max-w-md mx-4 overflow-hidden"
      surfaceStyle={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-dialog)'
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
          {title}
        </span>
        <IconButton icon="close" label="Close" onClick={onClose} size="sm" />
      </div>
      <div className="px-5 py-5">{children}</div>
    </MotionOverlay>
  )
}
