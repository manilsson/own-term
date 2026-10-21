// Every size a terminal is given, and the width Claude actually draws at, so a session that comes back
// laid out at the wrong width can be traced afterwards. In ~/Library/Logs/Own Term, about 1 MB at most.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const FILE = path.join(app.getPath('logs'), app.isPackaged ? 'terminal-sizes.log' : 'terminal-sizes-dev.log')
const MAX_BYTES = 1_000_000

function sizeLog(id, event, details = {}) {
  try {
    if ((fs.statSync(FILE, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) fs.renameSync(FILE, `${FILE}.1`)
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.appendFileSync(FILE, `${JSON.stringify({ at: new Date().toISOString(), id, event, ...details })}\n`)
  } catch {}
}

// Claude rules its input box with ─ across the width it believes the terminal has. A run can be split
// between chunks of output, so the end of one is carried into the next.
const RULE = /─+/g
const MIN_RULE = 40

function watchClaudeWidth(id, entry, data) {
  const widths = []
  const carry = entry.ruleCarry ?? 0
  entry.ruleCarry = 0
  if (carry && !data.startsWith('─')) widths.push(carry)
  for (const match of data.matchAll(RULE)) {
    const width = match[0].length + (match.index === 0 ? carry : 0)
    if (match.index + match[0].length === data.length) entry.ruleCarry = width
    else widths.push(width)
  }
  const cols = entry.proc.cols
  if (entry.ruleCols !== cols) {
    entry.ruleCols = cols
    entry.ruleSeen = new Set()
  }
  for (const width of widths) {
    if (width < MIN_RULE || entry.ruleSeen.has(width)) continue
    entry.ruleSeen.add(width)
    sizeLog(id, 'claude drew a rule', { width, cols, wider: width > cols })
  }
}

module.exports = { sizeLog, watchClaudeWidth, SIZE_LOG: FILE }
