import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { AlarmClock, Bell, Bug, ChartLine, CreditCard, FolderTree, Inbox, Newspaper, PanelLeft, Play, Search, Send, Server, Wifi, type LucideIcon } from 'lucide-react'
import { Banner, Folder, GroupChildren, Row, SmartTiles, StatusGlyph, type Status } from './mock'
import { EASE, Reveal, Shot, useLoop } from './ui'

const TAGS = { checkout: '#0a84ff', ios: '#40c8e0', docs: '#bf5af2' }

// Four sessions through a stretch of a working day, one frame per beat.
const DAY: [Status, Status, Status, Status][] = [
  ['working', 'working', 'idle', 'idle'],
  ['working', 'working', 'working', 'running'],
  ['working', 'done', 'working', 'running'],
  ['working', 'done', 'input', 'running'],
  ['done', 'done', 'input', 'running'],
  ['done', 'idle', 'input', 'running'],
  ['idle', 'idle', 'working', 'running'],
]

const LEGEND: [Status, string, string][] = [
  ['working', 'Working', 'Claude is on it.'],
  ['input', 'Needs input', 'A question or a permission to approve.'],
  ['done', 'Your turn', 'Claude finished and is waiting for you.'],
  ['running', 'Running', 'A shell busy with a command, like a dev server.'],
  ['reminder', 'Reminder', 'A time you set has come. Snooze it an hour from the banner.'],
]

// The four sessions of the sidebar card, as the menu bar's panel describes them in each status.
const PANEL_SESSIONS: { name: string; group: string; time: string; text: Partial<Record<Status, string>> }[] = [
  { name: 'Apple Pay at checkout', group: 'Checkout', time: '6m', text: { working: 'Editing ApplePayButton.tsx', done: 'Apple Pay shows on devices that support it.' } },
  { name: 'Checkout load test', group: 'Checkout', time: '14m', text: { working: 'Run the checkout load test', done: 'Holds up at three times Black Friday.' } },
  { name: 'Double charge on retry', group: 'Checkout', time: '2m', text: { working: 'Editing retry.ts', input: 'Bash: pnpm prisma migrate dev' } },
  { name: 'Docs dev server', group: 'Docs site', time: '', text: { running: 'Running a command' } },
]

const PANEL_SECTIONS: [string, Status[]][] = [['Needs you', ['input', 'done']], ['Working', ['working']], ['Running', ['running']]]

const WHERE: [React.ReactNode, string, string][] = [
  [<PanelLeft />, 'In the sidebar', 'Every session says where it stands, and Needs You collects the ones waiting. ⌘J goes to whoever has waited longest.'],
  [<MenuBarMark />, 'In the menu bar', 'From any app, the icon’s cursor blinks while Claude works, and a count says who needs you. Click it to see what each one is doing, and answer.'],
  [<Bell />, 'In a notification', 'When a session finishes or asks, you hear about it once, with Claude’s words. Approve a permission or type a reply right in the banner.'],
]

