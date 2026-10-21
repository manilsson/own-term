import { useSyncExternalStore } from 'react'
import { addGroup, announce, getState, monitorPane, moveMonitor, paneGroup, setMonitorCheck } from './store'
import { closePage, closePane, openPage, refreshView, showBeside } from './workspace'
import { groupItems } from './menus'

// The monitors main runs (electron/monitors.cjs), as the sidebar and their pages see them. Main
// pushes a summary of each whenever one changes; a page fetches its monitor in full by itself.

let monitors: MonitorSummary[] = []
const listeners = new Set<() => void>()

function set(next: MonitorSummary[]) {
  const first = !loaded
  // One gone takes its pane away; one back, as by an Undo, returns to its group's panes.
  const changed = next.length !== monitors.length || monitors.some(m => !next.some(n => n.id === m.id))
  monitors = next
  // Until main has answered, a saved view's monitors are taken to exist, so their panes keep their places.
  loaded = true
  setMonitorCheck(id => monitors.some(m => m.id === id))
  listeners.forEach(l => l())
  if (first || changed) refreshView()
}
let loaded = false

export const monitorList = () => monitors

export function subscribeMonitors(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMonitors<T>(select: (list: MonitorSummary[]) => T): T {
  return useSyncExternalStore(subscribeMonitors, () => select(monitors))
}

window.deck.monitors().then(set)
window.deck.onMonitors(set)

/** Main pushes changes a moment after they happen; a tool answering Claude needs them now. */
export const refreshMonitors = () => window.deck.monitors().then(set)
window.deck.onShowMonitor(id => showMonitor(id))

export function findMonitor(ref: string) {
  const name = ref.trim()
  return monitors.find(m => m.id === name) ?? monitors.filter(m => m.name.toLowerCase() === name.toLowerCase())[0]
}

export function showMonitor(id: string) {
  if (!monitors.some(m => m.id === id)) return
  openPage({ monitor: id })
  window.deck.monitorSeen(id)
}

export const shownMonitor = () => {
  const page = getState().page
  return typeof page === 'object' && page ? page.monitor : null
}

/** Removes a monitor, with an Undo that brings it back with its history. */
export async function removeMonitor(monitor: MonitorSummary, byClaude = false) {
  if (!byClaude) {
    const confirmed = await window.deck.confirm({
      message: `Remove “${monitor.name}”?`,
      detail: 'Its commands stop running, and its history is removed with it.',
      confirm: 'Remove Monitor',
    })
    if (!confirmed) return
  }
  if (shownMonitor() === monitor.id) closePage()
  await window.deck.removeMonitor(monitor.id)
  announce(`${byClaude ? 'Claude removed' : 'Removed'} the monitor “${monitor.name}”`, () => window.deck.restoreMonitor(monitor.id))
}

export async function setPaused(monitor: MonitorSummary, paused: boolean, byClaude = false) {
  await window.deck.pauseMonitor(monitor.id, paused)
  const verb = paused ? 'paused' : 'resumed'
  announce(`${byClaude ? `Claude ${verb}` : verb[0].toUpperCase() + verb.slice(1)} “${monitor.name}”`, () => window.deck.pauseMonitor(monitor.id, !paused))
}

/** The monitor's menu, from its sidebar row, its page or, with `inPane`, the ⋯ button in its pane. */
export async function monitorMenu(monitor: MonitorSummary, inPane = false) {
  const groupId = paneGroup(getState(), monitorPane(monitor.id))
  const choice = await window.deck.popupMenu([
    ...(inPane ? [{ id: 'close', label: 'Close Pane' }, { type: 'separator' as const }] : []),
    { id: 'open', label: 'Show Alone' },
    { id: 'beside', label: 'Show Beside What’s on Screen' },
    { type: 'separator' },
    { id: 'run', label: 'Run Now', enabled: !monitor.pending.length },
    { id: 'pause', label: monitor.paused ? 'Resume' : 'Pause' },
    { type: 'separator' },
    { label: 'Move to Group', submenu: groupItems(groupId) },
    { id: 'reveal', label: 'Show Spec in Finder' },
    { type: 'separator' },
    { id: 'remove', label: 'Remove Monitor…' },
  ])
  if (choice === 'close') closePane(monitorPane(monitor.id))
  if (choice === 'open') showMonitor(monitor.id)
  if (choice === 'beside') showBeside(monitorPane(monitor.id))
  if (choice?.startsWith('move:')) {
    const target = choice.slice(5)
    moveMonitor(monitor.id, target === 'new' ? addGroup() : target || null)
    refreshView()
  }
  if (choice === 'run') window.deck.runMonitor(monitor.id)
  if (choice === 'pause') setPaused(monitor, !monitor.paused)
  if (choice === 'reveal') window.deck.revealMonitor(monitor.id)
  if (choice === 'remove') removeMonitor(monitor)
}

/** The next 8 in the morning: when "until tomorrow" ends. */
function tomorrowMorning() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return +d
}

