// Own Term's Claude Code hooks in ~/.claude/settings.json. Each posts the hook event to the Own Term
// that started the shell, and does nothing in any other terminal (DECKTERM_PORT is unset there).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const settingsPath = () => path.join(os.homedir(), '.claude', 'settings.json')
const COMMAND =
  '[ -z "$DECKTERM_PORT" ] || curl -s -m 2 -X POST -H "X-Deckterm-Token: $DECKTERM_TOKEN" ' +
  '--data-binary @- "http://127.0.0.1:$DECKTERM_PORT/hook/$DECKTERM_SESSION" >/dev/null 2>&1 || true'
// Event → the tool it's limited to, if any.
const EVENTS = {
  SessionStart: undefined,
  UserPromptSubmit: undefined,
  PermissionRequest: undefined,
  PreToolUse: undefined,
  PostToolUse: undefined,
  PostToolUseFailure: undefined,
  Notification: undefined,
  Stop: undefined,
  SessionEnd: undefined,
}

const isOurs = entry => entry.hooks?.some(h => h.command?.includes('DECKTERM_PORT'))
// An entry from an older Own Term limited to other tools, such as PreToolUse to AskUserQuestion only.
const isCurrent = (event, entry) => isOurs(entry) && (entry.matcher || undefined) === EVENTS[event]

function readSettings() {
  const file = settingsPath()
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
}

/** Whether every event has Own Term's hook; a settings file that won't parse counts as no. */
function hooksInstalled() {
  try {
    const hooks = readSettings().hooks ?? {}
    return Object.keys(EVENTS).every(event => (hooks[event] ?? []).some(entry => isCurrent(event, entry)))
  } catch {
    return false
  }
}

/** Whether some of Own Term's hooks are in place, so updating them is keeping a choice already made. */
function hooksPartlyInstalled() {
  try {
    return Object.values(readSettings().hooks ?? {}).some(entries => entries.some(isOurs))
  } catch {
    return false
  }
}

/** Adds the hooks that are missing. Throws on a settings file that isn't valid JSON, without touching it. */
function installHooks() {
  const file = settingsPath()
  const settings = readSettings()
  // The backup is the settings without Own Term's hooks, made once: an earlier run may already have
  // added them, and later runs would otherwise back up a changed file.
  const backup = `${file}.before-deckterm`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(backup)) {
    const original = structuredClone(settings)
    for (const [event, entries] of Object.entries(original.hooks ?? {})) {
      original.hooks[event] = entries.filter(entry => !isOurs(entry))
      if (original.hooks[event].length === 0) delete original.hooks[event]
    }
    if (original.hooks && Object.keys(original.hooks).length === 0) delete original.hooks
    fs.writeFileSync(backup, JSON.stringify(original, null, 2) + '\n')
  }
  settings.hooks ??= {}
  for (const [event, matcher] of Object.entries(EVENTS)) {
    settings.hooks[event] = (settings.hooks[event] ?? []).filter(entry => !isOurs(entry) || isCurrent(event, entry))
    const entries = settings.hooks[event]
    if (entries.some(isOurs)) continue
    entries.push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command: COMMAND }] })
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  return file
}

module.exports = { hooksInstalled, hooksPartlyInstalled, installHooks }
