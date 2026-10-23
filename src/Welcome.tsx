import { useEffect, useState } from 'react'
import { Check, CircleAlert, FolderOpen, Sparkle, SquareTerminal } from 'lucide-react'
import { Mark } from './Mark'
import { newId, newProject, rememberFolder, setState, useStore, type Session } from './store'
import { openSession } from './workspace'

type Setup = { claude: string | null; hooks: boolean }

const TIPS: [string[], string, string][] = [
  [['⌘', 'T'], 'New session', 'Optionally in its own git worktree.'],
  [['⌘', 'click'], 'Side by side', 'Pick sessions to show together, then save them as a group.'],
  [['⌘', 'J'], 'Needs You', 'Jump to the session that has waited longest for you.'],
  [['⌘', 'P'], 'Everything else', 'Go to any session or group, or run any command.'],
]

/** What a fresh Own Term shows: start a first session, check the setup Claude needs, and the basics. */
export function Welcome({ onDemo }: { onDemo: () => void }) {
  const lastCwd = useStore(s => s.lastCwd)
  const [cwd, setCwd] = useState(lastCwd)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.deck.setupStatus().then(setSetup)
  }, [])

  const start = (runClaude: boolean) => {
    const folder = cwd.trim() || window.deck.homeDir
    const session: Session = {
      id: newId(),
      name: folder.split('/').filter(Boolean).pop() ?? 'home',
      cwd: folder,
      groupId: null,
      runClaude,
      autoName: true,
      project: newProject(),
    }
    setState(s => ({ sessions: [...s.sessions, session], lastCwd: folder }))
    rememberFolder(folder)
    openSession(session.id)
  }

  const installHooks = async () => {
    setInstalling(true)
    const failure = await window.deck.installHooks()
    setInstalling(false)
    if (failure) setError(failure)
    else setSetup(await window.deck.setupStatus())
  }

  return (
    <div className="welcome">
      <Mark size={64} className="welcome-mark" />
      <h1>Welcome to Own Term</h1>
      <p className="welcome-lede">Your Claude Code sessions in one window: grouped, side by side, and telling you when one needs you.</p>

      <section className="welcome-card">
        <h2>Start your first session</h2>
        <div className="welcome-folder">
          <FolderOpen size={15} strokeWidth={1.8} />
          <input className="text-field" value={cwd} onChange={e => setCwd(e.target.value)} spellCheck={false} />
          <button
            className="push-button"
            onClick={async () => {
              const picked = await window.deck.pickFolder(cwd)
              if (picked) setCwd(picked)
            }}
          >
            Choose…
          </button>
        </div>
        <div className="welcome-actions">
          <button className="push-button default" onClick={() => start(true)} disabled={setup?.claude === null}>
            <Sparkle size={13} strokeWidth={2} /> Start Claude
          </button>
          <button className="push-button" onClick={() => start(false)}>
            <SquareTerminal size={13} strokeWidth={2} /> Open a Shell
          </button>
        </div>
      </section>

      <section className="welcome-checks">
        <div className={`welcome-check ${setup ? (setup.claude ? 'ok' : 'warn') : ''}`}>
          {setup?.claude ? <Check size={15} strokeWidth={2.4} /> : <CircleAlert size={15} strokeWidth={2.2} />}
          <div>
            <b>{!setup ? 'Looking for Claude Code…' : setup.claude ? 'Claude Code is installed' : 'Claude Code isn’t installed'}</b>
            <span>
              {setup?.claude ? setup.claude.replace(window.deck.homeDir, '~') : (
                <>Install it from <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">claude.com/claude-code</a>, then reopen Own Term.</>
              )}
            </span>
          </div>
        </div>
        <div className={`welcome-check ${setup ? (setup.hooks ? 'ok' : 'warn') : ''}`}>
          {setup?.hooks ? <Check size={15} strokeWidth={2.4} /> : <CircleAlert size={15} strokeWidth={2.2} />}
          <div>
            <b>{setup?.hooks ? 'Own Term can see what Claude is doing' : 'Own Term can’t see what Claude is doing yet'}</b>
            <span>
              {setup?.hooks
                ? 'Its hooks are in your Claude settings.'
                : 'A few hooks in ~/.claude/settings.json report when Claude works, asks or finishes. They do nothing outside Own Term.'}
            </span>
            {error && <span className="welcome-error">{error}</span>}
          </div>
          {setup && !setup.hooks && (
            <button className="push-button default" onClick={installHooks} disabled={installing}>
              {installing ? 'Installing…' : 'Install Hooks'}
            </button>
          )}
        </div>
      </section>

      <section className="welcome-tips">
        {TIPS.map(([keys, title, text]) => (
          <div key={title} className="welcome-tip">
            <span className="welcome-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>
            <b>{title}</b>
            <span>{text}</span>
          </div>
        ))}
      </section>

      <button className="link-button welcome-demo" onClick={onDemo}>Or explore a demo day first</button>
    </div>
  )
}
