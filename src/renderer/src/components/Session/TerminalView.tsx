import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ILink, ILinkProvider, ITheme } from '@xterm/xterm'
import type { ReactNode } from 'react'
import { createTerminalThemeFromTokens, serializeTerminalThemeMatrix, type TerminalThemeTokenMap } from '../../../../types/terminalAppearance'

interface Props {
  terminalId: string
  workDir: string
  onNewTab?: () => void
  onOpenUrl?: (url: string) => void
}

interface TerminalAppearance {
  fontFamily: string
  fontSize: number
  theme: ITheme & TerminalThemeTokenMap
}

const DEFAULT_TERMINAL_FONT_STACK = "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
const CODEX_TERMINAL_LINE_HEIGHT = 1.2
const CODEX_TERMINAL_CONTENT_PADDING = '0 16px 12px'

export default function TerminalView(props: Props): JSX.Element {
  return (
    <TerminalErrorBoundary resetKey={props.terminalId}>
      <TerminalSurface {...props} />
    </TerminalErrorBoundary>
  )
}

function TerminalSurface({ terminalId, workDir, onNewTab, onOpenUrl }: Props): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [terminalAppearance, setTerminalAppearance] = useState<TerminalAppearance>(() => resolveTerminalAppearance(null))
  const [plainOutput, setPlainOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<{ code: number; signal: number | null } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setPlainOutput('')
    setError(null)
    setExited(null)
    const appearance = resolveTerminalAppearance(surfaceRef.current)
    setTerminalAppearance(appearance)
    const term = new Terminal({
      theme: appearance.theme,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      lineHeight: CODEX_TERMINAL_LINE_HEIGHT,
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    fitRef.current = fitAddon
    term.loadAddon(fitAddon)
    if (onOpenUrl) term.registerLinkProvider(createTerminalUrlLinkProvider(term, onOpenUrl))
    termRef.current = term
    const safeFit = (): boolean => {
      const container = containerRef.current
      if (!container || !document.contains(container)) return false
      const rect = container.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return false
      try {
        fitAddon.fit()
        return true
      } catch (error) {
        console.warn('Terminal fit skipped', error)
        return false
      }
    }

    if (containerRef.current) {
      term.open(containerRef.current)
      requestAnimationFrame(() => {
        // spawn is a no-op if shell already exists for this id
        void (async () => {
          const fitOk = safeFit()
          const existingBuffer = await window.api.terminal.getBuffer(terminalId)
          await window.api.terminal.spawn(terminalId, workDir)
          if (fitOk) window.api.terminal.resize(terminalId, term.cols, term.rows)
          // Replay only pre-existing output so history appears after toggling without duplicating fresh spawn output.
          const buf = existingBuffer
          if (buf && termRef.current === term) {
            term.write(buf)
            setPlainOutput(stripTerminalOutput(buf))
            term.refresh(0, term.rows - 1)
          }
          term.focus()
        })().catch((error) => {
          console.error('Failed to initialize terminal', error)
          setError(error instanceof Error ? error.message : 'Failed to initialize terminal.')
        })
      })
    }

    const unsub = window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      setError(null)
      setExited(null)
      term.write(data)
      setPlainOutput((current) => {
        const next = current + stripTerminalOutput(data)
        return next.length > 40_000 ? next.slice(-40_000) : next
      })
    })

    const unsubExit = window.api.terminal.onExit((id, code, signal) => {
      if (id !== terminalId) return
      setExited({ code, signal })
    })

    const unsubError = window.api.terminal.onError((id, message) => {
      if (id !== terminalId) return
      setError(message || 'The terminal encountered an error.')
    })

    const observer = new ResizeObserver(() => {
      if (safeFit()) window.api.terminal.resize(terminalId, term.cols, term.rows)
    })
    if (containerRef.current) observer.observe(containerRef.current)

    term.onData((data) => {
      window.api.terminal.write(terminalId, data)
    })

    return () => {
      observer.disconnect()
      unsub()
      unsubExit()
      unsubError()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      // shell persists — call kill() explicitly via tab close or session removal
    }
  }, [onOpenUrl, terminalId, workDir, reloadKey])

  useEffect(() => {
    let disposed = false
    let raf: number | null = null
    const refreshAppearance = (): void => {
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        const appearance = resolveTerminalAppearance(surfaceRef.current)
        setTerminalAppearance(appearance)
        const term = termRef.current
        if (!term) return
        term.options.theme = appearance.theme
        void loadTerminalFont(appearance).finally(() => {
          if (disposed || termRef.current !== term) return
          term.options.fontFamily = appearance.fontFamily
          term.options.fontSize = appearance.fontSize
          const fitAddon = fitRef.current
          if (fitAddon) {
            try {
              fitAddon.fit()
              window.api.terminal.resize(terminalId, term.cols, term.rows)
            } catch (error) {
              console.warn('Terminal appearance fit skipped', error)
            }
          }
          if (term.rows > 0) term.refresh(0, term.rows - 1)
        })
      })
    }
    const observer = new MutationObserver(refreshAppearance)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-theme',
        'data-appearance-theme',
        'data-accent',
        'data-code-theme',
        'data-density',
        'data-font-smoothing'
      ]
    })
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [terminalId])

  useEffect(() => {
    if (!onOpenUrl) return undefined
    const globals = window as typeof window & {
      __orchestratorOpenTerminalUrlForSmoke?: (url: string) => void
      __orchestratorLastTerminalUrlOpened?: string
    }
    const openUrlForSmoke = (url: string): void => {
      const normalized = normalizeTerminalUrl(url)
      if (!normalized) return
      globals.__orchestratorLastTerminalUrlOpened = normalized
      onOpenUrl(normalized)
    }
    globals.__orchestratorOpenTerminalUrlForSmoke = openUrlForSmoke
    return () => {
      if (globals.__orchestratorOpenTerminalUrlForSmoke === openUrlForSmoke) {
        delete globals.__orchestratorOpenTerminalUrlForSmoke
      }
    }
  }, [onOpenUrl])

  const reloadTerminal = useCallback(() => {
    setError(null)
    setExited(null)
    setPlainOutput('')
    setReloadKey((current) => current + 1)
  }, [])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const term = termRef.current
    if (!term) return
    const key = event.key.toLowerCase()
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 't' && onNewTab) {
      event.preventDefault()
      event.stopPropagation()
      onNewTab()
      return
    }
    if (isCopyShortcut(event) && term.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined)
      return
    }
    if (isPasteShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      void navigator.clipboard?.readText().then((text) => {
        if (!text) return
        const terminalWithPaste = term as Terminal & { paste?: (value: string) => void }
        if (terminalWithPaste.paste) {
          terminalWithPaste.paste(text)
        } else {
          void window.api.terminal.write(terminalId, text.replace(/\r?\n/g, '\r'))
        }
      }).catch(() => undefined)
    }
  }, [onNewTab, terminalId])

  return (
    <div
      ref={surfaceRef}
      data-testid="terminal-view"
      data-terminal-id={terminalId}
      data-terminal-link-routing={onOpenUrl ? 'app-browser' : 'external'}
      data-terminal-appearance-sync="theme-font"
      data-terminal-font-family={terminalAppearance.fontFamily}
      data-terminal-font-size={terminalAppearance.fontSize}
      data-terminal-theme-background={String(terminalAppearance.theme.background ?? '')}
      data-terminal-theme-foreground={String(terminalAppearance.theme.foreground ?? '')}
      data-terminal-theme-token-matrix={serializeTerminalThemeMatrix(terminalAppearance.theme)}
      data-terminal-line-height={CODEX_TERMINAL_LINE_HEIGHT}
      data-terminal-content-padding={CODEX_TERMINAL_CONTENT_PADDING}
      data-terminal-surface-background="vscode-terminal-token"
      onKeyDownCapture={handleKeyDownCapture}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        background: 'var(--vscode-terminal-background, var(--surface-bg))',
        color: 'var(--vscode-terminal-foreground, var(--text-primary))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        aria-label="Terminal"
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          boxSizing: 'border-box',
          padding: CODEX_TERMINAL_CONTENT_PADDING
        }}
      />
      {error && (
        <TerminalFailureState
          title="The terminal encountered an error"
          description="Try reloading the terminal to continue."
          actionLabel="Reload"
          onAction={reloadTerminal}
        />
      )}
      {!error && exited && (
        <TerminalFailureState
          title="The terminal session ended"
          description={terminalExitDescription(exited)}
          actionLabel="Restart"
          onAction={reloadTerminal}
        />
      )}
      {!plainOutput.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 16,
            fontFamily: 'var(--font-mono-custom)',
            fontSize: 'var(--font-code-size)',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none'
          }}
        >
          Starting shell...
        </div>
      )}
      <pre
        data-testid="terminal-plain-output"
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'pre-wrap'
        }}
      >
        {plainOutput}
      </pre>
    </div>
  )
}

