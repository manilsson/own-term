import type { Terminal } from '@xterm/xterm'
import { getState } from './store'

// Selecting text Claude printed shows an "Ask about this" button above it, which quotes the text into
// Claude's input in the same session, ready for the question.

/** Whether Claude runs in a session; set by claude.ts, which imports this module's importer. */
export const claudeCheck = { running: (_id: string) => false }

/** The buffer row of Claude's input (its last `❯` on screen), or Infinity when there's none. */
function inputRow(term: Terminal) {
  const buffer = term.buffer.active
  for (let y = buffer.length - 1; y >= Math.max(0, buffer.length - term.rows); y--) {
    if (buffer.getLine(y)?.translateToString(true).includes('❯')) return y
  }
  return Infinity
}

export function askAbout(term: Terminal, host: HTMLElement, id: string) {
  const button = document.createElement('button')
  button.className = 'ask-about'
  button.textContent = 'Ask about this'
  host.appendChild(button)

  const hide = () => button.classList.remove('shown')
  const show = (clientX: number) => {
    const position = term.getSelectionPosition()
    const screen = host.querySelector<HTMLElement>('.xterm-screen')
    if (!position || !screen || !term.getSelection().trim()) return hide()
    // Typed into a question, the quote would answer it; inside the input it's already there.
    if (!claudeCheck.running(id) || getState().status[id] === 'input') return hide()
    if (position.end.y >= inputRow(term)) return hide()
    const area = host.getBoundingClientRect()
    const rect = screen.getBoundingClientRect()
    const rowHeight = rect.height / term.rows
    const top = Math.max(position.start.y - term.buffer.active.viewportY, 0)
    const bottom = position.end.y - term.buffer.active.viewportY + 1
    button.classList.add('shown')
    const above = rect.top - area.top + top * rowHeight - button.offsetHeight - 6
    // Where there's no room above the selection, it goes under it.
    const y = above >= 4 ? above : rect.top - area.top + bottom * rowHeight + 6
    const half = button.offsetWidth / 2 + 8
    const x = Math.min(Math.max(clientX - area.left, half), area.width - half)
    button.style.left = `${x}px`
    button.style.top = `${y}px`
  }

  // Waits for the mouse-up so the button doesn't chase the pointer through a drag.
  host.addEventListener('mouseup', e => {
    if (e.button === 0 && !button.contains(e.target as Node)) setTimeout(() => show(e.clientX))
  })
  term.onSelectionChange(() => term.hasSelection() || hide())
  term.onScroll(hide)
  term.onResize(hide)
  term.onKey(hide)
  host.addEventListener('wheel', hide, { passive: true })
  document.addEventListener('mousedown', e => host.contains(e.target as Node) || hide())

  // Keeps the selection and the terminal's focus through the click.
  button.addEventListener('mousedown', e => e.preventDefault())
  button.addEventListener('click', () => {
    const quote = term.getSelection().trim().split('\n').map(line => `> ${line.trimEnd()}`).join('\n')
    hide()
    term.clearSelection()
    // paste wraps it as a bracketed paste, so the line breaks stay in the input instead of sending it.
    term.paste(`${quote}\n`)
    term.focus()
  })
}
