import { Terminal, type IDecoration } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchResultChangeEvent } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { getState, setState, setStatus, updateSession, type Session, type SessionState } from './store'
import { refreshGit } from './git'
import { addLinks } from './links'
import { pinInput } from './pinned'
import { askAbout, claudeCheck } from './ask'
import { smoothScroll, type Scroller } from './smooth'
import { onThemeChange, terminalTheme } from './themes'
import { DEMO_SCRIPTS } from './demo-data'

// Each session's terminal lives here, outside React, so moving its pane between groups and
// splits only re-parents the element instead of losing scrollback.
interface Entry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  el: HTMLDivElement
  opened: boolean
  running: boolean
  /** A demo transcript, laid out for the terminal's width and redrawn when it changes, as Claude would. */
  demo?: string
  demoCols?: number
  /** Draws on the GPU while the terminal is on screen, and for a while after; see useGpu. */
  gpu?: WebglAddon
  /** When the terminal last left the screen; see keepGpus. */
  hiddenAt?: number
  /** The size the shell was last told, as cols x rows, and when; see tellShell. */
  told?: string
  toldAt?: number
  /** Output held back while a resize waits for the program's repaint; see resizeWhole. */
  held?: string[]
  /** Told a narrower size, and keeping its width until the program's output goes quiet; see narrowLater. */
  narrowing?: boolean
  /** When output last cleared lines, as Claude's repaint for a new size starts by doing; see narrowLater. */
  erasedAt?: number
  /** Started with Claude in it, which counts before Claude's hooks report it running. */
  claude?: boolean
  /** The size log has the wait for a measured size; see fit. */
  unmeasuredLogged?: boolean
  /** When output last arrived, when it was last fitted after layout, and when its size last changed; see settled. */
  outputAt?: number
  fittedAt?: number
  resizedAt?: number
  /** Rows the screen is shifted down by; see alignBottom. */
  offset: number
  /** Empty rows under the input, and whether the view keeps them out of sight; see alignBottom. */
  blank: number
  following: boolean
  /** Moves the view itself; see smoothScroll. */
  scroller?: Scroller
  /** Pixels the screen is shifted up by, for the part of a row scrolled; see smoothScroll. */
  shift: number
  /** Waiting for its pane to be measured before the shell starts; see ensureRunning. */
  pending?: Session
  /** Live output is skipped until the replay arrives, since the replay already holds it. */
  awaitingReplay?: boolean
  /** The replay is being parsed; see the OSC 133 handler. */
  replaying?: boolean
  /** Ticks beside the scrollbar where a turn began, finished or asked for you; see markTurn. */
  marks: { kind: MarkKind; decoration: IDecoration }[]
}

const entries = new Map<string, Entry>()
if (import.meta.env.DEV) Object.assign(window, { terms: entries })

/** What the user types into a session, and each time its shell shows a prompt (so nothing runs in the foreground). */
export const onUserInput = new Set<(id: string, data: string) => void>()
export const onShellPrompt = new Set<(id: string) => void>()

/**
 * What's typed in Claude's input box in a session, read off its screen: the text after the last `❯`
 * on screen. Claude draws its placeholder dimmed, so dim text isn't a draft. Undefined when the
 * session has no terminal in this window to read.
 */
export function claudeDraft(id: string): string | undefined {
  const entry = entries.get(id)
  if (!entry) return undefined
  const buffer = entry.term.buffer.active
  for (let y = buffer.length - 1; y >= Math.max(0, buffer.length - entry.term.rows); y--) {
    const line = buffer.getLine(y)
    const start = line?.translateToString(true).search(/❯/) ?? -1
    if (!line || start < 0) continue
    let draft = ''
    for (let x = start + 1; x < line.length; x++) {
      const cell = line.getCell(x)
      if (cell && !cell.isDim()) draft += cell.getChars() || ' '
    }
    return draft.trim()
  }
  return ''
}

/** Types into a session as if from its keyboard, so the listeners above hear it too. */
export function sendInput(id: string, data: string) {
  window.deck.write(id, data)
  onUserInput.forEach(listener => listener(id, data))
}

let focusedId: string | null = null

