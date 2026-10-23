import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  DockviewReact, themeAbyss, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps,
} from 'dockview-react'
import { AlarmClock, Check, ChevronRight, CircleX, Columns2, Ellipsis, GitBranch, Globe, Plus, Sparkle, SquareTerminal } from 'lucide-react'
import {
  addGroup, getState, groupAccent, groupColor, orderedSessions, paneGroup, paneMonitor, setState, undoLast, updateSession, useStore, viewIds,
  type SessionState,
} from './store'
import { nextNeedsYou, openToast } from './claude'
import './menubar'
import './tools'
import { Toasts } from './Toasts'
import { loadDemo } from './demo'
import { Editable } from './Editable'
import { StatusIcon } from './StatusIcon'
import { iconFor } from './sessionIcons'
import { NewSessionSheet } from './NewSessionSheet'
import { chooseProject, currentProjects, useRememberProjects } from './projects'
import { ProjectRail, RAIL_WIDTH, useRailShown } from './ProjectRail'
import { ReminderSheet } from './ReminderSheet'
import { presets, reminderNote, setReminder } from './reminders'
import { attach, clear, copySelection, detach, ensureRunning, fit, focus, focusedSession, holdFit } from './terminals'
import { FIND_AGAIN, FIND_NEXT, FindBar } from './FindBar'
import { Palette, type PaletteAction } from './Palette'
import {
  addToView, closeActivePane, closePage, equalize, initWorkspace, isOpen, openSession, renamePane, showGroup, toggleZoom, zoomFromHeader,
} from './workspace'
import { renameSession, reopenClosed, sessionMenu } from './menus'
import { Sidebar } from './Sidebar'
import { Launch } from './Launch'
import { Welcome } from './Welcome'
import { InfoPanel } from './Info'
import { StatusPage } from './StatusPage'
import { MonitorPage } from './MonitorPage'
import { RemindersPage } from './RemindersPage'
import { monitorMenu, useMonitors } from './monitors'
import { SettingsSheet } from './SettingsSheet'
import { showStatus, write } from './status'
import { setTheme, THEMES } from './themes'
import { editorState } from './editor'
import { isBlank, setPlacement, useBrowser, usePlacement } from './browser'
import { FloatingBrowser } from './BrowserView'

function TerminalPane({ params, api }: IDockviewPanelProps<{ sessionId: string }>) {
  const ref = useRef<HTMLDivElement>(null)
  // Before the browser paints, so a pane's first frame already shows its terminal, drawn.
  useLayoutEffect(() => {
    const id = params.sessionId
    const el = ref.current!
    const session = getState().sessions.find(s => s.id === id)
    if (session) ensureRunning(session)
    attach(id, el)
    // A pane that's shown for the first time opens its terminal here, after the view focused it.
    if (getState().active === id) requestAnimationFrame(() => focus(id))
    const observer = new ResizeObserver(() => fit(id))
    observer.observe(el)
    const visibility = api.onDidVisibilityChange(e => e.isVisible && requestAnimationFrame(() => fit(id)))
    return () => {
      observer.disconnect()
      visibility.dispose()
      detach(id, el)
    }
  }, [params.sessionId, api])
  const finding = useStore(s => s.finding === params.sessionId)
  // A session's own browser floats over its terminal, in a window of its own (BrowserView.tsx).
  const browser = useBrowser(params.sessionId)
  return (
    <div
      className="pane-frame"
      // Dropping files types their paths, quoted for the shell, as other terminals do.
      onDragOver={e => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={e => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        const paths = [...e.dataTransfer.files].map(f => `'${window.deck.pathForFile(f).replaceAll("'", "'\\''")}'`)
        window.deck.write(params.sessionId, `${paths.join(' ')} `)
        focus(params.sessionId)
      }}
    >
      <div className="pane" ref={ref} />
      {browser && !browser.windowed && !isBlank(browser) && <FloatingBrowser id={params.sessionId} />}
      {finding && <FindBar id={params.sessionId} />}
    </div>
  )
}

type PaneParams = { sessionId?: string; monitorId?: string }

