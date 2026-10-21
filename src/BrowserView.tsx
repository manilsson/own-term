import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AppWindow, Check, Globe, LogIn, Maximize2, Minimize2, X } from 'lucide-react'
import { isSignInPage, onFrames, setPlacement, useBrowser, usePlacement, useSigningIn, type Placement } from './browser'

// DevTools' modifier bits, and its names for mouse buttons.
const modifiers = (e: MouseEvent | KeyboardEvent) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
const BUTTONS = ['left', 'middle', 'right'] as const

// A session's headless browser, live: Chrome's frames drawn scaled to fit, since the page keeps its own
// size, with your mouse, keys and pastes mapped to the page's coordinates.
function BrowserView({ id, actions, onBarDown, onBarDoubleClick, onPageSize, aspect }: {
  id: string
  actions: ReactNode
  onBarDown: (e: ReactPointerEvent) => void
  onBarDoubleClick: () => void
  /** The page's own size changed (the agent emulated a phone, say). */
  onPageSize: (size: { width: number; height: number }) => void
  /** Shapes the page area like the page, unless it fills the pane. */
  aspect?: number
}) {
  const state = useBrowser(id)
  const page = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // The latest callback, read from the frame handler, which is set up once.
  const sizeChanged = useRef(onPageSize)
  sizeChanged.current = onPageSize

  useLayoutEffect(() => {
    const box = page.current!
    const c = canvas.current!
    const context = c.getContext('2d')!
    // The last frame, drawn again when the canvas is resized, which clears it, and the page's own size.
    let last: ImageBitmap | null = null
    let pageSize = { width: 1440, height: 900 }
    /** Where the page shows in the view, in CSS pixels: scaled to fit, centered, at the top. */
    const fitted = () => {
      const { width, height } = box.getBoundingClientRect()
      const scale = Math.min(width / pageSize.width, height / pageSize.height)
      return { x: (width - pageSize.width * scale) / 2, y: 0, scale }
    }
    const paint = () => {
      context.clearRect(0, 0, c.width, c.height)
      if (!last) return
      const { x, y, scale } = fitted()
      const ratio = devicePixelRatio
      context.drawImage(last, x * ratio, y * ratio, pageSize.width * scale * ratio, pageSize.height * scale * ratio)
    }
    let timer = 0
    let reported = false
    const resize = () => {
      const { width, height } = box.getBoundingClientRect()
      const scale = devicePixelRatio
      c.width = Math.round(width * scale)
      c.height = Math.round(height * scale)
      paint()
      // Every new size restarts Chrome's stream, so a drag tells it once it pauses.
      clearTimeout(timer)
      const tell = () => window.deck.watchBrowser(id, width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height), scale } : null)
      if (reported) timer = window.setTimeout(tell, 120)
      else tell()
      reported = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    const off = onFrames(id, async (frame, size) => {
      try {
        const image = await createImageBitmap(new Blob([frame as BlobPart], { type: 'image/jpeg' }))
        last?.close()
        last = image
        if (size.width > 0 && size.height > 0 && (size.width !== pageSize.width || size.height !== pageSize.height)) {
          pageSize = size
          sizeChanged.current(size)
        }
        paint()
      } catch {}
      window.deck.browserFrameDrawn(id)
    })
    // A point in the view, in the page's own coordinates; outside the page, where the view's wider or
    // taller than it, it's kept to the page's edge.
    const at = (e: MouseEvent) => {
      const rect = box.getBoundingClientRect()
      const { x, y, scale } = fitted()
      const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max - 1))
      return { x: clamp((e.clientX - rect.left - x) / scale, pageSize.width), y: clamp((e.clientY - rect.top - y) / scale, pageSize.height) }
    }
    const mouse = (type: string, e: MouseEvent, extra: Record<string, unknown> = {}) =>
      window.deck.browserInput(id, 'mouse', { type, ...at(e), modifiers: modifiers(e), buttons: e.buttons, ...extra })
    let moving: PointerEvent | null = null
    // Pointer events always say 0 clicks, so a double or triple click is counted here, as the system
    // counts it: a press soon after the last, near it, with the same button.
    let press = { time: 0, x: 0, y: 0, button: -1, count: 0 }
    const down = (e: PointerEvent) => {
      box.focus()
      box.setPointerCapture(e.pointerId)
      const now = performance.now()
      const again = now - press.time < 500 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5 && e.button === press.button
      press = { time: now, x: e.clientX, y: e.clientY, button: e.button, count: again ? Math.min(press.count + 1, 3) : 1 }
      mouse('mousePressed', e, { button: BUTTONS[e.button] ?? 'left', clickCount: press.count })
    }
    const up = (e: PointerEvent) => mouse('mouseReleased', e, { button: BUTTONS[e.button] ?? 'left', clickCount: press.count || 1 })
    // At most one move a frame: the page can't show more.
    const move = (e: PointerEvent) => {
      if (!moving) requestAnimationFrame(() => {
        if (moving) mouse('mouseMoved', moving, { button: moving.buttons & 1 ? 'left' : 'none' })
        moving = null
      })
      moving = e
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      // In the page's pixels, so the page moves with your fingers however small it's shown.
      const lines = e.deltaMode === 1 ? 16 : 1
      const { scale } = fitted()
      mouse('mouseWheel', e, { deltaX: (e.deltaX * lines) / scale, deltaY: (e.deltaY * lines) / scale })
    }
    const key = (e: KeyboardEvent) => {
      // ⌘ shortcuts are the app's; ⌘V comes back as a paste (below), through the Edit menu.
      if (e.metaKey) return
      e.preventDefault()
      const text = e.type === 'keydown' && !e.metaKey && !e.ctrlKey ? (e.key === 'Enter' ? '\r' : e.key.length === 1 ? e.key : '') : ''
      window.deck.browserInput(id, 'key', {
        type: e.type === 'keyup' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
        key: e.key,
        code: e.code,
        text,
        unmodifiedText: text,
        windowsVirtualKeyCode: e.keyCode,
        modifiers: modifiers(e),
      })
    }
    // ⌘V reaches the page as a paste of your clipboard's text.
    const paste = (e: ClipboardEvent) => {
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain')
      if (text) window.deck.browserInput(id, 'text', { text })
    }
    box.addEventListener('pointerdown', down)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointermove', move)
    box.addEventListener('wheel', wheel, { passive: false })
    box.addEventListener('keydown', key)
    box.addEventListener('keyup', key)
    box.addEventListener('paste', paste)
    box.addEventListener('contextmenu', e => e.preventDefault())
    return () => {
      observer.disconnect()
      clearTimeout(timer)
      off()
      last?.close()
      window.deck.watchBrowser(id, null)
    }
  }, [id])

  return (
    <div className="browser-view">
      <div className="browser-bar" title={state?.url} onPointerDown={onBarDown} onDoubleClick={onBarDoubleClick}>
        <Globe size={12} strokeWidth={2} />
        <span className="browser-title">{state?.title || 'New page'}</span>
        <span className="browser-url">{state?.url && state.url !== 'about:blank' ? state.url : ''}</span>
        {actions}
      </div>
      <div className="browser-page" ref={page} tabIndex={0} style={aspect ? { aspectRatio: aspect } : undefined}>
        <canvas ref={canvas} />
      </div>
    </div>
  )
}

