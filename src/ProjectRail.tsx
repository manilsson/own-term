import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LayoutGrid, Settings } from 'lucide-react'
import { GROUP_COLORS, useStore } from './store'
import { chooseProject, currentProjects, useProjectLooks, useSidebarScope, type ProjectIcon, type ProjectLooks } from './projects'
import { saveProjectLooks, statusState } from './status'
import { SESSION_ICONS } from './sessionIcons'
import { swatch } from './menus'
import { IconPicker } from './IconPicker'

// ── Choosing an icon: one picker, opened from a tile's menu or the sidebar title's ────────────────

let picking: { project: string; anchor: DOMRect } | null = null
const pickListeners = new Set<() => void>()

export function openIconPicker(project: string, anchor: DOMRect) {
  picking = { project, anchor }
  pickListeners.forEach(l => l())
}

function closeIconPicker() {
  picking = null
  pickListeners.forEach(l => l())
}

const usePicking = () => useSyncExternalStore(
  listener => {
    pickListeners.add(listener)
    return () => pickListeners.delete(listener)
  },
  () => picking,
)

function changeLook(project: string, patch: ProjectLook) {
  const looks = statusState().settings?.projectLooks ?? {}
  const next = { ...looks[project], ...patch }
  // An icon left to its default isn't stored, so a favicon found later still shows.
  if (next.icon === undefined) delete next.icon
  saveProjectLooks({ ...looks, [project]: next })
}

/** A project's menu, from its tile or the sidebar title: its color and icon, and naming projects. */
export async function projectMenu(project: string, shown: ProjectLooks[string], anchor: DOMRect, onNameProjects: () => void) {
  const index = currentProjects().list.findIndex(p => p.name === project)
  const color = statusState().settings?.projectLooks[project]?.color ?? index % GROUP_COLORS.length
  const icon = shown.icon.kind
  const hasFavicon = !!shown.favicon
  const choice = await window.deck.popupMenu([
    { label: 'Color', submenu: GROUP_COLORS.map((c, i) => ({ id: `color:${i}`, label: c.name, icon: swatch(c.color), checked: color === i })) },
    {
      label: 'Icon',
      submenu: [
        ...(hasFavicon ? [{ id: 'icon:favicon', label: 'Favicon', checked: icon === 'favicon' }] : []),
        { id: 'icon:initials', label: 'Initials', checked: icon === 'initials' },
        { type: 'separator' as const },
        { id: 'icon:choose', label: 'Choose Icon…', checked: icon === 'lucide' },
      ],
    },
    { type: 'separator' },
    { id: 'name', label: 'Name Projects…' },
  ])
  if (choice?.startsWith('color:')) changeLook(project, { color: Number(choice.slice(6)) })
  if (choice === 'icon:favicon') changeLook(project, { icon: undefined })
  if (choice === 'icon:initials') changeLook(project, { icon: 'initials' })
  if (choice === 'icon:choose') openIconPicker(project, anchor)
  if (choice === 'name') onNameProjects()
}

// ── The rail ──────────────────────────────────────────────────────────────────────────────────

/** The rail's width with its margin, which the sidebar's slot makes room for; as in `.project-rail`. */
export const RAIL_WIDTH = 52

const RAIL_KEY = 'deckterm.railShown'

/**
 * Whether the rail shows: with two projects or more, as the Today page's tabs. Until the projects are
 * known it's as it was last time, so the panes aren't narrowed a moment after the window opens.
 */
