import { useState, type CSSProperties } from 'react'
import { IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface } from '../shared/designSystem'
import Icon from '../shared/Icon'

const ARTIFACT_ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200] as const

export type ArtifactZoomKind = 'document' | 'pdf' | 'spreadsheet' | 'slides'

export default function ArtifactZoomControls({
  fitToWidth,
  kind,
  maxZoom = 200,
  minZoom = 50,
  onFitToWidthChange,
  onZoomPercentChange,
  testId,
  zoomPercent
}: {
  fitToWidth: boolean
  kind: ArtifactZoomKind
  maxZoom?: number
  minZoom?: number
  onFitToWidthChange: (fit: boolean) => void
  onZoomPercentChange: (zoom: number) => void
  testId: string
  zoomPercent: number
}): JSX.Element {
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const closeMenu = (): void => setMenuStyle(null)
  const selectZoom = (zoom: number): void => {
    onFitToWidthChange(false)
    onZoomPercentChange(zoom)
    closeMenu()
  }
  const selectFit = (): void => {
    onFitToWidthChange(true)
    closeMenu()
  }
  const zoomOut = (): void => {
    onFitToWidthChange(false)
    onZoomPercentChange(Math.max(minZoom, zoomPercent - 25))
  }
  const zoomIn = (): void => {
    onFitToWidthChange(false)
    onZoomPercentChange(Math.min(maxZoom, zoomPercent + 25))
  }
  const kindDataAttributes = kind === 'document'
    ? {
        'data-document-zoom-percent': zoomPercent,
        'data-document-zoom-fit': fitToWidth ? 'true' : 'false'
      }
    : kind === 'pdf'
      ? {
          'data-pdf-zoom-percent': zoomPercent,
          'data-pdf-zoom-fit': fitToWidth ? 'true' : 'false'
        }
      : kind === 'spreadsheet'
        ? {
            'data-spreadsheet-zoom-percent': zoomPercent,
            'data-spreadsheet-zoom-fit': fitToWidth ? 'true' : 'false',
            'data-office-zoom-menu': 'true'
          }
        : {
            'data-slides-zoom-percent': zoomPercent,
            'data-slides-zoom-fit': fitToWidth ? 'true' : 'false',
            'data-office-zoom-menu': 'true'
          }
  return (
    <span
      className="file-preview-zoom-controls"
      data-testid={`${testId}-zoom-controls`}
      data-artifact-zoom-menu="true"
      data-artifact-zoom-percent={zoomPercent}
      data-artifact-zoom-fit={fitToWidth ? 'true' : 'false'}
      {...kindDataAttributes}
    >
      <IconButton
        icon="zoomOut"
        label="Zoom out"
        size="sm"
        variant="toolbar"
        disabled={zoomPercent <= minZoom}
        dataTestId={`${testId}-zoom-out`}
        onClick={zoomOut}
      />
      <button
        type="button"
        className="file-preview-zoom-menu-trigger"
        data-testid={`${testId}-zoom-indicator`}
        data-artifact-zoom-trigger="true"
        aria-haspopup="menu"
        aria-expanded={menuStyle ? 'true' : 'false'}
        aria-label="Zoom options"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenuStyle({
            position: 'fixed',
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
            top: Math.min(rect.bottom + 6, window.innerHeight - 260),
            width: 160,
            zIndex: 110
          })
        }}
      >
        <span>{fitToWidth ? 'Fit' : `${zoomPercent}%`}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      <IconButton
        icon="zoomIn"
        label="Zoom in"
        size="sm"
        variant="toolbar"
        disabled={zoomPercent >= maxZoom}
        dataTestId={`${testId}-zoom-in`}
        onClick={zoomIn}
      />
      {menuStyle && (
        <MenuSurface
          data-testid={`${testId}-zoom-menu`}
          onClose={closeMenu}
          style={menuStyle}
        >
          <MenuSection dataTestId={`${testId}-zoom-menu-section`}>
            <MenuSectionLabel>Zoom</MenuSectionLabel>
            {ARTIFACT_ZOOM_OPTIONS.map((option) => (
              <MenuItem
                key={option}
                icon={!fitToWidth && zoomPercent === option ? 'check' : undefined}
                label={`${option}%`}
                dataTestId={`${testId}-zoom-option-${option}`}
                onClick={() => selectZoom(option)}
              />
            ))}
            <MenuItem
              icon={fitToWidth ? 'check' : undefined}
              label="Zoom to fit"
              dataTestId={`${testId}-zoom-fit`}
              onClick={selectFit}
            />
          </MenuSection>
        </MenuSurface>
      )}
    </span>
  )
}
