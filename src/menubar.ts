import { getState, orderedSessions, subscribe } from './store'
import { answerPermission, claudeRunning, hasPermission, promptClaude } from './claude'
import { focusSession } from './workspace'

// The menu bar (electron/menubar.cjs) shows what this window's sessions are doing; this sends it a
// summary whenever that changes, and acts on what's clicked there.

const ORDER = { input: 0, done: 1, reminder: 1, working: 2, running: 3 } as const

function summarize(): MenuBarSummary {
  const s = getState()
  const sessions: MenuBarSession[] = []
  for (const session of orderedSessions(s)) {
    const status = s.status[session.id]
    if (status !== 'working' && status !== 'input' && status !== 'done' && status !== 'reminder' && status !== 'running') continue
    const group = s.groups.find(g => g.id === session.groupId)
    const activity = s.activity[session.id]
    sessions.push({
      id: session.id,
      name: session.name,
      status,
      text: status === 'running' ? undefined : activity?.text,
      since: status === 'working' ? activity?.since : s.needsSince[session.id],
      group: group?.name,
      permission: status === 'input' && hasPermission(session.id),
      reply: (status === 'done' || status === 'reminder') && claudeRunning(session.id),
    })
  }
  // Longest waiting first among those that need you, as ⌘J goes; the rest keep the sidebar's order.
  sessions.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'input' || a.status === 'done' || a.status === 'reminder' ? (a.since ?? 0) - (b.since ?? 0) : 0))
  return {
    sessions,
    working: sessions.filter(x => x.status === 'working').length,
    needsYou: sessions.filter(x => x.status === 'input' || x.status === 'done' || x.status === 'reminder').length,
  }
}

let sent = ''
subscribe(() => {
  const summary = summarize()
  const json = JSON.stringify(summary)
  if (json === sent) return
  sent = json
  window.deck.setMenuBarSummary(summary)
})
window.deck.setMenuBarSummary(summarize())

window.deck.onMenuBarAction(async action => {
  if (action.type === 'open') focusSession(action.id)
  else if (action.type === 'answer') answerPermission(action.id, action.allow)
  else {
    const result = await promptClaude(action.id, action.text)
    const name = getState().sessions.find(s => s.id === action.id)?.name ?? 'Session'
    if (!result.sent) window.deck.notify({ id: action.id, title: name, body: `Your reply wasn’t sent. ${result.why}` })
  }
})
