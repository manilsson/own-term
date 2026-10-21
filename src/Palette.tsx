import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CornerDownLeft, Folder, Search, Zap } from 'lucide-react'
import { groupColor, orderedSessions, useStore } from './store'
import { StatusIcon } from './StatusIcon'
import { openSession, showBeside, showGroup } from './workspace'

export interface PaletteAction {
  title: string
  shortcut?: string
  run: () => void
}

interface Item {
  key: string
  title: string
  subtitle?: string
  icon: ReactNode
  shortcut?: string
  /** `beside` is ⌘↩, which puts a session next to what's on screen instead of showing it alone. */
  run: (beside: boolean) => void
}

/**
 * Scores `text` against `query` as a subsequence, ranking matches at word starts and in runs
 * higher; -1 when the query's letters don't all appear in order.
 */
function score(query: string, text: string) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let total = 0
  let at = -1
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1)
    if (next < 0) return -1
    total += next === at + 1 ? 3 : next === 0 || /[\s/·-]/.test(t[next - 1]) ? 2 : 0
    at = next
  }
  return total - t.length / 100
}

/** Go to any session or group, or run any action, by typing part of its name. */
export function Palette({ actions, onClose }: { actions: PaletteAction[]; onClose: () => void }) {
  const groups = useStore(s => s.groups)
  const sessions = useStore(s => s.sessions)
  const git = useStore(s => s.git)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // Typing always goes to the palette while it's open, even after the window loses focus and gets it back.
  useEffect(() => {
    const refocus = () => input.current?.focus()
    window.addEventListener('focus', refocus)
    return () => window.removeEventListener('focus', refocus)
  }, [])

  const items = useMemo(() => {
    const all: Item[] = [
      ...orderedSessions({ groups, sessions }).map(s => ({
        key: s.id,
        title: s.name,
        subtitle: [groups.find(g => g.id === s.groupId)?.name, git[s.id]?.branch].filter(Boolean).join(' · '),
        icon: <StatusIcon session={s} />,
        run: (beside: boolean) => (beside ? showBeside(s.id) : openSession(s.id)),
      })),
      ...groups.map(g => ({
        key: g.id,
        title: g.name,
        subtitle: 'Group',
        icon: <Folder size={16} strokeWidth={1.75} color={groupColor(g)} fill={groupColor(g)} fillOpacity={0.35} />,
        run: () => showGroup(g.id),
      })),
      ...actions.map(a => ({
        key: a.title,
        title: a.title,
        icon: <Zap size={15} strokeWidth={1.75} />,
        shortcut: a.shortcut,
        run: a.run,
      })),
    ]
    if (!query.trim()) return all
    return all
      .map(item => ({ item, score: score(query.trim(), `${item.title} ${item.subtitle ?? ''}`) }))
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.item)
  }, [query, groups, sessions, git, actions])

  const pick = (item: Item | undefined, beside: boolean) => {
    if (!item) return
    onClose()
    item.run(beside)
  }

  const move = (delta: number) => {
    if (!items.length) return
    const next = (index + delta + items.length) % items.length
    setIndex(next)
    list.current?.children[next]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="palette-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <label className="palette-field">
          <Search size={18} strokeWidth={1.8} />
          <input
            ref={input}
            autoFocus
            placeholder="Go to a session or group, or run an action"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') move(1)
              if (e.key === 'ArrowUp') move(-1)
              if (e.key === 'Enter') pick(items[index], e.metaKey)
              if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) e.preventDefault()
            }}
          />
        </label>
        <div className="palette-list" ref={list}>
          {items.map((item, i) => (
            <div
              key={item.key}
              className={`palette-item ${i === index ? 'current' : ''}`}
              onMouseMove={() => setIndex(i)}
              onClick={e => pick(item, e.metaKey)}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-title">{item.title}</span>
              {item.subtitle && <span className="palette-subtitle">{item.subtitle}</span>}
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {i === index && !item.shortcut && <CornerDownLeft size={13} strokeWidth={2} className="palette-enter" />}
            </div>
          ))}
          {items.length === 0 && <p className="palette-empty">Nothing matches “{query}”.</p>}
        </div>
        <div className="palette-hints">
          <span><kbd>↑↓</kbd> Move</span>
          <span><kbd>↩</kbd> Open</span>
          <span><kbd>⌘↩</kbd> Show beside</span>
          <span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
