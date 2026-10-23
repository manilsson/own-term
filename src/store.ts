import { useSyncExternalStore } from 'react'

/**
 * `input`, `done` and `reminder` are the states where a session needs you: a question or approval, a
 * finished turn, or a reminder that came due (reminders.ts). `running` is a shell busy with a command
 * typed at its prompt, like a dev server.
 */
export type SessionState = 'idle' | 'running' | 'working' | 'input' | 'done' | 'reminder' | 'exited'

export interface Group {
  id: string
  name: string
  collapsed: boolean
  color: number
  /** Named by Claude from its sessions until someone renames it; `namedFrom` is what the name came from. */
  autoName?: boolean
  namedFrom?: string
  /** Monitors shown with its sessions, by monitor id; a monitor belongs to one group at most. */
  monitors?: string[]
  /** The project it was made in or last placed in; only for when its sessions' repositories don't say. */
  project?: string
}

export interface Session {
  id: string
  name: string
  cwd: string
  groupId: string | null
  runClaude: boolean
  /** The Claude conversation running in the session, resumed when deckterm restarts. */
  claudeSessionId?: string
  /** Claude has already had its one chance to put this session in a group. */
  sorted?: boolean
  /** Named by Claude from the first prompt until someone renames it; `namedFor` is the conversation it named. */
  autoName?: boolean
  namedFor?: string
  /** Plays back a scripted transcript instead of running a shell; see demo-data.ts. */
  demo?: string
  /** Come back to it at `at` (ms), for the reason in `note`; see reminders.ts. */
  remind?: { at: number; note?: string }
  /** A reminder that came due, until it's marked done, snoozed or set again. */
  due?: { at: number; note?: string }
  /** Sent to Claude as its first message when the session starts; see tools.ts (new_session). */
  firstPrompt?: string
  /** A name from SESSION_ICONS, shown before the session's name; see sessionIcons.ts. */
  icon?: string
  /** The project it was made in; only for when its repository, or its group's, doesn't say. */
  project?: string
}

export type Page = 'status' | 'reminders' | { monitor: string } | null

/** What fills the workspace: one session, a group's saved layout, or a ⌘-click pick across groups.
    A pick's ids are pane ids: a session's id, or a monitor's as `monitorPane` makes it. */
export type View =
  | { kind: 'session'; id: string }
  | { kind: 'group'; id: string }
  /** `working`: opened from the sidebar's Working row, which stays selected while it's shown. */
  | { kind: 'pick'; ids: string[]; working?: boolean }

interface Saved {
  groups: Group[]
  sessions: Session[]
  lastCwd: string
  view: View | null
  /** Whether Claude puts a new ungrouped session in a group after its first prompt. */
  autoGroup: boolean
}

/** A passing message in the footer, like what auto-grouping just did, with a way to take it back. */
export interface Notice {
  text: string
  undo?: () => void
}

/** An ended session, kept so it can be reopened where it was, resuming its Claude conversation. */
export interface Closed {
  session: Session
  index: number
  at: number
}

/** A reminder that was marked done or cancelled, for the Reminders page's history. */
export interface Cleared {
  /** The session's id, or `note:<id>` for a to-do's reminder. */
  ref: string
  /** The session's name or the to-do's text, as it was. */
  title: string
  note?: string
  /** When it came due, or would have. */
  due: number
  at: number
  how: 'done' | 'cancelled'
}

/** A change that can still be undone, for Undo Last Change (⌘Z outside a text field). */
interface Undoable {
  text: string
  undo: () => void
}

/** A to-do on the status page, written there or by Claude through the add_note tool. */
export interface Note {
  id: string
  text: string
  created: number
  /** When it was checked off. */
  done?: number
  by: 'you' | 'claude'
  /** The Linear issue it's about, like ABC-123. */
  issue?: string
  /** The session it came from or is about. */
  session?: string
  /** The Today page's project it was added on, when it has no session or issue to say. */
  project?: string
  /** A time to be reminded of it (ms); see reminders.ts. */
  remind?: number
  /** When its reminder came due, until it's checked off, snoozed or set again. */
  due?: number
}

