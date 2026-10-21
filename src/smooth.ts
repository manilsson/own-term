import type { Terminal } from '@xterm/xterm'

// xterm's scroll position is in pixels, but it draws whole rows, so a trackpad's continuous scroll
// shows up as row-high jumps. This reports the part of a row xterm hasn't drawn yet, for the screen
// to be shifted by. It reaches into xterm's viewport, whose names are those of @xterm/xterm 6.0.

interface ScrollEvent {
  scrollTop: number
}

interface Viewport {
  _scrollableElement: {
    _scrollable: { _smoothScrolling: object | null }
    setScrollDimensions(dimensions: { height?: number; scrollHeight?: number }): void
    getScrollPosition(): ScrollEvent
    onScroll(listener: (e: ScrollEvent) => void): { dispose(): void }
  }
  _renderService: { dimensions: { css: { cell: { height: number } } } }
  _bufferService: { buffer: { ydisp: number } }
  _onRequestScrollLines: { fire(lines: number): void }
  _latestYDisp?: number
  _isHandlingScroll: boolean
  _suppressOnScrollHandler: boolean
  _handleScroll(e: ScrollEvent): void
  scrollToLine(line: number, disableSmoothScroll?: boolean): void
}

interface RenderDebouncer {
  _animationFrame?: number
  _innerRefresh(): void
}

interface Hooks {
  /** The pixels (0 to almost a row, upward) to move the screen by. */
  shift(px: number): void
  /** The first row on screen moved for any reason but output: a scroll, find, or typing. */
  moved(row: number): void
}

/** What smoothScroll hands back to move the view itself. */
export interface Scroller {
  /** Puts a row at the top of the screen at once. */
  jump(row: number): void
  /** Ends the scroll range this many rows above the buffer's bottom. */
  stopShort(rows: number): void
}

/** Call after term.open. */
export function smoothScroll(term: Terminal, { shift, moved }: Hooks): Scroller | undefined {
  const core = (term as unknown as { _core: { _viewport?: Viewport; _renderService?: { _renderDebouncer?: RenderDebouncer } } })._core
  const viewport = core._viewport
  const debouncer = core._renderService?._renderDebouncer
  if (!viewport?._scrollableElement || !viewport._handleScroll || !debouncer?._innerRefresh) return
  const rowHeight = () => viewport._renderService.dimensions.css.cell.height
  // Within a pixel of a row's top counts as that row, which also absorbs the rounding of the
  // screen's height at the very bottom.
  const rowAt = (scrollTop: number) => Math.floor((scrollTop + 1) / rowHeight())

  // xterm rounds to the nearest row, which would leave a gap above the screen half the time; this
  // takes the row at or above, so the gap is below, where the pinned input covers it. Output moves
  // the rows without a difference here, so only the other moves are reported.
  let jumping = false
  viewport._handleScroll = function (e) {
    if (this._isHandlingScroll || this._suppressOnScrollHandler) return
    this._isHandlingScroll = true
    const row = rowAt(e.scrollTop)
    const diff = row - this._bufferService.buffer.ydisp
    if (diff !== 0) {
      this._latestYDisp = row
      this._onRequestScrollLines.fire(diff)
      if (!jumping) moved(row)
    }
    this._isHandlingScroll = false
  }

  // The first row on screen, which the shift is measured from.
  let drawn = term.buffer.active.viewportY
  const update = () => {
    const px = drawn * rowHeight() - viewport._scrollableElement.getScrollPosition().scrollTop
    // Further than that, output has moved the rows and the scroll position is catching up. Whole
    // device pixels keep text that comes to rest between two rows sharp.
    shift(Math.abs(px) < 2 * rowHeight() ? Math.round(px * devicePixelRatio) / devicePixelRatio : 0)
  }
  viewport._scrollableElement.onScroll(() => {
    // A mouse wheel's scroll animates in animation frames, and rows xterm moves to there would only
    // be drawn in the next one, a frame after the shift: they're drawn now instead. A trackpad's
    // scroll comes from input events, which can arrive several to a frame, so it waits for the frame.
    const animating = viewport._scrollableElement._scrollable._smoothScrolling !== null
    if (animating && term.buffer.active.viewportY !== drawn && debouncer._animationFrame !== undefined) {
      cancelAnimationFrame(debouncer._animationFrame)
      debouncer._innerRefresh()
    }
    update()
  })
  term.onRender(() => {
    drawn = term.buffer.active.viewportY
    update()
  })

  // Rows at the bottom the scroll range leaves out: the range is how far a swipe can carry, so
  // stopping it short ends a swipe there, where pulling the view back each frame would shake it.
  let short = 0
  const dimensions = viewport._scrollableElement.setScrollDimensions.bind(viewport._scrollableElement)
  viewport._scrollableElement.setScrollDimensions = d =>
    dimensions(d.scrollHeight === undefined ? d : { ...d, scrollHeight: d.scrollHeight - short * rowHeight() })

  return {
    jump(row) {
      jumping = true
      viewport.scrollToLine(row, true)
      jumping = false
    },
    stopShort(rows) {
      if (rows === short) return
      short = rows
      // At once, not on xterm's next sync: a jump right after this has to land inside the new range.
      viewport._scrollableElement.setScrollDimensions({ scrollHeight: term.buffer.active.length * rowHeight() })
    },
  }
}
