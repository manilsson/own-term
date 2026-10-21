import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, Check, RefreshCw, ShoppingCart } from 'lucide-react'
import { StatusGlyph, type Status } from './mock'
import { Statement } from './statement'
import { EASE, Reveal, SectionHead, useLoop } from './ui'

// Checkout's errors a minute: the last half hour, then one value per beat. The spike fires the rule.
const HISTORY = [2, 1, 3, 2, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 2, 1, 2, 2]
const BEATS = [2, 1, 3, 7, 9, 6, 3, 2, 1, 2, 2, 1]
const LIMIT = 5
const WINDOW = HISTORY.length

// What else the page shows on each beat: p95 at /api/pay in ms, and orders a minute.
const P95 = [410, 395, 430, 1650, 1920, 1280, 610, 450, 420, 405, 400, 415]
const ORDERS = [38, 41, 37, 31, 27, 33, 36, 39, 40, 38, 41, 39]

// The log panel's newest rows, the first arriving with the spike.
const ERRORS: [string, string][] = [
  ['POST /api/pay', '502 Payment provider timed out'],
  ['POST /api/pay', '502 Payment provider timed out'],
  ['POST /api/refund', '409 Charge already refunded'],
]

// The spec Claude saves, as its save_monitor call reads in the transcript. A tag ties a line to what it
// does on the page: sources run each beat, and a rule's lines light while it fires.
type SpecTag = 'source' | 'alert' | 'wake'
const SPEC: [string, SpecTag?][] = [
  ['  name: "Checkout errors",'],
  ['  icon: "shopping-cart",'],
  ['  expires: "6h",'],
  ['  sources: {'],
  ['    errors: { every: "1m", format: "number",', 'source'],
  ['      run: "curl -s $LOGS/errors/count?since=$OWN_TERM_SINCE" },', 'source'],
  ['    p95: { every: "1m", format: "number",', 'source'],
  ['      run: "curl -s $METRICS/p95?route=/api/pay" },', 'source'],
  ['    orders: { every: "1m", format: "number",', 'source'],
  ['      run: "psql $DB -tAc \'select count(*) …\'" },', 'source'],
  ['    newest: { every: "1m", format: "json", key: "id",', 'source'],
  ['      run: "curl -s $LOGS/errors?since=$OWN_TERM_SINCE" },', 'source'],
  ['  },'],
  ['  panels: ['],
  ['    { type: "stat", source: "errors" },'],
  ['    { type: "stat", source: "p95", format: "ms" },'],
  ['    { type: "stat", source: "orders" },'],
  ['    { type: "area", source: "errors", y: "value" },'],
  ['    { type: "log", source: "newest", text: "message" },'],
  ['  ],'],
  ['  rules: ['],
  ['    { name: "Errors above 5 a minute", level: "alert",', 'alert'],
  ['      source: "errors", field: "value", op: ">", value: 5 },', 'alert'],
  ['    { name: "A new error", level: "warn",', 'wake'],
  ['      source: "newest", new_rows: true,', 'wake'],
  ['      prompt: "Find what’s behind it and open an issue." },', 'wake'],
  ['  ],'],
]

