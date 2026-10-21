import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlarmClock, AppWindow, Pin, PinOff } from 'lucide-react'
import { Mark } from './Mark'
import './themes'

// The menu bar's panel (electron/menubar.cjs), a page of its own: what each session is doing, from
// a summary the main window sends. It loads none of the app's state, shells or hooks.

const SECTIONS = [
  { title: 'Needs you', statuses: ['input', 'done', 'reminder'] },
  { title: 'Working', statuses: ['working'] },
  { title: 'Running', statuses: ['running'] },
] as const

const FALLBACK = { working: 'Working', input: 'Needs your input', done: 'Finished, your turn', reminder: 'Reminder', running: 'Running a command' }

export function Panel() {
  const [{ summary, pinned }, setPanel] = useState(() => window.deck.menuBar())
  const now = useNow()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offSummary = window.deck.onMenuBar(summary => setPanel(p => ({ ...p, summary })))
    const offPinned = window.deck.onMenuBarPinned(pinned => setPanel(p => ({ ...p, pinned })))
    return () => {
      offSummary()
      offPinned()
    }
  }, [])

  // The window is as tall as what it shows.
  useLayoutEffect(() => {
    const el = ref.current!
    const observer = new ResizeObserver(() => window.deck.menuBarHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const counts = [
    summary.needsYou && `${summary.needsYou} need${summary.needsYou === 1 ? 's' : ''} you`,
    summary.working && `${summary.working} working`,
  ].filter(Boolean)

  return (
    <div ref={ref} className={`menubar-panel ${pinned ? 'pinned' : ''}`}>
      <header className="menubar-head">
        <Mark size={20} />
        <div className="menubar-title">
          <b>Own Term</b>
          <span>{counts.length ? counts.join(' · ') : 'All quiet'}</span>
        </div>
        <button className="toolbar-button" title={pinned ? 'Stop keeping on top' : 'Keep on top'} onClick={() => window.deck.menuBarPin(!pinned)}>
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        <button className="toolbar-button" title="Open Own Term" onClick={() => window.deck.menuBarOpen()}>
          <AppWindow size={15} />
        </button>
      </header>
      {summary.sessions.length === 0 && <div className="menubar-empty">Sessions show here while Claude works or waits for you.</div>}
      {SECTIONS.map(({ title, statuses }) => {
        const rows = summary.sessions.filter(s => (statuses as readonly string[]).includes(s.status))
        if (!rows.length) return null
        return (
          <section key={title}>
            <div className="menubar-section">{title}</div>
            {rows.map(s => <Row key={s.id} session={s} now={now} />)}
          </section>
        )
      })}
    </div>
  )
}

function Row({ session: s, now }: { session: MenuBarSession; now: number }) {
  return (
    <div className="menubar-row" onClick={() => window.deck.menuBarOpen(s.id)}>
      <div className="menubar-row-head">
        <StatusMark status={s.status} />
        <span className="menubar-name">{s.name}</span>
        <span className="menubar-time">{[s.group, s.since && elapsed(now - s.since)].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="menubar-text">{s.text ?? FALLBACK[s.status]}</div>
      {s.permission && (
        <div className="permission-actions" onClick={e => e.stopPropagation()}>
          <button onClick={() => window.deck.menuBarAnswer(s.id, false)}>Deny</button>
          <button className="default" onClick={() => window.deck.menuBarAnswer(s.id, true)}>Allow</button>
        </div>
      )}
      {s.reply && <PanelReply id={s.id} />}
    </div>
  )
}

/** Answers Claude from the panel; the row moves to Working once the reply arrives, or a notification says why not. */
function PanelReply({ id }: { id: string }) {
  const [text, setText] = useState('')
  return (
    <input
      className="text-field menubar-reply"
      placeholder="Reply to Claude"
      value={text}
      onClick={e => e.stopPropagation()}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing || !text.trim()) return
        window.deck.menuBarReply(id, text)
        setText('')
      }}
    />
  )
}

/** The sidebar's status icons, drawn from a status alone. */
function StatusMark({ status }: { status: MenuBarSession['status'] }) {
  const inner = {
    working: <span className="spinner" />,
    input: <span className="alert-badge">!</span>,
    done: <span className="unread-dot" />,
    reminder: <AlarmClock className="reminder" size={13} strokeWidth={2.2} />,
    running: <span className="running-dot" />,
  }[status]
  return <span className="status-icon" style={{ width: 16, height: 16 }}>{inner}</span>
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** The time, each second while the panel is on screen. */
function useNow() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const update = () => {
      clearInterval(timer)
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 1000)
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return now
}
