import { type FormEvent, useEffect, useRef, useState } from 'react'
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
  const [commandText, setCommandText] = useState('')

  useEffect(() => {
    setPlainOutput('')
    const vars = getComputedStyle(document.documentElement)
    const bg = '#0f0f0f'
    const fg = '#e5e7eb'
    const accent = vars.getPropertyValue('--color-accent').trim() || '#38bdf8'
    const term = new Terminal({
      theme: {
        background: bg,
        foreground: fg,
        cursor: accent,
        selectionBackground: 'rgba(56,189,248,0.3)'
      },
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    termRef.current = term

    if (containerRef.current) {
      term.open(containerRef.current)
      requestAnimationFrame(async () => {
        fitAddon.fit()
        // spawn is a no-op if shell already exists for this id
        await window.api.terminal.spawn(terminalId, workDir)
        window.api.terminal.resize(terminalId, term.cols, term.rows)
        // replay buffered output so history appears after toggling
        const buf = await window.api.terminal.getBuffer(terminalId)
        if (buf) {
          term.write(buf)
          setPlainOutput(stripTerminalOutput(buf))
          term.refresh(0, term.rows - 1)
        }
        term.focus()
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
      fitAddon.fit()
      window.api.terminal.resize(terminalId, term.cols, term.rows)
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

  const submitCommand = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = commandText.trim()
    if (!value) return
    void window.api.terminal.runCommand(terminalId, value)
    setCommandText('')
    termRef.current?.focus()
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', background: '#0f0f0f', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        aria-label="Terminal"
        style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box' }}
      />
      <form
        onSubmit={submitCommand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(15,15,15,0.96)'
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
            fontSize: 12
          }}
        >
          $
        </span>
        <input
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
          aria-label="Terminal command"
          placeholder="Run a shell command"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--color-text)',
            fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
            fontSize: 12
          }}
        />
        <button
          type="submit"
          disabled={!commandText.trim()}
          className="rounded px-2 py-1 text-xs font-medium"
          style={{
            background: commandText.trim() ? 'var(--color-accent)' : 'rgba(255,255,255,0.06)',
            color: commandText.trim() ? '#fff' : 'var(--color-text-muted)'
          }}
        >
          Run
        </button>
      </form>
      {!plainOutput.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
            fontSize: 12,
            color: 'var(--color-text-muted)',
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
