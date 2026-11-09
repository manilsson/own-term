import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppWindow, ArrowUpRight, CalendarCheck, Globe, KeyRound, Palette, SquareTerminal, SquarePen, X } from 'lucide-react'
import { DEFAULT_REVIEW, loadSettings, openLink, settingsChanged, useStatus } from './status'
import { resolveProjects, useProjects, useRepos } from './projects'
import { useStore } from './store'
import { SecretsSettings } from './SecretsSettings'
import { Card } from './StatusPage'
import { closePage, openPage } from './workspace'
import { currentTheme, onThemeChange, setTheme, THEMES } from './themes'
import { editorState, useEditor } from './editor'

// Settings (⌘,), a page like Today: the app menu's choices and what the Today page connects to. The
// Linear key and the tokens go straight to main, which encrypts them; the window never reads them back.

const SECTIONS = [
  { id: 'appearance', title: 'Appearance', icon: <Palette size={13} strokeWidth={2.2} />, tone: 'purple' },
  { id: 'editor', title: 'Editor', icon: <SquarePen size={13} strokeWidth={2.2} />, tone: 'accent' },
  { id: 'menu-bar', title: 'Menu Bar', icon: <AppWindow size={13} strokeWidth={2.2} />, tone: 'gray' },
  { id: 'claude-code', title: 'Claude Code', icon: <SquareTerminal size={13} strokeWidth={2.2} />, tone: 'orange' },
  { id: 'browsers', title: 'Session Browsers', icon: <Globe size={13} strokeWidth={2.2} />, tone: 'accent' },
  { id: 'today', title: 'Today Page', icon: <CalendarCheck size={13} strokeWidth={2.2} />, tone: 'red' },
  { id: 'tokens', title: 'Tokens for Claude', icon: <KeyRound size={13} strokeWidth={2.2} />, tone: 'green' },
] as const

type Tab = (typeof SECTIONS)[number]['id']
type Target = Tab | 'projects'

// The tab shown, kept while the page is closed so it opens where you left it.
let tab: Tab = 'appearance'
let scrollTo: string | null = null
const tabListeners = new Set<() => void>()
const showTab = (next: Tab) => {
  tab = next
  tabListeners.forEach(l => l())
}

/** Opens the page on a tab; 'projects' is a part of the Today Page tab. */
export function openSettings(section?: Target) {
  if (section) {
    scrollTo = section === 'projects' ? 'settings-projects' : null
    showTab(section === 'projects' ? 'today' : section)
  }
  openPage('settings')
}

