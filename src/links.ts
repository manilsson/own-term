import type { IBufferLine, ILink, Terminal } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'

// A path with a file extension, optionally followed by :line or :line:column. It must contain a
// slash or a line number, so version numbers and words like "e.g." don't become links. Every folder
// ends in its own slash, so the pattern can't backtrack exponentially on long lines.
const PATH = /(?:~\/|\.{1,2}\/|\/)?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::(\d+)(?::(\d+))?)?/g

/**
 * The column (1-based) each character of a line's text sits in. They differ after a wide character
 * like an emoji or CJK, which is one character (or two code units) but two columns.
 */
function columnsOf(line: IBufferLine, cols: number) {
  const columns: number[] = []
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    for (let i = 0; i < chars.length; i++) columns.push(x + 1)
  }
  return columns
}

/** Makes file paths Claude prints (`src/x.ts:42`) open in the editor, and URLs open in the browser. */
export function addLinks(term: Terminal, cwd: () => string) {
  term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)))
  term.registerLinkProvider({
    async provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)
      const text = line?.translateToString(true)
      const matches = text ? [...text.matchAll(PATH)].filter(m => m[0].includes('/') || m[1]) : []
      if (matches.length === 0) return callback(undefined)
      const paths = matches.map(m => m[0].replace(/:\d+(?::\d+)?$/, ''))
      const resolved = await window.deck.resolveFiles(cwd(), paths)
      const columns = columnsOf(line!, term.cols)
      const links: ILink[] = []
      matches.forEach((m, i) => {
        const file = resolved[i]
        if (!file) return
        links.push({
          text: m[0],
          range: { start: { x: columns[m.index!], y }, end: { x: columns[m.index! + m[0].length - 1], y } },
          activate: () => window.deck.openFile(file, m[1] ? Number(m[1]) : undefined, m[2] ? Number(m[2]) : undefined),
        })
      })
      callback(links.length ? links : undefined)
    },
  })
}
