import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { X } from 'lucide-react'
import { getState } from './store'
import { focus } from './terminals'
import { onThemeChange, terminalTheme } from './themes'
import { commandState, type Command } from './commands'

/** A command Claude ran and what it printed, over the window; a background one's output follows its file. */
export function CommandViewer({ command, onClose }: { command: Command; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const following = command.background && !!command.taskId
  const runningRef = useRef(command.status === 'running')
  runningRef.current = command.status === 'running'

  useEffect(() => dialog.current?.focus(), [])

  // Redrawn when a command that isn't followed finishes, to show what it printed.
  useEffect(() => {
    // Output is colored for a terminal, so a terminal shows it; it only reads, so there's no cursor.
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      theme: { ...terminalTheme(), cursor: 'transparent' },
      convertEol: true,
      disableStdin: true,
      minimumContrastRatio: 3,
      scrollback: 20000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(screen.current!)
    fit.fit()
    const resize = new ResizeObserver(() => fit.fit())
    resize.observe(screen.current!)
    const unTheme = onThemeChange(() => (term.options.theme = { ...terminalTheme(), cursor: 'transparent' }))

    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    if (following) {
      let from = 0
      const read = async () => {
        const out = await window.deck.taskOutput(command.taskId!, from).catch(() => null)
        if (!current) return
        if (!out) {
          if (from === 0) term.write('\x1b[2mIts output file is gone.\x1b[0m')
          return
        }
        if (out.skipped) term.write('\x1b[2m… earlier output left out\x1b[0m\n')
        term.write(out.text)
        from = out.size
        // Once it has ended, one last read gets what it wrote last.
        if (runningRef.current || out.text) timer = setTimeout(read, 500)
      }
      read()
    } else term.write(command.output || (command.status === 'running' ? '\x1b[2mRunning…\x1b[0m' : '\x1b[2mNo output.\x1b[0m'))

    return () => {
      current = false
      clearTimeout(timer)
      resize.disconnect()
      unTheme()
      term.dispose()
    }
  }, [command.id, command.taskId, following ? null : command.status])

  // Typing goes back to the session the viewer was opened over.
  const close = () => {
    onClose()
    const { active } = getState()
    if (active) focus(active)
  }
  const state = commandState(command)

  return createPortal(
    <div className="viewer-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div
        className="viewer"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-label={command.description ?? command.command}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <header className="viewer-head">
          <div className="viewer-title command-title">
            <span className="viewer-name">{command.description ?? 'Command'}</span>
            <code className="command-line" title={command.command}>{command.command}</code>
          </div>
          <span className={`info-chip ${state.tone}`}>{state.label}</span>
          <button className="viewer-close" title="Close (Esc)" onClick={close}><X size={14} strokeWidth={2.2} /></button>
        </header>
        <div className="command-output" ref={screen} />
      </div>
    </div>,
    document.body,
  )
}
