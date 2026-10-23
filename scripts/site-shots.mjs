// Retakes the marketing site's screenshots from the demo day, in light and dark (docs/development.md
// → "Marketing site"). Needs `npm run dev`; brings the window forward for each shot.
// Usage: node scripts/site-shots.mjs [shot…]   (default: all of them)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OUT = path.join(import.meta.dirname, '..', 'site', 'public', 'shots')
// Each shot: the view to show, and what to open on top of it.
const SHOTS = {
  checkout: { view: { kind: 'group', id: 'demo-checkout' } },
  palette: { view: { kind: 'group', id: 'demo-checkout' }, palette: 'ch' },
  ios: { view: { kind: 'group', id: 'demo-ios' } },
  docs: { view: { kind: 'group', id: 'demo-docs' } },
  loadtest: { view: { kind: 'session', id: 'demo-load-test' } },
  find: { view: { kind: 'session', id: 'demo-load-test' }, find: 'payment' },
  question: { view: { kind: 'session', id: 'demo-order-export' } },
  browser: { view: { kind: 'session', id: 'demo-apple-pay' }, browser: true },
  tools: { view: { kind: 'session', id: 'demo-triage' } },
  mixed: { view: { kind: 'pick', ids: ['demo-apple-pay', 'demo-launch-crash'] } },
  // The info panel beside a session, and a file of it open in the viewer.
  info: { view: { kind: 'session', id: 'demo-apple-pay' }, info: true },
  viewer: { view: { kind: 'session', id: 'demo-apple-pay' }, info: true, file: 'page.tsx' },
  // The Today page over the checkout group, on each of its tabs.
  today: { view: { kind: 'group', id: 'demo-checkout' }, page: 'today' },
  week: { view: { kind: 'group', id: 'demo-checkout' }, page: 'week' },
  reminders: { view: { kind: 'group', id: 'demo-checkout' }, page: 'reminders' },
  // The Themes section's picker: the checkout group in each theme but Default, which is `checkout`.
  ...Object.fromEntries(['nord', 'solarized', 'catppuccin', 'dracula', 'gruvbox', 'tokyo-night', 'night-owl', 'rose-pine', 'everforest', 'flexoki', 'indigo'].map(theme => (
    [`theme-${theme}`, { view: { kind: 'group', id: 'demo-checkout' }, theme }]
  ))),
}
const shots = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS)

const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve))
let next = 0
const evaluate = expression => new Promise((resolve, reject) => {
  const id = ++next
  const listener = event => {
    const message = JSON.parse(event.data)
    if (message.id !== id) return
    ws.removeEventListener('message', listener)
    const { result, exceptionDetails } = message.result
    exceptionDetails ? reject(new Error(exceptionDetails.exception?.description)) : resolve(result.value)
  }
  ws.addEventListener('message', listener)
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
})

/** Lays the shot out in the window, from a fresh demo day so every shot starts at the same moment. */
const setUp = (shot, mode) => evaluate(`(async () => {
  const { view, palette, find, info = false, file, theme = 'default', browser = false, page } = ${JSON.stringify(SHOTS[shot])}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  // React ignores a plain .value =; this is how a typed value reaches it.
  const type = (input, text) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // The modules the window loaded: after a hot reload they're at /src/x.ts?t=…, and a plain import is a second copy.
  const own = name => import(performance.getEntriesByType('resource').map(r => r.name).find(n => new URL(n).pathname === '/src/' + name + '.ts') ?? '/src/' + name + '.ts')
  const [demo, store, workspace, browsers, status, projects, demoData] = await Promise.all(['demo', 'store', 'workspace', 'browser', 'status', 'projects', 'demo-data'].map(own))
  window.deck.setAppearance('${mode}')
  window.dispatchEvent(new CustomEvent('deckterm:action', { detail: 'theme:' + theme }))
  document.querySelector('.palette input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.querySelector('.viewer')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  demo.loadDemo()
  await wait(500)
  store.setState(() => ({ toasts: [], finding: null, page: null }))
  // From the day's first project, showing the view moves the rail to the one that lists it, or to all of them.
  projects.chooseProject(demoData.DEMO_PROJECTS.first)
  workspace.show(view)
  await wait(900)
  // The Apple Pay session's Chrome restarts with the demo day, and opens its window when it's up; the
  // placement goes on after that, so the window shows only in its own shot, floating wide over the terminal.
  for (let i = 0; i < 40 && !window.deck.browserStates()['demo-apple-pay']; i++) await wait(250)
  await wait(300)
  browsers.setPlacement('demo-apple-pay', { x: 0.34, y: 0.04, w: 0.64, expanded: false, closed: !browser })
  for (let i = 0; browser && i < 40; i++) {
    const canvas = document.querySelector('.browser-view canvas')
    if (canvas && canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3]) break
    await wait(250)
  }
  // The panel remembers whether it's open, so each shot sets it the way it needs it.
  if (JSON.parse(localStorage.getItem('deckterm.info') || '{}').open !== info) {
    window.dispatchEvent(new CustomEvent('deckterm:action', { detail: 'toggle-info' }))
    await wait(700)
  }
  if (file) {
    // The panel's files arrive once the session's git details have, a moment after it shows.
    const row = async () => [...document.querySelectorAll('.info-row')].find(r => r.textContent.includes(file))
    for (let i = 0; i < 40 && !(await row()); i++) await wait(250)
    ;(await row()).click()
    await wait(700)
  }
  if (page === 'reminders') {
    workspace.openPage('reminders')
    await wait(900)
  } else if (page) {
    localStorage.setItem('deckterm.statusTab', page)
    await status.showStatus()
    await wait(900)
  }
  const action = palette ? 'palette' : find ? 'find' : null
  if (action) {
    window.dispatchEvent(new CustomEvent('deckterm:action', { detail: action }))
    await wait(300)
    type(document.querySelector(palette ? '.palette input' : '.find-bar input'), palette ?? find)
  }
  await wait(600)
})()`)

const pid = execFileSync('pgrep', ['-f', 'deckterm/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'], { encoding: 'utf8' }).split('\n')[0]
const osascript = script => execFileSync('osascript', ['-e', `tell application "System Events" to ${script}`])
const swift = code => execFileSync('swift', ['-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-term-shots-'))

for (const mode of ['light', 'dark']) {
  for (const shot of shots) {
    await setUp(shot, mode)
    osascript(`set frontmost of (first process whose unix id is ${pid}) to true`)
    // A size that changes, or the capture can be the window's last frame rather than what's on screen.
    osascript(`tell (first process whose unix id is ${pid}) to set size of window 1 to {1441, 901}`)
    await new Promise(r => setTimeout(r, 400))
    osascript(`tell (first process whose unix id is ${pid}) to set size of window 1 to {1440, 900}`)
    // The pointer off the window, so no row shows its hover.
    swift('import CoreGraphics; CGWarpMouseCursorPosition(CGPoint(x: 2, y: 2))')
    // A window that was covered can show its previous frame for a moment.
    await new Promise(r => setTimeout(r, 1600))
    const window = swift('import CoreGraphics; let l = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String:Any]]; for w in l where (w["kCGWindowName"] as? String) == "Own Term" && (w["kCGWindowOwnerName"] as? String) == "Electron" { print(w["kCGWindowNumber"]!); break }')
    const png = path.join(tmp, `${shot}-${mode}.png`)
    execFileSync('screencapture', ['-o', '-l', window, png])
    execFileSync('cwebp', ['-quiet', '-q', '86', png, '-o', path.join(OUT, `${shot}-${mode}.webp`)])
    console.log(`${shot}-${mode}.webp`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
ws.close()
