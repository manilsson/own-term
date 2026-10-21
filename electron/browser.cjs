// A Chrome per session for chrome-devtools-mcp (see mcp.cjs), started on first use in a profile of
// its own, since Chrome allows one browser per profile folder.
const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, safeStorage } = require('electron')

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
]
const chromeExecutable = () => CHROME.find(file => fs.existsSync(file))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Session id → { proc, port, ready, windowed, client, seen, timer, turn }
const browsers = new Map()
// Sessions that ended, so a Chrome still being prepared for one isn't started.
const ended = new Set()
// Session id → the exit of a Chrome closed with its session, which takes the profile folder with it.
const closing = new Map()
// Where the live view's frames and state go; see onBrowserViews.
let notify = () => {}
// Session id → whether its Chrome shows as a window, chosen for that session (setWindowed); otherwise
// the App menu's setting decides.
const modes = new Map()
// Session id → the session's door: a port of its own that chrome-devtools-mcp is pointed at
const doors = new Map()

const profileFolder = id => path.join(app.getPath('userData'), 'browsers', id)
// The profile you sign in to sites with (signIn).
const SIGN_IN = '_base'

/** Starts Chrome on a profile with a DevTools port, which `ready` resolves with. */
function startChrome(folder, args) {
  const executable = chromeExecutable()
  if (!executable) throw new Error('Google Chrome isn’t installed in Applications.')
  fs.mkdirSync(folder, { recursive: true })
  // Chrome writes the port it picked here; one left by an earlier run would point at a closed port.
  const portFile = path.join(folder, 'DevToolsActivePort')
  fs.rmSync(portFile, { force: true })
  const proc = spawn(executable, [`--user-data-dir=${folder}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', ...args], { stdio: 'ignore' })
  const ready = new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (proc.exitCode !== null) return reject(new Error('Chrome quit as it started.'))
      try {
        const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])
        if (port > 0) return resolve(port)
      } catch {}
      if (Date.now() - started > 15000) return reject(new Error('Chrome didn’t open its DevTools port.'))
      setTimeout(poll, 100)
    }
    poll()
  })
  return { proc, ready }
}

/** A DevTools connection to the whole browser listening on the port. */
async function connect(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const client = devtools(webSocketDebuggerUrl)
  await client.opened
  return client
}

// Logins: the cookies of every session's Chrome, kept as one set that each Chrome is given as it starts
// and that a change in any one is copied from to the others, so a site is signed in to once.
const loginsFile = () => path.join(app.getPath('userData'), 'browsers', 'logins')
// Cookie key → the cookie, as Storage.getCookies gives it.
let logins = null
const cookieKey = c => [c.name, c.domain, c.path, JSON.stringify(c.partitionKey ?? null)].join('\t')
const cookieSig = c => [c.value, c.session ? '' : Math.round(c.expires), c.httpOnly, c.secure, c.sameSite ?? ''].join('\t')
const unexpired = c => c.session || c.expires * 1000 > Date.now()

// Encrypted with Own Term's Keychain key, as Chrome encrypts them with its own: they're your logins.
function loadLogins() {
  if (logins) return logins
  logins = new Map()
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(loginsFile())) {
      for (const cookie of JSON.parse(safeStorage.decryptString(fs.readFileSync(loginsFile())))) if (unexpired(cookie)) logins.set(cookieKey(cookie), cookie)
    }
  } catch {}
  return logins
}

let saveTimer
function saveLogins(now = false) {
  clearTimeout(saveTimer)
  if (!now) return void (saveTimer = setTimeout(() => saveLogins(true), 1000))
  if (!logins || !safeStorage.isEncryptionAvailable()) return
  try {
    fs.mkdirSync(path.dirname(loginsFile()), { recursive: true })
    fs.writeFileSync(loginsFile(), safeStorage.encryptString(JSON.stringify([...logins.values()].filter(unexpired))), { mode: 0o600 })
  } catch {}
}

// A cookie as Storage.setCookies takes it. A host-only one (no leading dot) goes by its URL: by its
// domain it would widen to subdomains, which a __Host- cookie refuses.
function cookieParam({ size, session, expires, domain, ...cookie }) {
  return {
    ...cookie,
    ...(session ? {} : { expires }),
    ...(domain.startsWith('.') ? { domain } : { url: `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}` }),
  }
}

// One cookie Chrome won't take fails the whole call, so then they go one at a time.
async function putCookies(client, cookies) {
  if (!cookies.length) return
  const params = cookies.map(cookieParam)
  try {
    await client.send('Storage.setCookies', { cookies: params })
  } catch {
    await Promise.all(params.map(cookie => client.send('Storage.setCookies', { cookies: [cookie] }).catch(() => {})))
  }
}

// Chrome deletes a cookie that's set as already expired.
const dropCookies = (client, cookies) => putCookies(client, cookies.map(cookie => ({ ...cookie, session: false, expires: 1 })))

// A Chrome's DevTools work, one task at a time, so a check never reads cookies another task is setting.
function inTurn(entry, task) {
  entry.turn = (entry.turn ?? Promise.resolve()).then(task).catch(() => {})
  return entry.turn
}

/**
 * Takes what changed in a Chrome since it was last read (`seen`, key → sig) into the logins and gives it
 * to every other session Chrome. Returns what's seen there now.
 */
function takeLogins(seen, cookies, from) {
  const jar = loadLogins()
  const now = new Map(cookies.map(cookie => [cookieKey(cookie), cookie]))
  const set = []
  const gone = []
  for (const [key, cookie] of now) {
    const sig = cookieSig(cookie)
    if (seen.get(key) === sig) continue
    const had = jar.get(key)
    if (!had || cookieSig(had) !== sig) {
      jar.set(key, cookie)
      set.push(cookie)
    }
  }
  // Gone from that Chrome as it last was there: signed out of, or expired. A newer one from elsewhere stays.
  for (const [key, sig] of seen) {
    const had = jar.get(key)
    if (!now.has(key) && had && cookieSig(had) === sig) {
      jar.delete(key)
      gone.push(had)
    }
  }
  if (set.length || gone.length) {
    saveLogins()
    for (const entry of browsers.values()) if (entry !== from && entry.client) inTurn(entry, () => shareLogins(entry, set, gone))
  }
  return new Map([...now].map(([key, cookie]) => [key, cookieSig(cookie)]))
}

// What's there afterwards counts as seen, so the next check doesn't take a shared cookie for that Chrome's
// own change and copy a value back over a newer one elsewhere. A cookie it refused isn't seen as signed out of.
async function shareLogins(entry, set, gone) {
  await putCookies(entry.client, set)
  await dropCookies(entry.client, gone)
  const { cookies } = await entry.client.send('Storage.getCookies')
  const there = new Map(cookies.map(cookie => [cookieKey(cookie), cookieSig(cookie)]))
  for (const key of [...set, ...gone].map(cookieKey)) {
    if (there.has(key)) entry.seen.set(key, there.get(key))
    else entry.seen.delete(key)
  }
}

const syncLogins = entry => inTurn(entry, async () => {
  if (!entry.client) return
  const { cookies } = await entry.client.send('Storage.getCookies')
  entry.seen = takeLogins(entry.seen, cookies, entry)
})

// A session's Chrome, as it starts: given the logins, and its own taken in (a profile from before
// there were shared logins has some), then read every few seconds.
async function adoptLogins(entry) {
  entry.seen = new Map()
  entry.client = await connect(entry.port)
  await putCookies(entry.client, [...loadLogins().values()].filter(unexpired))
  await syncLogins(entry)
  // A check still waiting on Chrome skips the next, so they don't pile up.
  entry.timer = setInterval(() => {
    if (entry.checking) return
    entry.checking = true
    syncLogins(entry).finally(() => (entry.checking = false))
  }, 3000)
}

// Quits Chrome through DevTools (Browser.close), which saves its cookies; a signal would lose the logins
// since its last save. One still running after 4 seconds is killed.
async function quitChrome(entry) {
  if (entry.proc.exitCode !== null || entry.proc.signalCode !== null) return
  const exited = new Promise(resolve => entry.proc.once('exit', resolve))
  await Promise.race([syncLogins(entry), sleep(2000)])
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${entry.port}/json/version`)).json()
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  } catch {
    entry.proc.kill()
  }
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 4000))])
  // Gone only once it has exited: a restart before then would find the old one still listed.
  if (entry.proc.exitCode === null && entry.proc.signalCode === null) {
    entry.proc.kill('SIGKILL')
    await exited
  }
}