function resolveTerminalAppearance(surface: HTMLElement | null): TerminalAppearance {
  const rootStyle = getComputedStyle(document.documentElement)
  const fontFamily = ensureMonospaceStack(rootStyle.getPropertyValue('--font-mono-custom').trim())
  const fontSize = clampNumber(Number.parseFloat(rootStyle.getPropertyValue('--font-code-size')), 11, 18, 13)
  const tokenResolver = createCssTokenColorResolver(surface)
  const resolveToken = tokenResolver.resolve
  const background = resolveToken('--vscode-terminal-background') || cssColor(rootStyle, '--surface-bg') || '#ffffff'
  const foreground = resolveToken('--vscode-terminal-foreground') || cssColor(rootStyle, '--text-primary') || '#111111'
  const cursor = resolveToken('--vscode-terminal-foreground') ||
    cssColor(rootStyle, '--accent') ||
    cssColor(rootStyle, '--color-accent') ||
    '#0a7cff'
  const selectionBackground = resolveToken('--vscode-terminal-selectionBackground') ||
    cssColor(rootStyle, '--accent-bg') ||
    'rgba(10,124,255,0.16)'
  const theme = createTerminalThemeFromTokens(resolveToken, {
    background,
    foreground,
    cursor,
    selectionBackground,
    selectionInactiveBackground: selectionBackground,
    black: '#24292f',
    red: cssColor(rootStyle, '--state-danger') || '#cf222e',
    green: cssColor(rootStyle, '--state-success') || '#1a7f37',
    yellow: '#9a6700',
    blue: cssColor(rootStyle, '--accent') || '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#f6f8fa',
    brightBlack: '#57606a',
    brightRed: cssColor(rootStyle, '--state-danger') || '#ff7b72',
    brightGreen: cssColor(rootStyle, '--state-success') || '#56d364',
    brightYellow: '#e3b341',
    brightBlue: cssColor(rootStyle, '--accent') || '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff'
  })
  tokenResolver.dispose()
  return {
    fontFamily,
    fontSize,
    theme: theme as ITheme & TerminalThemeTokenMap
  }
}

