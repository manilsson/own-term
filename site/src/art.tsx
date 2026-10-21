// Original illustrations for the page, drawn in SVG and CSS from the icon's ring and cursor and the
// app's own colors, in the spirit of Apple's product-page art.
import { useRef } from 'react'
import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react'
import { StatusGlyph, type Status } from './mock'
import { AlarmClock, BookOpen, Bug, ChartLine, CreditCard, Flame, Receipt, Server, Wifi } from 'lucide-react'
import { EASE, Keycap, useLoop } from './ui'

/**
 * The icon's mark at poster size: the ring draws itself as it scrolls into view and the cursor
 * lands to finish it, with faint echo rings around it.
 */
export function RingArt() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] })
  const draw = useTransform(scrollYProgress, [0.1, 0.9], [0, 1])
  const cursor = useTransform(scrollYProgress, [0.75, 1], [0, 1])
  const cursorY = useTransform(scrollYProgress, [0.75, 1], [40, 0])
  // Same geometry as the icon: radius 288 on a 1024 canvas, cursor at 32° below 3 o'clock.
  const arc = 'M 608.1 783.5 A 288 288 0 1 1 798.1 479.4'
  return (
    <div className="ring-art" ref={ref} aria-hidden="true">
      <svg viewBox="0 0 1024 1024">
        <defs>
          <linearGradient id="ring-cursor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffc35c" />
            <stop offset="1" stopColor="#ffa424" />
          </linearGradient>
          <filter id="ring-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30" /></filter>
        </defs>
        {[420, 360].map((r, i) => (
          <circle key={r} cx="512" cy="512" r={r} fill="none" stroke="currentColor" strokeOpacity={0.06 + i * 0.03} strokeWidth="2" />
        ))}
        <motion.path d={arc} fill="none" stroke="currentColor" strokeWidth="96" strokeLinecap="round" style={{ pathLength: draw }} />
        <motion.g style={{ opacity: cursor, y: cursorY }}>
          <rect x="692.2" y="562.6" width="128" height="204" rx="30.7" fill="#ffa424" opacity=".5" filter="url(#ring-glow)" />
          <rect x="692.2" y="562.6" width="128" height="204" rx="30.7" fill="url(#ring-cursor)" />
        </motion.g>
      </svg>
    </div>
  )
}