// The bar above the page, in CSS pixels (.browser-bar), and the narrowest the window gets.
const BAR = 30
const MIN_WIDTH = 220
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

// The browser as a window floating over the terminal, which never resizes for it, shaped like the page
// as a picture-in-picture video is: no empty space, and a phone's page makes it narrow.
export function FloatingBrowser({ id }: { id: string }) {
  const place = usePlacement(id)
  const url = useBrowser(id)?.url ?? ''
  const signing = useSigningIn()
  const self = useRef<HTMLDivElement>(null)
  const aspect = place.aspect ?? 1440 / 900
  // Filling the pane, it's the largest page-shaped window that fits, centered: the pane's own shape
  // would leave a band of nothing beside or under the page.
  const [filled, setFilled] = useState<CSSProperties>()
  useLayoutEffect(() => {
    const el = self.current
    if (!el || !place.expanded || place.closed) return
    const fill = () => {
      const pane = el.parentElement!.getBoundingClientRect()
      const room = { width: pane.width - 12, height: pane.height - 12 - BAR }
      if (room.width <= 0 || room.height <= 0) return
      const width = Math.min(room.width, room.height * aspect)
      const height = width / aspect + BAR
      setFilled({ left: (pane.width - width) / 2, top: 6, width, height })
    }
    fill()
    const observer = new ResizeObserver(fill)
    observer.observe(el.parentElement!)
    return () => observer.disconnect()
  }, [place.expanded, place.closed, aspect])

  const paneBox = () => self.current!.parentElement!.getBoundingClientRect()
  /** The window's height as a share of the pane's, for a width as a share of the pane's. */
  const heightFor = (w: number, pane: DOMRect, a = aspect) => (w * pane.width / a + BAR) / pane.height

  // Read by the effect below, which only rebuilds when its pane or the page's shape can have changed.
  const latest = useRef(place)
  latest.current = place

  // It stays inside the pane: when the pane or the page's shape changes, a window too tall for the
  // room below its top shrinks, then moves up if it's still too tall; one past an edge moves in.
  useLayoutEffect(() => {
    const el = self.current
    if (!el || place.expanded || place.closed) return
    const fit = () => {
      const place = latest.current
      const pane = el.parentElement!.getBoundingClientRect()
      if (!pane.width || !pane.height) return
      let { x, y, w } = place
      w = clamp(w, MIN_WIDTH / pane.width, 1)
      if (y + heightFor(w, pane) > 1) w = clamp((((1 - y) * pane.height - BAR) * aspect) / pane.width, MIN_WIDTH / pane.width, 1)
      y = clamp(y, 0, 1 - heightFor(w, pane))
      x = clamp(x, 0, 1 - w)
      if (Math.abs(w - place.w) > 1e-4 || Math.abs(x - place.x) > 1e-4 || Math.abs(y - place.y) > 1e-4) setPlacement(id, { x, y, w })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el.parentElement!)
    return () => observer.disconnect()
  }, [id, place.expanded, place.closed, aspect])

  if (place.closed) return null

  /** A new page shape keeps the window's height: a phone's page makes it narrow, a desktop's wide. */
  const pageSize = (size: { width: number; height: number }) => {
    const next = size.width / size.height
    if (!self.current || Math.abs(next - aspect) < 0.01) return
    if (place.expanded) return setPlacement(id, { aspect: next })
    const pane = paneBox()
    const pageHeight = (place.w * pane.width) / aspect
    setPlacement(id, { aspect: next, w: (pageHeight * next) / pane.width })
  }

  /** Follows the pointer from `down`, handing `apply` the move in shares of the pane. */
  const track = (down: ReactPointerEvent, apply: (dx: number, dy: number, start: Placement, pane: DOMRect) => Partial<Placement>) => {
    if (down.button !== 0 || (down.target as Element).closest('button')) return
    down.preventDefault()
    const pane = paneBox()
    const start = place
    const move = (e: PointerEvent) => setPlacement(id, apply((e.clientX - down.clientX) / pane.width, (e.clientY - down.clientY) / pane.height, start, pane))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging')
    }
    document.body.classList.add('dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const moveBy = (e: ReactPointerEvent) => {
    if (place.expanded) return
    track(e, (dx, dy, s, pane) => ({ x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - heightFor(s.w, pane)) }))
  }

  // The shape holds: a side edge sets the width, the top or bottom edge the height, and the other
  // follows. The edge opposite the one dragged stays put.
  const resizeFrom = (edge: (typeof EDGES)[number]) => (e: ReactPointerEvent) =>
    track(e, (dx, dy, s, pane) => {
      const perHeight = (pane.height * aspect) / pane.width
      let w = edge.includes('e') ? s.w + dx : edge.includes('w') ? s.w - dx : edge === 'n' ? s.w - dy * perHeight : s.w + dy * perHeight
      w = clamp(w, MIN_WIDTH / pane.width, 1)
      let x = edge.includes('w') ? s.x + s.w - w : edge === 'n' || edge === 's' ? s.x + (s.w - w) / 2 : s.x
      let y = edge.includes('n') ? s.y + heightFor(s.w, pane) - heightFor(w, pane) : s.y
      x = clamp(x, 0, 1 - w)
      y = clamp(y, 0, 1 - heightFor(w, pane))
      return { x, y, w }
    })

  const expand = () => setPlacement(id, { expanded: !place.expanded })
  const style = place.expanded ? filled : { left: `${place.x * 100}%`, top: `${place.y * 100}%`, width: `${place.w * 100}%` }

  return (
    <div ref={self} className={`browser-float ${place.expanded ? 'expanded' : ''}`} style={style}>
      <BrowserView
        id={id}
        aspect={place.expanded ? undefined : aspect}
        onPageSize={pageSize}
        onBarDown={moveBy}
        onBarDoubleClick={expand}
        actions={
          <>
            {signing ? (
              <button className="browser-sign-in" title="Quit the sign-in Chrome: what you signed in to reaches every session’s browser" onClick={() => window.deck.finishSignIn()}>
                <Check size={12} strokeWidth={2.2} />
                Done Signing In
              </button>
            ) : isSignInPage(url) ? (
              <button className="browser-sign-in" title="Sites refuse sign-ins in a browser an agent drives. Sign in to this page in Chrome, and it reaches every session’s browser" onClick={() => window.deck.signIn(id)}>
                <LogIn size={12} strokeWidth={2.2} />
                Sign In in Chrome
              </button>
            ) : (
              <button className="toolbar-button" title="Sign In in Chrome: sites refuse sign-ins in a browser an agent drives" onClick={() => window.deck.signIn(id)}>
                <LogIn size={13} strokeWidth={1.9} />
              </button>
            )}
            <button className="toolbar-button" title="Open in a Chrome Window" onClick={() => window.deck.setBrowserWindowed(id, true)}>
              <AppWindow size={14} strokeWidth={1.8} />
            </button>
            <button className="toolbar-button" title={place.expanded ? 'Restore' : 'Fill the Pane'} onClick={expand}>
              {place.expanded ? <Minimize2 size={13} strokeWidth={1.9} /> : <Maximize2 size={13} strokeWidth={1.9} />}
            </button>
            <button className="toolbar-button" title="Close (the globe in the pane's header opens it again)" onClick={() => setPlacement(id, { closed: true })}>
              <X size={14} strokeWidth={1.9} />
            </button>
          </>
        }
      />
      {!place.expanded && EDGES.map(edge => <div key={edge} className={`browser-edge ${edge}`} onPointerDown={resizeFrom(edge)} />)}
    </div>
  )
}
