type Unsubscribe = () => void

/** The page a session's headless browser shows in Own Term. */
interface BrowserState {
  url: string
  title: string
  /** Shown as a Chrome window of its own rather than in Own Term. */
  windowed?: boolean
}

/** One session in the menu bar's panel. */
interface MenuBarSession {
  id: string
  name: string
  status: 'working' | 'input' | 'done' | 'reminder' | 'running'
  /** What it's doing, asking or said last. */
  text?: string
  /** When the turn started, or when it started needing you. */
  since?: number
  group?: string
  permission?: boolean
  /** A finished turn or due reminder with Claude still running, so the panel can send a reply. */
  reply?: boolean
}

interface MenuBarSummary {
  sessions: MenuBarSession[]
  working: number
  needsYou: number
}

interface GitInfo {
  branch: string
  added: number
  removed: number
  untracked: number
  /** Set when the folder is a linked worktree rather than the repository's main checkout. */
  worktree?: { name: string; repo: string; path: string } | null
}

/** The info panel's git detail for one folder. */
interface GitDetails {
  root: string
  branch: string | null
  /** The commit, when HEAD is detached. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: { path: string; name: string; kind: 'modified' | 'added' | 'deleted' | 'new'; added: number; removed: number }[]
  moreFiles: number
  commits: { hash: string; subject: string; author: string; time: number; pushed: boolean }[]
  stashes: number
  worktrees: { path: string; branch: string | null; current: boolean }[]
}

/** The branch's pull request; `available` is false without gh or a GitHub remote. */
interface PullRequestInfo {
  available: boolean
  pr: {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED'
    review: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
    checks: { passed: number; failed: number; pending: number }
  } | null
}

/** A Claude conversation, from its transcript. */
interface ClaudeInfo {
  model: { id: string; name: string | null } | null
  /** Tokens the last request sent, which is what the conversation fills of the context window. */
  context: number
  compactions: number
  prompts: number
  started: number | null
  /** Files Claude edited, most recent first. */
  edited: string[]
  instructions: { path: string; type: string | null }[]
  skills: string[]
  /** Context after each request, oldest first; a compaction shows as a drop. */
  series: { time: number | null; tokens: number }[]
  /** How long Claude worked on each prompt, from the turn's end. */
  turns: { time: number | null; ms: number }[]
  /** The conversation's scratch folder and its newest files; null when it has none. */
  scratchpad?: { dir: string; files: { path: string; folder: boolean; size: number; time: number }[]; more: number } | null
}

interface EditorState {
  current: { id: string; name: string }
  editors: { id: string; name: string }[]
}

interface MenuItem {
  id?: string
  label?: string
  type?: 'separator'
  enabled?: boolean
  checked?: boolean
  /** A PNG data URL, shown at 12×12. */
  icon?: string
  submenu?: MenuItem[]
}

/** The updater's progress; `version` is set once a newer one is downloaded and ready. */
interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version?: string
}

interface HookEvent {
  event: string
  claudeSessionId?: string
  /** SessionStart's reason: startup, resume, clear or compact. */
  source?: string
  fromSubagent: boolean
  prompt?: string
  notificationType?: string
  toolName?: string
  summary?: string
  /** What a tool that's starting does, for PreToolUse: "Editing store.ts". */
  activity?: string
  /** For Stop: background agents still running, which Claude reports back on in a turn of its own. */
  agents?: number
  /** For Stop: Claude's last reply, up to 8000 characters. */
  reply?: string
  /** A shell command Claude started or finished, or a background one that ended (see commands.ts). */
  command?:
    | { kind: 'start'; id: string; command: string; description?: string; background: boolean }
    | { kind: 'end'; id: string; output: string; taskId?: string; interrupted: boolean }
    | { kind: 'fail'; id: string; output: string; exitCode?: number }
    | { kind: 'tasks'; ended: { id: string; status?: string; exitCode?: number }[] }
    | { kind: 'shells'; running: string[] }
}

/** What a tool call answers. `transcript` asks main to add that Claude conversation's latest prompts. */
interface ToolResult {
  text: string
  isError?: boolean
  transcript?: string
}

