import { useSyncExternalStore } from 'react'

/** A shell command Claude ran in a session, from its Bash tool's hooks. */
export interface Command {
  id: string
  command: string
  description?: string
  background: boolean
  started: number
  ended?: number
  status: 'running' | 'done' | 'failed' | 'stopped'
  exitCode?: number
  /** What a command that finished printed, its last 16 KB; a background one's is in its file instead. */
  output?: string
  /** The background command's id, which names its output file (`info:task-output`). */
  taskId?: string
  /** The Claude conversation that ran it. */
  conversation?: string
}

const KEY = 'deckterm.commands'
const MAX = 40
// Kept across a window reload, like statuses (see store.ts); a restart ends the commands anyway.
const bySession = new Map<string, Command[]>(Object.entries(JSON.parse(sessionStorage.getItem(KEY) ?? '{}')))
const listeners = new Set<() => void>()
const EMPTY: Command[] = []

function change(id: string, update: (list: Command[]) => Command[]) {
  bySession.set(id, update(bySession.get(id) ?? []).slice(-MAX))
  sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(bySession)))
  for (const listener of listeners) listener()
}

const patch = (id: string, commandId: string, fields: Partial<Command>) =>
  change(id, list => list.map(c => (c.id === commandId ? { ...c, ...fields } : c)))

const end = (c: Command, fields: Partial<Command>): Command => ({ ...c, ended: Date.now(), ...fields })

/** Ends a session's running commands that `which` picks: Claude no longer knows of them. */
function stopRunning(id: string, which: (c: Command) => boolean, status: Command['status'] = 'stopped') {
  if (bySession.get(id)?.some(c => c.status === 'running' && which(c))) {
    change(id, list => list.map(c => (c.status === 'running' && which(c) ? end(c, { status }) : c)))
  }
}

window.deck.onHook((id, e) => {
  const c = e.command
  // A `claude -p` run in the session reports here too, so a conversation's turns only judge its own commands.
  const own = (x: Command) => !x.conversation || x.conversation === e.claudeSessionId
  if (c?.kind === 'start') {
    change(id, list => [...list.filter(x => x.id !== c.id), {
      id: c.id, command: c.command, description: c.description, background: c.background, started: Date.now(), status: 'running',
      conversation: e.claudeSessionId,
    }])
  } else if (c?.kind === 'end') {
    // A command started in the background, or moved there after its timeout, runs until Claude hears it ended.
    if (c.taskId) patch(id, c.id, { background: true, taskId: c.taskId })
    else change(id, list => list.map(x => (x.id === c.id ? end(x, c.interrupted ? { status: 'stopped' } : { status: 'done', exitCode: 0, output: c.output }) : x)))
  } else if (c?.kind === 'fail') {
    change(id, list => list.map(x => (x.id === c.id ? end(x, { status: 'failed', exitCode: c.exitCode, output: c.output }) : x)))
  } else if (c?.kind === 'tasks') {
    // It can arrive after a turn's end already counted the command as ended, and knows better.
    change(id, list => list.map(x => {
      const task = c.ended.find(t => t.id === x.id)
      if (!task) return x
      const failed = task.status === 'failed' || (task.exitCode !== undefined && task.exitCode !== 0)
      return end(x, { status: task.status === 'killed' ? 'stopped' : failed ? 'failed' : 'done', exitCode: task.exitCode })
    }))
  } else if (c?.kind === 'shells' && !e.fromSubagent) {
    // A command that never finished by the end of the turn was denied or interrupted; a background one
    // missing from Claude's list ended without a word reaching here.
    stopRunning(id, x => own(x) && !x.background)
    stopRunning(id, x => own(x) && !!x.taskId && !c.running.includes(x.taskId), 'done')
  } else if (e.event === 'Stop' && !e.fromSubagent) stopRunning(id, x => own(x) && !x.background)
  // Claude ends its background commands when it exits.
  else if (e.event === 'SessionEnd') stopRunning(id, own)
})

// A shell that exits takes everything Claude started in it along.
window.deck.onExit(id => stopRunning(id, () => true))

/** The commands Claude ran in a session, oldest first. */
export function useCommands(id: string) {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => bySession.get(id) ?? EMPTY,
  )
}

/** A command's state in a word or two, and the color it's shown in. */
export function commandState(c: Command): { label: string; tone: 'green' | 'red' | 'orange' | 'neutral' } {
  if (c.status === 'running') return { label: 'Running', tone: 'green' }
  if (c.status === 'failed' && c.output?.startsWith('Command timed out')) return { label: 'Timed out', tone: 'red' }
  if (c.status === 'failed') return { label: c.exitCode !== undefined ? `Exit ${c.exitCode}` : 'Failed', tone: 'red' }
  if (c.status === 'stopped') return { label: 'Stopped', tone: 'orange' }
  return { label: 'Done', tone: 'neutral' }
}