function MonitorPane({ params }: IDockviewPanelProps<{ monitorId: string }>) {
  return <MonitorPage id={params.monitorId} inPane />
}

/** Panes from more than one group on screen: each says which group it's from. */
function useGroupChip(paneId: string) {
  const group = useStore(s => {
    const mixed = new Set(viewIds(s, s.view).map(x => paneGroup(s, x))).size > 1
    return mixed ? s.groups.find(g => g.id === paneGroup(s, paneId)) : undefined
  })
  return group && (
    <span className="group-chip" style={{ '--chip': groupColor(group) } as CSSProperties}>
      {group.name}
    </span>
  )
}

function PaneTab(props: IDockviewPanelHeaderProps<PaneParams>) {
  return props.params.monitorId ? <MonitorTab id={props.params.monitorId} paneId={props.api.id} /> : <SessionTab id={props.params.sessionId!} />
}

function MonitorTab({ id, paneId }: { id: string; paneId: string }) {
  const monitor = useMonitors(list => list.find(m => m.id === id))
  const active = useStore(s => s.active === paneId)
  const chip = useGroupChip(paneId)
  if (!monitor) return null
  const Icon = iconFor(monitor.icon)
  return (
    <div className={`tab ${active ? 'active' : ''}`}>
      <span className={`monitor-state-dot ${monitor.state}`} />
      {Icon && <Icon className="tab-icon" size={13} strokeWidth={1.75} />}
      {chip}
      <span className="tab-title">{monitor.name}</span>
    </div>
  )
}

function SessionTab({ id }: { id: string }) {
  const session = useStore(s => s.sessions.find(x => x.id === id))
  const active = useStore(s => s.active === id)
  const branch = useStore(s => s.git[id]?.branch)
  const chip = useGroupChip(id)
  if (!session) return null
  const Icon = iconFor(session.icon)
  return (
    <div className={`tab ${active ? 'active' : ''}`}>
      {Icon && <Icon className="tab-icon" size={13} strokeWidth={1.75} />}
      {chip}
      <span className="tab-title">
        <Editable
          value={session.name}
          renameKey={`pane:${id}`}
          onChange={next => {
            updateSession(id, { name: next, autoName: false })
            renamePane(id, next)
          }}
        />
      </span>
      {branch && (
        <span className="tab-branch">
          <GitBranch size={13} strokeWidth={1.75} />
          <span className="branch-name">{branch}</span>
        </span>
      )}
    </div>
  )
}

const PILL: Partial<Record<SessionState, string>> = {
  running: 'Running',
  working: 'Working',
  input: 'Needs input',
  done: 'Your turn',
  reminder: 'Reminder',
  exited: 'Exited',
}

function PillIcon({ status }: { status: SessionState }) {
  if (status === 'working') return <span className="spinner" />
  if (status === 'input') return <span className="alert-badge">!</span>
  if (status === 'done') return <Check size={12} strokeWidth={3} />
  if (status === 'reminder') return <AlarmClock size={12} strokeWidth={2.4} />
  if (status === 'exited') return <CircleX size={12} strokeWidth={2.2} />
  return <span className="running-dot" />
}

/** The right end of a pane's header: what the session is doing, and its menu; a monitor's menu. */
function PaneActions({ activePanel, group }: IDockviewHeaderActionsProps) {
  const params = activePanel?.params as PaneParams | undefined
  const tint = useStore(s => (activePanel && groupAccent(s, activePanel.id)) || '')
  // On the pane, not the header: dockview gives this component the pane, and the header is its child.
  useLayoutEffect(() => group.element.style.setProperty('--group-tint', tint), [group, tint])
  if (params?.monitorId) return <MonitorActions id={params.monitorId} />
  return <SessionActions id={params?.sessionId} />
}

