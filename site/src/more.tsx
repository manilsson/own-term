import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { AlarmClock, ArrowDownToLine, Columns3, Command, Download, FileCode2, GitBranch, History, Search, Shapes, Sparkle, Undo2, UnfoldVertical } from 'lucide-react'
import { DOWNLOAD, Keycap, Reveal, SectionHead, useLatestVersion, useTheme } from './ui'
import { FeatureArt, RingArt } from './art'

// Each theme's screenshot, and its swatch: the pane color and the accent, light then dark (src/themes.ts).
const THEMES: [string, string, [string, string], [string, string]][] = [
  ['checkout', 'Default', ['#ffffff', '#0a84ff'], ['#10131a', '#0a84ff']],
  ['theme-nord', 'Nord', ['#eceff4', '#5e81ac'], ['#2e3440', '#88c0d0']],
  ['theme-solarized', 'Solarized', ['#fdf6e3', '#268bd2'], ['#002b36', '#268bd2']],
  ['theme-catppuccin', 'Catppuccin', ['#eff1f5', '#8839ef'], ['#1e1e2e', '#cba6f7']],
  ['theme-dracula', 'Dracula', ['#fffbeb', '#644ac9'], ['#282a36', '#bd93f9']],
  ['theme-gruvbox', 'Gruvbox', ['#fbf1c7', '#076678'], ['#282828', '#83a598']],
  ['theme-tokyo-night', 'Tokyo Night', ['#e1e2e7', '#2e7de9'], ['#1a1b26', '#7aa2f7']],
  ['theme-night-owl', 'Night Owl', ['#fbfbfb', '#288ed7'], ['#011627', '#82aaff']],
  ['theme-rose-pine', 'Rosé Pine', ['#faf4ed', '#907aa9'], ['#191724', '#c4a7e7']],
  ['theme-everforest', 'Everforest', ['#fdf6e3', '#8da101'], ['#2d353b', '#a7c080']],
  ['theme-flexoki', 'Flexoki', ['#fffcf0', '#24837b'], ['#1c1b1a', '#3aa99f']],
  ['theme-indigo', 'Indigo', ['#ffffff', '#5e6ad2'], ['#131416', '#5e6ad2']],
]

