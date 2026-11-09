// The folder Claude is working in, from a hook event: it moves without the shell when Claude switches
// itself into a worktree, so sessions follow it for their branch and changes (claude.ts → workFolder).
const path = require('node:path')

/** `cwd` from a hook event, or undefined for a subagent's (it may run in a worktree of its own) or a bad one. */
function claudeFolder(e) {
  const cwd = e?.cwd
  if (e?.agent_id || typeof cwd !== 'string' || cwd.length > 4096 || cwd.includes('\0') || !path.isAbsolute(cwd)) return undefined
  const folder = path.normalize(cwd)
  return folder.length > 1 ? folder.replace(/\/+$/, '') : folder
}

module.exports = { claudeFolder }
