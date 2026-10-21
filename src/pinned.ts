import type { IBufferCell, ITheme, Terminal } from '@xterm/xterm'

// The input lives in the terminal's own text, so scrolling up takes it off screen. Warp keeps its
// input box at the bottom; this does the same with a live copy of the bottom rows (the prompt, or
// Claude's input box and status line), shown only while you're scrolled up. You can type into it
// where you are; clicking it, or Enter, goes back down.

const MAX_ROWS = 6
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** One of the 256 palette colors as CSS: the theme's 16, then the 6×6×6 cube and the grays. */
function paletteColor(index: number, theme: ITheme) {
  if (index < 16) {
    const name = index < 8 ? ANSI[index] : `bright${ANSI[index - 8][0].toUpperCase()}${ANSI[index - 8].slice(1)}`
    return theme[name as keyof ITheme] as string
  }
  if (index < 232) {
    const n = index - 16
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${level(Math.floor(n / 36))}, ${level(Math.floor(n / 6) % 6)}, ${level(n % 6)})`
  }
  const gray = 8 + (index - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

function color(cell: IBufferCell, which: 'fg' | 'bg', theme: ITheme) {
  const rgb = which === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  const palette = which === 'fg' ? cell.isFgPalette() : cell.isBgPalette()
  const value = which === 'fg' ? cell.getFgColor() : cell.getBgColor()
  if (rgb) return `#${value.toString(16).padStart(6, '0')}`
  if (palette) return paletteColor(value, theme)
  return undefined
}

/** A buffer row as HTML, one span per run of cells that look the same. */
function rowHtml(term: Terminal, y: number, theme: ITheme, cursorX = -1) {
  const line = term.buffer.active.getLine(y)
  if (!line) return ''
  let html = ''
  let run = ''
  let style = ''
  const flush = () => {
    if (run) html += style ? `<span style="${style}">${run}</span>` : run
    run = ''
  }
  for (let x = 0; x < term.cols; x++) {
    const cell = line.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    let fg = color(cell, 'fg', theme)
    let bg = color(cell, 'bg', theme)
    if (cell.isInverse()) [fg, bg] = [bg ?? (theme.background as string), fg ?? (theme.foreground as string)]
    if (x === cursorX) [fg, bg] = [theme.cursorAccent ?? (theme.background as string), theme.cursor ?? (theme.foreground as string)]
    const next = [
      fg && `color:${fg}`,
      bg && `background:${bg}`,
      cell.isBold() && 'font-weight:700',
      cell.isDim() && 'opacity:.6',
      cell.isItalic() && 'font-style:italic',
      cell.isUnderline() && 'text-decoration:underline',
    ].filter(Boolean).join(';')
    if (next !== style) {
      flush()
      style = next
    }
    const chars = (cell.getChars() || ' ').replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
    // Symbols and emoji advance by their glyph, not the grid, so each gets a box of its cells; like
    // xterm, a glyph wider than its box spills into the next cell.
    run += /^[\x20-\x7e\u2500-\u257f]$/.test(chars) || chars.startsWith('&') ? chars : `<span class="pinned-cell" style="--cells:${cell.getWidth()}">${chars}</span>`
  }
  flush()
  return html
}

/**
 * The rows the input takes: from the row above the cursor (the prompt's first line, or the top edge
 * of Claude's input box) to the last row with anything on it, at most MAX_ROWS.
 */
function inputRows(term: Terminal) {
  const buffer = term.buffer.active
  const cursor = buffer.baseY + buffer.cursorY
  let last = cursor
  for (let y = buffer.baseY + term.rows - 1; y > cursor; y--) {
    if (buffer.getLine(y)?.translateToString(true).trim()) {
      last = y
      break
    }
  }
  const first = Math.max(Math.max(0, cursor - 1), last - MAX_ROWS + 1)
  return { first, last }
}

export function pinInput(term: Terminal, host: HTMLElement, theme: () => ITheme) {
  const bar = document.createElement('div')
  bar.className = 'pinned-input'
  bar.title = 'Back to the bottom'
  bar.addEventListener('mousedown', e => {
    e.preventDefault()
    term.scrollToBottom()
    term.focus()
  })
  host.appendChild(bar)

  // xterm doesn't say whether a program hid its cursor (DECTCEM); returning false lets it handle it too.
  let cursorShown = true
  const dectcem = (shown: boolean) => (params: (number | number[])[]) => {
    if (params.includes(25)) cursorShown = shown
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, dectcem(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, dectcem(false))
  let focused = false
  // The terminal is opened into the host later, so its textarea's focus is heard from here.
  host.addEventListener('focusin', () => ((focused = true), schedule()))
  host.addEventListener('focusout', () => ((focused = false), schedule()))

  let frame = 0
  let shown = false
  let drawn = ''
  let drawnHeight = 0
  let drawnWidth = 0
  let measured = 0
  const advance = () => {
    if (measured) return measured
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 0
    context.font = `${term.options.fontSize}px ${term.options.fontFamily}`
    return (measured = context.measureText('M'.repeat(100)).width / 100)
  }
  const update = () => {
    frame = 0
    const buffer = term.buffer.active
    const { first, last } = inputRows(term)
    // Shown while any of the input's rows is scrolled out of view below the screen.
    const hidden = buffer.type === 'normal' && last >= buffer.viewportY + term.rows
    if (hidden !== shown) {
      shown = hidden
      bar.classList.toggle('shown', hidden)
    }
    if (!hidden) return
    // Scrolling calls this every frame; the bar only changes when the input does.
    const rows: string[] = []
    const cursor = focused && cursorShown ? buffer.baseY + buffer.cursorY : -1
    for (let y = first; y <= last; y++) {
      rows.push(`<div class="pinned-row">${rowHtml(term, y, theme(), y === cursor ? buffer.cursorX : -1) || ' '}</div>`)
    }
    const screen = host.querySelector<HTMLElement>('.xterm-screen')
    const rowHeight = screen ? screen.clientHeight / term.rows : 17
    const cellWidth = screen ? screen.clientWidth / term.cols : advance()
    const html = rows.join('')
    if (html === drawn && rowHeight === drawnHeight && cellWidth === drawnWidth) return
    drawn = html
    drawnHeight = rowHeight
    drawnWidth = cellWidth
    bar.style.setProperty('--row-height', `${rowHeight}px`)
    bar.style.setProperty('--cell-width', `${cellWidth}px`)
    // xterm rounds its cells to device pixels, so the font's own advance drifts off the grid.
    bar.style.letterSpacing = `${cellWidth - advance()}px`
    bar.innerHTML = html
  }
  const schedule = () => (frame ||= requestAnimationFrame(update))
  term.onScroll(schedule)
  term.onRender(schedule)
  term.onCursorMove(schedule)
}
