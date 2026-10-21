import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import {
  Archive, ArrowDown, ArrowUp, Check, ChevronDown, Clock3, SquareTerminal, FileDiff, Folder, FolderOpen, FolderTree, GitBranch, GitPullRequest, NotebookPen, Sparkle, Sparkles, X,
} from 'lucide-react'
import { groupColor, useStore, type Session } from './store'
import { openSession } from './workspace'
import { StatusIcon } from './StatusIcon'
import { STATUS_LABEL } from './Sidebar'
import { ContextChart, TurnsChart, duration, tokens } from './Charts'
import { demoFile, demoInfo } from './demo-info'
import { FileViewer } from './FileViewer'
import { useEditor } from './editor'
import { commandState, useCommands, type Command } from './commands'
import { CommandViewer } from './CommandViewer'

// Every poll's last answer by key, so a session you come back to shows at once and refreshes behind.
const lastAnswers = new Map<string, unknown>()

/** Calls `load` now and every `ms` while the window is visible, until `key` changes; null pauses it. */
function usePoll<T>(load: (() => Promise<T>) | null, key: string, ms: number): T | undefined {
  const [result, setResult] = useState<{ key: string; value: T }>()
  useEffect(() => {
    if (!load) return
    let current = true
    // A slow git or gh outlasts the interval; skipping the tick keeps calls from piling up.
    let busy = false
    const tick = () => {
      if (document.hidden || busy) return
      busy = true
      load().then(value => {
        lastAnswers.set(key, value)
        if (current) setResult({ key, value })
      }, () => {}).finally(() => { busy = false })
    }
    tick()
    const timer = setInterval(tick, ms)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [key, !!load])
  return result?.key === key ? result.value : (lastAnswers.get(key) as T | undefined)
}

/** False for `ms` after `key` changes, then true: how long a session's first answers are waited for. */
function useWaited(key: string, ms: number) {
  const [waited, setWaited] = useState<string>()
  useEffect(() => {
    const timer = setTimeout(() => setWaited(key), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return waited === key
}

// A demo session's files, links and servers are invented, so clicking them does nothing.
const Demo = createContext(false)
function useAct() {
  const demo = useContext(Demo)
  return (action: () => void) => () => {
    if (!demo) action()
  }
}

// A file opens in the viewer over the window; ⌘-click opens it in your editor instead.
const Viewer = createContext<(file: string) => void>(() => {})
function useOpenFile() {
  const demo = useContext(Demo)
  const view = useContext(Viewer)
  return (file: string) => (e: MouseEvent) => {
    if (demo && !demoFile(file)) return
    if (e.metaKey && !demo) window.deck.openFile(file)
    else view(file)
  }
}

const home = (p: string) => (p === window.deck.homeDir || p.startsWith(`${window.deck.homeDir}/`) ? `~${p.slice(window.deck.homeDir.length)}` : p)
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 60 / 24)} d`
}

/** "claude-opus-5-5" as "Opus 5.5", for a transcript that didn't name its model. */
function modelName(model: NonNullable<ClaudeInfo['model']>) {
  if (model.name) return model.name
  const match = model.id.match(/^claude-([a-z]+)-(\d+)-(\d+)/)
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : model.id
}

/** A changed file's status, as the letter VS Code and most git tools use. */
const KIND = {
  modified: ['M', 'Modified'],
  added: ['A', 'Added'],
  deleted: ['D', 'Deleted'],
  new: ['U', 'New, not yet added to git'],
} as const

const REVIEW = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' }
const REVIEW_TONE = { APPROVED: 'green', CHANGES_REQUESTED: 'red', REVIEW_REQUIRED: 'neutral' }

export function InfoPanel({ session, width, active, onNewSession }: {
  session: Session
  width: number
  active: boolean
  onNewSession: (options: { groupId: string | null; cwd: string }) => void
}) {
  const demo = useMemo(() => (session.demo ? demoInfo(session.demo) : null), [session.demo])
  const live = active && !session.demo
  const polledGit = usePoll(live ? () => window.deck.gitDetails(session.cwd) : null, `git:${session.id}:${session.cwd}`, 4000)
  const claudeId = session.claudeSessionId
  const polledClaude = usePoll(live && claudeId ? () => window.deck.claudeInfo(claudeId) : null, `claude:${claudeId ?? ''}`, 3000)
  const polledPorts = usePoll(live ? () => window.deck.ports(session.id) : null, `ports:${session.id}`, 5000)
  // gh asks GitHub, so it's polled slowly, and again whenever the branch changes.
  const polledPr = usePoll(live && polledGit ? () => window.deck.pullRequest(session.cwd) : null, `pr:${session.cwd}:${polledGit?.branch}`, 60000)
  const ranCommands = useCommands(session.id)
  const git = demo ? demo.git : polledGit
  const claude = demo ? demo.claude : polledClaude
  const pr = demo ? demo.pr : polledPr
  const ports = demo ? demo.ports : polledPorts
  const commands = demo ? demo.commands : ranCommands
  const lines = useMemo(() => ({
    added: git?.files.reduce((n, f) => n + f.added, 0) ?? 0,
    removed: git?.files.reduce((n, f) => n + f.removed, 0) ?? 0,
  }), [git])

  const [viewing, setViewing] = useState<string | null>(null)
  // A session not seen yet shows placeholders until git and Claude have both answered, so its cards
  // arrive together instead of one by one; a slow answer is waited for only so long.
  const waited = useWaited(session.id, 1200)
  const ready = waited || (git !== undefined && (!claudeId || claude !== undefined))

  // Claude first, under its numbers; then what's running, and the work it has done.
  return (
    <Demo.Provider value={!!session.demo}>
      <Viewer.Provider value={setViewing}>
        <aside className="info-panel" style={{ width }}>
          {/* Keyed by session, so switching fades the next one in rather than swapping it piece by piece. */}
          <div className="info-content" key={session.id}>
            <Header session={session} />
            <div className="info-scroll">
              {!ready ? <Placeholder /> : (
                <>
                  <Stats git={git} claude={claude} lines={lines} />
                  {claude && <ClaudeSection claude={claude} root={git?.root} showEdited={!git} />}
                  {(commands.length > 0 || (ports && ports.length > 0)) && <RunningSection commands={commands} ports={ports ?? []} />}
                  {git === null && <p className="info-empty">Not a git repository.</p>}
                  {git && <ChangesSection git={git} lines={lines} edited={claude?.edited ?? []} />}
                  {git && <BranchSection git={git} pr={pr?.available ? pr.pr : null} />}
                  {claude?.scratchpad && claude.scratchpad.files.length > 0 && <ScratchpadSection scratchpad={claude.scratchpad} />}
                  {git && git.worktrees.length > 1 && <WorktreeSection git={git} session={session} onNewSession={onNewSession} />}
                </>
              )}
            </div>
          </div>
        </aside>
        {viewing && (
          <FileViewer file={viewing} root={git?.root} demo={session.demo ? demoFile(viewing) : undefined} onClose={() => setViewing(null)} />
        )}
      </Viewer.Provider>
    </Demo.Provider>
  )
}

/** The shapes of the stats and the first cards, while a session's first answers are on their way. */
function Placeholder() {
  return (
    <div className="info-placeholder" aria-hidden="true">
      <div className="info-stats">
        <div className="info-stat" />
        <div className="info-stat wide" />
        <div className="info-stat" />
      </div>
      <div className="info-card tall" />
      <div className="info-card" />
    </div>
  )
}

function Header({ session }: { session: Session }) {
  const status = useStore(s => s.status[session.id] ?? 'idle')
  const group = useStore(s => s.groups.find(g => g.id === session.groupId))
  const act = useAct()
  return (
    <div className="info-head">
      <div className="info-name">
        <span>{session.name}</span>
        <StatusIcon session={session} size={14} />
      </div>
      <div className="info-meta">
        {group && (
          <span className="info-group">
            <span className="tag-dot" style={{ background: groupColor(group) }} />
            {group.name}
          </span>
        )}
        {STATUS_LABEL[status] && <span className={`state ${status}`}>{STATUS_LABEL[status]}</span>}
      </div>
      <button className="info-path" title="Show in Finder" onClick={act(() => window.deck.revealFile(session.cwd))}>{home(session.cwd)}</button>
    </div>
  )
}

interface Lines {
  added: number
  removed: number
}

/** The three numbers worth a glance: how full the context is, what changed, and how long Claude worked. */
function Stats({ git, claude, lines: { added, removed } }: { git?: GitDetails | null; claude?: ClaudeInfo | null; lines: Lines }) {
  // Without Claude there's only the change count, which the Changes card already leads with.
  if (!claude) return null
  const worked = claude.turns.reduce((n, t) => n + t.ms, 0)
  const tiles: [string, ReactNode, string][] = []
  if (claude.context > 0) tiles.push(['Context', tokens(claude.context), 'tokens'])
  if (git) {
    tiles.push([
      'Changes',
      git.files.length ? <><span className="added">+{added}</span> <span className="removed">−{removed}</span></> : 'None',
      `${git.files.length} file${git.files.length === 1 ? '' : 's'}`,
    ])
  }
  // A tile is narrow, so past ten minutes the seconds are left to the Turns chart.
  if (worked > 0) {
    tiles.push([
      'Worked',
      worked >= 600_000 && worked < 3_600_000 ? `${Math.round(worked / 60_000)} min` : duration(worked),
      `${claude.turns.length} turn${claude.turns.length === 1 ? '' : 's'}`,
    ])
  }
  if (tiles.length === 0) return null
  return (
    <div className="info-stats">
      {tiles.map(([label, value, detail]) => (
        <div key={label} className={`info-stat ${label === 'Changes' ? 'wide' : ''}`}>
          <span className="info-stat-label">{label}</span>
          <span className="info-stat-value">{value}</span>
          <span className="info-stat-detail">{detail}</span>
        </div>
      ))}
    </div>
  )
}

// Folded cards by name, the same in every session, so hiding what you never read is done once.
const FOLDED_KEY = 'deckterm.infoFolded'
let folded: ReadonlySet<string> = (() => {
  try {
    const saved = localStorage.getItem(FOLDED_KEY)
    return new Set<string>(saved ? JSON.parse(saved) : ['worktrees'])
  } catch {
    return new Set(['worktrees'])
  }
})()
const foldListeners = new Set<() => void>()

function toggleFolded(id: string) {
  const next = new Set(folded)
  if (!next.delete(id)) next.add(id)
  folded = next
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]))
  } catch {}
  for (const listener of foldListeners) listener()
}

function useFolded(id: string) {
  return useSyncExternalStore(
    listener => {
      foldListeners.add(listener)
      return () => foldListeners.delete(listener)
    },
    () => folded.has(id),
  )
}

/** A card whose title folds it away; folded, `summary` stands in for what it hides. */
function Section({ id, title, icon, tone, detail, summary, children }: {
  id: string
  title: string
  icon: ReactNode
  tone: 'accent' | 'orange' | 'green' | 'neutral'
  detail?: ReactNode
  summary?: ReactNode
  children: ReactNode
}) {
  const isFolded = useFolded(id)
  const shown = isFolded ? summary ?? detail : detail
  return (
    <section className={`info-card ${isFolded ? 'folded' : ''}`}>
      <h3 className="info-title">
        <button className="info-fold" aria-expanded={!isFolded} title={isFolded ? `Show ${title}` : `Fold ${title} away`} onClick={() => toggleFolded(id)}>
          <span className={`info-icon ${tone}`}>{icon}</span>
          {title}
          <ChevronDown className="info-chevron" size={12} strokeWidth={2.4} />
        </button>
        {shown && <span className="info-detail">{shown}</span>}
      </h3>
      {!isFolded && children}
    </section>
  )
}

/** The first `first` of `items`, and a button for the rest; one left over is shown rather than offered. */
function useShowMore<T>(items: T[], first: number, label = (n: number) => `${n} more`): [T[], ReactNode] {
  const [open, setOpen] = useState(false)
  if (items.length <= first + 1) return [items, null]
  return [
    open ? items : items.slice(0, first),
    <button className="info-show-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : label(items.length - first)}</button>,
  ]
}

/** A file under the repo, as its name with the folder it's in dimmed after it. */
function FileName({ file, root }: { file: string; root?: string }) {
  const relative = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : home(file)
  const folder = relative.split('/').slice(0, -1).join('/')
  return (
    <span className="info-file" title={relative}>
      {base(relative)}
      {folder && <span className="info-folder"> {folder}</span>}
    </span>
  )
}

type Port = Awaited<ReturnType<Window['deck']['ports']>>[number]

/** Commands Claude ran, with the servers each one started, and any server the shell started itself. */
function RunningSection({ commands, ports }: { commands: Command[]; ports: Port[] }) {
  const act = useAct()
  const [viewing, setViewing] = useState<string | null>(null)
  // Ticks the running commands' times along.
  const [, setNow] = useState(0)
  const running = commands.filter(c => c.status === 'running')
  useEffect(() => {
    if (running.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running.length > 0])
  const portsOf = (c: Command) => ports.filter(p => p.launchedBy === c.command)
  const loose = ports.filter(p => !running.some(c => p.launchedBy === c.command))
  const busy = running.length + loose.length > 0
  const finished = commands.filter(c => c.status !== 'running').reverse()
  // While something runs, what already finished waits behind a button.
  const [finishedShown, more] = useShowMore(finished, busy ? 0 : 3, n => (busy ? `${n} finished` : `${n} more`))

  const openPort = (port: number) => act(() => window.open(`http://localhost:${port}`))
  const row = (c: Command) => {
    const state = commandState(c)
    return (
      <div key={c.id} className="command-row">
        <button className="info-row" title={c.command} onClick={() => setViewing(c.id)}>
          {c.status === 'running' ? <span className="live-dot" /> : <span className={`command-dot ${state.tone}`} />}
          <span className="info-file">
            {c.description ?? c.command}
            {c.description && <span className="info-folder"> {c.command}</span>}
          </span>
          <span className={`info-lines ${state.tone === 'red' ? 'removed' : ''}`}>
            {c.status === 'running' ? duration(Date.now() - c.started) : c.status === 'done' ? ago(c.ended ?? c.started) : state.label}
          </span>
        </button>
        {c.status === 'running' && portsOf(c).map(({ port }) => (
          <button key={port} className="info-chip green port-chip" title={`Open http://localhost:${port}`} onClick={openPort(port)}>:{port}</button>
        ))}
      </div>
    )
  }
  const shown = commands.find(c => c.id === viewing)
  const summary = busy
    ? [running.length > 0 && `${running.length} running`, ...ports.map(p => `:${p.port}`)].filter(Boolean).join(' · ')
    : `${finished.length} finished`
  return (
    <Section
      id="running"
      title={busy ? 'Running' : 'Commands'}
      icon={<SquareTerminal size={12} strokeWidth={2.2} />}
      tone="green"
      detail={running.length > 0 && <span className="info-chip green">{running.length} running</span>}
      summary={summary}
    >
      {running.map(row)}
      {loose.map(({ port, command }) => (
        <button key={port} className="info-row" title={`Open http://localhost:${port}`} onClick={openPort(port)}>
          <span className="live-dot" />
          <span className="info-file">localhost:{port}<span className="info-folder"> {command}</span></span>
        </button>
      ))}
      {finishedShown.map(row)}
      {more}
      {shown && <CommandViewer command={shown} onClose={() => setViewing(null)} />}
    </Section>
  )
}

function ChangesSection({ git, lines: { added, removed }, edited }: { git: GitDetails; lines: Lines; edited: string[] }) {
  const open = useOpenFile()
  const editor = useEditor()
  const [files, more] = useShowMore(git.files, 6)
  const count = git.files.length + git.moreFiles
  return (
    <Section
      id="changes"
      title="Changes"
      icon={<FileDiff size={12} strokeWidth={2.2} />}
      tone="orange"
      detail={count > 0 && `${count} files`}
      summary={count > 0 ? <><span className="added">+{added}</span> <span className="removed">−{removed}</span> · {count} files</> : 'None'}
    >
      {added + removed > 0 && (
        <div className="diffstat" role="img" aria-label={`${added} lines added, ${removed} removed`}>
          {added > 0 && <span className="diffstat-added" style={{ flexGrow: added }} />}
          {removed > 0 && <span className="diffstat-removed" style={{ flexGrow: removed }} />}
        </div>
      )}
      {git.files.length === 0 && <p className="info-empty">No changes since the last commit.</p>}
      {files.map(file => (
        <button key={file.path} className="info-row" title={`${KIND[file.kind][1]} (⌘-click opens in ${editor.name})`} onClick={open(file.path)}>
          <span className={`info-kind ${file.kind}`}>{KIND[file.kind][0]}</span>
          <FileName file={file.path} root={git.root} />
          {edited.includes(file.path) && <Sparkle className="info-edited" size={11} strokeWidth={2.2} aria-label="Edited by Claude" />}
          <span className="info-lines">
            {file.added > 0 && <span className="added">+{file.added}</span>}
            {file.removed > 0 && <span className="removed"> −{file.removed}</span>}
          </span>
        </button>
      ))}
      {more}
      {git.moreFiles > 0 && (!more || files.length === git.files.length) && <p className="info-empty">and {git.moreFiles} more</p>}
    </Section>
  )
}

/** The branch, where it stands against its upstream, its pull request and its latest commits. */
function BranchSection({ git, pr }: { git: GitDetails; pr: PullRequestInfo['pr'] | null }) {
  const act = useAct()
  const [commits, more] = useShowMore(git.commits, 3, n => `${n} earlier commits`)
  const prState = pr && pr.state[0] + pr.state.slice(1).toLowerCase()
  const prTone = pr && { OPEN: 'green', DRAFT: 'neutral', MERGED: 'accent', CLOSED: 'red' }[pr.state]
  const checks = pr?.checks
  const name = git.branch ?? `Detached at ${git.head}`
  const summary = [
    name,
    git.ahead > 0 && `↑${git.ahead}`,
    git.behind > 0 && `↓${git.behind}`,
    pr && (checks!.failed > 0 ? `${checks!.failed} failing` : `PR ${prState}`),
  ].filter(Boolean).join(' · ')
  return (
    <Section
      id="branch"
      title="Branch"
      icon={<GitBranch size={12} strokeWidth={2.2} />}
      tone="green"
      summary={summary}
    >
      <div className="info-chips">
        <span className="info-chip strong" title={git.upstream ? `Tracks ${git.upstream}` : undefined}>{name}</span>
        {git.upstream
          ? (git.ahead === 0 && git.behind === 0
              ? <span className="info-chip green"><Check size={11} strokeWidth={2.6} />Up to date</span>
              : <>
                  {git.ahead > 0 && <span className="info-chip accent" title="Commits to push"><ArrowUp size={11} strokeWidth={2.6} />{git.ahead}</span>}
                  {git.behind > 0 && <span className="info-chip orange" title="Commits to pull"><ArrowDown size={11} strokeWidth={2.6} />{git.behind}</span>}
                </>)
          : <span className="info-chip">Not pushed yet</span>}
        {git.stashes > 0 && <span className="info-chip" title="Stashes"><Archive size={11} strokeWidth={2.2} />{git.stashes}</span>}
      </div>
      {pr && (
        <>
          <button className="info-row info-pr" title={pr.url || undefined} onClick={act(() => window.open(pr.url))}>
            <GitPullRequest className="info-pr-icon" size={12} strokeWidth={2.2} />
            <span className="info-file">{pr.title}<span className="info-folder"> #{pr.number}</span></span>
            <span className={`info-chip ${prTone}`}>{prState}</span>
          </button>
          {(checks!.passed + checks!.failed + checks!.pending > 0 || pr.review) && (
            <div className="info-chips">
              {checks!.failed > 0 && <span className="info-chip red"><X size={11} strokeWidth={2.6} />{checks!.failed} failing</span>}
              {checks!.pending > 0 && <span className="info-chip orange"><Clock3 size={11} strokeWidth={2.4} />{checks!.pending} running</span>}
              {checks!.passed > 0 && <span className="info-chip green"><Check size={11} strokeWidth={2.6} />{checks!.passed} passed</span>}
              {pr.review && <span className={`info-chip ${REVIEW_TONE[pr.review]}`}>{REVIEW[pr.review]}</span>}
            </div>
          )}
        </>
      )}
      <div className="info-commits">
        {commits.map(commit => (
          <div key={commit.hash} className="info-commit" title={`${commit.hash} by ${commit.author}${commit.pushed ? '' : ', not pushed'}`}>
            <span className={`info-dot ${commit.pushed ? '' : 'unpushed'}`} />
            <span className="info-file">{commit.subject}</span>
            <span className="info-lines">{ago(commit.time)}</span>
          </div>
        ))}
      </div>
      {more}
    </Section>
  )
}

function ClaudeSection({ claude, root, showEdited }: { claude: ClaudeInfo; root?: string; showEdited: boolean }) {
  const open = useOpenFile()
  const editor = useEditor()
  const [setup, setSetup] = useState(false)
  const facts = [
    `${claude.prompts} prompt${claude.prompts === 1 ? '' : 's'}`,
    claude.started && (ago(claude.started) === 'now' ? 'started just now' : `started ${ago(claude.started)} ago`),
    claude.compactions > 0 && `compacted ${claude.compactions}×`,
  ].filter(Boolean)
  // What Claude was set up with rarely changes, so it waits behind one line.
  const setupLine = [
    claude.instructions.length > 0 && `${claude.instructions.length} instruction file${claude.instructions.length === 1 ? '' : 's'}`,
    claude.skills.length > 0 && `${claude.skills.length} skills`,
  ].filter(Boolean).join(' · ')
  const model = claude.model && <span className="info-chip accent">{modelName(claude.model)}</span>
  return (
    <Section id="claude" title="Claude" icon={<Sparkles size={12} strokeWidth={2.2} />} tone="accent" detail={model} summary={<>{facts[0]} {model}</>}>
      <p className="info-note">{facts.join(' · ')}</p>
      {claude.series.length > 1 && <ContextChart series={claude.series} />}
      {claude.turns.length > 0 && <TurnsChart turns={claude.turns} />}
      {/* With git, the Changes card marks Claude's edits; without it, this is the only list of them. */}
      {showEdited && claude.edited.length > 0 && (
        <>
          <h4 className="info-subtitle">Edited</h4>
          {claude.edited.map(file => (
            <button key={file} className="info-row" title={`Show (⌘-click opens in ${editor.name})`} onClick={open(file)}>
              <Sparkle className="info-edited" size={11} strokeWidth={2.2} />
              <FileName file={file} root={root} />
            </button>
          ))}
        </>
      )}
      {setupLine && <button className="info-show-more" aria-expanded={setup} onClick={() => setSetup(!setup)}>{setup ? 'Hide instructions and skills' : setupLine}</button>}
      {setup && (
        <>
          {claude.instructions.map(({ path, type }) => (
            <button key={path} className="info-row" title={`Show (⌘-click opens in ${editor.name})`} onClick={open(path)}>
              <FileName file={path} root={root} />
              {type && <span className="info-lines">{type}</span>}
            </button>
          ))}
          {claude.skills.length > 0 && <p className="info-skills">{claude.skills.join(', ')}</p>}
        </>
      )}
    </Section>
  )
}

function ScratchpadSection({ scratchpad: { dir, files, more: unlisted } }: { scratchpad: NonNullable<ClaudeInfo['scratchpad']> }) {
  const open = useOpenFile()
  const act = useAct()
  const editor = useEditor()
  const [shown, more] = useShowMore(files, 3)
  const count = files.length + unlisted
  return (
    <Section
      id="scratchpad"
      title="Scratchpad"
      icon={<NotebookPen size={12} strokeWidth={2.2} />}
      tone="neutral"
      detail={
        <button className="info-chip info-open" title={home(dir)} onClick={act(() => window.deck.openFolder(dir))}>
          <FolderOpen size={11} strokeWidth={2.2} />Open
        </button>
      }
      summary={`${count} file${count === 1 ? '' : 's'}`}
    >
      {shown.map(file => (
        <button
          key={file.path}
          className="info-row"
          title={file.folder ? 'Open in Finder' : `Show (⌘-click opens in ${editor.name})`}
          onClick={file.folder ? act(() => window.deck.openFolder(file.path)) : open(file.path)}
        >
          {file.folder && <Folder className="info-folder" size={11} strokeWidth={2.2} />}
          <span className="info-file">{base(file.path)}</span>
          <span className="info-lines">{ago(file.time)}</span>
        </button>
      ))}
      {more}
      {unlisted > 0 && shown.length === files.length && <p className="info-empty">and {unlisted} more in its folder</p>}
    </Section>
  )
}

function WorktreeSection({ git, session, onNewSession }: {
  git: GitDetails
  session: Session
  onNewSession: (options: { groupId: string | null; cwd: string }) => void
}) {
  const sessions = useStore(s => s.sessions)
  // Linked worktrees usually sit inside the main checkout's folder, so a folder belongs to the
  // deepest worktree that contains it.
  const owner = (cwd: string) => git.worktrees
    .filter(t => cwd === t.path || cwd.startsWith(`${t.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return (
    <Section id="worktrees" title="Worktrees" icon={<FolderTree size={12} strokeWidth={2.2} />} tone="neutral" detail={`${git.worktrees.length}`}>
      {git.worktrees.map(tree => {
        const there = sessions.find(s => s.id !== session.id && owner(s.cwd)?.path === tree.path)
        return (
          <button
            key={tree.path}
            className={`info-row ${tree.current ? 'current' : ''}`}
            disabled={tree.current}
            title={tree.current ? 'This session’s worktree' : there ? `Show “${there.name}”` : 'New session in this worktree'}
            onClick={() => (there ? openSession(there.id) : onNewSession({ groupId: session.groupId, cwd: tree.path }))}
          >
            <span className="info-file">
              {base(tree.path)}
              {tree.branch && <span className="info-folder"> {tree.branch}</span>}
            </span>
            <span className="info-lines">{tree.current ? 'This one' : there ? there.name : 'New Session…'}</span>
          </button>
        )
      })}
    </Section>
  )
}
