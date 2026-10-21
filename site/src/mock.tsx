// Small rebuilds of the app's own parts (sidebar rows, status icons, the banner), drawn
// in HTML so they can animate and stay sharp at any size. They mirror src/ in the app; keep them close.
import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { AlarmClock, Check, ChevronRight, Clock3, Sparkle, SquareTerminal } from 'lucide-react'

// Served from public/, which `npm run icon` keeps in step with the app's icon.
const icon = 'icon.png'

export type Status = 'idle' | 'running' | 'working' | 'input' | 'done' | 'reminder'

export const STATUS_LABEL: Record<Status, string> = {
  idle: '',
  running: 'Running',
  working: 'Working',
  input: 'Needs input',
  done: 'Your turn',
  reminder: 'Reminder',
}

export function StatusGlyph({ status, shell }: { status: Status; shell?: boolean }) {
  return (
    <span className="glyph">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          className="glyph-inner"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {status === 'working' && <span className="spinner" />}
          {status === 'input' && <span className="badge">!</span>}
          {status === 'done' && <span className="dot accent" />}
          {status === 'reminder' && <span className="clock"><AlarmClock size={13} strokeWidth={2.2} /></span>}
          {status === 'running' && <span className="dot green" />}
          {status === 'idle' && (shell ? <SquareTerminal size={14} strokeWidth={1.75} /> : <Sparkle size={14} strokeWidth={1.75} />)}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function Row({ icon: Icon, name, status, meta, diff, selected, nested = true, shell, remind }: {
  icon?: LucideIcon
  name: ReactNode
  status: Status
  meta: string
  diff?: [number, number]
  selected?: boolean
  nested?: boolean
  shell?: boolean
  remind?: boolean
}) {
  return (
    <div className={`row ${selected ? 'selected' : ''} ${nested ? 'nested' : ''}`}>
      <StatusGlyph status={status} shell={shell} />
      <div className="row-text">
        <div className="row-title">{Icon && <Icon className="name-icon" size={13} strokeWidth={1.75} />}{name}{remind && <AlarmClock className="remind-mark" size={11} strokeWidth={2.2} />}</div>
        <div className="row-sub">
          <div className="row-meta">
            <AnimatePresence mode="popLayout" initial={false}>
              {STATUS_LABEL[status] && (
                <motion.span
                  key={status}
                  className={`state ${status}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                >
                  {STATUS_LABEL[status]} ·{' '}
                </motion.span>
              )}
            </AnimatePresence>
            <motion.span layout="position">{meta}</motion.span>
          </div>
          {/* The branch gives way; the lines changed stay whole at the right edge. */}
          {diff && <span className="row-diff"><span className="added">+{diff[0]}</span><span className="removed">−{diff[1]}</span></span>}
        </div>
      </div>
    </div>
  )
}

export function Folder({ name, color, count }: { name: string; color: string; count: number }) {
  return (
    <div className="row folder">
      <ChevronRight className="disclosure" size={12} strokeWidth={2.5} />
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
        <path d="M1 3.2C1 2 1.9 1 3.1 1h3l1.6 1.6h5.2c1.2 0 2.1.9 2.1 2.1v6.2c0 1.2-.9 2.1-2.1 2.1H3.1C1.9 13 1 12.1 1 10.9z" fill={color} fillOpacity=".35" stroke={color} strokeWidth="1.3" />
      </svg>
      <span className="row-title">{name}</span>
      <span className="count">{count}</span>
    </div>
  )
}

/** A group's sessions, with the group's color running down beside them. */
export function GroupChildren({ color, children }: { color: string; children: ReactNode }) {
  return <div className="group-children" style={{ '--group-color': color } as CSSProperties}>{children}</div>
}

/** The sidebar's smart tiles: Needs You and Working, which step back with nothing in them, then Today and Reminders. */
export function SmartTiles({ waiting, working, today, reminders }: { waiting: number; working: number; today: number; reminders: number }) {
  return (
    <div className="smart-tiles">
      <div className={`smart-tile needs ${waiting ? '' : 'quiet'}`}>
        <span className="tile-icon"><Clock3 size={14} strokeWidth={2.4} /></span>
        <TileCount value={waiting} />
        <span className="tile-label">Needs You</span>
      </div>
      <div className={`smart-tile working ${working ? '' : 'quiet'}`}>
        <span className="tile-icon"><span className="spinner" /></span>
        <TileCount value={working} />
        <span className="tile-label">Working</span>
      </div>
      <div className={`smart-tile today ${today ? 'some' : ''}`}>
        <span className="tile-icon">{new Date().getDate()}</span>
        <TileCount value={today} />
        <span className="tile-label">Today</span>
      </div>
      <div className={`smart-tile reminders ${reminders ? 'some' : ''}`}>
        <span className="tile-icon"><AlarmClock size={14} strokeWidth={2.4} /></span>
        <TileCount value={reminders} />
        <span className="tile-label">Reminders</span>
      </div>
    </div>
  )
}

function TileCount({ value }: { value: number }) {
  return (
    <span className="tile-count">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value} initial={{ y: '60%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-60%', opacity: 0 }} transition={{ duration: 0.3 }}>{value}</motion.span>
      </AnimatePresence>
    </span>
  )
}

/** A macOS notification banner, as the app shows one when a session finishes or needs an answer. */
export function Banner({ title, branch, text, status, tag, actions }: { title: string; branch: string; text: string; status: 'done' | 'input'; tag: string; actions?: boolean }) {
  return (
    <div className="banner">
      <div className="banner-icon">
        <img src={icon} alt="" />
        <span className={`banner-badge ${status}`}>{status === 'done' ? <Check size={9} strokeWidth={3.5} /> : '!'}</span>
      </div>
      <div className="banner-body">
        <div className="banner-head"><b>{title}</b><span>now</span></div>
        <div className="banner-branch"><i style={{ background: tag }} />{branch}</div>
        <div className="banner-text">{text}</div>
        {actions && <div className="answer-buttons"><span>Deny</span><span className="default">Allow</span></div>}
        {status === 'done' && <div className="reply-field">Reply to Claude</div>}
      </div>
    </div>
  )
}
