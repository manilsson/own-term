import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlarmClock, ArrowUpRight, Check, Circle, CircleCheck, Clock3, Copy, Eye, GitMerge, GitPullRequest, GitPullRequestDraft, ListTodo,
  Play, Plus, RefreshCw, Settings2, Sparkle, Sparkles, SquareTerminal, TriangleAlert, X,
} from 'lucide-react'
import { announce, groupColor, GROUP_COLORS, orderedSessions, setState, useStore, type Note, type Session } from './store'
import { StatusIcon } from './StatusIcon'
import { formatDue, noteRef, useNow } from './reminders'
import { addNote, editNote, removeNote, setNoteDone } from './notes'
import { closePage, openSession } from './workspace'
import { Editable } from './Editable'
import { TodayChat } from './TodayChat'
import {
  baseName, freshen, githubOk, isDemo, linearOk, loadJournal, visibleNotes, openLink, refreshAll, reviewWithClaude, settingsChanged, startOnIssue, summaryOf, useStatus, write,
} from './status'
import { chooseProject, useScope } from './projects'

// The Today page: what needs you and what to pick up, with Claude's brief on top; and the Week, with
// the standup Claude writes and what happened day by day. Data comes from status.ts.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function ago(t: number, now = Date.now()) {
  const minutes = Math.round((now - t) / MINUTE)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 60 / 24)} d`
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function greeting(now: Date) {
  const hour = now.getHours()
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

const TAB_KEY = 'deckterm.statusTab'

/** `tabs`: show the project tabs, which the rail beside the sidebar stands in for while it's showing. */
export function StatusPage({ onSettings, tabs }: { onSettings: () => void; tabs: boolean }) {
  const [tab, setTab] = useState<'today' | 'week'>(() => (localStorage.getItem(TAB_KEY) === 'week' ? 'week' : 'today'))
  useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab])
  const project = useScope().project?.name ?? ''
  useEffect(() => void freshen(tab), [tab, project])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A sheet over the page, or a field on it, keeps its own Escape.
      if (e.key !== 'Escape' || document.querySelector('.sheet-backdrop, .palette')) return
      if ((e.target as HTMLElement).closest('input, textarea')) return
      closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="status-page">
      <div className={`status-inner ${tab}`}>
        <Header tab={tab} setTab={setTab} onSettings={onSettings} />
        <ProjectTabs shown={tabs} />
        <div className="status-body" key={`${tab}:${project}`}>
          {tab === 'today' ? <Today onSettings={onSettings} /> : <Week />}
        </div>
      </div>
      <TodayChat key={`${tab}:${project}`} scope={tab} project={project} />
    </div>
  )
}

function Header({ tab, setTab, onSettings }: { tab: 'today' | 'week'; setTab: (t: 'today' | 'week') => void; onSettings: () => void }) {
  const now = new Date(useNow())
  // The demo day is photographed for the site, so it greets the invented person whose day it is.
  const demo = useStore(isDemo)
  const name = useMemo(() => (demo ? 'Sam' : window.deck.userName().split(/\s+/)[0]), [demo])
  const collecting = useStatus(s => s.collecting)
  const key = useScope().project?.name ?? ''
  const writing = useStatus(s => summaryOf(s, 'brief', key).writing)
  return (
    <header className="status-head">
      <div className="status-hello">
        <span className="status-date">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
      </div>
      <div className="status-tools">
        <div className="segmented" role="tablist">
          {(['today', 'week'] as const).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'today' ? 'Today' : 'Week'}
            </button>
          ))}
        </div>
        <button className="status-tool" title="Refresh pull requests and issues, and rewrite the brief" onClick={refreshAll} disabled={collecting || writing}>
          <RefreshCw size={15} strokeWidth={1.8} className={collecting || writing ? 'spinning' : ''} />
        </button>
        <button className="status-tool" title="Settings (⌘,)" onClick={onSettings}>
          <Settings2 size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}

/** Everything, or one project: every card on both tabs shows only what's in it. Beside the rail, which chooses the same, there are none. */
function ProjectTabs({ shown }: { shown: boolean }) {
  const { projects, project } = useScope()
  if (!shown || projects.list.length < 2) return null
  return (
    <nav className="project-tabs" role="tablist" aria-label="Projects">
      {[{ name: '' }, ...projects.list].map(p => {
        const on = (project?.name ?? '') === p.name
        return (
          <button key={p.name} role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => chooseProject(p.name)}>
            {p.name || 'All'}
          </button>
        )
      })}
    </nav>
  )
}

// ── Today ─────────────────────────────────────────────────────────────────────────────────────

function Today({ onSettings }: { onSettings: () => void }) {
  const sizes = useCardSizes()
  // Each card goes to the shorter column so far, so an empty Pick Up and To-dos don't leave a hole
  // beside a long list of pull requests. Sizes are in rows, close enough to keep the two even.
  const cards: [number, ReactNode][] = [
    [sizes.pickup, <PickUp key="pickup" />],
    [sizes.reviews, <Reviews key="reviews" onSettings={onSettings} />],
    [sizes.pulls, <MyPulls key="pulls" />],
    [sizes.todos, <Todos key="todos" />],
  ]
  const columns: ReactNode[][] = [[], []]
  const heights = [0, 0]
  for (const [size, card] of cards) {
    const shorter = heights[0] <= heights[1] ? 0 : 1
    columns[shorter].push(card)
    heights[shorter] += size
  }
  return (
    <>
      <BriefCard />
      <Tiles />
      <div className="status-grid">
        <div className="status-column">{columns[0]}</div>
        <div className="status-column">{columns[1]}</div>
      </div>
      <Issues onSettings={onSettings} />
    </>
  )
}

/** About how tall each card is, in rows (a card's header counts as one), for laying out the columns. */
function useCardSizes() {
  const scope = useScope()
  const sessions = useStore(s => s.sessions).filter(scope.session)
  const git = useStore(s => s.git)
  const status = useStore(s => s.status)
  const needsSince = useStore(s => s.needsSince)
  const needs = sessions.filter(x => needsSince[x.id]).length
  const todos = useStore(visibleNotes).filter(n => !n.done && scope.note(n)).length
  const data = useStatus(s => s.data)
  const now = useNow()
  const gh = useScopedGithub()
  const endOfDay = new Date(now).setHours(23, 59, 59, 999)
  const later = sessions.filter(x => x.remind && x.remind.at <= endOfDay).length
  const loose = sessions.filter(x => !needsSince[x.id] && status[x.id] !== 'working' && git[x.id] && (git[x.id]!.added || git[x.id]!.removed || git[x.id]!.untracked)).length
  const fresh = gh?.review.filter(pr => now - (pr.waitingSince ?? pr.created) < STALE).length ?? 0
  return {
    pickup: 1 + Math.max(1, needs + later) + (later ? 0.6 : 0) + (loose ? 0.6 + loose : 0),
    reviews: 1 + Math.max(1, fresh) + (gh && gh.review.length > fresh ? 0.6 : 0),
    pulls: gh ? 1 + Math.max(1, gh.mine.length) : 0,
    todos: 1.8 + Math.max(0.6, todos),
  }
}

const scrollTo = (id: string) => document.getElementById(`status-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** GitHub's lists, only the project's pull requests. */
function useScopedGithub() {
  const data = useStatus(s => s.data)
  const scope = useScope()
  return useMemo(() => {
    const gh = githubOk(data?.github)
    if (!gh || !scope.project) return gh
    return { ...gh, mine: gh.mine.filter(scope.pr), review: gh.review.filter(scope.pr), merged: gh.merged.filter(scope.pr), reviewed: gh.reviewed.filter(scope.pr) }
  }, [data, scope])
}

