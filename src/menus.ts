import {
  addGroup, announce, getState, GROUP_COLORS, groupColor, moveSession, rememberClosed, removeGroup, removeSession, setState, toggleAllGroups, updateGroup, updateSession, viewIds,
  type Group, type Session,
} from './store'
import { kill } from './terminals'
import { editorState } from './editor'
import { applyReminder, formatDue, reminderItems } from './reminders'
import { closePane, groupRemoved, isOpen, openSession, refreshGroupView, sessionEnded, showBeside, showGroup } from './workspace'

const swatches = new Map<string, string>()

/** A filled circle in the given color, as a PNG for a native menu item's icon. */
export function swatch(color: string) {
  if (!swatches.has(color)) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 24
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(12, 12, 10, 0, Math.PI * 2)
    ctx.fill()
    swatches.set(color, canvas.toDataURL())
  }
  return swatches.get(color)!
}

/** Starts renaming a session in its pane header when it's on screen, otherwise in its sidebar row. */
export function renameSession(id: string) {
  if (isOpen(id)) return setState(() => ({ renaming: `pane:${id}` }))
  const groupId = getState().sessions.find(s => s.id === id)?.groupId
  if (groupId) updateGroup(groupId, { collapsed: false })
  setState(() => ({ renaming: id }))
}

const renameGroup = (id: string) => setState(() => ({ renaming: id }))

export async function endSession(session: Session) {
  const confirmed = await window.deck.confirm({
    message: `End “${session.name}”?`,
    detail: 'Its shell and anything running in it will be stopped.',
    confirm: 'End Session',
  })
  if (!confirmed) return
  endSessionNow(session)
}

/**
 * Ends a session without asking, with an Undo that reopens it where it was. A Claude conversation
 * in it resumes when it's opened again; anything else that ran there is gone.
 */
export function endSessionNow(session: Session, byClaude = false) {
  const index = getState().sessions.findIndex(s => s.id === session.id)
  kill(session.id)
  removeSession(session.id)
  // Recorded before its pane is taken down, which dockview can refuse for a pane still appearing.
  rememberClosed(session, index)
  announce(`${byClaude ? 'Claude ended' : 'Ended'} “${session.name}”`, () => reopenSession(session, index))
  sessionEnded(session.id)
}

export function reopenSession(session: Session, index = getState().sessions.length) {
  const { sessions, groups } = getState()
  if (sessions.some(s => s.id === session.id)) return
  // Its group may have gone since.
  const groupId = groups.some(g => g.id === session.groupId) ? session.groupId : null
  const restored: Session = { ...session, groupId, runClaude: false, firstPrompt: undefined }
  setState(s => ({
    sessions: [...s.sessions.slice(0, index), restored, ...s.sessions.slice(index)],
    closed: s.closed.filter(c => c.session.id !== session.id),
  }))
  refreshGroupView()
}

/** ⇧⌘T, or a pick from the palette: brings an ended session back and shows it, resuming its Claude. */
export function reopenClosed(id = getState().closed.at(-1)?.session.id) {
  const closed = getState().closed.find(c => c.session.id === id)
  if (!closed) return announce('No recently closed sessions')
  reopenSession(closed.session, closed.index)
  openSession(closed.session.id)
}

export function colorItems(group: Group): MenuItem[] {
  return GROUP_COLORS.map((c, i) => ({ id: `color:${i}`, label: c.name, icon: swatch(c.color), checked: group.color === i }))
}

export function applyColor(group: Group, choice: string | null) {
  if (choice?.startsWith('color:')) updateGroup(group.id, { color: Number(choice.slice(6)) })
}

/** Move to Group's submenu, for a session or a monitor in `current`; its choices start with `move:`. */
export function groupItems(current: string | null): MenuItem[] {
  return [
    ...getState().groups.map(g => ({ id: `move:${g.id}`, label: g.name, icon: swatch(groupColor(g)), checked: current === g.id })),
    { type: 'separator' },
    { id: 'move:', label: 'No Group', checked: current === null },
    { id: 'move:new', label: 'New Group' },
  ]
}

