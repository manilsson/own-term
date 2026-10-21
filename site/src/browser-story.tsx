// The browser story: a session's pane rebuilt in HTML, where Claude drives the shop's checkout in a
// floating window, and the window answers your hands the way the app's does (src/BrowserView.tsx).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls, useInView, useMotionValue } from 'motion/react'
import { AppWindow, ExternalLink, GitBranch, Globe, KeyRound, Maximize2, Minimize2, X } from 'lucide-react'
import { EASE, Reveal, SectionHead } from './ui'

const POINTS: [React.ReactNode, string, string][] = [
  [<Globe />, 'One Chrome per session', 'Two sessions no longer fight over one browser. Each gets its own, started the first time Claude reaches for it.'],
  [<AppWindow />, 'Live over the terminal', 'A window you move, resize, fill the pane with or close. The terminal never shifts for it.'],
  [<KeyRound />, 'Signed in once', 'Sign in to your sites once, and every new session’s browser starts signed in.'],
  [<ExternalLink />, 'Out to Chrome and back', 'One click moves it to a real Chrome window, same profile, same page. The globe brings it back.'],
]

// One line per beat; the page, the cursor and the sheet follow the same beats.
const LINES: { kind: 'prompt' | 'tool' | 'say'; text: string; result?: string }[] = [
  { kind: 'prompt', text: 'Open the checkout and check that Apple Pay shows and opens its sheet.' },
  { kind: 'tool', text: 'chrome-devtools - navigate_page(url: "http://localhost:3000/checkout")', result: 'Opened Checkout · Juniper' },
  { kind: 'tool', text: 'chrome-devtools - take_snapshot()', result: 'Found the Apple Pay button' },
  { kind: 'tool', text: 'chrome-devtools - click(uid: "apple-pay")', result: 'Clicked Apple Pay' },
  { kind: 'tool', text: 'chrome-devtools - take_screenshot()', result: 'Saved a screenshot' },
  { kind: 'say', text: 'Apple Pay shows, and its sheet opens with the order total, 1 740 kr.' },
]
const BEATS = LINES.length + 2

type Place = 'float' | 'fill' | 'closed' | 'chrome'

/** Steps through the beats while on screen; the blank page before the first load is only a glimpse. */
function useBeat(ref: React.RefObject<Element | null>, paused: boolean) {
  const inView = useInView(ref, { amount: 0.15 })
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    if (!inView || paused) return
    const timer = setTimeout(() => setBeat(b => (b + 1) % BEATS), beat === 0 ? 600 : 1700)
    return () => clearTimeout(timer)
  }, [inView, paused, beat])
  return beat
}

