import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { getState, GROUP_COLORS, orderedSessions, setProjectForNew, updateGroup, useStore, viewIds, type Group, type Note, type Session, type State } from './store'
import { githubOk, isDemo, linearOk, loadSettings, statusState, useStatus } from './status'
import { SESSION_ICONS } from './sessionIcons'

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
  /** The projects a group's sessions are in; none means it's shown in every project. */
  group(id: string): string[]
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
  const none: Projects = { list: [], session: () => undefined, group: () => [], repo: () => undefined, issue: () => undefined, note: () => undefined, entry: () => undefined }
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

  // A remembered project counts only while it's still one, so a renamed one hides nothing.
  const known = (name?: string) => (name && seen.has(name) ? name : undefined)
  const groupById = new Map(s.groups.map(g => [g.id, g]))
  const ofSession = new Map<string, string | undefined>()
  for (const x of sessions) {
    const repo = sessionRepo(x)
    if (repo) ofSession.set(x.id, nameOf(repo))
    else {
      // Outside a repository, it's where the rest of its group is, when that's one project, or else where it was made.
      const inGroup = new Set([...(x.groupId ? reposOf.get(x.groupId) ?? [] : [])].map(nameOf))
      ofSession.set(x.id, inGroup.size === 1 ? [...inGroup][0] : known(x.project) ?? known(x.groupId ? groupById.get(x.groupId)?.project : undefined))
    }
  }
  const ofGroup = (id: string) => {
    const placed = new Set(sessions.filter(x => x.groupId === id).map(x => ofSession.get(x.id)))
    const inList = list.map(p => p.name).filter(name => placed.has(name))
    const remembered = known(groupById.get(id)?.project)
    return inList.length ? inList : remembered ? [remembered] : []
  }

  return {
    list,
    session: id => (id ? ofSession.get(id) : undefined),
    group: ofGroup,
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

/**
 * Going to something the sidebar doesn't list changes the project to the one it's in, or to all of
 * them when it spans several, so what's on screen is always in the sidebar.
 */
export function followView(ids: string[]) {
  const projects = currentProjects()
  const project = selectedProject(projects)
  if (!project) return
  const { sessions } = getState()
  // Listed as the sidebar lists them: in a group by the group's projects, otherwise by its own.
  const placed = ids.flatMap(id => sessions.filter(x => x.id === id))
    .map(x => (x.groupId ? projects.group(x.groupId) : [projects.session(x.id)].filter((n): n is string => !!n)))
  const listedIn = (name: string) => placed.every(names => !names.length || names.includes(name))
  if (listedIn(project.name)) return
  chooseProject(projects.list.find(p => listedIn(p.name))?.name ?? '')
}

/** Where a new session starts while a project is chosen: the folder of its newest session there. */
export function projectFolder() {
  const projects = currentProjects()
  const project = selectedProject(projects)
  if (!project) return undefined
  return getState().sessions.filter(x => !x.demo && projects.session(x.id) === project.name).at(-1)?.cwd
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

/**
 * What the sidebar lists: the chosen project's groups and sessions, and those in no project, which are
 * listed in every one. Not `ready` until every session's repository and the project names are known.
 */
export function useSidebarScope() {
  const projects = useProjects()
  const name = useChosen()
  const sessions = useStore(s => s.sessions)
  const repoAt = useRepos()
  const named = useStatus(s => !!s.settings)
  const placedAll = named && sessions.every(x => x.demo || x.cwd in repoAt)
  useEffect(() => void (placedAll && markPlaced()), [placedAll])
  const ready = useSyncExternalStore(
    listener => {
      placedListeners.add(listener)
      return () => placedListeners.delete(listener)
    },
    () => placedOnce,
  )
  const project = chosenIn(projects, name)
  return useMemo(() => {
    const is = (names: string[]) => !project || !names.length || names.includes(project.name)
    return {
      projects,
      project,
      ready,
      /** A project is chosen, though until `ready` it can't be told which; the list waits for it. */
      waiting: !ready && !!name,
      session: (x: Pick<Session, 'id'>) => is([projects.session(x.id)].filter((n): n is string => !!n)),
      group: (g: Pick<Group, 'id'>) => is(projects.group(g.id)),
    }
  }, [projects, project, ready, name])
}

// Placed once, a session that moves to a folder not yet asked about keeps its place meanwhile rather
// than the whole list waiting on git; and a lookup that fails gives up waiting after a few seconds.
let placedOnce = false
const placedListeners = new Set<() => void>()
function markPlaced() {
  if (placedOnce) return
  placedOnce = true
  placedListeners.forEach(l => l())
}
setTimeout(markPlaced, 5000)

setProjectForNew(() => selectedProject()?.name)

/**
 * Learns what places sessions, once for the window, and keeps a group's project up to date with where
 * its sessions are, so it stays there once it's emptied.
 */
export function useRememberProjects() {
  const projects = useProjects()
  const groups = useStore(s => s.groups)
  const sessions = useStore(s => s.sessions)
  const named = useStatus(s => !!s.settings)
  // The Today page's collecting learns these minutes late; the sidebar needs a new session placed now.
  useEffect(() => void learnRepos(sessions.filter(x => !x.demo).map(x => x.cwd)), [sessions])
  useEffect(() => void (named || loadSettings()), [named])
  // A session on screen whose place changes under it (its repository learned after it opened) is
  // followed; one on screen when the user chose another project is left alone.
  const view = useStore(s => s.view)
  const shownIn = useRef<Record<string, string | undefined>>({})
  useEffect(() => {
    const ids = viewIds(getState(), view)
    const now = Object.fromEntries(ids.map(id => [id, projects.session(id)]))
    const moved = ids.filter(id => id in shownIn.current && shownIn.current[id] !== now[id])
    shownIn.current = now
    if (moved.length) followView(moved)
  }, [projects, view])
  useEffect(() => {
    // Before then, a session in a repository not yet known reads as being where it was made.
    if (!placedOnce) return
    for (const g of groups) {
      const placed = new Set(sessions.filter(x => x.groupId === g.id && !x.demo).map(x => projects.session(x.id)))
      const [only] = placed
      if (placed.size === 1 && only && only !== g.project) updateGroup(g.id, { project: only })
    }
  }, [projects, groups, sessions])
}

// ── How a project looks on the rail ───────────────────────────────────────────────────────────

export type ProjectIcon = { kind: 'lucide'; name: string } | { kind: 'favicon'; url: string } | { kind: 'initials'; text: string }

const initialsOf = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

/**
 * A project's color and icon: what was chosen for it, or else a color by its place and its repository's
 * favicon, or its initials. `favicons` is by project name.
 */
export function projectLook(name: string, index: number, looks: Record<string, ProjectLook>, favicons: Record<string, string>) {
  const look = looks[name] ?? {}
  const color = GROUP_COLORS[(look.color ?? index) % GROUP_COLORS.length].color
  const favicon = favicons[name]
  const icon: ProjectIcon = look.icon && SESSION_ICONS[look.icon] ? { kind: 'lucide', name: look.icon }
    : favicon && look.icon !== 'initials' ? { kind: 'favicon', url: favicon }
    : { kind: 'initials', text: initialsOf(name) }
  return { color, icon, favicon, light: isLight(color) }
}

// Lighter colors (yellow, mint, orange, green, teal) take dark text; WCAG's relative luminance.
function isLight(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4
}

export type ProjectLooks = Record<string, ReturnType<typeof projectLook>>

let favicons: Record<string, string | null> = {}
const faviconListeners = new Set<() => void>()
// By repository, how many of its folders main had to look in when last asked.
const askedFavicons = new Map<string, number>()

/** Asks main for the favicons of repositories without one, again once more of their folders are known. */
async function learnFavicons(repos: string[]) {
  const byRepo = new Map<string, string[]>()
  for (const [folder, repo] of Object.entries(repos.length ? knownRepos() : {})) {
    if (repo) byRepo.set(repo.toLowerCase(), [...(byRepo.get(repo.toLowerCase()) ?? []), folder])
  }
  const folders: Record<string, string[]> = {}
  for (const repo of repos) {
    const of = byRepo.get(repo.toLowerCase()) ?? []
    if (!favicons[repo] && of.length > (askedFavicons.get(repo) ?? 0)) folders[repo] = of
  }
  if (!Object.keys(folders).length) return
  Object.entries(folders).forEach(([repo, of]) => askedFavicons.set(repo, of.length))
  const found = await window.deck.projectFavicons(folders).catch(() => ({} as Record<string, string | null>))
  const cropped = await Promise.all(Object.entries(found).map(async ([repo, url]) => [repo, url && (await cropToContent(url))] as const))
  favicons = { ...favicons, ...Object.fromEntries(cropped) }
  faviconListeners.forEach(l => l())
}

/**
 * The icon cut to what's drawn in it, as a square, so it fills its tile: an app icon keeps a tenth of
 * its canvas clear, and a soft shadow (faint pixels) isn't counted as drawn.
 */
async function cropToContent(url: string, size = 128): Promise<string> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return url
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const scale = size / Math.max(image.naturalWidth || size, image.naturalHeight || size)
  const w = (image.naturalWidth || size) * scale, h = (image.naturalHeight || size) * scale
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)
  const { data } = ctx.getImageData(0, 0, size, size)
  let [left, top, right, bottom] = [size, size, -1, -1]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] < 128) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return url
  const side = Math.max(right - left, bottom - top) + 1
  if (side >= size - 2) return url
  const cx = (left + right + 1) / 2, cy = (top + bottom + 1) / 2
  const out = document.createElement('canvas')
  out.width = out.height = size
  out.getContext('2d')!.drawImage(canvas, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size)
  return out.toDataURL('image/png')
}