onThemeChange(() => {
  markColors = undefined
  for (const [id, entry] of entries) {
    entry.term.options.theme = rulerTheme()
    for (const { kind, decoration } of entry.marks) decoration.options.overviewRulerOptions = rulerMark(kind)
    // Demo transcripts carry their own colors, so they're drawn again in the new appearance.
    entry.demoCols = undefined
    playDemo(id)
  }
})

window.deck.onData((id, data) => {
  const entry = entries.get(id)
  if (!entry) return
  entry.outputAt = performance.now()
  if (/\x1b\[[0-2]?[JK]/.test(data)) entry.erasedAt = entry.outputAt
  if (entry.awaitingReplay) return
  if (entry.held) entry.held.push(data)
  else entry.term.write(data)
})
window.deck.onExit(id => {
  const entry = entries.get(id)
  if (!entry) return
  entry.running = false
  entry.term.write('\r\n\x1b[2m[process exited — click the session to restart]\x1b[0m\r\n')
  setStatus(id, 'exited')
})

function create(session: Session): Entry {
  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    theme: rulerTheme(),
    // Drawn under xterm's overlay scrollbar, which keeps taking the clicks and drags.
    overviewRuler: { width: 8 },
    // Programs that assume a dark background, Claude Code's default theme among them, print colors
    // too faint to read on white; xterm darkens those until they reach this contrast.
    minimumContrastRatio: 3,
    // Links a program prints as OSC 8 hyperlinks; the main process opens only http(s).
    linkHandler: { activate: (_event, uri) => window.open(uri) },
    // Off, as in Terminal: on most non-US layouts Option types @, $, |, [ ], { } and a backslash.
    macOptionIsMeta: false,
    scrollback: 10000,
    // Typing while scrolled up stays where you're reading; the pinned input shows what you type, and
    // Enter takes you down (below).
    scrollOnUserInput: false,
    // xterm scrolls a trackpad's pixels by 1.25; this makes it 1:1 with the fingers, as elsewhere in macOS.
    scrollSensitivity: 0.8,
    smoothScrollDuration: 100,
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  const el = document.createElement('div')
  el.className = 'term-host'
  const id = session.id
  pinInput(term, el, terminalTheme)
  askAbout(term, el, id)

  term.onData(data => {
    if (data.includes('\r') && !entry.following) {
      entry.following = true
      term.scrollToBottom()
      alignBottom(entry)
    }
    sendInput(id, data)
  })
  const cwd = () => getState().sessions.find(s => s.id === id)?.cwd ?? window.deck.homeDir
  addLinks(term, cwd)
  term.parser.registerOscHandler(7, data => {
    try {
      const folder = decodeURIComponent(new URL(data).pathname)
      if (folder !== cwd()) updateSession(id, { cwd: folder })
    } catch {}
    return true
  })
  // The shell integration sends OSC 133: A where a prompt starts, C when its command runs,
  // and D;<exit code> on the blank line after the output.
  let inputArea: IDecoration | undefined
  // Claude's hooks own the status while it runs; these only move a shell between idle and running.
  const shellStatus = (from: SessionState, to: SessionState) => (getState().status[id] ?? 'idle') === from && setStatus(id, to)
  term.parser.registerOscHandler(133, data => {
    // A replay re-reads marks that are long past, so they draw but don't change any status.
    const live = !entries.get(id)?.replaying
    if (data.startsWith('A')) {
      if (live) shellStatus('running', 'idle')
      // Claude has exited back to the shell.
      if (live) entry.claude = false
      if (live) onShellPrompt.forEach(listener => listener(id))
      inputArea?.dispose()
      inputArea = term.registerDecoration({ marker: term.registerMarker(0), layer: 'bottom' })
      inputArea?.onRender(el => el.classList.add('input-area'))
    } else if (data.startsWith('C')) {
      if (live) shellStatus('idle', 'running')
      inputArea?.dispose()
      inputArea = undefined
    } else if (data.startsWith('D')) {
      refreshGit(id)
      const failed = Number(data.split(';')[1] ?? 0) !== 0
      term.registerDecoration({ marker: term.registerMarker(0), layer: 'bottom' })?.onRender(el => {
        el.classList.add('command-separator')
        el.classList.toggle('failed', failed)
      })
    }
    return true
  })
  term.onTitleChange(title => setState(s => ({ titles: { ...s.titles, [id]: title } })))
  term.attachCustomKeyEventHandler(e => {
    // Claude Code reads ESC+CR as a newline in its prompt, the same as Option+Enter.
    if (e.key === 'Enter' && e.shiftKey) {
      if (e.type === 'keydown') window.deck.write(id, '\x1b\r')
      return false
    }
    // Option isn't Meta (it types characters on many layouts), so the Option keys shells and Claude
    // use for newline, word delete and word moves are sent as their Meta sequences here.
    const meta = { Enter: '\x1b\r', Backspace: '\x1b\x7f', ArrowLeft: '\x1bb', ArrowRight: '\x1bf' }[e.key]
    if (e.altKey && !e.metaKey && !e.ctrlKey && meta) {
      if (e.type === 'keydown') window.deck.write(id, meta)
      return false
    }
    // As in Warp: Cmd+arrows go to the start or end of the line, and Cmd+Backspace deletes it, as the
    // Ctrl+A, Ctrl+E and Ctrl+U that shells and Claude read.
    const line = { ArrowLeft: '\x01', ArrowRight: '\x05', Backspace: '\x15' }[e.key]
    if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && line) {
      if (e.type === 'keydown') window.deck.write(id, line)
      return false
    }
    // Leave the other Cmd shortcuts to the app menu.
    return !e.metaKey
  })

  const entry: Entry = { term, fit, search, el, opened: false, running: false, offset: 0, shift: 0, blank: 0, following: true, marks: [] }
  entries.set(id, entry)
  return entry
}