export function SettingsPage() {
  const settings = useStatus(s => s.settings)
  const current = useSyncExternalStore(listener => (tabListeners.add(listener), () => tabListeners.delete(listener)), () => tab)
  const page = useRef<HTMLDivElement>(null)
  const save = async (patch: Parameters<typeof window.deck.saveStatusSettings>[0]) => settingsChanged(await window.deck.saveStatusSettings(patch))

  useEffect(() => void loadSettings(), [])
  useEffect(() => {
    page.current?.scrollTo({ top: 0 })
  }, [current])
  // A part of a tab that was asked for (Name Projects…) may only exist once the settings have loaded.
  useEffect(() => {
    const el = scrollTo && document.getElementById(scrollTo)
    if (!el) return
    scrollTo = null
    // After the frame that lays the page out, or the scroll lands short of it.
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [current, settings])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.sheet-backdrop, .palette')) return
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return
      closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { title, icon, tone } = SECTIONS.find(s => s.id === current)!
  const body = {
    appearance: <AppearanceSettings />,
    editor: <EditorSettings />,
    'menu-bar': <MenuBarSettings />,
    'claude-code': <ClaudeCodeSettings />,
    browsers: <BrowserSettings />,
    today: !settings ? <div className="status-loading"><span className="spinner" />Loading…</div> : (
      <>
        <Linear settings={settings} save={save} />
        <Github settings={settings} save={save} />
        <ProjectNames settings={settings} save={save} />
        <ClaudeSettings settings={settings} save={save} />
      </>
    ),
    tokens: <SecretsSettings />,
  }[current]

  return (
    <div className="status-page settings-page" ref={page}>
      <div className="status-inner settings-inner">
        <nav className="settings-nav" role="tablist">
          <h1>Settings</h1>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={current === s.id}
              className={`settings-nav-item ${current === s.id ? 'on' : ''}`}
              onClick={() => showTab(s.id)}
            >
              <span className={`status-card-icon ${s.tone}`}>{s.icon}</span>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="settings-cards" role="tabpanel">
          <Card key={current} id={`settings-${current}`} icon={icon} tone={tone} title={title}>
            <div className="settings-card-body">{body}</div>
          </Card>
        </div>
      </div>
    </div>
  )
}

let preferences = window.deck.preferences()
const preferenceListeners = new Set<() => void>()
window.deck.onPreferences(next => {
  preferences = next
  preferenceListeners.forEach(l => l())
})
const usePreferences = () => useSyncExternalStore(
  listener => (preferenceListeners.add(listener), () => preferenceListeners.delete(listener)),
  () => preferences,
)

const APPEARANCES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const

function AppearanceSettings() {
  const { appearance } = usePreferences()
  const theme = useSyncExternalStore(onThemeChange, () => currentTheme().id)
  return (
    <div className="form-box">
      <div className="form-row">
        <span>Light or dark<small>System follows macOS.</small></span>
        <div className="segmented small">
          {APPEARANCES.map(([id, name]) => (
            <button key={id} type="button" className={appearance === id ? 'on' : ''} onClick={() => window.deck.setAppearance(id)}>{name}</button>
          ))}
        </div>
      </div>
      <div className="form-row stacked">
        <span>Theme<small>The terminal's colors, and the app's around them.</small></span>
        <div className="chips">
          {THEMES.map(t => (
            <button key={t.id} type="button" className={`chip ${theme === t.id ? 'on' : ''}`} onClick={() => setTheme(t.id)}>{t.name}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function EditorSettings() {
  const current = useEditor()
  return (
    <div className="form-box">
      <div className="form-row stacked">
        <span>Open files with<small>Where a file opens when you click a path in a terminal.</small></span>
        <div className="chips">
          {editorState().editors.map(e => (
            <button key={e.id} type="button" className={`chip ${current.id === e.id ? 'on' : ''}`} onClick={() => window.deck.setEditor(e.id)}>{e.name}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function MenuBarSettings() {
  const { menuBar } = usePreferences()
  return (
    <div className="form-box">
      <label className="form-row">
        <span>Show in menu bar<small>Its cursor blinks while Claude works, with a count of sessions needing you.</small></span>
        <input type="checkbox" role="switch" className="switch" checked={menuBar} onChange={e => window.deck.setMenuBar(e.target.checked)} />
      </label>
    </div>
  )
}

function ClaudeCodeSettings() {
  const [hooks, setHooks] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  useEffect(() => void window.deck.setupStatus().then(s => setHooks(s.hooks)), [])
  const install = async () => {
    const failed = await window.deck.installHooks()
    setError(failed ?? '')
    setHooks((await window.deck.setupStatus()).hooks)
  }
  return (
    <>
      <div className="form-box">
        <div className="form-row">
          <span>
            Own Term's hooks
            <small>{hooks === null ? 'Checking…' : hooks
              ? 'Installed in ~/.claude/settings.json: sessions show when Claude works, asks or finishes.'
              : 'Not installed, so sessions can’t show when Claude works, asks or finishes.'}</small>
          </span>
          {hooks === false && <button type="button" className="push-button default" onClick={install}>Install</button>}
        </div>
      </div>
      {error && <span className="form-error">{error}</span>}
    </>
  )
}

function BrowserSettings() {
  const { sessionBrowsers } = usePreferences()
  const [busy, setBusy] = useState(false)
  return (
    <div className="form-box">
      <label className="form-row">
        <span>Give each session its own Chrome<small>Claude's chrome-devtools tools drive a Chrome of the session's own, shown in its pane. Running Claudes pick it up when they restart.</small></span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={sessionBrowsers}
          disabled={busy}
          onChange={async e => {
            setBusy(true)
            await window.deck.setSessionBrowsers(e.target.checked)
            setBusy(false)
          }}
        />
      </label>
      <div className="form-row">
        <span>Sign in to sites<small>Logins are shared by every session's browser.</small></span>
        <button type="button" className="push-button" onClick={() => window.deck.signIn()}>Sign In…</button>
      </div>
    </div>
  )
}

type Save = (patch: Parameters<typeof window.deck.saveStatusSettings>[0]) => Promise<void>

function Linear({ settings, save }: { settings: StatusSettings; save: Save }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const linear = settings.linear
  const connect = async () => {
    setBusy(true)
    setError('')
    const result = await window.deck.connectLinear(key)
    setBusy(false)
    if (result.error !== undefined) return setError(result.error)
    setKey('')
    settingsChanged(result.settings)
  }
  const toggleTeam = (id: string) => {
    if (!linear.connected) return
    const selected = linear.selected.includes(id) ? linear.selected.filter(t => t !== id) : [...linear.selected, id]
    save({ linearTeams: selected })
  }
  return (
    <div className="settings-section">
      <h3>Linear</h3>
      {linear.connected ? (
        <>
          <div className="connection">
            <span className="connection-mark linear">{initials(linear.user.name)}</span>
            <span className="connection-text">
              <b>{linear.user.name}</b>
              <span>{linear.user.org ? `Connected to ${linear.user.org}` : 'Connected'}</span>
            </span>
            <button type="button" className="push-button" onClick={async () => settingsChanged(await window.deck.disconnectLinear())}>Disconnect</button>
          </div>
          {linear.teams.length > 1 && (
            <div className="field">
              <span className="field-label">Teams</span>
              <div className="chips">
                {linear.teams.map(t => (
                  <button key={t.id} type="button" className={`chip ${linear.selected.includes(t.id) ? 'on' : ''}`} onClick={() => toggleTeam(t.id)}>
                    {t.name}<small>{t.key}</small>
                  </button>
                ))}
              </div>
              <span className="field-note">{linear.selected.length ? 'Only issues from these teams.' : 'Issues from every team; pick some to show only theirs.'}</span>
            </div>
          )}
        </>
      ) : (
        <form className="field" onSubmit={e => { e.preventDefault(); if (!busy) connect() }}>
          <span className="field-label">Personal API key</span>
          <div className="key-field">
            <KeyRound size={14} strokeWidth={2} />
            <input className="text-field" type="password" placeholder="lin_api_…" value={key} onChange={e => setKey(e.target.value)} spellCheck={false} />
            <button type="submit" className="push-button default" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
          </div>
          {error && <span className="form-error">{error}</span>}
          <span className="field-note">
            Make one in Linear under Settings › Security & access › Personal API keys. It’s encrypted with your Mac’s keychain and only Own Term reads it.
            {' '}<button type="button" className="inline-link" onClick={() => openLink('https://linear.app/settings/account/security')}>Open Linear<ArrowUpRight size={11} strokeWidth={2.2} /></button>
          </span>
        </form>
      )}
    </div>
  )
}

function Github({ settings, save }: { settings: StatusSettings; save: Save }) {
  const github = settings.github
  return (
    <div className="settings-section">
      <h3>GitHub</h3>
      {github && github.error === undefined ? (
        <div className="connection">
          <span className="connection-mark">{initials(github.name || github.login)}</span>
          <span className="connection-text">
            <b>{github.login}</b>
            <span>Through the GitHub CLI (gh)</span>
          </span>
        </div>
      ) : (
        <p className="settings-note">
          {github?.error === 'missing' ? 'Install the GitHub CLI (brew install gh) and run gh auth login to see your pull requests.'
            : github?.error === 'logged-out' ? 'Run gh auth login in a session to see your pull requests.'
            : github?.error ? 'GitHub didn’t answer the last time Own Term asked.'
            : 'Checking the GitHub CLI…'}
        </p>
      )}
      <div className="form-box">
        <label className="form-row">
          <span>
            Notify me when a pull request needs me
            <small>A review or comment on yours, a review requested, or new commits on one you reviewed. Checked every few minutes.</small>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={settings.pings} onChange={e => save({ pings: e.target.checked })} />
        </label>
      </div>
      <div className="field">
        <span className="field-label">Pull requests from</span>
        <div className="chips">
          <button type="button" className={`chip ${settings.prScope === 'all' ? 'on' : ''}`} onClick={() => save({ prScope: 'all' })}>Every repository</button>
          <button type="button" className={`chip ${settings.prScope === 'sessions' ? 'on' : ''}`} onClick={() => save({ prScope: 'sessions' })}>Repositories you have sessions in</button>
        </div>
      </div>
      {settings.mutedRepos.length > 0 && (
        <div className="field">
          <span className="field-label">Hidden repositories</span>
          <div className="chips">
            {settings.mutedRepos.map(repo => (
              <span key={repo} className="chip removable">
                {repo}
                <button type="button" title={`Show ${repo} again`} onClick={() => save({ mutedRepos: settings.mutedRepos.filter(r => r !== repo) })}><X size={11} strokeWidth={2.4} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** A project name per repository; repositories named alike are one project on the Today page. */
function ProjectNames({ settings, save }: { settings: StatusSettings; save: Save }) {
  const projects = useProjects()
  const sessions = useStore(s => s.sessions)
  const groups = useStore(s => s.groups)
  const repoAt = useRepos()
  const data = useStatus(s => s.data)
  const journal = useStatus(s => s.journal)
  const repos = projects.list.flatMap(p => p.repos).sort((a, b) => a.localeCompare(b))
  // What each is called while unnamed: its sidebar group's name, or its own.
  const unnamed = resolveProjects({ sessions, groups }, repoAt, {}, data, journal)
  const rename = (repo: string, name: string) => {
    name = name.trim()
    if (name === (settings.projects[repo] ?? '')) return
    const next = { ...settings.projects }
    if (name && name !== unnamed.repo(repo)) next[repo] = name
    else delete next[repo]
    save({ projects: next })
  }
  if (!repos.length) return null
  return (
    <div className="settings-section" id="settings-projects">
      <h3>Projects</h3>
      <p className="settings-note">The sidebar and the Today page show one project at a time. Give two repositories the same name to make them one project.</p>
      <div className="form-box">
        {repos.map(repo => (
          <label key={repo} className="form-row">
            <span>{repo.split('/')[1] ?? repo}<small>{repo}</small></span>
            <input
              key={settings.projects[repo] ?? ''}
              className="text-field project-name"
              defaultValue={settings.projects[repo] ?? ''}
              placeholder={unnamed.repo(repo)}
              onBlur={e => rename(repo, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

const MODELS: { id: StatusSettings['model']; name: string }[] = [
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' },
  { id: 'haiku', name: 'Haiku' },
]

function ClaudeSettings({ settings, save }: { settings: StatusSettings; save: Save }) {
  const [instructions, setInstructions] = useState(settings.instructions)
  const [review, setReview] = useState(settings.reviewPrompt)
  return (
    <div className="settings-section">
      <h3>Claude</h3>
      <div className="form-box">
        <label className="form-row">
          <span>
            Write a brief and a standup
            <small>Claude reads your sessions, pull requests, issues and to-dos, through claude -p on your account.</small>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={settings.ai} onChange={e => save({ ai: e.target.checked })} />
        </label>
        <div className={`form-row ${settings.ai ? '' : 'disabled'}`}>
          <span>Model</span>
          <div className="segmented small">
            {MODELS.map(m => (
              <button key={m.id} type="button" className={settings.model === m.id ? 'on' : ''} disabled={!settings.ai} onClick={() => save({ model: m.id })}>{m.name}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="field">
        <span className="field-label">Your instructions</span>
        <textarea
          className="text-field text-area"
          rows={3}
          placeholder="I’m on the platform team. Reviews come before my own work. Write the standup in Swedish."
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          onBlur={() => instructions !== settings.instructions && save({ instructions })}
        />
        <span className="field-note">Claude follows these when it writes your brief and standup.</span>
      </label>
      <label className="field">
        <span className="field-label">Review with Claude asks</span>
        <textarea
          className="text-field text-area"
          rows={2}
          placeholder={DEFAULT_REVIEW}
          value={review}
          onChange={e => setReview(e.target.value)}
          onBlur={() => review !== settings.reviewPrompt && save({ reviewPrompt: review })}
        />
        <span className="field-note">{'{number}'}, {'{repo}'}, {'{title}'}, {'{url}'}, {'{author}'} and {'{branch}'} are filled in. A skill works too, like /review {'{url}'}.</span>
      </label>
    </div>
  )
}

const initials = (name: string) => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
