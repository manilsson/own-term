import {
  addGroup, announce, getState, GROUP_COLORS, monitorPane, moveMonitor, moveSession, newId, paneGroup, viewIds, orderedSessions, rememberFolder, removeGroup, setState, subscribe, updateGroup, updateSession,
  type Group, type Note, type Session, type SessionState, type State,
} from './store'
import { cancelNoteReminder, cancelReminder, finishReminder, formatDue, setNoteReminder, setReminder } from './reminders'
import { SESSION_ICONS } from './sessionIcons'
import { lastReply, promptClaude } from './claude'
import { endSessionNow } from './menus'
import { addNote, dropNote, removeNote, setNoteDone, short, updateNote } from './notes'
import { githubOk, isDemo, knownFolders, lastIssueFolder, linearOk, reviewWithClaude, settingsChanged, startIssueIn, statusState, statusText } from './status'
import { currentProjects, knownRepos, resolveProjects } from './projects'
import { addToView, closePage, groupRemoved, openSession, refreshGroupView, refreshView, renamePane, show } from './workspace'
import { monitorList, refreshMonitors, removeMonitor, setPaused } from './monitors'

// What Claude in a session asks of Own Term through its MCP server (electron/tools.cjs), done with the
// same functions the sidebar uses. Every change is announced, with Undo where it can be undone, since
// Claude made it, not you.

class ToolError extends Error {}

// The Today page's chat, which calls in as no session (electron/tools.cjs).
const TODAY = 'today'

const STATUS: Record<SessionState, string> = {
  idle: 'idle',
  running: 'running a command',
  working: 'working',
  input: 'needs input',
  done: 'finished, your turn',
  reminder: 'reminder due',
  exited: 'shell exited',
}

const home = window.deck.homeDir
const tilde = (path: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

function text(value: unknown, what: string, max = 80) {
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`${what} is missing.`)
  return value.trim().slice(0, max)
}

function findSession(ref: unknown, caller: string): Session {
  const { sessions } = getState()
  if (ref === undefined || ref === null || ref === '') {
    if (caller === TODAY) throw new ToolError('Say which session; you are on the Today page, not in a session.')
    const self = sessions.find(s => s.id === caller)
    if (!self) throw new ToolError('The session you are running in is gone.')
    return self
  }
  const name = String(ref).trim()
  const byId = sessions.find(s => s.id === name)
  if (byId) return byId
  const named = sessions.filter(s => s.name.toLowerCase() === name.toLowerCase())
  if (named.length === 1) return named[0]
  throw new ToolError(named.length ? `More than one session is called “${name}”; give its id.` : `No session “${name}”; list_sessions shows them.`)
}

function findGroup(ref: unknown): Group {
  const name = text(ref, 'The group')
  const { groups } = getState()
  const byId = groups.find(g => g.id === name)
  if (byId) return byId
  const named = groups.filter(g => g.name.toLowerCase() === name.toLowerCase())
  if (named.length === 1) return named[0]
  throw new ToolError(named.length ? `More than one group is called “${name}”; give its id.` : `No group “${name}”; list_sessions shows them.`)
}

function iconName(name: unknown) {
  const icon = text(name, 'The icon', 40).toLowerCase()
  if (!SESSION_ICONS[icon]) throw new ToolError(`No icon “${icon}”; use one of ${Object.keys(SESSION_ICONS).join(', ')}.`)
  return icon
}

function colorIndex(name: unknown) {
  if (name === undefined || name === null || name === '') return undefined
  const index = GROUP_COLORS.findIndex(c => c.name.toLowerCase() === String(name).trim().toLowerCase())
  if (index < 0) throw new ToolError(`No color “${name}”; use one of ${GROUP_COLORS.map(c => c.name).join(', ')}.`)
  return index
}

// Undo puts back what the change itself altered, compared just before and just after it: groups made,
// removed or changed, and each session's group, place, name, naming and reminder. Anything changed
// since, by you or by later tool calls, is left as it is.
function snapshot() {
  const { groups, sessions } = getState()
  return { groups, sessions }
}

const SESSION_FIELDS = ['groupId', 'name', 'autoName', 'sorted', 'remind', 'due', 'icon'] as const
const GROUP_FIELDS = ['name', 'color', 'autoName'] as const
const differs = <T, K extends keyof T>(a: T, b: T, fields: readonly K[]) => fields.some(f => JSON.stringify(a[f]) !== JSON.stringify(b[f]))

