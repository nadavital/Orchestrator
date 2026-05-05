import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    const term = new Terminal({
      theme: {
        background: '#0f0f0f',
        foreground: '#e5e5e5',
        cursor: '#f97316',
        selectionBackground: 'rgba(249,115,22,0.3)'
      },
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      scrollback: 5000,
      cursorBlink: true,
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
        if (buf) term.write(buf)
        term.focus()
      })
    }

    const unsub = window.api.terminal.onData((id, data) => {
      if (id === terminalId) term.write(data)
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

  return (
    <div
      ref={containerRef}
      onClick={() => termRef.current?.focus()}
      style={{ height: '100%', width: '100%', background: '#0f0f0f', boxSizing: 'border-box' }}
    />
  )
}
