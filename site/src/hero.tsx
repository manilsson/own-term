import { Fragment, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationFrame, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { ChevronRight, Download, Moon, Sun } from 'lucide-react'
import { StatusGlyph, STATUS_LABEL, type Status } from './mock'
import { DOWNLOAD, EASE, useLatestVersion, useTheme } from './ui'

// Label, target, and the line under it in the narrow screen's menu.
const LINKS = [
  ['Highlights', '#highlights', 'The tour in pictures'],
  ['Status', '#status', 'See which session needs you'],
  ['Groups', '#groups', 'Sessions side by side, by the work'],
  ['Tools', '#tools', 'Claude keeps the sidebar tidy'],
  ['Monitors', '#monitors', 'Pages that keep watch for you'],
  ['Browser', '#browser', 'Claude drives Chrome in a pane'],
  ['Shortcuts', '#shortcuts', 'Everything from the keyboard'],
  ['What’s new', 'releases.html', 'Every release, newest first'],
]

/** A translucent bar that gains its hairline and blur once the page has scrolled. */
export function Nav({ home = '' }: { home?: string }) {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  const [overDark, setOverDark] = useState(false)
  // Goes dark while a dark band is under it, as Apple's bar does.
  const checkDark = () => setOverDark([...document.querySelectorAll('.dark')].some(band => {
    const box = band.getBoundingClientRect()
    return box.top < 56 && box.bottom > 0
  }))
  useEffect(checkDark, [])
  useMotionValueEvent(scrollY, 'change', y => {
    setScrolled(y > 24)
    checkDark()
  })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const wide = matchMedia('(min-width: 1101px)')
    const shut = () => wide.matches && setOpen(false)
    document.documentElement.classList.add('menu-open')
    addEventListener('keydown', close)
    wide.addEventListener('change', shut)
    return () => {
      document.documentElement.classList.remove('menu-open')
      removeEventListener('keydown', close)
      wide.removeEventListener('change', shut)
    }
  }, [open])
  return (
    <motion.nav
      className={open ? 'nav open' : `nav ${scrolled ? 'scrolled' : ''} ${overDark ? 'over-dark' : ''}`}
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
    >
      <a className="nav-brand" href={`${home}#top`}>
        <img src="icon.png" alt="" width={26} height={26} />
        Own Term
      </a>
      <div className="nav-links">
        {LINKS.map(([label, href]) => <a key={href} href={href.startsWith('#') ? home + href : href} aria-current={href === 'releases.html' && home ? 'page' : undefined}>{label}</a>)}
      </div>
      <ThemeSwitch />
      <a className="nav-pill" href={DOWNLOAD}>Download</a>
      <button className={`menu-button ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="menu" aria-label={open ? 'Close menu' : 'Open menu'}>
        <span />
        <span />
      </button>
      <AnimatePresence>
        {open && <Menu home={home} close={() => setOpen(false)} />}
      </AnimatePresence>
    </motion.nav>
  )
}

const ITEM_IN = (i: number) => ({ type: 'spring' as const, stiffness: 380, damping: 30, delay: 0.06 + i * 0.035 })

/** The narrow screen's menu: the hero's light behind a list of the page's stories, and a way to get it. */
function Menu({ home, close }: { home: string; close: () => void }) {
  const version = useLatestVersion()
  return (
    <motion.div
      id="menu"
      className="menu"
      initial={{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
      animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
      exit={{ opacity: 0, clipPath: 'inset(0 0 100% 0)', transition: { duration: 0.3, ease: EASE } }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <motion.div className="menu-glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }} />
      <nav className="menu-list">
        {LINKS.map(([label, href, blurb], i) => (
          <motion.a
            key={href}
            href={href.startsWith('#') ? home + href : href}
            aria-current={href === 'releases.html' && home ? 'page' : undefined}
            onClick={close}
            initial={{ opacity: 0, x: -24, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transition: ITEM_IN(i) }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            whileTap={{ scale: 0.97 }}
          >
            <span className="menu-text">
              <b>{label}</b>
              <small>{blurb}</small>
            </span>
            <ChevronRight className="menu-chevron" size={18} strokeWidth={2} />
          </motion.a>
        ))}
      </nav>
      <motion.a
        className="menu-download"
        href={DOWNLOAD}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0, transition: ITEM_IN(LINKS.length + 1) }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        whileTap={{ scale: 0.98 }}
      >
        <img src="icon.png" alt="" width={44} height={44} />
        <span className="menu-text">
          <b>Own Term for Mac</b>
          <small>Free{version && ` · Version ${version}`}</small>
        </span>
        <span className="menu-get"><Download size={16} strokeWidth={2.2} /></span>
      </motion.a>
    </motion.div>
  )
}

/** Light or dark: shows the appearance a click switches to. */
function ThemeSwitch() {
  const { dark, toggle } = useTheme()
  return (
    <button className="theme-switch" onClick={toggle} title={dark ? 'Light appearance' : 'Dark appearance'} aria-label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'}>
      {dark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
    </button>
  )
}

// The hero: the icon's mark draws itself, then the sessions open out round it and orbit, one at a
// time asking for you. The page's one promise, acted out.

const rise = {
  hidden: { opacity: 0, y: 18, filter: 'blur(10px)' },
  shown: (i: number) => ({ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: EASE, delay: 0.08 + i * 0.07 } }),
}

const ORBIT = ['Apple Pay', 'Load test', 'Refunds', 'Offline cart', 'Docs', 'Crash fix', 'Push opt-in', 'Receipts']
// When the mark has drawn and the cursor has landed (see Mark), in ms.
const REVEALED = 1900

/** Steps through `count` beats every `ms` from `after` ms on, looping; -1 before that. */
function useBeat(count: number, ms: number, after: number) {
  const [beat, setBeat] = useState(-1)
  useEffect(() => {
    let timer = 0
    const start = window.setTimeout(() => {
      setBeat(0)
      timer = window.setInterval(() => setBeat(b => (b + 1) % count), ms)
    }, after)
    return () => {
      clearTimeout(start)
      clearInterval(timer)
    }
  }, [count, ms, after])
  return beat
}

const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3

/**
 * Session pills on a tilted ellipse round the mark: they open out from it once it has drawn. They're
 * moved each frame through their styles, so React only redraws them when a status changes.
 */
function Orbit({ beat, count }: { beat: number; count: number }) {
  const pills = useRef<(HTMLDivElement | null)[]>([])
  // The orbit's half-width: wide on a desktop, inside the card's edges on a phone.
  const radius = useRef(0)
  useEffect(() => {
    const stage = pills.current[0]?.parentElement
    if (!stage) return
    const measure = () => (radius.current = Math.min(Math.min(innerWidth, innerHeight) * 0.4, stage.clientWidth / 2 - 80))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  // With Reduce Motion the sessions hold still where they opened out to.
  const still = useReducedMotion()
  useAnimationFrame(time => {
    const open = easeOut((time - REVEALED) / 1200)
    const angle = still ? 0.3 : time / 14000
    pills.current.forEach((pill, i) => {
      if (!pill) return
      const a = angle + (i / count) * Math.PI * 2
      const depth = (Math.sin(a) + 1) / 2
      const scale = (0.72 + depth * 0.36) * (0.6 + 0.4 * open)
      pill.style.transform = `translate(-50%, -50%) translate(${Math.cos(a) * radius.current * open}px, ${Math.sin(a) * radius.current * (count < ORBIT.length ? 0.5 : 0.28) * open}px) scale(${scale})`
      pill.style.opacity = String((0.3 + depth * 0.7) * open)
      // Behind the mark on the far side of the orbit, in front of it on the near side.
      pill.style.zIndex = depth > 0.5 ? '3' : '1'
    })
  })
  return (
    <>
      {ORBIT.slice(0, count).map((name, i) => {
        const status: Status = beat === i * 2 ? 'input' : beat === i * 2 + 1 ? 'done' : 'working'
        return (
          <div key={name} ref={el => { pills.current[i] = el }} className={`orbit-pill ${status}`} style={{ opacity: 0 }}>
            <StatusGlyph status={status} />{name}{status !== 'working' && <em>{STATUS_LABEL[status]}</em>}
          </div>
        )
      })}
    </>
  )
}

/** The icon's mark in ink: the ring draws itself, the cursor lands and blinks like a terminal's. */
function Mark({ ping }: { ping: number }) {
  const arc = 'M 608.1 783.5 A 288 288 0 1 1 798.1 479.4'
  return (
    <div className="mark">
      {/* An amber ripple each time a session starts waiting on you. */}
      <AnimatePresence>
        {ping >= 0 && (
          <motion.span
            key={ping}
            className="mark-ping"
            initial={{ scale: 0.55, opacity: 0.55 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 2.2, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <svg viewBox="0 0 1024 1024" aria-hidden="true">
        <defs>
          <linearGradient id="mark-ring" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--mark-top)' }} />
            <stop offset="1" style={{ stopColor: 'var(--mark-bottom)' }} />
          </linearGradient>
          <linearGradient id="mark-cursor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffc35c" />
            <stop offset="1" stopColor="#ffa424" />
          </linearGradient>
          <filter id="mark-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="34" /></filter>
          <filter id="mark-shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26" /></filter>
        </defs>
        {[470, 400].map((r, i) => (
          <circle key={r} cx="512" cy="512" r={r} fill="none" stroke="currentColor" strokeOpacity={0.05 + i * 0.03} strokeWidth="2" />
        ))}
        <motion.path d={arc} fill="none" style={{ stroke: 'var(--mark-shadow)' }} strokeWidth="96" strokeLinecap="round" filter="url(#mark-shadow)"
          transform="translate(0 34)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
        <motion.path d={arc} fill="none" stroke="url(#mark-ring)" strokeWidth="96" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
        <motion.g initial={{ opacity: 0, y: -60 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.45, type: 'spring', stiffness: 320, damping: 15 }}>
          {/* The glow stays lit and only the cursor blinks, so the blur is drawn once. */}
          <rect x="692.2" y="562.6" width="128" height="204" rx="30.7" fill="#ffa424" opacity=".4" filter="url(#mark-glow)" />
          <motion.rect x="692.2" y="562.6" width="128" height="204" rx="30.7" fill="url(#mark-cursor)"
            animate={{ opacity: [1, 1, 0.15, 0.15] }} transition={{ duration: 1.1, repeat: Infinity, times: [0, 0.55, 0.56, 1], delay: 2.4 }} />
        </motion.g>
      </svg>
    </div>
  )
}

/** The headline, word by word out of a blur; the second line in a quieter tone. */
function Headline() {
  const lines = [['Run', 'them', 'all.'], ['Miss', 'nothing.']]
  let i = 0
  return (
    <h1 className="hero-title">
      {lines.map((words, l) => (
        <span key={l} className="hero-line">
          {/* Real spaces between the words, so the headline copies and reads as a sentence. */}
          {words.map((w, k) => (
            <Fragment key={w}>
              {k > 0 && ' '}
              <motion.span className="hero-word" custom={i++} variants={rise} initial="hidden" animate="shown">{w}</motion.span>
            </Fragment>
          ))}
        </span>
      ))}
    </h1>
  )
}

/** How many sessions orbit: all of them on a desktop, five on a phone, where eight would pile up. */
function useOrbitCount() {
  const narrow = () => matchMedia('(max-width: 600px)').matches
  const [count, setCount] = useState(() => (narrow() ? 5 : ORBIT.length))
  useEffect(() => {
    const update = () => setCount(narrow() ? 5 : ORBIT.length)
    addEventListener('resize', update)
    return () => removeEventListener('resize', update)
  }, [])
  return count
}

export function Hero() {
  const count = useOrbitCount()
  // Statuses start changing once the sessions have opened out.
  const beat = useBeat(count * 2, 1500, REVEALED + 1400)
  // Each session starting to wait sends one ripple.
  const ping = beat >= 0 ? Math.floor(beat / 2) : -1
  const version = useLatestVersion()
  return (
    <header className="hero" id="top">
      <div className="hero-card">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-stage">
          <Mark ping={ping} />
          <Orbit beat={beat} count={count} />
        </div>
        <div className="hero-bottom">
          <Headline />
          <div className="hero-side">
            <motion.p className="hero-lede" custom={6} variants={rise} initial="hidden" animate="shown">
              A Mac terminal for running many Claude Code sessions at once. Grouped, side by side, and
              quiet until one is waiting on you.
            </motion.p>
            <motion.div className="hero-actions" custom={7} variants={rise} initial="hidden" animate="shown">
              <a className="button primary" href={DOWNLOAD}><Download size={17} strokeWidth={2.2} /> Download for Mac</a>
              <a className="text-link" href="#highlights">See how it works ›</a>
            </motion.div>
            <motion.p className="hero-note" custom={8} variants={rise} initial="hidden" animate="shown">
              Free{version && <> · <a href="releases.html">Version {version}</a></>} · macOS 13 or later, Apple silicon
            </motion.p>
          </div>
        </div>
      </div>
    </header>
  )
}
