import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MessageSquare, Plus } from 'lucide-react'
import { GROUP_COLORS, useStore, type Snippet } from './store'
import { SESSION_ICONS } from './sessionIcons'
import { IconPicker } from './IconPicker'
import { removeSnippet, saveSnippet, snippetColor, typeSnippet } from './prompts'

/** The icon on its tile, drawn in the prompt's color over a darker shade of it. */
function PromptTile({ icon, color, size = 12 }: { icon?: string; color?: string; size?: number }) {
  const Icon = (icon && SESSION_ICONS[icon]) || MessageSquare
  return (
    <span className="prompt-tile" style={{ '--prompt-color': color } as CSSProperties}>
      <Icon size={size} strokeWidth={2} />
    </span>
  )
}

type Editing = { snippet?: Snippet; left: number; bottom: number }

/** The footer's saved prompts: click one to type it into the session on screen. */
export function PromptBar() {
  const snippets = useStore(s => s.snippets)
  // Not behind the Today, Reminders or a monitor's page, where the session typed into can't be seen.
  const target = useStore(s => (!s.page && s.sessions.some(x => x.id === s.active) ? s.active : null))
  const [editing, setEditing] = useState<Editing | null>(null)

  const openEditor = (el: HTMLElement, snippet?: Snippet) => {
    const rect = el.getBoundingClientRect()
    setEditing({ snippet, left: Math.max(12, Math.min(rect.left, window.innerWidth - 392)), bottom: window.innerHeight - rect.top + 8 })
  }

  return (
    <div className="snippets">
      {snippets.map(snippet => (
        <button
          key={snippet.id}
          className="snippet-chip"
          // aria-disabled, not disabled: a disabled button gets no right-click for Edit and Delete.
          aria-disabled={!target}
          title={snippet.text}
          onClick={() => target && typeSnippet(target, snippet.text)}
          onContextMenu={async e => {
            const el = e.currentTarget
            const choice = await window.deck.popupMenu([{ id: 'edit', label: 'Edit Prompt…' }, { id: 'delete', label: 'Delete Prompt' }])
            if (choice === 'edit') openEditor(el, snippet)
            if (choice === 'delete') removeSnippet(snippet)
          }}
        >
          {(snippet.icon || snippet.color !== undefined) && <PromptTile icon={snippet.icon} color={snippetColor(snippet)} />}
          <span className="snippet-label">{snippet.label}</span>
        </button>
      ))}
      <button
        className={`snippet-chip snippet-add ${snippets.length ? '' : 'labelled'}`}
        title="Save a prompt you write often"
        onClick={e => openEditor(e.currentTarget)}
      >
        <Plus size={12} strokeWidth={2.2} />
        {!snippets.length && 'Prompt'}
      </button>
      {editing && <PromptEditor editing={editing} close={() => setEditing(null)} />}
    </div>
  )
}

function PromptEditor({ editing, close }: { editing: Editing; close: () => void }) {
  const [label, setLabel] = useState(editing.snippet?.label ?? '')
  const [text, setText] = useState(editing.snippet?.text ?? '')
  const [icon, setIcon] = useState(editing.snippet?.icon)
  const [color, setColor] = useState(editing.snippet?.color)
  const [picking, setPicking] = useState<DOMRect | null>(null)
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => labelRef.current?.focus(), [])
  const valid = label.trim() && text.trim()

  return (
    <div className="snippet-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <form
        className="sheet snippet-editor"
        style={{ left: editing.left, bottom: editing.bottom }}
        onSubmit={e => {
          e.preventDefault()
          if (!valid) return
          saveSnippet(editing.snippet?.id, { label: label.trim(), text: text.trim(), icon: icon ?? null, color: color ?? null })
          close()
        }}
        // The icon picker is portalled but still bubbles here; its own Escape closes only it.
        onKeyDown={e => e.key === 'Escape' && !picking && close()}
      >
        <div className="prompt-look">
          <button
            type="button"
            className="prompt-icon-button"
            title="Choose an icon"
            onClick={e => setPicking(e.currentTarget.getBoundingClientRect())}
          >
            <PromptTile icon={icon} color={color === undefined ? undefined : GROUP_COLORS[color].color} size={16} />
          </button>
          <div className="prompt-swatches">
            {GROUP_COLORS.map((c, i) => (
              <button
                key={c.name}
                type="button"
                className={`prompt-swatch ${color === i ? 'on' : ''}`}
                style={{ background: c.color }}
                title={c.name}
                aria-label={c.name}
                onClick={() => setColor(color === i ? undefined : i)}
              />
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">Label</span>
          <input ref={labelRef} className="text-field" placeholder="Review PR" value={label} onChange={e => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Prompt</span>
          <textarea
            className="text-field note-field"
            rows={3}
            placeholder="What you’d type to Claude"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              // Return saves, as in the other sheets; Shift-Return makes a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
        </label>
        <div className="sheet-buttons">
          {icon && <button type="button" className="push-button sheet-button-start" onClick={() => setIcon(undefined)}>No Icon</button>}
          <button type="button" className="push-button" onClick={close}>Cancel</button>
          <button type="submit" className="push-button default" disabled={!valid}>{editing.snippet ? 'Save' : 'Add Prompt'}</button>
        </div>
      </form>
      {picking && (
        <IconPicker
          anchor={picking}
          chosen={icon}
          onPick={name => {
            setIcon(name)
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
