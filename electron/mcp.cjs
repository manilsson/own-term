// Wraps the user's chrome-devtools MCP command so that in an Own Term shell it drives that session's own
// Chrome (browser.cjs); anywhere else it runs as configured. Wrapped, not replaced, so it can be undone.
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const NAME = 'chrome-devtools'
const DEFAULT = { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@latest'], env: {} }

// Runs the configured command ("$@"), pointed at the session's door when Own Term answers for it.
const WRAPPER = [
  'if [ -n "$DECKTERM_PORT" ] && [ -n "$DECKTERM_SESSION" ] &&',
  'port=$(curl -sf -m 5 -H "X-Deckterm-Token: $DECKTERM_TOKEN" "http://127.0.0.1:$DECKTERM_PORT/browser/$DECKTERM_SESSION")',
  '&& [ -n "$port" ]; then exec "$@" --browserUrl "http://127.0.0.1:$port"; fi; exec "$@"',
].join(' ')

const configFile = () => path.join(os.homedir(), '.claude.json')

/** The user-scope entry, or undefined. Reads only; writes go through `claude mcp` (see install). */
function currentEntry() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')).mcpServers?.[NAME]
  } catch {
    return undefined
  }
}

const isWrapped = entry => entry?.command === 'sh' && entry.args?.[1]?.includes('DECKTERM_PORT')

/** The entry as it was configured before Own Term wrapped it. */
function unwrapped(entry) {
  if (!isWrapped(entry)) return entry
  const [command, ...args] = entry.args.slice(3)
  return { ...entry, command, args }
}

function claude(args) {
  return new Promise((resolve, reject) => {
    execFile('claude', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()))
      else resolve(stdout)
    })
  })
}

// Claude Code rewrites ~/.claude.json constantly, so it's changed through its own commands. They
// can't replace an entry in one step, so if adding the new one fails, the old one is put back.
async function writeEntry(entry, previous) {
  await claude(['mcp', 'remove', NAME, '-s', 'user']).catch(() => {})
  try {
    await claude(['mcp', 'add-json', NAME, JSON.stringify(entry), '-s', 'user'])
  } catch (error) {
    if (previous) await claude(['mcp', 'add-json', NAME, JSON.stringify(previous), '-s', 'user']).catch(() => {})
    throw error
  }
}

function browserMcpInstalled() {
  return isWrapped(currentEntry())
}

/** Wraps the entry, adding a default one if there's none. Backs the config file up once first. */
async function installBrowserMcp() {
  const current = currentEntry()
  const original = unwrapped(current) ?? DEFAULT
  // Only a command can be wrapped; a server reached over HTTP or SSE is someone else's to point.
  if (!original.command || (original.type && original.type !== 'stdio')) {
    throw new Error('Your chrome-devtools MCP server isn’t a local command, so Own Term can’t give it a Chrome per session.')
  }
  const backup = `${configFile()}.before-own-term`
  if (fs.existsSync(configFile()) && !fs.existsSync(backup)) fs.copyFileSync(configFile(), backup)
  await writeEntry({ ...original, type: 'stdio', command: 'sh', args: ['-c', WRAPPER, 'own-term', original.command, ...(original.args ?? [])] }, current)
}

/** Puts the entry back as it was configured. */
async function uninstallBrowserMcp() {
  const entry = currentEntry()
  if (isWrapped(entry)) await writeEntry(unwrapped(entry), entry)
}

module.exports = { browserMcpInstalled, installBrowserMcp, uninstallBrowserMcp }