/** Where Claude stands in every session: in the sidebar, and from any other app in the menu bar and notifications. */
export function StatusStory() {
  const ref = useRef<HTMLElement>(null)
  const beat = useLoop(ref, DAY.length, 1900)
  const statuses = DAY[beat]
  const [a, b, c, d] = statuses
  const waiting = statuses.filter(s => s === 'input' || s === 'done').length
  const working = statuses.filter(s => s === 'working').length
  // The newest thing that needs you gets the banner: the permission first, then whoever just finished.
  const banner = c === 'input' ? 0 : b === 'done' ? 1 : a === 'done' ? 2 : -1
  return (
    <section className="section" id="status" ref={ref}>
      <div className="split status-split">
        <div>
          <Reveal><p className="eyebrow">Status</p></Reveal>
          <Reveal delay={0.06}><h2 className="title small">Knows what Claude is doing. Wherever you are.</h2></Reveal>
          <Reveal delay={0.12}>
            <p className="status-lede">
              Own Term listens to Claude Code as it works, so you always know which sessions are busy, which
              are waiting for you and what each one is up to, even from another app.
            </p>
          </Reveal>
          <Reveal delay={0.18} className="legend">
            {LEGEND.map(([status, label, text]) => (
              <div className="legend-item" key={status}>
                <StatusGlyph status={status} />
                <div><b>{label}</b><span>{text}</span></div>
              </div>
            ))}
          </Reveal>
        </div>
        <Reveal delay={0.1} className="card sidebar-card">
          <div className="search"><Search size={13} strokeWidth={2} />Search</div>
          <SmartTiles waiting={waiting} working={working} today={2} reminders={1} />
          <p className="section-label">Groups</p>
          <Folder name="Checkout" color={TAGS.checkout} count={3} />
          <GroupChildren color={TAGS.checkout}>
            <Row icon={CreditCard} name="Apple Pay at checkout" status={a} meta="feat/apple-pay" diff={[212, 18]} selected />
            <Row icon={ChartLine} name="Checkout load test" status={b} meta="perf/checkout-load" diff={[38, 2]} />
            <Row icon={Bug} name="Double charge on retry" status={c} meta="fix/idempotent-retry" diff={[57, 11]} />
          </GroupChildren>
          <Folder name="Docs site" color={TAGS.docs} count={1} />
          <GroupChildren color={TAGS.docs}>
            <Row icon={Server} name="Docs dev server" status={d} meta="main" shell />
          </GroupChildren>
        </Reveal>
      </div>
      <Reveal>
        <div className="desktop" aria-label="Own Term in the menu bar, over another app">
          <div className="desktop-bar">
            <span className="desktop-extra" />
            <span className="desktop-extra" />
            <span className="desktop-own-term">
              <MenuBarMark blinking={working > 0} />
              {waiting > 0 && <span>{waiting}</span>}
            </span>
            <Wifi size={15} strokeWidth={2.2} />
            <span>Mon 9:41</span>
          </div>
          <div className="desktop-app" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <div className="menubar-panel">
            <div className="menubar-head">
              <MenuBarMark />
              <div>
                <b>Own Term</b>
                <span>{[waiting && `${waiting} need${waiting === 1 ? 's' : ''} you`, working && `${working} working`].filter(Boolean).join(' · ') || 'All quiet'}</span>
              </div>
            </div>
            <LayoutGroup>
              {PANEL_SECTIONS.map(([title, wanted]) => {
                const rows = PANEL_SESSIONS.map((session, i) => ({ ...session, status: statuses[i] })).filter(x => wanted.includes(x.status))
                if (!rows.length) return null
                return (
                  <motion.div key={title} layout="position">
                    <p className="menubar-section">{title}</p>
                    {rows.map(x => (
                      <motion.div key={x.name} layoutId={`panel-${x.name}`} className="menubar-row" transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                        <div className="menubar-row-head">
                          <StatusGlyph status={x.status} shell={x.status === 'running'} />
                          <span className="menubar-name">{x.name}</span>
                          <span className="menubar-time">{[x.group, x.status !== 'running' && x.time].filter(Boolean).join(' · ')}</span>
                        </div>
                        <div className="menubar-text">{x.text[x.status]}</div>
                        {x.status === 'input' && <div className="answer-buttons"><span>Deny</span><span className="default">Allow</span></div>}
                        {x.status === 'done' && <div className="reply-field">Reply to Claude</div>}
                      </motion.div>
                    ))}
                  </motion.div>
                )
              })}
            </LayoutGroup>
          </div>
          <div className="desk-banners">
            <AnimatePresence mode="popLayout">
              {banner >= 0 && (
                <motion.div
                  key={banner}
                  initial={{ x: -80, opacity: 0, scale: 0.96 }}
                  animate={{ x: 0, opacity: 1, scale: 1 }}
                  exit={{ y: -30, opacity: 0, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                >
                  <Banner {...BANNERS[banner]} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
      <div className="info-points three">
        {WHERE.map(([icon, title, text], i) => (
          <Reveal key={title} delay={i * 0.06} className="info-point">
            <span className="info-point-icon">{icon}</span>
            <b>{title}</b>
            <p>{text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

const BANNERS: { title: string; branch: string; status: 'done' | 'input'; tag: string; text: string; actions?: boolean }[] = [
  { title: 'Double charge on retry', branch: 'fix/idempotent-retry', status: 'input', tag: TAGS.checkout, text: 'Bash: pnpm prisma migrate dev --name payment_attempts', actions: true },
  { title: 'Checkout load test', branch: 'perf/checkout-load', status: 'done', tag: TAGS.checkout, text: 'Checkout holds up at three times Black Friday. Payment intents need a bigger database pool.' },
  { title: 'Apple Pay at checkout', branch: 'feat/apple-pay', status: 'done', tag: TAGS.checkout, text: 'Apple Pay shows on devices that support it, and the card form stays as the fallback.' },
]

/** The menu bar icon: the mark drawn thin, its cursor blinking while Claude works (electron/menubar/). */
function MenuBarMark({ blinking }: { blinking?: boolean }) {
  return (
    <svg className={`menubar-mark ${blinking ? 'blinking' : ''}`} viewBox="152 152 720 720" aria-hidden="true">
      <path d="M 621.1 778.6 A 288 288 0 1 1 799.4 493.2" fill="none" stroke="currentColor" strokeWidth="76" strokeLinecap="round" />
      <rect x="701.1" y="565.8" width="110.2" height="197.6" rx="26.4" fill="currentColor" />
    </svg>
  )
}

const STEPS = [
  ['One session, the whole window.', 'Click a session and it fills the window, with its branch and status in the header.', 'loadtest'],
  ['A group, side by side.', 'Click a group and its sessions line up as cards, in the layout you last left them in. Double-click a gap to make them equal.', 'checkout'],
  ['Every group keeps its own layout.', 'Switch between groups without rearranging anything. ⌘-click sessions from different groups when the work crosses over, and each pane says which group it came from.', 'mixed'],
] as const

/** The bar beside a step fills across that step's share of the scroll, so every wheel tick shows as movement. */
function StepBar({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const n = STEPS.length
  const scaleY = useTransform(progress, [index / n, (index + 1) / n], [0, 1])
  return <span className="step-bar"><motion.span style={{ scaleY }} /></span>
}

/** Scroll-driven: the screenshot stays pinned while the steps beside it advance. */
export function GroupsStory() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [step, setStep] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', v => setStep(Math.min(STEPS.length - 1, Math.floor(v * STEPS.length))))
  return (
    <section className="scrolly" id="groups" ref={ref} style={{ height: `${STEPS.length * 100 + 40}vh` }}>
      <div className="scrolly-sticky">
        <div className="scrolly-copy">
          <p className="eyebrow">Groups</p>
          <h2 className="title small">Sessions that belong together, together.</h2>
          <ol className="steps">
            {STEPS.map(([title, text], i) => (
              <motion.li key={title} animate={{ opacity: i === step ? 1 : 0.35 }} transition={{ duration: 0.4 }}>
                <StepBar progress={scrollYProgress} index={i} />
                <div><b>{title}</b><p>{text}</p></div>
              </motion.li>
            ))}
          </ol>
        </div>
        <div className="scrolly-stage">
          {STEPS.map(([title, , src], i) => (
            <motion.div
              key={src}
              className="scrolly-shot"
              initial={false}
              animate={{ opacity: i === step ? 1 : 0, scale: i === step ? 1 : 0.97, filter: i === step ? 'blur(0px)' : 'blur(6px)' }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <Shot name={src} alt={title} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// The transcript of the tools story, one line per beat, with what the sidebar shows by then. `point` is the
// TOOL_POINTS entry the line acts out, lit beside the window while it does.
const TOOL_LINES: { kind: 'prompt' | 'tool' | 'say'; text: string; result?: string; point: number }[] = [
  { kind: 'prompt', point: 0, text: 'Three checkout bugs came in from support. Start a session for each in its own worktree, grouped under Checkout.' },
  { kind: 'tool', point: 0, text: 'own-term - create_group(name: "Checkout", color: "Blue")', result: 'Made the group Checkout' },
  { kind: 'tool', point: 1, text: 'own-term - new_session(worktree: "apple-pay", group: "Checkout", icon: "credit-card", prompt: "Add Apple Pay to checkout…")', result: 'Started Apple Pay at checkout on feat/apple-pay' },
  { kind: 'tool', point: 1, text: 'own-term - new_session(worktree: "idempotent-retry", group: "Checkout", icon: "bug", prompt: "A retry after a timeout charges twice…")', result: 'Started Double charge on retry on fix/idempotent-retry' },
  { kind: 'tool', point: 1, text: 'own-term - new_session(worktree: "checkout-load", group: "Checkout", icon: "chart-line", prompt: "Load test checkout at three times…")', result: 'Started Checkout load test on perf/checkout-load' },
  { kind: 'say', point: 1, text: 'Three sessions are running under Checkout, each on its own branch.' },
  { kind: 'prompt', point: 2, text: 'Have the load test open a pull request when it’s done. And remind me at four to try Apple Pay on my phone.' },
  { kind: 'tool', point: 2, text: 'own-term - send_prompt(session: "Checkout load test", prompt: "When you’re done, open a pull request…")', result: 'Sent to Checkout load test' },
  { kind: 'tool', point: 3, text: 'own-term - remind(session: "Apple Pay at checkout", at: "16:00", note: "Try it on a phone")', result: 'Reminds you at 16:00' },
  { kind: 'say', point: 3, text: 'Done. The load test opens its pull request when it finishes, and Apple Pay lands in Needs You at four.' },
]

// A prompt takes as long as it types; everything else lands a beat apart, and the finished transcript holds.
const TYPE_MS = 24
const toolBeat = (beat: number) => {
  const line = TOOL_LINES[beat]
  if (!line) return 4500
  return line.kind === 'prompt' ? line.text.length * TYPE_MS + 700 : 1500
}

const TOOL_ROWS: [string, string, LucideIcon][] = [
  ['Apple Pay at checkout', 'feat/apple-pay', CreditCard],
  ['Double charge on retry', 'fix/idempotent-retry', Bug],
  ['Checkout load test', 'perf/checkout-load', ChartLine],
]

const TOOL_POINTS: [React.ReactNode, string, string][] = [
  [<FolderTree />, 'Organizes on request', 'Ask for a tidy sidebar and Claude names and groups every session by what it’s about, in one step with one Undo.'],
  [<Play />, 'Starts the work', 'A session per task, each in its own worktree, grouped and named, with its first prompt already sent.'],
  [<Send />, 'Passes work along', 'Tell one session what to do once another is done. Claude sends the prompt there.'],
  [<AlarmClock />, 'Remembers for you', 'Ask for a reminder with a note. When it’s due, the session lands in Needs You.'],
]

/** Claude's own tools for Own Term, acted out: prompts typed in, tool calls landing, and a sidebar that fills in beside them. */
export function ToolsStory() {
  const ref = useRef<HTMLElement>(null)
  const beat = useLoop(ref, TOOL_LINES.length + 1, toolBeat)
  const shown = Math.min(beat, TOOL_LINES.length)
  const rows = Math.max(0, Math.min(shown - 2, TOOL_ROWS.length))
  const typing = TOOL_LINES[beat]?.kind === 'prompt' ? TOOL_LINES[beat].text : ''
  const point = (typing ? TOOL_LINES[beat] : TOOL_LINES[Math.max(0, shown - 1)]).point
  const reminded = shown >= 9
  return (
    <section className="section" id="tools" ref={ref}>
      <div className="tools-story">
        <div className="tools-copy">
          <Reveal><p className="eyebrow">Claude’s tools</p></Reveal>
          <Reveal delay={0.06}><h2 className="title small">Tell Claude.<br />It arranges the rest.</h2></Reveal>
          <Reveal delay={0.12}>
            <p className="tools-lede">
              Claude in any session has tools for Own Term itself. Every change comes with Undo, and there
              is nothing to install.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <ol className="tools-points">
              {TOOL_POINTS.map(([icon, title, text], i) => (
                <li key={title} className={i === point ? 'on' : ''}>
                  <span className="info-point-icon">{icon}</span>
                  <div><b>{title}</b><p>{text}</p></div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
        <Reveal className="tools-window" delay={0.1} aria-label="Own Term while Claude starts three sessions, hands one a prompt and sets a reminder">
          <div className="tools-bar"><span /><span /><span /></div>
          <div className="tools-body">
            <div className="tools-sidebar">
              <div className="search"><Search size={13} strokeWidth={2} />Search</div>
              <SmartTiles waiting={0} working={rows} today={2} reminders={reminded ? 1 : 0} />
              <p className="section-label">Groups</p>
              <AnimatePresence initial={false}>
                {shown >= 2 && (
                  <motion.div key="folder" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease: EASE }}>
                    <Folder name="Checkout" color={TAGS.checkout} count={rows} />
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.div layout>
                <GroupChildren color={TAGS.checkout}>
                  <AnimatePresence initial={false}>
                    {TOOL_ROWS.slice(0, rows).map(([name, branch, icon], i) => (
                      <motion.div key={name} initial={{ opacity: 0, height: 0, x: -10 }} animate={{ opacity: 1, height: 'auto', x: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease: EASE }}>
                        <Row icon={icon} name={name} status="working" meta={branch} remind={i === 0 && reminded} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </GroupChildren>
              </motion.div>
              <motion.p className="section-label" layout>Sessions</motion.p>
              <motion.div layout><Row icon={Inbox} name="Checkout bugs from support" status="idle" meta="main" selected nested={false} /></motion.div>
              <motion.div layout><Row icon={Newspaper} name="Release notes 4.2" status="idle" meta="main" nested={false} /></motion.div>
              <AnimatePresence>
                {shown >= 5 && shown < 7 && (
                  <motion.div key="notice" className="notice" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.35, ease: EASE }}>
                    Claude started 3 sessions in Checkout<b>Undo</b>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="tools-pane">
              <div className="tools-pane-head"><span className="dot accent" />Checkout bugs from support<span className="tools-branch">main</span></div>
              <div className="transcript">
                <AnimatePresence initial={false}>
                  {TOOL_LINES.slice(0, shown).map(line => (
                    <motion.div key={line.text} className={`transcript-line ${line.kind}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                      {line.kind === 'prompt' && <><span className="transcript-mark">❯</span>{line.text}</>}
                      {line.kind === 'tool' && <><span className="transcript-mark green">⏺</span><span className="transcript-call">{line.text}</span><span className="transcript-result">⎿ {line.result}</span></>}
                      {line.kind === 'say' && <><span className="transcript-mark">⏺</span>{line.text}</>}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="transcript-input">❯<Typed key={beat} text={typing} /></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/** Types `text` out a character at a time, the cursor after it; all at once under Reduce Motion. */
function Typed({ text }: { text: string }) {
  const reduced = useReducedMotion()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!text || reduced) return
    const timer = setInterval(() => setCount(c => (c >= text.length ? c : c + 1)), TYPE_MS)
    return () => clearInterval(timer)
  }, [text, reduced])
  return <span className="typed">{reduced ? text : text.slice(0, count)}<i /></span>
}
