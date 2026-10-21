// The info panel story: the panel rebuilt in HTML and kept live, the way the app's updates while
// Claude works (src/Info.tsx), beside a tour of what it tracks. Numbers come from the demo day's
// Apple Pay session (src/demo-info.ts).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { ArrowUp, Check, ChevronDown, Clock3, FileDiff, Folder, FolderOpen, GitBranch, GitPullRequest, NotebookPen, Sparkle, Sparkles, SquareTerminal, X } from 'lucide-react'
import { EASE, SectionHead } from './ui'

type Key = 'claude' | 'running' | 'changes' | 'branch' | 'scratchpad'

const FEATURES: [Key, React.ReactNode, string, string][] = [
  ['claude', <Sparkles />, 'Claude', 'How full its context is, how long each turn took, and the instructions and skills it was given.'],
  ['running', <SquareTerminal />, 'Running', 'Every command Claude runs and how it ended. A server wears its port, and a click shows what a command printed.'],
  ['changes', <FileDiff />, 'Changes', 'Each changed file, Claude’s edits marked. Click one to read the diff, or see an image before and after.'],
  ['branch', <GitPullRequest />, 'Branch and pull request', 'What’s left to push, and the pull request’s checks and review.'],
  ['scratchpad', <NotebookPen />, 'Scratchpad', 'The notes and files Claude saved for this conversation, a click from reading them.'],
]

const HINTS: Record<Key, string> = {
  claude: 'Click a card’s title to fold it to a line.',
  running: 'Click a command to see what it printed.',
  changes: 'Click a file with a diff to read it.',
  branch: 'It updates as Claude works.',
  scratchpad: 'Click a note to read it.',
}

const TICKS = 18
const TICK_MS = 1300
const STEP_MS = 5200
// The tick the test run finishes, a commit lands, and the pull request's last check passes.
const TESTS_DONE = 7
const COMMITTED = 9
const CHECKS_DONE = 13

// The context, in thousands of tokens, at each request so far; the live part adds to it.
const CONTEXT = [21, 25, 29, 33, 36, 41, 44, 48, 51, 55, 58, 62, 65, 69, 72, 76, 79, 82, 85, 88]

type Row = { kind: 'M' | 'U'; name: string; folder: string; added?: number; removed?: number; edited?: boolean; from?: number }

/** The Apple Pay session's changes; `from` is the tick a file first shows up, as Claude edits it. */
const ROWS = (tick: number): Row[] => ([
  { kind: 'M', name: 'wallets.ts', folder: 'src/lib/payments', added: Math.min(84, 66 + tick * 3), edited: true },
  { kind: 'M', name: 'actions.ts', folder: 'src/app/checkout', added: 62, edited: true, from: 4 },
  { kind: 'M', name: 'request.ts', folder: 'src/lib/payments', added: 38, removed: 9 },
  { kind: 'M', name: 'checkout.css', folder: 'src/app/checkout', added: 21, removed: 8 },
  { kind: 'M', name: 'page.tsx', folder: 'src/app/checkout', added: 7, removed: 1, edited: true },
  { kind: 'U', name: 'ApplePayButton.tsx', folder: 'src/components/checkout', edited: true },
  { kind: 'U', name: 'apple-pay.spec.ts', folder: 'tests/checkout' },
  { kind: 'U', name: 'apple-developer-merchantid-domain-association', folder: 'public/.well-known' },
] as Row[]).filter(row => (row.from ?? 0) <= tick)

type Tone = 'green' | 'red' | 'dim' | 'bold'
type Line = { n?: number; mark?: '+' | '-'; text: string; tone?: Tone }
type View = { title: string; chip: string; tone: 'accent' | 'green' | 'red' | 'neutral'; lines: Line[]; numbered?: boolean }

const out = (text: string, tone?: Tone): Line => ({ text, tone })
const numbered = (lines: string[]): Line[] => lines.map((text, i) => ({ n: i + 1, text }))
const diff = (lines: [number, '+' | '-' | ' ', string][]): Line[] => lines.map(([n, mark, text]) => ({ n, mark: mark === ' ' ? undefined : mark, text }))