function announceChange(message: string, before?: Pick<State, 'groups' | 'sessions'>) {
  if (!before) return announce(message)
  const after = snapshot()
  const made = after.groups.filter(g => !before.groups.some(b => b.id === g.id)).map(g => g.id)
  const removed = before.groups.filter(g => !after.groups.some(a => a.id === g.id))
  const changedGroups = before.groups.filter(b => {
    const a = after.groups.find(g => g.id === b.id)
    return a && differs(a, b, GROUP_FIELDS)
  })
  const changedSessions = before.sessions.filter(b => {
    const a = after.sessions.find(x => x.id === b.id)
    return a && (differs(a, b, SESSION_FIELDS) || after.sessions.indexOf(a) !== before.sessions.indexOf(b))
  })
  // Monitors are put back one by one, and only those still where this change left them.
  const monitorIds = [...new Set([...before.groups, ...after.groups].flatMap(g => g.monitors ?? []))]
  const movedMonitors = monitorIds
    .map(id => ({ id, from: paneGroup(before, monitorPane(id)), to: paneGroup(after, monitorPane(id)) }))
    .filter(m => m.from !== m.to)
  announce(message, () => {
    const formerIds = (groupId: string) => viewIds(getState(), { kind: 'group', id: groupId })
    const gone = made.map(id => [id, formerIds(id)] as const)
    const toMove = movedMonitors.filter(m => paneGroup(getState(), monitorPane(m.id)) === m.to)
    setState(s => {
      const groups = [
        ...s.groups.filter(g => !made.includes(g.id)).map(g => {
          const old = changedGroups.find(b => b.id === g.id)
          return old ? { ...g, name: old.name, color: old.color, autoName: old.autoName } : g
        }),
        ...removed.filter(r => !s.groups.some(g => g.id === r.id)).map(r => ({ ...r, monitors: [] })),
      ]
      const restore = (x: Session) => {
        const old = changedSessions.find(b => b.id === x.id)
        if (!old) return x
        const groupId = old.groupId === null || groups.some(g => g.id === old.groupId) ? old.groupId : null
        return { ...x, groupId, name: old.name, autoName: old.autoName, sorted: old.sorted, remind: old.remind, due: old.due, icon: old.icon }
      }
      // Moved sessions go back to their old places; the rest keep the order they have now.
      const moved = changedSessions.map(b => b.id)
      const kept = s.sessions.filter(x => !moved.includes(x.id)).map(restore)
      for (const old of changedSessions) {
        const now = s.sessions.find(x => x.id === old.id)
        if (now) kept.splice(Math.min(before.sessions.indexOf(old), kept.length), 0, restore(now))
      }
      return { groups, sessions: kept }
    })
    for (const m of toMove) moveMonitor(m.id, m.from !== null && getState().groups.some(g => g.id === m.from) ? m.from : null)
    for (const old of changedSessions) renamePane(old.id, getState().sessions.find(x => x.id === old.id)?.name ?? old.name)
    for (const [id, former] of gone) groupRemoved(id, former)
    refreshView()
  })
}

function join(session: Session, groupId: string | null) {
  moveSession(session.id, groupId)
  // Claude placed it, so the automatic sorting leaves it alone.
  updateSession(session.id, { sorted: true })
}

function listSessions(caller: string): ToolResult {
  const s = getState()
  const groups = s.groups.map(g => ({
    id: g.id,
    name: g.name,
    color: GROUP_COLORS[g.color % GROUP_COLORS.length].name,
    sessions: s.sessions.filter(x => x.groupId === g.id).length,
    monitors: monitorList().filter(m => g.monitors?.includes(m.id)).map(m => m.name),
  }))
  const sessions = orderedSessions(s).map(x => ({
    id: x.id,
    name: x.name,
    ...(x.id === caller && { you: true }),
    group: s.groups.find(g => g.id === x.groupId)?.name ?? null,
    status: STATUS[s.status[x.id] ?? 'idle'],
    folder: tilde(x.cwd),
    branch: s.git[x.id]?.branch ?? undefined,
    icon: x.icon,
    claude: !!x.claudeSessionId || undefined,
    reminder: x.remind && { due: formatDue(x.remind.at), note: x.remind.note },
    reminder_came_due: x.due && { at: new Date(x.due.at).toLocaleString(), note: x.due.note },
    last: s.activity[x.id]?.text,
  }))
  return { text: JSON.stringify({ groups, sessions }, null, 1) }
}

function describeSession(session: Session): ToolResult {
  const s = getState()
  const group = s.groups.find(g => g.id === session.groupId)?.name
  const lines = [
    `“${session.name}” (${session.id})${group ? ` in ${group}` : ', in no group'}`,
    `Folder: ${tilde(session.cwd)}${s.git[session.id]?.branch ? `, branch ${s.git[session.id]!.branch}` : ''}`,
    `Status: ${STATUS[s.status[session.id] ?? 'idle']}`,
  ]
  if (!session.claudeSessionId) return { text: [...lines, 'No Claude conversation in it.'].join('\n') }
  return { text: lines.join('\n'), transcript: session.claudeSessionId }
}

