import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, KeyRound, X } from 'lucide-react'
import { DEFAULT_REVIEW, loadSettings, openLink, settingsChanged, useStatus } from './status'
import { resolveProjects, useProjects, useRepos } from './projects'
import { useStore } from './store'

// Settings (⌘,): what the Today page connects to and how Claude writes for it. The Linear key goes
// straight to main, which encrypts it; the window only ever learns who it belongs to.

export function SettingsSheet({ onDone }: { onDone: () => void }) {
  const settings = useStatus(s => s.settings)
  // Focus goes to the sheet itself, so Escape closes it and nothing scrolls the sheet to a button.
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    loadSettings()
    sheet.current?.focus({ preventScroll: true })
  }, [])
  const save = async (patch: Parameters<typeof window.deck.saveStatusSettings>[0]) => settingsChanged(await window.deck.saveStatusSettings(patch))

  return (
    <div className="sheet-backdrop" onMouseDown={e => e.target === e.currentTarget && onDone()}>
      <div className="sheet settings-sheet" tabIndex={-1} ref={sheet} onKeyDown={e => e.key === 'Escape' && onDone()}>
        <h2>Settings</h2>
        <p className="sheet-detail">What the Today page (⌃⌘T) shows, and how Claude writes your brief and standup.</p>
        {!settings ? <div className="status-loading"><span className="spinner" />Loading…</div> : (
          <>
            <Linear settings={settings} save={save} />
            <Github settings={settings} save={save} />
            <ProjectNames settings={settings} save={save} />
            <ClaudeSettings settings={settings} save={save} />
          </>
        )}
        <div className="sheet-buttons">
          <button type="button" className="push-button default" onClick={onDone}>Done</button>
        </div>
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
    <div className="settings-section">
      <h3>Projects</h3>
      <p className="settings-note">The Today page shows one project at a time. Give two repositories the same name to make them one project.</p>
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
