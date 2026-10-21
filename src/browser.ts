import { useSyncExternalStore } from 'react'

// Each session's headless browser, as the main process shows it in Own Term (electron/browser.cjs).

const states = new Map<string, BrowserState>(Object.entries(window.deck.browserStates()))
const listeners = new Set<() => void>()
window.deck.onBrowserState((id, state) => {
  // A browser that has just started in Own Term opens its window, closed before or not.
  if (state && !state.windowed && !states.get(id) && placements[id]?.closed) setPlacement(id, { closed: false })
  if (state) states.set(id, state)
  else states.delete(id)
  listeners.forEach(listener => listener())
})

// A blank page is no page to show: chrome-devtools-mcp won't close a browser's last page, so an agent
// asked to close the browser opens a blank one, and a browser just started shows one too.
export const isBlank = (state: BrowserState) => !state.url || state.url === 'about:blank'

/** The page a session's browser shows, or undefined while it has none running headless. */
export function useBrowser(id: string) {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => states.get(id))
}

// Whether the sign-in Chrome is open (electron/browser.cjs → signIn).
let signing = window.deck.signingIn()
const signingListeners = new Set<() => void>()
window.deck.onSigningIn(value => {
  signing = value
  signingListeners.forEach(listener => listener())
})

export function useSigningIn() {
  return useSyncExternalStore(listener => {
    signingListeners.add(listener)
    return () => signingListeners.delete(listener)
  }, () => signing)
}

// A page that asks you to sign in, where the bar spells out Sign In in Chrome.
export const isSignInPage = (url: string) =>
  /^https:\/\/(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)\//.test(url) ||
  /^https?:\/\/[^?#]*\/(log-?in|sign-?in|auth|authorize|oauth2?)\b/i.test(url)

// Frames go to the view showing that session; with none, they're let through so the stream goes on.
type Viewer = (frame: Uint8Array, page: { width: number; height: number }) => void
const viewers = new Map<string, Viewer>()
window.deck.onBrowserFrame((id, frame, page) => {
  const draw = viewers.get(id)
  if (draw) draw(frame, page)
  else window.deck.browserFrameDrawn(id)
})

export function onFrames(id: string, draw: Viewer) {
  viewers.set(id, draw)
  return () => {
    if (viewers.get(id) === draw) viewers.delete(id)
  }
}

// Each session's floating browser window: where it sits in its pane, as shares of the pane so it keeps
// its place as the pane changes size, and whether it fills the pane or is closed.
export interface Placement {
  x: number
  y: number
  /** Its width; its height follows from the page's shape, so no part of it is empty. */
  w: number
  /** The page's width over its height, as last shown. */
  aspect?: number
  expanded?: boolean
  closed?: boolean
}

const PLACEMENTS_KEY = 'deckterm.browserWindows'
const DEFAULT_PLACEMENT: Placement = { x: 0.4, y: 0.06, w: 0.56 }
const placements: Record<string, Placement> = (() => {
  try {
    return JSON.parse(localStorage.getItem(PLACEMENTS_KEY) ?? '{}')
  } catch {
    return {}
  }
})()
const placementListeners = new Set<() => void>()

export function usePlacement(id: string) {
  return useSyncExternalStore(listener => {
    placementListeners.add(listener)
    return () => placementListeners.delete(listener)
  }, () => placements[id] ?? DEFAULT_PLACEMENT)
}

export function setPlacement(id: string, patch: Partial<Placement>) {
  placements[id] = { ...(placements[id] ?? DEFAULT_PLACEMENT), ...patch }
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements))
  } catch {}
  placementListeners.forEach(listener => listener())
}
