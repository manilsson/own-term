import { useSyncExternalStore } from 'react'
import { announce, getState, newId, orderedSessions, rememberFolder, setState, type Note, type Session, type SessionState, type State } from './store'
import { addToView, openPage, openSession } from './workspace'
import { DEMO_NOTES, demoBrief, demoData, demoJournal, demoStandup } from './demo-status'
import { currentProjects, learnRepos, selectedProject } from './projects'

// The status page's state (StatusPage.tsx): pull requests and Linear issues from main, kept fresh in
// the background so the sidebar's Today tile can count them; Claude's brief and standup; and the
// journal, written here as prompts and replies happen (claude.ts calls record).

interface Summary<T> {
  value?: T
  at?: number
  writing: boolean
  error?: string
}

interface StatusState {
  data: StatusData | null
  collecting: boolean
  settings: StatusSettings | null
  /** By project name, '' for the one about everything. */
  brief: Record<string, Summary<Brief>>
  standup: Record<string, Summary<Standup>>
  journal: JournalEntry[] | null
  journalLoading: boolean
}

let state: StatusState = {
  data: null,
  collecting: false,
  settings: null,
  brief: {},
  standup: {},
  journal: null,
  journalLoading: false,
}
const listeners = new Set<() => void>()

function set(patch: Partial<StatusState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export const statusState = () => state

const NONE: Summary<never> = { writing: false }
/** A project's brief or standup ('' for everything's), as far as it's known. */
export const summaryOf = <K extends 'brief' | 'standup'>(s: StatusState, kind: K, project = ''): StatusState[K][string] => (s[kind][project] ?? NONE) as StatusState[K][string]

export function useStatus<T>(select: (s: StatusState) => T): T {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => select(state),
  )
}

// ── Data ──────────────────────────────────────────────────────────────────────────────────────

