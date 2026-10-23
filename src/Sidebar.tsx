import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { AlarmClock, Check, ChevronRight, Clock3, Folder, FolderGit2, FolderPlus, ListChevronsDownUp, ListChevronsUpDown, Pause, Plus, Search, X } from 'lucide-react'
import {
  addGroup, groupColor, monitorPane, moveGroup, moveMonitor, moveSession, orderedSessions, paneGroup, toggleAllGroups, updateGroup, updateSession,
  useStore, viewIds, type Group, type Session, type SessionState,
} from './store'
import { nextNeedsYou } from './claude'
import { Editable } from './Editable'
import { StatusIcon } from './StatusIcon'
import { iconFor } from './sessionIcons'
import { applyColor, colorItems, endSession, groupMenu, sessionMenu } from './menus'
import { formatDue, useNow } from './reminders'
import {
  closePage, MONITOR_MIME, openPage, openSession, refreshGroupView, refreshView, renamePane, saveAsGroup, SESSION_MIME, showGroup, showWorking, togglePick,
} from './workspace'
import { githubOk, isDemo, showStatus, todaySummary, useStatus, visibleNotes } from './status'
import { ago, formatValue, monitorMenu, showMonitor, useMonitors } from './monitors'
import { useScope, useSidebarScope } from './projects'
import { ProjectTitle } from './ProjectRail'

const GROUP_MIME = 'application/x-deckterm-group'
const NO_TITLES: Record<string, string> = {}
// A drag's data can't be read until the drop, so the dragged group is kept here to skip dropping it on itself.
let draggingGroup: string | null = null

export const STATUS_LABEL: Record<SessionState, string> = {
  idle: '',
  running: 'Running',
  working: 'Working',
  input: 'Needs input',
  done: 'Your turn',
  reminder: 'Reminder',
  exited: 'Exited',
}