function organize(args: Record<string, unknown>, caller: string): ToolResult {
  const specs = Array.isArray(args.groups) ? args.groups : []
  const rename = args.rename && typeof args.rename === 'object' ? Object.entries(args.rename as Record<string, unknown>) : []
  const ungroup = Array.isArray(args.ungroup) ? args.ungroup : []
  // Everything is checked before anything changes, so a mistake leaves the sidebar as it was.
  const plan = specs.map(spec => {
    const g = spec as Record<string, unknown>
    const name = text(g.name, 'A group’s name', 40)
    const existing = getState().groups.find(x => x.name.toLowerCase() === name.toLowerCase())
    const members = (Array.isArray(g.sessions) ? g.sessions : []).map(ref => findSession(ref, caller))
    const monitors = Array.isArray(g.monitors) ? g.monitors.map(findMonitor) : undefined
    return { name, existing, color: colorIndex(g.color), members, monitors }
  })
  const renames = rename.map(([ref, name]) => [findSession(ref, caller), text(name, 'A new name')] as const)
  const outs = ungroup.map(ref => findSession(ref, caller))

  const before = snapshot()
  let moved = 0
  for (const { name, existing, color, members, monitors } of plan) {
    const groupId = existing?.id ?? addGroup()
    updateGroup(groupId, { name, autoName: false, ...(color !== undefined && { color }) })
    if (monitors) {
      for (const id of getState().groups.find(g => g.id === groupId)?.monitors ?? []) moveMonitor(id, null)
      for (const m of monitors) moveMonitor(m.id, groupId)
    }
    for (const s of getState().sessions.filter(x => x.groupId === groupId && !members.some(m => m.id === x.id))) join(s, null)
    for (const m of members) {
      if (getState().sessions.find(x => x.id === m.id)?.groupId !== groupId) moved++
      join(m, groupId)
    }
  }
  for (const s of outs) join(s, null)
  for (const [s, name] of renames) {
    updateSession(s.id, { name, autoName: false })
    renamePane(s.id, name)
  }
  let removed = 0
  if (args.remove_empty_groups === true) {
    for (const g of getState().groups.filter(g => !viewIds(getState(), { kind: 'group', id: g.id }).length)) {
      removeGroup(g.id)
      groupRemoved(g.id, [])
      removed++
    }
  }
  refreshView()
  const parts = [
    plan.length && `${plan.length} group${plan.length === 1 ? '' : 's'}`,
    moved && `${moved} session${moved === 1 ? '' : 's'} moved`,
    renames.length && `${renames.length} renamed`,
    outs.length && `${outs.length} ungrouped`,
    removed && `${removed} empty group${removed === 1 ? '' : 's'} removed`,
  ].filter(Boolean)
  announceChange(`Claude reorganized the sidebar: ${parts.join(', ') || 'nothing changed'}`, before)
  return { text: `Done: ${parts.join(', ') || 'nothing changed'}.` }
}

async function newSession(args: Record<string, unknown>, caller: string): Promise<ToolResult> {
  let folder = text(args.folder, 'The folder', 1000)
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 60) : undefined
  const group = args.group ? findGroup(args.group) : null
  const prompt = typeof args.prompt === 'string' && args.prompt.trim() ? args.prompt : undefined
  const claude = args.claude !== false
  const icon = args.icon === undefined || args.icon === null ? undefined : iconName(args.icon)
  if (prompt && !claude) throw new ToolError('A prompt needs Claude; leave out `claude: false`.')
  const chosen = folder
  if (typeof args.worktree === 'string' && args.worktree.trim()) folder = await window.deck.createWorktree(folder, args.worktree.trim())
  const session: Session = {
    id: newId(),
    name: name ?? baseName(folder),
    cwd: folder,
    groupId: group?.id ?? null,
    runClaude: claude,
    autoName: !name,
    // Claude put it in a group, so the automatic sorting leaves it there.
    sorted: group ? true : undefined,
    firstPrompt: prompt,
    icon,
  }
  setState(s => ({ sessions: [...s.sessions, session] }))
  rememberFolder(chosen)
  // On screen it starts at once; the shell waits for its pane to know its size.
  if (args.show === 'alone') openSession(session.id)
  // Asked from the Today page, it starts behind the page instead of taking the user away from the chat.
  else addToView(session.id, 'right', undefined, caller === TODAY)
  announceChange(`Claude started “${session.name}”${group ? ` in ${group.name}` : ''}`)
  return { text: `Started “${session.name}” (${session.id}) in ${tilde(folder)}${prompt ? ', with your prompt sent to Claude' : ''}.` }
}

function closeSession(args: Record<string, unknown>, caller: string): ToolResult {
  if (args.session === undefined || args.session === null || args.session === '') throw new ToolError('Say which session to end.')
  const session = findSession(args.session, caller)
  if (session.id === caller) {
    // Ended once this reply is back, so the resumed conversation (Undo) has the tool's answer in it.
    setTimeout(() => {
      const current = getState().sessions.find(s => s.id === session.id)
      if (current) endSessionNow(current, true)
    }, 1500)
    return { text: 'This session ends in a moment. Say nothing more.' }
  }
  const status = getState().status[session.id] ?? 'idle'
  if (['working', 'input', 'running'].includes(status) && args.force !== true) {
    throw new ToolError(`“${session.name}” is ${STATUS[status]}. Pass force: true to end it anyway.`)
  }
  endSessionNow(session, true)
  return { text: `Ended “${session.name}”.` }
}

async function sendPrompt(args: Record<string, unknown>, caller: string): Promise<ToolResult> {
  if (args.session === undefined || args.session === null || args.session === '') throw new ToolError('Say which session to send it to.')
  const session = findSession(args.session, caller)
  if (session.id === caller) throw new ToolError('That is the session you are running in.')
  const result = await promptClaude(session.id, typeof args.prompt === 'string' ? args.prompt : '')
  if (!result.sent) throw new ToolError(`Not sent to “${session.name}”: ${result.why}`)
  announce(`Claude sent a prompt to “${session.name}”`)
  return {
    text: result.queued
      ? `Sent to “${session.name}”, which is mid-turn, so Claude Code queues it until that turn ends.`
      : `Sent to “${session.name}”; Claude is working on it.`,
  }
}

/** Resolves true once `done` holds, or false after `ms`. */
function until(done: () => boolean, ms: number) {
  return new Promise<boolean>(resolve => {
    if (done()) return resolve(true)
    const timer = setTimeout(() => finish(false), Math.max(0, ms))
    const stop = subscribe(() => done() && finish(true))
    function finish(result: boolean) {
      clearTimeout(timer)
      stop()
      resolve(result)
    }
  })
}

const WAIT_DEFAULT = 600
const WAIT_MAX = 1800