/** Each project's look, by name, in `projects.list` order. */
export function useProjectLooks(projects: Projects) {
  const looks = useStatus(s => s.settings?.projectLooks)
  const repoAt = useRepos()
  const known = useSyncExternalStore(
    listener => {
      faviconListeners.add(listener)
      return () => faviconListeners.delete(listener)
    },
    () => favicons,
  )
  useEffect(() => void learnFavicons(projects.list.flatMap(p => p.repos)), [projects, repoAt])
  return useMemo(() => looksOf(projects, looks ?? {}, known), [projects, looks, known])
}

function looksOf(projects: Projects, looks: Record<string, ProjectLook>, known: Record<string, string | null>) {
  const byProject = Object.fromEntries(projects.list.flatMap(p => {
    const url = p.repos.map(r => known[r]).find(Boolean)
    return url ? [[p.name, url]] : []
  }))
  return Object.fromEntries(projects.list.map((p, i) => [p.name, projectLook(p.name, i, looks, byProject)])) as ProjectLooks
}

/** Each project's look as the rail shows it now, for code outside React. */
export function currentLooks(projects = currentProjects()) {
  learnFavicons(projects.list.flatMap(p => p.repos))
  return looksOf(projects, statusState().settings?.projectLooks ?? {}, favicons)
}