// A Chrome an earlier Own Term didn't get to quit still holds the profile, and a new one started on it
// hands over to it and quits. Its lock names its pid; one whose command line names this folder is closed.
async function closeLeftover(folder) {
  let pid
  try {
    pid = Number(fs.readlinkSync(path.join(folder, 'SingletonLock')).split('-').pop())
  } catch {
    return
  }
  if (!pid) return
  const command = await new Promise(resolve => execFile('ps', ['-o', 'command=', '-p', String(pid)], (error, out) => resolve(error ? '' : out)))
  if (!command.includes(`--user-data-dir=${folder} `)) return
  const alive = () => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  // SIGTERM first: Chrome exits without saving its latest cookies, but the shared logins hold them.
  process.kill(pid, 'SIGTERM')
  for (let waited = 0; alive() && waited < 4000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  if (alive()) process.kill(pid, 'SIGKILL')
}

// An Own Term that crashed or was force-quit leaves its session Chromes running, and closeLeftover only
// reaches the ones whose session starts its browser again. Being the single instance, none are ours yet.
function closeAllLeftovers() {
  const root = path.join(app.getPath('userData'), 'browsers') + path.sep
  execFile('ps', ['-axo', 'pid=,command='], { maxBuffer: 16 * 1024 * 1024 }, (error, out) => {
    if (error) return
    for (const line of out.split('\n')) {
      const [, pid, command] = line.match(/^\s*(\d+)\s+(.*)$/) ?? []
      // The browser process only, and not a window Chrome you sign in with, which has no DevTools port.
      if (!CHROME.some(file => command?.startsWith(`${file} --user-data-dir=${root}`))) continue
      if (!command.includes(' --remote-debugging-port=0 ')) continue
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {}
    }
  })
}

/**
 * The session's Chrome, started if need be: resolves with its DevTools port. Headless unless `window`,
 * and signed in with the shared logins unless `logins` is false.
 */
async function ensureBrowser(id, options, url = 'about:blank') {
  const running = browsers.get(id)
  if (running) return running.ready
  await closeLeftover(profileFolder(id)).catch(() => {})
  // The session may have ended meanwhile, or another request started its Chrome.
  if (ended.has(id)) {
    fs.rmSync(profileFolder(id), { recursive: true, force: true })
    throw new Error('The session has ended.')
  }
  if (browsers.get(id)) return browsers.get(id).ready
  const windowed = modes.get(id) ?? options.window
  const { proc, ready } = startChrome(profileFolder(id), [
    // A 1440×900 page: headless Chrome's window size includes 87 pixels of window around the page.
    ...(windowed ? [] : ['--headless=new', '--window-size=1440,987']),
    url,
  ])
  const entry = { proc, port: 0, ready: null, windowed }
  // Signed in before the agent's first page loads, which waits on this.
  entry.ready = ready.then(async port => {
    entry.port = port
    if (options.logins !== false) await adoptLogins(entry).catch(() => {})
    return port
  })
  proc.on('exit', () => {
    clearInterval(entry.timer)
    entry.client?.close()
    if (browsers.get(id) === entry) browsers.delete(id)
    closeView(id)
    if (windowed) notify('browser-state', id, null)
  })
  // Headless, it's shown in Own Term (see view below); as a window, Own Term only says it's out there.
  entry.ready.then(() => (windowed ? notify('browser-state', id, WINDOWED) : openView(id, entry)), () => {})
  // A failed start is forgotten, so the next request tries again.
  entry.ready.catch(() => {
    if (browsers.get(id) === entry) browsers.delete(id)
    proc.kill()
  })
  browsers.set(id, entry)
  return entry.ready
}

// The session's door: a port of its own (chrome-devtools-mcp drops the path of its browserUrl) whose
// /json/version starts the session's Chrome and hands over its address, so the two then talk directly.
function openDoor(id, options) {
  const open = doors.get(id)
  if (open) return open.ready
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/json/version') return res.writeHead(404).end()
    try {
      const port = await ensureBrowser(id, options())
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).text()
      res.writeHead(200, { 'content-type': 'application/json' }).end(version)
    } catch (error) {
      res.writeHead(503).end(error.message)
    }
  })
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  doors.set(id, { server, ready })
  return ready
}