export interface Toast {
  sessionId: string
  status: 'input' | 'done' | 'reminder'
  text?: string
  /** A tool permission, which Allow and Deny can answer from the banner. */
  permission?: boolean
  /** Kept until dismissed, rather than fading after a few seconds. */
  sticky?: boolean
}

export interface State extends Saved {
  status: Record<string, SessionState>
  titles: Record<string, string>
  git: Record<string, GitInfo | null>
  /** When each session started needing you, so ⌘J visits the longest-waiting first. */
  needsSince: Record<string, number>
  /** What Claude is doing, asking or said last in each session, and when its turn started; for the menu bar. */
  activity: Record<string, { text?: string; since?: number }>
  /** In-app notifications, newest first. */
  toasts: Toast[]
  active: string | null
  /** The session or group whose name is being edited, when a menu asked for it. */
  renaming: string | null
  /** The session whose reminder sheet is open. */
  reminding: string | null
  /** The session whose find bar is open. */
  finding: string | null
  notice: Notice | null
  /** The last few changes that can be undone, newest last. */
  undoable: Undoable[]
  /** Sessions ended in the last week, newest last, for Reopen Closed Session (⇧⌘T). */
  closed: Closed[]
  cleared: Cleared[]
  /** Folders sessions were started in, newest first, for the new-session sheet. */
  recentFolders: string[]
  /** The Today page or a monitor's, shown over the panes, which keep running behind it. */
  page: Page
  notes: Note[]
}

/** The macOS system colors (dark appearance), in the order Finder lists its tags. */
export const GROUP_COLORS = [
  { name: 'Red', color: '#ff453a' },
  { name: 'Orange', color: '#ff9f0a' },
  { name: 'Yellow', color: '#ffd60a' },
  { name: 'Green', color: '#30d158' },
  { name: 'Mint', color: '#63e6e2' },
  { name: 'Teal', color: '#40c8e0' },
  { name: 'Blue', color: '#0a84ff' },
  { name: 'Indigo', color: '#5e5ce6' },
  { name: 'Purple', color: '#bf5af2' },
  { name: 'Pink', color: '#ff375f' },
  { name: 'Gray', color: '#98989d' },
]

const STORAGE_KEY = 'deckterm.state'

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')
    if (saved?.sessions) return { view: null, autoGroup: true, ...saved }
  } catch {}
  return { groups: [], sessions: [], lastCwd: window.deck.homeDir, view: null, autoGroup: true }
}

// Statuses come from events as they happen, so they're kept across a window reload (the shells keep
// running) in sessionStorage, which lasts exactly as long as the window. Across a restart only a
// finished turn or a due reminder still holds, with what it said, so those are kept in localStorage.
const RUNTIME_KEY = 'deckterm.runtime'
const WAITING_KEY = 'deckterm.waiting'
const LASTS = ['done', 'reminder']

type Runtime = Pick<State, 'status' | 'needsSince' | 'activity'>

function loadRuntime(): Runtime {
  const empty: Runtime = { status: {}, needsSince: {}, activity: {} }
  try {
    const reload = sessionStorage.getItem(RUNTIME_KEY)
    if (reload) return { ...empty, ...JSON.parse(reload) }
    const waiting: Record<string, { status: SessionState; since: number; text?: string }> = JSON.parse(localStorage.getItem(WAITING_KEY) ?? '{}')
    for (const [id, w] of Object.entries(waiting)) {
      empty.status[id] = w.status
      empty.needsSince[id] = w.since
      empty.activity[id] = { text: w.text }
    }
  } catch {}
  return empty
}

function saveWaiting({ status, needsSince, activity }: Runtime) {
  const waiting = Object.fromEntries(Object.entries(status)
    .filter(([id, st]) => LASTS.includes(st) && needsSince[id])
    .map(([id, st]) => [id, { status: st, since: needsSince[id], text: activity[id]?.text }]))
  localStorage.setItem(WAITING_KEY, JSON.stringify(waiting))
}