/** The session's menu, from its sidebar row or, with `inPane`, from the ⋯ button in its pane. */
export async function sessionMenu(session: Session, inPane = false) {
  const choice = await window.deck.popupMenu([
    ...(inPane ? [{ id: 'close', label: 'Close Pane' }, { type: 'separator' as const }] : []),
    { id: 'open', label: 'Show Alone' },
    { id: 'beside', label: 'Show Beside What’s on Screen' },
    { type: 'separator' },
    {
      label: session.remind ? `Remind Me (${formatDue(session.remind.at)})` : 'Remind Me',
      submenu: reminderItems(session),
    },
    { type: 'separator' },
    { id: 'rename', label: 'Rename' },
    ...(session.icon ? [{ id: 'remove-icon', label: 'Remove Icon' }] : []),
    { label: 'Move to Group', submenu: groupItems(session.groupId) },
    { type: 'separator' },
    { id: 'reveal', label: 'Reveal in Finder' },
    { id: 'editor', label: `Open in ${editorState().current.name}` },
    { id: 'copy-path', label: 'Copy Path' },
    { type: 'separator' },
    { id: 'end', label: 'End Session…' },
  ])
  if (choice === 'close') closePane(session.id)
  if (choice === 'open') openSession(session.id)
  if (choice === 'beside') showBeside(session.id)
  if (choice === 'rename') renameSession(session.id)
  if (choice === 'remove-icon') updateSession(session.id, { icon: undefined })
  if (choice === 'reveal') window.deck.revealFile(session.cwd)
  if (choice === 'editor') window.deck.openFile(session.cwd)
  if (choice === 'copy-path') navigator.clipboard.writeText(session.cwd)
  if (choice === 'end') endSession(session)
  applyReminder(session, choice)
  if (choice?.startsWith('move:')) {
    const target = choice.slice(5)
    moveSession(session.id, target === 'new' ? addGroup() : target || null)
    refreshGroupView()
  }
}

/** `listed`: the groups the sidebar lists, which Collapse All Groups is about. */
export async function groupMenu(group: Group, onNewSession: () => void, listed: string[]) {
  const choice = await window.deck.popupMenu([
    { id: 'show', label: 'Show Side by Side' },
    { id: 'new', label: 'New Session in Group' },
    { type: 'separator' },
    { id: 'rename', label: 'Rename' },
    { label: 'Color', submenu: colorItems(group) },
    { type: 'separator' },
    { id: 'toggle-all', label: getState().groups.some(g => listed.includes(g.id) && !g.collapsed) ? 'Collapse All Groups' : 'Expand All Groups' },
    { type: 'separator' },
    { id: 'delete', label: 'Delete Group…' },
  ])
  applyColor(group, choice)
  if (choice === 'show') showGroup(group.id)
  if (choice === 'new') onNewSession()
  if (choice === 'rename') renameGroup(group.id)
  if (choice === 'toggle-all') toggleAllGroups(listed)
  if (choice === 'delete') {
    const confirmed = await window.deck.confirm({
      message: `Delete “${group.name}”?`,
      detail: 'Its sessions keep running and move out of the group, as do its monitors.',
      confirm: 'Delete Group',
    })
    if (!confirmed) return
    const ids = viewIds(getState(), { kind: 'group', id: group.id })
    const index = getState().groups.findIndex(g => g.id === group.id)
    removeGroup(group.id)
    groupRemoved(group.id, ids)
    announce(`Deleted the group ${group.name}`, () => {
      if (getState().groups.some(g => g.id === group.id)) return
      // Its sessions go back unless they've been put in another group since.
      const elsewhere = new Set(getState().groups.flatMap(g => g.monitors ?? []))
      const restored = { ...group, monitors: group.monitors?.filter(m => !elsewhere.has(m)) }
      setState(s => ({
        groups: [...s.groups.slice(0, index), restored, ...s.groups.slice(index)],
        sessions: s.sessions.map(x => (ids.includes(x.id) && x.groupId === null ? { ...x, groupId: group.id } : x)),
      }))
      refreshGroupView()
    })
  }
}