/**
 * Starts the session's shell, resuming the Claude conversation that was running in it, or reconnects
 * after a window reload. Until its pane is on screen and measured the terminal is 80×24, so the start
 * waits for that: a shell or a replay at the wrong width wraps everything Claude has drawn.
 */
export function ensureRunning(session: Session) {
  const entry = entries.get(session.id) ?? create(session)
  if (entry.running) return
  entry.running = true
  if (session.demo) {
    entry.demo = session.demo
    playDemo(session.id)
    return
  }
  if (entry.opened) start(entry, session)
  else entry.pending = session
}

const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

async function start(entry: Entry, session: Session) {
  trace(session.id, entry, 'starting shell', { name: session.name, resume: !!session.claudeSessionId, claude: !!session.runClaude })
  entry.pending = undefined
  entry.awaitingReplay = true
  entry.claude = !!(session.claudeSessionId || session.runClaude)
  try {
    const replay = await window.deck.start({
      id: session.id,
      cwd: session.cwd,
      command: session.claudeSessionId ? `claude --resume ${session.claudeSessionId}`
        : session.runClaude ? (session.firstPrompt ? `claude -- ${shellQuote(session.firstPrompt)}` : 'claude')
        : undefined,
      cols: entry.term.cols,
      rows: entry.term.rows,
    })
    if (replay) {
      entry.replaying = true
      entry.term.write(replay, () => {
        entry.replaying = false
        rebuildMarks(session.id)
      })
    }
    // A new shell starts at this size; one that was already running may be another, so it's told.
    else entry.told = `${entry.term.cols}x${entry.term.rows}`
  } catch (error) {
    // Lets clicking the session try again.
    entry.running = false
    entry.term.write(`\r\n\x1b[31mCouldn't start the shell: ${(error as Error).message}\x1b[0m\r\n`)
    return
  } finally {
    entry.awaitingReplay = false
  }
  // From here on the session reopens whatever was running in it: Claude via resume, or the shell.
  if (session.runClaude) updateSession(session.id, { runClaude: false, firstPrompt: undefined })
  if (getState().status[session.id] === 'exited') setStatus(session.id, 'idle')
}

