// The release page: every version from RELEASE_NOTES.md, which the release script writes from commit
// subjects. Read at build time, so a deploy after a release shows it.
import { MotionConfig } from 'motion/react'
import { ArrowRight, Download } from 'lucide-react'
import notes from '../../RELEASE_NOTES.md?raw'
import { Nav } from './hero'
import { Footer } from './more'
import { DOWNLOAD, Reveal, Shot } from './ui'

const TAGS = 'https://github.com/manilsson/own-term-releases/releases/tag/v'

// Commits about the site, the docs, reviews and the release process say nothing about the app.
const INTERNAL = /\b(marketing|site|hero|demo day|demo's|reviews?|review's|brand sheet|README|architecture|Vercel|release script|release upload|test release|feature grid|IPC|traps)\b|^(Document|Ignore|Release v|Publish releases|Delete the built app)/i
const FIXED = /^(Fix|Keep|Retry|Ignore|Stop)\b|\bagain\b|^Show submenus/
const NEW = /^(Add|Show|Give|Let|Remind|Answer|Reopen|Undo|Sign in|Move|Click|Zoom|Tint|Preview|Float|Reorder|Alert|Redesign|Package|Welcome|End|Pick|Go to|Scroll)\b/

type Kind = 'New' | 'Improved' | 'Fixed'
interface Release { version: string; date: string; items: Record<Kind, string[]> }

const releases: Release[] = notes.split(/^## /m).slice(1).map(block => {
  const [version, ...rest] = block.split('\n')
  const date = rest.find(line => /^\d{4}-\d\d-\d\d$/.test(line.trim()))?.trim() ?? ''
  const items: Record<Kind, string[]> = { New: [], Improved: [], Fixed: [] }
  for (const line of rest) {
    if (!line.startsWith('- ')) continue
    const text = line.slice(2).trim().replace(/\bdeckterm\b/g, 'Own Term')
    if (INTERNAL.test(text)) continue
    items[FIXED.test(text) ? 'Fixed' : NEW.test(text) ? 'New' : 'Improved'].push(text)
  }
  return { version: version.trim(), date, items }
})

// The releases worth a picture, and where the main page tells their story.
const HIGHLIGHTS: Record<string, { title: string; text: string; shot?: string; href?: string }> = {
  '0.1.62': { title: 'A sidebar per project.', text: 'Projects sit on a rail beside the sidebar, Slack’s workspaces. Choose one and the sidebar and Today show only its work, while Needs You, ⌘J and the Dock badge still count everything.', shot: 'ios', href: './#highlights' },
  '0.1.57': { title: 'Reminders.', text: 'A tile and a page for every reminder, by day: the sessions you meant to come back to, and to-dos with a time. One that came due waits at the top until it’s done.', shot: 'reminders', href: './#highlights' },
  '0.1.53': { title: 'Monitors.', text: 'Ask Claude to keep an eye on error rates, a deploy or a pull request’s checks. It writes a monitor once, and Own Term runs its commands on a schedule, draws what they return on a page in the sidebar and tells you when a rule fires.', href: './#monitors' },
  '0.1.52': { title: 'An icon for every session.', text: 'Claude picks one when it starts a session, or when you ask, and it shows before the name in the sidebar and the pane header.', href: './#features' },
  '0.1.39': { title: 'Today.', text: 'A page for the start of the day: a brief from Claude on where to start, review requests and your pull requests, your Linear issues and to-dos. Its Week tab writes your standup.', shot: 'today', href: './#highlights' },
  '0.1.37': { title: 'See what Claude runs.', text: 'The info panel lists every command Claude runs and how it ended, with a dev server’s port beside the command that started it. Click one to read what it printed, live while it runs.', shot: 'info', href: './#info' },
  '0.1.36': { title: 'Every turn, marked.', text: 'A tick beside the scrollbar for each prompt, each question and each finished turn, a click from scrolling there. The info panel shows what Claude saved to its scratchpad.', href: './#features' },
  '0.1.32': { title: 'A new sidebar.', text: 'Needs You and Working are tiles with their counts, the focused session is washed in the accent, and every group folds at once.', href: './#status' },
  '0.1.30': { title: 'Answer without switching.', text: 'Reply to a finished session from its banner, its notification or the menu bar. Reopen a closed session with ⇧⌘T, and undo the last change, yours or Claude’s, with ⌘Z.', href: './#status' },
  '0.1.29': { title: 'Claude hands work along.', text: 'Ask Claude to send a prompt to another session, or to end one that’s done. Undo reopens it, conversation and all.', href: './#tools' },
  '0.1.28': { title: 'Claude’s tools, and reminders.', text: 'Claude in any session can organize the sidebar, start sessions in their own worktrees and set reminders. Remind Me puts a time and a note on a session.', shot: 'tools', href: './#tools' },
  '0.1.27': { title: 'Every pane wears its group.', text: 'Pane headers carry a shade of their group’s color, and name the group when sessions from several share the screen.', shot: 'mixed', href: './#groups' },
  '0.1.26': { title: 'A browser per session.', text: 'Each session’s Claude drives a Chrome of its own, live over the terminal. Click and type in it, or move it out to Chrome.', shot: 'browser', href: './#browser' },
  '0.1.19': { title: 'Own Term in the menu bar.', text: 'See what Claude is doing from any app, and answer permission requests right from the banner.', href: './#status' },
  '0.1.16': { title: 'See what changed.', text: 'The info panel lists every changed file. Click one to read its diff, or open it in the editor you choose.', shot: 'viewer', href: './#info' },
  '0.1.15': { title: 'The info panel.', text: 'Everything about one session beside it: Claude’s context, the branch, the pull request and the dev servers.', shot: 'info', href: './#info' },
  '0.1.14': { title: 'Themes.', text: 'Color themes for the whole app, each with a light and a dark side.', shot: 'theme-nord', href: './#themes' },
  '0.1.1': { title: 'The first release.', text: 'Many Claude Code sessions in one window, grouped, side by side, and quiet until one needs you. Signed, and it updates itself.' },
}

