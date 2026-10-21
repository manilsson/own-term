import { getState, setState } from './store'
import { kill } from './terminals'
import { clearGroupLayouts, show } from './workspace'
import { DEMO_BROWSER, DEMO_GROUPS, DEMO_SCRIPTS, DEMO_SESSIONS, DEMO_TOAST, DEMO_VIEW } from './demo-data'

/** Gives demo sessions their scripted status and git info, which would otherwise come from hooks and git. */
function applyScripts() {
  // A demo session saved by an earlier version of the demo day has no script left to play.
  const stale = getState().sessions.filter(s => s.demo && !DEMO_SCRIPTS[s.demo])
  if (stale.length) setState(s => ({ sessions: s.sessions.filter(x => !stale.includes(x)) }))
  const demo = getState().sessions.filter(s => s.demo)
  if (demo.length === 0) return
  const now = Date.now()
  setState(s => {
    const status = { ...s.status }
    const git = { ...s.git }
    const needsSince = { ...s.needsSince }
    for (const session of demo) {
      const script = DEMO_SCRIPTS[session.demo!]
      status[session.id] = script.status
      git[session.id] = script.git
      if (script.waitingMinutes !== undefined) needsSince[session.id] = now - script.waitingMinutes * 60_000
    }
    return { status, git, needsSince }
  })
  // Browsers don't outlive the app, so the day's one opens again with the day.
  if (demo.some(s => s.id === DEMO_BROWSER)) void window.deck.demoBrowser(DEMO_BROWSER)
}

export function loadDemo() {
  // Panes come down before their sessions go, so no pane is ever left for a session that's gone.
  show(null)
  for (const session of getState().sessions) kill(session.id)
  clearGroupLayouts()
  setState(() => ({ groups: DEMO_GROUPS, sessions: DEMO_SESSIONS, view: null, status: {}, git: {}, needsSince: {}, titles: {} }))
  applyScripts()
  show(DEMO_VIEW)
  setState(() => ({
    toasts: [{ ...DEMO_TOAST, status: 'done', sticky: true }],
  }))
}

applyScripts()