export function attach(id: string, container: HTMLElement) {
  const entry = entries.get(id)
  if (!entry) return
  container.appendChild(entry.el)
  if (!entry.opened) {
    entry.term.open(entry.el)
    entry.term.textarea?.addEventListener('focus', () => (focusedId = id))
    entry.term.onRender(() => alignBottom(entry))
    entry.scroller = smoothScroll(entry.term, {
      shift: px => {
        if (px === entry.shift) return
        entry.shift = px
        place(entry)
      },
      // Scrolling up leaves the bottom alone; coming back down, or typing, follows it again.
      moved: row => {
        const buffer = entry.term.buffer.active
        entry.following = row >= buffer.baseY - Math.min(entry.blank, buffer.baseY)
        if (entry.following) queueMicrotask(() => alignBottom(entry))
      },
    })
    entry.opened = true
  }
  useGpu(entry)
  wake(entry.term)
  // At once, so it isn't first drawn at its old size; again once the layout is done, when the shell
  // hears the size and a waiting one starts.
  fit(id, true)
  // A session you open shows its latest output, wherever it was scrolled to when it was last seen.
  entry.following = true
  entry.term.scrollToBottom()
  alignBottom(entry)
  entry.term.refresh(0, entry.term.rows - 1)
  drawNow(entry.term)
  requestAnimationFrame(() => {
    fit(id)
    playDemo(id)
  })
}

/**
 * Keeps the last line with anything on it at the bottom of the pane. Claude's input grows, for a
 * file list, and shrinks back, leaving empty rows under it: those are scrolled out of sight with
 * scrollback, and while there's less than a screenful the drawing moves down instead. Only the
 * drawing moves: xterm maps the mouse through the element's on-screen position, so clicks still
 * line up. Someone who has scrolled up stays where they are.
 */
function alignBottom(entry: Entry) {
  const { term } = entry
  const buffer = term.buffer.active
  // The scrollbar is only shown with somewhere to scroll to (see .scrollable in styles.css).
  entry.el.classList.toggle('scrollable', buffer.baseY > 0)
  entry.blank = 0
  if (buffer.type === 'normal') {
    let last = buffer.cursorY
    for (let y = term.rows - 1; y > last; y--) {
      if (buffer.getLine(buffer.baseY + y)?.translateToString(true).trim()) {
        last = y
        break
      }
    }
    entry.blank = term.rows - 1 - last
  }
  const lift = Math.min(entry.blank, buffer.baseY)
  // The empty rows can't be scrolled to at all, so a hard swipe stops at the input instead of
  // overshooting into them and being pulled back.
  entry.scroller?.stopShort(lift)
  if (entry.following && buffer.viewportY !== buffer.baseY - lift) entry.scroller?.jump(buffer.baseY - lift)
  const offset = entry.following ? entry.blank - lift : 0
  if (offset === entry.offset) return
  entry.offset = offset
  place(entry)
}

function place(entry: Entry) {
  const screen = entry.term.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!screen) return
  const y = entry.offset ? (entry.offset * screen.clientHeight) / entry.term.rows : entry.shift
  screen.style.transform = y ? `translateY(${y}px)` : ''
}

function playDemo(id: string) {
  const entry = entries.get(id)
  if (!entry?.demo || !entry.opened || entry.el.clientWidth === 0 || entry.demoCols === entry.term.cols) return
  entry.demoCols = entry.term.cols
  entry.term.reset()
  entry.term.write(DEMO_SCRIPTS[entry.demo].transcript(entry.term.cols))
}

export function detach(id: string, container: HTMLElement) {
  const entry = entries.get(id)
  if (entry?.el.parentElement !== container) return
  container.removeChild(entry.el)
  entry.hiddenAt = performance.now()
  keepGpus()
}

// Terminals off screen that keep their GPU renderer, the most recently shown first.
const KEPT_GPUS = 5

// The last few terminals shown keep their GPU renderer, the biggest cost of opening a pane; the rest
// give theirs back, since only about 16 contexts are allowed.
function keepGpus() {
  const hidden = [...entries.values()].filter(e => e.gpu && !e.el.isConnected).sort((a, b) => (b.hiddenAt ?? 0) - (a.hiddenAt ?? 0))
  for (const entry of hidden.slice(KEPT_GPUS)) {
    entry.gpu?.dispose()
    entry.gpu = undefined
  }
}

// WebGL redraws a screen far faster than the DOM renderer, so fast scrolling keeps up. Terminals on
// screen and a few recent ones hold a context (keepGpus); without one xterm draws with the DOM.
function useGpu(entry: Entry) {
  if (entry.gpu) return
  try {
    const gpu = new WebglAddon()
    gpu.onContextLoss(() => {
      gpu.dispose()
      if (entry.gpu === gpu) entry.gpu = undefined
    })
    entry.term.loadAddon(gpu)
    entry.gpu = gpu
  } catch {}
}

let holding = 0

