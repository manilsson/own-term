import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SESSION_ICONS } from './sessionIcons'

const NAMES = Object.keys(SESSION_ICONS)

/** A searchable grid of the session icons, beside `anchor`; Escape or a click elsewhere closes it. */
export function IconPicker({ anchor, chosen, onPick, onClose }: {
  anchor: DOMRect
  chosen?: string
  onPick: (name: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const shown = q ? NAMES.filter(n => n.includes(q)) : NAMES

  useEffect(() => {
    const away = (e: MouseEvent) => !card.current?.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', away, true)
    return () => window.removeEventListener('mousedown', away, true)
  }, [onClose])

  // Beside the tile, kept inside the window.
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 340))
  return createPortal(
    <div className="icon-picker" ref={card} style={{ top, left: anchor.right + 8 }} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <label className="search-field">
        <input
          autoFocus
          placeholder="Search icons"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && shown[0] && onPick(shown[0])}
        />
      </label>
      <div className="icon-grid">
        {shown.map(name => {
          const Icon = SESSION_ICONS[name]
          return (
            <button key={name} className={`icon-choice ${name === chosen ? 'on' : ''}`} title={name} onClick={() => onPick(name)}>
              <Icon size={16} strokeWidth={1.75} />
            </button>
          )
        })}
        {!shown.length && <p className="empty">No icon matches.</p>}
      </div>
    </div>,
    document.body,
  )
}