const DIFFS: Record<string, Line[]> = {
  'page.tsx': diff([
    [60, ' ', '<h1>Checkout</h1>'],
    [61, ' ', '<OrderSummary cart={cart} />'],
    [62, '+', '<ApplePayButton'],
    [63, '+', '  intent={intent}'],
    [64, '+', '  onPaid={() => redirect(`/orders/${order.id}`)}'],
    [65, '+', '/>'],
    [66, '-', '<p className="pay-with">Pay with card</p>'],
    [66, '+', '<p className="checkout-or">or pay by card</p>'],
    [67, ' ', '<CardForm intent={intent} />'],
  ]),
  'wallets.ts': diff([
    [1, '+', "import { loadStripe } from '@/lib/payments/stripe'"],
    [2, '+', ''],
    [3, '+', '/** Whether this browser and device can pay with a wallet. */'],
    [4, '+', 'export async function canPayWithWallet(kind: Wallet) {'],
    [5, '+', '  const stripe = await loadStripe()'],
    [6, '+', '  const request = stripe.paymentRequest(PREVIEW)'],
    [7, '+', '  const result = await request.canMakePayment()'],
    [8, '+', '  return !!result?.[kind === \'apple-pay\' ? \'applePay\' : \'googlePay\']'],
    [9, '+', '}'],
  ]),
  'actions.ts': diff([
    [28, ' ', 'export async function createIntent(cart: Cart) {'],
    [29, '-', '  return stripe.paymentIntents.create({ amount: cart.total })'],
    [29, '+', '  return stripe.paymentIntents.create({'],
    [30, '+', '    amount: cart.total,'],
    [31, '+', "    payment_method_types: ['card', 'apple_pay'],"],
    [32, '+', '  })'],
    [33, ' ', '}'],
  ]),
}

type Command = { id: string; description: string; command: string; ended?: 'done' | number; time: string; output: Line[]; port?: number }

/** The commands Claude has run in the session by `tick`, as the Running card lists them: the running ones, then the finished, newest first. */
function commands(tick: number): { running: Command[]; finished: Command[] } {
  const testsDone = tick >= TESTS_DONE
  const server: Command = {
    id: 'server', description: 'Start the checkout dev server', command: 'npm run dev', port: 3000,
    time: duration(38 * 60 + 5 + tick * TICK_MS / 1000),
    output: [
      out('▲ Next.js 16.1', 'bold'),
      out('- Local:        http://localhost:3000'),
      out('✓ Ready in 1.2s', 'green'),
      out('○ Compiling /checkout ...', 'dim'),
      out('✓ Compiled /checkout in 840ms', 'green'),
      out(' GET /checkout 200 in 912ms'),
      out(' POST /checkout/actions 200 in 148ms'),
      out(' GET /api/wallets 200 in 22ms'),
      ...(tick >= 4 ? [out(' GET /checkout 200 in 61ms')] : []),
      ...(tick >= 10 ? [out(' POST /checkout/actions 200 in 133ms')] : []),
    ],
  }
  const tests: Command = {
    id: 'tests', description: 'Run the checkout tests', command: 'npx vitest run tests/checkout',
    ended: testsDone ? 'done' : undefined,
    time: testsDone ? 'now' : duration(2 * 60 + 5 + tick * TICK_MS / 1000),
    output: [
      out(' RUN  v3.2.4 ~/Code/juniper', 'dim'),
      out(' ✓ tests/checkout/cart.spec.ts (9 tests) 412ms', 'green'),
      out(' ✓ tests/checkout/retry.spec.ts (5 tests) 288ms', 'green'),
      ...(tick >= 4 ? [out(' ✓ tests/checkout/apple-pay.spec.ts (6 tests) 1.1s', 'green')] : []),
      ...(testsDone ? [out(''), out(' Test Files  3 passed (3)', 'green'), out('      Tests  20 passed (20)', 'green')] : []),
    ],
  }
  const finished: Command[] = [
    {
      id: 'wallets', description: 'Ask the dev server which wallets it offers', command: 'curl -s localhost:3000/api/wallets | jq', ended: 'done', time: '4 min',
      output: [out('['), out('  "apple_pay",', 'green'), out('  "card"', 'green'), out(']')],
    },
    { id: 'tsc', description: 'Type check', command: 'npx tsc --noEmit', ended: 'done', time: '6 min', output: [out('No errors.', 'dim')] },
    {
      id: 'tsc-failed', description: 'Type check', command: 'npx tsc --noEmit', ended: 2, time: 'Exit 2',
      output: [
        out("src/lib/payments/wallets.ts(41,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.", 'red'),
        out(''),
        out('Found 1 error in src/lib/payments/wallets.ts:41'),
      ],
    },
  ]
  return testsDone ? { running: [server], finished: [tests, ...finished] } : { running: [server, tests], finished }
}