/** A pull request on the status page (electron/status.cjs). */
interface StatusPr {
  /** `pr:owner/repo#12`, the id Claude's brief refers to it by. */
  id: string
  repo: string
  number: number
  title: string
  url: string
  author: string | null
  created: number
  updated: number
  draft: boolean
  branch: string
  additions: number
  deletions: number
  /** Your own: its checks, reviews, and what it needs from you. */
  checks?: 'passing' | 'failing' | 'pending' | null
  review?: 'approved' | 'changes' | 'commented' | 'none'
  conflicts?: boolean
  attention?: 'fix' | 'reply' | 'ready' | 'waiting' | 'draft'
  reason?: string
  /** When it last became your turn: a review, a comment, an unanswered thread or failing checks. */
  turnAt?: number
  /** Waiting for your review: since when, and whether it changed after your last one. */
  waitingSince?: number
  rereview?: boolean
  /** False for one you reviewed that changed since without asking you again; `change` says how. */
  requested?: boolean
  change?: string
  mergedAt?: number
  reviewedAt?: number
  verdict?: string | null
  /** Linear issues it belongs to, by id. */
  issues?: string[]
}

/** A Linear issue assigned to you. */
interface StatusIssue {
  /** `issue:ABC-123`. */
  id: string
  identifier: string
  title: string
  url: string
  /** Linear's: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number
  priorityLabel?: string
  state: { name: string; type: string; color: string }
  team: string
  project: string | null
  cycle: { number: number; current: boolean } | null
  due: string | null
  /** The branch name Linear suggests for it. */
  branch: string | null
  updated: number
  completed: number | null
  description: string
  links: string[]
  prs?: string[]
  /** Its pull requests' repository, or the one its team's issues are in. */
  repo?: string | null
}

type StatusGithub =
  | { at: number; error: string }
  | { at: number; error?: undefined; login: string; mine: StatusPr[]; review: StatusPr[]; merged: StatusPr[]; reviewed: StatusPr[] }

type StatusLinear =
  | null
  | { at: number; error: string }
  | { at: number; error?: undefined; user?: { name: string; org?: string }; open: StatusIssue[]; done: StatusIssue[] }

interface StatusData {
  github: StatusGithub
  /** Null when Linear isn't connected. */
  linear: StatusLinear
  at: number
}

interface ProjectLook {
  color?: number
  icon?: string
}

interface StatusSettings {
  ai: boolean
  model: 'sonnet' | 'opus' | 'haiku'
  instructions: string
  reviewPrompt: string
  prScope: 'all' | 'sessions'
  mutedRepos: string[]
  /** Project names by repository (owner/name); repositories given one name are one project. */
  projects: Record<string, string>
  /** A project's color (a GROUP_COLORS index) and icon (a session icon's name, 'favicon' or 'initials'), by project name. */
  projectLooks: Record<string, ProjectLook>
  /** Notifications when a pull request starts needing you. */
  pings: boolean
  linear:
    | { connected: false }
    | { connected: true; user: { name: string; org?: string; urlKey?: string }; teams: { id: string; key: string; name: string }[]; selected: string[] }
  /** Null until GitHub has been asked. */
  github: null | { login: string; name?: string | null; error?: undefined } | { error: 'missing' | 'logged-out' | 'failed' }
}

/** A line of Claude's brief or standup, and the items it's about. */
interface SummaryLine {
  text: string
  refs: string[]
}

interface Brief {
  headline: string
  focus: { title: string; why: string; refs: string[] }[]
  threads: { name: string; summary: string; refs: string[] }[]
  risks: SummaryLine[]
}

interface Standup {
  summary: string
  projects: StandupProject[]
}

/** One project's week, so work and side projects don't mix; an old standup's is unnamed. */
interface StandupProject {
  name: string
  summary: string
  done: SummaryLine[]
  doing: SummaryLine[]
  next: SummaryLine[]
  blockers: SummaryLine[]
}

/** A prompt typed to Claude in a session, or its reply, as the journal keeps them. */
interface JournalEntry {
  t: number
  kind: 'prompt' | 'reply'
  session?: string
  name?: string
  group?: string
  folder?: string
  branch?: string
  claude?: string
  text: string
  /** Read from Claude Code's transcripts, for days before the journal began. */
  source?: 'transcript'
  /** The repository its folder is in, as the journal is read. */
  repo?: string | null
}