/**
 * Keeps terminals at their size while the layout animates, then fits them once at the end, so the
 * shells and Claude redraw once instead of on every frame.
 */
export function holdFit(ms: number) {
  clearTimeout(holding)
  holding = window.setTimeout(() => {
    holding = 0
    for (const [id, entry] of entries) {
      if (entry.el.isConnected) resizeWhole(id, entry)
      else fit(id)
    }
  }, ms)
}

// Resizes a terminal on screen from its old picture straight to the new: the program hears the size
// first, its repaint is held until quiet, then resize and repaint apply with drawing paused.
function resizeWhole(id: string, entry: Entry): void {
  const size = entry.fit.proposeDimensions()
  const changes = size && (size.cols !== entry.term.cols || size.rows !== entry.term.rows)
  // Held output may still be laid out for the old width, which a narrower terminal would scramble.
  const narrower = size && size.cols < entry.term.cols
  if (!size || !changes || narrower || !entry.running || entry.demo || entry.held || !entry.opened) return fit(id)
  trace(id, entry, 'resizing whole', { to: `${size.cols}x${size.rows}` })
  entry.held = []
  const toldAt = performance.now()
  entry.told = `${size.cols}x${size.rows}`
  entry.toldAt = toldAt
  // Counts as a tell, so a change right after it is taken as a run (see tellShell); a tell still
  // waiting would send the old size in the middle of this one.
  const run = resizing.get(id) ?? { last: 0 }
  clearTimeout(run.timer)
  run.timer = undefined
  run.last = toldAt
  resizing.set(id, run)
  window.deck.resize(id, size.cols, size.rows)
  const check = () => {
    const now = performance.now()
    const answered = (entry.outputAt ?? 0) >= toldAt
    if (now - toldAt < SETTLE_CAP_MS && (!answered || now - entry.outputAt! < QUIET_MS)) {
      window.setTimeout(check, 8)
      return
    }
    const held = entry.held!.join('')
    entry.held = undefined
    pause(entry.term)
    // The pane may have changed again meanwhile; this fits whatever it is now.
    fit(id)
    entry.term.write(held, () => {
      wake(entry.term)
      entry.term.refresh(0, entry.term.rows - 1)
      drawNow(entry.term)
    })
  }
  check()
}

// Stops xterm drawing until wake, which then redraws and resizes; a redraw already queued would still
// run, so it's dropped.
function pause(term: Terminal) {
  const service = (term as unknown as { _core: { _renderService?: { _isPaused?: boolean; _needsFullRefresh?: boolean; _renderDebouncer?: { _animationFrame?: number } } } })
    ._core._renderService
  if (!service) return
  service._isPaused = true
  service._needsFullRefresh = true
  const debouncer = service._renderDebouncer
  if (debouncer?._animationFrame) {
    cancelAnimationFrame(debouncer._animationFrame)
    debouncer._animationFrame = undefined
  }
}

/** Fits a terminal to its pane; `early` only sizes and draws it, since its layout may not be final. */
export function fit(id: string, early = false, narrowNow = false): void {
  const entry = entries.get(id)
  // Held: resizeWhole fits it once the program's repaint has come in.
  if (holding || !entry?.opened || entry.held || entry.el.clientWidth === 0) return
  if (!narrowNow && narrowLater(id, entry, early)) return
  const { cols, rows } = entry.term
  entry.fit.fit()
  if (entry.term.cols !== cols || entry.term.rows !== rows) {
    trace(id, entry, early ? 'fitted early' : 'fitted', { from: `${cols}x${rows}` })
    entry.resizedAt = performance.now()
    drawNow(entry.term)
  }
  if (early) return
  entry.fittedAt = performance.now()
  tellShell(id, entry)
  playDemo(id)
  // The first real size is the one a waiting shell starts at. Before xterm has measured a cell there's
  // no size, and the terminal is still 80×24: Claude would print the conversation it resumes that wide.
  if (entry.pending && entry.fit.proposeDimensions()) start(entry, entry.pending)
  else if (entry.pending) {
    if (!entry.unmeasuredLogged) trace(id, entry, 'waiting for a measured size')
    entry.unmeasuredLogged = true
    requestAnimationFrame(() => fit(id))
  }
  // This runs after layout, before paint: a pane that settles now is shown in this same frame.
  settling.forEach(check => check())
}

