import { useEffect, useState } from 'react'
import { getState, rememberCleared, setState, setStatus, subscribe, updateSession, type Note, type Session } from './store'
import { dismissToast, needsYou, remindOnly } from './claude'
import { setNoteDone, updateNote } from './notes'

// "Come back to this session later": a time and an optional note on the session, saved with it. When
// the time comes the session joins Needs You and you're notified, the way a finished turn is. A to-do
// can have a time too, for a reminder that isn't about a session; banners and notifications name it
// `note:<id>`, where a session's go by its id.

export const SNOOZE = 'Snooze 1 Hour'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function at9(daysAhead: number) {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

/** Slack's choices, worked out when they're picked. `short` names one where its time is shown beside it. */
export function presets(): { id: string; label: string; short: string; at: () => number }[] {
  return [
    { id: '30m', label: 'In 30 Minutes', short: 'In 30 Minutes', at: () => Date.now() + 30 * MINUTE },
    { id: '1h', label: 'In 1 Hour', short: 'In 1 Hour', at: () => Date.now() + HOUR },
    { id: '3h', label: 'In 3 Hours', short: 'In 3 Hours', at: () => Date.now() + 3 * HOUR },
    { id: 'tomorrow', label: 'Tomorrow at 9:00', short: 'Tomorrow', at: () => at9(1) },
    // On a Monday, next Monday is a week away.
    { id: 'monday', label: 'Next Monday at 9:00', short: 'Next Monday', at: () => at9((8 - new Date().getDay()) % 7 || 7) },
  ]
}

// Setting a time again answers a reminder that came due.
export function setReminder(id: string, at: number, note?: string) {
  updateSession(id, { remind: { at, note: note?.trim() || undefined }, due: undefined })
}

export function cancelReminder(id: string) {
  const session = getState().sessions.find(s => s.id === id)
  if (session?.remind) rememberCleared({ ref: id, title: session.name, note: session.remind.note, due: session.remind.at, how: 'cancelled' })
  updateSession(id, { remind: undefined })
}

const NOTE = 'note:'
export const noteRef = (id: string) => NOTE + id
/** The to-do a banner, notification or the reminder sheet is about, if it's one. */
export const refNote = (ref: string | null | undefined) => (ref?.startsWith(NOTE) ? getState().notes.find(n => n.id === ref.slice(NOTE.length)) : undefined)

// A checked-off to-do reminded of again is open again, or it would never come due.
export function setNoteReminder(id: string, at: number) {
  updateNote(id, { remind: at, due: undefined, done: undefined })
}

/** Takes a to-do's time away, and answers it if it came due; the to-do stays. */
export function cancelNoteReminder(id: string) {
  const note = getState().notes.find(n => n.id === id)
  const due = note?.due ?? note?.remind
  if (note && !note.done && due) rememberCleared({ ref: noteRef(id), title: note.text, due, how: 'cancelled' })
  updateNote(id, { remind: undefined, due: undefined })
}

function answered(ref: string) {
  if (getState().status[ref] === 'reminder') setStatus(ref, 'idle')
  dismissToast(ref)
  window.deck.unnotify(ref)
}

export function snooze(ref: string) {
  const note = refNote(ref)
  if (note) setNoteReminder(note.id, Date.now() + HOUR)
  else {
    const session = getState().sessions.find(s => s.id === ref)
    setReminder(ref, Date.now() + HOUR, session?.due?.note ?? session?.remind?.note)
  }
  answered(ref)
}

/** Done with a reminder that came due: until then it stays on the Reminders page. A to-do's is checked off. */
export function finishReminder(ref: string) {
  const note = refNote(ref)
  const session = getState().sessions.find(s => s.id === ref)
  if (note) setNoteDone(note.id, true)
  else if (session?.due) {
    rememberCleared({ ref, title: session.name, note: session.due.note, due: session.due.at, how: 'done' })
    updateSession(ref, { due: undefined })
  }
  answered(ref)
}

/** The note a new time for this session's reminder starts from. */
export const reminderNote = (session?: Session) => session?.remind?.note ?? session?.due?.note

/** The reminder items of a session's menu, and what picking one does. */
export function reminderItems(session: Session): MenuItem[] {
  return [
    ...presets().map(p => ({ id: `remind:${p.id}`, label: p.label })),
    { type: 'separator' as const },
    { id: 'remind:custom', label: session.remind ? 'Change Time or Note…' : 'Custom Time or Note…' },
    ...(session.remind ? [{ id: 'remind:cancel', label: 'Cancel Reminder' }] : []),
    ...(session.due ? [{ id: 'remind:done', label: 'Mark Reminder Done' }] : []),
  ]
}

export function applyReminder(session: Session, choice: string | null) {
  if (!choice?.startsWith('remind:')) return
  const what = choice.slice(7)
  if (what === 'cancel') return cancelReminder(session.id)
  if (what === 'done') return finishReminder(session.id)
  if (what === 'custom') return setState(() => ({ reminding: session.id }))
  const preset = presets().find(p => p.id === what)
  if (preset) setReminder(session.id, preset.at(), reminderNote(session))
}

// A session that's busy, or whose shell has exited, keeps its status: you're told, and it needs you
// anyway once its turn ends.
const KEEP = ['working', 'input', 'running', 'exited']

function fire(session: Session, now: number) {
  const { at, note } = session.remind!
  // Kept with the session, not just in its status, which a new turn or a look at it clears.
  updateSession(session.id, { remind: undefined, due: { at, note } })
  // Due while Own Term was closed, or the Mac asleep.
  const late = now - at > 2 * MINUTE ? `Due ${formatDue(at, now)}` : undefined
  const text = [note, late].filter(Boolean).join(' · ') || undefined
  const status = getState().status[session.id]
  if (KEEP.includes(status ?? '')) remindOnly(session.id, text)
  else needsYou(session.id, 'reminder', text)
}

function fireNote(note: Note, now: number) {
  const at = note.remind!
  updateNote(note.id, { remind: undefined, due: at })
  const late = now - at > 2 * MINUTE ? `Due ${formatDue(at, now)}` : undefined
  remindOnly(noteRef(note.id), [note.text, late].filter(Boolean).join(' · '), 'Reminder')
}

const noteDue = (n: Note, now: number) => !n.done && n.remind !== undefined && n.remind <= now

function check() {
  const now = Date.now()
  for (const session of getState().sessions) if (session.remind && session.remind.at <= now) fire(session, now)
  for (const note of getState().notes) if (noteDue(note, now)) fireNote(note, now)
}

// Timers stop while the Mac sleeps, so waking it (the window gets focus) checks too. The first check
// waits for the window to settle, so reminders missed while Own Term was closed arrive once it's up.
setTimeout(() => {
  check()
  setInterval(check, 15_000)
  window.addEventListener('focus', check)
  subscribe(() => {
    const { sessions, notes } = getState()
    const now = Date.now()
    if (sessions.some(s => s.remind && s.remind.at <= now) || notes.some(n => noteDue(n, now))) queueMicrotask(check)
  })
}, 3000)

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** When a reminder is due, the way Slack says it: "in 45 min", "at 15:30", "tomorrow at 9:00". */
export function formatDue(at: number, now = Date.now()) {
  const minutes = Math.round((at - now) / MINUTE)
  if (minutes >= 0 && minutes < 1) return 'now'
  if (minutes > 0 && minutes < 60) return `in ${minutes} min`
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((day(at) - day(now)) / (24 * HOUR))
  if (days === 0) return `at ${clock(at)}`
  if (days === 1) return `tomorrow at ${clock(at)}`
  if (days === -1) return `yesterday at ${clock(at)}`
  const date = new Date(at).toLocaleDateString([], days > 0 && days < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })
  return `${date} at ${clock(at)}`
}

/** The time, updated every half minute, for showing how far off a reminder is. */
export function useNow() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
