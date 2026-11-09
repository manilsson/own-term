import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { answerSecret } from './secrets'
import { useStore } from './store'

// A Return meant for whatever had focus a moment ago mustn't hand over a token.
const SETTLE_MS = 600

// Claude asked for a token (request_secret): the user picks which, or pastes a new one. Values only
// ever go to main; the window lists names.

export function SecretPicker({ id, why }: { id: string; why: string }) {
  const [tokens, setTokens] = useState<SecretEntry[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const card = useRef<HTMLFormElement>(null)
  const shownAt = useRef(Date.now())
  const active = useStore(s => s.active === id)

  useEffect(() => {
    window.deck.secrets.list().then(list => {
      const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
      setTokens(sorted)
      setPicked(sorted[0]?.name ?? null)
      setAdding(!sorted.length)
    })
  }, [])
  // Focus comes only from its own pane, never from what you're typing elsewhere; after showing the
  // pane, which focuses its terminal a frame later.
  useEffect(() => {
    if (!tokens || !active) return
    const timer = setTimeout(() => {
      const at = document.activeElement
      const frame = card.current?.closest('.pane-frame')
      if (at && at !== document.body && !frame?.contains(at)) return
      if (card.current?.contains(at)) return
      const field = card.current?.querySelector<HTMLInputElement>('input')
      ;(adding && field ? field : card.current)?.focus({ preventScroll: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [tokens, adding, active])

  const grant = async () => {
    if (!adding) return picked && answerSecret(id, picked)
    const result = await window.deck.secrets.add(name.trim(), value)
    if (result.error !== undefined) return setError(result.error)
    answerSecret(id, name.trim())
  }

  if (!tokens) return null
  return (
    <div className="secret-picker-backdrop" onMouseDown={e => e.stopPropagation()}>
      <form
        className="secret-picker"
        tabIndex={-1}
        ref={card}
        onSubmit={e => {
          e.preventDefault()
          grant()
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') answerSecret(id)
          // Focus sits on the card itself here, which a form doesn't submit from.
          if (e.key === 'Enter' && !adding && e.target === e.currentTarget) {
            e.preventDefault()
            if (Date.now() - shownAt.current > SETTLE_MS) grant()
          }
          if (adding || !tokens.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          const at = tokens.findIndex(t => t.name === picked) + (e.key === 'ArrowDown' ? 1 : -1)
          setPicked(tokens[Math.min(Math.max(at, 0), tokens.length - 1)].name)
        }}
      >
        <h2><KeyRound size={15} strokeWidth={2} />Claude asks for a token</h2>
        {why && <p className="sheet-detail">“{why}”</p>}
        {!adding ? (
          <div className="secret-list" role="listbox">
            {tokens.map(t => (
              <button
                key={t.name}
                type="button"
                role="option"
                aria-selected={picked === t.name}
                className={`when-option ${picked === t.name ? 'on' : ''}`}
                onClick={() => setPicked(t.name)}
                onDoubleClick={() => answerSecret(id, t.name)}
              >
                {t.name}
              </button>
            ))}
          </div>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Name</span>
              <input className="text-field" value={name} placeholder="stripe-test" spellCheck={false} autoComplete="off" onChange={e => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Token</span>
              <input className="text-field" type="password" value={value} spellCheck={false} autoComplete="off" onChange={e => setValue(e.target.value)} />
              <small className="field-note">Saved encrypted for next time. Claude gets a file to read it from, never the token in its reply.</small>
            </label>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="sheet-buttons">
          {!adding && (
            <button type="button" className="push-button sheet-button-start" onClick={() => setAdding(true)}>Paste New…</button>
          )}
          {adding && tokens.length > 0 && (
            <button type="button" className="push-button sheet-button-start" onClick={() => (setAdding(false), setError(''))}>Saved Tokens</button>
          )}
          <button type="button" className="push-button" onClick={() => answerSecret(id)}>Decline</button>
          <button type="submit" className="push-button default" disabled={adding ? !name.trim() || !value : !picked}>Give to Claude</button>
        </div>
      </form>
    </div>
  )
}