/** Snoozing a rule: it's still checked and on its page, but doesn't notify, wake Claude or count. */
export async function snoozeMenu(monitor: MonitorSummary, rule: MonitorRule, firing: boolean) {
  const current = monitor.snoozed[rule.id]
  const choice = await window.deck.popupMenu(current !== undefined
    ? [{ id: 'wake', label: 'Stop Snoozing' }]
    : [
      { id: 'hour', label: 'Snooze for 1 Hour' },
      { id: 'tomorrow', label: 'Snooze Until Tomorrow Morning' },
      ...(firing ? [{ id: 'clear', label: 'Snooze Until It Clears' }] : []),
    ])
  if (!choice) return
  const until = choice === 'hour' ? Date.now() + 3_600_000 : choice === 'tomorrow' ? tomorrowMorning() : choice === 'clear' ? 'clear' as const : null
  await window.deck.snoozeRule(monitor.id, rule.id, until)
  announce(until === null ? `“${rule.name}” notifies again` : `Snoozed “${rule.name}”`, () => window.deck.snoozeRule(monitor.id, rule.id, current ?? null))
}

/** Monitors with a rule at alert level firing, for the Dock's badge. */
export const alerting = () => monitors.filter(m => m.state === 'alert').length

// ── Values ──────────────────────────────────────────────────────────────────────────────────────────

export interface ValueStyle {
  format?: ValueFormat
  unit?: string
  decimals?: number
}

function duration(ms: number) {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${Math.round(ms)} ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(abs < 10_000 ? 1 : 0)} s`
  if (abs < 3_600_000) return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
  return `${Math.floor(ms / 3_600_000)}h ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`
}

function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (Math.abs(n) >= 1024 && i < units.length - 1) (n /= 1024), i++
  return `${n.toFixed(i === 0 || Math.abs(n) >= 100 ? 0 : 1)} ${units[i]}`
}

/** A value as a panel shows it. Text and booleans read as they are. */
export function formatValue(value: MonitorValue | undefined, style: ValueStyle = {}): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value !== 'number') return String(value)
  const { format = 'number', unit, decimals } = style
  if (format === 'percent') return `${(value * 100).toFixed(decimals ?? 1)}%`
  if (format === 'ms') return duration(value)
  if (format === 'seconds') return duration(value * 1000)
  if (format === 'bytes') return bytes(value)
  const text = format === 'compact'
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: decimals ?? 1 }).format(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals ?? 2, minimumFractionDigits: decimals ?? 0 }).format(value)
  return unit ? `${text}${unit === '%' ? '' : ' '}${unit}` : text
}

/** A row's time field as milliseconds: epoch seconds or milliseconds, or ISO-like text. */
export function timeOf(value: MonitorValue | undefined): number | null {
  if (typeof value === 'number') return value > 1e11 ? value : value > 1e9 ? value * 1000 : null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** How a source's schedule reads: "every 5m, 08-18 on weekdays" or "at 09:07, 12:07". */
export function scheduleText(source: MonitorSource) {
  const when = source.at ? `at ${source.at.join(', ')}` : `every ${source.every}${source.hours ? `, ${source.hours}` : ''}`
  const days = !source.days || source.days === 'daily' ? '' : ` on ${Array.isArray(source.days) ? source.days.join(', ') : source.days}`
  return when + days
}

export const clock = (t: number, seconds = false) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds && { second: '2-digit' }) })

export function ago(t: number, now = Date.now()) {
  const s = Math.round((now - t) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