/** What the window knows that Claude's brief needs: sessions, reminders and to-dos. */
interface StatusSnapshot {
  user?: string
  sessions: {
    id: string
    name: string
    group?: string
    status: string
    since?: number
    folder: string
    branch?: string
    changes?: string
    last?: string
    claude?: string
    remind?: { at: number; note?: string }
    due?: { at: number; note?: string }
  }[]
  notes: { id: string; text: string; created: number; done?: number; by: 'you' | 'claude'; issue?: string; session?: string; remind?: number; due?: number }[]
  /** The one project it's about; its sessions and notes are then only that project's. */
  project?: ProjectDef
  /** Every project, for what's about all of them. */
  projects?: ProjectDef[]
}

/** A project: a name, and the repositories (owner/name) that are in it. */
interface ProjectDef {
  name: string
  repos: string[]
}

/** A monitor (electron/monitors.cjs): commands Own Term runs on a schedule, drawn as a page, with rules that notify. */
type MonitorState = 'approval' | 'done' | 'paused' | 'alert' | 'warn' | 'error' | 'ok' | 'pending'
type MonitorValue = number | string | boolean | null
type MonitorRow = Record<string, MonitorValue>
type ValueFormat = 'number' | 'compact' | 'percent' | 'ms' | 'seconds' | 'bytes'

interface MonitorSummary {
  id: string
  name: string
  icon?: string
  /** The session whose Claude made it. */
  by?: string
  created: number
  state: MonitorState
  paused: boolean
  /** Why it stopped by itself: a done rule fired, or it expired. */
  done?: { at: number; why: string }
  expiresAt?: number
  /** Sources whose commands the user hasn't allowed yet. */
  pending: string[]
  /** New rows a new_rows rule found since the page was last looked at. */
  unseen: number
  firing: { id: string; name: string; level: 'warn' | 'alert'; value?: MonitorValue; since?: number; message?: string; keys?: string[] }[]
  /** Rules the user silenced, by id: until a time, or until they stop firing. Left out of `firing`. */
  snoozed: Record<string, number | 'clear'>
  error?: string
  lastRun?: number
  running: boolean
  /** The first stat panel's value, for the sidebar. */
  headline?: { value: MonitorValue; format?: ValueFormat; unit?: string; decimals?: number }
  /** Changes whenever anything about it does, so the page knows to fetch it again. */
  rev: number
}

interface MonitorSource {
  run: string
  every?: string
  at?: string[]
  days?: 'daily' | 'weekdays' | 'weekends' | string[]
  hours?: string
  format: 'number' | 'json' | 'ndjson' | 'csv' | 'tsv' | 'lines'
  timeout?: string
  keep?: string
  key?: string
  folder?: string
}

interface MonitorPanel {
  type: 'stat' | 'line' | 'area' | 'bar' | 'table' | 'log' | 'status' | 'checks' | 'funnel'
  source: string
  title?: string
  width?: 1 | 2 | 3 | 4
  field?: string
  format?: ValueFormat
  unit?: string
  decimals?: number
  spark?: boolean
  /** stat: the time back its change is shown against, or false for none. */
  compare?: string | false
  /** checks and funnel: the first row's fields, in order. */
  fields?: { field: string; label?: string }[]
  /** table and log: what an empty one says. */
  empty?: string
  y?: string[]
  x?: string
  columns?: string[]
  limit?: number
  text?: string
  time?: string
  level?: string
}

interface MonitorRule {
  id: string
  name: string
  source: string
  level: 'warn' | 'alert' | 'done'
  for?: number
  field?: string
  by?: string
  change?: string
  say?: string
  /** Sent to Claude in the session that made the monitor when the rule starts firing. */
  prompt?: string
  agg?: 'first' | 'last' | 'sum' | 'avg' | 'min' | 'max' | 'count'
  op?: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'contains'
  value?: number | string
  failing?: true
  new_rows?: true
}