const CLOSED_KEY = 'deckterm.closed'
const CLOSED_FOR = 7 * 24 * 60 * 60 * 1000
const CLOSED_MAX = 20

function loadClosed(): Closed[] {
  try {
    const closed: Closed[] = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
    return closed.filter(c => Date.now() - c.at < CLOSED_FOR)
  } catch {
    return []
  }
}

/** Remembers an ended session for Reopen Closed Session. */
export function rememberClosed(session: Session, index: number) {
  setState(s => ({
    closed: [...s.closed.filter(c => c.session.id !== session.id), { session, index, at: Date.now() }]
      .filter(c => Date.now() - c.at < CLOSED_FOR)
      .slice(-CLOSED_MAX),
  }))
}

const CLEARED_KEY = 'deckterm.clearedReminders'
const CLEARED_FOR = 30 * 24 * 60 * 60 * 1000
const CLEARED_MAX = 100

function loadCleared(): Cleared[] {
  try {
    const cleared: Cleared[] = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? '[]')
    return cleared.filter(c => Date.now() - c.at < CLEARED_FOR)
  } catch {
    return []
  }
}

export function rememberCleared(entry: Omit<Cleared, 'at'>) {
  setState(s => ({ cleared: [{ ...entry, at: Date.now() }, ...s.cleared].filter(c => Date.now() - c.at < CLEARED_FOR).slice(0, CLEARED_MAX) }))
}

const RECENT_KEY = 'deckterm.recentFolders'
const RECENT_MAX = 8

// Before there was a list, the folders of the sessions still open were the only record.
function loadRecentFolders(saved: Saved): string[] {
  try {
    const folders = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '')
    if (Array.isArray(folders)) return folders
  } catch {}
  const open = saved.sessions.filter(s => !s.demo).map(s => s.cwd).reverse()
  return [...new Set([saved.lastCwd, ...open])].slice(0, RECENT_MAX)
}

/** Remembers a folder a session was started in, at the top of the recent folders. */
export function rememberFolder(folder: string) {
  if (!folder) return
  setState(s => ({ recentFolders: [folder, ...s.recentFolders.filter(f => f !== folder)].slice(0, RECENT_MAX) }))
}

const NOTES_KEY = 'deckterm.notes'
// Checked-off to-dos stay a month, long enough for any standup to mention them.
const NOTES_KEEP = 30 * 24 * 60 * 60 * 1000

function loadNotes(): Note[] {
  try {
    const notes: Note[] = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]')
    return notes.filter(n => !n.done || Date.now() - n.done < NOTES_KEEP)
  } catch {
    return []
  }
}

const saved = load()
let state: State = {
  ...saved, ...loadRuntime(), recentFolders: loadRecentFolders(saved), page: null, notes: loadNotes(), titles: {}, git: {}, toasts: [], active: null, renaming: null, reminding: null, finding: null, notice: null, undoable: [], closed: loadClosed(), cleared: loadCleared(),
}
const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(update: (s: State) => Partial<State>) {
  const before = state
  state = { ...state, ...update(state) }
  // Most changes are runtime-only (statuses, git counts, titles), so only a change to what's saved is written.
  const { groups, sessions, lastCwd, view, autoGroup } = state
  if (
    groups !== before.groups || sessions !== before.sessions || lastCwd !== before.lastCwd
    || view !== before.view || autoGroup !== before.autoGroup
  ) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups, sessions, lastCwd, view, autoGroup }))
  }
  if (state.status !== before.status || state.needsSince !== before.needsSince || state.activity !== before.activity) {
    const { status, needsSince, activity } = state
    sessionStorage.setItem(RUNTIME_KEY, JSON.stringify({ status, needsSince, activity }))
    saveWaiting(state)
  }
  if (state.closed !== before.closed) localStorage.setItem(CLOSED_KEY, JSON.stringify(state.closed))
  if (state.cleared !== before.cleared) localStorage.setItem(CLEARED_KEY, JSON.stringify(state.cleared))
  if (state.recentFolders !== before.recentFolders) localStorage.setItem(RECENT_KEY, JSON.stringify(state.recentFolders))
  if (state.notes !== before.notes) localStorage.setItem(NOTES_KEY, JSON.stringify(state.notes))
  listeners.forEach(l => l())
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
  )
}

