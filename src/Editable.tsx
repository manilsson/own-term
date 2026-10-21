import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { setState, useStore } from './store'

/** A name that turns into a text field on double-click, or when a menu's Rename asks for `renameKey`. */
export function Editable({ value, renameKey, onChange }: {
  value: string
  renameKey?: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  // What the field started with: the name can change underneath it (Claude naming the session), and
  // leaving the field untouched mustn't count as choosing the old name.
  const initial = useRef(value)
  const start = () => {
    cancelled.current = false
    initial.current = value
    setEditing(true)
  }
  const requested = useStore(s => !!renameKey && s.renaming === renameKey)
  useEffect(() => {
    if (!requested) return
    start()
    setState(() => ({ renaming: null }))
  }, [requested])

  const edit = (e: MouseEvent) => {
    e.stopPropagation()
    start()
  }
  if (!editing) {
    return (
      <span className="editable" onDoubleClick={edit}>
        {value}
      </span>
    )
  }
  return (
    <input
      className="inline-edit"
      autoFocus
      defaultValue={value}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onFocus={e => e.target.select()}
      onBlur={e => {
        const next = e.target.value.trim()
        // Unchanged from what it started with, or from what it was changed to meanwhile (the field
        // follows the name until it's typed in), means nothing was chosen.
        if (!cancelled.current && next && next !== initial.current && next !== value) onChange(next)
        setEditing(false)
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}