interface MonitorSpec {
  id: string
  name: string
  icon?: string
  description?: string
  folder: string
  by?: string
  created: number
  updated: number
  expires?: string
  expiresAt?: number
  sources: Record<string, MonitorSource>
  panels: MonitorPanel[]
  rules: MonitorRule[]
  /** Moments drawn on its time charts, like a release. */
  marks?: { at: string; label: string }[]
}

/** Something that happened to a monitor, kept for a week. `rule` is its id, `name` its name then. */
interface MonitorEvent {
  t: number
  kind: 'fired' | 'cleared' | 'new' | 'failed' | 'recovered' | 'finished'
  text: string
  rule?: string
  name?: string
  level?: 'warn' | 'alert' | 'done'
  source?: string
  count?: number
  keys?: string[]
  /** Happened while the rule was snoozed, so no one was told. */
  snoozed?: true
}

interface MonitorDetail {
  spec: MonitorSpec
  summary: MonitorSummary
  /** Fields the panels and rules name that the rows don't have. */
  problems: string[]
  file: string
  sources: Record<string, {
    approved: boolean
    running: boolean
    scheduled: boolean
    latest?: { t: number; ms: number; ok: boolean; error?: string; total?: number }
    /** The last good run's rows. */
    rows: MonitorRow[]
    total: number
    /** One point a run: its time, whether it worked, and the first row's numbers. */
    history: { t: number; ok: boolean; v?: Record<string, number> }[]
  }>
  rules: Record<string, { firing: boolean; streak: number; value?: MonitorValue; since?: number; notified?: number; message?: string; keys?: string[]; last?: { t: number; count: number } }>
  events: MonitorEvent[]
  /** When the page was last left: what happened after it is news. */
  lookedAt?: number
}