export function Sidebar({ width, onNewSession, onNameProjects }: {
  width: number
  onNewSession: (groupId: string | null) => void
  onNameProjects: () => void
}) {
  const allGroups = useStore(s => s.groups)
  const scope = useSidebarScope()
  // Until every session is placed, a chosen project's list would show everything and then shrink.
  const placing = scope.waiting
  const groups = placing ? [] : allGroups.filter(scope.group)
  const sessions = useStore(s => s.sessions)
  const ordered = useMemo(() => orderedSessions({ groups: allGroups, sessions }), [allGroups, sessions])
  const [query, setQuery] = useState('')
  // Programs retitle their terminal constantly (Claude while it works), and only search reads titles.
  const titles = useStore(s => (query.trim() ? s.titles : NO_TITLES))
  const view = useStore(s => s.view)
  const monitors = useMonitors(list => list)
  const waiting = useStore(s => Object.keys(s.needsSince).length)
  const working = useStore(s => s.sessions.filter(x => s.status[x.id] === 'working').length)

  const q = query.trim().toLowerCase()
  const matches = q
    ? ordered.filter(s => `${s.name} ${titles[s.id] ?? ''} ${s.cwd}`.toLowerCase().includes(q))
    : null
  const ungrouped = placing ? [] : sessions.filter(s => s.groupId === null && scope.session(s))
  const anyOpen = groups.some(g => !g.collapsed)
  const listed = groups.map(g => g.id)

  return (
    <aside className="sidebar" style={{ width }}>
      <ProjectTitle onNameProjects={onNameProjects} />
      <label className="search-field">
        <Search size={13} strokeWidth={2} />
        <input
          placeholder="Search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setQuery('')
            if (e.key === 'Enter' && matches?.[0]) {
              openSession(matches[0].id)
              setQuery('')
            }
          }}
        />
      </label>

      <nav className="sidebar-list">
        {matches ? (
          <Section title="Results">{matches.map(s => <SessionRow key={s.id} session={s} />)}</Section>
        ) : (
          <>
            {/* Always every tile, gray when there's nothing, so the list below doesn't jump as sessions start and stop. */}
            <div className="smart-tiles">
              <button
                className={`smart-tile needs ${waiting ? '' : 'quiet'}`}
                onClick={() => waiting && nextNeedsYou()}
                title={waiting ? 'Go to the session that has waited longest (⌘J)' : 'Nothing is waiting for you'}
              >
                <span className="tile-icon"><Clock3 size={14} strokeWidth={2.4} /></span>
                <span className="tile-count">{waiting}</span>
                <span className="tile-label">Needs You</span>
              </button>
              <button
                className={`smart-tile working ${working ? '' : 'quiet'} ${view?.kind === 'pick' && view.working ? 'selected' : ''}`}
                onClick={() => working && showWorking()}
                title={working ? 'Show every session Claude is working in' : 'Claude isn’t working anywhere'}
              >
                <span className="tile-icon"><span className="spinner" /></span>
                <span className="tile-count">{working}</span>
                <span className="tile-label">Working</span>
              </button>
              <TodayTile />
              <RemindersTile />
            </div>
            {view?.kind === 'pick' && !view.working && view.ids.length > 1 && (
              <div className="row pick-row">
                <span className="row-title secondary">{view.ids.length} side by side</span>
                <button className="link-button" onClick={saveAsGroup}>Save as Group</button>
              </div>
            )}
            <Section
              title="Groups"
              foldable
              action={
                <span className="section-actions">
                  {groups.length > 0 && (
                    <button
                      className="section-action"
                      title={anyOpen ? 'Collapse All Groups' : 'Expand All Groups'}
                      onClick={() => toggleAllGroups(listed)}
                    >
                      {anyOpen ? <ListChevronsDownUp size={14} strokeWidth={1.75} /> : <ListChevronsUpDown size={14} strokeWidth={1.75} />}
                    </button>
                  )}
                  <button className="section-action" title="New Group" onClick={() => addGroup()}>
                    <FolderPlus size={14} strokeWidth={1.75} />
                  </button>
                </span>
              }
            >
              {groups.map(g => (
                <GroupRows key={g.id} group={g} listed={listed} onNewSession={() => onNewSession(g.id)}>
                  {[
                    ...sessions.filter(s => s.groupId === g.id).map(s => <SessionRow key={s.id} session={s} nested />),
                    ...monitors.filter(m => g.monitors?.includes(m.id)).map(m => <MonitorRow key={m.id} monitor={m} groupId={g.id} />),
                  ]}
                </GroupRows>
              ))}
            </Section>
            <Monitors />
            <Section title="Sessions" groupId={null} foldable>
              {ungrouped.map(s => <SessionRow key={s.id} session={s} />)}
              {sessions.length === 0 && <p className="empty">No sessions yet.</p>}
            </Section>
          </>
        )}
      </nav>

      <GroupPeek />

      <button className="sidebar-footer" onClick={() => onNewSession(null)}>
        <span className="footer-plus"><Plus size={13} strokeWidth={2.2} /></span>
        New Session
        <kbd>⌘T</kbd>
      </button>
    </aside>
  )
}

// Which sidebar sections are folded away; only this window's layout, so it lives in localStorage.
const FOLDED_KEY = 'deckterm.foldedSections'