export const newId = () => crypto.randomUUID().slice(0, 8)

/** Sessions in sidebar order: each group's sessions in group order, then ungrouped ones. */
export function orderedSessions(s: Pick<State, 'groups' | 'sessions'>): Session[] {
  return [...s.groups.map(g => g.id), null].flatMap(gid => s.sessions.filter(x => x.groupId === gid))
}

const MONITOR_PREFIX = 'monitor:'
export const monitorPane = (monitorId: string) => MONITOR_PREFIX + monitorId
/** The monitor a pane shows, or null for a session's pane. */
export const paneMonitor = (paneId: string) => (paneId.startsWith(MONITOR_PREFIX) ? paneId.slice(MONITOR_PREFIX.length) : null)

// The monitors live in monitors.ts, which needs this module; it says here which still exist.
let monitorExists = (_id: string) => true
export function setMonitorCheck(check: (id: string) => boolean) {
  monitorExists = check
}

/** The panes a view shows, skipping sessions that have since been ended and monitors since removed. */
export function viewIds(s: Pick<State, 'sessions' | 'groups'>, view: View | null): string[] {
  if (!view) return []
  if (view.kind === 'group') {
    const monitors = s.groups.find(g => g.id === view.id)?.monitors ?? []
    return [...s.sessions.filter(x => x.groupId === view.id).map(x => x.id), ...monitors.filter(monitorExists).map(monitorPane)]
  }
  const ids = view.kind === 'session' ? [view.id] : view.ids
  return ids.filter(id => {
    const monitor = paneMonitor(id)
    return monitor ? monitorExists(monitor) : s.sessions.some(x => x.id === id)
  })
}

/** The group a pane's session or monitor is in. */
export function paneGroup(s: Pick<State, 'sessions' | 'groups'>, paneId: string): string | null {
  const monitor = paneMonitor(paneId)
  if (monitor) return s.groups.find(g => g.monitors?.includes(monitor))?.id ?? null
  return s.sessions.find(x => x.id === paneId)?.groupId ?? null
}

/** Puts a monitor in a group, out of any other, or in none. */
export function moveMonitor(monitorId: string, groupId: string | null) {
  setState(s => ({
    groups: s.groups.map(g => {
      const has = !!g.monitors?.includes(monitorId)
      if (g.id === groupId) return has ? g : { ...g, monitors: [...(g.monitors ?? []), monitorId] }
      return has ? { ...g, monitors: g.monitors!.filter(m => m !== monitorId) } : g
    }),
  }))
}

export function setStatus(id: string, status: SessionState) {
  // Hook events and shell exits can arrive after a session was ended; they mustn't bring it back.
  if (!state.sessions.some(x => x.id === id)) return
  setState(s => {
    const { [id]: since, ...rest } = s.needsSince
    const needsYou = status === 'input' || status === 'done' || status === 'reminder'
    return {
      status: { ...s.status, [id]: status },
      needsSince: needsYou ? { ...rest, [id]: since ?? Date.now() } : rest,
      // A notification is about a session needing you; once it doesn't, the notification is stale.
      toasts: needsYou ? s.toasts : s.toasts.filter(t => t.sessionId !== id),
    }
  })
}

export function setActivity(id: string, patch: { text?: string; since?: number }) {
  setState(s => ({ activity: { ...s.activity, [id]: { ...s.activity[id], ...patch } } }))
}

export function updateSession(id: string, patch: Partial<Session>) {
  setState(s => ({ sessions: s.sessions.map(x => (x.id === id ? { ...x, ...patch } : x)) }))
}

export function updateGroup(id: string, patch: Partial<Group>) {
  setState(s => ({ groups: s.groups.map(g => (g.id === id ? { ...g, ...patch } : g)) }))
}