const home = window.deck.homeDir
export const tilde = (path: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
export const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** The folders worth looking in for clones: where sessions run and were started, worktrees left out. */
export function knownFolders() {
  const s = getState()
  // The journal remembers folders Claude worked in that no open session is in any more.
  const journaled = (state.journal ?? []).map(e => e.folder).filter((f): f is string => !!f)
  const folders = [...s.sessions.filter(x => !x.demo).map(x => x.cwd), ...s.recentFolders, s.lastCwd, ...new Set(journaled)]
  return [...new Set(folders.filter(f => f && !f.includes('/.claude/worktrees/')))]
}

/** The demo day is on screen (only its sessions are open), so the page shows its invented day. */
export const isDemo = (s: Pick<State, 'sessions'>) => s.sessions.length > 0 && s.sessions.every(x => x.demo)
/** To-dos as the page shows them: the demo day's own while it's loaded. */
export const visibleNotes = (s: Pick<State, 'sessions' | 'notes'>) => (isDemo(s) ? DEMO_NOTES : s.notes)

// Set while the page shows the demo day's data, so real data replaces it once the demo is gone.
let showingDemo = false

function showDemo() {
  showingDemo = true
  set({
    data: demoData(),
    settings: { ...(state.settings ?? DEMO_SETTINGS), ai: true, linear: { connected: true, user: { name: 'Sam', org: 'Juniper' }, teams: [], selected: [] }, github: { login: 'sam' } },
    brief: { '': { ...demoBrief(), writing: false } },
    standup: { '': { ...demoStandup(), writing: false } },
    journal: demoJournal(),
  })
}

const DEMO_SETTINGS: StatusSettings = {
  ai: true, model: 'sonnet', instructions: '', reviewPrompt: '', prScope: 'all', mutedRepos: [], projects: {}, pings: true, linear: { connected: false }, github: null,
}

async function leaveDemo() {
  showingDemo = false
  set({ data: null, journal: null, brief: {}, standup: {} })
  await Promise.all([loadSettings(), loadSummaries('')])
}

/** A project's brief and standup as last written, read once. */
export async function loadSummaries(project: string) {
  if (state.brief[project] && state.standup[project]) return
  const { brief, standup } = await window.deck.cachedSummaries(project || undefined)
  // One being written meanwhile is newer than what was on disk.
  set({
    brief: { ...state.brief, [project]: state.brief[project] ?? { writing: false, ...(brief && { value: brief.value, at: brief.at }) } },
    standup: { ...state.standup, [project]: state.standup[project] ?? { writing: false, ...(standup && { value: standup.value, at: standup.at }) } },
  })
}

let collecting: Promise<void> | null = null
/** Asks main for pull requests and issues; it caches them for two minutes unless forced. */
export function collect(force = false) {
  if (isDemo(getState())) {
    showDemo()
    return Promise.resolve()
  }
  collecting ??= (async () => {
    if (showingDemo) await leaveDemo()
    set({ collecting: true })
    try {
      learnRepos(getState().sessions.filter(x => !x.demo).map(x => x.cwd))
      const data = await window.deck.collectStatus({ folders: knownFolders(), force })
      set({ data, settings: await window.deck.statusSettings() })
    } catch {}
    set({ collecting: false })
  })().finally(() => (collecting = null))
  return collecting
}

export async function loadSettings() {
  set({ settings: await window.deck.statusSettings() })
}

export function settingsChanged(settings: StatusSettings) {
  set({ settings })
  collect(true)
}

// Fresh enough for the sidebar's counts without asking GitHub more than every few minutes.
setTimeout(() => {
  loadSettings()
  collect()
  loadSummaries('')
  setInterval(() => !document.hidden && collect(), 5 * 60_000)
}, 4000)

// ── Claude's summaries ────────────────────────────────────────────────────────────────────────

const WORDS: Record<SessionState, string> = {
  idle: 'idle',
  running: 'running a command',
  working: 'Claude is working',
  input: 'waiting for the user to answer a question or permission',
  done: 'Claude finished, waiting for the user',
  reminder: 'a reminder came due',
  exited: 'shell exited',
}

/** What the window knows that the brief needs: sessions, what they're doing, reminders and to-dos; for a project, only its own. */
export function snapshot(project?: ProjectDef): StatusSnapshot {
  const s = getState()
  const projects = currentProjects()
  const ours = (name: string | undefined) => !project || name === project.name
  return {
    user: window.deck.userName(),
    ...(project ? { project } : { projects: projects.list }),
    sessions: orderedSessions(s).filter(x => !x.demo && ours(projects.session(x.id))).map(x => {
      const git = s.git[x.id]
      const status = s.status[x.id] ?? 'idle'
      return {
        id: x.id,
        name: x.name,
        group: s.groups.find(g => g.id === x.groupId)?.name,
        status: WORDS[status],
        since: s.needsSince[x.id] ?? (status === 'working' ? s.activity[x.id]?.since : undefined),
        folder: x.cwd,
        branch: git?.branch,
        changes: git && (git.added || git.removed || git.untracked) ? `+${git.added} −${git.removed}${git.untracked ? `, ${git.untracked} new files` : ''}` : undefined,
        last: s.activity[x.id]?.text,
        claude: x.claudeSessionId,
        remind: x.remind,
        due: x.due,
      }
    }),
    notes: s.notes.filter(n => ours(projects.note(n))).map(n => ({ id: n.id, text: n.text, created: n.created, done: n.done, by: n.by, issue: n.issue, session: n.session, remind: n.remind, due: n.due })),
  }
}

/** Has Claude write the brief or standup of the project the page shows, or of everything. */
export async function write(kind: 'brief' | 'standup', project = selectedProject()) {
  if (isDemo(getState())) return showDemo()
  const key = project?.name ?? ''
  const change = (next: Summary<Brief | Standup>) => set({ [kind]: { ...state[kind], [key]: next } })
  const was = summaryOf(state, kind, key)
  if (was.writing) return
  change({ ...was, writing: true, error: undefined })
  const result = await window.deck.writeSummary(kind, snapshot(project)).catch((error: Error) => ({ error: error.message }))
  const now = summaryOf(state, kind, key)
  change(result.error !== undefined ? { ...now, writing: false, error: result.error } : { value: result.value, at: result.at, writing: false })
}

const today = () => new Date().setHours(0, 0, 0, 0)

/**
 * Shows what's written about the page's project and, the first time it's shown each day, has Claude
 * write it anew: the brief on Today, and on the Week a project's standup (everything's is asked for).
 */
export async function freshen(tab: 'today' | 'week') {
  if (isDemo(getState())) return
  const project = selectedProject()
  const key = project?.name ?? ''
  await loadSummaries(key)
  if (!state.settings?.ai || (tab === 'week' && !project)) return
  const kind = tab === 'today' ? 'brief' : 'standup'
  const { at, writing, error } = summaryOf(state, kind, key)
  if (!writing && !error && (!at || at < today())) write(kind, project)
}

/** Opens the page with what it needs fresh. */
export async function showStatus() {
  openPage()
  if (isDemo(getState())) return showDemo()
  if (showingDemo) await leaveDemo()
  if (!state.settings) await loadSettings()
  if (!state.data || Date.now() - state.data.at > 60_000) await collect()
  if (!state.journal) loadJournal()
  freshen(localStorage.getItem('deckterm.statusTab') === 'week' ? 'week' : 'today')
}

/** Pull requests and issues asked for again, then a new brief. */
export async function refreshAll() {
  await collect(true)
  if (state.settings?.ai) write('brief')
}

export async function loadJournal() {
  if (isDemo(getState())) return showDemo()
  if (state.journalLoading) return
  set({ journalLoading: true })
  const journal = await window.deck.journal(7).catch(() => [])
  set({ journal, journalLoading: false })
}

// ── The journal ───────────────────────────────────────────────────────────────────────────────

/** Keeps a prompt typed to Claude, or its reply, for briefs and standups. */
export function record(id: string, kind: 'prompt' | 'reply', text?: string) {
  const s = getState()
  const session = s.sessions.find(x => x.id === id)
  // A bare slash command like /clear says nothing about the work.
  if (!session || session.demo || !text?.trim() || /^\/\S*$/.test(text.trim())) return
  window.deck.addToJournal({
    kind,
    session: id,
    name: session.name,
    group: s.groups.find(g => g.id === session.groupId)?.name,
    folder: session.cwd,
    branch: s.git[id]?.branch,
    claude: session.claudeSessionId,
    text,
  })
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REVIEW = 'Review pull request #{number} in {repo}, “{title}” ({url}). It is checked out here. Compare it with its base branch and report the problems worth fixing, most important first.'

/** Where a started session goes: alone (the page's buttons), beside what's on screen, or behind the Today page. */
export type Placement = 'alone' | 'beside' | 'behind'

function startSession(session: Omit<Session, 'id' | 'groupId'>, placement: Placement) {
  const id = newId()
  setState(s => ({ sessions: [...s.sessions, { ...session, id, groupId: null }] }))
  if (placement === 'alone') openSession(id)
  else addToView(id, 'right', undefined, placement === 'behind')
  return id
}

const errorText = (error: unknown) => String((error as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A pull request checked out in a worktree of your clone, with Claude asked to review it there. */
export async function reviewWithClaude(pr: StatusPr, placement: Placement = 'alone'): Promise<Started> {
  const clones = await window.deck.repoFolders(pr.repo, knownFolders())
  if (!clones.length) return failed(`No clone of ${pr.repo} in your folders; start a session in one first`)
  announce(`Checking out #${pr.number} from ${pr.repo}…`)
  let folder: string
  try {
    folder = await window.deck.reviewWorktree(clones[0], pr.number)
  } catch (error) {
    return failed(`Couldn’t check out #${pr.number}: ${errorText(error)}`)
  }
  const template = state.settings?.reviewPrompt.trim() || DEFAULT_REVIEW
  const prompt = template.replace(/\{(number|repo|title|url|author|branch)\}/g, (_, key: keyof StatusPr) => String(pr[key] ?? ''))
  const id = startSession({ name: `Review #${pr.number}`, cwd: folder, runClaude: true, firstPrompt: prompt }, placement)
  announce(`Claude is reviewing #${pr.number}`)
  return { id, folder }
}

/** What starting a review or an issue came to, for Claude's tools; the page has already said so. */
type Started = { id: string; folder: string; error?: undefined } | { error: string }

function failed(error: string): Started {
  announce(error)
  return { error }
}

const ISSUE_FOLDERS_KEY = 'deckterm.issueFolders'
const issueFolders = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ISSUE_FOLDERS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** The folder an issue's team was last started in, where the next one likely belongs. */
export const lastIssueFolder = (issue: StatusIssue): string | undefined => issueFolders()[issue.team]

/** A worktree on the issue's own branch, in a repository you pick, with Claude given the issue. */
export async function startOnIssue(issue: StatusIssue) {
  const last = lastIssueFolder(issue)
  const folders = [...new Set([last, ...knownFolders()].filter((f): f is string => !!f))].slice(0, 12)
  const choice = await window.deck.popupMenu([
    { label: `Start ${issue.identifier} in…`, enabled: false },
    ...folders.map(f => ({ id: `folder:${f}`, label: `${baseName(f)}  —  ${tilde(f)}`, checked: f === last ? true : undefined })),
    { type: 'separator' },
    { id: 'choose', label: 'Choose Folder…' },
  ])
  let folder = choice?.startsWith('folder:') ? choice.slice(7) : null
  if (choice === 'choose') folder = await window.deck.pickFolder(last ?? getState().lastCwd)
  if (folder) await startIssueIn(issue, folder)
}

/** Starts an issue in a worktree of `folder` on its branch, with Claude given the issue. */
export async function startIssueIn(issue: StatusIssue, folder: string, placement: Placement = 'alone'): Promise<Started> {
  localStorage.setItem(ISSUE_FOLDERS_KEY, JSON.stringify({ ...issueFolders(), [issue.team]: folder }))
  let cwd = folder
  try {
    cwd = await window.deck.createWorktree(folder, issue.identifier, issue.branch ?? undefined)
  } catch (error) {
    // Not a git repository: Claude works in the folder itself.
    if (!/not a git repository/i.test(errorText(error))) return failed(`Couldn’t make a worktree: ${errorText(error)}`)
  }
  rememberFolder(folder)
  const prompt = [`Work on Linear issue ${issue.identifier}: ${issue.title}`, issue.url, issue.description].filter(Boolean).join('\n\n')
  const id = startSession({ name: `${issue.identifier} ${issue.title}`.slice(0, 48), cwd, runClaude: true, firstPrompt: prompt }, placement)
  return { id, folder: cwd }
}

export const openLink = (url: string) => window.open(url, '_blank')

type GithubOk = Extract<StatusGithub, { login: string }>
type LinearOk = Extract<NonNullable<StatusLinear>, { open: StatusIssue[] }>
/** GitHub's answer when it had one, rather than an error. */
export const githubOk = (gh?: StatusGithub | null): GithubOk | null => (gh && gh.error === undefined ? gh : null)
export const linearOk = (lin?: StatusLinear): LinearOk | null => (lin && lin.error === undefined ? lin : null)

// ── For Claude's get_status tool ──────────────────────────────────────────────────────────────

export async function statusText(): Promise<string> {
  if (!state.data || Date.now() - state.data.at > 60_000) await collect()
  const { data } = state
  const brief = summaryOf(state, 'brief')
  const s = getState()
  const lines: string[] = []
  if (brief.value) {
    lines.push(`Brief (written ${new Date(brief.at!).toLocaleString()}): ${brief.value.headline}`)
    brief.value.focus.forEach((f, i) => lines.push(`${i + 1}. ${f.title}: ${f.why}`))
  }
  const needs = orderedSessions(s).filter(x => s.needsSince[x.id])
  lines.push(`\nSessions needing the user (${needs.length}):`, ...needs.map(x => `- ${x.name}: ${WORDS[s.status[x.id] ?? 'idle']}${s.activity[x.id]?.text ? ` — ${s.activity[x.id]!.text}` : ''}`))
  const due = s.sessions.filter(x => x.due)
  if (due.length) lines.push('\nReminders that came due and wait for the user:', ...due.map(x => `- ${x.name}: due ${new Date(x.due!.at).toLocaleString()}${x.due!.note ? ` — ${x.due!.note}` : ''}`))
  const later = s.sessions.filter(x => x.remind)
  if (later.length) lines.push('\nReminders:', ...later.map(x => `- ${x.name}: ${new Date(x.remind!.at).toLocaleString()}${x.remind!.note ? ` — ${x.remind!.note}` : ''}`))
  const gh = githubOk(data?.github)
  if (gh) {
    lines.push(`\nPull requests waiting for the user's review (${gh.review.length}):`, ...gh.review.map(p => `- ${p.repo}#${p.number} “${p.title}” by ${p.author}${p.requested === false ? ` (${p.change} since their review)` : p.rereview ? ' (changed since their review)' : ''} ${p.url}`))
    lines.push(`\nThe user's open pull requests (${gh.mine.length}):`, ...gh.mine.map(p => `- ${p.repo}#${p.number} “${p.title}”: ${p.reason} ${p.url}`))
  } else if (data?.github.error) lines.push(`\nGitHub: ${data.github.error}`)
  const lin = linearOk(data?.linear)
  if (lin) lines.push(`\nLinear issues assigned to the user (${lin.open.length}):`, ...lin.open.map(i => `- ${i.identifier} “${i.title}”: ${i.state.name}${i.priorityLabel ? `, ${i.priorityLabel}` : ''} ${i.url}`))
  else if (data?.linear?.error) lines.push(`\nLinear: ${data.linear.error}`)
  const open = s.notes.filter(n => !n.done)
  lines.push(`\nTo-dos (${open.length}):`, ...open.map(n => `- [${n.id}] ${n.text}${n.issue ? ` (${n.issue})` : ''}${n.due ? `; its reminder came due ${new Date(n.due).toLocaleString()}` : n.remind ? `; reminder ${new Date(n.remind).toLocaleString()}` : ''}`))
  return lines.join('\n')
}

/** Notes' sessions and issues are kept by id; the page shows them only while they still exist. */
export function noteSession(note: Note) {
  return note.session ? getState().sessions.find(x => x.id === note.session) : undefined
}

/** The sidebar's Today tile: the day's date, like Reminders' Today, and what's waiting on the page. */
export function todaySummary(s: Pick<State, 'notes' | 'sessions'>, data: StatusData | null, now: number) {
  const gh = githubOk(data?.github)
  const endOfDay = new Date(now).setHours(23, 59, 59, 999)
  const reminders = s.sessions.filter(x => x.due || (x.remind && x.remind.at <= endOfDay)).length
  const todos = s.notes.filter(n => !n.done).length
  const fix = gh?.mine.filter(p => p.attention === 'fix' || p.attention === 'reply').length ?? 0
  const review = gh?.review.length ?? 0
  const parts = [
    review && `${review} to review`,
    fix && `${fix} need${fix === 1 ? 's' : ''} you`,
    reminders && `${reminders} reminder${reminders === 1 ? '' : 's'}`,
    todos && `${todos} to-do${todos === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
  return { count: review + fix + reminders + todos, text: parts.slice(0, 2).join(' · ') }
}

// ── The chat ──────────────────────────────────────────────────────────────────────────────────

/** Claude's answer as it came: text, with the tools it used in between. */
export type ChatPart = { text: string } | { tool: string }
export interface ChatMessage {
  from: 'you' | 'claude'
  parts: ChatPart[]
  error?: string
}
interface Chat {
  messages: ChatMessage[]
  /** The Claude conversation, resumed by each question after the first. */
  claude?: string
  /** When Claude was last given the page's facts. */
  factsAt?: number
  day: number
  /** The question being answered, by its request. */
  asking?: number
}

/** The page's tab a conversation belongs to; each has its own. */
export type ChatScope = 'today' | 'week'

// Each tab has a conversation per project, about only what's in it; '' is everything's.
const chatKey = (scope: ChatScope, project: string) => `${scope === 'today' ? 'deckterm.todayChat' : 'deckterm.weekChat'}${project ? `:${project}` : ''}`

// A conversation lasts the day, as the brief does; tomorrow's starts from tomorrow's facts.
function loadChat(key: string): Chat {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Chat | null
    if (saved && saved.day === today()) return { messages: saved.messages, claude: saved.claude, factsAt: saved.factsAt, day: saved.day }
  } catch {}
  return { messages: [], day: today() }
}

const chats: Record<string, Chat> = {}
const chatListeners = new Set<() => void>()
const chatOf = (key: string) => (chats[key] ??= loadChat(key))

function setChat(key: string, next: Chat, save = true) {
  chats[key] = next
  // An answer being written is saved once it's done, not on every word.
  if (save) try {
    localStorage.setItem(key, JSON.stringify({ messages: next.messages, claude: next.claude, factsAt: next.factsAt, day: next.day }))
  } catch {}
  chatListeners.forEach(l => l())
}

export function useChat(scope: ChatScope, project = '') {
  return useSyncExternalStore(
    listener => {
      chatListeners.add(listener)
      return () => chatListeners.delete(listener)
    },
    () => chatOf(chatKey(scope, project)),
  )
}

/** Changes the answer being written, the last message. */
function answer(scope: string, change: (m: ChatMessage) => ChatMessage, save = true) {
  const chat = chats[scope]
  const last = chat.messages.at(-1)
  if (last?.from !== 'claude') return
  setChat(scope, { ...chat, messages: [...chat.messages.slice(0, -1), change(last)] }, save)
}

window.deck.onChatEvent((requestId, event) => {
  const scope = Object.keys(chats).find(k => chats[k].asking === requestId)
  if (!scope) return
  answer(scope, m => {
    const parts = [...m.parts]
    const tail = parts.at(-1)
    if (event.type === 'tool') parts.push({ tool: event.name })
    else if (tail && 'text' in tail) parts[parts.length - 1] = { text: tail.text + event.text }
    else parts.push({ text: event.text })
    return { ...m, parts }
  }, false)
})

// Main's answers outlive a reload of the window, so a request's id mustn't start over with it.
let chatRequest = Date.now() * 100
const FACTS_TTL = 15 * 60_000
// Stopped before main has the request: while the window still gathers the facts.
const stoppedEarly = new Set<number>()

export async function ask(tab: ChatScope, question: string) {
  const project = selectedProject()
  const scope = chatKey(tab, project?.name ?? '')
  if (chatOf(scope).asking || !question.trim()) return
  if (chats[scope].day !== today()) chats[scope] = { messages: [], day: today() }
  const requestId = ++chatRequest
  const chat = chats[scope]
  // A follow-up after a while gets the facts again, or Claude answers from the morning's pull requests.
  const facts = !chat.claude || !chat.factsAt || Date.now() - chat.factsAt > FACTS_TTL
  setChat(scope, {
    ...chat,
    asking: requestId,
    messages: [...chat.messages, { from: 'you', parts: [{ text: question.trim() }] }, { from: 'claude', parts: [] }],
  })
  if (facts) await collect()
  const result = stoppedEarly.delete(requestId)
    ? { stopped: true, claude: chat.claude, error: undefined }
    : await window.deck.askChat(requestId, tab, question, snapshot(project), chat.claude, facts)
      .catch((error: Error) => ({ error: errorText(error), claude: undefined, stopped: undefined }))
  stoppedEarly.delete(requestId)
  if (chats[scope].asking !== requestId) return
  const ok = !result.error && !result.stopped
  setChat(scope, {
    ...chats[scope],
    asking: undefined,
    // A conversation that couldn't be resumed is let go, so the next question starts a new one.
    claude: result.error && chat.claude ? undefined : result.claude ?? chats[scope].claude,
    factsAt: result.error && chat.claude ? undefined : facts && ok ? Date.now() : chats[scope].factsAt,
  })
  if (result.error) answer(scope, m => ({ ...m, error: result.error }))
  else if (result.stopped) answer(scope, m => ({ ...m, error: 'Stopped.' }))
}

export function stopAsking(tab: ChatScope, project = '') {
  const { asking } = chatOf(chatKey(tab, project))
  if (!asking) return
  stoppedEarly.add(asking)
  window.deck.stopChat(asking)
}

export function newChat(tab: ChatScope, project = '') {
  stopAsking(tab, project)
  setChat(chatKey(tab, project), { messages: [], day: today() })
}