// The live view: Own Term's own DevTools connection to a headless Chrome follows the agent's page and
// streams it (Page.startScreencast); the page keeps its size, so resizing the view never moves it.

/** A DevTools Protocol connection over a WebSocket. */
function devtools(url) {
  const ws = new WebSocket(url)
  let last = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else listeners.forEach(listener => listener(message))
  }
  // A Chrome that quits answers nothing more; what was asked of it fails rather than waiting forever.
  ws.onclose = () => {
    pending.forEach(answer => answer({ error: { message: 'Chrome closed.' } }))
    pending.clear()
  }
  return {
    opened: new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    }),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++last
      pending.set(id, m => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }))
    }),
    on: listener => listeners.add(listener),
    close: () => ws.close(),
  }
}

// Session id → { client, pages: Map<targetId, { url, title }>, shown, attached, size, streaming, ack }
const views = new Map()

async function openView(id, entry) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${entry.port}/json/version`)).json()
    const client = devtools(webSocketDebuggerUrl)
    await client.opened
    // That Chrome may have gone while this connected, its view closed before it was ever listed.
    if (browsers.get(id) !== entry) return client.close()
    const view = { client, pages: new Map(), shown: null, attached: null, size: null, streaming: false, ack: null }
    views.set(id, view)
    client.on(message => onMessage(id, view, message))
    await client.send('Target.setDiscoverTargets', { discover: true })
  } catch {}
}

function onMessage(id, view, { method, params, sessionId }) {
  if (method === 'Page.screencastFrame' && sessionId === view.attached) {
    view.ack = params.sessionId
    const { deviceWidth: width, deviceHeight: height } = params.metadata
    notify('browser-frame', id, Buffer.from(params.data, 'base64'), { width, height })
    checkTitle(id, view)
    return
  }
  const info = params?.targetInfo
  if (method === 'Target.targetCreated' && info.type === 'page') {
    view.pages.set(info.targetId, { url: info.url, title: info.title })
    // A page the agent opens is the one it works in.
    show(id, view, info.targetId)
  } else if (method === 'Target.targetInfoChanged' && view.pages.has(info.targetId)) {
    const before = view.pages.get(info.targetId)
    view.pages.set(info.targetId, { url: info.url, title: info.title })
    // So is one it navigates. Its address comes before its title, which is asked for once it loads.
    if (info.url !== before.url) {
      show(id, view, info.targetId)
      clearTimeout(view.titleTimer)
      view.titleTimer = setTimeout(() => {
        view.titleCheckedAt = 0
        checkTitle(id, view)
      }, 500)
    } else if (info.targetId === view.shown) report(id)
  } else if (method === 'Target.targetDestroyed' && view.pages.has(params.targetId)) {
    view.pages.delete(params.targetId)
    if (view.shown === params.targetId) {
      view.shown = null
      view.attached = null
      const next = [...view.pages.keys()].at(-1)
      if (next) show(id, view, next)
      else report(id)
    }
  }
}

// Chrome reports a page's address changing but not its title, so the title is asked for now and then
// while frames come in.
async function checkTitle(id, view) {
  const now = Date.now()
  if (now - (view.titleCheckedAt ?? 0) < 700 || !view.shown) return
  view.titleCheckedAt = now
  const targetId = view.shown
  try {
    const { targetInfo } = await view.client.send('Target.getTargetInfo', { targetId })
    const page = view.pages.get(targetId)
    if (page && targetInfo.title !== page.title) {
      page.title = targetInfo.title
      if (view.shown === targetId) report(id)
    }
  } catch {}
}

async function show(id, view, targetId) {
  if (view.shown === targetId) return report(id)
  const previous = view.attached
  view.shown = targetId
  view.attached = null
  report(id)
  if (previous) view.client.send('Target.detachFromTarget', { sessionId: previous }).catch(() => {})
  try {
    const { sessionId } = await view.client.send('Target.attachToTarget', { targetId, flatten: true })
    if (view.shown !== targetId) return
    view.attached = sessionId
    view.streaming = false
    stream(view)
  } catch {}
}

// Streams while the view is on screen, in frames no bigger than the view: Chrome scales them down, so
// a small view costs only what it shows.
function stream(view) {
  const want = !!(view.attached && view.size)
  if (want === view.streaming) return
  view.streaming = want
  if (!view.attached) return
  if (want) {
    const { width, height, scale } = view.size
    view.client.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale) }, view.attached).catch(() => {})
  } else view.client.send('Page.stopScreencast', {}, view.attached).catch(() => {})
}

function report(id) {
  const view = views.get(id)
  const page = view?.shown ? view.pages.get(view.shown) : null
  notify('browser-state', id, view ? { url: page?.url ?? '', title: page?.title ?? '' } : null)
}

function closeView(id) {
  const view = views.get(id)
  if (!view) return
  views.delete(id)
  view.client.close()
  notify('browser-state', id, null)
}

/** The renderer's view is on screen at this size in CSS pixels, or isn't (null): it bounds the frames. */
async function watchBrowser(id, size) {
  const view = views.get(id)
  if (!view) return
  const changed = JSON.stringify(size) !== JSON.stringify(view.size)
  view.size = size
  if (changed && size) {
    // A new size restarts the stream at that resolution.
    if (view.streaming && view.attached) {
      view.streaming = false
      await view.client.send('Page.stopScreencast', {}, view.attached).catch(() => {})
    }
  }
  stream(view)
}

// Input on the live view, as the page should receive it.
const INPUT = { mouse: 'Input.dispatchMouseEvent', key: 'Input.dispatchKeyEvent', text: 'Input.insertText' }

/** Your mouse, keys and pastes on the live view, given to the page as Chrome's own input would be. */
function browserInput(id, kind, params) {
  const view = views.get(id)
  if (!view?.attached || !INPUT[kind]) return
  view.client.send(INPUT[kind], params, view.attached).catch(() => {})
  // Input is when a page tends to retitle itself, with or without anything to redraw.
  clearTimeout(view.titleTimer)
  view.titleTimer = setTimeout(() => {
    view.titleCheckedAt = 0
    checkTitle(id, view)
  }, 300)
}

/** The renderer drew the last frame: Chrome may send the next. */
function frameDrawn(id) {
  const view = views.get(id)
  if (!view?.ack || !view.attached) return
  view.client.send('Page.screencastFrameAck', { sessionId: view.ack }, view.attached).catch(() => {})
  view.ack = null
}

/** Each session's live view, for a window that has just loaded. */
function browserStates() {
  const states = {}
  for (const [id, entry] of browsers) if (entry.windowed && entry.port) states[id] = WINDOWED
  for (const [id, view] of views) {
    const page = view.shown ? view.pages.get(view.shown) : null
    states[id] = { url: page?.url ?? '', title: page?.title ?? '' }
  }
  return states
}

/** Where the live view's frames and state go: the app's window. */
function onBrowserViews(send) {
  notify = send
}

const WINDOWED = { url: '', title: '', windowed: true }

// Signing in. A Chrome with a DevTools port tells every page it's automated (navigator.webdriver), in a
// window too, and Google refuses sign-ins there. So you sign in in a plain Chrome on the sign-in profile,
// given the logins first; once it quits, a headless Chrome on that profile reads what you signed in to.
// { proc, asking: the session whose page goes on to where you finished, seen, done }
let signing = null

const notifySigning = () => notify('browser-signing', !!signing)

/** Runs `task` with a DevTools connection to a headless Chrome on the profile, then quits that Chrome. */
async function inHeadless(folder, args, task) {
  await closeLeftover(folder).catch(() => {})
  const { proc, ready } = startChrome(folder, ['--headless=new', ...args])
  const fail = error => {
    proc.kill()
    throw error
  }
  const port = await ready.catch(fail)
  const client = await connect(port).catch(fail)
  try {
    return await task(client)
  } finally {
    // Its pages closed first, so the next Chrome on the profile restores none of them.
    const { targetInfos } = await client.send('Target.getTargets').catch(() => ({ targetInfos: [] }))
    for (const { type, targetId } of targetInfos) if (type === 'page') await client.send('Target.closeTarget', { targetId }).catch(() => {})
    client.close()
    await quitChrome({ proc, port })
  }
}

/** The page a session's browser shows in Own Term, if it's a web page. */
function shownUrl(id) {
  const view = views.get(id)
  const url = view?.shown && view.pages.get(view.shown)?.url
  return url && /^https?:/.test(url) ? url : undefined
}

/**
 * Opens the page a session's browser shows (or a new tab, with none) in the sign-in Chrome, started if
 * need be. Its logins reach every session's browser once it quits (finishSignIn).
 */
async function signIn(asking) {
  const folder = profileFolder(SIGN_IN)
  const executable = chromeExecutable()
  const url = asking && shownUrl(asking)
  if (!executable) return
  if (signing) {
    if (asking) signing.asking = asking
    // A second Chrome on the profile hands its page to the open one and quits.
    if (signing.proc) spawn(executable, [`--user-data-dir=${folder}`, ...(url ? [url] : [])], { stdio: 'ignore' })
    return
  }
  signing = { proc: null, asking }
  notifySigning()
  try {
    // Every session's latest, the asking one's too, so a sign-in it began finishes there.
    await Promise.all([...browsers.values()].map(syncLogins))
    const given = [...loadLogins().values()].filter(unexpired)
    const seen = await inHeadless(folder, [], async client => {
      await putCookies(client, given)
      const keys = new Set(given.map(cookieKey))
      const { cookies } = await client.send('Storage.getCookies')
      // Only what it was given counts as seen, so what the profile had of its own is new to the others.
      return new Map(cookies.filter(cookie => keys.has(cookieKey(cookie))).map(cookie => [cookieKey(cookie), cookieSig(cookie)]))
    })
    // Restoring the last session keeps the cookies that last a session, as many sites' logins do.
    const proc = spawn(executable, [`--user-data-dir=${folder}`, '--no-first-run', '--no-default-browser-check', '--restore-last-session', ...(url ? [url] : [])], { stdio: 'ignore' })
    Object.assign(signing, { proc, seen })
    signing.done = new Promise(resolve => proc.once('exit', () => signedIn().finally(resolve)))
  } catch {
    signing = null
    notifySigning()
  }
}

/** Done signing in: the sign-in Chrome quits, as ⌘Q would, and what it signed in to is read. */
function finishSignIn() {
  const proc = signing?.proc
  const running = () => proc.exitCode === null && proc.signalCode === null
  if (!proc || !running()) return
  // Asked to quit, as that one app: on SIGTERM Chrome exits without saving the cookies it set lately.
  // Killed if it won't, which loses those.
  execFile('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${proc.pid}).terminate`], () => {})
  setTimeout(() => running() && proc.kill('SIGTERM'), 8000)
}

