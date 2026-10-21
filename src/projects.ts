import { useMemo, useSyncExternalStore } from 'react'
import { getState, orderedSessions, useStore, type Note, type Session, type State } from './store'
import { githubOk, isDemo, linearOk, statusState, useStatus } from './status'

// The Today page's projects: each repository belongs to one, named after the sidebar group that
// holds its sessions until the user names it in Settings; repositories given one name are one project.
// Everything on the page (sessions, pull requests, issues, to-dos, prompts) is placed in one by its
// repository, and a session outside any repository by its group.

// ── Which repository each session's folder is in, asked of main ───────────────────────────────

let repos: Record<string, string | null> = {}
const repoListeners = new Set<() => void>()
const asking = new Set<string>()

/** Asks main for the repositories of folders it hasn't been asked about. */
export async function learnRepos(folders: string[]) {
  const unknown = [...new Set(folders)].filter(f => f && !(f in repos) && !asking.has(f))
  if (!unknown.length) return
  unknown.forEach(f => asking.add(f))
  const found = await window.deck.repos(unknown).catch(() => ({}))
  unknown.forEach(f => asking.delete(f))
  repos = { ...repos, ...found }
  repoListeners.forEach(l => l())
}

export const knownRepos = () => repos

export const useRepos = () => useSyncExternalStore(
  listener => {
    repoListeners.add(listener)
    return () => repoListeners.delete(listener)
  },
  () => repos,
)

// ── Placing things in projects ────────────────────────────────────────────────────────────────

export interface Projects {
  list: ProjectDef[]
  session(id?: string): string | undefined
  repo(repo?: string | null): string | undefined
  issue(issue: Pick<StatusIssue, 'repo'>): string | undefined
  note(note: Pick<Note, 'session' | 'issue' | 'project'>): string | undefined
  entry(entry: JournalEntry): string | undefined
}

const shortName = (repo: string) => repo.split('/')[1] ?? repo

export function resolveProjects(
  s: Pick<State, 'sessions' | 'groups'>,
  repoAt: Record<string, string | null>,
  names: Record<string, string>,
  data: StatusData | null,
  journal: JournalEntry[] | null,
): Projects {
  const none: Projects = { list: [], session: () => undefined, repo: () => undefined, issue: () => undefined, note: () => undefined, entry: () => undefined }
  if (isDemo(s)) return none
  const sessions = orderedSessions(s).filter(x => !x.demo)
  const sessionRepo = (x: Session) => repoAt[x.cwd] ?? undefined

  // A repository whose sessions are all in one group, which has no other repository's, is that group's work.
  const groupsOf = new Map<string, Set<string>>()
  const reposOf = new Map<string, Set<string>>()
  for (const x of sessions) {
    const repo = sessionRepo(x)
    if (!repo || !x.groupId) continue
    groupsOf.set(repo, (groupsOf.get(repo) ?? new Set()).add(x.groupId))
    reposOf.set(x.groupId, (reposOf.get(x.groupId) ?? new Set()).add(repo))
  }
  const lower = Object.fromEntries(Object.entries(names).map(([repo, name]) => [repo.toLowerCase(), name]))
  const nameOf = (repo: string) => {
    if (lower[repo.toLowerCase()]) return lower[repo.toLowerCase()]
    const groups = [...(groupsOf.get(repo) ?? [])]
    const group = groups.length === 1 && reposOf.get(groups[0])?.size === 1 ? s.groups.find(g => g.id === groups[0]) : undefined
    return group?.name ?? shortName(repo)
  }
  const ofRepo = (repo?: string | null) => (repo ? nameOf(repo) : undefined)

  const ofSession = new Map<string, string | undefined>()
  for (const x of sessions) {
    const repo = sessionRepo(x)
    if (repo) ofSession.set(x.id, nameOf(repo))
    else {
      // Outside a repository, it's where the rest of its group is, when that's one project.
      const inGroup = new Set([...(x.groupId ? reposOf.get(x.groupId) ?? [] : [])].map(nameOf))
      ofSession.set(x.id, inGroup.size === 1 ? [...inGroup][0] : undefined)
    }
  }
  const byClaude = new Map(sessions.filter(x => x.claudeSessionId).map(x => [x.claudeSessionId!, x.id]))

  const gh = githubOk(data?.github)
  const lin = linearOk(data?.linear)
  const issues = new Map([...(lin?.open ?? []), ...(lin?.done ?? [])].map(i => [i.identifier, i]))
  const ofIssue = (issue: Pick<StatusIssue, 'repo'>) => ofRepo(issue.repo)

  // Ordered as the sidebar is, then by how much each has going on.
  const seen = new Map<string, { repos: Set<string>; order: number; count: number }>()
  const add = (repo: string | null | undefined, order = Infinity) => {
    if (!repo) return
    const name = nameOf(repo)
    const project = seen.get(name) ?? { repos: new Set(), order, count: 0 }
    project.repos.add(repo)
    project.order = Math.min(project.order, order)
    project.count++
    seen.set(name, project)
  }
  sessions.forEach((x, i) => add(sessionRepo(x), i))
  for (const pr of [...(gh?.mine ?? []), ...(gh?.review ?? []), ...(gh?.merged ?? []), ...(gh?.reviewed ?? [])]) add(pr.repo)
  for (const i of issues.values()) add(i.repo)
  for (const e of journal ?? []) if (e.kind === 'prompt') add(e.repo)
  const list = [...seen].sort(([a, x], [b, y]) => x.order - y.order || y.count - x.count || a.localeCompare(b))
    .map(([name, p]) => ({ name, repos: [...p.repos] }))

  return {
    list,
    session: id => (id ? ofSession.get(id) : undefined),
    repo: ofRepo,
    issue: ofIssue,
    note: n => (n.session && ofSession.get(n.session)) || (n.issue && issues.has(n.issue) ? ofIssue(issues.get(n.issue)!) : undefined) || n.project,
    entry: e => {
      const session = e.session && ofSession.has(e.session) ? e.session : e.claude ? byClaude.get(e.claude) : undefined
      return session ? ofSession.get(session) : ofRepo(e.repo)
    },
  }
}

