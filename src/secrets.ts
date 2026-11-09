import { useSyncExternalStore } from 'react'
import { getState, setActivity, setStatus, subscribe } from './store'
import { needsYou } from './claude'
import { focus } from './terminals'

// Claude's request_secret, open on its pane until the user picks a token or declines. Only the name
// goes back; main writes the grant (electron/tools.cjs, secrets.cjs).

const WAIT_MS = 300_000

type Request = { why: string; answer: (picked?: string) => void }
const requests = new Map<string, Request>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())

export function requestSecret(sessionId: string, why: string): Promise<{ picked?: string }> {
  return new Promise(resolve => {
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
    const request: Request = { why, answer: done }
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

export function useSecretRequest(sessionId: string): { why: string } | undefined {
  return useSyncExternalStore(
    listener => (listeners.add(listener), () => listeners.delete(listener)),
    () => requests.get(sessionId),
  )
}