async function waitFor(args: Record<string, unknown>, caller: string): Promise<ToolResult> {
  if (args.session === undefined || args.session === null || args.session === '') throw new ToolError('Say which session to wait for.')
  const session = findSession(args.session, caller)
  if (session.id === caller) throw new ToolError('That is the session you are running in.')
  const seconds = Math.min(WAIT_MAX, Math.max(5, typeof args.timeout_seconds === 'number' ? args.timeout_seconds : WAIT_DEFAULT))
  const deadline = Date.now() + seconds * 1000
  const statusOf = () => (getState().sessions.some(s => s.id === session.id) ? getState().status[session.id] ?? 'idle' : 'ended')
  // A prompt sent a moment ago may not have started its turn yet.
  if (statusOf() !== 'working') await until(() => ['working', 'input', 'ended'].includes(statusOf()), Math.min(15_000, seconds * 1000))
  await until(() => statusOf() !== 'working', deadline - Date.now())
  const status = statusOf()
  if (status === 'ended') return { text: `“${session.name}” was ended.` }
  if (status === 'working') return { text: `“${session.name}” is still working after ${seconds} seconds.` }
  const said = getState().activity[session.id]?.text
  const line = `“${session.name}”: ${STATUS[status as SessionState]}.`
  if (status === 'input') return { text: `${line} It asks: ${said ?? 'something the user has to answer'}. The user has to answer it in that session.` }
  const reply = lastReply(session.id) ?? said
  return { text: reply ? `${line} Claude's reply:\n\n${reply}` : line }
}

function findNote(ref: unknown): Note {
  const name = text(ref, 'The to-do', 500)
  const { notes } = getState()
  const found = notes.find(n => n.id === name) ?? notes.filter(n => n.text.toLowerCase() === name.toLowerCase())[0]
  if (!found) throw new ToolError(`No to-do “${short(name)}”; list_notes shows them with their ids.`)
  return found
}

const WHEN = 'Give `in_minutes` above 0, or `at` as a local time that hasn’t passed, like 2026-10-13T09:00.'

/** The time `in_minutes` or `at` gives, or undefined when neither is given. */
function remindAt(args: Record<string, unknown>) {
  if (args.in_minutes === undefined && args.at === undefined) return undefined
  const at = typeof args.in_minutes === 'number' ? Date.now() + args.in_minutes * 60_000 : typeof args.at === 'string' ? new Date(args.at).getTime() : NaN
  if (!Number.isFinite(at) || at <= Date.now()) throw new ToolError(WHEN)
  return at
}

/** What each repository is called while the user hasn't named it. */
function unnamedProjects() {
  const status = statusState()
  return resolveProjects(getState(), knownRepos(), {}, status.data, status.journal)
}

function listProjects(): ToolResult {
  const projects = currentProjects()
  if (!projects.list.length) return { text: 'No projects yet: none of the sessions, pull requests, issues or prompts this week is in a GitHub repository.' }
  const names = statusState().settings?.projects ?? {}
  const unnamed = unnamedProjects()
  const sessions = getState().sessions.filter(x => !x.demo)
  return {
    text: JSON.stringify(projects.list.map(p => ({
      name: p.name,
      sessions: sessions.filter(x => projects.session(x.id) === p.name).map(x => x.name),
      repos: p.repos.map(repo => ({
        repo,
        named: names[repo] ? 'by the user' : unnamed.repo(repo) === repo.split('/')[1] ? 'after the repository' : 'after its sidebar group',
      })),
    })), null, 1),
  }
}

async function setProjects(args: Record<string, unknown>): Promise<ToolResult> {
  if (isDemo(getState())) throw new ToolError('Not on the demo day.')
  if (!args.projects || typeof args.projects !== 'object') throw new ToolError('Give `projects`: repository → project name, or null.')
  const known = currentProjects().list.flatMap(p => p.repos)
  const repoFor = (ref: string) => {
    const exact = known.find(r => r.toLowerCase() === ref.toLowerCase())
    if (exact) return exact
    const named = known.filter(r => r.split('/')[1]?.toLowerCase() === ref.toLowerCase())
    if (named.length === 1) return named[0]
    if (named.length > 1) throw new ToolError(`More than one repository is called ${ref}: ${named.join(', ')}. Give owner/name.`)
    if (/^[\w.-]+\/[\w.-]+$/.test(ref)) return ref
    throw new ToolError(`No repository ${ref} on the Today page; list_projects shows them.`)
  }
  const before = { ...(await window.deck.statusSettings()).projects }
  const next = { ...before }
  const unnamed = unnamedProjects()
  for (const [ref, value] of Object.entries(args.projects as Record<string, unknown>)) {
    const repo = repoFor(ref)
    if (value === null || value === '') delete next[repo]
    else if (typeof value === 'string') {
      const name = text(value, 'A project name', 40)
      if (name === unnamed.repo(repo)) delete next[repo]
      else next[repo] = name
    } else throw new ToolError(`The name for ${ref} must be text or null.`)
  }
  settingsChanged(await window.deck.saveStatusSettings({ projects: next }))
  announce('Claude changed your projects', async () => settingsChanged(await window.deck.saveStatusSettings({ projects: before })))
  // The names take effect at once; the list is what the page shows now.
  return { text: `Done. ${listProjects().text}` }
}

