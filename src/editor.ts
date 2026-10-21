import { useSyncExternalStore } from 'react'

// The editor files open in (Own Term → Open Files With); main keeps the choice, and says when it changes.
let state = window.deck.editors()
const listeners = new Set<() => void>()
window.deck.onEditor(next => {
  state = next
  listeners.forEach(l => l())
})

export const editorState = () => state

export function useEditor() {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => state.current)
}
