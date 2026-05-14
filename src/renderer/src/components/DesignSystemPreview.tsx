import { useState } from 'react'
import {
  Badge,
  Button,
  DisclosureSection,
  IconButton,
  PopoverSurface,
  ScrollEdgeButton,
  StatusBadge,
  SurfaceRow,
} from './shared/designSystem'
import { motionPresets, useReducedMotionPreference } from '../design/motion'

const rows = [
  { title: 'Running Codex session', body: 'Tool call in progress', tone: 'success' as const },
  { title: 'Waiting for approval', body: 'Permission requested for shell command', tone: 'warning' as const },
  { title: 'Review ready', body: 'Assistant finished with changes to inspect', tone: 'accent' as const },
]

export default function DesignSystemPreview(): JSX.Element {
  const [trayOpen, setTrayOpen] = useState(true)
  const reducedMotion = useReducedMotionPreference()

  return (
    <main
      data-testid="design-system-preview"
      className="flex h-full min-h-0 flex-1 flex-col overflow-auto"
      style={{ background: 'var(--canvas-bg)', color: 'var(--text-primary)' }}
    >
      <header
        className="flex items-center justify-between gap-4 px-8 py-6"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        <div>
          <h1 className="text-xl font-semibold">Design System Preview</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Motion tokens, rows, badges, overlays, and disclosure primitives.
          </p>
        </div>
        <StatusBadge label={reducedMotion ? 'Reduced motion' : 'Motion enabled'} tone={reducedMotion ? 'warning' : 'success'} />
      </header>

      <section className="grid flex-1 gap-6 p-8" style={{ gridTemplateColumns: 'minmax(260px, 380px) minmax(360px, 1fr)' }}>
        <div className="space-y-4">
          <PreviewPanel title="Controls">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary">Primary</Button>
              <Button>Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <IconButton icon="settings" label="Settings" />
              <IconButton icon="close" label="Close" tone="danger" />
            </div>
          </PreviewPanel>

          <PreviewPanel title="Badges">
            <div className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="accent" interactive>3 updates</Badge>
              <StatusBadge label="Running" tone="success" pulse />
              <StatusBadge label="Waiting" tone="warning" />
              <StatusBadge label="Failed" tone="danger" />
            </div>
          </PreviewPanel>

          <PreviewPanel title="Motion Spec">
            <pre className="overflow-auto rounded-lg p-3 text-[11px]" style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}>
              {JSON.stringify(motionPresets, null, 2)}
            </pre>
          </PreviewPanel>
        </div>

        <div className="space-y-4">
          <PreviewPanel title="Rows">
            <div className="space-y-1">
              {rows.map((row, index) => (
                <SurfaceRow
                  key={row.title}
                  index={index}
                  active={index === 1}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2"
                >
                  <StatusBadge label={row.tone} tone={row.tone} pulse={index === 0} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{row.title}</div>
                    <div className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{row.body}</div>
                  </div>
                  <span className="surface-row-secondary">
                    <IconButton icon="ellipsis" label="Actions" size="sm" tooltip={false} />
                  </span>
                </SurfaceRow>
              ))}
            </div>
          </PreviewPanel>

          <PreviewPanel title="Disclosure">
            <DisclosureSection
              defaultOpen
              title="Permission request details"
              meta={<Badge tone="warning">waiting</Badge>}
              bodyClassName="pl-5 pt-2"
            >
              <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}>
                Secondary details animate in using the shared row preset and collapse cleanly in reduced motion.
              </div>
            </DisclosureSection>
          </PreviewPanel>

          <PreviewPanel title="Notification Tray">
            <div className="relative h-56 overflow-hidden p-4" style={{ background: 'var(--control-bg)', borderRadius: 8 }}>
              <Button variant="primary" onClick={() => setTrayOpen(!trayOpen)}>
                {trayOpen ? 'Collapse activity' : 'Open activity'}
              </Button>
              {trayOpen && (
                <PopoverSurface
                  className="absolute bottom-4 right-4 w-[276px] p-1.5"
                  style={{ transformOrigin: 'bottom right' }}
                >
                  <ScrollEdgeButton ariaLabel="Show latest activity" className="mx-auto mb-1" onClick={() => undefined}>
                    Latest
                  </ScrollEdgeButton>
                  <div className="space-y-1">
                    {rows.map((row, index) => (
                      <SurfaceRow key={row.title} index={index} className="rounded-[18px] px-3 py-2">
                        <div className="flex items-start gap-2">
                          <Badge tone={row.tone}>{index + 1}</Badge>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold">{row.title}</div>
                            <div className="line-clamp-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{row.body}</div>
                          </div>
                        </div>
                      </SurfaceRow>
                    ))}
                  </div>
                  <ScrollEdgeButton ariaLabel="Show older activity" className="mx-auto mt-1" onClick={() => undefined}>
                    +2
                  </ScrollEdgeButton>
                </PopoverSurface>
              )}
            </div>
          </PreviewPanel>
        </div>
      </section>
    </main>
  )
}

function PreviewPanel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section
      className="motion-row p-4"
      style={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 8,
      }}
    >
      <h2 className="mb-3 text-xs font-bold uppercase tracking-normal" style={{ color: 'var(--text-secondary)' }}>{title}</h2>
      {children}
    </section>
  )
}
