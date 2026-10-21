import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, GitBranch, Sparkle } from 'lucide-react'
import { groupColor, newId, rememberFolder, setState, useStore, type Session } from './store'
import { openSession } from './workspace'
import { statusState } from './status'
import { useProjects } from './projects'

const home = window.deck.homeDir
const tilde = (path: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path
const parent = (path: string) => path.replace(/\/+[^/]+\/*$/, '') || '/'
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// Scratch folders come and go; they're never where the next session belongs.
const scratch = (path: string) => /^\/(private\/)?(tmp|var\/folders)\//.test(path)

/** The new-session form, as a macOS sheet dropping from the top of the window. */
export function NewSessionSheet({ groupId: initialGroup, cwd: initialCwd, onDone }: {
  groupId: string | null
  /** A folder to start in, like a worktree picked in the info panel; otherwise the last one used. */
  cwd?: string
  onDone: () => void
}) {
  const lastCwd = useStore(s => s.lastCwd)
  const recentFolders = useStore(s => s.recentFolders)
  const groups = useStore(s => s.groups)
  const sessions = useStore(s => s.sessions)
  // Opened from a group, it starts in that group; otherwise in none, for Claude to sort.
  const [groupId, setGroupId] = useState(initialGroup)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(initialCwd ?? lastCwd)
  const [runClaude, setRunClaude] = useState(true)
  const [worktree, setWorktree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The folder's branch, or null when it isn't a git repository; undefined while asking.
  const [branch, setBranch] = useState<string | null | undefined>(undefined)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  useEffect(() => {
    let current = true
    setBranch(undefined)
    window.deck.gitInfo(cwd).then(info => current && setBranch(info?.branch ?? null), () => current && setBranch(null))
    return () => {
      current = false
    }
  }, [cwd])
  const isRepo = branch !== null
  useEffect(() => {
    if (branch === null) setWorktree(false)
  }, [branch])

  // Each project's repository, always; then other folders sessions were started or worked in, newest
  // first. Main says where each worktree's repository is and which folders are gone.
  const projects = useProjects()
  const [offered, setOffered] = useState<{ projects: { folder: string; project: string }[]; recent: string[] }>({ projects: [], recent: [] })
  useEffect(() => {
    let current = true
    const worked = [...(statusState().journal ?? [])].reverse().map(e => e.folder)
    const folders = [...new Set([...recentFolders, ...sessions.filter(x => !x.demo).map(x => x.cwd).reverse(), ...worked]
      .filter((f): f is string => !!f && !scratch(f)))]
    const repos = projects.list.flatMap(p => p.repos)
    window.deck.sessionFolders(folders, repos).then(({ roots, clones }) => {
      if (!current) return
      const inProjects = projects.list.flatMap(p => p.repos.filter(r => clones[r]).map(r => ({ folder: clones[r], project: p.name })))
      const taken = new Set(inProjects.map(p => p.folder))
      const recent = [...new Set(folders.map(f => roots[f]?.root).filter((f): f is string => !!f && !taken.has(f) && !scratch(f)))]
      setOffered({ projects: inProjects, recent: recent.slice(0, 4) })
    }, () => {})
    return () => {
      current = false
    }
  }, [recentFolders, sessions, projects])
  const recents = offered.recent.filter(f => f !== cwd)

  // A worktree being created can't be stopped halfway, so the sheet stays until it's done.
  const close = () => !busy && onDone()

  const choose = async () => {
    const picked = await window.deck.pickFolder(cwd)
    if (picked) setCwd(picked)
  }

  const create = async () => {
    let folder = cwd.trim()
    if (worktree) {
      setBusy(true)
      try {
        folder = await window.deck.createWorktree(cwd, name)
      } catch (e) {
        setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        setBusy(false)
        return
      }
    }
    const id = newId()
    const session: Session = {
      id,
      name: name.trim() || baseName(folder) || 'session',
      cwd: folder,
      groupId,
      runClaude,
      autoName: !name.trim(),
    }
    setState(s => ({ sessions: [...s.sessions, session], lastCwd: cwd.trim() }))
    rememberFolder(cwd.trim())
    onDone()
    openSession(id)
  }

  return (
    <div className="sheet-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <form
        className="sheet new-session"
        onSubmit={e => {
          e.preventDefault()
          if (!busy) create()
        }}
        onKeyDown={e => e.key === 'Escape' && close()}
      >
        <h2>New Session</h2>

        <div className="folder-card" onClick={choose} title={cwd}>
          <span className="folder-card-icon"><FolderOpen size={18} strokeWidth={1.8} /></span>
          <span className="folder-card-text">
            <b>{baseName(cwd) || '/'}</b>
            {/* Marks keep the path reading left to right while it's cut short from the start. */}
            <span>{`\u200e${tilde(parent(cwd))}\u200e`}</span>
          </span>
          {branch && <span className="folder-card-branch"><GitBranch size={12} strokeWidth={2} />{branch}</span>}
          <button type="button" className="push-button" onClick={e => { e.stopPropagation(); choose() }}>Choose…</button>
        </div>
        {offered.projects.length > 0 && (
          <div className="recent-folders">
            <span>Projects</span>
            {offered.projects.map(p => (
              <button key={p.folder} type="button" className={`chip ${p.folder === cwd ? 'on' : ''}`} title={`${p.project} · ${tilde(p.folder)}`} onClick={() => setCwd(p.folder)}>
                {baseName(p.folder)}
              </button>
            ))}
          </div>
        )}
        {recents.length > 0 && (
          <div className="recent-folders">
            <span>Recent</span>
            {recents.map(folder => (
              <button key={folder} type="button" className="chip" title={tilde(folder)} onClick={() => setCwd(folder)}>
                {baseName(folder)}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span className="field-label">{worktree ? 'Branch' : 'Name'}</span>
          <input
            ref={nameRef}
            className="text-field"
            placeholder={worktree ? 'fix-login-redirect' : 'Claude names it from your first prompt'}
            value={name}
            required={worktree}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field-label">Group</span>
          <div className="chips">
            <button type="button" className={`chip ${groupId === null ? 'on' : ''}`} onClick={() => setGroupId(null)}>
              <Sparkle size={12} strokeWidth={2} />Let Claude sort it
            </button>
            {groups.map(g => (
              <button key={g.id} type="button" className={`chip ${groupId === g.id ? 'on' : ''}`} onClick={() => setGroupId(g.id)}>
                <i className="tag-dot" style={{ background: groupColor(g) }} />{g.name}
              </button>
            ))}
          </div>
        </div>

        <div className="form-box">
          <label className="form-row">
            <span>
              Start Claude Code
              <small>Otherwise it opens a shell.</small>
            </span>
            <Switch checked={runClaude} onChange={setRunClaude} />
          </label>
          <label className={`form-row ${isRepo ? '' : 'disabled'}`}>
            <span>
              New worktree
              <small>
                {!isRepo ? 'The folder isn’t a git repository.'
                  : worktree && slug(name) ? `In .claude/worktrees/${slug(name)}, on a new branch from main.`
                  : 'Its own branch and folder, from main.'}
              </small>
            </span>
            <Switch checked={worktree} disabled={!isRepo} onChange={setWorktree} />
          </label>
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="sheet-buttons">
          <button type="button" className="push-button" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="push-button default" disabled={busy}>
            {busy ? 'Creating Worktree…' : runClaude ? 'Start Claude' : 'Open Shell'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
}
