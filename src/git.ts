import { getState, setState } from './store'

// One request per folder at a time: sessions in the same folder share it, and a slow repo's poll
// doesn't pile up behind itself.
const inFlight = new Map<string, Promise<GitInfo | null>>()
// Requests are numbered so an older answer arriving late can't overwrite a newer one.
let requests = 0
const applied: Record<string, number> = {}

function info(cwd: string, fresh: boolean) {
  const current = inFlight.get(cwd)
  if (current && !fresh) return current
  const request = window.deck.gitInfo(cwd).finally(() => inFlight.get(cwd) === request && inFlight.delete(cwd))
  inFlight.set(cwd, request)
  return request
}

/** Refreshes the branch and change counts shown for a session, or for every session. */
export async function refreshGit(id?: string) {
  const sessions = getState().sessions.filter(s => !s.demo && (!id || s.id === id))
  const number = ++requests
  // A refresh for one session follows something it just did, so it asks git again rather than sharing.
  const results = await Promise.all(sessions.map(s => info(s.cwd, !!id)))
  const current = getState().git
  const changed = sessions.filter((s, i) => (applied[s.id] ?? 0) < number && JSON.stringify(current[s.id]) !== JSON.stringify(results[i]))
  for (const s of sessions) applied[s.id] = Math.max(applied[s.id] ?? 0, number)
  if (changed.length === 0) return
  setState(st => ({ git: { ...st.git, ...Object.fromEntries(changed.map(s => [s.id, results[sessions.indexOf(s)]])) } }))
}

// Claude edits files without the shell noticing, so the counts are also polled while the window is visible.
setInterval(() => !document.hidden && refreshGit(), 5000)
refreshGit()