const formatDate = (date: string) => date && new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export function ReleasesPage() {
  const latest = releases[0]
  return (
    <MotionConfig reducedMotion="user">
      <Nav home="./" />
      <main className="releases">
        <header className="releases-head">
          <Reveal><p className="eyebrow">Release notes</p></Reveal>
          <Reveal delay={0.05}><h1 className="title">What’s new<br />in Own Term.</h1></Reveal>
          <Reveal delay={0.1}>
            <p className="lede">Own Term updates itself, so you’re likely on {latest ? `version ${latest.version}` : 'the latest'} already. Here is everything that changed, newest first.</p>
            <div className="releases-actions">
              <a className="button primary" href={DOWNLOAD}><Download size={17} strokeWidth={2.2} /> Download for Mac</a>
            </div>
          </Reveal>
        </header>
        <ol className="release-list">
          {releases.map((release, i) => <ReleaseEntry key={release.version} release={release} latest={i === 0} />)}
        </ol>
      </main>
      <Footer home="./" />
    </MotionConfig>
  )
}

function ReleaseEntry({ release, latest }: { release: Release; latest: boolean }) {
  const highlight = HIGHLIGHTS[release.version]
  const kinds = (['New', 'Improved', 'Fixed'] as Kind[]).filter(kind => release.items[kind].length)
  const count = kinds.reduce((n, kind) => n + release.items[kind].length, 0)
  return (
    <li className="release" id={`v${release.version}`}>
      <div className="release-meta">
        <a className="release-version" href={`#v${release.version}`}>{release.version}</a>
        {latest && <span className="release-latest">Latest</span>}
        <time dateTime={release.date}>{formatDate(release.date)}</time>
        <a className="release-tag" href={TAGS + release.version}>GitHub</a>
      </div>
      <Reveal className="release-body">
        {highlight && (
          <div className="release-highlight">
            <h2>{highlight.title}</h2>
            <p>{highlight.text}</p>
            {highlight.href && <a className="text-link" href={highlight.href}>See how it works <ArrowRight size={14} strokeWidth={2.2} /></a>}
            {highlight.shot && <Shot name={highlight.shot} alt={highlight.title} className="release-shot" />}
          </div>
        )}
        {count === 0 && <p className="release-quiet">Improvements under the hood.</p>}
        {count > 8 ? (
          <details className="release-details">
            <summary>All {count} changes</summary>
            <Changes release={release} kinds={kinds} />
          </details>
        ) : <Changes release={release} kinds={kinds} />}
      </Reveal>
    </li>
  )
}

function Changes({ release, kinds }: { release: Release; kinds: Kind[] }) {
  return (
    <div className="release-changes">
      {kinds.map(kind => (
        <div key={kind} className="release-group">
          <span className={`release-kind ${kind.toLowerCase()}`}>{kind}</span>
          <ul>{release.items[kind].map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      ))}
    </div>
  )
}