function listNotes(done: boolean): ToolResult {
  const notes = getState().notes.filter(n => done || !n.done)
  if (!notes.length) return { text: done ? 'No to-dos.' : 'No open to-dos.' }
  const sessions = getState().sessions
  return {
    text: JSON.stringify(notes.map(n => ({
      id: n.id,
      text: n.text,
      ...(n.done && { done: new Date(n.done).toLocaleString() }),
      added: `${new Date(n.created).toLocaleString()} by ${n.by === 'claude' ? 'Claude' : 'the user'}`,
      issue: n.issue,
      session: sessions.find(x => x.id === n.session)?.name,
      ...(n.remind && { reminder: new Date(n.remind).toLocaleString() }),
      ...(n.due && { reminder_came_due: new Date(n.due).toLocaleString() }),
    })), null, 1),
  }
}

/** A pull request named as owner/repo#123 or by its URL, as the Today page knows it when it does. */
function findPr(ref: unknown): StatusPr {
  const name = text(ref, 'The pull request', 300)
  const m = name.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/) ?? name.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/)
  if (!m) throw new ToolError(`“${name}” isn't a pull request; give owner/repo#123 or its URL.`)
  const [repo, number] = [m[1], Number(m[2])]
  const gh = githubOk(statusState().data?.github)
  const known = gh && [...gh.review, ...gh.mine, ...gh.merged, ...gh.reviewed].find(p => p.repo.toLowerCase() === repo.toLowerCase() && p.number === number)
  // One the page doesn't list can still be reviewed; the prompt just goes without its title.
  return known || ({ id: `pr:${repo}#${number}`, repo, number, title: '', url: `https://github.com/${repo}/pull/${number}`, author: null, branch: null } as unknown as StatusPr)
}

function findIssue(ref: unknown): StatusIssue {
  const name = text(ref, 'The issue', 40).toUpperCase()
  const lin = linearOk(statusState().data?.linear)
  if (!lin) throw new ToolError('Linear isn’t connected, or didn’t answer; the user connects it in the Today page’s Settings.')
  const issue = [...lin.open, ...lin.done].find(i => i.identifier.toUpperCase() === name)
  if (!issue) throw new ToolError(`${name} isn’t among the user’s issues; get_status lists them.`)
  return issue
}

function findMonitor(ref: unknown): MonitorSummary {
  const name = text(ref, 'The monitor', 100)
  const list = monitorList()
  const byId = list.find(m => m.id === name)
  if (byId) return byId
  const named = list.filter(m => m.name.toLowerCase() === name.toLowerCase())
  if (named.length === 1) return named[0]
  throw new ToolError(named.length ? `More than one monitor is called “${name}”; give its id.` : `No monitor “${name}”; list_monitors shows them.`)
}

const MONITOR_STATE: Record<MonitorState, string> = {
  approval: 'waiting for the user to allow its commands',
  done: 'finished (a done rule fired, or it expired); resuming starts it again',
  paused: 'paused',
  alert: 'alert',
  warn: 'warning',
  error: 'a command is failing',
  ok: 'ok',
  pending: 'not run yet',
}

async function saveMonitor(args: Record<string, unknown>, caller: string): Promise<ToolResult> {
  const { monitor: ref, group: groupRef, ...input } = args
  const existing = ref === undefined || ref === null || ref === '' ? undefined : findMonitor(ref)
  const group = groupRef === undefined || groupRef === null || groupRef === '' ? undefined : findGroup(groupRef)
  const self = getState().sessions.find(s => s.id === caller)
  if (!existing && !self && !input.folder) throw new ToolError('Say which folder its commands run in, with `folder`.')
  const wakes = Array.isArray(input.rules) && input.rules.some(r => r && typeof r === 'object' && (r as { prompt?: unknown }).prompt)
  if (wakes && !self && !existing?.by) throw new ToolError('A rule’s prompt wakes Claude in the session that saved the monitor, and you aren’t in one; leave prompts out or save it from a session.')
  const result = await window.deck.saveMonitor(input, { replace: existing?.id, by: self?.id, folder: self?.cwd })
  await refreshMonitors()
  if (result.errors) throw new ToolError(`Not saved. Fix these and send the whole monitor again:\n- ${result.errors.join('\n- ')}`)
  const { id, previous, pending } = result
  const name = typeof input.name === 'string' ? input.name.trim() : 'monitor'
  const formerGroup = paneGroup(getState(), monitorPane(id))
  if (group) {
    moveMonitor(id, group.id)
    refreshView()
  }
  // Undo takes it back out of the group it was put in, unless it has been moved since.
  const ungroup = () => {
    if (!group || paneGroup(getState(), monitorPane(id)) !== group.id) return
    moveMonitor(id, result.created ? null : formerGroup)
    refreshView()
  }
  const place = group ? `in the sidebar with the group ${group.name}` : formerGroup ? 'in the sidebar with its group' : 'in the sidebar under Monitors'
  if (result.created) {
    announce(`Claude made the monitor “${name}”`, () => {
      ungroup()
      window.deck.removeMonitor(id)
    })
  } else {
    announce(`Claude changed the monitor “${name}”`, () => {
      ungroup()
      if (previous) window.deck.saveMonitor(previous, { replace: id, restore: true })
    })
  }
  const waiting = pending.length
    ? `Nothing runs until the user presses Allow on its page; ${pending.join(', ')} ${pending.length === 1 ? 'is' : 'are'} waiting. Tell them, and once they have, call get_monitor with run: true to check what the panels get.`
    : 'Its commands were allowed before, so they run on schedule now; call get_monitor with run: true to check what the panels get.'
  return { text: `Saved “${name}” (${id}); it's ${place}. ${waiting}` }
}

