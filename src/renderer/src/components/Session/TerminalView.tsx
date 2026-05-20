import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalId: string
  workDir: string
}

export default function TerminalView({ terminalId, workDir }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [plainOutput, setPlainOutput] = useState('')

  useEffect(() => {
    setPlainOutput('')
    const vars = getComputedStyle(document.documentElement)
    const bg = vars.getPropertyValue('--surface-bg').trim() || '#ffffff'
    const fg = vars.getPropertyValue('--text-primary').trim() || '#111111'
    const accent = vars.getPropertyValue('--color-accent').trim() || '#8ab4f8'
    const codeFontSize = Number.parseFloat(vars.getPropertyValue('--font-code-size')) || 13
    const term = new Terminal({
      theme: {
        background: bg,
        foreground: fg,
        cursor: accent,
        selectionBackground: vars.getPropertyValue('--accent-bg').trim() || 'rgba(10,124,255,0.16)'
      },
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: codeFontSize,
      lineHeight: 1.45,
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
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
          await window.api.terminal.spawn(terminalId, workDir)
          if (fitOk) window.api.terminal.resize(terminalId, term.cols, term.rows)
          // replay buffered output so history appears after toggling
          const buf = await window.api.terminal.getBuffer(terminalId)
          if (buf && termRef.current === term) {
            term.write(buf)
            setPlainOutput(stripTerminalOutput(buf))
            term.refresh(0, term.rows - 1)
          }
          term.focus()
        })().catch((error) => {
          console.error('Failed to initialize terminal', error)
        })
      })
    }

    const unsub = window.api.terminal.onData((id, data) => {
      if (id !== terminalId) return
      term.write(data)
      setPlainOutput((current) => {
        const next = current + stripTerminalOutput(data)
        return next.length > 40_000 ? next.slice(-40_000) : next
      })
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
      term.dispose()
      termRef.current = null
      // shell persists — call kill() explicitly via tab close or session removal
    }
  }, [terminalId, workDir])

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        background: 'var(--surface-bg)',
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
          padding: '8px 12px 14px'
        }}
      />
      {!plainOutput.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
            fontSize: 13,
            color: 'var(--text-tertiary)',
            pointerEvents: 'none'
          }}
        >
          Starting shell...
        </div>
      )}
      <pre
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

function stripTerminalOutput(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}