function loadFolded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function Section({ title, groupId, only, action, foldable, children }: {
  title: string
  groupId?: string | null
  /** The one kind of row a drop here takes, by its drag type. */
  only?: string
  action?: ReactNode
  foldable?: boolean
  children: ReactNode
}) {
  const [folded, setFolded] = useState(() => !!foldable && loadFolded().includes(title))
  const toggle = () => {
    const next = !folded
    setFolded(next)
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...loadFolded().filter(t => t !== title), ...(next ? [title] : [])]))
    } catch {}
  }
  const heading = (
    <div className={`section-title ${folded ? 'folded' : ''}`}>
      {foldable ? (
        <button className="section-fold" onClick={toggle} title={folded ? `Show ${title}` : `Hide ${title}`} aria-expanded={!folded}>
          {title}
          <ChevronRight className="section-chevron" size={12} strokeWidth={2.4} />
        </button>
      ) : title}
      {action}
    </div>
  )
  // Folded, the heading still takes a dropped session, so Sessions can be dropped on to ungroup one.
  if (folded) return groupId === undefined ? heading : <DropZone groupId={groupId} only={only}>{heading}</DropZone>
  const body = <div className="section">{children}</div>
  return (
    <>
      {heading}
      {groupId === undefined ? body : <DropZone groupId={groupId} only={only}>{body}</DropZone>}
    </>
  )
}

function DropZone({ groupId, beforeId, only, children }: { groupId: string | null; beforeId?: string; only?: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent) => (only ? [only] : [SESSION_MIME, MONITOR_MIME]).some(type => e.dataTransfer.types.includes(type))
  return (
    <div
      className={over ? 'drop-over' : undefined}
      onDragOver={e => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        setOver(false)
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        const monitor = e.dataTransfer.getData(MONITOR_MIME)
        if (monitor) {
          moveMonitor(monitor, groupId)
          return refreshView()
        }
        moveSession(e.dataTransfer.getData(SESSION_MIME), groupId, beforeId)
        refreshGroupView()
      }}
    >
      {children}
    </div>
  )
}

/** Where a dragged group would land: before or after this one, by which half of it the pointer is over. */
function GroupSlot({ groupId, children }: { groupId: string; children: ReactNode }) {
  const [edge, setEdge] = useState<'before' | 'after' | null>(null)
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(GROUP_MIME) && draggingGroup !== groupId
  const edgeAt = (e: DragEvent) => {
    const box = e.currentTarget.getBoundingClientRect()
    return e.clientY < box.top + box.height / 2 ? 'before' : 'after'
  }
  return (
    <div
      className={`group-slot ${edge ? `drop-${edge}` : ''}`}
      onDragOver={e => {
        if (!accepts(e)) return
        e.preventDefault()
        setEdge(edgeAt(e))
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setEdge(null)
      }}
      onDrop={e => {
        setEdge(null)
        if (!accepts(e)) return
        e.preventDefault()
        moveGroup(e.dataTransfer.getData(GROUP_MIME), groupId, edgeAt(e) === 'after')
      }}
    >
      {children}
    </div>
  )
}

