import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlarmClock, AlarmClockOff, BellRing, Check, CircleCheck, ListTodo, Pencil, SquareTerminal } from 'lucide-react'
import { orderedSessions, setState, useStore, type Cleared, type Note, type Session } from './store'
import { applyReminder, cancelReminder, finishReminder, formatDue, noteRef, refNote, reminderItems, snooze, useNow } from './reminders'
import { visibleNotes } from './status'
import { ago } from './monitors'
import { closePage, openPage, openSession } from './workspace'
import { Card, Empty, GroupTag, Row } from './StatusPage'

const DAY = 24 * 60 * 60_000

type Item = { at: number; row: ReactNode }
const byTime = (a: Item, b: Item) => a.at - b.at

/** Every reminder in one list, sessions' and to-dos': the ones that came due and still wait, then what's coming, by day. */
export function RemindersPage() {
  const sessions = useStore(s => s.sessions)
  const groups = useStore(s => s.groups)
  const notes = useStore(visibleNotes)
  const cleared = useStore(s => s.cleared)
  const [showCleared, setShowCleared] = useState(false)
  const now = useNow()
  const ordered = useMemo(() => orderedSessions({ groups, sessions }), [groups, sessions])
  const open = notes.filter(n => !n.done)
  const due: Item[] = [
    ...ordered.filter(x => x.due).map(x => ({ at: x.due!.at, row: <DueRow key={x.id} session={x} now={now} /> })),
    ...open.filter(n => n.due).map(n => ({ at: n.due!, row: <NoteDueRow key={n.id} note={n} now={now} /> })),
  ].sort(byTime)
  const coming: Item[] = [
    ...ordered.filter(x => x.remind).map(x => ({ at: x.remind!.at, row: <ReminderRow key={x.id} session={x} now={now} /> })),
    ...open.filter(n => n.remind).map(n => ({ at: n.remind!, row: <NoteReminderRow key={n.id} note={n} now={now} /> })),
  ].sort(byTime)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.sheet-backdrop, .palette')) return
      if ((e.target as HTMLElement).closest('input, textarea')) return
      closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const today = new Date(now).setHours(0, 0, 0, 0)
  const buckets: [string, Item[]][] = [
    ['Today', coming.filter(x => x.at < today + DAY)],
    ['Tomorrow', coming.filter(x => x.at >= today + DAY && x.at < today + 2 * DAY)],
    ['This Week', coming.filter(x => x.at >= today + 2 * DAY && x.at < today + 7 * DAY)],
    ['Later', coming.filter(x => x.at >= today + 7 * DAY)],
  ]

  return (
    <div className="status-page reminders-page">
      <div className="status-inner">
        <header className="status-head">
          <div className="status-hello">
            <span className="status-date">
              {coming.length ? `${coming.length} coming up · next ${formatDue(coming[0].at, now)}` : 'Nothing coming up'}
            </span>
            <h1>Reminders</h1>
          </div>
        </header>

        <div className="reminders-list">
          {due.length > 0 && (
            <Card id="reminders-due" icon={<BellRing size={13} strokeWidth={2.2} />} tone="orange" title="Due" count={due.length}>
              {due.map(x => x.row)}
            </Card>
          )}
          {buckets.map(([title, list]) => list.length > 0 && (
            <Card key={title} id={`reminders-${title}`} icon={<AlarmClock size={13} strokeWidth={2.2} />} tone="accent" title={title} count={list.length}>
              {list.map(x => x.row)}
            </Card>
          ))}
          {!due.length && !coming.length && (
            <Empty icon={<AlarmClockOff size={14} strokeWidth={2} />}>
              No reminders. To come back to a session later, right-click it and pick a time under Remind Me; for anything else, give a to-do on the Today page a time.
            </Empty>
          )}
          {cleared.length > 0 && (
            <Card id="reminders-cleared" icon={<CircleCheck size={13} strokeWidth={2.2} />} tone="gray" title="Cleared"
              action={<button className="link-button" onClick={() => setShowCleared(!showCleared)}>{showCleared ? 'Hide' : `Show (${cleared.length})`}</button>}
            >
              {showCleared && cleared.map(c => <ClearedRow key={`${c.ref}-${c.at}`} entry={c} now={now} />)}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function ReminderRow({ session, now }: { session: Session; now: number }) {
  return (
    <Row
      className="reminder-row"
      lead={<span className="status-icon later-icon"><AlarmClock size={14} strokeWidth={2} /></span>}
      title={<>{session.name}<GroupTag session={session} /></>}
      sub={session.remind!.note}
      meta={<span className="accent-text">{formatDue(session.remind!.at, now)}</span>}
      onClick={() => openSession(session.id)}
      onContextMenu={async () => applyReminder(session, await window.deck.popupMenu(reminderItems(session)))}
      actions={(
        <>
          <button className="row-button" title={`Open ${session.name}`} onClick={() => openSession(session.id)}>
            <SquareTerminal size={12} strokeWidth={2.2} />Session
          </button>
          <button className="row-icon-button" title="Change Time or Note" onClick={() => setState(() => ({ reminding: session.id }))}>
            <Pencil size={13} strokeWidth={2} />
          </button>
          <button className="row-icon-button" title="Done" onClick={() => cancelReminder(session.id)}>
            <Check size={14} strokeWidth={2.4} />
          </button>
        </>
      )}
    />
  )
}

/** A reminder that came due, which waits here until it's marked done or snoozed. */
function DueRow({ session, now }: { session: Session; now: number }) {
  return (
    <Row
      className="reminder-row"
      lead={<span className="status-icon reminder"><AlarmClock size={14} strokeWidth={2} /></span>}
      title={<>{session.name}<GroupTag session={session} /></>}
      sub={session.due!.note}
      meta={<span className="due-now">{now - session.due!.at < 60_000 ? 'Now' : `Due ${formatDue(session.due!.at, now)}`}</span>}
      onClick={() => openSession(session.id)}
      onContextMenu={async () => applyReminder(session, await window.deck.popupMenu(reminderItems(session)))}
      actions={(
        <>
          <button className="row-button" title={`Open ${session.name}`} onClick={() => openSession(session.id)}>
            <SquareTerminal size={12} strokeWidth={2.2} />Session
          </button>
          <button className="row-button" title="Remind me again in an hour" onClick={() => snooze(session.id)}>
            Snooze 1 Hour
          </button>
          <button className="row-icon-button" title="Done" onClick={() => finishReminder(session.id)}>
            <Check size={14} strokeWidth={2.4} />
          </button>
        </>
      )}
    />
  )
}

const openTodos = () => openPage('status')

function NoteReminderRow({ note, now }: { note: Note; now: number }) {
  return (
    <Row
      className="reminder-row"
      lead={<span className="status-icon later-icon"><ListTodo size={14} strokeWidth={2} /></span>}
      title={note.text}
      sub="To-do"
      meta={<span className="accent-text">{formatDue(note.remind!, now)}</span>}
      onClick={openTodos}
      actions={(
        <>
          <button className="row-icon-button" title="Change Time" onClick={() => setState(() => ({ reminding: noteRef(note.id) }))}>
            <Pencil size={13} strokeWidth={2} />
          </button>
          <button className="row-icon-button" title="Check Off" onClick={() => finishReminder(noteRef(note.id))}>
            <Check size={14} strokeWidth={2.4} />
          </button>
        </>
      )}
    />
  )
}

/** A to-do whose time came: checking it off is what answers it. */
function NoteDueRow({ note, now }: { note: Note; now: number }) {
  return (
    <Row
      className="reminder-row"
      lead={<span className="status-icon reminder"><ListTodo size={14} strokeWidth={2} /></span>}
      title={note.text}
      sub="To-do"
      meta={<span className="due-now">{now - note.due! < 60_000 ? 'Now' : `Due ${formatDue(note.due!, now)}`}</span>}
      onClick={openTodos}
      actions={(
        <>
          <button className="row-button" title="Remind me again in an hour" onClick={() => snooze(noteRef(note.id))}>
            Snooze 1 Hour
          </button>
          <button className="row-icon-button" title="Check Off" onClick={() => finishReminder(noteRef(note.id))}>
            <Check size={14} strokeWidth={2.4} />
          </button>
        </>
      )}
    />
  )
}

/** A reminder marked done or cancelled, kept a month; it can be set again while its session or to-do is still there. */
function ClearedRow({ entry, now }: { entry: Cleared; now: number }) {
  const exists = useStore(s => s.sessions.some(x => x.id === entry.ref) || !!refNote(entry.ref))
  const isNote = entry.ref.startsWith('note:')
  const Icon = isNote ? ListTodo : AlarmClock
  return (
    <Row
      className="reminder-row cleared-row"
      lead={<span className="status-icon cleared-icon"><Icon size={14} strokeWidth={2} /></span>}
      title={entry.title}
      sub={[isNote ? 'To-do' : entry.note, `due ${formatDue(entry.due, now)}`].filter(Boolean).join(' · ')}
      meta={`${entry.how === 'done' ? 'Done' : 'Cancelled'} ${ago(entry.at, now)}`}
      onClick={exists ? () => (isNote ? openTodos() : openSession(entry.ref)) : undefined}
      actions={exists && (
        <button className="row-button" title="Set this reminder again" onClick={() => setState(() => ({ reminding: entry.ref }))}>
          Remind Again
        </button>
      )}
    />
  )
}