/** Linear's lists, only the project's issues. */
function useScopedLinear() {
  const data = useStatus(s => s.data)
  const scope = useScope()
  return useMemo(() => {
    const lin = linearOk(data?.linear)
    if (!lin || !scope.project) return lin
    return { ...lin, open: lin.open.filter(scope.issue), done: lin.done.filter(scope.issue) }
  }, [data, scope])
}

function Tiles() {
  const scope = useScope()
  const needs = useStore(s => s.sessions.filter(x => s.needsSince[x.id] && scope.session(x)).length)
  const todos = useStore(s => visibleNotes(s).filter(n => !n.done && scope.note(n)).length)
  const gh = useScopedGithub()
  const lin = useScopedLinear()
  const fix = gh?.mine.filter(p => p.attention === 'fix').length ?? 0
  const yours = gh?.mine.filter(p => p.attention === 'fix' || p.attention === 'reply').length ?? 0
  const started = lin?.open.filter(i => i.state.type === 'started').length ?? 0
  const tiles: { id: string; icon: ReactNode; tone: string; count: number | string; label: string; detail?: string }[] = [
    { id: 'pickup', icon: <Clock3 size={15} strokeWidth={2.4} />, tone: 'orange', count: needs, label: 'Needs You' },
    { id: 'reviews', icon: <Eye size={15} strokeWidth={2.2} />, tone: 'accent', count: gh ? gh.review.length : '–', label: 'To Review' },
    { id: 'pulls', icon: <GitPullRequest size={15} strokeWidth={2.2} />, tone: fix ? 'red' : yours ? 'orange' : 'green', count: gh ? gh.mine.length : '–', label: 'Your PRs', detail: yours ? `${yours} need${yours === 1 ? 's' : ''} you` : undefined },
    ...(lin ? [{ id: 'issues', icon: <IssueGlyph size={15} />, tone: 'purple', count: lin.open.length, label: 'Issues', detail: started ? `${started} in progress` : undefined }] : []),
    { id: 'todos', icon: <ListTodo size={15} strokeWidth={2.2} />, tone: 'gray', count: todos, label: 'To-dos' },
  ]
  return (
    <div className="status-tiles">
      {tiles.map(t => (
        <button key={t.id} className={`status-tile ${t.tone} ${t.count === 0 ? 'quiet' : ''}`} onClick={() => scrollTo(t.id)}>
          <span className="status-tile-icon">{t.icon}</span>
          <span className="status-tile-count">{t.count}</span>
          <span className="status-tile-label">{t.label}</span>
          {t.detail && <span className="status-tile-detail">{t.detail}</span>}
        </button>
      ))}
    </div>
  )
}

function IssueGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ── Claude's brief ────────────────────────────────────────────────────────────────────────────