async function signedIn() {
  const { asking, seen } = signing
  let landed
  try {
    await inHeadless(profileFolder(SIGN_IN), ['--restore-last-session'], async client => {
      // The tabs it restores are where you were; the last is where you finished.
      for (let waited = 0; !landed && waited < 1500; waited += 100) {
        const { targetInfos } = await client.send('Target.getTargets')
        landed = targetInfos.filter(t => t.type === 'page' && /^https?:/.test(t.url)).at(-1)?.url
        if (!landed) await sleep(100)
      }
      const { cookies } = await client.send('Storage.getCookies')
      takeLogins(seen, cookies)
    })
    await Promise.all([...browsers.values()].map(entry => entry.turn))
  } catch {}
  signing = null
  notifySigning()
  const view = asking && views.get(asking)
  if (view?.attached) view.client.send(landed ? 'Page.navigate' : 'Page.reload', landed ? { url: landed } : {}, view.attached).catch(() => {})
}

const isSigningIn = () => !!signing

// Moves a session's Chrome to a window of its own, or back: it restarts on the same profile and page, and
// chrome-devtools-mcp reconnects through the door on its next call.
async function setWindowed(id, windowed) {
  modes.set(id, windowed)
  const entry = browsers.get(id)
  if (!entry || entry.windowed === windowed) return
  let url
  try {
    const pages = (await (await fetch(`http://127.0.0.1:${entry.port}/json/list`)).json()).filter(t => t.type === 'page')
    url = (pages.find(t => t.id === views.get(id)?.shown) ?? pages[0])?.url
  } catch {}
  await quitChrome(entry)
  await ensureBrowser(id, { window: windowed }, url || 'about:blank').catch(() => {})
}