// A resize clears the GPU canvas and xterm redraws a frame later, so the pane would show empty: this
// draws now. Private names: see smooth.ts.
function drawNow(term: Terminal) {
  const debouncer = (term as unknown as { _core: { _renderService?: { _renderDebouncer?: { _animationFrame?: number; _innerRefresh?: () => void } } } })
    ._core._renderService?._renderDebouncer
  if (!debouncer?._animationFrame || !debouncer._innerRefresh) return
  cancelAnimationFrame(debouncer._animationFrame)
  debouncer._innerRefresh()
}

// xterm resumes a terminal that's back on screen only when its IntersectionObserver reports, a frame
// or two later, blank or at its old size until then: this resumes it now. Private names: see smooth.ts.
function wake(term: Terminal) {
  const service = (term as unknown as { _core: { _renderService?: { _handleIntersectionChange?: (e: Partial<IntersectionObserverEntry>) => void } } })
    ._core._renderService
  service?._handleIntersectionChange?.({ isIntersecting: true, intersectionRatio: 1 })
}

// Claude places each word at a column. Output laid out for a wider terminal, parsed at a narrower one,
// piles every word past the edge into the last column: so the program hears first, xterm narrows once quiet.
function narrowLater(id: string, entry: Entry, early: boolean): boolean {
  const size = entry.fit.proposeDimensions()
  if (!size || size.cols >= entry.term.cols || !entry.running || entry.demo || entry.pending) return false
  if (early) return true
  tellShell(id, entry, size.cols, size.rows)
  if (entry.narrowing) return true
  entry.narrowing = true
  trace(id, entry, 'narrowing later', { to: `${size.cols}x${size.rows}` })
  const check = () => {
    const now = performance.now()
    const toldAt = entry.toldAt ?? 0
    // Claude finishes what it was printing for the old width, resuming a conversation say, before it
    // repaints for the new one, so only the repaint answers.
    const claude = entry.claude || claudeCheck.running(id)
    const answered = ((claude ? entry.erasedAt : entry.outputAt) ?? 0) >= toldAt
    const waiting = resizing.get(id)?.timer !== undefined || now - toldAt < (claude ? NARROW_CAP_MS : SETTLE_CAP_MS)
      && (!answered || now - entry.outputAt! < QUIET_MS)
    if (waiting && entries.get(id) === entry) {
      window.setTimeout(check, 8)
      return
    }
    entry.narrowing = false
    trace(id, entry, 'narrowing now', { waited: Math.round(now - toldAt), answered })
    fit(id, false, true)
  }
  check()
  return true
}

const resizing = new Map<string, { timer?: number; last: number }>()

// The size log (electron/sizelog.cjs) has why a terminal took each size, beside what its shell was told.
function trace(id: string, entry: Entry, event: string, details: object = {}) {
  const { view, page } = getState()
  window.deck.logSize(id, event, {
    term: `${entry.term.cols}x${entry.term.rows}`,
    proposed: entry.fit.proposeDimensions() ?? null,
    pane: entry.el.clientWidth,
    visible: document.visibilityState,
    view: view?.kind,
    page: !!page,
    ...details,
  })
}

// Tells the shell its size: at once for a single change, since xterm shows the program's screen rewrapped
// until it repaints; in a run of changes, a drag, once it settles, since Claude repaints for every size.
function tellShell(id: string, entry: Entry, cols = entry.term.cols, rows = entry.term.rows) {
  if (`${cols}x${rows}` === entry.told) return
  const run = resizing.get(id) ?? { last: 0 }
  resizing.set(id, run)
  clearTimeout(run.timer)
  const tell = () => {
    run.timer = undefined
    run.last = performance.now()
    entry.told = `${cols}x${rows}`
    entry.toldAt = performance.now()
    window.deck.resize(id, cols, rows)
  }
  // A pane hidden while it settles shows no repaint, so it's told every size at once.
  if (performance.now() - run.last > 150 || hiddenWhileSettling.has(id)) tell()
  else run.timer = window.setTimeout(tell, 80)
}

// A frame and a half: Claude sends its repaint in chunks about a millisecond apart.
const QUIET_MS = 24
// For a program that never repaints when it's resized, or never stops printing.
const SETTLE_CAP_MS = 160
// For Claude narrowing: resuming a long conversation, it prints for a second or more before repainting.
const NARROW_CAP_MS = 3000

