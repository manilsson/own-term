import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Editable } from './Editable'
import { useStore } from './store'

// The tokens Claude can ask for (request_secret). Values go to main and never come back to the window.

export function SecretsSettings() {
  const [tokens, setTokens] = useState<SecretEntry[]>([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const refresh = () => window.deck.secrets.list().then(list => setTokens([...list].sort((a, b) => a.name.localeCompare(b.name))))
  useEffect(() => void refresh(), [])
  const act = async (result: Promise<{ error?: string }>) => {
    const { error } = await result
    setError(error ?? '')
    await refresh()
    return error === undefined
  }

  return (
    <div className="settings-section">
      <h3>Tokens for Claude</h3>
      <p className="field-note secrets-note">
        Claude can ask for one with request_secret; you pick which, and it gets a file to read it from for that session. Encrypted with your Mac’s keychain and never shown here.
      </p>
      {tokens.map(t => <TokenRow key={t.name} token={t} act={act} />)}
      {adding ? (
        <TokenForm
          withName
          submit="Add"
          onCancel={() => (setAdding(false), setError(''))}
          onSubmit={async (name, value) => (await act(window.deck.secrets.add(name, value))) && setAdding(false)}
        />
      ) : (
        <div className="secret-actions">
          <button type="button" className="push-button" onClick={() => setAdding(true)}>Add Token…</button>
        </div>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  )
}

type Act = (result: Promise<{ error?: string }>) => Promise<boolean>

function TokenRow({ token, act }: { token: SecretEntry; act: Act }) {
  const [replacing, setReplacing] = useState(false)
  const sessions = useStore(s => s.sessions)
  const holders = token.holders.map(id => ({ id, name: sessions.find(s => s.id === id)?.name ?? id }))
  const remove = async () => {
    const sure = await window.deck.confirm({
      message: `Delete “${token.name}”?`,
      detail: token.holders.length ? 'Sessions holding it lose it too.' : undefined,
      confirm: 'Delete',
    })
    if (sure) await act(window.deck.secrets.remove(token.name))
  }

  return (
    <div className="secret-row">
      <div className="secret-head">
        <KeyRound size={13} strokeWidth={2} />
        <span className="secret-name">
          <Editable value={token.name} onChange={name => name !== token.name && act(window.deck.secrets.rename(token.name, name))} />
        </span>
        <button type="button" className="push-button" onClick={() => setReplacing(r => !r)}>Replace…</button>
        <button type="button" className="push-button" onClick={remove}>Delete</button>
      </div>
      <div className="field-note secret-detail">
        {holders.length ? 'Given to ' : `Added ${new Date(token.createdAt).toLocaleDateString()}`}
        {holders.map((h, i) => (
          <span key={h.id}>
            {i > 0 && ', '}
            {h.name} <button type="button" className="inline-link" onClick={() => act(window.deck.secrets.revoke(h.id, token.name))}>Revoke</button>
          </span>
        ))}
      </div>
      {replacing && (
        <TokenForm
          submit="Replace"
          onCancel={() => setReplacing(false)}
          onSubmit={async (_name, value) => (await act(window.deck.secrets.replace(token.name, value))) && setReplacing(false)}
        />
      )}
    </div>
  )
}

function TokenForm({ withName, submit, onSubmit, onCancel }: {
  withName?: boolean
  submit: string
  onSubmit: (name: string, value: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const ready = (!withName || name.trim()) && value
  return (
    <form
      className="secret-form"
      onSubmit={e => {
        e.preventDefault()
        if (ready) onSubmit(name.trim(), value)
      }}
      onKeyDown={e => {
        if (e.key !== 'Escape') return
        // Escape here closes the form, not the whole sheet.
        e.stopPropagation()
        onCancel()
      }}
    >
      {withName && <input className="text-field" placeholder="Name" value={name} autoFocus spellCheck={false} autoComplete="off" onChange={e => setName(e.target.value)} />}
      <input className="text-field" type="password" placeholder="Token" value={value} autoFocus={!withName} spellCheck={false} autoComplete="off" onChange={e => setValue(e.target.value)} />
      <button type="button" className="push-button" onClick={onCancel}>Cancel</button>
      <button type="submit" className="push-button default" disabled={!ready}>{submit}</button>
    </form>
  )
}
