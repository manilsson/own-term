import { AlarmClock, Sparkle, SquareTerminal, CircleX } from 'lucide-react'
import { useStore, type Session } from './store'
import { DEMO_SCRIPTS } from './demo-data'
import { iconFor } from './sessionIcons'

const isClaude = (s: Session) => !!(s.claudeSessionId || s.runClaude || (s.demo && !DEMO_SCRIPTS[s.demo]?.shell))

/**
 * A session's state the way macOS shows it: a spinner while working, an orange badge when it
 * needs an answer, Mail's blue unread dot when it's your turn, otherwise its own icon or what kind of
 * session it is. `own={false}` where the icon is drawn by the name instead, as in the sidebar.
 */
export function StatusIcon({ session, size = 16, own = true }: { session: Session; size?: number; own?: boolean }) {
  const status = useStore(s => s.status[session.id] ?? 'idle')
  const style = { width: size, height: size }
  if (status === 'working') return <span className="status-icon" style={style}><span className="spinner" /></span>
  if (status === 'input') return <span className="status-icon" style={style}><span className="alert-badge">!</span></span>
  if (status === 'running') return <span className="status-icon" style={style}><span className="running-dot" /></span>
  if (status === 'done') return <span className="status-icon" style={style}><span className="unread-dot" /></span>
  if (status === 'reminder') return <span className="status-icon reminder" style={style}><AlarmClock size={size - 3} strokeWidth={2.2} /></span>
  const Icon = status === 'exited' ? CircleX : (own ? iconFor(session.icon) : undefined) ?? (isClaude(session) ? Sparkle : SquareTerminal)
  return (
    <span className={`status-icon kind ${status}`} style={style}>
      <Icon size={size - 2} strokeWidth={1.75} />
    </span>
  )
}
