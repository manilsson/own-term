import { useSyncExternalStore } from 'react'
import { announce, getState, setActivity, setStatus, subscribe } from './store'
import { claudeRunning, needsYou } from './claude'
import { focus } from './terminals'
import { typeSnippet } from './prompts'
import { openSettings } from './SettingsPage'

// Claude's request_secret, open on its pane until the user picks a token or declines. Only the name
// goes back; main writes the grant (electron/tools.cjs, secrets.cjs).

const WAIT_MS = 300_000

type Request = { id: number; why: string; answer: (picked?: string) => void }
let requestCount = 0
const requests = new Map<string, Request>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())

export function requestSecret(sessionId: string, why: string): Promise<{ picked?: string }> {
  return new Promise(resolve => {
    if (!getState().sessions.some(s => s.id === sessionId)) return resolve({})
    const done = (picked?: string) => {
      if (requests.get(sessionId) !== request) return
      const typing = !!document.activeElement?.closest('.secret-picker')
      requests.delete(sessionId)
      clearTimeout(timer)
      unsubscribe()
      changed()
      // Claude is still mid-turn, waiting on the tool.
      if (getState().status[sessionId] === 'input') setStatus(sessionId, 'working')
      if (getState().activity[sessionId]?.text === asking) setActivity(sessionId, { text: undefined })
      // Typing goes back to the terminal it was taken from.
      if (typing) focus(sessionId)
      resolve(picked ? { picked } : {})
    }
    const asking = why ? `Claude asks for a token: ${why}` : 'Claude asks for a token'
    const request: Request = { id: ++requestCount, why, answer: done }
    const timer = setTimeout(() => done(), WAIT_MS)
    const unsubscribe = subscribe(() => getState().sessions.some(s => s.id === sessionId) || done())
    requests.set(sessionId, request)
    changed()
    needsYou(sessionId, 'input', asking)
  })
}

export function answerSecret(sessionId: string, picked?: string) {
  requests.get(sessionId)?.answer(picked)
}

export function useSecretRequest(sessionId: string): { id: number; why: string } | undefined {
  return useSyncExternalStore(
    listener => (listeners.add(listener), () => listeners.delete(listener)),
    () => requests.get(sessionId),
  )
}

// The saved tokens and who holds them, kept current by main's word after every change.
let tokens: SecretEntry[] = []
const tokenListeners = new Set<() => void>()
const refreshTokens = () => window.deck.secrets.list().then(list => {
  tokens = [...list].sort((a, b) => a.name.localeCompare(b.name))
  tokenListeners.forEach(l => l())
})
window.deck.secrets.onChange(refreshTokens)
refreshTokens()

export function useTokens(): SecretEntry[] {
  return useSyncExternalStore(listener => (tokenListeners.add(listener), () => tokenListeners.delete(listener)), () => tokens)
}

const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

/**
 * Gives a session a token before Claude asks, and types where it is into the session, unsent: a
 * sentence for Claude, or just the command substitution in a plain shell.
 */
export async function giveToken(sessionId: string, name: string) {
  // Typed into a question it would answer it, so nothing is given that couldn't be said.
  if (getState().status[sessionId] === 'input') return announce('It’s waiting for an answer; give the token once it’s answered')
  const { path, error } = await window.deck.secrets.grant(sessionId, name)
  if (!path) return announce(error ?? 'The token couldn’t be given')
  const file = shellQuote(path)
  typeSnippet(sessionId, claudeRunning(sessionId)
    ? `Use the token "${name}" from ${file}: read it only as $(cat ${file}) inside a command, and never print it. `
    : `$(cat ${file})`)
}

export function revokeToken(sessionId: string, name: string) {
  window.deck.secrets.revoke(sessionId, name)
}

/** The Give Token menu: every saved token, those the session holds ticked, and a way to add one. */
export function tokenMenuItems(sessionId: string): MenuItem[] {
  return [
    ...tokens.map(t => ({ id: `token:${t.name}`, label: t.name, checked: t.holders.includes(sessionId) })),
    ...(tokens.length ? [{ type: 'separator' as const }] : []),
    { id: 'token-settings', label: 'Add a Token in Settings…' },
  ]
}

export function applyTokenChoice(sessionId: string, choice: string | null) {
  if (choice === 'token-settings') openSettings('tokens')
  if (choice?.startsWith('token:')) giveToken(sessionId, choice.slice(6))
}