function GroupRows({ group, listed, onNewSession, children }: { group: Group; listed: string[]; onNewSession: () => void; children: ReactNode[] }) {
  // Folded away, the group stands in for its sessions: selected while one has focus, as Finder
  // selects a collapsed folder, and marked while any is on screen.
  const onScreen = useStore(s => viewIds(s, s.view).some(id => paneGroup(s, id) === group.id))
  const holdsFocus = useStore(s => !!s.active && viewIds(s, s.view).includes(s.active) && paneGroup(s, s.active) === group.id)
  const waiting = useStore(s => s.sessions.some(x => x.groupId === group.id && s.needsSince[x.id] !== undefined))
  const color = groupColor(group)
  const peekable = group.collapsed && children.length > 0
  useEffect(() => {
    if (!peekable) peekHover.closeFor(group.id)
  }, [peekable, group.id])
  return (
    <GroupSlot groupId={group.id}>
      <DropZone groupId={group.id}>
        <div
          className={`row group-row ${!group.collapsed ? '' : holdsFocus ? 'selected' : onScreen ? 'on-screen' : ''}`}
          draggable
          onDragStart={e => {
            draggingGroup = group.id
            e.dataTransfer.setData(GROUP_MIME, group.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => (draggingGroup = null)}
          onMouseEnter={e => peekable && peekHover.enter(group.id, e)}
          onMouseLeave={peekHover.leave}
          onMouseDown={peekHover.close}
          // The second click of a double-click (a rename) must not open it again: that focuses the terminal.
          onClick={e => e.detail < 2 && showGroup(group.id)}
          onContextMenu={e => {
            e.preventDefault()
            groupMenu(group, onNewSession, listed)
          }}
          title={group.collapsed ? undefined : 'Show side by side'}
        >
          <button
            className={`disclosure ${group.collapsed ? '' : 'open'}`}
            onClick={e => {
              e.stopPropagation()
              updateGroup(group.id, { collapsed: !group.collapsed })
            }}
          >
            <ChevronRight size={12} strokeWidth={2.5} />
          </button>
          <button
            className="folder-icon"
            title="Color"
            onClick={async e => {
              e.stopPropagation()
              applyColor(group, await window.deck.popupMenu(colorItems(group)))
            }}
          >
            <Folder size={16} strokeWidth={1.75} color={color} fill={color} fillOpacity={0.35} />
          </button>
          <span className="row-title">
            <Editable
              value={group.name}
              renameKey={group.id}
              onChange={name => updateGroup(group.id, { name, autoName: false })}
            />
          </span>
          {waiting && group.collapsed && <span className="waiting-dot" title="A session here needs you" />}
          <span className="row-count">{children.length}</span>
          <button
            className="group-add"
            title="New Session in Group"
            aria-label={`New session in ${group.name}`}
            onClick={e => {
              e.stopPropagation()
              onNewSession()
            }}
          >
            <Plus size={13} strokeWidth={2.2} />
          </button>
        </div>
        <div
          className={`group-children ${group.collapsed ? 'collapsed' : ''}`}
          style={{ '--group-color': color } as CSSProperties}
          inert={group.collapsed}
        >
          <div>{children}</div>
        </div>
      </DropZone>
    </GroupSlot>
  )
}

// One popover for every folded group, so moving from one group to the next slides it across
// and swaps what it lists, rather than closing it and opening another.
type Peek = { groupId: string; row: DOMRect; open: boolean }
let peek: Peek | null = null
let peekTimer: number | undefined
const peekListeners = new Set<() => void>()

function setPeek(next: Peek | null) {
  peek = next
  peekListeners.forEach(f => f())
}

function hidePeek() {
  if (!peek?.open) return
  setPeek({ ...peek, open: false })
  // Kept through its fade, so a group reached meanwhile takes it over in place.
  peekTimer = window.setTimeout(() => setPeek(null), 150)
}

/** Hover intent: opens after a pause, and stays open while the pointer crosses into it. */
const peekHover = {
  enter(groupId: string, e: MouseEvent) {
    // Pressed buttons mean a drag is under way; a popover would sit over where it drops.
    if (e.buttons) return
    window.clearTimeout(peekTimer)
    if (peek?.open && peek.groupId === groupId) return
    const row = e.currentTarget as HTMLElement
    // Once it's up, the next group follows almost at once; the short wait lets the pointer pass
    // over other rows on its way into the popover without dragging it along.
    peekTimer = window.setTimeout(() => setPeek({ groupId, row: row.getBoundingClientRect(), open: true }), peek ? 70 : 150)
  },
  stay() {
    window.clearTimeout(peekTimer)
  },
  leave() {
    window.clearTimeout(peekTimer)
    peekTimer = window.setTimeout(hidePeek, 180)
  },
  close() {
    window.clearTimeout(peekTimer)
    hidePeek()
  },
  closeFor(groupId: string) {
    if (peek?.groupId === groupId) peekHover.close()
  },
}

function usePeek() {
  return useSyncExternalStore(f => {
    peekListeners.add(f)
    return () => peekListeners.delete(f)
  }, () => peek)
}

/** A folded group's sessions, beside its row, to jump to one without unfolding the group. */
function GroupPeek() {
  const current = usePeek()
  return current && <PeekCard peek={current} />
}

function PeekCard({ peek }: { peek: Peek }) {
  const count = useStore(s => {
    const group = s.groups.find(g => g.id === peek.groupId)
    return s.sessions.filter(x => x.groupId === peek.groupId).length + (group?.monitors?.length ?? 0)
  })
  const list = useRef<HTMLDivElement>(null)
  // Measured, so the card can ease between one group's size and the next; until then it sizes itself.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize[0]
      setSize({ width: box.inlineSize, height: box.blockSize })
    })
    observer.observe(list.current!)
    return () => observer.disconnect()
  }, [])
  // The list it just showed stays a moment under the new one, so they cross rather than cut.
  const [last, setLast] = useState(peek)
  const [switched, setSwitched] = useState(false)
  const [leaving, setLeaving] = useState<{ groupId: string; from: CSSProperties } | null>(null)
  const shown = useRef<HTMLDivElement>(null)
  if (last.groupId !== peek.groupId) {
    // Passed over quickly, a list may be only partly in; it leaves from there rather than jumping.
    const opacity = shown.current ? getComputedStyle(shown.current).opacity : '1'
    setSwitched(true)
    setLeaving({ groupId: last.groupId, from: { '--peek-from': opacity } as CSSProperties })
    setLast(peek)
  }
  useEffect(() => {
    if (!count) peekHover.close()
  }, [count])
  // It's placed beside one row, so scrolling the sidebar out from under it would leave it beside the wrong one.
  useEffect(() => {
    if (!peek.open) return
    const shut = (e: Event) => !(e.target as Element).closest?.('.group-peek') && peekHover.close()
    window.addEventListener('scroll', shut, true)
    return () => window.removeEventListener('scroll', shut, true)
  }, [peek.open])
  const height = size?.height ?? Math.min(count * 30 + 40, window.innerHeight - 16)
  // Beside the sidebar, never over it, so the rows below stay in reach.
  const top = Math.max(8, Math.min(peek.row.top - 6, window.innerHeight - 8 - height))
  // It grows out of the row it belongs to, wherever that row sits along its edge.
  const origin = Math.max(0, Math.min(peek.row.top + peek.row.height / 2 - top, height))
  const still = useReducedMotion()
  return createPortal(
    <motion.div
      className={`group-peek ${peek.open ? '' : 'closing'}`}
      style={{ left: peek.row.right + 6, transformOrigin: `0 ${origin}px`, width: size?.width }}
      initial={false}
      animate={{ y: top, height: size?.height ?? 'auto' }}
      // A spring, not a transition: it eases out of rest and keeps its speed when a new row takes over mid-move.
      transition={still ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 42 }}
      onMouseEnter={peekHover.stay}
      onMouseLeave={peekHover.leave}
    >
      {leaving && (
        <div
          className="group-peek-list leaving"
          key={leaving.groupId}
          style={leaving.from}
          inert
          onAnimationEnd={e => e.target === e.currentTarget && setLeaving(null)}
        >
          <PeekItems groupId={leaving.groupId} />
        </div>
      )}
      <div className="group-peek-list" ref={list}>
        <div className={`group-peek-items ${switched ? 'entering' : ''}`} key={peek.groupId} ref={shown}>
          <PeekItems groupId={peek.groupId} />
        </div>
      </div>
    </motion.div>,
    document.body,
  )
}