/** Collapses every group in `ids` (all by default), or opens them all when they're all collapsed already. */
export function toggleAllGroups(ids?: string[]) {
  setState(s => {
    const shown = (g: Group) => !ids || ids.includes(g.id)
    const collapsed = s.groups.some(g => shown(g) && !g.collapsed)
    return { groups: s.groups.map(g => (shown(g) ? { ...g, collapsed } : g)) }
  })
}

/** Moves a session into a group, before another session or at the group's end. */
export function moveSession(id: string, groupId: string | null, beforeId?: string) {
  setState(s => {
    const moving = s.sessions.find(x => x.id === id)
    if (!moving || id === beforeId) return {}
    const rest = s.sessions.filter(x => x.id !== id)
    const updated = { ...moving, groupId }
    const index = beforeId ? rest.findIndex(x => x.id === beforeId) : -1
    if (index >= 0) rest.splice(index, 0, updated)
    else rest.push(updated)
    return { sessions: rest }
  })
}

/** Moves a group just before or after another; group order is also the order ⌘1–9 counts sessions in. */
export function moveGroup(id: string, targetId: string, after: boolean) {
  setState(s => {
    const moving = s.groups.find(g => g.id === id)
    if (!moving || id === targetId) return {}
    const rest = s.groups.filter(g => g.id !== id)
    const index = rest.findIndex(g => g.id === targetId)
    if (index < 0) return {}
    rest.splice(after ? index + 1 : index, 0, moving)
    return { groups: rest }
  })
}

// The project something made now belongs to; projects.ts says which, as the store can't import it.
let projectForNew: () => string | undefined = () => undefined
export const setProjectForNew = (get: () => string | undefined) => void (projectForNew = get)
/** The project a group or session made now goes in: the one chosen, if any. Not for one put back. */
export const newProject = () => projectForNew()

export function addGroup() {
  const id = newId()
  const project = newProject()
  setState(s => ({
    groups: [...s.groups, { id, name: 'New group', collapsed: false, color: s.groups.length % GROUP_COLORS.length, autoName: true, ...(project && { project }) }],
  }))
  return id
}

export function groupColor(group: Group) {
  return GROUP_COLORS[group.color % GROUP_COLORS.length].color
}

export function groupAccent(s: Pick<State, 'groups' | 'sessions'>, paneId: string) {
  const groupId = paneGroup(s, paneId)
  const group = s.groups.find(g => g.id === groupId)
  return group ? groupColor(group) : undefined
}

/** Forgets an ended session everywhere, so nothing (the Needs You queue, a banner, the focus) still points at it. */
export function removeSession(id: string) {
  setState(s => {
    const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))
    return {
      sessions: s.sessions.filter(x => x.id !== id),
      status: without(s.status),
      git: without(s.git),
      titles: without(s.titles),
      needsSince: without(s.needsSince),
      activity: without(s.activity),
      toasts: s.toasts.filter(t => t.sessionId !== id),
      active: s.active === id ? null : s.active,
      finding: s.finding === id ? null : s.finding,
    }
  })
}

export function removeGroup(id: string) {
  setState(s => ({
    groups: s.groups.filter(g => g.id !== id),
    sessions: s.sessions.map(x => (x.groupId === id ? { ...x, groupId: null } : x)),
  }))
}

const UNDO_DEPTH = 10

/** Says what just changed in the footer; one that can be undone is also kept for Undo Last Change. */
export function announce(text: string, undo?: () => void) {
  setState(s => ({
    notice: { text, undo },
    undoable: undo ? [...s.undoable, { text, undo }].slice(-UNDO_DEPTH) : s.undoable,
  }))
}

/** Undoes the most recent change still kept, whether its notice is showing or long gone. */
export function undoLast() {
  const last = state.undoable.at(-1)
  if (!last) return announce('Nothing to undo')
  setState(s => ({ undoable: s.undoable.slice(0, -1) }))
  last.undo()
  announce(`Undid: ${last.text}`)
}