/** A monitor acted out: the spec Claude wrote beside the page Own Term draws from it, where a spike fires a rule and the rule wakes Claude. */
export function MonitorsStory() {
  const ref = useRef<HTMLElement>(null)
  const beat = useLoop(ref, BEATS.length, 1400)
  const series = [...HISTORY, ...BEATS.slice(0, beat + 1)].slice(-WINDOW)
  const value = BEATS[beat]
  const alert = value > LIMIT
  const firstAlert = BEATS.findIndex(v => v > LIMIT)
  const errors = beat >= firstAlert ? Math.min(ERRORS.length, beat - firstAlert + 1) : 0
  const waking = beat >= firstAlert && beat < firstAlert + ERRORS.length
  // Claude wakes the beat after the first new error, and is done three beats later.
  const claude: Status = beat === firstAlert + 1 || beat === firstAlert + 2 || beat === firstAlert + 3 ? 'working' : beat > firstAlert + 3 ? 'done' : 'idle'
  const lit = { source: false, alert, wake: waking }
  return (
    <section className="section band" id="monitors" ref={ref}>
      <SectionHead eyebrow="Monitors" title={<>Keep an eye on it.<br />Without asking again.</>}>
        Ask Claude to watch error rates, a deploy, a queue or a pull request’s checks. It writes a monitor
        once, and Own Term fills a page in the sidebar by running its commands on a schedule, whether or
        not any session is open.
      </SectionHead>
      <div className="monitor-stage">
        <Reveal className="monitor-side">
          <p className="stage-caption"><Bot size={15} strokeWidth={2} />Claude writes it once</p>
          <div className="monitor-spec" aria-label="The monitor Claude saved: its commands, panels and rules">
            <div className="spec-call"><span className="transcript-mark green">⏺</span>own-term - save_monitor(</div>
            {SPEC.map(([text, tag], i) => (
              <div key={i} className={`spec-line ${tag ?? ''} ${tag && lit[tag] ? 'lit' : ''}`}>
                {tag === 'source' && <motion.span key={beat} className="spec-ran" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.1, ease: 'easeOut' }} />}
                <Code text={text} />
              </div>
            ))}
            <div className="spec-call">)</div>
            <div className="spec-result">⎿ Saved Checkout errors. It runs once you press Allow on its page.</div>
          </div>
        </Reveal>
        <Reveal className="monitor-side" delay={0.12}>
          <p className="stage-caption"><RefreshCw size={15} strokeWidth={2} />Own Term runs it every minute</p>
          <div className="monitor-page" aria-label="The monitor's page catching a spike and waking Claude">
            <div className="monitor-head">
              <span className="monitor-status">
                <span className={`monitor-dot ${alert ? 'alert' : 'ok'}`} />
                {alert ? 'Alert' : 'All clear'} · Checked just now
              </span>
              <h3><ShoppingCart size={22} strokeWidth={1.75} />Checkout errors</h3>
              <p>Payment errors in the API logs, a minute at a time, and the route that threw them.</p>
            </div>
            <div className="monitor-rules">
              <span className={`monitor-rule ${alert ? 'firing' : ''}`}><i />Errors above 5 a minute</span>
              <span className={`monitor-rule wake ${waking ? 'firing' : ''}`}><i />A new error · wakes Claude</span>
            </div>
            <div className="monitor-panels">
              <Stat label="Errors a minute" value={String(value)} alert={alert} />
              <Stat label="p95 at /api/pay" value={P95[beat] >= 1000 ? `${(P95[beat] / 1000).toFixed(1)} s` : `${P95[beat]} ms`} alert={P95[beat] >= 1000} />
              <Stat label="Orders a minute" value={String(ORDERS[beat])} />
              <div className="monitor-panel monitor-chart">
                <span className="monitor-label">Errors a minute · last 20 min</span>
                <Chart series={series} />
              </div>
              <div className="monitor-panel monitor-log">
                <span className="monitor-label">Newest errors</span>
                <AnimatePresence initial={false}>
                  {ERRORS.slice(0, errors).map(([route, text], i) => (
                    <motion.p key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                      <b>{route}</b>{text}
                    </motion.p>
                  ))}
                </AnimatePresence>
                {!errors && <p className="monitor-quiet">Nothing new since 21:02</p>}
              </div>
            </div>
            <AnimatePresence>
              {claude !== 'idle' && (
                <motion.div key="woke" className="notice monitor-notice" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.35, ease: EASE }}>
                  {claude === 'working'
                    ? <><StatusGlyph status="working" />Checkout errors woke Claude in Checkout bugs from support</>
                    : <><Check size={13} strokeWidth={2.6} className="monitor-notice-check" />Claude found the provider timing out and opened an issue</>}
                </motion.div>
              )}
            </AnimatePresence>
            {/* Overhangs the page's corner, as a notification sits over whatever is on screen. */}
            <AnimatePresence>
              {beat >= firstAlert && beat <= firstAlert + 2 && (
                <motion.div key="banner" className="monitor-banner" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.45, ease: EASE }}>
                  <div className="banner">
                    <div className="banner-icon">
                      <img src="icon.png" alt="" />
                      <span className="banner-badge input">!</span>
                    </div>
                    <div className="banner-body">
                      <div className="banner-head"><b>Checkout errors: Errors above 5 a minute</b><span>now</span></div>
                      <div className="banner-branch">Alert</div>
                      <div className="banner-text">7 a minute, most on POST /api/pay.</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
      <Statement text="Claude writes the monitor once. Own Term does the polling, so watching costs no tokens." />
    </section>
  )
}

/** A line of the spec, its keys and strings colored as the transcript shows code. */
function Code({ text }: { text: string }) {
  return <>{text.split(/("(?:[^"\\]|\\.)*"|\b\w+(?=: ))/).map((part, i) => (
    part.startsWith('"') ? <span key={i} className="spec-str">{part}</span>
      : i % 2 ? <span key={i} className="spec-key">{part}</span>
        : part
  ))}</>
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`monitor-panel monitor-stat ${alert ? 'alert' : ''}`}>
      <span className="monitor-label">{label}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.b key={value} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.3 }}>{value}</motion.b>
      </AnimatePresence>
    </div>
  )
}

/** A line chart of the window, with the rule's limit dashed across it. */
function Chart({ series }: { series: number[] }) {
  const w = 600
  const h = 120
  const max = 10
  const x = (i: number) => (i / (series.length - 1)) * w
  const y = (v: number) => h - (v / max) * h
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const last = series[series.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {/* Drawn in from the left the first time it shows; a clip, since the line itself moves every beat. */}
      <defs>
        <clipPath id="monitor-draw">
          <motion.rect x="-10" y="-10" height={h + 20} initial={{ width: 0 }} whileInView={{ width: w + 20 }} viewport={{ once: true }} transition={{ duration: 1.4, ease: EASE, delay: 0.3 }} />
        </clipPath>
      </defs>
      <line x1="0" x2={w} y1={y(LIMIT)} y2={y(LIMIT)} className="monitor-limit" />
      <g clipPath="url(#monitor-draw)">
        <motion.path d={`${line} L${w} ${h} L0 ${h} Z`} className="monitor-area" animate={{ d: `${line} L${w} ${h} L0 ${h} Z` }} transition={{ duration: 0.5, ease: EASE }} />
        <motion.path d={line} className="monitor-line" animate={{ d: line }} transition={{ duration: 0.5, ease: EASE }} />
        <motion.circle r="4" cx={w} className={`monitor-point ${last > LIMIT ? 'alert' : ''}`} animate={{ cy: y(last) }} transition={{ duration: 0.5, ease: EASE }} />
      </g>
    </svg>
  )
}