export function BrowserStory() {
  const ref = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const payButton = useRef<HTMLButtonElement>(null)
  // Hands on the window hold Claude off for a moment, so its cursor doesn't fight yours.
  const [handsOn, setHandsOn] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!handsOn) return
    setHeld(true)
    const timer = setTimeout(() => setHeld(false), 5000)
    return () => clearTimeout(timer)
  }, [handsOn])
  const beat = useBeat(ref, held)
  const [place, setPlace] = useState<Place>('float')
  const [paid, setPaid] = useState(false)
  const [target, setTarget] = useState({ left: '30%', top: '42%' })
  const drag = useDragControls()
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const loaded = beat >= 1
  const cursor = beat >= 2 && beat <= 4
  const clicked = beat >= 3 && beat <= 4
  const sheet = (beat >= 3 && beat <= 5) || paid
  const shown = Math.min(beat + 1, LINES.length)
  const open = place === 'float' || place === 'fill'

  useEffect(() => {
    if (beat === 0) setPaid(false)
  }, [beat])

  // Where the Pay button sits, as shares of the page, for Claude's cursor to land on; measured each beat,
  // since the page fades in after the beat that loads it.
  useLayoutEffect(() => {
    const button = payButton.current?.getBoundingClientRect()
    const box = page.current?.getBoundingClientRect()
    if (!button || !box || !box.width) return
    setTarget({
      left: `${((button.left + button.width * 0.56 - box.left) / box.width) * 100}%`,
      top: `${((button.top + button.height * 0.62 - box.top) / box.height) * 100}%`,
    })
  }, [beat, place])

  // A drag leaves its offset in x and y, which would carry over into the filled window.
  const toggleFill = () => {
    x.jump(0)
    y.jump(0)
    setPlace(p => (p === 'fill' ? 'float' : 'fill'))
  }
  const reopen = () => {
    x.set(0)
    y.set(0)
    setPlace('float')
  }

  return (
    <section className="browser-band dark" id="browser" ref={ref}>
      <div className="browser-glow" aria-hidden="true" />
      <SectionHead eyebrow="Browser" title={<>Claude gets a browser.<br />You get to watch.</>}>
        With Chrome DevTools MCP set up in Claude Code, each session’s Claude drives a Chrome of its own,
        shown live in the session’s pane. Click, scroll and type in it when you want to, or let it work.
      </SectionHead>
      <Reveal>
        <div
          className="bd-pane"
          onPointerDown={() => setHandsOn(n => n + 1)}
        >
          <div className="bd-head">
            <span className="bd-dot" />
            <b>Apple Pay at checkout</b>
            <span className="bd-branch"><GitBranch size={12} strokeWidth={1.8} />feat/apple-pay</span>
            <button
              className={`bd-globe ${open ? 'on' : ''} ${place === 'closed' || place === 'chrome' ? 'calling' : ''}`}
              title={open ? 'Hide Browser' : 'Show Browser in Own Term'}
              onClick={() => (open ? setPlace('closed') : reopen())}
            >
              <Globe size={15} strokeWidth={1.8} />
            </button>
            <span className="bd-pill"><span className="spinner" />Working</span>
          </div>
          <div className="bd-body" ref={body}>
            <div className="bd-terminal">
              <AnimatePresence initial={false}>
                {LINES.slice(0, shown).map(line => (
                  <motion.div key={line.text} className={`transcript-line ${line.kind}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                    {line.kind === 'prompt' && <><span className="transcript-mark">❯</span>{line.text}</>}
                    {line.kind === 'tool' && <><span className="transcript-mark green">⏺</span><span className="transcript-call">{line.text}</span><span className="transcript-result">⎿ {line.result}</span></>}
                    {line.kind === 'say' && <><span className="transcript-mark">⏺</span>{line.text}</>}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div className="transcript-input">❯<i /></div>
            </div>

            <AnimatePresence custom={place}>
              {open && (
                <motion.div
                  key="window"
                  className={`bd-window ${place === 'fill' ? 'filled' : ''}`}
                  layout
                  style={{ x, y }}
                  drag={place === 'float'}
                  dragControls={drag}
                  dragListener={false}
                  dragMomentum={false}
                  dragConstraints={body}
                  dragElastic={0.06}
                  custom={place}
                  variants={{
                    gone: (to: Place) => (to === 'chrome'
                      ? { opacity: 0, scale: 0.55, x: 160, y: -140, transition: { duration: 0.45, ease: EASE } }
                      : { opacity: 0, scale: 0.92, transition: { duration: 0.2 } }),
                  }}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit="gone"
                  transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                >
                  <div className="bd-bar" onPointerDown={e => place === 'float' && drag.start(e)} onDoubleClick={toggleFill}>
                    <Globe size={12} strokeWidth={1.8} />
                    <span className="bd-title">{loaded ? 'Checkout · Juniper' : 'New page'}</span>
                    <span className="bd-url">{loaded ? 'http://localhost:3000/checkout' : ''}</span>
                    <span className="bd-actions" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                      <button title="Open in a Chrome Window" onClick={() => setPlace('chrome')}><AppWindow size={13} strokeWidth={1.8} /></button>
                      <button title={place === 'fill' ? 'Restore' : 'Fill the Pane'} onClick={toggleFill}>
                        {place === 'fill' ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
                      </button>
                      <button title="Close (the globe in the pane’s header opens it again)" onClick={() => setPlace('closed')}><X size={13} strokeWidth={2} /></button>
                    </span>
                  </div>
                  <div className="bd-page" ref={page}>
                    <ShopPage loaded={loaded} payButton={payButton} pressed={clicked || paid} onPay={() => setPaid(true)} />
                    <AnimatePresence>
                      {sheet && (
                        <motion.div className="bd-sheet" initial={{ y: '105%' }} animate={{ y: 0 }} exit={{ y: '105%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
                          <div className="bd-sheet-row"><b>Pay Juniper</b><span onClick={() => setPaid(false)}>Cancel</span></div>
                          <div className="bd-sheet-row"><span>Card</span><b>Wallet card ···· 4242</b></div>
                          <div className="bd-sheet-row"><span>Ship to</span><b>Stockholm</b></div>
                          <div className="bd-sheet-total"><span>Total</span><b>1 740 kr</b></div>
                          <div className="bd-sheet-confirm">Confirm with Touch ID</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {cursor && (
                        <motion.div
                          className="bd-cursor"
                          initial={{ opacity: 0, left: '78%', top: '84%' }}
                          animate={{ opacity: 1, left: beat >= 3 ? target.left : '58%', top: beat >= 3 ? target.top : '64%' }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.7, ease: EASE }}
                        >
                          {beat === 3 && <motion.i className="bd-ripple" initial={{ scale: 0, opacity: 0.7 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 0.6, delay: 0.55 }} />}
                          <svg viewBox="0 0 16 20" aria-hidden="true"><path d="M1 1v15l4-4 3 7 2.6-1.1-3-6.9H13z" /></svg>
                          <span>Claude</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {beat === 4 && <motion.div key="flash" className="bd-flash" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, delay: 0.3 }} />}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {!open && (
                <motion.div key={place} className="bd-toast" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} transition={{ duration: 0.3, ease: EASE }}>
                  {place === 'chrome'
                    ? <>Moved to a Chrome window, same profile, same page.</>
                    : <>Closed. Claude’s Chrome keeps running.</>}
                  <button onClick={reopen}>Bring it back</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
      <p className="bd-hint">Try it: drag the window by its bar, double-click the bar to fill the pane, click Pay yourself, or send it out to Chrome.</p>
      <div className="info-points">
        {POINTS.map(([icon, title, text], i) => (
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

/** The shop's checkout, as the demo day serves it (electron/demo/checkout.html), drawn small. */
function ShopPage({ loaded, payButton, pressed, onPay }: { loaded: boolean; payButton: React.RefObject<HTMLButtonElement | null>; pressed: boolean; onPay: () => void }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {loaded ? (
        <motion.div key="shop" className="shop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <header><b>Juniper</b><nav><span>Bag</span><span>Delivery</span><b>Payment</b></nav></header>
          <div className="shop-main">
            <section>
              <h3>Payment</h3>
              <p>Delivery to Stockholm by Thursday.</p>
              <button ref={payButton} className={`shop-applepay ${pressed ? 'pressed' : ''}`} onClick={onPay}>Apple Pay</button>
              <div className="shop-or">or pay with card</div>
              <label>Card number<i>1234 5678 9012 3456</i></label>
              <div className="shop-row"><label>Expiry<i>MM / YY</i></label><label>Security code<i>CVC</i></label></div>
              <span className="shop-pay">Pay 1 740 kr</span>
            </section>
            <aside>
              <h4>Your order</h4>
              {[['#8fa98a', 'Linen shirt, sage', '690 kr'], ['#c9b79c', 'Wool beanie, oat', '350 kr'], ['#4a5568', 'Canvas tote, navy', '620 kr']].map(([color, name, price]) => (
                <div className="shop-item" key={name}><span style={{ background: color }} /><b>{name}</b>{price}</div>
              ))}
              <div className="shop-total"><span>Total</span><b>1 740 kr</b></div>
            </aside>
          </div>
        </motion.div>
      ) : (
        <motion.div key="blank" className="shop-blank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      )}
    </AnimatePresence>
  )
}