function listMonitors(): ToolResult {
  const list = monitorList()
  if (!list.length) return { text: 'No monitors.' }
  const { groups } = getState()
  return {
    text: JSON.stringify(list.map(m => ({
      id: m.id,
      name: m.name,
      group: groups.find(g => g.id === paneGroup(getState(), monitorPane(m.id)))?.name ?? null,
      state: MONITOR_STATE[m.state],
      firing: m.firing.length ? m.firing.map(f => `${f.name} (${f.level})`) : undefined,
      snoozed: Object.keys(m.snoozed).length ? Object.keys(m.snoozed).length : undefined,
      waiting_for_allow: m.pending.length ? m.pending : undefined,
      last_run: m.lastRun ? new Date(m.lastRun).toLocaleString() : undefined,
      error: m.error,
    })), null, 1),
  }
}

const HOUR = 3_600_000

function since(text: string) {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d)$/)
  return m ? Number(m[1]) * { m: 60_000, h: HOUR, d: 24 * HOUR }[m[2] as 'm' | 'h' | 'd'] : 0
}

/** A source's history over a time, as Claude reviews it: each number's range and trend, and the points if asked. */
function review(history: MonitorDetail['sources'][string]['history'], points: boolean, time: (t: number) => string) {
  if (!history.length) return { runs: 0 }
  const fields = [...new Set(history.flatMap(h => Object.keys(h.v ?? {})))]
  const round = (n: number) => Math.round(n * 1000) / 1000
  const stats = Object.fromEntries(fields.map(f => {
    const seen = history.filter(h => typeof h.v?.[f] === 'number').map(h => ({ t: h.t, v: h.v![f] }))
    if (!seen.length) return [f, null]
    const low = seen.reduce((a, b) => (b.v < a.v ? b : a))
    const high = seen.reduce((a, b) => (b.v > a.v ? b : a))
    return [f, {
      min: low.v, min_at: time(low.t), max: high.v, max_at: time(high.t),
      avg: round(seen.reduce((sum, p) => sum + p.v, 0) / seen.length),
      first: seen[0].v, last: seen[seen.length - 1].v,
    }]
  }))
  const step = Math.max(1, Math.ceil(history.length / 300))
  return {
    runs: history.length,
    failed: history.filter(h => !h.ok).length,
    from: time(history[0].t),
    to: time(history[history.length - 1].t),
    stats,
    ...(points && { points: history.filter((_, i) => i % step === 0 || i === history.length - 1).map(h => ({ at: time(h.t), ...(h.ok ? h.v : { failed: true }) })) }),
  }
}

const clipValue = (v: MonitorValue) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v)

async function getMonitor(args: Record<string, unknown>): Promise<ToolResult> {
  const monitor = findMonitor(args.monitor)
  if (args.run === true) {
    if (monitor.pending.length) throw new ToolError(`The user hasn't allowed ${monitor.pending.join(', ')} yet, so nothing runs; ask them to press Allow on the monitor's page.`)
    await window.deck.runMonitor(monitor.id)
    await refreshMonitors()
  }
  const detail = await window.deck.monitor(monitor.id)
  if (!detail) throw new ToolError('That monitor is gone.')
  const { spec, summary } = detail
  const time = (t: number) => new Date(t).toLocaleString()
  const window_ = typeof args.since === 'string' ? since(args.since) : HOUR
  if (!window_) throw new ToolError('`since` is a duration like "30m", "6h" or "1d".')
  const from = Date.now() - window_
  const sources = Object.fromEntries(Object.entries(spec.sources).map(([name, source]) => {
    const data = detail.sources[name]
    const latest = data.latest
    return [name, {
      allowed: data.approved,
      last_run: latest && { at: time(latest.t), ok: latest.ok, ms: latest.ms, error: latest.error, rows: latest.ok ? latest.total : undefined },
      fields: data.rows.length ? [...new Set(data.rows.slice(0, 20).flatMap(r => Object.keys(r)))] : undefined,
      rows: data.rows.length ? data.rows.slice(0, 10).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clipValue(v)]))) : undefined,
      history: data.history.length ? review(data.history.filter(h => h.t >= from), args.points === true, time) : undefined,
      keeps: source.keep ?? '24h',
      every: source.every,
    }]
  }))
  const rules = spec.rules.map(r => {
    const state = detail.rules[r.id]
    const snoozed = summary.snoozed[r.id]
    return {
      name: r.name, level: r.level, firing: !!state?.firing, value: state?.value, since: state?.firing && state.since ? time(state.since) : undefined,
      snoozed: snoozed === undefined ? undefined : snoozed === 'clear' ? 'until it clears' : `until ${time(snoozed)}`,
      says: state?.message, groups: state?.keys, last_new: state?.last && { at: time(state.last.t), count: state.last.count },
    }
  })
  // Rows a command printed can say anything; they stay values here, as the rows above do.
  const events = detail.events.filter(e => e.t >= from).slice(-100).map(e => ({
    at: time(e.t), what: e.kind, rule: e.name, source: e.source, level: e.level, says: clipValue(e.text), count: e.count, groups: e.keys, snoozed: e.snoozed,
  }))
  const { id: _id, by: _by, created: _created, updated: _updated, ...rest } = spec
  const body = JSON.stringify({
    id: spec.id,
    name: spec.name,
    state: MONITOR_STATE[summary.state],
    finished: summary.done && { at: time(summary.done.at), why: summary.done.why },
    stops_at: summary.expiresAt ? time(summary.expiresAt) : undefined,
    problems: detail.problems.length ? detail.problems : undefined,
    sources,
    rules: rules.length ? rules : undefined,
    happened: events.length ? events : undefined,
    page_last_looked_at: detail.lookedAt ? time(detail.lookedAt) : undefined,
    spec: { ...rest, rules: spec.rules.map(({ id: _rid, ...r }) => r) },
  }, null, 1)
  return { text: body.length > 40_000 ? `${body.slice(0, 40_000)}\n… (cut)` : body }
}