/** The session ended: its Chrome closes and its profile goes with it. */
function closeBrowser(id) {
  ended.add(id)
  doors.get(id)?.server.close()
  doors.delete(id)
  modes.delete(id)
  const entry = browsers.get(id)
  browsers.delete(id)
  if (!entry) return fs.rmSync(profileFolder(id), { recursive: true, force: true })
  const gone = new Promise(resolve => entry.proc.once('exit', () => {
    fs.rmSync(profileFolder(id), { recursive: true, force: true })
    if (closing.get(id) === gone) closing.delete(id)
    resolve()
  }))
  closing.set(id, gone)
  // What it signed in to lasts beyond it.
  Promise.race([syncLogins(entry), sleep(2000)]).finally(() => entry.proc.kill())
}

/** The demo day's browser for a session that runs no shell, headless in Own Term, at the page given. */
async function openDemoBrowser(id, url) {
  // The session was closed with the last demo day; its Chrome must be gone before a new one takes its folder.
  await closing.get(id)
  ended.delete(id)
  // Invented content only: your logins stay out of it, and its cookies out of them.
  return ensureBrowser(id, { window: false, logins: false }, url)
}

/** Quitting: every Chrome closes, saving its logins, and the profiles stay for the sessions that reopen. */
async function closeAllBrowsers() {
  const all = [...browsers.values()]
  browsers.clear()
  if (signing?.proc) {
    finishSignIn()
    await signing.done
  }
  await Promise.all(all.map(quitChrome))
  saveLogins(true)
}

module.exports = { openDoor, openDemoBrowser, closeBrowser, closeAllBrowsers, closeAllLeftovers, watchBrowser, frameDrawn, browserStates, onBrowserViews, browserInput, setWindowed, signIn, finishSignIn, isSigningIn }