function PeekItems({ groupId }: { groupId: string }) {
  const sessions = useStore(s => s.sessions)
  const statuses = useStore(s => s.status)
  const members = sessions.filter(s => s.groupId === groupId)
  const group = useStore(s => s.groups.find(g => g.id === groupId))
  const monitors = useMonitors(list => list).filter(m => group?.monitors?.includes(m.id))
  return (
    <>
      {group && (
        <div className="group-peek-head">
          <Folder size={14} strokeWidth={1.75} color={groupColor(group)} fill={groupColor(group)} fillOpacity={0.35} />
          <span className="group-peek-title">{group.name}</span>
        </div>
      )}
      {members.map(s => {
        const Icon = iconFor(s.icon)
        const status = statuses[s.id] ?? 'idle'
        return (
          <button
            key={s.id}
            className="group-peek-item"
            onClick={e => {
              peekHover.close()
              if (e.metaKey) togglePick(s.id)
              else openSession(s.id)
            }}
          >
            <StatusIcon session={s} own={false} />
            {Icon && <Icon className="name-icon" size={13} strokeWidth={1.75} />}
            <span className="group-peek-name">{s.name}</span>
            {STATUS_LABEL[status] && <span className={`state ${status}`}>{STATUS_LABEL[status]}</span>}
          </button>
        )
      })}
      {monitors.map(m => {
        const Icon = iconFor(m.icon)
        return (
          <button
            key={m.id}
            className="group-peek-item"
            onClick={e => {
              peekHover.close()
              if (e.metaKey) togglePick(monitorPane(m.id))
              else showMonitor(m.id)
            }}
          >
            <MonitorStateIcon state={m.state} />
            {Icon && <Icon className="name-icon" size={13} strokeWidth={1.75} />}
            <span className="group-peek-name">{m.name}</span>
          </button>
        )
      })}
    </>
  )
}