/** Small drawings for the feature cards, one per card, in the app's colors. */
export const FeatureArt = {
  restart: () => (
    <div className="mini restart">
      {['Apple Pay at checkout', 'Offline cart sync', 'Crash on launch'].map((name, i) => (
        <motion.div key={name} className="mini-row" initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15 }}>
          <i className={['spin', 'dot', 'ok'][i]} />
          <span>{name}</span>
          <small>Resumed</small>
        </motion.div>
      ))}
    </div>
  ),
  worktree: () => (
    <svg className="mini" viewBox="0 0 260 120">
      <path d="M20 90 H240" style={{ stroke: 'var(--ink)' }} strokeOpacity=".25" strokeWidth="4" strokeLinecap="round" />
      <motion.path d="M70 90 C 110 90 110 40 150 40 H230" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2 }} />
      {[[20, 90, 'var(--ink)'], [70, 90, 'var(--ink)'], [150, 40, 'var(--accent)'], [230, 40, 'var(--accent)']].map(([x, y, c], i) => (
        <circle key={i} cx={x} cy={y} r="8" style={{ fill: 'var(--tile)', stroke: c as string }} strokeWidth="4" />
      ))}
      <text x="150" y="22" fontSize="13" style={{ fill: 'var(--accent)' }} fontWeight="600">feat/apple-pay</text>
      <text x="20" y="114" fontSize="13" style={{ fill: 'var(--secondary)' }}>main</text>
    </svg>
  ),
  bottomUp: () => (
    <div className="mini bottom-up">
      {[0.5, 0.75, 0.6, 0.9].map((w, i) => (
        <motion.span key={i} style={{ width: `${w * 100}%` }} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 * (3 - i) }} />
      ))}
      <div className="mini-prompt">❯ <b /></div>
    </div>
  ),
  find: () => (
    <div className="mini find">
      <p>Cart 210 ms</p>
      <p><mark className="on">Payment</mark> intent 1.4 s</p>
      <p><mark>Payment</mark> intents queue behind…</p>
    </div>
  ),
  paths: () => (
    <div className="mini paths">
      <span>src/app/checkout/<u>page.tsx:62</u></span>
      <motion.em initial={{ scale: 0.8, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4, type: 'spring' }}>Opens at line 62</motion.em>
    </div>
  ),
  organize: () => (
    <div className="mini organize">
      <motion.div className="mini-row" initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
        <i className="spin" />
        <span>Crash on launch</span>
        <small>Named from your prompt</small>
      </motion.div>
      <motion.p className="mini-notice" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.55 }}>
        Moved to iOS app <b>Undo</b>
      </motion.p>
    </div>
  ),
  palette: () => (
    <div className="mini palette-mini">
      <p className="palette-mini-field">pay<motion.i animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} /></p>
      <p className="palette-mini-row on">Apple Pay at checkout</p>
      <p className="palette-mini-row">Payments</p>
    </div>
  ),
  remind: () => (
    <div className="mini remind">
      <motion.div className="mini-row" initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
        <i className="clock"><AlarmClock size={12} strokeWidth={2.2} /></i>
        <span>Release notes 4.2</span>
        <small>Tomorrow at 9:00</small>
      </motion.div>
      <motion.div className="mini-banner" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.6 }}>
        <b>Reminder</b>
        <span>Post them once 4.2 ships</span>
        <em>Snooze 1 Hour</em>
      </motion.div>
    </div>
  ),
  icons: () => (
    <div className="mini icons">
      {([[CreditCard, 'Apple Pay at checkout'], [Bug, 'Double charge on retry'], [ChartLine, 'Checkout load test'], [Wifi, 'Offline cart sync'], [Flame, 'Crash on launch'], [Receipt, 'Q3 order export'], [BookOpen, 'Getting started guide'], [Server, 'Docs dev server']] as const).map(([Icon, name], i) => (
        <motion.div key={name} className="mini-row" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.07 }}>
          <Icon size={15} strokeWidth={1.75} />
          <span>{name}</span>
        </motion.div>
      ))}
    </div>
  ),
  panes: PanesArt,
  marks: MarksArt,
  undo: UndoArt,
}

const PANE_SESSIONS: [string, Status][] = [['Offline cart sync', 'working'], ['Crash on launch', 'done'], ['Apple Pay', 'working']]

// What the card's text says, one beat each: the widths of the panes, which one is ringed, and the hint.
const PANE_BEATS: { widths: number[]; focus: number; zoom?: boolean; hint: string }[] = [
  { widths: [1.5, 1], focus: 0, hint: 'Two sessions of a group, side by side.' },
  { widths: [1.5, 0.75, 0.75], focus: 2, hint: 'Drop a session on an edge to split it in.' },
  { widths: [1, 1, 1], focus: 2, hint: 'Double-click a gap and they share the room.' },
  { widths: [1, 1, 1], focus: 2, zoom: true, hint: '⌘↩ zooms the pane you’re in.' },
]