function MonitorActions({ id }: { id: string }) {
  const monitor = useMonitors(list => list.find(m => m.id === id))
  if (!monitor) return null
  return (
    <div className="pane-actions">
      <button className="toolbar-button" title="More" onClick={() => monitorMenu(monitor, true)}>
        <Ellipsis size={17} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function SessionActions({ id }: { id?: string }) {
  const session = useStore(s => s.sessions.find(x => x.id === id))
  const status = useStore(s => (id && s.status[id]) || 'idle')
  const browser = useBrowser(id ?? '')
  const placement = usePlacement(id ?? '')
  if (!session) return null
  return (
    <div className="pane-actions">
      {browser && id && (browser.windowed || !isBlank(browser)) && (browser.windowed ? (
        <button className="toolbar-button" title="Show Browser in Own Term" onClick={() => window.deck.setBrowserWindowed(id, false)}>
          <Globe size={15} strokeWidth={1.8} />
        </button>
      ) : (
        <button
          className={`toolbar-button ${placement.closed ? '' : 'on'}`}
          title={placement.closed ? 'Show Browser' : 'Hide Browser'}
          onClick={() => setPlacement(id, { closed: !placement.closed })}
        >
          <Globe size={15} strokeWidth={1.8} />
        </button>
      ))}
      {PILL[status] && (
        <span className={`pill ${status}`}>
          <span className="pill-icon"><PillIcon status={status} /></span>
          {PILL[status]}
        </span>
      )}
      <button className="toolbar-button" title="More" onClick={() => sessionMenu(session, true)}>
        <Ellipsis size={17} strokeWidth={1.8} />
      </button>
    </div>
  )
}

/** A window with its side panel drawn in, sliding shut behind the window's edge as the panel hides. */
function PanelIcon({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const clip = useId()
  return (
    <svg
      className={`panel-icon ${side} ${open ? 'open' : ''}`}
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <clipPath id={clip}><rect x="3" y="3" width="18" height="18" rx="2" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <g className="panel-icon-column">
          <rect x="3" y="3" width="6" height="18" fill="currentColor" stroke="none" />
          <path d="M9 3v18" />
        </g>
      </g>
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  )
}

/** Where you are, centered in the toolbar: the group, then the focused session. */
function Breadcrumb() {
  const page = useStore(s => s.page)
  const view = useStore(s => s.view)
  const sessions = useStore(s => s.sessions)
  const groups = useStore(s => s.groups)
  const active = useStore(s => s.active)
  const onScreen = viewIds({ sessions, groups }, view)
  const current = onScreen.includes(active ?? '') ? active! : onScreen[0]
  const session = sessions.find(x => x.id === current)
  const groupId = view?.kind === 'group' ? view.id : view?.kind === 'session' ? session?.groupId : null
  const group = groups.find(g => g.id === groupId)
  const monitorId = typeof page === 'object' && page ? page.monitor : current && paneMonitor(current)
  const monitor = useMonitors(list => list.find(m => m.id === monitorId))
  const name = session?.name ?? monitor?.name
  if (page === 'status') return <div className="breadcrumb"><span className="crumb current">Today</span></div>
  if (page === 'reminders') return <div className="breadcrumb"><span className="crumb current">Reminders</span></div>
  if (page) {
    return (
      <div className="breadcrumb">
        <span className="crumb">Monitors</span>
        <ChevronRight size={14} strokeWidth={2} className="crumb-separator" />
        <span className="crumb current">{monitor?.name}</span>
      </div>
    )
  }
  if (!name) return null
  return (
    <div className="breadcrumb">
      {group ? (
        <button className="crumb" onClick={() => showGroup(group.id)} title="Show the group side by side">
          <span className="tag-dot" style={{ background: groupColor(group) }} />
          {group.name}
        </button>
      ) : (
        view?.kind === 'pick' && <span className="crumb">Side by Side</span>
      )}
      {(group || view?.kind === 'pick') && <ChevronRight size={14} strokeWidth={2} className="crumb-separator" />}
      <span className="crumb current">{name}</span>
    </div>
  )
}

const NOTICE_MS = 10_000

function Footer() {
  const panes = useStore(s => viewIds(s, s.view).join(' '))
  const monitors = panes.split(' ').filter(id => paneMonitor(id)).length
  const count = panes ? panes.split(' ').length - monitors : 0
  const cwd = useStore(s => s.sessions.find(x => x.id === s.active)?.cwd)
  const notice = useStore(s => s.notice)
  // A notice under the pointer stays, so its Undo can't go away just as you reach for it.
  const [hovered, setHovered] = useState(false)
  // A notice that goes while pointed at never hears the pointer leave, which would hold the next one.
  useEffect(() => setHovered(false), [notice])
  useEffect(() => {
    if (!notice || hovered) return
    const timer = setTimeout(() => setState(s => (s.notice === notice ? { notice: null } : {})), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, hovered])
  return (
    <footer className="workspace-footer">
      <span>
        {count === 1 ? '1 session' : `${count} sessions`}
        {monitors > 0 && (monitors === 1 ? ' · 1 monitor' : ` · ${monitors} monitors`)}
      </span>
      {notice && (
        <span className="notice" key={notice.text} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
          <Sparkle size={12} strokeWidth={2} />
          {notice.text}
          {notice.undo && (
            <button
              className="link-button"
              onClick={() => {
                setState(s => ({ notice: null, undoable: s.undoable.filter(u => u.undo !== notice.undo) }))
                notice.undo?.()
              }}
            >
              Undo
            </button>
          )}
        </span>
      )}
      <span className="footer-path">{cwd?.replace(window.deck.homeDir, '~')}</span>
    </footer>
  )
}

// The welcome screen's demo link runs an app command; the watermark is rendered by dockview, outside App.
const runFromWelcome = (action: string) => window.dispatchEvent(new CustomEvent('deckterm:action', { detail: action }))

function Watermark() {
  const empty = useStore(s => s.sessions.length === 0)
  if (empty) return <Welcome onDemo={() => runFromWelcome('load-demo')} />
  return (
    <div className="watermark">
      <SquareTerminal size={44} strokeWidth={1.2} />
      <h3>No Session Selected</h3>
      <p>Click a session to show it, or a group to show its sessions side by side.</p>
    </div>
  )
}

// Title, the action it runs, and its shortcut.
const PALETTE_ACTIONS: [string, string, string?][] = [
  ['New Session', 'new-session', '⌘T'],
  ['New Group', 'new-group'],
  ['Show Another Session Beside', 'split-right', '⌘D'],
  ['Rename Session', 'rename'],
  ['Find in Pane', 'find', '⌘F'],
  ['Clear Pane', 'clear', '⌘K'],
  ['Zoom Pane', 'zoom', '⌘↩'],
  ['Make Panes Equal Width', 'equalize'],
  ['Close Pane', 'close-pane', '⌘W'],
  ['Go to Next Session Needing You', 'next-needs-you', '⌘J'],
  ['Show Today', 'status', '⌃⌘T'],
  ['Write the Standup', 'write-standup'],
  ['Settings…', 'settings', '⌘,'],
  ['Undo Last Change', 'undo-last', '⌘Z'],
  ['Remind Me About This Session…', 'remind:custom'],
  ...presets().map(p => [`Remind Me ${p.label.replace(/^In /, 'in ')}`, `remind:${p.id}`] as [string, string]),
  ['Hide Sidebar', 'toggle-sidebar', '⌃⌘S'],
  ['Hide Info Panel', 'toggle-info', '⌃⌘I'],
  ['Turn Off Auto-Grouping', 'toggle-autogroup'],
  ['Appearance: System', 'appearance:system'],
  ['Appearance: Light', 'appearance:light'],
  ['Appearance: Dark', 'appearance:dark'],
  ...THEMES.map(t => [`Theme: ${t.name}`, `theme:${t.id}`] as [string, string]),
  ...editorState().editors.map(e => [`Open Files With: ${e.name}`, `editor:${e.id}`] as [string, string]),
  ['Load Demo Day', 'load-demo'],
]

const SIDEBAR_KEY = 'deckterm.sidebar'
// Matches the sidebar-slot transition in styles.css.
const SIDEBAR_SLIDE_MS = 260

const INFO_KEY = 'deckterm.info'

function loadInfo(): { open: boolean; width: number } {
  try {
    return { open: false, width: 300, ...JSON.parse(localStorage.getItem(INFO_KEY) ?? '{}') }
  } catch {
    return { open: false, width: 300 }
  }
}

/** Drags a panel's edge. Pointer capture keeps the drag ending even when the button is released outside
    the window, and the terminals keep their size until it ends, so the shells and Claude redraw once. */
function dragEdge(e: React.PointerEvent, move: (x: number) => void) {
  e.preventDefault()
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  holdFit(60_000)
  const onMove = (m: PointerEvent) => move(m.clientX)
  const end = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('lostpointercapture', end)
    document.body.classList.remove('resizing')
    holdFit(0)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('lostpointercapture', end)
  document.body.classList.add('resizing')
}

function loadSidebar(): { width: number; hidden: boolean } {
  try {
    return { width: 280, hidden: false, ...JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? '{}') }
  } catch {
    return { width: 280, hidden: false }
  }
}

/** "Restart to Update", once a newer version has downloaded. */
function UpdateButton() {
  const [update, setUpdate] = useState(() => window.deck.updateState())
  useEffect(() => window.deck.onUpdate(setUpdate), [])
  if (update.status !== 'ready') return null
  return (
    <button className="update-button" title={`Version ${update.version} is ready`} onClick={() => window.deck.installUpdate()}>
      Restart to Update
    </button>
  )
}

export function App() {
  const [creating, setCreating] = useState<{ groupId: string | null; cwd?: string } | null>(null)
  const reminding = useStore(s => s.reminding)
  const [sidebar, setSidebar] = useState(loadSidebar)
  const [info, setInfo] = useState(loadInfo)
  const infoOpen = info.open
  const [palette, setPalette] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<false | 'top' | 'projects'>(false)
  const page = useStore(s => s.page)
  useRememberProjects()
  const railShown = useRailShown()

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar)), [sidebar])
  useEffect(() => localStorage.setItem(INFO_KEY, JSON.stringify(info)), [info])

  // The info panel is about one session, so it shows only while one session fills the workspace.
  const single = useStore(s => {
    const view = s.view
    return view?.kind === 'session' ? s.sessions.find(x => x.id === view.id) : undefined
  })
  const infoShown = infoOpen && !!single && !page
  // ⌃⌘I slides the panel, and the terminals wait out the slide. A view change shows or hides it at
  // once instead: the new panes are being laid out anyway, and should fit their final size at once.
  const infoSlot = useRef<HTMLDivElement>(null)
  const infoState = useRef<{ shown: boolean; open: boolean }>(null)
  useLayoutEffect(() => {
    const before = infoState.current
    infoState.current = { shown: infoShown, open: infoOpen }
    if (!before || before.shown === infoShown) return
    if (before.open !== infoOpen) {
      holdFit(SIDEBAR_SLIDE_MS + 40)
      return
    }
    const slot = infoSlot.current
    slot?.classList.add('instant')
    requestAnimationFrame(() => requestAnimationFrame(() => slot?.classList.remove('instant')))
  }, [infoShown, infoOpen])

  const toggleSidebar = () => {
    holdFit(SIDEBAR_SLIDE_MS + 40)
    setSidebar(s => ({ ...s, hidden: !s.hidden }))
  }

  // Like the toolbar button, it does nothing unless one session fills the window, where the panel can show.
  const toggleInfo = () => {
    if (getState().view?.kind === 'session') setInfo(i => ({ ...i, open: !i.open }))
  }

  // ⌘D: the next session that isn't on screen goes beside you, or a new one if they all are.
  const splitRight = () => {
    const next = orderedSessions(getState()).find(s => !isOpen(s.id))
    if (next) addToView(next.id)
    else setCreating({ groupId: null })
  }

  // Every command, from the app menu or the palette.
  const runAction = async (action: string, arg?: number) => {
    if (action === 'copy') copySelection()
    if (action === 'new-session') setCreating({ groupId: null })
    if (action === 'close-pane') closeActivePane()
    if (action === 'zoom') toggleZoom()
    if (action === 'clear') clear(focusedSession())
    if (action === 'palette') setPalette(true)
    if (action === 'new-group') addGroup()
    if (action === 'equalize') equalize()
    if (action === 'toggle-autogroup') setState(s => ({ autoGroup: !s.autoGroup }))
    // A monitor's pane can be the active one; these act on sessions.
    const activeSession = () => {
      const { active, sessions } = getState()
      return sessions.some(x => x.id === active) ? active : null
    }
    if (action === 'rename') {
      const active = activeSession()
      if (active) renameSession(active)
    }
    if (action.startsWith('theme:')) setTheme(action.slice(6))
    if (action.startsWith('editor:')) window.deck.setEditor(action.slice(7))
    if (action.startsWith('appearance:')) window.deck.setAppearance(action.slice(11) as 'system' | 'light' | 'dark')
    if (action === 'find') {
      const { finding } = getState()
      const active = activeSession()
      if (active && finding === active) window.dispatchEvent(new Event(FIND_AGAIN))
      else if (active) setState(() => ({ finding: active }))
    }
    if (action === 'find-next') window.dispatchEvent(new Event(FIND_NEXT))
    if (action === 'next-needs-you') nextNeedsYou()
    if (action === 'status') {
      if (getState().page === 'status') closePage()
      else showStatus()
    }
    // A ping for several pull requests at once, clicked.
    if (action === 'today' && getState().page !== 'status') showStatus()
    if (action === 'write-standup') {
      localStorage.setItem('deckterm.statusTab', 'week')
      showStatus()
      write('standup')
    }
    if (action === 'settings') setSettingsOpen('top')
    if (action === 'undo-last') undoLast()
    if (action === 'reopen-closed') reopenClosed()
    if (action === 'undo') {
      // ⌘Z undoes typing in a text field; in a terminal (xterm's own textarea) or anywhere else, the last change.
      const el = document.activeElement
      const field = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.classList.contains('xterm-helper-textarea')
      if (field || (el as HTMLElement | null)?.isContentEditable) document.execCommand('undo')
      else undoLast()
    }
    if (action.startsWith('remind:')) {
      const active = activeSession()
      const preset = presets().find(p => `remind:${p.id}` === action)
      if (active && preset) setReminder(active, preset.at(), reminderNote(getState().sessions.find(s => s.id === active)))
      else if (active) setState(() => ({ reminding: active }))
    }
    if (action === 'open-toast') openToast()
    if (action === 'toggle-sidebar') toggleSidebar()
    if (action === 'toggle-info') toggleInfo()
    if (action === 'load-demo') {
      const confirmed = await window.deck.confirm({
        message: 'Replace everything with the demo day?',
        detail: 'Every session and group is replaced, and running shells are stopped.',
        confirm: 'Load Demo',
      })
      if (confirmed) loadDemo()
    }
    if (action === 'split-right') splitRight()
    if (action === 'project' && arg !== undefined) {
      const project = arg < 0 ? { name: '' } : currentProjects().list[arg]
      if (project) chooseProject(project.name)
    }
    if (action === 'select' && arg !== undefined) {
      const session = orderedSessions(getState())[arg]
      if (session) openSession(session.id)
    }
  }

  useEffect(() => window.deck.onMenu(runAction), [])
  useEffect(() => {
    const run = (e: Event) => runAction((e as CustomEvent<string>).detail)
    window.addEventListener('deckterm:action', run)
    return () => window.removeEventListener('deckterm:action', run)
  }, [])

  const autoGroup = useStore(s => s.autoGroup)
  const closed = useStore(s => s.closed)
  const paletteActions: PaletteAction[] = PALETTE_ACTIONS.filter(([, action]) => action !== 'toggle-info' || single).map(([title, action, shortcut]): PaletteAction => ({
    title:
      title === 'Hide Sidebar' && sidebar.hidden ? 'Show Sidebar'
      : title === 'Hide Info Panel' && !infoOpen ? 'Show Info Panel'
      : title === 'Turn Off Auto-Grouping' && !autoGroup ? 'Turn On Auto-Grouping'
      : title,
    shortcut,
    run: () => runAction(action),
  })).concat([...closed].reverse().map((c, i): PaletteAction => ({
    title: `Reopen ${c.session.name}`,
    shortcut: i === 0 ? '⇧⌘T' : undefined,
    run: () => reopenClosed(c.session.id),
  })))

  const startResize = (e: React.PointerEvent) =>
    dragEdge(e, x => setSidebar(s => ({ ...s, width: Math.min(420, Math.max(220, x - 8)) })))
  // The panel's right edge is 8px in from the window's.
  const startInfoResize = (e: React.PointerEvent) =>
    dragEdge(e, x => setInfo(i => ({ ...i, width: Math.round(Math.min(560, Math.max(260, window.innerWidth - x - 8))) })))

  return (
    <div className={`app ${sidebar.hidden ? 'sidebar-hidden' : ''} ${infoShown ? '' : 'info-hidden'} ${page ? 'status-open' : ''}`}>
      <header className="toolbar">
        <button className="toolbar-button" aria-pressed={!sidebar.hidden} title={`${sidebar.hidden ? 'Show' : 'Hide'} Sidebar (⌃⌘S)`} onClick={toggleSidebar}>
          <PanelIcon side="left" open={!sidebar.hidden} />
        </button>
        <span className="titlebar-spacer" />
        <Breadcrumb />
        <span className="titlebar-spacer" />
        <UpdateButton />
        <button className="toolbar-button" title="Show Another Session Beside (⌘D)" onClick={splitRight}>
          <Columns2 size={17} strokeWidth={1.6} />
        </button>
        <button className="toolbar-button" title="New Session (⌘T)" onClick={() => setCreating({ groupId: null })}>
          <Plus size={18} strokeWidth={1.6} />
        </button>
        <button
          className="toolbar-button"
          title={single && !page ? `${infoOpen ? 'Hide' : 'Show'} Info Panel (⌃⌘I)` : 'The info panel shows when one session fills the window'}
          aria-pressed={infoShown}
          disabled={!single || !!page}
          onClick={toggleInfo}
        >
          <PanelIcon side="right" open={infoShown} />
        </button>
      </header>
      <div className="app-body">
        <div className="sidebar-slot" style={{ width: sidebar.hidden ? 0 : sidebar.width + 12 + (railShown ? RAIL_WIDTH : 0) }} inert={sidebar.hidden}>
          <ProjectRail onNameProjects={() => setSettingsOpen('projects')} />
          <Sidebar width={sidebar.width} onNewSession={groupId => setCreating({ groupId })} onNameProjects={() => setSettingsOpen('projects')} />
          <div className="sidebar-resizer" onPointerDown={startResize} />
        </div>
        <main className="workspace">
          <div
            className={`dock ${single ? '' : 'zoomable'}`}
            onDoubleClick={e => {
              const target = e.target as Element
              if (target.closest('.dv-sash')) equalize()
              else zoomFromHeader(target)
            }}
          >
            <DockviewReact
              theme={themeAbyss}
              components={{ terminal: TerminalPane, monitor: MonitorPane }}
              defaultTabComponent={PaneTab}
              rightHeaderActionsComponent={PaneActions}
              watermarkComponent={Watermark}
              // The custom ones measure the header on every layout, which costs frames when a view opens.
              scrollbars="native"
              onReady={e => initWorkspace(e.api)}
            />
            {page === 'status' && <StatusPage onSettings={() => setSettingsOpen('top')} tabs={!railShown || sidebar.hidden} />}
            {page === 'reminders' && <RemindersPage />}
            {typeof page === 'object' && page && <MonitorPage key={page.monitor} id={page.monitor} />}
          </div>
          <Footer />
          <Toasts />
        </main>
        <div className="info-slot" ref={infoSlot} style={{ width: infoShown ? info.width + 12 : 0 }} inert={!infoShown}>
          <div className="sidebar-resizer" onPointerDown={startInfoResize} />
          {single && (
            <InfoPanel session={single} width={info.width} active={infoShown} onNewSession={options => setCreating(options)} />
          )}
        </div>
      </div>
      <Launch />
      {palette && <Palette actions={paletteActions} onClose={() => setPalette(false)} />}
      {reminding && <ReminderSheet key={reminding} />}
      {settingsOpen && <SettingsSheet section={settingsOpen} onDone={() => setSettingsOpen(false)} />}
      {creating && <NewSessionSheet groupId={creating.groupId} cwd={creating.cwd} onDone={() => setCreating(null)} />}
    </div>
  )
}