function GitSummary({ id, cwd }: { id: string; cwd: string }) {
  const git = useStore(s => s.git[id])
  const folder = cwd.split('/').filter(Boolean).pop() ?? '~'
  if (!git) return <span>{folder}</span>
  const tree = git.worktree
  return (
    <span title={cwd}>
      {tree && (
        <span className="worktree-mark" title={`Worktree “${tree.name}” of ${tree.repo}\n${tree.path.replace(window.deck.homeDir, '~')}`}>
          <FolderGit2 size={11} strokeWidth={2} />
        </span>
      )}
      {git.branch}
      {git.untracked > 0 && <span> · {git.untracked} new</span>}
    </span>
  )
}

function DiffStat({ id }: { id: string }) {
  const added = useStore(s => s.git[id]?.added ?? 0)
  const removed = useStore(s => s.git[id]?.removed ?? 0)
  if (!added && !removed) return null
  return (
    <span className="row-diff">
      {added > 0 && <span className="added">+{added}</span>}
      {removed > 0 && <span className="removed">−{removed}</span>}
    </span>
  )
}

function SessionRow({ session, nested }: { session: Session; nested?: boolean }) {
  const status = useStore(s => s.status[session.id] ?? 'idle')
  // The focused pane's session is selected; the rest of a ⌘-pick is marked so you can see what you picked.
  const selected = useStore(s => s.active === session.id && viewIds(s, s.view).includes(session.id))
  const picked = useStore(s => s.view?.kind === 'pick' && s.view.ids.includes(session.id))
  const Icon = iconFor(session.icon)

  return (
    <DropZone groupId={session.groupId} beforeId={session.id}>
      <div
        className={`row session-row ${nested ? 'nested' : ''} ${selected ? 'selected' : picked ? 'on-screen' : ''}`}
        draggable
        onDragStart={e => {
          e.dataTransfer.setData(SESSION_MIME, session.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={e => e.detail < 2 && (e.metaKey ? togglePick(session.id) : openSession(session.id))}
        onContextMenu={e => {
          e.preventDefault()
          sessionMenu(session)
        }}
      >
        <StatusIcon session={session} own={false} />
        <div className="row-text">
          <div className="row-title">
            {Icon && <Icon className="name-icon" size={13} strokeWidth={1.75} />}
            <Editable
              value={session.name}
              renameKey={session.id}
              onChange={name => {
                updateSession(session.id, { name, autoName: false })
                renamePane(session.id, name)
              }}
            />
            {(session.remind || session.due) && <RemindMark session={session} />}
          </div>
          <div className="row-subtitle">
            <span className="row-meta">
              {STATUS_LABEL[status] && <span className={`state ${status}`}>{STATUS_LABEL[status]} · </span>}
              <GitSummary id={session.id} cwd={session.cwd} />
            </span>
            <DiffStat id={session.id} />
          </div>
        </div>
        <button
          className="row-end"
          title="End Session…"
          aria-label={`End ${session.name}`}
          onClick={e => {
            e.stopPropagation()
            endSession(session)
          }}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </div>
    </DropZone>
  )
}

/** Opens the Today page: a third smart tile across both columns, its icon the date, as Reminders' Today is. */
function TodayTile() {
  const page = useStore(s => s.page)
  const allNotes = useStore(visibleNotes)
  const allSessions = useStore(s => s.sessions)
  const allData = useStatus(s => s.data)
  // What the page shows: with a project chosen, only its pull requests, reminders and to-dos.
  const scope = useScope()
  const notes = allNotes.filter(scope.note)
  const sessions = allSessions.filter(scope.session)
  const gh = githubOk(allData?.github)
  const data = gh && allData && scope.project ? { ...allData, github: { ...gh, mine: gh.mine.filter(scope.pr), review: gh.review.filter(scope.pr) } } : allData
  const now = useNow()
  const date = new Date(now)
  const { count, text } = todaySummary({ notes, sessions }, data, now)
  return (
    <button
      className={`smart-tile today ${page === 'status' ? 'selected' : ''}`}
      onClick={() => (page === 'status' ? closePage() : showStatus())}
      title={`Today (⌃⌘T)${text ? `: ${text}` : ''}`}
    >
      <span className="tile-icon">{date.getDate()}</span>
      {/* Always open, unlike Needs You and Working: the page is worth seeing with nothing waiting too. */}
      <span className={`tile-count ${count ? '' : 'none'}`}>{count}</span>
      <span className="tile-label">Today</span>
    </button>
  )
}

/** Opens the Reminders page; the count takes in ones that came due and still wait. */
function RemindersTile() {
  const page = useStore(s => s.page)
  const sessions = useStore(s => s.sessions)
  const notes = useStore(visibleNotes)
  const now = useNow()
  const open = notes.filter(n => !n.done)
  const due = sessions.filter(x => x.due).length + open.filter(n => n.due).length
  const next = [
    ...sessions.filter(s => s.remind).map(s => ({ name: s.name, at: s.remind!.at })),
    ...open.filter(n => n.remind).map(n => ({ name: n.text, at: n.remind! })),
  ].sort((a, b) => a.at - b.at)[0]
  const count = sessions.filter(x => x.remind || x.due).length + open.filter(n => n.remind || n.due).length
  return (
    <button
      className={`smart-tile reminders ${page === 'reminders' ? 'selected' : ''}`}
      onClick={() => (page === 'reminders' ? closePage() : openPage('reminders'))}
      title={[due && `${due} due now`, next && `Next: ${next.name}, ${formatDue(next.at, now)}`].filter(Boolean).join(' · ') || 'No reminders'}
    >
      <span className="tile-icon"><AlarmClock size={14} strokeWidth={2.4} /></span>
      {/* Open with none too, like Today: the empty page says how to set one. */}
      <span className={`tile-count ${count ? '' : 'none'}`}>{count}</span>
      <span className="tile-label">Reminders</span>
    </button>
  )
}

/** Monitors Claude made that aren't in a group: each a page of what its commands return, colored by the rules firing on it. */
function Monitors() {
  const all = useMonitors(list => list)
  const groups = useStore(s => s.groups)
  const monitors = all.filter(m => !groups.some(g => g.monitors?.includes(m.id)))
  // The demo day's screenshots show only invented work.
  const demo = useStore(isDemo)
  if (!monitors.length || demo) return null
  return (
    <Section title="Monitors" groupId={null} only={MONITOR_MIME} foldable>
      {monitors.map(m => <MonitorRow key={m.id} monitor={m} />)}
    </Section>
  )
}

const MONITOR_LABEL: Partial<Record<MonitorState, string>> = {
  approval: 'Allow commands',
  done: 'Finished',
  paused: 'Paused',
  error: 'Failing',
  pending: 'Starting',
}

/** `groupId`: the row under the group it's in, which takes it out of Monitors. */
function MonitorRow({ monitor, groupId }: { monitor: MonitorSummary; groupId?: string }) {
  const pane = monitorPane(monitor.id)
  const selected = useStore(s => typeof s.page === 'object' && s.page ? s.page.monitor === monitor.id : s.active === pane && viewIds(s, s.view).includes(pane))
  const picked = useStore(s => !s.page && viewIds(s, s.view).includes(pane))
  const now = useNow()
  const Icon = iconFor(monitor.icon)
  // A stopped monitor's rules keep their last state, which isn't news any more.
  const firing = monitor.paused ? [] : monitor.firing
  const worst = firing.find(f => f.level === 'alert') ?? firing[0]
  const label = worst ? (worst.keys?.length ? `${worst.name}: ${worst.keys.slice(0, 2).join(', ')}` : worst.name) : MONITOR_LABEL[monitor.state]
  const tone = worst ? worst.level : monitor.state
  const headline = monitor.headline && monitor.state !== 'approval' ? formatValue(monitor.headline.value, monitor.headline) : null
  return (
    <div
      className={`row session-row monitor-row ${groupId ? 'nested' : ''} ${selected ? 'selected' : picked ? 'on-screen' : ''}`}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(MONITOR_MIME, monitor.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={e => (e.metaKey ? togglePick(pane) : showMonitor(monitor.id))}
      onContextMenu={e => {
        e.preventDefault()
        monitorMenu(monitor)
      }}
      title={monitor.error}
    >
      <MonitorStateIcon state={monitor.state} />
      <div className="row-text">
        <div className="row-title">
          {Icon && <Icon className="name-icon" size={13} strokeWidth={1.75} />}
          <span className="monitor-name">{monitor.name}</span>
          {monitor.unseen > 0 && <span className="monitor-unseen">{monitor.unseen}</span>}
        </div>
        <div className="row-subtitle">
          <span className="row-meta">
            {label && <span className={`state monitor-tone-${tone}`}>{label}{monitor.lastRun && !worst ? ' · ' : ''}</span>}
            {!worst && monitor.lastRun && monitor.state !== 'approval' && ago(monitor.lastRun, Math.max(now, monitor.lastRun))}
          </span>
          {headline && <span className="row-diff monitor-headline">{headline}</span>}
        </div>
      </div>
    </div>
  )
}

const ICON_SIZE = { width: 16, height: 16 }

function MonitorStateIcon({ state }: { state: MonitorState }) {
  if (state === 'approval') return <span className="status-icon" style={ICON_SIZE}><span className="alert-badge">!</span></span>
  if (state === 'done') return <span className="status-icon monitor-done-icon" style={ICON_SIZE}><Check size={13} strokeWidth={2.6} /></span>
  if (state === 'paused') return <span className="status-icon kind" style={ICON_SIZE}><Pause size={13} strokeWidth={2} /></span>
  return <span className="status-icon" style={ICON_SIZE}><span className={`monitor-state-dot ${state}`} /></span>
}

function RemindMark({ session }: { session: Session }) {
  const now = useNow()
  const { at, note } = (session.due ?? session.remind)!
  const when = `${session.due ? 'Reminder due' : 'Reminder'} ${formatDue(at, now)}`
  return (
    <span className={`remind-mark ${session.due ? 'due' : ''}`} title={note ? `${when}: ${note}` : when}>
      <AlarmClock size={11} strokeWidth={2.2} />
    </span>
  )
}