// Resolves once a terminal shows its final picture (fitted after layout, its program's repaint for that
// size in, output quiet), with whether that took waiting; until then it shows a rewrap and half a repaint.
const settling = new Set<() => void>()
const hiddenWhileSettling = new Set<string>()

export function settled(id: string, since: number): Promise<boolean> {
  hiddenWhileSettling.add(id)
  return new Promise<boolean>(resolve => {
    let waited = false
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      const entry = entries.get(id)
      const now = performance.now()
      if (entry && now - since < SETTLE_CAP_MS) {
        // A demo has no program to repaint, nor has a shell that exited.
        const repaints = entry.running && !entry.demo
        // Owed: the pane hasn't been fitted to its laid-out size yet (the fit at attach can measure the
        // old layout), or the shell hasn't heard that size, or hasn't answered it.
        const owed = !entry.el.isConnected || (entry.fittedAt ?? 0) < since || (repaints && (
          entry.told !== `${entry.term.cols}x${entry.term.rows}`
          || (entry.toldAt !== undefined && entry.toldAt >= since && (entry.outputAt ?? 0) < entry.toldAt)
        ))
        const recent = (at?: number) => at !== undefined && at >= since && now - at < QUIET_MS
        const busy = recent(entry.outputAt) || recent(entry.resizedAt)
        if (owed || busy) {
          frame = requestAnimationFrame(() => {
            waited = true
            check()
          })
          return
        }
      }
      settling.delete(check)
      if (!entry?.opened) return resolve(waited)
      const draw = () => {
        entry.term.refresh(0, entry.term.rows - 1)
        drawNow(entry.term)
        resolve(waited)
      }
      // Output xterm hasn't parsed yet is let through first; a pane that never waited draws at once,
      // in the frame it was laid out in.
      if (waited) entry.term.write('', draw)
      else draw()
    }
    settling.add(check)
    check()
  }).finally(() => hiddenWhileSettling.delete(id))
}

// Decoration colors must be #RRGGBB.
const dark = matchMedia('(prefers-color-scheme: dark)')
const matchColors = () => ({
  matchBackground: dark.matches ? '#5a4a12' : '#fff1a8',
  matchOverviewRuler: '#ffd60a',
  activeMatchBackground: dark.matches ? '#9a5b00' : '#ffc46b',
  activeMatchColorOverviewRuler: '#ff9f0a',
})

export type MarkKind = 'prompt' | 'input' | 'done'

const MARK_TOKENS: Record<MarkKind, string> = { prompt: '--secondary', input: '--orange', done: '--accent' }
let markColors: Record<MarkKind, string> | undefined

// The ruler takes only #RRGGBB, so each token is painted over the pane's background and read back,
// which also flattens the translucent ones.
function rulerMark(kind: MarkKind) {
  if (!markColors) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const style = getComputedStyle(document.documentElement)
    const solid = (token: string) => {
      ctx.fillStyle = terminalTheme().background!
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = style.getPropertyValue(token).trim()
      ctx.fillRect(0, 0, 1, 1)
      return '#' + [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(c => c.toString(16).padStart(2, '0')).join('')
    }
    markColors = { prompt: solid(MARK_TOKENS.prompt), input: solid(MARK_TOKENS.input), done: solid(MARK_TOKENS.done) }
  }
  return { color: markColors[kind], position: 'full' as const }
}

// The ruler's border would otherwise be a black line beside the scrollbar.
const rulerTheme = () => ({ ...terminalTheme(), overviewRulerBorder: terminalTheme().background })

/**
 * Ticks the session's ruler, beside its scrollbar, at the line on screen now: where a prompt was sent
 * (the line showing it, when it can be found), where Claude finished, or where it asked for you.
 */
