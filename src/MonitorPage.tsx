import { useEffect, useState, type CSSProperties } from 'react'
import { BellOff, Bot, Check, ChevronRight, CircleCheck, Ellipsis, Pause, Play, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { announce, getState, useStore } from './store'
import { closePage, openSession } from './workspace'
import { iconFor } from './sessionIcons'
import { useNow } from './reminders'
import { ago, clock, formatValue, monitorMenu, removeMonitor, scheduleText, setPaused, snoozeMenu, timeOf, useMonitors, type ValueStyle } from './monitors'
import { SeriesChart, Sparkline, type Axis, type Band, type Threshold } from './MonitorCharts'

// A monitor's page: what its commands last returned, drawn as the panels Claude laid out, the rules
// and whether they fire, what happened since the page was last open, and the commands themselves.
// Everything here comes from main's last runs.

type Detail = MonitorDetail
type SourceData = Detail['sources'][string]

const STATE_LABEL: Record<MonitorState, string> = {
  approval: 'Waiting for you to allow its commands',
  done: 'Finished',
  paused: 'Paused',
  alert: 'Alert',
  warn: 'Warning',
  error: 'A command failed',
  ok: 'All clear',
  pending: 'Starting',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A time as the page says it: the clock today, with the day before that. */
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))

/** A field's name as a title: "stuck_in_call" reads "Stuck in call". */
const humanize = (name: string) => {
  const words = name.replace(/[_.]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `inPane`: drawn in a pane among sessions, which the workspace closes when the monitor goes. */
export function MonitorPage({ id, inPane = false }: { id: string; inPane?: boolean }) {
  const summary = useMonitors(list => list.find(m => m.id === id))
  const [detail, setDetail] = useState<Detail | null>(null)
  // When the page was last left, as it was when this visit began: what happened since is news.
  const [since, setSince] = useState<{ id: string; t: number } | null>(null)
  const rev = summary?.rev

  useEffect(() => {
    let live = true
    window.deck.monitor(id).then(d => {
      if (!live || !d) return
      setDetail(d)
      setSince(s => (s?.id === id ? s : { id, t: d.lookedAt ?? 0 }))
    })
    return () => {
      live = false
    }
  }, [id, rev])

  // A pane stays mounted behind a page over it, where nothing on it is seen.
  const covered = useStore(s => inPane && !!s.page)

  // Leaving the page is when it was last looked at.
  useEffect(() => () => {
    if (!inPane || !getState().page) window.deck.monitorSeen(id, true)
  }, [id, inPane])

  // Removed while open, by Claude or an Undo.
  useEffect(() => {
    if (!summary && !inPane) closePage()
  }, [summary, inPane])

  // New rows found while the page is open are seen already.
  useEffect(() => {
    if (summary?.unseen && !covered) window.deck.monitorSeen(id)
  }, [id, summary?.unseen, covered])

  useEffect(() => {
    if (inPane) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.sheet-backdrop, .palette')) return
      if ((e.target as HTMLElement).closest('input, textarea')) return
      closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inPane])

  const className = `status-page monitor-page ${inPane ? 'in-pane' : ''}`
  if (!summary || !detail || detail.spec.id !== id) return <div className={className} />
  const { spec } = detail
  const Icon = iconFor(spec.icon)
  const schedules = [...new Set(Object.values(spec.sources).map(scheduleText))]

  return (
    <div className={className}>
      <div className="status-inner">
        <header className="status-head">
          <div className="status-hello">
            <span className="status-date">
              <span className={`monitor-state-dot ${summary.state}`} />
              {STATE_LABEL[summary.state]}
              {summary.lastRun && summary.state !== 'approval' && <> · Checked <Ago t={summary.lastRun} /></>}
              {summary.expiresAt && !summary.paused && summary.expiresAt > Date.now() && <> · Stops at {when(summary.expiresAt)}</>}
            </span>
            <h1>
              {Icon && <Icon className="monitor-title-icon" size={26} strokeWidth={1.75} />}
              {spec.name}
            </h1>
            {spec.description && <p className="monitor-description">{spec.description}</p>}
          </div>
          <div className="status-tools">
            <button
              className="status-tool"
              title="Run Now"
              disabled={summary.pending.length > 0 || summary.running}
              onClick={() => window.deck.runMonitor(id)}
            >
              <RefreshCw size={15} strokeWidth={1.9} className={summary.running ? 'spinning' : undefined} />
            </button>
            <button className="status-tool" title={summary.paused ? 'Resume' : 'Pause'} onClick={() => setPaused(summary, !summary.paused)}>
              {summary.paused ? <Play size={15} strokeWidth={1.9} /> : <Pause size={15} strokeWidth={1.9} />}
            </button>
            <button className="status-tool" title="More" onClick={() => monitorMenu(summary)}>
              <Ellipsis size={16} strokeWidth={1.9} />
            </button>
          </div>
        </header>

        {summary.done && (
          <div className="monitor-done">
            <CircleCheck size={15} strokeWidth={2} />
            <span><strong>Finished at {when(summary.done.at)}.</strong> {summary.done.why} Resume it to run again.</span>
          </div>
        )}
        {summary.pending.length > 0 && <Approval detail={detail} summary={summary} />}
        {spec.rules.length > 0 && <Rules detail={detail} since={since?.t ?? 0} />}
        {summary.pending.length === 0 && since && <Activity detail={detail} since={since.t} />}
        {detail.problems.length > 0 && (
          <div className="monitor-problems">
            <TriangleAlert size={14} strokeWidth={2} />
            <div>
              <strong>Some panels can’t find their data.</strong>
              {detail.problems.map(p => <p key={p}>{p}</p>)}
            </div>
          </div>
        )}

        <div className="monitor-grid">
          {spec.panels.map((panel, i) => <Panel key={i} panel={panel} detail={detail} />)}
        </div>

        <Commands detail={detail} />
        <footer className="monitor-footer">
          <By id={spec.by} />
          {schedules.length === 1 && <span>Runs {schedules[0]}</span>}
        </footer>
      </div>
    </div>
  )
}

function Ago({ t }: { t: number }) {
  const now = useNow()
  return <span title={new Date(t).toLocaleString()}>{ago(t, Math.max(now, t))}</span>
}

function By({ id }: { id?: string }) {
  const session = useStore(s => s.sessions.find(x => x.id === id))
  if (!session) return <span>Made by Claude</span>
  return (
    <span>
      Made by Claude in <button className="link-button" onClick={() => openSession(session.id)}>{session.name}</button>
    </span>
  )
}

function Approval({ detail, summary }: { detail: Detail; summary: MonitorSummary }) {
  const changed = summary.pending.length < Object.keys(detail.spec.sources).length
  return (
    <section className="monitor-approval">
      <div className="monitor-approval-head">
        <span className="status-card-icon orange"><ShieldAlert size={14} strokeWidth={2.2} /></span>
        <div>
          <h2>{changed ? 'Claude changed commands this monitor runs' : 'Allow these commands to run?'}</h2>
          <p>
            Own Term will run {summary.pending.length === 1 ? 'this command' : 'these commands'} on a schedule, in your shell’s environment,
            for as long as the monitor exists, even with no session open. Allow only what you’d run yourself.
          </p>
        </div>
      </div>
      {summary.pending.map(name => {
        const source = detail.spec.sources[name]
        return (
          <div key={name} className="monitor-command">
            <div className="monitor-command-meta">
              <strong>{name}</strong>
              <span>{scheduleText(source)} · in {tilde(source.folder ?? detail.spec.folder)}</span>
            </div>
            <pre>{source.run}</pre>
            <Wakes detail={detail} source={name} />
          </div>
        )
      })}
      <div className="monitor-approval-actions">
        <button className="push-button" onClick={() => removeMonitor(summary)}>Remove Monitor</button>
        <button
          className="push-button default"
          onClick={async () => {
            if (!(await window.deck.approveMonitor(summary.id, detail.spec.updated))) announce('Claude changed this monitor while you were reading it; check its commands again')
          }}
        >
          Allow and Run
        </button>
      </div>
    </section>
  )
}

/** The prompts this source's rules would send Claude, which Allow covers too. */
function Wakes({ detail, source }: { detail: Detail; source: string }) {
  const session = useStore(s => s.sessions.find(x => x.id === detail.spec.by))
  const rules = detail.spec.rules.filter(r => r.source === source && r.prompt)
  return rules.map(rule => (
    <div key={rule.id} className="monitor-wake">
      <Bot size={13} strokeWidth={2} />
      <div>
        When “{rule.name}” fires, Claude in {session ? `“${session.name}”` : 'the session that made this monitor'} is sent:
        <p>{rule.prompt}</p>
      </div>
    </div>
  ))
}

const home = window.deck.homeDir
const tilde = (path: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

/** A rule the user silenced: still checked and on the page, but no one is told. */
const snoozeText = (until: number | 'clear') => (until === 'clear' ? 'Snoozed until it clears' : `Snoozed until ${when(until)}`)

/** The rules as chips. Ones with news show; the quiet ones fold into one chip that opens them. */
function Rules({ detail, since }: { detail: Detail; since: number }) {
  const [open, setOpen] = useState(false)
  const snoozed = detail.summary.snoozed
  const rules = detail.spec.rules
  const news = (rule: MonitorRule) => {
    const state = detail.rules[rule.id]
    return !!state?.firing || rule.id in snoozed || (!!rule.new_rows && !!state?.last && state.last.t > since)
  }
  const shown = open || rules.length <= 3 ? rules : rules.filter(news)
  const quiet = rules.length - shown.length
  return (
    <div className="monitor-rules">
      {shown.map(rule => {
        const state = detail.rules[rule.id]
        const firing = !!state?.firing
        const until = snoozed[rule.id]
        const what = `${rule.agg && rule.agg !== 'first' ? `${rule.agg}(${rule.field ?? ''})` : rule.field}${rule.change ? ` change over ${rule.change}` : ''}`
        const test = rule.failing ? 'command fails'
          : rule.new_rows ? 'new rows'
          : `${rule.by ? `for each ${rule.by}, ` : ''}${what} ${rule.op} ${rule.value}`
        const tip = [`${test}${rule.for && rule.for > 1 ? `, ${rule.for} runs in a row` : ''}`, firing && state?.message, rule.prompt && `Wakes Claude: ${rule.prompt}`, until !== undefined && snoozeText(until)].filter(Boolean).join('\n')
        const tone = firing ? rule.level : rule.level === 'done' ? 'pending-done' : 'ok'
        return (
          <button
            key={rule.id}
            className={`monitor-rule ${tone} ${until !== undefined ? 'snoozed' : ''}`}
            title={tip}
            disabled={rule.level === 'done'}
            onClick={() => snoozeMenu(detail.summary, rule, firing)}
          >
            {until !== undefined ? <BellOff className="monitor-rule-snoozed" size={12} strokeWidth={2.2} /> : <span className="monitor-rule-dot" />}
            <span className="monitor-rule-name">{rule.name}</span>
            <span className="monitor-rule-detail">
              {until !== undefined ? snoozeText(until)
                : firing ? state?.keys?.length ? state.keys.slice(0, 3).join(', ') + (state.keys.length > 3 ? ` +${state.keys.length - 3}` : '') : `since ${clock(state!.since ?? Date.now())}`
                : rule.new_rows && state?.last ? `${state.last.count} new at ${clock(state.last.t)}`
                : rule.level === 'done' ? 'not yet' : 'OK'}
            </span>
            {rule.prompt && <Bot className="monitor-rule-wake" size={12} strokeWidth={2} />}
          </button>
        )
      })}
      {quiet > 0 && (
        <button className="monitor-rule ok quiet" onClick={() => setOpen(true)} title="Show every rule">
          <span className="monitor-rule-dot" />
          <span className="monitor-rule-name">{shown.length ? `${quiet} more` : `${quiet} rules`}</span>
          <span className="monitor-rule-detail">OK</span>
        </button>
      )}
      {open && rules.length > 3 && rules.some(r => !news(r)) && (
        <button className="monitor-rule-fold" onClick={() => setOpen(false)}>Show Less</button>
      )}
    </div>
  )
}

// ── What happened ───────────────────────────────────────────────────────────────────────────────────

/** An event, with the one that ended it: a rule firing and clearing, a command failing and working again. */
interface Episode {
  event: MonitorEvent
  ended?: number
}

function episodes(events: MonitorEvent[]): Episode[] {
  const out: Episode[] = []
  const open = new Map<string, Episode>()
  for (const event of events) {
    const key = event.rule ? `r:${event.rule}` : event.source ? `s:${event.source}` : ''
    if (event.kind === 'cleared' || event.kind === 'recovered') {
      const started = open.get(key)
      if (started) started.ended = event.t, open.delete(key)
      else out.push({ event })
      continue
    }
    // A group joining a rule that fires belongs to that firing, which clears once.
    if (event.kind === 'fired' && open.has(key)) continue
    const episode = { event }
    if (event.kind === 'fired' || event.kind === 'failed') open.set(key, episode)
    out.push(episode)
  }
  return out
}

/** Episodes of the same rule or command less than an hour apart, as one line: a rule that flaps is one thing happening. */
interface Burst {
  first: MonitorEvent
  last: Episode
  count: number
}

const keyOf = (e: MonitorEvent) => `${e.rule ? `r:${e.rule}` : e.source ? `s:${e.source}` : ''}:${e.kind}`

function bursts(list: Episode[]): Burst[] {
  const out: Burst[] = []
  const open = new Map<string, Burst>()
  for (const episode of list) {
    const key = keyOf(episode.event)
    const burst = open.get(key)
    if (burst && episode.event.t - (burst.last.ended ?? burst.last.event.t) < HOUR) {
      burst.last = episode
      burst.count++
      continue
    }
    const fresh = { first: episode.event, last: episode, count: 1 }
    open.set(key, fresh)
    out.push(fresh)
  }
  return out.sort((a, b) => a.last.event.t - b.last.event.t)
}

const lasted = (ms: number) => (ms < HOUR ? `${Math.max(1, Math.round(ms / MINUTE))} min` : ms < DAY ? `${Math.round(ms / HOUR * 10) / 10} h` : `${Math.round(ms / DAY * 10) / 10} d`)

/** What happened since the page was last left; the week before it opens on request. */
function Activity({ detail, since }: { detail: Detail; since: number }) {
  const [all, setAll] = useState(false)
  const now = useNow()
  const list = bursts(episodes(detail.events))
  // A first visit shows the last day.
  const from = since || now - DAY
  // A rule that started firing before and still is belongs with the news.
  const fresh = list.filter(({ last: e }) => e.event.t > from || (!e.ended && e.event.kind === 'fired' && !!detail.rules[e.event.rule ?? '']?.firing))
  const shown = (all ? list : fresh).slice(-100).reverse()
  const earlier = list.length - fresh.length
  const looked = since ? `since you looked, ${ago(since, Math.max(now, since))}` : 'in the last day'
  if (!shown.length) {
    return (
      <p className="monitor-quiet">
        <Check size={13} strokeWidth={2.4} />
        Nothing happened {looked}.
        {earlier > 0 && <button className="link-button" onClick={() => setAll(true)}>Show earlier</button>}
      </p>
    )
  }
  return (
    <section className="monitor-activity">
      <div className="monitor-activity-head">
        <h3>{all ? 'The last week' : `${fresh.length === 1 ? 'One thing' : `${fresh.length} things`} happened ${looked}`}</h3>
        {(earlier > 0 || all) && <button className="link-button" onClick={() => setAll(!all)}>{all ? 'Show recent' : `Show earlier (${earlier})`}</button>}
      </div>
      <ol>
        {shown.map(({ first, last: { event, ended }, count }, i) => {
          const tone = event.kind === 'failed' ? 'alert'
            : event.kind === 'fired' || event.kind === 'new' ? event.level === 'done' ? 'done' : event.level ?? 'warn'
            : 'ok'
          const name = event.name ?? (event.source ? `${event.source} command` : event.kind === 'finished' ? 'Finished' : '')
          const still = !ended && (event.kind === 'fired' ? detail.rules[event.rule ?? '']?.firing : event.kind === 'failed' ? detail.sources[event.source ?? '']?.latest?.ok === false : false)
          return (
            <li key={`${event.t}-${i}`} className={`${tone} ${event.t > from ? 'fresh' : ''}`}>
              <time title={new Date(event.t).toLocaleString()}>{when(count > 1 ? first.t : event.t)}</time>
              <span className="monitor-activity-dot" />
              <span className="monitor-activity-text">
                <strong>{event.kind === 'failed' ? `${name} failed` : name}</strong>
                {count > 1 && <span className="monitor-activity-count">{count}×</span>}
                {' '}{event.kind === 'cleared' ? 'cleared' : event.kind === 'recovered' ? 'works again' : event.text}
              </span>
              <span className="monitor-activity-meta">
                {event.snoozed && 'snoozed · '}
                {count > 1 && `until ${when(ended ?? event.t)} · last `}
                {ended ? `${event.kind === 'failed' ? 'fixed' : 'cleared'} after ${lasted(ended - event.t)}` : still ? `still ${event.kind === 'failed' ? 'failing' : 'firing'}` : ''}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** The stretches a rule about the panel's fields was firing, from the events. */
function bandsFor(panel: MonitorPanel, detail: Detail, fields: string[]): Band[] {
  const rules = detail.spec.rules.filter(r => r.source === panel.source && !r.failing && !r.new_rows && r.field && fields.includes(r.field))
  return rules.flatMap(rule => {
    const out: Band[] = []
    let from: number | null = null
    for (const event of detail.events) {
      if (event.rule !== rule.id) continue
      if (event.kind === 'fired' && from === null) from = event.t
      if (event.kind === 'cleared' && from !== null) out.push({ from, to: event.t, level: rule.level }), (from = null)
    }
    if (from !== null && detail.rules[rule.id]?.firing) out.push({ from, to: Date.now(), level: rule.level })
    return out
  })
}

// ── Panels ──────────────────────────────────────────────────────────────────────────────────────────

const panelFields = (panel: MonitorPanel) => [panel.field, ...(panel.y ?? []), panel.text, ...(panel.fields ?? []).map(f => f.field)]

/** The firing rules a panel shows: on its source, about a field it draws or, for status, its command failing. */
function firingOn(panel: MonitorPanel, detail: Detail) {
  const fields = panelFields(panel)
  return detail.spec.rules.filter(r => r.source === panel.source && r.level !== 'done' && detail.rules[r.id]?.firing && !(r.id in detail.summary.snoozed)
    && (r.failing ? panel.type === 'status' : fields.includes(r.field)))
}

/** Rules that compare one value of the field drawn; a sum or average over rows isn't on the chart's scale. */
function thresholdsFor(panel: MonitorPanel, detail: Detail, field: string): Threshold[] {
  return detail.spec.rules
    .filter(r => r.source === panel.source && r.field === field && typeof r.value === 'number' && ['>', '>=', '<', '<='].includes(r.op ?? '')
      && ['first', 'last', 'min', 'max', undefined].includes(r.agg) && !r.change && r.level !== 'done')
    .map(r => ({ value: r.value as number, level: r.level as 'warn' | 'alert', firing: !!detail.rules[r.id]?.firing }))
}

function Panel({ panel, detail }: { panel: MonitorPanel; detail: Detail }) {
  const data = detail.sources[panel.source]
  const width = panel.width ?? ({ stat: 1, status: 1, line: 2, area: 2, bar: 2, log: 2, table: 4, checks: 1, funnel: 2 } as const)[panel.type]
  const failed = data?.latest && !data.latest.ok
  const firing = firingOn(panel, detail)
  const tone = firing.some(r => r.level === 'alert') ? 'alert' : firing.length ? 'warn' : ''
  const title = panel.title ?? defaultTitle(panel)
  // An empty list whose rows would be trouble is good news, and takes a line, not a card.
  if ((panel.type === 'table' || panel.type === 'log') && data?.latest && !data.rows.length) {
    const watched = detail.spec.rules.some(r => r.source === panel.source)
    return (
      <section className={`monitor-panel compact ${failed ? 'stale' : ''}`} style={{ '--span': width } as CSSProperties}>
        <div className="monitor-panel-head">
          <h3>{title}</h3>
          {failed ? <span className="monitor-panel-error" title={data.latest!.error}>Last run failed</span>
            : <span className={`monitor-panel-none ${watched ? 'good' : ''}`}>{watched && <Check size={12} strokeWidth={2.6} />}{panel.empty ?? (watched ? 'None' : 'No rows')}</span>}
        </div>
      </section>
    )
  }
  return (
    <section className={`monitor-panel ${panel.type} w${width} ${tone} ${failed ? 'stale' : ''}`} style={{ '--span': width } as CSSProperties}>
      <div className="monitor-panel-head">
        <h3>{title}</h3>
        {failed ? <span className="monitor-panel-error" title={data.latest!.error}>Last run failed</span>
          : firing.length > 0 && panel.type !== 'checks' && <span className="monitor-panel-rule" title={firing.map(r => detail.rules[r.id]?.message).filter(Boolean).join('\n')}>{firing.map(r => r.name).join(', ')}</span>}
      </div>
      {!data?.latest ? <div className="monitor-empty">{data?.approved ? 'Waiting for its first run…' : 'Runs once you allow it.'}</div> : <PanelBody panel={panel} data={data} detail={detail} />}
    </section>
  )
}

function defaultTitle(panel: MonitorPanel) {
  const what = panel.field ?? panel.y?.join(', ') ?? panel.text ?? panel.fields?.map(f => f.label ?? f.field).join(' → ') ?? panel.source
  return humanize(what === 'value' || what === 'line' ? panel.source : what)
}

/** How long ago a stat compares with, as it reads: "1 h ago", "this time yesterday". */
function compareText(ms: number) {
  if (ms === DAY) return 'this time yesterday'
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min ago`
  if (ms < DAY) return `${Math.round(ms / HOUR)} h ago`
  return `${Math.round(ms / DAY)} d ago`
}

/** "90s", "5m", "1h" or "1d" in milliseconds, as main reads a spec's durations; 0 if it isn't one. */
const durationOf = (text: string) => {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/)
  return m ? Number(m[1]) * { ms: 1, s: 1000, m: MINUTE, h: HOUR, d: DAY }[m[2] as 'ms' | 's' | 'm' | 'h' | 'd'] : 0
}

/** A stat's change since `compare` (an hour, unless the spec says), once its history reaches back that far. */
function Change({ panel, data, style }: { panel: MonitorPanel; data: SourceData; style: ValueStyle }) {
  if (panel.compare === false) return null
  const back = durationOf(panel.compare ?? '1h')
  const now = data.rows[0]?.[panel.field!]
  const latest = data.history.at(-1)
  if (typeof now !== 'number' || !back || !latest) return null
  const target = latest.t - back
  let then: number | undefined
  let at = 0
  for (const h of data.history) {
    if (h.t > target) break
    if (typeof h.v?.[panel.field!] === 'number') (then = h.v![panel.field!]), (at = h.t)
  }
  // A value from well before then, across a gap, isn't the value then.
  if (then === undefined || target - at > back * 0.25) return null
  const delta = now - then
  const scale = Math.max(Math.abs(now), Math.abs(then))
  if (Math.abs(delta) <= scale * 1e-9) return <div className="monitor-change">No change since {compareText(back)}</div>
  return (
    <div className="monitor-change" title={`${formatValue(then, style)} ${compareText(back)}`}>
      <span className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '▲' : '▼'}</span> {formatValue(Math.abs(delta), style)} since {compareText(back)}
    </div>
  )
}

function PanelBody({ panel, data, detail }: { panel: MonitorPanel; data: SourceData; detail: Detail }) {
  const style: ValueStyle = { format: panel.format, unit: panel.unit, decimals: panel.decimals }
  const marks = (detail.spec.marks ?? []).map(m => ({ t: Date.parse(m.at), label: m.label }))
  if (panel.type === 'stat') {
    const value = data.rows[0]?.[panel.field!]
    const spark = data.history.map(h => h.v?.[panel.field!] ?? null)
    return (
      <>
        <div className="monitor-stat">{formatValue(value, style)}</div>
        <Change panel={panel} data={data} style={style} />
        {panel.spark !== false && spark.filter(v => v !== null).length > 1 && <Sparkline values={spark} times={data.history.map(h => h.t)} />}
      </>
    )
  }
  if (panel.type === 'status') {
    const up = data.latest!.ok
    const recent = data.history.slice(-48)
    return (
      <>
        <div className={`monitor-status ${up ? 'up' : 'down'}`}>
          <span className="monitor-status-dot" />
          {up ? 'Up' : 'Down'}
          <span className="monitor-status-detail">{formatValue(data.latest!.ms, { format: 'ms' })}</span>
        </div>
        {!up && <p className="monitor-error-text">{data.latest!.error}</p>}
        <div className="monitor-strip" title={`The last ${recent.length} runs`}>
          {recent.map((h, i) => <span key={i} className={h.ok ? 'up' : 'down'} title={`${clock(h.t, true)}: ${h.ok ? 'up' : 'down'}`} />)}
        </div>
      </>
    )
  }
  if (panel.type === 'checks') return <Checks panel={panel} data={data} detail={detail} style={style} />
  if (panel.type === 'funnel') return <Funnel panel={panel} data={data} style={style} />
  if (panel.type === 'line' || panel.type === 'area' || panel.type === 'bar') {
    const fields = panel.y ?? []
    let axis: Axis
    let series
    if (!panel.x) {
      // Bars for every run of a day would be hairlines; the latest 60 runs read as a bar chart.
      const points = (panel.type === 'bar' ? data.history.slice(-60) : data.history)
      axis = { kind: 'time', times: points.map(h => h.t) }
      series = fields.map(f => ({ name: f, values: points.map(h => h.v?.[f] ?? null) }))
    } else {
      const times = data.rows.map(r => timeOf(r[panel.x!]))
      const timed = times.every(t => t !== null)
      const order = data.rows.map((_, i) => i)
      if (timed) order.sort((a, b) => times[a]! - times[b]!)
      axis = timed ? { kind: 'time', times: order.map(i => times[i]!) } : { kind: 'label', labels: order.map(i => String(data.rows[i][panel.x!] ?? '')) }
      series = fields.map(f => ({ name: f, values: order.map(i => toNumber(data.rows[i][f])) }))
    }
    const thresholds = fields.flatMap(f => thresholdsFor(panel, detail, f))
    return (
      <>
        {fields.length > 1 && (
          <div className="monitor-legend">
            {fields.map((f, i) => <span key={f}><i className={`legend-swatch series-${i}`} />{f}</span>)}
          </div>
        )}
        <SeriesChart kind={panel.type} series={series} axis={axis} style={style} thresholds={thresholds} bands={bandsFor(panel, detail, fields)} marks={marks} />
      </>
    )
  }
  if (panel.type === 'table') {
    const rows = data.rows.slice(0, panel.limit ?? 20)
    const columns = panel.columns ?? [...new Set(rows.slice(0, 20).flatMap(r => Object.keys(r)))].slice(0, 8)
    // psql prints booleans as t and f; a column of nothing else reads as yes and no.
    const flags = new Set(columns.filter(c => rows.every(r => r[c] === null || r[c] === undefined || ['t', 'f', true, false].includes(r[c] as string | boolean))))
    return (
      <div className="monitor-table-wrap">
        <table className="monitor-table">
          <thead><tr>{columns.map(c => <th key={c} className={typeof rows[0][c] === 'number' ? 'number' : flags.has(c) ? 'flag' : undefined}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map(c => flags.has(c)
                  ? <td key={c} className="flag">{row[c] === 't' || row[c] === true ? <Check size={13} strokeWidth={2.4} aria-label="yes" /> : row[c] === null || row[c] === undefined ? '' : <span className="monitor-no" aria-label="no">–</span>}</td>
                  : <td key={c} className={typeof row[c] === 'number' ? 'number' : undefined}>{formatValue(row[c], typeof row[c] === 'number' ? style : {})}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {data.total > rows.length && <p className="monitor-more">{rows.length} of {data.total} rows</p>}
      </div>
    )
  }
  const rows = data.rows.slice(0, panel.limit ?? 50)
  return (
    <ol className="monitor-log">
      {rows.map((row, i) => {
        const level = panel.level ? String(row[panel.level] ?? '') : ''
        const t = panel.time ? timeOf(row[panel.time]) : null
        return (
          <li key={i} className={levelTone(level)}>
            {panel.time && <time>{t ? clock(t, true) : String(row[panel.time] ?? '')}</time>}
            {level && <span className="monitor-level">{level}</span>}
            <span className="monitor-log-text">{String(row[panel.text!] ?? '')}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Named values of the first row, each green, orange or red by the rules on it, plain with none. */
function Checks({ panel, data, detail, style }: { panel: MonitorPanel; data: SourceData; detail: Detail; style: ValueStyle }) {
  const row = data.rows[0] ?? {}
  return (
    <ul className="monitor-checks">
      {(panel.fields ?? []).map(({ field, label }) => {
        const rules = detail.spec.rules.filter(r => r.source === panel.source && r.field === field && !r.failing && !r.new_rows && r.level !== 'done')
        const firing = rules.filter(r => detail.rules[r.id]?.firing)
        const heard = firing.filter(r => !(r.id in detail.summary.snoozed))
        const tone = heard.some(r => r.level === 'alert') ? 'alert' : heard.length ? 'warn' : firing.length ? 'snoozed' : rules.length ? 'ok' : ''
        const tip = firing.map(r => `${r.name}: ${detail.rules[r.id]?.message ?? ''}`).join('\n') || rules.map(r => `${r.name}: OK`).join('\n')
        return (
          <li key={field} className={tone} title={tip || undefined}>
            <span className="monitor-check-dot" />
            <span className="monitor-check-label">{label ?? humanize(field)}</span>
            <span className="monitor-check-value">{formatValue(row[field], style)}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Stages from the first row, each as a bar against the largest, with what share of the stage before made it. */
function Funnel({ panel, data, style }: { panel: MonitorPanel; data: SourceData; style: ValueStyle }) {
  const row = data.rows[0] ?? {}
  const stages = (panel.fields ?? []).map(f => ({ ...f, value: toNumber(row[f.field]) }))
  const most = Math.max(0, ...stages.map(s => s.value ?? 0))
  return (
    <ol className="monitor-funnel">
      {stages.map((stage, i) => {
        const before = i > 0 ? stages[i - 1].value : null
        const share = stage.value !== null && before ? stage.value / before : null
        return (
          <li key={stage.field}>
            <span className="monitor-funnel-label">{stage.label ?? humanize(stage.field)}</span>
            <span className="monitor-funnel-track">
              <span className="monitor-funnel-bar" style={{ width: `${most > 0 && stage.value !== null ? Math.max(0.5, (stage.value / most) * 100) : 0}%` }} />
            </span>
            <span className="monitor-funnel-value">{formatValue(stage.value, style)}</span>
            <span className="monitor-funnel-share" title={i > 0 ? `of ${stages[i - 1].label ?? humanize(stages[i - 1].field)}` : undefined}>
              {share === null ? '' : `${Math.round(share * 1000) / 10}%`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const toNumber = (v: MonitorValue | undefined) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function levelTone(level: string) {
  const l = level.toLowerCase()
  if (/^(fatal|crit|err|error|alert|emerg)/.test(l)) return 'red'
  if (/^warn/.test(l)) return 'orange'
  return ''
}

/** The commands, folded away once allowed and working: they matter when something's wrong. */
function Commands({ detail }: { detail: Detail }) {
  const entries = Object.entries(detail.spec.sources)
  const failing = entries.filter(([name]) => detail.sources[name]?.latest?.ok === false).length
  const [open, setOpen] = useState(false)
  const shown = open || failing > 0
  return (
    <section className="monitor-commands">
      <button className="monitor-commands-toggle" onClick={() => setOpen(!shown)} disabled={failing > 0} aria-expanded={shown}>
        <ChevronRight size={13} strokeWidth={2.2} className={shown ? 'open' : undefined} />
        <h3 className="status-subhead">Commands</h3>
        <span>{entries.length}{failing > 0 ? ` · ${failing} failing` : ''}</span>
      </button>
      {shown && entries.map(([name, source]) => {
        const data = detail.sources[name]
        const latest = data?.latest
        return (
          <div key={name} className="monitor-command">
            <div className="monitor-command-meta">
              <strong>{name}</strong>
              <span>
                {scheduleText(source)} · {source.format}
                {!data?.approved ? ' · not allowed yet'
                  : latest ? <> · {latest.ok ? `${latest.total ?? 0} row${latest.total === 1 ? '' : 's'}` : 'failed'} in {formatValue(latest.ms, { format: 'ms' })}, <Ago t={latest.t} /></>
                  : ' · not run yet'}
              </span>
            </div>
            <pre>{source.run}</pre>
            <Wakes detail={detail} source={name} />
            {latest && !latest.ok && <p className="monitor-error-text">{latest.error}</p>}
          </div>
        )
      })}
    </section>
  )
}