// What Claude saved to its scratchpad, newest first.
const NOTES: { name: string; time: string; folder?: boolean; lines?: string[] }[] = [
  {
    name: 'plan.md', time: '3 min', lines: [
      '# Apple Pay at checkout',
      '',
      '1. Ask Stripe which wallets this device has',
      '2. Reuse the payment intent the card form creates',
      '3. Keep the card form as the fallback',
      '',
      '- [x] canPayWithWallet in wallets.ts',
      "- [x] payment_method_types gains 'apple_pay'",
      '- [ ] Domain association file under .well-known',
      '- [ ] Test on a device without a card in Wallet',
    ],
  },
  {
    name: 'before-review.md', time: '17 min', lines: [
      '# Check before review',
      '',
      '- The card form still shows with no wallet set up',
      '- The button waits for the payment intent',
      '- A retry after a timeout charges once (#479)',
      '- Dark mode: the button keeps its black style',
    ],
  },
  { name: 'stripe-responses', time: '24 min', folder: true },
]

function views(tick: number): Record<string, View> {
  const all: Record<string, View> = {}
  for (const [name, lines] of Object.entries(DIFFS)) all[name] = { title: name, chip: 'Changes', tone: 'accent', lines, numbered: true }
  const { running, finished } = commands(tick)
  for (const c of running) all[c.id] = { title: c.description, chip: 'Running', tone: 'green', lines: c.output }
  for (const c of finished) all[c.id] = { title: c.description, chip: c.ended === 'done' ? 'Done' : `Exit ${c.ended}`, tone: c.ended === 'done' ? 'neutral' : 'red', lines: c.output }
  for (const note of NOTES) if (note.lines) all[note.name] = { title: note.name, chip: 'Scratchpad', tone: 'neutral', lines: numbered(note.lines), numbered: true }
  return all
}

function duration(seconds: number) {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function useTick(ref: React.RefObject<Element | null>) {
  const inView = useInView(ref, { margin: '-15% 0px' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!inView) return
    const timer = setInterval(() => setTick(t => (t + 1) % TICKS), TICK_MS)
    return () => clearInterval(timer)
  }, [inView])
  return { tick, inView }
}