function BriefCard() {
  const project = useScope().project
  const brief = useStatus(s => summaryOf(s, 'brief', project?.name))
  const ai = useStatus(s => s.settings?.ai ?? true)
  const counts = useCounts()
  const now = useNow()
  if (!ai) return null
  const value = brief.value
  // A brief saved by another version may lack a section; it shows without it.
  const threads = value?.threads ?? []
  const risks = value?.risks ?? []
  const old = brief.at && new Date(brief.at).setHours(0, 0, 0, 0) < new Date(now).setHours(0, 0, 0, 0)
  return (
    <section className={`brief ${brief.writing ? 'writing' : ''}`}>
      <div className="brief-glow" aria-hidden="true" />
      <header className="brief-head">
        <span className="brief-label"><Sparkles size={13} strokeWidth={2} />Brief</span>
        <span className="brief-when">
          {brief.writing ? 'Claude is writing…' : brief.at ? `Written ${old ? formatDue(brief.at, now).replace(/^at /, '') : `at ${clock(brief.at)}`}` : ''}
        </span>
        {value && !brief.writing && (
          <button className="brief-action" onClick={() => write('brief')}>
            <RefreshCw size={12} strokeWidth={2} />Rewrite
          </button>
        )}
      </header>
      {!value && brief.writing && <BriefLoading counts={counts} />}
      {!value && !brief.writing && (
        <div className="brief-empty">
          <p>{brief.error ? `Claude couldn’t write the brief: ${brief.error}` : `Claude reads ${project ? `${project.name}’s` : 'your'} sessions, pull requests, issues and to-dos, and tells you where to start.`}</p>
          <button className="push-button default" onClick={() => write('brief')}>{brief.error ? 'Try Again' : 'Write the Brief'}</button>
        </div>
      )}
      {value && (
        <div className="brief-body">
          <h2 className="brief-headline">{value.headline}</h2>
          {value.focus.length > 0 && (
            <ol className="brief-focus">
              {value.focus.map((f, i) => (
                <li key={i} className="focus-item" style={{ '--i': i } as CSSProperties}>
                  <span className="focus-number">{i + 1}</span>
                  <span className="focus-title">{f.title}</span>
                  <span className="focus-why">{f.why}</span>
                  <Refs refs={f.refs} />
                </li>
              ))}
            </ol>
          )}
          {(threads.length > 0 || risks.length > 0) && (
            <div className="brief-more">
              {threads.length > 0 && (
                <div className="brief-threads">
                  <h3>Where things stand</h3>
                  {threads.map((t, i) => (
                    <div key={i} className="thread">
                      <span className="thread-name">{t.name}</span>
                      <span className="thread-summary">{t.summary}<Refs refs={t.refs} /></span>
                    </div>
                  ))}
                </div>
              )}
              {risks.length > 0 && (
                <div className="brief-risks">
                  <h3>Watch out</h3>
                  {risks.map((r, i) => (
                    <div key={i} className="risk">
                      <TriangleAlert size={13} strokeWidth={2} />
                      <span>{r.text}<Refs refs={r.refs} /></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {brief.error && <p className="brief-error">Couldn’t rewrite it: {brief.error}</p>}
        </div>
      )}
    </section>
  )
}

function useCounts() {
  const scope = useScope()
  const sessions = useStore(s => s.sessions.filter(x => !x.demo && scope.session(x)).length)
  const gh = useScopedGithub()
  const lin = useScopedLinear()
  return { sessions, prs: gh ? gh.mine.length + gh.review.length : 0, issues: lin?.open.length ?? 0 }
}

function BriefLoading({ counts }: { counts: { sessions: number; prs: number; issues: number } }) {
  const parts = [
    `${counts.sessions} session${counts.sessions === 1 ? '' : 's'}`,
    counts.prs && `${counts.prs} pull request${counts.prs === 1 ? '' : 's'}`,
    counts.issues && `${counts.issues} issue${counts.issues === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return (
    <div className="brief-loading">
      <div className="shimmer wide" />
      <div className="shimmer" />
      <div className="brief-loading-focus">
        <div className="shimmer block" />
        <div className="shimmer block" />
        <div className="shimmer block" />
      </div>
      <p>Claude is reading {said}…</p>
    </div>
  )
}

/** The items a line of the brief is about, as chips that open them. */
function Refs({ refs }: { refs: string[] }) {
  const [all, setAll] = useState(false)
  if (!refs.length) return null
  // A line about eight pull requests would be more chips than words.
  const shown = all || refs.length <= 5 ? refs : refs.slice(0, 4)
  return (
    <span className="refs">
      {shown.map(ref => <RefChip key={ref} refId={ref} />)}
      {shown.length < refs.length && <button className="ref-chip" onClick={() => setAll(true)}>+{refs.length - shown.length}</button>}
    </span>
  )
}

export function RefChip({ refId }: { refId: string }) {
  const data = useStatus(s => s.data)
  const session = useStore(s => (refId.startsWith('session:') ? s.sessions.find(x => x.id === refId.slice(8)) : undefined))
  const note = useStore(s => (refId.startsWith('note:') ? visibleNotes(s).find(n => n.id === refId.slice(5)) : undefined))
  if (refId.startsWith('pr:')) {
    const gh = githubOk(data?.github)
    const pr = gh && [...gh.mine, ...gh.review, ...gh.merged, ...gh.reviewed].find(p => p.id === refId)
    const number = refId.match(/#(\d+)$/)?.[1]
    if (!number) return null
    return (
      <button className={`ref-chip pr ${pr?.attention ?? ''} ${pr?.mergedAt ? 'merged' : ''}`} title={pr ? `${pr.repo}#${pr.number} ${pr.title}` : refId.slice(3)} onClick={() => pr && openLink(pr.url)}>
        {pr?.mergedAt ? <GitMerge size={11} strokeWidth={2.2} /> : <GitPullRequest size={11} strokeWidth={2.2} />}#{number}
      </button>
    )
  }
  if (refId.startsWith('issue:')) {
    const lin = linearOk(data?.linear)
    const issue = lin && [...lin.open, ...lin.done].find(i => i.id === refId)
    return (
      <button className="ref-chip issue" title={issue?.title} style={{ '--state': issue?.state.color } as CSSProperties} onClick={() => issue && openLink(issue.url)}>
        <span className="ref-state" />{refId.slice(6)}
      </button>
    )
  }
  if (session) {
    return (
      <button className="ref-chip session" title={`Open ${session.name}`} onClick={() => openSession(session.id)}>
        <StatusIcon session={session} size={12} />{session.name}
      </button>
    )
  }
  if (note) {
    return (
      <button className="ref-chip note" title={note.text} onClick={() => scrollTo('todos')}>
        {note.done ? <CircleCheck size={11} strokeWidth={2.2} /> : <ListTodo size={11} strokeWidth={2.2} />}{note.text.length > 28 ? `${note.text.slice(0, 27)}…` : note.text}
      </button>
    )
  }
  return null
}

// ── Cards ─────────────────────────────────────────────────────────────────────────────────────

export function Card({ id, icon, tone, title, count, action, children, className = '' }: {
  id: string
  icon: ReactNode
  tone: string
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`status-card ${className}`} id={`status-${id}`}>
      <header className="status-card-head">
        <span className={`status-card-icon ${tone}`}>{icon}</span>
        <h2>{title}</h2>
        {count !== undefined && count > 0 && <span className="status-count">{count}</span>}
        <span className="status-card-action">{action}</span>
      </header>
      <div className="status-card-body">{children}</div>
    </section>
  )
}

export function Row({ lead, title, sub, meta, actions, onClick, onContextMenu, className = '' }: {
  lead: ReactNode
  title: ReactNode
  sub?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  onClick?: () => void
  onContextMenu?: () => void
  className?: string
}) {
  return (
    <div
      className={`status-row ${onClick ? 'clickable' : ''} ${actions ? 'has-actions' : ''} ${className}`}
      onClick={onClick}
      onContextMenu={onContextMenu && (e => {
        e.preventDefault()
        onContextMenu()
      })}
    >
      <span className="status-row-lead">{lead}</span>
      <span className="status-row-text">
        <span className="status-row-title">{title}</span>
        {sub && <span className="status-row-sub">{sub}</span>}
      </span>
      {meta && <span className="status-row-meta">{meta}</span>}
      {actions && <span className="status-row-actions" onClick={e => e.stopPropagation()}>{actions}</span>}
    </div>
  )
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="status-empty">{icon ?? <Check size={14} strokeWidth={2.4} />}{children}</p>
}

export function Subhead({ children }: { children: ReactNode }) {
  return <h3 className="status-subhead">{children}</h3>
}

export function GroupTag({ session }: { session: Session }) {
  const group = useStore(s => s.groups.find(g => g.id === session.groupId))
  if (!group) return null
  return <span className="status-group"><span className="tag-dot" style={{ background: groupColor(group) }} />{group.name}</span>
}

// ── Pick up ───────────────────────────────────────────────────────────────────────────────────

function PickUp() {
  const scope = useScope()
  const sessions = useStore(s => s.sessions).filter(scope.session)
  const groups = useStore(s => s.groups)
  const needsSince = useStore(s => s.needsSince)
  const activity = useStore(s => s.activity)
  const git = useStore(s => s.git)
  const status = useStore(s => s.status)
  const now = useNow()
  const ordered = orderedSessions({ groups, sessions })
  const waiting = ordered.filter(x => needsSince[x.id]).sort((a, b) => needsSince[a.id] - needsSince[b.id])
  const endOfDay = new Date(now).setHours(23, 59, 59, 999)
  const later = ordered.filter(x => x.remind && x.remind.at <= endOfDay).sort((a, b) => a.remind!.at - b.remind!.at)
  const working = ordered.filter(x => status[x.id] === 'working')
  const loose = ordered.filter(x => !needsSince[x.id] && status[x.id] !== 'working' && git[x.id] && (git[x.id]!.added || git[x.id]!.removed || git[x.id]!.untracked))
  const total = waiting.length + later.length
  return (
    <Card id="pickup" icon={<Clock3 size={13} strokeWidth={2.4} />} tone="orange" title="Pick Up" count={total}>
      {waiting.map(x => (
        <Row
          key={x.id}
          lead={<StatusIcon session={x} />}
          title={<>{x.name}<GroupTag session={x} /></>}
          sub={activity[x.id]?.text}
          meta={ago(needsSince[x.id], now)}
          onClick={() => openSession(x.id)}
        />
      ))}
      {later.length > 0 && <Subhead>Reminders today</Subhead>}
      {later.map(x => (
        <Row
          key={x.id}
          lead={<span className="status-icon later-icon"><AlarmClock size={14} strokeWidth={2} /></span>}
          title={<>{x.name}<GroupTag session={x} /></>}
          sub={x.remind!.note}
          meta={<span className="accent-text">{formatDue(x.remind!.at, now)}</span>}
          onClick={() => openSession(x.id)}
        />
      ))}
      {total === 0 && <Empty>Nothing is waiting for you{working.length ? `; Claude is working in ${working.length} session${working.length === 1 ? '' : 's'}` : ''}.</Empty>}
      {loose.length > 0 && <Subhead>Uncommitted work</Subhead>}
      {loose.map(x => {
        const g = git[x.id]!
        return (
          <Row
            key={x.id}
            lead={<StatusIcon session={x} />}
            title={<>{x.name}<GroupTag session={x} /></>}
            sub={g.branch}
            meta={(
              <span className="status-diff">
                {g.added > 0 && <span className="added">+{g.added}</span>}
                {g.removed > 0 && <span className="removed">−{g.removed}</span>}
                {g.untracked > 0 && <span>{g.untracked} new</span>}
              </span>
            )}
            onClick={() => openSession(x.id)}
          />
        )
      })}
    </Card>
  )
}

// ── Pull requests ─────────────────────────────────────────────────────────────────────────────

/** Sessions on a branch, so a pull request can show and open the one working on it. */
function useSessionOn(branch?: string | null) {
  return useStore(s => (branch ? s.sessions.find(x => s.git[x.id]?.branch === branch) : undefined))
}

async function prMenu(pr: StatusPr) {
  const choice = await window.deck.popupMenu([
    { id: 'open', label: 'Open on GitHub' },
    { id: 'copy', label: 'Copy Link' },
    { type: 'separator' },
    { id: 'mute', label: `Hide Pull Requests from ${pr.repo}` },
  ])
  if (choice === 'open') openLink(pr.url)
  if (choice === 'copy') navigator.clipboard.writeText(pr.url)
  if (choice === 'mute') {
    const settings = await window.deck.statusSettings()
    settingsChanged(await window.deck.saveStatusSettings({ mutedRepos: [...settings.mutedRepos, pr.repo] }))
    announce(`Pull requests from ${pr.repo} are hidden; Settings shows them again`)
  }
}

const repoName = (repo: string) => repo.split('/')[1] ?? repo

function GithubProblem({ error, onSettings }: { error: string; onSettings: () => void }) {
  return (
    <div className="status-problem">
      <p>{error}</p>
      <button className="push-button" onClick={onSettings}>Settings…</button>
    </div>
  )
}

function Reviews({ onSettings }: { onSettings: () => void }) {
  const data = useStatus(s => s.data)
  const now = useNow()
  const gh = useScopedGithub()
  return (
    <Card id="reviews" icon={<Eye size={13} strokeWidth={2.2} />} tone="accent" title="Review Requests" count={gh?.review.length}>
      {!data && <Loading />}
      {data?.github.error && <GithubProblem error={data.github.error} onSettings={onSettings} />}
      {gh && gh.review.length === 0 && <Empty>No one is waiting for your review.</Empty>}
      {gh && <ReviewRows prs={gh.review} now={now} />}
    </Card>
  )
}

// Requests left for a month are rarely still meant; they go last, out of the way of this week's.
const STALE = 30 * DAY

function ReviewRows({ prs, now }: { prs: StatusPr[]; now: number }) {
  const fresh = prs.filter(pr => now - (pr.waitingSince ?? pr.created) < STALE)
  const stale = prs.filter(pr => !fresh.includes(pr))
  const [showStale, setShowStale] = useState(false)
  return (
    <>
      {fresh.map(pr => <ReviewRow key={pr.id} pr={pr} now={now} />)}
      {stale.length > 0 && (
        <button className="status-more" onClick={() => setShowStale(!showStale)}>
          {showStale ? 'Hide' : 'Show'} {stale.length} older than a month
        </button>
      )}
      {showStale && stale.map(pr => <ReviewRow key={pr.id} pr={pr} now={now} />)}
    </>
  )
}

function ReviewRow({ pr, now }: { pr: StatusPr; now: number }) {
  const since = pr.waitingSince ?? pr.created
  return (
    <Row
      lead={<Avatar login={pr.author} />}
      title={pr.title}
      sub={<>{repoName(pr.repo)} #{pr.number} · {pr.author}{pr.rereview && <span className="status-badge accent">{pr.requested === false ? 'Updated' : 'Re-review'}</span>}{pr.change && <> {pr.change}</>}{pr.draft && <span className="status-badge">Draft</span>}</>}
      meta={<span className={`status-wait ${now - since >= 3 * DAY ? 'long' : ''}`}>{ago(since, now)}</span>}
      actions={(
        <>
          <button className="row-button" title="Check it out in a worktree and have Claude review it" onClick={() => reviewWithClaude(pr)}>
            <Sparkle size={12} strokeWidth={2.2} />Review with Claude
          </button>
          <button className="row-icon-button" title="Open on GitHub" onClick={() => openLink(pr.url)}><ArrowUpRight size={14} strokeWidth={2} /></button>
        </>
      )}
      onClick={() => openLink(pr.url)}
      onContextMenu={() => prMenu(pr)}
    />
  )
}

const ATTENTION_ORDER = { fix: 0, reply: 1, ready: 2, waiting: 3, draft: 4 }

function MyPulls() {
  const gh = useScopedGithub()
  const mine = useMemo(() => [...(gh?.mine ?? [])].sort((a, b) => ATTENTION_ORDER[a.attention!] - ATTENTION_ORDER[b.attention!] || b.updated - a.updated), [gh])
  if (!gh) return null
  return (
    <Card id="pulls" icon={<GitPullRequest size={13} strokeWidth={2.2} />} tone={mine.some(p => p.attention === 'fix') ? 'red' : mine.some(p => p.attention === 'reply') ? 'orange' : 'green'} title="Your Pull Requests" count={mine.length}>
      {mine.length === 0 && <Empty>You have no open pull requests.</Empty>}
      {mine.map(pr => <PullRow key={pr.id} pr={pr} />)}
    </Card>
  )
}

function PullRow({ pr }: { pr: StatusPr }) {
  const session = useSessionOn(pr.branch)
  const now = useNow()
  const Icon = pr.draft ? GitPullRequestDraft : GitPullRequest
  return (
    <Row
      className={`pull ${pr.attention}`}
      lead={<span className={`pull-icon ${pr.attention}`}><Icon size={14} strokeWidth={2} /></span>}
      title={pr.title}
      sub={(
        <>
          {repoName(pr.repo)} #{pr.number} · <span className={`pull-reason ${pr.attention}`}>{pr.reason}</span>
          {pr.issues?.map(i => <RefChip key={i} refId={i} />)}
        </>
      )}
      meta={session ? <span className="status-session" title={session.name}><StatusIcon session={session} size={13} /></span> : ago(pr.updated, now)}
      actions={(
        <>
          {session && (
            <button className="row-button" title={`Open ${session.name}`} onClick={() => openSession(session.id)}>
              <SquareTerminal size={12} strokeWidth={2.2} />Session
            </button>
          )}
          <button className="row-icon-button" title="Open on GitHub" onClick={() => openLink(pr.url)}><ArrowUpRight size={14} strokeWidth={2} /></button>
        </>
      )}
      onClick={() => openLink(pr.url)}
      onContextMenu={() => prMenu(pr)}
    />
  )
}

function Avatar({ login }: { login: string | null }) {
  const initials = (login ?? '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase()
  // A steady color per person, from the group colors, so the same reviewer always looks the same.
  const hue = [...(login ?? '')].reduce((n, c) => n + c.charCodeAt(0), 0)
  return <span className="avatar" style={{ '--avatar': GROUP_COLORS[hue % (GROUP_COLORS.length - 1)].color } as CSSProperties}>{initials}</span>
}

function Loading() {
  return <div className="status-loading"><span className="spinner" />Asking GitHub…</div>
}

// ── Linear ────────────────────────────────────────────────────────────────────────────────────

const STATE_ORDER: Record<string, number> = { started: 0, unstarted: 1 }

function Issues({ onSettings }: { onSettings: () => void }) {
  const data = useStatus(s => s.data)
  const settings = useStatus(s => s.settings)
  const lin = useScopedLinear()
  const groups = useMemo(() => {
    const byState = new Map<string, StatusIssue[]>()
    const sorted = [...(lin?.open ?? [])].sort((a, b) => (STATE_ORDER[a.state.type] ?? 2) - (STATE_ORDER[b.state.type] ?? 2)
      || (a.priority || 5) - (b.priority || 5) || b.updated - a.updated)
    for (const issue of sorted) byState.set(issue.state.name, [...(byState.get(issue.state.name) ?? []), issue])
    return [...byState]
  }, [lin])
  if (settings && !settings.linear.connected) {
    return (
      <section className="status-card connect-card" id="status-issues">
        <span className="connect-icon"><IssueGlyph size={20} /></span>
        <div>
          <h2>Connect Linear</h2>
          <p>See the issues assigned to you here, tied to their pull requests and the sessions working on them, and start one in a worktree.</p>
        </div>
        <button className="push-button default" onClick={onSettings}>Connect…</button>
      </section>
    )
  }
  if (!data?.linear) return null
  return (
    <Card id="issues" icon={<IssueGlyph size={13} />} tone="purple" title="Your Issues" count={lin?.open.length} className="wide">
      {data.linear.error && <div className="status-problem"><p>{data.linear.error}</p><button className="push-button" onClick={onSettings}>Settings…</button></div>}
      {lin && lin.open.length === 0 && <Empty>No open issues are assigned to you.</Empty>}
      {groups.map(([state, issues]) => (
        <div key={state} className="issue-group">
          <Subhead>
            <span className="state-dot" style={{ '--state': issues[0].state.color } as CSSProperties} />
            {state}
            <span className="status-subhead-count">{issues.length}</span>
          </Subhead>
          {issues.map(issue => <IssueRow key={issue.id} issue={issue} />)}
        </div>
      ))}
    </Card>
  )
}

function IssueRow({ issue }: { issue: StatusIssue }) {
  const session = useSessionOn(issue.branch)
  const sub = [issue.project, issue.cycle?.current ? `Cycle ${issue.cycle.number}` : null, issue.due ? `Due ${new Date(issue.due).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')
  return (
    <Row
      className="issue"
      lead={<Priority value={issue.priority} label={issue.priorityLabel} />}
      title={<><span className="issue-id">{issue.identifier}</span>{issue.title}</>}
      sub={(sub || issue.prs?.length) ? <>{sub}{issue.prs?.map(p => <RefChip key={p} refId={p} />)}</> : undefined}
      meta={session && <span className="status-session" title={session.name}><StatusIcon session={session} size={13} /></span>}
      actions={(
        <>
          {session ? (
            <button className="row-button" title={`Open ${session.name}`} onClick={() => openSession(session.id)}>
              <SquareTerminal size={12} strokeWidth={2.2} />Session
            </button>
          ) : (
            <button className="row-button" title="Start it in a worktree on its branch, with Claude given the issue" onClick={() => startOnIssue(issue)}>
              <Play size={11} strokeWidth={2.4} />Start
            </button>
          )}
          <button className="row-icon-button" title="Open in Linear" onClick={() => openLink(issue.url)}><ArrowUpRight size={14} strokeWidth={2} /></button>
        </>
      )}
      onClick={() => openLink(issue.url)}
    />
  )
}

/** Linear's priority marks: bars for high, medium and low, a filled badge for urgent. */
function Priority({ value, label }: { value: number; label?: string }) {
  if (value === 1) return <span className="priority urgent" title={label ?? 'Urgent'}>!</span>
  const bars = value === 2 ? 3 : value === 3 ? 2 : value === 4 ? 1 : 0
  return (
    <svg className="priority" width={14} height={14} viewBox="0 0 14 14" aria-label={label ?? 'No priority'}>
      <title>{label ?? 'No priority'}</title>
      {bars === 0
        ? [2, 6, 10].map(x => <rect key={x} x={x - 1} y={6.25} width={2.5} height={1.5} rx={0.75} fill="currentColor" opacity={0.6} />)
        : [0, 1, 2].map(i => <rect key={i} x={1.5 + i * 4} y={9 - i * 3.5} width={3} height={3.5 + i * 3.5} rx={1} fill="currentColor" opacity={i < bars ? 1 : 0.25} />)}
    </svg>
  )
}

// ── To-dos ────────────────────────────────────────────────────────────────────────────────────

function Todos() {
  const scope = useScope()
  const notes = useStore(visibleNotes).filter(scope.note)
  const [showDone, setShowDone] = useState(false)
  const [text, setText] = useState('')
  const open = notes.filter(n => !n.done)
  const done = notes.filter(n => n.done).sort((a, b) => b.done! - a.done!)
  const add = () => {
    const issue = text.match(/\b([A-Za-z][A-Za-z0-9]{0,9}-\d{1,6})\b/)?.[1]
    if (text.trim()) addNote(text, { issue, project: scope.project?.name })
    setText('')
  }
  return (
    <Card id="todos" icon={<ListTodo size={13} strokeWidth={2.2} />} tone="gray" title="To-dos" count={open.length}
      action={done.length > 0 && <button className="link-button" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide Done' : `Done (${done.length})`}</button>}
    >
      <form className="todo-add" onSubmit={e => { e.preventDefault(); add() }}>
        <Plus size={14} strokeWidth={2.2} />
        <input value={text} placeholder="Add a to-do, or ask Claude to note one" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Escape' && setText('')} />
      </form>
      {open.length === 0 && <p className="todo-empty">Nothing planned. Add one here, or ask Claude in any session to note something for later.</p>}
      {open.map(n => <TodoRow key={n.id} note={n} />)}
      {showDone && done.map(n => <TodoRow key={n.id} note={n} />)}
    </Card>
  )
}

function TodoRow({ note }: { note: Note }) {
  const session = useStore(s => s.sessions.find(x => x.id === note.session))
  const now = useNow()
  return (
    <div className={`status-row todo ${note.done ? 'done' : ''}`}>
      <button className="todo-check" role="checkbox" aria-checked={!!note.done} title={note.done ? 'Mark as not done' : 'Mark as done'} onClick={() => setNoteDone(note.id, !note.done)}>
        <Check size={10} strokeWidth={3.4} />
      </button>
      <span className="status-row-text">
        <span className="status-row-title"><Editable value={note.text} onChange={text => editNote(note.id, text)} /></span>
        {(note.issue || session || note.by === 'claude') && (
          <span className="status-row-sub">
            {note.by === 'claude' && <span className="by-claude"><Sparkle size={10} strokeWidth={2.4} />Claude</span>}
            {note.issue && <RefChip refId={`issue:${note.issue}`} />}
            {session && <RefChip refId={`session:${session.id}`} />}
          </span>
        )}
      </span>
      <span className="status-row-meta">
        {note.done ? `Done ${ago(note.done, now)}`
          : note.due ? <span className="due-now">Due {formatDue(note.due, now)}</span>
          : note.remind ? <span className="accent-text todo-time"><AlarmClock size={11} strokeWidth={2.2} />{formatDue(note.remind, now)}</span>
          : ago(note.created, now)}
      </span>
      <span className="status-row-actions">
        {!note.done && (
          <button className="row-icon-button" title={note.remind ? 'Change Reminder' : 'Remind Me'} onClick={() => setState(() => ({ reminding: noteRef(note.id) }))}>
            <AlarmClock size={13} strokeWidth={2} />
          </button>
        )}
        <button className="row-icon-button" title="Remove" onClick={() => removeNote(note.id)}><X size={13} strokeWidth={2.2} /></button>
      </span>
    </div>
  )
}

// ── Week ──────────────────────────────────────────────────────────────────────────────────────

function Week() {
  useEffect(() => {
    loadJournal()
  }, [])
  return (
    <>
      <StandupCard />
      <Activity />
      <div className="status-grid">
        <div className="status-column"><Shipped /></div>
        <div className="status-column"><Reviewed /></div>
      </div>
    </>
  )
}

type StandupKey = keyof Omit<StandupProject, 'name' | 'summary'>

const SECTIONS: { key: StandupKey; title: string; count: string; tone: string }[] = [
  { key: 'done', title: 'Done', count: 'done', tone: 'green' },
  { key: 'doing', title: 'In Progress', count: 'in progress', tone: 'accent' },
  { key: 'next', title: 'Next', count: 'next', tone: 'gray' },
  { key: 'blockers', title: 'Blockers', count: 'blocked', tone: 'orange' },
]

// Lines of a project are mixed, so each carries its mark to say where it stands.
const MARKS: Record<StandupKey, ReactNode> = {
  done: <CircleCheck size={14} strokeWidth={2} />,
  doing: <IssueGlyph size={13} />,
  next: <Circle size={13} strokeWidth={2} />,
  blockers: <TriangleAlert size={13} strokeWidth={2} />,
}

function StandupCard() {
  const project = useScope().project
  const standup = useStatus(s => summaryOf(s, 'standup', project?.name))
  const ai = useStatus(s => s.settings?.ai ?? true)
  const now = useNow()
  if (!ai) return null
  const value = standup.value
  // Ids aren't for people: a pull request reads as its number, a session as its name.
  const plain = (refs: string[]) => {
    const words = refs.map(ref => {
      if (ref.startsWith('pr:')) return ref.slice(3).replace(/^[^/]+\//, '')
      if (ref.startsWith('issue:')) return ref.slice(6)
      return null
    }).filter(Boolean)
    return words.length ? ` (${words.join(', ')})` : ''
  }
  const projectText = (p: StandupProject) => [
    !project && p.name && `*${p.name}*`,
    !project && p.summary,
    ...SECTIONS.filter(sec => p[sec.key].length).map(sec => `${sec.title}\n${p[sec.key].map(l => `• ${l.text}${plain(l.refs)}`).join('\n')}`),
  ].filter(Boolean).join('\n')
  const copy = (one?: StandupProject) => {
    if (!value) return
    navigator.clipboard.writeText(one ? projectText(one) : [value.summary, ...value.projects.map(projectText)].join('\n\n'))
    announce(one?.name ? `Copied ${one.name}’s standup` : 'Copied the standup')
  }
  return (
    <section className={`brief standup ${standup.writing ? 'writing' : ''}`}>
      <div className="brief-glow" aria-hidden="true" />
      <header className="brief-head">
        <span className="brief-label"><Sparkles size={13} strokeWidth={2} />Standup</span>
        <span className="brief-when">{standup.writing ? 'Claude is writing…' : standup.at ? `Last 7 days · written ${formatDue(standup.at, now).replace(/^at /, '')}` : 'Last 7 days'}</span>
        {value && !standup.writing && (
          <>
            <button className="brief-action" onClick={() => copy()}><Copy size={12} strokeWidth={2} />Copy</button>
            <button className="brief-action" onClick={() => write('standup')}><RefreshCw size={12} strokeWidth={2} />Rewrite</button>
          </>
        )}
      </header>
      {!value && standup.writing && (
        <div className="brief-loading">
          <div className="shimmer wide" />
          <div className="brief-loading-focus"><div className="shimmer block" /><div className="shimmer block" /></div>
          <p>Claude is reading {project ? `${project.name}’s` : 'your'} week…</p>
        </div>
      )}
      {!value && !standup.writing && (
        <div className="brief-empty">
          <p>{standup.error ? `Claude couldn’t write it: ${standup.error}` : 'Claude writes your standup from the week: what you asked it in each session, what you merged and reviewed, and your issues and to-dos.'}</p>
          <button className="push-button default" onClick={() => write('standup')}>{standup.error ? 'Try Again' : 'Write the Standup'}</button>
        </div>
      )}
      {value && (
        <div className="brief-body">
          <h2 className="brief-headline small">{value.summary}</h2>
          <div className="standup-list">
            {value.projects.map(p => (
              <div key={p.name} className="standup-section">
                {!project && (
                  <>
                    <h3>
                      {p.name}
                      <span>{SECTIONS.filter(sec => p[sec.key].length).map(sec => `${p[sec.key].length} ${sec.count}`).join(' · ')}</span>
                      <button className="standup-copy" title={`Copy ${p.name || 'this'}`} onClick={() => copy(p)}><Copy size={12} strokeWidth={2} /></button>
                    </h3>
                    {p.summary && <p className="standup-summary">{p.summary}</p>}
                  </>
                )}
                <ul>
                  {SECTIONS.flatMap(sec => p[sec.key].map((l, j) => (
                    <li key={`${sec.key}${j}`} className={sec.tone}>
                      <span className="standup-mark" title={sec.title}>{MARKS[sec.key]}</span>
                      <span className="standup-text">{l.text}</span>
                      <Refs refs={l.refs} />
                    </li>
                  )))}
                </ul>
              </div>
            ))}
          </div>
          {standup.error && <p className="brief-error">Couldn’t rewrite it: {standup.error}</p>}
        </div>
      )}
    </section>
  )
}

interface DayWork {
  key: string
  name: string
  session?: Session
  group?: { name: string; color: string }
  prompts: JournalEntry[]
}

function useDays() {
  const scope = useScope()
  const all = useStatus(s => s.journal)
  const journal = useMemo(() => all?.filter(scope.entry) ?? null, [all, scope])
  const sessions = useStore(s => s.sessions)
  const groups = useStore(s => s.groups)
  return useMemo(() => {
    const days: { start: number; entries: JournalEntry[] }[] = []
    for (let i = 6; i >= 0; i--) {
      const start = new Date(Date.now() - i * DAY).setHours(0, 0, 0, 0)
      days.push({ start, entries: (journal ?? []).filter(e => e.t >= start && e.t < start + DAY) })
    }
    const byClaude = new Map(sessions.filter(s => s.claudeSessionId).map(s => [s.claudeSessionId!, s]))
    return days.map(day => {
      const work = new Map<string, DayWork>()
      for (const e of day.entries) {
        if (e.kind !== 'prompt') continue
        const session = sessions.find(s => s.id === e.session) ?? (e.claude ? byClaude.get(e.claude) : undefined)
        const key = session?.id ?? e.claude ?? e.folder ?? 'other'
        const group = groups.find(g => g.id === session?.groupId)
        const entry = work.get(key) ?? {
          key,
          name: session?.name ?? e.name ?? baseName(e.folder ?? '') ?? 'A session',
          session,
          // A conversation from before the journal has no group; its folder says where it was.
          group: group ? { name: group.name, color: groupColor(group) } : { name: e.group ?? baseName(e.folder ?? ''), color: '' },
          prompts: [],
        }
        entry.prompts.push(e)
        work.set(key, entry)
      }
      return { ...day, prompts: day.entries.filter(e => e.kind === 'prompt').length, work: [...work.values()].sort((a, b) => b.prompts.length - a.prompts.length) }
    })
  }, [journal, sessions, groups])
}

function Activity() {
  const days = useDays()
  const loading = useStatus(s => s.journalLoading && !s.journal)
  const gh = useScopedGithub()
  const lin = useScopedLinear()
  const [picked, setPicked] = useState<number | null>(null)
  const max = Math.max(1, ...days.map(d => d.prompts))
  const selected = picked ?? [...days].reverse().find(d => d.prompts)?.start ?? days[6].start
  const day = days.find(d => d.start === selected) ?? days[6]
  const merged = gh?.merged.filter(p => p.mergedAt! >= day.start && p.mergedAt! < day.start + DAY) ?? []
  const completed = lin?.done.filter(i => i.completed! >= day.start && i.completed! < day.start + DAY) ?? []
  return (
    <section className="status-card wide activity" id="status-activity">
      <header className="status-card-head">
        <span className="status-card-icon accent"><SquareTerminal size={13} strokeWidth={2.2} /></span>
        <h2>Activity</h2>
        <span className="status-card-action secondary">{days.reduce((n, d) => n + d.prompts, 0)} prompts this week</span>
      </header>
      {loading ? <div className="status-loading"><span className="spinner" />Reading the last two weeks of Claude conversations…</div> : (
        <div className="activity-body">
          <div className="activity-chart" role="tablist">
            {days.map(d => (
              <button key={d.start} role="tab" aria-selected={d.start === selected} className={`activity-day ${d.start === selected ? 'on' : ''}`} onClick={() => setPicked(d.start)}>
                <span className="activity-count">{d.prompts || ''}</span>
                <span className="activity-bar"><span style={{ height: `${Math.max(d.prompts ? 6 : 0, (d.prompts / max) * 100)}%` }} /></span>
                <span className="activity-label">{new Date(d.start).toLocaleDateString([], { weekday: 'short' })}</span>
              </button>
            ))}
          </div>
          <div className="activity-detail">
            <h3>{new Date(day.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            {merged.map(pr => (
              <div key={pr.id} className="activity-event" onClick={() => openLink(pr.url)}>
                <GitMerge size={13} strokeWidth={2} className="green-text" />Merged <b>{pr.title}</b><span className="tertiary">{repoName(pr.repo)} #{pr.number}</span>
              </div>
            ))}
            {completed.map(i => (
              <div key={i.id} className="activity-event" onClick={() => openLink(i.url)}>
                <CircleCheck size={13} strokeWidth={2} className="purple-text" />Completed <b>{i.title}</b><span className="tertiary">{i.identifier}</span>
              </div>
            ))}
            {day.work.length === 0 && merged.length === 0 && completed.length === 0 && <Empty icon={<Clock3 size={13} strokeWidth={2} />}>Nothing logged this day.</Empty>}
            <div className="activity-work">
              {day.work.map(w => (
                <div key={w.key} className={`work ${w.session ? 'clickable' : ''}`} onClick={() => w.session && openSession(w.session.id)}>
                  <div className="work-head">
                    {w.session ? <StatusIcon session={w.session} size={13} /> : <Sparkle size={12} strokeWidth={2} className="tertiary" />}
                    <span className="work-name">{w.name}</span>
                    {w.group && <span className="status-group">{w.group.color && <span className="tag-dot" style={{ background: w.group.color }} />}{w.group.name}</span>}
                    <span className="work-count">{w.prompts.length} prompt{w.prompts.length === 1 ? '' : 's'}</span>
                  </div>
                  <ul>
                    {w.prompts.slice(-3).map(p => <li key={p.t} title={p.text}><span className="work-time">{clock(p.t)}</span>{p.text}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Shipped() {
  const gh = useScopedGithub()
  const lin = useScopedLinear()
  const items = [
    ...(gh?.merged ?? []).map(pr => ({ t: pr.mergedAt!, id: pr.id, node: <PullShipped key={pr.id} pr={pr} /> })),
    ...(lin?.done ?? []).map(i => ({ t: i.completed!, id: i.id, node: <IssueShipped key={i.id} issue={i} /> })),
  ].sort((a, b) => b.t - a.t)
  return (
    <Card id="shipped" icon={<GitMerge size={13} strokeWidth={2.2} />} tone="green" title="Shipped" count={items.length}>
      {items.length === 0 && <Empty icon={<Clock3 size={13} strokeWidth={2} />}>Nothing merged or completed in the last 7 days.</Empty>}
      {items.map(i => i.node)}
    </Card>
  )
}

function PullShipped({ pr }: { pr: StatusPr }) {
  const now = useNow()
  return (
    <Row
      lead={<span className="pull-icon merged"><GitMerge size={14} strokeWidth={2} /></span>}
      title={pr.title}
      sub={<>{repoName(pr.repo)} #{pr.number}{pr.issues?.map(i => <RefChip key={i} refId={i} />)}</>}
      meta={ago(pr.mergedAt!, now)}
      onClick={() => openLink(pr.url)}
    />
  )
}

function IssueShipped({ issue }: { issue: StatusIssue }) {
  const now = useNow()
  return (
    <Row
      lead={<span className="pull-icon done"><CircleCheck size={14} strokeWidth={2} /></span>}
      title={<><span className="issue-id">{issue.identifier}</span>{issue.title}</>}
      sub={issue.project ?? undefined}
      meta={ago(issue.completed!, now)}
      onClick={() => openLink(issue.url)}
    />
  )
}

const VERDICT: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'green'],
  CHANGES_REQUESTED: ['Changes requested', 'red'],
  COMMENTED: ['Commented', ''],
  DISMISSED: ['Dismissed', ''],
}

function Reviewed() {
  const now = useNow()
  const gh = useScopedGithub()
  return (
    <Card id="reviewed" icon={<Eye size={13} strokeWidth={2.2} />} tone="accent" title="Reviewed" count={gh?.reviewed.length}>
      {gh && gh.reviewed.length === 0 && <Empty icon={<Clock3 size={13} strokeWidth={2} />}>No reviews in the last 7 days.</Empty>}
      {gh?.reviewed.map(pr => {
        const [label, tone] = VERDICT[pr.verdict ?? ''] ?? ['Reviewed', '']
        return (
          <Row
            key={pr.id}
            lead={<Avatar login={pr.author} />}
            title={pr.title}
            sub={<>{repoName(pr.repo)} #{pr.number} · {pr.author}<span className={`status-badge ${tone}`}>{label}</span></>}
            meta={ago(pr.reviewedAt!, now)}
            onClick={() => openLink(pr.url)}
          />
        )
      })}
    </Card>
  )
}
