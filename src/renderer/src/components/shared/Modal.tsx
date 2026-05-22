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
      surfaceClassName="orchestrator-dialog-surface orchestrator-dialog-surface-wide"
    >
      <div className="orchestrator-dialog-header">
        <span className="orchestrator-dialog-title">
          {title}
        </span>
        <IconButton icon="close" label="Close" onClick={onClose} size="sm" />
      </div>
      <div className="orchestrator-dialog-body">{children}</div>
    </MotionOverlay>
  )
}