export function InfoStory() {
  const ref = useRef<HTMLElement>(null)
  const { tick, inView } = useTick(ref)
  const [active, setActive] = useState<Key>('claude')
  const [held, setHeld] = useState(false)
  const [view, setView] = useState<string | null>(null)

  // The tour moves on by itself until you pick a step; a while later it picks up again.
  useEffect(() => {
    if (!inView || held || view) return
    const timer = setTimeout(() => setActive(a => FEATURES[(FEATURES.findIndex(f => f[0] === a) + 1) % FEATURES.length][0]), STEP_MS)
    return () => clearTimeout(timer)
  }, [active, inView, held, view])
  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => setHeld(false), 14000)
    return () => clearTimeout(timer)
  }, [held, active])

  const pick = (key: Key) => {
    setActive(key)
    setHeld(true)
  }

  return (
    <section className="section" id="info" ref={ref}>
      <SectionHead eyebrow="Info panel" title={<>Everything about<br />one session.</>}>
        ⌃⌘I opens a panel beside the session you’re in: what Claude has done, what it’s running and
        where the branch stands, kept up to date as it works. Fold any card down to a line.
      </SectionHead>
      <div className="ip">
        <ol className="ip-tour">
          {FEATURES.map(([key, icon, title, text]) => (
            <li key={key} className={key === active ? 'on' : ''}>
              <button onClick={() => pick(key)}>
                <span className="info-point-icon">{icon}</span>
                <span className="ip-tour-text">
                  <b>{title}</b>
                  <span>{text}</span>
                </span>
              </button>
              {key === active && (
                <span className="ip-progress">
                  <motion.span
                    key={`${active}-${held}`}
                    initial={{ scaleX: held ? 1 : 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: held || !inView ? 0 : STEP_MS / 1000, ease: 'linear' }}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="ip-desc">{FEATURES.find(f => f[0] === active)![3]}</p>
        <Panel tick={tick} active={active} view={view} onView={setView} onPick={pick} />
      </div>
    </section>
  )
}

function Panel({ tick, active, view, onView, onPick }: {
  tick: number
  active: Key
  view: string | null
  onView: (key: string | null) => void
  onPick: (key: Key) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const cards = useRef<Partial<Record<Key, HTMLElement | null>>>({})
  const [offset, setOffset] = useState(0)
  const [folded, setFolded] = useState<ReadonlySet<Key>>(new Set())
  const [moreFiles, setMoreFiles] = useState(false)
  const [moreFinished, setMoreFinished] = useState(false)

  const context = CONTEXT.concat(Array.from({ length: tick }, (_, i) => 88 + (i + 1) * 0.5))
  const now = Math.round(context[context.length - 1])
  const rows = ROWS(tick)
  const added = rows.reduce((n, row) => n + (row.added ?? 0), 0)
  const removed = rows.reduce((n, row) => n + (row.removed ?? 0), 0)
  const committed = tick >= COMMITTED
  const checksDone = tick >= CHECKS_DONE
  const { running, finished } = commands(tick)
  const shown = views(tick)[view ?? '']
  const fileRows = moreFiles ? rows : rows.slice(0, 6)

  // Brings the picked card to the top of the panel, as far as the panel can scroll.
  useLayoutEffect(() => {
    const card = cards.current[active]
    if (!card || !viewport.current || !content.current) return
    const most = content.current.scrollHeight - viewport.current.clientHeight
    setOffset(Math.max(0, Math.min(card.offsetTop - 10, most)))
  }, [active, tick, folded, moreFiles, moreFinished])

  const fold = (key: Key) => {
    const next = new Set(folded)
    if (!next.delete(key)) next.add(key)
    setFolded(next)
    onPick(key)
  }

  const card = (id: Key) => ({ id, lit: id === active, isFolded: folded.has(id), onFold: () => fold(id), cardRef: (el: HTMLElement | null) => { cards.current[id] = el } })

  const commandRow = (c: Command) => (
    <div key={c.id} className="ip-command">
      <button className="ip-row file can" onClick={() => onView(c.id)}>
        {c.ended === undefined ? <i className="ip-live" /> : <i className={`ip-command-dot ${c.ended === 'done' ? '' : 'red'}`} />}
        <span className="ip-name">{c.description}<span> {c.command}</span></span>
        <span className={`ip-lines ip-time ${typeof c.ended === 'number' ? 'del' : ''}`}>{c.time}</span>
      </button>
      {c.port && <span className="ip-chip green">:{c.port}</span>}
    </div>
  )

  return (
    <div className="ip-panel" aria-label="The info panel for the Apple Pay session">
      <div className="ip-frame">
        {/* The name and the numbers stay put while the cards below move to the step on show. */}
        <div className="ip-head">
          <b>Apple Pay at checkout</b>
          <span className="ip-meta"><i className="ip-dot" />Checkout<b>Working</b></span>
          <span className="ip-path">~/Code/juniper/.claude/worktrees/apple-pay</span>
        </div>
        <div className="ip-stats">
          <div><span>Context</span><b><Ticker value={`${now}k`} /></b><small>tokens</small></div>
          <div className="wide"><span>Changes</span><b><em className="add"><Ticker value={`+${added}`} /></em> <em className="del">−{removed}</em></b><small>{rows.length} files</small></div>
          <div><span>Worked</span><b>12 min</b><small>4 turns</small></div>
        </div>

        <div className="ip-viewport" ref={viewport}>
          <motion.div className="ip-content" ref={content} animate={{ y: -offset }} transition={{ type: 'spring', stiffness: 120, damping: 22 }}>
            <Card {...card('claude')} title="Claude" icon={<Sparkles size={13} strokeWidth={2} />} tone="accent" detail={<span className="ip-chip accent">Opus 5.5</span>} summary={<>5 prompts <span className="ip-chip accent">Opus 5.5</span></>}>
              <p className="ip-note">5 prompts · started 41 min ago</p>
              <div className="ip-sub"><span>Context</span><b>{now}k <small>now</small></b></div>
              <Sparkline points={context} />
              <div className="ip-sub"><span>Turns</span><b>6m 26s <small>longest</small></b></div>
              <div className="ip-bars">
                {[48, 212, 95, 386].map((s, i) => <i key={i} className={i === 3 ? 'long' : ''} style={{ height: `${(s / 386) * 100}%` }} />)}
                <motion.i className="live" animate={{ height: `${Math.min(100, 8 + tick * 5)}%` }} transition={{ duration: 0.6 }} />
              </div>
              <p className="ip-more static">2 instruction files · 9 skills</p>
            </Card>

            <Card
              {...card('running')}
              title="Running"
              icon={<SquareTerminal size={13} strokeWidth={2} />}
              tone="green"
              detail={<span className="ip-chip green"><Ticker value={`${running.length} running`} /></span>}
              summary={`${running.length} running · :3000`}
            >
              <AnimatePresence initial={false}>
                {running.map(c => (
                  <motion.div key={c.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    {commandRow(c)}
                  </motion.div>
                ))}
              </AnimatePresence>
              {moreFinished && finished.map(commandRow)}
              <button className="ip-more" onClick={() => setMoreFinished(!moreFinished)}>
                {moreFinished ? 'Show less' : <><Ticker value={`${finished.length}`} /> finished</>}
              </button>
            </Card>

            <Card
              {...card('changes')}
              title="Changes"
              icon={<FileDiff size={13} strokeWidth={2} />}
              tone="orange"
              detail={`${rows.length} files`}
              summary={<><em className="add">+{added}</em> <em className="del">−{removed}</em> · {rows.length} files</>}
            >
              <div className="ip-ratio"><motion.i className="add" animate={{ flexGrow: added }} /><motion.i className="del" animate={{ flexGrow: removed }} /></div>
              <AnimatePresence initial={false}>
                {fileRows.map(row => (
                  <motion.button
                    key={row.name}
                    className={`ip-row file ${DIFFS[row.name] ? 'can' : ''}`}
                    onClick={() => DIFFS[row.name] && onView(row.name)}
                    initial={{ opacity: 0, height: 0, backgroundColor: 'rgba(48, 209, 88, 0.25)' }}
                    animate={{ opacity: 1, height: 'auto', backgroundColor: 'rgba(48, 209, 88, 0)' }}
                    transition={{ duration: 0.5, backgroundColor: { duration: 1.6 } }}
                  >
                    <span className={`ip-kind ${row.kind}`}>{row.kind}</span>
                    <span className="ip-name">{row.name}<span> {row.folder}</span></span>
                    {row.edited && <Sparkle className="ip-edited" size={11} strokeWidth={2.2} />}
                    <span className="ip-lines">
                      {row.added !== undefined && <em className="add"><Ticker value={`+${row.added}`} /></em>}
                      {row.removed !== undefined && <em className="del"> −{row.removed}</em>}
                    </span>
                  </motion.button>
                ))}
              </AnimatePresence>
              {rows.length > 7 && <button className="ip-more" onClick={() => setMoreFiles(!moreFiles)}>{moreFiles ? 'Show less' : `${rows.length - 6} more`}</button>}
            </Card>

            <Card
              {...card('branch')}
              title="Branch"
              icon={<GitBranch size={13} strokeWidth={2} />}
              tone="green"
              summary={`feat/apple-pay · ↑${committed ? 2 : 1} · ${checksDone ? 'PR Draft' : '1 check running'}`}
            >
              <div className="ip-chips">
                <span className="ip-chip strong">feat/apple-pay</span>
                <span className="ip-chip accent"><ArrowUp size={11} strokeWidth={2.6} /><Ticker value={committed ? '2' : '1'} /></span>
              </div>
              <div className="ip-row ip-pr">
                <GitPullRequest size={12} strokeWidth={2.2} />
                <span className="ip-name">Add Apple Pay to checkout<span> #482</span></span>
                <span className="ip-chip">Draft</span>
              </div>
              <div className="ip-chips">
                <AnimatePresence mode="popLayout" initial={false}>
                  {!checksDone && <motion.span key="run" className="ip-chip orange" exit={{ scale: 0.6, opacity: 0 }}><Clock3 size={11} strokeWidth={2.4} />1 running</motion.span>}
                  <motion.span key="passed" layout className="ip-chip green"><Check size={11} strokeWidth={3} /><Ticker value={checksDone ? '4' : '3'} /> passed</motion.span>
                </AnimatePresence>
              </div>
              <AnimatePresence initial={false}>
                {committed && <motion.div key="new" className="ip-commit fresh" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}><i />Accept Apple Pay in the payment intent<small>now</small></motion.div>}
              </AnimatePresence>
              <div className="ip-commit fresh"><i />Check for Apple Pay before showing the button<small>12 min</small></div>
              <div className="ip-commit"><i />Show delivery estimates in the cart<small>1 h</small></div>
            </Card>

            <Card
              {...card('scratchpad')}
              title="Scratchpad"
              icon={<NotebookPen size={13} strokeWidth={2} />}
              tone="neutral"
              detail={<span className="ip-chip"><FolderOpen size={11} strokeWidth={2.2} />Open</span>}
              summary={`${NOTES.length} files`}
            >
              {NOTES.map(note => (
                <button key={note.name} className={`ip-row file ${note.lines ? 'can' : ''}`} onClick={() => note.lines && onView(note.name)}>
                  {note.folder && <Folder className="ip-folder" size={11} strokeWidth={2.2} />}
                  <span className="ip-name">{note.name}</span>
                  <span className="ip-lines ip-time">{note.time}</span>
                </button>
              ))}
            </Card>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {shown && (
          <motion.div className="ip-diff" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ duration: 0.25, ease: EASE }}>
            <div className="ip-diff-head"><b>{shown.title}</b><span className={`ip-chip ${shown.tone}`}>{shown.chip}</span><button onClick={() => onView(null)} aria-label="Close"><X size={14} strokeWidth={2} /></button></div>
            <div className={`ip-diff-lines ${shown.numbered ? '' : 'output'}`}>
              {shown.lines.map((line, i) => (
                <div key={i} className={`ip-line ${line.mark === '+' ? 'add' : line.mark === '-' ? 'del' : ''}`}>
                  {shown.numbered && <><span>{line.n}</span><span>{line.mark}</span></>}
                  <code className={line.tone}>{line.text}</code>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="ip-hint">{HINTS[active]}</p>
    </div>
  )
}

/** A card whose title folds it, as the app's do; folded, `summary` stands in for what it hides. */
function Card({ lit, isFolded, onFold, cardRef, title, icon, tone, detail, summary, children }: {
  id: Key
  lit: boolean
  isFolded: boolean
  onFold: () => void
  cardRef: (el: HTMLElement | null) => void
  title: string
  icon: React.ReactNode
  tone: 'accent' | 'orange' | 'green' | 'neutral'
  detail?: React.ReactNode
  summary: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section ref={cardRef} className={`ip-card ${lit ? 'lit' : ''} ${isFolded ? 'folded' : ''}`}>
      <h3>
        <button className="ip-fold" aria-expanded={!isFolded} onClick={onFold}>
          <span className={`ip-icon ${tone}`}>{icon}</span>
          {title}
          <ChevronDown className="ip-chevron" size={12} strokeWidth={2.4} />
        </button>
        <span className="ip-detail">{isFolded ? summary : detail}</span>
      </h3>
      {!isFolded && children}
    </section>
  )
}

/** A value that rolls in from below when it changes, like the app's counters. */
function Ticker({ value }: { value: string }) {
  return (
    <span className="ticker">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value} initial={{ y: '70%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-70%', opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>{value}</motion.span>
      </AnimatePresence>
    </span>
  )
}

/** The context over the session's requests, its last point marked, as the panel draws it. */
function Sparkline({ points }: { points: number[] }) {
  const w = 300
  const h = 70
  const max = 100
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - (p / max) * h] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const last = xy[xy.length - 1]
  return (
    <svg className="ip-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} className="area" />
      <path d={line} className="line" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3.5" className="dot" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