/** A session started for Claude goes beside what's on screen, or behind the Today page for its chat. */
const placement = (caller: string) => (caller === TODAY ? 'behind' : 'beside')

async function started(result: Awaited<ReturnType<typeof reviewWithClaude>>, what: string): Promise<ToolResult> {
  if (result.error !== undefined) throw new ToolError(result.error)
  return { text: `Started ${what} in ${tilde(result.folder)} (session ${result.id}); Claude is on it.` }
}

async function run(caller: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (tool) {
    case 'list_sessions':
      return listSessions(caller)
    case 'describe_session':
      return describeSession(findSession(args.session, caller))
    case 'rename_session': {
      const session = findSession(args.session, caller)
      const name = text(args.name, 'The name', 60)
      const before = snapshot()
      updateSession(session.id, { name, autoName: false })
      renamePane(session.id, name)
      announceChange(`Claude renamed “${session.name}” to “${name}”`, before)
      return { text: `Renamed to “${name}”.` }
    }
    case 'set_session_icon': {
      const session = findSession(args.session, caller)
      const icon = args.icon === null || args.icon === '' ? undefined : iconName(args.icon)
      const before = snapshot()
      updateSession(session.id, { icon })
      announceChange(icon ? `Claude gave “${session.name}” an icon` : `Claude removed the icon of “${session.name}”`, before)
      return { text: icon ? `“${session.name}” now has the ${icon} icon.` : 'Icon removed.' }
    }
    case 'move_session': {
      const session = findSession(args.session, caller)
      const group = args.group === null ? null : findGroup(args.group)
      const before = snapshot()
      join(session, group?.id ?? null)
      refreshGroupView()
      announceChange(group ? `Claude moved “${session.name}” to ${group.name}` : `Claude took “${session.name}” out of its group`, before)
      return { text: group ? `Moved to ${group.name}.` : 'Now in no group.' }
    }
    case 'create_group': {
      const name = text(args.name, 'The name', 40)
      const color = colorIndex(args.color)
      const members = (Array.isArray(args.sessions) ? args.sessions : []).map(ref => findSession(ref, caller))
      const monitors = (Array.isArray(args.monitors) ? args.monitors : []).map(findMonitor)
      const before = snapshot()
      const id = addGroup()
      updateGroup(id, { name, autoName: false, ...(color !== undefined && { color }) })
      members.forEach(m => join(m, id))
      monitors.forEach(m => moveMonitor(m.id, id))
      refreshView()
      const what = [
        members.length && `${members.length} session${members.length === 1 ? '' : 's'}`,
        monitors.length && `${monitors.length} monitor${monitors.length === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' and ')
      announceChange(`Claude made the group ${name}${what ? ` with ${what}` : ''}`, before)
      return { text: `Made “${name}” (${id}).` }
    }
    case 'update_group': {
      const group = findGroup(args.group)
      const name = args.name === undefined ? undefined : text(args.name, 'The name', 40)
      const color = colorIndex(args.color)
      const before = snapshot()
      updateGroup(group.id, { ...(name && { name, autoName: false }), ...(color !== undefined && { color }) })
      announceChange(`Claude changed the group ${name ?? group.name}`, before)
      return { text: 'Done.' }
    }
    case 'delete_group': {
      const group = findGroup(args.group)
      const former = getState().sessions.filter(s => s.groupId === group.id).map(s => s.id)
      const monitors = viewIds(getState(), { kind: 'group', id: group.id }).filter(id => !former.includes(id))
      const before = snapshot()
      removeGroup(group.id)
      groupRemoved(group.id, [...former, ...monitors])
      announceChange(`Claude removed the group ${group.name}`, before)
      return { text: `Removed “${group.name}”; its ${former.length} session${former.length === 1 ? ' is' : 's are'} in no group now${monitors.length ? `, and its monitors are under Monitors` : ''}.` }
    }
    case 'organize':
      return organize(args, caller)
    case 'remind': {
      const at = remindAt(args)
      if (at === undefined) throw new ToolError(WHEN)
      if (args.todo !== undefined) {
        const todo = findNote(args.todo)
        const { remind, due } = todo
        setNoteReminder(todo.id, at)
        announce(`Claude set a reminder for “${short(todo.text)}”, ${formatDue(at)}`, () => updateNote(todo.id, { remind, due }))
        return { text: `Reminder set for the to-do “${short(todo.text)}”, due ${formatDue(at)} (${new Date(at).toLocaleString()}).` }
      }
      const session = findSession(args.session, caller)
      const note = typeof args.note === 'string' ? args.note : undefined
      const before = snapshot()
      setReminder(session.id, at, note)
      const due = formatDue(at)
      announceChange(`Claude set a reminder for “${session.name}”, ${due}`, before)
      return { text: `Reminder set for “${session.name}”, due ${due} (${new Date(at).toLocaleString()}).` }
    }
    case 'cancel_reminder': {
      if (args.todo !== undefined) {
        const todo = findNote(args.todo)
        const { remind, due } = todo
        if (!remind && !due) return { text: `“${short(todo.text)}” has no reminder.` }
        cancelNoteReminder(todo.id)
        announce(`Claude cancelled the reminder for “${short(todo.text)}”`, () => updateNote(todo.id, { remind, due }))
        return { text: 'Cancelled; the to-do stays.' }
      }
      const session = findSession(args.session, caller)
      if (!session.remind && !session.due) return { text: `“${session.name}” has no reminder.` }
      const before = snapshot()
      cancelReminder(session.id)
      finishReminder(session.id)
      announceChange(`Claude cancelled the reminder for “${session.name}”`, before)
      return { text: 'Cancelled.' }
    }
    case 'new_session':
      return newSession(args, caller)
    case 'review_pr': {
      if (isDemo(getState())) throw new ToolError('Not on the demo day.')
      const pr = findPr(args.pr)
      return started(await reviewWithClaude(pr, placement(caller)), `a review of ${pr.repo}#${pr.number}`)
    }
    case 'start_issue': {
      if (isDemo(getState())) throw new ToolError('Not on the demo day.')
      const issue = findIssue(args.issue)
      const folder = typeof args.folder === 'string' && args.folder ? args.folder : lastIssueFolder(issue)
      if (!folder) {
        const known = knownFolders().slice(0, 8).map(tilde).join(', ')
        throw new ToolError(`Say which repository folder to start ${issue.identifier} in${known ? `, such as ${known}` : ''}.`)
      }
      return started(await startIssueIn(issue, folder, placement(caller)), issue.identifier)
    }
    case 'close_session':
      return closeSession(args, caller)
    case 'send_prompt':
      return sendPrompt(args, caller)
    case 'wait_for':
      return waitFor(args, caller)
    case 'add_note': {
      const body = text(args.text, 'The to-do', 500)
      const session = args.session === null || (args.session === undefined && caller === TODAY) ? undefined : findSession(args.session, caller)
      const at = remindAt(args)
      const note = addNote(body, { by: 'claude', issue: typeof args.issue === 'string' ? args.issue : undefined, session: session?.id })
      if (at) setNoteReminder(note.id, at)
      announce(`Claude added the to-do “${short(note.text)}”${at ? `, ${formatDue(at)}` : ''}`, () => dropNote(note.id))
      return { text: `Added to the user's Today page (${note.id})${note.issue ? `, about ${note.issue}` : ''}${at ? `, with a reminder ${formatDue(at)} (${new Date(at).toLocaleString()})` : ''}.` }
    }
    case 'list_notes':
      return listNotes(args.done === true)
    case 'complete_note': {
      const note = findNote(args.note)
      const done = args.done !== false
      setNoteDone(note.id, done)
      announce(`Claude ${done ? 'checked off' : 'unchecked'} “${short(note.text)}”`, () => setNoteDone(note.id, !done))
      return { text: done ? 'Checked off.' : 'Unchecked.' }
    }
    case 'remove_note': {
      const note = findNote(args.note)
      removeNote(note.id, 'claude')
      return { text: 'Removed.' }
    }
    case 'get_status':
      return { text: await statusText() }
    case 'list_projects':
      return listProjects()
    case 'set_projects':
      return setProjects(args)
    case 'save_monitor':
      return saveMonitor(args, caller)
    case 'list_monitors':
      return listMonitors()
    case 'get_monitor':
      return getMonitor(args)
    case 'pause_monitor': {
      const monitor = findMonitor(args.monitor)
      const paused = args.paused !== false
      if (monitor.paused === paused) return { text: `“${monitor.name}” is ${paused ? 'paused' : 'running'} already.` }
      await setPaused(monitor, paused, true)
      await refreshMonitors()
      return { text: paused ? 'Paused.' : 'Resumed.' }
    }
    case 'move_monitor': {
      const monitor = findMonitor(args.monitor)
      const group = args.group === null ? null : findGroup(args.group)
      const before = snapshot()
      moveMonitor(monitor.id, group?.id ?? null)
      refreshView()
      announceChange(group ? `Claude moved “${monitor.name}” to ${group.name}` : `Claude took “${monitor.name}” out of its group`, before)
      return { text: group ? `Moved to ${group.name}.` : 'Now under Monitors, in no group.' }
    }
    case 'remove_monitor': {
      const monitor = findMonitor(args.monitor)
      await removeMonitor(monitor, true)
      await refreshMonitors()
      return { text: `Removed “${monitor.name}”.` }
    }
    case 'show_sessions': {
      const sessions = (Array.isArray(args.sessions) ? args.sessions : []).map(ref => findSession(ref, caller))
      const monitors = (Array.isArray(args.monitors) ? args.monitors : []).map(findMonitor)
      if (!sessions.length && !monitors.length) throw new ToolError('Give at least one session or monitor.')
      if (sessions.length === 1 && !monitors.length) openSession(sessions[0].id)
      else {
        closePage()
        show({ kind: 'pick', ids: [...sessions.map(s => s.id), ...monitors.map(m => monitorPane(m.id))] })
      }
      return { text: `On screen: ${[...sessions, ...monitors].map(x => `“${x.name}”`).join(', ')}.` }
    }
  }
  throw new ToolError(`Own Term has no tool ${tool}.`)
}

window.deck.onToolCall(async (requestId, caller, tool, args) => {
  let result: ToolResult
  try {
    result = await run(caller, tool, args ?? {})
  } catch (error) {
    result = { text: error instanceof ToolError ? error.message : `It failed: ${(error as Error).message}`, isError: true }
  }
  window.deck.toolResult(requestId, result)
})