/** Three panes acting out the card: a split, an equal share, a zoom, with the focused one ringed. */
function PanesArt() {
  const ref = useRef<HTMLDivElement>(null)
  const beat = PANE_BEATS[useLoop(ref, PANE_BEATS.length, 2200)]
  const spring = { type: 'spring', stiffness: 170, damping: 24 } as const
  return (
    <div className="mini panes" ref={ref}>
      <div className="mini-panes-box">
        <AnimatePresence initial={false}>
          {beat.widths.map((w, i) => {
            const hidden = beat.zoom && i !== beat.focus
            return (
              <motion.div
                key={PANE_SESSIONS[i][0]}
                className={`mini-pane ${i === beat.focus ? 'ringed' : ''}`}
                initial={{ flexGrow: 0, opacity: 0, paddingLeft: 0, paddingRight: 0, marginLeft: -8 }}
                animate={hidden ? { flexGrow: 0, opacity: 0, paddingLeft: 0, paddingRight: 0, marginLeft: -8 } : { flexGrow: w, opacity: 1, paddingLeft: 12, paddingRight: 12, marginLeft: 0 }}
                exit={{ flexGrow: 0, opacity: 0, paddingLeft: 0, paddingRight: 0, marginLeft: -8 }}
                transition={spring}
              >
                <div className="mini-pane-head"><StatusGlyph status={PANE_SESSIONS[i][1]} /><span>{PANE_SESSIONS[i][0]}</span></div>
                <i style={{ width: '72%' }} /><i style={{ width: '48%' }} /><i style={{ width: '60%' }} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <Caption text={beat.hint} all={PANE_BEATS.map(b => b.hint)} />
    </div>
  )
}

/** A card's caption, swapped as its loop moves on, in the room of the longest so the card keeps its height. */
function Caption({ text, all }: { text: string; all: string[] }) {
  return (
    <div className="keeps-room">
      {all.map(t => <p key={t} className="mini-caption" aria-hidden="true">{t}</p>)}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={text} className="mini-caption" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

type Mark = 'prompt' | 'ask' | 'done'

// A conversation as a pane shows it, a line each; the marked ones get a tick beside the scrollbar.
const MARK_LINES: { mark?: Mark; text?: string; width?: number }[] = [
  { mark: 'prompt', text: '❯ Add Apple Pay to checkout' },
  { width: 0.8 },
  { width: 0.55 },
  { mark: 'ask', text: 'Allow npm install @stripe/stripe-js?' },
  { width: 0.7 },
  { mark: 'done', text: '✻ Worked for 6m 26s' },
  { mark: 'prompt', text: '❯ Open a draft pull request' },
  { width: 0.6 },
  { mark: 'done', text: '✻ Worked for 48s' },
]

const MARKED = MARK_LINES.flatMap((line, i) => (line.mark ? [i] : []))
const MARK_HINT: Record<Mark, string> = { prompt: 'A prompt you sent.', ask: 'Where Claude asked for you.', done: 'Where a turn finished.' }

/** A pane's scrollback beside its ruler, stepping from tick to tick as a click on each would. */
function MarksArt() {
  const ref = useRef<HTMLDivElement>(null)
  const on = MARKED[useLoop(ref, MARKED.length, 1800)]
  return (
    <div className="mini marks-mini" ref={ref}>
      <div className="marks-box">
        <div className="marks-lines">
          {MARK_LINES.map((line, i) => (
            <div key={i} className={`marks-line ${line.mark ?? ''} ${i === on ? 'on' : ''}`}>
              {line.text ?? <span style={{ width: `${(line.width ?? 1) * 100}%` }} />}
            </div>
          ))}
        </div>
        <div className="marks-ruler">
          {MARKED.map(i => (
            <i key={i} className={`${MARK_LINES[i].mark} ${i === on ? 'on' : ''}`} style={{ top: `${((i + 0.5) / MARK_LINES.length) * 100}%` }} />
          ))}
        </div>
      </div>
      <Caption text={MARK_HINT[MARK_LINES[on].mark!]} all={Object.values(MARK_HINT)} />
    </div>
  )
}

/** A session ended, its notice, ⌘Z, and the session back where it was. */
function UndoArt() {
  const ref = useRef<HTMLDivElement>(null)
  const beat = useLoop(ref, 4, 1700)
  const gone = beat === 1 || beat === 2
  return (
    <div className="mini undo-mini" ref={ref}>
      <div className="undo-rows">
        <AnimatePresence initial={false}>
          {!gone && (
            <motion.div key="load" className="mini-row" initial={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }} animate={{ opacity: 1, height: 'auto', paddingTop: 9, paddingBottom: 9 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: 0.35, ease: EASE }}>
              <i className="ok" />
              <span>Checkout load test</span>
              <small>{beat === 3 ? 'Resumed' : ''}</small>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mini-row"><i className="spin" /><span>Apple Pay at checkout</span></div>
      </div>
      <div className="undo-line">
        {/* An unseen copy holds the notice's room, however it wraps, so its coming and going moves nothing. */}
        <div className="keeps-room">
          <p className="mini-notice" aria-hidden="true">Claude ended Checkout load test<b>Undo</b></p>
          <AnimatePresence initial={false}>
            {gone && (
              <motion.p key="notice" className="mini-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.3, ease: EASE }}>
                Claude ended Checkout load test<b>Undo</b>
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <span className="undo-keys"><Keycap pressed={beat === 2}>⌘</Keycap><Keycap pressed={beat === 2}>Z</Keycap></span>
      </div>
    </div>
  )
}