interface Window {
  deck: {
    homeDir: string
    /** The account's full name, for the status page's greeting. */
    userName(): string
    start(options: { id: string; cwd: string; command?: string; cols: number; rows: number }): Promise<string>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    /** A line in the terminal size log (electron/sizelog.cjs). */
    logSize(id: string | null, event: string, details?: object): void
    pickFolder(defaultPath: string): Promise<string | null>
    pathForFile(file: File): string
    gitInfo(cwd: string): Promise<GitInfo | null>
    /** A worktree named `name`, on a new branch, or on `branch` when given. */
    createWorktree(cwd: string, name: string, branch?: string): Promise<string>
    gitDetails(cwd: string): Promise<GitDetails | null>
    pullRequest(cwd: string): Promise<PullRequestInfo>
    claudeInfo(claudeSessionId: string): Promise<ClaudeInfo | null>
    /** A file's diff against HEAD (null when unchanged or not in git) and its text, for the file viewer. */
    fileView(file: string): Promise<{
      diff: string | null
      tracked: boolean
      text: string | null
      note: 'deleted' | 'not a file' | 'too large' | 'binary' | null
      /** An image as a data URL, and the committed version when it changed. */
      image: string | null
      before: string | null
      size: number | null
    } | null>
    /** The ports a session's processes listen on; `launchedBy` is the command Claude ran that started one. */
    ports(id: string): Promise<{ port: number; command: string; launchedBy?: string | null }[]>
    /** A background command's output from byte `from` on; `skipped` when only its last megabyte came. */
    taskOutput(taskId: string, from: number): Promise<{ text: string; size: number; skipped: boolean } | null>
    suggestName(kind: 'session' | 'group', text: string): Promise<string | null>
    resolveFiles(cwd: string, paths: string[]): Promise<(string | null)[]>
    openFile(file: string, line?: number, column?: number): void
    setBadge(count: number): void
    setBusy(names: string[]): void
    updateState(): UpdateState
    onUpdate(callback: (state: UpdateState) => void): Unsubscribe
    installUpdate(): void
    setupStatus(): Promise<{ claude: string | null; hooks: boolean }>
    /** Resolves with an error message, or null once installed. */
    installHooks(): Promise<string | null>
    suggestGroup(text: string): Promise<{ group?: string; newGroup?: string; with?: string[]; none?: boolean } | null>
    setAppearance(appearance: 'system' | 'light' | 'dark'): void
    /** The id of the theme picked last, kept by the main process. */
    theme(): string
    setTheme(theme: { id: string; names: { id: string; name: string }[]; windowColors: { dark: string; light: string } }): void
    /** The editor files open in, and the ones installed to choose from. */
    editors(): EditorState
    setEditor(id: string): void
    onEditor(callback: (state: EditorState) => void): Unsubscribe
    accent(): string
    onAccent(callback: (color: string) => void): Unsubscribe
    popupMenu(items: MenuItem[]): Promise<string | null>
    confirm(options: { message: string; detail?: string; confirm: string }): Promise<boolean>
    revealFile(file: string): void
    openFolder(folder: string): void
    focusWindow(): void
    /** A macOS notification for a session; `actions` become its buttons, reported back by their label, and `reply` a text field, reported as 'reply' with its text. */
    notify(options: { id: string; title: string; body: string; actions?: string[]; reply?: boolean }): void
    unnotify(id: string): void
    /** A notification was clicked (`click`), one of its buttons pressed (its label), or it couldn't be shown (`failed`). */
    onNotification(callback: (id: string, action: string, text?: string) => void): Unsubscribe
    /** A session browser's live view is on screen at this size in CSS pixels, or isn't (null); it bounds the frames' size. */
    watchBrowser(id: string, size: { width: number; height: number; scale: number } | null): void
    browserFrameDrawn(id: string): void
    /** Input for a session browser's page: DevTools Input.dispatchMouseEvent, dispatchKeyEvent or insertText parameters. */
    browserInput(id: string, kind: 'mouse' | 'key' | 'text', params: Record<string, unknown>): void
    browserStates(): Record<string, BrowserState>
    /** Opens the demo day's checkout page in a headless browser for a demo session; false when Chrome isn't there. */
    demoBrowser(id: string): Promise<boolean>
    /** Moves a session's browser out to a Chrome window of its own, or back into Own Term. */
    setBrowserWindowed(id: string, windowed: boolean): void
    /** Opens the page a session's browser shows in a plain Chrome window, where sites accept a sign-in; with no session, a new tab. */
    signIn(id?: string): void
    /** Quits the sign-in Chrome, so what you signed in to reaches every session's browser. */
    finishSignIn(): void
    signingIn(): boolean
    /** The sign-in Chrome opened or quit. */
    onSigningIn(callback: (signing: boolean) => void): Unsubscribe
    /** A session's headless browser started, showed another page or changed its title, or closed (null). */
    onBrowserState(callback: (id: string, state: BrowserState | null) => void): Unsubscribe
    /** A JPEG of a session browser's page, and the page's own size in CSS pixels; answer with browserFrameDrawn once drawn. */
    onBrowserFrame(callback: (id: string, frame: Uint8Array, page: { width: number; height: number }) => void): Unsubscribe
    /** The main window tells the menu bar what its sessions are doing. */
    setMenuBarSummary(summary: MenuBarSummary): void
    onMenuBarAction(callback: (action: { type: 'open'; id: string } | { type: 'answer'; id: string; allow: boolean } | { type: 'reply'; id: string; text: string }) => void): Unsubscribe
    /** The menu bar's panel reads the summary and follows it. */
    menuBar(): { summary: MenuBarSummary; pinned: boolean }
    onMenuBar(callback: (summary: MenuBarSummary) => void): Unsubscribe
    onMenuBarPinned(callback: (pinned: boolean) => void): Unsubscribe
    menuBarOpen(id?: string): void
    menuBarAnswer(id: string, allow: boolean): void
    menuBarReply(id: string, text: string): void
    menuBarPin(pin: boolean): void
    menuBarHeight(height: number): void
    statusSettings(): Promise<StatusSettings>
    saveStatusSettings(patch: Partial<Omit<StatusSettings, 'linear' | 'github'>> & { linearTeams?: string[] }): Promise<StatusSettings>
    connectLinear(key: string): Promise<{ settings: StatusSettings; error?: undefined } | { error: string }>
    disconnectLinear(): Promise<StatusSettings>
    /** Pull requests and Linear issues; cached for two minutes unless `force`. */
    collectStatus(options: { folders: string[]; force?: boolean }): Promise<StatusData>
    /** The journal's entries for the last `days` days, today included. */
    journal(days: number): Promise<JournalEntry[]>
    addToJournal(entry: Omit<JournalEntry, 't'>): void
    cachedSummaries(project?: string): Promise<{ brief: { value: Brief; at: number } | null; standup: { value: Standup; at: number } | null }>
    writeSummary<K extends 'brief' | 'standup'>(kind: K, snapshot: StatusSnapshot): Promise<{ value: K extends 'brief' ? Brief : Standup; at: number; error?: undefined } | { error: string }>
    /** A question for the Today page's chat; `resume` continues that Claude conversation, given the facts again with `facts`. Its text and tools arrive by onChatEvent. */
    askChat(requestId: number, scope: 'today' | 'week', question: string, snapshot: StatusSnapshot, resume?: string, facts?: boolean): Promise<{ claude?: string; error?: string; stopped?: boolean }>
    stopChat(requestId: number): void
    onChatEvent(callback: (requestId: number, event: { type: 'text'; text: string } | { type: 'tool'; name: string }) => void): Unsubscribe
    /** Which of these folders are clones of a GitHub repository (owner/name). */
    repoFolders(repo: string, folders: string[]): Promise<string[]>
    /** The repository (owner/name) each folder is in, or null. */
    repos(folders: string[]): Promise<Record<string, string | null>>
    /** By repository, the icon its clone in one of the given folders keeps (a data URL), or null. */
    projectFavicons(folders: Record<string, string[]>): Promise<Record<string, string | null>>
    /** Each folder's main checkout while it still exists, with its repository, and a clone of each repository asked for. */
    sessionFolders(folders: string[], repos: string[]): Promise<{ roots: Record<string, { root: string; repo: string | null }>; clones: Record<string, string> }>
    /** A pull request checked out in a worktree of the clone at `folder`; resolves with the worktree's folder. */
    reviewWorktree(folder: string, number: number): Promise<string>
    monitors(): Promise<MonitorSummary[]>
    onMonitors(callback: (monitors: MonitorSummary[]) => void): Unsubscribe
    /** A monitor's notification was clicked. */
    onShowMonitor(callback: (id: string) => void): Unsubscribe
    /** A rule with a prompt started firing: wake Claude in the session that made the monitor. */
    onMonitorWake(callback: (wake: { monitor: string; name: string; session?: string; rule: string; level: string; message: string; prompt: string; source: string; rows: MonitorRow[] }) => void): Unsubscribe
    monitor(id: string): Promise<MonitorDetail | null>
    /** Makes a monitor, or replaces `replace`'s spec; `restore` takes back a spec main gave out before. */
    saveMonitor(input: unknown, options: { replace?: string; by?: string; folder?: string; restore?: boolean }): Promise<
      { errors: string[]; id?: undefined } | { id: string; created: boolean; previous?: MonitorSpec; pending: string[]; errors?: undefined }
    >
    /** Allows every command of the spec version `updated`, and runs them; false when the spec has changed since. */
    approveMonitor(id: string, updated: number): Promise<boolean>
    pauseMonitor(id: string, paused: boolean): Promise<void>
    /** Runs its allowed commands now; resolves once they've all finished. */
    runMonitor(id: string): Promise<void>
    /** New rows are seen; with `looked`, the page is being left. */
    monitorSeen(id: string, looked?: boolean): Promise<void>
    /** Silences a rule until a time or until it stops firing; null lets it notify again. */
    snoozeRule(id: string, rule: string, until: number | 'clear' | null): Promise<void>
    removeMonitor(id: string): Promise<boolean>
    restoreMonitor(id: string): Promise<boolean>
    revealMonitor(id: string): void
    onHook(callback: (id: string, event: HookEvent) => void): Unsubscribe
    /** A tool call from Claude in session `id`, through Own Term's MCP server (electron/tools.cjs). */
    onToolCall(callback: (requestId: number, id: string, tool: string, args: Record<string, unknown>) => void): Unsubscribe
    toolResult(requestId: number, result: ToolResult): void
    onData(callback: (id: string, data: string) => void): Unsubscribe
    onExit(callback: (id: string, code: number) => void): Unsubscribe
    onMenu(callback: (action: string, arg?: number) => void): Unsubscribe
  }
}