export function markTurn(id: string, kind: MarkKind, prompt?: string, since = performance.now()) {
  const entry = entries.get(id)
  if (!entry) return
  // Stop comes before Claude's last repaint, which redraws the lines around its input box.
  const now = performance.now()
  if (kind === 'done' && now - since < 2000 && now - (entry.outputAt ?? 0) < 200) {
    window.setTimeout(() => markTurn(id, kind, prompt, since), 100)
    return
  }
  const { term } = entry
  const buffer = term.buffer.active
  if (buffer.type !== 'normal') return
  const cursor = buffer.baseY + buffer.cursorY
  let line = cursor
  const needle = prompt?.trim().split('\n')[0].slice(0, 40).trim()
  const text = (y: number) => buffer.getLine(y)?.translateToString(true) ?? ''
  const top = Math.max(0, cursor - term.rows)
  if (needle) {
    for (let y = cursor; y >= top; y--) {
      if (text(y).includes(needle)) {
        line = y
        break
      }
    }
  }
  // The cursor is in Claude's input box, where the next prompt will be echoed: a finished turn is
  // marked on the last line above the box's top border instead.
  if (kind === 'done') {
    let y = cursor
    while (y > top && !text(y).startsWith('───')) y--
    while (y > top && (text(y).startsWith('───') || !text(y).trim())) y--
    if (y > top) line = y
  }
  entry.marks = entry.marks.filter(mark => !mark.decoration.isDisposed)
  const last = entry.marks.at(-1)
  // A question or permission prompt arrives as two or three hooks, as Claude draws it; one tick is enough.
  if (kind !== 'prompt' && last?.kind === kind) return
  const decoration = term.registerDecoration({ marker: term.registerMarker(line - cursor), overviewRulerOptions: rulerMark(kind) })
  if (decoration) entry.marks.push({ kind, decoration })
}

/**
 * Ticks the ruler again from what Claude printed, for output that arrives without its hooks: a replay
 * after a window reload, or a conversation resumed when the app starts.
 */
export function rebuildMarks(id: string, since = performance.now()) {
  const entry = entries.get(id)
  if (!entry) return
  const now = performance.now()
  if (now - since < 3000 && now - (entry.outputAt ?? 0) < 300) {
    window.setTimeout(() => rebuildMarks(id, since), 150)
    return
  }
  const { term } = entry
  const buffer = term.buffer.active
  if (buffer.type !== 'normal') return
  entry.marks.forEach(mark => mark.decoration.dispose())
  entry.marks = []
  const cursor = buffer.baseY + buffer.cursorY
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y)
    const text = line?.translateToString(true) ?? ''
    // A sent prompt has a band behind it; the input box and a shell's prompt don't. Slash commands
    // aren't prompts, and post no prompt hook live either.
    const kind: MarkKind | undefined = /^❯\s[^\s/]/.test(text) && !line?.getCell(0)?.isBgDefault() ? 'prompt'
      : /^✻\s\S+ for \d/.test(text) ? 'done'
      : /^⏺\sUser answered Claude.s questions/.test(text) ? 'input'
      : undefined
    if (!kind) continue
    const decoration = term.registerDecoration({ marker: term.registerMarker(y - cursor), overviewRulerOptions: rulerMark(kind) })
    if (decoration) entry.marks.push({ kind, decoration })
  }
}

/** Searches a session's scrollback: `type` keeps the current match while the query grows. */
export function find(id: string, query: string, direction: 'type' | 'next' | 'previous') {
  const search = entries.get(id)?.search
  if (!search) return
  if (!query) return search.clearDecorations()
  const options = { incremental: direction === 'type', decorations: matchColors() }
  if (direction === 'previous') search.findPrevious(query, options)
  else search.findNext(query, options)
}

export function onFindResults(id: string, listener: (e: ISearchResultChangeEvent) => void) {
  return entries.get(id)?.search.onDidChangeResults(listener)
}

export function clearFind(id: string) {
  entries.get(id)?.search.clearDecorations()
}

export function endFind(id: string) {
  clearFind(id)
  focus(id)
}

export function focus(id: string) {
  entries.get(id)?.term.focus()
}

export function clear(id: string | null) {
  if (id) entries.get(id)?.term.clear()
}

export function focusedSession() {
  return focusedId
}

export function copySelection() {
  const term = focusedId && document.activeElement === entries.get(focusedId)?.term.textarea
    ? entries.get(focusedId)!.term
    : null
  if (term?.hasSelection()) navigator.clipboard.writeText(term.getSelection())
  else document.execCommand('copy')
}

export function kill(id: string) {
  window.deck.kill(id)
  entries.get(id)?.term.dispose()
  entries.delete(id)
}