/** The app in each theme, light or dark with the page until the switch picks one. It steps through them until one is picked. */
export function ThemesStory() {
  const { dark: pageDark } = useTheme()
  const [appearance, setAppearance] = useState<'light' | 'dark' | null>(null)
  const dark = appearance ? appearance === 'dark' : pageDark
  const stage = useRef<HTMLDivElement>(null)
  const inView = useInView(stage, { margin: '-20% 0px' })
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(false)
  useEffect(() => {
    if (!inView || picked) return
    const timer = setInterval(() => setIndex(i => (i + 1) % THEMES.length), 2600)
    return () => clearInterval(timer)
  }, [inView, picked])
  const [shot, name] = THEMES[index]
  const mode = dark ? 'dark' : 'light'

  return (
    <section className="section" id="themes">
      <SectionHead eyebrow="Themes" title={<>Your colors,<br />light and dark.</>}>
        Own Term follows System Settings and takes your accent color. Twelve themes, from Nord and
        Solarized to Rosé Pine and Flexoki, each have a light side and a dark side, and recolor the
        sidebar, the panes and the terminal.
      </SectionHead>
      <Reveal>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {THEMES.map(([id, label, light, night], i) => {
            const [pane, accent] = dark ? night : light
            return (
              <button
                key={id}
                role="radio"
                aria-checked={i === index}
                className={i === index ? 'on' : ''}
                onClick={() => {
                  setPicked(true)
                  setIndex(i)
                }}
              >
                {i === index && <motion.span layoutId="theme-chip" className="theme-chip-fill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${pane} 50%, ${accent} 50%)` }} />
                <span className="theme-name">{label}</span>
              </button>
            )
          })}
        </div>
      </Reveal>
      <Reveal delay={0.04}>
        <div className="appearance-switch" role="radiogroup" aria-label="Appearance">
          {(['light', 'dark'] as const).map(mode => (
            <button key={mode} role="radio" aria-checked={dark === (mode === 'dark')} className={dark === (mode === 'dark') ? 'on' : ''} onClick={() => setAppearance(mode)}>
              {mode === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="theme-stage shot" ref={stage}>
          <AnimatePresence initial={false}>
            <motion.img
              key={`${shot}-${mode}`}
              src={`shots/${shot}-${mode}.webp`}
              alt={`Own Term in the ${name} theme`}
              draggable={false}
              // The new shot fades in over the old one, which goes once it's covered.
              initial={{ opacity: 0, zIndex: 1 }}
              animate={{ opacity: 1, zIndex: 1 }}
              exit={{ opacity: 0, zIndex: 0, transition: { delay: 0.35, duration: 0 } }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
          </AnimatePresence>
        </div>
      </Reveal>
    </section>
  )
}

const FEATURES: [ReactNode, string, string, () => ReactNode, string?][] = [
  [<History />, 'Picks up where you left off.', 'After a restart or an update, every session reopens in its folder, Claude continues the same conversation, and what finished still waits in Needs You.', FeatureArt.restart, 'wide'],
  [<GitBranch />, 'A worktree per session.', 'Start a session on its own branch in its own worktree. Every row shows the branch and how many lines changed.', FeatureArt.worktree],
  [<ArrowDownToLine />, 'Reads from the bottom up.', 'Output grows up from the prompt, and a line separates each command, red when it failed.', FeatureArt.bottomUp],
  [<Sparkle />, 'Names itself. Files itself.', 'Claude names a session from your first prompt and puts it in the group doing the same work. Changed your mind? Undo is one click.', FeatureArt.organize, 'wide'],
  [<Search />, 'Find in the scrollback.', '⌘F highlights every match in the pane, and ↩ steps through them.', FeatureArt.find],
  [<FileCode2 />, 'Paths you can click.', 'file.ts:12 in any output opens at that line in your editor: Cursor, VS Code, Zed, Xcode, Rider and more.', FeatureArt.paths],
  [<Command />, 'Go anywhere with ⌘P.', 'Type a few letters to jump to any session or group, or to run any command.', FeatureArt.palette],
  [<Columns3 />, 'Panes that behave.', 'Drag a session onto a pane’s edge to split, double-click a gap to make them equal, ⌘↩ to zoom one. The pane you’re typing in is ringed.', FeatureArt.panes, 'wide'],
  [<UnfoldVertical />, 'Every turn, marked.', 'Beside the scrollbar, a tick for each prompt you sent, each question Claude asked and each turn it finished. Click one to scroll there.', FeatureArt.marks],
  [<AlarmClock />, 'Remind me later.', 'Put a time and a note on a session, or a time on a to-do. When it comes, the session joins Needs You, and the reminder waits on the Reminders page until you’re done with it.', FeatureArt.remind],
  [<Undo2 />, 'Take it back.', '⌘Z undoes the last change, yours or Claude’s: a move, a rename, an ended session. ⇧⌘T reopens the last session you closed, its conversation resumed.', FeatureArt.undo, 'wide'],
  [<Shapes />, 'Known at a glance.', 'Claude gives a session an icon when it starts one, or when you ask: a card for payments, a bug for a bug. It shows before the name in the sidebar and the pane header.', FeatureArt.icons, 'full'],
]

export function Features() {
  return (
    <section className="section" id="features">
      <SectionHead eyebrow="And more" title="Small things, done right." />
      <div className="bento">
        {FEATURES.map(([icon, title, text, Art, size], i) => (
          <Reveal key={title} delay={(i % 3) * 0.06} className={`bento-card ${size ?? ''}`}>
            <motion.div className="bento-inner" whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
              <span className="bento-icon">{icon}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <div className="bento-art"><Art /></div>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

const SHORTCUTS: [string[], string][] = [
  [['⌘', 'P'], 'Command palette'],
  [['⌘', 'T'], 'New session'],
  [['⌘', 'D'], 'Another session beside this one'],
  [['⌘', 'J'], 'Next session that needs you'],
  [['⇧', '⌘', 'G'], 'Open the latest notification'],
  [['⌘', 'F'], 'Find in the pane'],
  [['⌘', '↩'], 'Zoom the pane'],
  [['⌃', '⌘', 'S'], 'Hide the sidebar'],
  [['⌃', '⌘', 'I'], 'Show the info panel'],
  [['⌘', '1'], 'Go to a session by number'],
  [['⌘', 'Z'], 'Undo the last change'],
  [['⇧', '⌘', 'T'], 'Reopen a closed session'],
  [['⌃', '⌘', 'T'], 'Today'],
  [['⌘', 'K'], 'Clear the pane'],
  [['⌘', 'W'], 'Close the pane'],
  [['⇧', '↩'], 'New line in a Claude prompt'],
]

export function Shortcuts() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px' })
  const [lit, setLit] = useState(-1)
  useEffect(() => {
    if (!inView) return
    const timer = setInterval(() => setLit(i => (i + 1) % SHORTCUTS.length), 900)
    return () => clearInterval(timer)
  }, [inView])
  return (
    <section className="section" id="shortcuts">
      <SectionHead eyebrow="Keyboard" title={<>Built for the keyboard.</>}>
        Every command has a shortcut, and the palette shows each one next to its command.
      </SectionHead>
      <div className="shortcuts" ref={ref}>
        {SHORTCUTS.map(([keys, label], i) => (
          <Reveal key={label} delay={(i % 4) * 0.05} className={`shortcut ${i === lit ? 'lit' : ''}`}>
            <div className="shortcut-keys">{keys.map(k => <Keycap key={k} pressed={i === lit}>{k}</Keycap>)}</div>
            <span>{label}</span>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

export function Closing() {
  return (
    <section className="closing" id="closing">
      <RingArt />
      <Reveal delay={0.08}><h2 className="display small gradient-text">Own Term</h2></Reveal>
      <Reveal delay={0.16}><p className="lede">Built for Claude Code. Made for the Mac.</p></Reveal>
      <Reveal delay={0.24}><a className="button primary" href={DOWNLOAD}><Download size={17} strokeWidth={2.2} /> Download for Mac</a></Reveal>
      <Reveal delay={0.3}>
        <p className="first-launch">
          Own Term isn’t from the App Store, so the first time you open it macOS asks first: go to System
          Settings › Privacy &amp; Security and click Open Anyway. It updates itself after that.
        </p>
      </Reveal>
    </section>
  )
}


const FOOTER_LINKS: [string, [string, string][]][] = [
  ['Explore', [['Highlights', '#highlights'], ['Groups', '#groups'], ['Status', '#status'], ['Claude’s tools', '#tools'], ['Monitors', '#monitors']]],
  ['Features', [['Info panel', '#info'], ['Browser', '#browser'], ['Themes', '#themes'], ['And more', '#features'], ['Keyboard', '#shortcuts']]],
  ['Get it', [['Download', DOWNLOAD], ['What’s new', 'releases.html']]],
]

/** Apple's footer pattern: a breadcrumb, link columns, then a legal line. */
export function Footer({ home = '' }: { home?: string }) {
  const version = useLatestVersion()
  return (
    <footer className="footer">
      <div className="footer-inner">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <img src="icon.png" alt="" width={18} height={18} />
          <span>›</span>
          <span>Own Term</span>
        </nav>
        <div className="footer-columns">
          {FOOTER_LINKS.map(([heading, links]) => (
            <div key={heading}>
              <h4>{heading}</h4>
              <ul>
                {links.map(([label, href]) => (
                  <li key={label}><a href={href.startsWith('#') ? home + href : href}>{label}</a></li>
                ))}
              </ul>
            </div>
          ))}
          <div className="footer-cta">
            <img src="icon.png" alt="" width={44} height={44} />
            <div>
              <h4>Own Term for Mac</h4>
              <p>Run them all. Miss nothing.</p>
              <a className="footer-pill" href={DOWNLOAD}><Download size={13} strokeWidth={2.4} />Download</a>
              <small>{['Free', version && `Version ${version}`, 'macOS 13 or later, Apple silicon'].filter(Boolean).join(' · ')}</small>
            </div>
          </div>
        </div>
        <div className="legal">
          <span>Copyright © 2026 Own Term. Made for working with Claude Code.</span>
          <span>Not affiliated with Apple or Anthropic.</span>
        </div>
      </div>
    </footer>
  )
}