function createCssTokenColorResolver(surface: HTMLElement | null): {
  resolve: (token: string) => string | undefined
  dispose: () => void
} {
  const rootStyle = getComputedStyle(document.documentElement)
  const surfaceStyle = surface ? getComputedStyle(surface) : null
  const probeParent = surface ?? document.body ?? document.documentElement
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  probeParent.appendChild(probe)
  return {
    resolve: (token) => {
      const value = surfaceStyle?.getPropertyValue(token).trim() || rootStyle.getPropertyValue(token).trim()
      if (!value) return undefined
      probe.style.color = value
      const resolved = getComputedStyle(probe).color
      return resolved || value
    },
    dispose: () => {
      probe.remove()
    }
  }
}

function cssColor(style: CSSStyleDeclaration, token: string): string | undefined {
  const value = style.getPropertyValue(token).trim()
  return value.length > 0 ? value : undefined
}

function ensureMonospaceStack(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_TERMINAL_FONT_STACK
  return /\bmonospace\b/i.test(trimmed) ? trimmed : `${trimmed}, monospace`
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

async function loadTerminalFont(appearance: TerminalAppearance): Promise<void> {
  if (!('fonts' in document)) return
  const primaryFamily = appearance.fontFamily.split(',')[0]?.trim()
  if (!primaryFamily) return
  try {
    if (!document.fonts.check(`${appearance.fontSize}px ${primaryFamily}`)) {
      await document.fonts.load(`${appearance.fontSize}px ${primaryFamily}`)
    }
  } catch {
    // System font stacks and user-provided family strings may not be loadable via FontFaceSet.
  }
}

function createTerminalUrlLinkProvider(term: Terminal, onOpenUrl: (url: string) => void): ILinkProvider {
  return {
    provideLinks: (bufferLineNumber, callback) => {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      const text = line?.translateToString(true) ?? ''
      const links: ILink[] = []
      for (const match of text.matchAll(TERMINAL_URL_PATTERN)) {
        const raw = match[0]
        const normalized = normalizeTerminalUrl(raw)
        if (!normalized) continue
        const startIndex = match.index ?? 0
        links.push({
          text: normalized,
          range: {
            start: { x: startIndex + 1, y: bufferLineNumber },
            end: { x: startIndex + normalized.length, y: bufferLineNumber }
          },
          decorations: { pointerCursor: true, underline: true },
          activate: (event, url) => {
            event.preventDefault()
            const safeUrl = normalizeTerminalUrl(url)
            if (!safeUrl) return
            const globals = window as typeof window & { __orchestratorLastTerminalUrlOpened?: string }
            globals.__orchestratorLastTerminalUrlOpened = safeUrl
            onOpenUrl(safeUrl)
          }
        })
      }
      callback(links.length > 0 ? links : undefined)
    }
  }
}

const TERMINAL_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/

function normalizeTerminalUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_URL_PUNCTUATION, '')
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

class TerminalErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidUpdate(prevProps: { resetKey: string }): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <TerminalFailureState
        title="The terminal encountered an error"
        description="Try reloading the terminal to continue."
        actionLabel="Reload"
        onAction={() => this.setState({ error: null })}
      />
    )
  }
}

function TerminalFailureState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}): JSX.Element {
  return (
    <div className="terminal-failure-state" data-testid="terminal-failure-state" role="status">
      <div className="terminal-failure-copy">
        <div className="terminal-failure-title">{title}</div>
        <div className="terminal-failure-description">{description}</div>
      </div>
      <button type="button" className="terminal-failure-action" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  )
}

function terminalExitDescription(exit: { code: number; signal: number | null }): string {
  if (exit.signal !== null) return `The shell exited after signal ${exit.signal}.`
  return exit.code === 0 ? 'Restart the shell to continue.' : `The shell exited with code ${exit.code}.`
}

function isCopyShortcut(event: React.KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  return (
    (event.metaKey && !event.ctrlKey && !event.altKey && key === 'c') ||
    (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'c') ||
    (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && key === 'insert')
  )
}

function isPasteShortcut(event: React.KeyboardEvent): boolean {
  const key = event.key.toLowerCase()
  return (
    (event.metaKey && !event.ctrlKey && !event.altKey && key === 'v') ||
    (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'v') ||
    (!event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'insert')
  )
}

function stripTerminalOutput(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}