export function useRailShown() {
  const { projects, ready } = useSidebarScope()
  const shown = projects.list.length > 1
  useEffect(() => {
    try {
      if (ready) localStorage.setItem(RAIL_KEY, shown ? '1' : '0')
    } catch {}
  }, [ready, shown])
  if (ready) return shown
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

/** Projects as tiles beside the sidebar, Slack's workspaces: choosing one narrows the sidebar and the Today page. */
export function ProjectRail({ onNameProjects }: { onNameProjects: () => void }) {
  const { projects, project } = useSidebarScope()
  const looks = useProjectLooks(projects)
  const waitingIds = useStore(s => Object.keys(s.needsSince).join(' '))
  const pick = usePicking()
  const tip = useTip()
  const shown = useRailShown()
  if (!shown) return null
  const waiting = new Map<string, number>()
  for (const id of waitingIds.split(' ').filter(Boolean)) {
    const name = projects.session(id)
    if (name) waiting.set(name, (waiting.get(name) ?? 0) + 1)
  }

  return (
    <nav className="project-rail" aria-label="Projects">
      <button
        className={`project-tile all ${project ? '' : 'on'}`}
        data-project=""
        aria-label="All Projects"
        {...tip.on('All Projects', '0')}
        onClick={() => chooseProject('')}
      >
        <LayoutGrid size={16} strokeWidth={1.9} />
      </button>
      {projects.list.map((p, i) => {
        const look = looks[p.name]
        const count = waiting.get(p.name)
        return (
          <button
            key={p.name}
            className={`project-tile ${project?.name === p.name ? 'on' : ''} ${look.icon.kind} ${look.light ? 'light-fill' : ''}`}
            data-project={p.name}
            style={{ '--project-color': look.color } as CSSProperties}
            aria-label={p.name}
            {...tip.on(p.name, i < 9 ? String(i + 1) : undefined)}
            onClick={() => chooseProject(p.name)}
            onContextMenu={e => {
              e.preventDefault()
              projectMenu(p.name, look, e.currentTarget.getBoundingClientRect(), onNameProjects)
            }}
          >
            <TileIcon icon={look.icon} />
            {!!count && <span className="project-badge">{count}</span>}
          </button>
        )
      })}
      <button className="project-rail-settings" aria-label="Name Projects…" {...tip.on('Name Projects…')} onClick={onNameProjects}>
        <Settings size={16} strokeWidth={1.75} />
      </button>
      {tip.shown && <RailTip {...tip.shown} />}
      {pick && (
        <IconPicker
          anchor={pick.anchor}
          chosen={statusState().settings?.projectLooks[pick.project]?.icon}
          onPick={name => {
            changeLook(pick.project, { icon: name })
            closeIconPicker()
          }}
          onClose={closeIconPicker}
        />
      )}
    </nav>
  )
}

type Tip = { label: string; shortcut?: string; row: DOMRect }

/** Slack's tooltip for a tile: after a moment, then at once from one tile to the next while it's up. */
function useTip() {
  const [shown, setShown] = useState<Tip | null>(null)
  const timer = useRef(0)
  const open = useRef(false)
  const on = (label: string, shortcut?: string) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      const next = { label, shortcut, row: e.currentTarget.getBoundingClientRect() }
      window.clearTimeout(timer.current)
      if (open.current) setShown(next)
      else timer.current = window.setTimeout(() => {
        open.current = true
        setShown(next)
      }, 350)
    },
    onMouseLeave: () => {
      window.clearTimeout(timer.current)
      // A short grace, so passing between tiles keeps it up.
      timer.current = window.setTimeout(() => {
        open.current = false
        setShown(null)
      }, 120)
    },
    onMouseDown: () => {
      window.clearTimeout(timer.current)
      open.current = false
      setShown(null)
    },
  })
  return { shown, on }
}

function RailTip({ label, shortcut, row }: Tip) {
  return createPortal(
    <div className="rail-tip" role="tooltip" style={{ top: row.top + row.height / 2, left: row.right + 10 }}>
      <span>{label}</span>
      {shortcut && <span className="rail-tip-keys"><kbd>⌃</kbd><kbd>⌘</kbd><kbd>{shortcut}</kbd></span>}
    </div>,
    document.body,
  )
}

function TileIcon({ icon }: { icon: ProjectIcon }) {
  if (icon.kind === 'favicon') return <img src={icon.url} alt="" draggable={false} />
  if (icon.kind === 'initials') return <span className="project-initials">{icon.text}</span>
  const Icon = SESSION_ICONS[icon.name]
  return <Icon size={17} strokeWidth={2} />
}

/** The sidebar's title: the chosen project, whose menu changes how it looks. */
export function ProjectTitle({ onNameProjects }: { onNameProjects: () => void }) {
  const { projects, project } = useSidebarScope()
  const looks = useProjectLooks(projects)
  if (projects.list.length < 2) return null
  return (
    <button
      className="project-title"
      onClick={e => {
        const anchor = e.currentTarget.getBoundingClientRect()
        if (project) projectMenu(project.name, looks[project.name], anchor, onNameProjects)
        else onNameProjects()
      }}
      title={project ? `How ${project.name} looks, and naming projects` : 'Name Projects…'}
    >
      <span className="project-title-name">{project?.name ?? 'All Projects'}</span>
      {project && <ChevronDown size={12} strokeWidth={2.2} />}
    </button>
  )
}
