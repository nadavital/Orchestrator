import { createRoot } from 'react-dom/client'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import PetOverlay from './PetOverlay'

class PetOverlayErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[pet] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <pre data-testid="pet-overlay-render-error" style={{ color: 'white', fontSize: 10, whiteSpace: 'pre-wrap' }}>
          {this.state.error.message}
        </pre>
      )
    }
    return this.props.children
  }
}

const root = document.getElementById('root')!
createRoot(root).render(
  <PetOverlayErrorBoundary>
    <PetOverlay />
  </PetOverlayErrorBoundary>
)
