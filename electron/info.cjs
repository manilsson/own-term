// What the info panel shows for the one session on screen: git in detail, the branch's pull request,
// the Claude conversation from its transcript, and the servers its shell started. Asked for only
// while the panel is open, so none of it runs per session.
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { StringDecoder } = require('node:string_decoder')
const os = require('node:os')
const { execFile } = require('node:child_process')

const MAX_FILES = 200
const MAX_VIEW = 2 * 1024 * 1024
const MAX_IMAGE = 25 * 1024 * 1024
// The image types Chromium draws; an <img> doesn't run an SVG's scripts.
const IMAGES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}

// gitStatus trims its output, which would eat the leading space of the first `status` line (" M").
const gitRaw = (cwd, ...args) => new Promise((resolve, reject) => {
  execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})

const gitBuffer = (cwd, ...args) => new Promise((resolve, reject) => {
  execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: 15000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})

module.exports = function registerInfo({ ipcMain, run, gitStatus, ptys }) {
  ipcMain.handle('info:git', async (_e, cwd) => {
    const top = await gitStatus(cwd, 'rev-parse', '--show-toplevel').catch(() => null)
    if (!top) return null
    const branch = await gitStatus(cwd, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => null)
    const [status, numstat, upstream, log, stashes, worktrees] = await Promise.all([
      gitRaw(cwd, 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all').catch(() => ''),
      gitRaw(cwd, 'diff', 'HEAD', '--numstat', '-z', '--no-renames').catch(() => ''),
      gitStatus(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => null),
      gitStatus(cwd, 'log', '-n', '6', '--format=%h%x1f%s%x1f%an%x1f%ct').catch(() => ''),
      gitStatus(cwd, 'stash', 'list').catch(() => ''),
      gitStatus(cwd, 'worktree', 'list', '--porcelain').catch(() => ''),
    ])
    const [ahead, behind] = upstream
      ? (await gitStatus(cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{u}').catch(() => '0\t0')).split(/\s+/).map(Number)
      : [0, 0]
    // Without an upstream, a commit is pushed if some remote branch has it, like the main-branch commits
    // a new branch started from.
    const unpushed = upstream
      ? ahead
      : Number(await gitStatus(cwd, 'rev-list', '--count', 'HEAD', '--not', '--remotes').catch(() => '0')) || 0

    // numstat -z: "added\tremoved\tpath\0"; binary files count as "-".
    const lines = {}
    for (const record of numstat.split('\0')) {
      const [added, removed, file] = record.split('\t')
      if (file) lines[file] = { added: Number(added) || 0, removed: Number(removed) || 0 }
    }
    const entries = status.split('\0').filter(Boolean)
    const files = entries.slice(0, MAX_FILES).map(entry => {
      const code = entry.slice(0, 2)
      const file = entry.slice(3)
      const kind = code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : 'modified'
      return { path: path.join(top, file), name: file, kind, ...(lines[file] ?? { added: 0, removed: 0 }) }
    })

    return {
      root: top,
      branch,
      head: branch ? null : await gitStatus(cwd, 'rev-parse', '--short', 'HEAD').catch(() => null),
      upstream,
      ahead,
      behind,
      files,
      moreFiles: Math.max(0, entries.length - MAX_FILES),
      commits: log.split('\n').filter(Boolean).map((line, i) => {
        const [hash, subject, author, time] = line.split('\x1f')
        return { hash, subject, author, time: Number(time) * 1000, pushed: i >= unpushed }
      }),
      stashes: stashes ? stashes.split('\n').length : 0,
      worktrees: worktrees.split('\n\n').filter(Boolean).map(block => {
        const field = name => block.split('\n').find(l => l.startsWith(`${name} `))?.slice(name.length + 1)
        const dir = field('worktree')
        return { path: dir, branch: field('branch')?.replace(/^refs\/heads\//, '') ?? null, current: dir === top }
      }),
    }
  })

  // gh needs to be installed and signed in; anything else it says means there's nothing to show.
  ipcMain.handle('info:pr', async (_e, cwd) => {
    try {
      const out = await run('gh', ['pr', 'view', '--json', 'number,title,state,isDraft,url,reviewDecision,statusCheckRollup'], { cwd, timeout: 20000 })
      const pr = JSON.parse(out)
      const checks = { passed: 0, failed: 0, pending: 0 }
      for (const check of pr.statusCheckRollup ?? []) {
        // Check runs report a status and then a conclusion; commit statuses report a state.
        const result = (check.conclusion || check.state || check.status || '').toUpperCase()
        if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) checks.passed++
        else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) checks.failed++
        else checks.pending++
      }
      return {
        available: true,
        pr: { number: pr.number, title: pr.title, url: pr.url, state: pr.isDraft ? 'DRAFT' : pr.state, review: pr.reviewDecision || null, checks },
      }
    } catch (error) {
      return { available: /no pull requests found/i.test(error.message), pr: null }
    }
  })

  // A file for the viewer: its changes since the last commit, and its text. Binary files and anything
  // over a couple of megabytes are only named, not read.
  ipcMain.handle('info:file', async (_e, file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return null
    const dir = path.dirname(file)
    const top = await gitStatus(dir, 'rev-parse', '--show-toplevel').catch(() => null)
    const tracked = top && await gitStatus(top, 'ls-files', '--error-unmatch', '--', file).then(() => true, () => false)
    const diff = tracked ? await gitRaw(top, 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--', file).catch(() => null) : null
    const stat = await fsp.stat(file).catch(() => null)
    const type = IMAGES[path.extname(file).toLowerCase()]
    const dataUrl = buffer => `data:${type};base64,${buffer.toString('base64')}`
    let text = null
    let note = null
    let image = null
    if (!stat) note = 'deleted'
    else if (!stat.isFile()) note = 'not a file'
    else if (type && stat.size <= MAX_IMAGE) image = dataUrl(await fsp.readFile(file))
    else if (stat.size > MAX_VIEW) note = 'too large'
    else {
      const buffer = await fsp.readFile(file)
      if (buffer.subarray(0, 8000).includes(0)) note = 'binary'
      else text = buffer.toString('utf8')
    }
    // A changed image is shown beside the committed one; `./` makes the path relative to its folder.
    const before = type && diff
      ? await gitBuffer(dir, 'show', `HEAD:./${path.basename(file)}`).then(b => (b.length <= MAX_IMAGE ? dataUrl(b) : null), () => null)
      : null
    return { diff: diff || null, tracked: !!tracked, text, note, image, before, size: stat?.size ?? null }
  })

  ipcMain.handle('info:claude', async (_e, claudeSessionId) => {
    if (typeof claudeSessionId !== 'string' || !/^[\w-]{1,64}$/.test(claudeSessionId)) return null
    const file = await findTranscript(claudeSessionId)
    if (!file) return null
    const info = await readTranscript(file)
    // Git reports files under the repo's real path, so these are resolved the same way to match them
    // (a repo under /tmp is really in /private/tmp).
    const edited = await Promise.all(info.edited.map(f => fsp.realpath(f).catch(() => f)))
    return { ...info, edited, scratchpad: await readScratchpad(claudeSessionId) }
  })

  // Listening sockets of every process under the session's shell: the dev server it started, say.
  ipcMain.handle('info:task-output', (_e, taskId, from) => readTaskOutput(taskId, from))

  ipcMain.handle('info:ports', async (_e, id) => {
    const pid = ptys.get(id)?.proc.pid
    if (!pid) return []
    try {
      const children = new Map()
      const parents = new Map()
      const args = new Map()
      for (const line of (await run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], { maxBuffer: 64 * 1024 * 1024 })).split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s(.*)$/)
        if (!match) continue
        const [child, parent] = [Number(match[1]), Number(match[2])]
        children.set(parent, [...(children.get(parent) ?? []), child])
        parents.set(child, parent)
        args.set(child, match[3])
      }
      const pids = [pid]
      for (let i = 0; i < pids.length; i++) pids.push(...(children.get(pids[i]) ?? []))
      // lsof exits 1 when nothing matches.
      const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', pids.join(','), '-Fpcn']).catch(() => '')
      const ports = new Map()
      let owner = 0
      let command = ''
      for (const line of out.split('\n')) {
        if (line[0] === 'p') owner = Number(line.slice(1))
        if (line[0] === 'c') command = line.slice(1)
        const port = line[0] === 'n' && Number(line.match(/:(\d+)$/)?.[1])
        if (port && !ports.has(port)) ports.set(port, { port, command, launchedBy: launchedBy(owner, parents, args, pid) })
      }
      return [...ports.values()].sort((a, b) => a.port - b.port)
    } catch {
      return []
    }
  })
}

// A conversation's transcript is ~/.claude/projects/<folder>/<id>.jsonl; the folder is the one Claude
// started in, which a session may have left since, so every project folder is looked in.
const transcripts = new Map()
const exists = file => fsp.access(file).then(() => true, () => false)
async function findTranscript(id) {
  const known = transcripts.get(id)
  if (known && (await exists(known))) return known
  const projects = path.join(os.homedir(), '.claude', 'projects')
  for (const dir of await fsp.readdir(projects, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(projects, dir.name, `${id}.jsonl`)
    if (dir.isDirectory() && (await exists(file))) {
      transcripts.set(id, file)
      return file
    }
  }
  return null
}

// Transcripts grow by appended lines and can reach tens of megabytes, so each is read from where the
// last read stopped and folded into a running summary.
const readers = new Map()
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
// The charts draw a few hundred points at most; older ones would only be averaged away.
const MAX_POINTS = 600

// The main process also pumps every terminal, so the reads are async, and one at a time per file so
// two polls never fold the same lines twice.
const queues = new Map()
function readTranscript(file) {
  const queued = (queues.get(file) ?? Promise.resolve()).then(() => readMore(file))
  queues.set(file, queued.catch(() => {}))
  return queued
}

async function readMore(file) {
  const { size } = await fsp.stat(file)
  let reader = readers.get(file)
  if (!reader || size < reader.offset) {
    reader = {
      offset: 0,
      rest: '',
      // A read can end inside a multi-byte character; the decoder keeps its bytes for the next one.
      decoder: new StringDecoder('utf8'),
      summary: {
        model: null, context: 0, compactions: 0, prompts: 0, started: null, edited: [], instructions: [], skills: [],
        series: [], turns: [], lastMessage: null,
      },
    }
    readers.set(file, reader)
  }
  if (size > reader.offset) {
    const buffer = Buffer.alloc(size - reader.offset)
    const handle = await fsp.open(file, 'r')
    try {
      await handle.read(buffer, 0, buffer.length, reader.offset)
    } finally {
      await handle.close()
    }
    reader.offset = size
    const lines = (reader.rest + reader.decoder.write(buffer)).split('\n')
    reader.rest = lines.pop()
    for (const line of lines) {
      try {
        fold(reader.summary, JSON.parse(line))
      } catch {}
    }
  }
  const { edited, lastMessage, ...summary } = reader.summary
  return { ...summary, edited: edited.slice(-12).reverse() }
}

// The transcript is Claude Code's own format and changes between versions, so every field is optional.
function fold(s, entry) {
  if (!s.started && entry.timestamp) s.started = Date.parse(entry.timestamp) || null
  // A subagent's messages don't fill the main conversation's context.
  if (entry.isSidechain) return
  const message = entry.message
  if (entry.type === 'assistant' && message) {
    if (message.model && !message.model.startsWith('<')) s.model = s.model?.id === message.model ? s.model : { id: message.model, name: null }
    const u = message.usage
    if (u) {
      s.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      // A response is written as one line per content block, all with the same message id and usage.
      const point = { time: Date.parse(entry.timestamp) || null, tokens: s.context }
      if (message.id && message.id === s.lastMessage) s.series[s.series.length - 1] = point
      else s.series.push(point)
      s.lastMessage = message.id ?? null
      if (s.series.length > MAX_POINTS) s.series.splice(0, s.series.length - MAX_POINTS)
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const file = block?.type === 'tool_use' && EDIT_TOOLS.includes(block.name) && (block.input?.file_path ?? block.input?.notebook_path)
      if (typeof file === 'string') s.edited = [...s.edited.filter(f => f !== file), file]
    }
  }
  if (entry.type === 'user' && typeof message?.content === 'string' && !entry.isMeta && !message.content.startsWith('<')) s.prompts++
  if (entry.type === 'system' && entry.subtype === 'compact_boundary') s.compactions++
  if (entry.type === 'system' && entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number') {
    s.turns.push({ time: Date.parse(entry.timestamp) || null, ms: entry.durationMs })
    if (s.turns.length > MAX_POINTS) s.turns.shift()
  }
  const attachment = entry.attachment
  if (attachment?.type === 'model' && attachment.identity?.modelId) {
    s.model = { id: attachment.identity.modelId, name: attachment.identity.marketingName ?? null }
  }
  if (attachment?.type === 'skill_listing' && Array.isArray(attachment.names)) {
    s.skills = attachment.isInitial ? attachment.names : [...new Set([...s.skills, ...attachment.names])]
  }
  if (attachment?.type === 'instructions' && Array.isArray(attachment.files)) {
    s.instructions = attachment.files.filter(f => typeof f?.path === 'string').map(f => ({ path: f.path, type: f.type ?? null }))
  }
}

/**
 * The command Claude ran that started process `pid`, if one did. Claude runs each in a shell of its own
 * as `eval '<command>'`, so the nearest such shell above the process names it.
 */
function launchedBy(pid, parents, args, top) {
  for (let at = pid; at && at !== top; at = parents.get(at)) {
    const quoted = args.get(at)?.match(/\beval '((?:[^']|'\\'')*)'/)?.[1]
    if (quoted !== undefined) return quoted.replaceAll("'\\''", "'")
  }
  return null
}

// Claude Code gives each conversation a scratch folder for its temporary files, under its project's
// folder in /tmp; the conversation's id is enough to find it.
const scratchpads = new Map()
const MAX_SCRATCH = 8

async function findScratchpad(id) {
  const known = scratchpads.get(id)
  if (known && (await exists(known))) return known
  const root = path.join('/private/tmp', `claude-${process.getuid()}`)
  for (const dir of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const folder = path.join(root, dir.name, id, 'scratchpad')
    if (dir.isDirectory() && (await exists(folder))) {
      scratchpads.set(id, folder)
      return folder
    }
  }
  return null
}

/** The scratchpad's folder and what's in it, newest first; null when the conversation has none. */
async function readScratchpad(id) {
  const dir = await findScratchpad(id)
  if (!dir) return null
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  const items = await Promise.all(entries.filter(e => !e.name.startsWith('.')).map(async e => {
    const file = path.join(dir, e.name)
    const stat = await fsp.stat(file).catch(() => null)
    return stat && { path: file, folder: stat.isDirectory(), size: stat.size, time: stat.mtimeMs }
  }))
  const files = items.filter(Boolean).sort((a, b) => b.time - a.time)
  return { dir, files: files.slice(0, MAX_SCRATCH), more: Math.max(0, files.length - MAX_SCRATCH) }
}

// A background command writes its output to tasks/<id>.output under some conversation's folder in /tmp,
// not always the one that started it (a resumed conversation keeps the first's), so each is looked for once.
const taskFiles = new Map()
const MAX_TASK_READ = 1024 * 1024

async function findTaskFile(taskId) {
  const known = taskFiles.get(taskId)
  if (known) return known
  const root = path.join('/private/tmp', `claude-${process.getuid()}`)
  for (const project of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue
    for (const conversation of await fsp.readdir(path.join(root, project.name)).catch(() => [])) {
      const file = path.join(root, project.name, conversation, 'tasks', `${taskId}.output`)
      if (await exists(file)) {
        taskFiles.set(taskId, file)
        return file
      }
    }
  }
  return null
}

/** The length of `buffer` without a UTF-8 character cut off at its end, which the next read starts with. */
function wholeCharacters(buffer) {
  for (let i = buffer.length - 1, back = 0; i >= 0 && back < 4; i--, back++) {
    const byte = buffer[i]
    if ((byte & 0xc0) === 0x80) continue
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return back + 1 < width ? i : buffer.length
  }
  return buffer.length
}

/** What a background command has written since byte `from`: its last megabyte at most, and where that ends. */
async function readTaskOutput(taskId, from) {
  if (typeof taskId !== 'string' || !/^[\w-]{1,64}$/.test(taskId)) return null
  const file = await findTaskFile(taskId)
  const stat = file && (await fsp.stat(file).catch(() => null))
  if (!stat) return null
  const asked = Number(from) || 0
  const start = Math.max(asked, stat.size - MAX_TASK_READ)
  if (start >= stat.size) return { text: '', size: start, skipped: false }
  const handle = await fsp.open(file, 'r')
  try {
    const buffer = Buffer.alloc(stat.size - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const chunk = buffer.subarray(0, wholeCharacters(buffer.subarray(0, bytesRead)))
    let offset = 0
    // Output left out starts mid-line; showing from the next whole line reads better.
    if (start > asked) offset = chunk.indexOf(10) + 1
    return { text: chunk.subarray(offset).toString('utf8'), size: start + chunk.length, skipped: start > asked }
  } finally {
    await handle.close()
  }
}

module.exports.findTranscript = findTranscript
