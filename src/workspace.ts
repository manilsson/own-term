import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from 'dockview-react'

type SerializedGridNode = SerializedDockview['grid']['root']
import { getState, GROUP_COLORS, monitorPane, newId, orderedSessions, paneMonitor, setState, viewIds, type Page, type View } from './store'
import { ensureRunning, focus, settled } from './terminals'
import { monitorList } from './monitors'
import { followView } from './projects'

export const SESSION_MIME = 'application/x-deckterm-session'
export const MONITOR_MIME = 'application/x-deckterm-monitor'
const GROUP_LAYOUTS_KEY = 'deckterm.groupLayouts'

type Direction = 'left' | 'right' | 'above' | 'below' | 'within'
const DROP_DIRECTION: Record<string, Direction> = {
  left: 'left',
  right: 'right',
  top: 'above',
  bottom: 'below',
  center: 'within',
}

let api: DockviewApi | null = null
// Set while a view is being laid out, so the panes it clears and adds aren't read as the user
// closing panes or resizing the group.
let applying = false
const groupLayouts: Record<string, SerializedDockview> = loadGroupLayouts()

function loadGroupLayouts() {
  try {
    return JSON.parse(localStorage.getItem(GROUP_LAYOUTS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveGroupLayout(groupId: string) {
  if (!api) return
  groupLayouts[groupId] = api.toJSON()
  localStorage.setItem(GROUP_LAYOUTS_KEY, JSON.stringify(groupLayouts))
}

export function initWorkspace(dockview: DockviewApi) {
  api = dockview
  if (import.meta.env.DEV) Object.assign(window, { dock: dockview })
  // The view decides where panes go, so panes can't be dragged; sessions are dropped in from the sidebar.
  dockview.onWillDragPanel(e => e.nativeEvent.preventDefault())
  dockview.onWillDragGroup(e => e.nativeEvent.preventDefault())
  dockview.onUnhandledDragOver(e => {
    const types = e.nativeEvent instanceof DragEvent ? e.nativeEvent.dataTransfer?.types : undefined
    if (types?.includes(SESSION_MIME) || types?.includes(MONITOR_MIME)) e.accept()
  })
  dockview.onDidDrop(e => {
    const data = e.nativeEvent instanceof DragEvent ? e.nativeEvent.dataTransfer : null
    const monitor = data?.getData(MONITOR_MIME)
    const id = monitor ? monitorPane(monitor) : data?.getData(SESSION_MIME)
    if (id) addToView(id, DROP_DIRECTION[e.position], e.group)
  })
  dockview.onDidLayoutChange(() => {
    const view = getState().view
    if (!applying && view?.kind === 'group') saveGroupLayout(view.id)
  })
  dockview.onDidRemovePanel(() => {
    if (!applying) setState(() => ({ view: pickOf(paneIds()) }))
  })
  dockview.onDidActivePanelChange(({ panel }) => {
    // Laying out a view activates each new pane in turn; only the one it ends on counts as seen.
    if (applying) return
    setState(() => ({ active: panel?.id ?? null }))
    if (panel) requestAnimationFrame(() => focus(panel.id))
  })
  show(getState().view)
}

function paneIds() {
  return api?.panels.map(p => p.id) ?? []
}

// A monitor alone in a pane stays a pick: the session view is one session's, with its info panel.
function pickOf(ids: string[]): View | null {
  if (ids.length === 0) return null
  return ids.length === 1 && !paneMonitor(ids[0]) ? { kind: 'session', id: ids[0] } : { kind: 'pick', ids }
}

function addPane(id: string, position?: Parameters<DockviewApi['addPanel']>[0]['position']) {
  const monitorId = paneMonitor(id)
  if (monitorId) {
    const title = monitorList().find(m => m.id === monitorId)?.name ?? 'Monitor'
    api?.addPanel({ id, component: 'monitor', title, params: { monitorId }, position })
    return
  }
  const session = getState().sessions.find(s => s.id === id)
  if (!api || !session) return
  ensureRunning(session)
  api.addPanel({ id, component: 'terminal', title: session.name, params: { sessionId: id }, position })
}

/** Lays sessions out side by side in equal columns, two rows past three sessions. */
function tile(ids: string[]) {
  const columns = ids.length <= 3 ? ids.length : Math.ceil(ids.length / 2)
  ids.forEach((id, i) => {
    const reference = i < columns ? ids[i - 1] : ids[i - columns]
    addPane(id, i === 0 ? undefined : { referencePanel: reference, direction: i < columns ? 'right' : 'below' })
  })
  const width = api!.width / columns
  for (const id of ids.slice(0, columns)) api!.getPanel(id)?.group.api.setSize({ width })
}

/** Fades in the panes of sessions that weren't on screen before, one after another. */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
// The reveal each pane is waiting for, so a newer view's doesn't race an older one's.
const revealing = new WeakMap<HTMLElement, object>()

// A view's panes stay hidden until their terminals have settled, then rise in. One whose size didn't
// change shows at once, and a single session swapping in fades from half-seen, never from nothing.
function enter(ids: string[], before: string[], swap = false) {
  const since = performance.now()
  ids.map(id => [id, api?.getPanel(id)?.group.element] as const).forEach(([id, el], i) => {
    if (!el) return
    const token = {}
    revealing.set(el, token)
    el.style.opacity = '0'
    // Next frame: by then React has attached the terminal, and it's still before that frame is painted.
    requestAnimationFrame(() => settled(id, since).then(waited => {
      if (revealing.get(el) !== token) return
      revealing.delete(el)
      el.style.opacity = ''
      if (reduceMotion.matches) return
      if (before.includes(id)) {
        if (waited) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
        return
      }
      if (swap && !waited) el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
      else {
        el.animate(
          [{ opacity: 0, transform: 'translateY(10px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
          { duration: 340, delay: i * 45, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
        )
      }
    }))
  })
}

export function show(view: View | null) {
  if (!api) return
  const current = getState().view
  if (current?.kind === 'group') saveGroupLayout(current.id)
  const before = paneIds()

  const ids = viewIds(getState(), view)
  followView(ids)
  applying = true
  try {
    api.clear()
    setState(() => ({ view: ids.length ? view : null }))
    if (!ids.length) return
    const saved = view?.kind === 'group' ? groupLayouts[view.id] : undefined
    const savedIds = Object.keys(saved?.panels ?? {})
    if (saved && savedIds.length === ids.length && ids.every(id => savedIds.includes(id))) {
      ids.filter(id => !paneMonitor(id)).forEach(id => ensureRunning(getState().sessions.find(s => s.id === id)!))
      api.fromJSON(saved)
    } else {
      tile(ids)
    }
  } finally {
    applying = false
  }
  enter(ids, before, ids.length === 1 && before.length === 1)
  const first = api.getPanel(ids[0])
  if (!first) return
  if (first.api.isActive) setState(() => ({ active: first.id }))
  else first.api.setActive()
  // Laying out activated it without focusing it (see onDidActivePanelChange), so typing goes nowhere.
  requestAnimationFrame(() => focus(first.id))
}

/** Shows the Today page or a monitor's over the panes; they keep running, unseen, behind it. */
export function openPage(page: NonNullable<Page> = 'status') {
  // A terminal keeping focus would take the typing meant for the page.
  ;(document.activeElement as HTMLElement | null)?.blur()
  setState(() => ({ page }))
}

/** Back to the panes from the status page, to the one that had focus. */
export function closePage() {
  if (!getState().page) return
  setState(() => ({ page: null }))
  const active = getState().active
  if (active) requestAnimationFrame(() => focus(active))
}

// A monitor's page is what's on screen, so what goes beside it goes beside it as a pane. A monitor
// already among the panes behind its page is shown there, with them.
function pageToPane() {
  const page = getState().page
  if (typeof page !== 'object' || !page) return
  setState(() => ({ page: null }))
  const pane = monitorPane(page.monitor)
  if (!api?.getPanel(pane)) show({ kind: 'pick', ids: [pane] })
}

export function openSession(id: string) {
  closePage()
  show({ kind: 'session', id })
}

/** Goes to a session: its pane if it's already on screen, otherwise it alone. */
export function focusSession(id: string) {
  const panel = api?.getPanel(id)
  if (panel) {
    closePage()
    panel.api.setActive()
  } else openSession(id)
}

export function showGroup(groupId: string) {
  closePage()
  show({ kind: 'group', id: groupId })
}

/** The sidebar's Working row: every session Claude is working in, side by side, or the one alone. */
export function showWorking() {
  closePage()
  const s = getState()
  const ids = orderedSessions(s).filter(x => s.status[x.id] === 'working').map(x => x.id)
  if (ids.length > 1) show({ kind: 'pick', ids, working: true })
  else if (ids.length === 1) show({ kind: 'session', id: ids[0] })
}

/** ⌘-click: adds a session or monitor to what's on screen, or takes it away if it's already there. */
export function togglePick(id: string) {
  const page = getState().page
  const fromPage = typeof page === 'object' && page ? monitorPane(page.monitor) : null
  pageToPane()
  closePage()
  if (id === fromPage) return
  const ids = viewIds(getState(), getState().view)
  show(pickOf(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))
}

/** "Show beside": puts a session or monitor next to what's on screen, or goes to it if it's already there. */
export function showBeside(id: string) {
  pageToPane()
  if (api?.getPanel(id)) focusSession(id)
  else addToView(id)
}

/** Takes an ended session off screen. A group being shown is laid out again without it, and stays the view. */
export function sessionEnded(id: string) {
  if (getState().view?.kind === 'group') refreshGroupView()
  else closePane(id)
}

/** Takes off screen what has gone from the view: an ended session, a removed monitor or one moved out of the group. */
export function refreshView() {
  const view = getState().view
  if (view?.kind === 'group') return refreshGroupView()
  const ids = viewIds(getState(), view)
  paneIds().filter(id => !ids.includes(id)).forEach(closePane)
}

/** Forgets every group's saved layout, for when the groups themselves are replaced. */
export function clearGroupLayouts() {
  for (const id of Object.keys(groupLayouts)) delete groupLayouts[id]
  localStorage.removeItem(GROUP_LAYOUTS_KEY)
}

/** Puts a session or monitor beside the panes already on screen, which turns the view into a pick. */
export function addToView(id: string, direction: Direction = 'right', group?: DockviewGroupPanel, keepPage = false) {
  // The Today page's chat starts sessions behind the page: laid out, so their shells start, but hidden.
  if (!keepPage) {
    pageToPane()
    closePage()
  }
  if (!api || api.getPanel(id)) return
  if (api.panels.length === 0) {
    if (keepPage || paneMonitor(id)) show(pickOf([id]))
    else openSession(id)
    return
  }
  applying = true
  try {
    addPane(id, group ? { referenceGroup: group, direction } : { referencePanel: api.activePanel!.id, direction })
  } finally {
    applying = false
  }
  enter([id], [])
  setState(() => ({ view: pickOf(paneIds()) }))
}

/** Turns the current pick into a group, moving its sessions and monitors out of the groups they were in. */
export function saveAsGroup() {
  const view = getState().view
  if (view?.kind !== 'pick') return
  const id = newId()
  const ids = viewIds(getState(), view)
  const monitors = ids.map(paneMonitor).filter(m => m !== null)
  setState(s => ({
    groups: [
      ...s.groups.map(g => (g.monitors?.some(m => monitors.includes(m)) ? { ...g, monitors: g.monitors.filter(m => !monitors.includes(m)) } : g)),
      { id, name: 'New group', collapsed: false, color: s.groups.length % GROUP_COLORS.length, autoName: true, monitors },
    ],
    sessions: [
      ...s.sessions.filter(x => !ids.includes(x.id)),
      ...ids.filter(sid => !paneMonitor(sid)).map(sid => ({ ...s.sessions.find(x => x.id === sid)!, groupId: id })),
    ],
    view: { kind: 'group', id },
  }))
  saveGroupLayout(id)
}

/** Re-lays the screen when sessions joined or left the group being shown. */
export function refreshGroupView() {
  const view = getState().view
  if (view?.kind !== 'group') return
  const ids = viewIds(getState(), view)
  const panes = paneIds()
  if (ids.length !== panes.length || ids.some(id => !panes.includes(id))) show(view)
}

export function groupRemoved(groupId: string, formerIds: string[]) {
  delete groupLayouts[groupId]
  localStorage.setItem(GROUP_LAYOUTS_KEY, JSON.stringify(groupLayouts))
  const view = getState().view
  if (view?.kind === 'group' && view.id === groupId) setState(() => ({ view: pickOf(formerIds) }))
}

/** Makes every pane on screen the same size, keeping the arrangement. */
export function equalize() {
  if (!api || api.panels.length < 2) return
  const layout = api.toJSON()
  const { root, width, height, orientation } = layout.grid
  // Each child's size runs along its parent's direction; nested splits alternate direction.
  const spread = (node: SerializedGridNode, main: number, cross: number) => {
    if (node.type !== 'branch') return
    const children = node.data as SerializedGridNode[]
    for (const child of children) {
      child.size = main / children.length
      spread(child, cross, child.size)
    }
  }
  spread(root, orientation === 'HORIZONTAL' ? width : height, orientation === 'HORIZONTAL' ? height : width)
  applying = true
  try {
    api.fromJSON(layout)
  } finally {
    applying = false
  }
  const view = getState().view
  if (view?.kind === 'group') saveGroupLayout(view.id)
}

export function toggleZoom() {
  const panel = api?.activePanel
  if (!panel) return
  if (panel.api.isMaximized()) panel.api.exitMaximized()
  else panel.api.maximize()
}

// Double-clicking a pane's header zooms it in or out, like ⌘↩, with more than one pane on screen. Its
// name renames it instead (Editable stops that double-click), and its buttons keep theirs.
export function zoomFromHeader(target: Element) {
  const header = target.closest('.dv-tabs-and-actions-container')
  if (!api || !header || target.closest('button')) return
  const view = getState().view
  if (view?.kind !== 'group' && view?.kind !== 'pick') return
  const group = api.groups.find(g => g.element.contains(header))
  const panel = group?.activePanel
  if (!panel) return
  panel.api.setActive()
  toggleZoom()
}

export function isOpen(id: string) {
  return !!api?.getPanel(id)
}

export function closeActivePane() {
  api?.activePanel?.api.close()
}

export function closePane(id: string) {
  api?.getPanel(id)?.api.close()
}

export function renamePane(id: string, title: string) {
  api?.getPanel(id)?.api.setTitle(title)
}