/** The projects as they are now, for code outside React. */
export function currentProjects() {
  const status = statusState()
  return resolveProjects(getState(), repos, status.settings?.projects ?? {}, status.data, status.journal)
}

export function useProjects() {
  const sessions = useStore(s => s.sessions)
  const groups = useStore(s => s.groups)
  const repoAt = useRepos()
  const names = useStatus(s => s.settings?.projects)
  const data = useStatus(s => s.data)
  const journal = useStatus(s => s.journal)
  return useMemo(() => resolveProjects({ sessions, groups }, repoAt, names ?? {}, data, journal), [sessions, groups, repoAt, names, data, journal])
}

// ── The project the page shows ────────────────────────────────────────────────────────────────

const PROJECT_KEY = 'deckterm.project'
let chosen = (() => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ''
  } catch {
    return ''
  }
})()
const chosenListeners = new Set<() => void>()

export function chooseProject(name: string) {
  chosen = name
  try {
    localStorage.setItem(PROJECT_KEY, name)
  } catch {}
  chosenListeners.forEach(l => l())
}

const useChosen = () => useSyncExternalStore(
  listener => {
    chosenListeners.add(listener)
    return () => chosenListeners.delete(listener)
  },
  () => chosen,
)

/** The chosen project, while it still has anything in it; otherwise everything. */
export function selectedProject(projects = currentProjects()): ProjectDef | undefined {
  return chosenIn(projects, chosen)
}

// With one project there are no tabs to leave it by, so the page shows everything.
const chosenIn = (projects: Projects, name: string) => (projects.list.length > 1 ? projects.list.find(p => p.name === name) : undefined)

/** What the page shows: the chosen project, and whether each thing belongs on it. */
export function useScope() {
  const projects = useProjects()
  const name = useChosen()
  const project = chosenIn(projects, name)
  return useMemo(() => {
    const is = (n: string | undefined) => !project || n === project.name
    return {
      projects,
      project,
      session: (x: Pick<Session, 'id'>) => is(projects.session(x.id)),
      pr: (pr: Pick<StatusPr, 'repo'>) => is(projects.repo(pr.repo)),
      issue: (i: StatusIssue) => is(projects.issue(i)),
      note: (n: Note) => is(projects.note(n)),
      entry: (e: JournalEntry) => is(projects.entry(e)),
    }
  }, [projects, project])
}
