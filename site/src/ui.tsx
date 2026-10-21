import { useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { motion, useInView, type Variants } from 'motion/react'

export const EASE = [0.2, 0.8, 0.2, 1] as const

/** Advances through `count` steps while `ref` is on screen, looping: every `ms`, or after `ms(step)`. */
export function useLoop(ref: RefObject<Element | null>, count: number, ms: number | ((step: number) => number)) {
  const inView = useInView(ref, { margin: '-20% 0px' })
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!inView) return
    const timer = setTimeout(() => setStep(s => (s + 1) % count), typeof ms === 'number' ? ms : ms(step))
    return () => clearTimeout(timer)
  }, [inView, count, ms, step])
  return step
}

/** The newest release's disk image; GitHub redirects this name to it. */
export const DOWNLOAD = 'https://github.com/manilsson/own-term-releases/releases/latest/download/Own-Term.dmg'

/** The newest release's version, once GitHub has said; the page reads fine without it. */
export function useLatestVersion() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    fetch('https://api.github.com/repos/manilsson/own-term-releases/releases/latest')
      .then(r => (r.ok ? r.json() : null))
      .then(release => release?.tag_name && setVersion(String(release.tag_name).replace(/^v/, '')))
      .catch(() => {})
  }, [])
  return version
}

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  shown: (delay: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE, delay } }),
}

/** Fades its content up into place the first time it scrolls into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} variants={rise} custom={delay} initial="hidden" whileInView="shown" viewport={{ once: true, margin: '-12% 0px' }}>
      {children}
    </motion.div>
  )
}

/** A section's eyebrow, headline and lede, centered the way Apple's product pages set them. */
export function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-head">
      <Reveal><p className="eyebrow">{eyebrow}</p></Reveal>
      <Reveal delay={0.06}><h2 className="title">{title}</h2></Reveal>
      {children && <Reveal delay={0.12}><p className="lede">{children}</p></Reveal>}
    </div>
  )
}

const THEME_KEY = 'own-term.theme'
const systemDark = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

/** The appearance the switch picked, or none to follow the system. index.html applies it before the page draws. */
function chosenTheme(): 'light' | 'dark' | null {
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'dark' ? theme : null
}

const isDark = () => (chosenTheme() ?? (systemDark.matches ? 'dark' : 'light')) === 'dark'

systemDark.addEventListener('change', () => listeners.forEach(l => l()))

/** Whether the page is dark, and a switch to the other appearance, which is remembered. */
export function useTheme() {
  const dark = useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, isDark)
  const toggle = () => {
    const next = isDark() ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    listeners.forEach(l => l())
  }
  return { dark, toggle }
}

/** A screenshot of the app, light or dark with the page: `shots/<name>-light.webp` and `-dark.webp`. */
export function Screenshot({ name, alt }: { name: string; alt: string }) {
  const { dark } = useTheme()
  return (
    <img src={`shots/${name}-${dark ? 'dark' : 'light'}.webp`} alt={alt} width={2880} height={1800} loading="lazy" decoding="async" draggable={false} />
  )
}

/** A screenshot of the app, framed like a window floating over the page. */
export function Shot({ name, alt, className = '' }: { name: string; alt: string; className?: string }) {
  return (
    <div className={`shot ${className}`}>
      <Screenshot name={name} alt={alt} />
    </div>
  )
}

export function Keycap({ children, wide, pressed }: { children: ReactNode; wide?: boolean; pressed?: boolean }) {
  return (
    <motion.kbd
      className={`keycap ${wide ? 'wide' : ''}`}
      animate={pressed ? { y: [0, 3, 0], boxShadow: ['0 4px 0 var(--key-edge)', '0 1px 0 var(--key-edge)', '0 4px 0 var(--key-edge)'] } : undefined}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      whileHover={{ y: 2 }}
    >
      {children}
    </motion.kbd>
  )
}
